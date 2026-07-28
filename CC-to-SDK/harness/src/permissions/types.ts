// harness/src/permissions/types.ts
export type PermissionDecision =
  | { kind: "allow_once" }
  | { kind: "allow_always" }   // remembered for the session, by tool name
  | { kind: "deny" };

/** Which dialog a parked decision needs (spec Goal B): permission = 3-way, question = AskUserQuestion,
 *  plan = ExitPlanMode. The gate routes by toolName; everything else in the park lifecycle is kind-blind. */
export type DecisionKind = "permission" | "question" | "plan";

/** Everything a human (or system teardown) can answer a parked decision with. The 3-way
 *  PermissionDecision is the `permission` family AND the universal system deny — teardown settles every
 *  kind with {kind:"deny"}, and the gate composes the kind-specific message. */
export type DecisionOutcome =
  | PermissionDecision
  | { kind: "question_answer"; answers: Record<string, string>; response?: string }  // response = free-text "Other" (probe 65E)
  | { kind: "plan_approve"; acceptEdits: boolean }
  | { kind: "plan_reject"; feedback?: string };

/** What the broker is asked to decide. UI hints (title/displayName/description) are often ABSENT headlessly
 *  (the bridge that renders them is claude.ai-coupled) — consumers MUST render from toolName + input alone. */
export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  /** Absent = "permission" (every pre-Goal-B caller). Set by the gate's toolName routing. */
  kind?: DecisionKind;
  /** Subagent attribution, stamped by the host's correlation map (best-effort; absent = unattributed). */
  parentToolUseID?: string;
  subagentType?: string;
  title?: string;
  displayName?: string;
  description?: string;
  signal: AbortSignal;
}

export interface PermissionBroker {
  request(req: PermissionRequest): Promise<DecisionOutcome>;
}
