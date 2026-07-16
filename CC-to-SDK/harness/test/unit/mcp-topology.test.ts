import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { connectDaemon } from "../../src/daemon/connect.js";
import { daemonOp } from "../../src/daemon/types.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// generator-object carrying the W3.5 Query control methods (session-wave1 methodQuery pattern)
function methodQuery(rec: any) {
  return ({ prompt }: any) => {
    const it: any = (async function* () { for await (const t of prompt) yield { type: "result", subtype: "success", result: "did:" + t.message.content }; })();
    it.setMcpServers = async (servers: any) => { rec.set = servers; return { added: Object.keys(servers), removed: [], errors: {} }; };
    it.toggleMcpServer = async (name: string, enabled: boolean) => { rec.toggle = { name, enabled }; };
    it.reconnectMcpServer = async (name: string) => { rec.reconnect = name; };
    it.mcpServerStatus = async () => [{ name: "a", status: "connected" }];
    it.setMcpPermissionModeOverride = async (name: string, mode: string | null) => { rec.override = { name, mode }; return {}; };
    return it;
  };
}

describe("Session MCP topology methods (W3.5)", () => {
  it("delegates the trio + status + mode override to the query control methods", async () => {
    const rec: any = {};
    const s = new Session({ query: methodQuery(rec) }, {});
    expect(await s.setMcpServers({ x: { type: "stdio", command: "c" } })).toEqual({ added: ["x"], removed: [], errors: {} });
    expect(rec.set.x.command).toBe("c");
    await s.toggleMcpServer("x", false);
    expect(rec.toggle).toEqual({ name: "x", enabled: false });
    await s.reconnectMcpServer("x");
    expect(rec.reconnect).toBe("x");
    expect(await s.mcpServerStatus()).toEqual([{ name: "a", status: "connected" }]);
    await s.setMcpPermissionModeOverride("x", "auto");
    expect(rec.override).toEqual({ name: "x", mode: "auto" });
    await s.dispose();
  });

  it("rejects cleanly when the query lacks the methods (older SDK)", async () => {
    const s = new Session({ query: ({ prompt }: any) => (async function* () { for await (const t of prompt) yield { type: "result", subtype: "success", result: String(t) }; })() }, {});
    await expect(s.setMcpServers({})).rejects.toThrow("unsupported: setMcpServers");
    await expect(s.mcpServerStatus()).rejects.toThrow("unsupported: mcpServerStatus");
    await s.dispose();
  });
});

describe("daemon MCP topology ops (W3.5)", () => {
  it("op schema accepts the five new ops and rejects malformed ones", () => {
    expect(daemonOp.parse({ op: "mcp_status", id: "s1" }).op).toBe("mcp_status");
    expect(daemonOp.parse({ op: "mcp_set_servers", id: "s1", servers: { x: { type: "stdio", command: "c" } } }).op).toBe("mcp_set_servers");
    expect(daemonOp.parse({ op: "mcp_toggle", id: "s1", name: "x", enabled: true }).op).toBe("mcp_toggle");
    expect(daemonOp.parse({ op: "mcp_reconnect", id: "s1", name: "x" }).op).toBe("mcp_reconnect");
    expect(daemonOp.parse({ op: "mcp_mode_override", id: "s1", name: "x", mode: null }).op).toBe("mcp_mode_override");
    expect(() => daemonOp.parse({ op: "mcp_toggle", id: "s1", name: "x" })).toThrow(); // missing enabled
  });

  it("supervisor rejects SDK-type configs before touching the session", async () => {
    const sup = new DaemonSupervisor({ query: methodQuery({}) as any }, { dir: mkdtempSync(join(tmpdir(), "mcp-topo-")) });
    await expect(sup.setMcpServers("whatever", { bad: { type: "sdk", name: "bad" } }))
      .rejects.toThrow("SDK-type (in-process) servers cannot be set over the daemon wire");
    await expect(sup.setMcpServers("nope", { ok: { type: "stdio", command: "c" } }))
      .rejects.toThrow("unknown session nope"); // clean config falls through to liveness
    await sup.shutdown();
  });

  it("client methods map to the wire ops", async () => {
    const seen: any[] = [];
    const fake = async (_p: string, op: any) => { seen.push(op); return [{ ok: true, servers: [1], result: { added: ["x"], removed: [], errors: {} } }]; };
    const c = connectDaemon("/tmp/nope.sock", fake as any);
    expect(await c.mcpStatus("s1")).toEqual([1]);
    expect((await c.mcpSetServers("s1", { x: { type: "stdio" } })).added).toEqual(["x"]);
    await c.mcpToggle("s1", "x", false);
    await c.mcpReconnect("s1", "x");
    await c.mcpModeOverride("s1", "x", "auto");
    expect(seen.map((o) => o.op)).toEqual(["mcp_status", "mcp_set_servers", "mcp_toggle", "mcp_reconnect", "mcp_mode_override"]);
    expect(seen[2]).toMatchObject({ id: "s1", name: "x", enabled: false });
    expect(seen[4]).toMatchObject({ id: "s1", name: "x", mode: "auto" });
  });
});
