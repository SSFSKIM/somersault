// tui/src/ShortcutsOverlay.tsx — the `?` help overlay (Stage C5 task 7): a pure-display bordered keymap
// panel that dismisses on any keypress. Every row here corresponds to a binding that ACTUALLY exists —
// checked against ChatApp.tsx (Ctrl-C/Ctrl-Z/Ctrl-T/Esc), editor.ts (Ctrl-L/Ctrl-_/Ctrl-S + the readline
// and word-movement keys), and ChatComposer.tsx (⇧Tab/!/#/@// prefixes, Ctrl-D). A help row for a binding
// we don't implement would be a false promise, so nothing is listed here that isn't wired elsewhere in
// this package (Ctrl-X Ctrl-E's external-editor row arrives with a later task, not here).
import React from "react";
import { Box, Text, useInput } from "ink";
import { ACCENT } from "./theme.js";

const ROWS: [string, string][] = [
  ["⏎", "send"],
  ["\\⏎ / Ctrl-J", "newline"],
  ["↑↓", "history"],
  ["Ctrl-A/E/K/U/W", "line start/end · kill to end/start · kill word"],
  ["Alt-←→ / Alt-b/f", "move by word"],
  ["Ctrl-L", "clear input"],
  ["Ctrl-_", "undo edit"],
  ["Ctrl-S", "stash / restore input"],
  ["⇧Tab", "mode ladder"],
  ["Esc", "interrupt"],
  ["Esc Esc", "rewind"],
  ["Ctrl-T", "todo panel"],
  ["Ctrl-B", "background"],
  ["Ctrl-C ×2", "exit"],
  ["Ctrl-D", "EOF"],
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
