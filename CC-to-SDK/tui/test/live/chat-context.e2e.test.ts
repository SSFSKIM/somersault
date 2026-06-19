// tui/test/live/chat-context.e2e.test.ts — gated: the /context command path against a real session.
import { describe, it, expect } from "vitest";
import { openSession, summarizeUsage } from "cc-harness";
import type { RawContextUsage } from "cc-harness";
import { formatContext } from "../../src/commands.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat /context (live)", () => {
  it("reports non-zero usage after a real turn", async () => {
    const session = openSession({ permissionMode: "bypassPermissions" });
    try {
      await session.submit("Say hello in one word.");
      const summary = summarizeUsage((await session.getContextUsage()) as RawContextUsage);
      const line = formatContext(summary).map((l) => l.text).join("");
      expect(summary.tokensUsed).toBeGreaterThan(0);
      expect(summary.maxTokens).toBeGreaterThan(0);
      expect(line).toMatch(/ctx \d+% ·/);
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
