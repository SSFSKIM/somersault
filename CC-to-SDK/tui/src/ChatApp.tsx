// tui/src/ChatApp.tsx — composes the transcript, the composer (or the permission dialog when one is
// pending), and the status bar. Global keys (Esc interrupt, Tab cycle mode) are inactive while a dialog
// is up so the dialog owns input. Renders increment 8's multiline <ChatComposer>.
import React from "react";
import { Box, useInput } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import type { UiBrokerHandle } from "./uiBroker.js";
import type { InitialResume } from "./commands.js";
import { Transcript } from "./Transcript.js";
import { ChatComposer } from "./ChatComposer.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { ChatStatusBar } from "./ChatStatusBar.js";
import { SessionPicker } from "./SessionPicker.js";
import { TaskPanel } from "./TaskPanel.js";

export function ChatApp({ makeSession, broker, hookOpts, cwd, initialResume }: { makeSession: (resume?: string) => ChatSession; broker: UiBrokerHandle; hookOpts?: { initialMode?: string }; cwd: string; initialResume?: InitialResume }) {
  const { state, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession } = useChat(makeSession, broker, { ...(hookOpts ?? {}), cwd, initialResume });
  useInput((input, key) => {
    if (key.escape) { interrupt(); return; }
    if (key.tab) cycleMode();   // Tab cycles the permission mode (default ↔ bypassPermissions)
  }, { isActive: !state.pending && !state.picker.open });
  return (
    <Box flexDirection="column">
      <Transcript lines={state.lines} streaming={state.streaming} />
      <TaskPanel tasks={state.tasks} />
      {state.picker.open
        ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker} />
        : state.pending
          ? <PermissionDialog req={state.pending.req} onDecision={resolvePermission} />
          : <ChatComposer onSubmit={submit} cwd={cwd} />}
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} subagentActive={state.subagentActive} />
    </Box>
  );
}
