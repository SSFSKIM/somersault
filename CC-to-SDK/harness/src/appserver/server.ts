// appserver/server.ts — AppServer dispatcher (spec §3.9): connection gating (initialize), a flat
// method table, per-thread serialization via record.chain, and thread lifecycle (start/resume/
// list/close). Turn/decision/subscribe/read land in Tasks 7-9 on top of this spine.
import { createRequire } from "node:module";
import { z } from "zod/v4";
import { Peer, type PeerSink } from "./peer.js";
import { classify, ERR, type RequestId } from "./rpc.js";
import { Registry, type ThreadRecord, type EngineSession } from "./registry.js";
import { openSession, resumeSession, type OpenSessionConfig } from "../session/index.js";
import { ThreadDecisions, type DecisionEvent } from "./broker.js";
import type { DecisionOutcome, PermissionBroker } from "../permissions/types.js";

const require = createRequire(import.meta.url);
const pkgVersion = (require("../../package.json") as { version: string }).version;
const USER_AGENT = "cc-harness-appserver";

export interface AppServerDeps { sessionFactory?: (config: Record<string, unknown>) => EngineSession }
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

type Handler = (srv: AppServer, ctx: ConnCtx, id: RequestId, params: Record<string, unknown>) => void | Promise<void>;

export class AppServer {
  readonly registry = new Registry();
  private conns = new Map<number, ConnCtx>();
  private decisions = new Map<string, ThreadDecisions>();
  private connSeq = 0;
  private startedAt = Date.now();
  private handlers: Record<string, Handler> = {
    "server/status": (srv, ctx, id) => {
      ctx.peer.reply(id, { uptimeMs: Date.now() - srv.startedAt, threads: srv.registry.list().length, listeners: srv.conns.size });
    },
    "thread/start": async (srv, ctx, id, params) => {
      const parsed = threadStartParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const threadId = srv.registry.mint();
      const dec = srv.makeDecisions(threadId, parsed.data.unattended);
      const config = buildConfig(parsed.data, dec.broker(threadId));
      const factory = srv.deps.sessionFactory ?? ((c: Record<string, unknown>) => openSession(c as OpenSessionConfig));
      const session = factory(config as Record<string, unknown>);
      const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: parsed.data.unattended, busy: false, turnSeq: 0, buffer: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId, createdAt: nowSec() };
      srv.registry.add(record);
      ctx.peer.reply(id, { thread: threadView(record) });
    },
    "thread/resume": async (srv, ctx, id, params) => {
      const parsed = threadResumeParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const threadId = srv.registry.mint();
      const dec = srv.makeDecisions(threadId, parsed.data.unattended);
      const config = buildConfig(parsed.data, dec.broker(threadId));
      const factory = srv.deps.sessionFactory ?? ((c: Record<string, unknown>) => resumeSession(parsed.data.sessionId, c as OpenSessionConfig));
      const session = factory(config as Record<string, unknown>);
      const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: parsed.data.unattended, busy: false, turnSeq: 0, buffer: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId ?? parsed.data.sessionId, createdAt: nowSec() };
      srv.registry.add(record);
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
          await record.session.dispose();
          srv.decisions.get(record.id)?.teardown();
          srv.decisions.delete(record.id);
          srv.registry.delete(record.id);
          ctx.peer.reply(id, { ok: true });
        } catch (e) {
          srv.decisions.get(record.id)?.teardown();
          srv.decisions.delete(record.id);
          srv.registry.delete(record.id); // engine is gone either way from the server's POV — don't leak the record on a failed dispose
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
      if (outcome.kind === "deny" && parsed.data.abortTurn) await record.session.interrupt();
      ctx.peer.reply(id, { ok: true });
    },
  };

  constructor(private opts: { token?: string } = {}, private deps: AppServerDeps = {}) {}

  /** Mints this thread's decision broker. `unattended` is captured at thread/start time (spec: the
   *  brief's `unattended` field is set once per thread, not renegotiated per-request). */
  private makeDecisions(threadId: string, unattended: "park" | "deny"): ThreadDecisions {
    const dec = new ThreadDecisions(
      (ev) => this.broadcastDecision(threadId, ev),
      () => unattended,
      () => this.hasWatchers(),
    );
    this.decisions.set(threadId, dec);
    return dec;
  }

  /** Interim definition (until Task 9's thread/subscribe tightens this to real per-thread subscribers,
   *  spec §7): at least one initialized connection anywhere on the server — every initialized peer
   *  currently receives every thread's decision broadcasts, so any one of them IS a watcher. */
  private hasWatchers(): boolean {
    for (const c of this.conns.values()) if (c.initialized) return true;
    return false;
  }

  /** Broadcast one small helper (spec) — Task 9 narrows this to `record.subscribers` without touching
   *  the call sites in `broker.ts`/the handlers above. */
  private broadcastDecision(threadId: string, ev: DecisionEvent): void {
    for (const c of this.conns.values()) {
      if (!c.initialized) continue;
      if (ev.type === "requested") c.peer.notify("decision/requested", { threadId, decision: ev.entry });
      else c.peer.notify("decision/resolved", { threadId, toolUseId: ev.toolUseID, by: ev.by, answer: ev.outcome });
    }
  }

  connect(sink: PeerSink): { peer: Peer; feed(chunk: string): void; close(): void } {
    const connId = ++this.connSeq;
    const peer = new Peer(sink);
    const ctx: ConnCtx = { peer, initialized: false, authed: false, connId };
    this.conns.set(connId, ctx);
    const feed = (chunk: string) => peer.feed(chunk, (frame) => this.onFrame(ctx, frame));
    const close = () => { this.conns.delete(connId); sink.end(); };
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
    if (this.opts.token) {
      if (parsed.data.authorization !== "Bearer " + this.opts.token) { ctx.peer.replyError(id, ERR.UNAUTHENTICATED, "Invalid token"); return; }
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
      if (this.opts.token) ctx.peer.replyError(id, ERR.UNAUTHENTICATED, "Not authenticated");
      else ctx.peer.replyError(id, ERR.INVALID_REQUEST, "Not initialized");
      return;
    }
    const handler = this.handlers[method];
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
