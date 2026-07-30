// tui/src/BgTasksPanel.tsx — background work (shells, subagents, workflow tasks — ONE stream, spec Goal
// B). Named against the one-letter trap: TaskPanel.tsx is the model's todo checklist, a different thing.
// Wave 2 (U2): rows are harvest-enriched BgTaskRow (command · status · output file); Enter tails the
// output file in-panel — the probe-74 mechanism ("use Read on that file path"). A local_agent's .output
// is a symlink to the full subagent transcript JSONL (bundle warning), so it is deliberately not tailed.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { readFileSync } from "node:fs";
import type { BgTaskRow } from "./bgTaskMeta.js";
import { ACCENT } from "./theme.js";

const TAIL_LINES = 12;
const realReadTail = (path: string): string[] => {
  const lines = readFileSync(path, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-TAIL_LINES);
};
const glyph = (s: string) => (s === "running" ? "⟳" : s === "failed" ? "✗" : s === "stopped" ? "◼" : "✓");

export function BgTasksPanel({ tasks, onStop, onClose, readTail }: { tasks: BgTaskRow[]; onStop: (taskId: string) => void; onClose: () => void; readTail?: (path: string) => string[] }) {
  const [idx, setIdx] = useState(0);
  const [tail, setTail] = useState<{ id: string; lines: string[] } | null>(null);
  const sel = Math.min(idx, Math.max(0, tasks.length - 1));
  const read = readTail ?? realReadTail;
  useInput((input, key) => {
    if (key.escape) { if (tail) { setTail(null); return; } onClose(); return; }
    if (key.upArrow) { setIdx((i) => Math.max(0, i - 1)); setTail(null); return; }
    if (key.downArrow) { setIdx((i) => Math.min(Math.max(0, tasks.length - 1), i + 1)); setTail(null); return; }
    if (key.return && tasks[sel]) {
      const t = tasks[sel];
      if (t.task_type === "local_agent") { setTail({ id: t.task_id, lines: ["(agent task — its .output is the subagent transcript JSONL, not tailed here)"] }); return; }
      if (!t.outputFile) { setTail({ id: t.task_id, lines: ["(no output file reported for this task)"] }); return; }
      try { setTail({ id: t.task_id, lines: read(t.outputFile) }); }               // Enter again re-reads (refresh)
      catch (e) { setTail({ id: t.task_id, lines: [`✗ ${(e as Error).message}`] }); }
      return;
    }
    if ((input === "k" || input === "x") && tasks[sel]?.status === "running") onStop(tasks[sel].task_id);
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Background tasks</Text>
      {tasks.length === 0 ? <Text dimColor>none running</Text> : tasks.map((t, i) => (
        <Box key={t.task_id} flexDirection="column">
          <Text color={i === sel ? ACCENT : undefined} dimColor={t.status !== "running" && i !== sel}>
            {i === sel ? "❯ " : "  "}{glyph(t.status)} {t.task_id.slice(0, 8)} · {t.task_type} · {t.command ?? t.description}
          </Text>
          {i === sel && tail?.id === t.task_id ? tail.lines.map((l, j) => <Text key={j} dimColor>{"    │ "}{l || " "}</Text>) : null}
        </Box>
      ))}
      <Text dimColor>↑↓ · ⏎ output · k/x stop · esc close</Text>
    </Box>
  );
}
