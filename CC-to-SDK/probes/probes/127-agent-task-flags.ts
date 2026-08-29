// Probe 127 — task_started flags for a subagent (local_agent) spawn: is_backgrounded + spawn_depth.
//
// sdk.d.ts 0.3.251 adds to task_started: is_backgrounded ("set for local_agent and local_bash";
// foreground spawn = false, "a resumed subagent is always registered in the background") and
// spawn_depth ("1 for a top-level spawn, N+1 from inside a depth-N agent; not set on other tasks").
// Probe 126 covers the local_bash side; this one spawns a foreground subagent via the Agent tool and
// records the frame. Expectation if alive: task_type=local_agent, is_backgrounded=false, spawn_depth=1.
//
// Run from CC-to-SDK/probes:  npx tsx probes/127-agent-task-flags.ts
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

const log = (...a: unknown[]) => console.log("[p127]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (300s)"); process.exit(2); }, 300_000).unref?.();

const q = query({
  prompt: "Use the Agent tool exactly once: subagent_type \"general-purpose\", prompt \"Reply with exactly OK\". "
    + "When it returns, reply with exactly SPAWNED. Do not use any other tool.",
  options: {
    model: "haiku",
    cwd: process.cwd(),
    settingSources: [],
    permissionMode: "bypassPermissions",
    maxTurns: 4,
  } as never,
});

for await (const m of q as AsyncIterable<Record<string, unknown>>) {
  const msg = m as Record<string, unknown>;
  if (msg.type === "system" && (msg.subtype === "task_started" || msg.subtype === "task_notification" || msg.subtype === "background_tasks_changed")) {
    log(`${msg.subtype}: task_type=${msg.task_type ?? "-"} task_id=${msg.task_id ?? "-"} subagent_type=${msg.subagent_type ?? "-"} is_backgrounded=${JSON.stringify(msg.is_backgrounded)} spawn_depth=${JSON.stringify(msg.spawn_depth)} ambient=${JSON.stringify(msg.ambient)} skip_transcript=${JSON.stringify(msg.skip_transcript)}`);
  }
  if (msg.type === "result") { log(`result subtype=${msg.subtype}`); break; }
}
log("DONE");
process.exit(0);
