// Probe 11 — TURN-LEVEL CONTROLS (P1). The SDK *declares* effort / thinking / maxBudgetUsd /
// taskBudget on Options (sdk.d.ts:1622-1664), but declared != headlessly-effective. This confirms
// each is ACCEPTED in a plain headless query() and observes the two with externally-visible effects:
// maxBudgetUsd must stop the loop with result.subtype 'error_max_budget_usd', and taskBudget (alpha,
// beta header task-budgets-2026-03-13) must not turn the request into an error.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-haiku-4-5-20251001";

async function runOnce(label: string, options: Record<string, unknown>, prompt: string) {
  const messages: any[] = [];
  let result: any;
  let thinking = 0;
  let err: string | undefined;
  try {
    for await (const m of query({
      prompt,
      options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 4, ...options },
    })) {
      messages.push(m);
      if (m.type === "assistant")
        for (const b of (m as any).message?.content ?? [])
          if (b?.type === "thinking" || b?.type === "redacted_thinking") thinking++;
      if ("result" in m) result = m;
    }
  } catch (e: any) {
    err = e?.message ?? String(e);
  }
  console.log(`\n[${label}] subtype=${result?.subtype} thinkingBlocks=${thinking}${err ? "  THREW: " + err : ""}`);
  if (result) console.log(`   cost_usd=${(result as any).total_cost_usd}  result keys=${brief(Object.keys(result))}`);
  return { result, thinking, err };
}

console.log("=== PROBE 11 turn-level controls ===  model:", MODEL);

// 1) effort — minimal reasoning, should just succeed.
const eff = await runOnce("effort:'low'", { effort: "low" }, "Reply with the single word OK.");

// 2) thinking enabled (fixed budget) — accepted; may or may not emit thinking blocks on haiku.
const thEnabled = await runOnce(
  "thinking:enabled(1024)",
  { thinking: { type: "enabled", budgetTokens: 1024 } },
  "Think briefly about 2+2, then reply with the answer.",
);

// 3) thinking adaptive — Opus 4.6+ default; on haiku just confirm accept/err.
const thAdaptive = await runOnce("thinking:adaptive", { thinking: { type: "adaptive" } }, "Reply OK.");

// 4) maxBudgetUsd — set an absurdly tiny ceiling; expect error_max_budget_usd.
const budget = await runOnce(
  "maxBudgetUsd:0.00005",
  { maxBudgetUsd: 0.00005 },
  "Run three separate bash commands: echo a; then echo b; then echo c. Then summarize what you did.",
);

// 5) taskBudget — alpha beta-header path; expect acceptance (normal subtype, not a request error).
const taskB = await runOnce("taskBudget:{total:3000}", { taskBudget: { total: 3000 } }, "Reply OK.");

console.log("\n--- VERDICT ---");
console.log("effort accepted (success):", eff.result?.subtype === "success");
console.log("thinking enabled accepted:", !thEnabled.err, "| emitted thinking blocks:", thEnabled.thinking > 0);
console.log("thinking adaptive accepted:", !thAdaptive.err);
console.log("maxBudgetUsd stops w/ error_max_budget_usd:", budget.result?.subtype === "error_max_budget_usd");
console.log("taskBudget accepted (no request error):", !taskB.err);
