// harness/src/permissions/gate.ts
import type { DecisionKind, DecisionOutcome, PermissionBroker, PermissionRequest, PermissionUpdateLike } from "./types.js";

// The SDK CanUseTool shape (sdk.d.ts): (toolName, input, options) => Promise<PermissionResult>.
// `suggestions`/`blockedPath`/`decisionReason`/`agentID` are the exact key spellings sdk.d.ts declares on
// the options bag (CanUseTool, sdk.d.ts ~L206-266) and probe 78 saw on the live wire; the declared-but-
// never-forwarded trio (suppress_always_allow_rule / decision_reason_type / classifier_approvable) is
// absent by measurement, so we do not pretend to read it.
type CanUseToolOptions = { signal: AbortSignal; toolUseID: string; title?: string; displayName?: string; description?: string; suggestions?: PermissionUpdateLike[]; decisionReason?: string; blockedPath?: string; agentID?: string; [k: string]: unknown };
// sdk.d.ts `PermissionResult`: the allow arm is
//   { behavior:'allow'; updatedInput?: Record<string,unknown>; updatedPermissions?: PermissionUpdate[];
//     toolUseID?: string; decisionClassification?: PermissionDecisionClassification }
// — note there is NO message/feedback field on allow: "here's why, but go ahead" is unreachable, and the
// deny arm's `message` is the only channel back to the model.
type PermissionResult = { behavior: "allow"; updatedInput: Record<string, unknown>; updatedPermissions?: PermissionUpdateLike[] } | { behavior: "deny"; message: string; interrupt?: boolean };
export type CanUseTool = (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;

/** Which dialog a tool call needs. AskUserQuestion is ALWAYS routed (probe 65: it consults canUseTool in
 *  every mode, no ask rules needed); ExitPlanMode arrives under plan mode (probe 66). Everything else is
 *  the classic 3-way permission. */
export function routeDecisionKind(toolName: string): DecisionKind {
  return toolName === "AskUserQuestion" ? "question" : toolName === "ExitPlanMode" ? "plan" : "permission";
}

/** Kind-specific copy for a bare {kind:"deny"} (system teardown, zero-connection rule, broker failure).
 *  Composed HERE because the gate owns the deny message and knows the routing (spec, error-handling §). */
function denyMessage(kind: DecisionKind, toolName: string): string {
  return kind === "question" ? "No user is available to answer."
    : kind === "plan" ? "User rejected the plan. Continue planning."
    : `User denied ${toolName}`;
}

// Resolve the broker, but lose the race to an abort (turn interrupted) → deny. Pre-aborted → deny immediately.
function requestOrAbort(broker: PermissionBroker, req: PermissionRequest, signal: AbortSignal): Promise<DecisionOutcome> {
  if (signal?.aborted) return Promise.resolve({ kind: "deny" });
  return new Promise((resolve) => {
    signal?.addEventListener("abort", () => resolve({ kind: "deny" }), { once: true });
    broker.request(req).then((d) => resolve(d), () => resolve({ kind: "deny" }));
  });
}

/** Build the SDK canUseTool from an interactive broker. Owns the per-session "always" allowlist —
 *  PERMISSION kind only: a question must be asked every time, a plan approved every time. */
export function createPermissionGate(broker: PermissionBroker): CanUseTool {
  const allowed = new Set<string>();
  return async (toolName, input, options) => {
    const kind = routeDecisionKind(toolName);
    if (kind === "permission" && allowed.has(toolName)) return { behavior: "allow", updatedInput: input };
    const req: PermissionRequest = {
      toolName, input, toolUseID: options.toolUseID, kind,
      title: options.title, displayName: options.displayName, description: options.description,
      // Forwarded VERBATIM — a dialog renders `decisionReason`/`blockedPath` and echoes one of
      // `suggestions` straight back as `updatedPermissions` (probe 78: the engine writes the rule, we
      // never construct one).
      suggestions: options.suggestions, decisionReason: options.decisionReason, blockedPath: options.blockedPath, agentID: options.agentID,
      signal: options.signal,
    };
    const d = await requestOrAbort(broker, req, options.signal);
    // The deny arm's `message` is the ONLY channel back to the model (see PermissionResult above), so a
    // human's `feedback` becomes it — "tell Claude what to do differently". Bare deny (teardown, the
    // zero-connection rule, a broker failure) falls back to the kind-specific copy.
    if (d.kind === "deny") return { behavior: "deny", message: d.feedback?.trim() || denyMessage(kind, toolName), interrupt: options.signal?.aborted || undefined };
    if (d.kind === "question_answer") return { behavior: "allow", updatedInput: { ...input, answers: d.answers, ...(d.response ? { response: d.response } : {}) } };
    if (d.kind === "plan_reject") return { behavior: "deny", message: d.feedback?.trim() || "User rejected the plan. Continue planning.", interrupt: options.signal?.aborted || undefined };
    if (d.kind === "plan_approve") return { behavior: "allow", updatedInput: input, ...(d.updatedPermissions ? { updatedPermissions: d.updatedPermissions } : {}) };
    // The real "don't ask again": hand the engine's own suggestion back untouched. Deliberately does NOT
    // also add to `allowed` — the rule replaces that in-memory Set rather than shadowing it.
    if (d.kind === "allow_with_updates") return { behavior: "allow", updatedInput: input, updatedPermissions: d.updatedPermissions };
    if (d.kind === "allow_always") allowed.add(toolName);
    return { behavior: "allow", updatedInput: d.kind === "allow_once" && d.updatedInput ? d.updatedInput : input };
  };
}
