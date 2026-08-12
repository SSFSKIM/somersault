// tui/test/fullscreen-viewport.test.tsx — FSW Task 10: the whole document, virtualized, anchored to its tail.
//
// WHAT THIS FILE IS ABOUT. Task 9 gave the alternate screen a frame with a fixed budget; the region inside it
// still held only the UNPUBLISHED tail, so every row `useChat` had already committed was on no surface at all
// (there is no `<Static>` in the fullscreen tree and no scrollback on the alternate screen to hold one). The
// viewport replaces that with the whole document — `finalizedItems ⧺ pendingItems ⧺ streamingItems(...)` —
// and paints the window `[offset, offset + regionRows)` over its PHYSICAL rows, with T2's anchor deciding
// where the window sits.
//
// THREE CLAIMS, and the cases below are grouped by them:
//   1. The ANCHOR is canon's: content shorter than the region sits at the TOP (blank rows below it, the dock
//      pinned to the frame's last line — the 80x40 case); a taller document shows its tail and follows an
//      append while sticky; an explicit scroll unsticks and an append then does not move the window;
//      `stickBottom` re-sticks and re-derives.
//   2. The SLICES are physical rows, not items: a gutter block is cut by body row, exactly one `⎿` is printed
//      for the fragment carrying the block's first visible row, and a streaming line three times the region's
//      width occupies THREE slice rows (the C4 honesty case — `streamingItems` pre-wraps so that
//      `renderItemHeight` can be trusted before Ink lays anything out).
//   3. The BUDGET is never exceeded. `pageItemSlices` clamps to the rows the region granted, so the frame's
//      `overflow: hidden` never has to do the clipping and `onOverflow` stays silent. That is the difference
//      between an invariant and a coincidence, and it is asserted through a real `FullscreenFrame`.
//
// `ink-testing-library` is the instrument (its `debug: true` arm writes `fullStaticOutput + output`, so
// `lastFrame()` IS the serialized frame line for line, which is what every height assertion here reads).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, afterAll } from "vitest";
import { FullscreenViewport, type ViewportScroll } from "../../src/tui/FullscreenViewport.js";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { RenderLine } from "../../src/tui/render.js";

const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
/** SGR off, so a row can be compared as the text a reader sees. */
const strip = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "").trim();
const NO_ITEMS: readonly RenderItem[] = [];
const NO_LINES: readonly RenderLine[] = [];
/** `n` one-row line items, each carrying its own index so a window can be located rather than counted. */
const doc = (n: number, tag = "L"): readonly RenderItem[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "line" as const, id: `${tag}${i}`, line: { text: `${tag}${i}` } }));
/** One gutter block with `n` body rows — `renderItemHeight` is `body.length`, so this is an `n`-row item. */
const block = (id: string, n: number): RenderItem =>
  ({ kind: "gutter-block", id, gutter: TOOL_RESULT_GUTTER, body: Array.from({ length: n }, (_, i) => ({ text: `B${i}` })) });
const band = (n: number, tag: string) => (
  <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`${tag}${i}`}</Text>)}</Box>
);
/** The viewport with everything but the document defaulted — every case below varies one thing. */
const view = (props: Partial<React.ComponentProps<typeof FullscreenViewport>> & { rows: number }) => (
  <FullscreenViewport finalizedItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} columns={80} {...props} />
);
/** The composer's ready prompt: `❯` + a NON-BREAKING space (U+00A0), which is what it actually paints. */
const PROMPT = "\u276f\u00a0";
/** The frame's region MEASURES itself and publishes the result as state, so a mount converges over two passive
 *  effect passes: the first paints at the region's floor and measures the real grant, the second paints at it
 *  and re-measures the content against it. `onOverflow` is only true after the second — a single tick would
 *  make every "the diagnostic stayed silent" assertion below vacuous (measured: with a deliberate extra row
 *  past the grant, one tick still reports nothing). */
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("FullscreenViewport — the anchor", () => {
  // §3.4's warning, as a test: bottom-anchoring means the transcript follows its own TAIL, not that content
  // is pushed down the screen. A three-row document in a ten-row region starts on the region's FIRST row.
  it("top-aligns a document shorter than the region", () => {
    const { lastFrame } = render(view({ finalizedItems: doc(3), rows: 10 }));
    expect(rowsOf(lastFrame())).toEqual(["L0", "L1", "L2"]);
  });

  it("shows the TAIL of a document taller than the region", () => {
    const { lastFrame } = render(view({ finalizedItems: doc(50), rows: 5 }));
    expect(rowsOf(lastFrame())).toEqual(["L45", "L46", "L47", "L48", "L49"]);
  });

  it("follows the tail on an append while sticky", () => {
    const { lastFrame, rerender } = render(view({ finalizedItems: doc(50), rows: 5 }));
    expect(rowsOf(lastFrame())).toEqual(["L45", "L46", "L47", "L48", "L49"]);
    rerender(view({ finalizedItems: doc(51), rows: 5 }));
    expect(rowsOf(lastFrame())).toEqual(["L46", "L47", "L48", "L49", "L50"]);
  });

  // The live capture's "typing while scrolled up does not snap back" (grounding §L2.3), at the surface that
  // has to honour it: a scroll off the bottom unsticks, and every later content event holds the window still.
  it("holds the window still when content arrives after an explicit scroll, and re-sticks on stickBottom", async () => {
    const ref = React.createRef<ViewportScroll>();
    const { lastFrame, rerender } = render(view({ finalizedItems: doc(50), rows: 5, scrollRef: ref }));
    ref.current!.scroll({ kind: "lines", n: -3 });
    await tick();
    expect(rowsOf(lastFrame())).toEqual(["L42", "L43", "L44", "L45", "L46"]);

    rerender(view({ finalizedItems: doc(51), rows: 5, scrollRef: ref }));
    expect(rowsOf(lastFrame())).toEqual(["L42", "L43", "L44", "L45", "L46"]);   // the append did NOT move it

    ref.current!.stickBottom();
    await tick();
    expect(rowsOf(lastFrame())).toEqual(["L46", "L47", "L48", "L49", "L50"]);   // …and the tail is back
    rerender(view({ finalizedItems: doc(52), rows: 5, scrollRef: ref }));
    expect(rowsOf(lastFrame())).toEqual(["L47", "L48", "L49", "L50", "L51"]);   // re-stuck, so it follows again
  });

  // THE ONE MOVE AN UNSTUCK ANCHOR MAKES UNBIDDEN, and the reason every content event is COMMITTED rather
  // than recomputed from the last scroll. Canon's retained ceiling is `max(G, Y − M)` with the CURRENT
  // viewport height (L179827), so growing the region pulls a held offset down — and canon writes that result
  // back (`e.scrollTop = Te`), so shrinking the region again does NOT give the old row back. A viewport that
  // re-derived from the last explicit scroll each render would restore 160 here, which is a row the user is
  // no longer on.
  it("lets a region GROWTH pull a held offset down, and keeps it there when the region shrinks back", async () => {
    const ref = React.createRef<ViewportScroll>();
    const at = (rows: number) => view({ finalizedItems: doc(200), rows, scrollRef: ref });
    const { lastFrame, rerender } = render(at(10));
    ref.current!.scroll({ kind: "lines", n: -30 });                  // 190 → 160, unsticky, hwm 200
    await tick();
    expect(rowsOf(lastFrame())[0]).toBe("L160");

    rerender(at(60));                                                // ceiling max(0, 200 − 60) = 140
    expect(rowsOf(lastFrame())[0]).toBe("L140");
    rerender(at(10));                                                // ceiling 190 — the 160 is gone for good
    expect(rowsOf(lastFrame())[0]).toBe("L140");
  });

  // The three regions are one document in reading order, and the anchor measures across all of them.
  it("anchors across finalized, pending and streaming rows as one document", () => {
    const { lastFrame } = render(view({
      finalizedItems: doc(3, "F"), pendingItems: doc(2, "P"), streaming: [{ text: "S0" }, { text: "S1" }], rows: 4,
    }));
    // Seven physical rows (3 + 2 + 2) in a four-row region: the window is the last four, which crosses two
    // of the three region boundaries — so a viewport that anchored inside one of them would show F-rows.
    expect(rowsOf(lastFrame())).toEqual(["P0", "P1", "S0", "S1"]);
  });
});

describe("FullscreenViewport — slices are physical rows", () => {
  it("slices a gutter block by body row and prints no connector on a continuation fragment", () => {
    const { lastFrame } = render(view({ finalizedItems: [block("g", 10)], rows: 4 }));
    const lines = rowsOf(lastFrame());
    expect(lines.map((l) => l.trim())).toEqual(["B6", "B7", "B8", "B9"]);
    expect(lastFrame()).not.toContain("⎿");                     // the `⎿` belongs to row 0, which is above
  });

  it("prints exactly one connector for the fragment carrying the block's first row", () => {
    const { lastFrame } = render(view({ finalizedItems: [block("g", 3)], rows: 4 }));
    const frame = lastFrame() ?? "";
    expect(frame.split("⎿")).toHaveLength(2);                   // exactly one connector
    expect(rowsOf(frame).map((l) => l.trim().replace(/^⎿\s*/, ""))).toEqual(["B0", "B1", "B2"]);
  });

  // ── THE C4 HONESTY CASE ───────────────────────────────────────────────────────────────────────────────
  // `LiveTurn.snapshot()` hands out lines wrapped at the width the turn STARTED with; `streamingItems`
  // re-wraps them to the region's width so `renderItemHeight` is 1 per PHYSICAL row. If it did not, a line
  // three times the region's width would report one row, the anchor's arithmetic would be off by two, and
  // Ink would wrap it anyway — so the region would paint three rows where the budget allowed one.
  it("counts a streaming line at 3x the region width as THREE rows, not one", () => {
    const long = "A".repeat(30) + "B".repeat(30) + "C".repeat(30);
    const all = render(view({ streaming: [{ text: long }], columns: 30, rows: 3 }));
    expect(rowsOf(all.lastFrame())).toEqual(["A".repeat(30), "B".repeat(30), "C".repeat(30)]);
    all.unmount();

    // …and the arithmetic that proves it: a two-row region anchored to the tail of a THREE-row document
    // shows the last two rows. Were the line one row, the whole document would be one row, the offset 0,
    // and the "A" chunk on screen.
    const tail = render(view({ streaming: [{ text: long }], columns: 30, rows: 2 }));
    expect(rowsOf(tail.lastFrame())).toEqual(["B".repeat(30), "C".repeat(30)]);
    tail.unmount();
  });
});

describe("FullscreenViewport — the region's budget", () => {
  it.each([3, 7, 19])("never paints more than the %i rows it was granted", (rows) => {
    const { lastFrame } = render(view({ finalizedItems: doc(200), rows }));
    expect(rowsOf(lastFrame())).toHaveLength(rows);
  });

  // THE 80x40 ANCHOR CASE, through the real frame: the viewport takes its row budget from the region it is
  // mounted in, a short document sits at the TOP of that region, the blank rows are BELOW it, and the dock is
  // pinned to the frame's last line. The region measures itself, so this is the case that proves the budget
  // reaches the viewport at all — not `frameHeight`, and not `dockCap`, but the rows actually granted.
  it("takes its budget from the frame's region: short content on top, dock pinned at 80x40", async () => {
    const overflow = vi.fn();
    const { lastFrame } = render(
      <FullscreenFrame rows={40} onOverflow={overflow} dock={band(2, "D")}
        regionChildren={view({ finalizedItems: doc(3), rows: undefined as unknown as number })} />,
    );
    await settle();
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(39);
    expect(lines.slice(0, 3)).toEqual(["L0", "L1", "L2"]);
    expect(lines.slice(3, 37).join("")).toBe("");
    expect(lines.slice(37)).toEqual(["D0", "D1"]);
    expect(overflow).not.toHaveBeenCalled();
  });

  // …and the same frame with a document two hundred rows long. The viewport must CLAMP rather than let the
  // frame clip: `onOverflow` is canon's "something is rendering outside the frame's budget" diagnostic
  // (L180317) and a viewport that tripped it would be relying on the clip instead of respecting the grant.
  it("clamps a 200-row document to the granted rows instead of leaning on the frame's clip", async () => {
    const overflow = vi.fn();
    const { lastFrame } = render(
      <FullscreenFrame rows={40} onOverflow={overflow} dock={band(2, "D")}
        regionChildren={view({ finalizedItems: doc(200), rows: undefined as unknown as number })} />,
    );
    await settle();
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(39);
    expect(lines[0]).toBe("L163");                                   // 39 − 2 dock rows = 37 granted, tail-anchored
    expect(lines[36]).toBe("L199");
    expect(lines.slice(37)).toEqual(["D0", "D1"]);
    expect(overflow).not.toHaveBeenCalled();
  });

  // A SHRINK IS THE CASE THE GRANT CAN GO STALE ON. The region publishes a MEASURED height, and a resize moves
  // the frame's geometry a full render before the effect can re-measure — so for one frame the viewport would
  // be holding a grant from a taller terminal and would emit more rows than the region now has. Clipped, so
  // nothing tears; but the budget would be a coincidence for that frame rather than a contract, and the
  // diagnostic would say so. The grant is therefore stamped with the geometry it was measured at and falls
  // back to the region's FLOOR while the stamp is stale, which under-grants for one frame instead.
  it("does not over-render on the frame between a shrink and the re-measure", async () => {
    const overflow = vi.fn();
    const frame = (rows: number) => (
      <FullscreenFrame rows={rows} onOverflow={overflow} dock={band(2, "D")}
        regionChildren={view({ finalizedItems: doc(200), rows: undefined as unknown as number })} />
    );
    const { lastFrame, rerender } = render(frame(40));
    await settle();
    expect(rowsOf(lastFrame())).toHaveLength(39);
    rerender(frame(20));
    await settle();
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(19);
    expect(lines[16]).toBe("L199");                                  // 19 − 2 dock rows = 17 granted, tail-anchored
    expect(lines.slice(17)).toEqual(["D0", "D1"]);
    expect(overflow).not.toHaveBeenCalled();
  });
});

let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-t10-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

describe("ChatApp's fullscreen region is the whole document", () => {
  const alphaEntries = (n = 60) => Array.from({ length: n }, (_, i) => ({
    kind: "sdk" as const, source: "disk" as const,
    message: { type: "assistant", parent_tool_use_id: null, uuid: `u-${i}`, message: { id: `m-${i}`, content: [{ type: "text", text: `ALPHA-${i}` }] } },
  }));

  // THE OMISSION TASK 9 SHIPPED, CLOSED. With sixty rows of transcript, `useChat` has committed most of them
  // to `state.staticItems` — and in fullscreen there is no `<Static>` to paint them, so before this task the
  // region held only the unpublished tail and the newest rows were the only ones anywhere. The viewport reads
  // `finalizedItems`, which is the WHOLE projection, so the frame shows the document's real tail.
  it("fills the region with the tail of the committed transcript, inside a rows − 1 frame", async () => {
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={alphaEntries()}
        deps={{ columns: () => 80, rows: () => 24 }} />,
    );
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(23);
    // NINETEEN rows of transcript and a four-row dock, with no gap between them. This is the discriminating
    // measurement, not the mere presence of `ALPHA-59`: Task 9's live-window region held `mainWindowCap(24) −
    // WINDOW_SLACK` = EIGHT rows (ALPHA-52 onward) and left eleven blank rows above the dock, because eight
    // is what the main screen's fourteen-row dock reservation leaves — a budget for a renderer whose other
    // fifty-two rows are in scrollback. Here there is no scrollback, so the region is full or the rows are
    // simply gone.
    expect(lines.slice(0, 19).map(strip)).toEqual(Array.from({ length: 19 }, (_, i) => `⏺ ALPHA-${41 + i}`));
    expect(strip(lines[20]!)).toContain("❯");                        // …and the dock starts on the next row
    r.unmount();
  });
});
