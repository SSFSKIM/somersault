// Probe 68c — the last two pre-plan unknowns (68b raised as much as it settled):
//   T1  The EXACT truncation rule of resumeSessionAt on a clean 3-turn session (A, B, C; rewind at
//       B's prompt; dump every row): which rows survive? 68's model-recall said "context excludes
//       B's turn" (exclusive); 68b's rewind-at-a-summary-row kept the anchor row — a phantom-anchor
//       artifact or the real rule? Only a clean row-level dump settles it, and 68's Q4 "saw 3" falls
//       out of the same dump.
//   F2  rewindFiles({dryRun}) with checkpointing OFF — called IN-LOOP on the live query this time
//       (68/68b lesson: `break` closes the transport; the control call must precede it).
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "probe68c-"));
console.log("=== PROBE 68c truncation rule + in-loop no-checkpoint dryRun ===\ncwd:", dir);

function rowBrief(m: any) {
  const text = typeof m.message?.content === "string" ? m.message.content
    : m.message?.content?.map?.((b: any) => b.type === "text" ? b.text : `<${b.type}>`).join(" ");
  return `${m.type.padEnd(9)} ${m.uuid?.slice(0, 8)} "${String(text ?? "").replace(/\s+/g, " ").slice(0, 60)}"`;
}

async function turn(prompt: string, options: Record<string, unknown> = {}, onResult?: (q: any) => Promise<void>) {
  let sessionId: string | undefined;
  const q = query({
    prompt,
    options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", cwd: dir,
               maxTurns: 6, settingSources: [], ...options },
  });
  for await (const m of q) {
    if (m.type === "system" && (m as any).subtype === "init") sessionId = (m as any).session_id;
    if ("result" in m) { if (onResult) await onResult(q); break; }
  }
  return sessionId!;
}

// T1 — three plain turns, no tools, no compact
const sid = await turn("The first codeword is ALPHA. Say OK-A.", { enableFileCheckpointing: true });
await turn("The second codeword is BRAVO. Say OK-B.", { resume: sid, enableFileCheckpointing: true });
await turn("The third codeword is CHARLIE. Say OK-C.", { resume: sid, enableFileCheckpointing: true });
const before = (await getSessionMessages(sid)) as any[];
console.log(`\n--- BEFORE (${before.length} rows) ---`);
for (const m of before) console.log(rowBrief(m));
const anchorB = before.find((m: any) => m.type === "user" && /BRAVO/.test(JSON.stringify(m.message?.content)))?.uuid;

console.log(`\n[T1] in-place rewind at B's prompt ${anchorB?.slice(0, 8)}, then ask what's recalled`);
await turn("List every codeword you know, comma-separated, nothing else.", { resume: sid, resumeSessionAt: anchorB, enableFileCheckpointing: true });
const after = (await getSessionMessages(sid)) as any[];
console.log(`--- AFTER (${after.length} rows) ---`);
for (const m of after) console.log(rowBrief(m));

// F2 — checkpointing OFF; dryRun + real rewind called before the loop breaks
console.log("\n[F2] enableFileCheckpointing:false, control calls in-loop");
const f = join(dir, "w.txt");
const sidF = await turn(`Create ${f} containing exactly NOCP-ONE. Say DONE-1.`, { enableFileCheckpointing: false });
await turn(`Overwrite ${f} to contain exactly NOCP-TWO. Say DONE-2.`, { resume: sidF, enableFileCheckpointing: false },
  async (q) => {
    const rows = (await getSessionMessages(sidF)) as any[];
    const anchor = rows.find((m: any) => m.type === "user" && /NOCP-TWO/.test(JSON.stringify(m.message?.content)))?.uuid;
    try { console.log("[F2] dryRun →", JSON.stringify(await q.rewindFiles(anchor, { dryRun: true }))); }
    catch (e: any) { console.log("[F2] dryRun THREW:", e?.message); }
    try { console.log("[F2] real →", JSON.stringify(await q.rewindFiles(anchor)), "| disk:", readFileSync(f, "utf8")); }
    catch (e: any) { console.log("[F2] real THREW:", e?.message, "| disk:", readFileSync(f, "utf8")); }
  });
// Control: same in-loop calls WITH checkpointing, to prove the harness itself is sound
console.log("\n[CTRL] enableFileCheckpointing:true, same in-loop calls");
const g = join(dir, "x.txt");
const sidG = await turn(`Create ${g} containing exactly CP-ONE. Say DONE-1.`, { enableFileCheckpointing: true });
await turn(`Overwrite ${g} to contain exactly CP-TWO. Say DONE-2.`, { resume: sidG, enableFileCheckpointing: true },
  async (q) => {
    const rows = (await getSessionMessages(sidG)) as any[];
    const anchor = rows.find((m: any) => m.type === "user" && /CP-TWO/.test(JSON.stringify(m.message?.content)))?.uuid;
    try { console.log("[CTRL] dryRun →", JSON.stringify(await q.rewindFiles(anchor, { dryRun: true }))); }
    catch (e: any) { console.log("[CTRL] dryRun THREW:", e?.message); }
    try { console.log("[CTRL] real →", JSON.stringify(await q.rewindFiles(anchor)), "| disk:", readFileSync(g, "utf8")); }
    catch (e: any) { console.log("[CTRL] real THREW:", e?.message, "| disk:", readFileSync(g, "utf8")); }
  });
process.exit(0);
