// tui/src/ChatApp.tsx — composes the transcript, the composer (or the permission dialog when one is
// pending), and the status bar. Global keys (Esc interrupt, Tab cycle mode) are inactive while a dialog
// is up so the dialog owns input. Reuses increment 2's <Composer>.
import React from "react";
import { Box, useInput } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import type { UiBrokerHandle } from "./uiBroker.js";
import { Transcript } from "./Transcript.js";
import { Composer } from "./Composer.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { ChatStatusBar } from "./ChatStatusBar.js";
import { SessionPicker } from "./SessionPicker.js";

export function ChatApp({ makeSession, broker, hookOpts }: { makeSession: (resume?: string) => ChatSession; broker: UiBrokerHandle; hookOpts?: { initialMode?: string } }) {
  const { state, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession } = useChat(makeSession, broker, hookOpts ?? {});
  useInput((input, key) => {
    if (key.escape) { interrupt(); return; }
    if (key.tab) cycleMode();   // Tab cycles the permission mode (default ↔ bypassPermissions)
  }, { isActive: !state.pending && !state.picker.open });
  return (
    <Box flexDirection="column">
      <Transcript lines={state.lines} streaming={state.streaming} />
      {state.picker.open
        ? <SessionPicker sessions={state.picker.sessions} onPick={pickSession} onCancel={closePicker} />
        : state.pending
          ? <PermissionDialog req={state.pending.req} onDecision={resolvePermission} />
          : <Composer onSubmit={submit} />}
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} />
    </Box>
  );
}
