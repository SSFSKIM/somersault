// Probe 47 — Monitor tool (Wave 2), headlessly.
//
// Declared surface: sdk-tools.d.ts MonitorInput {description, timeout_ms, persistent, command? | ws?}
// — "each stdout line is an event; exit ends the watch". Probe 40 inventory: PRESENT.
// Design-blocking questions:
//   1. Does a forced Monitor call succeed headlessly (tool_result, monitor registered)?
//   2. How do the watched lines reach the session — task_notification? a wake turn? changed-set entry?
//   3. Does watch exit (command ends) surface, and does the set empty?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe47-"));
console.log("=== PROBE 47 Monitor ===\ncwd:", dir);
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

let monitorUsed = false, toolResultText = "";
const notifications: any[] = []; const changed: any[] = [];
let phase = "1-launch";
const resolvers: Record<string, () => void> = {};
const turnDone = (p: string) => new Promise<void>((r) => (resolvers[p] = r));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 8, settingSources: [] } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_use") { console.log(`[tool_use:${phase}]`, b.name, brief(b.input, 260)); if (b.name === "Monitor") monitorUsed = true; }
      if (b.type === "text") console.log(`[text:${phase}]`, brief(b.text, 200));
    }
    if (mm.type === "user") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_result") { toolResultText = typeof b.content === "string" ? b.content : JSON.stringify(b.content); console.log(`[tool_result:${phase}]`, brief(toolResultText, 300)); }
    if (mm.type === "task_notification" || mm.subtype === "task_notification") { notifications.push(mm); console.log(`[task_notification:${phase}]`, brief(mm, 300)); }
    if (mm.type === "system" && mm.subtype === "background_tasks_changed") { changed.push(mm.tasks); console.log(`[changed:${phase}]`, brief(mm.tasks, 250)); }
    if (mm.type === "result") { console.log(`[result:${phase}]`, mm.subtype, "|", brief(mm.result, 160)); resolvers[phase]?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Q1: force a Monitor call over a short self-terminating command ----
const p = turnDone("1-launch");
q.push(userTurn(`You MUST call the Monitor tool exactly once with this input: description "probe watch", timeout_ms 60000, persistent false, command "for i in 1 2 3; do echo line-$i; sleep 1; done; echo MONITOR-END". After the tool call returns, reply with exactly: MONITOR-LAUNCHED`));
await Promise.race([p, sleep(90_000)]);
console.log("\n[Q1] Monitor tool_use fired:", monitorUsed ? "✅" : "❌");

// ---- Q2/Q3: wait past command exit; see how events/exit surface ----
phase = "2-observe";
await sleep(20_000);

console.log("\n=== VERDICT ===");
console.log("notifications:", notifications.length, "| changed-sets:", changed.length, "| last set:", brief(changed.at(-1), 200));
if (monitorUsed && !toolResultText.toLowerCase().includes("error"))
  console.log("REACHABLE ✅ — Monitor callable headlessly; event/exit delivery per log above.");
else if (monitorUsed) console.log("CALLED BUT ERRORED ⚠️ —", brief(toolResultText, 300));
else console.log("NOT CALLED ❌ — model never invoked Monitor.");

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
