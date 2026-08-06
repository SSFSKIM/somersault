// tui/test/consult-footer.test.tsx — the shared consult footer (Wave T task 4), transcribed from 2.1.220's
// L505286: a dim `·`-joined hint row. The claims that matter are the conditionals — the amend hint renders
// only while the focused row is a feedback row (`aZf`, L505186) that is NOT already in input mode, and the
// explain hint's verb flips between `explain` and `hide` (L505286). `esc cancel` is unconditional and is
// ccx's spelling of upstream's `escape / cancel` (the wave does not re-spell it).
//
// The `amendable` half arrived with the external review: the footer used to read `inputMode` alone and so
// advertised `tab amend` on rows that ignore Tab (every body toggles feedback mode on the No row only —
// `isAmendableRow`, optionRows.ts). The two gates are independent, so both are pinned here and the four
// combinations are pinned together.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ConsultFooter } from "../../src/tui/dialogs/ConsultFooter.js";
import { isAmendableRow } from "../../src/tui/dialogs/optionRows.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const row = (ui: React.ReactElement) => plain(render(ui).lastFrame() ?? "").trim();

describe("<ConsultFooter> (L505286)", () => {
  it("advertises amend while an amendable pick-one row is focused", () => {
    expect(row(<ConsultFooter amendable inputMode={false} />)).toBe("esc cancel · tab amend");
  });

  it("drops the amend hint once the feedback row IS the input (aZf L505186) — you are already typing", () => {
    expect(row(<ConsultFooter amendable inputMode={true} />)).toBe("esc cancel");
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
    expect(row(<ConsultFooter amendable inputMode={true} explain="explain" />)).toBe("esc cancel · ctrl+e explain");
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
