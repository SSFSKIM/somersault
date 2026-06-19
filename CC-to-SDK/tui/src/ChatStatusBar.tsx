// tui/src/ChatStatusBar.tsx — bottom bar: model · permission mode (color-coded) · ctx% · live streaming · hints.
import React from "react";
import { Box, Text } from "ink";

export function ChatStatusBar({ model, mode, busy, ctxPct, hasPending }: { model?: string; mode: string; busy: boolean; ctxPct?: number; hasPending: boolean }) {
  return (
    <Box>
      {model ? <Text>model <Text color="cyan">{model}</Text>{"  "}</Text> : null}
      <Text>mode </Text><Text color={mode === "bypassPermissions" ? "red" : "green"}>{mode}</Text>
      <Text>{ctxPct != null ? `  ctx ${ctxPct}%` : ""}</Text>
      <Text>{busy ? "  ⟳ streaming" : ""}</Text>
      <Text dimColor>{hasPending ? "   [a/A/d]" : "   Tab mode · Esc interrupt"}</Text>
    </Box>
  );
}
