// tui/src/suggestPopup.tsx — CM30: the ONE suggestion popup. Upstream has exactly one (`DXe`, bundle
// L432430–L432453, with the row renderer `q7p` at L432488–L432640) and every producer — slash commands,
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
import type { CommandKind } from "./commandComplete.js";

/** `Ut` — upstream's `Bun.stringWidth(s, { ambiguousIsNarrow: true })`; `string-width` is that function, and
 *  mdTable.ts already documents the equivalence. */
const w = (s: string) => stringWidth(s);
/** `YSn` (bundle L432487): `/\s+/g`, the whitespace collapse every description goes through. */
const WS = /\s+/g;

/** One row. `id` is load-bearing, not decoration: `E_a` (L432427) keys the whole FILE-ish rendering branch off
 *  its prefix — `file-`, `mcp-resource-`, `mcp-template`, `agent-` — and those rows are always one line and
 *  are drawn as one icon-prefixed run instead of the two-lane name/description layout. */
export interface SuggestItem { id: string; displayText: string; description?: string; kind?: SuggestKind }

/** `e.kind` — DG55. The popup is generic, but this field is not: the ONLY producer that sets it is the slash
 *  source (`VJa`, bundle L490007, `...t && { kind: p9f(e), sourceTag: nRb(e) }`), so the vocabulary is `p9f`'s
 *  and there is one definition of it, in commandComplete.ts. File/`@`-mention rows (`I9f`, L490269–L490278)
 *  and history rows build no `kind` at all, which is what keeps them on their existing single-line branch.
 *
 *  Two upstream facts about the field worth keeping written down, because we depart from the first:
 *
 *   1. Upstream GATES it on a flag — `VJa`'s `t` argument is `Z.CLAUDE_CODE_ENABLE_MENU_KIND_LANES ||
 *      Ke("tengu_mint_lanes", !1)` (L490015), so on a default build `kind` is undefined on every row and the
 *      lane never appears. We render it unconditionally: this is the shipped code path with the flag ON, and
 *      the F5-era comment in `rowLines` calling the kind lane a lane "we do not render" is now out of date by
 *      choice, not by accident.
 *   2. The same flag also turns on `sourceTag` — a `[project] `/`[org] ` lane (`nRb`, L489986–L489995, keyed on
 *      `f9f`'s command PROVENANCE: userSettings/projectSettings/plugin/policySettings…). `CommandEntry.source`
 *      is `"local" | "catalog"`, our own two-way split between a built-in and anything the engine reported, and
 *      it carries no evidence of which settings file a catalog command came from. So `sourceTag` is NOT
 *      derivable and stays a named zero, next to `tag` (upstream's `[dynamic workflow] `, set only for
 *      `type === "prompt" && kind === "workflow"`, which we equally cannot see). */
export type SuggestKind = CommandKind;

/** `S_a`, bundle L432454 — the kind-lane builder, verbatim:
 *
 *      function S_a(e) {
 *        let r = e.kind === void 0 || e.kind === "action" ? "" : e.kind === "info" ? "config" : e.kind,
 *            n = e.kind === void 0 ? "" : r + Pm(" ", 7 - Ut(r)),
 *            o = e.sourceTag ? `[${e.sourceTag}] ` : "";
 *        return { kindLaneText: n, kindLabel: r, sourceText: o };
 *      }
 *
 *  Three distinct outcomes, and the difference between the first two is the whole reason `kindLabel` and
 *  `kindLaneText` are separate fields:
 *
 *   · `kind === undefined` → BOTH empty. No lane, no width, nothing between the name pad and the description.
 *   · `kind === "action"`  → label empty but the lane is still SEVEN BLANK COLUMNS, because `n` is gated on
 *     `undefined` only. An action row therefore pays for the lane and prints nothing in it — which is the
 *     point: the description of every command row stays in the same column whether its kind has a word or not.
 *   · anything else        → the label padded to exactly 7 (`info` renamed to `config` first, so the two share
 *     a lane and a word). `Pm` is `e.repeat(t > 0 ? t : 0)`, hence the `Math.max(0, …)`.
 *
 *  `role` is `q7p`'s colour choice at L432563 — `GTr = r0H === "skill" ? "skill" : r0H === "agent" ?
 *  "background" : void 0` — read off the LABEL, not the kind, which is why `info` cannot be coloured and
 *  `action` cannot either. It is a theme role, and it is independent of selection: the lane keeps its own
 *  colour on the highlighted row (`qTr` at L432588 takes `GTr` alone, never `suggestion`), and a lane with no
 *  role is drawn `dimColor` regardless. */
export function kindLane(kind?: SuggestKind): { text: string; label: string; role: "skill" | "background" | undefined } {
  const label = kind === undefined || kind === "action" ? "" : kind === "info" ? "config" : kind;
  const text = kind === undefined ? "" : label + " ".repeat(Math.max(0, 7 - w(label)));
  return { text, label, role: label === "skill" ? "skill" : label === "agent" ? "background" : undefined };
}

/** `E_a`, bundle L432427. */
export function isFileish(id: string): boolean {
  return id.startsWith("file-") || id.startsWith("mcp-resource-") || id.startsWith("mcp-template") || id.startsWith("agent-");
}
/** `G7p`, bundle L432361: the one-glyph lane in front of a file-ish row. `xw` (the MCP glyph) has no analogue
 *  here and `agent-` rows are not a surface we feed, so `+` — its `file-` value and its default — is all of it. */
const fileIcon = (_id: string): string => "+";

/** `DXe`'s `d` (bundle L432431, the `let { rows: c, columns: u } = Br(), d = …` line) — the ONLY thing that
 *  decides how tall the region is. Not the item count. */
export function popupHeight(rows: number): number {
  return Math.max(1, Math.min(Math.max(6, Math.floor(rows / 2)), rows - 3));
}

/** `DXe`'s `p` (L432438): `maxColumnWidth ?? max(displayText widths) + 5`.
 *
 *  The slash catalog always passes one, computed at L490508–L490513 over the WHOLE visible command set rather than
 *  over the currently-matching suggestions: `Math.max(...commands.filter(c => !c.isHidden).map(c => bd(c).length)) + 6`.
 *  Numerically that is the same sum — `bd(c)` is the bare name and `displayText` is `"/" + bd(c)` (`VJa`,
 *  L490005–L490008), so `name.length + 6 === displayText.length + 5` — and the difference is entirely the INPUT SET.
 *  That is the point of the override: the name column is a property of the catalog, so it does not jitter as
 *  the user narrows the list. */
export function nameColumn(items: readonly SuggestItem[], maxColumnWidth?: number): number {
  if (maxColumnWidth !== undefined) return maxColumnWidth;
  return Math.max(0, ...items.map((i) => w(i.displayText))) + 5;
}
/** The slash catalog's own override, `k` at bundle L490508–L490513 (the sum itself is L490512). */
export function catalogColumnWidth(names: readonly string[]): number | undefined {
  if (names.length === 0) return undefined;
  return Math.max(...names.map((n) => n.length)) + 6;
}

/** `a0H` (bundle L432458–L432466) verbatim:
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
 *  `r` is the name column, `t` the terminal width. Of the three lane subtrahends, DG55 made ONE of them real
 *  and left the other two as named zeros — "the day we grow a lane the budget has to shrink with it" was the
 *  reason they were written out rather than deleted, and this is that day for the kind lane. `i` is now
 *  `S_a`'s 7-column lane and costs 7 columns on every command row that carries a kind, `action` included
 *  (its lane is blank, not absent). `o` (the `[tag] ` lane, upstream only on dynamic-workflow commands) and
 *  `s` (the `[source] ` tag) stay 0 — see `SuggestKind` above for why neither is derivable from what we carry.
 *
 *  `n = min(nameCol, floor(columns * 0.4))` is the same clamp the row renderer applies to `RRe` (L432540),
 *  which is what keeps the estimate and the render in agreement about how wide the name lane really is. */
export function rowLines(item: SuggestItem, columns: number, nameCol: number): 1 | 2 {
  if (isFileish(item.id) || !item.description) return 1;
  const n = Math.min(nameCol, Math.floor(columns * 0.4));
  const tagW = 0, sourceW = 0;                                  // lanes we do not render — see the doc above
  const kindW = w(kindLane(item.kind).text);
  const budget = Math.max(0, columns - n - tagW - kindW - sourceW - 4);
  if (budget <= 0) return 1;
  return w(item.description.replace(WS, " ").trim()) > budget ? 2 : 1;
}

/** `DXe`'s scroll walk (bundle L432438–L432445), verbatim. It is NOT "keep the selection three from the top":
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

/** `gi` (bundle L106951): truncate on the RIGHT, one ellipsis character inside the budget. */
export function truncEnd(s: string, cap: number): string {
  if (w(s) <= cap) return s;
  if (cap <= 1) return "…";
  let used = 0, out = "";
  for (const ch of s) { const cw = w(ch); if (used + cw > cap - 1) break; out += ch; used += cw; }
  return out + "…";
}
/** `xG` (bundle L106965): truncate on the LEFT, keeping the tail. */
export function truncStart(s: string, cap: number): string {
  if (w(s) <= cap) return s;
  if (cap <= 1) return "…";
  const chars = [...s]; let used = 0, from = chars.length;
  for (let i = chars.length - 1; i >= 0; i--) { const cw = w(chars[i]); if (used + cw > cap - 1) break; used += cw; from = i; }
  return "…" + chars.slice(from).join("");
}
/** `MNe` (bundle L106979): the longest prefix that fits, no ellipsis. */
function prefixWithin(s: string, cap: number): string {
  if (w(s) <= cap) return s;
  if (cap <= 0) return "";
  let used = 0, out = "";
  for (const ch of s) { const cw = w(ch); if (used + cw > cap) break; out += ch; used += cw; }
  return out;
}
/** `bLt` (bundle L106938–L106949) — the PATH truncation, and a different shape from both of the above:
 *
 *      function bLt(e, t) {
 *        if (Ut(e) <= t) return e;
 *        if (t <= 0) return "…";
 *        if (t < 5) return gi(e, t);
 *        let r = e.lastIndexOf("/"), n = r >= 0 ? e.slice(r) : e, o = r >= 0 ? e.slice(0, r) : "", i = Ut(n);
 *        if (i >= t - 1) return xG(e, t);
 *        let s = t - 1 - i;
 *        return MNe(o, s) + "…" + n;
 *      }
 *
 *  A MIDDLE elide that keeps the whole basename: `src/tui/suggestPopup.tsx` at 20 columns becomes
 *  `src/…/suggestPopup.tsx`-shaped rather than `…i/suggestPopup.tsx`. Note `n` is `e.slice(r)` — the basename
 *  WITH its leading slash — so the ellipsis lands where the parent directories were cut, not next to the name.
 *  Two fallbacks, both real: a basename that alone eats the budget drops to `xG` (left-elide, since there is
 *  no middle left to elide), and a budget under five columns drops to `gi`.
 *
 *  This is what `q7p` routes every `file-` row through (L432510: `Lzo = h_a ? xG(…) : bLt(…)`, where `h_a` is
 *  the `mcp-template-value::` id and every other file-ish id takes the `bLt` arm). Ours used `xG` for anything
 *  containing a slash, which threw the parent directories away and kept an arbitrary head of them instead. */
export function truncPath(s: string, cap: number): string {
  if (w(s) <= cap) return s;
  if (cap <= 0) return "…";
  if (cap < 5) return truncEnd(s, cap);
  const slash = s.lastIndexOf("/");
  const base = slash >= 0 ? s.slice(slash) : s;                 // `n`: the basename, leading slash included
  const parent = slash >= 0 ? s.slice(0, slash) : "";           // `o`
  const baseW = w(base);
  if (baseW >= cap - 1) return truncStart(s, cap);              // `if (i >= t - 1) return xG(e, t)`
  return prefixWithin(parent, cap - 1 - baseW) + "…" + base;
}
/** `W7p` (bundle L432467–L432477): split a description into the part that fits and the remainder, breaking on
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
/** `q7p` names its colours as theme ROLES (`"suggestion"`, `"skill"`, `"background"`) and hands the role
 *  straight to Ink, which resolves it against the active theme. Ours resolves at render time for the same
 *  reason `themeTokens()` is called per render everywhere else in this port: `/theme` must be visible on the
 *  next paint, not the next mount. */
const roleColor = (role: "skill" | "background") => resolveThemeColor(themeTokens()[role]);

/** `q7p`'s `E_a` branch (bundle L432490–L432538): one truncate-wrapped run, `icon displayText – description`,
 *  in `suggestion` when selected and `dimColor` when not. The en-dash at L432530 is a real `–`, and it
 *  only appears when the item HAS a description — our `@`-mention rows carry none (upstream's own
 *  `UMo`, L314103, builds `{ id: "file-"+path, displayText: path }` with no description either), so in
 *  practice they render as `+ path`.
 *
 *  The name goes through `bLt` (L432510), not `xG`: every `file-` id takes that arm, and it is a middle
 *  elide that preserves the basename. */
function FileRow({ item, columns, selected }: { item: SuggestItem; columns: number; selected: boolean }) {
  const icon = fileIcon(item.id);
  const gap = item.description ? 3 : 0;                          // `e0H`
  const descCap = item.description ? Math.min(20, w(item.description)) : 0;
  const nameBudget = columns - 2 - 4 - gap - descCap;
  const name = truncPath(item.displayText, nameBudget);
  const text = item.description
    ? `${icon} ${name} – ${truncEnd(item.description.replace(WS, " "), Math.max(0, columns - 2 - w(name) - gap - 4))}`
    : `${icon} ${name}`;
  return <Text color={selected ? suggestionColor() : undefined} dimColor={!selected} wrap="truncate">{text}</Text>;
}

/** `q7p`'s general branch (bundle L432540–L432640). The row is a fixed run of lanes, in the bundle's own
 *  child order at L432606 — which is NOT the order the lanes are computed in, and not the order this task's
 *  brief predicted either:
 *
 *      [emoji pointer] [displayText] [pad to RRe] [kind lane] [tag] [source] [description]
 *
 *  i.e. the kind lane comes FIRST of the three metadata lanes, `[tag] ` second and `[source] ` last, all of
 *  them after the name pad and before the description. Three of the seven are permanently absent for us and
 *  each has its own reason: the `emoji:` pointer (`$Tr`, only for emoji suggestions, which we do not produce)
 *  and the tag/source lanes (not derivable from `CommandEntry` — see `SuggestKind`). `X4t`'s query
 *  highlighting, which bolds the matched substring inside both the name and the description, is still skipped
 *  and is still a real fidelity gap rather than an N/A; it is its own CM.
 *
 *  DG55 adds the kind lane, and the second line moves with it: upstream's continuation indent is
 *  `Nzo = RRe + y_a + H_a` (L432610) — name lane PLUS every metadata lane — so the wrapped remainder lines up
 *  under the description rather than under the lane it would otherwise collide with. */
function GeneralRow({ item, columns, nameCol, selected, allowWrap }: { item: SuggestItem; columns: number; nameCol: number; selected: boolean; allowWrap: boolean }) {
  // `SsI`, L432540: `description || tag || kind !== void 0 || sourceTag` — a row with ANY of them caps its
  // name lane at 40% of the terminal; a bare name row gets everything but the four-column gutter. A kind
  // counts even on a description-less row, because the lane still has to fit somewhere.
  const lane = item.description || item.kind !== undefined ? Math.floor(columns * 0.4) : columns - 4;
  const nameW = Math.min(nameCol, lane);
  const raw = item.displayText;
  const isPath = raw.includes("/") || raw.includes("\\");
  const name = w(raw) > nameW - 2 ? (isPath ? truncStart(raw, nameW - 2) : truncEnd(raw, nameW - 2)) : raw;
  const pad = " ".repeat(Math.max(0, nameW - w(name)));
  const { text: kindText, role } = kindLane(item.kind);
  const kindW = w(kindText);                                      // `H_a`, minus the source lane we never have
  const budget = Math.max(0, columns - nameW - kindW - 4);        // `b_a`
  const desc = item.description ? item.description.replace(WS, " ").trim() : "";
  const [first, rest] = allowWrap ? splitDescription(desc, budget) : [truncEnd(desc, budget), ""];
  const color = selected ? suggestionColor() : undefined;
  // `qTr` (L432588): the lane is drawn only when `kindLaneText` is non-empty — which INCLUDES the seven blanks
  // an `action` row gets — and its colour is the role alone, never the selection colour.
  const kindNode = kindText ? <Text color={role ? roleColor(role) : undefined} dimColor={!role}>{kindText}</Text> : null;
  const head = <Text wrap="truncate"><Text color={color} dimColor={!selected}>{name + pad}</Text>{kindNode}<Text color={color} dimColor={!selected}>{first}</Text></Text>;
  if (!rest) return head;
  const indent = nameW + kindW;                                   // `Nzo`
  return (
    <Box flexDirection="column">
      {head}
      <Text wrap="truncate">{" ".repeat(indent)}<Text color={color} dimColor={!selected}>{truncEnd(rest, Math.max(0, columns - indent - 4))}</Text></Text>
    </Box>
  );
}

/** A run of blank rows. `<Text> </Text>` and not `<Text/>`, because Ink collapses a genuinely empty Text and
 *  the whole point of the padding is to occupy a line. Upstream writes the same literal (`h, { children: " " }`,
 *  L432436 for the empty-message pad, L432452 for the list pad). */
const blanks = (n: number, key: string) => Array.from({ length: Math.max(0, n) }, (_, i) => <Text key={`${key}-${i}`}> </Text>);

/**
 * `DXe`. `rows`/`columns` are the terminal's, threaded from ChatComposer the same way everything else in this
 * port is. `emptyMessage` is upstream's `n`: when there are no items and no message the popup is `null`, and
 * when there are no items and a message the message takes ONE line and the padding is `d - 1` (L432433–L432436).
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
  // `f = d >= 2` (L432438): a one-line-tall popup cannot afford a wrapped row, so `a0H` is skipped entirely
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
