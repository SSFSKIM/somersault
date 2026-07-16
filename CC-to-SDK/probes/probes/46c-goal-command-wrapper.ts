// Probe 46c — /goal via the <command-name> transcript wrapper (final dispatch form).
//
// 46: "/goal …" as plain streaming text → NOT intercepted (model treats as text).
// 46b: Skill("goal") → tool_use_error "goal is a UI command, not a skill. Ask the user to run /goal".
// Remaining hypothesis: the interactive CLI transcribes typed commands as
//   <command-name>/goal</command-name><command-message>…</command-message><command-args>…</command-args>
// — if the headless CLI parses that user-message shape, the goal machinery is reachable after all.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe46c-"));
console.log("=== PROBE 46c goal via command wrapper ===\ncwd:", dir);
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
let phase = "1-wrapper";
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
      if (b.type === "tool_use") console.log(`[tool_use:${phase}]`, b.name, brief(b.input, 160));
      if (b.type === "text") console.log(`[text:${phase}]`, brief(b.text, 160));
    }
    if (mm.type === "system" && mm.subtype !== "init" && mm.subtype !== "thinking_tokens") console.log(`[system:${phase}]`, mm.subtype, brief(mm, 250));
    if (mm.type === "result") { console.log(`[result:${phase}]`, mm.subtype, "|", brief(mm.result, 160)); resolvers[phase]?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Q1: the wrapper form ----
let p = turnDone("1-wrapper");
q.push(userTurn(`<command-name>/goal</command-name>\n<command-message>goal</command-message>\n<command-args>a file named done.txt exists in the current working directory</command-args>`));
await Promise.race([p, sleep(120_000)]);
await sleep(2000);
console.log("\n[Q1] active_goal frames after wrapper turn:", activeGoalFrames.length);

// ---- Q2: if registered, drive to satisfaction; if not, this settles the negative anyway ----
phase = "2-work";
p = turnDone("2-work");
q.push(userTurn(`Create done.txt in the current working directory now.`));
await Promise.race([p, sleep(120_000)]);
await sleep(3000);

console.log("\n=== VERDICT ===");
console.log("done.txt exists:", existsSync(join(dir, "done.txt")) ? "✅" : "❌");
console.log("active_goal frames:", activeGoalFrames.length, "| values:", brief(activeGoalFrames.map((f) => f.value === null ? "CLEARED" : `set(i=${f.value.iterations})`), 300));
const set = activeGoalFrames.some((f) => f.value !== null), cleared = activeGoalFrames.some((f) => f.value === null);
if (set) console.log(`REACHABLE ✅ — the <command-name> wrapper dispatches /goal headlessly${cleared ? "; set→cleared observed" : " (no clear observed in-window)"}.`);
else console.log("NOT REACHABLE ❌ — all three dispatch forms failed; /goal is interactive-UI-only (🚫 headless).");

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
