// harness/src/permissions/gate.ts
import type { DecisionKind, DecisionOutcome, PermissionBroker, PermissionRequest } from "./types.js";

// The SDK CanUseTool shape (sdk.d.ts): (toolName, input, options) => Promise<PermissionResult>.
type CanUseToolOptions = { signal: AbortSignal; toolUseID: string; title?: string; displayName?: string; description?: string; [k: string]: unknown };
type PermissionResult = { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string; interrupt?: boolean };
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
    const req: PermissionRequest = { toolName, input, toolUseID: options.toolUseID, kind, title: options.title, displayName: options.displayName, description: options.description, signal: options.signal };
    const d = await requestOrAbort(broker, req, options.signal);
    if (d.kind === "deny") return { behavior: "deny", message: denyMessage(kind, toolName), interrupt: options.signal?.aborted || undefined };
    if (d.kind === "question_answer") return { behavior: "allow", updatedInput: { ...input, answers: d.answers, ...(d.response ? { response: d.response } : {}) } };
    if (d.kind === "plan_reject") return { behavior: "deny", message: d.feedback?.trim() || "User rejected the plan. Continue planning.", interrupt: options.signal?.aborted || undefined };
    if (d.kind === "plan_approve") return { behavior: "allow", updatedInput: input };
    if (d.kind === "allow_always") allowed.add(toolName);
    return { behavior: "allow", updatedInput: input };
  };
}
