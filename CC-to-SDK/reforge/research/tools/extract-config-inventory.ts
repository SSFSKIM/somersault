// §3.3 / C12a-W9a — what the ENGINE writes into the harness config dir, as a
// pin-keyed population.
//
//   npx tsx research/tools/extract-config-inventory.ts [--check]
//
// WHY THIS FIXTURE EXISTS, and it is not the reset. `resetSandbox()` wipes the
// config dir whole, so the reset itself needs no inventory — `rm -rf` does not
// care what is there. The inventory exists because THE STATE SURFACE'S CONFIG
// ROOT IS AN INCLUDE-LIST (src/state.ts, the W9 scout's §4.2): six declared
// families are graded and everything else is invisible by construction. That is
// the right design — the tree carries clock-named backups and per-process
// scratch, and a whole-tree walk would flag every run on paths that mean nothing
// — but it has one failure mode, and it is silent: a pin that starts writing a
// SEVENTH family is seen by nothing. Not by the surface (not admitted), not by
// the reset (deleted either way), not by the corpus (the file never reaches a
// transcript).
//
// So the population is measured rather than assumed. Every reset censuses the
// tree before deleting it (`src/observed.ts`) into `build/config-observed.json`,
// generalizing each path to a pattern; this tool holds that census against the
// committed inventory and states, per pattern, whether the state surface admits
// it. An undeclared pattern is a FAILURE with the include-list named in the
// message: either the surface should grade it, or the inventory should say why
// not.
//
// THE CENSUS IS THE ARTIFACT, and it accumulates across resets deliberately.
// After the reset policy landed, the config dir at the END of a corpus run holds
// one scenario's writes — a census taken there would see 1/83rd of the
// population. Taken at every reset it sees all of it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_VERSION } from "../../src/pin.js";
import { REFORGE_ROOT } from "../../src/runTurn.js";
import { configDescend, configInclude } from "../../src/state.js";
import { generalizePath } from "../../src/observed.js";
import type { ConfigCensus } from "../../src/observed.js";

const CENSUS = join(REFORGE_ROOT, "build", "config-observed.json");
const FIXTURE = join(REFORGE_ROOT, "research", "fixtures", `config-dir-inventory-${ENGINE_VERSION}.json`);
const check = process.argv.includes("--check");

interface Row {
  /** the generalized path (see src/observed.ts `generalizePath`) */
  pattern: string;
  kind: "file" | "dir";
  /** how many resets found it, at generation time — a FLOOR: a corpus that grows may see it more often */
  seenAtLeast: number;
  /** what the state surface's include-list does with it */
  graded: "admitted" | "not-admitted";
  /** why a `not-admitted` row is out — carried HERE, next to the pattern, not only in the include-list's comment */
  why?: string;
}

/**
 * THE REASON EACH PATTERN IS WHERE IT IS, keyed by pattern. A row that says only
 * `not-admitted` records a decision without recording who made it or why; these
 * are the sentences a later wave needs in order to disagree.
 *
 * Every `not-admitted` row MUST have one — a row without one is generated
 * carrying the `UNEXPLAINED` sentinel, and `--check` refuses it. That refusal is
 * the point: the sentinel was written as a placeholder and nothing read it, so a
 * generation could mint one and the gate would still be green. An `admitted` row
 * may have one too, when its provenance is not obvious from the pattern (see the
 * `sessions/<pid>.…` rows).
 */
const PATTERN_REASONS: Record<string, string> = {
  ".last-cleanup": "a maintenance stamp — a clock in a file, with no claim about behaviour in it",
  backups: "the engine's own backup of .claude.json, in a directory whose entries are named by epoch-ms",
  "backups/.claude.json.backup.<ms>": "clock in the FILENAME, so two engines can never agree on it; the file it backs up is graded",
  "projects/<slug>/.keep": "the harness's OWN seed for the store-read-only fault, not an engine write",
  "projects/<slug>/<uuid>/auto-mode-classifier-error.txt": "the auto-mode classifier's error dump — C9/W6's artifact, not the session store's",
  // THE ONE FAMILY DECLARED FROM AN INCIDENT RATHER THAN FROM A CLEAN RUN. A
  // reviewer killed a standalone `attest --check` mid-run; its orphaned engine
  // child left `sessions/10747.json` and its `.key` behind, and the next reset
  // censused both. `sessions/` itself has been censused 1,768 times and has been
  // EMPTY every one of them but that: the engine removes its own peer-registry
  // file on a clean exit, so the family exists only as the residue of an
  // unclean kill.
  //
  // Note what these rows are NOT: `generalizePath` has no `<pid>` token, so it
  // cannot MINT one of these patterns — a real `sessions/12345.json` would
  // arrive undeclared and red the tripwire. That is the safe direction and it is
  // deliberate. The projection is deferred (CC-to-SDK/docs/tech-debt-tracker.md)
  // until a scenario reaches the family on purpose; until then these two rows
  // record what was seen and why it is not a population.
  "sessions/<pid>.json":
    "the peer/session registry entry, left only by an UNCLEANLY killed engine child — 0 of 1,768 clean resets produce one. " +
    "src/state.ts hashes `sessions/**` raw, so a run that ever leaves one reds loudly on a pid-named path (the safe direction); " +
    "project the family into a <pid> pattern when a scenario reaches it deliberately.",
  "sessions/<pid>.<hex>.key":
    "the registry entry's key file, same provenance and same disposition as `sessions/<pid>.json` above.",
  "session-env": "per-process scratch; the corpus leaves one empty directory per session and no content",
  "session-env/<uuid>": "as above, and named by a run-scoped uuid",
  "shell-snapshots":
    "THE BASH EXECUTOR'S artifact, not storage's: a shell snapshot is minted per shell spawn and named by a clock. " +
    "If it is ever graded it belongs to C13d's root, which is where the executor's own state lives.",
  "shell-snapshots/snapshot-zsh-<ms>-<rand>.sh":
    "as above — clock plus a random suffix in the filename. This is the row that failed a gate: it is written on some runs " +
    "and not others, so a census that did not see it dropped it from the declared set and the next run reddened on a file that is not new.",
};

interface Fixture {
  engineVersion: string;
  generatedBy: string;
  note: string;
  counts: { patterns: number; admitted: number; notAdmitted: number; resetsObserved: number };
  entries: Row[];
}

function census(): ConfigCensus {
  if (!existsSync(CENSUS)) {
    console.log(`FAIL  no census at ${CENSUS} — it is written by resetSandbox(); run the corpus first (npx tsx m2/all.ts --engineB engine-extracted)`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(CENSUS, "utf8")) as ConfigCensus;
  if (doc.engineVersion !== ENGINE_VERSION) {
    console.log(`FAIL  census was taken at ${doc.engineVersion}, the pin is ${ENGINE_VERSION} — delete build/config-observed.json and re-run the corpus`);
    process.exit(1);
  }
  return doc;
}

/**
 * A generalized pattern, run through the include-list by substituting a
 * concrete-looking segment. A DIRECTORY is admitted when the walk descends into
 * it — the surface records it as an entry, so calling it "not graded" because it
 * is not a file would have understated what the include-list covers.
 */
const admits = (pattern: string, kind: "file" | "dir"): boolean => {
  const concrete = 
    pattern
      .replace(/<slug>/g, "-box-sandbox")
      .replace(/<uuid>/g, "00000000-0000-4000-8000-000000000000")
      .replace(/<agent-id>/g, "a0123456789abcdef")
      .replace(/<ms>/g, "1788415170183")
      .replace(/<rand>/g, "abc123")
      .replace(/<hex>/g, "0123456789abcdef");
  return kind === "dir" ? configDescend(concrete) : configInclude(concrete) !== null;
};

const UNEXPLAINED = "UNEXPLAINED — an excluded pattern with no recorded reason is a decision nobody made";

/** The reason clause of a row: mandatory for an exclusion, optional for an inclusion. */
const whyOf = (pattern: string, admitted: boolean): { why?: string } => {
  const why = PATTERN_REASONS[pattern];
  if (why !== undefined) return { why };
  return admitted ? {} : { why: UNEXPLAINED };
};

const doc = census();
// The census's keys are re-generalized on the way in, so a census written by an
// older `generalizePath` collapses into today's patterns instead of arriving as
// a pile of undeclared ones.
const merged = new Map<string, { kind: "file" | "dir"; seen: number }>();
for (const [raw, e] of Object.entries(doc.entries)) {
  const key = generalizePath(raw);
  const prior = merged.get(key);
  merged.set(key, { kind: e.kind, seen: (prior?.seen ?? 0) + e.seen });
}
// GENERATION UNIONS WITH THE COMMITTED FIXTURE, because this population is
// SAMPLED and the sample is a corpus run. A pattern the engine writes rarely —
// `shell-snapshots/snapshot-zsh-<ms>-<rand>.sh` is written on some runs and not
// others — drops out of a census that did not happen to see it, and regenerating
// from that census would silently narrow the declared population and then FAIL
// the very next run for a file that is not new. Measured: exactly that, one gate
// run wasted on it. So the declared set only grows; `--check` still refuses
// anything undeclared, which is the tripwire this fixture exists to be, and a
// pattern that has genuinely stopped being written is reported as a note rather
// than removed by an accident of sampling.
const priorRows: Row[] = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture).entries : [];
for (const r of priorRows) if (!merged.has(r.pattern)) merged.set(r.pattern, { kind: r.kind, seen: 0 });
const priorSeen = new Map(priorRows.map((r) => [r.pattern, r.seenAtLeast]));
const rows: Row[] = [...merged]
  .map(([pattern, e]) => ({
    pattern,
    kind: e.kind,
    // The floor is the largest census this population has been observed over,
    // not the latest one — a shorter run must not lower a recorded floor.
    seenAtLeast: Math.max(e.seen, priorSeen.get(pattern) ?? 0),
    graded: (admits(pattern, e.kind) ? "admitted" : "not-admitted") as Row["graded"],
    ...whyOf(pattern, admits(pattern, e.kind)),
  }))
  .sort((a, b) => a.pattern.localeCompare(b.pattern));

const fx: Fixture = {
  engineVersion: ENGINE_VERSION,
  generatedBy: "research/tools/extract-config-inventory.ts",
  note:
    "Every path present in CONFIG_DIR at reset time, generalized to a pattern and observed by resetSandbox()'s census — the state a run LEAVES, " +
    "which is engine writes plus whatever the previous scenario's precondition seeded (projects/<slug>/.keep is store-read-only's seed, not an engine write). " +
    "PROVENANCE: the declared set is the UNION of every census taken at this pin, not the latest one. The census is a SAMPLE — one corpus run — and some " +
    "families are written on some runs and not others, so regenerating from a single census narrows the population and reddens the next run for a file that " +
    "is not new. `resetsObserved` is the census this generation read; `seenAtLeast` is the largest count any census has recorded for that pattern. " +
    "`graded` says what src/state.ts's include-list does with it: a `not-admitted` row is invisible to the state surface BY DECISION, " +
    "and a pattern that is not in this list at all is invisible by ACCIDENT — which is what --check refuses.",
  counts: {
    patterns: rows.length,
    admitted: rows.filter((r) => r.graded === "admitted").length,
    notAdmitted: rows.filter((r) => r.graded === "not-admitted").length,
    resetsObserved: doc.resets,
  },
  entries: rows,
};

if (!check) {
  writeFileSync(FIXTURE, JSON.stringify(fx, null, 2) + "\n");
  console.log(`=== config-dir inventory (pin ${ENGINE_VERSION}) ===`);
  for (const r of rows) console.log(`  ${r.graded === "admitted" ? "GRADED    " : "not graded"}  ${r.pattern}  (${r.kind}, seen ${r.seenAtLeast}× over ${doc.resets} resets)`);
  console.log(`PASS — wrote ${rows.length} pattern(s), ${fx.counts.admitted} admitted by the state surface, over ${doc.resets} resets`);
} else {
  if (!existsSync(FIXTURE)) {
    console.log(`FAIL  no committed inventory at ${FIXTURE} — generate it with: npx tsx research/tools/extract-config-inventory.ts`);
    process.exit(1);
  }
  const committed = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
  const declared = new Map(committed.entries.map((r) => [r.pattern, r]));
  const problems: string[] = [];
  /** floors the census has outgrown — a note, because every corpus run raises them */
  const stale: string[] = [];
  // (1) THE TRIPWIRE. A path the engine wrote that this pin's inventory does not
  // declare — the state surface cannot see it and nothing else would have.
  for (const r of rows) {
    const d = declared.get(r.pattern);
    if (d === undefined) {
      problems.push(
        `the engine wrote '${r.pattern}' (${r.kind}), which the pinned inventory does not declare — decide whether ` +
          `src/state.ts's include-list should admit it, then regenerate`,
      );
      continue;
    }
    if (d.kind !== r.kind) problems.push(`${r.pattern}: recorded as a ${d.kind}, now a ${r.kind}`);
    // (1b) THE REASON IS PART OF THE ROW. `why` was written by generation and
    // read by nobody, so a `not-admitted` row could carry the UNEXPLAINED
    // placeholder — or a hand-edited sentence that no longer matches
    // PATTERN_REASONS — through a green gate. Measured: a scratch fixture with
    // an UNEXPLAINED row passed --check.
    if ((d.why ?? "").startsWith("UNEXPLAINED"))
      problems.push(`${r.pattern}: the committed inventory records no reason for excluding it — write one in PATTERN_REASONS (extract-config-inventory.ts) and regenerate`);
    if ((d.why ?? "") !== (r.why ?? ""))
      problems.push(`${r.pattern}: the committed reason is not the one PATTERN_REASONS gives today — committed '${(d.why ?? "(none)").slice(0, 60)}…', now '${(r.why ?? "(none)").slice(0, 60)}…'`);
    // (1c) THE FLOOR. `seenAtLeast` is a floor over every census taken at this
    // pin, so the census may legitimately have outgrown it (more resets since
    // the last generation) or fall short of it (a --scenario run). What it may
    // NOT be is zero: a declared pattern that no census has ever contributed is
    // a row somebody wrote by hand.
    if (d.seenAtLeast < 1) problems.push(`${r.pattern}: declared with a floor of ${d.seenAtLeast} — no census has ever observed it`);
    if (r.seenAtLeast > d.seenAtLeast) stale.push(`${r.pattern} (${d.seenAtLeast} → ${r.seenAtLeast})`);
    // (2) THE INCLUDE-LIST'S OWN DRIFT. `graded` is recomputed from
    // src/state.ts, so narrowing the include-list reddens here rather than
    // quietly shrinking what the fourth surface can see.
    if (d.graded !== r.graded) problems.push(`${r.pattern}: the include-list used to call this '${d.graded}' and now calls it '${r.graded}'`);
  }
  // (3) A DECLARED PATTERN THE CENSUS NO LONGER SEES is a warning, not a
  // failure: a `--scenario` run censuses one scenario's writes, and a check that
  // demanded the whole population would forbid running it on anything less.
  const seen = new Set(rows.map((r) => r.pattern));
  const missing = committed.entries.filter((r) => !seen.has(r.pattern)).map((r) => r.pattern);
  if (problems.length > 0) {
    for (const p of problems) console.log(`  FAIL  ${p}`);
    console.log("FAIL — regenerate with: npx tsx research/tools/extract-config-inventory.ts");
    process.exit(1);
  }
  if (stale.length > 0)
    console.log(`  note: ${stale.length} floor(s) outgrown since the inventory was generated (regenerate to record them): ${stale.slice(0, 6).join(", ")}`);
  if (missing.length > 0) console.log(`  note: ${missing.length} declared pattern(s) not written by this census (a partial corpus run): ${missing.slice(0, 6).join(", ")}`);
  console.log(`PASS — ${rows.length} observed pattern(s) over ${doc.resets} resets, all declared; ${fx.counts.admitted} admitted by the state surface`);
}
