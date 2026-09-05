// M1 corpus runner — for every scenario: ensure a cassette exists (recorded
// live once through engine-real), then replay it OFFLINE into engine-real (A)
// and engine-extracted (B) and diff three behavioral surfaces:
//   1. SDK message transcripts   2. harness-side events (hooks/permission consults)
//   3. the API requests each engine emitted
//   4. engine STATE — the sandbox filesystem tree with content hashes, plus how
//      the engine process ended (src/state.ts; §3.2's cheap subset)
// On the identical-code pair every diff is a harness/normalization defect; once
// engine-ts exists, every diff is a reimplementation defect.
//
// Run:  cd reforge && set -a; . ../.env; set +a; npx tsx m1/run.ts [--scenario <tag>] [--rerecord]
//       npx tsx m1/run.ts --reseal [--scenario <tag>]   # H1: re-seal drifted sidecars, offline
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, makeRunNormalizer, normalizeValue, type DiffFinding } from "../src/differ.js";
import { runScenarioOnce, type ScenarioRun } from "../src/runScenario.js";
import { resealScenario } from "../src/reseal.js";
import { baselineSeedHash, EMPTY_PRECONDITION, type ConfigPrecondition, type RecordedPrecondition, type Scenario } from "../src/harness.js";
import { ENGINE_VERSION } from "../src/pin.js";
import { recordCassette } from "../src/record.js";
import { scrubRequestBody } from "../src/canonical.js";
import { REFORGE_ROOT, saveTranscript } from "../src/runTurn.js";
import { entriesOf } from "../src/state.js";
import { requireRecordCredential } from "../src/env.js";
import { M2C_SCENARIOS } from "../m2c/scenarios.js";
import { M3_SCENARIOS } from "../m3/scenarios.js";
import { W1_SCENARIOS } from "../w1/scenarios.js";
import { W2_SCENARIOS } from "../w2/scenarios.js";
import { W3_SCENARIOS } from "../w3/scenarios.js";
import { W4_SCENARIOS } from "../w4/scenarios.js";
import { W5_SCENARIOS } from "../w5/scenarios.js";
import { W6_SCENARIOS } from "../w6/scenarios.js";
import { W9_SCENARIOS } from "../w9/scenarios.js";
import { SCENARIOS as M1_SCENARIOS } from "./scenarios.js";

const SCENARIOS = [...M1_SCENARIOS, ...M2C_SCENARIOS, ...M3_SCENARIOS, ...W1_SCENARIOS, ...W2_SCENARIOS, ...W3_SCENARIOS, ...W4_SCENARIOS, ...W5_SCENARIOS, ...W6_SCENARIOS, ...W9_SCENARIOS];

const args = process.argv.slice(2);
// `--scenario` with no value used to leave `only` undefined, which silently ran
// the ENTIRE corpus instead of the one scenario the caller asked for. Treat a
// missing or flag-shaped value as an error, not as "no filter".
const scenarioIdx = args.indexOf("--scenario");
const scenarioArg = scenarioIdx >= 0 ? args[scenarioIdx + 1] : undefined;
if (scenarioIdx >= 0 && (scenarioArg === undefined || scenarioArg.startsWith("--"))) {
  console.error("ABORT: --scenario requires a value.");
  process.exit(2);
}
const only = scenarioArg;
// …AND VALIDATED HERE, before any mode reads it. This check used to sit below
// the `--reseal` block, which meant `--reseal --scenario <typo>` selected no
// scenarios, refused none, and printed RESEAL OK — a green verdict over an empty
// set, which is the same vacuity `[].every(...)` gave the grading path before
// this check existed. A filter that names nothing is a typo, in every mode.
if (only !== undefined && !SCENARIOS.some((s) => s.tag === only)) {
  console.error(`ABORT: unknown scenario '${only}'. Known tags:\n  ${SCENARIOS.map((s) => s.tag).join(", ")}`);
  process.exit(2);
}
const rerecord = args.includes("--rerecord");
// H1 — re-seal instead of grade: prove by replay that the DECLARED precondition
// is the world this cassette already answers, and rewrite the sidecar if it is.
const reseal = args.includes("--reseal");
// engine under test (side B). A is always engine-real, the oracle.
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";

// Only RECORDING needs a credential. Replays are served offline by the proxy
// under a non-secret placeholder, so an unauthenticated operator can still grade
// the whole corpus — which is the property that makes the replay lane free.
const willRecord = !reseal && (rerecord || SCENARIOS.some((s) => (only ? s.tag === only : true) && !existsSync(join(REFORGE_ROOT, "cassettes", `m1-${s.tag}.jsonl`))));
if (willRecord) requireRecordCredential();
mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });

/**
 * One graded run, THROUGH THE SHARED DEFINITION (`src/runScenario.ts`). The
 * body used to live here; H1's re-seal needs the identical run — same quiesce,
 * same gate-cache check, same fallback verdict — so it moved rather than being
 * copied. `engineB` is bound here because it is this runner's argument.
 */
const runOnce = (s: Scenario, engineName: string, mode: "record" | "replay", cassette: string, side: string, precondition: ConfigPrecondition): Promise<ScenarioRun> =>
  runScenarioOnce({ scenario: s, engineName, mode, cassette, side, precondition, engineB });

function loadObservedRequests(file: string): unknown[] {
  if (!existsSync(file)) return [];
  const reqs = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r: { method: string; path: string; requestBody: string }) => ({
      method: r.method,
      path: r.path,
      body: normalizeValue(JSON.parse(scrubRequestBody(r.requestBody) || "null")),
    }));
  // Same lane rule the transcript normalizer applies: a backgrounded subagent's
  // API calls race the parent's, so their interleaving is not a contract while
  // each lane's own order is. The engine marks subagent traffic in its billing
  // header. Stable-partition, then concatenate.
  const isSubagent = (r: unknown) => JSON.stringify(r).includes("cc_is_subagent=true");
  const parent = reqs.filter((r) => !isSubagent(r));
  const sub = reqs.filter(isSubagent);
  return sub.length > 0 ? [...parent, ...sub] : reqs;
}

/**
 * Paths where the ORACLE disagreed with itself, mapped to the values it actually
 * produced there. A per-surface map, never shared across surfaces: transcripts,
 * events and requests all use `msg[i]…` path syntax, so one merged set would let
 * a request-side path excuse a transcript-side difference.
 */
type OracleVariance = Map<string, unknown[]>;

const varianceOf = (findings: DiffFinding[]): OracleVariance => {
  const m: OracleVariance = new Map();
  for (const f of findings) m.set(f.path, [f.a, f.b]);
  return m;
};

/**
 * Is this A-vs-B difference explained by the oracle's own nondeterminism?
 * Only if B produced one of the values the ORACLE was observed to produce at
 * that path. Excusing every value at a variable path would let an engine emit a
 * third, invalid value (e.g. a tool_result the oracle never returns) and still
 * be reported identical.
 */
const withinOracleVariance = (f: DiffFinding, v?: OracleVariance): boolean => {
  const alts = v?.get(f.path);
  if (!alts) return false;
  const b = JSON.stringify(f.b);
  return alts.some((alt) => JSON.stringify(alt) === b);
};

function report(label: string, findings: DiffFinding[], variance?: OracleVariance): boolean {
  if (findings.length === 0) {
    console.log(`    ${label}: identical`);
    return true;
  }
  const genuine = findings.filter((f) => !withinOracleVariance(f, variance));
  const flaky = findings.length - genuine.length;
  const note = flaky > 0 ? ` (${flaky} attributed to oracle nondeterminism)` : "";
  if (genuine.length === 0) {
    console.log(`    ${label}: identical modulo ${flaky} nondeterministic path(s)`);
    return true;
  }
  console.log(`    ${label}: ${genuine.length} difference(s)${note}`);
  for (const f of genuine.slice(0, 10)) {
    console.log(`      ${f.path}: ${JSON.stringify(f.a)?.slice(0, 100)}  !=  ${JSON.stringify(f.b)?.slice(0, 100)}`);
  }
  return false;
}

/**
 * Failure triage. A diff between A and B means "the engines differ" ONLY if the
 * oracle is deterministic on this scenario. Measured counter-example: parallel
 * tool execution returns tool_result blocks in COMPLETION order, so two runs of
 * the same engine disagree. Without this, such scenarios produce a flaky gate
 * and — worse — teach you to ignore red.
 *
 * So on any diff, replay the ORACLE a second time and collect the paths where it
 * disagrees with itself. Those paths are nondeterministic and not attributable
 * to the engine under test.
 */
async function oracleVariance(
  s: Scenario,
  cassette: string,
  a: ScenarioRun,
  applied: ConfigPrecondition,
): Promise<{ transcripts: OracleVariance; events: OracleVariance; requests: OracleVariance; state: OracleVariance; total: number }> {
  const a2 = await runOnce(s, "engine-real", "replay", cassette, "A2", applied);
  const n1 = makeRunNormalizer(a.messages);
  const n2 = makeRunNormalizer(a2.messages);
  const transcripts = varianceOf(diffTranscripts(a.messages, a2.messages));
  const events = varianceOf(diffTranscripts(a.events, a2.events));
  const requests = varianceOf(
    diffTranscripts(loadObservedRequests(a.observedFile).map(n1), loadObservedRequests(a2.observedFile).map(n2)),
  );
  const state = varianceOf(diffTranscripts([a.state], [a2.state]));
  return { transcripts, events, requests, state, total: transcripts.size + events.size + requests.size + state.size };
}

/**
 * THE PRECONDITION IS PART OF THE RECORDING (C12a/W9a). The scenario DECLARES
 * one; the cassette carries the one that was actually applied when it was
 * recorded; a replay applies the recorded one, because a cassette answers the
 * requests an engine made against a particular filesystem and replaying it
 * against a different one is a different experiment wearing the same name.
 * When the two disagree the scenario FAILS by name — the wave that changed the
 * declaration re-records deliberately (or RE-SEALS, H1: see `src/reseal.ts`),
 * rather than discovering later that a green run graded the wrong world.
 *
 * AND THE APPLIED PRECONDITION IS NOT THE DECLARED ONE. `applyPrecondition`
 * prepends `emptyPreconditionFor(pin)` — the baseline `.claude.json` with its
 * pinned identity — under every declaration, and only the declared half was
 * ever written down. So the sidecar records BOTH: the declaration, and a hash
 * of the baseline seed that was applied beneath it. A sidecar with no hash, or
 * no sidecar at all, cannot say what world its cassette answers; that is
 * MALFORMED rather than tolerable, and the caller refuses to grade it.
 * BACKFILLED LOCALLY, not committed: `cassettes/` is gitignored, so the corpus
 * is per-checkout state and a fresh clone has no sidecars at all. What the
 * repository carries is this rule, not the artifacts it graded.
 *
 * One function, because `--reseal` and the grading loop must not be able to
 * disagree about which sidecars drift.
 */
function sidecarState(s: Scenario): {
  cassette: string;
  preFile: string;
  declared: ConfigPrecondition;
  baselineSha256: string;
  recorded: RecordedPrecondition | undefined;
  recordedPre: ConfigPrecondition;
  /** null when this sidecar seals THIS declaration on THIS baseline */
  driftReason: string | null;
} {
  const declared = s.precondition ?? EMPTY_PRECONDITION;
  const declaredDetached = s.detachedChildren === undefined ? null : [...s.detachedChildren];
  const baselineSha256 = baselineSeedHash(ENGINE_VERSION);
  const cassette = join(REFORGE_ROOT, "cassettes", `m1-${s.tag}.jsonl`);
  const preFile = join(REFORGE_ROOT, "cassettes", `m1-${s.tag}.precondition.json`);
  const recorded: RecordedPrecondition | undefined = existsSync(preFile)
    ? (JSON.parse(readFileSync(preFile, "utf8")) as RecordedPrecondition)
    : undefined;
  const recordedPre: ConfigPrecondition = recorded?.declared ?? EMPTY_PRECONDITION;
  const driftReason =
    recorded === undefined
      ? "no precondition sidecar was recorded beside this cassette"
      : typeof recorded.baselineSha256 !== "string"
        ? "the sidecar records a declaration but not the baseline seed it was applied on top of (a pre-F4 sidecar)"
        : recorded.baselineSha256 !== baselineSha256
          ? `the baseline seed has changed since the recording (${recorded.baselineSha256.slice(0, 12)} → ${baselineSha256.slice(0, 12)})`
          : JSON.stringify(recordedPre) !== JSON.stringify(declared)
            ? "the DECLARED precondition is not the one the cassette was recorded against"
            // C13c/W10c: the detachment declaration is part of the world the
            // cassette was recorded against, so a change to it is a finding for
            // the same reason a changed seed is. Absent on BOTH sides — every
            // pre-C13c sidecar, and every scenario that declares nothing —
            // compares equal, so no existing cassette drifts.
            : JSON.stringify(recorded.detached ?? null) !== JSON.stringify(declaredDetached)
              ? "the DECLARED detached children are not the ones the cassette was recorded against"
              : null;
  return { cassette, preFile, declared, baselineSha256, recorded, recordedPre, driftReason };
}

// ---- `--reseal`: re-seal the sidecars whose declaration provably did not move
// Visits the DRIFTING scenarios and only those, unless a tag names one — a
// census that re-ran the whole corpus would cost an engine replay per scenario
// to answer a question the sidecars already answer on disk.
if (reseal) {
  const targets = SCENARIOS.filter((s) => (only ? s.tag === only : true));
  const drifting = targets.filter((s) => sidecarState(s).driftReason !== null);
  console.log(`━━━ re-seal: ${targets.length} scenario(s) in scope, ${drifting.length} whose sidecar drifts ━━━`);
  let sealed = 0;
  const refused: string[] = [];
  const visited = only ? targets : drifting;
  for (const s of visited) {
    const st = sidecarState(s);
    console.log(`\n━━━ re-seal ${s.tag} — ${s.title} ━━━`);
    console.log(st.driftReason === null ? "  this sidecar does NOT drift — re-sealing it because you named it" : `  drift: ${st.driftReason}`);
    const r = await resealScenario({ scenario: s, declared: st.declared, cassette: st.cassette, sidecar: st.preFile });
    if (r.resealed) {
      sealed++;
      const from = r.written?.resealedFrom;
      console.log(`  RE-SEALED — the replay was clean on all three proxy signals, the check passed, and the run held.`);
      console.log(`    provenance: ${from ? `resealedFrom declared ${from.declaredSha256.slice(0, 12)}, baseline ${from.baselineSha256?.slice(0, 12) ?? "<pre-F4: none recorded>"}` : "no predecessor sidecar to name"}`);
    } else {
      refused.push(s.tag);
      console.log(`  REFUSED — the sidecar is UNTOUCHED. ${r.reason}`);
    }
  }
  console.log(`\n=== re-seal: visited ${visited.length}, re-sealed ${sealed}, refused ${refused.length}${refused.length > 0 ? ` (${refused.join(", ")})` : ""} ===`);
  console.log(refused.length === 0 ? "RESEAL OK" : "RESEAL REFUSED — a refused scenario changed the request stream and needs a live re-record");
  process.exit(refused.length === 0 ? 0 : 1);
}

const verdicts: { tag: string; pass: boolean }[] = [];

for (const s of SCENARIOS) {
  if (only && s.tag !== only) continue;
  console.log(`\n━━━ ${s.tag} — ${s.title} ━━━`);
  const cassette = join(REFORGE_ROOT, "cassettes", `m1-${s.tag}.jsonl`);

  const sidecar = sidecarState(s);
  const { preFile, declared, baselineSha256, recorded, recordedPre } = sidecar;
  // A cassette that is about to be recorded has no sidecar to disagree with.
  const driftReason = !existsSync(cassette) || rerecord ? null : sidecar.driftReason;
  const preconditionDrift = driftReason !== null;
  // A MALFORMED SIDECAR IS NOT GRADED AT ALL. Until H1 a sidecar with no
  // baseline hash — or no sidecar — replayed the recorded declaration (an EMPTY
  // one when the file was missing) under a FINDING, which is a seeded scenario
  // graded against the wrong world while printing a reason nobody could act on.
  // The corpus has none of these (all 63 sidecars carry both fields), so the
  // legacy tolerance buys nothing and costs a wrong measurement: refuse before
  // the replay, and name the repair.
  if (preconditionDrift && (recorded === undefined || typeof recorded.baselineSha256 !== "string")) {
    console.log(`    REFUSING TO GRADE: ${driftReason}. A cassette whose world was never written down cannot be replayed against it.`);
    console.log(`    Repair: 'npx tsx m1/run.ts --reseal --scenario ${s.tag}' seals the DECLARED precondition if the replay proves the request stream is unchanged; otherwise re-record with --rerecord.`);
    verdicts.push({ tag: s.tag, pass: false });
    continue;
  }
  const applied = preconditionDrift ? recordedPre : declared;

  if (!existsSync(cassette) || rerecord) {
    // ONE DEFINITION of what a live take has to survive (`src/record.ts`): the
    // run's own determinism checks, the contamination check that must REJECT
    // rather than flag, the infrastructure-failure check, the substance check,
    // and the fault derivation before promotion. This runner was the only
    // caller until C13c added two more, and three copies of that list would
    // have been three answers to "is this a recording of this scenario".
    console.log("  recording live via engine-real ...");
    const out = await recordCassette({ scenario: s, declared, cassette, sidecar: preFile, engineB });
    if (!out.ok) {
      console.log(`    DISCARDED: ${out.reason} — nothing promoted`);
      verdicts.push({ tag: s.tag, pass: false });
      continue;
    }
    console.log(`  recorded ${out.exchanges} API exchange(s); sidecar written`);
  } else {
    console.log("  cassette exists — reusing");
  }
  if (preconditionDrift) {
    // TWO EXITS, and which one applies is a question about the CHANGE. A
    // declaration that can reach the model (a different seeded transcript, a
    // fault the engine sees) needs a live take, deliberately, with the reason
    // stated. One that cannot (an inert seed file, a renamed fixture, a baseline
    // seed the model never reads) needs no take at all: `--reseal` REPLAYS the
    // new declaration and re-seals the sidecar only if the request stream comes
    // back byte-identical, which is the evidence a re-record would have produced
    // at four hours and a throttle.
    console.log(
      `    FINDING: ${driftReason} — replaying the recorded declaration. ` +
        `Either re-record deliberately ('--rerecord --scenario ${s.tag}') with the reason stated, ` +
        `or, when the change cannot reach the model, re-seal ('--reseal --scenario ${s.tag}') and let the replay prove it.`,
    );
  }

  console.log(`  replaying offline: A=engine-real, B=${engineB} ...`);
  const a = await runOnce(s, "engine-real", "replay", cassette, "A", applied);
  const b = await runOnce(s, engineB, "replay", cassette, "B", applied);
  const replayOk = a.ok && b.ok;
  saveTranscript(`m1-${s.tag}-A`, { engine: "engine-real", messages: a.messages, durationMs: 0 });
  saveTranscript(`m1-${s.tag}-B`, { engine: engineB, messages: b.messages, durationMs: 0 });

  const tFind = diffTranscripts(a.messages, b.messages);
  const eFind = diffTranscripts(a.events, b.events);
  // Requests carry engine-minted ids only inside free text, so their id map has
  // to come from that side's transcript, where the ids appear as keys.
  const normA = makeRunNormalizer(a.messages);
  const normB = makeRunNormalizer(b.messages);
  const rFind = diffTranscripts(
    loadObservedRequests(a.observedFile).map(normA),
    loadObservedRequests(b.observedFile).map(normB),
  );
  // §3.2's fourth surface. Graded even on `substanceOnly` scenarios: that
  // exemption is about transcript nondeterminism and says nothing about what
  // the engine left on disk, so exempting the state surface too would widen an
  // exemption past its own justification.
  const sFind = diffTranscripts([a.state], [b.state]);

  // Only pay for triage when something actually differs.
  let variance: Awaited<ReturnType<typeof oracleVariance>> | undefined;
  if (tFind.length + eFind.length + rFind.length + sFind.length > 0) {
    console.log("    (diff seen — replaying the oracle again to separate nondeterminism)");
    variance = await oracleVariance(s, cassette, a, applied);
    if (variance.total > 0) console.log(`    oracle is nondeterministic on ${variance.total} path(s)`);
  }

  // The state surface is graded unconditionally (see above); the other three
  // follow the scenario's own exemption. The entry count is printed so an
  // "identical" over two EMPTY trees is visible as the weak claim it is, rather
  // than reading like the strong one.
  const sOk = report(
    `state (${a.state.roots.map((r) => `${r.entries.length} ${r.name}`).join(", ")} entr${entriesOf(a.state, "sandbox").length === 1 ? "y" : "ies"}, engine ${a.state.engine})`,
    sFind,
    variance?.state,
  );
  let tOk: boolean;
  let eOk: boolean;
  let rOk: boolean;
  if (s.substanceOnly) {
    console.log(`    diff surfaces SKIPPED (substance-only): ${s.substanceOnly}`);
    console.log(
      `    [transcripts ${tFind.length}, events ${eFind.length}, requests ${rFind.length} difference(s) — not graded]`,
    );
    tOk = eOk = rOk = true;
  } else {
    tOk = report("transcripts", tFind, variance?.transcripts);
    eOk = report("events", eFind, variance?.events);
    rOk = report("requests", rFind, variance?.requests);
  }
  // substance check — guards the hollow-pass class (identical-but-empty
  // behavior). Run against BOTH engines, not just the oracle: a normally-graded
  // scenario constrains B through the three-surface diff against A, but a
  // substanceOnly scenario skips those surfaces, so an A-only check leaves
  // NOTHING asserting anything about B — an engine that omitted the behavior
  // outright would pass. A failure on either side fails the scenario.
  const substance = s.check
    ? ([
        ["A", s.check(a.messages, a.events)],
        ["B", s.check(b.messages, b.events)],
      ] as const).filter(([, failure]) => failure !== null)
    : [];
  for (const [side, failure] of substance) console.log(`    substance: FAIL [${side}] — ${failure}`);
  if (s.check && substance.length === 0) console.log("    substance: ok");
  verdicts.push({ tag: s.tag, pass: replayOk && tOk && eOk && rOk && sOk && substance.length === 0 && !preconditionDrift });
}

console.log("\n=== M1 corpus verdicts ===");
for (const v of verdicts) console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.tag}`);
if (verdicts.length === 0) {
  console.error("ABORT: no scenario ran — refusing to report a vacuous pass.");
  process.exit(2);
}
const allPass = verdicts.every((v) => v.pass);
console.log(allPass ? "\nALL PASS" : "\nFAILURES — on the identical-code pair these are harness defects; fix before grading engine-ts");
process.exitCode = allPass ? 0 : 1;
