// appserver/engineThrow.ts — the one -33005 re-check every chain-deferred mutation owes its caller.
//
// A handler body deferred into `record.chain` runs LATER than dispatch's arrival-time -33005 gate
// (server.ts's `engineGoneCode`), so the engine can die while the op waits its turn — and the throw that
// follows is not the caller's fault. Re-check `isEnded()` first, with dispatch's own wording, so a client
// sees ONE -33005 message whichever path produced it.
//
// `aliveCode` is the mapping each cluster keeps for a throw from an engine that is still ALIVE, and the
// two in use say different things: -32603 for a genuine internal failure (the engine's own errors here are
// untyped strings, and message-matching to re-class them is what spec Wave 0 forbids), -32602 where the
// engine is refusing the REQUEST rather than failing at it (mcp.ts's reconnect/toggle against an SDK-type
// server). The re-check NARROWS that class; it never replaces it.
import { ERR, type RequestId } from "./rpc.js";
import type { ThreadRecord } from "./registry.js";
import type { ConnCtx } from "./server.js";

export function replyEngineThrow(record: ThreadRecord, ctx: ConnCtx, id: RequestId, e: unknown, aliveCode: number): void {
  if (record.session.isEnded?.()) { ctx.peer.replyError(id, ERR.ENGINE_GONE, "Engine is gone (session ended)"); return; }
  ctx.peer.replyError(id, aliveCode, e instanceof Error ? e.message : String(e));
}
