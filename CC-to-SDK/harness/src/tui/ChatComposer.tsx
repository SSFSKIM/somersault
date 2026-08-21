// tui/src/ChatComposer.tsx — the chat REPL's multiline input: a thin Ink view over the pure editor reducer.
// Owns the one side effect (the @-mention filesystem walk). The shared console <Composer> is left untouched.
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { readdir } from "node:fs/promises";
import { applyKey, bufferText, clearForInterrupt, commandArgumentHint, commandEmptyMessage, completionActive, ghostText, initialEditorState, setMentionFiles, setCommandCatalog, inputMode, rebuildChips, replaceBufferFromOutside, clearToHistory, endKillAndYank, historyLabel, historyPosition, suggestPopupShown, caretFromLocalPosition, type EditorState, type HistNavEntry, type PastedMap } from "./editor.js";
// F9 T-MOUSE Task 4 — the composer's published origin, the SAME "computed constant" idiom
// `FullscreenViewport` reads `useRegionTop` through (FullscreenFrame.tsx's own header comment on
// `DockTopContext`). Absent (0) outside a bounded fullscreen frame, exactly like `useRegionTop`.
import { useDockTop } from "./FullscreenFrame.js";
import { catalogColumnWidth, SuggestPopup, type SuggestItem } from "./suggestPopup.js";
import { applyQueueDrain } from "./queue.js";
import { cachedExampleFiles, examplePool, pickPlaceholder, QUEUED_UP_HINT } from "./placeholder.js";
import { loadPrefs, savePrefs } from "./prefs.js";
import { PASTE_LIMIT } from "./pasteChips.js";
import { appendHistory, hydrateEntry, readHistory } from "./promptHistory.js";
import { composerMode } from "./promptMode.js";
import { collectEntries, mentionWalkRoot, type AsyncReaddirFn, type DirEnt } from "./fileComplete.js";
import { commandKind, type CommandEntry } from "./commandComplete.js";
import { editExternal as realEditExternal } from "./externalEditor.js";
import { ComposerFrame, ComposerEditorInFlight, PlaceholderCursor, PromptGlyph, borderTokenFor, POINTER, NBSP } from "./composerFrame.js";
import { InlineSearchRow, useInlineHistorySearch } from "./InlineHistorySearch.js";
import { NotificationSlot } from "./NotificationSlot.js";
import { usePaletteHoist } from "./paletteSlot.js";
import { createNotificationStore, type CcxNotification, type NotificationStore } from "./notifications.js";
import { useBindingLookup, useKeyActions, useKeyFallback, useKeyScope, usePasting, useSuspendInput, type SuspendInput } from "./keys/KeymapProvider.js";
import { expandHintText, formatBindings } from "./keys/hints.js";
import { createDoublePress, DOUBLE_PRESS_WINDOW_MS, type DoublePress, type DoublePressDeps } from "./keys/doublePress.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";

// F1 Task 2's role map STOOD HERE and is gone with its last consumer. It fed the two mode-hint rows below
// the frame; Wave C Task 2 deleted those rows (the footer owns that space now) and Wave C Task 14 removed the
// `#` memory mode whose `remember` token was the second half of it. The BORDER's own read moved to
// composerFrame.tsx back at F5 Task 2 and is where the per-render /theme discipline now lives.

const DEFAULT_COLUMNS = 80;
/** The popup's height is a function of the terminal's, so an unthreaded `rows` needs a stand-in for the same
 *  reason `columns` does. 24 is the VT100 default every terminal still reports when it has nothing better. */
const DEFAULT_ROWS = 24;
/** CM24, bundle L493772. Both this and `Pasting…` are FOOTER strings since Wave C Task 2 — the row that
 *  printed them moved to `Footer.tsx`, which owns the literals now. Re-exported from here because
 *  test/tui/paste-expand.test.tsx imports it from this module, and one re-export beats a second copy. */
export { FOOTER_PASTE_EXPAND_HINT as PASTE_EXPAND_HINT } from "./Footer.js";
/** `k0`'s 8000 ms (L495759). The hint's whole life; the EXPAND itself has no deadline (pasteChips.ts). */
const PASTE_HINT_MS = 8000;
/** CM56, the DESCRIPTION half of upstream's second-Up hint (bundle L489537): `<bn action="history:search"
 *  context="Global" fallback="ctrl+r" description="search history" />`. The CHORD half is never a literal —
 *  it is derived from the live binding table through `expandHintText`, the same `$e` composer every other
 *  advertised chord in this port goes through, so a rebind moves it and an unbind removes the row. */
export const HISTORY_SEARCH_HINT = "search history";
/** `Lli` (L489464) — the `timeoutMs` upstream puts on that notification. */
const HISTORY_HINT_MS = 5000;
/** The two queue keys this component posts, from the annex §C1.6 inventory: `left-arrow…`-style stable names
 *  so a producer can pull its own row back (`dismissSearchHint`) without knowing what else is queued. */
export const SEARCH_HINT_KEY = "search-history-hint";
export const YANK_HINT_KEY = "kill-paste-hint";
/** `escape-again-to-clear` (annex §C1.6, L395624) — upstream's own key for the Esc-Esc arm's feedback. */
export const ESC_CLEAR_KEY = "escape-again-to-clear";
/** L395624's own `timeoutMs`, and it is NOT `escClearMs`. Upstream's hint outlives its 800 ms arm by 200 ms
 *  because `K`'s `onArmChange(false)` does nothing at all — only the SECOND press removes the entry
 *  (`j("escape-again-to-clear")`), and an expired arm simply leaves the notification to time out on its own.
 *  RECORDED DIVERGENCE (plan constraint 12): ccx removes the entry on any disarm, so this 1000 is a CEILING the
 *  queue enforces rather than the number that usually ends the hint. Tying the hint to the arm is the same
 *  choice `ESC_ARM_MS` records on the rewind side — a hint that outlives what it promises is the failure mode
 *  this port cares about more than the 200 ms. */
const ESC_CLEAR_HINT_MS = 1000;
/** L395652, verbatim. */
export const YANK_HINT_TEXT = "Ctrl+Y to paste deleted text";
/** WAVE C TASK 4 — the ← agents gesture (annex §C1.6's `left-arrow-again-for-agents` at L395758, the outcome
 *  list at annex §C7.8/L395750). Upstream's `Press ← again`, verbatim.
 *
 *  TWO RECORDED DIVERGENCES (plan constraint 12), both about what ccx does NOT have:
 *   1. NO ATTACH-AMBIGUITY DANCE. Upstream's second shape is `Ambiguous ←, press again to detach` (L395762),
 *      for a session that is attached to a remote and where `←` therefore means two things. ccx detaches
 *      through `/detach`, a normal command, so the ambiguity never arises and the second copy has no producer.
 *   2. NO `reject` OUTCOME. Upstream's decision function has six (`fire`, `arm`, `absorb`, `attach-arm`,
 *      `attach-absorb`, `reject`) and the annex records the names without the body, so what distinguishes
 *      `reject` from `arm` is not transcribable. This port arms on every ← that reaches an empty composer,
 *      which is `arm` unconditionally. The footer's `← for agents` still renders only while background tasks
 *      exist (`footerModel.agentsAffordance`), so a user who never runs one is never told about the gesture —
 *      but pressing it twice opens the same (empty) pane ctrl+b opens, which is honest either way.
 *  `LEFT_AGENTS_MS` is the arm window AND the hint's `timeoutMs`: upstream's is `OXs`, whose value the annex
 *  does not carry, so the entry and the arm it advertises expire together on the primitive's own default. */
export const LEFT_AGENTS_KEY = "left-arrow-again-for-agents";
export const LEFT_AGENTS_TEXT = "Press ← again";
const LEFT_AGENTS_MS = DOUBLE_PRESS_WINDOW_MS;

/** How long the external-edit chord waits for Ink to actually WRITE the in-flight row before the sync editor
 *  freezes the loop. One Ink throttle window (32ms, ink/build/ink.js:39) plus a little — see the deferral in
 *  `chat:externalEditor`. Exported so the paint-order pin reads the constant instead of re-typing it. */
export const EDITOR_PAINT_MS = 40;

/** CM39, bundle L490598: `let Ae = Dee(Re, 50)` — the @-walk's debounce window. `Dee` (L182690) is
 *  TRAILING-ONLY: every call clears the pending timer and reschedules, and there is no leading edge, so even
 *  the first scheduled walk waits the full window. The React effect below is that shape exactly — a re-render
 *  with a new root runs the cleanup (`clearTimeout`) before the next schedule.
 *
 *  Exported so the pin in test/tui/file-complete-async.test.tsx reads the constant instead of re-typing 50. */
export const MENTION_WALK_DEBOUNCE_MS = 50;

const realReaddir: AsyncReaddirFn = async (dir: string): Promise<DirEnt[]> =>
  (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() }));

/** `ghost` is CM36's inline completion and `argHint` is CM37's inline argument hint — both are text drawn
 *  INSIDE the input line rather than below it, which is the whole reason they are threaded here instead of
 *  living in a component of their own. Each is mutually exclusive with the other by construction (the ghost
 *  needs a partial `/name`, the hint needs a completed `/name `). */
function renderBuffer(state: EditorState, ghost: string | null, argHint: string | null): React.ReactNode {
  const { lines, cursor } = state;
  const last = lines.length - 1;
  return lines.map((line, r) => {
    // CM37, bundle L396283: `x && <Text dimColor wrap="truncate-end">{value.endsWith(" ") ? "" : " "}{hint}</Text>`
    // rendered after the value inside the same run. The space prefix is dead code for us — `commandArgumentHint`
    // only answers for a buffer whose last character IS the space — but it is upstream's, so it is transcribed.
    const hint = argHint && r === last ? <Text dimColor wrap="truncate-end">{(line.endsWith(" ") ? "" : " ") + argHint}</Text> : null;
    // Only wrap a non-cursor row in a Box when there is something to put beside it; a bare <Text> is what
    // every other row has always been and the frame's wrapping behaviour is pinned against that shape.
    if (r !== cursor.row) return hint ? <Box key={r} flexDirection="row"><Text>{line.length ? line : " "}</Text>{hint}</Box> : <Text key={r}>{line.length ? line : " "}</Text>;
    const before = line.slice(0, cursor.col);
    // CM36's cursor rule (bundle L394780–L394785): with ghost text present the cursor sits ON THE GHOST'S FIRST
    // CHARACTER (`x = e ? r(D) : D`, where `D` is the first grapheme of the ghost) and the remainder is dimmed
    // (`R = n.dim(P)`), instead of inverting the blank past the end of the buffer.
    const g = ghost ? [...ghost] : null;
    const at = g ? g[0] : (line[cursor.col] ?? " ");
    const tail = g ? g.slice(1).join("") : "";
    const after = line.slice(cursor.col + 1);
    // Box flexDirection="row" keeps before/cursor/after on one line; nested <Text inverse> inside <Text> breaks layout
    // in Ink 5.x on re-render, causing chars after the first to bleed onto the border.
    return (
      <Box key={r} flexDirection="row">
        <Text>{before}</Text><Text inverse>{at}</Text>
        {tail ? <Text dimColor>{tail}</Text> : null}
        <Text>{after}</Text>{hint}
      </Box>
    );
  });
}

/** CM52's seed. `readHistory` answers NEWEST-first (`UUd`'s backward walk) and the editor's list is
 *  OLDEST-first, so the reversal is here, at the one seam that crosses between the two conventions.
 *
 *  `project` is passed EXPLICITLY, never left to `readHistory`'s `process.cwd()` default: the composer knows
 *  the session's cwd and the process's may be something else entirely (a daemon-hosted session, a `ccx
 *  attach` from another directory), and silently scoping a user's history to the wrong project reads as an
 *  empty history rather than as a bug.
 *
 *  Each line is hydrated on the way in — upstream's own placement (`yDo` inside the read walk) — so every
 *  recall afterwards is pure state assignment with no disk in it. */
function seedHistory(project: string, env: NodeJS.ProcessEnv): HistNavEntry[] {
  const rows = readHistory({ scope: "project", project }, env);
  const out: HistNavEntry[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const { display, pastedContents } = hydrateEntry(rows[i], env);
    // ONE derivation with the submit path (t7 review, M1): both read the DISPLAY through `composerMode`,
    // so a `#note` prompt carries the same mode in-session as it does after a reseed. It reads the RAW line,
    // not the hydrated display, because a lost-paste rewrite can prepend `[` and would read as prompt mode.
    out.push({ display, mode: composerMode(rows[i].display), pastedContents });
  }
  return out;
}

/** The event a real ctrl+l produces — see the `chat:clearInput` registration for why the action re-enters the
 *  key path on this rather than on whatever key the user bound to it. */
const CTRL_L: KeyEvent = { kind: "key", name: "l", ctrl: true, alt: false, shift: false, super: false, raw: "\x0c" };
/** …and the event a real Return produces. CM58's `historySearch:execute` re-enters the key path on THIS
 *  rather than calling `onSubmit` itself, for the same reason `chat:clearInput` re-enters on CTRL_L: the
 *  submit that matters is `applyKey`'s (chip expansion, the history append, the bash prefix arm),
 *  and a second copy of it in the search hook is the definition guaranteed to drift. */
const ENTER: KeyEvent = { kind: "key", name: "enter", ctrl: false, alt: false, shift: false, super: false, raw: "\r" };

/** `"typing"` is upstream's SUPPRESSED state (`Fui()` L499192): a dialog is parked but the user is mid-draft,
 *  so the dialog renders nothing and the composer keeps both the screen and the keyboard. It is a distinct
 *  owner value rather than a second boolean because it is a distinct visible surface — composer plus the dim
 *  `Waiting for permission…` row — and one derivation cannot disagree with itself. */
export type InputOwner = "composer" | "typing" | "shortcuts" | "transcript" | "overlay" | "decision";
/** The two owner values under which the composer is on screen AND holds the keyboard. */
export const composerOwns = (owner: InputOwner): boolean => owner === "composer" || owner === "typing";

/** F9 T-MOUSE Task 4 — the click seam, on the same ref-channel family `FullscreenViewport`'s `hitmapRef`
 *  already is (`ViewportHitmap`) and for the identical reason: the geometry this answers with is this
 *  component's own render, current only at THIS instant, and the tap machine that calls it lives in
 *  `ChatApp`, outside React, on the next mouse report. `caretAt` does the WHOLE job in one call — resolve the
 *  terminal cell to a buffer offset AND commit it to the live `EditorState` — rather than splitting query
 *  from mutation, because nothing outside this component may safely construct a `Cursor` against buffer
 *  state it does not own. Returns whether the cell was addressable, so `ChatApp`'s tap machine can treat a
 *  miss (above the buffer, past its last painted row, off `fullscreen`, or the dock's origin not published)
 *  exactly like `anchorAt`'s own `undefined` — a safe no-op, never a guess. */
export interface ComposerCaret { caretAt(col: number, row: number): boolean }
/** CM-, bundle L496241: `<Text dimColor>Waiting for permission…</Text>` — one ellipsis CHARACTER, dim, in a
 *  `marginTop:1 marginLeft:2` box ABOVE the composer frame. Exported so the pin reads the literal. */
export const WAITING_FOR_PERMISSION = "Waiting for permission…";

/** What `Vr` memoizes for `MVf` (bundle L495093), as a record ChatApp can own: the example-file list the
 *  `Try "…"` pool is built from, resolved once, and the random draws that index into it, frozen at first
 *  use. Both have to outlive a composer remount or the suggestion re-rolls behind every dialog. */
export interface PlaceholderMemo { files?: string[]; draws: number[] }

/** CM30: the composer's ONE popup, in `DXe`'s own `{ suggestions, selectedSuggestion, maxColumnWidth,
 *  emptyMessage }` shape (bundle L494612). Upstream has a single suggestion component and a single suggestion
 *  list; the branch here is only over which producer filled it.
 *
 *  Only the HEAD command arm feeds it. A mid-text `/` produces ghost text upstream and no popup at all — see
 *  `commandActive` in completions.ts for the two bundle branches that make that so — so its `CommandState`
 *  exists purely to carry the ranked catalog the ghost reads.
 *
 *  Three things that used to be in the old `CommandPopup` and are gone on purpose:
 *   · `.split("\n")[0].slice(0, 48)` on the description — `q7p` collapses whitespace (`YSn`) and truncates to
 *     a WIDTH-derived budget, so a fixed 48 was both too long on a narrow terminal and too short on a wide one.
 *   · the `argumentHint` lane next to the name — upstream's row has none. Its argument evidence is
 *     `(arguments: …)` appended to the DESCRIPTION for prompt commands with `argNames` (`VJa`, L490005–L490008),
 *     a field we do not carry; `argumentHint` reaches the user through CM37's inline hint instead, which is this task's other half.
 *   · the `↑/↓ n/N · tab completes · esc closes` footer — our invention, with no counterpart in `DXe`, and a
 *     conditional extra line is exactly the kind of thing the blank padding exists to prevent. */
/** `VJa`'s `t` (bundle L490015): `Z.CLAUDE_CODE_ENABLE_MENU_KIND_LANES || Ke("tengu_mint_lanes", !1)`. The
 *  gate is DEFAULT OFF and that is not a guess: the installed 2.1.220's `~/.claude.json` caches
 *  `tengu_mint_lanes: false`, so the build this port is measured against shows no kind lane at all. The env
 *  var half is reachable by a user, so it is the half we transcribe — same name, and same bare truthiness
 *  upstream reads it with (`markdownInline.ts`'s `CLAUDE_CODE_FORCE_STRIKETHROUGH` does the same; note this
 *  means `=0` turns it ON, upstream's behaviour, not a nicety we added).
 *
 *  Read off the passed env rather than `process.env` directly so a test can flip it per render — the same
 *  `historyEnv` seam every history/paste/prefs path in this component already goes through. */
const menuKindLanes = (env: NodeJS.ProcessEnv): boolean => !!env.CLAUDE_CODE_ENABLE_MENU_KIND_LANES;

function suggestProps(state: EditorState, env: NodeJS.ProcessEnv): { items: SuggestItem[]; selected: number; maxColumnWidth?: number; emptyMessage?: string | null } | null {
  const c = state.command;
  const lanes = menuKindLanes(env);
  // T-X4T: `query` is threaded onto COMMAND items ONLY, mirroring upstream's producer split (`ADc`,
  // L600899/L600908 sets it; the `@`-mention producer `UMo`, L314103, does not). `c.query` is the RAW trigger
  // text (`completionTriggers.ts`'s `head[1]`/token match) — not lowercased, not trimmed. `FIh` lowercases
  // only the row TEXT, so a capitalized query must be lowercased HERE or it silently matches nothing;
  // `.trim()` mirrors upstream's own `t.slice(1).toLowerCase().trim()` (L600908). An empty result becomes
  // `undefined`, same as upstream calling its row builder with no third argument at all (L600929) —
  // `Highlighted` treats a falsy `query` as "no highlight", so this must not be `""`.
  const query = c?.head ? c.query.toLowerCase().trim() || undefined : undefined;
  if (c?.head) return {
    // DG55: `kind` is set HERE and only here. Upstream's slash source is the only producer of the field
    // (`VJa`, L490007 — `...t && { kind: p9f(e), sourceTag: nRb(e) }`), so "command rows only" is not a rule
    // the popup enforces, it is a fact about which of our three sources fills the field in. The `@`-mention
    // arm below and the history surfaces set nothing, and `S_a` gives a kindless row no lane at all.
    // The `...(lanes && …)` spread is `VJa`'s own literal shape, gate included.
    items: c.items.map((e) => ({ id: `cmd-${e.name}`, displayText: `/${e.name}`, description: e.description, ...(lanes && { kind: commandKind(e) }), ...(query && { query }) })),
    selected: c.index,
    // `k` (L490508–L490513) is computed over the WHOLE catalog, not the matches, so the name lane does not jitter as
    // the user narrows the list. `catalogColumnWidth` is that sum.
    maxColumnWidth: catalogColumnWidth(c.catalog.map((e) => e.name)),
    // CM38's message and its guards live in `commandEmptyMessage` (completions.ts), not here: the key router
    // has to know whether this message is on screen too, and one derivation is the only way the two cannot
    // disagree (t9 review, I2).
    emptyMessage: commandEmptyMessage(state),
  };
  const m = state.mention;
  // `UMo` (bundle L314103): `{ id: "file-"+path, displayText: path }` — no description, which is why an
  // `@`-mention row renders as `+ path` and never reaches `q7p`'s en-dash arm. `file-` is the id prefix `E_a`
  // keys the whole file-ish rendering branch off, so it is data, not decoration.
  if (m) return { items: m.items.map((c2) => ({ id: `file-${c2.path}`, displayText: c2.path })), selected: m.index };
  return null;
}
/** `Ptl` (bundle L494604): `qMr.length > 0 || !!VMr` — suggestions OR an empty message. Upstream branches the
 *  whole composer footer on it (`if (Ptl && !LRn) return <the suggestion box>`, L494609–L494615), so the
 *  suggestion region and the hint rows are alternatives that occupy the same slot and exactly one of them is
 *  on screen at a time.
 *
 *  Ours keyed the footer off the raw presence of `state.command`/`state.mention` instead, which was already
 *  wrong for an empty `@zz` (state present, nothing drawn, two rows silently gone) and which t10's head gate
 *  made worse: a mid-text `/zzz` that matches nothing, or any visible ghost, now draws no popup at all, and
 *  before the gate the un-head-gated empty message at least filled the slot. The composer lost two lines and
 *  put nothing there — the very jump the blank padding exists to prevent, reintroduced one layer up.
 *
 *  THE PREDICATE MOVED to `suggestPopupShown` (completions.ts) and is stated over the EDITOR STATE rather than
 *  over `suggestProps`'s output: the live window's cap needs the same answer one level up, and it needs it
 *  from the state a keystroke has just produced rather than from a rendered result. One derivation, two
 *  readers — the alias is kept so this file still reads in upstream's vocabulary. */
const popupDrawn = suggestPopupShown;

/** An injected editor may be sync (the pre-F5 DI shape, still used by several tests) or async (what the
 *  real one is now). Both are normalized through `Promise.resolve` at the one call site. */
export type ComposerEditExternal = (text: string) => string | null | Promise<string | null>;

/** The composer's half of `Footer`'s props (Wave C Task 2): upstream's `Ltl` (isSearching), `isPasting`,
 *  `showExpandPasteHint`, `mode === "bash"` and `exitMessage` — whose `key` is a STRING FROM THE ARM SITE,
 *  never a literal inside the footer.
 *
 *  THE DRAFT SIGNAL IS DELIBERATELY NOT IN HERE, and the reason is a defect this shape prevents rather than a
 *  preference. `q1b`/`DMr` travel on the EXISTING `onInputActivity` callback, which fires synchronously from
 *  `commitState` — inside the same stdin handler as the keystroke — so the hint list collapses in the very
 *  frame the character appears. This object travels on an effect, which is a flush later. When BOTH carried
 *  the draft, the effect's copy (computed from the render that ran before the composer's own state landed)
 *  overwrote the synchronous one and put the stale hint list back for exactly one frame — which is precisely
 *  what `chat.test.tsx`'s "never paints a stale editor hint in ANY frame" sweep exists to catch. One field,
 *  one owner. */
export interface ComposerFooterState {
  searching: boolean; pasting: boolean; pasteExpandHint: boolean;
  bashMode: boolean; exitArm?: { key: string; verb: string };
}
/** What the footer shows with no composer mounted (a dialog owns the screen): none of the four states. */
export const IDLE_COMPOSER_FOOTER_STATE: ComposerFooterState = { searching: false, pasting: false, pasteExpandHint: false, bashMode: false };

export function ChatComposer({ onSubmit, cwd, commandCatalog, onExit, onCycleMode, onInterrupt, onHelp, onDraftStart, onInputActivity, waitingForPermission, inputOwnerRef, editorStateRef, consumedPrefillTokenRef, searchHintFiredRef, prefill, onPrefillApplied, editExternal, suspendInput, onKillAgents, yankHintMs = 5000, pasteHintMs = PASTE_HINT_MS, searchHintMs = HISTORY_HINT_MS, mentionWalkMs = MENTION_WALK_DEBOUNCE_MS, mentionReaddir, sessionId, project, historyEnv, busy, escClearMs = 800, exitArmMs = 800, columns, rows, label, queuePop, queueHasEditable, submitCount = 0, hasMessages = false, suggestionEnabled = true, queueHintCountedRef, placeholderMemoRef, notifications, onFooterState, onSuggestOpen, clearDraftToken, consumedClearTokenRef, onOpenAgents, doublePressDeps, suggestion, onSuggestionSlot, onSuggestionAccept, fullscreen = false, originRef, dockCrowded = false }: { onSubmit: (text: string) => void; cwd: string; commandCatalog: CommandEntry[]; onExit?: () => void; onCycleMode?: () => void; onInterrupt?: () => void; onHelp?: () => void; onDraftStart?: () => void;
  /** `LRn = ds()` (bundle L494585) — THIS TREE IS PAINTING INTO THE ALTERNATE SCREEN. Two of canon's surface
   *  deltas land on this component, and both are SUBTRACTIONS from what it paints rather than new content:
   *  D10 hoists the suggestion popup out of here into the band above the dock (`usePaletteHoist` below), and
   *  D11 (L494644, `Utl = LRn ? null : …`) drops the notification block. Defaults false, so every classic
   *  mount and every bare-composer test renders exactly what it always did. */
  fullscreen?: boolean;
  /** F9 T-MOUSE Task 4 — see `ComposerCaret`. `ChatApp` holds the ref; a bare mount with nothing above it
   *  simply has no reader, exactly like `hitmapRef` in `FullscreenViewport`. */
  originRef?: React.Ref<ComposerCaret>;
  /** F9 T-MOUSE Task 4 fix (task review Critical) — true whenever `ChatApp` is painting a `TaskPanel` or the
   *  live-turn spinner/retry/compaction row above this component inside `dock` (the exact booleans that gate
   *  those elements there: `todosOpen`, `state.busy`, `state.compacting`, each already implying `!paneOwned`
   *  since this component only mounts when nothing pane-owning is up). The hoisted suggestion palette is NOT
   *  included here — this component already knows its own `hoisted` locally and folds it in directly. Used
   *  only to suppress `caretAt`'s addressability (see `originExact` below); defaults false so a bare mount
   *  with no `ChatApp` above it keeps whatever `useDockTop()` alone would answer. */
  dockCrowded?: boolean;
  /** Upstream's `onInputChange` → `Z1t(value.trim().length > 0)` (bundle L547796-802): the composer reports
   *  whether its buffer is non-empty EVERY time the text changes, and the app turns that into the typing
   *  activity flag that suppresses a parked dialog. Reported from `commitState`, the one writer, and only on a
   *  real text change — an arrow key calls no `onChange` upstream either, so it must not refresh the window. */
  onInputActivity?: (nonEmpty: boolean) => void;
  /** IS THE SUGGESTION POPUP ON SCREEN? Reported to the app for ONE reason: the popup is half the terminal
   *  (`popupHeight`) and it is not in `mainWindowCap`'s dock, so the live window's render cap has to subtract
   *  it or the frame clears Ink's tall-frame cliff on the keystrokes of every slash command.
   *
   *  IT RIDES `commitState`, NOT AN EFFECT, and that is the whole design. `onFooterState` is a passive effect
   *  — a flush behind — and one late frame is exactly one tall write, i.e. one whole reprinted session in the
   *  user's scrollback. This fires from the single editor-state writer, inside the same stdin handler as the
   *  keystroke that opened the popup, so the cap and the popup land in the same frame.
   *
   *  A BOOLEAN AND NOT A ROW COUNT: on the INLINE arm — the one `mainWindowCap` budgets for — the popup is
   *  blank-padded to `popupHeight(rows)` whenever it draws at all, so the app already holds the other half of
   *  the geometry and re-derives it per render, which is what keeps a resize honest without a second report.
   *  (The fullscreen arm pads to nothing and is capped at five rows; the frame's `paletteOpen` reads this same
   *  boolean, and it needs no count either — see FullscreenFrame.) */
  onSuggestOpen?: (open: boolean) => void;
  /** Upstream's `hasSuppressedDialogs` prop (L549494), which gates the dim `Waiting for permission…` row
   *  (L496241): true while a decision is parked behind this draft. */
  waitingForPermission?: boolean; inputOwnerRef?: React.MutableRefObject<InputOwner>; editorStateRef?: React.MutableRefObject<EditorState>; consumedPrefillTokenRef?: React.MutableRefObject<number>;
  /** CM56's once-only guard, owned by ChatApp so it outlives this component's remounts (see below). */
  searchHintFiredRef?: React.MutableRefObject<boolean>; prefill?: { text: string; token: number; mode?: "replace" | "prepend"; pastedContents?: PastedMap } | null; onPrefillApplied?: () => void; editExternal?: ComposerEditExternal;
  /** Overrides the KeymapProvider's own terminal handoff (`useSuspendInput`) — the ordering pin injects a fake
   *  one. Absent AND with no provider above, the editor simply runs without a handoff. */
  suspendInput?: SuspendInput; onKillAgents?: () => void; yankHintMs?: number; busy?: boolean; escClearMs?: number; exitArmMs?: number;
  /** How long `paste again to expand` stays up (`k0`'s 8000 ms). The gesture it advertises outlives it —
   *  see `expandRepeatedPaste`. Injectable for the same reason `yankHintMs` is: so a test can watch the
   *  window close in real time instead of faking the clock under Ink. */
  pasteHintMs?: number;
  /** CM56's window (`Lli`). Injectable for the same reason `pasteHintMs` is. */
  searchHintMs?: number;
  /** CM39's 50 ms (`Dee(Re, 50)`), and the readdir the @-walk runs on. Both injectable for the same reason
   *  every other timing knob here is: so a test can watch the debounce close, and park a walk mid-flight to
   *  prove a stale resolution never repaints the list, without faking the clock under Ink. */
  mentionWalkMs?: number; mentionReaddir?: AsyncReaddirFn;
  /** CM52's two persisted columns. `project` is the SESSION's cwd and defaults to the `cwd` prop rather than
   *  to `process.cwd()` — see `seedHistory`. `sessionId` is written but never read by this task's walk; it is
   *  what makes `scope:"session"` answerable at all, and a line written without it can never be recovered
   *  into that scope later. */
  sessionId?: string; project?: string;
  /** The env every history/paste-cache path in this component reads (`CCX_FLEET_ROOT`,
   *  `CLAUDE_CODE_SKIP_PROMPT_HISTORY`). A prop rather than an ambient read so a test can point the whole
   *  feature at a temp root without mutating `process.env` for the rest of the suite. */
  historyEnv?: NodeJS.ProcessEnv;
  /** The terminal's width, read per render (a function, not a number, so a resize is visible without a
   *  new prop identity). ChatApp threads its own `deps.columns ?? stdout.columns ?? 80` source through. */
  columns?: () => number;
  /** The terminal's HEIGHT, read the same per-render way and for one consumer: the paste-chip threshold
   *  (`max(0, min(rows - 10, 2))`, F5 task 3), which upstream reads off the live terminal so that a short
   *  window collapses a paste the tall one would have inlined. */
  rows?: () => number;
  /** The `History n/total` text painted into the top rule (upstream `AVf`, L494870). A slot this task:
   *  F5 Task 7 wires the live history position into it. Nothing is painted while it is undefined. */
  label?: string;
  /** CM48's drain seam (F5 task 8). ONE synchronous call, consulted by the Up/ctrl+p path BEFORE the history
   *  walk: it returns the queued block to merge above the live draft, or null when the queue has nothing
   *  editable to give. Synchronous and not a prefill round-trip because the same keystroke must fall through
   *  to `historyPrev` when the queue declines — a state-then-effect handoff cannot answer in time. */
  queuePop?: () => { text: string; pastedContents?: PastedMap } | null;
  /** The placeholder ladder's four remaining inputs (`placeholder.ts` / upstream `NVf`, L495107).
   *  `suggestionEnabled` is upstream's `promptSuggestionEnabled` setting. W-C T12 gave it both a real owner
   *  (useChat's `promptSuggestionEnabled` slice, threaded down by `ChatApp`) and a `/config` row, and ccx
   *  defaults it OFF where upstream defaults it on — so a fresh ccx session shows no `Try "…"` template
   *  either, which is the accepted knock-on recorded in the spec. The `= true` default below is for BARE
   *  renders only (a test or any caller that does not thread the prop); the product always passes it. */
  queueHasEditable?: boolean; submitCount?: number; hasMessages?: boolean; suggestionEnabled?: boolean;
  /** The queued-up hint's once-per-SESSION guard, owned by ChatApp so it outlives this component's remounts
   *  — exactly like `searchHintFiredRef` above, and for exactly the same reason. */
  queueHintCountedRef?: React.MutableRefObject<boolean>;
  /** The `Try "…"` suggestion's frozen inputs, app-scoped for the same lifetime reason: upstream's `Vr`
   *  memoizes the pick once per PROCESS, so it must survive this component's remounts. */
  placeholderMemoRef?: React.MutableRefObject<PlaceholderMemo>;
  /** WAVE C TASK 2 (EP-C1b): the notification queue this composer POSTS its transient hints to and RENDERS
   *  the current entry of, in the one-row overlay above the frame. `ChatApp` passes `useChat`'s single
   *  store; a bare render falls back to a local one so the hints still work with no app above (the same
   *  local-fallback shape `searchHintFiredRef` uses one hook down). */
  notifications?: NotificationStore;
  /** WAVE C TASK 2: everything the FOOTER needs that only this component knows. The footer row lives in
   *  `ChatApp` (see `Footer.tsx`'s divergence 2 — three dialog height budgets count it as their one
   *  unconditional sibling), so the four early-return states and the draft signal have to travel up. Fired
   *  from an effect on change, and once more with the idle value on unmount, so a dialog that replaces this
   *  component cannot leave a stale `Pasting…` on the footer row. */
  onFooterState?: (s: ComposerFooterState) => void;
  /** WAVE C TASK 4 (EP-C7b) — Ctrl-C's clear channel, a monotonic token from `ChatApp` (see `clearDraftToken`
   *  there for why a token and not a callback). Every BUMP past the last CONSUMED one runs upstream's
   *  `t(""), B(0), c?.()` over the buffer. */
  clearDraftToken?: number;
  /** WAVE C FINAL REVIEW, finding 1 — the consumed cursor for the token above, APP-scoped exactly like
   *  `consumedPrefillTokenRef`. It was a component-local ref seeded FROM the live token, on the theory that a
   *  clear must not survive a remount; the theory was wrong, because a draft does not die at a remount either.
   *  The composer unmounts whenever a dialog takes the screen but its buffer is parked in the app-scoped
   *  `editorStateRef` and painted again on the way back — so a Ctrl-C pressed while the dialog is up has a
   *  real draft to clear, and seeding from the live token marked that very bump as already consumed and handed
   *  the draft back. Kept outside the component, the cursor still forbids the case that motivated the old
   *  seeding (a bump consumed once cannot fire again on the next mount), and now also honours the one it
   *  broke. A bare mount with no app above falls back to the old local ref. */
  consumedClearTokenRef?: React.MutableRefObject<number>;
  /** WAVE C TASK 4 — where the ← agents gesture goes on its second press: `ChatApp`'s background pane, the
   *  same surface `task:background` opens while idle. Absent in a bare mount, where the gesture still arms and
   *  simply has nowhere to go. */
  onOpenAgents?: () => void;
  /** WAVE C TASK 4 — the `deps` seam of this component's three double-press arms (esc-clear, ctrl+d exit, ←
   *  agents), threaded down from `ChatApp` so one injected clock drives every arm in the tree. */
  doublePressDeps?: DoublePressDeps;
  /** WAVE C TASK 12 (EP-C5) — the model's follow-up suggestion, or null when there is none. The four-state
   *  slice lives in `useChat` (it must outlive this component's remounts and survive Ctrl-C); what arrives
   *  here is just its text, and the two callbacks below are how this component's two facts get back up:
   *  whether the suggestion COULD be painted right now (`b9`, L495702 — prompt mode, empty buffer, no turn
   *  running) and that a key accepted it. */
  suggestion?: string | null;
  onSuggestionSlot?: (canShow: boolean) => void;
  onSuggestionAccept?: (text: string) => void }) {
  const historyProject = project ?? cwd;
  const historyEnvRef = useRef(historyEnv ?? process.env); historyEnvRef.current = historyEnv ?? process.env;
  const historyProjectRef = useRef(historyProject); historyProjectRef.current = historyProject;
  const sessionIdRef = useRef(sessionId); sessionIdRef.current = sessionId;
  // THE SEED-ON-REMOUNT RULE. `editorStateRef` is APP-scoped (ChatApp owns the ref; this component is
  // unmounted and remounted every time a dialog takes the screen), so "seed at mount" would re-read the file
  // — and clobber every in-session append, plus any live walk — each time a permission prompt closed. The
  // gate is therefore a DURABLE flag on the state itself, not a mount-local one: `historySeeded` rides in the
  // ref alongside the history list it describes, so exactly one composer instance per app ever seeds, and it
  // is whichever one first finds the ref holding a fresh `initialEditorState()`. A test that hands in its own
  // pre-seeded ref gets no disk read at all, which is the other half of the same property.
  const [state, setState] = useState<EditorState>(() => {
    const saved = editorStateRef?.current ?? initialEditorState();
    const normalized = saved.mention || saved.command ? { ...saved, mention: null, command: null } : saved;
    const seeded = normalized.historySeeded
      ? normalized
      : { ...normalized, history: seedHistory(historyProject, historyEnvRef.current), historySeeded: true };
    if (editorStateRef) editorStateRef.current = seeded;
    return seeded;
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const commitState = (next: EditorState | ((current: EditorState) => EditorState)) => {
    const previousText = bufferText(stateRef.current);
    const popupWasShown = popupDrawn(stateRef.current);
    const resolved = typeof next === "function" ? next(stateRef.current) : next;
    stateRef.current = resolved;
    if (editorStateRef) editorStateRef.current = resolved;
    // Upstream's `onInputChange` seam (see the prop's comment): the ONE place the buffer text changes, so the
    // one place the activity flag can be reported from. `trim()` is upstream's own predicate — a draft of
    // spaces is not typing, and must not hold a permission prompt off the screen.
    const text = bufferText(resolved);
    if (text !== previousText) onInputActivityRef.current?.(text.trim().length > 0);
    // …and the popup's own visibility, from the same one writer, for the reason in `onSuggestOpen`'s doc.
    // SHRINK LEADS, GROW FOLLOWS — the report straddles `setState` instead of sitting on one side of it. The
    // app's cap and this component's popup are two separate setStates, and the frame BETWEEN them (if there
    // is one) must not be the tall one: reporting an OPENING popup before our own `setState` makes that frame
    // "small window, no popup", and reporting a CLOSING one after makes it "small window, no popup" again.
    // A single call site would put "big window WITH popup" on screen for one frame in one of the two
    // directions, which is the whole defect, one keystroke rarer.
    //   MEASURED, so the reader knows what this is buying: with one report after `setState` the popup suite is
    // still green — the two updates land in a single Ink commit today, so no in-between frame exists. That is
    // an emergent property of legacy-mode React under this pinned Ink, not a guarantee either of them makes,
    // and the thing on the other side of it is the user's whole scrollback. Two lines to not depend on it.
    const popupShown = popupDrawn(resolved);
    if (popupShown && !popupWasShown) onSuggestOpenRef.current?.(true);
    setState(resolved);
    if (!popupShown && popupWasShown) onSuggestOpenRef.current?.(false);
    return resolved;
  };
  const endInterceptedEditorAction = (editor: EditorState) => {
    const ended = endKillAndYank(editor);
    if (ended !== editor) commitState(ended);
    return ended;
  };
  const disposed = useRef(false);
  // WAVE C TASK 2 — THE ONE STORE THIS COMPONENT POSTS TO AND RENDERS FROM. `useState`'s lazy initialiser so
  // the fallback store is created once per mount, never per render.
  const [localStore] = useState<NotificationStore>(() => createNotificationStore());
  const store = notifications ?? localStore;
  const [notice, setNotice] = useState<CcxNotification | null>(() => store.state().current);
  useEffect(() => { setNotice(store.state().current); return store.subscribe(() => setNotice(store.state().current)); }, [store]);
  // CM24's hint (`Rpk`/`Yg`/`lh` in the bundle). Its own state + timer, the yank hint's shape exactly.
  const [pasteHint, setPasteHint] = useState(false);
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // CM56. `searchHintFired` is upstream's `m.current` — fired ONCE, and deliberately not reset by the walk's
  // own reset (`G` at L489628 clears every other ref in the hook and leaves `m` alone).
  //
  // DURABLE, not component-local (t7 review, M2). Upstream's composer lives as long as the app; ours is
  // unmounted and remounted every time a dialog takes the screen, so a plain `useRef` here re-armed the hint
  // after every permission prompt and the user got told about the search chord over and over. That is the
  // same lifetime mismatch the disk seed hit two hooks above, and it takes the same answer: the flag lives in
  // an APP-scoped ref threaded down (ChatApp owns it, exactly as it owns `consumedPrefillTokenRef`). The
  // local fallback keeps a bare test render — and any future standalone mount — working unchanged.
  const localSearchHintFiredRef = useRef(false);
  const searchHintFired = searchHintFiredRef ?? localSearchHintFiredRef;
  useEffect(() => () => { disposed.current = true; if (pasteTimer.current) clearTimeout(pasteTimer.current); }, []);
  // ── CM58, the ctrl+r inline reverse-i-search (F5 task 12). A HOOK, not an overlay: see
  // InlineHistorySearch.tsx's header for why, and historySearchInline.ts's for the bundle transcription and
  // the four divergences. `submitBuffer` is threaded through a ref because it is `handleKey(ENTER)` and
  // `handleKey` is declared below this line.
  const submitBufferRef = useRef<() => void>(() => {});
  const search = useInlineHistorySearch({
    stateRef, commitState, projectRef: historyProjectRef, sessionIdRef, envRef: historyEnvRef,
    submitBuffer: () => submitBufferRef.current(),
    onDraftStart: () => onDraftStartRef.current?.(),
    // `dismissSearchHint` (`z`, bundle L489630): using the chord retires the row that advertised it.
    onOpen: () => { store.remove(SEARCH_HINT_KEY); },
  });
  // F2 task 8 removed the `mounted` one-flush guard that used to sit here. Its whole job was the readable-
  // before-data window: Ink reads stdin on "readable" and the keymap listens for "data" (emitted second), so
  // an unmigrated dialog could handle a key by unmounting itself and remounting this composer BEFORE our
  // listener ran, and our registration — written during render — would already be live for that same byte.
  // Nothing under src/tui subscribes to Ink's input any more, so Ink now reads the stream and dispatches to
  // zero subscribers: no component can re-render the tree ahead of us within one chunk, and the window it
  // guarded no longer exists. `inputOwnerRef` below is unaffected — it answers a different question (which
  // surface is visible) and still covers the passive flush AFTER this composer unmounts.
  // busy is read through a ref in handleKey below (busyRef.current, never the closure `busy`) — same reason
  // as stateRef: the keymap dispatches from a passive-effect listener, so a closure read lags one render.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onSubmitRef = useRef(onSubmit); onSubmitRef.current = onSubmit;
  const onExitRef = useRef(onExit); onExitRef.current = onExit;
  const onCycleModeRef = useRef(onCycleMode); onCycleModeRef.current = onCycleMode;
  const onInterruptRef = useRef(onInterrupt); onInterruptRef.current = onInterrupt;
  const onHelpRef = useRef(onHelp); onHelpRef.current = onHelp;
  const onDraftStartRef = useRef(onDraftStart); onDraftStartRef.current = onDraftStart;
  // Read through a ref like every other callback here — `commitState` above runs from the keymap's passive
  // listener, so a closure read would lag a render. (Declared below its one caller for the same reason
  // `onDraftStartRef` is: nothing calls it during render.)
  const onInputActivityRef = useRef(onInputActivity); onInputActivityRef.current = onInputActivity;
  const onSuggestOpenRef = useRef(onSuggestOpen); onSuggestOpenRef.current = onSuggestOpen;
  const onKillAgentsRef = useRef(onKillAgents); onKillAgentsRef.current = onKillAgents;
  const onOpenAgentsRef = useRef(onOpenAgents); onOpenAgentsRef.current = onOpenAgents;
  // W-C T12: both read from `handleKey`, which runs off the keymap's passive listener — the standing ref rule.
  const suggestionRef = useRef(suggestion); suggestionRef.current = suggestion;
  const onSuggestionAcceptRef = useRef(onSuggestionAccept); onSuggestionAcceptRef.current = onSuggestionAccept;
  const editExternalRef = useRef(editExternal); editExternalRef.current = editExternal;
  const providerSuspend = useSuspendInput();
  const suspendInputRef = useRef<SuspendInput | null>(null); suspendInputRef.current = suspendInput ?? providerSuspend;
  const onPrefillAppliedRef = useRef(onPrefillApplied); onPrefillAppliedRef.current = onPrefillApplied;
  const yankHintMsRef = useRef(yankHintMs); yankHintMsRef.current = yankHintMs;
  const pasteHintMsRef = useRef(pasteHintMs); pasteHintMsRef.current = pasteHintMs;
  const searchHintMsRef = useRef(searchHintMs); searchHintMsRef.current = searchHintMs;
  // `handleKey` runs from a passive-effect stdin listener, so it reads BOTH of these through a ref for the
  // reason `stateRef` exists: a closure capture lags one render behind the live prop.
  const storeRef = useRef(store); storeRef.current = store;
  const searchHintRowRef = useRef("");                      // written during render, below — the DERIVED chord row
  // Read through a ref for the same reason as stateRef/busyRef: `handleKey` runs from the keymap's passive-
  // effect listener, so a closure read of `rows` lags a render — and after a resize the stale value is exactly
  // the one that decides wrong.
  const rowsRef = useRef(rows); rowsRef.current = rows;
  // ── WAVE C TASK 4 (EP-C7b) — ALL THREE OF THIS COMPONENT'S ARMS ARE `keys/doublePress.ts` NOW (the app's
  // two are, too). Three hand-rolled `useState` + `useRef(timestamp)` + `setTimeout` triples went here; each
  // had to re-derive `elapsed <= window && armed`, and the ctrl+d one carried a paragraph explaining that it
  // deliberately did NOT disarm on other keys because upstream's `Pee` does not. That asymmetry is now a
  // property of the shared primitive rather than a comment each site repeats.
  //
  // `disarm()` is the mid-life cancel and notifies; `dispose()` (unmount only) does NOT, which is why every
  // one of them is disposed from a cleanup whose mirrored `useState` is being torn down in the same breath.
  const [clearArmed, setClearArmed] = useState(false);
  const escClearArmRef = useRef<DoublePress | null>(null);
  if (escClearArmRef.current === null) escClearArmRef.current = createDoublePress({
    onArmChange: (armed) => { setClearArmed(armed); },
    // Upstream's second-press body (`K`, L395621): stash the discarded draft to history, then clear. The
    // hint's removal is the `clearVisible` effect below, which sees `onArmChange(false)` fire first.
    onSecondPress: () => {
      const ended = endInterceptedEditorAction(stateRef.current);
      // Upstream L395632: `if (e.trim() !== "") cgr(e)` — the bare TEXT, which `uu_` widens to
      // `{ display: e, pastedContents: {} }`. So an Esc-Esc'd draft persists WITHOUT its pastes; see
      // `clearToHistory`'s note for why that omission is worth transcribing rather than "fixing".
      const cleared = ended.lines.join("\n");
      if (cleared.trim() !== "") persistHistory({ display: cleared });
      commitState(clearToHistory(ended));
    },
  }, escClearMs, doublePressDeps);
  const disarmClear = () => { escClearArmRef.current!.disarm(); };
  useEffect(() => () => { escClearArmRef.current!.dispose(); }, []);
  useEffect(() => { if (busy) disarmClear(); }, [busy]);
  // KB3: Ctrl-D on an empty composer needs two presses — a first press within exitArmMs just hints, a second
  // exits; letting the arm expire re-arms rather than exiting. exitArmMs default is 800, not a round 2000:
  // upstream's `Pee` defaults its window to `fpy = 800` when the caller passes no override, and the Ctrl-D
  // exit chord's caller (cli.pretty.js:183476) is exactly that two-arg no-override call.
  const [dArmed, setDArmed] = useState(false);
  const exitArmRef = useRef<DoublePress | null>(null);
  if (exitArmRef.current === null) exitArmRef.current = createDoublePress({
    onArmChange: (armed) => { setDArmed(armed); },
    onSecondPress: () => { onExitRef.current?.(); },
  }, exitArmMs, doublePressDeps);
  useEffect(() => () => { exitArmRef.current!.dispose(); }, []);
  // WAVE C TASK 4 — the ← agents gesture (see `LEFT_AGENTS_KEY`). Its hint is posted and pulled from HERE
  // rather than from an effect on a mirrored `useState`, because nothing else in this component renders off
  // the arm: one boolean of React state for a queue entry nobody reads back would be a state variable whose
  // only job is to be an effect trigger. Upstream's `K` posts from its own `onArmChange` for the same reason.
  const leftAgentsArmRef = useRef<DoublePress | null>(null);
  if (leftAgentsArmRef.current === null) leftAgentsArmRef.current = createDoublePress({
    onArmChange: (armed) => {
      if (armed) storeRef.current.add({ key: LEFT_AGENTS_KEY, text: LEFT_AGENTS_TEXT, priority: "immediate", timeoutMs: LEFT_AGENTS_MS });
      else storeRef.current.remove(LEFT_AGENTS_KEY);
    },
    onSecondPress: () => { onOpenAgentsRef.current?.(); },
  }, LEFT_AGENTS_MS, doublePressDeps);
  useEffect(() => () => { leftAgentsArmRef.current!.dispose(); storeRef.current.remove(LEFT_AGENTS_KEY); }, []);
  // CM8: true from the moment the external-edit chord fires until the editor's promise settles. The ref is
  // the one the key path reads (the action fires from a passive-effect listener, so the state is one
  // render stale there — the same reason `stateRef`/`busyRef` exist above); the state drives the render.
  const [editorInFlight, setEditorInFlight] = useState(false);
  const editorInFlightRef = useRef(false);
  // The paint-then-block deferral (see `chat:externalEditor`). Cleared on unmount so a composer that goes
  // away inside the window never spawns an editor onto a terminal it no longer draws.
  const editorPaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (editorPaintTimer.current) clearTimeout(editorPaintTimer.current); }, []);
  const isEmptyNow = state.lines.length === 1 && state.lines[0] === "";

  // WAVE C TASK 4 (EP-C7b), annex §C7.2 — CTRL-C'S CLEAR, arriving from `ChatApp` as a token bump. Upstream's
  // `V` runs `if (e) t(""), B(0), c?.()` on its FIRST press (`clearForInterrupt` is those three calls), and
  // the arm that press also raised lives in `ChatApp` — the two halves are one gesture split across the two
  // components that own the two pieces of state.
  //   The consumed marker is APP-SCOPED (`consumedClearTokenRef`, final review finding 1) for the same reason
  // `prefill`'s is: this component is unmounted by every dialog and its buffer is parked in `editorStateRef`
  // meanwhile, so a bump that lands during a dialog must still find the parked draft on the way back. The
  // local ref below is only the bare-mount fallback, and it keeps the old seed-from-live-token behaviour
  // because with no app above there is no parked draft to speak of. The empty-buffer no-op is upstream's own
  // `if (e)` guard, and it is what makes a Ctrl-C at the home state cost nothing but the arm.
  const localClearTokenRef = useRef(clearDraftToken);
  const lastClearToken = consumedClearTokenRef ?? localClearTokenRef;
  useEffect(() => {
    if (clearDraftToken === undefined || clearDraftToken === lastClearToken.current) return;
    lastClearToken.current = clearDraftToken;
    const s = stateRef.current;
    if (isEmptyBuffer(s)) return;
    commitState(clearForInterrupt(endKillAndYank(s)));
  }, [clearDraftToken]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Rewind's edit-and-resend: a NEW prefill token replaces the buffer wholesale; a re-render with the same
  // token is a no-op. The ChatApp-owned consumed token ref survives every composer replacement, preventing
  // a stale parent prefill from reapplying after the durable editor state has been edited or submitted.
  // onPrefillApplied still clears the parent field, but correctness never depends on that passive render.
  // "prepend" mode (Task 3, CM49 — interrupt() rescuing a queue) MERGES above whatever the user was
  // mid-typing instead of clobbering it; every other prefill (rewind, history-accept — both modeless =
  // replace) keeps the wholesale-replace behavior above.
  const localPrefillTokenRef = useRef(0);
  const lastPrefill = consumedPrefillTokenRef ?? localPrefillTokenRef;
  useEffect(() => {
    if (!prefill || prefill.token === lastPrefill.current) return;
    lastPrefill.current = prefill.token;
    const currentDraft = stateRef.current.lines.join("\n");
    const nextText = prefill.mode === "prepend" && currentDraft.length > 0 ? prefill.text + "\n" + currentDraft : prefill.text;
    if (currentDraft.length === 0 && nextText.length > 0) onDraftStartRef.current?.();
    commitState((s) => {
      const draft = s.lines.join("\n");
      const text = prefill.mode === "prepend" && draft.length > 0 ? prefill.text + "\n" + draft : prefill.text;
      const next = replaceBufferFromOutside(s, text);
      // F5 task 12: a prefill MAY carry paste bodies (the `/history` picker's accept does — upstream's own
      // `x(Wt.pastedContents)` at bundle L496212). Re-minted through the walk's `rebuildChips`, for the
      // reason editorHistory.ts's FRESH CHIP IDS gives: those ids were minted in another session against
      // another counter, and a collision silently expands the older label to the newer payload. The
      // `prepend` arm is unreachable for a paste-bearing prefill today (only CM49's queue rescue prepends,
      // and it carries none), so the relabelled text simply replaces the buffer.
      if (!prefill.pastedContents || Object.keys(prefill.pastedContents).length === 0) return next;
      const built = rebuildChips({ display: text, pastedContents: prefill.pastedContents }, s.pasteCounter);
      return { ...replaceBufferFromOutside(s, built.display), pastedContents: built.pastedContents, pasteCounter: built.pasteCounter };
    });
    onPrefillAppliedRef.current?.();
  }, [prefill]);

  // F2 task 6: the composer is the Chat context's owner and the keymap's FALLBACK — everything the table
  // did not bind lands in `handleKey` below, which is the old `useInput` body verbatim minus the two
  // bespoke chords (the resolver's chord machine owns ctrl+x … now) and minus the ctrl+z guard (the
  // provider consumes ctrl+z pre-table, so it can no longer reach the editor at all). The Chat-context
  // actions route to the SAME function: their bodies were already branches of it, and re-entering through
  // it keeps every arm-cleanup and popup check on one path instead of two that can drift.
  //
  // Autocomplete is pushed AFTER Chat so it outranks it (mount order = registration order) — without it,
  // Chat's `escape → chat:cancel` would steal the popup's own dismissal. It is belt-and-braces rather than
  // load-bearing: `handleKey` re-checks the live popup state from the ref, which is what keeps two keys
  // arriving in ONE chunk (no render in between, so the scope flag is one render stale) correct.
  // ── F6 TASK 5, THE OWNERSHIP GATE. Every registration below is gated on the SAME question
  // `handleKey`/`cancel`/`interceptChord` have always asked of `inputOwnerRef` — only now it is asked once, at
  // render time, and answered by NOT REGISTERING rather than by an early return inside a handler that has
  // already won the key. The difference matters whenever another surface is mounted alongside this one: an
  // early return consumes, so the other surface's keys never arrive.
  //
  // BELT-AND-BRACES, AND UNPINNED (t5 re-review) — do not delete as dead code, and do not call it
  // load-bearing either. Under the t5-fix model (upstream's, bundle L549494) `owns` is provably TRUE whenever
  // this component renders in the settled tree: every owner that isn't "composer"/"typing" unmounts it, the
  // SUPPRESSED state makes composerOwns("typing") true by construction, and in the passive-flush sub-tick the
  // registry's mount-order ranking already favours the newer dialog regardless of this gate (reverting all
  // four gates fails zero of 2258 tests). It stays because it is the truthful expression of a question a
  // DIFFERENT arrangement could make false — the composer is the one component that can be mounted beside
  // another claimant, and T6-T9 keep adding claimants. The {active} mechanism itself is pinned by three
  // keys-provider unit tests; the pins live on the hook, not here.
  //
  // Read during RENDER, exactly like every other registration here: ChatApp writes the ref during its own
  // render, before this child renders, so the value is this frame's truth and not the previous frame's.
  // Undefined ref = a bare mount (tests, a future embed) with nobody else claiming anything: it owns.
  const owns = !inputOwnerRef || composerOwns(inputOwnerRef.current);
  useKeyScope("Chat", { active: owns });
  // Upstream's own predicate is `c.length > 0 || !!Y` (bundle L491072) — a popup with an EMPTY list holds
  // no keys, because it draws nothing (t9 review, I2). Keying this on the state instead meant an `@zz` that
  // matched no file silently ate Up, Down, Tab and Escape.
  useKeyScope("Autocomplete", { active: owns && completionActive(state) });
  // …and CM58's context AFTER both, for the identical reason (mount order = rank): while a search is live it
  // must outrank Chat's `escape → chat:cancel` and Autocomplete's `escape → autocomplete:dismiss`, because
  // upstream's Escape here is `historySearch:accept` — it KEEPS the match and closes the search, and must
  // never reach `cancel()`. Belt-and-braces, exactly like Autocomplete's: `handleKey` and `cancel` both
  // re-read `search.searchingRef` first, which is what covers two keys arriving in ONE stdin chunk.
  //
  // RECORDED DIVERGENCE, and it comes from sharing a context with the picker. Upstream's `HistorySearch`
  // block binds exactly six keys; ours adds `null` unbinds for ctrl+o/t/b/d, alt+p/alt+t and `ctrl+x ctrl+b`
  // (bindings.ts), because until F5 t12 the only surface pushing this context was the OVERLAY — an
  // owner-gated one, where those globals genuinely do not reach. The inline search is composer-owned, so
  // upstream would still let ctrl+o open the pager mid-search and we do not. The table is upstream's on the
  // six keys that matter and the unbinds are a deliberate ccx addition, so they stay: a live search field
  // being interrupted by the todo panel is the worse of the two behaviours. Task 13 carries the note.
  // …and gated on ownership with the other two: a search left live when a decision parks must not outrank the
  // dialog's own Escape/Enter, which `SelectDecision`/`Confirmation` bind to the answer.
  useKeyScope("HistorySearch", { active: owns && search.searching });
  const bindings = useBindingLookup();                 // the footer ladder below reads its chords from here
  const pasting = usePasting();                        // CM25: a bracketed paste still arriving (provider-owned)
  // Read stateRef.current (NOT the closure `state`): the provider dispatches from a listener attached in a
  // passive effect that flushes after commit, so a closure read lags one render and would submit stale text.
  // The ref updates every render.
  const isEmptyBuffer = (s: EditorState) => s.lines.length === 1 && s.lines[0] === "";
  // KB3: EOF needs two presses. Unlike the Esc-Esc clear arm, NO other keystroke disarms this one — that
  // asymmetry is upstream's (`Pee` clears its armed state only on timeout or on the second press) and since
  // Wave C Task 4 it is a property of the shared primitive rather than a rule this site re-states: the ONLY
  // caller of `exitArmRef.current.disarm()` is nobody, and that is the whole point.
  const exitArm = () => {
    if (inputOwnerRef && !composerOwns(inputOwnerRef.current)) return;
    endInterceptedEditorAction(stateRef.current);
    exitArmRef.current!.press();
  };
  // CC's Esc-Esc semantics (CM15): busy always interrupts (buffer untouched); idle with text arms a local
  // double-press clear (pushing the buffer to history on the second press); idle on an EMPTY buffer is
  // forwarded to onInterrupt so ChatApp's rewind-picker arm gets it — the picker is structurally unreachable
  // while text is present, since only the empty branch ever reaches onInterrupt outside the busy case.
  // `cgr` (L317622) — THE persist seam, and now the only path to a paste-cache write in the product. Every
  // failure inside it is swallowed by `appendHistory` itself, and the `CLAUDE_CODE_SKIP_PROMPT_HISTORY` gate
  // wraps the whole thing, cache write included: with it set, nothing this composer does reaches the disk.
  const persistHistory = (entry: { display: string; pastedContents?: EditorState["pastedContents"] }) => {
    appendHistory({ display: entry.display, pastedContents: entry.pastedContents, project: historyProjectRef.current, sessionId: sessionIdRef.current }, historyEnvRef.current);
  };
  const cancel = () => {
    if (inputOwnerRef && !composerOwns(inputOwnerRef.current)) return;
    // CM58 FIRST, and off the ref rather than the render's `search.searching`: an Escape that arrived in the
    // same stdin chunk as the ctrl+r that opened the search resolves against a scope stack one render stale,
    // so it can still land here as `chat:cancel`. It is the ACCEPT (keep the match, close the search) — never
    // an interrupt, never the Esc-Esc clear arm.
    //
    // BELT-AND-BRACES, AND UNPINNED — do not delete it as dead code. In the normal path the `HistorySearch`
    // scope pushed above already resolves Escape to `historySearch:accept`, so this branch never runs and no
    // test fails without it. It exists for the one-render-stale window described above, which the test
    // harness cannot produce (ink-testing-library delivers one chunk per `stdin.write`). It is the same
    // reasoning, and the same lack of a pin, as the live popup re-read in `handleKey` below.
    if (search.searchingRef.current) { search.accept(); return; }
    const s = stateRef.current;
    if (busyRef.current) { endInterceptedEditorAction(s); disarmClear(); onInterruptRef.current?.(); return; }   // running turn: interrupt; buffer untouched
    if (!isEmptyBuffer(s)) {                                            // idle + text: CC's double-press clear (CM15)
      // WAVE C TASK 4: both branches of the old hand-rolled arm collapsed into one `press()` — the primitive
      // decides which one this is. `endInterceptedEditorAction` still runs FIRST, on both, because a kill/yank
      // run ends on any Escape whether it arms or clears.
      endInterceptedEditorAction(s);
      escClearArmRef.current!.press();
      return;
    }
    endInterceptedEditorAction(s); onInterruptRef.current?.();          // idle + empty: ChatApp owns rewind arming
  };
  // CM48 (`Uge`, bundle L495509–L495533). Upstream's whole Up handler is:
  //     if (j4.length > 1) return;                       // a suggestion popup with real choices owns the key
  //     let Wt = te.indexOf("\n"); if (Wt !== -1 && xe > Wt) return;   // caret past the first newline
  //     … if (Cn > 0) { GU(); return; }                  // some entry is editable → DRAIN
  //     Z2();                                            // otherwise walk history
  // Two transcription notes:
  //  · guard (b) is EXACTLY `cursor.row === 0` on our model. An offset can only exceed `lines[0].length`
  //    (which is `te.indexOf("\n")`) by crossing that newline, and crossing it is what row ≥ 1 means; with
  //    no newline at all `Wt === -1` and upstream skips the check, which row 0 also always satisfies.
  //  · upstream RETURNS on a live popup, killing history nav too; ours only declines to DRAIN and lets the
  //    key fall through, because in this port the popup's own ↑/↓ selection lives in the editor reducer
  //    (`onUp` → `moveCommand`/`moveMention`) rather than in a separate component above it.
  const queuePopRef = useRef(queuePop); queuePopRef.current = queuePop;
  const isUpNav = (input: string, key: ReturnType<typeof toKeyFlags>["key"]) =>
    !!key.upArrow || (!!key.ctrl && !key.meta && input === "p");     // ctrl+p IS the onUp body (F5 task 1)
  const tryQueueDrain = (s: EditorState): boolean => {
    const pop = queuePopRef.current;
    if (!pop) return false;
    const items = s.command?.items ?? s.mention?.items;
    if (items && items.length > 1) return false;                    // (a) `j4.length > 1`
    if (s.cursor.row !== 0) return false;                           // (b) `xe > te.indexOf("\n")`
    const popped = pop();
    if (!popped) return false;                                      // `Cn > 0` — nothing editable to hand back
    const drained = applyQueueDrain(s, popped);
    if (bufferText(s).length === 0 && drained.lines.join("\n").length > 0) onDraftStartRef.current?.();
    commitState(drained);
    return true;
  };
  const handleKey = (e: KeyEvent | TextEvent) => {
    if (inputOwnerRef && !composerOwns(inputOwnerRef.current)) return;
    // CM58's search field owns the fallback outright while it is live (divergence 3): the query takes every
    // printable, backspace shortens it — and empties into the cancel — and nothing else reaches the editor.
    // The ref, not the render value, for the one-chunk reason `cancel` above states.
    if (search.searchingRef.current) { search.handleKey(e); return; }
    const { input, key } = toKeyFlags(e);
    const s = stateRef.current;
    // WAVE C TASK 4, annex §C7.8 (L395750) — THE ← AGENTS GESTURE, decided before anything else touches the
    // key because it is the one arm whose own key must not disarm it. Bare `←` only: a modified arrow is a
    // word/line motion, and a live popup owns its own navigation. On a non-empty buffer this is a cursor move
    // and falls straight through, which is also what retires the arm — the `disarm` below fires on every key
    // that is not the gesture itself, so typing one character ends it.
    const leftAgentsGesture = !!key.leftArrow && !key.ctrl && !key.meta && !key.shift && !completionActive(s) && isEmptyBuffer(s);
    if (!key.escape) disarmClear();
    if (!leftAgentsGesture) leftAgentsArmRef.current!.disarm();
    if (leftAgentsGesture) { endInterceptedEditorAction(s); leftAgentsArmRef.current!.press(); return; }
    // WAVE C TASK 12, annex §C5.5 (`F9f`'s handleKeyDown, L491084) — THE TWO ACCEPT KEYS, decided here rather
    // than through the binding table for the reason `?` above is physical: neither key is bound to an action
    // in the Chat context (Tab belongs to `Autocomplete`, Right belongs to the editor's cursor), so this is
    // an interception of what would otherwise fall through, not a competing registration.
    //   The gates are upstream's, in upstream's own order: the buffer must be EMPTY (a Right on text is a
    // cursor move and a Tab on text is the popup's), no autocomplete popup may be live (upstream: "only when
    // there are no autocomplete suggestions"), and no inline ghost text may be offering its own completion.
    //   THE LAST TWO TERMS ARE UNREACHABLE UNDER THE FIRST, and are kept anyway because upstream's clause is
    // equally redundant and this is a transcription: a `/` or `@` popup needs its own trigger character in
    // the buffer and a ghost needs typed text to match against, so both imply a NON-empty buffer, which
    // `isEmptyBuffer` has already excluded. Removing either leaves every test in `suggestion.test.tsx` green
    // — which is why no test here claims to pin them. Shift+Tab is excluded because it is `chat:cycleMode`;
    // a modified Right is a word motion. `endInterceptedEditorAction` first, like every other interception.
    const acceptsSuggestion = (!!key.tab || !!key.rightArrow) && !key.shift && !key.ctrl && !key.meta;
    if (acceptsSuggestion && suggestionRef.current && isEmptyBuffer(s) && !completionActive(s) && !ghostText(s)?.visible) {
      const text = suggestionRef.current;
      const ended = endInterceptedEditorAction(s);
      // `replaceBufferFromOutside` is upstream's `Ft(text)`: whole buffer, cursor at the end — and the mode
      // switch upstream spells out for a `/` or `!` opener comes free, because `inputMode` derives the mode
      // from the buffer's first line rather than holding it as separate state.
      commitState(replaceBufferFromOutside(ended, text));
      onSuggestionAcceptRef.current?.(text);
      return;
    }
    // '?' on a genuinely empty composer (no buffer text, no open '/' or '@' popup) opens the shortcuts
    // overlay; typed anywhere else it must fall through to applyKey and insert a literal '?'. This one stays
    // physical on purpose: `?` is a CHARACTER, bound by no context, and `help:show` — the action a user can
    // put on a key of their own — is ChatApp's registration, not this branch (final review).
    if (input === "?" && !s.command && !s.mention && isEmptyBuffer(s)) { endInterceptedEditorAction(s); onHelpRef.current?.(); return; }
    // NONE of the four table actions this component owns is re-derived from the key here any more. Three of
    // them still were after t10 (`chat:cancel` / `chat:clearInput` / `app:exit`), which quietly made them
    // physical: a user who moved `chat:cancel` to `alt+c` got a footer and an arm hint that both said Alt-C,
    // and a key that did nothing when pressed. Each has its own registration below now, firing on whatever the
    // table resolved — `cancel()` and `exitArm()` above are the same state machines, lifted out of this body
    // unchanged. Bare Tab still belongs to the autocomplete popups alone (CC's Autocomplete context).
    //
    // Escape survives HERE for exactly one route: `autocomplete:dismiss`. That scope is one render stale when
    // a popup closed and Escape arrives in the SAME stdin chunk, and this live re-read of the popup state is
    // what keeps that case correct (the scope ordering above is belt-and-braces). With no popup live, an
    // Escape that resolved as the popup's dismissal is the cancel.
    if (!completionActive(s) && key.escape) { cancel(); return; }
    disarmClear();                                                    // silent when nothing is armed (Task 4)
    // CM48: the queue is asked BEFORE the editor sees the key, so a pending queue always wins Up/ctrl+p over
    // the history walk (upstream's `Uge` reaches `Z2()` only when the queue declined). Both keys route here
    // — ctrl+p is `onUp`'s body in the reducer, so intercepting one and not the other would split them.
    if (isUpNav(input, key) && tryQueueDrain(s)) return;
    // `rows` is passed positionally after `now`, so `now` is given explicitly here — same value the default
    // would have produced. A paste-tagged event is the only consumer (editor.ts's `KeyFlags.paste` arm).
    const r = applyKey(s, input, key, Date.now(), rowsRef.current?.());
    if (key.ctrl && input === "u" && r.killed && r.killed.text.length >= 3) {
      // WAVE C TASK 2: `kill-paste-hint` (annex §C1.6, L395652) — `immediate`, 5000 ms. The queue owns the
      // deadline now, so this site holds no timer of its own; `yankHintMs` became its `timeoutMs`.
      storeRef.current.add({ key: YANK_HINT_KEY, text: YANK_HINT_TEXT, priority: "immediate", timeoutMs: yankHintMsRef.current });
    }
    // CM24, `k0`'s tail (bundle L495753-L495762). Only a chip at or under `lgr` raises the hint, because only
    // one at or under `lgr` can actually be expanded (`bDo`'s cap). An over-cap chip is transcribed to leave
    // any hint already on screen ALONE: upstream's `if (Cn.length <= lgr)` guards the whole `Yg(!0)` +
    // reschedule block, and nothing else touches it.
    //
    // WHAT IS NO LONGER HERE (t7): the CM26 disk write. Task 5 put a `storePaste` call on this line, reading
    // `k0`'s tail as if the cache were a side effect of MINTING a chip. It is not: upstream's only `DUd` call
    // is inside `uu_` (L317608), i.e. inside the history append, gated by the same
    // `CLAUDE_CODE_SKIP_PROMPT_HISTORY` check and reached only for a body over `nu_` that could not be
    // inlined. Writing at creation instead meant every paste a user typed over, undid, or abandoned was on
    // disk at 0600 forever — a privacy leak with no reader, since only a SUBMITTED prompt's line can ever
    // name that hash. The expand gesture is unaffected: `expandRepeatedPaste` compares against the live
    // in-memory map (`s.pastedContents[s.pasteCounter]`), never the cache.
    if (r.paste?.kind === "chip") {
      if (r.paste.content.length <= PASTE_LIMIT) {
        setPasteHint(true);
        if (pasteTimer.current) clearTimeout(pasteTimer.current);              // a fresh chip restarts the window
        pasteTimer.current = setTimeout(() => { setPasteHint(false); pasteTimer.current = null; }, pasteHintMsRef.current);
      }
    } else if (r.paste?.kind === "expand") {
      setPasteHint(false);                                                     // `kne`'s `Yg(!1)` + `lh.current()`
      if (pasteTimer.current) { clearTimeout(pasteTimer.current); pasteTimer.current = null; }
    }
    // CM56 (L489587): `if (te >= 2 && !se && !m.current) m.current = !0, q()`. `te` is the index the Up just
    // moved TO, so the trigger is the SECOND recall of a run and only on the way up — hence the comparison
    // against the index before the key, rather than a bare `>= 2` that a Down onto position 2 would also
    // satisfy. (`!se` is upstream's "entries were supplied by a parent transcript" arm — `On` at L495280 is
    // defined only inside a teammate's composer, so for the top-level chat it is always false.)
    const beforeAt = historyPosition(s)?.index ?? 0, afterAt = historyPosition(r.state)?.index ?? 0;
    if (afterAt >= 2 && afterAt > beforeAt && !searchHintFired.current) {
      searchHintFired.current = true;
      // WAVE C TASK 2: upstream's own placement for this row — `addNotification` (L489537) with `Lli` as its
      // `timeoutMs`, which is exactly what the divergence comment that used to sit in the render below
      // promised. The chord half is still derived (`searchHintRow`), so an unbind still removes the hint.
      if (searchHintRowRef.current !== "") storeRef.current.add({ key: SEARCH_HINT_KEY, text: searchHintRowRef.current, priority: "immediate", timeoutMs: searchHintMsRef.current });
    }
    if (s.lines.length === 1 && s.lines[0] === "" && !(r.state.lines.length === 1 && r.state.lines[0] === "")) onDraftStartRef.current?.();
    if (r.historyAppend) persistHistory(r.historyAppend);
    if (r.submit != null) onSubmitRef.current(r.submit); commitState(r.state);
  };
  submitBufferRef.current = () => handleKey(ENTER);
  // The gate that matters most (F6 t5): the fallback is where every printable character, digit and unbound key
  // lands, and an inline dialog reads its numbered rows and legacy letters through ITS fallback. Inactive here
  // means "not registered", so the dialog's is the innermost live one — `handleKey`'s own owner guard stays as
  // the belt-and-braces half, for a key that arrives in the same stdin chunk as the render that parked.
  useKeyFallback(handleKey, { active: owns });
  // Ctrl-X Ctrl-K (CC chat:killAgents) and Ctrl-G / Ctrl-X Ctrl-E (chat:externalEditor) are the two keys
  // whose GATE moved into the resolver: the chord machine decides whether ctrl+k is the editor's
  // kill-to-end or the agent kill, so these handlers only fire when the chord already completed. Each still
  // ends a kill/yank run and drops an armed Esc-clear, which the swallowed ctrl+x prefix used to do.
  const interceptChord = (): EditorState | null => {
    if (inputOwnerRef && !composerOwns(inputOwnerRef.current)) return null;
    const s = stateRef.current;
    disarmClear();                                                    // silent when nothing is armed (Task 4)
    return endInterceptedEditorAction(s);
  };
  useKeyActions({
    // A popup owns its own dismissal; with none live this IS the cancel (see `cancel()` and the note in
    // `handleKey`). The event is only consulted for that one question, never for which action fired.
    "chat:cancel": (e) => { if (completionActive(stateRef.current)) { handleKey(e); return; } cancel(); },
    // The ONE action here whose operation lives in the editor reducer (editor.ts's `clearInput`, reachable
    // only through `applyKey`'s ctrl+l case). So it re-enters `handleKey` on the event ctrl+l would have
    // produced rather than on the key that fired: under the default binding that IS the event, byte for byte,
    // and a rebound key now reaches the same branch with the same kill-run and arm bookkeeping instead of
    // being handed to the reducer as a chord it has never heard of.
    "chat:clearInput": () => handleKey(CTRL_L),
    // The action means EXIT, and this key only means exit on an empty composer (KB3). With text there is no
    // exit to run: under the default binding the key is the editor's own ctrl+d (delete-forward), so the
    // event goes back to `handleKey` and the reducer decides — a rebound key lands there too and, being
    // unknown to it, does nothing, which is the truth. `disarmClear` is `handleKey`'s own preamble, kept for
    // the one branch that now bypasses it.
    "app:exit": (e) => {
      if (!isEmptyBuffer(stateRef.current)) { handleKey(e); return; }
      // Ownership FIRST (final-fix re-review): a non-owning composer must not disarm its Esc-clear or
      // setState at all — reachable only via a user rebind of app:exit to a key no overlay context nulls.
      if (inputOwnerRef && !composerOwns(inputOwnerRef.current)) return;
      disarmClear();                                                    // silent when nothing is armed (Task 4)
      exitArm();
    },
    // Fires on the RESOLVED action, not on a re-read of the key's flags — so `alt+m` in a user's
    // keybindings.json cycles the ladder exactly as shift+tab does, which is what makes the derived hint
    // beside it true. `interceptChord()` is the same owner-guard + kill-run/arm cleanup `handleKey` ran.
    "chat:cycleMode": () => { if (interceptChord()) onCycleModeRef.current?.(); },
    "autocomplete:dismiss": handleKey, "autocomplete:accept": handleKey,
    // ── CM58's six keys. `history:search` is a GLOBAL-context action registered HERE and no longer in
    // ChatApp: upstream's own registration lives in this hook (`Mn("history:search", B, {context:"Global"})`,
    // bundle L489752), and the consequence is the right one — with the composer unmounted behind a dialog
    // there is no buffer to search into, so ctrl+r does nothing at all instead of opening a surface over the
    // dialog. `interceptChord()` is the same owner-guard + kill-run/Esc-arm cleanup every other chord runs.
    "history:search": () => { if (interceptChord()) search.open(); },
    "historySearch:next": () => search.next(),
    "historySearch:accept": () => search.accept(),
    "historySearch:cancel": () => search.cancel(),
    "historySearch:execute": () => search.execute(),
    // NOT registered: `historySearch:cycleScope`. `r9f`'s action memo (bundle L489750) has exactly four
    // entries and that is not one of them — only the picker registers it (L492190), because only the picker
    // has a scope. ctrl+s therefore resolves to an action with no handler, falls through to the fallback
    // below, and `search.handleKey` drops it (a ctrl key is not query text). An inert ctrl+s inside the
    // inline search IS upstream's behaviour, and it costs nothing to reproduce.
    "chat:killAgents": () => { if (interceptChord()) onKillAgentsRef.current?.(); },
    // K6 (F2 task 10): `"ctrl+k": "command:clear"` in the user's keybindings.json runs `/clear` exactly as if
    // it had been typed here — same submit seam, so local commands, catalog commands and the unknown-name
    // notice all behave identically to typing them. The buffer is deliberately left alone: the key ran a
    // command, it did not send what the user was drafting. Registered as the `command:` FAMILY because the
    // name comes from the user's file; without it the resolver consumed the key and nothing ran it.
    "command:*": (_e, action) => { if (interceptChord()) onSubmitRef.current("/" + action.slice("command:".length)); },
    // CM8, PAINT-THEN-BLOCK (F5 real-TTY fix). T2 shipped this as an awaited `editExternalAsync` so the
    // `Save and close editor to continue...` row could paint; on a real terminal that deterministically
    // BRICKED the app — the editor restores the shared open file description to blocking on exit, a live
    // libuv tty watcher then `read()`s it, and the main thread parks forever (full diagnosis on
    // `restoreTtyNonblock` in externalEditor.ts). Upstream's spawnSync (bundle L317767/L317708) is
    // load-bearing: a frozen event loop cannot have a watcher fire mid-edit. So we are back on the sync
    // editor, and we buy the in-flight row a different way — set the state, hand control back so Ink can
    // COMMIT AND FLUSH the frame, and only then block. The row stays frozen on screen for the whole edit,
    // which is exactly what upstream shows. `Promise.resolve` still normalizes an injected async editor (the
    // DI shape the tests use) onto the same path. `editorInFlight` is what the render below swaps out for.
    "chat:externalEditor": () => {
      const ended = interceptChord();
      if (!ended || editorInFlightRef.current) return;               // a second chord mid-edit is a no-op
      // …and the popup goes FIRST (M1 review, finding 2). The `editorInFlight` early return below draws no
      // popup, but the state that says one is showing survived the flight — so the app went on holding
      // `popupHeight(rows)` back from the live window for the whole edit, and when the editor exits non-zero
      // `done` returns before any `commitState`, which left it held until the next keystroke. Closed through
      // `commitState` — the one writer — so the `false` report rides with it, in this same stdin handler and
      // before the flag that swaps the composer out.
      if (ended.command || ended.mention) commitState({ ...ended, command: null, mention: null });
      editorInFlightRef.current = true; setEditorInFlight(true);
      const done = (edited: string | null) => {
        if (disposed.current) return;
        editorInFlightRef.current = false; setEditorInFlight(false);
        // Clear any open mention/command popup too — it was filtered against the pre-edit buffer and would
        // otherwise show stale items against the freshly-applied text.
        if (edited === null) return;                                 // editor errored / exited non-zero: keep the buffer
        if (ended.lines.length === 1 && ended.lines[0] === "" && edited.length > 0) onDraftStartRef.current?.();
        commitState(replaceBufferFromOutside(ended, edited));
      };
      // …and the whole flight runs INSIDE the keymap's terminal handoff (t2 review, Important): the child is
      // spawned with stdio "inherit", so while it runs, fd 0 belongs to it and not to us. Without the handoff
      // our still-flowing `data` listener raced the editor for its keystrokes and a stolen `\r` submitted the
      // turn mid-edit. `suspendInput` restores raw mode in a `finally`, so both arms below are covered.
      const run = () => Promise.resolve((editExternalRef.current ?? realEditExternal)(ended.lines.join("\n")));
      const suspend = suspendInputRef.current;
      // THE DEFERRAL, and why it is a timer and not a microtask. React has not committed this setState yet,
      // and Ink's own render is throttled (ink/build/ink.js:39, `throttle(this.onRender, 32, {leading,
      // trailing})`) — a frame produced within 32ms of the previous one is only written on the TRAILING
      // edge. A microtask (or a 0ms timer) can therefore run before the bytes reach the terminal, and the
      // block would freeze a frame the user never saw. EDITOR_PAINT_MS clears that window. The cost is one
      // throttle-window of latency before the editor opens — imperceptible, and the price of the row.
      if (editorPaintTimer.current) clearTimeout(editorPaintTimer.current);
      editorPaintTimer.current = setTimeout(() => {
        editorPaintTimer.current = null;
        // `suspendInput` still wraps the whole thing, and still does the right thing for a SYNC fn: its
        // raw-mode release / stdin.pause / ?2004 disable all run BEFORE `fn()` is invoked, and its `finally`
        // runs after the block returns. A rejection is the same outcome as a null — the buffer stands and
        // the in-flight row must lift, or the composer is stuck showing "Save and close editor…" forever.
        (suspend ? suspend(run) : run()).then(done, () => done(null));
      }, EDITOR_PAINT_MS);
    },
  });

  // ── CM39/CM40: the @-mention walk (F5 task 11). The composer's one filesystem side effect, and since this
  // task an ASYNC, debounced, generation-guarded one that re-roots as the user descends.
  //
  // WHAT SCHEDULES A WALK, and why it is the root rather than the query. Upstream calls `Ae(query)` on every
  // recompute and its debounce restarts each time, because upstream's search IS the filter — `Tcn` re-queries
  // the whole file index per keystroke. Here the two halves are already separate: the WALK depends only on the
  // directory the query names (`mentionWalkRoot`), and the RANKING is pure and lives in the reducer
  // (`withMention` re-ranks the carried `files` on every scan, for free). So the debounce guards the only
  // thing that touches the disk, and a keystroke that narrows the query inside one directory re-ranks with no
  // walk at all — which is also why `@src` → Tab → `@src/` reads `src` instead of re-reading the whole tree.
  //
  // WHY IT IS AN EFFECT WITH A CLEARTIMEOUT CLEANUP. That is `Dee` (bundle L182690) verbatim: a new root
  // cancels the pending timer and reschedules; there is no leading edge, so the first walk waits the window
  // too. While it waits, `mention.files` is empty, the popup has no items and NOTHING is drawn — upstream has
  // no loading state at this site either (its file rows simply appear when the results land).
  //
  // THE GENERATION GUARD. `walkGen` is bumped at the top of EVERY run, including the two early returns, so any
  // walk still in flight is invalidated the moment its premise changes — a resolution that loses the race is
  // dropped instead of repainting the list under a query it does not belong to. Upstream's version is a
  // last-query token re-checked after each await (`if (oe.current !== mt) return`, L490566/L490574); a counter
  // subsumes it, since it also invalidates a walk whose root came back around to the same string.
  //
  // `walkedRoot` is the last root whose results actually LANDED. Skipping a re-walk on a match is what makes
  // backspacing across a level free, and resetting it to null when the popup closes is what makes the next `@`
  // walk again (a closed mention drops its `files`, so they must be refetched).
  const walkRoot = state.mention ? mentionWalkRoot(state.mention.query) : null;
  const walkedRoot = useRef<string | null>(null);
  const walkGen = useRef(0);
  const mentionWalkMsRef = useRef(mentionWalkMs); mentionWalkMsRef.current = mentionWalkMs;
  const mentionReaddirRef = useRef(mentionReaddir); mentionReaddirRef.current = mentionReaddir;
  useEffect(() => {
    const gen = ++walkGen.current;
    if (walkRoot === null) { walkedRoot.current = null; return; }
    if (walkedRoot.current === walkRoot) return;
    const timer = setTimeout(() => {
      void (async () => {
        const entries = await collectEntries(cwd, mentionReaddirRef.current ?? realReaddir, { root: walkRoot });
        if (disposed.current || gen !== walkGen.current) return;
        walkedRoot.current = walkRoot;
        commitState((s) => setMentionFiles(s, entries.map((e) => e.path)));
      })();
    }, mentionWalkMsRef.current);
    return () => clearTimeout(timer);
  }, [walkRoot, cwd]);

  // First time a command popup opens with an empty catalog, feed in the live catalog (mirrors the mention walk).
  const needCatalog = state.command != null && state.command.catalog.length === 0 && commandCatalog.length > 0;
  useEffect(() => {
    if (!needCatalog) return;
    if (!disposed.current) commitState((s) => setCommandCatalog(s, commandCatalog));
  }, [needCatalog, commandCatalog]);

  // ── CM47/CM3, the placeholder (F5 task 8). Upstream memoizes the `Try "…"` draw once per PROCESS (`Vr` is
  // lodash `memoize`, L495093) and re-evaluates the LADDER on every render (`NVf`'s useMemo, L495109). Both
  // halves are kept: the random draws are frozen so the sentence never changes under the user, while the
  // ladder itself is computed below on each render so a prompt queued mid-session promotes rule 3.
  //
  // The frozen pick lives in an APP-SCOPED ref — the third thing in this component to need that lifetime,
  // after CM56's `searchHintFiredRef` and task 8's own `queueHintCountedRef`, and for the identical reason:
  // this composer is unmounted and remounted behind every dialog, so a component-local freeze thaws on the
  // way back. Concretely, opening `?` help and pressing Escape re-rolled the suggestion — a per-MOUNT pick
  // where upstream's is per-PROCESS. The local fallback keeps a bare test render self-contained.
  // BOTH inputs to the draw are memoized there, not just the random numbers: the pool an index lands in is
  // built from the example-file CACHE, and the harvest can write that cache mid-session, so freezing only
  // the numbers would still let a remount put the same index into a different pool. `files` is resolved once
  // into the same record. Together they are what `Vr` memoizes upstream — `MVf`'s whole body, its
  // `Cd().exampleFiles` read included. (The composer only READS that cache; filling it, `DVf` L495100, is a
  // once-per-process side effect that shells out to git and lives in `chatMain.tsx` — see divergence 4.)
  const localMemoRef = useRef<PlaceholderMemo>({ draws: [] });
  const memo = placeholderMemoRef ?? localMemoRef;
  if (memo.current.files === undefined) memo.current.files = cachedExampleFiles(historyEnvRef.current);
  const drawIndex = useRef(0); drawIndex.current = 0;
  const stableRand = () => { const d = memo.current.draws, i = drawIndex.current++; if (d[i] === undefined) d[i] = Math.random(); return d[i]; };
  // Read ONCE at mount, not per render: upstream's `Ct()` is a cached in-memory config and ours is a file, so
  // consulting it inside the ladder meant a disk read on every keystroke. The value only has to be right for
  // the session anyway — the increment below is what the NEXT session reads.
  const [upHintSessions] = useState(() => loadPrefs(historyEnvRef.current).queuedUpHintSessions ?? 0);
  // W-C T12, annex §C5.4's `b9` (L495702): `_ === "prompt" && j4.length === 0 && as && !er` — prompt mode, an
  // empty buffer, a suggestion to show, and no turn running. The `as` term is the caller's (`suggestion`
  // non-null); this component owns the other three. Upstream's `"prompt"` is `normal` in this port's own
  // vocabulary (`promptMode.ts`: bash | normal — the same two upstream has, `normal` being its `prompt`);
  // on an empty buffer it can be nothing else, so the term is transcription rather than a live gate. Computed
  // through `inputMode(state)` and not the `mode` const below only because that one is declared further down.
  const canShowSuggestion = isEmptyNow && !busy && inputMode(state) === "normal";
  const placeholder = pickPlaceholder({
    inputEmpty: isEmptyNow, queueHasEditable: !!queueHasEditable, upHintSessions,
    submitCount, hasMessages, suggestionEnabled,
    suggestion: canShowSuggestion ? suggestion : null,
    pool: examplePool(memo.current.files ?? [], stableRand), rand: stableRand,
  });
  // …and the same fact REPORTED UP, because the two transitions it drives (`generated` → `shown`, and the
  // `timing` discard of a suggestion that arrived too late) belong to the slice, which lives one level up.
  // In an effect — a parent setState during render is illegal — and keyed on the SUGGESTION as well as on the
  // slot: a suggestion landing while the buffer is already non-empty never changes `canShowSuggestion`, and
  // without that dependency it would sit in `generated` forever instead of being discarded on arrival, which
  // is what upstream's per-render check does (L495704).
  const onSuggestionSlotRef = useRef(onSuggestionSlot); onSuggestionSlotRef.current = onSuggestionSlot;
  useEffect(() => { onSuggestionSlotRef.current?.(canShowSuggestion); }, [canShowSuggestion, suggestion]);
  // Divergence 2 (placeholder.ts): upstream never writes `queuedCommandUpHintCount`, so its own `< 3` gate
  // can never close. Ours counts a SESSION that showed the hint, once, which is the reading that makes `LNb`
  // mean something. In an effect, not in render: it is a disk write.
  //
  // The once-flag is APP-scoped for the same reason CM56's `searchHintFiredRef` above is: this composer is
  // unmounted and remounted behind every dialog, so a component-local ref would re-arm after each permission
  // prompt and burn all three sessions' worth of hint inside one session. The local fallback keeps a bare
  // test render — and any future standalone mount — counting per mount, which is what a fresh app would do.
  const hintShown = placeholder === QUEUED_UP_HINT;
  const localHintCountedRef = useRef(false);
  const hintCounted = queueHintCountedRef ?? localHintCountedRef;
  useEffect(() => {
    if (!hintShown || hintCounted.current) return;
    hintCounted.current = true;
    const env = historyEnvRef.current;
    // BEST-EFFORT, and it has to be: `savePrefs` is mkdir + write and it THROWS on a root it cannot write
    // (read-only home, a `~/.claude` that is a file, a full disk). This is an EFFECT — an uncaught throw here
    // leaves React's commit and takes the whole REPL down, for a hint counter. Same swallow, same reason, as
    // placeholder.ts's example-file cache and `appendHistory`'s own (final review, P2).
    try { savePrefs({ queuedUpHintSessions: (loadPrefs(env).queuedUpHintSessions ?? 0) + 1 }, env); } catch { /* prefs are best-effort */ }
  }, [hintShown]);
  const mode = inputMode(state);
  const borderToken = borderTokenFor(mode);
  const cols = Math.max(1, Math.floor(columns?.() ?? DEFAULT_COLUMNS));
  // CM30's height is `f(rows)` (see `popupHeight`), read the same per-render way `columns` is so a resize
  // reaches the popup on the very next frame.
  const termRows = Math.max(1, Math.floor(rows?.() ?? DEFAULT_ROWS));
  const suggest = suggestProps(state, historyEnvRef.current);
  const popupShown = popupDrawn(state);
  const ghost = ghostText(state);
  const argHint = commandArgumentHint(bufferText(state), commandCatalog);
  // WAVE C TASK 2 — THE HINT STACK IS GONE, AND WITH IT `showFooter`. Ten of the eleven rows this component
  // used to paint below its frame are now the ONE footer row `ChatApp` mounts (`Footer.tsx`) plus the ONE
  // overlay row above the frame (the notification queue). What survives here is `InlineSearchRow`, which
  // upstream also keeps beside the footer content rather than above it (annex §C1.2, `RMr`) — see the
  // `searching` note in `Footer.tsx`'s header for why it stays one row up in ccx.
  //
  // TWO DELIBERATE DELETIONS, recorded per plan constraint 12 because neither is a migration:
  //  · HINT ROW 1 — `⏎ send · <newline rung> · @ files · / commands · ! bash · <cycle> mode[ · ? help]`.
  //    Upstream's home-state footer has NO such row; its affordances live behind `? for shortcuts` (annex
  //    §C4.c's canonical `⏸ manual mode on · ? for shortcuts · ← for agents`). It was a ccx invention and the
  //    single biggest reason the block changed height as the user typed. Its content is not lost: every rung
  //    of it is a row of the `?` shortcuts grid, which is exactly what the surviving hint points at. The
  //    newline ladder (`newlineHint`) still renders there — `keys/hints.ts`'s `ladder` cell.
  //  · HINT ROW 2 — the persistent `esc rewind · ? help` / `esc clear` / `esc interrupt` line, together with
  //    the double-press arm above it (`esc again to clear`). Upstream carries none of them as a persistent
  //    row: `esc to interrupt` is a HINT-LIST member while a turn runs (`footerModel.buildHintList`, which
  //    does render it), and `Esc again to clear` is a QUEUE entry (`escape-again-to-clear`, immediate/1000 ms,
  //    annex §C1.6) — which Wave C Task 4 wired: the `clearVisible` effect below posts it, and ChatApp's
  //    rewind arm posts its own on `escape-again-to-rewind`. Neither is a persistent row any more.
  //
  //  · HINT ROW 3 — `# memory — appends a note to CLAUDE.md`. It went with rows 1 and 2 above, and Wave C
  //    Task 14 then removed the MODE it advertised (spec owner-decision): a ccx extra with no upstream
  //    counterpart at 2.1.220 or 2.1.222, whose whole cost was a special case in every keymap, footer and
  //    hint decision. There was never an upstream footer state to migrate it into, and now there is nothing
  //    left to migrate — a `#` line is an ordinary prompt.
  //
  // `owns` is still read below, for the ownership half of the same honesty rule: it is what tells `ChatApp`
  // whether the footer may advertise a Chat-context chord.
  // F2 task 10: every chord this component prints comes from the LIVE table, not from literals typed here —
  // rebind app:exit and the arm follows it; unbind it and it says `(unbound)` rather than promising a dead key.
  const exitKey = formatBindings(bindings("app:exit"));                 // the KB3 double-press arm, now a FOOTER state
  const escKey = formatBindings(bindings("chat:cancel"));
  // WAVE C TASK 2 — the Esc-Esc arm's feedback moved from a hint ROW to the QUEUE, which is upstream's own
  // placement for it (`escape-again-to-clear`, `immediate`, annex §C1.6). Not a deletion and not an
  // invention: the string is the same derived one the row printed, so it appears and expires exactly when it
  // did.
  //   WAVE C TASK 4 rebuilt the arm on `keys/doublePress.ts` and put upstream's own `timeoutMs` on the entry
  // (`ESC_CLEAR_HINT_MS`, which is NOT the arm window — see that constant for the 200 ms divergence). The
  // `clearArm.current !== 0` term went with the hand-rolled timestamp ref; `!busy` stays, and it is what
  // covers the first busy render on its own now that there is no ref to invalidate during it.
  //   THE UNMOUNT REMOVAL IS NOT BELT-AND-BRACES. This component is unmounted by every dialog, and the store
  // it posts to is the APP's, so an arm live at that moment would leave its hint on screen over the dialog for
  // up to a second with nothing left to retract it.
  const clearVisible = clearArmed && !busy;
  useEffect(() => {
    if (clearVisible) storeRef.current.add({ key: ESC_CLEAR_KEY, text: `${escKey} again to clear`, priority: "immediate", timeoutMs: ESC_CLEAR_HINT_MS });
    else storeRef.current.remove(ESC_CLEAR_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearVisible, escKey]);
  useEffect(() => () => { storeRef.current.remove(ESC_CLEAR_KEY); }, []);
  // CM56's chord, DERIVED — `(ctrl+r to search history)` under the defaults, `` when `history:search` is
  // unbound (`expandHintText`'s own three-state contract), never a literal. Read by `handleKey` through
  // `searchHintRowRef` when it posts the hint to the queue.
  const searchHintRow = expandHintText(bindings("history:search"), process.platform, HISTORY_SEARCH_HINT);
  searchHintRowRef.current = searchHintRow;
  // CM4: the live walk position owns the top rule. The `label` prop stays as the fallback slot Task 2 built —
  // nothing else writes it today, and a caller that does should not be silently overridden while idle.
  const ruleLabel = historyLabel(state) ?? label;
  // WAVE C TASK 2 — the footer's composer-owned half, reported UP. An effect and not a render-time call: a
  // parent setState during render is illegal, and the one frame it costs is invisible next to Ink's own 32 ms
  // throttle. The cleanup fires the IDLE value, so a dialog that unmounts this component cannot leave a stale
  // `Pasting…` or exit arm on the footer row.
  const footerState: ComposerFooterState = {
    searching: search.searching, pasting, pasteExpandHint: pasteHint, bashMode: mode === "bash",
    ...(dArmed && isEmptyNow ? { exitArm: { key: exitKey, verb: "exit" } } : {}),
  };
  const onFooterStateRef = useRef(onFooterState); onFooterStateRef.current = onFooterState;
  useEffect(() => { onFooterStateRef.current?.(footerState); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [footerState.searching, footerState.pasting, footerState.pasteExpandHint, footerState.bashMode, footerState.exitArm?.key, footerState.exitArm?.verb, owns]);
  useEffect(() => () => { onFooterStateRef.current?.(IDLE_COMPOSER_FOOTER_STATE); }, []);
  // …and the popup goes with it. A dialog unmounting this component while a list was up would otherwise leave
  // the app holding rows back for a region that is no longer on screen — for the rest of the session.
  useEffect(() => () => { onSuggestOpenRef.current?.(false); }, []);
  // ── D10 (bundle 456219-456226 `rCn`, mounted at 455945) — THE PALETTE, PUBLISHED RATHER THAN PAINTED ────
  // In fullscreen the popup belongs above the dock, in a band this component is not in. `paletteSlot` is the
  // seam (its header carries the argument); the element is built here because everything it needs — the
  // matches, the selection, the catalog's name column — is this component's editor state and leaves it
  // nowhere else. `null` on the classic arm and whenever nothing is drawn, which withdraws the slot.
  //   ABOVE the `editorInFlight` early return, like every other hook, so the hook order is unconditional —
  // and the effect's cleanup is what takes the palette down when a dialog unmounts us mid-list.
  //   AND IT IS THE OVERLAY POPUP, NOT THE INLINE ONE. `rCn` hands `DXe` `overlay: !0, noPad: !0` (L456226) and
  // the two together are what make a floating palette affordable: five rows flat (`s0H`, L432478) instead of
  // `popupHeight(rows)`, and no blank padding under the last match. Here they are not a nicety — the slot is IN
  // FLOW, so canon's padding would charge the transcript twelve rows at a 24-row pane to show one command. The
  // inline arm below passes neither and is unchanged.
  const hoisted = fullscreen && popupShown && suggest
    ? <SuggestPopup {...suggest} columns={cols} rows={termRows} overlay noPad />
    : null;
  usePaletteHoist(hoisted);
  // ── F9 T-MOUSE TASK 4 — CLICK-TO-CARET'S ORIGIN ───────────────────────────────────────────────────────────
  // `leftInset`: the columns `PromptGlyph` reserves as its own flex sibling (a fixed `❯\xa0`/`!\xa0`, 2 cols —
  // measured rather than hardcoded, since `promptGlyph`'s two arms are the same width by construction but
  // nothing enforces it staying that way). `ComposerFrame` has no left/right border and no padding (its own
  // header: two bare horizontal rules, nothing else), so `cols` IS the row's full width and `innerWidth` is
  // exactly what `renderBuffer`'s per-line `<Text>` has left to paint into.
  const leftInset = stringWidth(POINTER + NBSP);
  const innerWidth = Math.max(1, cols - leftInset);
  // `bufferTopRow`: `useDockTop()` (the dock's own first row, published the same computed-constant way
  // `RegionTopContext` is) plus the rows THIS component paints above line 0 of the buffer — the
  // `waitingForPermission` box (`marginTop:1` + one text row, upstream L496241, present exactly while the
  // composer is still clickable per `composerOwns("typing")`) and `ComposerFrame`'s own top rule. The
  // notification overlay row is NOT counted: it renders only in classic (`fullscreen ||`, above), so it is
  // always absent on this path. `0` — not addressable — off `fullscreen` or wherever `useDockTop` itself
  // answers `0` (classic, or no `FullscreenFrame` above at all, e.g. a bare component test).
  //   FAIL SAFE UNDER A DOCK CO-OCCUPANT (task review Critical, fix round). `useDockTop()` answers the
  // DOCK BAND's first row, not the composer's — whenever a `TaskPanel`, the live-turn spinner/retry/
  // compaction row, or a hoisted suggestion palette paints above the composer inside `dock` (ChatApp.tsx),
  // the composer's TRUE screen row is that published row plus however many rows the earlier occupant took,
  // which this arithmetic cannot see (`ChatApp` builds `dock`; each occupant's own painted height is that
  // occupant's business, not threaded through). Measured: `FullscreenFrame`'s region does self-correct by
  // shrinking to absorb SOME of a taller dock, but only up to its own floor — once the dock outgrows what
  // the region still has to give back (a live turn plus a multi-line draft is enough), `dockTop` goes stale
  // and a click resolves against a DIFFERENT, still-valid logical line rather than failing safe.
  //   `dockCrowded` is that "another occupant is above me" fact, threaded from `ChatApp` (the palette is the
  // one exception — `hoisted` below already answers it locally, so it isn't duplicated as a prop). ORIGIN
  // GOES NOT-ADDRESSABLE (0) rather than attempting the arithmetic anyway — the same "computed constant,
  // degrade to 0" contract `RegionTopContext`'s own header states, which the pre-fix code claimed to follow
  // and did not hold to in this one case. THE COST, recorded: canon repositions the caret correctly during a
  // busy turn or an open task panel (occupant-height accounting, R1 §2.6's general case); ccx v1 defers that
  // and a click during those states is simply refused rather than silently wrong — the follow-up is threading
  // each occupant's own painted row count into this arithmetic instead of a single crowded/not flag.
  const dockTop = useDockTop();
  const originExact = fullscreen && dockTop > 0 && !dockCrowded && !hoisted;
  const bufferTopRow = originExact ? dockTop + (waitingForPermission ? 2 : 0) + 1 : 0;
  const caretAt = useCallback((col: number, row: number): boolean => {
    if (bufferTopRow <= 0) return false;
    const found = caretFromLocalPosition(stateRef.current.lines, innerWidth, row - bufferTopRow, col - leftInset);
    if (!found) return false;
    commitState((s) => ({ ...s, cursor: found }));
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferTopRow, innerWidth, leftInset]);
  useImperativeHandle(originRef, () => ({ caretAt }), [caretAt]);
  // CM8's early return, upstream's own shape (L496236): while the editor holds the terminal the composer
  // is JUST the framed literal — no glyph, no input, and none of the hint rows below, because upstream
  // returns before it builds any of them. Placed after every hook so the hook order is unconditional.
  if (editorInFlight) return <ComposerEditorInFlight columns={cols} borderToken={borderToken} />;
  return (
    <Box flexDirection="column">
      {/* Upstream L496241, byte-exact and in upstream's own slot: `oe && <Box marginTop={1} marginLeft={2}>
          <Text dimColor>Waiting for permission…</Text></Box>`, ABOVE the input frame (`zge`) — the visible face
          of a decision this draft is suppressing. `oe` is the `hasSuppressedDialogs` prop; ours is the same
          fact under the same name, and it is a PROP rather than a read of `inputOwnerRef` so a bare composer
          mount can be driven into this state without an owner ref. marginLeft 2, not the paddingX 1 the hint
          rows below use: those are ours, this one is transcribed. */}
      {waitingForPermission ? <Box marginTop={1} marginLeft={2}><Text dimColor>{WAITING_FOR_PERMISSION}</Text></Box> : null}
      {/* WAVE C TASK 2 (EP-C1a/b) — THE NOTIFICATION OVERLAY, and the one place this task diverged from the
          annex on MEASURED evidence rather than on preference.
            Upstream's slot is an ABSOLUTELY-POSITIONED row (L496241): `position:"absolute", marginTop:-1,
          width:"100%", paddingLeft:2, paddingRight:1, overflow:"hidden"`, height collapsing to 0 — it paints
          into the blank line above the composer's top rule and displaces nothing. `src/tui/` had zero uses of
          Ink's `position:"absolute"`, so the plan required it be measured before anything was built on it
          (the Wave R rule: geometry is settled by measurement). It was, in BOTH instruments the plan named:
            · ink-testing-library, Ink 5.2.1 — right-flush ✓, no flow displacement ✓ (5 frame lines with and
              without the overlay), zero height when empty ✓;
            · a real pty at 100×20 through the same minimal tree — identical on all three.
          BUT the same measurement found the disqualifying case. `marginTop:-1` puts the row one line ABOVE the
          parent's flow position, and when that line is outside the dynamic output — the very first row of the
          frame, or a row belonging to Ink's `<Static>` region — **the notification is silently dropped and
          renders nowhere**. Both probes reproduce it. That is not an edge case for ccx: on a fresh session the
          transcript's pending/streaming region, the task panel, the spinner and the queue echo are all empty,
          so the composer IS the first row of the dynamic frame, and every hint posted at the home state would
          vanish. (Upstream is safe from it because its composer block reserves the blank row the overlay
          lands in.)
            So this is the plan's own sanctioned fallback: a NORMAL IN-FLOW ROW, right-flushed, that renders
          only while a notification is live and costs no line when it is not. `NotificationSlot` returns null
          when empty, so nothing is mounted in the idle state and the block is exactly as tall as it was. The
          visible difference from upstream is one row of vertical position while a hint is up. */}
      {/*   D11 (bundle L494644, `Utl = LRn ? null : jsx(zRr, …)`) — and it is the WHOLE block that goes, not a
            filtered version of it: in a fixed frame this row appears and disappears under a dock that cannot
            reflow, which is the same shove D1 exists to prevent one row down.
              THE IMMEDIATE RANK IS NOT LOST WITH IT (FSW T14, amendment 1). Canon can afford the clean cut
            because its `v` escape lives on a transcript screen with its own hint row; ccx's posts
            `wrote <file>` at `priority:"immediate"` and this slot was its only reader, so suppressing here
            without a destination would make the keystroke silent. The destination is `Footer`'s right region
            — canon's own `Wtl` notifications slot (L494681), which costs no row because it shares the mode
            row. `footerNotice` is the predicate; everything below immediate simply does not draw in
            fullscreen, which is canon's behaviour for all of them. */}
      {fullscreen || !notice ? null : <Box width={cols} paddingLeft={2} paddingRight={1} flexDirection="row" justifyContent="flex-end" overflow="hidden"><NotificationSlot notification={notice} /></Box>}
      <ComposerFrame columns={cols} borderToken={borderToken} label={ruleLabel}>
        <PromptGlyph mode={mode} busy={busy} />
        {/* CM5 (`t_p`, L395963): an empty buffer paints the PLACEHOLDER with its first character inverted —
            that inversion is the cursor. With no placeholder to show (the ladder's "otherwise none" arm) the
            same component degrades to the one inverted space upstream's `i(" ")` branch paints. */}
        {isEmptyNow
          ? <PlaceholderCursor text={placeholder ?? ""} />
          : <Box flexDirection="column">{renderBuffer(state, ghost?.visible ? ghost.suffix : null, argHint)}</Box>}
      </ComposerFrame>
      {/* `xMr && <Mel …>` (L493783). The ONE survivor of the old hint stack: upstream renders it as the first
          child of the footer ROW (annex §C1.2); ccx keeps it here, one line up, because the search query and
          its failed-match flag live in this component's hook — see `Footer.tsx`'s divergence 4. */}
      {search.searching ? <InlineSearchRow query={search.query} failed={search.failed} /> : null}
      {/* The GATE is `popupDrawn`, not `suggest !== null`, and the two differ: an `@zz` that matches nothing
          produces a `suggest` whose list is empty and whose message is absent, and `SuggestPopup` draws
          nothing for it. That difference is now load-bearing rather than cosmetic — `ChatApp` subtracts
          `popupHeight(rows)` from the live window on exactly this predicate, so mounting the component on a
          weaker one would hold rows back for a region nobody can see.
          D10: in fullscreen this slot is EMPTY and the same element is published to the band above the dock
          instead (`hoisted` above) — canon renders the inline box only under `Ptl && !LRn` (L494609). */}
      {fullscreen ? null : popupShown && suggest ? <SuggestPopup {...suggest} columns={cols} rows={termRows} /> : null}
    </Box>
  );
}
