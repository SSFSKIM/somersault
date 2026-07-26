#!/usr/bin/env node
import { main } from "./main.js";

/** Exit only once stdout has actually drained. `process.exit()` discards writes still queued on a PIPE,
 *  and every consumer reads us through one (`claude agents --json --all | python3`) — a truncated
 *  listing is a JSON parse error in the poller, on a command that reported success. The empty write
 *  settles after the ordered writes before it; setting exitCode first means an exit by any other route
 *  still carries the right code. */
function exitAfterFlush(code: number): void {
  process.exitCode = code;
  process.stdout.write("", () => process.exit(code));
}

/** The same `ccx: <what went wrong>` shape main prints for every refusal — one program, one stderr shape.
 *  What reaches here is operator-facing (an unreadable settings file, a spawn that failed), and a stack of
 *  our own frames is noise to the operator reading it. A throw that is not an Error has no message to
 *  print, so it is rendered whole: that one is OUR bug, and whatever it carries is the only clue there is. */
main(process.argv.slice(2)).then(exitAfterFlush).catch((e) => {
  console.error(`ccx: ${e instanceof Error ? e.message : ((e as { stack?: string } | null)?.stack ?? String(e))}`);
  exitAfterFlush(1);
});
