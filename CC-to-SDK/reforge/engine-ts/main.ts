// engine-ts — the reforge-owned engine, entry point.
//
// Campaign spec §2.4: "The engine-ts skeleton exists from W0: a stream-json
// protocol shell + module registry that boots, reports its owned-module set,
// and fails gracefully on everything unowned." That is exactly and only what
// this does today:
//
//   engines/engine-ts --version   → the pinned engine version it targets
//   engines/engine-ts --owned     → the registered owned-module set (JSON)
//   anything else                 → a structured refusal naming what is unowned,
//                                   on stdout as one JSON line, exit 3
//
// engine-ts has no version of its own. Its version story is the *pin*: it
// targets one upstream release (src/pin.ts), the same one the oracle and the
// extracted graph are materialized from, because the differential gate only
// means something when all three engines answer for the same release. The
// `--version` line therefore carries the pin AND says what it is, so a boot
// check that greps for the version passes while nothing mistakes this for the
// real binary.
import { ENGINE_VERSION } from "../src/pin.js";
import { ownedSet, ownedSubsystems, unownedSubsystems } from "./registry.js";
import { EXIT_UNOWNED, readFirstLine, refusalFrame, type RefusalTrigger } from "./protocol.js";
// The one registration site (contract X7). Side-effect import: it must run
// before anything reads the registry.
import "./modules/index.js";

const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  console.log(`${ENGINE_VERSION} (reforge engine-ts skeleton — targets Claude Code ${ENGINE_VERSION})`);
  process.exit(0);
}

if (argv.includes("--owned")) {
  console.log(
    JSON.stringify(
      {
        engine: "engine-ts",
        targets_engine_version: ENGINE_VERSION,
        owned_modules: ownedSet(),
        owned_subsystems: ownedSubsystems(),
        unowned_subsystems: unownedSubsystems(),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// Everything else is a request to run a session. Read one wire line if the
// caller is speaking stream-json (so the refusal can report what it was asked
// for), then refuse.
const line = await readFirstLine(process.stdin);
const trigger: RefusalTrigger = line !== null ? "stream-json-input" : argv.length > 0 ? "argv-session-request" : "no-input";
const frame = refusalFrame(trigger);
console.log(JSON.stringify(frame));
console.error(`engine-ts: ${frame.message}`);
process.exit(EXIT_UNOWNED);
