// Probe 123 — Does result.queued_turn_count arrive headlessly, and what does it count?
//
// sdk.d.ts 0.3.251 adds queued_turn_count to both result variants: "user-initiated sends still
// waiting in the command queue when this result was produced" — >0 promises more turns without
// further input; queued sends may COALESCE into fewer turns (it counts sends, not results).
// The daemon's turn loop could surface this on TurnOutcome ("more coming — don't idle yet").
//
// Shape: a streaming session runs a deliberately slow turn 1 (bounded shell sleep), and while it
// runs we push TWO more uuid-stamped sends. Expectations if alive:
//   result #1 → queued_turn_count 2 (B and C still queued)
//   then either two results (1, then 0) or one coalesced result (0) for B+C
// Every send carries a uuid so user_message_uuid echo confirms which send each result answers.
//
// Run from CC-to-SDK/probes:  npx tsx probes/123-queued-turn-count.ts
import { randomUUID } from "node:crypto";
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

const log = (...a: unknown[]) => console.log("[p123]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (300s)"); process.exit(2); }, 300_000).unref?.();

const uuids = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const queue: unknown[] = [];
let notify: (() => void) | null = null;
let done = false;
const push = (text: string, uuid: string) => {
  queue.push({ type: "user", uuid, message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "x" });
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

push("Run this exact bash command and then reply with exactly DONE-A: sleep 12; echo slept", uuids.a);
const q = query({
  prompt: input() as never,
  options: {
    model: "haiku",
    cwd: process.cwd(),
    settingSources: [],
    permissionMode: "bypassPermissions",
    maxTurns: 8,
  } as never,
});

let pushed = false;
let bcPushed = false;
let results = 0;
for await (const m of q as AsyncIterable<Record<string, unknown>>) {
  if (m.type === "assistant" && !pushed) {
    // Turn 1 has started producing; its sleep is running. Queue B and C now.
    pushed = true;
    setTimeout(() => {
      push("Reply with exactly: DONE-B", uuids.b);
      push("Reply with exactly: DONE-C", uuids.c);
      bcPushed = true;
      log("pushed B and C while turn 1 runs");
    }, 1_000);
  }
  if (m.type === "result") {
    results++;
    const echo = m.user_message_uuid === uuids.a ? "A" : m.user_message_uuid === uuids.b ? "B" : m.user_message_uuid === uuids.c ? "C" : m.user_message_uuid ? "?" : "(none)";
    log(`result #${results}: subtype=${m.subtype} queued_turn_count=${"queued_turn_count" in m ? JSON.stringify(m.queued_turn_count) : "(ABSENT)"} user_message_uuid→${echo} num_turns=${m.num_turns}`);
    if (results >= 3 || (results >= 2 && echo === "C")) end();
    // Give a possible trailing result a moment, then close regardless.
    if (results >= 2) setTimeout(end, 20_000);
    // FOLD OUTCOME: B and C were already queued, yet result #1 counts nothing outstanding — the sends
    // were absorbed into turn 1, so no further result is coming and nothing else would ever call end().
    if (results === 1 && bcPushed && m.queued_turn_count === 0) {
      log("fold outcome detected (queued_turn_count 0 with B+C already pushed) — closing after a 15s grace");
      setTimeout(end, 15_000);
    }
  }
}
log("stream closed after", results, "results");
log("DONE");
process.exit(0);
