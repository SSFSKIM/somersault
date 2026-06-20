import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor, DaemonServer, connectDaemon } from "cc-harness";

// gates exactly like the harness live suites: no key → skip cleanly
const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("console ↔ real daemon (connectDaemon e2e)", () => {
  it("spawns, submits, streams assistant text, then stops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-console-e2e-"));
    const sock = join(dir, "sock");
    const sup = new DaemonSupervisor({ query }, { dir: join(dir, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    try {
      const c = connectDaemon(sock);
      const id = await c.spawn({ model: "claude-haiku-4-5-20251001" });
      let text = "";
      await c.submit(id, "Reply with exactly the word: pong", (m: any) => {
        if (m?.type === "assistant") for (const b of m.message?.content ?? []) if (b.type === "text") text += b.text;
      });
      expect(text.toLowerCase()).toContain("pong");
      await c.stop(id);
    } finally {
      const { daemonRequest } = await import("cc-harness");
      await daemonRequest(sock, { op: "shutdown" }).catch(() => {});
      await server.closed;
    }
  }, 90_000);
});
