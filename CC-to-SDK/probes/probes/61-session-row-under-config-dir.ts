// Probe 61 — Where does the engine write its session registry row when CLAUDE_CONFIG_DIR is set?
//
// src/fleet/registry.ts reads <HOME>/.claude/sessions and nothing else. Probes 56 and 57 both proved
// the engine self-registers there, but both hard-coded that path and never varied the config dir. Our
// own tenant-isolation preset (src/config/tenantPreset.ts) spawns every tenant session with a
// per-tenant CLAUDE_CONFIG_DIR. If the row follows the config dir, every tenant-isolated session is
// invisible to `ccx agents` — and invisibly so, because readRegistry swallows ENOENT and returns [],
// which is indistinguishable from "no sessions running".
//
// Method: one short haiku turn started with CLAUDE_CONFIG_DIR pointed at a fresh temp dir, held open at
// system/init while both candidate directories are polled for a row carrying our unique session name.
// CLAUDE_JOB_DIR is scrubbed for the reason probe 60 records (an inherited job absorbs the session).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = mkdtempSync(join(tmpdir(), "ccx-probe61-"));
const CAND = { config: join(CONFIG_DIR, "sessions"), home: join(homedir(), ".claude", "sessions") };
const NAME = `ccx-probe61-${Date.now().toString(36).slice(-6)}`;

const snap = (d: string) => { try { return readdirSync(d); } catch { return [] as string[]; } };
const before = { config: new Set(snap(CAND.config)), home: new Set(snap(CAND.home)) };
// Identify OUR row by the name we set, not by "newest file" — the home dir has other live sessions.
function findRow(where: "config" | "home"): { file: string; row: any } | undefined {
  for (const f of snap(CAND[where])) {
    if (!/^\d+\.json$/.test(f)) continue;
    if (before[where].has(f)) continue;
    try {
      const row = JSON.parse(readFileSync(join(CAND[where], f), "utf8"));
      if (row?.name === NAME) return { file: f, row };
    } catch { /* half-written row; the next poll re-reads it */ }
  }
  return undefined;
}

console.log("=== PROBE 61 session row vs CLAUDE_CONFIG_DIR ===");
console.log("CLAUDE_CONFIG_DIR:", CONFIG_DIR);
console.log("candidate A (config):", CAND.config);
console.log("candidate B (home)  :", CAND.home);
console.log("session name        :", NAME);

const childEnv = { ...process.env } as Record<string, string>;
delete childEnv.CLAUDE_JOB_DIR;                              // probe 60: an inherited job hides the row

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
    // NB: the SDK REPLACES the subprocess env with this object — spread first or the CLI loses PATH/HOME.
    env: { ...childEnv, CLAUDE_CONFIG_DIR: CONFIG_DIR, CLAUDE_CODE_SESSION_NAME: NAME },
  },
});

let inConfig: { file: string; row: any } | undefined, inHome: { file: string; row: any } | undefined;
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    // The row is written at session start, but poll a little: init and the write are not ordered.
    for (let i = 0; i < 20 && !inConfig && !inHome; i++) {
      inConfig = findRow("config"); inHome = findRow("home");
      if (!inConfig && !inHome) await new Promise((r) => setTimeout(r, 150));
    }
    // One more sweep of the loser, so "both" is distinguishable from a race.
    inConfig ??= findRow("config"); inHome ??= findRow("home");
    release();
  }
  if ("result" in m) break;
}

console.log("");
console.log(`  <CLAUDE_CONFIG_DIR>/sessions : ${inConfig ? `${inConfig.file} -> ${JSON.stringify(inConfig.row)}` : "(no row)"}`);
console.log(`  <HOME>/.claude/sessions      : ${inHome ? `${inHome.file} -> ${JSON.stringify(inHome.row)}` : "(no row)"}`);
console.log("");
console.log(inConfig && !inHome
  ? "VERDICT: the engine HONORS CLAUDE_CONFIG_DIR — sessionsDir() must derive from it or tenant-isolated sessions are invisible"
  : inHome && !inConfig
    ? "VERDICT: the engine writes to <HOME>/.claude/sessions REGARDLESS of CLAUDE_CONFIG_DIR — sessionsDir() stays as it is"
    : inConfig && inHome
      ? "VERDICT: the row appears in BOTH locations — sessionsDir() must read both"
      : "VERDICT: INCONCLUSIVE — no row carrying our name appeared in either location");
console.log(inConfig || inHome ? "RESULT: PASS" : "RESULT: FAIL");
