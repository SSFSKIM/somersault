// probes/probes/107-getsessionmessages-ismeta.ts — does the session READER preserve `isMeta`?
//
// Claude Code writes some user rows into the session JSONL with a top-level `"isMeta": true` — the
// `<local-command-caveat>` preamble, skill-injection rows, and `<system-reminder>` context. Upstream's
// renderer drops those turns entirely; ccx's shared renderer (resume preview + live replay) draws their
// raw text, a leak. The pending fix forks on ONE fact: does the SDK reader the harness consumes
// (`getSessionMessages`, a pure passthrough in harness/src/sessions/reader.ts:16-19) carry `isMeta`
// through? Declared types are not evidence — `SessionMessage` declares no `isMeta`, but a reader that
// spreads the raw JSONL row would deliver it anyway.
//
// Two phases. (1) Create a fresh session in a scratch project dir with a `UserPromptSubmit` hook that
// injects a marked `<system-reminder>` via `hookSpecificOutput.additionalContext`, then diff disk
// against the reader. (2) Because SDK-driven sessions turn out not to mint `isMeta` user rows at all,
// scan ~/.claude/projects for the most recent REAL (interactive-CLI) transcript that does, and read
// that one back through the same call. Phase 2 prints only counts and field names — never row content.
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; npx tsx probes/107-getsessionmessages-ismeta.ts
//
// RESULT (2026-08-12, SDK 0.3.220) — the THIRD outcome: the meta ROW IS DROPPED, and `isMeta` is
// stripped besides. Reproduced on two independent real transcripts: one with 53 `"isMeta":true` user
// rows (reader returned 496 rows, ZERO of those 53 uuids) and one with 14 (reader returned 49 rows,
// ZERO of those 14). In both, no returned row anywhere in the session mentioned `<system-reminder>`,
// with or without `includeSystemMessages`. The reader projects every row onto a fixed shape —
// `message,parent_agent_id,parent_tool_use_id,session_id,timestamp,type,uuid` — so no extra on-disk
// field (isMeta, isSidechain, cwd, gitBranch, promptId, version…) survives; there is nothing to filter
// on and nothing leaking. Phase 1 adds the corroborating detail: an SDK-driven session records the
// hook's additionalContext and every `<system-reminder>` as `type:"attachment"` rows (never `isMeta`
// user rows), and the reader drops those too — 12 disk rows in, 3 returned (1 user + 2 assistant).
//
// CONSEQUENCES the fix design has to absorb: (a) a `row.isMeta` predicate over reader output is dead
// code — harness/src/tui/sessionPickerModel.ts:161 already has one and it can never fire; (b) whatever
// `<system-reminder>` text ccx renders is NOT coming from `getSessionMessages`, so the leak's source is
// the other input to the shared renderer (the live host/SDK message stream, where reminders ride along
// inside user/tool-result content) — fix there, textually, since the disk side is already clean.
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CWD = "/Users/new/.claude/jobs/4b30d1a4/tmp/probe107";
const REMINDER = "<system-reminder>probe-107 injected reminder: MU-MARKER-107</system-reminder>";
const PROJECTS = join(homedir(), ".claude", "projects");
const READER_SHAPE = "message,parent_agent_id,parent_tool_use_id,session_id,timestamp,type,uuid";

const readRows = (p: string) => readFileSync(p, "utf8").trim().split("\n")
  .map(l => { try { return JSON.parse(l) as Record<string, any>; } catch { return null; } })
  .filter(Boolean) as Record<string, any>[];

async function* input() {
  yield { type: "user" as const, message: { role: "user" as const, content: "Reply with exactly one word: EPSILON" }, parent_tool_use_id: null, session_id: "x" };
}

function findTranscript(sid: string): string | undefined {
  for (const d of readdirSync(PROJECTS)) {
    const p = join(PROJECTS, d, `${sid}.jsonl`);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Most recently written transcript that actually contains `"isMeta":true` user rows. */
function findMetaTranscript(scan = 250): string | undefined {
  const all: Array<{ p: string; m: number }> = [];
  for (const d of readdirSync(PROJECTS)) {
    let files: string[] = [];
    try { files = readdirSync(join(PROJECTS, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(PROJECTS, d, f);
      try { all.push({ p, m: statSync(p).mtimeMs }); } catch { /* raced */ }
    }
  }
  all.sort((a, b) => b.m - a.m);
  for (const { p } of all.slice(0, scan)) {
    let txt = "";
    try { txt = readFileSync(p, "utf8"); } catch { continue; }
    if (txt.includes('"isMeta":true') || txt.includes('"isMeta": true')) return p;
  }
  return undefined;
}

/** Read a session back and report ONLY structure: counts, field names, uuid survival. */
async function readerReport(sid: string, dir: string, diskRows: Record<string, any>[], label: string) {
  const diskMeta = diskRows.filter(r => r.isMeta === true);
  const diskMetaUser = diskMeta.filter(r => r.type === "user");
  console.log(`  disk: ${diskRows.length} rows | isMeta:true = ${diskMeta.length} (type=user: ${diskMetaUser.length})`);
  console.log("  disk row types:", JSON.stringify(diskRows.reduce((a: any, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {})));
  if (diskMeta.length) console.log("  disk meta-row field union  :", [...new Set(diskMeta.flatMap(r => Object.keys(r)))].sort().join(","));
  const diskNormalUser = diskRows.filter(r => r.type === "user" && r.isMeta !== true);
  if (diskNormalUser.length) console.log("  disk normal-user field union:", [...new Set(diskNormalUser.flatMap(r => Object.keys(r)))].sort().join(","));
  console.log("  disk rows whose JSON mentions <system-reminder>:", diskRows.filter(r => JSON.stringify(r).includes("<system-reminder>")).length);

  for (const includeSystemMessages of [false, true]) {
    const msgs: any[] = await getSessionMessages(sid, { dir, includeSystemMessages } as any);
    const union = [...new Set(msgs.flatMap(m => Object.keys(m)))].sort().join(",");
    console.log(`  reader(includeSystemMessages=${includeSystemMessages}): ${msgs.length} rows`,
      JSON.stringify(msgs.reduce((a: any, m) => (a[m.type] = (a[m.type] || 0) + 1, a), {})));
    console.log("    returned field union:", union);
    console.log("    rows with top-level isMeta:", msgs.filter(m => m.isMeta !== undefined).length,
      "| rows with message.isMeta:", msgs.filter(m => (m.message as any)?.isMeta !== undefined).length);
    const byUuid = new Set(msgs.map(m => m.uuid));
    const kept = diskMetaUser.filter(r => byUuid.has(r.uuid)).length;
    console.log("    disk meta-user rows KEPT:", kept, "| DROPPED:", diskMetaUser.length - kept);
    console.log("    returned rows mentioning <system-reminder>:", msgs.filter(m => JSON.stringify(m).includes("<system-reminder>")).length,
      "| carrying MU-MARKER-107:", msgs.filter(m => JSON.stringify(m).includes("MU-MARKER-107")).length);

    if (includeSystemMessages) {
      const anyMetaField = msgs.some(m => m.isMeta !== undefined || (m.message as any)?.isMeta !== undefined);
      console.log(`  VERDICT [${label}]:`,
        diskMetaUser.length === 0 ? "INCONCLUSIVE — no isMeta user row on disk for this session"
          : kept === 0 ? "ROW-DROPPED — the reader omits meta rows entirely (they never reach the renderer)"
          : anyMetaField ? `isMeta PRESERVED (see field union above; shape differs from the fixed ${READER_SHAPE})`
          : "isMeta STRIPPED but rows KEPT — fix must detect reminder content textually");
    }
  }
}

(async () => {
  console.log("=== probe 107: does getSessionMessages() preserve isMeta on user rows? ===");
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.log("ABORT: no CLAUDE_CODE_OAUTH_TOKEN in env"); process.exit(1); }
  mkdirSync(CWD, { recursive: true });

  // ---- Phase 1: a fresh session with a hook-injected <system-reminder>. ----
  console.log("\n--- PHASE 1: fresh SDK session (hook additionalContext = a marked <system-reminder>) ---");
  let sid = "";
  const q = query({
    prompt: input(),
    options: {
      cwd: CWD, model: "claude-haiku-4-5", maxTurns: 1,
      hooks: { UserPromptSubmit: [{ hooks: [async () => ({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: REMINDER } })] }] },
    } as any,
  });
  for await (const m of q as any) {
    if (m.type === "system" && m.subtype === "init") sid = m.session_id;
    if (m.type === "result") { sid ||= m.session_id; console.log("  turn:", m.subtype, "| session:", sid); break; }
  }
  const path = sid ? findTranscript(sid) : undefined;
  console.log("  transcript:", path ?? "(NOT FOUND)");
  if (path) await readerReport(sid, CWD, readRows(path), "fresh SDK session");

  // ---- Phase 2: the most recent REAL transcript that carries isMeta:true user rows. ----
  console.log("\n--- PHASE 2: most recent real transcript containing \"isMeta\":true ---");
  const metaPath = findMetaTranscript();
  if (!metaPath) { console.log("  none found in the 250 most-recent transcripts — phase 2 skipped"); process.exit(0); }
  const rows = readRows(metaPath);
  const metaSid: string = rows.find(r => r.sessionId)?.sessionId ?? metaPath.split("/").pop()!.replace(".jsonl", "");
  const metaDir: string = rows.find(r => r.cwd)?.cwd ?? "";
  console.log("  file:", metaPath.replace(homedir(), "~"), "| dir:", metaDir.replace(homedir(), "~"));
  await readerReport(metaSid, metaDir, rows, "real interactive session");

  console.log("\n=== probe 107 done ===");
  process.exit(0);
})();
