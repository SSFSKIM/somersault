import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnBuffer } from "../../src/host/follow.js";
import { SessionHost } from "../../src/host/host.js";
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

const hostFor = (session: ReturnType<typeof fakeSession>, env: NodeJS.ProcessEnv) =>
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

  it("the buffer resets between turns, so turn two does not replay turn one", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const t1 = host.runTask("one"); s.emit({ type: "assistant", n: 1 }); s.finish(); await t1;
    const t2 = host.runTask("two");
    const late: HostEvent[] = []; host.follow((e) => late.push(e));
    expect(late.filter((e) => e.kind === "message")).toHaveLength(0);
    s.finish(); await t2; await host.stop();
  });
});
