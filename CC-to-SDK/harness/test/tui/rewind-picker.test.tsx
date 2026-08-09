// test/tui/rewind-picker.test.tsx — the rewind picker as F6 T10 rebuilt it: upstream's `Q4f` anatomy
// (bundle L487055-194) on the shared `Select`. The C5-era assertions this file replaced pinned the OLD
// shape — a hand-rolled newest-first list and a 1/2/3 scope menu — and are gone deliberately, not lost.
//
// What is pinned here, in the order the requirements land:
//   · the frame, the list prompt, the empty state and the footer literals;
//   · row anatomy: the trailing italic `(current)`, the one-line prompt text with its `(no prompt)` /
//     `((empty message))` / `!bash` / `/slash` forms, and the second line's three states;
//   · that the second line is computed BEFORE any selection, windowed, and that the window is a BOUND —
//     the 11th-newest anchor gets no dry run on open;
//   · the confirmation panel: prompt, message box, per-option explanation lines, the manual-edit warning,
//     and default focus;
//   · that navigation is Select's (j/k, ctrl+n/p, PageUp/PageDown, Home/End) and that the retargeted KB14
//     jump aliases still reach it through the `MessageSelector` scope above.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import React from "react";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { RewindPicker } from "../../src/tui/RewindPicker.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import { conversationExplanation, REWIND_CHECKING, REWIND_CHROME_ROWS, REWIND_MIN_ROWS, REWIND_ROW_HEIGHT, rewindVisibleRows, rewindWrapRows } from "../../src/tui/rewindModel.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
/** Strip SGR so a literal assertion is about TEXT; the colour/italic assertions use the raw frame on purpose. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// `rewindAnchorsFrom` hands the picker NEWEST-FIRST; the picker displays it reversed with `(current)` last.
const ANCHORS: RewindAnchor[] = [
  { uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2, timestamp: new Date(Date.now() - 5 * 60_000).toISOString() },
  { uuid: "uA", prevUuid: null, text: "first prompt", index: 0 },
];
const never = () => new Promise<RewindDryRun>(() => {});
const clean: RewindDryRun = { canRewind: true, filesChanged: ["/repo/src/a.ts", "/repo/src/b.ts"], insertions: 3, deletions: 1 };
const props = { onDryRun: never, onConfirm: () => {}, onClose: () => {}, rows: 40, columns: 80 };

// WAVE S T4 + ITS FIX ROUND. The budget is counted, not inherited: it happens to equal upstream's inlined 12,
// but upstream applies that to a row count already halved under `ds()` (its split-view predicate) and we have
// no split view — see `REWIND_CHROME_ROWS` for the 9 + 1 + 1 + 1 our own tree measures. Pinned DIRECTLY,
// because a test that only asserted `rewindVisibleRows(15) === 2` and `rewindVisibleRows(40) > 2` is
// satisfied by every constant from 7 to 31 and pins nothing at all.
//
// THIS BLOCK IS ONLY THE LOWER BOUND — that the window is not needlessly SMALL. The upper bound, that the
// composed frame never reaches the pane, is the invariant block below; between them the constant is bracketed
// on both sides. The three heights here discriminate 12 from each of its neighbours: at 21, C=13 gives 2 and
// C=9 gives 4; at 23, C=11 gives 4.
describe("rewindVisibleRows — the budget is our own chrome, counted", () => {
  it("sizes its window from the chrome the composed frame actually costs", () => {
    expect(REWIND_CHROME_ROWS).toBe(12);           // 9 dialog chrome + the footer row + the `>=` row + REWIND_CHECKING
  // WAVE C TASK 2: that `+1 ChatStatusBar` term is the FOOTER row now — re-measured in a real pty at
  // 100×40 with the dialog up, ChatApp's last child is one row either way, so the number is unchanged.
    expect(REWIND_MIN_ROWS).toBe(2);               // upstream's `Math.max(2, …)` floor (L487056)
    expect(rewindVisibleRows(21)).toBe(3);         // floor((21−12)/3) — 4 at t4's C=9, 2 at C=13
    expect(rewindVisibleRows(23)).toBe(3);         // floor((23−12)/3) — 4 at C=11, so 11 is excluded too
    expect(rewindVisibleRows(30)).toBe(6);         // floor((30−12)/3) — 7 at C=9
    expect(rewindVisibleRows(15)).toBe(2);         // and the floor still holds where the pane is too short
    expect(rewindVisibleRows(4)).toBe(2);
  });

  // WAVE S T4, WRAP ROUND. The height half above counts ONE row per chrome line; two of those lines are
  // literals that WRAP at a narrow terminal, and each extra line eats the budget's single row of slack. The
  // three bands are word-wrap's, not division's, and they are pinned against a rendered frame by the block
  // below this one — these cases only pin that the arithmetic then reaches `rewindVisibleRows`.
  it("adds the rows the prompt and footer actually wrap to, and only when the caller knows the width", () => {
    expect(rewindWrapRows(100)).toBe(0);           // `REWIND_PROMPT` is 57 columns, the inner width is columns − 4
    expect(rewindWrapRows(61)).toBe(0);            // 57 inner — the last width where the prompt is one line
    expect(rewindWrapRows(60)).toBe(1);            // 56 inner — the prompt takes a second
    expect(rewindWrapRows(37)).toBe(1);            // 33 inner — exactly the footer's width, so still just the prompt
    expect(rewindWrapRows(36)).toBe(3);            // 32 inner — the prompt takes a THIRD and the footer a second
    // Omitting `columns` is the old height-only budget, unchanged — no existing call site changes meaning.
    expect(rewindVisibleRows(22)).toBe(3);
    expect(rewindVisibleRows(22, 80)).toBe(3);     // wrap 0: a comfortable width is the same budget
    expect(rewindVisibleRows(22, 50)).toBe(3);     // wrap 1: floor((22−13)/3)
    expect(rewindVisibleRows(22, 36)).toBe(2);     // wrap 3: floor((22−15)/3)
    expect(rewindVisibleRows(25, 50)).toBe(4);     // floor((25−13)/3)
    expect(rewindVisibleRows(25, 36)).toBe(3);     // floor((25−15)/3)
    expect(rewindVisibleRows(15, 36)).toBe(2);     // the readability floor still outvotes both halves
  });
});

// WAVE S T4, FIX ROUND — THE PROPERTY, of which the constant above is only the current satisfaction. The t4
// re-derivation measured the dialog against the wrong denominator: `RewindPicker` does not own the pane.
// `ChatApp` renders the FOOTER one line below it, unconditionally (`ChatStatusBar` before Wave C Task 2 —
// one row either way), and hands the dialog the WHOLE
// terminal height — so a budget counted from `RewindFrame` alone composes into a frame that reaches the pane.
//
// Ink does not clip that. `node_modules/ink/build/ink.js:121` (5.2.1) branches on
// `outputHeight >= this.options.stdout.rows` and writes `clearTerminal + fullStaticOutput + output` — a
// full-terminal wipe and a re-dump of the entire accumulated static transcript, ON EVERY RENDER, which for a
// list means on every cursor move. And the threshold is `>=`: a frame that exactly fills the pane trips it.
// So the invariant is STRICTLY BELOW, and it is asserted on the composed `ChatApp` frame, never on the dialog.
//
// HOW THE HEIGHT IS READ. `ink-testing-library` renders with `debug: true`, whose branch writes
// `fullStaticOutput + output`; the fixture's transcript is empty, so the static half is empty and the frame's
// line count IS the `outputHeight` Ink compares. (If a future `<Static>` banner appears, this test counts it
// too and fails — the safe direction.)
//   AND THAT PREMISE IS MEASURED, not reasoned — it was asserted here for a round before anyone checked it,
// and it is the load-bearing one for every number in this block. Wave S t5 found the SettingsDialog budget
// inflated by exactly this effect (`SETTINGS_CHROME_ROWS`, SettingsDialog.tsx) and re-opened the question for
// every surface that quotes a height. Settled for THIS fixture by running it under both instruments at once:
// the debug frame's line count against the `output` recovered from `stdout.write` on a NON-debug Ink render,
// at 21/24/40 rows × 36/50/100 columns with five tasks seeded, in state D below — mid-list, both indicators,
// the checking row up, the tallest cell the grid reaches. The two agree EXACTLY in all nine (20/23/38 at 36
// columns, 18/21/39 at 50, 20/23/38 at 100) and the static half measures zero rows in every one. So the
// heights below are `outputHeight`, the assertions compare the quantity Ink compares, and nothing here needed
// correcting. A fixture that opened this picker by TYPING a slash command would not have that property: the
// command echo is a static item, and every height read off `lastFrame()` there is one row too tall.
//
// FOUR STATES, because the frame's height is not one number: the two scroll indicators are conditional, and
// `REWIND_CHECKING` is a further conditional row. The tallest reachable state is mid-list (both indicators)
// with the checking row up, and it measures `3·visible + 11 + rewindWrapRows(columns)`.
//
// AND IT IS A MATRIX, NOT A SWEEP OF HEIGHTS — the WRAP ROUND's whole point. A height-only budget is a frame
// budget only at a width where nothing wraps; the same defect lives on the other axis, and a block that only
// ever ran at 100 columns proved nothing about it. Measured before that round, with `rewindVisibleRows(rows)`
// blind to the width: 36 columns reached the pane at EVERY height in range, and 37-60 reached it at one height
// in three (the residues where `(rows − 12) % 3 == 0`). Widths 61 and up were, and remain, clear.
//
// THREE WIDTHS, ONE PER WRAP BAND, and that is the whole width axis (Wave S t4 final round, on the review's
// own count). Only two things vary across a width sweep here: `rewindWrapRows`, which answers 0, 1 or 3, and
// the residue of `(rows − 12 − wrap) mod 3`. The earlier eight widths included 37/44/50/60 — all one band —
// and those four were confirmed to produce BYTE-IDENTICAL failure sets before the wrap fix, i.e. one input
// repeated four times for 4/8ths of a 6.6 s grid. The band EDGES are not lost with them: `rewindWrapRows`'s
// own unit assertions pin 61/60 and 37/36 directly, and the rendered-frame subtraction test below proves the
// number those assertions name is the number the renderer spends. So 36 (wrap 3), 50 (wrap 1), 100 (wrap 0).
//
// FOUR HEIGHTS PER WIDTH: the three CONSECUTIVE heights from `minBudgetedRows(columns)` up, which is one full
// cycle of that residue and therefore includes the `% 3 == 0` height where the budget is exactly `rows − 1`,
// plus one tall pane where the whole catalog is nearly on screen. The short corner below `minBudgetedRows` is
// SKIPPED, and the skip moves with the width: under `REWIND_CHROME_ROWS + wrap + 3·REWIND_MIN_ROWS` the
// readability floor — not the budget — pins the list at two options and the frame overflows whatever the
// budget says (18 rows at a comfortable width, 21 at 36 columns). That is `REWIND_MIN_ROWS`'s deliberate cost;
// `minBudgetedRows` is the one place it is written down.
//
// AND A TASK-PANEL DIMENSION ON TOP, which is what this round exists for. The matrix used to render with an
// EMPTY task list, so `ChatApp`'s `<TaskPanel>` returned null and the grid never saw the one sibling that
// `initialTodosOpen` puts on screen for every session that has tasks. Five tasks is the panel at its tallest:
// `todoWindowSize` caps the list at five rows, so the panel is a leading blank + its header + the window +
// (at 18-and-under, where the window is four) one overflow line — seven rows either way, against a budget
// whose slack is one row by construction. Measured on this fixture at 21×100 before the gate: 20 rows with no
// tasks, 25 with three, against a pane of 21. Seeding is deliberately the TaskCreate/TaskUpdate wire pair,
// which `taskList.ts` ingests and the transcript renders NOTHING for — so the static half of the frame stays
// empty and the line count still IS `outputHeight` (asserted in `openPicker`, not assumed).
describe("<ChatApp> with the rewind picker open never renders a frame that reaches the pane, at any geometry where the budget — not `REWIND_MIN_ROWS` — decides the window", () => {
  let fleetRoot = "", priorFleetRoot: string | undefined;
  beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRoot = mkdtempSync(join(tmpdir(), "ccx-rwf-")); process.env.CCX_FLEET_ROOT = fleetRoot; });
  afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRoot, { recursive: true, force: true }); });

  /** Fourteen anchors + the synthetic `(current)` row: more options than any height in the range can show, so
   *  the window — not the catalog — is what sizes the list, and both indicators are reachable everywhere. */
  const MANY: RewindAnchor[] = Array.from({ length: 14 }, (_, i) => ({ uuid: `w${i}`, prevUuid: null, text: `rewind prompt ${i}`, index: i }));
  /** `never` for the dry runs is deliberate twice over: every row keeps its blank second line (so the row
   *  height is the constant 3 the budget assumes), and Enter parks on `REWIND_CHECKING` instead of opening the
   *  confirmation panel — which is how the checking row is held on screen at all. */
  const rewindRemote = () => ({ ...fakeRemote(), rewindAnchors: async () => MANY, rewindDryRun: never, rewind: async () => {} });

  /** The todo panel's own wire pair (`taskList.ts`: TaskCreate's `tool_use`, then the `tool_result` whose text
   *  carries the id it was given). Wrapped in a turn so `state.busy` returns to false and the Esc-Esc arm
   *  below is live. */
  function seedTasks(session: ReturnType<typeof rewindRemote>, n: number) {
    if (n === 0) return;
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    for (let i = 0; i < n; i++) {
      session.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "tool_use", id: `tc${i}`, name: "TaskCreate", input: { subject: `todo-item-${i}` } }] } } });
      session.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tc${i}`, content: `Task #${i + 1} created successfully: todo-item-${i}` }] } } });
    }
    session.pushEvent({ kind: "turn", phase: "end", seq: 1 });
  }

  /** Esc-Esc on an empty composer — the only route to this picker (escape.test.tsx's recipe) — over a session
   *  that has already reported `tasks` todos, so `ChatApp`'s `<TaskPanel>` is live for the whole cell.
   *
   *  BOTH DIMENSIONS ARE STUBBED IN TWO PLACES, and both are needed. `deps.columns` is what `ChatApp` reads
   *  and hands the dialog as a prop; `stdout.columns` is what INK reads — `ink.js:93` sets the yoga root
   *  width from it on every layout, exactly as `ink.js:121` compares `outputHeight` against `stdout.rows`.
   *  Stub only the prop and the frame is still laid out 100 columns wide, nothing wraps, and the matrix
   *  measures the same cell three times over.
   *
   *  The prompt is waited on by its FIRST wrapped line, because at 36 columns the rest of it is two rows
   *  further down. */
  async function openPicker(rows: number, columns: number, tasks = 0) {
    const deps = { columns: () => columns, getSessionMessages: async () => [] as never[] };
    const session = rewindRemote();
    const r = render(<ChatApp makeSession={() => session as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} />);
    Object.defineProperty(r.stdout, "rows", { configurable: true, get: () => rows });
    Object.defineProperty(r.stdout, "columns", { configurable: true, get: () => columns });
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    seedTasks(session, tasks);
    if (tasks > 0) {
      await waitFor(() => plain(frame(r.lastFrame)).includes("todo-item-0"));
      // The measurement's own precondition, asserted rather than assumed: neither half of the seeding pair
      // reaches the transcript, so `fullStaticOutput` stays empty and the line count still IS `outputHeight`.
      expect(plain(frame(r.lastFrame))).not.toContain("TaskCreate");
    }
    await tick();
    r.stdin.write("\x1b"); await waitFor(() => frame(r.lastFrame).includes("Press Esc again to rewind"));
    r.stdin.write("\x1b"); await waitFor(() => plain(frame(r.lastFrame)).includes("Restore the code and/or"));
    await tick();
    return r;
  }
  const frameHeight = (r: { lastFrame: () => string | undefined }) => frame(r.lastFrame).split("\n").length;
  const indicators = (r: { lastFrame: () => string | undefined }) => {
    const f = plain(frame(r.lastFrame));
    return `${f.includes("more above") ? "↑" : "-"}${f.includes("more below") ? "↓" : "-"}`;
  };
  /** Enter on the focused ANCHOR row (never `(current)`, which closes the picker) with a dry run that never
   *  lands: the list stays mounted and scrollable underneath, and the checking row is the only addition. */
  async function startChecking(r: { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined }) {
    r.stdin.write("\r");
    await waitFor(() => plain(frame(r.lastFrame)).includes(REWIND_CHECKING));
    await tick();
  }

  /** The lowest height at which the BUDGET, and not `REWIND_MIN_ROWS`, is what decides the window. It moves
   *  with the width because the wrap allowance is chrome the floor also has to clear. */
  const minBudgetedRows = (columns: number) => REWIND_CHROME_ROWS + rewindWrapRows(columns) + REWIND_ROW_HEIGHT * REWIND_MIN_ROWS;

  /** Five, which is the panel's tallest shape at every height in this grid: `todoWindowSize` answers 5 above
   *  18 rows and 4 at 18, so the panel is either five rows or four plus an overflow line — seven rows with its
   *  header and its leading blank, either way. */
  const PANEL_TASKS = 5;

  for (const columns of [36, 50, 100]) {
    const floorRows = minBudgetedRows(columns);
    for (const rows of [floorRows, floorRows + 1, floorRows + 2, 40]) {
      for (const tasks of [0, PANEL_TASKS]) {
        it(`stays under ${rows}×${columns} with ${tasks} tasks at the bottom of the list, mid-list with both indicators, and while checking`, async () => {
          // A · bottom of the list, where the picker opens: `(current)` focused, only `↑ N more above` drawn.
          const a = await openPicker(rows, columns, tasks);
          expect(indicators(a)).toBe("↑-");
          expect(frameHeight(a)).toBeLessThan(rows);
          // B · one row up off the synthetic row, then Enter — the checking row over the bottom of the list.
          a.stdin.write("k"); await tick(); await tick();
          await startChecking(a);
          expect(frameHeight(a)).toBeLessThan(rows);
          a.unmount();

          // C · mid-list: Home, then step down until BOTH indicators are live. Asserted, not assumed — a walk
          // that never reached the both-indicators state would leave the tallest geometry untested.
          const b = await openPicker(rows, columns, tasks);
          b.stdin.write("\x1b[H"); await tick(); await tick();
          for (let n = 0; n < MANY.length && indicators(b) !== "↑↓"; n++) { b.stdin.write("j"); await tick(); await tick(); }
          expect(indicators(b)).toBe("↑↓");
          expect(frameHeight(b)).toBeLessThan(rows);
          // D · the tallest state there is: both indicators AND the checking row.
          await startChecking(b);
          expect(indicators(b)).toBe("↑↓");
          expect(frameHeight(b)).toBeLessThan(rows);
          b.unmount();
        }, 20000);
      }
    }
  }

  // THE WRAP COUNT ITSELF, against a real frame rather than against our reading of `wrap-ansi`. The matrix
  // above proves the composed frame fits; this proves the NUMBER the budget subtracts is the number of rows
  // the renderer actually spends, which is the claim a `Math.ceil(width / inner)` would get wrong at most
  // widths (57 over an inner 32 is three lines, not two — word wrap breaks at `and/or`, not at column 32).
  //
  // The subtraction is what makes it a measurement. Two anchors plus `(current)` is three options, and at 40
  // rows every width in range shows all three, so neither indicator is drawn and the list block is a fixed
  // 3·3 rows. The ONLY thing left that the width can change is how many rows the prompt and footer take —
  // so `height(columns) − height(100)` IS `rewindWrapRows(columns)`, with nothing else in the difference.
  //
  // `stdout.columns` is stubbed after the mount (that is when the instance exists) and a keypress forces the
  // repaint that re-lays-out at the new width — Ink reads the width per layout, not per mount.
  it("rewindWrapRows equals the rows the RENDERED frame spends on the prompt and footer", async () => {
    const heightAt = async (columns: number) => {
      const r = render(<RewindPicker {...props} anchors={ANCHORS} rows={40} columns={columns} />);
      Object.defineProperty(r.stdout, "columns", { configurable: true, get: () => columns });
      await waitFor(() => frame(r.lastFrame).includes("(current)"));
      await tick();
      r.stdin.write("k");                                                    // focus moves off `(current)` → repaint
      await waitFor(() => plain(frame(r.lastFrame)).split("\n").some((l) => l.includes("❯") && l.includes("second prompt")));
      const h = frame(r.lastFrame).split("\n").length;
      expect(plain(frame(r.lastFrame))).not.toContain("more above");         // the whole catalog is on screen
      expect(plain(frame(r.lastFrame))).not.toContain("more below");         // …so nothing but wrap differs
      r.unmount();
      return h;
    };
    const base = await heightAt(100);
    for (const columns of [80, 61, 60, 50, 44, 37, 36]) {
      expect([columns, await heightAt(columns) - base]).toEqual([columns, rewindWrapRows(columns)]);
    }
  }, 20000);
});

describe("<RewindPicker> — the frame and the list", () => {
  it("renders the Rewind frame, upstream's list prompt and the enter/esc footer", async () => {
    const { lastFrame } = render(<RewindPicker {...props} anchors={ANCHORS} />);
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Rewind");
    expect(f).toContain("Restore the code and/or conversation to the point before…");
    expect(f).toContain("enter to continue · esc to cancel");
  });

  it("displays OLDEST-first with the trailing italic (current) row, and opens with the cursor on it", async () => {
    const { lastFrame } = render(<RewindPicker {...props} anchors={ANCHORS} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    const f = plain(frame(lastFrame));
    expect(f.indexOf("first prompt")).toBeLessThan(f.indexOf("second prompt"));   // oldest first
    expect(f.indexOf("second prompt")).toBeLessThan(f.indexOf("(current)"));      // synthetic row is last
    expect(frame(lastFrame)).toMatch(/\x1b\[3m[\s\S]{0,32}?\(current\)/);        // italic (SGR 3)
    // The pointer is on the `(current)` row, not on a prompt: focus starts at T.length - 1.
    expect(plain(frame(lastFrame)).split("\n").find((r) => r.includes("❯"))).toContain("(current)");
  });

  it("an empty anchor list opens the dialog on upstream's empty state, with no list and no enter hint", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={[]} onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("Nothing to rewind to yet."));
    const f = plain(frame(lastFrame));
    expect(f).toContain("esc to cancel");
    expect(f).not.toContain("enter to continue");
    expect(f).not.toContain("(current)");
    await tick();
    stdin.write("\x1b");                                                          // the empty state still cancels
    await waitFor(() => closed === 1);
  });

  it("row text: (no prompt), ((empty message)), a bash prompt and a slash command each take their own form", async () => {
    const odd: RewindAnchor[] = [
      { uuid: "u4", prevUuid: "x", text: "<command-name>compact</command-name><command-args>keep tests</command-args>", index: 6 },
      { uuid: "u3", prevUuid: "x", text: "<bash-input>ls -la</bash-input>", index: 4 },
      { uuid: "u2", prevUuid: "x", text: "<context>only a note</context>", index: 2 },
      { uuid: "u1", prevUuid: null, text: "", index: 0 },
    ];
    const { lastFrame } = render(<RewindPicker {...props} anchors={odd} />);
    await waitFor(() => frame(lastFrame).includes("(no prompt)"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("(no prompt)");
    expect(f).toContain("((empty message))");
    expect(f).toContain("! ls -la");
    expect(f).toContain("/compact keep tests");
  });

  it("a multi-line prompt is clipped to ONE line", async () => {
    const anchors: RewindAnchor[] = [{ uuid: "u1", prevUuid: "x", text: "line one\nline two\nline three", index: 0 }];
    const { lastFrame } = render(<RewindPicker {...props} anchors={anchors} />);
    await waitFor(() => frame(lastFrame).includes("line one"));
    expect(plain(frame(lastFrame))).not.toContain("line two");
  });
});

describe("<RewindPicker> — row summaries are computed before selection", () => {
  it("every row's second line lands with no selection and no keystroke, newest anchor first", async () => {
    const gate = new Map<string, ReturnType<typeof deferred<RewindDryRun>>>();
    const anchors: RewindAnchor[] = [
      { uuid: "uB", prevUuid: "aA", text: "newer", index: 2 },
      { uuid: "uA", prevUuid: null, text: "older", index: 0 },
    ];
    const { lastFrame } = render(
      <RewindPicker {...props} anchors={anchors} onDryRun={(uuid) => { const d = deferred<RewindDryRun>(); gate.set(uuid, d); return d.promise; }} />,
    );
    // The walk is sequential and newest-first: uB is asked for first, and uA is not asked at all until it lands.
    await waitFor(() => gate.has("uB"));
    expect(gate.has("uA")).toBe(false);
    gate.get("uB")!.resolve({ canRewind: true, filesChanged: ["/repo/x/only.ts"], insertions: 12, deletions: 0 });
    await waitFor(() => frame(lastFrame).includes("only.ts"));
    expect(plain(frame(lastFrame))).toContain("only.ts +12");
    await waitFor(() => gate.has("uA"));
    gate.get("uA")!.resolve({ canRewind: true, filesChanged: [] });
    await waitFor(() => frame(lastFrame).includes("No code changes"));
  });

  it("two changed files read `N files changed +A -R`; a failed dry run reads the warning", async () => {
    const anchors: RewindAnchor[] = [
      { uuid: "uB", prevUuid: "aA", text: "newer", index: 2 },
      { uuid: "uA", prevUuid: "x", text: "older", index: 0 },
    ];
    const { lastFrame } = render(
      <RewindPicker {...props} anchors={anchors}
        onDryRun={async (uuid) => (uuid === "uB" ? clean : { canRewind: false, error: "File rewinding is not enabled." })} />,
    );
    await waitFor(() => frame(lastFrame).includes("2 files changed"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("2 files changed +3 -1");
    expect(f).toContain("⚠ No code restore");
  });

  it("a THROWN dry run is a result, not a hole — the row shows the warning rather than staying blank", async () => {
    const anchors: RewindAnchor[] = [{ uuid: "uA", prevUuid: "x", text: "only", index: 0 }];
    const { lastFrame } = render(<RewindPicker {...props} anchors={anchors} onDryRun={async () => { throw new Error("boom"); }} />);
    await waitFor(() => frame(lastFrame).includes("⚠ No code restore"));
  });

  it("THE WINDOW IS A BOUND: opening a 25-anchor list dry-runs the newest ten and stops", async () => {
    const anchors: RewindAnchor[] = Array.from({ length: 25 }, (_, i) => ({ uuid: `u${i}`, prevUuid: "p", text: `prompt ${i}`, index: 50 - i }));
    const asked: string[] = [];
    render(<RewindPicker {...props} anchors={anchors} onDryRun={async (uuid) => { asked.push(uuid); return { canRewind: true, filesChanged: [] }; }} />);
    await waitFor(() => asked.length >= 10);
    await new Promise((r) => setTimeout(r, 60));                       // give a runaway walk time to overshoot
    expect(asked).toEqual(Array.from({ length: 10 }, (_, i) => `u${i}`));
    expect(asked).not.toContain("u10");                                // the 11th newest is NOT dry-run on open
  });

  it("scrolling past the window extends it — the older rows are asked for only then", async () => {
    const anchors: RewindAnchor[] = Array.from({ length: 25 }, (_, i) => ({ uuid: `u${i}`, prevUuid: "p", text: `prompt ${i}`, index: 50 - i }));
    const asked: string[] = [];
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={anchors} onDryRun={async (uuid) => { asked.push(uuid); return { canRewind: true, filesChanged: [] }; }} />);
    await waitFor(() => asked.length === 10);
    expect(asked).not.toContain("u24");
    await tick();
    stdin.write("\x1b[H");                                             // Home → the OLDEST row (u24 in dry-run space)
    await waitFor(() => asked.includes("u24"), 4000);
    expect(frame(lastFrame)).toBeTruthy();
  });
});

// t10 review, Important 1. The destructive option list must not move under the cursor. Reproduced exactly as
// the reviewer did: select an anchor whose dry run is still in flight, then land it and watch what happens to
// the row the pointer is on. Both halves of the fix get their own pin.
describe("<RewindPicker> — a panel never opens on, or shifts to, an unlanded summary", () => {
  /** One anchor, one dry run the test controls. `k` steps off `(current)` onto it, Enter selects it. */
  const selectSole = async (d: ReturnType<typeof deferred<RewindDryRun>>) => {
    const anchors: RewindAnchor[] = [{ uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 }];
    const r = render(<RewindPicker {...props} anchors={anchors} onDryRun={() => d.promise} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    return r;
  };

  it("(a) Enter HOLDS the list until the summary lands, then opens with the settled option list", async () => {
    const d = deferred<RewindDryRun>();
    const { lastFrame } = await selectSole(d);
    await waitFor(() => plain(frame(lastFrame)).includes("checking file changes…"));
    expect(plain(frame(lastFrame))).not.toContain("Confirm you want to restore");   // the panel is NOT open yet
    expect(plain(frame(lastFrame))).toContain("Restore the code and/or conversation"); // still the list
    d.resolve(clean);
    await waitFor(() => plain(frame(lastFrame)).includes("Confirm you want to restore"));
    // It opens on the SETTLED list — `both` present and focused, not inserted later under the pointer.
    expect(plain(frame(lastFrame)).split("\n").find((l) => l.includes("❯"))).toContain("Restore code and conversation");
  });

  it("(b) a summary landing for the OPEN panel's own anchor cannot change its options — the frozen snapshot", async () => {
    // The belt, driven down the one path that still reaches it with the hold in place: TWO dry runs for the
    // SAME uuid can be outstanding at once — the background walk's, and the out-of-band one `open` issues
    // when the walk has not landed yet (upstream's `oe` does the same second lookup). The out-of-band call
    // settles first with `canRewind:false`, so the panel opens conversation-only with the pointer on index 0.
    // Then the WALK's own call lands `clean` and writes it into the summaries map. A panel reading that map
    // live would INSERT `Restore code and conversation` at index 0 — under a pointer `Select` keeps by INDEX —
    // and the next Enter would confirm a code restore the user never chose. The snapshot is what stops it.
    const calls: ReturnType<typeof deferred<RewindDryRun>>[] = [];
    const anchors: RewindAnchor[] = [{ uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 }];
    const confirms: unknown[] = [];
    const r = render(
      <RewindPicker {...props} anchors={anchors} onConfirm={(a, s) => confirms.push([a.uuid, s])}
        onDryRun={() => { const d = deferred<RewindDryRun>(); calls.push(d); return d.promise; }} />,
    );
    await waitFor(() => calls.length === 1);                           // the walk's call, still in flight
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => calls.length === 2);                           // …and `open`'s out-of-band one
    calls[1]!.resolve({ canRewind: false, error: "not enabled" });      // it settles first → panel opens
    await waitFor(() => plain(frame(r.lastFrame)).includes("Confirm you want to restore"));
    expect(plain(frame(r.lastFrame))).not.toContain("Restore code and conversation");
    expect(plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯"))).toContain("Restore conversation");

    calls[0]!.resolve(clean);                                          // the walk lands, for the SAME uuid
    await new Promise((rs) => setTimeout(rs, 40));
    expect(plain(frame(r.lastFrame))).not.toContain("Restore code and conversation");   // options did not move
    expect(plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯"))).toContain("Restore conversation");
    r.stdin.write("\r");                                               // …and Enter still means what it read
    await waitFor(() => confirms.length === 1);
    expect(confirms[0]).toEqual(["uB", "conversation"]);
  });

  it("Escape during the hold abandons it — a late summary cannot pop the panel open afterwards", async () => {
    const d = deferred<RewindDryRun>();
    const { stdin, lastFrame } = await selectSole(d);
    await waitFor(() => plain(frame(lastFrame)).includes("checking file changes…"));
    stdin.write("\x1b");
    await waitFor(() => !plain(frame(lastFrame)).includes("checking file changes…"));
    d.resolve(clean);
    await new Promise((r) => setTimeout(r, 40));
    expect(plain(frame(lastFrame))).not.toContain("Confirm you want to restore");
    expect(plain(frame(lastFrame))).toContain("Restore the code and/or conversation");
  });

  it("an anchor whose summary ALREADY landed opens the panel with no second dry run and no hold", async () => {
    const asked: string[] = [];
    const anchors: RewindAnchor[] = [{ uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 }];
    const r = render(<RewindPicker {...props} anchors={anchors} onDryRun={async (uuid) => { asked.push(uuid); return clean; }} />);
    await waitFor(() => frame(r.lastFrame).includes("2 files changed"));
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => plain(frame(r.lastFrame)).includes("Confirm you want to restore"));
    expect(plain(frame(r.lastFrame))).not.toContain("checking file changes…");
    expect(asked).toEqual(["uB"]);                                     // the walk's one call, not a second
  });
});

describe("<RewindPicker> — the confirmation panel", () => {
  const openConfirm = async (anchors: RewindAnchor[], dry: (uuid: string) => Promise<RewindDryRun>) => {
    const r = render(<RewindPicker {...props} anchors={anchors} onDryRun={dry} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("k");                                                // up off `(current)` onto the newest anchor
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    return r;
  };
  /** The same, but on the OLDEST row — `uA`, whose `prevUuid` is null (the session's first prompt). Home
   *  rather than `k`, which is how the pre-Wave-S null-prevUuid test below already reached it. */
  const openConfirmFirst = async (dry: (uuid: string) => Promise<RewindDryRun>) => {
    const r = render(<RewindPicker {...props} anchors={ANCHORS} onDryRun={dry} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("\x1b[H");                                           // Home → the OLDEST row (uA, prevUuid null)
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("first prompt"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    return r;
  };

  // A4, kept as a GUARD. These passed on the build that existed when Wave S was planned; they are here so a
  // later refactor cannot quietly drop upstream's option set (L487069-072). Nothing was "fixed" to make them
  // pass — passing on arrival is the expected result, and is recorded as such.
  it("offers the four implementable options in upstream's order and wording (A4)", async () => {
    // dry run reporting one changed file → the three-way head is on
    const { lastFrame } = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: ["a.ts"], insertions: 1, deletions: 0 }));
    const f = plain(frame(lastFrame));
    const at = (s: string) => f.indexOf(s);
    expect(at("Restore code and conversation")).toBeGreaterThan(-1);
    expect(at("Restore conversation")).toBeGreaterThan(at("Restore code and conversation"));
    expect(at("Restore code")).toBeGreaterThan(-1);
    expect(at("Never mind")).toBeGreaterThan(at("Restore conversation"));
  });

  it("drops the code options when the dry run names no changed file (A4)", async () => {
    const { lastFrame } = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: [] }));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Restore conversation");
    expect(f).not.toContain("Restore code and conversation");
  });

  it("pairs each option with its own explanatory line — the two are trivially swapped (A4)", () => {
    expect(conversationExplanation("code")).toBe("The conversation will be unchanged.");
    expect(conversationExplanation("conversation")).toBe("The conversation will be forked.");
    expect(conversationExplanation("both")).toBe("The conversation will be forked.");
  });

  it("prompt, message box, relative time and the four options — with `both` focused when code restore is possible", async () => {
    const { lastFrame } = await openConfirm(ANCHORS, async () => clean);
    const f = plain(frame(lastFrame));
    expect(f).toContain("Confirm you want to restore to the point before you sent this message:");
    expect(f).toContain("second prompt");
    expect(f).toContain("(5m ago)");
    expect(f).toContain("Restore code and conversation");
    expect(f).toContain("Restore conversation");
    expect(f).toContain("Restore code");
    expect(f).toContain("Never mind");
    expect(f.split("\n").find((l) => l.includes("❯"))).toContain("Restore code and conversation");
    // The explanation pair for the focused option, and the manual-edit warning under the list.
    expect(f).toContain("The conversation will be forked.");
    expect(f).toContain("The code will be restored +3 -1 in a.ts and b.ts.");
    expect(f).toContain("⚠ Rewinding does not affect files edited manually or via bash.");
  });

  it("the explanation pair follows the FOCUSED option, before anything is chosen", async () => {
    const { stdin, lastFrame } = await openConfirm(ANCHORS, async () => clean);
    stdin.write("j");                                                  // → Restore conversation
    await waitFor(() => plain(frame(lastFrame)).includes("The code will be unchanged."));
    expect(plain(frame(lastFrame))).toContain("The conversation will be forked.");
    stdin.write("j");                                                  // → Restore code
    await waitFor(() => plain(frame(lastFrame)).includes("The conversation will be unchanged."));
    expect(plain(frame(lastFrame))).toContain("The code will be restored +3 -1 in a.ts and b.ts.");
    stdin.write("j");                                                  // → Never mind
    await waitFor(() => plain(frame(lastFrame)).includes("The code will be unchanged."));
  });

  it("one changed file names it; three or more read `first and N other files`", async () => {
    const one = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: ["/x/solo.ts"], insertions: 1, deletions: 0 }));
    expect(plain(frame(one.lastFrame))).toContain("The code will be restored +1 in solo.ts.");
    one.unmount();
    const many = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: ["/x/a.ts", "/x/b.ts", "/x/c.ts"], insertions: 2, deletions: 2 }));
    expect(plain(frame(many.lastFrame))).toContain("The code will be restored +2 -2 in a.ts and 2 other files.");
  });

  it("no code restore: the prompt regains `the conversation`, the code options and the warning are absent", async () => {
    const { lastFrame } = await openConfirm(ANCHORS, async () => ({ canRewind: false, error: "File rewinding is not enabled." }));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Confirm you want to restore the conversation to the point before you sent this message:");
    expect(f).toContain("Restore conversation");
    expect(f).not.toContain("Restore code");
    expect(f).not.toContain("⚠ Rewinding does not affect files");
    expect(f.split("\n").find((l) => l.includes("❯"))).toContain("Restore conversation");
  });

  // W-S8 INVERTS THIS TOO. It used to read "a null-prevUuid anchor cannot restore the conversation: only the
  // code option is offered, and it is focused" — correct while the host refused that case, and a lie the
  // moment it learned to clear instead of fork. Rewritten rather than deleted: this is the only coverage of
  // the first-prompt anchor shape.
  it("a null-prevUuid anchor CAN restore the conversation now — the full option set, with `both` focused", async () => {
    const { lastFrame } = await openConfirmFirst(async () => clean);
    const f = plain(frame(lastFrame));
    expect(f).toContain("Restore code and conversation");
    expect(f).toContain("Restore conversation");
    expect(f).toContain("Restore code");
    expect(f.split("\n").find((l) => l.includes("❯"))).toContain("Restore code and conversation");
  });

  it("offers a conversation restore for the first message (A4b)", async () => {
    const { lastFrame } = await openConfirmFirst(async () => ({ canRewind: false }));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Restore conversation");
    expect(f).toContain("Never mind");
  });

  // The pointer and the explanation line are computed from DIFFERENT state (`defaultFocusValue` at the render
  // site, `focusedOption` which `open()` also seeds), so the predicate was changed at all three sites. WHAT
  // THIS PINS IS THE RENDER SITE ALONE — and the two `open()` seeds are not independently pinnable here, for
  // an architectural reason: Select reports its focused row from a mount effect (Select.tsx's
  // `useEffect(() => reportFocus(current?.value))`), and `current` is derived from `defaultFocusValue`, so
  // `onFocus` overwrites whatever `open()` seeded within the same commit. Reverting either seed — or both —
  // leaves the whole tui suite green. Changing all three remains right for consistency: a seed that
  // disagrees with the render site is a self-contradicting frame waiting for the day the effect stops
  // running first. Not the pin for the option LIST either; the two A4b tests above own that.
  it("focuses a restorable option and explains THAT option, for a first-message anchor (A4b)", async () => {
    const { lastFrame } = await openConfirmFirst(async () => ({ canRewind: false }));
    expect(plain(frame(lastFrame))).toContain("The conversation will be forked.");        // not "…will be unchanged."
  });

  it("choosing an option confirms with that scope; Never mind and Esc both go BACK to the list, never out", async () => {
    const confirms: unknown[] = [];
    let closed = 0;
    const r = render(<RewindPicker {...props} anchors={ANCHORS} onDryRun={async () => clean} onConfirm={(a, s) => confirms.push([a.uuid, s])} onClose={() => { closed++; }} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));

    r.stdin.write("\x1b");                                             // Esc → back to the list, NOT out
    await waitFor(() => plain(frame(r.lastFrame)).includes("Restore the code and/or conversation"));
    expect(closed).toBe(0);

    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    r.stdin.write("4");                                                // Never mind, by its digit
    await waitFor(() => plain(frame(r.lastFrame)).includes("Restore the code and/or conversation"));
    expect(confirms).toEqual([]);
    expect(closed).toBe(0);

    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    r.stdin.write("2");                                                // Restore conversation
    await waitFor(() => confirms.length === 1);
    expect(confirms[0]).toEqual(["uB", "conversation"]);
  });
});

describe("<RewindPicker> — navigation is the shared list's", () => {
  const many: RewindAnchor[] = Array.from({ length: 12 }, (_, i) => ({ uuid: `u${i}`, prevUuid: "p", text: `prompt ${i}`, index: 24 - i }));
  const pointerRow = (f: string) => plain(f).split("\n").find((l) => l.includes("❯")) ?? "";

  it("j/k, ctrl+n/ctrl+p, Home/End and PageUp all move the list", async () => {
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={many} onDryRun={never} rows={40} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("k"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 0"));       // newest anchor
    stdin.write("k"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 1"));
    stdin.write("\x0e"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 0"));    // ctrl+n
    stdin.write("\x10"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 1"));    // ctrl+p
    stdin.write("\x1b[H"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 11")); // Home → oldest
    stdin.write("\x1b[F"); await waitFor(() => pointerRow(frame(lastFrame)).includes("(current)")); // End → the synthetic row
    stdin.write("\x1b[5~"); await waitFor(() => !pointerRow(frame(lastFrame)).includes("(current)")); // PageUp moves
  });

  it("the retargeted KB14 jump aliases still reach Select through the MessageSelector scope", async () => {
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={many} onDryRun={never} rows={40} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("K"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 11"));         // shift+k → first
    stdin.write("J"); await waitFor(() => pointerRow(frame(lastFrame)).includes("(current)"));         // shift+j → last
    stdin.write("\x1b[1;5A"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 11")); // ctrl+↑ → first
    stdin.write("\x1b[1;2B"); await waitFor(() => pointerRow(frame(lastFrame)).includes("(current)")); // shift+↓ → last
  });

  it("the scroll counters are caller-rendered from the list's own window", async () => {
    // rows:22 → visible = max(2, floor((22-12)/3)) = 3 of 13 options (12 anchors + the synthetic row), so
    // both counters are live and each hides 13 − 3 = 10. The count tracks `REWIND_CHROME_ROWS`: it was 10
    // before Wave S t4, 9 while t4's C=9 stood, and 10 again now the composed frame is what the budget is
    // measured against — recomputed here, not restored from history.
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={many} onDryRun={never} rows={22} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    expect(plain(frame(lastFrame))).toContain("↑ 10 more above");
    expect(plain(frame(lastFrame))).not.toContain("more below");
    await tick();
    stdin.write("\x1b[H");                                             // Home → the top of the list
    await waitFor(() => plain(frame(lastFrame)).includes("more below"));
    expect(plain(frame(lastFrame))).toContain("↓ 10 more below");
    expect(plain(frame(lastFrame))).not.toContain("more above");
  });

  it("selecting the synthetic (current) row closes the picker and confirms nothing", async () => {
    const confirms: unknown[] = [];
    let closed = 0;
    const { stdin, lastFrame } = render(
      <RewindPicker {...props} anchors={ANCHORS} onDryRun={never} onConfirm={(a, s) => confirms.push([a, s])} onClose={() => { closed++; }} />,
    );
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("\r");                                                 // Enter on `(current)`
    await waitFor(() => closed === 1);
    expect(confirms).toEqual([]);
  });

  it("Esc on the list closes the picker", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={ANCHORS} onDryRun={never} onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
  });
});
