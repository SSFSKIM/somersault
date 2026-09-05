// C13c / W10c, capability 3 — CHILD-PROCESS SUPERVISION: what a run left
// running.
//
// ## The blind spot this closes
//
// Four surfaces grade every scenario: the SDK transcript, the harness events,
// the API requests, and the state the run left on disk. None of them describes
// the PROCESSES a run left behind. `Pde.detach()` calls `child.unref()` and
// drops the handle; `nct()` kills every live shell on SIGTERM; `CWt` reaps on
// memory pressure; `Kdt` caps a backgrounded shell. An engine that leaks a
// child, or kills one it should have detached, is invisible to all four — the
// files are identical, the transcript is identical, and a process is still
// running. W9 named process supervision as its carry-over; W10 is the wave that
// cannot be graded without it (scout §5.2, capability 3), and it lands here.
//
// ## Why survivors, and not "the engine's descendant set"
//
// The obvious reading — walk `ps -o pid,ppid` down from the engine child — does
// not survive contact with the thing being measured. The snapshot is taken
// after the query resolves, and by then the engine has EXITED: a walk from its
// pid finds nothing, and a leaked child has been reparented to pid 1, so it is
// not under the engine's pid either. The leak is precisely the case where
// lineage has been destroyed.
//
// So the surface is a DIFFERENCE: the process table before the scenario, the
// process table after it, and the processes that appear in the second and not
// in the first. That set is attributable to the run by construction — the
// single-writer lock (`src/lock.ts`) guarantees no sibling harness process is
// spawning engines into the same window — and it contains a leaked orphan
// whether or not its lineage still exists.
//
// `engineDescendants` below is the OTHER half, kept because C16a needs it:
// signal delivery to a descendant needs to name one while the engine is alive.
// It is not what the graded snapshot is built from.
//
// ## Attribution, and what is deliberately DROPPED
//
// The operator's machine is not quiet. A browser opening a tab during side A
// and not during side B would redden a scenario for a reason that is not
// behaviour, so a survivor is graded only when it can be tied to THIS harness
// by one of three routes:
//
//   * ANCESTRY — its parent chain, in the after-table, reaches this process.
//   * CWD — its working directory is inside the sandbox. Read with `lsof` and
//     only for the handful of candidates, because the engine's shells run with
//     the sandbox as their cwd and a reparented orphan keeps it.
//   * COMMAND — its command line carries a path or a name this harness owns
//     (the sandbox, the config dir, the materialized graphs, the scripted
//     child's file name).
//
// Anything else is DROPPED — not recorded, not counted in the graded value —
// and reported to stdout instead. A count would be a graded value that the
// operator's machine can move, which is the same defect one level down. WHAT
// THIS MISSES, stated rather than hidden: an orphan with no reforge token in
// its command line whose cwd is not the sandbox and whose lineage is gone —
// `sh -c 'cd / && exec sleep 300'` would be invisible. Closing that needs an
// environment read (`ps -E`), which macOS restricts under SIP (measured: it
// prints the command line and no environment), or a process-group discipline
// the engine does not use — its own kill path is `process.kill(-pid, …)`, so
// each shell is already its own group leader.
//
// ## Why a survivor must be seen TWICE
//
// A child that is exiting as the snapshot is taken is present in one sample and
// gone from the next, which would make the surface flaky in the one direction a
// graded surface must never be flaky. So the set is sampled twice, `settleMs`
// apart, and only processes present in BOTH are recorded. §3.4's justification:
// WHAT IT HIDES — a child that outlived the engine by less than `settleMs`,
// which is a child that is exiting rather than one that leaked. WHAT IT WOULD
// MISS — a leak that terminates within `settleMs` of the snapshot, which is not
// a leak. Applied identically to both engines and after the same quiesce.
import { spawnSync } from "node:child_process";
import { CONFIG_DIR, REFORGE_ROOT, SANDBOX } from "./runTurn.js";

export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

/**
 * The whole process table.
 *
 * `-ww` twice, because macOS `ps` truncates a command line to the terminal
 * width by default and the engine's is longer than that — a truncated command
 * is an attribution route silently switched off.
 */
export function processTable(): Map<number, ProcessRow> {
  const r = spawnSync("ps", ["-axww", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const table = new Map<number, ProcessRow>();
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] });
  }
  return table;
}

/** The baseline a scenario is measured against: what was running before it started. */
export interface ProcessBaseline {
  /** pid -> command, so a REUSED pid running something else still reads as new */
  before: Map<number, string>;
}

export const processBaseline = (): ProcessBaseline => ({
  before: new Map([...processTable()].map(([pid, row]) => [pid, row.command])),
});

/** How a survivor was tied to this harness. Reported, never graded. */
export type AttributionRoute = "ancestry" | "cwd" | "command";

export interface Survivor {
  /** the command line, with this machine's harness paths replaced by stable tokens */
  command: string;
  /** its parent is gone, so the OS reparented it — what a detached or leaked child looks like */
  orphaned: boolean;
  /** the declaration that permits it, or null when nothing declared it — a LEAK */
  declared: string | null;
}

/** The third member of the state snapshot: what this run left running. */
export interface ProcessSnapshot {
  /** attributable survivors, canonicalized and sorted — the graded value */
  survivors: Survivor[];
}

/** How a run states which children it means to leave behind (see `Scenario.detachedChildren`). */
export type DetachDeclaration = readonly string[];

/**
 * Harness-owned paths, longest first, replaced by stable tokens.
 *
 * A recorded command line has to be comparable between two engines on one
 * machine AND stable across machines, and every one of these is a fact about
 * where this checkout happens to live rather than about the engine.
 */
const PATH_TOKENS: [path: string, token: string][] = [
  [SANDBOX, "<sandbox>"],
  [CONFIG_DIR, "<config>"],
  [REFORGE_ROOT, "<reforge>"],
];

export const canonicalCommand = (command: string): string => {
  let out = command;
  for (const [path, token] of [...PATH_TOKENS].sort((a, b) => b[0].length - a[0].length)) out = out.replaceAll(path, token);
  return out;
};

/** The tokens a command line can carry that make it ours. `<sandbox>` etc. after canonicalization. */
const COMMAND_MARKERS = ["<sandbox>", "<config>", "<reforge>", "reforge-child.sh"];

/** Does `pid`'s parent chain reach `root` in this table? Bounded, so a cycle cannot hang the walk. */
function reaches(table: Map<number, ProcessRow>, pid: number, root: number): boolean {
  let at = pid;
  for (let depth = 0; depth < 64; depth++) {
    const row = table.get(at);
    if (row === undefined || row.ppid <= 1) return false;
    if (row.ppid === root) return true;
    at = row.ppid;
  }
  return false;
}

/**
 * A process's working directory, or null when it cannot be read.
 *
 * `lsof` is asked only about the handful of candidate pids, never about the
 * machine. When it is absent the route is simply unavailable — which can only
 * SHRINK the attributed set, identically for both engines inside one harness
 * process, and is printed rather than recorded.
 */
export function cwdOf(pid: number): string | null {
  const r = spawnSync("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"], { encoding: "utf8", timeout: 5_000 });
  if (r.status !== 0 && (r.stdout ?? "") === "") return null;
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("n"));
  return line === undefined ? null : line.slice(1);
}

export interface SupervisionOptions {
  /** how long between the two samples a survivor must appear in (see header) */
  settleMs?: number;
  /** what this scenario means to leave running */
  detached?: DetachDeclaration;
  /** printed, never recorded */
  label?: string;
}

/** One sample of the survivor set: the raw rows, before attribution. */
function sampleSurvivors(baseline: ProcessBaseline, table: Map<number, ProcessRow>): ProcessRow[] {
  const out: ProcessRow[] = [];
  for (const [pid, row] of table) {
    if (pid === process.pid) continue;
    const was = baseline.before.get(pid);
    // A pid that was already running the SAME command is not new. A pid the OS
    // has since reused for something else is.
    if (was === row.command) continue;
    out.push(row);
  }
  return out;
}

/**
 * What this run left running, attributed and canonicalized.
 *
 * Two samples `settleMs` apart; a survivor must be in both, with the same
 * command, to be recorded.
 */
export async function processSnapshot(baseline: ProcessBaseline, opts: SupervisionOptions = {}): Promise<ProcessSnapshot> {
  const settleMs = opts.settleMs ?? 250;
  const first = processTable();
  const firstSet = new Map(sampleSurvivors(baseline, first).map((r) => [r.pid, r.command]));
  await new Promise((r) => setTimeout(r, settleMs));
  const second = processTable();
  const still = sampleSurvivors(baseline, second).filter((r) => firstSet.get(r.pid) === r.command);

  const survivors: Survivor[] = [];
  const dropped: string[] = [];
  for (const row of still) {
    const command = canonicalCommand(row.command);
    const byCommand = COMMAND_MARKERS.some((m) => command.includes(m));
    const byAncestry = reaches(second, row.pid, process.pid);
    let byCwd = false;
    if (!byCommand && !byAncestry) {
      const cwd = cwdOf(row.pid);
      byCwd = cwd !== null && (cwd === SANDBOX || cwd.startsWith(`${SANDBOX}/`));
    }
    if (!byCommand && !byAncestry && !byCwd) {
      dropped.push(command);
      continue;
    }
    survivors.push({
      command,
      orphaned: row.ppid <= 1,
      declared: (opts.detached ?? []).find((d) => command.includes(d)) ?? null,
    });
  }
  if (dropped.length > 0) {
    console.log(
      `    supervision${opts.label ? ` ${opts.label}` : ""}: ${dropped.length} new process(es) could not be attributed to this run and were DROPPED — ` +
        dropped.slice(0, 3).map((c) => JSON.stringify(c.slice(0, 60))).join(", "),
    );
  }
  // Sorted, because two engines' children start in whatever order the OS
  // scheduled them and the ORDER is not a claim; the SET is.
  survivors.sort((a, b) => a.command.localeCompare(b.command) || Number(a.orphaned) - Number(b.orphaned));
  return { survivors };
}

/** The survivors nothing declared — the leaks, for a caller that wants to report rather than diff. */
export const leaksIn = (snap: ProcessSnapshot): Survivor[] => snap.survivors.filter((s) => s.declared === null);

/**
 * Kill everything the snapshot attributed to this run, and report how many.
 *
 * ## Why the graded path must do this, and it is not tidiness
 *
 * The surface is a DIFFERENCE against a baseline taken at the start of a run.
 * Side A runs first; if it leaves a child, that child is ALREADY RUNNING when
 * side B takes its baseline, so B does not see it as new — and the two sides
 * diff on a leak that BOTH engines produce. Reaping after the snapshot is what
 * makes each side's baseline the same world, which is the condition the
 * comparison was built on.
 *
 * ## And the second reason, which is measured
 *
 * A leaked ENGINE child writes `sessions/<pid>` files into the harness config
 * dir, and the config-dir inventory census reads what a reset saw before wiping
 * it. One uncleanly-ended engine child therefore reddens a later gate phase
 * that has nothing to do with the run that leaked it — observed on the
 * merged-tree gate of 2026-09-05.
 *
 * Only ATTRIBUTED survivors are killed: the same three routes that decide what
 * is graded decide what is reaped, so a process the surface refused to grade is
 * also a process this refuses to signal.
 */
export function reapSurvivors(snap: ProcessSnapshot, table: Map<number, ProcessRow> = processTable()): number {
  const wanted = new Set(snap.survivors.map((s) => s.command));
  let killed = 0;
  for (const row of table.values()) {
    if (row.pid === process.pid || !wanted.has(canonicalCommand(row.command))) continue;
    try {
      process.kill(row.pid, "SIGKILL");
      killed++;
    } catch {
      // already gone between the snapshot and now, which is the outcome anyway
    }
  }
  return killed;
}

// ---- the other half: naming the engine child while it is alive --------------

/**
 * Every command line an engine wrapper `exec`s into.
 *
 * The wrappers are `/bin/sh` scripts that `exec` their target, so the process
 * that exists is the TARGET, not the wrapper — which is why this matches on the
 * paths the harness itself constructed rather than on the wrapper's name.
 */
export const ENGINE_COMMAND_PREFIXES = [`${REFORGE_ROOT}/build/`, `${REFORGE_ROOT}/toolchain/bun`];

export interface EngineChild {
  pid: number;
  command: string;
  descendants: ProcessRow[];
}

/**
 * Find the engine child under this harness process, and everything under it.
 *
 * ## How, and how we know it is the right one
 *
 * The SDK lane does not spawn the engine — `sdk.mjs` does, as a direct child of
 * this process — so unlike `src/signal.ts` (which spawns the engine itself and
 * therefore knows its pid) the harness has to FIND it. Three facts together
 * make the answer unambiguous, and each is asserted rather than assumed:
 *
 *  1. it is a DESCENDANT of this process, because `sdk.mjs` spawns it here;
 *  2. its command line begins with a path THE HARNESS CONSTRUCTED — the
 *     materialized graph under `build/`, the pinned binary symlink, or the
 *     pinned bun — none of which an unrelated process on the machine would run;
 *  3. there is EXACTLY ONE at a time, because one query drives one engine.
 *
 * More than one is a refusal rather than a first match: two engines under one
 * harness means either a scenario driving two queries at once (in which case
 * the caller must say which) or a leaked engine from a previous scenario, and
 * both are things to be told about rather than to pick between.
 */
export function findEngineChild(table: Map<number, ProcessRow> = processTable(), root: number = process.pid): EngineChild | null {
  const candidates = [...table.values()].filter(
    (row) => ENGINE_COMMAND_PREFIXES.some((p) => row.command.startsWith(p)) && reaches(table, row.pid, root),
  );
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new Error(
      `supervision: ${candidates.length} engine children under pid ${root} — ` +
        candidates.map((c) => `${c.pid}:${canonicalCommand(c.command).slice(0, 70)}`).join(" | ") +
        ". One query drives one engine; say which.",
    );
  }
  const engine = candidates[0];
  return { pid: engine.pid, command: canonicalCommand(engine.command), descendants: descendantsOf(table, engine.pid) };
}

/** Everything under `pid` in `table`, breadth-first, deduplicated. */
export function descendantsOf(table: Map<number, ProcessRow>, pid: number): ProcessRow[] {
  const byParent = new Map<number, ProcessRow[]>();
  for (const row of table.values()) byParent.set(row.ppid, [...(byParent.get(row.ppid) ?? []), row]);
  const out: ProcessRow[] = [];
  const seen = new Set<number>([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      out.push(child);
      queue.push(child.pid);
    }
  }
  return out;
}
