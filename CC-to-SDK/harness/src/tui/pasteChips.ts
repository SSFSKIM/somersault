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
