// tui/test/historySearchOverlay.test.tsx — the full-screen history PICKER (Wave 2 task 7, `qGf`): loads the
// initial "everywhere" scope, incremental filter via rankHistory, Enter EXECUTES, Esc/Tab ACCEPTS into
// the composer, Ctrl-C cancels, Ctrl-R cycles the match, Ctrl-S cycles scope and reloads.
//
// F5 task 12 moved its DOOR — ctrl+r is the composer's inline reverse-i-search now and `/history` opens this
// (see historySearchInline.ts's header for the bundle routing) — and gave it CM59's preview pane, pinned at
// the bottom of this file.
//
// F2 task 7: the overlay stopped calling `useInput`. Its six bundle keys are ACTIONS on the `HistorySearch`
// context; everything else — the search field's own text — arrives through the keymap FALLBACK, as single-key
// events for one character and as one text event for a multi-character run. Rendered bare it has no input
// path at all, hence `renderWithKeymap`.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { HistorySearchOverlay } from "../../src/tui/HistorySearchOverlay.js";
import type { HistEntry, HistoryScope } from "../../src/tui/historySearch.js";

const tick = () => new Promise((r) => setTimeout(r, 20));
const entries: HistEntry[] = [
  { text: "fix the tests", ts: Date.now() - 60_000 },
  { text: "run typecheck", ts: Date.now() - 3_600_000 },
];
const loadOk = async (_s: HistoryScope) => entries;

describe("HistorySearchOverlay", () => {
  it("loads the initial scope (everywhere), shows entries newest-first with ages", async () => {
    const r = render(<HistorySearchOverlay load={loadOk} onAccept={() => {}} onExecute={() => {}} onCancel={() => {}} />);
    await tick();
    expect(r.lastFrame()).toContain("everywhere");
    expect(r.lastFrame()).toContain("fix the tests");
    expect(r.lastFrame()).toContain("1m");
  });

  it("typing filters; Enter EXECUTES the selection", async () => {
    const runs: string[] = [];
    const r = render(<HistorySearchOverlay load={loadOk} onAccept={() => {}} onExecute={(e) => runs.push(e.text)} onCancel={() => {}} />);
    await tick();
    r.stdin.write("type"); await tick();
    expect(r.lastFrame()).not.toContain("fix the tests");
    r.stdin.write("\r"); await tick();
    expect(runs).toEqual(["run typecheck"]);
  });

  it("the search field still takes typed characters: one key, a backspace, and a multi-character run", async () => {
    const r = render(<HistorySearchOverlay load={loadOk} onAccept={() => {}} onExecute={() => {}} onCancel={() => {}} />);
    await tick();
    r.stdin.write("u"); await tick();                    // a single printable arrives as a KEY event, not text
    expect(r.lastFrame()).toContain("run typecheck");
    expect(r.lastFrame()).not.toContain("fix the tests");
    r.stdin.write("\x7f"); await tick();                 // backspace clears the query again
    expect(r.lastFrame()).toContain("fix the tests");
    r.stdin.write("type"); await tick();                 // a run arrives as ONE text event
    expect(r.lastFrame()).not.toContain("fix the tests");
    expect(r.lastFrame()).toContain("run typecheck");
  });

  it("Esc ACCEPTS into the composer (bundle historySearch:accept), Ctrl-C cancels", async () => {
    const accepted: string[] = []; let cancelled = 0;
    const r = render(<HistorySearchOverlay load={loadOk} onAccept={(e) => accepted.push(e.text)} onExecute={() => {}} onCancel={() => { cancelled++; }} />);
    await tick();
    r.stdin.write("\x1b"); await tick();
    expect(accepted).toEqual(["fix the tests"]);
    r.stdin.write("\x03"); await tick();
    expect(cancelled).toBe(1);
  });

  it("Ctrl-R cycles to the next match; Ctrl-S cycles scope and re-loads", async () => {
    const scopes: HistoryScope[] = [];
    const load = async (s: HistoryScope) => { scopes.push(s); return entries; };
    const runs: string[] = [];
    const r = render(<HistorySearchOverlay load={load} onAccept={() => {}} onExecute={(e) => runs.push(e.text)} onCancel={() => {}} />);
    await tick();
    r.stdin.write("\x12"); await tick();                 // Ctrl-R → selection moves to entry 2
    r.stdin.write("\r"); await tick();
    expect(runs).toEqual(["run typecheck"]);
    expect(scopes).toEqual(["everywhere"]);
    const r2 = render(<HistorySearchOverlay load={load} onAccept={() => {}} onExecute={() => {}} onCancel={() => {}} />);
    await tick();
    r2.stdin.write("\x13"); await tick();                // Ctrl-S → session scope loads
    expect(scopes).toEqual(["everywhere", "everywhere", "session"]);
    expect(r2.lastFrame()).toContain("session");
  });

  it("empty state: Esc with no match cancels instead of accepting nothing", async () => {
    let cancelled = 0;
    const r = render(<HistorySearchOverlay load={async () => []} onAccept={() => { throw new Error("must not accept"); }} onExecute={() => {}} onCancel={() => { cancelled++; }} />);
    await tick();
    expect(r.lastFrame()).toContain("No history yet");
    r.stdin.write("\x1b"); await tick();
    expect(cancelled).toBe(1);
  });
});

// ───────────────────────────── CM59: the preview pane (bundle qGf `renderPreview`, L492219) ─────────────────────────────

describe("CM59 — the picker's preview pane", () => {
  const long: HistEntry[] = [{ text: ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n"), ts: Date.now() }];
  const loadLong = async (_s: HistoryScope) => long;

  it("renders six content lines of the selection, five plus a `… +N lines` tail when it overflows", async () => {
    const r = render(<HistorySearchOverlay load={loadLong} onAccept={() => {}} onExecute={() => {}} onCancel={() => {}} columns={() => 120} />);
    await tick();
    const f = r.lastFrame() ?? "";
    for (const l of ["one", "two", "three", "four", "five"]) expect(f).toContain(l);
    expect(f).toContain("… +3 lines");
    expect(f).not.toContain("eight");
  });

  it("at 120 columns the pane sits BESIDE the list — the list's own row carries the preview's border", async () => {
    const r = render(<HistorySearchOverlay load={loadLong} onAccept={() => {}} onExecute={() => {}} onCancel={() => {}} columns={() => 120} />);
    await tick();
    const rows = (r.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    // Side-by-side is visible in one place and one place only: the terminal line holding the list's first
    // row ("  0s one") also holds the preview box's TOP-LEFT corner, because the two are laid out in a row.
    const listRow = rows.find((l) => /0s/.test(l) && /one/.test(l));
    expect(listRow, "the list row must exist").toBeTruthy();
    expect(listRow).toContain("\u256d");
  });

  it("at 80 columns it stacks BELOW instead — the list row carries no pane border", async () => {
    const r = render(<HistorySearchOverlay load={loadLong} onAccept={() => {}} onExecute={() => {}} onCancel={() => {}} columns={() => 80} />);
    await tick();
    const rows = (r.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    const listRow = rows.find((l) => /0s/.test(l) && /one/.test(l));
    expect(listRow, "the list row must exist").toBeTruthy();
    expect(listRow).not.toContain("\u256d");
    expect(r.lastFrame()).toContain("… +3 lines");           // …and the pane is still there, just lower down
  });

  it("draws no pane at all when nothing matches", async () => {
    const r = render(<HistorySearchOverlay load={loadLong} onAccept={() => {}} onExecute={() => {}} onCancel={() => {}} columns={() => 120} />);
    await tick();
    r.stdin.write("zzzz"); await tick();
    expect(r.lastFrame()).toContain("No matching prompts");
    expect(r.lastFrame()).not.toContain("one");
  });

  it("accept hands the WHOLE entry over, pastedContents included", async () => {
    const withPaste: HistEntry[] = [{ text: "look at [Pasted text #1 +2 lines]", ts: Date.now(), pastedContents: { 1: { id: 1, type: "text", content: "a\nb\nc", lineCount: 2 } } }];
    const got: HistEntry[] = [];
    const r = render(<HistorySearchOverlay load={async () => withPaste} onAccept={(e) => got.push(e)} onExecute={() => {}} onCancel={() => {}} />);
    await tick();
    r.stdin.write("\x1b"); await tick();
    expect(got[0].pastedContents?.[1].content).toBe("a\nb\nc");
  });
});
