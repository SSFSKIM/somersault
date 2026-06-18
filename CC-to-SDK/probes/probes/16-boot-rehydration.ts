// Probe 16 — BOOT-REHYDRATION PREMISE: can a session_id persisted by one process be resumed by a
// DIFFERENT OS process that only knows the id from a file/arg? This is THE premise daemon boot-
// rehydration rests on. Spec 2 only proved resume WITHIN one supervisor instance; a daemon restart
// is a genuinely new process. We plant a codeword in process A, capture the id, then exec a SEPARATE
// `tsx` child (process B) that resumes by id and must echo the codeword. Cross-process disk-resume
// is verified iff the child's stdout carries the codeword.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const execFileP = promisify(execFile);
const MODEL = "claude-haiku-4-5-20251001";
const CODEWORD = "REHYDRATE-CODEWORD-7741";

// 1) Process A: plant the codeword, capture session_id, then let the query fully END (no shared state).
let sid: string | undefined;
for await (const m of query({
  prompt: `Remember this secret codeword exactly: ${CODEWORD}. Reply with just "OK".`,
  options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 1 },
})) {
  if (m.type === "system" && (m as any).subtype === "init") sid = (m as any).session_id;
  if ("result" in m) break;
}
console.log("=== PROBE 16 boot-rehydration (cross-process resume) ===");
console.log("process A planted codeword, session_id:", sid);
if (!sid) { console.log("RESULT: FAIL — no session_id captured"); process.exit(1); }

// 2) Process B: a brand-new OS process that knows ONLY the id. This is the faithful daemon-restart proxy.
const here = dirname(fileURLToPath(import.meta.url));
const child = join(here, "16-rehydrate-child.ts");
console.log("spawning separate process B (tsx child) to resume", sid, "...");
let stdout = "", stderr = "";
try {
  const r = await execFileP("npx", ["tsx", child, sid], { env: process.env, timeout: 120_000 });
  stdout = r.stdout; stderr = r.stderr;
} catch (e: any) {
  stdout = e.stdout ?? ""; stderr = e.stderr ?? ""; console.log("child exited non-zero:", e.message);
}
if (stderr.trim()) console.log("child stderr:", stderr.trim().split("\n").slice(-4).join(" | "));

// 3) Verdict: did the cross-process resume recall the codeword?
const m = stdout.match(/CHILD_ANSWER=(.*)$/m);
const answer = m ? JSON.parse(m[1]) : "(no answer line)";
const recalled = typeof answer === "string" && answer.includes(CODEWORD);
console.log("process B answer:", JSON.stringify(answer));
console.log("RESULT:", recalled ? "PASS — cross-process resume recalled the codeword (boot-rehydration is viable)"
                                  : "FAIL — cross-process resume did NOT recall the codeword");
process.exit(recalled ? 0 : 1);
