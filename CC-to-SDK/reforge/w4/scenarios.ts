// W4 corpus family — "what happens on the far side of a compact_boundary"
// (campaign spec C7 / §3.2's compaction-depth family).
//
// THE COVERAGE PROBLEM THIS EXISTS TO FIX. `slash-compact` drives `/compact` to
// a boundary and stops there, so the corpus grades the compaction that HAPPENED
// and nothing about what the engine does with its result. Two whole units of
// the subsystem sit on the far side of that stopping point:
//
//   the continuation message  — upstream strips the `<analysis>` block from the
//                               model's summary, rewrites `<summary>` to a
//                               `Summary:` heading, and wraps the result in the
//                               "This session is being continued…" preamble that
//                               rides in the next request's first user message,
//                               as its second text block (the system-reminder
//                               block leads).
//   the trigger policy        — the predicate that decides compaction is needed
//                               at all. `/compact` bypasses it entirely: a manual
//                               compaction is requested, not predicted.
//
//   compact-continue        one more exchange AFTER `/compact`, so the summary
//                           the engine carried forward has to actually work as
//                           context — the reply is only reachable through it.
//   auto-compact-threshold  the same conversation with the threshold lowered, so
//                           the engine decides to compact BY ITSELF: a boundary
//                           with `trigger:"auto"` (every other recording says
//                           "manual"), reached through the predicate.
//
// X6, AND WHY THE SECOND SCENARIO NEEDS AN ENVIRONMENT VARIABLE. The natural
// reactive trigger is `effectiveWindow − 13,000` tokens — MEASURED at 167,000
// for the corpus's model (the engine's own debug line reports
// `effectiveWindow=180000`), which is on the order of a hundred exchanges of
// deliberately enormous payloads and a multi-megabyte cassette, for one
// predicate. So the campaign spec's C6–C10 bloc records C3's sign-off for
// exactly one addition to the allowlist, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
// (`src/env.ts` `autoCompactPct`), which upstream itself reads as
// `testPctOverride` and which lowers the same threshold to a percentage of the
// same window. It is declared here, by the one scenario that wants it, and set
// identically for both engines — so it changes what the engine DOES, never what
// the diff compares.
//
// TWO LEVERS WERE TRIED AND ONE WAS DISPROVED, which is worth recording because
// it looked like the X6-cleaner answer. The window SOURCE also has to be
// non-`auto` for the predicate to run at all (`QB() && !$G(model, window)`), and
// the settings key `autoCompactWindow` would set it without touching the
// environment — but `managedSettings: { autoCompactWindow: … }` does not reach
// `options.autoCompactWindow` on the headless seam: with it set, the engine
// still reported `thresholdSource=model-default`. It is not needed either. The
// source is ALREADY non-`auto` for the corpus's model, because the model carries
// a compiled-in default window, so the threshold value is the only thing that
// ever had to move.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, pushable, resultsOf, userMessage, type Scenario } from "../src/harness.js";
import { sdkEnv } from "../src/runTurn.js";

/**
 * The lowered auto-compaction threshold, as a percentage of the effective
 * context window — 30% of 180,000, i.e. 54,000 prompt tokens.
 *
 * CHOSEN TO SIT IN A WIDE GAP, not to be minimal. Upstream's `W3()` computes
 * `min(floor(effectiveWindow × pct/100), effectiveWindow − 13,000)`, so this is
 * the whole threshold. The conversation below plateaus at ≈27,800 tokens across
 * its small exchanges (the tool catalog dominates the prompt) and then jumps by
 * the size of one `PAYLOAD`, so 54,000 sits ≈26,000 above the plateau and
 * ≈14,000 below the post-payload total. Both margins are far larger than the
 * turn-to-turn drift, which is what makes the recording reproducible rather than
 * tuned to a single take.
 *
 * The first attempt used 1% (a 1,800-token threshold) on the theory that lower
 * is safer. It is not: the trigger then fires on the SECOND exchange, and
 * upstream refuses to compact a conversation that short — the engine logged
 * "Reactive compact: no assistant messages in summarize set, bailing" and
 * returned no boundary. The predicate is only half of what a recording of it
 * needs; the conversation has to be long enough for the compactor to have
 * something to summarize.
 */
const AUTO_COMPACT_PCT = "30";

/**
 * One deliberately large user message, ≈160,000 characters (≈40,000 tokens).
 *
 * Filler rather than tool output on purpose: a Bash result of this size would
 * make the recording depend on the model choosing to call the tool and on the
 * output surviving truncation, whereas a literal user message is exactly the
 * same bytes on every run. Built here rather than committed as a fixture for the
 * same reason `w3` seeds its git repository in the scenario body — it has to be
 * identical on both replay sides, and it is cheaper to generate than to store.
 */
const PAYLOAD = Array.from(
  { length: 2000 },
  (_unused, i) => `REFORGE_FILLER_${String(i).padStart(4, "0")} alpha bravo charlie delta echo foxtrot golf hotel india juliet`,
).join("\n");

/** `/compact` refuses a conversation with too little history ("Not enough messages to compact."). */
const FILLER = [
  "Remember the codeword REFORGE_CONTINUE_ECHO. Reply with exactly OK.",
  "Name three primary colors, one per line, nothing else.",
  "Name three prime numbers under 20, one per line, nothing else.",
  "Name three continents, one per line, nothing else.",
  "Name three planets, one per line, nothing else.",
  "Name three metals, one per line, nothing else.",
];

/** Every message the engine emitted, in order, for a streaming-input session driven by `next`. */
async function converse(options: Parameters<typeof query>[0]["options"], next: (results: number) => string | null): Promise<unknown[]> {
  const input = pushable<ReturnType<typeof userMessage>>();
  const messages: unknown[] = [];
  const first = next(0);
  if (first === null) throw new Error("w4: the conversation needs at least one user message");
  input.push(userMessage(first));
  let results = 0;
  for await (const m of query({ prompt: input, options })) {
    messages.push(m);
    if ((m as { type?: string }).type === "result") {
      results++;
      const following = next(results);
      if (following === null) input.end();
      else input.push(userMessage(following));
    }
  }
  return messages;
}

const boundaryOf = (msgs: unknown[]): { compact_metadata?: { trigger?: string; pre_tokens?: number } } | undefined =>
  msgs.find((m) => (m as { subtype?: string }).subtype === "compact_boundary") as
    | { compact_metadata?: { trigger?: string; pre_tokens?: number } }
    | undefined;

/**
 * The continuation preamble upstream puts in front of every carried-forward
 * summary. Written out rather than imported from the owned module: a scenario is
 * a black-box caller, and a check that read the module's own constant would pass
 * on a build where both the module and the check were wrong together.
 */
const CONTINUATION_PREAMBLE = "This session is being continued from a previous conversation that ran out of context.";

/** The continuation message the engine carried past a boundary, if it sent one. */
function carriedSummary(msgs: unknown[]): string | null {
  for (const m of msgs) {
    const mm = m as { type?: string; message?: { content?: unknown } };
    if (mm.type !== "user") continue;
    const text = JSON.stringify(mm.message?.content ?? "");
    if (text.includes(CONTINUATION_PREAMBLE)) return text;
  }
  return null;
}

/**
 * What a carried summary must be, stated as engine behaviour rather than as
 * model behaviour.
 *
 * Deliberately NOT "the model still remembers the codeword": what the summary
 * happens to retain is the model's choice, and a check that depended on it would
 * grade the oracle's mood rather than the two functions this scenario exists to
 * cover. What IS the engine's: the preamble, the transcript-path clause the
 * engine appends from the session it is running, and the fact that summary text
 * sits between them.
 */
function continuationFailure(msgs: unknown[]): string | null {
  const carried = carriedSummary(msgs);
  if (carried === null) return "no continuation message — the summary was never carried past the boundary";
  if (!carried.includes("read the full transcript at:")) return "the continuation carries no transcript path";
  return carried.length > CONTINUATION_PREAMBLE.length + 400 ? null : "the continuation carries no summary text, only its preamble";
}

export const W4_SCENARIOS: Scenario[] = [
  {
    // The manual path, one exchange further than `slash-compact` goes. That one
    // exchange is the whole point: it is what puts the stripped-and-wrapped
    // summary into a REQUEST BODY, so the continuation is graded on the request
    // surface as well as in the transcript, and the trailing question is one only
    // the carried context can answer.
    tag: "compact-continue",
    title: "/compact, then one more exchange carried by the summary",
    run: (ctx) =>
      converse(
        { ...baseOptions(ctx), allowedTools: [], permissionMode: "bypassPermissions" },
        (results) => {
          if (results < FILLER.length) return FILLER[results];
          if (results === FILLER.length) return "/compact";
          if (results === FILLER.length + 1) {
            return "What was the codeword I asked you to remember at the start? Reply with exactly that codeword and nothing else.";
          }
          return null;
        },
      ),
    check: (msgs) => {
      const boundary = boundaryOf(msgs);
      if (!boundary) return "no compact_boundary frame — the conversation never compacted";
      if (boundary.compact_metadata?.trigger !== "manual") return `expected a manual boundary, saw ${boundary.compact_metadata?.trigger}`;
      const carried = continuationFailure(msgs);
      if (carried !== null) return carried;
      const rs = resultsOf(msgs);
      return rs.length === FILLER.length + 2 ? null : `expected ${FILLER.length + 2} results, saw ${rs.length}`;
    },
  },

  {
    // The trigger policy. Everything about this scenario except the threshold is
    // an ordinary conversation; the engine decides on its own that it must
    // compact, and the boundary it emits says `trigger:"auto"` where every other
    // recording in the corpus says "manual".
    //
    // One recording grades three things in order: the predicate that decided to
    // compact, the automatic boundary it produced, and the continuation message
    // the next request carried.
    tag: "auto-compact-threshold",
    title: "the engine compacts by itself once the threshold is crossed",
    run: (ctx) =>
      converse(
        {
          ...baseOptions(ctx),
          // Declared by this scenario alone (X6). `ctx.knobs` is spread first so
          // a driver that sets its own knobs — the flip-liveness experiment sets
          // gate overrides — keeps them.
          env: sdkEnv(ctx.mode, ctx.baseUrl, { ...ctx.knobs, autoCompactPct: AUTO_COMPACT_PCT }),
          allowedTools: [],
          permissionMode: "bypassPermissions",
        },
        (results) => {
          // Three small exchanges give the compactor something to summarize; the
          // fourth crosses the threshold in one step; the fifth is the question
          // only the summary can answer.
          if (results === 0) {
            return "Remember these three facts for later: the codeword is REFORGE_AUTOCOMPACT_DELTA, the color is teal, and the number is 41. Reply with exactly OK.";
          }
          if (results === 1) return "Name three primary colors, one per line, nothing else.";
          if (results === 2) return "Name three prime numbers under 20, one per line, nothing else.";
          if (results === 3) return `Here is a block of filler text. Do not summarize it, do not quote it, just reply with exactly OK.\n\n${PAYLOAD}`;
          if (results === 4) return "What was the codeword I asked you to remember at the start? Reply with exactly that codeword and nothing else.";
          return null;
        },
      ),
    check: (msgs) => {
      const boundary = boundaryOf(msgs);
      if (!boundary) return "no compact_boundary frame — the lowered threshold did not trigger compaction";
      if (boundary.compact_metadata?.trigger !== "auto") {
        return `boundary trigger is ${boundary.compact_metadata?.trigger}, not "auto" — this compaction was requested, not predicted`;
      }
      if (typeof boundary.compact_metadata?.pre_tokens !== "number") return "compact_boundary carried no pre_tokens";
      const carried = continuationFailure(msgs);
      if (carried !== null) return carried;
      const rs = resultsOf(msgs);
      return rs.length === 5 ? null : `expected 5 results, saw ${rs.length}`;
    },
  },
];
