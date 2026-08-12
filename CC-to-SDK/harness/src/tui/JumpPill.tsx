// tui/JumpPill.tsx — the jump-to-bottom pill (FSW Task 11; canon `JDa`, bundle 456145-456196).
//
// WHY IT IS NOT DECORATION. On the alternate screen there is no scrollback and no scrollbar, so a user who has
// scrolled up has NO evidence that the transcript is still growing and no visible way back to it. The pill is
// both: it announces what arrived while they were away and it names the key that returns them.
//
// WHAT IS CANON'S HERE: the two label forms (`"N new message(s)"` when something arrived, else
// `"Jump to bottom"`), the resolved keybinding as a suffix, the longest-variant-that-fits rule against
// `columns − 2` (456169), the `userMessageBackground` fill, and the predicate that shows it — not sticky AND
// not at the end (`qqH`, 455869-455878), which lives in `FullscreenViewport` where both facts are.
//
// TWO RECORDED DIVERGENCES, both forced by the medium rather than chosen:
//  · Canon's pill is `position:absolute bottom:0` over the scroll box and costs the transcript nothing. Ink has
//    no absolute positioning inside a Box, so this is an ordinary flow row and the viewport SUBTRACTS it from
//    the window before slicing — see FullscreenViewport's header. Visually identical (the pill covers the
//    window's last row); structurally a row the transcript gives up while the pill is up.
//  · Canon counts unseen MESSAGES. The viewport's document is physical rows and nothing in it knows where one
//    message ends, so `newRows` is the growth in the row total since stickiness was last held. The label keeps
//    canon's word.
// Canon's third variant is `(click)` for the mouse affordance; this wave is keyboard-only, so the fallback is
// the bare arrow instead — a pill that offered a click nothing listens for would be worse than a small one.
import React from "react";
import { Box, Text } from "ink";
import { formatBindingLower } from "./keys/hints.js";
import { useBinding } from "./keys/KeymapProvider.js";
import { resolveThemeColor, themeTokens } from "./theme.js";

/** The action the pill advertises and the pill's own gesture: canon's `scrollToBottom()`, which re-STICKS as
 *  well as re-deriving — "follow the tail again", not merely "show me the tail once". */
export const JUMP_PILL_ACTION = "scroll:bottom";

/** The pill's rendered text INCLUDING its one-column breathing space on each side, which is what the fit rule
 *  measures: canon picks the longest of its variants that fits `columns − 2` (456169). Longest first, so a
 *  narrow terminal loses the chord before it loses the words and the words before it loses the affordance.
 *  An unbound `scroll:bottom` contributes no suffix at all rather than an empty parenthesis — the same
 *  three-state honesty `hints.ts` applies to every derived chord. */
export function jumpPillText(newRows: number, chord: string, columns: number): string {
  const base = newRows > 0 ? `${newRows} new message${newRows === 1 ? "" : "s"}` : "Jump to bottom";
  const room = Math.max(1, columns - 2);
  for (const variant of [chord === "" ? "" : ` ${base} (${chord}) `, ` ${base} `])
    if (variant !== "" && variant.length <= room) return variant;
  return " ↓ ";
}

export interface JumpPillProps {
  /** Rows that arrived below the window since stickiness was lost. Zero prints the destination instead. */
  newRows: number;
  /** The region's width — the fit rule's input. */
  columns: number;
}

export function JumpPill({ newRows, columns }: JumpPillProps): React.ReactElement {
  // Derived from the LIVE table, so a user who rebinds `scroll:bottom` sees their own key here. `useBinding`
  // searches active scopes first, and the viewport pushes `Scroll` before this child renders, so the answer is
  // that context's key rather than the ctrl+O pager's `end`/`shift+g`.
  const chord = formatBindingLower(useBinding(JUMP_PILL_ACTION));
  return (
    <Box justifyContent="center" flexShrink={0}>
      <Text backgroundColor={resolveThemeColor(themeTokens().userMessageBackground)}>{jumpPillText(newRows, chord, columns)}</Text>
    </Box>
  );
}
