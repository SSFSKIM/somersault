// appserver/sessionLib.ts — Task 12: the session library (spec Wave 2, gap 4). Sessions persist on disk
// and outlive this process, so a GUI's thread picker needs the union of what this server has LIVE in
// memory plus everything the store knows about — thread/list below is that merge. The four CRUD ops
// (fork/rename/tag/delete) round it out: they let a client operate on a session this server never opened
// (a "cold" session, addressed by its bare store id) as easily as one it has live.
//
// Id resolution rule (doc-commented HERE ONCE; every one of the four CRUD handlers below goes through
// `resolveThreadId`, never re-implements it): `threadId` accepts EITHER a registry id (`thr_…` — resolved
// to `record.sessionId`, refusing ENGINE_GONE-shaped if the record exists but hasn't latched a sessionId
// yet — see registry.ts/router.ts on why that's a real, not hypothetical, state) OR a bare store
// `sessionId` (anything else — passed through as-is). This is what lets a client rename/tag/delete/fork a
// session the registry never saw.
//
// The one safety rule (binding constraint, spec D-M2-7): a session that is LIVE in this server must not
// be deleted out from under its own engine. `findLiveBySessionId` below is the one place that check is
// made; thread/delete is the only op that consults it as a refusal — rename/tag pass through safely on a
// live session (the store write is safe to make regardless; this handler just also keeps the in-memory
// mirror in sync so a live thread's next view already reflects it). "Live" includes a session admitted
// while the delete is mid-flight, which no single check can see: thread/delete pairs the check with a
// reservation (server.ts's `deletingSessions`) so admission and deletion cannot both win. And it is not
// only live-HERE: a session a running ccx process elsewhere on this machine holds is refused too
// (D-M5-21c, server.ts's `liveInFleet` — the probe thread/resume and thread/archive already answer on).
import { ERR } from "./rpc.js";
import type { ThreadRecord } from "./registry.js";
import { threadView, liveInFleet, LIVE_REFUSAL_FLEET, type AppServer, type Handler } from "./server.js";
import {
  listSessions as realListSessions,
  getSessionInfo as realGetSessionInfo,
  forkSession as realForkSession,
  renameSession as realRenameSession,
  tagSession as realTagSession,
  deleteSession as realDeleteSession,
} from "../sessions/index.js";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { threadListParams, threadForkParams, threadNameSetParams, threadTagSetParams, threadDeleteParams } from "./schema/threads.js";
import { inArchivedPartition, listArchived } from "./archive.js";
import { compareTuple, decodeListCursor, encodeListCursor, fingerprint, finite } from "./searchScan.js";
import { SessionStoreError, storeRefusal } from "./archiveDomain.js";
import { auditSessionStore } from "../sessions/index.js";

const DEFAULT_LIST_LIMIT = 200; // same default as the pre-Task-12 registry-only thread/list (server.ts)

/** Every SESSION-store read is tagged HERE, at its own call, and the `try` wraps that one call and
 *  nothing else. Widening it would relabel one subsystem's failure as another's — the defect Task 10
 *  already had to fix once, where a session-store throw was answered as the marker store's fault. The tag
 *  is `archiveDomain.ts`'s, not a second spelling of it: every route into this store must describe its
 *  failures identically, which is exactly what they did not do (an `EACCES` that `thread/archive`
 *  stripped to `<path>` and `thread/search` shipped verbatim, D-M5-25a).
 *
 *  Lives HERE rather than in search.ts because `thread/list` reads the same store through the same
 *  swallowing reader, and two spellings of one tag is how the two surfaces came to disagree in the first
 *  place. */
export const storeRead = async <T>(read: () => Promise<T>): Promise<T> => {
  try { return await read(); } catch (e) { throw new SessionStoreError(e); }
};

/** The store's READABILITY, established rather than inferred (D-M5-25a) — run before the read whose
 *  emptiness it qualifies, because it is disk work like every other read on the request.
 *
 *  Only on the PRODUCTION origin. An injected reader is a different store, and its failures are the
 *  injector's to raise; auditing the local filesystem behind one would judge a store the request never
 *  touched. That gate is also the finding restated: this contract was pinned for fifteen reviews against
 *  doubles that throw, on a reader that never does, so the origin the doubles stand in for is precisely
 *  the one that had to start checking itself.
 *
 *  PER READER, and per handler, which the first version was not: it returned when ANY one of the three
 *  was injected while the other two still read the real filesystem, so a PARTIAL injection skipped the
 *  audit and then swallowed the very errno it exists to raise (constructed: `listSessions` injected, a
 *  real transcript at mode 000, a page returned and no refusal). The store the audit walks is the local
 *  filesystem, so what the gate has to ask is whether this request reads THAT store — which is a question
 *  about each reader the handler calls, not about the deps bag as a whole. The audit itself stays
 *  whole-store: it cannot be narrowed to the readers named here, and one real reader is enough reason to
 *  establish the store is readable. */
type StoreReader = "listSessions" | "getSessionMessages" | "getSessionInfo";
export const auditIfReal = async (srv: AppServer, readers: readonly StoreReader[]): Promise<void> => {
  if (readers.every((r) => srv.deps[r] !== undefined)) return;
  await storeRead(() => auditSessionStore());
};

type Resolved = { ok: true; sessionId: string } | { ok: false; code: number; message: string };

/** The one id-resolution rule (module header) — every CRUD handler below calls this instead of
 *  re-deriving it. A `thr_…` id must exist in the registry (else THREAD_NOT_FOUND, same as every other
 *  threadId-taking method) and must have already latched a store sessionId (else the engine-faithful
 *  "not yet known" state — router.ts's routeInit latches `record.sessionId` off the first system/init
 *  frame, so a thread started this same tick and never yet turned has no sessionId to resolve to).
 *  Anything else is treated as a bare store sessionId and passed straight through — no registry lookup at
 *  all — which is exactly what lets a client address a session this server never opened. */
export function resolveThreadId(srv: AppServer, threadId: string): Resolved {
  if (!threadId.startsWith("thr_")) return { ok: true, sessionId: threadId };
  const record = srv.registry.get(threadId);
  if (!record) return { ok: false, code: ERR.THREAD_NOT_FOUND, message: "Thread not found" };
  if (!record.sessionId) return { ok: false, code: ERR.ENGINE_GONE, message: "Session id not yet available for this thread" };
  return { ok: true, sessionId: record.sessionId };
}

/** The live-guard's one lookup (module header, spec D-M2-7): is ANY record in this server's registry
 *  currently backed by this store sessionId — regardless of how the caller spelled `threadId` (a `thr_…`
 *  id resolves to the SAME record this finds; a bare sessionId that happens to match a live thread's
 *  engine must be caught here too). */
export function findLiveBySessionId(srv: AppServer, sessionId: string): ThreadRecord | undefined {
  return srv.registry.list().find((r) => r.sessionId === sessionId);
}

/** The store-knows ATOM (M5, D-M5-20): "does the session store have a row for this id", DI default
 *  included, spelled ONCE. Three admission rules stand on it and they are deliberately DIFFERENT
 *  predicates — `thread/searchOccurrences` admits on `live record OR store row`, `thread/archive` on the
 *  store row ALONE (a live thread is separately refused BUSY by its own live-guard, so admitting on a live
 *  record here would admit exactly the case that method must reject), `thread/unarchive` on `marker OR
 *  store row` — so what is shared is this lookup and nothing above it. Extracting the whole refusal would
 *  flatten three rules into one and invert `archive`.
 *
 *  What must not drift is the `srv.deps` OVERRIDE. Every caller's tests inject through it, so a call site
 *  that re-spells the binding and drops the override reads the real session store while its own tests stay
 *  green — passing for the wrong reason, and passing hardest on the machine that has real sessions on
 *  disk. One binding, one place to get it wrong. */
export async function storeKnows(srv: AppServer, sessionId: string): Promise<boolean> {
  return (await storeRow(srv, sessionId)) !== undefined;
}

/** The same lookup, ROW and all. `storeKnows` is a predicate over it and stays a predicate, because the
 *  three admission rules above are about existence and nothing else; this is for the one caller that needs
 *  the row itself — `thread/searchOccurrences`, whose cursor is stamped with the transcript's generation
 *  and derives it from the store's own metadata when this server does not hold the session live (D-M5-26).
 *  One binding, one `srv.deps` override, one place to get it wrong — which is the whole reason the atom
 *  above exists, so the second caller shares it rather than re-spelling it. */
export async function storeRow(srv: AppServer, sessionId: string): Promise<SDKSessionInfo | undefined> {
  const getInfo = srv.deps.getSessionInfo ?? ((sid: string) => realGetSessionInfo(sid, {}));
  // The dep is declared `Promise<unknown | undefined>` on purpose — a test double must be able to answer
  // with the two or three fields its own case is about rather than build a whole `SDKSessionInfo` — so the
  // narrowing happens once, here, where the real reader's type is known, instead of at each caller.
  return (await getInfo(sessionId)) as SDKSessionInfo | undefined;
}

/** A LIVE row's `title`/`tags`, filled from the store row for the same session — the half of the merged
 *  projection that is not in `threadView`, because the registry record only carries these once a
 *  `thread/name/set` or `thread/tag/set` has patched them. A patched field always wins: the same call that
 *  wrote it persisted it, so the record is at least as fresh as the store.
 *
 *  EXPORTED, and the reason is a defect (D-M5-25c): `thread/search` composed its live rows with
 *  `threadView` alone, so a session found BY its stored title came back as a row that did not carry the
 *  title — the search's own `snippet` showing text the row it sits beside did not have. Two methods claim
 *  to serve one projection, so the projection is one function. */
export function fillFromStore(view: Record<string, unknown>, match: SDKSessionInfo): void {
  if (view.title === undefined) view.title = match.summary;
  if (view.tags === undefined) view.tags = match.tag !== undefined ? [match.tag] : undefined;
}

/** Store-only rows project to the SAME 14-field shape threadView produces (parent §5) — a client must not
 *  be able to tell a live row from a stored one by its shape alone, only by its content. No `thr_` id
 *  exists for a session this server never opened, so `id` IS the store sessionId; `status` is always idle
 *  and `queueDepth` always 0 (a store-only session has no engine to be busy and no queue to fill — 0 is
 *  the fact, not a placeholder); `model`/`permissionMode`/`thinking`/`origin` have no store equivalent and
 *  stay `undefined` exactly as an un-configured registry row would read.
 *
 *  EXPORTED for one reason: sessionLib.test.ts pins that claim by comparing this function's KEY SET
 *  against a live `threadView`'s, which only an in-process call can do — the wire rows cannot be compared,
 *  since JSON drops undefined-valued keys and the two views leave DIFFERENT fields undefined (a live row
 *  never has `preview`, a store row never has `origin`), so a wire-level comparison could only ever pin
 *  their intersection. Same reason `threadView` is exported from server.ts.
 *
 *  UNIT NOTE (real bug caught in self-review, not just a style choice): `SDKSessionInfo.createdAt`/
 *  `lastModified` are documented milliseconds-since-epoch; `ThreadRecord.createdAt`/`updatedAt`
 *  (registry.ts) are explicitly unix SECONDS, and threadView passes those straight through. Without the
 *  /1000 below, a store-only row's timestamps would read ~1000x a live row's on the exact same wire
 *  field — wrong data, not just a cosmetic mismatch. */
export function storeOnlyView(info: SDKSessionInfo): Record<string, unknown> {
  return {
    id: info.sessionId,
    sessionId: info.sessionId,
    title: info.summary,
    tags: info.tag !== undefined ? [info.tag] : undefined,
    cwd: info.cwd,
    model: undefined,
    permissionMode: undefined,
    thinking: { maxTokens: undefined },
    status: { state: "idle" as const },
    queueDepth: 0,
    origin: undefined,
    createdAt: info.createdAt !== undefined ? Math.floor(info.createdAt / 1000) : undefined,
    updatedAt: Math.floor(info.lastModified / 1000),
    preview: info.firstPrompt,
  };
}

/** `thread/list`, replacing the registry-only M1 handler: merges live registry + `deps.listSessions`,
 *  deduped on sessionId with LIVE WINNING (spec gap 4) — a live record's view already carries the freshest
 *  turn/settings state, so a store row for the same session is dropped, not layered on top. A live
 *  record's `title`/`tags` are filled from its store match only when the record itself doesn't already
 *  carry them (i.e. thread/name/set or thread/tag/set never patched this in-memory record) — patched
 *  fields always win over the store, since they were written by the SAME rename/tag call that persisted
 *  them. A live record whose `sessionId` has not yet latched (engine-faithful: undefined until the first
 *  turn's init frame) cannot be looked up in the store map at all — it is included as its own unmatched
 *  row, exactly like a fresh thread/list did before this task, and the store row it might one day match is
 *  independently listed as store-only until that happens. The cursor pages the merge — never either input
 *  alone — and since Task 10, the merge AFTER the archived partition is cut from it: the page is cut from
 *  `filtered`, the half being walked, at both ends (see below).
 *
 *  M5 Task 10 adds `archived`, and it selects a PARTITION rather than filtering one: omitted or `false`
 *  lists only unarchived sessions — which is what this method already did, so an existing client sees no
 *  change — and `true` lists only archived ones. It is the same partition `thread/search` publishes, off
 *  the same predicate and the same published spelling (archive.ts's `inArchivedPartition`, core.ts's
 *  `archivedParam`), because the spec hands it to the two methods in one sentence.
 *
 *  M6 re-cursors it as a KEYSET over a total order (schema/core.ts's `listCursorParam` carries the wire
 *  half of this). The offset it replaces indexed a position in `filtered`, and `thread/archive`/
 *  `thread/unarchive` move a session across the very partition being walked — so a client that shelved a
 *  row it had already been handed shifted every later position by one and the next page silently began one
 *  row late. A tuple has no such coupling: whatever leaves or joins the partition, "the rows after this
 *  tuple" names the same rows it named before.
 *
 *  It is `updatedAt` DESCENDING, tie-broken by `id` ASCENDING — the recency order this method's two
 *  neighbours already use (the SDK's own `listSessions` documents its result order as unspecified and
 *  sorts by mtime descending; `thread/search` sorts by recency off `compareTuple`), and the first total
 *  order this merge has ever had. `filtered` was `[...liveViews, ...storeOnlyViews]`: registry-insertion
 *  order, then whatever the store handed back. That grouping is DROPPED rather than kept as an outer sort
 *  key, and deliberately — a store row that goes live mid-walk changes group, which moves it across every
 *  row of the other group at once. That is the same skip/repeat the offset had, reintroduced one level up
 *  where a keyset cannot see it. */
export const threadList: Handler = async (srv, ctx, id, params) => {
  const parsed = threadListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  // Decoded BEFORE either store is read, and REFUSED rather than repaired (the `thread/search` precedent,
  // D-M5-16a). A cursor this server did not mint — forged, truncated, or the decimal offset an older
  // server minted for this same method — has no position to resume at, and treating it as "start from the
  // beginning" would hand the client the first page a second time under a reply that looks like success.
  // …and the same refusal covers a cursor minted in a DIFFERENT walk of this method. `cwd` and `archived`
  // choose which set of rows is being ordered, and `archived` selects a whole partition — so a cursor
  // carried across a show-archived toggle decodes fine, finds a place in the other partition's ordering,
  // and silently begins after everything sorting before it. Same wrong page, different door.
  const walk = fingerprint([parsed.data.cwd, parsed.data.archived === true]);
  const cursor = parsed.data.cursor === undefined ? null : decodeListCursor(parsed.data.cursor);
  if (parsed.data.cursor !== undefined && (cursor === null || cursor.q !== walk)) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid cursor"); return; }
  const listFn = srv.deps.listSessions ?? realListSessions;
  // The SESSION store's readability, established before the listing that would otherwise report its
  // failure as absence (D-M5-25a rev 2). `thread/search` audited from the day the finding landed and this
  // method did not, which left the two answering opposite things about one broken store at one instant:
  // the search box refused `-32603` while the thread picker served `{"data":[],"nextCursor":null}` — and
  // of the two, a picker showing no threads is the more likely to be believed. The reason it was deferred
  // was that a failure here fell through to `dispatch`'s generic catch, which replies `e.message` for
  // EVERY handler and would have put node's absolute path on the wire; that is what this `try` removes.
  // It wraps the two SESSION-store steps ALONE — the marker read below has its own, for the reason stated
  // there — and answers through the same `storeRefusal` the archive routes and the search do.
  let storeRows: SDKSessionInfo[];
  try {
    await auditIfReal(srv, ["listSessions"]);
    storeRows = (await storeRead(() => listFn({ cwd: parsed.data.cwd }))) as SDKSessionInfo[];
  } catch (e) { const r = storeRefusal(e); ctx.peer.replyError(id, r.code, r.message); return; }
  const bySessionId = new Map(storeRows.map((r) => [r.sessionId, r]));
  const seen = new Set<string>();
  const liveViews = srv.registry.list().map((r) => {
    const match = r.sessionId ? bySessionId.get(r.sessionId) : undefined;
    const view = threadView(srv, r);
    if (match) { seen.add(r.sessionId!); fillFromStore(view, match); }
    return view;
  });
  const storeOnlyViews = storeRows.filter((r) => !seen.has(r.sessionId)).map(storeOnlyView);
  const merged = [...liveViews, ...storeOnlyViews];
  // The archived PARTITION (M5 Task 10, D-M5-3), applied to the MERGE and before the page is cut. The
  // marker directory is read HERE, per request, and never cached: archived-ness is state another ccx
  // process can change with one file operation, and a set held across requests would answer for the
  // moment this server last looked. A failed read propagates — dispatch answers -32603 — because
  // swallowing it into an empty set is the failure that looks like success (D-M5-8): every shelved
  // session back in the default list, and `archived:true` answering "none" where the truth is "unknown".
  // The `try` wraps `listArchived` ALONE, and that is the whole of why it is written this way rather than
  // around the body: `deps.listSessions` above is the OTHER store, and a catch spanning both would answer
  // a session-store failure with "archive marker store failed" — the mislabelling `SessionStoreError`
  // exists to prevent (D-M5-18a). `storeRefusal` is archiveDomain's, reused rather than re-spelled, so
  // the readers of this store describe its failures exactly as its writers do — composed from
  // `code`+`syscall`, never node's own message, which ends in the operator's absolute home path.
  let archivedSet: Set<string>;
  try { archivedSet = await listArchived({ ccxDir: srv.deps.ccxDir }); }
  catch (e) { const r = storeRefusal(e); ctx.peer.replyError(id, r.code, r.message); return; }
  const wantArchived = parsed.data.archived === true;
  const filtered = merged.filter((v) => inArchivedPartition(archivedSet, v.sessionId as string | undefined, wantArchived));
  const limit = parsed.data.limit ?? DEFAULT_LIST_LIMIT;
  // ONE tuple function for the sort, the resume and the mint — searchScan.ts keeps its three that way for
  // the reason a review found there: two spellings of one ordering is how a cursor comes to name a place
  // the sort does not put it. `updatedAt` is screened through the same `finite` the search sort uses, so a
  // row carrying NaN (a bring-your-own store's `mtime` satisfies `typeof === "number"` with one) sorts
  // last instead of poisoning `compareTuple`'s subtraction and unordering the rows around it. `id` is
  // present and unique on both row kinds — `thr_…` on a live view, the store sessionId on a store-only one
  // — which is what makes this a total order and therefore a resumable one.
  const tupleOf = (v: Record<string, unknown>) => ({ v: finite(v.updatedAt), s: v.id as string });
  const ordered = [...filtered].sort((a, b) => compareTuple(tupleOf(a), tupleOf(b), "desc"));
  // STRICTLY after the cursor: it names the last row already delivered, not the next one to examine (the
  // two `thread/search` cursors name the next, because theirs can point INTO a session's rows and row 0 of
  // the next session is a place, not a row already sent). `-1` is every remaining row sorting at or before
  // it — the walk is over, which is the honest answer when the row the cursor named is now the last one.
  const from = cursor ? ordered.findIndex((r) => compareTuple(tupleOf(r), cursor, "desc") > 0) : 0;
  // Paging is over `filtered`, both ends: the walk covers the partition a client asked for, and exhaustion
  // is reported against ITS length — comparing against `merged` would mint a cursor for a page that does
  // not exist and leave the client paging past the end.
  const page = from < 0 ? [] : ordered.slice(from, from + limit);
  const more = from >= 0 && from + page.length < ordered.length;
  ctx.peer.reply(id, { data: page, nextCursor: more ? encodeListCursor({ ...tupleOf(page[page.length - 1]), q: walk }) : null });
};

/** `thread/fork`: resolve the source id, ask the store to fork it (a pure store-level copy — the source
 *  engine, if live, is untouched), then start a brand-new LIVE thread in THIS server resuming the fork —
 *  the same admission spine `thread/resume` uses (`AppServer.startThread`, extracted from its handler body
 *  in this task). The reply's thread is that new record's view: startable and usable like any other, not
 *  merely a stored copy. */
export const threadFork: Handler = async (srv, ctx, id, params) => {
  const parsed = threadForkParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  // The shutdown latch is consulted TWICE, around the store write. This is the one admission path whose
  // side effect lands before `startThread`'s own refusal is reached: startThread refusing a fork whose
  // store copy already exists leaves an orphan session on disk that nothing in this process ever owned.
  // Checking first skips the write entirely; re-checking after undoes it, since the latch can land while
  // forkFn is in flight (shutdown() keeps accepting frames while it awaits a slow dispose).
  if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
  try {
    const forkFn = srv.deps.forkSession ?? realForkSession;
    const result = await forkFn(resolved.sessionId, { upToMessageId: parsed.data.upToMessageId, title: parsed.data.title });
    if (srv.isShuttingDown) {
      await (srv.deps.deleteSession ?? realDeleteSession)(result.sessionId);
      ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down");
      return;
    }
    await srv.startThread(ctx, id, { resume: result.sessionId, unattended: parsed.data.unattended });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};

/** `thread/delete`: the ONE place the live-guard (module header) is enforced. Refuses BUSY (-33001) —
 *  reusing the busy-family code, not inventing a new one, since "you may not tear this down right now" is
 *  exactly what BUSY already means on the wire — with the spec's literal message. Passes through to the
 *  store otherwise, then announces the deletion server-wide (thread/deleted, spec D-M2-7) so a picker
 *  watching thread existence drops the row even though no thread/subscribe ever existed for a cold id. */
export const threadDelete: Handler = async (srv, ctx, id, params) => {
  const parsed = threadDeleteParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  // RESERVE FIRST, then check live (srv.deletingSessions): the live-check and the store delete cannot be
  // one atomic step — the delete is awaited, and a thread/resume for this same session admitted during
  // that await would come up live on a session whose history is being erased. The reservation is what
  // startThread refuses against, so the two orders are the only two possible: reserved-then-resumed (the
  // resume is refused) or resumed-then-reserved (this check finds it and refuses the delete, because
  // startThread stamps the resume target eagerly). Released in `finally` — a failed delete must not
  // reserve the id forever.
  srv.deletingSessions.add(resolved.sessionId);
  try {
    // R13: a `thread/resume` for this session, admitted DURING its PID-liveness probe, holds
    // `resumingSessions` before it has a live record `findLiveBySessionId` could see — so refuse against
    // that reservation too. Either the resume reserved first (this refuses) or this reserved
    // `deletingSessions` first (the resume's own arrival check refuses); the two can never both win.
    if (srv.resumingSessions.has(resolved.sessionId) || findLiveBySessionId(srv, resolved.sessionId)) {
      ctx.peer.replyError(id, ERR.BUSY, "Thread is live in this server — close it first"); return;
    }
    // The THIRD holder, and the one this guard is worst-placed to ignore (D-M5-21c): a ccx session running
    // in ANOTHER process, found through the roster probe `thread/resume` and `thread/archive` already
    // refuse on (server.ts's `liveInFleet`). Deleting is the one op that cannot be undone by whoever finds
    // out later — this server was refusing to RESUME such a session and refusing to SHELVE it, then
    // erasing the transcript that process is still appending to. The two in-process arms above stay ahead
    // of it and stay synchronous (the reservation race is decided in this dispatch tick); this arm is real
    // I/O, and the window it opens is the same one archive's own roster arm has and for the same reason.
    // Its sentence is not the one above: "live in this server" is false here, and "close it first" is
    // advice no request to this server can carry out.
    if (await liveInFleet(srv, resolved.sessionId)) { ctx.peer.replyError(id, ERR.BUSY, LIVE_REFUSAL_FLEET); return; }
    const deleteFn = srv.deps.deleteSession ?? realDeleteSession;
    await deleteFn(resolved.sessionId);
    ctx.peer.reply(id, { ok: true });
    srv.broadcastServer("thread/deleted", { sessionId: resolved.sessionId });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  } finally {
    srv.deletingSessions.delete(resolved.sessionId);
  }
};

/** `thread/name/set`: safe on a live session (spec D-M2-7) — passes through to the store, and if a live
 *  record is backed by this sessionId, patches its in-memory mirror too (so its NEXT threadView already
 *  carries the new title without waiting on a store round-trip) and tells that thread's subscribers via
 *  thread/name/updated. */
export const threadNameSet: Handler = async (srv, ctx, id, params) => {
  const parsed = threadNameSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  try {
    const renameFn = srv.deps.renameSession ?? realRenameSession;
    await renameFn(resolved.sessionId, parsed.data.title);
    const live = findLiveBySessionId(srv, resolved.sessionId);
    if (live) live.title = parsed.data.title;
    ctx.peer.reply(id, { ok: true });
    if (live) srv.broadcast(live.id, "thread/name/updated", { threadId: live.id, title: parsed.data.title });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};

/** `thread/tag/set`: same pass-through + live-mirror-patch shape as thread/name/set — but NO notification
 *  (parent §8 defines a notification for a name change only; tag has none). The store's tag is a single
 *  nullable string; the mirror (and the wire's `tags`) is the plural array parent §5 defines, so a set tag
 *  wraps to a one-element array and `null` clears it back to `undefined`. */
export const threadTagSet: Handler = async (srv, ctx, id, params) => {
  const parsed = threadTagSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  try {
    const tagFn = srv.deps.tagSession ?? realTagSession;
    await tagFn(resolved.sessionId, parsed.data.tag);
    const live = findLiveBySessionId(srv, resolved.sessionId);
    if (live) live.tags = parsed.data.tag !== null ? [parsed.data.tag] : undefined;
    ctx.peer.reply(id, { ok: true });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};
