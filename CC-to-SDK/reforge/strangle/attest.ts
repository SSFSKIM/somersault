// COVERAGE ATTESTATION (campaign spec §3.1) — the S-chunk tier's extra
// obligation, debuting with W2.
//
//   npx tsx strangle/attest.ts [--check]
//
// "A scenario exists" and "the scenario covers the code" are different claims,
// and the gate only ever proved the first: solo-sabotage reddens a covering
// scenario even when the corpus renders one branch of six, and after C4's
// retrofit the *implementation* of the other five is ours. So:
//
//   1. every attested module's branches are enumerated from its AST
//      (strangle/branches.ts — complete, or the run fails);
//   2. the strangled graph is rebuilt against an INSTRUMENTED copy of those
//      modules (strangle/instrument.ts) — same code, plus a branch recorder;
//   3. the covering scenarios are replayed offline against it, and must stay
//      GREEN: an instrumented build that diverges is measuring something else;
//   4. what ran is compared against the inventory, and every branch that did not
//      run must carry a reviewed exclusion in strangle/attestation.ts.
//
// `--check` fails on an un-adjudicated branch and leaves the report alone — but
// it also fails when the report ON DISK is not what this run would write (§5),
// because a committed artifact nobody diffs goes stale silently. Without
// `--check` the report is rewritten. The gate runs `--check`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ENGINE_VERSION } from "../src/pin.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { branchSites, type BranchSite } from "./branches.js";
import { adjudicate } from "./adjudicate.js";
import { ATTESTED, EXCLUSIONS } from "./attestation.js";
import { COVERAGE_DIR, SOURCE_MODULES } from "./instrument.js";

const checkOnly = process.argv.includes("--check");
const REPORT_DIR = join(REFORGE_ROOT, "attestation");
// One report for every attested module, not one per wave: the inventory is
// generated from `ATTESTED` in a single run, so a per-wave file would either
// duplicate it or go stale the moment the next wave added a module.
const REPORT = join(REPORT_DIR, "coverage.md");

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { cwd: REFORGE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ---- 1. the inventory --------------------------------------------------------
const sites = new Map<string, BranchSite[]>();
const branchless: { module: string; reason: string }[] = [];
for (const a of ATTESTED) {
  const found = branchSites(a.module, join(SOURCE_MODULES, a.module, "reference.js"));
  // A module with no branches contributes no rows, so listing it here would be
  // an attestation of nothing — the vacuity failure one level down from the
  // empty-inventory check below. It passes only with a written reason naming
  // what grades the module instead.
  if (found.length === 0) {
    if (!a.noBranchesReason) {
      console.log(`FAIL — attested module '${a.module}' has no branches and no reviewed reason; it would be attested by omission`);
      process.exit(1);
    }
    branchless.push({ module: a.module, reason: a.noBranchesReason });
  } else if (a.noBranchesReason) {
    // The stale-exclusion rule, one level up: a reason that stopped being true
    // must fail rather than sit there excusing branches it never described.
    console.log(`FAIL — attested module '${a.module}' declares noBranchesReason but now has ${found.length} branch site(s); re-adjudicate it`);
    process.exit(1);
  }
  sites.set(a.module, found);
}
const allSites = [...sites.values()].flat();
if (adjudicate(allSites, [], new Set()).vacuous) {
  // The canonical failure this whole mechanism exists to forbid: an empty
  // inventory that reports 100% coverage.
  console.log("FAIL — the branch inventory is empty; an attestation over nothing passes vacuously");
  process.exit(1);
}
const inventory = adjudicate(allSites, [], new Set()).inventory;

// ---- 2. build instrumented ---------------------------------------------------
console.log(`coverage attestation @ ${ENGINE_VERSION} — ${sites.size} module(s), ${inventory.length} branch outcome(s)`);
const built = run("npx", ["tsx", "strangle/build.ts", "--instrument"]);
if (built.status !== 0) {
  console.log(`FAIL — instrumented build failed: ${`${built.stdout}${built.stderr}`.trim().split("\n").slice(-3).join(" | ")}`);
  process.exit(1);
}

// ---- 3. replay the covering scenarios ----------------------------------------
const scenarios = [...new Set(ATTESTED.flatMap((a) => a.scenarios))].sort();
const red: string[] = [];
for (const tag of scenarios) {
  const r = run("npx", ["tsx", "m1/run.ts", "--scenario", tag, "--engineB", "engine-strangled"]);
  const ok = r.status === 0;
  console.log(`  ${tag}: ${ok ? "GREEN" : "RED"}`);
  if (!ok) red.push(tag);
}
if (red.length > 0) {
  console.log(`FAIL — the instrumented build is not equivalent (${red.join(", ")} went red); coverage measured on it would describe a different engine`);
  process.exit(1);
}

// ---- 4. adjudicate -----------------------------------------------------------
const executed = new Set<string>();
if (existsSync(COVERAGE_DIR)) {
  for (const f of readdirSync(COVERAGE_DIR)) {
    for (const line of readFileSync(join(COVERAGE_DIR, f), "utf8").split("\n")) if (line) executed.add(line);
  }
}
// The rules themselves live in strangle/adjudicate.ts — pure, so
// strangle/attest.test.ts can put each one in front of the fixture that violates
// it without running a build (an unexecuted branch, a stale exclusion in either
// direction, an empty inventory).
const verdict = adjudicate(allSites, EXCLUSIONS, executed);
const { rows, unadjudicated, stale } = verdict;
const nExecuted = verdict.executedCount;

const lines: string[] = [
  `# Coverage attestation — the owned modules (${ENGINE_VERSION})`,
  "",
  `Generated by \`npx tsx strangle/attest.ts\` (campaign spec §3.1). The inventory is AST-derived and`,
  `complete: \`strangle/branches.ts\` refuses any branch-forming construct it cannot record, so a module`,
  `it cannot instrument fails the run rather than reporting a partial inventory.`,
  "",
  `- modules attested: **${sites.size}** — ${[...sites.keys()].join(", ")}`,
  `- branch sites: **${[...sites.values()].flat().length}**, outcomes: **${inventory.length}**`,
  `- executed by the corpus: **${nExecuted}**`,
  `- reviewed exclusions: **${verdict.excludedCount}**`,
  `- un-adjudicated: **${unadjudicated.length}**`,
  `- scenarios replayed: ${scenarios.join(", ")}`,
  ...(branchless.length > 0
    ? ["", "Modules with NO branch-forming construct, and what grades them instead:", "", ...branchless.map((b) => `- \`${b.module}\` — ${b.reason}`)]
    : []),
  "",
  "| branch | kind | condition | outcome | state | adjudication |",
  "|---|---|---|---|---|---|",
];
for (const r of rows) {
  lines.push(
    `| \`${r.branch}\` | ${r.site.kind} | \`${r.site.text.replaceAll("|", "\\|")}\` | ${r.outcome} | ${r.state} | ${r.reason ?? (r.state === "executed" ? "—" : "**MISSING**")} |`,
  );
}
lines.push(
  "",
  "## What grades an excluded branch",
  "",
  "Every exclusion above is a branch the CORPUS does not render, not a branch nothing checks. FIVE",
  "upstream-differential contract tests are the oracle, one per wave's modules:",
  "",
  "- `strangle/description-parity.test.ts` — the four tool descriptions (W2);",
  "- `strangle/prompt-parity.test.ts` — the prompt-assembly pipeline and the compaction prompt (W3);",
  "- `strangle/compaction-parity.test.ts` — the compaction trigger, boundary and continuation (W4);",
  "- `strangle/hooks-parity.test.ts` — the twenty per-event hook dispatchers (W5);",
  "- `strangle/permissions-parity.test.ts` — the permission decision chain, the mode axis and the",
  "  headless broker seam (W6). This one also compares the PORT TRACE, because two refusals that",
  "  return the same value can differ in nothing but which ports ran.",
  "",
  "All five extract the upstream body from the PINNED BUNDLE, evaluate it with stubbed ports, and require",
  "identity with the owned module over the full cross-product of these same branches — so each excluded",
  "arm is graded against upstream directly rather than against a scenario's rendering of it. None of",
  "them hand-writes an expectation, so none of them can encode a transcription error.",
  "",
);

const body = lines.join("\n");

// ---- 5. the report is an artifact, and artifacts go stale --------------------
// A committed file that nothing ever diffs drifts away from the run that made it
// the moment the manifest moves — and this one has done so twice, still naming a
// module the manifest had dropped and still quoting counts no run produces, while
// the gate stayed green because `--check` only ever asked whether the CURRENT run
// adjudicates cleanly. That is the adjudicator's own false-green failure one level
// up: a green attestation over a report nobody can trust. So `--check` also grades
// the committed bytes against the bytes this run would write, and a missing report
// fails the same way. The body is a pure function of the pin, the manifest, the
// AST inventory and the recorded outcomes — no clock, no absolute path, no
// iteration order that a rebuild can permute — so a difference is always real
// drift, and the fix is always to re-run the generator and commit what it writes.
const drift: string[] = [];
if (checkOnly) {
  const fix = "re-run `npx tsx strangle/attest.ts` (no --check) and commit the result";
  if (!existsSync(REPORT)) {
    drift.push(`FAIL — no committed report at attestation/coverage.md; ${fix}`);
  } else {
    const committed = readFileSync(REPORT, "utf8");
    if (committed !== body) {
      const was = committed.split("\n");
      const now = body.split("\n");
      const n = Math.max(was.length, now.length);
      let i = 0;
      while (i < n && was[i] === now[i]) i++;
      const show = (s: string | undefined) => (s === undefined ? "<end of file>" : JSON.stringify(s.length > 200 ? `${s.slice(0, 200)}…` : s));
      drift.push(
        `FAIL — the committed attestation/coverage.md is STALE (${was.length} lines on disk, ${now.length} generated); first difference at line ${i + 1}: committed ${show(was[i])} vs generated ${show(now[i])}`,
        `FAIL — this run measures ${nExecuted}/${inventory.length} executed, ${verdict.excludedCount} excluded, ${unadjudicated.length} un-adjudicated; ${fix}`,
      );
    }
  }
} else {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT, body);
  console.log(`report → ${REPORT}`);
}

console.log(`\n=== coverage attestation: ${nExecuted}/${inventory.length} executed, ${rows.length - nExecuted - unadjudicated.length} excluded ===`);
for (const r of unadjudicated) console.log(`  FAIL  ${r.branch} — ${r.site.kind} '${r.site.text}' never took the ${r.outcome} arm and carries no reviewed exclusion`);
for (const s of stale) console.log(`  FAIL  stale exclusion ${s.branch} — ${s.why}`);
for (const d of drift) console.log(d);
const ok = verdict.ok && drift.length === 0;
console.log(
  ok
    ? `\nPASS — every branch of every attested module is executed or carries a reviewed exclusion${checkOnly ? ", and the committed report is this run's own output" : ""}`
    : "\nFAIL",
);
process.exit(ok ? 0 : 1);
