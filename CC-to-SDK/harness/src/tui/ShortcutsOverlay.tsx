// tui/src/ShortcutsOverlay.tsx — the `?` help overlay (Stage C5 task 7): a pure-display bordered keymap
// panel that dismisses on Escape ONLY (F0 KB6) — every other key is swallowed so it can't double-fire into
// ChatApp's global chords underneath (e.g. Ctrl-O used to close the overlay AND open the pager in the same
// keystroke). Every row here corresponds to a binding that ACTUALLY exists: the table-owned rows say so by
// construction (they print the live binding or nothing), and the editor-owned rows are pinned one-for-one to an
// executable proof by `test/tui/honesty.test.tsx`. A help row for a binding we don't implement would be a false
// promise, so nothing is listed here that isn't wired elsewhere in this package.
//
// F2 Task 7: "swallowed" is no longer a promise this component's own `useInput` had to keep by inspecting
// each key. It pushes the `Help` context and calls `useSwallowKeys(true)`; from there the PROVIDER drops
// everything Help does not bind — Global's own bindings included, which is the ctrl+o double-fire stated
// structurally. Ctrl-Z still suspends, because the provider handles it above the table (F0 contract).
// The scope and the swallow live HERE, together, on purpose: the swallower is identified as the innermost
// live scope (keys/registry.ts), and this component — mounted last, with nothing inside it — is exactly that.
// F2 Task 10: the key column is no longer typed here at all. Every row whose key lives in the binding table
// names its ACTION (keys/hints.ts `SHORTCUT_ROWS`) and prints whatever the LIVE table binds it to — so a user
// rebinding moves the row with it, and an unbind prints `(unbound)` instead of a chord that no longer works.
// The editor's own keys (the readline set, the `!`/`#`/`@`/`/` prefixes) stay literal because they are the
// keymap's FALLBACK by design: `editor.ts` owns them and no context binds them.
import React from "react";
import { Box, Text } from "ink";
import { useBindingLookup, useKeyActions, useKeyScope, useSwallowKeys } from "./keys/KeymapProvider.js";
import { defaultLookup, shortcutRows } from "./keys/hints.js";
import { ACCENT } from "./theme.js";

/** The grid under the SHIPPED keymap — what `test/tui/honesty.test.tsx` audits (every advertised chord needs a
 *  live proof). The component below renders the user's own table instead; this is the no-user-layer answer. */
export const ROWS: [string, string][] = shortcutRows(defaultLookup);

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useKeyScope("Help");
  useSwallowKeys(true);
  useKeyActions({ "help:dismiss": () => onClose() });    // KB6: Escape, and only Escape, closes the overlay
  // Not `{ live: true }`: while this overlay is up, Help is the only live scope — the whole grid describes keys
  // that fire once it CLOSES, so it must read the whole table, not just what resolves under the swallow.
  const rows = shortcutRows(useBindingLookup());
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Keyboard shortcuts  <Text dimColor>(esc closes)</Text></Text>
      {/* Keyed by POSITION, not by the rendered key column: the column is derived, so two rows can print the
          same string — unbind `chat:cancel` and both of its rows say `(unbound)` — and duplicate React keys
          make React drop one of them. The grid is a fixed, statically-ordered list, so the index is stable. */}
      {rows.map(([k, label], i) => (
        <Box key={i} flexDirection="row">
          <Box width={18}><Text color={ACCENT}>{k}</Text></Box>
          <Text dimColor>{label}</Text>
        </Box>
      ))}
    </Box>
  );
}
