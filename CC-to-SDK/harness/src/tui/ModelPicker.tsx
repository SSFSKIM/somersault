// tui/src/ModelPicker.tsx — the /model modal: a selectable list of available models (↑/↓ · Enter · Esc).
// Mirrors SessionPicker.tsx — including F2 task 8: no `useInput`, the shared `Select` context instead, which
// is where its navigation (now j/k, ctrl+n/ctrl+p and the KB15 page/first/last keys too) and its overlay
// gating both come from.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useSelectKeys } from "./keys/selectKeys.js";

export interface ModelInfo { value: string; displayName?: string; description?: string }

export function ModelPicker({ models, onPick, onCancel }: { models: ModelInfo[]; onPick: (m: ModelInfo) => void; onCancel: () => void }) {
  const [idx, setIdx] = useState(0);
  useSelectKeys({
    count: models.length, index: idx, onMove: setIdx, onCancel,
    onAccept: () => { if (models[idx]) onPick(models[idx]); },
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
