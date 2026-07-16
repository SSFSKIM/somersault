// Probe 37 — `resumeSessionAt` (Wave 1 keystone: conversation rewind / Esc-Esc time-travel).
//
// Declared surface (sdk.d.ts 0.3.211, Options.resumeSessionAt): "When resuming, only resume messages
// up to and including the message with this UUID. Use with `resume`. The message ID should be from
// SDKAssistantMessage.uuid." Declared ≠ reachable — and even if reachable, the DESIGN-blocking
// questions for Session.rewindTo(messageId, {files?}) are semantic:
//
//   1. REACHABLE? Does the rewound resume actually drop post-anchor turns from the model's context
//      (recall test: codeword from turn 1 visible, codeword from turn 2 GONE)?
//   2. DESTRUCTIVE? After the rewound resume, does getSessionMessages(originalSid) still contain the
//      turn-2 messages, or did the branch truncate the persisted transcript? (Decides whether
//      rewindTo must force forkSession to be safe, or is safe in place.)
//   3. SAME ID? Does the rewound query keep the original session_id (in-place branch) or mint a new one?
//   4. ANCHOR TYPE? Declared: assistant-message uuid. But file checkpoints (rewindFiles) anchor at
//      USER-prompt uuids (the incr-"rewind" lesson). Does a user-message uuid work too, or error?
//      (Decides whether compound conversation+files rewind needs a uuid mapping layer.)
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe37-"));
console.log("=== PROBE 37 resumeSessionAt ===\ncwd:", dir);

interface Run {
  sessionId?: string;
  result?: any;
  // live-stream uuids in arrival order, per type
  assistantUuids: string[];
  userUuids: string[];
  finalText: string;
}

async function run(prompt: string, options: Record<string, unknown> = {}): Promise<Run> {
  const r: Run = { assistantUuids: [], userUuids: [], finalText: "" };
  for await (const m of query({
    prompt,
    options: { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 3, ...options },
  })) {
    if (m.type === "system" && (m as any).subtype === "init") r.sessionId = (m as any).session_id;
    if (m.type === "assistant" && (m as any).uuid) r.assistantUuids.push((m as any).uuid);
    if (m.type === "user" && (m as any).uuid) r.userUuids.push((m as any).uuid);
    if ("result" in m) { r.result = m; r.finalText = String((m as any).result || ""); }
  }
  return r;
}

// ---- Build a 2-turn session: turn 1 plants GRANITE, turn 2 plants BASALT. ----
const t1 = await run("Remember: the FIRST codeword is GRANITE. Acknowledge with exactly: OK-1");
const sid = t1.sessionId!;
console.log("\n[build] turn1 sid:", sid, "| assistant uuids:", t1.assistantUuids.length, "| user uuids:", t1.userUuids.length);
const anchorAssistant = t1.assistantUuids[t1.assistantUuids.length - 1]; // last assistant msg of turn 1
const anchorUser = t1.userUuids[0];                                      // turn-1 user prompt (may be absent in live stream)
console.log("        anchor (assistant uuid):", anchorAssistant, "| turn-1 user uuid:", anchorUser ?? "(none in live stream)");

const t2 = await run("Remember: the SECOND codeword is BASALT. Acknowledge with exactly: OK-2", { resume: sid });
console.log("[build] turn2 resumed sid:", t2.sessionId, "| recall sanity same-session:", t2.sessionId === sid);

const beforeMsgs: any[] = await getSessionMessages(sid, { dir } as any);
const beforeHasBasalt = JSON.stringify(beforeMsgs).includes("BASALT");
console.log("[build] persisted msgs before rewind:", beforeMsgs.length, "| contains BASALT:", beforeHasBasalt);

// ---- Q1+Q3: rewind-resume at the end of turn 1; does the model still know BASALT? ----
const RECALL = "List every codeword you have been told in this conversation, comma-separated, nothing else.";
const r1 = await run(RECALL, { resume: sid, resumeSessionAt: anchorAssistant });
const r1Text = r1.finalText.toUpperCase();
console.log("\n[Q1] rewound recall:", brief(r1.finalText, 200));
console.log("     knows GRANITE:", r1Text.includes("GRANITE"), "| knows BASALT (should be FALSE if rewind works):", r1Text.includes("BASALT"));
console.log("[Q3] rewound session_id:", r1.sessionId, "| equals original:", r1.sessionId === sid);

// ---- Q2: did the rewound branch truncate the ORIGINAL persisted transcript? ----
const afterOrig: any[] = await getSessionMessages(sid, { dir } as any).catch((e) => (console.log("     getSessionMessages(orig) threw:", String(e)), []));
const afterHasBasalt = JSON.stringify(afterOrig).includes("BASALT");
console.log("\n[Q2] original transcript after rewound resume: msgs:", afterOrig.length, "(was", beforeMsgs.length + ")",
  "| still contains BASALT turn:", afterHasBasalt, afterHasBasalt ? "(non-destructive)" : "(DESTRUCTIVE TRUNCATION)");
if (r1.sessionId && r1.sessionId !== sid) {
  const branch: any[] = await getSessionMessages(r1.sessionId, { dir } as any).catch(() => []);
  console.log("     branch transcript msgs:", branch.length, "| contains BASALT:", JSON.stringify(branch).includes("BASALT"));
}

// ---- Q4: does a USER-message uuid anchor work (rewindFiles checkpoint parity)? ----
// Persisted transcripts carry uuids for user messages even when the live stream doesn't — fetch one.
const persistedUserUuid = beforeMsgs.find((m) => m.type === "user" && m.uuid)?.uuid ?? anchorUser;
let q4verdict = "SKIPPED (no user uuid found)";
if (persistedUserUuid) {
  try {
    const r2 = await run(RECALL, { resume: sid, resumeSessionAt: persistedUserUuid });
    const t = r2.finalText.toUpperCase();
    q4verdict = `accepted — recall: "${brief(r2.finalText, 120)}" (GRANITE:${t.includes("GRANITE")} BASALT:${t.includes("BASALT")}) sid:${r2.sessionId === sid ? "same" : r2.sessionId}`;
  } catch (e) {
    q4verdict = `REJECTED: ${brief(String(e), 200)}`;
  }
}
console.log("\n[Q4] user-uuid anchor (" + brief(persistedUserUuid, 40) + "):", q4verdict);

// ---- fork interplay: forkSession + resumeSessionAt (the presumed-safe branch recipe) ----
const r3 = await run(RECALL, { resume: sid, resumeSessionAt: anchorAssistant, forkSession: true });
const r3Text = r3.finalText.toUpperCase();
console.log("\n[fork] forkSession+resumeSessionAt → sid:", r3.sessionId, "| new id:", r3.sessionId !== sid,
  "| GRANITE:", r3Text.includes("GRANITE"), "| BASALT:", r3Text.includes("BASALT"));

console.log("\n=== VERDICT ===");
const rewindWorks = r1Text.includes("GRANITE") && !r1Text.includes("BASALT");
if (rewindWorks) console.log("REACHABLE ✅ : resumeSessionAt drops post-anchor context headlessly.");
else console.log("NOT WORKING ❌ : rewound resume still recalls (or lost) the wrong codewords — see [Q1].");
console.log("destructive to original transcript:", !afterHasBasalt, "| in-place session id:", r1.sessionId === sid);
process.exit(0);
