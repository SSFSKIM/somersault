// appserver/server.ts — AppServer dispatcher (spec §3.9): connection gating (initialize), a flat
// method table, per-thread serialization via record.chain, and thread lifecycle (start/resume/
// list/close). Turn/decision/subscribe/read land in Tasks 7-9 on top of this spine.
import { createRequire } from "node:module";
import { z } from "zod/v4";
import { Peer, type PeerSink } from "./peer.js";
import { classify, ERR, type RequestId } from "./rpc.js";
import { Registry, type ThreadRecord, type EngineSession } from "./registry.js";
import { openSession, resumeSession, type OpenSessionConfig } from "../session/index.js";

const require = createRequire(import.meta.url);
const pkgVersion = (require("../../package.json") as { version: string }).version;
const USER_AGENT = "cc-harness-appserver";

export interface AppServerDeps { sessionFactory?: (config: Record<string, unknown>) => EngineSession }
export interface ConnCtx { peer: Peer; initialized: boolean; authed: boolean; clientName?: string; connId: number }

const initializeParams = z.object({ clientInfo: z.object({ name: z.string() }).passthrough(), authorization: z.string().optional() }).passthrough();
const threadStartParams = z.object({ config: z.record(z.string(), z.unknown()).optional(), unattended: z.enum(["park", "deny"]).default("park") });
const threadResumeParams = z.object({ sessionId: z.string().min(1), config: z.record(z.string(), z.unknown()).optional(), unattended: z.enum(["park", "deny"]).default("park") });
const threadIdParams = z.object({ threadId: z.string().min(1) });

function threadView(r: ThreadRecord): Record<string, unknown> {
  return { id: r.id, origin: r.origin, sessionId: r.sessionId, status: r.busy ? "active" : "idle", createdAt: r.createdAt };
}

/** The one seam thread/start and thread/resume both build their engine config through — kept
 *  deliberately thin so Task 7 can extend it to inject a canUseTool broker (keyed off `unattended`)
 *  without restructuring the dispatch table. */
function buildConfig(parsed: { config?: Record<string, unknown>; unattended: "park" | "deny" }): OpenSessionConfig {
  return { ...(parsed.config as OpenSessionConfig | undefined) };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

type Handler = (srv: AppServer, ctx: ConnCtx, id: RequestId, params: Record<string, unknown>) => void | Promise<void>;

export class AppServer {
  readonly registry = new Registry();
  private conns = new Map<number, ConnCtx>();
  private connSeq = 0;
  private startedAt = Date.now();
  private handlers: Record<string, Handler> = {
    "server/status": (srv, ctx, id) => {
      ctx.peer.reply(id, { uptimeMs: Date.now() - srv.startedAt, threads: srv.registry.list().length, listeners: srv.conns.size });
    },
    "thread/start": async (srv, ctx, id, params) => {
      const parsed = threadStartParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const config = buildConfig(parsed.data);
      const factory = srv.deps.sessionFactory ?? ((c: Record<string, unknown>) => openSession(c as OpenSessionConfig));
      const session = factory(config as Record<string, unknown>);
      const record: ThreadRecord = { id: srv.registry.mint(), origin: "inProcess", session, unattended: parsed.data.unattended, busy: false, turnSeq: 0, buffer: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId, createdAt: nowSec() };
      srv.registry.add(record);
      ctx.peer.reply(id, { thread: threadView(record) });
    },
    "thread/resume": async (srv, ctx, id, params) => {
      const parsed = threadResumeParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const config = buildConfig(parsed.data);
      const factory = srv.deps.sessionFactory ?? ((c: Record<string, unknown>) => resumeSession(parsed.data.sessionId, c as OpenSessionConfig));
      const session = factory(config as Record<string, unknown>);
      const record: ThreadRecord = { id: srv.registry.mint(), origin: "inProcess", session, unattended: parsed.data.unattended, busy: false, turnSeq: 0, buffer: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId ?? parsed.data.sessionId, createdAt: nowSec() };
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
          srv.registry.delete(record.id);
          ctx.peer.reply(id, { ok: true });
        } catch (e) { ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e)); }
      });
    },
  };

  constructor(private opts: { token?: string } = {}, private deps: AppServerDeps = {}) {}

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
    await handler(this, ctx, id, params);
  }
}
