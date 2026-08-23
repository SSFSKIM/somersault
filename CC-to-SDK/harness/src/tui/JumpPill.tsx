// tui/JumpPill.tsx — the jump-to-bottom pill (FSW Task 11; canon `JDa`, bundle 456145-456196).
//
// WHY IT IS NOT DECORATION. On the alternate screen there is no scrollback and no scrollbar, so a user who has
// scrolled up has NO evidence that the transcript is still growing and no visible way back to it. The pill is
// both: it announces what arrived while they were away and it names the key that returns them.
//
// WHAT IS CANON'S HERE: the two label forms (`"N new message(s)"` when something arrived, else
// `"Jump to bottom"`), the resolved keybinding and the trailing `↓` as suffixes, the three label variants and
// the longest-that-fits rule against `columns − 2` (456166-456171), the `truncate-end` wrap under it, the
// `userMessageBackground` fill, and the predicate that shows it — not sticky AND not at the end (`qqH`,
// 455869-455878), which lives in `FullscreenViewport` where both facts are.
//
// TWO RECORDED DIVERGENCES, both forced by the medium rather than chosen:
//  · Canon's pill is `position:absolute bottom:0` over the scroll box and costs the transcript nothing. Ink has
//    no absolute positioning inside a Box, so this is an ordinary flow row and the viewport SUBTRACTS it from
//    the window before slicing — see FullscreenViewport's header. Visually identical (the pill covers the
//    window's last row); structurally a row the transcript gives up while the pill is up.
//  · Canon counts unseen MESSAGES. The viewport's document is physical rows and nothing in it knows where one
//    message ends, so `newRows` is the growth in the row total since stickiness was last held. The label keeps
//    canon's word.
// Canon's `(click)` and `: <chord> to scroll` forms are the macOS-with-mouse branch of the LONGEST variant
// (456156-456165), not extra lengths; this wave is keyboard-only, so only the bound-chord arm of that branch
// is reachable and the three lengths below are canon's whole ladder.
import React, { useContext } from "react";
import { Box, Text } from "ink";
import { formatBindingLower } from "./keys/hints.js";
import { useBindingLookup } from "./keys/KeymapProvider.js";
import { preferredKey } from "./keys/resolver.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { HoverContext } from "./mouse/hoverContext.js";

/** The action the pill advertises and the pill's own gesture: canon's `scrollToBottom()`, which re-STICKS as
 *  well as re-deriving — "follow the tail again", not merely "show me the tail once". */
export const JUMP_PILL_ACTION = "scroll:bottom";
/** The escape the pill's longest rung announces (FSW T12's `v`), resolved from the live table beside the jump
 *  chord rather than printed as the letter canon ships. */
export const DUMP_PILL_ACTION = "scroll:dumpTranscript";

/** The pill's rendered text INCLUDING its one-column breathing space on each side, which is what the fit rule
 *  measures: canon picks the longest of three variants that fits `columns − 2` and falls back to the SHORTEST
 *  whether it fits or not, letting the truncation clip it (456166-456171,
 *  `[sIr, Ehf, Ybt].find(v => Ut(v) <= columns - 2) ?? Ybt`). Longest first, so a narrow terminal loses the
 *  chord, then the arrow, and never the words. An unbound `scroll:bottom` contributes no chord at all rather
 *  than an empty parenthesis — the same three-state honesty `hints.ts` applies to every derived chord, and it
 *  is canon's own `else` arm, which keeps the arrow.
 *
 *  FSW T14, AMENDMENT 2 ADDS A FOURTH RUNG ON TOP, and the ladder is what makes it affordable: `v to open in
 *  <editor>` is canon's own phrase for this escape (bundle L547303, the hint row of canon's transcript screen —
 *  `↑↓ scroll · v to open in <editor> · ? for shortcuts`, with the editor name resolved by `Zcn()`), and on a
 *  pane too narrow for it the rule drops it before it drops the words.
 *    THE PILL IS WHERE `v` IS HONEST, which is why the announcement landed here rather than on the footer row
 *  or in the `?` grid (the amendment named both). `scroll:dumpTranscript` is registered by the viewport for
 *  exactly as long as this pill is up — T12's own gate, "while the pill is up, `v` does not type" — so a
 *  permanent row anywhere else would advertise a key that, most of the time, is a printable letter.
 *
 *  `dumpChord` IS THE KEY THAT REALLY FIRES IT, not the letter canon happens to ship: the rung printed a
 *  literal `v` until FSW backlog 2, and `scroll:dumpTranscript` is rebindable, so the pill could name a key
 *  that types instead of dumping. Empty (the action is unbound) drops the rung the same way an unbound
 *  `scroll:bottom` drops the parenthesis above — no chord reaches the handler, so there is nothing to offer. */
export function jumpPillText(newRows: number, chord: string, columns: number, dumpEditor?: string, dumpChord = ""): string {
  const base = newRows > 0 ? `${newRows} new message${newRows === 1 ? "" : "s"}` : "Jump to bottom";
  const room = Math.max(1, columns - 2), shortest = ` ${base} `;
  const jump = `${base}${chord === "" ? "" : ` (${chord})`} ↓`;
  const dump = dumpEditor === undefined || dumpChord === "" ? "" : ` ${jump} · ${dumpChord} to open in ${dumpEditor} `;
  for (const variant of [dump, chord === "" ? "" : ` ${base} (${chord}) ↓ `, ` ${base} ↓ `, shortest])
    if (variant !== "" && variant.length <= room) return variant;
  return shortest;
}

export interface JumpPillProps {
  /** Rows that arrived below the window since stickiness was lost. Zero prints the destination instead. */
  newRows: number;
  /** The region's width — the fit rule's input. */
  columns: number;
  /** The editor `v` would hand the terminal to — `editorDisplayName()`, or canon's bare `"editor"` when none is
   *  configured. Present exactly when the viewport has registered the dump (T12's gate); absent everywhere the
   *  key is not ours, so the pill never names it. */
  dumpEditor?: string;
}

export function JumpPill({ newRows, columns, dumpEditor }: JumpPillProps): React.ReactElement {
  // Derived from the LIVE table, so a user who rebinds either action sees their own key here — and from the
  // ACTIVE scopes only (`{ live: true }`), which is the honesty this pill can actually keep. The unrestricted
  // lookup walks the active contexts FIRST and then every other one, so an action a user layer moved into some
  // context the pill's keyboard never reaches (the ctrl+O pager's, say) still resolved: a chord printed on a
  // surface where dispatch — Scroll, pushed by the viewport, then Chat and Global — can never deliver it
  // (FSW BACKLOG FIX F2). The live set IS the right set here precisely because the pill renders inside the
  // scope it is talking about. Empty drops the rung, the same three-state honesty as an unbind.
  const lookup = useBindingLookup();
  const chord = formatBindingLower(preferredKey(lookup(JUMP_PILL_ACTION, { live: true })));
  const dumpChord = formatBindingLower(preferredKey(lookup(DUMP_PILL_ACTION, { live: true })));
  // F10 T-HOVER: the band swap `Line.tsx` used to run for every transcript row, re-homed here — canon's
  // transcript hover never touches a background at all (`Line.tsx`'s header); the swap canon DOES have is
  // chrome's (`Psc`/`O6w`), and this pill is ccx's `O6w`. ONE RECORDED DELTA: canon's `O6w` puts the
  // handlers on the BADGE box, so only the badge's own cells are the target there; ccx's pill has no
  // `HitRow` of its own (the viewport removes the pill's row from the window by construction, `body =
  // height - 1`), so the whole pill ROW is the target instead — deliberate, and strictly a superset.
  const hovered = useContext(HoverContext);
  const bg = resolveThemeColor(hovered ? themeTokens().userMessageBackgroundHover : themeTokens().userMessageBackground);
  return (
    <Box justifyContent="center" flexShrink={0}>
      {/* `truncate-end` is canon's own prop (456186) and load-bearing here rather than cosmetic: the shortest
          variant is returned even when it does not fit, and an Ink `Text` that wrapped it instead of clipping
          would make the pill two rows and eat a transcript row the viewport already paid for. */}
      <Text wrap="truncate-end" backgroundColor={bg}>{jumpPillText(newRows, chord, columns, dumpEditor, dumpChord)}</Text>
    </Box>
  );
}
