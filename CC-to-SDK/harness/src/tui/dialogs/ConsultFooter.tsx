// tui/dialogs/ConsultFooter.tsx — the consult dialogs' footer row, transcribed from 2.1.220's L505286:
// a dim `·`-joined hint list. The amend hint is `aZf` (L505186): it renders ONLY while the focused row is
// a feedback row that is not ALREADY in input mode — once you are typing, the hint that told you how to
// start typing is noise. The explain hint's action flips explain/hide (L505286). FetchPermission
// deliberately has no footer: upstream builds it on a bare `jr` with no feedbackConfig, so there is
// nothing to advertise and the `(esc)` lives in its No-row label instead.
//
// EXTERNAL REVIEW FIX. `aZf`'s condition has TWO halves — "the focused row is a feedback row" AND "it is not
// already in input mode" — and this footer only ever read the second, so `tab amend` was advertised on every
// pick-one row including the ones that ignore Tab. Concretely: every body's `onInputModeToggle` acts on the
// `no` row alone (the SDK's allow arm carries no message field, T3), so the initially-focused Yes row and
// every "don't ask again" row silently drop the key the footer just promised. `amendable` is the missing
// half, supplied by the body from its own focus — the same false-affordance principle that retired the
// WebFetch No-row copy this wave (W-T22): do not advertise a channel that cannot deliver.
//
// WAVE 2 t2 (s2qa3-10). Two additions, both ccx's own and both for the same reason: this harness declined
// upstream's `allowEmptySubmitToCancel` on the feedback rows, so ccx has an input-mode state upstream never
// reaches with an unanswered Enter, and it owes the human an account of it. `enter send` replaces the amend
// hint the moment the row becomes the field — the key whose meaning just changed is the one worth naming —
// and `nudge` is the reactive half, raised by the body when an empty Enter did nothing. It sits ABOVE the
// hint row and undimmed: the footer is chrome the eye learns to skip, and this is an answer to a keystroke.
import React from "react";
import { Box, Text } from "ink";
import { resolveThemeColor, themeTokens } from "../theme.js";

/** What an empty Enter earns instead of a decision. Names BOTH ways out, because the complaint behind
 *  s2qa3-10 was not "the wrong thing happened" but "I could not tell what would". */
export const EMPTY_SUBMIT_NUDGE = "type a message, or esc to cancel";

export function ConsultFooter({ amendable = false, inputMode = false, explain, nudge = false }: { amendable?: boolean; inputMode?: boolean; explain?: "explain" | "hide"; nudge?: boolean }) {
  const hints = [...(inputMode ? ["enter send"] : []), "esc cancel", ...(amendable && !inputMode ? ["tab amend"] : []), ...(explain ? [`ctrl+e ${explain}`] : [])];
  return (
    <Box marginTop={1} flexDirection="column">
      {nudge ? <Text color={resolveThemeColor(themeTokens().warning)}>{EMPTY_SUBMIT_NUDGE}</Text> : null}
      <Text dimColor>{hints.join(" · ")}</Text>
    </Box>
  );
}
