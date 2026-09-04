// H1 — the single-writer lock over the harness's shared mutable state.
//
// WHY. `sandbox/`, `config/` and `build/` are ONE machine, shared by every suite
// in the tree, and `resetSandbox()` wipes two of them at the top of every run.
// Two harness processes running at once therefore do not interleave — they
// destroy each other's world mid-measurement, and the damage is silent: the
// victim sees an empty transcript, a missing seed, a cassette entry that never
// matched, and reports it as an engine difference. This campaign has paid for
// that twice (a duplicated retry chain; a Monitor watching the wrong pid), and
// the waves after it run two workers concurrently by design.
//
// So the guard is formalised at the one choke point every suite already goes
// through. `resetSandbox()` acquires this lock on its first call in a process;
// a live holder that is not us is a LOUD REFUSAL naming the holder, never a
// wait and never a steal. Waiting would deadlock a fleet whose members block on
// each other's hour-long gates; stealing would produce exactly the corruption
// the lock exists to prevent, one process later.
//
// CHILDREN OF A HOLDER ARE NOT PEERS. The gate holds the lock for its whole run
// and spawns its suites as child processes, each of which calls
// `resetSandbox()`. Those children are the holder's own serialized work, not a
// second writer. They are recognised by an ENV MARKER carrying the owner's pid
// (`REFORGE_SANDBOX_LOCK_OWNER`), set by the acquirer into its own
// `process.env` so that every descendant inherits it.
//
// THE MARKER RATHER THAN AN ANCESTOR WALK, and the reason is which spawn path
// each child takes. Harness children — `strangle/gate.ts`, `m2/all.ts`,
// `strangle/attest.ts` — are spawned with `spawnSync(cmd, args, {cwd, encoding})`
// and NO `env` option, so they inherit `process.env` verbatim, marker included,
// through any depth of nesting. ENGINE children are the opposite case: their
// environment is CONSTRUCTED by `src/env.ts`'s X6 allowlist, which drops every
// name the schema does not list, so the marker cannot reach an engine even by
// accident — and it must not, because an engine is not a harness process and
// never calls `resetSandbox()`. The allowlist is therefore not an obstacle to
// this mechanism; it is the half of it that keeps the marker inside the harness.
// An ancestor walk (`ps -o ppid`) would buy the same recognition at the cost of
// spawning a process to answer a question the environment already answers, and
// it would answer it WRONGLY for a detached holder whose child is reparented.
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REFORGE_ROOT } from "./runTurn.js";

/** Gitignored, and per-checkout: the state it guards is per-checkout too. */
export const LOCK_PATH = join(REFORGE_ROOT, ".sandbox.lock");

/** The owner's pid, inherited by every harness descendant of the holder. */
export const OWNER_ENV = "REFORGE_SANDBOX_LOCK_OWNER";

export interface LockRecord {
  pid: number;
  /** the holder's command line, so a refusal names something an operator can find */
  argv: string;
}

/** Signals the harness may be stopped by. `nohup` + `kill` sends the first. */
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** The lock path this process has settled, and whether it is the OWNER of it. */
let settled: string | null = null;
let owned = false;

/**
 * Does this pid exist? `EPERM` means it does and belongs to somebody else —
 * which is still a live holder, so it must not be read as "gone".
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): LockRecord | null {
  try {
    const rec = JSON.parse(readFileSync(path, "utf8")) as LockRecord;
    return typeof rec?.pid === "number" ? rec : null;
  } catch {
    // Missing, or a half-written file from a process killed between `open` and
    // `write`. Neither names a holder, so neither can refuse anybody.
    return null;
  }
}

function releaseNow(path: string): void {
  if (!owned) return;
  const rec = readLock(path);
  // Only ever OUR record: a lock some later process took over after we were
  // presumed dead is not ours to delete.
  if (rec !== null && rec.pid === process.pid) rmSync(path, { force: true });
  owned = false;
}

/**
 * Take the sandbox for this process, or refuse.
 *
 * `purpose` is what the acquirer is about to do; it is printed, not stored,
 * because the stored `argv` is the fact an operator can act on.
 */
export function acquireSandboxLock(purpose: string, lockPath: string = LOCK_PATH): void {
  if (settled === lockPath) return;

  const marked = process.env[OWNER_ENV];
  if (marked !== undefined && Number(marked) !== process.pid) {
    const held = readLock(lockPath);
    if (held !== null && held.pid === Number(marked) && alive(held.pid)) {
      // A child of the holder, doing the holder's own work in its turn. It
      // neither acquires nor releases: the lock outlives it.
      settled = lockPath;
      owned = false;
      return;
    }
    // The marker names a process that is gone, or a lock somebody else now
    // holds. An inherited name is not a right; fall through and acquire.
  }

  // Three attempts, because the only reason to go round again is that a DEAD
  // holder's record was cleared between the failed create and the read — a race
  // with at most as many rounds as there are stale records.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // `wx`: create-or-fail, so two acquirers racing an empty directory cannot
      // both believe they won.
      const fd = openSync(lockPath, "wx");
      const record: LockRecord = { pid: process.pid, argv: process.argv.slice(1).join(" ") };
      writeFileSync(fd, JSON.stringify(record) + "\n");
      closeSync(fd);
      settled = lockPath;
      owned = true;
      process.env[OWNER_ENV] = String(process.pid);
      process.once("exit", () => releaseNow(lockPath));
      for (const sig of SIGNALS) {
        const handler = (): void => {
          // RELEASE, THEN RE-RAISE. Registering a listener at all suppresses the
          // default termination, so a lock that swallowed the signal would turn
          // `kill <gate>` into a process that stops nothing and holds forever.
          releaseNow(lockPath);
          process.off(sig, handler);
          process.kill(process.pid, sig);
        };
        process.on(sig, handler);
      }
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const held = readLock(lockPath);
      if (held === null) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (held.pid !== process.pid && alive(held.pid)) {
        throw new Error(
          `ABORT: the reforge sandbox is held by pid ${held.pid} — ${held.argv || "<no argv recorded>"}. ` +
            `This process wanted it for: ${purpose}. sandbox/, config/ and build/ have ONE writer; find that pid ` +
            `(ps -p ${held.pid} -o pid,etime,command), wait for it or stop it. Do NOT delete ${lockPath} while it is alive.`,
        );
      }
      // A pid that no longer exists (a SIGKILLed gate leaves exactly this), or
      // our own record from a previous life. Take it over, out loud: a lock that
      // silently reappeared would hide the crash that dropped it.
      console.log(`  sandbox lock: pid ${held.pid} is gone (${held.argv || "<no argv recorded>"}) — taking over for ${purpose}`);
      rmSync(lockPath, { force: true });
    }
  }
  throw new Error(`ABORT: the sandbox lock at ${lockPath} could not be settled in three attempts (${purpose}).`);
}

/** For tests and for a caller that wants the sandbox back before it exits. */
export function releaseSandboxLock(lockPath: string = LOCK_PATH): void {
  releaseNow(lockPath);
  if (settled === lockPath) settled = null;
  if (process.env[OWNER_ENV] === String(process.pid)) delete process.env[OWNER_ENV];
}

/** Who holds it, for a caller that wants to report rather than acquire. */
export function sandboxLockHolder(lockPath: string = LOCK_PATH): LockRecord | null {
  return existsSync(lockPath) ? readLock(lockPath) : null;
}
