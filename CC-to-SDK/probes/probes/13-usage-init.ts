// Probe 13 — USAGE + INIT INTROSPECTION + applyFlagSettings (P2/P3/P4). Calls the experimental
// /usage Query method (session cost/token totals; rate_limits null for API-key sessions per
// sdk.d.ts:2352), initializationResult() (full handshake payload), and applyFlagSettings()
// (streaming-input-only mid-session settings merge). Mirrors probe 01's call-after-init pattern.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-haiku-4-5-20251001";

// --- Part A (string prompt): usage + initializationResult, called right after init ---
const qa = query({ prompt: "Reply OK.", options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 1 } });
let usage: any;
let init: any;
let rateLimitFrames = 0;
for await (const m of qa) {
  if (m.type === "system" && (m as any).subtype === "rate_limit") rateLimitFrames++;
  if (m.type === "system" && (m as any).subtype === "init") {
    try {
      usage = await (qa as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    } catch (e: any) {
      usage = `ERR ${e.message}`;
    }
    try {
      init = await qa.initializationResult();
    } catch (e: any) {
      init = `ERR ${e.message}`;
    }
  }
  if ("result" in m) break;
}
console.log("=== PROBE 13 usage + init ===  model:", MODEL);
console.log("usage():", brief(usage, 700));
console.log("usage keys:", usage && typeof usage === "object" ? brief(Object.keys(usage)) : "n/a");
console.log("  rate_limits_available:", (usage as any)?.rate_limits_available, "| rate_limits:", brief((usage as any)?.rate_limits, 120));
console.log("initializationResult keys:", init && typeof init === "object" ? brief(Object.keys(init)) : brief(init));
console.log("rate_limit system frames seen in stream:", rateLimitFrames);

// --- Part B (streaming input): applyFlagSettings (only available in streaming input mode) ---
let gate!: () => void;
const g = new Promise<void>((r) => (gate = r));
async function* prompts() {
  yield { type: "user" as const, session_id: "", parent_tool_use_id: null, message: { role: "user" as const, content: "Reply OK." } };
  await g;
}
const qb = query({ prompt: prompts(), options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 1 } });
let flagApplied = "not-called";
for await (const m of qb) {
  if (m.type === "system" && (m as any).subtype === "init") {
    try {
      await (qb as any).applyFlagSettings({});
      flagApplied = "resolved(empty-merge)";
    } catch (e: any) {
      flagApplied = `ERR ${e.message}`;
    }
    gate();
  }
  if ("result" in m) break;
}
console.log("applyFlagSettings({}) [streaming-input]:", flagApplied);

const pass = usage && typeof usage === "object" && !String(usage).startsWith("ERR") && init && typeof init === "object" && !String(init).startsWith("ERR");
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
