// tui/pasteChips.ts — paste ingestion (F5 task 3), transcribed from 2.1.220 rather than invented:
//  · `k0`  (L495741)  normalisation — stripANSI → CRLF/CR → LF → tab → four spaces — then the chip decision
//                     `Cn.length > CMt || kmt(Cn) > max(0, min(rows - 10, 2))` with `CMt = 800` (L153739)
//  · `kmt` (L317378)  a "line" is a newline MATCH, so a 40-line paste with no trailing newline counts 39
//  · `agr` (L317383)  the placeholder grammar `[Pasted text #N]` / `[Pasted text #N +M lines]`
//  · `KF`  (L317394)  the recognizer, four species, ids ≤ 0 discarded
//  · `fSe` (L317403)  submit-time expansion, right-to-left so earlier match indices stay valid
//
// MODULE CYCLE, deliberate: editor.ts imports `ingestPaste` from here and this file imports `insertText` from
// editor.ts. Both are hoisted `function` declarations and NEITHER module calls the other at module-evaluation
// time, so the cycle resolves in either import order. The alternative was a second copy of `insertText` living
// here, which is the one thing guaranteed to drift away from the reducer it has to agree with.
import { insertText, type EditorState, type PastedEntry, type PastedMap } from "./editor.js";

/** `CMt`, bundle L153739: the character count above which a paste collapses regardless of how many lines it has. */
export const CHIP_CHARS = 800;
/** Upstream reads the live terminal height (`rn`). A caller that cannot say — a pure unit test, a headless
 *  embed — gets the POSIX default of 24, which puts `newlineThreshold` at its ceiling of 2. */
export const DEFAULT_ROWS = 24;

// Upstream's `Ci` is `Bun.stripANSI` (L76621), which we have no runtime for. Three alternatives, in the order
// they must be tried: OSC/DCS/APC/PM strings FIRST (their `\x1b]` introducer is inside the third alternative's
// range, so a later position would let `]` be eaten and the payload leak through as text), then CSI —
// `\x1b[ params intermediates final`, which covers SGR colour, cursor moves, and the `\x1b[200~`/`\x1b[201~`
// paste markers themselves — then the two-byte Fe escapes (`\x1bM`, `\x1b7`, …). Not covered, deliberately:
// 8-bit C1 introducers (0x9b et al), which under our latin1-then-UTF8 stdin decode are ordinary characters a
// user may legitimately paste.
const ANSI_RE = /\x1b[\]P^_][\s\S]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
export function stripANSI(s: string): string { return s.replace(ANSI_RE, ""); }

/** `k0`'s first three statements, in `k0`'s order. Idempotent: the editor normalises once to learn what token
 *  it inserted and `ingestPaste` normalises again to build the entry, and both must agree. */
export function normalizePaste(raw: string): string {
  return stripANSI(raw).replace(/\r\n|\r/g, "\n").replace(/\t/g, "    ");
}

/** `kmt`. Run on the NORMALIZED content (where only `\n` survives), but written with upstream's full alternation
 *  so the function is honest on its own. */
export function newlineCount(t: string): number { return (t.match(/\r\n|\r|\n/g) || []).length; }

/** `$p` in `k0`: `Math.max(0, Math.min(rn - 10, 2))`. A tall terminal tolerates two newlines before collapsing;
 *  a 10-row terminal tolerates none. */
export function newlineThreshold(rows: number): number { return Math.max(0, Math.min(rows - 10, 2)); }

/** `agr`. A zero-line paste (one long line) prints no line suffix. */
export function chipLabel(id: number, lineCount: number): string {
  return lineCount === 0 ? `[Pasted text #${id}]` : `[Pasted text #${id} +${lineCount} lines]`;
}

/** `KF`'s recognizer, verbatim. Global, so a caller must either re-instantiate it or reset `lastIndex`;
 *  `chipSpans` below goes through `matchAll`, which clones the regex and leaves this one's `lastIndex` at 0. */
export const CHIP_RE = /\[(Pasted text|Image|Audio|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g;
export interface ChipSpan { start: number; end: number; id: number }

/** Every placeholder in `line`, left to right. Ids ≤ 0 are dropped (`KF`'s own `.filter(n => n.id > 0)`) —
 *  `[Pasted text #0]` is text someone typed, not a chip anything can expand. */
export function chipSpans(line: string): ChipSpan[] {
  if (!line) return [];
  return [...line.matchAll(CHIP_RE)]
    .map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, id: parseInt(m[2] || "0", 10) }))
    .filter((s) => s.id > 0);
}

/** `placeholderStartingAt` / `placeholderEndingAt` / `placeholderContaining` (bundle L394812–L394828), rewritten
 *  against `chipSpans` rather than upstream's three separately-anchored regexes so all four call sites agree on
 *  exactly one definition of "a chip" (which, per `KF`, excludes id 0). `containing` is STRICTLY inside: a cursor
 *  sitting on either edge is outside the placeholder, which is what makes the edges reachable at all. */
export function chipStartingAt(line: string, col: number): ChipSpan | null { return chipSpans(line).find((s) => s.start === col) ?? null; }
export function chipEndingAt(line: string, col: number): ChipSpan | null { return chipSpans(line).find((s) => s.end === col) ?? null; }
export function chipContaining(line: string, col: number): ChipSpan | null { return chipSpans(line).find((s) => col > s.start && col < s.end) ?? null; }

/** `deleteTokenBefore`'s own regex (bundle L395160), verbatim — deliberately NOT `CHIP_RE`. It is anchored (`$`),
 *  demands a word boundary in front (`(^|\s)`), and spells the four species out with their exact suffixes, so a
 *  half-typed or mangled label can never be eaten as if it were a whole chip. */
const TOKEN_BEFORE_RE = /(^|\s)\[(Pasted text #\d+(?: \+\d+ lines)?|Image #\d+|Audio #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]$/;

/** Cut `[from, to)` out of `row`, leaving the cursor at `col`. Local rather than editor.ts's `removeRange`, which
 *  is not exported and spans rows; a chip never does (labels contain no newline). */
function spliceLine(s: EditorState, row: number, from: number, to: number, col: number): EditorState {
  const lines = [...s.lines];
  lines[row] = lines[row].slice(0, from) + lines[row].slice(to);
  return { ...s, lines, cursor: { row, col } };
}

/** `deleteTokenBefore` (bundle L395149), the whole function. Backspace and Ctrl-H both go through
 *  `deleteTokenBefore() ?? backspace()` (L395791 / the ctrl map at L395676), so a chip dies in ONE keystroke
 *  instead of leaving the user to erase twenty-five characters of a label they never typed. Returns null when
 *  there is no token to eat — the caller then does an ordinary backspace.
 *
 *  Three arms, in upstream's order:
 *   1. a chip that STARTS at the cursor dies FORWARD, taking one trailing space with it (L395150-L395154). Yes,
 *      forward: upstream's `this.modifyText(new sd(…, o))` deletes the range between the two cursors and keeps
 *      the earlier one, which here is the untouched `this.offset`.
 *   2. the f18 guard (L395157): if the character AT the cursor exists and is not whitespace, bail. Our line model
 *      has no character for a cursor at end-of-line, so it reads `undefined` there — same verdict as upstream,
 *      where that position is either end-of-text (`undefined`) or the `\n` joining the next logical line (`\s`).
 *   3. the anchored backward match, deleting from just after the matched leading whitespace to the cursor.
 *
 *  Upstream matches against the whole flat buffer; we match the cursor's line. Same outcome: the only thing the
 *  wider slice adds is a preceding `\n`, which `(^|\s)` accepts exactly as our `^` does. */
export function deleteTokenBefore(s: EditorState): EditorState | null {
  const { row, col } = s.cursor; const line = s.lines[row];
  const ahead = chipStartingAt(line, col);
  if (ahead) return spliceLine(s, row, col, line[ahead.end] === " " ? ahead.end + 1 : ahead.end, col);
  if (col === 0) return null;                                        // upstream's `isAtStart()`
  const at = line[col];
  if (at !== undefined && !/\s/.test(at)) return null;
  const m = TOKEN_BEFORE_RE.exec(line.slice(0, col));
  if (!m) return null;
  return spliceLine(s, row, (m.index ?? 0) + m[1].length, col, (m.index ?? 0) + m[1].length);
}

/** The snap-out effect (bundle L495400): a cursor strictly inside a placeholder is pushed to the NEARER edge,
 *  `Qe(xe < Cn ? Wt.start : Wt.end)` with `Cn` the midpoint — so a cursor exactly ON the midpoint goes to the END.
 *  A chip is one object; parking the caret in the middle of a label the user never typed is meaningless.
 *
 *  DIVERGENCE, recorded rather than hidden: upstream runs this effect over IMAGE and AUDIO placeholders only
 *  (`.filter(match.startsWith("[Image") || match.startsWith("[Audio"))`, L495399) because its cursor ops already
 *  snap out of every placeholder in the direction of travel (`nextWord` → `snapOutOfPlaceholder(t,"end")` L394998,
 *  `prevWord` → `"start"` L395064, and `left()`/`right()` step over a whole placeholder, L394793/L394803). We have
 *  no image/audio path (spec non-goal), so this generalised effect is what stands in for that per-op snapping for
 *  text chips. `left()`/`right()` are ported literally in editor.ts; the word ops are not, so Alt-→ into a chip
 *  bounces back to the nearer edge instead of clearing it (see the F5 parity note). */
export function snapOut(s: EditorState): EditorState {
  const { row, col } = s.cursor;
  const chip = chipContaining(s.lines[row], col);
  if (!chip) return s;
  return { ...s, cursor: { row, col: col < (chip.start + chip.end) / 2 ? chip.start : chip.end } };
}

/** GC (bundle L495717-L495728): the map is keyed by ids the BUFFER carries. Once an edit removes (or mangles) a label,
 *  its entry can never be expanded again, so it dies with it — otherwise a submit could resurrect a paste whose
 *  placeholder the user deleted, and the counter's ids would leak forever. Undo brings both back together
 *  (the undo entry carries `pastedContents`; see applyKey).
 *
 *  Every line is rescanned on every text-changing keystroke. That is a full buffer walk per keypress, which is
 *  fine at composer scale (a few short lines) and is the only version that cannot go stale — the alternative,
 *  tracking which ids an edit touched, has to be right in every reducer arm forever.
 *
 *  SAME DIVERGENCE as snapOut, same reason: upstream's live-buffer effect prunes only `type === "image" || "audio"`
 *  entries (L495721) and is gated off entirely when the map holds none (`iD`, L495715) — a stale TEXT entry
 *  survives in upstream's map until the submit path rebuilds it from the ids actually present (L536788). We have
 *  no image/audio, so text is the species that gets the treatment. */
export function gcPastedContents(s: EditorState): EditorState {
  const ids = Object.keys(s.pastedContents);
  if (ids.length === 0) return s;
  const live = new Set<number>();
  for (const line of s.lines) for (const span of chipSpans(line)) live.add(span.id);
  if (ids.every((k) => live.has(Number(k)))) return s;
  const kept: PastedMap = {};
  for (const k of ids) { const id = Number(k); if (live.has(id)) kept[id] = s.pastedContents[id]; }
  return { ...s, pastedContents: kept };
}

/** `fSe`: expand every recognized chip whose id names a text entry. RIGHT TO LEFT, because each replacement
 *  changes the length of everything after it. A chip with no entry (a stale id, an `[Image #N]`) stays literal —
 *  the user typed those characters or the content is gone, and either way inventing text would be worse. */
export function substituteChips(text: string, map: PastedMap): string {
  const spans = chipSpans(text);
  let out = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const entry = map[spans[i].id];
    if (entry?.type !== "text") continue;
    out = out.slice(0, spans[i].start) + entry.content + out.slice(spans[i].end);
  }
  return out;
}

/** CM21/CM27: normalise the payload, then either collapse it behind a chip or insert it as-is.
 *
 *  The id counter advances ONLY when a chip is actually minted — a sub-threshold paste is indistinguishable
 *  from typing once it lands, so burning an id on it would leave gaps in a sequence the user can see.
 *  The chip goes in at the cursor as one token of the current line (labels never contain a newline), which is
 *  what lets task 4 treat it as an atomic unit for deletion. */
export function ingestPaste(s: EditorState, raw: string, rows: number = DEFAULT_ROWS): EditorState {
  const content = normalizePaste(raw);
  if (content.length === 0) return s;
  const lineCount = newlineCount(content);
  if (content.length <= CHIP_CHARS && lineCount <= newlineThreshold(rows)) return insertText(s, content);
  const id = s.pasteCounter + 1;
  const entry: PastedEntry = { id, type: "text", content, lineCount };
  return insertText({ ...s, pasteCounter: id, pastedContents: { ...s.pastedContents, [id]: entry } }, chipLabel(id, lineCount));
}
