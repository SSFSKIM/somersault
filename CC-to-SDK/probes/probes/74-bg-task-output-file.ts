// Probe 74 — the U2 evidence base: what does a BACKGROUNDED Bash actually give a client to render?
//
// The 2.1.220 bundle's TaskOutput prompt says: "Background tasks return their output file path in the
// tool result, and you receive a <task-notification> with the same path when the task completes."
// That is what Claude Code TELLS THE MODEL. Declared ≠ reachable — nothing has verified what the SDK
// stream actually carries. Wave 2's background-visibility slice needs four answers:
//
//   Q1. The tool_result content for a run_in_background Bash: does it contain the output file path and
//       the task_id? (exact text, so a parser can be written against it)
//   Q2. The FULL field set of task_started / task_notification frames (output_file? command? summary?).
//   Q3. The FULL field set of each background_tasks_changed task entry — is it still only
//       {task_id, task_type, description}, or did 0.3.211 widen it?
//   Q4. Is the output file readable mid-run (tailable) — does it exist and accumulate stdout while the
//       task is still running?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "node:fs";

const LOOP = "for i in $(seq 1 20); do echo tick $i; sleep 1; done";
const PATH_RE = /(\/[^\s"'`)\]]+\.[a-z]+|\/[^\s"'`)\]]+\/[^\s"'`)\]]+)/g;   // crude absolute-path scraper

const q = query({
  prompt: `Use the Bash tool with run_in_background set to true to run exactly: ${LOOP} — then just say STARTED and stop. Do not wait for it, do not read its output.`,
  options: {
    model: "claude-haiku-4-5-20251001",
    maxTurns: 3,
    settingSources: [],
    permissionMode: "bypassPermissions",
    cwd: process.cwd(),
  },
});

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const foundPaths = new Set<string>();
let sawResult = false;

function scrape(label: string, text: string) {
  for (const m of text.matchAll(PATH_RE)) {
    if (m[0].includes("/") && !foundPaths.has(m[0])) { foundPaths.add(m[0]); console.log(`[${dt()}] PATH in ${label}: ${m[0]}`); }
  }
}

for await (const m of q) {
  const mm = m as any;
  if (mm.type === "assistant") {
    for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_use") console.log(`[${dt()}] tool_use ${b.name} input=${JSON.stringify(b.input)}`);
    }
  }
  if (mm.type === "user") {
    for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_result") {
        const text = JSON.stringify(b.content);
        console.log(`[${dt()}] Q1 tool_result is_error=${b.is_error} content=${text}`);
        scrape("tool_result", text);
      }
    }
  }
  if (mm.type === "system" && mm.subtype === "background_tasks_changed") {
    console.log(`[${dt()}] Q3 background_tasks_changed tasks=${JSON.stringify(mm.tasks)}`);
  } else if (mm.type === "system" && mm.subtype !== "init") {
    console.log(`[${dt()}] Q2 system/${mm.subtype} FULL=${JSON.stringify(mm)}`);
    scrape(`system/${mm.subtype}`, JSON.stringify(mm));
  } else if (mm.type === "task_started" || mm.type === "task_notification" || mm.type === "task_progress" || mm.type === "task_updated") {
    console.log(`[${dt()}] Q2 ${mm.type} FULL=${JSON.stringify(mm)}`);
    scrape(mm.type, JSON.stringify(mm));
  }
  if ("result" in mm && mm.type === "result") { sawResult = true; console.log(`[${dt()}] result subtype=${mm.subtype}`); break; }
}

// Q4: the turn is over but the loop (20s) should still be running. Try to read every scraped path.
console.log(`\n=== Q4: mid-run tailability (turn ended at ${dt()}, loop runs ~20s) ===`);
await new Promise((r) => setTimeout(r, 2000));
for (const p of foundPaths) {
  try {
    if (!existsSync(p)) { console.log(`Q4 ${p}: does not exist`); continue; }
    const c1 = readFileSync(p, "utf8");
    await new Promise((r) => setTimeout(r, 2500));
    const c2 = readFileSync(p, "utf8");
    console.log(`Q4 ${p}: EXISTS len=${c1.length}→${c2.length} growing=${c2.length > c1.length} tail="${c2.slice(-80).replace(/\n/g, "\\n")}"`);
  } catch (e: any) { console.log(`Q4 ${p}: read failed: ${e?.message}`); }
}
console.log(`\nprobe 74 done (sawResult=${sawResult}, paths=${foundPaths.size})`);
process.exit(0);
