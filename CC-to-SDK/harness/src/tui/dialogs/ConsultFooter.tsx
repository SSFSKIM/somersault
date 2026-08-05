// tui/dialogs/ConsultFooter.tsx — the consult dialogs' footer row, transcribed from 2.1.220's L505286:
// a dim `·`-joined hint list. The amend hint is `aZf` (L505186): it renders ONLY while the focused row is
// a feedback row that is not ALREADY in input mode — once you are typing, the hint that told you how to
// start typing is noise. The explain hint's action flips explain/hide (L505286). FetchPermission
// deliberately has no footer: upstream builds it on a bare `jr` with no feedbackConfig, so there is
// nothing to advertise and the `(esc)` lives in its No-row label instead.
import React from "react";
import { Box, Text } from "ink";

export function ConsultFooter({ inputMode = false, explain }: { inputMode?: boolean; explain?: "explain" | "hide" }) {
  const hints = ["esc cancel", ...(inputMode ? [] : ["tab amend"]), ...(explain ? [`ctrl+e ${explain}`] : [])];
  return <Box marginTop={1}><Text dimColor>{hints.join(" · ")}</Text></Box>;
}
