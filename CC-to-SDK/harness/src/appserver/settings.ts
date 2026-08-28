// appserver/settings.ts — Task 9's four settings setters (spec Wave 1), plus M8's fifth,
// `thread/crossSessionInbound/set`, at the bottom. These are the `source: "client"` leg of the same
// `thread/settings/changed` notification router.ts's frame router emits as the `source: "engine"` leg
// (router.ts's routeSettingsMirror) — one shape, every knob it carries (model/permissionMode/
// thinkingTokens, and M8's crossSessionInbound), never a partial diff.
//
// Write-back is the mirror's ONLY reliable source (router.ts's header comment: a keyed live run found
// zero engine-sourced settings notifications across a complete real turn). So every handler below awaits
// the engine call FIRST — a rejected setter must not write record.settings and must not broadcast, since
// the engine kept its old value and nothing later would correct a lie.
//
// All four go through record.chain, which serializes their handler BODIES against each other and against
// other chain-scoped ops on the same thread (thread/close, Task 11's thread/reinitialize). It does NOT,
// by itself, wait for an in-flight turn: turns.ts's beginTurn holds its chain slot only until the turn's
// prompt has been DISPATCHED to the engine, never through the turn's own completion (a turn completes via
// settleTurn, not via the chain resolving), so a setter enqueued while a turn is in flight legitimately
// runs concurrently with that turn's submit() — that is intentional here, since a live
// model/permissionMode switch mid-turn is a real, useful feature. What the slot DOES buy is ordering: a
// setter sent after a turn/start reaches the engine after that turn's prompt, even when the prompt had
// input items to resolve (or host bytes to stage) first. Contrast Task 11's thread/reinitialize
// (lifecycle.ts), which DOES busy-gate: its engine call is heavy enough that running it concurrently with
// a live turn is not safe, unlike these four.
import { ERR, type RequestId } from "./rpc.js";
import { applyPeerPolicy, RESERVED_SETTINGS_KEY, SETTINGS_KEY, type CrossSessionInbound } from "./peerPolicy.js";
import { settleAdopted, uninstallPeerInbound } from "./peerInbound.js";
import { replyEngineThrow } from "./engineThrow.js";
import { resolveAutoModel } from "../config/autoModel.js";
import { thinkBudget } from "../tui/thinkLevels.js";
import { ORIGIN_REFUSAL_MESSAGE, settingsChangedPayload, type ThreadRecord } from "./registry.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import { modelSetParams, permissionModeSetParams, thinkingSetParams, settingsApplyParams } from "./schema/settings.js";
import { crossSessionInboundSetParams } from "./schema/peer.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors router.ts's own nowSec — registry.ts's `updatedAt` is unix seconds, not ms

/** The client leg of `thread/settings/changed`. The payload itself is built by registry.ts's
 *  `settingsChangedPayload` — the one builder all FOUR producers of this notification share (this one,
 *  router.ts's engine-frame mirror, fleet.ts's host `state` change, rewind.ts's post-swap reconciliation),
 *  so the wire shape cannot depend on which producer fired. Full post-update snapshot, never a partial
 *  diff ("one shape, all three knobs", spec Wave 1 — plus M8's fourth). */
function broadcastSettings(srv: AppServer, record: ThreadRecord): void {
  srv.broadcast(record.id, "thread/settings/changed", settingsChangedPayload(record, "client"));
}

/** Whether THIS handler writes the mirror, or only asks (M3 §1a-c, Task 10).
 *
 *  For an inProcess thread the write-back above is the mirror's only reliable source, so the setter is the
 *  writer. For a FLEET thread the opposite holds: the host keeps its own settings truth, republishes it on
 *  every accepted setter as a `state` event, and the fleet event layer (fleet.ts's `onState`) writes the
 *  mirror and announces `thread/settings/changed {source:"engine"}` from it. Writing here too would give
 *  one change two announcements — the local one claiming `source:"client"` for a value the host had
 *  already published — and, worse, would let this server record a value the host never confirmed: the
 *  host answers a model RESET by publishing `model` ABSENT, which §1a-c reads as "unknown", not "cleared",
 *  while a local write would blank the mirror outright.
 *
 *  The forwarding itself is unconditional — the setter still reaches the host through the same optional
 *  member either origin's engine implements (fleetEngine.ts's `setModel`/`setPermissionMode`/
 *  `setMaxThinkingTokens`). Only the bookkeeping is origin-scoped. */
const writesMirror = (record: ThreadRecord): boolean => record.origin !== "fleet";

// All four setters' catches go through engineThrow.ts's shared -33005 re-check (see its header): these
// bodies are chain-deferred, so the engine can die after dispatch's arrival-time gate has let them
// through, and a dead read loop is not the -32603 the caller would otherwise read. -32603 stays the ALIVE
// mapping — a live engine refusing a setter is an internal failure, and its errors are untyped strings.

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
      record.updatedAt = nowSec();
      if (writesMirror(record)) { record.settings.model = model; broadcastSettings(srv, record); }
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
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
    let healedMirror = false; // true once the self-heal has genuinely written record.settings.model
    try {
      // `auto` re-runs the exact self-heal src/config/resolveOptions.ts:62 applies at session-open time —
      // `auto` is MODEL-GATED (Opus 4.6+/Sonnet 4.6); an unsupported mirrored model would silently fall
      // back to `default` on the engine (probe 18d) unless nudged onto a supported model first.
      if (mode === "auto") {
        const healed = resolveAutoModel(record.settings.model);
        if (healed !== record.settings.model) {
          // The heal FORWARDS on both origins — the host runs this one only for a plan-approved upgrade
          // (host.ts's applyPlanUpgrade), never for a client's own `set_permission_mode`, so a fleet
          // thread needs it here just as much. Only the mirror write is origin-scoped, and with it
          // `healedMirror`: on a fleet thread the host's own `state` event is what announces the swapped
          // model, so there is nothing for the catch below to rescue.
          await record.session.setModel?.(healed);
          if (writesMirror(record)) { record.settings.model = healed; healedMirror = true; }
        }
      }
      await record.session.setPermissionMode?.(mode);
      record.updatedAt = nowSec();
      // source:"client" always — even when this leg also healed the model, the CLIENT's permissionMode
      // request caused the change; no engine decided anything (spec Wave 1, unit-pinned per the brief).
      if (writesMirror(record)) { record.settings.permissionMode = mode; broadcastSettings(srv, record); }
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      // The heal can have already changed the engine's model — and written the mirror — before
      // setPermissionMode rejects below it. That model change is real and already reflected in
      // record.settings; write-back is the mirror's ONLY reliable source (module header), so a change it
      // fails to announce is a change no subscriber ever learns about. Announce it BEFORE replying the
      // error: the request as a whole still fails (permissionMode never changed), but the genuine partial
      // state change must not go silent.
      if (healedMirror) { record.updatedAt = nowSec(); broadcastSettings(srv, record); }
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
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
      record.updatedAt = nowSec();
      if (writesMirror(record)) { record.settings.thinkingTokens = resolved ?? undefined; broadcastSettings(srv, record); }
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
    }
  });
};

export const settingsApply: Handler = (srv, ctx, id, params) => {
  const parsed = settingsApplyParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  // M8's RESERVATION, and it is not decoration. This method writes the same flag layer the inbound policy
  // is carried on, at runtime, with no mirror write and no broadcast — so left open, any initialized
  // connection could push another thread's key straight at the engine, with `threadView`, `record.config`
  // and every subscriber still holding the value this server last decided.
  //
  // The reservation OUTLIVES `crossSessionInboundSet` below rather than being replaced by it, which is the
  // point worth stating: that method is not this write under a nicer name. It ratchets (tightening only —
  // the one direction probe 120 measured as taking effect), it writes the record and the config together,
  // and it announces. This one would do none of the three.
  // Refused on the KEY, before the record lookup, because it is a statement about the request.
  if (RESERVED_SETTINGS_KEY in parsed.data.settings) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `${RESERVED_SETTINGS_KEY} is decided at admission and cannot be applied at runtime`);
    return;
  }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // inProcess-only: no host op carries an arbitrary flag-settings object, so a fleet thread is refused
  // -33006 by the dispatch-level origin gate (registry.ts's FLEET_UNSUPPORTED) BEFORE this handler runs.
  // Nothing to check here — the gate exists precisely so each handler need not re-state it.
  record.chain = record.chain.then(async () => {
    try {
      await record.session.applyFlagSettings?.(parsed.data.settings);
      // No mirror field for arbitrary flag settings (not one of the three mirrored knobs) and no
      // thread/settings/changed broadcast — the brief's literal handler behavior for this method.
      record.updatedAt = nowSec();
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
    }
  });
};

// ---------------------------------------------------------------------------------------------------
// M8: THE INBOUND POLICY AT RUNTIME — A TIGHTENING RATCHET, and the ratchet IS the contract.
//
// What was measured (probes 120/120b — six legs, each against a fixed baseline, each with a control leg
// proving the send path worked in that run): the CLI genuinely DOES re-read `crossSessionInbound` off the
// live flag layer `applyFlagSettings` writes — but only in the restrictive direction. accept→refuse,
// accept→hold and hold→refuse each changed the disposition of the very next inbound message; hold→accept,
// refuse→accept and refuse→hold changed nothing at all, in silence. Order the vocabulary by permissiveness
// (accept > hold > refuse) and the pattern is total: every tightening move took effect, every loosening
// move was ignored.
//
// So this method ships only the direction that moves. A loosening request is refused HERE — the refusal is
// OURS, not the engine's, and the reason is exactly that the engine says nothing: forwarding it would mean
// reporting success for a change that did not happen, which is the one failure a security-shaped knob
// cannot have.

/** Permissiveness, most permissive first — the ratchet's whole axis. A request may move DOWN this list or
 *  stand still; never up. */
const INBOUND_RANK: Record<CrossSessionInbound, number> = { accept: 0, hold: 1, refuse: 2 };

/** The ratchet's ONE comparison and its ONE refusal. Returns true when it refused — a caller that gets
 *  true has already answered this request and must do nothing else (no engine call, no record or config
 *  write, no `updatedAt`, no broadcast, no observer teardown).
 *
 *  Extracted because it is called TWICE, and the second call is not redundant. The first is at ARRIVAL
 *  time, so a refused request never serializes behind a running turn. But a handler runs synchronously
 *  only up to the point of SCHEDULING its body on `record.chain`, so two pipelined requests both evaluate
 *  the arrival check before either body runs: on a thread at `accept`, a pipelined `refuse` then `hold`
 *  both read `accept`, both look like tightenings, and the second would commit a genuine LOOSENING —
 *  reported to the client as success. Worse than a wrong reply, because the body also rewrites
 *  `record.config` through `applyPeerPolicy`, and while a RUNTIME loosening is what the engine ignores, a
 *  LAUNCH-time policy is honoured in both directions: the next engine swap (rewind/reopen/clear) would
 *  build a genuinely wider engine, widening a thread's inbound access through the very method written to
 *  prevent it. So the AUTHORITATIVE check is the in-chain one, against the value current at commit time —
 *  it needs no new state, because every accepted body has already written `record.crossSessionInbound`
 *  before the next body starts. */
function refuseLoosening(ctx: ConnCtx, id: RequestId, current: CrossSessionInbound, value: CrossSessionInbound): boolean {
  if (INBOUND_RANK[value] >= INBOUND_RANK[current]) return false;
  ctx.peer.replyError(id, ERR.INVALID_PARAMS,
    `crossSessionInbound only tightens at runtime: "${current}" -> "${value}" is a loosening, and a loosening `
    + `write to the live flag layer is ignored in silence — so this server refuses rather than report a change `
    + `that did not happen. Widening needs an engine BUILT with the wider value: admit a thread at it `
    + `(thread/start / thread/resume), since no method exposes a replacement engine for this key today.`);
  return true;
}

export const crossSessionInboundSet: Handler = (srv, ctx, id, params) => {
  const parsed = crossSessionInboundSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // A fleet thread's engine is the HOST's: this server never built its config, cannot inject a settings key
  // into it, and the host wire carries no op that would (settingsOps.ts's header, on why the fleet engine
  // deliberately lacks `applyFlagSettings` at all). Refused with the one message every origin refusal
  // carries (registry.ts's ORIGIN_REFUSAL_MESSAGE) rather than a near-identical private string. Stated in
  // the handler rather than in FLEET_UNSUPPORTED because that dispatch-level set is pinned by an
  // exact-equality test over its own table; the turns handler's queue-flag arm is the precedent for an
  // origin refusal that lives where its subject is visible.
  if (record.origin === "fleet") { ctx.peer.replyError(id, ERR.UNSUPPORTED_FOR_ORIGIN, ORIGIN_REFUSAL_MESSAGE); return; }
  const value = parsed.data.value;
  // THE RATCHET, AT ARRIVAL TIME — before the chain, so a refused request never serializes behind a running
  // turn and never reaches the engine at all. A FAST FAIL only: the authoritative check is the in-chain one
  // below (see `refuseLoosening`), since this read happens before any pipelined predecessor's body has run.
  //
  // Compared against the CURRENT recorded value rather than the LAUNCH one, deliberately: every measured
  // leg flipped exactly once from its launch value, so the matrix cannot tell those two readings apart.
  // Current is the reading that is safe under BOTH — if the engine's real rule is against-launch we are
  // merely stricter than necessary, which costs a client a legal operation and says so, where being looser
  // would report success for a change the engine ignored.
  //
  // EXPLICITLY UNMEASURED, and refused rather than guessed: a tighten-then-partially-loosen sequence
  // (accept → refuse → hold). No leg ever probed a second move, so nothing is known about what the engine
  // would do with one — and this ratchet declines it before the engine could show us.
  if (refuseLoosening(ctx, id, record.crossSessionInbound, value)) return;
  // An equal-value request falls through and applies: a tightening move of size zero, and refusing it would
  // make a retry an error.
  record.chain = record.chain.then(async () => {
    // THE AUTHORITATIVE RATCHET, at COMMIT time — the first thing in the body, before the engine is asked
    // anything, so a request that a pipelined predecessor turned into a loosening is refused having touched
    // nothing: no engine call, no record or config write, no `updatedAt`, no broadcast, and none of the
    // `settleAdopted`/`uninstallPeerInbound` teardown below. Its refusal is OURS and is about the REQUEST,
    // so it answers -32602 directly rather than through `replyEngineThrow` (which exists for a throw from
    // an engine that may have died mid-body — a different question, still asked below).
    if (refuseLoosening(ctx, id, record.crossSessionInbound, value)) return;
    try {
      // The engine FIRST, as every setter in this file does: a rejected write must not move the mirror.
      await record.session.applyFlagSettings?.({ [SETTINGS_KEY]: value });
      // The record and the config it mirrors are ONE fact, written together (peerPolicy.ts's header).
      // Without the config write the next engine swap rebuilds from `swapBaseConfig(record.config)` and
      // silently restores the policy this call just moved off.
      record.crossSessionInbound = value;
      record.config = applyPeerPolicy(record.config, value);
      if (value === "refuse") {
        // The arrival observer is installed CONDITIONALLY on the policy (peerInbound.ts's
        // `installPeerInbound` early-returns for `refuse`), so a policy that reaches `refuse` without this
        // is a policy the arrival path never learns about.
        //
        // `settleAdopted` FIRST, exactly as the close and swap paths pair the two: detaching the frame
        // observer deafens this server to the terminal `command_lifecycle` of a turn adopted before the
        // flip, and a turn left open is a thread left busy forever. The engine survives this flip, unlike
        // at those two sites, so `cancelled` here means THIS SERVER stopped following that turn rather
        // than that the model stopped — the honest terminal for a turn whose item stream we have just
        // stopped reading, and strictly better than a turn id its subscribers hold forever.
        settleAdopted(srv, record, "cancelled");
        uninstallPeerInbound(record);
      }
      // NO INSTALL BRANCH, and its absence is a consequence rather than an omission: loosening is refused
      // above, so the only transitions this method can perform are accept→hold, X→refuse and X→X. The
      // observer is already installed for every non-refuse policy — both admission spines install it, and
      // rewind.ts re-installs it after every swap — so no move this ratchet admits can ever need one.
      record.updatedAt = nowSec();
      broadcastSettings(srv, record);
      ctx.peer.reply(id, { ok: true });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
    }
  });
};
