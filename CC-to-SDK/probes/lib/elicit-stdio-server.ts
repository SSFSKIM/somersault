// Minimal stdio MCP server for probe 43b: one tool that raises a form elicitation and returns the
// result. Spawned BY THE CLI (not in-process) so the CLI's own MCP client answers the capability
// handshake — the path probe 43 proved SDK-type servers cannot take.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "probeelicit", version: "1.0.0" });
server.registerTool("needsInput", { description: "Asks the user for their name via elicitation, returns it." }, async () => {
  const res = await server.server.elicitInput({
    message: "Probe: what is your name?",
    requestedSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  });
  return { content: [{ type: "text", text: `ELICITED:${JSON.stringify(res)}` }] };
});
await server.connect(new StdioServerTransport());
