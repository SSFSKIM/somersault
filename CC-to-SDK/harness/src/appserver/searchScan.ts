// src/appserver/searchScan.ts — pure search primitives (spec D-M5-15/16/17 rev 3). ONE tuple ordering
// shared by the sort and the cursor resume — the rev-1 plan let them diverge and the review caught a
// session locator masquerading as a keyset (F8). The cursor codecs live beside it for the same reason,
// and that is now three of them: `thread/list` re-cursored onto the same comparator and screening (M6),
// so its codec sits here rather than in sessionLib.ts. A second implementation of a keyset is a second
// place to get the null/non-finite screening wrong, which is the class of bug that screening exists for.
import { createHash } from "node:crypto";
import { rowKind, promptText } from "../sessions/index.js";

export const SEARCH_CAPS = { maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowUnits: 1_048_576, maxLimit: 50, defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200, windowRows: 500 } as const;
export type SortKey = "created_at" | "updated_at" | "recency_at";

/** `Number.isFinite` subsumes the `??` it replaces — it rejects NaN, ±Infinity, null and undefined while
 *  keeping `0` — so `compareTuple`'s `a.v - b.v` is total by construction (finite minus finite is never
 *  NaN) and `.sort()` can never read a NaN as "no opinion" and hand back unrelated rows unordered.
 *  Screened HERE and not in a consumer because `encodeSearchCursor` already serializes a non-finite `v`
 *  as `null` (JSON has no NaN): the cursor claims "this session sorts last" for a session the unscreened
 *  comparator does NOT sort last, so the two halves of this one module contradict each other. Screening
 *  the source makes the cursor's claim true and closes both halves at once. Live, not hypothetical:
 *  `lastModified` arrives straight from a bring-your-own `SessionStore`'s `mtime`, and the adapter
 *  conformance gate's `typeof mtime === "number"` is satisfied by NaN.
 *
 *  EXPORTED, and taking `unknown`, since `thread/list` sorts on the same comparator (M6): its rows are
 *  already-projected wire views whose `updatedAt` is typed `unknown`, so a caller that narrowed it first
 *  would be writing the screen a second time to satisfy a signature. Widening the parameter costs the two
 *  callers below nothing — a `number | undefined` is an `unknown`. */
export const finite = (x: unknown): number | null => (Number.isFinite(x) ? (x as number) : null);

export function sortValueOf(info: { createdAt?: number; lastModified: number }, key: SortKey): number | null {
  if (key === "created_at") return finite(info.createdAt);
  return finite(info.lastModified); // updated_at ≡ recency_at ≡ lastModified on this store (D-M5-6)
}

export function compareTuple(a: { v: number | null; s: string }, b: { v: number | null; s: string }, dir: "asc" | "desc"): number {
  if (a.v === null && b.v === null) return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
  if (a.v === null) return 1; // nulls last in BOTH directions
  if (b.v === null) return -1;
  if (a.v !== b.v) return dir === "asc" ? a.v - b.v : b.v - a.v;
  return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
}

export function sortForSearch<T extends { sessionId: string }>(rows: T[], dir: "asc" | "desc", valueOf: (r: T) => number | null): T[] {
  return [...rows].sort((a, b) => compareTuple({ v: valueOf(a), s: a.sessionId }, { v: valueOf(b), s: b.sessionId }, dir));
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
const unb64 = (s: string): unknown => { try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")); } catch { return null; } };

/** Cursor offsets are range-checked, not just type-checked, and refused rather than clamped. A cursor is
 *  server-minted and opaque — never client-authored — so an out-of-range offset means forged or corrupted,
 *  and there is no client intent to be generous toward (D-M5-17 scopes clamping to `limit`, which IS a
 *  client-authored parameter). Clamping would be worse than refusing: it turns an integrity failure into a
 *  plausible wrong answer, resuming a transcript at a row the cursor did not name — exactly the intra-file
 *  skip/repeat D-M5-16 exists to eliminate. `null` is this codec's existing answer to garbage, and range
 *  is part of the shape of a row index, so decode is where it belongs (both Tasks 7 and 8 decode). */
const offset = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

/** The SORT VALUE is screened the same way and for the same reason (D-M5-26). `typeof x === "number"`
 *  admits `Infinity` — `JSON.parse('{"v":1e999}')` produces it — and no mint can emit one:
 *  `JSON.stringify(Infinity)` is `"null"` and `sortValueOf` screens with `Number.isFinite` besides
 *  (D-M5-15a). So a decoded non-finite `v` is definitionally forged or corrupted, and `compareTuple`
 *  answers `Infinity >= 0` for it, which in the schema's default `desc` direction restarts the walk at the
 *  top and re-delivers every row the client already holds under a `nextCursor: null` that claims the walk
 *  is over. Range is part of the shape of a keyset value exactly as it is part of the shape of a row
 *  index, so it is screened where the row index already was. */
const finiteOrNull = (x: unknown): x is number | null => x === null || (typeof x === "number" && Number.isFinite(x));

/** SHA-256 over LENGTH-FRAMED parts, base64url-truncated. Still not a SIGNATURE — the cursor is not a
 *  capability, and a client that forges one reaches only its own sessions, which the token already
 *  entitles it to. It answers ONE question: is the walk this cursor was minted for the walk being resumed.
 *  The framing is what stops `("ab","c")` and `("a","bc")` from fingerprinting alike, and
 *  `undefined`/`null` are distinguished from `""` because "no `cwd`" and "`cwd` is empty" are different
 *  requests.
 *
 *  IT WAS 32-BIT FNV-1a, AND THAT IS TOO NARROW FOR WHAT IT DECIDES (fix wave G / P2-2#3). `q` is the sole
 *  query-equality check, so two walks that fingerprint alike share a cursor — and the walks that collide
 *  are not exotic: sweeping the DEFAULT `created_at`/`desc`/no-cwd request over both `archived` values,
 *  the first collision arrived after 212,532 fingerprints (5 collisions in that sweep, every one of them
 *  crossing the archive partition, e.g. `9pw457` for both `("t38481", archived:false)` and
 *  `("t86137", archived:true)`). A cursor that crosses the partition resumes at a tuple computed for a
 *  different set of sessions and skips whatever sorts before it — silently, under a reply that looks
 *  ordinary. 32 bits puts that at the birthday bound of ~2^16 walks, which one client can reach; 128 puts
 *  it out of reach of anything, and costs one hash per REQUEST (never per row).
 *
 *  IT IS FRAMED BY LENGTH, NOT BY A DELIMITER (fix wave H / H5), and that is the difference between an
 *  encoding no part can forge and one that merely makes forging awkward. The delimited version wrote each
 *  part as sentinel-or-value followed by a NUL, with `undefined`/`null` spelled U+0001 `u` / U+0001 `n`
 *  so that a `cwd` of `"u"` could not read as "no cwd" — but nothing stopped a `cwd` from BEING U+0001
 *  `u`, and nothing stopped a part from carrying the NUL separator itself. Both collide, and both were
 *  measured: a request whose `cwd` is U+0001 `u` fingerprinted identically to one with no `cwd` at all
 *  (`k0sysMoBeM-l-cIrE_VIA5`), the same for U+0001 `n` against `null`, and one part holding a NUL against
 *  the two parts it splits into. A POSIX path may hold any byte but `/` and NUL, so the first of those is
 *  a `cwd` a client can actually send.
 *
 *  Each part is now written as `<tag><byte-length>:<body>`, so the stream parses back to exactly one
 *  sequence of parts whatever the bodies contain: the length says where a body ends, so no body can end
 *  it early, and no delimiter is left for a value to impersonate. The tag separates the three empty
 *  bodies — `undefined`, `null` and `""` — and, at no extra cost, keeps the number `1` from
 *  fingerprinting like the string `"1"`. Nothing is left to escape, which is why this is preferred to
 *  escaping: an escape is a rule every future caller has to keep, and a length is not. */
const FINGERPRINT_CHARS = 22; // 22 base64url chars — 132 bits of sha256, truncated
const partTag = (raw: string | number | boolean | null | undefined): string =>
  raw === undefined ? "u" : raw === null ? "n" : typeof raw === "string" ? "s" : typeof raw === "number" ? "d" : "b";
export function fingerprint(parts: readonly (string | number | boolean | null | undefined)[]): string {
  const h = createHash("sha256");
  for (const raw of parts) {
    const body = raw === undefined || raw === null ? "" : String(raw);
    h.update(`${partTag(raw)}${Buffer.byteLength(body, "utf8")}:`, "utf8");
    h.update(body, "utf8"); // fed in rather than joined — nothing depends on one whole string
  }
  return h.digest("base64url").slice(0, FINGERPRINT_CHARS);
}

/** BOTH cursors carry the walk's own bindings beside its position (D-M5-26): `q`, a fingerprint of the
 *  QUERY that decides what is being walked, and `g`, a stamp of the transcript GENERATION whose rows the
 *  position addresses. A position means nothing without them — a cursor minted for `alpha` replayed under
 *  `beta` answered a confident "no matches" for a term with a match, and a cursor minted before a rewind
 *  resumed at row offsets of a transcript that no longer existed. Both are `string`, and neither has a
 *  "do not check" value: `g` is `""` only where the position addresses NO rows (a `thread/search` cursor
 *  with `r === 0` names a place in the session ordering, not in any file), which is a fact about the
 *  position rather than a licence to skip the check. The previous `e: number | null` is what this
 *  replaces — its `null` meant "unqualified, resume anyway", and three of the four ways a cursor addressed
 *  a generation it was not minted against went through that one value. */
export interface SearchCursor { v: number | null; s: string; r: number; q: string; g: string }

/** THE OCCURRENCE CURSOR NAMES A POSITION IN ONE OF TWO PHASES (M9 Stage D), because the scan now visits
 *  two kinds of text at each row: the row's own, and the text of every logged arrival anchored to it.
 *
 *  ROW phase — `{s,r,c,q,g}`, the shape this codec has always minted: `r` is a transcript row offset and
 *  `c` an offset into that row's LOWERED text.
 *
 *  ARRIVAL phase — the same fields plus `a`, which names WHICH entry of the row's group is next in the
 *  store's `(seq, id)` order. `r` is still the ANCHOR's row offset (`0` for the null-anchored group, which
 *  scans before row 0), and `c` is then ENTRY-LOCAL: an offset into that entry's own text, not into the
 *  row's. The two offsets share one field because they are one quantity — where in the string being scanned
 *  the next match may start — measured in whichever string the phase names; a second field would let a
 *  resume read one where it meant the other. `(seq, id)` alone named the entry but not the position inside
 *  it, so an arrival holding two matches at `limit: 1` would have repeated or skipped its second.
 *
 *  THE PHASE IS THE PRESENCE OF `a`, and that is what makes a PRE-M9 cursor decode CORRECTLY rather than
 *  merely decode: a client holding one across the upgrade is mid-walk, and "no `a`" is exactly the row
 *  phase it was minted in. A version tag would have refused it instead, and refusing a cursor whose meaning
 *  did not change restarts a walk for nothing. It costs nothing in the other direction either —
 *  `JSON.stringify` omits an undefined member, so a row-phase mint is byte-identical to M5's. */
export interface OccArrivalPhase { seq: number; id: string }
export interface OccCursor { s: string; r: number; c: number; q: string; g: string; a?: OccArrivalPhase }

export function encodeSearchCursor(c: SearchCursor): string { return b64(c); }
export function decodeSearchCursor(s: string): SearchCursor | null {
  const p = unb64(s) as { v?: unknown; s?: unknown; r?: unknown; c?: unknown; q?: unknown; g?: unknown } | null;
  if (!p || !finiteOrNull(p.v) || typeof p.s !== "string" || !offset(p.r)) return null;
  if (typeof p.q !== "string" || typeof p.g !== "string" || "c" in p) return null;
  return { v: p.v, s: p.s, r: p.r, q: p.q, g: p.g };
}
export function encodeOccCursor(c: OccCursor): string { return b64(c); }
export function decodeOccCursor(s: string): OccCursor | null {
  const p = unb64(s) as { s?: unknown; r?: unknown; c?: unknown; v?: unknown; q?: unknown; g?: unknown; a?: unknown } | null;
  if (!p || typeof p.s !== "string" || !offset(p.r) || !offset(p.c)) return null;
  if (typeof p.q !== "string" || typeof p.g !== "string" || "v" in p) return null;
  // NO `a` IS THE ROW PHASE — the legacy-decode rule, stated as one branch rather than as a version check.
  if (!("a" in p)) return { s: p.s, r: p.r, c: p.c, q: p.q, g: p.g };
  // A phase that is PRESENT and malformed is refused rather than repaired, exactly as an out-of-range row
  // offset is (see `offset` above): the cursor is server-minted and opaque, so there is no client intent to
  // be generous toward, and a repaired phase would resume the scan inside an entry nothing named. `seq` is
  // a non-negative safe integer because the store's is; `id` is non-empty because an empty one matches no
  // entry, and a resume point that matches nothing would silently swallow the group behind it.
  const a = p.a as { seq?: unknown; id?: unknown } | null;
  if (!a || typeof a !== "object" || !offset(a.seq) || typeof a.id !== "string" || !a.id) return null;
  return { s: p.s, r: p.r, c: p.c, q: p.q, g: p.g, a: { seq: a.seq, id: a.id } };
}

/** `thread/list`'s keyset (M6): the SORT POSITION of the last row a page delivered — nothing more, because
 *  there is nothing more to name. The two above address rows INSIDE a transcript, which is why they carry a
 *  row offset and a generation to qualify it against; this one addresses a place in an ordering of whole
 *  sessions, and that ordering is recomputed from the store on every request. It carries no `q` either:
 *  `thread/list` publishes no sort/term choice a client could vary between pages, so there is no walk
 *  binding to check that the two request parameters it does have (`cwd`, `archived`) do not already decide
 *  by selecting a different set of rows.
 *
 *  `"r" in p` is the cross-codec guard the two above already run on each other, and one clause covers both
 *  of them: a row offset is exactly what a session-ordering position does not have, and both other shapes
 *  carry one. Without it a `thread/search` cursor would decode here as a valid list position — same `v`,
 *  same `s`, with its `r`/`q`/`g` silently dropped — and resume the picker at a place in a different walk.
 *
 *  It DOES carry `q`, for the same reason the two above do (D-M5-26): a cursor names a position in ONE
 *  walk, and `thread/list` has two request parameters that choose which walk it is. `archived` is the
 *  sharp one — it selects a PARTITION, so a cursor minted while listing unarchived sessions and replayed
 *  with `archived:true` still decodes, still finds a place in the other partition's ordering, and silently
 *  begins after everything sorting before that tuple. That is the same "a page quietly starts in the wrong
 *  place" this whole re-cursoring removes, arriving by a different door, and a client with a
 *  show-archived toggle reaches it by holding onto its cursor. `cwd` rides along on the same argument. */
export interface ListCursor { v: number | null; s: string; q: string }
export function encodeListCursor(c: ListCursor): string { return b64(c); }
export function decodeListCursor(s: string): ListCursor | null {
  const p = unb64(s) as { v?: unknown; s?: unknown; q?: unknown; r?: unknown; c?: unknown } | null;
  if (!p || !finiteOrNull(p.v) || typeof p.s !== "string" || typeof p.q !== "string") return null;
  if ("r" in p || "c" in p) return null;
  return { v: p.v, s: p.s, q: p.q };
}

/** THE ONE FOLD, for the term and for every corpus string it is matched against (fix wave G / P2-2#4).
 *
 *  `toLowerCase()` alone is CONTEXT-DEPENDENT, and the promise this method makes — a case-insensitive
 *  literal substring search — is not. Swept over all of Unicode against twelve contexts (empty, letter,
 *  combining mark and punctuation on each side): EXACTLY ONE code point folds differently alone than it
 *  does in context — U+03A3 Σ, which JavaScript lowers to `ς` at the end of a word and to `σ` elsewhere.
 *  So `"ΟΣ"` lowers to `"ος"` while a standalone `"Σ"` lowers to `"σ"`, and the promised match missed:
 *  term `Σ` in row `ΟΣ` was -1, and so were `ΟΣ` in `οσ` and `ΣΣ` in `οΣΣο`. Mapping the final sigma onto
 *  the ordinary one afterwards is Unicode's own common case fold (`CaseFolding.txt`: `03C2; C; 03C3;`),
 *  and it makes all three match at the right offsets.
 *
 *  IT DOES NOT DISTURB D-M5-17a, and that was measured rather than argued: swept over all of Unicode, the
 *  repair changes the folded LENGTH of zero code points, so `originalSpan`'s equal-length fast path, its
 *  U+0130 correction and its outward-edge convention are all untouched — the sigma folds 1→1 like every
 *  other length-preserving context-sensitive fold that decision already named. What it changes is only
 *  WHICH ROWS MATCH, in exactly one direction: the sigma matches the promise already implied. That is why
 *  it is not the `RegExp`-with-`i` route D-M5-17a rejected — that one changed which rows are hits across
 *  the board (İ/i, K/k and ẞ/ß all stop matching), where this adds one letter's missing folds and nothing
 *  else. Applied to BOTH sides or to neither: a fold on the term alone is a different asymmetry. */
export const foldCase = (s: string): string => s.toLowerCase().replace(/ς/g, "σ");

/** The corpus (spec: Codex's "visible user messages and final assistant messages", via OUR classifier
 *  so search and replay cannot drift): user rows rows.ts classifies `prompt`, and assistant rows' text
 *  blocks. Everything else returns null. */
export function rowSearchText(m: unknown): string | null {
  const row = m as { type?: string; message?: { content?: unknown } };
  if (row?.type === "assistant") {
    const c = row.message?.content;
    if (!Array.isArray(c)) return null;
    // The `String(...)` is redundant with the `.join("\n")` below, which stringifies every element itself —
    // over every input the two spellings are the same function. Kept because it states the coercion.
    const texts = c.filter((b: any) => b?.type === "text").map((b: any) => String(b.text ?? ""));
    return texts.length ? texts.join("\n") : null;
  }
  if (row?.type === "user") return rowKind(m) === "prompt" ? promptText(m) : null;
  return null;
}

/** `snippetMatchRange` is a public wire field (named verbatim from Codex's protocol), so a negative or
 *  inverted range is a contract violation rather than an internal caller's private problem — clamp the two
 *  inputs so no caller can emit one. The input clamp IS the whole guard: with `at` inside the text and `n`
 *  non-negative and not past the text end, `end = at - from + n` is never negative and never below
 *  `start`, and `at - from ≤ pad ≤ max - n` keeps `end` inside the snippet. */
const clampIndex = (n: number, hi: number): number => (Number.isFinite(n) ? Math.min(Math.max(0, Math.trunc(n)), Math.max(0, hi)) : 0);

const isHighSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** Maps a match located in `text.toLowerCase()` back onto `text` as a SPAN — both ends, not just the start.
 *  Search matches on the LOWERCASED row and the snippet is cut from the ORIGINAL, and two independent
 *  things go wrong without this. Expansions BEFORE the match slide the window right by one unit each
 *  (`İneedle…` excerpts `eedley`). An expansion INSIDE the match changes the match's own length, and then
 *  NEITHER length a caller already holds is the answer: searching `İstanbul` (8 units, lowering to 9)
 *  matches 9 original units in a row holding the already-decomposed `i`+U+0307 form and 8 in a row holding
 *  the composed `İ` — the same term, both rows hits, and the term's own length is right for neither pair.
 *  Only mapping the two ends through the same count gives the span in `text`, and `end - start` is its true
 *  length. Once Task 8 publishes `snippetMatchRange` off this span a wrong length is a wrong PUBLISHED
 *  range, not merely a short excerpt. Shared HERE rather than spelled at each call site: two spellings of
 *  one piece of arithmetic in one file is what let the rev-1 plan's mint and resume diverge.
 *
 *  Exactly one code point in Unicode changes UTF-16 length under `toLowerCase()`, and it only ever grows:
 *  swept 0..0x10FFFF, expanders = 1 (U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE → "i" + U+0307),
 *  shrinkers = 0. The context-sensitive folds (final sigma, ǅ, ﬀ, ẞ) are all length-preserving, and the
 *  Lithuanian rules that would add a dot are locale-sensitive while `toLowerCase()` is not. So
 *  `lowered.length - text.length` IS the count of U+0130 in `text`, which makes the equal-length fast path
 *  exact for every row that contains none — i.e. every real row — and exact for BOTH ends, not just the
 *  start. That holds on this second axis too and it is worth saying why: the mapping reads only the ROW's
 *  own expansions, so a row with none is unit-for-unit aligned with its lowered copy and every offset in
 *  it — and therefore every span between two offsets — is preserved. A row CANNOT be length-stable while a
 *  span inside it is not: a span whose length changes needs an expansion inside it, which is exactly what
 *  makes the row's two lengths differ. What the fast path never licensed is substituting the TERM's length
 *  for the span's — `lenLowered` is the match measured in the lowered row and passes straight through,
 *  while `searchTerm.length` is a third number belonging to neither string. Matching semantics are
 *  untouched — the search is still `indexOf` over the lowered text. (A `RegExp` with `i` for native offsets
 *  was measured and rejected: under `i`, İ/i and K/k and ẞ/ß all fail to match, and under `iu`/`iv` İ still
 *  does; every variant changes which rows are hits.) */
const mapBack = (text: string, atLowered: number, edge: "start" | "end"): number => {
  // An expansion STRADDLING the offset — a match edge landing between the `i` and its U+0307 — resolves
  // OUTWARD, so the span covers every original character any part of which matched: the start counts it
  // (landing before it), the end does not (landing after it). Reachable, not decorative: term `hi` against
  // a row holding `Hİ` ends mid-expansion, and flooring that end would publish a range stopping short of
  // the İ that matched. This is the ONLY offset the two edges disagree on; everywhere else both skip an
  // expansion wholly after the offset and count one wholly before it.
  //   The two edges need SEPARATE test rows, one per side. A symmetric guard tested on one side is a guard
  // tested by half: this file has now twice shipped a two-sided rule with only one side pinned — this
  // convention (the end-ceil half had a row, the start-floor half did not, and setting `straddles = 1` for
  // both edges left the whole suite green while publishing spans that dropped a matched character), and
  // `makeSnippet`'s pair of surrogate trims (`from < at` had a row, its mirror `to > at + n` did not).
  // Whoever extends this: write the row for each side, and sabotage each side on its own.
  const straddles = edge === "end" ? 1 : 0;
  let shift = 0;
  let p = text.indexOf("İ");
  // `p + shift` is where this İ sits in `lowered`. Not a unit-by-unit walk (which would defeat the row
  // cap): once per U+0130 via native `indexOf`, worst case the same order as the `toLowerCase()` the
  // caller already paid for — and the two calls per match are two passes over the same short prefix.
  while (p >= 0 && p + shift + straddles < atLowered) { shift++; p = text.indexOf("İ", p + 1); }
  return atLowered - shift;
};

/** PRECONDITION: `atLowered >= 0` — a real offset in `lowered`, i.e. a hit. Handed the `-1` of a MISS it
 *  maps that through and returns a negative `at` rather than refusing; screening the miss belongs to the
 *  caller, which has to branch on it anyway (both shipped call sites do, via `if (i >= 0)`). */
export function originalSpan(text: string, lowered: string, atLowered: number, lenLowered: number): { at: number; len: number } {
  if (lowered.length === text.length) return { at: atLowered, len: lenLowered };
  const at = mapBack(text, atLowered, "start");
  return { at, len: mapBack(text, atLowered + lenLowered, "end") - at };
}

export function makeSnippet(text: string, start: number, len: number): { snippet: string; snippetMatchRange: { start: number; end: number } } {
  const at = clampIndex(start, text.length);
  const n = clampIndex(len, text.length - at);
  // `n` is the match's length IN THIS ROW, not the term's: a snippet must be able to hold its own match, or
  // `snippetMatchRange` describes text the excerpt does not carry. The two differ whenever a fold changes
  // length — a 256-unit term of `İ` folds to 512 and matches 512 units of a decomposed row — which is why
  // the published bound is stated off this number and not off `searchTerm.length` (schema/search.ts).
  const max = Math.max(SEARCH_CAPS.snippetMax, n);
  const pad = Math.max(0, Math.floor((max - n) / 2));
  let from = Math.max(0, at - pad);
  let to = Math.min(text.length, from + max);
  // The window is measured in UTF-16 UNITS, so its two cuts land wherever the arithmetic puts them —
  // including between the halves of an astral character, which ships a LONE SURROGATE on the wire. Not
  // hypothetical and not parity-dependent: with emoji around the match the 97-unit pad splits BOTH edges
  // at every one of 40 probed offsets, and the reply carries `\ude00`/`\ud83d` escapes. Node's
  // JSON.stringify emits them without complaint, so nothing upstream notices; the cost lands on the
  // client — measured, python's json.loads accepts the escape and the resulting string then refuses to
  // encode back to UTF-8 ("surrogates not allowed"), and languages whose string type is UTF-8 by
  // construction cannot hold it at all. Trimming a half-character off an excerpt costs the reader nothing.
  //   Both trims are guarded to stay OUT of the match itself (`from < at`, `to > at + n`), because a
  // client's own term may legitimately begin or end with a lone surrogate and cutting into the match
  // would make `snippetMatchRange` describe a range the snippet no longer holds. Outside the match the
  // repair is positional, not provenance-aware: each trim looks only at the unit sitting ON its own cut,
  // so a lone surrogate the SOURCE already carried is passed through everywhere except where it happens to
  // land exactly on a cut this window makes (constructed: one at `from` IS trimmed). Distinguishing the
  // two would mean inspecting the unit beyond the cut, and the excerpt is one unit shorter either way.
  if (from > 0 && from < at && isLowSurrogate(text.charCodeAt(from))) from++;
  if (to > at + n && isHighSurrogate(text.charCodeAt(to - 1))) to--;
  const snippet = text.slice(from, to);
  return { snippet, snippetMatchRange: { start: at - from, end: at - from + n } };
}
