// Probe 39 — background-task visibility (Wave 1 item 4): `background_tasks_changed` + Query.stopTask()
// + Query.backgroundTasks() (Ctrl+B), headlessly.
//
// Declared surface (sdk.d.ts 0.3.211):
//   - SDKBackgroundTasksChangedMessage: system/background_tasks_changed — a LEVEL signal (REPLACE
//     semantics, ids only, nothing at startup, reset on CLI restart).
//   - Query.backgroundTasks(toolUseId?) → Promise<boolean>: backgrounds in-flight FOREGROUND tasks
//     (Ctrl+B semantics); each blocked tool call returns a "running in the background" tool_result.
//   - Query.stopTask(taskId): task_notification with status 'stopped'.
// Declared ≠ reachable (task_notification machinery was cron-adjacent; only a live run settles which
// of these fire in --print/streaming mode). Design-blocking questions:
//   1. Does background_tasks_changed ARRIVE headlessly when the model launches run_in_background Bash?
//   2. Payload sanity: task_id/task_type/description present? level (full-set) semantics observable?
//   3. Does backgroundTasks() (no arg, Ctrl+B-all) background a FOREGROUND Bash mid-turn — tool_result
//      arrives, turn continues?
//   4. Does stopTask(taskId) kill it and emit task_notification 'stopped' + a changed message with the
//      task removed?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

// Run-1 lessons: (a) CLI 2.1.211 BLOCKS long leading foreground sleeps ("Blocked: sleep 45 … use an
// until-loop") — use its own suggested `until [ -f flag ]; do sleep 2; done` shape for long-runners;
// (b) "then immediately reply LAUNCHED" let sonnet skip the tool call entirely — demand the tool call
// first and verify a tool_use actually streamed before trusting any verdict.
const dir = mkdtempSync(join(tmpdir(), "probe39-"));
console.log("=== PROBE 39 background tasks ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

const changedEvents: { tasks: any[]; at: number }[] = [];
const taskNotifications: any[] = [];
let phase = "1-launch";
let p1done!: () => void; const p1 = new Promise<void>((r) => (p1done = r));
let p3done!: () => void; const p3 = new Promise<void>((r) => (p3done = r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: {
    model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 12,
    settingSources: [] as any,
  } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "background_tasks_changed") {
      changedEvents.push({ tasks: mm.tasks, at: Date.now() });
      console.log(`[changed:${phase}] tasks now: ${brief(mm.tasks, 300)}`);
    }
    if (mm.type === "task_notification" || mm.subtype === "task_notification") {
      taskNotifications.push(mm);
      console.log(`[task_notification:${phase}]`, brief({ status: mm.status, task_id: mm.task_id ?? mm.taskId, summary: mm.summary }, 300));
    }
    if (mm.type === "assistant") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_use") console.log(`[tool_use:${phase}]`, b.name, brief(b.input, 160));
    if (mm.type === "user") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_result") console.log(`[tool_result:${phase}]`, brief(typeof b.content === "string" ? b.content : JSON.stringify(b.content), 200));
    if (mm.type === "result") {
      console.log(`[result:${phase}]`, mm.subtype, "|", brief(mm.result, 140));
      if (phase === "1-launch") p1done();
      if (phase === "3-ctrlb") p3done();
    }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Q1/Q2: model launches a background Bash; do changed events arrive? ----
q.push(userTurn(`You MUST call the Bash tool exactly once, with run_in_background set to true, running this exact command: until [ -f ${dir}/stop.flag ]; do sleep 2; done; echo MARKER-DONE\nAfter the tool call has returned, reply with exactly: LAUNCHED`));
await Promise.race([p1, sleep(90_000)]);
await sleep(2000);
const afterLaunch = changedEvents.length;
const liveTask = changedEvents.at(-1)?.tasks?.[0];
console.log("\n[Q1] background_tasks_changed events after launch:", afterLaunch, "| latest set:", brief(changedEvents.at(-1)?.tasks, 300));

// ---- Q4: stopTask the launched background task ----
if (liveTask?.task_id) {
  console.log("\n[Q4] stopTask(" + liveTask.task_id + ")…");
  phase = "4-stop";
  try {
    await handle.stopTask(liveTask.task_id);
    console.log("[Q4] stopTask resolved ✅");
  } catch (e) {
    console.log("[Q4] stopTask THREW:", brief(String(e), 300));
  }
  await sleep(4000);
  const lastSet = changedEvents.at(-1)?.tasks ?? [];
  console.log("[Q4] changed events now:", changedEvents.length, "| latest set:", brief(lastSet, 200),
    "| task removed:", !lastSet.some((t: any) => t.task_id === liveTask.task_id),
    "| 'stopped' notification:", taskNotifications.some((n) => String(n.status).includes("stop")));
} else {
  console.log("\n[Q4] SKIPPED — no task_id observed from changed events (see Q1).");
}

// ---- Q3: Ctrl+B — background a FOREGROUND long-runner mid-turn via Query.backgroundTasks() ----
phase = "3-ctrlb";
console.log("\n[Q3] sending a FOREGROUND blocking Bash turn, then backgroundTasks() after 6s…");
q.push(userTurn(`You MUST call the Bash tool exactly once, in the FOREGROUND (run_in_background false/omitted), running this exact command: until [ -f ${dir}/fg.flag ]; do sleep 2; done; echo FG-DONE\nWhen the command returns, reply with exactly: FG-FINISHED`));
await sleep(6000); // let the tool call start blocking
try {
  const backgrounded = await handle.backgroundTasks();
  console.log("[Q3] backgroundTasks() →", backgrounded, backgrounded ? "✅ backgrounded" : "(false — nothing was foreground?)");
} catch (e) {
  console.log("[Q3] backgroundTasks THREW:", brief(String(e), 300));
}
await Promise.race([p3, sleep(60_000)]);
const ctrlbTask = changedEvents.at(-1)?.tasks?.find((t: any) => !liveTask || t.task_id !== liveTask.task_id);
if (ctrlbTask?.task_id) { try { await handle.stopTask(ctrlbTask.task_id); } catch {} } // cleanup

// safety: release any still-spinning until-loops so nothing outlives the probe
const { writeFileSync } = await import("node:fs");
try { writeFileSync(join(dir, "stop.flag"), ""); writeFileSync(join(dir, "fg.flag"), ""); } catch {}
await sleep(3000);

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}

console.log("\n=== VERDICT ===");
console.log("changed-events total:", changedEvents.length, "| notifications:", taskNotifications.length);
if (afterLaunch > 0) console.log("REACHABLE ✅ : background_tasks_changed streams headlessly; see Q3/Q4 for method verdicts.");
else console.log("NOT OBSERVED ❌ : no background_tasks_changed arrived — visibility may be interactive-only (or launch failed; check tool_use log).");
process.exit(0);
