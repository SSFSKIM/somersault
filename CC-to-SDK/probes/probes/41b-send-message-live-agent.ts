// Probe 41b — SendMessage to a STILL-RUNNING named agent (fixes 41's two stacked failures).
//
// 41 lessons: (a) the model omitted the Agent tool's `name` param unless forced — spell the exact
// field out; (b) a background agent runs its prompt to COMPLETION and is then unreachable
// ("No agent named 'X' is reachable") — SendMessage only delivers while the agent is mid-task, so
// park the agent in a blocking until-loop; (c) SendMessage itself is DEFERRED (ToolSearch first) and
// the spawn tool_result says "Use SendMessage with to: '<agentId>'".
// Questions:
//   1. With name passed and the agent parked in Bash, does SendMessage(to: name) report success?
//   2. Does the delivered message actually reach the agent's transcript (agent acts on it after its
//      blocking call returns → writes fruit.txt)?
//   3. How does the agent's reply travel back (task_notification / wake turn)?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe41b-"));
console.log("=== PROBE 41b SendMessage → live agent ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (360s) — probe wedged, exiting"); process.exit(2); }, 360_000).unref?.();

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let phase = "1-spawn";
let sendResult = "";
const notifications: any[] = [];
let taskAlive = false;
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
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_use") console.log(`[tool_use:${phase}]`, b.name, brief(b.input, 400));
      if (b.type === "text") console.log(`[text:${phase}]`, brief(b.text, 160));
    }
    if (mm.type === "user") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_result") {
        const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        console.log(`[tool_result:${phase}]`, brief(t, 350));
        if (phase === "2-send" && t.includes("success")) sendResult ||= t;
      }
    if (mm.type === "system" && mm.subtype === "background_tasks_changed") {
      taskAlive = (mm.tasks ?? []).length > 0;
      console.log(`[changed:${phase}]`, brief(mm.tasks, 250));
    }
    if (mm.type === "task_notification" || mm.subtype === "task_notification") { notifications.push(mm); console.log(`[task_notification:${phase}]`, brief({ status: mm.status, summary: mm.summary }, 250)); }
    if (mm.type === "result") { console.log(`[result:${phase}]`, mm.subtype, "|", brief(mm.result, 140)); resolvers[phase]?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Q1: spawn named agent parked in a blocking until-loop ----
let p = turnDone("1-spawn");
q.push(userTurn(`Call the Agent tool exactly once. Its input MUST include ALL of these fields verbatim: "name": "echo-buddy", "run_in_background": true, "subagent_type": "general-purpose", "description": "parked echo agent", and "prompt": "First run this exact Bash command in the FOREGROUND and wait for it: until [ -f ${dir}/release.flag ]; do sleep 2; done; echo RELEASED — then check whether you have received any message asking for a fruit word; if yes, use the Write tool to write exactly that word to ${dir}/fruit.txt; finally reply DONE." After the Agent tool returns, reply with exactly: SPAWNED`));
await Promise.race([p, sleep(90_000)]);
await sleep(3000);
console.log("\n[Q1] agent parked (changed-set non-empty):", taskAlive ? "✅" : "❌ (may have completed already)");

// ---- Q2: SendMessage while it is parked ----
phase = "2-send";
p = turnDone("2-send");
q.push(userTurn(`Call the SendMessage tool exactly once with input: "to": "echo-buddy", "message": "Please reply with the word PINEAPPLE.", "summary": "fruit request". Quote the tool result verbatim, then reply: SENT`));
await Promise.race([p, sleep(120_000)]);

// ---- Q3: release the agent; does it act on the delivered message? ----
phase = "3-release";
writeFileSync(join(dir, "release.flag"), "");
console.log("[3-release] release.flag written; waiting for the agent to finish…");
await sleep(45_000);

console.log("\n=== VERDICT ===");
const fruit = existsSync(join(dir, "fruit.txt")) ? readFileSync(join(dir, "fruit.txt"), "utf8").trim() : null;
console.log("[Q2] SendMessage result:", brief(sendResult || "(no success result captured)", 300));
console.log("[Q3] fruit.txt:", fruit === null ? "absent ❌" : `"${fruit}" ${fruit.includes("PINEAPPLE") ? "✅ message reached the agent" : "⚠️ unexpected content"}`);
console.log("notifications:", brief(notifications.map((n) => `${n.status}:${n.summary}`), 400));
// NOTE run-1: tool_result content arrives JSON-stringified (escaped quotes) — match the escaped form too.
if (/\\?"success\\?":true/.test(sendResult) && fruit?.includes("PINEAPPLE"))
  console.log("REACHABLE ✅ — named inter-agent SendMessage delivers headlessly to a running agent.");
else if (sendResult.includes('"success":true')) console.log("PARTIAL ⚠️ — send acknowledged but agent-side effect unobserved.");
else console.log("NOT DELIVERED ❌ — see Q2 result for the failure shape.");

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
