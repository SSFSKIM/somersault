// tui/test/chrome-margin-tallwrite.test.tsx — T-SPACE Task 3 (spec §2.2/D16): the chrome margins (the
// live-turn slot's `marginTop={1}` and the composer's own `marginTop={1}`) each add one PAINTED row to the
// classic main-screen dock that `MAIN_DOCK_ROWS` (`liveWindow.ts`) reserves for. This file is the guard for
// the reservation itself: it fills the live window to capacity, then drives each of the four states the
// brief names — the ordinary spinner, the retry row, the compaction row, and the suggestion palette open —
// and asserts Ink never takes its tall-frame branch (`ink.js:121`'s `outputHeight >= stdout.rows`, which
// reprints the WHOLE session into scrollback — see `helpers/fakeTty.tsx`'s own header for why this class of
// defect is invisible to `ink-testing-library`'s `debug: true` renders).
//
// RED-FIRST (T-SPACE Task 3 fix wave — corrected from an earlier claim below that did not reproduce on the
// shipped code): the four single-occupant scenarios directly below (spinner/retry/compaction/palette alone,
// nothing else in the dock) stay 8/8 GREEN even with `MAIN_DOCK_ROWS` reverted to 14 — none of them combine
// enough dock occupants to reach the constant's actual worst case, so they cannot see a 2-row under-count.
// The "combined worst case" describe block further down (todo panel at its max + a queued prompt + the busy
// slot + the composer, all at once — the true sum `MAIN_DOCK_ROWS` itemizes in `liveWindow.ts`) is what is
// RED-FIRST: verified by hand, reverting `MAIN_DOCK_ROWS` to 14 there makes every one of those cases take the
// tall branch (5-6 tall writes apiece at 24/30/40 rows), and restoring it to 16 is what turns them green —
// which is the reservation's true worst case, not a proxy for it.
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
      tty.unmount();
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
      tty.unmount();
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
      tty.unmount();
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
      tty.unmount();
    });
  }
});

// T-SPACE Task 3 fix wave (review finding 2, Important). The four scenarios above each populate exactly ONE
// dock occupant; `MAIN_DOCK_ROWS`'s own itemization (`liveWindow.ts`) sums SEVEN occupants at once — todo
// panel (8 rows at its max) + the live-turn slot (2) + the queue band (1) + the composer (4) + the footer
// (1) = 16 — and nothing above exercises that combination in classic mode. This block does: six tasks (one
// past `todoWindowSize`'s 5-row cap, so the "+N more" overflow line is live too), a turn in progress (the
// busy slot), and a second prompt typed and submitted WHILE busy (the queue band), all at once, at heights
// where the classic dock's `MAIN_DOCK_ROWS` — not `dockCap` (fullscreen-only, `dockOrigin.test.tsx`'s own
// combined fixture) — is the reservation actually load-bearing.
describe.skipIf(isInCi)("T-SPACE Task 3 fix wave — the combined worst-case classic dock (todo max + queue + slot + composer)", () => {
  function mountWorstCase(geo: { columns: number; rows: number }) {
    let fake!: FakeRemote;
    fake = fakeRemote({ submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); } });
    const tree = <KeymapProvider><ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
      deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows }} /></KeymapProvider>;
    const tty = renderRealInk(tree, geo);
    return { fake, tty };
  }
  async function fillWorstCase(fake: FakeRemote, tty: FakeTty) {
    await settle();
    for (let n = 1; n <= 40; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => tty.textSince(0).includes("ALPHA-40"));
    await settle();
  }

  // 24/30/40: all three land past `todoWindowSize`'s 19-row floor for a 5-task window (`rows <= 10 ? 0 :
  // min(5, max(3, rows-14))`), so the todo panel reaches its true 8-row maximum at every height under test —
  // unlike the 18-row SHORT case above, which the brief's own four scenarios use but which caps the window at
  // 4, one row short of the constant's worst case.
  for (const rows of [24, 30, 40] as const) {
    it(`todo panel at max + queue + busy slot + composer, combined, at ${rows} rows writes NO tall frame`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mountWorstCase(geo);
      await fillWorstCase(fake, tty);
      const mark = tty.mark();
      for (let i = 1; i <= 6; i++) {
        const id = `tu${i}`;
        fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: "TaskCreate", input: { subject: `todo-item-${i}` } }] } } });
        fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: `Task #${i} created successfully: todo-item-${i}` }] } } });
      }
      await waitFor(() => tty.textSince(0).includes("6 tasks"));
      await settle();
      tty.stdin.write("first prompt");
      await waitFor(() => tty.textSince(0).includes("first prompt"));
      await settle();
      tty.stdin.write("\r");                                          // submits — the fake's submit never resolves, so the turn stays busy
      await waitFor(() => /[·✢✳✶✻✽]/.test(tty.textSince(0)));
      await settle();
      tty.stdin.write("queued prompt");
      await waitFor(() => tty.textSince(0).includes("queued prompt"));
      await settle();
      tty.stdin.write("\r");                                          // queues while busy — the queue band joins the dock
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      // …and every occupant really is on screen, not merely "nothing broke".
      const painted = tty.textSince(mark);
      expect(painted).toContain("6 tasks");
      expect(painted).toMatch(/pending/);                             // the "+N more" overflow line
      expect(painted).toMatch(/[·✢✳✶✻✽]/);                            // the busy slot
      expect(painted).toContain("queued prompt");                     // the queue band
      tty.unmount();
    });
  }
});
