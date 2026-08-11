// tui/test/consult-footer.test.tsx — the shared consult footer (Wave T task 4), transcribed from 2.1.220's
// L505286: a dim `·`-joined hint row. The claims that matter are the conditionals — the amend hint renders
// only while the focused row is a feedback row (`aZf`, L505186) that is NOT already in input mode, and the
// explain hint's verb flips between `explain` and `hide` (L505286). `esc cancel` is unconditional and is
// ccx's spelling of upstream's `escape / cancel` (the wave does not re-spell it).
//
// Wave 2 t2 adds the two input-mode affordances (s2qa3-10): `enter send` while the feedback row IS the field,
// and the `nudge` line an empty Enter raises. Both are ccx's, not upstream's — upstream never reaches an empty
// feedback row with Enter because its row carries `allowEmptySubmitToCancel` and answers instead (optionRows.ts
// records why we do not). Having declined upstream's answer, we owe the human an explanation of the silence.
//
// The `amendable` half arrived with the external review: the footer used to read `inputMode` alone and so
// advertised `tab amend` on rows that ignore Tab (every body toggles feedback mode on the No row only —
// `isAmendableRow`, optionRows.ts). The two gates are independent, so both are pinned here and the four
// combinations are pinned together.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ConsultFooter, EMPTY_SUBMIT_NUDGE } from "../../src/tui/dialogs/ConsultFooter.js";
import { isAmendableRow } from "../../src/tui/dialogs/optionRows.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const lines = (ui: React.ReactElement) => plain(render(ui).lastFrame() ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
/** The HINT row — the last non-blank line, so a nudge above it does not change what these assertions read. */
const row = (ui: React.ReactElement) => lines(ui).at(-1) ?? "";

describe("<ConsultFooter> (L505286)", () => {
  it("advertises amend while an amendable pick-one row is focused", () => {
    expect(row(<ConsultFooter amendable inputMode={false} />)).toBe("esc cancel · tab amend");
  });

  // Wave 2 t2 (s2qa3-10). The amend hint still goes — but silence is what left QA pressing Enter on an empty
  // field and reading the collapse as a lost tool. While the row IS the input, the footer states the contract
  // the row actually has: Enter sends what you typed, Esc backs out. `enter send` leads because it is the key
  // whose meaning just changed.
  it("drops the amend hint once the feedback row IS the input (aZf L505186), and advertises `enter send`", () => {
    expect(row(<ConsultFooter amendable inputMode={true} />)).toBe("enter send · esc cancel");
  });

  it("drops it on a row Tab cannot amend — the Yes row, and every don't-ask-again row", () => {
    expect(row(<ConsultFooter amendable={false} inputMode={false} />)).toBe("esc cancel");
  });

  it("appends the explain hint when the dialog supports it, and flips its verb to hide", () => {
    expect(row(<ConsultFooter amendable inputMode={false} explain="explain" />)).toBe("esc cancel · tab amend · ctrl+e explain");
    expect(row(<ConsultFooter amendable inputMode={false} explain="hide" />)).toBe("esc cancel · tab amend · ctrl+e hide");
    // …and it survives an unamendable row, which is the opening state of every body that has an explainer.
    expect(row(<ConsultFooter amendable={false} explain="explain" />)).toBe("esc cancel · ctrl+e explain");
  });

  it("keeps explain reachable from inside input mode (only the amend hint is mode-gated)", () => {
    expect(row(<ConsultFooter amendable inputMode={true} explain="explain" />)).toBe("enter send · esc cancel · ctrl+e explain");
  });

  // Wave 2 t2 (s2qa3-10), the reactive half. `onEmptySubmit` fires when Enter lands on an empty feedback row;
  // the body raises this line so the keystroke that did nothing SAYS so. It sits ABOVE the hint row and is
  // undimmed — the footer is chrome the eye skips, and this is an answer to something the human just did.
  it("raises the empty-submit nudge above the hint row, and only when asked", () => {
    expect(lines(<ConsultFooter amendable inputMode nudge />)).toEqual([EMPTY_SUBMIT_NUDGE, "enter send · esc cancel"]);
    expect(EMPTY_SUBMIT_NUDGE).toBe("type a message, or esc to cancel");
    expect(lines(<ConsultFooter amendable inputMode />)).toEqual(["enter send · esc cancel"]);
    expect(lines(<ConsultFooter />)).toEqual(["esc cancel"]);
  });

  it("defaults to promising nothing it cannot deliver, and renders dim", () => {
    const f = render(<ConsultFooter />).lastFrame() ?? "";
    expect(plain(f).trim()).toBe("esc cancel");
    expect(f).toContain("\x1b[2m");                            // dimColor
  });
});

describe("isAmendableRow — the predicate both the footer's prop and Tab's handler read", () => {
  it("is the No row and nothing else", () => {
    expect(isAmendableRow("no")).toBe(true);
    for (const v of ["yes", "yes-prefix-edited", "yes-apply-suggestions", "yes-dont-ask-again", ""]) {
      expect(isAmendableRow(v)).toBe(false);
    }
  });
});
