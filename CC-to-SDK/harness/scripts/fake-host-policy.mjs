// harness/scripts/fake-host-policy.mjs — bl9 T-FOLLOW (spec D7, A8): the pre-follow buffering/replay
// policy for `scripts/fake-host.mjs`, pulled into its OWN pure module because `fake-host.mjs` starts a
// UDS server at import time — a unit test cannot import it without side effects. This module has none.
//
// Narrowed to production semantics (see fake-host.mjs's own header table for the full mapping with
// host.ts line cites). `task`, `decision_settled`, and `rewound` are never recorded pre-follow in the real
// `SessionHost`, so they are never replayed — a frame pushed on this fake host's stdin before any follower
// exists must be dropped, not queued. `message` is buffered/replayed verbatim (production's TurnBuffer
// does the same). `turn` is kept verbatim too: production never replays a raw `turn` frame either, but it
// SYNTHESIZES an observably-equivalent start/truncation frame in its place — this fake host has no turn
// state to synthesize from, so keeping the pushed frame is the DOCUMENTED divergence that produces the
// same pty-visible effect.
export function preFollowReplay(ev) {
  if (ev.kind === "task" || ev.kind === "decision_settled" || ev.kind === "rewound") return null;
  return ev;
}
