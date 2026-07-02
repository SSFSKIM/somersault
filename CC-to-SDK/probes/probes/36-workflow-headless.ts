// Probe 36 — Is the native Workflow tool (dynamic script-driven multi-agent orchestration) reachable headlessly?
//
// Declared surface (sdk-tools.d.ts 0.3.178): WorkflowInput takes an inline `script` (agent()/parallel()/
// pipeline()/phase(), plain-JS loops & conditionals = DYNAMIC control flow) and WorkflowOutput returns
// { status: "async_launched", taskId, taskType: "local_workflow", runId, transcriptDir, scriptPath }.
// The native darwin binary contains the runtime (52x "local_workflow", "pipeline(", "meta.phases").
// But declared ≠ reachable (cron/push were bundled AND dead headless) — only a live run settles it.
//
// Design: the model is instructed to call Workflow with a VERBATIM script whose body is a plain-JS
// for-loop over agent() calls (the "dynamic" part). Each agent must echo a discriminator word that
// exists NOWHERE else in the transcript unless a real subagent produced it. Because WorkflowOutput is
// async_launched (background task), the model is told to then block on TaskOutput(taskId) and report
// the workflow's return value — the headless turn must stay alive for the result to come back at all.
//
// Signals:
//   1. Workflow present in system init tools list?
//   2. Workflow tool_use fires, tool_result = async_launched + runId (vs an error like dead cron)?
//   3. Subagent activity streams (parent_tool_use_id) / discriminator words surface?
//   4. Final answer contains the loop-built return value { echoes: [...], count: 2 }?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const W1 = "QUASAR-91";
const W2 = "MERIDIAN-38";

const SCRIPT = `export const meta = { name: 'probe-dyn-echo', description: 'Dynamic loop echo probe', phases: [{ title: 'Echo' }] }
const words = ${JSON.stringify([W1, W2])}
const out = []
for (const w of words) {
  const r = await agent('Reply with exactly the word ' + w + ' and nothing else.')
  out.push(String(r).trim())
}
return { echoes: out, count: out.length }`;

const PROMPT = [
  `Use a workflow. Call the Workflow tool exactly once, passing this EXACT script verbatim as the "script" field (do not modify a single character, do not add args):`,
  "```",
  SCRIPT,
  "```",
  `The launch is asynchronous. After launching, wait for the workflow to finish (use TaskOutput with the returned taskId, polling again if it has not finished) and then report the workflow's return value verbatim as JSON.`,
].join("\n");

interface Obs {
  workflowInTools: boolean;
  workflowCalled: boolean;
  workflowInput: any;
  workflowResult: string;   // raw tool_result for the Workflow call
  taskOutputCalls: number;
  taskOutputResults: string[];
  notificationTexts: string[]; // injected user-text messages (how async completion re-enters the turn)
  sawW1: boolean;
  sawW2: boolean;
  subagentMsgs: number;     // messages attributed to children via parent_tool_use_id
  finalText: string;
  numTurns?: number;
  errored: boolean;
}

const obs: Obs = {
  workflowInTools: false, workflowCalled: false, workflowInput: undefined, workflowResult: "",
  taskOutputCalls: 0, taskOutputResults: [], notificationTexts: [], sawW1: false, sawW2: false,
  subagentMsgs: 0, finalText: "", errored: false,
};

// Map tool_use_id → tool name so we can attribute tool_results in user messages.
const toolUseNames = new Map<string, string>();

for await (const m of query({
  prompt: PROMPT,
  options: {
    model: "claude-opus-4-8",
    permissionMode: "bypassPermissions",
    maxTurns: 24,
    allowedTools: ["Workflow", "TaskOutput", "TaskGet", "TaskList"],
  },
})) {
  if (m.type === "system" && (m as any).subtype === "init") {
    const tools: string[] = (m as any).tools || [];
    obs.workflowInTools = tools.includes("Workflow");
    console.log("[init] model:", (m as any).model, "| Workflow in tools:", obs.workflowInTools, "| tools#:", tools.length);
  }
  if (m.type === "assistant") {
    if ((m as any).parent_tool_use_id) obs.subagentMsgs++;
    for (const block of (m as any).message?.content || []) {
      if (block.type === "tool_use") {
        toolUseNames.set(block.id, block.name);
        if (block.name === "Workflow") {
          obs.workflowCalled = true;
          obs.workflowInput = block.input;
          console.log("[tool_use] Workflow launched, script bytes:", String((block.input as any)?.script || "").length);
        } else if (block.name === "TaskOutput") {
          obs.taskOutputCalls++;
          console.log("[tool_use] TaskOutput", brief(block.input, 160));
        } else {
          console.log("[tool_use]", block.name, brief(block.input, 120));
        }
      }
    }
  }
  if (m.type === "user") {
    for (const block of (m as any).message?.content || []) {
      if (block.type === "tool_result") {
        const c = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        const name = toolUseNames.get(block.tool_use_id) || "?";
        if (name === "Workflow") { obs.workflowResult = c; console.log("[tool_result:Workflow]", brief(c, 500)); }
        else if (name === "TaskOutput") { obs.taskOutputResults.push(c); console.log("[tool_result:TaskOutput]", brief(c, 400)); }
        if (c.includes(W1)) obs.sawW1 = true;
        if (c.includes(W2)) obs.sawW2 = true;
      }
      // Run 1 finding: the workflow's completion re-enters the turn as an injected USER TEXT message
      // (task-notification), not via TaskOutput — capture it so the mechanism is on record.
      if (block.type === "text") {
        const t = String(block.text);
        if (t.includes(W1) || t.includes(W2) || /task|workflow/i.test(t)) {
          obs.notificationTexts.push(t);
          console.log("[user-text (notification?)]", brief(t, 400));
        }
        if (t.includes(W1)) obs.sawW1 = true;
        if (t.includes(W2)) obs.sawW2 = true;
      }
    }
  }
  if ("result" in m) {
    obs.finalText = String((m as any).result || "");
    obs.numTurns = (m as any).num_turns;
    obs.errored = (m as any).is_error === true || (m as any).subtype !== "success";
  }
}

if (obs.finalText.includes(W1)) obs.sawW1 = true;
if (obs.finalText.includes(W2)) obs.sawW2 = true;

console.log("\n=== OBSERVATIONS ===");
console.log("Workflow in init tools:", obs.workflowInTools);
console.log("Workflow called:", obs.workflowCalled, "| launch result:", brief(obs.workflowResult, 400));
console.log("TaskOutput calls:", obs.taskOutputCalls, "| results:", brief(obs.taskOutputResults, 400));
console.log("notification user-texts:", obs.notificationTexts.length, brief(obs.notificationTexts, 400));
console.log("subagent-attributed msgs (parent_tool_use_id):", obs.subagentMsgs, "(run 1: 0 — workflow children do NOT stream into the parent; transcripts land in transcriptDir)");
console.log("discriminators — QUASAR-91:", obs.sawW1, "| MERIDIAN-38:", obs.sawW2);
console.log("turns:", obs.numTurns, "| errored:", obs.errored);
console.log("final:", brief(obs.finalText, 500));

console.log("\n=== VERDICT ===");
// The tool_result is a human-formatted launch message, NOT raw WorkflowOutput JSON (run-1 lesson:
// matching "async_launched" mis-verdicted a successful run as dead).
const launched = /launched in background|Task ID:|async_launched/i.test(obs.workflowResult);
if (!obs.workflowInTools) console.log("NOT REACHABLE ❌ : Workflow absent from the headless tool list.");
else if (!obs.workflowCalled) console.log("INCONCLUSIVE: model never called Workflow despite explicit 'use a workflow'. Re-run / tighten prompt.");
else if (!launched) console.log("DEAD HEADLESS ❌ : Workflow call errored at launch (cron-style declared-but-dead). Result above.");
else if (obs.sawW1 && obs.sawW2) console.log("REACHABLE ✅ : dynamic (loop-driven) workflow launched, subagents executed, return value surfaced back into the headless turn.");
else console.log("PARTIAL ⚠️ : launch succeeded (async_launched) but the return value never surfaced — background task likely orphaned when the headless turn ended. Inspect TaskOutput results above.");
