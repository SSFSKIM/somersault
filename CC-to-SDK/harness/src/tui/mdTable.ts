// tui/src/mdTable.ts — TOP-LEVEL markdown tables as a box-drawing grid: a transcription of the bundle's
// `IBp` layout engine (constants pack §4, L420907) and its `kaa` vertical/record fallback (L421019).
// Upstream glues one ANSI string and hands it to a bare <wc>; we emit `RenderLine[]` whose cells carry
// real `Segment`s, so bold/italic/codespan/link styling inside a cell survives instead of being baked
// into escape bytes. Nested tables do NOT come here — they take `f2`'s own pipe form (pack §4.9), which
// lives in markdown.ts; `Oaa` (L421143) is what splits the two apart.
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import type { Tokens } from "marked";
import { inlineSegments, type InlineEnv } from "./markdownInline.js";
import { foldLine, styleKey } from "./lineFold.js";
import type { RenderLine, Segment } from "./render.js";

// ── the constants line, L421072 VERBATIM ────────────────────────────────────────────────────────────
const MARGIN = 4;                       // `vBp` — subtracted from the terminal width before fitting, and the overflow check
const MIN_COL = 3;                      // `_Hn` — minimum column width, in all three fitting modes
const MAX_CELL_LINES = 4;               // `ngH` — max wrapped lines per cell before the vertical fallback
const ROW_CAP = 200;                    // `TBp`
const BAR = "│";                        // the cell separator (L420984/L420987)
/** `D`'s table, L420994 VERBATIM: [left, fill, join, right]; the fill repeats `width + 2` (pack §4.4). */
const GRID = { top: ["┌", "─", "┬", "┐"], middle: ["├", "─", "┼", "┤"], bottom: ["└", "─", "┴", "┘"] } as const;
/** `AWo` (L420897) VERBATIM, with `Et(e, "row")` inlined. */
const overflowNote = (n: number) => `… ${n.toLocaleString()} more ${n === 1 ? "row" : "rows"} not shown`;
const RULE_CAP = 40;                    // `kaa`'s `Math.min(terminalWidth - 1, 40)` (L421023)

type Cell = Tokens.TableCell | undefined;
type Align = "left" | "center" | "right";

// ── width, in DISPLAY columns ───────────────────────────────────────────────────────────────────────
// Upstream's `Ut` is `Bun.stringWidth(s, { ambiguousIsNarrow: true })`: escape-aware and East-Asian-aware.
// `string-width` (a direct dependency since the Task-4 fix round) is that function: ANSI/OSC-8-stripping,
// East-Asian-aware, and `ambiguousIsNarrow` is its DEFAULT since v5 — so box-drawing `│`/`─` measure 1 and
// a CJK glyph measures 2, matching `Ut` exactly. The earlier code-unit approximation is gone with it.
const ESCAPES = /\x1b\]8;;[^\x07]*\x07|\x1b\[[0-9;]*m/g;   // the OSC-8 + SGR pair Task 3 introduced
const dw = (s: string) => stringWidth(s);
/** The escape-stripped text of a segment run, in CODE UNITS — the coordinate space `sliceSegs` indexes. */
const plain = (segs: Segment[]) => segs.map((s) => s.text).join("").replace(ESCAPES, "");
const segWidth = (segs: Segment[]) => stringWidth(plain(segs));

/** Adjacent segments that render identically collapse into one — keeps a plain grid row a single segment
 *  (so `foldLine` can flatten it to a bare line) instead of one per pad/border piece. */
function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.text === "") continue;
    const last = out[out.length - 1];
    if (last && styleKey(last) === styleKey(s)) out[out.length - 1] = { ...last, text: last.text + s.text };
    else out.push(s);
  }
  return out;
}

/** Segment slice in DISPLAY coordinates. A segment covered end-to-end keeps its raw text (so an OSC-8
 *  link stays intact); a partially covered one falls back to its escape-stripped text — upstream's
 *  wrap-ansi re-opens the hyperlink on each wrapped line, which our style-as-data segments cannot. */
function sliceSegs(segs: Segment[], from: number, to: number): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const s of segs) {
    const disp = s.text.replace(ESCAPES, ""), end = pos + disp.length;
    const a = Math.max(from, pos), b = Math.min(to, end);
    if (b > a) out.push({ ...s, text: a === pos && b === end ? s.text : disp.slice(a - pos, b - pos) });
    pos = end;
  }
  return out;
}

/** `P3t` (L420900) over segments: `trimEnd()`, wrap-ansi with `{ hard, trim: false, wordWrap: true }`,
 *  drop zero-length lines, and never return an empty list. The wrapped text is re-projected back onto the
 *  source segments by `indexOf`, which is exact because wrap-ansi only inserts newlines. */
function wrapSegs(segs: Segment[], width: number, hard: boolean): Segment[][] {
  if (!(width > 0)) return [segs];
  const src = plain(segs).replace(/\s+$/, "");
  const rows = wrapAnsi(src, width, { hard, trim: false, wordWrap: true }).split("\n").filter((r) => r.length > 0);
  if (rows.length === 0) return [[]];
  const out: Segment[][] = [];
  let cur = 0;
  for (const r of rows) {
    const i = src.indexOf(r, cur);
    if (i < 0) { out.push([{ text: r }]); continue; }
    out.push(sliceSegs(segs, i, i + r.length));
    cur = i + r.length;
  }
  return out;
}

/** `NU0.trimEnd().replace(/\n+/g," ").replace(/\s+/g," ").trim()` (L421027) done over segments: every
 *  whitespace run collapses to one space and both ends are trimmed, with each run's style preserved. */
function collapse(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  let space = true;                                     // seeded true so leading whitespace is dropped
  for (const s of segs) {
    let t = "";
    for (const ch of s.text) {
      if (/\s/.test(ch)) { if (!space) { t += " "; space = true; } }
      else { t += ch; space = false; }
    }
    if (t !== "") out.push({ ...s, text: t });
  }
  const last = out[out.length - 1];
  if (last?.text.endsWith(" ")) out[out.length - 1] = { ...last, text: last.text.slice(0, -1) };
  return out;
}

/** `ogH` (L420894) — `String.trim()` over a segment line. Both bounds are CODE-UNIT offsets, because that
 *  is what `sliceSegs` indexes; feeding a DISPLAY width in here would cut a non-ASCII line short. */
const trimSegs = (segs: Segment[]): Segment[] => {
  const p = plain(segs);
  return sliceSegs(segs, p.length - p.trimStart().length, p.trimEnd().length);
};

/** `bWo` (L420839) VERBATIM: centering biases LEFT (`floor` on the left pad, the remainder on the right). */
function pad(cell: Segment[], width: number, align: Align): Segment[] {
  const o = Math.max(0, width - segWidth(cell));
  if (align === "center") { const i = Math.floor(o / 2); return [{ text: " ".repeat(i) }, ...cell, { text: " ".repeat(o - i) }]; }
  if (align === "right") return [{ text: " ".repeat(o) }, ...cell];
  return [...cell, { text: " ".repeat(o) }];
}

/** `IBp` (L420907). `width` is the terminal width (`renderMarkdown`'s `opts.width ?? 80`). There is no
 *  ambient-style parameter ON PURPOSE: `Oaa` hands `dimColor` to the prose `wc`s but NOT to `TWo`
 *  (L421146 vs L421150), so a table inside a dimmed markdown block renders UNDIMMED upstream. A nested
 *  table does inherit it, because that one is glued into the prose string — see markdown.ts. */
export function renderTable(t: Tokens.Table, width: number, env: InlineEnv = {}): RenderLine[] {
  const dropped = Math.max(0, t.rows.length - ROW_CAP);                     // L420908
  const rows = dropped > 0 ? t.rows.slice(0, ROW_CAP) : t.rows;
  const memo = new Map<Cell, Segment[]>();                                  // `l = new Map` — one walk per cell
  const segsOf = (c: Cell): Segment[] => { const hit = memo.get(c); if (hit) return hit; const v = inlineSegments(c?.tokens ?? [], {}, env); memo.set(c, v); return v; };
  const textOf = (c: Cell) => plain(segsOf(c));
  const line = (segs: Segment[]) => foldLine(merge(segs));
  const bare = (text: string) => line([{ text }]);

  // ── three-way width fitting (pack §4.3, L420926–420960) ───────────────────────────────────────────
  const longest = (c: Cell) => { const w = textOf(c).split(/\s+/).filter((x) => x.length > 0); return w.length === 0 ? MIN_COL : Math.max(...w.map((x) => stringWidth(x)), MIN_COL); };   // `d`
  const natural = (c: Cell) => Math.max(stringWidth(textOf(c)), MIN_COL);                                                                                                                // `p`
  const perColumn = (f: (c: Cell) => number) => t.header.map((h, i) => rows.reduce((m, r) => Math.max(m, f(r[i])), f(h)));
  const minW = perColumn(longest), natW = perColumn(natural);              // `f` and `m`
  const cols = t.header.length, chrome = 1 + cols * 3;                     // `y` — one leading │, then " " + cell + " │" each
  const avail = Math.max(width - chrome - MARGIN, cols * MIN_COL);         // `_`
  const sumMin = minW.reduce((a, b) => a + b, 0), sumNat = natW.reduce((a, b) => a + b, 0);   // `E`, `A`
  let hard = false, colW: number[];                                        // `H`, `T`
  if (sumNat <= avail) colW = natW;                                        // mode 1: natural widths fit
  else if (sumMin <= avail) {                                              // mode 2: distribute the slack over the deficits
    const slack = avail - sumMin, deficit = natW.map((n, i) => n - minW[i]), total = deficit.reduce((a, b) => a + b, 0);
    colW = minW.map((m, i) => (total === 0 ? m : m + Math.floor((deficit[i] / total) * slack)));
  } else { hard = true; const scale = avail / sumMin; colW = minW.map((m) => Math.max(Math.floor(m * scale), MIN_COL)); }

  // ── `kaa` — the vertical/record fallback (pack §4.7/§4.8) ──────────────────────────────────────────
  function vertical(): RenderLine[] {
    const rule = "─".repeat(Math.min(width - 1, RULE_CAP));                // `ZhH`
    const out: RenderLine[] = [];
    for (const r of rows) {
      const rec: RenderLine[] = [];
      r.forEach((c, i) => {
        const head = t.header[i] ? textOf(t.header[i]) : "";               // headers go through `u` — plain
        const value = collapse(segsOf(c));
        if (head === "" && segWidth(value) === 0) return;                  // `if (!SWo && !egH) return`
        let lines = wrapSegs(value, Math.max(head ? width - dw(head) - 3 : width - 1, 10), false);
        if (lines.length > 1) {                                            // continuations are RE-FLOWED, not kept as wrapped
          const rest: Segment[] = [];
          lines.slice(1).forEach((l, k) => { if (k > 0) rest.push({ text: " " }); rest.push(...trimSegs(l)); });
          lines = [lines[0], ...wrapSegs(rest, width - 3, false)];
        }
        // `${wBp}${header}:${CBp} ${value}` — upstream bolds the label with raw SGR because it is gluing
        // one string; a `bold` segment is the same pixels and survives our own styling pipeline.
        rec.push(head !== "" ? line([{ text: `${head}:`, bold: true }, { text: " " }, ...(lines[0] ?? [])]) : line(lines[0] ?? []));
        for (let k = 1; k < lines.length; k++) if (plain(lines[k]).trim() !== "") rec.push(line(lines[k]));   // continuations carry NO indent
      });
      if (rec.length === 0) continue;                                      // `if (Iaa.length === 0) return` — a skipped record
      if (out.length > 0) out.push(bare(rule));                            // the rule goes BETWEEN records only
      out.push(...rec);
    }
    if (dropped > 0) { if (out.length > 0) out.push(bare(rule)); out.push(bare(overflowNote(dropped))); }
    return out;
  }

  // ── `R` / `D` — row assembly and the grid rules (pack §4.4/§4.5) ───────────────────────────────────
  const rowLines = (cells: Cell[], forceCenter: boolean): RenderLine[] => {
    const wrapped = cells.map((c, i) => wrapSegs(segsOf(c), colW[i], hard));
    const n = Math.max(...wrapped.map((w) => w.length), 1);
    const off = wrapped.map((w) => Math.floor((n - w.length) / 2));        // `U` — cells are vertically CENTRED
    const out: RenderLine[] = [];
    for (let g = 0; g < n; g++) {
      const segs: Segment[] = [{ text: BAR }];
      for (let v = 0; v < cells.length; v++) {
        const k = g - off[v], cell = k >= 0 && k < wrapped[v].length ? wrapped[v][k] : [];
        const align: Align = forceCenter ? "center" : t.align?.[v] ?? "left";
        segs.push({ text: " " }, ...pad(cell, colW[v], align), { text: ` ${BAR}` });
      }
      out.push(line(segs));
    }
    return out;
  };
  const border = (kind: keyof typeof GRID): RenderLine => {
    const [l, fill, join, r] = GRID[kind];
    let s: string = l;
    colW.forEach((w, i) => { s += fill.repeat(w + 2); s += i < colW.length - 1 ? join : r; });
    return bare(s);
  };

  // Trigger 1 (`w() > ngH`): any header or body cell wrapping past four lines.
  let cellLines = 1;
  t.header.forEach((h, i) => { cellLines = Math.max(cellLines, wrapSegs(segsOf(h), colW[i], hard).length); });
  for (const r of rows) r.forEach((c, i) => { cellLines = Math.max(cellLines, wrapSegs(segsOf(c), colW[i], hard).length); });
  if (cellLines > MAX_CELL_LINES) return vertical();

  const box: RenderLine[] = [border("top"), ...rowLines(t.header, true), border("middle")];
  rows.forEach((r, i) => { box.push(...rowLines(r, false)); if (i < rows.length - 1) box.push(border("middle")); });
  box.push(border("bottom"));
  // Trigger 2: the widest ASSEMBLED row exceeds `width - vBp`. Checked after assembly, so the box really
  // is built and thrown away; reachable only via the `g * _Hn` floor on `_`.
  if (box.reduce((m, l) => Math.max(m, dw(l.text)), 0) > width - MARGIN) return vertical();
  if (dropped > 0) box.push(bare(overflowNote(dropped)));                  // a separate line AFTER the bottom border
  return box;
}
