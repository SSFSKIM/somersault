// appserver/fanout.ts — server-scoped notification fan-out (spec Wave 0, D-M2-5): thread-EXISTENCE
// events go to connections that opted in via initialize{watchThreads:true}. Orthogonal to
// record.subscribers (thread-scoped). Broadcast-to-all would leak thread existence to clients that
// never asked; per-thread subscribers structurally cannot receive thread/started.
import type { Peer } from "./peer.js";
import type { ConnCtx } from "./server.js";

export function broadcastToWatchers(conns: Iterable<ConnCtx>, method: string, params: Record<string, unknown>): void {
  for (const ctx of conns) {
    if (!ctx.watchThreads) continue;
    try { ctx.peer.notify(method, params); } catch { /* one watcher's failure is not another's */ }
  }
}

/** The few events that belong to BOTH scopes at once — a thread this client is watching just stopped
 *  being what it was (`thread/closed`, M2b's `thread/rewound`). Deduped by Peer identity: a connection
 *  that is both a subscriber and a watcher must receive exactly one frame, not two. `watchers` is already
 *  filtered (AppServer.watchers()), unlike broadcastToWatchers' raw connection list. */
export function broadcastToSubscribersAndWatchers(
  subscribers: Iterable<Peer>, watchers: Iterable<ConnCtx>, method: string, params: Record<string, unknown>,
): void {
  const targets = new Set<Peer>(subscribers);
  for (const ctx of watchers) targets.add(ctx.peer);
  for (const peer of targets) { try { peer.notify(method, params); } catch { /* one target's failure is not another's */ } }
}
