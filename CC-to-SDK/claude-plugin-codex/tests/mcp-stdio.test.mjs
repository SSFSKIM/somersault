import test from "node:test"; import assert from "node:assert/strict";
import { createMcpServer, handleLine } from "../plugins/claude/scripts/lib/mcp-stdio.mjs";

function mkServer(out) {
  return createMcpServer({ name: "claude-companion", version: "0.1.0", sink: (o) => out.push(o),
    tools: [{ name: "echo", description: "echoes", inputSchema: { type: "object", properties: { text: { type: "string" } } }, handler: async (a) => `you said ${a.text}` }] });
}
test("initialize → tools/list → tools/call round-trip", async () => {
  const out = []; const srv = mkServer(out);
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex" } } }));
  assert.equal(out[0].id, 1); assert.equal(out[0].result.serverInfo.name, "claude-companion"); assert.equal(out[0].result.protocolVersion, "2025-06-18");
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  assert.equal(out[1].result.tools[0].name, "echo");
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(out[2].result.content, [{ type: "text", text: "you said hi" }]);
});
test("unknown method → -32601; handler throw → isError content", async () => {
  const out = []; const srv = mkServer(out);
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 9, method: "nope" }));
  assert.equal(out[0].error.code, -32601);
});
