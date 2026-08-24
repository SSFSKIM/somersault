// test/tui/selectionExtend.test.tsx — F10 T-SELECT S5: the six `selection:extend*` keyboard chords, canon's
// `Scroll` set (L174817: shift+left/right/up/down/home/end → extendLeft/Right/Up/Down/LineStart/LineEnd).
//
// TWO HARNESSES, for the two halves of the claim:
//   · The BEHAVIOUR + fall-through cases (real key bytes, real dispatch) run through the REAL `ChatApp` +
//     REAL keymap provider — `autoCopy.test.tsx`'s / `selectionPaint.test.tsx`'s own harness, reused rather
//     than reinvented, because the fall-through mechanism under test (`KeymapProvider`'s "a matched action
//     with no registered handler reaches the composer", `:177-180`) only exists on that real dispatch path.
//   · The PERSISTENCE cases (this task's own dependency on Task 6) run through `selectionRemap.test.tsx`'s
//     harness — `FullscreenFrame` + `FullscreenViewport` directly, driving `ViewportHitmap.moveSelectionFocus`
//     — because they assert against the SAME remap machinery that harness already proves for mouse gestures,
//     now fed a keyboard-driven mutation instead of a drag.
//
// `copyText` is mocked in the ChatApp half for the exact reason `selectionPaint.test.tsx` states: a real
// sweep's release fires the auto-copy latch, which would otherwise spawn a real clipboard write.
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";
import { themeTokens, setTheme } from "../../src/tui/theme.js";
import type { CopyResult } from "../../src/tui/copy.js";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { FullscreenViewport, type ViewportHitmap, type ViewportScroll } from "../../src/tui/FullscreenViewport.js";
import { Transcript } from "../../src/tui/Transcript.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";

const copyTextMock = vi.fn<(text: string, deps?: unknown) => Promise<CopyResult>>();
vi.mock("../../src/tui/copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tui/copy.js")>();
  return { ...actual, copyText: (text: string, deps?: unknown) => copyTextMock(text, deps) };
});
beforeEach(() => { copyTextMock.mockReset(); copyTextMock.mockResolvedValue({ channel: "native", oscBytes: null }); });
afterEach(() => { setTheme("auto"); vi.unstubAllEnvs(); });

// ── frame helpers, `selectionPaint.test.tsx`'s own idiom ───────────────────────────────────────────────
const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const rowsOf = (frame: string | undefined): string[] => plain(frame).split("\n");
const rawLineIncluding = (frame: string | undefined, needle: string): string =>
  (frame ?? "").split("\n").find((l) => plain(l).includes(needle)) ?? "";
const rowOfIncluding = (frame: string | undefined, needle: string): number => {
  const at = rowsOf(frame).findIndex((l) => l.includes(needle));
  expect(at, `no row contains "${needle}" in:\n${plain(frame)}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const sgrBg = (rgbToken: string): string => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgbToken)!;
  return `\x1b[48;2;${m[1]};${m[2]};${m[3]}m`;
};
const SEL_BG = sgrBg(themeTokens().selectionBg);
const RESET_BG = "\x1b[49m";

const sdk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
const prose = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });
// Assistant prose carries a 3-column "⏺ " gutter ahead of the text (`selectionPaint.test.tsx`'s own fixture,
// reused verbatim): "click " lands cols 4-9, "select" cols 10-15, " target word" after.
const DOC: readonly TranscriptBootstrapEntry[] = [prose("click select target word", "a")];
const PROMPT = "❯ ";   // composerFrame.ts's own `POINTER + NBSP`

const press = (col: number, row: number) => `\x1b[<0;${col};${row}M`;
const drag = (col: number, row: number) => `\x1b[<32;${col};${row}M`;
const release = (col: number, row: number) => `\x1b[<0;${col};${row}m`;
const SHIFT_LEFT = "\x1b[1;2D", SHIFT_RIGHT = "\x1b[1;2C", SHIFT_END = "\x1b[1;2F";
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function scene(entries: readonly TranscriptBootstrapEntry[]) {
  return <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
    renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={entries}
    deps={{ columns: () => 80, rows: () => 24 }} />;
}
async function mount(entries: readonly TranscriptBootstrapEntry[]) {
  const r = renderWithKeymap(scene(entries));
  await waitFor(() => plain(r.lastFrame()).includes(PROMPT));
  await settle();
  return r;
}
async function sweep(r: { stdin: { write(s: string): void } }, fromCol: number, toCol: number, row: number) {
  r.stdin.write(press(fromCol, row));
  await tick();
  r.stdin.write(drag(toCol, row));
  await settle();
  r.stdin.write(release(toCol, row));
  await settle();
}

describe("F10 S5 — behaviour: shift+right/shift+end extend a real sweep", () => {
  it("shift+right grows the painted span by exactly one column", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 11, row);                       // "se" — two characters
    expect(rawLineIncluding(r.lastFrame(), "click select")).toContain(`${SEL_BG}se${RESET_BG}`);
    r.stdin.write(SHIFT_RIGHT);
    await settle();
    const painted = rawLineIncluding(r.lastFrame(), "click select");
    expect(painted).toContain(`${SEL_BG}sel${RESET_BG}`);            // grew by ONE column: "se" → "sel"
    expect(painted).not.toContain(`${SEL_BG}se${RESET_BG}`);         // and it is no longer the old extent
    r.unmount();
  });

  it("shift+end reaches the row's own end", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 11, row);
    r.stdin.write(SHIFT_END);
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "click select")).toContain(`${SEL_BG}select target word${RESET_BG}`);
    r.unmount();
  });

  it("a live anchorSpan from a double-click is CLEARED by the first extend — the paint changes from the word span", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    // press+release (plain click), then a second press within the multi-click window (`selectionPaint.test.tsx`
    // T6(f)'s own technique) — a double-click on "select" sets `anchorSpan` with no drag required.
    r.stdin.write(press(12, row));
    r.stdin.write(release(12, row));
    await tick();
    r.stdin.write(press(12, row));
    await settle();
    const before = rawLineIncluding(r.lastFrame(), "click select");
    expect(before).toContain(`${SEL_BG}select${RESET_BG}`);
    r.stdin.write(release(12, row));
    await settle();
    r.stdin.write(SHIFT_RIGHT);
    await settle();
    const after = rawLineIncluding(r.lastFrame(), "click select");
    // The exact closed run "select" is gone — E0p downgraded the word span to a plain endpoint pair and the
    // extend moved it, so the highlight is no longer the untouched word span it started as.
    expect(after).not.toContain(`${SEL_BG}select${RESET_BG}`);
    expect(after).toContain(`${SEL_BG}select `);
    r.unmount();
  });
});

describe("F10 S5 — fall-through: with no selection live, the chord reaches the composer", () => {
  it("shift+left with no selection moves the caret, exactly as an unbound key would", async () => {
    const r = await mount(DOC);
    r.stdin.write("ab");
    await settle();
    await waitFor(() => plain(r.lastFrame()).includes(`${PROMPT}ab`));
    r.stdin.write(SHIFT_LEFT);
    await settle();
    r.stdin.write("X");
    await settle();
    await waitFor(() => plain(r.lastFrame()).includes(`${PROMPT}aXb`));
    r.unmount();
  });
});

// ── PERSISTENCE — this task's own dependency on Task 6 (`selectionRemap.test.tsx`'s harness, reused) ──────
const FRAME_ROWS = 12, COLS = 40;
const NO_ITEMS: readonly RenderItem[] = [];
const NO_LINES: readonly RenderLine[] = [];
const stripAnsi = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const remapRowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
const remapRowOfIncluding = (frame: string | undefined, needle: string): number => {
  const at = remapRowsOf(frame).findIndex((line) => stripAnsi(line).includes(needle));
  expect(at, `no row contains "${needle}" in:\n${(frame ?? "")}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const remapRawRowIncluding = (frame: string | undefined, needle: string): string =>
  (frame ?? "").split("\n").find((l) => stripAnsi(l).includes(needle)) ?? "";
const colOf = (rowText: string, word: string): number => {
  const at = rowText.indexOf(word);
  expect(at, `"${word}" not found in "${rowText}"`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const item = (tag: string): RenderItem => ({ kind: "line", id: tag, line: { text: tag } });
const dock = (n: number) => <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}</Box>;
interface RemapSceneOpts { items: readonly RenderItem[]; columns?: number; hitmap: React.Ref<ViewportHitmap>; scroll?: React.Ref<ViewportScroll>; }
const remapScene = (opts: RemapSceneOpts) => (
  <FullscreenFrame rows={FRAME_ROWS} dock={dock(3)} regionChildren={<>
    <Transcript staticItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} />
    <FullscreenViewport finalizedItems={opts.items} pendingItems={NO_ITEMS} streaming={NO_LINES}
      columns={opts.columns ?? COLS} hitmapRef={opts.hitmap} scrollRef={opts.scroll} />
  </>} />
);
const remapSettle = async () => { for (let i = 0; i < 4; i++) await tick(); };

describe("F10 S5 — persistence: an extend survives a repaint the same way a mouse sweep does (Task 6)", () => {
  it("shift+right, then an unrelated publish (a plain repaint through the remap) — the extension survives", async () => {
    const T: RenderItem = { kind: "line", id: "T", line: { text: "select target word" } };
    const DOC_ = [item("P0"), item("P1"), T, item("P3"), item("P4")];
    const SHIFTED = [item("NEW"), ...DOC_];
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(remapScene({ items: DOC_, hitmap }));
    await remapSettle();
    const row = remapRowOfIncluding(lastFrame(), "select target word");
    hitmap.current!.startSelectionAt(1, row);
    hitmap.current!.dragSelectionTo(6, row);
    await remapSettle();
    const before = hitmap.current!.selectedText();
    expect(hitmap.current!.moveSelectionFocus("right")).toBe(true);
    await remapSettle();
    const extended = hitmap.current!.selectedText();
    expect(extended).not.toBe(before);
    expect(extended.length).toBe(before.length + 1);
    expect(remapRawRowIncluding(lastFrame(), "select target word")).toContain(`${SEL_BG}${extended}${RESET_BG}`);

    rerender(remapScene({ items: SHIFTED, hitmap }));
    await remapSettle();
    const rowAfter = remapRowOfIncluding(lastFrame(), "select target word");
    expect(rowAfter).toBe(row + 1);                     // premise: the item really did shift down by one row
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe(extended);         // still the EXTENDED text, not the pre-extend one
    expect(remapRawRowIncluding(lastFrame(), "select target word")).toContain(`${SEL_BG}${extended}${RESET_BG}`);
  });

  it("shift+right x3, then a narrower re-wrap — the selection still covers the same characters", async () => {
    const LONG: RenderItem = { kind: "line", id: "LONG", line: { text: "alpha beta gamma delta epsilon zeta eta theta iota kappa" } };
    const DOC_ = [item("P0"), LONG, item("P2")];
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(remapScene({ items: DOC_, hitmap, columns: 40 }));
    await remapSettle();
    const row = remapRowOfIncluding(lastFrame(), "gamma");
    const text = stripAnsi(remapRowsOf(lastFrame())[row - 1]);
    const col = colOf(text, "gamma");
    hitmap.current!.startSelectionAt(col, row);
    hitmap.current!.dragSelectionTo(col + 4, row);
    await remapSettle();
    expect(hitmap.current!.selectedText()).toBe("gamma");
    expect(hitmap.current!.moveSelectionFocus("right")).toBe(true);
    expect(hitmap.current!.moveSelectionFocus("right")).toBe(true);
    expect(hitmap.current!.moveSelectionFocus("right")).toBe(true);
    await remapSettle();
    const extended = hitmap.current!.selectedText();
    expect(extended.length).toBe("gamma".length + 3);
    expect(remapRawRowIncluding(lastFrame(), "gamma")).toContain(`${SEL_BG}${extended}${RESET_BG}`);

    // width 14, not merely narrower: at 14 columns "gamma" genuinely moves to a NEW physical row (same
    // premise `selectionRemap.test.tsx`'s own re-wrap case records).
    rerender(remapScene({ items: DOC_, hitmap, columns: 14 }));
    await remapSettle();
    const rowAfter = remapRowOfIncluding(lastFrame(), "gamma");
    expect(rowAfter).not.toBe(row);                     // premise: "gamma" really did move to a new row
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe(extended);
    expect(remapRawRowIncluding(lastFrame(), "gamma")).toContain(`${SEL_BG}${extended}${RESET_BG}`);
  });

  it("shift+down, then an unrelated publish — the extension survives the very next remap", async () => {
    const rowsDoc = [item("row A text here"), item("row B text here")];
    const rowsDocPublished = [item("row A text here"), item("row B text here"), item("row C text here")];
    const hitmap = React.createRef<ViewportHitmap>();
    const { lastFrame, rerender } = render(remapScene({ items: rowsDoc, hitmap }));
    await remapSettle();
    const rowA = remapRowOfIncluding(lastFrame(), "row A text here");
    hitmap.current!.startSelectionAt(1, rowA);
    hitmap.current!.dragSelectionTo(3, rowA);
    await remapSettle();
    const before = hitmap.current!.selectedText();
    expect(hitmap.current!.moveSelectionFocus("down")).toBe(true);
    await remapSettle();
    const extended = hitmap.current!.selectedText();
    expect(extended).not.toBe(before);

    // A publish that leaves the two selected rows unchanged still runs the SAME during-render remap path —
    // this is the regression the plan review caught: a `moveFocus` that repaints without recording survives
    // the FIRST frame (nothing moved yet) but reverts on the very next one, because that render re-derives the
    // paint from the stale mouse-era address. An unrelated new row published below is the cheapest way to
    // force that next render without touching the selected content itself.
    rerender(remapScene({ items: rowsDocPublished, hitmap }));
    await remapSettle();
    expect(hitmap.current!.hasSelection()).toBe(true);
    expect(hitmap.current!.selectedText()).toBe(extended);
  });
});


// ── Task 7 step 7.9 (shipped from Task 8, once S4 AND S6 both landed): an up/down extend at the WINDOW's
// own edge — not the document's — scrolls by ONE row and keeps the focus at that same clamped row, canon's
// `S()` wrapper (L551745-551761). Same harness as the persistence block above, plus a `ViewportScroll` ref
// to put the window somewhere with room both above and below before the extend runs.
describe("F10 S6 — Task 7 step 7.9: an up/down extend at the window's own edge scrolls by one", () => {
  it("shift+up from the window's own top row scrolls the window by one and the selection grows by one row; at the document's own top it does nothing and returns false", async () => {
    const DOC_ = Array.from({ length: 20 }, (_, i) => item(`ROW${i}`));
    const hitmap = React.createRef<ViewportHitmap>();
    const scroll = React.createRef<ViewportScroll>();
    const { lastFrame } = render(remapScene({ items: DOC_, hitmap, scroll }));
    await remapSettle();
    scroll.current!.scroll({ kind: "top" });
    await remapSettle();
    scroll.current!.scroll({ kind: "lines", n: 5 }); // "scrolled mid-way" — 5 rows of room above the window
    await remapSettle();

    const topLabelBefore = stripAnsi(remapRowsOf(lastFrame())[0]).trim(); // the window's own first painted row
    hitmap.current!.startSelectionAt(1, 1);
    hitmap.current!.dragSelectionTo(3, 1);
    await remapSettle();
    const before = hitmap.current!.selectedText();
    expect(before.length).toBeGreaterThan(0);

    expect(hitmap.current!.moveSelectionFocus("up")).toBe(true);
    await remapSettle();
    // The window scrolled by exactly one row: the label that used to be at the top is now one row down.
    expect(stripAnsi(remapRowsOf(lastFrame())[1]).trim()).toBe(topLabelBefore);
    const extended = hitmap.current!.selectedText();
    // The selection now spans TWO rows (the newly-revealed one plus the original), not merely a longer
    // slice of the same row — `before` was a same-row partial selection; a strict substring/suffix
    // comparison against it does not hold once the anchor/focus document-order roles swap (the anchor's
    // own endpoint now contributes its UPPER bound instead of its lower one), so the row COUNT is what
    // this asserts instead.
    expect(extended.length).toBeGreaterThan(before.length); // the selection grew — a new row joined it
    expect(extended.split("\n").length).toBe(2);            // exactly one row joined the original one

    // Walk to the document's own top (however many more "up"s that takes), then confirm one more is a no-op.
    let steps = 0;
    while (hitmap.current!.moveSelectionFocus("up") && steps < 20) { await remapSettle(); steps++; }
    expect(steps).toBeGreaterThan(0);
    expect(remapRowsOf(lastFrame()).some((l) => stripAnsi(l).trim() === "ROW0")).toBe(true); // truly at the top
    expect(hitmap.current!.moveSelectionFocus("up")).toBe(false); // nothing left to scroll into
  });
});
