// probes/probes/29-pre-turn-model-control.ts — A1 for Increment C #6 (the dashboard m-cycle bug).
// session.ts creates the query eagerly but the SDK control surface only wakes after the first turn primes
// the init frame (input queue empty until submit). This probe confirms, on the HARNESS Session path that the
// daemon actually uses (capabilities()/setModel), three things the m-bug fix hinges on:
//   (1) capabilities().models is EMPTY before any turn, and RICH after one turn  → need a curated fallback
//   (2) setModel() BEFORE any turn: does it throw, hang, or silently queue?
//   (3) does that pre-turn setModel actually take effect on the first turn?
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/29-pre-turn-model-control.ts
import { openSession } from "../../harness/dist/index.js";

const START = "claude-opus-4-8";
const SWITCH = "claude-haiku-4-5-20251001";

async function len(s: any, label: string): Promise<number> {
  try { const caps = await s.capabilities(); const n = (caps?.models ?? []).length; console.log(`[${label}] capabilities().models.length =`, n); return n; }
  catch (e) { console.log(`[${label}] capabilities() threw:`, (e as Error).message); return -1; }
}

(async () => {
  console.log("=== probe 29: pre-turn model control (m-bug grounding) ===");
  const s = openSession({ model: START, permissionMode: "bypassPermissions" } as any);
  try {
    // (1) before any turn
    const before = await len(s, "pre-turn");

    // (2) setModel BEFORE any turn — capture throw/hang
    let preSet = "ok";
    try {
      await Promise.race([
        s.setModel(SWITCH),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout-3s")), 3000)),
      ]);
    } catch (e) { preSet = (e as Error).message; }
    console.log("pre-turn setModel('" + SWITCH + "') →", preSet);

    // (3) run one turn; capabilities should now be rich
    let reply = "";
    await s.submit("Reply with exactly the single word OK.", (m: any) => {
      for (const c of m?.message?.content ?? []) if (c?.type === "text") reply += c.text;
    });
    console.log("turn completed; reply(trim) =", JSON.stringify(reply.trim().slice(0, 40)));
    const after = await len(s, "post-turn");

    // (3b) setModel AFTER a turn is the known-good baseline (Increment B verified it)
    let postSet = "ok"; try { await s.setModel(START); } catch (e) { postSet = (e as Error).message; }
    console.log("post-turn setModel('" + START + "') →", postSet);

    console.log("\n--- verdict ---");
    console.log(`models: pre-turn=${before}  post-turn=${after}  → ${before === 0 && after > 0 ? "CONFIRMED empty→rich (curated fallback needed)" : "UNEXPECTED — read raw numbers above"}`);
    console.log(`pre-turn setModel: ${preSet === "ok" ? "ACCEPTED (queues/applies — curated list alone suffices)" : "REJECTED/HUNG → fix must DEFER application: " + preSet}`);
  } catch (e) {
    console.log("PROBE ERROR:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await s.dispose();
  }
})();
