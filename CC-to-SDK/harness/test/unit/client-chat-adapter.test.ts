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
import { hasBgTasks, hasRewind } from "../../src/session/chatSession.js";
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

  it("4. decision feed: park -> onDecision fires -> answerDecision settles the park -> a second answerDecision reports alreadyAnsweredBy -> onDecisionSettled fires once", async () => {
    const { host, path } = await startHost();
    const adapter = remoteChatSession(path);
    try {
      await adapter.whenReady();
      const seen: PendingEntry[] = [];
      adapter.onDecision((e) => seen.push(e));
      const settled: { toolUseID: string; by: string; decision: string }[] = [];
      adapter.onDecisionSettled((s) => settled.push(s));
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t9", signal: new AbortController().signal });
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0].toolUseID).toBe("t9");
      const first = await adapter.answerDecision("t9", { kind: "allow_once" });
      expect(first.ok).toBe(true);
      await expect(decision).resolves.toEqual({ kind: "allow_once" });
      const second = await adapter.answerDecision("t9", { kind: "deny" });
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

  // REGRESSION (codex review, F6 close). /clear swaps the host's engine for a FRESH one that has no session
  // id until its first turn, so the state frame the swap emits carries none — and `route` only ever
  // overwrites the cache on a TRUTHY id. Without the reset the getter kept pointing at the conversation the
  // user just cleared, and /export, /rename and /tag would have acted on that old transcript.
  it("6b. clearSession forgets the cached session id; a later state frame with a real id repopulates it", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    // The engine the swap opens: no id yet, and a `setPermissionMode` so the test can make the host emit a
    // second state frame once the fresh conversation has earned an id.
    const fresh = { ...drivable(""), sessionId: undefined as string | undefined, setPermissionMode: async () => {} };
    const engines: unknown[] = [drivable("sid-before"), fresh];
    const host = new SessionHost(
      { short: "ffffffff", name: "adapter", cwd: process.cwd(), kind: "bg", detached: true, config: {} as never, env },
      { openSession: () => engines.shift() as HostSession, procStartOf: async () => "start" });
    await host.start();
    const adapter = remoteChatSession(hostSocketPath(process.pid, env));
    try {
      await adapter.whenReady();
      expect(adapter.sessionId).toBe("sid-before");
      await adapter.clearSession!();
      expect(adapter.sessionId).toBeUndefined();          // NOT still "sid-before"
      fresh.sessionId = "sid-after";                       // the fresh engine earns its id on its first turn
      await adapter.setPermissionMode("default");          // …and the next state frame carries it
      await vi.waitFor(() => expect(adapter.sessionId).toBe("sid-after"));
    } finally {
      adapter.detach();
      await stopQuietly(host);
    }
  });

  // The SAME hazard as 6b, on the other route that swaps to a fresh engine. A first-message rewind clears the
  // conversation instead of forking it (W-S8), and the broadcast still carries `sessionId` — the host reads
  // `this.session?.sessionId ?? sid`, and a just-swapped engine has no id until its first system/init frame,
  // so the value on the wire is the id of the conversation the user just DISCARDED. Left alone, `route`'s
  // truthy-id overwrite re-affirms it and /export writes the discarded transcript while /rename and /tag
  // mutate the abandoned session's metadata. `cleared` is the positive signal that the right answer is "no
  // id", exactly as clearSession() above forgets it outright; a later state (or rewound) frame repopulates.
  it("6c. a `cleared` rewound broadcast FORGETS the cached id, rather than re-affirming the discarded one", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const fresh = { ...drivable(""), sessionId: undefined as string | undefined, setPermissionMode: async () => {} };
    const engines: unknown[] = [drivable("sid-discarded"), fresh];
    const host = new SessionHost(
      { short: "ffffffff", name: "adapter", cwd: process.cwd(), kind: "bg", detached: true, config: {} as never, env },
      { openSession: () => engines.shift() as HostSession, procStartOf: async () => "start" });
    await host.start();
    const adapter = remoteChatSession(hostSocketPath(process.pid, env));
    try {
      await adapter.whenReady();
      expect(adapter.sessionId).toBe("sid-discarded");
      await host.rewind({ uuid: "u1", prevUuid: null }, "conversation");   // the first-message restore: clears, does not fork
      await vi.waitFor(() => expect(adapter.sessionId).toBeUndefined());   // NOT still "sid-discarded"
      fresh.sessionId = "sid-fresh";                                       // the fresh engine earns its id on its first turn
      await adapter.setPermissionMode("default");                          // …and the next state frame carries it
      await vi.waitFor(() => expect(adapter.sessionId).toBe("sid-fresh"));
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

  // Final-review finding 2: onClose used to settle the turn waiter but leave any still-parked decision
  // untouched — dropPending never fired, so the decision dialog stayed mounted on a dead connection
  // until the 10s request timeout. This pins the fix: a dead host synthesizes a system settle for every
  // still-parked decision, exactly once.
  it("14. host death mid-park: a parked decision is settled system/deny exactly once when the connection dies, and pendingNow() empties", async () => {
    const { host, path } = await startHost();
    const adapter = remoteChatSession(path);
    const settled: { toolUseID: string; by: string; decision: string }[] = [];
    let decision: Promise<unknown> | undefined;
    try {
      await adapter.whenReady();
      adapter.onDecisionSettled((s) => settled.push(s));
      decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tD", signal: new AbortController().signal });
      await vi.waitFor(() => expect(adapter.pendingNow()).toHaveLength(1));
      // Destroy the transport out from under the running host — the process-crash case, same trick as test 10.
      await (host as unknown as { server: { close(): Promise<void> } }).server.close();
      await vi.waitFor(() => expect(settled).toHaveLength(1));
      expect(settled[0]).toMatchObject({ toolUseID: "tD", by: "system", decision: "deny" });
      expect(adapter.pendingNow()).toHaveLength(0);   // the dialog's underlying entry is gone — dropPending can fire
    } finally {
      adapter.detach();
      host.answer("tD", { kind: "deny" }, "test");   // the host's own park is untouched by the socket close — settle it so the test doesn't leak a pending promise
      await decision?.catch(() => {});
      await stopQuietly(host);
    }
  });

  // C5 T3: a raw stub host (fake-connect style, mirrors test 12's legacy-frame stub) that answers
  // canned replies — proves the adapter's rewind passthrough shape without driving a real engine.
  it("15. rewind passthrough: rewindAnchors() resolves [] from {ok:true,anchors:[]}; rewind() throws on {ok:false,error:busy}", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-adapter-rewind-")), "h.sock");
    const srv = createServer((sock) => {
      let buf = "";
      sock.on("data", (c) => {
        buf += c.toString();
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          if (req.op === "rewind_anchors") sock.write(JSON.stringify({ ok: true, id: req.id, anchors: [] }) + "\n");
          else if (req.op === "rewind") sock.write(JSON.stringify({ ok: false, id: req.id, error: "busy" }) + "\n");
          else sock.write(JSON.stringify({ ok: true, id: req.id }) + "\n");
        }
      });
    });
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const adapter = remoteChatSession(p);
    try {
      await adapter.whenReady();
      expect(hasRewind(adapter)).toBe(true);
      await expect(adapter.rewindAnchors()).resolves.toEqual([]);
      await expect(adapter.rewind({ uuid: "u1", prevUuid: null, text: "hi", index: 0 }, "both")).rejects.toThrow(/busy/);
    } finally {
      adapter.detach();
      srv.close();
    }
  });
});
