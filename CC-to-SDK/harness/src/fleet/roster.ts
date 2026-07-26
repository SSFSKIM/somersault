import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fleetRoot, rosterPath, isShortId } from "./paths.js";

export type FleetState = "working" | "blocked" | "done" | "error" | "stopped";
export const TERMINAL: ReadonlySet<FleetState> = new Set<FleetState>(["done", "error", "stopped"]);

export interface RosterRow {
  short: string; sessionId?: string; pid: number; cwd: string; worktree?: string;
  kind: "bg" | "interactive"; name: string; state: FleetState; startedAt: number; endedAt?: number;
  /** A bare `--bg` with no permission config from any source: nothing can ever route a decision to a
   *  human, so `agents` must say so. Set once at start by the host; never derived at read time. */
  noHumanSeam?: boolean;
}

export function writeRoster(row: RosterRow, env: NodeJS.ProcessEnv = process.env): void {
  const p = rosterPath(row.short, env);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(row), { mode: 0o600 });
}

export function readRoster(short: string, env: NodeJS.ProcessEnv = process.env): RosterRow | undefined {
  try { return JSON.parse(readFileSync(rosterPath(short, env), "utf8")) as RosterRow; } catch { return undefined; }
}

export function listRoster(env: NodeJS.ProcessEnv = process.env): RosterRow[] {
  let files: string[];
  try { files = readdirSync(join(fleetRoot(env), "roster")); } catch { return []; }
  const out: RosterRow[] = [];
  for (const f of files) {
    const short = f.replace(/\.json$/, "");
    if (!isShortId(short)) continue;
    const r = readRoster(short, env);           // a corrupt row must not sink the listing
    if (r) out.push(r);
  }
  return out;
}

/** Stamp the terminal state. Idempotent and silent on an unknown short: stop/rm may race an exit. */
export function finalizeRoster(short: string, state: FleetState, env: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now): void {
  const r = readRoster(short, env);
  if (!r) return;
  writeRoster({ ...r, state, endedAt: now() }, env);
}
