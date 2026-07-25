// Probe 55 — Does usage().rate_limits populate under OAuth (subscription) auth?
//
// Prior state: probe 13 ran under API-key auth and saw rate_limits: null, which we recorded in
// coverage.md as "bridge-coupled / null on API-key auth". But sdk.d.ts says rate_limits_available
// is false for "API key, Bedrock, Vertex, or missing profile scope" — which implies plan (OAuth)
// auth SHOULD populate it. The open question is the "missing profile scope" clause: a token minted
// by `claude setup-token` may or may not carry the scope that reaches the claude.ai usage endpoint.
// Only a live run under CLAUDE_CODE_OAUTH_TOKEN settles it.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-haiku-4-5-20251001";

const authMode = process.env.ANTHROPIC_API_KEY
  ? "API_KEY (shadows OAuth — expect rate_limits null)"
  : process.env.CLAUDE_CODE_OAUTH_TOKEN
    ? "OAUTH token"
    : "NONE (will fail)";
console.log("=== PROBE 55 rate_limits under auth ===");
console.log("auth mode:", authMode);

const q = query({ prompt: "Reply OK.", options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 1 } });

let usage: any;
let account: any;
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    try {
      usage = await (q as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    } catch (e: any) {
      usage = `ERR ${e.message}`;
    }
    try {
      account = await q.accountInfo();
    } catch (e: any) {
      account = `ERR ${e.message}`;
    }
  }
  if ("result" in m) break;
}

console.log("accountInfo():", brief(account, 400));
console.log("--- usage() ---");
console.log("  subscription_type    :", (usage as any)?.subscription_type);
console.log("  rate_limits_available:", (usage as any)?.rate_limits_available);
console.log("  rate_limits          :", brief((usage as any)?.rate_limits, 900));
console.log("  session totals       :", brief((usage as any)?.session, 300));

const rl = (usage as any)?.rate_limits;
const available = (usage as any)?.rate_limits_available === true;
const populated = rl && typeof rl === "object" && Object.keys(rl).length > 0;
console.log("");
console.log("VERDICT:", available && populated ? "ALIVE — rate_limits populated under this auth" : available ? "PARTIAL — flag true but payload empty" : "DEAD — rate_limits_available false");
console.log(available && populated ? "RESULT: PASS" : "RESULT: FAIL");
