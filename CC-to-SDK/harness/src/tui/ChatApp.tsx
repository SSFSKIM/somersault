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
import { useKeyActions, useKeyScope, useKeySuspend, useSwallowKeys } from "./keys/KeymapProvider.js";
import type { InitialResume } from "./commands.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import { Transcript } from "./Transcript.js";
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
import { ChatStatusBar } from "./ChatStatusBar.js";
import { SessionPicker } from "./SessionPicker.js";
import { ModelPicker } from "./ModelPicker.js";
import { TaskPanel } from "./TaskPanel.js";
import { TurnSpinner } from "./TurnSpinner.js";
import { RetryRow } from "./RetryRow.js";
import { BgTasksPanel } from "./BgTasksPanel.js";
import { RewindPicker } from "./RewindPicker.js";
import { ShortcutsOverlay } from "./ShortcutsOverlay.js";
import { HelpDialog } from "./HelpDialog.js";
import { TranscriptPager } from "./TranscriptPager.js";
import { HistorySearchOverlay } from "./HistorySearchOverlay.js";
import { AddDirDialog } from "./AddDirDialog.js";
import { ThemeDialog } from "./ThemeDialog.js";
import { BypassConsent } from "./bypassConsent.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { PermissionsDialog } from "./PermissionsDialog.js";
import { savePrefs as realSavePrefs } from "./prefs.js";
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

export function ChatApp({ makeSession, client, onDetach, initialPrompt, hookOpts, cwd, initialResume, initialEntries, clearStaticTranscript, noticeBridge, deps, yankHintMs, escClearMs, typingIdleMs = TYPING_IDLE_MS, initialTodosOpen = true, suspend, resumeOutput, onResize = DEFAULT_ON_RESIZE }: {
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
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialOutputStyle?: string };
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
  resumeOutput?: { repaint: (runInkWrite: () => void) => void };
  /** WAVE R TASK 1 — subscribe to terminal resizes; returns the unsubscribe. A seam for the same reason
   *  `suspend` is one: a test cannot resize `ink-testing-library`'s fake stdout, and the real default
   *  (`DEFAULT_ON_RESIZE`) listens on the process's own tty.
   *  MUST HAVE A STABLE IDENTITY across the caller's renders — a module-scoped function (as
   *  `DEFAULT_ON_RESIZE` is, for exactly this reason) or a `useCallback`, never an inline arrow. The
   *  subscribing effect lists it as its only dependency, so a fresh closure per frame would unsubscribe and
   *  re-subscribe the terminal listener on every render. */
  onResize?: (cb: () => void) => () => void;
}) {
  const { exit } = useApp();                                        // declared FIRST: /exit hands it to useChat
  // suspend.ts needs the REAL tty object, not Ink's ref-counted `setRawMode` function — see that module's
  // header comment for why the ref-counted one is a no-op here. `write` (real repaint, same reasoning).
  const { stdin } = useStdin();
  const { stdout, write } = useStdout();
  const { state, detailItems, submit, popQueueToComposer, resolveDecision, cycleMode, interrupt, closePicker, pickSession, previewSession, renamePickedSession, closeModelPicker, pickModel, openModelPicker, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, closeHelp, clearPrefill, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, acceptBypassConsent, refuseBypassConsent, applyMode, setThink, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir } = useChat(makeSession, { ...(hookOpts ?? {}), cwd, initialResume, initialEntries, initialPrompt, onExit: exit, detach: client.kind === "attached" ? () => { onDetach?.(); exit(); } : undefined, clearStaticTranscript, noticeBridge }, deps);
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
  // BOTH STAY FUNCTION-VALUED. `ChatComposer` calls `columns()` per render on purpose (ChatComposer.tsx:252):
  // a plain number would be a prop identity that only changes when the parent re-renders for another reason.
  const terminalColumns = () => size.columns;
  const terminalRows = () => size.rows;
  const queueWidth = Math.max(8, terminalColumns() - QUEUE_PAD * 2);
  const [exitArmed, setExitArmed] = useState(false);
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
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
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
      : state.bypassConsent.open || state.helpOpen || state.historyOpen || state.rewinding || state.rewindPicker.open || state.bgPanelOpen || state.modelPicker.open || state.settings.open || state.permissions.open || state.themeDialog.open || state.addDir.open || state.picker.open
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
  const exitArmedRef = useRef(exitArmed); exitArmedRef.current = exitArmed;
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
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => { setExitArmed(false); if (disarmTimer.current) { clearTimeout(disarmTimer.current); disarmTimer.current = null; } };
  useEffect(() => () => { if (disarmTimer.current) clearTimeout(disarmTimer.current); }, []);
  // Esc-Esc rewind arming (mirrors the Ctrl-C double-press pattern above): busy Esc always interrupts and
  // never arms; an idle Esc arms for 1.5s, and a second Esc within the window opens the rewind picker.
  const [escArmed, setEscArmed] = useState(false);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarmEsc = () => { setEscArmed(false); if (escTimer.current) { clearTimeout(escTimer.current); escTimer.current = null; } };
  useEffect(() => () => { if (escTimer.current) clearTimeout(escTimer.current); }, []);
  // A turn start revokes the arm: otherwise the "Press Esc again" hint outlives the idle moment it was
  // armed in and renders during a busy turn. Keyed on state.busy (not on onSubmit) so a turn started by
  // ANOTHER attached client revokes it too.
  useEffect(() => { if (state.busy) disarmEsc(); }, [state.busy]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onInterrupt = () => {
    disarm();
    if (state.busy) { interrupt(); disarmEsc(); return; }              // busy: Esc stays interrupt, never arms
    if (escArmed) { disarmEsc(); void openRewind(); return; }
    setEscArmed(true);
    if (escTimer.current) clearTimeout(escTimer.current);
    escTimer.current = setTimeout(() => setEscArmed(false), 1500);
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
    "app:interrupt": () => {                                    // interrupt a turn, else arm/confirm exit (CC)
      if (rootStateRef.current.busy) { interruptRef.current(); disarm(); return; }
      if (exitArmedRef.current) { exitRef.current(); return; }
      setExitArmed(true); if (disarmTimer.current) clearTimeout(disarmTimer.current); disarmTimer.current = setTimeout(() => setExitArmed(false), 2000);
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
  const pagerUp = transcriptOpen;
  return (
    <Box flexDirection="column">
      <Transcript key={state.staticEpoch} staticItems={state.staticItems} pendingItems={pagerUp ? EMPTY_ITEMS : state.pendingItems} streaming={pagerUp ? EMPTY_LINES : state.streaming} />
      {todosOpen && !pagerUp ? <TaskPanel tasks={state.tasks} columns={terminalColumns()} rows={terminalRows()} /> : null}
      {/* Wave T Task 13 — the live-turn indicator is ONE slot. Canon `qyn` (L407975, mounted at L407973)
          takes the whole slot over while a retry status exists, so the row REPLACES the spinner rather than
          sitting beside it: a spinner still pulsing next to "Retrying in 4s" is exactly the "nothing is
          wrong" reading the QA fleet's 72-second outage produced. */}
      {state.busy && !pagerUp
        ? (state.retryStatus ? <RetryRow status={state.retryStatus} /> : <TurnSpinner startedAt={state.turnStartedAt} tokens={state.turnTokens} />)
        : null}
      {/* F4 Task 8 — upstream `wqo` (pack §7.7, bundle L426002–426022): a queued prompt is the ORDINARY
          prompt echo wrapped in `<Box paddingX={$jp}>` with `$jp = 2`, and nothing else. It carries no
          prefix, no clip and no dimming (the `subtle` flip at L426034 lives inside the brief-layout branch,
          which this clone does not model) — so our `⋯ queued: ` + 60-char clip was an over-ship on both
          counts and dies here. The band is minted at `columns - 2*QUEUE_PAD`, which reproduces upstream's
          queued rule inset exactly: it hands `Sg` a padding of `3 + paddingWidth` = 7 where a normal
          message hands 3, and `paddingWidth` is `paddingX * 2` = 4. */}
      {state.queue.length > 0 && !pagerUp ? (
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
              ? <ModelPicker models={state.modelPicker.models} current={state.modelPicker.current} sessionModel={state.modelPicker.sessionModel}
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
                    onDone={closeSettings} applyMode={applyMode} setThink={setThink} applyOutputStyle={applyOutputStyle}
                    fetchStatus={fetchSettingsStatus} fetchUsage={fetchSettingsUsage} fetchStats={fetchSettingsStats}
                    onOpenModelPicker={openModelPicker} savePrefs={deps?.savePrefs} />
                : state.permissions.open
                ? <PermissionsDialog tab={state.permissions.tab ?? "Allow"} onTabChange={setPermissionsTab}
                    denials={state.denials} cwd={cwd}
                    fetchSettings={fetchPermSettings} fetchDirs={fetchPermDirs}
                    addRule={addPermRule} removeRule={removePermRule} removeDir={removeWorkspaceDir}
                    addDirValidate={addDirValidate} confirmAddDir={confirmAddDir} cancelAddDir={cancelAddDir}
                    onDone={closePermissions} />
                : state.themeDialog.open
                ? <ThemeDialog onDone={closeThemeDialog} savePrefs={deps?.savePrefs} />
                : state.addDir.open
                  ? <AddDirDialog prefill={state.addDir.prefill} onValidate={addDirValidate} onConfirm={confirmAddDir} onCancel={cancelAddDir} />
                  : state.picker.open
                  ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker}
                      loadMessages={previewSession} renameSession={renamePickedSession} rows={terminalRows()} columns={terminalColumns()} />
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
                      submitCount={state.submitCount} hasMessages={state.hasMessages} queueHintCountedRef={queueHintCountedRef} placeholderMemoRef={placeholderMemoRef} />}
      {exitArmed ? <Box paddingX={1}><Text dimColor>Press Ctrl-C again to exit</Text></Box> : null}
      {escArmed ? <Box paddingX={1}><Text dimColor>Press Esc again to rewind</Text></Box> : null}
      {/* `composerOwnsKeys` is the SAME render-time disjunction the composer's own guard reads, handed to the
          bar as a prop: its mode-chip parenthetical advertises a Chat-context key, so it must vanish the frame
          a dialog or overlay takes the keyboard. A prop and not a registry read, because this value is derived
          from state during render and therefore repaints with it — see ChatStatusBar's own header. */}
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} thinkLevel={state.thinkLevel} bgCount={state.bgTasks.length} usageWarn={state.usageWarn} composerOwnsKeys={composerOwns(inputOwnerRef.current)} />
    </Box>
  );
}
