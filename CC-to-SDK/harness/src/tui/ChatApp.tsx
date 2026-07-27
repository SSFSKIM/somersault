// tui/src/ChatApp.tsx — composes the transcript, the composer (or the permission dialog when one is
// pending), and the status bar. Global keys (Esc interrupt, Tab cycle mode, Ctrl-Z detach) are inactive
// while a dialog is up so the dialog owns input. Renders increment 8's multiline <ChatComposer>.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import type { InitialResume } from "./commands.js";
import type { RenderLine } from "./render.js";
import { Transcript } from "./Transcript.js";
import { ChatComposer } from "./ChatComposer.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { ChatStatusBar } from "./ChatStatusBar.js";
import { SessionPicker } from "./SessionPicker.js";
import { ModelPicker } from "./ModelPicker.js";
import { TaskPanel } from "./TaskPanel.js";
import { TurnSpinner } from "./TurnSpinner.js";

export function ChatApp({ makeSession, client, onDetach, initialPrompt, hookOpts, cwd, initialResume, initialLines }: {
  makeSession: (resume?: string) => ChatSession;
  client: { kind: "loopback" | "attached"; short?: string };
  onDetach?: () => void;
  initialPrompt?: string;
  hookOpts?: { initialMode?: string; initialThink?: string };
  cwd: string;
  initialResume?: InitialResume;
  initialLines?: RenderLine[];
}) {
  const { state, submit, resolvePermission, cycleMode, interrupt, clear, closePicker, pickSession, closeModelPicker, pickModel, notice } = useChat(makeSession, { ...(hookOpts ?? {}), cwd, initialResume, initialLines, initialPrompt });
  const { exit } = useApp();
  const [exitArmed, setExitArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => { setExitArmed(false); if (disarmTimer.current) { clearTimeout(disarmTimer.current); disarmTimer.current = null; } };
  useEffect(() => () => { if (disarmTimer.current) clearTimeout(disarmTimer.current); }, []);
  const onInterrupt = () => { interrupt(); disarm(); };
  const onCycleMode = () => { cycleMode(); disarm(); };   // Tab cycles the permission ladder (default → acceptEdits → auto)
  // Only Ctrl-C / Ctrl-L / Ctrl-Z live here — they conflict with nothing (composer/dialog/pickers never act
  // on them), so this stays active even during a pending dialog (so Ctrl-C can still quit, Ctrl-Z can still
  // detach). Tab/Esc are owned by whatever input is focused (the composer routes them to
  // onCycleMode/onInterrupt only when no popup is open — no double-handling; dialogs/pickers own their own Esc).
  useInput((input, key) => {
    if (key.ctrl && input === "l") { clear(); disarm(); return; }
    if (key.ctrl && input === "z") {
      // Detach ≠ deny (spec A2b §5): a pending remote permission stays parked either way — useChat's
      // unmount sentinel never resolves it. Loopback has nobody else to hand the session to, so it refuses.
      if (client.kind === "attached") { onDetach?.(); exit(); }
      else notice("not detachable — run with --detachable, or ccx attach from another terminal");
      return;
    }
    if (key.ctrl && input === "c") {                                // interrupt a turn, else arm/confirm exit (CC)
      if (state.busy) { interrupt(); disarm(); return; }
      if (exitArmed) { exit(); return; }
      setExitArmed(true); if (disarmTimer.current) clearTimeout(disarmTimer.current); disarmTimer.current = setTimeout(() => setExitArmed(false), 2000);
    }
  });
  return (
    <Box flexDirection="column">
      <Transcript key={state.clearToken} lines={state.lines} streaming={state.streaming} />
      <TaskPanel tasks={state.tasks} />
      {state.busy ? <TurnSpinner startedAt={state.turnStartedAt} tokens={state.turnTokens} /> : null}
      {state.queue.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {state.queue.map((q, i) => <Text key={i} dimColor>⋯ queued: {q.length > 60 ? q.slice(0, 59) + "…" : q}</Text>)}
        </Box>
      ) : null}
      {state.modelPicker.open
        ? <ModelPicker models={state.modelPicker.models} onPick={pickModel} onCancel={closeModelPicker} />
        : state.picker.open
          ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker} />
          : state.pending
            ? <PermissionDialog req={state.pending} onDecision={resolvePermission} />
            : <ChatComposer onSubmit={(t) => { submit(t); disarm(); }} cwd={cwd} commandCatalog={state.commandCatalog} onExit={exit} onCycleMode={onCycleMode} onInterrupt={onInterrupt} />}
      {exitArmed ? <Box paddingX={1}><Text dimColor>Press Ctrl-C again to exit</Text></Box> : null}
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} subagentActive={state.subagentActive} thinkLevel={state.thinkLevel} />
    </Box>
  );
}
