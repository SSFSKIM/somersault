// Probe 43b — elicitation via a STDIO MCP server (the path 43 proved SDK-type servers can't take:
// "Client does not support form elicitation" — the in-process client lacks the capability; the CLI's
// own MCP client is the real elicitation counterparty).
// Questions (same as 43 Q2-Q4): onElicitation reached? Elicitation hooks fired? content back to tool?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { brief } from "../lib/runProbe.ts";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "lib", "elicit-stdio-server.ts");
const tsxBin = join(here, "..", "node_modules", ".bin", "tsx");
console.log("=== PROBE 43b elicitation (stdio server) ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (240s) — probe wedged, exiting"); process.exit(2); }, 240_000).unref?.();

const onElicitationCalls: any[] = [];
const hookLog: string[] = [];

const handle = query({
  prompt: "Call the needsInput tool once (find it via ToolSearch if needed), then reply with exactly what it returned.",
  options: {
    model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", maxTurns: 5, settingSources: [],
    mcpServers: { probeelicit: { type: "stdio", command: tsxBin, args: [serverPath] } },
    onElicitation: async (req: any) => {
      onElicitationCalls.push(req);
      console.log("[onElicitation]", brief(req, 300));
      return { action: "accept", content: { name: "ProbeUser" } };
    },
    hooks: {
      Elicitation: [{ hooks: [async (i: any) => { hookLog.push("Elicitation"); console.log("[HOOK Elicitation]", brief({ ...i, transcript_path: undefined }, 250)); return {}; }] }],
      ElicitationResult: [{ hooks: [async (i: any) => { hookLog.push("ElicitationResult"); console.log("[HOOK ElicitationResult]", brief({ ...i, transcript_path: undefined }, 250)); return {}; }] }],
    },
  } as any,
});

let toolResultText = "";
for await (const m of handle as any) {
  if (m.type === "assistant") for (const b of m.message?.content ?? [])
    if (b.type === "tool_use") console.log("[tool_use]", b.name, brief(b.input, 100));
  if (m.type === "user") for (const b of m.message?.content ?? [])
    if (b.type === "tool_result") { const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); if (t.includes("ELICITED") || t.includes("elicit")) toolResultText = t; console.log("[tool_result]", brief(t, 300)); }
  if (m.type === "system" && m.subtype === "elicitation_complete") console.log("[system elicitation_complete]", brief(m, 200));
  if (m.type === "result") console.log("[result]", m.subtype, "|", brief(m.result, 200));
}

console.log("\n=== VERDICT ===");
console.log("[Q2] onElicitation called:", onElicitationCalls.length ? `✅ ×${onElicitationCalls.length}` : "❌ never");
console.log("[Q3] elicitation hooks:", hookLog.length ? `✅ ${hookLog.join(",")}` : "— none");
console.log("[Q4] content back to tool:", toolResultText.includes("ProbeUser") ? "✅" : "❌", brief(toolResultText, 200));
if (onElicitationCalls.length && toolResultText.includes("ProbeUser"))
  console.log("REACHABLE ✅ — headless elicitation round-trip works for stdio servers via onElicitation.");
else console.log("NOT REACHED ⚠️ — see log.");
process.exit(0);
