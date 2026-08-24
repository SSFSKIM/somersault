import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostSession } from "../../src/host/host.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { stageBlocks, IMAGE_VERSION_SKEW_NOTICE } from "../../src/client/stagedSubmit.js";
import type { StagedSubmitOps } from "../../src/client/stagedSubmit.js";
import { MAX_IMAGES_PER_PROMPT } from "../../src/media/imageDims.js";
import { hasBgTasks, hasRewind } from "../../src/session/chatSession.js";
import type { HostEvent } from "../../src/host/wire.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { UserContentBlock } from "../../src/session/turnInput.js";

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

async function startHost(session: HostSession = drivable(), opts: { kind?: "bg" | "interactive"; detached?: boolean; getMessages?: (id: string, o: { cwd?: string }) => Promise<any[]> } = {}) {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const kind = opts.kind ?? "bg";
  const host = new SessionHost(
    { short: "ffffffff", name: "adapter", cwd: process.cwd(), kind, detached: opts.detached ?? true, config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start", ...(opts.getMessages ? { getMessages: opts.getMessages } : {}) });
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

  // W-S13, over the REAL socket. The client half of the resumed-idle lie: `session.sessionId` is what
  // fetchSettingsStats, /status's session row, /export, /files, /session, /rename and /tag all read, and
  // in a session resumed with `--continue`/`--resume` it stayed undefined until the first live turn
  // ended. The host now answers with the conversation it resumed, and the adapter learns it from the
  // `state` frame follow() replays — no client-side fallback, one source of truth. `sessionId: undefined`
  // on the fake session IS the pre-first-turn engine.
  it("16. a resumed session's id reaches the client BEFORE any turn — and a fresh one still has none", async () => {
    const engine = { ...syncSession("unused", []), sessionId: undefined } as unknown as HostSession;
    const rows = [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } },
                  { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "yo" }] } }];
    const { host, path } = await startHost(engine, { kind: "interactive", getMessages: async () => rows });
    const resumed = remoteChatSession(path, { resume: "sid-resumed" });
    try {
      await resumed.whenReady();
      expect(resumed.sessionId).toBe("sid-resumed");                 // what /stats reads — was undefined
      const anchors = await resumed.rewindAnchors();                 // what Esc-Esc reads — was []
      expect(anchors.map((a) => a.uuid)).toEqual(["u1"]);
    } finally { resumed.detach(); }
    // Regression: nothing was resumed here, so the very same host must still report no id at all rather
    // than a phantom one carried over from the client that left.
    await host.clearSession();
    const fresh = remoteChatSession(path);
    try {
      await fresh.whenReady();
      expect(fresh.sessionId).toBeUndefined();
      expect(await fresh.rewindAnchors()).toEqual([]);
    } finally { fresh.detach(); await stopQuietly(host); }
  });

  // M3 §1a-a REVIEW, Important 1 — the RESUME half of the self-swap question. Every engine swap announces
  // now, so a client that received its own swap's `rewound` would rebuild its transcript from disk on top
  // of the replay it is about to be sent. On the /clear and rewind paths a ref guards it (useChat's
  // `selfRewind`); here the guarantee is STRUCTURAL and this test is what keeps it so: the adapter issues
  // the resume op while this connection is not yet a follower, so the announcement reaches every OTHER
  // client and not its initiator. Both halves are asserted, because "nobody heard it" would pass the
  // self-quiet half while silently undoing the change §1a-a exists to make.
  it("17. a resuming client never receives its OWN `rewound` — while an already-attached client does", async () => {
    const engine = { ...syncSession("unused", []), sessionId: undefined } as unknown as HostSession;
    const { host, path } = await startHost(engine, { kind: "interactive", getMessages: async () => [] });
    const watcher = remoteChatSession(path);
    const watched: HostEvent[] = [];
    const mine: HostEvent[] = [];
    try {
      await watcher.whenReady();
      watcher.onSessionEvent((ev) => watched.push(ev));
      const resumed = remoteChatSession(path, { resume: "sid-resumed" });
      resumed.onSessionEvent((ev) => mine.push(ev));
      try {
        await resumed.whenReady();
        await vi.waitFor(() => expect(watched.filter((e) => e.kind === "rewound")).toHaveLength(1));
        expect(mine.filter((e) => e.kind === "rewound")).toHaveLength(0);
      } finally { resumed.detach(); }
    } finally { watcher.detach(); await stopQuietly(host); }
  });
});

// Task 1 (spec rev 3, "fleet threads"): the staging loop moved out of `chatAdapter.submit` into
// `client/stagedSubmit.ts` so the fleet engine stages through the SAME code the socket adapter does.
// These rows drive the helper directly, with a fake `StagedSubmitOps` that mints REAL files — which is
// what makes the repair the extraction carries observable: the minted path is tracked BEFORE the write,
// so a failed write no longer leaks the file the host just minted (spec rev 2 finding 9).
describe("stagedSubmit — the shared staging loop", () => {
  // Header-only PNG: signature + IHDR width/height, zero-padded. `pngDimensions` never reads past byte
  // 24 (clipboardImage.ts), so this is the cheapest buffer that sniffs as a real image.
  const fakePng = (width: number, height: number, totalBytes = 64): Buffer => {
    const buf = Buffer.alloc(Math.max(totalBytes, 24));
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
  };
  const imageBlock = (buf: Buffer, mediaType = "image/png"): UserContentBlock =>
    ({ type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } });
  const sha = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");
  // chmod cannot express "unwritable" to root, so the two write-failure rows need a real user (and a
  // filesystem that enforces mode bits at all — never win32).
  const noModeEnforcement = process.platform === "win32" || process.getuid?.() === 0;

  /** A `StagedSubmitOps` minting REAL files in a temp dir: cleanup is then observable with `existsSync`
   *  and the helper's own `writeFile` really lands the decoded bytes. `readOnlyAt` chmods the Nth
   *  (1-based) minted file 0o400 before handing it back, so the helper's write fails EACCES for real
   *  rather than against a stubbed rejection. `failWith` refuses the Nth stage call outright. */
  function fakeStager(opts: { readOnlyAt?: number; failWith?: { at: number; error: string } } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "ccx-staged-"));
    fleets.push(dir);
    const calls: { mediaType: string; dimensions: { width: number; height: number }; size: number; sha256: string }[] = [];
    const minted: string[] = [];
    const ops = {
      async stageImageOp(d) {
        calls.push(d);
        if (opts.failWith && calls.length === opts.failWith.at) return { ok: false, error: opts.failWith.error };
        const path = join(dir, `img-${calls.length}.png`);
        writeFileSync(path, "");
        minted.push(path);
        if (opts.readOnlyAt === calls.length) chmodSync(path, 0o400);
        return { ok: true, path };
      },
    } satisfies StagedSubmitOps;
    return { dir, calls, minted, ops };
  }

  it("a. two text + two image blocks fold to one string, stage twice, and land the decoded bytes", async () => {
    const png1 = fakePng(4, 4, 64);
    const png2 = fakePng(8, 8, 96);
    const stager = fakeStager();
    const staged = await stageBlocks([{ type: "text", text: "A" }, imageBlock(png1), { type: "text", text: "B" }, imageBlock(png2)], stager.ops);
    expect(staged.text).toBe("AB");                                          // the fold, in declaration order
    expect(stager.calls.map((c) => c.dimensions)).toEqual([{ width: 4, height: 4 }, { width: 8, height: 8 }]);
    expect(stager.calls.map((c) => c.size)).toEqual([png1.length, png2.length]);
    expect(stager.calls.map((c) => c.sha256)).toEqual([sha(png1), sha(png2)]);
    expect(staged.images).toEqual([{ stagedId: stager.minted[0], sha256: sha(png1) }, { stagedId: stager.minted[1], sha256: sha(png2) }]);
    expect(readFileSync(stager.minted[0]).equals(png1)).toBe(true);
    expect(readFileSync(stager.minted[1]).equals(png2)).toBe(true);
    // Success hands `cleanup` to the CALLER unfired — the files must still be there for the host to read.
    expect(stager.minted.every((p) => existsSync(p))).toBe(true);
    await staged.cleanup();
    expect(stager.minted.some((p) => existsSync(p))).toBe(false);
  });

  it.skipIf(noModeEnforcement)("b. THE REPAIR: a failed write removes the file its own stage call just minted", async () => {
    const stager = fakeStager({ readOnlyAt: 1 });
    await expect(stageBlocks([{ type: "text", text: "A" }, imageBlock(fakePng(4, 4))], stager.ops)).rejects.toThrow(/EACCES|permission denied/i);
    expect(stager.minted).toHaveLength(1);
    // Discriminating: with the pre-extraction ordering (push AFTER the write) this file was never in
    // `stagedPaths`, so it survived the throw and leaked until the orphan sweep — spec rev 2 finding 9.
    expect(existsSync(stager.minted[0])).toBe(false);
  });

  it.skipIf(noModeEnforcement)("c. a MIDDLE image's write failure also removes the FIRST image's staged file", async () => {
    const stager = fakeStager({ readOnlyAt: 2 });
    const blocks: UserContentBlock[] = [{ type: "text", text: "A" }, imageBlock(fakePng(4, 4)), imageBlock(fakePng(8, 8)), imageBlock(fakePng(16, 16))];
    await expect(stageBlocks(blocks, stager.ops)).rejects.toThrow(/EACCES|permission denied/i);
    expect(stager.calls).toHaveLength(2);                                    // the third image never reached the stage op
    expect(stager.minted).toHaveLength(2);
    expect(stager.minted.some((p) => existsSync(p))).toBe(false);            // BOTH gone, not just the one that failed
  });

  it("d. an 'unknown op' stage refusal is the version-skew notice, and nothing stays staged", async () => {
    const stager = fakeStager({ failWith: { at: 2, error: "unknown op" } });
    await expect(stageBlocks([imageBlock(fakePng(4, 4)), imageBlock(fakePng(8, 8))], stager.ops)).rejects.toThrow(IMAGE_VERSION_SKEW_NOTICE);
    expect(stager.minted).toHaveLength(1);
    expect(existsSync(stager.minted[0])).toBe(false);
  });

  it("e. images past MAX_IMAGES_PER_PROMPT degrade into the fold text with no stage call at all", async () => {
    const stager = fakeStager();
    const blocks: UserContentBlock[] = [{ type: "text", text: "many" }];
    for (let i = 0; i < MAX_IMAGES_PER_PROMPT + 3; i++) blocks.push(imageBlock(fakePng(4, 4)));
    const staged = await stageBlocks(blocks, stager.ops);
    expect(stager.calls).toHaveLength(MAX_IMAGES_PER_PROMPT);                // the excess never touched the wire
    expect(staged.images).toHaveLength(MAX_IMAGES_PER_PROMPT);
    expect(staged.text.startsWith("many")).toBe(true);
    expect(staged.text.match(/too many images in one turn/g)).toHaveLength(3);
    await staged.cleanup();
  });
});
