// Probe 40 — startup()/WarmQuery (Wave 2 item 1): pre-warmed CLI subprocess, headlessly.
//
// Declared surface (sdk.d.ts 0.3.211):
//   - startup({options?, initializeTimeoutMs?}) → Promise<WarmQuery> — subprocess spawned + initialize
//     handshake done BEFORE any prompt.
//   - WarmQuery.query(prompt) → Query (once per handle); WarmQuery.close() discards; AsyncDisposable.
// Declared ≠ reachable — docs pitch this for hosting; nothing proves the handshake completes headlessly.
// Design-blocking questions:
//   1. Does startup() resolve headlessly (and how long does the warm-up take)?
//   2. Does warm.query() then return a WORKING Query (init + result arrive)?
//   3. Latency: prompt→result on a warm handle vs a cold query() — is the win real?
//   4. Does close() discard an unused warm handle cleanly (no hang at exit)?
// Bonus (free): the init payload's `tools` array — the authoritative native-tool inventory — settles
// EXISTENCE for probes 41/44/45/47/49 targets (SendMessage/Monitor/ReportFindings/ClaudeDesign/RefreshMcpTools).
import { query, startup } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 40 startup()/WarmQuery ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (240s) — probe wedged, exiting"); process.exit(2); }, 240_000).unref?.();

const OPTS: any = { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", maxTurns: 1, settingSources: [] };
const WATCHED = ["SendMessage", "Monitor", "ReportFindings", "ClaudeDesign", "RefreshMcpTools", "Workflow", "TaskOutput"];

async function drain(handle: AsyncIterable<any>, label: string) {
  const t0 = Date.now();
  let initAt = 0, resultAt = 0, tools: string[] = [], resultText = "";
  for await (const m of handle as any) {
    if (m.type === "system" && m.subtype === "init") { initAt = Date.now() - t0; tools = m.tools ?? []; }
    if (m.type === "result") { resultAt = Date.now() - t0; resultText = brief(m.result, 80); }
  }
  console.log(`[${label}] init@${initAt}ms result@${resultAt}ms | ${resultText}`);
  return { initAt, resultAt, tools };
}

// ---- Q1: startup() resolves? ----
const tWarm0 = Date.now();
let warm: any;
try {
  warm = await startup({ options: OPTS });
  console.log(`[Q1] startup() resolved ✅ in ${Date.now() - tWarm0}ms`);
} catch (e) {
  console.log("[Q1] startup() THREW ❌:", brief(String(e), 400));
  process.exit(0);
}

// ---- Q2/Q3: warm.query() works; time prompt→result ----
const warmRun = await drain(warm.query("Reply with exactly: WARM-OK"), "Q2 warm");
console.log("[Q2]", warmRun.resultAt > 0 ? "warm query WORKS ✅" : "no result ❌");
console.log("[bonus] init.tools count:", warmRun.tools.length,
  "| watched:", WATCHED.map((t) => `${t}:${warmRun.tools.includes(t) ? "✅" : "—"}`).join(" "));
console.log("[bonus] full tools:", warmRun.tools.join(","));

// ---- Q3 baseline: cold query() ----
const coldRun = await drain(query({ prompt: "Reply with exactly: COLD-OK", options: OPTS }), "Q3 cold");
console.log(`[Q3] warm prompt→result ${warmRun.resultAt}ms vs cold ${coldRun.resultAt}ms (cold init alone ${coldRun.initAt}ms)`);

// ---- Q4: close() an unused warm handle ----
try {
  const spare: any = await startup({ options: OPTS });
  spare.close();
  console.log("[Q4] close() on unused warm handle ✅");
} catch (e) {
  console.log("[Q4] close() path THREW ❌:", brief(String(e), 300));
}

console.log("\n=== VERDICT ===");
if (warmRun.resultAt > 0) console.log(`REACHABLE ✅ — startup()+WarmQuery work headlessly; warm saves ~${Math.max(0, coldRun.resultAt - warmRun.resultAt)}ms/prompt (cold init ${coldRun.initAt}ms).`);
else console.log("NOT WORKING ❌ — startup() resolved but the warm Query produced no result.");
process.exit(0);
