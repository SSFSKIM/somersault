// tui/test/live/chat.e2e.test.ts — real in-process Session in default mode + a programmatic broker that
// auto-allows; a prompt that triggers a tool; assert the turn completes and the broker was consulted.
// Gated on ANTHROPIC_API_KEY (skips cleanly without it). Run keyed:
//   set -a; . ../.env; set +a; npx vitest run test/live/chat.e2e.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession } from "cc-harness";
import { createUiBroker } from "../../src/uiBroker.js";
import { renderMessage } from "../../src/render.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("chat REPL e2e (live)", () => {
  it("streams a turn; the broker sees the Edit and the file changes after allow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-e2e-"));
    writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
    const ui = createUiBroker();
    const seen: string[] = [];
    ui.setHandler(async (req) => { seen.push(req.toolName); return { kind: "allow_once" }; });
    const session = openSession({ model: "claude-haiku-4-5-20251001", cwd: dir, permissionMode: "default", permissionBroker: ui.broker, maxTurns: 6 });
    try {
      const lines: string[] = [];
      const { result } = await session.submit("Edit note.txt, replacing ORIGINAL with CHANGED. Then say done.", (m) => { for (const l of renderMessage(m)) lines.push(l.text); });
      expect(result).toBeTruthy();
      expect(seen).toContain("Edit");
      expect(readFileSync(join(dir, "note.txt"), "utf8")).toContain("CHANGED");
    } finally { await session.dispose(); }
  }, 90_000);
});
