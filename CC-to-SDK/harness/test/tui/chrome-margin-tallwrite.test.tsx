// tui/test/chrome-margin-tallwrite.test.tsx — T-SPACE Task 3 (spec §2.2/D16): the chrome margins (the
// live-turn slot's `marginTop={1}` and the composer's own `marginTop={1}`) each add one PAINTED row to the
// classic main-screen dock that `MAIN_DOCK_ROWS` (`liveWindow.ts`) reserves for. This file is the guard for
// the reservation itself: it fills the live window to capacity, then drives each of the four states the
// brief names — the ordinary spinner, the retry row, the compaction row, and the suggestion palette open —
// and asserts Ink never takes its tall-frame branch (`ink.js:121`'s `outputHeight >= stdout.rows`, which
// reprints the WHOLE session into scrollback — see `helpers/fakeTty.tsx`'s own header for why this class of
// defect is invisible to `ink-testing-library`'s `debug: true` renders).
//
// RED-FIRST, verified by hand rather than committed as a separate revision: with the two `marginTop={1}`
// wrappers added but `MAIN_DOCK_ROWS` left at its pre-Task-3 value (14), the spinner and compaction cases at
// 40 rows both take the tall branch — the reservation under-counts the two new painted rows by exactly the
// margin between "safe" and "tall". Restoring `MAIN_DOCK_ROWS` to 16 is what turns every case below green,
// which is the whole of what this file is asserting.
import { describe, it, expect } from "vitest";
import React from "react";
import isInCi from "is-in-ci";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { renderRealInk, type FakeTty } from "./helpers/fakeTty.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { KeymapProvider } from "../../src/tui/keys/KeymapProvider.js";

/** One top-level assistant text frame — exactly one row. */
const say = (n: number) => ({ type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`, message: { id: `m-${n}`, content: [{ type: "text", text: `ALPHA-${n}` }] } });
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Ink's throttled log write is on a 32 ms leading/trailing timer; a settle has to outlast it. */
const settle = () => new Promise((r) => setTimeout(r, 120));

// `is-in-ci` is read by `ink.js` at import time, and under CI it skips the resize subscription AND takes a
// different `onRender` branch — the tall-frame mechanism this file measures does not exist there (see
// `live-window-frame-bound.test.tsx`'s identical guard).
describe.skipIf(isInCi)("T-SPACE Task 3 (spec §2.2/D16) — the chrome margins stay inside the dock reservation", () => {
  function mount(geo: { columns: number; rows: number }, keymapped = false) {
    const fake = fakeRemote();
    const tree = <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" resyncViewport={() => false}
      deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows, scheduleRepaint: () => () => {} }} />;
    const tty = renderRealInk(keymapped ? <KeymapProvider>{tree}</KeymapProvider> : tree, geo);
    return { fake, tty };
  }
  /** Enough one-row items to fill the live window solid at either geometry below (40 items comfortably
   *  exceeds `mainWindowCap(40) − WINDOW_SLACK`, the largest budget either height under test can offer). */
  async function fill(fake: FakeRemote, tty: FakeTty) {
    await settle();
    for (let n = 1; n <= 40; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => tty.stdout.writes.join("").includes("ALPHA-40"));
    await settle();
  }

  // 18 (SHORT — MAIN_DOCK_ROWS(16) alone consumes nearly the whole pane, so the live window is at or near
  // zero before any of the four states below even applies) and 40 (NORMAL — a comfortably full window, the
  // shape an ordinary long session is in when a turn starts) are the two heights the brief names.
  for (const rows of [18, 40] as const) {
    it(`the live-turn spinner at ${rows} rows writes NO tall frame`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mount(geo);
      await fill(fake, tty);
      const mark = tty.mark();
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      // …and the margin really painted: the spinner slot's own row is on screen, not merely "nothing broke".
      expect(tty.textSince(mark)).toMatch(/⏺|Thinking|✽|·/);
    });

    it(`the retry row at ${rows} rows writes NO tall frame`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mount(geo);
      await fill(fake, tty);
      const mark = tty.mark();
      // The retry row REPLACES the spinner in the one shared live-turn slot — it only supersedes a busy
      // turn, so the turn must actually be running (`state.busy`) before the api_retry frame lands.
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
      fake.pushEvent({ kind: "message", data: { type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 5000, error_status: null, error: "unknown" } });
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      expect(tty.textSince(mark)).toContain("Retry");
    });

    it(`the compaction row at ${rows} rows writes NO tall frame`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mount(geo);
      await fill(fake, tty);
      const mark = tty.mark();
      fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      expect(tty.textSince(mark)).toMatch(/[Cc]ompact/);
    });

    it(`the suggestion palette open at ${rows} rows writes NO tall frame`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mount(geo, /* keymapped */ true);
      await fill(fake, tty);
      const mark = tty.mark();
      tty.stdin.write("/");
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      // …and the palette really opened: the composer's own margin dropped to 0 for a real reason, not one
      // this test merely assumed.
      expect(tty.textSince(mark)).toContain("/status");
      tty.stdin.write("\x1b");                      // close it — leaves no dangling keymap listener behind
      await settle();
    });
  }
});
