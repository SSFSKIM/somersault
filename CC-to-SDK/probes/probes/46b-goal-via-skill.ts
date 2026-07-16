// Probe 46b — /goal via the Skill tool (Wave 2 follow-up to 46).
//
// 46 finding: "goal" IS in the headless command catalog ({name:"goal", description:"Set a goal — keep
// working until the condition is met"}), but "/goal …" submitted as streaming user TEXT is NOT
// intercepted by the CLI — the model saw it as plain text. Hypothesis: skill-type catalog entries are
// dispatched BY THE MODEL via the Skill tool (the same contract our own harness uses), so the loop is
// reachable headlessly iff the model invokes Skill("goal").
// Questions:
//   1. Does Skill("goal", args) load the goal machinery (tool_result with instructions)?
//   2. Does active_goal then STREAM (value set, iterations)?
//   3. Does satisfying the condition clear it (value null)?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe46b-"));
console.log("=== PROBE 46b goal via Skill tool ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const activeGoalFrames: any[] = [];
let skillResult = "";
let phase = "1-invoke";
const resolvers: Record<string, () => void> = {};
const turnDone = (p: string) => new Promise<void>((r) => (resolvers[p] = r));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 16, settingSources: [] } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "active_goal") { activeGoalFrames.push(mm); console.log(`[active_goal:${phase}]`, brief(mm.value, 300)); }
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_use") console.log(`[tool_use:${phase}]`, b.name, brief(b.input, 200));
      if (b.type === "text") console.log(`[text:${phase}]`, brief(b.text, 160));
    }
    if (mm.type === "user") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_result") { const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); if (phase === "1-invoke") skillResult ||= t; console.log(`[tool_result:${phase}]`, brief(t, 400)); }
    if (mm.type === "system" && mm.subtype !== "init" && mm.subtype !== "thinking_tokens") console.log(`[system:${phase}]`, mm.subtype, brief(mm, 200));
    if (mm.type === "result") { console.log(`[result:${phase}]`, mm.subtype, "|", brief(mm.result, 160)); resolvers[phase]?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Q1: invoke the goal skill explicitly; the condition needs LATER work so the loop must persist ----
let p = turnDone("1-invoke");
q.push(userTurn(`Invoke the Skill tool exactly once with skill "goal" and args "a file named done.txt exists in the current working directory". Follow whatever instructions the skill returns. Do NOT create the file yet unless the skill instructions require it.`));
await Promise.race([p, sleep(150_000)]);
await sleep(2000);
console.log("\n[Q1] active_goal frames after Skill(goal):", activeGoalFrames.length, "| skill tool_result:", brief(skillResult, 200));

// ---- Q2/Q3: if the goal registered but isn't yet met, a nudge turn should get looped until met ----
if (!existsSync(join(dir, "done.txt"))) {
  phase = "2-satisfy";
  p = turnDone("2-satisfy");
  q.push(userTurn(`Now satisfy the active goal.`));
  await Promise.race([p, sleep(120_000)]);
  await sleep(3000);
}

console.log("\n=== VERDICT ===");
console.log("done.txt exists:", existsSync(join(dir, "done.txt")) ? "✅" : "❌");
console.log("active_goal frames:", activeGoalFrames.length, "| values:", brief(activeGoalFrames.map((f) => f.value === null ? "CLEARED" : `set(i=${f.value.iterations})`), 300));
const set = activeGoalFrames.some((f) => f.value !== null), cleared = activeGoalFrames.some((f) => f.value === null);
if (set && cleared) console.log("REACHABLE ✅ — goal loop runs headlessly via Skill(goal); active_goal streams set→cleared.");
else if (set) console.log("PARTIAL ⚠️ — goal registered (active_goal set) but not observed clearing in-window.");
else console.log("NOT OBSERVED ❌ — Skill(goal) did not produce active_goal frames headlessly.");

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
