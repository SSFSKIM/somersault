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
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";
import { eraseRows } from "../../src/tui/resizeRepaint.js";
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

/** …and the REAL proxy over a stub terminal, for the two cases whose whole subject is WHEN the count stands and
 *  when it falls (t8 review). Faking it there would make the test assert its own fake: the rule under test — a
 *  recorded frame write puts `tallWrites()` back to 0 — is production code in `createResumeSafeStdout`, so these
 *  cases drive it with the actual byte sequences instead of assigning to a counter. Ink's own writes never reach
 *  it here (`ink-testing-library` renders to its own stub), which is why the writes are made by hand. */
function realProxy() {
  const screen = { isTTY: true, columns: 120, rows: 40, chunks: [] as string[], write(c: string) { this.chunks.push(c); return true; } };
  const out = createResumeSafeStdout(screen as unknown as NodeJS.WriteStream);
  const tallChunk = (body: string) => "\x1b[2J\x1b[3J\x1b[H" + "committed transcript\n" + body;
  return { screen, out, tallChunk, frameWrite: () => out.stdout.write(eraseRows(2) + "an ordinary frame\n") };
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

  // THE CRITICAL CASE FROM THE t8 REVIEW, and the reason the gate reads current state rather than history. The
  // pager is not the only surface that reaches the pane height: the `?` overlay, `/help`, `/model` and the launch
  // frame itself were all measured taking ink.js:118 at 50x8. Under the first version of this gate every one of
  // them left the count standing until the NEXT pager close, and that close then wiped a viewport it had not
  // prepared — the reviewer's live A/B destroyed 6 of 6 transcript rows this way (`?` opened and closed at 60x15,
  // resize to 120x40, three `! echo` markers, ctrl+o — not tall at that size — Escape). A frame write is the
  // whole answer: it went through log-update, so the zero-byte-close dedupe the repaint exists for is gone.
  it("never fires when a NON-pager surface raised the count and an ordinary frame write has landed since", async () => {
    const proxy = realProxy();
    const resync = vi.fn(() => true);
    const r = renderWithKeymap(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }}
      cwd={process.cwd()} resumeOutput={proxy.out} resyncViewport={resync} />);
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    proxy.out.stdout.write(proxy.tallChunk("│ ? shortcuts overlay"));   // the `?` overlay goes tall — NOT the pager
    proxy.out.stdout.write(proxy.tallChunk("│ ? shortcuts overlay"));
    expect(proxy.out.tallWrites()).toBe(2);
    proxy.frameWrite();                                                 // …and then an ordinary frame repaints
    expect(proxy.out.tallWrites()).toBe(0);
    r.stdin.write("\x0f");                                              // now the pager cycles, at a size where it never goes tall
    await waitFor(() => frame(r.lastFrame).includes("Transcript"));
    r.stdin.write("\x0f");
    await waitFor(() => !frame(r.lastFrame).includes("Transcript"));
    expect(resync).not.toHaveBeenCalled();
    r.unmount();
  });

  // …and the positive control on the SAME real proxy, so the case above cannot pass by breaking the wiring. The
  // genuine pager close: a tall chunk, no frame write behind it (Ink writes nothing on close — the post-close
  // frame is byte-identical to the pre-pager one and log-update.js:13 swallows it), so the count stands and the
  // repaint is the only thing that can recover the screen.
  it("still fires when the tall write is the last thing that reached the terminal", async () => {
    const proxy = realProxy();
    const resync = vi.fn(() => true);
    const r = renderWithKeymap(<ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }}
      cwd={process.cwd()} resumeOutput={proxy.out} resyncViewport={resync} />);
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    proxy.frameWrite();                                                 // a clean screen to start from
    r.stdin.write("\x0f");
    await waitFor(() => frame(r.lastFrame).includes("Transcript"));
    proxy.out.stdout.write(proxy.tallChunk("│ pager row"));             // the pager's own frame takes ink.js:118
    expect(resync).not.toHaveBeenCalled();                              // …and is NOT wiped while it is up
    r.stdin.write("\x0f");
    await waitFor(() => !frame(r.lastFrame).includes("Transcript"));
    expect(resync).toHaveBeenCalledTimes(1);
    expect(proxy.out.tallWrites()).toBe(0);                             // the repaint's ack (and its own frame write) clear it
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
