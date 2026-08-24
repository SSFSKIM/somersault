// M2a gate — the acceptance ritual every future strangler replacement must pass:
//   1. SABOTAGE build  → the corpus MUST go red   (proves the spliced module is
//      live in the execution path; a green sabotage means dead code)
//   2. FAITHFUL build  → the corpus MUST go green (proves equivalence)
// Both halves are required: either alone is satisfiable by a no-op splice.
//
// Run:  cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx strangle/gate.ts
import { spawnSync } from "node:child_process";
import { REFORGE_ROOT } from "../src/runTurn.js";

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { cwd: REFORGE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function phase(label: string, buildArgs: string[], expectPass: boolean): boolean {
  console.log(`\n━━━ ${label} ━━━`);
  const built = run("npx", ["tsx", "strangle/build.ts", ...buildArgs]);
  if (built.status !== 0) {
    console.log("  build FAILED:", built.stderr.trim().split("\n").slice(-3).join(" | "));
    return false;
  }
  const boot = run(process.env.BUN ?? "/Users/new/.bun/bin/bun", ["build/cli-strangled.js", "--version"]);
  const booted = boot.stdout.includes("2.1.241");
  console.log(`  boot: ${booted ? "ok (2.1.241)" : "FAILED — bundle produced no version output"}`);
  if (!booted) return false;
  // Full M2b surface: corpus + faults + partials + cross-resume + raw protocol.
  const corpus = run("npx", ["tsx", "m2/all.ts", "--engineB", "engine-strangled"]);
  const passed = corpus.status === 0;
  const verdicts = corpus.stdout.split("\n").filter((l) => /^\s+(PASS|FAIL)\s{2}/.test(l)).slice(-5);
  for (const v of verdicts) console.log(`  ${v.trim()}`);
  console.log(`  suites: ${passed ? "ALL PASS" : "FAILURES"} — expected ${expectPass ? "green" : "red"}`);
  return passed === expectPass;
}

const sabotageOk = phase("phase 1/2 — SABOTAGE build must go RED", ["--sabotage"], false);
const faithfulOk = phase("phase 2/2 — FAITHFUL build must go GREEN", [], true);

console.log("\n=== M2a strangler gate ===");
console.log(`  liveness (sabotage detected): ${sabotageOk ? "PASS" : "FAIL"}`);
console.log(`  equivalence (faithful green): ${faithfulOk ? "PASS" : "FAIL"}`);
const ok = sabotageOk && faithfulOk;
console.log(ok ? "\nGATE PASS — the splice is live AND equivalent" : "\nGATE FAIL");
process.exitCode = ok ? 0 : 1;
