// tui/test/live/chat-rich.e2e.test.ts — gated: a real Agent subagent nests+collapses; a task lands in the reducer.
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";
import { LiveTurn } from "../../src/liveTurn.js";
import { TaskList } from "../../src/taskList.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat rich rendering (live)", () => {
  it("nests a subagent and reduces a task", async () => {
    const session = openSession({ permissionMode: "bypassPermissions", includePartialMessages: true, forwardSubagentText: true });
    const lt = new LiveTurn(); const tl = new TaskList();
    try {
      await session.submit(
        "Do two things: (1) TaskCreate a task 'demo task'. (2) Use the Task tool to launch a general-purpose subagent that runs the bash command `echo nested-ok` and reports it. Then say done.",
        (m) => { lt.ingest(m); tl.ingest(m); },
      );
      const lines = lt.finalize().map((l) => l.text).join("\n");
      expect(lines).toMatch(/⚙ Agent/);                       // a subagent block rendered
      expect(tl.snapshot().length).toBeGreaterThanOrEqual(1); // a task was reduced
    } finally {
      await session.dispose();
    }
  }, 90_000);
});
