import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { rosterDir, rosterPath, isShortId } from "./paths.js";

export type FleetState = "working" | "blocked" | "done" | "error" | "stopped";
export const TERMINAL: ReadonlySet<FleetState> = new Set<FleetState>(["done", "error", "stopped"]);

export interface RosterRow {
  short: string; sessionId?: string; pid: number; cwd: string; worktree?: string;
  kind: "bg" | "interactive"; name: string; state: FleetState; startedAt: number; endedAt?: number;
  /** Our own copy of the host's `ps -o lstart=` stamp. The ENGINE's registry row carries one too, but
   *  it is unlinked when the session exits — and a roster row outlives it. Without our own copy,
   *  `isPidLive(pid, undefined)` answers "live" for every dead-but-unfinalized session, so a crashed
   *  host would read `working`/unresponsive forever instead of `error`. */
  procStart?: string;
}

/** Write-then-rename, not a bare write. `writeFileSync` truncates first, so a host killed mid-write
 *  leaves a permanently unparseable row — and since finalizeRoster early-returns on an unreadable row,
 *  that session could never be marked terminal and a poller would wait on it forever. The temp name
 *  carries the pid so two writers cannot clobber each other's staging file; `listRoster`'s isShortId
 *  filter already ignores anything ending in `.tmp`. */
export function writeRoster(row: RosterRow, env: NodeJS.ProcessEnv = process.env): void {
  if (!isShortId(row.short)) throw new Error(`refusing to write a roster row with short ${JSON.stringify(row.short)}`);
  const p = rosterPath(row.short, env);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(row), { mode: 0o600 });
  renameSync(tmp, p);                          // same-directory rename is atomic on POSIX
}

export function readRoster(short: string, env: NodeJS.ProcessEnv = process.env): RosterRow | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(rosterPath(short, env), "utf8")); } catch { return undefined; }
  // "skip unparseable rows" has to cover "parsed, but not a row" — a stray `[]` or `123` would
  // otherwise enter the listing as a row whose every field is undefined.
  const r = parsed as RosterRow;
  return r && typeof r === "object" && isShortId(r.short) ? r : undefined;
}

export function listRoster(env: NodeJS.ProcessEnv = process.env): RosterRow[] {
  let files: string[];
  try { files = readdirSync(rosterDir(env)); } catch { return []; }
  const out: RosterRow[] = [];
  for (const f of files) {
    const short = f.replace(/\.json$/, "");
    if (!isShortId(short)) continue;
    const r = readRoster(short, env);           // a corrupt row must not sink the listing
    if (r) out.push(r);
  }
  return out;
}

/** Stamp the terminal state. Silent on an unknown short, and FIRST TERMINAL WINS: `stop` legitimately
 *  races a session's own exit, and the loser must not overwrite a truthful `done` with `stopped` or
 *  re-stamp endedAt. That guard is what makes this genuinely idempotent. */
export function finalizeRoster(short: string, state: FleetState, env: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now): void {
  const r = readRoster(short, env);
  if (!r || TERMINAL.has(r.state)) return;
  writeRoster({ ...r, state, endedAt: now() }, env);
}
