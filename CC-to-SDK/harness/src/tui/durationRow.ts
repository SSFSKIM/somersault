// tui/src/durationRow.ts — Wave C Task 7 (EP-C4d): the row a COMPLETED turn leaves behind,
// `✻ Worked for 4s`, entirely dim.
//
// Canon is `Aha` (2.1.220 `cli.pretty.js` L428639-L428728), dispatched from `dVo` for
// `message.subtype === "turn_duration"` (L428358); annex §C4.d is the normative copy. Upstream's component
// is four lines of substance and every one of them is here:
//
//   let [mqp] = useState(SvH);          // the verb, picked ONCE per row                      L428640
//   let evH  = Dc("showTurnDuration", !0);   // the setting, DEFAULT TRUE                     L428650
//   let gqp  = ra(vRe.durationMs);      // the duration — `ra` IS our `formatDuration`        L428655
//   nvH = <Box minWidth={2}><Text aria-hidden dimColor>{i5}</Text></Box>                      L428699
//   oha = <Text dimColor>{`${mqp} for ${gqp}`}</Text>                                         L428703
//
// A `minWidth: 2` box holding the one-column `✻` is exactly the geometry `withAssistantBullet` already
// transcribes for `⏺`, so the glyph rides a `RenderLine.gutter` rather than being pasted onto the text:
// `<Line>` gives a gutter its own `<Text>`, which is what keeps the `aria-hidden` glyph and the words in
// separate spans the way upstream has them.
//
// IT IS PURE, AND THE VERB PICK IS INJECTED. Upstream's `useState(SvH)` is what makes the choice once and
// then holds it for the life of the row; ours is once per CALL, because the caller (useChat's turn-end arm)
// builds the line once and appends it to an append-only document — the line never re-renders itself. A test
// that wants a fixed verb passes `pickVerb`.
//
// OUT OF SCOPE, RECORDED (plan Task 7): the optional tails on the same `<Text>` (token budget, brief-mode
// hidden count, `· N still running`) and the `Waiting for N background agent(s)…` variant that REPLACES the
// duration text while agents are pending (L428694). ccx emits neither producer today.
import { formatDuration } from "./format.js";
import { classifyUserText } from "./species.js";
import type { RenderLine } from "./render.js";

/** `Nma` (L428307), verbatim and in upstream's own order. `Saut\xE9ed` is precomposed U+00E9. */
export const TURN_DURATION_VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"] as const;
/** `i5` (L41482) U+273B SIX PETALLED BLACK AND WHITE FLORETTE — the same glyph the `Thinking…` placeholder wears. */
export const TURN_DURATION_GLYPH = "✻";

/** `SvH` (L428351): `N1(Nma) ?? "Worked"` — a uniform pick, with the last verb also standing as the fallback
 *  for the degenerate index an out-of-range `random()` produces. */
export function pickTurnVerb(random: () => number = Math.random): string {
  return TURN_DURATION_VERBS[Math.floor(random() * TURN_DURATION_VERBS.length)] ?? "Worked";
}

/** `Dc("showTurnDuration", !0)` (L428650) — DEFAULT TRUE, so only an explicit `false` removes the row. */
export const turnDurationEnabled = (prefs: { showTurnDuration?: boolean }): boolean => prefs.showTurnDuration !== false;

/** The whole row. `dim` on both halves is `Aha`'s `dimColor` on both of its nodes; no colour is set at all,
 *  which is upstream's — the row is chrome, not a status. */
export function turnDurationLine(ms: number, deps: { pickVerb?: () => string } = {}): RenderLine {
  const verb = (deps.pickVerb ?? pickTurnVerb)();
  return { text: `${verb} for ${formatDuration(ms)}`, dim: true, gutter: { text: `${TURN_DURATION_GLYPH} `, dim: true } };
}

/** Does this wire frame say the turn was interrupted?
 *
 *  P80 (`docs/…/13-p80-p81-sentinels-compact.md`) measured `query.interrupt()` emitting a real `type:"user"`
 *  frame whose sole text block is `[Request interrupted by user for tool use]`; the bare `[Request interrupted
 *  by user]` variant is the same `var` line upstream (`Tq`/`Wk`, L108575) for the no-pending-tool case. The
 *  turn's own `result` frame carries the stronger signal (`is_error:true · terminal_reason:"aborted_tools"`)
 *  — but `Session.readLoop` consumes every `type:"result"` frame into its waiter and never forwards it, so a
 *  client CANNOT see it. This sentinel is the interrupt evidence that actually reaches the REPL, and it
 *  reaches it whichever client pressed Esc, which the local flag alone could not do.
 *
 *  Exact equality, delegated to `classifyUserText` so this can never drift from the transcript's own reading
 *  of the same frame: quoting the sentence inside a prompt is still a prompt (species.ts's `Tq`/`Wk` note). */
export function isInterruptSentinelFrame(m: unknown): boolean {
  const mm = m as { type?: unknown; message?: { content?: unknown } } | null | undefined;
  if (!mm || mm.type !== "user") return false;
  const content = mm.message?.content;
  const texts = typeof content === "string" ? [content]
    : Array.isArray(content) ? content.filter((b): b is { type: string; text: string } => (b as { type?: unknown })?.type === "text" && typeof (b as { text?: unknown }).text === "string").map((b) => b.text)
    : [];
  return texts.some((t) => { const kind = classifyUserText(t.trim()); return kind === "interrupt-plain" || kind === "interrupt-tool"; });
}

// NOT DISQUALIFYING, and deliberately so: an API failure. The shipped 2.1.226 client emits its
// `turn_duration` message from a `finally` gated on nothing but `!signal.aborted`, so a turn that died at
// the API — a 401, a blackholed endpoint, an over-window prompt (probe 96's synthetic
// `is_api_error_message` assistant frame) — still prints `✻ Crunched for 0s` under its red error row. ccx
// briefly suppressed that on the flag, reasoning from the spec's "when a turn completes" wording rather
// than from upstream; the review read the emission site, so the arm is gone and `is_api_error_message` is
// once again read nowhere in `src/`. The INTERRUPT arm above stays — it IS upstream's aborted-signal gate.
