import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostSession } from "../../src/host/host.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { hasBgTasks } from "../../src/session/chatSession.js";
import type { HostEvent } from "../../src/host/wire.js";
import type { PendingEntry } from "../../src/permissions/pending.js";

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-adapter-")); fleets.push(d); return d; };
afterEach(() => { for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true }); });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A session we drive by hand: `emit` pushes a message into the live turn, `finish` ends it. Multiple
 *  sequential turns are supported — each `submit()` call rebinds `emit`/`finish` to that turn. */
function drivable(sessionId = "sid-adapter") {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  let calls = 0;
  return {
    sessionId,
    submit(_p: string, onMessage: (m: unknown) => void) {
      calls++;
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = () => r(undefined); });
    },
    dispose: async () => {},
    interrupt: async () => {},
    emit: (m: unknown) => emit(m),
    finish: () => finish(),
    get calls() { return calls; },
  };
}

/** A session whose `submit` resolves WITHOUT ever awaiting anything internally — every message is
 *  emitted synchronously and the returned promise is already fulfilled by the time `runTask`'s `await`
 *  suspends on it. This is the shape that reproduces the fast-turn-end-before-waiter race (test 9). */
function syncSession(sessionId: string, messages: unknown[]) {
  return {
    sessionId,
    submit: async (_p: string, onMessage: (m: unknown) => void) => { for (const m of messages) onMessage(m); },
    dispose: async () => {},
  };
}

/** A session exposing `onFrame` (mirrors host-frames.test.ts's fakeSession) plus the bg-task control
 *  members, so `drive()` can push a `system/background_tasks_changed` frame the way Session's real
 *  read-loop does, and `backgroundAll`/`stopTask` are reachable through the host's `background`/`stopTask`
 *  handlers. */
function bgSession(sessionId = "sid-bg") {
  let frameCb: ((m: unknown) => void) | undefined;
  const backgroundCalls: (string | undefined)[] = [];
  const stopCalls: string[] = [];
  return {
    sessionId,
    submit: async (_p: string, on: (m: unknown) => void) => { on({ type: "assistant" }); return { result: {} }; },
    dispose: async () => {},
    onFrame: (cb: (m: unknown) => void) => { frameCb = cb; return () => { frameCb = undefined; }; },
    backgroundAll: async (toolUseId?: string) => { backgroundCalls.push(toolUseId); return true; },
    stopTask: async (taskId: string) => { stopCalls.push(taskId); },
    drive: (m: unknown) => frameCb?.(m),
    backgroundCalls, stopCalls,
  };
}

async function startHost(session: HostSession = drivable(), opts: { kind?: "bg" | "interactive"; detached?: boolean } = {}) {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const kind = opts.kind ?? "bg";
  const host = new SessionHost(
    { short: "ffffffff", name: "adapter", cwd: process.cwd(), kind, detached: opts.detached ?? true, config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" });
  await host.start();
  return { host, session, env, path: hostSocketPath(process.pid, env) };
}

const stopQuietly = (host: SessionHost) => host.stop().catch(() => {});

describe("remoteChatSession — lazy ChatSession adapter", () => {
  it("1. submit round trip: onMessage sees the turn's messages, resolves with the result message, host saw one prompt", async () => {
    const messages = [{ type: "assistant", n: 1 }, { type: "result", n: 2, ok: true }];
    const session = syncSession("sid-1", messages);
    const { host, path } = await startHost(session as unknown as HostSession);
    let calls = 0;
    const orig = session.submit;
    session.submit = async (p: string, onMessage: (m: unknown) => void) => { calls++; return orig(p, onMessage); };
    const adapter = remoteChatSession(path);
    try {
      const seen: unknown[] = [];
      const { result } = await adapter.submit("hi", (m) => seen.push(m));
      expect(seen).toEqual(messages);
      expect(result).toEqual(messages[1]);
      expect(calls).toBe(1);
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("2. busy refusal throws /busy/ when the host is already running a turn", async () => {
    const session = drivable();
    const { host, path } = await startHost(session as unknown as HostSession);
    let turn: Promise<void> | undefined;
    const adapter = remoteChatSession(path);
    try {
      turn = host.runTask("first");                      // busy the host directly, bypassing the adapter
      await adapter.whenReady();
      await expect(adapter.submit("second", () => {})).rejects.toThrow(/busy/);
    } finally {
      adapter.detach();
      session.finish();
      await turn?.catch(() => {});
      await stopQuietly(host);
    }
  });

  it("3. seq correlation: an earlier turn's end does not settle a later submit — only its OWN turn's end does", async () => {
    const session = drivable();
    const { host, path } = await startHost(session as unknown as HostSession);
    let turn1: Promise<void> | undefined;
    const adapter = remoteChatSession(path);
    const events: HostEvent[] = [];
    try {
      turn1 = host.runTask("first");                      // turn 1 starts OUTSIDE the adapter
      await adapter.whenReady();                           // adapter attaches mid-flight (replayed turn start)
      adapter.onSessionEvent((ev) => events.push(ev));
      session.finish();                                    // end turn 1 (seq 1) — the adapter has no waiter for it
      await vi.waitFor(() => expect(events.some((e) => e.kind === "turn" && e.phase === "end" && e.seq === 1)).toBe(true));
      await turn1.catch(() => {});

      const p2 = adapter.submit("second", () => {});        // turn 2 — a NEW waiter, keyed on seq 2
      let settled = false;
      p2.then(() => { settled = true; }, () => { settled = true; });
      await delay(80);
      expect(settled).toBe(false);                          // turn 1's stale end must not have resolved this

      session.finish();                                     // end turn 2 (seq 2) — THIS must resolve it
      await p2;
      expect(settled).toBe(true);
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("4. permission feed: park -> onPermission fires -> answer settles the park -> a second answer reports alreadyAnsweredBy -> onPermissionSettled fires once", async () => {
    const { host, path } = await startHost();
    const adapter = remoteChatSession(path);
    try {
      await adapter.whenReady();
      const seen: PendingEntry[] = [];
      adapter.onPermission((e) => seen.push(e));
      const settled: { toolUseID: string; by: string; decision: string }[] = [];
      adapter.onPermissionSettled((s) => settled.push(s));
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t9", signal: new AbortController().signal });
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0].toolUseID).toBe("t9");
      const first = await adapter.answerPermission("t9", { kind: "allow_once" });
      expect(first.ok).toBe(true);
      await expect(decision).resolves.toEqual({ kind: "allow_once" });
      const second = await adapter.answerPermission("t9", { kind: "deny" });
      expect(second.ok).toBe(true);
      expect(second.alreadyAnsweredBy).toBeTruthy();
      await vi.waitFor(() => expect(settled).toHaveLength(1));
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("5. replay-first: a permission parked BEFORE connect is in pendingNow(), and the first onSessionEvent subscriber is flushed permission+state in order", async () => {
    const { host, path } = await startHost();
    let decision: Promise<unknown> | undefined;
    const adapter = remoteChatSession(path);
    try {
      decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tY", signal: new AbortController().signal });
      await vi.waitFor(() => expect(host.pending()).toHaveLength(1));
      await adapter.whenReady();
      expect(adapter.pendingNow().map((e) => e.toolUseID)).toEqual(["tY"]);
      const frames: HostEvent[] = [];
      adapter.onSessionEvent((ev) => frames.push(ev));
      expect(frames.map((f) => f.kind)).toEqual(["decision", "state"]);
      expect((frames[0] as Extract<HostEvent, { kind: "decision" }>).entry.toolUseID).toBe("tY");
    } finally {
      adapter.detach();
      host.answer("tY", { kind: "deny" }, "test");
      await decision?.catch(() => {});
      await stopQuietly(host);
    }
  });

  it("6. sessionId getter reflects the host's session id after state traffic", async () => {
    const { host, path } = await startHost(drivable("sid-six") as unknown as HostSession);
    const adapter = remoteChatSession(path);
    try {
      await adapter.whenReady();
      expect(adapter.sessionId).toBe("sid-six");
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("7. dispose() detaches without stopping the host: it keeps running and a parked permission stays parked", async () => {
    const { host, path } = await startHost();
    const adapter = remoteChatSession(path);
    let c2: RemoteChatSession | undefined;
    let decision: Promise<unknown> | undefined;
    try {
      await adapter.whenReady();
      decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tZ", signal: new AbortController().signal });
      await vi.waitFor(() => expect(adapter.pendingNow()).toHaveLength(1));
      await adapter.dispose();
      c2 = await RemoteChatSession.connect(path);
      const st = await c2.status();
      expect(st.ok).toBe(true);
      expect(st.state).toBe("blocked");
      const pend = await c2.pending();
      expect(pend.pending.map((p) => p.toolUseID)).toEqual(["tZ"]);
    } finally {
      c2?.detach();
      host.answer("tZ", { kind: "deny" }, "test");
      await decision?.catch(() => {});
      await stopQuietly(host);
    }
  });

  it("8. resume opt sends resume before follow: the second session construction carries resume:'sid-9'", async () => {
    const configs: Record<string, unknown>[] = [];
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const session = drivable();
    const host = new SessionHost(
      { short: "aaaaaaab", name: "resume", cwd: process.cwd(), kind: "bg", detached: true, config: {} as never, env },
      { openSession: (c) => { configs.push(c as unknown as Record<string, unknown>); return session; }, procStartOf: async () => "start" });
    await host.start();
    const path = hostSocketPath(process.pid, env);
    const adapter = remoteChatSession(path, { resume: "sid-9" });
    try {
      await adapter.whenReady();
      expect(configs).toHaveLength(2);
      expect(configs[1]).toMatchObject({ resume: "sid-9" });
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("9. fast-turn end-before-waiter: a synchronously-resolving turn never leaves submit() hanging (20 iterations)", async () => {
    const messages = [{ type: "assistant", n: 1 }, { type: "result", ok: true }];
    const session = syncSession("sid-fast", messages);
    const { host, path } = await startHost(session as unknown as HostSession);
    const adapter = remoteChatSession(path);
    try {
      for (let i = 0; i < 20; i++) {
        const seen: unknown[] = [];
        const { result } = await adapter.submit(`go-${i}`, (m) => seen.push(m));
        expect(seen).toEqual(messages);
        expect(result).toEqual(messages[1]);
      }
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  }, 20_000);

  it("11. routes decision/decision_settled events into the feed", async () => {
    const { host, path } = await startHost();
    const adapter = remoteChatSession(path);
    try {
      await adapter.whenReady();
      const seen: PendingEntry[] = [];
      adapter.onDecision((e) => seen.push(e));
      const settled: { toolUseID: string; by: string; decision: string }[] = [];
      adapter.onDecisionSettled((s) => settled.push(s));
      const decision = host.broker().request({ toolName: "AskUserQuestion", input: {}, toolUseID: "q1", kind: "question", signal: new AbortController().signal });
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({ toolUseID: "q1", kind: "question" });
      expect(adapter.pendingNow().map((e) => e.toolUseID)).toEqual(["q1"]);
      host.answer("q1", { kind: "question_answer", answers: { a: "b" } }, "test");
      await decision.catch(() => {});
      await vi.waitFor(() => expect(settled).toHaveLength(1));
      expect(adapter.pendingNow()).toHaveLength(0);
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("12. READ ALIAS: legacy permission/permission_settled frames from an old host arrive as decisions with kind permission", async () => {
    // A raw stub host that never landed the Goal-B wire rename: replies {ok:true} to every op (incl.
    // `follow`, which the adapter's ready-gate awaits), then pushes the OLD event shape — no `kind` on
    // the entry, because a pre-Goal-B host never wrote one.
    const p = join(mkdtempSync(join(tmpdir(), "ccx-adapter-legacy-")), "h.sock");
    const srv = createServer((sock) => {
      let buf = "";
      sock.on("data", (c) => {
        buf += c.toString();
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          sock.write(JSON.stringify({ ok: true, id: req.id }) + "\n");
          if (req.op === "follow") {
            sock.write(JSON.stringify({ t: "event", kind: "permission", entry: { toolUseID: "p1", toolName: "Bash", input: {}, sessionId: "s", createdAt: 1 } }) + "\n");
            sock.write(JSON.stringify({ t: "event", kind: "permission_settled", toolUseID: "p1", by: "sys", decision: "deny" }) + "\n");
          }
        }
      });
    });
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const adapter = remoteChatSession(p);
    const seen: PendingEntry[] = [];
    adapter.onDecision((e) => seen.push(e));
    const settled: { toolUseID: string; by: string; decision: string }[] = [];
    adapter.onDecisionSettled((s) => settled.push(s));
    try {
      await adapter.whenReady();
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({ toolUseID: "p1", kind: "permission" });
      await vi.waitFor(() => expect(settled).toHaveLength(1));
      expect(settled[0]).toMatchObject({ toolUseID: "p1", by: "sys", decision: "deny" });
      expect(adapter.pendingNow()).toHaveLength(0);
    } finally {
      adapter.detach();
      srv.close();
    }
  });

  it("13. exposes bg tasks: listBgTasks/background/stopBgTask call the ops; hasBgTasks guards true", async () => {
    const session = bgSession();
    const { host, path } = await startHost(session as unknown as HostSession);
    const adapter = remoteChatSession(path);
    try {
      await adapter.whenReady();
      expect(hasBgTasks(adapter)).toBe(true);
      session.drive({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "bt1", task_type: "bash", description: "x" }] });
      const tasks = await adapter.listBgTasks();
      expect(tasks).toEqual([{ task_id: "bt1", task_type: "bash", description: "x" }]);
      const backgrounded = await adapter.background();
      expect(backgrounded).toBe(true);
      expect(session.backgroundCalls).toEqual([undefined]);
      await expect(adapter.stopBgTask("bt1")).resolves.toBeUndefined();
      expect(session.stopCalls).toEqual(["bt1"]);
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  it("10. host death mid-turn: the in-flight submit rejects and the event consumer sees a synthetic turn-end error", async () => {
    const session = drivable();
    const { host, path } = await startHost(session as unknown as HostSession);
    const adapter = remoteChatSession(path);
    const events: HostEvent[] = [];
    try {
      await adapter.whenReady();
      adapter.onSessionEvent((ev) => events.push(ev));
      const submitPromise = adapter.submit("go", () => {});
      await delay(50);                                      // let the prompt round-trip and the waiter arm
      // Destroy the transport out from under the running host — the process-crash case, not a graceful stop().
      await (host as unknown as { server: { close(): Promise<void> } }).server.close();
      await expect(submitPromise).rejects.toThrow(/closed|host/);
      await vi.waitFor(() => expect(events.some((e) => e.kind === "turn" && e.phase === "end" && typeof e.error === "string")).toBe(true));
    } finally {
      session.finish();
      await stopQuietly(host);
    }
  });
});
