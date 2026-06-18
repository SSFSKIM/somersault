// Probe 17d — DECISIVE mode×broker table for the REPL's default-mode choice. 17c showed `auto` firing the
// broker (contradicting 15/17), so the "auto = no prompts" premise (spec decision #2) is in doubt. Run the
// SAME gating op (an Edit) under each candidate mode in isolated single-string queries, recording whether
// the broker fired and whether the file changed. This decides which mode is the reliable "run freely, no
// prompts" default and which is the "prompt on dangerous ops" mode. Each mode run 2× to check determinism.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";

async function once(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), "probe17d-"));
  writeFileSync(join(dir, "f.txt"), "ORIGINAL\n");
  const seen: string[] = []; let result: any, err: string | undefined;
  try {
    for await (const m of query({ prompt: "Edit f.txt, replacing ORIGINAL with CHANGED. Then say done.", options: {
      model: MODEL, cwd: dir, maxTurns: 6, permissionMode: mode as any,
      canUseTool: async (tool: string, inp: any) => { seen.push(tool); return { behavior: "allow", updatedInput: inp } as any; },
    } })) { if ("result" in m) result = m; }
  } catch (e: any) { err = e.message; }
  const f = readFileSync(join(dir, "f.txt"), "utf8").trim();
  return { seen: [...new Set(seen)], f, subtype: result?.subtype, err };
}

console.log("=== PROBE 17d mode×broker table (Edit op, 2 runs each) ===  model:", MODEL);
const modes = ["bypassPermissions", "auto", "default", "acceptEdits"];
const rows: Record<string, any[]> = {};
for (const mode of modes) {
  rows[mode] = [await once(mode), await once(mode)];
  for (const [i, r] of rows[mode].entries())
    console.log(`[${mode} #${i + 1}] broker fired: ${brief(r.seen) || "NOTHING"}  | f.txt=${r.f} | subtype=${r.subtype}${r.err ? " THREW " + r.err : ""}`);
}

console.log("\n--- VERDICT: which mode is a clean 'no-prompt' default? ---");
for (const mode of modes) {
  const editFired = rows[mode].map((r) => r.seen.includes("Edit"));
  const allSilent = editFired.every((x) => !x);
  const allFired = editFired.every((x) => x);
  const verdict = allSilent ? "NO-PROMPT (broker silent on Edit both runs)" : allFired ? "PROMPTS (broker fired on Edit both runs)" : "NON-DETERMINISTIC (" + brief(editFired) + ")";
  console.log(`  ${mode.padEnd(18)} → ${verdict}`);
}
