// What the reset SAW before it wiped — the census behind the config-dir
// inventory fixture (C12a/W9a, campaign spec's C12a bullet, item 7).
//
// The reset policy is "wipe everything the engine writes, seed what the
// precondition declares", and `rm -rf` is a one-line way to implement it. The
// reason there is a census as well is that the CONFIG ROOT OF THE STATE SURFACE
// IS AN INCLUDE-LIST: six declared families are graded and everything else is
// invisible by construction. A pin that starts writing a seventh family would
// therefore be seen by nothing — not by the state surface (not admitted), not by
// the reset (deleted either way), not by the corpus (the file never reaches a
// transcript). The census is the tripwire for exactly that blind spot: it
// records every path the reset ever deleted, generalized to a PATTERN, and
// `research/tools/extract-config-inventory.ts --check` refuses one the pinned
// fixture does not declare.
//
// It accumulates ACROSS RUNS on purpose. After the reset policy lands, the
// config dir at the end of a corpus run holds one scenario's writes, so a census
// taken at the end would see 1/83rd of the population. Taken at every reset it
// sees all of it — the same reason the coverage attestation instruments a build
// rather than reading the last run's output.
//
// The file lives in `build/` (a derived directory, gitignored) and is keyed by
// the engine pin: a pin bump discards it rather than mixing two engines'
// populations into one claim.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface ConfigCensus {
  engineVersion: string;
  /** how many resets contributed */
  resets: number;
  /** generalized path pattern -> { kind, times seen } */
  entries: Record<string, { kind: "file" | "dir"; seen: number }>;
  /**
   * The other half of the census, and the reason it is here rather than in a
   * separate walk: run-id property name -> observed LEXEME class -> count, read
   * off the stored transcripts the reset is about to delete.
   *
   * The differ maps these ids by PROPERTY NAME because their values are
   * ambiguous — an agent id and a task id are both `a`+16 hex, four envelope ids
   * are all RFC-4122. That choice is only safe if the lexemes each key actually
   * carries are known, and the stored envelope is the only artifact that carries
   * most of them (`parentUuid`, `leafUuid`, `promptId` and the envelope's
   * per-run `slug` never appear in an SDK transcript). `research/tools/extract-run-id-shapes.ts` holds
   * this against the committed fixture.
   */
  idShapes: Record<string, Record<string, number>>;
}

const EMPTY = (engineVersion: string): ConfigCensus => ({ engineVersion, resets: 0, entries: {}, idShapes: {} });

/** The lexeme classes the campaign distinguishes. `other` is deliberate: an unclassified value is a finding. */
export function lexemeClass(v: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) return "uuid-v4";
  if (/^a[0-9a-f]{16}$/.test(v)) return "a+16hex";
  if (/^-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) return "path-slug";
  if (/^(req|msg|toolu)_[A-Za-z0-9]+$/.test(v)) return `${v.split("_")[0]}_*`;
  // The BACKGROUND task id, `b` + 8 base36 — a second task-id shape, distinct
  // from the Agent tool's `a`+16 hex and sharing its property name. Recorded
  // because C15a3 has to nest these and the cut says to enumerate the shapes
  // before the first nesting scenario, not after.
  if (/^b[0-9a-z]{8}$/.test(v)) return "b+8base36";
  // A request id the HARNESS chose, not the engine: the raw driver names its own
  // control requests `reforge-<what>`. Classified so it stops arriving as an
  // unclassified value under a mapped key.
  if (/^reforge-[a-z0-9_-]+$/.test(v)) return "harness-literal";
  // The SESSION SLUG: the name the engine mints per run and writes into the
  // envelope of every record after a compaction. Its last two components are
  // random words and what precedes them is either one more random word
  // (`curious-yawning-pebble`) or a prompt-derived title
  // (`use-the-read-tool-humming-bentley`) — a run-scoped identifier that looks
  // nothing like one, and the reason the `slug` rule has no value guard.
  if (/^[a-z0-9]+(-[a-z0-9]+){2,}$/.test(v)) return "session-slug";
  if (/^[0-9a-f]{64}$/.test(v)) return "sha256";
  return "other";
}

/**
 * A concrete path, generalized to the pattern the fixture declares.
 *
 * Each substitution is a run-scoped token, and each is anchored so it cannot eat
 * a literal name: a bare 13-digit run would be a clock anywhere, so `<ms>` is
 * only applied after a `.` or `-` separator, which is how every clock-bearing
 * name in this tree is built (`.claude.json.backup.<ms>`,
 * `snapshot-zsh-<ms>-<rand>.sh`).
 */
export function generalizePath(rel: string): string {
  return rel
    .replace(/(^|\/)-[A-Za-z0-9][A-Za-z0-9._-]*(?=\/|$)/g, "$1<slug>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\ba[0-9a-f]{16}\b/g, "<agent-id>")
    .replace(/([.-])\d{13}\b/g, "$1<ms>")
    .replace(/([.-])[0-9a-f]{16,}\b/g, "$1<hex>")
    // The random tail the shell-snapshot name carries after its clock. Anchored
    // on `<ms>-` so it cannot eat a literal six-character name anywhere else —
    // without it every snapshot is its OWN pattern, and the inventory check
    // would fail on the next run for a file that is not new.
    .replace(/<ms>-[a-z0-9]{6}\b/g, "<ms>-<rand>");
}

/** Record everything currently under `configDir`, then leave the file for the fixture check. */
export function censusConfigDir(configDir: string, censusPath: string, engineVersion: string): void {
  if (!existsSync(configDir)) return;
  let doc: ConfigCensus;
  try {
    const prior = JSON.parse(readFileSync(censusPath, "utf8")) as ConfigCensus;
    doc = prior.engineVersion === engineVersion ? { ...EMPTY(engineVersion), ...prior } : EMPTY(engineVersion);
  } catch {
    doc = EMPTY(engineVersion);
  }
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const isDir = statSync(abs).isDirectory();
      const key = generalizePath(relative(configDir, abs));
      const row = doc.entries[key] ?? { kind: isDir ? "dir" : "file", seen: 0 };
      row.seen++;
      doc.entries[key] = row;
      if (isDir) walk(abs);
    }
  };
  walk(configDir);
  tallyIdShapes(configDir, doc);
  doc.resets++;
  mkdirSync(dirname(censusPath), { recursive: true });
  writeFileSync(
    censusPath,
    JSON.stringify(
      { ...doc, entries: Object.fromEntries(Object.entries(doc.entries).sort()), idShapes: Object.fromEntries(Object.entries(doc.idShapes).sort()) },
      null,
      2,
    ) + "\n",
  );
}

/** Every stored transcript under `projects/`, tallied by run-id key and lexeme class. */
function tallyIdShapes(configDir: string, doc: ConfigCensus): void {
  const projects = join(configDir, "projects");
  if (!existsSync(projects)) return;
  const files: string[] = [];
  const find = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) find(abs);
      else if (name.endsWith(".jsonl")) files.push(abs);
    }
  };
  find(projects);
  const note = (key: string, value: unknown): void => {
    if (typeof value !== "string" || value.length < 6) return;
    const per = (doc.idShapes[key] ??= {});
    const cls = lexemeClass(value);
    per[cls] = (per[cls] ?? 0) + 1;
  };
  const walkValue = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walkValue(x);
      return;
    }
    if (v === null || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(val)) for (const x of val) note(k, x);
      else note(k, val);
      walkValue(val);
    }
  };
  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        // The project key is a fact about the PATH, not a field of any record.
        // The PROJECT KEY, which is a fact about the path rather than a field
        // of any record — tallied under the same property name the envelope's
        // per-run session slug uses, because the differ maps both under it.
        note("slug", relative(projects, f).split("/")[0]);
        walkValue(record);
      } catch {
        // A torn or fault-seeded line contributes no ids; the entry census
        // already recorded that the file exists.
      }
    }
  }
}
