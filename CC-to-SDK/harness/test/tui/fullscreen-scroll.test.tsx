// tui/test/fullscreen-scroll.test.tsx — FSW Task 11: the scroll keys, the jump pill, and Ctrl-O in the frame.
//
// Task 10 gave the fullscreen region a virtual window over the whole document and a write-only handle to move
// it. Nothing pressed that handle. This file is the keyboard and the affordance that make the window reachable:
//
//   1. THE `Scroll` CONTEXT drives the viewport's own handle — PgUp/PgDn a HALF region (canon's handlers move
//      `floor(getViewportHeight()/2)` despite the action name, 446159-446174), ctrl+home/ctrl+end top and
//      bottom, and the whole context deactivates while a history search owns the dock (`isActive: t && !cbr()`,
//      446211). The half-page distance is pinned at 37 and 19 rows — the two ODD geometries, where the old
//      `Math.round` arithmetic moved one row further down than up and the round trip did not close.
//   2. THE JUMP PILL is the way back. It is the only affordance a scrolled-up user has on a screen with no
//      scrollbar and no scrollback, and its row is PAID FOR out of the window rather than floated over it:
//      Ink has no absolute positioning inside the region, so a flow row that was not subtracted fails SILENTLY
//      rather than loudly — the frame re-measures only when the FRAME re-renders and a scroll is viewport-local
//      state, so the diagnostic never looks and the frame's clip just eats the last row, the pill's own.
//   3. CTRL-O MOUNTS IN THE REGION, not in the dock. On the main screen the pager takes the composer's slot
//      because the transcript above it is in scrollback; in the frame the region IS the transcript, so the
//      pager replaces it and takes the region's grant as its budget instead of `rows − 10`.
import React from "react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FullscreenViewport } from "../../src/tui/FullscreenViewport.js";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { RegionPager, pagerChromeRows } from "../../src/tui/RegionPager.js";
import { jumpPillText } from "../../src/tui/JumpPill.js";
import { dumpDir } from "../../src/tui/transcriptDump.js";
import { createAltScreenGuard, ENTER_ALT, EXIT_ALT, MOUSE_ON_FULL } from "../../src/tui/altScreen.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { YANK_HINT_TEXT } from "../../src/tui/ChatComposer.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";

const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
const strip = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();
const NO_ITEMS: readonly RenderItem[] = [];
const NO_LINES: readonly RenderLine[] = [];
const doc = (n: number, tag = "L"): readonly RenderItem[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "line" as const, id: `${tag}${i}`, line: { text: `${tag}${i}` } }));
const band = (n: number, tag: string) => (
  <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`${tag}${i}`}</Text>)}</Box>
);
const view = (props: Partial<React.ComponentProps<typeof FullscreenViewport>> = {}) => (
  <FullscreenViewport finalizedItems={NO_ITEMS} pendingItems={NO_ITEMS} streaming={NO_LINES} columns={80} {...props} />
);
const PROMPT = "❯ ";
/** The frame converges over two passive-effect passes (T10 §4): measure the grant, then re-measure content
 *  against it. Anything asserting `onOverflow` must settle twice, not once. */
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

// The four keys, as the bytes a terminal actually sends. `ctrl+home`/`ctrl+end` arrive as CSI with xterm's
// `1;5` modifier param — Ink's `useInput` cannot tell either of them from insert or F1 (P86 §1.1), which is
// why the byte parser exists and why these two are bindable at all.
const PAGE_UP = "\x1b[5~", PAGE_DOWN = "\x1b[6~", CTRL_HOME = "\x1b[1;5H", CTRL_END = "\x1b[1;5F";
// FSW BACKLOG 5 — and the two the POINTER sends, once the guard arms `?1000h ?1006h` with the screen. The
// report is `CSI < button ; col ; row M`; 64/65 are the vertical wheel ticks (canon `RUu`, L169140).
const WHEEL_UP = "\x1b[<64;40;12M", WHEEL_DOWN = "\x1b[<65;40;12M";

describe("the Scroll context drives the fullscreen viewport", () => {
  /** Mount the viewport alone under the root keymap and hand back a key writer. */
  const mount = async (props: Partial<React.ComponentProps<typeof FullscreenViewport>> = {}) => {
    const r = renderWithKeymap(view({ finalizedItems: doc(200), ...props }));
    await tick();                                   // the provider subscribes to stdin in a passive effect
    const press = async (bytes: string) => { r.stdin.write(bytes); await tick(); };
    return { ...r, press, top: () => strip(rowsOf(r.lastFrame())[0]) };
  };

  // THE ACCEPTANCE PIN, at both odd geometries. 37 is the default 80x40 frame's real grant (39 frame rows
  // minus a two-row dock) and 19 is the same arithmetic at 20 rows. Odd is the discriminating case: under the
  // old `Math.round(n * height)` a half page DOWN moved `round(18.5) = 19` while a half page UP moved
  // `round(-18.5) = -18`, so the pair below did not return to L163 and the up/down distances differed by one.
  it.each([[37, 18], [19, 9]])("PgUp/PgDn move floor(%i/2) = %i rows in BOTH directions", async (rows, half) => {
    const r = await mount({ rows });
    const bottom = 200 - rows;
    expect(r.top()).toBe(`L${bottom}`);
    await r.press(PAGE_UP);
    expect(r.top()).toBe(`L${bottom - half}`);
    await r.press(PAGE_UP);
    expect(r.top()).toBe(`L${bottom - 2 * half}`);   // the second move is the same distance as the first
    await r.press(PAGE_DOWN);
    expect(r.top()).toBe(`L${bottom - half}`);
    await r.press(PAGE_DOWN);
    expect(r.top()).toBe(`L${bottom}`);              // …and the round trip closes exactly where it began
    r.unmount();
  });

  it("ctrl+home goes to the first row and ctrl+end comes back to the tail", async () => {
    const r = await mount({ rows: 37 });
    await r.press(CTRL_HOME);
    expect(r.top()).toBe("L0");
    await r.press(CTRL_END);
    expect(r.top()).toBe("L163");
    r.unmount();
  });

  // `scroll:bottom` is canon's `scrollToBottom()` (L434930) — it RE-STICKS as well as re-deriving, which is
  // the difference between "show me the tail" and "follow the tail". A ctrl+end that only moved the offset
  // would strand the viewport at the bottom refusing to follow the next streamed row.
  it("ctrl+end re-sticks, so the viewport follows the next append", async () => {
    const r = await mount({ rows: 10 });
    await r.press(PAGE_UP);
    expect(r.top()).toBe("L185");
    await r.press(CTRL_END);
    r.rerender(view({ finalizedItems: doc(201), rows: 10 }));
    expect(r.top()).toBe("L191");                    // 201 − 10: followed, so ctrl+end re-stuck
    r.unmount();
  });

  // ── FSW BACKLOG 5 — THE WHEEL, WHICH IS THE ONLY GESTURE MOST USERS WILL TRY FIRST ──────────────────────
  // Owner-reported: in fullscreen the wheel walked prompt HISTORY. Nothing armed mouse reporting, so the
  // terminal's alternate-scroll fallback turned every tick into a bare arrow key and the composer read it as
  // a history step. With `?1000h ?1006h` armed by the guard the terminal sends SGR reports instead, and this
  // context is where they land: ONE LINE per tick, canon's own delta (L181212 dispatches ±1).
  it("a wheel tick moves the window exactly one row, in both directions", async () => {
    const r = await mount({ rows: 37 });
    expect(r.top()).toBe("L163");
    await r.press(WHEEL_UP);
    expect(r.top()).toBe("L162");
    await r.press(WHEEL_UP);
    expect(r.top()).toBe("L161");
    await r.press(WHEEL_DOWN);
    expect(r.top()).toBe("L162");
    r.unmount();
  });

  // The modifier bits ride the report (canon masks them off the button byte before naming the key), and a
  // ctrl-wheel is a DIFFERENT key spec — `ctrl+wheelup` — which this context does not bind. Nothing moves,
  // and nothing is invented: zoom is the terminal's gesture, not ours.
  it("a modified wheel tick is not this context's key", async () => {
    const r = await mount({ rows: 37 });
    await r.press("\x1b[<80;40;12M");                // ctrl+wheelup
    expect(r.top()).toBe("L163");
    r.unmount();
  });

  // Canon binds the whole context with `isActive: t && !cbr()` (446211). While a history search owns the dock
  // its own PgUp/PgDn are the ones that must fire, and the transcript behind it must hold still.
  it("is disabled while a history search is open", async () => {
    const r = await mount({ rows: 37, historySearchOpen: true });
    expect(r.top()).toBe("L163");
    await r.press(PAGE_UP);
    expect(r.top()).toBe("L163");
    await r.press(WHEEL_UP);                          // …and the wheel goes with it, for the same reason
    expect(r.top()).toBe("L163");
    r.unmount();
  });
});

// FSW TASK 12 — `v`, THE SCROLLBACK ESCAPE HATCH, AND THE ONE THING IT MAY NOT COST.
//
// Fullscreen quit takes the conversation's terminal record with it, so the dump is how a user keeps a copy.
// The binding lives in the `Scroll` context (plan review I5) and it is a PRINTABLE key — the only one in that
// block — while `Scroll` is the BACKGROUND context of a renderer whose composer is live in the dock below.
// Resolution walks the composer's `Chat` context first, finds no `v` there, and lands on `Scroll`: so a
// naively-registered handler eats the letter out of every word the user types.
//
// The gate is REACHABILITY, not the table: `KeymapProvider` falls a matched action with NO registered handler
// through to the fallback (`KeymapProvider.tsx:177-180`), so the viewport registers `scroll:dumpTranscript`
// only while the jump pill is up — i.e. exactly when the screen is telling the reader they are scrolled off
// the tail — and `v` types normally the rest of the time. That is canon's own shape reached by another route:
// canon's `v` (L549336) lives on a transcript SCREEN with no composer at all (`zPe = lr === "transcript"`).
describe("v dumps the transcript, without eating the letter", () => {
  const items = doc(200);
  it("fires the dump once the viewport is scrolled off the bottom", async () => {
    const dump = vi.fn();
    const r = renderWithKeymap(view({ finalizedItems: items, rows: 10, onDumpTranscript: dump }));
    await tick();
    r.stdin.write("v"); await tick();
    expect(dump).not.toHaveBeenCalled();                              // sticky: the key is not ours
    r.stdin.write(PAGE_UP); await tick();
    r.stdin.write("v"); await tick();
    expect(dump).toHaveBeenCalledTimes(1);
    r.stdin.write(CTRL_END); await tick();
    r.stdin.write("v"); await tick();
    expect(dump).toHaveBeenCalledTimes(1);                            // re-stuck: handed back again
    r.unmount();
  });

  // The pill's OTHER half is deliberately part of the gate. A content shrink can leave the viewport unstuck
  // with the tail nevertheless on screen; the pill stays off there (nothing to jump to) and so does the dump,
  // because "the screen says you are scrolled away" is the whole rule.
  it("hands the key back when the pill goes away under a shrink", async () => {
    const dump = vi.fn();
    const r = renderWithKeymap(view({ finalizedItems: items, rows: 10, onDumpTranscript: dump }));
    await tick();
    r.stdin.write(PAGE_UP); await tick();
    r.rerender(view({ finalizedItems: doc(20), rows: 10, onDumpTranscript: dump }));
    r.stdin.write("v"); await tick();
    expect(dump).not.toHaveBeenCalled();
    r.unmount();
  });
});

describe("the jump pill", () => {
  // The label picker is canon's `[sIr, Ehf, Ybt].find(v => Ut(v) <= columns - 2) ?? Ybt` (456166-456171):
  // three variants, longest first, and the ARROW is part of the first two — `${base} (${chord}) ↓`, then
  // `${base} ↓`, then the bare base as both the shortest variant and the unconditional fallback.
  describe("jumpPillText", () => {
    it("names the destination when nothing new has arrived, and suffixes the resolved key and the arrow", () =>
      expect(jumpPillText(0, "ctrl+end", 80)).toBe(" Jump to bottom (ctrl+end) ↓ "));
    it("counts what arrived while you were away, singular and plural", () => {
      expect(jumpPillText(1, "ctrl+end", 80)).toBe(" 1 new message (ctrl+end) ↓ ");
      expect(jumpPillText(12, "ctrl+end", 80)).toBe(" 12 new messages (ctrl+end) ↓ ");
    });
    it("drops the chord, then the arrow, as the terminal narrows", () => {
      expect(jumpPillText(0, "ctrl+end", 20)).toBe(" Jump to bottom ↓ ");
      expect(jumpPillText(0, "ctrl+end", 19)).toBe(" Jump to bottom ");
    });
    // Canon has no bare-arrow variant: below the shortest variant's width it returns `Ybt` anyway and lets
    // `wrap:"truncate-end"` clip it, which is what the pill's `<Text>` now does too.
    it("keeps the words rather than inventing an arrow-only pill when nothing fits", () =>
      expect(jumpPillText(0, "ctrl+end", 10)).toBe(" Jump to bottom "));
    it("prints no empty parenthesis when the action is unbound", () =>
      expect(jumpPillText(0, "", 80)).toBe(" Jump to bottom ↓ "));
  });

  // `qqH` (455869-455878): shown only when the viewport is NOT sticky and NOT at the end. Both halves matter —
  // the sticky half keeps it off a following transcript, and the at-end half keeps it off the degenerate state
  // a content shrink leaves behind (offset held past the new bottom, so the tail IS on screen unstuck).
  it("stays off a sticky viewport and appears the moment the user scrolls off the bottom", async () => {
    const r = renderWithKeymap(view({ finalizedItems: doc(200), rows: 10 }));
    await tick();
    expect(r.lastFrame()).not.toContain("Jump to bottom");
    expect(rowsOf(r.lastFrame())).toHaveLength(10);

    r.stdin.write(PAGE_UP);
    await tick();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(10);                                   // still exactly the ten rows granted
    expect(strip(lines[9])).toBe("Jump to bottom (ctrl+end) ↓");
    r.unmount();
  });

  it("goes away again on ctrl+end", async () => {
    const r = renderWithKeymap(view({ finalizedItems: doc(200), rows: 10 }));
    await tick();
    r.stdin.write(PAGE_UP); await tick();
    expect(r.lastFrame()).toContain("Jump to bottom");
    r.stdin.write(CTRL_END); await tick();
    expect(r.lastFrame()).not.toContain("Jump to bottom");
    r.unmount();
  });

  // A viewport that is unstuck and yet showing the last row: scroll up, then shrink the document under the
  // held offset. `pageItemSlices` clamps the paint to the new bottom, so the tail is on screen — and a pill
  // offering to take you somewhere you already are is noise.
  it("stays off an unstuck viewport that is nevertheless at the end", async () => {
    const r = renderWithKeymap(view({ finalizedItems: doc(200), rows: 10 }));
    await tick();
    r.stdin.write(PAGE_UP); await tick();
    expect(r.lastFrame()).toContain("Jump to bottom");
    r.rerender(view({ finalizedItems: doc(20), rows: 10 }));
    expect(r.lastFrame()).not.toContain("Jump to bottom");
    expect(rowsOf(r.lastFrame())).toEqual(Array.from({ length: 10 }, (_, i) => `L${10 + i}`));
    r.unmount();
  });

  // THE COUNT'S DERIVATION. The viewport's document is PHYSICAL ROWS — nothing in it knows where one message
  // ends — so "N new" is the growth in `total` since stickiness was last held. Recorded divergence: canon
  // counts messages, we count the rows they contribute.
  it("counts the rows that arrived while the viewport was scrolled up, and forgets them on re-stick", async () => {
    const r = renderWithKeymap(view({ finalizedItems: doc(200), rows: 10 }));
    await tick();
    r.stdin.write(PAGE_UP); await tick();
    expect(strip(rowsOf(r.lastFrame())[9])).toBe("Jump to bottom (ctrl+end) ↓");

    r.rerender(view({ finalizedItems: doc(203), rows: 10 }));
    expect(strip(rowsOf(r.lastFrame())[9])).toBe("3 new messages (ctrl+end) ↓");
    expect(strip(rowsOf(r.lastFrame())[0])).toBe("L185");             // …and the window did not move for them

    r.stdin.write(CTRL_END); await tick();
    r.rerender(view({ finalizedItems: doc(206), rows: 10 }));
    r.stdin.write(PAGE_UP); await tick();
    expect(strip(rowsOf(r.lastFrame())[9])).toBe("Jump to bottom (ctrl+end) ↓");  // the count reset on re-stick
    r.unmount();
  });
});

describe("the pill's row is paid for out of the region, not floated over it", () => {
  // THE INVARIANT TASK 10 ESTABLISHED, under the one thing that can break it. Ink has no absolute positioning
  // inside the region, so the pill is an ordinary flow row and the viewport subtracts it from `height` before
  // slicing.
  //   THE FAILURE MODE IS QUIETER THAN THE T10 REVIEW EXPECTED, which is why the row assertions below matter
  // as much as the spy. Mutating the subtraction away does NOT fire `onOverflow`: the frame re-measures in an
  // effect that runs when the FRAME re-renders, and a scroll is viewport-local state, so the frame never looks.
  // The region emits `grant + 1`, the frame's clip silently eats the last row — the pill — and the frame is
  // still 39 rows with the diagnostic still silent. Measured, and this case reddens on the pill's absence.
  it("keeps a scrolled-up frame at its granted rows, with the diagnostic silent", async () => {
    const overflow = vi.fn();
    const r = renderWithKeymap(
      <FullscreenFrame rows={40} onOverflow={overflow} dock={band(2, "D")}
        regionChildren={view({ finalizedItems: doc(200) })} />,
    );
    await settle();
    expect(rowsOf(r.lastFrame())).toHaveLength(39);
    expect(overflow).not.toHaveBeenCalled();

    r.stdin.write(PAGE_UP);
    await settle();
    // THE HEADLINE CLAIM FIRST, because it is the one a clip can hide: the frame is 39 rows either way, so a
    // region that emitted 38 would look identical here and only the diagnostic would say otherwise.
    expect(overflow).not.toHaveBeenCalled();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(39);                                    // 37 granted + the two dock rows
    expect(lines[0]).toBe("L145");                                     // 163 − floor(37/2)
    expect(strip(lines[35])).toBe("L180");                             // 36 transcript rows…
    expect(strip(lines[36])).toBe("Jump to bottom (ctrl+end) ↓");      // …and the pill on the region's last
    expect(lines.slice(37)).toEqual(["D0", "D1"]);                     // the dock did not move
    r.unmount();
  });
});

describe("Ctrl-O mounts inside the frame", () => {
  const items = (n: number): readonly RenderItem[] => doc(n, "T");

  /** `ink-testing-library`'s stdout stub reports 100 columns, which is the width the frames below are laid
   *  out at — so the chrome estimate has to be given the same number the renderer used. */
  const COLS = 100;

  // The hint row is what makes the chrome width-dependent, and it wraps at every width anyone actually uses.
  // A flat four-row guess cost one row and Ink composited the title onto the first body row (`T167script`).
  it("counts the hint's wrap into the chrome", () => {
    expect(pagerChromeRows(100)).toBe(5);            // border 2 + title 1 + a hint that wraps to two
    expect(pagerChromeRows(80)).toBe(5);
    expect(pagerChromeRows(200)).toBe(4);            // …one row once the hint fits on a line
  });

  // The pager's height budget is the REGION's grant, not `rows − 10`: inside the frame the terminal's row
  // count is not the pager's to spend, because the dock has already taken its share.
  it("sizes the pager to the region's grant and never overruns it", async () => {
    const overflow = vi.fn();
    const r = renderWithKeymap(
      <FullscreenFrame rows={40} onOverflow={overflow} dock={band(2, "D")}
        regionChildren={<RegionPager makeItems={() => items(200)} onClose={() => {}} columns={COLS} />} />,
    );
    await settle();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(39);
    expect(strip(lines[1])).toContain("Transcript");                 // the title row is its own row
    expect(lines.slice(37)).toEqual(["D0", "D1"]);                   // the dock kept its two rows
    expect(overflow).not.toHaveBeenCalled();
    r.unmount();
  });

  it("reports a body of exactly grant − chrome rows", async () => {
    const r = renderWithKeymap(
      <FullscreenFrame rows={40} dock={band(2, "D")}
        regionChildren={<RegionPager makeItems={() => items(200)} onClose={() => {}} columns={COLS} />} />,
    );
    await settle();
    const body = 37 - pagerChromeRows(COLS);
    expect(strip(rowsOf(r.lastFrame())[1])).toContain(`lines ${200 - body + 1}–200 of 200`);
    r.unmount();
  });

  // …AND THE ROWS IT COUNTS ARE THE ROWS IT PAINTS (T17 fix round). A region pager that clamps against the
  // LOGICAL row count of a document whose lines wrap is the tail-losing shape this whole wave keeps finding:
  // the header names a last row, the clip eats everything past the grant, and no gesture reaches the end.
  const wideDoc = (n: number): readonly RenderItem[] =>
    Array.from({ length: n }, (_, i) => ({ kind: "line" as const, id: `W${i}`, line: { text: `W${i}-${"x".repeat(200)}-end${i}` } }));

  it("wraps at the REGION's inner width, so the bottom is the painted bottom", async () => {
    const overflow = vi.fn();
    const r = renderWithKeymap(
      <FullscreenFrame rows={40} onOverflow={overflow} dock={band(2, "D")}
        regionChildren={<RegionPager makeItems={() => wideDoc(40)} onClose={() => {}} columns={COLS} />} />,
    );
    await settle();
    const body = 37 - pagerChromeRows(COLS);
    const total = 40 * 3;                                              // 208 columns of text over 96 inner
    expect(strip(rowsOf(r.lastFrame())[1])).toContain(`lines ${total - body + 1}–${total} of ${total}`);
    expect(r.lastFrame()).toContain("-end39");                         // the last item's last row is REACHABLE
    expect(rowsOf(r.lastFrame())).toHaveLength(39);                    // …and the grant is still the grant
    expect(overflow).not.toHaveBeenCalled();
    r.unmount();
  });
});

let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-t11-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });
// FSW T12, A SAFETY THIS FILE EARNED THE HARD WAY. `v` in the real tree spawns `$VISUAL`/`$EDITOR` with stdio
// "inherit" — measured while sabotage-testing the gate below, which launched the developer's own vim into the
// test runner and hung it. Unset for the whole file: the dump still writes its file, `openInEditor` answers
// "no-editor", and nothing is spawned. The stub is FILE-level rather than per-test on purpose — the hazard
// belongs to any test that presses `v`, including ones nobody has written yet.
//   IT IS NOT A BLANKET SHIELD, AND THE EXCEPTION HAS A NAME (t12 re-review). Unsetting is total only for the
// callers that have no default: `openInEditor` (the `v` dump, `/keybindings`) answers "no-editor" and spawns
// nothing. `editExternal` DEFAULTS TO `vi` (externalEditor.ts:107) precisely so an unset environment cannot
// crash the composer — so any test that reaches the composer's or the plan dialog's ctrl+g with these unset
// launches a real vi into the runner. Those tests must point $VISUAL at `fakeEditor()` below, and restore it
// in a `finally` so a failing assertion cannot leak a live editor into the next test.
beforeAll(() => { vi.stubEnv("VISUAL", ""); vi.stubEnv("EDITOR", ""); });
afterAll(() => { vi.unstubAllEnvs(); });

/** THE ONLY EDITOR ANY TEST IN THIS FILE MAY SPAWN — a two-line script, never a real `$EDITOR`. It rewrites the
 *  file handed to it, so `EDITED` arriving on the surface under test is what proves the child ran INSIDE
 *  whatever brackets that test is pinning, rather than that a wrapper merely wrote two escape sequences
 *  somewhere. File-level for the same reason the unset above is: the next author needs to find it. */
const fakeEditor = () => {
  const dir = mkdtempSync(join(tmpdir(), "ccx-t12-editor-"));
  const path = join(dir, "editor.sh");
  writeFileSync(path, '#!/bin/sh\nprintf EDITED > "$1"\n', { mode: 0o755 });
  return { path, clean: () => rmSync(dir, { recursive: true, force: true }) };
};

describe("ChatApp routes Ctrl-O to the region in fullscreen", () => {
  const alphaEntries = (n = 60) => Array.from({ length: n }, (_, i) => ({
    kind: "sdk" as const, source: "disk" as const,
    message: { type: "assistant", parent_tool_use_id: null, uuid: `u-${i}`, message: { id: `m-${i}`, content: [{ type: "text", text: `ALPHA-${i}` }] } },
  }));
  /** Every dump file sitting in the default destination right now — the before/after diff is how the test
   *  below finds the one IT caused without reaching into the module for a path it should not know. */
  const existing = (): string[] => readdirSync(dumpDir()).filter((f) => f.startsWith("cc-transcript-")).map((f) => join(dumpDir(), f));
  const app = (mode: "fullscreen" | "classic") => (
    <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode, reason: "env_on" }} initialEntries={alphaEntries()}
      deps={{ columns: () => 80, rows: () => 24 }} />
  );

  it("puts the pager where the transcript was, and takes the composer off the dock", async () => {
    const r = renderWithKeymap(app("fullscreen"));
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    r.stdin.write("\x0f");                                              // ctrl+o
    await tick(); await tick();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(23);                                     // still rows − 1
    // The pager's border opens on the FIRST row of the frame — it is the region now, not a dock overlay.
    expect(strip(lines[1])).toContain("Transcript");
    // …AND IT HAS THE WHOLE REGION. This is the assertion that catches the dock's transcript arm still
    // rendering on this path — a second pager below the first is invisible to everything else here (the frame
    // is still 23 rows, the title is still on row 1, the composer is still gone, and the duplicate's own hint
    // row is clipped off the bottom), but it takes the dock's twelve-row cap out of the region and the label
    // says so: `lines 55–60` instead of `44`. Twenty-two granted rows minus five of chrome is seventeen.
    expect(strip(lines[1])).toContain("lines 44–60 of 60");
    expect(strip(lines[21])).toMatch(/^╰/);                             // …the pager's own bottom border, and
    expect(strip(lines[22])).not.toContain("│");                        // the dock's one footer row below it
    expect(r.lastFrame()).not.toContain(PROMPT);                        // the composer's slot is empty
    r.stdin.write("\x0f");                                              // …and ctrl+o closes it again
    await tick(); await tick();
    expect(r.lastFrame()).toContain(PROMPT);
    r.unmount();
  });

  // THE SCROLL CONTEXT IS THE BACKGROUND, NOT AN OVERLAY. It binds four keys and suppresses nothing, so the
  // composer below it must keep every key it had — including the printable ones, which reach it through the
  // fallback rather than the table and would be the first casualty of a scope that swallowed.
  it("scrolls the region without taking a single key off the composer", async () => {
    const r = renderWithKeymap(app("fullscreen"));
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    r.stdin.write(PAGE_UP);
    await tick();
    r.stdin.write("hello");
    await tick();
    expect(r.lastFrame()).toContain("hello");
    r.unmount();
  });

  // FSW TASK 12, the composer's half of the `v` gate — through the REAL tree, because that is the only place
  // the composer and the `Scroll` context are on the stack together. A `v` typed at a following transcript is
  // a letter.
  it("types v into the composer while the transcript is following the tail", async () => {
    const r = renderWithKeymap(app("fullscreen"));
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    for (const ch of "vim") { r.stdin.write(ch); await tick(); }
    expect(r.lastFrame()).toContain("vim");
    r.unmount();
  });

  // …and the whole feature end to end, with no editor configured so nothing is spawned: scroll off the tail,
  // press `v`, and a real file appears carrying the real document. This is the wiring test — `detailItems` →
  // `transcriptDump` → the file — that no unit test can make, because ChatApp is where those meet.
  it("writes the whole conversation to a file when v is pressed while scrolled", async () => {
    const before = new Set(existing());
    const r = renderWithKeymap(app("fullscreen"));
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    r.stdin.write(PAGE_UP); await tick();
    r.stdin.write("v"); await tick(); await tick();
    const written = existing().filter((f) => !before.has(f));
    expect(written).toHaveLength(1);
    const text = readFileSync(written[0]!, "utf8");
    expect(text).toContain("ALPHA-0");                                  // the WHOLE document, not the window
    expect(text).toContain("ALPHA-59");
    rmSync(written[0]!, { force: true });
    r.unmount();
  });

  // FSW T12 REVIEW (M1) — THE RECEIPT IS AN ANSWER TO A KEYSTROKE, so it takes the row now. A notification
  // with no `priority` reads as `"low"` (notifications.ts:97) and waits out whatever is holding `current` —
  // here the kill-paste hint's five seconds, which is five seconds of the user not being told where their
  // transcript went. Canon writes its status the moment the handler returns (L549349).
  it("puts the dump's receipt on the row in front of a hint that is still holding it", async () => {
    const before = new Set(existing());
    const r = renderWithKeymap(app("fullscreen"));
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    r.stdin.write("abcd"); await tick();
    r.stdin.write("\x15");                                              // ctrl+u — the kill-paste hint (immediate, 5 s)
    await waitFor(() => (r.lastFrame() ?? "").includes(YANK_HINT_TEXT));
    r.stdin.write(PAGE_UP); await tick();
    r.stdin.write("v"); await tick(); await tick();
    expect(r.lastFrame()).toContain("wrote /");                         // the receipt, on the very next frame
    //   ^ the head of it: the row is one terminal width wide and the notification's own truncation eats the
    //     file name on any machine whose temp dir is deep enough, so the path's first byte is the pin.
    expect(r.lastFrame()).not.toContain(YANK_HINT_TEXT);                // …with the hint displaced, not queued in front
    for (const f of existing().filter((x) => !before.has(x))) rmSync(f, { force: true });
    r.unmount();
  });

  // ── FSW T12 REVIEW (I1) — EVERY child this tree hands the terminal to, not only the dump's editor ────────
  // `v`'s editor was wired to the guard and the composer's ctrl+g / ctrl+x ctrl+e was not. A child spawned with
  // stdio "inherit" while the alternate screen is up issues its OWN rmcup on exit: the terminal is back on the
  // main screen and the guard still believes it is not, so the very next frame paints over the user's shell
  // scrollback — the one thing fullscreen promises never to touch.
  //   THE EDITOR IS OURS — file-level `fakeEditor` above, never a real `$EDITOR` (the file-level unset stays in
  // force for every other test).
  const SPAWN = "<spawnSync $VISUAL>";
  /** The guard exactly as `chatMain` builds it — armed for fullscreen, never armed for a classic launch, which
   *  passes `aroundSubprocess` down all the same — plus a marker written at the point the child runs. */
  const guarded = (armed: boolean) => {
    const writes: string[] = [];
    const guard = createAltScreenGuard({ writeSync: (s) => { writes.push(s); } });
    if (armed) { guard.enter(); writes.length = 0; }
    const around = <T,>(run: () => T): T => guard.aroundSubprocess(() => { writes.push(SPAWN); return run(); });
    return { writes, guard, around };
  };
  const guardedApp = (mode: "fullscreen" | "classic", around: <T>(run: () => T) => T, session = fakeRemote(),
                      extraDeps: Partial<NonNullable<Parameters<typeof ChatApp>[0]["deps"]>> = {},
                      resumeOutput?: NonNullable<Parameters<typeof ChatApp>[0]["resumeOutput"]>) => (
    <ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode, reason: "env_on" }} initialEntries={alphaEntries()}
      deps={{ columns: () => 80, rows: () => 24, ...extraDeps }} aroundSubprocess={around}
      {...(resumeOutput ? { resumeOutput } : {})} />
  );
  const planEntry = (): PendingEntry =>
    ({ sessionId: "s", toolUseID: "p", toolName: "ExitPlanMode", kind: "plan", input: { plan: "ship it" }, createdAt: Date.now() });

  it("hands the main screen back around the COMPOSER's editor, and takes the alt screen again after it", async () => {
    const ed = fakeEditor(), { writes, guard, around } = guarded(true);
    process.env.VISUAL = ed.path;
    try {
      const r = renderWithKeymap(guardedApp("fullscreen", around));
      await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
      await tick();
      r.stdin.write("\x07");                                            // ctrl+g — `chat:externalEditor`
      await waitFor(() => (r.lastFrame() ?? "").includes("EDITED"));
      const child = writes.indexOf(SPAWN);
      expect(child).toBeGreaterThan(0);
      expect(writes.slice(0, child)).toContain(EXIT_ALT);                // rmcup BEFORE the child
      expect(writes.slice(child + 1)).toEqual([ENTER_ALT + MOUSE_ON_FULL]);   // …and smcup after it, nothing between
      expect(guard.active()).toBe(true);                                 // the guard owns the screen across the handoff
      r.unmount();
    } finally { process.env.VISUAL = ""; ed.clean(); }
  });

  // The main screen is the case the wrapper must not change: `chatMain` hands `aroundSubprocess` down in BOTH
  // modes and the guard is simply never armed, so the editor runs where we stand and not one escape is written.
  it("writes no alt-screen bytes at all when the guard is not armed", async () => {
    const ed = fakeEditor(), { writes, around } = guarded(false);
    process.env.VISUAL = ed.path;
    try {
      const r = renderWithKeymap(guardedApp("classic", around));
      await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
      await tick();
      r.stdin.write("\x07");
      await waitFor(() => (r.lastFrame() ?? "").includes("EDITED"));
      expect(writes).toEqual([SPAWN]);
      r.unmount();
    } finally { process.env.VISUAL = ""; ed.clean(); }
  });

  // The plan dialog spawns the same editor from the same key, from a surface where the composer is not even
  // mounted — so it needs the prop in its own right, not by inheriting the composer's.
  it("brackets the plan dialog's ctrl+g editor the same way", async () => {
    const ed = fakeEditor(), { writes, around } = guarded(true);
    const fake = fakeRemote();
    process.env.VISUAL = ed.path;
    try {
      const r = renderWithKeymap(guardedApp("fullscreen", around, fake));
      await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
      fake.parkPermission(planEntry());
      await waitFor(() => (r.lastFrame() ?? "").includes("Ready to code?"));
      r.stdin.write("\x07");
      await waitFor(() => writes.includes(ENTER_ALT + MOUSE_ON_FULL));
      // …AND THE ROUND TRIP LANDED (t12 re-review). Without this the escape order alone would pass on a child
      // that never ran: a `spawnSync` failure comes back as `r.error`, `editExternal` answers null, and the
      // dialog keeps its original plan while the brackets look perfect. The dialog adopts a changed edit
      // (`applyEdit`), so `EDITED` on the body is the same proof the composer's case takes.
      await waitFor(() => (r.lastFrame() ?? "").includes("EDITED"));
      const child = writes.indexOf(SPAWN);
      expect(child).toBeGreaterThan(0);
      expect(writes.slice(0, child)).toContain(EXIT_ALT);
      expect(writes.slice(child + 1)).toEqual([ENTER_ALT + MOUSE_ON_FULL]);
      r.unmount();
    } finally { process.env.VISUAL = ""; ed.clean(); }
  });

  // ── FSW T12 RE-REVIEW — THE FOURTH EDITOR, and the only one that is not a key ────────────────────────────
  // `/keybindings` hands the user their own `~/.claude/keybindings.json` through useChat's `deps.openEditor`,
  // whose default called `openInEditor` with no `around` — so from a fullscreen session it reproduced exactly
  // the defect the composer's case above describes. The command dispatcher never sees the composer's prop, so
  // this needs wiring and a case of its own. `home` is a mkdtemp dir: the seed write, and the fake editor's
  // rewrite of it, stay inside it and never touch the developer's real shortcuts file.
  const tmpHome = () => mkdtempSync(join(tmpdir(), "ccx-t12-home-"));
  const kbFile = (home: string) => join(home, ".claude", "keybindings.json");

  it("brackets the /keybindings editor the same way", async () => {
    const ed = fakeEditor(), { writes, guard, around } = guarded(true);
    const home = tmpHome();
    process.env.VISUAL = ed.path;
    try {
      const r = renderWithKeymap(guardedApp("fullscreen", around, fakeRemote(), { home }));
      await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
      await tick();
      r.stdin.write("/keybindings"); await waitFor(() => (r.lastFrame() ?? "").includes("/keybindings"));
      r.stdin.write("\r");
      await waitFor(() => writes.includes(ENTER_ALT + MOUSE_ON_FULL));
      expect(readFileSync(kbFile(home), "utf8")).toBe("EDITED");         // the child really opened the real file
      const child = writes.indexOf(SPAWN);
      expect(child).toBeGreaterThan(0);
      expect(writes.slice(0, child)).toContain(EXIT_ALT);                // rmcup BEFORE the child
      expect(writes.slice(child + 1)).toEqual([ENTER_ALT + MOUSE_ON_FULL]);   // …and smcup after it, nothing between
      expect(guard.active()).toBe(true);
      r.unmount();
    } finally { process.env.VISUAL = ""; ed.clean(); rmSync(home, { recursive: true, force: true }); }
  });

  it("writes no alt-screen bytes for /keybindings when the guard is not armed", async () => {
    const ed = fakeEditor(), { writes, around } = guarded(false);
    const home = tmpHome();
    process.env.VISUAL = ed.path;
    try {
      const r = renderWithKeymap(guardedApp("classic", around, fakeRemote(), { home }));
      await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
      await tick();
      r.stdin.write("/keybindings"); await waitFor(() => (r.lastFrame() ?? "").includes("/keybindings"));
      r.stdin.write("\r");
      await waitFor(() => writes.includes(SPAWN));
      expect(readFileSync(kbFile(home), "utf8")).toBe("EDITED");
      expect(writes).toEqual([SPAWN]);
      r.unmount();
    } finally { process.env.VISUAL = ""; ed.clean(); rmSync(home, { recursive: true, force: true }); }
  });

  // ── FSW BACKLOG 4 — AND THE SCREEN COMES BACK EVEN WHEN NOTHING CHANGED ─────────────────────────────────
  // The handoff's return leg carries `ENTER_ALT`, which contains `2J`+`H`: the alternate screen the user is
  // handed back is BLANK (the mouse enable that now trails it paints nothing). Ink repaints it only if React state moved while the child had the terminal — its
  // `onRender` writes on `output !== lastOutput` (ink.js:132) and log-update returns early on
  // `output === previousOutput` (log-update.js:13). Quit the editor without saving, close `/keybindings`
  // unchanged, and both dedupes fire: zero bytes, and the user sits looking at an empty screen until they
  // type. T17 could not reproduce it because every arm it could reach (`:q!` clears the in-flight row,
  // ctrl+g with changes rewrites the buffer) moves state on the way back. So the child here changes NOTHING,
  // and what is pinned is the forced repaint — the same `resumeOutput.repaint` closure ctrl+z resumes with.
  const REPAINT = "<forced repaint>";
  /** `chatMain`'s `resumeOutput`, reduced to the one seam this pins and marked in the SAME write log as the
   *  escape bytes, so the repaint's position against `ENTER_ALT` is assertable rather than merely its count. */
  const repaintProbe = (writes: string[]) => ({ repaint: (runInkWrite: () => void) => { writes.push(REPAINT); runInkWrite(); } });
  /** An editor that saves nothing — the arm above. It touches a marker beside the script so a test can still
   *  prove the child RAN, which `EDITED` on the surface proves for every other case in this file. */
  const quietEditor = () => {
    const dir = mkdtempSync(join(tmpdir(), "ccx-bl4-editor-"));
    const path = join(dir, "editor.sh"), mark = join(dir, "ran");
    writeFileSync(path, `#!/bin/sh\nprintf ran > '${mark}'\n`, { mode: 0o755 });
    return { path, ran: () => existsSync(mark), clean: () => rmSync(dir, { recursive: true, force: true }) };
  };

  //   WHAT THIS PINS is the forced repaint's INVOCATION AND POSITION — that it runs, and that it runs after
  // `ENTER_ALT` rather than before it, which is the only order that paints over smcup's blank screen. It does
  // NOT pin Ink's dedupe: React state moves on the way back here (the composer settles) and merely renders to
  // the same bytes, so a test asserting "Ink wrote nothing" would be asserting the harness, not the fix.
  it("forces a repaint after a round trip whose return frame is byte-identical", async () => {
    const ed = quietEditor(), { writes, around } = guarded(true);
    process.env.VISUAL = ed.path;
    try {
      const r = renderWithKeymap(guardedApp("fullscreen", around, fakeRemote(), {}, repaintProbe(writes)));
      await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
      await tick();
      r.stdin.write("\x07");                                            // ctrl+g — and the editor saves nothing
      await waitFor(() => writes.includes(ENTER_ALT + MOUSE_ON_FULL));
      await settle();
      expect(ed.ran()).toBe(true);                                      // the child really ran…
      const child = writes.indexOf(SPAWN);
      expect(writes.slice(child + 1)).toEqual([ENTER_ALT + MOUSE_ON_FULL, REPAINT]);   // …and smcup's blank screen was painted over
      r.unmount();
    } finally { process.env.VISUAL = ""; ed.clean(); }
  });

  // The main screen never went blank — nothing cleared it — so the repaint must not fire there. This is the
  // byte-identical guarantee the classic renderer has held since T12, and the gate is the live renderer mode.
  it("forces no repaint on the main screen", async () => {
    const ed = quietEditor(), { writes, around } = guarded(false);
    process.env.VISUAL = ed.path;
    try {
      const r = renderWithKeymap(guardedApp("classic", around, fakeRemote(), {}, repaintProbe(writes)));
      await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
      await tick();
      r.stdin.write("\x07");
      await waitFor(() => writes.includes(SPAWN));
      await settle();
      expect(ed.ran()).toBe(true);
      expect(writes).toEqual([SPAWN]);
      r.unmount();
    } finally { process.env.VISUAL = ""; ed.clean(); }
  });

  // A child that never returns normally is the case the user cannot recover from by hand: the screen is blank,
  // the exception is swallowed upstream (the composer answers `done(null)` and keeps the buffer), and nothing
  // else is coming. `finally`, therefore — not a line after the call.
  //   Through the REAL guard, not a bare stub: the whole sequence is what has to survive the throw, and a stub
  // that only records the spawn could not tell "the guard handed the screen back" apart from "nothing ran".
  it("repaints even when the handoff throws", async () => {
    const { writes, around: guardedAround } = guarded(true);
    const around = <T,>(_run: () => T): T => guardedAround<T>(() => { throw new Error("the child blew up"); });
    const r = renderWithKeymap(guardedApp("fullscreen", around, fakeRemote(), {}, repaintProbe(writes)));
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    r.stdin.write("\x07");
    await waitFor(() => writes.includes(SPAWN));
    await settle();
    const child = writes.indexOf(SPAWN);                                // the file's own idiom: the handoff's
    expect(writes.slice(0, child)).toContain(EXIT_ALT);                 // leading leg carries mouse/cursor bytes
    expect(writes.slice(child + 1)).toEqual([ENTER_ALT + MOUSE_ON_FULL, REPAINT]);     // …and the return leg is exactly these two
    r.unmount();
  });

  // The classic renderer is untouched: there the committed transcript is in scrollback above the frame, so the
  // pager still takes the composer's slot at the BOTTOM of the tree.
  it("leaves the classic renderer's placement alone", async () => {
    const r = renderWithKeymap(app("classic"));
    await waitFor(() => (r.lastFrame() ?? "").includes(PROMPT));
    await tick();
    r.stdin.write("\x0f");
    await tick(); await tick();
    const lines = rowsOf(r.lastFrame()).map(strip).filter((l) => l !== "");
    expect(lines.some((l) => l.includes("Transcript"))).toBe(true);
    expect(lines.findIndex((l) => l.includes("Transcript"))).toBeGreaterThan(0);
    r.unmount();
  });
});
