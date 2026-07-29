// appserver/server.ts — AppServer dispatcher (spec §3.9): connection gating (initialize), a flat
// method table, per-thread serialization via record.chain, and thread lifecycle (start/resume/
// list/close). Turn/decision/subscribe/read land in Tasks 7-9 on top of this spine.
import { createRequire } from "node:module";
import { z } from "zod/v4";
import { Peer, type PeerSink } from "./peer.js";
import { classify, ERR, type RequestId } from "./rpc.js";
import { Registry, activeTurnId, type ThreadRecord, type EngineSession } from "./registry.js";
import { openSession, resumeSession, type OpenSessionConfig } from "../session/index.js";
import { ThreadDecisions, type DecisionEvent } from "./broker.js";
import type { DecisionOutcome, PermissionBroker } from "../permissions/types.js";
import type { PendingDecision } from "../permissions/pending.js";
import { turnStart, turnInterrupt, requestInterrupt } from "./turns.js";
import { threadSubscribe, threadUnsubscribe, threadRead } from "./subscribe.js";
import { armPlanUpgrade } from "./planUpgrade.js";

const require = createRequire(import.meta.url);
const pkgVersion = (require("../../package.json") as { version: string }).version;
const USER_AGENT = "cc-harness-appserver";

export interface AppServerDeps { sessionFactory?: (config: Record<string, unknown>) => EngineSession; getSessionMessages?: (sessionId: string) => Promise<unknown[]> }
export interface ConnCtx { peer: Peer; initialized: boolean; authed: boolean; clientName?: string; connId: number }

const initializeParams = z.object({ clientInfo: z.object({ name: z.string() }), authorization: z.string().optional() });
const threadStartParams = z.object({ config: z.record(z.string(), z.unknown()).optional(), unattended: z.enum(["park", "deny"]).default("park") });
const threadResumeParams = z.object({ sessionId: z.string().min(1), config: z.record(z.string(), z.unknown()).optional(), unattended: z.enum(["park", "deny"]).default("park") });
const threadIdParams = z.object({ threadId: z.string().min(1) });

// Mirrors DecisionOutcome (src/permissions/types.ts) and the real host wire (host/ops.ts's
// decisionKind + structuredAnswer) — never trust a client-supplied `by` (spec §6, server-stamped only).
const decisionOutcomeParams = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow_once") }),
  z.object({ kind: z.literal("allow_always") }),
  z.object({ kind: z.literal("deny") }),
  z.object({ kind: z.literal("question_answer"), answers: z.record(z.string(), z.string()), response: z.string().optional() }),
  z.object({ kind: z.literal("plan_approve"), acceptEdits: z.boolean() }),
  z.object({ kind: z.literal("plan_reject"), feedback: z.string().optional() }),
]);
const decisionRespondParams = z.object({ threadId: z.string().min(1), toolUseId: z.string().min(1), answer: decisionOutcomeParams, abortTurn: z.boolean().optional() });

function threadView(r: ThreadRecord): Record<string, unknown> {
  return { id: r.id, origin: r.origin, sessionId: r.sessionId, status: r.busy ? "active" : "idle", createdAt: r.createdAt };
}

/** The one seam thread/start and thread/resume both build their engine config through — extended in
 *  Task 7 to inject the thread's decision broker as the SDK's canUseTool seam. */
function buildConfig(parsed: { config?: Record<string, unknown>; unattended: "park" | "deny" }, broker: PermissionBroker): OpenSessionConfig {
  return { ...(parsed.config as OpenSessionConfig | undefined), permissionBroker: broker };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** `Session.sessionId` is a GETTER that stays undefined until the first turn's system/init frame lands
 *  (session.ts's own doc comment) — the value snapshotted at thread/start is therefore `undefined` for the
 *  whole life of the thread unless something refreshes it, which left thread/read answering an empty page
 *  forever and threadView never reporting an id to resume from. Latch it off the engine's own frame seam
 *  (the one registry.ts declares) rather than at turn boundaries, so a client learns the id mid-first-turn
 *  rather than only after it ends.
 *
 *  Reads the id from the INIT FRAME ITSELF, not only from `session.sessionId`: the read loop invokes frame
 *  callbacks BEFORE it records the id, so a getter-only latch needs a SECOND frame to fire — and a first
 *  turn whose iterator ends (or throws) right after system/init never delivers one, leaving the record's
 *  session id undefined forever (thread/read answers an empty page, and nothing can ever resume it). The
 *  getter stays the primary read, for an engine that latches its id off some other frame. */
function latchSessionId(record: ThreadRecord): void {
  if (record.sessionId) return;
  const off = record.session.onFrame((m) => {
    const f = m as { type?: string; subtype?: string; session_id?: unknown };
    const fromInit = f?.type === "system" && f.subtype === "init" && typeof f.session_id === "string" ? f.session_id : undefined;
    const sid = record.session.sessionId ?? fromInit;
    if (!sid) return;
    record.sessionId = sid;
    off();
  });
}

export type Handler = (srv: AppServer, ctx: ConnCtx, id: RequestId, params: Record<string, unknown>) => void | Promise<void>;

export class AppServer {
  readonly registry = new Registry();
  private conns = new Map<number, ConnCtx>();
  private decisions = new Map<string, ThreadDecisions>();
  private connSeq = 0;
  private startedAt = Date.now();
  private shuttingDown = false; // latched by shutdown(); refuses new thread admission (see shutdown())
  private handlers: Record<string, Handler> = {
    "server/status": (srv, ctx, id) => {
      ctx.peer.reply(id, { uptimeMs: Date.now() - srv.startedAt, threads: srv.registry.list().length, listeners: srv.conns.size });
    },
    "thread/start": async (srv, ctx, id, params) => {
      if (srv.shuttingDown) { ctx.peer.replyError(id, ERR.OVERLOADED, "Server is shutting down"); return; } // see shutdown()
      const parsed = threadStartParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const threadId = srv.registry.mint();
      const dec = srv.makeDecisions(threadId, parsed.data.unattended);
      const config = buildConfig(parsed.data, dec.broker(threadId));
      const factory = srv.deps.sessionFactory ?? ((c: Record<string, unknown>) => openSession(c as OpenSessionConfig));
      const session = factory(config as Record<string, unknown>); // throws synchronously on an invalid config — dec must NOT be registered yet (else it orphans forever, nothing can ever reach it)
      srv.decisions.set(threadId, dec);
      const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: parsed.data.unattended, busy: false, turnSeq: 0, interruptRequested: false, buffer: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId, createdAt: nowSec() };
      srv.registry.add(record);
      latchSessionId(record); // the snapshot above is undefined until the first turn's init frame (see latchSessionId)
      ctx.peer.reply(id, { thread: threadView(record) });
    },
    "thread/resume": async (srv, ctx, id, params) => {
      if (srv.shuttingDown) { ctx.peer.replyError(id, ERR.OVERLOADED, "Server is shutting down"); return; } // see shutdown()
      const parsed = threadResumeParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const threadId = srv.registry.mint();
      const dec = srv.makeDecisions(threadId, parsed.data.unattended);
      const config = buildConfig(parsed.data, dec.broker(threadId));
      const factory = srv.deps.sessionFactory ?? ((c: Record<string, unknown>) => resumeSession(parsed.data.sessionId, c as OpenSessionConfig));
      const session = factory(config as Record<string, unknown>); // same ordering as thread/start: register dec only once the factory hasn't thrown
      srv.decisions.set(threadId, dec);
      const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: parsed.data.unattended, busy: false, turnSeq: 0, interruptRequested: false, buffer: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId ?? parsed.data.sessionId, createdAt: nowSec() };
      srv.registry.add(record);
      latchSessionId(record); // no-op here in practice — resume already knows the id — but keeps one rule for both entry points
      ctx.peer.reply(id, { thread: threadView(record) });
    },
    "thread/list": (srv, ctx, id) => {
      ctx.peer.reply(id, { data: srv.registry.list().map(threadView) });
    },
    "thread/close": async (srv, ctx, id, params) => {
      const parsed = threadIdParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const record = srv.registry.get(parsed.data.threadId);
      if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      record.chain = record.chain.then(async () => {
        try {
          await srv.closeRecord(record);
          ctx.peer.reply(id, { ok: true });
        } catch (e) {
          // the record/decisions are already gone (closeRecord's finally) — the engine is gone from the
          // server's POV either way, so a failed dispose still owes the caller an error, not silence
          ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
        }
      });
    },
    "decision/list": (srv, ctx, id, params) => {
      const parsed = threadIdParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const dec = srv.decisions.get(parsed.data.threadId);
      if (!dec) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      ctx.peer.reply(id, { data: dec.pending() });
    },
    "decision/respond": async (srv, ctx, id, params) => {
      const parsed = decisionRespondParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const record = srv.registry.get(parsed.data.threadId);
      const dec = srv.decisions.get(parsed.data.threadId);
      if (!record || !dec) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      const by = `${ctx.clientName}#${ctx.connId}`; // server-stamped only — a client-supplied `by` is never read (spec §6)
      const outcome = parsed.data.answer as DecisionOutcome;
      const result = dec.respond(parsed.data.toolUseId, outcome, by);
      if (!result.ok) {
        if (result.code === "alreadySettled") ctx.peer.replyError(id, ERR.ALREADY_SETTLED, "Already settled", { by: result.by });
        else ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Answer kind does not match the parked decision's kind");
        return;
      }
      // Settling the broker only releases THIS tool call. `acceptEdits` additionally upgrades the SESSION's
      // permission mode going forward (mirrors host/host.ts's answer -> planUpgradePending): without it the
      // RPC reported {ok:true} while every later edit stayed in the old mode and prompted again.
      if (outcome.kind === "plan_approve" && outcome.acceptEdits) armPlanUpgrade(record);
      // spec §6: EVERY answer variant may carry abortTurn, not just `deny` — and aborting goes through the
      // same flag-then-interrupt path turn/interrupt uses, else the turn it just aborted reports "completed"
      if (parsed.data.abortTurn) await requestInterrupt(record);
      ctx.peer.reply(id, { ok: true });
    },
    "turn/start": turnStart,
    "turn/interrupt": turnInterrupt,
    "thread/subscribe": threadSubscribe,
    "thread/unsubscribe": threadUnsubscribe,
    "thread/read": threadRead,
  };

  private readonly token: string;
  // PRESENCE of the option — not truthiness — is what turns auth on. `token: ""` means "auth configured
  // but holding no usable secret", and must fail every client CLOSED; reading it as "no auth configured"
  // is what turned an empty --token-file into a fully open control plane (C2).
  private readonly authRequired: boolean;

  constructor(opts: { token?: string } = {}, public readonly deps: AppServerDeps = {}) {
    this.authRequired = opts.token !== undefined;
    this.token = opts.token ?? "";
  }

  /** Tear one thread down: settle its parked decisions, dispose the engine, tell the thread's subscribers,
   *  drop the record. Shared by thread/close and shutdown().
   *
   *  ORDER IS LOAD-BEARING (C1): the real Session.dispose() is `input.close(); await this.done`, and
   *  `done` is the read loop — which cannot end while a turn sits blocked inside canUseTool awaiting one of
   *  our parked promises. teardown() is the only thing that settles those promises, so awaiting dispose()
   *  FIRST is a circular wait: thread/close never replies, the record stays busy, no decision/resolved ever
   *  goes out, and record.chain stays pending forever so every later request for the thread hangs too.
   *
   *  Rethrows a failing dispose() (the caller owes its own reply) but still broadcasts + drops the record
   *  in `finally` — the engine is gone from the server's point of view either way. thread/closed goes out
   *  BEFORE the delete, since broadcast() no-ops once the record is out of the registry. */
  private async closeRecord(record: ThreadRecord): Promise<void> {
    this.decisions.get(record.id)?.teardown();
    try {
      await record.session.dispose();
    } finally {
      this.broadcast(record.id, "thread/closed", { threadId: record.id });
      this.decisions.delete(record.id);
      this.registry.delete(record.id);
    }
  }

  /** Process shutdown (the `ccx serve` SIGINT path): settle every parked decision and dispose every live
   *  thread. Without it, closing the listener leaves each SDK session — and its `claude` child process —
   *  running, which also keeps the event loop alive so the first Ctrl-C may not exit at all. One thread's
   *  failing dispose must not abandon the rest, so each is guarded.
   *
   *  LATCHED FIRST, snapshot second: the listener is still accepting frames while this awaits a slow
   *  dispose(), so an admission (thread/start, thread/resume) landing inside that window used to create a
   *  thread that was never in the snapshot and therefore outlived the shutdown — a leaked SDK session and
   *  its `claude` child. `shuttingDown` makes the snapshot un-staleable. The refusal is OVERLOADED
   *  (-32001), not INVALID_REQUEST: nothing about the request is malformed, the SERVER is simply no longer
   *  taking work — the same "try again elsewhere/later" class of answer, and the one existing code whose
   *  meaning is about server capacity rather than about the caller or a specific thread. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(this.registry.list().map((r) => this.closeRecord(r).catch(() => {})));
  }

  /** Mints this thread's decision broker. `unattended` is captured at thread/start time (spec: the
   *  brief's `unattended` field is set once per thread, not renegotiated per-request). Deliberately
   *  does NOT register into `this.decisions` — the session factory the caller feeds this broker into
   *  can still throw synchronously on an invalid config, and a registered-but-never-returned threadId
   *  would orphan forever (nothing can ever reach it to close it). Callers register after the factory
   *  succeeds. */
  private makeDecisions(threadId: string, unattended: "park" | "deny"): ThreadDecisions {
    return new ThreadDecisions(
      (ev) => this.broadcastDecision(threadId, ev),
      () => unattended,
      () => this.hasWatchers(threadId),
    );
  }

  /** Task 9: a watcher is a real subscriber of THIS thread — not just any initialized connection on the
   *  server (the interim Task 7 shim). */
  private hasWatchers(threadId: string): boolean {
    return (this.registry.get(threadId)?.subscribers.size ?? 0) > 0;
  }

  /** The one small broadcast helper (spec) every thread-scoped notification goes through — decisions
   *  (Task 7) and turns/items (Task 8) alike. Task 9: fan-out is `record.subscribers` only, not every
   *  initialized connection on the server. */
  broadcast(threadId: string, method: string, params: Record<string, unknown>): void {
    const record = this.registry.get(threadId);
    if (!record) return;
    // Guarded per subscriber, exactly as session.ts's onFrame loop is: one sink's failure is not another's.
    // Unguarded, a single throwing sink aborted the fan-out to every remaining subscriber — and inside
    // turnStart the throw escapes the chain callback's try (which wraps only submit), rejecting
    // record.chain and wedging the thread the same way C1 did. Not reachable through the `ws` sink today;
    // the stdio/UDS transports the spec names would inherit it (M2).
    for (const peer of record.subscribers) { try { peer.notify(method, params); } catch { /* one subscriber's failure is not another's */ } }
  }

  /** The parked decisions for one thread — subscribe.ts's replay step (spec §5) reads this to hand a
   *  newly-attached client every decision still awaiting an answer. */
  pendingDecisions(threadId: string): PendingDecision[] {
    return this.decisions.get(threadId)?.pending() ?? [];
  }

  private broadcastDecision(threadId: string, ev: DecisionEvent): void {
    // spec §6's payload is {threadId, turnId, decision} — without turnId a UI cannot attach a park to a
    // turn row. Legitimately absent when nothing is in flight (JSON.stringify drops the undefined key).
    if (ev.type === "requested") this.broadcast(threadId, "decision/requested", { threadId, turnId: activeTurnId(this.registry.get(threadId)), decision: ev.entry });
    else this.broadcast(threadId, "decision/resolved", { threadId, toolUseId: ev.toolUseID, by: ev.by, answer: ev.outcome });
  }

  connect(sink: PeerSink): { peer: Peer; feed(chunk: string): void; close(): void } {
    const connId = ++this.connSeq;
    const peer = new Peer(sink);
    const ctx: ConnCtx = { peer, initialized: false, authed: false, connId };
    this.conns.set(connId, ctx);
    const feed = (chunk: string) => peer.feed(chunk, (frame) => this.onFrame(ctx, frame));
    // A closing connection must not leave a dead Peer in any thread's subscriber set (spec: a browser
    // tab closing sweeps every record, not just whichever thread it last touched).
    const close = () => { this.conns.delete(connId); for (const record of this.registry.list()) record.subscribers.delete(peer); sink.end(); };
    return { peer, feed, close };
  }

  private onFrame(ctx: ConnCtx, frame: unknown): void {
    if (frame && typeof frame === "object" && (frame as Record<string, unknown>).__parseError) {
      ctx.peer.replyError(null as unknown as RequestId, ERR.PARSE, "Parse error");
      return;
    }
    const c = classify(frame);
    if (c.kind === "invalid") { ctx.peer.replyError(null as unknown as RequestId, ERR.INVALID_REQUEST, "Invalid request"); return; }
    if (c.kind === "response") return;      // no server->client requests in M1; a client response is unexpected — ignore, never reply-loop
    if (c.kind === "notification") return;  // no notification handlers land in M1; ignore silently (no id to reply to anyway)
    void this.dispatch(ctx, c.id, c.method, c.params ?? {});
  }

  private handleInitialize(ctx: ConnCtx, id: RequestId, params: Record<string, unknown>): void {
    if (ctx.initialized) { ctx.peer.replyError(id, ERR.INVALID_REQUEST, "Already initialized"); return; }
    const parsed = initializeParams.safeParse(params);
    if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
    if (this.authRequired) {
      // `!this.token` first: an empty configured token can never be a valid credential, so it rejects every
      // client rather than matching a bare "Bearer " (C2 — auth on with no secret must fail closed).
      if (!this.token || parsed.data.authorization !== "Bearer " + this.token) { ctx.peer.replyError(id, ERR.UNAUTHENTICATED, "Invalid token"); return; }
      ctx.authed = true;
    }
    ctx.initialized = true;
    ctx.clientName = parsed.data.clientInfo.name;
    ctx.peer.reply(id, { userAgent: USER_AGENT, version: pkgVersion, platformOs: process.platform });
    ctx.peer.notify("initialized", {}); // spec §7: identical to Codex — reply first, notification second, no fields specified
  }

  private async dispatch(ctx: ConnCtx, id: RequestId, method: string, params: Record<string, unknown>): Promise<void> {
    if (method === "initialize") { this.handleInitialize(ctx, id, params); return; }
    if (!ctx.initialized) {
      if (this.authRequired) ctx.peer.replyError(id, ERR.UNAUTHENTICATED, "Not authenticated");
      else ctx.peer.replyError(id, ERR.INVALID_REQUEST, "Not initialized");
      return;
    }
    // OWN-property only: a plain-object lookup answers `toString`/`constructor`/`valueOf` with an INHERITED
    // Object.prototype function, which dispatch then awaits as if it were a handler — so those method names
    // returned no response at all instead of METHOD_NOT_FOUND, hanging the caller.
    const handler = Object.prototype.hasOwnProperty.call(this.handlers, method) ? this.handlers[method] : undefined;
    if (!handler) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, `Unknown method: ${method}`); return; }
    try {
      await handler(this, ctx, id, params);
    } catch (e) {
      // one guard for every current and future handler — a thrown/rejecting handler must still reply,
      // never leave the caller hanging or surface as an unhandled rejection (dispatch is fired `void`)
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    }
  }
}
