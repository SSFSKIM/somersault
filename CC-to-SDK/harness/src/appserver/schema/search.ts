// src/appserver/schema/search.ts — the search domain's params AND results (spec D-M5-15/16/17/19).
import { z } from "zod/v4";
import { archivedParam } from "./core.js";
import { SEARCH_CAPS } from "../searchScan.js";

/** `searchTerm` PUBLISHES its bounds, taken from `SEARCH_CAPS` so there is one number and not two (fix
 *  wave H / H4). It used to carry them only in the handler and only in prose: the generated stable schema
 *  therefore said `"type":"string"` with no `minLength`/`maxLength`, and a client validating against the
 *  published contract accepted requests both methods then refused `-32602`. A zod refinement here IS the
 *  published contract — it emits into the vendored client-facing artifact — so a bound that lives only in
 *  a handler is a bound the contract does not have. The handler's own copy of the check is gone with it:
 *  zod answers first, so a second spelling could only ever be unreachable code that drifts.
 *
 *  `limit` is `positive()` and deliberately UNBOUNDED above: over-cap CLAMPS with a `warning` rather than
 *  refusing (D-M5-17, the `thread/read` precedent), so a schema max would turn the one branch the spec
 *  chose into the one it rejected.
 *
 *  `cursor` is an OPAQUE server-minted string (base64url of `{v,s,r,q,g}` — searchScan.ts's codec), unlike
 *  `thread/list`'s decimal offset and `thread/read`'s `"<epoch>:<row>"`: it is a keyset naming the next
 *  (sortValue, sessionId, rowIndex) position to examine, and a client that composed one by hand would be
 *  composing a position in an ordering it cannot see. Garbage — including a forged row offset or a
 *  non-finite sort value — refuses. So does a cursor whose WALK moved (D-M5-26): `q` fingerprints the
 *  query it was minted under and `g` stamps the generation of the transcript its row offset addresses, and
 *  a mismatch in either refuses rather than answering a plausible page for a walk nobody asked for. */
export const threadSearchParams = z.object({
  searchTerm: z.string().min(SEARCH_CAPS.minTerm).max(SEARCH_CAPS.maxTerm).describe("case-insensitive literal substring, 2–256 UTF-16 units; outside that range refuses -32602"),
  // `.min(1)` is redundant for enforcement — `""` decodes to `null` and refuses `-32602` one door in, the
  // same code either way — and kept for PUBLICATION: it emits `minLength: 1` into the stable JSON schema,
  // which is where a client learns the bound without reading our decoder.
  cursor: z.string().min(1).optional().describe("opaque keyset cursor from a previous reply's nextCursor; never client-composed. Bound to the query it was minted under and to the generation of the transcript it resumes inside: re-issue the SAME searchTerm/sortKey/sortDirection/archived/cwd, or start a fresh walk. Refuses -32602 otherwise"),
  limit: z.number().int().positive().optional().describe("results per page, default 20; over 50 is clamped to 50 with a `warning` notification"),
  sortKey: z.enum(["created_at", "updated_at", "recency_at"]).default("created_at")
    .describe("created_at is the only key stable across pages — updated_at/recency_at (both ≡ the store's lastModified) can move a session between requests, and keyset semantics then allow it to be re-encountered or skipped; use created_at for an exhaustive walk"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  // core.ts's shared `archivedParam` (M5 Task 10), spread in AT THIS POSITION so the generated artifact
  // keeps the field order it shipped with: `thread/list` publishes the same partition off the same object,
  // and the spec states it for the two methods in one sentence.
  ...archivedParam.shape,
  cwd: z.string().optional().describe("scopes the store listing to one project directory"),
});

/** `thread` is the SAME projection `thread/list` serves — a live row where this server holds the session,
 *  the store-only row otherwise — so a client renders a search hit with the code it already has. `snippet`
 *  is a window centered on the match, at most `max(200, <the match's own length in the row>)` units — and
 *  that second term is NOT `searchTerm.length` (fix wave G / P2-2#5), which is what this said and what a
 *  256-unit term of `İ` disproved: it case-folds to 512 units, matches 512 units of an already-decomposed
 *  row, and the snippet must hold all 512 or `snippetMatchRange` would describe text the excerpt does not
 *  carry. Exactly one code point in Unicode lengthens under folding (U+0130, one unit to two — swept), so
 *  the bound a client can compute without folding anything is `max(200, 2 × searchTerm.length)`. The claim
 *  was corrected rather than the window narrowed: a snippet that cannot hold its own match would break the
 *  stronger promise, which is that `snippet.slice(start, end)` IS the matched text in the row's real casing.
 *
 *  `nextCursor` non-null with an EMPTY `data` is a legitimate, expected reply (D-M5-16): the per-page caps
 *  bound work, never coverage, so a page that spent its budget without a hit reports bounded progress
 *  rather than a false "no matches". A client pages until `nextCursor` is null.
 *
 *  `skipped` is omitted when zero and counts rows too large to search (over 1,048,576 UTF-16 units) —
 *  D-M5-8's disclosure half: "no matches" is a claim about what was actually scanned. */
export const threadSearchResult = z.object({
  data: z.array(z.object({ thread: z.record(z.string(), z.unknown()), snippet: z.string() })),
  nextCursor: z.string().nullable(),
  skipped: z.number().int().optional(),
});

/** Task 8's sibling method: ONE thread, EVERY hit in a row. `threadId` accepts either spelling the session
 *  library accepts (a `thr_…` registry id or a bare store sessionId — sessionLib.ts's `resolveThreadId`),
 *  which is what lets a client search a session this server never opened by the same call it searches a
 *  live one; a `threadId` the store does not know refuses `THREAD_NOT_FOUND` rather than answering an
 *  empty page (D-M5-20).
 *
 *  `searchTerm` and `limit` are deliberately the SAME shapes as `thread/search`'s above, for the reasons
 *  stated there (the bounds are published from `SEARCH_CAPS`; over-cap clamps rather than refuses). `cursor` is
 *  its own codec — base64url of `{s,r,c,q,g}`, a row offset PLUS a character offset within that row, so a
 *  page boundary can land between two occurrences of ONE row — and it is GENERATION-QUALIFIED with no
 *  exemption (D-M5-26): a rewind truncates rows, so a cursor minted at an earlier generation is refused
 *  (`-32602`, the pager's own message) rather than silently resumed against different content, and that
 *  holds for a COLD session too, whose generation is stamped from the store's own metadata. `q` binds the
 *  cursor to its search term for the same reason, in its own sentence. */
export const threadSearchOccurrencesParams = z.object({
  threadId: z.string().min(1).describe("a `thr_…` registry id or a bare store sessionId; one the store does not know refuses -33004"),
  searchTerm: z.string().min(SEARCH_CAPS.minTerm).max(SEARCH_CAPS.maxTerm).describe("case-insensitive literal substring, 2–256 UTF-16 units; outside that range refuses -32602"),
  cursor: z.string().min(1).optional().describe("opaque occurrence cursor from a previous reply's nextCursor; bound to the search term and to the transcript's generation (live or cold), and refused -32602 after a rewind or under a different term"),
  limit: z.number().int().positive().optional().describe("occurrences per page, default 20; over 50 is clamped to 50 with a `warning` notification"),
});

/** One occurrence. `snippetMatchRange` is Codex's field name, verbatim, and indexes into THIS occurrence's
 *  own `snippet` — not into the row — because the snippet is a window and two hits in one row are two
 *  different windows. Its ends are the match's span mapped back onto the ORIGINAL row (searchScan.ts's
 *  `originalSpan`, the same primitive that cut the snippet), so `snippet.slice(start, end)` is the matched
 *  text carrying the row's real casing, and a case fold that changes UTF-16 length cannot make the range
 *  describe a stretch the snippet does not hold. A match edge landing INSIDE such an expansion resolves
 *  outward, so the range covers every original character any part of which matched.
 *
 *  `uuid` is the ROW's own durable identity, standing in for Codex's `turnId`/`itemId` pair (documented
 *  deviation, D-M5-6), and is `null` — not absent — for a row that carries none: a client keying a jump
 *  list on it must be able to tell "this row has no id" from "the server forgot to send one".
 *
 *  `readCursor` is the jump (D-M5-7): the server-composed, epoch-qualified `thread/read` cursor whose
 *  window ENDS at the hit row, which a client passes back unchanged. `null` means NO JUMP IS AVAILABLE for
 *  this occurrence, and two row states earn it. A cold session: the pager is live-only and refuses an
 *  unqualified cursor, so there is no honest string to compose (a client that wants to page a cold
 *  transcript resumes it first). A NESTED (subagent) row: the pager discards every frame carrying
 *  `parent_tool_use_id`, so no window it can produce holds that row at any `limit`. The occurrence itself is
 *  still returned in both cases — `rowOffset`, `uuid`, `snippet` and `snippetMatchRange` are true of the row
 *  either way, and the corpus is unchanged — so a client renders the hit and simply offers no jump for it.
 *
 *  `nextCursor` non-null over an EMPTY `data` is legitimate and expected, exactly as in `thread/search`:
 *  the per-page row cap bounds work, never coverage. `skipped` (omitted when zero) counts rows too large
 *  to search — D-M5-8's disclosure half. */
export const threadSearchOccurrencesResult = z.object({
  data: z.array(z.object({
    rowOffset: z.number().int(),
    uuid: z.string().nullable(),
    snippet: z.string(),
    snippetMatchRange: z.object({ start: z.number().int(), end: z.number().int() }),
    readCursor: z.string().nullable(),
  })),
  nextCursor: z.string().nullable(),
  skipped: z.number().int().optional(),
});
