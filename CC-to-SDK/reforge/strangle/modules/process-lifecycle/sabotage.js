// SABOTAGE LAYER (§2.5) — one twin per RETAINED EXPORT, not one per chunk.
//
// `--sabotage process-lifecycle:<export>` takes exactly that binding from here
// and leaves the other two on `reference.js`, because §2.2 prices S-chunk at
// sabotage evidence per retained export and a single all-three twin would pass
// as long as any one of them is live.
//
// EACH TWIN INVERTS THE ONE THING ITS EXPORT MEANS, and the red it is supposed
// to produce is written down next to it. That matters more here than in a
// description module: these three are consulted 90 times bundle-wide and two of
// them do their work by NOT returning, so "what would break" is not obvious from
// the twin alone.
//
// Every twin keeps its shape — a predicate returning a boolean, a void setter, a
// thenable — so a red comes from the differential surfaces rather than from a
// TypeError two frames away, which would be a crash and therefore INCONCLUSIVE
// under the gate's three-outcome rule rather than evidence.

/**
 * ANSWER TRUE FROM THE FIRST TICK. The engine believes it is already shutting
 * down before the session has begun, so every `if (isShuttingDown() && !aborted)
 * await hang()` guard in the graph takes its shutdown arm on a healthy run: the
 * turn stops producing, and the scenario either grades no result or does not
 * finish. Both are RED — a replay that does not finish is RED under the gate's
 * liveness rule, because the faithful build replays the same cassette in
 * seconds.
 */
export function isShuttingDown() {
  return true;
}

/**
 * REFUSE TO LATCH. The commit is dropped, so a signal that should have put the
 * process into shutdown leaves every reader answering false. The turn in flight
 * is still aborted by upstream's handler, so what changes is not "the engine
 * keeps running" but WHICH way it stops — the abort path emits, the shutdown
 * path is silent. Graded by the SIGTERM scenario, which compares exactly that.
 */
export function commitShutdown() {
  // deliberately nothing
}

/**
 * SETTLE. The promise resolves immediately instead of never, so every
 * `await hang()` returns and the continuation upstream meant to abandon runs
 * anyway. This is the twin that separates "stopped" from "stopped silently":
 * with it, a shutdown mid-turn produces the yields upstream suppresses.
 */
export function hang() {
  return Promise.resolve();
}
