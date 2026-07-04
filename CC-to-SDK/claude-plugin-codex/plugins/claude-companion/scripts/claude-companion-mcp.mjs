import { createMcpServer, runMcpServer } from "./lib/mcp-stdio.mjs";
import { createCompanion } from "./lib/companion.mjs";
const companion = createCompanion();
const srv = createMcpServer({ name: "claude-companion", version: "0.1.0", tools: companion.tools });
runMcpServer(srv);
process.stdin.on("end", () => { void companion.dispose().finally(() => process.exit(0)); });
