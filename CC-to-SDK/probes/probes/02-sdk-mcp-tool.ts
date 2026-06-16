// Probe 02 — in-process custom MCP tool via createSdkMcpServer + tool().
// Confirms Claude can call a JS-defined tool and the handler runs.
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { brief } from "../lib/runProbe.ts";

let handlerRan = false;
let handlerArg = "";

const server = createSdkMcpServer({
  name: "probe",
  tools: [
    tool(
      "echo",
      "Echo back the provided text",
      { text: z.string() },
      async (a: any) => {
        handlerRan = true;
        handlerArg = a.text;
        return { content: [{ type: "text", text: a.text }] };
      },
    ),
  ],
});

const messages: any[] = [];
let result: any;
let sawToolUse = false;

for await (const m of query({
  prompt: "Call the echo tool with text exactly equal to PARITY. Then reply with just the word it returned.",
  options: {
    maxTurns: 4,
    permissionMode: "bypassPermissions",
    mcpServers: { probe: server },
    allowedTools: ["mcp__probe__echo"],
  },
})) {
  messages.push(m);
  if (m.type === "assistant") {
    for (const block of (m as any).message?.content || []) {
      if (block.type === "tool_use" && String(block.name).includes("echo")) sawToolUse = true;
    }
  }
  if ("result" in m) result = m;
}

console.log("=== PROBE 02 sdk-mcp-tool ===");
console.log("handlerRan:", handlerRan, "handlerArg:", JSON.stringify(handlerArg));
console.log("sawToolUse(echo):", sawToolUse);
console.log("result.subtype:", result?.subtype);
console.log("result.result:", brief(result?.result, 200));

const pass = handlerRan && handlerArg === "PARITY" && sawToolUse;
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
