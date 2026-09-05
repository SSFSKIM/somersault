// C13c / W10c — record ONE W10 corpus scenario, live, before it joins the corpus.
//
//   cd reforge && set -a; . ../.env; set +a
//   npx tsx w10/record.ts --scenario bash-background-explicit
//   npx tsx w10/record.ts --list
//
// ## Why not `m1/run.ts --scenario <tag>`
//
// Because registration and recording would then be the same act. `m1/run.ts`
// records any registered scenario that has no cassette, and the gate runs it —
// so registering six cassette-less scenarios would arm six LIVE takes inside
// somebody else's gate run, using somebody else's credential and somebody
// else's throttle budget. Recording first and registering second makes
// "this scenario is part of the corpus" a claim the repository can only make
// about a scenario that already has a cassette to answer with.
//
// X5, one at a time: this tool records exactly one tag per invocation and
// refuses a run with no `--scenario`, because a loop over six live takes is six
// chances to spend a throttle budget on a take whose predecessor already told
// you something you should have acted on.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireRecordCredential } from "../src/env.js";
import { EMPTY_PRECONDITION } from "../src/harness.js";
import { recordCassette } from "../src/record.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { W10_SCENARIOS } from "./scenarios.js";

const args = process.argv.slice(2);
const cassetteFor = (tag: string) => join(REFORGE_ROOT, "cassettes", `m1-${tag}.jsonl`);
const sidecarFor = (tag: string) => join(REFORGE_ROOT, "cassettes", `m1-${tag}.precondition.json`);

if (args.includes("--list")) {
  console.log("=== W10 corpus scenarios ===");
  for (const s of W10_SCENARIOS) {
    console.log(`  ${existsSync(cassetteFor(s.tag)) ? "recorded" : "MISSING "}  ${s.tag.padEnd(28)} ${s.title}`);
  }
  process.exit(0);
}

const idx = args.indexOf("--scenario");
const tag = idx >= 0 ? args[idx + 1] : undefined;
if (tag === undefined || tag.startsWith("--")) {
  console.error(`ABORT: --scenario <tag> is required (one at a time, X5). Known: ${W10_SCENARIOS.map((s) => s.tag).join(", ")}`);
  process.exit(2);
}
const s = W10_SCENARIOS.find((x) => x.tag === tag);
if (s === undefined) {
  console.error(`ABORT: unknown scenario '${tag}'. Known: ${W10_SCENARIOS.map((x) => x.tag).join(", ")}`);
  process.exit(2);
}
const force = args.includes("--rerecord");
if (existsSync(cassetteFor(tag)) && !force) {
  console.log(`${tag}: a cassette already exists — pass --rerecord to replace it deliberately.`);
  process.exit(0);
}

requireRecordCredential();
console.log(`━━━ recording ${s.tag} — ${s.title} ━━━`);
console.log(`  declared detachments: ${s.detachedChildren === undefined ? "<none declared>" : JSON.stringify(s.detachedChildren)}`);

let out;
try {
  out = await recordCassette({
    scenario: s,
    declared: s.precondition ?? EMPTY_PRECONDITION,
    cassette: cassetteFor(tag),
    sidecar: sidecarFor(tag),
    // The corpus's own engine under test. It decides only whether a positional
    // fallback is fatal, and for a fresh recording there is nothing to fall back
    // to; naming it keeps the record path identical to the graded one.
    engineB: "engine-extracted",
  });
} catch (e) {
  // A REFUSED SANDBOX LOCK is the expected shape of "a sibling is running", and
  // it arrives as a thrown Error. Printed as its message rather than as a stack
  // trace, because the message is the thing an operator (and the retry loop
  // above this) reads, and a stack trace buries it under six harness frames.
  console.log(`  REFUSED: ${String((e as Error).message).split("\n")[0]}`);
  process.exit(2);
}

if (!out.ok) {
  console.log(`  DISCARDED: ${out.reason}`);
  console.log(`  Nothing was promoted. Re-run when the cause is addressed: npx tsx w10/record.ts --scenario ${tag}`);
  process.exitCode = 1;
} else {
  console.log(`  recorded ${out.exchanges} API exchange(s) → ${cassetteFor(tag)}`);
  console.log(`  sidecar written → ${sidecarFor(tag)}`);
  console.log(`PASS  ${tag}`);
}
