// test/tui/pager-resync.test.tsx — Wave R task 8 (EP-R4), the WIRING half. What the tall-frame branch itself
// does to the bookkeeping is pinned in test/unit/pager-bookkeeping.test.ts against the real proxy and a
// line-for-line Ink model; neither of those can live here, because `ink-testing-library` renders with
// `debug: true` (its build/index.js) and the debug arm returns at ink.js:100-107, before ink.js:118's tall
// branch is ever reached — and its stdout stub carries no `rows` for that comparison anyway. So the proxy is
// FAKED here and only ChatApp's decision is under test: WHEN does it fire the viewport reset, and — the half
// that matters more — when does it refuse to.
//
// The refusal is the safety property. `clearViewport` blanks the whole viewport; run it on an ordinary screen
// and it erases live <Static> transcript rows that have not scrolled into scrollback yet. It is safe only while
// the viewport holds nothing but a tall chunk's own bytes, which is exactly what a standing `tallWrites()` count
// reports and nothing else does.
import React from "react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";

let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-t8-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

/** The proxy's task-8 surface, driven by hand. `tall` is raised BEFORE the commit whose frame would have taken
 *  the branch, which is the real ordering: the proxy counts the chunk during Ink's `resetAfterCommit`, and
 *  ChatApp's passive effect observes it after. */
function fakeProxy() {
  const state = { tall: 0, resynced: 0 };
  return {
    state,
    output: { repaint: (run: () => void) => run(), tallWrites: () => state.tall, screenResynced: () => { state.tall = 0; state.resynced += 1; } },
  };
}

describe("closing a surface that took Ink's tall-frame branch resets the viewport", () => {
  it("fires the reset once the pager comes down, and not on the commit that put it up", async () => {
    const proxy = fakeProxy();
    const resync = vi.fn(() => true);
    const r = renderWithKeymap(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }}
      cwd={process.cwd()} resumeOutput={proxy.output} resyncViewport={resync} />);
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    expect(resync).not.toHaveBeenCalled();                       // nothing tall has happened yet
    proxy.state.tall = 1;                                        // the pager's own frame reaches the pane height
    r.stdin.write("\x0f");                                       // Ctrl-O opens
    await waitFor(() => frame(r.lastFrame).includes("Transcript"));
    expect(resync).not.toHaveBeenCalled();                       // …and the reset must NOT wipe the pager we just painted
    r.stdin.write("\x0f");                                       // Ctrl-O closes
    await waitFor(() => !frame(r.lastFrame).includes("Transcript"));
    expect(resync).toHaveBeenCalledTimes(1);
    expect(proxy.state.resynced).toBe(1);                        // …and the proxy is told, so it stops asking
    expect(proxy.state.tall).toBe(0);
    r.unmount();
  });

  // The whole pager cycle on a terminal tall enough that Ink never took the branch. Ink's own repaint is correct
  // there, the viewport holds live rows, and wiping it would be pure damage.
  it("never fires when the proxy reports no tall write", async () => {
    const proxy = fakeProxy();
    const resync = vi.fn(() => true);
    const r = renderWithKeymap(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }}
      cwd={process.cwd()} resumeOutput={proxy.output} resyncViewport={resync} />);
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    r.stdin.write("\x0f");
    await waitFor(() => frame(r.lastFrame).includes("Transcript"));
    r.stdin.write("\x0f");
    await waitFor(() => !frame(r.lastFrame).includes("Transcript"));
    expect(resync).not.toHaveBeenCalled();
    expect(proxy.state.resynced).toBe(0);
    r.unmount();
  });

  // The regression this pins is the one the first implementation shipped with. It inferred "the tall surface came
  // down" from the tall count standing still across a commit; every keypress inside the pager that re-rendered
  // without bumping the count then read as a close and wiped the pager out from under the user. Scrolling and
  // Ctrl-E are exactly those keypresses, so they are what the case sends.
  it("never fires on a render made while the pager is still up, whatever the count does", async () => {
    const proxy = fakeProxy();
    const resync = vi.fn(() => true);
    const r = renderWithKeymap(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }}
      cwd={process.cwd()} resumeOutput={proxy.output} resyncViewport={resync} />);
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    proxy.state.tall = 1;
    r.stdin.write("\x0f");
    await waitFor(() => frame(r.lastFrame).includes("Transcript"));
    for (const key of ["\x05", "\x05", "\x04"]) {                // Ctrl-E toggle, Ctrl-E back, Ctrl-D half-page
      r.stdin.write(key); await tick(); await tick();            // …and the count deliberately does NOT move
    }
    expect(resync).not.toHaveBeenCalled();
    r.stdin.write("\x0f");
    await waitFor(() => !frame(r.lastFrame).includes("Transcript"));
    expect(resync).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  // A caller that could not write (no tty — `clearViewport` returns false there) has not resynchronized anything,
  // so the count must stand rather than be cleared on its behalf.
  it("leaves the count standing when the reset declines to write", async () => {
    const proxy = fakeProxy();
    const r = renderWithKeymap(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }}
      cwd={process.cwd()} resumeOutput={proxy.output} resyncViewport={() => false} />);
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    proxy.state.tall = 1;
    r.stdin.write("\x0f");
    await waitFor(() => frame(r.lastFrame).includes("Transcript"));
    r.stdin.write("\x0f");
    await waitFor(() => !frame(r.lastFrame).includes("Transcript"));
    expect(proxy.state.resynced).toBe(0);
    expect(proxy.state.tall).toBe(1);
    r.unmount();
  });
});
