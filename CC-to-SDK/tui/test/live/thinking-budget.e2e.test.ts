// tui/test/live/thinking-budget.e2e.test.ts — gated: proves the lever /think drives end-to-end on the lib
// Session path. setMaxThinkingTokens(0) → a reasoning turn emits NO thinking blocks; a high budget → thinking
// returns (mirrors probe 25's detection). Skips keyless.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const reason = "Reason step by step, then answer: if a train travels 60 km in 45 minutes, what is its speed in km/h? Show your reasoning.";
function countThinking(msgs: any[]): number {
  let n = 0;
  for (const m of msgs) if (m?.type === "assistant") for (const b of m.message?.content ?? []) if (b?.type === "thinking") n++;
  return n;
}

live("thinking budget control (live)", () => {
  it("setMaxThinkingTokens(0) disables thinking; a high budget enables it", async () => {
    const session = openSession({ model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: process.cwd() } as any);
    try {
      const off: any[] = [];
      await session.setMaxThinkingTokens(0);
      await session.submit(reason, (m: unknown) => off.push(m));
      expect(countThinking(off)).toBe(0);                  // off → no thinking blocks

      const on: any[] = [];
      await session.setMaxThinkingTokens(16000);
      await session.submit(reason, (m: unknown) => on.push(m));
      expect(countThinking(on)).toBeGreaterThan(0);        // high → thinking returns
    } finally {
      await session.dispose();
    }
  }, 120_000);
});
