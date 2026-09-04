// C13c / W10c — a graph engine with its shell deadlines rewritten, and the
// wrapper that runs it.
//
// ## Re-materialize rather than rebuild
//
// A timer-rewritten engine is the SAME build with seven numbers moved, so it is
// produced by copying an already-materialized graph and rewriting one chunk in
// the copy — not by re-running `prepare.ts` or `build.ts` with a new flag. Two
// reasons, and both are about not owning something twice:
//
//  * `strangle/build.ts` writes to one directory and `engines/engine-strangled`
//    reads from it. A `--timers` flag there would have to thread an output
//    directory through ten call sites and a committed wrapper, so that the
//    faithful build and the timed build could coexist — which is a refactor of
//    the strangler's own plumbing to buy a copy.
//  * The copy works for BOTH graph engines with one function. A materialized
//    graph's specifiers are absolute paths into its own directory, so pointing
//    them at the copy is the same substitution `materializeGraph` already makes
//    against `/$bunfs/root/`; the spliced chunks' `import` of a reforge-owned
//    module is an absolute path OUTSIDE the graph and is untouched, which is
//    what makes a timed STRANGLED engine free.
//
// ## Cached by what it is, not by when it was made
//
// The directory is keyed on the profile AND on the sha256 of the base chunk it
// was copied from. A `--sabotage` build writes a different chunk into the same
// base directory, so a key that ignored the bytes would hand a sabotage run the
// faithful engine it built ten minutes earlier — a cache that answers the wrong
// question silently, which is the failure mode this campaign pays for most.
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUN } from "../src/pin.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { BUILD_DIR, bootCheck, GRAPH_DIR, STRANGLED_DIR, textModules } from "../strangle/prepare.js";
import { describeProfile, locateShellTimers, profileKey, rewriteShellTimers, type TimerProfile, type TimerRewrite } from "./timers.js";

/** Which already-materialized graph the timed copy is made from. */
export type TimedBase = "engine-extracted" | "engine-strangled";

const BASE_DIR: Record<TimedBase, string> = {
  "engine-extracted": GRAPH_DIR,
  "engine-strangled": STRANGLED_DIR,
};

export const TIMED_ROOT = join(BUILD_DIR, "timers");

export interface TimedEngine {
  base: TimedBase;
  /** absolute path of a wrapper script the SDK can be pointed at */
  engine: string;
  dir: string;
  profile: TimerProfile;
  applied: TimerRewrite[];
  /** false when the cached directory was reused unchanged */
  built: boolean;
}

interface Stamp {
  base: TimedBase;
  profile: TimerProfile;
  baseChunkSha256: string;
  applied: TimerRewrite[];
}

/**
 * The chunk that owns the deadlines, inside an already-materialized graph.
 *
 * Found by the same conjunction of shapes `locateTimerChunk` uses, but over the
 * COPY rather than over the pinned bundle: a strangled graph has had chunks
 * rewritten, so "the file with this name in the bundle" is not necessarily the
 * file that carries the deadlines in the build under test.
 */
function timerChunkIn(dir: string): { path: string; source: string } {
  const hits: { path: string; source: string }[] = [];
  for (const path of textModules(dir)) {
    const source = readFileSync(path, "utf8");
    if (!source.includes('"SIGKILL"') || !source.includes("pollProgress")) continue;
    try {
      locateShellTimers(source);
      hits.push({ path, source });
    } catch {
      // some shapes, not all: not the owner
    }
  }
  if (hits.length !== 1) throw new Error(`timed engine: ${hits.length} chunk(s) in ${dir} carry all six deadlines — expected exactly 1`);
  return hits[0];
}

/**
 * Build (or reuse) a graph engine whose deadlines carry `profile`, and return a
 * wrapper the SDK can be pointed at.
 *
 * The base graph must already exist: this copies what `strangle/prepare.ts` or
 * `strangle/build.ts` produced rather than producing it, so a timed run is
 * always the same build as the untimed one it is compared against.
 */
export function timedEngine(profile: TimerProfile, base: TimedBase = "engine-extracted"): TimedEngine {
  const baseDir = BASE_DIR[base];
  if (!existsSync(join(baseDir, "cli"))) {
    throw new Error(
      `timed engine: no ${base} graph at ${baseDir} — run 'npx tsx strangle/prepare.ts'${base === "engine-strangled" ? " and 'npx tsx strangle/build.ts'" : ""} first`,
    );
  }
  const baseChunk = timerChunkIn(baseDir);
  const baseChunkSha256 = createHash("sha256").update(baseChunk.source).digest("hex");
  const key = profileKey(profile, `${base}\0${baseChunkSha256}`);
  const dir = join(TIMED_ROOT, `${base}-${key}`);
  const graph = join(dir, "graph");
  const stampFile = join(dir, "timers.json");
  const engine = join(dir, "engine");

  if (existsSync(stampFile) && existsSync(join(graph, "cli")) && existsSync(engine)) {
    const stamp = JSON.parse(readFileSync(stampFile, "utf8")) as Stamp;
    if (stamp.baseChunkSha256 === baseChunkSha256) {
      return { base, engine, dir, profile, applied: stamp.applied, built: false };
    }
  }

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(baseDir, graph, { recursive: true });
  // Point the copy's specifiers at ITSELF. Without this every import resolves
  // back into the base graph and the run would execute the un-rewritten chunk
  // while looking like it had been rewritten — the silent-wrong-engine failure
  // this whole module exists to avoid.
  let rewritten = 0;
  for (const path of textModules(graph)) {
    const src = readFileSync(path, "utf8");
    if (!src.includes(`${baseDir}/`)) continue;
    rewritten++;
    writeFileSync(path, src.replaceAll(`${baseDir}/`, `${graph}/`));
  }
  if (rewritten === 0) throw new Error(`timed engine: no specifier under ${baseDir}/ was rewritten in the copy — the graph's packaging changed`);

  const chunk = timerChunkIn(graph);
  const { source, applied } = rewriteShellTimers(chunk.source, profile);
  writeFileSync(chunk.path, source);

  writeFileSync(
    engine,
    `#!/bin/sh\n` +
      `# GENERATED by w10/timed-engine.ts — ${base} with its shell deadlines rewritten:\n` +
      `#   ${describeProfile(profile)}\n` +
      `# Regenerate rather than edit; the directory is keyed on the profile and on the base chunk's bytes.\n` +
      `exec ${JSON.stringify(BUN)} ${JSON.stringify(join(graph, "cli"))} "$@"\n`,
  );
  chmodSync(engine, 0o755);
  writeFileSync(stampFile, JSON.stringify({ base, profile, baseChunkSha256, applied } satisfies Stamp, null, 2) + "\n");

  // A graph that boots is the only evidence a rewrite is intact — the same rule
  // `prepare.ts` and `build.ts` apply to their own output, and it is what
  // catches a rewrite that produced syntactically valid nonsense.
  bootCheck([BUN, join(graph, "cli"), "--version"], `${base} @ ${describeProfile(profile)}`);
  return { base, engine, dir, profile, applied, built: true };
}

/** Drop every cached timed engine. For a caller that wants the disk back. */
export const clearTimedEngines = (): void => rmSync(TIMED_ROOT, { recursive: true, force: true });

/** Where a timed engine's wrapper lives, relative to the repo, for a log line. */
export const relativeEngine = (e: TimedEngine): string => e.engine.slice(REFORGE_ROOT.length + 1);
