// tui/src/toolRenderer.tsx — F1 Task 3: the ONE projection from a retained `ToolEvent` + its `NormalizedToolResult`
// to renderable items. Live and replay both adopt it in Task 4, so a tool row cannot drift between "what you saw
// while it ran" and "what you see after a resume". Two item kinds only: a `line` (the `● Name(arg)` header) and a
// `gutter-block` (the result body). `RenderItemView` is the SOLE owner of the `⎿` connector — the gutter lives in a
// fixed five-column sibling Box, never inside a body row — which is what keeps exactly one connector per result no
// matter how many visual rows the body wraps to, and lets the Ctrl-O pager slice a body without losing alignment.
//
// Status colour and the running dim ride on the header SEGMENTS, never on the line: `Transcript.Line` renders
// `l.segments` when present and ignores `l.color`/`l.dim`/`l.bold`/`l.italic` entirely in that branch, so a
// line-level colour on a segmented header would silently render as plain text.
import React from "react";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Box, Text } from "ink";
import wrapAnsi from "wrap-ansi";
import type { RenderLine, Segment } from "./render.js";
import { renderMessage } from "./render.js";
import { Line } from "./Line.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { bashArgument, normalizeToolResult, sedInPlaceTarget, type NormalizedToolResult, type ToolStatus } from "./toolResult.js";
import type { ToolEvent, TranscriptDocument, TranscriptEntry } from "./transcriptModel.js";

/** Five columns, and the FIFTH is U+00A0: upstream emits `["  ", "⎿ \xA0"]` so the cell after the connector is not a
 *  break opportunity and no terminal (or trailing-space trim) can eat it. Written with the escape so no editor can
 *  normalize it back to a plain space. */
export const TOOL_RESULT_GUTTER = "  \u23bf \u00a0" as const;
/** `wrap` is set ONLY by the tool header (LT10: upstream's `wrap:"truncate-end"` — an MCP-length name must
 *  never wrap one header into several transcript rows). Every other line item leaves it unset and wraps
 *  normally, which is what keeps ordinary assistant text and local notices readable now that Task 4 routes
 *  the WHOLE transcript through `RenderItemView`. */
export type RenderItem =
  | { kind: "line"; id: string; line: RenderLine; wrap?: "truncate-end" }
  | { kind: "gutter-block"; id: string; gutter: typeof TOOL_RESULT_GUTTER; body: readonly RenderLine[] };
/** How much of a result a surface wants: the transcript's three-row compact form, a fully expanded pager view, or
 *  the detail view's own collapsed form (which offers ctrl+e rather than ctrl+o). */
export type ResultProjection = "compact" | "detail-all" | "detail-collapsed";
export interface ProjectionOptions { cwd: string; home: string; platform: NodeJS.Platform; columns: number; projection: ResultProjection; now: number; verbose: boolean; }
export interface FoldOptions { projection: ResultProjection; compactRows: number; revealOneExtraWithoutMarker: boolean; }

/** Upstream's exact interruption surface — the row is a prompt, not a copy of whatever partial output arrived. */
const INTERRUPTED_TEXT = "Interrupted · What should Claude do instead?";
const REJECTED_TEXT = "Tool use rejected";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** OSC-8 with the BEL terminator (what 2.1.220 emits, and what every terminal we target accepts). */
export const osc8FileLink = (path: string, label: string) => `\x1b]8;;${pathToFileURL(path).href}\x07${label}\x1b]8;;\x07`;
/** cwd-first, home-second: a path inside the session cwd shows relative to it even when the project itself lives
 *  under $HOME (so `~/project/src/app.ts` reads `src/app.ts`); only an outside path falls back to `~`/absolute. */
export function displayPath(path: string, cwd: string, home: string): string {
  const absolute = resolve(cwd, path), fromCwd = relative(cwd, absolute);
  if (!fromCwd || (fromCwd !== ".." && !fromCwd.startsWith(`..${sep}`))) return fromCwd || ".";
  if (absolute === home) return "~";
  if (absolute.startsWith(home + sep)) return `~/${relative(home, absolute)}`;
  return absolute;
}

/** Slice to VISUAL rows first, then clip — so the overflow count is what the reader actually cannot see, not a
 *  logical-line count that undercounts a wrapped row. `revealOneExtraWithoutMarker` is upstream's four-row
 *  exception: showing a 4th row beats spending that row on "… +1 line". This is the ORDINARY-output fold only —
 *  errors count physical lines instead and never come through here (`errorBody`).
 *  Upstream `Omy` slices at the exact column with NO word wrapping and `trimEnd`s every emitted row (so at width 10
 *  "hello world" is "hello worl"/"d", not "hello"/"world"), and a blank input row stays a blank output row. */
const visualRows = (line: string, width: number): string[] => wrapAnsi(line, width, { hard: true, trim: false, wordWrap: false }).split("\n").map((row) => row.trimEnd());
/** A compact projection shows 3–10 rows, so wrapping a multi-megabyte result would stall Ink on rows nobody can see —
 *  and the 600 ms blink re-renders make it recurring. Upstream `y_s` bounds the work at `compactRows * width * 4`
 *  characters and pays for it with an ESTIMATED hidden count over the whole input, floored by the exact count the
 *  wrapped prefix already proves. `detail-all` is the one projection that must stay unbounded. */
export function foldToolOutput(lines: readonly string[], columns: number, options: FoldOptions): readonly RenderLine[] {
  const width = Math.max(columns - 10, 10);
  if (options.projection === "detail-all") return lines.flatMap((line) => visualRows(line, width)).map((text) => ({ text }));
  const bound = options.compactRows * width * 4, length = lines.reduce((sum, line) => sum + line.length, 0) + Math.max(lines.length - 1, 0);
  const prefix: string[] = [];                                               // exactly the logical lines of `text.slice(0, bound)`
  for (let i = 0, used = 0; i < lines.length; i++) {
    if (i > 0 && ++used > bound) break;                                      // the separating newline itself fell outside the bound
    const line = lines[i], room = bound - used;
    prefix.push(line.length > room ? line.slice(0, room) : line); used += Math.min(line.length, room);
    if (line.length > room) break;
  }
  const visual = prefix.flatMap((line) => visualRows(line, width));
  // The no-marker path requires the WHOLE input inside the bound: SGR-heavy source can exceed the bound in bytes
  // while its clipped prefix wraps to few visual rows, and returning here would silently drop the tail.
  if (length <= bound && visual.length <= options.compactRows + (options.revealOneExtraWithoutMarker ? 1 : 0)) return visual.map((text) => ({ text }));
  const estimated = length > bound ? Math.max(lines.length, Math.ceil(length / width)) - options.compactRows : 0;
  const hidden = Math.max(visual.length - options.compactRows, estimated), hint = options.projection === "compact" ? "ctrl+o to expand" : "ctrl+e to show all";
  return [...visual.slice(0, options.compactRows).map((text) => ({ text })), { text: `… +${hidden} ${hidden === 1 ? "line" : "lines"} (${hint})`, dim: true }];
}

const statusToken = (status: ToolStatus): "inactive" | "success" | "error" => (status === "running" ? "inactive" : status === "success" ? "success" : "error");
/** The header argument, always read from the COMPLETE retained input — never from `NormalizedToolResult.summary`,
 *  which is a typed-result row (F3's LT1), not a header. Path tools additionally carry an OSC-8 target: resolved
 *  against cwd so a relative input can never leak as a relative URL, labelled by `displayPath`. */
/** The file-tool family whose header argument IS a local path (corpus Q4: Read/Edit/Write render `wd(file_path)`
 *  hyperlinked). Any other tool with a `path`-named field — Grep's directory scope, an MCP tool's free-form input —
 *  keeps its own first argument and never gets an OSC-8 file link hijacked onto it. */
const FILE_PATH_TOOLS = new Set(["Read", "Edit", "Write"]);
const sedTarget = (event: ToolEvent, platform: NodeJS.Platform): string | undefined =>
  (event.name === "Bash" && isRecord(event.input) && typeof event.input.command === "string" ? sedInPlaceTarget(event.input.command.trim(), platform) : undefined);
/** Upstream `userFacingName`: Edit resolves through `LEo` — `old_string === ""` is a creation, anything else an
 *  update — and a proven `sed -i` Bash command takes the same resolver with a nonempty old_string, so its row reads
 *  `Update`. (`LEo`'s plan-path "Updated plan" variant needs plan-mode state F1 does not model.) */
function displayName(event: ToolEvent, options: ProjectionOptions): string {
  if (event.name === "Edit" && isRecord(event.input)) return event.input.old_string === "" ? "Create" : "Update";
  if (sedTarget(event, options.platform) !== undefined) return "Update";
  return event.name;
}
/** `undefined` (not `""`) means the header renders the bare name with NO parens — upstream's Agent row does that
 *  whenever `description` or `prompt` is missing, because its renderToolUseMessage returns null. */
function headerArgument(event: ToolEvent, options: ProjectionOptions): string | undefined {
  const input = isRecord(event.input) ? event.input : {};
  if (event.name === "Bash") {
    // Upstream `hHH`: a proven sed target renders through `wd()` (the display path), raw only when verbose.
    const target = sedTarget(event, options.platform);
    if (target !== undefined) return options.verbose ? target : displayPath(target, options.cwd, options.home);
    return bashArgument(event.input, options.verbose);
  }
  if (event.name === "Agent") {
    // Corpus 01#507: the description, whitespace-collapsed; null when either description or prompt is missing.
    if (typeof input.description !== "string" || typeof input.prompt !== "string") return undefined;
    return input.description.replace(/\s+/g, " ").trim();
  }
  if (FILE_PATH_TOOLS.has(event.name)) {
    const path = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
    if (path) return osc8FileLink(resolve(options.cwd, path), displayPath(path, options.cwd, options.home));
  }
  const first = Object.values(input)[0];
  return first === undefined ? "" : typeof first === "string" ? first : JSON.stringify(first);
}

/** `● Read(src/app.ts)` — bullet plain-glyph-but-status-coloured, name-only bold, literal parens around the
 *  argument. The macOS bullet is the heavier `⏺`; every other platform gets `●`. */
function headerLine(event: ToolEvent, status: ToolStatus, options: ProjectionOptions): RenderLine {
  const color = resolveThemeColor(themeTokens()[statusToken(status)]);
  const name = displayName(event, options), argument = headerArgument(event, options);
  // The 600 ms pending blink: a phase function of `now`, so the caller re-renders on its own clock and the
  // projection stays pure (no timer, no cached frame).
  const bullet: Segment = { text: options.platform === "darwin" ? "⏺ " : "● ", color, ...(status === "running" ? { dim: Math.floor(options.now / 600) % 2 === 0 } : {}) };
  const segments: Segment[] = argument === undefined
    ? [bullet, { text: name, bold: true }]
    : [bullet, { text: name, bold: true }, { text: "(" }, { text: argument }, { text: ")" }];
  return { text: argument === undefined ? `${bullet.text}${name}` : `${bullet.text}${name}(${argument})`, segments };
}

/** Upstream `y_s` `trimEnd`s the WHOLE result before it folds anything, so trailing blank rows never buy a fold slot
 *  — and a result that is nothing but whitespace renders no body, which means no gutter block at all. Interior
 *  blanks are content and stay exactly where they are. */
const withoutTrailingBlanks = (lines: readonly string[]): readonly string[] => {
  let end = lines.length; while (end > 0 && lines[end - 1]!.trim() === "") end--;
  const kept = lines.slice(0, end);
  // Upstream trimEnd()s the WHOLE string, which also strips padding from the last nonblank line — left in place it
  // would wrap into a phantom empty row (or a bogus marker) before the per-row trim ever saw it.
  if (kept.length) kept[kept.length - 1] = kept[kept.length - 1]!.trimEnd();
  return kept;
};
/** LT15: a generic error clips by PHYSICAL lines — upstream counts newlines and shows `split("\n").slice(0, 10)` —
 *  NOT by visual rows, and with no four-row exception. So one newline-free 500-character failure stays WHOLE (it
 *  still wraps at render; it is simply never clipped, and never counts as more than one line), while an eleven-line
 *  one shows ten plus a marker. The marker is upstream's `bM` sibling — dim, and OUTSIDE the error-coloured Text,
 *  so it never carries the error colour — and it appears only when the overflow is positive (`bM` returns null at
 *  count ≤ 0). `detail-all` is unbounded, exactly as it is for ordinary output. */
const ERROR_PHYSICAL_ROWS = 10;
function errorBody(lines: readonly string[], projection: ResultProjection, color: string): readonly RenderLine[] {
  const rows = (projection === "detail-all" ? lines : lines.slice(0, ERROR_PHYSICAL_ROWS)).map((line) => ({ text: line.trimEnd(), color }));
  const overflow = projection === "detail-all" ? 0 : lines.length - ERROR_PHYSICAL_ROWS;
  if (overflow <= 0) return rows;
  const hint = projection === "compact" ? "ctrl+o to expand" : "ctrl+e to show all";
  return [...rows, { text: `… +${overflow} ${overflow === 1 ? "line" : "lines"} (${hint})`, dim: true }];
}

function resultBody(normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderLine[] {
  if (normalized.status === "running") return [];
  // Both surfaces are upstream `dimColor` prompts, not failures: they are what the USER did, so they never take the
  // error colour, and the rejection is a fixed one-row box (`height: 1`) no matter what text arrived with it.
  if (normalized.status === "interrupted") return [{ text: INTERRUPTED_TEXT, dim: true }];
  if (normalized.status === "rejected") return [{ text: REJECTED_TEXT, dim: true }];   // upstream ignores the tool's text entirely: the row is always this literal
  const lines = withoutTrailingBlanks(normalized.outputLines);
  if (!lines.length) return [];
  if (normalized.status === "error") return errorBody(lines, options.projection, resolveThemeColor(themeTokens().error));
  return foldToolOutput(lines, options.columns, { projection: options.projection, compactRows: 3, revealOneExtraWithoutMarker: true });
}

/** One retained call → its renderable items. A `suppressed` tool projects to nothing — driven by the status Task 1's
 *  normalizer assigns, never by a renderer-side name check, so the suppression list has exactly one home. */
export function renderToolEvent(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderItem[] {
  if (normalized.status === "suppressed") return [];
  const items: RenderItem[] = [{ kind: "line", id: `${event.id}:call`, line: headerLine(event, normalized.status, options), wrap: "truncate-end" }];
  const body = resultBody(normalized, options);
  if (body.length) items.push({ kind: "gutter-block", id: `${event.id}:result`, gutter: TOOL_RESULT_GUTTER, body });
  return items;
}

// ── F1 Task 4: the ONE projection from the retained document to renderable items ────────────────────────
// `TranscriptDocument` stays raw/source-only and never learns about RenderItem, React or projection; this
// module imports it instead, so live, replay, attach, resume, rewind and the Ctrl-O pager all reach a tool
// row (and every ordinary row beside it) through exactly one boundary.
type SdkEntry = Extract<TranscriptEntry, { kind: "sdk-message" }>;
type LocalEntry = Extract<TranscriptEntry, { kind: "local-event" }>;
/** Everything a surface must decide except HOW MUCH of a result it wants — the two projection knobs are
 *  derived, never passed in, so a caller cannot request `detail-all` at `verbose:false` (or the reverse). */
export type ProjectionContext = Omit<ProjectionOptions, "projection" | "verbose">;

export const sdkItemId = (base: string, part: string): string => `sdk:${base}:${part}`;
export const localItemId = (identity: string, lineIndex: number): string => `local:${identity}:line:${lineIndex}`;
export const toolItemId = (toolUseId: string, resultSequence: number | "pending", part: "header" | "body"): string => `tool:${toolUseId}:${resultSequence}:${part}`;

/** PROJECTION IDENTITY ONLY — never append/dedup. Task 1's `appendSdk` deliberately refuses to hash a
 *  payload (two equal-looking calls can be genuinely distinct turns), but a retained entry with no
 *  source-stable identity still needs a deterministic, collision-free item id; the occurrence counter is
 *  what keeps two byte-identical retained rows from collapsing into one published item. FNV-1a. */
function hashMessage(message: Record<string, unknown>): string {
  const text = JSON.stringify(message) ?? "";
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
export function sdkEntryBase(entry: SdkEntry, occurrence: number): string {
  return entry.identity ?? `${hashMessage(entry.message)}:${occurrence}`;
}

/** A nested (subagent) row is retained source, but F1 never flattens it into an unrelated top-level row —
 *  F3 owns the parent/child progress and totals route. */
const isNested = (message: Record<string, unknown>): boolean => typeof message.parent_tool_use_id === "string" && message.parent_tool_use_id.length > 0;

/** The sole non-tool completed-SDK adapter: it reuses render.ts for assistant/user text and every other
 *  non-tool species, and SKIPS `tool_use`/`tool_result` so tools keep the one renderer route above. One
 *  block at a time, so the item id can carry the content index that makes it stable across a rehydration. */
export function projectMessageEntry(entry: SdkEntry, options: ProjectionContext, base?: string): readonly RenderItem[] {
  void options;
  const message = entry.message;
  if (isNested(message)) return [];
  const inner = message.message;
  const content = isRecord(inner) && Array.isArray(inner.content) ? inner.content : [];
  const id = base ?? sdkEntryBase(entry, 0);
  const items: RenderItem[] = [];
  content.forEach((block, index) => {
    if (!isRecord(block) || block.type === "tool_use" || block.type === "tool_result") return;
    for (const [lineIndex, line] of renderMessage({ type: message.type, message: { content: [block] } }).entries())
      // `block:<i>:<line>` rather than the bare `block:<i>`: one markdown block legitimately renders many
      // lines, and two items sharing an id would publish once and lose the rest.
      items.push({ kind: "line", id: sdkItemId(id, `block:${index}:${lineIndex}`), line });
  });
  return items;
}

/** Every `event.lines[index]` maps straight through: the local event already owns its exact RenderLine
 *  styling, so projection adds no second style rule (that is what makes `appendFollowGap`'s dim line
 *  identical in compact and detail). */
export function projectLocalEvent(entry: LocalEntry): readonly RenderItem[] {
  return entry.event.lines.map((line, index) => ({ kind: "line" as const, id: localItemId(entry.identity, index), line }));
}

const reid = (items: readonly RenderItem[], id: string, sequence: number | "pending"): RenderItem[] =>
  items.map((item) => (item.kind === "line" ? { ...item, id: toolItemId(id, sequence, "header") } : { ...item, id: toolItemId(id, sequence, "body") }));

/** The append-only linearization rule. An open header is transient at `callSequence`; the immutable
 *  finalized header-plus-result unit is anchored at `resultSequence`, while a local visual publishes at its
 *  own sequence immediately — so a `/help` that lands between a call and its result enters Static first and
 *  the finalized tool unit follows it. Rank breaks the one real tie: the user message carrying a
 *  `tool_result` shares its sequence with the unit that result completes. */
function projectAll(document: TranscriptDocument, options: ProjectionOptions): readonly RenderItem[] {
  const anchored: { sequence: number; rank: number; items: readonly RenderItem[] }[] = [];
  const occurrences = new Map<string, number>();
  for (const entry of document.entries()) {
    if (entry.kind === "local-event") { anchored.push({ sequence: entry.sequence, rank: 0, items: projectLocalEvent(entry) }); continue; }
    const key = entry.identity ?? hashMessage(entry.message);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    anchored.push({ sequence: entry.sequence, rank: 0, items: projectMessageEntry(entry, options, entry.identity ?? `${key}:${occurrence}`) });
  }
  for (const event of document.toolEvents()) {
    if (event.route !== "top-level" || !event.result) continue;
    anchored.push({ sequence: event.result.resultSequence, rank: 1, items: reid(renderToolEvent(event, normalizeToolResult(event, { verbose: options.verbose }), options), event.id, event.result.resultSequence) });
  }
  return anchored.sort((a, b) => a.sequence - b.sequence || a.rank - b.rank).flatMap((a) => a.items);
}

/** The transcript's finalized projection: final top-level tool units, ordinary non-tool SDK blocks, and
 *  local visual entries, in publication order. */
export function projectCompact(document: TranscriptDocument, options: ProjectionContext): readonly RenderItem[] {
  return projectAll(document, { ...options, projection: "compact", verbose: false });
}
/** Ctrl-E toggles verbosity LOCALLY over the same retained source — full Bash arguments, uncollapsed
 *  generic errors, full output rows — never a second mutable history mode. */
export function projectDetail(document: TranscriptDocument, options: ProjectionContext & { projection: "detail-all" | "detail-collapsed" }): readonly RenderItem[] {
  const { projection, ...context } = options;
  return projectAll(document, { ...context, projection, verbose: projection === "detail-all" });
}
/** Open top-level calls only, selected by `!event.result` — NEVER by `status === "running"`, because a
 *  suppressed bookkeeping call is `suppressed` while still open and would leak into the pending region. */
export function projectPending(document: TranscriptDocument, options: ProjectionContext): readonly RenderItem[] {
  const full: ProjectionOptions = { ...options, projection: "compact", verbose: false };
  const items: RenderItem[] = [];
  for (const event of document.toolEvents()) {
    if (event.route !== "top-level" || event.result) continue;
    items.push(...reid(renderToolEvent(event, normalizeToolResult(event, { verbose: false }), full), event.id, "pending"));
  }
  return items;
}

/** The sole gutter owner. `start`/`end` slice the body (the Ctrl-O pager scrolls a long result without re-projecting
 *  it); `showGutter={false}` keeps the five-column indent while dropping the connector for a continuation page. */
export function RenderItemView({ item, start, end, showGutter = true }: { item: RenderItem; start?: number; end?: number; showGutter?: boolean }): React.ReactElement {
  // LT10: a tool header truncates at the terminal edge (upstream `wrap:"truncate-end"`) — an MCP-length name
  // must never wrap one header into several transcript rows. Ordinary line items (assistant text, local
  // notices, dividers) carry no `wrap` and keep wrapping; body rows keep wrapping, fold already sized them.
  if (item.kind === "line") return <Line l={item.line} wrap={item.wrap} />;
  const body = item.body.slice(start ?? 0, end ?? item.body.length);
  return (
    <Box flexDirection="row">
      <Box width={TOOL_RESULT_GUTTER.length}><Text>{showGutter ? item.gutter : ""}</Text></Box>
      <Box flexDirection="column">{body.map((line, i) => <Line key={i} l={line} />)}</Box>
    </Box>
  );
}
