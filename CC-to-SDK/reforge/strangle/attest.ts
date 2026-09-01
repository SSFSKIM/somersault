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
// `--check` fails on an un-adjudicated branch and leaves the report alone;
// without it the report is rewritten. The gate runs `--check`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ENGINE_VERSION } from "../src/pin.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { branchSites, outcomesOf, type BranchSite } from "./branches.js";
import { ATTESTED, EXCLUSIONS } from "./attestation.js";
import { COVERAGE_DIR, SOURCE_MODULES } from "./instrument.js";

const checkOnly = process.argv.includes("--check");
const REPORT_DIR = join(REFORGE_ROOT, "attestation");
const REPORT = join(REPORT_DIR, "w2-descriptions.md");

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { cwd: REFORGE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ---- 1. the inventory --------------------------------------------------------
const sites = new Map<string, BranchSite[]>();
for (const a of ATTESTED) {
  sites.set(a.module, branchSites(a.module, join(SOURCE_MODULES, a.module, "reference.js")));
}
const inventory = [...sites.values()].flat().flatMap(outcomesOf);
if (inventory.length === 0) {
  // The canonical failure this whole mechanism exists to forbid: an empty
  // inventory that reports 100% coverage.
  console.log("FAIL — the branch inventory is empty; an attestation over nothing passes vacuously");
  process.exit(1);
}

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
const excluded = new Map(EXCLUSIONS.map((e) => [e.branch, e.reason]));

const rows: { branch: string; site: BranchSite; outcome: string; state: "executed" | "excluded" | "UNADJUDICATED"; reason?: string }[] = [];
for (const [, list] of sites) {
  for (const site of list) {
    for (const outcome of outcomesOf(site)) {
      const state = executed.has(outcome) ? "executed" : excluded.has(outcome) ? "excluded" : "UNADJUDICATED";
      rows.push({ branch: outcome, site, outcome: outcome.endsWith(":T") ? "true" : "false", state, reason: excluded.get(outcome) });
    }
  }
}
const unadjudicated = rows.filter((r) => r.state === "UNADJUDICATED");
// An exclusion for a branch that no longer exists, or that the corpus now
// reaches, is stale bookkeeping — and a stale exclusion is how a real gap hides.
const stale = [...excluded.keys()].filter((b) => !inventory.includes(b) || executed.has(b));
const nExecuted = rows.filter((r) => r.state === "executed").length;

const lines: string[] = [
  `# Coverage attestation — W2 tool descriptions (${ENGINE_VERSION})`,
  "",
  `Generated by \`npx tsx strangle/attest.ts\` (campaign spec §3.1). The inventory is AST-derived and`,
  `complete: \`strangle/branches.ts\` refuses any branch-forming construct it cannot record, so a module`,
  `it cannot instrument fails the run rather than reporting a partial inventory.`,
  "",
  `- modules attested: **${sites.size}** — ${[...sites.keys()].join(", ")}`,
  `- branch sites: **${[...sites.values()].flat().length}**, outcomes: **${inventory.length}**`,
  `- executed by the corpus: **${nExecuted}**`,
  `- reviewed exclusions: **${rows.filter((r) => r.state === "excluded").length}**`,
  `- un-adjudicated: **${unadjudicated.length}**`,
  `- scenarios replayed: ${scenarios.join(", ")}`,
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
  "Every exclusion above is a branch the CORPUS does not render, not a branch nothing checks.",
  "`strangle/description-parity.test.ts` evaluates the pinned upstream function with stubbed ports over",
  "the full cross-product of these same branches and requires byte identity with the owned module — so",
  "each excluded arm is graded against upstream directly rather than against a scenario's rendering of it.",
  "",
);

if (!checkOnly) {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT, lines.join("\n"));
  console.log(`report → ${REPORT}`);
}

console.log(`\n=== coverage attestation: ${nExecuted}/${inventory.length} executed, ${rows.length - nExecuted - unadjudicated.length} excluded ===`);
for (const r of unadjudicated) console.log(`  FAIL  ${r.branch} — ${r.site.kind} '${r.site.text}' never took the ${r.outcome} arm and carries no reviewed exclusion`);
for (const b of stale) console.log(`  FAIL  stale exclusion ${b} — ${inventory.includes(b) ? "the corpus now executes it" : "no such branch in the inventory"}`);
const ok = unadjudicated.length === 0 && stale.length === 0;
console.log(ok ? "\nPASS — every branch of every attested module is executed or carries a reviewed exclusion" : "\nFAIL");
process.exit(ok ? 0 : 1);
