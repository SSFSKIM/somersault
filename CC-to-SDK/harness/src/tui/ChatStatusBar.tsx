// tui/src/ChatStatusBar.tsx — bottom bar: model · permission mode (color-coded) · ctx% · live streaming.
// Editor keyboard affordances live in ChatComposer so their popup/draft state is synchronous by construction.
// Every color here is a §2.2 semantic token resolved for Ink at render time (F1 Task 2 role map), read
// per call so a mid-session /theme change repaints the bar on the very next frame.
import React from "react";
import { Box, Text } from "ink";
import { useBindingLookup } from "./keys/KeymapProvider.js";
import { formatBindings, UNBOUND } from "./keys/hints.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

/** Permission-mode → token: default is the safe `success`, acceptEdits `warning`, the auto classifier
 *  `permission`, bypass `error`. */
export function modeColor(mode: string): string { return role(mode === "bypassPermissions" ? "error" : mode === "auto" ? "permission" : mode === "acceptEdits" ? "warning" : "success"); }
/** Context-usage token: unstyled under half, `warning` past half, `error` once compaction is near (CC's threshold feel). */
export function ctxColor(pct: number): string | undefined { return pct >= 80 ? role("error") : pct >= 50 ? role("warning") : undefined; }

export function ChatStatusBar({ model, mode, busy, ctxPct, thinkLevel, bgCount, usageWarn }: { model?: string; mode: string; busy: boolean; ctxPct?: number; thinkLevel?: string; bgCount?: number; usageWarn?: string }) {
  // F2 task 10 — upstream's own mode-chip parenthetical (`(shift+tab to cycle)`), derived from the LIVE table
  // rather than typed here, so a rebinding moves it. `{ live: true }` is the load-bearing part: `chat:cycleMode`
  // belongs to the composer's Chat context, and this bar renders under every dialog and overlay too. Asking only
  // the LIVE scopes means the hint appears exactly when the key would actually work — F0's rule that a status
  // hint is honest only relative to its focused owner, expressed through the table instead of a flag.
  const cycleKey = formatBindings(useBindingLookup()("chat:cycleMode", { live: true }));
  return (
    <Box>
      {model ? <Text>model <Text color={role("suggestion")}>{model}</Text>{"  "}</Text> : null}
      <Text>mode </Text><Text color={modeColor(mode)}>{mode}</Text>
      {cycleKey === UNBOUND ? null : <Text dimColor>{` (${cycleKey} to cycle)`}</Text>}
      {thinkLevel ? <Text>{"  "}think <Text color={role("autoAccept")}>{thinkLevel}</Text></Text> : null}
      {ctxPct != null ? <Text>{"  ctx "}<Text color={ctxColor(ctxPct)}>{ctxPct}%</Text>{ctxPct >= 80 ? <Text color={role("error")}> ⚠ auto-compact soon</Text> : null}</Text> : null}
      {usageWarn ? <Text color={role("error")}>{"  " + usageWarn}</Text> : null}
      <Text>{busy ? "  ⟳ streaming" : ""}</Text>
      <Text>{bgCount ? `  ⚙ ${bgCount} bg` : ""}</Text>
    </Box>
  );
}
