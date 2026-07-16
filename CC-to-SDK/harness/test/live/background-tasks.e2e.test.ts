// Wave 1 live e2e: background-task visibility (probe 39). NEVER use leading-sleep commands here —
// CLI 2.1.211 blocks them ("Blocked: sleep 45 …"); until-loop long-runners are the sanctioned shape.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession } from "../../src/session/index.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const until = async (cond: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
  return cond();
};

live("background-task visibility (live)", () => {
  it("tracks the changed-set level signal, stops a task, and Ctrl+Bs a foreground one", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bgtasks-live-"));
    const s = openSession({ cwd, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 4 });
    try {
      // 1. model launches a run_in_background until-loop → the changed frame populates the set
      await s.submit(`You MUST call the Bash tool exactly once, with run_in_background set to true, running this exact command: until [ -f ${cwd}/stop.flag ]; do sleep 2; done; echo DONE\nAfter the tool call has returned, reply with exactly: LAUNCHED`);
      expect(await until(() => s.backgroundTasks.length === 1, 10_000)).toBe(true);
      const task = s.backgroundTasks[0];
      expect(task.task_id).toBeTruthy();
      expect(task.task_type).toBe("local_bash");

      // 2. stopTask empties the level set (REPLACE semantics — probe 39 Q4)
      await s.stopTask(task.task_id);
      expect(await until(() => s.backgroundTasks.length === 0, 10_000)).toBe(true);

      // 3. Ctrl+B: background a BLOCKING foreground command mid-turn; the turn then completes.
      // Contract sharp edge (run-1 lesson): NO-ARG backgroundAll returns false "only when toolUseId
      // was given and it matched no foreground task" — i.e. the no-arg form returns TRUE even with
      // nothing in flight. So capture the Bash tool_use id from the stream and poll the TARGETED
      // form, which reports false until that task is actually foreground-running.
      let toolUseId: string | undefined;
      const turn = s.submit(`You MUST call the Bash tool exactly once, in the FOREGROUND (run_in_background false/omitted), running this exact command: until [ -f ${cwd}/fg.flag ]; do sleep 2; done; echo FG-DONE\nWhen the command returns, reply with exactly: FG-FINISHED`,
        (m: any) => { if (m.type === "assistant") for (const b of m.message?.content ?? []) if (b.type === "tool_use" && b.name === "Bash") toolUseId = b.id; });
      expect(await until(() => !!toolUseId, 60_000)).toBe(true);
      let backgrounded = false;
      const deadline = Date.now() + 30_000;
      while (!backgrounded && Date.now() < deadline) {
        backgrounded = await s.backgroundAll(toolUseId).catch(() => false);
        if (!backgrounded) await new Promise((r) => setTimeout(r, 1000));
      }
      expect(backgrounded).toBe(true);
      expect(await until(() => s.backgroundTasks.length === 1, 10_000)).toBe(true);
      await turn;                                        // the blocked tool call returned; the turn finished
      writeFileSync(join(cwd, "fg.flag"), "");           // release the loop → task settles + set empties
      expect(await until(() => s.backgroundTasks.length === 0, 15_000)).toBe(true);
    } finally {
      try { writeFileSync(join(cwd, "stop.flag"), ""); writeFileSync(join(cwd, "fg.flag"), ""); } catch {}
      await s.dispose();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 180_000);
});
