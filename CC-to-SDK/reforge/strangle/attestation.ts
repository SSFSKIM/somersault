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
}

export const ATTESTED: AttestedModule[] = [
  { module: "glob-description", row: "glob-description (S-chunk)", scenarios: ["search-tools", "search-tools-lean"] },
  { module: "read-description", row: "read-description", scenarios: ["plain", "api-error"] },
  { module: "grep-description", row: "grep-description", scenarios: ["search-tools", "search-tools-lean"] },
  { module: "webfetch-description", row: "webfetch-description", scenarios: ["plain", "api-error"] },
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
];
