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

// Scrub volatile fields from a request body before hashing so record-time and
// replay-time requests with identical behavior hash identically.
export function scrubRequestBody(body: string): string {
  // The engine stamps the current date into its system prompt, so an unscrubbed
  // cassette ROTS AT MIDNIGHT: the live body stops hash-matching the recording.
  // Measured — a cassette recorded 2026-08-24 stopped matching on 2026-08-25 and
  // every replay silently degraded to positional matching.
  const dated = body.replace(/Today's date is \d{4}-\d{2}-\d{2}/g, "Today's date is <date>");
  try {
    const o = JSON.parse(dated);
    if (o?.metadata) o.metadata = "<scrubbed>";
    return JSON.stringify(o);
  } catch {
    return dated;
  }
}

const bodyHash = (method: string, path: string, body: string) =>
  createHash("sha256").update(`${method} ${path}\n${scrubRequestBody(body)}`).digest("hex");

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

export async function startRecordProxy(cassettePath: string, upstream = "https://api.anthropic.com"): Promise<ProxyHandle> {
  let seq = 0;
  const server = http.createServer(async (req, res) => {
    const requestBody = await readBody(req);
    const mySeq = seq++;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!REDACT_HEADERS.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
    }
    // forward auth as received, but never record it
    for (const k of ["authorization", "x-api-key"]) {
      const v = req.headers[k];
      if (typeof v === "string") headers[k] = v;
    }
    const target = new URL(req.url ?? "/", upstream);
    const chunks: Buffer[] = [];
    const up = https.request(
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
