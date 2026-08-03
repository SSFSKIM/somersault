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
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Box, Text } from "ink";
import wrapAnsi from "wrap-ansi";
import type { RenderLine, Segment } from "./render.js";
import { renderMessage } from "./render.js";
import { displayPath } from "./paths.js";
import { Line } from "./Line.js";
import { resolveThemeColor, themeGeneration, themeTokens } from "./theme.js";
import { bashArgument, callSidecar, isSuppressedTool, normalizeToolResult, sedInPlaceTarget, type NormalizedToolResult, type ToolStatus } from "./toolResult.js";
import { classifyToolEvent, foldClauses, segmentRuns, type FoldAtom, type FoldGroup, type GroupCounts } from "./toolFold.js";
import { foldToolOutput, withoutTrailingBlanks, type ResultProjection } from "./outputFold.js";
import { summaryLines } from "./toolSummaries.js";
import { agentChildren, agentDoneText, agentTotals, AGENT_INITIALIZING, AGENT_PROGRESS_ROWS, hiddenToolUsesLine, indentRenderLine, isAgentTool, type AgentMeta } from "./agentProgress.js";
import type { FoldPendingHooks } from "./foldPendingState.js";
import { composeFoldRun, stripSgr } from "./sgrFoldRow.js";
import type { ToolEvent, TranscriptDocument, TranscriptEntry } from "./transcriptModel.js";

/** Five columns, and the FIFTH is U+00A0: upstream emits `["  ", "⎿ \xA0"]` so the cell after the connector is not a
 *  break opportunity and no terminal (or trailing-space trim) can eat it. Written with the escape so no editor can
 *  normalize it back to a plain space. */
export const TOOL_RESULT_GUTTER = "  \u23bf \u00a0" as const;
/** The ACTIVE group row's own hint gutter (R4.6, `X8o = 5`): 2 spaces, the connector, 2 PLAIN spaces. Upstream
 *  keeps it distinct from the tool-result gutter above (which ends in the NBSP); both are exactly five columns. */
export const GROUP_HINT_GUTTER = "  \u23bf  " as const;
/** Upstream `PAH` (L428157): the thinking summary's hint body is clamped to this many rendered lines. */
const HINT_MAX_LINES = 10;
/** `wrap` is set ONLY by the tool header (LT10: upstream's `wrap:"truncate-end"` — an MCP-length name must
 *  never wrap one header into several transcript rows). Every other line item leaves it unset and wraps
 *  normally, which is what keeps ordinary assistant text and local notices readable now that Task 4 routes
 *  the WHOLE transcript through `RenderItemView`. */
export type RenderItem =
  | { kind: "line"; id: string; line: RenderLine; wrap?: "truncate-end" }
  // `gutterStyle` styles the CONNECTOR cells themselves (the five-column sibling Box), which is otherwise
  // plain text. Only the active group's hint gutter uses it today: the tracked 2.1.220 golden renders
  // `  ⎿  src/app.ts` as ONE dim `#999999` run across connector and path alike, with no artifact in it.
  | { kind: "gutter-block"; id: string; gutter: typeof TOOL_RESULT_GUTTER | typeof GROUP_HINT_GUTTER; body: readonly RenderLine[]; gutterStyle?: { color?: string; dim?: boolean } };
/** How much of a result a surface wants: the transcript's three-row compact form, a fully expanded pager view, or
 *  the detail view's own collapsed form (which offers ctrl+e rather than ctrl+o). F3 Task 5 moved the type and the
 *  fold itself into `outputFold.ts` (so `toolSummaries.ts` can fold a Bash stdout body without importing this
 *  module); both are re-exported here because this is still the surface every caller and test reaches for. */
export type { FoldOptions } from "./outputFold.js";
export { foldToolOutput };
export type { ResultProjection };
/** `thoughtMs` (F3 Task 3) is the caller's LIVE thinking clock: sdk message identity (`message:<id>`) →
 *  locally clocked thinking ms, produced by `LiveTurn` and retained by `useChat` across turn end. It is a
 *  projection input rather than document state on purpose — P82 proved the durations exist nowhere on the
 *  wire or on disk, so a rewound/resumed/attached document must show no clause at all, which an absent
 *  map entry already achieves. */
/** `pending` (F3 Task 4) is the DYNAMIC region's time-dependent state — the ratcheted counters (R3.2) and
 *  the throttled/lingering `⎿` hint (R4.7 steps 4–5). It is stateful and clock-reading, so it lives in
 *  `useChat` (see `foldPendingState.ts`) rather than in this otherwise-pure projection, and it is consulted
 *  ONLY for a group row the pending region owns: an immutable published Static row is the settled truth and
 *  must never be re-derived from live maxima. */
/** `agentMeta` (F3 Task 7) is the caller's capture of the `system/task_*` sidechannel, keyed by the Agent
 *  `tool_use_id` — the totals ladder's second rung plus the local arrival stamps its third rung measures
 *  against. Like `thoughtMs` it is a projection INPUT rather than document state: those frames are retained
 *  nowhere on disk, so a rewound/resumed/attached document must fall through to what it can derive.
 *  `toolEvents` is injected by the projections themselves (never by a caller): an Agent's progress rows are
 *  its NESTED calls, which live in the document beside it rather than on the event. */
export interface ProjectionOptions { cwd: string; home: string; platform: NodeJS.Platform; columns: number; projection: ResultProjection; now: number; verbose: boolean; thoughtMs?: ReadonlyMap<string, number>; pending?: FoldPendingHooks; agentMeta?: ReadonlyMap<string, AgentMeta>; toolEvents?: readonly ToolEvent[]; }

/** Upstream's exact interruption surface — the row is a prompt, not a copy of whatever partial output arrived. */
const INTERRUPTED_TEXT = "Interrupted · What should Claude do instead?";
const REJECTED_TEXT = "Tool use rejected";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** OSC-8 with the BEL terminator (what 2.1.220 emits, and what every terminal we target accepts). */
export const osc8FileLink = (path: string, label: string) => `\x1b]8;;${pathToFileURL(path).href}\x07${label}\x1b]8;;\x07`;
/** Re-exported, not defined here, since Task 5c: `paths.ts` owns the rule so `toolFold.ts` can reach it
 *  without importing this module (which now imports the fold model). The public surface is unchanged. */
export { displayPath };

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

/** F3 Task 5 (LT1): the TYPED row is consulted first and is the result body in BOTH projections — a completed
 *  Read reads `Read 340 lines`, never its file content, because upstream dumps that content nowhere (the ctrl+o
 *  verbose branch renders the same `renderToolResultMessage` with `verbose:true`, contract R6.3). The three
 *  surfaces above it are NOT rerouted: `interrupted`/`rejected` are what the USER did and `running` has no body
 *  yet. `undefined` from `summaryLines` means "no typed row" — the generic fold below stays the whole story for
 *  Bash stdout, unknown tools and every error projection. */
function resultBody(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderLine[] {
  if (normalized.status === "running") return [];
  // Both surfaces are upstream `dimColor` prompts, not failures: they are what the USER did, so they never take the
  // error colour, and the rejection is a fixed one-row box (`height: 1`) no matter what text arrived with it.
  if (normalized.status === "interrupted") return [{ text: INTERRUPTED_TEXT, dim: true }];
  if (normalized.status === "rejected") return [{ text: REJECTED_TEXT, dim: true }];   // upstream ignores the tool's text entirely: the row is always this literal
  const typed = summaryLines(event, normalized, options);
  if (typed !== undefined) return typed;
  const lines = withoutTrailingBlanks(normalized.outputLines);
  if (!lines.length) return [];
  if (normalized.status === "error") return errorBody(lines, options.projection, resolveThemeColor(themeTokens().error));
  return foldToolOutput(lines, options.columns, { projection: options.projection, compactRows: 3, revealOneExtraWithoutMarker: true });
}

// ── F3 Task 7: the Agent unit (LT16 / LT17) ────────────────────────────────────────────────────────────
/** The inner rows sit one step in from their agent, exactly as upstream's progress block does. Only the
 *  LINE items are indented — a result body already lives behind the five-column `⎿` gutter, which is deeper
 *  still, so the two-column header indent keeps the same header→body relationship a top-level row has. */
const AGENT_INDENT = "  ";
/** Bundle 429646: what a PARALLEL dispatch's `async_launched` sidecar renders as while its
 *  `task_notification` totals do not exist yet. Emphatically NOT a `Done (0 tool uses)` row — the agent has
 *  not finished, and its child frames arrive AFTER its result (P83 [Q4]), so the derived rung would be
 *  counting an empty list. */
const BACKGROUNDED_TEXT = "Backgrounded agent", BACKGROUNDED_HINT = " (↓ to manage · ctrl+o to expand)";
/** Bundle 429641, the OTHER launch surface: a cloud dispatch, with its identifiers dim behind a plain space. */
const CLOUD_LAUNCHED_TEXT = "Cloud agent launched";
const sidecarStatus = (event: ToolEvent): string | undefined => { const status = callSidecar(event)?.status; return typeof status === "string" ? status : undefined; };
/** The child rows, rendered through the SAME renderer as any other call (so a nested Read reads exactly as
 *  a top-level one) at the width the indent leaves them. `linesOnly` is the condensed progress form:
 *  upstream's running block shows what the agent is DOING, one row per call, not each result. */
function nestedItems(children: readonly ToolEvent[], options: ProjectionOptions, linesOnly: boolean): RenderItem[] {
  const condensed: ProjectionOptions = { ...options, columns: Math.max(options.columns - AGENT_INDENT.length, 10) };
  const items: RenderItem[] = [];
  for (const child of children)
    for (const item of renderToolEvent(child, normalizeToolResult(child, { verbose: options.verbose }), condensed)) {
      if (item.kind === "line") items.push({ ...item, line: indentRenderLine(item.line, AGENT_INDENT) });
      else if (!linesOnly) items.push(item);
    }
  return items;
}
/** EVERY row upstream `Vha` (429640–429654) paints is an `Rr height:1` block — `Rr` (bundle 239068023) is the
 *  very `⎿` gutter component a tool result body uses. That includes the `Done (…)` row, which wraps the
 *  synthetic assistant message with `shouldShowDot:!1`, i.e. the bullet is explicitly SUPPRESSED. (Census
 *  01#153 read that row as a `⏺` bulleted line; direct bundle read corrects it.) */
const agentGutter = (id: string, body: readonly RenderLine[]): RenderItem => ({ kind: "gutter-block", id, gutter: TOOL_RESULT_GUTTER, body });
const segmented = (segments: readonly Segment[]): RenderLine => ({ text: segments.map((segment) => segment.text).join(""), segments: [...segments] });
/** `Cloud agent launched` + a plain space + the dim `· {taskId} · {sessionUrl}` (429641). A field the sidecar
 *  did not carry is simply absent from the tail rather than printed as `undefined`. */
function cloudLaunchedLine(event: ToolEvent): RenderLine {
  const sidecar = callSidecar(event) ?? {};
  const tail = [sidecar.taskId, sidecar.sessionUrl].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (tail.length === 0) return { text: CLOUD_LAUNCHED_TEXT };
  return segmented([{ text: `${CLOUD_LAUNCHED_TEXT} ` }, { text: `· ${tail.join(" · ")}`, dim: true }]);
}
function agentProgressItems(event: ToolEvent, options: ProjectionOptions): readonly RenderItem[] {
  const children = agentChildren(options.toolEvents ?? [], event.id);
  // Upstream `KVp` (429822): nothing has come back yet, so the block is a placeholder, not an empty list.
  if (children.length === 0) return [agentGutter(`${event.id}:progress`, [{ text: AGENT_INITIALIZING, dim: true }])];
  const shown = children.slice(-AGENT_PROGRESS_ROWS), hidden = children.length - shown.length;
  const items = nestedItems(shown, options, /* linesOnly */ true);
  if (hidden > 0) items.push({ kind: "line", id: `${event.id}:progress-hidden`, line: indentRenderLine(hiddenToolUsesLine(hidden), AGENT_INDENT) });
  return items;
}
/** `undefined` means `Vha`'s `return null` (429649): a terminal shape it does not recognise paints NO typed
 *  row, and the caller falls through to the generic body. A derived rung with zero observed children is that
 *  same nothing — `Done (0 tool uses)` is a number we do not have, and Static would freeze the lie on screen. */
function agentTerminalItems(event: ToolEvent, options: ProjectionOptions): readonly RenderItem[] | undefined {
  const status = sidecarStatus(event);
  if (status === "remote_launched") return [agentGutter(`${event.id}:launched`, [cloudLaunchedLine(event)])];
  const children = agentChildren(options.toolEvents ?? [], event.id);
  const totals = agentTotals(event, options.agentMeta?.get(event.id), children, options.now);
  // The hint (`Ug`, 240583440) returns null inside the transcript/verbose contexts, so it is compact-only —
  // the same rule `foundRow` follows, and the detail projections ARE that verbose form (R6.3).
  const compact = options.projection === "compact";
  if (status === "async_launched" && totals.source === "derived")
    return [agentGutter(`${event.id}:launched`, [{ text: compact ? `${BACKGROUNDED_TEXT}${BACKGROUNDED_HINT}` : BACKGROUNDED_TEXT }])];
  if (totals.source === "derived" && children.length === 0) return undefined;
  const items: RenderItem[] = [agentGutter(`${event.id}:done`, [{ text: agentDoneText(totals) }])];
  // The hint is a SIBLING of the block, two literal spaces then `(ctrl+o to expand)` (429654).
  if (compact) return [...items, { kind: "line", id: `${event.id}:done-hint`, line: { text: `  ${EXPAND_HINT}`, dim: true } }];
  // What ctrl+o expands TO: the nested rows the compact unit folds away, with their own typed result rows.
  return [...items, ...nestedItems(children, options, /* linesOnly */ false)];
}

/** One retained call → its renderable items. A `suppressed` tool projects to nothing — driven by the status Task 1's
 *  normalizer assigns, never by a renderer-side name check, so the suppression list has exactly one home. */
export function renderToolEvent(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderItem[] {
  if (normalized.status === "suppressed") return [];
  const items: RenderItem[] = [{ kind: "line", id: `${event.id}:call`, line: headerLine(event, normalized.status, options), wrap: "truncate-end" }];
  // F3 Task 7 owns the Agent's two live surfaces (the progress rows and the Done row). Its OTHER statuses —
  // `error`, `interrupted`, `rejected` — are exact surfaces the generic body already paints, and so is a
  // terminal shape `Vha` does not recognise (`agentTerminalItems` returns `undefined` and we fall through).
  if (isAgentTool(event.name) && normalized.status === "running") return [...items, ...agentProgressItems(event, options)];
  if (isAgentTool(event.name) && normalized.status === "success") {
    const agent = agentTerminalItems(event, options);
    if (agent !== undefined) return [...items, ...agent];
  }
  const body = resultBody(event, normalized, options);
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
/** `part` is a free string since F3 Task 7: an Agent unit projects MORE than a header and a body (its Done
 *  row, its nested progress rows), and two items sharing an id would publish once into Static and lose the
 *  rest. `header`/`body` stay the names of the first two so every earlier id is byte-identical. */
export const toolItemId = (toolUseId: string, resultSequence: number | "pending", part: string): string => `tool:${toolUseId}:${resultSequence}:${part}`;
/** A fold group's identity is its MEMBERSHIP, with no sequence component: the member tool-use ids are already
 *  unique and stable, and a document that gains two replay dividers (which shift every later sequence) must
 *  still project the very same group id — that is what lets Static publish a settled group exactly once. */
export const toolGroupItemId = (memberIds: readonly string[], part: "row" | "pending-row" | "pending-hint" | "unclosed-row"): string => `group:${memberIds.join(",")}:${part}`;

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

/** Re-key one call's items onto its ANCHOR (the call id + the sequence it publishes at), which is what keeps
 *  the open and the finalized copies of the same row distinct. The first line is the header and the first
 *  gutter-block the body; anything beyond that (Task 7's Agent rows) takes its ORDINAL, because the id is
 *  Static's append-once key and a collision there silently drops a row. */
const reid = (items: readonly RenderItem[], id: string, sequence: number | "pending"): RenderItem[] =>
  items.map((item, index) => ({ ...item, id: toolItemId(id, sequence, index === 0 ? "header" : index === 1 && item.kind === "gutter-block" ? "body" : `part:${index}`) }));

// ── F1 Task 5c: the DEFAULT view's collapsed group row ──────────────────────────────────────────────────
// Task 5b's pure model decides WHAT a run collapses to; everything below decides how that reads on screen.
// Only `projection === "compact" && !verbose` folds — both detail projections (and therefore the Ctrl-O
// pager) keep the per-call `⏺ Read(a.ts)` rows, because those ARE upstream's ctrl+o verbose form (R6).
const EXPAND_HINT = "(ctrl+o to expand)";
/** Every segment on a group row is dim (R3.5 as corrected below), so the only remaining axis is colour:
 *  the settled clause run carries the row grey, the active one is dim-and-uncoloured like the golden's. */
const dimmed = (text: string, color?: string): Segment => ({ text, dim: true, ...(color === undefined ? {} : { color }) });
/** R3.3's row geometry. Settled: an EMPTY two-column box (so two literal spaces, no glyph and no colour —
 *  R3.4) then the whole dim text run. Active: `ile`'s single glyph BLINKING on a 600 ms period (glyph for one
 *  half, a bare space for the other — R4.1), then the present-participle clauses undimmed, the separate `…`,
 *  one literal space and the always-dim expand hint (R3.6). The blink is a pure phase function of
 *  `options.now`, exactly like the standalone header's, so the caller owns the clock and a test can pin any
 *  frame. No elapsed `· Ns` suffix: its anchor `Re` is computed only `if (s && ds())` (R4.10), so a default
 *  transcript has none, and the bash progress suffix beside it is gated the same way (R4.6) — a substitute
 *  for either would be a fabrication, not fidelity. That gating does NOT extend to the 700 ms hint debounce,
 *  which F1 lumped in with them here and which F3 Task 4 corrects: `de = e8p(te, MAH)` sits in the ungated
 *  hint chain (R4.7 step 4), as does the thinking summary's `DAH` linger (step 5). Both are implemented in
 *  `foldPendingState.ts` and reach this module through `ProjectionOptions.pending`.
 *
 *  TASK 7 CORRECTIONS. Evidence: the tracked 2.1.220 golden `f1-tool-rendering/01-read-complete.ansi`, an
 *  ACTIVE single-read frame whose per-cell attributes the pyte capture reconstructs exactly. Where the
 *  shipping binary contradicts the static reading, the binary wins (theme.ts's doctrine) — so both of these
 *  are adopted here and noted in the contract rather than explained away:
 *    · R4.2's "dimColor with NO color" is wrong: the active leader glyph is dim AND `#999999` (our
 *      `inactive` token), and so is the `(ctrl+o to expand)` hint. Only the GLYPH cell is coloured — the
 *      space after it is dim and uncoloured — which is why the leader is two segments rather than one. The
 *      hint is one component on both rows (R3.6), so its colour is the same settled.
 *    · R3.5's `dimColor={!isActive}` has its polarity backwards for the active row: the golden's " Reading "
 *      and its bold count are BOTH dim. The active run is therefore dim here too, which cuts that row's
 *      divergence from the golden from eleven cells to six.
 *  F3 TASK 2 SUPERSEDES the last of those six (spec Decision Log 2026-08-04). Task 7 left the clause run as
 *  ordinary styled segments and recorded the golden's PLAIN " file…" tail as an upstream artifact we would
 *  not reproduce — and with it the count's boldness, which `<Text dimColor bold>` silently drops. Both are
 *  now fixed at once: the whole clause run (including the active `…`) is ONE `preStyled` segment carrying
 *  upstream's exact bytes from `composeFoldRun` — dim open, `\x1b[1m{count}\x1b[22m` per count, and NO dim
 *  re-open afterwards, because upstream's nested `<Text bold>` closes with a `\x1b[22m` that clears faint
 *  too. The leader glyph, the joining space and the expand hint stay ordinary segments: the golden paints
 *  each with its own attributes, which is exactly what sibling `<Text>`s produce.
 *  SETTLED-ROW GREY, pinned 2026-08-03 (Task 7 closeout, render contract § 0). A dedicated settled-state
 *  probe against installed 2.1.220 under the tracked capture environment shows the settled row rendering
 *  `#999999` — the SAME grey as this frame's active row. The `#949494` the live-confirmation note first
 *  recorded was the ambient-palette variant of that probe's environment (`COLORFGBG` present), not a second
 *  upstream colour. So the settled clause run carries `inactive` too. The active clause run stays
 *  dim-and-uncoloured: the golden paints `" Reading "` as a bare `\x1b[0;2m` run, and only the leader glyph
 *  and the expand hint carry the colour explicitly. */
function groupRowLine(counts: GroupCounts, active: boolean, options: ProjectionOptions): RenderLine {
  const grey = resolveThemeColor(themeTokens().inactive);
  const leader: Segment[] = active
    ? [{ text: Math.floor(options.now / 600) % 2 === 0 ? (options.platform === "darwin" ? "⏺" : "●") : " ", dim: true, color: grey }, { text: " ", dim: true }]
    : [{ text: "  " }];
  const run = composeFoldRun(foldClauses(counts, active), active ? "active" : "settled", { ellipsis: active });
  const segments: Segment[] = [...leader, { text: run, preStyled: true }, dimmed(" "), { text: EXPAND_HINT, dim: true, color: grey }];
  // `run` is the ONE segment whose `text` carries SGR bytes, so the line's plain text is stripped rather
  // than joined raw — width math, the pager and every text assertion must still see the bare sentence.
  return { text: segments.map((segment) => (segment.preStyled === true ? stripSgr(segment.text) : segment.text)).join(""), segments };
}
/** The three lives of one group row. `published` is the immutable Static row; `active` and `unclosed` are the
 *  DYNAMIC region's two forms of a run Static cannot have yet — active while a member is still running,
 *  settled (geometrically identical to `published`) once they have all completed but no breaker has closed the
 *  run. `unclosed` therefore carries its own id part: the dynamic copy and the eventual published copy are the
 *  same text, and a shared id would collide in Static's append-once bookkeeping the moment the run closes. */
type GroupForm = "published" | "active" | "unclosed";
const GROUP_PART = { published: "row", active: "pending-row", unclosed: "unclosed-row" } as const;
/** Upstream `OAH` (L428105–428120), the thinking summary's own clamp. Below the limit it returns the text
 *  UNTOUCHED — the `<Text>` that renders it wraps it — and only an over-long one is folded into a single
 *  whitespace-collapsed row shrunk until `text + "…"` fits `r` wrapped lines. The shrink walks whole code
 *  points (upstream's `codePointAt(len-2) > 65535` surrogate check, kept verbatim) so it can never split an
 *  astral character. `t < 1` clamps nothing: a width that small has no meaningful wrap. */
export function clampHintText(text: string, width: number, maxLines: number): string {
  if (width < 1) return text;
  const rows = (value: string) => wrapAnsi(value, width, { trim: false, hard: true }).split("\n").length;
  if (rows(text) <= maxLines) return text;
  let head = wrapAnsi(text, width, { trim: false, hard: true }).split("\n").slice(0, maxLines).join("").replace(/\s+/g, " ").trim();
  while (head.length > 0 && rows(`${head}…`) > maxLines) {
    const previous = head.length > 1 ? head.codePointAt(head.length - 2) : undefined;
    head = head.slice(0, previous !== undefined && previous > 0xffff ? -2 : -1);
  }
  return `${head.trimEnd()}…`;
}
/** R3.1's early exit: a run whose clauses all came out empty renders NOTHING at all. */
function groupItems(group: FoldGroup, form: GroupForm, options: ProjectionOptions): readonly RenderItem[] {
  const active = form === "active";
  // R3.2's ratchet: the DYNAMIC forms latch (write the max), and the PUBLISHED form PEEKS the same maximum
  // without writing — upstream's ratchet assignment is unconditional across renders of the mounted row
  // (task-4 review, `Ima` L427896), so the on-screen row must not downgrade when the run settles; but a
  // replay sweep must not CREATE latch entries for history, and a never-latched anchor peeks back its own
  // counts, which is upstream's fresh-mount recompute. R4.7's hint resolution stays dynamic-only. The
  // anchor is the run's FIRST member id — memberIds grow as the run grows, so nothing else is stable.
  const anchorId = group.memberIds[0];
  const pending = anchorId === undefined ? undefined : options.pending;
  const counts = pending === undefined || anchorId === undefined ? group.counts
    : form === "published" ? pending.peek(anchorId, group.counts) : pending.latch(anchorId, group.counts);
  if (foldClauses(counts, active).length === 0) return [];
  const id = toolGroupItemId(group.memberIds, GROUP_PART[form]);
  const items: RenderItem[] = [{ kind: "line", id, line: groupRowLine(counts, active, options) }];
  // R3.7: the hint gutter is ACTIVE-ONLY — `latestDisplayHint` rides on the settled message but never renders.
  if (active) {
    const hint = pending === undefined || anchorId === undefined
      ? (group.hint === undefined ? undefined : { text: group.hint, italic: false })
      : pending.hint(anchorId, group.hint, group.latestThinkingSummary);
    if (hint !== undefined) {
      const grey = resolveThemeColor(themeTokens().inactive);
      // R4.7 step 5: the summary variant is dim + ITALIC and pre-clamped by `OAH(text, columns − X8o, PAH)`;
      // the ordinary hint (step 6) is neither clamped nor italic, just split on its own newlines.
      const text = hint.italic ? clampHintText(hint.text, options.columns - GROUP_HINT_GUTTER.length, HINT_MAX_LINES) : hint.text;
      const body = text.split("\n").map((line) => ({ text: line, dim: true, color: grey, ...(hint.italic ? { italic: true } : {}) }));
      items.push({ kind: "gutter-block", id: toolGroupItemId(group.memberIds, "pending-hint"), gutter: GROUP_HINT_GUTTER, gutterStyle: { color: grey, dim: true }, body });
    }
  }
  return items;
}

/** The append-only linearization rule. An open header is transient at `callSequence`; the immutable
 *  finalized header-plus-result unit is anchored at `resultSequence`, while a local visual publishes at its
 *  own sequence immediately — so a `/help` that lands between a call and its result enters Static first and
 *  the finalized tool unit follows it. Rank breaks the one real tie: the user message carrying a
 *  `tool_result` shares its sequence with the unit that result completes. */
/** `identity`/`thinking` are the F3 thinking clock's two document-derived halves, computed once in
 *  `buildAnchoredEntries` (both are pure functions of the retained message, so they are cache-safe — the
 *  live DURATION is not, and enters strictly later, in `foldAtoms`). `thinking` doubles as upstream
 *  `Ae_`'s predicate: it is set only for a message whose FIRST content block is non-blank thinking. */
type Anchored = { sequence: number; rank: number; items: readonly RenderItem[]; atom?: "breaker" | "neutral"; event?: ToolEvent; identity?: string; thinking?: string };
/** The sentinels upstream renders in place of a reply: they are chatter, never the "real assistant text" that
 *  ends a run (§1.3). */
const SENTINEL_TEXT = new Set(["(no content)", "No response requested."]);
/** Which fold atom a retained entry is. A local visual and a user prompt always break a run; an assistant
 *  message breaks it only when it rendered something that is not purely thinking or a sentinel — so the
 *  ubiquitous `[thinking, tool_use]` message is NEUTRAL and stays inside the run it belongs to, and a user
 *  message carrying only a `tool_result` (which renders nothing of its own) is neutral too. */
function entryAtom(entry: TranscriptEntry, items: readonly RenderItem[]): "breaker" | "neutral" {
  if (entry.kind === "local-event") return "breaker";
  if (items.length === 0) return "neutral";
  const inner = entry.message.message, content = isRecord(inner) && Array.isArray(inner.content) ? inner.content : [];
  const rendered = content.filter((block) => isRecord(block) && block.type !== "tool_use" && block.type !== "tool_result");
  const real = rendered.some((block) => {
    const b = block as Record<string, unknown>;
    if (b.type === "thinking") return false;
    return !(typeof b.text === "string" && SENTINEL_TEXT.has(b.text.trim()));
  });
  return real ? "breaker" : "neutral";
}

/** The sdk message's OWN identity, `message:<message.id>` — deliberately not `entry.identity`, which
 *  prefers the frame `uuid` when one is present (transcriptModel's `identityOf`) and so would never match
 *  a clock keyed by the API message id every partial frame carries. A NESTED (subagent) message is
 *  excluded: its blocks belong to its own turn, and letting its id key a duration would attach a
 *  subagent's thinking to the parent's run. */
function sdkMessageIdentity(message: Record<string, unknown>): string | undefined {
  if (message.type !== "assistant" || isNested(message)) return undefined;
  const inner = message.message, id = isRecord(inner) ? inner.id : undefined;
  return typeof id === "string" && id.length > 0 ? `message:${id}` : undefined;
}
/** Upstream `Ae_` (L302003–302010): a message is thought-bearing only when its FIRST content block is a
 *  `thinking` block whose text is not blank. The summary is that block's WHOLE text, whitespace-collapsed —
 *  upstream `PMd` L302267 assigns exactly `u.text.trim().replace(/\s+/g, " ")`. (F3 Task 3 shipped the first
 *  line only, a plan error corrected here in Task 4: the first line leaves upstream's 10-line `OAH` clamp
 *  with nothing to do, and it is the clamp — not the extraction — that decides how much of a long thought
 *  the hint slot shows.) */
function thinkingSummaryOf(message: Record<string, unknown>): string | undefined {
  const inner = message.message, content = isRecord(inner) && Array.isArray(inner.content) ? inner.content : [];
  const first = content[0];
  if (!isRecord(first) || first.type !== "thinking" || typeof first.thinking !== "string") return undefined;
  const text = first.thinking.trim();
  return text === "" ? undefined : text.replace(/\s+/g, " ");
}

function buildAnchoredEntries(document: TranscriptDocument, options: ProjectionOptions): Anchored[] {
  const anchored: Anchored[] = [];
  const occurrences = new Map<string, number>();
  for (const entry of document.entries()) {
    if (entry.kind === "local-event") { anchored.push({ sequence: entry.sequence, rank: 0, items: projectLocalEvent(entry), atom: "breaker" }); continue; }
    const key = entry.identity ?? hashMessage(entry.message);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const items = projectMessageEntry(entry, options, entry.identity ?? `${key}:${occurrence}`);
    const identity = sdkMessageIdentity(entry.message), thinking = identity === undefined ? undefined : thinkingSummaryOf(entry.message);
    anchored.push({
      sequence: entry.sequence, rank: 0, items, atom: entryAtom(entry, items),
      ...(identity === undefined || thinking === undefined ? {} : { identity, thinking }),
    });
  }
  return anchored;
}

/** The blink repaint (`useChat` re-projects the transient region every 600 ms while a tool is open) calls
 *  `projectPending`, which folds the WHOLE anchored stream — so without a cache every frame re-renders every
 *  retained message, markdown and all, and a long resumed/attached transcript pays that per blink.
 *
 *  The stream is cacheable because its inputs are the DOCUMENT plus the LIVE THEME, and nothing else —
 *  verified, not assumed: `projectLocalEvent` takes no options at all, and `projectMessageEntry` `void`s
 *  them, its one renderer (`renderMessage`) being a single-argument function of the message. Nothing here
 *  reads cwd, home, platform, columns, now, verbose or projection; those enter strictly LATER, in
 *  `renderToolEvent`, `groupItems` and `segmentRuns`, all of which stay uncached.
 *
 *  The theme is the second input because `renderMessage` → markdown/highlight resolve theme tokens PER CALL
 *  (deliberately: a setTheme() must color the very next render — render.ts:47). A setTheme() touches no
 *  document, so `revision()` alone would serve the old palette out of cache; the key is therefore
 *  `revision()` × `themeGeneration()`, and a hit requires BOTH unchanged. (Every theme-changing UI path
 *  today also appends a local notice, which bumps the revision — but that is an incidental coincidence, not
 *  something the cache may lean on, so the theme dependency is named here rather than assumed away.)
 *
 *  Keyed by document in a WeakMap, so a replaced document (rewind, resume) drops its entry with itself. The
 *  cached array is copied out because callers own their list — `projectAll`/`projectPending` push tool anchors
 *  onto it and sort it in place — while the `Anchored` records inside it are never mutated and are shared. */
const anchoredCache = new WeakMap<TranscriptDocument, { revision: number; theme: number; anchored: readonly Anchored[] }>();
/** DI-by-deps test seam: the builder is reached through this record, so a test can count rebuilds without
 *  reading the cache itself. Production never reassigns it. */
export const projectionDeps = { buildAnchored: buildAnchoredEntries };

function anchoredEntries(document: TranscriptDocument, options: ProjectionOptions): Anchored[] {
  const revision = document.revision(), theme = themeGeneration();
  const hit = anchoredCache.get(document);
  if (hit !== undefined && hit.revision === revision && hit.theme === theme) return [...hit.anchored];
  const anchored = projectionDeps.buildAnchored(document, options);
  anchoredCache.set(document, { revision, theme, anchored });
  return [...anchored];
}

const bySequence = (a: Anchored, b: Anchored) => a.sequence - b.sequence || a.rank - b.rank;

function projectAll(document: TranscriptDocument, options: ProjectionOptions): readonly RenderItem[] {
  // The nested calls travel WITH the options (Task 7): an Agent's rows are derived from the document's other
  // events, and injecting them here keeps `renderToolEvent` a pure function of one call plus its context.
  const full: ProjectionOptions = { ...options, toolEvents: document.toolEvents() };
  const anchored = anchoredEntries(document, full);
  for (const event of document.toolEvents()) {
    if (event.route !== "top-level" || !event.result) continue;
    anchored.push({ sequence: event.result.resultSequence, rank: 1, event, items: reid(renderToolEvent(event, normalizeToolResult(event, { verbose: full.verbose }), full), event.id, event.result.resultSequence) });
  }
  anchored.sort(bySequence);
  return full.projection === "compact" && !full.verbose ? foldAnchored(anchored, full) : anchored.flatMap((a) => a.items);
}

/** The one atom builder both folded projections share. A tool anchor is a `tool` atom — EXCEPT for the tools
 *  we project to nothing (`isSuppressedTool`: ToolSearch/TaskCreate/TaskUpdate), which become `neutral` and so
 *  JOIN the run they interrupt without earning a counter, exactly like upstream's absorbed-silently branch
 *  (contract §1.2 accumulator row 4: "no counter at all — message still joins the group").
 *  DELIBERATE DEVIATION from default-mode upstream: that branch is `ds()`-gated (§1.1 case 4), so a
 *  default-mode 2.1.220 falls through to case 6 and renders `⏺ ToolSearch(…)` STANDALONE, which legitimately
 *  breaks the run. We render no row for those calls at all, so treating them as a break would split one
 *  summary into two adjacent rows with an invisible seam between them — a bug on screen, not fidelity.
 *  `inert` is the second reason an anchor stops being a tool: a call the compact projection has already
 *  PUBLISHED must not re-enter the dynamic region's fold (see `projectPending`). */
function foldAtoms(anchored: readonly Anchored[], thoughtMs?: ReadonlyMap<string, number>, inert?: (event: ToolEvent) => boolean): FoldAtom[] {
  // One duration per MESSAGE, spent once. The engine emits one assistant frame per content block and all
  // of them share a single `message.id` (P82), while `LiveTurn` already sums every thinking block of that
  // id — so a message that arrived as two thinking frames would otherwise stamp its whole total twice.
  const spent = new Set<string>();
  return anchored.map((a, index): FoldAtom => {
    if (a.event !== undefined && !isSuppressedTool(a.event.name) && !(inert?.(a.event) ?? false)) return { kind: "tool", event: a.event };
    if (a.atom === "breaker") return { kind: "breaker", sequence: index };
    // The thinking clock's one gate: a thought-bearing message (`a.thinking`) the caller's LIVE map has a
    // duration for. A disk-bootstrapped, replayed or attached entry is never in that map, so it earns no
    // clause without a single replay-side branch.
    const ms = a.identity === undefined || a.thinking === undefined || spent.has(a.identity) ? undefined : thoughtMs?.get(a.identity);
    if (ms !== undefined) spent.add(a.identity!);
    return { kind: "neutral", sequence: index, ...(ms === undefined ? {} : { thoughtForMs: ms, thinkingSummary: a.thinking }) };
  });
}

/** The trailing run is the one accumulator `segmentRuns` flushes at the very end, and it is still GROWABLE:
 *  the next collapsible call joins it and would change its counts, its clause text and its membership-derived
 *  id. Ink's `<Static>` is append-only, so publishing it now and re-publishing it later would leave BOTH rows
 *  on screen — it (and the neutral items it deferred, which `segmentRuns` replays straight after it) must
 *  wait for the prose or standalone tool that closes the run. Until then `projectPending` carries the row in
 *  the DYNAMIC region — active while a member is still running, settled once they all are — so "withheld from
 *  Static" never means "invisible". */
function trailingRunCut(atoms: readonly FoldAtom[], items: readonly { kind: string }[]): number {
  let growing = false;
  for (const atom of atoms) {
    if (atom.kind === "neutral") continue;
    growing = atom.kind === "tool" && classifyToolEvent(atom.event).collapsible;
  }
  if (!growing) return items.length;
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.kind === "group") return i;
  return items.length;
}

/** Compact-only (R6.1's inverse): the sorted anchor list becomes a fold-atom stream — index-keyed so a
 *  `passthrough` maps straight back to the entry's already-projected items — and `segmentRuns` decides which
 *  contiguous runs collapse. */
function foldAnchored(anchored: readonly Anchored[], options: ProjectionOptions): readonly RenderItem[] {
  const atoms = foldAtoms(anchored, options.thoughtMs);
  const standalone = new Map<ToolEvent, readonly RenderItem[]>(anchored.flatMap((a) => (a.event ? [[a.event, a.items] as const] : [])));
  const folded = segmentRuns(atoms, { cwd: options.cwd, home: options.home });
  const out: RenderItem[] = [];
  for (const item of folded.slice(0, trailingRunCut(atoms, folded))) {
    if (item.kind === "group") { out.push(...groupItems(item.group, "published", options)); continue; }
    if (item.kind === "passthrough") { out.push(...(anchored[item.sequence]?.items ?? [])); continue; }
    out.push(...(standalone.get(item.event) ?? []));
  }
  return out;
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
/** EVERYTHING the compact projection cannot publish yet, which is exactly two things: an open top-level call
 *  (selected by `!event.result` — NEVER by `status === "running"`, because a suppressed bookkeeping call is
 *  `suppressed` while still open and would leak in here), and the trailing fold run `trailingRunCut` withholds
 *  from Static while it is still growable. `liveIds`, when given, keeps only the OPEN calls a live turn is
 *  actually running (useChat's rule: a disk-bootstrapped dangling call is retained history, not something that
 *  blinks) — a completed call is never filtered, since the run it belongs to is what this region draws.
 *
 *  The run is folded over the WHOLE anchored stream, not just the open calls, so one contiguous run is one row
 *  through its entire life: ACTIVE (blinking glyph, participle, `…`, the `⎿` hint) while any member is still
 *  running, then the settled row — same geometry as the published one, its own id — the moment the last member
 *  completes, and gone the render a breaker publishes it. Closure comes ONLY from a breaker (the next user
 *  prompt is always one); there is no timer anywhere in this path.
 *
 *  A group the compact projection has ALREADY published must not reappear here, so its members are made inert
 *  (`published`) before this stream is folded: they stop being tool atoms without becoming run boundaries, and
 *  a still-open member of that same run folds on alone — which is what keeps a live row on screen without
 *  double-counting the members Static already shows. */
export function projectPending(document: TranscriptDocument, options: ProjectionContext, liveIds?: ReadonlySet<string>): readonly RenderItem[] {
  const full: ProjectionOptions = { ...options, projection: "compact", verbose: false, toolEvents: document.toolEvents() };
  const anchored = anchoredEntries(document, full);
  for (const event of document.toolEvents()) {
    if (event.route !== "top-level") continue;
    // No `items` for either kind: this region renders group rows and per-call PENDING rows, both built below.
    if (event.result) { anchored.push({ sequence: event.result.resultSequence, rank: 1, event, items: [] }); continue; }
    if (liveIds === undefined || liveIds.has(event.id)) anchored.push({ sequence: event.callSequence, rank: 1, event, items: [] });
  }
  anchored.sort(bySequence);
  const fold = { cwd: options.cwd, home: options.home };
  // What Static already holds: the same fold the compact projection runs (open calls inert there, exactly as
  // `projectAll` omits them), minus the trailing run it withholds.
  const settledAtoms = foldAtoms(anchored, options.thoughtMs, (event) => !event.result);
  const settled = segmentRuns(settledAtoms, fold);
  const published = new Set<string>();
  for (const item of settled.slice(0, trailingRunCut(settledAtoms, settled)))
    if (item.kind === "group") for (const id of item.group.memberIds) published.add(id);
  const items: RenderItem[] = [];
  for (const item of segmentRuns(foldAtoms(anchored, options.thoughtMs, (event) => published.has(event.id)), fold)) {
    if (item.kind === "group") { items.push(...groupItems(item.group, item.group.open ? "active" : "unclosed", full)); continue; }
    // A COMPLETED standalone tool is already published (only groups are ever withheld); only an open one has a row here.
    if (item.kind === "tool" && !item.event.result) items.push(...reid(renderToolEvent(item.event, normalizeToolResult(item.event, { verbose: false }), full), item.event.id, "pending"));
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
      <Box width={item.gutter.length}><Text color={item.gutterStyle?.color} dimColor={item.gutterStyle?.dim}>{showGutter ? item.gutter : ""}</Text></Box>
      <Box flexDirection="column">{body.map((line, i) => <Line key={i} l={line} />)}</Box>
    </Box>
  );
}
