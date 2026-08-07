import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnBuffer } from "../../src/host/follow.js";
import { SessionHost, type HostSession } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";
const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-follow-"));

describe("TurnBuffer", () => {
  it("replays in arrival order", () => {
    const b = new TurnBuffer({ maxMessages: 10, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 }); b.push({ n: 3 });
    expect(b.snapshot()).toEqual({ messages: [{ n: 1 }, { n: 2 }, { n: 3 }], truncated: false });
  });

  it("drops the OLDEST past maxMessages and says it truncated", () => {
    const b = new TurnBuffer({ maxMessages: 2, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 }); b.push({ n: 3 });
    const s = b.snapshot();
    expect(s.messages).toEqual([{ n: 2 }, { n: 3 }]);
    expect(s.truncated).toBe(true);      // a follower must know it joined a partial view
  });

  it("drops past maxBytes as well, so one huge message cannot pin the heap", () => {
    const b = new TurnBuffer({ maxMessages: 100, maxBytes: 120 });
    b.push({ pad: "x".repeat(100) });
    b.push({ pad: "y".repeat(100) });
    const s = b.snapshot();
    expect(s.messages).toHaveLength(1);
    expect(JSON.stringify(s.messages[0])).toContain("y");
    expect(s.truncated).toBe(true);
  });

  it("a single message larger than maxBytes is kept, not dropped into nothing", () => {
    const b = new TurnBuffer({ maxMessages: 10, maxBytes: 10 });
    b.push({ pad: "z".repeat(500) });
    expect(b.snapshot().messages).toHaveLength(1);   // an empty replay is worse than an oversized one
  });

  it("reset clears the record and the truncation flag for the next turn", () => {
    const b = new TurnBuffer({ maxMessages: 1, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 });
    expect(b.snapshot().truncated).toBe(true);
    b.reset();
    expect(b.snapshot()).toEqual({ messages: [], truncated: false });
  });
});

/** A session whose turn we drive by hand, so the test controls exactly when messages arrive. */
function fakeSession() {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId: "sid-1",
    submit(_p: string, onMessage: (m: unknown) => void) {
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = () => r(undefined); });
    },
    dispose: async () => {},
    emit: (m: unknown) => emit(m),
    finish: () => finish(),
  };
}

/** The engine shape fakeSession CANNOT express: no session id at all until the first frame of the first
 *  turn dispatches — the id rides the init frame, and the real Session sets `.sessionId` just before
 *  handing that frame on. A fixture that hardcodes the id at construction (fakeSession does, `sid-1`)
 *  makes EP-S2 invisible: follow() spreads whatever id the session already has into its synchronous
 *  subscribe-time `state` frame, so "a state frame carried an id" is true before runTask ever runs. */
const LATE_ID = "0d7a7a9d-1111-2222-3333-444455556666";
function lateIdSession() {
  let deliver: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  const s = {
    sessionId: undefined as string | undefined,
    submit(_p: string, onMessage: (m: unknown) => void) {
      deliver = (m) => { s.sessionId = LATE_ID; onMessage(m); };
      return new Promise<unknown>((r) => { finish = () => r(undefined); });
    },
    dispose: async () => {},
    emit: (m: unknown) => deliver(m),
    finish: () => finish(),
  };
  return s;
}

const hostFor = (session: HostSession & { emit: (m: unknown) => void; finish: () => void }, env: NodeJS.ProcessEnv) =>
  new SessionHost(
    { short: "aaaaaaaa", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" },
  );

describe("SessionHost.follow", () => {
  it("fans one message out to every follower", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const a: HostEvent[] = [], b: HostEvent[] = [];
    host.follow((e) => a.push(e)); host.follow((e) => b.push(e));
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", n: 1 });
    expect(a.filter((e) => e.kind === "message")).toHaveLength(1);
    expect(b.filter((e) => e.kind === "message")).toHaveLength(1);
    s.finish(); await turn; await host.stop();
  });

  it("replays the turn so far to a follower that joins mid-turn", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", n: 1 }); s.emit({ type: "assistant", n: 2 });
    const late: HostEvent[] = [];
    host.follow((e) => late.push(e));
    expect(late.filter((e) => e.kind === "message").map((e: any) => e.data.n)).toEqual([1, 2]);
    s.finish(); await turn; await host.stop();
  });

  it("marks DRAINED frames replay:true and live frames not at all — the stamp-honesty wire contract (F3 final re-review)", async () => {
    // The flag is what lets a client skip arrival-time stamps on catch-up frames (fabricated Agent
    // durations otherwise) while keeping them on live ones. Unpinned, a stray `replay: true` on the
    // live emit would silently strip the duration from every Agent row in the foreground REPL — the
    // re-review's sabotage of exactly that passed 2701 tests before this one existed.
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const liveEvents: HostEvent[] = [];
    host.follow((e) => liveEvents.push(e));
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", n: 1 });
    const liveMsgs = liveEvents.filter((e) => e.kind === "message") as { replay?: true }[];
    expect(liveMsgs).toHaveLength(1);
    expect(liveMsgs[0]!.replay).toBeUndefined();
    const lateEvents: HostEvent[] = [];
    host.follow((e) => lateEvents.push(e));
    const drained = lateEvents.filter((e) => e.kind === "message") as { replay?: true }[];
    expect(drained).toHaveLength(1);
    expect(drained[0]!.replay).toBe(true);
    s.finish(); await turn; await host.stop();
  });

  it("stream_event partials fan out LIVE but never enter the reconnect replay (F3 t3 review)", async () => {
    // The interactive host now runs with includePartialMessages on, so a turn carries thousands of
    // token-delta frames. The 500-message TurnBuffer would evict the turn's REAL frames for stale
    // partials a late follower cannot use — a mid-turn attach would replay junk plus the truncation
    // banner. Live fan-out keeps the partials (the foreground REPL needs them); the replay skips them.
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const liveFollower: HostEvent[] = [];
    host.follow((e) => liveFollower.push(e));
    const turn = host.runTask("hi");
    s.emit({ type: "stream_event", event: { type: "content_block_delta" } });
    s.emit({ type: "assistant", n: 1 });
    s.emit({ type: "stream_event", event: { type: "content_block_delta" } });
    expect(liveFollower.filter((e) => e.kind === "message")).toHaveLength(3);   // live path unchanged
    const late: HostEvent[] = [];
    host.follow((e) => late.push(e));
    expect(late.filter((e) => e.kind === "message").map((e: any) => e.data.type)).toEqual(["assistant"]);
    s.finish(); await turn; await host.stop();
  });

  it("unsubscribing stops delivery and does not disturb the others", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const a: HostEvent[] = [], b: HostEvent[] = [];
    const off = host.follow((e) => a.push(e)); host.follow((e) => b.push(e));
    const turn = host.runTask("hi");
    off();
    s.emit({ type: "assistant", n: 1 });
    expect(a.filter((e) => e.kind === "message")).toHaveLength(0);
    expect(b.filter((e) => e.kind === "message")).toHaveLength(1);
    s.finish(); await turn; await host.stop();
  });

  it("a throwing follower cannot kill the turn or starve the other followers", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const good: HostEvent[] = [];
    host.follow(() => { throw new Error("client blew up"); });
    host.follow((e) => good.push(e));
    const turn = host.runTask("hi");
    expect(() => s.emit({ type: "assistant", n: 1 })).not.toThrow();
    expect(good.filter((e) => e.kind === "message")).toHaveLength(1);
    s.finish(); await expect(turn).resolves.toBeUndefined();
    await host.stop();
  });

  it("tells a late follower the current status as part of the replay, not just through the next event", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", n: 1 });
    const late: HostEvent[] = [];
    host.follow((e) => late.push(e));                          // attaches while the turn is still running
    const stateFrames = late.filter((e) => e.kind === "state");
    expect(stateFrames).toHaveLength(1);
    expect((stateFrames[0] as any).status).toMatchObject({ state: "working", status: "busy" });
    // Last in the replay batch, immediately before live events start — everything before it describes
    // history so far, this one describes right now.
    expect(late[late.length - 1]).toBe(stateFrames[0]);
    s.finish(); await turn; await host.stop();
  });

  // The busy-vs-idle discriminant F1 Task 4's client depends on. It lives in SessionHost.follow, NOT in
  // TurnBuffer: a MID-TURN truncated start carries a numeric `seq` (a live turn — the client opens a
  // LiveTurn and goes busy), while an IDLE truncated start is BARE (a completed tail replay — it must
  // never set busy and has no closing turn:end). This is a characterization pin so a later change to
  // follow() cannot silently erase the distinction. TurnBuffer's limits are private and fixed
  // (maxMessages 500 / maxBytes 1 MiB), so truncation is driven by byte volume rather than injection.
  it("gives an idle truncated attach a bare start frame with no seq and no closing turn:end", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();                                        // same harness the block above uses: runTask needs a live session
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", pad: "a".repeat(600_000) });
    s.emit({ type: "assistant", pad: "b".repeat(600_000) });   // evicts the first: snapshot is truncated
    s.finish(); await turn;                                    // turn COMPLETES, so the next attach is idle
    const late: HostEvent[] = []; host.follow((e) => late.push(e));
    const starts = late.filter((e) => e.kind === "turn" && e.phase === "start");
    expect(starts).toEqual([{ kind: "turn", phase: "start", truncated: true }]);  // bare: carries no `seq`
    expect(starts[0]).not.toHaveProperty("seq");                                  // the busy-vs-idle discriminant
    expect(late.some((e) => e.kind === "turn" && e.phase === "end")).toBe(false);
    await host.stop();
  });

  it("gives a MID-turn truncated attach a numeric seq, then the retained messages and the ending state frame", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();                                        // same harness the block above uses: runTask needs a live session
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", pad: "a".repeat(600_000) });
    s.emit({ type: "assistant", pad: "b".repeat(600_000) });
    const late: HostEvent[] = []; host.follow((e) => late.push(e));               // attaches while the turn is STILL running
    const start = late.find((e) => e.kind === "turn" && e.phase === "start") as any;
    expect(start).toMatchObject({ truncated: true });
    expect(typeof start.seq).toBe("number");
    expect(late.at(-1)!.kind).toBe("state");                                      // the replay always ends on `state`
    s.finish(); await turn; await host.stop();
  });

  it("the buffer resets between turns, so turn two does not replay turn one", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const t1 = host.runTask("one"); s.emit({ type: "assistant", n: 1 }); s.finish(); await t1;
    const t2 = host.runTask("two");
    const late: HostEvent[] = []; host.follow((e) => late.push(e));
    expect(late.filter((e) => e.kind === "message")).toHaveLength(0);
    s.finish(); await t2; await host.stop();
  });

  // EP-S2. `state` is the ONLY frame that populates the client adapter's cached session id
  // (client/chatAdapter.ts), and nine surfaces read that cache — /status's session row, /rename, /tag,
  // /export, /files, /stats, the Settings Stats tab. The host learned the id mid-turn (it stamped the
  // roster with it) and told nobody, so after any number of completed turns those surfaces still said
  // "no session yet". Two traps make a careless version of this test pass while broken: follow()'s
  // subscribe-time `state` frame already carries whatever id the session has (so the fixture's id must
  // start undefined), and onSessionFrame emits `state` for any `system/status` frame carrying a
  // permissionMode (so this turn must carry none). `status: "busy"` pins that the frame arrives while
  // the turn is still open, not at turn end.
  it("publishes the engine's session id to followers mid-turn, on a turn that changes no permission mode (EP-S2)", async () => {
    const s = lateIdSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const seen: HostEvent[] = []; host.follow((e) => seen.push(e));
    const ids = () => seen.filter((e) => e.kind === "state").map((e) => (e as any).status.sessionId);
    expect(ids()).toEqual([undefined]);                        // the subscribe-time frame is not evidence
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", n: 1 });                       // the id materializes as this frame dispatches
    expect(seen.some((e) => e.kind === "state" && (e as any).status.sessionId === LATE_ID && (e as any).status.status === "busy")).toBe(true);
    s.finish(); await turn; await host.stop();
  });
});
