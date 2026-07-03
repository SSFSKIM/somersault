// Hand-rolled MCP stdio server: JSON-RPC 2.0, newline-delimited, tools-only capability.
export function createMcpServer({ name, version, tools, sink }) {
  return { name, version, tools, sink, buf: "" };
}
function reply(srv, id, result) { srv.sink({ jsonrpc: "2.0", id, result }); }
function replyError(srv, id, code, message) { srv.sink({ jsonrpc: "2.0", id, error: { code, message } }); }

export function handleLine(srv, line) {
  const t = line.trim(); if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { console.error("[claude-companion] bad json:", t.slice(0, 200)); return; }
  const { id, method, params } = msg;
  if (method === undefined) return;                       // response to us — none expected
  if (id === undefined || id === null) return;            // notification (initialized etc.) — ignore
  switch (method) {
    case "initialize":
      return reply(srv, id, { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: srv.name, version: srv.version } });
    case "ping": return reply(srv, id, {});
    case "tools/list":
      return reply(srv, id, { tools: srv.tools.map((t2) => ({ name: t2.name, description: t2.description, inputSchema: t2.inputSchema })) });
    case "tools/call": {
      const tool = srv.tools.find((t2) => t2.name === params?.name);
      if (!tool) return replyError(srv, id, -32602, `unknown tool: ${params?.name}`);
      void tool.handler(params?.arguments ?? {}).then(
        (text) => reply(srv, id, { content: [{ type: "text", text }] }),
        (e) => reply(srv, id, { content: [{ type: "text", text: `claude-companion error: ${e?.message ?? e}` }], isError: true }),
      );
      return;
    }
    default: return replyError(srv, id, -32601, `method not found: ${method}`);
  }
}

export function runMcpServer(srv, io = { stdin: process.stdin, stdout: process.stdout }) {
  srv.sink = (o) => io.stdout.write(JSON.stringify(o) + "\n");
  io.stdin.on("data", (c) => { srv.buf += c.toString(); let nl; while ((nl = srv.buf.indexOf("\n")) >= 0) { const l = srv.buf.slice(0, nl); srv.buf = srv.buf.slice(nl + 1); handleLine(srv, l); } });
  io.stdin.resume();
}
