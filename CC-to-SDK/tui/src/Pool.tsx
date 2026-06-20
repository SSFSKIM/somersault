import React from "react";
import { Box, Text } from "ink";
import type { SessionRow } from "cc-harness";

const GLYPH: Record<string, string> = { idle: "·", busy: "▶", errored: "✗", restarting: "↻" };
const PROACTIVE_GLYPH: Record<string, string> = { running: "▶", paused: "⏸" };

export function Pool({ rows, selectedIndex }: { rows: SessionRow[]; selectedIndex: number }) {
  return (
    <Box flexDirection="column" width={38} borderStyle="round" paddingX={1}>
      <Text bold>Sessions ({rows.length})</Text>
      {rows.length === 0
        ? <Text dimColor>no live sessions</Text>
        : rows.map((r, i) => (
          <Text key={r.id} inverse={i === selectedIndex}>
            {(GLYPH[r.status] ?? "?")} {r.id.slice(0, 10)} {r.model ?? "-"} {r.ctxPercent != null ? `${r.ctxPercent}%` : "--"}{r.proactive && PROACTIVE_GLYPH[r.proactive] ? ` ${PROACTIVE_GLYPH[r.proactive]}` : ""}
          </Text>
        ))}
    </Box>
  );
}
