// tui/test/option-rows.test.ts — the shared yes/no rows every permission dialog reuses (F6 T4).
// Transcribed from 2.1.220's `$Qf` (L504855-878): both rows start life PLAIN (`yesInputMode`/`noInputMode`
// default to `!1` at L504855) and become `type:"input"` rows only in feedback mode, each with its own
// placeholder (L504858 / L504874-877). The assembly order — yes, then the middle arms, then no — is the
// order `$Qf` pushes them. The ONE deliberate divergence, wave T t3 (spec W-T6/W-T17): upstream also hangs
// `allowEmptySubmitToCancel:!0` on both rows and we do not, so an empty Enter is a no-op here — see the
// module header for why.
import { describe, it, expect } from "vitest";
import {
  yesRow, noRow, yesNoRows, NO_FEEDBACK, toggleFeedbackMode, escapeFeedbackMode, collapseOnFocusChange,
} from "../../src/tui/dialogs/optionRows.js";

describe("yesRow / noRow", () => {
  it("are plain pick-one rows by default (L504855: both input modes start false)", () => {
    expect(yesRow()).toEqual({ label: "Yes", value: "yes" });
    expect(noRow()).toEqual({ label: "No", value: "no" });
    expect(yesRow(false)).toEqual({ label: "Yes", value: "yes" });
    expect(noRow(false)).toEqual({ label: "No", value: "no" });
  });

  it("become input rows in feedback mode, with the bundle's own placeholders", () => {
    expect(yesRow(true)).toEqual({
      type: "input", label: "Yes", value: "yes",
      placeholder: "and tell Claude what to do next",
    });
    expect(noRow(true)).toEqual({
      type: "input", label: "No", value: "no",
      placeholder: "and tell Claude what to do differently",
    });
  });

  // Wave T t3 (qa3-04). The flag's name is inverted from its effect: `allowEmptySubmitToCancel: true` means
  // "carry the empty submit to `onChange`", and carrying it is what turned Tab-then-Enter into a silent deny.
  // Dropping it keeps the empty Enter out of `onChange` entirely, so no decision is sent — wave 2 t2 then
  // routed that empty Enter to the bodies' `onEmptySubmit` (it used to borrow `onCancel`), which changes what
  // the human SEES and not what the rows carry. Pinned as an ABSENCE, not a `false`: the property must not be
  // on the object at all, since `Select` only tests it for truthiness.
  it("carry NO empty-submit flag, so an empty Enter never reaches `onChange` (W-T6/W-T17)", () => {
    expect(yesRow(true)).not.toHaveProperty("allowEmptySubmitToCancel");
    expect(noRow(true)).not.toHaveProperty("allowEmptySubmitToCancel");
  });
});

describe("yesNoRows", () => {
  it("brackets the middle arms with yes and no, in `$Qf` order", () => {
    const middle = [{ value: "yes-apply-suggestions", label: "Yes, and don't ask again" }];
    expect(yesNoRows(NO_FEEDBACK, middle).map((o) => o.value)).toEqual(["yes", "yes-apply-suggestions", "no"]);
  });

  it("puts ONLY the row whose feedback mode is on into input mode", () => {
    const [yes, no] = yesNoRows({ yes: true, no: false });
    expect(yes!.type).toBe("input");
    expect(no!.type).toBeUndefined();
    const [yes2, no2] = yesNoRows({ yes: false, no: true });
    expect(yes2!.type).toBeUndefined();
    expect(no2!.type).toBe("input");
  });

  it("defaults to no feedback at all", () => {
    expect(yesNoRows()).toEqual([{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]);
  });
});

describe("the feedback-mode rule (decided once, here)", () => {
  it("Tab on a row toggles THAT row, and only that row", () => {
    const a = toggleFeedbackMode(NO_FEEDBACK, "yes");
    expect(a).toEqual({ yes: true, no: false });
    const b = toggleFeedbackMode(a, "no");
    expect(b).toEqual({ yes: true, no: true });
    expect(toggleFeedbackMode(b, "yes")).toEqual({ yes: false, no: true });
  });

  it("ignores a Tab on any other row", () => {
    expect(toggleFeedbackMode(NO_FEEDBACK, "yes-apply-suggestions")).toBe(NO_FEEDBACK);
  });

  it("Esc leaves input mode FIRST and cancels SECOND", () => {
    expect(escapeFeedbackMode({ yes: true, no: false })).toEqual(NO_FEEDBACK);
    expect(escapeFeedbackMode({ yes: false, no: true })).toEqual(NO_FEEDBACK);
    expect(escapeFeedbackMode({ yes: true, no: true })).toEqual(NO_FEEDBACK);
    expect(escapeFeedbackMode(NO_FEEDBACK)).toBeUndefined();      // undefined = "now cancel the dialog"
  });
});

// Wave T t5 (L505162-169). Moving the cursor OFF a feedback row collapses it back to a pick-one row when the
// field is empty; a row holding typed text stays open, because collapsing it would hide what was written.
describe("collapseOnFocusChange (L505162-169)", () => {
  it("collapses an EMPTY feedback row once the cursor lands somewhere else", () => {
    expect(collapseOnFocusChange({ yes: false, no: true }, "yes", true)).toEqual({ yes: false, no: false });
    expect(collapseOnFocusChange({ yes: true, no: false }, "no", true)).toEqual({ yes: false, no: false });
    expect(collapseOnFocusChange({ yes: false, no: true }, "yes-apply-suggestions", true)).toEqual(NO_FEEDBACK);
  });

  it("leaves a row holding text open — the whole point of the rule", () => {
    const mode = { yes: false, no: true };
    expect(collapseOnFocusChange(mode, "yes", false)).toBe(mode);
  });

  it("never collapses the row the cursor is ON", () => {
    const mode = { yes: false, no: true };
    expect(collapseOnFocusChange(mode, "no", true)).toBe(mode);
    const both = { yes: true, no: true };
    expect(collapseOnFocusChange(both, "no", true)).toEqual({ yes: false, no: true });
  });

  it("is identity when nothing is in feedback mode at all", () => {
    expect(collapseOnFocusChange(NO_FEEDBACK, "yes", true)).toBe(NO_FEEDBACK);
    expect(collapseOnFocusChange(NO_FEEDBACK, "no", false)).toBe(NO_FEEDBACK);
  });
});
