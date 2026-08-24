// M3-B gate — the acceptance ritual for a MANIFEST of splices:
//
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
import { SPLICES } from "./build.js";

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { cwd: REFORGE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function buildAndBoot(buildArgs: string[]): boolean {
  const built = run("npx", ["tsx", "strangle/build.ts", ...buildArgs]);
  if (built.status !== 0) {
    console.log("  build FAILED:", built.stderr.trim().split("\n").slice(-3).join(" | "));
    return false;
  }
  const boot = run(process.env.BUN ?? "/Users/new/.bun/bin/bun", ["build/cli-strangled.js", "--version"]);
  const booted = boot.stdout.includes("2.1.241");
  if (!booted) console.log("  boot FAILED — bundle produced no version output");
  return booted;
}

const results: { label: string; pass: boolean }[] = [];

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
