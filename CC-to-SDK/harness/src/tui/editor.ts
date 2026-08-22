// tui/src/editor.ts — pure multiline-editor reducer for the chat composer. No React/Ink/fs; the @-mention FS
// walk is injected by the component. Probe 17d7116: a multi-line write is ONE useInput call (input = whole
// string, embedded \n/\r, no key.return) → paste = insert-and-split; submit = a lone key.return; `\`+Enter =
// continuation. rankCandidates (pure) is added in the mention pass.
import type { CommandEntry } from "./commandComplete.js";
// F5 task 9: the two trigger regexes and the denylist moved out to their own leaf (the plan's second
// pre-allocated split). Same reason promptMode.ts exists — one derivation of "is a popup open here", shared
// by every edit and every motion, in a module with no imports at all.
// F5 task 10: the rest of the autocomplete MODEL followed it into `completions.ts` (the plan's third
// pre-allocated split, taken where both t9 reviews said it would have to be) — the trigger scan, the four
// predicates, popup navigation, all three accepts, plus the new ghost text and argument hint. Same deliberate
// module cycle editorHistory.ts documents: hoisted `function` declarations, nothing called at module-eval
// time. Everything this file used to export from that section is re-exported below, so no caller moved.
import { acceptCommand, acceptGhost, acceptMention, commandActive, completionActive, ghostText, mentionActive, moveCommand, moveMention, syncCompletions } from "./completions.js";
export { commandActive, commandArgumentHint, commandEmptyMessage, completionActive, ghostText, mentionActive, setCommandCatalog, setMentionFiles, suggestPopupShown, syncCompletions } from "./completions.js";
export type { GhostText } from "./completions.js";
import { CHIP_CHARS, chipContaining, chipEndingAt, chipStartingAt, deleteTokenBefore, imageChipLabel, ingestPaste, snapOut, substituteChips, sweepOrphanImages } from "./pasteChips.js";
// F5 task 7: the history WALK moved out to its own module (the plan's pre-allocated split), leaving this file
// the buffer reducer it is. Same deliberate module cycle pasteChips.ts documents — editorHistory imports
// `bufferText`/`setBuffer`/the state types from here and this file imports the walk from there, all hoisted
// `function` declarations with nothing called at module-evaluation time, so the cycle resolves either way.
import { historyNext, historyPrev, pushHistory, type DraftStash, type HistEdit, type HistFilter, type HistNavEntry } from "./editorHistory.js";
// The prefix→mode reading lives in `promptMode.ts` (a zero-import leaf) so the history seed and this reducer
// share ONE derivation; `InputMode` moved with it and is re-exported here, so existing imports are unchanged.
import { composerMode, type InputMode } from "./promptMode.js";
// F9 T-MOUSE Task 4 — click-to-caret's inverse map. `wrapRows` is `wrapItems.ts`'s wrap primitive, "Ink's own
// wrap, verbatim" — the SAME call every other painted-row producer in this tree makes, so reusing it (rather
// than a second `wrapAnsi(text, width, {trim:false, hard:true})` typed out here) is what keeps this file's
// click math from ever diverging from what `ChatComposer` actually paints. `columnToChar`/`HitRow` are T1's
// grapheme-safe column map (`mouse/hitmap.ts`) — the same one the transcript's own click and hover paths use,
// reused here rather than a second CJK/combining-mark walk. Both imports are runtime-safe despite this file's
// own "no React/Ink" header: `wrapItems.ts`'s only VALUE imports are `wrap-ansi`/`string-width` (plain npm
// libs) and `pager.js` (itself a type-only re-export), and `mouse/hitmap.ts`'s are the same two libs plus the
// shared grapheme snapper — neither pulls in React or Ink at runtime, only erased `type` imports do.
import { wrapRows } from "./wrapItems.js";
import { columnToChar, type HitRow } from "./mouse/hitmap.js";
import stringWidth from "string-width";
export { historyEdited, historyLabel, historyPosition, historyView, rebuildChips } from "./editorHistory.js";
export type { DraftStash, HistEdit, HistFilter, HistNavEntry } from "./editorHistory.js";
export type { InputMode } from "./promptMode.js";
export interface Cursor { row: number; col: number }
export interface Candidate { path: string; score: number }
/** The columns a trigger token occupies on `row`: `start` is the `/` or `@` itself, `end` one past the token's
 *  last character — which may sit PAST the caret, because both upstream scanners extend the token forward
 *  (`Pli`'s `a`, `bZe`'s `D9f` tail). Accepting a suggestion replaces exactly this span, which is what lets a
 *  mid-text completion leave the rest of the line alone. */
export interface TokenSpan { row: number; start: number; end: number }
export interface MentionState { span: TokenSpan; query: string; quoted: boolean; files: string[]; items: Candidate[]; index: number }
/** `head` is our retained leading-slash arm (see completionTriggers.ts) as opposed to `Pli`'s mid-text one.
 *  The two accept differently — only the head arm can execute on Enter; see `acceptCommand`. */
export interface CommandState { span: TokenSpan; query: string; head: boolean; items: CommandEntry[]; catalog: CommandEntry[]; index: number }
/** One collapsed paste, rendered in the buffer as a `[Pasted text #id +N lines]` placeholder (F5 task 3 fills
 *  the map). Declared HERE, with the undo entry that carries it, so the undo shape never has to reopen.
 *  `lineCount` is OURS: upstream stores `{ id, type, content }` (bundle L495755) and passes the count to `agr`
 *  as an argument instead. We keep it so a re-render of the label never has to re-walk the content.
 *
 *  F9 T-IMAGE (I2) widens this to a 3-arm union — the composer carrier's whole point. `"image"` carries the
 *  paste-time-ready block (`content` base64, already re-encoded to fit under I1's ladder); `"image-failed"` is what
 *  a ladder-exhausted or unreadable clipboard image mints INSTEAD of nothing, so Ctrl-V still gives the user a
 *  chip to see and delete rather than a silent no-op, and the turn still submits — it degrades to the
 *  `[Image could not be processed: …]` text block at BUILD time (Task 4's builder), never here. Both image
 *  arms render the identical `[Image #N]` label (`imageChipLabel`, pasteChips.ts) — the failure is a property
 *  of the entry, invisible in the chip itself. */
export type PastedEntry =
  | { id: number; type: "text"; content: string; lineCount: number }
  | { id: number; type: "image"; content: string /* base64 */; mediaType: string; dimensions: { width: number; height: number } }
  | { id: number; type: "image-failed"; reason: string };
export type PastedMap = Record<number, PastedEntry>;
/** F9 T-IMAGE (I2) — the structural composer carrier (spec v3.1). Before this task `submitTurn` FLATTENED
 *  every chip (`substituteChips`) into one string before `onSubmit` ever saw it, so an image entry — which
 *  cannot be reconstructed from its label — was unreachable past the editor no matter what the rest of the
 *  chain did. `submitText` is that same flattened string (TEXT chips expanded, exactly as `submit` always
 *  was — an `[Image #N]` label stays literal in it, `substituteChips` only ever touches `type:"text"`);
 *  `display` is the chip-labelled text history persists; `pastedContents` is the LIVE map at submit time, so
 *  an image/image-failed entry rides structurally to whatever reads this object instead of dying with the
 *  flatten. `ChatComposer` → `ChatApp` → `useChat.submit` → `QueueEntry` all carry it by reference; the
 *  string-typed `submit` field stays alongside it (unchanged, byte-identical to before this task) so every
 *  existing plain-string caller/test of `EditorResult.submit` keeps working untouched. */
export interface ComposerSubmission { display: string; submitText: string; pastedContents: PastedMap }
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
  /** Upstream's `Se.current` (parked by `autocomplete:dismiss` at bundle L491063, checked and cleared by the
   *  recompute effect at L490831–36): the buffer text the dismissal was pressed on.
   *  The trigger scan no-ops while the text still equals it, so Escape stays dismissed until the user TYPES
   *  something — which matters here more than upstream, because our scan also runs on cursor motions. */
  completionDismissed: string | null;
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
  /** F9 T-IMAGE (I2) — set ONLY by `submitTurn` (a `/command` accept still reports the bare string on `submit`
   *  alone, exactly as before). ChatComposer prefers this over `submit` when both are present, so an
   *  image/image-failed entry rides to `onSubmit` structurally; every OTHER reader of `EditorResult` — every
   *  existing test that reads `.submit` — is unaffected, because `submit`'s own value never changed. */
  submission?: ComposerSubmission;
}
/** Minimal structural subset of ink's Key the reducer reads (so editor.ts needs no ink import). */
export interface KeyFlags {
  return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean;
  leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; escape?: boolean; tab?: boolean;
  /** NOT ink flags either (Ink throws Home/End away entirely — keys/types.ts §1.1). Wave C t3 added them so
   *  `toKeyFlags` has somewhere to project the two key NAMES our own parser keeps; see the `key.home` arm. */
  home?: boolean; end?: boolean;
  /** NOT an ink flag: the event's PROVENANCE, carried through `toKeyFlags` from the keymap's `TextEvent`. A
   *  bracketed paste (`\x1b[200~ … \x1b[201~`, assembled by KeymapProvider) takes the chip path on this flag
   *  ALONE, at any size. An untagged run takes it only past CHIP_CHARS — upstream's terminal-without-DECSET-2004
   *  fallback; see the `key.paste ||` arm in applyKeyInner (F5 task 3). */
  paste?: boolean;
}

export function initialEditorState(history: HistNavEntry[] = []): EditorState {
  return { lines: [""], cursor: { row: 0, col: 0 }, history: [...history], histIndex: null, stash: null, histEdits: new Map(), histMode: undefined, histRecalled: null, historySeeded: false, stashed: null, undo: [], pastedContents: {}, pasteCounter: 0, hasUsedBackslashReturn: false, mention: null, command: null, completionDismissed: null, killRing: [], killRun: false, yankSite: null };
}
/** The fields that outlive a submit, a clear, or a composer remount: the history list and its seed flag, the
 *  Ctrl-S stash, the kill ring, and the one-way backslash flag. Everything else is buffer state and dies with
 *  the buffer. Named once so the three reset sites cannot drift apart. */
// A hoisted `function`, not a const arrow, because `completions.ts` sits on the other side of a module cycle
// and calls it from `acceptCommand` — see the import banner above.
export function durable(s: EditorState) { return { historySeeded: s.historySeeded, stashed: s.stashed, killRing: s.killRing, hasUsedBackslashReturn: s.hasUsedBackslashReturn }; }
/** CM17, upstream `o9f({ maxBufferSize: 50, debounceMs: 1000 })` (bundle L495478). Upstream debounces pushes on
 *  a real timer; a pure reducer has none, so `applyKey` coalesces on the elapsed `now` instead (see there). */
export const UNDO_CAP = 50;
export const UNDO_COALESCE_MS = 1000;

/** The composer's current input mode, derived purely from the buffer: a leading `!` = bash, everything else
 *  normal (CC's one prefix mode). The `/` and `@` popups own their own state, so they suppress this.
 *
 *  The prefix reading itself is `composerMode` in promptMode.ts, shared with the history seed (t7 review,
 *  M1): before that, this function's three-valued answer went onto a submitted entry while the disk seed
 *  wrote a two-valued one, so the same `#note` prompt carried `"memory"` in-session and `"normal"` after a
 *  restart. Wave C Task 14 removed the memory mode entirely (spec owner-decision), which retires the drift
 *  as well as the shared reading that fixed it — the union this returns is now upstream's own two. */
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
/** F9 T-IMAGE (I2): the Ctrl-V handler's image arm — the one paste path with no "too small to collapse"
 *  threshold. Unlike `ingestPaste`'s text arm, an image is NEVER inserted as literal characters; it always
 *  mints a chip, ready or `image-failed` (the reader/re-encode ladder's own two outcomes, ChatComposer's own
 *  concern — this function only turns whichever one already happened into a buffer entry). `outcome` is
 *  narrowed to exactly those two shapes so a caller cannot accidentally hand this the "text"/"none" results
 *  I1's `readClipboardImage` can also produce — those take the ordinary paste/toast paths instead. */
export function insertImageChip(
  s: EditorState,
  outcome: { kind: "image"; content: string /* base64 */; mediaType: string; dimensions: { width: number; height: number } }
    | { kind: "image-failed"; reason: string },
): EditorState {
  const id = s.pasteCounter + 1;
  const entry: PastedEntry = outcome.kind === "image"
    ? { id, type: "image", content: outcome.content, mediaType: outcome.mediaType, dimensions: outcome.dimensions }
    : { id, type: "image-failed", reason: outcome.reason };
  return insertText({ ...s, pasteCounter: id, pastedContents: { ...s.pastedContents, [id]: entry } }, imageChipLabel(id));
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
// WAVE C t3, annex §C7.6 — the forward boundary MOVED. Upstream's `nextWord` (bundle L394936) walks the word
// runs for the first one whose `start > offset` and returns `snapOutOfPlaceholder(r.start, "end")`: it parks at
// the START of the next word-like run, not at the end of the word it crossed. This port was wordLeft's mirror
// (skip spaces, then skip the word) and stopped one word early — Alt-Right on `one two` from column 0 landed on
// 3 where claude lands on 4. So the two `while`s swap order: cross the current run first, then the gap.
//
// Two divergences from `nextWord` survive the change and are older than it:
//  · `isWordLike`. Upstream's boundary walk classifies runs, so a punctuation run is skipped as a non-word;
//    ours splits on whitespace alone, which is the same approximation `wordLeft` and `killWordBack` make. One
//    inconsistent definition of "word" across the three keys would be worse than one imprecise one.
//  · Upstream walks the whole flat text and falls off the end to `text.length`; ours is per-ROW and falls off
//    to the end of the current row, crossing to the next only from a cursor already at the row's end (the arm
//    above). That is this file's row/col model, not a Wave C choice.
//
// t3 review (Minor-1): a chip is jumped WHOLE, and that takes both chip clauses of `nextWord`, not one.
//  · The early return — `placeholderStartingAt(offset) ?? placeholderContaining(offset)` → `e.end`, before any
//    boundary walk. A caret on or inside a label leaves at the label's end; the walk would otherwise read the
//    spaces in `[Pasted text #1 +3 lines]` as real gaps and, from late inside the label, sail past the chip to
//    the following word.
//  · The landing snap — `snapOutOfPlaceholder(r.start, "end")` — with the SAME `startingAt ?? containing` pair.
//    `chipContaining` alone is strictly inside, so a walk that lands exactly on a chip's "[" (alt+Right from
//    column 0 of `one [Pasted text #1 +3 lines] two`) never snapped and parked on the bracket: a cursor sitting
//    inside a chip's span is precisely the state the placeholder model forbids.
const chipEndAt = (line: string, i: number): number | undefined => (chipStartingAt(line, i) ?? chipContaining(line, i))?.end;
function wordRight(s: EditorState): EditorState {        // Alt/Option-Right, ctrl+Right (and Alt-f): to the next word's START
  const { row, col } = s.cursor;
  const line = s.lines[row];
  if (col >= line.length) { if (row === s.lines.length - 1) return s; return { ...s, cursor: { row: row + 1, col: 0 } }; }
  const onChip = chipEndAt(line, col);
  if (onChip !== undefined) return { ...s, cursor: { row, col: onChip } };
  let i = col; while (i < line.length && !/\s/.test(line[i])) i++; while (i < line.length && /\s/.test(line[i])) i++;
  return { ...s, cursor: { row, col: chipEndAt(line, i) ?? i } };
}
/** Alt-d (CM12, bundle meta map `["d", () => W.deleteWordAfter()]`): delete forward to the next word boundary.
 *  WAVE C t3 blast radius, taken deliberately rather than frozen: this is DEFINED as the range up to
 *  `wordRight`, so moving that boundary to the next word's start means alt+d now takes the separating
 *  whitespace with the word (`one two three` at column 0 → `two three`, was ` two three`).
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
  const submitText = substituteChips(t, s.pastedContents);
  // F9 T-IMAGE (I2): `submission` carries the SAME `submitText` plus the live map, structurally — see
  // `ComposerSubmission`'s own header for why `submit` stays exactly as it was rather than being replaced.
  return {
    state: { ...initialEditorState(history), ...durable(s) },
    submit: submitText,
    submission: { display: t, submitText, pastedContents: s.pastedContents },
    historyAppend: entry,
  };
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

/** WAVE C TASK 4 (EP-C7b), annex §C7.2 — Ctrl-C's FIRST press, which is `V`'s `onFirstPress` and nothing more:
 *  `if (e) t(""), B(0), c?.()` (bundle L395616) — clear the buffer, cursor to 0, reset the history walk. Three
 *  calls, transcribed as three effects and no fourth:
 *   · `t("")` + `B(0)` are `clearInput`'s `lines`/`cursor` (its `pastedContents`/popup wipe rides along, exactly
 *     as it does for ctrl+l — the chips are placeholders in a buffer that just left);
 *   · `c?.()` is the history-nav reset, which `clearInput` alone does NOT do — the five `hist*` fields.
 *  WHAT IT DELIBERATELY KEEPS, against `replaceBufferFromOutside`'s wholesale reset: the UNDO stack, so ctrl+_
 *  brings a Ctrl-C'd draft back. Upstream's Ctrl-C runs no `cgr` (unlike Esc-Esc's `clearToHistory`), so undo is
 *  the only way back and dropping it would make the gesture lossy in a way upstream's is not. `durable`'s four
 *  fields (stash, kill ring, history list, backslash flag) are untouched for the same reason. */
export function clearForInterrupt(s: EditorState): EditorState {
  return { ...clearInput(s), histIndex: null, stash: null, histEdits: new Map(), histMode: undefined, histRecalled: null };
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
  return { ...s, lines, cursor: { row: r, col: lines[r].length }, histIndex: null, stash: null, histEdits: new Map(), histMode: undefined, histRecalled: null, undo: [], pastedContents: {}, mention: null, command: null, completionDismissed: null, killRun: false, yankSite: null };
}
/** Replace the buffer's text wholesale, cursor at the end — the composer's rewind prefill (edit-and-resend). */
export function withBufferText(s: EditorState, t: string): EditorState { return replaceBufferFromOutside(s, t); }
// The walk takes the CURRENT input mode as an argument (see editorHistory.ts): it decides CM55's latch and
// rides along on every parked edit, and `inputMode` is this file's to compute.
// An INACTIVE popup (present in state, nothing in its list) declines these, so ↑/↓ reach the history walk
// exactly as they would with no popup at all — see `commandActive`. Both non-popup paths then rescan: the
// history walk replaced the buffer, and a vertical caret move left any span pointing at the wrong row.
function onUp(s: EditorState): EditorState {
  if (commandActive(s)) return moveCommand(s, -1);
  if (mentionActive(s)) return moveMention(s, -1);
  return syncCompletions(s.cursor.row === 0 ? historyPrev(s, inputMode(s)) : moveCursorVert(s, -1));
}
function onDown(s: EditorState): EditorState {
  if (commandActive(s)) return moveCommand(s, 1);
  if (mentionActive(s)) return moveMention(s, 1);
  return syncCompletions(s.cursor.row === s.lines.length - 1 ? historyNext(s, inputMode(s)) : moveCursorVert(s, 1));
}

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
  // WAVE C t3, annex §C7.5 (bundle L395798): `case "home": if (Pe.ctrl) return; return W.startOfLine()`, and
  // the same shape for `end`. Two things to read off that:
  //  · The ctrl guard is a bare `return` — ctrl+Home/ctrl+End leave the input UNHANDLED so they reach the
  //    Scroll context. Returning `s` by identity is how this reducer says "not mine".
  //  · Only ctrl is guarded, so meta+Home is still a line motion. Hence this arm sits ABOVE the meta branch,
  //    which would otherwise swallow it as an unrecognized combo.
  // DIVERGENCE (constraint 12): upstream's `startOfLine`/`endOfLine` are VISUAL-line motions, wrapped-row
  // aware, and it keeps a separate logical pair (`startOfLogicalLine`/`endOfLogicalLine`, L394908/L394915) for
  // ctrl+a / ctrl+e. This port has ONE pair — `lineStart`/`lineEnd` over a buffer of unwrapped logical lines —
  // so Home and ctrl+a are the same motion here, and on a wrapped row Home goes to the logical start where
  // claude stops at the visual one. The same note CM14 already carries for ctrl+a/ctrl+e, seen from this side;
  // a real visual-line model would have to arrive for both pairs at once.
  if (key.home || key.end) {
    if (key.ctrl) return { state: s };
    return { state: syncCompletions(key.home ? lineStart(s) : lineEnd(s)) };
  }
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
  // Live-feedback fix (2026-08-06), bundle L395786-395796: `backspace` with meta OR ctrl is `se()` —
  // deleteWordBefore AS A KILL (ring, prepend), the same op ctrl+w runs. Option+backspace over ssh arrives
  // as ESC 0x7f → `{name:"backspace", alt:true}` (parse.ts) and used to fall through to the single-char
  // arm below — word delete read as "does not work" in live use. `delete` with meta is upstream's `oe()`
  // = deleteToLineEnd (ring, append). Both sit ABOVE the ctrl switch — a ctrl+backspace entering that
  // switch dies in its default arm before any backspace handling. The superKey arms beside them upstream
  // (cmd+backspace = kill to line start, cmd+delete = kill to line end) are unported for the same reason
  // cmd+arrow is — see the §C7.6 note below: the modifier does reach us, the projection for it does not.
  if (key.backspace && (key.meta || key.ctrl)) { const r = killWordBack(s); return { state: syncCompletions(r.state), killed: { text: r.text, dir: "prepend" as const } }; }
  if (key.delete && key.meta) { const r = killToEnd(s); return { state: syncCompletions(r.state), killed: { text: r.text, dir: "append" as const } }; }
  // WAVE C t3, annex §C7.6 (bundle L395760/L395775): `case "left": … if (Pe.ctrl || Pe.meta || Pe.fn) return
  // W.prevWord()` — ctrl, alt/meta AND fn on an arrow are all the same word motion. The meta third is the arm
  // above; this is the ctrl third, and it has to sit ABOVE the ctrl switch because that switch dispatches on
  // `input`, which a ctrl+arrow leaves empty: every ctrl+←/→ died in its `default` arm. `fn` is unportable —
  // no terminal wire delivers it and `KeyFlags` has no such flag.
  //
  // The `superKey` arm upstream pairs with these (`if (Pe.superKey) return W.startOfLine()/endOfLine()`) is a
  // different case, and the t3 review corrected an earlier claim here that it was unportable: cmd/super DOES
  // arrive — parse.ts decodes xterm's modifier bit 8 into `KeyEvent.super` (keys/types.ts). What is missing is
  // only the last hop: `KeyFlags` has no `super`, so `toKeyFlags` has nowhere to put it. Wiring it is the same
  // one-flag-plus-one-arm move `home`/`end` just got, and it leaves cmd+←/→ a genuine §C7.6 REMAINDER — the
  // companion to the §C7.5 one (pageup/pagedown as line motions; see editorAdapter.ts).
  //
  // ctrl+↑/↓ deliberately fall past this into that same default: they are
  // Global's `app:diffFileListUp/Down`, not editor keys (§C7.9).
  if (key.ctrl && (key.leftArrow || key.rightArrow)) return { state: syncCompletions(key.leftArrow ? wordLeft(s) : wordRight(s)) };
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
    // An INACTIVE command popup falls through to `submitTurn`, which sends the buffer — which is how an
    // unknown `/name` reaches the dispatcher and gets its error. Ghost text falls through here too, and
    // upstream agrees: its Enter arm sits behind `if (c.length === 0) return` (bundle L491101), so a visible
    // ghost never intercepts Return. Only Tab accepts a ghost.
    if (commandActive(s)) return acceptCommand(s, true);
    if (mentionActive(s)) return { state: acceptMention(s) };
    return submitTurn(s);
  }
  // Upstream's Tab (bundle L491087–L491090) does the interesting thing by NOT acting: `if (c.length > 0 || Y)
  // return` leaves the key undefaulted, so it propagates to the `Autocomplete` context's `tab:
  // autocomplete:accept` binding and lands in `Pe` — which checks the ghost first and the list second. Our
  // keymap routes the same binding back into this reducer, so the two arms are here, in `Pe`'s order.
  if (key.tab) {
    const g = ghostText(s);
    if (g) return { state: acceptGhost(s, g) };
    if (commandActive(s)) return acceptCommand(s, false);
    return { state: mentionActive(s) ? acceptMention(s) : s };
  }
  // `autocomplete:dismiss` (`at`, bundle L491062): close, and PARK the text it was closed on — see
  // `completionDismissed`. Without the park the very next arrow key would re-open what Escape just dismissed.
  // An inactive popup declines, so the Escape falls through to the composer's cancel.
  // Nulling `command` also kills the GHOST, which derives from it. Upstream's `at` cannot — its `Y` is a memo
  // over (text, caret), so Escape leaves the ghost drawn and the Autocomplete scope active, and the next
  // Escape is swallowed too. Our latch makes one Escape mean one dismissal for every surface alike.
  if (key.escape) { if (completionActive(s)) return { state: { ...s, command: null, mention: null, completionDismissed: bufferText(s) } }; return { state: s }; }
  // CM12, bundle L395791: `backspace` is `deleteTokenBefore() ?? backspace()` — a chip goes in one keystroke.
  // `delete` is upstream's forward `del()`; this port has always aliased it to backspace, so it shares the arm.
  if (key.backspace || key.delete) return { state: syncCompletions(deleteTokenBefore(s) ?? deleteLeft(s)) };
  if (key.leftArrow) return { state: syncCompletions(moveLeft(s)) };
  if (key.rightArrow) return { state: syncCompletions(moveRight(s)) };
  if (key.upArrow) return { state: onUp(s) };
  if (key.downArrow) return { state: onDown(s) };
  // A BRACKETED paste (the keymap tagged it; see KeyFlags.paste): normalise it, then chip it or insert it —
  // `ingestPaste` owns that decision because it also owns the id counter and the map, and returns `s` unchanged
  // when the payload normalises to nothing. The result still goes through the SAME `syncCompletions` an
  // ordinary insertion runs, so the trigger scan sees the post-paste text (F5 task 9 made that a re-scan of the
  // caret's row rather than a refresh of an already-open popup, so a pasted `/name` opens the popup the same
  // way a typed one does). `input` is handed to `ingestPaste` RAW — a megabyte paste is not walked twice.
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
    // `ingestPaste` (pasteChips.ts) mints TEXT chips only — an image chip is `insertImageChip`'s own path,
    // which never runs through this arm — so `minted.type === "text"` is a type narrowing, not a new
    // runtime branch; it is always true whenever `minted` itself is defined here.
    const paste: PasteSignal | undefined = minted && minted.type === "text" ? { kind: "chip", content: minted.content }
      : s.pastedContents[s.pasteCounter] !== undefined && next.pastedContents[s.pasteCounter] === undefined ? { kind: "expand" }
      : undefined;
    return { state: syncCompletions(next), paste };
  }
  if (input) { const t = stripPasteMarkers(input); if (!t) return { state: s }; return { state: syncCompletions(insertText(s, t)) }; }
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
  // F9 T-IMAGE (I2): drop an image/image-failed entry whose label no longer appears anywhere in the buffer —
  // see pasteChips.ts's `sweepOrphanImages` for why TEXT stays exempt and this species does not.
  state = sweepOrphanImages(state);
  if (r.submit !== undefined) return { ...r, state, killed };
  if (state === s) return { ...r, killed };
  if (sameText(state.lines, s.lines) || state.undo !== s.undo) return { ...r, state, killed };
  const head = s.undo[s.undo.length - 1];
  if (head && now - head.at < UNDO_COALESCE_MS) return { ...r, state, killed };            // inside the window: fold in
  const entry = { lines: s.lines, cursor: s.cursor, pastedContents: s.pastedContents, at: now };
  return { ...r, state: { ...state, undo: [...s.undo.slice(-(UNDO_CAP - 1)), entry] }, killed };
}

// ── F9 T-MOUSE TASK 4 — CLICK-TO-CARET, THE INVERSE MAP ──────────────────────────────────────────────────
//
// Spec M4 / research R1 §2.6: canon's search input (bundle L539383-539394) wraps a PREFIXED string — the
// label plus the query, one blob — with the SAME wrapper it paints with, looks the click's `(line, column)`
// up in the wrapped result, and subtracts the prefix's width back off at the end, clamped to the raw text's
// own length. That "wrap the whole thing, subtract after" shape is the general contract below; canon's OTHER
// click site — the composer proper (L607573-578) — has no textual prefix at all (its own `getOffsetFromPosition`
// is a plain wrap-and-look-up), which is exactly ccx's own shape: `PromptGlyph` is a separate Ink flex column,
// never text concatenated onto a buffer line, so `ChatComposer`'s real call passes `prefixWidth: 0` and this
// degrades to that simpler case. The parameter still exists — and is still exercised at a non-zero value by
// this file's own tests — because the contract is the reusable primitive, not a composer-only shortcut.

/** One buffer LINE's inverse map: wrap `" ".repeat(prefixWidth) + text` at `innerWidth` — `wrapRows`, the
 *  exact primitive `ChatComposer` relies on Ink to run per line (see the import banner above) — find the
 *  painted row `line` lands on (clamped into range: a `line` past the last wrapped row reads as the last one,
 *  matching `columnToChar`'s own "click past the end is a click on the row's own end" rule), resolve `column`
 *  (1-based, this codebase's mouse convention throughout) to a grapheme offset in THAT row via T1's
 *  `columnToChar`, then walk back to an offset in the ORIGINAL (unprefixed) text.
 *
 *  `columnToChar` returns `undefined` for a column past the row's painted width (too far right) OR at/before
 *  its `gutterWidth` (too far left) — built here with `gutterWidth: 0` because the prefix is baked directly
 *  into the wrapped ROW TEXT rather than reserved as a separate margin (canon's own prefix is concatenated
 *  text too, never a persistent per-row indent the way a transcript gutter is), so a column landing ON the
 *  padding resolves to a REAL grapheme offset inside `[0, prefixWidth)` rather than to `undefined` — and it is
 *  the FINAL clamp below, not this lookup, that turns that into "clamps to 0" (subtracting `prefixWidth` from
 *  an offset smaller than it goes negative, and `Math.max(0, …)` is the one line doing the clamping the spec
 *  names). A genuinely out-of-bounds column (before the row starts, or past its last cell) clamps to that
 *  row's own edge — `0` or `row.length` — which is `columnToChar`'s "too far left" case, and this function's own
 *  "too far right" fallback, respectively.
 *
 *  `text.length` is JS string length (UTF-16 code units), the SAME unit every cursor `col` in `EditorState`
 *  already uses (`lineEnd`, `moveRight`, …) — not `stringWidth` — so the offset this returns drops straight
 *  into a `Cursor` with no further conversion. */
export function offsetFromPosition(text: string, prefixWidth: number, innerWidth: number, line: number, column: number): number {
  const width = Math.max(1, Math.floor(innerWidth));
  const pad = " ".repeat(Math.max(0, prefixWidth));
  const rows = wrapRows(pad + text, width);
  const rowIndex = Math.max(0, Math.min(Math.floor(line), rows.length - 1));
  const row = rows[rowIndex] ?? "";
  const before = rows.slice(0, rowIndex).reduce((sum, r) => sum + r.length, 0);
  const hit: HitRow = { itemKey: "", anchor: undefined, width: stringWidth(row), text: row, gutterWidth: 0, softWrap: "hard", kind: "line" };
  const cell = columnToChar(hit, column);
  const charStart = cell ? cell.charStart : (column <= hit.gutterWidth ? 0 : row.length);
  return Math.max(0, Math.min(text.length, before + charStart - Math.max(0, prefixWidth)));
}

/** The composer's OWN inverse map: `lines` paints as one wrapped block PER LOGICAL LINE (`ChatComposer`'s
 *  `renderBuffer` — one `<Text>` per `lines[r]`, no whole-buffer join), so a click's row has to be resolved to
 *  a (logical line, wrapped row WITHIN that line) pair before `offsetFromPosition` can answer it — walking
 *  each line's own painted height in order is the direct transcription of that paint order, and it is the
 *  reason this lives beside `offsetFromPosition` rather than being folded into it: the composer's buffer is a
 *  LIST of independently-wrapped lines, not one prefixed blob.
 *
 *  `localRow`/`localCol` arrive already stripped of the composer's screen origin and left inset by the caller
 *  (`ChatComposer`'s `caretAt`, mirroring canon's own `localRow`/`localCol` — R1 §2.6, L607573-578 — being
 *  RECOMPUTED per handler rather than carried as absolute terminal coordinates). `undefined` — not addressable
 *  — for a row above the first line or at/past the buffer's last painted row: the placeholder, the ghost's
 *  dimmed tail and the inline argument hint are cosmetic paint with nothing here to place a caret in. */
export function caretFromLocalPosition(lines: readonly string[], innerWidth: number, localRow: number, localCol: number): Cursor | undefined {
  const width = Math.max(1, Math.floor(innerWidth));
  if (localRow < 0) return undefined;
  let painted = 0;
  for (let line = 0; line < lines.length; line++) {
    const rowCount = wrapRows(lines[line]!, width).length;
    if (localRow < painted + rowCount) return { row: line, col: offsetFromPosition(lines[line]!, 0, width, localRow - painted, localCol) };
    painted += rowCount;
  }
  return undefined;
}
