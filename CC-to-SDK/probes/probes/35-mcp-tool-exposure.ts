// Probe 35 — MCP TOOL EXPOSURE: inline vs tool-search deferral.
// Question: when we register an in-process SDK MCP tool and allowlist it, does the SDK send its
// definition INLINE in the model's tool list, or hide it behind a ToolSearch-style deferral catalog
// (the mechanism the interactive Claude Code CLI uses to keep context lean with large tool sets)?
//
// Method — two independent signals:
//   1) STRUCTURAL: the system/init frame carries `tools: string[]` (the names the model is handed) and
//      `mcp_servers`. If our `mcp__probedefer__deferralCanary` is listed there, it is INLINE. If it is
//      absent AND a ToolSearch-like tool is present, the SDK is deferring it.
//   2) BEHAVIORAL: ask the model to call it. If its FIRST tool_use is our tool, it saw it directly
//      (inline). If it must call a search/discovery tool first, that is deferral in action.
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-haiku-4-5-20251001";
const TOOL_ID = "mcp__probedefer__deferralCanary";
const isSearchTool = (n: string) => /toolsearch|tool_search|search.*tool/i.test(n);

let handlerRan = false;
const server = createSdkMcpServer({
  name: "probedefer",
  tools: [
    tool("deferralCanary", "A unique canary tool. Returns the word CANARY when called.",
      { note: z.string().optional() },
      async () => { handlerRan = true; return { content: [{ type: "text", text: "CANARY" }] }; }),
  ],
});

const toolUseOrder: string[] = [];
let initTools: string[] | undefined;
let initMcp: unknown;
let initKeys: string[] = [];
let initResult: any;

const q = query({
  prompt: "Call the deferralCanary tool once (note can be anything), then reply with just the word DONE.",
  options: { model: MODEL, maxTurns: 5, permissionMode: "bypassPermissions",
    mcpServers: { probedefer: server }, allowedTools: [TOOL_ID] },
});

for await (const m of q) {
  const mm = m as any;
  if (mm.type === "system" && mm.subtype === "init") {
    initKeys = Object.keys(mm);
    initTools = Array.isArray(mm.tools) ? mm.tools : undefined;
    initMcp = mm.mcp_servers;
    try { initResult = await (q as any).initializationResult(); } catch (e: any) { initResult = `ERR ${e.message}`; }
  }
  if (mm.type === "assistant") {
    for (const b of mm.message?.content || []) if (b.type === "tool_use") toolUseOrder.push(String(b.name));
  }
}

console.log("=== PROBE 35 mcp-tool-exposure ===  model:", MODEL);
console.log("init keys:", brief(initKeys, 300));
console.log("init.tools count:", initTools?.length ?? "n/a");
console.log("init.tools:", brief(initTools, 1200));
console.log("init.mcp_servers:", brief(initMcp, 300));
console.log("initializationResult keys:", initResult && typeof initResult === "object" ? brief(Object.keys(initResult)) : brief(initResult));

const ourToolListed = !!initTools?.includes(TOOL_ID);
const searchToolListed = (initTools ?? []).some(isSearchTool);
const calledOurTool = toolUseOrder.some((n) => n.includes("deferralCanary"));
const firstCallIsOurs = toolUseOrder[0]?.includes("deferralCanary") ?? false;
const searchCalledFirst = toolUseOrder.length > 0 && isSearchTool(toolUseOrder[0]);

console.log("--- signals ---");
console.log("our tool in init.tools (INLINE signal):", ourToolListed);
console.log("ToolSearch-like tool in init.tools (DEFERRAL machinery):", searchToolListed);
console.log("tool_use order:", brief(toolUseOrder, 300));
console.log("handlerRan:", handlerRan, "| model called our tool:", calledOurTool, "| first call was ours:", firstCallIsOurs, "| a search tool was called first:", searchCalledFirst);

const verdict = ourToolListed && !searchCalledFirst ? "INLINE (no deferral — tool handed to the model directly)"
  : !ourToolListed && (searchToolListed || searchCalledFirst) ? "DEFERRED (behind a ToolSearch-style catalog)"
  : "INCONCLUSIVE (read raw signals above)";
console.log("VERDICT:", verdict);

// PASS = we obtained a decisive structural reading AND the tool actually fired (end-to-end reachable).
const pass = initTools !== undefined && handlerRan && calledOurTool;
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
