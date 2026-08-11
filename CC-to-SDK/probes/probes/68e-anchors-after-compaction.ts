// Probe 68e — ANCHORS-1 (Wave S open question, 2026-08-07).
//
// Question, verbatim from the spec's Open questions table: "after a `/compact`, do rewind anchors
// vanish?" It is `qa5-04`'s real residue, and the Wave S spec flags the premise as UNVERIFIED and
// possibly stale: it traces to probe 68b, which the grounding round never re-ran, while the spec
// reviewer's own compaction fixture returned four rows including two real prompt rows — i.e. anchors
// would SURVIVE. `sdk.d.ts` documents `compactMetadata.preservedMessages` as superseding the older
// `preserved_segment` scheme, exactly the kind of change that flips this.
//
// WHAT THIS MEASURES, and why it is not just "dump the rows". A rewind anchor is not a row; it is what
// `rewindAnchorsFrom` (harness/src/sessions/rows.ts) DERIVES from the reader's rows: a user row whose
// content shape classifies as a real `prompt` (not a tool_result, CLI slash echo, local-command output,
// caveat, or compact summary), carrying the nearest preceding non-phantom uuid as its `prevUuid`. So the
// question has two halves and either one alone can answer it wrongly:
//   (a) does `getSessionMessages` still RETURN the pre-compaction prompt rows after a boundary?
//   (b) do those rows still CLASSIFY as prompts, and do they still find a `prevUuid`?
// An anchor with a null `prevUuid` is not a usable conversation anchor before Wave S's EP-S3b, so (b)'s
// second half matters as much as its first. Both are answered below, and the classifier is reproduced
// here rather than imported — `probes/` is a standalone workspace with no path into `harness/src` — with
// the source's own regexes copied so a drift between the two shows up as a discrepancy rather than as a
// silent agreement.
//
// Trigger: "/compact" submitted as a prompt in a streaming-input session — probe 81's shape, which is
// the cheapest reliable manual boundary (auto-compaction would cost a full context window to reach).
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 240_000;

const dir = mkdtempSync(join(tmpdir(), "probe68e-"));
console.log("=== PROBE 68e — ANCHORS-1: do rewind anchors survive a compaction? ===");
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

// ── harness/src/tui/species.ts + harness/src/sessions/rows.ts, transcribed ────────────────────────────
// Copied, not imported: `probes/` is a standalone npm workspace. If the harness's regexes change and
// these do not, this probe's verdict stops describing the product — so the shapes are quoted with their
// source so a reader can diff them.
const COMMAND_ECHO_RE = /<command-(name|message|args)>/;
const COMMAND_OUTPUT_RE = /<local-command-(stdout|stderr)>/;
const CAVEAT_RE = /^Caveat: The messages below were generated/;
const COMPACT_SUMMARY_RE = /^This session is being continued from a previous conversation/;
const NO_CONTENT = "(no content)";

function promptText(m: any): string {
  const c = m?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return String(c.find((b: any) => b?.type === "text")?.text ?? "");
  return "";
}
type RowKind = "prompt" | "tool_result" | "command_echo" | "command_output" | "caveat" | "compact_summary" | "other";
function rowKind(m: any): RowKind {
  if (m?.type !== "user") return "other";
  const c = m.message?.content;
  if (Array.isArray(c) && c.some((b: any) => b?.type === "tool_result")) return "tool_result";
  const text = promptText(m);
  if (COMMAND_ECHO_RE.test(text)) return "command_echo";
  if (COMMAND_OUTPUT_RE.test(text)) return "command_output";
  if (CAVEAT_RE.test(text)) return "caveat";
  if (COMPACT_SUMMARY_RE.test(text)) return "compact_summary";
  if (!m.uuid) return "other";
  return "prompt";
}
const PHANTOM: ReadonlySet<RowKind> = new Set(["command_echo", "command_output", "caveat", "compact_summary"]);
function rewindAnchorsFrom(messages: any[]) {
  const out: { uuid: string; prevUuid: string | null; text: string; index: number }[] = [];
  messages.forEach((m: any, i: number) => {
    if (rowKind(m) !== "prompt") return;
    let prevUuid: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const p = messages[j] as any;
      if (p?.uuid && !PHANTOM.has(rowKind(p))) { prevUuid = String(p.uuid); break; }
    }
    out.push({ uuid: String(m.uuid), prevUuid, text: promptText(m), index: i });
  });
  return out.reverse();
}

function reportAnchors(label: string, msgs: any[]) {
  console.log(`\n--- ${label}: ${msgs.length} rows returned by getSessionMessages ---`);
  msgs.forEach((m: any, i) => {
    const kind = rowKind(m);
    console.log(`  [${String(i).padStart(2)}] ${String(m.type).padEnd(9)} kind=${kind.padEnd(15)} uuid=${String(m.uuid ?? "").slice(0, 8).padEnd(8)} :: ${promptText(m).replace(/\s+/g, " ").slice(0, 60)}`);
  });
  const anchors = rewindAnchorsFrom(msgs);
  console.log(`  anchors: ${anchors.length}`);
  for (const a of anchors)
    console.log(`    · uuid=${a.uuid.slice(0, 8)} prevUuid=${a.prevUuid ? a.prevUuid.slice(0, 8) : "NULL (no conversation restore before EP-S3b)"} :: ${a.text.replace(/\s+/g, " ").slice(0, 50)}`);
  return anchors;
}

// ── drive ─────────────────────────────────────────────────────────────────────────────────────────────
const q = inputQueue();
const Q = query({
  prompt: q.iterable as any,
  options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 4 },
});

const seed = [
  "Say exactly: ALPHA-ONE",
  "Say exactly: BRAVO-TWO",
  "Say exactly: CHARLIE-THREE",
  "Say exactly: DELTA-FOUR",
];
const script = [...seed, "/compact", "Say exactly: ECHO-AFTER-COMPACT"];

let sid: string | undefined;
let idx = 0;
let sawBoundary = false;
let boundaryMeta: any = null;
let beforeCompact: any[] = [];

q.push(userTurn(script[0]));
const deadline = setTimeout(() => { console.log("DEADLINE — closing input"); q.close(); }, DEADLINE_MS);
try {
  for await (const m of Q) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init" && !sid) sid = mm.session_id;
    if (mm.type === "system" && mm.subtype === "compact_boundary") {
      sawBoundary = true;
      boundaryMeta = mm.compact_metadata ?? null;
      console.log("\n!!! compact_boundary on the wire · compact_metadata keys:", boundaryMeta ? Object.keys(boundaryMeta).join(", ") : "(none)");
    }
    if (mm.type === "result") {
      console.log(`[turn ${idx}] ${JSON.stringify(script[idx])} → ${mm.subtype}`);
      // Snapshot the anchor set from the LAST pre-compaction turn: the comparison is only meaningful
      // against what the reader returned before the boundary, not against what we typed.
      if (idx === seed.length - 1 && sid) beforeCompact = (await getSessionMessages(sid)) as any[];
      idx++;
      if (idx >= script.length) { q.close(); break; }
      q.push(userTurn(script[idx]));
    }
  }
} catch (e: any) {
  console.log("STREAM THREW:", e?.name, e?.message);
}
clearTimeout(deadline);
q.close();

console.log(`\nsession: ${sid} · compact_boundary seen on the wire: ${sawBoundary}`);
if (!sawBoundary) {
  console.log("\n!! NO BOUNDARY — the /compact turn did not compact. This probe's verdict would be about");
  console.log("   nothing at all, so it reports UNDETERMINED rather than a comforting 'anchors survived'.");
}

const before = reportAnchors("BEFORE the compaction (after 4 turns)", beforeCompact);
const after = reportAnchors("AFTER the compaction (+1 turn)", sid ? ((await getSessionMessages(sid)) as any[]) : []);

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────────
console.log("\n########## ANCHORS-1 ##########");
if (!sawBoundary) {
  console.log("VERDICT: UNDETERMINED — no compaction happened, so nothing was tested.");
} else {
  const beforeTexts = new Set(before.map((a) => a.text.replace(/\s+/g, " ").trim()));
  const afterTexts = new Set(after.map((a) => a.text.replace(/\s+/g, " ").trim()));
  const survivors = [...beforeTexts].filter((t) => afterTexts.has(t));
  const lost = [...beforeTexts].filter((t) => !afterTexts.has(t));
  const usable = after.filter((a) => a.prevUuid !== null);
  console.log(`pre-boundary anchors: ${before.length} · post-boundary anchors: ${after.length}`);
  console.log(`  survived by text: ${survivors.length} ${JSON.stringify(survivors.map((t) => t.slice(0, 30)))}`);
  console.log(`  lost:             ${lost.length} ${JSON.stringify(lost.map((t) => t.slice(0, 30)))}`);
  console.log(`  post-boundary anchors WITH a prevUuid (i.e. conversation-restorable today): ${usable.length}/${after.length}`);
  console.log(boundaryMeta ? `  compact_metadata: ${JSON.stringify(boundaryMeta).slice(0, 300)}` : "  compact_metadata: (none)");
  console.log(
    after.length === 0 ? "VERDICT: anchors VANISH after a compaction — the original premise holds."
    : survivors.length === 0 ? "VERDICT: pre-boundary anchors are GONE; only post-boundary prompts remain."
    : "VERDICT: anchors SURVIVE a compaction — the premise on file is STALE."
  );
}
console.log("\ncwd left in place for inspection:", dir);
