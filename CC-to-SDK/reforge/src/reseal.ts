// H1 — RE-SEALING a cassette's precondition sidecar: proving, by replay, that a
// changed declaration is the same experiment.
//
// THE PROBLEM THIS SOLVES. C12a/F4 made the precondition part of the recording:
// beside every cassette sits the declaration it was recorded against and a hash
// of the baseline seed applied under it, and a declaration that drifts from the
// sidecar is a FINDING with the recorded one replayed. That rule is right — a
// cassette answers the requests an engine made against a particular filesystem,
// and replaying it against a different one is a different experiment wearing the
// same name. Its cost is that EVERY declaration change forces a live re-record,
// including changes that provably cannot reach the model: an inert extra seed
// file, a renamed fixture, and above all a change to the baseline seed itself,
// which drifts all 63 sidecars at once. Live takes are throttle-bound — C12a's
// single re-record of `store-read-only` took five attempts over four hours — so
// "re-record everything" is not a plan, it is a reason to leave the sidecar
// stale and grade the wrong world.
//
// THE EVIDENCE. The replay proxy already measures exactly what "the cassette is
// still the cassette" means, and measures it per request rather than by
// judgment:
//   - `unmatched()`   — the engine asked something no entry answers;
//   - `fallbackServed()` — an entry answered only POSITIONALLY, i.e. the request
//                       was at the right place in the stream but its canonical
//                       body differed;
//   - `unserved()`    — an entry the engine never asked for.
// A replay of the NEW declaration on the engine that RECORDED the cassette,
// clean on all three, is a measurement that the request stream is byte-identical
// to the recorded one. That is strictly stronger than the reasoning a human
// would otherwise do in the commit message ("this seed can't reach the model"),
// and it is the same shape as the rest of this harness: the negative is only
// evidence because the healthy case would differ, and the controls in
// `src/reseal.test.ts` show a declaration that DOES reach the model being
// refused by name.
//
// ENGINE-REAL, always. The request stream the cassette answered is that engine's;
// replaying the declaration on a strangled or reimplemented build would fold two
// questions ("did the filesystem change the stream?" and "does this build make
// the same stream?") into one answer that cannot say which it measured.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalizeForHash } from "./canonical.js";
import { ENGINE_VERSION } from "./pin.js";
import { baselineSeedHash, declarationSha256, type ConfigPrecondition, type RecordedPrecondition, type Scenario } from "./harness.js";
import { firstCanonicalDifference } from "./proxy.js";
import { runScenarioOnce } from "./runScenario.js";

export interface ResealResult {
  resealed: boolean;
  /** on a refusal: the FIRST failing signal, with enough in it to act on */
  reason?: string;
  /** on a re-seal: what was written */
  written?: RecordedPrecondition;
}

/**
 * ~200 bytes of a request body in the form the MATCHER compares — which is also
 * the form with the credentials, clocks and ids already scrubbed out of it, so a
 * refusal can be printed into a gate log without printing a secret.
 */
const bodyExcerpt = (body: string): string => canonicalizeForHash(body).slice(0, 200);

/**
 * Replay `scenario` against `cassette` under the DECLARED precondition and, if
 * every signal is clean, rewrite `sidecar` to seal that declaration.
 *
 * Takes its paths as parameters so the controls can drive it against a COPY of a
 * real cassette in a temp directory. A mechanism that can only be exercised on
 * the corpus is a mechanism whose failure modes are only ever discovered on the
 * corpus.
 */
export async function resealScenario(opts: {
  scenario: Scenario;
  declared: ConfigPrecondition;
  cassette: string;
  sidecar: string;
  engineVersion?: string;
}): Promise<ResealResult> {
  const { scenario, declared, cassette, sidecar } = opts;
  const engineVersion = opts.engineVersion ?? ENGINE_VERSION;
  if (!existsSync(cassette)) return { resealed: false, reason: `there is no cassette at ${cassette} to re-seal against` };

  const previous: RecordedPrecondition | undefined = existsSync(sidecar)
    ? (JSON.parse(readFileSync(sidecar, "utf8")) as RecordedPrecondition)
    : undefined;

  const run = await runScenarioOnce({
    scenario,
    engineName: "engine-real",
    mode: "replay",
    cassette,
    side: "reseal",
    precondition: declared,
    // The oracle replaying its own recording: a positional fallback here is the
    // signal this function exists to read, and it is read explicitly below
    // rather than through the §3.4 verdict, which grades a DIFFERENT engine's
    // right to one.
    engineB: "engine-real",
  });

  // FIVE SIGNALS, IN ORDER, and the first failure is the reason. They are
  // ordered from the most specific to the most general: a refusal that says
  // "this request, at this byte" is actionable, and one that says "the run did
  // not hold" is only the last resort.
  const first = run.unmatched[0];
  if (first !== undefined) {
    return {
      resealed: false,
      reason:
        `${run.unmatched.length} request(s) matched NO cassette entry under this declaration — the first is ` +
        `${first.method} ${first.path}: ${bodyExcerpt(first.requestBody)}`,
    };
  }
  const fb = run.fallbacks[0];
  if (fb !== undefined) {
    const { offset, near } = firstCanonicalDifference(fb.requestBody, fb.entryRequestBody);
    // OFFSET -1 IS A DIFFERENT DIAGNOSIS, not a missing one. The match hash is
    // taken over method, path and the canonical body, so a request whose
    // canonical body EQUALS the entry's would have matched exactly — unless
    // that entry was already consumed, which means the engine sent the same
    // request more times than the recording did.
    const where =
      offset < 0
        ? "whose canonical body is IDENTICAL to it, so the entry that would have matched was already consumed — the engine repeated a request the recording made once"
        : `whose canonical body first differs at byte ${offset} (${near})`;
    return {
      resealed: false,
      reason:
        `${run.fallbacks.length} request(s) were answered only POSITIONALLY under this declaration — the first is ` +
        `${fb.method} ${fb.path}, served entry seq ${fb.seq}, ${where}. ` +
        `Replayed body: ${bodyExcerpt(fb.requestBody)}`,
    };
  }
  // REPEAT ENTRIES ARE EXCLUDED FROM THE COVERAGE HALF, and only from it. A
  // repeat entry answers a RETRY loop (`src/faults.ts` derives one for every
  // injected fault), so how many times it is served — including zero, when the
  // engine's attempt schedule differs — is the engine's choice rather than a
  // fact the cassette fixes. Every non-repeat entry is one-to-one with a request
  // that was made, so an unserved one means the engine stopped asking: fewer
  // requests than the recording, which is the drift this half is here to catch.
  const unserved = run.unserved.filter((e) => !e.repeat);
  if (unserved.length > 0) {
    return {
      resealed: false,
      reason:
        `${unserved.length} cassette entr(ies) were never requested under this declaration (seq ` +
        `${unserved.map((e) => e.seq).join(", ")}) — the engine made FEWER requests than the recording`,
    };
  }
  const failure = scenario.check ? scenario.check(run.messages, run.events) : null;
  if (failure !== null) {
    return { resealed: false, reason: `the scenario's own substance check failed under this declaration: ${failure}` };
  }
  if (!run.ok) {
    return { resealed: false, reason: "the replay did not hold (quiesce, gate-cache or fallback verdict) — see the WARN/FAIL lines above" };
  }

  const written: RecordedPrecondition = {
    declared,
    baselineSha256: baselineSeedHash(engineVersion),
    // C13c/W10c — the detachment declaration is part of the world the sidecar
    // records, so a re-seal that dropped it would REINTRODUCE the drift it
    // exists to remove: the runner compares `recorded.detached` against the
    // scenario's, and a scenario declaring `[]` against a sidecar declaring
    // nothing is a difference. Written from the SCENARIO, like the config
    // declaration beside it, because a re-seal seals what the scenario says
    // today — that is the whole mechanism.
    ...(scenario.detachedChildren !== undefined ? { detached: [...scenario.detachedChildren] } : {}),
    ...(previous === undefined
      ? {}
      : {
          resealedFrom: {
            declaredSha256: declarationSha256(previous.declared),
            // A pre-F4 predecessor recorded no baseline; the absence is the fact.
            ...(typeof previous.baselineSha256 === "string" ? { baselineSha256: previous.baselineSha256 } : {}),
          },
        }),
  };
  writeFileSync(sidecar, JSON.stringify(written, null, 2) + "\n");
  return { resealed: true, written };
}
