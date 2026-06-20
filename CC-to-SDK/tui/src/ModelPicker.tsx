// tui/src/ModelPicker.tsx — the /model modal: a selectable list of available models (↑/↓ · Enter · Esc).
// Mirrors SessionPicker.tsx. Fed by the live session.capabilities().models.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface ModelInfo { value: string; displayName?: string; description?: string }

export function ModelPicker({ models, onPick, onCancel }: { models: ModelInfo[]; onPick: (m: ModelInfo) => void; onCancel: () => void }) {
  const [idx, setIdx] = useState(0);
  useInput((_input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(models.length - 1, i + 1));
    else if (key.return && models[idx]) onPick(models[idx]);
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>switch model  (↑/↓ · Enter · Esc)</Text>
      {models.length === 0
        ? <Text dimColor>no models</Text>
        : models.map((m, i) => <Text key={m.value} inverse={i === idx}>{`${m.displayName ?? m.value}${m.description ? "  — " + m.description : ""}`}</Text>)}
    </Box>
  );
}
