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
//
// THREE of the four mutations change the capabilities mirror: `mcpServers` is one of the four catalogs
// `thread/capabilities/read` replies (registry.ts's `capabilities()`), so reconnect/toggle/set each ping
// `thread/capabilities/changed` on success — the standing rule at registry.ts:56, emitted the same way
// lifecycle.ts's reinitialize and router.ts's routeCapabilities emit it (a bare `{threadId}` ping;
// clients re-read, the payload never carries the catalog). `permissionModeOverride/set` does NOT ping —
// it moves a rules-layer knob that the capabilities payload does not carry — and neither does the read.
//
// THE THREE STATE-CARRYING MUTATIONS ALSO ACCUMULATE (fix wave 1). `toggle`, `set` and the override each
// leave a lasting fact about this thread's topology, and an engine swap (rewind.ts's `swapEngine`, reached
// by both `thread/rewind` and `thread/clear`) rebuilds the engine from `record.config` — so without a
// record of what was pushed, every swap silently reverts the thread to its launch topology. Each therefore
// writes registry.ts's MCP accumulator (`mcpServersSet`/`mcpToggles`/`mcpOverrides`) which
// `repushThreadState` replays onto the replacement, and each writes it ONLY AFTER the engine accepted,
// exactly as settingsOps.ts's flag layer does and for the same reason: the accumulator is what the swap
// seam replays, so a phantom row is a push no client made and no engine approved. `reconnect` is the one
// that accumulates NOTHING — it is a transient action against a topology it does not change.
//
// Every handler resolves its engine method FIRST and answers -32601 when it is absent, the same
// convention introspect.ts:36 uses: `EngineSession` declares these optional because a future non-
// inProcess engine will not have them, and an optional-call (`?.()`) that silently succeeds would reply
// `{ok:true}` for work no engine ever did (and, for `set`, reply a bare `undefined` — a result-less
// frame this codebase's own `classify()` scores `invalid`, so the caller's request never settles).
import { ERR } from "./rpc.js";
import { replyEngineThrow } from "./engineThrow.js";
import type { AppServer, Handler } from "./server.js";
import { mcpStatusParams, mcpNameParams, mcpToggleParams, mcpSetParams, mcpOverrideParams } from "./schema/mcp.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors settings.ts/rewind.ts — registry.ts's `updatedAt` is unix seconds, not ms

const UNSUPPORTED = "unsupported by this engine"; // introspect.ts:36's exact wording — one string, four call sites

/** The ping the three topology-changing mutations owe their subscribers (registry.ts:56). Payload is the
 *  bare `{threadId}` — identical to lifecycle.ts:74 and router.ts's routeCapabilities — and it is sent
 *  AFTER the reply, mirroring lifecycle.ts's reinitialize (the one existing reply-and-ping handler). */
function pingCapabilities(srv: AppServer, threadId: string): void {
  srv.broadcast(threadId, "thread/capabilities/changed", { threadId });
}

export const mcpStatusList: Handler = async (srv, ctx, id, params) => {
  const parsed = mcpStatusParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const fn = record.session.mcpServerStatus?.bind(record.session);
  if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
  const data = await fn();
  ctx.peer.reply(id, { data, nextCursor: null });
};

export const mcpReconnect: Handler = (srv, ctx, id, params) => {
  const parsed = mcpNameParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    // Resolved INSIDE the chain, not at arrival: M2b's rewind swaps `record.session` for a rebuilt engine,
    // so the engine that will actually serve this op is the one live when the chain reaches it.
    const fn = record.session.reconnectMcpServer?.bind(record.session);
    if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
    try {
      await fn(parsed.data.name);
      record.updatedAt = nowSec();
      ctx.peer.reply(id, { ok: true });
      pingCapabilities(srv, record.id); // a reconnect changes the server's live status catalog
    } catch (e) {
      // SDK-type servers throw here — the caller's request, not this server's fault.
      replyEngineThrow(record, ctx, id, e, ERR.INVALID_PARAMS);
    }
  });
};

export const mcpToggle: Handler = (srv, ctx, id, params) => {
  const parsed = mcpToggleParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    const fn = record.session.toggleMcpServer?.bind(record.session);
    if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
    try {
      await fn(parsed.data.name, parsed.data.enabled);
      // COMMIT-AFTER-ACCEPT — see the module header. NOT on a fleet thread (M3 §1b, Task 10): the
      // accumulator exists to be REPLAYED by `repushThreadState` across a local engine swap, and this
      // origin never performs one (the host owns its engine and replays its own state across its own
      // swaps). A row written here would be state this server keeps, can never use, and would hand to a
      // replay path that only ever runs for the other origin.
      if (record.origin !== "fleet") record.mcpToggles[parsed.data.name] = parsed.data.enabled;
      record.updatedAt = nowSec();
      ctx.peer.reply(id, { ok: true });
      pingCapabilities(srv, record.id); // an enabled/disabled server is a different capabilities catalog
    } catch (e) {
      // Same throw mapping as reconnect — toggle(true) throws for SDK-type servers too.
      replyEngineThrow(record, ctx, id, e, ERR.INVALID_PARAMS);
    }
  });
};

/** M7: what a thread that DECLARED tools hears instead. `setMcpServers` replaces the server set wholesale,
 *  and the servers a declaration is published under are in it — accepting this would leave the model still
 *  being offered `mcp__<namespace>__<tool>` names with nothing behind them, and the accumulator would then
 *  replay that same amputated set across every later engine swap. Refused rather than silently merged: the
 *  overlay is the server's, and a client cannot be told it replaced a set that it did not. */
export const DYNAMIC_TOOLS_DECLARED = "thread declared dynamic tools; mcpServer/set would drop the servers they are published under";

export const mcpSet: Handler = (srv, ctx, id, params) => {
  const parsed = mcpSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // Synchronously, before the chain — this is a statement about the THREAD, not about anything its engine
  // might answer, so there is nothing to wait behind.
  if (record.dynamicTools?.length) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, DYNAMIC_TOOLS_DECLARED); return; }
  // inProcess-only: the host wire has no op for a wholesale server-set replacement (nor for the rules-layer
  // override below), so a fleet thread is refused -33006 by the dispatch-level origin gate (registry.ts's
  // FLEET_UNSUPPORTED) before this handler runs. The live topology reads/reconnect/toggle above DO have
  // host ops and stay allowed for both origins.
  record.chain = record.chain.then(async () => {
    const fn = record.session.setMcpServers?.bind(record.session);
    if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
    try {
      const receipt = await fn(parsed.data.servers);
      // COMMIT-AFTER-ACCEPT, and only what the engine ACCEPTED (final review R9, refining F7). A partial
      // accept reports per-server `errors`; storing the whole REQUEST would let a later swap's
      // `repushThreadState` replay a server the engine rejected. Exclude the errored names so the
      // accumulator reflects added/retained reality. Defensive on the receipt shape: an absent or non-object
      // `errors` excludes nothing rather than crashing.
      const errorsObj = (receipt as { errors?: unknown }).errors;
      const errored = errorsObj && typeof errorsObj === "object" ? new Set(Object.keys(errorsObj as Record<string, unknown>)) : undefined;
      record.mcpServersSet = errored && errored.size
        ? Object.fromEntries(Object.entries(parsed.data.servers).filter(([name]) => !errored.has(name)))
        : parsed.data.servers;
      // Prune the two refining maps by what the SDK ACTUALLY removed — `receipt.removed` — NOT by absence
      // from the request (external review F7). `setMcpServers` only drops dynamically-added servers, so a
      // plugin/settings-owned server omitted from this request is RETAINED by the SDK; deleting its
      // toggle/override on absence alone would drop a refinement that still applies, and the next swap's
      // `repushThreadState` would silently revert that retained server to its launch state. Defensive on the
      // receipt shape: an absent or non-array `removed` prunes nothing rather than crashing.
      const removed = Array.isArray((receipt as { removed?: unknown }).removed) ? new Set((receipt as { removed: string[] }).removed) : undefined;
      if (removed) {
        for (const name of Object.keys(record.mcpToggles)) if (removed.has(name)) delete record.mcpToggles[name];
        for (const name of Object.keys(record.mcpOverrides)) if (removed.has(name)) delete record.mcpOverrides[name];
      }
      record.updatedAt = nowSec();
      ctx.peer.reply(id, receipt); // the engine's {added, removed, errors} receipt, verbatim
      pingCapabilities(srv, record.id); // wholesale replacement of the server set — the biggest catalog change of the three
    } catch (e) {
      // -32603 rather than reconnect/toggle's -32602: `setMcpServers` has no SDK-type refusal to relay, so
      // a throw from a live engine really is an internal failure.
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
    }
  });
};

export const mcpPermissionModeOverrideSet: Handler = (srv, ctx, id, params) => {
  const parsed = mcpOverrideParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // inProcess-only for the same reason as mcpSet above: no host op, so the dispatch-level origin gate
  // refuses a fleet thread -33006 before this handler runs.
  record.chain = record.chain.then(async () => {
    const fn = record.session.setMcpPermissionModeOverride?.bind(record.session);
    if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
    try {
      await fn(parsed.data.name, parsed.data.mode);
      // COMMIT-AFTER-ACCEPT, with the schema's required-but-nullable `mode` read as it is defined: a null
      // CLEARS the pin, so it DELETES the row rather than storing a null a replay would push back.
      if (parsed.data.mode === null) delete record.mcpOverrides[parsed.data.name];
      else record.mcpOverrides[parsed.data.name] = parsed.data.mode;
      record.updatedAt = nowSec();
      // NO thread/capabilities/changed ping: this is the rules layer (probe 49), and the capabilities
      // payload carries no per-server permission override — nothing a client would re-read has changed.
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
    }
  });
};
