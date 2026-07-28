// Probe 68 — the C5 Esc-Esc rewind chain, anchored on USER-PROMPT uuids (the picker's anchor).
//
// Probes 37/37b settled destructive-vs-fork on ASSISTANT uuids; rewindFiles was Wave-1-verified on
// user-prompt uuids. C5's picker selects a USER prompt and drives BOTH restores from that one anchor,
// so four premises must hold live before the spec builds on them:
//   Q1  getSessionMessages rows: do user PROMPT rows carry a uuid, distinguishable from tool_result rows?
//   Q2  rewindFiles(userUuid) on 0.3.211: dryRun shape + real revert on disk.
//   Q3  resume + resumeSessionAt(userUuid): accepted? INCLUSIVE or EXCLUSIVE of the anchored prompt?
//       (CC semantics need "rewind to just before that prompt" — an off-by-one here corrupts the picker.)
//   Q4  after the in-place rewind, does getSessionMessages show the truncated transcript (anchor refresh)?
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "probe68-"));
const file = join(dir, "v.txt");
console.log("=== PROBE 68 rewind on user-prompt anchors ===\ncwd:", dir);

async function turn(prompt: string, options: Record<string, unknown> = {}) {
  let sessionId: string | undefined; let finalText = "";
  const q = query({
    prompt,
    options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", cwd: dir,
               maxTurns: 6, settingSources: [], enableFileCheckpointing: true, ...options },
  });
  for await (const m of q) {
    if (m.type === "system" && (m as any).subtype === "init") sessionId = (m as any).session_id;
    if ("result" in m) { finalText = String((m as any).result || "").slice(0, 120); break; }
  }
  return { sessionId, finalText, q };
}

const t1 = await turn(`Create the file ${file} containing exactly the text VERSION_ONE (no newline). Then say DONE-1.`);
const sid = t1.sessionId!;
const t2 = await turn(`Overwrite ${file} so it contains exactly VERSION_TWO (no newline). Then say DONE-2.`, { resume: sid });
console.log("[build] sid:", sid, "|", t2.finalText, "| disk now:", readFileSync(file, "utf8"));

// Q1 — resolve user-prompt uuids from the persisted transcript
const msgs = await getSessionMessages(sid);
const rows = (msgs as any[]).map((m) => ({
  type: m.type, uuid: m.uuid,
  isToolResult: Array.isArray(m.message?.content) && m.message.content.some((b: any) => b.type === "tool_result"),
  text: typeof m.message?.content === "string" ? m.message.content.slice(0, 60)
      : m.message?.content?.find?.((b: any) => b.type === "text")?.text?.slice(0, 60),
}));
const prompts = rows.filter((r) => r.type === "user" && !r.isToolResult && r.uuid);
console.log(`[Q1] rows=${rows.length} user-prompt rows w/ uuid=${prompts.length}`);
for (const p of prompts) console.log(`     ${p.uuid}  "${p.text}"`);
if (prompts.length < 2) { console.log("[Q1] FAIL — cannot resolve user-prompt anchors"); process.exit(1); }
const anchor2 = prompts[prompts.length - 1].uuid; // the VERSION_TWO prompt — rewinding here should undo turn 2

// Q2 — rewindFiles on the user-prompt uuid: dryRun shape, then the real revert
const t3 = await turn("Say exactly: PING", { resume: sid });
try {
  const dry = await (t3.q as any).rewindFiles(anchor2, { dryRun: true });
  console.log("[Q2] dryRun →", JSON.stringify(dry));
  const real = await (t3.q as any).rewindFiles(anchor2);
  console.log("[Q2] rewindFiles →", JSON.stringify(real), "| disk after:", readFileSync(file, "utf8"));
} catch (e: any) { console.log("[Q2] THREW:", e?.message); }
await (t3.q as any).close?.();

// Q3 — in-place conversation rewind at the user-prompt uuid; inclusive or exclusive?
const t4 = await turn(
  "Without using any tools, answer: what was the LAST file-content instruction you were given before this message? Answer with just the version word.",
  { resume: sid, resumeSessionAt: anchor2 });
console.log("[Q3] resumeSessionAt(userUuid) accepted; model recalls:", t4.finalText);
console.log("     (VERSION_ONE ⇒ EXCLUSIVE — anchor prompt itself removed; VERSION_TWO ⇒ INCLUSIVE)");

// Q4 — does the persisted transcript now reflect the truncation?
const after = await getSessionMessages(t4.sessionId ?? sid);
const promptsAfter = (after as any[]).filter((m) =>
  m.type === "user" && m.uuid &&
  !(Array.isArray(m.message?.content) && m.message.content.some((b: any) => b.type === "tool_result")));
console.log(`[Q4] user-prompt rows after in-place rewind: ${promptsAfter.length} (was ${prompts.length} + PING + Q3)`);
console.log(`     same session id: ${(t4.sessionId ?? sid) === sid}`);
