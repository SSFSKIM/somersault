// §3.3 — the gate-cache leak check.
//
// The research (`reforge/research/2026-08-31-gate-blob-resolution.md` §1) found
// that GrowthBook feature values and the server "client data" bootstrap blob are
// cached INSIDE `.claude.json`, under five keys. Reforge's environment disables
// both the fetch and the disk-cache read, so those keys must never appear in the
// harness-owned config dir.
//
// That absence is the real invariant, and it is cheap to assert — far cheaper
// than the originally planned "snapshot the blob and assert stability", which
// would have pinned a cache the engine never reads. If a key ever shows up, an
// env guard has regressed: gates would then resolve from a cache that drifts
// with the server instead of from the compiled-in defaults the fixture records.
//
// It FAILS the run. The H1 lesson is on the record here: the first config-leak
// check only set `process.exitCode`, the final verdict assignment overwrote it,
// and a contaminated run exited 0. A check that only reports is not a check.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The cache keys, per research §1 (lines 302072/302088, 141154/141163, 312566). */
export const GATE_CACHE_KEYS = [
  "cachedGrowthBookFeatures",
  "cachedExperimentFeatures",
  "cachedExperimentData",
  "clientDataCacheSlots",
  "clientDataCache",
] as const;

/**
 * Which gate-cache keys appear anywhere in the config dir's `.claude.json`.
 *
 * Substring search over the raw text rather than a top-level key check: the
 * client-data cache is keyed by entrypoint/model/org and the config object is
 * nested per project, so a structural check on the root object would miss a
 * cache written one level down.
 */
export function gateCacheLeak(configDir: string): string[] {
  const file = join(configDir, ".claude.json");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  return GATE_CACHE_KEYS.filter((k) => text.includes(k));
}

/**
 * Assert-and-report. Returns true when clean; prints the offending keys and
 * returns false otherwise, so the caller can fail the scenario it belongs to.
 */
export function gateCacheCheck(configDir: string, label: string): boolean {
  const hits = gateCacheLeak(configDir);
  if (hits.length === 0) return true;
  console.log(
    `    GATE LEAK [${label}]: .claude.json contains ${hits.join(", ")} — the GrowthBook/client-data kill-switches have regressed, ` +
      `so gates may no longer resolve to the compiled-in defaults the fixture records`,
  );
  return false;
}
