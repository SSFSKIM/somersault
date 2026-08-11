import { describe, it, expect } from "vitest";
import { HISTORY_SCOPES, nextScope, rankHistory, ageLabel, moreLabel, previewLayout, previewLines, PREVIEW_LINES, PREVIEW_SIDE_BY_SIDE_COLS } from "../../src/tui/historySearch.js";

// F5 t12 removed `promptEntries`/`mergeEntries` and their pins with them: both surfaces read
// `history.jsonl` through `readHistory` now, so the transcript-derived reconstruction they implemented has
// no caller left. Their replacement coverage lives in test/tui/useChat.test.tsx (loadHistory over a temp
// fleet root) — this file keeps only what is still pure and still used.

describe("scopes", () => {
  it("cycle session → project → everywhere → session (bundle SDo order)", () => {
    expect(HISTORY_SCOPES).toEqual(["session", "project", "everywhere"]);
    expect(nextScope("session")).toBe("project");
    expect(nextScope("everywhere")).toBe("session");
  });
});

describe("rankHistory — substring class before subsequence class (bundle oDb)", () => {
  const es = [{ text: "fix the tests", ts: 3 }, { text: "run typecheck", ts: 2 }, { text: "tweak espresso settings", ts: 1 }];
  it("empty query returns everything in order", () => {
    expect(rankHistory(es, "  ")).toEqual(es);
  });
  it("substring matches come first, subsequence matches after, order kept within class", () => {
    // "tes": substring of "fix the tests"; subsequence of "tweak espresso settings" (t…e…s); not in "run typecheck" (no s after e).
    expect(rankHistory(es, "tes").map((e) => e.text)).toEqual(["fix the tests", "tweak espresso settings"]);
  });
  it("case-insensitive; no match → empty", () => {
    expect(rankHistory(es, "TYPECHECK").map((e) => e.text)).toEqual(["run typecheck"]);
    expect(rankHistory(es, "zzz")).toEqual([]);
  });
  it("stable order WITHIN each class when ≥2 entries land in each (scrambled input order)", () => {
    // Query "tes": substring hits are "fix the tests" and "best testing"; subsequence-only hits (t…e…s,
    // no literal "tes") are "tweak espresso settings" and "the eastern silo". Input order is scrambled
    // across classes on purpose — rankHistory must preserve EACH class's relative input order, not sort
    // by anything else (e.g. recency/ts), and a single-entry-per-class fixture can't pin that.
    const scrambled = [
      { text: "tweak espresso settings", ts: 1 },   // subsequence
      { text: "fix the tests", ts: 2 },              // substring
      { text: "the eastern silo", ts: 3 },           // subsequence
      { text: "best testing", ts: 4 },               // substring
    ];
    expect(rankHistory(scrambled, "tes").map((e) => e.text)).toEqual([
      "fix the tests", "best testing", "tweak espresso settings", "the eastern silo",
    ]);
  });
});

describe("ageLabel", () => {
  it("s/m/h/d buckets", () => {
    const now = 1_000_000_000_000;
    expect(ageLabel(now - 30_000, now)).toBe("30s");
    expect(ageLabel(now - 5 * 60_000, now)).toBe("5m");
    expect(ageLabel(now - 3 * 3_600_000, now)).toBe("3h");
    expect(ageLabel(now - 50 * 3_600_000, now)).toBe("2d");
  });
});

// ───────────────────────────── CM59: the picker's preview geometry (bundle qGf, L492207/L492219) ─────────────────────────────

describe("previewLayout — `f = n >= 100` and the three widths it feeds", () => {
  it("stacks below 100 columns and sits side-by-side at 100 and above", () => {
    expect(PREVIEW_SIDE_BY_SIDE_COLS).toBe(100);
    expect(previewLayout(99).sideBySide).toBe(false);
    expect(previewLayout(100).sideBySide).toBe(true);
  });
  it("reproduces upstream's m/g/y at 120 columns", () => {
    // m = floor((120-6)*0.5) = 57 · g = max(20, 57-8-1) = 48 · y = max(20, 120-57-12) = 51
    expect(previewLayout(120)).toEqual({ sideBySide: true, listWidth: 57, textWidth: 48, previewWidth: 51 });
  });
  it("…and at 80, where the list owns the full width and the preview sits under it", () => {
    // m = 80-6 = 74 · g = max(20, 74-8-1) = 65 · y = max(20, 80-10) = 70
    expect(previewLayout(80)).toEqual({ sideBySide: false, listWidth: 74, textWidth: 65, previewWidth: 70 });
  });
  it("never lets either pane fall under 20 columns", () => {
    const tiny = previewLayout(20);
    expect(tiny.textWidth).toBe(20);
    expect(tiny.previewWidth).toBe(20);
  });
});

describe("previewLines — `renderPreview`'s hard wrap, blank-line drop and six-row budget", () => {
  it("keeps up to six lines and reports no overflow", () => {
    const { lines, more } = previewLines("a\nb\nc", 40);
    expect(lines).toEqual(["a", "b", "c"]);
    expect(more).toBe(0);
    expect(PREVIEW_LINES).toBe(6);
  });
  it("drops blank lines BEFORE counting (upstream's `.filter(w => w.trim() !== \"\")`)", () => {
    expect(previewLines("a\n\n   \nb", 40).lines).toEqual(["a", "b"]);
  });
  it("WORD-wraps — upstream's JB is Bun.wrapAnsi (bundle L106890), not a fixed-offset slice", () => {
    // The load-bearing case, and the one a single-word fixture cannot distinguish: at width 10 a slice
    // would cut "the quick " / "brown fox " mid-token; a word wrap breaks at the spaces.
    expect(previewLines("the quick brown fox jumps", 10).lines).toEqual(["the quick", "brown fox", "jumps"]);
  });
  it("…and still HARD-breaks a single token too long to fit (`{ hard: true }`)", () => {
    expect(previewLines("abcdefghij", 4).lines).toEqual(["abcd", "efgh", "ij"]);
    expect(previewLines("hi abcdefghij", 4).lines).toEqual(["hi", "abcd", "efgh", "ij"]);
  });
  it("measures DISPLAY width, so a CJK run breaks at half the code points", () => {
    // Each of these is two columns wide, so width 6 holds three per row — a `.slice()` on code units would
    // have put six on a row and overflowed the pane.
    expect(previewLines("한한한한한한", 6).lines).toEqual(["한한한", "한한한"]);
  });
  it("with more than six lines keeps FIVE and puts the rest in the tail — the tail costs a row", () => {
    const { lines, more } = previewLines("1\n2\n3\n4\n5\n6\n7\n8", 40);
    expect(lines).toEqual(["1", "2", "3", "4", "5"]);
    expect(more).toBe(3);
  });
});

describe("moreLabel — `Bst` (bundle L107148)", () => {
  it("is an ellipsis CHARACTER, a plus, the count and a pluralized unit", () => {
    expect(moreLabel(3)).toBe("… +3 lines");
    expect(moreLabel(1)).toBe("… +1 line");
  });
  it("renders nothing at all for a non-positive count (`bM` returns null)", () => {
    expect(moreLabel(0)).toBe("");
    expect(moreLabel(-2)).toBe("");
  });
});
