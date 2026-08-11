// tui/test/live/resume-replay.e2e.test.ts — gated: a real session's persisted transcript, read back via the
// real getSessionMessages and retained by replayDocument, contains the original prompt once projected.
// Proves the real persisted-shape → retained-source → projection pipeline end-to-end (no UI). Skips cleanly keyless.
import { describe, it, expect } from "vitest";
import { openSession, getSessionMessages } from "../../../src/index.js";
import { replayDocument } from "../../../src/tui/replay.js";
import { projectCompact } from "../../../src/tui/toolRenderer.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("resume replay (live)", () => {
  it("replays a real session's prior prompt from getSessionMessages", async () => {
    const cwd = process.cwd();
    const session = openSession({ permissionMode: "bypassPermissions", cwd });
    const marker = "PUMPKIN-spire";
    try {
      await session.submit(`Reply with exactly the word ${marker} and nothing else.`, () => {});
      const id = session.sessionId;
      expect(id).toBeTruthy();
      const msgs = await getSessionMessages(id as string, { cwd } as any);
      const document = replayDocument(msgs, { id });
      const text = JSON.stringify(projectCompact(document, { cwd, home: cwd, platform: process.platform, columns: 100, now: 0 }));
      expect(text).toContain(marker);
      expect(text).toContain("resumed here · live");
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
