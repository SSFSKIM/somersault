// tui/test/option-rows.test.ts — the shared yes/no rows every permission dialog reuses (F6 T4).
// Transcribed from 2.1.220's `$Qf` (L504855-878): both rows start life PLAIN (`yesInputMode`/`noInputMode`
// default to `!1` at L504855) and become `type:"input"` rows only in feedback mode, each with its own
// placeholder and `allowEmptySubmitToCancel:!0` (L504858 / L504874-877). The assembly order — yes, then the
// middle arms, then no — is the order `$Qf` pushes them.
import { describe, it, expect } from "vitest";
import {
  yesRow, noRow, yesNoRows, NO_FEEDBACK, toggleFeedbackMode, escapeFeedbackMode,
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
      placeholder: "and tell Claude what to do next", allowEmptySubmitToCancel: true,
    });
    expect(noRow(true)).toEqual({
      type: "input", label: "No", value: "no",
      placeholder: "and tell Claude what to do differently", allowEmptySubmitToCancel: true,
    });
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
