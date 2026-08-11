// tui/test/live/chat-stream.e2e.test.ts — gated: real turn through openSession({includePartialMessages:true}).
import { describe, it, expect } from "vitest";
import { openSession } from "../../../src/index.js";
import { LiveTurn } from "../../../src/tui/liveTurn.js";
import { TranscriptDocument } from "../../../src/tui/transcriptModel.js";
import { projectCompact } from "../../../src/tui/toolRenderer.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("chat live streaming (live)", () => {
  it("streams ≥2 growing snapshots, finalizes the answer, and captures the model", async () => {
    const session = openSession({ permissionMode: "bypassPermissions", includePartialMessages: true });
    try {
      const lt = new LiveTurn();
      const doc = new TranscriptDocument();
      const snaps: string[] = [];
      await session.submit("Reply with exactly the single word PINECONE and nothing else.", (m) => {
        lt.ingest(m); snaps.push(lt.snapshot().map((l) => l.text).join("\n")); doc.appendSdk("host", m as Record<string, unknown>);
      });
      const distinct = new Set(snaps.filter((s) => s.length));
      // The finalized answer lives in the retained document now — the live reducer only ever held partials.
      const finalText = JSON.stringify(projectCompact(doc, { cwd: process.cwd(), home: process.cwd(), platform: process.platform, columns: 100, now: 0 }));
      expect(distinct.size).toBeGreaterThanOrEqual(2);        // proves live growth (not one batch render)
      expect(finalText).toContain("PINECONE");
      expect(lt.model).toBeTruthy();                          // feeds the status bar
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
