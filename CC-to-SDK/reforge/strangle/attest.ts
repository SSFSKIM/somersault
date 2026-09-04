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
//   3b. any DIFFERENTIAL CONTRACT DRIVER a module declares is then run against
//      the same instrumented build, in its own process, so what it executes is
//      recorded and attributed apart from what the corpus executed (C13a);
//   4. what ran is compared against the inventory, and every branch that neither
//      the corpus nor a contract suite executed must carry a reviewed exclusion
//      in strangle/attestation.ts.
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
import { runnerFor } from "./runners.js";
import { relayFailure } from "../m2/relay.js";
import { teeToBuildLog } from "./teelog.js";
import { acquireSandboxLock } from "../src/lock.js";

const checkOnly = process.argv.includes("--check");
// The same archive the gate keeps, for the same reason: the executed/excluded
// counts are quoted in every wave record and the run that produced them wrote
// to a terminal (`strangle/teelog.ts`).
console.log(`attestation log: ${teeToBuildLog("attest")}`);
// Held for the whole run, for the same reason the gate holds it: this replays
// covering scenarios as child processes and each one resets the sandbox.
acquireSandboxLock("the coverage attestation");
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
  // Same routing the gate uses (strangle/runners.ts): a tag graded by its own
  // suite must be replayed through that suite here too, or the instrumented
  // build would never execute the branches it covers.
  const r = run("npx", ["tsx", ...runnerFor(tag, "engine-strangled")]);
  const ok = r.status === 0;
  console.log(`  ${tag}: ${ok ? "GREEN" : "RED"}`);
  if (!ok) {
    // A PHASE THAT CAN FAIL HAS TO SAY WHAT FAILED, and this one did not. The
    // child's stdout was captured and dropped, so a covering scenario that
    // reddened on the instrumented build was reported as a TAG and nothing
    // more — not which of the four surfaces moved, not by how much. Measured:
    // one such report cost a full gate cycle and a manual rebuild, and the
    // answer turned out to be that the difference did not reproduce at all.
    //
    // Relayed through `m2/relay.ts` rather than a regex of its own, for the
    // reason that file's own header gives: the rule only holds if every layer
    // between the failure and the log agrees on what a failure looks like.
    //
    // `relayFailure` and not `relayOutput`, because the first version of this
    // fix relayed `r.stdout` alone and returned two EMPTY arrays for a runner
    // that died before printing a verdict — a module-load throw on the
    // instrumented graph writes to stderr, and a spawn that never ran writes
    // nowhere at all. Same tag-and-nothing-else report, one layer over.
    for (const l of relayFailure(r)) console.log(`    ${l}`);
    red.push(tag);
  }
}
if (red.length > 0) {
  console.log(`FAIL — the instrumented build is not equivalent (${red.join(", ")} went red); coverage measured on it would describe a different engine`);
  process.exit(1);
}

// ---- 3b. contract evidence ---------------------------------------------------
// A second executed-set, from the differential contract suites that grade what
// the corpus cannot reach. See `AttestedModule.contract` for when a module earns
// one and `strangle/adjudicate.ts` for why the two sets are reported apart.
//
// Attribution is by RECORDER FILE and by BYTE OFFSET inside it. The recorder
// appends, one file per PID, so everything the corpus replays wrote is a prefix
// of what is on disk when the drivers finish — and reading only the suffix means
// a driver whose PID happens to collide with a finished engine's is still
// attributed correctly rather than crediting the engine's work to the suite.
const coverageFiles = (): Map<string, string> => {
  const out = new Map<string, string>();
  if (!existsSync(COVERAGE_DIR)) return out;
  for (const f of readdirSync(COVERAGE_DIR)) out.set(f, readFileSync(join(COVERAGE_DIR, f), "utf8"));
  return out;
};
const linesOf = (text: string): string[] => text.split("\n").filter((l) => l !== "");

const beforeContract = coverageFiles();
const executed = new Set<string>();
for (const text of beforeContract.values()) for (const line of linesOf(text)) executed.add(line);

const contract = new Set<string>();
const contractSuites = ATTESTED.filter((a) => a.contract !== undefined);
for (const a of contractSuites) {
  const driver = a.contract!.driver;
  const r = run("npx", ["tsx", driver]);
  console.log(`  contract driver ${driver} (${a.module}): ${r.status === 0 ? "ran" : "FAILED"}`);
  if (r.status !== 0) {
    // A driver that did not run recorded nothing, and every branch it was going
    // to cover would fall through to UNADJUDICATED — thousands of them, reported
    // as a coverage gap rather than as the broken driver it is. Fail here, where
    // the cause is still legible.
    for (const l of relayFailure(r)) console.log(`    ${l}`);
    console.log(`FAIL — the contract driver for '${a.module}' did not run, so its branch evidence is missing rather than absent`);
    process.exit(1);
  }
}
const afterContract = coverageFiles();
for (const [file, text] of afterContract) {
  const already = beforeContract.get(file) ?? "";
  const suffix = text.startsWith(already) ? text.slice(already.length) : text;
  for (const line of linesOf(suffix)) if (!executed.has(line)) contract.add(line);
}
if (contractSuites.length > 0 && contract.size === 0) {
  console.log("FAIL — the contract drivers recorded no branch outcome at all; they ran against something that is not the instrumented build");
  process.exit(1);
}

// ---- 4. adjudicate -----------------------------------------------------------
// The rules themselves live in strangle/adjudicate.ts — pure, so
// strangle/attest.test.ts can put each one in front of the fixture that violates
// it without running a build (an unexecuted branch, a stale exclusion in either
// direction, an empty inventory).
const verdict = adjudicate(allSites, EXCLUSIONS, executed, contract);
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
  `- executed by a differential contract suite: **${verdict.contractCount}**`,
  `- reviewed exclusions: **${verdict.excludedCount}**`,
  `- un-adjudicated: **${unadjudicated.length}**`,
  `- scenarios replayed: ${scenarios.join(", ")}`,
  ...(contractSuites.length > 0
    ? [`- contract drivers run: ${contractSuites.map((a) => `\`${a.contract!.driver}\` (${a.module})`).join(", ")}`]
    : []),
  ...(branchless.length > 0
    ? ["", "Modules with NO branch-forming construct, and what grades them instead:", "", ...branchless.map((b) => `- \`${b.module}\` — ${b.reason}`)]
    : []),
  "",
  "| branch | kind | condition | outcome | state | adjudication |",
  "|---|---|---|---|---|---|",
];
// Which contract suite covers which module, so a `contract` row's adjudication
// column names the suite that ran it rather than repeating one sentence a
// thousand times. The reason a reader needs per row is WHICH oracle; the reason
// they need once is why that oracle counts, and that is the section below.
const contractDriver = new Map(ATTESTED.filter((a) => a.contract).map((a) => [a.module, a.contract!.driver]));
const moduleOf = (branch: string): string => branch.slice(0, branch.indexOf("#"));
for (const r of rows) {
  const adjudication =
    r.state === "executed"
      ? "—"
      : r.state === "contract"
        ? `\`${contractDriver.get(moduleOf(r.branch)) ?? "?"}\``
        : (r.reason ?? "**MISSING**");
  lines.push(
    `| \`${r.branch}\` | ${r.site.kind} | \`${r.site.text.replaceAll("|", "\\|")}\` | ${r.outcome} | ${r.state} | ${adjudication} |`,
  );
}
lines.push(
  "",
  "## What grades a branch the corpus does not execute",
  "",
  "Two things, and the table above says which applies to each branch.",
  "",
  "A `contract` row was EXECUTED — not by a corpus replay, but by a differential suite driven against",
  "this same instrumented build and recorded the same way. That is a measurement, not an adjudication,",
  "and it is why those rows carry a script path rather than a sentence. It is also, for a branch no",
  "scenario renders, the stronger of the two kinds of evidence: the suite ran the branch against",
  "UPSTREAM'S OWN implementation of it and required the outputs to be identical, where a scenario could",
  "only ever have compared what its transcript happened to show.",
  "",
  "An `excluded` row was not executed at all, and carries a reviewed reason. FIVE upstream-differential",
  "contract tests are the oracle behind those reasons, one per wave's modules:",
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
  ...(contractSuites.length > 0
    ? [
        "The sixth is the one whose coverage is measured rather than argued, and it is why the `contract`",
        "state exists:",
        "",
        ...contractSuites.map((a) => `- \`${a.module}\` — ${a.contract!.why}`),
        "",
      ]
    : []),
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

console.log(
  `\n=== coverage attestation: ${nExecuted}/${inventory.length} executed, ${verdict.contractCount} by contract suite, ${verdict.excludedCount} excluded ===`,
);
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
