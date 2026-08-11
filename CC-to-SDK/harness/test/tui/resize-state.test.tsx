// test/tui/resize-state.test.tsx — Wave R task 1, defect (i): a terminal resize must RE-RENDER the tree.
// `grep -rn 'on("resize"' src/` returned nothing before this task: nothing in ccx subscribed at all, and
// Ink's own handler (node_modules/ink/build/ink.js:83) only re-runs Yoga over the EXISTING element tree —
// it never re-renders components, so `ChatApp`'s `terminalColumns()` was re-read only when something else
// happened to render. Every width-derived string froze at the launch width. The composer's own rules
// (`ComposerFrame`, CM1: two full-width `─` runs) are the cheapest width-derived string in the tree, so
// they are what this file measures.
import React from "react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp, nextSize } from "../../src/tui/ChatApp.js";
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";

// The composer seeds and appends prompt history under `fleetRoot()`; without this it would touch the real
// ~/.claude (a defect regardless of whether the test passes).
let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-rs-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** select.test.tsx's helper: `useInput` (and the keymap's stdin listener) subscribe in a PASSIVE effect, so
 *  a test that acts on the tree before an awaited tick races the subscription. */
async function mount(ui: React.ReactElement) {
  const r = renderWithKeymap(ui);
  await waitFor(() => frame(r.lastFrame).includes("❯ "));
  return r;
}
/** The widths of every all-`─` row on screen — the composer draws one above and one below itself. */
const ruleWidths = (f: string) => strip(f).split("\n").map((l) => l.trimEnd()).filter((l) => /^─+$/.test(l)).map((l) => l.length);

/** Wait until a counter stops moving on its own. The mount keeps committing for a while after the first frame
 *  (session connect, prompt history), and "this resize caused no render" only means something against a tree
 *  that had stopped rendering. Returns the settled value. */
async function quiesced(read: () => number, timeout = 2000) {
  const start = Date.now(); let last = -1;
  for (;;) { const now = read(); if (now === last) return now; last = now; if (Date.now() - start > timeout) throw new Error("quiesced timeout"); await new Promise((r) => setTimeout(r, 10)); }
}

/** The injected `onResize` seam: subscribe → returns unsubscribe, exactly the shape ChatApp defaults to
 *  over `process.stdout`'s "resize" event. `duringSubscribe` runs inside the subscribe call itself — the one
 *  place a test can stand in the render→commit window (see the "resamples after subscribing" case). */
function fakeResize(duringSubscribe?: () => void) {
  const cbs = new Set<() => void>();
  return {
    onResize: (cb: () => void) => { duringSubscribe?.(); cbs.add(cb); return () => { cbs.delete(cb); }; },
    fire: () => { for (const cb of [...cbs]) cb(); },
    get count() { return cbs.size; },
  };
}

describe("terminal size is React state", () => {
  it("re-renders the width-derived composer rules when a resize fires", async () => {
    let cols = 40;
    const resize = fakeResize();
    const deps = { columns: () => cols, getSessionMessages: async () => [] as any[] };
    const r = await mount(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    expect(ruleWidths(frame(r.lastFrame))).toContain(40);
    expect(ruleWidths(frame(r.lastFrame))).not.toContain(60);
    cols = 60;
    resize.fire();
    await tick();
    expect(ruleWidths(frame(r.lastFrame))).toContain(60);
    expect(ruleWidths(frame(r.lastFrame))).not.toContain(40);
  });

  // REVIEW FINDING 1 (wave R t1). The size is read during RENDER (`useState(readSize)`) while the listener only
  // attaches in the effect, a commit later. A resize landing in that window fires no callback — nobody is
  // subscribed yet — and the size already in state is wrong, and stays wrong until the NEXT resize. The fix is
  // to resample immediately after subscribing. `duringSubscribe` puts a resize exactly in that window: the width
  // moves after the render-time read and before any listener exists, so only a resample can see it.
  it("resamples right after subscribing, so a resize in the render→commit window is not lost", async () => {
    let cols = 40;
    const resize = fakeResize(() => { cols = 60; });
    const deps = { columns: () => cols, getSessionMessages: async () => [] as any[] };
    const r = await mount(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    await tick();
    expect(ruleWidths(frame(r.lastFrame))).toContain(60);
    expect(ruleWidths(frame(r.lastFrame))).not.toContain(40);
  });

  // …and the resample is free, because the functional update hands back the PREVIOUS OBJECT when nothing moved.
  // Identity is the assertion: React compares the eager next state with Object.is, so an unchanged size never
  // schedules a render — which also de-duplicates a terminal that reports a resize to the size we already hold.
  it("hands back the previous size object when the size has not moved", () => {
    const prev = { columns: 40, rows: 24 };
    expect(nextSize(prev, { columns: 40, rows: 24 })).toBe(prev);
    expect(nextSize(prev, { columns: 60, rows: 24 })).toEqual({ columns: 60, rows: 24 });
    expect(nextSize(prev, { columns: 40, rows: 50 })).not.toBe(prev);
  });

  // The same guard seen from outside the component. NB the FIRST fire after a mount can still commit — React
  // only takes the eager bail-out path when the fiber has no pending lanes, and the mount leaves some — so the
  // pin is on every fire after it: identical size, no further render, while a real change still renders.
  it("schedules no render for an identical-size resize, and still renders for a real one", async () => {
    let cols = 40;
    const resize = fakeResize();
    let commits = 0;
    const deps = { columns: () => cols, getSessionMessages: async () => [] as any[] };
    const r = await mount(<React.Profiler id="resize" onRender={() => { commits++; }}><ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} /></React.Profiler>);
    await quiesced(() => commits);
    resize.fire(); await tick();
    const drained = commits;
    resize.fire(); await tick();
    resize.fire(); await tick();
    expect(commits).toBe(drained);                                  // two more identical resizes: zero renders
    cols = 60;
    resize.fire(); await tick();
    expect(commits).toBeGreaterThan(drained);                       // …and the probe is live, not merely silent
    expect(ruleWidths(frame(r.lastFrame))).toContain(60);
  });

  // WAVE 2 TASK 7 (s2qa2-05) — GROWING OUT OF A HEIGHT-CLIPPED TALL SURFACE. At 60x15 a `/model` picker's frame
  // reaches the pane height, so Ink takes its tall-frame branch (ink.js:118-122), writes straight to stdout and
  // leaves log-update's counters describing an older, shorter frame. Growing the pane then strands the picker's
  // header: the write-time corrector refuses (no recorded frame, and a grow besides), and Wave R's recovery
  // (ChatApp's `transcriptOpen` true→false edge) is the PAGER's — a dialog was a named residual.
  //   The repair is the same one, fed by a second edge. Both halves of the t8 argument are kept intact: the
  // `tallWrites() > 0` stand-down is untouched (loosening it is the over-erase that destroyed six live rows,
  // chatMain.tsx:134-149), and the trigger is an EDGE — the size actually moved upward — never a level.
  //   AND THE FACT IT KEYS ON HAS TO BE LATCHED AT THE SIGNAL (fix round 1, finding 1). Ink's own resize handler
  // is synchronous (`ink.js:83`) and runs BEFORE React commits, so on a grow that lets the frame fit again it
  // writes an ordinary frame first — which is both the write that strands the picker's header AND the write that
  // stands `tallWrites()` back to 0 (`chatMain.tsx`'s `record`). Read live from a passive effect the count is
  // therefore zero in exactly the scenario this edge exists for. ccx's own resize listener is attached before
  // `render()` and runs ahead of Ink's, so the fact is captured there and read here as a one-shot latch; the
  // stand-down itself is untouched.
  describe("growing while a tall write is outstanding", () => {
    /** The proxy's task-7 surface: the latch ccx's resize listener sets (`noteResizeSignal` → `takeTallAtSignal`)
     *  and the recorded frame the height guard measures. `frame` is what Ink's ordinary write recorded on the
     *  grow — 2 rows against the 24-row default pane, so the guard passes unless a case says otherwise. */
    const fakeProxy = () => {
      const state = { tall: 0, resynced: 0, latched: false, frame: "one\ntwo\n" as string | undefined };
      return { state, output: { repaint: (run: () => void) => run(), tallWrites: () => state.tall,
        screenResynced: () => { state.tall = 0; state.resynced += 1; },
        takeTallAtSignal: () => { const v = state.latched; state.latched = false; return v; },
        lastFrame: () => state.frame } };
    };
    const mountWith = async (cols: () => number, resize: ReturnType<typeof fakeResize>, proxy: ReturnType<typeof fakeProxy>, resync: () => boolean) =>
      mount(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ columns: cols, getSessionMessages: async () => [] as any[] }} onResize={resize.onResize}
        resumeOutput={proxy.output} resyncViewport={resync} />);

    it("resyncs the viewport once, on the grow itself", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1;                                          // the clipped picker took ink.js:118
      proxy.state.latched = true;                                    // …and the signal caught it standing
      expect(resync).not.toHaveBeenCalled();                         // an armed latch still does not fire at mount
      cols = 120;
      resize.fire();
      await tick();
      expect(resync).toHaveBeenCalledTimes(1);
      expect(proxy.state.resynced).toBe(1);                          // …and the proxy is told, so it stops asking
      expect(proxy.state.tall).toBe(0);
      r.unmount();
    });

    // FIX ROUND 1, FINDING 1 — THE SCENARIO THE EDGE WAS WRITTEN FOR, AND THE ONE THE LIVE COUNT CANNOT SEE. Ink
    // handles the same SIGWINCH synchronously and, on a grow that lets the frame fit, writes it through
    // log-update: that write strands the picker's header AND stands `tallWrites()` back to 0, both before this
    // passive effect runs. Reading the count live here is therefore reading it after the evidence was erased.
    it("fires on the fact latched at the signal, even though the live count is already back to 0", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.latched = true;                                    // ccx's listener saw the tall write standing…
      proxy.state.tall = 0;                                          // …and Ink's ordinary frame then stood it down
      cols = 120;
      resize.fire();
      await tick();
      expect(resync).toHaveBeenCalledTimes(1);
      r.unmount();
    });

    // ONE-SHOT. The latch is a fact about ONE signal, so it is consumed when read: a drag that grows in five
    // steps arms it on the first of them (the only one with a tall write outstanding) and resyncs once.
    it("consumes the latch, so one tall episode resyncs once however many signals the drag emits", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1; proxy.state.latched = true;
      cols = 90; resize.fire(); await tick();
      expect(resync).toHaveBeenCalledTimes(1);
      expect(proxy.state.latched).toBe(false);                       // …consumed by that read
      cols = 120; resize.fire(); await tick();                       // the drag keeps growing, nothing tall outstanding
      cols = 150; resize.fire(); await tick();
      expect(resync).toHaveBeenCalledTimes(1);
      r.unmount();
    });

    // The erase is viewport-bounded, but it is still an erase: on a NARROWING the residue is above the viewport's
    // top as often as not, and Wave R's own corrector owns that direction at the write. This is also the case
    // that pins the direction ref (the identical-size case below is carried by `nextSize`'s dedupe, not by it).
    it("never fires on a shrink", async () => {
      let cols = 120;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1; proxy.state.latched = true;
      cols = 60;
      resize.fire();
      await tick();
      expect(resync).not.toHaveBeenCalled();
      expect(proxy.state.tall).toBe(1);
      // …and it DRAINS the latch on its way past (external review, finding C). The latch spans the signals
      // since React last observed the size, so a shrink React has now observed ends the burst it describes:
      // left standing, a much later grow on an ordinary screen would inherit it and wipe live rows.
      expect(proxy.state.latched).toBe(false);
      r.unmount();
    });

    // The t8 gate, unchanged and load-bearing: `clearViewport` blanks the whole viewport, which is safe only
    // while the viewport holds nothing but a tall chunk's own bytes. On an ordinary screen a grow is Ink's own
    // business and wiping it destroys live <Static> rows.
    it("never fires when no tall write was outstanding when the signal arrived", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1;                                          // a tall write since the signal is not the fact
      cols = 120;
      resize.fire();
      await tick();
      expect(resync).not.toHaveBeenCalled();
      r.unmount();
    });

    // FIX ROUND 1, FINDING 4 — THE BOUNDED HEIGHT GUARD. This edge is the first caller of `clearViewport` that
    // can run while a tall surface is still up, and the forced repaint pushes Ink's `lastOutput` through
    // log-update with Ink's own `outputHeight >= rows` check bypassed: a still-screen-tall frame would leave
    // `previousLineCount` larger than the viewport, and log-update's next erase cannot walk that far. The frame
    // the proxy recorded IS Ink's `lastOutput` (that is what a recorded frame write means), so the fit is
    // measured rather than assumed — and no recorded frame at all means the last write bypassed log-update,
    // i.e. the surface is still tall and there is nothing stranded to repair anyway.
    it("declines when the frame Ink would repaint does not fit the viewport", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.latched = true;
      proxy.state.frame = Array.from({ length: 30 }, (_, i) => `row ${i}`).join("\n") + "\n";   // 30 rows, pane is 24
      cols = 120;
      resize.fire(); await tick();
      expect(resync).not.toHaveBeenCalled();
      r.unmount();
    });

    it("declines when the proxy has no recorded frame — Ink's last write bypassed log-update", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1; proxy.state.latched = true;
      proxy.state.frame = undefined;
      cols = 120;
      resize.fire(); await tick();
      expect(resync).not.toHaveBeenCalled();
      r.unmount();
    });

    // AN EDGE, NOT A LEVEL (ChatApp.tsx:466-480, the wave's history-vs-state lesson). "The terminal is wider than
    // it was" is true forever after one grow; only the transition may fire. A resize that reports a size we
    // already hold is not a transition, whatever the latch says — `nextSize` hands back the previous object, so
    // the effect never re-runs. (The DIRECTION ref is what the shrink case above pins.)
    it("treats an identical-size report as no transition, even with the latch armed", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1; proxy.state.latched = true;
      cols = 120;
      resize.fire(); await tick();
      expect(resync).toHaveBeenCalledTimes(1);
      proxy.state.tall = 1; proxy.state.latched = true;              // another tall surface goes up, another signal…
      resize.fire(); await tick();
      resize.fire(); await tick();                                   // …and the terminal reports its size again
      expect(resync).toHaveBeenCalledTimes(1);
      expect(proxy.state.tall).toBe(1);
      r.unmount();
    });

    // ── EXTERNAL REVIEW (codex, finding C) — MORE THAN ONE SIGNAL PER FLUSH ─────────────────────────────
    // The two cases below drive the REAL proxy rather than `fakeProxy`, because what is under test is the
    // latch's own arithmetic against React's batching, and a fake that models the latch cannot fail for the
    // reason the real one does. `fire()` here is `chatMain.tsx`'s `onTerminalResize` verbatim: ccx's listener
    // (the proxy's latch) and then Ink's/React's, in that order.
    /** A tall chunk (`ink.js:118-122`) on screen, then the frame Ink writes for a grow that lets it fit —
     *  the write that strands the tall surface's header AND stands `tallWrites()` back to 0. */
    const TALL = "\x1b[2J\x1b[3J\x1b[H" + "scrollback\n" + "picker\n";
    const FITS = "\x1b[2K\x1b[G" + "one\ntwo\n";
    const realProxy = (columns: number) => {
      const screen = { isTTY: true, columns, rows: 24, write: () => true };
      return { screen, out: createResumeSafeStdout(screen as never) };
    };

    // A drag emits SIGWINCHes faster than React flushes passive effects, and only the FIRST of them can see
    // the tall write standing: Ink handles each signal synchronously and its fitting frame stands the count
    // down before the second signal arrives. A latch that re-states itself at every signal therefore reports
    // `false` to the one effect that runs for the whole burst, and the header the grow stranded is left on
    // screen for the life of the session. The latch describes the SIGNALS SINCE REACT LAST OBSERVED THE SIZE,
    // not the last of them.
    it("resyncs when two grow signals share one flush and only the first saw the tall write", async () => {
      const { screen, out } = realProxy(60);
      const resize = fakeResize(), resync = vi.fn(() => true);
      const fire = (to: number) => { screen.columns = to; out.noteResizeSignal(); resize.fire(); };
      const r = await mountWith(() => screen.columns, resize, { state: { resynced: 0 }, output: out } as never, resync);
      out.stdout.write(TALL);                                        // the clipped picker took ink.js:118
      fire(90);                                                      // …and this signal catches it standing
      out.stdout.write(FITS);                                        // Ink's own synchronous handling, same signal
      fire(120);                                                     // …and the drag keeps going, before React runs
      await tick();
      expect(resync).toHaveBeenCalledTimes(1);                       // was 0: the second signal re-stated the fact away
      r.unmount();
    });

    // …AND THE CARRY IS BOUNDED BY THAT SAME SENTENCE, which is what keeps this off the sticky form the task
    // review rejected. A latch that only ever ORed would survive an arbitrary run of later signals and fire a
    // viewport wipe on an ordinary screen — the t8 over-erase, six live transcript rows. Every size React
    // observes CONSUMES it, shrink included, so the burst it describes can never outlive the flush that saw it.
    it("does not resync on a later grow when the shrink React already observed drained the latch", async () => {
      const { screen, out } = realProxy(120);
      const resize = fakeResize(), resync = vi.fn(() => true);
      const fire = (to: number) => { screen.columns = to; out.noteResizeSignal(); resize.fire(); };
      const r = await mountWith(() => screen.columns, resize, { state: { resynced: 0 }, output: out } as never, resync);
      out.stdout.write(TALL);
      fire(60);                                                      // a SHRINK with the tall write outstanding
      await tick();
      expect(resync).not.toHaveBeenCalled();                         // the direction gate: never on a narrowing
      out.stdout.write(FITS);                                        // …the screen goes back in sync on its own…
      fire(120);                                                     // …and an ordinary grow must not inherit that latch
      await tick();
      expect(resync).not.toHaveBeenCalled();
      r.unmount();
    });

    // A reset that could not write (no tty — `clearViewport` returns false there) has resynchronized nothing, so
    // the count must stand rather than be cleared on its behalf.
    it("leaves the count standing when the reset declines to write", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy();
      const r = await mountWith(() => cols, resize, proxy, () => false);
      proxy.state.tall = 1; proxy.state.latched = true;
      cols = 120;
      resize.fire();
      await tick();
      expect(proxy.state.resynced).toBe(0);
      expect(proxy.state.tall).toBe(1);
      r.unmount();
    });
  });

  it("unsubscribes on unmount, so a torn-down app never keeps setting state off the terminal", async () => {
    const resize = fakeResize();
    const deps = { columns: () => 40, getSessionMessages: async () => [] as any[] };
    const r = await mount(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    expect(resize.count).toBe(1);
    r.unmount();
    await tick();
    expect(resize.count).toBe(0);
  });
});
