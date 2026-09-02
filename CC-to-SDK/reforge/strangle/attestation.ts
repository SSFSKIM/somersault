// The attestation manifest — which owned modules are branch-attested, which
// scenarios are replayed to measure them, and the ADJUDICATION for every branch
// the corpus does not execute (campaign spec §3.1).
//
// §3.1's non-vacuity minimum has two halves. The inventory half is machine-made
// (strangle/branches.ts walks the AST and refuses constructs it cannot record).
// This file is the other half: "exclusions listed and reviewed". An unexecuted
// branch with no entry here fails the attestation, so the only way past it is to
// add a scenario or to write down why one is not worth recording.
//
// A reason is not free-form hand-waving. Each one below names what makes the
// branch unreachable *for the corpus* and what grades it instead — because
// "no scenario renders it" and "nothing checks it" are different claims, and
// after C4's retrofit the implementation behind these branches is ours. What
// grades every excluded branch here is `strangle/description-parity.test.ts`,
// which evaluates the PINNED UPSTREAM function with stubbed ports over the full
// branch cross-product and requires byte identity. That is stronger evidence for
// an unrendered branch than a differential red would be for a rendered one.

export interface AttestedModule {
  /** module directory under strangle/modules/ */
  module: string;
  /** the manifest row that splices or replaces it, for the report */
  row: string;
  /** corpus scenarios replayed to measure this module */
  scenarios: string[];
  /**
   * Required when the module's AST-derived inventory is EMPTY — a module with
   * no branches contributes no rows, so listing it would otherwise be an
   * attestation of nothing, module-shaped.
   *
   * `strangle/attest.ts` refuses an empty inventory without one, and prints it
   * in the report, for the same bargain `darkReason` strikes for a chunk export
   * the corpus cannot observe: the reason has to name what grades the module
   * INSTEAD of branch coverage.
   */
  noBranchesReason?: string;
}

export const ATTESTED: AttestedModule[] = [
  // ---- W2: the tool descriptions -------------------------------------------
  { module: "glob-description", row: "glob-description (S-chunk)", scenarios: ["search-tools", "search-tools-lean"] },
  { module: "read-description", row: "read-description", scenarios: ["plain", "api-error"] },
  { module: "grep-description", row: "grep-description", scenarios: ["search-tools", "search-tools-lean"] },
  { module: "webfetch-description", row: "webfetch-description", scenarios: ["plain", "api-error"] },

  // ---- W3: the prompt-assembly pipeline ------------------------------------
  // The scenario sets are the smallest ones that can move each module's
  // branches, not its whole covering list: `plain` for the shape every request
  // has, the two preset recordings for the section machinery, `claude-md-memory`
  // for a two-entry context, `subagent` for the dispatched-agent assembly.
  {
    module: "system-prompt-blocks",
    row: "system-prompt-blocks",
    scenarios: ["plain", "subagent", "sysprompt-preset", "sysprompt-append", "sysprompt-boundary", "claude-md-memory"],
  },
  { module: "system-prompt-wire", row: "system-prompt-wire", scenarios: ["plain", "sysprompt-preset"] },
  { module: "identity-prompt", row: "identity-prompt", scenarios: ["plain", "sysprompt-append"] },
  { module: "context-reminder", row: "context-reminder", scenarios: ["plain", "claude-md-memory"] },
  {
    module: "context-prompt-lines",
    row: "context-prompt-lines",
    scenarios: ["plain", "sysprompt-preset"],
    noBranchesReason:
      "the body is a map, a join and a filter — three calls and no branch-forming construct, so its AST inventory is legitimately empty rather than under-reported " +
      "(`filter(Boolean)` is a call, not a conditional: the predicate's outcomes are data, not arms). " +
      "What grades it is strangle/prompt-parity.test.ts, which runs the pinned upstream body against the owned one over six input partitions " +
      "— empty context, one entry, two entries, falsy blocks, no blocks, and no blocks with one entry — plus the differential surfaces of the two preset scenarios, whose requests carry its `gitStatus:` output.",
  },
  { module: "subagent-prompt", row: "subagent-prompt", scenarios: ["subagent"] },

  // ---- C5x's deferred obligation, closed by the owning wave -----------------
  // C5x shipped three modules and attested none of them, on the reasoning that
  // an exclusion needs an oracle and building one is the owning wave's work.
  // This is the one of the three W3's oracle reaches: the summarization prompt
  // is a constant, so `strangle/prompt-parity.test.ts` grades it in the same run
  // as the rest of the prompt text. The hook dispatcher and the permission link
  // remain C8's and C9's.
  {
    module: "compaction-prompt",
    row: "compaction-prompt",
    scenarios: ["slash-compact"],
    noBranchesReason:
      "the summarization prompt is a top-level constant with no branch-forming construct at all, so branch coverage is not the claim to make about it. " +
      "What grades it is stronger and runs more often: the build compares the owned initializer against the pinned chunk's own bytes on EVERY build " +
      "(strangle/ast.ts `gradeDeclaratorValue`, the variable-declarator shape's whole reason for existing), and " +
      "strangle/prompt-parity.test.ts re-extracts the same constant and compares it again. A differential red could only ever see the prompt a scenario happened to send. " +
      "C7 added a third: strangle/compaction-parity.test.ts extracts the declarator and compares it too, so the claim is checked by something other than the build that makes it.",
  },

  // ---- W4: the compaction surface ------------------------------------------
  // Scenario sets are the smallest ones that can move each module's branches.
  // `slash-compact` compacts and stops; `compact-continue` sends one more
  // exchange, which is what puts the continuation into a request body; and
  // `auto-compact-threshold` is the only recording where the engine DECIDED to
  // compact, so it is the only one that executes the trigger predicate at all.
  {
    module: "compact-boundary",
    row: "compact-boundary",
    scenarios: ["slash-compact", "compact-continue", "auto-compact-threshold"],
  },
  {
    module: "compact-boundary-wire",
    row: "compact-boundary-wire",
    scenarios: ["slash-compact", "compact-continue", "auto-compact-threshold"],
  },
  {
    module: "compact-continuation",
    row: "compact-continuation",
    scenarios: ["slash-compact", "compact-continue", "auto-compact-threshold"],
  },
  {
    module: "auto-compact-trigger",
    row: "auto-compact-trigger",
    scenarios: ["auto-compact-threshold"],
  },

  // ---- W5: the hook dispatchers --------------------------------------------
  // Eleven modules, one per dispatcher. Seven landed with the wave; the last
  // four landed with C8's boundary round, which re-measured the probe the wave's
  // event set rested on and found four live events it had recorded as dead.
  // Scenario sets are the smallest ones that can move each module's branches:
  // `hooks` for the two tool-scoped dispatchers, `hooks-command` for the same
  // PostToolUse record read as a byte stream, `hooks-batch` for the batch guard,
  // `hooks-prompt-submit` for the prompt/display/stop trio, `hooks-subagent` for
  // the subagent arm of the stop dispatcher, and one scenario each for the four
  // firing conditions the wave had never created.
  //
  // What grades every unexecuted arm is `strangle/hooks-parity.test.ts`, and it
  // also grades what no branch inventory here can see: the OWNED SHARED HELPERS.
  // `shared/hook-agent-context.js` (the fan-out rule and its two agent-context
  // predicates) and `shared/assistant-text.js` (the last-assistant-message pair)
  // are not modules in this layout's sense — they have no manifest row and no
  // `reference.js` of their own — so their arms contribute no inventory rows.
  // The oracle enumerates them against upstream's own bytes over the full
  // context x event cross-product before it binds any dispatcher to them, which
  // is the same bargain §2.4 strikes for a pure helper one level up.
  { module: "post-tool-hooks", row: "post-tool-hooks", scenarios: ["hooks", "hooks-command"] },
  { module: "pre-tool-hooks", row: "pre-tool-hooks", scenarios: ["hooks"] },
  { module: "post-tool-batch-hooks", row: "post-tool-batch-hooks", scenarios: ["hooks-batch"] },
  { module: "user-prompt-submit-hooks", row: "user-prompt-submit-hooks", scenarios: ["hooks-prompt-submit"] },
  { module: "stop-hooks", row: "stop-hooks", scenarios: ["hooks-prompt-submit", "hooks-subagent"] },
  { module: "subagent-start-hooks", row: "subagent-start-hooks", scenarios: ["hooks-subagent"] },
  {
    module: "message-display-hooks",
    row: "message-display-hooks",
    scenarios: ["hooks-prompt-submit"],
    noBranchesReason:
      "the body is one object literal and one delegation — no guard, no conditional, no optional chain, because this is the one dispatcher that neither checks a registration nor takes an options bag. " +
      "Its AST inventory is legitimately empty rather than under-reported. " +
      "What grades it is strangle/hooks-parity.test.ts, which runs the pinned upstream body against the owned one over three message shapes (final, non-final delta, empty delta) and compares the EXECUTOR REQUEST as well as the record — " +
      "which is where this dispatcher's distinctive claims live: a synthesised `${messageId}-${index}` correlation id, forced synchronous execution, and suppressed per-invocation telemetry. " +
      "Four mutation controls hold that comparison to it.",
  },

  // ---- C8's boundary round: the four events the wave read as dead -----------
  { module: "post-tool-failure-hooks", row: "post-tool-failure-hooks", scenarios: ["hooks-tool-failure"] },
  { module: "session-start-hooks", row: "session-start-hooks", scenarios: ["hooks-session-start"] },
  { module: "session-end-hooks", row: "session-end-hooks", scenarios: ["hooks-session-end"] },
  { module: "pre-compact-hooks", row: "pre-compact-hooks", scenarios: ["hooks-precompact"] },

  // ---- C8's second round: the nine the registry-derived probe found live ----
  // Each is measured on the ONE recording that creates its firing condition,
  // which is the whole finding restated as corpus. PostCompact rides the
  // compaction recording it shares with PreCompact; the task pair share one.
  { module: "post-compact-hooks", row: "post-compact-hooks", scenarios: ["hooks-precompact"] },
  {
    module: "notification-hooks",
    row: "notification-hooks",
    scenarios: ["hooks-permission"],
    noBranchesReason:
      "the body destructures, builds one record and awaits the executor — no branch-forming construct at all, so its AST inventory is legitimately " +
      "empty rather than under-reported (the two parameter DEFAULTS are applied before the body runs and are not arms). " +
      "What grades it is strangle/hooks-parity.test.ts, which runs the pinned upstream body against the owned one with stubbed ports and compares the yielded sequence, the return value, the hook RECORD and the full port trace — including the executor request, which is where one dispatcher differs from another.",
  },
  {
    module: "permission-request-hooks",
    row: "permission-request-hooks",
    scenarios: ["hooks-permission"],
    noBranchesReason:
      "one log call, one record, one delegation — straight-line, so the inventory is legitimately empty. " +
      "What grades it is strangle/hooks-parity.test.ts, which runs the pinned upstream body against the owned one with stubbed ports and compares the yielded sequence, the return value, the hook RECORD and the full port trace — including the executor request, which is where one dispatcher differs from another.",
  },
  { module: "permission-denied-hooks", row: "permission-denied-hooks", scenarios: ["perm-auto-classifier-deny"] },
  // C9's fix round. Two shape tests over a decisionReason, spliced after the
  // corpus's first `auto` cell showed them live. Their domain is far wider than
  // the corpus's — both answer by finding something no corpus decision carries —
  // so most of their inventory is excluded against the parity oracle, which runs
  // them over the full cross-product of eleven decisionReason kinds.
  { module: "safety-check-reason", row: "safety-check-reason", scenarios: ["perm-auto-classifier-deny"] },
  { module: "ask-rule-reason", row: "ask-rule-reason", scenarios: ["perm-auto-classifier-deny"] },
  { module: "instructions-loaded-hooks", row: "instructions-loaded-hooks", scenarios: ["hooks-memory"] },
  { module: "stop-failure-hooks", row: "stop-failure-hooks", scenarios: ["hooks-stop-failure"] },
  {
    module: "task-created-hooks",
    row: "task-created-hooks",
    scenarios: ["hooks-tasks"],
    noBranchesReason:
      "one record and one delegation — the family's simplest body, and straight-line, so the inventory is legitimately empty. " +
      "What grades it is strangle/hooks-parity.test.ts, which runs the pinned upstream body against the owned one with stubbed ports and compares the yielded sequence, the return value, the hook RECORD and the full port trace — including the executor request, which is where one dispatcher differs from another.",
  },
  {
    module: "task-completed-hooks",
    row: "task-completed-hooks",
    scenarios: ["hooks-tasks"],
    noBranchesReason:
      "its twin's body with one string changed, and straight-line for the same reason. " +
      "What grades it is strangle/hooks-parity.test.ts, which runs the pinned upstream body against the owned one with stubbed ports and compares the yielded sequence, the return value, the hook RECORD and the full port trace — including the executor request, which is where one dispatcher differs from another. The oracle also asserts each twin stamps its OWN event name, which is the only thing that distinguishes them.",
  },
  { module: "user-prompt-expansion-hooks", row: "user-prompt-expansion-hooks", scenarios: ["hooks-slash"] },
  {
    module: "file-changed-hooks",
    row: "file-changed-hooks",
    scenarios: ["hooks-file-watch"],
    noBranchesReason:
      "one record and one call into the watcher-hooks helper — straight-line, so the inventory is legitimately empty. " +
      "What grades it is strangle/hooks-parity.test.ts, which runs the pinned upstream body against the owned one with stubbed ports and compares the yielded sequence, the return value, the hook RECORD and the full port trace — including the executor request, which is where one dispatcher differs from another. The oracle also asserts the helper is called POSITIONALLY with three arguments rather than with a request object, " +
      "which is what makes this row's port a third execution path rather than a differently-named executor.",
  },

  // ---- W6 / C9: the permission subsystem -----------------------------------
  // Measured on the scenarios that MOVE each module's branches rather than on
  // its whole covering list: the pre-check runs on every tool call in every
  // mode, so a handful of shapes reaches far more of it than a long list of
  // repetitions would.
  //
  // The exclusion families here are wider than any previous wave's, and the
  // reason is structural rather than incidental: this subsystem's job is to
  // decide, and a decision that is REACHED and passes leaves the same transcript
  // as one that was never reached. Every excluded arm below names
  // `strangle/permissions-parity.test.ts` and the block inside it that runs the
  // arm — 2,488 comparisons with 45 controls, over the fixture's own six modes,
  // three rule behaviours and eleven decisionReason kinds.
  // The pre-check's list is the LONGEST in the file, deliberately: its ladder has
  // thirteen rungs and each mode reaches a different one, so the scenarios that
  // move its branches are the whole matrix rather than a representative of it.
  // Every scenario named across all attested modules is replayed once, so a long
  // list here is cheap and buys measured coverage instead of adjudicated prose.
  {
    module: "permission-precheck",
    row: "permission-precheck",
    scenarios: [
      "bash-tool", "file-tools", "permission-broker", "permission-bag",
      "perm-accept-edits", "perm-plan-mode", "perm-dont-ask", "perm-rule-deny",
      "perm-rule-allow", "perm-rule-ask", "perm-bypass-deny-rule", "perm-hook-rewrite",
      "perm-hook-deny", "perm-broker-updates", "perm-mode-walk",
      // Not permission scenarios, and named here for exactly that reason: the
      // pre-check runs on EVERY tool call, so the corpus's MCP call and its
      // aborted turn reach rungs no permission fixture can create — the MCP ask
      // ceiling and the abort check at the top of the ladder.
      "mcp-tool", "interrupt",
    ],
  },
  { module: "rule-based-permissions", row: "rule-based-permissions", scenarios: ["perm-hook-rewrite"] },
  { module: "allow-rule-decision", row: "allow-rule-decision", scenarios: ["perm-rule-allow", "bash-tool"] },
  { module: "mode-change-guard", row: "mode-change-guard", scenarios: ["runtime-setters", "perm-mode-walk"] },
  { module: "mode-transition", row: "mode-transition", scenarios: ["runtime-setters", "perm-mode-walk"] },
  { module: "permission-request-hook-decision", row: "permission-request-hook-decision", scenarios: ["permission-broker", "hooks-permission", "perm-hook-deny", "perm-hook-rewrite"] },
  { module: "broker-response-map", row: "broker-response-map", scenarios: ["permission-bag", "perm-broker-updates"] },
  { module: "broker-permission-updates", row: "broker-permission-updates", scenarios: ["permission-bag", "perm-broker-updates"] },
  {
    module: "control-response-success",
    row: "control-response-success",
    scenarios: ["runtime-setters"],
    noBranchesReason:
      "one object literal, three levels deep — no branch-forming construct at all, so its AST inventory is legitimately empty rather than under-reported. " +
      "What grades it is strangle/permissions-parity.test.ts, which builds the envelope from the pinned upstream body over six payload shapes and holds two controls on the NESTING: a request_id lifted to the top level and a payload spread into the response rather than nested under it. Both are wrong in a way that does not error — the SDK matches a response to its request by request_id and by nothing else, so a mis-nested envelope hangs.",
  },
  {
    module: "control-response-error",
    row: "control-response-error",
    scenarios: ["perm-mode-walk"],
    noBranchesReason:
      "the success envelope's twin, and straight-line for the same reason. " +
      "What grades it is strangle/permissions-parity.test.ts, which runs it over the same six payload shapes AND over every refusal the mode-change guard can produce — read out of research/fixtures/permission-surface-<pin>.json, so a guard that gains a refusal upstream widens the case list — plus a control on reusing the success subtype.",
  },

  // ---- W7: the control protocol's named handlers ---------------------------
  // The scenario lists here are shorter than every wave before them and the
  // reason is worth reading rather than assuming: `raw-protocol` is not a corpus
  // scenario, it is the no-wrapper driver, and it is the ONLY thing in the
  // harness that can execute a control handler's answer. `sdk.mjs` consumes
  // control responses, so an SDK-driven scenario cannot render one however many
  // of them there are. `strangle/runners.ts` is what routes the tag here and in
  // the gate's liveness loop, so the two cannot grade a splice through different
  // suites.
  { module: "thinking-config", row: "thinking-config", scenarios: ["raw-protocol"] },
  { module: "permission-mode-setter", row: "permission-mode-setter", scenarios: ["raw-protocol", "runtime-setters"] },
  { module: "model-switch", row: "model-switch", scenarios: ["raw-protocol"] },
  { module: "initialize-payload", row: "initialize-payload", scenarios: ["raw-protocol"] },
  { module: "initialize-handler", row: "initialize-handler", scenarios: ["raw-protocol", "sysprompt-append"] },
];

export interface Exclusion {
  /** `<module>#<function>@<n>:<T|F>` — see strangle/branches.ts for the id's shape */
  branch: string;
  reason: string;
}

/**
 * Reviewed exclusions. Two families, and neither is "we did not get to it":
 *
 *  - **gate-pinned arms.** §3.3 pins the engine's feature-gate state to
 *    "disabled" and X6 forbids adding the env overrides that would flip them, so
 *    the subagent-steer resolver returns "default" on every graded run by
 *    construction. Reaching the other arm would mean changing the gate
 *    environment the whole corpus is graded under.
 *  - **session-state arms.** The PDF-capability read and the WebFetch artifact
 *    carve-out are decided by the session's model and by a capability probe, both
 *    of which are fixed for the corpus's models. A scenario could move the first
 *    (a claude-3-haiku session) but would buy one boolean for a live recording,
 *    and the parity test already grades both sides of it byte for byte.
 */
/**
 * What grades each of C8's second-round dispatchers instead of a rendered
 * branch. Named once rather than restated per exclusion: every entry below is
 * excluded for a DIFFERENT reason, and the sentence that says what covers it
 * instead is the same one each time.
 */
const ORACLE_PC =
  "strangle/hooks-parity.test.ts grades it: the PostCompact block runs eleven cases over every result shape and both guard arms, compares the returned verdict and the full port trace, and holds five controls on them.";
const ORACLE_SF =
  "strangle/hooks-parity.test.ts grades it: the StopFailure block runs ten cases including both refusals, compares the executor request and the port trace, and holds seven controls on them.";
const ORACLE_IL =
  "strangle/hooks-parity.test.ts grades it: the InstructionsLoaded block runs seven cases including an absent options bag, compares the record's field order and the executor request, and holds four controls on them.";
const ORACLE_SHAPES =
  "strangle/permissions-parity.test.ts grades it: both shape tests are run against their own pinned upstream bodies over the full decisionReason cross-product, including nested subcommandResults, several parts, and the recursion's two-term conjunction driven independently.";
const ORACLE_PD =
  "strangle/hooks-parity.test.ts grades it: the PermissionDenied block runs eight cases including the guard's refusal and reasons the call site never passes, compares the record's field order, the executor request and the full port trace, and holds nine controls on them.";
const ORACLE_UPE =
  "strangle/hooks-parity.test.ts grades it: the UserPromptExpansion block runs six cases across both guard keys and the refusal, compares the executor request and the port trace, and holds seven controls on them.";

const ORACLE_PRECHECK =
  "strangle/permissions-parity.test.ts grades it: the pre-check block drives the whole thirteen-rung ladder over the fixture's six modes and three tool shapes, compares the returned decision AND the port trace, and holds controls on the rung ORDER — which is what an unexecuted rung would otherwise be free to change.";
const ORACLE_RULECHECK =
  "strangle/permissions-parity.test.ts grades it: the rule-checker block runs the same cross-product against upstream's own bytes and compares the port trace, which is the only instrument that can separate this function from the pre-check it twins — two ladders that agree on every recorded transcript and differ in which input they read.";
const ORACLE_ALLOWRULE =
  "strangle/permissions-parity.test.ts grades it: the allow-rule block runs the delegation over a tool that allows, one that denies, one that asks and one that throws, on both `crashIsObjection` settings, and compares the value and the trace.";
const ORACLE_STREAK =
  "strangle/permissions-parity.test.ts grades it: the streak block drives all three terms of the conjunction independently and asserts the short-circuit order, which no run that cannot reach the later terms could observe.";
const ORACLE_GUARD =
  "strangle/permissions-parity.test.ts grades it: the guard block runs six modes x four context shapes x the gate, comparing every refusal against the text research/fixtures/permission-surface-<pin>.json reads out of the bundle — so a guard that gains a refusal upstream widens the case list instead of leaving a hole.";
const ORACLE_TRANSITION =
  "strangle/permissions-parity.test.ts grades it: the transition block walks all thirty ordered mode pairs plus the six identity pairs, on both settings of the auto gate, and compares the resulting context field by field.";
const ORACLE_HOOKDEC =
  "strangle/permissions-parity.test.ts grades it: the hook-decision block runs every result shape the PermissionRequest contract allows — allow, deny, rewrite, silence — against both tool capability shapes, and compares the decision and the port trace.";
const ORACLE_BROKERMAP =
  "strangle/permissions-parity.test.ts grades it: the response-mapper block runs every host answer shape including the empty updated input and the interrupting deny, and holds a control on the mutant that spreads the host's answer instead of rebuilding it.";
const ORACLE_BROKERUPD =
  "strangle/permissions-parity.test.ts grades it: the update-filter block runs both context shapes and both tool suppression hooks, compares the surviving update list, and asserts the exemption short-circuits before the tool is consulted.";

const ONECALLER_TEXT =
  "`Gx` has exactly one live headless caller — the re-check the engine runs on a PermissionRequest hook's REWRITTEN input — and every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs.";

/**
 * Why the interaction rungs stay unexecuted — and the exact scope of that
 * claim. It is a fact about THIS corpus's configuration, not a structural
 * impossibility, and it is stated that way deliberately: an earlier wording
 * ("only interactive tools implement `requiresUserInteraction`") asserted a
 * CLOSED population and is refuted by the bundle. The generic MCP tool adapter
 * builds the method straight off a server-declared `_meta` key, so any MCP
 * server may ship a tool that requires interaction. Named once rather than
 * restated per exclusion.
 */
const INTERACTION_TEXT =
  "The corpus configures no MCP servers at all, so the only tools in play are the built-ins — of which the three that implement `requiresUserInteraction` (AskUserQuestion and the plan-mode pair) are interactive surfaces a headless session neither offers nor has the model reach for. That is a claim about this corpus's CONFIGURATION, not a structural impossibility: the generic MCP tool adapter builds `requiresUserInteraction()` from the server-declared `_meta[\"anthropic/requiresUserInteraction\"]` key (cli.pretty.js 30282/30296 and 115317/115331; key table at 818237), so the population is open and a future MCP-carrying scenario would overturn this exclusion.";


// ---- W7 / C10: the control protocol --------------------------------------
// The exclusion families here are narrower in KIND than W6's and wider in
// COUNT, and the difference is worth naming. W6's subsystem was unrecordable by
// construction: a rung that was reached and passed leaves the same transcript as
// one that was never reached. This one is not unrecordable — the raw driver now
// sends ten control requests and reads every answer off the wire — it is
// UNDER-recordable by an order of magnitude. One control request has one shape,
// and these handlers partition into dozens: the model switch alone has nine
// outcome cells, the initialize handler seventeen configuration arms plus a
// whole reconnect half.
//
// So every exclusion below names strangle/control-parity.test.ts and the block
// inside it that runs the arm — 1,536 comparisons with 21 controls, over axes
// taken from research/fixtures/control-protocol-<pin>.json and
// research/fixtures/permission-surface-<pin>.json rather than chosen here.
//
// TWO FAMILIES ARE OUT OF REACH FOR STRUCTURAL REASONS RATHER THAN BUDGETARY
// ONES, and they are called out so nobody re-budgets them as scenarios:
//   - the initialize handler's REINITIALIZE half answers a host RECONNECTING to
//     a session already in flight. Nothing in this harness reconnects, and
//     building something that does would be a session-lifecycle surface of its
//     own rather than a scenario.
//   - the payload's two auto-mode fields appear only on a VS Code entrypoint,
//     which the harness is not and will not become. Their gate is a PORT in the
//     owned module, which is what makes the oracle able to grade both answers.

const W7_THINKING_CONFIG =
  "ONE thinking request per recording, and the resolver partitions on the REQUESTED value \u2014 so a recording reaches exactly one of its four arms and the driver's is `max_thinking_tokens: 2048`. The wire narrows it further, measured rather than assumed: the request builder decides `adaptive` vs `enabled` from the MODEL and discards the budget on an adaptive-capable one, so even a second recording would only ever move the disabled-ness and the display. Graded by strangle/control-parity.test.ts over the full cross-product of five requested budgets (absent, null, zero, one, 2048) x four displays x four configs already in force x both answers of the adaptive gate, with four controls including a resolver that keeps a disabled config's display and one that reads zero as a budget.";

const W7_PERMISSION_MODE_SETTER =
  "the driver's two mode requests are an invalid mode \u2014 refused by the ARM above this function, which never calls it \u2014 and a real change from bypassPermissions to default. So the guard's refusal and the unchanged-mode short circuit are both unreached, and both are the function's substance. Graded by strangle/control-parity.test.ts over every ordered pair of the six modes research/fixtures/permission-surface-<pin>.json enumerates, against three guard outcomes (refuse, accept as asked, accept normalised), with four controls including a setter that transitions on a no-op change and one that returns the caller's string instead of the guard's parsed mode.";

const W7_INITIALIZE_PAYLOAD =
  "the payload's conditional fields are decided by the ENTRYPOINT and the CREDENTIAL, neither of which a harness run can move: two of them appear only on a VS Code entrypoint, the account block is empty under the replay placeholder credential, no model is unavailable, no output style is chosen and no remote-control preference is stored. Both gates are PORTS in the owned module, which is what makes the other answers reachable at all \u2014 the same move that let W6 grade the auto-mode arms. Graded by strangle/control-parity.test.ts over ten payload cells (ordinary, chosen output style, authenticated account, three VS Code cells, four remote-control preference cells) x six permission modes x present/absent unavailable models x the three states of `hooks_applied`, with four controls including a payload that auto-enables remote control against an explicit `false` preference.";

const W7_MODEL_SWITCH =
  "nine outcome cells, and one recording occupies one. The driver sends a non-string model (refused above the normaliser) and `haiku` (allowed), so the unrecognised, blocked, default and stepped-down kinds, the whole system_prompt partition, the hook refusal and the breadcrumb condition's other answers are all unreached \u2014 and every one of them is a distinct sentence or a distinct side effect. Graded by strangle/control-parity.test.ts over six normaliser kinds x four system_prompt shapes x three hook decisions, plus the model argument's own three shapes against both answers of the breadcrumb predicate, plus three states of the active model, plus a kind outside the normaliser's union; five controls, including a switch that accepts an empty system_prompt and one that hands the hook a resolved model where upstream hands it null.";

const W7_INITIALIZE_HANDLER =
  "the handshake this corpus sends is nearly bare: the raw driver sends `{subtype:\"initialize\"}` with no configuration at all, and `sysprompt-append` sends one field. So sixteen of the seventeen configuration arms, the whole agent-selection arm and the entire REINITIALIZE half go unreached \u2014 and the reinitialize half is unreachable by construction rather than by budget, because it answers a host RECONNECTING to a session already in flight and nothing in this harness reconnects. Graded by strangle/control-parity.test.ts over eighteen request shapes x both auth-status answers, twelve agent-selection cells (unresolved, already active, built-in, prompt-donating, empty prompt, inherit model, exempt model, allowed model, restricted model, user-pinned model, initial prompt) and eight reinitialize cells (hooks resent or not x host ownership x pending requests present or not), with four controls including a handler that applies configuration during a reinitialize and one whose answer omits the pending-request fields.";

export const EXCLUSIONS: Exclusion[] = [
  // ---- the subagent-steer arm (Glob, Grep) ---------------------------------
  // `Jk()` resolves in four steps and every one of them is pinned on a graded
  // run: CLAUDE_CODE_THISTLE_GREBE (an env var X6 forbids a child adding),
  // clientData (empty headlessly), the GrowthBook feature (§3.3 pins the gate
  // state to disabled), and a per-model steer floor (unset for the corpus's
  // models). It returns "default" by construction, and latches the first time it
  // is asked, so no scenario can move it without moving the environment the
  // WHOLE corpus is graded under.
  {
    branch: 'glob-description#globDescription@1:F',
    reason:
      "subagentSteer() is pinned to \"default\" by §3.3's disabled-gate environment and X6's env allowlist — its four sources are the forbidden CLAUDE_CODE_THISTLE_GREBE, empty clientData, a disabled GrowthBook flag and an unset model floor. Graded instead by description-parity.test.ts, which compares this arm against upstream byte for byte (glob steer=no_nudges).",
  },
  {
    branch: 'grep-description#grepDescription@1:F',
    reason:
      "same pinned resolver as the Glob arm above; graded by description-parity.test.ts (grep steer=counter_steer).",
  },

  // ---- the PDF-capability arm (Read, both descriptions) --------------------
  // `BVe()` is `!sessionModel().toLowerCase().includes("claude-3-haiku")`, so the
  // false arm needs a claude-3-haiku session. Reachable in principle — one live
  // recording would buy it — but it buys one boolean, and the parity test
  // already grades both sides of it against upstream. Recorded as a deferral
  // rather than as an impossibility, because that is what it is.
  {
    branch: "read-description#readDescription@1:F",
    reason:
      "pdfCapable() is false only for a claude-3-haiku session model, which no scenario uses; a scenario could reach it but would buy one boolean for a live recording. Graded by description-parity.test.ts (read lean=true pdf=false).",
  },
  {
    branch: "read-description#readDescription@2:F",
    reason:
      "same session-model read on the full arm; graded by description-parity.test.ts (read lean=false pdf=false).",
  },

  // ---- the claude.ai artifact carve-out (WebFetch, both descriptions) ------
  // The call site is `webFetchDescription(model, await artifactCarveOut(tools))`,
  // and that predicate requires the Artifact tool to be IN the session's tool
  // list plus two feature gates. The headless catalog (§1.3) has no Artifact
  // tool and §3.3 pins the gates disabled, so it is false on every request the
  // corpus can emit.
  {
    branch: "webfetch-description#webFetchDescription@1:T",
    reason:
      "the artifact carve-out requires the Artifact tool to be present in the session's tool list and its two feature gates enabled; neither holds headlessly under §3.3's pinned gate state. Graded by description-parity.test.ts (webfetch lean=true artifact=true).",
  },
  {
    branch: "webfetch-description#webFetchDescription@2:T",
    reason:
      "same predicate on the full arm; graded by description-parity.test.ts (webfetch lean=false artifact=true).",
  },

  // ==========================================================================
  // W3 — the prompt-assembly pipeline. Four families, and the first is by far
  // the largest single adjudication the campaign has made, so it is worth
  // stating what it rests on rather than repeating a phrase 14 times.
  //
  // FAMILY 1: THE STATIC-PROMPT GATE. `Kde()` is `uw() && jo() && provider is
  // firstParty|anthropicAws`, i.e. two feature gates and a provider test. §3.3
  // pins the gate state to disabled and X6 forbids a child adding the overrides
  // that would flip it, so it is FALSE on every graded run — which makes two of
  // the partition's three paths, and everything nested inside them, unreachable
  // for the corpus by construction rather than by omission.
  //
  // MEASURED, not inferred: the section builder emits the boundary marker only
  // when the same gate is true (`staticPromptEnabled() ? [marker] : []`), and
  // `sysprompt-preset` renders the preset's entire section list with NO marker
  // in the request. That recording is the evidence for every exclusion in this
  // family.
  //
  // What grades them is `strangle/prompt-parity.test.ts`, which evaluates the
  // pinned upstream body with the gate stubbed BOTH ways over eleven input
  // partitions and three option sets, comparing the returned blocks AND the
  // telemetry events — the events matter here, because two of the three paths
  // differ only in which event they emit.
  // ==========================================================================

  // ---- family 1: paths behind the static-prompt gate -----------------------
  {
    branch: "system-prompt-blocks#systemPromptBlocks@0:T",
    reason:
      "the tool-based-cache path requires staticPromptEnabled(), pinned false by §3.3's disabled-gate environment (measured: sysprompt-preset renders the full section list with no boundary marker, which only happens on the gate's empty arm). Graded by prompt-parity.test.ts (partition static=true, all inputs x all option sets, output and telemetry).",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@1:T",
    reason: "the left conjunct of the same guard; false whenever the gate is, so it cannot be reached separately. Same oracle.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@2:T",
    reason: "the gate read itself, pinned false. Same oracle.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@3:T",
    reason:
      "`options?.` is short-circuited away by the pinned-false gate to its left, so NEITHER arm of the optional chain is evaluated on a graded run — which is why both appear here rather than only one. Same oracle.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@3:F",
    reason: "the other arm of the same short-circuited optional chain. Same oracle.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@4:T",
    reason: "the `rest` push inside the tool-based-cache path; unreachable because the path is. Same oracle.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@4:F",
    reason: "the other arm of the same push, inside the same unreachable path. Same oracle.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@5:T",
    reason: "the second gate read, guarding the boundary path and its telemetry. Pinned false. Same oracle.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@6:T",
    reason:
      "the boundary path. Reaching it needs the gate AND a caller-supplied marker; `sysprompt-boundary` supplies the marker, which is why the marker's REMOVAL is executed coverage, but the gate is what gates the split. Graded by prompt-parity.test.ts (static=true, 'full, with marker' and 'marker first' and 'marker only').",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@6:F",
    reason: "the missing-marker telemetry arm, inside the same gated block. Same oracle, and its EVENT is compared, not just its output.",
  },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@7:T",
    reason: "the globally-scoped static block, emitted only on the boundary path. Same oracle.",
  },
  { branch: "system-prompt-blocks#systemPromptBlocks@7:F", reason: "the other arm of the same push. Same oracle." },
  {
    branch: "system-prompt-blocks#systemPromptBlocks@8:T",
    reason: "the dynamic block after the marker, emitted only on the boundary path. Same oracle.",
  },
  { branch: "system-prompt-blocks#systemPromptBlocks@8:F", reason: "the other arm of the same push. Same oracle." },
  {
    branch: "system-prompt-blocks#partition@6:F",
    reason:
      "the split test `boundaryAt < 0 || i < boundaryAt` is false only when a marker's index is known, which only the boundary path passes. Same gate, same oracle.",
  },
  {
    branch: "system-prompt-blocks#partition@7:F",
    reason: "the left disjunct of the same test; false only for a known marker index. Same oracle.",
  },

  // ---- family 2: block kinds the corpus's assembler never produces ---------
  // These are not gated; they are facts about the ONE call site. The assembler
  // builds the list as `[billingHeader, identity, reportingOutcomes, ...sections]`
  // and then filters falsies, so billing and identity are always present, and
  // `reportingOutcomes` is `Voe(header, model)` — the empty string unless a
  // provider-and-gate predicate holds, which it does not here.
  // (`partition@1:T` — the skip arm — is NOT here: `sysprompt-boundary` renders
  // it, which is the branch that scenario was recorded to buy.)
  {
    branch: "system-prompt-blocks#partition@2:T",
    reason:
      "the falsy-block arm. Upstream applies `.filter(Boolean)` TWICE before this function is reached — once in the assembler's own list construction and once in the context tail (`context-prompt-lines`) — so a falsy block cannot survive to the partition on any call path. Graded by prompt-parity.test.ts ('falsy entries', which passes an empty string and a null through both bodies).",
  },
  {
    branch: "system-prompt-blocks#partition@5:T",
    reason:
      "the reporting-outcomes block. The assembler contributes it as `Voe(billingHeader, model)`, which returns the empty string unless a provider-and-gate predicate holds; it does not on a graded run, so no request carries the section (measured: '# Reporting outcomes' appears in no recorded system array, including the preset's 27 KB block). Graded by prompt-parity.test.ts ('full, no marker', 'outcomes without identity', 'outcomes without billing').",
  },
  {
    branch: "system-prompt-blocks#head@0:F",
    reason:
      "the billing header is the assembler's first list element on every request and is never falsy, so its absence arm is unreachable. Graded by prompt-parity.test.ts ('outcomes without billing', 'sections only').",
  },
  {
    branch: "system-prompt-blocks#head@1:F",
    reason:
      "the identity sentence is the assembler's second element and the selector always returns one of three non-empty strings, so its absence arm is unreachable. Graded by prompt-parity.test.ts ('outcomes without identity', 'sections only').",
  },
  {
    branch: "system-prompt-blocks#head@2:T",
    reason: "the outcomes push, which needs the block family 2 explains is never present. Same oracle.",
  },
  { branch: "system-prompt-blocks#head@3:T", reason: "a conjunct of the same push. Same oracle." },
  { branch: "system-prompt-blocks#head@4:T", reason: "a conjunct of the same push. Same oracle." },

  // ---- family 3: the wire's caller-fixed arguments -------------------------
  {
    branch: "system-prompt-wire#systemPromptTextBlocks@0:T",
    reason:
      "the nullish arm of `options?.skipGlobalCacheForSystemPrompt`. The single call site always passes an object literal (`{skipGlobalCacheForSystemPrompt, cacheTtl}`), so `options` is never nullish on a graded run. Graded by prompt-parity.test.ts ('opts=undefined' against both engines).",
  },
  {
    branch: "system-prompt-wire#systemPromptTextBlocks@3:T",
    reason: "the nullish arm of `options?.cacheTtl` at the same call site, for the same reason. Same oracle.",
  },
  {
    branch: "system-prompt-wire#systemPromptTextBlocks@2:F",
    reason:
      "prompt caching disabled. The caller resolves it from the session's caching policy and it is on for every recorded run; a scenario could only move it by changing that policy for the whole corpus. Graded by prompt-parity.test.ts (caching=false against all three option sets), which is the arm where NO cache_control is attached at all.",
  },

  // ---- family 4: seam-fixed session facts ---------------------------------
  {
    branch: "identity-prompt#identityPrompt@0:T",
    reason:
      "the Vertex arm. The harness drives every engine through its own first-party proxy base URL (§3.3), so the provider read cannot return \"vertex\" without changing the environment the whole corpus is graded under. Graded by prompt-parity.test.ts (provider=vertex x all five session shapes).",
  },
  {
    branch: "identity-prompt#identityPrompt@1:F",
    reason:
      "the interactive arm. Every reforge run is a headless SDK session, so `isNonInteractive` is true by construction of the seam being graded. Graded by prompt-parity.test.ts (session=interactive and interactive+append, on all three providers).",
  },
  {
    branch: "identity-prompt#identityPrompt@2:T",
    reason:
      "the nullish arm of `session?.`. The single call site always passes an object literal built from the session's own flags. Graded by prompt-parity.test.ts (session=undefined, on all three providers).",
  },
  {
    branch: "context-reminder#contextReminderMessages@0:T",
    reason:
      "the empty-context arm. `currentDate` is contributed unconditionally by the context builder, so the map is never empty on a graded run — measured across every cassette, whose first user message always carries at least `# currentDate`. Graded by prompt-parity.test.ts ('empty'), which asserts the message list is returned untouched.",
  },
  {
    branch: "subagent-prompt#subagentPrompt@0:T",
    reason:
      "the null env-paragraph arm. The environment section is built from the working directory and the model registry and returns a string on every graded run (measured: the 4,477-character agent prompt in the `subagent` cassette carries it). Graded by prompt-parity.test.ts ('env null' and 'both null', over three section counts).",
  },
  {
    branch: "subagent-prompt#subagentPrompt@1:T",
    reason:
      "the null token-attachment arm. It is null only when an attachment kill-switch env var is set or the attachment mode is \"off\"; X6 forbids the first and the corpus's mode is not the second (measured: the `subagent` prompt ends with a `<total_tokens>` line). Graded by prompt-parity.test.ts ('tokens null' and 'both null').",
  },

  // ==========================================================================
  // W4 — the compaction surface. Everything below is graded by
  // `strangle/compaction-parity.test.ts`, which evaluates the pinned upstream
  // bodies with stubbed ports over 94 comparisons and 27 mutation controls, and
  // which compares the trigger predicate's PORT TRACE as well as its answer —
  // two of its refusals differ from each other in nothing else.
  //
  // Three families, and only one of them is "the corpus happens not to":
  //
  //   1. FIELDS THE DRIVERS ALWAYS FILL. The boundary's metadata is written by
  //      the compaction drivers before the SDK maps it, so the optional fields
  //      they always set have no absence arm on any recording.
  //   2. THE SEGMENT-COMPACTION PATH. Three arms are reachable only through
  //      upstream's from/up_to variant, and W7.5 MEASURED what that means:
  //      the producer is `E4n` (not `hRt`, which is only that path's prompt
  //      builder), it is called from exactly one place, and that place is a
  //      method on the interactive session controller behind a mounted Ink
  //      dialog and a double-Escape keypress. No SDK option, control subtype,
  //      slash command, hook or tool reaches it. So these are not a coverage
  //      debt waiting for a scenario — they are seam-unreachable, and the
  //      variant routes to C16/W13 with the other compaction drivers.
  //      Evidence: research/2026-09-02-w75-segment-compaction-reachability.md.
  //   3. SEAM-FIXED FACTS. The headless query source is always "sdk",
  //      auto-compaction is on, the surface is open and the window is
  //      model-default, so every refusal in the trigger predicate is
  //      unreachable by construction of the seam being graded.
  // ==========================================================================

  // ---- family 1: what the drivers always fill ------------------------------
  {
    branch: "compact-boundary#compactBoundary@0:F",
    reason:
      "the absent-parent arm. All three upstream call sites pass `messages.at(-1)?.uuid`, and a compaction with no messages cannot occur — the compactor refuses a conversation of fewer than two groups before it reaches the constructor. Graded by compaction-parity.test.ts, which runs the arm against FOUR falsy values (undefined, null, empty string, false), because the spread is `...parent && {…}` and a rewrite testing `!== undefined` would pass on three of them.",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@0:F",
    reason:
      "`post_tokens` absent. The drivers set `postTokens` on the boundary before the SDK maps it, on every successful compaction. Graded by compaction-parity.test.ts ('minimal'), and the zero case is graded separately ('zeros are measurements, not absences') because a truthiness rewrite would drop a real zero.",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@1:F",
    reason: "`cumulative_dropped_tokens` absent; same driver-filled field, same oracle.",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@2:F",
    reason: "`duration_ms` absent; the drivers stamp it immediately after constructing the boundary. Same oracle.",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@7:F",
    reason: "no `preserved_segment`. Every compaction the corpus records preserves a segment. Graded by compaction-parity.test.ts ('minimal', 'preserved messages but no segment').",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@8:F",
    reason: "no `preserved_messages`; same, and graded by ('minimal', 'a segment but no preserved messages').",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@9:F",
    reason: "`all_uuids` absent. Upstream populates it alongside `uuids` on the paths the corpus drives. Graded by compaction-parity.test.ts ('preserved messages without allUuids').",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@5:T",
    reason:
      "`precomputed` present. The flag is stamped only when a PRECOMPUTED compaction swap was available (`fe.compactMetadata.precomputed = !0` behind the driver's `A`), which needs the background precompute path — feature-gated, and dark under §3.3's pinned gate state. Graded by compaction-parity.test.ts ('everything').",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@6:T",
    reason:
      "`pre_compact_discovered_tools` present. Upstream's collector walks the conversation for `tool_search_tool_result` blocks — SERVER-SIDE DYNAMIC TOOL LOADING, not ordinary tool use — and adds the tool names it finds; the set is empty unless the model was served such a block, which the headless corpus never is. Graded by compaction-parity.test.ts ('everything', 'an empty discovered-tool list').",
  },

  // ---- family 2: the segment-compaction path (a deferral) ------------------
  {
    branch: "compact-boundary-wire#compactBoundaryWire@3:T",
    reason:
      "`user_context` present. MEASURED at the call sites: of upstream's three, the two the corpus drives call the constructor with THREE arguments, so `userContext` is undefined even for `/compact <instructions>` — only the from/up_to SEGMENT variant passes it (five arguments, the fourth being the free text a human typed into the rewind dialog's context box). W7.5 then measured the variant's REACHABILITY and it is not a scenario question: the producer `E4n` has one caller, a method on the interactive session controller that throws unless a terminal host is bound, behind an Ink dialog opened by a double-Escape keypress. No SDK option, control subtype, slash command, hook or tool reaches it. Graded by compaction-parity.test.ts ('everything').",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@4:T",
    reason: "`messages_summarized` present; the same five-argument segment call site (the fifth argument is the size of the summarized slice), the same seam-unreachability, the same oracle.",
  },
  {
    branch: "compact-continuation#compactContinuation@6:F",
    reason:
      "follow-up questions NOT suppressed. Two of the three upstream call sites pass `true` and the third passes a variable that is literal `true` at both of ITS call sites; the only literal `false` is the segment variant's, which is seam-unreachable for the reason above. Graded by compaction-parity.test.ts, which drives all nine option sets and specifically controls the early return ('the suppress arm falling through instead of returning').",
  },

  // ---- family 3: seam-fixed facts ------------------------------------------
  {
    branch: "compact-continuation#compactSummaryText@1:F",
    reason:
      "the empty-capture arm of `summary[1] || \"\"`. It needs a `<summary></summary>` block with nothing between the tags; the model writes a body every time it writes the tags. Graded by compaction-parity.test.ts ('empty summary', 'whitespace-only summary').",
  },
  {
    branch: "compact-continuation#compactContinuation@0:F",
    reason:
      "no transcript path. Every upstream call site passes the session's own transcript path, and a headless session always has one. Graded by compaction-parity.test.ts ('opts=undefined', 'empty opts', 'every flag explicitly false').",
  },
  {
    branch: "compact-continuation#compactContinuation@1:T",
    reason:
      "the nullish arm of `options?.transcriptPath`. All three call sites pass an object literal, so `options` is never nullish on a graded run — which is why all four of this module's optional-chain arms appear here rather than one. Graded by compaction-parity.test.ts ('opts=undefined').",
  },
  { branch: "compact-continuation#compactContinuation@3:T", reason: "the nullish arm of `options?.recentMessagesPreserved`, same call sites, same oracle." },
  { branch: "compact-continuation#compactContinuation@5:T", reason: "the nullish arm of `options?.replStateCleared`, same call sites, same oracle." },
  { branch: "compact-continuation#compactContinuation@7:T", reason: "the nullish arm of `options?.suppressFollowUpQuestions`, same call sites, same oracle." },
  {
    branch: "compact-continuation#compactContinuation@2:T",
    reason:
      "the recent-messages clause. MEASURED: NO call site in the pinned bundle passes `recentMessagesPreserved` at all — the three that build this message pass only `suppressFollowUpQuestions`, `transcriptPath` and `replStateCleared`. It is upstream's own dead option, kept because owning the function means owning its shape. Graded by compaction-parity.test.ts ('recent only', 'everything').",
  },
  {
    branch: "compact-continuation#compactContinuation@4:T",
    reason:
      "the REPL clause. Gated on `ty()`, the same interactive-entrypoint test that makes the REPL tool dark for the whole corpus (W2's `glob-description` REPL exclusion): it requires `CLAUDE_CODE_ENTRYPOINT` to be \"cli\" or \"remote\", and X6 pins it to \"sdk-cli\". Graded by compaction-parity.test.ts ('repl only', 'everything').",
  },
  {
    branch: "auto-compact-trigger#isSuppressedQuerySource@0:F",
    reason:
      "the `querySource !== undefined` guard's false arm. The headless main loop always names its source (\"sdk\"), so an unnamed one cannot occur — and the guard matters anyway, because an unnamed source must be treated as a REAL turn rather than suppressed. Graded by compaction-parity.test.ts ('an unnamed source is a real turn'), which compares the port trace as well as the answer.",
  },
  {
    branch: "auto-compact-trigger#autoCompactTrigger@1:T",
    reason:
      "the non-conversational-source refusal. It fires for \"prompt_suggestion\", \"away_summary\", \"agent_summary\" and \"narration\"; the headless seam sends \"sdk\" on every turn, so no recording can reach it. Graded by compaction-parity.test.ts, which value-compares the owned source list against the pinned chunk's own `AZt`, compares the owned `tC` against upstream's extracted bytes over a twelve-source cross-product, and then drives all four sources through upstream's body bound to UPSTREAM's helpers — answer and full port trace both. This refusal calls no port at all, so the source cross-product, not the trace, is what grades it.",
  },
  {
    branch: "auto-compact-trigger#autoCompactTrigger@2:T",
    reason:
      "auto-compaction switched off. The setting defaults to true and `settingSources: []` leaves it there; the two kill-switch env vars (DISABLE_COMPACT, DISABLE_AUTO_COMPACT) are outside X6's allowlist. Graded by compaction-parity.test.ts ('auto-compaction switched off').",
  },
  {
    branch: "auto-compact-trigger#autoCompactTrigger@4:F",
    reason:
      "the left conjunct's false arm — the compaction surface CLOSED. That happens only under `CLAUDE_CODE_REMOTE` with a closed circuit, which no reforge run has. Graded by compaction-parity.test.ts ('surface CLOSED, window unconfigured — the conjunct's other arm'), which is the case where an unconfigured window must NOT refuse.",
  },

  // ==========================================================================
  // W5 — the hook dispatchers. Five families, and the first two account for
  // thirty of the forty.
  //
  // FAMILY 1: THE MANAGED-HOOKS OPTIONS BAG. Every dispatcher takes an optional
  // options object carrying `managedHooksOnly` / `managedHooksExcluded`, and the
  // headless seam passes none — so each `options?.…` chain resolves the same way
  // on every recording. The oracle supplies the bag in all three states.
  //
  // FAMILY 2: THE FUNCTION-HOOK CHAIN. The PreToolUse dispatcher's second
  // execution path is armed by an in-process module handler or a managed pass,
  // neither of which exists on the SDK seam. It is fifteen branch outcomes plus
  // the four of the plain-object test the corpus never even calls, and it is the
  // largest single family this wave adjudicates.
  //
  // FAMILY 3: A REGISTRATION REFUSAL IS UNRECORDABLE BY CONSTRUCTION. A run with
  // no hook registered for an event produces no consult, no record and no
  // observable — so "the guard refused" and "the dispatcher was never called"
  // are the same recording. This is the one exclusion family in the campaign so
  // far whose reason is not "the corpus does not do that" but "no corpus could".
  //
  // FAMILY 4: THE STOP DISPATCHER'S GUARD MATRIX — two agent kinds the headless
  // Agent tool cannot produce, two of three turn-end phases, and four shapes of
  // the derived `last_assistant_message`.
  //
  // FAMILY 5: a prompt submitted inside a subagent context.
  //
  // What grades every one of them is strangle/hooks-parity.test.ts: 371
  // comparisons of upstream's own bytes against the owned modules, each
  // comparing the yielded sequence, the return value, the hook RECORD and the
  // full port trace, held non-vacuous by 36 mutation controls. Demonstrated red:
  // swapping `tool_use_id` and `duration_ms` in the PostToolUse record fails
  // five of those comparisons.
  {
    branch: "post-tool-hooks#postToolHooks@0:T",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "post-tool-hooks#postToolHooks@1:T",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@2:F",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@3:F",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@7:F",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@8:F",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@13:F",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "pre-tool-hooks#runSettingsHooks@3:F",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "user-prompt-submit-hooks#userPromptSubmitHooks@2:F",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "subagent-start-hooks#subagentStartHooks@0:T",
    reason:
      "the managed-hooks OPTIONS BAG is never supplied on the headless seam: no dispatcher call the SDK drives passes `options`, so every `options?.…` chain resolves the same way on every recorded run. `managedHooksOnly`/`managedHooksExcluded` are the enterprise/plugin managed-hook path. Graded by strangle/hooks-parity.test.ts, which runs each dispatcher with the bag absent, with `managedHooksOnly`, and with `managedHooksExcluded`, and compares the EXECUTOR REQUEST the option ends up in.",
  },
  {
    branch: "pre-tool-hooks#isPlainObject@0:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. The plain-object test is reached only once the chain is armed, so the corpus never calls it at all.",
  },
  {
    branch: "pre-tool-hooks#isPlainObject@0:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. The plain-object test is reached only once the chain is armed, so the corpus never calls it at all.",
  },
  {
    branch: "pre-tool-hooks#isPlainObject@1:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. The plain-object test is reached only once the chain is armed, so the corpus never calls it at all.",
  },
  {
    branch: "pre-tool-hooks#isPlainObject@1:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. The plain-object test is reached only once the chain is armed, so the corpus never calls it at all.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@0:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@1:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@4:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. This arm needs a managed pass to be present on the tool-use context.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@5:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@6:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@9:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@11:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@12:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@14:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@15:iterated",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@16:T",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. The signal fallback is evaluated only on the chain path.",
  },
  {
    branch: "pre-tool-hooks#preToolHooks@16:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. The signal fallback is evaluated only on the chain path.",
  },
  {
    branch: "pre-tool-hooks#runSettingsHooks@0:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. A REWRITTEN tool input reaches the closure only from the chain.",
  },
  {
    branch: "pre-tool-hooks#runSettingsHooks@1:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. A per-call managed-hook override reaches the closure only from the chain.",
  },
  {
    branch: "pre-tool-hooks#runSettingsHooks@2:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. A per-call option object reaches the closure only from the chain.",
  },
  {
    branch: "pre-tool-hooks#runSettingsHooks@4:F",
    reason:
      "the PreToolUse function-hook CHAIN is unreachable through the SDK seam: it is armed only by an in-process module handler (`hasModuleHandlers`, an engine-internal registry the headless driver registers nothing in) or by a managed pass recorded for the same tool_use id and the same input. The corpus therefore renders the settings path on every tool call and never this one. Graded by strangle/hooks-parity.test.ts, whose PreToolUse block drives the chain through both arming conditions, an array and a null tool input, an empty chain, and the closure the chain calls back into with a rewritten input and per-call options — comparing upstream's yields, its return and its full port trace, with four mutation controls on the chain path alone. A per-call option object reaches the closure only from the chain.",
  },
  {
    branch: "post-tool-batch-hooks#postToolBatchHooks@0:T",
    reason:
      "the REFUSAL arm of a registration guard cannot be rendered by a scenario, and that is a property of the guard rather than of the corpus: a run with no PostToolBatch hook registered produces no hook consult, no record and no observable of any kind, so the refusal and 'the dispatcher was never called' are the same recording. It is nevertheless the common case in production. Graded by strangle/hooks-parity.test.ts, which runs the batch dispatcher registered and unregistered and compares the port trace, plus a control that fails if an unregistered batch still reached the executor.",
  },
  {
    branch: "user-prompt-submit-hooks#userPromptSubmitHooks@0:F",
    reason:
      "a prompt submitted INSIDE a subagent context: the headless driver submits user prompts on the main session only, so `context.agentId` is undefined on every recording and the lookup falls back to the session id. Graded by strangle/hooks-parity.test.ts, whose prompt-submit block includes an agent-scoped context and compares which id the registration guard was consulted under.",
  },
  {
    branch: "stop-hooks#stopHooks@1:T",
    reason:
      "a DELEGATED-OBSERVATION subagent, which reports through its parent and therefore dispatches no turn-end hooks. The headless Agent tool dispatches ordinary subagents; nothing in the corpus creates a delegated-observation one. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },
  {
    branch: "stop-hooks#stopHooks@4:F",
    reason:
      "the BUILT-IN WEB-FETCH subagent, the one agent kind that skips the registration guard and runs the executor in managed-hooks-only mode. It is dispatched by the engine's own web-fetch path, not by a tool a scenario can call. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },
  {
    branch: "stop-hooks#stopHooks@7:F",
    reason:
      "the `turn_end_reactions` phase with NO function hook registered for the event — a second guard behind a phase the SDK seam does not drive. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },
  {
    branch: "stop-hooks#stopHooks@8:F",
    reason:
      "a stop dispatched with NO message list at all. Every corpus turn ends with messages, so the arm that skips the last-assistant-message derivation entirely is unrendered. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },
  {
    branch: "stop-hooks#stopHooks@9:F",
    reason:
      "a message list with no assistant message in it — an arm reachable only when a turn ends before the model replied. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },
  {
    branch: "stop-hooks#stopHooks@10:F",
    reason:
      "an assistant message whose text is EMPTY once joined and trimmed, which upstream turns into `undefined` rather than \"\" so the field is omitted from the record. A turn that ended on a tool call with no prose would reach it; the corpus's do not. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },
  {
    branch: "stop-hooks#stopHooks@12:T",
    reason:
      "a SubagentStop for an agent with no declared type, which upstream stamps as the empty string. The Agent tool always supplies a subagent_type. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },
  {
    branch: "stop-hooks#stopHooks@13:F",
    reason:
      "the turn-end phase argument: the headless driver dispatches one phase on every recording, so the two others — and the `skipSessionFunctionHooks`/`sessionFunctionHooksOnly` options they select — are unrendered. strangle/hooks-parity.test.ts grades it: the stop block runs thirteen cases across both arms of the dispatcher and compares upstream's record, its executor options and its port trace, with seven mutation controls.",
  },

  // ==========================================================================
  // C8's boundary round — the four dispatchers the wave had read as dead.
  //
  // Each of these scenarios was written to CREATE its dispatcher's firing
  // condition, which is the finding the round exists for, and two of them were
  // re-recorded once the first attestation showed which arms a callback alone
  // could not move: `hooks-precompact` now registers three command hooks, one
  // per result shape a hook PROCESS can produce, and `hooks-session-end`
  // registers a failing one so the drain's reporting arm renders. What is
  // excluded below is what is left after that, and each entry says which of the
  // two kinds it is — genuinely unproducible on this seam, or producible by a
  // scenario that would then be grading something else.
  // ==========================================================================

  // The PostToolUseFailure refusal arm USED to be excluded here as "unrecordable
  // by construction". C8's second round retired that exclusion by accident and
  // the lesson is worth keeping: the arm needs a run that makes a tool call
  // WITHOUT registering a PostToolUseFailure hook, and every scenario in the
  // corpus that made tool calls had registered one, so the arm looked like a
  // property of the seam when it was a property of the corpus's habits. The
  // round's new recordings register hooks for other events and use tools, and
  // the arm now executes. An exclusion is a claim about reachability, and a
  // claim about reachability is only as good as the population it was made over.

  // ---- SessionStart: the arms the headless caller never supplies -----------
  // Upstream has ONE call site for this dispatcher, and it forwards a session-id
  // override and a title from its own parameters. Both arrive undefined on the
  // headless seam — measured, not assumed: the record `hooks-session-start`
  // writes has five keys, which is what is left after JSON drops the undefined
  // ones.
  {
    branch: "session-start-hooks#sessionStartHooks@0:T",
    reason:
      "the session-id OVERRIDE arm, which builds the record for a synthetic session while still handing the executor the real one. The headless caller passes no override — measured: the record the corpus writes carries the run's own session id. strangle/hooks-parity.test.ts grades it with a dedicated case plus a control asserting the executor was NOT handed the synthetic session, which is the defect a module that collapsed the two would ship.",
  },
  {
    branch: "session-start-hooks#sessionStartHooks@1:F",
    reason:
      "an explicit session TITLE, which beats the lookup. The headless caller passes none, so the corpus only ever renders the fallback — and the fallback answers `undefined` on this seam, which is why `session_title` is absent from the record on stdin. strangle/hooks-parity.test.ts grades both arms, with a control asserting the fallback is derived from the RECORD's session id rather than the real one.",
  },
  {
    branch: "session-start-hooks#sessionStartHooks@2:T",
    reason:
      "the throwing arm of the activity-hold bracket. Reaching it needs the shared hook executor to throw, which no corpus scenario can make it do without breaking the run it is grading. strangle/hooks-parity.test.ts grades it directly: one case drives the dispatcher with a throwing executor stub and a control asserts the hold is NOT left un-released — the difference between an idle session and one wedged open forever.",
  },

  // ---- SessionEnd: the options bag upstream defaults ------------------------
  {
    branch: "session-end-hooks#sessionEndHooks@0:F",
    reason:
      "the `options || {}` default, i.e. the dispatcher called with no options bag at all. Upstream has THREE callers — `/clear`, session resume, and the app's own shutdown(), which reaches this function through the barrel chunk by dynamic import — and all three pass a bag, so the arm is defensive rather than reachable and the corpus cannot render it without a fourth caller. (The count was two here until C8's second round found the shutdown caller: the static import graph does not see a dynamic import, and that miss is also what left SessionEnd's ordinary-teardown fire unexplained. The conclusion is unchanged; the premise was wrong.) strangle/hooks-parity.test.ts runs every result shape against BOTH option sets, the absent one included, and compares the executor request each produces.",
  },

  // ---- PreCompact: the result shapes a scenario cannot produce -------------
  // This dispatcher reduces a list of hook RESULTS to a verdict, so its arms are
  // selected by the shapes of those results rather than by anything the
  // conversation does. `hooks-precompact` now produces four of the six shapes
  // with real hook processes. The two it does not are `blocked` and `cancelled`,
  // and neither is a scenario this recording could also be:
  //
  //   BLOCKED is producible — a command hook exiting 2 blocks — but a blocked
  //       PreCompact CANCELS the compaction, so the scenario would no longer
  //       record the compaction it exists for. That is a different recording,
  //       and it is deferred rather than called impossible.
  //   CANCELLED needs the hook execution to be aborted or to time out mid-run,
  //       which is not a shape a recording can hold still.
  {
    branch: "pre-compact-hooks#preCompactHooks@4:T",
    reason:
      "a CANCELLED hook result, which upstream narrates as nothing at all while still counting it toward the custom instructions — an asymmetry no other surface can see. Producing one needs the execution aborted or timed out mid-run. strangle/hooks-parity.test.ts grades it with a dedicated case and a control asserting a cancelled hook is not narrated in the display message.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@9:T",
    reason:
      "at least one BLOCKED result, which is what produces a blocking reason at all. Producible in principle (a command hook that exits 2 blocks) but a blocked PreCompact cancels the compaction, so the scenario would stop recording the compaction it exists for — deferred to a scenario of its own, not impossible. strangle/hooks-parity.test.ts grades it across three blocking cases and a control that computes blocking from FAILURE instead of the blocked flag.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@10:T",
    reason:
      "the blocking reason's WITH-output phrasing, inside the map over blocked results; unreachable while no result is blocked (see @9:T). Graded by strangle/hooks-parity.test.ts, which runs a blocked hook with a reason and one without.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@10:F",
    reason:
      "the blocking reason's bare-command phrasing, for a hook that blocked without saying why; unreachable while no result is blocked (see @9:T). Graded by strangle/hooks-parity.test.ts.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@11:T",
    reason:
      "the DELEGATED-OBSERVATION verdict: blocking only, with no custom instructions and no display message, because that kind of subagent has neither a summarisation prompt of its own nor a conversation to display into. The headless Agent tool cannot produce a delegated-observation subagent (the same agent kind W5's stop dispatcher already excludes). strangle/hooks-parity.test.ts grades it with two cases and a control asserting the delegated arm does not return the full verdict.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@12:T",
    reason:
      "the blocking spread inside the delegated-observation return; unreachable while that arm is (see @11:T). Graded by strangle/hooks-parity.test.ts.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@12:F",
    reason:
      "the same spread with nothing blocking; unreachable while the delegated-observation arm is (see @11:T). Graded by strangle/hooks-parity.test.ts, which runs the delegated arm both with and without a blocking result.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@13:F",
    reason:
      "the no-instructions arm, i.e. a compaction where no hook contributed any. It is the complement of an arm this scenario DOES render — one recording holds one compaction, so one of the two is always unrendered, and the rendered one was chosen because it also exercises the join. strangle/hooks-parity.test.ts runs both, with a control on the blank-line join between instructions.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@14:F",
    reason:
      "the no-display-message arm, which needs EVERY result to be cancelled — the only result shape that contributes no line. Unreachable for the same reason @4:T is. strangle/hooks-parity.test.ts grades it.",
  },
  {
    branch: "pre-compact-hooks#preCompactHooks@15:T",
    reason:
      "the blocking spread on the general verdict; unreachable while no result is blocked (see @9:T). Graded by strangle/hooks-parity.test.ts.",
  },

  // ==========================================================================
  // C8's SECOND round — the nine dispatchers the registry-derived probe found
  // live. Each has a recording that creates its firing condition; the
  // compaction recording gained a second set of command hooks so PostCompact's
  // four result-shape arms render with real hook processes rather than with a
  // callback's single shape. What is left is below.
  // ==========================================================================

  // ---- PostCompact: the two result shapes and the agent kind ---------------
  {
    branch: "post-compact-hooks#postCompactHooks@0:T",
    reason:
      "the delegated-observation arm, which returns the EMPTY verdict before the executor runs — so unlike PreCompact, whose delegated arm still runs the hooks and only drops their reporting, this one never dispatches at all. Producing a delegated-observation subagent needs an agent kind the headless Agent tool cannot dispatch. " +
      ORACLE_PC + " One of those controls asserts the delegated arm did NOT reach the executor, which is the difference between the two siblings.",
  },
  {
    branch: "post-compact-hooks#postCompactHooks@3:T",
    reason:
      "a CANCELLED hook result, narrated as nothing at all. Producing one needs the hook execution aborted or timed out mid-run, which is not a shape a recording can hold still. " +
      ORACLE_PC + " One control asserts a cancelled hook is not narrated in the display message.",
  },
  {
    branch: "post-compact-hooks#postCompactHooks@7:F",
    reason:
      "an EMPTY display list, which requires every result to have been cancelled — the same unreproducible shape as above, and then all of them. " +
      ORACLE_PC + " The zero-results arm above it is a different branch and the corpus does not render that either; a control asserts the two are not collapsed, since `{}` and `{userDisplayMessage: undefined}` are the same JSON and differ only in their KEYS.",
  },

  // ---- InstructionsLoaded: the defensive default --------------------------
  {
    branch: "instructions-loaded-hooks#instructionsLoadedHooks@0:T",
    reason:
      "the `options ?? {}` default, i.e. the dispatcher called with no options bag. Both of upstream's call sites pass one — they have to, since that is where the storage handle and the credentials travel — so the arm is defensive rather than reachable, and the corpus cannot render it without a third caller. " +
      ORACLE_IL,
  },

  // ---- StopFailure: the agent kind, and two shapes of failing turn ---------
  {
    branch: "stop-failure-hooks#stopFailureHooks@0:T",
    reason:
      "the delegated-observation arm, checked BEFORE the registration guard. Same unreachable agent kind as PostCompact's. " +
      ORACLE_SF + " One control asserts the delegated arm is checked before the guard rather than after, which is the ordering a module could silently swap.",
  },
  {
    branch: "stop-failure-hooks#stopFailureHooks@2:F",
    reason:
      "a failing turn whose assistant message carries NO text, which upstream coerces from the empty string to undefined so JSON drops the key. The recorded failure is a 500 the engine renders as an api-error message WITH text, and a text-free failing turn would need a different failure shape than the one this recording exists for. " +
      ORACLE_SF + " Three cases cover no text, whitespace-only text and two blocks joined by a newline, with a control on the coercion.",
  },
  {
    branch: "stop-failure-hooks#stopFailureHooks@3:T",
    reason:
      "the `error ?? \"unknown\"` fallback, i.e. a failing turn the engine could not name a kind for. Every arm that reaches this dispatcher sets one — api_error, prompt_too_long, image_error, the malformed-tool-use exhaustion — so the fallback is defensive. It is also the match query, which makes the fallback a matcher key and not only a field. " +
      ORACLE_SF + " One control asserts a missing kind is not left undefined.",
  },

  // ---- the two decisionReason shape tests: the shapes the corpus never
  // ---- hands them ----------------------------------------------------------
  // Both were adjudicated DARK by the wave and spliced by its fix round, once the
  // corpus's first `auto` cell reached the mode-aware body that calls them. What
  // the corpus reaches is the CALL, not the whole domain: it never passes either
  // of them a `safetyCheck` reason, and never a `subcommandResults` one either.
  {
    branch: "safety-check-reason#findSafetyCheckReason@1:T",
    reason:
      "the finder actually FINDING one, i.e. a decision whose reason IS a safety check. The matrix carries `safetyCheck` as OPEN by deliberate design — creating it means running something genuinely dangerous in the sandbox, which this project has chosen to design rather than improvise — so no corpus decision carries the shape this arm exists to recognise. " +
      ORACLE_SHAPES,
  },
  {
    branch: "safety-check-reason#findSafetyCheckReason@3:T",
    reason:
      "the RECURSION, i.e. the finder handed an aggregate `subcommandResults` reason to descend into. The two upstream call sites that would pass one are on the live headless Bash path but need command shapes no cell writes (two `cd`s in one command; the same normalized subcommand twice at equal decision rank), and the call site the corpus does reach — the mode-aware body's — passes the pre-check's decision for a single non-compound command. The F arm executes, so the function is demonstrably called. " +
      ORACLE_SHAPES,
  },
  {
    branch: "safety-check-reason#findSafetyCheckReason@2:T",
    reason: "the filter ACCEPTING a safety check it was handed, which needs @1:T above — a decision whose reason IS a safety check, and the corpus creates none. " + ORACLE_SHAPES,
  },
  {
    branch: "safety-check-reason#findSafetyCheckReason@2:F",
    reason:
      "the filter REJECTING one, which is the arm the pre-check's bypass rung depends on (it asks only for BYPASS-IMMUNE safety checks) and needs the same absent input. Downstream of @1:T. " +
      ORACLE_SHAPES,
  },
  {
    branch: "safety-check-reason#findSafetyCheckReason@4:iterated",
    reason: "the descent over an aggregate's parts, inside the recursion the corpus does not enter (@3:T). " + ORACLE_SHAPES,
  },
  {
    branch: "safety-check-reason#findSafetyCheckReason@5:T",
    reason: "a part whose descent FOUND one, which returns early and stops the loop — the ordering claim of the recursion, and downstream of @4. " + ORACLE_SHAPES,
  },
  {
    branch: "safety-check-reason#findSafetyCheckReason@5:F",
    reason: "a part whose descent found nothing, so the loop continues to the next. Downstream of @4. " + ORACLE_SHAPES,
  },
  {
    branch: "ask-rule-reason#isAskRuleDrivenReason@5:iterated",
    reason: "the same descent on the ask-rule predicate, inside the recursion the corpus does not enter (@3:T). " + ORACLE_SHAPES,
  },
  {
    branch: "ask-rule-reason#isAskRuleDrivenReason@3:T",
    reason:
      "the same aggregate shape, on the ask-rule predicate: a `subcommandResults` reason to descend into, which its reached call site never passes. Its F arm executes. " +
      ORACLE_SHAPES,
  },
  {
    branch: "ask-rule-reason#isAskRuleDrivenReason@6:T",
    reason: "inside the recursion the corpus does not enter (@3:T above): a part that is BOTH asking and itself ask-rule-driven. " + ORACLE_SHAPES,
  },
  {
    branch: "ask-rule-reason#isAskRuleDrivenReason@6:F",
    reason: "the other outcome of the same unentered loop body — a part that fails either half of the conjunction. " + ORACLE_SHAPES,
  },
  {
    branch: "ask-rule-reason#isAskRuleDrivenReason@7:T",
    reason:
      "the conjunction's FIRST term inside that loop, recorded separately because the two terms are what upstream requires together: a part that merely carries an ask-rule reason without asking does not make the aggregate ask-rule-driven. " +
      ORACLE_SHAPES,
  },
  {
    branch: "ask-rule-reason#isAskRuleDrivenReason@7:F",
    reason: "the short-circuit of that first term, which keeps the recursive call from running on a part that is not asking. " + ORACLE_SHAPES,
  },

  // ---- PermissionDenied: the guard's refusal -------------------------------
  {
    branch: "permission-denied-hooks#permissionDeniedHooks@0:T",
    reason:
      "the registration guard REFUSING, i.e. a denial in a session with no PermissionDenied hook — which is the common case on every session in the world and is reachable by no scenario at all, since a run with no hook registered produces no consult, no record and no observable. " +
      "It is doubly unreachable here: the dispatcher's sole call site fires only on a denial whose decisionReason is the auto-mode classifier's, so a scenario would have to create that condition AND then decline to watch it, which is a recording of nothing. " +
      ORACLE_PD + " One case drives the guard's refusal directly and one control asserts the guard cannot be dropped.",
  },

  // ---- UserPromptExpansion: the agent key, and the refusal -----------------
  {
    branch: "user-prompt-expansion-hooks#userPromptExpansionHooks@0:F",
    reason:
      "the guard keyed on the AGENT id rather than the session id — the only dispatcher in the family that chooses between them. It needs a slash command, skill or MCP prompt expanded INSIDE a subagent, and the headless Agent tool takes a task rather than a command to expand. " +
      ORACLE_UPE + " Two cases and two controls sit on this key, because keying it wrong silently disables hook matching for every subagent expansion.",
  },
  {
    branch: "user-prompt-expansion-hooks#userPromptExpansionHooks@1:T",
    reason:
      "the refusal arm: an expansion with no UserPromptExpansion hook registered produces no consult, no record and no frame, so \"the guard refused\" and \"nothing was expanded\" are the same recording. Unlike PostToolUseFailure's refusal — which another scenario's tool call now renders incidentally — nothing else in the corpus expands a slash command at all, so this one stays unrecordable until a second expanding scenario exists. " +
      ORACLE_UPE + " Two controls sit on it: a refusal that still reached the executor, and one that still minted a tool-use id.",
  },

  // ==== W6 / C9: the permission subsystem ==================================
  //
  // The widest exclusion set in the campaign, and the reason is structural.
  // This subsystem's job is to DECIDE, and a rung that is reached and passes
  // leaves the same transcript as one that was never reached — so a decision
  // ladder is the one shape where transcript-level coverage says least. Four
  // families account for most of it, and each is named on its own entries:
  // arms behind a pinned environment (sandboxing, remote execution, the
  // feature gates §3.3 fixes at their disabled defaults), arms behind a tool
  // capability NO TOOL THIS CORPUS CONFIGURES implements — which is a claim
  // about the configuration and not a structural one, and the wording matters:
  // `requiresUserInteraction` is settable by any MCP server through
  // `_meta["anthropic/requiresUserInteraction"]`, so a scenario that mounted one
  // would overturn these entries rather than contradict a law — arms behind an
  // interactive surface a headless session does not have, and arms behind a
  // condition this project has deliberately not created (a real safety-check
  // trigger).
  //
  // Three entries below are MEASURED negatives rather than deferrals, and they
  // are the ones worth reading: the pre-check's whole-tool deny rung (a
  // whole-tool deny rule removes the tool from the session, so the rung cannot
  // see one), its input-deny rung (three rule spellings tried live, none
  // landed on it), and the guard's auto refusal (the mode was ACCEPTED through
  // both paths, so the refusal needs a condition this environment does not
  // produce).
  {
    branch: "permission-precheck#permissionPrecheck@0:T",
    reason:
      "the ABORT arm at the top of the ladder: a turn cancelled while a permission decision is in flight. The corpus aborts a turn (`interrupt`), and that abort lands BETWEEN tool calls — the SDK's interrupt cancels the query, not a decision already inside the pre-check, so replaying it reaches this line with a signal that is not yet aborted. Named condition, not created. " +
      ORACLE_PRECHECK +
      " One case drives an already-aborted context and asserts the throw happens before the permission context is even read.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@1:T",
    reason:
      "the WHOLE-TOOL DENY rung, and this one is MEASURED rather than deferred. A whole-tool deny rule never reaches this line: upstream applies it by REMOVING the tool from the session (a `deny: [\"Write\"]` run offers twenty-four tools in its init frame instead of twenty-five), so the model is told the tool does not exist and nothing decides anything. Two of this wave's scenarios were written that way, passed every assertion they carried, and were caught by this branch reading zero. The remaining condition is a whole-tool deny arriving MID-session through `updatedPermissions`, after the tool list for the turn is already fixed. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@2:T",
    reason:
      "the INPUT-DENY rung. Reaching it needs a rule upstream's input matcher accepts, and the grammar is narrower than the docs suggest: only `Tool(field:pattern)`, and the tool's OWN rule-content field is explicitly skipped. Three spellings were measured live and none landed — `Write(*)` is read as a whole-tool grant and filtered the tool out of the session, `Write(<path>)` and `Write(//<abs>)` fall on the skipped `file_path` field, and `Write(content:<glob>)` let the call through to the broker. Named with its condition and its three refuted spellings, which is more than the row had before. " +
      ORACLE_PRECHECK +
      " Both deny rungs are graded there against upstream's bytes, including the message each builds and the fact that rung 1's is the only permission sentence in the subsystem built INLINE rather than by the message builder.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@4:T",
    reason:
      "the Bash SANDBOX carve-out inside the allow-rule arm. `sandbox.isSandboxingEnabled()` is false in the graded environment (§3.3 pins the gate state and X6 forbids the env overrides that would flip it), so no run can make a call `sandboxable`. This is the full five-term conjunction. " +
      ORACLE_PRECHECK +
      " The oracle drives the sandbox port on both settings and asserts the delegation is SUPPRESSED while a sandboxable call is unconfirmed.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@5:T",
    reason:
      "the Bash SANDBOX carve-out inside the allow-rule arm. `sandbox.isSandboxingEnabled()` is false in the graded environment (§3.3 pins the gate state and X6 forbids the env overrides that would flip it), so no run can make a call `sandboxable`. The fourth term, `isAutoAllowBashIfSandboxedEnabled`, is a second gate below the first. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@6:T",
    reason:
      "the `tool.name === bashToolName && context.forRemoteExecution !== true` prefix of the sandbox conjunction. Unlike the terms below it this one is not gate-blocked — it needs a Bash call that also matches a WHOLE-TOOL Bash allow rule, which no scenario carries. It would buy two booleans of a five-term conjunction whose remaining three are pinned off, so it is deferred rather than recorded. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@7:T",
    reason:
      "the same prefix's first term. Same condition and same deferral as the branch above. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@8:T",
    reason:
      "`confirmed` — a sandboxable call the sandbox has already confirmed. Unreachable while sandboxing is off. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@9:T",
    reason:
      "`awaitingSandbox` — a sandboxable call the sandbox has NOT confirmed, which is the arm that suppresses the allow-rule delegation. Unreachable while sandboxing is off, and the arm the oracle spends two cases on for exactly that reason. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@10:T",
    reason:
      "the MCP-SERVER-POLICY remote exemption. It needs `CLAUDE_CODE_REMOTE` set, which X6's env allowlist forbids a graded run from setting, AND an allow rule sourced from a server policy, which a local session has no way to acquire. The full four-term conjunction, including the feature gate at its end. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@11:T",
    reason:
      "the MCP-SERVER-POLICY remote exemption. It needs `CLAUDE_CODE_REMOTE` set, which X6's env allowlist forbids a graded run from setting, AND an allow rule sourced from a server policy, which a local session has no way to acquire. The `env.CLAUDE_CODE_REMOTE` term. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@12:T",
    reason:
      "the MCP-SERVER-POLICY remote exemption. It needs `CLAUDE_CODE_REMOTE` set, which X6's env allowlist forbids a graded run from setting, AND an allow rule sourced from a server policy, which a local session has no way to acquire. The rule-source term. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@13:F",
    reason:
      "the guard that SUPPRESSES the allow-rule delegation. Its false arm needs either the sandbox carve-out or the remote-policy exemption above, both of which are unreachable in the graded environment. This is the branch that decides whether an allow rule delegates at all, so the oracle carries controls on both arms. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@14:F",
    reason:
      "the `!awaitingSandbox` half of the same guard; unreachable for the same pinned reason. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@15:T",
    reason:
      "the tool's own `checkPermissions` THROWING. Every tool the corpus calls parses its input and answers; a throw needs a tool whose schema rejects the model's arguments or whose check crashes, which no recording creates deliberately. This is also the arm the `crashIsObjection` option exists for, and its consequences are what the oracle spends its error cases on. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@16:T",
    reason:
      "the PLAN-MODE MCP OVERRIDE, whole. It needs an MCP tool, called in PLAN mode, that is not read-only and whose own check returns passthrough. The corpus calls an MCP tool (`mcp-tool`) and enters plan mode (`perm-plan-mode`, `perm-mode-walk`), but never both at once, and the MCP tool it has is read-only. Named condition; one scenario would create it. " +
      ORACLE_PRECHECK +
      " The override is graded there across all five of its terms, because it is written inside an assignment in upstream and the evaluation order is the thing a transcription can silently change.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@17:T",
    reason:
      "the same override's four-term prefix, up to the plan-mode read. Same condition. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@21:T",
    reason:
      "the tool-error CLASSIFIER returning a decision. Downstream of the throw at @15, so it inherits that condition. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@21:F",
    reason:
      "the classifier returning UNDEFINED, which leaves the passthrough default in place. Downstream of the same unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@23:T",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@26:T",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@26:F",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@30:T",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@30:F",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@33:T",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@41:T",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@44:T",
    reason:
      "an optional read of `decision` where the tool's check left it UNDEFINED. Upstream seeds `decision` with a passthrough object and every corpus path either keeps that object or replaces it with the tool's answer, so the optional never short-circuits; it can only be undefined on the arm where the classifier returns undefined for a THROWN error and the seed has already been overwritten. Downstream of @15's unreached throw. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@24:T",
    reason:
      "the ASK-RULE rung firing inside the PRE-CHECK. The corpus has an ask-rule cell (`perm-rule-ask`) and it lands on the mode-aware body's own copy of the rung rather than on this one — the same twin-function shape that makes `Gx` and `Aon` two rule checkers rather than one. Named condition: an ask rule matching a call that reaches THIS body, which needs a tool the mode-aware body passes through. " +
      ORACLE_PRECHECK +
      " The rung's two arms — annotating an existing ask versus creating one — are the pair the oracle exists to separate, and `matchedAskRule` is stamped on only one of them.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@25:T",
    reason:
      "the ANNOTATING arm of that rung: an ask rule matching a decision the tool was ALREADY asking about, which is the only place `matchedAskRule` is attached. Downstream of @24. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@25:F",
    reason:
      "the CREATING arm of the same rung. Downstream of @24. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@27:T",
    reason:
      "a tool that REQUIRES USER INTERACTION. " +
      INTERACTION_TEXT +
      " Named condition, and one this corpus's configuration argues against creating rather than one the code forbids. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@29:T",
    reason:
      "the interaction rung's arm that keeps an ask the tool already made. Downstream of @27. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@29:F",
    reason:
      "the same rung's arm that CREATES an ask with `requiresUserInteraction` as its reason. Downstream of @27. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@34:T",
    reason:
      "an MCP server's ASK CEILING (`effectiveMaxPermission === \"ask\"`). The corpus's MCP server is configured without one; setting it means a second MCP fixture whose only difference is the ceiling. Named condition. " +
      ORACLE_PRECHECK +
      " The ceiling's reason object is one of the eleven decisionReason kinds the oracle walks.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@45:T",
    reason:
      "the BYPASS-IMMUNE safety check — the one thing bypass mode may not override. It needs a safety check to fire at all, which §3.3 of the matrix records as a condition this project should design deliberately rather than improvise, because creating it means running something genuinely dangerous in the sandbox. Named, not created. " +
      ORACLE_PRECHECK +
      " The floor's asymmetry (under bypass only an immune check holds; outside it any safety check, a sandbox override or a plan-mode floor does) is graded there in both directions.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@48:T",
    reason:
      "the ordinary SAFETY FLOOR outside bypass. Same uncreated condition as @45. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@55:T",
    reason:
      "a tool that OPTS OUT of whole-tool allow rules (`ignoresWholeToolAllowRule`). One tool in the bundle implements it, and it is not one a headless corpus calls. Named condition. " +
      ORACLE_PRECHECK +
      " The opt-out is one of three independent escapes from the whole-tool allow, and the oracle drives each separately because a transcription that merges them is invisible to any recording.",
  },
  {
    branch: "permission-precheck#permissionPrecheck@56:T",
    reason:
      "the CHROME-TOOL escape from the whole-tool allow. The Chrome tools are not present in a headless session's tool list at all, so no input can make `isChromeTool` true. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@57:T",
    reason:
      "the chrome CLASSIFIER floor, the first of the two Chrome conditions. Unreachable for the same reason. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "permission-precheck#permissionPrecheck@57:F",
    reason:
      "its false arm, which hands off to the context's chrome floor flag. Unreachable for the same reason. " +
      ORACLE_PRECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@0:T",
    reason:
      "the whole-tool deny rung of the rule-only checker. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. It also inherits the pre-check's measured obstacle: a whole-tool deny rule removes the tool from the session, so it is not enough to add one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@1:T",
    reason:
      "its input-deny rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. Same input-rule grammar obstacle as the pre-check's, with the same three refuted spellings. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@2:F",
    reason:
      "the arm where NO allow rule matches, which is the gateway to this function's whole lower body. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@3:T",
    reason:
      "the Bash sandbox carve-out (the full sandbox conjunction). Sandboxing is off in the graded environment (§3.3), and this function is additionally behind `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@4:T",
    reason:
      "the Bash sandbox carve-out (its four-term prefix). Sandboxing is off in the graded environment (§3.3), and this function is additionally behind `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@5:T",
    reason:
      "the Bash sandbox carve-out (its `tool.name === bashToolName && !forRemoteExecution` prefix). Sandboxing is off in the graded environment (§3.3), and this function is additionally behind `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@6:T",
    reason:
      "the Bash sandbox carve-out (its tool-name term). Sandboxing is off in the graded environment (§3.3), and this function is additionally behind `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@7:T",
    reason:
      "the Bash sandbox carve-out (`sandboxable`). Sandboxing is off in the graded environment (§3.3), and this function is additionally behind `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@9:T",
    reason:
      "the Bash sandbox carve-out (`sandboxable` on the confirmation read). Sandboxing is off in the graded environment (§3.3), and this function is additionally behind `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@8:F",
    reason:
      "the arm that SUPPRESSES this checker's allow-rule delegation for an unconfirmed sandboxable call. Unreachable while sandboxing is off. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@10:T",
    reason:
      "the tool's own check THROWING in the rule-only checker. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@10:F",
    reason:
      "the same try completing without a throw in the rule-only checker. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@11:T",
    reason:
      "the tool-error classifier returning a decision, downstream of the unreached try. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@11:F",
    reason:
      "it returning undefined, downstream of the unreached try. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@12:T",
    reason:
      "`crashIsObjection` set on the crash path — the option that turns a tool's crash into an objection, which is this function's own reason for existing separately. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@12:F",
    reason:
      "it unset on the crash path — the option that turns a tool's crash into an objection, which is this function's own reason for existing separately. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@13:T",
    reason:
      "the optional read of the options bag with the bag present on the crash path — the option that turns a tool's crash into an objection, which is this function's own reason for existing separately. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@13:F",
    reason:
      "the same read with no bag on the crash path — the option that turns a tool's crash into an objection, which is this function's own reason for existing separately. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@14:T",
    reason:
      "a tool DENY winning outright. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@14:F",
    reason:
      "no tool deny. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@15:T",
    reason:
      "the optional read behind it with a decision present. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@15:F",
    reason:
      "the same read with none. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@16:T",
    reason:
      "an ask rule matching at this checker's ask rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@16:F",
    reason:
      "no ask rule at this checker's ask rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@17:T",
    reason:
      "its annotating arm at this checker's ask rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@17:F",
    reason:
      "its creating arm at this checker's ask rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@18:T",
    reason:
      "the optional read behind them with a decision present at this checker's ask rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@18:F",
    reason:
      "the same read with none at this checker's ask rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@19:T",
    reason:
      "the interaction rung firing. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@19:F",
    reason:
      "it not firing. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@20:T",
    reason:
      "its two-term prefix true. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@20:F",
    reason:
      "false. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@21:T",
    reason:
      "the `interactionSatisfied` term true. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@21:F",
    reason:
      "false. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@22:T",
    reason:
      "the optional options read with a bag. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@22:F",
    reason:
      "without one. This rung is the one that reads the HOOK's updated input rather than the raw one, which is the difference between the twins. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@23:T",
    reason:
      "the arm that keeps an existing ask at the interaction rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@23:F",
    reason:
      "the arm that creates one at the interaction rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@24:T",
    reason:
      "the optional read with a decision at the interaction rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@24:F",
    reason:
      "without one at the interaction rung. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@25:T",
    reason:
      "an ask the USER's own ask rule drove, kept as-is — the rung that consumes the owned `isAskRuleDrivenReason` helper. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK +
      " The helper itself is graded against upstream's own bytes before this body is built on it.",
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@25:F",
    reason:
      "the same test failing — the rung that consumes the owned `isAskRuleDrivenReason` helper. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK +
      " The helper itself is graded against upstream's own bytes before this body is built on it.",
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@26:T",
    reason:
      "its behaviour term — the rung that consumes the owned `isAskRuleDrivenReason` helper. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK +
      " The helper itself is graded against upstream's own bytes before this body is built on it.",
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@26:F",
    reason:
      "that term false — the rung that consumes the owned `isAskRuleDrivenReason` helper. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK +
      " The helper itself is graded against upstream's own bytes before this body is built on it.",
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@27:T",
    reason:
      "the optional read with a decision — the rung that consumes the owned `isAskRuleDrivenReason` helper. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK +
      " The helper itself is graded against upstream's own bytes before this body is built on it.",
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@27:F",
    reason:
      "without one — the rung that consumes the owned `isAskRuleDrivenReason` helper. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK +
      " The helper itself is graded against upstream's own bytes before this body is built on it.",
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@28:T",
    reason:
      "an MCP ask CEILING in the rule-only checker. Needs an MCP tool reaching this function, which needs a hook rewrite on an MCP call. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@28:F",
    reason:
      "no ceiling in the rule-only checker. Needs an MCP tool reaching this function, which needs a hook rewrite on an MCP call. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@29:T",
    reason:
      "the optional mcpInfo read with MCP info in the rule-only checker. Needs an MCP tool reaching this function, which needs a hook rewrite on an MCP call. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@29:F",
    reason:
      "without it in the rule-only checker. Needs an MCP tool reaching this function, which needs a hook rewrite on an MCP call. `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@31:T",
    reason:
      "the safety floor's behaviour term true at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@31:F",
    reason:
      "false at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@32:T",
    reason:
      "the optional read with a decision at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@32:F",
    reason:
      "without one at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@33:T",
    reason:
      "a safety check found at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@33:F",
    reason:
      "none found at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@34:T",
    reason:
      "the optional decisionReason read with a reason at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@34:F",
    reason:
      "without one at this checker's safety floor. Compounds two uncreated conditions: the safety check itself (§3.3 of the matrix defers creating one deliberately) and `Gx` is the pre-check's twin — the same ladder without the mode arms — and it has exactly one live headless caller: the re-check the engine runs on a PermissionRequest hook's REWRITTEN input. Every call the corpus makes reaches it with a whole-tool allow rule present, so the delegation at rung 3 returns before the rest of the body runs. Reaching what is below needs a hook rewrite onto an input with no matching allow rule — one scenario, and a named one. " +
      ORACLE_RULECHECK,
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@0:T",
    reason:
      "the tool's `checkPermissions` THROWING inside the delegation. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. A throw needs a tool whose schema rejects the model's arguments. " +
      ORACLE_ALLOWRULE,
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@1:T",
    reason:
      "a tool DENY overriding an allow rule — the module's whole point, stated as a branch: an allow rule does not allow, it lets the tool object. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. Reaching it needs a tool that denies its own call while a whole-tool allow rule is in force. Named condition. " +
      ORACLE_ALLOWRULE +
      " Both the deny and the ask overrides are graded there, which is what makes this module's claim testable at all.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@2:T",
    reason:
      "the optional read behind that deny test with the decision present-but-not-deny. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE,
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@3:F",
    reason:
      "the arm where the tool neither denies nor asks, so the allow rule actually allows. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. The recorded shape takes the ASK arm, so the plain allow is the one that is not created. Named condition: a whole-tool allow rule over a tool whose own check passes through. " +
      ORACLE_ALLOWRULE,
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@4:T",
    reason:
      "the optional read behind the ask test with no decision at all — downstream of the unreached throw at @0. " +
      ORACLE_ALLOWRULE,
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@5:T",
    reason:
      "the classifier returning a DENY for a thrown error. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@5:F",
    reason:
      "it returning something else. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@6:T",
    reason:
      "the classifier returning any decision. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@6:F",
    reason:
      "it returning undefined. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@7:T",
    reason:
      "`crashIsObjection` set on an unclassifiable crash. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@7:F",
    reason:
      "that test failing. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@8:T",
    reason:
      "the classifier returning undefined. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@8:F",
    reason:
      "it returning a decision. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@9:T",
    reason:
      "the optional options read with a bag. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "allow-rule-decision#allowRuleDecision@9:F",
    reason:
      "without one. Every one of these is downstream of the tool's check THROWING at @0, which the corpus does not create. this module is the pre-check's rung-3 delegation, and the corpus reaches it on ONE shape: a whole-tool allow rule on a Write, whose own check returns an ask. That is the shape `perm-rule-allow` was rewritten to create after its content-rule take measured the tool instead of the rung. " +
      ORACLE_ALLOWRULE +
      " The crash path is where this module differs most from a naive transcription — it decides whether a crash is an objection or a passthrough — so the oracle runs it over both option settings and both classifier outcomes.",
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@0:T",
    reason:
      "the guard called with NO mode at all — the arm that lets a caller clear the mode. The control channel's `setPermissionMode` always carries one, so nothing headless can omit it. " +
      ORACLE_GUARD +
      " The oracle drives the guard over the fixture's six modes AND the undefined case, and the refusal texts it compares come from the same fixture, so a guard that gains a refusal upstream widens the case list rather than leaving a hole.",
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@1:T",
    reason:
      "the guard's BYPASS arm. `bypassPermissions` is set at SPAWN in every scenario that uses it, and the spawn path does not consult this guard — the CLI's own mode parser accepts it directly. A run that asks the guard for bypass needs `setPermissionMode(\"bypassPermissions\")` over the control channel, which the SDK refuses upstream of the guard. Measured through both paths by `w6/probe-permissions.ts`. This is the arm's entry test. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@2:T",
    reason:
      "a RESTRICTED context refusing bypass — downstream of the guard's BYPASS arm. `bypassPermissions` is set at SPAWN in every scenario that uses it, and the spawn path does not consult this guard — the CLI's own mode parser accepts it directly. A run that asks the guard for bypass needs `setPermissionMode(\"bypassPermissions\")` over the control channel, which the SDK refuses upstream of the guard. Measured through both paths by `w6/probe-permissions.ts`. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@2:F",
    reason:
      "an unrestricted one — downstream of the guard's BYPASS arm. `bypassPermissions` is set at SPAWN in every scenario that uses it, and the spawn path does not consult this guard — the CLI's own mode parser accepts it directly. A run that asks the guard for bypass needs `setPermissionMode(\"bypassPermissions\")` over the control channel, which the SDK refuses upstream of the guard. Measured through both paths by `w6/probe-permissions.ts`. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@3:T",
    reason:
      "the bypass feature gate disabling it — downstream of the guard's BYPASS arm. `bypassPermissions` is set at SPAWN in every scenario that uses it, and the spawn path does not consult this guard — the CLI's own mode parser accepts it directly. A run that asks the guard for bypass needs `setPermissionMode(\"bypassPermissions\")` over the control channel, which the SDK refuses upstream of the guard. Measured through both paths by `w6/probe-permissions.ts`. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@3:F",
    reason:
      "the gate allowing it — downstream of the guard's BYPASS arm. `bypassPermissions` is set at SPAWN in every scenario that uses it, and the spawn path does not consult this guard — the CLI's own mode parser accepts it directly. A run that asks the guard for bypass needs `setPermissionMode(\"bypassPermissions\")` over the control channel, which the SDK refuses upstream of the guard. Measured through both paths by `w6/probe-permissions.ts`. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@4:T",
    reason:
      "the session not offering bypass at all — downstream of the guard's BYPASS arm. `bypassPermissions` is set at SPAWN in every scenario that uses it, and the spawn path does not consult this guard — the CLI's own mode parser accepts it directly. A run that asks the guard for bypass needs `setPermissionMode(\"bypassPermissions\")` over the control channel, which the SDK refuses upstream of the guard. Measured through both paths by `w6/probe-permissions.ts`. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@4:F",
    reason:
      "it offering bypass — downstream of the guard's BYPASS arm. `bypassPermissions` is set at SPAWN in every scenario that uses it, and the spawn path does not consult this guard — the CLI's own mode parser accepts it directly. A run that asks the guard for bypass needs `setPermissionMode(\"bypassPermissions\")` over the control channel, which the SDK refuses upstream of the guard. Measured through both paths by `w6/probe-permissions.ts`. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@5:T",
    reason:
      "the guard REFUSING `auto`, and this is a MEASURED negative rather than an unreached one. The wave probed `auto` through both paths and both ACCEPTED it: upstream's auto gate is `!circuitBreaker && !settingsDisabled && modelSupportsAuto`, three local conditions rather than the remote feature flag the campaign spec assumed, and none of them is off in this environment. So the refusal arm needs a circuit-breaker trip, a settings-level disable or a model without auto support — none of which §3.3's pinned environment produces. " +
      ORACLE_GUARD +
      " The refusal and its two message shapes are graded there against the fixture's own guard texts.",
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@6:T",
    reason:
      "the `mode === \"auto\"` term of that refusal. Executed only when the gate below it is false, so it inherits @5's condition. " +
      ORACLE_GUARD,
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@7:T",
    reason:
      "the refusal message WITH a reason from the gate layer. Both are downstream of the auto refusal at @5, which this environment does not produce. " +
      ORACLE_GUARD +
      " The two message shapes are exactly what the fixture records verbatim, and the oracle compares both.",
  },
  {
    branch: "mode-change-guard#guardPermissionModeChange@7:F",
    reason:
      "the bare refusal with none. Both are downstream of the auto refusal at @5, which this environment does not produce. " +
      ORACLE_GUARD +
      " The two message shapes are exactly what the fixture records verbatim, and the oracle compares both.",
  },
  {
    branch: "mode-transition#transitionPermissionMode@0:T",
    reason:
      "the NO-OP transition, `from === to`. The control channel short-circuits above this function — the headless runtime's handler compares the modes itself and returns before calling the transition — so a redundant `setPermissionMode` never reaches this line. That short-circuit is the same fact that made `K0` a dead splice and got it dropped from the manifest. " +
      ORACLE_TRANSITION +
      " The oracle walks all thirty ordered mode pairs INCLUDING the six identity pairs, which is where this arm is graded.",
  },
  {
    branch: "mode-transition#transitionPermissionMode@5:T",
    reason:
      "leaving `auto` as the FROM mode. The mode walk enters and leaves five modes; `auto` is not one of them, because the walk was recorded before the wave measured that `auto` is settable at all. Named condition, and now a cheap one: one more leg on the walk. " +
      ORACLE_TRANSITION,
  },
  {
    branch: "mode-transition#transitionPermissionMode@7:T",
    reason:
      "ENTERING auto — the arm that STRIPS dangerous rules on the way in. Same uncreated condition as @5: the walk never visits `auto`. This is the arm the wave most wants a future walk to cover, because the strip and its restore are a matched pair and only the pair is safe. " +
      ORACLE_TRANSITION +
      " Both are graded there across the fixture's full mode cross-product with the gate driven on both settings.",
  },
  {
    branch: "mode-transition#transitionPermissionMode@8:T",
    reason:
      "the `nowAuto` term of that test — the arm that STRIPS dangerous rules on the way in. Same uncreated condition as @5: the walk never visits `auto`. This is the arm the wave most wants a future walk to cover, because the strip and its restore are a matched pair and only the pair is safe. " +
      ORACLE_TRANSITION +
      " Both are graded there across the fixture's full mode cross-product with the gate driven on both settings.",
  },
  {
    branch: "mode-transition#transitionPermissionMode@9:T",
    reason:
      "the auto gate DISABLED on the way in, downstream of the unvisited auto entry at @7. " +
      ORACLE_TRANSITION,
  },
  {
    branch: "mode-transition#transitionPermissionMode@9:F",
    reason:
      "it enabled, downstream of the unvisited auto entry at @7. " +
      ORACLE_TRANSITION,
  },
  {
    branch: "mode-transition#transitionPermissionMode@10:T",
    reason:
      "LEAVING auto — the arm that RESTORES the rules the entry stripped. Same uncreated condition. " +
      ORACLE_TRANSITION,
  },
  {
    branch: "mode-transition#transitionPermissionMode@11:T",
    reason:
      "the `wasAuto` term of that test — the arm that RESTORES the rules the entry stripped. Same uncreated condition. " +
      ORACLE_TRANSITION,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@5:F",
    reason:
      "the hook answering with NO updated input, so the raw input is carried forward. the corpus arms this hook twice — a rewrite and a deny — and both answer with a decision. Both recorded hooks rewrite or deny explicitly. Named condition: a hook that allows without touching the input. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@6:F",
    reason:
      "the same absence on the branch that decides whether to RE-CHECK the rewritten input. Its true arm is the whole reason `perm-hook-rewrite` exists; the false arm is a hook that changes nothing. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@7:F",
    reason:
      "the re-check raising NO objection — a hook rewrite onto an input the rules are happy with. The recorded rewrite lands on a path an ask rule names, which is what makes the re-check object; the quiet rewrite is one more scenario. Named condition. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@8:F",
    reason:
      "the objection being something other than an ask. Downstream of @7's objection, and needs the re-check to DENY rather than ask. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@9:F",
    reason:
      "the objection carrying no decisionReason of its own. Downstream of the same. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@10:T",
    reason:
      "the INTERACTION rung on the hook path. " +
      INTERACTION_TEXT +
      " The same corpus-scoped condition as the pre-check's own interaction rung. This is the full test. " +
      ORACLE_HOOKDEC +
      " The rung is graded there over a tool that requires interaction and one that does not, in both the satisfied and unsatisfied shapes.",
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@10:F",
    reason:
      "the INTERACTION rung on the hook path. " +
      INTERACTION_TEXT +
      " The same corpus-scoped condition as the pre-check's own interaction rung. This is the test failing as a whole. " +
      ORACLE_HOOKDEC +
      " The rung is graded there over a tool that requires interaction and one that does not, in both the satisfied and unsatisfied shapes.",
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@11:T",
    reason:
      "the INTERACTION rung on the hook path. " +
      INTERACTION_TEXT +
      " The same corpus-scoped condition as the pre-check's own interaction rung. This is its two-term prefix. " +
      ORACLE_HOOKDEC +
      " The rung is graded there over a tool that requires interaction and one that does not, in both the satisfied and unsatisfied shapes.",
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@11:F",
    reason:
      "the INTERACTION rung on the hook path. " +
      INTERACTION_TEXT +
      " The same corpus-scoped condition as the pre-check's own interaction rung. This is that prefix false. " +
      ORACLE_HOOKDEC +
      " The rung is graded there over a tool that requires interaction and one that does not, in both the satisfied and unsatisfied shapes.",
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@12:T",
    reason:
      "the INTERACTION rung on the hook path. " +
      INTERACTION_TEXT +
      " The same corpus-scoped condition as the pre-check's own interaction rung. This is the `interactionSatisfied` term. " +
      ORACLE_HOOKDEC +
      " The rung is graded there over a tool that requires interaction and one that does not, in both the satisfied and unsatisfied shapes.",
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@12:F",
    reason:
      "the INTERACTION rung on the hook path. " +
      INTERACTION_TEXT +
      " The same corpus-scoped condition as the pre-check's own interaction rung. This is that term false. " +
      ORACLE_HOOKDEC +
      " The rung is graded there over a tool that requires interaction and one that does not, in both the satisfied and unsatisfied shapes.",
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@13:T",
    reason:
      "the tool-level SUPPRESSION of permission updates. `suppressesAllPermissionUpdates` is implemented by a handful of tools and by none the corpus calls, so neither arm of the test can be created from a recording. This is the full conditional. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@13:F",
    reason:
      "the tool-level SUPPRESSION of permission updates. `suppressesAllPermissionUpdates` is implemented by a handful of tools and by none the corpus calls, so neither arm of the test can be created from a recording. This is it false. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@14:T",
    reason:
      "the tool-level SUPPRESSION of permission updates. `suppressesAllPermissionUpdates` is implemented by a handful of tools and by none the corpus calls, so neither arm of the test can be created from a recording. This is the null-check term. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@14:F",
    reason:
      "the tool-level SUPPRESSION of permission updates. `suppressesAllPermissionUpdates` is implemented by a handful of tools and by none the corpus calls, so neither arm of the test can be created from a recording. This is that term false. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@15:T",
    reason:
      "the `updatedPermissions ?? []` default — the nullish default on the suppressed branch. The corpus's hooks either send updates or omit the key, and the two branches this default sits on are split by the suppression test above, which no corpus tool triggers. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@15:F",
    reason:
      "the `updatedPermissions ?? []` default — its other arm. The corpus's hooks either send updates or omit the key, and the two branches this default sits on are split by the suppression test above, which no corpus tool triggers. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@16:T",
    reason:
      "the `updatedPermissions ?? []` default — the same default on the unsuppressed branch. The corpus's hooks either send updates or omit the key, and the two branches this default sits on are split by the suppression test above, which no corpus tool triggers. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@16:F",
    reason:
      "the `updatedPermissions ?? []` default — its other arm. The corpus's hooks either send updates or omit the key, and the two branches this default sits on are split by the suppression test above, which no corpus tool triggers. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@17:T",
    reason:
      "updates surviving the filter on the hook path. Downstream of the same suppression split. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@17:F",
    reason:
      "none surviving on the hook path. Downstream of the same suppression split. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "permission-request-hook-decision#permissionRequestHookDecision@18:F",
    reason:
      "the hook answering with NO message, so the module falls back to the built one. Both recorded hooks send a message. Named condition, and one line of a scenario. " +
      ORACLE_HOOKDEC,
  },
  {
    branch: "broker-response-map#brokerResponseMap@3:F",
    reason:
      "the host answering ALLOW with no updated input, so the raw input is carried. Every broker in this corpus echoes an input back — `permission-bag` deliberately rewrites one — so the empty case is the one no fixture creates. Named condition: a broker returning a bare allow. " +
      ORACLE_BROKERMAP +
      " The mapper is graded there over both shapes AND over the empty-object case, which is the one a naive `answer.updatedInput ?? input` would get wrong.",
  },
  {
    branch: "broker-response-map#brokerResponseMap@4:F",
    reason:
      "the `answer.updatedInput` term of that test being absent. Same condition. " +
      ORACLE_BROKERMAP,
  },
  {
    branch: "broker-response-map#brokerResponseMap@5:T",
    reason:
      "a deny that also INTERRUPTS the turn. `interrupt` is a field the SDK's host-side type does not expose, so an SDK host cannot set it — it is reachable only from the engine's own prompt surface. Structurally unreachable through the seam this project owns. " +
      ORACLE_BROKERMAP +
      " The interrupting deny is graded there because the field changes the turn's control flow, not just its message.",
  },
  {
    branch: "broker-response-map#brokerResponseMap@6:F",
    reason:
      "the behaviour term of that test on a non-deny answer. Downstream of the same unreachable field. " +
      ORACLE_BROKERMAP,
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@1:T",
    reason:
      "a REMOTE-EXECUTION context, which exempts the whole update filter. X6's env allowlist forbids a graded run from setting the variable that produces one. " +
      ORACLE_BROKERUPD +
      " The exemption is graded there on both context shapes, and the oracle asserts it short-circuits BEFORE the tool is consulted — which is the ordering a transcription can silently invert.",
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@2:T",
    reason:
      "a tool suppressing ALL permission updates. Same structural condition as the hook module's: no tool the corpus calls implements the hook. " +
      ORACLE_BROKERUPD,
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@5:T",
    reason:
      "some updates surviving the always-allow filter. The split above them is decided by `suppressesAlwaysAllowRule`, which no corpus tool implements, so both arms of the survivor test sit behind an uncreatable condition. " +
      ORACLE_BROKERUPD,
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@5:F",
    reason:
      "none surviving. The split above them is decided by `suppressesAlwaysAllowRule`, which no corpus tool implements, so both arms of the survivor test sit behind an uncreatable condition. " +
      ORACLE_BROKERUPD,
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@6:T",
    reason:
      "the always-allow strip firing. Needs a tool implementing `suppressesAlwaysAllowRule`, or a context the exemption covers. " +
      ORACLE_BROKERUPD +
      " This is the branch that decides whether a broker's `alwaysAllow` suggestion becomes a durable rule, so the oracle spends four cases on it.",
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@8:T",
    reason:
      "the tool-implemented disjunct of that strip. Same condition. " +
      ORACLE_BROKERUPD,
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@9:T",
    reason:
      "its null-check term. Same condition. " +
      ORACLE_BROKERUPD,
  },
  {
    branch: "permission-precheck#permissionPrecheck@47:T",
    reason:
      "the NON-BYPASS half of the safety floor: an ask that a safety check, a sandbox override or a plan-mode floor holds in place. All three disjuncts are conditions this corpus does not create — the safety check for the reason §3.3 of the matrix gives (creating one means running something genuinely dangerous, which should be designed rather than improvised), the sandbox override because sandboxing is off, and the plan-mode floor because the plan cells' tool calls are refused above this rung. " +
      ORACLE_PRECHECK +
      " The floor's asymmetry is the arm the oracle spends most of its pre-check cases on, because under bypass only a bypass-immune check holds and outside it any of the three does — an inversion no recording could see.",
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@30:T",
    reason:
      "the same safety floor in the rule-only checker, holding. Compounds two uncreated conditions: a safety check firing at all, and " +
      ONECALLER_TEXT +
      " " +
      ORACLE_RULECHECK,
  },
  {
    branch: "rule-based-permissions#checkRuleBasedPermissions@30:F",
    reason:
      "the same floor NOT holding, which is the ordinary path through it. Unreached for the second of those two reasons alone: " +
      ONECALLER_TEXT +
      " " +
      ORACLE_RULECHECK,
  },
  {
    branch: "broker-permission-updates#brokerPermissionUpdates@0:T",
    reason:
      "the whole exemption test — a remote-execution context OR an otherwise exempt one. X6's env allowlist forbids a graded run from producing the first, and the second is a context shape the headless broker seam does not construct. This is the branch that decides whether the update filter runs at all, so its true arm short-circuits everything below it. " +
      ORACLE_BROKERUPD,
  },

  // ---- W7 / C10: the control protocol's named handlers -------------------
  {
    branch: "thinking-config#resolveThinkingConfig@0:T",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: if 'requestedTokens == null', T arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@1:T",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: if 'currentExplicit', T arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@1:F",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: if 'currentExplicit', F arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@2:T",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: conditional 'currentExplicit.type !== \"disabled\"', T arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@2:F",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: conditional 'currentExplicit.type !== \"disabled\"', F arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@3:T",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: conditional 'display !== undefined && adaptiveThinkingAllowed()', T arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@3:F",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: conditional 'display !== undefined && adaptiveThinkingAllowed()', F arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@4:T",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: and 'display !== undefined', T arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@4:F",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: and 'display !== undefined', F arm.",
  },
  {
    branch: "thinking-config#resolveThinkingConfig@5:T",
    reason:
      W7_THINKING_CONFIG +
      " THIS ARM: if 'requestedTokens === 0', T arm.",
  },
  {
    branch: "permission-mode-setter#applyPermissionModeRequest@0:T",
    reason:
      W7_PERMISSION_MODE_SETTER +
      " THIS ARM: if '!guarded.ok', T arm.",
  },
  {
    branch: "permission-mode-setter#applyPermissionModeRequest@1:T",
    reason:
      W7_PERMISSION_MODE_SETTER +
      " THIS ARM: if 'context.mode === guarded.mode', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@1:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: and 'requested != null', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@2:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'request.system_prompt !== undefined', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@3:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'systemPrompt !== undefined && (typeof systemPrompt !== \"string\" || systemPrompt === \"\")', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@4:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: and 'systemPrompt !== undefined', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@5:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: or 'typeof systemPrompt !== \"string\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@5:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: or 'typeof systemPrompt !== \"string\"', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@6:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: conditional 'typeof systemPrompt !== \"string\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@6:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: conditional 'typeof systemPrompt !== \"string\"', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@7:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'requested', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@8:taken",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: clause '\"unrecognized\"', taken arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@9:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'typeof systemPrompt === \"string\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@9:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'typeof systemPrompt === \"string\"', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@10:taken",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: clause '\"blocked\"', taken arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@11:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'typeof systemPrompt === \"string\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@11:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'typeof systemPrompt === \"string\"', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@12:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'source', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@12:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'source', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@13:taken",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: clause '\"default\"', taken arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@15:taken",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: clause '\"steppedDown\"', taken arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@16:taken",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: clause 'default: break;', taken arm.",
  },
  {
    branch: "model-switch#readState@0:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'state.mainLoopModel ?? surface.getActiveModel()', F arm.",
  },
  {
    branch: "model-switch#readState@1:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'state.mainLoopModel', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@17:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: conditional 'classified.kind === \"default\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@18:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'consult.decision !== \"proceed\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@19:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'typeof systemPrompt === \"string\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@19:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'typeof systemPrompt === \"string\"', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@20:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if '(activeMainLoopModel() !== before || parseModel(applied) !== parseModel(previous ?? before', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@21:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: and '(activeMainLoopModel() !== before || parseModel(applied) !== parseModel(previous ?? before', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@22:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: or 'activeMainLoopModel() !== before', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@23:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'previous', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@23:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'previous', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@24:F",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: nullish 'previous', F arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@25:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'steppedDown !== null', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@26:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: if 'typeof systemPrompt === \"string\"', T arm.",
  },
  {
    branch: "model-switch#applyModelSwitchRequest@27:T",
    reason:
      W7_MODEL_SWITCH +
      " THIS ARM: conditional 'consult.messages.length > 0', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@0:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: or 'settings()?.outputStyle', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@1:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: optional 'settings()', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@2:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: conditional 'isVsCodeEntrypoint() && autoDefaultNudgeEligible()', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@3:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'isVsCodeEntrypoint()', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@4:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'unavailableModels.length > 0', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@5:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: optional 'account', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@6:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: optional 'account', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@7:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: optional 'account', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@8:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: optional 'account', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@9:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: optional 'account', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@10:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'isVsCodeEntrypoint()', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@11:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'modeIsDefaultFallback()', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@11:F",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'modeIsDefaultFallback()', F arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@12:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'nudge', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@12:F",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'nudge', F arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@13:F",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and '!remoteControlSuppressed()', F arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@14:F",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: nullish 'preference', F arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@15:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: and 'autoEnable', T arm.",
  },
  {
    branch: "initialize-payload#buildInitializeResponsePayload@17:T",
    reason:
      W7_INITIALIZE_PAYLOAD +
      " THIS ARM: nullish 'fastModeDisabledReason(fastModeInput ?? null)', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@0:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'isReinitialize', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@1:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'hostHooks', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@1:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'hostHooks', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@2:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: conditional 'request.hooks', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@2:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: conditional 'request.hooks', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@5:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.supportedDialogKinds !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@6:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: conditional 'isRestartedWorkerEpoch(env.CLAUDE_CODE_WORKER_EPOCH)', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@6:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: conditional 'isRestartedWorkerEpoch(env.CLAUDE_CODE_WORKER_EPOCH)', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@7:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.perTaskStopAffordance === true', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@9:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.planModeInstructions !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@10:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.appendSubagentSystemPrompt !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@11:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.toolAliases !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@12:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.excludeDynamicSections !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@13:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.promptSuggestions !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@14:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.forwardSubagentText !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@15:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.skills !== undefined', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@16:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.agents', T arm.",
  },
  {
    branch: "initialize-handler#agentList@0:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: conditional 'mergedStdinAgents', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@17:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'options.agent', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@18:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'definition && !alreadyActive', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@18:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'definition && !alreadyActive', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@19:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and 'definition', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@19:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and 'definition', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@20:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if '!options.systemPrompt && !isBuiltInAgent(definition)', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@20:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if '!options.systemPrompt && !isBuiltInAgent(definition)', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@21:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and '!options.systemPrompt', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@21:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and '!options.systemPrompt', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@22:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'prompt', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@22:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'prompt', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@23:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if '!options.userSpecifiedModel && definition.model && definition.model !== \"inherit\"', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@23:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if '!options.userSpecifiedModel && definition.model && definition.model !== \"inherit\"', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@24:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and '!options.userSpecifiedModel && definition.model', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@24:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and '!options.userSpecifiedModel && definition.model', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@25:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and '!options.userSpecifiedModel', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@25:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: and '!options.userSpecifiedModel', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@26:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'isExemptModelPick(parsed) || isModelAllowed(parsed)', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@26:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'isExemptModelPick(parsed) || isModelAllowed(parsed)', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@27:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: or 'isExemptModelPick(parsed)', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@27:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: or 'isExemptModelPick(parsed)', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@28:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'definition.initialPrompt', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@28:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'definition.initialPrompt', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@29:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'definition?.initialPrompt', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@29:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'definition?.initialPrompt', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@30:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: optional 'definition', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@30:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: optional 'definition', F arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@32:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'request.jsonSchema', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@34:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'enableAuthStatus', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@35:T",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'status', T arm.",
  },
  {
    branch: "initialize-handler#handleInitialize@35:F",
    reason:
      W7_INITIALIZE_HANDLER +
      " THIS ARM: if 'status', F arm.",
  },
];
