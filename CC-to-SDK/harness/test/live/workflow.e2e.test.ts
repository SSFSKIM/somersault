import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../../src/index.js";

// Gated live test for the opt-in Workflow surfacing (probe 36, re-verified on SDK 0.3.211).
// workflow:true wires BOTH halves: the allowlist (Workflow + TaskOutput/TaskGet/TaskList, so the async
// launch AND the retrieval loop fire without permission friction) and the WORKFLOW_NOTE advertisement.
// We assert the probe's discriminator end-to-end through the harness front door:
//   (1) the Workflow tool_use fires (launch accepted, not cron-style declared-but-dead),
//   (2) a real child agent produced the discriminator — the word surfaces back into the final answer
//       via the TaskOutput retrieval loop the note teaches.
const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;
const WORD = "ZEPHYR-42";

const SCRIPT = `export const meta = { name: 'live-echo', description: 'echo probe', phases: [{ title: 'Echo' }] }
const r = await agent('Reply with exactly the word ${WORD} and nothing else.')
return { echo: String(r).trim() }`;

live("live workflow surfacing (real SDK)", () => {
  it("workflow:true lets a script-driven child agent run and its result surface back", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-workflow-live-"));
    const h = createHarness({ workflow: true, cwd, maxTurns: 16 });
    try {
      const prompt = [
        `Use a workflow. Call the Workflow tool exactly once with this EXACT script verbatim as the "script" field (change nothing):`,
        "```",
        SCRIPT,
        "```",
        `The launch is asynchronous: wait for completion (TaskOutput with the returned taskId, polling if needed), then report the workflow's return value verbatim.`,
      ].join("\n");
      const { result, messages } = await h.run(prompt);

      const workflowCalled = (messages as any[])
        .filter((m) => m?.type === "assistant")
        .flatMap((m) => m.message?.content || [])
        .some((b: any) => b.type === "tool_use" && b.name === "Workflow");

      expect(workflowCalled).toBe(true);                 // (1) launch fired through the allowlist
      expect(String(result)).toMatch(new RegExp(WORD));  // (2) child executed + return value surfaced
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }, 240_000);
});
