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
}

const EMPTY = (engineVersion: string): ConfigCensus => ({ engineVersion, resets: 0, entries: {} });

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
    .replace(/([.-])[0-9a-f]{16,}\b/g, "$1<hex>");
}

/** Record everything currently under `configDir`, then leave the file for the fixture check. */
export function censusConfigDir(configDir: string, censusPath: string, engineVersion: string): void {
  if (!existsSync(configDir)) return;
  let doc: ConfigCensus;
  try {
    const prior = JSON.parse(readFileSync(censusPath, "utf8")) as ConfigCensus;
    doc = prior.engineVersion === engineVersion ? prior : EMPTY(engineVersion);
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
  doc.resets++;
  mkdirSync(dirname(censusPath), { recursive: true });
  writeFileSync(censusPath, JSON.stringify({ ...doc, entries: Object.fromEntries(Object.entries(doc.entries).sort()) }, null, 2) + "\n");
}
