// appserver/elicitationMap.ts — a settled decision → the MCP result the SDK owes its server.
//
// FAIL-CLOSED IS THE WHOLE POINT. `OnElicitation` returning null sends NO response (sdk.d.ts:1300-1318 —
// null means "the consumer already answered out-of-band", so the SDK skips its own transport write): the
// MCP server is left waiting until it times out, which for a `mode:"url"` auth elicitation means a user
// staring at a browser tab that never resolves. So every outcome maps to a real ElicitResult — never null,
// never a throw — including the universal system `{kind:"deny"}` that broker teardown settles every park
// with (broker.ts:51/167), which is exactly the path that would otherwise hang a server when a thread
// closes with an elicitation still parked. WHICH refusal is a separate question from THAT we answer; both
// `decline` and `cancel` are real answers, so the split below cannot break fail-closed either way.
import type { DecisionOutcome } from "../permissions/types.js";
import type { ElicitationResult } from "@anthropic-ai/claude-agent-sdk";

export function outcomeToElicitResult(outcome: DecisionOutcome): ElicitationResult {
  switch (outcome.kind) {
    // `content` is omitted rather than sent as undefined: MCP's own ElicitResult treats an absent content
    // as "nothing filled in", and a url-mode accept has nothing to fill in.
    case "elicitation_accept": return { action: "accept", ...(outcome.content ? { content: outcome.content } : {}) };
    case "elicitation_cancel": return { action: "cancel" };
    // MCP keeps `decline` ("the user explicitly declined") apart from `cancel` ("dismissed without an
    // explicit choice"), and a server may treat the first as definitive and the second as retryable. The
    // universal system deny is teardown, a closed thread, or the unattended-deny path — NOBODY DECLINED
    // ANYTHING there, so `decline` would report a refusal no human gave. `deny` is also a legal client
    // answer here (ANSWER_KINDS.elicitation) and this mapper cannot see the `by:"system"` marker that
    // would tell the two apart, so the tie goes to the asymmetry: claiming a decline nobody made
    // FABRICATES a decision, while calling a generic refusal a dismissal merely understates one — and a
    // client that means decline already has `elicitation_decline`.
    case "deny": return { action: "cancel" };
    // Every remaining kind is a non-elicitation outcome that can still reach this park (a mis-routed
    // answer): a well-formed refusal the MCP server can act on immediately beats a hang.
    default: return { action: "decline" };
  }
}
