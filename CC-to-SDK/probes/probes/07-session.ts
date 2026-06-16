// Probe 07 — session resume + fork. First turn establishes a secret fact;
// a resumed query recalls it; a forked session also recalls it under a new id.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const SECRET = "MAGENTA-42";

async function run(prompt: string, options: Record<string, unknown>) {
  const messages: any[] = [];
  let result: any;
  let sessionId: string | undefined;
  for await (const m of query({ prompt, options: { permissionMode: "bypassPermissions", maxTurns: 2, ...options } })) {
    messages.push(m);
    if (m.type === "system" && (m as any).subtype === "init") sessionId = (m as any).session_id;
    if ("result" in m) result = m;
  }
  return { messages, result, sessionId };
}

console.log("=== PROBE 07 session resume/fork ===");

// Turn 1: tell Claude the secret; capture session id.
const t1 = await run(
  `Remember this secret codeword: ${SECRET}. Just acknowledge with OK.`,
  { maxTurns: 1 },
);
console.log("turn1 session_id:", t1.sessionId, "| subtype:", t1.result?.subtype);

// Turn 2: resume and ask for the secret (only knowable from turn 1).
const t2 = await run("What was the secret codeword I gave you? Reply with just the codeword.", {
  resume: t1.sessionId,
});
const t2text = String(t2.result?.result || "");
const resumeRecalled = t2text.includes(SECRET);
console.log("resume recalled secret:", resumeRecalled, "| reply:", brief(t2text, 120));

// Turn 3: fork the session — should also recall, under a NEW session id.
const t3 = await run("Repeat the secret codeword I told you earlier. Just the codeword.", {
  resume: t1.sessionId,
  forkSession: true,
});
const t3text = String(t3.result?.result || "");
const forkRecalled = t3text.includes(SECRET);
const forkedNewId = !!t3.sessionId && t3.sessionId !== t1.sessionId;
console.log("fork session_id:", t3.sessionId, "| newId:", forkedNewId);
console.log("fork recalled secret:", forkRecalled, "| reply:", brief(t3text, 120));

const pass = !!t1.sessionId && resumeRecalled && forkRecalled;
console.log("resume PASS:", !!t1.sessionId && resumeRecalled);
console.log("fork PASS:", forkRecalled);
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
