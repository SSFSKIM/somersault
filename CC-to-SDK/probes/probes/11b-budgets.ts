// Probe 11b — BUDGET CAPS, isolated. Probe 11 showed maxBudgetUsd:0.00005 crashing before any
// result and taskBudget returning success but the subprocess exiting 1 on teardown. This sweeps
// realistic values and captures the result (which arrives BEFORE any teardown throw) plus
// stop_reason / terminal_reason, to learn the graceful stop shape vs. the hard-crash threshold.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-haiku-4-5-20251001";
const MULTI = "Run these as separate bash commands, one at a time: echo a; echo b; echo c; echo d; echo e. Then write a 2-sentence summary.";

async function runOnce(label: string, options: Record<string, unknown>, prompt: string) {
  let result: any;
  let err: string | undefined;
  try {
    for await (const m of query({
      prompt,
      options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 10, ...options },
    })) {
      if ("result" in m) result = m;
    }
  } catch (e: any) {
    err = e?.message ?? String(e);
  }
  console.log(
    `\n[${label}] subtype=${result?.subtype} is_error=${result?.is_error} stop=${result?.stop_reason} terminal=${result?.terminal_reason} cost=${result?.total_cost_usd}${err ? "  THREW: " + err : ""}`,
  );
  if (result?.result) console.log("   result text:", brief(result.result, 140));
  return { subtype: result?.subtype, err, hadResult: !!result };
}

console.log("=== PROBE 11b budget caps ===  model:", MODEL);

// maxBudgetUsd sweep — find the value that yields a graceful error_max_budget_usd result.
const b1 = await runOnce("maxBudgetUsd:0.003", { maxBudgetUsd: 0.003 }, MULTI);
const b2 = await runOnce("maxBudgetUsd:0.02", { maxBudgetUsd: 0.02 }, MULTI);
const b3 = await runOnce("maxBudgetUsd:1.0 (generous)", { maxBudgetUsd: 1.0 }, MULTI);

// taskBudget — confirm it completes with a normal subtype (model paces itself); note any teardown throw.
const t1 = await runOnce("taskBudget:{total:8000}", { taskBudget: { total: 8000 } }, MULTI);
const t2 = await runOnce("taskBudget:{total:60000}", { taskBudget: { total: 60000 } }, MULTI);

console.log("\n--- VERDICT ---");
console.log("maxBudgetUsd graceful error_max_budget_usd at some value:", [b1, b2].some((b) => b.subtype === "error_max_budget_usd"));
console.log("  0.003:", b1.subtype ?? `(crash: ${b1.err})`, "| 0.02:", b2.subtype ?? `(crash: ${b2.err})`, "| 1.0:", b3.subtype ?? `(crash: ${b3.err})`);
console.log("taskBudget completes with a result (subtype set):", t1.hadResult && t2.hadResult, "| subtypes:", t1.subtype, t2.subtype);
console.log("taskBudget teardown throw present:", !!t1.err || !!t2.err);
