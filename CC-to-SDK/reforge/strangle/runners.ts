// Which SUITE grades a coverage tag.
//
// Almost every tag is a corpus scenario and `m1/run.ts` runs it. One is not, and
// the reason is structural rather than a naming accident: the control protocol
// cannot be graded through the corpus at all, because `sdk.mjs` CONSUMES control
// responses. An initialize answer, a validation refusal and an
// unsupported-subtype error never reach any surface an SDK-driven scenario can
// see, so W7's splices name `m2/raw-protocol.ts` — the no-wrapper driver — as
// their covering suite instead.
//
// Two consumers share this so they cannot disagree: the gate's liveness loop
// (which needs the runner's own verdict line to call a phase RED) and the
// coverage attestation (which replays covering scenarios against an instrumented
// build). A tag routed one way in one place and the other way in the other would
// mean a splice graded live by a suite whose branches nothing attested.
//
// The suites both print `PASS  <tag>` / `FAIL  <tag>` for their tag, which is
// what makes a verdict readable without parsing exit codes — C9's tightened
// liveness rule turns a bare non-zero exit into INCONCLUSIVE rather than RED.

/** Tags graded by something other than the corpus runner, and by what. */
const NON_CORPUS: Record<string, string[]> = {
  "raw-protocol": ["m2/raw-protocol.ts"],
  // C16b / W13b. Also structural rather than incidental: the stimulus is an OS
  // signal to the engine process, and the corpus runner drives through
  // `sdk.mjs`, which owns the spawn and exposes no pid. A scenario cannot ask
  // for a signal it has no way to send, so the lane that CAN send one grades it.
  // Three tags, one driver and one cassette: the signal chooses which of the
  // engine's three shutdown handlers answers, which exit status it picks, and
  // — for the latch — whether anything can observe it at all (w13/signals.ts).
  "sigterm-mid-turn": ["w13/signals.ts", "--plan", "sigterm-mid-turn"],
  "sighup-mid-turn": ["w13/signals.ts", "--plan", "sighup-mid-turn"],
  "sigint-mid-turn": ["w13/signals.ts", "--plan", "sigint-mid-turn"],
};

/** The argv (after `npx tsx`) that grades one coverage tag against `engineB`. */
export function runnerFor(tag: string, engineB: string): string[] {
  const suite = NON_CORPUS[tag];
  return suite ? [...suite, "--engineB", engineB] : ["m1/run.ts", "--scenario", tag, "--engineB", engineB];
}

/**
 * What one replay of one tag proved, on the THREE-OUTCOME rule this campaign was
 * corrected into (C9): a runner that crashed, was killed, or graded nothing is
 * INCONCLUSIVE, not evidence. `status !== 0` used to mean RED on its own, and a
 * dead splice was passing on exactly that.
 *
 * Pure, and separate from the spawning, because the gate now reads it in TWO
 * directions and both need driving on synthetic output. A LIVE row requires RED
 * — sabotage it and its coverage must break. A DARK row requires GREEN —
 * sabotage it and nothing must move, because "no scenario observes this" is a
 * claim that can only be re-measured by observing.
 */
export type ReplayOutcome = "red" | "green" | "inconclusive";

export function classifyReplay(tag: string, out: string, timedOut: boolean, status: number | null): { outcome: ReplayOutcome; note: string } {
  // ORDER MATTERS, and it resolves toward STRICTNESS. A GRADED VERDICT WINS OVER
  // A TIMEOUT. The two can both be true — the runner can print its verdict for
  // this tag and then hang on teardown — and reading the timeout first would
  // turn "the sabotaged engine still PASSED this scenario", which is the exact
  // dead-code finding the liveness loop exists to catch, into a RED that passes
  // the phase. The timeout is only ever a PROXY for divergence; the verdict line
  // is the measurement itself.
  if (out.includes(`FAIL  ${tag}`)) return { outcome: "red", note: "" };
  if (out.includes(`PASS  ${tag}`)) return { outcome: "green", note: "" };
  if (timedOut) return { outcome: "red", note: "graded nothing and did not finish, which the faithful build replays in seconds" };
  return { outcome: "inconclusive", note: `the runner produced no verdict (exit ${status})` };
}

/**
 * The DARK direction's verdict over a population.
 *
 * A dark row's `darkOver` names the scenarios its adjudication was measured
 * over. Every one of them must come back GREEN under the row's own sabotage: a
 * RED means the corpus now reaches the target and the written reason is stale,
 * which has to fail the gate loudly rather than keep passing on prose nobody
 * re-ran. An INCONCLUSIVE fails for the same reason it does in the live
 * direction — "we could not measure it" is not a measurement.
 */
export function darkVerdict(label: string, seen: readonly { tag: string; outcome: ReplayOutcome; note: string }[]): { stillDark: boolean; lines: string[] } {
  const lines = seen.map(({ tag, outcome, note }) => {
    if (outcome === "green") return `${tag}: GREEN (as required) — the twin changed nothing this scenario can see`;
    if (outcome === "red") return `${tag}: RED — NO LONGER DARK. The corpus now reaches ${label}; the darkReason is stale and the row needs coverage instead${note ? ` (${note})` : ""}`;
    return `${tag}: INCONCLUSIVE — ${note}; a run that graded nothing cannot re-measure darkness`;
  });
  return { stillDark: seen.length > 0 && seen.every((s) => s.outcome === "green"), lines };
}
