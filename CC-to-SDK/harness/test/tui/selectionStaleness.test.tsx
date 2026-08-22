// tui/test/selectionStaleness.test.tsx — final-review finding 7: `SelectionState` (mouse/selection.ts)
// addresses rows by NUMERIC INDEX into `FullscreenViewport`'s own `hit.current.rows`, and that array is
// rebuilt from scratch on every publish. A streamed repaint that shifts what sits at a given index (a new
// item published above a live selection, a fold toggling, a scroll re-wrapping the window) used to leave
// the selection highlighting — and `selectedText()`/copy reading — whatever now occupies that index,
// never what the reader actually dragged over. The fix snapshots each selected row's `itemKey` at
// selection time and clears the whole selection the moment a later publish shows a different key at the
// same row. This file proves exactly that, through the REAL `FullscreenFrame` + `FullscreenViewport` pair
// and the REAL `ViewportHitmap` gesture methods — `fold-hitmap.test.tsx`'s own harness, reused rather than
// reinvented, because the geometry (frame → region → painted row) is exactly what that file already pins.
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

const dock = (n: number) => <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}</Box>;

const scene = (items: readonly RenderItem[], hitmap: React.Ref<ViewportHitmap>) => (
  <FullscreenFrame rows={FRAME_ROWS} dock={dock(3)} regionChildren={<>
    <Transcript staticItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} />
    <FullscreenViewport finalizedItems={items} pendingItems={NO_ITEMS} streaming={NO_LINES} columns={COLS} hitmapRef={hitmap} />
  </>} />
);
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

describe("F9 final-review finding 7: a live selection is cleared, not mis-painted, when its rows shift", () => {
  it("a selection on P2 clears once a published item above it shifts P2 out from under it", async () => {
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
    expect(hitmap.current!.selectedText().length).toBeGreaterThan(0);

    // Publish a document with a new item inserted ABOVE everything — the row that used to paint "P2" now
    // paints "P1" instead. Nothing about the gesture itself changes; only the document shifted under it.
    rerender(scene(SHIFTED, hitmap));
    await settle();
    expect(strip(rowsOf(lastFrame())[rowP2 - 1])).toBe("P1");   // premise: the row's CONTENT did move

    // The stale selection must be gone entirely — not remapped onto "P1", not still claiming "P2"'s old
    // position, not silently highlighting whatever is there now.
    expect(hitmap.current!.hasSelection()).toBe(false);
    expect(hitmap.current!.selectedText()).toBe("");
  });

  it("an UNCHANGED document leaves the selection exactly as it was (no false-positive clear)", async () => {
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(scene(DOC, hitmap));
    await settle();
    const rowP2 = rowOf(lastFrame(), "P2");
    hitmap.current!.startSelectionAt(1, rowP2);
    hitmap.current!.dragSelectionTo(2, rowP2);
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);

    // Re-publish the IDENTICAL document (a repaint with nothing moved, e.g. an unrelated hover tick).
    rerender(scene([...DOC], hitmap));
    await settle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText().length).toBeGreaterThan(0);
  });
});
