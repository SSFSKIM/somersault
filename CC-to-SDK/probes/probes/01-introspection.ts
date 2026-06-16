// Probe 01 — introspection: built-in tools, command/model/agent enumeration,
// MCP status, context-usage. Confirms Query introspection methods are live.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const q = query({
  prompt: "Reply OK",
  options: { maxTurns: 1, permissionMode: "bypassPermissions" },
});

let systemInit: any;
const names = (arr: any[], key = "name") =>
  Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? x : x?.[key])).filter(Boolean) : [];

// Drive iteration; capture init then call Query methods right after.
let calledMethods = false;
let methods: Record<string, any> = {};
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    systemInit = m;
    // Call introspection methods immediately after init.
    try { methods.supportedCommands = await q.supportedCommands(); } catch (e: any) { methods.supportedCommands = `ERR ${e.message}`; }
    try { methods.supportedModels = await q.supportedModels(); } catch (e: any) { methods.supportedModels = `ERR ${e.message}`; }
    try { methods.supportedAgents = await q.supportedAgents(); } catch (e: any) { methods.supportedAgents = `ERR ${e.message}`; }
    try { methods.mcpServerStatus = await q.mcpServerStatus(); } catch (e: any) { methods.mcpServerStatus = `ERR ${e.message}`; }
    try { methods.getContextUsage = await q.getContextUsage(); } catch (e: any) { methods.getContextUsage = `ERR ${e.message}`; }
    calledMethods = true;
  }
  if ("result" in m) break;
}

console.log("=== PROBE 01 introspection ===");
console.log("init.model:", systemInit?.model);
console.log("init.apiKeySource:", systemInit?.apiKeySource);
console.log("init.tools.count:", systemInit?.tools?.length, "sample:", brief(names(systemInit?.tools).slice(0, 8)));
console.log("init.slash_commands.count:", systemInit?.slash_commands?.length, "sample:", brief((systemInit?.slash_commands || []).slice(0, 6)));
console.log("init.mcp_servers:", brief(systemInit?.mcp_servers));
console.log("init.agents:", brief(systemInit?.agents));

const sc = methods.supportedCommands;
const sm = methods.supportedModels;
const sa = methods.supportedAgents;
const ms = methods.mcpServerStatus;
const cu = methods.getContextUsage;
console.log("supportedCommands():", Array.isArray(sc) ? `${sc.length} cmds, sample ${brief(names(sc).slice(0,6))}` : brief(sc));
console.log("supportedModels():", Array.isArray(sm) ? `${sm.length} models, sample ${brief(names(sm).slice(0,5))}` : brief(sm));
console.log("supportedAgents():", Array.isArray(sa) ? `${sa.length} agents, sample ${brief(names(sa).slice(0,6))}` : brief(sa));
console.log("mcpServerStatus():", Array.isArray(ms) ? `${ms.length} servers ${brief(ms)}` : brief(ms));
console.log("getContextUsage():", brief(cu, 400));

const pass =
  calledMethods &&
  (systemInit?.tools?.length ?? 0) > 0 &&
  Array.isArray(sc) && sc.length > 0 &&
  Array.isArray(sm) && sm.length > 0 &&
  Array.isArray(sa) &&
  Array.isArray(ms) &&
  cu != null && !String(cu).startsWith("ERR");
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
