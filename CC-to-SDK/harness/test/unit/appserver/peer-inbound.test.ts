// test/unit/appserver/peer-inbound.test.ts — adoption, and every way out of it.
//
// The tests that matter here are the ones where the ENGINE moves before the SERVER does: a chain held by
// a settings mutation, a terminal that lands before the runner installs, a swap under an installed
// observer, a close while a turn is adopted. Each is a way a thread can be left busy forever, and none of
// them is reachable by a test that lets every promise resolve in order first.
import { describe, it, expect, vi } from "vitest";
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

const fileCcxDir = mkdtempSync(join(tmpdir(), "m8ccx-peer-inbound-"));
afterAll(() => { rmSync(fileCcxDir, { recursive: true, force: true }); });
const notes = (lines: string[], method: string) => parsed(lines).filter((m) => m.method === method);

const LIFECYCLE = (state: string, uuid: string) => ({ type: "command_lifecycle", command_uuid: uuid, state, session_id: "s", uuid: "f" });
const ASSISTANT = (text: string) => ({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text }] } });
const RESULT = (over: Record<string, unknown> = {}) => ({ type: "result", subtype: "success", is_error: false, ...over });

/** An engine fake that lets a test PUSH frames, so the observer under test is driven by frame order
 *  rather than by promise order. `onFrame` and `onUnclaimedResult` mirror the real Session seams —
 *  both return an unsubscribe, and both are consulted synchronously from the read loop. */
function pushEngine() {
  const frameSubs = new Set<(f: unknown) => void>();
  const resultSubs = new Set<(r: unknown) => boolean>();
  return {
    engine: {
      onFrame: (cb: (f: unknown) => void) => { frameSubs.add(cb); return () => frameSubs.delete(cb); },
      onUnclaimedResult: (cb: (r: unknown) => boolean) => { resultSubs.add(cb); return () => resultSubs.delete(cb); },
      submit: async () => undefined,
      dispose: async () => {},
      interrupt: async () => {},
    } as any,
    push: (f: unknown) => { for (const s of [...frameSubs]) s(f); },
    pushResult: (r: unknown) => { let claimed = false; for (const s of [...resultSubs]) claimed = s(r) || claimed; return claimed; },
    live: () => frameSubs.size,
  };
}

// The real constructor is `(opts, deps)` and the engine factory is `deps.sessionFactory` — Task 8
// measured this against the running code, so do not reintroduce a `makeSession` option. `ccxDir` and
// `listSessions` are injected for the reason peer-policy.test.ts states: without them a resume path
// reads the operator's real ~/.claude/ccx.
const boot = (engine: unknown) =>
  new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: (() => engine) as never });

async function startAccepting(engine: any) {
  const srv = boot(engine);
  const { lines, sink } = mkSink();
  const c = srv.connect(sink);
  send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
  send(c, { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
  await tick();
  // The reply is `{ thread: <view> }` — the one projection every thread-carrying reply goes through.
  const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
  send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
  await tick();
  lines.length = 0;
  return { srv, c, lines, threadId, record: srv.registry.get(threadId)! };
}

describe("adoption", () => {
  it("a foreign lifecycle start opens a real turn, and the model's output reaches subscribers", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-1"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(1);

    e.push(ASSISTANT("hello from the peer's turn"));
    await tick();
    // THE POINT OF THIS CASE: an adopted turn that publishes only lifecycle edges is a turn whose
    // subscribers see none of the model's answer. The assistant frame must reach TurnMapper.ingest.
    const items = notes(lines, "item/completed").concat(notes(lines, "item/started"), notes(lines, "item/updated"));
    expect(JSON.stringify(items)).toContain("hello from the peer's turn");

    e.pushResult(RESULT());
    e.push(LIFECYCLE("completed", "foreign-1"));
    await tick();
    const done = notes(lines, "turn/completed");
    expect(done).toHaveLength(1);
    expect(done[0].params.turn.status).toBe("completed");
  });

  it("a FAILED result is reported failed, not completed", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-2"));
    await tick();
    e.pushResult(RESULT({ is_error: true, subtype: "error_during_execution" }));
    e.push(LIFECYCLE("completed", "foreign-2"));
    await tick();
    expect(notes(lines, "turn/completed")[0].params.turn.status).toBe("failed");
  });

  it("no result at all still settles the turn", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-3"));
    await tick();
    e.push(LIFECYCLE("cancelled", "foreign-3"));
    await tick();
    expect(notes(lines, "turn/completed")).toHaveLength(1);
  });

  // RACE 1. The chain is held, and the whole turn happens inside the hold.
  it("survives a held chain: a terminal that lands before the runner installs still settles", async () => {
    const e = pushEngine();
    const { lines, record } = await startAccepting(e.engine);
    let release!: () => void;
    record.chain = record.chain.then(() => new Promise<void>((r) => { release = r; }));
    e.push(LIFECYCLE("started", "foreign-4"));
    e.push(ASSISTANT("answered while the chain was held"));
    e.pushResult(RESULT());
    e.push(LIFECYCLE("completed", "foreign-4"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(0);   // nothing ran yet — the chain is held
    release();
    await tick();
    const done = notes(lines, "turn/completed");
    expect(done).toHaveLength(1);
    expect(done[0].params.turn.status).toBe("completed");
    expect(record.busy).toBe(false);                        // the thread is USABLE again — the wedge test
    expect(JSON.stringify(notes(lines, "item/completed"))).toContain("answered while the chain was held");
  });

  // RACE 2. Items never precede the turn edge that owns them.
  it("emits the arrival item after turn/started, never before", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push({ type: "user", message: { role: "user", content: `<cross-session-message from="uds:/a.sock" from-session="s" hop-chain="a" from-name="n" from-mode="prompting">ping</cross-session-message>` } });
    e.push(LIFECYCLE("started", "foreign-5"));
    await tick();
    const order = parsed(lines).map((m) => m.method).filter((m) => m === "turn/started" || String(m).startsWith("item/"));
    expect(order[0]).toBe("turn/started");
    // …and the arrival itself is one of that turn's items, not a message nobody ever sees.
    expect(JSON.stringify(notes(lines, "item/completed"))).toContain("ping");
  });

  // RACE 3. A swap replaces the engine; the replacement must be heard.
  it("re-observes the replacement engine after a swap, and stops observing the old one", async () => {
    const first = pushEngine();
    const second = pushEngine();
    let n = 0;
    const srv = new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: (() => (n++ === 0 ? first.engine : second.engine)) as never });
    const { lines, sink } = mkSink();
    const c = srv.connect(sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
    await tick();
    const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await tick();
    lines.length = 0;
    first.push(LIFECYCLE("started", "old-engine"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(0);   // the disposed engine is not listened to
    second.push(LIFECYCLE("started", "new-engine"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(1);   // the replacement is
  });

  it("a refusing thread adopts nothing", async () => {
    const e = pushEngine();
    const srv = boot(e.engine);
    const { lines, sink } = mkSink();
    const c = srv.connect(sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });     // default: refuse
    await tick();
    const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    lines.length = 0;
    e.push(LIFECYCLE("started", "foreign-6"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(0);
  });
});

describe("adoption teardown", () => {
  it("thread/close settles an adopted turn instead of abandoning it", async () => {
    const e = pushEngine();
    const { c, lines, threadId, record } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-7"));
    await tick();
    send(c, { id: 9, method: "thread/close", params: { threadId } });
    await tick();
    const done = notes(lines, "turn/completed");
    expect(done).toHaveLength(1);
    expect(done[0].params.turn.status).toBe("cancelled");
    // A thread/closed that goes out with a turn still open is a subscriber left holding a turn id that
    // never terminates — the edge must precede it.
    const methods = parsed(lines).map((m) => m.method);
    expect(methods.indexOf("turn/completed")).toBeLessThan(methods.indexOf("thread/closed"));
    expect(record.busy).toBe(false);
    expect(e.live()).toBe(0);                               // …and nothing is still listening to the disposed engine
  });

  it("turn/interrupt on an adopted turn reports interrupted", async () => {
    const e = pushEngine();
    const { c, lines, threadId } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-8"));
    await tick();
    send(c, { id: 9, method: "turn/interrupt", params: { threadId } });
    await tick();
    // The engine's own terminal is what actually ends the CLI's turn; the interrupt spine only asks.
    e.push(LIFECYCLE("cancelled", "foreign-8"));
    await tick();
    expect(parsed(lines).find((m) => m.id === 9)!.error).toBeUndefined();
    expect(notes(lines, "turn/completed")[0].params.turn.status).toBe("interrupted");
  });

  it("a stale-epoch lifecycle frame settles the thread rather than wedging it", async () => {
    const e = pushEngine();
    const { lines, record } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-9"));
    await tick();
    record.epoch += 1;                        // as an engine swap would
    e.push(LIFECYCLE("completed", "foreign-9"));
    await tick();
    // The old assertion — "no completion was broadcast" — passes while the thread is permanently busy.
    // What has to be true is that the thread is USABLE.
    expect(record.busy).toBe(false);
    expect(record.peerInbound?.adopted).toBeUndefined();
    e.push(LIFECYCLE("started", "foreign-10"));
    await tick();
    expect(notes(lines, "turn/started").length).toBeGreaterThanOrEqual(2);
  });
});

describe("bounded state", () => {
  it("holds a bounded number of arrivals and drops the oldest", async () => {
    const e = pushEngine();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { record } = await startAccepting(e.engine);
    for (let i = 0; i < 200; i++) e.push({ type: "user", message: { role: "user", content: `<cross-session-message from="uds:/a.sock" from-session="s" hop-chain="a" from-name="n" from-mode="prompting">m${i}</cross-session-message>` } });
    await tick();
    expect(record.peerInbound!.arrivals.length).toBeLessThanOrEqual(32);
    warn.mockRestore();
  });

  it("does not accumulate our own turn uuids across turns", async () => {
    const e = pushEngine();
    const { record } = await startAccepting(e.engine);
    for (let i = 0; i < 50; i++) {
      const u = `own-${i}`;
      (record.peerInbound!.ourUuids as Set<string>).add(u);
      e.push(LIFECYCLE("started", u));
      e.push(LIFECYCLE("completed", u));
    }
    await tick();
    // Every own turn that reached a terminal has been forgotten. A set that only grows is a leak with no
    // signal, and a long-lived thread is exactly where it would not be noticed.
    expect((record.peerInbound!.ourUuids as Set<string>).size).toBe(0);
  });
});
