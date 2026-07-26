// Probe 57 (spike for Goal A) — can we correct the auto-written registry row via env?
//
// Probe 56 showed an SDK-spawned session writes ~/.claude/sessions/<pid>.json itself, but with
// kind:"interactive" and a DERIVED name ("probes-80", nameSource:"derived"). For `ccx --bg` those are
// both wrong: a background worker must read as kind:"bg" with the name its spawner chose, or the
// fleet view is useless. The 2.1.220 binary declares CLAUDE_CODE_SESSION_NAME and
// CLAUDE_CODE_SESSION_KIND. If they take effect, Goal A needs to write NO registry state of its own.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".claude", "sessions");
const before = new Set(readdirSync(DIR));
const WANT_NAME = "ccx-spike-worker";
const WANT_KIND = "bg";

console.log("=== PROBE 57 registry identity via env ===");
console.log(`requesting name=${WANT_NAME} kind=${WANT_KIND}`);

let release!: () => void;
const gate = new Promise<void>((r) => (release = r));
async function* prompts() {
  yield { type: "user" as const, session_id: "", parent_tool_use_id: null, message: { role: "user" as const, content: "Reply with exactly: OK" } };
  await gate;
}

const q = query({
  prompt: prompts(),
  options: {
    model: "claude-haiku-4-5-20251001",
    permissionMode: "bypassPermissions",
    // NB: the SDK REPLACES the subprocess env with this object, so spread process.env first
    // or the CLI loses PATH/HOME/credentials.
    env: { ...process.env, CLAUDE_CODE_SESSION_NAME: WANT_NAME, CLAUDE_CODE_SESSION_KIND: WANT_KIND } as Record<string, string>,
  },
});

let row: any;
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    for (const f of readdirSync(DIR)) {
      if (before.has(f)) continue;
      try {
        const j = JSON.parse(readFileSync(join(DIR, f), "utf8"));
        if (j.entrypoint === "sdk-cli") row = j;
      } catch {}
    }
    console.log("row:", row ? JSON.stringify(row) : "(none found)");
    release();
  }
  if ("result" in m) break;
}

const nameOk = row?.name === WANT_NAME;
const kindOk = row?.kind === WANT_KIND;
console.log("");
console.log(`  name : got ${JSON.stringify(row?.name)} (nameSource=${JSON.stringify(row?.nameSource)}) -> ${nameOk ? "HONORED" : "IGNORED"}`);
console.log(`  kind : got ${JSON.stringify(row?.kind)} -> ${kindOk ? "HONORED" : "IGNORED"}`);
console.log("");
console.log(nameOk && kindOk
  ? "VERDICT: identity is env-controllable — Goal A writes NO registry state of its own"
  : nameOk || kindOk
    ? "VERDICT: PARTIAL — one lever works, the other needs our own row/patch"
    : "VERDICT: env ignored — Goal A must own its registry rows");
console.log(nameOk && kindOk ? "RESULT: PASS" : "RESULT: FAIL");
