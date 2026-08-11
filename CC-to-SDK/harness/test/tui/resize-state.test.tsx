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
  describe("growing while a tall write is outstanding", () => {
    const fakeProxy = () => {
      const state = { tall: 0, resynced: 0 };
      return { state, output: { repaint: (run: () => void) => run(), tallWrites: () => state.tall, screenResynced: () => { state.tall = 0; state.resynced += 1; } } };
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
      expect(resync).not.toHaveBeenCalled();                         // …and nothing fires at mount, however it stands
      cols = 120;
      resize.fire();
      await tick();
      expect(resync).toHaveBeenCalledTimes(1);
      expect(proxy.state.resynced).toBe(1);                          // …and the proxy is told, so it stops asking
      expect(proxy.state.tall).toBe(0);
      r.unmount();
    });

    // The erase is viewport-bounded, but it is still an erase: on a NARROWING the residue is above the viewport's
    // top as often as not, and Wave R's own corrector owns that direction at the write.
    it("never fires on a shrink", async () => {
      let cols = 120;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1;
      cols = 60;
      resize.fire();
      await tick();
      expect(resync).not.toHaveBeenCalled();
      expect(proxy.state.tall).toBe(1);
      r.unmount();
    });

    // The t8 gate, unchanged and load-bearing: `clearViewport` blanks the whole viewport, which is safe only
    // while the viewport holds nothing but a tall chunk's own bytes. On an ordinary screen a grow is Ink's own
    // business and wiping it destroys live <Static> rows.
    it("never fires when the proxy reports no tall write", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      cols = 120;
      resize.fire();
      await tick();
      expect(resync).not.toHaveBeenCalled();
      r.unmount();
    });

    // AN EDGE, NOT A LEVEL (ChatApp.tsx:466-480, the wave's history-vs-state lesson). "The terminal is wider than
    // it was" is true forever after one grow; only the transition may fire. A resize that reports a size we
    // already hold is not a transition, whatever the tall count does in the meantime.
    it("does not fire again while the terminal simply stays large", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy(), resync = vi.fn(() => true);
      const r = await mountWith(() => cols, resize, proxy, resync);
      proxy.state.tall = 1;
      cols = 120;
      resize.fire(); await tick();
      expect(resync).toHaveBeenCalledTimes(1);
      proxy.state.tall = 1;                                          // another tall surface goes up…
      resize.fire(); await tick();
      resize.fire(); await tick();                                   // …and the terminal reports its size again
      expect(resync).toHaveBeenCalledTimes(1);
      expect(proxy.state.tall).toBe(1);
      r.unmount();
    });

    // A reset that could not write (no tty — `clearViewport` returns false there) has resynchronized nothing, so
    // the count must stand rather than be cleared on its behalf.
    it("leaves the count standing when the reset declines to write", async () => {
      let cols = 60;
      const resize = fakeResize(), proxy = fakeProxy();
      const r = await mountWith(() => cols, resize, proxy, () => false);
      proxy.state.tall = 1;
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
