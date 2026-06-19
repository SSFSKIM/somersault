// Probe 22b — native task-tool shapes (TaskCreate / TaskUpdate / TaskList), the SDK's actual "todo list".
// Probe 22 flipped the premise: the SDK has NO `TodoWrite` (model: "TodoWrite isn't in my available tools");
// it tracks tasks via incremental native ops TaskCreate/TaskUpdate/TaskList. So increment-7's "checklist"
// renderer must REDUCE these ops into current list state — which needs their exact input + result shapes.
// Capture them here, BEFORE designing the renderer.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-sonnet-4-6";
const PROMPT =
  "Use the native task tools to do EXACTLY this, then stop: " +
  "(1) TaskCreate a task 'build the parser'. (2) TaskCreate a task 'write tests'. " +
  "(3) TaskUpdate the 'build the parser' task to status in_progress. " +
  "(4) TaskList to list all tasks. Then reply 'done'.";

const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskRead", "TaskGet"]);
const dir = mkdtempSync(join(tmpdir(), "probe22b-"));
const byId: Record<string, string> = {};   // tool_use id → "Name"

console.log("=== PROBE 22b — native task-tool shapes ===  model:", MODEL);
for await (const m of query({ prompt: PROMPT, options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 20 } as any })) {
  const mm = m as any;
  if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
    if (b?.type === "tool_use" && TASK_TOOLS.has(b.name)) {
      byId[b.id] = b.name;
      console.log(`\n${b.name} INPUT:`, brief(b.input, 600));
    }
  }
  if (mm.type === "user") for (const b of mm.message?.content ?? []) {
    if (b?.type === "tool_result" && byId[b.tool_use_id]) {
      const txt = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => x?.text ?? "").join("") : JSON.stringify(b.content);
      console.log(`${byId[b.tool_use_id]} RESULT:`, brief(txt, 600));
    }
  }
  if (mm.type === "result") console.log(`\nRESULT subtype=${mm.subtype} turns=${mm.num_turns}`);
}
console.log("\nINTERPRETATION: TaskCreate/Update inputs (id? content? status? activeForm?) + TaskList result shape");
console.log("define the reducer state a checklist renderer accumulates from the op stream.");
