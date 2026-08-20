// tui/test/taskList.test.ts — reduce native TaskCreate/TaskUpdate ops (probe-22b shapes) into a checklist.
import { describe, it, expect } from "vitest";
import { TaskList } from "../../src/tui/taskList.js";

// `frame` is the CREATE frame's own top-level fields — F8 T4 reads provenance from there, so a case needs to
// be able to vary it (nested id / omitted field / empty string) while the RESULT frame keeps carrying none.
const create = (id: string, subject: string, frame: Record<string, unknown> = { parent_tool_use_id: null }) => [
  { type: "assistant", ...frame, message: { content: [{ type: "tool_use", id: `tc${id}`, name: "TaskCreate", input: { subject, description: "d" } }] } },
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

  // F8 T4. Canon's spinner asks "is this the MAIN agent's task?" and can, because its task store is per-agent;
  // ours is one global store, so the origin has to be recorded at ingest instead. Recorded ONLY — nothing is
  // filtered here, and the panel keeps showing every task (see the length/order of the expectation below).
  // The four creates are deliberately interleaved with their results: provenance belongs to the pending
  // TaskCreate, not to whichever frame arrived most recently, and the results themselves carry no origin at
  // all — so reading it off the result frame, or off a per-instance "last frame was nested" flag, marks the
  // wrong task. `toStrictEqual` also pins absent-rather-than-empty: an unmarked task must not carry the key.
  it("records subagent provenance per task from the create frame, and still shows every task", () => {
    const tl = new TaskList();
    const [mainCreate, mainResult] = create("1", "main work");
    const [subCreate, subResult] = create("2", "nested work", { parent_tool_use_id: "agent_1" });
    const [omitCreate, omitResult] = create("3", "field-absent work", {});
    const [emptyCreate, emptyResult] = create("4", "empty-string work", { parent_tool_use_id: "" });
    for (const m of [mainCreate, subCreate, mainResult, subResult, omitCreate, emptyCreate, emptyResult, omitResult]) tl.ingest(m);
    expect(tl.snapshot()).toStrictEqual([
      { id: "1", subject: "main work", status: "pending" },
      { id: "2", subject: "nested work", status: "pending", subagent: true },
      { id: "3", subject: "field-absent work", status: "pending" },
      { id: "4", subject: "empty-string work", status: "pending" },
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
