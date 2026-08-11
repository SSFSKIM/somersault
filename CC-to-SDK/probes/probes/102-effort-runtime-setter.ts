// probes/probes/102-effort-runtime-setter.ts — Wave C EP-C6 (plan-review Critical #1):
// the SDK has NO setEffort; the only runtime effort hook is Query.applyFlagSettings({effortLevel})
// (sdk.d.ts:2373, streaming-input-only). Declared ≠ reachable: does the call resolve headlessly,
// is a bad value rejected, and does the session keep working after the flip?
// (v1 of this probe released every input gate upfront, exhausting the generator and closing the
//  transport's write side — setModel "failed" identically, exposing the harness bug. Per-message
//  gates below keep the input stream open across the control calls.)
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; npx tsx probes/102-effort-runtime-setter.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const gates: Array<() => void> = [];
const waits: Array<Promise<void>> = [];
for (let i = 0; i < 2; i++) waits.push(new Promise<void>(r => gates.push(r)));

async function* input() {
  const msgs = ["Reply with exactly one word: ALPHA", "Reply with exactly one word: BETA"];
  for (let i = 0; i < msgs.length; i++) {
    await waits[i];
    yield { type: "user" as const, message: { role: "user" as const, content: msgs[i] }, parent_tool_use_id: null, session_id: "x" };
  }
}

(async () => {
  console.log("=== probe 102: applyFlagSettings({effortLevel}) runtime reachability (v2) ===");
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.log("ABORT: no token in env"); process.exit(1); }

  const q = query({ prompt: input(), options: { model: "claude-opus-4-8", maxTurns: 8 } as any });
  gates[0]();
  let turn = 0;
  for await (const msg of q as any) {
    if (msg.type === "result") {
      turn++;
      console.log(`[turn ${turn}] subtype=${msg.subtype}`);
      if (turn === 1) {
        try {
          await (q as any).setModel("claude-opus-4-8");
          console.log("CONTROL: setModel RESOLVED (control channel alive)");
        } catch (e) { console.log("CONTROL: setModel THREW:", (e as Error).message.slice(0, 100)); }
        try {
          await (q as any).applyFlagSettings({ effortLevel: "low" });
          console.log("applyFlagSettings({effortLevel:'low'}) RESOLVED");
        } catch (e) { console.log("applyFlagSettings THREW:", (e as Error).message.slice(0, 100)); }
        try {
          await (q as any).applyFlagSettings({ effortLevel: "bogus" });
          console.log("bogus value RESOLVED (no validation!)");
        } catch (e) { console.log("bogus value THREW (validated):", (e as Error).message.slice(0, 140)); }
        gates[1]();
      }
      if (turn === 2) break;
    }
  }
  console.log("done: turn 2 completed after the runtime effort flip");
  process.exit(0);
})();
