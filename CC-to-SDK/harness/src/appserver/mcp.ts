// appserver/mcp.ts — M2b Wave 3: the MCP quintet (mcpServer/status/list, reconnect, toggle, set,
// permissionModeOverride/set). Status is a read — un-chained, mirroring introspect.ts's convention (a
// poll must not queue behind whatever else the thread has in flight, and a missing optional method means
// "this engine doesn't implement MCP topology", -32601, never a crash). The four mutations are
// chain-scoped, mirroring settings.ts: record.chain serializes each against the others and against every
// other chain-scoped op on the same thread.
//
// reconnect/toggle THROW for SDK-type servers ("SDK servers should be handled in print.ts" — session.ts's
// own doc comment: they are caller-owned and need no subprocess restart). Spec Wave 3: that throw
// surfaces as a -32602-class method error carrying the SDK's message verbatim — the caller asked for an
// operation this server topology cannot perform, not something the appserver itself got wrong, so it is
// scored like a bad request rather than an internal failure.
//
// `permissionModeOverride/set` is RULES-LAYER only (probe 49): the override resolves but does not by
// itself silence a canUseTool broker — a disabled/overridden server can still be re-consulted through the
// broker on the next tool call. Callers that want a hard boundary gate with permissions, not this knob.
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { mcpStatusParams, mcpNameParams, mcpToggleParams, mcpSetParams, mcpOverrideParams } from "./schema/mcp.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors settings.ts/rewind.ts — registry.ts's `updatedAt` is unix seconds, not ms

function replyError(ctx: { peer: { replyError(id: unknown, code: number, message: string): void } }, id: unknown, code: number, e: unknown): void {
  ctx.peer.replyError(id, code, e instanceof Error ? e.message : String(e));
}

export const mcpStatusList: Handler = async (srv, ctx, id, params) => {
  const parsed = mcpStatusParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const fn = record.session.mcpServerStatus?.bind(record.session);
  if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, "unsupported by this engine"); return; }
  const data = await fn();
  ctx.peer.reply(id, { data, nextCursor: null });
};

export const mcpReconnect: Handler = (srv, ctx, id, params) => {
  const parsed = mcpNameParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    try {
      await record.session.reconnectMcpServer?.(parsed.data.name);
      record.updatedAt = nowSec();
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      // SDK-type servers throw here — the caller's request, not this server's fault.
      replyError(ctx, id, ERR.INVALID_PARAMS, e);
    }
  });
};

export const mcpToggle: Handler = (srv, ctx, id, params) => {
  const parsed = mcpToggleParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    try {
      await record.session.toggleMcpServer?.(parsed.data.name, parsed.data.enabled);
      record.updatedAt = nowSec();
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      // Same throw mapping as reconnect — toggle(true) throws for SDK-type servers too.
      replyError(ctx, id, ERR.INVALID_PARAMS, e);
    }
  });
};

export const mcpSet: Handler = (srv, ctx, id, params) => {
  const parsed = mcpSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    try {
      const receipt = await record.session.setMcpServers?.(parsed.data.servers);
      record.updatedAt = nowSec();
      ctx.peer.reply(id, receipt); // the engine's {added, removed, errors} receipt, verbatim
    } catch (e) {
      replyError(ctx, id, ERR.INTERNAL, e);
    }
  });
};

export const mcpPermissionModeOverrideSet: Handler = (srv, ctx, id, params) => {
  const parsed = mcpOverrideParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    try {
      await record.session.setMcpPermissionModeOverride?.(parsed.data.name, parsed.data.mode);
      record.updatedAt = nowSec();
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyError(ctx, id, ERR.INTERNAL, e);
    }
  });
};
