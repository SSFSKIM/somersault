// harness/test/integration/attach.test.ts — the ccx attach story over a REAL socket (host + client, no
// CLI/process boundary): real SessionHost + HostServer + remoteChatSession, a fake HostSession we drive
// by hand. Fixture pattern copied from host-client.test.ts / client-chat-adapter.test.ts (not cross-imported).
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { SessionHostOpts, HostSession } from "../../src/host/host.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { readRoster } from "../../src/fleet/roster.js";

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-attach-")); fleets.push(d); return d; };
afterEach(() => { for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A session we drive by hand: `emit` pushes a message into the live turn, `finish` ends it. Multiple
 *  sequential turns are supported — each `submit()` call rebinds `emit`/`finish` to that turn (Task 8
 *  case 4 needs a second turn on the same host). */
function drivable(sessionId = "sid-attach") {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId,
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

async function startHost(short: string, opts: Partial<SessionHostOpts> = {}, session: HostSession = drivable() as unknown as HostSession) {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const host = new SessionHost(
    { short, name: "attach-int", cwd: process.cwd(), kind: "interactive", detached: true, config: {} as never, env, ...opts },
    { openSession: () => session, procStartOf: async () => "start" });
  await host.start();
  return { host, session: session as ReturnType<typeof drivable>, env, path: hostSocketPath(process.pid, env) };
}

const stopQuietly = (host: SessionHost) => host.stop().catch(() => {});
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ccx attach — host + adapter over a real socket (Task 8)", () => {
  it("1. late-join replay: turn start FIRST, then buffered messages, then the parked permission, then blocked state; pendingNow() has the entry", async () => {
    const { host, session, path } = await startHost("a0000001");
    let turn: Promise<void> | undefined;
    const adapter = remoteChatSession(path);
    try {
      turn = host.runTask("go");
      session.emit({ type: "assistant", n: 1 });
      session.emit({ type: "assistant", n: 2 });
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tA", signal: new AbortController().signal });
      await vi.waitFor(() => expect(host.pending()).toHaveLength(1));
      await adapter.whenReady();
      const frames: any[] = [];
      adapter.onSessionEvent((ev) => frames.push(ev));    // first subscriber is flushed the whole replay, in order
      expect(frames.map((f) => f.kind)).toEqual(["turn", "message", "message", "permission", "state"]);
      expect(frames[0]).toMatchObject({ phase: "start" });
      expect(frames[1].data.n).toBe(1);
      expect(frames[2].data.n).toBe(2);
      expect(frames[3].entry.toolUseID).toBe("tA");
      expect(frames[4].status.state).toBe("blocked");
      expect(adapter.pendingNow().map((e) => e.toolUseID)).toEqual(["tA"]);
      host.answer("tA", { kind: "deny" }, "test");
      await decision;
      session.finish();
      await turn.catch(() => {});
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("1b. idle-attach has no start frame — the disk-then-follow no-dedup invariant", async () => {
    const { host, session, path } = await startHost("a0000002");
    const turn = host.runTask("go");
    session.emit({ type: "assistant", n: 1 });
    session.finish();
    await turn;                                           // the turn is now COMPLETE; buffer still holds it
    const adapter = remoteChatSession(path);
    try {
      await adapter.whenReady();
      const frames: any[] = [];
      adapter.onSessionEvent((ev) => frames.push(ev));
      // No start frame at all — a completed turn's content is already on disk, so replaying a start here
      // would be the exact duplicate the "no dedup layer" design relies on there being none of.
      expect(frames.some((f) => f.kind === "turn" && f.phase === "start")).toBe(false);
      expect(frames.filter((f) => f.kind === "message").map((f) => f.data.n)).toEqual([1]);
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("2. detach leaves everything: dispose() the adapter; the park is still pending on the host; a second adapter attaches and sees it again", async () => {
    const { host, session, path } = await startHost("a0000003");
    let turn: Promise<void> | undefined;
    let a: ReturnType<typeof remoteChatSession> | undefined, b: ReturnType<typeof remoteChatSession> | undefined;
    try {
      turn = host.runTask("go");
      a = remoteChatSession(path);
      await a.whenReady();
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tB", signal: new AbortController().signal });
      await vi.waitFor(() => expect(a!.pendingNow()).toHaveLength(1));
      await a.dispose();                                  // detach — must NOT touch the host's park
      b = remoteChatSession(path);
      await b.whenReady();
      expect(b.pendingNow().map((e) => e.toolUseID)).toEqual(["tB"]);
      host.answer("tB", { kind: "deny" }, "test");
      await decision;
      session.finish();
      await turn.catch(() => {});
    } finally {
      a?.detach(); b?.detach();
      await stopQuietly(host);
    }
  });

  it("3. answer resumes: the second adapter's answer settles the park and the turn's end reaches it", async () => {
    const { host, session, path } = await startHost("a0000004");
    let turn: Promise<void> | undefined;
    const adapter = remoteChatSession(path);
    try {
      turn = host.runTask("go");
      await adapter.whenReady();
      const events: any[] = [];
      adapter.onSessionEvent((ev) => events.push(ev));
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tC", signal: new AbortController().signal });
      await vi.waitFor(() => expect(adapter.pendingNow()).toHaveLength(1));
      const reply = await adapter.answerPermission("tC", { kind: "allow_once" });
      expect(reply.ok).toBe(true);
      await expect(decision).resolves.toEqual({ kind: "allow_once" });   // the fake tool call "proceeds"
      session.emit({ type: "assistant", n: 9 });
      session.finish();
      await turn;
      await vi.waitFor(() => expect(events.some((e) => e.kind === "turn" && e.phase === "end")).toBe(true));
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("4. multi-turn over the socket: a submit on the attached adapter after turn 1 ends is accepted and runs turn 2 with seq 2", async () => {
    const { host, session, path } = await startHost("a0000005");
    const adapter = remoteChatSession(path);
    try {
      await adapter.whenReady();
      const seenTurn1: unknown[] = [];
      const r1 = adapter.submit("first", (m) => seenTurn1.push(m));
      await delay(30);
      session.emit({ type: "assistant", n: 1 });
      session.emit({ type: "result", ok: true });
      session.finish();
      await r1;
      expect(host.turnSeq()).toBe(1);
      const seenTurn2: unknown[] = [];
      const r2 = adapter.submit("second", (m) => seenTurn2.push(m));   // multi-turn: NOT refused
      await delay(30);
      session.emit({ type: "assistant", n: 2 });
      session.finish();
      await r2;
      expect(host.turnSeq()).toBe(2);
      expect(seenTurn2).toEqual([{ type: "assistant", n: 2 }]);
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("5. idle reaper end-to-end: no client finalizes done; a connected client survives 3x the timeout; it reaps once detached", async () => {
    // A: nobody attached — the reaper must finalize the host on its own.
    const { host: hostA, env: envA } = await startHost("a0000006", { idleTimeoutMs: 100 });
    await hostA.finished;
    expect(readRoster("a0000006", envA)?.state).toBe("done");

    // B: one client stays attached across several idle-timeout windows — a live connection must defer
    // the reaper every time it checks, not merely once.
    const { host: hostB, env: envB, path: pathB } = await startHost("a0000007", { idleTimeoutMs: 100 });
    const adapter = remoteChatSession(pathB);
    await adapter.whenReady();
    let doneB = false;
    hostB.finished.then(() => { doneB = true; });
    try {
      await delay(350);                                   // 3x+ the idle timeout, still connected throughout
      expect(doneB).toBe(false);
      expect(readRoster("a0000007", envB)?.state).not.toBe("done");
      await adapter.dispose();                             // drop the connection — the reaper may now fire
      await hostB.finished;                                 // bounded by the suite's own test timeout if this regresses
      expect(readRoster("a0000007", envB)?.state).toBe("done");
    } finally {
      adapter.detach();
      await stopQuietly(hostB);
    }
  });
});
