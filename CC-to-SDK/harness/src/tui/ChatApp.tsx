// tui/src/ChatApp.tsx — composes the transcript, the composer (or the permission dialog when one is
// pending), and the status bar. Esc interrupt / Shift+Tab cycle mode are owned by the composer and
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
// different question (which surface is VISIBLE), read only by the composer's own handler.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import { suspendProcess } from "./suspend.js";
import { useKeyActions, useKeyScope, useKeySuspend, useSwallowKeys } from "./keys/KeymapProvider.js";
import type { InitialResume } from "./commands.js";
import type { TranscriptBootstrapEntry } from "./transcriptModel.js";
import { Transcript } from "./Transcript.js";
import { ChatComposer, type InputOwner } from "./ChatComposer.js";
import { initialEditorState, type EditorState } from "./editor.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { QuestionDialog } from "./QuestionDialog.js";
import { PlanDialog } from "./PlanDialog.js";
import { ChatStatusBar } from "./ChatStatusBar.js";
import { SessionPicker } from "./SessionPicker.js";
import { ModelPicker } from "./ModelPicker.js";
import { TaskPanel } from "./TaskPanel.js";
import { TurnSpinner } from "./TurnSpinner.js";
import { BgTasksPanel } from "./BgTasksPanel.js";
import { RewindPicker } from "./RewindPicker.js";
import { ShortcutsOverlay } from "./ShortcutsOverlay.js";
import { TranscriptPager } from "./TranscriptPager.js";
import { HistorySearchOverlay } from "./HistorySearchOverlay.js";
import { AddDirDialog } from "./AddDirDialog.js";
import { ThemeDialog } from "./ThemeDialog.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { PermissionsDialog } from "./PermissionsDialog.js";

/** The rewind hold — the one surface in the tree with no keys of its own. A confirmed rewind is a multi-second
 *  file restore + engine swap, and anything that acted during it (Ctrl-R opening history search, Ctrl-O the
 *  pager, Ctrl-C arming an exit) would reintroduce exactly the loss this modal exists to prevent. It says that
 *  itself instead of leaving ChatApp to gate its own handlers: `useSwallowKeys` drops every key while it is
 *  mounted — Ctrl-Z still suspends, which the provider handles above the table. It pushes NO scope, so the
 *  swallow covers `Global` too (registry.ts: a swallower with no scope of its own swallows everything), which
 *  is why ChatApp's `Task` scope is deactivated while `rewinding` — it would otherwise be the innermost live
 *  scope and its ctrl+x ctrl+b chord would survive the hold. */
function RestoringModal(): React.ReactElement {
  useSwallowKeys(true);
  return <Box paddingX={1}><Text dimColor>⏪ restoring…</Text></Box>;
}

export function ChatApp({ makeSession, client, onDetach, initialPrompt, hookOpts, cwd, initialResume, initialEntries, clearStaticTranscript, deps, yankHintMs, escClearMs, suspend, resumeOutput }: {
  makeSession: (resume?: string) => ChatSession;
  client: { kind: "loopback" | "attached"; short?: string };
  onDetach?: () => void;
  initialPrompt?: string;
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialOutputStyle?: string };
  cwd: string;
  initialResume?: InitialResume;
  initialEntries?: readonly TranscriptBootstrapEntry[];
  // Internal chatMain → ChatApp → useChat boundary (never a public ChatClientOpts field): wipes Ink's
  // append-only <Static> before a terminal boundary mounts a fresh one.
  clearStaticTranscript?: () => void;
  deps?: Parameters<typeof useChat>[2];
  yankHintMs?: number;
  escClearMs?: number;
  suspend?: typeof suspendProcess;
  resumeOutput?: { repaint: (runInkWrite: () => void) => void };
}) {
  const { exit } = useApp();                                        // declared FIRST: /exit hands it to useChat
  // suspend.ts needs the REAL tty object, not Ink's ref-counted `setRawMode` function — see that module's
  // header comment for why the ref-counted one is a no-op here. `write` (real repaint, same reasoning).
  const { stdin } = useStdin();
  const { stdout, write } = useStdout();
  const { state, detailItems, submit, resolveDecision, cycleMode, interrupt, closePicker, pickSession, closeModelPicker, pickModel, openModelPicker, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, clearPrefill, openHistorySearch, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, applyMode, setThink, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir } = useChat(makeSession, { ...(hookOpts ?? {}), cwd, initialResume, initialEntries, initialPrompt, onExit: exit, detach: client.kind === "attached" ? () => { onDetach?.(); exit(); } : undefined, clearStaticTranscript }, deps);
  const [exitArmed, setExitArmed] = useState(false);
  const [todosOpen, setTodosOpen] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Durable per-app editor state survives a temporary composer unmount; autocomplete is normalized by the
  // remounting composer, while text, cursor, history, undo, stash, and kill ring remain exact.
  const editorStateRef = useRef<EditorState>(initialEditorState());
  const consumedPrefillTokenRef = useRef(0);
  // Input subscriptions are passive. This ref changes during render, before the visible owner swaps, so a
  // retiring composer can reject the next key even before its own registration has been torn down — the Chat
  // scope outlives the unmount by one passive flush, and shift+tab/escape would otherwise still reach it from
  // under a dialog. It names the VISIBLE surface; the composer's guard is its only reader.
  const inputOwnerRef = useRef<InputOwner>("composer");
  inputOwnerRef.current = state.shortcutsOpen
    ? "shortcuts"
    : transcriptOpen
      ? "transcript"
      : state.historyOpen || state.rewinding || state.rewindPicker.open || state.bgPanelOpen || state.modelPicker.open || state.settings.open || state.permissions.open || state.themeDialog.open || state.addDir.open || state.picker.open
        ? "overlay"
        : state.pending
          ? "decision"
          : "composer";
  // The keymap dispatches from a stdin listener the provider attached in a passive effect, so — exactly as
  // with the old `useInput` — a key can arrive after a newer render has already painted. Keep every
  // state/callback value these handlers consume current synchronously.
  const rootStateRef = useRef(state); rootStateRef.current = state;
  const exitArmedRef = useRef(exitArmed); exitArmedRef.current = exitArmed;
  const suspendRef = useRef(suspend); suspendRef.current = suspend;
  const resumeOutputRef = useRef(resumeOutput); resumeOutputRef.current = resumeOutput;
  const openHistorySearchRef = useRef(openHistorySearch); openHistorySearchRef.current = openHistorySearch;
  const interruptRef = useRef(interrupt); interruptRef.current = interrupt;
  const backgroundNowRef = useRef(backgroundNow); backgroundNowRef.current = backgroundNow;
  const openBgPanelRef = useRef(openBgPanel); openBgPanelRef.current = openBgPanel;
  const exitRef = useRef(exit); exitRef.current = exit;
  const openModelPickerRef = useRef(openModelPicker); openModelPickerRef.current = openModelPicker;
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
    "history:search": () => { openHistorySearchRef.current(); disarm(); },
    "app:toggleTodos": () => { setTodosOpen((v) => !v); disarm(); },
    "app:interrupt": () => {                                    // interrupt a turn, else arm/confirm exit (CC)
      if (rootStateRef.current.busy) { interruptRef.current(); disarm(); return; }
      if (exitArmedRef.current) { exitRef.current(); return; }
      setExitArmed(true); if (disarmTimer.current) clearTimeout(disarmTimer.current); disarmTimer.current = setTimeout(() => setExitArmed(false), 2000);
    },
    "task:background": () => { rootStateRef.current.busy ? backgroundNowRef.current() : openBgPanelRef.current(); disarm(); },
    "chat:modelPicker": () => { void openModelPickerRef.current(); },                               // KB8 (alt+p)
    // KB8 (alt+t): the Settings Thinking-mode row's flow — setThink is /think's own mechanism
    // (session.setMaxThinkingTokens) with the off/default pair the row toggles between.
    "chat:thinkingToggle": () => { void setThinkRef.current(rootStateRef.current.thinkLevel === "off" ? "default" : "off"); },
  });
  return (
    <Box flexDirection="column">
      <Transcript key={state.staticEpoch} staticItems={state.staticItems} pendingItems={state.pendingItems} streaming={state.streaming} />
      {todosOpen ? <TaskPanel tasks={state.tasks} /> : null}
      {state.busy ? <TurnSpinner startedAt={state.turnStartedAt} tokens={state.turnTokens} /> : null}
      {state.queue.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {state.queue.map((q, i) => <Text key={i} dimColor>⋯ queued: {q.length > 60 ? q.slice(0, 59) + "…" : q}</Text>)}
        </Box>
      ) : null}
      {state.shortcutsOpen
        ? <ShortcutsOverlay onClose={closeShortcuts} />
        : transcriptOpen
        // The ONLY route from the retained document to the pager: useChat's detailItems closure re-projects
        // it at whichever detail projection the pager currently wants. ChatApp never projects detail itself
        // and never owns show-all state — Ctrl-E is pager-local, Ctrl-O/Escape are all this arm decides.
        ? <TranscriptPager makeItems={detailItems} onClose={() => setTranscriptOpen(false)} />
        : state.historyOpen
        ? <HistorySearchOverlay load={loadHistory} onAccept={acceptHistory} onExecute={executeHistory} onCancel={closeHistorySearch} />
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
          ? <RewindPicker anchors={state.rewindPicker.anchors} onDryRun={rewindDryRun} onConfirm={confirmRewind} onClose={closeRewindPicker} />
          : state.bgPanelOpen
            ? <BgTasksPanel tasks={state.bgRows} onStop={stopBgTask} onClose={closeBgPanel} />
            : state.modelPicker.open
              ? <ModelPicker models={state.modelPicker.models} onPick={pickModel} onCancel={closeModelPicker} />
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
                  ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker} />
                  : state.pending
                  ? state.pending.kind === "question"
                    // key = toolUseID: dropPending promotes the NEXT queued decision straight into `pending`
                    // with no intermediate null render, so without a key the same QuestionDialog instance
                    // would carry stale internal progress (qi/idx/checked) into an unrelated toolUseID's
                    // question set — a fresh key forces the clean remount a new decision needs.
                    ? <QuestionDialog key={state.pending.toolUseID} req={state.pending}
                        onAnswer={(answers, response) => resolveDecision({ kind: "question_answer", answers, ...(response ? { response } : {}) })}
                        onDeny={() => resolveDecision({ kind: "deny" })} />
                    : state.pending.kind === "plan"
                      ? <PlanDialog key={state.pending.toolUseID} req={state.pending} onDecision={(o) => resolveDecision(o)} />
                      : <PermissionDialog key={state.pending.toolUseID} req={state.pending} onDecision={(d) => resolveDecision(d)} />
                  : <ChatComposer onSubmit={(t) => { submit(t); disarm(); }} cwd={cwd} commandCatalog={state.commandCatalog} onExit={exit} onCycleMode={onCycleMode} onInterrupt={onInterrupt} onHelp={openShortcuts} onDraftStart={disarmEsc} inputOwnerRef={inputOwnerRef} editorStateRef={editorStateRef} consumedPrefillTokenRef={consumedPrefillTokenRef} prefill={state.composerPrefill} onPrefillApplied={clearPrefill} onKillAgents={killAgents} yankHintMs={yankHintMs} busy={state.busy} escClearMs={escClearMs} />}
      {exitArmed ? <Box paddingX={1}><Text dimColor>Press Ctrl-C again to exit</Text></Box> : null}
      {escArmed ? <Box paddingX={1}><Text dimColor>Press Esc again to rewind</Text></Box> : null}
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} thinkLevel={state.thinkLevel} bgCount={state.bgTasks.length} usageWarn={state.usageWarn} />
    </Box>
  );
}
