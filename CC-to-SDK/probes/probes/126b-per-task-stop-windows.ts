// Probe 126b — perTaskStopAffordance interrupt semantics, with attribution windows (126 redo).
//
// 126's finding was real but unattributable: the empty background_tasks_changed raced between
// interrupt() and stopTask(), and phase B's model refused its slow second turn, so the kill path was
// never cleanly observed. This redo removes the second turn entirely and inserts measured waits:
//
//   ONE turn: start a background sleep 90, then a foreground sleep 30 in the SAME turn.
//   t0 task_started(bg)  →  +4s interrupt() (aborts the running turn)
//   WINDOW 1 (10s, no controls in flight): does membership still hold the bg task?
//     declared   → expect HELD (interrupt spares background tasks)
//     undeclared → expect EMPTIED (fail-closed kill on interrupt)
//   then (declared only) stopTask(id) → WINDOW 2 (6s): expect EMPTIED by the stop control.
//
// Run from CC-to-SDK/probes:  npx tsx probes/126b-per-task-stop-windows.ts
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

const log = (...a: unknown[]) => console.log("[p126b]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (420s)"); process.exit(2); }, 420_000).unref?.();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function phase(tag: string, declare: boolean): Promise<void> {
  log(`===== phase ${tag} (perTaskStopAffordance: ${declare}) =====`);
  let notify: (() => void) | null = null;
  let done = false;
  const end = () => { done = true; notify?.(); };
  async function* input() {
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: "Do these two Bash tool calls in order: first run `sleep 90` with run_in_background true; "
          + "second run `sleep 30` normally (foreground). Then reply DONE.",
      },
      parent_tool_use_id: null, session_id: "x",
    };
    while (!done) await new Promise<void>(r => { notify = r; });
  }

  const q = query({
    prompt: input() as never,
    options: {
      model: "claude-sonnet-4-5",
      cwd: process.cwd(),
      settingSources: [],
      permissionMode: "bypassPermissions",
      maxTurns: 4,
      ...(declare ? { perTaskStopAffordance: true } : {}),
    } as never,
  });

  let bgTaskId: string | null = null;
  let membership: string[] = [];
  let membershipStamp = "never";
  let step = "pre-interrupt";
  const consume = (async () => {
    for await (const m of q as AsyncIterable<Record<string, unknown>>) {
      const msg = m as Record<string, unknown>;
      if (msg.type === "system" && msg.subtype === "task_started" && msg.task_type === "local_bash") {
        if (!bgTaskId) { bgTaskId = String(msg.task_id); log(`task_started local_bash ${bgTaskId} is_backgrounded=${JSON.stringify(msg.is_backgrounded)}`); }
      }
      if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
        membership = ((msg.tasks as Array<Record<string, unknown>>) ?? []).map(t => String(t.task_id));
        membershipStamp = step;
        log(`background_tasks_changed [${step}]: ${membership.join(",") || "(empty)"}`);
      }
      if (msg.type === "result") log(`result subtype=${msg.subtype} [${step}]`);
    }
  })().catch(e => log("stream end:", String((e as Error).message).slice(0, 140)));

  // Drive the timeline from outside the stream loop.
  await (async () => {
    const t0 = Date.now();
    while (!bgTaskId && Date.now() - t0 < 90_000) await sleep(300);
    if (!bgTaskId) { log("bg task never started — phase void"); end(); return; }
    await sleep(4_000);
    step = "interrupt";
    log("interrupt()...");
    try { await (q as { interrupt(): Promise<void> }).interrupt(); log("interrupt() resolved"); }
    catch (e) { log("interrupt() threw:", String((e as Error).message).slice(0, 140)); }
    step = "window1";
    await sleep(10_000);
    const held = membership.includes(bgTaskId);
    log(`WINDOW 1 verdict: task ${held ? "HELD (spared)" : membershipStamp === "never" ? "unknown (no membership frame yet)" : "GONE (killed)"}; last membership [${membershipStamp}] = ${membership.join(",") || "(empty)"}`);
    if (declare) {
      step = "stoptask";
      log(`stopTask(${bgTaskId})...`);
      try { await (q as { stopTask(id: string): Promise<void> }).stopTask(bgTaskId); log("stopTask resolved"); }
      catch (e) { log("stopTask threw:", String((e as Error).message).slice(0, 140)); }
      step = "window2";
      await sleep(6_000);
      log(`WINDOW 2 verdict: task ${membership.includes(bgTaskId) ? "STILL PRESENT" : "GONE"}; last membership [${membershipStamp}] = ${membership.join(",") || "(empty)"}`);
    }
    end();
  })();
  await consume;
}

await phase("A-declared", true);
await phase("B-undeclared", false);
log("DONE");
process.exit(0);
