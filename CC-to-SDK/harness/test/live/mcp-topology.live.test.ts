// W3.5 live: runtime MCP topology through the Session API (probe-52b shape) — dynamic add via
// setMcpServers, tool callable, reconnect respawns (pid change), remove disconnects.
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSession } from "../../src/session/index.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;
const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "fixtures", "topo-stdio-server.ts");
const tsxBin = join(here, "..", "..", "node_modules", ".bin", "tsx");

const CALL = "Call the topoCanary tool once (find it via ToolSearch if needed). Reply with exactly what it returned.";
const pidOf = (r: unknown) => /pid=(\d+)/.exec(String(r))?.[1];

live("runtime MCP topology (live)", () => {
  it("adds a stdio server mid-session, reconnects it (pid change), removes it", async () => {
    const s = openSession({ model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 12 });
    try {
      await s.submit("Reply with exactly: READY"); // control channel live
      const add = await s.setMcpServers({ topolive: { type: "stdio", command: tsxBin, args: [serverPath] } });
      expect(add.added).toEqual(["topolive"]);
      expect(add.errors).toEqual({});
      const status = await s.mcpServerStatus() as { name: string }[];
      expect(status.some((x) => x.name === "topolive")).toBe(true);

      const r1 = await s.submit(CALL);
      const pid1 = pidOf(r1.result);
      expect(pid1).toBeTruthy();

      await s.reconnectMcpServer("topolive");
      const r2 = await s.submit(CALL);
      const pid2 = pidOf(r2.result);
      expect(pid2).toBeTruthy();
      expect(pid2).not.toBe(pid1); // respawned

      const rm = await s.setMcpServers({});
      expect(rm.removed).toEqual(["topolive"]);
    } finally { await s.dispose(); }
  }, 240_000);
});
