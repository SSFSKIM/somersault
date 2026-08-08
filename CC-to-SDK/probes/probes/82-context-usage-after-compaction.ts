// Probe 82 — does `getContextUsage()` report the POST-compaction figure? (Wave S Task 8, 2026-08-08.)
//
// WHY THIS EXISTS. Task 8's fix round made `/compact` re-measure the context percentage, because the
// chip otherwise keeps its pre-compact number until the next turn ends. The unit tests prove the WIRING
// — the fake swings its reading and the chip follows — but a fake cannot prove the ENGINE's semantics.
// The implementer said so plainly rather than shipping on the assumption: "if the SDK computed that
// figure from a pre-pass snapshot, /compact would re-measure the old number and the chip would be wrong
// in a new way." That is the declared-vs-reachable line this project probes rather than reasons about.
//
// THE QUESTION, precisely. `harness/src/tui/useChat.ts`'s `refreshCtx` calls the host's `context_usage`
// op → `Session.getContextUsage()` → the SDK query's own `getContextUsage()`. After a compaction
// boundary lands, does that call return a figure reflecting the SHRUNKEN context, or one still derived
// from the pre-compaction conversation?
//
// WHAT COUNTS AS AN ANSWER. Three readings, all from the same live session:
//   (a) BEFORE — after several turns, so the number is non-trivial;
//   (b) AFTER  — immediately after the `compact_boundary` frame, which is exactly where the shipped fix
//                calls it. This is the reading the whole probe exists for;
//   (c) SETTLED — after one further turn, i.e. what the old turn-end-only code would eventually have
//                shown. If (b) already matches (c)'s direction, the fix reads a real post-compact figure.
// The boundary's own `compact_metadata` carries `pre_tokens` and `post_tokens` (measured in probe 68e),
// which gives an INDEPENDENT expected value to check (b) against rather than only comparing it to (a).
//
// A failure mode this probe must not fall into: if no compaction happens, comparing (a) to (b) would
// show "no change" and read as a PASS for the wrong reason. So a missing boundary reports UNDETERMINED.
//
// Trigger: "/compact" submitted as a prompt in a streaming-input session — probe 81's shape, reused by
// 68e, and the cheapest reliable manual boundary (auto-compaction would cost a full context window).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 300_000;

const dir = mkdtempSync(join(tmpdir(), "probe82-"));
console.log("=== PROBE 82 — does getContextUsage() report the POST-compaction figure? ===");
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

/** The shape `useChat`'s chip derives from, so the probe reports the same number the user would see. */
function pct(u: any): string {
  const total = u?.totalTokens ?? u?.total_tokens;
  const max = u?.maxTokens ?? u?.max_tokens;
  if (!max) return "n/a";
  return `${Math.round((Number(total ?? 0) / Number(max)) * 100)}% (${total} / ${max})`;
}

const q = inputQueue();
const Q = query({
  prompt: q.iterable as any,
  options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 4 },
});

// Enough turns that the pre-compaction figure is clearly non-zero; the texts are irrelevant, only the
// accumulated context matters, so they are short and deterministic.
const seed = ["Say exactly: ALPHA", "Say exactly: BRAVO", "Say exactly: CHARLIE", "Say exactly: DELTA"];
const script = [...seed, "/compact", "Say exactly: ECHO"];

let sid: string | undefined;
let idx = 0;
let sawBoundary = false;
let boundaryMeta: any = null;
let before: any = null;   // (a) last pre-compaction reading
let after: any = null;    // (b) immediately after the boundary — the reading the fix depends on
let settled: any = null;  // (c) after one further turn

const read = async (label: string) => {
  try {
    const u = await (Q as any).getContextUsage();
    console.log(`  [${label}] ${pct(u)}  ·  raw keys: ${u && typeof u === "object" ? Object.keys(u).join(",") : String(u)}`);
    return u;
  } catch (e: any) {
    console.log(`  [${label}] THREW ${e?.name}: ${e?.message}`);
    return null;
  }
};

q.push(userTurn(script[0]));
const deadline = setTimeout(() => { console.log("DEADLINE — closing input"); q.close(); }, DEADLINE_MS);
try {
  for await (const m of Q) {
    const mm = m as any;
    // Diagnostics: the first run of this probe saw the `/compact` turn return `success` with NO
    // boundary, which is indistinguishable from "compaction happened and changed nothing" unless the
    // wire is shown. Every system frame and the compact turn's own reply are printed so a second
    // UNDETERMINED is at least explicable.
    if (mm.type === "system") console.log(`    <system subtype=${mm.subtype}>`);
    if (mm.type === "assistant" && idx === seed.length) {
      const t = (mm.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ");
      if (t.trim()) console.log(`    <compact-turn reply> ${t.replace(/\s+/g, " ").slice(0, 240)}`);
    }
    if (mm.type === "system" && mm.subtype === "init" && !sid) sid = mm.session_id;
    if (mm.type === "system" && mm.subtype === "compact_boundary") {
      sawBoundary = true;
      boundaryMeta = mm.compact_metadata ?? null;
      console.log("\n!!! compact_boundary on the wire");
      console.log(`    compact_metadata: ${JSON.stringify(boundaryMeta ?? {}).slice(0, 300)}`);
      // THE READING THIS PROBE EXISTS FOR — taken here because this is exactly where the shipped fix
      // calls refreshCtx: on the boundary, not at the next turn end.
      after = await read("AFTER  (on the boundary — where the fix reads)");
    }
    if (mm.type === "result") {
      console.log(`[turn ${idx}] ${JSON.stringify(script[idx])} → ${mm.subtype}`);
      if (idx === seed.length - 1) { console.log("  reading BEFORE the /compact turn:"); before = await read("BEFORE (4 turns in)"); }
      if (idx === script.length - 1) { console.log("  reading after one further turn:"); settled = await read("SETTLED (one turn after the boundary)"); }
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

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────────
const tok = (u: any) => Number(u?.totalTokens ?? u?.total_tokens ?? NaN);
console.log("\n########## CONTEXT-AFTER-COMPACT ##########");
console.log(`session: ${sid} · compact_boundary seen: ${sawBoundary}`);
console.log(`  BEFORE  totalTokens = ${tok(before)}`);
console.log(`  AFTER   totalTokens = ${tok(after)}`);
console.log(`  SETTLED totalTokens = ${tok(settled)}`);
if (boundaryMeta) console.log(`  boundary said: pre_tokens=${boundaryMeta.pre_tokens} post_tokens=${boundaryMeta.post_tokens}`);

if (!sawBoundary) {
  console.log("VERDICT: UNDETERMINED — no compaction happened, so a 'no change' reading would mean nothing.");
} else if (!Number.isFinite(tok(after))) {
  console.log("VERDICT: UNDETERMINED — the post-boundary read failed or returned no token count.");
} else if (tok(after) < tok(before)) {
  console.log("VERDICT: the fix is CORRECT — the reading taken on the boundary already reflects the");
  console.log("         shrunken context, so /compact re-measures a real post-compaction figure.");
  if (boundaryMeta?.post_tokens) {
    const drift = Math.abs(tok(after) - Number(boundaryMeta.post_tokens));
    console.log(`         cross-check against the boundary's own post_tokens: drift = ${drift}`);
  }
} else {
  console.log("VERDICT: the fix is WRONG IN A NEW WAY — the boundary-time reading did NOT shrink");
  console.log(`         (before ${tok(before)} → after ${tok(after)}), so /compact would re-post the stale`);
  console.log("         number. The honest repair is to HIDE the chip on compaction instead of");
  console.log("         re-measuring it: a surface with nothing true to say shows nothing.");
}
