// Probe 35b — CONFIRM whether our MCP tools are DEFERRED behind ToolSearch (follow-up to 35).
// Probe 35 showed init.tools lists EVERY tool name (loaded + deferred indistinguishably) and the model
// called ToolSearch BEFORE our tool. That is circumstantial. This probe is decisive:
//
//   Part A — block ToolSearch (disallowedTools), keep our MCP tool allowlisted, ask the model to call it.
//            If it STILL calls our tool and the handler runs → our tool was INLINE (reachable without the
//            search machinery). If it cannot (no call / handler never runs) → it was DEFERRED behind ToolSearch.
//
//   Part B — strip user config (settingSources: []) so no global plugins/native extras load. Re-read
//            init.tools: does ToolSearch even appear, and is the catalog smaller? Tells us whether deferral
//            is a function of catalog size / plugin load vs always-on.
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-haiku-4-5-20251001";
const TOOL_ID = "mcp__probedefer__deferralCanary";
const isSearch = (n: string) => /toolsearch|tool_search/i.test(n);
const mkServer = (ran: { v: boolean }) => createSdkMcpServer({
  name: "probedefer",
  tools: [tool("deferralCanary", "A unique canary tool. Returns CANARY when called.", { note: z.string().optional() },
    async () => { ran.v = true; return { content: [{ type: "text", text: "CANARY" }] }; })],
});

async function run(label: string, extraOpts: Record<string, unknown>) {
  const ran = { v: false };
  const order: string[] = [];
  let initTools: string[] | undefined;
  const q = query({
    prompt: "Call the deferralCanary tool once, then reply with just the word DONE.",
    options: { model: MODEL, maxTurns: 5, permissionMode: "bypassPermissions",
      mcpServers: { probedefer: mkServer(ran) }, allowedTools: [TOOL_ID], ...extraOpts },
  });
  for await (const m of q) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init" && Array.isArray(mm.tools)) initTools = mm.tools;
    if (mm.type === "assistant") for (const b of mm.message?.content || []) if (b.type === "tool_use") order.push(String(b.name));
  }
  console.log(`\n--- ${label} ---`);
  console.log("init.tools count:", initTools?.length ?? "n/a", "| ToolSearch present:", (initTools ?? []).some(isSearch), "| our tool present:", !!initTools?.includes(TOOL_ID));
  console.log("tool_use order:", brief(order, 300));
  console.log("search tool used:", order.some(isSearch), "| handler ran:", ran.v, "| our tool called:", order.some((n) => n.includes("deferralCanary")));
  return { ran: ran.v, usedSearch: order.some(isSearch), calledOurs: order.some((n) => n.includes("deferralCanary")), initTools };
}

console.log("=== PROBE 35b mcp-tool-deferral-confirm ===  model:", MODEL);

// Part A: ToolSearch blocked. If our tool is inline it stays callable; if deferred it should fail.
const a = await run("A: disallowedTools=[ToolSearch]", { disallowedTools: ["ToolSearch"] });

// Part B: no user config — minimal native catalog.
const b = await run("B: settingSources=[]", { settingSources: [] });

console.log("\n=== INTERPRETATION ===");
console.log("A: with ToolSearch blocked, handler ran:", a.ran, "(true ⇒ tool is INLINE/reachable directly; false ⇒ it was DEFERRED behind ToolSearch)");
console.log("B: clean catalog size:", b.initTools?.length ?? "n/a", "| ToolSearch present in clean config:", (b.initTools ?? []).some(isSearch));

// PASS = both runs executed and Part A gave a clean directly-reachable reading (handler ran without needing search).
const pass = a.ran && !a.usedSearch && b.ran;
console.log(pass ? "RESULT: PASS (MCP tool reachable WITHOUT ToolSearch ⇒ effectively inline)" : "RESULT: FAIL (see signals — MCP tool appears to depend on ToolSearch deferral)");
