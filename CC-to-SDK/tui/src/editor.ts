// tui/src/editor.ts — pure multiline-editor reducer for the chat composer. No React/Ink/fs; the @-mention FS
// walk is injected by the component. Probe 17d7116: a multi-line write is ONE useInput call (input = whole
// string, embedded \n/\r, no key.return) → paste = insert-and-split; submit = a lone key.return; `\`+Enter =
// continuation. rankCandidates (pure) is added in the mention pass.
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

// onUp/onDown: cursor movement at the buffer edges (history recall is added in the history pass).
function onUp(s: EditorState): EditorState { return s.cursor.row === 0 ? s : moveCursorVert(s, -1); }
function onDown(s: EditorState): EditorState { return s.cursor.row === s.lines.length - 1 ? s : moveCursorVert(s, 1); }

export function applyKey(s: EditorState, input: string, key: KeyFlags): EditorResult {
  if (key.return) { if (s.lines[s.cursor.row].endsWith("\\")) return { state: continueLine(s) }; return submitTurn(s); }
  if (key.backspace || key.delete) return { state: deleteLeft(s) };
  if (key.leftArrow) return { state: moveLeft(s) };
  if (key.rightArrow) return { state: moveRight(s) };
  if (key.upArrow) return { state: onUp(s) };
  if (key.downArrow) return { state: onDown(s) };
  if (input) { const t = stripPasteMarkers(input); return t ? { state: insertText(s, t) } : { state: s }; }
  return { state: s };
}
