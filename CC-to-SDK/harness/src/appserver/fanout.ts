// appserver/fanout.ts — server-scoped notification fan-out (spec Wave 0, D-M2-5): thread-EXISTENCE
// events go to connections that opted in via initialize{watchThreads:true}. Orthogonal to
// record.subscribers (thread-scoped). Broadcast-to-all would leak thread existence to clients that
// never asked; per-thread subscribers structurally cannot receive thread/started.
import type { ConnCtx } from "./server.js";

export function broadcastToWatchers(conns: Iterable<ConnCtx>, method: string, params: Record<string, unknown>): void {
  for (const ctx of conns) {
    if (!ctx.watchThreads) continue;
    try { ctx.peer.notify(method, params); } catch { /* one watcher's failure is not another's */ }
  }
}
