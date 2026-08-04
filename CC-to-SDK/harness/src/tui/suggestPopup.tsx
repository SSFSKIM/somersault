// tui/src/suggestPopup.tsx — CM30: the ONE suggestion popup. Upstream has exactly one (`DXe`, bundle
// L432430–L432461, with the row renderer `q7p` at L432489–L432640) and every producer — slash commands,
// `@` file mentions, MCP resources, agents, directories, emoji — feeds it the same `{ id, displayText,
// description }` shape. This port had grown two ad-hoc ones inside ChatComposer instead (`CommandPopup` and
// `MentionPopup`, both eight fixed rows of `<Text inverse>`), which is why the composer jumped whenever the
// list shrank and why nothing about the geometry matched.
//
// Four properties this file exists to get right, all of them from `DXe`:
//
//   1. The height is CLAMPED TO THE TERMINAL, not fixed at 8: `max(1, min(max(6, floor(rows/2)), rows - 3))`.
//   2. It is BLANK-PADDED to that height (`max(0, d - rendered)` rows of `" "`), which is what stops the
//      composer above it from walking up and down the screen as the list changes size.
//   3. The scroll window is MID-ANCHORED, not top-anchored: walk up by at most `floor(d/2)` lines, fill
//      below, then backfill above. A three-line walk-down does not scroll at all.
//   4. Selection is a COLOUR (`suggestion`), not `inverse`; everything unselected is `dimColor`.
//
// The geometry is exported as four pure functions so the sums can be pinned without a render.
import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { resolveThemeColor, themeTokens } from "./theme.js";

/** `Ut` — upstream's `Bun.stringWidth(s, { ambiguousIsNarrow: true })`; `string-width` is that function, and
 *  mdTable.ts already documents the equivalence. */
const w = (s: string) => stringWidth(s);
/** `YSn` (bundle L432384): `/\s+/g`, the whitespace collapse every description goes through. */
const WS = /\s+/g;

/** One row. `id` is load-bearing, not decoration: `E_a` (L432427) keys the whole FILE-ish rendering branch off
 *  its prefix — `file-`, `mcp-resource-`, `mcp-template`, `agent-` — and those rows are always one line and
 *  are drawn as one icon-prefixed run instead of the two-lane name/description layout. */
export interface SuggestItem { id: string; displayText: string; description?: string }

/** `E_a`, bundle L432427. */
export function isFileish(id: string): boolean {
  return id.startsWith("file-") || id.startsWith("mcp-resource-") || id.startsWith("mcp-template") || id.startsWith("agent-");
}
/** `G7p`, bundle L432361: the one-glyph lane in front of a file-ish row. `xw` (the MCP glyph) has no analogue
 *  here and `agent-` rows are not a surface we feed, so `+` — its `file-` value and its default — is all of it. */
const fileIcon = (_id: string): string => "+";

/** `DXe`'s `d` (bundle L432431), the ONLY thing that decides how tall the region is. Not the item count. */
export function popupHeight(rows: number): number {
  return Math.max(1, Math.min(Math.max(6, Math.floor(rows / 2)), rows - 3));
}

/** `DXe`'s `p` (L432441): `maxColumnWidth ?? max(displayText widths) + 5`.
 *
 *  The slash catalog always passes one, computed at L490510 over the WHOLE visible command set rather than
 *  over the currently-matching suggestions: `Math.max(...commands.filter(c => !c.isHidden).map(c => bd(c).length)) + 6`.
 *  Numerically that is the same sum — `bd(c)` is the bare name and `displayText` is `"/" + bd(c)` (`VJa`,
 *  L432406), so `name.length + 6 === displayText.length + 5` — and the difference is entirely the INPUT SET.
 *  That is the point of the override: the name column is a property of the catalog, so it does not jitter as
 *  the user narrows the list. */
export function nameColumn(items: readonly SuggestItem[], maxColumnWidth?: number): number {
  if (maxColumnWidth !== undefined) return maxColumnWidth;
  return Math.max(0, ...items.map((i) => w(i.displayText))) + 5;
}
/** The slash catalog's own override, `k` at bundle L490510. */
export function catalogColumnWidth(names: readonly string[]): number | undefined {
  if (names.length === 0) return undefined;
  return Math.max(...names.map((n) => n.length)) + 6;
}

/** `a0H` (bundle L432457–L432461) verbatim:
 *
 *      if (E_a(e.id) || !e.description) return 1;
 *      let n = Math.min(r, Math.floor(t * 0.4)),
 *          o = e.tag ? Ut(`[${e.tag}] `) : 0,
 *          { kindLaneText: i, sourceText: s } = S_a(e),
 *          a = Math.max(0, t - n - o - Ut(i) - Ut(s) - 4);
 *      if (a <= 0) return 1;
 *      let l = e.description.replace(YSn, " ").trim();
 *      return Ut(l) > a ? 2 : 1;
 *
 *  `r` is the name column, `t` the terminal width. Three of the five subtrahends are lanes we do not render:
 *  `o` is the `[tag] ` lane (upstream only sets `tag` on dynamic-workflow commands), and `i`/`s` are the
 *  kind lane (a 7-column padded `config`/`skill`/`background` label) and the `[source] ` tag, both of which
 *  `S_a` returns empty unless the MENU KIND LANES flag is on. Our `CommandEntry` carries no tag, kind, or
 *  source, so all three are 0 — written out as named zeros rather than deleted, because the day we grow a
 *  lane the budget has to shrink with it.
 *
 *  `n = min(nameCol, floor(columns * 0.4))` is the same clamp the row renderer applies to `RRe` (L432489),
 *  which is what keeps the estimate and the render in agreement about how wide the name lane really is. */
export function rowLines(item: SuggestItem, columns: number, nameCol: number): 1 | 2 {
  if (isFileish(item.id) || !item.description) return 1;
  const n = Math.min(nameCol, Math.floor(columns * 0.4));
  const tagW = 0, kindW = 0, sourceW = 0;                       // lanes we do not render — see the doc above
  const budget = Math.max(0, columns - n - tagW - kindW - sourceW - 4);
  if (budget <= 0) return 1;
  return w(item.description.replace(WS, " ").trim()) > budget ? 2 : 1;
}

/** `DXe`'s scroll walk (bundle L432443–L432448), verbatim. It is NOT "keep the selection three from the top":
 *
 *      let g = clamp(t, 0, e.length - 1), y = g, _ = g + 1, E = m[g] ?? 1, A = 0, H = Math.floor(d / 2);
 *      while (y > 0 && E < d && A + (m[y-1] ?? 1) <= H) y--, A += m[y] ?? 1;   // walk up, budget floor(d/2)
 *      E += A;
 *      while (_ < e.length && E + (m[_] ?? 1) <= d) E += m[_] ?? 1, _++;       // fill below
 *      while (y > 0 && E + (m[y-1] ?? 1) <= d) y--, E += m[y] ?? 1;            // backfill above
 *
 *  `m` is the per-item LINE COUNT, not a count of items, so a two-line row costs two of the budget in every
 *  one of the three loops. `rendered` is `E`, the height actually used, and the blank padding is `d - E`. */
export function scrollWindow(lineCounts: readonly number[], selected: number, d: number): { start: number; end: number; rendered: number } {
  if (lineCounts.length === 0) return { start: 0, end: 0, rendered: 0 };
  const g = Math.max(0, Math.min(selected, lineCounts.length - 1));
  let start = g, end = g + 1, rendered = lineCounts[g] ?? 1, up = 0;
  const half = Math.floor(d / 2);
  while (start > 0 && rendered < d && up + (lineCounts[start - 1] ?? 1) <= half) { start--; up += lineCounts[start] ?? 1; }
  rendered += up;
  while (end < lineCounts.length && rendered + (lineCounts[end] ?? 1) <= d) { rendered += lineCounts[end] ?? 1; end++; }
  while (start > 0 && rendered + (lineCounts[start - 1] ?? 1) <= d) { start--; rendered += lineCounts[start] ?? 1; }
  return { start, end, rendered };
}

/** `gi` (bundle L432396): truncate on the RIGHT, one ellipsis character inside the budget. */
function truncEnd(s: string, cap: number): string {
  if (w(s) <= cap) return s;
  if (cap <= 1) return "…";
  let used = 0, out = "";
  for (const ch of s) { const cw = w(ch); if (used + cw > cap - 1) break; out += ch; used += cw; }
  return out + "…";
}
/** `xG` (bundle L432410): truncate on the LEFT, keeping the tail — what upstream uses for anything with a `/`
 *  or `\` in it, because the end of a path carries the information. */
function truncStart(s: string, cap: number): string {
  if (w(s) <= cap) return s;
  if (cap <= 1) return "…";
  const chars = [...s]; let used = 0, from = chars.length;
  for (let i = chars.length - 1; i >= 0; i--) { const cw = w(chars[i]); if (used + cw > cap - 1) break; used += cw; from = i; }
  return "…" + chars.slice(from).join("");
}
/** `MNe` (bundle L432477): the longest prefix that fits, no ellipsis. */
function prefixWithin(s: string, cap: number): string {
  if (w(s) <= cap) return s;
  if (cap <= 0) return "";
  let used = 0, out = "";
  for (const ch of s) { const cw = w(ch); if (used + cw > cap) break; out += ch; used += cw; }
  return out;
}
/** `W7p` (bundle L432469–L432476): split a description into the part that fits and the remainder, breaking on
 *  a space when there is one to break on. The remainder is what makes a row two lines. */
export function splitDescription(text: string, cap: number): [string, string] {
  if (cap <= 0 || w(text) <= cap) return [text, ""];
  const head = prefixWithin(text, cap); const rest = text.slice(head.length);
  if (rest.startsWith(" ")) return [head, rest.trimStart()];
  const sp = head.lastIndexOf(" ");
  if (sp > 0) return [head.slice(0, sp), text.slice(sp + 1)];
  return [head, rest];
}

const suggestionColor = () => resolveThemeColor(themeTokens().suggestion);

/** `q7p`'s `E_a` branch (bundle L432491–L432532): one truncate-wrapped run, `icon displayText – description`,
 *  in `suggestion` when selected and `dimColor` when not. The en-dash at L432520 is a real `–`, and it
 *  only appears when the item HAS a description — our `@`-mention rows carry none (upstream's own
 *  `UMo`, L314104, builds `{ id: "file-"+path, displayText: path }` with no description either), so in
 *  practice they render as `+ path`. */
function FileRow({ item, columns, selected }: { item: SuggestItem; columns: number; selected: boolean }) {
  const icon = fileIcon(item.id);
  const gap = item.description ? 3 : 0;                          // `e0H`
  const descCap = item.description ? Math.min(20, w(item.description)) : 0;
  const nameBudget = columns - 2 - 4 - gap - descCap;
  const isPath = item.displayText.includes("/") || item.displayText.includes("\\");
  const name = isPath ? truncStart(item.displayText, nameBudget) : truncEnd(item.displayText, nameBudget);
  const text = item.description
    ? `${icon} ${name} – ${truncEnd(item.description.replace(WS, " "), Math.max(0, columns - 2 - w(name) - gap - 4))}`
    : `${icon} ${name}`;
  return <Text color={selected ? suggestionColor() : undefined} dimColor={!selected} wrap="truncate">{text}</Text>;
}

/** `q7p`'s general branch (bundle L432533–L432640): a name lane padded out to `RRe`, then the description in
 *  what is left, with the overflow on a second line indented to the same lane.
 *
 *  Skipped deliberately, each with the bundle's own reason: the `emoji:` pointer lane (`$Tr`, only for emoji
 *  suggestions, which we do not produce), the `[tag] `/kind/source lanes (never populated for us — see
 *  `rowLines`), and `X4t`'s query highlighting, which bolds the matched substring inside both the name and
 *  the description. The last one is a real fidelity gap rather than an N/A; it is its own CM. */
function GeneralRow({ item, columns, nameCol, selected, allowWrap }: { item: SuggestItem; columns: number; nameCol: number; selected: boolean; allowWrap: boolean }) {
  // `SsI`/`RRe`, L432533: with a description the name lane is capped at 40% of the terminal; without one it
  // gets everything but the four-column gutter.
  const lane = item.description ? Math.floor(columns * 0.4) : columns - 4;
  const nameW = Math.min(nameCol, lane);
  const raw = item.displayText;
  const isPath = raw.includes("/") || raw.includes("\\");
  const name = w(raw) > nameW - 2 ? (isPath ? truncStart(raw, nameW - 2) : truncEnd(raw, nameW - 2)) : raw;
  const pad = " ".repeat(Math.max(0, nameW - w(name)));
  const budget = Math.max(0, columns - nameW - 4);
  const desc = item.description ? item.description.replace(WS, " ").trim() : "";
  const [first, rest] = allowWrap ? splitDescription(desc, budget) : [truncEnd(desc, budget), ""];
  const color = selected ? suggestionColor() : undefined;
  const head = <Text wrap="truncate"><Text color={color} dimColor={!selected}>{name + pad + first}</Text></Text>;
  if (!rest) return head;
  return (
    <Box flexDirection="column">
      {head}
      <Text wrap="truncate">{" ".repeat(nameW)}<Text color={color} dimColor={!selected}>{truncEnd(rest, Math.max(0, columns - nameW - 4))}</Text></Text>
    </Box>
  );
}

/** A run of blank rows. `<Text> </Text>` and not `<Text/>`, because Ink collapses a genuinely empty Text and
 *  the whole point of the padding is to occupy a line. Upstream writes the same literal (`h, { children: " " }`,
 *  L432437/L432453). */
const blanks = (n: number, key: string) => Array.from({ length: Math.max(0, n) }, (_, i) => <Text key={`${key}-${i}`}> </Text>);

/**
 * `DXe`. `rows`/`columns` are the terminal's, threaded from ChatComposer the same way everything else in this
 * port is. `emptyMessage` is upstream's `n`: when there are no items and no message the popup is `null`, and
 * when there are no items and a message the message takes ONE line and the padding is `d - 1` (L432435–L432438).
 */
export function SuggestPopup({ items, selected, columns, rows, maxColumnWidth, emptyMessage }: {
  items: readonly SuggestItem[]; selected: number; columns: number; rows: number;
  maxColumnWidth?: number; emptyMessage?: string | null;
}) {
  const d = popupHeight(rows);
  if (items.length === 0) {
    if (!emptyMessage) return null;
    return (
      <Box flexDirection="column" justifyContent="flex-end" paddingX={2}>
        <Text dimColor>{emptyMessage}</Text>
        {blanks(d - 1, "pad")}
      </Box>
    );
  }
  const nameCol = nameColumn(items, maxColumnWidth);
  // `f = d >= 2` (L432441): a one-line-tall popup cannot afford a wrapped row, so `a0H` is skipped entirely
  // and every row counts as one — which also turns the row renderer's `allowWrap` off.
  const allowWrap = d >= 2;
  const lineCounts = items.map((i) => (allowWrap ? rowLines(i, columns, nameCol) : 1));
  const { start, end, rendered } = scrollWindow(lineCounts, selected, d);
  const sel = Math.max(0, Math.min(selected, items.length - 1));
  return (
    <Box flexDirection="column" justifyContent="flex-end" paddingX={2}>
      {items.slice(start, end).map((item, i) => (
        isFileish(item.id)
          ? <FileRow key={item.id} item={item} columns={columns} selected={start + i === sel} />
          : <GeneralRow key={item.id} item={item} columns={columns} nameCol={nameCol} selected={start + i === sel} allowWrap={allowWrap} />
      ))}
      {blanks(d - rendered, "pad")}
    </Box>
  );
}
