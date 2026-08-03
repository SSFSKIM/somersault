// tui/src/SessionPicker.tsx — the /resume modal: a selectable list of prior sessions (↑/↓ · Enter · Esc).
//
// F2 Task 8: the picker stopped calling `useInput`. It pushes the `Select` context (keys/selectKeys.ts), so
// the four keys its own handler used to read are now that context's eight actions — KB14's j/k and
// ctrl+n/ctrl+p and KB15's pageup/pagedown/home/end come with it, and the context's null bindings unbind the
// six root globals declaratively (this is an "overlay" owner, as ChatApp's deleted gate used to say in code).
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useSelectKeys } from "./keys/selectKeys.js";
import type { SessionInfo } from "./useChat.js";

export function SessionPicker({ sessions, onPick, onCancel }: { sessions: SessionInfo[]; onPick: (s: SessionInfo) => void; onCancel: () => void }) {
  const [idx, setIdx] = useState(0);
  useSelectKeys({
    count: sessions.length, index: idx, onMove: setIdx, onCancel,
    onAccept: () => { if (sessions[idx]) onPick(sessions[idx]); },
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>resume a session  (↑/↓ · Enter · Esc)</Text>
      {sessions.length === 0
        ? <Text dimColor>no sessions</Text>
        : sessions.map((s, i) => <Text key={s.sessionId} inverse={i === idx}>{`${s.sessionId.slice(0, 8)}  ${s.summary || s.firstPrompt || "(untitled)"}`}</Text>)}
    </Box>
  );
}
