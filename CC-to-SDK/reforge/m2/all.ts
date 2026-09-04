// M2b aggregate — the full acceptance surface for an engine build:
//   corpus (happy paths) + faults (error paths) + partials (stream shape)
//   + cross-resume (store contract) + raw protocol (no-wrapper wire)
//   + signals mid-turn (the process lifecycle, which needs a signal and a pid)
// This is what any future engine-ts must satisfy, and what every strangler
// replacement is gated on.
//
// Run: cd reforge && set -a; . ../.env; set +a; npx tsx m2/all.ts [--engineB <name>]
import { spawnSync } from "node:child_process";
import { acquireSandboxLock } from "../src/lock.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { combinedOutput, relayFallback, relayOutput } from "./relay.js";
// Derived, not written down: the label used to carry a hardcoded scenario count,
// which was already stale the first time the corpus grew (22 -> 24 at C4). A
// number in a gate transcript that nobody recomputes is a number nobody can
// trust.
import { SCENARIOS as M1_SCENARIOS } from "../m1/scenarios.js";
import { M2C_SCENARIOS } from "../m2c/scenarios.js";
import { M3_SCENARIOS } from "../m3/scenarios.js";
import { W1_SCENARIOS } from "../w1/scenarios.js";
import { W2_SCENARIOS } from "../w2/scenarios.js";
import { W3_SCENARIOS } from "../w3/scenarios.js";
import { W4_SCENARIOS } from "../w4/scenarios.js";
import { W5_SCENARIOS } from "../w5/scenarios.js";
import { W6_SCENARIOS } from "../w6/scenarios.js";
import { W9_SCENARIOS } from "../w9/scenarios.js";

const CORPUS_SIZE = M1_SCENARIOS.length + M2C_SCENARIOS.length + M3_SCENARIOS.length + W1_SCENARIOS.length + W2_SCENARIOS.length + W3_SCENARIOS.length + W4_SCENARIOS.length + W5_SCENARIOS.length + W6_SCENARIOS.length + W9_SCENARIOS.length;

// Held for the whole surface, not per suite. Each child below resets the
// sandbox, so a sibling harness process that slipped in between two of them
// would corrupt the next measurement rather than this one — which is the shape
// that is hardest to attribute. Under the gate this is a no-op: the gate is the
// owner and this process carries its marker (`src/lock.ts`).
acquireSandboxLock("the m2 acceptance surface");

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";

const SUITES: [string, string[]][] = [
  [`corpus (${CORPUS_SIZE} scenarios)`, ["m1/run.ts", "--engineB", engineB]],
  ["faults (5 injections)", ["m2/faults.ts", "--engineB", engineB]],
  ["partials (stream shape)", ["m2/partials.ts", "--engineB", engineB]],
  ["cross-resume (store)", ["m2/cross-resume.ts", "--engineB", engineB]],
  ["raw protocol (no sdk)", ["m2/raw-protocol.ts", "--engineB", engineB]],
  // C16b / W13b. In the FAITHFUL acceptance surface and not only in the
  // liveness loop, for the reason every suite here is: a scenario that runs
  // exclusively against sabotaged builds is never graded green, so nothing
  // notices the day it stops meaning what it meant.
  ["signals mid-turn (process lifecycle)", ["w13/signals.ts", "--engineB", engineB]],
];

const results: { name: string; pass: boolean; detail: string }[] = [];

for (const [name, argv] of SUITES) {
  process.stdout.write(`\n━━━ ${name} ━━━\n`);
  const r = spawnSync("npx", ["tsx", ...argv], { cwd: REFORGE_ROOT, encoding: "utf8" });
  // EVERY VERDICT, NOT A TAIL. This used to relay the last six matching lines,
  // which is the end of a 59-scenario verdict block: a corpus scenario that
  // failed anywhere but in the last five was dropped here, and the gate — whose
  // only view of a suite is what this loop prints — could not name it either.
  // The window was invisible on a green run and defeating on a red one, which
  // is the direction that matters.
  // stdout AND stderr: this is the FIRST hop, and a suite that throws before its
  // verdict block says why on the stream a stdout-only relay drops — after which
  // no layer above can name a cause it was never given.
  const { verdicts, fails, reasons, summary } = relayOutput(combinedOutput(r));
  for (const l of verdicts) console.log(`  ${l.trim()}`);
  // Two of the five suites state their result as prose rather than as a verdict
  // block, so a verdict-only relay would print nothing for them on a green run.
  for (const l of summary) console.log(`  ${l.trim()}`);
  // …and the lines that EXPLAIN a failure, which include the replay proxy's
  // positional-serve diagnostic — the commonest cause of a red run, and one
  // that is not itself a verdict.
  if (r.status !== 0) {
    for (const l of reasons) console.log(`  ${l.trim()}`);
    if (verdicts.length === 0 && reasons.length === 0) console.log(`  ${relayFallback(combinedOutput(r), r.error)}`);
  }
  results.push({
    name,
    pass: r.status === 0,
    detail: fails.length > 0
      ? `${fails.length} failing: ${fails.map((f) => f.trim().replace(/^FAIL\s+/, "")).join(", ")}`
      // "no verdict printed" was the old answer when a suite died before it
      // printed one, which named the suite and nothing else. The fallback line
      // carries the cause and is itself matched by `REASON_RE`, so the gate
      // relays it up unchanged.
      : (summary.at(-1)?.trim() || (r.status === 0 ? "" : relayFallback(combinedOutput(r), r.error))),
  });
}

console.log(`\n=== M2b full acceptance (B = ${engineB}) ===`);
// A failing suite carries WHAT failed onto its own summary line, so the five
// lines a caller reads last are self-contained rather than a pointer into the
// transcript above them.
for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail || "no verdict printed"}`}`);
const ok = results.every((r) => r.pass);
console.log(ok ? "\nALL SUITES PASS" : "\nFAILURES");
process.exitCode = ok ? 0 : 1;
