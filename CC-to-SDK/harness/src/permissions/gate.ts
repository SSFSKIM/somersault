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
 *  the classic 3-way permission.
 *  THE TWO LITERALS ARE THE WHOLE SIGNAL. Probe 97 A3: of the ten fields on a consult's options bag, an
 *  ExitPlanMode call defines four and none of them discriminates, so a rename upstream would silently
 *  demote every plan approval to the generic 3-way dialog with nothing throwing. Pinned in
 *  test/unit/gate-plan-kind.test.ts. */
export function routeDecisionKind(toolName: string): DecisionKind {
  return toolName === "AskUserQuestion" ? "question" : toolName === "ExitPlanMode" ? "plan" : "permission";
}

/** The feedback-less plan rejection, in one place because both arms below reach it. */
const PLAN_REJECTED = "User rejected the plan.";

/** Kind-specific copy for a bare {kind:"deny"} (system teardown, zero-connection rule, broker failure).
 *  Composed HERE because the gate owns the deny message and knows the routing (spec, error-handling §).
 *
 *  WAVE 2 t2 (s2qa3-12). Whatever this returns is read by the MODEL as the human's own words, so the copy
 *  may REPORT but must never INSTRUCT. The plan arm used to end `Continue planning.` — an invented imperative
 *  the model duly obeyed, so a plan rejected in silence produced another round of planning rather than a stop,
 *  and the human was quoted issuing an order they never gave. `message` is required by sdk.d.ts's deny arm
 *  (`PermissionResult`, no optional spelling), so the honest floor is a bare statement of what happened. */
function denyMessage(kind: DecisionKind, toolName: string): string {
  return kind === "question" ? "No user is available to answer."
    : kind === "plan" ? PLAN_REJECTED
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
    // Same rule as `denyMessage`'s plan arm and the same sentence: the human's typed feedback rides verbatim,
    // and its ABSENCE is reported, never filled in with an instruction they did not give (wave 2 t2, s2qa3-12).
    //
    // AND SILENCE ALSO ENDS THE TURN (wave 2 acceptance A4). Not instructing the model to keep planning was
    // only half of it: with nothing stopping the turn the model volunteered its own "what would you like
    // changed?" paragraph, so a human who deliberately said nothing was asked again anyway. Upstream's bare
    // rejection ends there. `interrupt` is the deny arm's own field (sdk.d.ts `PermissionResult`, undocumented
    // there), and probe 106 measured it live: no assistant block follows, the turn settles
    // `result/error_during_execution` (which `turnFailureOf` resolves rather than throws, so no `✗` row), and
    // the session takes the next prompt with its id unchanged.
    //   TWO CONSEQUENCES WORTH KNOWING. The engine REPLACES our `message` on this arm with its own canonical
    // rejection text ("…STOP what you are doing and wait for the user to tell you how to proceed."), so the
    // bare arm now puts no ccx-authored words in the human's mouth at all — `PLAN_REJECTED` survives as the
    // message sdk.d.ts requires and as the copy the non-interrupting paths still show. And the split is the
    // point: a TYPED sentence is a continuation the human asked for, so that arm must not interrupt.
    if (d.kind === "plan_reject") {
      const feedback = d.feedback?.trim();
      return { behavior: "deny", message: feedback || PLAN_REJECTED, interrupt: !feedback || options.signal?.aborted || undefined };
    }
    // `plan` is the DG34 edit: the human opened the plan in $EDITOR from the dialog and the text they saved
    // is what the approve consumes. Upstream REPLACES the whole input with `{plan}` there and sends `{}` when
    // untouched (`lYf` L500722); we merge instead, so a future ExitPlanMode argument we do not know about
    // survives an edit rather than being silently dropped.
    // `d.feedback` is DROPPED HERE ON PURPOSE and this is the honest place to say so: upstream appends it to
    // the tool_result content (L298586-589), a place no permission result can reach, and the allow arm above
    // has no message field. Folding it into `plan` would corrupt the file ExitPlanMode writes from that string
    // (read at L229928, written at L229930); a spare `updatedInput` key is read by nothing. It stays a
    // ccx-local decision record — see permissions/types.ts for who actually gets to see it.
    if (d.kind === "plan_approve") return { behavior: "allow", updatedInput: d.plan !== undefined ? { ...input, plan: d.plan } : input, ...(d.updatedPermissions ? { updatedPermissions: d.updatedPermissions } : {}) };
    // The real "don't ask again": hand the engine's own suggestion back untouched. Deliberately does NOT
    // also add to `allowed` — the rule replaces that in-memory Set rather than shadowing it.
    if (d.kind === "allow_with_updates") return { behavior: "allow", updatedInput: input, updatedPermissions: d.updatedPermissions };
    if (d.kind === "allow_always") allowed.add(toolName);
    return { behavior: "allow", updatedInput: d.kind === "allow_once" && d.updatedInput ? d.updatedInput : input };
  };
}
