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
const ORACLE_UPE =
  "strangle/hooks-parity.test.ts grades it: the UserPromptExpansion block runs six cases across both guard keys and the refusal, compares the executor request and the port trace, and holds seven controls on them.";

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
  //      upstream's from/up_to variant (`hRt`), which no corpus scenario drives
  //      and which no wave owns yet. Recorded as a DEFERRAL, not an
  //      impossibility — see the ledger note for whose debt it is.
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
      "`user_context` present. MEASURED at the call sites: of upstream's three, the two the corpus drives call the constructor with THREE arguments, so `userContext` is undefined even for `/compact <instructions>` — only the from/up_to SEGMENT variant passes it (five arguments). No scenario drives a segment compaction and no wave owns that path yet; recorded as a deferral rather than an impossibility. Graded by compaction-parity.test.ts ('everything').",
  },
  {
    branch: "compact-boundary-wire#compactBoundaryWire@4:T",
    reason: "`messages_summarized` present; the same five-argument segment call site, the same deferral, the same oracle.",
  },
  {
    branch: "compact-continuation#compactContinuation@6:F",
    reason:
      "follow-up questions NOT suppressed. Two of the three upstream call sites pass `true` and the third passes a variable that is true on the paths the corpus drives; the only literal `false` is the segment variant's. Same deferral. Graded by compaction-parity.test.ts, which drives all nine option sets and specifically controls the early return ('the suppress arm falling through instead of returning').",
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
    branch: "auto-compact-trigger#autoCompactTrigger@3:T",
    reason:
      "the unconfigured-window refusal. MEASURED for the corpus's model, from the engine's own debug line: the window source is `model-default`, so the predicate passes this guard on every headless run — which is also why the auto-compaction scenario is recordable at all. Graded by compaction-parity.test.ts ('surface open but window unconfigured').",
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
];
