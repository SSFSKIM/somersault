// Probe 46 — /goal active_goal loop (Wave 2), headlessly.
//
// Declared surface: SDKActiveGoalMessage {type:'active_goal', value:{condition, iterations, set_at,
// tokens_at_start, last_reason?} | null} — "emitted when the user's /goal Stop hook reports met
// (clears) or not-yet-met (bumps iterations)". Slash commands are known to work headlessly (probe 21).
// Design-blocking questions:
//   1. Does /goal register headlessly (any acknowledgment / active_goal frame)?
//   2. Does the goal loop RUN — Stop-hook check keeps the turn going until met?
//   3. Does active_goal stream: set (value non-null) then cleared (value null) when satisfied?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe46-"));
console.log("=== PROBE 46 /goal loop ===\ncwd:", dir);
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
let phase = "1-setgoal";
const resolvers: Record<string, () => void> = {};
const turnDone = (p: string) => new Promise<void>((r) => (resolvers[p] = r));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 12, settingSources: [] } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "active_goal") { activeGoalFrames.push(mm); console.log(`[active_goal:${phase}]`, brief(mm.value, 300)); }
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_use") console.log(`[tool_use:${phase}]`, b.name, brief(b.input, 140));
      if (b.type === "text") console.log(`[text:${phase}]`, brief(b.text, 200));
    }
    if (mm.type === "system" && mm.subtype !== "init") console.log(`[system:${phase}]`, mm.subtype, brief(mm, 200));
    if (mm.type === "result") { console.log(`[result:${phase}]`, mm.subtype, "|", brief(mm.result, 200)); resolvers[phase]?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Q1: register the goal ----
let p = turnDone("1-setgoal");
q.push(userTurn(`/goal a file named done.txt exists in the current working directory`));
await Promise.race([p, sleep(60_000)]);
await sleep(1500);
console.log("\n[Q1] active_goal frames after /goal:", activeGoalFrames.length, brief(activeGoalFrames.at(-1)?.value, 200));

// ---- Q2/Q3: a work turn — does the Stop-hook loop drive it to satisfaction + clear? ----
phase = "2-work";
p = turnDone("2-work");
q.push(userTurn(`Do the smallest thing that satisfies the current goal.`));
await Promise.race([p, sleep(120_000)]);
await sleep(3000);

console.log("\n=== VERDICT ===");
console.log("done.txt created:", existsSync(join(dir, "done.txt")) ? "✅" : "❌");
console.log("active_goal frames total:", activeGoalFrames.length, "| values:", brief(activeGoalFrames.map((f) => f.value === null ? "CLEARED" : `set(i=${f.value.iterations})`), 300));
const set = activeGoalFrames.some((f) => f.value !== null), cleared = activeGoalFrames.some((f) => f.value === null);
if (set && cleared) console.log("REACHABLE ✅ — /goal registers, loop evaluates, active_goal streams set→cleared headlessly.");
else if (set) console.log("PARTIAL ⚠️ — goal set streamed but never cleared in-window.");
else console.log("NOT OBSERVED ❌ — no active_goal frames; /goal may be interactive-only.");

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
