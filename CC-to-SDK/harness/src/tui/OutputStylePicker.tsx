// tui/src/OutputStylePicker.tsx — the "Output style" Config row's sub-picker (Wave 3 task 5), also reusable
// standalone by a future /output-style redirect (Task 6 — see OUTPUT_STYLE_REDIRECT below). Four HARDCODED
// built-ins (Global Constraints line 33 — probe 76 confirmed these are the same four the live engine offers
// via applyFlagSettings({outputStyle})). This is a DIFFERENT mechanism from config/outputStyle.ts's
// BUILTIN_OUTPUT_STYLES: that one injects a system-prompt persona at harness-config time (launch-only, 3
// entries); this one is the live per-turn engine style switch SettingsOps.setOutputStyle drives (4 entries
// — includes "proactive", which config/outputStyle.ts has no equivalent for). Simple confirm/cancel
// list, no live preview: unlike /theme there is nothing local to render a preview of.
// F2 Task 8: no `useInput` — the `Select` context, exactly like its sibling pickers, so its hand-rolled j/k
// and ctrl+n/ctrl+p become the table's and the KB15 page keys come along.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useSelectKeys } from "./keys/selectKeys.js";
import { ACCENT } from "./theme.js";

export interface OutputStyleOption { id: string; label: string; description: string }

// Row LABELS are our own choice (Title Case, matching THEME_LABELS' convention) — only the DESCRIPTIONS and
// the picker chrome (title/subtitle/footer) are pinned verbatim by the plan; upstream doesn't give exact
// row label text for this picker the way it does for /theme's 5 rows.
export const OUTPUT_STYLES: OutputStyleOption[] = [
  { id: "default", label: "Default", description: "Claude completes coding tasks efficiently and provides concise responses" },
  { id: "proactive", label: "Proactive", description: "Claude executes immediately, minimizes interruptions, and prefers action over planning" },
  { id: "explanatory", label: "Explanatory", description: "Claude explains its implementation choices and codebase patterns" },
  { id: "learning", label: "Learning", description: "Claude pauses and asks you to write small pieces of code for hands-on practice" },
];
const TITLE = "Preferred output style";
const SUBTITLE = "This changes how Claude Code communicates with you";
const FOOTER = "Enter to confirm · Esc to cancel";
/** Task 6's standalone `/output-style` redirect line (verbatim, Global Constraints line 33) — exported here
 *  so the future command formatter and this component can't drift on the exact copy. Unused by this task. */
export const OUTPUT_STYLE_REDIRECT = "/output-style moved → Output style in /config";

export function OutputStylePicker({ current, onPick, onCancel }: { current?: string; onPick: (id: string) => void; onCancel: () => void }) {
  const [idx, setIdx] = useState(() => Math.max(0, OUTPUT_STYLES.findIndex((o) => o.id === current)));
  useSelectKeys({
    count: OUTPUT_STYLES.length, index: idx, onMove: setIdx, onCancel,
    onAccept: () => onPick(OUTPUT_STYLES[idx].id),
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>{TITLE}</Text>
      <Text dimColor>{SUBTITLE}</Text>
      <Text> </Text>
      {OUTPUT_STYLES.map((o, i) => (
        <Text key={o.id} color={i === idx ? ACCENT : undefined}>{i === idx ? "❯ " : "  "}{o.label}  <Text dimColor>{o.description}</Text></Text>
      ))}
      <Text> </Text>
      <Text dimColor>{FOOTER}</Text>
    </Box>
  );
}
