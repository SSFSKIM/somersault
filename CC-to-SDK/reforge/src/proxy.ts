// M0.3/M0.4 — record/replay proxy for the Anthropic API.
//
// The engine under test is pointed at this proxy via ANTHROPIC_BASE_URL.
//  - record: forward each request to the real API, stream the response through
//    to the engine, and append (request, response) pairs to a cassette (JSONL).
//    Auth headers are REDACTED before anything touches disk.
//  - replay: serve recorded responses deterministically, no network. Matching:
//    exact scrubbed-request-body hash first, then per-path FIFO. Every incoming
//    request is also logged (an "observed" file) so the differ can compare what
//    engine A sent at record time vs what engine B sent at replay time —
//    request-level drift is a behavioral signal, not an error.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { canonicalizeForHash } from "./canonical.js";
import { recordCredential, type RecordCredential } from "./env.js";

export interface CassetteEntry {
  seq: number;
  method: string;
  path: string;
  requestBody: string;
  status: number;
  contentType: string;
  responseBody: string;
  /**
   * Serve this entry without consuming it. Required for fault entries: an
   * engine RETRIES a failed call, and a consume-once entry would leave the
   * retry unmatched — so the engine would see the proxy's own fallback 500
   * instead of the injected fault. (Measured: every injected fault, including
   * 529 and 429, surfaced as the fallback until this existed.)
   */
  repeat?: boolean;
}

const REDACT_HEADERS = new Set(["authorization", "x-api-key", "cookie", "host", "content-length", "accept-encoding"]);

// The match key's canonical form lives in src/canonical.ts, SHARED with the
// differ (§3.4). It used to be a two-line scrub local to this file, which is how
// the two layers drifted far enough apart that multi-request scenarios matched
// positionally instead of exactly.
const bodyHash = (method: string, path: string, body: string) =>
  createHash("sha256").update(`${method} ${path}\n${canonicalizeForHash(body)}`).digest("hex");

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export interface ProxyHandle {
  port: number;
  close(): Promise<void>;
  /** replay only: entries never served (engine B stopped asking) */
  unserved(): CassetteEntry[];
  /** replay only: requests that matched nothing (engine B asked for something new) */
  unmatched(): { method: string; path: string; requestBody: string }[];
  /**
   * replay only: requests served by the POSITIONAL fallback because the exact
   * body hash missed. A silent degradation — positional order is usually right,
   * so a rotted cassette keeps "passing" until some suite depends on exactness.
   * Callers must surface this.
   */
  fallbackServed(): number;
}

/**
 * §3.4 — how a positional fallback is graded.
 *
 * `engine-extracted` is the identical-code self-test pair: real binary vs the
 * same payload unpacked. A fallback there is a HARNESS diagnostic (a stale
 * cassette, a normalization gap) and stays a warning, because that pair makes no
 * equivalence claim about a different implementation.
 *
 * Every other `engineB` — every strangled build, and engine-ts — is a genuinely
 * different implementation, and for those a fallback is FATAL. Serving in
 * arrival order when the body hash misses can hand a DRIFTED request the
 * response that belonged to a different one, and the run then grades green on a
 * comparison that never happened. `cross-resume` hit exactly that once: a
 * fallback served the first turn's response to the resume turn.
 */
export const strictReplay = (engineB: string): boolean => engineB !== "engine-extracted";

/**
 * Report a fallback count and return whether the run may still pass.
 * Callers must fold the result into their verdict — printing alone is not a gate.
 */
export function fallbackVerdict(engineB: string, side: string, count: number): boolean {
  if (count === 0) return true;
  const strict = strictReplay(engineB);
  console.log(
    `    ${strict ? "FAIL" : "WARN"} ${side}: ${count} request(s) served POSITIONALLY (body hash missed` +
      (strict ? ` — FATAL for engineB=${engineB}: a drifted request may have been served another request's response)` : " — cassette may be stale)"),
  );
  return !strict;
}

/**
 * §3.4 — the STRUCTURAL backstop against over-scrubbing.
 *
 * Every scrub in `canonical.ts` is a bet that the text it erases carries no
 * behavior. Each bet is argued and regression-tested, but the tests can only
 * cover neighbours somebody thought of; a scrub that is one character too wide
 * for a shape nobody anticipated fails SILENTLY and in the worst direction — two
 * genuinely different recorded requests collapse to one replay key, the first
 * match is served to both, `fallbackServed` stays at zero, and both engines are
 * graded against a response that answered a different question.
 *
 * This closes that class without needing to anticipate the shape. At cassette
 * load, canonicalize every entry: if two entries whose RAW bodies differ share a
 * key, the normalization has lost a distinction this very cassette depends on,
 * and the proxy REFUSES TO START. Residual over-reach can then only refuse to
 * run — never misroute.
 *
 * Identical raw bodies sharing a key is normal and allowed: a repeated request
 * (a retry, a `repeat` fault entry, a second identical poll) is served FIFO.
 */
export function assertNoKeyCollisions(entries: CassetteEntry[], label: string): void {
  const byKey = new Map<string, CassetteEntry>();
  for (const e of entries) {
    const key = bodyHash(e.method, e.path, e.requestBody);
    const prior = byKey.get(key);
    if (prior === undefined) {
      byKey.set(key, e);
      continue;
    }
    if (prior.requestBody === e.requestBody) continue;
    let at = 0;
    while (at < prior.requestBody.length && prior.requestBody[at] === e.requestBody[at]) at++;
    const window = (s: string) => JSON.stringify(s.slice(Math.max(0, at - 60), at + 60));
    throw new Error(
      `cassette key collision in ${label}: entries #${prior.seq} and #${e.seq} have DIFFERENT raw bodies but the same ` +
        `canonical replay key — a scrub in src/canonical.ts is eating a distinction this cassette depends on, so replay ` +
        `would serve one request the other's response. First difference at byte ${at}:\n` +
        `  #${prior.seq}: ${window(prior.requestBody)}\n  #${e.seq}: ${window(e.requestBody)}`,
    );
  }
}

/**
 * X6 — the proxy, not the engine, holds the credential.
 *
 * The engine's environment carries only a placeholder (`PLACEHOLDER_CREDENTIALS`
 * in `src/env.ts`), so the outbound request arrives here with a placeholder auth
 * header. This swaps in the real value, read from the HARNESS process. The header
 * chosen matches the variable the operator actually has, which is also the
 * variable the engine was told it has, so the request shape is the engine's own:
 * `Authorization: Bearer …` for the OAuth token, `x-api-key: …` for the API key.
 *
 * Nothing recorded ever sees it: `REDACT_HEADERS` keeps both auth headers out of
 * the forwarded copy, a cassette entry has no header field at all, and the value
 * is never logged.
 */
function injectCredential(headers: Record<string, string>, credential: RecordCredential): void {
  if (credential.name === "CLAUDE_CODE_OAUTH_TOKEN") headers.authorization = `Bearer ${credential.value}`;
  else headers["x-api-key"] = credential.value;
}

export async function startRecordProxy(
  cassettePath: string,
  upstream = "https://api.anthropic.com",
  credential: RecordCredential | null = recordCredential(),
): Promise<ProxyHandle> {
  let seq = 0;
  const server = http.createServer(async (req, res) => {
    const requestBody = await readBody(req);
    const mySeq = seq++;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!REDACT_HEADERS.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
    }
    // The engine only ever sent a placeholder; put the real credential on the
    // wire here. With none available (a stub-upstream test) forward nothing —
    // an unauthenticated upstream call is a loud failure, a leak is not.
    if (credential) injectCredential(headers, credential);
    const target = new URL(req.url ?? "/", upstream);
    const chunks: Buffer[] = [];
    // A stub upstream in a test is plain http; the real API is https.
    const up = (target.protocol === "http:" ? http : https).request(
      target,
      { method: req.method, headers: { ...headers, host: target.host } },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, { "content-type": upRes.headers["content-type"] ?? "application/octet-stream" });
        upRes.on("data", (c: Buffer) => {
          chunks.push(c);
          res.write(c); // stream through — the engine consumes SSE incrementally
        });
        upRes.on("end", () => {
          res.end();
          const entry: CassetteEntry = {
            seq: mySeq,
            method: req.method ?? "GET",
            path: req.url ?? "/",
            requestBody: requestBody.toString("utf8"),
            status: upRes.statusCode ?? 0,
            contentType: String(upRes.headers["content-type"] ?? ""),
            responseBody: Buffer.concat(chunks).toString("utf8"),
          };
          appendFileSync(cassettePath, JSON.stringify(entry) + "\n");
        });
      },
    );
    up.on("error", (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    up.end(requestBody);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () => new Promise((r) => server.close(() => r())),
    unserved: () => [],
    unmatched: () => [],
    fallbackServed: () => 0,
  };
}

export async function startReplayProxy(cassettePath: string, observedPath?: string): Promise<ProxyHandle> {
  const entries: CassetteEntry[] = readFileSync(cassettePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assertNoKeyCollisions(entries, cassettePath);
  const consumed = new Set<number>();
  const unmatched: { method: string; path: string; requestBody: string }[] = [];
  let fallbackServed = 0;

  const server = http.createServer(async (req, res) => {
    const requestBody = (await readBody(req)).toString("utf8");
    const method = req.method ?? "GET";
    const path = req.url ?? "/";
    if (observedPath) appendFileSync(observedPath, JSON.stringify({ method, path, requestBody }) + "\n");

    const hash = bodyHash(method, path, requestBody);
    let entry = entries.find((e) => !consumed.has(e.seq) && bodyHash(e.method, e.path, e.requestBody) === hash);
    if (!entry) {
      entry = entries.find((e) => !consumed.has(e.seq) && e.method === method && e.path === path); // positional fallback
      if (entry && requestBody.length > 0) fallbackServed++; // bodyless probes (HEAD) are not a signal
    }
    if (!entry) {
      unmatched.push({ method, path, requestBody });
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "reforge-replay: no cassette entry", method, path }));
      return;
    }
    if (!entry.repeat) consumed.add(entry.seq);
    res.writeHead(entry.status, { "content-type": entry.contentType });
    if (entry.contentType.includes("text/event-stream")) {
      for (const block of entry.responseBody.split("\n\n")) {
        if (block.trim().length > 0) res.write(block + "\n\n"); // event-sized chunks, immediate flush
      }
      res.end();
    } else {
      res.end(entry.responseBody);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () => new Promise((r) => server.close(() => r())),
    unserved: () => entries.filter((e) => !consumed.has(e.seq)),
    unmatched: () => unmatched,
    fallbackServed: () => fallbackServed,
  };
}
