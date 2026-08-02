// tui/src/Transcript.tsx — append-only scrollback (Static) + a live region for the in-flight turn.
import React from "react";
import { Box, Text, Static } from "ink";
import type { RenderLine } from "./render.js";
import { resolveThemeColor } from "./theme.js";

/** The final safety boundary (F1 Task 2): a RenderLine can be preformatted anywhere — render.ts, liveTurn,
 *  bash, useChat, a replayed transcript on disk — so its colors may still be in §2.2's TH2 grammar
 *  (`rgb()`/`ansi256()`/`ansi:<name>`), which Ink does not accept. Resolving here means no producer can
 *  leak an unrenderable color into the terminal. resolveThemeColor is idempotent on hex and bare names,
 *  so producers that already resolved (all of ours do) are unaffected. */
const ink = (color?: string) => (color === undefined ? undefined : resolveThemeColor(color));

/** RenderLine → <Text>. Exported because PlanDialog renders renderMarkdown() output the same way — one
 *  renderer, so a styling-rule change can't silently drift between the transcript and the dialogs. */
export const Line = ({ l }: { l: RenderLine }) => (
  <Text>
    {l.gutter ? <Text color={ink(l.gutter.color)} dimColor={l.gutter.dim}>{l.gutter.text}</Text> : null}
    {l.segments
      ? l.segments.map((s, i) => <Text key={i} color={ink(s.color)} dimColor={s.dim} bold={s.bold} italic={s.italic}>{s.text}</Text>)
      : <Text color={ink(l.color)} dimColor={l.dim} bold={l.bold} italic={l.italic}>{l.text || " "}</Text>}
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
