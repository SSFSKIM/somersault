// test/tui/resize-state.test.tsx — Wave R task 1, defect (i): a terminal resize must RE-RENDER the tree.
// `grep -rn 'on("resize"' src/` returned nothing before this task: nothing in ccx subscribed at all, and
// Ink's own handler (node_modules/ink/build/ink.js:83) only re-runs Yoga over the EXISTING element tree —
// it never re-renders components, so `ChatApp`'s `terminalColumns()` was re-read only when something else
// happened to render. Every width-derived string froze at the launch width. The composer's own rules
// (`ComposerFrame`, CM1: two full-width `─` runs) are the cheapest width-derived string in the tree, so
// they are what this file measures.
import React from "react";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
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

/** The injected `onResize` seam: subscribe → returns unsubscribe, exactly the shape ChatApp defaults to
 *  over `process.stdout`'s "resize" event. */
function fakeResize() {
  const cbs = new Set<() => void>();
  return {
    onResize: (cb: () => void) => { cbs.add(cb); return () => { cbs.delete(cb); }; },
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
