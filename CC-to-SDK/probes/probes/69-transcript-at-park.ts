// probes/probes/69-transcript-at-park.ts — at an AskUserQuestion park, is the assistant turn
// (with the pending tool_use) flushed to the on-disk transcript? Probe 62 proved NO mid-turn
// writes for ordinary tool calls; a park may or may not behave differently. The answer decides
// which blocked-reply arm doperpowers' renderer can produce against ccx (C6 spec, scenario ②).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const cwd = process.cwd();
const projDir = join(homedir(), ".claude", "projects", cwd.replace(/[/_.]/g, "-"));
let sessionId = "";
let parked = false;

const q = query({
  prompt: "Before doing anything else, ask me one question via the AskUserQuestion tool: which color do I prefer, with options red and blue. Wait for my answer.",
  options: {
    cwd, permissionMode: "default", model: "claude-haiku-4-5-20251001",
    canUseTool: async (name, input) => {
      if (name === "AskUserQuestion") {
        parked = true;
        await new Promise((r) => setTimeout(r, 8000)); // hold the park; sample the transcript now
        return { behavior: "deny", message: "probe done" };
      }
      return { behavior: "allow", updatedInput: input };
    },
  },
});
(async () => {
  const sampler = setInterval(() => {
    if (!parked || !sessionId) return;
    try {
      const raw = readFileSync(join(projDir, `${sessionId}.jsonl`), "utf8");
      const hasToolUse = raw.includes('"AskUserQuestion"');
      const lines = raw.trim().split("\n").length;
      console.log(`[69] MID-PARK transcript: ${lines} lines, pending tool_use on disk: ${hasToolUse}`);
      console.log(`[69] VERDICT: ${hasToolUse ? "FLUSHED" : "NOT-FLUSHED"}`);
    } catch (e) { console.log(`[69] MID-PARK transcript unreadable: ${(e as Error).message} → NOT-FLUSHED`); }
    clearInterval(sampler);
  }, 500);
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") sessionId = (m as any).session_id;
    if (m.type === "result") console.log(`[69] turn ended: ${m.subtype}`);
  }
})();
