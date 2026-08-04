// F4 Task 4 — box-drawing markdown tables (constants pack §4, bundle `IBp` L420907 / `kaa` L421019).
// Every expectation here is a DERIVED exact string: the column widths are computed by hand from the
// fitting rules (`f`/`m`/`_`/`T`, pack §4.3) and the line text assembled from `D` (pack §4.4) and
// `R` + `bWo` (pack §4.5/§4.6) — nothing is counted loosely off a printed run.
import { marked } from "marked";
import type { Tokens } from "marked";
import { describe, expect, it } from "vitest";
import { renderTable } from "../../src/tui/mdTable.js";
import { renderMarkdown } from "../../src/tui/markdown.js";

const table = (md: string): Tokens.Table => {
  const t = marked.lexer(md).find((x) => x.type === "table");
  if (!t) throw new Error("input did not lex to a table");
  return t as Tokens.Table;
};
const texts = (md: string, w = 80) => renderTable(table(md), w).map((l) => l.text);

describe("F4 Task 4 — box grid (pack §4.4/§4.5)", () => {
  it("a 3-column table at width 80 is the exact ┌─┬┐ / ├─┼┤ / └─┴┘ box", () => {
    // 3 columns, chrome `y = 1 + 3*3 = 10`, `_ = max(80 - 10 - 4, 9) = 66`. Every cell is 1 char, so
    // `p()` floors each natural width at `_Hn = 3`: m = [3,3,3], A = 9 <= 66 → T = m (mode 1, no wrap).
    // `D` fills `width + 2 = 5` per column; `R` writes "│" then, per cell, " " + bWo(...) + " │".
    // Header forces "center": o = 3-1 = 2, i = floor(2/2) = 1 → " a ". Body takes align ?? "left" → "1  ".
    expect(texts("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |")).toEqual([
      "┌─────┬─────┬─────┐",
      "│  a  │  b  │  c  │",
      "├─────┼─────┼─────┤",
      "│ 1   │ 2   │ 3   │",
      "└─────┴─────┴─────┘",
    ]);
  });

  it("a `middle` rule sits between EVERY consecutive pair of data rows (pack §4.5 L421002–421005)", () => {
    // 2 columns → `_ = max(80 - 7 - 4, 6) = 69`; all cells 1 char → T = [3,3].
    const out = texts("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |");
    expect(out).toEqual([
      "┌─────┬─────┐",
      "│  a  │  b  │",
      "├─────┼─────┤",
      "│ 1   │ 2   │",
      "├─────┼─────┤",
      "│ 3   │ 4   │",
      "├─────┼─────┤",
      "│ 5   │ 6   │",
      "└─────┴─────┘",
    ]);
    // rows − 1 between-row rules PLUS the one under the header.
    expect(out.filter((l) => l.startsWith("├")).length).toBe(3);
  });

  it("body cells honour :---/:--:/---: while the header is force-centred (pack §4.5 L420986)", () => {
    // Natural widths: "left"/"a" → 4, "center"/"b" → 6, "right"/"c" → 5. A = 15 <= 66 → T = [4,6,5].
    // Header (forced center) exactly fills each column, so centering is invisible there; the body row
    // shows all three pads: "a   " (left), "  b   " (center, floor-left bias), "    c" (right).
    expect(texts("| left | center | right |\n|:-----|:------:|------:|\n| a | b | c |")).toEqual([
      "┌──────┬────────┬───────┐",
      "│ left │ center │ right │",
      "├──────┼────────┼───────┤",
      "│ a    │   b    │     c │",
      "└──────┴────────┴───────┘",
    ]);
  });

  it("header centering is visible when the header is narrower than its column", () => {
    // col0: header "ab" (2) vs body "longervalue" (11) → 11; col1: 1-char cells → 3. A = 14 <= 69.
    // Header "ab" in width 11: o = 9, i = floor(9/2) = 4 → "    ab     ". Body is left-aligned.
    expect(texts("| ab | x |\n|:---|---|\n| longervalue | y |")).toEqual([
      "┌─────────────┬─────┐",
      "│     ab      │  x  │",
      "├─────────────┼─────┤",
      "│ longervalue │ y   │",
      "└─────────────┴─────┘",
    ]);
  });

  it("borders and rules carry NO style — the bundle prints the assembled table through a bare <wc>", () => {
    const out = renderTable(table("| a | b |\n|---|---|\n| 1 | 2 |"), 80);
    expect(out[0]).toEqual({ text: "┌─────┬─────┐" });
    expect(out[2]).toEqual({ text: "├─────┼─────┤" });
    expect(out[4]).toEqual({ text: "└─────┴─────┘" });
  });

  it("inline styling inside a cell survives the box (cells go through the inline walker)", () => {
    const out = renderTable(table("| h |\n|---|\n| **b** |"), 80);
    expect(out[3]).toEqual({
      text: "│ b   │",
      segments: [{ text: "│ " }, { text: "b", bold: true }, { text: "   │" }],
    });
  });

  it("an OSC-8 link inside a cell measures zero for its escape bytes (column stays square)", () => {
    // Task 3's link segments embed raw escapes in `text`; `Ut` is escape-aware, so the column is sized by
    // the LABEL ("docs" = 4) and the pad computed against it. Header "linkcol" (7) wins the column, so the
    // body cell pads by 3 — which only lands right if the ~40 escape bytes measured zero.
    const saved = process.env.FORCE_HYPERLINK;
    process.env.FORCE_HYPERLINK = "1";
    try {
      const out = renderTable(table("| linkcol |\n|---|\n| [docs](https://example.com) |"), 80);
      expect(out.map((l) => l.text.replace(/\x1b\]8;;[^\x07]*\x07/g, ""))).toEqual([
        "┌─────────┐", "│ linkcol │", "├─────────┤", "│ docs    │", "└─────────┘",
      ]);
      expect(out[3].text).toContain("\x1b]8;;https://example.com\x07");   // the hyperlink really is intact
    } finally { if (saved === undefined) delete process.env.FORCE_HYPERLINK; else process.env.FORCE_HYPERLINK = saved; }
  });

  it("a table is NOT dimmed by an ambient `dim` — `Oaa` gives dimColor to the prose <wc>s only", () => {
    // L421146 passes `dimColor: Maa` to the prose chunks; L421150 constructs `TWo` WITHOUT it, so a table
    // inside a dimmed markdown block prints at full brightness upstream. Only the gap:1 blank is dimmed.
    const out = renderMarkdown("note\n\n| a | b |\n|---|---|\n| 1 | 2 |", { dim: true });
    expect(out[0]).toEqual({ text: "note", dim: true });
    expect(out.slice(2)).toEqual([
      { text: "┌─────┬─────┐" }, { text: "│  a  │  b  │" }, { text: "├─────┼─────┤" },
      { text: "│ 1   │ 2   │" }, { text: "└─────┴─────┘" },
    ]);
  });
});

describe("F4 Task 4 — row cap (pack §4.2, TBp = 200 / `AWo` L420897)", () => {
  const grid = (n: number) => `| n | v |\n|---|---|\n${Array.from({ length: n }, (_, i) => `| ${i + 1} | x |`).join("\n")}`;

  it("keeps the first 200 rows and appends the overflow note after the bottom border", () => {
    const out = texts(grid(201));
    // top + header + rule + (200 rows + 199 between-row rules) + bottom + the note.
    expect(out).toHaveLength(1 + 1 + 1 + 399 + 1 + 1);
    expect(out[out.length - 2]).toBe("└─────┴─────┘");
    expect(out[out.length - 1]).toBe("… 1 more row not shown");
    expect(out.filter((l) => l.startsWith("│ 200"))).toHaveLength(1);
    expect(out.filter((l) => l.startsWith("│ 201"))).toHaveLength(0);
  });

  it("pluralises via `Et(n, \"row\")` and thousands-separates via toLocaleString()", () => {
    expect(texts(grid(250)).at(-1)).toBe("… 50 more rows not shown");
    // The separator is whatever the runtime's default locale prints — upstream has the same property,
    // so the expectation is built the same way rather than hard-coding "1,100".
    expect(texts(grid(1300)).at(-1)).toBe(`… ${(1100).toLocaleString()} more rows not shown`);
  });
});

describe("F4 Task 4 — vertical/record fallback (pack §4.7 ngH = 4 / §4.8 `kaa`)", () => {
  // width 40, 2 columns → chrome 7, `_ = max(40 - 7 - 4, 6) = 29`.
  // col0 ("id"/"1"/"2"): every longest-word and natural width floors to _Hn = 3.
  // col1: the 300-char cell is ONE unbreakable word → f[1] = m[1] = 300.
  // E = A = 303 > 29 → mode 3 (hard): scale = 29/303, T = [max(floor(0.287),3), max(floor(28.71),3)] = [3, 28].
  // Hard-wrapping 300 chars at 28 needs 11 lines > ngH = 4 → the vertical fallback fires.
  const long = "x".repeat(300);
  const md = `| id | note |\n|----|------|\n| 1 | ${long} |\n| 2 | short |`;

  it("emits `header: value` records separated by a min(width-1, 40) rule, no box characters", () => {
    // Field wrap width for "note" is max(40 - 4 - 3, 10) = 33, but `P3t` is called WITHOUT `hard`, so
    // the 300-char word is not broken and the value stays on one line (bundle L421030).
    expect(texts(md, 40)).toEqual([
      "id: 1",
      `note: ${long}`,
      "─".repeat(39),
      "id: 2",
      "note: short",
    ]);
    expect(texts(md, 40).some((l) => /[┌┬┐├┼┤└┴┘│]/.test(l))).toBe(false);
  });

  it("bolds the `header:` label (wBp/CBp) and leaves the value unbolded", () => {
    const out = renderTable(table(md), 40);
    expect(out[0]).toEqual({ text: "id: 1", segments: [{ text: "id:", bold: true }, { text: " 1" }] });
    expect(out[2]).toEqual({ text: "─".repeat(39) });
  });

  it("also fires when the ASSEMBLED box is wider than width − 4 (pack §4.7 trigger 2)", () => {
    // Trigger 2 is reachable only through the `g * _Hn` floor on `_`: at width 19 with 3 columns the
    // chrome is 10, so `19 - 10 - 4 = 5` loses to `3 * _Hn = 9` and `_` becomes 9. T = [3,3,3] fits by
    // construction and every cell is one line (trigger 1 misses), but the assembled row is
    // `1 + 3*(3+2) + … ` = 19 wide, and 19 > 19 - 4. The box is built and then thrown away.
    const md3 = "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |";
    expect(texts(md3, 80)[0]).toBe("┌─────┬─────┬─────┐");         // same input, same widths, boxed at 80
    // Field wrap width is max(19 - 1 - 3, 10) = 15, so every value stays on its own first line, and a
    // single record emits no rule (the rule goes only BETWEEN records).
    expect(texts(md3, 19)).toEqual(["a: 1", "b: 2", "c: 3"]);
  });
});

describe("F4 Task 4 — routing through renderMarkdown", () => {
  it("a top-level table becomes the box, with gap:1 blank lines at the chunk boundaries", () => {
    expect(renderMarkdown("before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter").map((l) => l.text)).toEqual([
      "before",
      "",
      "┌─────┬─────┐",
      "│  a  │  b  │",
      "├─────┼─────┤",
      "│ 1   │ 2   │",
      "└─────┴─────┘",
      "",
      "after",
    ]);
  });

  it("the box fits the caller's width, not a fixed 80", () => {
    // 2 columns at width 24: chrome 7, `_ = max(24 - 7 - 4, 6) = 13`. Header/body words: "alpha" (5),
    // "beta" (4), "gamma one" → f = [5,5]/… natural m = ["alpha"|"gamma one" → 9, "beta"|"delta" → 5].
    // A = 14 > 13, E = f = [5,5] = 10 <= 13 → mode 2: slack 3, deficits [4,0], total 4 →
    // T = [5 + floor(4/4*3), 5 + 0] = [8, 5].
    expect(renderMarkdown("| alpha | beta |\n|---|---|\n| gamma one | delta |", { width: 24 }).map((l) => l.text)).toEqual([
      "┌──────────┬───────┐",
      "│  alpha   │ beta  │",
      "├──────────┼───────┤",
      "│ gamma    │ delta │",
      "│ one      │       │",
      "└──────────┴───────┘",
    ]);
  });

  it("a NESTED table keeps `f2`'s plain pipe form — no box (pack §4.9 L420669–420697)", () => {
    // Minimum column width here is the literal 3 (L420683) and there is no forced header centering,
    // no width fitting and no row cap; each row is trimEnd()ed, which leaves the closing "|" attached.
    expect(renderMarkdown("- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |").map((l) => l.text)).toEqual([
      "- item",
      "",
      "| a   | b   |",
      "|-----|-----|",
      "| 1   | 2   |",
    ]);
  });
});
