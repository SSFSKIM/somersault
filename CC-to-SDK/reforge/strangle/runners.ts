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
};

/** The argv (after `npx tsx`) that grades one coverage tag against `engineB`. */
export function runnerFor(tag: string, engineB: string): string[] {
  const suite = NON_CORPUS[tag];
  return suite ? [...suite, "--engineB", engineB] : ["m1/run.ts", "--scenario", tag, "--engineB", engineB];
}

/** True when the tag is graded by a suite of its own rather than by the corpus. */
export const isNonCorpusTag = (tag: string): boolean => tag in NON_CORPUS;
