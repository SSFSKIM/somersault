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
import { threadView, type AppServer, type ConnCtx, type Handler } from "./server.js";
import { emitItems, turnStart } from "./turns.js";
import { buildReviewPrompt } from "./reviewPrompt.js";
import { resolveReviewRange } from "./reviewTarget.js";
import { harvestFindings, type ReviewFinding } from "./reviewFindings.js";
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
 *  "helpfully" applies the fix it just found reaches for `Edit`. TWO DOORS IT LEAVES OPEN, both named
 *  because a limit statement that admits one hole reads as if that were the only one:
 *   - `Bash`. A review needs git and a shell can write. Left open deliberately — this is the known trade.
 *   - MCP WRITE TOOLS. The inherited config carries the target's `mcpServers`, and MCP tool names are
 *     NAMESPACED (`mcp__<server>__<tool>`), so three native names touch none of them: a target wired to a
 *     filesystem, GitHub or Notion server hands the review the same write capability under another name.
 *  SUBAGENTS ARE NOT A THIRD DOOR (probe 110): a top-level `disallowedTools` DOES bind the tools a
 *  dispatched child calls, at depth 2 as well as 1, and the denial is a session-build fact rather than a
 *  permission decision — the tools are absent from the session's advertised list, and the SDK says so
 *  outright ("Edit is disabled for this session, in subagents as well as here"). Verified on disk, not from
 *  the model's narration: the child's target file was unmodified across every run, against a control
 *  proving the top-level agent was refused the same way. What the probe does NOT touch is `Bash` — no child
 *  tried to write through a shell it was allowed to use — so that door above is unchanged.
 *  AND THE FALLBACK IS CONDITIONAL TOO. Combined with D-M4-5 (a review turn parks like any other turn), a
 *  write that slips through `Bash` parks for a human rather than landing silently — but only while the
 *  permission broker is consulted, and `permissionMode` is INHERITED from the target VERBATIM. It is
 *  consulted under `default`, `acceptEdits`, `plan` and the `auto` default; `bypassPermissions` and
 *  `dontAsk` REPLACE `canUseTool` outright (config/types.ts), so a target opened in either of those reviews
 *  UNSUPERVISED with a shell on the user's tree. Not clamped on purpose: a client that chose a never-ask
 *  posture for unattended operation would have its reviews hang instead of run. THE TOOL DENIAL SURVIVES
 *  THOSE POSTURES THOUGH (probe 110): `bypassPermissions` does not lift `disallowedTools`, because that
 *  list never reaches the broker it bypasses — so under a never-ask posture the approval fallback is gone
 *  while the read-only policy itself still stands.
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

/** One `review/findings` verdict, minus the `{threadId, turnId}` envelope both channels stamp themselves. */
type Verdict = { findings: ReviewFinding[]; unstructured: boolean; level?: string; prose?: string };

/** What the REVIEWER said, as opposed to what its subagents chattered about. Nested frames are excluded
 *  here — mirroring `TurnMapper.ingest`'s own rule ("nested/subagent frame: attribution only, not
 *  itemized") — and that is deliberately the OPPOSITE of the rule for findings below. The two are about
 *  different things: a finding is about the review's SUBJECT, so whoever found it, it counts (D-M4-7);
 *  prose is the reviewer's own answer, and splicing a subagent's monologue into it would misattribute
 *  words the reviewer never wrote.
 *
 *  Blocks within one message CONCATENATE (they are one utterance the model happened to split); the caller
 *  joins separate messages with a newline, because two assistant messages are two paragraphs and running
 *  them together invents a sentence boundary that was never there. */
function assistantText(frame: unknown): string {
  const f = frame as { type?: unknown; parent_tool_use_id?: unknown; message?: { content?: unknown } } | null;
  if (!f || f.type !== "assistant" || f.parent_tool_use_id || !Array.isArray(f.message?.content)) return "";
  return (f.message.content as Array<Record<string, unknown>>)
    .map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("");
}

/** The turn's own end. The read loop hands EVERY frame to its callbacks before it resolves the turn's
 *  waiter (session/session.ts's readLoop), so this fires ahead of `submit()` settling and therefore ahead
 *  of `turn/completed` — a client never watches a review turn finish before it hears the verdict. Nested
 *  results are excluded for the same reason `resultWaiter` only settles turn-owned ones: a child's terminal
 *  frame is not the turn's.
 *
 *  A turn that ends with NO result frame — the engine died mid-review — deliberately fires no fallback. The
 *  fallback exists to stop an unreported review reading as an all-clear; a review that never finished says
 *  so through `turn/completed {status:"failed"}`, and announcing `findings: []` for it would claim a review
 *  happened. */
function isTurnEnd(frame: unknown): boolean {
  const f = frame as { type?: unknown; parent_tool_use_id?: unknown } | null;
  return !!f && f.type === "result" && !f.parent_tool_use_id;
}

/** THE HARVEST, SCOPED TO THE TURN `review/start` BEGAN — not to the review THREAD. `reviewOf` marks the
 *  thread, and a review thread is an ORDINARY thread: a client holding `reviewThreadId` can start a
 *  follow-up turn on it (asking the reviewer about its own findings, say). Under a thread-wide harvest that
 *  turn's findings-free ending would fire the unstructured fallback on a turn nobody asked to be reviewed,
 *  and a client that APPENDS findings would gain a spurious entry. The scope is structural rather than a
 *  comparison made at broadcast time: this subscription is installed for one turn and unsubscribes at that
 *  turn's end. The `currentTurnId` guard covers the one path that never reaches an end frame — `beginTurn`
 *  settling the turn terminally under the `closing`/`interruptRequested` latch, which runs the engine not at
 *  all — so a later turn on the same thread cannot inherit this watcher.
 *
 *  NO `parent_tool_use_id` GUARD, deliberately (D-M4-7). `routeTodo` (`router.ts:212`) drops nested frames
 *  because a subagent's to-do list is its own private working state; a finding is not — a reviewing agent
 *  may dispatch subagents, `ReportFindings` is written for that shape, and a finding from a child is still a
 *  finding about the review's subject. Dropping them would yield a review that reports nothing while its
 *  prose says otherwise, which is the same silent all-clear the fallback exists to prevent, arriving through
 *  another door. Hence also: `sawReport` is set by ANY harvest, nested included.
 *
 *  ONE NOTIFICATION PER HARVESTED FRAME, and it is ADDITIVE — a client APPENDS, nothing here supersedes an
 *  earlier notification. Per FRAME and not per call because `harvestFindings` MERGES every well-formed
 *  block in one assistant message (Task 4's review found that reading only the first silently dropped the
 *  rest), so one hit is the unit that reaches the wire; re-splitting it would publish the number of tool
 *  calls a frame happened to carry, which is not something a client needs. */
function watchReviewTurn(srv: AppServer, record: ThreadRecord, turnId: string): void {
  let sawReport = false;
  let done = false;
  let seq = 0;
  const prose: string[] = [];
  const publish = (verdict: Verdict): void => {
    srv.broadcast(record.id, "review/findings", { threadId: record.id, turnId, ...verdict });
    // The same verdict on the ITEM channel, so a client subscribed to items alone still sees the review —
    // and, since `emitItems` buffers, so a client that joins mid-review is replayed the verdicts already
    // reached. Both paths emit one, not just the reporting path: a subscriber that heard only structured
    // hits would read an unreported review as a review with nothing to say.
    emitItems(srv, record, turnId, [{ kind: "completed", item: { type: "review", id: `review_${turnId}_${++seq}`, ...verdict } }]);
  };
  let off: (() => void) | undefined;
  off = record.session.onFrame((frame: unknown) => {
    if (done || record.currentTurnId !== turnId) return;
    const harvested = harvestFindings(frame);
    if (harvested) { sawReport = true; publish({ ...harvested, unstructured: false }); }
    const text = assistantText(frame);
    if (text) prose.push(text);
    if (!isTurnEnd(frame)) return;
    done = true;
    off?.();
    // The governing rule of this domain: a turn that ended with no report yields the empty array PLUS the
    // `unstructured` flag PLUS what the reviewer actually said, so the truth stays on the wire. A bare
    // empty array here would be an authoritative all-clear no reviewer asserted.
    if (!sawReport) publish({ findings: [], unstructured: true, prose: prose.join("\n") });
  });
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
  // The harvest is installed AFTER the turn exists and BEFORE any frame can arrive: `beginTurn` mints and
  // stamps `currentTurnId` synchronously, in the same step it claims the thread, while the submit it
  // eventually issues sits behind `record.chain` — so this still runs a whole microtask ahead of the first
  // frame. Reading the id off the record rather than minting one is what ties the watcher to THE turn this
  // request began (see watchReviewTurn); the conditional is that read's type narrowing and nothing more —
  // `beginTurn`'s busy gate cannot refuse for a thread created one statement ago (see the note above it).
  const reviewTurnId = record.currentTurnId;
  if (reviewTurnId) watchReviewTurn(srv, record, reviewTurnId);
};
