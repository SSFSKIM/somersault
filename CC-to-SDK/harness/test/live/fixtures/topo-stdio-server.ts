// Minimal stdio MCP server for the W3.5 live test (probe-52b shape): one tool returning its pid,
// so reconnect is verifiable as a pid change. Spawned by the CLI subprocess via setMcpServers.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "topolive", version: "1.0.0" });
server.registerTool("topoCanary", { description: "Returns OK plus the server pid." }, async () => (
  { content: [{ type: "text", text: `OK pid=${process.pid}` }] }
));
await server.connect(new StdioServerTransport());
