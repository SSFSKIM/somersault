// tui/src/ThemeDialog.tsx — the `/theme` picker (Wave 3 task 4): 5 rows from THEME_LABELS with a LIVE
// preview. Navigating a row calls setTheme() SYNCHRONOUSLY, before the setIdx that triggers the re-render
// — theme.ts's current/ACCENT are plain module state, not React state, so a setTheme() fired from a
// useEffect (which runs AFTER commit) would color this render one keypress late. Calling it inline in the
// same handler that also moves the selection means themeTokens() read during THIS render already reflects
// the just-selected row, with no lag and no extra render pass. The demo.js panel is the same four lines
// real Claude Code shows, colored by the previewed theme's diffAdded/diffRemoved — matching render.ts's own
// diff coloring so the preview and the transcript never disagree. Esc reverts to the theme that was live
// when the dialog opened (captured once in a ref — navigation never touches it); Enter keeps whatever's
// currently applied (already the highlighted row, via the same live-preview path) and persists it through
// the injected `savePrefs` (defaults to the real ~/.claude/ccx/prefs.json writer — a test supplies its own
// so it never touches that real file, mirroring AddDirDialog's settingsFileDeps seam). Callback-only, no
// session access — this is a pure client feature, same convention as every other dialog in this package.
// `hideEsc` (Wave 3 task 5): the /config Settings dialog embeds this component directly for its Theme row
// (Global Constraints line 34) — Esc/Enter keep doing exactly what they already do (revert-and-return /
// persist-and-return), this only suppresses the standalone footer's "Esc to cancel" hint, which would be
// redundant/confusing nested inside Settings' own chrome. Nothing else about the standalone /theme path
// changes — the prop defaults to false there.
// F2 Task 8: the picker stopped calling `useInput` and pushes the `Select` context instead. Its hand-rolled
// j/k and ctrl+n/ctrl+p are the table's now (same keys, one definition), and pageup/pagedown/home/end join
// them for free. When Settings EMBEDS this component, both scopes are live and `Select` sits innermost, so
// every navigation key resolves here — Settings' own `space` finds this component's `select:accept` and
// therefore confirms the theme, matching the "Enter/Space to change" footer the user is looking at.
import React, { useRef, useState } from "react";
import { Box, Text } from "ink";
import { useSelectKeys } from "./keys/selectKeys.js";
import { THEME_LABELS, currentTheme, resolveThemeColor, themeTokens, setTheme } from "./theme.js";
import { savePrefs as realSavePrefs } from "./prefs.js";

const PROMPT = "Choose the text style that looks best with your terminal";
const FOOTER = "Enter to select · Esc to cancel";
// Verbatim 2.1.220 demo.js diff (plan Global Constraints line 32) — the leading char IS the diff marker
// (" " context / "-" removed / "+" added), so it must stay part of the literal text, not just styling.
const DEMO_LINES = [" function greet() {", '-  console.log("Hello, World!");', '+  console.log("Hello, Claude!");', " }"];

export function ThemeDialog({ onDone, savePrefs = realSavePrefs, hideEsc = false }: {
  onDone: (line: string) => void;
  savePrefs?: typeof realSavePrefs;
  hideEsc?: boolean;
}) {
  const original = useRef(currentTheme());
  const [idx, setIdx] = useState(() => THEME_LABELS.findIndex(([id]) => id === original.current));

  function moveTo(next: number) {
    const clamped = Math.max(0, Math.min(THEME_LABELS.length - 1, next));
    if (clamped === idx) return;
    setTheme(THEME_LABELS[clamped][0]);   // live preview, synchronous — see the module comment above
    setIdx(clamped);
  }
  useSelectKeys({
    count: THEME_LABELS.length, index: idx, onMove: moveTo,
    onAccept: () => { const id = THEME_LABELS[idx][0]; savePrefs({ theme: id }); onDone(`Theme set to ${id}`); },
    onCancel: () => { setTheme(original.current); onDone("Theme picker dismissed"); },
  });

  const tokens = themeTokens();
  const accent = resolveThemeColor(tokens.claude), added = resolveThemeColor(tokens.diffAdded), removed = resolveThemeColor(tokens.diffRemoved);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={accent}>
      <Text bold>{PROMPT}</Text>
      {THEME_LABELS.map(([id, label], i) => (
        <Text key={id} color={i === idx ? accent : undefined}>{i === idx ? "❯ " : "  "}{label}</Text>
      ))}
      <Text> </Text>
      <Text bold>demo.js</Text>
      {DEMO_LINES.map((line, i) => (
        <Text key={i} color={line[0] === "-" ? removed : line[0] === "+" ? added : undefined}>{line}</Text>
      ))}
      {hideEsc ? null : <Text dimColor>{FOOTER}</Text>}
    </Box>
  );
}
