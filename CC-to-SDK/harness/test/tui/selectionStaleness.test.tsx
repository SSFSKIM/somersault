// tui/test/selectionStaleness.test.tsx — F10 T-SELECT S4c. Originally final-review finding 7's own proof
// that `SelectionState` (mouse/selection.ts) addresses rows by NUMERIC INDEX into `FullscreenViewport`'s
// `hit.current.rows`, and that a streamed repaint shifting what sits at a given index (a new item published
// above a live selection, a fold toggling, a scroll re-wrapping the window) mis-highlighted and mis-copied
// whatever now occupied that index — fixed then by snapshotting each selected row's `itemKey` and clearing
// the WHOLE selection the moment a later publish showed a different key at the same row: "never wrong,
// sometimes just gone."
//   F10 S4 replaces the snapshot-and-clear with CHARACTER-IDENTITY addresses (`mouse/address.ts`) and a
// during-render REMAP (`FullscreenViewport.tsx`'s `selectionAddrRef`/`recordSelectionAddresses`): an insert
// above, a re-wrap, or a fold toggle no longer clear the selection at all, they relocate it onto the SAME
// characters at their new screen position. The one case that still clears is the one the address genuinely
// cannot survive — the selected item leaving the DOCUMENT entirely, not merely moving within it (see
// `test/tui/selectionRemap.test.tsx` for the full remap acceptance: insert-above, re-wrap, fold-toggle,
// scroll-out-and-back, backward/reversed drags, and the streamed-delta-during-sweep pty-adjacent cell).
// This file keeps only the two cases that are this track's OWN regression guards: the false-positive check
// (an unrelated repaint must never touch a live selection) and the new true-clear case (removal). Both run
// through the REAL `FullscreenFrame` + `FullscreenViewport` pair and the REAL `ViewportHitmap` gesture
// methods — `fold-hitmap.test.tsx`'s own harness, reused rather than reinvented.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { FullscreenViewport, type ViewportHitmap } from "../../src/tui/FullscreenViewport.js";
import { Transcript } from "../../src/tui/Transcript.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";
import { tick } from "./keysTestUtil.js";

const FRAME_ROWS = 12, COLS = 40;
const NO_ITEMS: readonly RenderItem[] = [];
const NO_LINES: readonly RenderLine[] = [];
const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
const strip = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();
const rowOf = (frame: string | undefined, text: string): number => {
  const at = rowsOf(frame).findIndex((line) => strip(line) === text);
  expect(at, `"${text}" is not painted in:\n${(frame ?? "")}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const plain = (tag: string): RenderItem => ({ kind: "line", id: tag, line: { text: tag } });

// Five short single-row items — well inside the 8-row region this geometry grants (see fold-hitmap.test.tsx's
// own comment: FRAME_ROWS=12, dock 3 rows, region 8).
const DOC: readonly RenderItem[] = [plain("P0"), plain("P1"), plain("P2"), plain("P3"), plain("P4")];
// The same document with a new item PUBLISHED ABOVE everything else — every row from P0 down shifts by one,
// so whatever screen row used to show P2 now shows P1.
const SHIFTED: readonly RenderItem[] = [plain("NEW"), ...DOC];
// P2 removed OUTRIGHT — not shifted, GONE from the document. The one case the address cannot survive: there
// is no character identity left to remap onto.
const REMOVED: readonly RenderItem[] = [plain("P0"), plain("P1"), plain("P3"), plain("P4")];

const dock = (n: number) => <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}</Box>;

const scene = (items: readonly RenderItem[], hitmap: React.Ref<ViewportHitmap>) => (
  <FullscreenFrame rows={FRAME_ROWS} dock={dock(3)} regionChildren={<>
    <Transcript staticItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} />
    <FullscreenViewport finalizedItems={items} pendingItems={NO_ITEMS} streaming={NO_LINES} columns={COLS} hitmapRef={hitmap} />
  </>} />
);
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

describe("F10 S4c: a live selection is REMAPPED onto its content, and cleared only when that content is gone", () => {
  it("a selection on P2 SURVIVES a published item above it shifting P2's screen row — this is the remap's own positive case", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene(DOC, hitmap));
    await settle();
    const rowP2 = rowOf(lastFrame(), "P2");

    // A real sweep on P2's own row: press col 1, drag to col 2 (a genuine two-cell selection, not a
    // press-release-same-cell no-op).
    hitmap.current!.startSelectionAt(1, rowP2);
    hitmap.current!.dragSelectionTo(2, rowP2);
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    const before = hitmap.current!.selectedText();
    expect(before.length).toBeGreaterThan(0);

    // Publish a document with a new item inserted ABOVE everything — the row that used to paint "P2" now
    // paints "P1" instead. The characters the reader dragged over did not move IN THE DOCUMENT, only on
    // screen, so the address-based remap relocates the selection rather than clearing it.
    rerender(scene(SHIFTED, hitmap));
    await settle();
    expect(strip(rowsOf(lastFrame())[rowP2 - 1])).toBe("P1");   // premise: the row's CONTENT did move

    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe(before);        // same characters, wherever they now paint
    const rowP2After = rowOf(lastFrame(), "P2");
    expect(rowP2After).toBe(rowP2 + 1);                         // P2 itself moved down by exactly one row
  });

  it("a selection on P2 clears once P2 is REMOVED from the document entirely — the one case the address cannot survive", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene(DOC, hitmap));
    await settle();
    const rowP2 = rowOf(lastFrame(), "P2");
    hitmap.current!.startSelectionAt(1, rowP2);
    hitmap.current!.dragSelectionTo(2, rowP2);
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText().length).toBeGreaterThan(0);

    // Publish a document with P2 gone outright — no item in the new document carries P2's itemKey, so there
    // is no character identity to remap onto.
    rerender(scene(REMOVED, hitmap));
    await settle();
    expect(rowsOf(lastFrame()).some((line) => strip(line) === "P2")).toBe(false);   // premise: P2 is gone

    expect(hitmap.current!.hasSelection()).toBe(false);
    expect(hitmap.current!.selectedText()).toBe("");
  });

  it("an UNCHANGED document leaves the selection exactly as it was (no false-positive clear or drift)", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene(DOC, hitmap));
    await settle();
    const rowP2 = rowOf(lastFrame(), "P2");
    hitmap.current!.startSelectionAt(1, rowP2);
    hitmap.current!.dragSelectionTo(2, rowP2);
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    const before = hitmap.current!.selectedText();

    // Re-publish the IDENTICAL document (a repaint with nothing moved, e.g. an unrelated hover tick).
    rerender(scene([...DOC], hitmap));
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe(before);
  });
});
