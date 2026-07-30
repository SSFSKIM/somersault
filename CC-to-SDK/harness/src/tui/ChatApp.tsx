// tui/src/ChatApp.tsx — composes the transcript, the composer (or the permission dialog when one is
// pending), and the status bar. Esc interrupt / Shift+Tab cycle mode are owned by the composer and
// inactive while a dialog is up; Ctrl-C / Ctrl-Z / Ctrl-B / Ctrl-T / Ctrl-O stay active even during a
// dialog (Ctrl-Z can still detach — detach ≠ deny). Ctrl-L moved into the editor (Task 2) — it used to
// live here as an app-level screen-clear that fired ALONGSIDE the editor's own input-clear on every
// Ctrl-L (a transient double-handling); removing this arm leaves the editor as Ctrl-L's sole owner.
// Ctrl-O (Task 5) opens the transcript pager; Ctrl-Z is checked ABOVE that gate (detach stays reachable
// even under the pager overlay) but every OTHER app arm is gated while the pager is open — the pager
// owns the keys, including its own ctrl+c as transcript:exit (per the bundle), so the app's Ctrl-C
// exit-arm must not also fire underneath it. Ctrl-R (Wave 2 task 7) opens the history-search overlay —
// same gating pattern: Ctrl-Z stays live, every other app arm is gated while it's open (its own Ctrl-C/
// Ctrl-R/Ctrl-S own those keys). Renders increment 8's multiline <ChatComposer>.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import type { InitialResume } from "./commands.js";
import type { RenderLine } from "./render.js";
import { Transcript } from "./Transcript.js";
import { ChatComposer } from "./ChatComposer.js";
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

export function ChatApp({ makeSession, client, onDetach, initialPrompt, hookOpts, cwd, initialResume, initialLines, deps }: {
  makeSession: (resume?: string) => ChatSession;
  client: { kind: "loopback" | "attached"; short?: string };
  onDetach?: () => void;
  initialPrompt?: string;
  hookOpts?: { initialMode?: string; initialModel?: string; initialThink?: string };
  cwd: string;
  initialResume?: InitialResume;
  initialLines?: RenderLine[];
  deps?: Parameters<typeof useChat>[2];
}) {
  const { exit } = useApp();                                        // declared FIRST: /exit hands it to useChat
  const { state, submit, resolveDecision, cycleMode, interrupt, closePicker, pickSession, closeModelPicker, pickModel, notice, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, clearPrefill, openHistorySearch, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog } = useChat(makeSession, { ...(hookOpts ?? {}), cwd, initialResume, initialLines, initialPrompt, onExit: exit }, deps);
  const [exitArmed, setExitArmed] = useState(false);
  const [todosOpen, setTodosOpen] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
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
  // Only Ctrl-C / Ctrl-Z / Ctrl-B / Ctrl-T live here — they conflict with nothing (composer/dialog/pickers never act
  // on them), so this stays active even during a pending dialog (so Ctrl-C can still quit, Ctrl-Z can still
  // detach). Shift+Tab/Esc are owned by whatever input is focused: the composer fires onCycleMode on
  // Shift+Tab even with a `/`/`@` popup open (matches 2.1.220 — the Autocomplete context binds only
  // tab/esc/↑/↓, so shift+tab falls through to Chat's cycleMode), and routes Esc to onInterrupt only
  // when no popup is open; dialogs/pickers own their own Esc.
  // Ctrl-L lives in the editor now (Task 2), not here.
  useInput((input, key) => {
    if (key.ctrl && input === "z") {
      // Detach ≠ deny (spec A2b §5): a pending remote permission stays parked either way — useChat's
      // unmount sentinel never resolves it. Loopback has nobody else to hand the session to, so it refuses.
      if (client.kind === "attached") { onDetach?.(); exit(); }
      else notice("not detachable — run with --detachable, or ccx attach from another terminal");
      return;
    }
    if (transcriptOpen) {                                   // pager owns the keys (its ctrl+c = transcript:exit, per bundle)
      if (key.ctrl && input === "o") { setTranscriptOpen(false); disarm(); }
      return;
    }
    if (state.historyOpen) return;   // the overlay owns Ctrl-C (cancel) / Ctrl-R (next) / Ctrl-S (scope); only Ctrl-Z above stays live
    if (state.themeDialog.open) return;   // W3 T4: the /theme dialog owns its own keys (Ctrl-O/R/T/B, Esc-arm stay dead underneath it)
    if (state.addDir.open) return;   // W3 T3: the /add-dir dialog owns its own keys (Ctrl-O/R/T/B, Esc-arm stay dead underneath it)
    // Both open arms are gated on !rewinding (F3, final review): a confirmed rewind is a multi-second
    // engine swap held behind the "⏪ restoring…" modal so a mid-rewind prompt isn't lost — Ctrl-R/Ctrl-O
    // opening another overlay (or, for history, Enter-executing straight into the busy host) would
    // reintroduce exactly the loss mode that modal exists to prevent.
    if (key.ctrl && input === "o" && !state.rewinding) { setTranscriptOpen(true); disarm(); return; }   // CC app:toggleTranscript
    if (key.ctrl && input === "r" && !state.rewinding) { openHistorySearch(); disarm(); return; }   // CC history:search (Global)
    if (key.ctrl && input === "t") { setTodosOpen((v) => !v); disarm(); return; }   // CC app:toggleTodos
    if (key.ctrl && input === "c") {                                // interrupt a turn, else arm/confirm exit (CC)
      if (state.busy) { interrupt(); disarm(); return; }
      if (exitArmed) { exit(); return; }
      setExitArmed(true); if (disarmTimer.current) clearTimeout(disarmTimer.current); disarmTimer.current = setTimeout(() => setExitArmed(false), 2000);
    }
    if (key.ctrl && input === "b") { state.busy ? backgroundNow() : openBgPanel(); disarm(); return; }
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
        ? <ShortcutsOverlay onClose={closeShortcuts} />
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
              // W3 T4: the four new settings-surface dialogs slot HERE, between modelPicker and picker, in
              // the order settings → permissions → theme → addDir (Tasks 5/7 add the first two later; theme
              // goes immediately before the existing addDir arm — plan Global Constraints line 38).
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
                  : <ChatComposer onSubmit={(t) => { submit(t); disarm(); }} cwd={cwd} commandCatalog={state.commandCatalog} onExit={exit} onCycleMode={onCycleMode} onInterrupt={onInterrupt} onHelp={openShortcuts} prefill={state.composerPrefill} onPrefillApplied={clearPrefill} onKillAgents={killAgents} />}
      {exitArmed ? <Box paddingX={1}><Text dimColor>Press Ctrl-C again to exit</Text></Box> : null}
      {escArmed ? <Box paddingX={1}><Text dimColor>Press Esc again to rewind</Text></Box> : null}
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} thinkLevel={state.thinkLevel} bgCount={state.bgTasks.length} usageWarn={state.usageWarn} />
    </Box>
  );
}
