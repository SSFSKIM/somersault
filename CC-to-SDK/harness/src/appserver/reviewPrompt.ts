// appserver/reviewPrompt.ts — target descriptor → the English prompt that drives a review turn.
//
// THE MODEL FETCHES ITS OWN SUBJECT. Codex never computes or injects a diff (prompts/src/review_request.rs);
// it names the target and lets the reviewing agent run git through its own shell tool, and probe 109
// confirmed the same shape works for us (the model reached for `Bash` and `Read` unprompted). So this
// builds a PROMPT, not a payload — which is why a review needs no server-owned diff seam (D-M4-3).
//
// THIS PROMPT CARRIES THE WHOLE REVIEW, which is where we differ from Codex in substance rather than
// vocabulary. Codex splices a 95-line rubric in as the review thread's SYSTEM prompt and leaves the target
// prompt a single sentence; our review is an ORDINARY turn on a detached thread (spec §mechanism), so the
// standard has to travel in the user message or it does not travel at all. Hence three shared sections —
// how to find the subject, what clears the bar for a finding, how to report — around one variant-specific
// scope line. Kept to what changes a reviewer's behavior: a rubric long enough to dilute the instruction
// would cost more than it buys.
//
// The one thing the prompt must not leave to chance is the OUTPUT CHANNEL: `ReportFindings` is a native
// SDK tool whose input IS the findings array (`file`/`line`/`summary`/`failure_scenario`/`category`,
// sdk-tools.d.ts:771-814), and probe 109 showed a plain instruction is enough to make the model call it.
// Every variant therefore ends with the same deliverable paragraph, naming the fields the harvester reads.
import type { ReviewTarget } from "./schema/review.js";

/** Named once so the four variants cannot drift apart, and so a test can assert the contract in one place. */
const DELIVERABLE =
  "HOW TO REPORT\n" +
  "Report through the ReportFindings tool — that tool call is the deliverable, not prose, and a finding " +
  "written only in prose is lost. Give each finding a repo-relative `file`, the 1-indexed `line` it anchors " +
  "to, a one-sentence `summary` of what is wrong, and a `failure_scenario` naming the concrete inputs or " +
  "state and the wrong output, crash, or corruption they produce — a scenario that merely restates the " +
  "summary is not one. Order findings most severe first. If nothing clears the bar, call ReportFindings " +
  "with an empty findings array: do not skip the call, and do not promote a non-issue to fill it.";

/** Applies to every variant: the target names WHAT to review, this names what is worth reporting about it. */
const STANDARD =
  "WHAT COUNTS AS A FINDING\n" +
  "Defects in the code under review: wrong results, crashes, unhandled failure paths, data loss, races and " +
  "ordering bugs, leaked resources or handles, misused APIs and broken contracts, security exposure, and " +
  "tests that assert the wrong thing or cannot fail. A finding must be discrete, actionable, and something " +
  "the author would fix once told about it. Where the target is a change, that means defects the change " +
  "introduces — not pre-existing ones it merely sits near. Leave out style preferences, speculative " +
  "refactors, and issues outside the target named above. Review only — do not edit, fix, or commit anything.";

/** A diff is a pointer into the tree, not the evidence; a reviewer that never leaves it misses every caller. */
const READ_BEYOND_THE_STARTING_POINT =
  "Start there, but do not stop there: read enough of the surrounding code to judge correctness rather than " +
  "plausibility — the callers, the definitions the code relies on, and the tests that cover it.";

export function buildReviewPrompt(target: ReviewTarget, resolved?: { range?: string }): string {
  const [scope, howToFind] = scopeAndMethod(target, resolved);
  return `${scope}\n\nHOW TO FIND THE SUBJECT\n${howToFind} ${READ_BEYOND_THE_STARTING_POINT}\n\n${STANDARD}\n\n${DELIVERABLE}`;
}

/** The only variant-specific text: what is being reviewed, and the git that puts it in front of the model. */
function scopeAndMethod(target: ReviewTarget, resolved?: { range?: string }): [scope: string, howToFind: string] {
  switch (target.type) {
    case "uncommittedChanges":
      return [
        "Review the uncommitted changes in this repository's working tree — staged, unstaged, and untracked files.",
        "Run `git status --short` for the file list, `git diff` for unstaged edits and `git diff --staged` for " +
          "staged ones, and read any untracked file directly.",
      ];
    case "baseBranch":
      // The resolved merge-base range when the host could compute one (Task 3). Without it the model has to
      // resolve the base itself, and the instruction has to say merge-base out loud — diffing against the
      // TIP of a base branch that has moved on reports other people's commits as this branch's defects.
      return resolved?.range
        ? [
            `Review the changes in the commit range ${resolved.range} — what this branch adds on top of its merge-base with ${target.branch}.`,
            `Run \`git diff ${resolved.range}\` for the change and \`git log --oneline ${resolved.range}\` for the commits it spans.`,
          ]
        : [
            `Review the changes on this branch relative to its merge-base with ${target.branch} — what would be merged into ${target.branch}, not the whole history of either branch.`,
            `The merge-base was not resolved for you, so compute it first: \`git merge-base HEAD ${target.branch}\` ` +
              `(if that fails, try the branch's upstream, \`git rev-parse --abbrev-ref ${target.branch}@{upstream}\`), then ` +
              "run `git diff <merge-base>..HEAD`. Do not diff against the tip of the base branch.",
          ];
    case "commit":
      return [
        `Review the changes introduced by commit ${target.sha}${target.title ? ` ("${target.title}")` : ""}.`,
        `Run \`git show ${target.sha}\` for the change, and \`git log -1 ${target.sha}\` for its message.`,
      ];
    case "custom":
      // Verbatim (trimmed of surrounding whitespace, as Codex does): the caller wrote the scope, and any
      // rewriting here would silently override the one variant that exists to say something we did not.
      return [
        target.instructions.trim(),
        "Locate the code those instructions name yourself — `git`, `rg` and other read-only commands through " +
          "Bash, and Read for the files themselves.",
      ];
  }
}
