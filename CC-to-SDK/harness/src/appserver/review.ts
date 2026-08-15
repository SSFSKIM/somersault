// appserver/review.ts — `review/start` (M4). Codex's whole review REQUEST surface is one method
// (app-server-protocol/src/protocol/common.rs:908-912) reusing the ordinary turn lifecycle, and so is
// ours: no cancel, no list, no review-specific turn machinery.
//
// A REVIEW IS AN ORDINARY TURN ON A NEW THREAD. Detached delivery needs exactly one thing from the target
// thread — its CWD — so this never touches the target's engine, which is also why a fleet-origin thread
// can be reviewed as readily as an inProcess one (no entry in FLEET_UNSUPPORTED). The turn itself goes
// through `turnStart` verbatim rather than through a review-shaped copy of it: whatever an ordinary turn
// does — the user-item echo, the busy claim, turn/started, the item fan, turn/completed — a review turn
// does identically, and Task 6's harvester reads the frames that spine already routes.
//
// INLINE IS REFUSED, NOT DEGRADED (D-M4-2). Codex's inline path runs a CHILD session and splices its
// events onto the parent turn by re-stamping ids (core/src/tasks/review.rs:95-181); the SDK gives us no
// way to re-stamp a child's events, and running the review as a plain turn on the caller's thread would
// contaminate the conversation — the very thing Codex's child session exists to prevent.
import { ERR, type RequestId } from "./rpc.js";
import type { Peer } from "./peer.js";
import { threadCwd, type ThreadRecord } from "./registry.js";
import { threadView, type ConnCtx, type Handler } from "./server.js";
import { turnStart } from "./turns.js";
import { buildReviewPrompt } from "./reviewPrompt.js";
import { resolveReviewRange } from "./reviewTarget.js";
import { reviewStartParams } from "./schema/review.js";
import { READONLY_DISALLOW } from "../config/agents.js";

/** Names the path that DOES work, because "not supported" without it leaves a client guessing whether the
 *  method exists at all (D-M4-2 is a deferral, not a rejection of the idea). */
const INLINE_REFUSAL =
  "delivery:inline is not supported yet — use delivery:detached, which runs the review on a new thread (reviewThreadId)";

/** Reachable only for a malformed fleet roster row (registry.ts's `threadCwd` refuses to borrow ours for a
 *  session that runs elsewhere), and the honest refusal: a review of "some directory" is not a review of
 *  the thread that was named, and silently substituting this server's tree would report another repo's
 *  defects against this thread. */
const NO_CWD = "the target thread's working directory is unknown, so there is nothing to root a review at";

/** The review thread's start config: the TARGET's, re-rooted and read-only.
 *
 *  Inherited rather than invented, so the review runs with the same model, plugins and MCP topology as the
 *  work it is reviewing — a repo whose thread needed a particular setup needs it to read that repo too.
 *  Three deliberate departures:
 *   - `cwd` is re-stamped from `threadCwd`, the one answer to "where does this thread run" (registry.ts),
 *     which for a fleet target is its roster directory and not this process's.
 *   - `resume` is DROPPED. `record.config` is the FULL object the target's engine was built from, that id
 *     included; carried over it would open the "detached" review on the target's own transcript, which is
 *     the exact contamination detached delivery exists to avoid. (The broker needs no such care — the
 *     creation spine overwrites it with the review thread's own.)
 *   - the edit tools are disallowed — see below.
 *
 *  READ-ONLY IN POLICY, NOT ONLY IN THE PROMPT — AND THIS IS RISK REDUCTION, NOT A GUARANTEE. The prompt
 *  tells the reviewer "Review only — do not edit, fix, or commit anything" (reviewPrompt.ts), and a promise
 *  the server does not enforce is one it should not print. What `READONLY_DISALLOW` (config/agents.ts, the
 *  same set the built-in read-only agents use) closes is the LIKELY accidental path: a model that
 *  "helpfully" applies the fix it just found reaches for `Edit`. THREE DOORS IT LEAVES OPEN, all three named
 *  because a limit statement that admits one hole reads as if that were the only one:
 *   - `Bash`. A review needs git and a shell can write. Left open deliberately — this is the known trade.
 *   - MCP WRITE TOOLS. The inherited config carries the target's `mcpServers`, and MCP tool names are
 *     NAMESPACED (`mcp__<server>__<tool>`), so three native names touch none of them: a target wired to a
 *     filesystem, GitHub or Notion server hands the review the same write capability under another name.
 *   - SUBAGENTS. The reviewer can dispatch through `Task`, and whether a top-level `disallowedTools` binds
 *     the tools those children call is UNVERIFIED — a live probe is open on exactly that question, and until
 *     it answers this comment asserts neither way rather than guessing in either direction.
 *  AND THE FALLBACK IS CONDITIONAL TOO. Combined with D-M4-5 (a review turn parks like any other turn), a
 *  write that slips through `Bash` parks for a human rather than landing silently — but only while the
 *  permission broker is consulted, and `permissionMode` is INHERITED from the target VERBATIM. It is
 *  consulted under `default`, `acceptEdits`, `plan` and the `auto` default; `bypassPermissions` and
 *  `dontAsk` REPLACE `canUseTool` outright (config/types.ts), so a target opened in either of those reviews
 *  UNSUPERVISED with a shell on the user's tree. Not clamped on purpose: a client that chose a never-ask
 *  posture for unattended operation would have its reviews hang instead of run.
 *  MERGED as a set, never assigned: a target thread that already denied tools keeps every one. */
function reviewConfig(target: ThreadRecord, cwd: string): Record<string, unknown> {
  const { resume: _resume, ...inherited } = target.config ?? {};
  const denied = Array.isArray(inherited.disallowedTools) ? (inherited.disallowedTools as string[]) : [];
  return { ...inherited, cwd, disallowedTools: [...new Set([...denied, ...READONLY_DISALLOW])] };
}

/** The turn spine owns the `{turn}` reply AND the status inside it, which it settles from its own chain
 *  callback; `review/start` owes that same reply plus the id of the thread the review runs on. So rather
 *  than pre-answering a status the spine has not decided yet, the caller's `ctx` is passed through with its
 *  peer wrapped for exactly this one request: a successful reply gains `reviewThreadId`, and errors and
 *  notifications are the real peer's, untouched. The cast is unavoidable (`Peer` has private fields, so no
 *  literal is structurally assignable to it) and safe: nothing downstream retains this object —
 *  `record.subscribers` holds the peers `thread/subscribe` registered, never this one. */
function withReviewThreadId(ctx: ConnCtx, reviewThreadId: string): ConnCtx {
  const peer = ctx.peer;
  const shim = {
    reply: (rid: RequestId, result: unknown) => peer.reply(rid, { ...(result as Record<string, unknown>), reviewThreadId }),
    replyError: peer.replyError.bind(peer),
    notify: peer.notify.bind(peer),
  } as unknown as Peer;
  return { ...ctx, peer: shim };
}

export const reviewStart: Handler = async (srv, ctx, id, params) => {
  const parsed = reviewStartParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  if (parsed.data.delivery === "inline") { ctx.peer.replyError(id, ERR.INVALID_PARAMS, INLINE_REFUSAL); return; }
  const target = srv.registry.get(parsed.data.threadId);
  if (!target) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const cwd = threadCwd(target);
  if (!cwd) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, NO_CWD); return; }
  // The one host-side git this whole domain needs (reviewTarget.ts) — `baseBranch`'s merge-base, and a
  // no-op for every other variant. It DEGRADES rather than failing, so a note instead of a range still
  // yields a runnable review.
  const resolved = await resolveReviewRange(parsed.data.target, cwd);
  // Checked HERE, after that await rather than at arrival: `shuttingDown` exists to keep shutdown()'s
  // snapshot un-staleable, so what matters is that no thread is admitted after the latch — and the only
  // window this handler has is the yield above.
  if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
  // The SAME window, for the target rather than the server: `thread/close` and `thread/delete` can drop the
  // record while git runs, and everything below reads a value captured before that yield — the config the
  // review inherits and, worse, the `reviewOf` id Task 6 attributes findings by, which would point at a
  // thread nothing can resolve. Re-read rather than trust the capture; a target that left mid-request is the
  // same answer it would have got a moment earlier.
  if (!srv.registry.get(target.id)) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const record = srv.createThread({ config: reviewConfig(target, cwd), unattended: target.unattended });
  // BEFORE the turn starts, so the harvester never sees a frame from a review it cannot recognise.
  record.reviewOf = target.id;
  // Announced like any other thread, and announced FIRST: the turn's own broadcasts land a microtask later,
  // and a watcher that met `turn/started` for a thread it had never heard of could not place it.
  srv.broadcastServer("thread/started", { thread: threadView(srv, record) });
  // Called directly rather than dispatched: both of dispatch's gates are about the thread a request NAMES,
  // and this one names a thread created one statement ago — its engine is fresh and its origin inProcess,
  // so neither gate has anything to say. `turnStart`'s own busy gate cannot refuse for the same reason
  // (nothing has had a chance to claim the record), which is why its refusal path is not handled here —
  // the same reasoning turns.ts's queue drain records.
  turnStart(srv, withReviewThreadId(ctx, record.id), id, { threadId: record.id, input: buildReviewPrompt(parsed.data.target, resolved) });
};
