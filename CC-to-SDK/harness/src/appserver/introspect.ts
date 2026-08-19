// appserver/introspect.ts — Task 10: the five introspection reads (spec Wave 1). Each is a thin
// projection of one optional EngineSession method (registry.ts) onto the wire, all `threadIdParams`,
// replying the engine's value verbatim under one named key. `thread/capabilities/read`'s reply shape is
// also the payload a `thread/capabilities/changed` ping tells clients to re-read.
//
// UN-CHAINED, deliberately: unlike settings.ts's setters, none of these go through `record.chain`. A
// read is read-only — queuing it behind a running turn (or a pending setter) would make a dashboard
// unusable exactly when it is most needed, mid-turn. Task 3's dispatch guard already answers a dead
// engine (-33005) before any handler runs, so these need no isEnded() check of their own.
//
// A missing optional method (an engine that does not implement it — the DI-fake-shaped case the
// structural EngineSession interface exists for) replies -32601 METHOD_NOT_FOUND, never a crash and
// never a generic internal error: the interface declares these optional precisely because a future
// non-inProcess engine will not have them.
//
// No handler-local try/catch: unlike settings.ts's setters (deferred inside `record.chain`, so a
// rejection there would otherwise become an unhandled rejection detached from dispatch()), these
// handlers are plain `async` functions `dispatch()` awaits directly — a rejecting engine call propagates
// straight into dispatch()'s own try/catch, which already replies ERR.INTERNAL. Duplicating that here
// would just be the same error reply written twice.
import { ERR } from "./rpc.js";
import type { EngineSession, ThreadRecord } from "./registry.js";
import type { AppServer, Handler } from "./server.js";
import { threadIdParams } from "./schema/core.js";

/** Builds one read handler: parse -> find the record -> find the optional method on its engine (-32601
 *  if absent) -> await it -> reply `{ [key]: value }`. All five methods below are this same shape, so
 *  it lives in exactly one place rather than being copy-pasted five times with a different key each.
 *
 *  `extra` (M5 Task 13) is how ONE of the five adds a field this server derived rather than relayed. It is
 *  a function of the RECORD, not of the engine's value, and it returns the whole key/value pair or nothing
 *  — which is what makes "absent key" expressible at all: a builder returning `{terminalSlashCommands:
 *  undefined}` would put the key on the wire carrying `null` once serialized, and `null` is a different
 *  claim from "the engine never said". */
function makeRead(key: string, pick: (s: EngineSession) => (() => Promise<unknown>) | undefined, extra?: (record: ThreadRecord) => Record<string, unknown> | undefined): Handler {
  return async (srv: AppServer, ctx, id, params) => {
    const parsed = threadIdParams.safeParse(params);
    if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
    const record = srv.registry.get(parsed.data.threadId);
    if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
    const fn = pick(record.session);
    if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, "unsupported by this engine"); return; }
    const value = await fn();
    ctx.peer.reply(id, { [key]: value, ...(extra?.(record) ?? {}) });
  };
}

/** The one read with a second field (M5 Task 13, spec D-M5-22): `terminalSlashCommands`, latched off the
 *  engine's `system/init` frames by `router.ts`'s `routeTerminalCommands`. It rides HERE rather than on
 *  its own method because it answers the same question this reply already answers — what can this client
 *  offer the user — and a remote/web UI reading `commands` needs to know which of them only a terminal can
 *  run. Beside the engine's payload, never merged into it: `capabilities` stays the verbatim engine value.
 *  Absent until an init frame carries it (`schema/introspect.ts` publishes the three states). */
export const capabilitiesRead = makeRead(
  "capabilities",
  (s) => s.capabilities?.bind(s),
  (record) => (record.terminalSlashCommands ? { terminalSlashCommands: record.terminalSlashCommands } : undefined),
);
export const contextUsageRead = makeRead("contextUsage", (s) => s.getContextUsage?.bind(s));
export const usageRead = makeRead("usage", (s) => s.usage?.bind(s));
export const initRead = makeRead("init", (s) => s.initializationResult?.bind(s));
// account/read is server-scoped in name only — params are still { threadId } (deliberate: the account is
// read through a thread's engine; there is no engine off-thread in M2, and M3's fleet origins are the
// first case that could ever change this).
export const accountRead = makeRead("account", (s) => s.accountInfo?.bind(s));
