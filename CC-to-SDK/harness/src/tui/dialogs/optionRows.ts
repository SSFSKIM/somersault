// tui/dialogs/optionRows.ts — the yes/no rows every permission dialog shares, and the ONE place the
// feedback-mode rule lives. Transcribed from 2.1.220's `$Qf` (L504855-878).
//
// `$Qf` builds its list in a fixed order — Yes, then whatever "don't ask again" arms the suggestions
// justify, then No — and both ends have two shapes. `yesInputMode`/`noInputMode` DEFAULT TO FALSE
// (L504855), so a dialog opens with two plain pick-one rows; in feedback mode the row becomes an `RLe`
// text row carrying its own placeholder (L504858 for Yes, L504874-877 for No). The middle arms are the
// caller's business — they depend on the engine's `suggestions` payload, which is per-dialog — so
// `yesNoRows` takes them as an argument.
//
// A SECOND divergence, wave T t3 (spec W-T6/W-T17): upstream ALSO hangs `allowEmptySubmitToCancel: true`
// on both feedback rows and we deliberately do not. The flag's name is inverted from its effect — it
// carries an EMPTY submit through to `onChange` instead of to `onCancel` — so upstream's Tab-then-Enter on
// an untouched field silently selects the row, which on the No end is a deny with no message. Upstream can
// afford that because it pairs the field with a visible `tab / amend` hint; this harness shipped the
// fall-through without the hint, and QA (qa3-04) read Tab as "open me a text box" and then lost the tool to
// an Enter they never meant as an answer. Without the flag the empty Enter reaches `Select`'s `onCancel`,
// and every consult body spends its cancel on `escapeFeedbackMode` first (`GenericPermission.tsx:74` and
// its four twins) — so the row collapses, the dialog stays open, and NOTHING is decided. Note this is the
// rows' divergence alone: `bashOptions.ts`'s editable-prefix row keeps the flag, where an empty prefix
// genuinely means something (L505212-17).
//
// One divergence from `$Qf`'s shape, and it is our `Select`'s: upstream hangs a per-option `onChange` on
// each input row, ours streams the text back through the single `Select` `onChange(value, inputText)`. The
// rows here therefore carry no callbacks at all, which is what keeps them pure and comparable in a test.

import type { SelectOption } from "../select/Select.js";

/** L504858. */
export const YES_FEEDBACK_PLACEHOLDER = "and tell Claude what to do next";
/** L504875. */
export const NO_FEEDBACK_PLACEHOLDER = "and tell Claude what to do differently";

export function yesRow(feedbackMode = false): SelectOption {
  return feedbackMode
    ? { type: "input", label: "Yes", value: "yes", placeholder: YES_FEEDBACK_PLACEHOLDER }
    : { label: "Yes", value: "yes" };
}

export function noRow(feedbackMode = false): SelectOption {
  return feedbackMode
    ? { type: "input", label: "No", value: "no", placeholder: NO_FEEDBACK_PLACEHOLDER }
    : { label: "No", value: "no" };
}

/** Which of the two ends is currently a text row. Both false is the state every dialog opens in. */
export interface FeedbackMode { yes: boolean; no: boolean }
export const NO_FEEDBACK: FeedbackMode = Object.freeze({ yes: false, no: false });

/** `$Qf`'s assembly order: Yes · the caller's "don't ask again" arms · No. */
export function yesNoRows(mode: FeedbackMode = NO_FEEDBACK, middle: SelectOption[] = []): SelectOption[] {
  return [yesRow(mode.yes), ...middle, noRow(mode.no)];
}

// ── The feedback-mode trigger, decided once, here ────────────────────────────────────────────────────
// Upstream drives `yesInputMode`/`noInputMode` from its own host state and the bundle does not spell the
// key out; this harness binds it to Tab on the focused row, surfaced by `Select`'s `onInputModeToggle`.
// Tab on any other row does nothing. Esc then has two jobs and they are ordered: it leaves input mode
// first and cancels the dialog second, so a human who typed half a sentence and hit Esc gets their row
// back rather than losing the whole prompt.

/** Tab on the row named by `value`. Any other row is not toggleable, and returns the state untouched. */
export function toggleFeedbackMode(mode: FeedbackMode, value: string): FeedbackMode {
  if (value === "yes") return { ...mode, yes: !mode.yes };
  if (value === "no") return { ...mode, no: !mode.no };
  return mode;
}

/** Esc. Returns the next state, or `undefined` when nothing was in input mode — the caller's signal that
 *  THIS Esc is the one that cancels the dialog. */
export function escapeFeedbackMode(mode: FeedbackMode): FeedbackMode | undefined {
  return mode.yes || mode.no ? { yes: false, no: false } : undefined;
}
