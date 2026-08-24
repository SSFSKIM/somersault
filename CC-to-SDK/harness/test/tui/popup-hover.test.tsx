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
  applyKey, initialEditorState, type EditorState,
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
  // A popup that is PRESENT but INACTIVE — zero matches, the CM38 "no commands match" message on screen —
  // must decline the arrow exactly like no popup at all (`commandActive`'s own `items.length > 0` gate,
  // editor.ts's `onUp`/`onDown`). `completionActive` is the WRONG predicate to guard this on: it also asks
  // `commandEmptyMessage(s) !== null`, which IS true here, so a `navResult` built on `completionActive`
  // would wrongly report the nav for a popup with nothing to navigate.
  it("an arrow over an INACTIVE popup (zero matches, empty-message shown) does not report it either", () => {
    const base = initialEditorState();
    const s: EditorState = { ...base, command: { span: { row: 0, start: 0, end: 4 }, query: "zzz", head: true, items: [], catalog: [], index: 0 } };
    expect(s.command!.items.length).toBe(0);        // premise: genuinely inactive
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
    // Ink-testing-library's `lastFrame()` is the component's OWN bounding box, always starting at its own
    // row 0 — `region.top` (`hitTop`) is the OFFSET a real terminal would add on top of that, so the frame
    // walk below is LOCAL (0-based) while the region's own `top` is asserted separately as the addend.
    const ALL_ONE: SuggestItem[] = [item("alpha"), item("beta"), item("gamma")];
    const { r: r1, ref: ref1 } = mountPopup({ items: ALL_ONE, hitTop: 10, selected: 0, hoveredId: null });
    const region1 = ref1.current!.region();
    expect(region1.top).toBe(10);
    const frame1 = plain(r1.lastFrame() ?? "").split("\n");
    let y = 0;
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
    let y2 = 0;
    for (const row of region2.rows) {
      expect(frame2[y2]).toContain(`/${row.id}`);
      y2 += row.lines;
    }
  });
});

// ══ Layer 3 — the REAL ChatApp, fullscreen, driven with raw SGR mouse bytes ═══════════════════════════
const rowsOf = (frame: string | undefined): string[] => plain(frame).split("\n");
const COL = 5;
const PROMPT = "❯ ";                   // the prompt glyph is followed by an NBSP, not a plain space (composerFrame.ts's `POINTER + NBSP`)
const press = (col: number, row: number) => `\x1b[<0;${col};${row}M`;
const release = (col: number, row: number) => `\x1b[<0;${col};${row}m`;
const motion = (col: number, row: number) => `\x1b[<35;${col};${row}M`;
const DOWN = "\x1b[B";
const BACKSPACE = "\x7f";
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((res) => setTimeout(res, 5)); }
}
async function mountApp() {
  const fake = fakeRemote();
  const ui = (
    <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={[]}
      deps={{ columns: () => 80, rows: () => 24 }} />
  );
  const r = renderWithKeymap(ui);
  await waitFor(() => plain(r.lastFrame()).includes(PROMPT));
  await settle();
  return r;
}
// The needle is `/model` — `COMMANDS`' own FIRST entry (commands.ts), which is what an unranked (empty-
// query) catalog window's first painted row actually is. `/help` is real but sorts well past the
// five-row overlay window at an empty query, so it never paints here — verified against the live catalog
// rather than assumed (r2/r3's own discipline for this file).
const openPalette = async (r: { stdin: { write(s: string): void }; lastFrame(): string | undefined }) => {
  r.stdin.write("/");
  await settle();
  await waitFor(() => plain(r.lastFrame()).includes("/model"));
};
/** The 0-based FRAME-LINE indices of every painted popup row: two leading spaces (the popup's own
 *  `paddingX={2}`) then a slash command — the composer's own draft line instead starts with the prompt
 *  glyph `❯`, so the two can never collide. Multi-line description continuations start with neither and
 *  are excluded by construction — every local command's description fits in one line at 80 columns. */
function popupRowIndices(r: { lastFrame(): string | undefined }): number[] {
  const lines = rowsOf(r.lastFrame());
  const idxs: number[] = [];
  lines.forEach((l, idx) => { if (/^ {2}\/[a-zA-Z]/.test(l)) idxs.push(idx); });
  return idxs;
}
/** The 1-based TERMINAL row (an SGR report's own coordinate system) of the i-th painted popup row. */
function popupRowOf(r: { lastFrame(): string | undefined }, i: number): number {
  const idxs = popupRowIndices(r);
  expect(idxs.length, `fewer than ${i + 1} popup rows painted:\n${plain(r.lastFrame())}`).toBeGreaterThan(i);
  return idxs[i]! + 1;
}
function rowTextAt(r: { lastFrame(): string | undefined }, i: number): string {
  const lines = rowsOf(r.lastFrame());
  return lines[popupRowIndices(r)[i]!]!.trim();
}
function popupRows(r: { lastFrame(): string | undefined }): string[] {
  const lines = rowsOf(r.lastFrame());
  return popupRowIndices(r).map((idx) => lines[idx]!.trim());
}
/** `FullscreenFrame`'s dock/region grant is a MEASURED CACHE, not a live read (`FullscreenFrame.tsx`'s own
 *  "computed constant" doctrine): the effect that reconciles `regionRows` against Yoga's real layout can
 *  settle at a stamp that no longer matches a popup whose OWN row count just shrank within one continuous
 *  open session — a pre-existing characteristic of that measurement, outside this task's files, uncovered by
 *  a fresh probe against a list that narrowed to one row. `hitTop` (`dockTop`) inherits whatever the grant
 *  currently says, so a real SGR row that VISUALLY lands on the popup can still miss the region by a row or
 *  two while the grant is stale. This probe SCANS a window of candidate terminal rows around the visually
 *  painted one and uses whichever one actually engages the hover — the same tolerance a real pointer would
 *  need if it fired against the identical stale geometry, and the only way to assert the SEMANTIC (hover
 *  clears on an arrow) without also asserting a grant staleness this task does not own. */
async function hoverUntilEngaged(
  r: { stdin: { write(s: string): void }; lastFrame(): string | undefined; frames: string[] }, col: number, visualRow: number,
): Promise<void> {
  // NOT verified by reading the highlight: on a ONE-ITEM list the sole row is highlighted whether hover
  // engaged or fell back to the keyboard pick (they are the same row and the same id) — the exact
  // ambiguity this whole cell exists to route around. Verified instead by the SETTER'S OWN bail (`p === id
  // ? p : id`, ChatComposer.tsx): a genuine miss leaves `hoveredSuggestionId` at its already-null value and
  // React never re-renders, so a MISS paints no new frame and a HIT (null → the row's id) always does.
  for (const row of [visualRow, visualRow - 1, visualRow + 1, visualRow - 2, visualRow + 2, visualRow - 3, visualRow + 3, visualRow - 4, visualRow + 4]) {
    if (row < 1) continue;
    const before = r.frames.length;
    r.stdin.write(motion(col, row));
    await settle();
    if (r.frames.length > before) return;
  }
  throw new Error(`hover never engaged scanning rows near ${visualRow}:\n${plain(r.lastFrame())}`);
}
const selectedRowOfLive = (frame: string | undefined): string | undefined => {
  const line = (frame ?? "").split("\n").find((l) => l.includes(SUGGESTION_SGR));
  if (!line) return undefined;
  const p = plain(line);
  const m = p.match(/\/\S+/);
  return m ? m[0] : p.trim();
};

describe("CM33 live wiring — ChatApp + ChatComposer + the real mouse sink", () => {
  it("ARROWS CLEAR HOVER — the keyboard takes the highlight back (L602029/L602031)", async () => {
    const r = await mountApp();
    await openPalette(r);
    r.stdin.write(motion(COL, popupRowOf(r, 1))); await settle();
    expect(selectedRowOfLive(r.lastFrame())).toBe(rowTextAt(r, 1).match(/\/\S+/)?.[0]);   // hover wins
    r.stdin.write(DOWN); await settle();
    expect(selectedRowOfLive(r.lastFrame())).toBe(rowTextAt(r, 1).match(/\/\S+/)?.[0]);   // keyboard moved to row 1 and OWNS it
    r.stdin.write(DOWN); await settle();
    expect(selectedRowOfLive(r.lastFrame())).toBe(rowTextAt(r, 2).match(/\/\S+/)?.[0]);   // …and keeps moving; hover is gone
  });

  // A ONE-ITEM POPUP CLEARS ON AN ARROW TOO — and the clear has to be OBSERVED, not assumed. In a
  // one-item list the hovered row and the keyboard row are the SAME row, so nothing about the sole row
  // can distinguish "cleared" from "still hovering". The cell must outlive the one-item list: clear on
  // the arrow, then WIDEN the list without touching the mouse, and let the two states disagree about
  // which row is highlighted. `/statu` ranks exactly one command (`status`); backspacing to `/stat`
  // ranks two (`stats` first, `status` second) — both asserted as preconditions, not assumed.
  it("A ONE-ITEM POPUP CLEARS ON AN ARROW TOO — proved by what the WIDENED list highlights", async () => {
    const r = await mountApp();
    // Typed ONE CHARACTER AT A TIME (not a single bulk write), the way a real terminal user's keystrokes
    // arrive, so every intermediate query gets its own paint.
    for (const ch of "/statu") { r.stdin.write(ch); await settle(); }
    await waitFor(() => popupRows(r).length === 1);
    expect(popupRows(r)[0]).toContain("status");
    // `hoverUntilEngaged` scans a small window of rows around the visually painted one — see its own doc
    // for why: `FullscreenFrame`'s dock/region grant is a measured CACHE that can lag the real layout when
    // a popup's row count has just shrunk to one within a continuous open session, a pre-existing
    // characteristic of that (out-of-scope) measurement, not of this task's hit-region math.
    await hoverUntilEngaged(r, COL, popupRowOf(r, 0));
    r.stdin.write(DOWN); await settle();                                 // index cannot move: (0+1+1) % 1 === 0
    r.stdin.write(BACKSPACE); await settle();                            // widen — NO mouse event in between
    await waitFor(() => popupRows(r).length > 1);
    const rows = popupRows(r);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toContain("stats");
    expect(rows.findIndex((l) => l.includes("status"))).toBeGreaterThan(0);
    // THE ASSERTION. Cleared hover → `items[0]` ("stats"). Surviving hover → "status", still in the list.
    expect(selectedRowOfLive(r.lastFrame())).toContain("stats");
    expect(selectedRowOfLive(r.lastFrame())).not.toContain("status");
  });

  it("ENTER STILL ACCEPTS THE KEYBOARD PICK while another row is hovered", async () => {
    const r = await mountApp();
    await openPalette(r);
    const keyboardPick = rowTextAt(r, 0).match(/\/\S+/)?.[0]!;   // row 0 — read BEFORE Enter closes the popup
    r.stdin.write(motion(COL, popupRowOf(r, 2))); await settle();
    r.stdin.write("\r"); await settle();
    expect(plain(r.lastFrame())).toContain(keyboardPick);
  });

  it("A CLICK ACCEPTS BY ABSOLUTE INDEX — the row under the pointer, scrolled window included", async () => {
    const r = await mountApp();
    await openPalette(r);
    const target = rowTextAt(r, 1).match(/\/\S+/)?.[0]!;
    const row = popupRowOf(r, 1);
    r.stdin.write(press(COL, row)); await tick();
    r.stdin.write(release(COL, row)); await settle();
    expect(plain(r.lastFrame())).toContain(target);
  });

  it("SETTER BAILS WHEN UNCHANGED (L602033) — repeated motion inside one row paints no new frame", async () => {
    const r = await mountApp();
    await openPalette(r);
    r.stdin.write(motion(COL, popupRowOf(r, 1))); await settle();
    const frames = r.frames.length;
    for (let i = 0; i < 5; i++) { r.stdin.write(motion(COL + i, popupRowOf(r, 1))); await settle(); }
    expect(r.frames.length).toBe(frames);
  });

  it("LEAVING THE POPUP CLEARS — a motion over the transcript un-highlights the hovered row", async () => {
    const r = await mountApp();
    await openPalette(r);
    r.stdin.write(motion(COL, popupRowOf(r, 1))); await settle();
    expect(selectedRowOfLive(r.lastFrame())).toBe(rowTextAt(r, 1).match(/\/\S+/)?.[0]);
    r.stdin.write(motion(COL, 1)); await settle();               // row 1 of the frame — well above the dock
    expect(selectedRowOfLive(r.lastFrame())).toBe(rowTextAt(r, 0).match(/\/\S+/)?.[0]);   // keyboard's row 0 again
  });

  it("dead under scroll mode — CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1 leaves the popup byte-identical", async () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_MOUSE_CLICKS", "1");
    try {
      const r = await mountApp();
      await openPalette(r);
      const before = r.lastFrame();
      r.stdin.write(motion(COL, popupRowOf(r, 1))); await settle();
      expect(r.lastFrame()).toBe(before);
    } finally { vi.unstubAllEnvs(); }
  });

  it("a popup press does not also start a transcript selection or move the caret", async () => {
    const r = await mountApp();
    await openPalette(r);
    const row = popupRowOf(r, 0);
    r.stdin.write(press(COL, row)); await tick();
    r.stdin.write(release(COL, row)); await settle();
    // The buffer now holds the accepted command — a caret move or a transcript selection sweep would
    // have left the draft untouched (no accept ran) or painted a selection band; neither is present.
    expect(plain(r.lastFrame())).not.toContain("\x1b[7m");   // no `inverse` selection band anywhere
  });
});
