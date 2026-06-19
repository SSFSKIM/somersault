// tui/src/SessionPicker.tsx — the /resume modal: a selectable list of prior sessions (↑/↓ · Enter · Esc).
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionInfo } from "./useChat.js";

export function SessionPicker({ sessions, onPick, onCancel }: { sessions: SessionInfo[]; onPick: (s: SessionInfo) => void; onCancel: () => void }) {
  const [idx, setIdx] = useState(0);
  useInput((_input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(sessions.length - 1, i + 1));
    else if (key.return && sessions[idx]) onPick(sessions[idx]);
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
