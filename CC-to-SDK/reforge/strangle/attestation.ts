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
      "strangle/prompt-parity.test.ts re-extracts the same constant and compares it again. A differential red could only ever see the prompt a scenario happened to send.",
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
];
