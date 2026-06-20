// probes/probes/32-appserver-sdk-turn-shapes.ts — A1 for the Codex app-server translator.
// Dumps the exact SDK message shapes across TWO turns of ONE session so the translator maps real
// fields, and so the registry's usage accumulation is correct (per-turn vs already-cumulative).
// Run: set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/32-appserver-sdk-turn-shapes.ts
import { openSession } from "../../harness/dist/index.js";

(async () => {
  const s = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
  const prompts: Array<[string, string]> = [["1", "Reply with exactly the word: one"], ["2", "Reply with exactly the word: two"]];
  for (const [i, prompt] of prompts) {
    let asst = "";
    const r = await s.submit(prompt, (m: any) => { if (m?.type === "assistant" && !asst) asst = JSON.stringify(m?.message?.content)?.slice(0, 220); });
    let usage: unknown;
    try { usage = await s.usage(); } catch (e) { usage = "usage() threw: " + (e as Error).message; }
    console.error(`TURN ${i}: result=${JSON.stringify(r.result)?.slice(0, 80)}`);
    console.error(`  asst.content=${asst}`);
    console.error(`  usage=${JSON.stringify(usage)?.slice(0, 360)}`);
  }
  await s.dispose();
  console.error("--- read TURN 1 vs TURN 2 usage: if TURN 2 totals > TURN 1, usage() is CUMULATIVE (registry takes latest); if similar, it is PER-TURN (registry sums).");
})().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
