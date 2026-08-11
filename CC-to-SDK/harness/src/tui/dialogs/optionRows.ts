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
// an Enter they never meant as an answer. Without the flag the empty Enter decides NOTHING — the dialog
// stays open and no message is sent. Note this is the rows' divergence alone: `bashOptions.ts`'s
// editable-prefix row keeps the flag, where an empty prefix genuinely means something (L505212-17).
//
// WAVE 2 t2 (s2qa3-10) kept that rule and moved where the empty Enter LANDS. t3 let it fall through to
// `Select`'s `onCancel`, which every consult body spends on `escapeFeedbackMode` first — so the field the
// human had just opened folded shut under them, and the next sweep read Tab-then-Enter as "the amendment was
// reverted, and then the tool was denied". The bodies now hand `Select` an `onEmptySubmit` (Select.tsx),
// which holds the row open and raises the footer's nudge instead. Esc keeps its own two-step, unchanged.
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

/** Which rows Tab can actually turn into a feedback row, asked of the row that HAS the cursor. The `no` row
 *  alone: the SDK's allow arm carries no message field (T3), so every body drops Tab on Yes, and a
 *  "don't ask again" row has no feedback shape at all. TWO readers, deliberately — each body's
 *  `onInputModeToggle` (what Tab does) and its `ConsultFooter` (whether Tab is advertised). They were
 *  allowed to disagree once, and the footer promised `tab amend` on rows that ignore the key; one predicate
 *  is what stops that recurring. */
export const isAmendableRow = (focusedValue: string): boolean => focusedValue === "no";

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

/** The cursor moved, and now sits on `focusedValue` (`Select`'s `onFocus`). L505162-169: a feedback row the
 *  cursor LEAVES goes back to being a plain pick-one row when its field is empty — an empty text row and a
 *  plain row say the same nothing, and the plain one keeps `y`/`n` and the digits live. A row holding typed
 *  text stays open instead, because collapsing it would hide what was written behind a label that does not
 *  mention it. The row the cursor is ON is never a departure, so it never collapses.
 *
 *  `isEmpty` is the caller's reading of the row that is losing the cursor, and one flag is enough because the
 *  bodies only ever open one end (Tab on Yes is dropped — the SDK's allow arm has no message field, T3). It
 *  reads the same `.trim()`-empty the empty-submit rule uses, so "empty enough to collapse" and "empty enough
 *  to be a no-op Enter" cannot disagree. Identity-preserving when nothing changes: this runs inside a focus
 *  report, and a fresh-but-equal object there is a render for nothing. */
export function collapseOnFocusChange(mode: FeedbackMode, focusedValue: string, isEmpty: boolean): FeedbackMode {
  if (!isEmpty) return mode;
  const yes = mode.yes && focusedValue === "yes", no = mode.no && focusedValue === "no";
  return yes === mode.yes && no === mode.no ? mode : { yes, no };
}
