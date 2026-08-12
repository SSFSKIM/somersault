// tui/test/live-window-frame-bound.test.tsx — FSW Task 3, FIX ROUND: the wave's global constraint, measured
// where it is actually decided. "The frame is never taller than the terminal" is not a claim about the live
// window's cap — it is a claim about the bytes Ink writes, and Ink writes them from `ink.js:121`:
//
//     if (outputHeight >= this.options.stdout.rows)
//       this.options.stdout.write(clearTerminal + this.fullStaticOutput + output);
//
// …i.e. the entire accumulated session, reprinted, on every frame that overflows. Every other test in this
// wave runs on `ink-testing-library`, which renders with `debug: true` — the ONE branch of `onRender` that
// returns before that check — so the whole class is invisible to them. This file renders the same tree
// through the same Ink with `debug: false` over a resizable fake tty (`helpers/fakeTty.tsx`) and COUNTS the
// branch. Both cases below were red before the fixes they guard and are annotated with the measurement.
import { describe, it, expect } from "vitest";
import React from "react";
import isInCi from "is-in-ci";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { renderRealInk } from "./helpers/fakeTty.js";
import { ChatApp } from "../../src/tui/ChatApp.js";

/** One top-level assistant text frame — exactly one row. */
const say = (n: number) => ({ type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`, message: { id: `m-${n}`, content: [{ type: "text", text: `ALPHA-${n}` }] } });
const se = (event: unknown) => ({ kind: "message" as const, data: { type: "stream_event", event } });
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Ink's throttled log write is on a 32 ms leading/trailing timer; a settle has to outlast it. */
const settle = () => new Promise((r) => setTimeout(r, 120));

// `is-in-ci` is read by `ink.js` at import time, and under CI it skips the resize subscription AND takes a
// different `onRender` branch — the mechanism these cases measure does not exist there, so they would pass
// for the wrong reason. Skipped rather than silently green.
describe.skipIf(isInCi)("FSW T3 fix round — the frame stays inside the terminal", () => {
  /** ChatApp over a real Ink instance whose stdout can be resized. `deps.rows`/`deps.columns` read the SAME
   *  fake tty Ink was handed, which is what keeps the two phases honest: `useChat`'s commit cap otherwise
   *  falls back to `process.stdout.rows` (undefined under vitest → 24) while the render window reads Ink's
   *  stdout, and the two would be sizing against different terminals. `resyncViewport` is stubbed off so the
   *  only writes carrying `\x1b[2J` are Ink's own tall-frame branch and nothing else. */
  function mount(geo: { columns: number; rows: number }) {
    const fake = fakeRemote();
    const tty = renderRealInk(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" resyncViewport={() => false}
        deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows, scheduleRepaint: () => () => {} }} />,
      geo,
    );
    return { fake, tty };
  }

  // ── C1: a row-shrink must not take the tall branch ───────────────────────────────────────────────────
  // THE MECHANISM, because the fix is one word and the reason is not. Ink registers its `resize` handler in
  // its constructor, i.e. during `render()`, and that handler is `() => { this.calculateLayout();
  // this.onRender() }` — it re-measures and re-serializes the EXISTING element tree against the NEW
  // `stdout.rows`, and it never re-renders React. ChatApp subscribes from a passive effect, which is
  // strictly later, so an appended listener learns the new size only after Ink has already written. Before
  // T3 nothing in the live subtree was tall enough for that lag to matter; T3 put up to `rows − 16` rows
  // there. The fix is to register FIRST — `prependListener` in ChatApp's default, and a fan-out from
  // chatMain's own already-first listener in production — which works because Ink runs React in legacy
  // mode, where a `setState` from a plain event callback flushes synchronously: the window has already
  // shrunk, and been written, by the time Node reaches Ink's handler.
  it("a 40 → 24 row shrink with a full live window writes NO tall frame", async () => {
    const geo = { columns: 80, rows: 40 };
    const { fake, tty } = mount(geo);
    await settle();
    for (let n = 1; n <= 40; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => tty.stdout.writes.join("").includes("ALPHA-40"));
    await settle();
    // 40 − 14 − 2 = 24 live rows, so sixteen items are committed and twenty-four are in the window — the
    // configuration in which the stale tree is 44 physical rows against a 24-row terminal.
    expect(tty.textSince(0)).toContain("ALPHA-17");

    const mark = tty.mark();
    geo.rows = 24; tty.resize({ rows: 24 });
    await settle();
    expect(tty.tallWritesSince(mark)).toBe(0);      // measured 1 before the fix, and 0 after
    // …and the window really did shrink rather than the frame having been suppressed: eight rows live.
    const after = tty.textSince(mark);
    expect(after).toContain("ALPHA-40");
    expect(after).not.toContain("ALPHA-31");        // 40 − 8 = the first row the 24-row window cannot hold
  });

  // THE NEGATIVE CONTROL, and it is not optional: every assertion above is a ZERO, and a harness that had
  // quietly stopped seeing Ink's writes would satisfy all of them. This runs the identical scenario with
  // ChatApp's subscription deliberately APPENDED (the pre-fix ordering) and requires the tall write to
  // appear — so "no tall write" above can only mean the tree fit.
  it("…and the same shrink DOES take it when ccx's listener is behind Ink's — the harness can see the branch", async () => {
    const geo = { columns: 80, rows: 40 };
    const fake = fakeRemote();
    const holder: { stdout?: NodeJS.WriteStream } = {};
    const tty = renderRealInk(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" resyncViewport={() => false}
        deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows, scheduleRepaint: () => () => {} }}
        onResize={(cb) => { holder.stdout!.on("resize", cb); return () => { holder.stdout!.off("resize", cb); }; }} />,
      geo,
    );
    holder.stdout = tty.stdout as unknown as NodeJS.WriteStream;
    await settle();
    for (let n = 1; n <= 40; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => tty.stdout.writes.join("").includes("ALPHA-40"));
    await settle();
    const mark = tty.mark();
    geo.rows = 24; tty.resize({ rows: 24 });
    await settle();
    expect(tty.tallWritesSince(mark)).toBeGreaterThan(0);
  });

  // ── C2: the window yields its rows to the in-flight turn ─────────────────────────────────────────────
  // The live subtree is `window + dock + pending + streaming`, and only the first of those is bounded. T3
  // as shipped gave the window `rows − 16` and left the other two on whatever was left, so the streaming
  // budget lost exactly the rows the window gained. MEASURED at 24 rows with a full window, sweeping the
  // length of one in-flight assistant message (the number is the first length at which Ink's branch fires):
  //
  //     streamed rows   |  8  | 12  | 16  | 18  | 19
  //     T3 as shipped   | ok  | TALL| TALL| TALL| TALL
  //     with this fix   | ok  | ok  | ok  | ok  | TALL
  //
  // Nineteen is the PARENT commit's own threshold and is not this task's to fix: with the window fully
  // yielded the frame is `dock + streaming` on both sides of the change, which is exactly parity. Twelve
  // rows of streamed prose is an ordinary turn, which is what made the shipped number a regression.
  for (const streamedRows of [12, 18] as const) {
    it(`${streamedRows} streamed rows under a full window at 24 rows writes NO tall frame`, async () => {
      const geo = { columns: 80, rows: 24 };
      const { fake, tty } = mount(geo);
      await settle();
      for (let n = 1; n <= 20; n++) fake.pushEvent({ kind: "message", data: say(n) });
      await waitFor(() => tty.stdout.writes.join("").includes("ALPHA-20"));
      await settle();
      // The window is FULL before the turn starts — 24 − 14 − 2 = 8 rows of it. Asserted, because a fix that
      // simply emptied the window would satisfy the tall-write count below for the wrong reason.
      const idle = tty.textSince(0);
      expect(idle).toContain("ALPHA-13");
      expect(idle).toContain("ALPHA-20");

      const mark = tty.mark();
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
      fake.pushEvent(se({ type: "message_start" }));
      fake.pushEvent(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
      for (let i = 0; i < streamedRows; i++) fake.pushEvent(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `STREAM-${i}\n` } }));
      await settle(); await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      // The turn's own rows are what is on screen — the window gave way, it was not the stream that was cut.
      expect(tty.textSince(mark)).toContain(`STREAM-${streamedRows - 1}`);
    });
  }
});
