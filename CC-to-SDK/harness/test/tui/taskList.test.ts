// tui/test/taskList.test.ts — reduce native TaskCreate/TaskUpdate ops (probe-22b shapes) into a checklist.
import { describe, it, expect } from "vitest";
import { TaskList } from "../../src/tui/taskList.js";

const create = (id: string, subject: string) => [
  { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: `tc${id}`, name: "TaskCreate", input: { subject, description: "d" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tc${id}`, content: `Task #${id} created successfully: ${subject}` }] } },
];
const update = (taskId: string, status: string) => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: `tu${taskId}${status}`, name: "TaskUpdate", input: { taskId, status } }] } });

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
  // F6 T13 (DG56-DG58). The three decorations are SCHEMA-OPTIONAL on both tools (bundle L286299/L286488) and
  // probe 81 Q3 saw a real run send none of them, so the contract is "ingest when present, absent otherwise" —
  // an item that was never told about a blocker must not carry an empty `blockedBy`, or the panel's blocker
  // line becomes a claim about information we never received.
  it("ingests activeForm from TaskCreate and owner/activeForm/addBlockedBy from TaskUpdate", () => {
    const tl = new TaskList();
    for (const m of create("1", "build the parser")) tl.ingest(m);
    for (const m of create("2", "write tests")) tl.ingest(m);
    tl.ingest({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tuA", name: "TaskUpdate", input: { taskId: "1", status: "in_progress", activeForm: "Building the parser", owner: "alice" } }] } });
    tl.ingest({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tuB", name: "TaskUpdate", input: { taskId: "2", addBlockedBy: ["1"] } }] } });
    expect(tl.snapshot()).toEqual([
      { id: "1", subject: "build the parser", status: "in_progress", activeForm: "Building the parser", owner: "alice" },
      { id: "2", subject: "write tests", status: "pending", blockedBy: ["1"] },
    ]);
  });

  it("keeps blockers additive and de-duplicated, and carries a TaskCreate activeForm through the result", () => {
    const tl = new TaskList();
    tl.ingest({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tc7", name: "TaskCreate", input: { subject: "ship", description: "d", activeForm: "Shipping" } }] } });
    tl.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tc7", content: "Task #7 created successfully: ship" }] } });
    const add = (ids: unknown[]) => tl.ingest({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: `tu${ids.join()}`, name: "TaskUpdate", input: { taskId: "7", addBlockedBy: ids } }] } });
    add(["3"]); add([3, "4"]);                      // a number id is stringified; a repeat does not duplicate
    expect(tl.snapshot()).toEqual([{ id: "7", subject: "ship", status: "pending", activeForm: "Shipping", blockedBy: ["3", "4"] }]);
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
