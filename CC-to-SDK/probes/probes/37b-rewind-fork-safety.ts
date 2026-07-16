// Probe 37b — forkSession + resumeSessionAt (the NON-destructive rewind recipe).
//
// Probe 37 findings: in-place rewind (resume+resumeSessionAt) WORKS headlessly but DESTRUCTIVELY
// truncates the persisted transcript at the anchor (post-anchor turns unrecoverable — Q4's rewind
// even destroyed Q1's anchor uuid, erroring r3 with "No message found with message.uuid of: X").
// 37 never got a clean answer on the fork interplay. This settles the safe-branch recipe:
//   1. Does { resume, resumeSessionAt, forkSession: true } branch into a NEW session id whose context
//      ends at the anchor (GRANITE known, BASALT not)?
//   2. Is the ORIGINAL transcript left intact (BASALT still present, anchor uuid still resolvable)?
// If yes ⇒ Session.rewindTo can offer {fork:true} for undo-able time-travel and default to the
// destructive in-place branch only when explicitly requested (or vice versa — product call).
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe37b-"));
console.log("=== PROBE 37b rewind fork safety ===\ncwd:", dir);

async function run(prompt: string, options: Record<string, unknown> = {}) {
  let sessionId: string | undefined; let finalText = ""; const assistantUuids: string[] = [];
  for await (const m of query({
    prompt,
    options: { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 3, ...options },
  })) {
    if (m.type === "system" && (m as any).subtype === "init") sessionId = (m as any).session_id;
    if (m.type === "assistant" && (m as any).uuid) assistantUuids.push((m as any).uuid);
    if ("result" in m) finalText = String((m as any).result || "");
  }
  return { sessionId, finalText, assistantUuids };
}

const t1 = await run("Remember: the FIRST codeword is GRANITE. Acknowledge with exactly: OK-1");
const sid = t1.sessionId!;
const anchor = t1.assistantUuids.at(-1)!;
await run("Remember: the SECOND codeword is BASALT. Acknowledge with exactly: OK-2", { resume: sid });
console.log("[build] sid:", sid, "| anchor:", anchor);

const RECALL = "List every codeword you have been told in this conversation, comma-separated, nothing else.";
const fork = await run(RECALL, { resume: sid, resumeSessionAt: anchor, forkSession: true });
const ft = fork.finalText.toUpperCase();
console.log("\n[1] fork-rewind → sid:", fork.sessionId, "| NEW id:", fork.sessionId !== sid,
  "| GRANITE:", ft.includes("GRANITE"), "| BASALT (want false):", ft.includes("BASALT"),
  "| recall:", brief(fork.finalText, 120));

const orig: any[] = await getSessionMessages(sid, { dir } as any).catch((e) => (console.log("orig read threw:", String(e)), []));
const origJson = JSON.stringify(orig);
console.log("[2] original after fork-rewind: msgs:", orig.length,
  "| BASALT intact:", origJson.includes("BASALT"), "| anchor uuid intact:", origJson.includes(anchor));

const forked: any[] = fork.sessionId && fork.sessionId !== sid
  ? await getSessionMessages(fork.sessionId, { dir } as any).catch(() => []) : [];
console.log("[3] forked transcript msgs:", forked.length, "| contains BASALT (want false):", JSON.stringify(forked).includes("BASALT"));

console.log("\n=== VERDICT ===");
const safe = fork.sessionId !== sid && ft.includes("GRANITE") && !ft.includes("BASALT") && origJson.includes("BASALT");
console.log(safe
  ? "SAFE BRANCH ✅ : forkSession+resumeSessionAt = non-destructive rewind (new id, anchored context, original intact)."
  : "NOT SAFE ❌ : see [1]-[3] — fork interplay does not give a clean branch.");
process.exit(0);
