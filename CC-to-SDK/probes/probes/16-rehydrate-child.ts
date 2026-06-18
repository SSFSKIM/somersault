// Probe 16 (child half) — runs as a SEPARATE OS process. Receives a session_id as argv[2],
// resumes it via `resume`, and asks for the codeword the PARENT process planted. Its stdout is
// the proof: if the resumed transcript carried the codeword across the process boundary, the
// model echoes it here even though THIS process never created (or saw) the original session.
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = "claude-haiku-4-5-20251001";
const sid = process.argv[2];
if (!sid) { console.error("usage: 16-rehydrate-child.ts <session_id>"); process.exit(2); }

let answer = "";
for await (const m of query({
  prompt: "What was the secret codeword I asked you to remember earlier? Reply with ONLY that word.",
  options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 1, resume: sid },
})) {
  if (m.type === "system" && (m as any).subtype === "init") console.error("child init session_id:", (m as any).session_id);
  if ("result" in m) answer = (m as any).result ?? "";
}
// The ONLY thing the parent reads from stdout:
process.stdout.write("CHILD_ANSWER=" + JSON.stringify(answer) + "\n");
