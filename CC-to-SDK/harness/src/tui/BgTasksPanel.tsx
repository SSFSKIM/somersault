// tui/src/BgTasksPanel.tsx — background work (shells, subagents, workflow tasks — ONE stream, spec Goal
// B). Named against the one-letter trap: TaskPanel.tsx is the model's todo checklist, a different thing.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { BackgroundTaskInfo } from "../session/session.js";
import { ACCENT } from "./theme.js";

export function BgTasksPanel({ tasks, onStop, onClose }: { tasks: BackgroundTaskInfo[]; onStop: (taskId: string) => void; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const sel = Math.min(idx, Math.max(0, tasks.length - 1));
  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIdx((i) => Math.min(tasks.length - 1, i + 1)); return; }
    if ((input === "k" || input === "x") && tasks[sel]) onStop(tasks[sel].task_id);
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Background tasks</Text>
      {tasks.length === 0 ? <Text dimColor>none running</Text> : tasks.map((t, i) => (
        <Text key={t.task_id} color={i === sel ? ACCENT : undefined}>{i === sel ? "❯ " : "  "}{t.task_id.slice(0, 8)} · {t.task_type} · {t.description}</Text>
      ))}
      <Text dimColor>↑↓ · k/x stop · esc close</Text>
    </Box>
  );
}
