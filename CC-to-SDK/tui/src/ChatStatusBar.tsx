// tui/src/ChatStatusBar.tsx — bottom bar: permission mode (color-coded), ctx%, busy, context-sensitive hints.
import React from "react";
import { Box, Text } from "ink";

export function ChatStatusBar({ mode, busy, ctxPct, hasPending }: { mode: string; busy: boolean; ctxPct?: number; hasPending: boolean }) {
  return (
    <Box>
      <Text>mode </Text><Text color={mode === "bypassPermissions" ? "red" : "green"}>{mode}</Text>
      <Text>{ctxPct != null ? `  ctx ${ctxPct}%` : ""}</Text>
      <Text>{busy ? "  …working" : ""}</Text>
      <Text dimColor>{hasPending ? "   [a/A/d]" : "   Tab mode · Esc interrupt"}</Text>
    </Box>
  );
}
