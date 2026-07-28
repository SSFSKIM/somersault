// tui/src/ShortcutsOverlay.tsx — the `?` help overlay (Stage C5 task 7): a pure-display bordered keymap
// panel that dismisses on any keypress. Every row here corresponds to a binding that ACTUALLY exists —
// checked against ChatApp.tsx (Ctrl-C/Ctrl-L/Ctrl-Z/Tab/Esc), editor.ts (the readline + word-movement
// keys), and ChatComposer.tsx (!/#/@// prefixes, Ctrl-D). A help row for a binding we don't implement
// would be a false promise, so nothing is listed here that isn't wired elsewhere in this package.
import React from "react";
import { Box, Text, useInput } from "ink";
import { ACCENT } from "./theme.js";

const ROWS: [string, string][] = [
  ["⏎", "send"],
  ["\\⏎", "newline"],
  ["↑↓", "history"],
  ["Ctrl-A/E/K/U/W", "line start/end · kill to end/start · kill word"],
  ["Alt-←→ / Alt-b/f", "move by word"],
  ["Tab", "mode ladder"],
  ["Esc", "interrupt"],
  ["Esc Esc", "rewind"],
  ["Ctrl+B", "background"],
  ["Ctrl-C ×2", "exit"],
  ["Ctrl-D", "EOF"],
  ["Ctrl-L", "clear"],
  ["Ctrl-Z", "detach"],
  ["!", "bash"],
  ["#", "memory"],
  ["@", "files"],
  ["/", "commands"],
  ["?", "this help"],
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useInput(() => onClose());   // pure display — any key dismisses it, no key is otherwise interpreted
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Keyboard shortcuts  <Text dimColor>(any key closes)</Text></Text>
      {ROWS.map(([k, label]) => (
        <Box key={k} flexDirection="row">
          <Box width={18}><Text color={ACCENT}>{k}</Text></Box>
          <Text dimColor>{label}</Text>
        </Box>
      ))}
    </Box>
  );
}
