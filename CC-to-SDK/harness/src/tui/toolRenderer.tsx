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
import { Line } from "./Transcript.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { bashArgument, type NormalizedToolResult, type ToolStatus } from "./toolResult.js";
import type { ToolEvent } from "./transcriptModel.js";

/** Five columns, and the FIFTH is U+00A0: upstream emits `["  ", "⎿ \xA0"]` so the cell after the connector is not a
 *  break opportunity and no terminal (or trailing-space trim) can eat it. Written with the escape so no editor can
 *  normalize it back to a plain space. */
export const TOOL_RESULT_GUTTER = "  \u23bf \u00a0" as const;
export type RenderItem =
  | { kind: "line"; id: string; line: RenderLine }
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
  if (visual.length <= options.compactRows + (options.revealOneExtraWithoutMarker ? 1 : 0)) return visual.map((text) => ({ text }));
  const estimated = length > bound ? Math.max(lines.length, Math.ceil(length / width)) - options.compactRows : 0;
  const hidden = Math.max(visual.length - options.compactRows, estimated), hint = options.projection === "compact" ? "ctrl+o to expand" : "ctrl+e to show all";
  return [...visual.slice(0, options.compactRows).map((text) => ({ text })), { text: `… +${hidden} ${hidden === 1 ? "line" : "lines"} (${hint})`, dim: true }];
}

const statusToken = (status: ToolStatus): "inactive" | "success" | "error" => (status === "running" ? "inactive" : status === "success" ? "success" : "error");
/** The header argument, always read from the COMPLETE retained input — never from `NormalizedToolResult.summary`,
 *  which is a typed-result row (F3's LT1), not a header. Path tools additionally carry an OSC-8 target: resolved
 *  against cwd so a relative input can never leak as a relative URL, labelled by `displayPath`. */
function headerArgument(event: ToolEvent, options: ProjectionOptions): string {
  if (event.name === "Bash") return bashArgument(event.input, options.verbose);
  const input = isRecord(event.input) ? event.input : {};
  const path = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
  if (path) return osc8FileLink(resolve(options.cwd, path), displayPath(path, options.cwd, options.home));
  const first = Object.values(input)[0];
  return first === undefined ? "" : typeof first === "string" ? first : JSON.stringify(first);
}

/** `● Read(src/app.ts)` — bullet plain-glyph-but-status-coloured, name-only bold, literal parens around the
 *  argument. The macOS bullet is the heavier `⏺`; every other platform gets `●`. */
function headerLine(event: ToolEvent, status: ToolStatus, options: ProjectionOptions): RenderLine {
  const color = resolveThemeColor(themeTokens()[statusToken(status)]);
  const argument = headerArgument(event, options);
  // The 600 ms pending blink: a phase function of `now`, so the caller re-renders on its own clock and the
  // projection stays pure (no timer, no cached frame).
  const bullet: Segment = { text: options.platform === "darwin" ? "⏺ " : "● ", color, ...(status === "running" ? { dim: Math.floor(options.now / 600) % 2 === 0 } : {}) };
  const segments: Segment[] = [bullet, { text: event.name, bold: true }, { text: "(" }, { text: argument }, { text: ")" }];
  return { text: `${bullet.text}${event.name}(${argument})`, segments };
}

/** Upstream `y_s` `trimEnd`s the WHOLE result before it folds anything, so trailing blank rows never buy a fold slot
 *  — and a result that is nothing but whitespace renders no body, which means no gutter block at all. Interior
 *  blanks are content and stay exactly where they are. */
const withoutTrailingBlanks = (lines: readonly string[]): readonly string[] => { let end = lines.length; while (end > 0 && lines[end - 1]!.trim() === "") end--; return lines.slice(0, end); };
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
  if (normalized.status === "rejected") return [{ text: (normalized.output || REJECTED_TEXT).split("\n")[0]!, dim: true }];
  const lines = withoutTrailingBlanks(normalized.outputLines);
  if (!lines.length) return [];
  if (normalized.status === "error") return errorBody(lines, options.projection, resolveThemeColor(themeTokens().error));
  return foldToolOutput(lines, options.columns, { projection: options.projection, compactRows: 3, revealOneExtraWithoutMarker: true });
}

/** One retained call → its renderable items. A `suppressed` tool projects to nothing — driven by the status Task 1's
 *  normalizer assigns, never by a renderer-side name check, so the suppression list has exactly one home. */
export function renderToolEvent(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderItem[] {
  if (normalized.status === "suppressed") return [];
  const items: RenderItem[] = [{ kind: "line", id: `${event.id}:call`, line: headerLine(event, normalized.status, options) }];
  const body = resultBody(normalized, options);
  if (body.length) items.push({ kind: "gutter-block", id: `${event.id}:result`, gutter: TOOL_RESULT_GUTTER, body });
  return items;
}

/** The sole gutter owner. `start`/`end` slice the body (the Ctrl-O pager scrolls a long result without re-projecting
 *  it); `showGutter={false}` keeps the five-column indent while dropping the connector for a continuation page. */
export function RenderItemView({ item, start, end, showGutter = true }: { item: RenderItem; start?: number; end?: number; showGutter?: boolean }): React.ReactElement {
  if (item.kind === "line") return <Line l={item.line} />;
  const body = item.body.slice(start ?? 0, end ?? item.body.length);
  return (
    <Box flexDirection="row">
      <Box width={TOOL_RESULT_GUTTER.length}><Text>{showGutter ? item.gutter : ""}</Text></Box>
      <Box flexDirection="column">{body.map((line, i) => <Line key={i} l={line} />)}</Box>
    </Box>
  );
}
