// Probe 121 — Do the 0.3.251 PreModelSwitch/PostModelSwitch hook events fire HEADLESSLY?
//
// The 0.3.237→0.3.251 bump's headline drift: two new HOOK_EVENTS with cost-governance payloads
// (from_model/to_model/requested_model/source/context_tokens/prompt_cache_warm/cache_ttl/
// estimated_cache_write_usd/pricing). Their own jsdoc says source 'sdk' covers "headless set_model
// (SDK, Remote Control, IDE)" — so unlike most of the 22 dead hook events these SHOULD fire on the
// SDK transport, but declared ≠ reachable (the A1 lesson; only 8/30 events fired in the last census).
//
//   Q1  ALLOW PATH. A streaming session on haiku registers both hooks, runs turn 1, calls
//       q.setModel("sonnet") between turns, runs turn 2. Do Pre and Post fire? With which payload
//       fields? Does turn 2's assistant frame actually run on the new model?
//   Q2  DENY PATH. Same shape, but the Pre hook answers permissionDecision:"deny". Is the switch
//       cancelled (turn 2 still on haiku)? Does setModel() throw or resolve? Does Post still fire?
//   Q3  ASK PATH. Pre answers "ask". The doc says a headless session REFUSES the switch instead of
//       prompting. Observed behavior?
//
// Run from CC-to-SDK/probes:  npx tsx probes/121-model-switch-hooks.ts
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

const log = (...a: unknown[]) => console.log("[p121]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (420s)"); process.exit(2); }, 420_000).unref?.();

type Fired = { event: string; input: Record<string, unknown> };

async function phase(tag: string, decision: "allow" | "deny" | "ask" | "none"): Promise<void> {
  log(`===== phase ${tag} (pre answers: ${decision}) =====`);
  const fired: Fired[] = [];
  const models: string[] = [];      // resolved model of each assistant frame, in order
  let setModelError: string | null = null;

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

  const record = (event: string) => async (input: Record<string, unknown>) => {
    fired.push({ event, input });
    log(`${event} FIRED:`, JSON.stringify(input));
    if (event === "PreModelSwitch" && decision !== "none") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreModelSwitch",
          permissionDecision: decision,
          permissionDecisionReason: `probe121-${decision}`,
        },
      } as never;
    }
    return {} as never;
  };

  push("Reply with exactly: OK1");
  const q = query({
    prompt: input() as never,
    options: {
      model: "haiku",
      cwd: process.cwd(),
      settingSources: [],
      maxTurns: 4,
      hooks: {
        PreModelSwitch: [{ hooks: [record("PreModelSwitch")] }],
        PostModelSwitch: [{ hooks: [record("PostModelSwitch")] }],
      },
    } as never,
  });

  let turns = 0;
  const consume = (async () => {
    for await (const m of q as AsyncIterable<Record<string, never>>) {
      const msg = m as Record<string, unknown>;
      if (msg.type === "assistant") {
        const model = (msg.message as Record<string, unknown> | undefined)?.model as string | undefined;
        if (model) { models.push(model); log("assistant on model:", model); }
      } else if (msg.type === "result") {
        turns++;
        log(`result #${turns} subtype=${msg.subtype}`);
        if (turns === 1) {
          try { await (q as { setModel(m?: string): Promise<void> }).setModel("sonnet"); log("setModel(sonnet) resolved"); }
          catch (e) { setModelError = String((e as Error).message ?? e).slice(0, 200); log("setModel(sonnet) THREW:", setModelError); }
          push("Reply with exactly: OK2");
        } else {
          end();
        }
      }
    }
  })();
  await consume.catch(e => log("stream error:", String((e as Error).message).slice(0, 200)));

  log(`--- ${tag} verdict ---`);
  log("hooks fired:", fired.map(f => f.event).join(", ") || "NONE");
  log("assistant models in order:", JSON.stringify(models));
  log("setModel error:", setModelError ?? "(none)");
  const pre = fired.find(f => f.event === "PreModelSwitch");
  if (pre) {
    const keys = Object.keys(pre.input).sort();
    log("Pre payload keys:", keys.join(","));
  }
}

await phase("A-allow", "none");     // no decision returned: pure observation
await phase("B-deny", "deny");
await phase("C-ask", "ask");
log("DONE");
process.exit(0);
