// tui/src/ChatApp.tsx — composes the transcript, any decision dialog (drawn in the transcript FLOW, upstream's
// `layout:"inline"`, except exit-plan-mode's modal slot), the composer (which every visible dialog and every
// overlay replaces — but which a dialog SUPPRESSED behind a live draft does not; see `typingActive`), and the
// status bar. Esc interrupt / Shift+Tab cycle mode are owned by the composer and
// inactive while a dialog is up; Ctrl-C / Ctrl-Z / Ctrl-B / Ctrl-T / Ctrl-O stay active even during a
// dialog (Ctrl-Z can still suspend — F0 KB5: detach moved off this key onto /detach, a normal command
// that goes through the composer like any other). Ctrl-L moved into the editor (Task 2) — it used to
// live here as an app-level screen-clear that fired ALONGSIDE the editor's own input-clear on every
// Ctrl-L (a transient double-handling); removing this arm leaves the editor as Ctrl-L's sole owner.
// Ctrl-O (Task 5) opens the transcript pager; Ctrl-Z stays reachable there but every other app arm is
// gated while the pager is open — the pager owns the keys, including its own ctrl+c as transcript:exit
// (per the bundle), so the app's Ctrl-C exit-arm must not also fire underneath it. Ctrl-R (Wave 2 task 7)
// opens the history-search overlay, whose own Ctrl-C/Ctrl-R/Ctrl-S keys remain exclusive. The `?`
// shortcuts overlay (F0 KB6) owns every key except Escape, including during the passive-effect unmount
// window of the composer; the overlay is presentational in this tree.
// Renders increment 8's multiline <ChatComposer>.
//
// F2 TASK 6 — this file no longer calls `useInput` at all. Every key above arrives through
// <KeymapProvider> (chatMain wraps the tree): the binding table names an ACTION, the provider finds the
// innermost handler, and the registrations below are ChatApp's. What was one `useInput` body is now:
//  * `useKeySuspend` — ctrl+z, still PRE-table (it must fire under Help's swallow and mid-chord), still
//    built here because suspendProcess needs the real tty from `useStdin`/`useStdout` plus the `suspend`
//    and `resumeOutput` test seams, none of which the provider can see.
//  * `useKeyActions` — the six root globals plus alt+p/alt+t (KB8).
//  * `useKeyScope("Task", {active: busy})` — makes ctrl+x ctrl+b (KB18) resolve only during a turn.
// F2 TASK 7 — the four overlays (`?` help, the pager, history search, the rewind picker) own their own keys:
// Help pushes its context AND swallows, the other three push Transcript / HistorySearch / MessageSelector,
// whose null bindings unbind the root globals declaratively.
// F2 TASK 8 — so do the eleven dialogs and pickers (Select / Confirmation / Settings+Tabs), which was the
// last thing `gatedRef`/`settledGatedRef` covered: BOTH ARE GONE. The root handlers below no longer guard
// themselves at all, because there is nothing left for them to guard against — every surface that hides the
// composer now states in the table which of Global's keys reach it, and the ONE surface with no keys of its
// own (the “⏪ restoring…” hold) says so too, by swallowing (`RestoringModal`). `inputOwnerRef` stays: it is a
// different question (which surface is VISIBLE), and F6 TASK 5 gave it a second job: it is now the ONE
// derivation this file reads back to decide what to draw — which dialog slot (`inlineDecision`), whether the
// composer's slot is empty, and whether the composer is being suppressed rather than replaced (`"typing"`).
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import { suspendProcess } from "./suspend.js";
import { useBindingLookup, useKeyActions, useKeyScope, useKeySuspend, useSwallowKeys } from "./keys/KeymapProvider.js";
import { createDoublePress, DOUBLE_PRESS_WINDOW_MS, type DoublePress, type DoublePressDeps } from "./keys/doublePress.js";
import { formatBindings, UNBOUND } from "./keys/hints.js";
import type { InitialResume } from "./commands.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import { Transcript } from "./Transcript.js";
import { clearViewport } from "./clearViewport.js";
import { Line } from "./Line.js";
import { userEchoLines } from "./render.js";
import { ChatComposer, composerOwns, type InputOwner, type PlaceholderMemo } from "./ChatComposer.js";
import { initialEditorState, type EditorState } from "./editor.js";
import { pushHistory } from "./editorHistory.js";
import { composerMode } from "./promptMode.js";
import type { HistEntry } from "./historySearch.js";
import { isEditableQueueEntry } from "./queue.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { QuestionDialog } from "./QuestionDialog.js";
import { PlanDialog } from "./PlanDialog.js";
import { Footer } from "./Footer.js";
import type { StatusLineConfig } from "./statusLine.js";

import { IDLE_COMPOSER_FOOTER_STATE, type ComposerFooterState } from "./ChatComposer.js";
import { SessionPicker } from "./SessionPicker.js";
import { ModelPicker } from "./ModelPicker.js";
import { TaskPanel } from "./TaskPanel.js";
import { TurnSpinner } from "./TurnSpinner.js";
import { RetryRow } from "./RetryRow.js";
import { CompactionRow } from "./CompactionRow.js";
import { BgTasksPanel } from "./BgTasksPanel.js";
import { RewindPicker } from "./RewindPicker.js";
import { ShortcutsOverlay } from "./ShortcutsOverlay.js";
import { HelpDialog } from "./HelpDialog.js";
import { TranscriptPager } from "./TranscriptPager.js";
import { HistorySearchOverlay } from "./HistorySearchOverlay.js";
import { AddDirDialog } from "./AddDirDialog.js";
import { ThemeDialog } from "./ThemeDialog.js";
import { EffortDialog } from "./EffortDialog.js";
import { BypassConsent } from "./bypassConsent.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { PermissionsDialog } from "./PermissionsDialog.js";
import { savePrefs as realSavePrefs } from "./prefs.js";
import { resolveTerminalTitle, type TerminalTitle } from "./terminalTitle.js";
import { suggestionText } from "./suggester.js";
import type { RenderItem } from "./toolRenderer.js";
import type { RenderLine } from "./render.js";

/** The rewind hold — the one surface in the tree with no keys of its own. A confirmed rewind is a multi-second
 *  file restore + engine swap, and anything that acted during it (Ctrl-R opening history search, Ctrl-O the
 *  pager, Ctrl-C arming an exit) would reintroduce exactly the loss this modal exists to prevent. It says that
 *  itself instead of leaving ChatApp to gate its own handlers: `useSwallowKeys` drops every key while it is
 *  mounted — Ctrl-Z still suspends, which the provider handles above the table. It pushes NO scope, so the
 *  swallow covers `Global` too (registry.ts: a swallower with no scope of its own swallows everything), which
 *  is why ChatApp's `Task` scope is deactivated while `rewinding` — it would otherwise be the innermost live
 *  scope and its ctrl+x ctrl+b chord would survive the hold. */
/** `$jp = 2` (bundle L426022) — the `paddingX` `wqo` puts around a queued prompt in normal layout. */
const QUEUE_PAD = 2;
/** WAVE C TASK 2 — the Esc-Esc rewind arm's queue entry. Both halves are ccx's, because the gesture is ccx's
 *  (upstream's second Esc clears the draft; the composer owns that arm and upstream's own
 *  `escape-again-to-clear` key with it). `ESC_ARM_MS` is the arm window itself, so the entry and the arm it
 *  advertises expire together — one number, not a hint outliving what it promises.
 *
 *  WAVE C TASK 4 (from Task 2's review) — THE KEY IS ITS OWN. It was `escape-again-to-clear`, shared with the
 *  composer's Esc-clear arm, and sharing it is a live defect rather than a tidiness question: the composer
 *  REMOVES that key unconditionally whenever its arm is not up (ChatComposer's `clearVisible` effect, which
 *  runs on mount), and the composer remounts behind every dialog. A rewind arm taken while any dialog closed
 *  would have its hint pulled out from under it by a component that never knew it existed. Distinct keys are
 *  what make the two arms independent; the queue folds and invalidates BY KEY and nothing else. */
const ESC_REWIND_KEY = "escape-again-to-rewind";
const ESC_REWIND_TEXT = "Press Esc again to rewind";
const ESC_ARM_MS = 1500;
/** `fs = 1500` (bundle L547654, the local const beside `Qo = mMr()`): how long after the LAST keystroke the
 *  composer's typing-activity flag stays set, and therefore how long a decision that arrived mid-draft stays
 *  suppressed. Injectable (`typingIdleMs`) for the same reason `yankHintMs`/`escClearMs`/`pasteHintMs` are —
 *  so a test can watch the real window close instead of faking the clock under Ink. */
export const TYPING_IDLE_MS = 1500;
/** Stable empties for the transient region while the pager owns the screen — fresh `[]` literals per render
 *  would remount the (empty) region every frame for nothing. */
const EMPTY_ITEMS: readonly RenderItem[] = [];
const EMPTY_LINES: readonly RenderLine[] = [];

/** WAVE R TASK 1 (defect i) — the default terminal-resize subscription. Module-scoped rather than a default
 *  arrow in the parameter list so its identity is stable across renders: the effect below lists it as a
 *  dependency, and a fresh closure per render would tear down and re-attach the listener every frame. */
const DEFAULT_ON_RESIZE = (cb: () => void): (() => void) => { process.stdout.on("resize", cb); return () => { process.stdout.off("resize", cb); }; };

export type TermSize = { columns: number; rows: number };
/** WAVE R TASK 1 (review finding) — the functional update the sampler below hands to `setSize`: the PREVIOUS
 *  object whenever the size has not moved. Identity is the whole point — React compares the eager next state
 *  with Object.is, so an unchanged size schedules no render at all. That is what makes the resample-on-subscribe
 *  free, and it de-duplicates any later resize event that reports a size we already hold. */
export const nextSize = (prev: TermSize, next: TermSize): TermSize => next.columns === prev.columns && next.rows === prev.rows ? prev : next;

function RestoringModal(): React.ReactElement {
  useSwallowKeys(true);
  return <Box paddingX={1}><Text dimColor>⏪ restoring…</Text></Box>;
}

export function ChatApp({ makeSession, client, onDetach, initialPrompt, hookOpts, cwd, initialResume, initialEntries, clearStaticTranscript, noticeBridge, deps, yankHintMs, escClearMs, typingIdleMs = TYPING_IDLE_MS, initialTodosOpen = true, suspend, resumeOutput, resyncViewport, onResize = DEFAULT_ON_RESIZE, doublePressDeps, name, terminalTitle }: {
  makeSession: (resume?: string) => ChatSession;
  client: { kind: "loopback" | "attached"; short?: string };
  onDetach?: () => void;
  initialPrompt?: string;
  /** F6 T13 (DG59): the Ctrl-T panel's open state, restored from `prefs.showExpandedTodos` by the caller —
   *  the same boot shape `theme` and `outputStyle` already use (chatMain reads prefs BEFORE the first render,
   *  so no component re-reads the file). A RECORDED DIVERGENCE rides on the default: upstream ships
   *  `showExpandedTodos: !1` (bundle L377294) and therefore boots with the panel CLOSED; ccx has shipped it
   *  open since the panel existed, so an absent pref keeps our default rather than silently hiding a panel
   *  users already rely on. */
  initialTodosOpen?: boolean;
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialEffort?: string; initialOutputStyle?: string; initialShowTurnDuration?: boolean; initialPromptSuggestionEnabled?: boolean; statusLine?: StatusLineConfig };
  cwd: string;
  initialResume?: InitialResume;
  initialEntries?: readonly TranscriptBootstrapEntry[];
  // Internal chatMain → ChatApp → useChat boundary (never a public ChatClientOpts field): wipes Ink's
  // append-only <Static> before a terminal boundary mounts a fresh one.
  clearStaticTranscript?: () => void;
  // The same kind of boundary in the other direction (F2 task 9): text from ABOVE the tree — today the
  // keybindings.json watcher's validation findings — landing in the transcript as notices.
  noticeBridge?: { bind(push: (text: string) => void): void };
  deps?: Parameters<typeof useChat>[2];
  yankHintMs?: number;
  escClearMs?: number;
  /** `fs` (see TYPING_IDLE_MS). */
  typingIdleMs?: number;
  suspend?: typeof suspendProcess;
  resumeOutput?: { repaint: (runInkWrite: () => void) => void; tallWrites?: () => number; screenResynced?: () => void };
  /** WAVE R TASK 8 — the viewport reset that recovers from Ink's tall-frame branch, defaulting to the real
   *  `clearViewport` over Ink's own stdout. A seam for the reason every other one here is: `ink-testing-library`
   *  renders with `debug: true`, whose stdout stub is not a tty, so the real reset short-circuits to `false` and
   *  a test could not tell "recovered" from "declined to". Returns whether anything was written. */
  resyncViewport?: () => boolean;
  /** WAVE R TASK 1 — subscribe to terminal resizes; returns the unsubscribe. A seam for the same reason
   *  `suspend` is one: a test cannot resize `ink-testing-library`'s fake stdout, and the real default
   *  (`DEFAULT_ON_RESIZE`) listens on the process's own tty.
   *  MUST HAVE A STABLE IDENTITY across the caller's renders — a module-scoped function (as
   *  `DEFAULT_ON_RESIZE` is, for exactly this reason) or a `useCallback`, never an inline arrow. The
   *  subscribing effect lists it as its only dependency, so a fresh closure per frame would unsubscribe and
   *  re-subscribe the terminal listener on every render. */
  onResize?: (cb: () => void) => () => void;
  /** WAVE C TASK 4 — the `deps` seam of every `createDoublePress` arm in this tree (the app's two, and the
   *  composer's three, which this component threads down). Injected for the reason plan constraint 15 gives:
   *  the arms are the one piece of this UI whose whole contract is a DURATION, and a test that waited out a
   *  real 800 ms window would be timing-dependent in exactly the place fidelity is being asserted. */
  doublePressDeps?: DoublePressDeps;
  /** WAVE C TASK 8 (EP-C4a) — the launch identity (`--name`), the third rung of the terminal-title ladder.
   *  Absent for `ccx attach` (that client joins a host whose name it never saw) and for a bare `ccx`, both of
   *  which fall through to the literal `ccx`. */
  name?: string;
  /** WAVE C TASK 8 — the OSC 0 writer, created by `chatMain` (a process-level concern, alongside the resize
   *  listener) and merely DRIVEN here. Absent in component tests, and absent by construction in every
   *  non-REPL surface: a daemon/HOST session never renders this tree, so it can never emit a title. */
  terminalTitle?: TerminalTitle;
}) {
  const { exit } = useApp();                                        // declared FIRST: /exit hands it to useChat
  // suspend.ts needs the REAL tty object, not Ink's ref-counted `setRawMode` function — see that module's
  // header comment for why the ref-counted one is a no-op here. `write` (real repaint, same reasoning).
  const { stdin } = useStdin();
  const { stdout, write } = useStdout();
  const { state, detailItems, submit, popQueueToComposer, resolveDecision, cycleMode, interrupt, closePicker, pickSession, reloadSessions, previewSession, renamePickedSession, closeModelPicker, pickModel, openModelPicker, closeEffortDialog, confirmEffort, applyEffort, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, closeHelp, clearPrefill, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, acceptBypassConsent, refuseBypassConsent, applyMode, setThink, setShowTurnDuration, setPromptSuggestionEnabled, noteSuggestionSlot, acceptSuggestion, abortSuggestion, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir, notifications, notify, dismissNotification } = useChat(makeSession, { ...(hookOpts ?? {}), cwd, initialResume, initialEntries, initialPrompt, onExit: exit, detach: client.kind === "attached" ? () => { onDetach?.(); exit(); } : undefined, clearStaticTranscript, noticeBridge }, deps);
  // WAVE R TASK 1 (defect i) — the terminal's SIZE IS REACT STATE. Ink's own SIGWINCH handler
  // (node_modules/ink/build/ink.js:83) re-runs Yoga layout over the EXISTING element tree and re-serializes
  // it; it never re-renders components. Nothing in ccx subscribed to "resize" at all, so the reads below
  // happened only when something else caused a render and every width-derived string in the tree froze at
  // the launch width. The subscription sets this state, React re-renders, and the two readers hand the
  // fresh numbers to their consumers.
  //   · `deps.columns` still comes FIRST, for the same reason useChat prefers it — the frame-capture fixture
  //     and the tests pin a width; the resize event is when we go back and ask it again.
  //   · No `deps` override for the HEIGHT (the composer's paste-chip threshold, F5 task 3): nothing pins a
  //     row count the way the frame fixtures pin a width, and 24 is the POSIX default pasteChips uses.
  const readSize = () => ({ columns: deps?.columns?.() ?? stdout?.columns ?? 80, rows: stdout?.rows ?? 24 });
  const readSizeRef = useRef(readSize); readSizeRef.current = readSize;      // the effect below runs once; the reader must not be a mount-time closure
  const [size, setSize] = useState(readSize);
  //   · RESAMPLE ONCE AFTER SUBSCRIBING (review finding). The read above happens during RENDER; the listener
  //     only attaches here, a commit later. A resize landing in that window fires no callback — nothing is
  //     subscribed yet — and the state would stay wrong until the next resize. The functional update returns
  //     the PREVIOUS object when nothing moved, so the extra sample costs a comparison and no render, and the
  //     same guard de-duplicates any later resize event that reports an unchanged size.
  useEffect(() => {
    const sample = () => setSize((prev) => nextSize(prev, readSizeRef.current()));
    const off = onResize(sample); sample(); return off;
  }, [onResize]);
  // WAVE C TASK 8 (EP-C4a) — THE TERMINAL TITLE'S MOUNT SITE. Two effects, because the title text and the
  // busy prefix change on completely different cadences and upstream re-emits on either (`CVe`'s deps are
  // the composed string). The writer dedupes, so the first pass here is the launch emission (`✳ ccx`, or
  // `✳ <--name>`) and every later pass is a no-op until something actually moves.
  //   The LADDER is resolved here rather than in `useChat` because `name` is a launch fact the hook never
  // sees, and it belongs beside the writer it feeds.
  const titleText = resolveTerminalTitle({ renameTitle: state.renameTitle, aiTitle: state.aiTitle, name });
  useEffect(() => { terminalTitle?.setTitle(titleText); }, [terminalTitle, titleText]);
  useEffect(() => { terminalTitle?.setBusy(state.busy); }, [terminalTitle, state.busy]);
  // BOTH STAY FUNCTION-VALUED. `ChatComposer` calls `columns()` per render on purpose (ChatComposer.tsx:252):
  // a plain number would be a prop identity that only changes when the parent re-renders for another reason.
  const terminalColumns = () => size.columns;
  const terminalRows = () => size.rows;
  const queueWidth = Math.max(8, terminalColumns() - QUEUE_PAD * 2);
  const [exitArmed, setExitArmed] = useState(false);
  /** WAVE C TASK 4 (EP-C7b) — THE CLEAR CHANNEL, and it is a TOKEN for the reason `prefill` is one. Ctrl-C's
   *  first press has to reach into the composer's buffer (annex §C7.2), and ChatApp cannot: the composer owns
   *  its `EditorState` and writes the durable ref itself, so a parent that mutated `editorStateRef` behind a
   *  mounted composer would be overwritten by its next commit. `prefill` solved the same problem the same way
   *  — a monotonic counter the child watches and consumes — and reusing that shape means one pattern to
   *  understand instead of two. What differs is the CONSUMED marker: `prefill`'s lives in an app-scoped ref
   *  (`consumedPrefillTokenRef`) because a rewind prefill must survive a composer remount and land, while a
   *  clear must NOT — a Ctrl-C pressed while a dialog owned the screen has no draft to clear, and applying it
   *  on the way back would wipe a buffer the user typed in between. So the composer seeds its marker from the
   *  live token at mount and only ever acts on a LATER bump. */
  const [clearDraftToken, setClearDraftToken] = useState(0);
  // WAVE C TASK 2 — the composer's half of the footer (the four early-return states plus the draft signal).
  // It lives up here rather than in the composer for the same reason the typing debounce does: the composer
  // is unmounted by every dialog, and its own cleanup reports IDLE so nothing stale survives the unmount.
  const [footerState, setFooterState] = useState<ComposerFooterState>(IDLE_COMPOSER_FOOTER_STATE);
  // The draft half of the footer's inputs, on its own channel — see `ComposerFooterState`'s docblock for why
  // it must not ride the effect the other four states use.
  const [draftNonEmpty, setDraftNonEmpty] = useState(false);
  // Every chord the footer prints is DERIVED from the live table through this, never typed in `Footer.tsx`.
  const bindings = useBindingLookup();
  /** ChatApp's own ctrl+c arm. It is a VALUE here rather than a literal in the footer for the reason
   *  `Footer.tsx`'s header gives (upstream passes `Dci.key` into `exitMessage`, L493757).
   *
   *  WAVE C TASK 4 (from Task 2's review) — DERIVED FROM THE LIVE TABLE, not typed. `Ctrl-C` was a literal
   *  here, which made this the one arm in the tree whose hint could lie: a user who moved `app:interrupt` to
   *  `alt+c` got a key that worked and a footer that named a different one. The composer's ctrl+d arm has read
   *  its chord through `formatBindings` since F2 task 10; this is the same derivation, and it produces the same
   *  `Ctrl-C` under the defaults — `formatBinding("ctrl+c")` IS upstream's hyphenated spelling, so constraint
   *  11 is satisfied BY the derivation rather than in spite of it.
   *    THE FALLBACK IS CANON, NOT `(unbound)`. `formatBindings` answers `(unbound)` for an action nothing
   *  binds, which is right for a hint that ADVERTISES a key and wrong for this one: the arm can only be on
   *  screen because the key was just pressed, so `Press (unbound) again to exit` would be false on its face.
   *  It is unreachable through the table (an unbound `app:interrupt` never dispatches here) and reachable only
   *  through a caller that arms this some other way, so the fallback prints the canon spelling. */
  const interruptChord = formatBindings(bindings("app:interrupt"));
  const EXIT_ARM_CTRL_C = { key: interruptChord === UNBOUND ? "Ctrl-C" : interruptChord, verb: "exit" };
  const [todosOpen, setTodosOpen] = useState(initialTodosOpen);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Durable per-app editor state survives a temporary composer unmount; autocomplete is normalized by the
  // remounting composer, while text, cursor, history, undo, stash, and kill ring remain exact.
  const editorStateRef = useRef<EditorState>(initialEditorState());
  /** Push a prompt the `/history` picker just EXECUTED onto that durable list, so the composer's next Up
   *  answers with it exactly as it would had the user typed and sent it (`submitTurn`'s own `pushHistory`).
   *  `mode` is derived from the display, the one derivation the whole port shares with the disk seed. */
  const promoteExecuted = (e: HistEntry) => {
    const s = editorStateRef.current;
    editorStateRef.current = { ...s, history: pushHistory(s.history, { display: e.text, mode: composerMode(e.text), pastedContents: e.pastedContents }) };
  };
  const consumedPrefillTokenRef = useRef(0);
  // CM56's search-history hint fires ONCE — and the composer unmounts behind every dialog, so the flag has to
  // live out here with the durable editor state rather than in the component it gates (F5 t7 review). This
  // scope is PROCESS lifetime, deliberately: /resume swaps the session under a live ChatApp, so a session
  // switch does NOT re-show the hint — same lifetime as the project-scoped history list it describes, and
  // upstream's own guard (m.current, L489587) is never cleared by resetHistory either.
  const searchHintFiredRef = useRef(false);
  // F5 task 8: the queued-up hint's session counter is bumped ONCE per app, for the same lifetime reason —
  // the composer below is replaced by every dialog, and a counter it owned itself would count each remount.
  const queueHintCountedRef = useRef(false);
  // …and the `Try "…"` suggestion's frozen inputs, for the third instance of that same lifetime rule:
  // upstream memoizes the pick once per PROCESS (`Vr`), so a composer remount must not re-roll the sentence.
  const placeholderMemoRef = useRef<PlaceholderMemo>({ draws: [] });
  // ── UPSTREAM'S DIALOG SUPPRESSION (t5-fix; `mMr`/`Z1t` L492731+L236156, the `TC` writer L547796-802, and
  // `Fui()`'s three states L499192). The flag is "the user is mid-draft": set the moment the buffer is
  // non-blank, cleared 1500 ms after the LAST keystroke — a trailing debounce with no leading edge, restarted
  // by every change and CANCELLED outright when the buffer empties (upstream's `b9.cancel()`), which is why
  // emptying a draft reveals a waiting dialog at once instead of a second and a half later.
  //
  // It lives HERE, not in the composer, for a lifetime reason this file has hit three times before: the
  // composer is unmounted by every overlay, and a timer it owned would die with it — leaving the flag stuck
  // true and the decision suppressed forever. ChatApp outlives all of them.
  const [typingActive, setTypingActive] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIdleMsRef = useRef(typingIdleMs); typingIdleMsRef.current = typingIdleMs;
  const noteInputActivity = (nonEmpty: boolean) => {
    // WAVE C TASK 2 — THE DRAFT SIGNAL IS PATCHED IN SYNCHRONOUSLY, and this is the reason: the composer's
    // `onFooterState` effect is a flush behind, so the frame that first shows a keystroke would still be
    // carrying the previous frame's hint list. `chat.test.tsx`'s "never paints a stale editor hint in ANY
    // frame" sweep catches exactly that, correctly — a hint that is wrong for one paint is still wrong.
    // This callback runs from the composer's own `commitState`, i.e. inside the same stdin handler, so React
    // batches it with the composer's own setState and the collapse lands in the SAME frame as the character.
    // The effect still reports the whole state; it agrees with this by the time it runs.
    // WAVE C TASK 12 — upstream's `scd()`, which rides this exact callback: its composer's onChange is
    // `Oe(!1), on(), scd()` (L495482), so an in-flight suggestion dies on the same text change that reports
    // the draft. Ours is one call earlier in the same handler, which is the same tick.
    abortSuggestion();
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
    setDraftNonEmpty(nonEmpty);
    setTypingActive(nonEmpty);
    if (nonEmpty) typingTimer.current = setTimeout(() => { typingTimer.current = null; setTypingActive(false); }, typingIdleMsRef.current);
  };
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);
  // Input subscriptions are passive. This ref changes during render, before the visible owner swaps, so a
  // retiring composer can reject the next key even before its own registration has been torn down — the Chat
  // scope outlives the unmount by one passive flush, and shift+tab/escape would otherwise still reach it from
  // under a dialog. It names the VISIBLE surface, and since F6 task 5 this file reads it BACK: it is the one
  // derivation behind which dialog slot draws, whether the composer's slot is empty, and whether a parked
  // decision is being suppressed rather than shown.
  const inputOwnerRef = useRef<InputOwner>("composer");
  inputOwnerRef.current = state.shortcutsOpen
    ? "shortcuts"
    : transcriptOpen
      ? "transcript"
      : state.bypassConsent.open || state.helpOpen || state.historyOpen || state.rewinding || state.rewindPicker.open || state.bgPanelOpen || state.effortDialog.open || state.modelPicker.open || state.settings.open || state.permissions.open || state.themeDialog.open || state.addDir.open || state.picker.open
        ? "overlay"
        // `Fui()`'s three states (bundle L499192), as two arms of this ladder. A parked decision while the
        // draft is live is SUPPRESSED — the dialog renders nothing (`Xrl()` L499196) and the composer keeps
        // the screen and the keyboard — so it is an owner value of its own rather than a flavour of
        // "decision"; every other reading of "typing" (does the composer own keys? does the mode chip tell
        // the truth?) is the same as "composer", which is what `composerOwns` says once.
        : state.pending
          ? typingActive ? "typing" : "decision"
          : "composer";
  // F6 TASK 5 (DG27), as corrected by the t5 review against the bundle. Upstream HIDES the prompt input
  // whenever a dialog is VISIBLE (`KVf`'s gate `… && on !== "visible" && …`, L549494); `layout:"inline"` vs
  // `"modal"` (`ypi`, L507338 — exit-plan-mode is the only `"modal"` entry) decides only WHERE the dialog is
  // drawn, in the scrollable transcript flow or in the overlaid modal slot, NOT whether the composer coexists
  // with it. So the inline slot below draws in the flow, above where the composer would be, and the composer
  // itself is absent for as long as the dialog is visible. Two conditions, both read off the owner ref
  // computed immediately above rather than re-derived:
  //   · `=== "decision"` IS the overlay-precedence gate AND the suppression gate at once. That arm is reached
  //     only when none of the eleven overlay arms is open and the draft is idle, so a parked decision stays
  //     completely hidden behind the pager / history search / shortcuts / RestoringModal exactly as before —
  //     the accepted oddity documented in the chain below, and the reason the dialog carries
  //     `key={toolUseID}`: whatever hid it, closing that thing re-renders the dialog FRESH, so the answer
  //     channel is never lost, only its rendering deferred. Suppression reveals through the same door.
  //   · `kind !== "plan"` leaves upstream's one modal dialog in the composer-replacing chain below.
  const inlineDecision = inputOwnerRef.current === "decision" && state.pending && state.pending.kind !== "plan" ? state.pending : null;
  // The keymap dispatches from a stdin listener the provider attached in a passive effect, so — exactly as
  // with the old `useInput` — a key can arrive after a newer render has already painted. Keep every
  // state/callback value these handlers consume current synchronously.
  const rootStateRef = useRef(state); rootStateRef.current = state;
  const todosOpenRef = useRef(todosOpen); todosOpenRef.current = todosOpen;
  const suspendRef = useRef(suspend); suspendRef.current = suspend;
  const resumeOutputRef = useRef(resumeOutput); resumeOutputRef.current = resumeOutput;
  const interruptRef = useRef(interrupt); interruptRef.current = interrupt;
  const backgroundNowRef = useRef(backgroundNow); backgroundNowRef.current = backgroundNow;
  const openBgPanelRef = useRef(openBgPanel); openBgPanelRef.current = openBgPanel;
  const exitRef = useRef(exit); exitRef.current = exit;
  const openModelPickerRef = useRef(openModelPicker); openModelPickerRef.current = openModelPicker;
  const openShortcutsRef = useRef(openShortcuts); openShortcutsRef.current = openShortcuts;
  const setThinkRef = useRef(setThink); setThinkRef.current = setThink;
  const openRewindRef = useRef(openRewind); openRewindRef.current = openRewind;
  // ── WAVE C TASK 4 (EP-C7b) — BOTH OF THIS COMPONENT'S ARMS ARE `keys/doublePress.ts` NOW. What used to be
  // here was two hand-rolled `useState` + `useRef(timestamp)` + `setTimeout` triples that had drifted apart
  // from each other and from upstream: the ctrl+c one ran a 2000 ms window (upstream's `Pee` default is
  // `fpy = 800`, and only the `/clear` chord passes 2000) and cleared nothing on its first press. The
  // primitive owns the state machine; what stays here is the ROUTING — which press reaches it at all.
  //
  //  · `onFirstPress` on the ctrl+c arm is upstream's `if (e) t(""), B(0), c?.()` (annex §C7.2), reaching the
  //    composer through the clear channel below. The clear and the arm are ONE press, not alternatives.
  //  · The handlers close over refs, not render values: the primitive is built once (lazy `useRef` init, the
  //    same idiom `useChat` uses for its notification store) so a closure capture here would freeze the first
  //    render's `state`/callbacks forever.
  //  · `dispose()` on unmount, and nothing else: it deliberately does NOT notify (`doublePress.ts`), so it is
  //    only ever safe where the mirrored `useState` is going away with it. Every mid-life cancellation goes
  //    through `disarm()`, which does notify and is silent when nothing is armed.
  const ctrlCArmRef = useRef<DoublePress | null>(null);
  if (ctrlCArmRef.current === null) ctrlCArmRef.current = createDoublePress({
    onArmChange: (armed) => { setExitArmed(armed); },
    onSecondPress: () => { exitRef.current(); },
    onFirstPress: () => { setClearDraftToken((n) => n + 1); },
  }, DOUBLE_PRESS_WINDOW_MS, doublePressDeps);
  const disarm = () => { ctrlCArmRef.current!.disarm(); };
  useEffect(() => () => { ctrlCArmRef.current!.dispose(); }, []);
  // Esc-Esc rewind arming: busy Esc always interrupts and never arms; an idle Esc arms for 1.5s, and a second
  // Esc within the window opens the rewind picker. `ESC_ARM_MS` is a CALL-SITE argument, which is exactly how
  // upstream varies its own windows (the `/clear` chord passes 2000 to the same primitive, annex §C7.2) — the
  // 1500 ms here is ccx's, because the gesture is.
  const [escArmed, setEscArmed] = useState(false);
  const escArmRef = useRef<DoublePress | null>(null);
  if (escArmRef.current === null) escArmRef.current = createDoublePress({
    onArmChange: (armed) => { setEscArmed(armed); },
    onSecondPress: () => { void openRewindRef.current(); },
  }, ESC_ARM_MS, doublePressDeps);
  const disarmEsc = () => { escArmRef.current!.disarm(); };
  useEffect(() => () => { escArmRef.current!.dispose(); }, []);
  // A turn start revokes the arm: otherwise the "Press Esc again" hint outlives the idle moment it was
  // armed in and renders during a busy turn. Keyed on state.busy (not on onSubmit) so a turn started by
  // ANOTHER attached client revokes it too.
  useEffect(() => { if (state.busy) disarmEsc(); }, [state.busy]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onInterrupt = () => {
    disarm();
    if (rootStateRef.current.busy) { interruptRef.current(); disarmEsc(); return; }   // busy: Esc stays interrupt, never arms
    escArmRef.current!.press();
  };
  const onCycleMode = () => { cycleMode(); disarm(); };   // Shift+Tab cycles the permission ladder (default → acceptEdits → plan → auto)
  // Ctrl-Z is process-level for EVERY visible owner: the provider intercepts it before context dispatch,
  // like upstream's raw input loop, so this handler runs under Help and modal swallowers too;
  // suspendProcess is already a Windows-safe no-op.
  useKeySuspend(() => {
    const repaint = () => write("");
    (suspendRef.current ?? suspendProcess)({ stdin, stdout, repaint: () => {
      const output = resumeOutputRef.current;
      if (output) output.repaint(repaint); else repaint();
    } });
  });
  // WAVE R TASK 8 (EP-R4) — RECOVER THE SCREEN AFTER INK'S TALL-FRAME BRANCH. When a frame reaches the terminal
  // height (`ink.js:118`) Ink writes `clearTerminal + fullStaticOutput + output` straight to stdout and returns:
  // log-update is never called, so its `previousOutput`/`previousLineCount` keep describing the frame from before.
  // The ctrl+o pager takes that branch whenever it is taller than the pane, and the damage lands on the way OUT —
  // measured live at 60x15 (`wr-t8-probe2`): closing the pager wrote ZERO bytes, because the post-close frame is
  // byte-identical to the pre-pager one and `log-update.js:13` drops it, and the pager stayed fully painted until
  // a resize replaced its bottom rows and left the rest as border fragments.
  //   The proxy cannot repair that — there is no write to correct — so the repair is a forced repaint from here,
  // and `clearViewport` is exactly the right one: task 7 built it for the same dedupe reached through `/clear`,
  // it wipes the viewport WITHOUT touching scrollback, and it goes through Ink's `writeToStdout`, which leaves
  // log-update's counters describing what it painted.
  //   TWO CONDITIONS, AND BOTH ARE FACTS RATHER THAN INFERENCES. The wipe is only safe while the viewport holds
  // nothing but a tall chunk's own bytes; run it on an ordinary screen and it erases live <Static> rows that have
  // not scrolled into scrollback yet. `tallWrites() > 0` is the proxy's report that the screen IS in that state,
  // and the pager closing is the event that says the tall surface has come down. An earlier version tried to
  // derive the second from the first — fire whenever the count stood still across a commit, on the theory that
  // `ink.js:118` has no dedupe so every tall render bumps it — which would have covered any tall surface, not
  // just this one. It is a bet on "every React commit reaches `onRender`", and its losing side wipes the pager
  // out from under the user mid-scroll; a test that re-rendered without a tall write collected exactly that. The
  // pager is the one surface that deliberately sizes itself to the screen, so it is the one this keys on, and a
  // tall dialog left desynchronized until the next pager cycle is a named residual rather than a silent bet.
  //   AND THE FIRST CONDITION ONLY BECAME A FACT WHEN THE COUNTER DID (t8 review). It shipped once as a HISTORY
  // flag — cleared by nothing but a pager close — so any tall surface at all (the `?` overlay, `/help`, `/model`,
  // the launch frame; all measured at 50x8) armed it, and the next pager close wiped a screen it had not
  // prepared: six of six live transcript rows destroyed in the reviewer's A/B, none of them in scrollback. The
  // proxy now stands the count down on any RECORDED FRAME WRITE, which is precisely the event that removes the
  // dedupe hazard this repaint exists for, so `tallWrites() > 0` here means "the tall chunk is still the last
  // thing that reached the terminal" — current state, which is what this gate always claimed to read.
  //   …AND THE CLOSE HAS TO BE A TRANSITION, NOT A STATE (external whole-branch review). `transcriptOpen ===
  // false` is also true on the FIRST PASS, so the version that read it as a state fired the wipe at MOUNT
  // whenever the boot frame took the branch — and in a pane short enough that every frame goes tall (50x8 is
  // the measured one) no recorded frame write ever stands the count down, so the gate is armed for the whole
  // launch. Nothing there is recoverable BY this repaint: the damage it exists for is the zero-byte pager
  // close, and no pager has been opened yet. What the mount fire can only do is cost — at best a second copy
  // of a screen-tall frame appended to scrollback by the forced repaint, and, whenever a `<Static>` flush has
  // landed in the viewport since the tall write without a recorded frame write behind it (log-update drops the
  // frame that follows it when the bytes repeat — `log-update.js:13`), the same over-erase of live transcript
  // rows the t8 review measured on the history-flag version. Both directions of that trade were already
  // settled above; a fire with nothing to recover is simply the losing side of it with no upside at all.
  //   So the ref below carries the previous value and the recovery runs on true→false only. This is the wave's
  // history-vs-state lesson for the third time (spec Surprises 11): the count answers "is the screen in that
  // state now", and the pager answers "did the tall surface just come DOWN" — that one is an edge, and an edge
  // cannot be read off a level.
  const transcriptWasOpen = useRef(false);
  useEffect(() => {
    const closed = transcriptWasOpen.current && !transcriptOpen;
    transcriptWasOpen.current = transcriptOpen;
    const output = resumeOutputRef.current;
    if (!closed || !(output?.tallWrites?.() ?? 0)) return;
    if ((resyncViewport ?? (() => clearViewport({ stdout, write })))()) output!.screenResynced?.();
  }, [transcriptOpen]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Ctrl-O opens the pager (the PAGER owns closing it — Transcript's own ctrl+o → transcript:exit, task 7);
  // Ctrl-R/T/B are Composer-only. Ctrl-C is allowed from Composer and a visible decision dialog, but never
  // from an ordinary overlay hidden behind a decision. Shift+Tab/Esc are the composer's (Chat context) — it
  // fires onCycleMode on Shift+Tab even with a `/`/`@` popup open (matches 2.1.220) and routes Esc to
  // onInterrupt only when no popup is open. Ctrl-L lives in the editor now (Task 2), not here.
  // KB18: ctrl+x ctrl+b only while a turn runs — and never through the rewind hold, whose swallow resolves
  // against the innermost live scope and would otherwise find THIS one (see RestoringModal).
  useKeyScope("Task", { active: state.busy && !state.rewinding });
  // Every arm below is unguarded now (task 8): a surface that hides the composer either unbinds these keys in
  // its own context or swallows them, so reaching this handler already means the root owns the key. The
  // !rewinding checks the two open arms used to carry went the same way — RestoringModal eats the keystroke
  // before dispatch, and in the three arms that can render ABOVE it (shortcuts / pager / history) ctrl+o and
  // ctrl+r are swallowed, rebound, or null-bound in that surface's own context.
  useKeyActions({
    "app:toggleTranscript": () => { setTranscriptOpen(true); disarm(); },
    // ── WHERE ctrl+r WENT (F5 task 12). `history:search` used to open the full-screen picker from here. It
    // is now ChatComposer's registration, and it opens the INLINE reverse-i-search instead. That is not a
    // preference, it is upstream's own routing read off the layout:
    //   · `Mn("history:search", B, {context:"Global", isActive: yie() ? !1 : !a})` — bundle L489752, the
    //     inline hook claims the chord only when `yie()` (the fullscreen check, L110225) is FALSE;
    //   · `if (yie() && mr) return <qGf …>` — bundle L496209, the picker renders only when it is TRUE.
    // Our REPL is permanently classic layout (03-composer.md §6.4), so ctrl+r is the inline search. The
    // picker is not lost: `/history` opens it, through `openHistorySearch` below — a recorded ccx addition,
    // since upstream needs no such command (fullscreen hands it the picker for free).
    // F6 T13 (DG59): the toggle PERSISTS. Upstream writes the same flag from the same gesture (`showExpandedTodos`
    // follows `expandedView`, bundle L401025-401031). The write is best-effort for the reason ChatComposer's
    // queued-up-hint write is (savePrefs is mkdir+write and throws on an unwritable root): losing the preference
    // must never take the keystroke down with it.
    "app:toggleTodos": () => {
      const next = !todosOpenRef.current;
      setTodosOpen(next);
      try { (deps?.savePrefs ?? realSavePrefs)({ showExpandedTodos: next }, deps?.env); } catch { /* prefs are best-effort */ }
      disarm();
    },
    // WAVE C TASK 4, annex §C7.2 — interrupt a turn, else CLEAR THE DRAFT AND ARM EXIT in one press. The
    // busy branch is the one that does neither: upstream's `V` is not even reached while a turn runs (the
    // interrupt owns the key), so a running turn's Ctrl-C leaves the buffer exactly as it found it.
    "app:interrupt": () => {
      if (rootStateRef.current.busy) { interruptRef.current(); disarm(); return; }
      ctrlCArmRef.current!.press();
    },
    "task:background": () => { rootStateRef.current.busy ? backgroundNowRef.current() : openBgPanelRef.current(); disarm(); },
    // `help:show` is bound to NOTHING by default — the `?` that opens this overlay is composer-local, gated on
    // an empty buffer because it is a printable character the composer must otherwise insert. The action is
    // still declared (a user may name it in keybindings.json), and until the final review it had no handler
    // anywhere: the rebind validated, resolved, matched — and then fell through to the composer and typed.
    // It lands here because this is where the overlay's state lives, on the SAME `openShortcuts` seam the
    // composer's `?` calls (`onHelp` below). It does NOT inherit that key's empty-buffer gate: the gate exists
    // to keep a printable character insertable, and a key the user dedicated to help has nothing to insert.
    // No `disarm()` either — the composer's `?` leaves the Ctrl-C exit arm alone, and this is the same door.
    "help:show": () => { openShortcutsRef.current(); },
    "chat:modelPicker": () => { void openModelPickerRef.current(); },                               // KB8 (alt+p)
    // KB8 (alt+t): the Settings Thinking-mode row's flow — setThink is /think's own mechanism
    // (session.setMaxThinkingTokens) with the off/default pair the row toggles between.
    "chat:thinkingToggle": () => { void setThinkRef.current(rootStateRef.current.thinkLevel === "off" ? "default" : "off"); },
  });
  // Live-feedback fix (2026-08-06, ctrl+o flood): the pager box alone is `rows - 6` lines (rows-10 content
  // + border 2 + header + footer), so ANY other transient chrome mounted beside it — spinner, task panel,
  // queue echo, the transcript's pending/streaming region, an inline dialog — pushes the dynamic frame past
  // the terminal height, and Ink physically cannot erase what scrolled off the top: every spinner tick then
  // deposits another frame copy into scrollback (the observed flood). Upstream has no such coexistence to
  // manage because ctrl+o SWAPS THE WHOLE SCREEN: `rUb` (L499000) flips "prompt" ⇄ "transcript" and the
  // spinner/prompt/todos are all prompt-screen chrome. Our recorded divergence keeps the pager an overlay
  // (unmounting <Static> would replay the scrollback — the Wave-1 lesson), so the equivalent move is to
  // hide every OTHER transient region while it is up. Nothing is lost: the pager's detail projection draws
  // the same retained document, open calls included, and anchors bottom (offset ∞) so it follows the turn
  // live; only the sub-second partial-text preview waits for its block to finalize. The parked decision
  // stays parked host-side — the same accepted oddity as the overlay chain below, revealed fresh through
  // `key={toolUseID}` when the pager closes.
  //
  // WAVE S T4, FINAL ROUND — THE SAME PHYSICS, NOW THE WHOLE CLASS. The pager is not the only surface that
  // spends the pane, and the rewind picker is the proof that a per-dialog BUDGET cannot stand in for this
  // gate. That budget (`REWIND_CHROME_ROWS`) counts the dialog's own chrome, the footer row and one row for
  // Ink's `>=`, so its slack is EXACTLY ONE ROW by construction — and the task panel is seven (a header, a
  // leading blank, up to five windowed rows), which overflows it at every height and every width. Measured on
  // the real `ChatApp` at 21×100, mid-list with both indicators and the checking row up: 20 rows with no
  // tasks, 23 with one, 25 with three, against a pane of 21. A `TaskPanel` term in that budget would close one
  // member and leave the queue echo and the two armed hints — and would have to be written five more times,
  // once per budget below.
  //
  // WHAT IS IN THE CLASS: a surface whose HEIGHT IS A FUNCTION OF `rows`. It has already claimed the pane, so
  // a sibling beside it is not a near miss but a guaranteed overflow, and no budget it could carry would help.
  // Eight, each swept at 18/20/22/24/26/30/40/50 rows — except the last two, whose curves live at or below the
  // bottom of that sweep and had to be measured from 12 up (see their own notes).
  //   THE INSTRUMENT, and every curve below is traceable to it: `stdout.write` on a NON-DEBUG Ink render, with
  // log-update's `eraseLines` framing stripped back off, so the number quoted IS the `outputHeight` of
  // `ink.js:121` — never a `lastFrame()` line count. `ink-testing-library` renders with `debug: true`, and
  // that branch writes `fullStaticOutput + output` and RETURNS BEFORE the `outputHeight >= stdout.rows` check
  // (`ink.js:104-109`), so a height read there is `staticLines + outputHeight`. Any dialog reached by TYPING a
  // slash command has the command echo in its static half — one row — and its curve read that way is one row
  // too tall at every pane. That is what inflated three of the six below (`SessionPicker`, `ModelPicker`,
  // `HelpDialog`) until this round; the three reached without an echo (the pager, `RewindPicker`,
  // `PlanDialog`) measure a static half of ZERO and their numbers were already the right quantity. Re-measure
  // the same way, or the inflation comes straight back:
  //   · the pager       — the BOX alone is `rows − 6` by construction (above), but the frame Ink measures is
  //                       the composed one, which is `rows − 4`: 14 → 46 as the pane goes 18 → 50, over a
  //                       transcript long enough (60 lines) that the window never outruns the content;
  //   · `RewindPicker`  — `rewindVisibleRows(rows, columns)`; 15 → 36 rows as the pane goes 18 → 40 (45 at 50).
  //                       UNCHANGED by the re-measure — its Esc-Esc fixture puts nothing in the static half,
  //                       which rewind-picker.test.tsx's invariant matrix now verifies rather than assumes;
  //   · `SessionPicker` — `resumeVisibleRows(rows)`; 14 → 29 as the pane goes 20 → 50;
  //   · `ModelPicker`   — `Select`'s own `clampVisible(visible, rows, …)`; 15 → 20, i.e. it tracks every pane
  //                       short enough to matter and stops only at `MODEL_VISIBLE_MAX`. THE TRACKING IS
  //                       CATALOG-CONTINGENT, and the unqualified claim this line used to make is not true of
  //                       every catalog: `clampVisible`'s divisor is `perOptionRows`, which is 2 only while
  //                       some option carries a `description`. Re-measured — with descriptions, 14 → 20 over
  //                       panes 16 → 28 (the 15 → 20 above is that same curve over the 18 → 50 sweep);
  //                       WITHOUT them `perOptionRows` is 1 and the frame is a flat 20 at every pane. The
  //                       classification is unchanged, because a real catalog carries descriptions — but a
  //                       description-less FIXTURE measures the floor, not the tracking;
  //   · `HelpDialog`    — `browserVisibleRows(rows)`; its browse tab is 18 → 34 over that same range;
  //   · `PlanDialog`    — `planRegionRows(rows, …)` IS `rows − optionBox − chrome`; 21 → 47 over panes 16 → 50
  //                       with a 60-line plan (21 → 37 is that same curve's 18 → 40 stretch) — and CONTINGENT
  //                       ON THE PLAN in exactly the way `ModelPicker` is on the catalog. `planRegionRows` is
  //                       a MAXIMUM, and `planWindow` returns only as many lines as the plan HAS, so a short
  //                       plan is a flat 21 at every pane. Same conclusion, same caveat about fixtures;
  //   · `SettingsDialog` — `settingsVisibleRows(rows, columns, thinkingTouched)` — the last two only bite once
  //                       the Thinking row has been toggled (`settingsWrapRows`); the curve quoted here is the
  //                       untouched session, which is every session that never touches it:
  //                       10 → 13 over panes 12 → 15 and flat 13 above, quoted
  //                       at ONE cursor state (top of the list) the way the six above each quote one, and read
  //                       off the same non-debug `stdout.write` instrument — this entry is where that
  //                       instrument came from; see `SETTINGS_CHROME_ROWS` for the row it recovers. MOVED HERE BY
  //                       WAVE S t5, which windowed its Config list onto `Select`; until that task it read a
  //                       constant and sat in the excluded list below (recorded there as 14).
  //                         THE MEMBERSHIP TEST IS THE DERIVATION, NOT OBSERVED VARIANCE OVER THE SWEEP, and
  //                       this member is the one that forces the distinction into writing. `settingsVisibleRows`
  //                       makes the list's height literally a function of `rows`, and `ChatApp` threads the real
  //                       `rows` in, so the derivation is LIVE. It is a SATURATING function — `min(5, rows −
  //                       SETTINGS_CHROME_ROWS)` flattens at a pane of 16, because `buildRows` returns a FIXED
  //                       FIVE rows (settingsRows.ts) — so over the 18 → 50 sweep the six above were measured
  //                       on it is flat, with all of its variance below that sweep. A variance test would evict
  //                       it for that flatness. A derivation test does not, and the derivation test is the
  //                       correct one, because the saturation is a property of TODAY'S FIVE-ROW CATALOG and not
  //                       of the surface: add a sixth row to `buildRows` and Settings tracks the pane across
  //                       the whole sweep with no change to a line of code here. A criterion that flips
  //                       membership on a data-file edit is not a criterion — so do not "tighten" this rule to
  //                       observed variance in a later round; it would evict this dialog and nothing about the
  //                       dialog would have changed. The rule still separates cleanly at the boundary that
  //                       matters: `ShortcutsOverlay` (18) and `BypassConsent` (18) are the two nearest it in
  //                       height on the other side, and nothing in either one reads `rows` at all.
  //   · `PermissionsDialog` — `permissionsVisibleRows(rows)`; 12 → 28 over panes 14 → 30 with a 30-rule Allow
  //                       tab, quoted at the top of the list like every entry above it and read off the same
  //                       non-debug `stdout.write` instrument. The frame is `rows − 2` there and `rows − 1`
  //                       mid-list, where BOTH counted indicators are up — that second state is the one
  //                       `PERMISSIONS_CHROME_ROWS` (13) is built against, and it is what leaves the strict
  //                       inequality its slack of exactly one. Below a pane of 14 the window is already at its
  //                       floor of one row and no budget can help: measured 4 clears per cursor move at 12 and
  //                       2 at 13, zero at every pane from 14 to 30 in all three states swept (Allow at the
  //                       top; Allow mid-list with both indicators; Workspace with eight directories).
  //                       MOVED HERE BY WAVE S t6b, which windowed its rule and workspace lists onto `Select`;
  //                       until that task it read a constant and sat in the excluded list below (recorded
  //                       there as 9). Its Workspace tab SATURATES at nine rows exactly as Settings' Config
  //                       tab saturates at five — flat at 19 from a pane of 22 up — which is the same
  //                       content-contingency, and by the derivation test the same non-issue.
  //                         The gate is what this member needs, not a bigger budget, and the two numbers that
  //                       show it are these: with a task panel on screen and this term ABSENT, the composed
  //                       frame is `rows + 2` and every cursor move draws a clear at every pane from 14 to 30.
  //                       With the term present it is the `rows − 2` above and draws none.
  // AND WHAT IS NOT, deliberately. This list is the OTHER half of a PARTITION of the dialog chain below —
  // every surface in that chain appears in exactly one of the two lists, and a new one has to be placed in
  // one of them. It is every dialog whose height is a function of its CONTENT: `BgTasksPanel` (13 rows),
  // `ShortcutsOverlay` (18), `BypassConsent` (18), `ThemeDialog` (17), `HistorySearchOverlay` (15, the
  // `/history` picker), the inline `PermissionDialog`/`QuestionDialog` pair (12),
  // `AddDirDialog`, `EffortDialog` (Wave C Task 11 — one row plus a caveat line, the SHORTEST member of this
  // half and about as content-contingent as `RestoringModal`), and `RestoringModal` (1) — every one of them measured CONSTANT
  // across that whole range. `SettingsDialog` (14) and `PermissionsDialog` (9) WERE ON THIS LIST and are not
  // any more: Wave S t5 windowed the first one's Config list and t6b the second one's rule and workspace
  // lists, which is what a new member of the other half looks like from here — a change that adds a
  // `rows`-derived height to a dialog moves it across this partition, and the two lists have to be edited in
  // the same breath as the disjunction below or one of them starts lying.
  //   Those are a different defect with a different repair: a fixed-height dialog too
  // tall for a short pane overflows on its OWN (`ShortcutsOverlay` and `BypassConsent`, the joint-tallest of
  // them, each reach the pane at 18 rows with no task panel in the tree at all, and `HistorySearchOverlay`
  // composes to 22 WITH one up and so reaches every pane from 18 to 22; `HelpDialog`'s general tab reaches it
  // at any pane of 28 or less), and what that needs is a window, not the removal of its neighbours. Gating
  // them would also cost what this gate costs, and cost it where it is not worth paying: a decision dialog is
  // drawn in the transcript FLOW precisely so the turn's own context stays on screen while you answer it, and
  // the task panel and the spinner are that context. THE EXCLUSION IS PINNED, not merely intended:
  // chat.test.tsx's `/theme` case asserts the task panel SURVIVES behind a content-sized dialog, and it was
  // sabotage-checked by ADDING `|| state.themeDialog.open` to the disjunction below — that one term turns it
  // red and leaves the other 101 cases in that file green. Every pin the gate had before this one asserts the
  // panel is GONE, so a term added by a later round would have been invisible to all of them.
  //
  // A FLAT DISJUNCTION, not a walk of the chain below. Two of these flags can in principle be set at once
  // (`/settings`'s Model row deliberately opens `modelPicker` over it), and then the gate is on for whichever
  // of the two renders — which is correct here, because the one that renders in every such pair is itself
  // pane-owning. The cost of being wrong is one hidden task panel, not an overflow.
  const paneOwned = transcriptOpen || state.helpOpen || state.rewindPicker.open || state.modelPicker.open || state.picker.open
    || state.settings.open                                        // Wave S t5 — its Config list is windowed now
    || state.permissions.open                                     // Wave S t6b — its rule/workspace lists are windowed now
    || (inputOwnerRef.current === "decision" && state.pending?.kind === "plan");
  // WAVE C TASK 2 — the rewind arm's feedback moved from its own ROW to the notification QUEUE, which is
  // upstream's placement for every "press it again" message (annex §C1.6's `escape-again-to-clear` and
  // `left-arrow-again-for-agents` are both `immediate` feedback entries, not permanent lines). Same string,
  // same window, same `!paneOwned` gate — only the slot changed, to the one-row overlay above the composer.
  // Declared HERE, below `paneOwned`, because it reads it. WAVE C TASK 4 rebuilt the arm itself on
  // `keys/doublePress.ts` and gave the entry its own key (`ESC_REWIND_KEY`); the destination did not move.
  const escArmVisible = escArmed && !paneOwned;
  useEffect(() => {
    if (escArmVisible) notify({ key: ESC_REWIND_KEY, text: ESC_REWIND_TEXT, priority: "immediate", timeoutMs: ESC_ARM_MS });
    else dismissNotification(ESC_REWIND_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escArmVisible]);
  return (
    <Box flexDirection="column">
      <Transcript key={state.staticEpoch} staticItems={state.staticItems} pendingItems={paneOwned ? EMPTY_ITEMS : state.pendingItems} streaming={paneOwned ? EMPTY_LINES : state.streaming} />
      {todosOpen && !paneOwned ? <TaskPanel tasks={state.tasks} columns={terminalColumns()} rows={terminalRows()} /> : null}
      {/* Wave T Task 13 — the live-turn indicator is ONE slot. Canon `qyn` (L407975, mounted at L407973)
          takes the whole slot over while a retry status exists, so the row REPLACES the spinner rather than
          sitting beside it: a spinner still pulsing next to "Retrying in 4s" is exactly the "nothing is
          wrong" reading the QA fleet's 72-second outage produced. */}
      {/* W-S7 (Wave S t11) — compaction joins that one slot, and it widens the gate: a typed `/compact` runs
          NO turn, so `state.busy` is false for the whole 30–120 s pass and the slot would have stayed empty.
          PRECEDENCE, retry over compacting over the spinner: RetryRow already owns the whole slot for the
          reason above (a pulsing anything beside "Retrying in 4s" reads as "nothing is wrong"), and that
          argument does not weaken because the thing being retried is a compaction — the API not answering is
          the more urgent news and the rarer state. Compacting then beats the ordinary spinner because it is
          strictly more specific: it names the pass that is running instead of a random thinking verb. */}
      {(state.busy || state.compacting) && !paneOwned
        ? (state.retryStatus ? <RetryRow status={state.retryStatus} />
          : state.compacting ? <CompactionRow startedAt={state.compacting.startedAt} columns={terminalColumns()} {...(deps?.now ? { now: deps.now } : {})} />
          : <TurnSpinner startedAt={state.turnStartedAt} meter={state.turnMeter} columns={terminalColumns()} />)
        : null}
      {/* F4 Task 8 — upstream `wqo` (pack §7.7, bundle L426002–426022): a queued prompt is the ORDINARY
          prompt echo wrapped in `<Box paddingX={$jp}>` with `$jp = 2`, and nothing else. It carries no
          prefix, no clip and no dimming (the `subtle` flip at L426034 lives inside the brief-layout branch,
          which this clone does not model) — so our `⋯ queued: ` + 60-char clip was an over-ship on both
          counts and dies here. The band is minted at `columns - 2*QUEUE_PAD`, which reproduces upstream's
          queued rule inset exactly: it hands `Sg` a padding of `3 + paddingWidth` = 7 where a normal
          message hands 3, and `paddingWidth` is `paddingX * 2` = 4. */}
      {state.queue.length > 0 && !paneOwned ? (
        <Box flexDirection="column" paddingX={QUEUE_PAD}>
          {state.queue.flatMap((q, i) => userEchoLines(q.value, { width: queueWidth }).map((l, j) => <Line key={`${i}:${j}`} l={l} />))}
        </Box>
      ) : null}
      {/* The inline slot: below everything the transcript owns, directly above the composer. It is rendered
          BEFORE the composer in this tree, so it also mounts first — the registry ranks by mount order, and
          the composer's own registrations are `active`-gated off while it does not own the keyboard, so the
          dialog wins the keys by both mechanisms rather than by either one alone (ChatComposer's `owns`). */}
      {inlineDecision
        ? inlineDecision.kind === "question"
          // key = toolUseID: dropPending promotes the NEXT queued decision straight into `pending` with no
          // intermediate null render, so without a key the same QuestionDialog instance would carry stale
          // internal progress (qi/idx/checked) into an unrelated toolUseID's question set — a fresh key
          // forces the clean remount a new decision needs.
          ? <QuestionDialog key={inlineDecision.toolUseID} req={inlineDecision}
              onAnswer={(answers, response) => resolveDecision({ kind: "question_answer", answers, ...(response ? { response } : {}) })}
              onDeny={() => resolveDecision({ kind: "deny" })} />
          // `cwd` is the SESSION's working directory, not this process's — the kind routing and the Bash
          // body's rule summary both name it (permissionKind.ts). `directories` is the WHOLE working set —
          // the cwd plus every `/add-dir` grant — which is what the file body's in-directory test runs over
          // (F6 T7 fix; without it an Edit under an added directory reads as out-of-directory and its grant
          // re-adds a directory the session already holds).
          : <PermissionDialog key={inlineDecision.toolUseID} req={inlineDecision} cwd={cwd} directories={state.workDirs} onDecision={(d) => resolveDecision(d)} />
        : null}
      {/* Wave-T T15: the head of the chain, above even the `?` overlay. `/yolo` is a request to stop being
          asked before dangerous commands run, and until it is answered nothing else may take the keyboard —
          this is the one dialog in the tree whose whole job is to be in the way. */}
      {state.bypassConsent.open
        ? <BypassConsent onAccept={acceptBypassConsent} onRefuse={refuseBypassConsent}
            {...(deps?.savePrefs ? { savePrefs: deps.savePrefs } : {})} {...(deps?.env ? { env: deps.env } : {})} />
        : state.shortcutsOpen
        ? <ShortcutsOverlay onClose={closeShortcuts} />
        // F6 T14: `/help`'s dialog sits directly behind the `?` overlay — they render the SAME grid, and the
        // one that was opened last is the one on screen. Both are USER surfaces (no parked decision under
        // them), so this pair keeps the head of the chain.
        : state.helpOpen
        ? <HelpDialog commands={state.commandCatalog} onClose={closeHelp} rows={terminalRows()} columns={terminalColumns()} />
        : transcriptOpen
        // The ONLY route from the retained document to the pager: useChat's detailItems closure re-projects
        // it at whichever detail projection the pager currently wants. ChatApp never projects detail itself
        // and never owns show-all state — Ctrl-E is pager-local, Ctrl-O/Escape are all this arm decides.
        ? <TranscriptPager makeItems={detailItems} onClose={() => setTranscriptOpen(false)} />
        : state.historyOpen
        // CM59: the preview pane's side-by-side/stacked switch is a function of the live terminal width, read
        // the same per-render way the composer's is so a resize reaches it on the next frame.
        // `onExecute` is WRAPPED, and the wrapper is the in-session half of one gesture whose other half is
        // useChat's (see `executeHistory`'s comment there). Running a prompt from the picker has to promote
        // it in BOTH history lists the typed submit path promotes it in: the persisted log, which useChat
        // re-appends to, and the composer's Up-arrow list, which is this app-scoped ref — a composer instance
        // seeds it once and `submitTurn` pushes onto it thereafter. The composer is unmounted while this
        // overlay is up, so the push lands on the ref and the remount right behind `setHistoryOpen(false)`
        // reads it, which is the same machinery that already carries a draft across every dialog.
        ? <HistorySearchOverlay load={loadHistory} onAccept={acceptHistory} onExecute={(e) => { promoteExecuted(e); executeHistory(e); }} onCancel={closeHistorySearch} columns={terminalColumns} />
        // A confirmed rewind takes seconds (file restore + engine swap). Hold a modal until it settles:
        // if the composer came back first, a prompt typed in that window would be cleared from the editor,
        // sent, and refused by the host as busy — the user's text lost rather than queued.
        //
        // NB (F3, final review): every arm ABOVE this one — shortcuts/pager/history — still renders over a
        // pending decision dialog too (state.pending is checked further below in this chain). That is an
        // accepted oddity, not a new gap this fix introduces: the park is state-owned on the host, not
        // reachable/answerable through the overlay, and closing the overlay remounts the dialog fresh via
        // its `key={state.pending.toolUseID}` — so no answer can be lost, only its rendering briefly hidden.
        : state.rewinding
        ? <RestoringModal />
        : state.rewindPicker.open
          ? <RewindPicker anchors={state.rewindPicker.anchors} onDryRun={rewindDryRun} onConfirm={confirmRewind} onClose={closeRewindPicker} rows={terminalRows()} columns={terminalColumns()} />
          : state.bgPanelOpen
            ? <BgTasksPanel tasks={state.bgRows} onStop={stopBgTask} onClose={closeBgPanel} columns={terminalColumns()} />
            : state.effortDialog.open
              // WAVE C TASK 11 (EP-C6) — the standalone `/effort` dialog. It slots HERE, between the bg panel
              // and the model picker, and NOT after it: `modelPicker` and `settings` are deliberately
              // adjacent (the Settings Model row hides SettingsDialog behind the picker and falls back
              // through to it on close, see the settings arm below), so a new arm between them would break
              // that handoff. Nothing hands off to or from this dialog — `/effort` is the only route in.
              //   It is NOT in `paneOwned`: one row plus an optional caveat line is a fixed-height dialog,
              // which is the other half of that partition (see the enumeration above it).
              ? <EffortDialog level={state.effortDialog.level ?? "high"}
                  {...(state.effortDialog.levels ? { levels: state.effortDialog.levels } : {})}
                  defaultEffort={state.defaultEffort}
                  {...(state.effortDialog.modelName !== undefined ? { modelName: state.effortDialog.modelName } : {})}
                  {...(state.effortDialog.supported !== undefined ? { supported: state.effortDialog.supported } : {})}
                  onConfirm={confirmEffort} onCancel={closeEffortDialog} />
            : state.modelPicker.open
              // F6 T11: `savePrefs` reaches the picker for the same reason it reaches SettingsDialog and
              // ThemeDialog — Enter here writes the default model, and the write seam is injectable so a
              // test never touches the real prefs file.
              //
              // WAVE R TASK 5 (qa2-10a) — `rows`/`columns` are Task 1's state, and every dialog in this chain
              // that ACCEPTS them now gets them (ModelPicker, RewindPicker, SessionPicker, PlanDialog's height).
              // They were declared and never passed, so each fell through to `Select`'s own
              // `process.stdout.rows ?? 24` / `.columns ?? 80` defaults.
              //
              // WHY THAT MATTERS IS SINGLE-SOURCE-OF-TRUTH, NOT STALENESS (fix round 1 — the first version of
              // this comment claimed the default was read "once, at mount, with no route back", which is
              // false: a default parameter is re-evaluated on every render, and after Task 1 every SIGWINCH
              // re-renders this tree). The real cost is that `process.stdout` is a SECOND source of size and
              // an uninjectable one: `deps.columns`/`terminalRows()` is what the app, the composer and every
              // test/frame-capture fixture treat as authoritative, and a dialog reading stdout behind its back
              // silently ignores that pin — under `ink-testing-library` the fake stdout reports the runner's
              // own geometry (and no `rows` at all), so the dialog and the composer disagree about the size of
              // the same terminal. Threading the state is the whole fix: one size for the whole tree.
              // WAVE S T12: `outputTokens`/`ackedAt` are the switch-confirm's gate inputs, both owned by
              // useChat (`openModelPicker` reads the usage, `pickModel` stamps the ack) and threaded through
              // here as plain state. The confirm itself is a STAGE OF THE PICKER, not a new arm in this
              // chain — see ModelSwitchConfirm.tsx's header for why, and note that it therefore adds nothing
              // to `paneOwned` above: `state.modelPicker.open` already covers the whole surface, and a
              // fixed-height dialog does not belong in that set anyway.
              ? <ModelPicker models={state.modelPicker.models} current={state.modelPicker.current} sessionModel={state.modelPicker.sessionModel}
                  outputTokens={state.modelPicker.outputTokens} ackedAt={state.modelPicker.ackedAt} activeModel={state.modelPicker.activeModel}
                  {...(state.effort ? { effort: state.effort } : {})} defaultEffort={state.defaultEffort} onEffortChange={applyEffort}
                  onPick={pickModel} onCancel={closeModelPicker} savePrefs={deps?.savePrefs} rows={terminalRows()} columns={terminalColumns()} />
              // W3 T4/T5/T7: the four new settings-surface dialogs slot HERE, between modelPicker and picker,
              // in the order settings → permissions → theme → addDir (plan Global Constraints line 38);
              // settings goes immediately after this modelPicker arm precisely so its Model row can reuse
              // THIS SAME modelPicker overlay: opening it hides SettingsDialog behind it, closing it falls
              // back through to state.settings.open still being true. PermissionsDialog needs no such
              // handoff — its own "Add directory…" row EMBEDS AddDirDialog directly (PermissionsDialog.tsx's
              // own header comment) rather than reaching for the top-level state.addDir slot below, which
              // sits AFTER this arm and so would otherwise be unreachable while permissions stays open.
              : state.settings.open
                ? <SettingsDialog tab={state.settings.tab ?? "Config"} onTabChange={setSettingsTab}
                    model={state.model} mode={state.mode} thinkLevel={state.thinkLevel} outputStyle={state.outputStyle}
                    showTurnDuration={state.showTurnDuration} setShowTurnDuration={setShowTurnDuration}
                    promptSuggestionEnabled={state.promptSuggestionEnabled} setPromptSuggestionEnabled={setPromptSuggestionEnabled}
                    onDone={closeSettings} applyMode={applyMode} setThink={setThink} applyOutputStyle={applyOutputStyle}
                    fetchStatus={fetchSettingsStatus} fetchUsage={fetchSettingsUsage} fetchStats={fetchSettingsStats}
                    // WAVE S t5: the Config list is windowed now, so this dialog joins the set that is handed
                    // Task 1's size state rather than falling through to `process.stdout` behind the app's
                    // pin (the ModelPicker arm above spells the whole argument out).
                    onOpenModelPicker={openModelPicker} savePrefs={deps?.savePrefs} rows={terminalRows()} columns={terminalColumns()} />
                : state.permissions.open
                ? <PermissionsDialog tab={state.permissions.tab ?? "Allow"} onTabChange={setPermissionsTab}
                    denials={state.denials} cwd={cwd}
                    fetchSettings={fetchPermSettings} fetchDirs={fetchPermDirs}
                    addRule={addPermRule} removeRule={removePermRule} removeDir={removeWorkspaceDir}
                    addDirValidate={addDirValidate} confirmAddDir={confirmAddDir} cancelAddDir={cancelAddDir}
                    // WAVE S t6b: its rule and workspace lists are windowed now, so this dialog joins the set
                    // that is handed Task 1's size state rather than falling through to `process.stdout` behind
                    // the app's pin (the ModelPicker arm above spells the whole argument out).
                    onDone={closePermissions} rows={terminalRows()} columns={terminalColumns()} />
                : state.themeDialog.open
                ? <ThemeDialog onDone={closeThemeDialog} savePrefs={deps?.savePrefs} />
                : state.addDir.open
                  ? <AddDirDialog prefill={state.addDir.prefill} onValidate={addDirValidate} onConfirm={confirmAddDir} onCancel={cancelAddDir} />
                  : state.picker.open
                  ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker}
                      loadMessages={previewSession} renameSession={renamePickedSession} reload={reloadSessions}
                      hasWorktree={state.picker.hasWorktree} rows={terminalRows()} columns={terminalColumns()} />
                  // F6 TASK 5 (t5-fix) — THE COMPOSER'S SLOT IS EMPTY WHILE A DIALOG IS VISIBLE. `owner ===
                  // "decision"` is exactly upstream's `on === "visible"` (a decision is parked, no overlay is
                  // over it, and the draft is idle), and `KVf`'s gate at L549494 renders no prompt input in
                  // that state. The inline kinds have already drawn above this slot; exit-plan-mode — the one
                  // `layout:"modal"` entry in `ypi` (L507338) — draws HERE, in the modal slot, which in this
                  // single-column tree is the same place the composer would have been. `key = toolUseID` for
                  // the reason the inline pair carries it: dropPending promotes the NEXT queued decision
                  // straight into `pending` with no intermediate null render, and a reused instance would
                  // carry stale scroll/feedback state into an unrelated decision.
                  : inputOwnerRef.current === "decision"
                  ? state.pending?.kind === "plan"
                    // `model`/`bypassAvailable` decide WHICH of upstream's one-of approval arms the dialog can
                    // offer (Wave T t10). The launch mode is the bypass source because resolveOptions.ts:67
                    // sets `allowDangerouslySkipPermissions` from exactly that — a session that did not launch
                    // in bypass cannot be granted it. `state.model` is undefined on an attach client until a
                    // turn ends, which PlanDialog reads as "auto not available".
                    ? <PlanDialog key={state.pending.toolUseID} req={state.pending} onDecision={(o) => resolveDecision(o)}
                        model={state.model} bypassAvailable={hookOpts?.initialMode === "bypassPermissions"} rows={terminalRows()} />
                    : null
                  : <ChatComposer onSubmit={(t) => { submit(t); disarm(); }} cwd={cwd} commandCatalog={state.commandCatalog} onExit={exit} onCycleMode={onCycleMode} onInterrupt={onInterrupt} onHelp={openShortcuts} onDraftStart={disarmEsc} onInputActivity={noteInputActivity} waitingForPermission={inputOwnerRef.current === "typing"} inputOwnerRef={inputOwnerRef} editorStateRef={editorStateRef} consumedPrefillTokenRef={consumedPrefillTokenRef} searchHintFiredRef={searchHintFiredRef} prefill={state.composerPrefill} onPrefillApplied={clearPrefill} onKillAgents={killAgents} yankHintMs={yankHintMs} busy={state.busy} escClearMs={escClearMs} columns={terminalColumns} rows={terminalRows} sessionId={state.sessionId} project={cwd}
                      // F5 t12: the composer's disk seed, its history append and now its inline search all
                      // read this. Threaded from `deps.env` — the same source useChat's own `historyEnv`
                      // takes — so a test that points ChatApp at a temp fleet root points BOTH surfaces
                      // there. Undefined in the product, where the composer falls back to `process.env`.
                      historyEnv={deps?.env}
                      queuePop={popQueueToComposer} queueHasEditable={state.queue.some(isEditableQueueEntry)}
                      submitCount={state.submitCount} hasMessages={state.hasMessages} queueHintCountedRef={queueHintCountedRef} placeholderMemoRef={placeholderMemoRef}
                      // WAVE C TASK 2: one queue for the whole app (useChat owns it), and the composer's
                      // footer-state channel. Both are how the one-row footer and the one-row overlay stay
                      // in sync with a component that unmounts behind every dialog.
                      notifications={notifications} onFooterState={setFooterState}
                      // WAVE C TASK 4: the Ctrl-C clear channel (see `clearDraftToken`), the ← agents gesture's
                      // destination — `task:background`'s idle branch, the same surface ctrl+b opens — and the
                      // arm clock every double-press in this tree shares.
                      clearDraftToken={clearDraftToken} onOpenAgents={openBgPanel} doublePressDeps={doublePressDeps}
                      // WAVE C TASK 12 (EP-C5): the suggestion's text down, and the composer's two facts back
                      // up — whether it could paint one right now, and that a key accepted it. The SLICE stays
                      // in useChat (it has to survive this component's remounts and Ctrl-C's buffer clear).
                      // `suggestionEnabled` is the SAME setting one rung down: it also gates the first-run
                      // `Try "…"` template (upstream's L1542 rule), so with suggestions off by default a fresh
                      // ccx session shows no template either — recorded in the spec as an accepted change.
                      suggestion={suggestionText(state.promptSuggestion)} suggestionEnabled={state.promptSuggestionEnabled}
                      onSuggestionSlot={noteSuggestionSlot} onSuggestionAccept={acceptSuggestion} />}
      {/* WAVE C TASK 2 (EP-C1b) — ONE FOOTER ROW, where `ChatStatusBar` and two armed-hint rows used to be.
          It stays UNCONDITIONAL, exactly as the status bar was, because three dialog height budgets count it
          as their one unconditional sibling (`rewindModel.REWIND_CHROME_ROWS` and the two dialog constants
          each enumerate a `+1` for this row). `composerOwnsKeys` is the SAME render-time disjunction the
          composer's own guard reads: the mode chip is a fact and always draws, while the chord-bearing
          content — the `(shift+tab to cycle)` parenthetical and the whole hint list — must vanish the frame a
          dialog or overlay takes the keyboard. A prop and not a registry read, because this value is derived
          from state during render and therefore repaints with it (`Footer.tsx`'s divergence 2).

          THE EXIT ARM'S KEY IS A STRING FROM HERE, never a literal inside `Footer.tsx` — upstream's own
          arrangement (its input hook passes `Dci.key` into `exitMessage`, L493757) and what lets the footer
          source join `keys-acceptance.test.tsx`'s banned-chord sweep. Two arms feed the one slot: ChatApp's
          own ctrl+c arm, and the composer's ctrl+d arm arriving through `footerState`. Ctrl-C wins when both
          are up, because it is the one that ends the process rather than the session.

          `Press Esc again to rewind` HAS NO ROW HERE, deliberately (plan constraint 12): upstream carries that
          class of affordance as a QUEUE entry, not a persistent line (annex §C1.6), and since Wave C Task 4
          both esc arms post there — this one on `escape-again-to-rewind`, the composer's clear arm on
          upstream's own `escape-again-to-clear`. */}
      <Footer
        mode={state.mode} busy={state.busy}
        draftNonEmpty={draftNonEmpty} isInputEmpty={!draftNonEmpty}
        searching={footerState.searching} pasting={footerState.pasting}
        pasteExpandHint={footerState.pasteExpandHint} bashMode={footerState.bashMode}
        exitArm={exitArmed && !paneOwned ? EXIT_ARM_CTRL_C : footerState.exitArm}
        // WAVE C TASK 10 (EP-C2b) — the statusLine, now real. CONFIGURED and TEXT are separate facts and
        // arrive from separate places on purpose: the setting is resolved once at launch (chatMain, the only
        // reader of the user settings file), and the text is whatever the driver's last SUCCESSFUL run
        // published. So `? for shortcuts` disappears the moment a statusLine is configured — before, and
        // regardless of whether, the script ever produces a line. `rows` is the pane height the guard's
        // 15-row floor reads, threaded from Task 1's resize state like every other geometry consumer here.
        statusLineConfigured={hookOpts?.statusLine !== undefined}
        statusLineText={state.statusLineText}
        statusLinePadding={hookOpts?.statusLine?.padding}
        rows={terminalRows()}
        // ccx has no "agent needs input" signal and no completion stamp the footer could read, so only the
        // COUNT is wired — it is what replaced the old `⚙ N bg` chip. `agentsAffordance` implements both
        // flashes and its own 2500 ms window (`Lci`); a producer sets `awaiting`/`done` here and gets them.
        agents={{ count: state.bgTasks.length }}
        bindings={bindings} composerOwnsKeys={composerOwns(inputOwnerRef.current)} />
    </Box>
  );
}
