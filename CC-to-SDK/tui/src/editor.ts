// tui/src/editor.ts — pure multiline-editor reducer for the chat composer. No React/Ink/fs; the @-mention FS
// walk is injected by the component. Probe 17d7116: a multi-line write is ONE useInput call (input = whole
// string, embedded \n/\r, no key.return) → paste = insert-and-split; submit = a lone key.return; `\`+Enter =
// continuation. rankCandidates (pure) is added in the mention pass.
import { rankCandidates } from "./fileComplete.js";
export interface Cursor { row: number; col: number }
export interface Candidate { path: string; score: number }
export interface MentionState { anchor: Cursor; query: string; files: string[]; items: Candidate[]; index: number }
export interface EditorState {
  lines: string[]; cursor: Cursor; history: string[]; histIndex: number | null; stash: string | null; mention: MentionState | null;
}
export interface EditorResult { state: EditorState; submit?: string }
/** Minimal structural subset of ink's Key the reducer reads (so editor.ts needs no ink import). */
export interface KeyFlags {
  return?: boolean; backspace?: boolean; delete?: boolean;
  leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; escape?: boolean; tab?: boolean;
}

export function initialEditorState(history: string[] = []): EditorState {
  return { lines: [""], cursor: { row: 0, col: 0 }, history: [...history], histIndex: null, stash: null, mention: null };
}

const PASTE_MARKERS = /\x1b?\[20[01]~/g;                    // \x1b[200~ / \x1b[201~ and ESC-stripped [200~/[201~
export function stripPasteMarkers(s: string): string { return s.replace(PASTE_MARKERS, ""); }
const splitLines = (t: string): string[] => t.split(/\r\n|\r|\n/);
const bufferText = (s: EditorState): string => s.lines.join("\n");
const isBlank = (s: EditorState): boolean => bufferText(s).trim().length === 0;

function insertText(s: EditorState, t: string): EditorState {
  const lines = [...s.lines]; const { row, col } = s.cursor; const cur = lines[row];
  const before = cur.slice(0, col), after = cur.slice(col); const parts = splitLines(t);
  if (parts.length === 1) { lines[row] = before + parts[0] + after; return { ...s, lines, cursor: { row, col: col + parts[0].length } }; }
  const mid = parts.slice(1, -1); const last = parts[parts.length - 1];
  lines.splice(row, 1, before + parts[0], ...mid, last + after);
  return { ...s, lines, cursor: { row: row + parts.length - 1, col: last.length } };
}
function deleteLeft(s: EditorState): EditorState {
  const lines = [...s.lines]; const { row, col } = s.cursor;
  if (col > 0) { lines[row] = lines[row].slice(0, col - 1) + lines[row].slice(col); return { ...s, lines, cursor: { row, col: col - 1 } }; }
  if (row > 0) { const prev = lines[row - 1].length; lines[row - 1] = lines[row - 1] + lines[row]; lines.splice(row, 1); return { ...s, lines, cursor: { row: row - 1, col: prev } }; }
  return s;
}
function moveLeft(s: EditorState): EditorState {
  const { row, col } = s.cursor;
  if (col > 0) return { ...s, cursor: { row, col: col - 1 } };
  if (row > 0) return { ...s, cursor: { row: row - 1, col: s.lines[row - 1].length } };
  return s;
}
function moveRight(s: EditorState): EditorState {
  const { row, col } = s.cursor;
  if (col < s.lines[row].length) return { ...s, cursor: { row, col: col + 1 } };
  if (row < s.lines.length - 1) return { ...s, cursor: { row: row + 1, col: 0 } };
  return s;
}
function moveCursorVert(s: EditorState, delta: number): EditorState {
  const row = s.cursor.row + delta;
  if (row < 0 || row >= s.lines.length) return s;
  return { ...s, cursor: { row, col: Math.min(s.cursor.col, s.lines[row].length) } };
}
function continueLine(s: EditorState): EditorState {
  const lines = [...s.lines]; const row = s.cursor.row;
  lines[row] = lines[row].replace(/\\$/, "");              // drop the trailing backslash
  lines.splice(row + 1, 0, "");                            // insert a new empty line after it
  return { ...s, lines, cursor: { row: row + 1, col: 0 } };
}
function submitTurn(s: EditorState): EditorResult {
  if (isBlank(s)) return { state: s };
  const t = bufferText(s);
  const history = s.history.length && s.history[s.history.length - 1] === t ? s.history : [...s.history, t];   // dedup consecutive
  return { state: initialEditorState(history), submit: t };
}

function setBuffer(s: EditorState, t: string): EditorState {
  const lines = splitLines(t); const r = lines.length - 1;
  return { ...s, lines, cursor: { row: r, col: lines[r].length } };
}
function historyPrev(s: EditorState): EditorState {
  if (s.history.length === 0) return s;
  if (s.histIndex === null) { const idx = s.history.length - 1; return setBuffer({ ...s, stash: bufferText(s), histIndex: idx }, s.history[idx]); }
  const idx = Math.max(0, s.histIndex - 1); return setBuffer({ ...s, histIndex: idx }, s.history[idx]);
}
function historyNext(s: EditorState): EditorState {
  if (s.histIndex === null) return s;
  const idx = s.histIndex + 1;
  if (idx >= s.history.length) return setBuffer({ ...s, histIndex: null, stash: null }, s.stash ?? "");
  return setBuffer({ ...s, histIndex: idx }, s.history[idx]);
}
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
const syncMention = (s: EditorState): EditorState => (s.mention ? refreshMention(s) : s);
function afterInsert(next: EditorState, prev: EditorState, t: string): EditorState {
  if (t === "@" && atWordBoundary(next)) return openMention(next);
  return prev.mention ? refreshMention(next) : next;
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
function onUp(s: EditorState): EditorState { if (s.mention) return moveMention(s, -1); if (s.cursor.row === 0) return historyPrev(s); return moveCursorVert(s, -1); }
function onDown(s: EditorState): EditorState { if (s.mention) return moveMention(s, 1); if (s.cursor.row === s.lines.length - 1) return historyNext(s); return moveCursorVert(s, 1); }

export function applyKey(s: EditorState, input: string, key: KeyFlags): EditorResult {
  if (key.return) {
    if (s.lines[s.cursor.row].endsWith("\\")) return { state: continueLine(s) };
    if (s.mention) return { state: acceptMention(s) };
    return submitTurn(s);
  }
  if (key.tab) return { state: s.mention ? acceptMention(s) : s };
  if (key.escape) return { state: s.mention ? { ...s, mention: null } : s };
  if (key.backspace || key.delete) return { state: syncMention(deleteLeft(s)) };
  if (key.leftArrow) return { state: syncMention(moveLeft(s)) };
  if (key.rightArrow) return { state: syncMention(moveRight(s)) };
  if (key.upArrow) return { state: onUp(s) };
  if (key.downArrow) return { state: onDown(s) };
  if (input) { const t = stripPasteMarkers(input); if (!t) return { state: s }; return { state: afterInsert(insertText(s, t), s, t) }; }
  return { state: s };
}
