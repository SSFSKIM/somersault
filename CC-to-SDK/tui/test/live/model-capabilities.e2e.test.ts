// tui/test/live/model-capabilities.e2e.test.ts — gated: the /model picker's data source works end-to-end.
// capabilities() returns a non-empty model list (incl. claude-opus-4-8), and setModel to a picked value takes
// effect (a subsequent turn completes). Skips keyless. Run keyed:
//   set -a; . ../.env; set +a; npx vitest run test/live/model-capabilities.e2e.test.ts
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("model capabilities (live)", () => {
  it("capabilities() lists models incl. opus-4-8; setModel to a picked value takes effect", async () => {
    const session = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
    try {
      await session.submit("Reply with exactly the single word READY.", () => {});   // initialize the control handle
      const caps = await session.capabilities();
      const values = (caps.models as any[]).map((m) => String(m.value));
      expect(values.length).toBeGreaterThan(0);
      expect(values).toContain("claude-opus-4-8");
      await session.setModel("sonnet");
      const res = await session.submit("Reply with exactly the single word AGAIN.", () => {});
      expect(String((res as { result: unknown }).result)).toMatch(/AGAIN/i);
    } finally {
      await session.dispose();
    }
  }, 120_000);
});
