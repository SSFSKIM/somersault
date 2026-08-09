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
import { SPINNER_VERBS } from "../../../src/tui/spinner.js";

const GERUND = SPINNER_VERBS.join("|");
/** Global, so callers COUNT with it; use `spinnerRows`/`spinnerUp` rather than `.test` (stateful lastIndex). */
export const SPINNER_ROW = new RegExp(`[·✢✳✶✻✽] (?:${GERUND})…`, "g");
/** ANSI is stripped HERE, not at the call site: the accent glyph is its own `<Text color>`, so the raw
 *  frame puts an SGR reset between the glyph and the gerund and a needle matched against it silently never
 *  fires. Callers that already stripped lose nothing by it. */
export const spinnerRows = (text: string): number => (text.replace(/\x1b\[[0-9;]*m/g, "").match(SPINNER_ROW) ?? []).length;
export const spinnerUp = (text: string): boolean => spinnerRows(text) > 0;
