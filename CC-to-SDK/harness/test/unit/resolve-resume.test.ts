import { describe, it, expect } from "vitest";
import { resolveResumeArg } from "../../src/cli/resolveResume.js";
import type { ResolveResumeDeps } from "../../src/cli/resolveResume.js";
import type { RosterRow } from "../../src/fleet/roster.js";

const FULL = "0d7a7a9d-1111-2222-3333-444455556666";
const CWD = "/repo";
/** A finished row by default — a LIVE one routes to attach, which is its own test below. */
const row = (o: Partial<RosterRow> & { short: string }): RosterRow =>
  ({ pid: 1, cwd: CWD, kind: "interactive", name: o.short, state: "done", startedAt: 0, ...o });

/** Fakes for the three readers the resolver consults. `resolveTarget` is SYNCHRONOUS and THROWS on a miss
 *  (lifecycle.ts:23) — the fake must miss the same way, or the resolver's catch is never exercised.
 *  `fleet` is the WHOLE roster (listRoster), which the id branches cross-check for liveness; `roster` is
 *  the single row `resolveTarget` resolves a short id to, and joins the fleet listing automatically so a
 *  test never has to state the same row twice. */
function deps(o: { sessions?: { sessionId: string }[]; roster?: RosterRow; fleet?: RosterRow[]; ambiguous?: boolean; seen?: { cwd?: string; opts?: unknown } }): ResolveResumeDeps {
  return {
    listSessions: async (opts?: any) => { if (o.seen) o.seen.opts = opts; return (o.sessions ?? []) as any; },
    resolveTarget: (target: string) => {
      if (o.ambiguous) throw new Error(`ambiguous target ${JSON.stringify(target)} — matches: a (a), b (b)`);
      if (o.roster?.short === target) return o.roster;
      throw new Error(`no session matches ${JSON.stringify(target)}`);
    },
    listRoster: () => [...(o.fleet ?? []), ...(o.roster ? [o.roster] : [])],
  };
}

describe("resolveResumeArg (W-S6)", () => {
  it("accepts a full UUID unchanged", async () => {
    expect(await resolveResumeArg(FULL, CWD, deps({ sessions: [{ sessionId: FULL }] })))
      .toEqual({ kind: "session", id: FULL });
  });

  it("accepts the 8-char prefix /status prints (W-S6)", async () => {
    expect(await resolveResumeArg("0d7a7a9d", CWD, deps({ sessions: [{ sessionId: FULL }] })))
      .toEqual({ kind: "session", id: FULL });
  });

  it("accepts the fleet roster short id the detachable banner prints (W-S6)", async () => {
    // The row's session must ALSO be one this directory holds — see the foreign-roster test below.
    expect(await resolveResumeArg("k3f9", CWD, deps({ sessions: [{ sessionId: FULL }], roster: row({ short: "k3f9", sessionId: FULL }) })))
      .toEqual({ kind: "session", id: FULL });
  });

  it("distinguishes a roster row that has not minted a session id yet", async () => {
    // RosterRow.sessionId is optional and is stamped mid-turn — a session that never completed a turn has
    // a roster row and no id. That is a THIRD outcome, not "unknown".
    expect(await resolveResumeArg("k3f9", CWD, deps({ roster: row({ short: "k3f9", state: "stopped" }) })))
      .toEqual({ kind: "pending", short: "k3f9" });
  });

  it("fails loudly on no match rather than resolving to nothing", async () => {
    expect(await resolveResumeArg("zzzz", CWD, deps({}))).toEqual({ kind: "unknown", arg: "zzzz" });
  });

  it("refuses an ambiguous prefix rather than picking one", async () => {
    const a = "0d7a7a9d-1111-2222-3333-444455556666", b = "0d7a7a9d-9999-8888-7777-666655554444";
    await expect(resolveResumeArg("0d7a7a9d", CWD, deps({ sessions: [{ sessionId: a }, { sessionId: b }] })))
      .rejects.toThrow(/ambiguous/i);
  });

  it("VALIDATES a full UUID against this directory instead of waving it through on shape", async () => {
    // Waved through, a foreign id reaches the REPL's cwd-scoped reader, finds nothing, and leaves the user
    // in a FRESH session under a dim warning at exit 0 — the quiet failure this whole criterion removes.
    expect(await resolveResumeArg(FULL, CWD, deps({ sessions: [{ sessionId: "aaaaaaaa-1111-2222-3333-444455556666" }] })))
      .toEqual({ kind: "unknown", arg: FULL });
  });

  it("scopes the listing to the cwd the id was printed in, and takes no limit", async () => {
    // A limit would make a prefix of an older-than-the-window session unresolvable; the global listing
    // (no cwd) was measured at 4405 rows / 2.2s, and is wrong as well as slow — see the module header.
    const seen: { opts?: any } = {};
    await resolveResumeArg("zzzz", CWD, deps({ seen }));
    expect(seen.opts).toEqual({ cwd: CWD });
  });

  it("sends a STILL-RUNNING roster session to attach rather than starting a second engine on it", async () => {
    expect(await resolveResumeArg("k3f9", CWD, deps({ roster: row({ short: "k3f9", sessionId: FULL, state: "working" }) })))
      .toEqual({ kind: "live", short: "k3f9" });
    expect(await resolveResumeArg("k3f9", CWD, deps({ roster: row({ short: "k3f9", state: "blocked" }) })))
      .toEqual({ kind: "live", short: "k3f9" });
  });

  it("rethrows roster AMBIGUITY instead of reporting a false 'no conversation found'", async () => {
    await expect(resolveResumeArg("w1", CWD, deps({ ambiguous: true }))).rejects.toThrow(/ambiguous target/i);
  });

  // ── External review, finding 1 ──────────────────────────────────────────────────────────────────
  // Liveness was checked in the ROSTER branch only, so the very ids ccx prints for a running session —
  // /status's 8-char UUID prefix and the full UUID — matched the transcript listing FIRST and came back
  // `session`. main then booted a SECOND engine over a live transcript, which is precisely what the
  // `live` outcome exists to prevent; the short id for the same session was already refused.
  it("sends a LIVE session named by its full UUID to attach, not to a second engine", async () => {
    expect(await resolveResumeArg(FULL, CWD, deps({
      sessions: [{ sessionId: FULL }], fleet: [row({ short: "k3f9", sessionId: FULL, state: "working" })],
    }))).toEqual({ kind: "live", short: "k3f9" });
  });

  it("sends a LIVE session named by its 8-char /status prefix to attach too", async () => {
    expect(await resolveResumeArg("0d7a7a9d", CWD, deps({
      sessions: [{ sessionId: FULL }], fleet: [row({ short: "k3f9", sessionId: FULL, state: "blocked" })],
    }))).toEqual({ kind: "live", short: "k3f9" });
  });

  it("still resumes an id whose fleet row has FINISHED — a terminal row is not a live one", async () => {
    expect(await resolveResumeArg(FULL, CWD, deps({
      sessions: [{ sessionId: FULL }], fleet: [row({ short: "k3f9", sessionId: FULL, state: "done" })],
    }))).toEqual({ kind: "session", id: FULL });
  });

  it("resumes an id with no fleet row at all — most transcripts were never fleet sessions", async () => {
    expect(await resolveResumeArg(FULL, CWD, deps({
      sessions: [{ sessionId: FULL }], fleet: [row({ short: "k3f9", sessionId: "other-id", state: "working" })],
    }))).toEqual({ kind: "session", id: FULL });
  });

  // ── External review, finding 3 ──────────────────────────────────────────────────────────────────
  // The roster is FLEET-WIDE; the transcript reader the REPL resumes through is cwd-scoped. A terminal row
  // from another project therefore resolved to an id this directory cannot read, and the user landed in a
  // fresh REPL behind one dim line — the quiet failure the whole resolver exists to remove.
  it("refuses a roster row whose session belongs to ANOTHER project, naming that project", async () => {
    expect(await resolveResumeArg("k3f9", CWD, deps({
      sessions: [{ sessionId: "aaaaaaaa-1111-2222-3333-444455556666" }],
      roster: row({ short: "k3f9", sessionId: FULL, cwd: "/elsewhere" }),
    }))).toEqual({ kind: "foreign", short: "k3f9", path: "/elsewhere" });
  });

  it("names the WORKTREE a foreign row actually ran in, not the repo it was launched from", async () => {
    expect(await resolveResumeArg("k3f9", CWD, deps({
      roster: row({ short: "k3f9", sessionId: FULL, cwd: "/elsewhere", worktree: "/elsewhere/.wt/x" }),
    }))).toEqual({ kind: "foreign", short: "k3f9", path: "/elsewhere/.wt/x" });
  });
});
