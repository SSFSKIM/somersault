// tui/test/taskList.test.ts — reduce native TaskCreate/TaskUpdate ops (probe-22b shapes) into a checklist.
import { describe, it, expect } from "vitest";
import { TaskList } from "../src/taskList.js";

const create = (id: string, subject: string) => [
  { type: "assistant", message: { content: [{ type: "tool_use", id: `tc${id}`, name: "TaskCreate", input: { subject, description: "d" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tc${id}`, content: `Task #${id} created successfully: ${subject}` }] } },
];
const update = (taskId: string, status: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: `tu${taskId}${status}`, name: "TaskUpdate", input: { taskId, status } }] } });

describe("TaskList", () => {
  it("reduces create+result into items, applies update by id, sorts numerically", () => {
    const tl = new TaskList();
    for (const m of create("1", "build the parser")) tl.ingest(m);
    for (const m of create("2", "write tests")) tl.ingest(m);
    tl.ingest(update("1", "in_progress"));
    expect(tl.snapshot()).toEqual([
      { id: "1", subject: "build the parser", status: "in_progress" },
      { id: "2", subject: "write tests", status: "pending" },
    ]);
  });
  it("ignores an update for an unknown id and resets", () => {
    const tl = new TaskList();
    tl.ingest(update("9", "completed"));         // no such task → no-op
    expect(tl.snapshot()).toEqual([]);
    for (const m of create("1", "x")) tl.ingest(m);
    expect(tl.snapshot()).toHaveLength(1);
    tl.reset();
    expect(tl.snapshot()).toEqual([]);
  });
});
