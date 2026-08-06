// harness/src/permissions/types.ts

/** One SDK `PermissionUpdate`, carried VERBATIM. sdk.d.ts types it as a discriminated union
 *  (`addRules` | `replaceRules` | `removeRules` | `setMode` | `addDirectories` | `removeDirectories`,
 *  each with a `destination` of `userSettings|projectSettings|localSettings|session|cliArg`), but the
 *  whole point of the wire (probe 78) is that WE NEVER CONSTRUCT ONE: the engine hands the rule to
 *  canUseTool in `options.suggestions`, in exactly the shape `PermissionResult.updatedPermissions`
 *  accepts, and a dialog echoes the chosen one back. Typing it opaquely is deliberate — it keeps every
 *  hop (dialog → wire → gate → SDK) a pass-through and makes reshaping impossible to write by accident,
 *  and it survives the SDK adding a variant we have never heard of. */
export type PermissionUpdateLike = Record<string, unknown>;

export type PermissionDecision =
  /** `updatedInput` (absent = "run it as asked") is the SDK's own edit channel: PermissionResult's allow
   *  arm takes the input the tool will actually run with. A dialog that lets the human tweak the command
   *  before allowing sends it here. */
  | { kind: "allow_once"; updatedInput?: Record<string, unknown> }
  /** "Don't ask again", the REAL one (probe 78/81): echo the engine's own suggestion back and the consult
   *  is silenced — for the session with `destination:"session"`, across relaunch with `"localSettings"`
   *  (which writes `<cwd>/.claude/settings.local.json` in upstream's rule grammar). */
  | { kind: "allow_with_updates"; updatedPermissions: PermissionUpdateLike[] }
  /** Back-compat only: the pre-F6 in-memory, tool-NAME-keyed allowlist that dies with the process. Still
   *  accepted inbound (appserver/broker.ts, daemon/types.ts, older `ccx attach` clients); the F6 dialogs
   *  never emit it. */
  | { kind: "allow_always" }
  /** `feedback` IS the deny message the model sees — upstream's "tell Claude what to do differently"
   *  channel. There is no allow-side equivalent: sdk.d.ts's PermissionResult allow arm carries only
   *  `updatedInput`/`updatedPermissions`/`toolUseID`/`decisionClassification`, no message field. */
  | { kind: "deny"; feedback?: string };

/** Which dialog a parked decision needs (spec Goal B): permission = 3-way, question = AskUserQuestion,
 *  plan = ExitPlanMode. The gate routes by toolName; everything else in the park lifecycle is kind-blind. */
export type DecisionKind = "permission" | "question" | "plan";

/** The permission mode a plan approval GRANTS — the whole payload of an approved ExitPlanMode, and the
 *  one field the appliers (host/host.ts's applyPlanUpgrade, appserver/planUpgrade.ts) read. These four
 *  are exactly the modes `lYf` (L500727-731) maps its option values onto: `yes-accept-edits-keep-context`
 *  → `bypassPermissions` when bypass is available else `acceptEdits`, `yes-resume-auto-mode` → `auto`,
 *  `yes-default-keep-context` (and the empty-plan Yes, L501004) → `default`. It replaces a BOOLEAN
 *  `acceptEdits` (Wave T t10 / qa3-17): the boolean could only say "accept edits or not", so the dialog
 *  had to offer the narrowest label upstream has and grant that whatever the session could actually do. */
export type PlanGrantMode = "default" | "acceptEdits" | "bypassPermissions" | "auto";

/** Everything a human (or system teardown) can answer a parked decision with. The PermissionDecision
 *  family is the `permission` family AND the universal system deny — teardown settles every kind with
 *  {kind:"deny"}, and the gate composes the kind-specific message. */
export type DecisionOutcome =
  | PermissionDecision
  | { kind: "question_answer"; answers: Record<string, string>; response?: string }  // response = free-text "Other" (probe 65E)
  /** `mode`: WHAT THIS APPROVAL GRANTS (see PlanGrantMode) — authoritative, and the only channel the
   *  session upgrade travels on. `updatedPermissions` deliberately stays out of it: upstream sends
   *  `Bnl(mode)` = `[{type:"setMode", …}]` beside the mode, but both appliers already act on this field,
   *  so emitting the rule too would upgrade twice (the no-double-upgrade rule, PlanDialog.tsx).
   *  `updatedPermissions`: approving a plan may also grant the rules the plan needs (Task 9) — same
   *  verbatim echo as allow_with_updates, on the same SDK allow arm.
   *  `plan`: the plan text AS THE HUMAN LEFT IT. Present only when they edited it in `$EDITOR` from the
   *  dialog (F6 T9 / DG34) — upstream's `u = planEditedLocally ? { plan: currentPlan } : {}` (`lYf`
   *  L500722/500737), which rides `updatedInput` on the same allow arm. Absent means "unchanged", and the
   *  gate then forwards the engine's own input untouched. */
  | { kind: "plan_approve"; mode: PlanGrantMode; updatedPermissions?: PermissionUpdateLike[]; plan?: string }
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
  // --- the engine's own suggestion payload (sdk.d.ts CanUseTool options; probe 78 confirmed all four
  // arrive on the live wire). All optional: they are absent whenever the engine has nothing to say.
  /** The rules that would stop this consult recurring — echo one back as `updatedPermissions`. */
  suggestions?: PermissionUpdateLike[];
  /** Why the engine is asking, e.g. "Path is outside allowed working directories" (a STRING; the typed
   *  reason enum the control protocol declares is NOT forwarded — probe 78 A1). */
  decisionReason?: string;
  /** The path that triggered the ask, when one did (e.g. a Bash command reaching outside the cwd). */
  blockedPath?: string;
  /** The sub-agent this tool call is running inside, if any (the SDK's own attribution, distinct from
   *  the host's `parentToolUseID`/`subagentType` correlation map). */
  agentID?: string;
  signal: AbortSignal;
}

export interface PermissionBroker {
  request(req: PermissionRequest): Promise<DecisionOutcome>;
}
