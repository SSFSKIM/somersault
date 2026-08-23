// test/unit/appserver/turn-input-latch.test.ts — THE POST-RESOLUTION LATCH RE-CHECK (spec 2026-08-23
// rev 3, "Admission and the queue"; plan-review finding 2).
//
// `resolveInputItems` is an await that did not exist before this milestone, and it sits between the
// checks that admitted the turn and the engine call those checks were guarding. The M6 lesson names the
// failure exactly: an added await turns every check before it stale. So both origins re-check the SAME
// two latches on the far side of it — `closing` (a thread/close landed) and `interruptRequested` (a
// turn/interrupt landed) — and neither may reach an engine once either is up.
//
// The window is opened by MOCKING THIS REPO'S OWN RESOLVER, not by finding a slow file: the real
// resolver still does the real work, it is merely held. A real slow read (twenty 500 KB files, say)
// races the test's own interrupt frame, and the direction it races in is a false green — the interrupt
// arriving after resolution finished proves nothing at all. The mock defaults to pass-through, so a row
// that does not call `gate.hold()` sees the unmodified module.
//
// Each origin's refusals are paired with the path they refuse (review importants I-1/I-2): the fleet arm's
// UNHELD items turn, which is the only row in the suite that reaches `dispatch(resolved)` at all, and the
// inProcess terminal a stopped runner names — visible only while the closing record is still registered.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { UserTurnInput } from "../../../src/session/turnInput.js";

const gate = vi.hoisted(() => {
  let release: (() => void) | undefined;
  let pending: Promise<void> = Promise.resolve();
  return {
    /** Hold every resolution from here until `release()` — armed BEFORE the turn/start it is about. */
    hold(): void { pending = new Promise<void>((r) => { release = r; }); },
    release(): void { const r = release; release = undefined; pending = Promise.resolve(); r?.(); },
    wait(): Promise<void> { return pending; },
  };
});
vi.mock("../../../src/appserver/turnItems.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/appserver/turnItems.js")>();
  return {
    ...actual,
    resolveInputItems: async (items: Parameters<typeof actual.resolveInputItems>[0]) => {
      await gate.wait();
      return actual.resolveInputItems(items);
    },
  };
});

/** THE STAGING WINDOW (final review round 4) — the OTHER await an items turn opens, and the one that sits
 *  between the fleet arm's `dispatch` call and the prompt op itself. Held the same way and for the same
 *  reason as the resolver above, with one difference: the real `stageBlocks` runs first and its host round
 *  trip really happens — only the RETURN is parked, so a held row sits exactly where a real items turn sits
 *  with its bytes staged and its prompt not yet written. */
const stageGate = vi.hoisted(() => {
  let release: (() => void) | undefined;
  let pending: Promise<void> = Promise.resolve();
  return {
    hold(): void { pending = new Promise<void>((r) => { release = r; }); },
    release(): void { const r = release; release = undefined; pending = Promise.resolve(); r?.(); },
    wait(): Promise<void> { return pending; },
  };
});
vi.mock("../../../src/client/stagedSubmit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/client/stagedSubmit.js")>();
  return {
    ...actual,
    stageBlocks: async (...args: Parameters<typeof actual.stageBlocks>) => {
      const staged = await actual.stageBlocks(...args);
      await stageGate.wait();
      return staged;
    },
  };
});

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

/** A 24-byte PNG header — the cheapest buffer that sniffs as a real image. The rows below are about the
 *  latch, not the bytes, so one image is enough to make the input an ARRAY. */
const PNG = (() => {
  const buf = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(4, 16);
  buf.writeUInt32BE(4, 20);
  return buf;
})();
const ITEMS = [{ type: "text", text: "look" }, { type: "image", url: `data:image/png;base64,${PNG.toString("base64")}` }];

describe("post-resolution latch re-check — inProcess", () => {
  const submits: UserTurnInput[] = [];
  beforeEach(() => { submits.length = 0; });
  const factory = () => ({
    submit: async (prompt: UserTurnInput) => { submits.push(prompt); return { result: {} }; },
    interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
  });

  async function bootThread(sessionFactory: () => unknown = factory) {
    const srv = new AppServer({}, { sessionFactory } as never);
    const s = mkSink(); const c = srv.connect(s.sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = frame(s.lines, 2).result.thread.id as string;
    send(c, { id: 99, method: "thread/subscribe", params: { threadId } });
    await tick();
    s.lines.length = 0;
    return { srv, s, c, threadId };
  }

  it("a turn/interrupt landing DURING resolution stops the turn before the engine ever sees it", async () => {
    const { s, c, threadId } = await bootThread();
    gate.hold();
    send(c, { id: 3, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();                                                  // the chain callback ran; resolution is parked
    expect(frame(s.lines, 3).result.turn.status).toBe("inProgress");
    send(c, { id: 4, method: "turn/interrupt", params: { threadId } });
    gate.release();
    await settle();
    expect(submits).toEqual([]);                                   // the whole point: no engine call at all
    const completed = parsed(s.lines).filter((f) => f.method === "turn/completed");
    expect(completed.map((f) => f.params.turn.status)).toEqual(["interrupted"]);
  });

  it("a thread/close landing DURING resolution stops the turn — no submit against an engine the close is disposing, and no crash", async () => {
    const { srv, s, c, threadId } = await bootThread();
    gate.hold();
    send(c, { id: 3, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();
    send(c, { id: 5, method: "thread/close", params: { threadId } });
    gate.release();
    await settle();
    expect(submits).toEqual([]);
    expect(frame(s.lines, 5).result).toEqual({ ok: true });         // the close completed, un-wedged
    expect(srv.registry.get(threadId)).toBeUndefined();
  });

  // THE CHAIN SLOT (final review round 2). `turn/start` takes an ordered slot on `record.chain` so its
  // prompt reaches the engine behind anything the client sent first — but the slot released as soon as the
  // RUNNER WAS INVOKED, which is the same instant as the engine call only for a string. An items turn
  // resolves first, and an op the client sent AFTER the turn ran inside that window: `setModel` reached
  // the engine before the prompt it was meant to configure. Both orderings answer {ok:true} to both
  // requests, so ORDER AT THE ENGINE is the only place the difference is visible — and the resolution is
  // held rather than merely slow, because a real resolution that happens to finish first is a false green.
  it("holds the chain across the item resolution: a thread/model/set sent BEHIND an items turn reaches the engine behind its prompt", async () => {
    const calls: string[] = [];
    const { s, c, threadId } = await bootThread(() => ({
      submit: async (prompt: UserTurnInput) => { calls.push("submit"); submits.push(prompt); return { result: {} }; },
      setModel: async () => { calls.push("setModel"); },
      interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-4",
    }));
    gate.hold();
    send(c, { id: 3, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();                                                  // the chain callback ran; resolution is parked
    send(c, { id: 4, method: "thread/model/set", params: { threadId, model: "opus" } });
    await settle();
    // The setter is genuinely PARKED behind the turn's preparation — not merely later in the log.
    expect(calls).toEqual([]);
    gate.release();
    await settle();
    expect(calls).toEqual(["submit", "setModel"]);
    expect(frame(s.lines, 4).result).toEqual({ ok: true });        // …and holding the slot did not cost the setter its reply
  });

  // THE STATUS ITSELF, which the row above cannot see (review important I-2). There the close's dispose
  // finishes first, so closeRecord has already dropped the record by the time the parked resolution
  // resumes — and `broadcast` no-ops for a record that has left the registry, swallowing the very
  // turn/completed the runner's `stopped` key exists to name. Deleting that key therefore left every row
  // in this file green while the wire told a closing client its withdrawn turn had "completed".
  // So the record is held ALIVE across the resolution's resume by parking `dispose()`: the close is
  // latched (`closing` is set synchronously at arrival) and still inside closeRecord — exactly the window
  // in which the runner's own terminal is the only thing that reaches a subscriber.
  it("a turn stopped by a close that is STILL disposing reports cancelled — the runner's own terminal, not a completion", async () => {
    let releaseDispose!: () => void;
    const disposed = new Promise<void>((r) => { releaseDispose = r; });
    const { srv, s, c, threadId } = await bootThread(() => ({
      submit: async (prompt: UserTurnInput) => { submits.push(prompt); return { result: {} }; },
      interrupt: async () => ({}), dispose: () => disposed, onFrame: () => () => {}, sessionId: "sess-2",
    }));
    gate.hold();
    send(c, { id: 3, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();                                                  // the chain callback ran; resolution is parked
    send(c, { id: 5, method: "thread/close", params: { threadId } });
    await settle();                                                // …and the close is now parked INSIDE dispose()
    expect(srv.registry.get(threadId)).toBeDefined();              // the record the broadcast below needs
    gate.release();
    await settle();
    expect(submits).toEqual([]);
    const completed = parsed(s.lines).filter((f) => f.method === "turn/completed");
    // "cancelled" — the value the `stopped` key carries, and the same terminal the close flush reports for
    // the queued turns this one was drained ahead of. Not "completed" (no engine ran), not "interrupted".
    expect(completed.map((f) => f.params.turn.status)).toEqual(["cancelled"]);
    releaseDispose();
    await settle();
    expect(frame(s.lines, 5).result).toEqual({ ok: true });
    expect(srv.registry.get(threadId)).toBeUndefined();
  });
});

describe("post-resolution latch re-check — fleet", () => {
  const hosts: FakeHostControls[] = [];
  const servers: AppServer[] = [];
  let root = "";
  const savedRoot = process.env.CCX_FLEET_ROOT;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-latch-")); process.env.CCX_FLEET_ROOT = root; });
  afterEach(async () => {
    stageGate.release();   // a row that failed while parked must not wedge the shutdown below, or the next row
    for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
    for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
    if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
    rmSync(root, { recursive: true, force: true });
  });

  async function bootAttached() {
    const fh = await startFakeHost();
    hosts.push(fh);
    writeRoster(fh.row);
    const srv = new AppServer({}, {} as never);
    servers.push(srv);
    const s = mkSink();
    const conn = srv.connect(s.sink);
    send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
    send(conn, { id: 2, method: "thread/attach", params: { target: fh.row.short } });
    await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
    const threadId = frame(s.lines, 2).result.thread.id as string;
    send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(s.lines, 3)).toBeTruthy());
    s.lines.length = 0;
    return { fh, conn, lines: s.lines, threadId };
  }

  it("a turn/interrupt landing DURING resolution refuses the start and never puts a prompt on the host wire", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    gate.hold();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();
    send(conn, { id: 11, method: "turn/interrupt", params: { threadId } });
    gate.release();
    await settle();
    // NOTHING reached the host — not the prompt, and not the `stageImage` that precedes it. Asserting on
    // the prompt alone would pass with this guard deleted, because the engine's own `opts.aborted` check
    // (one await later, on the far side of staging) would still catch it and answer identically: the two
    // guards are only distinguishable by whether the host was touched at all.
    expect(fh.ops.filter((op) => op === "prompt" || op === "stageImage")).toEqual([]);
    // The same -33001 the pre-resolution guard one line above it already answers: a fleet turn has no id
    // until the host's seq arrives, so a refusal is the only honest terminal it can report.
    expect(frame(lines, 10).error).toEqual({ code: ERR.BUSY, message: "Turn interrupted before it started" });
  });

  // A FOREIGN TURN'S WHOLE LIFECYCLE, run inside the window the row above opens (whole-branch review P1).
  // A fleet thread's turn edges belong to the HOST, and every client of that host produces them: the event
  // layer's turn-start clears `record.interruptRequested` for a turn that is not ours at all. While the
  // cancellation of a pending turn rode that record-wide flag, a stranger starting and ending a turn in
  // this window erased it, `refusal()` then read a clean record, and the prompt this client had explicitly
  // stopped went out to the host anyway. The turn's OWN latch is what survives the stranger.
  it("a foreign turn's start+end inside the resolution window does NOT revive an interrupted pending turn", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    gate.hold();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();
    send(conn, { id: 11, method: "turn/interrupt", params: { threadId } });
    await settle();
    // …and NOW the ccx terminal owner (or any other client of this host) runs a turn of their own, start
    // to finish, while ours is still parked in resolution.
    fh.beginTurn(7);
    fh.endTurn(7, { result: "someone else's turn" });
    await settle();
    gate.release();
    await settle();
    expect(fh.ops.filter((op) => op === "prompt" || op === "stageImage")).toEqual([]);
    expect(frame(lines, 10).error).toEqual({ code: ERR.BUSY, message: "Turn interrupted before it started" });
  });

  it("a thread/close landing DURING resolution refuses the start and never puts a prompt on the host wire", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    gate.hold();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();
    send(conn, { id: 12, method: "thread/close", params: { threadId } });
    gate.release();
    await settle();
    // NOTHING reached the host — not the prompt, and not the `stageImage` that precedes it. Asserting on
    // the prompt alone would pass with this guard deleted, because the engine's own `opts.aborted` check
    // (one await later, on the far side of staging) would still catch it and answer identically: the two
    // guards are only distinguishable by whether the host was touched at all.
    expect(fh.ops.filter((op) => op === "prompt" || op === "stageImage")).toEqual([]);
    expect(frame(lines, 10).error).toEqual({ code: ERR.BUSY, message: "Thread is busy (closing)" });
    expect(frame(lines, 12).result).toEqual({ ok: true });
  });

  // THE HAPPY PATH the two rows above are refusals OF (review important I-1). Both of them leave through a
  // latch, so nothing here ever drove `dispatch(resolved)` — the fleet arm's whole items path (resolve,
  // stage the bytes onto the host's disk, claim them by path on the prompt op, echo the placeholder) could
  // have been deleted and every row stayed green. This one runs it end to end, unheld.
  // THE FLEET HALF OF THE CHAIN SLOT (final review round 2). Here the window is not the resolution — the
  // fleet arm already returned that promise into the chain — but the STAGING round trip that follows it:
  // the chain item ended when `dispatch` was called, and the image's `stageImage` op plus the client-local
  // write stand between that call and the prompt op. So a `thread/model/set` sent behind the turn reached
  // the HOST first. Nothing is held artificially here: one host round trip is already longer than the
  // microtask the setter needs, which is exactly why the defect was reachable without a race to win.
  it("holds the chain across STAGING: a thread/model/set sent behind an items turn reaches the host behind the prompt", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    send(conn, { id: 11, method: "thread/model/set", params: { threadId, model: "opus" } });
    await waitFor(() => expect(frame(lines, 11)).toBeTruthy());
    expect(frame(lines, 10).result.turn.status).toBe("inProgress");
    expect(frame(lines, 11).result).toEqual({ ok: true });
    expect(fh.ops.filter((op) => op === "stageImage" || op === "prompt" || op === "set_model"))
      .toEqual(["stageImage", "prompt", "set_model"]);
  });

  it("an items turn stages the image THEN prompts, claims it by path, and echoes it as [Image #1]", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    await waitFor(() => expect(frame(lines, 10)).toBeTruthy());
    expect(frame(lines, 10).result.turn).toEqual({ id: "t1@e0", status: "inProgress" });
    // ORDER, not mere presence: the bytes are on the host's disk BEFORE the prompt that claims them by
    // path — a prompt that led would name a file the host has not minted yet.
    expect(fh.ops.filter((op) => op === "stageImage" || op === "prompt")).toEqual(["stageImage", "prompt"]);
    // The image travels as a CLAIM, never inline: the canonical fold is the whole prompt text, and the
    // image is one staged path plus the digest the host verifies those bytes against.
    expect(fh.promptCalls[0].text).toBe("look");
    expect(fh.promptCalls[0].images).toEqual([{ stagedId: `${fh.socketPath}.fake-staged`, sha256: createHash("sha256").update(PNG).digest("hex") }]);
    // …and the echo describes what the model was handed — the placeholder, not the base64 that carried it.
    await waitFor(() => expect(parsed(lines).some((f) => f.method === "item/completed" && f.params?.item?.type === "userMessage")).toBe(true));
    const user = parsed(lines).find((f) => f.method === "item/completed" && f.params?.item?.type === "userMessage");
    expect(user.params.item.text).toBe("look[Image #1]");
  });

  // THE START-ACK'S ARMING POINT (final review round 4). `record.fleetStartAck` is the promise the event
  // layer holds an OWN turn's frames on until its inProgress reply is out (F2/R4/SR2) — and it must bracket
  // THAT window and nothing more. Armed when `dispatch` was called it also spanned the items path's whole
  // staging sequence, one host round trip per image, and fleet.ts defers whatever arrives while it is armed:
  // a FOREIGN turn running in that window had its items and its turn/completed parked behind OUR ack and
  // reached the client after our reply — another client's finished turn reordered behind our starting one.
  // The engine now arms it in the tick it writes the prompt op, so nothing of ours can precede it and
  // nothing of theirs is held by it. The window is HELD rather than merely slow for the reason the resolver
  // gate is: a real round trip that happens to outlast the foreign turn is a false green.
  it("a foreign turn's whole lifecycle stays LIVE while our items turn is still staging — it is not parked behind our start-ack", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    stageGate.hold();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    // Staged for real — the op reached the host — and parked on the far side of it: no prompt has been written.
    await waitFor(() => expect(fh.ops).toContain("stageImage"));
    expect(fh.ops.filter((op) => op === "prompt")).toEqual([]);

    // …and NOW the terminal owner (or any other client of this host) runs a turn of their own, start to
    // finish, inside that window.
    fh.beginTurn(7);
    fh.emitMessage({ type: "assistant", message: { id: "m9", content: [{ type: "text", text: "stranger" }] } });
    fh.endTurn(7, { result: "someone else's turn" });
    await waitFor(() => expect(parsed(lines).some((f) => f.method === "turn/completed" && f.params?.turn?.id === "t7@e0")).toBe(true));

    // ALL THREE of their frames are on the wire in order, and OUR reply is not out yet — which is the whole
    // claim: their completed turn precedes our inProgress, exactly as it happened.
    expect(frame(lines, 10)).toBeUndefined();
    const staging = parsed(lines);
    const iTheirStart = staging.findIndex((f) => f.method === "turn/started" && f.params?.turn?.id === "t7@e0");
    const iTheirItem = staging.findIndex((f) => f.method === "item/started" && f.params?.item?.type === "agentMessage");
    const iTheirEnd = staging.findIndex((f) => f.method === "turn/completed" && f.params?.turn?.id === "t7@e0");
    expect(iTheirStart).toBeGreaterThanOrEqual(0);
    expect(iTheirItem).toBeGreaterThan(iTheirStart);
    expect(iTheirEnd).toBeGreaterThan(iTheirItem);

    // Released, our prompt goes out and our own turn opens BEHIND theirs — the seq the host hands us is the
    // one after the turn it just finished.
    stageGate.release();
    await waitFor(() => expect(frame(lines, 10)).toBeTruthy());
    expect(frame(lines, 10).result.turn).toEqual({ id: "t8@e0", status: "inProgress" });
    const after = parsed(lines);
    const iOurReply = after.findIndex((f) => f.id === 10 && f.result);
    const iOurStart = after.findIndex((f) => f.method === "turn/started" && f.params?.turn?.id === "t8@e0");
    const iTheirEndAfter = after.findIndex((f) => f.method === "turn/completed" && f.params?.turn?.id === "t7@e0");
    expect(iOurReply).toBeGreaterThan(iTheirEndAfter);
    expect(iOurStart).toBeGreaterThan(iTheirEndAfter);
    expect(fh.ops.filter((op) => op === "stageImage" || op === "prompt")).toEqual(["stageImage", "prompt"]);
  });
});
