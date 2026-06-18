import React from "react";
import { Box, Text } from "ink";
import type { SessionRow } from "cc-harness";
import { streamLines } from "./format.js";

export function Detail({ row, stream }: { row?: SessionRow; stream: unknown[] }) {
  const lines = streamLines(stream);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
      {row ? <Text bold>{row.id} · {row.status} · {row.model ?? "-"}</Text> : <Text dimColor>no session selected</Text>}
      {lines.length === 0
        ? <Text dimColor>(no output yet)</Text>
        : lines.slice(-200).map((l, i) => <Text key={i}>{l}</Text>)}
    </Box>
  );
}
