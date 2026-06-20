// tui/test/live/command-catalog.e2e.test.ts — gated: the live SDK exposes a non-empty slash-command catalog
// headless (probe 30 = 105 entries; the palette is fed from this). Cheap — does NOT run a skill command (those
// are long agentic turns; a non-goal). Run keyed (OAuth bills subscription):
//   set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx vitest run test/live/command-catalog.e2e.test.ts
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("command catalog (live)", () => {
  it("capabilities().commands returns a non-empty catalog of named commands", async () => {
    const s = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
    try {
      await s.submit("Reply with exactly the single word OK.", () => {});   // prime the control channel
      const caps = await s.capabilities();
      const cmds = caps.commands as Array<{ name?: string }>;
      expect(Array.isArray(cmds)).toBe(true);
      expect(cmds.length).toBeGreaterThan(0);
      expect(typeof cmds[0]?.name).toBe("string");
    } finally {
      await s.dispose();
    }
  }, 120_000);
});
