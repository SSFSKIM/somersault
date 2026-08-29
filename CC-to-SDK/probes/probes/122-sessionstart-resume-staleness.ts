// Probe 122 — Do the 0.3.251 SessionStart resume-staleness fields arrive on a headless resume?
//
// sdk.d.ts 0.3.251 adds four resume/fork-only fields to SessionStartHookInput:
//   seconds_since_last_response · context_tokens · prompt_cache_likely_expired · estimated_cache_write_usd
// If alive headlessly, the daemon's restart-resume path can report the re-cache cost it is about to
// pay before it pays it. Two runs: a fresh session (control: fields must be ABSENT, source
// 'startup'), then a resume of it after a short wait (fields expected PRESENT, source 'resume').
//
// Run from CC-to-SDK/probes:  npx tsx probes/122-sessionstart-resume-staleness.ts
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

const log = (...a: unknown[]) => console.log("[p122]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (240s)"); process.exit(2); }, 240_000).unref?.();

const STALENESS_KEYS = ["seconds_since_last_response", "context_tokens", "prompt_cache_likely_expired", "estimated_cache_write_usd"] as const;

async function run(tag: string, resume?: string): Promise<string> {
  const inputs: Record<string, unknown>[] = [];
  let sessionId = "";
  const q = query({
    prompt: `Reply with exactly: OK-${tag}`,
    options: {
      model: "haiku",
      cwd: process.cwd(),
      settingSources: [],
      maxTurns: 1,
      ...(resume ? { resume } : {}),
      hooks: {
        SessionStart: [{ hooks: [async (input: Record<string, unknown>) => { inputs.push(input); return {} as never; }] }],
      },
    } as never,
  });
  for await (const m of q as AsyncIterable<Record<string, unknown>>) {
    if (m.type === "system" && m.subtype === "init") sessionId = m.session_id as string;
    if (m.type === "result") break;
  }
  log(`--- ${tag} ---`);
  if (!inputs.length) log("SessionStart hook: NEVER FIRED");
  for (const i of inputs) {
    log("SessionStart input:", JSON.stringify(i));
    log("source:", i.source, "| staleness fields:", STALENESS_KEYS.map(k => `${k}=${k in i ? JSON.stringify(i[k]) : "(absent)"}`).join(" "));
  }
  return sessionId;
}

const id = await run("fresh");
log("fresh session id:", id);
log("waiting 8s so seconds_since_last_response has something to measure...");
await new Promise(r => setTimeout(r, 8_000));
await run("resume", id);
log("DONE");
process.exit(0);
