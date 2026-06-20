// tui/src/Transcript.tsx — append-only scrollback (Static) + a live region for the in-flight turn.
import React from "react";
import { Box, Text, Static } from "ink";
import type { RenderLine } from "./render.js";

const Line = ({ l }: { l: RenderLine }) => <Text color={l.color} dimColor={l.dim} bold={l.bold} italic={l.italic}>{l.text || " "}</Text>;

export function Transcript({ lines, streaming }: { lines: RenderLine[]; streaming: RenderLine[] }) {
  return (
    <Box flexDirection="column">
      <Static items={lines}>{(l, i) => <Line key={i} l={l} />}</Static>
      {streaming.map((l, i) => <Line key={`s${i}`} l={l} />)}
    </Box>
  );
}
