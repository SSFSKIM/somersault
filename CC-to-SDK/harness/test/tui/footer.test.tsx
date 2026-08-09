// test/tui/footer.test.tsx — Wave C Task 2 (EP-C1b): the one-row footer that replaced `ChatStatusBar`.
// Three subjects, in the order the modules stack: `modeTable.ts` (upstream's six-mode table, annex §C4.c),
// `footerModel.ts` (the pure hint-list / crowd-out / agents logic, annex §C1.3-§C1.5) and `<Footer>` itself
// (the composed row, annex §C1.1-§C1.2).
//
// House idioms this file follows rather than inventing: `renderWithKeymap` for anything that reads the
// binding table (a bare render has no `<KeymapProvider>` and every chord would resolve to the defaults by
// a different path), `lastFrame()` + a local `plain()` ANSI strip, and no fake timers — the 2500 ms agents
// flash is a PURE function of an injected `now`, so time is a number here and never a scheduler.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { Footer } from "../../src/tui/Footer.js";
import { MODE_TABLE, modeIndicator, modeSymbol, modeColor, modeTitle } from "../../src/tui/modeTable.js";
import { agentsAffordance, buildHintList, hintText, suppressHint, AGENTS_FLASH_MS } from "../../src/tui/footerModel.js";
import { defaultLookup } from "../../src/tui/keys/hints.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const tok = (name: "inactive" | "planMode" | "autoAccept" | "warning" | "error") => resolveThemeColor(themeTokens()[name]);
/** Every prop the component needs, at the HOME STATE — each test overrides the one field it is about. */
const home = {
  mode: "default", busy: false, draftNonEmpty: false, isInputEmpty: true, searching: false,
  statusLineConfigured: false, pasting: false, pasteExpandHint: false, bashMode: false,
  agents: { count: 0 }, bindings: defaultLookup, composerOwnsKeys: true,
} as const;
const frameOf = (props: Partial<React.ComponentProps<typeof Footer>> = {}): string =>
  plain(render(<Footer {...home} {...props} />).lastFrame());

describe("modeTable (annex §C4.c)", () => {
  it("carries upstream's six modes verbatim", () => {
    expect(Object.keys(MODE_TABLE)).toEqual(["default", "plan", "acceptEdits", "bypassPermissions", "dontAsk", "auto"]);
    expect(MODE_TABLE.default).toMatchObject({ title: "Manual", shortTitle: "Manual", indicator: "manual mode", symbol: "⏸", color: "inactive" });
    expect(MODE_TABLE.plan).toMatchObject({ title: "Plan", shortTitle: "Plan", indicator: "plan mode", symbol: "⏸", color: "planMode" });
    expect(MODE_TABLE.acceptEdits).toMatchObject({ title: "Accept edits", shortTitle: "Accept", indicator: "accept edits", symbol: "⏵⏵", color: "autoAccept" });
    expect(MODE_TABLE.bypassPermissions).toMatchObject({ title: "Bypass Permissions", shortTitle: "Bypass", indicator: "bypass permissions", symbol: "⏵⏵", color: "error" });
    expect(MODE_TABLE.dontAsk).toMatchObject({ title: "Don't Ask", shortTitle: "DontAsk", indicator: "don't ask", symbol: "⏵⏵", color: "error" });
    expect(MODE_TABLE.auto).toMatchObject({ title: "Auto", shortTitle: "Auto", indicator: "auto mode", symbol: "⏵⏵", color: "warning" });
  });
  it("falls back to `default` for an unknown mode (`n4r`, L41497)", () => {
    expect(modeIndicator("no-such-mode")).toBe("manual mode");
    expect(modeSymbol("no-such-mode")).toBe("⏸");
    expect(modeTitle("no-such-mode")).toBe("Manual");
    expect(modeColor("no-such-mode")).toBe(tok("inactive"));
  });
  it("resolves each mode's colour to its live theme token", () => {
    expect(modeColor("default")).toBe(tok("inactive"));
    expect(modeColor("plan")).toBe(tok("planMode"));
    expect(modeColor("acceptEdits")).toBe(tok("autoAccept"));
    expect(modeColor("auto")).toBe(tok("warning"));
    expect(modeColor("bypassPermissions")).toBe(tok("error"));
    expect(modeColor("dontAsk")).toBe(tok("error"));
  });
});

describe("footerModel.suppressHint (annex §C1.5)", () => {
  it("is upstream's `zqf = (draft non-empty) || isSearching || statusLineConfigured`", () => {
    expect(suppressHint({ draftNonEmpty: false, searching: false, statusLineConfigured: false })).toBe(false);
    expect(suppressHint({ draftNonEmpty: true, searching: false, statusLineConfigured: false })).toBe(true);
    expect(suppressHint({ draftNonEmpty: false, searching: true, statusLineConfigured: false })).toBe(true);
    expect(suppressHint({ draftNonEmpty: false, searching: false, statusLineConfigured: true })).toBe(true);
  });
});

describe("footerModel.agentsAffordance (annex §C1.4)", () => {
  const at = (o: Parameters<typeof agentsAffordance>[0], now = 0) => agentsAffordance(o, now)!;
  it("renders nothing with no background agents and no flash", () => {
    expect(at({ count: 0 })).toBeNull();
  });
  it("is the dim `← for agents` while agents exist and neither flash is live", () => {
    expect(hintText(at({ count: 3 }))).toBe("← for agents");
  });
  it("flashes `← N agents` while awaiting, pluralised, and expires after 2500 ms", () => {
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 } }, 0))).toBe("← 2 agents");
    expect(hintText(at({ count: 1, awaiting: { count: 1, since: 0 } }, 0))).toBe("← 1 agent");
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 } }, AGENTS_FLASH_MS - 1))).toBe("← 2 agents");
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 } }, AGENTS_FLASH_MS))).toBe("← for agents");
  });
  it("flashes `← N done`, and a done flash outranks a stale awaiting one", () => {
    expect(hintText(at({ count: 0, done: { count: 2, since: 100 } }, 200))).toBe("← 2 done");
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 }, done: { count: 1, since: 0 } }, 10))).toBe("← 1 done");
    expect(at({ count: 0, done: { count: 2, since: 100 } }, 100 + AGENTS_FLASH_MS)).toBeNull();   // flash over, no agents left
  });
  it("clamps a count over 99 to `99+`", () => {
    expect(hintText(at({ count: 120, awaiting: { count: 120, since: 0 } }, 0))).toBe("← 99+ agents");
  });
});

describe("footerModel.buildHintList (annex §C1.3)", () => {
  const base = { showHint: true, isInputEmpty: true, mode: "default", busy: false, interruptChord: "esc", agents: { count: 0 }, now: 0 };
  const keys = (o: Partial<typeof base>) => buildHintList({ ...base, ...o }).map((h) => h.key);
  it("home state is `? for shortcuts` alone", () => {
    expect(buildHintList(base).map(hintText)).toEqual(["? for shortcuts"]);
  });
  it("crowds `? for shortcuts` out the moment another hint exists (`G2.length === 0`)", () => {
    expect(buildHintList({ ...base, busy: true }).map(hintText)).toEqual(["esc to interrupt"]);
  });
  it("crowds `? for shortcuts` out on a NON-DEFAULT mode (`!(ttl && HRn)`)", () => {
    expect(keys({ mode: "plan" })).toEqual([]);
    expect(keys({ mode: "acceptEdits" })).toEqual([]);
  });
  it("keeps `← for agents` alongside `? for shortcuts` — the canonical home footer (§C4.c)", () => {
    expect(buildHintList({ ...base, agents: { count: 1 } }).map(hintText)).toEqual(["? for shortcuts", "← for agents"]);
  });
  it("kills every hint when showHint is false, and the agents affordance when the input is non-empty", () => {
    expect(keys({ showHint: false, agents: { count: 1 } })).toEqual(["fg-agents"]);
    expect(keys({ showHint: false, isInputEmpty: false, agents: { count: 1 } })).toEqual([]);
  });
});

describe("<Footer> — the composed row (annex §C1.1-§C1.2)", () => {
  it("home state: `⏸ manual mode on · ? for shortcuts`, with no cycle parenthetical", () => {
    const f = frameOf();
    expect(f).toContain("⏸ manual mode on");
    expect(f).toContain("? for shortcuts");
    expect(f).not.toContain("shift+tab to cycle");
  });
  it("adds the agents affordance when background agents exist", () => {
    expect(frameOf({ agents: { count: 2 } })).toContain("← for agents");
  });
  it("a non-default mode adds `(shift+tab to cycle)` and drops `? for shortcuts`", () => {
    const f = frameOf({ mode: "plan" });
    expect(f).toContain("⏸ plan mode on (shift+tab to cycle)");
    expect(f).not.toContain("? for shortcuts");
  });
  // WAVE C TASK 7 widened this from four modes to SIX and added the colour half below. Task 2 pinned the
  // table's colour TOKENS and the chip's TEXT, but never that the rendered chip actually wears its mode's
  // token — the frame those tests read is ANSI-stripped, so `<Text color={modeColor(mode)}>` could have been
  // `<Text>` and the whole suite would have stayed green.
  it("renders all SIX mode chips verbatim (annex §C4.c)", () => {
    expect(frameOf({ mode: "default" })).toContain("⏸ manual mode on");
    expect(frameOf({ mode: "plan" })).toContain("⏸ plan mode on");
    expect(frameOf({ mode: "acceptEdits" })).toContain("⏵⏵ accept edits on");
    expect(frameOf({ mode: "auto" })).toContain("⏵⏵ auto mode on");
    expect(frameOf({ mode: "bypassPermissions" })).toContain("⏵⏵ bypass permissions on");
    expect(frameOf({ mode: "dontAsk" })).toContain("⏵⏵ don't ask on");
  });
  it("paints all SIX chips in their own `$O` token — grey/plan/accept/warning/error/error", () => {
    // The token is `rgb(r,g,b)` and Ink paints it as a truecolor SGR (bg-dialog.test.tsx's `sgr` idiom); the
    // chip is the first thing on its row, so the row's opening escape IS the chip's colour.
    const sgr = (name: Parameters<typeof tok>[0]) => {
      const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(themeTokens()[name]);
      return `\x1b[38;2;${m![1]};${m![2]};${m![3]}m`;
    };
    const rawChipRow = (mode: string, needle: string) =>
      (render(<Footer {...home} mode={mode} />).lastFrame() ?? "").split("\n").find((l) => plain(l).includes(needle)) ?? "";
    expect(rawChipRow("default", "manual mode on")).toContain(`${sgr("inactive")}⏸`);
    expect(rawChipRow("plan", "plan mode on")).toContain(`${sgr("planMode")}⏸`);
    expect(rawChipRow("acceptEdits", "accept edits on")).toContain(`${sgr("autoAccept")}⏵⏵`);
    expect(rawChipRow("auto", "auto mode on")).toContain(`${sgr("warning")}⏵⏵`);
    expect(rawChipRow("bypassPermissions", "bypass permissions on")).toContain(`${sgr("error")}⏵⏵`);
    expect(rawChipRow("dontAsk", "don't ask on")).toContain(`${sgr("error")}⏵⏵`);
  });
  it("collapses to the mode chip ALONE while a draft is live (§C1.5)", () => {
    const f = frameOf({ draftNonEmpty: true, isInputEmpty: false, agents: { count: 2 } });
    expect(f).toContain("⏸ manual mode on");
    expect(f).not.toContain("? for shortcuts");
    expect(f).not.toContain("← for agents");
  });
  it("suppresses the hint list while searching and while a statusLine is configured", () => {
    expect(frameOf({ searching: true })).not.toContain("? for shortcuts");
    expect(frameOf({ statusLineConfigured: true })).not.toContain("? for shortcuts");
  });
  it("advertises no Chat chord while a dialog owns the keyboard, but keeps the chip", () => {
    const f = frameOf({ mode: "plan", composerOwnsKeys: false });
    expect(f).toContain("⏸ plan mode on");
    expect(f).not.toContain("shift+tab to cycle");
    expect(plain(render(<Footer {...home} composerOwnsKeys={false} />).lastFrame())).not.toContain("? for shortcuts");
  });

  it("the exit arm REPLACES the whole row, with the key coming in as a prop", () => {
    const f = frameOf({ exitArm: { key: "Ctrl-C", verb: "exit" } });
    expect(f).toContain("Press Ctrl-C again to exit");
    expect(f).not.toContain("manual mode on");
    expect(frameOf({ exitArm: { key: "Ctrl-D", verb: "exit" } })).toContain("Press Ctrl-D again to exit");
  });
  it("`Pasting…` replaces the whole row", () => {
    const f = frameOf({ pasting: true });
    expect(f).toContain("Pasting…");
    expect(f).not.toContain("manual mode on");
  });
  it("`paste again to expand` replaces the row — but never while searching (L493772)", () => {
    expect(frameOf({ pasteExpandHint: true })).toContain("paste again to expand");
    expect(frameOf({ pasteExpandHint: true, searching: true })).not.toContain("paste again to expand");
  });
  it("bash mode replaces the chip with `! for shell mode`", () => {
    const f = frameOf({ bashMode: true });
    expect(f).toContain("! for shell mode");
    expect(f).not.toContain("manual mode on");
  });

  it("draws the statusLine text on its own row ABOVE the footer row", () => {
    const lines = plain(render(<Footer {...home} statusLineConfigured statusLineText="~/repo (main)" />).lastFrame()).split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]).toContain("~/repo (main)");
    expect(lines[1]).toContain("manual mode on");
  });
  it("hides the statusLine row while the exit arm or a paste is up (L494626)", () => {
    expect(frameOf({ statusLineConfigured: true, statusLineText: "SL", exitArm: { key: "Ctrl-C", verb: "exit" } })).not.toContain("SL");
    expect(frameOf({ statusLineConfigured: true, statusLineText: "SL", pasting: true })).not.toContain("SL");
  });
  it("renders no statusLine row when nothing supplies the text", () => {
    expect(plain(render(<Footer {...home} statusLineConfigured />).lastFrame()).split("\n").filter((l) => l.trim() !== "")).toHaveLength(1);
  });
});
