// test/live/appserver-m2-acceptance.test.ts — M2b Task 9 step 2: the M2 spec's `## Acceptance
// (behavior-phrased)` item 2, executed as written, in ONE keyed run against a real engine — plus
// acceptance 5 (a SECOND client observes the first's set) folded into the same thread, and the Task-3b
// settings-ops legs the plan adds ("`thread/effort/set` accepted → `thread/settings/read` returns", and
// `thread/directory/list` shows the cwd row).
//
// The spec's rule for this file is literal: "Each observation is an assertion, not a log line." The one
// deliberate exception is the steer leg's `STEER-EVIDENCE:` dump — that leg exists to SETTLE an open
// empirical question (see `it` 10 and src/session/session.ts's `unmatchedResults` doc comment), so its
// captured payload is the deliverable alongside its assertion.
//
// Shape: ONE describe, sequential `it`s sharing state over ONE server and ONE thread. The sequence is
// stateful end to end (a park cannot be observed on a thread that never started, a queue drain cannot be
// observed without a busy turn), so independent-per-`it` servers — the router smoke's shape, right for two
// unrelated smokes — would multiply the keyed cost by fourteen and still not test the sequence. Each step
// keeps its own generous timeout so a failure names its leg instead of a five-minute block.
//
// Cost/keying: haiku throughout (one `thread/model/set` leg deliberately touches sonnet and immediately
// returns to haiku), `settingSources: []` on the thread config — load-bearing, exactly as in the M1
// acceptance: a developer's own `~/.claude/settings.json` (`defaultMode`, a `permissions.allow` rule)
// would pre-authorize the write and the decision park this run exists to observe would never happen.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6"; // the id the shipped M2a setter smoke already proves the engine accepts

interface Notif { method: string; params: any }

/** The same minimal WS JSON-RPC "lite" client as appserver-m1.test.ts / appserver-m2-router-smoke.test.ts
 *  (spec §4: no jsonrpc field), mirrored rather than imported because neither of those files exports it.
 *  Two additions this run needs, both about telling one occurrence of a repeated notification from the
 *  next — `thread/settings/changed` and `turn/completed` each fire many times across fourteen steps:
 *   - `mark()` + `waitFor`'s `from` argument: only consider notifications that arrived AFTER a step began,
 *     so a leg cannot be satisfied by a previous leg's event.
 *   - `onNotification`: a hook the steer/queue legs use to arm the parkless safety net (see `it` 4). */
class RpcClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  readonly notifications: Notif[] = [];
  readonly onNotification: Array<(n: Notif) => void> = [];
  private waiters: Array<{ pred: (n: Notif) => boolean; resolve: (n: Notif) => void }> = [];
  constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id !== "undefined" && (Object.prototype.hasOwnProperty.call(msg, "result") || Object.prototype.hasOwnProperty.call(msg, "error"))) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      if (typeof msg.method === "string") {
        const n: Notif = { method: msg.method, params: msg.params ?? {} };
        this.notifications.push(n);
        const i = this.waiters.findIndex((w) => w.pred(n));
        if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(n); }
        for (const cb of [...this.onNotification]) { try { cb(n); } catch { /* a hook's failure is not the client's */ } }
      }
    });
  }
  /** Index of the next notification to arrive — hand it to `waitFor` as `from` to scope a wait to a step. */
  mark(): number { return this.notifications.length; }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timed out after ${timeoutMs}ms waiting for a reply to ${method} (id ${id})`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(label: string, timeoutMs: number, pred: (n: Notif) => boolean, from = 0): Promise<Notif> {
    const existing = this.notifications.slice(from).find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { pred, resolve: (n: Notif) => { clearTimeout(timer); resolve(n); } };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label} (saw since mark: ${this.notifications.slice(from).map((n) => n.method).join(", ") || "<nothing>"})`));
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }
  /** Every notification of one method since `from`, in arrival order. */
  since(from: number, method: string): Notif[] { return this.notifications.slice(from).filter((n) => n.method === method); }
}

function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** True when the value holds at least one finite number anywhere inside it. The usage/context payloads are
 *  the engine's own untyped shapes (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`,
 *  `getContextUsage`), so "returns numbers" is asserted structurally rather than against field names this
 *  test would have to guess and would then pin the SDK to. */
function holdsNumber(value: unknown, depth = 0): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > 6 || value === null || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((v) => holdsNumber(v, depth + 1));
}

/** Text of every agentMessage item seen since `from`, joined — the steer leg's influence evidence. */
function agentText(client: RpcClient, from: number): string {
  return client.notifications.slice(from)
    .filter((n) => n.method === "item/completed" && n.params.item?.type === "agentMessage")
    .map((n) => String(n.params.item.text ?? "")).join("\n");
}

live("M2 acceptance: the spec's full control-plane sequence, one keyed run", () => {
  let cwd = "";
  let grantDir = "";
  let server: AppServer;
  let listener: { port: number; close(): Promise<void> };
  let wsA: WebSocket;
  let wsB: WebSocket;
  let a: RpcClient; // the driver, and a watcher (initialize{watchThreads:true})
  let b: RpcClient; // the SECOND client of acceptance 5 — subscribed to the same thread, never the setter
  let threadId = "";
  let forkThreadId = "";
  let promptItemId = "";   // the userMessage item id of the park turn = the uuid the appserver minted for it
  // The parkless safety net, armed once the decision-park leg has been observed (see `it` 4). Every later
  // leg runs under bypassPermissions and must not park; if the engine consults the broker anyway, an
  // unanswered park would hang that leg until its timeout and report a misleading failure. Answering it
  // keeps the failure where it belongs — and the ids it answered are asserted-empty at the end, so the net
  // can never silently mask a park that should not have happened.
  let autoAllow = false;
  const autoAllowed: string[] = [];

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), "cc-appserver-m2-accept-"));
    grantDir = mkdtempSync(join(tmpdir(), "cc-appserver-m2-grant-"));
    server = new AppServer({}); // no token: this run exercises the control plane, not auth (wsTransport.test.ts owns that)
    listener = await listenWs(server, {});
    wsA = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    wsB = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    a = new RpcClient(wsA);
    b = new RpcClient(wsB);
    a.onNotification.push((n) => {
      if (!autoAllow || n.method !== "decision/requested") return;
      const entry = n.params.decision;
      if (entry?.kind !== "permission") return; // only the kind the net knows how to answer
      autoAllowed.push(String(entry.toolUseId));
      void a.call("decision/respond", { threadId: n.params.threadId, toolUseId: entry.toolUseId, answer: { kind: "allow_once" } }).catch(() => {});
    });
  }, 60_000);

  afterAll(async () => {
    for (const id of [threadId, forkThreadId]) {
      if (id && a) { try { await a.call("thread/close", { threadId: id }, 20_000); } catch { /* already closed by the last step */ } }
    }
    try { await server?.shutdown(); } catch { /* best-effort */ }
    wsA?.close(); wsB?.close();
    try { await listener?.close(); } catch { /* best-effort */ }
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    if (grantDir) rmSync(grantDir, { recursive: true, force: true });
  }, 60_000);

  it("initialize{watchThreads:true} -> thread/start -> both watchers observe thread/started", async () => {
    const initA = await a.call("initialize", { clientInfo: { name: "m2-acceptance-a" }, watchThreads: true });
    expect(initA.userAgent).toBe("cc-harness-appserver");
    await b.call("initialize", { clientInfo: { name: "m2-acceptance-b" }, watchThreads: true });

    const markA = a.mark(); const markB = b.mark();
    // permissionMode "default" — NOT bypass: the decision-park leg below is the point of this thread, and
    // bypass silences the broker outright. `unattended: "park"` + two subscribers is what makes a consult
    // park rather than auto-deny (broker.ts's watcher rule).
    const started = await a.call("thread/start", { config: { permissionMode: "default", cwd, settingSources: [], model: HAIKU }, unattended: "park" }, 30_000);
    threadId = started.thread.id;
    expect(threadId).toBeTruthy();
    expect(started.thread.cwd).toBe(cwd);
    expect(started.thread.status).toEqual({ state: "idle" });
    expect(started.thread.queueDepth).toBe(0);

    // The watcher fan-out (D-M2-5): thread EXISTENCE reaches every connection that opted in — including B,
    // which has no subscription to this thread and structurally could not have one, since the thread did
    // not exist when B connected.
    for (const [name, client, mark] of [["the starting client", a, markA], ["the OTHER watcher", b, markB]] as const) {
      const evt = await client.waitFor(`thread/started on ${name}`, 15_000, (n) => n.method === "thread/started" && n.params.thread?.id === threadId, mark);
      expect(evt.params.thread.cwd).toBe(cwd);
    }

    for (const client of [a, b]) {
      const sub = await client.call("thread/subscribe", { threadId });
      expect(sub.subscribed).toBe(true);
    }
  }, 90_000);

  it("thread/model/set is announced to BOTH subscribers as source:\"client\" (acceptance 5)", async () => {
    const markA = a.mark(); const markB = b.mark();
    const set = await a.call("thread/model/set", { threadId, model: SONNET }, 30_000);
    expect(set.ok).toBe(true);
    // The write-back fan-out PROVEN, not assumed: the engine volunteers no settings frames (the M2a router
    // smoke's verdict), so this notification is the only way any client — including the one that never
    // asked — learns the knob moved.
    for (const [name, client, mark] of [["the setter's own client", a, markA], ["the OTHER client", b, markB]] as const) {
      const evt = await client.waitFor(`thread/settings/changed on ${name}`, 20_000, (n) => n.method === "thread/settings/changed" && n.params.threadId === threadId, mark);
      expect(evt.params.source, `${name} saw source ${evt.params.source}`).toBe("client");
      expect(evt.params.model).toBe(SONNET);
    }

    // Back to haiku for the rest of the run — every remaining leg drives real turns.
    const markBack = b.mark();
    expect((await a.call("thread/model/set", { threadId, model: HAIKU }, 30_000)).ok).toBe(true);
    const back = await b.waitFor("thread/settings/changed (back to haiku)", 20_000, (n) => n.method === "thread/settings/changed" && n.params.threadId === threadId, markBack);
    expect(back.params.model).toBe(HAIKU);
  }, 90_000);

  it("thread/thinking/set resolves through the shared level vocabulary; thread/capabilities/read is non-empty", async () => {
    const markB = b.mark();
    expect((await a.call("thread/thinking/set", { threadId, level: "low" }, 30_000)).ok).toBe(true);
    const think = await b.waitFor("thread/settings/changed (thinking)", 20_000, (n) => n.method === "thread/settings/changed" && n.params.threadId === threadId, markB);
    expect(think.params.source).toBe("client");
    expect(think.params.thinkingTokens, "the level did not resolve to a positive budget").toBeGreaterThan(0);

    const caps = (await a.call("thread/capabilities/read", { threadId }, 30_000)).capabilities;
    expect(Array.isArray(caps.models)).toBe(true);
    expect(caps.models.length, "the engine reported no supported models").toBeGreaterThan(0);
    expect(Array.isArray(caps.commands)).toBe(true);
    expect(caps.commands.length, "the engine reported no supported commands").toBeGreaterThan(0);
  }, 90_000);

  it("a file-write turn parks: status.waitingOn === \"decision\" -> respond -> turn/completed", async () => {
    const markA = a.mark();
    // A write, not a bash echo: under permissionMode "default" the SDK does not consult canUseTool for a
    // trivial command, and the first M1 keyed run ran clean through with no park at all because of it.
    const turn = await a.call("turn/start", { threadId, input: "Create a file note.txt in the current directory containing exactly: m2-acceptance-ok" }, 30_000);
    expect(turn.turn.status).toBe("inProgress");
    const turnId = turn.turn.id;

    const requested = await a.waitFor("decision/requested (write permission)", 120_000, (n) => n.method === "decision/requested" && n.params.threadId === threadId, markA);
    const entry = requested.params.decision;
    expect(entry.kind).toBe("permission");
    expect(["Write", "Edit"]).toContain(entry.toolName);
    expect(requested.params.turnId, "the park carries no turn id — a UI cannot attach it to a turn row").toBe(turnId);

    // The park's status, on the two independent surfaces that carry it: the pushed status notification and
    // the pulled thread row. `threadStatus` is the one shape both go through (D-M2-8), so a divergence here
    // would mean a caller re-assembled it.
    const status = await a.waitFor("thread/status/changed (waitingOn decision)", 20_000,
      (n) => n.method === "thread/status/changed" && n.params.threadId === threadId && n.params.status?.waitingOn === "decision", markA);
    expect(status.params.status.state).toBe("active");
    const listed = await a.call("thread/list", { cwd, limit: 50 }, 30_000);
    const row = listed.data.find((t: any) => t.id === threadId);
    expect(row, "the parked thread is absent from thread/list").toBeTruthy();
    expect(row.status).toEqual({ state: "active", waitingOn: "decision" });

    expect((await a.call("decision/respond", { threadId, toolUseId: entry.toolUseId, answer: { kind: "allow_once" } }, 30_000)).ok).toBe(true);
    await a.waitFor("decision/resolved", 30_000, (n) => n.method === "decision/resolved" && n.params.toolUseId === entry.toolUseId, markA);

    const completed = await a.waitFor("turn/completed (park turn)", 120_000, (n) => n.method === "turn/completed" && n.params.turn?.id === turnId, markA);
    expect(completed.params.turn.status).toBe("completed");

    // The live userMessage id IS the uuid the appserver minted for the submit (turns.ts's submitRunner) —
    // captured here because the rewind-anchor leg below asserts the persisted transcript carries the same
    // one, and the steer leg reports it as the uuid the engine's result frame must correlate to.
    const user = a.notifications.slice(markA).find((n) => n.method === "item/completed" && n.params.item?.type === "userMessage");
    expect(user, "no userMessage item was emitted for the park turn").toBeTruthy();
    promptItemId = user!.params.item.id;
    expect(promptItemId).toBeTruthy();

    // The park has been observed; every remaining leg drives turns that must NOT park (the queue drain and
    // the steer leg both hang forever behind an unanswered consult). Switching the live mode IS a
    // control-plane assertion of its own — a runtime permissionMode change announced to both clients.
    const markB = b.mark();
    expect((await a.call("thread/permissionMode/set", { threadId, mode: "bypassPermissions" }, 30_000)).ok).toBe(true);
    const moded = await b.waitFor("thread/settings/changed (bypassPermissions)", 20_000, (n) => n.method === "thread/settings/changed" && n.params.threadId === threadId, markB);
    expect(moded.params.source).toBe("client");
    expect(moded.params.permissionMode).toBe("bypassPermissions");
    autoAllow = true;
  }, 240_000);

  it("thread/usage/read and thread/contextUsage/read return numbers", async () => {
    const usage = await a.call("thread/usage/read", { threadId }, 30_000);
    expect(usage.usage, "thread/usage/read replied no usage payload").toBeTruthy();
    expect(holdsNumber(usage.usage), `thread/usage/read carried no numbers: ${JSON.stringify(usage.usage)}`).toBe(true);

    const ctx = await a.call("thread/contextUsage/read", { threadId }, 30_000);
    expect(ctx.contextUsage, "thread/contextUsage/read replied no payload").toBeTruthy();
    expect(holdsNumber(ctx.contextUsage), `thread/contextUsage/read carried no numbers: ${JSON.stringify(ctx.contextUsage)}`).toBe(true);
  }, 90_000);

  it("thread/rewind/anchors is non-empty and thread/rewind/dryRun against the turn's anchor succeeds", async () => {
    const anchors = await a.call("thread/rewind/anchors", { threadId }, 30_000);
    expect(anchors.nextCursor).toBe(null);
    expect(anchors.data.length, "the persisted transcript yielded no rewind anchors").toBeGreaterThan(0);
    // Newest first (rows.ts reverses), and at this point exactly one prompt has been submitted — so the
    // head anchor IS the park turn's prompt, and its uuid must be the one the appserver minted. This is the
    // caller-supplied-uuid seam proven through the transcript rather than through the live stream alone.
    const anchorUuid = anchors.data[0].uuid;
    expect(anchorUuid, `the head anchor ${anchorUuid} is not the uuid the appserver submitted (${promptItemId})`).toBe(promptItemId);

    const dry = await a.call("thread/rewind/dryRun", { threadId, uuid: anchorUuid }, 60_000);
    expect(typeof dry.canRewind, `dryRun replied a malformed result: ${JSON.stringify(dry)}`).toBe("boolean");
    // TRUE, not merely well-formed: the harness enables file checkpointing by default
    // (config/resolveOptions.ts) and the park turn wrote a file, so a checkpoint for this anchor exists. A
    // false here means one of those two premises broke — checkpointing off for appserver sessions, or the
    // turn changed nothing on disk — and both are findings, not flakes.
    expect(dry.canRewind, `dryRun refused the park turn's own anchor: ${JSON.stringify(dry)}`).toBe(true);
  }, 120_000);

  it("mcpServer/status/list returns", async () => {
    const mcp = await a.call("mcpServer/status/list", { threadId }, 30_000);
    expect(Array.isArray(mcp.data), `mcpServer/status/list replied a non-list: ${JSON.stringify(mcp)}`).toBe(true);
    expect(mcp.nextCursor).toBe(null);
  }, 60_000);

  it("three sequential single-key flag pushes coexist; effort/set is accepted and settings/read returns", async () => {
    // (b) COEXISTENCE. `applyFlagSettings` is PER-KEY REPLACEMENT, so a naive implementation that forwards
    // each request verbatim loses the earlier grant the moment a different key is pushed. Three pushes, then
    // the list: the granted directory must still be there.
    expect((await a.call("thread/directory/add", { threadId, path: grantDir }, 30_000)).ok).toBe(true);
    expect((await a.call("thread/outputStyle/set", { threadId, style: "default" }, 30_000)).ok).toBe(true);
    // (c) effort — the one CLOSED value domain on this surface (probe 102: the engine accepts a bogus level
    // silently, so the wire's enum is the only thing standing between a typo and a setting that reads as
    // applied and is not).
    expect((await a.call("thread/effort/set", { threadId, level: "medium" }, 30_000)).ok).toBe(true);

    const dirs = await a.call("thread/directory/list", { threadId }, 30_000);
    expect(dirs.nextCursor).toBe(null);
    // The cwd row: implicit, always granted, and the row a directory UI renders first.
    expect(dirs.data, `thread/directory/list is missing the cwd row: ${JSON.stringify(dirs.data)}`).toContainEqual({ path: cwd, source: "cwd" });
    // The session grant, still standing after the outputStyle and effort pushes that followed it.
    expect(dirs.data, `the granted directory was clobbered by a later single-key push: ${JSON.stringify(dirs.data)}`).toContainEqual({ path: grantDir, source: "session" });

    const settings = await a.call("thread/settings/read", { threadId }, 30_000);
    expect(settings.settings, "thread/settings/read replied no settings payload").toBeTruthy();
    expect(typeof settings.settings).toBe("object");
  }, 120_000);

  it("turn/start{queue:true} while busy replies queued, is announced to the subscriber, and drains", async () => {
    const markA = a.mark(); const markB = b.mark();
    // Both frames are sent before either reply is awaited. `turnStart` latches `record.busy` synchronously
    // inside the same dispatch, and one WS text frame is one message handled in arrival order — so the
    // second call is guaranteed to meet a busy thread without this test having to bet on a turn's duration.
    const runningP = a.call("turn/start", { threadId, input: "Reply with exactly: anchor-done" }, 30_000);
    const queuedP = a.call("turn/start", { threadId, input: "Reply with exactly: queued-turn-ok", queue: true }, 30_000);
    const running = await runningP;
    const queued = await queuedP;
    expect(running.turn.status).toBe("inProgress");
    expect(queued.queued, `the second turn was not queued: ${JSON.stringify(queued)}`).toBe(true);
    expect(queued.turn.status).toBe("queued");
    expect(queued.position).toBe(1);
    const queuedTurnId = queued.turn.id;
    expect(queuedTurnId).not.toBe(running.turn.id);

    // The subscriber that never made the request still learns the id exists (Task 8's adjudication: without
    // this, another client's first news of the id is a terminal event for a turn it never saw).
    const announced = await b.waitFor("turn/queued on the OTHER client", 20_000, (n) => n.method === "turn/queued" && n.params.turn?.id === queuedTurnId, markB);
    expect(announced.params.threadId).toBe(threadId);
    expect(announced.params.position).toBe(1);

    await a.waitFor("turn/completed (the running turn)", 180_000, (n) => n.method === "turn/completed" && n.params.turn?.id === running.turn.id, markA);
    // The drain: the id minted at ENQUEUE is the id that starts, so a client can correlate its queue row.
    const drained = await a.waitFor("turn/started (the drained turn)", 60_000, (n) => n.method === "turn/started" && n.params.turn?.id === queuedTurnId, markA);
    expect(drained.params.turn.status).toBe("inProgress");
    const done = await a.waitFor("turn/completed (the drained turn)", 180_000, (n) => n.method === "turn/completed" && n.params.turn?.id === queuedTurnId, markA);
    expect(done.params.turn.status).toBe("completed");
  }, 420_000);

  it("turn/steer during a long turn: the turn still completes (STEER-EVIDENCE)", async () => {
    const markA = a.mark();
    // Probe 103b's own prompt shape, and for its own reason: run 1 of that probe was INCONCLUSIVE because a
    // prose-only turn finished before the injection could fire. Sequential Bash sleeps give the turn real
    // wall-clock length to be steered inside of.
    const turn = await a.call("turn/start", {
      threadId,
      input: "Using the Bash tool, run these commands ONE AT A TIME, each as its own separate tool call, in order: `sleep 4 && echo step-A`, then `sleep 4 && echo step-B`, then `sleep 4 && echo step-C`, then `sleep 4 && echo step-D`. After all four, reply with exactly: finished-all-steps",
    }, 30_000);
    const turnId = turn.turn.id;
    expect(turn.turn.status).toBe("inProgress");

    // `turn/steer`'s gate is `busy && turnStartedBroadcast`, and the flag is raised in the same synchronous
    // step that broadcasts turn/started — so waiting for that notification is what makes the steer eligible
    // rather than refused "no turn in flight". Then wait for real output (the probe's "first sign of turn
    // output" + a beat) so the injection lands mid-work rather than before the model has begun.
    await a.waitFor("turn/started (steer target)", 60_000, (n) => n.method === "turn/started" && n.params.turn?.id === turnId, markA);
    await a.waitFor("the first non-prompt item of the steered turn", 120_000,
      (n) => (n.method === "item/started" || n.method === "item/completed") && n.params.turnId === turnId && n.params.item?.type !== "userMessage", markA);
    await delay(1_000);

    const steered = await a.call("turn/steer", { threadId, input: "Do NOT run any more commands. Abandon the remaining steps immediately and reply with exactly one word: steered" }, 30_000);
    expect(steered.ok, "the steer was refused by the wire").toBe(true);

    // THE decisive assertion, and the reason this leg exists at all. `Session.steer` pushes a user message
    // carrying its OWN uuid, and `resultWaiter` treats a present-but-unknown uuid as "no waiter" — so if the
    // engine correlates a steered turn's result frame to the STEER's uuid instead of the prompt's, the
    // turn's promise never settles, `turn/completed` never arrives, and the thread stays busy forever.
    // Probe 103b proved the injection influences the turn but never captured that uuid; this run settles it.
    // Evidence is printed BEFORE the assertion so a failure is still a finding rather than a bare timeout.
    let completed: Notif | undefined;
    let waitError: string | undefined;
    try {
      completed = await a.waitFor("turn/completed (the steered turn)", 240_000, (n) => n.method === "turn/completed" && n.params.turn?.id === turnId, markA);
    } catch (e) { waitError = e instanceof Error ? e.message : String(e); }

    // The wire-side view of what `Session.unmatchedResults` counts: a result frame no waiter claimed leaves
    // the turn with no terminal event and (when the mirror re-push or a settings step is affected) a
    // `warning`. The in-process counter is read too — this test owns the server object, and the counter is
    // the field session.ts's doc comment nominates THIS run to settle.
    const record: any = (server.registry as any).get(threadId);
    const engine: any = record?.session;
    console.log("STEER-EVIDENCE: " + JSON.stringify({
      steeredTurnId: turnId,
      promptUserMessageUuid: promptItemId,
      userMessageItemIdsThisTurn: a.notifications.slice(markA)
        .filter((n) => n.method === "item/completed" && n.params.turnId === turnId && n.params.item?.type === "userMessage")
        .map((n) => n.params.item.id),
      turnCompletedPayload: completed?.params ?? null,
      turnCompletedTimedOut: waitError ?? null,
      warningsSinceSteer: a.since(markA, "warning").map((n) => n.params),
      unmatchedResults: typeof engine?.unmatchedResults === "number" ? engine.unmatchedResults : "unreadable",
      agentTextMentionsSteered: /steered/i.test(agentText(a, markA)),
      agentTextMentionsAllSteps: /finished-all-steps/.test(agentText(a, markA)),
    }, null, 2));

    expect(completed, `the steered turn never completed (${waitError}) — the engine correlated its result frame to the STEER's uuid rather than the prompt's, so Session.resultWaiter matched no waiter and the turn's promise never settled. See STEER-EVIDENCE above and src/session/session.ts's unmatchedResults doc.`).toBeTruthy();
    expect(["completed", "interrupted"], `a steered turn must still reach a terminal turn state: ${JSON.stringify(completed!.params.turn)}`).toContain(completed!.params.turn.status);
  }, 420_000);

  it("thread/compact/start completes and thread/compacted carries an outcome", async () => {
    const markA = a.mark();
    const started = await a.call("thread/compact/start", { threadId }, 30_000);
    // Compaction IS a turn (spec Wave 2), so it claims the turn machinery and reports through it.
    expect(started.turn.status).toBe("inProgress");
    const compactTurnId = started.turn.id;

    const compacted = await a.waitFor("thread/compacted", 240_000, (n) => n.method === "thread/compacted" && n.params.threadId === threadId, markA);
    expect(compacted.params.turnId).toBe(compactTurnId);
    expect(compacted.params.outcome, "thread/compacted carried no outcome").toBeTruthy();
    // The PARSED outcome, not the raw boundary frame: `ok` is present for both verdicts, which is the whole
    // reason this notification moved off the frame router (lifecycle.ts's header).
    expect(typeof compacted.params.outcome.ok, `the outcome is not a parsed CompactOutcome: ${JSON.stringify(compacted.params.outcome)}`).toBe("boolean");

    const done = await a.waitFor("turn/completed (compaction)", 120_000, (n) => n.method === "turn/completed" && n.params.turn?.id === compactTurnId, markA);
    expect(done.params.turn.status).toBe("completed");
  }, 420_000);

  it("thread/fork yields a distinct thread whose thread/read shares item ids with the parent", async () => {
    const parentRead = await a.call("thread/read", { threadId }, 60_000);
    expect(parentRead.data.length, "the parent thread read back an empty transcript").toBeGreaterThan(0);
    const parentRow = (await a.call("thread/list", { cwd, limit: 50 }, 30_000)).data.find((t: any) => t.id === threadId);
    expect(parentRow?.sessionId, "the parent thread never latched a session id").toBeTruthy();

    const markA = a.mark();
    const forked = await a.call("thread/fork", { threadId }, 60_000);
    forkThreadId = forked.thread.id;
    expect(forkThreadId, "the fork reused the parent's thread id").not.toBe(threadId);
    // A store-level COPY: a new session id, the original untouched (sessions/fork.ts) — the branch is a
    // second conversation, not a second view of the same one.
    expect(forked.thread.sessionId, "the fork reused the parent's session id").toBeTruthy();
    expect(forked.thread.sessionId).not.toBe(parentRow.sessionId);
    // A fork is a new THREAD, so watchers hear about it exactly as they did the parent's start.
    await a.waitFor("thread/started (the fork)", 20_000, (n) => n.method === "thread/started" && n.params.thread?.id === forkThreadId, markA);
    await a.call("thread/subscribe", { threadId: forkThreadId }, 30_000);

    const forkRead = await a.call("thread/read", { threadId: forkThreadId }, 60_000);
    expect(forkRead.data.length, "the fork read back an empty transcript").toBeGreaterThan(0);
    const parentIds = new Set(parentRead.data.map((it: any) => it.id));
    const shared = forkRead.data.filter((it: any) => parentIds.has(it.id));
    expect(shared.length, `the fork shares no item ids with its parent — the copy re-minted uuids, so nothing a client rendered from the parent can be correlated to the branch. parent=${JSON.stringify(parentRead.data.map((i: any) => i.id))} fork=${JSON.stringify(forkRead.data.map((i: any) => i.id))}`).toBeGreaterThan(0);
  }, 180_000);

  it("thread/clear on the fork broadcasts thread/rewound{cleared:true}", async () => {
    const markA = a.mark();
    const cleared = await a.call("thread/clear", { threadId: forkThreadId }, 120_000);
    expect(cleared.ok).toBe(true);
    const rewound = await a.waitFor("thread/rewound (cleared)", 30_000, (n) => n.method === "thread/rewound" && n.params.threadId === forkThreadId, markA);
    // `cleared` is the additive tag that separates a clear from a plain rewind on the SAME notification.
    expect(rewound.params.cleared).toBe(true);
    // Explicitly null, never a missing key: a client must read "no id yet", not "field absent".
    expect(rewound.params).toHaveProperty("sessionId");
  }, 180_000);

  it("thread/close both threads, then a clean server shutdown", async () => {
    for (const id of [forkThreadId, threadId]) {
      const markA = a.mark();
      expect((await a.call("thread/close", { threadId: id }, 60_000)).ok).toBe(true);
      const closed = await a.waitFor(`thread/closed (${id})`, 30_000, (n) => n.method === "thread/closed" && n.params.threadId === id, markA);
      expect(closed.params.threadId).toBe(id);
    }
    forkThreadId = ""; threadId = ""; // afterAll must not re-close what this step already closed
    await server.shutdown();
    expect(server.registry.list().length, "a thread survived close + shutdown — its SDK session and its claude child leaked").toBe(0);

    // The safety net (armed in the park leg) must never have fired: every leg after the park ran under
    // bypassPermissions, so a park here would mean the runtime mode change did not reach the engine and the
    // legs above only passed because the net answered for them.
    expect(autoAllowed, `a decision parked under bypassPermissions — the runtime permissionMode change did not take: ${JSON.stringify(autoAllowed)}`).toEqual([]);
  }, 180_000);
});
