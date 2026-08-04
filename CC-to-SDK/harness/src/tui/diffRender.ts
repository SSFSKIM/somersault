// tui/src/diffRender.ts — F4 Task 7: a `ResolvedPatch` (Task 6) → the rows upstream actually paints. This is the
// second half of the diff pipeline: Task 6 answered "what changed, and do we know where"; everything here is HOW
// that reads on screen, ported from the F4 constants pack §6 (bundle `~/claude-code-bundle/2.1.220/cli.pretty.js`):
//   `fbn`  L423885–423902 — the header, its positional capitalization and its bold counts
//   `K3e`  L420118        — the hunk list, joined by a dim literal `"..."`. NO `@@` header exists anywhere
//   `H2p`  L419987–420003 — the numbered gutter, the full-width background band, the wrap and the right fill
//   `chH`  L420004–420029 — the numbering, including the remove-run REWIND that puts a paired remove/add block
//                           on the same line numbers
//   `shH`  L419906–419943 — remove-run/add-run pairing, k-th to k-th
//   `lhH`  L419947–419986 — the word diff and its `ohH = 0.4` bail (L420030)
//
// THE CAP IS GONE. F1's `toolDiffLines` capped a body at 24 rows and appended `… N more lines`; upstream caps
// nothing — a diff renders whole, and the only elision it has are the three early returns in `fbn` (previewHint,
// condensed, collapsed), none of which our wire can reach. So this returns every row it is given, uncut — and
// nothing downstream cuts it either: `toolRenderer` emits typed rows before `foldToolOutput` is ever consulted,
// so a long diff renders whole, exactly as upstream's does.
//
// TWO PACK CORRECTIONS TO THE CENSUS are implemented literally rather than as the census described them:
//   1. a context row's NUMBER GUTTER is dim, its CONTENT is not (`H2p`'s two spans carry different `dimColor`
//      expressions — `n || p === "nochange"` on the gutter, bare `n` on the content);
//   2. the word-diff path wraps at `width - gutter - 2`, ONE COLUMN WIDER than the plain path's
//      `width - gutter - 3`, because `lhH`'s marker term is `y.length` (1) where `H2p`'s is the literal `2`.
//
// ONE DELIBERATE DIVERGENCE, recorded: APPROXIMATE numbering (spec E4) prefixes the number gutter with `~`.
// Upstream has no approximate mode — every diff it paints came off a file it had just read — so there is no
// glyph to copy. Task 6 hands us a patch that admits it cannot place itself; painting bare 1-based numbers
// would read exactly like absolute ones, which is the confidently-wrong failure that ladder exists to avoid.
import { diffWords } from "diff";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import type { DiffHunk, DiffLineRow, ResolvedPatch } from "./diffSource.js";
import type { RenderLine, Segment } from "./render.js";
import { resolveThemeColor, themeGeneration, themeTokens, type ThemeTokens } from "./theme.js";

/** Upstream `ohH` (L420030). The denominator is the SUM of both line lengths, so a full rewrite scores ~1.0 and
 *  a half-changed line ~0.5 — a line that is more than 40% new is banded whole rather than speckled. */
const WORD_BAIL = 0.4;
/** Upstream L423932: `const pbn = U90 - 12`, the body width `fbn` hands `K3e`. It is the ONE width constant in
 *  the pipeline, and it already leaves room for our five-column `⎿` gutter (12 > 5), so the seam subtracts it
 *  from `columns` rather than inventing a second inset. */
export const DIFF_BODY_INSET = 12;

const row = (...segments: Segment[]): RenderLine => ({ text: segments.map((s) => s.text).join(""), segments });

/** Upstream `fbn`'s header, and the ONE implementation of it — `toolSummaries.diffSummaryRow` imports this
 *  rather than keeping a second copy, so the header above a diff body can never disagree with the body's own
 *  counts. Three details that are not the obvious ones: a clause is emitted only when its count is positive,
 *  the separator is the literal `", "`, and the removed clause's capitalization is POSITIONAL
 *  (L423894's `gXe === 0 ? "R" : "r"`) so it reads `Removed 3 lines` standing alone. Pluralization is `> 1`,
 *  not the ordinary pluralizer.
 *  `undefined` (rather than upstream's empty `<Text>`) for 0/0: F3 ruled that a call with no countable change
 *  renders NO row, and an empty row would open a gutter block with nothing in it. */
export function diffHeader(added: number, removed: number): RenderLine | undefined {
  const segments: Segment[] = [];
  if (added > 0) segments.push({ text: "Added " }, { text: String(added), bold: true }, { text: ` ${added > 1 ? "lines" : "line"}` });
  if (added > 0 && removed > 0) segments.push({ text: ", " });
  if (removed > 0) segments.push({ text: `${added === 0 ? "R" : "r"}emoved ` }, { text: String(removed), bold: true }, { text: ` ${removed > 1 ? "lines" : "line"}` });
  return segments.length === 0 ? undefined : row(...segments);
}

/** Upstream `shH` (L419906): the k-th remove of a run pairs with the k-th add of the run IMMEDIATELY following
 *  it, for `k < min(removeRun, addRun)`; surplus lines on either side stay unpaired and keep whole-line banding.
 *  Returned as a parallel array of partners rather than by mutating the rows — `resolvePatch` memoizes and hands
 *  out the SAME hunk objects on every projection, so writing `wordDiff`/`matchedLine` onto them the way upstream
 *  does would accumulate across renders on shared state. */
function pairRuns(rows: readonly DiffLineRow[]): readonly (DiffLineRow | undefined)[] {
  const partner: (DiffLineRow | undefined)[] = new Array(rows.length).fill(undefined);
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.kind !== "remove") { i++; continue; }
    let removeEnd = i; while (removeEnd < rows.length && rows[removeEnd]!.kind === "remove") removeEnd++;
    let addEnd = removeEnd; while (addEnd < rows.length && rows[addEnd]!.kind === "add") addEnd++;
    const paired = Math.min(removeEnd - i, addEnd - removeEnd);
    for (let k = 0; k < paired; k++) { partner[i + k] = rows[removeEnd + k]; partner[removeEnd + k] = rows[i + k]; }
    i = addEnd > removeEnd ? addEnd : removeEnd;
  }
  return partner;
}

/** Upstream `chH` (L420004), ported exactly INCLUDING its asymmetry: `nochange` and `add` each consume one
 *  number; a `remove` pushes at the CURRENT number without incrementing, then drains the rest of its run
 *  incrementing as it goes, then REWINDS by the number of extra removes. Net advance across an N-remove run is
 *  zero, which is what makes a paired remove-block/add-block render with the same numbers on both sides. */
function numbering(rows: readonly DiffLineRow[], seed: number): number[] {
  const numbers = new Array<number>(rows.length);
  let n = seed, i = 0;
  while (i < rows.length) {
    if (rows[i]!.kind !== "remove") { numbers[i] = n; n++; i++; continue; }
    numbers[i] = n; i++;
    let extra = 0;
    while (i < rows.length && rows[i]!.kind === "remove") { n++; numbers[i] = n; i++; extra++; }
    n -= extra;
  }
  return numbers;
}

/** Ink's `wrap` mode: `wrapAnsi(text, columns, { trim: false, hard: true })` — which is what upstream's
 *  `p3(code, E, "wrap")` resolves to. `hard` is what keeps a single unbroken token from overflowing the band. */
const wrapRows = (text: string, width: number): string[] => wrapAnsi(text, width, { trim: false, hard: true }).split("\n");

interface Gutter { /** width of the number cell itself, upstream's `u` */ pad: number; /** the approximate-mode `~`, or "" */ prefix: string; }
/** `x` on L419999: the number right-aligned in its cell, then ONE space. A continuation row blanks the WHOLE
 *  cell — the `~` included, since it annotates a line number and there is no line number on that row. */
const numberCell = (g: Gutter, n: number | undefined): string =>
  (n === undefined ? " ".repeat(g.prefix.length + g.pad) : g.prefix + String(n).padStart(g.pad)) + " ";
const markerOf = (kind: DiffLineRow["kind"]): string => (kind === "add" ? "+" : kind === "remove" ? "-" : " ");
const bandOf = (kind: DiffLineRow["kind"], tokens: ThemeTokens): string | undefined =>
  kind === "add" ? resolveThemeColor(tokens.diffAdded) : kind === "remove" ? resolveThemeColor(tokens.diffRemoved) : undefined;
/** `bg` is omitted rather than set to `undefined` on a context row: a segment with no band must be
 *  indistinguishable from one that never had the field. `fg` is NOT optional: upstream forces every span's
 *  foreground to the theme's `text` color (L419986 / L420000 — the `is()[0]` term is a theme name, always
 *  truthy), so a band never inherits ink's default foreground. */
const banded = (text: string, band: string | undefined, fg: string, extra?: { dim: true }): Segment => ({ text, color: fg, ...(band === undefined ? {} : { bg: band }), ...extra });

/** Upstream `lhH` (L419944). `null` is its bail — a changed fraction above `ohH`, which falls back to the
 *  whole-line banding in `H2p`. (Its other bail arm is the whole-diff `dim` flag: upstream sets that only for
 *  the condensed styles this clone does not model, so nothing here can be dim and the arm is unreachable.) */
function wordDiffRows(kind: "add" | "remove", text: string, partner: string, number: number, width: number, g: Gutter, tokens: ThemeTokens): RenderLine[] | null {
  const oldText = kind === "remove" ? text : partner, newText = kind === "remove" ? partner : text;
  const parts = diffWords(oldText, newText, { ignoreCase: false });
  const changed = parts.filter((p) => p.added === true || p.removed === true).reduce((sum, p) => sum + p.value.length, 0);
  if (changed / (oldText.length + newText.length) > WORD_BAIL) return null;
  const marker = markerOf(kind), band = bandOf(kind, tokens), fg = resolveThemeColor(tokens.text);
  const wordBand = resolveThemeColor(kind === "add" ? tokens.diffAddedWord : tokens.diffRemovedWord);
  // `_ = y.length` = 1, so this is `width - gutter - 2` — ONE column wider than the plain path below.
  const limit = Math.max(1, width - (g.prefix.length + g.pad) - 1 - marker.length);
  const groups: { content: Segment[]; contentWidth: number }[] = [];
  let current: Segment[] = [], used = 0;
  for (const part of parts) {
    // An `added` part belongs only to the add row and a `removed` part only to the remove row; a common part
    // belongs to both and rides the ordinary band (upstream nests it inside the row's background `<Text>`,
    // which our flat segment list has to spell out).
    const own = kind === "add" ? part.added === true : part.removed === true;
    if (!own && (kind === "add" ? part.removed === true : part.added === true)) continue;
    for (const [index, piece] of wrapRows(part.value, limit).entries()) {
      if (piece === "") continue;
      if ((index > 0 || used + stringWidth(piece) > limit) && current.length > 0) { groups.push({ content: current, contentWidth: used }); current = []; used = 0; }
      current.push(banded(piece, own ? wordBand : band, fg));
      used += stringWidth(piece);
    }
  }
  if (current.length > 0) groups.push({ content: current, contentWidth: used });
  return groups.map(({ content, contentWidth }, index) => {
    const cell = numberCell(g, index === 0 ? number : undefined);
    const fill = Math.max(0, width - (cell.length + marker.length + contentWidth));
    return row(banded(cell + marker, band, fg), ...content, banded(" ".repeat(fill), band, fg));
  });
}

/** Upstream `H2p`'s per-row body (L419996–420001): wrap at `width - gutter - 3`, emit the number cell + marker
 *  as its own span, then the content plus a right fill that runs the band out to the full width. */
function plainRows(kind: DiffLineRow["kind"], text: string, number: number, width: number, g: Gutter, tokens: ThemeTokens): RenderLine[] {
  const marker = markerOf(kind), band = bandOf(kind, tokens), fg = resolveThemeColor(tokens.text);
  const limit = Math.max(1, width - (g.prefix.length + g.pad) - 1 - 2);
  return wrapRows(text, limit).map((piece, index) => {
    const cell = numberCell(g, index === 0 ? number : undefined);
    const fill = Math.max(0, width - (cell.length + 1 + stringWidth(piece)));
    // The two spans' `dimColor` expressions DIFFER, and that difference is the pack's correction to the
    // census: `n || p === "nochange"` on the gutter, bare `n` on the content. With `n` false throughout,
    // that means a context row's number is dim and its text is not.
    return row(banded(cell + marker, band, fg, kind === "context" ? { dim: true } : undefined), banded(piece + " ".repeat(fill), band, fg));
  });
}

function renderHunk(hunk: DiffHunk, width: number, numberingMode: ResolvedPatch["numbering"], tokens: ThemeTokens): RenderLine[] {
  const numbers = numbering(hunk.rows, hunk.oldStart ?? 1), partners = pairRuns(hunk.rows);
  const max = numbers.reduce((a, b) => Math.max(a, b), 0);
  const g: Gutter = { pad: Math.max(String(max).length + 1, 0), prefix: numberingMode === "approximate" ? "~" : "" };
  return hunk.rows.flatMap((line, index) => {
    const partner = partners[index];
    if (partner !== undefined && line.kind !== "context") {
      const worded = wordDiffRows(line.kind, line.text, partner.text, numbers[index]!, width, g, tokens);
      if (worded !== null) return worded;
    }
    return plainRows(line.kind, line.text, numbers[index]!, width, g, tokens);
  });
}

/** Memoized on the PATCH OBJECT × width × theme generation, for exactly the reason `resolvePatch` is memoized on
 *  the retained call input: tool rows are uncached, and `useChat` re-projects the whole transient region on a
 *  600 ms cursor blink — so an unmemoized renderer would re-run `diffWords` over every paired line of every Edit
 *  on screen about twice a second. `resolvePatch` hands back the SAME `ResolvedPatch` object across projections
 *  (it caches on the call input), which is what makes the identity key work. The two variables that can change
 *  a rendered row without changing the patch are the width and the palette, so both ride in the key —
 *  `themeGeneration` rather than the token values because a `setTheme()` bumps no document revision. */
const rendered = new WeakMap<ResolvedPatch, { width: number; theme: number; rows: RenderLine[] }>();

/** The whole body. `width` is the diff's own column budget (the seam passes `columns - DIFF_BODY_INSET`);
 *  theme tokens are read PER CALL so a `/theme` switch — including the picker's live preview — repaints the
 *  very next frame. Hunks are joined by upstream's dim literal `"..."` (`K3e`, three ASCII periods, not U+2026);
 *  a hunk that carries no rows contributes no separator, since a lone `...` would claim a gap that is not there. */
export function renderDiff(patch: ResolvedPatch, width: number): RenderLine[] {
  const columns = Math.max(1, Math.floor(width)), theme = themeGeneration();
  const cached = rendered.get(patch);
  if (cached !== undefined && cached.width === columns && cached.theme === theme) return cached.rows;
  const tokens = themeTokens();
  const bodies = patch.hunks.map((hunk) => renderHunk(hunk, columns, patch.numbering, tokens)).filter((rows) => rows.length > 0);
  const rows = bodies.flatMap((body, index) => (index === 0 ? body : [{ text: "...", dim: true } as RenderLine, ...body]));
  rendered.set(patch, { width: columns, theme, rows });
  return rows;
}
