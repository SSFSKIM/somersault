// Probe 11c — BUDGET CAPS, detail (credits restored). Two questions left from 11b:
// (1) taskBudget 400s on haiku ("model does not support user-configurable task budgets") —
//     which models DO accept it? (2) how exactly does maxBudgetUsd-exceeded terminate — is any
//     error_max_budget_usd result/frame emitted before the iterator throws, or is it a bare crash?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MULTI = "Run these as separate bash commands one at a time: echo a; echo b; echo c; echo d; echo e. Then write a 2-sentence summary.";

// (1) taskBudget acceptance by model.
async function taskBudgetOn(model: string) {
  let result: any;
  let err: string | undefined;
  try {
    for await (const m of query({ prompt: "Reply OK.", options: { model, permissionMode: "bypassPermissions", maxTurns: 1, taskBudget: { total: 60000 } } })) {
      if ("result" in m) result = m;
    }
  } catch (e: any) {
    err = e.message;
  }
  const text = result?.result ?? "";
  const rejected = /does not support user-configurable task budgets/i.test(text);
  console.log(`[taskBudget @ ${model}] subtype=${result?.subtype} is_error=${result?.is_error} accepted=${!rejected && !result?.is_error} ${rejected ? "REJECTED(400)" : ""}${err ? " throw:" + err : ""}`);
  if (text) console.log("   text:", brief(text, 120));
  return { model, accepted: !rejected && !result?.is_error };
}

console.log("=== PROBE 11c budget detail ===");
console.log("\n-- taskBudget model gating --");
await taskBudgetOn("claude-sonnet-4-6");
await taskBudgetOn("claude-opus-4-8");

// (2) maxBudgetUsd-exceeded termination shape — capture EVERY frame + the throw.
console.log("\n-- maxBudgetUsd:0.02 termination shape --");
const frames: string[] = [];
let lastResult: any;
let threw: string | undefined;
try {
  for await (const m of query({ prompt: MULTI, options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", maxTurns: 10, maxBudgetUsd: 0.02 } })) {
    const tag = m.type === "system" ? `system:${(m as any).subtype}` : "result" in m ? `result:${(m as any).subtype}` : m.type;
    frames.push(tag);
    if ("result" in m) lastResult = m;
  }
} catch (e: any) {
  threw = e.message;
}
console.log("frames seen:", brief(frames, 400));
console.log("any error_max_budget_usd result:", frames.some((f) => f.includes("error_max_budget_usd")), "| lastResult.subtype:", lastResult?.subtype);
console.log("threw:", threw ?? "(no throw)");
