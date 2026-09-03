// M3-B gate — the acceptance ritual for a MANIFEST of splices:
//
//   mechanism  : the transform's own integrity, on fixtures
//                (strangle/mechanism.test.ts): the footprint covers the closure
//                surface and not just the target span — including, for an OWNED
//                helper, what that helper itself calls — the capture inventory
//                is exhaustive in both directions, the target-identity guard
//                refuses a drifted anchor, computed destructuring keys are
//                refused. Each watched failing as well as passing — a guard
//                only ever fed valid input proves nothing about what it
//                excludes.
//   contracts  : the owned parity implementations, over partitioned inputs
//                (strangle/contracts.test.ts). §2.4 buys ownership of a pure
//                helper against "the differential surfaces its output flows
//                into PLUS a contract test where its domain is wider than the
//                corpus" — and the corpus's domain is narrow: one of Read's six
//                result arms, one of Grep's three, and no Glob truncation at all.
//   derivation : every capture must track an upstream rename and must throw
//                when its shape is destroyed, and the manifest's declared
//                captures must BE the excised body's free variables
//                (strangle/perturb.ts). A splice whose derivation silently
//                returns something plausible would wire a delegation to a
//                binding that no longer exists; an incomplete inventory would
//                wire one to a binding it never received.
//   per splice : build with ONLY that splice sabotaged → its covering corpus
//                scenario(s) must go RED. Proves each splice is individually
//                live in the execution path — an all-at-once sabotage would
//                pass as long as ANY one splice is live, letting dead splices
//                ride along.
//   final      : faithful build → the FULL acceptance surface (m2/all.ts:
//                corpus + faults + partials + cross-resume + raw) must be GREEN.
//   auxiliary  : the two end-to-end guards that cannot live in the determinism
//                block because they are not build-free — the credential-leak
//                proof (a real engine against a stub upstream) and the runtime
//                pin's byte identity. Last because they are the slowest per
//                check, in the gate because a suite that only ever runs by hand
//                is a suite that rots.
//
// Both halves are mandatory: either alone is satisfiable by a no-op splice.
//
// Run:  cd reforge && set -a; . ../.env; set +a; npx tsx strangle/gate.ts
import { spawnSync } from "node:child_process";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { relayOutput } from "../m2/relay.js";
import { CHUNK_REPLACEMENTS, SPLICES } from "./manifest.js";
import { classifyReplay, darkVerdict, runnerFor, type ReplayOutcome } from "./runners.js";

// build.ts boot-checks the graph it writes, so a build that exits 0 has already
// proven it boots at the pinned version; the gate only has to relay the failure.

const run = (cmd: string, args: string[], timeoutMs?: number) =>
  spawnSync(cmd, args, { cwd: REFORGE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });

/**
 * How long a SABOTAGED replay may take before the gate stops waiting.
 *
 * A faithful replay of the slowest scenario in the corpus finishes in well under
 * a minute — it is offline, served from a cassette. Five minutes is therefore a
 * bound no healthy run approaches, and it exists because a sabotaged one can
 * fail to finish AT ALL: a twin that breaks a control-channel response leaves
 * the driver awaiting a promise that never settles, and the gate waited on one
 * such phase for over twenty-five minutes before an operator noticed.
 */
const SABOTAGE_TIMEOUT_MS = 5 * 60_000;

function buildAndBoot(buildArgs: string[]): boolean {
  const built = run("npx", ["tsx", "strangle/build.ts", ...buildArgs]);
  if (built.status !== 0) {
    const why = `${built.stdout ?? ""}${built.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ");
    console.log("  build FAILED:", why);
    return false;
  }
  return true;
}

const results: { label: string; pass: boolean }[] = [];

// ---- determinism: the environment the whole gate runs under (W0c / §3.3) ----
// First, and build-free. Every phase below spawns engines through the
// allowlisted env and grades them under strict replay, so if the schema, the
// shared canonicalization, the state surface or the pinned gate defaults are
// wrong, everything after this is measuring the wrong engine — or measuring it
// through a surface that cannot see a difference.
console.log("━━━ determinism: env schema, canonicalization, state surface, pinned gate defaults ━━━");
for (const [label, argv] of [
  ["env schema + credential matrix", ["src/env.test.ts"]],
  ["canonicalization scrubs", ["src/canonical.test.ts"]],
  // The gate's claim about ITSELF: "a phase that can fail has to say what
  // failed." It was defeated in two independent places at once — the aggregate
  // relayed a tail of six lines out of a 59-scenario verdict block, and the
  // replay proxy's positional-serve diagnostic matched neither the verdict shape
  // nor the reason filter — and both are invisible on a green run, which is how
  // they survived a full gate. The control asserts the RED direction and, for
  // each half, that the retired shape would have missed it.
  ["gate names every failing verdict, and the proxy's reason", ["m2/relay.test.ts"]],
  // The differ's other half of the same spec. §3.4 asks every normalization rule
  // to carry a regression test; the value-level scrubs have had one since W0, the
  // run-ID MAP had none — and W4 widened it to the compact_boundary's uuid fields,
  // which name messages the SDK never emits. Each mapped key is paired with the
  // reimplementation defect that must still diff, so the phase is the control on
  // a normalizer that could otherwise blind the surface it normalizes.
  ["differ run-id map + its negative controls", ["src/differ.test.ts"]],
  ["state surface catches what it claims", ["src/state.test.ts"]],
  ["gate-defaults fixture matches the pin", ["research/tools/extract-gate-defaults.ts", "--check"]],
  // The hook wave's population under test, and the third pin-keyed fixture. W5
  // enumerated "the events that exist" by judgment twice and was wrong twice —
  // an event nobody thought to watch cannot be measured as absent. The registry
  // is upstream's own enumeration, so the probe's watched list now derives from
  // this fixture and a pin that adds, drops or re-points an event reddens here
  // rather than silently narrowing what gets measured.
  ["hook-registry fixture matches the pin", ["research/tools/extract-hook-registry.ts", "--check"]],
  // The permission wave's population under test, and the fourth pin-keyed
  // fixture. The matrix W6 owns has three axes — six modes, three rule
  // behaviours, eleven decisionReason kinds — and each is derived from the
  // bundle rather than written down: the mode set comes from FOUR independent
  // enumerations that must agree with each other and be confirmed against the
  // names the graph compares against, and the decisionReason axis is the message
  // builder's own case list. A pin that adds a mode, re-guards one or renames a
  // rule behaviour reddens here rather than silently narrowing the matrix.
  ["permission-surface fixture matches the pin", ["research/tools/extract-permission-surface.ts", "--check"]],
  // The control wave's population under test, and the fifth pin-keyed fixture.
  // W7's own scout counted the dispatch ladder's arms and the SDK's sendable
  // subtypes by hand and got both numbers wrong, which is the enumeration
  // failure C8 was corrected for twice. This one is derived from two artifacts
  // that share no machinery — the engine's ladder, found by shape and confirmed
  // by the `control_request` guard it sits under, and the installed SDK's
  // sendable set — so a pin that adds an arm, retires one, or re-points a
  // handler reddens here rather than silently narrowing the wave's claim. It
  // also fails when the installed SDK moves, which is the intended reading: the
  // set of subtypes a host can send is part of the population.
  ["control-protocol fixture matches the pin", ["research/tools/extract-control-protocol.ts", "--check"]],
  // The other pin-keyed fixture, and the only §5 signal that can see a
  // subsystem move with every export inventory, anchor and footprint hash
  // byte-identical: the names the engine's barrel chunks re-export its own
  // symbols under. Build-free and a few seconds, so it sits with the rest of
  // the pin's determinism rather than in a recipe someone remembers to run.
  // The system-prompt SECTION inventory, W7.5's fixture and the third population
  // in this campaign that had been carried as a hand-written number ("`OS()`'s
  // ~20 prose sections", quoted since W3; the pin says 27 dynamic records and a
  // six-element static head, in a five-element return array of which exactly one
  // element follows the dynamic set). Derived by shape from the
  // section-record constructor and confirmed from two other places — the
  // boundary sentinel the already-owned partitioner looks for, and the
  // `defaultSystemPrompt` property every caller binds the result to.
  ["prompt-section fixture matches the pin", ["research/tools/extract-prompt-sections.ts", "--check"]],
  // The hook EXECUTION LAYER's call graph, W7.6a's fixture and the fourth
  // population this campaign had been carrying as a hand-written number (after
  // the hook events, the control-protocol arms and the prompt sections). The
  // executor design pass counted the helper belt by reading — "roughly 13.9 KB
  // across ~34 already-pure functions" — and named ten of them; the derivation
  // disagrees in both dimensions and, more usefully, measures the thing the
  // design never asked about: ANCHORABILITY. Two structural facts the campaign
  // now depends on are asserted by the tool rather than believed: the two
  // executors are one `async function*` and one plain `async function`, and
  // their callee sets overlap by well under half — which is design §2's "two
  // consumers, never one core" restated as a check that fails if a pin ever
  // unifies them.
  ["hook-helper belt fixture matches the pin", ["research/tools/extract-hook-helpers.ts", "--check"]],
  // W8a's population, and the FIFTH the campaign had been carrying as a
  // hand-written number. C11a's whole claim is "these are the sixteen
  // description builders", and the four before it (hook events, control-protocol
  // arms, prompt sections, the helper belt) were each wrong until they were
  // derived. This one is derived from TWO artifacts that share no machinery: the
  // recorded request bodies say what the engine presented, and the graph says
  // which declarations produce that text — located by searching the graph for
  // the rendered description rather than by looking a builder up by name. The
  // corpus half is a floor on counts and exact on bytes, so a later wave's
  // recordings grow it without reddening it while a drifted description does.
  ["moat-tool belt fixture matches the pin and the corpus", ["research/tools/extract-moat-tools.ts", "--check"]],
  // C16b / W13b's population, and the SIXTH the campaign had been carrying as a
  // hand-written number. The child's own brief opens with one — "780 B, 10
  // importers, 3 exports" — and a literal `grep -l` for the chunk's name answers
  // 313, because 303 chunks carry a BARE side-effect import of it for the
  // bundler's evaluation order. Both numbers are true of different questions and
  // only one of them is "who reads the latch". So the whole surface is derived by
  // SHAPE and committed: the latch chunk (a class with one boolean field, a
  // reader, a setter and a promise built to never settle), its named importers
  // with per-export call sites, the shutdown coordinator's 44 members and the
  // twelve a free-function facade exposes, and every `process.on("SIG…")` in the
  // graph — including the two families the scout collapsed into one and the
  // registrations this walk could not read, so the population has a denominator.
  // The handlers also carry their EXCISABILITY, measured rather than recalled: a
  // splice forwards captures by value, so a handler that writes back to one is a
  // mechanical refusal and the fixture is where that is recorded.
  ["process-lifecycle fixture matches the pin", ["research/tools/extract-process-lifecycle.ts", "--check"]],
  ["symbol map matches the pin", ["research/tools/symbol-map.ts", "--check"]],
  // The closure ledger is the campaign's progress metric (X2), and a metric
  // nobody validates is a metric nobody can trust. Build-free and sub-second, so
  // it belongs in this block rather than in a recipe someone remembers to run:
  // the checker's own fixture controls first (it must reject a fabricated
  // footprint, a dangling edge, an unregistered ownership claim), then the real
  // ledger, which now fails the gate rather than drifting quietly.
  ["closure-ledger checker fixtures (X2)", ["ledger/check.test.ts"]],
  ["closure ledger is green (X2)", ["ledger/check.ts"]],
  // X7's own enforcement, added by W3 after finding it had none: contract X7
  // says every wave registers its standalone-complete modules in the skeleton,
  // and `skeleton.test.ts` asserts one registration per manifest row — but it
  // was not a gate phase, so C5x's three modules went unregistered through a
  // green gate and were only noticed when the NEXT wave's rows shifted the
  // count. A contract nothing runs is a contract nothing enforces.
  ["engine-ts skeleton + X7 registration", ["engine-ts/skeleton.test.ts"]],
  ["engine-ts reaches no extracted artifact", ["engine-ts/check-reachability.ts"]],
  // …and the checker's own liveness proof, which the wave that promoted the
  // CHECKER left out (C6 boundary review, finding 4). The checker is the only
  // thing standing between engine-ts and a quiet delegation back to the
  // extracted graph, so "nobody has watched it reject anything" is the same
  // vacuity the phase above exists to refuse, one level down. Build-free and
  // ~0.8s measured, so it sits here rather than in the auxiliary block.
  ["reachability checker rejects and accepts (§3.1)", ["engine-ts/reachability.test.ts"]],
  // The corpus SEED's environment independence (C6 fix, finding 2). Belongs in
  // this block by the same argument as the scrubs above it: the W3 recordings
  // render the seeded repository's branch, git user and commit list into every
  // preset prompt, so a recorder whose git config moved the baseline is
  // measuring a different corpus. Build-free and ~1.1s measured.
  ["corpus git seed ignores the recorder's config", ["w3/seed.test.ts"]],
] as [string, string[]][]) {
  const r = run("npx", ["tsx", ...argv]);
  const tail = (r.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL|===|\s+plausibility)/.test(l)).slice(-2);
  for (const l of tail) console.log(`  ${l.trim()}`);
  if (r.status !== 0) for (const l of (r.stdout ?? "").split("\n").filter((l) => l.includes("FAIL")).slice(0, 5)) console.log(`  ${l.trim()}`);
  results.push({ label, pass: r.status === 0 });
}

// ---- mechanism: the splice transform's own integrity, on fixtures ----------
// Ahead of derivation because it grades the machinery derivation runs ON: a
// footprint that under-covers, an inventory that cannot detect its own gaps or
// a target guard that never fires would make every phase below optimistic.
console.log("━━━ mechanism: footprint closure surface, capture inventory, target guard, computed keys ━━━");
for (const [label, script] of [
  ["splice mechanism", "strangle/mechanism.test.ts"],
  // The branch INVENTORY is machinery too, and the same argument applies to it:
  // an instrumenter that silently skips a construct reports full coverage of the
  // subset it understood, so every refusal and every recorded form has a fixture
  // control — including the faithfulness half, which executes the instrumented
  // fixture and compares it against the same module uninstrumented.
  ["branch instrumenter", "strangle/branches.test.ts"],
  // …and the adjudicator that reads what the instrumenter recorded: an
  // unadjudicated branch, a stale exclusion in either direction and an empty
  // inventory must each fail, while a fresh attestation passes.
  ["attestation adjudicator", "strangle/attest.test.ts"],
] as [string, string][]) {
  const r = run("npx", ["tsx", script]);
  for (const l of (r.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL|===|\s+FAIL)/.test(l))) console.log(`  ${l.trim()}`);
  results.push({ label, pass: r.status === 0 });
}

// ---- contracts: the owned implementations, over partitioned inputs ---------
// After C4's §2.4 retrofit the owned modules ship their own constants and pure
// helpers, so a wrong branch inside one is only caught differentially where a
// scenario renders it — and the corpus renders one of Read's six result arms,
// one of Grep's three, and never truncates a Glob result at all. This phase is
// the other half of §2.4's bargain.
console.log("━━━ contracts: owned helpers + the formatter arms the corpus does not reach ━━━");
for (const [label, script] of [
  ["owned-implementation contracts", "strangle/contracts.test.ts"],
  // The description functions get their own contract test, and it is a
  // different KIND: rather than partitioning inputs by hand it extracts the four
  // upstream bodies out of the pinned bundle, runs them with stubbed ports, and
  // requires byte identity over the full branch cross-product. That is the
  // oracle behind every exclusion the coverage attestation records — an arm no
  // scenario renders is still graded against upstream.
  ["description parity vs the pinned bundle", "strangle/description-parity.test.ts"],
  // The same oracle for W3's prompt-assembly modules, where the corpus/domain
  // gap is widest in the campaign so far: the block partition has three paths
  // and the corpus reaches one, because the static-prompt gate is pinned false.
  // It compares the telemetry events as well as the returned blocks, since two
  // of those three paths differ only in which event they emit.
  ["prompt-assembly parity vs the pinned bundle", "strangle/prompt-parity.test.ts"],
  // The same oracle for W4's compaction modules, where the corpus/domain gap has
  // a different shape: a recording can only ever show the ONE path that ended in
  // the decision it recorded, so every refusal in the trigger predicate and every
  // absence arm in the wire mapper is graded here and nowhere else. It compares
  // the predicate's PORT TRACE as well as its answer, since two of its refusals
  // differ from each other in nothing but which ports ran.
  ["compaction parity vs the pinned bundle", "strangle/compaction-parity.test.ts"],
  // The same oracle for W5's hook dispatchers, where the corpus/domain gap is
  // structural rather than incidental: a registration guard's REFUSAL arm cannot
  // be recorded by any scenario at all — a run with no hook registered produces
  // no consult, no record and no observable — and the PreToolUse function-hook
  // chain is armed by machinery the SDK seam does not expose. It compares the
  // yielded sequence, the return value, the hook RECORD and the full port trace,
  // since the executor request is where one dispatcher differs from another.
  ["hook-dispatch parity vs the pinned bundle", "strangle/hooks-parity.test.ts"],
  // The same oracle for W6's permission subsystem, where the corpus/domain gap is
  // the widest in the campaign so far — and structural rather than incidental.
  // This subsystem's job is to DECIDE, and a rung that was reached and passed
  // leaves the same transcript as one that was never reached, so most of a
  // thirteen-rung ladder is unrecordable by construction. Two more families are
  // out of reach, and the first one's reason had to be corrected: `auto` is NOT
  // gate-dead — its gate is three LOCAL conditions, the mode records at spawn and
  // over the control channel, and the classifier's fail-closed deny is now a
  // recording (`perm-auto-classifier-deny`). What is out of reach is narrower and
  // CORPUS-DARK: no scenario creates the classifier's BLOCK verdict, and none
  // transitions into or out of `auto`, so the transition's strip and restore go
  // unrendered. The second family is the mode transition's thirty ordered pairs,
  // which a corpus would need thirty recordings for. It compares the PORT TRACE
  // as well as the value, since two refusals returning the same thing can differ
  // in nothing but which ports ran; and it locates its subject with the BUILD's
  // own resolveAnchor/selectExcision/assertSignature, so an oracle and a build
  // cannot grade different functions.
  ["permission-subsystem parity vs the pinned bundle", "strangle/permissions-parity.test.ts"],
  // The same oracle for W7's control-protocol handlers. The corpus/domain gap
  // here has a shape none of the five before it had: the raw driver DOES send
  // ten control requests now, so this subsystem is not unrecordable — it is
  // under-recordable by an order of magnitude. One request has one shape, and
  // the model switch alone partitions into six refusals and three acceptances.
  // Two whole regions are out of reach for structural reasons rather than
  // budgetary ones: the REINITIALIZE arm answers a host reconnecting to a
  // session in flight, which no scenario does; and the payload's two auto-mode
  // fields appear only on a VS Code entrypoint, which the harness is not. Both
  // are graded here because their gates are PORTS in the owned modules.
  ["control-protocol parity vs the pinned bundle", "strangle/control-parity.test.ts"],
  // The same oracle for W8a's moat-tool belt, where the corpus/domain gap has
  // yet another shape: these tools are PRESENT in every recorded catalog and
  // EXECUTED by nothing, so the corpus renders exactly one arm of each
  // description and can never render a second. The three axes it cannot reach
  // are all gates pinned to their compiled-in defaults — the Monitor paragraph
  // inside CronCreate's prose (default false), SendMessage's cross-session
  // sections (default TRUE, so it is the DISABLED arm that is unrecordable) and
  // the cron durability branch (default true) — plus ScheduleWakeup's
  // three-valued prompt-cache argument. It also takes over the load-bearing
  // grade for C4/W1's four task formatters, whose arms were until now checked
  // against hand-written strings rather than against upstream's own bytes.
  ["moat-tool parity vs the pinned bundle", "strangle/moat-parity.test.ts"],
] as [string, string][]) {
  const r = run("npx", ["tsx", script]);
  for (const l of (r.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL|===|\s+FAIL)/.test(l))) console.log(`  ${l.trim()}`);
  results.push({ label, pass: r.status === 0 });
}

// ---- derivation: re-derivation must track renames and fail loudly ----------
console.log("━━━ derivation: every capture tracks its rename, throws when destroyed, and is the complete inventory ━━━");
{
  const r = run("npx", ["tsx", "strangle/perturb.ts"]);
  const summary = (r.stdout ?? "").split("\n").filter((l) => l.trim().startsWith("===") || l.startsWith("PASS") || l.startsWith("FAIL"));
  for (const line of summary) console.log(`  ${line.trim()}`);
  if (r.status !== 0) console.log(`  ${(r.stdout ?? "").split("\n").filter((l) => l.includes("FAIL")).join(" | ")}`);
  results.push({ label: "derivation perturbation", pass: r.status === 0 });
}

// ---- per-target liveness: sabotage exactly one, its coverage must go red ----
// A splice is one target. A CHUNK replacement is one target per retained export
// (§2.2): one twin per file would pass as long as any single export is live,
// which is the same vacuous shape solo-sabotage exists to refuse one level down.
interface LivenessTarget {
  /** what `--sabotage` is given */
  id: string;
  label: string;
  coverage: string[];
  /** set when the corpus provably cannot observe this target — a reviewed adjudication, not a skip */
  darkReason?: string;
  /** the scenarios that adjudication was measured over, which the gate RE-MEASURES every run */
  darkOver?: string[];
}
const TARGETS: LivenessTarget[] = [
  // A SPLICE may now be adjudicated dark as well, on the same terms a chunk
  // export always could (§2.2). The alternative, when a function is measured
  // dark, was to un-splice it — right when it has no observable effect at all,
  // wrong when it has a real effect the corpus simply never CREATES, because it
  // then trades owned bytes for nothing. `assertManifest` refuses a row that
  // claims both and a row that claims neither.
  ...SPLICES.map((sp) => ({ id: sp.name, label: sp.name, coverage: sp.coverage, darkReason: sp.darkReason, darkOver: sp.darkOver })),
  ...CHUNK_REPLACEMENTS.flatMap((cr) =>
    cr.exports.map((e) => ({
      id: `${cr.name}:${e.as}`,
      label: `${cr.name} export ${e.as}`,
      coverage: e.coverage,
      darkReason: e.darkReason,
      darkOver: e.darkOver,
    })),
  ),
];

/**
 * Replay one covering tag against a build and say what happened, with the
 * THREE-OUTCOME rule this loop has needed since C9: a runner that crashed, was
 * killed, or graded nothing is INCONCLUSIVE, not evidence.
 *
 * Shared by the two directions the loop now grades. A LIVE row requires RED —
 * sabotage it and its coverage must break. A DARK row requires GREEN — sabotage
 * it and nothing must move, because "nothing observes this" is a claim that can
 * only be re-measured by observing.
 */
function replayTag(tag: string): { outcome: ReplayOutcome; note: string } {
  const r = run("npx", ["tsx", ...runnerFor(tag, "engine-strangled")], SABOTAGE_TIMEOUT_MS);
  // `spawnSync`'s own timeout report, not the exit code: the child here is
  // `npx`, which catches the SIGTERM and exits 143 of its own accord, so
  // `signal` is null and `status` is an ordinary number. Only `error.code`
  // distinguishes "we stopped it" from "it stopped".
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  // The reading itself lives in `runners.ts` — pure, and driven on synthetic
  // runner output in `mechanism.test.ts`, because the gate reads it in two
  // opposite directions now and neither can be exercised by spawning.
  return classifyReplay(tag, `${r.stdout ?? ""}${r.stderr ?? ""}`, timedOut, r.status);
}

for (const t of TARGETS) {
  if (t.coverage.length === 0 && t.darkReason) {
    // DARKNESS IS RE-MEASURED, NOT RECALLED. This branch used to push a pass and
    // `continue` before any build: the adjudication was written once, in prose,
    // and nothing ever checked it again — so the day a scenario created the
    // firing condition the row would keep reporting "dark, adjudicated" while
    // running live and ungraded. A reason nothing re-runs is an assertion.
    //
    // So a dark row is built and replayed like every other, and its `darkOver`
    // population — the scenarios the reason claims to have measured over — must
    // come back GREEN. The direction is the inverse of the live case and the
    // argument is the same: sabotage the target, then look. A RED here means the
    // corpus now reaches the function, which is the row's own claim failing, and
    // it fails the gate loudly rather than quietly staying true-by-assertion.
    console.log(`\n━━━ liveness: ${t.label} is DARK — sabotage it and ${t.darkOver!.join(", ")} must stay GREEN ━━━`);
    console.log(`  ${t.darkReason}`);
    if (!buildAndBoot(["--sabotage", t.id])) {
      results.push({ label: `liveness ${t.label} (dark)`, pass: false });
      continue;
    }
    const seen = t.darkOver!.map((tag) => ({ tag, ...replayTag(tag) }));
    const { stillDark, lines } = darkVerdict(t.label, seen);
    for (const l of lines) console.log(`  ${l}`);
    results.push({ label: `liveness ${t.label} (dark over ${t.darkOver!.length} scenario(s))`, pass: stillDark });
    continue;
  }
  console.log(`\n━━━ liveness: sabotage ONLY ${t.id} → ${t.coverage.join(", ")} must go RED ━━━`);
  if (!buildAndBoot(["--sabotage", t.id])) {
    results.push({ label: `liveness ${t.label}`, pass: false });
    continue;
  }
  // A target with no covering scenario would leave `allRed` true and "pass"
  // having tested nothing — the same vacuous-pass shape an external review
  // caught in the corpus runner. A target nothing covers is ungated.
  if (t.coverage.length === 0) {
    console.log(`  FAIL — ${t.label} has no covering scenario and no reviewed exclusion; liveness cannot be proven`);
    results.push({ label: `liveness ${t.label}`, pass: false });
    continue;
  }
  let allRed = true;
  for (const tag of t.coverage) {
    // Not every covering tag is a corpus scenario: the control protocol is
    // graded by the no-wrapper driver, because sdk.mjs consumes the frames a
    // corpus scenario would have to see (strangle/runners.ts).
    const { outcome, note } = replayTag(tag);
    if (outcome === "red") console.log(`  ${tag}: RED (as required)${note ? ` — ${note}` : ""}`);
    else if (outcome === "green") console.log(`  ${tag}: GREEN — the target is dead code on this scenario`);
    else console.log(`  ${tag}: INCONCLUSIVE — ${note}; a run that graded nothing is not evidence of liveness`);
    allRed &&= outcome === "red";
  }
  results.push({ label: `liveness ${t.label}`, pass: allRed });
}

// ---- coverage attestation: do the covering scenarios reach the branches? ----
// Solo-sabotage above proves each target is REACHED. It says nothing about which
// of its branches the corpus renders, and after C4's retrofit the unrendered
// ones are our implementation too. Runs its own instrumented build, so it goes
// after the liveness block and before the faithful build the final phase makes.
console.log("\n━━━ attestation: every branch of the wave's owned modules is executed or adjudicated (§3.1) ━━━");
{
  const r = run("npx", ["tsx", "strangle/attest.ts", "--check"]);
  for (const l of (r.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL|===|\s+FAIL)/.test(l))) console.log(`  ${l.trim()}`);
  results.push({ label: "coverage attestation", pass: r.status === 0 });
}

// ---- equivalence: faithful build, full surface green ------------------------
console.log("\n━━━ equivalence: FAITHFUL build → full acceptance surface must be GREEN ━━━");
if (!buildAndBoot([])) {
  results.push({ label: "equivalence (faithful)", pass: false });
} else {
  const r = run("npx", ["tsx", "m2/all.ts", "--engineB", "engine-strangled"]);
  const { verdicts, fails, reasons } = relayOutput(r.stdout ?? "");
  // The five SUITE verdicts are the tail; they are what a green run needs to
  // show. On a red one they are the least useful five lines in the file.
  for (const v of verdicts.slice(-5)) console.log(`  ${v.trim()}`);
  // EVERY FAILING LINE, NAMED. The tail-only view discarded WHICH scenario
  // failed, which made a red equivalence phase undiagnosable from the log —
  // the same defect class C9 fixed one block up, where any non-zero exit was
  // read as RED without the runner's own verdict. A phase that can fail has to
  // say what failed, or its failure is a rumour.
  //
  // Both halves of that used to leak. The aggregate relayed a TAIL, so a corpus
  // failure outside the last five scenarios never reached this filter at all;
  // and the reason filter was prose the replay proxy does not write, so the
  // commonest cause of a red run — a request served POSITIONALLY because its
  // body hash missed — was neither a verdict nor a reason. Both live in
  // `m2/relay.ts` now, shared with the runner that prints them.
  if (r.status !== 0) {
    console.log(`  ${fails.length} failing verdict(s):`);
    for (const f of fails) console.log(`    ${f.trim()}`);
    for (const w of reasons) console.log(`    ${w.trim()}`);
  }
  results.push({ label: "equivalence (faithful)", pass: r.status === 0 });
}

// ---- auxiliary suites: the end-to-end guards, run last ----------------------
// Each spawns a real engine or hashes the 60 MB runtime, so neither belongs in
// the build-free determinism block; both are cheap enough (seconds) to be
// phases rather than a separate recipe nobody remembers to run.
console.log("\n━━━ auxiliary: credential never reaches the engine; the oracle and runtime pins are the bytes; the ledger's captures are in the committed basis ━━━");
for (const [label, argv] of [
  ["credential leak (end-to-end, X6)", ["src/credential-leak.test.ts"]],
  ["oracle + runtime pins are the bytes (§3.5)", ["strangle/toolchain.test.ts"]],
  // THE LEDGER'S CAPTURES, RE-DERIVED FROM THE BUILD THAT JUST RAN. `ledger/check.ts`
  // in the determinism block proves each recorded span hashes to what it
  // recorded; it cannot prove the record is the one THIS build emits, because it
  // has no emission to compare against. That comparison is what
  // `backfill-captures.ts --check` does, and until now nothing ran it — so
  // W7.6a's captures went in unconverted, in the emitter's basis, and a green
  // gate said nothing. A check nothing runs is a check nothing enforces (C6's X7
  // finding, arriving one artifact over).
  //
  // It sits HERE rather than in the determinism block because it needs a
  // FAITHFUL build/footprints.json, which only exists after the equivalence
  // phase above rebuilds one — every phase between the liveness loop and that
  // rebuild leaves a sabotaged emission behind, and the tool refuses those by
  // variant rather than reading them.
  ["ledger captures match this build, rebased upstream (§5)", ["ledger/backfill-captures.ts", "--check"]],
] as [string, string[]][]) {
  const r = run("npx", ["tsx", ...argv]);
  const lines = (r.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL|===|\s+FAIL)/.test(l));
  for (const l of lines) console.log(`  ${l.trim()}`);
  // A suite that died before printing anything must still say why, or a red
  // here reads as an unexplained FAIL in the summary.
  if (r.status !== 0 && lines.every((l) => !l.startsWith("FAIL"))) {
    console.log(`  ${`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ") || "<no output>"}`);
  }
  results.push({ label, pass: r.status === 0 });
}

console.log("\n=== strangler gate ===");
for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.label}`);
const ok = results.every((r) => r.pass);
console.log(ok ? "\nGATE PASS — every splice is live AND the faithful build is equivalent" : "\nGATE FAIL");
process.exitCode = ok ? 0 : 1;
