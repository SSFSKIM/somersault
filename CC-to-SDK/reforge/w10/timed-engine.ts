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
// The directory is keyed on the profile AND on a digest of the WHOLE base
// graph. A `--sabotage` build writes different chunks into the same base
// directory, so a key that ignored the bytes would hand a sabotage run the
// faithful engine it built ten minutes earlier — a cache that answers the wrong
// question silently, which is the failure mode this campaign pays for most.
//
// THE WHOLE GRAPH, not the timer chunk alone, because what the copy carries is
// the whole graph. A sabotage or a splice lands in whichever chunk owns the
// target, and only one of the seven deadlines' chunks is ever that chunk — so a
// key over the timer chunk's bytes is blind to every edit made anywhere else,
// which is most of them. The digest is taken in the SAME pass that finds the
// timer chunk, because that pass already reads every text module; keying
// honestly therefore costs nothing over keying narrowly.
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
  baseGraphSha256: string;
  applied: TimerRewrite[];
}

/**
 * The chunk that owns the deadlines, plus a digest of the graph it sits in —
 * one pass, because both answers come from reading the same files.
 *
 * The chunk is found by the same conjunction of shapes `locateTimerChunk` uses,
 * but over the COPY rather than over the pinned bundle: a strangled graph has
 * had chunks rewritten, so "the file with this name in the bundle" is not
 * necessarily the file that carries the deadlines in the build under test.
 *
 * The digest covers `textModules` — `cli` and every `.js` — which is exactly the
 * population `materializeGraph`, `strangle/build.ts` and this module itself
 * write to, so no edit any of them makes is outside it. Sorted, because
 * `readdirSync`'s order is the filesystem's and a key that moved with it would
 * miss a cache it owns.
 */
function scanGraph(dir: string): { path: string; source: string; graphSha256: string } {
  const hits: { path: string; source: string }[] = [];
  const digest = createHash("sha256");
  for (const path of textModules(dir).sort()) {
    const source = readFileSync(path, "utf8");
    digest.update(path.slice(dir.length)).update("\0").update(source).update("\0");
    if (!source.includes('"SIGKILL"') || !source.includes("pollProgress")) continue;
    try {
      locateShellTimers(source);
      hits.push({ path, source });
    } catch {
      // some shapes, not all: not the owner
    }
  }
  if (hits.length !== 1) throw new Error(`timed engine: ${hits.length} chunk(s) in ${dir} carry all six deadlines — expected exactly 1`);
  return { ...hits[0], graphSha256: digest.digest("hex") };
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
  const baseGraphSha256 = scanGraph(baseDir).graphSha256;
  const key = profileKey(profile, `${base}\0${baseGraphSha256}`);
  const dir = join(TIMED_ROOT, `${base}-${key}`);
  const graph = join(dir, "graph");
  const stampFile = join(dir, "timers.json");
  const engine = join(dir, "engine");

  if (existsSync(stampFile) && existsSync(join(graph, "cli")) && existsSync(engine)) {
    const stamp = JSON.parse(readFileSync(stampFile, "utf8")) as Stamp;
    if (stamp.baseGraphSha256 === baseGraphSha256) {
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

  const chunk = scanGraph(graph);
  const { source, applied } = rewriteShellTimers(chunk.source, profile);
  writeFileSync(chunk.path, source);

  writeFileSync(
    engine,
    `#!/bin/sh\n` +
      `# GENERATED by w10/timed-engine.ts — ${base} with its shell deadlines rewritten:\n` +
      `#   ${describeProfile(profile)}\n` +
      `# Regenerate rather than edit; the directory is keyed on the profile and on the base graph's bytes.\n` +
      `exec ${JSON.stringify(BUN)} ${JSON.stringify(join(graph, "cli"))} "$@"\n`,
  );
  chmodSync(engine, 0o755);
  writeFileSync(stampFile, JSON.stringify({ base, profile, baseGraphSha256, applied } satisfies Stamp, null, 2) + "\n");

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
