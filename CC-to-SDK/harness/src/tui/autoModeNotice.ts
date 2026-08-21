// tui/autoModeNotice.ts — upstream's AUTO_MODE_DESCRIPTION (2.1.220 L547286) and the once-per-install gate
// around it (L547935-955: a mode-keyed effect, an 800ms delay, and the hasSeenAutoModeEntryWarning
// app-config flag). Upstream appends it as a transcript `notice` message via ml(text, "notice") — NOT a
// dialog and NOT a styled block, which is why this module exports only the string and the predicate.
//
// RECORDED DIVERGENCE: upstream's gate `OMa` (L454515-517) is hasSeenAutoModeEntryWarning OR
// `skipAutoPermissionPrompt` at policy/user/flag scope. ccx keeps only the first half — it has no
// settings-scope equivalent for the second.
//
// T2 (F9 T-AUTO, spec Track T-AUTO §A2): canon actually ships TWO variants of this copy (2.1.236
// L676952-676958), not one. Base and tail are byte-identical between them; the subscription (OAuth) variant
// drops exactly one sentence — "Sessions are slightly more expensive." — because a subscription seat doesn't
// meter per-session API spend the way a metered API key does. `autoModeNoticeText` is the real selector;
// `AUTO_MODE_DESCRIPTION` below is kept as the non-oauth shape ccx originally shipped (2.1.220), now defined
// as that selector's own output so the two can never drift apart. Rule (spec-settled divergence): `oauth` is
// true iff the launch's token source is literally `CLAUDE_CODE_OAUTH_TOKEN`; false OR UNKNOWN (an attach
// client, which has no launch-config source at all) both keep the cost sentence — silence about billing is
// worse than a sentence that turns out not to apply, so the unknown arm defaults to showing it.
import type { CcxPrefs } from "./prefs.js";

const AUTO_MODE_BASE =
  "Auto mode lets Claude handle permission prompts automatically — Claude checks each tool call for risky actions and prompt injection before executing. Actions Claude identifies as safe are executed, while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal for long-running tasks.";
const AUTO_MODE_COST_SENTENCE = " Sessions are slightly more expensive.";
const AUTO_MODE_TAIL =
  " Claude can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode.";

/** The canon selector (2.1.236 L676952-676958): the OAuth/subscription variant omits the cost sentence;
 *  every other token source (including unknown/absent) keeps it. */
export function autoModeNoticeText(opts: { oauth: boolean }): string {
  return AUTO_MODE_BASE + (opts.oauth ? "" : AUTO_MODE_COST_SENTENCE) + AUTO_MODE_TAIL;
}

/** L547286, verbatim — the non-oauth (API-key/unknown) variant, which is both the 2.1.220 shape this module
 *  shipped with and exactly `autoModeNoticeText({ oauth: false })`'s output. */
export const AUTO_MODE_DESCRIPTION = autoModeNoticeText({ oauth: false });

export function shouldShowAutoModeNotice(prefs: CcxPrefs): boolean { return prefs.hasSeenAutoModeEntryWarning !== true; }

/** L547955. */
export const AUTO_MODE_NOTICE_DELAY_MS = 800;
