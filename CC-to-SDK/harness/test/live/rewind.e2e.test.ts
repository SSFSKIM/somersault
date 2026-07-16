// Wave 1 live e2e: conversation rewind (resumeAt) + reinitialize + interrupt receipt.
// Probe-grounded: 37 (in-place = destructive, same sid), 37b (fork = safe branch), 38 (reinit payload).
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession, rewindSession } from "../../src/session/index.js";
import { getSessionMessages } from "../../src/sessions/reader.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const CFG = { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions" as const, settingSources: [] as [], maxTurns: 3 };
const RECALL = "List every codeword you have been told in this conversation, comma-separated, nothing else.";

live("conversation rewind (live)", () => {
  it("fork-rewind branches without touching the original; in-place rewind truncates; reinit+interrupt receipts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "rewind-live-"));
    try {
      // build: 2 turns in one session; capture the last turn-1 assistant uuid as the anchor
      const s = openSession({ ...CFG, cwd });
      const assistantUuids: string[] = [];
      await s.submit("Remember: the FIRST codeword is GRANITE. Acknowledge with exactly: OK-1",
        (m: any) => { if (m.type === "assistant" && m.uuid) assistantUuids.push(m.uuid); });
      const sid = s.sessionId!;
      const anchor = assistantUuids.at(-1)!;
      expect(sid).toBeTruthy(); expect(anchor).toBeTruthy();
      await s.submit("Remember: the SECOND codeword is BASALT. Acknowledge with exactly: OK-2");

      // W1.2 while the session is live: reinitialize returns a FRESH init payload; interrupt (idle) a receipt
      const init: any = await s.reinitialize();
      expect(init && typeof init).toBe("object");
      expect(Object.keys(init)).toEqual(expect.arrayContaining(["commands", "models", "account"]));
      const receipt: any = await s.interrupt();          // benign no-op when idle; 0.3.211 returns the receipt
      expect(receipt).toHaveProperty("still_queued");
      await s.dispose();

      // fork-rewind: anchored branch under a NEW id; original transcript intact
      const fork = rewindSession(sid, anchor, { ...CFG, cwd, fork: true });
      const forkRecall = String((await fork.submit(RECALL)).result).toUpperCase();
      expect(forkRecall).toContain("GRANITE");
      expect(forkRecall).not.toContain("BASALT");
      expect(fork.sessionId).not.toBe(sid);
      await fork.dispose();
      const original = JSON.stringify(await getSessionMessages(sid, { cwd }));
      expect(original).toContain("BASALT");              // untouched by the branch

      // in-place rewind: same sid, post-anchor context gone (destructive by design — probe 37)
      const rew = rewindSession(sid, anchor, { ...CFG, cwd });
      const recall = String((await rew.submit(RECALL)).result).toUpperCase();
      expect(recall).toContain("GRANITE");
      expect(recall).not.toContain("BASALT");
      expect(rew.sessionId).toBe(sid);
      await rew.dispose();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 180_000);
});
