import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { readRoster } from "../../src/fleet/roster.js";

const rewindUser = (text: string, uuid: string) => ({ type: "user", uuid, message: { role: "user", content: text } });
const rewindAssistant = (uuid: string) => ({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-int-")); fleets.push(d); return d; };
afterEach(() => { for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A session we drive by hand: `emit` pushes a message into the live turn, `finish` ends it, and
 *  `askPermission` fires the broker exactly as the SDK would. */
function drivable() {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId: "sid-int",
    submit(_p: string, onMessage: (m: unknown) => void) {
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = () => r(undefined); });
    },
    dispose: async () => {},
    interrupt: async () => {},
    emit: (m: unknown) => emit(m),
    finish: () => finish(),
  };
}

async function startHost(kind: "bg" | "interactive" = "bg", detached: boolean = kind === "bg") {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const session = drivable();
  const host = new SessionHost(
    { short: "dddddddd", name: "int", cwd: process.cwd(), kind, detached, config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" });
  await host.start();
  return { host, session, env, path: hostSocketPath(process.pid, env) };
}

// `host.stop()` is called from every test's cleanup, including on a test that already stopped the host
// itself (test 4, over the socket) — HostServer.close() is idempotent and PendingPermissions.denyAll()
// is a no-op on an empty map, so a second stop is safe. It is wrapped in `.catch` regardless: a cleanup
// failure must never mask the real assertion failure that triggered the `finally`.
const stopQuietly = (host: SessionHost) => host.stop().catch(() => {});

describe("host + client over a real socket", () => {
  it("a client follows a live turn it joined late, from the turn's start", async () => {
    const { host, session, path } = await startHost();
    let turn: Promise<void> | undefined;
    let c: RemoteChatSession | undefined;
    try {
      turn = host.runTask("go");
      session.emit({ type: "assistant", n: 1 });
      session.emit({ type: "assistant", n: 2 });
      c = await RemoteChatSession.connect(path);
      const seen: any[] = [];
      c.follow((e) => seen.push(e));
      await new Promise((r) => setTimeout(r, 100));
      expect(seen.filter((e) => e.kind === "message").map((e) => e.data.n)).toEqual([1, 2]);
      session.emit({ type: "assistant", n: 3 });
      await new Promise((r) => setTimeout(r, 50));
      expect(seen.filter((e) => e.kind === "message").map((e) => e.data.n)).toEqual([1, 2, 3]);
    } finally {
      // Unconditional, in this order: detach first (nothing left to deliver to), then resolve the fake
      // session's `submit()` — the one promise nothing else here ever settles — THEN await it so it
      // can't outlive the test as a dangling handle, and only then stop the host.
      c?.detach();
      session.finish();
      await turn?.catch(() => {});
      await stopQuietly(host);
    }
  });

  it("two clients see the same park; the first answer wins and the second is told who answered", async () => {
    const { host, path } = await startHost();
    let a: RemoteChatSession | undefined, b: RemoteChatSession | undefined;
    try {
      a = await RemoteChatSession.connect(path, { label: "tty-a" });
      b = await RemoteChatSession.connect(path, { label: "tty-b" });
      const seenA: any[] = [], seenB: any[] = [];
      a.follow((e) => seenA.push(e)); b.follow((e) => seenB.push(e));
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t9", signal: new AbortController().signal });
      await new Promise((r) => setTimeout(r, 80));
      // EXACT counts, not `.some`. One park must produce one decision event per client; a fan-out that
      // broadcasts once per registered follower delivers it N times to each of N clients, and `.some`
      // passes cheerfully on 2, 4 or 16 copies.
      expect(seenA.filter((e) => e.kind === "decision")).toHaveLength(1);
      expect(seenB.filter((e) => e.kind === "decision")).toHaveLength(1);
      expect((await a.status()).state).toBe("blocked");
      const first = await a.answer("t9", { kind: "allow_once" });
      expect(first.alreadyAnsweredBy).toBeUndefined();
      const second = await b.answer("t9", { kind: "deny" });
      expect(second.ok).toBe(true);
      expect(second.alreadyAnsweredBy).toBe("tty-a");
      await expect(decision).resolves.toEqual({ kind: "allow_once" });   // the FIRST answer, not the last
    } finally {
      // If an assertion above throws, `decision` is still parked — stopQuietly's denyAll() settles it,
      // same as it does for every other park in this file. detach() is safe on an unconnected/undefined ref.
      a?.detach(); b?.detach();
      await stopQuietly(host);
    }
  });

  it("detach leaves the host and its park untouched; a re-attached client still sees the park", async () => {
    const { host, path } = await startHost();
    let a: RemoteChatSession | undefined, b: RemoteChatSession | undefined;
    try {
      a = await RemoteChatSession.connect(path);
      a.follow(() => {});
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t10", signal: new AbortController().signal });
      await new Promise((r) => setTimeout(r, 50));
      a.detach();
      await new Promise((r) => setTimeout(r, 50));
      b = await RemoteChatSession.connect(path);
      expect((await b.pending()).pending.map((p: any) => p.toolUseID)).toEqual(["t10"]);
      expect((await b.status()).state).toBe("blocked");
      await b.answer("t10", { kind: "deny" });
      await expect(decision).resolves.toEqual({ kind: "deny" });
    } finally {
      a?.detach(); b?.detach();   // a's detach() above is idempotent; a second call here is a no-op
      await stopQuietly(host);
    }
  });

  it("stop over the socket records a terminal roster state and settles the park", async () => {
    const { host, env, path } = await startHost();
    let c: RemoteChatSession | undefined;
    try {
      c = await RemoteChatSession.connect(path);
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t11", signal: new AbortController().signal });
      await c.stopHost().catch(() => {});          // the host closes the socket as it stops
      await expect(decision).resolves.toEqual({ kind: "deny" });
      expect(readRoster("dddddddd", env)?.state).toBe("stopped");
    } finally {
      // The host already stopped itself over the socket on the happy path; stopQuietly is still called
      // (idempotent) to cover the case where an earlier expect() threw before stopHost() ran.
      c?.detach();
      await stopQuietly(host);
    }
  });

  // The whole-branch review's Critical finding, reproduced exactly as demonstrated live: turn one in
  // flight, a Bash permission parked mid-turn, then a `prompt` op arrives over the socket. The old gate
  // asked status().status — which reports "idle" for the ENTIRE duration of a park — so it let the
  // second prompt through, re-entered runTask, and turnBuffer.reset() wiped the in-flight turn. Proof
  // that the turn survived: a client attaching AFTER the refused prompt is still replayed message n:1,
  // not zero.
  it("a prompt arriving while a permission is parked is refused, and the in-flight turn survives it", async () => {
    const { host, session, path } = await startHost();
    let c: RemoteChatSession | undefined;
    try {
      const turn = host.runTask("go");
      session.emit({ type: "assistant", n: 1 });
      const decision = host.broker().request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "t20", signal: new AbortController().signal });
      await new Promise((r) => setTimeout(r, 50));            // let the park actually land
      c = await RemoteChatSession.connect(path);
      expect((await c.status()).state).toBe("blocked");       // exactly the state the finding is about
      const reply = await c.prompt("should NOT be accepted while parked");
      expect(reply.ok).toBe(false);                           // the busy gate must hold here
      // A client attaching NOW must still be replayed the turn that never stopped.
      const late: any[] = [];
      const off = c.follow((e) => late.push(e));
      await new Promise((r) => setTimeout(r, 50));
      expect(late.filter((e) => e.kind === "message").map((e: any) => e.data.n)).toEqual([1]);
      off();
      host.answer("t20", { kind: "deny" }, "test");
      await decision;
      session.finish();
      void turn.catch(() => {});
    } finally {
      c?.detach();
      await stopQuietly(host);
    }
  });

  // Goal B acceptance ⑤ evidence (keyless): a question park settles via the STRUCTURED `answer` op over
  // the real UDS wire (not the flat legacy `decision` field), and the settle broadcasts to every
  // connected client — proven only at this layer, where "broadcast" means an actual second socket, not
  // an in-process observer.
  it("a question parks, settles via a structured answer over the wire, and a second connected client sees it settle", async () => {
    const { host, path } = await startHost();
    let a: RemoteChatSession | undefined, b: RemoteChatSession | undefined;
    try {
      a = await RemoteChatSession.connect(path, { label: "tty-a" });
      b = await RemoteChatSession.connect(path, { label: "tty-b" });
      const seenA: any[] = [], seenB: any[] = [];
      a.follow((e) => seenA.push(e)); b.follow((e) => seenB.push(e));
      const decision = host.broker().request({
        toolName: "AskUserQuestion", input: { question: "red or blue?" }, toolUseID: "q9", kind: "question",
        signal: new AbortController().signal,
      });
      await new Promise((r) => setTimeout(r, 80));
      const parked = seenB.find((e) => e.kind === "decision");
      expect(parked?.entry).toMatchObject({ kind: "question", toolUseID: "q9", input: { question: "red or blue?" } });
      const reply = await a.answerDecision("q9", { kind: "question_answer", answers: { "red or blue?": "blue" } });
      expect(reply.ok).toBe(true);
      await expect(decision).resolves.toEqual({ kind: "question_answer", answers: { "red or blue?": "blue" } });
      // The point of this test: the settle must reach a SECOND connected client over the real socket,
      // not merely be visible to whoever answered it.
      await new Promise((r) => setTimeout(r, 80));
      expect(seenB).toContainEqual({ t: "event", kind: "decision_settled", toolUseID: "q9", by: "tty-a", decision: "question_answer" });
    } finally {
      a?.detach(); b?.detach();
      await stopQuietly(host);
    }
  });

  it("an interactive host with no client attached denies rather than parking", async () => {
    const { host } = await startHost("interactive");
    try {
      await expect(host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t12", signal: new AbortController().signal }))
        .resolves.toEqual({ kind: "deny" });
    } finally {
      await stopQuietly(host);
    }
  });

  // C5 T3: the rewind ops travel client -> server -> HostHandlers -> SessionHost over the real socket.
  // rewind(both) makes THREE underlying engine calls: the client's own rewindDryRun, the host's OWN
  // dry-run guard inside rewind() (see SessionHost.rewind's doc), then the real file rewind — that is
  // correct per Task 2/3's contract, not a double-call bug.
  it("rewind ops round-trip: anchors → dryRun → rewind(both) reaches the host in order", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const fakeRewind = vi.fn(async (u: string, o?: { dryRun?: boolean }) =>
      o?.dryRun ? { canRewind: true, filesChanged: [], insertions: 0, deletions: 0 } : {});
    const session = { sessionId: "sid-r", submit: vi.fn(async () => ({})), dispose: vi.fn(async () => {}), rewind: fakeRewind };
    const getMessages = async () => [rewindUser("A", "uA"), rewindAssistant("aA"), rewindUser("B", "uB")];
    const host = new SessionHost(
      { short: "eeeeeeee", name: "rw", cwd: process.cwd(), kind: "bg", detached: true, config: {} as never, env },
      { openSession: () => session, procStartOf: async () => "start", getMessages });
    await host.start();
    const path = hostSocketPath(process.pid, env);
    const chat = remoteChatSession(path);
    try {
      await chat.whenReady();
      const anchors = await chat.rewindAnchors();
      expect(anchors[0]).toMatchObject({ uuid: "uB", prevUuid: "aA" });
      const dry = await chat.rewindDryRun(anchors[0].uuid);
      expect(dry.canRewind).toBe(true);
      await chat.rewind(anchors[0], "both");
      // the fake's rewind saw dry + real for uB (the host's own guard dry counts too: 3 calls total)
      expect(fakeRewind.mock.calls.map((c) => `${c[0]}:${c[1]?.dryRun ? "dry" : "real"}`)).toEqual(["uB:dry", "uB:dry", "uB:real"]);
    } finally {
      chat.detach();
      await stopQuietly(host);
    }
  });
});
