// Probe 42 — hook-event sweep on 0.3.211 (Wave 2): which of the 30 declared HookEvents fire
// headlessly, + PreToolUse permissionDecision:'defer' semantics.
//
// Declared surface: HookEvent (sdk.d.ts:804) has 30 events; prior probing (0.3.178 era) verified 8
// alive + SessionStart/SessionEnd dormant. Unverified: PostToolUseFailure, PostToolBatch,
// UserPromptExpansion, StopFailure, PostCompact, PermissionRequest, PermissionDenied, Setup,
// TeammateIdle, TaskCreated/TaskCompleted, Elicitation(Result), ConfigChange, Worktree*,
// InstructionsLoaded, CwdChanged, FileChanged, MessageDisplay.
// defer: PreToolUseHookSpecificOutput.permissionDecision = 'allow'|'deny'|'ask'|'defer' (sdk.d.ts:810).
// Driven scenario per event (events with no headless driver stay honestly "not driven"):
//   Bash ok → Pre/PostToolUse, PostToolBatch? · failing Bash → PostToolUseFailure · canUseTool deny
//   → PermissionDenied (+ PermissionRequest?) · defer marker → does canUseTool still get asked? ·
//   Write → FileChanged? · TaskCreate/TaskUpdate → TaskCreated/TaskCompleted · cd → CwdChanged ·
//   CLAUDE.md + settingSources:[project] → InstructionsLoaded · /compact text → Pre/PostCompact ·
//   named bg agent + SendMessage → TeammateIdle? · SessionStart/End re-check.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe42-"));
mkdirSync(join(dir, "sub"));
writeFileSync(join(dir, "CLAUDE.md"), "# probe42\nThis project is a hook-sweep probe fixture.\n");
console.log("=== PROBE 42 hook sweep ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (420s) — probe wedged, exiting"); process.exit(2); }, 420_000).unref?.();

const EVENTS = ["PreToolUse","PostToolUse","PostToolUseFailure","PostToolBatch","Notification","UserPromptSubmit","UserPromptExpansion","SessionStart","SessionEnd","Stop","StopFailure","SubagentStart","SubagentStop","PreCompact","PostCompact","PermissionRequest","PermissionDenied","Setup","TeammateIdle","TaskCreated","TaskCompleted","Elicitation","ElicitationResult","ConfigChange","WorktreeCreate","WorktreeRemove","InstructionsLoaded","CwdChanged","FileChanged","MessageDisplay"] as const;

const fired = new Map<string, string>();   // event → brief of first input
const counts = new Map<string, number>();
const canUseToolCalls: string[] = [];
let deferSawCanUseTool = false;

const hooks: any = {};
for (const ev of EVENTS) hooks[ev] = [{
  hooks: [async (input: any) => {
    counts.set(ev, (counts.get(ev) ?? 0) + 1);
    if (!fired.has(ev)) { fired.set(ev, brief(input, 160)); console.log(`[HOOK ${ev}]`, brief(input, 200)); }
    if (ev === "PreToolUse" && input.tool_name === "Bash" && String((input.tool_input as any)?.command ?? "").includes("DEFER-TEST"))
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer", permissionDecisionReason: "probe defer" } };
    return {};
  }],
}];

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let turnIdx = 0;
const resolvers: (() => void)[] = [];
const nextResult = () => new Promise<void>((r) => resolvers.push(r));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: {
    model: "claude-sonnet-4-6", permissionMode: "default", cwd: dir, maxTurns: 24,
    settingSources: ["project"], hooks,
    allowedTools: ["Read", "Write", "Edit", "TaskCreate", "TaskUpdate", "Task", "Agent", "ToolSearch", "SendMessage"],
    canUseTool: async (toolName: string, input: any) => {
      canUseToolCalls.push(toolName);
      const cmd = String(input?.command ?? "");
      if (cmd.includes("DEFER-TEST")) deferSawCanUseTool = true;
      if (cmd.includes("DENY-TEST")) return { behavior: "deny", message: "probe denies DENY-TEST" };
      return { behavior: "allow", updatedInput: input };
    },
  } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "result") { console.log(`[result t${turnIdx}]`, mm.subtype); resolvers.shift()?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

const turns = [
  `Run the Bash tool once with command: echo hello-sweep`,
  `Run the Bash tool once with command: cat /nonexistent-file-probe42 — it will fail; that is expected. Then reply FAILED-OK.`,
  `Run the Bash tool once with command: echo DENY-TEST — it will be denied; that is expected. Do not retry. Then reply DENIED-OK.`,
  `Run the Bash tool once with command: echo DEFER-TEST. Then reply DEFER-OK.`,
  `Use the Write tool to create a file named probe.txt containing "sweep". Then reply WROTE.`,
  `Call TaskCreate with subject "probe task" and description "sweep". Then call TaskUpdate marking that task completed. Then reply TASKED.`,
  `Run the Bash tool once with command: cd sub && pwd. Then reply CDONE.`,
  `/compact`,
];
for (const t of turns) {
  const p = nextResult();
  q.push(userTurn(t));
  turnIdx++;
  await Promise.race([p, sleep(90_000)]);
}
await sleep(2000);
q.close();
await Promise.race([consume, sleep(8000)]);
try { await handle.close?.(); } catch {}
await sleep(1500); // SessionEnd would fire at teardown if ever

console.log("\n=== VERDICT ===");
console.log("FIRED (", fired.size, "):", [...fired.keys()].map((e) => `${e}×${counts.get(e)}`).join(" "));
console.log("SILENT:", EVENTS.filter((e) => !fired.has(e)).join(" "));
console.log("canUseTool calls:", canUseToolCalls.length, brief(canUseToolCalls, 200));
console.log("defer → canUseTool consulted:", deferSawCanUseTool ? "✅ (defer hands off to the permission flow)" : "❌ (defer did not reach canUseTool)");
process.exit(0);
