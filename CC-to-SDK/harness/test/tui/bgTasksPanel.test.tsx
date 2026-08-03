// test/tui/bgTasksPanel.test.tsx — the background-task control panel (Goal B Task 10, enriched Wave 2
// U2): one row per running task (glyph · short id · type · command-or-description), an empty-state line
// when none, ↑/↓ selection, `x` stops the SELECTED running task, esc closes. Enter tails the task's
// output file via an injected `readTail` (real fs read by default); a second esc closes just the tail,
// a third closes the panel. Mirrors planDialog.test.tsx's waitFor-before-keys discipline.
//
// F2 task 8: the panel is on the keymap (`Select` context), so it needs the provider above it — and `k` is
// `select:previous` now, NOT the second stop shortcut it used to be. Stop is `x` alone; the keymap-level
// coverage for both lives in keys-migration-dialogs.test.tsx.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { BgTasksPanel } from "../../src/tui/BgTasksPanel.js";
import type { BgTaskRow } from "../../src/tui/bgTaskMeta.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function tick() { await new Promise((r) => setTimeout(r, 0)); }
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const row = (over: Partial<BgTaskRow> = {}): BgTaskRow =>
  ({ task_id: "bocnvmnhq", task_type: "local_bash", description: "timer loop", command: "seq 1 20", outputFile: "/tmp/t.output", status: "running", ...over });

const TASKS: BgTaskRow[] = [
  { task_id: "abc12345xyz", task_type: "local_bash", description: "sleep 999", command: "sleep 999", status: "running" },
  { task_id: "def", task_type: "agent", description: "reviewing", status: "completed" },
];

describe("<BgTasksPanel>", () => {
  it("renders one row per task (glyph · short id · type · command) and an empty-state line when none", async () => {
    const { lastFrame } = render(<BgTasksPanel tasks={TASKS} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    const f = frame(lastFrame);
    expect(f).toContain("abc12345 · local_bash · sleep 999");   // task_id truncated to 8 chars
    expect(f).toContain("def · agent · reviewing");             // no command → falls back to description
    expect(f).toContain("↑↓ · ⏎ output · x stop · esc close");

    const { lastFrame: emptyFrame } = render(<BgTasksPanel tasks={[]} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(emptyFrame).includes("Background tasks"));
    expect(frame(emptyFrame)).toContain("none running");
  });

  it("↑/↓ move the selection; x stops the SELECTED running task; esc closes", async () => {
    const stopped: string[] = [];
    let closed = 0;
    const { stdin, lastFrame } = render(<BgTasksPanel tasks={TASKS} onStop={(id) => stopped.push(id)} onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    stdin.write("\x1b[B");                    // ↓ → selects the 2nd task (completed — x must no-op)
    await waitFor(() => frame(lastFrame).includes("❯ ✓ def"));
    stdin.write("x");
    await tick();
    expect(stopped).toEqual([]);
    stdin.write("\x1b[A");                    // ↑ → back to the 1st task (running)
    await waitFor(() => frame(lastFrame).includes("❯ ⟳ abc12345"));
    stdin.write("x");                          // x stops the SELECTED (running) task
    await waitFor(() => stopped.length === 1);
    expect(stopped[0]).toBe("abc12345xyz");
    stdin.write("\x1b");                       // esc closes (no tail open)
    await waitFor(() => closed === 1);
  });

  it("shows status glyph and the command when known", async () => {
    const r = render(<BgTasksPanel tasks={[row()]} onStop={() => {}} onClose={() => {}} />);
    await tick();
    expect(r.lastFrame()).toContain("⟳");
    expect(r.lastFrame()).toContain("seq 1 20");
  });

  it("finished rows render their status and survive in the list", async () => {
    const r = render(<BgTasksPanel tasks={[row({ status: "completed" })]} onStop={() => {}} onClose={() => {}} />);
    await tick();
    expect(r.lastFrame()).toContain("✓");
  });

  it("Enter tails the selected task's output file via the injected reader; Esc closes the tail, second Esc the panel", async () => {
    let closed = 0;
    const reads: string[] = [];
    const r = render(<BgTasksPanel tasks={[row()]} onStop={() => {}} onClose={() => { closed++; }}
      readTail={(p) => { reads.push(p); return ["tick 1", "tick 2"]; }} />);
    await tick();
    r.stdin.write("\r");
    await tick();
    expect(reads).toEqual(["/tmp/t.output"]);
    expect(r.lastFrame()).toContain("tick 2");
    r.stdin.write("\x1b");                     // Esc #1: close the tail, panel stays
    await tick();
    expect(r.lastFrame()).not.toContain("tick 2");
    expect(closed).toBe(0);
    r.stdin.write("\x1b");                     // Esc #2: close the panel
    await tick();
    expect(closed).toBe(1);
  });

  it("Enter again re-reads (refresh)", async () => {
    let n = 0;
    const r = render(<BgTasksPanel tasks={[row()]} onStop={() => {}} onClose={() => {}} readTail={() => [`read ${++n}`]} />);
    await tick();
    r.stdin.write("\r"); await tick();
    r.stdin.write("\r"); await tick();
    expect(r.lastFrame()).toContain("read 2");
  });

  it("a local_agent task is not tailed (bundle: its .output is the subagent transcript JSONL)", async () => {
    const reads: string[] = [];
    const r = render(<BgTasksPanel tasks={[row({ task_type: "local_agent" })]} onStop={() => {}} onClose={() => {}} readTail={(p) => { reads.push(p); return []; }} />);
    await tick();
    r.stdin.write("\r"); await tick();
    expect(reads).toEqual([]);
    expect(r.lastFrame()).toContain("agent task");
  });

  it("a row with no outputFile explains instead of crashing", async () => {
    const r = render(<BgTasksPanel tasks={[row({ outputFile: undefined })]} onStop={() => {}} onClose={() => {}} readTail={() => []} />);
    await tick();
    r.stdin.write("\r"); await tick();
    expect(r.lastFrame()).toContain("no output file");
  });

  it("x stop only fires on running rows — and k never stops anything at all any more", async () => {
    const stops: string[] = [];
    const r = render(<BgTasksPanel tasks={[row({ status: "completed" })]} onStop={(id) => stops.push(id)} onClose={() => {}} />);
    await tick();
    r.stdin.write("x"); await tick();
    expect(stops).toEqual([]);

    const live = render(<BgTasksPanel tasks={[row()]} onStop={(id) => stops.push(id)} onClose={() => {}} />);
    await tick();
    live.stdin.write("k"); await tick();       // the RUNNING row: `k` is navigation now, never a stop
    expect(stops).toEqual([]);
    live.stdin.write("x"); await tick();
    expect(stops).toEqual(["bocnvmnhq"]);
  });
});
