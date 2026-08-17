// Minimal STDIO MCP server for the M4 acceptance's elicitation leg (spec acceptance 7): one tool that
// raises a form elicitation and returns the ElicitResult it got back inside its own text content.
//
// STDIO IS THE WHOLE POINT. An in-process SDK-type server answers "Client does not support form
// elicitation" (probe 43) — the CLI's own MCP client is the real elicitation counterparty, which is why
// probe 43b exists at all. This file is that probe's shape COPIED rather than imported: `probes/` is a
// separate npm workspace, and a live test reaching across that boundary would couple the harness's test
// run to another package's install state.
//
// ONE LINE OF CONTENT, deliberately: the app server's item mapper keeps only the first non-empty line of a
// tool result (`items/mapper.ts`'s `firstResultLine`), so a pretty-printed receipt would hide the very
// answer the acceptance reads back off the wire.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "m4elicit", version: "1.0.0" });
server.registerTool("needsInput", { description: "Asks the user for a codename via elicitation, then returns it." }, async () => {
  const res = await server.server.elicitInput({
    message: "M4 acceptance: what codename should this run use?",
    requestedSchema: { type: "object", properties: { codename: { type: "string" } }, required: ["codename"] },
  });
  return { content: [{ type: "text", text: `ELICITED:${JSON.stringify(res)}` }] };
});
await server.connect(new StdioServerTransport());
