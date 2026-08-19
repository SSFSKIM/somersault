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
import { findLiveBySessionId, storeOnlyView } from "./sessionLib.js";
import { listArchived } from "./archive.js";
import { SEARCH_CAPS, compareTuple, decodeSearchCursor, encodeSearchCursor, makeSnippet, originalSpan, rowSearchText, sortForSearch, sortValueOf } from "./searchScan.js";
import { threadSearchParams } from "./schema/search.js";
import { listSessions as realListSessions, getSessionMessages as realGetSessionMessages } from "../sessions/index.js";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";

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
      const archivedSet = await listArchived({ ccxDir: srv.deps.ccxDir });
      const wantArchived = archived === true;
      const rows = all.filter((r) => archivedSet.has(r.sessionId) === wantArchived);
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
          // is enforced AT THE STORAGE BOUNDARY rather than after the rows are already in memory.
          const want = Math.min(SEARCH_CAPS.windowRows, SEARCH_CAPS.maxRowsPerPage - rowsScanned);
          if (want <= 0) { nextCursor = encodeSearchCursor({ ...tup, r: row }); break scan; }
          const win = await getMessages(info.sessionId, { offset: row, limit: want });
          for (const message of win) {
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
          if (win.length < want) break read; // short window = this session is exhausted
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
