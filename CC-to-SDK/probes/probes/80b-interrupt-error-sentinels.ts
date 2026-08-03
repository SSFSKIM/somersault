// Probe 80b — spec-probe **P80** (the natural `80-*` slot is taken by the unrelated
// 80-sandbox-escalation-broker.ts, so P80 lands here).
//
// Question (master TUI-clone spec, probe ledger batch B, before F3):
//   "Does `[Request interrupted by user]` reach a client as a user message? Do context-limit,
//    credit-balance and abort conditions arrive as assistant text with upstream's sentinel strings,
//    or as SDK errors?"
// Gates LT14 (interrupt rows in the live turn) and TR38 (assistant-text error sentinels in the transcript).
//
// Probe 63 already settled interrupt-vs-parked-permission MECHANICS (does interrupt() release a park).
// This probe does not re-prove that; it asks a different question — what does interruption look like
// ON THE WIRE and IN THE TRANSCRIPT, byte for byte, so the clone can render a row for it.
//
// Parts:
//   A  interrupt(): query.interrupt() mid-turn while Bash tool calls are running. Dump every frame that
//      follows, then dump the persisted transcript (getSessionMessages, includeSystemMessages) and hunt
//      the literal sentinel.
//   B  abort(): same turn shape, killed with options.abortController instead. Distinguish the paths.
//   C  context-limit: ONE forced repro with an oversized prompt. A >context-window request is rejected
//      by the API with 400 before any sampling, so this costs no output tokens — it is the only one of
//      the three error conditions that is cheap to trigger honestly. Credit-balance is NOT forced (there
//      is no cheap way); it is covered by the static grep inventory in the report, labelled static.
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const SENTINEL = "[Request interrupted by user";
const PART_DEADLINE_MS = 120_000;

const dir = mkdtempSync(join(tmpdir(), "probe80b-"));
console.log("=== PROBE 80b (spec P80) — interrupt / abort / error sentinels ===");
console.log("cwd:", dir, "· model:", MODEL);

const TOOL_PROMPT =
  "Using the Bash tool, run these three commands ONE AT A TIME, waiting for each to finish: " +
  "`sleep 4 && echo AAA`, then `sleep 4 && echo BBB`, then `sleep 4 && echo CCC`. Then reply DONE.";

function userTurn(text: string) {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}
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

// One-line species summary of a wire frame or a transcript row. Keeps the dump readable while still
// showing the flags that distinguish species (isMeta / isCompactSummary / subtype / *_id fields).
function frameBrief(m: any, textMax = 140): string {
  const msg = m.message;
  const content = msg?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((b: any) =>
              b?.type === "text" ? b.text
              : b?.type === "tool_use" ? `<tool_use ${b.name}>`
              : b?.type === "tool_result" ? `<tool_result${b.is_error ? " ERR" : ""}>`
              : `<${b?.type}>`,
            )
            .join(" ")
        : "";
  const flags = Object.entries(m)
    .filter(([k, v]) =>
      !["type", "message", "session_id", "uuid", "parent_tool_use_id"].includes(k) &&
      (typeof v === "string" || typeof v === "boolean" || typeof v === "number"))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  return `${m.type}${msg?.role ? "/" + msg.role : ""} ${flags} :: ${String(text).replace(/\s+/g, " ").slice(0, textMax)}`;
}

const hits: Record<string, unknown> = {};

// ---------------------------------------------------------------------------------------------
// PART A — query.interrupt() mid-turn
// ---------------------------------------------------------------------------------------------
console.log("\n########## PART A — interrupt() mid-turn ##########");
{
  const q = inputQueue();
  const Q = query({
    prompt: q.iterable as any,
    options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 8 },
  });
  q.push(userTurn(TOOL_PROMPT));

  let sid: string | undefined;
  let interruptFired = false;
  let interruptThrew: string | undefined;
  let firstToolAt = 0;
  const t0 = Date.now();
  const framesAfterInterrupt: any[] = [];
  const allFrames: any[] = [];
  let streamThrew: string | undefined;
  let result: any;

  const fireInterrupt = () => {
    if (interruptFired) return;
    interruptFired = true;
    void (async () => {
      await new Promise((r) => setTimeout(r, 1_500));
      console.log(`[A] calling interrupt() at +${Date.now() - t0}ms`);
      try { await (Q as any).interrupt(); console.log(`[A] interrupt() resolved at +${Date.now() - t0}ms`); }
      catch (e: any) { interruptThrew = e?.message ?? String(e); console.log(`[A] interrupt() THREW: ${interruptThrew}`); }
    })();
  };

  const deadline = setTimeout(() => { console.log("[A] DEADLINE — closing input"); q.close(); }, PART_DEADLINE_MS);
  try {
    for await (const m of Q) {
      const mm = m as any;
      allFrames.push(mm);
      if (interruptFired) framesAfterInterrupt.push(mm);
      if (mm.type === "system" && mm.subtype === "init") sid = mm.session_id;
      if (!firstToolAt && mm.type === "assistant" &&
          Array.isArray(mm.message?.content) && mm.message.content.some((b: any) => b?.type === "tool_use")) {
        firstToolAt = Date.now() - t0;
        console.log(`[A] first tool_use at +${firstToolAt}ms — arming interrupt`);
        fireInterrupt();
      }
      if (mm.type === "result") { result = mm; break; }
    }
  } catch (e: any) {
    streamThrew = e?.message ?? String(e);
    console.log(`[A] STREAM THREW at +${Date.now() - t0}ms: ${streamThrew}`);
  }
  clearTimeout(deadline);
  q.close();

  console.log(`\n[A] saw first tool_use : ${firstToolAt ? "+" + firstToolAt + "ms" : "NEVER (probe inconclusive)"}`);
  console.log(`[A] interrupt() threw  : ${interruptThrew ?? "no"}`);
  console.log(`[A] stream threw       : ${streamThrew ?? "no"}`);
  console.log(`[A] result frame       : ${result ? JSON.stringify({ subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns, result: String(result.result ?? "").slice(0, 200) }) : "none"}`);

  console.log(`\n[A] --- ALL ${allFrames.length} wire frames (species order) ---`);
  for (const f of allFrames) console.log("   ", frameBrief(f));

  console.log(`\n[A] --- ${framesAfterInterrupt.length} frames AFTER interrupt() was armed ---`);
  for (const f of framesAfterInterrupt) console.log("   ", frameBrief(f));

  const wireSentinel = allFrames.filter((f) => JSON.stringify(f).includes(SENTINEL));
  console.log(`\n[A] sentinel "${SENTINEL}...]" on the WIRE: ${wireSentinel.length ? "YES — " + wireSentinel.length + " frame(s)" : "NO"}`);
  for (const f of wireSentinel) console.log("    VERBATIM:", JSON.stringify(f).slice(0, 900));

  if (sid) {
    const rows = (await getSessionMessages(sid, { includeSystemMessages: true } as any)) as any[];
    console.log(`\n[A] --- persisted transcript: ${rows.length} rows ---`);
    for (const r of rows) console.log("   ", frameBrief(r));
    const tSent = rows.filter((r) => JSON.stringify(r).includes(SENTINEL));
    console.log(`\n[A] sentinel in TRANSCRIPT: ${tSent.length ? "YES — " + tSent.length + " row(s)" : "NO"}`);
    for (const r of tSent) console.log("    VERBATIM ROW:", JSON.stringify(r).slice(0, 1200));
    hits.A = {
      sid, firstToolAt, streamThrew, interruptThrew,
      resultSubtype: result?.subtype, resultIsError: result?.is_error,
      wireSentinelFrames: wireSentinel.length,
      transcriptSentinelRows: tSent.length,
      transcriptSentinelVariants: [...new Set(tSent.map((r) => JSON.stringify(r).match(/\[Request interrupted by user[^\]]*\]/)?.[0]))],
    };
  }
}

// ---------------------------------------------------------------------------------------------
// PART B — AbortController
// ---------------------------------------------------------------------------------------------
console.log("\n########## PART B — AbortController abort mid-turn ##########");
{
  const ac = new AbortController();
  const q = inputQueue();
  const Q = query({
    prompt: q.iterable as any,
    options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 8, abortController: ac },
  });
  q.push(userTurn(TOOL_PROMPT));

  let sid: string | undefined;
  let aborted = false;
  let firstToolAt = 0;
  const t0 = Date.now();
  const allFrames: any[] = [];
  const framesAfterAbort: any[] = [];
  let streamThrew: string | undefined;
  let streamErrName: string | undefined;
  let result: any;

  const deadline = setTimeout(() => { console.log("[B] DEADLINE"); ac.abort(); q.close(); }, PART_DEADLINE_MS);
  try {
    for await (const m of Q) {
      const mm = m as any;
      allFrames.push(mm);
      if (aborted) framesAfterAbort.push(mm);
      if (mm.type === "system" && mm.subtype === "init") sid = mm.session_id;
      if (!firstToolAt && mm.type === "assistant" &&
          Array.isArray(mm.message?.content) && mm.message.content.some((b: any) => b?.type === "tool_use")) {
        firstToolAt = Date.now() - t0;
        console.log(`[B] first tool_use at +${firstToolAt}ms — aborting in 1.5s`);
        setTimeout(() => { aborted = true; console.log(`[B] ac.abort() at +${Date.now() - t0}ms`); ac.abort(); }, 1_500);
      }
      if (mm.type === "result") { result = mm; break; }
    }
  } catch (e: any) {
    streamThrew = e?.message ?? String(e);
    streamErrName = e?.name;
    console.log(`[B] STREAM THREW at +${Date.now() - t0}ms: ${streamErrName}: ${streamThrew}`);
  }
  clearTimeout(deadline);
  q.close();

  console.log(`\n[B] saw first tool_use : ${firstToolAt ? "+" + firstToolAt + "ms" : "NEVER (probe inconclusive)"}`);
  console.log(`[B] stream threw       : ${streamErrName ?? "-"}: ${streamThrew ?? "no"}`);
  console.log(`[B] result frame       : ${result ? JSON.stringify({ subtype: result.subtype, is_error: result.is_error }) : "none — abort ended the stream without one"}`);
  console.log(`\n[B] --- ALL ${allFrames.length} wire frames ---`);
  for (const f of allFrames) console.log("   ", frameBrief(f));
  console.log(`[B] frames after abort(): ${framesAfterAbort.length}`);

  const wireSentinel = allFrames.filter((f) => JSON.stringify(f).includes(SENTINEL));
  console.log(`[B] sentinel on the WIRE: ${wireSentinel.length ? "YES" : "NO"}`);

  let tSent: any[] = [];
  if (sid) {
    // The CLI is killed by abort; give it a beat to flush its JSONL before reading.
    await new Promise((r) => setTimeout(r, 1_500));
    let rows: any[] = [];
    try { rows = (await getSessionMessages(sid, { includeSystemMessages: true } as any)) as any[]; }
    catch (e: any) { console.log("[B] getSessionMessages threw:", e?.message); }
    console.log(`\n[B] --- persisted transcript: ${rows.length} rows ---`);
    for (const r of rows) console.log("   ", frameBrief(r));
    tSent = rows.filter((r) => JSON.stringify(r).includes(SENTINEL));
    console.log(`[B] sentinel in TRANSCRIPT: ${tSent.length ? "YES" : "NO"}`);
    for (const r of tSent) console.log("    VERBATIM ROW:", JSON.stringify(r).slice(0, 1200));
  }
  hits.B = { sid, firstToolAt, streamErrName, streamThrew, resultSubtype: result?.subtype,
             wireSentinelFrames: wireSentinel.length, transcriptSentinelRows: tSent.length };
}

// ---------------------------------------------------------------------------------------------
// PART C — forced context-limit (one shot, no output tokens sampled: the API 400s the request)
// ---------------------------------------------------------------------------------------------
console.log("\n########## PART C — forced context-limit (oversized prompt) ##########");
{
  // ~1.3 MB of ASCII ≈ 330k tokens, comfortably over haiku's 200k window and under any 1M beta.
  const filler = ("the quick brown fox jumps over the lazy dog. ").repeat(30_000);
  const t0 = Date.now();
  const allFrames: any[] = [];
  let streamThrew: string | undefined;
  let streamErrName: string | undefined;
  let result: any;
  const ac = new AbortController();
  const deadline = setTimeout(() => { console.log("[C] DEADLINE — aborting"); ac.abort(); }, PART_DEADLINE_MS);
  try {
    for await (const m of query({
      prompt: `Reply with the single word OK. Ignore this filler:\n${filler}`,
      options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", settingSources: [],
                 maxTurns: 1, abortController: ac },
    })) {
      allFrames.push(m as any);
      if ((m as any).type === "result") { result = m; break; }
    }
  } catch (e: any) {
    streamThrew = e?.message ?? String(e);
    streamErrName = e?.name;
  }
  clearTimeout(deadline);
  console.log(`[C] elapsed: +${Date.now() - t0}ms · prompt bytes: ${filler.length}`);
  console.log(`[C] stream threw : ${streamErrName ?? "-"}: ${String(streamThrew ?? "no").slice(0, 400)}`);
  console.log(`[C] --- ${allFrames.length} wire frames ---`);
  for (const f of allFrames) console.log("   ", frameBrief(f, 400));
  if (result) console.log("[C] result VERBATIM:", JSON.stringify(result).slice(0, 1200));
  const known = ["Prompt is too long", "input length and `max_tokens` exceed context limit",
                 "Context limit reached", "Credit balance is too low", "API Error"];
  const blob = JSON.stringify(allFrames) + " " + (streamThrew ?? "");
  for (const s of known) console.log(`[C] sentinel ${JSON.stringify(s)} present: ${blob.includes(s)}`);
  hits.C = { streamErrName, streamThrew: String(streamThrew ?? "").slice(0, 300),
             frames: allFrames.length, resultSubtype: result?.subtype, resultIsError: result?.is_error,
             resultText: String(result?.result ?? "").slice(0, 300),
             sentinelsPresent: known.filter((s) => blob.includes(s)) };
}

console.log("\n########## AGGREGATE ##########");
console.log(JSON.stringify(hits, null, 2));
process.exit(0);
