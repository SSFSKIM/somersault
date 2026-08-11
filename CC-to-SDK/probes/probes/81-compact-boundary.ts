// Probe 81 — spec-probe **P81** (TUI-clone master spec, probe ledger batch B, before F3).
//
// Question, verbatim: "Does the `compact_boundary` frame carry a summarised-message count and direction?"
// Gates TR36 (the compact-summary row in the transcript view).
//
// sdk.d.ts declares SDKCompactBoundaryMessage.compact_metadata as
//   { trigger: 'manual'|'auto', pre_tokens, post_tokens?, duration_ms?, preserved_segment?, preserved_messages? }
// — i.e. a TOKEN delta plus optional relink info, and no declared message count. Declared ≠ reachable in
// both directions: the runtime may omit fields the type declares, and the type is the only place a count
// could hide (preserved_messages.uuids.length is a KEPT count, not a SUMMARISED count). So: trigger a real
// compaction and dump compact_metadata key-for-key, on the wire and in the persisted transcript.
//
// Cheapest reliable trigger: submit "/compact" as a prompt in a streaming-input session (probe 68b already
// used this shape to manufacture boundary rows). Auto-compaction would cost a full context window to reach.
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 180_000;

const dir = mkdtempSync(join(tmpdir(), "probe81-"));
console.log("=== PROBE 81 (spec P81) — compact_boundary frame shape ===");
console.log("cwd:", dir, "· model:", MODEL);

const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
function inputQueue() {
  const items: unknown[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () {
    while (true) {
      if (items.length) { yield items.shift(); continue; }
      if (closed) return;
      await new Promise<void>((r) => (wake = r));
    }
  })();
  return { iterable, push, close };
}
function rowBrief(m: any, textMax = 110): string {
  const c = m.message?.content;
  const text = typeof c === "string" ? c
    : Array.isArray(c) ? c.map((b: any) =>
        b?.type === "text" ? b.text
        : b?.type === "tool_use" ? `<tool_use ${b.name}>`
        : b?.type === "tool_result" ? "<tool_result>"
        : `<${b?.type}>`).join(" ")
    : "";
  const flags = Object.entries(m)
    .filter(([k, v]) => !["type", "message", "session_id", "uuid", "parent_tool_use_id"].includes(k) &&
                        (typeof v === "string" || typeof v === "boolean" || typeof v === "number"))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
  return `${m.type}${m.message?.role ? "/" + m.message.role : ""} ${flags} :: ${String(text).replace(/\s+/g, " ").slice(0, textMax)}`;
}
// Every leaf key path of an object — the "exact key paths" the report needs.
function keyPaths(o: any, prefix = ""): string[] {
  if (o === null || typeof o !== "object") return [`${prefix} = ${JSON.stringify(o)}`];
  if (Array.isArray(o)) return o.length === 0 ? [`${prefix} = []`] : [`${prefix}[] (len ${o.length}) e.g. ${JSON.stringify(o[0]).slice(0, 90)}`];
  return Object.entries(o).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

const q = inputQueue();
const Q = query({
  prompt: q.iterable as any,
  options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 4 },
});

// Four short prompts first, so compaction has something to summarise and a message count is meaningful.
const seed = [
  "Say exactly: ALPHA-ONE",
  "Say exactly: BRAVO-TWO",
  "Say exactly: CHARLIE-THREE",
  "Say exactly: DELTA-FOUR",
];
const script = [...seed, "/compact", "Say exactly: ECHO-AFTER-COMPACT"];

let sid: string | undefined;
let idx = 0;
let done = 0;
const perTurnSystem: { turn: string; subtypes: string[] }[] = [];
const compactFrames: any[] = [];
const statusFrames: any[] = [];
let cur = { turn: script[0], subtypes: [] as string[] };
const wireCountsBeforeCompact = { assistant: 0, user: 0, system: 0 };

q.push(userTurn(script[0]));
const deadline = setTimeout(() => { console.log("DEADLINE — closing input"); q.close(); }, DEADLINE_MS);
try {
  for await (const m of Q) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init" && !sid) sid = mm.session_id;
    if (mm.type === "system") cur.subtypes.push(mm.subtype);
    if (idx < 4) (wireCountsBeforeCompact as any)[mm.type] = ((wireCountsBeforeCompact as any)[mm.type] ?? 0) + 1;
    if (mm.type === "system" && mm.subtype === "compact_boundary") {
      compactFrames.push(mm);
      console.log(`\n!!! compact_boundary frame on the WIRE (during turn ${JSON.stringify(cur.turn)})`);
    }
    if (mm.type === "system" && mm.subtype === "status") statusFrames.push(mm);
    if (mm.type === "result") {
      perTurnSystem.push({ turn: cur.turn, subtypes: [...cur.subtypes] });
      console.log(`[turn ${idx}] ${JSON.stringify(cur.turn).padEnd(34)} result=${mm.subtype} is_error=${mm.is_error} system=[${cur.subtypes.join(",")}]`);
      done++;
      idx++;
      if (idx >= script.length) { q.close(); break; }
      cur = { turn: script[idx], subtypes: [] };
      q.push(userTurn(script[idx]));
    }
  }
} catch (e: any) {
  console.log("STREAM THREW:", e?.name, e?.message);
}
clearTimeout(deadline);
q.close();

console.log(`\ncompleted turns: ${done}/${script.length} · session: ${sid}`);

console.log("\n########## compact_boundary — WIRE ##########");
if (!compactFrames.length) {
  console.log("NONE on the wire.");
} else {
  for (const f of compactFrames) {
    console.log("VERBATIM:", JSON.stringify(f));
    console.log("KEY PATHS:");
    for (const p of keyPaths(f)) console.log("   ", p);
  }
}

console.log("\n########## status frames (compact_result / compact_error live here) ##########");
for (const s of statusFrames) console.log("   ", JSON.stringify(s));
if (!statusFrames.length) console.log("   none");

console.log("\n########## persisted transcript ##########");
if (sid) {
  const withSys = (await getSessionMessages(sid, { includeSystemMessages: true } as any)) as any[];
  const noSys = (await getSessionMessages(sid)) as any[];
  console.log(`rows: ${withSys.length} with includeSystemMessages, ${noSys.length} without`);
  for (const r of withSys) console.log("   ", rowBrief(r));

  const boundaries = withSys.filter((r: any) => r.subtype === "compact_boundary" || r.compact_metadata);
  console.log(`\ncompact_boundary rows in transcript: ${boundaries.length}`);
  for (const b of boundaries) {
    console.log("VERBATIM:", JSON.stringify(b).slice(0, 2000));
    console.log("KEY PATHS:");
    for (const p of keyPaths(b)) console.log("   ", p);
  }
  const summaries = withSys.filter((r: any) => r.isCompactSummary === true);
  console.log(`\nisCompactSummary rows: ${summaries.length}`);
  for (const s of summaries) console.log("   VERBATIM (trimmed):", JSON.stringify(s).slice(0, 1200));

  // The count question, answered arithmetically from what IS on the wire.
  const bIdx = withSys.findIndex((r: any) => r.subtype === "compact_boundary" || r.compact_metadata);
  if (bIdx >= 0) {
    console.log(`\n[count arithmetic] rows before boundary: ${bIdx} · rows after: ${withSys.length - bIdx - 1}`);
    const cm = (compactFrames[0] ?? withSys[bIdx])?.compact_metadata ?? {};
    console.log(`[count arithmetic] preserved_messages.uuids.length: ${cm?.preserved_messages?.uuids?.length ?? "(absent)"}`);
    console.log(`[count arithmetic] preserved_segment present: ${cm?.preserved_segment ? JSON.stringify(cm.preserved_segment) : "(absent)"}`);
    console.log(`[count arithmetic] pre_tokens=${cm?.pre_tokens} post_tokens=${cm?.post_tokens} duration_ms=${cm?.duration_ms} trigger=${cm?.trigger}`);
  }
}

console.log("\n########## VERDICT INPUTS ##########");
const cm0 = compactFrames[0]?.compact_metadata;
console.log(JSON.stringify({
  wireBoundaryFrames: compactFrames.length,
  metadataKeys: cm0 ? Object.keys(cm0) : null,
  hasExplicitMessageCount: cm0 ? Object.keys(cm0).some((k) => /count|messages?_(num|n)|num_messages/i.test(k)) : null,
  trigger: cm0?.trigger,
  preTokens: cm0?.pre_tokens,
  postTokens: cm0?.post_tokens,
  preservedUuids: cm0?.preserved_messages?.uuids?.length ?? null,
}, null, 2));
process.exit(0);
