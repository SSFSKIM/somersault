// probes/probes/19-auto-repeated-block-abort.ts
// open-Q-b: does an `auto` session degrade/abort under repeated permission BLOCKS (the documented -p
// 3-consecutive / 20-total fallback)? The CLASSIFIER won't block explicit commands (probe 18h), so we use the
// closest controllable proxy: a deny RULE the agent keeps hitting across sequential auto turns, recording each
// turn's result subtype. A shift to an error/abort subtype on later attempts = degradation under repeated blocks.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-sonnet-4-6";
const dir = mkdtempSync(join(tmpdir(), "probe19-"));
writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");

async function attempt(n: number) {
  let result: any, err: string | undefined;
  try {
    for await (const m of query({ prompt: `Attempt #${n}: run exactly this bash command and nothing else: curl -fsS http://127.0.0.1:9/x`, options: {
      model: MODEL, cwd: dir, maxTurns: 4, permissionMode: "auto" as any, settingSources: [] as any,
      settings: { permissions: { deny: ["Bash(curl:*)"] } } as any,
    } })) { if ("result" in m) result = m; }
  } catch (e: any) { err = e.message; }
  return { subtype: result?.subtype, err };
}

console.log("=== PROBE 19 — auto repeated-block abort characterization ===  model:", MODEL);
for (let i = 1; i <= 6; i++) {
  const r = await attempt(i);
  console.log(`attempt ${i}: subtype=${r.subtype}${r.err ? "  ERR=" + r.err : ""}`);
}
console.log("\nRecord whether later attempts shift subtype vs the first. Reaction: a daemon session that ends");
console.log("is already handled by supervisor.handleSessionEnd (restart on-failure / errored) — no new code.");
