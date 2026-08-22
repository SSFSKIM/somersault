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
  return join(env.HOME || homedir(), ".claude", "ccx");
}
/** The `roster` segment lives here only — a second copy in roster.ts would fail silently, since a
 *  readdir of the wrong directory just yields an empty fleet. */
export function rosterDir(env: NodeJS.ProcessEnv = process.env): string { return join(fleetRoot(env), "roster"); }
export function rosterPath(short: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(rosterDir(env), `${short}.json`);
}
export function runDir(env: NodeJS.ProcessEnv = process.env): string { return join(fleetRoot(env), "run"); }
/** Keyed by pid — immutable for the host's life. Not /tmp: macOS sweeps unaccessed /tmp files. */
export function hostSocketPath(pid: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(runDir(env), `${pid}.sock`);
}
/** F9 T-IMAGE Task 5 (I3b): the host's OWN scratch dir for staged clipboard images, sibling to its socket
 *  file and keyed the same way (by pid, immutable for the host's life) — `ImageStaging` (host/imageStaging.ts)
 *  mints one file per staged image inside it. Per-host, not a shared fleet-wide `img/` dir: two hosts'
 *  staged files must never collide or be swept by the wrong process's timer. */
export function hostImageStagingDir(pid: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(runDir(env), `${pid}.img`);
}
