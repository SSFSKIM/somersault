// tui/src/editor.ts — pure multiline-editor reducer for the chat composer. No React/Ink/fs; the @-mention FS
// walk is injected by the component. Probe 17d7116: a multi-line write is ONE useInput call (input = whole
// string, embedded \n/\r, no key.return) → paste = insert-and-split; submit = a lone key.return; `\`+Enter =
// continuation. rankCandidates (pure) is added in the mention pass.
import { rankCandidates } from "./fileComplete.js";
import { rankCommands, type CommandEntry } from "./commandComplete.js";
import { CHIP_CHARS, chipContaining, chipEndingAt, chipStartingAt, deleteTokenBefore, ingestPaste, snapOut, substituteChips } from "./pasteChips.js";
// F5 task 7: the history WALK moved out to its own module (the plan's pre-allocated split), leaving this file
// the buffer reducer it is. Same deliberate module cycle pasteChips.ts documents — editorHistory imports
// `bufferText`/`setBuffer`/the state types from here and this file imports the walk from there, all hoisted
// `function` declarations with nothing called at module-evaluation time, so the cycle resolves either way.
import { historyNext, historyPrev, pushHistory, type DraftStash, type HistEdit, type HistFilter, type HistNavEntry } from "./editorHistory.js";
// The prefix→mode reading lives in `promptMode.ts` (a zero-import leaf) so the history seed and this reducer
// share ONE derivation; `InputMode` moved with it and is re-exported here, so existing imports are unchanged.
import { composerMode, type InputMode } from "./promptMode.js";
export { historyEdited, historyLabel, historyPosition, historyView, rebuildChips } from "./editorHistory.js";
export type { DraftStash, HistEdit, HistFilter, HistNavEntry } from "./editorHistory.js";
export type { InputMode } from "./promptMode.js";
export interface Cursor { row: number; col: number }
export interface Candidate { path: string; score: number }
export interface MentionState { anchor: Cursor; query: string; files: string[]; items: Candidate[]; index: number }
export interface CommandState { query: string; items: CommandEntry[]; catalog: CommandEntry[]; index: number }
/** One collapsed paste, rendered in the buffer as a `[Pasted text #id +N lines]` placeholder (F5 task 3 fills
 *  the map). Declared HERE, with the undo entry that carries it, so the undo shape never has to reopen.
 *  `lineCount` is OURS: upstream stores `{ id, type, content }` (bundle L495755) and passes the count to `agr`
 *  as an argument instead. We keep it so a re-render of the label never has to re-walk the content. */
export interface PastedEntry { id: number; type: "text"; content: string; lineCount: number }
export type PastedMap = Record<number, PastedEntry>;
/** CM-stash, upstream's `chat:stash` record (bundle L495837): the Ctrl-S park is `{ text, cursorOffset,
 *  pastedContents }` and the restore (L495833) puts all three back — `At(A.text), Qe(A.cursorOffset),
 *  x(A.pastedContents)`. Ours was a bare string until t7, which silently dropped a stashed draft's chips
 *  (the labels came back, the payloads did not, and the submit sent the literal `[Pasted text #1 …]`) and
 *  its caret. `cursorOffset` is a flat offset upstream and a `{row, col}` here, the same difference every
 *  other cursor in this file carries. */
export interface StashRecord { display: string; cursor: Cursor; pastedContents: PastedMap }
export interface EditorState {
  lines: string[]; cursor: Cursor;
  /** OLDEST-first (see editorHistory.ts's divergence 2). Seeded from disk by ChatComposer at mount and
   *  appended to by every submit; `historySeeded` is what keeps a composer REMOUNT from re-seeding over it. */
  history: HistNavEntry[]; histIndex: number | null; stash: DraftStash | null;
  histEdits: Map<number, HistEdit>;                          // CM54, upstream `w.current` — keyed by history-VIEW index
  histMode: HistFilter;                                      // CM55's latch, upstream `T.current`
  histRecalled: string | null;                               // upstream `H.current`: the text the last recall installed
  historySeeded: boolean;                                    // ChatComposer's one-shot disk seed (see there)
  stashed: StashRecord | null;                               // Ctrl-S input stash (distinct from history-nav `stash`)
  undo: { lines: string[]; cursor: Cursor; pastedContents: PastedMap; at: number }[];   // see UNDO_CAP / applyKey
  pastedContents: PastedMap;                                 // collapsed pastes keyed by id; dies with the buffer
  pasteCounter: number;                                      // monotonic id source for the next chip
  hasUsedBackslashReturn: boolean;                           // CM18: upstream's persisted `markBackslashReturnUsed`
  mention: MentionState | null; command: CommandState | null;
  killRing: string[];                                        // newest LAST, cap 10; entries may include killed line breaks
  killRun: boolean;                                          // an unbroken run of kill keystrokes coalesces into the newest entry
  yankSite: { start: Cursor; end: Cursor; index: number } | null;   // set by yank; alt+y pops only while it holds
}
/** What the paste arm just did, for the two side effects the composer owns and the reducer must not: the
 *  0600 disk cache (`pasteCache.ts`) and the `paste again to expand` hint. Same out-of-band channel `killed`
 *  already uses for the yank hint, and used for the same reason — an impure reaction to a pure transition.
 *
 *  It is a REPORTED signal rather than something the composer diffs out of (prev, next) because that diff is
 *  ambiguous everywhere except inside the paste arm: Ctrl-L also empties `pastedContents` without touching
 *  `pasteCounter`, which reads as an expand, and undo restores an older map, which reads as either. Scoped
 *  to the arm, the derivation below is exact. */
export type PasteSignal = { kind: "chip"; content: string } | { kind: "expand" };
export interface EditorResult {
  state: EditorState; submit?: string; killed?: { text: string; dir: "append" | "prepend" }; paste?: PasteSignal;
  /** F5 task 7: what this submit put into the history list, for the composer to PERSIST (`cgr`, L548774).
   *  Reported rather than re-derived because the two submit arms disagree with `submit` in both directions —
   *  a turn's history text keeps the chip LABELS while `submit` carries the expanded payload, and a command's
   *  is the completed `/name` rather than whatever half-typed prefix was in the buffer. */
  historyAppend?: HistNavEntry;
}
/** Minimal structural subset of ink's Key the reducer reads (so editor.ts needs no ink import). */
export interface KeyFlags {
  return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean;
  leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; escape?: boolean; tab?: boolean;
  /** NOT an ink flag: the event's PROVENANCE, carried through `toKeyFlags` from the keymap's `TextEvent`. A
   *  bracketed paste (`\x1b[200~ … \x1b[201~`, assembled by KeymapProvider) takes the chip path on this flag
   *  ALONE, at any size. An untagged run takes it only past CHIP_CHARS — upstream's terminal-without-DECSET-2004
   *  fallback; see the `key.paste ||` arm in applyKeyInner (F5 task 3). */
  paste?: boolean;
}

export function initialEditorState(history: HistNavEntry[] = []): EditorState {
  return { lines: [""], cursor: { row: 0, col: 0 }, history: [...history], histIndex: null, stash: null, histEdits: new Map(), histMode: undefined, histRecalled: null, historySeeded: false, stashed: null, undo: [], pastedContents: {}, pasteCounter: 0, hasUsedBackslashReturn: false, mention: null, command: null, killRing: [], killRun: false, yankSite: null };
}
/** The fields that outlive a submit, a clear, or a composer remount: the history list and its seed flag, the
 *  Ctrl-S stash, the kill ring, and the one-way backslash flag. Everything else is buffer state and dies with
 *  the buffer. Named once so the three reset sites cannot drift apart. */
const durable = (s: EditorState) => ({ historySeeded: s.historySeeded, stashed: s.stashed, killRing: s.killRing, hasUsedBackslashReturn: s.hasUsedBackslashReturn });
/** CM17, upstream `o9f({ maxBufferSize: 50, debounceMs: 1000 })` (bundle L495478). Upstream debounces pushes on
 *  a real timer; a pure reducer has none, so `applyKey` coalesces on the elapsed `now` instead (see there). */
export const UNDO_CAP = 50;
export const UNDO_COALESCE_MS = 1000;

/** The composer's current input mode, derived purely from the buffer: a leading `!` = bash, `#` = memory
 *  (CC's prefix modes). The `/` and `@` popups own their own state, so they suppress this.
 *
 *  The prefix reading itself is `composerMode` in promptMode.ts, shared with the history seed (t7 review,
 *  M1): before that, this function's three-valued answer went onto a submitted entry while the disk seed
 *  wrote a two-valued one, so the same `#note` prompt carried `"memory"` in-session and `"normal"` after a
 *  restart. One derivation, one answer, whichever side of the file you are on. */
export function inputMode(s: EditorState): InputMode {
  if (s.command || s.mention) return "normal";
  return composerMode(s.lines[0] ?? "");
}

const PASTE_MARKERS = /\x1b?\[20[01]~/g;                    // \x1b[200~ / \x1b[201~ and ESC-stripped [200~/[201~
export function stripPasteMarkers(s: string): string { return s.replace(PASTE_MARKERS, ""); }
const splitLines = (t: string): string[] => t.split(/\r\n|\r|\n/);
/** Exported for editorHistory.ts, which parks and restores whole buffers and must do it the one way this
 *  file does — a second `lines.join("\n")`/`split` pair over there is the definition guaranteed to drift. */
export const bufferText = (s: EditorState): string => s.lines.join("\n");
const isBlank = (s: EditorState): boolean => bufferText(s).trim().length === 0;

/** Exported for pasteChips.ts's `ingestPaste`, which inserts either a chip label or the normalized payload and
 *  must land it exactly the way every other insertion does (see that file's cycle note). */
export function insertText(s: EditorState, t: string): EditorState {
  const lines = [...s.lines]; const { row, col } = s.cursor; const cur = lines[row];
  const before = cur.slice(0, col), after = cur.slice(col); const parts = splitLines(t);
  if (parts.length === 1) { lines[row] = before + parts[0] + after; return { ...s, lines, cursor: { row, col: col + parts[0].length } }; }
  const mid = parts.slice(1, -1); const last = parts[parts.length - 1];
  lines.splice(row, 1, before + parts[0], ...mid, last + after);
  return { ...s, lines, cursor: { row: row + parts.length - 1, col: last.length } };
}
function removeRange(s: EditorState, start: Cursor, end: Cursor): EditorState {
  const lines = [...s.lines];
  const merged = lines[start.row].slice(0, start.col) + lines[end.row].slice(end.col);
  lines.splice(start.row, end.row - start.row + 1, merged);
  return { ...s, lines, cursor: { ...start } };
}
function deleteLeft(s: EditorState): EditorState {
  const lines = [...s.lines]; const { row, col } = s.cursor;
  if (col > 0) { lines[row] = lines[row].slice(0, col - 1) + lines[row].slice(col); return { ...s, lines, cursor: { row, col: col - 1 } }; }
  if (row > 0) { const prev = lines[row - 1].length; lines[row - 1] = lines[row - 1] + lines[row]; lines.splice(row, 1); return { ...s, lines, cursor: { row: row - 1, col: prev } }; }
  return s;
}
// F5 t4: `left()`/`right()` (bundle L394793 / L394803) step over a WHOLE placeholder — `placeholderEndingAt` /
// `placeholderStartingAt` at the cursor, jump to its far edge. A chip is one object, so it costs one keypress
// either way. Without this the snap-out in applyKey would make chips impassable: → out of the start edge lands
// one cell in, and the nearer edge is the one just left, so the caret bounces back forever.
function moveLeft(s: EditorState): EditorState {
  const { row, col } = s.cursor;
  if (col > 0) { const chip = chipEndingAt(s.lines[row], col); return { ...s, cursor: { row, col: chip ? chip.start : col - 1 } }; }
  if (row > 0) return { ...s, cursor: { row: row - 1, col: s.lines[row - 1].length } };
  return s;
}
function moveRight(s: EditorState): EditorState {
  const { row, col } = s.cursor;
  if (col < s.lines[row].length) { const chip = chipStartingAt(s.lines[row], col); return { ...s, cursor: { row, col: chip ? chip.end : col + 1 } }; }
  if (row < s.lines.length - 1) return { ...s, cursor: { row: row + 1, col: 0 } };
  return s;
}
// Readline-style cursor + kill ops, scoped to the current line (the common case).
function lineStart(s: EditorState): EditorState { return { ...s, cursor: { row: s.cursor.row, col: 0 } }; }
function lineEnd(s: EditorState): EditorState { return { ...s, cursor: { row: s.cursor.row, col: s.lines[s.cursor.row].length } }; }
function killToEnd(s: EditorState): { state: EditorState; text: string } {     // Ctrl-K → ring, append
  const { row, col } = s.cursor; const lines = [...s.lines]; const text = lines[row].slice(col);
  lines[row] = lines[row].slice(0, col); return { state: { ...s, lines }, text };
}
function killToStart(s: EditorState): { state: EditorState; text: string } {   // Ctrl-U → ring, prepend
  const { row, col } = s.cursor; const lines = [...s.lines]; const text = lines[row].slice(0, col);
  lines[row] = lines[row].slice(col); return { state: { ...s, lines, cursor: { row, col: 0 } }, text };
}
// F5 t4-fix: upstream's `deleteWordBefore` (bundle L395146) opens with
// `snapOutOfPlaceholder(this.prevWord().offset, "start")` — the boundary is snapped BEFORE the range is cut, so a
// Ctrl-W right after a chip kills the WHOLE label into the ring instead of the `lines]` tail (a label is full of
// spaces). Killing the whole thing is what makes the ring ROUND-TRIP, and since t4-fix2 that is literally true
// rather than half true: the ring parks label text only, but the map now lives until submit, so Ctrl-Y puts back
// a label whose entry is still there and the submit sends the payload. A killed FRAGMENT would come back as text
// no recognizer matches, and the payload would be unreachable even though its entry survived.
function killWordBack(s: EditorState): { state: EditorState; text: string } {  // Ctrl-W → ring, prepend
  const { row, col } = s.cursor;
  if (col === 0) {
    if (row === 0) return { state: s, text: "" };
    const previous = s.lines[row - 1];
    let i = previous.length;
    while (i > 0 && /\s/.test(previous[i - 1])) i--;
    while (i > 0 && !/\s/.test(previous[i - 1])) i--;
    i = chipContaining(previous, i)?.start ?? i;
    const lines = [...s.lines];
    lines[row - 1] = previous.slice(0, i) + lines[row];
    lines.splice(row, 1);
    return { state: { ...s, lines, cursor: { row: row - 1, col: i } }, text: previous.slice(i) + "\n" };
  }
  const line = s.lines[row];
  let i = col; while (i > 0 && /\s/.test(line[i - 1])) i--; while (i > 0 && !/\s/.test(line[i - 1])) i--;
  i = chipContaining(line, i)?.start ?? i;
  const lines = [...s.lines]; lines[row] = line.slice(0, i) + line.slice(col);
  return { state: { ...s, lines, cursor: { row, col: i } }, text: line.slice(i, col) };
}
function yank(s: EditorState): EditorState {                 // Ctrl-Y: insert the newest kill at the cursor
  const text = s.killRing[s.killRing.length - 1]; if (text === undefined) return s;
  const start = { ...s.cursor }; const ins = insertText(s, text);
  // killRun: false — a yank ends the accumulation run (upstream sets mode "yanked"), so the next kill
  // starts a fresh ring entry instead of coalescing into the one just yanked.
  return { ...ins, killRun: false, yankSite: { start, end: { ...ins.cursor }, index: s.killRing.length - 1 } };
}
function yankPop(s: EditorState): EditorState {              // Alt-Y right after a yank: cycle the ring at the yank site
  const site = s.yankSite; if (!site || s.killRing.length === 0) return s;
  const index = (site.index - 1 + s.killRing.length) % s.killRing.length;
  const base = removeRange(s, site.start, site.end);
  const ins = insertText(base, s.killRing[index]);
  return { ...ins, killRun: false, yankSite: { start: { ...site.start }, end: { ...ins.cursor }, index } };
}
// F5 t4: a word boundary that lands INSIDE a chip snaps out in the DIRECTION OF TRAVEL — upstream's
// `prevWord()` ends in `snapOutOfPlaceholder(r, "start")` (L395064) and `nextWord()` in `…(t, "end")` (L394998).
// A label is full of spaces, so without this every chip would swallow four or five Alt-arrow presses (and, with
// applyKey's nearer-edge snap on top, bounce the caret back to the edge it started from).
function wordLeft(s: EditorState): EditorState {         // Alt/Option-Left (and Alt-b): jump back a word
  let { row, col } = s.cursor;
  if (col === 0) { if (row === 0) return s; return { ...s, cursor: { row: row - 1, col: s.lines[row - 1].length } }; }
  const line = s.lines[row];
  let i = col; while (i > 0 && /\s/.test(line[i - 1])) i--; while (i > 0 && !/\s/.test(line[i - 1])) i--;
  return { ...s, cursor: { row, col: chipContaining(line, i)?.start ?? i } };
}
function wordRight(s: EditorState): EditorState {        // Alt/Option-Right (and Alt-f): jump forward a word
  let { row, col } = s.cursor;
  const line = s.lines[row];
  if (col >= line.length) { if (row === s.lines.length - 1) return s; return { ...s, cursor: { row: row + 1, col: 0 } }; }
  let i = col; while (i < line.length && /\s/.test(line[i])) i++; while (i < line.length && !/\s/.test(line[i])) i++;
  return { ...s, cursor: { row, col: chipContaining(line, i)?.end ?? i } };
}
/** Alt-d (CM12, bundle meta map `["d", () => W.deleteWordAfter()]`): delete forward to the next word boundary.
 *  Upstream's `deleteWordAfter` is a plain text modify — it never dispatches a kill — so this is deliberately
 *  NOT a kill op: it reports no `killed`, so it feeds no ring and (like any other edit) ends a kill run. */
function deleteWordAfter(s: EditorState): EditorState {
  const to = wordRight(s).cursor;
  if (to.row === s.cursor.row && to.col === s.cursor.col) return s;      // at the end of the buffer
  return removeRange(s, s.cursor, to);
}
function moveCursorVert(s: EditorState, delta: number): EditorState {
  const row = s.cursor.row + delta;
  if (row < 0 || row >= s.lines.length) return s;
  return { ...s, cursor: { row, col: Math.min(s.cursor.col, s.lines[row].length) } };
}
/** CM18, bundle L395679: `if (d && W.offset > 0 && W.text[W.offset-1] === "\\") return CXs(), W.backspace().insert("\n")`.
 *  The trigger is the character BEFORE THE CURSOR (see `continuesLine` below), and the action is literally a
 *  backspace over that backslash followed by a newline AT THE CURSOR — so a mid-line `\` splits mid-line.
 *  `CXs` is `markBackslashReturnUsed`, a one-way flag the composer's newline hint reads (F5 task 2). */
function continueLine(s: EditorState): EditorState {
  return { ...insertText(deleteLeft(s), "\n"), hasUsedBackslashReturn: true };
}
const continuesLine = (s: EditorState): boolean => s.cursor.col > 0 && s.lines[s.cursor.row][s.cursor.col - 1] === "\\";
function submitTurn(s: EditorState): EditorResult {
  if (isBlank(s)) return { state: s };
  const t = bufferText(s);
  // `cgr({ display: hon(_t, iD), pastedContents: QL })` (L548774). `hon` re-attaches the mode prefix upstream
  // strips off its buffer; ours never took it off, so `t` IS `hon`'s output. The WHOLE live map rides along,
  // upstream's `QL` — `appendHistory` decides per entry whether the body inlines or goes to the paste cache.
  const entry: HistNavEntry = { display: t, mode: composerMode(t), pastedContents: s.pastedContents };
  const history = pushHistory(s.history, entry);
  // The stash SURVIVES a send (2.1.220 chat:stash keeps it in state separate from the buffer) — park a
  // draft, fire a quick question, Ctrl-S restores the draft. The undo stack does reset with the buffer.
  // The kill ring survives too (like the stash) — a submit is not a keystroke that should clear it. So does
  // `hasUsedBackslashReturn`: upstream keeps it in PERSISTED config (`markBackslashReturnUsed`), so nothing
  // inside a session can unlearn it. The paste chips do NOT — they are placeholders in the buffer that just left.
  //
  // `fSe` (F5 task 3): the buffer showed `[Pasted text #1 +40 lines]`, the MODEL gets the forty lines. History
  // keeps the display text — that is what the user typed and what Up must bring back, chip label and all (the
  // map that makes it expandable is task 6's problem to persist).
  return { state: { ...initialEditorState(history), ...durable(s) }, submit: substituteChips(t, s.pastedContents), historyAppend: entry };
}

/** Esc-Esc's second press (upstream L395630-L395634): `if (e.trim() !== "") cgr(e)`, then clear. Blank buffer
 *  = clear-only. Note what upstream hands `cgr` there: the bare TEXT, which `uu_` widens to
 *  `{ display: e, pastedContents: {} }` (L317597) — so an Esc-Esc'd draft persists WITHOUT its pastes, unlike
 *  a submit. Transcribed, including the omission: the gesture is "throw this away", and writing an
 *  unsubmitted paste body to the on-disk cache on the way out is the last thing it should do. The in-memory
 *  entry drops them for the same reason, so the recalled labels behave identically in both directions. */
export function clearToHistory(s: EditorState): EditorState {
  const t = bufferText(s);
  if (t.length === 0) return s;
  const history = t.trim().length === 0 ? s.history : pushHistory(s.history, { display: t, mode: composerMode(t) });
  return { ...initialEditorState(history), ...durable(s) };
}

/** Replace the buffer text, cursor at the end. Exported for editorHistory.ts (see `bufferText`). */
export function setBuffer(s: EditorState, t: string): EditorState {
  const lines = splitLines(t); const r = lines.length - 1;
  return { ...s, lines, cursor: { row: r, col: lines[r].length } };
}
/** Replace the buffer's text wholesale, cursor at the end — the composer's rewind prefill (edit-and-resend). */
/** Replace text supplied by a non-editor source; old-buffer navigation, popup, kill, and undo state cannot survive it. */
export function replaceBufferFromOutside(s: EditorState, t: string): EditorState {
  const lines = splitLines(t); const r = lines.length - 1;
  return { ...s, lines, cursor: { row: r, col: lines[r].length }, histIndex: null, stash: null, histEdits: new Map(), histMode: undefined, histRecalled: null, undo: [], pastedContents: {}, mention: null, command: null, killRun: false, yankSite: null };
}
/** Replace the buffer's text wholesale, cursor at the end — the composer's rewind prefill (edit-and-resend). */
export function withBufferText(s: EditorState, t: string): EditorState { return replaceBufferFromOutside(s, t); }
function atWordBoundary(s: EditorState): boolean {
  const { row, col } = s.cursor; const at = col - 1;            // the just-inserted '@' is at col-1
  if (at <= 0) return true;
  return /\s/.test(s.lines[row][at - 1] ?? "");
}
function openMention(s: EditorState): EditorState {
  return { ...s, mention: { anchor: { row: s.cursor.row, col: s.cursor.col - 1 }, query: "", files: [], items: [], index: 0 } };
}
function refreshMention(s: EditorState): EditorState {
  const m = s.mention; if (!m) return s; const { row, col } = s.cursor;
  if (row !== m.anchor.row || col <= m.anchor.col) return { ...s, mention: null };   // cursor left the token
  const query = s.lines[row].slice(m.anchor.col + 1, col);
  if (/\s/.test(query)) return { ...s, mention: null };          // a space ends the mention
  return { ...s, mention: { ...m, query, items: rankCandidates(m.files, query), index: 0 } };
}
function moveMention(s: EditorState, delta: number): EditorState {
  const m = s.mention!; if (m.items.length === 0) return s;
  return { ...s, mention: { ...m, index: Math.max(0, Math.min(m.items.length - 1, m.index + delta)) } };
}
function acceptMention(s: EditorState): EditorState {
  const m = s.mention; if (!m || m.items.length === 0) return { ...s, mention: null };
  const chosen = m.items[Math.min(m.index, m.items.length - 1)]; const row = m.anchor.row; const line = s.lines[row];
  const replacement = "@" + chosen.path + " ";                  // insert "@path " (trailing space for ergonomics)
  const lines = [...s.lines]; lines[row] = line.slice(0, m.anchor.col) + replacement + line.slice(s.cursor.col);
  return { ...s, lines, cursor: { row, col: m.anchor.col + replacement.length }, mention: null };
}
export function setMentionFiles(s: EditorState, files: string[]): EditorState {
  if (!s.mention) return s;
  return { ...s, mention: { ...s.mention, files, items: rankCandidates(files, s.mention.query), index: 0 } };
}
function openCommand(s: EditorState): EditorState {
  return { ...s, command: { query: "", items: [], catalog: [], index: 0 } };       // anchor is implicit: the '/' at row 0 col 0
}
function refreshCommand(s: EditorState): EditorState {
  const c = s.command; if (!c) return s; const { row, col } = s.cursor;
  if (row !== 0 || col <= 0 || s.lines[0][0] !== "/") return { ...s, command: null };  // cursor left the leading-slash token
  const query = s.lines[0].slice(1, col);
  if (/\s/.test(query)) return { ...s, command: null };                                // a space ends the command name
  return { ...s, command: { ...c, query, items: rankCommands(c.catalog, query), index: 0 } };
}
export function setCommandCatalog(s: EditorState, catalog: CommandEntry[]): EditorState {
  if (!s.command) return s;
  return { ...s, command: { ...s.command, catalog, items: rankCommands(catalog, s.command.query), index: 0 } };
}
function moveCommand(s: EditorState, delta: number): EditorState {
  const c = s.command!; if (c.items.length === 0) return s;
  return { ...s, command: { ...c, index: Math.max(0, Math.min(c.items.length - 1, c.index + delta)) } };
}
function completeCommandName(s: EditorState): EditorState {
  const c = s.command; if (!c || c.items.length === 0) return { ...s, command: null };
  const name = c.items[Math.min(c.index, c.items.length - 1)].name;
  const repl = "/" + name + " ";
  const lines = [...s.lines]; lines[0] = repl + s.lines[0].slice(s.cursor.col);
  return { ...s, lines, cursor: { row: 0, col: repl.length }, command: null };
}
function submitCommand(s: EditorState): EditorResult {
  const c = s.command!;
  const name = c.items.length ? c.items[Math.min(c.index, c.items.length - 1)].name : s.lines[0].slice(1);
  const t = "/" + name;
  const entry: HistNavEntry = { display: t, mode: composerMode(t) };
  return { state: { ...initialEditorState(pushHistory(s.history, entry)), ...durable(s) }, submit: t, historyAppend: entry };
}
const syncCompletions = (s: EditorState): EditorState => (s.command ? refreshCommand(s) : (s.mention ? refreshMention(s) : s));
function afterInsert(next: EditorState, prev: EditorState, t: string): EditorState {
  if (prev.command) return refreshCommand(next);                                            // command open → refresh (no mention)
  if (t === "/" && prev.lines.length === 1 && prev.lines[0] === "") return openCommand(next); // buffer-leading '/'
  if (t === "@" && atWordBoundary(next)) return openMention(next);
  return prev.mention ? refreshMention(next) : next;
}
// The walk takes the CURRENT input mode as an argument (see editorHistory.ts): it decides CM55's latch and
// rides along on every parked edit, and `inputMode` is this file's to compute.
function onUp(s: EditorState): EditorState { if (s.command) return moveCommand(s, -1); if (s.mention) return moveMention(s, -1); if (s.cursor.row === 0) return historyPrev(s, inputMode(s)); return moveCursorVert(s, -1); }
function onDown(s: EditorState): EditorState { if (s.command) return moveCommand(s, 1); if (s.mention) return moveMention(s, 1); if (s.cursor.row === s.lines.length - 1) return historyNext(s, inputMode(s)); return moveCursorVert(s, 1); }

function clearInput(s: EditorState): EditorState {           // Ctrl-L = CC chat:clearInput (screen clear stays /clear)
  return { ...s, lines: [""], cursor: { row: 0, col: 0 }, pastedContents: {}, mention: null, command: null };
}
/** Ctrl-S = CC `chat:stash` (`PPe`, L495831): park non-empty input, restore when empty. The record is the
 *  full triple in BOTH directions (see `StashRecord`) — `x({})` clears the live map on the way out and
 *  `x(A.pastedContents)` puts it back on the way in, so a stashed draft's chips still expand after the round
 *  trip. `clearInput` is our `At("") + x({})`; the parked cursor is re-applied over `setBuffer`'s end-of-text
 *  default, which is upstream's `Qe(A.cursorOffset)`. */
function stashToggle(s: EditorState): EditorState {
  if (!isBlank(s)) return { ...clearInput(s), stashed: { display: bufferText(s), cursor: s.cursor, pastedContents: s.pastedContents } };
  const parked = s.stashed;
  if (parked != null) return { ...setBuffer(s, parked.display), cursor: parked.cursor, pastedContents: parked.pastedContents, stashed: null };
  return s;
}
function undoEdit(s: EditorState): EditorState {             // Ctrl-_ / Ctrl-- = CC chat:undo (terminals send 0x1F for both)
  const last = s.undo[s.undo.length - 1];
  if (!last) return s;
  // The chips ride along with the text they belong to (upstream's entries carry `pastedContents` too): undoing
  // past a paste whose placeholder is gone must bring its content back, or the chip renders as a dead label.
  return { ...s, lines: last.lines, cursor: last.cursor, pastedContents: last.pastedContents, undo: s.undo.slice(0, -1), mention: null, command: null };
}

function applyKeyInner(s: EditorState, input: string, key: KeyFlags, rows?: number): EditorResult {
  if (input === "\x1f") return { state: undoEdit(s) };       // Ctrl-_ / Ctrl-- arrive as the bare C0 byte; Ink sets NO flags on it
  // Alt/Option word movement (Alt-←→, Alt-b/f) — checked BEFORE key.ctrl so no meta combo ever falls through to
  // insert. Ink also sets key.meta on a BARE Escape and on ESC-prefixed backspace/delete (use-input.js:
  // meta = keypress.meta || keypress.name === "escape" || keypress.option), so those must NOT be swallowed here —
  // exclude them so escape/backspace/delete/return keep their own semantics via the handlers further below.
  if (key.meta && !key.escape && !key.backspace && !key.delete && !key.return) {
    if (key.leftArrow || input === "b") return { state: syncCompletions(wordLeft(s)) };
    if (key.rightArrow || input === "f") return { state: syncCompletions(wordRight(s)) };
    if (input === "y") return { state: syncCompletions(yankPop(s)) };
    if (input === "d") return { state: syncCompletions(deleteWordAfter(s)) };   // CM12; NOT a kill (see deleteWordAfter)
    return { state: s };                                 // an unrecognized meta combo never inserts text
  }
  if (key.ctrl) {                                        // readline keys; other ctrl combos (l/c/d) act at app level → ignore here (never insert)
    switch (input) {
      // CM12, bundle L395676 — the ctrl map verbatim: a=startOfLogicalLine, b=left, e=endOfLogicalLine, f=right,
      // h=deleteTokenBefore()??backspace(), n=the down body, p=the up body. CM14: a/e are LOGICAL-line ends, and
      // our buffer is already unwrapped logical lines, so lineStart/lineEnd ARE upstream's two ops.
      case "a": return { state: syncCompletions(lineStart(s)) };
      case "e": return { state: syncCompletions(lineEnd(s)) };
      case "b": return { state: syncCompletions(moveLeft(s)) };
      case "f": return { state: syncCompletions(moveRight(s)) };
      case "h": return { state: syncCompletions(deleteTokenBefore(s) ?? deleteLeft(s)) };
      case "n": return { state: onDown(s) };                        // history at the bottom edge, popup nav while open
      case "p": return { state: onUp(s) };
      // A kill keystroke ALWAYS reports `killed` (even with empty text) so applyKey's wrapper can tell "a
      // kill that killed nothing" apart from "not a kill at all" — the former must never break the run.
      case "k": { const r = killToEnd(s); return { state: syncCompletions(r.state), killed: { text: r.text, dir: "append" as const } }; }
      case "u": { const r = killToStart(s); return { state: syncCompletions(r.state), killed: { text: r.text, dir: "prepend" as const } }; }
      case "w": { const r = killWordBack(s); return { state: syncCompletions(r.state), killed: { text: r.text, dir: "prepend" as const } }; }
      case "y": return { state: syncCompletions(yank(s)) };
      case "l": return { state: clearInput(s) };
      case "s": return { state: stashToggle(s) };
      default: return { state: s };
    }
  }
  if (key.return) {
    // F5 Task 2: shift+Return is a NEWLINE, not a submit. The only thing that produces `return + shift` is
    // the `\x1b\r` the parser already singles out as "/terminal-setup's shift+enter" (keys/parse.ts:95) —
    // a terminal only sends that byte pair BECAUSE it was configured to mean newline, so submitting on it
    // contradicted the very setup that emitted it. This is what makes the composer's `Z_a` rung-1 hint
    // ("shift + ⏎ for newline", bundle L433225) true here rather than a promise the editor breaks.
    //
    // ORDER, from `ae` (bundle L395679): the `\`-continuation is tested BEFORE `meta || shift`. It matters —
    // shift+Return on a buffer ending in `\` must EAT the backslash and set the used-flag (upstream's `CXs`),
    // not insert a newline under a backslash the user meant as the continuation marker (t2 review, Minor).
    if (continuesLine(s)) return { state: continueLine(s) };
    if (key.shift) return { state: insertText(s, "\n") };
    if (s.command) return submitCommand(s);
    if (s.mention) return { state: acceptMention(s) };
    return submitTurn(s);
  }
  if (key.tab) { if (s.command) return { state: completeCommandName(s) }; return { state: s.mention ? acceptMention(s) : s }; }
  if (key.escape) { if (s.command) return { state: { ...s, command: null } }; return { state: s.mention ? { ...s, mention: null } : s }; }
  // CM12, bundle L395791: `backspace` is `deleteTokenBefore() ?? backspace()` — a chip goes in one keystroke.
  // `delete` is upstream's forward `del()`; this port has always aliased it to backspace, so it shares the arm.
  if (key.backspace || key.delete) return { state: syncCompletions(deleteTokenBefore(s) ?? deleteLeft(s)) };
  if (key.leftArrow) return { state: syncCompletions(moveLeft(s)) };
  if (key.rightArrow) return { state: syncCompletions(moveRight(s)) };
  if (key.upArrow) return { state: onUp(s) };
  if (key.downArrow) return { state: onDown(s) };
  // A BRACKETED paste (the keymap tagged it; see KeyFlags.paste): normalise it, then chip it or insert it —
  // `ingestPaste` owns that decision because it also owns the id counter and the map, and returns `s` unchanged
  // when the payload normalises to nothing. The result still goes through the SAME `afterInsert` an ordinary
  // insertion runs, so an open `/` or `@` popup refreshes against the new text. `input` is handed to it RAW:
  // afterInsert's two open-a-popup triggers are the single characters `/` and `@`, which normalisation cannot
  // produce from anything but themselves, so every branch it takes is the same one the normalized token would
  // have taken — and a megabyte paste is not walked twice to learn that.
  //
  // …OR an UNTAGGED run longer than CHIP_CHARS. Upstream chips that too — `zhn`'s keydown arm (bundle
  // L395998–L396004) sends `!ctrl && !meta && T.key.length > CMt` down the very same `onPaste` path as a
  // marked paste — and it is precisely the fallback for a terminal that never sent `\x1b[200~` (one that
  // ignores DECSET 2004, or a `ccx` attached through something that strips it). The comparison is on the RAW
  // `input` length, before normalisation, exactly like upstream's `T.key.length`. ctrl/meta combos returned
  // long before this line, so the guard upstream spells out is already in force here. No human types 800
  // characters into one read; a short multi-character run still inserts literally (t3 review, Important).
  if (key.paste || input.length > CHIP_CHARS) {
    const next = ingestPaste(s, input, rows);
    if (next === s) return { state: s };
    // Which of ingestPaste's three outcomes this was (F5 task 5). A minted chip advanced the counter; an
    // expand left it alone and removed the entry it names; a sub-threshold insert did neither.
    const minted = next.pasteCounter > s.pasteCounter ? next.pastedContents[next.pasteCounter] : undefined;
    const paste: PasteSignal | undefined = minted ? { kind: "chip", content: minted.content }
      : s.pastedContents[s.pasteCounter] !== undefined && next.pastedContents[s.pasteCounter] === undefined ? { kind: "expand" }
      : undefined;
    return { state: afterInsert(next, s, input), paste };
  }
  if (input) { const t = stripPasteMarkers(input); if (!t) return { state: s }; return { state: afterInsert(insertText(s, t), s, t) }; }
  return { state: s };
}

/** Buffer equality by CONTENT, not array identity. killToEnd/killToStart/clearInput all allocate a
 *  fresh `lines` array unconditionally, so an identity check calls Ctrl-K-at-end-of-line (or Ctrl-U at
 *  column 0, or Ctrl-L on an empty buffer) a change and snapshots the buffer onto itself — the next
 *  Ctrl-_ then restores identical text and undo looks broken. */
const sameText = (a: string[], b: string[]) => a === b || (a.length === b.length && a.every((l, i) => l === b[i]));

/** End a normal input sequence without changing any buffer, history, stash, ring, or undo data.
 * Composer-owned commands call this when they intercept a non-kill key before the reducer can do so. */
export function endKillAndYank(s: EditorState): EditorState {
  return s.killRun || s.yankSite ? { ...s, killRun: false, yankSite: null } : s;
}

/** Snapshot-on-change undo: any key that changed the buffer pushes the PRIOR buffer (cap UNDO_CAP = 50). An op
 *  that managed the stack itself (undoEdit pops it) is recognized by its own `undo` identity change;
 *  a submit returns a fresh initialEditorState, so its stack is already empty. Also folds a kill into
 *  the ring (coalescing an unbroken run) and tracks when that run / a yank-pop site ends.
 *
 *  CM17 coalescing, and the one deliberate divergence in this file. Upstream (`o9f`, bundle L489735-L489748)
 *  DEBOUNCES on a real timer: each in-window change CANCELS and RESCHEDULES the pending push with its own
 *  captured prior-state, so a continuous typing run of any length lands exactly ONE entry after quiescence —
 *  and that entry holds the buffer as of just before the run's LAST keystroke (pushes carry prior state,
 *  L495497/L495808), so upstream's undo after fast-typing "hello" reverts one character. A pure reducer has
 *  no timer, so we drop in-window changes instead of deferring: our undo after the same run reverts the
 *  WHOLE run to the pre-run buffer, and a run longer than the window lands one entry per 1000 ms where
 *  upstream lands one total. Both directions of that gap are the accepted divergence (t1 review; transcribe
 *  as-is into the F5 parity note). `now` is injectable so the window is testable.
 *
 *  `rows` is the terminal's CURRENT height, threaded from the composer (same source as its `columns`) purely
 *  for the paste-chip threshold, which upstream reads off the live terminal. The reducer stays pure: the value
 *  is a parameter, never a read. */
export function applyKey(s: EditorState, input: string, key: KeyFlags, now: number = Date.now(), rows?: number): EditorResult {
  const r = applyKeyInner(s, input, key, rows);
  let state = r.state;
  // A kill keystroke that killed nothing (Ctrl-K at end of line, Ctrl-U at col 0, Ctrl-W at col 0) must
  // NEVER break the run — it just doesn't have anything to fold in. `killed` is stripped to undefined on
  // the public result in that case (a defined `killed` always has non-empty text), but killRun is left
  // exactly as it was so the next real kill still coalesces.
  const killed = r.killed && r.killed.text ? r.killed : undefined;
  if (r.killed) {
    if (killed) {                                            // fold into the ring; a run coalesces into the newest entry
      const head = s.killRing[s.killRing.length - 1];
      const ring = s.killRun && head !== undefined
        ? [...s.killRing.slice(0, -1), killed.dir === "append" ? head + killed.text : killed.text + head]
        : [...s.killRing, killed.text].slice(-10);
      state = { ...state, killRing: ring, killRun: true, yankSite: null };
    } else {
      state = { ...state, yankSite: null };                  // no-op kill: preserve killRun as-is, still fix a pending yank
    }
  } else if (state.yankSite === s.yankSite) {
    state = endKillAndYank(state);                            // any non-kill keystroke ends the run; any non-yank-pop fixes the yank
  }
  // F5 t4: snap out of a chip the cursor landed INSIDE — the one chip mechanic that belongs to no single key,
  // so every arm above stays chip-blind. Only when the text did NOT change: a key that changed the text has
  // already placed its own cursor deliberately (an insert mid-label must stay put).
  //
  // There is deliberately NO live GC of `pastedContents` here (t4-fix2, reverting the brief's rule). Upstream
  // never prunes TEXT entries against the live buffer: its GC effect is gated on the map holding an image or
  // audio entry and filters to those two species (bundle L495715–L495728), and text entries are pruned only
  // implicitly at submit, where the OUTGOING map is rebuilt from the ids actually present in the text
  // (L536788–L536792). That is not an oversight — it is what makes every "park the text somewhere and put it
  // back" site work with no special handling: the kill ring, history, the Ctrl-S stash and undo all move label
  // TEXT around, and a map pruned the instant a label left the buffer would strand the payload on the way back
  // (measured: Ctrl-W → Ctrl-Y → submit sent the literal `[Pasted text #1 …]`). A stale entry is inert —
  // `substituteChips` expands only ids whose label is present — and dies with the buffer at submit.
  if (sameText(state.lines, s.lines) && (state.cursor.row !== s.cursor.row || state.cursor.col !== s.cursor.col)) state = snapOut(state);
  if (r.submit !== undefined) return { ...r, state, killed };
  if (state === s) return { ...r, killed };
  if (sameText(state.lines, s.lines) || state.undo !== s.undo) return { ...r, state, killed };
  const head = s.undo[s.undo.length - 1];
  if (head && now - head.at < UNDO_COALESCE_MS) return { ...r, state, killed };            // inside the window: fold in
  const entry = { lines: s.lines, cursor: s.cursor, pastedContents: s.pastedContents, at: now };
  return { ...r, state: { ...state, undo: [...s.undo.slice(-(UNDO_CAP - 1)), entry] }, killed };
}
