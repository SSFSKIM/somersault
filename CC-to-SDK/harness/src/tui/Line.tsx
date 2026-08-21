// tui/src/Line.tsx — the ONE `RenderLine` → `<Text>` view. Extracted out of Transcript.tsx by F1 Task 4:
// Transcript now renders THROUGH the shared tool renderer (toolRenderer.tsx), and that module already owns
// the gutter view — so leaving `Line` in Transcript.tsx would make the two import each other.
import React, { useContext } from "react";
import { Text } from "ink";
import type { RenderLine } from "./render.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { HoverContext } from "./mouse/hoverContext.js";

/** The final safety boundary (F1 Task 2): a RenderLine can be preformatted anywhere — render.ts, liveTurn,
 *  bash, useChat, a replayed transcript on disk — so its colors may still be in §2.2's TH2 grammar
 *  (`rgb()`/`ansi256()`/`ansi:<name>`), which Ink does not accept. Resolving here means no producer can
 *  leak an unrenderable color into the terminal. resolveThemeColor is idempotent on hex and bare names,
 *  so producers that already resolved (all of ours do) are unaffected. */
const ink = (color?: string) => (color === undefined ? undefined : resolveThemeColor(color));

// F9 T-MOUSE Task 3 — the two hover-brighten halves (spec M3, canon §2.3), both applied ONLY when
// `HoverContext` reads `true` for this row:
//   (a) DIM IS DROPPED, not recolored — canon's own `QmS` (L203979) does the same: `dimColor && !hovered`
//       reads straight through to the undimmed color when hovered, it does not pick a brighter color.
//   (b) THE BAND SWAPS, not every background — canon's pair is keyed to ONE specific token
//       (`userMessageBackground` ⇄ `userMessageBackgroundHover`, L562653/562668/562779 etc.), so a diff
//       row's red/green band or a rule's dim title band must NOT light up just because its row is hovered.
//       Comparing the RESOLVED colors (both sides go through `resolveThemeColor`) is what makes this an
//       identity check on the TOKEN rather than a guess at which raw hex a producer happened to pass.
const hoverBand = (bg: string | undefined, hovered: boolean): string | undefined => {
  if (!hovered || bg === undefined) return bg;
  return bg === resolveThemeColor(themeTokens().userMessageBackground) ? resolveThemeColor(themeTokens().userMessageBackgroundHover) : bg;
};
// A `preStyled` segment's dim is BAKED INTO ITS BYTES (F3 Task 1's exact-bytes contract — it renders through
// a bare `<Text>` with no style props at all, so there is no `dimColor` to flip). Un-dimming it hovered is
// therefore a literal `\x1b[2m` strip rather than a re-style — the brief's own phrasing for this row shape.
const DIM_SGR = /\x1b\[2m/g;
const unDimRaw = (raw: string, hovered: boolean): string => (hovered ? raw.replace(DIM_SGR, "") : raw);

/** RenderLine → <Text>. Exported because PlanDialog renders renderMarkdown() output the same way — one
 *  renderer, so a styling-rule change can't silently drift between the transcript and the dialogs. */
export const Line = ({ l, wrap }: { l: RenderLine; wrap?: "wrap" | "truncate-end" }) => {
  const hovered = useContext(HoverContext);
  return (
    <Text wrap={wrap}>
      {l.gutter ? <Text color={ink(l.gutter.color)} dimColor={hovered ? false : l.gutter.dim} italic={l.gutter.italic}>{l.gutter.text}</Text> : null}
      {l.segments
        // A `preStyled` segment carries its own SGR bytes (F3 Task 1) — it goes through a BARE <Text> so no
        // chalk wrapper can rewrite them; every other segment takes the ordinary styled-prop path.
        ? l.segments.map((s, i) => s.preStyled
          ? <Text key={i}>{unDimRaw(s.text, hovered)}</Text>
          : <Text key={i} color={ink(s.color)} backgroundColor={hoverBand(ink(s.bg), hovered)} dimColor={hovered ? false : s.dim} bold={s.bold} italic={s.italic} strikethrough={s.strikethrough} underline={s.underline}>{s.text}</Text>)
        : <Text color={ink(l.color)} backgroundColor={hoverBand(ink(l.bg), hovered)} dimColor={hovered ? false : l.dim} bold={l.bold} italic={l.italic} strikethrough={l.strikethrough} underline={l.underline}>{l.text || " "}</Text>}
    </Text>
  );
};
