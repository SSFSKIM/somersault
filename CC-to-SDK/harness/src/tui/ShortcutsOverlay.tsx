// tui/src/ShortcutsOverlay.tsx — the `?` help overlay (Stage C5 task 7): a pure-display bordered keymap
// panel that dismisses on Escape ONLY (F0 KB6) — every other key is swallowed so it can't double-fire into
// ChatApp's global chords underneath (e.g. Ctrl-O used to close the overlay AND open the pager in the same
// keystroke). Every row here corresponds to a binding that ACTUALLY exists — checked against ChatApp.tsx
// (Ctrl-C/Ctrl-Z/Ctrl-T/Ctrl-O/Esc), editor.ts (Ctrl-L/Ctrl-_/Ctrl-S + the readline and word-movement keys),
// and ChatComposer.tsx (⇧Tab/!/#/@// prefixes, Ctrl-D, Ctrl-X Ctrl-E / Ctrl-G external editor). A help row
// for a binding we don't implement would be a false promise, so nothing is listed here that isn't wired
// elsewhere in this package.
import React from "react";
import { Box, Text, useInput } from "ink";
import { ACCENT } from "./theme.js";

const BASE_ROWS: [string, string][] = [
  ["⏎", "send"],
  ["\\⏎ / Ctrl-J", "newline"],
  ["↑↓", "history"],
  ["Ctrl-A/E/K/U/W", "line start/end · kill to end/start · kill word"],
  ["Ctrl-Y / Alt-Y", "yank / yank-pop killed text"],
  ["Alt-←→ / Alt-b/f", "move by word"],
  ["Ctrl-L", "clear input"],
  ["Ctrl-_", "undo edit"],
  ["Ctrl-S", "stash / restore input"],
  ["Ctrl-X Ctrl-E / Ctrl-G", "edit in $EDITOR"],
  ["⇧Tab", "mode ladder"],
  ["Esc", "interrupt (while running)"],
  ["Esc Esc", "clear input · rewind when empty"],
  ["Ctrl-T", "todo panel"],
  ["Ctrl-O", "transcript pager"],
  ["Ctrl-R", "search prompt history"],
  ["Ctrl-B", "background"],
  ["Ctrl-X Ctrl-K", "stop background agents (×2)"],
  ["Ctrl-C ×2", "exit"],
  ["Ctrl-D ×2", "exit"],
  ["Ctrl-Z", "suspend to shell (fg resumes)"],
  ["!", "bash"],
  ["#", "memory"],
  ["@", "files"],
  ["/", "commands"],
  ["?", "this help"],
];

export const ROWS: [string, string][] = process.platform === "win32" ? BASE_ROWS.filter(([key]) => key !== "Ctrl-Z") : BASE_ROWS;

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useInput((_input, key) => { if (key.escape) onClose(); });   // KB6: Escape only — every other key is swallowed here, not left to leak into a chord underneath
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Keyboard shortcuts  <Text dimColor>(esc closes)</Text></Text>
      {ROWS.map(([k, label]) => (
        <Box key={k} flexDirection="row">
          <Box width={18}><Text color={ACCENT}>{k}</Text></Box>
          <Text dimColor>{label}</Text>
        </Box>
      ))}
    </Box>
  );
}
