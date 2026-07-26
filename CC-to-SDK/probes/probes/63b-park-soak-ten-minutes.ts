// Probe 63b — Does a parked permission survive TEN MINUTES and still resume?
//
// Open question 3, second half. Acceptance 8 of the Goal A spec says a `--bg` host "parks
// indefinitely" on an ask-routed tool with no client attached. That word is currently extrapolated
// from probe 58's 25-second hold, which is not evidence for the case that matters: a worker spawned
// overnight, parked at its first tool, waiting for a human who arrives in the morning. Ten minutes
// does not prove "indefinitely" either, but it crosses every plausible timeout boundary in between —
// HTTP keepalive, CLI subprocess idle timers, our own 30s auto-deny (which we are removing) — so a
// pass here makes the design's claim defensible and a failure names the exact ceiling.
//
// Method: park and hold for 600s, logging a heartbeat each minute so a death is dated, then answer
// allow and check the tool actually ran and the turn completed normally.
import { query } from "@anthropic-ai/claude-agent-sdk";

const HOLD_MS = 10 * 60_000;
const HEARTBEAT_MS = 60_000;

let parkedAt = 0;
let released = false;
let sawSignalAbort = false;
let signalAbortAtMs = 0;
const t0 = Date.now();

const q = query({
  prompt: "Run the bash command `echo soak-probe-ok`. Use the Bash tool. Then reply DONE.",
  options: {
    model: "claude-haiku-4-5-20251001",
    maxTurns: 2,
    settingSources: [],
    permissionMode: "default",
    settings: { permissions: { ask: ["Bash(*)"] } } as any,
    canUseTool: async (toolName, input, opts: any) => {
      parkedAt = Date.now();
      console.log(`[canUseTool] ${toolName} parked at +${parkedAt - t0}ms — holding ${HOLD_MS / 60000} minutes`);
      opts?.signal?.addEventListener?.("abort", () => {
        sawSignalAbort = true;
        signalAbortAtMs = Date.now() - parkedAt;
        console.log(`  !! signal ABORTED at +${(signalAbortAtMs / 1000).toFixed(0)}s into the park`);
      });
      const beat = setInterval(() => {
        console.log(`  [heartbeat] still parked at +${((Date.now() - parkedAt) / 1000).toFixed(0)}s`);
      }, HEARTBEAT_MS);
      await new Promise((r) => setTimeout(r, HOLD_MS));
      clearInterval(beat);
      released = true;
      console.log(`[canUseTool] releasing after ${((Date.now() - parkedAt) / 1000).toFixed(0)}s -> allow`);
      return { behavior: "allow", updatedInput: input } as any;
    },
  },
});

console.log("=== PROBE 63b ten-minute park soak ===");
let sawToolResult = false, result: any, streamThrew: string | undefined;
try {
  for await (const m of q) {
    const mm = m as any;
    if (mm.type === "user") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_result") {
          sawToolResult = true;
          console.log(`[tool_result] at +${((Date.now() - t0) / 1000).toFixed(0)}s: ${JSON.stringify(b.content).slice(0, 120)}`);
        }
      }
    }
    if ("result" in mm) { result = mm; break; }
  }
} catch (e: any) {
  streamThrew = e?.message ?? String(e);
  console.log(`STREAM THREW at +${((Date.now() - t0) / 1000).toFixed(0)}s: ${streamThrew}`);
}

const heldS = parkedAt ? (Date.now() - parkedAt) / 1000 : 0;
console.log("");
console.log(`held for            : ${released ? `${HOLD_MS / 1000}s (full)` : `${heldS.toFixed(0)}s (cut short)`}`);
console.log(`signal aborted      : ${sawSignalAbort}${sawSignalAbort ? ` at +${(signalAbortAtMs / 1000).toFixed(0)}s` : ""}`);
console.log(`tool actually ran   : ${sawToolResult}`);
console.log(`stream              : ${streamThrew ? `threw: ${streamThrew}` : `result ${result?.subtype}, is_error ${result?.is_error}`}`);
console.log("");
const pass = released && !sawSignalAbort && sawToolResult && result && !result.is_error;
console.log(pass
  ? `VERDICT: a park survives ${HOLD_MS / 60000} minutes and answers normally — "parks indefinitely" is defensible`
  : `VERDICT: the park did NOT survive ${HOLD_MS / 60000} minutes — the ceiling is named above; a bg host needs its own keepalive or re-ask`);
console.log(`RESULT: ${pass ? "PASS" : "FAIL"}`);
