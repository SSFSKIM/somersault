// SABOTAGE wiring — and this row is the INVERSE of every other one here.
//
// `hook-stderr-tail` is adjudicated DARK, so the manifest names a `darkOver`
// population instead of coverage and the gate requires every one of those ten
// scenarios to stay GREEN with this built. A RED there does not prove liveness;
// it proves the darkness verdict has gone stale and the row needs coverage.
//
// The header used to read "hooks-command and hooks-precompact MUST go red",
// which was the expectation the wave started with and the opposite of what it
// measured.
import { hookStderrTail } from "./hook-stderr-tail/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  hookStderrTail(...args) {
    return hookStderrTail(...args);
  },
});
