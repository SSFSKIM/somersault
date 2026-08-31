// M3-B gate — the acceptance ritual for a MANIFEST of splices:
//
//   derivation : every capture must track an upstream rename and must throw
//                when its shape is destroyed (strangle/perturb.ts). A splice
//                whose derivation silently returns something plausible would
//                wire a delegation to a binding that no longer exists.
//   per splice : build with ONLY that splice sabotaged → its covering corpus
//                scenario(s) must go RED. Proves each splice is individually
//                live in the execution path — an all-at-once sabotage would
//                pass as long as ANY one splice is live, letting dead splices
//                ride along.
//   final      : faithful build → the FULL acceptance surface (m2/all.ts:
//                corpus + faults + partials + cross-resume + raw) must be GREEN.
//
// Both halves are mandatory: either alone is satisfiable by a no-op splice.
//
// Run:  cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx strangle/gate.ts
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

// ---- derivation: re-derivation must track renames and fail loudly ----------
console.log("━━━ derivation: every capture tracks its rename and throws when destroyed ━━━");
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

console.log("\n=== strangler gate ===");
for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.label}`);
const ok = results.every((r) => r.pass);
console.log(ok ? "\nGATE PASS — every splice is live AND the faithful build is equivalent" : "\nGATE FAIL");
process.exitCode = ok ? 0 : 1;
