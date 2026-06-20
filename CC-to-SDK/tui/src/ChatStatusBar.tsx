// tui/src/ChatStatusBar.tsx — bottom bar: model · permission mode (color-coded) · ctx% · live streaming · hints.
import React from "react";
import { Box, Text } from "ink";

/** Permission-mode → color: default safe (green), acceptEdits (yellow), auto classifier (cyan), bypass (red). */
export function modeColor(mode: string): string { return mode === "bypassPermissions" ? "red" : mode === "auto" ? "cyan" : mode === "acceptEdits" ? "yellow" : "green"; }

export function ChatStatusBar({ model, mode, busy, ctxPct, hasPending, subagentActive, thinkLevel }: { model?: string; mode: string; busy: boolean; ctxPct?: number; hasPending: boolean; subagentActive?: boolean; thinkLevel?: string }) {
  return (
    <Box>
      {model ? <Text>model <Text color="cyan">{model}</Text>{"  "}</Text> : null}
      <Text>mode </Text><Text color={modeColor(mode)}>{mode}</Text>
      {thinkLevel ? <Text>{"  "}think <Text color="magenta">{thinkLevel}</Text></Text> : null}
      <Text>{ctxPct != null ? `  ctx ${ctxPct}%` : ""}</Text>
      <Text>{busy ? "  ⟳ streaming" : ""}</Text>
      <Text>{subagentActive ? "  ⚙ subagent running" : ""}</Text>
      <Text dimColor>{hasPending ? "   [a/A/d]" : "   Tab mode · Esc interrupt"}</Text>
    </Box>
  );
}
