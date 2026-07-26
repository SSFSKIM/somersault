import { connect } from "node:net";
import { rmSync, existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { hostSocketPath, rosterPath, runDir } from "../fleet/paths.js";
import { finalizeRoster, listRoster } from "../fleet/roster.js";
import type { RosterRow } from "../fleet/roster.js";
import { socketAnswers as realSocketAnswers } from "../fleet/liveness.js";
const execFileP = promisify(execFile);

/** Undefined for "no such session", THROWS for an ambiguous one. Two outcomes, not one, because rm
 *  reads a missing row as "already done" and returns — folding ambiguity into that silence makes
 *  `ccx rm w1` with two `w1`s exit 0 having removed neither, which reads as success. */
function findTarget(target: string, env: NodeJS.ProcessEnv): RosterRow | undefined {
  const hits = listRoster(env).filter((r) => r.short === target || r.sessionId === target || r.name === target);
  if (hits.length > 1) throw new Error(`ambiguous target ${JSON.stringify(target)} — matches: ${hits.map((h) => `${h.short} (${h.name})`).join(", ")}`);
  return hits[0];
}

/** short id | full session id | name. Ambiguity is an error listing matches — doperpowers addresses
 *  daemons by short and uuid, and a wrong guess would act on someone else's worker. */
export function resolveTarget(target: string, env: NodeJS.ProcessEnv = process.env): RosterRow {
  const hit = findTarget(target, env);
  if (!hit) throw new Error(`no session matches ${JSON.stringify(target)}`);
  return hit;
}

async function realSendStop(path: string): Promise<boolean> {
  if (!(await realSocketAnswers(path))) return false;
  return await new Promise((resolve) => {
    const s = connect({ path }, () => s.write(JSON.stringify({ op: "stop" }) + "\n"));
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.on("data", () => done(true)); s.on("error", () => done(false)); s.setTimeout(1000, () => done(false));
  });
}

export interface LifecycleDeps {
  sendStop: (socketPath: string) => Promise<boolean>;
  worktreeClean?: (wt: string) => Promise<boolean>;
  removeWorktree?: (wt: string) => Promise<void>;
}
const defaults: Required<LifecycleDeps> = {
  sendStop: realSendStop,
  worktreeClean: async (wt) => {
    // A directory that is not there holds no uncommitted work. Without this, every git failure reads as
    // "dirty" — including "no such directory" — and a row left by a half-finished rm can never be
    // removed, refused forever over a path that does not exist. Any OTHER git failure still means
    // dirty: we must not delete on the strength of a probe we could not run.
    if (!existsSync(wt)) return true;
    try { const { stdout } = await execFileP("git", ["-C", wt, "status", "--porcelain"], { timeout: 5000 }); return stdout.trim() === ""; }
    catch { return false; }
  },
  removeWorktree: async (wt) => { await execFileP("git", ["-C", wt, "worktree", "remove", "--force", wt], { timeout: 15000 }).catch(() => { rmSync(wt, { recursive: true, force: true }); }); },
};

/** Ends the turn; the session stays resumable by uuid; idempotent on an already-dead session. */
export async function stopSession(target: string, env: NodeJS.ProcessEnv = process.env, deps: LifecycleDeps = defaults): Promise<void> {
  const row = resolveTarget(target, env);
  await deps.sendStop(hostSocketPath(row.pid, env));
  finalizeRoster(row.short, "stopped", env);
}

/** Deletes the session and its worktree WHEN CLEAN; works on already-exited sessions; idempotent.
 *  Order matters twice over. Stop precedes the worktree so nothing is pulled out from under a live
 *  session — the host's stop awaits its turn finishing naturally, so `clean` is read on quiesced files.
 *  The row is unlinked LAST, after the host has had its chance to finalize: finalizeRoster is
 *  read-then-write, and deleting earlier would let that write put the row back — removed by rm, yet
 *  present in the next listing. See the residual window noted below. */
export async function rmSession(target: string, env: NodeJS.ProcessEnv = process.env, deps: LifecycleDeps = defaults): Promise<void> {
  const row = findTarget(target, env);        // ambiguity throws; only "no such session" is silence
  if (!row) return;                           // already gone ⇒ nothing to do
  await deps.sendStop(hostSocketPath(row.pid, env));
  if (row.worktree) {
    const clean = await (deps.worktreeClean ?? defaults.worktreeClean)(row.worktree);
    if (!clean) throw new Error(`refusing to remove ${row.short}: worktree ${row.worktree} is dirty — commit or discard first`);
    await (deps.removeWorktree ?? defaults.removeWorktree)(row.worktree);
  }
  // Residual race, not closable from this side: the stop ack is best-effort (the host destroys the
  // connection carrying it while closing its server), so rm can return from sendStop while the host is
  // still winding down. If its syncRoster/finalizeRoster reads the row before this unlink and writes
  // after it, the row reappears. A second `rm` clears it.
  rmSync(rosterPath(row.short, env), { force: true });
}

export interface GcDeps { socketAnswers: (socketPath: string) => Promise<boolean> }

/** The only deleter of stale state — `agents` must stay read-only because unlinking races a restart.
 *  Sockets only: hostSocketPath is the sole writer of `<pid>.sock` here, so anything else under run/
 *  belongs to something we do not own, and a sweeper that guesses is how state disappears. */
export async function fleetGc(env: NodeJS.ProcessEnv = process.env,
  deps: GcDeps = { socketAnswers: realSocketAnswers }): Promise<string[]> {
  const removed: string[] = [];
  const run = runDir(env);
  let files: string[] = [];
  try { files = readdirSync(run); } catch { return removed; }
  for (const f of files) {
    if (!f.endsWith(".sock")) continue;
    const p = join(run, f);
    if (existsSync(p) && !(await deps.socketAnswers(p))) { rmSync(p, { force: true }); removed.push(p); }
  }
  return removed;
}
