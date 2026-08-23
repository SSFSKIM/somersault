// test/tui/popup-hover.test.tsx — F10 T-HOVER Task 2, CM33: the suggestion-popup hit region.
//
// Three layers, each proving a different slice of the spec's seven canon semantics (task-2-brief.md § H2):
//   1. PURE — `popupHitRegion`/`popupRowAt`, no mount. The geometry: rows derive FORWARD from `dockTop`
//      because the hoisted palette is the dock's own FIRST child (never `dockTop - paintedRows`, which
//      would land on transcript rows), padding-aware columns, and the not-addressable/too-narrow floors.
//      Also `setSuggestionIndex` and the `suggestionNav` arrow-clear SIGNAL, both pure `EditorState` arithmetic.
//   2. `SuggestPopup` MOUNTED DIRECTLY (ink-testing-library, no ChatApp) — five of the seven canon semantics
//      are observable here: hover-overrides-keyboard (`A ?? k`), hover-never-moves-the-cursor, click-by-
//      absolute-index, container-leave-clears, dead-without-onSelect. Plus the frame-output pin.
//   3. The REAL `ChatApp`, fullscreen, driven with raw SGR mouse bytes — the two semantics that only exist
//      once the composer and the app's mouse sink are wired together: arrows clear hover, and the setter
//      bails when unchanged (no new frame). Reuses `hover.test.tsx`'s own byte shapes and settle discipline.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import {
  popupHitRegion, popupRowAt, rowLines, scrollWindow, SuggestPopup, type PopupHitHandle, type SuggestItem,
} from "../../src/tui/suggestPopup.js";
import {
  applyKey, commandActive, initialEditorState, setCommandCatalog, type EditorState,
} from "../../src/tui/editor.js";
import { setSuggestionIndex } from "../../src/tui/completions.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import { themeTokens } from "../../src/tui/theme.js";

const item = (id: string, description?: string) => ({ id, displayText: `/${id}`, ...(description ? { description } : {}) });

// ══ Layer 1 — the pure region model ════════════════════════════════════════════════════════════════════
describe("popupHitRegion / popupRowAt — derived FORWARD from dockTop", () => {
  it("derives rows FORWARD from dockTop — the palette is the dock's first child, never above it", () => {
    const region = popupHitRegion([item("a"), item("b"), item("c")], [1, 1, 1], 12, 80);
    expect(region.top).toBe(12);
    expect(popupRowAt(region, 5, 12)).toBe(0);
    expect(popupRowAt(region, 5, 13)).toBe(1);
    expect(popupRowAt(region, 5, 14)).toBe(2);
    expect(popupRowAt(region, 5, 11)).toBeUndefined();   // the row ABOVE is the transcript's — never ours
    expect(popupRowAt(region, 5, 15)).toBeUndefined();
  });

  it("a 2-line row consumes two terminal rows and both resolve to it", () => {
    const region = popupHitRegion([item("a"), item("b"), item("c")], [1, 2, 1], 10, 80);
    expect(popupRowAt(region, 5, 10)).toBe(0);
    expect(popupRowAt(region, 5, 11)).toBe(1);
    expect(popupRowAt(region, 5, 12)).toBe(1);           // the description's own row
    expect(popupRowAt(region, 5, 13)).toBe(2);
  });

  it("columns honour the popup's own paddingX=2, inclusive, 1-based", () => {
    const region = popupHitRegion([item("a")], [1], 10, 80);
    expect(region.rows[0]).toEqual({ id: "a", colStart: 3, colEnd: 78, lines: 1 });
    expect(popupRowAt(region, 2, 10)).toBeUndefined();
    expect(popupRowAt(region, 3, 10)).toBe(0);
    expect(popupRowAt(region, 78, 10)).toBe(0);
    expect(popupRowAt(region, 79, 10)).toBeUndefined();
  });

  it("top = 0 is NOT ADDRESSABLE — every cell misses", () => {
    const region = popupHitRegion([item("a"), item("b")], [1, 1], 0, 80);
    expect(region).toEqual({ top: 0, rows: [] });
    expect(popupRowAt(region, 5, 0)).toBeUndefined();
    expect(popupRowAt(region, 5, 1)).toBeUndefined();
  });

  it("a pane too narrow for the padding publishes no rows rather than an inverted range", () => {
    const region = popupHitRegion([item("a")], [1], 10, 4);   // colStart=3, colEnd=4-2=2 → colEnd < colStart
    expect(region).toEqual({ top: 0, rows: [] });
    expect(popupRowAt(region, 1, 10)).toBeUndefined();
  });

  it("the window's rows are the SCROLLED window's, so index P is window-relative", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(String(i)));
    const lineCounts = items.map(() => 1);
    const { start, end } = scrollWindow(lineCounts, 7, 5);
    expect(start).toBeGreaterThan(0);                     // premise: the walk really scrolled
    const region = popupHitRegion(items.slice(start, end), lineCounts.slice(start, end), 10, 80);
    expect(region.rows.length).toBe(end - start);
    expect(popupRowAt(region, 5, 10)).toBe(0);            // window-relative, not the item's absolute index
  });
});

// ── `setSuggestionIndex` and the `suggestionNav` arrow-clear signal ────────────────────────────────────
const withCommand = (names: string[], index: number): EditorState => {
  const catalog: CommandEntry[] = names.map((n) => ({ name: n, description: n, source: "local" }));
  const s = initialEditorState();
  return { ...s, mention: null, command: { span: { row: 0, start: 0, end: 1 }, query: "", head: true, items: catalog, catalog, index } };
};

describe("setSuggestionIndex — the click path's first half", () => {
  it("points the open command lane's index at the given value, clamped", () => {
    const s = withCommand(["a", "b", "c"], 0);
    expect(setSuggestionIndex(s, 2).command!.index).toBe(2);
    expect(setSuggestionIndex(s, 99).command!.index).toBe(2);      // clamped to the last real row
    expect(setSuggestionIndex(s, -5).command!.index).toBe(0);
  });
  it("is a no-op when the index is already there — same object back", () => {
    const s = withCommand(["a", "b", "c"], 1);
    expect(setSuggestionIndex(s, 1)).toBe(s);
  });
  it("is a no-op with neither lane open", () => {
    const s = initialEditorState();
    expect(setSuggestionIndex(s, 3)).toBe(s);
  });
  it("targets the mention lane when that is what's open", () => {
    const base = initialEditorState();
    const s: EditorState = { ...base, command: null, mention: { span: { row: 0, start: 0, end: 1 }, query: "", quoted: false, files: [], items: [{ path: "a", score: 0 }, { path: "b", score: 0 }], index: 0 } };
    expect(setSuggestionIndex(s, 1).mention!.index).toBe(1);
  });
});

describe("EditorResult.suggestionNav — reported on the recognized popup-navigation action, not an index diff", () => {
  it.each([["upArrow"], ["downArrow"]])("%s over an open popup reports suggestionNav", (k) => {
    const s = withCommand(["a", "b", "c"], 0);
    const r = applyKey(s, "", { [k]: true } as Parameters<typeof applyKey>[2]);
    expect(r.suggestionNav).toBe(true);
  });
  it.each([["n"], ["p"]])("ctrl+%s over an open popup reports suggestionNav", (k) => {
    const s = withCommand(["a", "b", "c"], 0);
    const r = applyKey(s, k, { ctrl: true });
    expect(r.suggestionNav).toBe(true);
  });
  it("a ONE-ITEM list still reports the nav even though the index cannot move", () => {
    const s = withCommand(["only"], 0);
    const r = applyKey(s, "", { downArrow: true });
    expect(r.state.command!.index).toBe(0);        // premise: modulo wrap pins it
    expect(r.suggestionNav).toBe(true);            // …and the hover still clears
  });
  it.each([[0, "upArrow"], [2, "downArrow"]])("the bound at index %i reports the nav too (%s)", (idx, k) => {
    const s = withCommand(["a", "b", "c"], idx);
    const r = applyKey(s, "", { [k]: true } as Parameters<typeof applyKey>[2]);
    expect(r.suggestionNav).toBe(true);
  });
  it("an ordinary character over an open popup does NOT report it", () => {
    const s = withCommand(["a", "b", "c"], 0);
    const r = applyKey(s, "x", {});
    expect(r.suggestionNav).toBeUndefined();
  });
  it("an arrow with NO popup open does not report it — the history walk is not popup nav", () => {
    const s = initialEditorState();
    expect(s.command).toBeNull();
    const r = applyKey(s, "", { downArrow: true });
    expect(r.suggestionNav).toBeUndefined();
  });
});

// ══ Layer 2 — SuggestPopup mounted directly ════════════════════════════════════════════════════════════
const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const sgr = (token: string) => { const m = token.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)!; return `\x1b[38;2;${m[1]};${m[2]};${m[3]}m`; };
const SUGGESTION_SGR = sgr(themeTokens().suggestion);
const rawLineIncluding = (frame: string | undefined, needle: string): string =>
  (frame ?? "").split("\n").find((l) => plain(l).includes(needle)) ?? "";
/** Whichever row's raw ANSI carries the `suggestion` truecolor token — the same needle
 *  `suggest-popup.test.tsx` already pins as the selected-row marker — stripped to its plain `/id` text. */
const selectedRowOf = (frame: string | undefined): string | undefined => {
  const line = (frame ?? "").split("\n").find((l) => l.includes(SUGGESTION_SGR));
  if (!line) return undefined;
  const m = plain(line).match(/\/\S+/);
  return m ? m[0] : plain(line).trim();
};

describe("SuggestPopup — hit region + hover semantics (mounted directly)", () => {
  const ITEMS: SuggestItem[] = [item("alpha", "first"), item("beta", "second"), item("gamma", "third")];
  const mountPopup = (props: Record<string, unknown> = {}) => {
    const ref: React.MutableRefObject<PopupHitHandle | null> = { current: null };
    const onSelect = vi.fn();
    const onHoverChange = vi.fn();
    const r = render(
      <SuggestPopup items={ITEMS} selected={0} columns={80} rows={40} overlay noPad
        hitTop={10} onSelect={onSelect} onHoverChange={onHoverChange} {...props} hitRef={ref} />,
    );
    return { r, ref, onSelect, onHoverChange };
  };

  it("(1) renders the HOVERED row as selected while the keyboard selection sits elsewhere — canon `A ?? k`", () => {
    const { r } = mountPopup({ selected: 0, hoveredId: "beta" });
    expect(selectedRowOf(r.lastFrame())).toBe("/beta");
    expect(rawLineIncluding(r.lastFrame(), "/alpha")).toContain("\x1b[2m");   // keyboard row is dim again
  });

  it("(2) a hover on another row leaves `selected` untouched — no onSelect, no index change", () => {
    const { ref, onHoverChange, onSelect } = mountPopup();
    ref.current!.hoverAt(5, 11);
    expect(onHoverChange).toHaveBeenCalledWith("beta");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("(3) a press on window row P calls onSelect with windowStart + P, not P", () => {
    const EIGHT: SuggestItem[] = Array.from({ length: 8 }, (_, i) => item(String(i)));
    const ref: React.MutableRefObject<PopupHitHandle | null> = { current: null };
    const onSelect = vi.fn();
    render(<SuggestPopup items={EIGHT} selected={7} columns={80} rows={40} overlay noPad hitTop={10} onSelect={onSelect} hitRef={ref} />);
    const region = ref.current!.region();
    expect(region.top).toBe(10);
    const startOfWindow = 8 - region.rows.length;
    expect(startOfWindow).toBeGreaterThan(0);            // premise: the window really scrolled
    const ok = ref.current!.pressAt(5, region.top);       // the FIRST painted row
    expect(ok).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(startOfWindow + 0);
  });

  it("(4) a motion outside the region clears the hover — container-leave", () => {
    const { ref, onHoverChange } = mountPopup();
    ref.current!.hoverAt(5, 11);
    onHoverChange.mockClear();
    ref.current!.hoverAt(5, 99);
    expect(onHoverChange).toHaveBeenCalledWith(null);
  });

  it("(5a) publishes an empty region and answers nothing when the consumer supplied no onSelect", () => {
    const { ref, onHoverChange } = mountPopup({ onSelect: undefined });
    expect(ref.current!.region()).toEqual({ top: 0, rows: [] });
    expect(ref.current!.pressAt(5, 10)).toBe(false);
    ref.current!.hoverAt(5, 10);
    expect(onHoverChange).not.toHaveBeenCalled();
  });
  it("(5b) the inline (classic) popup is dead too — no hitTop means no region", () => {
    const { ref } = mountPopup({ hitTop: 0 });
    expect(ref.current!.region()).toEqual({ top: 0, rows: [] });
  });

  it("(6) a stale hoveredId falls back to the keyboard selection rather than highlighting nothing", () => {
    const { r } = mountPopup({ selected: 1, hoveredId: "not-a-real-id" });
    expect(selectedRowOf(r.lastFrame())).toBe("/beta");   // items[1], the keyboard pick
  });

  it("(7) region.rows[i] names the terminal row the frame actually painted item i on — 1- and 2-line rows", () => {
    const ALL_ONE: SuggestItem[] = [item("alpha"), item("beta"), item("gamma")];
    const { r: r1, ref: ref1 } = mountPopup({ items: ALL_ONE, hitTop: 10, selected: 0, hoveredId: null });
    const region1 = ref1.current!.region();
    const frame1 = plain(r1.lastFrame() ?? "").split("\n");
    let y = region1.top;
    for (const row of region1.rows) {
      expect(frame1[y]).toContain(`/${row.id}`);
      y += row.lines;
    }

    // A description long enough to force `rowLines` to 2, at columns=80/nameCol from `alpha`/`beta`/`gamma`.
    const LONG_DESC = "x".repeat(80);
    const TWO_LINE: SuggestItem[] = [item("alpha"), item("beta", LONG_DESC), item("gamma")];
    expect(rowLines(TWO_LINE[1]!, 80, 12)).toBe(2);        // premise
    const { r: r2, ref: ref2 } = mountPopup({ items: TWO_LINE, hitTop: 10, selected: 0, hoveredId: null });
    const region2 = ref2.current!.region();
    const frame2 = plain(r2.lastFrame() ?? "").split("\n");
    let y2 = region2.top;
    for (const row of region2.rows) {
      expect(frame2[y2]).toContain(`/${row.id}`);
      y2 += row.lines;
    }
  });
});
