// src/appserver/search.ts — M5 §search: `thread/search`, the store searched (spec D-M5-15/16/17, D-M5-8).
// The primitives (one tuple ordering, the cursor codec, the corpus classifier, the snippet window) live in
// searchScan.ts; this file is the SCAN — the part that talks to the store, spends the per-page budget and
// answers on the wire. Task 8's `thread/searchOccurrences` joins it here and reuses `runScanExclusive`.
//
// The shape of the loop is the whole design, and it is not obvious, so: ordering is GLOBAL and the scan is
// PAGED. Every session's metadata is sorted in memory (metadata is cheap; transcripts are not), and the
// cursor is a keyset over that one ordering — `(sortValue, sessionId, rowIndex)` naming the NEXT position
// to examine, never a bare session locator that would restart at the top when its session vanished. Inside
// a session the transcript is read in ROW WINDOWS at the storage boundary, because the caps exist to bound
// memory and a whole-transcript read followed by a row count would spend exactly what they bound.
import { ERR } from "./rpc.js";
import { threadView, type AppServer, type Handler } from "./server.js";
import { findLiveBySessionId, resolveThreadId, storeKnows, storeOnlyView } from "./sessionLib.js";
import { inArchivedPartition, listArchived } from "./archive.js";
import { storeRefusal } from "./archiveDomain.js";
import { SEARCH_CAPS, compareTuple, decodeOccCursor, decodeSearchCursor, encodeOccCursor, encodeSearchCursor, makeSnippet, originalSpan, rowSearchText, sortForSearch, sortValueOf } from "./searchScan.js";
import { threadSearchOccurrencesParams, threadSearchParams } from "./schema/search.js";
import { listSessions as realListSessions, getSessionMessages as realGetSessionMessages } from "../sessions/index.js";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";

type GetMessages = (sessionId: string, opts?: { limit?: number; offset?: number }) => Promise<unknown[]>;

/** ONE bounded row window at the STORAGE boundary — the read half both scans share. `null` means the page's
 *  row budget is already spent, reported BEFORE any store call and left for the caller to answer, because
 *  the two methods mint different cursor shapes at exactly this point. `want` rides back out beside the rows
 *  because a SHORT window is how either scan learns the transcript is exhausted, and re-deriving it at the
 *  call site would be the second spelling of one number.
 *
 *  The bound is applied to the store's own `limit` rather than to a slice afterwards: the caps exist to
 *  bound MEMORY, and a whole-transcript read followed by a row count spends exactly what they bound. */
async function readWindow(getMessages: GetMessages, sessionId: string, row: number, rowsScanned: number): Promise<{ win: unknown[]; want: number } | null> {
  const want = Math.min(SEARCH_CAPS.windowRows, SEARCH_CAPS.maxRowsPerPage - rowsScanned);
  if (want <= 0) return null;
  return { win: await getMessages(sessionId, { offset: row, limit: want }), want };
}

/** ONE content scan at a time per server (D-M5-17), the same device `record.chain` is for a thread — a
 *  per-server promise chain, keyed on the server so nothing outlives it. A search is the only handler that
 *  can read thousands of transcript rows off disk, and N concurrent clients searching would multiply the
 *  budget the caps were computed for by N. Exported because Task 8's per-thread search queues on the SAME
 *  chain: the resource being protected is this process's disk read rate, not one method's.
 *
 *  `prev.catch()` before `.then(fn)`: a failed scan must not poison the queue behind it (the next request
 *  is unrelated), and the STORED link is `run.catch(...)` so a rejection settled by the caller's own
 *  try/catch is never also an unhandled rejection here. */
const scanChains = new WeakMap<AppServer, Promise<unknown>>();
export function runScanExclusive<T>(srv: AppServer, fn: () => Promise<T>): Promise<T> {
  const prev = scanChains.get(srv) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  scanChains.set(srv, run.catch(() => {}));
  return run;
}

/** A hit's `thread` is the same projection `thread/list` serves, chosen the same way: a session this server
 *  holds LIVE renders as its registry row (fresher — it carries the turn/settings state the store cannot
 *  know), everything else as the store-only projection. A client must not be able to tell a searched row
 *  from a listed one. */
export function viewFor(srv: AppServer, info: SDKSessionInfo): Record<string, unknown> {
  const live = findLiveBySessionId(srv, info.sessionId);
  return live ? threadView(srv, live) : storeOnlyView(info);
}

export const threadSearch: Handler = async (srv, ctx, id, params) => {
  const parsed = threadSearchParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { searchTerm, sortKey, sortDirection: dir, archived, cwd } = parsed.data;
  const termLen = searchTerm.length;
  if (termLen < SEARCH_CAPS.minTerm || termLen > SEARCH_CAPS.maxTerm) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `searchTerm must be ${SEARCH_CAPS.minTerm}-${SEARCH_CAPS.maxTerm} UTF-16 units`); return;
  }
  // A cursor this server did not mint (or minted for the OTHER codec, or carrying an out-of-range row
  // offset) is refused, not repaired: D-M5-16a. Resuming a transcript at a row the cursor did not name is
  // exactly the intra-file skip/repeat the keyset exists to eliminate.
  const cursor = parsed.data.cursor === undefined ? null : decodeSearchCursor(parsed.data.cursor);
  if (parsed.data.cursor !== undefined && cursor === null) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid cursor"); return; }
  // CLAMP, not refuse (D-M5-17, `thread/read`'s precedent) — `limit` is the one client-authored number in
  // this request, so there is a client intent to be generous toward, and the adjustment is disclosed.
  let limit = parsed.data.limit ?? SEARCH_CAPS.defaultLimit;
  if (limit > SEARCH_CAPS.maxLimit) {
    limit = SEARCH_CAPS.maxLimit;
    srv.warn(ctx.peer, "limitClamped", `thread/search limit clamped to ${SEARCH_CAPS.maxLimit}`);
  }
  const termLc = searchTerm.toLowerCase();
  const listFn = srv.deps.listSessions ?? ((o: { cwd?: string }) => realListSessions(o));
  const getMessages = srv.deps.getSessionMessages ?? ((sid: string, o?: { limit?: number; offset?: number }) => realGetSessionMessages(sid, o));

  try {
    await runScanExclusive(srv, async () => {
      const all = (await listFn({ cwd })) as SDKSessionInfo[];
      // Archived-ness is THIS server's state, not the store's (D-M5-3): a marker directory re-read per
      // request, so another process's archive/unarchive is visible to the very next search.
      //   The `try` wraps `listArchived` ALONE — never the scan around it. The outer catch below answers
      // `e.message` verbatim, which for an fs errno is node's own text ending in the operator's absolute
      // home path; widening this one to cover `listFn` or the transcript reads instead would label a
      // SESSION-store failure as the marker store's. `storeRefusal` is archiveDomain's, reused rather than
      // re-spelled, so this store's two readers describe its failures exactly as its two writers do.
      let archivedSet: Set<string>;
      try { archivedSet = await listArchived({ ccxDir: srv.deps.ccxDir }); }
      catch (e) { const r = storeRefusal(e); ctx.peer.replyError(id, r.code, r.message); return; }
      const wantArchived = archived === true;
      const rows = all.filter((r) => inArchivedPartition(archivedSet, r.sessionId, wantArchived));
      // BOTH the sort and every cursor mint go through `sortValueOf` — never a bespoke callback. The
      // `Number.isFinite` screen lives in there (D-M5-15a), and a comparator handed a NaN returns NaN,
      // which `Array.prototype.sort` reads as "no opinion" and answers with unrelated sessions unordered.
      const valueOf = (r: SDKSessionInfo) => sortValueOf(r, sortKey);
      const sorted = sortForSearch(rows, dir, valueOf);
      const tupleOf = (info: SDKSessionInfo) => ({ v: valueOf(info), s: info.sessionId });
      // Resume by TUPLE, not by session id: the cursor's own session may have been deleted, renamed out of
      // the filter, or moved by an `updated_at` sort between pages, and the first session at-or-after the
      // cursor in the requested direction is the honest answer in every one of those cases. -1 means every
      // remaining session sorts before the cursor — the walk is over, and the loop below simply does not run.
      const found = cursor ? sorted.findIndex((r) => compareTuple(tupleOf(r), cursor, dir) >= 0) : 0;
      const startIdx = found < 0 ? sorted.length : found;

      const data: { thread: Record<string, unknown>; snippet: string }[] = [];
      let filesScanned = 0, rowsScanned = 0, skipped = 0;
      let nextCursor: string | null = null;

      scan: for (let i = startIdx; i < sorted.length; i++) {
        const info = sorted[i];
        const tup = tupleOf(info);
        // `rowIndex` applies ONLY to the session the cursor names; every other session starts at row 0.
        const startRow = cursor && compareTuple(tup, cursor, dir) === 0 ? cursor.r : 0;
        /** The cursor for "this session is finished, continue at the next one". */
        const afterThis = (): string | null => (i + 1 < sorted.length ? encodeSearchCursor({ ...tupleOf(sorted[i + 1]), r: 0 }) : null);

        // The METADATA corpus: free (it is already in memory from the listing), and checked on EVERY page
        // including a mid-file resume. It cannot double-report — a metadata hit `continue`s without ever
        // content-scanning the session, so no cursor can name that session with `startRow > 0` — while
        // skipping it on resume can under-report: a `thread/name/set` landing between pages renames a
        // session whose earlier page already passed its metadata, and a `startRow === 0` guard then reports
        // it ZERO times (measured). D-M5-16 is explicit that caps bound work, never coverage, and the guard
        // saved at most four `toLowerCase()` calls per request — at most one session per page resumes mid-file.
        {
          let hit = "";
          let span: { at: number; len: number } | null = null;
          for (const field of [info.customTitle, info.summary, info.firstPrompt, info.tag]) {
            if (typeof field !== "string") continue;
            const lc = field.toLowerCase();
            const i = lc.indexOf(termLc);
            // Lowered SPAN → ORIGINAL span: the match is located in `lc` but the snippet is cut from
            // `field` (the wire must carry the row's real casing), and searchScan.ts owns that mapping —
            // both ends of it, since `termLc.length` is the match's length in `lc` and not in `field`.
            if (i >= 0) { hit = field; span = originalSpan(field, lc, i, termLc.length); break; }
          }
          if (span) {
            data.push({ thread: viewFor(srv, info), snippet: makeSnippet(hit, span.at, span.len).snippet });
            if (data.length >= limit) { nextCursor = afterThis(); break scan; }
            continue;
          }
        }
        // Budget checked BEFORE opening another transcript, and the cursor minted at this session's own
        // tuple — the next page re-examines exactly where this one stopped. A zero-hit page with a non-null
        // cursor is the honest report of bounded progress (D-M5-16), never a "no matches" claim.
        //   The row-cap half is REACHABLE but not OBSERVABLE, and the distinction matters to whoever
        // refactors the window loop. Reachable: a session whose hit lands on the last budgeted row exits
        // through `break read` with `rowsScanned` exactly at the cap and `limit` not yet spent, so the next
        // session arrives here with the clause true (constructed and instrumented firing). Not observable:
        // the window loop's own `want <= 0` mints the identical cursor before any store read, so deleting
        // the clause leaves the wire bytes AND the store-call log unchanged. Kept as the backstop if that
        // bound ever changes — but re-check it against this reason, not against a claim of dead code.
        if (filesScanned >= SEARCH_CAPS.maxFilesPerPage || rowsScanned >= SEARCH_CAPS.maxRowsPerPage) {
          nextCursor = encodeSearchCursor({ ...tup, r: startRow }); break scan;
        }
        filesScanned++;
        let row = startRow;
        let hitHere = false;
        read: for (;;) {
          // The window is the smaller of one window and what is left of the page's row budget, so the cap
          // is enforced AT THE STORAGE BOUNDARY rather than after the rows are already in memory
          // (`readWindow`, shared with `thread/searchOccurrences` below).
          const w = await readWindow(getMessages, info.sessionId, row, rowsScanned);
          if (!w) { nextCursor = encodeSearchCursor({ ...tup, r: row }); break scan; }
          for (const message of w.win) {
            rowsScanned++; row++;
            const text = rowSearchText(message);
            if (text === null) continue;
            // Too big to search — DISCLOSED, never silently dropped: `skipped` is what keeps "no matches"
            // an honest claim about what was actually read (D-M5-8).
            if (text.length > SEARCH_CAPS.maxRowUnits) { skipped++; continue; }
            const lc = text.toLowerCase();
            const i = lc.indexOf(termLc);
            if (i >= 0) {
              // Same mapping as the metadata corpus above, through the same primitive — one spelling of
              // this arithmetic in this file, so Task 8's `snippetMatchRange` cannot drift from the snippet.
              const s = originalSpan(text, lc, i, termLc.length);
              data.push({ thread: viewFor(srv, info), snippet: makeSnippet(text, s.at, s.len).snippet });
              hitHere = true; break read;
            }
          }
          if (w.win.length < w.want) break read; // short window = this session is exhausted
        }
        // `hitHere &&` is redundant and kept as documentation, not as a guard: every push is followed
        // immediately by its own `>= limit` break, so a session is only ever entered with `data.length <
        // limit`, and reaching the cap HERE therefore implies this session is what pushed. It names the
        // condition the reader would otherwise have to re-derive; removing it would also strand `hitHere`.
        if (hitHere && data.length >= limit) { nextCursor = afterThis(); break scan; }
      }
      ctx.peer.reply(id, { data, nextCursor, ...(skipped ? { skipped } : {}) });
    });
  } catch (e) {
    // D-M5-8: a store read failure is an ERROR. Never an empty page, and never the hits gathered before it
    // failed — both would claim the store was searched when it was not.
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};

/** One occurrence on the wire (schema/search.ts carries the field-by-field contract). */
interface Occurrence { rowOffset: number; uuid: string | null; snippet: string; snippetMatchRange: { start: number; end: number }; readCursor: string | null }

/** The row's own durable identity — Codex publishes a `turnId`/`itemId` pair here and our store records a
 *  per-row uuid instead (documented deviation, D-M5-6). NULL rather than omitted when a row carries none: a
 *  client keying a jump list on it must be able to tell "this row has no id" from "the server forgot to send
 *  one", and an absent key reads as the second. */
const rowUuid = (m: unknown): string | null => { const u = (m as { uuid?: unknown }).uuid; return typeof u === "string" ? u : null; };

/** A NESTED (subagent) row — and therefore a row with no jump. The transcript pager discards every frame
 *  carrying `parent_tool_use_id`: items/mapper.ts's `ingest` returns `[]` for one before its own type
 *  routing, and items/replay.ts repeats the predicate on its direct user path so a persisted nested prompt
 *  cannot surface as a top-level message either. So a nested row appears in NO window `thread/read` can
 *  produce, at any `limit`, and a composed `readCursor` for it would name a page not containing the match.
 *
 *  It stays in the CORPUS — that is `rows.ts`'s classification and `thread/search` reports the same session
 *  for the same text, so excluding it here would make the two methods disagree and would move `rowOffset`,
 *  the continuation cursor's `c` and every page boundary. `rowOffset` and `uuid` stay published too: they
 *  are the row's identity and remain true of it. Only the JUMP is impossible, so only the jump is withheld,
 *  through this method's EXISTING "no jump available" value — `readCursor: null`, exactly what a cold
 *  session mints. Publishing a string instead is the very thing this handler refuses metadata for: a jump
 *  target that cannot be jumped to. */
const rowIsNested = (m: unknown): boolean => Boolean((m as { parent_tool_use_id?: unknown }).parent_tool_use_id);

/** `thread/searchOccurrences` — the same scan narrowed to ONE thread and widened to EVERY hit in a row
 *  (spec D-M5-7). Three things make it its own handler rather than a flag on the one above:
 *
 *  1. It PUBLISHES `snippetMatchRange` (Codex's field name, verbatim) off `originalSpan` — the same
 *     primitive the snippet is cut with, so the range and the excerpt cannot disagree about where the match
 *     is. Where a wrong span cost `thread/search` an off-centre excerpt, here it is a wrong published range,
 *     and wrong at the FIRST length-changing code point rather than at some exotic threshold.
 *  2. Its cursor is a row offset PLUS a character offset within that row, so a page boundary can land
 *     between two occurrences of one row — and on a live thread it is EPOCH-QUALIFIED and refused on
 *     mismatch, exactly as `thread/read`'s is: a rewind truncates rows, and an unqualified cursor would
 *     silently resume against different content.
 *  3. It answers the jump: `readCursor` is the pager's own cursor for the hit row, composed here so a client
 *     pastes it into `thread/read` unchanged — or `null` where the pager cannot be sent to that row at all
 *     (`rowIsNested` above, and a cold session), because a jump target that cannot be jumped to is the one
 *     thing this method refuses to publish.
 *
 *  What it deliberately does NOT do is search metadata. The store-wide search reports a session because its
 *  title matches; there is no ROW to anchor such a hit to, and an occurrence whose `rowOffset` named nothing
 *  would be a jump target that cannot be jumped to. */
export const threadSearchOccurrences: Handler = async (srv, ctx, id, params) => {
  const parsed = threadSearchOccurrencesParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { searchTerm } = parsed.data;
  const termLen = searchTerm.length;
  if (termLen < SEARCH_CAPS.minTerm || termLen > SEARCH_CAPS.maxTerm) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `searchTerm must be ${SEARCH_CAPS.minTerm}-${SEARCH_CAPS.maxTerm} UTF-16 units`); return;
  }
  // The session library's ONE id rule (sessionLib.ts's resolveThreadId, never re-implemented): a `thr_…` id
  // resolves through the registry, anything else is a bare store id passed through — which is what lets a
  // client search a session this server has never opened by the same call it searches a live one.
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  const sessionId = resolved.sessionId;
  const cursor = parsed.data.cursor === undefined ? null : decodeOccCursor(parsed.data.cursor);
  if (parsed.data.cursor !== undefined && cursor === null) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid cursor"); return; }
  // A cursor names the session it was minted for, and `s` is CHECKED rather than merely carried: its row and
  // character offsets mean nothing in another transcript, so honouring one here would resume a different
  // conversation at a position nothing computed — the same refuse-never-repair rule searchScan.ts's decoder
  // states for a forged row offset (D-M5-16a). Compared against the RESOLVED id, so the two spellings of one
  // thread (its registry id, its bare store id) mint interchangeable cursors.
  if (cursor && cursor.s !== sessionId) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid cursor"); return; }
  // CLAMP, not refuse — `limit` is the one client-authored number in this request (D-M5-17, `thread/read`'s
  // precedent), exactly as in the store-wide search above.
  let limit = parsed.data.limit ?? SEARCH_CAPS.defaultLimit;
  if (limit > SEARCH_CAPS.maxLimit) {
    limit = SEARCH_CAPS.maxLimit;
    srv.warn(ctx.peer, "limitClamped", `thread/searchOccurrences limit clamped to ${SEARCH_CAPS.maxLimit}`);
  }
  const termLc = searchTerm.toLowerCase();
  const getMessages = srv.deps.getSessionMessages ?? ((sid: string, o?: { limit?: number; offset?: number }) => realGetSessionMessages(sid, o));

  try {
    // The SAME per-server chain `thread/search` queues on: the resource being rationed is this process's
    // disk read rate, not one method's, and the existence read below is a store read like any other.
    await runScanExclusive(srv, async () => {
      // Read the live record INSIDE the exclusive section, once, so the epoch the refusal below checks is
      // the epoch the mint at the bottom writes. A rewind can land while this request waits its turn on the
      // chain, and a check taken before that wait would qualify the reply against a generation that no
      // longer exists.
      const live = findLiveBySessionId(srv, sessionId);
      // D-M5-20: a session the store does not know REFUSES, rather than answering an honest-looking empty
      // page over a typo — the D-M5-8 lie in miniature. Asked of the store only when no live record backs
      // the id: a thread started this tick exists and may be searched before its first row is ever
      // persisted, and asking the store about it would refuse the very thread the client is holding.
      // `live record OR store row` is THIS method's admission rule; Task 9's two are different ones. What
      // is shared with them is the lookup underneath (sessionLib.ts's `storeKnows`), never the rule.
      if (!live && !(await storeKnows(srv, sessionId))) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      // Epoch qualification — `thread/read`'s rule, and its message verbatim (subscribe.ts), because a
      // client that pages both should match one string. The two live arms are one condition: the thread is
      // gone, or it is here at a different generation. `e: null` is a COLD mint and passes unqualified — a
      // store session has no generation counter to compare against, and the store's immutability between
      // requests is the documented assumption (D-M5-7).
      if (cursor && cursor.e !== null && (!live || cursor.e !== live.epoch)) {
        ctx.peer.replyError(id, ERR.INVALID_PARAMS, "cursor invalidated by a rewind; re-read from the start"); return;
      }
      // ONE epoch read per request, and every generation-carrying string in the reply is composed from it —
      // the continuation cursor's `e` AND every occurrence's `readCursor`. `record.epoch` is mutable and a
      // rewind can land between two window reads, so a second read here would ship a reply whose two cursor
      // families disagree about which generation they belong to. It also fails in the safe direction: after
      // such a rewind both cursors carry the SUPERSEDED generation, so `thread/read` and this method both
      // refuse them, where the fresh epoch would silently address post-truncation rows at pre-truncation
      // offsets. `null` here is exactly `!live` (a live record always has a numeric epoch, from registration).
      const epoch = live ? live.epoch : null;
      const data: Occurrence[] = [];
      let rowsScanned = 0, skipped = 0;
      let nextCursor: string | null = null;
      let row = cursor ? cursor.r : 0;
      scan: for (;;) {
        const w = await readWindow(getMessages, sessionId, row, rowsScanned);
        // The page's row budget, spent before this window opened. A zero-occurrence page with a non-null
        // cursor is the honest report of bounded progress (D-M5-16), never a "no matches" claim.
        if (!w) { nextCursor = encodeOccCursor({ s: sessionId, r: row, c: 0, e: epoch }); break scan; }
        for (const message of w.win) {
          const rowOffset = row;
          rowsScanned++; row++;
          const text = rowSearchText(message);
          if (text === null) continue;
          // Too big to search — DISCLOSED, never silently dropped (D-M5-8's disclosure half).
          if (text.length > SEARCH_CAPS.maxRowUnits) { skipped++; continue; }
          const lc = text.toLowerCase();
          // `c` is an offset into the LOWERED row (it is `indexOf`'s own return, plus one) and applies ONLY
          // to the row the cursor names; every later row starts at 0. Applying it to all of them would skip
          // the first `c` units of every subsequent row, losing a hit that sits at the head of one.
          const fromChar = cursor && cursor.r === rowOffset ? cursor.c : 0;
          // Read ONCE per row, beside the row's other identity, because the jump is a property of the ROW
          // and not of the occurrence: every hit in a nested row is equally unreachable.
          const nested = rowIsNested(message);
          // `at + 1`, not `at + termLc.length`: overlapping occurrences are real occurrences ("aa" sits at
          // three offsets in "aaaa"), and the mint below carries the same +1, so a page boundary inside a
          // row can neither skip one nor repeat one. This `at >= 0` guard also owns `originalSpan`'s
          // documented `atLowered >= 0` precondition — handed a miss's -1 the primitive maps it through.
          for (let at = lc.indexOf(termLc, fromChar); at >= 0; at = lc.indexOf(termLc, at + 1)) {
            // ONE spelling of this arithmetic in this file: the match is located in `lc`, the snippet is cut
            // from `text`, and the published range is the SAME span the cut used — so a case fold that
            // changes UTF-16 length cannot make the range describe a stretch the snippet does not hold.
            const span = originalSpan(text, lc, at, termLc.length);
            const { snippet, snippetMatchRange } = makeSnippet(text, span.at, span.len);
            data.push({
              rowOffset, uuid: rowUuid(message), snippet, snippetMatchRange,
              // The jump (D-M5-7): the pager's cursor is `"<epoch>:<rowOffset>"` with an EXCLUSIVE upper
              // bound, so `+1` is what makes the window it returns END at the hit row. `null` is "no jump
              // available", and TWO row states earn it: a cold session has no epoch and `thread/read`
              // refuses an unqualified cursor, and a NESTED row (`rowIsNested` above) sits in no window the
              // pager can produce. Both would otherwise publish a string the client cannot land.
              readCursor: epoch === null || nested ? null : `${epoch}:${rowOffset + 1}`,
            });
            if (data.length >= limit) { nextCursor = encodeOccCursor({ s: sessionId, r: rowOffset, c: at + 1, e: epoch }); break scan; }
          }
        }
        if (w.win.length < w.want) break scan; // short window = this transcript is exhausted
      }
      ctx.peer.reply(id, { data, nextCursor, ...(skipped ? { skipped } : {}) });
    });
  } catch (e) {
    // D-M5-8 again, and for the same reason: a failed read is an ERROR, never an empty page and never the
    // occurrences gathered before it failed.
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};
