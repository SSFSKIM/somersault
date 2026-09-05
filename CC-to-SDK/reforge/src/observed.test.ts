// Controls for the config-dir census's PROJECTION — `generalizePath` and the
// fold the census loader applies with it (C12a/W9a, H1's gate-inventory fix).
//
//   npx tsx src/observed.test.ts
//
// WHY THESE ARE CONTROLS AND NOT UNIT TESTS OF A REGEX. The census is the
// tripwire for the state surface's blind spot: its config root is an
// include-list, so a pin that starts writing a new family is seen by nothing
// unless a pattern the fixture does not declare reddens `--check`. Every rule in
// `generalizePath` therefore buys silence for a family in exchange for the
// tripwire's width, and the only question worth asking of a rule is what it
// stops seeing. So each rule below is watched folding what it claims AND leaving
// alone the nearest thing it must not fold.
//
// The fold is here for the other half: the census ACCUMULATES across every reset
// in a checkout, so a row written under yesterday's rule outlives it. A loader
// that does not re-generalize leaves that row literal forever, and the only way
// to retire one is to hand-edit `build/config-observed.json` — which is exactly
// what an unclean kill forced an operator to do before this landed.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { censusConfigDir, generalizePath, regeneralizeEntries, type ConfigCensus } from "./observed.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};
const same = (label: string, got: string, want: string): void => check(label, got === want, `got '${got}', want '${want}'`);

const PIN = "2.1.251";
// A real registry key name: the pid, then the 32-hex the engine appends, then `.key`.
const KEY = "sessions/70765.4f6a1c9d0b7e25381ac4de905f7b6e13.key";

const box = mkdtempSync(join(tmpdir(), "reforge-observed-"));
try {
  // ---- the <pid> rule folds the peer-registry family --------------------------
  same("the registry entry generalizes to <pid>", generalizePath("sessions/70765.json"), "sessions/<pid>.json");
  same("…and so does its key file, whose hex the <hex> rule takes", generalizePath(KEY), "sessions/<pid>.<hex>.key");

  // ORDER IS IRRELEVANT between the <pid> rule and the <hex> rule, and this is
  // the measurement rather than the argument: each rule reaches its target
  // whether or not the other has already run. The spans are disjoint — the pid
  // is the digits that follow `sessions/`, the hex is a run that follows a `.`
  // or `-` separator — so neither can consume the other's input.
  same("the <pid> rule still fires on a path whose hex is ALREADY generalized",
    generalizePath("sessions/70765.<hex>.key"), "sessions/<pid>.<hex>.key");
  same("…and the <hex> rule still fires on a path whose pid is ALREADY generalized",
    generalizePath("sessions/<pid>.4f6a1c9d0b7e25381ac4de905f7b6e13.key"), "sessions/<pid>.<hex>.key");
  check("the projection is idempotent, which is what lets the loader re-run it on every reset",
    generalizePath(generalizePath(KEY)) === generalizePath(KEY) &&
      generalizePath(generalizePath("sessions/70765.json")) === generalizePath("sessions/70765.json"));

  // ---- …and it eats no other numeric name -------------------------------------
  // A pid is a bare run of digits, the broadest thing this file can substitute.
  // The anchor is the whole guard, so these are the controls that say the rule
  // did not buy its silence out of the tripwire's width.
  same("a numeric name under projects/ is NOT a pid", generalizePath("projects/-x/12345.jsonl"), "projects/<slug>/12345.jsonl");
  same("…nor is a numeric directory under tasks/", generalizePath("tasks/12345/1.json"), "tasks/12345/1.json");
  same("…nor a numeric name one level below sessions/", generalizePath("sessions/12345/peer.json"), "sessions/12345/peer.json");
  same("…nor digits under sessions/ that are not a whole dot-component", generalizePath("sessions/2026-09-05.log"), "sessions/2026-09-05.log");

  // ---- the loader folds a stored literal row, and preserves its count ---------
  // The census file the reset appends to is the artifact `--check` reads, and it
  // is older than any rule that arrives later. Two literal rows written before
  // the <pid> rule existed must become ONE declared pattern carrying BOTH counts
  // — otherwise the fold has quietly discarded observations.
  {
    const cfg = join(box, "config");
    mkdirSync(join(cfg, "sessions"), { recursive: true });
    writeFileSync(join(cfg, ".claude.json"), "{}");
    const censusPath = join(box, "census.json");
    const prior: ConfigCensus = {
      engineVersion: PIN,
      resets: 9,
      entries: {
        "sessions/70765.json": { kind: "file", seen: 3 },
        "sessions/81234.json": { kind: "file", seen: 2 },
        [KEY]: { kind: "file", seen: 1 },
        "projects/<slug>/12345.jsonl": { kind: "file", seen: 7 },
      },
      idShapes: {},
    };
    writeFileSync(censusPath, JSON.stringify(prior, null, 2) + "\n");
    censusConfigDir(cfg, censusPath, PIN);
    const after = JSON.parse(readFileSync(censusPath, "utf8")) as ConfigCensus;
    check("two literal pid rows fold into ONE declared pattern on load",
      after.entries["sessions/<pid>.json"] !== undefined && after.entries["sessions/70765.json"] === undefined && after.entries["sessions/81234.json"] === undefined,
      Object.keys(after.entries).join(", "));
    check("…carrying the SUM of what both rows observed, not the last one",
      after.entries["sessions/<pid>.json"]?.seen === 5, String(after.entries["sessions/<pid>.json"]?.seen));
    check("…and the key file folds through the <hex> rule with its count intact",
      after.entries["sessions/<pid>.<hex>.key"]?.seen === 1, String(after.entries["sessions/<pid>.<hex>.key"]?.seen));
    check("a row the rules do not touch is carried through unchanged",
      after.entries["projects/<slug>/12345.jsonl"]?.seen === 7, String(after.entries["projects/<slug>/12345.jsonl"]?.seen));
    // THE FOLD IS A LOAD, NOT A REWRITE OF HISTORY: this reset's own walk still
    // counts on top of the folded rows, so the accumulator keeps accumulating.
    check("…and this reset's own observations are added on top of the folded rows",
      after.entries["sessions"]?.seen === 1 && after.entries[".claude.json"]?.seen === 1 && after.resets === 10,
      `sessions ${after.entries["sessions"]?.seen}, .claude.json ${after.entries[".claude.json"]?.seen}, resets ${after.resets}`);
  }

  // ---- the helper both readers share -----------------------------------------
  // `research/tools/extract-config-inventory.ts` folds the same way on the way
  // in. It is the same function, which is the point: a writer and a checker with
  // two copies of this loop disagree silently.
  {
    const folded = regeneralizeEntries({
      "sessions/70765.json": { kind: "file", seen: 1 },
      "sessions/<pid>.json": { kind: "file", seen: 4 },
    });
    check("a literal row merges into the pattern row that is already there",
      Object.keys(folded).length === 1 && folded["sessions/<pid>.json"]?.seen === 5,
      JSON.stringify(folded));
  }
} finally {
  rmSync(box, { recursive: true, force: true });
}

console.log(`=== config-census projection: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "PASS — every projection rule folds what it names and leaves the nearest literal alone, and the loader heals a stored row without losing its count" : `FAIL — ${failures.length} control(s) failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
