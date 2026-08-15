// appserver/elicitationMap.ts — a settled decision → the MCP result the SDK owes its server.
//
// FAIL-CLOSED IS THE WHOLE POINT. `OnElicitation` returning null sends NO response (sdk.d.ts:1300-1318 —
// null means "the consumer already answered out-of-band", so the SDK skips its own transport write): the
// MCP server is left waiting until it times out, which for a `mode:"url"` auth elicitation means a user
// staring at a browser tab that never resolves. So every outcome maps to a real ElicitResult, and the
// default is `decline` rather than a throw — including the universal system `{kind:"deny"}` that broker
// teardown settles every park with (broker.ts:51/167), which is exactly the path that would otherwise hang
// a server when a thread closes with an elicitation still parked.
import type { DecisionOutcome } from "../permissions/types.js";
import type { ElicitationResult } from "@anthropic-ai/claude-agent-sdk";

export function outcomeToElicitResult(outcome: DecisionOutcome): ElicitationResult {
  switch (outcome.kind) {
    // `content` is omitted rather than sent as undefined: MCP's own ElicitResult treats an absent content
    // as "nothing filled in", and a url-mode accept has nothing to fill in.
    case "elicitation_accept": return { action: "accept", ...(outcome.content ? { content: outcome.content } : {}) };
    case "elicitation_cancel": return { action: "cancel" };
    // decline, deny, and every non-elicitation kind that can reach a park (teardown's system deny above
    // all) share one answer: a well-formed refusal the MCP server can act on immediately.
    default: return { action: "decline" };
  }
}
