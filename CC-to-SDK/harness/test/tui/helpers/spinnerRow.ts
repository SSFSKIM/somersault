// test/tui/helpers/spinnerRow.ts — the SPINNER-SCOPED needle, and the reason it exists.
//
// Until Wave C Task 6 every "is the live-turn spinner up?" assertion in this directory waited on
// `esc to interrupt`, because the spinner tail carried that copy. It does not any more: canon's `C0p`
// parenthetical is `({elapsed} · {↓|↑} {N} tokens · {phase})` with no interrupt offer in it, and the offer
// moved to the footer hint list, which is on screen for EVERY busy frame. Waiting on it is now precisely the
// trap plan constraint 5 names — copy that also appears in the permanent footer — and it is also
// keybinding-dependent (a rebound `chat:cancel` spells it `alt+c to interrupt`).
//
// What IS spinner-scoped: an asterisk-pulse glyph, a gerund from the vocabulary, and the ellipsis. Both of
// the other rows that can take the same slot are excluded by construction — `✻ Waiting for API response`
// and `· Compacting conversation…` put a space where this needle wants `…`.
//
// …with ONE collision that construction does NOT exclude, found in the Task 6 review: `render.ts`'s
// `THINKING_PLACEHOLDER` is literally `✻ Thinking…`, and `Thinking` is one of the 186 verbs. A collapsed
// thinking block anywhere in the frame would therefore be counted as a live spinner row — exactly the false
// positive a census helper must not have, and unfixable by stripping ANSI harder, since after the strip the
// two rows are the same characters.
//
// So the needle drops that ONE combination rather than the verb: `Thinking…` is matched behind any glyph
// EXCEPT `✻`. The placeholder's glyph is a frozen literal (`render.ts`'s `THINKING_PLACEHOLDER`), so this
// kills the false positive outright, while a real spinner that drew `Thinking` still counts on five of its
// six glyphs — where dropping the verb entirely would have made every such spinner (1 in 186
// mounts) invisible to a `waitFor` that has no other way to see it.
//
// As of F8 T5 the row does NOT always carry a gerund from `SPINNER_VERBS`: with an active main-agent task,
// `spinnerMessage`'s ladder titles the row from that task's `activeForm`/`subject` instead, so `spinnerUp()`
// returns false and `spinnerRows()` counts 0 for a turn that is genuinely live. No test here seeds a task
// into a busy turn, so today's suite is unaffected — but a future `waitFor(() => spinnerUp(...))` during a
// task-bearing turn will hang with nothing pointing at why; use `spinnerLine`/`SPINNER_ROW` awareness of the
// task ladder for that case instead.
import { SPINNER_VERBS } from "../../../src/tui/spinner.js";

const GERUND = SPINNER_VERBS.filter((v) => v !== "Thinking").join("|");
/** Global, so callers COUNT with it; use `spinnerRows`/`spinnerUp` rather than `.test` (stateful lastIndex). */
export const SPINNER_ROW = new RegExp(`(?:[·✢✳✶✻✽] (?:${GERUND})|[·✢✳✶✽] Thinking)…`, "g");
/** ANSI is stripped HERE, not at the call site: the accent glyph is its own `<Text color>`, so the raw
 *  frame puts an SGR reset between the glyph and the gerund and a needle matched against it silently never
 *  fires. Callers that already stripped lose nothing by it. */
export const spinnerRows = (text: string): number => (text.replace(/\x1b\[[0-9;]*m/g, "").match(SPINNER_ROW) ?? []).length;
export const spinnerUp = (text: string): boolean => spinnerRows(text) > 0;
