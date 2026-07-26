// Probe 60 — Does an env-set name/kind survive all the way into the real `claude agents` view?
// Probe 57 proved env -> disk row; probe 56b proved disk row -> agents view. Acceptance 4 needs the
// composition, and the binary whitelists `kind`, so this confirms "bg" is not silently dropped.
//
// VERDICT: PASS — the name survives verbatim and the kind survives, but two things the first draft of
// this probe got wrong had to be corrected first. Both are findings, not workarounds:
//
//  1. THE VIEW RENDERS kind "bg" AS "background". On disk the row is exactly {kind:"bg"} (probe 57's
//     enum), but `claude agents --json --all` projects it as kind:"background". Asserting the literal
//     "bg" in the view fails while the kind is in fact honored: without CLAUDE_CODE_SESSION_KIND the
//     same row reads kind:"interactive", with it, "background".
//
//  2. AN AMBIENT CLAUDE_JOB_DIR ABSORBS THE SESSION INTO SOMEONE ELSE'S JOB. When this probe is run
//     from inside a Claude Code session, the parent's CLAUDE_JOB_DIR=~/.claude/jobs/<jobId> is
//     inherited through `...process.env`. A child that also declares kind=bg then adopts that jobId
//     (the disk row gains "jobId":"<parent's>"), and the agents view renders the row from the JOB
//     record — so it carries the job's name and state, and our session is not findable by its own
//     pid, sessionId, or name. Observed verbatim, twice:
//       DISK ROW: {...,"kind":"bg","name":"ccx-diag60-1g6oa7","jobId":"475ad71d"}
//       match by pid: none / match by sessionId: none / match by name: none
//     This is NOT only a test artifact: doperpowers' daemon-spawn.sh is itself run by a Claude Code
//     agent, so a real `ccx --bg` inherits the same variable. The spawn path must scrub it, which is
//     what the delete below models.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";

const NAME = `ccx-probe60-${Date.now().toString(36).slice(-6)}`;
// Model what ccx --bg must do: do not let a parent agent's job identity leak into our session.
const childEnv = { ...process.env } as Record<string, string>;
delete childEnv.CLAUDE_JOB_DIR;

let release!: () => void;
const gate = new Promise<void>((r) => (release = r));
async function* prompts() {
  yield { type: "user" as const, session_id: "", parent_tool_use_id: null, message: { role: "user" as const, content: "Reply with exactly: OK" } };
  await gate;
}
const q = query({ prompt: prompts(), options: {
  model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions",
  env: { ...childEnv, CLAUDE_CODE_SESSION_NAME: NAME, CLAUDE_CODE_SESSION_KIND: "bg" },
} });

console.log("=== PROBE 60 env identity -> agents view ===  name:", NAME);
let hit: any;
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    let rows: any[] = [];
    try { rows = JSON.parse(execFileSync("claude", ["agents", "--json", "--all"], { encoding: "utf8", timeout: 30000 })); }
    catch (e: any) { console.log("claude agents failed:", e.message); }
    hit = rows.find((r) => r.name === NAME);
    console.log("rows:", rows.length);
    console.log("our row:", hit ? JSON.stringify(hit) : "NOT LISTED");
    release();
  }
  if ("result" in m) break;
}
console.log("");
console.log(`name survived: ${hit?.name === NAME}`);
console.log(`kind survived: ${hit?.kind === "background"}  (on-disk "bg" renders as "background")`);
console.log(`keys present : ${hit ? Object.keys(hit).join(",") : "-"}`);
console.log(hit?.name === NAME && hit?.kind === "background" ? "RESULT: PASS" : "RESULT: FAIL");
