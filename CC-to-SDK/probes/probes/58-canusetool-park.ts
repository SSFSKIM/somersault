// Probe 58 — Can a canUseTool decision be PARKED (held unresolved) for a long time, and does the
// turn resume correctly when it is finally answered?
//
// This is the one load-bearing mechanism in the Goal A spec that had no probe. It matters because the
// spec's park/attach/answer loop assumes "park = a held promise": a bg worker with no attached client
// holds the canUseTool promise until a human attaches and answers. The existing codebase does the
// OPPOSITE on purpose (uiBroker denies when no handler is set; daemon/permissions auto-denies at 30s),
// so if the SDK cannot tolerate a long hold, the whole loop needs redesigning.
//
// Questions: (1) does a held promise hang the turn gracefully rather than erroring? (2) does anything
// (an internal timeout, options.signal) force a decision out from under us? (3) does answering late
// resume the turn normally?
import { query } from "@anthropic-ai/claude-agent-sdk";

const HOLD_MS = 25_000;

let parkedAt = 0;
let released = false;
let sawSignalAbort = false;

const q = query({
  prompt: "Run the bash command `echo parked-probe-ok`. Use the Bash tool. Then reply DONE.",
  options: {
    model: "claude-haiku-4-5-20251001",
    maxTurns: 2,
    // Isolate the broker and FORCE it to fire. Two things were needed (both learned by running this):
    //  1. settingSources:[] — otherwise the user's own settings.json allowlists reach the CLI and Bash
    //     is auto-approved, so canUseTool is never consulted.
    //  2. an explicit `ask` rule — per probe 18g, canUseTool is the *human seam*: it fires only for
    //     tools a rule routes to `ask`. With no rules at all the broker stays silent.
    settingSources: [],
    permissionMode: "default",
    settings: { permissions: { ask: ["Bash(*)"] } } as any,
    canUseTool: async (toolName, input, opts: any) => {
      parkedAt = Date.now();
      console.log(`[canUseTool] ${toolName} — parking for ${HOLD_MS}ms`);
      console.log(`  signal present: ${!!opts?.signal} | aborted at entry: ${opts?.signal?.aborted}`);
      opts?.signal?.addEventListener?.("abort", () => {
        sawSignalAbort = true;
        console.log(`  !! signal ABORTED at +${Date.now() - parkedAt}ms (park was cut short)`);
      });
      await new Promise((r) => setTimeout(r, HOLD_MS));
      released = true;
      console.log(`[canUseTool] releasing after ${Date.now() - parkedAt}ms -> allow`);
      return { behavior: "allow", updatedInput: input } as any;
    },
  },
});

console.log("=== PROBE 58 canUseTool park ===");
let sawToolResult = false, result: any;
const t0 = Date.now();
try {
  for await (const m of q) {
    const mm = m as any;
    if (mm.type === "user") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_result") {
          sawToolResult = true;
          console.log(`[tool_result] at +${Date.now() - t0}ms:`, JSON.stringify(b.content).slice(0, 160));
        }
      }
    }
    if ("result" in mm) { result = mm; break; }
  }
} catch (e: any) {
  console.log("STREAM THREW:", e?.message);
}

const heldFor = parkedAt ? Date.now() - parkedAt : 0;
console.log("");
console.log(`held for            : ${released ? `${HOLD_MS}ms (full)` : `${heldFor}ms (cut short)`}`);
console.log(`signal aborted mid-park: ${sawSignalAbort}`);
console.log(`tool actually ran   : ${sawToolResult}`);
console.log(`result subtype      : ${result?.subtype} | is_error: ${result?.is_error}`);
console.log("");
const pass = released && !sawSignalAbort && sawToolResult && result && !result.is_error;
console.log(pass
  ? `VERDICT: a canUseTool decision CAN be parked ${HOLD_MS / 1000}s and answered late — the turn resumes normally`
  : "VERDICT: park is NOT safe as designed — see the lines above for which guarantee broke");
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
