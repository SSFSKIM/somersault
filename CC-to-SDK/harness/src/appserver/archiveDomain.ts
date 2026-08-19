// src/appserver/archiveDomain.ts — M5 §archive: `thread/archive` / `thread/unarchive`, the two handlers
// over Task 5's marker store (spec D-M5-3 rev 3, D-M5-10 rev 3, D-M5-20, D-M5-21).
//
// SEPARATE MODULE from `archive.ts` (which the task brief expected to hold both), for two reasons that
// point the same way. The repo's own hybrid puts the store and its protocol in different files —
// `configWrite.ts` writes the bytes, `configDomain.ts` assigns the JSON-RPC codes — and this file keeps
// that split, which is also what "the store stays protocol-free" (D-M5-18a) means in practice. The second
// reason is measured rather than stylistic: `archive.test.ts`'s cross-process race compiles the REAL
// `archive.ts` with `tsc` and runs it under bare `node` from a temp directory, so any runtime import that
// reaches `zod` or `./server.js` from that module takes the whole appserver graph — and its `node_modules`
// resolution — into a directory that has neither.
//
// The three admission rules in this milestone are DIFFERENT predicates and stay different:
//   `thread/searchOccurrences`  live record OR store row   (search.ts)
//   `thread/archive`            store row ALONE            — a live thread is refused BUSY by the
//                                                            live-guard below, so admitting on a live
//                                                            record would admit the one case this method
//                                                            must reject
//   `thread/unarchive`          marker OR store row        — a marker whose session the store has
//                                                            forgotten is exactly what unarchive is for
// What they SHARE is one lookup and its dependency-injection default (`sessionLib.ts`'s `storeKnows`),
// never the refusal built on it.
import { ERR, type RpcError } from "./rpc.js";
import { liveInFleet, type AppServer, type Handler } from "./server.js";
import { findLiveBySessionId, resolveThreadId, storeKnows } from "./sessionLib.js";
import { MarkerIdError, createArchiveMarker, listArchived, removeArchiveMarker } from "./archive.js";
import { threadIdParams } from "./schema/core.js";

/** `thread/delete`'s message, verbatim (sessionLib.ts): both refuse the same fact for the same reason, and
 *  a client that handles one string should not have to learn a second. */
const LIVE_REFUSAL = "Thread is live in this server — close it first";

/** "Someone is holding, or is about to hold, this session." THREE sources, none redundant:
 *
 *  - a registry record is the ordinary live thread;
 *  - `resumingSessions` is a `thread/resume` that has reserved its id and is still inside its PID-liveness
 *    probe — real, admitted-in-a-moment, and invisible to `findLiveBySessionId` because it has no record
 *    yet (server.ts's refcount);
 *  - the ROSTER is a ccx session live in ANOTHER process (server.ts's `liveInFleet`, the same probe
 *    `thread/resume` refuses on). Without it this server answered two contradictory questions about one
 *    id — refusing to resume a session a running fleet host still holds, and shelving that same id from
 *    the handler two lines away. D-M5-21's invariant is stated across servers, not within one.
 *
 *  ORDER matters, and not for cheapness: the two in-process arms are evaluated before this function's
 *  first await (an async body runs synchronously until one), so they still answer inside the caller's own
 *  dispatch tick — which is what lets the entry guard see a thread admitted in that same tick. The roster
 *  arm is real I/O and cannot. That it opens a window is not new, and is exactly why the guard is checked
 *  a second time once the marker exists (see `threadArchive`). */
const liveAnywhere = async (srv: AppServer, sessionId: string): Promise<boolean> =>
  findLiveBySessionId(srv, sessionId) !== undefined || srv.resumingSessions.has(sessionId) || liveInFleet(srv, sessionId);

/** The SESSION store's failure, tagged at the ONE call site that can raise it. Both handlers read two
 *  different stores inside one handler body, and without this tag a `getSessionInfo` that threw was
 *  answered as `archive marker store failed: …` — the wrong subsystem named, on a message that never went
 *  through the marker store's path-stripping at all. */
class SessionStoreError extends Error {
  constructor(readonly reason: unknown) { super("session store read failed"); }
}
const knows = async (srv: AppServer, sessionId: string): Promise<boolean> => {
  try { return await storeKnows(srv, sessionId); }
  catch (e) { throw new SessionStoreError(e); }
};

/** An absolute path in a wire message is the operator's home directory on the wire (the brief's words for
 *  the errno branch below, and the same leak wherever a message we did not compose reaches a client).
 *  Anchored so it strips PATHS and not method names: a `/` preceded by a word character — `thread/archive`,
 *  `and/or` — is not one. */
const stripPaths = (m: string): string => m.replace(/(?<![\w~])(?:[A-Za-z]:)?[\\/][^\s'"`]*/g, "<path>");

/** The stores throw protocol-free; the code is assigned HERE. Three kinds, and they are not the same fault:
 *
 *  - `MarkerIdError` is the CLIENT's `threadId` — `-32602`. Belt-and-braces rather than the primary
 *    defense: both handlers run the D-M5-20 existence check first, and a path-hostile id is by
 *    construction not a session `getSessionInfo` knows, so it refuses THREAD_NOT_FOUND before the marker
 *    store is touched at all. The ORDERING is therefore the real guard, `threadIdParams` being only
 *    `z.string().min(1)` — but D-M5-18a's rule for this shape is to fail closed with a diagnosable
 *    message rather than by accident with an opaque one, so the mapping is worth its two lines.
 *  - a `SessionStoreError` is the OTHER store — the session store the D-M5-20 existence check reads, which
 *    is not this module's and whose messages are not ours to predict. Also `-32603` (the same reading: it
 *    describes our inability, not the client's data), but named for the subsystem that actually failed:
 *    the two stores fail for unrelated reasons and a client told the wrong one debugs the wrong thing.
 *  - an errno is THIS SERVER's state directory (`ENOTDIR` from a corrupted `~/.claude/ccx`, `EACCES`),
 *    which describes our inability and not the client's parameter — `-32603`, the same reading D-M5-18a
 *    gives elsewhere.
 *
 *  The errno message is COMPOSED from `code` + `syscall` rather than passed through. Node's own reads
 *  `"EACCES: permission denied, mkdir '/Users/<operator>/.claude/ccx/archived'"`, and that absolute path
 *  puts the operator's home directory on the wire for any client that can reach this method. Every branch
 *  whose text we did NOT compose is `stripPaths`ed for the same reason — a strip that covers only the
 *  branch we happened to think of is a strip that leaks through the branch we did not.
 *
 *  EXPORTED because the admission auto-unarchive (server.ts's `autoUnarchive`) touches the same store and
 *  discloses its failures as a `warning`: one description of a marker-store failure, so the path-stripping
 *  above cannot hold on one route and leak on the other. */
export function storeRefusal(e: unknown): RpcError {
  if (e instanceof MarkerIdError) return { code: ERR.INVALID_PARAMS, message: e.message };
  if (e instanceof SessionStoreError) return { code: ERR.INTERNAL, message: `session store read failed: ${stripPaths(textOf(e.reason))}` };
  const errno = e as NodeJS.ErrnoException;
  if (typeof errno?.code === "string") return { code: ERR.INTERNAL, message: `archive marker store failed: ${errno.code}${errno.syscall ? ` (${errno.syscall})` : ""}` };
  return { code: ERR.INTERNAL, message: `archive marker store failed: ${stripPaths(textOf(e))}` };
}
const textOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `thread/archive` — put a cold session on the shelf.
 *
 *  The live-guard is checked TWICE, and the second check is the whole of D-M5-10's convergence claim (plan
 *  review F12): the existence read between them is an `await`, and a `thread/resume` admitted inside it
 *  holds only its reservation — or lands a full record — while this handler is already past its entry
 *  guard. So the marker is created first and then re-examined; if a resume won the race the marker is
 *  taken back out and the request refuses BUSY.
 *
 *  WHAT THAT DOES AND DOES NOT BUY (corrected after review — the earlier flat claim that "archived AND
 *  live is never a state a client can observe, in either arrival order" was false in both directions for
 *  the third admission surface). No TRANSITION THIS SERVER MEDIATES can leave the pair true, in either
 *  arrival order: all three admission surfaces the spec names (`thread/resume`/`thread/fork` through
 *  `startThread`, resume-carrying `thread/start`, `thread/attach`) take the session off the shelf through
 *  one `autoUnarchive`, each stamps its resume target on the record EAGERLY so the guard below can see an
 *  admission the engine has not yet reported an id for, and the guard refuses a session held by a live
 *  ccx process elsewhere on this machine too. What it does NOT cover is another PROCESS writing a marker
 *  for a thread live here — no in-process guard can, which is exactly why markers are re-read per request
 *  (D-M5-3) rather than cached, and why a `thread/attach` REJOIN, which is not an admission and mints
 *  nothing, leaves such a marker where it found it.
 *
 *  Refusing rather than unarchiving on the loss is deliberate: this request asked to shelve a session that
 *  is now open, and answering `{ok:true}` for an archive whose marker was immediately removed would be a
 *  receipt for something that did not happen. */
export const threadArchive: Handler = async (srv, ctx, id, params) => {
  const parsed = threadIdParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  // The session library's ONE id rule (sessionLib.ts's resolveThreadId, never re-implemented): a `thr_…`
  // id resolves through the registry, anything else is a bare store id passed through — which is what
  // lets a client shelve a session this server has never opened by the same call it names a live one.
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  const sessionId = resolved.sessionId;
  // FIRST, ahead of the existence read, and not merely for cheapness: a thread admitted this tick has no
  // persisted row yet, so asking the store about it would answer THREAD_NOT_FOUND for a session the client
  // is demonstrably holding. "It is live" is the truer refusal, and it is the one the client can act on.
  if (await liveAnywhere(srv, sessionId)) { ctx.peer.replyError(id, ERR.BUSY, LIVE_REFUSAL); return; }
  const deps = { ccxDir: srv.deps.ccxDir };
  try {
    if (!(await knows(srv, sessionId))) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
    await createArchiveMarker(sessionId, deps);
    if (await liveAnywhere(srv, sessionId)) {
      await removeArchiveMarker(sessionId, deps);
      ctx.peer.replyError(id, ERR.BUSY, LIVE_REFUSAL); return;
    }
  } catch (e) { const r = storeRefusal(e); ctx.peer.replyError(id, r.code, r.message); return; }
  ctx.peer.reply(id, { ok: true });
  // Announced on every SUCCESSFUL call, including an idempotent repeat. The store cannot tell a fresh
  // transition from a repeat — an `EEXIST` and a created marker leave byte-identical results, which is
  // exactly why the marker is a marker — so a handler that announced only "real" transitions would be
  // claiming knowledge it does not have. `sessionId`, not `threadId`: thread/delete's precedent, and the
  // only identity a cold session has. Push freshness is per-server by design (D-M5-3): another server's
  // clients learn from the marker on their next request, not from this line.
  srv.broadcastServer("thread/archived", { sessionId });
};

/** `thread/unarchive` — take it back off. Deliberately NOT live-guarded, which is the one place the two
 *  methods are asymmetric: admission itself unarchives (D-M5-21), so refusing a live thread here would
 *  refuse the very state this server produces. */
export const threadUnarchive: Handler = async (srv, ctx, id, params) => {
  const parsed = threadIdParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  const sessionId = resolved.sessionId;
  const deps = { ccxDir: srv.deps.ccxDir };
  try {
    // MARKER first, store second, and the short-circuit is the point rather than an optimization: a
    // session the store has since deleted can still have a marker, and unarchiving is the only way to
    // clear one. Refusing there would leave permanent state no client could reach.
    if (!(await listArchived(deps)).has(sessionId) && !(await knows(srv, sessionId))) {
      ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return;
    }
    await removeArchiveMarker(sessionId, deps);
  } catch (e) { const r = storeRefusal(e); ctx.peer.replyError(id, r.code, r.message); return; }
  ctx.peer.reply(id, { ok: true });
  srv.broadcastServer("thread/unarchived", { sessionId });
};
