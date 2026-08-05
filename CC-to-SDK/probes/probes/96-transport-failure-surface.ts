// Probe 96 — the transport-failure surface: what does the SDK emit headlessly when the API is
// unreachable mid-query?
//
// Question (gates the "connection trouble" row in the live turn):
//   Upstream Claude Code renders a retry banner — "Retrying in Ns · attempt n/10" — with a live
//   countdown while the API is unreachable. Can ccx render that from SDK-PROVIDED events, or must the
//   host synthesize its own timeout/retry state machine? Concretely:
//     Q1. Does query() THROW, or yield a result message with an error subtype, or hang forever?
//     Q2. Do any messages / stderr lines carry attempt numbers, backoff seconds, or a countdown?
//     Q3. Does a hanging endpoint (packets blackholed) behave differently from a fast-refusing one?
//
// Method: variants that differ only in ANTHROPIC_BASE_URL, each with a hard AbortController deadline so
// the probe always terminates.
//   A  http://203.0.113.1   TEST-NET-3 (RFC 5737) — non-routable, packets are blackholed → connect HANGS.
//   B  http://127.0.0.1:9   discard port, nothing listening → connect REFUSES immediately.
//   C  a local one-shot HTTP server answering 401 — a NON-retryable HTTP error, so it reaches the
//      TERMINAL frame in seconds instead of riding the backoff ladder.
// None touches real network config. The SDK spawns the `claude` CLI as a subprocess and Options.env
// REPLACES the child env wholesale (known gotcha), so the override is layered onto {...process.env}.
// The child's stderr is captured through Options.stderr — the other place CLI-internal retry chatter
// could surface.
//
// Usage:  npx tsx probes/96-transport-failure-surface.ts [A,B,C]   (default "A,B")
//         PROBE96_DEADLINE_MS=900000 npx tsx probes/96-transport-failure-surface.ts B
//         — the long deadline is what it takes to ride the backoff ladder to retry EXHAUSTION; at the
//           default 120s the abort preempts it around attempt 7.
//
// RESULT (run 2026-08-06, claude-haiku-4-5, keyed via CC-to-SDK/.env) — see the ANSWER block at the
// bottom of this file, written from the live run.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = Number(process.env.PROBE96_DEADLINE_MS ?? 120_000);
const WANTED = new Set((process.argv[2] ?? "A,B").split(",").map((s) => s.trim().toUpperCase()));

// Never let a live credential reach stdout, even if the child echoes one back at us.
const SECRETS = [process.env.ANTHROPIC_API_KEY, process.env.CLAUDE_CODE_OAUTH_TOKEN].filter(
  (v): v is string => !!v && v.length > 8,
);
function redact(s: string): string {
  let out = s;
  for (const secret of SECRETS) out = out.split(secret).join("<REDACTED>");
  return out.replace(/sk-ant-[A-Za-z0-9_-]+/g, "<REDACTED>");
}

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (s: string) => console.log(redact(`[${dt()}] ${s}`));

function brief(m: any, max = 400): string {
  const clone = JSON.parse(JSON.stringify(m));
  const walk = (v: any): any => {
    if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…(${v.length})` : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) v[k] = walk(v[k]);
    }
    return v;
  };
  return JSON.stringify(walk(clone));
}

// Hunt for anything that looks like retry/backoff/attempt bookkeeping anywhere in a payload.
const RETRY_WORDS = /retry|retrying|attempt|backoff|back-off|countdown|reconnect|will retry|\d+\/10/i;
function retryHits(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => RETRY_WORDS.test(line))
    .map((line) => line.trim().slice(0, 300));
}

type VariantResult = {
  name: string;
  baseUrl: string;
  messages: { at: string; type: string; subtype?: string }[];
  stderrLines: { at: string; line: string }[];
  outcome: string;
  elapsedMs: number;
  retryEvidence: string[];
};

async function runVariant(name: string, baseUrl: string): Promise<VariantResult> {
  const cwd = mkdtempSync(join(tmpdir(), `probe96-${name}-`));
  const started = Date.now();
  const messages: VariantResult["messages"] = [];
  const stderrLines: VariantResult["stderrLines"] = [];
  const retryEvidence: string[] = [];
  let outcome = "(never settled)";

  console.log(`\n=== VARIANT ${name} — ANTHROPIC_BASE_URL=${baseUrl} ===`);
  log(`start · cwd=${cwd} · deadline=${DEADLINE_MS / 1000}s`);

  const ac = new AbortController();
  const timer = setTimeout(() => {
    log(`DEADLINE ${DEADLINE_MS / 1000}s reached — aborting`);
    ac.abort();
  }, DEADLINE_MS);

  try {
    const q = query({
      prompt: "Reply with exactly the word PONG. Use no tools.",
      options: {
        model: MODEL,
        cwd,
        maxTurns: 1,
        abortController: ac,
        // Options.env REPLACES the child env — layer, do not substitute.
        env: { ...process.env, ANTHROPIC_BASE_URL: baseUrl } as Record<string, string>,
        stderr: (data: string) => {
          for (const line of data.split("\n")) {
            if (!line.trim()) continue;
            stderrLines.push({ at: dt(), line: redact(line.trim()) });
            console.log(redact(`[${dt()}] STDERR │ ${line.trim().slice(0, 300)}`));
          }
          retryEvidence.push(...retryHits(redact(data)).map((l) => `stderr: ${l}`));
        },
      },
    });

    for await (const m of q) {
      const anyM = m as any;
      messages.push({ at: dt(), type: anyM.type, subtype: anyM.subtype });
      log(`MSG type=${anyM.type}${anyM.subtype ? ` subtype=${anyM.subtype}` : ""}`);
      log(`     keys=[${Object.keys(anyM).join(", ")}]`);
      const dump = brief(anyM);
      log(`     ${dump}`);
      retryEvidence.push(...retryHits(dump).map((l) => `message: ${l}`));
      // Anything error-shaped gets its own explicit dump so it cannot be missed in the log.
      for (const k of ["error", "errors", "is_error", "result", "cause", "detail"]) {
        if (anyM[k] !== undefined) log(`     ERRFIELD ${k} = ${brief(anyM[k])}`);
      }
    }
    outcome = "iterator COMPLETED without throwing";
  } catch (err: any) {
    outcome = `THREW ${err?.name ?? "?"}: ${redact(String(err?.message ?? err)).slice(0, 500)}`;
    log(`THROW name=${err?.name} ctor=${err?.constructor?.name}`);
    log(`      message=${redact(String(err?.message ?? err)).slice(0, 800)}`);
    for (const k of ["code", "exitCode", "stderr", "cause", "status"]) {
      if (err?.[k] !== undefined) log(`      err.${k} = ${redact(String(err[k])).slice(0, 500)}`);
    }
    retryEvidence.push(...retryHits(redact(String(err?.message ?? ""))).map((l) => `throw: ${l}`));
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - started;
  log(`OUTCOME ${outcome} · elapsed=${(elapsedMs / 1000).toFixed(2)}s · messages=${messages.length} · stderr lines=${stderrLines.length}`);
  return { name, baseUrl, messages, stderrLines, outcome, elapsedMs, retryEvidence };
}

// Variant C's endpoint: a local server that answers every request with a non-retryable 401 in
// Anthropic's error envelope. Lets the probe reach the TERMINAL frame without riding the backoff ladder.
async function start401Server(): Promise<{ url: string; close: () => void; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    log(`401-SERVER hit #${hits} ${req.method} ${req.url}`);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "probe 96 synthetic 401" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close(), hits: () => hits };
}

const results: VariantResult[] = [];
if (WANTED.has("A")) results.push(await runVariant("A-blackhole", "http://203.0.113.1"));
if (WANTED.has("B")) results.push(await runVariant("B-refuse", "http://127.0.0.1:9"));
if (WANTED.has("C")) {
  const srv = await start401Server();
  results.push(await runVariant("C-http401", srv.url));
  log(`401-SERVER total hits: ${srv.hits()}`);
  srv.close();
}

console.log("\n=== SUMMARY ===");
for (const r of results) {
  console.log(`\n[${r.name}] ${r.baseUrl}`);
  console.log(`  outcome        : ${r.outcome}`);
  console.log(`  time to failure: ${(r.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`  messages       : ${r.messages.map((m) => `${m.at} ${m.type}${m.subtype ? "/" + m.subtype : ""}`).join(" | ") || "(none)"}`);
  console.log(`  stderr lines   : ${r.stderrLines.length}`);
  for (const l of r.stderrLines.slice(0, 20)) console.log(`      ${l.at} ${l.line.slice(0, 200)}`);
  console.log(`  retry evidence : ${r.retryEvidence.length ? "" : "NONE"}`);
  for (const e of r.retryEvidence.slice(0, 20)) console.log(`      ${e}`);
}

// ── ANSWER (from the live runs of 2026-08-06; raw traces in waveT-probe-findings.md) ─────────────
// A1/A2. THE RETRY BANNER IS SDK-PROVIDED. Every retry emits a first-class message:
//   {type:"system", subtype:"api_retry", attempt, max_retries, retry_delay_ms, error_status, error,
//    session_id, uuid}
// e.g. {"attempt":7,"max_retries":10,"retry_delay_ms":33073,"error_status":null,"error":"unknown"}.
// That is literally upstream's "Retrying in Ns · attempt n/10": attempt and max_retries are handed to
// us, and the "in Ns" countdown is a local timer seeded from retry_delay_ms. Matches the declared
// SDKAPIRetryMessage in sdk.d.ts exactly. The `error` field is a TYPED name — "unknown" for connection
// failures, "authentication_failed" for a 401 — and error_status is the HTTP status or null when there
// was no response. The child's stderr contributed NOTHING in any variant (0 lines): messages are the
// only channel.
// A3. HANG vs REFUSE differ only in PACING, not in shape. Refused connections start the ladder within
// ~20ms of init; a blackholed endpoint burns a ~75s connect timeout BEFORE the first api_retry arrives.
// So a host that renders nothing until the first api_retry shows a frozen screen for 75s — the
// "connecting" state has to be host-owned; only the retry state is SDK-owned.
// Observed backoff ladder (B, connection refused, ms): 563 · 1215 · 2413 · 4938 · 9735 · 18319 · 33073
// · 38733 · 38751 · 39236 — exponential with jitter, capped near 39s. Ten attempts ≈ 190s wall.
// TERMINAL SHAPE (three frames, in this order):
//   1. a SYNTHETIC assistant message: model:"<synthetic>", is_api_error_message:true, error:<typed>,
//      content = one text block, "API Error: Unable to connect to API (ConnectionRefused)".
//   2. type:"result" — and the TRAP is that subtype is still "success"; the failure is carried by
//      is_error:true · terminal_reason:"api_error" · api_error_status:(401|null) · result:<same text>.
//      Classify on terminal_reason/is_error, NEVER on subtype.
//   3. the async iterator THEN THROWS. Message varies by path: "Claude Code process exited with code 1"
//      (retries exhausted) · "Claude Code returned an error result: <text>" (non-retryable 401) ·
//      "Claude Code process aborted by user" (our AbortController). So a host must handle BOTH a
//      terminal result frame and a throw for the same failure.
// NOT ALL ERRORS GET 10 TRIES: the 401 gave up after 3 retries (4 HTTP requests total) despite
// max_retries:10 — max_retries is a ceiling, not a promise, so the banner must be cleared by the
// terminal frame rather than by counting to max_retries.
// NO CANCEL/SUCCESS EVENT: nothing announces "the retry succeeded". The banner has to be torn down by
// the next non-api_retry frame.
