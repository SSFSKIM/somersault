// tui/src/ChatStatusBar.tsx — bottom bar: model · permission mode (color-coded) · ctx% · live streaming · hints.
import React from "react";
import { Box, Text } from "ink";

/** Permission-mode → color: default safe (green), acceptEdits (yellow), auto classifier (cyan), bypass (red). */
export function modeColor(mode: string): string { return mode === "bypassPermissions" ? "red" : mode === "auto" ? "cyan" : mode === "acceptEdits" ? "yellow" : "green"; }
/** Context-usage color: green under half, yellow past half, red once compaction is near (CC's threshold feel). */
export function ctxColor(pct: number): string | undefined { return pct >= 80 ? "red" : pct >= 50 ? "yellow" : undefined; }

export function ChatStatusBar({ model, mode, busy, ctxPct, hasPending, subagentActive, thinkLevel }: { model?: string; mode: string; busy: boolean; ctxPct?: number; hasPending: boolean; subagentActive?: boolean; thinkLevel?: string }) {
  return (
    <Box>
      {model ? <Text>model <Text color="cyan">{model}</Text>{"  "}</Text> : null}
      <Text>mode </Text><Text color={modeColor(mode)}>{mode}</Text>
      {thinkLevel ? <Text>{"  "}think <Text color="magenta">{thinkLevel}</Text></Text> : null}
      {ctxPct != null ? <Text>{"  ctx "}<Text color={ctxColor(ctxPct)}>{ctxPct}%</Text>{ctxPct >= 80 ? <Text color="red"> ⚠ auto-compact soon</Text> : null}</Text> : null}
      <Text>{busy ? "  ⟳ streaming" : ""}</Text>
      <Text>{subagentActive ? "  ⚙ subagent running" : ""}</Text>
      <Text dimColor>{hasPending ? "   [↑↓·1/2/3·esc]" : "   Tab mode · Esc interrupt · ? help"}</Text>
    </Box>
  );
}
