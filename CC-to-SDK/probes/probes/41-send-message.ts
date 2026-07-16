// Probe 41 — inter-agent SendMessage (Wave 2 item 2), headlessly.
//
// Declared surface: SendMessage is NOT in sdk-tools.d.ts (it lags), but probe 40's init.tools
// inventory shows it PRESENT headlessly, and AgentInput.name (sdk-tools.d.ts:496) says a named
// spawned agent is "addressable via SendMessage({to: name}) while running".
// Design-blocking questions:
//   1. Can the model spawn a NAMED background agent headlessly (Agent tool + name + run_in_background)?
//   2. Does SendMessage(to: name) deliver to that running agent (tool_result acknowledges)?
//   3. Does the agent's reply come back — as a task_notification / wake / retrievable output?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe41-"));
console.log("=== PROBE 41 SendMessage ===\ncwd:", dir);
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

let phase = "1-spawn";
const notifications: any[] = [];
let sendMessageResult = "";
let sendMessageUsed = false, agentSpawned = false;
const resolvers: Record<string, () => void> = {};
const turnDone = (p: string) => new Promise<void>((r) => (resolvers[p] = r));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 10, settingSources: [] } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_use") {
        console.log(`[tool_use:${phase}]`, b.name, brief(b.input, 220));
        if (b.name === "Task" || b.name === "Agent") agentSpawned = true;
        if (b.name === "SendMessage") sendMessageUsed = true;
      }
    }
    if (mm.type === "user") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_result") {
        const txt = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        console.log(`[tool_result:${phase}]`, brief(txt, 300));
        if (sendMessageUsed && phase === "2-send") sendMessageResult ||= txt ?? "";
      }
    if (mm.type === "task_notification" || mm.subtype === "task_notification") {
      notifications.push(mm);
      console.log(`[task_notification:${phase}]`, brief({ status: mm.status, summary: mm.summary, task_id: mm.task_id }, 300));
    }
    if (mm.type === "system" && mm.subtype === "background_tasks_changed")
      console.log(`[changed:${phase}]`, brief(mm.tasks, 200));
    if (mm.type === "result") { console.log(`[result:${phase}]`, mm.subtype, "|", brief(mm.result, 200)); resolvers[phase]?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Q1: spawn a named background agent ----
let p = turnDone("1-spawn");
q.push(userTurn(`Call the Agent tool (also known as Task) exactly once with this exact input: name "echo-buddy", run_in_background true, subagent_type "general-purpose", prompt "You are a long-lived background agent. Sit and wait for incoming messages. Whenever a message arrives asking you for a fruit word, reply with exactly that word and nothing else. Do not exit." After the tool call returns, reply with exactly: SPAWNED`));
await Promise.race([p, sleep(90_000)]);
await sleep(2000);
console.log("\n[Q1] named background agent spawned:", agentSpawned ? "✅" : "❌");

// ---- Q2/Q3: SendMessage to it ----
phase = "2-send";
p = turnDone("2-send");
q.push(userTurn(`Call the SendMessage tool exactly once, addressed to "echo-buddy" (use its "to" or equivalent recipient field), with a message asking it to reply with the word PINEAPPLE. After the tool returns, quote the tool result verbatim in your reply, then end with: SENT`));
await Promise.race([p, sleep(120_000)]);
// give the agent's reply a moment to arrive as a wake/notification
await sleep(15_000);

console.log("\n=== VERDICT ===");
console.log("[Q2] SendMessage tool_use fired:", sendMessageUsed ? "✅" : "❌", "| result:", brief(sendMessageResult, 300));
console.log("[Q3] notifications observed:", notifications.length, brief(notifications.map((n) => n.summary ?? n.status), 400));
const replyBack = notifications.some((n) => JSON.stringify(n).includes("PINEAPPLE")) || sendMessageResult.includes("PINEAPPLE");
console.log(replyBack ? "REPLY OBSERVED ✅ — agent answered via the bus" : "(no PINEAPPLE reply captured in-window — check log for how the reply travels)");

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
