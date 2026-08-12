// tui/test/live-window-popup.test.tsx — FSW, the popup-budget fix: the live window pays for the suggestion
// popup, measured where Ink decides it.
//
// THE DEFECT (Task 4 §5). `popupHeight(rows) = max(1, min(max(6, rows/2), rows − 3))` — HALF THE TERMINAL —
// and that region is none of `mainWindowCap`'s fourteen dock rows. Window + dock + popup therefore cleared
// the pane at every size, so `ink.js:121`'s `outputHeight >= stdout.rows` branch fired on the keystrokes of
// EVERY slash command, and each one appends a full copy of the committed transcript to scrollback. Measured
// on a real terminal at 80x40: six `/status` submissions took scrollback from 78 rows to 2035 — past tmux's
// own 2000-row `history-limit`, i.e. the user's scrollback is destroyed.
//
// RED, on the source before the fix, through this file's own harness (a full window, then `/status` typed one
// character at a time at 80x40):
//
//     tall writes after `/`        → 1
//     tall writes after `/status`  → 7
//
// Both are 0 below. The cases run through `helpers/fakeTty.tsx` for the reason that helper exists:
// `ink-testing-library` renders with `debug: true`, the one branch of `onRender` that returns BEFORE the tall
// check, so this entire class is invisible to every other composer test in the suite.
import { describe, it, expect } from "vitest";
import React from "react";
import isInCi from "is-in-ci";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { renderRealInk, type FakeTty } from "./helpers/fakeTty.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { KeymapProvider } from "../../src/tui/keys/KeymapProvider.js";
import { popupHeight } from "../../src/tui/suggestPopup.js";
import { mainWindowCap, WINDOW_SLACK } from "../../src/tui/liveWindow.js";

/** One top-level assistant text frame — exactly one row. */
const say = (n: number) => ({ type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`, message: { id: `m-${n}`, content: [{ type: "text", text: `ALPHA-${n}` }] } });
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Ink's throttled log write is on a 32 ms leading/trailing timer; a settle has to outlast it. */
const settle = () => new Promise((r) => setTimeout(r, 120));
const ESC = "\x1b";
/** The CURRENT screen: Ink rewrites the whole frame on every paint, so the last chunk is what is on it. */
const screen = (tty: FakeTty): string => {
  const chunk = [...tty.stdout.writes].reverse().find((w) => w.trim().length > 0) ?? "";
  return chunk.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\s+/g, " ");
};

describe.skipIf(isInCi)("FSW popup budget — the live window pays for the suggestion popup", () => {
  /** ChatApp under the real keymap (bare, it has no input path at all — F2 task 6) over a real Ink whose
   *  stdout can be resized. `deps.rows`/`deps.columns` read the SAME fake tty Ink was handed, so `useChat`'s
   *  commit cap and the render window are sizing against one terminal. */
  function mount(geo: { columns: number; rows: number }, lie: (rows: number) => number = (r) => r) {
    const fake = fakeRemote();
    const tty = renderRealInk(
      <KeymapProvider>
        <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" resyncViewport={() => false}
          deps={{ now: () => 0, columns: () => geo.columns, rows: () => lie(geo.rows), scheduleRepaint: () => () => {} }} />
      </KeymapProvider>,
      geo,
    );
    return { fake, tty };
  }
  /** Forty one-row items, then a wait for the last one — the window is full at both geometries below. */
  async function fill(fake: ReturnType<typeof fakeRemote>, tty: FakeTty) {
    await settle();
    for (let n = 1; n <= 40; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => tty.stdout.writes.join("").includes("ALPHA-40"));
    await settle();
  }

  // The two geometries the resize matrix's red cells run at. 24 is where the popup is BIGGER than the whole
  // window (12 rows of popup against 24 − 14 − 2 = 8 of window, so the window yields all of it); 40 is where
  // it is bigger than half of it (20 against 24) and the yield is partial — the case that distinguishes a
  // budgeted subtraction from a blanket blanking.
  for (const rows of [24, 40] as const) {
    it(`typing, filtering and closing a slash popup at 80x${rows} writes NO tall frame`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mount(geo);
      await fill(fake, tty);
      // The window is FULL before the popup opens — otherwise every zero below is satisfied for the wrong
      // reason. `rows − 16` items are live, so the first one that is NOT committed is a positive control.
      const firstLive = 40 - (mainWindowCap(rows) - WINDOW_SLACK) + 1;
      expect(screen(tty)).toContain(`ALPHA-${firstLive}`);

      const mark = tty.mark();
      tty.stdin.write("/");
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);                     // measured 1 before the fix
      // …and the popup really is on screen: a zero against a popup that never opened is no measurement.
      expect(screen(tty)).toContain("/status");

      for (const ch of "status") { tty.stdin.write(ch); await settle(); }
      expect(tty.tallWritesSince(mark)).toBe(0);                     // measured 7 before the fix
      expect(screen(tty)).toContain("show model");

      // BUDGETED, NOT BLANKED (the I2 lesson): the window gave up exactly the popup's rows and no more, so
      // whatever is left of it is still on screen. At 24 rows the popup is taller than the window and the
      // whole of it yields, which is the honest arithmetic rather than an exception.
      const live = Math.max(0, mainWindowCap(rows) - WINDOW_SLACK - popupHeight(rows));
      if (live > 0) expect(screen(tty)).toContain(`ALPHA-${40 - live + 1}`);
      if (live < 40) expect(screen(tty)).not.toContain(`ALPHA-${40 - live}`);

      // …AND IT IS NOT A COMMIT. Escape closes the popup and every row the window gave up comes back — a
      // ratchet driven off a per-keystroke flicker would have published them instead, frozen at this width.
      tty.stdin.write(ESC);
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      const back = screen(tty);
      expect(back).not.toContain("show model");
      expect(back).toContain(`ALPHA-${firstLive}`);
    });
  }

  // THE NEGATIVE CONTROL, and it is not optional: every count above is a ZERO, and a harness that had quietly
  // stopped seeing Ink's writes would satisfy all of them. Same tree, same keystrokes, with ChatApp sizing its
  // window against a terminal 100 rows taller than the one Ink measures — so the frame must overflow and the
  // branch must be counted.
  it("…and the harness still sees the branch when the window is sized against the wrong terminal", async () => {
    const geo = { columns: 80, rows: 40 };
    const { fake, tty } = mount(geo, (r) => r + 100);
    await fill(fake, tty);
    const mark = tty.mark();
    tty.stdin.write("/");
    await settle();
    expect(tty.tallWritesSince(mark)).toBeGreaterThan(0);
  });
});
