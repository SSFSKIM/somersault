// appserver/settings.ts — Task 9: the four settings setters (spec Wave 1). These are the `source:
// "client"` leg of the same `thread/settings/changed` notification router.ts's frame router emits as the
// `source: "engine"` leg (router.ts's routeSettingsMirror) — one shape, all three mirrored knobs
// (model/permissionMode/thinkingTokens), never a partial diff.
//
// Write-back is the mirror's ONLY reliable source (router.ts's header comment: a keyed live run found
// zero engine-sourced settings notifications across a complete real turn). So every handler below awaits
// the engine call FIRST — a rejected setter must not write record.settings and must not broadcast, since
// the engine kept its old value and nothing later would correct a lie.
//
// All four go through record.chain so a setter never interleaves with a turn's submit (same pattern as
// turns.ts's turn/start and server.ts's thread/close).
import { ERR } from "./rpc.js";
import { resolveAutoModel } from "../config/autoModel.js";
import { thinkBudget } from "../tui/thinkLevels.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer, Handler } from "./server.js";
import { modelSetParams, permissionModeSetParams, thinkingSetParams, settingsApplyParams } from "./schema/settings.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors router.ts's own nowSec — registry.ts's `updatedAt` is unix seconds, not ms

/** The one `thread/settings/changed` shape every leg emits — router.ts's routeSettingsMirror builds the
 *  identical payload for the engine leg; this is its client-leg twin. Full post-update record.settings
 *  snapshot, never a partial diff ("one shape, all three knobs", spec Wave 1). */
function broadcastSettings(srv: AppServer, record: ThreadRecord): void {
  srv.broadcast(record.id, "thread/settings/changed", {
    threadId: record.id,
    source: "client",
    model: record.settings.model,
    permissionMode: record.settings.permissionMode,
    thinkingTokens: record.settings.thinkingTokens,
  });
}

function replyError(ctx: { peer: { replyError(id: unknown, code: number, message: string): void } }, id: unknown, e: unknown): void {
  ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
}

export const modelSet: Handler = (srv, ctx, id, params) => {
  const parsed = modelSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    try {
      // model: null -> session.setModel(undefined) (SDK: reset to default; mirror stores undefined).
      const model = parsed.data.model ?? undefined;
      await record.session.setModel?.(model);
      record.settings.model = model;
      record.updatedAt = nowSec();
      broadcastSettings(srv, record);
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyError(ctx, id, e);
    }
  });
};

export const permissionModeSet: Handler = (srv, ctx, id, params) => {
  const parsed = permissionModeSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const mode = parsed.data.mode;
  record.chain = record.chain.then(async () => {
    try {
      // `auto` re-runs the exact self-heal src/config/resolveOptions.ts:62 applies at session-open time —
      // `auto` is MODEL-GATED (Opus 4.6+/Sonnet 4.6); an unsupported mirrored model would silently fall
      // back to `default` on the engine (probe 18d) unless nudged onto a supported model first.
      if (mode === "auto") {
        const healed = resolveAutoModel(record.settings.model);
        if (healed !== record.settings.model) {
          await record.session.setModel?.(healed);
          record.settings.model = healed;
        }
      }
      await record.session.setPermissionMode?.(mode);
      record.settings.permissionMode = mode;
      record.updatedAt = nowSec();
      // source:"client" always — even when this leg also healed the model, the CLIENT's permissionMode
      // request caused the change; no engine decided anything (spec Wave 1, unit-pinned per the brief).
      broadcastSettings(srv, record);
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyError(ctx, id, e);
    }
  });
};

export const thinkingSet: Handler = (srv, ctx, id, params) => {
  const parsed = thinkingSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const data = parsed.data as { threadId: string; level?: string; maxTokens?: number | null };
  const record = srv.registry.get(data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.chain = record.chain.then(async () => {
    try {
      // `level` resolves through the shared thinkBudget table (src/tui/thinkLevels.ts — "off" is already
      // budget 0 there, so no separate special-casing is needed); `maxTokens` passes through raw.
      const resolved: number | null = "level" in data ? thinkBudget(data.level!) : (data.maxTokens as number | null);
      await record.session.setMaxThinkingTokens?.(resolved);
      record.settings.thinkingTokens = resolved ?? undefined;
      record.updatedAt = nowSec();
      broadcastSettings(srv, record);
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyError(ctx, id, e);
    }
  });
};

export const settingsApply: Handler = (srv, ctx, id, params) => {
  const parsed = settingsApplyParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // inProcess-only by nature in M2 (every thread is inProcess) — no origin check needed yet. M3's fleet-
  // adopted threads land the -33006 UNSUPPORTED_FOR_ORIGIN refusal here (rpc.ts already reserves the code).
  record.chain = record.chain.then(async () => {
    try {
      await record.session.applyFlagSettings?.(parsed.data.settings);
      // No mirror field for arbitrary flag settings (not one of the three mirrored knobs) and no
      // thread/settings/changed broadcast — the brief's literal handler behavior for this method.
      record.updatedAt = nowSec();
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyError(ctx, id, e);
    }
  });
};
