// tui/src/TaskPanel.tsx — the pinned task checklist (☐ pending / ▶ in_progress / ☑ completed). Hidden when empty.
import React from "react";
import { Box, Text } from "ink";
import type { TaskItem, TaskStatus } from "./taskList.js";

const GLYPH: Record<TaskStatus, string> = { pending: "☐", in_progress: "▶", completed: "☑" };

export function TaskPanel({ tasks }: { tasks: TaskItem[] }) {
  if (!tasks.length) return null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Tasks</Text>
      {tasks.map((t) => <Text key={t.id}>{GLYPH[t.status]} {t.subject}</Text>)}
    </Box>
  );
}
