import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Exactly 8 lowercase hex. NOT cosmetic: doperpowers' _lib.sh gates its entire purge path on
 *  `[ "${#short}" -eq 8 ]`, so any other length silently disables `claude rm` + jobs cleanup. */
const SHORT_RE = /^[0-9a-f]{8}$/;

export function mintShortId(rand: () => number = Math.random): string {
  let s = "";
  // `& 15` masks a `rand() === 1.0` edge case (out of spec for Math.random but not for an
  // injected rng) to a valid nibble instead of overflowing "10" into a 9-char id.
  for (let i = 0; i < 8; i++) s += (Math.floor(rand() * 16) & 15).toString(16);
  return s;
}
export function isShortId(s: string): boolean { return SHORT_RE.test(s); }

/** Our fleet state root. CCX_FLEET_ROOT overrides it so tests never touch the real fleet.
 *  resolve()d so a relative override doesn't depend on the reading process's cwd. */
export function fleetRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CCX_FLEET_ROOT) return resolve(env.CCX_FLEET_ROOT);
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
