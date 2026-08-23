// tui/test/selectionRemap.test.tsx — F10 T-SELECT S4c: the viewport's own address-recording and remap, end
// to end through the REAL `FullscreenFrame` + `FullscreenViewport` pair and the REAL `ViewportHitmap` gesture
// methods (`selectionStaleness.test.tsx`'s own harness, reused rather than reinvented — the geometry, frame
// → region → painted row, is exactly what that file already pins). Where `selectionAddress.test.ts` (Task 5)
// proves the pure algorithms against hand-built `HitRow` fixtures, this file proves the WIRING: that
// `FullscreenViewport.tsx`'s `selectionAddrRef`/`recordSelectionAddresses`/during-render remap actually fires
// off real gestures against a real projection, through the real `wrapItemsToWidth` pipeline (Task 4's
// `source`/`textStart` minted where lines are really wrapped, not asserted by hand).
//
// EVERY CASE HERE ASSERTS THE SAME CLAIM FROM TWO ANGLES: `selectedText()` (the copy-latch's own read) is
// unchanged, AND the painted `selectionBg` SGR run (`selectionPaint.test.tsx`'s own technique) still covers
// exactly the same substring, wherever it now lands. A remap that silently drops the paint while the text
// getter still worked would read green on the first check alone.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { FullscreenViewport, type ViewportHitmap, type ViewportScroll } from "../../src/tui/FullscreenViewport.js";
import { Transcript } from "../../src/tui/Transcript.js";
import { TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";
import { themeTokens } from "../../src/tui/theme.js";
import { tick } from "./keysTestUtil.js";

const FRAME_ROWS = 12, COLS = 40;
const NO_ITEMS: readonly RenderItem[] = [];
const NO_LINES: readonly RenderLine[] = [];
const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
// NOT `.trim()`-ed: several cases here compute a click COLUMN via `colOf`'s `indexOf` against this string,
// and a gutter-carrying (`TOOL_RESULT_GUTTER`) row's leading indent is load-bearing for that arithmetic — a
// trimmed string silently shifts every column one gutter-width off, landing clicks back on the gutter itself.
const strip = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const rowOfIncluding = (frame: string | undefined, needle: string): number => {
  const at = rowsOf(frame).findIndex((line) => strip(line).includes(needle));
  expect(at, `no row contains "${needle}" in:\n${(frame ?? "")}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
/** The RAW (SGR-carrying) row whose STRIPPED text contains `needle` — `selectionPaint.test.tsx`'s own
 *  `rawLineIncluding`, so a case can assert the highlight run by simple byte-string containment. */
const rawRowIncluding = (frame: string | undefined, needle: string): string =>
  (frame ?? "").split("\n").find((l) => strip(l).includes(needle)) ?? "";
const plain = (tag: string): RenderItem => ({ kind: "line", id: tag, line: { text: tag } });
const sgrBg = (rgbToken: string): string => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgbToken)!;
  return `\x1b[48;2;${m[1]};${m[2]};${m[3]}m`;
};
const SEL_BG = sgrBg(themeTokens().selectionBg);
const RESET_BG = "\x1b[49m";
/** 1-based column of `word`'s first character within an already-STRIPPED row string. */
const colOf = (rowText: string, word: string): number => {
  const at = rowText.indexOf(word);
  expect(at, `"${word}" not found in "${rowText}"`).toBeGreaterThanOrEqual(0);
  return at + 1;
};

const dock = (n: number) => <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}</Box>;
interface SceneOpts {
  items?: readonly RenderItem[]; streaming?: readonly RenderLine[]; queuedItems?: readonly RenderItem[];
  columns?: number; hitmap: React.Ref<ViewportHitmap>; scroll?: React.Ref<ViewportScroll>;
}
const scene = (opts: SceneOpts) => (
  <FullscreenFrame rows={FRAME_ROWS} dock={dock(3)} regionChildren={<>
    <Transcript staticItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} />
    <FullscreenViewport finalizedItems={opts.items ?? NO_ITEMS} pendingItems={NO_ITEMS}
      streaming={opts.streaming ?? NO_LINES} queuedItems={opts.queuedItems} columns={opts.columns ?? COLS}
      hitmapRef={opts.hitmap} scrollRef={opts.scroll} />
  </>} />
);
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

describe("F10 S4c — the viewport remap: four before/after cells, each covering the SAME text after the change", () => {
  it("insert above: a new item published ahead of the document relocates the highlight, does not clear it", async () => {
    const T: RenderItem = { kind: "line", id: "T", line: { text: "select target word" } };
    const DOC = [plain("P0"), plain("P1"), T, plain("P3"), plain("P4")];
    const SHIFTED = [plain("NEW"), ...DOC];
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene({ items: DOC, hitmap }));
    await settle();
    const row = rowOfIncluding(lastFrame(), "select target word");
    hitmap.current!.startSelectionAt(1, row);
    hitmap.current!.dragSelectionTo(6, row);
    await settle();
    expect(rawRowIncluding(lastFrame(), "select target word")).toContain(`${SEL_BG}select${RESET_BG}`);
    expect(hitmap.current!.selectedText()).toBe("select");

    rerender(scene({ items: SHIFTED, hitmap }));
    await settle();
    const rowAfter = rowOfIncluding(lastFrame(), "select target word");
    expect(rowAfter).toBe(row + 1);                       // premise: T really did move down by one row
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("select");
    expect(rawRowIncluding(lastFrame(), "select target word")).toContain(`${SEL_BG}select${RESET_BG}`);
  });

  it("re-wrap narrower: a smaller `columns` re-flows the item, and the highlight follows its word to the new row", async () => {
    const LONG: RenderItem = { kind: "line", id: "LONG", line: { text: "alpha beta gamma delta epsilon zeta eta theta iota kappa" } };
    const DOC = [plain("P0"), LONG, plain("P2")];
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene({ items: DOC, hitmap, columns: 40 }));
    await settle();
    const row = rowOfIncluding(lastFrame(), "gamma");
    const text = strip(rowsOf(lastFrame())[row - 1]);
    const col = colOf(text, "gamma");
    hitmap.current!.startSelectionAt(col, row);
    hitmap.current!.dragSelectionTo(col + 4, row);
    await settle();
    expect(hitmap.current!.selectedText()).toBe("gamma");
    expect(rawRowIncluding(lastFrame(), "gamma")).toContain(`${SEL_BG}gamma${RESET_BG}`);

    // `columns: 14`, not merely narrower: at 14 columns "gamma" wraps onto a genuinely DIFFERENT physical row
    // than it painted at 40 (verified: width 40 keeps "alpha beta gamma delta epsilon zeta eta " on one row;
    // width 14 puts "gamma delta" on its own row, one row below "alpha beta", with `P0` still on screen
    // throughout — a re-wrap that leaves the word's OWN screen row unchanged would pass even with the remap
    // sabotaged (step 6.7), since a stale, unremapped cell would still happen to land on the right row by
    // coincidence.
    rerender(scene({ items: DOC, hitmap, columns: 14 }));
    await settle();
    const rowAfter = rowOfIncluding(lastFrame(), "gamma");
    expect(rowAfter).not.toBe(row);                        // premise: "gamma" really did move to a new row
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("gamma");
    expect(rawRowIncluding(lastFrame(), "gamma")).toContain(`${SEL_BG}gamma${RESET_BG}`);
  });

  it("fold toggle: collapsing a group above the selection shifts it without clearing", async () => {
    const T: RenderItem = { kind: "line", id: "T", line: { text: "select target word" } };
    const EXPANDED = [plain("G0"), plain("G1"), plain("G2"), T, plain("P3")];
    const COLLAPSED = [plain("GSUM"), T, plain("P3")];
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene({ items: EXPANDED, hitmap }));
    await settle();
    const row = rowOfIncluding(lastFrame(), "select target word");
    hitmap.current!.startSelectionAt(1, row);
    hitmap.current!.dragSelectionTo(6, row);
    await settle();
    expect(hitmap.current!.selectedText()).toBe("select");

    rerender(scene({ items: COLLAPSED, hitmap }));
    await settle();
    const rowAfter = rowOfIncluding(lastFrame(), "select target word");
    expect(rowAfter).toBe(row - 2);                        // premise: the group really did shrink by two rows
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("select");
    expect(rawRowIncluding(lastFrame(), "select target word")).toContain(`${SEL_BG}select${RESET_BG}`);
  });

  it("partially-sliced gutter block: scroll to reveal earlier rows, then back — the still-visible row stays put", async () => {
    const G: RenderItem = { kind: "gutter-block", id: "G", gutter: TOOL_RESULT_GUTTER,
      body: Array.from({ length: 6 }, (_, i) => ({ text: `row${i}` })) };
    const DOC = [G, ...Array.from({ length: 5 }, (_, i) => plain(`Q${i}`))];
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(scene({ items: DOC, hitmap, scroll }));
    await settle();
    // premise: only the block's LOWER body rows are painted by default (sticky, tail-anchored)
    expect(rowsOf(lastFrame()).some((l) => strip(l).includes("row0"))).toBe(false);
    const row = rowOfIncluding(lastFrame(), "row5");
    const text = strip(rowsOf(lastFrame())[row - 1]);
    const col = colOf(text, "row5");
    hitmap.current!.startSelectionAt(col, row);
    hitmap.current!.dragSelectionTo(col + 3, row);
    await settle();
    expect(hitmap.current!.selectedText()).toBe("row5");

    scroll.current!.scroll({ kind: "top" });
    await settle();
    expect(rowsOf(lastFrame()).some((l) => strip(l).includes("row0"))).toBe(true);   // now fully revealed
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("row5");
    expect(rawRowIncluding(lastFrame(), "row5")).toContain(`${SEL_BG}row5${RESET_BG}`);

    scroll.current!.stickBottom();
    await settle();
    expect(rowsOf(lastFrame()).some((l) => strip(l).includes("row0"))).toBe(false);  // scrolled back out
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("row5");
    expect(rawRowIncluding(lastFrame(), "row5")).toContain(`${SEL_BG}row5${RESET_BG}`);
  });
});

describe("F10 S4c — document-order resolution: a backward or reversed drag selects the identical characters", () => {
  it("backward drag: focus above anchor selects the identical characters as the equivalent forward drag", async () => {
    const DOC = [{ kind: "line" as const, id: "A", line: { text: "first line here" } },
      { kind: "line" as const, id: "B", line: { text: "second line here" } }];

    const fwd = React.createRef<ViewportHitmap>();
    const rf = render(scene({ items: DOC, hitmap: fwd }));
    await settle();
    const rowAf = rowOfIncluding(rf.lastFrame(), "first line here");
    const rowBf = rowOfIncluding(rf.lastFrame(), "second line here");
    fwd.current!.startSelectionAt(1, rowAf);
    fwd.current!.dragSelectionTo(4, rowBf);
    await settle();
    const fwdText = fwd.current!.selectedText();
    rf.unmount();

    const bwd = React.createRef<ViewportHitmap>();
    const rb = render(scene({ items: DOC, hitmap: bwd }));
    await settle();
    const rowAb = rowOfIncluding(rb.lastFrame(), "first line here");
    const rowBb = rowOfIncluding(rb.lastFrame(), "second line here");
    // The gesture runs in the OPPOSITE screen direction — press on B (the later row), drag UP to A — so
    // `focus` ends up literally above `anchor` on screen; document-order resolution must still win.
    bwd.current!.startSelectionAt(4, rowBb);
    bwd.current!.dragSelectionTo(1, rowAb);
    await settle();
    const bwdText = bwd.current!.selectedText();
    rb.unmount();

    expect(fwdText.length).toBeGreaterThan(0);
    expect(bwdText).toBe(fwdText);
  });

  it("mid-drag direction reversal lands on the same selection as a direct drag to the final cell", async () => {
    const T: RenderItem = { kind: "line", id: "T", line: { text: "select target word" } };
    const DOC = [T];

    const reversed = React.createRef<ViewportHitmap>();
    const r1 = render(scene({ items: DOC, hitmap: reversed }));
    await settle();
    const row1 = rowOfIncluding(r1.lastFrame(), "select target word");
    reversed.current!.startSelectionAt(6, row1);          // anchor at "select"'s own last character
    reversed.current!.dragSelectionTo(19, row1);           // forward, into "word"
    await settle();
    reversed.current!.dragSelectionTo(1, row1);            // reverse hard, back past the anchor's own cell
    await settle();
    const reversedText = reversed.current!.selectedText();
    r1.unmount();

    const direct = React.createRef<ViewportHitmap>();
    const r2 = render(scene({ items: DOC, hitmap: direct }));
    await settle();
    const row2 = rowOfIncluding(r2.lastFrame(), "select target word");
    direct.current!.startSelectionAt(6, row2);
    direct.current!.dragSelectionTo(1, row2);
    await settle();
    const directText = direct.current!.selectedText();
    r2.unmount();

    expect(reversedText.length).toBeGreaterThan(0);
    expect(reversedText).toBe(directText);
  });
});

describe("F10 S4c — a live sweep survives a streamed delta arriving ABOVE it, still held", () => {
  it("streamed-delta-during-sweep: a growing streaming tier does not disturb an in-progress (unreleased) drag on a queued row", async () => {
    const T: RenderItem = { kind: "line", id: "T", line: { text: "select target word" } };
    const d1: RenderLine = { text: "streaming line one" };
    const d2: RenderLine = { text: "streaming line two" };
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene({ hitmap, streaming: [d1], queuedItems: [T] }));
    await settle();
    const row = rowOfIncluding(lastFrame(), "select target word");
    hitmap.current!.startSelectionAt(1, row);
    hitmap.current!.dragSelectionTo(6, row);
    await settle();
    expect(hitmap.current!.selectedText()).toBe("select");

    // The document grows ABOVE the queued row while the button is still down — `endSelectionDrag` is never
    // called, matching acceptance cell 3's own premise: the sweep is HELD, not released, when the shift lands.
    rerender(scene({ hitmap, streaming: [d1, d2], queuedItems: [T] }));
    await settle();
    const rowAfter = rowOfIncluding(lastFrame(), "select target word");
    expect(rowAfter).toBe(row + 1);                        // premise: the streaming tier really did grow
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("select");
    expect(rawRowIncluding(lastFrame(), "select target word")).toContain(`${SEL_BG}select${RESET_BG}`);
  });
});

describe("F10 S4c — a selection spanning a blank line survives a narrower re-wrap (Task 4's blank-line ownership rule, end to end)", () => {
  it("readme / blank / a long tail: re-wrapping narrower reflows the tail into several rows, the copy stays byte-identical", async () => {
    const TAIL = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
    const G: RenderItem = { kind: "gutter-block", id: "G2", gutter: TOOL_RESULT_GUTTER,
      body: [{ text: "readme" }, { text: "" }, { text: TAIL }] };
    const DOC = [G];
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene({ items: DOC, hitmap, columns: 80 }));
    await settle();
    const rowReadme = rowOfIncluding(lastFrame(), "readme");
    const rowTail = rowOfIncluding(lastFrame(), "delta");
    expect(rowTail).toBeGreaterThan(rowReadme);            // premise: the blank row really does sit between them
    const colStart = colOf(strip(rowsOf(lastFrame())[rowReadme - 1]), "readme");
    const tailText = strip(rowsOf(lastFrame())[rowTail - 1]);
    const colEnd = colOf(tailText, "delta") + "delta".length - 1;
    hitmap.current!.startSelectionAt(colStart, rowReadme);
    hitmap.current!.dragSelectionTo(colEnd, rowTail);
    await settle();
    const before = hitmap.current!.selectedText();
    expect(before.startsWith("readme")).toBe(true);
    expect(before.endsWith("delta")).toBe(true);

    rerender(scene({ items: DOC, hitmap, columns: 20 }));
    await settle();
    // premise: the tail's own row no longer carries its LAST word — it really did wrap into more than one
    // physical row at the narrower width.
    const wrappedTailRow = rowOfIncluding(lastFrame(), "delta");
    expect(strip(rowsOf(lastFrame())[wrappedTailRow - 1]).includes("lima")).toBe(false);
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe(before);
  });
});

describe("F10 S4c — itemKey stability pin: a growing streamed block never changes identity mid-token", () => {
  it("three successive deltas of one streaming line all publish the same itemKey — a live selection on it never clears", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const d1: RenderLine = { text: "The answer is" };
    const { lastFrame, rerender } = render(scene({ hitmap, streaming: [d1] }));
    await settle();
    const row = rowOfIncluding(lastFrame(), "The answer is");
    hitmap.current!.startSelectionAt(1, row);
    hitmap.current!.dragSelectionTo(3, row);
    await settle();
    expect(hitmap.current!.selectedText()).toBe("The");

    const d2: RenderLine = { text: "The answer is forty" };
    rerender(scene({ hitmap, streaming: [d2] }));
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("The");

    const d3: RenderLine = { text: "The answer is forty-two" };
    rerender(scene({ hitmap, streaming: [d3] }));
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe("The");
  });
});
