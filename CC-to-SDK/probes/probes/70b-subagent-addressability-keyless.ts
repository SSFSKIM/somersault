// Probe 70b — KEYLESS half of probe 70. Same design question (doperpowers P2:
// "can a subagent be its own harness session?"), answered against REAL subagent transcripts already
// on disk from prior Claude Code sessions, so it needs no model turn and no credits.
//
// Runs the SDK's own read API — listSubagents / getSubagentMessages / getSessionInfo /
// getSessionMessages / listSessions — plus a raw on-disk inspection, and asks the ONE question that
// decides the design: is a subagent ADDRESSABLE as a session (own id, own row, own resume handle),
// or is it a SUBFILE of its parent session?
import { listSubagents, getSubagentMessages, getSessionInfo, getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECTS = join(homedir(), ".claude", "projects");

// Pick a real project dir that has at least one <sessionId>/subagents/ directory.
// NB the SDK read API's `dir` option is the PROJECT PATH (the session's cwd), not the storage dir
// under ~/.claude/projects — passing the storage dir silently yields empty results.
function pickCase(): { projectDir: string; sessionId: string; cwd: string } | undefined {
  let best: { projectDir: string; sessionId: string; cwd: string; n: number } | undefined;
  for (const proj of readdirSync(PROJECTS)) {
    const pdir = join(PROJECTS, proj);
    let entries: string[];
    try { entries = readdirSync(pdir); } catch { continue; }
    for (const e of entries) {
      const sub = join(pdir, e, "subagents");
      if (!/^[0-9a-f-]{36}$/.test(e) || !existsSync(sub) || !existsSync(join(pdir, `${e}.jsonl`))) continue;
      const n = readdirSync(sub).filter((f) => f.endsWith(".jsonl")).length;
      if (n === 0) continue;
      let cwd = "";
      try {
        const first = readFileSync(join(pdir, `${e}.jsonl`), "utf8").split("\n").find((l) => l.trim());
        cwd = JSON.parse(first!).cwd ?? "";
      } catch { /* ignore */ }
      if (!cwd) continue;
      if (!best || n > best.n) best = { projectDir: pdir, sessionId: e, cwd, n };
    }
  }
  return best;
}

const found = pickCase();
console.log("=== PROBE 70b subagent addressability (keyless, real on-disk sessions) ===");
if (!found) { console.log("RESULT: SKIP — no on-disk session with subagent transcripts"); process.exit(0); }
const { projectDir, sessionId, cwd } = found;
console.log("storage dir :", projectDir);
console.log("project dir (SDK `dir` arg) :", cwd);
console.log("session     :", sessionId);

// --- (0) on-disk layout ---------------------------------------------------------------
const subDir = join(projectDir, sessionId, "subagents");
const files = readdirSync(subDir);
const jsonls = files.filter((f) => f.endsWith(".jsonl"));
console.log(`\n(0) layout: <project>/${sessionId}.jsonl  +  <project>/${sessionId}/subagents/ (${jsonls.length} agent transcripts, ${files.length} files)`);
console.log("    sample :", jsonls.slice(0, 3).join(", "));

// --- (1) enumerable? -------------------------------------------------------------------
const ids = await listSubagents(sessionId, { dir: cwd } as any);
console.log(`\n(1) listSubagents("${sessionId}") -> ${ids.length} ids; sample: ${JSON.stringify(ids.slice(0, 3))}`);

// --- (2) readable transcript? ----------------------------------------------------------
const aid = ids[0];
const msgs = await getSubagentMessages(sessionId, aid, { dir: cwd } as any);
console.log(`(2) getSubagentMessages("${sessionId}", "${aid}") -> ${msgs.length} messages`);
console.log("    first msg keys:", JSON.stringify(Object.keys(msgs[0] ?? {})));
console.log("    first msg session_id:", (msgs[0] as any)?.session_id, "| parent_agent_id:", (msgs[0] as any)?.parent_agent_id);
const ownsParentId = (msgs[0] as any)?.session_id === sessionId;
console.log(`    subagent messages report session_id === PARENT session id: ${ownsParentId}`);

// --- (3) is it a session row? ----------------------------------------------------------
const rows = await listSessions({ dir: cwd } as any);
const idSet = new Set(ids);
const anyRow = rows.some((r: any) => idSet.has(r.sessionId) || idSet.has(String(r.sessionId).replace(/^agent-/, "")));
console.log(`\n(3) listSessions({dir}) -> ${rows.length} rows; any row whose sessionId is a subagent id: ${anyRow}`);
const sidechainRows = rows.filter((r: any) => r.isSidechain).length;
console.log(`    rows flagged isSidechain: ${sidechainRows}`);

// --- (4) session metadata for the agent id? --------------------------------------------
for (const candidate of [aid, `agent-${aid}`]) {
  try {
    const info = await getSessionInfo(candidate, { dir: cwd } as any);
    console.log(`(4) getSessionInfo("${candidate}") -> ${info ? JSON.stringify(info).slice(0, 160) : "undefined"}`);
  } catch (e: any) { console.log(`(4) getSessionInfo("${candidate}") THREW: ${e?.message}`); }
  try {
    const m = await getSessionMessages(candidate, { dir: cwd } as any);
    console.log(`    getSessionMessages("${candidate}") -> ${m.length} messages`);
  } catch (e: any) { console.log(`    getSessionMessages("${candidate}") THREW: ${e?.message}`); }
}

// --- (5) what the raw transcript lines claim about identity ----------------------------
const raw = readFileSync(join(subDir, jsonls[0]), "utf8").trimEnd().split("\n").slice(0, 40).map((l) => JSON.parse(l));
const sids = new Set(raw.map((r: any) => r.sessionId));
const agentIds = new Set(raw.map((r: any) => r.agentId));
const sidechain = new Set(raw.map((r: any) => r.isSidechain));
console.log(`\n(5) raw ${jsonls[0]} (first ${raw.length} lines):`);
console.log(`    distinct sessionId values : ${JSON.stringify([...sids])}`);
console.log(`    distinct agentId values   : ${JSON.stringify([...agentIds])}`);
console.log(`    isSidechain values        : ${JSON.stringify([...sidechain])}`);
const metaFile = jsonls[0].replace(/\.jsonl$/, ".meta.json");
if (existsSync(join(subDir, metaFile))) console.log(`    ${metaFile}: ${readFileSync(join(subDir, metaFile), "utf8").trim()}`);

// --- (6) does the parent transcript also carry the subagent's turns? -------------------
const parentPath = join(projectDir, `${sessionId}.jsonl`);
const parentSize = statSync(parentPath).size;
let parentSidechainLines = 0, parentLines = 0;
for (const line of readFileSync(parentPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  parentLines++;
  try { if (JSON.parse(line).isSidechain === true) parentSidechainLines++; } catch { /* ignore */ }
}
console.log(`\n(6) parent transcript: ${parentLines} lines (${parentSize}b), of which isSidechain: ${parentSidechainLines}`);

console.log("\nVERDICT (structural, keyless):");
console.log(`  subagent enumerable via SDK      : ${ids.length > 0}`);
console.log(`  subagent transcript readable     : ${msgs.length > 0}`);
console.log(`  own session id                   : ${ownsParentId ? "NO — carries the PARENT's sessionId" : "maybe (inspect above)"}`);
console.log(`  own listSessions row             : ${anyRow ? "yes" : "NO"}`);
console.log(`  storage addressing               : subfile under <project>/<parentSessionId>/subagents/`);
