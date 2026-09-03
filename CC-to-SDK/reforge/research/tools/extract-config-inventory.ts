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
import { configInclude } from "../../src/state.js";
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
}

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

/** A generalized pattern, run through the include-list by substituting a concrete-looking segment. */
const admits = (pattern: string): boolean =>
  configInclude(
    pattern
      .replace(/<slug>/g, "-box-sandbox")
      .replace(/<uuid>/g, "00000000-0000-4000-8000-000000000000")
      .replace(/<agent-id>/g, "a0123456789abcdef")
      .replace(/<ms>/g, "1788415170183")
      .replace(/<hex>/g, "0123456789abcdef"),
  ) !== null;

const doc = census();
const rows: Row[] = Object.entries(doc.entries)
  .map(([pattern, e]) => ({ pattern, kind: e.kind, seenAtLeast: e.seen, graded: (admits(pattern) ? "admitted" : "not-admitted") as Row["graded"] }))
  .sort((a, b) => a.pattern.localeCompare(b.pattern));

const fx: Fixture = {
  engineVersion: ENGINE_VERSION,
  generatedBy: "research/tools/extract-config-inventory.ts",
  note:
    "Every path the engine wrote into CONFIG_DIR, generalized to a pattern and observed by resetSandbox()'s census. " +
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
  if (missing.length > 0) console.log(`  note: ${missing.length} declared pattern(s) not written by this census (a partial corpus run): ${missing.slice(0, 6).join(", ")}`);
  console.log(`PASS — ${rows.length} observed pattern(s) over ${doc.resets} resets, all declared; ${fx.counts.admitted} admitted by the state surface`);
}
