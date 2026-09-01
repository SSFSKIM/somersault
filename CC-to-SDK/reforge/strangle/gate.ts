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
import { CHUNK_REPLACEMENTS, SPLICES } from "./manifest.js";

// build.ts boot-checks the graph it writes, so a build that exits 0 has already
// proven it boots at the pinned version; the gate only has to relay the failure.

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { cwd: REFORGE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

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
  // The differ's other half of the same spec. §3.4 asks every normalization rule
  // to carry a regression test; the value-level scrubs have had one since W0, the
  // run-ID MAP had none — and W4 widened it to the compact_boundary's uuid fields,
  // which name messages the SDK never emits. Each mapped key is paired with the
  // reimplementation defect that must still diff, so the phase is the control on
  // a normalizer that could otherwise blind the surface it normalizes.
  ["differ run-id map + its negative controls", ["src/differ.test.ts"]],
  ["state surface catches what it claims", ["src/state.test.ts"]],
  ["gate-defaults fixture matches the pin", ["research/tools/extract-gate-defaults.ts", "--check"]],
  // The other pin-keyed fixture, and the only §5 signal that can see a
  // subsystem move with every export inventory, anchor and footprint hash
  // byte-identical: the names the engine's barrel chunks re-export its own
  // symbols under. Build-free and a few seconds, so it sits with the rest of
  // the pin's determinism rather than in a recipe someone remembers to run.
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
}
const TARGETS: LivenessTarget[] = [
  ...SPLICES.map((sp) => ({ id: sp.name, label: sp.name, coverage: sp.coverage })),
  ...CHUNK_REPLACEMENTS.flatMap((cr) =>
    cr.exports.map((e) => ({
      id: `${cr.name}:${e.as}`,
      label: `${cr.name} export ${e.as}`,
      coverage: e.coverage,
      darkReason: e.darkReason,
    })),
  ),
];

for (const t of TARGETS) {
  if (t.coverage.length === 0 && t.darkReason) {
    // Not a pass by omission: the manifest carries a written reason, chunk.ts
    // refuses an empty coverage without one, and something else grades it —
    // which the reason has to name. Printed at gate time so the adjudication is
    // read every run rather than buried in a manifest comment.
    console.log(`\n━━━ liveness: ${t.label} is DARK to the corpus — reviewed exclusion ━━━`);
    console.log(`  ${t.darkReason}`);
    results.push({ label: `liveness ${t.label} (dark, adjudicated)`, pass: true });
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
    const r = run("npx", ["tsx", "m1/run.ts", "--scenario", tag, "--engineB", "engine-strangled"]);
    const red = r.status !== 0;
    console.log(`  ${tag}: ${red ? "RED (as required)" : "GREEN — the target is dead code on this scenario"}`);
    allRed &&= red;
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
  const verdicts = (r.stdout ?? "").split("\n").filter((l) => /^\s+(PASS|FAIL)\s{2}/.test(l)).slice(-5);
  for (const v of verdicts) console.log(`  ${v.trim()}`);
  results.push({ label: "equivalence (faithful)", pass: r.status === 0 });
}

// ---- auxiliary suites: the end-to-end guards, run last ----------------------
// Each spawns a real engine or hashes the 60 MB runtime, so neither belongs in
// the build-free determinism block; both are cheap enough (seconds) to be
// phases rather than a separate recipe nobody remembers to run.
console.log("\n━━━ auxiliary: credential never reaches the engine; the runtime pin is the bytes ━━━");
for (const [label, script] of [
  ["credential leak (end-to-end, X6)", "src/credential-leak.test.ts"],
  ["runtime pin is the bytes (§3.5)", "strangle/toolchain.test.ts"],
] as [string, string][]) {
  const r = run("npx", ["tsx", script]);
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
