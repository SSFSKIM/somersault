// Agent-context predicates and the hook fan-out rule, owned outright
// (§2.4 `pure-helper`). Shared, because five of W5's six dispatchers reach at
// least one of them and transcribing the same three-line rule five times is how
// two copies drift apart silently.
//
// Upstream, at 2.1.251:
//   `Hb`  (chunk-fy12d89p) — the fan-out: which agent ids a hook lookup is
//         performed under. Called by every tool-scoped dispatcher.
//   `DR`  (chunk-fy12d89p) — the built-in WEB-FETCH subagent predicate. `Dc` is
//         the agent type it compares against, and its value is `"web-fetch"`.
//   `ka`  (chunk-bsdtxcdc) — the delegated-observation subagent predicate, which
//         is what makes the Stop dispatcher refuse outright.
//
// All three are total functions of their argument: no I/O, no app state, no
// clock. They have callers all over the engine, so upstream's copies stay live
// after W5 splices six of them — the §2.4 bargain (own the implementation, grade
// it through the surfaces its output flows into) applies cleanly.

/**
 * The agent type `DR` compares against — upstream's `Dc`, one shared string
 * constant in the same chunk.
 *
 * A `primitive` by the taxonomy, but it is not a manifest capture: it is a free
 * variable of `DR`, not of any spliced body, so nothing forwards it and nothing
 * can equality-assert it. What grades it is the parity oracle, which runs
 * upstream's own `DR` bytes against this implementation over the partition.
 */
const WEB_FETCH_AGENT_TYPE = "web-fetch";

/**
 * The events on which a hook lookup fans out to the PARENT agent as well as the
 * acting one — upstream's `Lon`, which is `D_e` plus `"PostToolBatch"`.
 *
 * The membership is behaviour: an event in this set makes a built-in web-fetch
 * subagent's tool hooks visible to the parent session's registry, and an event
 * outside it does not. Written as the union upstream writes it, in upstream's
 * order, so a member that moves is a one-line diff rather than a re-derivation.
 */
const PERMISSION_SCOPED_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"];
const FANOUT_EVENTS = new Set([...PERMISSION_SCOPED_EVENTS, "PostToolBatch"]);

/** Upstream `DR` — the built-in web-fetch subagent, the one agent kind that fans out. */
export function isBuiltInWebFetchSubagent(agentContext) {
  return agentContext.agentType === "subagent" && agentContext.isBuiltIn === true && agentContext.subagentName === WEB_FETCH_AGENT_TYPE;
}

/** Upstream `ka` — a subagent whose observations are delegated, i.e. reported through its parent. */
export function isDelegatedObservationSubagent(agentContext) {
  return agentContext?.agentType === "subagent" && agentContext.delegatedObservation === true;
}

/**
 * Upstream `Hb` — the agent ids a hook lookup runs under, for one event.
 *
 * Normally the acting agent alone. For the built-in web-fetch subagent on a
 * permission-scoped or batch event, the PARENT is added, which is what lets a
 * session-level hook see a tool call the built-in subagent made. Order is
 * behaviour: the acting agent is first, and the registry is consulted in the
 * order returned.
 */
export function hookAgentIds(context, event, sessionId) {
  const agentId = context?.agentId ?? sessionId;
  const agentContext = context?.agentContext;
  if (agentContext !== undefined && isBuiltInWebFetchSubagent(agentContext) && FANOUT_EVENTS.has(event)) {
    return [agentId, agentContext.parentAgentId ?? sessionId];
  }
  return [agentId];
}
