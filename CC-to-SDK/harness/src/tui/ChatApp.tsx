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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import { suspendProcess } from "./suspend.js";
import { useBindingLookup, useKeyActions, useKeyScope, useKeySuspend, useMouseSink, useSuspendInput, useSwallowKeys } from "./keys/KeymapProvider.js";
import { createDoublePress, DOUBLE_PRESS_WINDOW_MS, type DoublePress, type DoublePressDeps } from "./keys/doublePress.js";
import { formatBindings, UNBOUND } from "./keys/hints.js";
import type { InitialResume } from "./commands.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import { Transcript } from "./Transcript.js";
import { FullscreenFrame, dockCap, seamCap } from "./FullscreenFrame.js";
import { todoPanelRows } from "./taskPanelModel.js";
import { FullscreenViewport, type ViewportHitmap } from "./FullscreenViewport.js";
import type { MouseInputEvent } from "./keys/types.js";
import { RegionPager } from "./RegionPager.js";
import { dumpTranscript } from "./transcriptDump.js";
import { editExternal, openInEditor } from "./externalEditor.js";
import { mainWindowCap, selectLiveWindow, WINDOW_SLACK } from "./liveWindow.js";
import { popupHeight } from "./suggestPopup.js";
import { streamingItems } from "./streamingItems.js";
import { paintedHeight } from "./wrapItems.js";
import { renderItemHeight } from "./pager.js";
import { clearViewport } from "./clearViewport.js";
import { physicalRows } from "./resizeRepaint.js";
import { Line } from "./Line.js";
import { userEchoLines } from "./render.js";
import { indentRenderLine } from "./agentProgress.js";
import { PaletteHost, PaletteSlot } from "./paletteSlot.js";
import { ChatComposer, composerOwns, type InputOwner, type PlaceholderMemo } from "./ChatComposer.js";
import { initialEditorState, type EditorState } from "./editor.js";
import { pushHistory } from "./editorHistory.js";
import { composerMode } from "./promptMode.js";
import type { HistEntry } from "./historySearch.js";
import { isEditableQueueEntry } from "./queue.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { QuestionDialog } from "./QuestionDialog.js";
import { PlanDialog } from "./PlanDialog.js";
import { Footer, footerRows, type FooterStatusInput } from "./Footer.js";
import type { StatusLineConfig } from "./statusLine.js";
import type { PromptLatch } from "../hooks/promptLatch.js";
import type { RendererChoice } from "./renderer.js";
import { reducedMotion } from "./motion.js";

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
import type { ProgressBar } from "./progressBar.js";
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
/** The same two columns as a string — D14 folds them into the line rather than into a Box (see `queuedItems`). */
const QUEUE_INSET = " ".repeat(QUEUE_PAD);
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
/** FSW T12 — how long the dump's receipt stays on screen. Canon's own `j.setTimeout(() => Fn(""), 4000)`
 *  (L549357), which is half the notification slot's default: the sentence names a path the user either acts on
 *  immediately or does not need. */
const TRANSCRIPT_DUMP_NOTICE_MS = 4000;
/** Stable empties for the transient region while the pager owns the screen — fresh `[]` literals per render
 *  would remount the (empty) region every frame for nothing. */
const EMPTY_ITEMS: readonly RenderItem[] = [];
const EMPTY_LINES: readonly RenderLine[] = [];

/** Physical rows a run of ALREADY-WRAPPED items occupies — one item per row by construction, which is what
 *  `streamingItems` returns and the only thing this may be pointed at. */
const rowsOf = (items: readonly RenderItem[]): number => items.reduce((sum, item) => sum + renderItemHeight(item), 0);
/** …and the same count for a run that has NOT been wrapped (FSW backlog 3). `pendingItems` comes straight
 *  out of `projectPending`, so an open tool call's header or a long argument line is one logical item Ink
 *  paints as several. Undercharged, this subtraction hands the difference straight to the window, which is
 *  the same tall frame by a different route. Measured at `size.columns`, the width that frame paints at. */
const paintedRowsOf = (items: readonly RenderItem[], width: number): number => items.reduce((sum, item) => sum + paintedHeight(item, width), 0);

/** WAVE R TASK 1 (defect i) — the default terminal-resize subscription, REWRITTEN IN THE FSW T3 FIX ROUND
 *  (review C1). Two things about it are now load-bearing, and both are about ORDER rather than about the
 *  callback:
 *    · It subscribes to the stream INK ITSELF was given, not to `process.stdout`. Those are the same emitter
 *      in production (chatMain hands Ink a Proxy whose `on`/`prependListener` are bound to the real tty), but
 *      only the first of them is the one a test can resize.
 *    · It PREPENDS. Ink registers its own `resize` handler in its constructor (`ink.js:77`), i.e. while
 *      `render()` is running, and that handler re-lays-out and RE-SERIALIZES the existing element tree
 *      synchronously — `resized = () => { this.calculateLayout(); this.onRender() }` — checking
 *      `outputHeight >= stdout.rows` (`ink.js:121`) as it goes. This component subscribes from a passive
 *      effect, which is strictly later, so an appended listener would always run AFTER Ink had already
 *      measured the OLD tree against the NEW row count. On a shrink that is the tall-frame branch firing on
 *      the one frame the whole wave exists to protect: measured at 40 → 24 rows with a full window, one
 *      `clearTerminal` write and a 44-row frame against a 24-row terminal.
 *      Prepending closes it because Ink runs React in LEGACY mode (`ink.js:59`, `createContainer(…, 0, …)`),
 *      where a `setState` from a plain event callback flushes synchronously: the size lands, React re-renders
 *      and re-commits (and Ink's `resetAfterCommit` re-lays-out and writes) before Node reaches Ink's own
 *      handler, which then finds a tree that already fits. Measured on the same scenario: zero tall writes.
 *  PRODUCTION DOES NOT TAKE THIS PATH — `chatMain` passes its own `onResize`, because it has a listener that
 *  must stay ahead of this one (it latches "a tall write was outstanding at this signal" off the screen Ink
 *  is about to repaint). This default is what any other embedder, and the test that measures the bound, get. */
const subscribeToStdoutResize = (stream: NodeJS.WriteStream | undefined) => (cb: () => void): (() => void) => {
  const target = stream ?? process.stdout;
  target.prependListener("resize", cb);
  return () => { target.off("resize", cb); };
};

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

export function ChatApp({ makeSession, client, onDetach, initialPrompt, hookOpts, cwd, initialResume, initialEntries, clearStaticTranscript, noticeBridge, deps, yankHintMs, escClearMs, typingIdleMs = TYPING_IDLE_MS, initialTodosOpen = true, suspend, resumeOutput, resyncViewport, onResize, doublePressDeps, name, terminalTitle, progressBar, renderer, switchRenderer, selectRenderer, aroundSubprocess, altHandoff }: {
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
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialEffort?: string; initialOutputStyle?: string; initialShowTurnDuration?: boolean; initialPromptSuggestionEnabled?: boolean; initialPrefersReducedMotion?: boolean; initialTerminalProgressBarEnabled?: boolean; statusLine?: StatusLineConfig; promptLatch?: PromptLatch; rendererChoice?: RendererChoice };
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
  resumeOutput?: { repaint: (runInkWrite: () => void) => void; tallWrites?: () => number; screenResynced?: () => void;
    /** W2 t7 — the one-shot "a tall write was outstanding when SIGWINCH arrived" latch, and the frame Ink last
     *  wrote through log-update (i.e. its own `lastOutput`), which is what the forced repaint will push back. */
    takeTallAtSignal?: () => boolean; lastFrame?: () => string | undefined };
  /** WAVE R TASK 8 — the viewport reset that recovers from Ink's tall-frame branch, defaulting to the real
   *  `clearViewport` over Ink's own stdout. A seam for the reason every other one here is: `ink-testing-library`
   *  renders with `debug: true`, whose stdout stub is not a tty, so the real reset short-circuits to `false` and
   *  a test could not tell "recovered" from "declined to". Returns whether anything was written. */
  resyncViewport?: () => boolean;
  /** WAVE R TASK 1 — subscribe to terminal resizes; returns the unsubscribe. A seam for the same reason
   *  `suspend` is one: a test cannot resize `ink-testing-library`'s fake stdout, and the default
   *  (`subscribeToStdoutResize`, above) listens on Ink's own tty.
   *  FSW T3 FIX ROUND — `chatMain` now PASSES this rather than falling through to the default, and the
   *  reason is ordering: whatever drives this callback must run before Ink's own resize handler, and
   *  chatMain already owns a listener that must run before BOTH. See `subscribeToStdoutResize` for the
   *  measurement and chatMain's `onTerminalResize` for the chain.
   *  MUST HAVE A STABLE IDENTITY across the caller's renders — a module- or call-scoped function (as both
   *  the default and chatMain's are, for exactly this reason) or a `useCallback`, never an inline arrow. The
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
  /** T-CH34 — the OSC 9;4 progress-bar driver, created by `chatMain` exactly as `terminalTitle` is (a
   *  process-level concern, its capability gate resolved once at boot) and merely DRIVEN here: one effect
   *  ANDs the `terminalProgressBarEnabled` setting with `state.busy` (the turn-lifecycle seam this file
   *  already owns at `terminalTitle`'s `setBusy` effect below — one derivation, not a second busy tracker)
   *  and lets the driver's own change-dedupe decide whether anything is written. Absent in component tests
   *  and absent by construction for a daemon/HOST session, same as `terminalTitle`. */
  progressBar?: ProgressBar;
  /** FSW TASK 9 — WHICH RENDERER THIS TREE IS PAINTING INTO. A PROP, and deliberately not a `hookOpts` field or
   *  a context: `/tui` (T15) flips it on a LIVE session, and the one thing that flip may not do is unmount this
   *  component — the transcript, the composer draft, every dialog's internal state and the keymap registry's
   *  mount order all live in here. A prop at a stable element position is the only shape that survives it
   *  (plan review C5), so `chatMain` holds the choice as state above this element and never keys or wraps it.
   *    Absent means classic, which is what every embedder and every component test that does not care gets.
   *    THIS PROP IS THE ONE LIVE VALUE, AND `hookOpts.rendererChoice` IS NOT (T15 retiring T9's annotation).
   *  `hookOpts` is assembled once at boot and never moves, so after a `/tui` it names the renderer the session
   *  STARTED on; `/status` would then report a screen the user is no longer looking at. The prop wins where the
   *  two meet — see the `useChat` call below, which overrides the hook's copy with this one — so there is again
   *  a single answer to "which renderer is painting", and it is this. */
  renderer?: RendererChoice;
  /** FSW T15 — `/tui`'s FLIP, owned above this tree. The mode is React state in `chatMain`'s `ChatRoot`, because
   *  the two things a flip must do before the next paint — take or hand back the alternate screen, and move the
   *  live mode every process-level consumer reads (the output proxy's screen rules, the resize chain's readers)
   *  — are `runChatClient`'s, not this component's. Given the requested SETTING this re-runs the boot ladder and
   *  returns the choice now in force, which may not be the one asked for: a rung above the settings rung (a
   *  pipe, a screen reader, an env lever) still wins, and the caller prints what actually happened.
   *    Absent for every embedder and component test, where `/tui` saves the pref and says so. */
  switchRenderer?: (tui: "fullscreen" | "default") => RendererChoice;
  /** EXTERNAL REVIEW, FINDING 3 — the same ladder as `switchRenderer`, asked without performing the flip
   *  (`RendererSwitch.select`). `/tui`'s busy refusal has to know whether the request would move the SCREEN,
   *  and a rung above the settings rung can mean it would not. Threaded from `chatMain` beside its sibling,
   *  and absent in exactly the same places. */
  selectRenderer?: (tui: "fullscreen" | "default") => RendererChoice;
  /** FSW TASK 12 — T6's `guard.aroundSubprocess`, threaded down for EVERY child this tree hands the terminal
   *  to: the `v` dump's editor, and (t12 review, I1) the composer's ctrl+g / ctrl+x ctrl+e and the plan
   *  dialog's ctrl+g, all of which must run with the main screen in front of them. A prop rather than a
   *  context for the same reason `renderer` is one, and absent everywhere the guard is (classic launches,
   *  embedders, component tests) — where the guard would be inert anyway, since it is armed only by the
   *  fullscreen renderer. Every consumer below takes it through `aroundChild`, which owes the return leg one
   *  more thing (backlog 4); nothing reads this prop directly. */
  aroundSubprocess?: <T>(run: () => T) => T;
  /** FSW T14, AMENDMENT 3 — T6's `guard.handoff`, the same terminal handoff `aroundSubprocess` wraps, opened
   *  up so ctrl+z can hold its two halves across the SIGTSTP/SIGCONT round trip. Threaded from `chatMain`
   *  beside `aroundSubprocess`; absent wherever the guard is (classic launches, embedders, component tests),
   *  and inert on a main-screen launch, where the guard is never armed. */
  altHandoff?: () => () => void;
}) {
  const { exit } = useApp();                                        // declared FIRST: /exit hands it to useChat
  // suspend.ts needs the REAL tty object, not Ink's ref-counted `setRawMode` function — see that module's
  // header comment for why the ref-counted one is a no-op here. `write` (real repaint, same reasoning).
  const { stdin } = useStdin();
  const { stdout, write } = useStdout();
  /** FSW TASK 9 — the one derivation of the renderer choice this file makes; everything below reads THIS.
   *  It sits up here, above the first consumer, because backlog 4's handoff wrapper is one. */
  const fullscreen = renderer?.mode === "fullscreen";
  const fullscreenRef = useRef(fullscreen); fullscreenRef.current = fullscreen;
  const resumeOutputRef = useRef(resumeOutput); resumeOutputRef.current = resumeOutput;
  /** THE ONE FORCED FRAME, and it has two readers: ctrl+z's resume (below) and every subprocess handoff
   *  (`aroundChild`). Ink's `useStdout().write` IS `writeToStdout` — `log.clear()` → `stdout.write(data)` →
   *  `log(this.lastOutput)` — and that third call is the one render log-update cannot dedupe, because the
   *  `clear()` one line earlier just set `previousOutput = ''` (full derivation in `clearViewport.ts`, note 2).
   *  `resumeOutput.repaint` is the output proxy's "this write is a deliberate repaint" bracket; absent (an
   *  embedder, a component test with no proxy) the write still goes, unrecorded.
   *    UNDER CI IT IS A NO-OP, which is Ink's choice and not a gap here: `writeToStdout` takes an `isInCi`
   *  branch that writes `data` and returns WITHOUT the `log(this.lastOutput)` re-emit (ink/build/ink.js:141),
   *  and `data` is our empty string — so the frame is not repainted. Same for the ctrl+z resume path, which
   *  has always been written this way, and it costs nothing: a CI run has no alternate screen to blank. */
  const forceRepaint = useCallback(() => {
    const paint = () => write("");
    const output = resumeOutputRef.current;
    if (output) output.repaint(paint); else paint();
  }, [write]);
  /** FSW BACKLOG 4 — THE HANDOFF, PLUS THE FRAME THE RETURN LEG OWES. `handoff()`'s return call writes
   *  `ENTER_ALT`, which ends in `2J`+`H`: the alternate screen a child hands back is BLANK, while Ink's
   *  log-update counters still describe the frame from before it. If the child changed nothing the tree
   *  renders (an editor quit unsaved, `/keybindings` closed unchanged, a plan left as written), BOTH of Ink's
   *  dedupes fire and not one byte is written — the user sits looking at an empty screen until the next
   *  keystroke. So the repaint is owed by the RETURN itself, not by the caller, and it is `finally`: a child
   *  that threw leaves the same blank screen, and the composer swallows that throw.
   *    Gated on the LIVE renderer mode (through a ref, so a `/tui` flip does not churn the identity every
   *  consumer below memoizes on) because that is exactly when the guard is armed — T15's `leave()` disarms on
   *  the flip to classic, where the handoff writes nothing, nothing was cleared, and a forced frame would be
   *  a write the main screen never used to get.
   *    NOT in `altScreen.ts`: that module is Ink-free by design. And not double-painted on ctrl+z — suspend
   *  takes `handoff` directly and hands it `forceRepaint` itself, so it never comes through here. */
  const aroundChild = useMemo(() => {
    const around = aroundSubprocess;
    if (!around) return undefined;                                  // no guard handed down: nothing to wrap, nothing to repaint
    return <T,>(run: () => T): T => {
      try { return around(run); } finally { if (fullscreenRef.current) forceRepaint(); }
    };
  }, [aroundSubprocess, forceRepaint]);
  // FSW T12 RE-REVIEW — `/keybindings` IS AN EDITOR TOO, and it is the one that is not a key. useChat's own
  // default calls `openInEditor` with no `around` (useChat.ts:653), so the slash command that hands the user
  // their `~/.claude/keybindings.json` was still spawning its child ONTO the alternate screen: the editor's own
  // rmcup on exit drops the terminal to the main screen while the guard believes it holds the alt one, and the
  // next frame paints over the user's shell scrollback. Same defect and same seam as the composer's ctrl+g
  // below (`EditorIO.around`) — wired HERE because this is where `aroundSubprocess` arrives and where useChat's
  // `deps` are assembled; `chatMain` builds no deps object of its own.
  //   AN INJECTED `openEditor` STILL WINS, so every test that fakes the opener is untouched.
  // TOOL-STREAM T5 — AND THE RENDERER IDENTITY RIDES THE SAME SEAM. The fold policy needs to know which screen
  // it is drawing for (a fullscreen transcript collapses non-read shell calls and drops the `(ctrl+o to expand)`
  // chip), and this is where useChat's `deps` are assembled, so the answer is handed over here.
  //   IT IS *THIS FILE'S* `fullscreen`, NOT `hookOpts.rendererChoice`, and that is deliberate rather than an
  // oversight of the channel useChat already has: `rendererChoice` is assembled once at boot and can be absent
  // on a mount that is painting fullscreen all the same, while the `renderer` prop this derives from is the one
  // live value `/tui` moves and the one the fullscreen tree at the bottom of this file is mounted on. So
  // `rendererChoice` answers "what did we boot as" (it is `/status`'s source) and this answers "what is on
  // screen now", which is the only one a row may fold against. Reads through `fullscreenRef` so the function
  // stays stable across a flip while the answer does not.
  const isFullscreen = useCallback(() => fullscreenRef.current, []);
  const chatDeps = useMemo(() => ({
    ...deps,
    ...(deps?.isFullscreen ? {} : { isFullscreen }),
    ...(aroundChild && !deps?.openEditor ? { openEditor: (file: string, prepare: () => void) => openInEditor(file, { prepare, around: aroundChild }) } : {}),
  }), [deps, aroundChild, isFullscreen]);
  const { state, detailItems, publishLiveWindow, toggleFold, submit, popQueueToComposer, resolveDecision, cycleMode, interrupt, closePicker, pickSession, reloadSessions, previewSession, renamePickedSession, closeModelPicker, pickModel, openModelPicker, closeEffortDialog, confirmEffort, applyEffort, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, closeHelp, clearPrefill, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, acceptBypassConsent, refuseBypassConsent, applyMode, setThink, setShowTurnDuration, setPrefersReducedMotion, setTerminalProgressBarEnabled, setPromptSuggestionEnabled, noteSuggestionSlot, acceptSuggestion, abortSuggestion, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir, notifications, notify, dismissNotification } = useChat(makeSession, { ...(hookOpts ?? {}),
    // FSW T15 — THE LIVE RENDERER OVERRIDES THE BOOT ONE, and this line is the whole of T9's second hand-off.
    // `hookOpts.rendererChoice` is assembled once in `runChatClient`; the prop is what `/tui` moves. Spread
    // AFTER the hook options so the flip wins, and only when there is a prop to win with — a mount that
    // passes neither leaves `/status` exactly as silent about the renderer as it always was.
    ...(renderer ? { rendererChoice: renderer } : {}), ...(switchRenderer ? { switchRenderer } : {}), ...(selectRenderer ? { selectRenderer } : {}),
    cwd, initialResume, initialEntries, initialPrompt, onExit: exit, detach: client.kind === "attached" ? () => { onDetach?.(); exit(); } : undefined, clearStaticTranscript, noticeBridge }, chatDeps);
  // WAVE R TASK 1 (defect i) — the terminal's SIZE IS REACT STATE. Ink's own SIGWINCH handler
  // (node_modules/ink/build/ink.js:83) re-runs Yoga layout over the EXISTING element tree and re-serializes
  // it; it never re-renders components. Nothing in ccx subscribed to "resize" at all, so the reads below
  // happened only when something else caused a render and every width-derived string in the tree froze at
  // the launch width. The subscription sets this state, React re-renders, and the two readers hand the
  // fresh numbers to their consumers.
  //   · `deps.columns` still comes FIRST, for the same reason useChat prefers it — the frame-capture fixture
  //     and the tests pin a width; the resize event is when we go back and ask it again.
  //   · The HEIGHT gained the same seam in FSW Task 3 (plan review I4), and for a stronger reason than the
  //     width had: the terminal's row count is now an INPUT to what gets committed to scrollback and what
  //     stays live, and `ink-testing-library`'s stdout stub reports no `rows` at all — so without it every
  //     component test would be stuck at the 24-row POSIX default and the boundary could be pinned at no
  //     other geometry. Same precedence as the width: the injected reader first, the real terminal next.
  const readSize = () => ({ columns: deps?.columns?.() ?? stdout?.columns ?? 80, rows: deps?.rows?.() ?? stdout?.rows ?? 24 });
  const readSizeRef = useRef(readSize); readSizeRef.current = readSize;      // the effect below runs once; the reader must not be a mount-time closure
  const [size, setSize] = useState(readSize);
  //   · RESAMPLE ONCE AFTER SUBSCRIBING (review finding). The read above happens during RENDER; the listener
  //     only attaches here, a commit later. A resize landing in that window fires no callback — nothing is
  //     subscribed yet — and the state would stay wrong until the next resize. The functional update returns
  //     the PREVIOUS object when nothing moved, so the extra sample costs a comparison and no render, and the
  //     same guard de-duplicates any later resize event that reports an unchanged size.
  const subscribeResize = useCallback(onResize ?? subscribeToStdoutResize(stdout), [onResize, stdout]);
  useEffect(() => {
    const sample = () => setSize((prev) => nextSize(prev, readSizeRef.current()));
    const off = subscribeResize(sample); sample(); return off;
  }, [subscribeResize]);
  // WAVE C TASK 8 (EP-C4a) — THE TERMINAL TITLE'S MOUNT SITE. Two effects, because the title text and the
  // busy prefix change on completely different cadences and upstream re-emits on either (`CVe`'s deps are
  // the composed string). The writer dedupes, so the first pass here is the launch emission (`✳ ccx`, or
  // `✳ <--name>`) and every later pass is a no-op until something actually moves.
  //   The LADDER is resolved here rather than in `useChat` because `name` is a launch fact the hook never
  // sees, and it belongs beside the writer it feeds.
  const titleText = resolveTerminalTitle({ renameTitle: state.renameTitle, aiTitle: state.aiTitle, name });
  useEffect(() => { terminalTitle?.setTitle(titleText); }, [terminalTitle, titleText]);
  useEffect(() => { terminalTitle?.setBusy(state.busy); }, [terminalTitle, state.busy]);
  // T-CH34 — canon's driver effect (`m6h` + its `[ut, or, f, gt]` deps, research report §2), transcribed
  // one line below the title's own busy effect: `active` is `state.busy` alone (ccx tracks no in-flight-tool
  // set the way canon's `hasToolsInProgress` does — recorded omission, not an invented second signal).
  useEffect(() => { progressBar?.update({ enabled: state.terminalProgressBarEnabled, active: state.busy }); }, [progressBar, state.terminalProgressBarEnabled, state.busy]);
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
   *  understand instead of two — INCLUDING the consumed marker, which lives in an app-scoped ref next to
   *  `consumedPrefillTokenRef` below.
   *
   *  FINAL REVIEW, FINDING 1 — that marker used to be composer-local and seeded from the live token, on the
   *  premise that "a Ctrl-C pressed while a dialog owned the screen has no draft to clear". The premise was
   *  false: the draft is parked in `editorStateRef` for the whole life of the dialog and painted again when
   *  the composer remounts, so the bump had a real buffer waiting for it and the seeding is precisely what
   *  marked that bump as spent. App-scoped, the cursor still cannot fire one bump twice — which is the
   *  property the seeding was reaching for — and a clear pressed behind a dialog now lands on the way back. */
  const [clearDraftToken, setClearDraftToken] = useState(0);
  const consumedClearTokenRef = useRef(0);
  // WAVE C TASK 2 — the composer's half of the footer (the four early-return states plus the draft signal).
  // It lives up here rather than in the composer for the same reason the typing debounce does: the composer
  // is unmounted by every dialog, and its own cleanup reports IDLE so nothing stale survives the unmount.
  const [footerState, setFooterState] = useState<ComposerFooterState>(IDLE_COMPOSER_FOOTER_STATE);
  // THE SUGGESTION POPUP'S ROWS, held here because the live window's cap has to pay for them (see the
  // `windowItems` memo). A boolean, reported synchronously from the composer's `commitState` — the height
  // itself is `popupHeight(rows)` and is re-derived per render, so a resize needs no second report.
  const [suggestOpen, setSuggestOpen] = useState(false);
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
  //    composer through the clear channel below. The clear and the arm are ONE press, not alternatives —
  //    BUT ONLY FOR A FOCUSED COMPOSER (Wave 2 t3 fix, review M1). Canon splits the gesture across two call
  //    sites of ONE latch factory: the composer's `V` (L395616) passes that `onFirstPress`, while the
  //    dialog/overlay pair `h5u` (L183477) calls `Pee(setState, exitFn)` (L183445) with the third
  //    `onFirstPress` parameter simply absent — over a dialog the first press arms and does nothing else.
  //    ccx had merged the two into this single arm, so once t3 let ctrl+c fall THROUGH an overlay, a press
  //    meant only to arm silently emptied the draft parked in `editorStateRef` behind that overlay.
  //    `composerOwns(inputOwnerRef.current)` is the gate, and it is the same derivation the footer's
  //    `composerOwnsKeys` reads: true for "composer" and for "typing" (the suppressed-decision state, where
  //    the composer keeps both the screen and the keyboard and so still has a visible draft to clear), false
  //    for every overlay, the pager, shortcuts, and a SHOWN decision dialog — which retires the clear those
  //    dialogs used to fire for the same canon reason.
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
    onFirstPress: () => { if (composerOwns(inputOwnerRef.current)) setClearDraftToken((n) => n + 1); },
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
  //   FSW T14, AMENDMENT 3: and it runs inside the alt-screen handoff. Without it a fullscreen ctrl+z stopped
  // the process with the smcup still standing, so the shell drew its prompt onto OUR alternate screen — and
  // `fg` then wiped that prompt along with everything the user had typed at it. SIGTSTP is deliberately NOT in
  // `cli/main.ts`'s signal set (that handler drains `beforeExit` and exits); this path owns it, and the guard's
  // teardown is untouched by it — `handoff` leaves `armed` true, so a kill arriving while we are STOPPED still
  // finds a guard willing to write rmcup.
  useKeySuspend(() => {
    (suspendRef.current ?? suspendProcess)({ stdin, stdout, ...(altHandoff ? { handoff: altHandoff } : {}), repaint: forceRepaint });
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
  //   WAVE 2 TASK 7 (s2qa2-05) — AND THE REPAIR NOW HAS A SECOND EDGE, so the WRITE is shared and the gates are
  // not. Both edges answer the same question — is the viewport holding nothing but a tall chunk's own bytes —
  // but they have to ask it at different instants, because Ink's repaint sits between them: the pager close is
  // an event of the app's own and reads the count live, while the grow is an event of the TERMINAL's that Ink
  // handles first, and by the time React runs the count it would read has already been stood down (see the
  // second edge below). One shared `resyncViewportNow`; two gates, each measuring at the only moment it can.
  //   FSW TASK 9 — AND IT DOES NOT RUN AT ALL ON THE ALTERNATE SCREEN (T8 review, obligation A). Two reasons,
  // and only the first is the one this gate is for. (1) THE REPAIR HAS NOTHING TO REPAIR: everything above is a
  // recovery from Ink's tall-frame branch, and the fullscreen frame is fixed at `rows − 1`, so `outputHeight >=
  // stdout.rows` never fires, no tall chunk ever reaches the pane, and `tallWrites()` is 0 for the life of the
  // process. Both gates below already read that count and would decline — so the erase is dead code there BY
  // THE FRAME CONSTRAINT, and this line makes it dead BY CONSTRUCTION, which is the difference between an
  // invariant and a coincidence. (2) The fallback's payload would be the WRONG ARM besides: `clearViewport`
  // defaults to `eraseViewport(rows)`, the main-screen half of the D6 split (clearViewport.ts:74), and the
  // alternate screen's arm is `Rms()`. Threading the mode in would have fixed the bytes and left a viewport
  // wipe armed on a screen where the only thing that could ever fire it is a bug in the frame — so the gate is
  // the honest shape and the thread is not. A `resyncViewport` INJECTED by a test still runs on the classic
  // path, which is how the pin below can tell "declined" from "not wired".
  const resyncViewportNow = (): void => {
    if (fullscreen) return;
    const output = resumeOutputRef.current;
    if ((resyncViewport ?? (() => clearViewport({ stdout, write })))()) output?.screenResynced?.();
  };
  const resyncTallScreen = (): void => {
    if (!(resumeOutputRef.current?.tallWrites?.() ?? 0)) return;
    resyncViewportNow();
  };
  const resyncTallScreenRef = useRef(resyncTallScreen); resyncTallScreenRef.current = resyncTallScreen;
  const transcriptWasOpen = useRef(false);
  useEffect(() => {
    const closed = transcriptWasOpen.current && !transcriptOpen;
    transcriptWasOpen.current = transcriptOpen;
    if (closed) resyncTallScreenRef.current();
  }, [transcriptOpen]);   // eslint-disable-line react-hooks/exhaustive-deps
  // WAVE 2 TASK 7 (s2qa2-05) — THE SECOND EDGE: THE TERMINAL GREW WHILE A TALL WRITE IS STILL OUTSTANDING. A
  // `/model` picker in a 60x15 pane is at least as tall as the pane, so its frame takes ink.js:118 and log-update
  // is bypassed; growing the pane then leaves the picker's header stranded above Ink's live frame, and every
  // mechanism ccx has declines by construction — the write-time corrector has no recorded frame (the proxy drops
  // it on a tall chunk) and requires a NARROWING besides, and the edge above is the pager's alone (the residual
  // named at :470). The measured behaviour is that the fragment survives Esc, a keystroke and a pager cycle.
  //   NO REFLOW-VERDICT PRECONDITION, deliberately. The verdict only ever exists after a narrowing — this edge is
  // a GROW — and it is not what bounds this erase anyway: the reflow correction erases upward by a computed depth
  // and needs a measurement to justify it, while `clearViewport` blanks the viewport and nothing else. Viewport-
  // bounded is scrollback-safe by construction, and the forced repaint through Ink's `writeToStdout`
  // (clearViewport.ts:40-56) leaves log-update's counters describing what it painted.
  //   AND THE STAND-DOWN IS NOT LOOSENED — BUT THE FACT IS READ BEFORE INK CAN ERASE IT (fix round 1, finding 1).
  // `tallWrites()` falls to 0 on any recorded frame write (chatMain.tsx:134-149), and the write that stands it
  // down here is Ink's own synchronous handling of this same SIGWINCH (`ink.js:83` → `onRender`, which on a grow
  // that lets the frame fit again goes out through log-update) — the very write that strands the header rows.
  // React commits and flushes passive effects only afterwards, so a live read here is a read taken after the
  // evidence was destroyed, and the shipped edge could not fire in the scenario it was written for. What runs
  // FIRST is ccx's own resize listener (attached ahead of Ink's, chatMain.tsx's `onTerminalResize`), so the
  // proxy latches the count there and this reads the latch, one-shot. The stand-down, and the t8 over-erase
  // trade behind it, are exactly as they were.
  //   AND THE REPAINT IS BOUNDED BY THE VIEWPORT IT REPAINTS INTO (finding 4). This is the first caller of
  // `clearViewport` that can run while a tall surface is still up, and `writeToStdout` pushes Ink's `lastOutput`
  // through log-update with Ink's own `outputHeight >= rows` check bypassed: a frame still taller than the pane
  // would leave `previousLineCount` past the viewport's top, where log-update's next erase cannot reach. The
  // proxy's recorded frame IS that `lastOutput` (recording one is what a log-update write means), so the fit is
  // MEASURED. No recorded frame means Ink's last write bypassed log-update — the surface is still tall, Ink has
  // just repainted the whole screen for the grow, and there is no stranded header to repair.
  //   AN EDGE, NOT A LEVEL, for the third time in this file: `size` only changes identity when the size actually
  // moved (`nextSize`), and the ref below makes the DIRECTION a transition. The first pass compares the mount
  // size with itself, so a boot into a short pane — where every frame goes tall and no recorded frame write ever
  // stands the count down — cannot fire it.
  //   …AND THE LATCH IS DRAINED BY THE OBSERVATION, NOT BY THE GROW (external review, finding C). The fact it
  // carries is "a tall write was outstanding at some signal since React last saw the size" — a burst, because
  // a drag emits several signals per flush and only the first can catch the count standing. Accumulating them
  // is what makes the batched grow fire at all; consuming at EVERY observed size is what stops the
  // accumulation from outliving its burst. A shrink React has already seen must therefore drain it too: left
  // standing there, a much later grow on an ordinary screen would inherit it and wipe live rows (the t8
  // over-erase). Both halves are one sentence — the latch never describes signals React has already answered.
  const resyncAfterGrow = (tallAtSignal: boolean): void => {
    if (!tallAtSignal) return;
    const frame = resumeOutputRef.current?.lastFrame?.();
    if (frame === undefined || physicalRows(frame, size.columns) + 1 > size.rows) return;   // + the park row
    resyncViewportNow();
  };
  const resyncAfterGrowRef = useRef(resyncAfterGrow); resyncAfterGrowRef.current = resyncAfterGrow;
  const sizeWasRef = useRef(size);
  useEffect(() => {
    const prev = sizeWasRef.current; sizeWasRef.current = size;
    const tallAtSignal = resumeOutputRef.current?.takeTallAtSignal?.() ?? false;
    if (size.columns > prev.columns || size.rows > prev.rows) resyncAfterGrowRef.current(tallAtSignal);
  }, [size]);
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

  // ── TOOL-STREAM T10 — THE TAP: PRESS + RELEASE ON ONE CELL, TURNED INTO ONE FOLD TOGGLE ──────────────────
  // Everything this needs was built somewhere else and handed here. T6 decodes an SGR report into a 1-based
  // `(col,row)`; T7 routes it to the innermost `useMouseSink`; T9 publishes, per painted frame, which fold
  // anchor (if any) lives at a cell; T8 turns an anchor into an expansion. What is left — and what only this
  // component can own, because only this component can see all four at once — is the GESTURE and the GATE.
  //
  // THE GESTURE (spec §3.2). A press of button 0 records its cell AND THE CLUSTER PAINTED ON IT; a release on
  // the same cell, still over the same cluster, is a click. Anything else abandons the anchor: a release
  // somewhere else, a modified button, a wheel tick, or the document moving. A second press RE-ARMS at its
  // own cell rather than poisoning the gesture — a swallowed release (a focus change, a tmux pass-through)
  // would otherwise leave the next click dead for no reason the user can see. There is deliberately NO
  // deadline — a terminal reports a press and its release as they physically happen, and a slow click is
  // still a click.
  //   THE ANCHOR IS THE CLUSTER, NOT THE CELL, AND THAT IS THE WHOLE OF THE STALENESS ANSWER. A cell is a
  // coordinate on a screen the document scrolls underneath, and the wheel is neither the only mover nor the
  // common one: with the tail sticky, every message that lands mid-turn slides the document up under a button
  // that is physically still down. A click holds for 60–150 ms, stream deltas arrive far more often than
  // that, and a live turn is exactly when tool clusters appear — so a cell-only rule toggles whichever run
  // happened to slide into place. Comparing the RESOLVED ANCHOR at both ends covers that, the wheel, a
  // keyboard scroll, a re-wrap on resize and a document swap in one comparison, and is strictly stronger than
  // the cell test the coordinates still carry. `fold-click.test.tsx`'s (d′) is the measured repro.
  //   THE ANCHOR IS A REF, not state. It is written from the stdin listener, outside React, and nothing on
  // screen renders differently for a half-finished gesture, so a `useState` here would buy a re-render of
  // the whole tree per mouse-down and change nothing about the frame.
  //   THE WHEEL ARM IS KEPT ANYWAY, and it is not made redundant by the above: it kills a gesture the page
  // has already invalidated at the moment it is invalidated, for the cost of one assignment. IT COMES FROM
  // THE KEY SIDE, and it has to: a tick is a KeyEvent (`wheelup`/`wheeldown` →
  // `scroll:lineUp`/`lineDown`), never a mouse report, so it cannot reach this sink. `FullscreenViewport`
  // owns those two actions — `handlerFor` hands a matched action to the INNERMOST registration, so a
  // duplicate here would never fire — and calls `onWheelTick` from them; see its prop's doc comment.
  //
  // THE GATE (spec §3.3) IS THE INPUT ROUTER, AND IS NOT RE-DERIVED. `composerOwns(inputOwnerRef.current)`
  // already answers "is the transcript the thing the user is currently working with", folding the shortcuts
  // overlay, the pager, every overlay in the chain, and BOTH decision flavours into one value that the whole
  // file reads back. A gate rebuilt from `paneOwned` (:930, which deliberately EXCLUDES non-plan decisions)
  // and `seamActive` (:1252, overlay plus the plan kind only) would look equivalent and would let a click
  // toggle transcript content behind an inline permission or question dialog — which is the one case §3.3
  // names outright. `fold-click.test.tsx`'s cell (e) exists to fail exactly that rebuild.
  //   THE OTHER TWO TERMS. `fullscreen`, because mouse reporting is armed by the alt-screen enter sequence
  // and the classic renderer never arms it. That term is REDUNDANT TODAY AND KEPT ANYWAY, which is worth
  // stating rather than leaving for someone to "simplify": three separate facts already make a classic click
  // dead — reporting is never armed, the viewport that owns the hitmap handle is not mounted at all, and the
  // map's own renderer gate (T9's published origin) answers `undefined` for every cell. Deleting it leaves
  // the whole `test/tui` suite green, measured. It stays for the reason T9's gate exists: "classic has no
  // click path" should be true by construction, not by three coincidences a later refactor could each
  // remove without noticing. `fold-click.test.tsx`'s classic case says exactly this, including that it
  // cannot falsify the term. And
  // `!footerState.searching`, the composer's own inline reverse-i-search: the owner is still "composer"
  // there (the search lives INSIDE the composer), so the router alone cannot see it — it is the same term
  // the viewport's own `Scroll` context is gated on, for the same reason.
  //   IT IS CHECKED ON EVERY EVENT, not only at press. A dialog that opens between the two halves must not
  // find a live anchor waiting for it, and one that closes must not let a press made underneath it complete.
  //   NOT AN OCCLUSION TEST. ccx has no overdraw — a seam surface makes the dock not render rather than
  // cover it — so the row map underneath a dialog is CURRENT, not stale. The question is ownership, and this
  // is the whole of the answer to it.
  const hitmapRef = useRef<ViewportHitmap>(null);
  const tapAnchorRef = useRef<{ col: number; row: number; anchor: string | undefined } | null>(null);
  const clickable = fullscreen && composerOwns(inputOwnerRef.current) && !footerState.searching;
  const discardTap = useCallback(() => { tapAnchorRef.current = null; }, []);
  useMouseSink((e: MouseInputEvent) => {
    const at = tapAnchorRef.current;
    tapAnchorRef.current = null;                    // every path below either re-arms or leaves it discarded
    if (!clickable) return;
    // Modified clicks are canon's own no-op, and a non-primary button is somebody else's gesture. Both land
    // here rather than in a guard around the press alone, so either one also kills a tap already in flight.
    if (e.button !== 0 || e.ctrl || e.alt || e.shift) return;
    if (e.action === "press") { tapAnchorRef.current = { col: e.col, row: e.row, anchor: hitmapRef.current?.anchorAt(e.col, e.row) }; return; }
    if (!at || at.col !== e.col || at.row !== e.row) return;
    const anchor = hitmapRef.current?.anchorAt(e.col, e.row);
    if (anchor !== undefined && anchor === at.anchor) toggleFold(anchor);
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
  // F8 T6 — READ LIVE, NOT AT STARTUP: a `/config` toggle of `Reduce motion` must take effect on the very
  // next frame, which it cannot do if resolved once in `chatMain`. Computed once per render, here, and
  // handed to all three live-turn indicator components below — `motion.ts`'s `reducedMotion()` is the SAME
  // resolver `chatMain.tsx`'s startup title uses, called against `state.prefersReducedMotion` (useChat's own
  // state, kept live by `setPrefersReducedMotion`), which satisfies its `Pick<CcxPrefs, "prefersReducedMotion">`
  // parameter exactly.
  const motionReduced = reducedMotion({ prefersReducedMotion: state.prefersReducedMotion });
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
  // FSW TASK 3 — THE LIVE WINDOW, DERIVED AT RENDER TIME. `useChat` decided at the last settle which rows
  // are gone for good (they are in `state.staticItems`, written into Ink's append-only <Static>); this
  // decides which of the rows that are LEFT fit on the screen as it is right now. It has to live here, and
  // it has to be a derivation rather than state, for two reasons that are one reason:
  //   · A commit is irreversible, so it must only ever ride a SETTLED geometry. A window is free, so it can
  //     — and must — follow a resize drag frame by frame. Making the same decision once, in reconcile,
  //     would either commit rows on a transient 40-column drag or leave the subtree over its budget for the
  //     whole drag; there is no single cadence that is right for both.
  //   · Ink's own resize handling re-lays-out the existing element tree synchronously (ink.js:83) and the
  //     tall-frame cliff (ink.js:121) is checked on THAT pass. A bound that is only re-evaluated when the
  //     document changes is not a bound at all during the window that matters.
  // Fed the UNPUBLISHED tail only — `liveWindow.ts`'s input contract, and the reason a committed row can
  // never reappear in the live subtree when the terminal grows (it would then be painted twice, once out of
  // `fullStaticOutput` and once out of the frame). `state.staticItems` is BOTH the exclusion set and the
  // signal that the set changed: `publishedIds` is a ref and cannot re-run a memo, but every id it gains is
  // added in the same breath as an append to this array, so its identity is the published-count signal. A
  // Set rather than a length: the two lists agree today, but "published" is an id question and reading it
  // as a prefix length would silently mis-slice the day a projection re-keys an item under it.
  // EMPTY WHILE `paneOwned`, and the rows are COMMITTED rather than hidden (fix round, review I2). The
  // dialog owns the screen and this tree already blanks the pending and streaming regions on that same flag,
  // so the dock budget (`mainWindowCap`'s fourteen rows, measured for the steady state) never has to cover a
  // dialog as well — but blanking ALONE meant that for the whole life of any pane-owning surface the last
  // `rows − 16` rows of transcript simply vanished (eight at 24 rows, twenty-four at 40) and came back when
  // it closed. Before this task those rows were in scrollback ABOVE the dialog and stayed readable. The
  // effect below puts them back there by publishing them: a dialog opening is a SETTLED event, not a drag,
  // so the one-way commit ratchet is honest here in a way it would not be mid-resize. This branch is then
  // only the one-frame belt: the commit runs in a passive effect, so the frame that first paints the dialog
  // would otherwise still be carrying the window it is about to hand over.
  //
  // …AND THE SUGGESTION POPUP, on the same argument and for a bigger region (FSW task 4 §5). `popupHeight` is
  // half the terminal — twenty rows at 40 — and it is none of `mainWindowCap`'s fourteen: window + dock +
  // popup cleared the pane at EVERY size, so Ink took the tall branch on the keystrokes of every slash
  // command and appended a fresh copy of the committed transcript to scrollback each time. A/B on one build,
  // six `/status` submissions typed a character at a time at 80x40, counting copies of the echo row in
  // `capture-pane -S -`: WITHOUT this term 132 copies / 1915 scrollback rows, WITH it 6 / 65 — and 6 is the
  // pre-wave number, i.e. one copy per submission and nothing reprinted. (Task 4 measured 139 / 2035 by the
  // same method; 2035 is past tmux's default 2000-row history-limit, so the user's real scrollback is gone.)
  // Two things this deliberately is NOT:
  //   · not a COMMIT. The popup opens and closes on every keystroke of a slash command, and a commit is
  //     irreversible — driving the ratchet from a flicker would publish the tail a row at a time and freeze it
  //     at whatever width and moment the user happened to be typing at. The rows leave the WINDOW while the
  //     popup is up and are back the moment it closes, which is the same trade the streaming subtraction above
  //     already makes.
  //   · not a blanking. It is budgeted: the window yields exactly the popup's rows, not all of them (the I2
  //     lesson from `paneOwned`, which used to hide `rows − 16` rows for the whole life of a dialog).
  // The flag arrives SYNCHRONOUSLY with the keystroke (`onSuggestOpen`, off the composer's `commitState`) and
  // not off `onFooterState`'s effect, because one frame late is one tall write, which is one reprinted
  // session — the defect itself, merely rarer.
  //
  // THE CAP SUBTRACTS THE LIVE ROWS IT SHARES THE FRAME WITH (fix round, review C2). `mainWindowCap`'s dock
  // figure covers the composer, footer, todo panel, spinner and queue — it does NOT cover `pendingItems` or
  // the in-flight turn, and both of those are unbounded. Before this subtraction the window took the slack
  // those two had been living on and handed the tall-frame branch back: measured at 24 rows with a full
  // window, Ink's `outputHeight >= rows` fired at TWELVE streamed rows, against roughly twenty on the parent
  // commit. Subtracting them restores the parent's threshold exactly, because past the point where the
  // window has yielded all eight of its rows the frame is `dock + streaming` on both sides of the change.
  // `streamingItems` exists to make this arithmetic honest — a line three times the width reports three
  // rows, which is the whole reason it wraps ahead of the renderer rather than letting Ink do it.
  //   AND IT IS THE RENDER CAP ONLY. `useChat`'s `commitCap()` stays geometry-only, so a transient stream
  // cannot ratchet coverage permanently down — the same reasoning that already justifies the drag policy:
  // a window is free and may follow anything, a commit is irreversible and may only follow a settle.
  const windowItems = useMemo(() => {
    // Fullscreen has no `<Static>` and therefore no unpublished TIER — `FullscreenViewport` takes the whole
    // document — so this memo's one consumer (the classic branch below) does not exist on that path. Bailing
    // first is not a micro-optimization: `state.streaming` is in the deps, so without it every streamed delta
    // rebuilt a Set over the published items and re-filtered the entire finalized projection, then threw the
    // result away.
    if (fullscreen || paneOwned) return EMPTY_ITEMS;
    const published = new Set(state.staticItems.map((item) => item.id));
    const unpublished = state.finalizedItems.filter((item) => !published.has(item.id));
    // `size` (not `size.rows`) is the dependency, and since the C2 fix the WIDTH half of it is load-bearing
    // rather than decorative: `streamingItems` wraps to `size.columns`, so the same in-flight turn costs a
    // different number of rows at a different width. (It was inert before — the items were re-projected at
    // the new width inside `useChat`, and that fresh array identity already invalidated this memo.)
    // `nextSize` keeps the identity stable while neither dimension moves, so this costs nothing on an
    // ordinary re-render. THE BACKLOG-3 FIX WIDENS THAT to every term below: the window's own items and the
    // pending region are measured PAINTED at `size.columns` too, so a width change now moves every term of
    // this arithmetic rather than only the streaming one.
    const live = paintedRowsOf(state.pendingItems, size.columns) + rowsOf(streamingItems(state.streaming, size.columns));
    const cap = Math.max(0, mainWindowCap(size.rows) - WINDOW_SLACK - live - (suggestOpen ? popupHeight(size.rows) : 0));
    // …AND THE WINDOW ITSELF PAYS IN PAINTED ROWS (FSW backlog 3). `renderMarkdown` never wraps prose, so a
    // 200-column paragraph is ONE logical line that Ink paints as three here — a window counted logically
    // sat at the cap and painted three times it, which is the tall-frame branch this whole memo exists to
    // stay away from. Measured on this harness at 80x24 with twelve such paragraphs: 8 window items / 8
    // logical rows / 24 PAINTED rows against a cap of 8, now 2 / 2 / 6. Content that already fits the width
    // measures identically either way, so the ordinary classic frame is unchanged.
    return selectLiveWindow(unpublished, cap, cap, (item) => paintedHeight(item, size.columns)).window;
  }, [state.finalizedItems, state.staticItems, state.pendingItems, state.streaming, size, fullscreen, paneOwned, suggestOpen]);
  // …and the commit half of I2. An EDGE would be enough (the flag is what changes), but a level is cheaper to
  // reason about and idempotent by construction: with nothing unpublished left, `publishLiveWindow` returns
  // without touching state, so a re-render behind an open dialog schedules nothing.
  useEffect(() => { if (paneOwned) publishLiveWindow(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paneOwned, state.finalizedItems]);
  // ── FSW TASK 12 — `v`: THE WHOLE CONVERSATION, IN THE USER'S EDITOR ───────────────────────────────────
  // Fullscreen quit gives the user their shell back with the conversation absent, on purpose (§A6). The three
  // halves of the answer meet here and nowhere else: the retained document (`detailItems`, the same
  // `detail-all` projection ctrl+O shows), the alt-screen guard the editor has to run inside, and the slot
  // that says where the file went. `FullscreenViewport` owns only WHEN the key is live.
  //   IT RUNS INSIDE THE KEYMAP'S TERMINAL HANDOFF, for the reason `chat:externalEditor` does (ChatComposer's
  // note): the child is spawned with stdio "inherit", so while it owns fd 0 our still-flowing `data` listener
  // would race it for its keystrokes. The dump itself is synchronous — spawnSync freezes the loop — so the
  // only thing deferred past `suspendInput`'s await is the restore in its own `finally`.
  //   THE MESSAGE IS EPHEMERAL, not a transcript row: it is a receipt for a keystroke, and a row would then be
  // part of the NEXT dump. Canon clears its own after 4 s (L549357) and so do we.
  //   AND THE PROP HANDED DOWN IS STABLE, through the ref that every "read the latest closure from a stdin
  // handler" site in this tree uses. `detailItems` is a fresh function on every `useChat` render, so an inline
  // arrow would invalidate the viewport's action memo on every streamed delta — on the one hot path this
  // renderer has.
  const suspendInput = useSuspendInput();
  const dumpNow = () => {
    const run = () => {
      const r = dumpTranscript({ items: () => detailItems("detail-all"), ...(aroundChild ? { around: aroundChild } : {}) });
      // …AND THE RECEIPT PREEMPTS (t12 review, M1). Absent `priority` reads as `"low"` (notifications.ts:97),
      // so behind a hint that is still holding `current` the answer to a keystroke would arrive seconds after
      // the key — canon writes its status the moment the handler returns (L549349).
      notify({ key: "transcript-dump", text: r.message, priority: "immediate", timeoutMs: TRANSCRIPT_DUMP_NOTICE_MS });
    };
    if (suspendInput) void suspendInput(async () => run()); else run();
  };
  const dumpRef = useRef(dumpNow); dumpRef.current = dumpNow;
  const dumpTranscriptNow = useCallback(() => dumpRef.current(), []);
  // …AND THE DUMP IS NOT THE ONLY EDITOR (t12 review, I1). The composer's `chat:externalEditor` (ctrl+g,
  // ctrl+x ctrl+e) and the plan dialog's ctrl+g spawn `$VISUAL`/`$EDITOR` with stdio "inherit" too, and an
  // editor left on the alternate screen is worse than one that never got it: the child's OWN rmcup on exit
  // drops the terminal to the main screen while the guard still believes it holds the alt one, so the next
  // frame paints over the user's shell scrollback. Same handoff, same seam — `EditorIO.around`.
  //   `undefined` ONLY WHERE THERE IS NO GUARD AT ALL — an embedder or a component test that passes no
  // `aroundSubprocess`; both children then take their own defaults (the composer's `realEditExternal`, the
  // dialog's default `editor` param). A PRODUCT launch is never that case: `chatMain` passes the wrapper in
  // BOTH modes and a main-screen launch simply has an UNARMED guard, whose `aroundSubprocess` short-circuits
  // to running the child where we stand — which is what a main-screen editor has always done. Memoized on the
  // guard so the composer's prop identity is stable.
  const editExternalHere = useMemo(
    () => (aroundChild ? (text: string) => editExternal(text, { around: aroundChild }) : undefined),
    [aroundChild]);
  // ── FSW TASK 9 — TWO RENDERERS, ONE TREE ──────────────────────────────────────────────────────────────
  // The split below is the SHAPE of the whole M2b renderer, so it is worth saying what it deliberately is not.
  // It is not two component trees: the transcript region and everything under it (the "dock" — panels, turn
  // indicator, queue, the dialog chain, the composer, the footer) are built ONCE and then either stacked in a
  // content-sized Box, as they always were, or handed to `FullscreenFrame` as two slots. Every stateful child
  // is the same element in the same order on both paths, which is what makes `/tui`'s live flip (T15) a prop
  // change rather than a session-losing remount, and what keeps the twenty-four existing ChatApp suites
  // measuring the classic path byte for byte — the only thing above them that moved is the wrapper.
  //   THE REGION IS THE ONE ASYMMETRY, and it is the point: fullscreen renders no `<Static>` at all. Ink
  // resets `fullStaticOutput` only in its constructor, so a `<Static>` mounted even once puts committed
  // transcript into a buffer that every later tall write replays, for the life of the process — and the fixed
  // frame's promise that no tall write ever happens is the only thing standing between fullscreen and that
  // replay. Never mounting it is the guarantee; T12 rests on it.
  //   …WHICH IS WHY THE TWO SIDES TAKE DIFFERENT SLICES OF THE SAME DOCUMENT (FSW Task 10). Classic renders
  // three tiers, because the committed one is in the terminal's scrollback above the frame: `<Static>` for
  // what is published, `windowItems` for the unpublished tail that must still re-wrap, and the transient
  // region. Fullscreen has no scrollback and no `<Static>`, so a tier boundary there would simply lose rows —
  // Task 9's intermediate did exactly that, showing only the unpublished tail. `FullscreenViewport` takes the
  // WHOLE document (`finalizedItems ⧺ pending ⧺ streaming`) and virtualizes it against T2's anchor, so the
  // frame is a window over everything rather than a view of the newest tier. `windowItems` is therefore a
  // main-screen concept and is not passed here; `mainWindowCap`'s fourteen-row dock reservation goes with it.
  //   …AND CTRL-O TAKES THE REGION RATHER THAN THE COMPOSER'S SLOT (FSW Task 11). On the main screen the pager
  // is an overlay over the LIVE rows, because everything committed is in scrollback above the frame — so it
  // renders in the dialog chain below, where the composer would be. In the frame the region IS the transcript,
  // so the pager replaces it there and the dock keeps its footer; `RegionPager` sizes it to the rows the frame
  // granted instead of `TranscriptPager`'s `rows − 10` guess at the terminal. The dock's own transcript arm
  // renders nothing on this path (see it below) — which is what keeps the composer's `Chat` scope OFF the
  // stack while the pager owns the keyboard, exactly as an unmounted composer does on the main screen.
  // ── FSW T14 / D14 (grounding §4; bundle L549395 `ds() && jsx(lui, {})`) — QUEUED PROMPTS JOIN THE DOCUMENT.
  // The dock's echo below is unchanged and still the classic renderer's; in fullscreen the same rows are built
  // as document items instead, so they sit at the scrollable's tail rather than in a band that cannot scroll.
  // WHY IT MATTERS beyond fidelity: the dock's cap is `floor(rows/2)` and a queued paragraph is unbounded, so
  // a queue of three prompts used to push the composer and the footer off the frame's bottom edge.
  //   THE INSET IS CARRIED, NOT LOST. `wqo` wraps a queued prompt in `paddingX: $jp = 2` (L426022) and keeps
  // the ORDINARY prompt echo inside it; there is no Box to put around a virtualised slice, so the two columns
  // are folded into the line itself (`indentRenderLine`) and the band is minted at the same `queueWidth` the
  // dock uses. Same pixels, one fewer container.
  //   ONE ITEM PER ROW, which is what `renderItemHeight` needs to be trusted: `userEchoLines` has already
  // wrapped to `queueWidth`, so every line it returns is exactly one physical row.
  const queuedItems: readonly RenderItem[] = useMemo(
    () => (fullscreen
      ? state.queue.flatMap((q, i) => userEchoLines(q.value, { width: queueWidth })
          .map((l, j) => ({ kind: "line" as const, id: `queued:${i}:${j}`, line: indentRenderLine(l, QUEUE_INSET) })))
      : EMPTY_ITEMS),
    [fullscreen, state.queue, queueWidth]);
  // ── THE REGION'S TWO OCCUPANTS ARE DIFFERENT COMPONENTS, AND ONLY ONE OF THEM MAY COME AND GO ────────────
  // (T15 fix round I2, as the T17 fix round below amends it — read both, in this order.)
  // `FullscreenFrame` keeps its own element type across `/tui` so the frame, the dock and everything mounted
  // in them are re-propped rather than reborn (its header; pinned in `test/tui/tui-switch.test.tsx`). Inside
  // it the two renderers want genuinely different components — a virtualised band that owns a fixed row
  // budget, and an append-only `<Static>` that owns scrollback — and there is no shared component that is
  // honestly either. T15 concluded from that that the whole slot may be reconciled against a different
  // element, and the classic arm's `<Static>` therefore starts from index 0 on the way back and rewrites the
  // ENTIRE committed conversation to the main screen (measured: one 54-row chunk at a 60-entry transcript).
  //   THAT REPLAY IS CANON-SHAPED, which is why it is accepted rather than engineered away. Canon's `/tui`
  // does not flip a live renderer at all — it RELAUNCHES: `fTb` ends in `YGt` (`relaunchInto`, bundle
  // L482509/L482620), which is `GBe({ freshIfNoTranscript: true, … })` (L353362), and `freshIfNoTranscript`
  // means the new process re-execs with `--resume <id>` whenever a transcript exists (L353366-353370). The
  // user's whole conversation is therefore reprinted onto the new screen there too. Ours arrives by Ink's
  // `<Static>` rather than by a resume, and costs one screenful of scrollback instead of a process.
  //   WHAT IS NOT ACCEPTABLE, and is pinned: a SECOND copy. The replay must REPLACE — every committed row
  // appears exactly once in the bytes after the flip — because Ink's `fullStaticOutput` only ever grows
  // (ink.js:57 resets it in the constructor and nowhere else) and a duplicating flip would compound per use.
  //   …AND SINCE TOOL-STREAM T5 "EVERY COMMITTED ROW" HAS TO NAME A SHAPE (T5b). The fold policy became
  // renderer-dependent, so the rows in `state.staticItems` were minted for whichever screen was up when they
  // settled — and replaying a fullscreen-shaped run onto the classic screen satisfies "exactly once" while
  // still putting the same two calls on it twice, because the next projection appends the per-call shape
  // whose ids nothing has spent. `useChat`'s `refoldFor` (see its header) re-projects and REPLACES both
  // derived facts on the flip itself, on the fullscreen side of it where this `<Static>` is holding nothing;
  // by the time the classic arm below is handed a list, it is already the list this renderer would have made.
  // ── AND THE `<Static>` IS MOUNTED ON BOTH ARMS, WHICH IS A CRASH FIX (T17 fix round, Finding 2) ──────────
  // The paragraph above stands as the reasoning for what the two arms SHOW; what it got wrong is that the
  // classic tier may therefore be UNMOUNTED. Ink caches the `<Static>` box on its root node
  // (`reconciler.js:154`, `rootNode.staticNode = node`) and never clears the reference when that box goes
  // away, while `removeChild` frees its Yoga node (`cleanupYogaNode` → `freeRecursive`). So a flip into
  // fullscreen left `renderer.js:11-14` reading a FREED WASM node on every frame afterwards: usually garbage
  // (measured — a freed node answers another node's width), occasionally an address outside the heap, and
  // then `RuntimeError: memory access out of bounds` out of a debounced render, which kills the process and
  // the conversation with it. T17 reproduced that 2 of 6 times on `/tui fullscreen`, always on a session that
  // had been classic first — which is exactly the sessions in which a `<Static>` had ever mounted.
  //   THE FIX IS THAT NOTHING UNMOUNTS IT. `Transcript` renders on both arms at the same position, holding
  // NO items in fullscreen: an empty `<Static>` renders no children, so `renderer` returns a bare `"\n"`,
  // `hasStaticOutput` is false and `fullStaticOutput` never grows — the no-`<Static>`-in-fullscreen invariant
  // T12 rests on is about that buffer, and it is preserved as stated (pinned in `fullscreen-frame.test.tsx`,
  // which asserts no committed row ever reaches the alternate screen). Its Box contributes no rows either,
  // so the region's measured grant is unchanged.
  //   THE REPLAY ON THE WAY BACK IS UNCHANGED, and it is why the items are emptied rather than held: Ink's
  // `<Static>` resets its `index` whenever `items.length` moves (Static.js:20-22), so `N → 0 → N` re-emits
  // the whole committed conversation onto the main screen exactly as a remount did — the behaviour argued
  // above and pinned in `tui-switch.test.tsx`. Holding the items instead would be worse than useless: the
  // commit ratchet keeps publishing while fullscreen is up, and every newly committed row would be written
  // to the alternate screen.
  //   THE `staticEpoch` KEY STAYS. A `/clear` or a rewind still remounts this subtree — but a keyed remount
  // deletes and re-creates in ONE commit, so `rootNode.staticNode` is repointed at the new box before any
  // render reads it. The dangling window is unmounting with nothing taking its place, and that window is now
  // closed for the life of the app.
  const scrollback = (
    <Transcript key={state.staticEpoch}
      staticItems={fullscreen ? EMPTY_ITEMS : state.staticItems}
      windowItems={fullscreen ? EMPTY_ITEMS : windowItems}
      pendingItems={fullscreen || paneOwned ? EMPTY_ITEMS : state.pendingItems}
      streaming={fullscreen || paneOwned ? EMPTY_LINES : state.streaming} />
  );
  const region = <>
    {scrollback}
    {fullscreen
      ? (transcriptOpen
        ? <RegionPager makeItems={detailItems} onClose={() => setTranscriptOpen(false)} columns={size.columns} />
        // …AND THE BLANKING IS A MAIN-SCREEN TRADE THAT DOES NOT APPLY HERE (T13b). `paneOwned` hides the live
        // rows so the dock's fourteen-row budget never has to cover a dialog as well; in the frame the region is
        // a fixed virtualised band that the seam has ALREADY shrunk by taking the bottom one, so blanking buys
        // no rows and costs the only sign the turn is still running — open `/model` mid-answer and the stream
        // disappeared until it closed. Canon keeps its spinner in `scrollable`, above the absolute overlay,
        // where the overlay never occludes it (grounding §L2.6). The classic arm above keeps the trade.
        : <FullscreenViewport finalizedItems={state.finalizedItems} pendingItems={state.pendingItems} streaming={state.streaming} queuedItems={queuedItems} columns={size.columns} historySearchOpen={state.historyOpen || footerState.searching} onDumpTranscript={dumpTranscriptNow} hitmapRef={hitmapRef} onWheelTick={discardTap} />)
      : null}
  </>;
  // ── FSW TASK 13 — WHICH OF CANON'S TWO OVERLAY MECHANISMS A SURFACE GETS ──────────────────────────────
  // Grounding §L2.6, "Two overlay mechanisms, not one". In fullscreen a surface the USER opened (`/model`,
  // `/help`, `/resume` and its preview — canon's captured three) renders in the absolute-bottom SEAM SLOT under
  // a `▔▔▔▔` rule with the transcript squeezed above it, while a surface the MODEL is asking about (the parked
  // decisions) replaces the DOCK: the composer disappears and the dialog sits under the ordinary `────` rule
  // `DialogFrame` already paints (its own header, bundle L438011). Two slots, and a port needs both.
  //   WHAT GOES IN THE SEAM IS `cZo`'s `modal` PROP, AND THE BUNDLE NAMES ITS TWO TENANTS OUTRIGHT (L549395,
  // read for this task rather than inferred from the captures):
  //     RTt = i8 ? jsx(Api, { variant: "modal" }) : Ket        Ket = Dqt ? as.jsx : null
  //     Dqt = ds() && as?.isLocalJSXCommand === !0             …passed as  cZo({ modal: RTt, … })
  //   · `Ket` — a LOCAL JSX COMMAND's element, but only under `ds()` (fullscreen). That is the whole
  //     user-opened-surface class: `/model`, `/help`, `/resume`, `/config`, `/permissions`, … Canon does not
  //     enumerate three of them, it routes the CLASS, which is what "One slot, one seam, every dialog"
  //     (grounding §L2.6) says in prose and what makes the three captures three samples rather than a list.
  //   · `Api` with `variant: "modal"` — and `Api` returns null unless the pending decision's own layout matches
  //     that variant (L507350: `if (($3k[L4.kind] ?? "inline") !== F3k) return null`). The layout table `ypi`
  //     (L507338) has exactly ONE entry, `[Vur.kind]: "modal"` — exit-plan-mode. So the plan dialog is a seam
  //     surface too, and it is the only decision that is.
  //   The remaining decisions (`layout:"inline"` — permission, question) are NOT in the seam: their `Api` is
  // mounted inside `scrollable`, at the tail of the transcript, with the composer hidden (`fra hidden={… ||
  // Boolean(PA)}`). ccx draws them one band lower, in the dock, which is where the live capture puts them
  // anyway (a bottom-anchored region's tail sits immediately above a dock that has lost its composer) and
  // which is what keeps them from scrolling away under the reader — see the report's grounding correction.
  //   THE ROUTER IS `inputOwnerRef`, NOT A SECOND LIST OF SURFACES. That derivation already draws canon's line:
  // `"overlay"` is every surface the user opened — ccx's `Ket` — and `"decision"` every parked one, of which
  // the plan kind is the `ypi` entry. Reusing it means the seam cannot drift out of agreement with the chain
  // about which surface is on screen; a second enumeration of the chain's precedence would be a second thing to
  // keep in step, and the failure mode of getting it wrong is a picker rendered in two bands at once. The chain
  // BELOW is unchanged and still the one place any of these elements is written; only its slot moves.
  //   THE TWO OWNERS OUTSIDE THE BUCKET STAY WHERE THEY WERE: the `?` shortcuts overlay and the ctrl+O pager
  // are `"shortcuts"`/`"transcript"`, and neither goes to the seam — the pager already owns the REGION (T11)
  // and the shortcuts grid is a presentational takeover with no canon slot behind it.
  const seamActive = fullscreen && (inputOwnerRef.current === "overlay"
    || (inputOwnerRef.current === "decision" && state.pending?.kind === "plan"));
  /** The rows a SEAM surface may size its own lists to. In the slot that is the SLOT's cap, not the terminal's
   *  height: a picker that windows itself for `rows` and is handed `rows − 2` loses its last two lines — which
   *  is canon's own `/help` defect (grounding §L2.6: "Its `Esc to cancel` line is pushed off the bottom and
   *  never renders at 24 rows … an upstream clipping defect, not something to reproduce"). Handing down the
   *  real budget is how these surfaces respect it BY CONSTRUCTION; the frame's clip and its diagnostic are the
   *  backstop, and the diagnostic cannot even see a picker re-windowing itself (FullscreenFrame's header).
   *  Classic gets the identical value it always did.
   *    MEASURED, on `PlanDialog`, which is why this is not a nicety: at 24 rows the plan dialog wants
   *  seventeen rows and a dock capped at twelve, so before T13 its whole option block — every answer the
   *  dialog exists to collect — was clipped off the bottom of the frame with nothing on screen to say so. In
   *  the seam at `rows − 2` it fits. */
  const overlayRows = () => (fullscreen ? seamCap(size.rows) - 1 : terminalRows());
  /** THE ROWS A DOCK DIALOG MAY COMPOSE INTO (FSW T13b). Canon draws a permission/question consult in the
   *  scrollable; ccx pins it in the dock band, where — unlike a pager — there is no way to reach a row the
   *  frame clipped. So the band takes `dockCap`'s wide arm while a decision is in it (see there) and the
   *  dialog is handed what is left of it after the band's OTHER tenants, which are the footer's rows (its
   *  unconditional chip/hint row AND a configured statusLine's, `footerRows`), the live-turn slot, the queue
   *  echo and the task panel.
   *    ARITHMETIC RATHER THAN MEASUREMENT, and biased to over-reserve: measuring would cost a ref, an effect
   *  and a frame of lag, while an over-reservation costs one row of diff. The task panel is the one term that
   *  can be short — `todoPanelRows` assumes the single in-progress row TodoWrite's discipline produces — and
   *  its error is a row of the dialog's chrome, which is why the reserve rounds up rather than down.
   *    `undefined` OFF THE FULLSCREEN PATH: the main screen has no band and no cap, so nothing is windowed
   *  there and every classic mount renders exactly what it always did. */
  /** THE FOOTER'S OWN GEOMETRY, in one place. The `<Footer>` below is rendered from it and the dock's
   *  reservation charges from it, so the two cannot disagree about how tall the footer is — which they did
   *  (T13b review I4): the reserve charged one row for the whole component while a configured statusLine adds
   *  one per line of the script's output, and the dialog above then composed into rows the frame clipped. */
  //   …AND THE RENDERER IS PART OF THAT OBJECT SINCE T14. D1 gives the footer a row in fullscreen it does not
  // have in classic (a configured statusLine that has not answered yet holds one blank line), so `fullscreen`
  // is an input to `footerStatusRows` exactly as `rows` and `bashMode` are — and it arrives through this same
  // one object, which is what keeps the reserve below and the paint below THAT counting the same rows.
  const footerStatusInput = (): FooterStatusInput => ({
    statusLineConfigured: hookOpts?.statusLine !== undefined, statusLineText: state.statusLineText,
    bashMode: footerState.bashMode, pasting: footerState.pasting,
    exitArm: exitArmed ? EXIT_ARM_CTRL_C : footerState.exitArm, rows: terminalRows(), fullscreen,
  });
  const dockDialogRows = (): number | undefined => {
    if (!fullscreen) return undefined;
    // The queue term went with D14 (T14): in fullscreen those rows are at the document's tail, not in the
    // band, so charging the band for them would have reserved rows nothing was going to use.
    const others = footerRows(footerStatusInput())                                      // the footer's rows
      + (state.busy || state.compacting ? 1 : 0)                                        // the live-turn slot
      + (todosOpen ? todoPanelRows(state.tasks, terminalRows()) : 0);
    return Math.max(0, dockCap(size.rows, true) - others);
  };
  /** THE OVERLAY CHAIN — every surface that replaces the composer, in precedence order. Extracted from the
   *  dock in FSW T13 so ONE list of elements can be handed to either slot (see `seamActive` above): on the
   *  main screen and for a parked decision it renders where it always did, directly above the footer; in
   *  fullscreen a user-opened overlay is handed to the frame's seam slot instead. Nothing about the chain
   *  itself moved — same arms, same order, same props. */
  const overlayChain = (
    // Wave-T T15: the head of the chain, above even the `?` overlay. `/yolo` is a request to stop being
    // asked before dangerous commands run, and until it is answered nothing else may take the keyboard —
    // this is the one dialog in the tree whose whole job is to be in the way.
    state.bypassConsent.open
        ? <BypassConsent onAccept={acceptBypassConsent} onRefuse={refuseBypassConsent}
            {...(deps?.savePrefs ? { savePrefs: deps.savePrefs } : {})} {...(deps?.env ? { env: deps.env } : {})} />
        : state.shortcutsOpen
        // FSW T14 review (M5): the grid carries one row that exists in this renderer only — `v`, the
        // scrollback's editor escape, which is a printable letter in the classic tree. `fullscreen` is the
        // gate, and it is this component's own derivation, so the row appears exactly where the key can fire.
        ? <ShortcutsOverlay onClose={closeShortcuts} fullscreen={fullscreen} />
        // F6 T14: `/help`'s dialog sits directly behind the `?` overlay — they render the SAME grid, and the
        // one that was opened last is the one on screen. Both are USER surfaces (no parked decision under
        // them), so this pair keeps the head of the chain.
        : state.helpOpen
        ? <HelpDialog commands={state.commandCatalog} onClose={closeHelp} rows={overlayRows()} columns={terminalColumns()} fullscreen={fullscreen} />
        : transcriptOpen
        // The ONLY route from the retained document to the pager: useChat's detailItems closure re-projects
        // it at whichever detail projection the pager currently wants. ChatApp never projects detail itself
        // and never owns show-all state — Ctrl-E is pager-local, Ctrl-O/Escape are all this arm decides.
        // FSW T11: in fullscreen the pager has already drawn in the REGION (see `region` above) and this arm
        // renders NOTHING — but it stays an arm rather than dropping out of the chain, because what it leaves
        // empty is the composer's slot. That emptiness is the point: it is how the composer's `Chat` scope
        // comes off the keymap stack, which is what stops Chat's `escape`/`ctrl+d` shadowing the pager's own
        // exit and half-page keys. On the main screen the same emptiness arrives for free, from the pager
        // itself occupying the slot.
        ? (fullscreen ? null : <TranscriptPager makeItems={detailItems} onClose={() => setTranscriptOpen(false)} columns={size.columns} />)
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
          ? <RewindPicker anchors={state.rewindPicker.anchors} onDryRun={rewindDryRun} onConfirm={confirmRewind} onClose={closeRewindPicker} rows={overlayRows()} columns={terminalColumns()} />
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
                  onPick={pickModel} onCancel={closeModelPicker} savePrefs={deps?.savePrefs} rows={overlayRows()} columns={terminalColumns()} />
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
                    reduceMotion={state.prefersReducedMotion} setReduceMotion={setPrefersReducedMotion}
                    progressBarEnabled={state.terminalProgressBarEnabled} setProgressBarEnabled={setTerminalProgressBarEnabled}
                    promptSuggestionEnabled={state.promptSuggestionEnabled} setPromptSuggestionEnabled={setPromptSuggestionEnabled}
                    onDone={closeSettings} applyMode={applyMode} setThink={setThink} applyOutputStyle={applyOutputStyle}
                    fetchStatus={fetchSettingsStatus} fetchUsage={fetchSettingsUsage} fetchStats={fetchSettingsStats}
                    // WAVE S t5: the Config list is windowed now, so this dialog joins the set that is handed
                    // Task 1's size state rather than falling through to `process.stdout` behind the app's
                    // pin (the ModelPicker arm above spells the whole argument out).
                    onOpenModelPicker={openModelPicker} savePrefs={deps?.savePrefs} rows={overlayRows()} columns={terminalColumns()} />
                : state.permissions.open
                ? <PermissionsDialog tab={state.permissions.tab ?? "Allow"} onTabChange={setPermissionsTab}
                    denials={state.denials} cwd={cwd}
                    fetchSettings={fetchPermSettings} fetchDirs={fetchPermDirs}
                    addRule={addPermRule} removeRule={removePermRule} removeDir={removeWorkspaceDir}
                    addDirValidate={addDirValidate} confirmAddDir={confirmAddDir} cancelAddDir={cancelAddDir}
                    // WAVE S t6b: its rule and workspace lists are windowed now, so this dialog joins the set
                    // that is handed Task 1's size state rather than falling through to `process.stdout` behind
                    // the app's pin (the ModelPicker arm above spells the whole argument out).
                    onDone={closePermissions} rows={overlayRows()} columns={terminalColumns()} />
                : state.themeDialog.open
                ? <ThemeDialog onDone={closeThemeDialog} savePrefs={deps?.savePrefs} />
                : state.addDir.open
                  ? <AddDirDialog prefill={state.addDir.prefill} onValidate={addDirValidate} onConfirm={confirmAddDir} onCancel={cancelAddDir} />
                  : state.picker.open
                  ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker}
                      loadMessages={previewSession} renameSession={renamePickedSession} reload={reloadSessions}
                      hasWorktree={state.picker.hasWorktree} rows={overlayRows()} columns={terminalColumns()} />
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
                    // T13b: `rows` is the height it may SIZE against and `maxRows` the ceiling it may not
                    // compose past. In the seam they are the same number; on the main screen there is no
                    // ceiling at all, which is what keeps the classic dialog byte-identical.
                    ? <PlanDialog key={state.pending.toolUseID} req={state.pending} onDecision={(o) => resolveDecision(o)}
                        model={state.model} bypassAvailable={hookOpts?.initialMode === "bypassPermissions"} rows={overlayRows()}
                        {...(fullscreen ? { maxRows: overlayRows() } : {})}
                        // I1: ctrl+g from this dialog is the same terminal handoff the composer's is.
                        {...(editExternalHere ? { editor: editExternalHere } : {})} />
                    : null
                  : <ChatComposer onSubmit={(t) => { submit(t); disarm(); }} cwd={cwd} commandCatalog={state.commandCatalog} onExit={exit} onCycleMode={onCycleMode} onInterrupt={onInterrupt} onHelp={openShortcuts} onDraftStart={disarmEsc} onInputActivity={noteInputActivity} waitingForPermission={inputOwnerRef.current === "typing"} inputOwnerRef={inputOwnerRef} editorStateRef={editorStateRef} consumedPrefillTokenRef={consumedPrefillTokenRef} searchHintFiredRef={searchHintFiredRef} prefill={state.composerPrefill} onPrefillApplied={clearPrefill} onKillAgents={killAgents} yankHintMs={yankHintMs} busy={state.busy} escClearMs={escClearMs} columns={terminalColumns} rows={terminalRows} sessionId={state.sessionId} project={cwd}
                      // F5 t12: the composer's disk seed, its history append and now its inline search all
                      // read this. Threaded from `deps.env` — the same source useChat's own `historyEnv`
                      // takes — so a test that points ChatApp at a temp fleet root points BOTH surfaces
                      // there. Undefined in the product, where the composer falls back to `process.env`.
                      historyEnv={deps?.env}
                      // FSW T12 review (I1): ctrl+g / ctrl+x ctrl+e inside the alt screen. Present on every
                      // product launch — a main-screen one gets the same wrapper around an UNARMED guard, which
                      // is inert — and absent only where no guard was handed down at all (embedders, component
                      // tests), where the composer keeps its own `realEditExternal`.
                      {...(editExternalHere ? { editExternal: editExternalHere } : {})}
                      queuePop={popQueueToComposer} queueHasEditable={state.queue.some(isEditableQueueEntry)}
                      submitCount={state.submitCount} hasMessages={state.hasMessages} queueHintCountedRef={queueHintCountedRef} placeholderMemoRef={placeholderMemoRef}
                      // WAVE C TASK 2: one queue for the whole app (useChat owns it), and the composer's
                      // footer-state channel. Both are how the one-row footer and the one-row overlay stay
                      // in sync with a component that unmounts behind every dialog.
                      notifications={notifications} onFooterState={setFooterState} onSuggestOpen={setSuggestOpen}
                      // WAVE C TASK 4: the Ctrl-C clear channel (see `clearDraftToken`), the ← agents gesture's
                      // destination — `task:background`'s idle branch, the same surface ctrl+b opens — and the
                      // arm clock every double-press in this tree shares.
                      clearDraftToken={clearDraftToken} consumedClearTokenRef={consumedClearTokenRef} onOpenAgents={openBgPanel} doublePressDeps={doublePressDeps}
                      // WAVE C TASK 12 (EP-C5): the suggestion's text down, and the composer's two facts back
                      // up — whether it could paint one right now, and that a key accepted it. The SLICE stays
                      // in useChat (it has to survive this component's remounts and Ctrl-C's buffer clear).
                      // `suggestionEnabled` is the SAME setting one rung down: it also gates the first-run
                      // `Try "…"` template (upstream's L1542 rule), so with suggestions off by default a fresh
                      // ccx session shows no template either — recorded in the spec as an accepted change.
                      suggestion={suggestionText(state.promptSuggestion)} suggestionEnabled={state.promptSuggestionEnabled}
                      onSuggestionSlot={noteSuggestionSlot} onSuggestionAccept={acceptSuggestion}
                      // FSW T14 — D10 (hoist the palette out of here) and D11 (drop the notification block).
                      // Both are subtractions from what the composer paints; the destinations are the dock's
                      // `PaletteSlot` and the footer's right region, and both are above this element.
                      fullscreen={fullscreen} />
  );
  const dock = (
    <>
      {/* D10 (bundle 456219-456226 `rCn`, mounted at 455945 as the band's FIRST child) — the suggestion
          palette's fullscreen home. Canon floats it at `bottom:"100%" opaque`, i.e. over the region and out
          of the band's own height; stock Ink cannot, so it takes the top of the band in flow — at canon's own
          five-row overlay size, `overlay`/`noPad` (suggestPopup.tsx), which is what keeps that in-flow cost to
          five rows instead of half the terminal. The frame's `paletteOpen` is the short-pane valve underneath
          it (FullscreenFrame). Empty on the classic arm — nothing is ever published there, because
          `ChatComposer` only hoists in fullscreen. */}
      {fullscreen ? <PaletteSlot /> : null}
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
        ? (state.retryStatus ? <RetryRow status={state.retryStatus} reducedMotion={motionReduced} />
          : state.compacting ? <CompactionRow startedAt={state.compacting.startedAt} columns={terminalColumns()} reducedMotion={motionReduced} {...(deps?.now ? { now: deps.now } : {})} />
          : <TurnSpinner startedAt={state.turnStartedAt} meter={state.turnMeter} columns={terminalColumns()} tasks={state.tasks} reducedMotion={motionReduced} />)
        : null}
      {/* F4 Task 8 — upstream `wqo` (pack §7.7, bundle L426002–426022): a queued prompt is the ORDINARY
          prompt echo wrapped in `<Box paddingX={$jp}>` with `$jp = 2`, and nothing else. It carries no
          prefix, no clip and no dimming (the `subtle` flip at L426034 lives inside the brief-layout branch,
          which this clone does not model) — so our `⋯ queued: ` + 60-char clip was an over-ship on both
          counts and dies here. The band is minted at `columns - 2*QUEUE_PAD`, which reproduces upstream's
          queued rule inset exactly: it hands `Sg` a padding of `3 + paddingWidth` = 7 where a normal
          message hands 3, and `paddingWidth` is `paddingX * 2` = 4. */}
      {/* FSW T14 / D14: fullscreen renders these at the viewport's tail instead (`queuedItems` above). */}
      {state.queue.length > 0 && !paneOwned && !fullscreen ? (
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
              // BL6 — ESC ON A QUESTION ENDS THE TURN, and says who ended it. Two changes, one gesture:
              //   `reason:"declined"` is what lets the gate answer with canon's own refusal instead of
              // "No user is available to answer." — the bare deny this used to send is the SAME outcome
              // teardown and the zero-connection rule produce, so the model was told nobody was at the
              // keyboard by the very keystroke that proved someone was (permissions/types.ts, gate.ts).
              //   AND THEN THE TURN ENDS. Native's option list routes Escape into `cancelAndAbort`
              // (:504427-504431 → :271972), whose empty-feedback guard (:271764) aborts the turn outright;
              // the sibling questions resolve `cancelled` and each returns the same refusal text
              // (:503050, :279323, :298463). One Esc, turn over. THIS DELIBERATELY REMOVES ccx's
              // decline-one-and-keep-going affordance, which had no counterpart upstream: the owner filed
              // this as "does not work the same as native", and fidelity is the tiebreak. The cost of the
              // old shape was measured — their transcript shows three Esc presses half a second apart to
              // stop one turn's worth of questions.
              //   ORDER IS LOAD-BEARING: answer first, interrupt second. `host.interrupt()` settles every
              // remaining park itself (settleParkedForSystem), so an interrupt that arrived first would
              // settle THIS question as a system deny and lose the decline. Sequenced on the answer's own
              // promise rather than fired beside it.
              //   SCOPE: questions only. A permission deny answers one tool call with the turn going on
              // around it (upstream's behaviour and ours), and the plan family already ends its own turn
              // from the gate's `interrupt` flag (wave 2 A4) — neither changes here.
              //   THE GESTURE IS ESCAPE **OR** ENTER ON AN EMPTY "OTHER" ROW, and canon makes them one
              // keystroke deliberately: the question panel's Escape calls its `onCancel` prop (:504083), the
              // panel hands that same prop to both list primitives (:504153/:504161), and the list answers an
              // empty input-row submit with that prop again (`RLe`, :397115-397118). Both land on `NMn`
              // (:504425-504431, wired at :504546) — the same telemetry, the same deny. So both must end the
              // turn, and `Select`'s own default (onEmptySubmit absent → onCancel) already routes it here.
              //   ONLY IF OUR ANSWER LANDED (review Important 1). `resolveDecision` reports which of three
              // things became of it, and a lost race (`already_answered` — another attached client answered
              // first) or a failed one (host death, the 10s deadline; the park is still live and the dialog
              // stays up) must leave the turn alone. Interrupting either would abort a turn this keystroke
              // never settled.
              onDeny={() => { void resolveDecision({ kind: "deny", reason: "declined" }).then((r) => { if (r.status === "settled") interrupt(); }); }}
              // A payload with no `questions` array is not a human decline: nobody saw a dialog. It answers
              // the park so the engine is not left waiting, with the SYSTEM's bare deny — no `declined`, no
              // interrupt (review Minor 3).
              onMalformed={() => { void resolveDecision({ kind: "deny" }); }} />
          // `cwd` is the SESSION's working directory, not this process's — the kind routing and the Bash
          // body's rule summary both name it (permissionKind.ts). `directories` is the WHOLE working set —
          // the cwd plus every `/add-dir` grant — which is what the file body's in-directory test runs over
          // (F6 T7 fix; without it an Edit under an added directory reads as out-of-directory and its grant
          // re-adds a directory the session already holds).
          // `maxRows` is the dock band's remaining rows (T13b), present in fullscreen only — see
          // `dockDialogRows`. Without it a long diff pushed the question and every option off the frame.
          : <PermissionDialog key={inlineDecision.toolUseID} req={inlineDecision} cwd={cwd} directories={state.workDirs} onDecision={(d) => resolveDecision(d)}
              columns={terminalColumns()} {...(fullscreen ? { maxRows: dockDialogRows() } : {})} />
        : null}
      {seamActive ? null : overlayChain}
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

          WAVE 2 TASK 3 (EP-D2c; s2qa4-11) — THE EXIT ARM IGNORES `paneOwned`, alone among this file's armed
          hints. It used to read `exitArmed && !paneOwned`, and that gate is what QA saw as "no hint ever
          appears while a dialog is mounted": with the keymap half fixed the press now arms from inside
          `/model`, `/config`, `/resume`, the rewind picker and `/help`, and the gate would have hidden the
          one line saying so — an armed 800 ms window the user cannot see is worse than no arm at all, because
          the second press then looks like it came from nowhere. `escArmVisible` above KEEPS its `!paneOwned`
          (it posts to the notification queue, which a pane-owning surface really does cover, and Esc-Esc
          opens a picker rather than ending the process); this slot is the footer's own row, drawn
          unconditionally under every surface, so there is nothing for it to collide with.

          `Press Esc again to rewind` HAS NO ROW HERE, deliberately (plan constraint 12): upstream carries that
          class of affordance as a QUEUE entry, not a persistent line (annex §C1.6), and since Wave C Task 4
          both esc arms post there — this one on `escape-again-to-rewind`, the composer's clear arm on
          upstream's own `escape-again-to-clear`. */}
      <Footer
        mode={state.mode} busy={state.busy}
        draftNonEmpty={draftNonEmpty} isInputEmpty={!draftNonEmpty}
        searching={footerState.searching} pasteExpandHint={footerState.pasteExpandHint}
        // WAVE C TASK 10 (EP-C2b) — the statusLine, now real. CONFIGURED and TEXT are separate facts and
        // arrive from separate places on purpose: the setting is resolved once at launch (chatMain, the only
        // reader of the user settings file), and the text is whatever the driver's last SUCCESSFUL run
        // published. So `? for shortcuts` disappears the moment a statusLine is configured — before, and
        // regardless of whether, the script ever produces a line. `rows` is the pane height the guard's
        // 15-row floor reads, threaded from Task 1's resize state like every other geometry consumer here.
        //   THOSE FACTS AND THE FOUR THAT SUPPRESS THE ROW (bash mode, pasting, an armed exit, the pane's
        // height) ARRIVE AS ONE OBJECT, `footerStatusInput` — the dock's reservation is computed from the
        // same call, which is what stops it charging fewer rows than this component paints.
        {...footerStatusInput()}
        statusLinePadding={hookOpts?.statusLine?.padding}
        // ccx has no "agent needs input" signal and no completion stamp the footer could read, so only the
        // COUNT is wired — it is what replaced the old `⚙ N bg` chip. `agentsAffordance` implements both
        // flashes and its own 2500 ms window (`Lci`); a producer sets `awaiting`/`done` here and gets them.
        agents={{ count: state.bgTasks.length }}
        // FSW T14 — D12's padding, D13's right region and D1's held row all hang off this one fact, and the
        // right region is where D11's suppression puts the immediate rank it may not silence (amendment 1).
        // `notice` is handed over whole; `footerNotice` inside the component decides whether it draws.
        notice={state.notification}
        bindings={bindings} composerOwnsKeys={composerOwns(inputOwnerRef.current)} />
    </>
  );
  // `historySearchOpen` widens the dock's cap from `floor(rows/2)` to `rows − 2`, and it is a DISJUNCTION
  // because ccx has two of them and they live on opposite sides of the dock: `/history`'s overlay replaces the
  // composer (it is one of the dialog arms above), while ctrl+r's inline search grows the composer in place
  // (`footerState.searching`, the composer's own report). Both are the same claim — the search results ARE the
  // content while they are up — so both earn the wider cap. Since T13 the FIRST of the two is a seam surface
  // and takes `seamCap`'s identical `rows − 2` from the other side; the flag stays because the composer's
  // inline search is still a dock that has to grow.
  //   THE DOCK IS STILL PASSED WHILE THE SEAM IS UP, and the frame ignores it — canon's overlay is `opaque`
  // over the dock rather than instead of it, and keeping the prop shaped that way is what lets the frame own
  // the "occlusion is omission" decision in one place (FullscreenFrame's header) instead of two.
  //   AND THE HOST WRAPS BOTH ARMS (T14/D10, as T15 left it). `PaletteHost` holds the published element and
  // nothing else; its setState re-renders the slot alone, because the `children` element handed to it here is
  // unchanged across that write (paletteSlot.tsx's header). It sits OUTSIDE the mode branch for the same
  // reason `FullscreenFrame` does — a wrapper that exists in one mode only is a changed root type, and a
  // changed root type unmounts everything under it on a flip. Classic stays byte-identical anyway: the
  // composer's `hoisted` is `fullscreen && …`, so it publishes `null` into a host whose state is already
  // `null` and React bails out of the re-render, and the `<PaletteSlot/>` that would draw it is not rendered
  // on the classic arm at all.
  //   AND THERE IS EXACTLY ONE RETURN SINCE T15, which is the whole of `/tui`'s live flip. Two returns meant
  // two ROOT ELEMENT TYPES, and React unmounts the host subtree under a changed type however stable the
  // children are; the frame's classic arm is unbounded and paints what the `<Box>` here used to (argued in
  // FullscreenFrame's header). `PaletteHost` moved outside the branch with it — it is a pair of context
  // providers and no Yoga node, so a classic tree wrapped in it is byte-identical, and leaving it inside
  // would have re-created the same changed-root-type problem one level up.
  return (
    <PaletteHost>
      <FullscreenFrame mode={fullscreen ? "fullscreen" : "classic"} rows={size.rows}
        historySearchOpen={state.historyOpen || footerState.searching}
        dialogInDock={inlineDecision !== null} paletteOpen={suggestOpen}
        regionChildren={region} dock={dock} seam={seamActive ? overlayChain : null} />
    </PaletteHost>
  );
}
