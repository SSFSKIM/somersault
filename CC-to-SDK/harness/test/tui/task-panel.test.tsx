// test/tui/task-panel.test.tsx — the todo panel rebuilt to upstream anatomy (F6 T13, DG56-DG60).
//
// What is pinned here, and where each pin comes from:
//   · the header sentence and its CONDITIONAL in-progress clause (`fGo`'s standalone branch, bundle L407193);
//   · the three glyphs AND the attributes that ride with them — strikethrough+dim on a completed subject,
//     bold on an in-progress one (`PCp` L407232-407235). Those are read off the RAW SGR frame, because a
//     stripped frame cannot tell a struck-through row from a plain one;
//   · `null` on an empty list — the panel has no empty state at all (L407099);
//   · the three decorations, each gated on the wire actually carrying its field (probe 81 Q3) and the owner
//     tag additionally on the ≥60-column rule (L407212);
//   · the window + its overflow sentence (L407180-407191).
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { TaskPanel } from "../../src/tui/TaskPanel.js";
import type { TaskItem } from "../../src/tui/taskList.js";
import { OWNER_TAG_WIDTH, todoOverflowLine, todoWindowSize } from "../../src/tui/taskPanelModel.js";

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const oneLine = (s: string | undefined) => plain(s).replace(/\s*\n\s*/g, " ").trim();
const task = (over: Partial<TaskItem> & { id: string }): TaskItem => ({ subject: `task ${over.id}`, status: "pending", ...over });

/** The RAW line (escapes intact) that `text` renders on — one row per line, so this is the row's whole SGR
 *  state. Attributes nest (`\x1b[9m\x1b[2m…`), so an assertion has to see the run, not the innermost pair. */
function rawLine(frame: string | undefined, text: string): string {
  return (frame ?? "").split("\n").find((l) => plain(l).includes(text)) ?? "";
}
/** Ink lays a row out by MEASURED width, and these glyphs measure 2 columns (East-Asian-ambiguous) while
 *  printing as 1 — so the gutter between glyph and subject is one or two spaces depending on the terminal.
 *  Every glyph assertion is therefore written against `\s+`, never a literal single space. */
const hasRow = (frame: string | undefined, glyph: string, subject: string) =>
  new RegExp(`${glyph}\\s+${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(plain(frame));

describe("TaskPanel — header", () => {
  it("counts read `N tasks (M done, K in progress, J open)`", () => {
    const { lastFrame } = render(<TaskPanel tasks={[
      task({ id: "1", status: "completed" }), task({ id: "2", status: "in_progress" }),
      task({ id: "3" }), task({ id: "4" }),
    ]} rows={40} />);
    expect(oneLine(lastFrame())).toContain("4 tasks (1 done, 1 in progress, 2 open)");
  });

  it("drops the in-progress clause entirely when nothing is in progress", () => {
    const { lastFrame } = render(<TaskPanel tasks={[task({ id: "1", status: "completed" }), task({ id: "2" })]} rows={40} />);
    const f = oneLine(lastFrame());
    expect(f).toContain("2 tasks (1 done, 1 open)");
    expect(f).not.toContain("in progress");
  });

  it("renders NOTHING for an empty list — there is no empty state", () => {
    const { lastFrame } = render(<TaskPanel tasks={[]} />);
    expect((lastFrame() ?? "").trim()).toBe("");
  });
});

describe("TaskPanel — glyphs and their attributes", () => {
  const TASKS = [
    task({ id: "1", subject: "ship it", status: "completed" }),
    task({ id: "2", subject: "build the parser", status: "in_progress" }),
    task({ id: "3", subject: "write tests" }),
  ];

  it("draws ✔ / ◼ / ◻ with the subject beside each", () => {
    const f = render(<TaskPanel tasks={TASKS} rows={40} />).lastFrame();
    expect(hasRow(f, "✔", "ship it")).toBe(true);
    expect(hasRow(f, "◼", "build the parser")).toBe(true);
    expect(hasRow(f, "◻", "write tests")).toBe(true);
  });

  it("a completed subject is struck through and dim; an in-progress one is bold; a pending one is neither", () => {
    const raw = render(<TaskPanel tasks={TASKS} rows={40} />).lastFrame() ?? "";
    const completed = rawLine(raw, "ship it");
    expect(completed).toContain("\x1b[9m");                              // strikethrough
    expect(completed).toContain("\x1b[2m");                              // dim
    expect(rawLine(raw, "build the parser")).toContain("\x1b[1m");       // bold
    const pending = rawLine(raw, "write tests");
    expect(pending).not.toContain("\x1b[9m");
    expect(pending).not.toContain("\x1b[1m");
  });
});

describe("TaskPanel — the three decorations (rendered only when the wire carried them)", () => {
  it("the owner tag needs an owner AND ≥60 columns", () => {
    const tasks = [task({ id: "1", subject: "claimed", status: "in_progress", owner: "alice" })];
    expect(oneLine(render(<TaskPanel tasks={tasks} columns={80} rows={40} />).lastFrame())).toContain("(@alice)");
    expect(oneLine(render(<TaskPanel tasks={tasks} columns={59} rows={40} />).lastFrame())).not.toContain("@alice");
    expect(oneLine(render(<TaskPanel tasks={[task({ id: "1", subject: "unclaimed" })]} columns={80} rows={40} />).lastFrame())).not.toContain("(@");
  });

  it("the owner tag's subject budget is measured in DISPLAY columns, not characters (`Ut`, L407214)", () => {
    expect(OWNER_TAG_WIDTH("bob")).toBe(" (@bob)".length);
    expect(OWNER_TAG_WIDTH("日本")).toBe(8);                             // 4 punctuation columns + 2 wide chars
  });

  it("the blocker clause names only blockers that are still open, numerically sorted", () => {
    const f = oneLine(render(<TaskPanel rows={40} tasks={[
      task({ id: "2", status: "completed" }),                            // a CLOSED blocker: must not be named
      task({ id: "12", status: "in_progress" }),
      task({ id: "13" }),
      task({ id: "20", subject: "waiting", blockedBy: ["13", "12", "2"] }),
    ]} />).lastFrame());
    expect(f).toContain("waiting › blocked by #12, #13");
  });

  it("the activity sub-line is the activeForm, for an in-progress UNBLOCKED row only", () => {
    const running = task({ id: "1", subject: "parser", status: "in_progress", activeForm: "Running tests" });
    expect(oneLine(render(<TaskPanel tasks={[running]} rows={40} />).lastFrame())).toContain("Running tests…");
    // pending with the same field: no sub-line
    expect(oneLine(render(<TaskPanel tasks={[{ ...running, status: "pending" }]} rows={40} />).lastFrame())).not.toContain("Running tests…");
    // in progress but blocked by an open task: the blocker line replaces it
    const blocked = oneLine(render(<TaskPanel rows={40} tasks={[task({ id: "9" }), { ...running, blockedBy: ["9"] }]} />).lastFrame());
    expect(blocked).not.toContain("Running tests…");
    expect(blocked).toContain("blocked by #9");
  });
});

describe("TaskPanel — window and overflow", () => {
  it("shows the window and summarises the tail", () => {
    // Six in progress, three pending: the window (5) takes five of the in-progress rows, so the tail is one
    // of each kind and the sentence has to carry both clauses in upstream's order.
    const tasks: TaskItem[] = [
      ...[1, 2, 3, 4, 5, 6].map((n) => task({ id: String(n), status: "in_progress" })),
      ...[7, 8, 9].map((n) => task({ id: String(n) })),
    ];
    const f = oneLine(render(<TaskPanel tasks={tasks} rows={24} />).lastFrame());   // window = 5
    expect(f).toContain("9 tasks (0 done, 6 in progress, 3 open)");
    expect(f).toContain("… +1 in progress, 3 pending");
    expect(f).not.toContain("task 9");                                   // the tail is summarised, not drawn
  });

  it("a task completed while mounted is hoisted to the top of the window", () => {
    const before: TaskItem[] = [1, 2, 3, 4, 5, 6, 7].map((n) => task({ id: String(n) }));
    const r = render(<TaskPanel tasks={before} rows={24} />);
    r.rerender(<TaskPanel tasks={before.map((t) => (t.id === "7" ? { ...t, status: "completed" as const } : t))} rows={24} />);
    const rows = plain(r.lastFrame()).split("\n").map((l) => l.trim()).filter(Boolean);
    expect(rows[1]).toMatch(/✔\s+task 7/);                               // row 0 is the header
  });

  it("the window is a function of the terminal HEIGHT, and a short terminal shows no rows at all", () => {
    expect(todoWindowSize(10)).toBe(0);
    expect(todoWindowSize(20)).toBe(5);
    expect(todoWindowSize(16)).toBe(3);
    const f = oneLine(render(<TaskPanel tasks={[task({ id: "1", subject: "invisible" })]} rows={10} />).lastFrame());
    expect(f).toContain("1 tasks (0 done, 1 open)");
    expect(f).not.toContain("invisible");
    expect(f).not.toContain("…");                                        // the overflow line is gated on the window too
  });

  it("todoOverflowLine keeps upstream's clause order and drops the zeros", () => {
    expect(todoOverflowLine([task({ id: "1" }), task({ id: "2", status: "completed" }), task({ id: "3", status: "in_progress" })]))
      .toBe(" … +1 in progress, 1 pending, 1 completed");
    expect(todoOverflowLine([])).toBe("");
  });
});
