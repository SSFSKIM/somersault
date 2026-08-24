// M2b aggregate — the full acceptance surface for an engine build:
//   corpus (happy paths) + faults (error paths) + partials (stream shape)
//   + cross-resume (store contract) + raw protocol (no-wrapper wire)
// This is what any future engine-ts must satisfy, and what every strangler
// replacement is gated on.
//
// Run: cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m2/all.ts [--engineB <name>]
import { spawnSync } from "node:child_process";
import { REFORGE_ROOT } from "../src/runTurn.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";

const SUITES: [string, string[]][] = [
  ["corpus (9 scenarios)", ["m1/run.ts", "--engineB", engineB]],
  ["faults (5 injections)", ["m2/faults.ts", "--engineB", engineB]],
  ["partials (stream shape)", ["m2/partials.ts", "--engineB", engineB]],
  ["cross-resume (store)", ["m2/cross-resume.ts", "--engineB", engineB]],
  ["raw protocol (no sdk)", ["m2/raw-protocol.ts", "--engineB", engineB]],
];

const results: { name: string; pass: boolean; detail: string }[] = [];

for (const [name, argv] of SUITES) {
  process.stdout.write(`\n━━━ ${name} ━━━\n`);
  const r = spawnSync("npx", ["tsx", ...argv], { cwd: REFORGE_ROOT, encoding: "utf8" });
  const out = (r.stdout ?? "").split("\n");
  const tail = out.filter((l) => /PASS|FAIL|ALL|identical|difference|LEAK/.test(l)).slice(-6);
  for (const l of tail) console.log(`  ${l.trim()}`);
  results.push({ name, pass: r.status === 0, detail: tail.at(-1)?.trim() ?? "" });
}

console.log(`\n=== M2b full acceptance (B = ${engineB}) ===`);
for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
const ok = results.every((r) => r.pass);
console.log(ok ? "\nALL SUITES PASS" : "\nFAILURES");
process.exitCode = ok ? 0 : 1;
