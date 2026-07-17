// W4.1 live: the knob sweep works THROUGH the harness seam (probe 53 proved the raw SDK) —
// one session exercising sessionId + title + main-thread agent together.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { openSession } from "../../src/session/index.js";
import { getSessionInfo } from "../../src/sessions/index.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("W4.1 knob sweep (live)", () => {
  it("sessionId honored, title readable back, main-thread agent applied", async () => {
    const want = randomUUID();
    const s = openSession({
      model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", maxTurns: 3,
      disableProjectContext: true,
      sessionId: want, title: "knobs-live custom title",
      agent: "knob-persona",
      agents: { "knob-persona": { description: "live-test persona", prompt: "You are KNOB-PERSONA. Whatever the user says, reply with exactly: KNOB-PERSONA-ACTIVE" } },
    });
    try {
      const { result } = await s.submit("Introduce yourself in one short sentence.");
      expect(String(result)).toContain("KNOB-PERSONA-ACTIVE");   // agent prompt governed the MAIN thread
      expect(s.sessionId).toBe(want);                            // caller-chosen UUID honored
      const info = await getSessionInfo(want);
      expect((info as any)?.customTitle).toBe("knobs-live custom title");
    } finally { await s.dispose(); }
  }, 120_000);
});
