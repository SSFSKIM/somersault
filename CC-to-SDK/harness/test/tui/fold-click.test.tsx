// tui/test/fold-click.test.tsx — tool-stream Task 10: the click that actually expands a cluster.
//
// EVERY OTHER PIECE OF THIS CHAIN IS ALREADY PINNED SOMEWHERE ELSE, and deliberately not re-pinned here.
// `keys-parse` owns the SGR decode, `keys-provider` owns the routing to the sink, `fold-expand` owns the
// expansion set and the re-projection, `fold-hitmap` owns the cell→anchor map. What no other file can see is
// the GESTURE and the GATE: whether a press and a release become one tap, and whether that tap is allowed to
// act given what is on screen. Both live in `ChatApp`, so every case below drives the REAL `ChatApp` through
// the REAL provider with RAW SGR BYTES on stdin — there is no seam short of that which would still be
// testing the thing this task built.
//
// GEOMETRY, once, so no case has to derive a row it is then asserting against itself. `rows: 24` →
// `FullscreenFrame` paints 23 rows; the dock (rule / prompt / rule / status) is 4, so the region is terminal
// rows 1–19 and `REGION_TOP_ROW` is 1. Column 3 is where a collapsed cluster's sentence starts, so column 5
// is comfortably inside its painted width and outside nothing. Cases that need a row NUMBER call `rowOf`,
// which reads it out of the frame that was actually painted.
//
// THE TWO DOCUMENTS. `SHORT_DOC` fits the region whole (3 painted rows: prose, the collapsed cluster, prose),
// which keeps every gate case free of scroll arithmetic. `TALL_DOC` overflows it, and exists for exactly one
// case — the wheel discard, which cannot be shown on a document the wheel cannot move.
import React from "react";
import { describe, it, expect } from "vitest";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";
import { SEARCH_PROMPT } from "../../src/tui/historySearchInline.js";

const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
/** OSC-8 hyperlinks wrap a path tool's argument, so an expanded `Read(a.ts)` row is not contiguous text. */
const unlink = (s: string): string => s.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
const clean = (s: string | undefined): string => unlink(plain(s));
const rowsOf = (frame: string | undefined): string[] => clean(frame).split("\n");
const strip = (line: string | undefined): string => (line ?? "").trim();
/** The 1-based terminal row a line is painted on, read out of the frame rather than computed. */
const rowOf = (frame: string | undefined, text: string): number => {
  const at = rowsOf(frame).findIndex((line) => strip(line) === text);
  expect(at, `"${text}" is not painted in:\n${clean(frame)}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};

const sdk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
const call = (id: string, name: string, input: unknown) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `u-${id}`, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content = "body") =>
  sdk({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });
const prose = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });

/** Two contiguous Reads collapse to ONE row under the fullscreen renderer (Tasks 3–5b). */
const CLUSTER: readonly TranscriptBootstrapEntry[] = [
  call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
  call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
];
const SHORT_DOC: readonly TranscriptBootstrapEntry[] = [prose("hello there", "a"), ...CLUSTER, prose("all done", "b")];
const TALL_DOC: readonly TranscriptBootstrapEntry[] = [
  ...Array.from({ length: 30 }, (_, i) => prose(`PAD-${i}`, `p${i}`)),
  ...CLUSTER, prose("tail one", "t1"), prose("tail two", "t2"),
];

/** The collapsed cluster's own sentence, and the sign that it is open instead: an expanded run draws each
 *  member in the FULL listing form, so its two result bodies appear where the one sentence was. The bodies
 *  are what the cases key on rather than the `⏺ Read(a.ts)` headers, because a path tool's header argument
 *  is an OSC-8 hyperlink whose escape bytes are counted by `truncate-end` — so the header row paints as a
 *  cut-off `⏺ Read(a.` at any width. That is a pre-existing rendering artifact of another surface (the
 *  ctrl+o pager shows the identical cut), and this file is not the place to pin or to work around it. */
const COLLAPSED = "Read 2 files";
const MEMBER_BODY = "Read 1 line";
/** How many expanded members are on screen: 0 while the cluster is collapsed, 2 while it is open. */
const openMembers = (frame: string | undefined): number => rowsOf(frame).filter((l) => l.includes(MEMBER_BODY)).length;
/** The first painted row of an OPEN cluster's body — every one carries the same anchor (Task 8 re-tags
 *  them), so it is as good a place to click to close the run as the collapsed row was to open it. */
const memberRow = (frame: string | undefined): number => {
  const at = rowsOf(frame).findIndex((l) => l.includes(MEMBER_BODY));
  expect(at, `no expanded member painted in:\n${clean(frame)}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const COL = 5;                                   // inside the sentence, which starts at column 3
/** The composer's ready prompt — `❯` + U+00A0. Spelled out because a dialog's Select cursor is a bare `❯`
 *  on its own row, so "is the composer on screen" cannot be asked with the glyph alone. */
const PROMPT = "\u276f\u00a0";

// SGR (?1006) button reports, exactly as a terminal sends them: `M` is a press, `m` a release, and the two
// coordinates are 1-based. `mods` is canon's bit set — ctrl 16, meta/alt 8, shift 4.
const press = (col: number, row: number, mods = 0) => `\x1b[<${mods};${col};${row}M`;
const release = (col: number, row: number, mods = 0) => `\x1b[<${mods};${col};${row}m`;
const WHEEL_UP = "\x1b[<64;5;5M";
const WHEEL_DOWN = "\x1b[<65;5;5M";
const CTRL_O = "\x0f";
const ALT_P = "\x1bp";

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
/** Mount, wait for the composer, and settle the frame's two measurement passes. */
async function mount(entries: readonly TranscriptBootstrapEntry[], fake?: ReturnType<typeof fakeRemote>) {
  const s = scene(entries, fake);
  const r = renderWithKeymap(s.ui);
  await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
  await settle();
  return { ...r, fake: s.fake };
}
/** Press and release the same cell, then let the re-projection land. */
async function tap(r: { stdin: { write(s: string): void } }, col: number, row: number, mods = 0) {
  r.stdin.write(press(col, row, mods));
  await tick();
  r.stdin.write(release(col, row, mods));
  await settle();
}

describe("T10 (a)(b): a tap on a collapsed cluster expands it, and a tap on the expanded block collapses it", () => {
  it("expands on the first tap and collapses on the second", async () => {
    const r = await mount(SHORT_DOC);
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);

    await tap(r, COL, foldRow);
    // (a) — both members are on screen in their full form and the summary sentence is gone.
    expect(openMembers(r.lastFrame())).toBe(2);
    expect(clean(r.lastFrame())).not.toContain(COLLAPSED);

    // (b) — the same gesture on a row of the OPEN run closes it again.
    await tap(r, COL, memberRow(r.lastFrame()));
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);
    r.unmount();
  });
});

describe("T10 (c): a release on a DIFFERENT cell is not a tap", () => {
  it("stays collapsed when the button comes up four columns away", async () => {
    const r = await mount(SHORT_DOC);
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);
    // Both cells are inside the SAME row and both resolve to the same anchor — so the only thing that can
    // refuse this gesture is the same-cell rule itself.
    r.stdin.write(press(COL, foldRow));
    await tick();
    r.stdin.write(release(COL + 4, foldRow));
    await settle();
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);

    // …and the anchor it discarded is not still armed: a lone release cannot complete it later either.
    r.stdin.write(release(COL, foldRow));
    await settle();
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    r.unmount();
  });
});

describe("T10 (d): a wheel tick between press and release discards the anchor", () => {
  // THE DOCUMENT HAS TO BE SCROLLABLE FOR THIS CASE TO MEAN ANYTHING. On a document that fits the region the
  // wheel is clamped to a no-op, and a cell built on one would pass whether or not the tick was ever
  // delivered — the same "reproduces the situation without isolating the mechanism" trap the wave has hit
  // before. So the tick is asserted to MOVE the frame here, and it is undone by a second tick in the
  // opposite direction, which puts the cell back under the cursor: the release is at the same cell, over the
  // same anchor, with the page in the same place. Nothing but the discard rule can refuse it.
  it("refuses the tap after a tick, and accepts the identical tap without one", async () => {
    const r = await mount(TALL_DOC);
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);
    expect(clean(r.lastFrame())).toContain("tail two");        // premise: we are stuck to the tail

    r.stdin.write(press(COL, foldRow));
    await tick();
    r.stdin.write(WHEEL_UP);
    await settle();
    expect(rowOf(r.lastFrame(), COLLAPSED), "the wheel must actually reach the viewport").toBe(foldRow + 1);
    r.stdin.write(WHEEL_DOWN);
    await settle();
    expect(rowOf(r.lastFrame(), COLLAPSED)).toBe(foldRow);
    r.stdin.write(release(COL, foldRow));
    await settle();
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);

    // The control: the very same tap, on the very same cell, with no tick in the middle.
    await tap(r, COL, foldRow);
    expect(openMembers(r.lastFrame())).toBe(2);
    r.unmount();
  });
});

describe("T10 (e): an INLINE decision dialog makes the transcript behind it inert", () => {
  // THE CELL THAT FAILS A HAND-BUILT GATE. A parked non-plan decision is exactly the state that
  // `paneOwned` (ChatApp.tsx:930–933, which deliberately excludes it) and `seamActive` (:1224, overlay plus
  // the plan kind only) both answer FALSE for, while `composerOwns(inputOwnerRef.current)` answers
  // "decision" and refuses. The viewport is still mounted underneath — the dock hosts the dialog and the
  // region keeps painting — so the row map is live and the click is stopped by the gate alone.
  it("refuses a tap while a permission consult is parked, and takes it again once answered", async () => {
    const r = await mount(SHORT_DOC);
    r.fake.parkPermission({ sessionId: "s", toolUseID: "t1", toolName: "Bash", kind: "permission",
      input: { command: "rm -rf build" }, createdAt: Date.now() });
    await waitFor(() => clean(r.lastFrame()).includes("rm -rf build"));
    await settle();
    expect(clean(r.lastFrame())).not.toContain(PROMPT);        // the composer is replaced, not merely covered

    // The dialog shrank the region, so the row is looked up again rather than reused.
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);
    await tap(r, COL, foldRow);
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);

    // Answer it, and the same tap works — so the cell is testing a GATE and not a dead click path.
    r.stdin.write("\x1b");                                     // escape declines the consult
    await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
    await settle();
    await tap(r, COL, rowOf(r.lastFrame(), COLLAPSED));
    expect(openMembers(r.lastFrame())).toBe(2);
    r.unmount();
  });

  // …AND THE GATE IS ASKED AT THE RELEASE TOO, not only when the button went down. A consult can arrive
  // between the two halves of a gesture — the model does not wait for the mouse — and a tap that was legal
  // when it started must not act on a transcript that has since stopped being the thing in front of the user.
  it("refuses a tap whose consult arrived between the press and the release", async () => {
    const r = await mount(SHORT_DOC);
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);
    r.stdin.write(press(COL, foldRow));
    await tick();
    r.fake.parkPermission({ sessionId: "s", toolUseID: "t2", toolName: "Bash", kind: "permission",
      input: { command: "rm -rf build" }, createdAt: Date.now() });
    await waitFor(() => clean(r.lastFrame()).includes("rm -rf build"));
    await settle();
    r.stdin.write(release(COL, foldRow));
    await settle();
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);
    r.unmount();
  });
});

describe("T10: the composer's inline reverse-i-search holds the transcript inert too", () => {
  // The one surface the input ROUTER cannot see on its own: ctrl+r's search lives inside the composer, so
  // `inputOwnerRef` still says "composer" while it is up. `footerState.searching` is the composer's own
  // report of it, and it is the same term `FullscreenViewport`'s `Scroll` context is gated on — the keys and
  // the clicks stand down together, which is the only coherent answer while another surface owns the dock.
  it("refuses a tap while ctrl+r is searching, and takes it once the search is closed", async () => {
    const r = await mount(SHORT_DOC);
    r.stdin.write("\x12");                                     // ctrl+r
    await waitFor(() => clean(r.lastFrame()).includes(SEARCH_PROMPT));
    await settle();
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);            // the transcript is still painted above it
    await tap(r, COL, foldRow);
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);

    r.stdin.write("\x1b");                                     // escape accepts and leaves the search
    await waitFor(() => !clean(r.lastFrame()).includes(SEARCH_PROMPT));
    await settle();
    await tap(r, COL, rowOf(r.lastFrame(), COLLAPSED));
    expect(openMembers(r.lastFrame())).toBe(2);
    r.unmount();
  });
});

describe("T10 (f): an open overlay makes the transcript behind it inert", () => {
  // TWO OVERLAYS, AND ONLY THE SECOND ONE CAN FAIL A MISSING GATE — recorded as a finding rather than
  // papered over. The ctrl+o pager REPLACES the viewport in the region (ChatApp.tsx:1204-1208), so its
  // hitmap handle is detached and a tap has nothing to resolve against even with no gate at all; the case
  // stays because it is the spec's own wording and it would catch a future pager that shares the region.
  // The model picker is the one that bites: it is a SEAM surface, the viewport keeps rendering beneath it,
  // and the row map underneath the picker is live and current.
  it("refuses a tap under the ctrl+o pager (guaranteed by the swap, not by the gate)", async () => {
    const r = await mount(SHORT_DOC);
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);            // where the cluster was, before the swap
    r.stdin.write(CTRL_O);
    await waitFor(() => !clean(r.lastFrame()).includes(PROMPT));
    await settle();
    expect(clean(r.lastFrame())).toContain("Transcript lines");  // the pager owns the region now
    await tap(r, COL, foldRow);
    r.stdin.write("\x1b");                                       // close it and look at the transcript again
    await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
    await settle();
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);
    // …and the tap the pager refused lands once it is gone, so the cell is not merely a dead click path.
    await tap(r, COL, rowOf(r.lastFrame(), COLLAPSED));
    expect(openMembers(r.lastFrame())).toBe(2);
    r.unmount();
  });

  it("refuses a tap under the model picker, whose region still paints the transcript", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const r = await mount(SHORT_DOC, fake);
    r.stdin.write(ALT_P);
    await waitFor(() => clean(r.lastFrame()).includes("Opus"));
    await settle();
    const frame = clean(r.lastFrame());
    expect(frame).toContain(COLLAPSED);                         // premise: the map underneath is LIVE
    const foldRow = rowOf(r.lastFrame(), COLLAPSED);
    await tap(r, COL, foldRow);
    expect(clean(r.lastFrame())).toContain(COLLAPSED);
    expect(openMembers(r.lastFrame())).toBe(0);

    r.stdin.write("\x1b");                                      // close the picker…
    await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
    await settle();
    await tap(r, COL, rowOf(r.lastFrame(), COLLAPSED));         // …and the identical tap lands
    expect(openMembers(r.lastFrame())).toBe(2);
    r.unmount();
  });
});

describe("T10 (g): a modified click is not a click", () => {
  it("ignores ctrl+click, alt+click and shift+click on the very cell a bare click expands", async () => {
    for (const mods of [16, 8, 4]) {
      const r = await mount(SHORT_DOC);
      const foldRow = rowOf(r.lastFrame(), COLLAPSED);
      await tap(r, COL, foldRow, mods);
      expect(clean(r.lastFrame()), `mods=${mods}`).toContain(COLLAPSED);
      expect(openMembers(r.lastFrame()), `mods=${mods}`).toBe(0);
      await tap(r, COL, foldRow);                               // the control, on the same mount
      expect(openMembers(r.lastFrame()), `mods=${mods}`).toBe(2);
      r.unmount();
    }
  });
});

describe("T10: the classic renderer is BYTE-IDENTICAL under a burst of mouse reports", () => {
  // WHAT THIS CASE CAN AND CANNOT SAY, stated because the difference matters. Classic is frozen for this
  // wave, and the strongest claim a test can make about a frozen surface is that the frame does not move —
  // so this drives a whole gesture plus wheel ticks a classic terminal would never even send (tracking rides
  // the alt-screen enter sequence, `altScreen.ts`) and asserts the paint is unchanged to the byte.
  //   IT DOES NOT PIN THE GATE'S `fullscreen` TERM, and no case here can. THREE independent facts already
  // make a classic click dead: reporting is never armed, `FullscreenViewport` is not mounted at all so no
  // hitmap handle is attached, and the map's own renderer gate (the published region origin, T9) answers
  // `undefined` for every cell even if one were. Deleting the term from `ChatApp`'s gate leaves this file —
  // and, checked, every other file in `test/tui` — green. It stays for the same reason T9's renderer gate
  // does: it makes "classic has no click path" true BY CONSTRUCTION rather than by three coincidences that
  // a later refactor could each remove without noticing. Recorded as a finding in the Task 10 report.
  it("does not move a pixel for a press, a release or a wheel tick", async () => {
    const fake = fakeRemote();
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "classic", reason: "env_on" }} initialEntries={SHORT_DOC}
        deps={{ columns: () => 80, rows: () => 24 }} />);
    await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
    await settle();
    const foldRow = rowOf(r.lastFrame(), `${COLLAPSED} (ctrl+o to expand)`);
    const before = r.lastFrame();
    await tap(r, COL, foldRow);
    r.stdin.write(WHEEL_UP); r.stdin.write(WHEEL_DOWN);
    await settle();
    expect(r.lastFrame()).toBe(before);                         // raw bytes, escapes included
    expect(openMembers(r.lastFrame())).toBe(0);
    r.unmount();
  });
});
