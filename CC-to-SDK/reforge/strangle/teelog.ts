// H1 — the gate's own output, archived.
//
// Every count this campaign quotes ("147 of 147, zero FAIL") comes from a gate
// or attestation run, and until now the run that produced it wrote to a
// terminal and, if somebody remembered, to a redirect in `/tmp`. `build/gate.log`
// predates two waves. So the number in a wave record was checkable only by
// re-running an hour-long gate, which nobody does, which means it was checkable
// only in principle.
//
// A LOG MAY CARRY A CLOCK; A FIXTURE MAY NOT. This is the one artifact in the
// tree whose whole purpose is to say WHEN, so the timestamp is in the filename
// and the file lands under `build/` (gitignored, derived) rather than beside a
// committed fixture whose hash a clock would make unstable.
import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";
import { REFORGE_ROOT } from "../src/runTurn.js";

/** `yyyymmdd-hhmm`, LOCAL: the operator reading it is in the operator's timezone. */
function stamp(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * Mirror everything this process prints into `build/<name>-<stamp>.log`, and
 * return the path so the caller can put it in its own header — a log nobody can
 * find is the problem this solves, one step later.
 *
 * BOTH STREAMS. A phase that dies before its verdict says why on stderr, which
 * is exactly the output an archive is for.
 */
export function teeToBuildLog(name: string): string {
  const dir = join(REFORGE_ROOT, "build");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}-${stamp()}.log`);
  const fd = openSync(path, "a");
  for (const channel of ["log", "error", "warn"] as const) {
    const original = console[channel].bind(console);
    console[channel] = (...args: unknown[]): void => {
      original(...args);
      appendFileSync(fd, format(...args) + "\n");
    };
  }
  return path;
}
