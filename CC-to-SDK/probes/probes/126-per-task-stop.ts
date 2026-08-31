// Probe 126 — perTaskStopAffordance + stopTask(): does the declaration change interrupt semantics
// headlessly, and does the per-task stop control work on the SDK transport?
//
// sdk.d.ts 0.3.251: declaring perTaskStopAffordance means an interrupt on an open-input session
// SPARES running background tasks (Stop aborts only the turn), and tasks are stopped one at a time
// via the stop_task control (Query.stopTask). ABSENCE fails closed: interrupt kills them.
//
// Two phases, identical shape, one flag flipped:
//   turn 1 starts a background shell task (sleep 90) → capture task_started (its id + the new
//   is_backgrounded/ambient/spawn_depth fields ride along as a bonus census)
//   turn 2 is a slow foreground turn; 3s in, q.interrupt()
//   → then watch background_tasks_changed membership: DECLARED = task should survive the interrupt,
//     then stopTask(id) should remove it; UNDECLARED = the interrupt alone should kill it.
//
// Run from CC-to-SDK/probes:  npx tsx probes/126-per-task-stop.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

function loadKey(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const file = process.env.CCX_ENV_FILE ?? resolve(import.meta.dirname, "../../.env");
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch (e) { console.log("[env] could not read env file:", (e as Error)?.name); }
  }
  delete process.env.ANTHROPIC_API_KEY;
  console.log("[env] keyed:", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN));
}
loadKey();

const log = (...a: unknown[]) => console.log("[p126]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (600s)"); process.exit(2); }, 600_000).unref?.();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function phase(tag: string, declare: boolean): Promise<void> {
  log(`===== phase ${tag} (perTaskStopAffordance: ${declare}) =====`);
  const queue: unknown[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const push = (text: string) => {
    queue.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "x" });
    notify?.();
  };
  const end = () => { done = true; notify?.(); };
  async function* input() {
    while (!done || queue.length) {
      while (queue.length) yield queue.shift() as never;
      if (done) break;
      await new Promise<void>(r => { notify = r; });
    }
  }

  push("Use the Bash tool ONCE with run_in_background set to true to run exactly: sleep 90. "
    + "As soon as the tool call returns, reply with exactly STARTED and nothing else. Do not wait for or poll the command.");
  const q = query({
    prompt: input() as never,
    options: {
      model: "haiku",
      cwd: process.cwd(),
      settingSources: [],
      permissionMode: "bypassPermissions",
      maxTurns: 6,
      ...(declare ? { perTaskStopAffordance: true } : {}),
    } as never,
  });

  let bgTaskId: string | null = null;
  const memberships: string[] = [];  // each background_tasks_changed payload as "id,id"
  let phaseStep: "starting" | "interrupting" | "post-interrupt" | "stopped" = "starting";

  const consume = (async () => {
    for await (const m of q as AsyncIterable<Record<string, unknown>>) {
      const msg = m as Record<string, unknown>;
      if (msg.type === "system" && msg.subtype === "task_started") {
        log(`task_started: task_type=${msg.task_type} task_id=${msg.task_id} is_backgrounded=${JSON.stringify(msg.is_backgrounded)} spawn_depth=${JSON.stringify(msg.spawn_depth)} ambient=${JSON.stringify(msg.ambient)} skip_transcript=${JSON.stringify(msg.skip_transcript)}`);
        if (!bgTaskId && msg.task_type !== "local_agent") bgTaskId = String(msg.task_id);
      }
      if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
        const ids = ((msg.tasks as Array<Record<string, unknown>>) ?? []).map(t => `${t.task_id}${t.ambient ? "(ambient)" : ""}`);
        memberships.push(ids.join(",") || "(empty)");
        log(`background_tasks_changed [step=${phaseStep}]: ${ids.join(",") || "(empty)"}`);
      }
      if (msg.type === "assistant") {
        for (const b of ((msg.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>) ?? []) {
          if (b.type === "text" && String(b.text).trim()) log("assistant:", String(b.text).trim().slice(0, 100));
        }
      }
      if (msg.type === "result") {
        log(`result subtype=${msg.subtype} [step=${phaseStep}]`);
        if (phaseStep === "starting") {
          phaseStep = "interrupting";
          push("Run this exact bash command in the FOREGROUND (run_in_background false) and then reply DONE: sleep 30; echo ok");
          void (async () => {
            await sleep(6_000);
            log("calling interrupt() while turn 2 runs...");
            try { await (q as { interrupt(): Promise<void> }).interrupt(); log("interrupt() resolved"); }
            catch (e) { log("interrupt() threw:", String((e as Error).message).slice(0, 160)); }
            phaseStep = "post-interrupt";
            await sleep(5_000);
            if (declare && bgTaskId) {
              log(`calling stopTask(${bgTaskId})...`);
              try { await (q as { stopTask(id: string): Promise<void> }).stopTask(bgTaskId); log("stopTask resolved"); }
              catch (e) { log("stopTask threw:", String((e as Error).message).slice(0, 160)); }
              phaseStep = "stopped";
            }
            await sleep(4_000);
            end();
          })();
        }
      }
    }
  })();
  await consume.catch(e => log("stream error:", String((e as Error).message).slice(0, 200)));
  log(`--- ${tag} verdict ---`);
  log("bg task id:", bgTaskId ?? "(never seen)");
  log("membership trace:", JSON.stringify(memberships));
}

await phase("A-declared", true);
await phase("B-undeclared", false);
log("DONE");
process.exit(0);
