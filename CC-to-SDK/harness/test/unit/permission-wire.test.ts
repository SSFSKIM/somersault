// harness/test/unit/permission-wire.test.ts — F6 Task 3: the widened permission wire, one round-trip per
// serialization boundary. The design premise (probes 78/81): the ENGINE suggests the permission rule per
// tool in canUseTool's `suggestions`, in exactly the shape `PermissionResult.updatedPermissions` accepts —
// so a dialog echoes one back VERBATIM and the consult is silenced. Every boundary between the dialog and
// the SDK must therefore carry an opaque `PermissionUpdateLike[]` through untouched; these tests pin that.
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { hostOp } from "../../src/host/ops.js";
import { HostServer } from "../../src/host/server.js";
import type { HostHandlers } from "../../src/host/server.js";
import { SessionHost } from "../../src/host/host.js";
import { daemonOp } from "../../src/daemon/types.js";
import { ANSWER_KINDS } from "../../src/appserver/broker.js";
import { AppServer } from "../../src/appserver/server.js";
import type { PeerSink } from "../../src/appserver/peer.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import { PendingDecisions } from "../../src/permissions/pending.js";
import type { PendingDecision } from "../../src/permissions/pending.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import type { DecisionOutcome, PermissionUpdateLike } from "../../src/permissions/types.js";

/** The exact suggestion probe 78 observed for a Read outside cwd, with probe 81's destination rewrite. */
const SUGGESTION: PermissionUpdateLike = {
  type: "addRules",
  rules: [{ toolName: "Read", ruleContent: "//tmp/outside/**" }],
  behavior: "allow",
  destination: "localSettings",
};

describe("host/ops.ts — the answer op's structured arm", () => {
  const answer = (o: Record<string, unknown>) => hostOp.parse({ op: "answer", toolUseID: "t1", by: "me", answer: o });

  it("accepts allow_with_updates and passes updatedPermissions through unreshaped", () => {
    const parsed = answer({ kind: "allow_with_updates", updatedPermissions: [SUGGESTION] });
    expect(parsed).toMatchObject({ op: "answer", answer: { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] } });
    // a passthrough record must not be stripped of unknown keys
    const exotic = answer({ kind: "allow_with_updates", updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session", futureKey: 7 }] });
    expect((exotic as any).answer.updatedPermissions[0].futureKey).toBe(7);
  });

  it("accepts allow_once with updatedInput, allow_always, and deny with feedback", () => {
    expect((answer({ kind: "allow_once", updatedInput: { command: "ls -a" } }) as any).answer.updatedInput).toEqual({ command: "ls -a" });
    expect((answer({ kind: "allow_always" }) as any).answer.kind).toBe("allow_always");
    expect((answer({ kind: "deny", feedback: "use rg instead" }) as any).answer.feedback).toBe("use rg instead");
  });

  it("accepts plan_approve carrying updatedPermissions (Task 9's plan-side grant)", () => {
    const p = answer({ kind: "plan_approve", acceptEdits: true, updatedPermissions: [SUGGESTION] }) as any;
    expect(p.answer.updatedPermissions).toEqual([SUGGESTION]);
    expect((answer({ kind: "plan_approve", acceptEdits: false }) as any).answer.updatedPermissions).toBeUndefined();
  });

  it("still parses the FLAT legacy 3-way decision (an old ccx attach client)", () => {
    for (const decision of ["allow_once", "allow_always", "deny"]) {
      expect((hostOp.parse({ op: "answer", toolUseID: "t1", by: "me", decision }) as any).decision).toBe(decision);
    }
  });

  it("rejects allow_with_updates without updatedPermissions", () => {
    expect(() => answer({ kind: "allow_with_updates" })).toThrow();
  });
});

describe("host/host.ts — KIND_ANSWERS", () => {
  const hostFor = () => new SessionHost(
    { short: "abcdef01", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-wire-")) } },
    { openSession: () => ({ sessionId: "sid", submit: async () => undefined, dispose: async () => {} }) as never, procStartOf: async () => "start" },
  );

  it("a permission park accepts allow_with_updates and resolves it verbatim", async () => {
    const host = hostFor(); await host.start();
    const decision = host.broker().request({ toolName: "Read", input: { file_path: "/tmp/outside/one.txt" }, toolUseID: "t1", signal: new AbortController().signal });
    expect(host.answer("t1", { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] }, "me")).toEqual({ ok: true });
    await expect(decision).resolves.toEqual({ kind: "allow_with_updates", updatedPermissions: [SUGGESTION] });
    await host.stop();
  });

  it("still refuses a genuinely mismatched kind (allow_with_updates against a question park)", async () => {
    const host = hostFor(); await host.start();
    const decision = host.broker().request({ toolName: "AskUserQuestion", input: {}, toolUseID: "q1", kind: "question", signal: new AbortController().signal });
    expect(host.answer("q1", { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] }, "me"))
      .toEqual({ ok: false, error: "kind mismatch: question park cannot take allow_with_updates" });
    expect(host.pending()).toHaveLength(1);
    host.answer("q1", { kind: "question_answer", answers: { a: "b" } }, "me");
    await decision;
    await host.stop();
  });

  it("a plan park accepts plan_approve carrying updatedPermissions", async () => {
    const host = hostFor(); await host.start();
    const decision = host.broker().request({ toolName: "ExitPlanMode", input: {}, toolUseID: "p1", kind: "plan", signal: new AbortController().signal });
    expect(host.answer("p1", { kind: "plan_approve", acceptEdits: true, updatedPermissions: [SUGGESTION] }, "me")).toEqual({ ok: true });
    await expect(decision).resolves.toEqual({ kind: "plan_approve", acceptEdits: true, updatedPermissions: [SUGGESTION] });
    await host.stop();
  });
});

describe("PendingDecision — the shape a dialog renders from", () => {
  const REQ = {
    toolName: "Read", input: { file_path: "/tmp/outside/one.txt" }, toolUseID: "t1",
    suggestions: [SUGGESTION], decisionReason: "Path is outside allowed working directories",
    blockedPath: "/tmp/outside/one.txt", agentID: "agent_7", signal: new AbortController().signal,
  };

  it("park() copies the engine's suggestion payload onto the parked entry", () => {
    const parked = new PendingDecisions({ expireAfterMs: "never" });
    void parked.brokerFor("s1").request(REQ);
    expect(parked.list()[0]).toMatchObject({
      toolUseID: "t1", suggestions: [SUGGESTION], decisionReason: "Path is outside allowed working directories",
      blockedPath: "/tmp/outside/one.txt", agentID: "agent_7",
    });
  });

  it("survives the JSON wire: the `pending` op hands a remote client the same four fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ccx-wire-pend-"));
    const host = new SessionHost(
      { short: "abcdef02", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: dir } },
      { openSession: () => ({ sessionId: "sid", submit: async () => undefined, dispose: async () => {} }) as never, procStartOf: async () => "start" },
    );
    await host.start();
    void host.broker().request(REQ);
    const c = await RemoteChatSession.connect(hostSocketPath(process.pid, { CCX_FLEET_ROOT: dir }), { label: "dialog" });
    const { pending } = await c.pending();
    expect(pending[0]).toMatchObject({
      toolUseID: "t1", kind: "permission", suggestions: [SUGGESTION],
      decisionReason: "Path is outside allowed working directories", blockedPath: "/tmp/outside/one.txt", agentID: "agent_7",
    });
    c.detach(); await host.stop();
  });

  it("reaches the REPL feed untouched: chatAdapter's onDecision entry (= useChat's state.pending) carries all four", async () => {
    // chatAdapter/useChat need NO field list of their own — the adapter spreads the wire entry whole and
    // useChat stores the PendingDecision as-is. This test is what makes that pass-through a contract
    // rather than an accident: it fails the moment either side starts hand-picking fields.
    const dir = mkdtempSync(join(tmpdir(), "ccx-wire-feed-"));
    const host = new SessionHost(
      { short: "abcdef03", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: dir } },
      { openSession: () => ({ sessionId: "sid", submit: async () => undefined, dispose: async () => {} }) as never, procStartOf: async () => "start" },
    );
    await host.start();
    const adapter = remoteChatSession(hostSocketPath(process.pid, { CCX_FLEET_ROOT: dir }), { label: "repl" });
    await adapter.whenReady();
    const seen: PendingDecision[] = [];
    adapter.onDecision((e) => seen.push(e));
    const decision = host.broker().request(REQ);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({
      toolUseID: "t1", kind: "permission", suggestions: [SUGGESTION],
      decisionReason: "Path is outside allowed working directories", blockedPath: "/tmp/outside/one.txt", agentID: "agent_7",
    });
    // ...and the answer travels the other way on the same feed
    await adapter.answerDecision("t1", { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] });
    await expect(decision).resolves.toEqual({ kind: "allow_with_updates", updatedPermissions: [SUGGESTION] });
    adapter.detach(); await host.stop();
  });
});

describe("daemon/types.ts — permission_response", () => {
  it("accepts allow_with_updates, allow_once+updatedInput and deny+feedback, and keeps the bare 3-way", () => {
    const parse = (decision: Record<string, unknown>) => daemonOp.parse({ op: "permission_response", toolUseID: "t1", decision }) as any;
    expect(parse({ kind: "allow_with_updates", updatedPermissions: [SUGGESTION] }).decision.updatedPermissions).toEqual([SUGGESTION]);
    expect(parse({ kind: "allow_once", updatedInput: { a: 1 } }).decision.updatedInput).toEqual({ a: 1 });
    expect(parse({ kind: "deny", feedback: "nope" }).decision.feedback).toBe("nope");
    expect(parse({ kind: "allow_once" }).decision).toEqual({ kind: "allow_once" });
    expect(parse({ kind: "allow_always" }).decision).toEqual({ kind: "allow_always" });   // back-compat arm
    expect(parse({ kind: "deny" }).decision).toEqual({ kind: "deny" });
    expect(() => parse({ kind: "allow_with_updates" })).toThrow();
  });
});

describe("appserver — decisionOutcomeParams + ANSWER_KINDS", () => {
  const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
  const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" });
  const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
  const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));

  it("ANSWER_KINDS lists allow_with_updates for the permission kind and nothing else gained it", () => {
    expect(ANSWER_KINDS.permission).toEqual(["allow_once", "allow_with_updates", "allow_always", "deny"]);
    expect(ANSWER_KINDS.question).toEqual(["question_answer", "deny"]);
    expect(ANSWER_KINDS.plan).toEqual(["plan_approve", "plan_reject", "deny"]);
  });

  it("decision/respond carries allow_with_updates to the parked broker verbatim", async () => {
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    send(connA, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
    send(connA, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    const decision = broker.request({ toolName: "Read", input: {}, toolUseID: "toolu_u", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));
    send(connA, { id: 3, method: "decision/respond", params: { threadId, toolUseId: "toolu_u", answer: { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] } } });
    await new Promise((r) => setTimeout(r, 0));

    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    await expect(decision).resolves.toEqual({ kind: "allow_with_updates", updatedPermissions: [SUGGESTION] });
  });

  it("decision/respond carries deny+feedback and allow_once+updatedInput", async () => {
    let broker: any;
    const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = mkSink(); const connA = srv.connect(a.sink);
    send(connA, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
    send(connA, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    const d1 = broker.request({ toolName: "Bash", input: {}, toolUseID: "toolu_f", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));
    send(connA, { id: 3, method: "decision/respond", params: { threadId, toolUseId: "toolu_f", answer: { kind: "deny", feedback: "use rg" } } });
    await new Promise((r) => setTimeout(r, 0));
    await expect(d1).resolves.toEqual({ kind: "deny", feedback: "use rg" });

    const d2 = broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_i", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));
    send(connA, { id: 4, method: "decision/respond", params: { threadId, toolUseId: "toolu_i", answer: { kind: "allow_once", updatedInput: { command: "ls -a" } } } });
    await new Promise((r) => setTimeout(r, 0));
    await expect(d2).resolves.toEqual({ kind: "allow_once", updatedInput: { command: "ls -a" } });
  });
});

describe("client/remote.ts — the flat/structured answer split", () => {
  /** A stub host that records the raw op frames a client sends and always replies {ok:true}. */
  function recordingHost(path: string) {
    const ops: any[] = [];
    const srv = createServer((sock) => {
      let buf = "";
      sock.on("data", (c) => {
        buf += c.toString();
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          ops.push(req);
          sock.write(JSON.stringify({ ok: true, id: req.id }) + "\n");
        }
      });
    });
    return { ops, listening: new Promise<typeof srv>((r) => srv.listen(path, () => r(srv))) };
  }

  const sockPath = () => join(mkdtempSync(join(tmpdir(), "ccx-wire-rc-")), "h.sock");

  it("payload-free 3-way answers stay FLAT (an old host's schema must still parse them)", async () => {
    const p = sockPath(); const h = recordingHost(p); const srv = await h.listening;
    const c = await RemoteChatSession.connect(p, { label: "me" });
    for (const outcome of [{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }] as DecisionOutcome[]) await c.answerDecision("t1", outcome);
    expect(h.ops.map((o) => ({ decision: o.decision, answer: o.answer }))).toEqual([
      { decision: "allow_once", answer: undefined },
      { decision: "allow_always", answer: undefined },
      { decision: "deny", answer: undefined },
    ]);
    c.detach(); srv.close();
  });

  it("payload-carrying answers go STRUCTURED, with the payload intact on the wire", async () => {
    const p = sockPath(); const h = recordingHost(p); const srv = await h.listening;
    const c = await RemoteChatSession.connect(p, { label: "me" });
    await c.answerDecision("t1", { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] });
    await c.answerDecision("t2", { kind: "allow_once", updatedInput: { command: "ls -a" } });
    await c.answerDecision("t3", { kind: "deny", feedback: "use rg" });
    expect(h.ops.map((o) => o.answer)).toEqual([
      { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] },
      { kind: "allow_once", updatedInput: { command: "ls -a" } },
      { kind: "deny", feedback: "use rg" },
    ]);
    expect(h.ops.every((o) => o.decision === undefined)).toBe(true);   // never BOTH — dispatch refuses that
    c.detach(); srv.close();
  });

  it("end to end: a remote allow_with_updates reaches the host handler intact through the real HostServer", async () => {
    const p = sockPath();
    const seen: { toolUseID: string; outcome: DecisionOutcome; by: string }[] = [];
    const handlers = {
      status: () => ({ state: "idle", status: "idle" }), busy: () => false, stop: async () => {}, pending: () => [],
      answer: (toolUseID: string, outcome: DecisionOutcome, by: string) => { seen.push({ toolUseID, outcome, by }); return { ok: true }; },
      prompt: async () => {}, interrupt: async () => {}, follow: () => () => {}, control: async () => ({}), resume: async () => {},
      turnSeq: () => 0, tasks: () => [], background: async () => false, stopTask: async () => {},
      rewindAnchors: async () => [], rewindDryRun: async () => ({}) as never, rewind: async () => {},
      getSettings: async () => ({}), listDirs: () => [], addDir: async () => {}, removeDir: async () => {},
      setOutputStyle: async () => {}, addRule: async () => {}, removeRule: async () => {},
    } as unknown as HostHandlers;
    const server = new HostServer(handlers, p);
    await server.listen();
    const c = await RemoteChatSession.connect(p, { label: "dialog" });
    expect(await c.answerDecision("t1", { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] })).toMatchObject({ ok: true });
    await c.answerDecision("t2", { kind: "deny", feedback: "use rg" });
    await c.answerDecision("t3", { kind: "allow_once", updatedInput: { command: "ls -a" } });
    await c.answerDecision("t4", { kind: "allow_always" });
    expect(seen).toEqual([
      { toolUseID: "t1", by: "dialog", outcome: { kind: "allow_with_updates", updatedPermissions: [SUGGESTION] } },
      { toolUseID: "t2", by: "dialog", outcome: { kind: "deny", feedback: "use rg" } },
      { toolUseID: "t3", by: "dialog", outcome: { kind: "allow_once", updatedInput: { command: "ls -a" } } },
      { toolUseID: "t4", by: "dialog", outcome: { kind: "allow_always" } },
    ]);
    c.detach(); await server.close();
  });
});
