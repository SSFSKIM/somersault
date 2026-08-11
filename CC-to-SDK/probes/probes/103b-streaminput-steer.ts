// probes/probes/103b-streaminput-steer.ts — M2b Wave 4 probe 1 (spec table row 1): can
// Query.streamInput inject a user message into a RUNNING turn ("steer"), the way the SDK docstring's
// remote-UI story implies? Declared: streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>
// (sdk.d.ts:2557). Verdict ALIVE requires BOTH: the method exists at runtime AND the injected text
// influenced the SAME turn's subsequent output. Promote-or-discard is fixed in the M2b plan Task 5:
// ALIVE → turn/steer (X) over a new lib seam Session.steer; DEAD → -32601, row N/A-dead, and steering
// is NEVER faked via interrupt+resubmit.
//
// Shape note: the plan sketched a single-message call; the declared signature takes an AsyncIterable,
// so the injection is a one-shot async generator yielding one SDKUserMessage (session.ts:27's shape).
import { query } from "@anthropic-ai/claude-agent-sdk";

// Run 1 lesson (2026-08-11): a prose-only turn is too fast — haiku emitted all 30 numbers in one
// burst and the 2s timer never fired (called:false, INCONCLUSIVE). The turn must have real
// wall-clock length, so run 2 forces sequential Bash sleeps and steers at first output + 500ms.
const cwd = process.cwd();
const STEER_AFTER_MS = 500;    // inject this long after the first sign of turn output
const DEADLINE_MS = 120_000;

function oneShot(text: string): AsyncIterable<any> {
  return (async function* () {
    yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, origin: { kind: "user" }, uuid: `probe103-${Date.now()}` };
  })();
}

const out: { typeofStreamInput: string; called: boolean; callResult: string; assistantText: string[]; verdict: string; note: string } = {
  typeofStreamInput: "unset", called: false, callResult: "not-called", assistantText: [], verdict: "INCONCLUSIVE", note: "",
};

const q = query({
  prompt: "Using the Bash tool, run these commands ONE AT A TIME, each as its own separate tool call, in order: `sleep 4 && echo step-A`, then `sleep 4 && echo step-B`, then `sleep 4 && echo step-C`, then `sleep 4 && echo step-D`. After all four, reply with exactly: finished-all-steps",
  options: { cwd, permissionMode: "bypassPermissions", model: "claude-haiku-4-5-20251001", settingSources: [], includePartialMessages: true },
});
out.typeofStreamInput = typeof (q as any).streamInput;

let steerTimer: ReturnType<typeof setTimeout> | undefined;
const armSteer = () => {
  if (steerTimer || out.called) return;
  steerTimer = setTimeout(async () => {
    out.called = true;
    try {
      await (q as any).streamInput(oneShot("Do NOT run any more commands. Abandon the remaining steps immediately and reply with exactly one word: steered"));
      out.callResult = "resolved";
    } catch (e: any) { out.callResult = `threw: ${e?.message ?? e}`; }
  }, STEER_AFTER_MS);
};

const deadline = setTimeout(() => { out.note = "deadline hit"; finish(); }, DEADLINE_MS);
function finish(): void {
  clearTimeout(deadline); if (steerTimer) clearTimeout(steerTimer);
  const all = out.assistantText.join("\n");
  const steered = /steered/i.test(all);
  const ranAllSteps = /finished-all-steps/.test(all);
  if (out.typeofStreamInput !== "function") out.verdict = "DEAD (method absent)";
  else if (!out.called) out.verdict = "INCONCLUSIVE (steer never fired — turn still too fast)";
  else if (out.callResult.startsWith("threw")) out.verdict = "DEAD (call rejected)";
  else if (steered) out.verdict = "ALIVE (injection influenced the turn)";
  else if (out.callResult === "resolved" && ranAllSteps) out.verdict = "DEAD-EFFECT (accepted but no influence on the running turn)";
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

(async () => {
  for await (const m of q as any) {
    if (m.type === "stream_event") { armSteer(); continue; }   // first partial = the turn is producing output
    if (m.type === "assistant") {
      const blocks = m.message?.content;
      if (Array.isArray(blocks)) for (const b of blocks) if (b?.type === "text") { out.assistantText.push(b.text); armSteer(); }
    }
    if (m.type === "result") { out.note = `result subtype=${m.subtype}`; break; }
  }
  finish();
})().catch((e) => { out.note = `iteration threw: ${e?.message ?? e}`; finish(); });
