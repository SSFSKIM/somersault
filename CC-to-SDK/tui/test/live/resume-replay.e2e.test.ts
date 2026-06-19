// tui/test/live/resume-replay.e2e.test.ts — gated: a real session's persisted transcript, read back via the
// real getSessionMessages and rendered by replayLines, contains the original prompt. Proves the real
// persisted-shape → replay pipeline end-to-end (no UI). Skips cleanly keyless.
import { describe, it, expect } from "vitest";
import { openSession, getSessionMessages } from "cc-harness";
import { replayLines } from "../../src/replay.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

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
      const text = replayLines(msgs, { id }).map((l) => l.text).join("\n");
      expect(text).toContain(marker);                    // the prior prompt is in the replay
      expect(text).toContain("resumed here · live");     // framed
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
