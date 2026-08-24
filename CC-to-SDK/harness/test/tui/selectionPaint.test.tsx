// test/tui/selectionPaint.test.tsx — F9 T-MOUSE Task 6: selection paint + gesture integration (spec M5's
// paint/gesture halves, canon §2.2's press/drag/release branches, §2.4's `x0p` selection-bg paint, R1
// research). Drives the REAL `ChatApp` through the REAL keymap provider with raw SGR mouse bytes — the same
// harness `hover.test.tsx` (T3) and `clickCaret.test.tsx` (T4) already established for this track, because
// the GESTURE (press/drag/release pairing, multi-click windowing, the click/sweep discriminant) lives in
// `ChatApp`'s one tap machine and the PAINT lives in `FullscreenViewport`/`Line.tsx` — neither is reachable
// by a unit test that stops at T5's pure `selection.ts`.
//
// NO key-lifetime rules, NO copyOnSelect anything here (Task 7 owns everything that setting gates) — this
// file only proves the highlight appears, stays, and moves correctly, and that the existing click targets
// (fold toggle, composer caret) are untouched by a gesture that never became a sweep.
//
// F9 T-MOUSE TASK 7 ADDED THE MOCK BELOW, retroactively. Task 7 wires a REAL selection release to a REAL
// `copyText()` call (the auto-copy latch, default `copyOnSelect: true`) — a call this file's own scenarios
// now reach (T6 (f)'s triple-click, T6 (h)'s re-press-after-a-sweep) without ever intending to exercise it.
// Unmocked, that call spawns a REAL native clipboard tool and then writes a REAL OSC 52 escape sequence
// through Ink's `useStdout().write` — a raw, out-of-band write `ink-testing-library`'s `lastFrame()` cannot
// tell apart from the frame it renders, so it corrupts every assertion below that runs after a release. The
// mock keeps this file's own claims (paint, gesture wiring) independent of Task 7's — exactly as
// `copyChannels.test.ts`/`autoCopy.test.tsx` keep Task 7's independent of this file's.
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";
import { themeTokens, setTheme } from "../../src/tui/theme.js";
import type { CopyResult } from "../../src/tui/copy.js";

const copyTextMock = vi.fn<(text: string, deps?: unknown) => Promise<CopyResult>>();
vi.mock("../../src/tui/copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tui/copy.js")>();
  return { ...actual, copyText: (text: string, deps?: unknown) => copyTextMock(text, deps) };
});
beforeEach(() => { copyTextMock.mockReset(); copyTextMock.mockResolvedValue({ channel: "native", oscBytes: null }); });

afterEach(() => { setTheme("auto"); vi.unstubAllEnvs(); });

// ── frame helpers, `hover.test.tsx`'s own idiom ────────────────────────────────────────────────────────
const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const unlink = (s: string): string => s.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
const clean = (s: string | undefined): string => unlink(plain(s));
const rowsOf = (frame: string | undefined): string[] => clean(frame).split("\n");
const rawLineIncluding = (frame: string | undefined, needle: string): string =>
  (frame ?? "").split("\n").find((l) => clean(l).includes(needle)) ?? "";
const rowOfIncluding = (frame: string | undefined, needle: string): number => {
  const at = rowsOf(frame).findIndex((l) => l.includes(needle));
  expect(at, `no row contains "${needle}" in:\n${clean(frame)}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const sgrBg = (rgbToken: string): string => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgbToken)!;
  return `\x1b[48;2;${m[1]};${m[2]};${m[3]}m`;
};
// The exact bytes chalk emits for a `backgroundColor` prop, and the exact bytes it closes with — probed
// live against this repo's `ink-testing-library` (adjacent same-styled `<Text>` siblings MERGE into one
// contiguous SGR run, and the close is always literal `\x1b[49m`), so a selected substring can be matched by
// simple byte-string containment rather than a full ANSI parse.
const SEL_BG = sgrBg(themeTokens().selectionBg);
const RESET_BG = "\x1b[49m";

const sdk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
const call = (id: string, name: string, input: unknown) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `u-${id}`, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content = "body") =>
  sdk({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });
const prose = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });
const CLUSTER: readonly TranscriptBootstrapEntry[] = [
  call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
  call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
];
const COLLAPSED = "Read 2 files";
const MEMBER_BODY = "Read 1 line";
const COL = 5;
const PROMPT = "❯ ";

const press = (col: number, row: number) => `\x1b[<0;${col};${row}M`;
const release = (col: number, row: number) => `\x1b[<0;${col};${row}m`;
const drag = (col: number, row: number) => `\x1b[<32;${col};${row}M`;
const WHEEL_UP = "\x1b[<64;5;5M";
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const scene = (entries: readonly TranscriptBootstrapEntry[], fake = fakeRemote()) => ({
  fake,
  ui: <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
    renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={entries}
    deps={{ columns: () => 80, rows: () => 24 }} />,
});
async function mount(entries: readonly TranscriptBootstrapEntry[], fake?: ReturnType<typeof fakeRemote>) {
  const s = scene(entries, fake);
  const r = renderWithKeymap(s.ui);
  await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
  await settle();
  return { ...r, fake: s.fake };
}
async function tap(r: { stdin: { write(s: string): void } }, col: number, row: number) {
  r.stdin.write(press(col, row));
  await tick();
  r.stdin.write(release(col, row));
  await settle();
}

describe("T6 (a): a drag paints the selected column span with selectionBg, gutter unpainted", () => {
  it("presses, drags to a later column on the same row, and paints exactly the swept text", async () => {
    // Assistant prose carries a 3-column "⏺ " gutter ahead of the text (the bullet itself measures
    // width 2, `string-width`): "click " lands cols 4-9 (unselected), "select" cols 10-15 (to be
    // swept), " target word" (unselected).
    const DOC = [prose("click select target word", "a")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    r.stdin.write(press(10, row));
    await tick();
    r.stdin.write(drag(15, row));
    await settle();
    const painted = rawLineIncluding(r.lastFrame(), "click select");
    expect(painted).toContain(`${SEL_BG}select${RESET_BG}`);
    // The unswept text on the same row carries no selection background at all.
    expect(painted).not.toContain(`${SEL_BG}click`);
    r.unmount();
  });
});

describe("T6 (b): a plain click paints nothing, and still expands a fold / moves the caret", () => {
  it("a press+release on the same cell (no drag) leaves the frame free of selectionBg", async () => {
    const DOC = [prose("hello there", "a"), ...CLUSTER, prose("all done", "b")];
    const r = await mount(DOC);
    const clusterRow = rowOfIncluding(r.lastFrame(), COLLAPSED);
    await tap(r, COL, clusterRow);
    // The click toggled the fold — the existing T10 gesture, unaffected by this task's wiring.
    const memberRow = rowOfIncluding(r.lastFrame(), MEMBER_BODY);
    expect(rawLineIncluding(r.lastFrame(), MEMBER_BODY)).not.toContain(SEL_BG);
    expect(memberRow).toBeGreaterThan(0);
    r.unmount();
  });
});

describe("T6 (c): release keeps the highlight", () => {
  it("the swept text is still painted after the button lifts", async () => {
    const DOC = [prose("click select target word", "a")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    r.stdin.write(press(10, row));
    await tick();
    r.stdin.write(drag(15, row));
    await tick();
    r.stdin.write(release(15, row));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "click select")).toContain(`${SEL_BG}select${RESET_BG}`);
    r.unmount();
  });
});

describe("T6 (d): a wheel tick during a drag discards the selection cleanly", () => {
  it("removes the highlight and leaves the row byte-plain once the wheel turns", async () => {
    const DOC = [prose("click select target word", "a")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    r.stdin.write(press(10, row));
    await tick();
    r.stdin.write(drag(15, row));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "click select")).toContain(SEL_BG);           // premise
    r.stdin.write(WHEEL_UP);
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "click select")).not.toContain(SEL_BG);
    // The button never lifted in this test, but the discard must be immediate, not wait for a release.
    r.unmount();
  });
});

describe("T6 (e): drag across a soft-wrap boundary paints both rows", () => {
  it("a message that wraps into two rows gets a span on each row the drag crosses", async () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    const DOC = [prose("intro line", "a"), prose(words, "b"), prose("outro line", "c")];
    const r = await mount(DOC);
    const row1 = rowOfIncluding(r.lastFrame(), "w0 w1");
    const row2 = rowOfIncluding(r.lastFrame(), "w29");
    expect(row2).toBe(row1 + 1);                      // premise: exactly two wrap rows, adjacent
    r.stdin.write(press(4, row1));
    await tick();
    r.stdin.write(drag(5, row2));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "w0 w1")).toContain(SEL_BG);
    expect(rawLineIncluding(r.lastFrame(), "w29")).toContain(SEL_BG);
    r.unmount();
  });
});

describe("T6 (f): double-click paints the word span, triple-click the line", () => {
  it("a second press within the multi-click window selects exactly the word under it", async () => {
    const DOC = [prose("click select target word", "a")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await tap(r, 12, row);                             // first click — inside "select" — a plain click first
    r.stdin.write(press(12, row));                      // second press, same cell, well within 500ms
    await settle();
    const painted = rawLineIncluding(r.lastFrame(), "click select");
    expect(painted).toContain(`${SEL_BG}select${RESET_BG}`);
    expect(painted).not.toContain(`${SEL_BG}click`);
    expect(painted).not.toContain(`${SEL_BG} target`);
    r.stdin.write(release(12, row));
    await settle();
    r.unmount();
  });

  it("a third press within the window selects the whole logical line", async () => {
    const DOC = [prose("short line here", "a")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "short line here");
    await tap(r, 4, row);
    r.stdin.write(press(4, row));
    await tick();
    r.stdin.write(release(4, row));
    await tick();
    r.stdin.write(press(4, row));                       // third press — triple click
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "short line here")).toContain(`${SEL_BG}short line here${RESET_BG}`);
    r.stdin.write(release(4, row));
    await settle();
    r.unmount();
  });
});

describe("T6 (g): dead under scroll/off — a drag paints nothing", () => {
  it("leaves the row byte-identical to before the gesture under CLAUDE_CODE_DISABLE_MOUSE_CLICKS", async () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_MOUSE_CLICKS", "1");
    const DOC = [prose("click select target word", "a")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    const before = rawLineIncluding(r.lastFrame(), "click select");
    r.stdin.write(press(10, row));
    await tick();
    r.stdin.write(drag(15, row));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "click select")).toBe(before);
    r.unmount();
  });

  it("leaves the row byte-identical to before the gesture under CLAUDE_CODE_DISABLE_MOUSE", async () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_MOUSE", "1");
    const DOC = [prose("click select target word", "a")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    const before = rawLineIncluding(r.lastFrame(), "click select");
    r.stdin.write(press(10, row));
    await tick();
    r.stdin.write(drag(15, row));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "click select")).toBe(before);
    r.unmount();
  });
});

// ── TASK REVIEW IMPORTANT FINDING ───────────────────────────────────────────────────────────────────────
//
// Constraint #2 ("release with `hasSelection()===true` does not fold-toggle or caret-move") is implemented
// correctly in `ChatApp.tsx` (`if (sweeping) return;`, read before the fold/caret fall-through) but was
// UNPINNED: disabling that line left the entire 4026-test suite green. The gap is specific, not general —
// every existing drag test (T6 a/c/d/e above) already releases SAFELY regardless of this line, because
// `ChatApp`'s tap machine clears its own `tapAnchorRef` (`at`) on every "drag" report and only a "press"
// ever re-arms it; by the time a real drag's release fires, `at` is already `null`, so the PRE-EXISTING
// `if (!at || at.col !== e.col || …) return;` guard below it refuses the fold/caret branch on its own — the
// line under test never gets a chance to matter. The one shape that reaches it is a completed sweep whose
// FINAL press (not drag) lands on the addressable cell being released: `multiClickSelectionAt` (fired from
// the press branch) both sets `hasSelection()` true AND re-arms `tapAnchorRef` at that exact cell, so a
// release there is the one case where the mutated line's absence is actually observable — a real drag away
// and back (or a double-click) is what does this in practice, but no such gesture existed here for a fold
// row or the composer. Both cases below drive: press → drag to a different cell (a genuine sweep) → a
// SECOND press back on the original cell (which resolves as a multi-click continuation, not a fresh press,
// re-arming `at` there while leaving the sweep's `hasSelection()===true` state untouched) → release on that
// same cell — the exact shape the mutation escapes without.
describe("T6 (h): review Important — a swallowed sweep does not toggle a fold it lands back on", () => {
  it("press, drag away, re-press the fold cell, release there: stays collapsed and still paints", async () => {
    const DOC = [prose("hello there", "a"), ...CLUSTER, prose("all done", "b")];
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), COLLAPSED);
    r.stdin.write(press(COL, row));
    await tick();
    r.stdin.write(drag(COL + 10, row));                 // a real sweep away from the fold cell
    await tick();
    r.stdin.write(press(COL, row));                      // re-press the SAME cell within the multi-click
    // window — reads as a double-click continuation (re-arms `at`, leaves the sweep's `hasSelection()` true)
    // rather than a fresh press, which would instead wipe the sweep via `startSelectionAt`.
    await settle();
    r.stdin.write(release(COL, row));
    await settle();
    // The fold must NOT have toggled...
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(clean(r.lastFrame())).not.toContain(MEMBER_BODY);
    // ...and the completed sweep must still be visibly painted.
    expect(rawLineIncluding(r.lastFrame(), COLLAPSED)).toContain(SEL_BG);
    r.unmount();
  });
});

function composerOrigin(frame: string | undefined, needle: string): { row: number; textCol: number } {
  const rows = rowsOf(frame);
  const idx = rows.findIndex((l) => l.includes(needle));
  expect(idx, `"${needle}" is not painted in:\n${clean(frame)}`).toBeGreaterThanOrEqual(0);
  return { row: idx + 1, textCol: rows[idx]!.indexOf(needle) + 1 };
}

describe("T6 (j) / F10 S2: a drag after a double click extends by whole words", () => {
  // Assistant prose's own 3-column "⏺ " gutter (T6 (a)'s convention) puts "alpha beta gamma"'s text at
  // col 4: alpha cols 4-8, a space at col 9, beta cols 10-13, a space at col 14, gamma cols 15-19.
  const DOC = [prose("alpha beta gamma", "a")];

  it("double-press on `alpha`, drag into `gamma`: all three words paint, and the toast counts the whole text", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "alpha beta gamma");
    await tap(r, 6, row);                               // first click — inside "alpha" — a plain click first
    r.stdin.write(press(6, row));                        // second press, same cell, well within 500ms
    await settle();
    r.stdin.write(drag(17, row));                        // inside "gamma"
    await settle();
    const painted = rawLineIncluding(r.lastFrame(), "alpha beta gamma");
    expect(painted).toContain(`${SEL_BG}alpha beta gamma${RESET_BG}`);
    r.stdin.write(release(17, row));
    await waitFor(() => clean(r.lastFrame()).includes("copied 16 chars to clipboard")); // "alpha beta gamma".length === 16
    r.unmount();
  });

  it("double-press on `beta` (mid-span pivot), drag into `gamma`: the pivot's own lo through gamma's hi", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "alpha beta gamma");
    await tap(r, 11, row);                               // first click — inside "beta"
    r.stdin.write(press(11, row));                        // second press — double-click
    await settle();
    r.stdin.write(drag(17, row));                         // inside "gamma"
    await settle();
    const painted = rawLineIncluding(r.lastFrame(), "alpha beta gamma");
    // Pivoting on `beta` (not `alpha`) means the selection runs from beta's OWN low end through gamma's high
    // end — "beta gamma", not all three words (the pure test's own first cell asserts this same shape as
    // `colStart:7, colEnd:17`); "alpha " stays unselected.
    expect(painted).toContain(`${SEL_BG}beta gamma${RESET_BG}`);
    expect(painted).not.toContain(`${SEL_BG}alpha`);
    r.stdin.write(release(17, row));
    await settle();
    r.unmount();
  });

  it("the triple-click twin: triple-click one row, drag down one row, and both rows fully paint", async () => {
    const twoRows = [prose("first line here", "x"), prose("second line here", "y")];
    const r = await mount(twoRows);
    const row1 = rowOfIncluding(r.lastFrame(), "first line here");
    const row2 = rowOfIncluding(r.lastFrame(), "second line here");
    await tap(r, 6, row1);
    r.stdin.write(press(6, row1));
    await tick();
    r.stdin.write(release(6, row1));
    await tick();
    r.stdin.write(press(6, row1));                        // third press — triple click
    await settle();
    r.stdin.write(drag(6, row2));                         // drag down into the second message's own row
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "first line here")).toContain(`${SEL_BG}first line here${RESET_BG}`);
    expect(rawLineIncluding(r.lastFrame(), "second line here")).toContain(`${SEL_BG}second line here${RESET_BG}`);
    r.stdin.write(release(6, row2));
    await settle();
    r.unmount();
  });
});

describe("T6 (i): review Important — a swallowed sweep does not move the composer caret it lands back on", () => {
  it("press, drag away, re-press the composer cell, release there: typing still appends at the end", async () => {
    const r = await mount([]);
    r.stdin.write("abcdef");
    await waitFor(() => clean(r.lastFrame()).includes("abcdef"));
    await settle();
    const { row, textCol } = composerOrigin(r.lastFrame(), "abcdef");
    const col = textCol + 3;                            // would read "abc|def" if the caret actually moved
    r.stdin.write(press(col, row));
    await tick();
    r.stdin.write(drag(col + 10, row));
    await tick();
    r.stdin.write(press(col, row));
    await settle();
    r.stdin.write(release(col, row));
    await settle();
    r.stdin.write("X");
    await waitFor(() => clean(r.lastFrame()).includes("abcdefX"));
    expect(clean(r.lastFrame())).toContain("abcdefX");
    expect(clean(r.lastFrame())).not.toContain("abcXdef");
    r.unmount();
  });
});
