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

main(process.argv.slice(2)).then(exitAfterFlush).catch((e) => {
  console.error(`ccx: ${(e as Error)?.stack ?? e}`);
  exitAfterFlush(1);
});
