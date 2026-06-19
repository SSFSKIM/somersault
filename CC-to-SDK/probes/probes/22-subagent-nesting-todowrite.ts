// Probe 22 — subagent nesting (parent_tool_use_id) + TodoWrite shape, for increment-7 "rich tool rendering".
// A1 live-probe-first: the SDK DECLARES `forwardSubagentText` ("forward subagent text/thinking as
// assistant/user messages with parent_tool_use_id set, so consumers can render a nested transcript") and
// emits subagent tool_use/tool_result with parent_tool_use_id by default. But declared ≠ reachable headlessly
// (cron/push were dead). VERIFY, against a real run, BEFORE designing the nesting renderer:
//   (1) Do subagent (Task) inner turns actually surface with parent_tool_use_id != null? On the full message,
//       and/or on the stream_event partials?
//   (2) Does forwardSubagentText:true forward the subagent's TEXT/THINKING (not just tool blocks)?
//   (3) What is the exact TodoWrite tool_use input shape (so the checklist renderer can read it)?
// Two passes: A = forwardSubagentText:true; B = default (tool-only) for contrast.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-sonnet-4-6";
const PROMPT =
  "Do EXACTLY two things, then stop. " +
  "(1) Call the TodoWrite tool once to create a todo list with two items: " +
  "{content:'greet the user', status:'in_progress', activeForm:'Greeting the user'} and " +
  "{content:'count to three', status:'pending', activeForm:'Counting to three'}. " +
  "(2) Use the Task tool to launch a subagent (subagent_type 'general-purpose') whose prompt is: " +
  "\"Run the bash command `echo hi-from-subagent` and report its exact output in one sentence.\" " +
  "After the subagent returns, reply 'done'.";

function summarizeBlocks(content: any[]): string {
  return (content ?? []).map((b: any) => {
    if (b?.type === "text") return `text(${brief(b.text, 30)})`;
    if (b?.type === "thinking") return "thinking";
    if (b?.type === "tool_use") return `tool_use:${b.name}#${String(b.id).slice(-6)}`;
    if (b?.type === "tool_result") return `tool_result→${String(b.tool_use_id).slice(-6)}`;
    return b?.type ?? "?";
  }).join(" ");
}

async function runPass(label: string, forwardSubagentText: boolean) {
  console.log(`\n========== PASS ${label} (forwardSubagentText=${forwardSubagentText}) ==========`);
  const dir = mkdtempSync(join(tmpdir(), "probe22-"));
  const sevByParent: Record<string, number> = {};
  let todoInput: any = null, taskId: string | null = null;
  const nestedMsgs: string[] = [];
  for await (const m of query({ prompt: PROMPT, options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 30, includePartialMessages: true, forwardSubagentText } as any })) {
    const mm = m as any;
    const ptid = mm.parent_tool_use_id ?? null;
    if (mm.type === "stream_event") { const k = ptid ? `nested:${String(ptid).slice(-6)}` : "top"; sevByParent[k] = (sevByParent[k] ?? 0) + 1; continue; }
    if (mm.type === "assistant" || mm.type === "user") {
      const blocks = summarizeBlocks(mm.message?.content ?? []);
      const line = `  ${mm.type.padEnd(9)} ptid=${ptid ? String(ptid).slice(-6) : "—".padEnd(6)}  ${blocks}`;
      console.log(line);
      if (ptid) nestedMsgs.push(line);
      for (const b of mm.message?.content ?? []) {
        if (b?.type === "tool_use" && b.name === "TodoWrite" && !todoInput) todoInput = b.input;
        if (b?.type === "tool_use" && b.name === "Task") taskId = b.id;
      }
    }
    if (mm.type === "result") console.log(`  RESULT subtype=${mm.subtype} turns=${mm.num_turns}`);
  }
  console.log(`  --- stream_event counts by owner:`, brief(sevByParent, 300));
  console.log(`  --- Task tool_use id:`, taskId ? String(taskId).slice(-6) : "(none fired)");
  console.log(`  --- nested (ptid!=null) full-message count:`, nestedMsgs.length, nestedMsgs.length ? "→ NESTING REACHABLE" : "→ no nested msgs surfaced");
  console.log(`  --- TodoWrite input shape:`, todoInput ? brief(todoInput, 500) : "(TodoWrite did not fire)");
}

console.log("=== PROBE 22 — subagent nesting + TodoWrite ===  model:", MODEL);
await runPass("A", true);
await runPass("B", false);
console.log("\nINTERPRETATION: nested full-messages with ptid!=null (esp. text/thinking under A) → forwardSubagentText");
console.log("delivers a renderable nested transcript headlessly; compare A vs B to see what default (tool-only) omits.");
