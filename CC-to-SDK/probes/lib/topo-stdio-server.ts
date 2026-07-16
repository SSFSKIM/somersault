// Minimal stdio MCP server for probe 52b: one plain tool, no elicitation. Spawned by the CLI
// subprocess so toggle/reconnect exercise the process-managed path SDK-type servers can't take.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "probetopo", version: "1.0.0" });
server.registerTool("topoCanary", { description: "Returns OK plus the server pid." }, async () => (
  { content: [{ type: "text", text: `OK pid=${process.pid}` }] }
));
await server.connect(new StdioServerTransport());
