// F2 task 7: `pagerAction(input, key)` is gone. Which KEY scrolls the pager is the binding table's business
// now (keys/bindings.ts, the `Transcript` context); pager.ts keeps only what an ACTION means, as PAGER_ACTIONS.
// So the invariant worth pinning flipped: every scroll action the Transcript context binds must have an entry
// here, and nothing may be listed that the table never names — a one-sided map is how a live key goes dead.
import { describe, it, expect } from "vitest";
import { PAGER_ACTIONS, applyPager, clampOffset } from "../../src/tui/pager.js";
import { DEFAULT_BINDINGS } from "../../src/tui/keys/bindings.js";

const transcript = DEFAULT_BINDINGS.find((b) => b.context === "Transcript")!;
const boundScrolls = new Set(Object.values(transcript.bindings).filter((a): a is string => !!a && a.startsWith("scroll:")));

describe("PAGER_ACTIONS — the bundle Transcript context, action for action", () => {
  it("covers exactly the scroll actions the Transcript context binds", () =>
    expect(Object.keys(PAGER_ACTIONS).sort()).toEqual([...boundScrolls].sort()));
  it.each([
    ["scroll:halfPageUp", { kind: "pages", n: -0.5 }], ["scroll:halfPageDown", { kind: "pages", n: 0.5 }],
    ["scroll:fullPageUp", { kind: "pages", n: -1 }], ["scroll:fullPageDown", { kind: "pages", n: 1 }],
    ["scroll:pageUp", { kind: "pages", n: -1 }], ["scroll:pageDown", { kind: "pages", n: 1 }],
    ["scroll:lineUp", { kind: "lines", n: -1 }], ["scroll:lineDown", { kind: "lines", n: 1 }],
    ["scroll:top", { kind: "top" }], ["scroll:bottom", { kind: "bottom" }],
  ] as const)("preserves %s", (action, expected) => expect(PAGER_ACTIONS[action]).toEqual(expected));
  it("g/G and home/end are the same two operations, reached by four keys", () => {
    expect(transcript.bindings["g"]).toBe("scroll:top"); expect(transcript.bindings["home"]).toBe("scroll:top");
    expect(transcript.bindings["shift+g"]).toBe("scroll:bottom"); expect(transcript.bindings["end"]).toBe("scroll:bottom");
  });
});

describe("applyPager / clampOffset", () => {
  it("clamps to [0, total-height]", () => {
    expect(clampOffset(-3, 100, 10)).toBe(0);
    expect(clampOffset(999, 100, 10)).toBe(90);
    expect(clampOffset(5, 8, 10)).toBe(0);                 // content shorter than the window
  });
  it("half page rounds against height", () => {
    expect(applyPager(50, { kind: "pages", n: -0.5 }, 100, 10)).toBe(45);
    expect(applyPager(50, { kind: "pages", n: 0.5 }, 100, 11)).toBe(56);   // round(5.5)=6
  });
  it("top/bottom/lines/pages", () => {
    expect(applyPager(50, { kind: "top" }, 100, 10)).toBe(0);
    expect(applyPager(0, { kind: "bottom" }, 100, 10)).toBe(90);
    expect(applyPager(0, { kind: "lines", n: -1 }, 100, 10)).toBe(0);
    expect(applyPager(89, { kind: "pages", n: 1 }, 100, 10)).toBe(90);
  });
  it("leaves applyPager's existing line and fractional/full page semantics intact", () => {
    expect(applyPager(10, { kind: "lines", n: -1 }, 100, 20)).toBe(9); expect(applyPager(10, { kind: "pages", n: -0.5 }, 100, 20)).toBe(0); expect(applyPager(10, { kind: "pages", n: 1 }, 100, 20)).toBe(30);
  });
});
