import { homedir } from "node:os";
import { join } from "node:path";

/** Exactly 8 lowercase hex. NOT cosmetic: doperpowers' _lib.sh gates its entire purge path on
 *  `[ "${#short}" -eq 8 ]`, so any other length silently disables `claude rm` + jobs cleanup. */
const SHORT_RE = /^[0-9a-f]{8}$/;

export function mintShortId(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}
export function isShortId(s: string): boolean { return SHORT_RE.test(s); }

/** Our fleet state root. CCX_FLEET_ROOT overrides it so tests never touch the real fleet. */
export function fleetRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CCX_FLEET_ROOT) return env.CCX_FLEET_ROOT;
  return join(env.HOME ?? homedir(), ".claude", "ccx");
}
export function rosterPath(short: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(fleetRoot(env), "roster", `${short}.json`);
}
export function runDir(env: NodeJS.ProcessEnv = process.env): string { return join(fleetRoot(env), "run"); }
/** Keyed by pid — immutable for the host's life. Not /tmp: macOS sweeps unaccessed /tmp files. */
export function hostSocketPath(pid: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(runDir(env), `${pid}.sock`);
}
