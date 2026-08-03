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

export function ChatStatusBar({ model, mode, busy, ctxPct, thinkLevel, bgCount, usageWarn, composerOwnsKeys }: { model?: string; mode: string; busy: boolean; ctxPct?: number; thinkLevel?: string; bgCount?: number; usageWarn?: string; composerOwnsKeys?: boolean }) {
  // F2 task 10 — upstream's own mode-chip parenthetical (`(shift+tab to cycle)`), derived from the LIVE table
  // rather than typed here, so a rebinding moves it. TWO gates decide whether it renders at all, and the
  // lookup is not either of them — it only supplies the KEY STRING:
  //  * MODE. Upstream prints the parenthetical only for a NON-DEFAULT mode (rung ten of the footer's
  //    one-winner ladder — research `04-chrome.md` §1.2 #10 and §1.3), so a fresh default session carries
  //    none. We print it unconditionally before this fix, which is a divergence, not a bonus.
  //  * OWNERSHIP. `chat:cycleMode` belongs to the composer's Chat context, and this bar renders under every
  //    dialog and overlay too — F0's rule that a status hint is honest only relative to its focused owner.
  //    The signal is a PROP, deliberately: it was `{ live: true }` on the lookup, which reads the scope
  //    registry during render, and a scope's deregistration is a Set.delete inside a passive cleanup that
  //    repaints nothing — so the hint survived every dialog that unmounted the composer and only ever
  //    cleared when something unrelated forced a re-render (t10 review, Important). ChatApp derives the same
  //    ownership from STATE while it renders, and state is what repaints.
  const cycleKey = formatBindings(useBindingLookup()("chat:cycleMode"));
  const showCycle = composerOwnsKeys === true && mode !== "default" && cycleKey !== UNBOUND;
  return (
    <Box>
      {model ? <Text>model <Text color={role("suggestion")}>{model}</Text>{"  "}</Text> : null}
      <Text>mode </Text><Text color={modeColor(mode)}>{mode}</Text>
      {showCycle ? <Text dimColor>{` (${cycleKey} to cycle)`}</Text> : null}
      {thinkLevel ? <Text>{"  "}think <Text color={role("autoAccept")}>{thinkLevel}</Text></Text> : null}
      {ctxPct != null ? <Text>{"  ctx "}<Text color={ctxColor(ctxPct)}>{ctxPct}%</Text>{ctxPct >= 80 ? <Text color={role("error")}> ⚠ auto-compact soon</Text> : null}</Text> : null}
      {usageWarn ? <Text color={role("error")}>{"  " + usageWarn}</Text> : null}
      <Text>{busy ? "  ⟳ streaming" : ""}</Text>
      <Text>{bgCount ? `  ⚙ ${bgCount} bg` : ""}</Text>
    </Box>
  );
}
