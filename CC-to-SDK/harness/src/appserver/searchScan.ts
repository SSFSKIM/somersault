// src/appserver/searchScan.ts — pure search primitives (spec D-M5-15/16/17 rev 3). ONE tuple ordering
// shared by the sort and the cursor resume — the rev-1 plan let them diverge and the review caught a
// session locator masquerading as a keyset (F8). Two cursor codecs live beside it for the same reason.
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
 *  conformance gate's `typeof mtime === "number"` is satisfied by NaN. */
const finite = (x: number | undefined): number | null => (Number.isFinite(x) ? (x as number) : null);

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

export function encodeSearchCursor(c: { v: number | null; s: string; r: number }): string { return b64(c); }
export function decodeSearchCursor(s: string): { v: number | null; s: string; r: number } | null {
  const p = unb64(s) as { v?: unknown; s?: unknown; r?: unknown; c?: unknown } | null;
  if (!p || (typeof p.v !== "number" && p.v !== null) || typeof p.s !== "string" || !offset(p.r) || "c" in p) return null;
  return { v: p.v, s: p.s, r: p.r };
}
export function encodeOccCursor(c: { s: string; r: number; c: number; e: number | null }): string { return b64(c); }
export function decodeOccCursor(s: string): { s: string; r: number; c: number; e: number | null } | null {
  const p = unb64(s) as { s?: unknown; r?: unknown; c?: unknown; e?: unknown; v?: unknown } | null;
  if (!p || typeof p.s !== "string" || !offset(p.r) || !offset(p.c) || (typeof p.e !== "number" && p.e !== null) || "v" in p) return null;
  return { s: p.s, r: p.r, c: p.c, e: p.e };
}

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

/** Maps an offset found in `text.toLowerCase()` back onto `text`. Search matches on the LOWERCASED row and
 *  the snippet is cut from the ORIGINAL, so without this the window slides right by one unit per preceding
 *  case-fold expansion — a wrong excerpt here and, once Task 8 publishes `snippetMatchRange` composed off
 *  the same offset, a wrong published range at ONE expansion (`İneedle…` publishes `eedley`). Shared HERE
 *  rather than spelled at each call site: two spellings of one piece of arithmetic in one file is what let
 *  the rev-1 plan's mint and resume diverge.
 *
 *  Exactly one code point in Unicode changes UTF-16 length under `toLowerCase()`, and it only ever grows:
 *  swept 0..0x10FFFF, expanders = 1 (U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE → "i" + U+0307),
 *  shrinkers = 0. The context-sensitive folds (final sigma, ǅ, ﬀ, ẞ) are all length-preserving, and the
 *  Lithuanian rules that would add a dot are locale-sensitive while `toLowerCase()` is not. So
 *  `lowered.length - text.length` IS the count of U+0130 in `text`, which makes the equal-length fast path
 *  exact for every row that contains none — i.e. every real row. The correction loop is not a unit-by-unit
 *  walk (which would defeat the row cap): it runs once per U+0130 via native `indexOf`, worst case the same
 *  order as the `toLowerCase()` the caller already paid for. Matching semantics are untouched — the search
 *  is still `indexOf` over the lowered text. (A `RegExp` with `i` for native offsets was measured and
 *  rejected: under `i`, İ/i and K/k and ẞ/ß all fail to match, and under `iu`/`iv` İ still does; every
 *  variant changes which rows are hits.) */
export function originalOffset(text: string, lowered: string, atLowered: number): number {
  if (lowered.length === text.length) return atLowered;
  let shift = 0;
  let p = text.indexOf("İ");
  // `p + shift` is where this İ sits in `lowered`; count only the ones strictly before the match.
  while (p >= 0 && p + shift < atLowered) { shift++; p = text.indexOf("İ", p + 1); }
  return atLowered - shift;
}

export function makeSnippet(text: string, start: number, len: number): { snippet: string; snippetMatchRange: { start: number; end: number } } {
  const at = clampIndex(start, text.length);
  const n = clampIndex(len, text.length - at);
  const max = Math.max(SEARCH_CAPS.snippetMax, n); // a term longer than 200 units still fits its own snippet
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
