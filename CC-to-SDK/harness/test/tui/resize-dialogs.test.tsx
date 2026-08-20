// test/tui/resize-dialogs.test.tsx — Wave R task 5 (qa2-10a, A5/A12): a DIALOG that is on screen when the
// terminal resizes must re-derive its geometry from the app's size state, exactly as the composer does.
//
// The filed defect is one line: `ModelPicker` ACCEPTS `rows`/`columns` (ModelPicker.tsx:31) and ChatApp
// rendered it passing NEITHER, so the picker fell through to `Select`'s own `process.stdout` defaults. Task 1
// made the size React state; the fix is to THREAD it, not to add a second re-derivation inside the dialog.
//
// WHAT MAKES THE STDOUT DEFAULT WRONG (fix round 1 — an earlier version of this header said it was read "once,
// at mount, with no route back", which is not true: a default parameter re-evaluates every render, and after
// Task 1 every SIGWINCH re-renders). It is wrong because it is a SECOND, uninjectable source of size.
// `deps.columns`/`terminalRows()` is the one the app, the composer and every fixture pin; a dialog that reads
// `process.stdout` behind that pin ignores it — which is precisely why these tests can exist at all. Under
// `ink-testing-library` the fake stdout reports the vitest runner's own geometry (and no `rows` whatsoever),
// so an unthreaded dialog measures a terminal nobody in the test is describing.
//
// Each case asserts in BOTH directions (wide→narrow AND narrow→wide) on purpose. A one-direction assertion
// can be satisfied by an unfixed build that happens to be stuck at a width matching the expectation — the
// pre-fix picker reads the real `process.stdout`, whose size in a vitest worker is whatever the runner's
// stdio reports. Two directions cannot both be satisfied by a constant.
import React from "react";
import { Box } from "ink";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ModelPicker, type ModelInfo } from "../../src/tui/ModelPicker.js";
import { SettingsDialog } from "../../src/tui/SettingsDialog.js";
import { PermissionsDialog } from "../../src/tui/PermissionsDialog.js";
import type { AddDirVerdict } from "../../src/tui/addDir.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";
import type { PendingEntry } from "../../src/permissions/pending.js";

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

// ── WAVE S t5 / t6b, ADDED IN THE t6b REVIEW ROUND ────────────────────────────────────────────────────────
// Two dialogs joined the windowed class after this file was written — `SettingsDialog` (t5 windowed its Config
// list) and `PermissionsDialog` (t6b windowed its rule and workspace lists) — and neither was added here. The
// gap was invisible because `chat.test.tsx`'s gate block says in prose that "resize-dialogs.test.tsx windows
// each dialog from the height it is given", which was true of the four members this file had and not of the
// two newest. The behaviour was fine when the review checked it by hand; what was missing was the pin. Both
// cases below follow `ModelPicker`'s "windows its list from the height it is given" shape exactly — a live
// `rerender` with a new `rows`, asserted in BOTH directions so a build stuck at one height cannot satisfy it.

/** The Config catalog is a FIXED six rows (settingsRows.ts's `buildRows` — W-C T7 added `Show turn duration`), so
 *  `settingsVisibleRows` — which is `max(1, rows − 11)` — saturates at six from a pane of 17 up. 40 shows all
 *  six and 13 shows two. */
const configRowCount = (f: string) => strip(f).split("\n").filter((l) => /(Theme|Model|Output style|Default permission mode|Thinking mode|Show turn duration)/.test(l)).length;
const settingsProps = {
  tab: "Config", onTabChange: () => {}, model: "opus", mode: "default", thinkLevel: "off", outputStyle: "default",
  onDone: () => {}, applyMode: async () => {}, setThink: async () => {}, applyOutputStyle: async () => {},
  fetchStatus: async () => [], fetchUsage: async () => [], fetchStats: async () => [],
  onOpenModelPicker: () => {}, savePrefs: () => {}, showTurnDuration: true, setShowTurnDuration: () => {}, reduceMotion: false, setReduceMotion: () => {}, promptSuggestionEnabled: false, setPromptSuggestionEnabled: () => {},
};

describe("SettingsDialog re-derives its geometry from the size it is given", () => {
  it("windows its Config list from the height it is given", async () => {
    const r = renderWithKeymap(<SettingsDialog {...settingsProps} rows={40} columns={200} />);
    await waitFor(() => strip(frame(r.lastFrame)).includes("❯ Theme"));
    expect(configRowCount(frame(r.lastFrame))).toBe(6);
    r.rerender(<SettingsDialog {...settingsProps} rows={13} columns={200} />);
    await tick();
    expect(configRowCount(frame(r.lastFrame))).toBe(2);                // settingsVisibleRows(13) = 13 − 11
    r.rerender(<SettingsDialog {...settingsProps} rows={40} columns={200} />);
    await tick();
    expect(configRowCount(frame(r.lastFrame))).toBe(6);
    r.unmount();
  });

  /** …and the WIDTH half, the row-clip round's own defect: a Config row wider than the frame used to WRAP, and
   *  a wrapped row breaks the window's one-option-one-line invariant. `settingsProps` sets `model: "opus"`, so
   *  the row here is `Model  opus   For a specific model ID, use /model.` (50 columns) — it fits the body at
   *  80 (74) and overflows it at 50 (44). This case asserts the CLIP and not the frame height, because
   *  `NORMAL_FOOTER` (49) takes a second line at 50 too — settings-dialog.test.tsx holds the height invariant,
   *  at a pair of widths where every chrome literal wraps identically. Both directions, like every case here.
   *    THE DISCRIMINATOR IS `/model.`, NOT `use /model.`, and the difference is the whole point: Ink WORD-wraps,
   *  so the unclipped row breaks between `use` and `/model.` and a frame that wrapped still contains neither
   *  `use /model.` nor `use   /model.` — an assertion on the joined phrase passes with the clip removed, which
   *  is how this case was first written and how it was caught. `/model.` survives the wrap on the second line
   *  and is absent entirely once the row is clipped (`…for a specific model ID, use …`). */
  const settingsAt = (cols: number) => <Box width={cols}><SettingsDialog {...settingsProps} rows={40} columns={cols} /></Box>;

  it("re-clips its Config row bodies when the width changes", async () => {
    const r = renderWithKeymap(settingsAt(80));
    await waitFor(() => strip(frame(r.lastFrame)).includes("For a specific model ID, use /model."));
    r.rerender(settingsAt(50));
    await tick();
    expect(strip(frame(r.lastFrame)), "the dim hint is what the clip eats into first").not.toContain("/model.");
    r.rerender(settingsAt(80));
    await tick();
    expect(strip(frame(r.lastFrame)), "…and the widening brings it back").toContain("For a specific model ID, use /model.");
    r.unmount();
  });
});

/** Twelve removable rules plus the `Add a new rule…` affordance row — thirteen options, so the pane and not
 *  the catalog is what decides how many print at every height swept. */
const PERM_RULES = { sources: [{ source: "flagSettings", settings: { permissions: { allow: Array.from({ length: 12 }, (_, i) => `Bash(cmd${i}:*)`) } } }] };
const permProps = {
  tab: "Allow", onTabChange: () => {}, denials: [], cwd: "/tmp",
  fetchSettings: async () => PERM_RULES as unknown,
  fetchDirs: async () => [] as { path: string; source: "cwd" | "launch" | "session" }[],
  addRule: async () => {}, removeRule: async () => {}, removeDir: async () => {},
  addDirValidate: async () => ({ kind: "missing", abs: "" }) as AddDirVerdict,
  confirmAddDir: async () => {}, cancelAddDir: () => {}, onDone: () => {},
};
const permRowCount = (f: string) => strip(f).split("\n").filter((l) => /Bash\(cmd\d+:\*\)/.test(l)).length;

describe("PermissionsDialog re-derives its geometry from the size it is given", () => {
  it("windows its rule list from the height it is given", async () => {
    const r = renderWithKeymap(<PermissionsDialog {...permProps} rows={30} columns={200} />);
    await waitFor(() => strip(frame(r.lastFrame)).includes("❯ Add a new rule…"));
    expect(permRowCount(frame(r.lastFrame))).toBe(12);                 // permissionsVisibleRows(30) = 17, all of them
    r.rerender(<PermissionsDialog {...permProps} rows={20} columns={200} />);
    await tick();
    expect(permRowCount(frame(r.lastFrame))).toBe(6);                  // 20 − 13, less the affordance row
    r.rerender(<PermissionsDialog {...permProps} rows={30} columns={200} />);
    await tick();
    expect(permRowCount(frame(r.lastFrame))).toBe(12);
    r.unmount();
  });

  /** …and the WIDTH half, which `PermissionsDialog` grew in the t6b review round: a row body wider than the
   *  frame used to WRAP, and a wrapped row breaks the window's one-option-one-line invariant.
   *
   *  Widths are 100 and 80, not this file's usual 200/40, and the `<Box width>` wrapper is load-bearing —
   *  `ink-testing-library`'s fake stdout reports a fixed 100 columns whatever a test says, and a width-less
   *  Ink box shrink-wraps its content, so without both the row would simply widen the box instead of wrapping.
   *  The rule is 54 columns; with two spaces and `From command line arguments` (29) the row is 85, which fits
   *  the body at 100 columns (94) and overflows it at 80 (74), while the Allow intro, the tab strip and the
   *  footer all fit on one line at both — so the frame's line count moves only if a ROW wrapped. */
  const LONG = "Bash(/Users/someone/GitHub/repo/pkgs/run-the-thing:*)".padEnd(54, "x");
  const one = { sources: [{ source: "flagSettings", settings: { permissions: { allow: [LONG] } } }] };
  const permAt = (cols: number) => (
    <Box width={cols}><PermissionsDialog {...permProps} fetchSettings={async () => one as unknown} rows={40} columns={cols} /></Box>
  );

  it("re-clips its row bodies when the width changes", async () => {
    const r = renderWithKeymap(permAt(100));
    await waitFor(() => strip(frame(r.lastFrame)).includes(`${LONG}  From command line arguments`));
    const tall = strip(frame(r.lastFrame)).split("\n").length;
    r.rerender(permAt(80));
    await tick();
    expect(strip(frame(r.lastFrame)), "the dim provenance span is what the clip eats into first").not.toContain("From command line arguments");
    expect(strip(frame(r.lastFrame)).split("\n").length, "the clipped row is still ONE line").toBe(tall);
    r.rerender(permAt(100));
    await tick();
    expect(strip(frame(r.lastFrame)), "…and the widening brings it back").toContain(`${LONG}  From command line arguments`);
    r.unmount();
  });

  /** …and the width's OTHER half, which the chrome-wrap round added: the intro and the footer wrap at a narrow
   *  width too, and each extra line they take is a row the height-only budget did not reserve. So this dialog's
   *  window is a function of the WIDTH as well — `permissionsVisibleRows(rows, tab, columns)` — and a resize
   *  that changes nothing about the height still has to re-window the list. At 100 columns the Allow tab wraps
   *  nothing; at 60 `DEFAULT_FOOTER` (65 columns) takes a second line and the window loses exactly one row. */
  const permAtWidth = (cols: number) => (
    <Box width={cols}><PermissionsDialog {...permProps} rows={20} columns={cols} /></Box>
  );

  it("re-windows its rule list when the WIDTH changes, because its own chrome wraps", async () => {
    const r = renderWithKeymap(permAtWidth(100));
    await waitFor(() => strip(frame(r.lastFrame)).includes("❯ Add a new rule…"));
    expect(permRowCount(frame(r.lastFrame))).toBe(6);                  // permissionsVisibleRows(20,"Allow",100) = 7, less the affordance row
    r.rerender(permAtWidth(60));
    await tick();
    expect(permRowCount(frame(r.lastFrame)), "the wrapped footer costs the list a row").toBe(5);
    r.rerender(permAtWidth(100));
    await tick();
    expect(permRowCount(frame(r.lastFrame)), "…and the widening gives it back").toBe(6);
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
    const deps = { columns: () => 200, hasWorktrees: async () => false, listSessions: async () => sessions, getSessionMessages: async () => [] as any[] };
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

  // ── the rest of the sweep, each dialog pinned by its OWN prop (fix round 1) ─────────────────────────────
  // The three tests above pin ModelPicker's width and height and SessionPicker's height — and NOTHING else.
  // Measured: deleting `rows`/`columns` from ChatApp's RewindPicker render site, `rows` from its PlanDialog
  // one, or `columns` from its SessionPicker one left the whole suite green, so three quarters of the sweep
  // shipped unprotected. Each test below was sabotage-checked by reverting exactly its own dialog's threading
  // and confirming that test — and only that test — went red.

  /** RewindPicker clips every row at `columns - REWIND_ROW_PADDING_RIGHT` (10, rewindModel.ts) and windows the
   *  list with `rewindVisibleRows(rows)` — one width-derived string and one height-derived count. */
  const LONG_PROMPT = "rename every helper in the toolbox module and update all of its call sites everywhere";
  const rewindRemote = (anchors: RewindAnchor[]) => ({
    ...fakeRemote(),
    rewindAnchors: async () => anchors,
    rewindDryRun: async () => ({ canRewind: true }) as RewindDryRun,
    rewind: async () => {},
  });
  /** Esc-Esc on an EMPTY composer, which is the only route to this picker (escape.test.tsx's own recipe). */
  async function openRewindPicker(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined) {
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Restore the code and/or conversation"));
  }

  it("the open rewind picker re-clips its rows when the terminal WIDTH changes", async () => {
    let cols = 200;
    const resize = fakeResize();
    const deps = { columns: () => cols, getSessionMessages: async () => [] as any[] };
    const session = rewindRemote([{ uuid: "u1", prevUuid: null, text: LONG_PROMPT, index: 0 }]);
    const r = renderWithKeymap(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    await openRewindPicker(r.stdin, r.lastFrame);
    expect(strip(frame(r.lastFrame))).toContain(LONG_PROMPT);
    cols = 40; resize.fire(); await tick();
    expect(strip(frame(r.lastFrame))).not.toContain(LONG_PROMPT);       // clipped at 40 − 10
    cols = 200; resize.fire(); await tick();
    expect(strip(frame(r.lastFrame))).toContain(LONG_PROMPT);
    r.unmount();
  });

  it("the open rewind picker re-windows its list when the terminal HEIGHT changes", async () => {
    let rows = 40;
    const resize = fakeResize();
    const deps = { columns: () => 200, getSessionMessages: async () => [] as any[] };
    // Eight anchors plus the synthetic `(current)` row: `rewindVisibleRows` is
    // max(2, floor((rows − REWIND_CHROME_ROWS − rewindWrapRows(columns)) / 3)) — the chrome constant counted
    // against the COMPOSED frame (dialog + status bar) in Wave S t4's fix round, plus the wrap allowance its
    // wrap round added, and the shipped call site — `RewindPicker.tsx:245`, not `ChatApp`, which threads
    // `columns` to the DIALOG and never calls this helper — ALWAYS passes `columns`. (The columns-omitted
    // branch is the older height-only budget, and it is what a bare `floor((rows−12)/3)` would describe.) At
    // this fixture's 200 columns the wrap allowance is 0 either way, so 40 has room for nine — which is all
    // the options there are — and 14 shows two. The catalog never decides.
    const anchors: RewindAnchor[] = Array.from({ length: 8 }, (_, i) => ({ uuid: `u${i}`, prevUuid: null, text: `rewind prompt ${i}`, index: i }));
    const session = rewindRemote(anchors);
    const r = renderWithKeymap(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    Object.defineProperty(r.stdout, "rows", { configurable: true, get: () => rows });
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    await openRewindPicker(r.stdin, r.lastFrame);
    const rowCount = () => strip(frame(r.lastFrame)).split("\n").filter((l) => /rewind prompt \d/.test(l)).length;
    resize.fire(); await tick();
    const tall = rowCount();
    expect(tall).toBeGreaterThan(2);
    rows = 14; resize.fire(); await tick();
    expect(rowCount()).toBeLessThan(tall);
    rows = 40; resize.fire(); await tick();
    expect(rowCount()).toBe(tall);
    r.unmount();
  });

  /** SessionPicker's `columns` reaches `Select`, whose label column is `min(widest, floor(columns * 0.6))` —
   *  the same clip the ModelPicker case above uses, on the session TITLE. Its `rows` is pinned separately. */
  it("the open /resume session picker re-clips its titles when the terminal WIDTH changes", async () => {
    let cols = 200;
    const resize = fakeResize();
    const LONG_TITLE = "a saved conversation with a deliberately long summary line for the clip";
    const sessions = [{ sessionId: "s0", summary: LONG_TITLE, lastModified: 1 }];
    const deps = { columns: () => cols, hasWorktrees: async () => false, listSessions: async () => sessions, getSessionMessages: async () => [] as any[] };
    const session = fakeRemote();
    const r = renderWithKeymap(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    r.stdin.write("/resume"); await waitFor(() => frame(r.lastFrame).includes("/resume"));
    r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("Resume session"));
    expect(strip(frame(r.lastFrame))).toContain(LONG_TITLE);
    cols = 40; resize.fire(); await tick();
    expect(strip(frame(r.lastFrame))).not.toContain(LONG_TITLE);
    cols = 200; resize.fire(); await tick();
    expect(strip(frame(r.lastFrame))).toContain(LONG_TITLE);
    r.unmount();
  });

  /** PlanDialog takes `rows` only (it has no width-derived string of its own): the terminal height minus the
   *  option box minus chrome is `planRegionRows`, and `planWindow` is how many plan lines actually print. */
  it("the open plan dialog re-windows its plan body when the terminal HEIGHT changes", async () => {
    let rows = 60;
    const resize = fakeResize();
    const deps = { columns: () => 200, getSessionMessages: async () => [] as any[] };
    const plan = Array.from({ length: 60 }, (_, i) => `plan step ${i}`).join("\n\n");
    const entry: PendingEntry = { sessionId: "s", toolUseID: "p", toolName: "ExitPlanMode", kind: "plan", input: { plan }, createdAt: Date.now() } as PendingEntry;
    const session = fakeRemote();
    const r = renderWithKeymap(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    Object.defineProperty(r.stdout, "rows", { configurable: true, get: () => rows });
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    session.parkPermission(entry);
    await waitFor(() => frame(r.lastFrame).includes("Ready to code?"));
    const stepCount = () => strip(frame(r.lastFrame)).split("\n").filter((l) => /plan step \d/.test(l)).length;
    resize.fire(); await tick();
    const tall = stepCount();
    expect(tall).toBeGreaterThan(1);
    rows = 24; resize.fire(); await tick();
    expect(stepCount()).toBeLessThan(tall);
    rows = 60; resize.fire(); await tick();
    expect(stepCount()).toBe(tall);
    r.unmount();
  });
});
