// test/tui/bgTasksPanel.test.tsx — the background-task control panel (Goal B Task 10): one row per
// running task (short id · type · description), an empty-state line when none, ↑/↓ selection, k/x stop
// the SELECTED task, esc closes. Mirrors planDialog.test.tsx's waitFor-before-keys discipline.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { BgTasksPanel } from "../../src/tui/BgTasksPanel.js";
import type { BackgroundTaskInfo } from "../../src/session/session.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const TASKS: BackgroundTaskInfo[] = [
  { task_id: "abc12345xyz", task_type: "local_bash", description: "sleep 999" },
  { task_id: "def", task_type: "agent", description: "reviewing" },
];

describe("<BgTasksPanel>", () => {
  it("renders one row per task (short id · type · description) and an empty-state line when none", async () => {
    const { lastFrame } = render(<BgTasksPanel tasks={TASKS} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    const f = frame(lastFrame);
    expect(f).toContain("abc12345 · local_bash · sleep 999");   // task_id truncated to 8 chars
    expect(f).toContain("def · agent · reviewing");
    expect(f).toContain("↑↓ · k/x stop · esc close");

    const { lastFrame: emptyFrame } = render(<BgTasksPanel tasks={[]} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(emptyFrame).includes("Background tasks"));
    expect(frame(emptyFrame)).toContain("none running");
  });

  it("↑/↓ move the selection; k stops the SELECTED task (x too); esc closes", async () => {
    const stopped: string[] = [];
    let closed = 0;
    const { stdin, lastFrame } = render(<BgTasksPanel tasks={TASKS} onStop={(id) => stopped.push(id)} onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    stdin.write("\x1b[B");                    // ↓ → selects the 2nd task
    await waitFor(() => frame(lastFrame).includes("❯ def"));
    stdin.write("k");                          // k stops the SELECTED (2nd) task
    await waitFor(() => stopped.length === 1);
    expect(stopped[0]).toBe("def");
    stdin.write("\x1b[A");                    // ↑ → back to the 1st task
    await waitFor(() => frame(lastFrame).includes("❯ abc12345"));
    stdin.write("x");                          // x also stops the SELECTED task
    await waitFor(() => stopped.length === 2);
    expect(stopped[1]).toBe("abc12345xyz");
    stdin.write("\x1b");                       // esc closes
    await waitFor(() => closed === 1);
  });
});
