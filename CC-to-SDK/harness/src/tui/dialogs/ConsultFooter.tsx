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
import React from "react";
import { Box, Text } from "ink";

export function ConsultFooter({ amendable = false, inputMode = false, explain }: { amendable?: boolean; inputMode?: boolean; explain?: "explain" | "hide" }) {
  const hints = ["esc cancel", ...(amendable && !inputMode ? ["tab amend"] : []), ...(explain ? [`ctrl+e ${explain}`] : [])];
  return <Box marginTop={1}><Text dimColor>{hints.join(" · ")}</Text></Box>;
}
