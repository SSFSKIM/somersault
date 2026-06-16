// Probe 08 — programmatic subagent dispatch via options.agents + Agent tool.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const messages: any[] = [];
let result: any;
let sawAgentToolUse = false;
let sawSubagentMessage = false;
let supportedHasProbe = false;

const q = query({
  prompt: "Use the probe agent to say the word HELLO. Then reply with just what it said.",
  options: {
    maxTurns: 5,
    permissionMode: "bypassPermissions",
    agents: {
      probe: {
        description: "An echoer agent that says words back",
        prompt: "You echo. When asked to say a word, reply with exactly that word.",
        tools: ["Read"],
      },
    },
    allowedTools: ["Agent"],
  },
});

let checkedAgents = false;
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init" && !checkedAgents) {
    checkedAgents = true;
    try {
      const sa = await q.supportedAgents();
      supportedHasProbe = (sa || []).some((a: any) => (a?.name || a) === "probe");
    } catch { /* ignore */ }
  }
  messages.push(m);
  if (m.type === "assistant") {
    for (const block of (m as any).message?.content || []) {
      if (block.type === "tool_use" && (block.name === "Agent" || String(block.name).includes("gent"))) {
        sawAgentToolUse = true;
      }
    }
  }
  // Subagent-origin messages carry parent_tool_use_id / subagent fields.
  if ((m as any).parent_tool_use_id) sawSubagentMessage = true;
  if ((m as any).message && (m as any).subagent_type) sawSubagentMessage = true;
  if ("result" in m) result = m;
}

console.log("=== PROBE 08 subagent ===");
console.log("supportedAgents() lists 'probe':", supportedHasProbe);
console.log("Agent tool_use seen:", sawAgentToolUse);
console.log("subagent-origin message (parent_tool_use_id) seen:", sawSubagentMessage);
console.log("result.subtype:", result?.subtype);
console.log("result.result:", brief(result?.result, 200));

const pass = supportedHasProbe && (sawAgentToolUse || sawSubagentMessage);
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
