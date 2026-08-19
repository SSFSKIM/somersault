// src/appserver/schema/search.ts — the search domain's params AND results (spec D-M5-15/16/17/19).
import { z } from "zod/v4";

/** `searchTerm` carries no `.min/.max` HERE and is bounded in the handler instead: the two ends answer the
 *  same `-32602` either way, and keeping the check next to `SEARCH_CAPS` is what stops the published bound
 *  and the enforced one from drifting apart (D-M5-17 owns the numbers, and Task 8's sibling method must
 *  read the same ones). The `.describe()` below is where a client learns them.
 *
 *  `limit` is `positive()` and deliberately UNBOUNDED above: over-cap CLAMPS with a `warning` rather than
 *  refusing (D-M5-17, the `thread/read` precedent), so a schema max would turn the one branch the spec
 *  chose into the one it rejected.
 *
 *  `cursor` is an OPAQUE server-minted string (base64url of `{v,s,r}` — searchScan.ts's codec), unlike
 *  `thread/list`'s decimal offset and `thread/read`'s `"<epoch>:<row>"`: it is a keyset naming the next
 *  (sortValue, sessionId, rowIndex) position to examine, and a client that composed one by hand would be
 *  composing a position in an ordering it cannot see. Garbage — including a forged row offset — refuses. */
export const threadSearchParams = z.object({
  searchTerm: z.string().describe("case-insensitive literal substring, 2–256 UTF-16 units; outside that range refuses -32602"),
  // `.min(1)` is redundant for enforcement — `""` decodes to `null` and refuses `-32602` one door in, the
  // same code either way — and kept for PUBLICATION: it emits `minLength: 1` into the stable JSON schema,
  // which is where a client learns the bound without reading our decoder.
  cursor: z.string().min(1).optional().describe("opaque keyset cursor from a previous reply's nextCursor; never client-composed"),
  limit: z.number().int().positive().optional().describe("results per page, default 20; over 50 is clamped to 50 with a `warning` notification"),
  sortKey: z.enum(["created_at", "updated_at", "recency_at"]).default("created_at")
    .describe("created_at is the only key stable across pages — updated_at/recency_at (both ≡ the store's lastModified) can move a session between requests, and keyset semantics then allow it to be re-encountered or skipped; use created_at for an exhaustive walk"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  archived: z.boolean().optional().describe("false/omitted lists only unarchived sessions; true lists only archived ones"),
  cwd: z.string().optional().describe("scopes the store listing to one project directory"),
});

/** `thread` is the SAME projection `thread/list` serves — a live row where this server holds the session,
 *  the store-only row otherwise — so a client renders a search hit with the code it already has. `snippet`
 *  is ≤ max(200, searchTerm.length) units centered on the match.
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
