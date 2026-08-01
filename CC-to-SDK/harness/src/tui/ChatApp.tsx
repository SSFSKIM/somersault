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
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import { suspendProcess } from "./suspend.js";
import type { InitialResume } from "./commands.js";
import type { RenderLine } from "./render.js";
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

export function ChatApp({ makeSession, client, onDetach, initialPrompt, hookOpts, cwd, initialResume, initialLines, deps, yankHintMs, escClearMs, suspend, resumeOutput }: {
  makeSession: (resume?: string) => ChatSession;
  client: { kind: "loopback" | "attached"; short?: string };
  onDetach?: () => void;
  initialPrompt?: string;
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string; initialOutputStyle?: string };
  cwd: string;
  initialResume?: InitialResume;
  initialLines?: RenderLine[];
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
  const { state, submit, resolveDecision, cycleMode, interrupt, closePicker, pickSession, closeModelPicker, pickModel, openModelPicker, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, clearPrefill, openHistorySearch, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, applyMode, setThink, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir } = useChat(makeSession, { ...(hookOpts ?? {}), cwd, initialResume, initialLines, initialPrompt, onExit: exit, detach: client.kind === "attached" ? () => { onDetach?.(); exit(); } : undefined }, deps);
  const [exitArmed, setExitArmed] = useState(false);
  const [todosOpen, setTodosOpen] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Durable per-app editor state survives a temporary composer unmount; autocomplete is normalized by the
  // remounting composer, while text, cursor, history, undo, stash, and kill ring remain exact.
  const editorStateRef = useRef<EditorState>(initialEditorState());
  const consumedPrefillTokenRef = useRef(0);
  // Input subscriptions are passive. This ref changes during render, before the visible owner swaps, so a
  // retiring composer can reject the next key even before Ink has removed its listener.
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
  // Ink's useInput subscription is passive, so a root handler can receive a key after a newer render has
  // already painted. Keep every state/callback value consumed by this handler current synchronously.
  const rootStateRef = useRef(state); rootStateRef.current = state;
  const exitArmedRef = useRef(exitArmed); exitArmedRef.current = exitArmed;
  const suspendRef = useRef(suspend); suspendRef.current = suspend;
  const resumeOutputRef = useRef(resumeOutput); resumeOutputRef.current = resumeOutput;
  const closeShortcutsRef = useRef(closeShortcuts); closeShortcutsRef.current = closeShortcuts;
  const openHistorySearchRef = useRef(openHistorySearch); openHistorySearchRef.current = openHistorySearch;
  const interruptRef = useRef(interrupt); interruptRef.current = interrupt;
  const backgroundNowRef = useRef(backgroundNow); backgroundNowRef.current = backgroundNow;
  const openBgPanelRef = useRef(openBgPanel); openBgPanelRef.current = openBgPanel;
  const exitRef = useRef(exit); exitRef.current = exit;
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
  // Ctrl-Z is process-level for EVERY visible owner: upstream's raw input loop handles it before context
  // dispatch, including Help and modal swallowers; suspendProcess is already a Windows-safe no-op. Ctrl-O
  // closes only Transcript or opens it only from Composer; Ctrl-R/T/B are Composer-only. Ctrl-C is allowed
  // from Composer and a visible decision dialog, but never from an ordinary overlay hidden behind a decision.
  // Shift+Tab/Esc are owned by the visible component: the composer fires onCycleMode on Shift+Tab even with
  // a `/`/`@` popup open (matches 2.1.220), and routes Esc to onInterrupt only when no popup is open.
  // Ctrl-L lives in the editor now (Task 2), not here.
  useInput((input, key) => {
    const current = rootStateRef.current;
    const owner = inputOwnerRef.current;
    if (key.ctrl && input === "z") {                            // upstream intercepts this before Help/modal context dispatch
      const repaint = () => write("");
      (suspendRef.current ?? suspendProcess)({ stdin, stdout, repaint: () => {
        const output = resumeOutputRef.current;
        if (output) output.repaint(repaint); else repaint();
      } });
      return;
    }
    if (owner === "shortcuts") {                                // Help owns every non-process key during its visible/race window
      if (key.escape) closeShortcutsRef.current();
      return;
    }
    if (owner === "transcript") {                               // pager owns its keys except its established Ctrl-O close arm
      if (key.ctrl && input === "o") { setTranscriptOpen(false); disarm(); }
      return;
    }
    if (owner === "overlay") return;                            // root globals never bypass the actually visible ordinary overlay
    // Both open arms are gated on !rewinding (F3, final review): a confirmed rewind is a multi-second
    // engine swap held behind the “⏪ restoring…” modal so a mid-rewind prompt isn't lost — Ctrl-R/Ctrl-O
    // opening another overlay (or, for history, Enter-executing straight into the busy host) would
    // reintroduce exactly the loss mode that modal exists to prevent.
    if (key.ctrl && input === "o" && !current.rewinding) { setTranscriptOpen(true); disarm(); return; }   // CC app:toggleTranscript
    if (key.ctrl && input === "r" && !current.rewinding) { openHistorySearchRef.current(); disarm(); return; }   // CC history:search (Global)
    if (key.ctrl && input === "t") { setTodosOpen((v) => !v); disarm(); return; }   // CC app:toggleTodos
    if (key.ctrl && input === "c") {                                // interrupt a turn, else arm/confirm exit (CC)
      if (current.busy) { interruptRef.current(); disarm(); return; }
      if (exitArmedRef.current) { exitRef.current(); return; }
      setExitArmed(true); if (disarmTimer.current) clearTimeout(disarmTimer.current); disarmTimer.current = setTimeout(() => setExitArmed(false), 2000);
    }
    if (key.ctrl && input === "b") { current.busy ? backgroundNowRef.current() : openBgPanelRef.current(); disarm(); return; }
  });
  return (
    <Box flexDirection="column">
      <Transcript key={state.clearToken} lines={state.lines} streaming={state.streaming} />
      {todosOpen ? <TaskPanel tasks={state.tasks} /> : null}
      {state.busy ? <TurnSpinner startedAt={state.turnStartedAt} tokens={state.turnTokens} /> : null}
      {state.queue.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {state.queue.map((q, i) => <Text key={i} dimColor>⋯ queued: {q.length > 60 ? q.slice(0, 59) + "…" : q}</Text>)}
        </Box>
      ) : null}
      {state.shortcutsOpen
        ? <ShortcutsOverlay onClose={closeShortcuts} interactive={false} />
        : transcriptOpen
        ? <TranscriptPager lines={state.lines} onClose={() => setTranscriptOpen(false)} />
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
        ? <Box paddingX={1}><Text dimColor>⏪ restoring…</Text></Box>
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
