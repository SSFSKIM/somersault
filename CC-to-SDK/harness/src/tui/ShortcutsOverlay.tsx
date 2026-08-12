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
// F6 Task 14 (DG62/DG63): the two-column key/label list this file drew is upstream's `Y6t` now — THREE
// columns of composed sentences (`ctrl + t to toggle tasks`), merged with upstream's own entry set. The
// component lives here, and `/help`'s General tab renders THE SAME ONE (HelpDialog.tsx), because upstream
// does exactly that: `pei` (L459650, the Help dialog's General panel) and the composer's `?` surface
// (L494617) both mount `Y6t`. One grid, one source of truth, one place a row can be added.
import React from "react";
import { Box, Text } from "ink";
import { useBindingLookup, useKeyActions, useKeyScope, useSwallowKeys } from "./keys/KeymapProvider.js";
import { defaultLookup, shortcutGrid, shortcutRows, GRID_COLUMN_WIDTHS } from "./keys/hints.js";
import { newlineHint } from "./composerFrame.js";
import { ACCENT } from "./theme.js";

/** The grid under the SHIPPED keymap — what `test/tui/honesty.test.tsx` audits (every advertised chord needs a
 *  live proof). The component below renders the user's own table instead; this is the no-user-layer answer.
 *  It is the KEY-COLUMN rendering of the very rows the grid prints as sentences (keys/hints.ts's `ShortcutRow`
 *  header): one entry, two grammars, so auditing this corpus audits what the grid advertises. */
export const ROWS: [string, string][] = shortcutRows(defaultLookup);
/** The rows the ALTERNATE-SCREEN renderer adds on top of `ROWS` (FSW T14 review M5) — today, `v`. A set
 *  DIFFERENCE rather than a hand-kept list, so a second conditional row joins the audit by existing.
 *  `honesty.test.tsx` demands a live proof for these exactly as it does for `ROWS`: conditional is a statement
 *  about WHERE a row prints, never a discount on whether the key works. */
export const FULLSCREEN_ROWS: [string, string][] =
  shortcutRows(defaultLookup, process.platform, true).filter(([k]) => !ROWS.some(([classic]) => classic === k));

/** `Y6t` (L459475-634). `dimColor`/`fixedWidth`/`gap`/`paddingX` are its four props, and the two call sites
 *  pass exactly what upstream's do: the `?` overlay `{dimColor, fixedWidth, paddingX:2}` (L494617), the Help
 *  dialog's General panel `{gap:2, fixedWidth}` (L459654). */
export function ShortcutsGrid({ dimColor = false, fixedWidth = false, gap, paddingX, fullscreen = false }: {
  dimColor?: boolean; fixedWidth?: boolean; gap?: number; paddingX?: number; fullscreen?: boolean;
}) {
  // `hasUsedBackslashReturn` is EditorState the grid cannot see (no composer is mounted while it shows), so
  // the ladder stands on its long rung here — see `ShortcutGridOptions.newline`.
  //   `fullscreen` ADDS THE ROWS WHOSE KEY ONLY EXISTS IN THAT RENDERER (`hints.ts`'s `ShortcutRow.fullscreen`).
  // It is a prop and not a context read because both call sites already know which tree they are in, and a
  // bare render — every test that mounts this component alone — must get the classic set.
  const columns = shortcutGrid(useBindingLookup(), { newline: newlineHint(false), fullscreen });
  return (
    <Box flexDirection="row" gap={gap} paddingX={paddingX}>
      {/* Keyed by POSITION in both directions: a cell is derived text, so two of them can read the same
          string, and duplicate React keys make React drop one. Both lists are statically ordered. */}
      {columns.map((cells, col) => (
        <Box key={col} flexDirection="column" width={fixedWidth ? GRID_COLUMN_WIDTHS[col] : undefined}>
          {cells.map((cell, i) => <Box key={i}><Text dimColor={dimColor}>{cell}</Text></Box>)}
        </Box>
      ))}
    </Box>
  );
}

export function ShortcutsOverlay({ onClose, fullscreen = false }: { onClose: () => void; fullscreen?: boolean }) {
  useKeyScope("Help");
  useSwallowKeys(true);
  useKeyActions({ "help:dismiss": () => onClose() });    // KB6: Escape, and only Escape, closes the overlay
  // The heading and the border are OURS, not upstream's — upstream's `?` surface is the bare grid inside the
  // composer frame. Kept because this is a dismissable overlay in ccx and the "how do I get out" affordance
  // has to be on screen; recorded divergence, unchanged by this task.
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Keyboard shortcuts  <Text dimColor>(esc closes)</Text></Text>
      <ShortcutsGrid dimColor fixedWidth paddingX={2} fullscreen={fullscreen} />
    </Box>
  );
}
