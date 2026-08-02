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

export const TOOL_RESULT_GUTTER = "  ⎿  " as const;
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

/** Wrap to VISUAL rows first, then clip — so the overflow count is what the reader actually cannot see, not a
 *  logical-line count that undercounts a wrapped row. `revealOneExtraWithoutMarker` is upstream's four-row
 *  exception: showing a 4th row beats spending that row on "… +1 line". Errors switch it off (LT15). */
export function foldToolOutput(lines: readonly string[], columns: number, options: FoldOptions): readonly RenderLine[] {
  const visual = lines.flatMap((line) => wrapAnsi(line || " ", Math.max(columns - 10, 10), { hard: true, trim: false }).split("\n"));
  if (options.projection === "detail-all" || visual.length <= options.compactRows + (options.revealOneExtraWithoutMarker ? 1 : 0)) return visual.map((text) => ({ text }));
  const hidden = visual.length - options.compactRows, hint = options.projection === "compact" ? "ctrl+o to expand" : "ctrl+e to show all";
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

function resultBody(normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderLine[] {
  if (normalized.status === "running") return [];
  const failed = resolveThemeColor(themeTokens().error);
  if (normalized.status === "interrupted") return [{ text: INTERRUPTED_TEXT, color: failed }];
  if (normalized.status === "rejected") return [{ text: normalized.output || REJECTED_TEXT, color: failed }];
  const error = normalized.status === "error";
  // LT15: an error body clips at ten rows with no four-row exception, so an 11th row always gets the shared
  // expandable marker instead of being silently revealed.
  const rows = foldToolOutput(normalized.outputLines, options.columns, { projection: options.projection, compactRows: error ? 10 : 3, revealOneExtraWithoutMarker: !error });
  return error ? rows.map((row) => ({ ...row, color: failed })) : rows;
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
