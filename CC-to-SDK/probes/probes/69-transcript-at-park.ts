// probes/probes/69-transcript-at-park.ts — at an AskUserQuestion park, is the assistant turn
// (with the pending tool_use) flushed to the on-disk transcript? Probe 62 proved NO mid-turn
// writes for ordinary tool calls; a park may or may not behave differently. The answer decides
// which blocked-reply arm doperpowers' renderer can produce against ccx (C6 spec, scenario ②).
//
// Reproducibility hardening (codex review, 2026-07-29): the sampler is cleared when the query ends
// (so a no-park run reports INCONCLUSIVE instead of leaking the timer forever), a not-yet-written
// transcript is retried until a bounded deadline rather than latched to NOT-FLUSHED on the first
// tick, and the flush check is PARSE-grade — it confirms an assistant entry whose content carries a
// tool_use block named AskUserQuestion, not merely a quoted substring.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const cwd = process.cwd();
const projDir = join(homedir(), ".claude", "projects", cwd.replace(/[/_.]/g, "-"));
let sessionId = "";
let parked = false;
let parkedAt = 0;

const HOLD_MS = 8000;          // how long canUseTool holds the park
const DEADLINE_MS = 7000;      // stop sampling this long into the park (inside the hold)

/** PARSE-grade flush check: is there an assistant transcript entry whose content array holds a
 *  tool_use block named AskUserQuestion? Returns true only for the real block, never a stray quote. */
function toolUseOnDisk(raw: string): boolean {
  for (const line of raw.trim().split("\n")) {
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    const msg = o?.message ?? o;
    if (msg?.role !== "assistant") continue;
    const content = msg?.content;
    if (Array.isArray(content) && content.some((b: any) => b?.type === "tool_use" && b?.name === "AskUserQuestion")) return true;
  }
  return false;
}

const q = query({
  prompt: "Before doing anything else, ask me one question via the AskUserQuestion tool: which color do I prefer, with options red and blue. Wait for my answer.",
  options: {
    cwd, permissionMode: "default", model: "claude-haiku-4-5-20251001",
    canUseTool: async (name, input) => {
      if (name === "AskUserQuestion") {
        parked = true; parkedAt = Date.now();
        await new Promise((r) => setTimeout(r, HOLD_MS)); // hold the park; the sampler reads meanwhile
        return { behavior: "deny", message: "probe done" };
      }
      return { behavior: "allow", updatedInput: input };
    },
  },
});

(async () => {
  let decided = false;
  const sampler = setInterval(() => {
    if (decided || !parked || !sessionId) return;
    let raw: string | undefined;
    try { raw = readFileSync(join(projDir, `${sessionId}.jsonl`), "utf8"); }
    catch { /* transcript not written yet — keep retrying within the hold */ }
    if (raw !== undefined && toolUseOnDisk(raw)) {
      const lines = raw.trim().split("\n").length;
      console.log(`[69] MID-PARK transcript: ${lines} lines, assistant tool_use(AskUserQuestion) on disk: true`);
      console.log(`[69] VERDICT: FLUSHED`);
      decided = true; clearInterval(sampler); return;
    }
    // No block yet. Only conclude NOT-FLUSHED once the bounded deadline inside the hold has passed —
    // filesystem timing must not be able to reverse the verdict on the first tick.
    if (Date.now() - parkedAt >= DEADLINE_MS) {
      console.log(`[69] MID-PARK: no assistant tool_use block after ${DEADLINE_MS}ms of the park (transcript ${raw === undefined ? "never appeared" : "present without the block"})`);
      console.log(`[69] VERDICT: NOT-FLUSHED`);
      decided = true; clearInterval(sampler);
    }
  }, 500);

  try {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") sessionId = (m as any).session_id;
      if (m.type === "result") console.log(`[69] turn ended: ${m.subtype}`);
    }
  } finally {
    clearInterval(sampler);                 // always: a no-park run must not leak the timer
    if (!decided && !parked) console.log(`[69] VERDICT: INCONCLUSIVE — the model never invoked AskUserQuestion (no park observed)`);
    else if (!decided) console.log(`[69] VERDICT: INCONCLUSIVE — park observed but the sampler did not decide before the turn ended`);
  }
})();
