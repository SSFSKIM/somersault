// test/tui/bg-dialog.test.tsx — the Background dialog (F6 T13, DG60), rebuilt from `rsi` (bundle L481110).
// REPLACES `bgTasksPanel.test.tsx`, which pinned the pre-F6 panel: its "Background tasks" title, its
// `glyph · short-id · type · command` row, its "none running" empty line, its `↑↓ · ⏎ output · x stop · esc
// close` footer and its in-panel Escape-closes-the-tail-first behaviour are all GONE by design — upstream's
// dialog has a title, a counts subtitle, section headers, badge rows and a detail SUB-VIEW behind Enter.
// What survived unchanged and is re-pinned here: `x` stops the selected running task (and only a running one),
// `k` is navigation and never a stop, and Escape closes.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { BgTasksPanel } from "../../src/tui/BgTasksPanel.js";
import { bgSection, bgSubtitle, bgBadge, bgGroups } from "../../src/tui/bgDialogModel.js";
import type { BgTaskRow } from "../../src/tui/bgTaskMeta.js";

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const frame = (f: () => string | undefined) => plain(f());
const oneLine = (f: () => string | undefined) => frame(f).replace(/\s*\n\s*/g, " ");
async function tick() { await new Promise((r) => setTimeout(r, 0)); }
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const shell = (over: Partial<BgTaskRow> = {}): BgTaskRow =>
  ({ task_id: "bocnvmnhq", task_type: "local_bash", description: "timer loop", command: "seq 1 20", outputFile: "/tmp/t.output", status: "running", ...over });
const agent = (over: Partial<BgTaskRow> = {}): BgTaskRow =>
  ({ task_id: "agt1", task_type: "local_agent", description: "reviewing the diff", status: "running", ...over });

describe("bgDialogModel", () => {
  it("routes every task_type to a section, unknown ones included", () => {
    expect(bgSection("local_bash")).toBe("shells");
    expect(bgSection("local_agent")).toBe("agents");
    expect(bgSection("agent")).toBe("agents");
    expect(bgSection("monitor_mcp")).toBe("monitors");
    expect(bgSection("something_new")).toBe("tasks");
  });

  it("the counts subtitle joins its clauses with ` · `, drops zeros and singularises", () => {
    expect(bgSubtitle([shell(), shell({ task_id: "b" }), agent()])).toBe("1 agent · 2 active shells");
    expect(bgSubtitle([agent(), agent({ task_id: "x" })])).toBe("2 agents");
    expect(bgSubtitle([shell({ status: "completed" })])).toBe("");        // finished rows count for nothing
    expect(bgSubtitle([])).toBe("");
  });

  it("maps each status to its badge label and role", () => {
    expect(bgBadge("completed")).toEqual({ label: "done", color: "success" });
    expect(bgBadge("failed")).toEqual({ label: "error", color: "error" });
    expect(bgBadge("stopped")).toEqual({ label: "stopped", color: "warning" });
    expect(bgBadge("running")).toEqual({ label: "running" });
  });

  it("groups keep section order and the flat list is what the cursor indexes", () => {
    const { groups, flat } = bgGroups([shell(), agent(), shell({ task_id: "s2" })]);
    expect(groups.map((g) => g.label)).toEqual(["Agents", "Shells"]);
    expect(flat.map((r) => r.task_id)).toEqual(["agt1", "bocnvmnhq", "s2"]);
  });
});

describe("<BgTasksPanel> — the list", () => {
  it("renders the frame, the counts subtitle, section headers, pointer rows, badges and the footer", async () => {
    const { lastFrame } = render(<BgTasksPanel tasks={[shell(), agent(), shell({ task_id: "s2", command: "npm test", status: "completed" })]} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    const f = oneLine(lastFrame);
    expect(f).toContain("Background");
    expect(f).toContain("1 agent · 1 active shell");
    expect(f).toContain("Agents (1)");
    expect(f).toContain("Shells (2)");
    expect(f).toContain("❯ reviewing the diff (running)");               // the cursor opens on the first row
    expect(f).toContain("seq 1 20 (running)");
    expect(f).toContain("npm test (done)");
    expect(f).toContain("↑↓ select · enter view · x stop · escape close");
  });

  it("says `No tasks currently running` and nothing else when the list is empty", async () => {
    const { lastFrame } = render(<BgTasksPanel tasks={[]} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    expect(frame(lastFrame)).toContain("No tasks currently running");
    expect(frame(lastFrame)).not.toContain("Shells");
  });

  it("↑/↓ and j/k move the cursor across sections; x stops the SELECTED running task; escape closes", async () => {
    const stopped: string[] = [];
    let closed = 0;
    const tasks = [agent(), shell(), shell({ task_id: "s2", command: "npm test", status: "completed" })];
    const { stdin, lastFrame } = render(<BgTasksPanel tasks={tasks} onStop={(id) => stopped.push(id)} onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    stdin.write("j");
    await waitFor(() => oneLine(lastFrame).includes("❯ seq 1 20"));
    stdin.write("\x1b[B");                                               // ↓ onto the completed row
    await waitFor(() => oneLine(lastFrame).includes("❯ npm test"));
    stdin.write("x"); await tick();
    expect(stopped).toEqual([]);                                         // not running → x is inert
    stdin.write("k");
    await waitFor(() => oneLine(lastFrame).includes("❯ seq 1 20"));
    expect(stopped).toEqual([]);                                         // `k` never stopped anything on the way
    stdin.write("x");
    await waitFor(() => stopped.length === 1);
    expect(stopped).toEqual(["bocnvmnhq"]);
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
  });
});

describe("<BgTasksPanel> — the detail sub-view", () => {
  it("Enter on a shell shows Status/Runtime/Command and the last lines of its output; left goes back", async () => {
    const reads: string[] = [];
    const row = shell({ startedAt: 1_000, endedAt: undefined });
    const { stdin, lastFrame } = render(
      <BgTasksPanel tasks={[row]} onStop={() => {}} onClose={() => {}} now={() => 8_000}
        readTail={(p) => { reads.push(p); return ["tick 1", "tick 2"]; }} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Shell details"));
    const f = oneLine(lastFrame);
    expect(reads).toEqual(["/tmp/t.output"]);
    expect(f).toContain("Status:");
    expect(f).toContain("running");
    expect(f).toContain("Runtime:");
    expect(f).toContain("7s");                                           // (8000 - 1000) ms
    expect(f).toContain("Command:");
    expect(f).toContain("seq 1 20");
    expect(f).toContain("Output:");
    expect(f).toContain("tick 2");
    expect(f).toContain("Showing 2 lines");
    expect(f).toContain("left go back");
    stdin.write("\x1b[D");                                               // ← returns to the list
    await waitFor(() => !frame(lastFrame).includes("Shell details"));
    expect(frame(lastFrame)).toContain("Background");
  });

  it("a shell with no output file says so instead of crashing", async () => {
    const { stdin, lastFrame } = render(<BgTasksPanel tasks={[shell({ outputFile: undefined })]} onStop={() => {}} onClose={() => {}} readTail={() => []} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Shell details"));
    expect(frame(lastFrame)).toContain("No output available");
  });

  it("an unreadable output file reports the error in place of the tail", async () => {
    const { stdin, lastFrame } = render(<BgTasksPanel tasks={[shell()]} onStop={() => {}} onClose={() => {}} readTail={() => { throw new Error("ENOENT: no such file"); }} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Shell details"));
    expect(oneLine(lastFrame)).toContain("ENOENT: no such file");
  });

  it("Enter on an agent shows `<type> › <description>` with a status line, and is never tailed", async () => {
    const reads: string[] = [];
    const { stdin, lastFrame } = render(
      <BgTasksPanel tasks={[agent({ outputFile: "/tmp/agent.jsonl", status: "completed", summary: "3 files reviewed", startedAt: 0, endedAt: 5_000 })]}
        onStop={() => {}} onClose={() => {}} readTail={(p) => { reads.push(p); return ["never"]; }} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("›"));
    const f = oneLine(lastFrame);
    expect(f).toContain("agent › reviewing the diff");
    expect(f).toContain("Completed");
    expect(f).toContain("5s");
    expect(f).toContain("3 files reviewed");
    expect(reads).toEqual([]);                                           // its .output is the transcript JSONL
  });

  it("x stops from inside the detail view, and escape there closes the whole dialog", async () => {
    const stopped: string[] = [];
    let closed = 0;
    const { stdin, lastFrame } = render(<BgTasksPanel tasks={[shell()]} onStop={(id) => stopped.push(id)} onClose={() => { closed++; }} readTail={() => []} />);
    await waitFor(() => frame(lastFrame).includes("Background"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Shell details"));
    stdin.write("x");
    await waitFor(() => stopped.length === 1);
    expect(stopped).toEqual(["bocnvmnhq"]);
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
  });
});
