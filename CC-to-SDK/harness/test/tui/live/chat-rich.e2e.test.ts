// tui/test/live/chat-rich.e2e.test.ts — gated: a real Agent subagent nests+collapses; a task lands in the reducer.
import { describe, it, expect } from "vitest";
import { openSession } from "../../../src/index.js";
import { TranscriptDocument } from "../../../src/tui/transcriptModel.js";
import { projectCompact, projectPending } from "../../../src/tui/toolRenderer.js";
import { TaskList } from "../../../src/tui/taskList.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("chat rich rendering (live)", () => {
  it("nests a subagent and reduces a task", async () => {
    const session = openSession({ permissionMode: "bypassPermissions", includePartialMessages: true, forwardSubagentText: true });
    // F1 Task 4: a tool row is projected off the ONE retained document, never re-derived by the live reducer.
    const doc = new TranscriptDocument(); const tl = new TaskList();
    try {
      await session.submit(
        "Do two things: (1) TaskCreate a task 'demo task'. (2) Use the Task tool to launch a general-purpose subagent that runs the bash command `echo nested-ok` and reports it. Then say done.",
        (m) => { doc.appendSdk("host", m as Record<string, unknown>); tl.ingest(m); },
      );
      const context = { cwd: process.cwd(), home: process.cwd(), platform: process.platform, columns: 100, now: 0 };
      const lines = JSON.stringify([...projectCompact(doc, context), ...projectPending(doc, context)]);
      expect(lines).toMatch(/Agent/);                          // a subagent row rendered
      expect(tl.snapshot().length).toBeGreaterThanOrEqual(1); // a task was reduced
    } finally {
      await session.dispose();
    }
  }, 90_000);
});
