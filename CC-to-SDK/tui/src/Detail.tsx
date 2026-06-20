import React from "react";
import { Box, Text } from "ink";
import type { SessionRow } from "cc-harness";
import { streamLines } from "./format.js";

function agehms(createdAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return `${h}h${m % 60}m`;
}

export function Detail({ row, stream, now = Date.now }: { row?: SessionRow; stream: unknown[]; now?: () => number }) {
  const lines = streamLines(stream);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
      {row ? <Text bold>{row.id} · {row.status} · {row.model ?? "-"}</Text> : <Text dimColor>no session selected</Text>}
      {row ? <Text dimColor>mode {row.permissionMode ?? "default"} · ctx {row.ctxPercent != null ? `${row.ctxPercent}%` : "-"} · {row.tokens != null ? `${row.tokens} tok` : "- tok"} · age {agehms(row.createdAt, now())} · {row.proactive ?? "idle"}</Text> : null}
      {lines.length === 0
        ? <Text dimColor>(no output yet)</Text>
        : lines.slice(-200).map((l, i) => <Text key={i}>{l}</Text>)}
    </Box>
  );
}
