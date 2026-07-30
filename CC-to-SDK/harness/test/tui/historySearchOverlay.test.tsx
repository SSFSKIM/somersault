// tui/test/historySearchOverlay.test.tsx — the Ctrl-R history-search overlay (Wave 2 task 7): loads the
// initial "everywhere" scope, incremental filter via rankHistory, Enter EXECUTES, Esc/Tab ACCEPTS into
// the composer, Ctrl-C cancels, Ctrl-R cycles the match, Ctrl-S cycles scope and reloads.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
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
    const r = render(<HistorySearchOverlay load={loadOk} onAccept={() => {}} onExecute={(t) => runs.push(t)} onCancel={() => {}} />);
    await tick();
    r.stdin.write("type"); await tick();
    expect(r.lastFrame()).not.toContain("fix the tests");
    r.stdin.write("\r"); await tick();
    expect(runs).toEqual(["run typecheck"]);
  });

  it("Esc ACCEPTS into the composer (bundle historySearch:accept), Ctrl-C cancels", async () => {
    const accepted: string[] = []; let cancelled = 0;
    const r = render(<HistorySearchOverlay load={loadOk} onAccept={(t) => accepted.push(t)} onExecute={() => {}} onCancel={() => { cancelled++; }} />);
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
    const r = render(<HistorySearchOverlay load={load} onAccept={() => {}} onExecute={(t) => runs.push(t)} onCancel={() => {}} />);
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
