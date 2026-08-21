// T-X4T — pure transcription tests for `FIh` (match-range finder, bundle L536230–536252) and `BIh` (grapheme
// snap, L536337–536357), the matcher half of CM30's query-substring highlight. Rendering/wiring coverage is
// in suggest-popup.test.tsx; this file is deliberately React-free so the algorithm can be pinned in isolation.
import { describe, it, expect } from "vitest";
import { matchRanges } from "../../src/tui/suggestPopup.js";

describe("X4T matcher — FIh L536230–536252", () => {
  it("a whole-query substring hit wins outright as ONE range, before any fuzzy attempt", () => {
    // "revi" is a literal substring of "review" at index 0 — the `indexOf` branch must fire, not the
    // subsequence walk (a fuzzy implementation would also produce [[0,4]] here, so this alone doesn't kill a
    // wrong-order implementation — the merged-run test below does that).
    expect(matchRanges("review", "revi")).toEqual([[0, 4]]);
    // mid-string contiguous hit: "permission" (10 chars) starts at index 6 of "cycle permission mode".
    expect(matchRanges("cycle permission mode", "permission")).toEqual([[6, 16]]);
  });

  it("on a contiguous miss, falls back to a greedy left-to-right subsequence walk, merging adjacent hits into runs", () => {
    // "bce" is NOT a substring of "abcdef" (there is "bcd", not "bce"), so the contiguous branch must miss
    // first. The subsequence walk then finds b@1, c@2 (adjacent to b's end → merges into [1,3]), then e@4
    // (not adjacent to 3 → a new range). A wrong implementation that never merges would produce three
    // one-character ranges instead of two.
    expect(matchRanges("abcdef", "bce")).toEqual([[1, 3], [4, 5]]);
    // out-of-order, no adjacency at all: three separate one-character ranges ("review" is r-e-v-i-e-w, so
    // r@0, v@2, w@5).
    expect(matchRanges("review", "rvw")).toEqual([[0, 1], [2, 3], [5, 6]]);
  });

  it("ANY unmatched query character discards the WHOLE result — no partial highlight", () => {
    // "z" never appears in "abc": the walk must return [] wholesale, not [[0,1],[1,2]] for the "a","b" it did
    // find before failing on "z". A wrong implementation that accumulates hits and only checks at the end
    // (instead of bailing immediately) could still pass a naive "returns something falsy" assertion, so this
    // asserts the exact empty array.
    expect(matchRanges("abc", "abz")).toEqual([]);
    expect(matchRanges("review", "reviewer")).toEqual([]); // query longer than text: the trailing "er" can't match
  });

  it("contiguousOnly=true disables the fuzzy fallback but NOT the contiguous fast path", () => {
    // contiguous hit still wins when contiguousOnly is on.
    expect(matchRanges("review", "revi", true)).toEqual([[0, 4]]);
    // "bce" only matches abcdef via the fuzzy walk — with contiguousOnly it must come back empty, not fall
    // back to the [[1,3],[4,5]] the unrestricted call above produces.
    expect(matchRanges("abcdef", "bce", true)).toEqual([]);
  });

  it("lowercases the TEXT only — the QUERY must arrive pre-lowered, or nothing matches (the lowercase trap)", () => {
    // Text-case is irrelevant: "Review" lowers to "review" internally, and the returned indices are into the
    // ORIGINAL (cased) string.
    expect(matchRanges("Review", "revi")).toEqual([[0, 4]]);
    // But an upper-case QUERY against a lower-case text fails outright, because FIh never touches `t`. This is
    // the exact trap the brief calls out: a caller (ChatComposer) that forgets to lowercase the query silently
    // produces zero highlights for any capitalized keystroke.
    expect(matchRanges("review", "REVI")).toEqual([]);
    expect(matchRanges("review", "ReVi")).toEqual([]);
  });

  it("an empty query is a zero-width contiguous hit at index 0 (canon's own behaviour — indexOf('') === 0)", () => {
    // Upstream never actually CALLS FIh with an empty query in practice (the producer sets `query: undefined`
    // for an empty string instead, L600929/L600809, and the popup skips FIh entirely when `query` is falsy).
    // But the pure function itself, transcribed faithfully, returns `[[0, 0]]` here because `"".indexOf("")`
    // is `0` and the guard is `!== -1`. A push-based renderer treats a zero-width range as a no-op (`start >=
    // end`), so this never paints anything — it just pins that the FUNCTION doesn't special-case emptiness.
    expect(matchRanges("review", "")).toEqual([[0, 0]]);
  });
});

describe("X4T matcher — BIh grapheme snap, L536337–536357", () => {
  it("widens a range that lands mid-grapheme-cluster out to the cluster's boundaries", () => {
    // "éclair": an "e" followed by a COMBINING ACUTE ACCENT (U+0301) is one grapheme ("é") but two
    // UTF-16 code units. A contiguous hit on "e" alone (query "e") lands at code-unit range [0,1], which cuts
    // the combining mark off — BIh must widen the end forward to the next grapheme boundary (index 2, where
    // "c" starts), producing [0,2]. Contains U+0301, which is outside the `/[^ -˿]/` ASCII/Latin-1 fast path,
    // so this exercises the Intl.Segmenter path, not the skip.
    const text = "éclair";
    expect(matchRanges(text, "e")).toEqual([[0, 2]]);
  });

  it("pure-ASCII text takes the fast path untouched — ranges pass through verbatim", () => {
    // No codepoint outside U+0020–U+02FF, so BIh must return the ranges as-is without consulting
    // Intl.Segmenter at all. This is the same result a segmenter pass would also give for plain ASCII, so the
    // assertion is on VALUE, not on segmenter-avoidance directly — but it pins the observable contract.
    expect(matchRanges("review", "revi")).toEqual([[0, 4]]);
  });
});
