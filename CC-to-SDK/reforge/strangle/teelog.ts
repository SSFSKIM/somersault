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
import { REFORGE_ROOT } from "../src/runTurn.js";

/**
 * What an archive says when the run did not reach a verdict. Exported so the
 * control greps for the marker rather than for a copy of the prose.
 */
export const DIED_MARKER = "THE RUN DIED OF AN UNCAUGHT ERROR";

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
 *
 * THE STREAMS RATHER THAN `console`, and the difference is what a crash does.
 * Wrapping `console.log`/`error`/`warn` archives everything a run CHOOSES to
 * print and nothing it dies of. The output that matters most here is the second
 * kind: `acquireSandboxLock` refuses by THROWING, one line into the gate, and an
 * uncaught throw is not a `console` call — so the one line explaining why an
 * hour-long run produced no verdict reached the terminal and never the archive.
 * `console` is built ON these two streams and calls `write` on them at call
 * time, so patching underneath catches its output as well as everything written
 * past it, and catches it in the exact bytes the terminal got rather than in a
 * `format()` reconstruction.
 *
 * AND A CRASH HOOK, because the streams are not enough on their own: Node prints
 * an uncaught exception from BELOW the JavaScript stream objects (measured — a
 * patched `process.stderr.write` never sees it), so the only way into the
 * archive is to handle the event. Handling it suppresses the default death, so
 * the handler does the default's job by hand — print it, then exit non-zero,
 * which still runs the `exit` listeners the sandbox lock releases from. The
 * shape is the same bargain `src/lock.ts` makes with its signal handlers.
 *
 * ONE MARKER FOR BOTH ORIGINS. Every phase here is an ES module, and a THROW at
 * the top level of one arrives as a rejected module-evaluation promise — so the
 * gate's lock refusal reaches this handler with `origin === "unhandledRejection"`
 * even though nothing in it is asynchronous. Labelling the archive line by the
 * origin would therefore tell a reader the wrong thing about the commonest case;
 * the origin is kept, in parentheses, beside a marker that says what actually
 * happened.
 */
export function teeToBuildLog(name: string): string {
  const dir = join(REFORGE_ROOT, "build");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}-${stamp()}.log`);
  const fd = openSync(path, "a");
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      // Mirrored FIRST and synchronously: the archive is the copy that has to
      // survive, and a terminal write to a pipe can be cut short by the exit
      // that follows a crash.
      appendFileSync(fd, typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array));
      return original(chunk, ...rest);
    }) as typeof stream.write;
  }
  process.on("uncaughtException", (err, origin) => {
    // Through the patched stream, so it lands in both places in one call.
    process.stderr.write(`\n${DIED_MARKER} (${origin}): ${(err as Error)?.stack ?? String(err)}\n`);
    process.exit(1);
  });
  return path;
}
