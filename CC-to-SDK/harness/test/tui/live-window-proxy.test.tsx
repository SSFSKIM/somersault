// tui/test/live-window-proxy.test.tsx — FSW Task 4: THE CORRECTIONS-AWAKE GATE.
//
// WHAT IS BEING GUARDED, and why it needs its own file. Wave R's resize corrections are not a component: they
// are a loop between three things that only exist in `runChatClient` — the resume-safe stdout proxy, which
// learns what is painted from the bytes Ink writes through it; `createResizeRepaint`, which measures the next
// shrink against that recorded frame; and the resize chain, which orders both of them ahead of Ink's own
// handler. Every one of those inputs is a FRAME. Ink's tall-frame branch (`ink.js:121`) does not write a
// frame — it writes `clearTerminal + fullStaticOutput + output` in one chunk with no seam in it — and the
// proxy's only honest response is to forget what is on screen (`chatMain.tsx`: "downward is the only direction
// available"). So a live subtree that pushes the frame over the terminal's height does not merely reprint the
// world once: it takes `lastFrame()` away, and with it the `frame === undefined` refusal at the head of
// `onResize`. The corrections go to sleep, silently, for the rest of the session.
//
// That is the wave's own failure mode — this wave ADDS up to `rows − 16` rows to the live subtree — and it is
// invisible to every other test in the suite. `ink-testing-library` renders with `debug: true`, the one branch
// of `onRender` that returns before the tall check, and the corrections were only ever driven over a FAKE
// proxy (`resize-state.test.tsx`'s `fakeProxy`), which cannot fail for the reason the real one does. So this
// file mounts the production wiring: real Ink at `debug: false` over a resizable terminal
// (`helpers/fakeTty.tsx`), rendering through the REAL `createResumeSafeStdout`, with `createResizeRepaint` and
// `createResizeChain` attached exactly as `runChatClient` attaches them.
//
// THE GATE IS THREE ASSERTIONS, and the third is the one the T3 review earned:
//   1. steady state, window full: `out.lastFrame() !== undefined` — the proxy still knows what is painted.
//   2. a width shrink still reaches the oracle: the injected probe is asked, and `verdict()` caches "reflow".
//   3. …and the SHRINK TRANSIENT, not just the steady state: a row-shrink under a full window writes ZERO
//      tall chunks. T3's C1 defect lived entirely in that transient — the steady state on both sides of it was
//      clean — so a gate that only measured settled screens would have passed the build that had it.
// The fourth case is the negative control for all three: it inflates the window's cap by 100 rows and requires
// the gate to redden, because every assertion above is an absence and an instrument that had stopped seeing
// Ink's writes would satisfy all of them.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import isInCi from "is-in-ci";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { renderRealInk } from "./helpers/fakeTty.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { createResizeChain, createResumeSafeStdout, type ResumeSafeStdout } from "../../src/tui/chatMain.js";
import { createResizeRepaint, type ResizeRepaint } from "../../src/tui/resizeRepaint.js";
import type { ReflowVerdict } from "../../src/tui/reflowOracle.js";

/** One top-level assistant text frame — exactly one row. */
const say = (n: number) => ({ type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`, message: { id: `m-${n}`, content: [{ type: "text", text: `ALPHA-${n}` }] } });
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Ink's throttled log write is on a 32 ms leading/trailing timer, and the re-projection FSW T4 added waits out
 *  `RESIZE_SETTLE_MS` (80 ms) on top of it; a settle has to outlast both. */
const settle = () => new Promise((r) => setTimeout(r, 250));

describe.skipIf(isInCi)("FSW T4 — the resize corrections stay awake under a live window", () => {
  /** `runChatClient`'s wiring, with the process's terminal replaced by a resizable fake one and the DSR probe
   *  replaced by a promise. Everything between those two ends is the shipped code path:
   *    · Ink renders through `createResumeSafeStdout(...).stdout`, so every byte it writes is classified by the
   *      real proxy and `lastFrame()`/`parkedColumn()` are learned the way they are in production.
   *    · one `resize` listener on the terminal, and it is the CHAIN: readers (`noteResizeSignal`,
   *      `resize.onResize`) first, ChatApp's size commit second, Ink's own handler last.
   *    · `setFrameCorrector(resize.frameWrite)`, so the writes carry whatever correction the verdict earns.
   *  `cap` is the sabotage lever and nothing else: it is added to the rows `useChat`/ChatApp size the live
   *  window against, while Ink keeps measuring the real terminal — i.e. exactly "cap += 100". */
  function mount(geo: { columns: number; rows: number }, { cap = 0 }: { cap?: number } = {}) {
    const fake = fakeRemote();
    const probe = vi.fn(async (): Promise<ReflowVerdict> => "reflow");
    const held: { out?: ResumeSafeStdout; resize?: ResizeRepaint } = {};
    const chain = createResizeChain(() => { held.out!.noteResizeSignal(); held.resize!.onResize(); });
    // A STABLE identity, for the reason ChatApp's `onResize` docblock gives: the subscribing effect lists it as
    // its only dependency, so a fresh closure per render would re-attach the terminal listener every frame.
    const subscribe = (cb: () => void) => chain.subscribe(cb);
    const tty = renderRealInk(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" resyncViewport={() => false}
        deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows + cap, scheduleRepaint: () => () => {} }}
        onResize={subscribe} />,
      {
        ...geo,
        wrap: (raw) => {
          const out = createResumeSafeStdout(raw);
          const resize = createResizeRepaint({
            lastFrame: out.lastFrame, parkedColumn: out.parkedColumn, detached: out.detachedWrites,
            size: () => ({ columns: raw.columns, rows: raw.rows }),
            repaint: (s) => { out.stdout.write(s); },
            probe: () => probe(),
          });
          out.setFrameCorrector(resize.frameWrite);
          held.out = out; held.resize = resize;
          raw.on("resize", chain.fire);
          return out.stdout;
        },
      },
    );
    return { fake, tty, probe, out: held.out!, resize: held.resize! };
  }

  /** 40 rows − dock(14) − SLACK(2) = a 24-row window, filled by forty one-row items: sixteen commit and the
   *  other twenty-four are live. That is the configuration T3's C1 defect needed, and the one this file wants
   *  for every case — a window that is genuinely holding rows, asserted rather than assumed. */
  async function fillWindow(m: ReturnType<typeof mount>) {
    await settle();
    for (let n = 1; n <= 40; n++) m.fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => m.tty.stdout.writes.join("").includes("ALPHA-40"));
    await settle();
  }

  it("with the window full, the proxy still knows what is painted — `lastFrame()` survives the steady state", async () => {
    const geo = { columns: 80, rows: 40 };
    const m = mount(geo);
    await fillWindow(m);
    // The window really is holding rows (ALPHA-17 is the first of the twenty-four that were never committed),
    // so this is a frame with the live subtree in it and not an empty one.
    expect(m.tty.textSince(0)).toContain("ALPHA-17");
    expect(m.out.lastFrame()).not.toBeUndefined();
    expect(m.out.tallWrites()).toBe(0);
    m.tty.unmount();
  });

  it("…and a width shrink still reaches the oracle: the probe is asked and the verdict caches", async () => {
    const geo = { columns: 80, rows: 40 };
    const m = mount(geo);
    await fillWindow(m);
    expect(m.resize.verdict()).toBeUndefined();          // unmeasured until a narrowing asks

    geo.columns = 60; m.tty.resize({ columns: 60 });
    await settle();
    expect(m.probe).toHaveBeenCalledTimes(1);            // `onResize` refuses outright when there is no frame
    expect(m.resize.verdict()).toBe("reflow");
    m.tty.unmount();
  });

  it("…and the SHRINK TRANSIENT is covered too: a 40 → 24 row shrink under a full window writes no tall frame", async () => {
    // The C1 class, re-measured through the PRODUCTION chain rather than ChatApp's embedder default. The
    // ordering that makes this a zero lives in two places — `createResizeChain` fans out to the size commit
    // before Ink's own handler runs — and `live-window-frame-bound.test.tsx` only ever exercised the other one
    // (ChatApp prepending its own listener). Both halves of the same fix, and only this one is what ships.
    const geo = { columns: 80, rows: 40 };
    const m = mount(geo);
    await fillWindow(m);
    const mark = m.tty.mark();
    geo.rows = 24; m.tty.resize({ rows: 24 });
    await settle();
    expect(m.tty.tallWritesSince(mark)).toBe(0);
    // …and the corrections came through it awake, which is the whole point of measuring the transient here:
    // one tall chunk anywhere in that burst would have taken the recorded frame away for good.
    expect(m.out.lastFrame()).not.toBeUndefined();
    // The window yielded rather than the frame having been suppressed — eight live rows at 24.
    const after = m.tty.textSince(mark);
    expect(after).toContain("ALPHA-40");
    expect(after).not.toContain("ALPHA-31");
    m.tty.unmount();
  });

  // ── THE NEGATIVE CONTROL — the gate must be able to redden ────────────────────────────────────────────
  // Every assertion above is an absence, so the instrument is asserted here rather than trusted: the same
  // scenario with the live window's cap inflated by 100 rows (the plan's own sabotage) puts the frame over
  // `stdout.rows`, and all three halves of the gate fail together — the branch fires, the proxy forgets the
  // frame, and the shrink that follows never reaches the probe. It is one case because they are one failure.
  it("with the cap inflated by 100 rows the gate reddens: the tall branch fires, the frame is forgotten, the probe is never asked", async () => {
    const geo = { columns: 80, rows: 40 };
    const m = mount(geo, { cap: 100 });
    await fillWindow(m);
    expect(m.out.tallWrites()).toBeGreaterThan(0);
    expect(m.out.lastFrame()).toBeUndefined();

    geo.columns = 60; m.tty.resize({ columns: 60 });
    await settle();
    expect(m.probe).not.toHaveBeenCalled();
    expect(m.resize.verdict()).toBeUndefined();
    m.tty.unmount();
  });
});
