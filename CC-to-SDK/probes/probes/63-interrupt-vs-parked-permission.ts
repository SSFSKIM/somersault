// Probe 63 — Does `interrupt()` release a PARKED canUseTool decision?
//
// Open question 3 of the Goal A spec. Probe 58 proved a park is not aborted SPONTANEOUSLY (25s hold,
// signal never fired). That leaves the deliberate case unanswered, and A2 turns on it:
//
//   `ccx stop <id>` on a session parked at a permission prompt. If interrupt() aborts the park —
//   options.signal fires and the turn unwinds — stop is simply interrupt(). If it does NOT, a parked
//   host ignores stop for as long as the park lasts (forever, by design), and stop must instead
//   resolve the pending decision itself, as a deny, before interrupting. That is a different
//   component: the park registry has to be addressable from the socket handler, not just from the UI.
//
// Method: park with a promise that is NEVER resolved by us, then call interrupt() from outside.
// Whatever releases the turn tells us which mechanism is real. A hard ceiling keeps the probe honest:
// if nothing releases it, that IS the finding, and we say so rather than hanging.
import { query } from "@anthropic-ai/claude-agent-sdk";

const INTERRUPT_AT_MS = 8_000;
const CEILING_MS = 90_000;

let parkedAt = 0;
let sawSignalAbort = false;
let signalAbortAtMs = 0;
let parkExited = false;
let interruptResolvedAtMs = 0;
let interruptThrew: string | undefined;

const t0 = Date.now();

const q = query({
  prompt: "Run the bash command `echo park-interrupt-probe`. Use the Bash tool. Then reply DONE.",
  options: {
    model: "claude-haiku-4-5-20251001",
    maxTurns: 2,
    // Same isolation probe 58 needed: no user settings (they allowlist Bash and the broker never
    // fires) and an explicit `ask` rule, because canUseTool is consulted only for tools a rule routes
    // to ask.
    settingSources: [],
    permissionMode: "default",
    settings: { permissions: { ask: ["Bash(*)"] } } as any,
    canUseTool: async (toolName, _input, opts: any) => {
      parkedAt = Date.now();
      console.log(`[canUseTool] ${toolName} parked at +${parkedAt - t0}ms — never resolved by us`);
      opts?.signal?.addEventListener?.("abort", () => {
        sawSignalAbort = true;
        signalAbortAtMs = Date.now() - parkedAt;
        console.log(`  !! signal ABORTED at +${signalAbortAtMs}ms after parking`);
      });
      // Deliberately unresolvable. Only the ceiling below can end it, and reaching the ceiling is a
      // finding, not a bug in the probe.
      await new Promise((r) => setTimeout(r, CEILING_MS));
      parkExited = true;
      console.log(`  park promise hit the ${CEILING_MS}ms ceiling and returned deny`);
      return { behavior: "deny", message: "probe ceiling" } as any;
    },
  },
});

console.log("=== PROBE 63 interrupt vs a parked permission ===");

// Fire interrupt() once the park is definitely established.
const interrupter = (async () => {
  await new Promise((r) => setTimeout(r, INTERRUPT_AT_MS));
  if (!parkedAt) { console.log(`[interrupt] skipped — nothing parked by +${INTERRUPT_AT_MS}ms`); return; }
  console.log(`[interrupt] calling interrupt() at +${Date.now() - t0}ms`);
  try {
    await q.interrupt();
    interruptResolvedAtMs = Date.now() - t0;
    console.log(`[interrupt] resolved at +${interruptResolvedAtMs}ms`);
  } catch (e: any) {
    interruptThrew = e?.message ?? String(e);
    console.log(`[interrupt] THREW at +${Date.now() - t0}ms: ${interruptThrew}`);
  }
})();

let result: any, streamThrew: string | undefined;
try {
  for await (const m of q) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init") console.log(`[init] +${Date.now() - t0}ms`);
    if ("result" in mm) { result = mm; break; }
  }
} catch (e: any) {
  streamThrew = e?.message ?? String(e);
  console.log(`STREAM THREW at +${Date.now() - t0}ms: ${streamThrew}`);
}
const endedAtMs = Date.now() - t0;
await interrupter;

// A verdict is only earned if a park actually happened. Without this gate the expression below reads
// "the turn ended quickly and the park never hit its ceiling" as evidence that interrupt() worked —
// which is exactly what a turn that never parked at all looks like. The first run of this probe
// printed "interrupt() RELEASES a parked permission" off a rate-limited turn that emitted no tool_use
// and therefore never reached canUseTool. A probe that states a mechanism it did not observe poisons
// every design decision that later cites it.
const measured = parkedAt > 0;
const releasedByInterrupt = measured && (sawSignalAbort || (endedAtMs < CEILING_MS * 0.9 && !parkExited));

console.log("");
console.log(`park established at   : +${parkedAt ? parkedAt - t0 : -1}ms`);
console.log(`interrupt() called at : +${INTERRUPT_AT_MS}ms`);
console.log(`signal aborted        : ${sawSignalAbort}${sawSignalAbort ? ` (+${signalAbortAtMs}ms after park)` : ""}`);
console.log(`interrupt() resolved  : ${interruptResolvedAtMs ? `+${interruptResolvedAtMs}ms` : interruptThrew ? `threw: ${interruptThrew}` : "never"}`);
console.log(`park ran to ceiling   : ${parkExited}`);
console.log(`stream ended at       : +${endedAtMs}ms ${streamThrew ? `(threw: ${streamThrew})` : `(result: ${result?.subtype}, is_error: ${result?.is_error})`}`);
if (result?.is_error) console.log(`result text           : ${JSON.stringify(result?.result).slice(0, 200)}`);
console.log("");
if (!measured) {
  console.log("VERDICT: INCONCLUSIVE — canUseTool never fired, so nothing about interrupt-vs-park was");
  console.log("         observed. Either the model emitted no tool_use (a rate-limited account answers");
  console.log("         with the limit notice and calls nothing), or the `ask` rule did not route Bash.");
  console.log("         Check the result text above before re-reading this as a negative result.");
} else if (releasedByInterrupt) {
  console.log("VERDICT: interrupt() RELEASES a parked permission — `ccx stop` on a blocked session can be");
  console.log("         a plain interrupt(); the park registry needs no separate cancel path.");
} else {
  console.log("VERDICT: interrupt() does NOT release a parked permission — the turn stays parked until the");
  console.log("         decision itself is answered. `ccx stop` MUST resolve the pending decision (deny)");
  console.log("         before/instead of interrupting, so the park registry must be reachable from the");
  console.log("         socket op handler, not only from an attached client.");
}
console.log(`RESULT: ${parkedAt ? "PASS (measured)" : "FAIL (never parked — check the ask rule)"}`);
