import { describe, it, expect } from "vitest";
import { BgMetaHarvest } from "../../src/tui/bgTaskMeta.js";

const TOOL_USE_ID = "toolu_01KrsPWp7gjRVVsTumgFznHg";
const OUT = "/private/tmp/claude-501/-proj/908d85bf/tasks/bocnvmnhq.output";
const assistantBgBash = {
  type: "assistant",
  message: { content: [{ type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: { command: "for i in $(seq 1 20); do echo tick $i; sleep 1; done", run_in_background: true } }] },
};
// Probe 74 Q1: the tool_result content verbatim (string form).
const userResult = {
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: TOOL_USE_ID, content: `Command running in background with ID: bocnvmnhq. Output is being written to: ${OUT}. You will be notified when it completes. To check interim output, use Read on that file path.` }] },
};
const taskStarted = { type: "system", subtype: "task_started", task_id: "bocnvmnhq", tool_use_id: TOOL_USE_ID, description: "Background timer loop", task_type: "local_bash" };
const live = [{ task_id: "bocnvmnhq", task_type: "local_bash", description: "Background timer loop" }];

describe("BgMetaHarvest", () => {
  it("links command (tool_use input) and output file (tool_result text) to the task via task_started's tool_use_id", () => {
    const h = new BgMetaHarvest();
    h.ingestMessage(assistantBgBash);
    h.ingestTask(taskStarted);
    h.ingestMessage(userResult);
    const rows = h.rows(live);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task_id: "bocnvmnhq", command: "for i in $(seq 1 20); do echo tick $i; sleep 1; done", outputFile: OUT, status: "running" });
  });

  it("parses the tool_result path from array-of-blocks content too", () => {
    const h = new BgMetaHarvest();
    h.ingestTask(taskStarted);
    h.ingestMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: TOOL_USE_ID, content: [{ type: "text", text: `Command running in background with ID: bocnvmnhq. Output is being written to: ${OUT}. You will be notified when it completes.` }] }] } });
    expect(h.rows(live)[0].outputFile).toBe(OUT);
  });

  it("a task_notification moves the task to the finished list with its status once it leaves the live set", () => {
    const h = new BgMetaHarvest();
    h.ingestMessage(assistantBgBash);
    h.ingestTask(taskStarted);
    h.ingestMessage(userResult);
    h.ingestTask({ type: "system", subtype: "task_notification", task_id: "bocnvmnhq", status: "completed", summary: "20 ticks" });
    const rows = h.rows([]);                       // no longer in the live snapshot
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task_id: "bocnvmnhq", status: "completed", summary: "20 ticks", outputFile: OUT, command: "for i in $(seq 1 20); do echo tick $i; sleep 1; done" });
  });

  it("a live task is never duplicated by its own notification (live row wins)", () => {
    const h = new BgMetaHarvest();
    h.ingestTask(taskStarted);
    h.ingestTask({ type: "system", subtype: "task_notification", task_id: "bocnvmnhq", status: "stopped" });
    expect(h.rows(live)).toHaveLength(1);
    expect(h.rows(live)[0].status).toBe("running");
  });

  it("caps finished history at 5, newest first", () => {
    const h = new BgMetaHarvest();
    for (let i = 0; i < 7; i++) {
      h.ingestTask({ type: "system", subtype: "task_started", task_id: `t${i}`, tool_use_id: `tu${i}`, description: `d${i}`, task_type: "local_bash" });
      h.ingestTask({ type: "system", subtype: "task_notification", task_id: `t${i}`, status: "completed" });
    }
    const rows = h.rows([]);
    expect(rows.map((r) => r.task_id)).toEqual(["t6", "t5", "t4", "t3", "t2"]);
  });

  it("ignores notifications for tasks it never saw start (the host's synthetic rewind frame)", () => {
    const h = new BgMetaHarvest();
    h.ingestTask({ type: "task_notification", task_id: "rewind", status: "stopped", summary: "background tasks ended by rewind" });
    expect(h.rows([])).toEqual([]);
  });

  it("bare-type task frames (no system wrapper) are handled like system-subtype ones", () => {
    const h = new BgMetaHarvest();
    h.ingestTask({ type: "task_started", task_id: "x1", tool_use_id: "tux", description: "d", task_type: "local_bash" });
    h.ingestTask({ type: "task_notification", task_id: "x1", status: "failed" });
    expect(h.rows([])[0]).toMatchObject({ task_id: "x1", status: "failed" });
  });

  it("ingest is idempotent (replayed/buffered dup frames change nothing)", () => {
    const h = new BgMetaHarvest();
    for (let i = 0; i < 3; i++) { h.ingestMessage(assistantBgBash); h.ingestTask(taskStarted); h.ingestMessage(userResult); }
    expect(h.rows(live)).toHaveLength(1);
  });

  it("reset clears everything (session swap / rewind)", () => {
    const h = new BgMetaHarvest();
    h.ingestTask(taskStarted);
    h.ingestTask({ type: "system", subtype: "task_notification", task_id: "bocnvmnhq", status: "completed" });
    h.reset();
    expect(h.rows([])).toEqual([]);
  });

  it("a foreground Bash (no run_in_background) contributes nothing", () => {
    const h = new BgMetaHarvest();
    h.ingestMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tuF", name: "Bash", input: { command: "ls" } }] } });
    h.ingestTask({ type: "system", subtype: "task_started", task_id: "tf", tool_use_id: "tuF", description: "d", task_type: "local_bash" });
    expect(h.rows([{ task_id: "tf", task_type: "local_bash", description: "d" }])[0].command).toBeUndefined();
  });
});
