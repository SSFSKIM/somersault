// Probe 54 — tool() extras (annotations / searchHint / alwaysLoad) + agentProgressSummaries.
//
// Premises (declared 0.3.211, never runtime-verified):
//   1. tool(_name,_desc,_shape,_handler, {annotations, searchHint, alwaysLoad}) — does alwaysLoad:true
//      make the MCP tool INLINE (init.tools) instead of ToolSearch-deferred (probe 35's default)?
//      Can the model call it without ToolSearch? Does a plain tool stay deferred alongside it?
//   2. agentProgressSummaries:true — task_progress frames carry a `summary` for a subagent running
//      >30s (the fork cadence). Costs one ~45s haiku subagent.
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 54 tool extras + progress summaries ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (360s) — probe wedged, exiting"); process.exit(2); }, 360_000).unref?.();

const verdicts: string[] = [];

// ---- 1: tool extras ----
{
  const server = createSdkMcpServer({
    name: "probe54",
    tools: [
      tool("always_tool", "Returns the probe marker AA.", {}, async () => ({ content: [{ type: "text", text: "MARKER-AA" }] }),
        { annotations: { title: "Annotated probe tool", readOnlyHint: true }, searchHint: "zebra quantum marker", alwaysLoad: true }),
      tool("plain_tool", "Returns the probe marker BB.", {}, async () => ({ content: [{ type: "text", text: "MARKER-BB" }] })),
    ],
  });
  const messages: any[] = [];
  for await (const m of query({
    prompt: "Call the tool mcp__probe54__always_tool (call it directly — do NOT use ToolSearch first) and reply with exactly the text it returns.",
    options: {
      settingSources: [], maxTurns: 4, model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions",
      mcpServers: { probe54: server },
    } as any,
  })) messages.push(m);
  const init = messages.find((m) => m.type === "system" && m.subtype === "init");
  const tools: string[] = init?.tools ?? [];
  const inlineAlways = tools.includes("mcp__probe54__always_tool");
  const inlinePlain = tools.includes("mcp__probe54__plain_tool");
  const r = messages.find((m) => m.type === "result");
  const usedToolSearch = messages.some((m) => m.type === "assistant" && JSON.stringify(m.message?.content ?? "").includes("ToolSearch"));
  console.log("[1] init.tools mcp entries:", tools.filter((t) => t.startsWith("mcp__")).join(", ") || "(none)");
  console.log("[1] result:", brief(r?.result, 120), "| model reached for ToolSearch:", usedToolSearch);
  verdicts.push(`1a alwaysLoad tool inline in init.tools: ${inlineAlways ? "YES ✅" : "NO ❌"}; plain tool inline: ${inlinePlain ? "YES (also inline!)" : "NO (deferred, as probe 35)"}`);
  verdicts.push(`1b direct call without ToolSearch: ${String(r?.result ?? "").includes("MARKER-AA") ? `YES ✅${usedToolSearch ? " (but model still ToolSearched)" : ""}` : `NO/UNCLEAR (${brief(r?.result, 80)})`}`);
}

// ---- 2: agentProgressSummaries ----
{
  const messages: any[] = [];
  for await (const m of query({
    prompt: "Use the Task tool (subagent_type: worker) with this exact task: \"Run this bash command and wait for it to finish: i=0; while [ $i -lt 45 ]; do i=$((i+1)); sleep 1; done; echo LOOPED. Then reply DONE.\" Then reply with exactly: PARENT-DONE",
    options: {
      settingSources: [], maxTurns: 6, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions",
      agentProgressSummaries: true,
      agents: { worker: { description: "runs one bash command", prompt: "You are a worker. Do exactly what the task says using Bash, then reply DONE.", model: "haiku" } },
    } as any,
  })) {
    messages.push(m);
    if ((m as any).subtype === "task_progress") console.log("[2 frame]", brief({ subtype: (m as any).subtype, summary: (m as any).summary, description: (m as any).description }, 200));
  }
  const prog = messages.filter((m: any) => m.type === "system" && m.subtype === "task_progress");
  const withSummary = prog.filter((m) => typeof (m as any).summary === "string" && (m as any).summary.length);
  const types = new Set(messages.map((m: any) => m.type + (m.subtype ? `/${m.subtype}` : "")));
  console.log("[2] frame types:", [...types].join(", "));
  console.log("[2] task_progress frames:", prog.length, "with summary:", withSummary.length, brief(withSummary.map((m: any) => m.summary), 300));
  verdicts.push(`2 agentProgressSummaries: ${withSummary.length ? `YES ✅ (${withSummary.length} summaries, e.g. "${brief((withSummary[0] as any).summary, 80)}")` : prog.length ? `PARTIAL (task_progress w/o summary ×${prog.length})` : "NO task_progress frames ❌"}`);
}

console.log("\n=== PROBE 54 VERDICTS ===");
for (const v of verdicts) console.log(" -", v);
process.exit(0);
