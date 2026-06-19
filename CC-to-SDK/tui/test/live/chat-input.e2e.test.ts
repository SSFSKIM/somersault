// tui/test/live/chat-input.e2e.test.ts — gated: a multi-line prompt string flows through Session.submit intact
// and the turn completes. Thin by design (no new SDK surface) — guards the one integration claim.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat input ergonomics (live)", () => {
  it("submits a two-line prompt and completes a turn", async () => {
    const session = openSession({ permissionMode: "bypassPermissions" });
    try {
      const res = await session.submit("Reply with exactly the single word READY.\nOutput nothing else.", () => {});
      expect(String((res as { result: unknown }).result)).toMatch(/READY/i);
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
