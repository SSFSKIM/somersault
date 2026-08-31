// M3-B gate — the acceptance ritual for a MANIFEST of splices:
//
//   mechanism  : the transform's own integrity, on fixtures
//                (strangle/mechanism.test.ts): the footprint covers the closure
//                surface and not just the target span, the capture inventory is
//                exhaustive in both directions, the target-identity guard
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
import { SPLICES } from "./manifest.js";

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
  ["state surface catches what it claims", ["src/state.test.ts"]],
  ["gate-defaults fixture matches the pin", ["research/tools/extract-gate-defaults.ts", "--check"]],
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
{
  const r = run("npx", ["tsx", "strangle/mechanism.test.ts"]);
  for (const l of (r.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL|===|\s+FAIL)/.test(l))) console.log(`  ${l.trim()}`);
  results.push({ label: "splice mechanism", pass: r.status === 0 });
}

// ---- contracts: the owned implementations, over partitioned inputs ---------
// After C4's §2.4 retrofit the owned modules ship their own constants and pure
// helpers, so a wrong branch inside one is only caught differentially where a
// scenario renders it — and the corpus renders one of Read's six result arms,
// one of Grep's three, and never truncates a Glob result at all. This phase is
// the other half of §2.4's bargain.
console.log("━━━ contracts: owned helpers + the formatter arms the corpus does not reach ━━━");
{
  const r = run("npx", ["tsx", "strangle/contracts.test.ts"]);
  for (const l of (r.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL|===|\s+FAIL)/.test(l))) console.log(`  ${l.trim()}`);
  results.push({ label: "owned-implementation contracts", pass: r.status === 0 });
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

// ---- per-splice liveness: sabotage exactly one, its coverage must go red ----
for (const sp of SPLICES) {
  console.log(`\n━━━ liveness: sabotage ONLY ${sp.name} → ${sp.coverage.join(", ")} must go RED ━━━`);
  if (!buildAndBoot(["--sabotage", sp.name])) {
    results.push({ label: `liveness ${sp.name}`, pass: false });
    continue;
  }
  // A splice with no covering scenario would leave `allRed` true and "pass"
  // having tested nothing — the same vacuous-pass shape an external review
  // caught in the corpus runner. A splice that nothing covers is ungated.
  if (sp.coverage.length === 0) {
    console.log(`  FAIL — ${sp.name} has no covering scenario; liveness cannot be proven`);
    results.push({ label: `liveness ${sp.name}`, pass: false });
    continue;
  }
  let allRed = true;
  for (const tag of sp.coverage) {
    const r = run("npx", ["tsx", "m1/run.ts", "--scenario", tag, "--engineB", "engine-strangled"]);
    const red = r.status !== 0;
    console.log(`  ${tag}: ${red ? "RED (as required)" : "GREEN — splice is dead code"}`);
    allRed &&= red;
  }
  results.push({ label: `liveness ${sp.name}`, pass: allRed });
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
