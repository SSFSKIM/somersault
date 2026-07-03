import { createMcpServer, runMcpServer } from "./lib/mcp-stdio.mjs";
const tools = [{
  name: "setup", description: "Report claude-companion runtime environment (scaffold stub).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => JSON.stringify({ cwd: process.cwd(), node: process.version,
    env: { HOME: !!process.env.HOME, PATH: !!process.env.PATH, CLAUDE_CODE_OAUTH_TOKEN: !!process.env.CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY, CLAUDE_COMPANION_APPSERVER: process.env.CLAUDE_COMPANION_APPSERVER ?? null } }, null, 2),
}];
runMcpServer(createMcpServer({ name: "claude-companion", version: "0.1.0", tools }));
