// tui/src/completions.ts — the composer's autocomplete MODEL: when a popup is open, what it lists, what the
// inline ghost text says, what the argument hint says, and what accepting any of the three does to the buffer.
//
// The F5 plan's third pre-allocated editor.ts split, taken in Task 10 exactly where the two Task-9 reviews said
// it would have to be taken: editor.ts had reached 662 lines and the whole `autocomplete:` section was already
// banner-delimited. Nothing here changed shape in the move except where a bundle line said it had to (see the
// ghost/argument-hint sections at the bottom, which are new).
//
// `completionTriggers.ts` (a zero-import leaf) answers "is the caret in a `/command` or an `@mention`, and over
// what span". THIS file answers everything after that.
//
// The deliberate module cycle with editor.ts is the same one `editorHistory.ts` and `pasteChips.ts` already
// document, and the property that makes it safe is precisely this: **nothing on either side is invoked at
// module-evaluation time.** Both bodies only define things, so by the time any of these functions actually
// runs, both modules have finished evaluating and every binding is initialized whichever order the loader
// picked. Hoisting is a nice-to-have on top of that, not the guarantee — `bufferText` is a `const` arrow this
// file imports and calls, so it is in its TDZ while editor.ts is still evaluating. Calling it *then* would
// throw; nothing does. (`durable` was made a hoisted `function` anyway, belt and braces, since it is the one
// import here that editor.ts declares below its own use site.)
import { bufferText, durable, initialEditorState, type EditorResult, type EditorState, type TokenSpan } from "./editor.js";
import { rankCandidates } from "./fileComplete.js";
import { executesOnEnter, rankCommands, type CommandEntry } from "./commandComplete.js";
import { isCommandToken, mentionInsertion, scanCommand, scanMention, type CommandTrigger, type MentionTrigger } from "./completionTriggers.js";
import { pushHistory, type HistNavEntry } from "./editorHistory.js";
import { composerMode } from "./promptMode.js";

// ─── trigger scan ────────────────────────────────────────────────────────────────────────────────────────
// F5 task 9. Before this, a popup OPENED on one keystroke (`/` into an empty buffer, `@` at a word boundary)
// and then survived on a refresh that only ever narrowed. Upstream has no open/refresh pair at all: it
// re-derives both popups from (text, caret) on every change (`Be`, bundle L490611) and the popup is simply
// whatever that scan currently says. This is that — one scan, with no state of its own beyond the
// catalog/file lists the composer feeds in.
//
// WHERE it runs, precisely (t9 review, M5): every text edit, and every HORIZONTAL caret motion — the
// arrow/word/line-end/kill/delete arms all route through `syncCompletions`, which is what lets a Ctrl-A out
// of a token close the popup and a Ctrl-E back in reopen it. The VERTICAL arms do not rescan: `onUp`/`onDown`
// are consumed by an active popup (they move its selection) and otherwise walk history or move the caret to
// another row, and every one of those paths either replaces the buffer or leaves the popup where the last
// horizontal scan put it. Escape additionally PARKS the text it dismissed (`completionDismissed`), so a
// motion after a dismissal cannot rescan the popup back into existence.

/** Upstream scans (whole input, flat caret); our buffer is rows. Both trigger regexes exclude `\n` from their
 *  token classes and both count it as the whitespace that OPENS a trigger, so scanning the caret's row behind
 *  a `\n` sentinel (on rows > 0) is exactly the whole-text scan restricted to that row — and every column the
 *  scanners hand back is usable once the sentinel is subtracted. */
function rowScan(s: EditorState): { text: string; cursor: number; pad: number } {
  const pad = s.cursor.row > 0 ? 1 : 0;
  return { text: (pad ? "\n" : "") + s.lines[s.cursor.row], cursor: pad + s.cursor.col, pad };
}
function sameSpan(a: TokenSpan, b: TokenSpan): boolean { return a.row === b.row && a.start === b.start && a.end === b.end; }
function closeCompletions(s: EditorState): EditorState { return s.command || s.mention ? { ...s, command: null, mention: null } : s; }

function withCommand(s: EditorState, t: CommandTrigger, pad: number): EditorState {
  const span: TokenSpan = { row: s.cursor.row, start: t.start - pad, end: t.end - pad };
  const prev = s.command;
  // Unchanged token → keep the popup EXACTLY as it is, arrow selection and all. A caret motion inside the
  // token is upstream's no-op (its scan is keyed on the text), and re-ranking here would silently reset the
  // highlight the user just moved.
  if (prev && prev.query === t.query && prev.head === t.head && sameSpan(prev.span, span)) return s.mention ? { ...s, mention: null } : s;
  const catalog = prev?.catalog ?? [];
  return { ...s, mention: null, command: { span, query: t.query, head: t.head, items: rankCommands(catalog, t.query), catalog, index: 0 } };
}
function withMention(s: EditorState, t: MentionTrigger, pad: number): EditorState {
  const span: TokenSpan = { row: s.cursor.row, start: t.start - pad, end: t.end - pad };
  const prev = s.mention;
  if (prev && prev.query === t.query && prev.quoted === t.quoted && sameSpan(prev.span, span)) return s.command ? { ...s, command: null } : s;
  const files = prev?.files ?? [];
  return { ...s, command: null, mention: { span, query: t.query, quoted: t.quoted, files, items: rankCandidates(files, t.query), index: 0 } };
}
/** The one place either popup opens, closes, or re-ranks. Command first: the two triggers are mutually
 *  exclusive in practice (both anchor at the caret, and `/` needs a whitespace in front of it where the
 *  mention class would have to swallow one), so the order only decides a tie that cannot occur. */
export function syncCompletions(s: EditorState): EditorState {
  const buffer = bufferText(s);
  if (s.completionDismissed !== null) {
    if (s.completionDismissed === buffer) return closeCompletions(s);
    s = { ...s, completionDismissed: null };                    // upstream's `Se.current = null` (L490836)
  }
  const { text, cursor, pad } = rowScan(s);
  // Both of upstream's command arms are gated on `s === "prompt"` (bundle L490617 and L490747) — the mid-text
  // one especially, or `!ls /tmp` would fling the command catalog open over a bash line. That is the WHOLE
  // gate now: Wave C Task 14 removed ccx's `#` mode, so `#note the /plan` DOES open the catalog, exactly as
  // it does upstream. The `@` scan is deliberately NOT gated: upstream runs it in bash mode too (`oQa` has a
  // `mode === "bash"` arm that inserts the bare path), and ours has always been mode-blind.
  const cmd = composerMode(s.lines[0] ?? "") === "normal" ? scanCommand(text, cursor, buffer) : null;
  if (cmd) return withCommand(s, cmd, pad);
  const men = scanMention(text, cursor);
  if (men) return withMention(s, men, pad);
  return closeCompletions(s);
}

// ─── what is showing: the four predicates ────────────────────────────────────────────────────────────────
/** Is there a POPUP LIST to move around in and accept from? Two things are folded in here.
 *
 *  (1) `items.length > 0`, from t9 review I2: ours used to ask whether the popup state existed at all, so a
 *  `@zz` that matched no file — invisible, since nothing is drawn for an empty list — still swallowed Up,
 *  Down, Tab and Escape.
 *
 *  (2) `head`, new in t10: the mid-text `/` arm draws GHOST TEXT upstream, never a popup. `Be`'s very first
 *  branch (bundle L490617–L490625) runs `Pli` and, when `zJa` finds a completion, sets `suggestions: []` and
 *  RETURNS — and the leading-slash list is reached through a different branch entirely (`YRr(mt) && kt > 0`,
 *  L490747) that a mid-text buffer can never satisfy. So a non-head command trigger has no list at all; what
 *  it has is `ghostText`, and Tab reaches that through its own arm. */
export function commandActive(s: EditorState): boolean { return !!s.command?.head && s.command.items.length > 0; }
export function mentionActive(s: EditorState): boolean { return (s.mention?.items.length ?? 0) > 0; }
/** CM38 (bundle L490779), and its three upstream guards: a partial name exists (`mt.length > 1`), that name is
 *  a plain command token (`KJa`), and — the one t10 adds — the message is written INSIDE the `YRr(mt) && kt > 0`
 *  head branch, so a mid-text `/zz` never produces it. Lives here rather than in the component because it is
 *  also half of `completionActive`: the message being on screen is a fact about the MODEL, and the renderer and
 *  the key router have to read it from the same place or they disagree about what is showing. */
export function commandEmptyMessage(s: EditorState): string | null {
  const c = s.command;
  if (!c || !c.head || c.items.length > 0 || !c.query || !isCommandToken(c.query)) return null;
  return `No commands match "/${c.query}"`;
}
/** Is the SUGGESTION POPUP on screen? — i.e. does `ChatComposer` mount a `SuggestPopup` that draws anything.
 *  The three terms are the three ways `suggestProps` produces a non-empty region (a matching command list, a
 *  matching `@`-mention list, or CM38's "no commands match" message), and there is no fourth: the popup is
 *  BLANK-PADDED to `popupHeight(rows)` whenever it draws at all, so this boolean plus the terminal's row count
 *  is the region's entire geometry.
 *
 *  It lives here, beside the two predicates the key router already reads, because the live window's render cap
 *  has to subtract those rows (`ChatApp`'s `windowItems` memo) and a SECOND derivation of "is it showing?"
 *  would be a defect waiting for its first disagreement — the popup is half the terminal, so a cap that
 *  believed it was absent while it was drawn puts the frame over Ink's tall-frame cliff and reprints the whole
 *  session into scrollback (FSW task 4 §5 measured 139 copies over six `/status` submissions). */
export function suggestPopupShown(s: EditorState): boolean {
  return commandActive(s) || mentionActive(s) || commandEmptyMessage(s) !== null;
}
/** What the `Autocomplete` SCOPE and the Escape arm key off: anything the composer actually DRAWS below or
 *  after the input. Upstream's own predicate is `Lt = c.length > 0 || !!Y` (bundle L491072) — the suggestion
 *  list OR the inline ghost text — gating `hf("autocomplete", Lt)`, `cut("Autocomplete", Lt)` and the binding
 *  set on the same line (`co(gt, { context: "Autocomplete", isActive: Lt && !At })`, L491073).
 *
 *  Both of upstream's terms are here; the third is a DELIBERATE WIDENING (t9 re-review, traced): upstream's
 *  `Lt` is FALSE while CM38's empty message shows, so its Escape falls through to cancel with the message
 *  still on screen. **And the ghost term cannot rescue it, for a structural reason worth keeping written
 *  down:** the empty message is written only inside the head branch (`YRr(mt) && kt > 0`, L490747), while the
 *  ghost exists only for `head: false` — `Pli`'s whitespace-before-slash can never match a leading slash. The
 *  two are mutually exclusive by construction, so there is no input for which `Lt`'s `!!Y` is true while the
 *  message is on screen. Ours dismisses what the user can see first; one extra Escape before cancel arms, on
 *  purpose. Getting this wrong in either direction is a live bug: too narrow and Escape cannot dismiss
 *  something the user is looking at, too wide and an invisible popup eats the cancel. */
export function completionActive(s: EditorState): boolean {
  return suggestPopupShown(s) || ghostText(s) !== null;
}

// ─── navigation ──────────────────────────────────────────────────────────────────────────────────────────
/** CM29, bundle L491065/L491067: `selectedSuggestion <= 0 ? c.length - 1 : …- 1` and
 *  `>= c.length - 1 ? 0 : …+ 1` — both popups wrap in both directions. Ours clamped, so the last entry of a
 *  105-command catalog was five presses from the first the long way and unreachable the short way. */
function moveSuggestion(index: number, delta: number, length: number): number {
  return (index + delta + length) % length;
}
export function moveMention(s: EditorState, delta: number): EditorState {
  const m = s.mention!;
  return { ...s, mention: { ...m, index: moveSuggestion(m.index, delta, m.items.length) } };
}
export function moveCommand(s: EditorState, delta: number): EditorState {
  const c = s.command!;
  return { ...s, command: { ...c, index: moveSuggestion(c.index, delta, c.items.length) } };
}

// ─── the lists the composer feeds in ─────────────────────────────────────────────────────────────────────
export function setMentionFiles(s: EditorState, files: string[]): EditorState {
  if (!s.mention) return s;
  return { ...s, mention: { ...s.mention, files, items: rankCandidates(files, s.mention.query), index: 0 } };
}
export function setCommandCatalog(s: EditorState, catalog: CommandEntry[]): EditorState {
  if (!s.command) return s;
  return { ...s, command: { ...s.command, catalog, items: rankCommands(catalog, s.command.query), index: 0 } };
}

// ─── acceptance ──────────────────────────────────────────────────────────────────────────────────────────
/** All three accepts replace the trigger's SPAN and leave everything around it alone. That is upstream's shape
 *  at two of the three sites verbatim (`oQa`'s insertion and `Pe`'s ghost splice, which reads
 *  `gr + "/" + fullCommand + " " + lr` at L490847); the third, `XJa`, replaces the whole input, which for the
 *  head arm IS the span, the token being the whole line. */
function spliceSpan(s: EditorState, span: TokenSpan, repl: string): { lines: string[]; cursor: { row: number; col: number } } {
  const line = s.lines[span.row]; const lines = [...s.lines];
  lines[span.row] = line.slice(0, span.start) + repl + line.slice(span.end);
  return { lines, cursor: { row: span.row, col: span.start + repl.length } };
}
/** The `H === "file"` accept (bundle L491017–L491027). Note what is NOT in that branch: `onSubmit`. Accepting
 *  a file mention inserts and stops, on Tab and on Enter alike — the only accept arm that never executes.
 *
 *  CM40, F5 t11: a DIRECTORY accepts differently — it descends. Upstream's directory arm is `Pe`'s
 *  L490887–L490893:
 *
 *      let Tr = bZe(o, i, !0) ?? bZe(o, i, !1);
 *      if (Tr) { let _r = …metadata.type === "directory", Wr = O9f(o, kt.id, Tr.startPos, Tr.token.length, _r);
 *                t(Wr.newInput), n(Wr.cursorPos);
 *                if (_r) l(…), Be(Wr.newInput, Wr.cursorPos);      // RE-SUGGEST: reopen one level deeper
 *                else he(); }                                      // a file just closes
 *
 *  and `Be` is upstream's whole (text, caret) recompute — the thing `syncCompletions` is this port's version
 *  of. So the descent is literally "splice, then re-run the trigger scan", which is what the two arms below
 *  are. What MAKES it work is the missing trailing space: `O9f` gives a directory `@dir/` and nothing else, so
 *  the `@` trigger is still live over the new text and the scan re-opens the mention with `dir/` as its query.
 *
 *  Enter and Tab both land here, so both descend and neither submits — `applyKeyInner`'s Return arm checks
 *  `mentionActive` before `submitTurn`. Upstream's Enter site (`ze`, L491052–L491057) omits the `Be` call and
 *  falls through to `he()`, but its text-change effect (L490831) re-runs `Be` on the new buffer regardless, so
 *  upstream's two keys converge on the same descent by a longer road.
 *
 *  `mention` is deliberately NOT nulled before the rescan: `withMention` carries `prev.files` forward, so the
 *  parent level's list stays on screen, re-ranked against the deeper query, until the composer's re-rooted
 *  walk lands. Upstream has the same property for the same reason — `Be` schedules the new search and returns,
 *  and `Re` only replaces `suggestions` once it resolves.
 *
 *  ONE CONSEQUENCE OF CARRYING IT UNFILTERED (t11 review, M2), transcribed rather than fixed. The parent list
 *  still contains the directory just accepted, and re-ranked against the deeper query `src/` that entry is an
 *  exact match and therefore ranks FIRST — so a second Tab pressed inside the debounce window re-accepts
 *  `src/` and splices the identical text: one dead keystroke, at most ~50 ms wide. It self-heals the moment
 *  the re-rooted walk lands, because a walk rooted at `src/` emits only what is BELOW it and never `src/`
 *  itself. Filtering the accepted path out of the carried list would close the window, and is deliberately not
 *  done: upstream carries its own suggestion list across `Be` untouched and has the same window, and a list
 *  that silently disagrees with the walk that produced it is the more expensive kind of wrong. Pinned in
 *  test/tui/file-complete-async.test.tsx ("the double-Tab window is a no-op and self-heals"). */
export function acceptMention(s: EditorState): EditorState {
  const m = s.mention!;                                          // only reached via `mentionActive`, so non-empty
  const chosen = m.items[Math.min(m.index, m.items.length - 1)];
  const isDir = chosen.path.endsWith("/");                       // the walk's invariant (fileComplete.ts `Entry`)
  const { lines, cursor } = spliceSpan(s, m.span, mentionInsertion(chosen.path, m.quoted, !isDir));
  const next = { ...s, lines, cursor };
  return isDir ? syncCompletions(next) : { ...next, mention: null };
}
/** CM28. `execute` is upstream's `shouldExecute`: the Tab site passes `!1` (L490855) and the Enter site passes
 *  `mt === void 0` — true for a real Return (L490989). What `execute` buys is decided by `executesOnEnter`
 *  (see commandComplete.ts). This is `XJa`, the HEAD arm's accept and the only one of upstream's three that can
 *  run a command; `commandActive` is head-gated, so nothing else reaches it. */
export function acceptCommand(s: EditorState, execute: boolean): EditorResult {
  const c = s.command!;                                          // only reached via `commandActive`, so non-empty
  const chosen = c.items[Math.min(c.index, c.items.length - 1)];
  const { lines, cursor } = spliceSpan(s, c.span, "/" + chosen.name + " ");
  const next: EditorState = { ...s, lines, cursor, command: null };
  if (!execute || !executesOnEnter(chosen)) return { state: next };
  // Upstream submits `l` — `/name ` WITH the trailing space it just inserted. Ours drops it: our dispatcher
  // keys on the exact text and every other submit site in editor.ts sends `/name`.
  const t = "/" + chosen.name;
  const entry: HistNavEntry = { display: t, mode: composerMode(t) };
  return { state: { ...initialEditorState(pushHistory(s.history, entry)), ...durable(s) }, submit: t, historyAppend: entry };
}

// ─── CM36: inline ghost text (the mid-text `/` surface) ──────────────────────────────────────────────────
/** Upstream's `inlineGhostText` — `Y` at bundle L490556, fed by the `V` memo at L490535–L490545:
 *
 *      V = useMemo(() => { if (s !== "prompt" || m) return;
 *                          let mt = Pli(o, i); if (!mt) return;
 *                          let gr = zJa(mt.partialCommand, e); if (!gr) return;
 *                          return { text: gr.suffix, fullCommand: gr.fullCommand,
 *                                   insertPosition: mt.startPos + 1 + mt.partialCommand.length } }, …)
 *
 *  `Pli` is exactly the mid-text trigger `completionTriggers.ts` transcribes, so `CommandState` with
 *  `head: false` IS this memo's input — which is why the mid-text arm still builds a `CommandState` even
 *  though it draws no popup: that state is where the ranked catalog lives.
 *
 *  `zJa` (L489949) ranks with `YJa` and then returns the FIRST ranked entry whose name (or `userFacingName`,
 *  which we do not carry) case-insensitively STARTS WITH the query, plus the characters it would add. A
 *  prefix match, not the top fuzzy hit: `rankCommands` can rank `/review` first for the query `vew`, and there
 *  is no ghost for `vew` because nothing starts with it. When SEVERAL entries are prefixes the shortest wins,
 *  because that is the order the ranker hands them over in — ours by `a.path.length - b.path.length`
 *  (fileComplete.ts), upstream by `if (L && x && w !== k) return w - k` over the same prefix lengths
 *  (L490060). So `mod` ghosts to `/mode`, not `/model`, on both sides.
 *
 *  `visible` is upstream's RENDER gate, which sits somewhere else entirely: `Oe = k && L && k.insertPosition
 *  === M` (L395860) plus `_ === f.length - 1 && this.isAtEnd()` inside the renderer (L394780). So upstream
 *  draws the ghost only with the caret at the end of the whole buffer, but `Lt` and `Pe` read the UNGATED
 *  memo — Tab still completes `see /mod| end` where nothing is drawn. Both facts are kept, as one object with
 *  two readers, rather than as two derivations that could drift: `acceptGhost`/`completionActive` take the
 *  whole thing, ChatComposer's `renderBuffer` takes it only when `visible`. */
export interface GhostText { span: TokenSpan; suffix: string; fullCommand: string; visible: boolean }
export function ghostText(s: EditorState): GhostText | null {
  const c = s.command;
  if (!c || c.head || !c.query) return null;
  const last = s.lines.length - 1;
  // `insertPosition === M` is `span.end === cursor.col` by construction; `isAtEnd()` is the rest.
  const visible = s.cursor.row === last && s.cursor.col === s.lines[last].length && c.span.end === s.cursor.col;
  const q = c.query.toLowerCase();
  for (const e of c.items) {
    if (!e.name.toLowerCase().startsWith(q)) continue;
    const suffix = e.name.slice(c.query.length);
    if (suffix) return { span: c.span, suffix, fullCommand: e.name, visible };
  }
  return null;
}
/** `Pe`'s ghost arm (`Pe` at bundle L490839, `if (Y)` at L490840, the splice at L490847):
 *  `gr + "/" + fullCommand + " " + lr` spliced over `Pli`'s span
 *  with the caret at `startPos + 1 + fullCommand.length + 1`. There is no `onSubmit` anywhere in the arm — a
 *  ghost accept inserts and stops, on Tab as on anything else. `Pe` checks the ghost BEFORE the suggestion
 *  list (`if (Y) {…}` at L490840, `if (c.length > 0)` at L490852); the two are mutually exclusive here
 *  (`head` decides which one exists) but the order is transcribed anyway. */
export function acceptGhost(s: EditorState, g: GhostText): EditorState {
  const { lines, cursor } = spliceSpan(s, g.span, "/" + g.fullCommand + " ");
  return { ...s, lines, cursor, command: null };
}

// ─── CM37: the inline argument hint ──────────────────────────────────────────────────────────────────────
/** Upstream's `commandArgumentHint`, computed at bundle L490749–L490762 inside the head branch (L490747):
 *
 *      let Nn = mt.indexOf(" "), Fn = Nn === -1 ? mt.slice(1) : mt.slice(1, Nn),
 *          ve = Nn !== -1 && mt.slice(Nn + 1).trim().length > 0,       // has non-blank arguments
 *          De = Nn !== -1 && mt.length === Nn + 1;                     // the first space is the LAST character
 *      if (Nn !== -1) { let ut = TS(Fn, e);
 *        if (ut || ve) { if (ut?.argumentHint && De) _r = ut.argumentHint; …
 *                        l(() => ({ commandArgumentHint: _r, suggestions: [], selectedSuggestion: -1 })); return } }
 *
 *  Two things that arm does at once, and both are load-bearing: it CLOSES the popup (`suggestions: []`) and it
 *  sets the hint. The close needs nothing from us — `COMMAND_HEAD` is `/^\/(\S*)$/`, so a trailing space has
 *  already ended the trigger and there is no popup left to close. The hint is this function.
 *
 *  `De` is why `/model foo` and `/model  ` (two spaces) show nothing: the hint is for the moment the user has
 *  typed the space and not yet the argument. `ut?.argumentHint` is why a command without one shows nothing.
 *  Upstream's second arm (`type === "prompt" && argNames?.length` → a positional `YOu` hint) has no analogue —
 *  `CommandEntry` carries no `argNames`, the same gap `executesOnEnter` documents in commandComplete.ts.
 *
 *  Two upstream guards are IMPLIED rather than tested: `!N9f(Tr, mt)` (L490747) is `!(… && !mt.endsWith(" "))`
 *  and `De` already forces a trailing space, and the render gate `L` at L396283 is
 *  `value.trim().indexOf(" ") === -1 || value.endsWith(" ")`, whose second half `De` also forces.
 *
 *  Takes the raw buffer and the catalog rather than an `EditorState`: it is a fact about the TEXT, the
 *  composer already holds the catalog as a prop, and there is no popup state to hang it off by definition. */
export function commandArgumentHint(buffer: string, catalog: CommandEntry[]): string | null {
  if (!buffer.startsWith("/") || buffer.length <= 1) return null;
  const sp = buffer.indexOf(" ");
  if (sp === -1) return null;
  const name = buffer.slice(1, sp);
  // `YRr` (L489971) also has an MCP arm (`prefix:` + `://`); we host no MCP resource commands, so the
  // `KJa` half is the whole of it here. A multiline buffer fails it for free — `\n` is not in the class.
  if (!isCommandToken(name)) return null;
  if (buffer.length !== sp + 1) return null;                    // `De`: the space is the last character
  return catalog.find((e) => e.name === name)?.argumentHint ?? null;
}
