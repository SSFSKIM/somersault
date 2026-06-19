// tui/test/live/chat-stream.e2e.test.ts — gated: real turn through openSession({includePartialMessages:true}).
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";
import { LiveTurn } from "../../src/liveTurn.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat live streaming (live)", () => {
  it("streams ≥2 growing snapshots, finalizes the answer, and captures the model", async () => {
    const session = openSession({ permissionMode: "bypassPermissions", includePartialMessages: true });
    try {
      const lt = new LiveTurn();
      const snaps: string[] = [];
      await session.submit("Reply with exactly the single word PINECONE and nothing else.", (m) => {
        lt.ingest(m); snaps.push(lt.snapshot().map((l) => l.text).join("\n"));
      });
      const distinct = new Set(snaps.filter((s) => s.length));
      const finalText = lt.finalize().map((l) => l.text).join("\n");
      expect(distinct.size).toBeGreaterThanOrEqual(2);        // proves live growth (not one batch render)
      expect(finalText).toContain("PINECONE");
      expect(lt.model).toBeTruthy();                          // feeds the status bar
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
