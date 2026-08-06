// test/tui/resize-dialogs.test.tsx — Wave R task 5 (qa2-10a, A5/A12): a DIALOG that is on screen when the
// terminal resizes must re-derive its geometry from the app's size state, exactly as the composer does.
//
// The filed defect is one line: `ModelPicker` ACCEPTS `rows`/`columns` (ModelPicker.tsx:31) and ChatApp
// rendered it passing NEITHER, so the picker fell through to `Select`'s own `process.stdout` defaults — read
// once, at the width the picker happened to mount at, with no route back to the terminal afterwards. Task 1
// made the size React state; the fix is to THREAD it, not to add a second re-derivation inside the dialog.
//
// Each case asserts in BOTH directions (wide→narrow AND narrow→wide) on purpose. A one-direction assertion
// can be satisfied by an unfixed build that happens to be stuck at a width matching the expectation — the
// pre-fix picker reads the real `process.stdout`, whose size in a vitest worker is whatever the runner's
// stdio reports. Two directions cannot both be satisfied by a constant.
import React from "react";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ModelPicker, type ModelInfo } from "../../src/tui/ModelPicker.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";

let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-rd-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** resize-state.test.tsx's seam, verbatim in shape: subscribe → unsubscribe, the same contract ChatApp
 *  defaults to over `process.stdout`'s "resize" event. */
function fakeResize() {
  const cbs = new Set<() => void>();
  return { onResize: (cb: () => void) => { cbs.add(cb); return () => { cbs.delete(cb); }; }, fire: () => { for (const cb of [...cbs]) cb(); } };
}

/** A label long enough that `Select`'s two-column arithmetic (`labelColumnWidth`: `min(widest, floor(columns
 *  * 0.6))`) clips it at a narrow width and prints it whole at a wide one. The clip is the cheapest
 *  width-derived string this dialog owns. */
const LONG = "Opus 5 with a deliberately long display name";
const MODELS: ModelInfo[] = [
  { value: "opus", displayName: LONG, description: "most capable" },
  { value: "sonnet", displayName: "Sonnet 4.7 also rather long here", description: "balanced" },
];
/** Ten rows, so `clampVisible` — not the catalog — is what decides how many are painted at a given height. */
const MANY: ModelInfo[] = Array.from({ length: 10 }, (_, i) => ({ value: `m${i}`, displayName: `Model number ${i}`, description: `description ${i}` }));
/** How many of MANY's rows the frame is currently showing. */
const modelRowCount = (f: string) => strip(f).split("\n").filter((l) => /Model number \d/.test(l)).length;

describe("ModelPicker re-derives its geometry from the size it is given", () => {
  it("clips its label column at a narrow width and prints it whole at a wide one, on a live remount-free prop change", async () => {
    const r = renderWithKeymap(<ModelPicker models={MODELS} onPick={() => {}} onCancel={() => {}} savePrefs={() => {}} rows={40} columns={200} />);
    await waitFor(() => frame(r.lastFrame).includes("Select model"));
    expect(strip(frame(r.lastFrame))).toContain(LONG);
    r.rerender(<ModelPicker models={MODELS} onPick={() => {}} onCancel={() => {}} savePrefs={() => {}} rows={40} columns={40} />);
    await tick();
    expect(strip(frame(r.lastFrame))).not.toContain(LONG);
    expect(strip(frame(r.lastFrame))).toContain("…");
    r.rerender(<ModelPicker models={MODELS} onPick={() => {}} onCancel={() => {}} savePrefs={() => {}} rows={40} columns={200} />);
    await tick();
    expect(strip(frame(r.lastFrame))).toContain(LONG);
    r.unmount();
  });

  it("windows its list from the height it is given", async () => {
    const r = renderWithKeymap(<ModelPicker models={MANY} onPick={() => {}} onCancel={() => {}} savePrefs={() => {}} rows={40} columns={200} />);
    await waitFor(() => frame(r.lastFrame).includes("Select model"));
    expect(modelRowCount(frame(r.lastFrame))).toBe(10);
    r.rerender(<ModelPicker models={MANY} onPick={() => {}} onCancel={() => {}} savePrefs={() => {}} rows={14} columns={200} />);
    await tick();
    expect(modelRowCount(frame(r.lastFrame))).toBe(3);                 // clampVisible(10, 14, 2) — two rows of chrome per option
    r.unmount();
  });
});

/** Open `/model` the way a user does — the composer's command line, then Enter (chat.test.tsx's own recipe). */
async function openModelPicker(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined) {
  stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model"));
  stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model"));
}

describe("a dialog on screen when the terminal resizes follows the new size", () => {
  it("the open /model picker re-derives its width — the qa2-10a defect", async () => {
    let cols = 200;
    const resize = fakeResize();
    const deps = { columns: () => cols, getSessionMessages: async () => [] as any[] };
    const session = fakeRemote({ capabilities: () => ({ models: MODELS, commands: [], mcpServers: [] }) });
    const r = renderWithKeymap(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    await openModelPicker(r.stdin, r.lastFrame);
    expect(strip(frame(r.lastFrame))).toContain(LONG);
    cols = 40; resize.fire(); await tick();
    expect(strip(frame(r.lastFrame))).not.toContain(LONG);             // the shrink reaches the OPEN dialog
    cols = 200; resize.fire(); await tick();
    expect(strip(frame(r.lastFrame))).toContain(LONG);                 // …and so does the widening
    r.unmount();
  });

  it("the open /model picker re-windows its list when the terminal HEIGHT changes", async () => {
    let rows = 40;
    const resize = fakeResize();
    const deps = { columns: () => 200, getSessionMessages: async () => [] as any[] };
    const session = fakeRemote({ capabilities: () => ({ models: MANY, commands: [], mcpServers: [] }) });
    const r = renderWithKeymap(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    // ink-testing-library's fake stdout reports a width and NO height at all; ChatApp reads `stdout.rows`, so
    // the height seam a test has is the property itself.
    Object.defineProperty(r.stdout, "rows", { configurable: true, get: () => rows });
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    await openModelPicker(r.stdin, r.lastFrame);
    resize.fire(); await tick();
    expect(modelRowCount(frame(r.lastFrame))).toBe(10);
    rows = 14; resize.fire(); await tick();
    expect(modelRowCount(frame(r.lastFrame))).toBe(3);
    rows = 40; resize.fire(); await tick();
    expect(modelRowCount(frame(r.lastFrame))).toBe(10);
    r.unmount();
  });

  // The sibling sweep the task asked for: every dialog rendered near the picker that ACCEPTS a size prop had
  // the same omission. `/resume`'s list is windowed by `resumeVisibleRows(rows)`, so the height is what shows.
  it("the open /resume session picker re-windows when the terminal HEIGHT changes", async () => {
    let rows = 40;
    const resize = fakeResize();
    const sessions = Array.from({ length: 12 }, (_, i) => ({ sessionId: `s${i}`, summary: `saved session ${i}`, lastModified: i }));
    const deps = { columns: () => 200, listSessions: async () => sessions, getSessionMessages: async () => [] as any[] };
    const session = fakeRemote();
    const r = renderWithKeymap(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    Object.defineProperty(r.stdout, "rows", { configurable: true, get: () => rows });
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    r.stdin.write("/resume"); await waitFor(() => frame(r.lastFrame).includes("/resume"));
    r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("Resume session"));
    const rowCount = () => strip(frame(r.lastFrame)).split("\n").filter((l) => /saved session \d/.test(l)).length;
    resize.fire(); await tick();
    const tall = rowCount();
    rows = 14; resize.fire(); await tick();
    const short = rowCount();
    expect(short).toBeLessThan(tall);
    rows = 40; resize.fire(); await tick();
    expect(rowCount()).toBe(tall);
    r.unmount();
  });
});
