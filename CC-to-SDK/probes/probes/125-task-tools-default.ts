// Probe 125 — Re-verify the task-tool default premise after Claude Code 2.1.233.
//
// The since-february ledger's rows 15.1–15.4/15.9 say TaskCreate/TaskUpdate/TaskGet/TaskList/
// TodoWrite are "present in a bare query() init tool list (runtime-verified 2026-06-16)". Changelog
// 2.1.233 then removed the todo/task tools on Opus 4.8, Sonnet 5, Fable 5 and newer, behind
// CLAUDE_CODE_ENABLE_TODO_TOOLS=1. That June verification is stale. Three bare inits:
//   A  sonnet (a "newer" model)            → expect the five tools ABSENT
//   B  sonnet + CLAUDE_CODE_ENABLE_TODO_TOOLS=1 → expect them PRESENT
//   C  haiku 4.5 (predates the cutoff)     → does the older model keep them?
// Each run aborts right after the init frame — the tool list is init-borne, no turn needed.
//
// Run from CC-to-SDK/probes:  npx tsx probes/125-task-tools-default.ts
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

const log = (...a: unknown[]) => console.log("[p125]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (240s)"); process.exit(2); }, 240_000).unref?.();

const TASK_TOOLS = ["TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TodoWrite"];

async function initTools(tag: string, model: string, env?: Record<string, string>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env ?? {})) { saved[k] = process.env[k]; process.env[k] = v; }
  const ac = new AbortController();
  const q = query({
    prompt: "Reply with exactly: OK",
    options: { model, cwd: process.cwd(), settingSources: [], maxTurns: 1, abortController: ac } as never,
  });
  let tools: string[] = [];
  let resolvedModel = "?";
  try {
    for await (const m of q as AsyncIterable<Record<string, unknown>>) {
      if (m.type === "system" && m.subtype === "init") {
        tools = (m.tools as string[]) ?? [];
        resolvedModel = String((m as Record<string, unknown>).model ?? "?");
        ac.abort(); // tool list captured; the turn itself is not needed
      }
      if (m.type === "result") break;
    }
  } catch { /* abort lands as an error end — expected */ }
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const present = TASK_TOOLS.filter(t => tools.includes(t));
  const absent = TASK_TOOLS.filter(t => !tools.includes(t));
  log(`--- ${tag} (model=${resolvedModel}, ${tools.length} tools) ---`);
  log("task tools present:", present.join(",") || "(none)");
  log("task tools absent: ", absent.join(",") || "(none)");
}

await initTools("A sonnet default", "sonnet");
await initTools("B sonnet + CLAUDE_CODE_ENABLE_TODO_TOOLS=1", "sonnet", { CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" });
await initTools("C haiku 4.5", "claude-haiku-4-5-20251001");
log("DONE");
process.exit(0);
