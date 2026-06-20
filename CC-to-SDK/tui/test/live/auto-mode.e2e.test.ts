// tui/test/live/auto-mode.e2e.test.ts — gated: a session opened in `auto` on an UNSUPPORTED model (haiku) has
// its model force-upgraded by resolveOptions (Task 1), so the classifier is effective end-to-end: a safe
// working-dir write applies and the permission broker is NEVER consulted (probe 24-P1 + Part-1 gate). Skips keyless.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("auto mode (live)", () => {
  it("auto applies a safe write without consulting the broker (model force-upgraded)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "auto-e2e-"));
    const requests: string[] = [];
    const broker = { async request(r: any) { requests.push(r.toolName); return { kind: "allow" as const }; } };
    const session = openSession({ permissionMode: "auto", model: "claude-haiku-4-5", cwd, permissionBroker: broker } as any);
    try {
      await session.submit("Use the Write tool to create a file named marker.txt containing exactly the word DONE. Then reply OK.", () => {});
      expect(existsSync(join(cwd, "marker.txt"))).toBe(true);    // auto allowed the safe write
      expect(requests).toEqual([]);                              // broker NEVER consulted — classifier handled it
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
