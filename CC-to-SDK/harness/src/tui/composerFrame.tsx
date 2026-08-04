// tui/src/composerFrame.tsx — F5 Task 2: the composer's visual FORM, hand-drawn.
//
// CM1 (bundle L496235): the composer's border object is
//   { borderStyle: "round", borderLeft: !1, borderRight: !1, borderBottom: !0 }
// i.e. TWO horizontal rules and nothing else. Ink's own border painter (L179493) computes
// `A = width - (left ? 1 : 0) - (right ? 1 : 0)` and `H = (left ? topLeft : "") + top.repeat(A) + …`,
// so with both verticals off the round style contributes no corners and no `│` — the rule is a bare
// `─` run the FULL width of the box. Ink's `<Box borderStyle>` cannot express that (it always draws
// the corners it has), which is why this module paints the two rules by hand instead.
//
// CM-label (bundle L496126): the composer's `borderText` for the history label is
//   { content: ` ${vt.dim(SO)} `, position: "top", align: "start", offset: 2 }
// — the label REPLACES rule cells, the label TEXT is dim, and the two spaces framing it are unstyled.
// The dashes on both sides keep the border colour and are NOT dim: the painter colours them with
// `Xsr(B, a, d)` where `d` is `borderTopDimColor ?? borderDimColor`, both unset here, and splices the
// content in raw between them (L179494–179496).
//
// The splice itself is `$Bu(H, content, align, offset, top)` (L179465–179482), transcribed:
//   · `i = Ut(content)`, `s = H.length` (= our `columns`, since with both verticals off H is a bare run)
//   · OVERFLOW first: `if (i >= s - 2)` → lead is EMPTY, the content is sliced to width `s`, and the
//     remainder of the row is dashes. That is what keeps an over-long label from overflowing the row and
//     making Ink wrap it (t2 review, Minor).
//   · otherwise, align "start" → `a = offset + 1`, clamped by `Math.max(1, Math.min(a, s - i - 1))`, and
//     the lead is `H[0] + Pm(top, a - 1)` — a - 1 MORE dashes after the first, so **`offset: 2` paints
//     THREE lead dashes, not two** (t2 review, Important: we shipped two). The tail is
//     `Pm(top, s - a - i - 1) + H[s-1]`, i.e. `s - a - i` dashes, which keeps the total at `s`.
import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { resolveThemeColor, themeTokens } from "./theme.js";
import type { InputMode } from "./editor.js";

/** `Ge.pointer` (bundle L104968, the unicode figure set) — U+276F, NOT the U+203A `›` we shipped. */
export const POINTER = "❯";
/** The glyph's trailing char is a NBSP, not a space: `[Ge.pointer, "\xA0"]` (L494723) / `"!\xA0"` (L494745). */
export const NBSP = "\u00a0";
const RULE = "─";                                   // U+2500, `round.top` in Ink's border table
const LABEL_OFFSET = 2;                                  // the `offset: 2` of the borderText object
/** L496237, verbatim — three full stops, not U+2026. */
export const EDITOR_IN_FLIGHT_TEXT = "Save and close editor to continue...";

/** The three border tokens this frame can wear. `promptBorder`/`bashBorder` are upstream's own two
 *  (L496228–496235: `{ bash: "bashBorder" }`, everything else `promptBorder`); `remember` is the ccx
 *  memory-mode addition recorded as CM65 — upstream 2.1.220 has no `#` composer mode at all. */
export type ComposerBorderToken = "promptBorder" | "bashBorder" | "remember";

export function borderTokenFor(mode: InputMode): ComposerBorderToken {
  return mode === "bash" ? "bashBorder" : mode === "memory" ? "remember" : "promptBorder";
}

/** CM2 (`rui`, bundle L494733/L494745 via `RRn` L494720): the prompt glyph and how it is painted.
 *  `dimColor` is upstream's `isLoading` — the glyph dims for the whole time a turn runs, in BOTH modes.
 *  Bash is the one mode with its own glyph and its own colour; memory (ours) falls through to the
 *  pointer with no colour, because upstream's `rui` branches on `"bash"` alone.
 *  Returns the string plus its paint so a caller can assert the metadata without rendering. */
export function promptGlyph(mode: InputMode, busy?: boolean): { text: string; color?: string; dim: boolean } {
  if (mode === "bash") return { text: "!" + NBSP, color: resolveThemeColor(themeTokens().bashBorder), dim: !!busy };
  return { text: POINTER + NBSP, color: undefined, dim: !!busy };
}

// NOT built (CH38 non-goal, deliberate): upstream's screen-reader variants. `RRn` (L494721) swaps the
// pointer for `"$\xA0"` when `Ea()` is true, and `A9` (the same predicate, L496235) drops the border
// object entirely so the composer renders with no rules at all. Both are reachable only from a
// screen-reader mode this port does not model, so neither is implemented here.
export function PromptGlyph({ mode, busy }: { mode: InputMode; busy?: boolean }) {
  const g = promptGlyph(mode, busy);
  return <Text color={g.color} dimColor={g.dim}>{g.text}</Text>;
}

/** CM5 (`t_p`, bundle L395963): an empty buffer renders the placeholder with its FIRST character
 *  inverted — that inversion IS the cursor, there is no separate cursor cell — and the remainder dim
 *  (`a = e.length > 0 ? i(e[0]) + vt.dim(e.slice(1)) : i(" ")`). An empty placeholder degrades to one
 *  inverted space. Code units, not code points, to match `e[0]`/`e.slice(1)` exactly.
 *  A Box row rather than nested <Text>: `<Text inverse>` nested inside a <Text> mis-lays out on
 *  re-render in Ink 5.x (the same trap `renderBuffer` documents in ChatComposer). */
export function PlaceholderCursor({ text }: { text: string }) {
  if (text.length === 0) return <Text inverse>{" "}</Text>;
  return <Box flexDirection="row"><Text inverse>{text[0]}</Text><Text dimColor>{text.slice(1)}</Text></Box>;
}

/** Cells of `s` that fit in `max` columns, never overshooting. Upstream's `$$` (L174842) can overshoot on a
 *  wide character straddling the cut, which is the only reason `$Bu` re-slices at `s - 1`; this one cannot,
 *  so that second slice has no work to do here and is not transcribed. */
function sliceWidth(s: string, max: number): string {
  let out = "", w = 0;
  for (const ch of s) { const cw = stringWidth(ch); if (w + cw > max) break; out += ch; w += cw; }
  return out;
}

/** One rule. With no label it is a bare `─` run; with one, the `$Bu` splice transcribed in the header —
 *  `─`×(offset+1) + ` ` + dim(label) + ` ` + `─`×rest, or the truncating overflow branch on a narrow row.
 *  The label span is the ONLY dim part: dimming the dashes too is the exact failure the frame test guards. */
function Rule({ columns, color, label }: { columns: number; color: string; label?: string }) {
  const width = Math.max(0, Math.floor(columns));
  if (label === undefined || label === "") return <Text color={color}>{RULE.repeat(width)}</Text>;
  const content = " " + label + " ";
  const i = stringWidth(content);
  if (i >= width - 2) {                                  // `$Bu`'s overflow arm: no lead, content clamped, dashes fill
    const u = sliceWidth(content, width);
    const dashes = RULE.repeat(Math.max(0, width - stringWidth(u)));
    const rest = u.slice(1), trailing = rest.endsWith(" ");
    return (
      <Text>
        <Text>{u.slice(0, 1)}</Text>
        <Text dimColor>{trailing ? rest.slice(0, -1) : rest}</Text>
        {trailing ? <Text>{" "}</Text> : null}
        <Text color={color}>{dashes}</Text>
      </Text>
    );
  }
  const lead = Math.max(1, Math.min(LABEL_OFFSET + 1, width - i - 1));
  const tail = width - lead - i;
  return (
    <Text>
      <Text color={color}>{RULE.repeat(lead)}</Text>
      <Text>{" "}</Text>
      <Text dimColor>{label}</Text>
      <Text>{" "}</Text>
      <Text color={color}>{RULE.repeat(tail)}</Text>
    </Text>
  );
}

/** The composer's frame: top rule (optionally carrying the history label), the content row, bottom rule.
 *  No Ink `borderStyle` anywhere — see the header note on why it cannot express CM1. */
export function ComposerFrame({ columns, borderToken = "promptBorder", label, children }: {
  columns: number; borderToken?: ComposerBorderToken; label?: string; children?: React.ReactNode;
}) {
  const color = resolveThemeColor(themeTokens()[borderToken]);
  return (
    <Box flexDirection="column">
      <Rule columns={columns} color={color} label={label} />
      <Box flexDirection="row" alignItems="flex-start" justifyContent="flex-start">{children}</Box>
      <Rule columns={columns} color={color} />
    </Box>
  );
}

/** CM8 (bundle L496236–496237): while an external edit is in flight the composer RETURNS EARLY with
 *  just this — the same border object (`...t_`, so both rules survive), `justifyContent: "center"`, and
 *  one italic dim literal in place of glyph + input. Everything else the composer renders — the mode
 *  hints, the footer ladder, the popups — is below that return and so is absent for the duration. */
export function ComposerEditorInFlight({ columns, borderToken }: { columns: number; borderToken?: ComposerBorderToken }) {
  return (
    <ComposerFrame columns={columns} borderToken={borderToken}>
      <Box width={Math.max(0, Math.floor(columns))} justifyContent="center">
        <Text dimColor italic>{EDITOR_IN_FLIGHT_TEXT}</Text>
      </Box>
    </ComposerFrame>
  );
}

/** CM20 (`Z_a`, bundle L433221–433229), transcribed:
 *      if (Z.terminal === "Apple_Terminal") return "shift + ⏎ for newline";
 *      if (TXs())                          return "shift + ⏎ for newline";     // shiftEnterKeyBindingInstalled
 *      return wXs() ? "\⏎ for newline" : "backslash (\) + return (⏎) for newline";
 *  with `wXs()` (L394270) = `Ct().hasUsedBackslashReturn === true` and `CXs()` (L394273) the one-way
 *  setter the `\`+Return continuation calls.
 *
 *  THREE recorded divergences, all because the ladder reads state we do not carry:
 *  · rung 1 gates on `env.TERM_PROGRAM`, our only honest read of upstream's `Z.terminal`.
 *  · rung 2 is UNREACHABLE here: `TXs()` reads the persisted `shiftEnterKeyBindingInstalled` flag that
 *    upstream's `/terminal-setup` writes, and this port has no terminal-setup command to write it. So a
 *    user whose terminal was configured by the real product still sees the backslash rungs.
 *  · rung 3's `hasUsedBackslashReturn` is read off the LIVE EditorState (F5 Task 1) rather than persisted
 *    config, so it resets with the process instead of surviving it.
 *  Note the ladder SHORTENS after first use ("\⏎ for newline"); it does not disappear. */
export function newlineHint(hasUsedBackslashReturn: boolean, env: NodeJS.ProcessEnv = process.env): string {
  if (env.TERM_PROGRAM === "Apple_Terminal") return "shift + ⏎ for newline";
  return hasUsedBackslashReturn ? "\\⏎ for newline" : "backslash (\\) + return (⏎) for newline";
}
