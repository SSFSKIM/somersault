// tui/test/consult-footer.test.tsx — the shared consult footer (Wave T task 4), transcribed from 2.1.220's
// L505286: a dim `·`-joined hint row. The two claims that matter are the two conditionals — the amend hint
// disappears once the focused feedback row is ALREADY in input mode (`aZf`, L505186), and the explain hint's
// verb flips between `explain` and `hide` (L505286). `esc cancel` is unconditional and is ccx's spelling of
// upstream's `escape / cancel` (the wave does not re-spell it).
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ConsultFooter } from "../../src/tui/dialogs/ConsultFooter.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const row = (ui: React.ReactElement) => plain(render(ui).lastFrame() ?? "").trim();

describe("<ConsultFooter> (L505286)", () => {
  it("advertises amend while a pick-one row is focused", () => {
    expect(row(<ConsultFooter inputMode={false} />)).toBe("esc cancel · tab amend");
  });

  it("drops the amend hint once the feedback row IS the input (aZf L505186) — you are already typing", () => {
    expect(row(<ConsultFooter inputMode={true} />)).toBe("esc cancel");
  });

  it("appends the explain hint when the dialog supports it, and flips its verb to hide", () => {
    expect(row(<ConsultFooter inputMode={false} explain="explain" />)).toBe("esc cancel · tab amend · ctrl+e explain");
    expect(row(<ConsultFooter inputMode={false} explain="hide" />)).toBe("esc cancel · tab amend · ctrl+e hide");
  });

  it("keeps explain reachable from inside input mode (only the amend hint is mode-gated)", () => {
    expect(row(<ConsultFooter inputMode={true} explain="explain" />)).toBe("esc cancel · ctrl+e explain");
  });

  it("defaults to the pick-one row's footer and renders dim", () => {
    const f = render(<ConsultFooter />).lastFrame() ?? "";
    expect(plain(f).trim()).toBe("esc cancel · tab amend");
    expect(f).toContain("\x1b[2m");                            // dimColor
  });
});
