import { connect } from "node:net";
import { rmSync, existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, join } from "node:path";
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

/** A budget for the WHOLE exchange, not an inactivity window: node CLEARS `socket.setTimeout` when the
 *  socket is destroyed, and a peer FIN auto-destroys it — so an inactivity timer cannot bound the one
 *  case that needs bounding. Only a plain timer nothing can reset does. */
const STOP_DEADLINE_MS = 1000;

/** Exactly the three members sendStop drives on a connection, so a unit test supplies a fake and never
 *  opens a socket. */
export interface StopSocket {
  write(data: string): unknown;
  on(event: "data" | "close" | "error", fn: () => void): unknown;
  destroy(): unknown;
}
export interface SendStopDeps {
  socketAnswers: (socketPath: string) => Promise<boolean>;
  connect: (socketPath: string, onConnect: () => void) => StopSocket;
  deadlineMs?: number;
}
const realStopDeps: SendStopDeps = { socketAnswers: realSocketAnswers, connect: (path, onConnect) => connect({ path }, onConnect) };

/** One `stop` op over a host's UDS. Never stays pending: the ack, an error, the host's own EOF and the
 *  deadline all settle it exactly once. `close` is the one that matters and the one that was missing —
 *  a host ending the connection without replying left this promise pending FOREVER, so
 *  `await deps.sendStop(...)` never returned, `stopped` was never recorded, and with nothing else holding
 *  the loop open the process exited 0 having done nothing: a `ccx stop` that reports success over a row
 *  still reading `working`. Measured on the ordinary path a closing host DESTROYS the open connection
 *  (~3ms, `error`/`close`); the deadline below is the silent-host path, not the ordinary one. */
export async function sendStop(socketPath: string, deps: SendStopDeps = realStopDeps): Promise<boolean> {
  if (!(await deps.socketAnswers(socketPath))) return false;
  return await new Promise((resolve) => {
    const s = deps.connect(socketPath, () => s.write(JSON.stringify({ op: "stop" }) + "\n"));
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const done = (v: boolean) => { if (settled) return; settled = true; clearTimeout(timer); s.destroy(); resolve(v); };
    timer = setTimeout(() => done(false), deps.deadlineMs ?? STOP_DEADLINE_MS);
    s.on("data", () => done(true));
    s.on("close", () => done(false));      // our own destroy() re-enters here too — hence the settled guard
    s.on("error", () => done(false));
  });
}

/** `git` with our args. Injected so the destructive path is testable without a real repository. */
export type GitRun = (args: string[]) => Promise<unknown>;
const realGit: GitRun = (args) => execFileP("git", args, { timeout: 15000 });

/** Removes a worktree, or REFUSES. There is deliberately no recursive-delete fallback: `git worktree
 *  remove` fails for many reasons, among them "the path is a MAIN working tree", and answering that with
 *  `rm -rf` deletes the repository — `.git`, history and all — plus every ignored-but-precious file
 *  (`.env`, build output) that `git status --porcelain` never listed and the cleanliness gate therefore
 *  passed. Reachable, not theoretical: `--worktree` is an unvalidated raw string and nothing here ever
 *  ran `git worktree add`, so a failed removal says nothing about what the directory is. Refuse loudly,
 *  naming the path and git's own words, and leave the row in place — the posture a dirty worktree
 *  already gets. */
export async function gitRemoveWorktree(wt: string, run: GitRun = realGit): Promise<void> {
  // Nothing there is nothing to remove — the same short-circuit worktreeClean makes, and what keeps a row
  // whose worktree already vanished removable now that a failed `git -C <gone>` is fatal rather than swept
  // under an rm.
  if (!existsSync(wt)) return;
  try { await run(["-C", wt, "worktree", "remove", "--force", wt]); }
  catch (e) { throw new Error(`refusing to remove worktree ${wt}: git worktree remove failed (${(e as Error)?.message ?? e}) — leave it, or delete it yourself once you know what it is`); }
}

export interface LifecycleDeps {
  sendStop: (socketPath: string) => Promise<boolean>;
  worktreeClean?: (wt: string) => Promise<boolean>;
  removeWorktree?: (wt: string) => Promise<void>;
}
const defaults: Required<LifecycleDeps> = {
  sendStop,
  worktreeClean: async (wt) => {
    // A directory that is not there holds no uncommitted work. Without this, every git failure reads as
    // "dirty" — including "no such directory" — and a row left by a half-finished rm can never be
    // removed, refused forever over a path that does not exist. Any OTHER git failure still means
    // dirty: we must not delete on the strength of a probe we could not run.
    if (!existsSync(wt)) return true;
    try { const { stdout } = await execFileP("git", ["-C", wt, "status", "--porcelain"], { timeout: 5000 }); return stdout.trim() === ""; }
    catch { return false; }
  },
  removeWorktree: gitRemoveWorktree,
};

/** Ends the turn; the session stays resumable by uuid; idempotent on an already-dead session. Silent on a
 *  row that is already GONE, exactly like rm: stop is expected to race a session's own exit, and a
 *  concurrent `rm` unlinking the row under it is that same race one step further along — throwing there
 *  fails a stop that had nothing left to do. Ambiguity still throws, in both commands. */
export async function stopSession(target: string, env: NodeJS.ProcessEnv = process.env, deps: LifecycleDeps = defaults): Promise<void> {
  const row = findTarget(target, env);
  if (!row) return;
  await deps.sendStop(hostSocketPath(row.pid, env));
  finalizeRoster(row.short, "stopped", env);
}

/** Deletes the session and its worktree WHEN CLEAN; works on already-exited sessions; idempotent.
 *  Order matters twice over. Stop precedes the worktree so nothing is pulled out from under a live
 *  session — the host's stop awaits its turn finishing naturally, so `clean` is read on quiesced files.
 *  The row is unlinked LAST, after the host has had its chance to finalize: the host's roster sync is
 *  read-then-write, and deleting earlier would let that write put the row back — removed by rm, yet
 *  present in the next listing. See the residual window noted below. */
export async function rmSession(target: string, env: NodeJS.ProcessEnv = process.env, deps: LifecycleDeps = defaults): Promise<void> {
  const row = findTarget(target, env);        // ambiguity throws; only "no such session" is silence
  if (!row) return;                           // already gone ⇒ nothing to do
  // Checked before anything is stopped or deleted. existsSync, `git -C` and the removal would each
  // resolve a relative path against the directory THIS process was invoked from — not the directory the
  // session recorded it from, which the row does not even name. A path that then misses reads as "clean"
  // (nothing there holds no work) and the removal runs against whatever `wt` means HERE. Resolving it
  // would only make that guess look deliberate, and this half of the CLI deletes things: refuse, and say
  // which value we would have had to guess at.
  if (row.worktree && !isAbsolute(row.worktree)) throw new Error(`refusing to remove ${row.short}: worktree ${JSON.stringify(row.worktree)} is not an absolute path — rm cannot know which directory it was relative to`);
  await deps.sendStop(hostSocketPath(row.pid, env));
  if (row.worktree) {
    const clean = await (deps.worktreeClean ?? defaults.worktreeClean)(row.worktree);
    if (!clean) throw new Error(`refusing to remove ${row.short}: worktree ${row.worktree} is dirty — commit or discard first`);
    await (deps.removeWorktree ?? defaults.removeWorktree)(row.worktree);
  }
  // Residual race, not closable from this side: the stop ack is best-effort (the host destroys the
  // connection carrying it while closing its server), so rm can return from sendStop while the host is
  // still winding down. The write that can then resurrect the row is the host's own syncRoster: its
  // sessionId write is read-then-write and gated ONLY on the row existing at read time, so a read before
  // this unlink and a write after it puts the row back. finalizeRoster cannot — it early-returns on a
  // missing row, and on an already-terminal one. A second `rm` clears it.
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
