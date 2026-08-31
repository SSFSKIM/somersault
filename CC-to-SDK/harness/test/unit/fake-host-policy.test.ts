import { describe, expect, it } from "vitest";
import { preFollowReplay } from "../../scripts/fake-host-policy.mjs";

// bl9 T-FOLLOW (spec D7, A8) — the fake host's pre-follow buffer used to be kind-agnostic (strictly more
// generous than production, R1 §3): every kind pushed before a follower existed was buffered and replayed
// verbatim. Production's real `SessionHost.follow()` (host.ts:760-802) replays only `message` frames from
// its TurnBuffer, plus a SYNTHESIZED `turn` start/truncation frame — `task`, `decision_settled`, and
// `rewound` are never recorded pre-follow and so are never replayed (R1 §1's frame-lifecycle table). This
// narrows the extracted policy to match, red-first: written while `preFollowReplay` was still the
// kind-agnostic `(ev) => ev` placeholder, so the three "dropped" assertions below failed before the
// narrowing landed.
describe("preFollowReplay — fake-host pre-follow drain policy", () => {
  it("drops task/decision_settled/rewound from the pre-follow drain — production replays none", () => {
    expect(preFollowReplay({ kind: "task", data: {} })).toBeNull();
    expect(preFollowReplay({ kind: "decision_settled", toolUseID: "t", by: "x", decision: "deny" })).toBeNull();
    expect(preFollowReplay({ kind: "rewound", sessionId: "s", prevUuid: "u" })).toBeNull();
  });

  it("keeps message verbatim and turn as the documented divergence", () => {
    const message = { kind: "message", data: { type: "assistant" } };
    expect(preFollowReplay(message)).toEqual(message);
    // production never replays a raw `turn` frame either — it SYNTHESIZES an equivalent start/truncation
    // frame in its place (host.ts:767-771). The fake host has no turn state to synthesize from, so it
    // keeps the pushed frame verbatim instead: an observably-equivalent start frame lands either way,
    // which is all the pty cells (framesFor's own "turn-start"/"turn-end" words) exercise.
    const turn = { kind: "turn", phase: "start", seq: 1 };
    expect(preFollowReplay(turn)).toEqual(turn);
  });
});
