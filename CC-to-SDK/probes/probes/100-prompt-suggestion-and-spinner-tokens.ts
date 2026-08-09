// Probe 100 — Wave C grounding: the follow-up suggestion, the spinner's token feed, and the title source.
//
// WHY THIS EXISTS. Wave C (chrome & composer ergonomics) has three premises that are all of the
// declared-vs-reachable kind this project refuses to reason about in the abstract:
//
//   (a) EP-C5 — upstream 2.1.220+ pre-fills the composer with a model-generated follow-up after each turn.
//       The installed SDK DECLARES the surface: `Options.promptSuggestions?: boolean` (sdk.d.ts:1789) and
//       `SDKPromptSuggestionMessage { type: 'prompt_suggestion'; suggestion: string }` (sdk.d.ts:4227).
//       The doc comment makes three claims the spec would otherwise have to take on faith: at most one per
//       turn, it arrives AFTER the `result` message (so a consumer that breaks on `result` never sees it),
//       and it is "suppressed on the first turn". Crucially it also says suppression happens in
//       "non_interactive" — and the installed 2.1.226 bundle confirms a `Ln()` non-interactive early-return
//       in the CLI's own gate chain. A headless SDK session IS the non-interactive case. So the whole
//       question is whether the SDK's explicit opt-in outranks that gate. Declared ≠ reachable.
//   (c) The Wave C spinner parenthetical wants a LIVE incrementing output-token count. ccx already reads
//       `stream_event.message_delta.usage.output_tokens` (harness/src/tui/liveTurn.ts:145). What no unit
//       test can settle is the CADENCE: the Anthropic streaming wire classically emits `message_delta`
//       ONCE per message, just before `message_stop`. If that holds, the "live" counter is not live at all
//       — it jumps from 0 to the final figure at the end of each message, which for a single-message turn
//       means the spinner shows 0 for the whole turn and the real number for one frame. That would be a
//       materially different feature than the one the spec is about to describe.
//   (d) The terminal title needs text. The SDK has a WRITE path (`renameSession`) that ccx already uses,
//       but a title the harness has to invent is not the upstream behaviour. The question is whether the
//       engine AUTO-GENERATES a topic summary headlessly, i.e. whether `getSessionInfo(sid).summary`
//       becomes a topic line or stays the first prompt.
//
// WHAT COUNTS AS AN ANSWER.
//   ARM A  — `promptSuggestions: true`, three turns, and the loop deliberately KEEPS ITERATING past every
//            `result`. Every frame type is logged with a millisecond offset, so a `prompt_suggestion` that
//            arrives is timestamped relative to the `result` it follows, and one that never arrives is
//            provably absent rather than merely unobserved. The same loop records every `message_delta`
//            usage reading with its offset — that is arm (c), free, on the same wire.
//   ARM B  — the control: identical script with the option OMITTED. Without it, an arm-A hit could be
//            explained by something other than the flag.
//   ARM C  — the fallback shape the spec needs costed if A fails: one `query()` against haiku that turns a
//            transcript tail into a one-line follow-up. Measures wall latency and `total_cost_usd`, which
//            is what decides whether "the harness generates it itself" is affordable per turn.
//   ARM D  — `getSessionInfo()` on arm A's session: `summary` vs `customTitle` vs the first prompt.
//
// A failure mode this probe must not fall into: the doc says suggestions are suppressed on the FIRST turn,
// so a two-frame probe could report absence for the documented reason and be read as "the surface is dead".
// Three turns means turns 2 and 3 are both eligible; absence across BOTH is the finding.
import { query, getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 240_000;

console.log("=== PROBE 100 — prompt_suggestion reachability · message_delta cadence · auto title ===");
console.log("model:", MODEL);

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

/** Three short turns. Short on purpose: the probe is about frame ORDER and cadence, not content — but
 *  turn 3 asks for a few sentences so the reply spans enough deltas that a per-token cadence, if it
 *  existed, would be unmistakable against a once-per-message one. */
const SCRIPT = [
  "Reply with exactly one word: ALPHA",
  "Now reply with exactly one word: BRAVO",
  "In about four sentences, explain what a terminal escape sequence is.",
];

type DeltaSample = { turn: number; atMs: number; outputTokens: number };

async function runArm(label: string, promptSuggestions: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "probe100-"));
  console.log(`\n───────── ARM ${label} — promptSuggestions: ${promptSuggestions} ─────────`);
  console.log("cwd:", dir);

  const q = inputQueue();
  const Q = query({
    prompt: q.iterable as any,
    options: {
      model: MODEL,
      cwd: dir,
      permissionMode: "bypassPermissions",
      settingSources: [],
      includePartialMessages: true,   // arm (c) needs the stream_event frames
      maxTurns: 6,
      ...(promptSuggestions ? { promptSuggestions: true } : {}),
    } as any,
  });

  let sid: string | undefined;
  let idx = 0;
  let turnStart = Date.now();
  const suggestions: { turn: number; afterResultMs: number; text: string }[] = [];
  const deltas: DeltaSample[] = [];
  const framesAfterResult: { turn: number; atMs: number; type: string; subtype?: string }[] = [];
  const costs: number[] = [];
  let lastResultAt = 0;
  let awaitingTail = false;   // true between a `result` and the next prompt push — the window (a) lives in

  q.push(userTurn(SCRIPT[0]));
  const deadline = setTimeout(() => { console.log("DEADLINE — closing input"); q.close(); }, DEADLINE_MS);
  try {
    for await (const m of Q) {
      const mm = m as any;
      const now = Date.now();

      if (mm.type === "system" && mm.subtype === "init" && !sid) {
        sid = mm.session_id;
        console.log(`  init · session ${sid}`);
      }

      // ── arm (c): the token-count cadence ─────────────────────────────────────────────────────────
      if (mm.type === "stream_event") {
        const e = mm.event;
        if (e?.type === "message_delta" && e?.usage && typeof e.usage.output_tokens === "number") {
          deltas.push({ turn: idx, atMs: now - turnStart, outputTokens: e.usage.output_tokens });
        }
        // A per-token counter would have to come from SOMEWHERE. If `message_delta` turns out to fire
        // once, the only other candidate is a usage field on the text deltas themselves — so check, once
        // per turn, whether `content_block_delta` carries any usage at all rather than assuming not.
        if (e?.type === "content_block_delta" && e?.usage) {
          console.log(`  !! content_block_delta carried usage: ${JSON.stringify(e.usage)}`);
        }
        continue;
      }

      // ── arm (a): everything that arrives AFTER a result, before the next prompt ───────────────────
      if (awaitingTail && mm.type !== "result") {
        framesAfterResult.push({ turn: idx, atMs: now - lastResultAt, type: mm.type, subtype: mm.subtype });
      }
      if (mm.type === "prompt_suggestion") {
        suggestions.push({ turn: idx, afterResultMs: now - lastResultAt, text: String(mm.suggestion ?? "") });
        console.log(`  *** prompt_suggestion (turn ${idx}, +${now - lastResultAt}ms after result): ${JSON.stringify(mm.suggestion)}`);
        continue;
      }

      if (mm.type === "result") {
        lastResultAt = now;
        awaitingTail = true;
        if (typeof mm.total_cost_usd === "number") costs.push(mm.total_cost_usd);
        console.log(`  [turn ${idx}] ${mm.subtype} · ${now - turnStart}ms · cumulative cost $${(mm.total_cost_usd ?? 0).toFixed(6)} · message_deltas this turn: ${deltas.filter((d) => d.turn === idx).length}`);
        // THE LOAD-BEARING WAIT. The doc says the suggestion arrives after `result`; a consumer that
        // pushes the next prompt immediately would race it. 2.5s is generous for a cache-piggybacked
        // call and still cheap across three turns.
        await new Promise((r) => setTimeout(r, 2500));
        awaitingTail = false;
        idx++;
        if (idx >= SCRIPT.length) { q.close(); break; }
        turnStart = Date.now();
        q.push(userTurn(SCRIPT[idx]));
      }
    }
  } catch (e: any) {
    console.log("  STREAM THREW:", e?.name, e?.message);
  }
  clearTimeout(deadline);
  q.close();
  return { sid, suggestions, deltas, framesAfterResult, costs, dir };
}

// ── ARM A / ARM B ────────────────────────────────────────────────────────────────────────────────────
const A = await runArm("A (opt-in)", true);
const B = await runArm("B (control)", false);

// ── ARM C — the fallback: can a one-shot query() cheaply produce a follow-up from a transcript tail? ──
console.log("\n───────── ARM C — fallback: harness-generated suggestion via one-shot query() ─────────");
const TAIL = [
  "user: In about four sentences, explain what a terminal escape sequence is.",
  "assistant: A terminal escape sequence is a series of bytes beginning with ESC that a terminal",
  "emulator interprets as a command rather than as text to display. They control the cursor, colors,",
  "and window properties such as the tab title. OSC sequences in particular set window state.",
].join("\n");
let fallback: { ms: number; cost: number; text: string } | null = null;
{
  const dir = mkdtempSync(join(tmpdir(), "probe100c-"));
  const t0 = Date.now();
  let text = "";
  let cost = 0;
  try {
    for await (const m of query({
      prompt:
        "Here is the tail of a coding-session transcript. Reply with ONE short imperative follow-up the " +
        "user would plausibly type next — under 12 words, no quotes, no preamble, nothing else.\n\n" + TAIL,
      options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 1, allowedTools: [] } as any,
    })) {
      const mm = m as any;
      if (mm.type === "assistant") text += (mm.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
      if (mm.type === "result") cost = mm.total_cost_usd ?? 0;
    }
  } catch (e: any) {
    console.log("  ARM C THREW:", e?.name, e?.message);
  }
  fallback = { ms: Date.now() - t0, cost, text: text.trim() };
  console.log(`  latency ${fallback.ms}ms · cost $${fallback.cost.toFixed(6)}`);
  console.log(`  suggestion: ${JSON.stringify(fallback.text.slice(0, 160))}`);
}

// ── ARM D — is there an auto-generated title to feed a terminal title? ────────────────────────────────
console.log("\n───────── ARM D — session title source ─────────");
let info: any = null;
if (A.sid) {
  try {
    info = await getSessionInfo(A.sid, { cwd: A.dir } as any);
    console.log(`  summary      : ${JSON.stringify(info?.summary)}`);
    console.log(`  customTitle  : ${JSON.stringify(info?.customTitle)}`);
    console.log(`  firstPrompt  : ${JSON.stringify(info?.firstPrompt)}`);
  } catch (e: any) {
    console.log("  getSessionInfo THREW:", e?.name, e?.message);
  }
}

// ── verdicts ─────────────────────────────────────────────────────────────────────────────────────────
console.log("\n########## VERDICTS ##########");

console.log("\n(a) prompt_suggestion reachability");
console.log(`  ARM A suggestions: ${A.suggestions.length} · ARM B (control): ${B.suggestions.length}`);
if (A.suggestions.length > 0) {
  for (const s of A.suggestions) console.log(`    turn ${s.turn} (+${s.afterResultMs}ms): ${JSON.stringify(s.text)}`);
  console.log("  VERDICT: REACHABLE — `promptSuggestions: true` makes the engine emit `prompt_suggestion`");
  console.log("           headlessly, after `result`. The consumer MUST keep iterating past `result`.");
  if (B.suggestions.length > 0) console.log("  CAVEAT: the control arm ALSO saw one — the option is not what gates it.");
} else {
  console.log("  frames seen in the post-result window (arm A), which is where it would have been:");
  const seen = new Set(A.framesAfterResult.map((f) => `${f.type}${f.subtype ? "/" + f.subtype : ""}`));
  console.log(`    ${seen.size ? [...seen].join(", ") : "(none at all)"}`);
  console.log("  VERDICT: DECLARED BUT NOT REACHABLE headlessly across two eligible turns — the CLI's");
  console.log("           non-interactive gate wins over the SDK opt-in. Fallback (arm C) is the shape.");
}

console.log("\n(c) spinner output-token cadence");
for (const t of [0, 1, 2]) {
  const d = A.deltas.filter((x) => x.turn === t);
  if (!d.length) { console.log(`  turn ${t}: no message_delta usage at all`); continue; }
  console.log(`  turn ${t}: ${d.length} reading(s) — ${d.map((x) => `${x.outputTokens}@${x.atMs}ms`).join(", ")}`);
}
const richest = Math.max(0, ...[0, 1, 2].map((t) => A.deltas.filter((x) => x.turn === t).length));
if (richest >= 3) {
  console.log("  VERDICT: INCREMENTAL — `stream_event.message_delta.usage.output_tokens` steps up several");
  console.log("           times within a single message, so the spinner parenthetical is genuinely live.");
} else if (richest === 0) {
  console.log("  VERDICT: NO FEED — no usage arrives on partials at all; the spinner count would have to");
  console.log("           be estimated locally or dropped.");
} else {
  console.log(`  VERDICT: ONCE-PER-MESSAGE (max ${richest} reading(s) in a turn) — the count is NOT a live`);
  console.log("           ticker: it lands at the end of each assistant message. A multi-message turn steps");
  console.log("           per message; a single-message turn shows 0 until the very end. Spec must either");
  console.log("           accept a per-message step or estimate from text deltas between readings.");
}

console.log("\n(d) title text source");
console.log(`  auto summary: ${JSON.stringify(info?.summary)} · customTitle: ${JSON.stringify(info?.customTitle)}`);
const firstPrompt = SCRIPT[0];
if (info?.summary && info.summary !== firstPrompt && !info?.customTitle) {
  console.log("  VERDICT: the engine AUTO-GENERATES a topic summary headlessly — `getSessionInfo().summary`");
  console.log("           is title text the harness can emit without inventing one.");
} else {
  console.log("  VERDICT: NO auto topic title headlessly — `summary` is the first prompt (or the custom");
  console.log("           title). Terminal-title text must come from the harness: first prompt, or");
  console.log("           `renameSession()`-set custom title, which the SDK does expose as a write path.");
}

console.log("\n(fallback cost, for EP-C5 if (a) is dead)");
console.log(`  one-shot haiku follow-up: ${fallback?.ms}ms · $${fallback?.cost.toFixed(6)} per turn`);
