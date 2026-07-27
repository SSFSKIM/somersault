// tui/src/Transcript.tsx — append-only scrollback (Static) + a live region for the in-flight turn.
import React from "react";
import { Box, Text, Static } from "ink";
import type { RenderLine } from "./render.js";

const Line = ({ l }: { l: RenderLine }) => (
  <Text>
    {l.gutter ? <Text color={l.gutter.color} dimColor={l.gutter.dim}>{l.gutter.text}</Text> : null}
    {l.segments
      ? l.segments.map((s, i) => <Text key={i} color={s.color} dimColor={s.dim} bold={s.bold} italic={s.italic}>{s.text}</Text>)
      : <Text color={l.color} dimColor={l.dim} bold={l.bold} italic={l.italic}>{l.text || " "}</Text>}
  </Text>
);

export function Transcript({ lines, streaming }: { lines: RenderLine[]; streaming: RenderLine[] }) {
  return (
    <Box flexDirection="column">
      <Static items={lines}>{(l, i) => <Line key={i} l={l} />}</Static>
      {streaming.map((l, i) => <Line key={`s${i}`} l={l} />)}
    </Box>
  );
}
