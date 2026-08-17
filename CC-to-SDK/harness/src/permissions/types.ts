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
   *  `updatedInput`/`updatedPermissions`/`toolUseID`/`decisionClassification`, no message field.
   *
   *  `reason` (BL6) is WHY the deny happened, for the gate's copy alone. A bare deny is emitted by four
   *  unrelated events — a human declining a dialog, an interrupt sweep, the zero-connection rule, teardown —
   *  and `denyMessage` could only word one of them, so a human's Esc on a question was reported to the model
   *  as "No user is available to answer.": the opposite of what happened. `"declined"` marks the one event a
   *  present human performed; absent still means the system did it.
   *    A DISCRIMINATOR AND NOT A CANNED `feedback`, deliberately. `feedback` is the human's OWN typed words
   *  wherever it travels — the whole outcome rides `decision_settled.answer` to every other client of the
   *  host (host.ts) and out of the app server's `decision/resolved` fan-out — so parking canon boilerplate in
   *  it would put words in their mouth on any surface that renders "the user said: …". Upstream splits on
   *  exactly this line too: `Dpt` when nothing was typed, `Hft` ("…the user said: <text>") when something
   *  was. Nothing in THIS tree renders deny feedback as user text today (the recent-denials ledger keeps only
   *  `toolName(target)`/`by`/`at`, and the `↳ … denied by …` notice only the kind), so this is the wire that
   *  keeps it that way rather than a repair of a rendering bug. */
  | { kind: "deny"; feedback?: string; reason?: "declined" };

/** Which dialog a parked decision needs (spec Goal B): permission = 3-way, question = AskUserQuestion,
 *  plan = ExitPlanMode. The gate routes by toolName; everything else in the park lifecycle is kind-blind.
 *  `elicitation` (M4) is the one member the gate NEVER produces: an MCP server's request for input arrives
 *  on the SDK's own `onElicitation` callback, not through `canUseTool`, so no toolName maps to it and
 *  `routeDecisionKind`/`denyMessage` deliberately have no branch for it. It joins the vocabulary because
 *  the PARK is the same object — one registry, one `decision/respond`, one teardown. */
export type DecisionKind = "permission" | "question" | "plan" | "elicitation";

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
   *  gate then forwards the engine's own input untouched.
   *  `feedback`: what the approver typed into the keep-planning row before approving anyway — upstream's
   *  `acceptFeedback` (`Inl` L500936), which there becomes a second `{type:"text"}` block appended to the
   *  TOOL RESULT the model reads (L298586-589). THAT DESTINATION IS UNREACHABLE FROM A `canUseTool`: the
   *  allow arm carries no message field and the tool result is built inside the engine. So this field is
   *  ccx-local by construction, with ONE consumer: the app-server's `decision/resolved` fan-out broadcasts
   *  the whole outcome, feedback included, to every subscriber of the thread (server.ts:278). The HOST path
   *  drops it — `decision_settled` carries `outcome.kind` alone (host.ts:701) and `gate.ts` deliberately
   *  does not forward it — so on `ccx`/`ccx attach` nothing shows it. Absent when the row was empty.
   *  PlanDialog.tsx's divergence 3 records the three near-miss channels that were checked and rejected. */
  | { kind: "plan_approve"; mode: PlanGrantMode; updatedPermissions?: PermissionUpdateLike[]; plan?: string; feedback?: string }
  | { kind: "plan_reject"; feedback?: string }
  /** MCP elicitation (M4). Mirrors MCP's own ElicitResult action enum — `content` is only meaningful on
   *  accept, and only for `mode:"form"` requests (an url-mode elicitation has nothing to fill in). The
   *  value type is MCP's, verbatim (`ElicitResultSchema.content`, @modelcontextprotocol/sdk types.d.ts):
   *  widening it here would produce a `content` the server's own schema rejects. `decline` and `cancel`
   *  are BOTH refusals to the MCP server and are kept apart because MCP keeps them apart — decline is
   *  "no", cancel is "the human walked away". `appserver/elicitationMap.ts` turns each into the result
   *  the SDK owes its server. */
  | { kind: "elicitation_accept"; content?: Record<string, string | number | boolean | string[]> }
  | { kind: "elicitation_decline" }
  | { kind: "elicitation_cancel" };

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

// --- the schema-drift guard -------------------------------------------------------------------------
// Three hand-kept zod mirrors of the outcomes above ride three different wires (host/ops.ts,
// daemon/types.ts, appserver/schema/decisions.ts) and all three terminate at the same gate. Zod schemas
// are VALUES, so a field added to a type here and missed in one of them is invisible to the compiler —
// and invisible at runtime too, because zod silently STRIPS the undeclared key. That is not hypothetical:
// BL6's own `reason` discriminator reached a live model as "No user is available to answer." for exactly
// this reason, and only a keyed run found it. Each mirror now states its relation to these types as a type
// alias, so the next omission is a red build instead of a live-only discovery.

/** Type-level EXACT equality. Mutual assignability is not enough: an extra optional property is assignable
 *  in both directions, so `{kind:"deny"; feedback?:string}` and `{…; reason?:"declined"}` would pass it and
 *  the missing field would slip through. This is the standard identity probe — two conditional types are
 *  the same type only when their checked types are identical. */
export type ExactType<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** `type _Guard = AssertType<ExactType<A, B>>` — a type ALIAS, so the check emits nothing and costs nothing
 *  at runtime. When the two drift it fails the build with `Type 'false' does not satisfy the constraint
 *  'true'` on the guard's own line. */
export type AssertType<T extends true> = T;
