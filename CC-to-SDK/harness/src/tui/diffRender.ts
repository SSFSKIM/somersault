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
//   `i2p`  L419592        — the SYNTAX TOKENS inside a row (EP-R5, Wave R t11), selected per row at L419813:
//                           `y === "-" ? [[cWo(o), _]] : i2p(s, _, o)` — removed rows stay one flat pair
//   `ZmH`  L419733        — the word-diff BACKGROUND overlaid on those tokens (EP-R5, Wave R t12), literal
//                           at L419757: `{ ...c, background: y ? o : n }` — band under token, both sides
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
import { detectLanguage, highlightDiffLine, selectPalette, type DiffPalette } from "./diffHighlight.js";
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

/** The half-open `[start, end)` slice of a segment list, in CHARACTERS of the joined text. Style rides along
 *  by spread, so a token split across two rows keeps its colour on both halves. */
function sliceSegments(segments: readonly Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const segment of segments) {
    const from = Math.max(start, at), to = Math.min(end, at + segment.text.length);
    if (to > from) out.push({ ...segment, text: segment.text.slice(from - at, to - at) });
    at += segment.text.length;
  }
  return out;
}
/** `wrapRows` made segment-aware — Task 11's half of upstream's `a2p` (L419674), which wraps the row's
 *  style/text PAIRS rather than a string. The wrap itself is delegated to the string path above and then
 *  re-sliced, deliberately: `a2p` is a hard character wrap and this clone has always word-wrapped through
 *  `wrap-ansi` (pinned by the `H2p` wrap tests), so re-implementing the walk over segments would have
 *  changed WHERE rows break as a side effect of colouring them.
 *
 *  A re-slice only works while every piece is a SUBSTRING of the joined source, and `wrap-ansi` breaks that
 *  in two distinct ways — both of which are handled here, because "the row lost characters" is the one
 *  failure a colouring change must never be able to cause:
 *
 *  1. IT NORMALIZES. `wrapAnsi` calls `String(string).normalize()` before it splits
 *     (`node_modules/wrap-ansi/index.js:215-221`), so with NFD source — `e`+U+0301 out of a JSON file, a
 *     macOS filename, anything pasted from Finder — the pieces come back NFC and `startsWith` misses at
 *     every offset. The old code then either walked the cursor off the leading indentation (the whitespace
 *     skip) or sliced by the wrong length (one dropped trailing character per combining mark). So the wrap
 *     runs over text we have normalized OURSELVES, per segment, and the slice reads those same normalized
 *     segments. Per segment rather than over the join so that colour boundaries survive untouched.
 *  2. IT CAN REWRITE. A literal `\x1b` byte inside the source (a diff of a file that contains one) is read
 *     as the start of an ANSI escape, and at narrow widths the pieces stop being a partition of the source
 *     altogether. There is no alignment that fixes that, so the loop carries a FALLBACK: a piece that is
 *     still not found emits itself as one unstyled span, which `plainRows` bands and gives the row's forced
 *     foreground. That restores the intended bound — a rewrite `wrap-ansi` performs can MIS-COLOUR a row,
 *     never lose or duplicate its text, because the text on every row comes from the piece itself.
 *
 *  The two layers are ordered, not redundant: the fallback alone would keep an NFD row's TEXT whole but paint
 *  the whole line one flat colour, and normalizing is what keeps it tokenized.
 *
 *  In the ordinary case neither arm fires: the only thing `wrap-ansi` does to NFC text without escapes is
 *  swallow the whitespace it breaks on, which the cursor steps over — never over content, so a piece can
 *  never be matched against the wrong occurrence of itself. */
function wrapSegments(segments: readonly Segment[], width: number): Segment[][] {
  const normalized = segments.map((s) => ({ ...s, text: s.text.normalize() }));
  const source = normalized.map((s) => s.text).join("");
  const rows: Segment[][] = [];
  let at = 0;
  for (const piece of wrapRows(source, width)) {
    while (at < source.length && !source.startsWith(piece, at) && /\s/.test(source[at]!)) at++;
    if (!source.startsWith(piece, at)) { rows.push([{ text: piece }]); at = Math.min(source.length, at + piece.length); continue; }
    rows.push(sliceSegments(normalized, at, at + piece.length));
    at += piece.length;
  }
  return rows;
}

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

// `lang`/`palette` from here down are EP-R5's highlighting seam: `patch.filePath` resolved ONCE per body by
// `detectLanguage` (upstream's `n2p`, L419530) and the scope map `t2p` (L419465) picks. BOTH row arms read
// them: L419813 chooses a row's spans — tokens for `+`/` `, one flat pair for `-` — BEFORE `ZmH` (L419733)
// ever sees the word ranges, so the word diff is downstream of the tokenizer on both sides of a pair.

/** Upstream `ZmH` (L419733), the composition Task 12 exists to get right: the word diff owns the BACKGROUND
 *  ONLY. Its literal (L419757) is `l.push([{ ...c, background: y ? o : n }, A])` — the token's own style `c`
 *  spread whole, with `background` alone chosen by whether this slice sits inside a changed range (`o`, the
 *  word band) or outside it (`n`, the row band). So a syntactic token that straddles a word boundary is CUT
 *  and both halves keep the token's foreground; the band-split-first shape this replaces could only paint
 *  whole band spans one flat colour, which threw the token away at every boundary.
 *
 *  `ranges` are half-open `[start, end)` character offsets into the joined segment text, sorted and disjoint
 *  — which is what lets the walk carry `i` forward across segments exactly as `ZmH` does. A segment that
 *  reaches past the last range, or a row with no ranges at all, falls out through the trailing push with the
 *  ordinary band, so the row text is a total function of the input segments no matter what the ranges say. */
function overlayWordBands(segments: readonly Segment[], ranges: readonly { start: number; end: number }[], band: string | undefined, wordBand: string, fg: string): Segment[] {
  const out: Segment[] = [];
  let at = 0, i = 0;
  for (const segment of segments) {
    const stop = at + segment.text.length;
    let rest = segment.text, cursor = at;
    while (i < ranges.length && ranges[i]!.end <= cursor) i++;
    while (rest.length > 0 && i < ranges.length) {
      const range = ranges[i]!, inside = cursor >= range.start && cursor < range.end;
      const upto = inside ? Math.min(range.end, stop) : (range.start > cursor && range.start < stop ? range.start : stop);
      out.push(banded(rest.slice(0, upto - cursor), inside ? wordBand : band, segment.color ?? fg));
      rest = rest.slice(upto - cursor); cursor = upto;
      if (cursor >= range.end) i++;
    }
    if (rest.length > 0) out.push(banded(rest, band, segment.color ?? fg));
    at = stop;
  }
  return out;
}

/** Upstream `lhH` (L419944). `null` is its bail — a changed fraction above `ohH`, which falls back to the
 *  whole-line banding in `H2p`. (Its other bail arm is the whole-diff `dim` flag: upstream sets that only for
 *  the condensed styles this clone does not model, so nothing here can be dim and the arm is unreachable.)
 *  The row is built in upstream's order — tokenize (L419813), overlay the word bands (`ZmH`), THEN wrap
 *  (`a2p`) — so the changed-word ranges are offsets into the row's own text and the wrap is the same
 *  segment-aware one `plainRows` uses, NFC safety net and all. */
function wordDiffRows(kind: "add" | "remove", text: string, partner: string, number: number, width: number, g: Gutter, tokens: ThemeTokens, lang: string | undefined, palette: DiffPalette): RenderLine[] | null {
  const oldText = kind === "remove" ? text : partner, newText = kind === "remove" ? partner : text;
  const parts = diffWords(oldText, newText, { ignoreCase: false });
  const changed = parts.filter((p) => p.added === true || p.removed === true).reduce((sum, p) => sum + p.value.length, 0);
  if (changed / (oldText.length + newText.length) > WORD_BAIL) return null;
  const marker = markerOf(kind), band = bandOf(kind, tokens), fg = resolveThemeColor(tokens.text);
  const wordBand = resolveThemeColor(kind === "add" ? tokens.diffAddedWord : tokens.diffRemovedWord);
  // `_ = y.length` = 1, so this is `width - gutter - 2` — ONE column wider than the plain path below.
  const limit = Math.max(1, width - (g.prefix.length + g.pad) - 1 - marker.length);
  // Upstream's `YmH` (L419652) shape: walk the parts that belong to THIS row — an `added` part belongs only
  // to the add row and a `removed` part only to the remove row, a common part to both — and record where the
  // own ones land. Offsets, not spans: the row's text comes from `text` itself, so a part list that does not
  // rejoin to it can misplace a band but can never change a character.
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  for (const part of parts) {
    const own = kind === "add" ? part.added === true : part.removed === true;
    if (!own && (kind === "add" ? part.removed === true : part.added === true)) continue;
    if (own) ranges.push({ start: offset, end: offset + part.value.length });
    offset += part.value.length;
  }
  // L419813 verbatim, and it is picked before `ZmH` — so the REMOVE side of a word-diff PAIR is flat for
  // exactly the reason a plain removed row is, and `ZmH` then cuts that one flat pair at the boundaries.
  const content = kind === "remove" ? [{ text }] : highlightDiffLine(text, lang, palette);
  return wrapSegments(overlayWordBands(content, ranges, band, wordBand, fg), limit).map((pieces, index) => {
    const cell = numberCell(g, index === 0 ? number : undefined);
    const used = pieces.reduce((sum, s) => sum + stringWidth(s.text), 0);
    const fill = Math.max(0, width - (cell.length + marker.length + used));
    // `s.bg ?? band` rather than `band`: an overlaid span already carries the word band where it earned one,
    // and `wrapSegments`' un-locatable-piece fallback emits an unstyled span that has to be re-banded here.
    // Omitted at zero rather than pushed empty, matching `plainRows`: a zero-width span paints nothing and
    // only shows up as noise in an exact-segment assertion.
    return row(banded(cell + marker, band, fg), ...pieces.map((s) => banded(s.text, s.bg ?? band, s.color ?? fg)),
      ...(fill === 0 ? [] : [banded(" ".repeat(fill), band, fg)]));
  });
}

/** Upstream `H2p`'s per-row body (L419996–420001): wrap at `width - gutter - 3`, emit the number cell + marker
 *  as its own span, then the content plus a right fill that runs the band out to the full width — and, since
 *  Task 11, the content is TOKENS rather than one string. L419813 is the whole selection rule, verbatim:
 *    `E = y === "-" ? [[cWo(o), _]] : i2p(s, _, o)`
 *  a removed row is ONE flat style/text pair and everything else goes through the highlighter. That asymmetry
 *  is upstream's, not an omission: a deleted line is being shown as deleted, not as code you can still read.
 *  Composition is BAND UNDER TOKEN — `Segment` carries `color` and `bg` independently, so the band is applied
 *  by spread over whatever foreground the token brought, and an unscoped token falls through to the row's
 *  forced `text` foreground exactly as it did before there were tokens at all.
 *  The right FILL is its own span (upstream's own shape — `a2p` L419718 pushes `[i, Pm(" ", t - a)]` as a
 *  separate pair): with a tokenized row there is no longer a "the content span" to pad, and letting the last
 *  token's colour claim the padding would put `string`-yellow on the rest of the line. */
function plainRows(kind: DiffLineRow["kind"], text: string, number: number, width: number, g: Gutter, tokens: ThemeTokens, lang: string | undefined, palette: DiffPalette): RenderLine[] {
  const marker = markerOf(kind), band = bandOf(kind, tokens), fg = resolveThemeColor(tokens.text);
  const limit = Math.max(1, width - (g.prefix.length + g.pad) - 1 - 2);
  const content = kind === "remove" ? [{ text }] : highlightDiffLine(text, lang, palette);
  return wrapSegments(content, limit).map((pieces, index) => {
    const cell = numberCell(g, index === 0 ? number : undefined);
    const used = pieces.reduce((sum, s) => sum + stringWidth(s.text), 0);
    const fill = Math.max(0, width - (cell.length + 1 + used));
    // The two spans' `dimColor` expressions DIFFER, and that difference is the pack's correction to the
    // census: `n || p === "nochange"` on the gutter, bare `n` on the content. With `n` false throughout,
    // that means a context row's number is dim and its text is not — including its tokens.
    return row(banded(cell + marker, band, fg, kind === "context" ? { dim: true } : undefined),
      ...pieces.map((s) => banded(s.text, band, s.color ?? fg)), ...(fill === 0 ? [] : [banded(" ".repeat(fill), band, fg)]));
  });
}

function renderHunk(hunk: DiffHunk, width: number, numberingMode: ResolvedPatch["numbering"], tokens: ThemeTokens, lang: string | undefined, palette: DiffPalette): RenderLine[] {
  const numbers = numbering(hunk.rows, hunk.oldStart ?? 1), partners = pairRuns(hunk.rows);
  const max = numbers.reduce((a, b) => Math.max(a, b), 0);
  const g: Gutter = { pad: Math.max(String(max).length + 1, 0), prefix: numberingMode === "approximate" ? "~" : "" };
  return hunk.rows.flatMap((line, index) => {
    const partner = partners[index];
    if (partner !== undefined && line.kind !== "context") {
      const worded = wordDiffRows(line.kind, line.text, partner.text, numbers[index]!, width, g, tokens, lang, palette);
      if (worded !== null) return worded;
    }
    return plainRows(line.kind, line.text, numbers[index]!, width, g, tokens, lang, palette);
  });
}

/** Memoized on the PATCH OBJECT × width × theme generation × palette, for exactly the reason `resolvePatch` is memoized on
 *  the retained call input: tool rows are uncached, and `useChat` re-projects the whole transient region on a
 *  600 ms cursor blink — so an unmemoized renderer would re-run `diffWords` over every paired line of every Edit
 *  on screen about twice a second. `resolvePatch` hands back the SAME `ResolvedPatch` object across projections
 *  (it caches on the call input), which is what makes the identity key work. The variables that can change
 *  a rendered row without changing the patch are the width, the theme and the syntax palette, so all three ride
 *  in the key — `themeGeneration` rather than the token values because a `setTheme()` bumps no document
 *  revision. Since Task 11 this memo is also what keeps hljs off the frame budget: it parses every added and
 *  context line of the body, and a miss re-parses all of them. */
const rendered = new WeakMap<ResolvedPatch, { width: number; theme: number; palette: DiffPalette; rows: RenderLine[] }>();

/** The whole body. `width` is the diff's own column budget (the seam passes `columns - DIFF_BODY_INSET`);
 *  theme tokens are read PER CALL so a `/theme` switch — including the picker's live preview — repaints the
 *  very next frame. Hunks are joined by upstream's dim literal `"..."` (`K3e`, three ASCII periods, not U+2026);
 *  a hunk that carries no rows contributes no separator, since a lone `...` would claim a gap that is not there.
 *  `palette` defaults to `selectPalette()`, which reads the SAME live theme these tokens come from (plus
 *  `COLORTERM`); it is a parameter only so a unit test can pin one map without reaching into the environment. */
export function renderDiff(patch: ResolvedPatch, width: number, palette: DiffPalette = selectPalette()): RenderLine[] {
  const columns = Math.max(1, Math.floor(width)), theme = themeGeneration();
  const cached = rendered.get(patch);
  if (cached !== undefined && cached.width === columns && cached.theme === theme && cached.palette === palette) return cached.rows;
  const tokens = themeTokens();
  // ONE language resolution per body, not one per row: `detectLanguage` walks hljs's registry and is what
  // triggers the lazy ~60 ms package load, and every row of a patch shares the patch's one path.
  const lang = patch.filePath === undefined ? undefined : detectLanguage(patch.filePath);
  const bodies = patch.hunks.map((hunk) => renderHunk(hunk, columns, patch.numbering, tokens, lang, palette)).filter((rows) => rows.length > 0);
  const rows = bodies.flatMap((body, index) => (index === 0 ? body : [{ text: "...", dim: true } as RenderLine, ...body]));
  rendered.set(patch, { width: columns, theme, palette, rows });
  return rows;
}
