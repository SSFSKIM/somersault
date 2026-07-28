// Probe 68b — pre-plan verifications from the C5 spec review (2026-07-28):
//   F1  Anchor-filter precision: probe 68's session held only plain prompts. A real REPL transcript
//       also carries CLI slash-command echoes, compact boundaries/summaries, and hook/meta rows. Dump
//       the FULL shape of every transcript row across those species — what flags distinguish a real
//       user prompt (isMeta? subtype? userType?) — and root-cause 68's Q4 "expected 2, saw 3" wrinkle
//       by dumping rows before AND after the in-place rewind.
//   F2  What does rewindFiles({dryRun:true}) return when checkpointing is OFF — {canRewind:false} or
//       a throw? (Needs a LIVE query: streaming input holds the transport open — 68 Q2's lesson.)
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "probe68b-"));
console.log("=== PROBE 68b rewind row species + no-checkpoint dryRun ===\ncwd:", dir);

function rowBrief(m: any) {
  const { message, ...rest } = m;
  const text = typeof message?.content === "string" ? message.content
    : message?.content?.map?.((b: any) => b.type === "text" ? b.text : `<${b.type}>`).join(" ");
  return { ...rest, role: message?.role, text: String(text ?? "").replace(/\s+/g, " ").slice(0, 80) };
}
async function dump(label: string, sid: string) {
  const msgs = (await getSessionMessages(sid)) as any[];
  console.log(`\n--- ${label}: ${msgs.length} rows ---`);
  for (const m of msgs) console.log(JSON.stringify(rowBrief(m)));
  return msgs;
}

async function turn(prompt: string, options: Record<string, unknown> = {}) {
  let sessionId: string | undefined;
  for await (const m of query({
    prompt,
    options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", cwd: dir,
               maxTurns: 6, settingSources: [], enableFileCheckpointing: true, ...options },
  })) {
    if (m.type === "system" && (m as any).subtype === "init") sessionId = (m as any).session_id;
    if ("result" in m) break;
  }
  return sessionId!;
}

// F1 — build a row-diverse session: plain prompt · file-edit prompt · CLI slash command · compact
const file = join(dir, "v.txt");
const sid = await turn(`Create ${file} containing exactly VERSION_ONE. Say DONE-1.`);
await turn(`Overwrite ${file} to contain exactly VERSION_TWO. Say DONE-2.`, { resume: sid });
await turn("/compact", { resume: sid });                          // CLI command echo + boundary/summary rows
await turn("Say exactly: AFTER-COMPACT", { resume: sid });
const before = await dump("BEFORE rewind (all rows, full flags)", sid);

const naive = before.filter((m: any) => m.type === "user" && m.uuid &&
  !(Array.isArray(m.message?.content) && m.message.content.some((b: any) => b.type === "tool_result")));
console.log(`\n[F1] probe-68 naive filter admits ${naive.length} rows as "anchors":`);
for (const m of naive) console.log("     ", JSON.stringify(rowBrief(m)));

// Q4 root-cause: in-place rewind at the VERSION_TWO prompt, then dump again
const anchor2 = naive.find((m: any) => /VERSION_TWO/.test(JSON.stringify(m.message?.content)))?.uuid;
console.log(`\n[Q4] in-place rewind at ${anchor2}`);
await turn("Without tools: which VERSION word was the last you were instructed to write?", { resume: sid, resumeSessionAt: anchor2 });
await dump("AFTER rewind (root-cause the extra row)", sid);

// F2 — dryRun with checkpointing OFF, on a live streaming-input query
console.log("\n[F2] dryRun with enableFileCheckpointing:false on a LIVE query");
const held = new Promise<never>(() => {});
async function* input(): AsyncGenerator<any> {
  yield { type: "user", message: { role: "user", content: `Create ${join(dir, "w.txt")} containing NOCHECKPOINT. Say DONE.` },
          parent_tool_use_id: null, session_id: "pending" };
  await held;
}
const q2 = query({ prompt: input(), options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions",
  cwd: dir, maxTurns: 6, settingSources: [], enableFileCheckpointing: false } });
let uuid2: string | undefined; let sid2: string | undefined;
for await (const m of q2) {
  if (m.type === "system" && (m as any).subtype === "init") sid2 = (m as any).session_id;
  if ("result" in m) break;
}
const rows2 = (await getSessionMessages(sid2!)) as any[];
uuid2 = rows2.find((m: any) => m.type === "user" && m.uuid && /NOCHECKPOINT/.test(JSON.stringify(m.message?.content)))?.uuid;
try {
  const dry = await (q2 as any).rewindFiles(uuid2, { dryRun: true });
  console.log("[F2] dryRun RETURNED:", JSON.stringify(dry));
} catch (e: any) { console.log("[F2] dryRun THREW:", e?.message); }
try { const real = await (q2 as any).rewindFiles(uuid2); console.log("[F2] real rewind RETURNED:", JSON.stringify(real)); }
catch (e: any) { console.log("[F2] real rewind THREW:", e?.message); }
await (q2 as any).close?.();
process.exit(0);
