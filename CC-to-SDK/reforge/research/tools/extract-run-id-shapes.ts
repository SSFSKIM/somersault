// §3.3 / C12a-W9a — the differ's run-id MAP as a pin-keyed population: which
// property names are mapped, and which LEXEME each one is observed to carry.
//
//   npx tsx research/tools/extract-run-id-shapes.ts [--check]
//
// WHY THE SHAPES AND NOT JUST THE KEYS. The map is keyed on PROPERTY NAME, and
// that choice is only defensible because the values are ambiguous: an agent id
// and a task id are both `a` + 16 hex, and `uuid`, `parentUuid`,
// `logicalParentUuid`, `leafUuid` and `promptId` are all RFC-4122. A rule keyed
// on shape would either bind a task id as an agent id — a WRONG binding, the
// unsafe direction §3.4 names — or map every uuid-shaped string anywhere, which
// would erase the `tool_use_id`s the cassette replays identically and that
// therefore must match literally. C15a3 has to nest these ids one level deeper
// and its cut says so in as many words: enumerate the id SHAPES before the first
// nesting scenario. This is that enumeration.
//
// TWO ARTIFACTS, because neither alone carries the population. The SDK-side ids
// (`session_id`, `uuid`, `agentId`, `task_id`, the compact_boundary's four)
// appear in `transcripts/`; the STORED envelope's ids (`parentUuid`,
// `logicalParentUuid`, `leafUuid`, `promptId`, `sessionId`, and the project-key
// slug, which is not a record field at all) appear only in the session files the
// reset deletes, so `src/observed.ts` tallies them on the way past.
//
// WHAT `--check` REFUSES, and what it tolerates. The KEY SET is exact against
// `src/differ.ts` in both directions: a rule added to the map without a fixture
// row, or a row for a rule that has been removed, reddens. An observed lexeme
// class that the fixture does not declare for that key reddens — that is the pin
// re-lexing an id, which is the whole point. A class of `other` reddens, because
// an unclassified value under a mapped key means this table is incomplete. What
// it tolerates is ABSENCE: a key with no observations in this checkout is a note
// rather than a failure, because both sample artifacts are derived directories
// (`transcripts/`, `build/`) and a `--scenario` run legitimately produces a
// fraction of them.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN_ID_ARRAY_KEYS, RUN_ID_KEYS } from "../../src/differ.js";
import { lexemeClass, type ConfigCensus } from "../../src/observed.js";
import { ENGINE_VERSION } from "../../src/pin.js";
import { REFORGE_ROOT } from "../../src/runTurn.js";

const FIXTURE = join(REFORGE_ROOT, "research", "fixtures", `run-id-shapes-${ENGINE_VERSION}.json`);
const CENSUS = join(REFORGE_ROOT, "build", "config-observed.json");
const TRANSCRIPTS = join(REFORGE_ROOT, "transcripts");
const check = process.argv.includes("--check");

const ALL_KEYS = [...RUN_ID_KEYS, ...RUN_ID_ARRAY_KEYS].sort();

interface KeyRow {
  key: string;
  arrayValued: boolean;
  /** lexeme class -> how many values of that class were observed (a FLOOR) */
  lexemes: { class: string; observedAtLeast: number; from: string[] }[];
}

interface Fixture {
  engineVersion: string;
  generatedBy: string;
  note: string;
  counts: { keys: number; arrayKeys: number; observedKeys: number; lexemeClasses: number; collisions: number };
  keys: KeyRow[];
  /** the fact the fixture exists to state: which keys a shape-keyed rule could not tell apart */
  collisions: { lexeme: string; keys: string[] }[];
  sources: { transcriptFiles: number; censusResets: number };
}

// ---- observation ------------------------------------------------------------
const observed = new Map<string, Map<string, { n: number; from: Set<string> }>>();
const note = (key: string, cls: string, n: number, from: string): void => {
  const per = observed.get(key) ?? new Map();
  const row = per.get(cls) ?? { n: 0, from: new Set<string>() };
  row.n += n;
  row.from.add(from);
  per.set(cls, row);
  observed.set(key, per);
};

const isKey = (k: string) => RUN_ID_KEYS.has(k) || RUN_ID_ARRAY_KEYS.has(k);
const walk = (v: unknown, from: string): void => {
  if (Array.isArray(v)) {
    for (const x of v) walk(x, from);
    return;
  }
  if (v === null || typeof v !== "object") return;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (isKey(k)) {
      for (const s of Array.isArray(val) ? val : [val]) if (typeof s === "string" && s.length >= 6) note(k, lexemeClass(s), 1, from);
    }
    walk(val, from);
  }
};

let transcriptFiles = 0;
if (existsSync(TRANSCRIPTS)) {
  for (const name of readdirSync(TRANSCRIPTS)) {
    const abs = join(TRANSCRIPTS, name);
    try {
      const text = readFileSync(abs, "utf8");
      if (name.endsWith(".jsonl")) for (const line of text.split("\n")) { if (line) walk(JSON.parse(line), "transcripts"); }
      else walk(JSON.parse(text), "transcripts");
      transcriptFiles++;
    } catch {
      // A partially-written transcript contributes nothing; the count says how many were read.
    }
  }
}

let censusResets = 0;
if (existsSync(CENSUS)) {
  const doc = JSON.parse(readFileSync(CENSUS, "utf8")) as ConfigCensus;
  if (doc.engineVersion === ENGINE_VERSION) {
    censusResets = doc.resets;
    for (const [key, classes] of Object.entries(doc.idShapes ?? {})) {
      if (!isKey(key)) continue;
      for (const [cls, n] of Object.entries(classes)) note(key, cls, n, "stored-envelope");
    }
  }
}

const rows: KeyRow[] = ALL_KEYS.map((key) => ({
  key,
  arrayValued: RUN_ID_ARRAY_KEYS.has(key),
  lexemes: [...(observed.get(key) ?? new Map())]
    .map(([cls, r]) => ({ class: cls, observedAtLeast: r.n, from: [...r.from].sort() }))
    .sort((a, b) => a.class.localeCompare(b.class)),
}));

const byLexeme = new Map<string, string[]>();
for (const r of rows) for (const l of r.lexemes) byLexeme.set(l.class, [...(byLexeme.get(l.class) ?? []), r.key]);
const collisions = [...byLexeme].filter(([, keys]) => keys.length > 1).map(([lexeme, keys]) => ({ lexeme, keys: keys.sort() })).sort((a, b) => a.lexeme.localeCompare(b.lexeme));

const fx: Fixture = {
  engineVersion: ENGINE_VERSION,
  generatedBy: "research/tools/extract-run-id-shapes.ts",
  note:
    "The differ's run-id map, keyed on property name, with the lexeme each key is observed to carry. " +
    "`collisions` is the fact this fixture exists to state: those keys are indistinguishable by value, so a shape-keyed rule would bind them wrongly.",
  counts: {
    keys: rows.length,
    arrayKeys: rows.filter((r) => r.arrayValued).length,
    observedKeys: rows.filter((r) => r.lexemes.length > 0).length,
    lexemeClasses: byLexeme.size,
    collisions: collisions.length,
  },
  keys: rows,
  collisions,
  sources: { transcriptFiles, censusResets },
};

if (!check) {
  writeFileSync(FIXTURE, JSON.stringify(fx, null, 2) + "\n");
  console.log(`=== run-id map: ${rows.length} key(s), ${fx.counts.observedKeys} observed (pin ${ENGINE_VERSION}) ===`);
  for (const r of rows) console.log(`  ${r.key.padEnd(22)} ${r.lexemes.map((l) => `${l.class}×${l.observedAtLeast}`).join(", ") || "(unobserved here)"}`);
  for (const c of collisions) console.log(`  COLLISION ${c.lexeme}: ${c.keys.join(", ")}`);
  console.log(`PASS — wrote ${rows.length} key(s) and ${collisions.length} lexeme collision(s) from ${transcriptFiles} transcript file(s) and ${censusResets} reset(s)`);
} else {
  if (!existsSync(FIXTURE)) {
    console.log(`FAIL  no committed fixture at ${FIXTURE} — generate it with: npx tsx research/tools/extract-run-id-shapes.ts`);
    process.exit(1);
  }
  const committed = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
  const problems: string[] = [];
  // (1) THE KEY SET, exact in both directions.
  const live = new Set(ALL_KEYS);
  const declared = new Set(committed.keys.map((k) => k.key));
  for (const k of live) if (!declared.has(k)) problems.push(`src/differ.ts maps '${k}', which this fixture does not declare — a rule landed without its population`);
  for (const k of declared) if (!live.has(k)) problems.push(`the fixture declares '${k}', which src/differ.ts no longer maps`);
  for (const r of committed.keys) {
    const now = rows.find((x) => x.key === r.key)!;
    if (now !== undefined && now.arrayValued !== r.arrayValued) problems.push(`${r.key}: array-valued ${r.arrayValued} -> ${now.arrayValued}`);
  }
  // (2) THE LEXEMES. An observed class the fixture does not declare for that key
  // is the pin re-lexing an id; `other` is this table being incomplete.
  for (const r of rows) {
    const d = committed.keys.find((x) => x.key === r.key);
    if (d === undefined) continue; // already reported above
    for (const l of r.lexemes) {
      if (l.class === "other") problems.push(`${r.key}: ${l.observedAtLeast} value(s) fall in no known lexeme class — extend lexemeClass() in src/observed.ts`);
      else if (!d.lexemes.some((x) => x.class === l.class)) problems.push(`${r.key}: observed lexeme '${l.class}' (${l.observedAtLeast}×) is not declared for this key`);
    }
  }
  const unobserved = committed.keys.filter((r) => r.lexemes.length > 0 && (rows.find((x) => x.key === r.key)?.lexemes.length ?? 0) === 0).map((r) => r.key);
  if (problems.length > 0) {
    for (const p of problems) console.log(`  FAIL  ${p}`);
    console.log("FAIL — regenerate with: npx tsx research/tools/extract-run-id-shapes.ts");
    process.exit(1);
  }
  if (unobserved.length > 0) console.log(`  note: ${unobserved.length} declared key(s) unobserved in this checkout (derived artifacts, partial run): ${unobserved.join(", ")}`);
  console.log(`PASS — ${ALL_KEYS.length} mapped key(s) match src/differ.ts; every observed lexeme is declared; ${committed.collisions.length} collision(s) recorded`);
}
