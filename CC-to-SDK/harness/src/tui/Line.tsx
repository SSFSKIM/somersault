// tui/src/Line.tsx — the ONE `RenderLine` → `<Text>` view. Extracted out of Transcript.tsx by F1 Task 4:
// Transcript now renders THROUGH the shared tool renderer (toolRenderer.tsx), and that module already owns
// the gutter view — so leaving `Line` in Transcript.tsx would make the two import each other.
import React from "react";
import { Text } from "ink";
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
export const Line = ({ l, wrap }: { l: RenderLine; wrap?: "wrap" | "truncate-end" }) => (
  <Text wrap={wrap}>
    {l.gutter ? <Text color={ink(l.gutter.color)} dimColor={l.gutter.dim} italic={l.gutter.italic}>{l.gutter.text}</Text> : null}
    {l.segments
      // A `preStyled` segment carries its own SGR bytes (F3 Task 1) — it goes through a BARE <Text> so no
      // chalk wrapper can rewrite them; every other segment takes the ordinary styled-prop path.
      ? l.segments.map((s, i) => s.preStyled
        ? <Text key={i}>{s.text}</Text>
        : <Text key={i} color={ink(s.color)} backgroundColor={ink(s.bg)} dimColor={s.dim} bold={s.bold} italic={s.italic} strikethrough={s.strikethrough} underline={s.underline}>{s.text}</Text>)
      : <Text color={ink(l.color)} backgroundColor={ink(l.bg)} dimColor={l.dim} bold={l.bold} italic={l.italic} strikethrough={l.strikethrough} underline={l.underline}>{l.text || " "}</Text>}
  </Text>
);
