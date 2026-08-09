import { describe, it, expect } from "vitest";
import { resolveResumeArg } from "../../src/cli/resolveResume.js";
import type { ResolveResumeDeps } from "../../src/cli/resolveResume.js";

const FULL = "0d7a7a9d-1111-2222-3333-444455556666";

/** Fakes for the two readers the resolver consults. `resolveTarget` is SYNCHRONOUS and THROWS on a miss
 *  (lifecycle.ts:23) — the fake must miss the same way, or the resolver's catch is never exercised. */
function deps(o: { sessions?: { sessionId: string }[]; roster?: { short: string; sessionId?: string } }): ResolveResumeDeps {
  return {
    listSessions: async () => (o.sessions ?? []) as any,
    resolveTarget: (target: string) => {
      if (o.roster?.short === target) return o.roster as any;
      throw new Error(`no session matches ${JSON.stringify(target)}`);
    },
  };
}

describe("resolveResumeArg (W-S6)", () => {
  it("accepts a full UUID unchanged", async () => {
    expect(await resolveResumeArg(FULL, deps({ sessions: [{ sessionId: FULL }] })))
      .toEqual({ kind: "session", id: FULL });
  });

  it("accepts the 8-char prefix /status prints (W-S6)", async () => {
    expect(await resolveResumeArg("0d7a7a9d", deps({ sessions: [{ sessionId: FULL }] })))
      .toEqual({ kind: "session", id: FULL });
  });

  it("accepts the fleet roster short id the detachable banner prints (W-S6)", async () => {
    expect(await resolveResumeArg("k3f9", deps({ roster: { short: "k3f9", sessionId: FULL } })))
      .toEqual({ kind: "session", id: FULL });
  });

  it("distinguishes a roster row that has not minted a session id yet", async () => {
    // RosterRow.sessionId is optional and is stamped mid-turn — a session that never completed a turn has
    // a roster row and no id. That is a THIRD outcome, not "unknown".
    expect(await resolveResumeArg("k3f9", deps({ roster: { short: "k3f9" } })))
      .toEqual({ kind: "pending", short: "k3f9" });
  });

  it("fails loudly on no match rather than resolving to nothing", async () => {
    expect(await resolveResumeArg("zzzz", deps({}))).toEqual({ kind: "unknown", arg: "zzzz" });
  });

  it("refuses an ambiguous prefix rather than picking one", async () => {
    const a = "0d7a7a9d-1111-2222-3333-444455556666", b = "0d7a7a9d-9999-8888-7777-666655554444";
    await expect(resolveResumeArg("0d7a7a9d", deps({ sessions: [{ sessionId: a }, { sessionId: b }] })))
      .rejects.toThrow(/ambiguous/i);
  });
});
