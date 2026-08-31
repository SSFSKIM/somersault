// Probe 70 — Is a Task-tool subagent an INDEPENDENTLY ADDRESSABLE session?
//
// Design question (doperpowers clean-slate round, probe P2): can a subagent run as its OWN harness
// session — own session id, own transcript row in the sessionStore — so it survives the parent
// session dying and can later be revived or resumed?
//
// This half asks the narrow structural question: what does the NATIVE Task/Agent subagent actually
// leave behind? The SDK declares `listSubagents(sessionId)` / `getSubagentMessages(sessionId, agentId)`
// and a `SessionKey.subpath` "set for subagent files". Declared != reachable, and more importantly
// declared != ADDRESSABLE: a subpath under the parent key is not a session.
//
// Method: one real turn that launches a general-purpose subagent, with a recording sessionStore
// attached so we see every (projectKey, sessionId, subpath) the engine writes. Then, after the turn:
//   (1) listSubagents(parent)     — is the subagent enumerable?
//   (2) getSubagentMessages()     — is its transcript readable?
//   (3) listSessions({dir})       — is it a SESSION (own row) or only a subfile?
//   (4) getSessionInfo(agentId)   — does it have session metadata?
//   (5) query({resume: agentId})  — can it be RESUMED (the revive question)?
//   (6) on-disk layout            — where do the bytes live?
import {
  query, listSubagents, getSubagentMessages, listSessions, getSessionInfo, getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-sonnet-4-5-20250929";
const MARKER = `SUBAGENT-MARKER-${Date.now().toString(36).toUpperCase()}`;
const dir = mkdtempSync(join(tmpdir(), "probe70-"));

// A recording SessionStore: the whole point is to see the KEY SHAPE the engine mirrors under.
interface Append { projectKey: string; sessionId: string; subpath?: string; n: number; types: string[] }
const appends: Append[] = [];
const store = {
  async append(key: any, entries: any[]) {
    appends.push({
      projectKey: key.projectKey, sessionId: key.sessionId, subpath: key.subpath,
      n: entries.length, types: [...new Set(entries.map((e) => String(e?.type)))],
    });
  },
  async load() { return null; },
};

console.log("=== PROBE 70 subagent session addressability ===");
console.log("cwd:", dir);
console.log("marker:", MARKER);

const PROMPT =
  "Use the Task tool EXACTLY ONCE to launch a subagent (subagent_type 'general-purpose') whose prompt is: " +
  `\"Reply with exactly this token and nothing else: ${MARKER}\". ` +
  "When the subagent returns, reply with just: done";

let parentId: string | undefined;
let sawTaskToolUse = false;
let nestedMsgs = 0;
const q = query({
  prompt: PROMPT,
  options: {
    model: MODEL, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 12,
    enableFileCheckpointing: false,          // the SDK rejects checkpointing + sessionStore
    sessionStore: store as any,
    sessionStoreFlush: "eager",
    forwardSubagentText: true,
    settingSources: [],
  } as any,
});
for await (const m of q) {
  const mm = m as any;
  if (mm.type === "system" && mm.subtype === "init") parentId = mm.session_id;
  if (mm.parent_tool_use_id) nestedMsgs++;
  if (mm.type === "assistant") {
    for (const b of mm.message?.content ?? []) {
      if (b?.type === "tool_use" && (b.name === "Task" || b.name === "Agent")) sawTaskToolUse = true;
    }
  }
  if ("result" in mm) {
    console.log("result.subtype:", mm.subtype, "turns:", mm.num_turns);
  }
}
console.log("parent session id:", parentId);
console.log("Task/Agent tool_use fired:", sawTaskToolUse, "| nested (parent_tool_use_id) msgs:", nestedMsgs);

// (1)/(2) subagent enumeration + transcript
let agentIds: string[] = [];
try { agentIds = await listSubagents(parentId!, { dir } as any); }
catch (e: any) { console.log("listSubagents THREW:", e?.message); }
console.log("\n(1) listSubagents(parent) ->", JSON.stringify(agentIds));

for (const aid of agentIds) {
  try {
    const ms = await getSubagentMessages(parentId!, aid, { dir } as any);
    const hasMarker = JSON.stringify(ms).includes(MARKER);
    console.log(`(2) getSubagentMessages(parent, ${aid}) -> ${ms.length} messages, contains marker: ${hasMarker}`);
  } catch (e: any) { console.log(`(2) getSubagentMessages(${aid}) THREW:`, e?.message); }
}

// (3) is it a SESSION in its own right?
const sessions = await listSessions({ dir } as any);
console.log("\n(3) listSessions({dir}) ->", sessions.length, "rows:",
  JSON.stringify(sessions.map((s: any) => ({ id: s.sessionId, isSidechain: s.isSidechain, firstPrompt: String(s.firstPrompt ?? "").slice(0, 40) }))));
const listedAsSession = agentIds.some((a) => sessions.some((s: any) => s.sessionId === a || String(s.sessionId).includes(a)));
console.log("    any subagent id appears as a session row:", listedAsSession);

// (4) session metadata for the agent id
for (const aid of agentIds) {
  try {
    const info = await getSessionInfo(aid, { dir } as any);
    console.log(`(4) getSessionInfo(${aid}) ->`, info ? JSON.stringify(info).slice(0, 200) : "undefined");
  } catch (e: any) { console.log(`(4) getSessionInfo(${aid}) THREW:`, e?.message); }
  try {
    const ms = await getSessionMessages(aid, { dir } as any);
    console.log(`    getSessionMessages(${aid}) -> ${ms.length} messages`);
  } catch (e: any) { console.log(`    getSessionMessages(${aid}) THREW:`, e?.message); }
}

// (5) THE REVIVE TEST: can the subagent's own id be resumed as a session?
let resumeVerdict = "(no agent id to try)";
for (const aid of agentIds.slice(0, 1)) {
  const bare = aid.replace(/^agent-/, "");
  for (const candidate of [aid, bare]) {
    try {
      let sid: string | undefined, text = "";
      for await (const m of query({
        prompt: "What exact token did I ask you to reply with? Reply with only that token.",
        options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 1, resume: candidate, settingSources: [] } as any,
      })) {
        const mm = m as any;
        if (mm.type === "system" && mm.subtype === "init") sid = mm.session_id;
        if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b.type === "text") text += b.text;
        if ("result" in mm) break;
      }
      const same = sid === candidate;
      const recalled = text.includes(MARKER);
      resumeVerdict = `resume("${candidate}") -> new sid ${sid} (same-as-requested: ${same}); recalled marker: ${recalled}`;
      console.log("\n(5)", resumeVerdict);
    } catch (e: any) {
      resumeVerdict = `resume("${candidate}") THREW: ${e?.message}`;
      console.log("\n(5)", resumeVerdict);
    }
  }
}

// (6) on-disk layout
const PROJECTS = join(homedir(), ".claude", "projects");
function findProjectDir(sid: string): string | undefined {
  if (!existsSync(PROJECTS)) return undefined;
  for (const p of readdirSync(PROJECTS)) {
    if (existsSync(join(PROJECTS, p, `${sid}.jsonl`))) return join(PROJECTS, p);
  }
  return undefined;
}
const projDir = parentId ? findProjectDir(parentId) : undefined;
console.log("\n(6) project dir:", projDir ?? "(not found)");
if (projDir) {
  for (const e of readdirSync(projDir)) {
    const p = join(projDir, e);
    const st = statSync(p);
    console.log(`    ${st.isDirectory() ? "d" : "-"} ${e}${st.isDirectory() ? " -> " + JSON.stringify(readdirSync(p)) : ` (${st.size}b)`}`);
    if (st.isDirectory()) {
      for (const sub of readdirSync(p)) {
        const p2 = join(p, sub);
        if (statSync(p2).isDirectory()) console.log(`      d ${sub} -> ${JSON.stringify(readdirSync(p2))}`);
      }
    }
  }
}

// (7) sessionStore key shapes — the SSOT question
const keyShapes = new Map<string, number>();
for (const a of appends) {
  const k = `${a.sessionId}${a.subpath ? " subpath=" + a.subpath : " (main)"}`;
  keyShapes.set(k, (keyShapes.get(k) ?? 0) + a.n);
}
console.log("\n(7) sessionStore append() key shapes (entries per key):");
for (const [k, n] of keyShapes) console.log(`    ${k}: ${n} entries`);
console.log("    distinct top-level sessionIds mirrored:", new Set(appends.map((a) => a.sessionId)).size);
console.log("    appends carrying a subpath:", appends.filter((a) => a.subpath).length);

console.log("\nVERDICT:");
console.log(`  subagent enumerable  : ${agentIds.length > 0}`);
console.log(`  own session row      : ${listedAsSession}`);
console.log(`  independently resumable: see (5) — ${resumeVerdict}`);
console.log(`  store addressing     : ${appends.some((a) => a.subpath) ? "subpath UNDER the parent session key" : "main transcript only"}`);
