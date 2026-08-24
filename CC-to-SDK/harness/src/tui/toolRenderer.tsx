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
import React, { useContext } from "react";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Box, Text } from "ink";
import wrapAnsi from "wrap-ansi";
import type { RenderLine, Segment } from "./render.js";
import { renderMessage } from "./render.js";
import { classifyUserText, compactSummaryLines, COMPACT_SUMMARY_SPECIES, SYSTEM_INFO_SPECIES, INTERRUPT_CANCELLED, INTERRUPT_PLAIN, INTERRUPT_TOOL, PLAN_REJECTED_TEXT, TOOL_RESULT_GUTTER, teammateCollapsedLine, teammateLifecycleLine, teammateMessageLines, type TeammateIdleReason } from "./species.js";
import { displayPath } from "./paths.js";
import { formatDuration } from "./format.js";
import { Line, type LineSelection } from "./Line.js";
import { resolveThemeColor, subagentColor, SUBAGENT_TOKEN_NAMES, themeGeneration, themeTokens } from "./theme.js";
import { bashArgument, callSidecar, isSuppressedTool, normalizeToolResult, sedInPlaceTarget, type NormalizedToolResult, type ToolStatus } from "./toolResult.js";
import { classifyToolEvent, foldClauses, segmentRuns, type FoldAtom, type FoldGroup, type FoldPolicy, type GroupCounts } from "./toolFold.js";
import { foldHint, foldToolOutput, foldWithTruncation, withoutTrailingBlanks, type ResultProjection } from "./outputFold.js";
import { hintWithoutParens, resolveExpandHint } from "./keys/hints.js";
import { summaryLines } from "./toolSummaries.js";
import { agentBatches, agentBatchHeader, agentBatchTotalsText, agentBatchView, agentChildren, agentDoneText, agentMetaGeneration, agentSubagentType, agentTotals, AGENT_BATCH_DONE, AGENT_INITIALIZING, AGENT_MANAGE_HINT, AGENT_PROGRESS_ROWS, hiddenToolUsesLine, indentRenderLine, isAgentTool, type AgentBatch, type AgentBatchMember, type AgentMeta } from "./agentProgress.js";
import type { FoldPendingHooks } from "./foldPendingState.js";
import { composeFoldRun, stripSgr } from "./sgrFoldRow.js";
import { HoverContext } from "./mouse/hoverContext.js";
import { osc8Open, OSC8_CLOSE } from "./osc8.js";
import type { ToolEvent, TranscriptDocument, TranscriptEntry } from "./transcriptModel.js";

/** Five columns, and the FIFTH is U+00A0: upstream emits `["  ", "⎿ \xA0"]` so the cell after the connector is not a
 *  break opportunity and no terminal (or trailing-space trim) can eat it. Written with the escape so no editor can
 *  normalize it back to a plain space. F4 Task 10a MOVED the definition into `species.ts` (`Cr` L406895 is the
 *  connector both a tool result and the new standalone interrupt row wear) so that pure module \u2014 which
 *  `sessions/rows.ts` imports \u2014 can use it without pulling React into its graph. Re-exported here unchanged,
 *  so every existing importer and the `RenderItem` union below are untouched. */
export { TOOL_RESULT_GUTTER };
/** The ACTIVE group row's own hint gutter (R4.6, `X8o = 5`): 2 spaces, the connector, 2 PLAIN spaces. Upstream
 *  keeps it distinct from the tool-result gutter above (which ends in the NBSP); both are exactly five columns. */
export const GROUP_HINT_GUTTER = "  \u23bf  " as const;
/** Upstream `PAH` (L428157): the thinking summary's hint body is clamped to this many rendered lines. */
const HINT_MAX_LINES = 10;
/** `wrap` is set ONLY by the tool header (LT10: upstream's `wrap:"truncate-end"` — an MCP-length name must
 *  never wrap one header into several transcript rows). Every other line item leaves it unset and wraps
 *  normally, which is what keeps ordinary assistant text and local notices readable now that Task 4 routes
 *  the WHOLE transcript through `RenderItemView`.
 *
 *  `foldAnchor` (tool-stream Task 8) is WHICH CLUSTER A ROW BELONGS TO — the fold run's anchor id, i.e.
 *  `FoldGroup.anchorId`. It is on BOTH arms because a cluster projects to both: the collapsed fold row and its
 *  active hint block wear it, and so does every item an EXPANDED cluster's members render. A later task
 *  builds the painted-row map from it and turns a tap on any of those rows into `toggleFold(anchor)`, which
 *  is why the tag names the ANCHOR rather than the group's item id: the item id is derived from the whole
 *  membership, so it changes every time the run absorbs another call AND every time settlement reorders it,
 *  while the anchor — the earliest-issued call — never moves.
 *  Absent on everything else, and absent is not a cluster. It must survive `wrapItems` (a hit test reads
 *  PAINTED rows, not projected items) — see `wrapOne`, where three of the four paths carried it for free.
 *
 *  `expanded` (F9 T-MOUSE Task 3, review Critical fix) is set true on every item `expandedMemberItems` below
 *  produces — an OPENED cluster's own re-rendered members, as opposed to the single collapsed summary row
 *  `groupItems` emits for the same `foldAnchor` while closed (the two never coexist for one anchor). Canon's
 *  hover provider is `hovered && !expanded` (bundle L562783): an already-expanded member must not un-dim on
 *  hover, and `foldAnchor` alone cannot say which case a row is in, since both wear it. Like `foldAnchor` it
 *  must survive `wrapItems` — it does, for the same reason: every `wrapOne` arm spreads the source item.
 *    T-CLICKGATE Task 3 reuses this SAME field for the other affordance the flag's name already covers: a
 *  tool-result owner the reader clicked open (`toolEventItems`, keyed on `options.expandedItems`) tags BOTH
 *  its header and its result `expanded: true`, so the one hover-suppression term above needs no widening of
 *  its own to cover the new case — the field means "this item's own hover is settled by something other than
 *  the pointer" regardless of which affordance opened it.
 *
 *  `ownerKey` (F10 T-HOVER, H1) is the HOVER unit — coarser than `id` on purpose. Canon's hover unit is one
 *  whole SDK message (`K6w` L562778-562784, one `hoveredKey` at L563004), not the per-line/per-call identity
 *  `id` mints; a hover consumer compares `ownerKey ?? sourceId(id)` (`mouse/hitmap.ts`'s `HitRow.ownerKey`).
 *  OPTIONAL AT THE TYPE LEVEL ONLY — a type-level accommodation for a non-transcript caller (a dialog, the
 *  markdown renderer, PlanDialog) that legitimately IS its own hover unit, never a rollout license for a
 *  transcript producer: `test/tui/hover-owner.test.tsx`'s producer matrix fails a transcript producer that
 *  omits it, not just a typecheck. Like `foldAnchor`/`expanded` it must survive `wrapItems` — it does, for
 *  the same reason: every `wrapOne` arm spreads the source item.
 *
 *  `clickable` (T-CLICKGATE Task 1) is canon's click-to-expand predicate, minted ONLY on the tool-result
 *  gutter block `toolEventItems` builds from `resultBody`: true for an ERROR result whose body physically
 *  exceeds `errorBody`'s ten-row clip, or a non-error result that WOULD fold under the COMPACT projection
 *  (`resultBody`'s `wouldFoldUnderCompact`) — computed AS IF COMPACT regardless of the projection actually
 *  being rendered, so an item re-projected to `detail-all` (unbounded, folds nothing) does not lose the bit.
 *  Every other row — a fold-group's own collapsed row or its active hint block, plain assistant/thinking/user
 *  text, and the `interrupted`/`rejected`/`running`/`suppressed` result surfaces — never carries it; absent
 *  means "not clickable", the same way `foldAnchor`'s absence means "not a cluster". A later task projects
 *  this bit into the mouse hitmap, so like `foldAnchor`/`expanded` it must survive `wrapItems` — it does, for
 *  the same reason: every `wrapOne` arm spreads the source item. */
export type RenderItem =
  | { kind: "line"; id: string; ownerKey?: string; line: RenderLine; wrap?: "truncate-end"; foldAnchor?: string; expanded?: boolean; clickable?: boolean }
  // `gutterStyle` styles the CONNECTOR cells themselves (the five-column sibling Box), which is otherwise
  // plain text. Only the active group's hint gutter uses it today: the tracked 2.1.220 golden renders
  // `  ⎿  src/app.ts` as ONE dim `#999999` run across connector and path alike, with no artifact in it.
  | { kind: "gutter-block"; id: string; ownerKey?: string; gutter: typeof TOOL_RESULT_GUTTER | typeof GROUP_HINT_GUTTER; body: readonly RenderLine[]; gutterStyle?: { color?: string; dim?: boolean }; foldAnchor?: string; expanded?: boolean; clickable?: boolean };
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
/** `bashHint` (F3 Task 9, LT20) is the RESOLVED background-hint sentence — `keys/hints.ts`'s
 *  `backgroundHintText` applied to the live binding table and the live `$TMUX`. It arrives pre-composed for
 *  the same reason `thoughtMs` does: this projection is pure, and reading a React keymap context (or
 *  `process.env`) from inside it would make a row depend on where it was rendered. `undefined` means the
 *  caller found `task:background` unbound — and then there is no row at all, never `(unbound)`. */
/** `expandHint` (F4 Task 10b) is the SAME mechanism for the other derived sentence — `(ctrl+o to expand)`, the
 *  offer every folded surface in this file makes. Pre-composed for the same reason `bashHint` is. Its three
 *  states are upstream `pA`'s own (see `keys/hints.ts`): ABSENT = no keymap was in scope, so `pA`'s literal
 *  `ctrl+o` fallback stands (which is what every caller and test that predates this task keeps getting,
 *  unchanged); a STRING = the user's resolved chord; EMPTY = `app:toggleTranscript` is unbound, and then every
 *  site drops its clause rather than advertising a dead chord. */
/** `fullscreen` (tool-stream Task 5) is WHICH RENDERER IS PAINTING, and it is the fold policy's only input from
 *  outside the document — canon's own `Ns()` predicate, consulted inside rendering policy rather than at boot
 *  (2.1.234:107162). Absent/false is the classic renderer, frozen byte-identically at what it shipped; true opens
 *  Task 3/4's widenings (non-read shell calls collapse, TaskCreate/TaskUpdate/ToolSearch are absorbed silently,
 *  and the git + shell clauses join the sentence). Threaded as data rather than read from an environment for the
 *  same reason `bashHint`/`expandHint` are: a row must not depend on where it was rendered.
 *    IT DOES NOT BLANK THE `(ctrl+o to expand)` CHIP. That is `expandHint: ""`, a SEPARATE channel — canon's is
 *  separate too (the chip dies in the `Ett` context the virtual list provides, 506706/549824, whose consumer `Wv`
 *  returns null outright at 511132, while the policy takes `Ns()`). `useChat.projectionContext()` is where the
 *  two are set together; a projection handed only this flag still prints the chip, and that is correct. */
/** `expandedFolds` (tool-stream Task 8) is WHICH CLUSTERS ARE OPEN, keyed by anchor id (`FoldGroup.anchorId`).
 *  Display state, not document state — nothing on the wire or on disk says a cluster was expanded — so it
 *  is a projection INPUT exactly as `thoughtMs`/`agentMeta` are, held in `useChat` and cleared at the
 *  conversation boundary. Absent (the common case, and every caller that predates this task) is all-closed.
 *  It is deliberately NOT part of `knobKey`: like `fullscreen`, what it changes is the FOLD, which runs
 *  strictly downstream of the anchored-entry cache. */
/** `expandedItems` (T-CLICKGATE Task 3) is WHICH TOOL-RESULT OWNERS THE READER HAS CLICKED OPEN, keyed by
 *  `toolOwnerKey(event.id)` — a SEPARATE namespace from `expandedFolds` above (a fold cluster and a single
 *  clickable result are different affordances with different keys: an anchor names a RUN, an owner names one
 *  CALL). Display state, not document state, for the identical reason `expandedFolds` is: nothing on the wire
 *  or on disk says a result was expanded, so it lives beside it in `useChat`, threaded here as a projection
 *  INPUT, and is cleared at the same two boundaries (a renderer flip, a rebuilt transcript) for the same
 *  reason — a rebuilt document reuses the same tool-use ids, and an expansion left standing would open an
 *  unrelated call on sight. */
export interface ProjectionOptions { cwd: string; home: string; platform: NodeJS.Platform; columns: number; projection: ResultProjection; now: number; verbose: boolean; thoughtMs?: ReadonlyMap<string, number>; pending?: FoldPendingHooks; agentMeta?: ReadonlyMap<string, AgentMeta>; toolEvents?: readonly ToolEvent[]; bashHint?: string; expandHint?: string; fullscreen?: boolean; expandedFolds?: ReadonlySet<string>; expandedItems?: ReadonlySet<string>; }
/** THE ONE WAY the renderer identity reaches the pure fold policy, and the reason it is a named helper rather
 *  than an inline object literal at each of the seven call sites: "did that site get the flag?" becomes a grep
 *  instead of a reading of seven argument lists. Task 4's review found `foldClauses` called twice with only one
 *  site threaded, and the untouched one was the SUPPRESSION gate — a run of nothing but non-read shell calls has
 *  no clause at all without the flag, and `groupItems`' R3.1 early exit then drops the whole row off the screen. */
const foldPolicy = (options: Pick<ProjectionOptions, "fullscreen">): FoldPolicy => ({ fullscreen: options.fullscreen === true });

/** Upstream's exact interruption surface — the row is a prompt, not a copy of whatever partial output arrived. */
const INTERRUPTED_TEXT = "Interrupted · What should Claude do instead?";
const REJECTED_TEXT = "Tool use rejected";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** OSC-8 with the BEL terminator (what 2.1.220 emits, and what every terminal we target accepts). Built from
 *  `./osc8.js`'s shared open/close pair — the same shape `sgrFoldRow.ts`'s fold-run writer uses — rather than
 *  a local copy of the escape bytes. */
export const osc8FileLink = (path: string, label: string) => osc8Open(pathToFileURL(path).href) + label + OSC8_CLOSE;
/** T-PRLINK: `osc8FileLink`'s sibling for a url that is ALREADY a target — no `pathToFileURL` resolution,
 *  since a scraped PR url (`gitOps.ts`'s `GitPrOp.url`) is absolute already. Deliberately UNGATED, same as
 *  `osc8FileLink` at its one call site (169): canon's PR link passes `assumeSupport: !0` to the generic `Mi`
 *  component (204156–204172, `HLt() ?? !0`), so the hyperlink is ON unless something explicitly turns it
 *  off — the opposite default from `markdownInline.ts`'s gated `osc8`, whose `hyperlinksSupported()` allowlist
 *  says no on a plain `xterm-256color` TTY. Gating this on that allowlist would make the affordance vanish in
 *  exactly the terminals canon still shows it in (research report §2.3, "the helper"). */
export const osc8WebLink = (url: string, label: string) => osc8Open(url) + label + OSC8_CLOSE;
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
function errorBody(lines: readonly string[], options: ProjectionOptions, color: string): readonly RenderLine[] {
  const projection = options.projection;
  const rows = (projection === "detail-all" ? lines : lines.slice(0, ERROR_PHYSICAL_ROWS)).map((line) => ({ text: line.trimEnd(), color }));
  const overflow = projection === "detail-all" ? 0 : lines.length - ERROR_PHYSICAL_ROWS;
  if (overflow <= 0) return rows;
  return [...rows, { text: `… +${overflow} ${overflow === 1 ? "line" : "lines"}${foldHint(options)}`, dim: true }];
}

/** F3 Task 5 (LT1): the TYPED row is consulted first and is the result body in BOTH projections — a completed
 *  Read reads `Read 340 lines`, never its file content, because upstream dumps that content nowhere (the ctrl+o
 *  verbose branch renders the same `renderToolResultMessage` with `verbose:true`, contract R6.3). The three
 *  surfaces above it are NOT rerouted: `interrupted`/`rejected` are what the USER did and `running` has no body
 *  yet. `undefined` from `summaryLines` means "no typed row" — the generic fold below stays the whole story for
 *  Bash stdout, unknown tools and every error projection. */
/** QA WAVE 2 DELTA — the one interruption that is really a REJECTION, and therefore reads as one.
 *  Wave 2's A4 fix sends the deny arm's `interrupt: true` when a plan is waved off with no feedback
 *  (`gate.ts`, probe 106), which is what lands this call on the interrupted arm at all; upstream paints its
 *  own heading there rather than `zWo`'s prompt (`EAr`, L421286). Upstream discriminates by CONTENT — the
 *  `rmn` prefix on the tool_result (L376058) — and that prefix is not on our wire: probe 106 A4 measured the
 *  SDK writing `Dpt` instead, and the deny message we sent is discarded. So the discrimination is the TOOL,
 *  with ONE carve-out: a plan call the human ESC-interrupted while it was pending is not a rejection, and the
 *  engine says so by writing `INTERRUPT_CANCELLED` as that result's whole content (`toolResult.ts` reads the
 *  same constant to reach this status). The WITH-FEEDBACK arm never arrives here — it does not interrupt, so
 *  it stays an `error` row carrying the human's sentence verbatim. */
const isPlanRejection = (event: ToolEvent, normalized: NormalizedToolResult): boolean =>
  event.name === "ExitPlanMode" && !normalized.flatText.trim().startsWith(INTERRUPT_CANCELLED);

/** `clickable` (T-CLICKGATE Task 1) is canon's click-to-expand predicate. FIX WAVE (external review): it must
 *  be PROJECTION-INDEPENDENT — computed as if the result were folded under the COMPACT projection, regardless
 *  of the projection actually being rendered. A row re-projected to `detail-all` (a later task's "expanded"
 *  view) folds NOTHING there — `detail-all` is the one unbounded projection — so a bit derived from the real
 *  fold would read `false` on exactly the row a later collapse-click needs to find clickable. So the error arm
 *  checks the PHYSICAL line count directly (`errorBody`'s own ten-row clip, independent of projection), and
 *  the ordinary arm asks `wouldFoldUnderCompact`, the same "as-if-compact" question `toolSummaries.bashRows`
 *  answers for its own typed row — a fold FORCED to `compact`, never the caller's actual `options.projection`.
 *  The RENDERED body below still uses the real projection; only the predicate is pinned.
 *    Every earlier return in this function — `running` (no body yet), `interrupted`/`rejected` (what the user
 *  did, not a result to expand) — is `false`. A typed row (`summaryLines`) carries whatever `clickable` its
 *  own producer minted: `false` for every fixed-shape summary, but `bashRows`' own as-if-compact predicate for
 *  a Bash result (see `toolSummaries.ts`'s inventory comment on `summaryLines`). */
const wouldFoldUnderCompact = (lines: readonly string[], columns: number): boolean =>
  foldWithTruncation(lines, columns, { projection: "compact", compactRows: 3, revealOneExtraWithoutMarker: true }).hidden > 0;
function resultBody(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): { body: readonly RenderLine[]; clickable: boolean } {
  if (normalized.status === "running") return { body: [], clickable: false };
  // None of these surfaces is a failure: they are what the USER did, so they never take the error colour, and the
  // rejection is a fixed one-row box (`height: 1`) no matter what text arrived with it. The two attributes are NOT
  // interchangeable — `zWo`'s generic prompt and the `rejected` row are upstream `dimColor`, but `EAr` paints the
  // plan-rejection heading with the `subtle` theme TOKEN (L421286, `color: "subtle"`), so that arm carries a colour.
  if (normalized.status === "interrupted")
    return { body: [isPlanRejection(event, normalized)
      ? { text: PLAN_REJECTED_TEXT, color: resolveThemeColor(themeTokens().subtle) }
      : { text: INTERRUPTED_TEXT, dim: true }], clickable: false };
  if (normalized.status === "rejected") return { body: [{ text: REJECTED_TEXT, dim: true }], clickable: false };   // upstream ignores the tool's text entirely: the row is always this literal
  const typed = summaryLines(event, normalized, options);
  if (typed !== undefined) return { body: typed.lines, clickable: typed.clickable };
  const lines = withoutTrailingBlanks(normalized.outputLines);
  if (!lines.length) return { body: [], clickable: false };
  if (normalized.status === "error") return { body: errorBody(lines, options, resolveThemeColor(themeTokens().error)), clickable: lines.length > ERROR_PHYSICAL_ROWS };
  const folded = foldToolOutput(lines, options.columns, { projection: options.projection, compactRows: 3, revealOneExtraWithoutMarker: true, expandHint: options.expandHint });
  return { body: folded, clickable: wouldFoldUnderCompact(lines, options.columns) };
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
const BACKGROUNDED_TEXT = "Backgrounded agent";
/** 429646 composes this out of TWO `$e` calls inside one literal pair of parens — `chord:"down" action:"manage"`
 *  and the `app:toggleTranscript` lookup — so the expand half is keymap-derived like every other and needs the
 *  BARE clause (`hintWithoutParens`), not a second pair of parens. An unbound chord drops that half and leaves
 *  ` (↓ to manage)`; `Qt` joins whatever survives with ` · `, so the separator goes with the clause. */
const backgroundedHint = (options: ProjectionOptions): string => {
  const expand = hintWithoutParens(resolveExpandHint(options.expandHint));
  return ` (↓ to manage${expand === "" ? "" : ` · ${expand}`})`;
};
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
const agentGutter = (id: string, ownerKey: string, body: readonly RenderLine[]): RenderItem => ({ kind: "gutter-block", id, ownerKey, gutter: TOOL_RESULT_GUTTER, body });
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
  if (children.length === 0) return [agentGutter(`${event.id}:progress`, toolOwnerKey(event.id), [{ text: AGENT_INITIALIZING, dim: true }])];
  const shown = children.slice(-AGENT_PROGRESS_ROWS), hidden = children.length - shown.length;
  const items = nestedItems(shown, options, /* linesOnly */ true);
  if (hidden > 0) items.push({ kind: "line", id: `${event.id}:progress-hidden`, ownerKey: toolOwnerKey(event.id), line: indentRenderLine(hiddenToolUsesLine(hidden, resolveExpandHint(options.expandHint)), AGENT_INDENT) });
  return items;
}
/** `undefined` means `Vha`'s `return null` (429649): a terminal shape it does not recognise paints NO typed
 *  row, and the caller falls through to the generic body. A derived rung with zero observed children is that
 *  same nothing — `Done (0 tool uses)` is a number we do not have, and Static would freeze the lie on screen. */
function agentTerminalItems(event: ToolEvent, options: ProjectionOptions): readonly RenderItem[] | undefined {
  const status = sidecarStatus(event);
  if (status === "remote_launched") return [agentGutter(`${event.id}:launched`, toolOwnerKey(event.id), [cloudLaunchedLine(event)])];
  const children = agentChildren(options.toolEvents ?? [], event.id);
  const totals = agentTotals(event, options.agentMeta?.get(event.id), children, options.now);
  // The hint (`Ug`, 240583440) returns null inside the transcript/verbose contexts, so it is compact-only —
  // the same rule `foundRow` follows, and the detail projections ARE that verbose form (R6.3).
  const compact = options.projection === "compact";
  if (status === "async_launched" && totals.source === "derived")
    return [agentGutter(`${event.id}:launched`, toolOwnerKey(event.id), [{ text: compact ? `${BACKGROUNDED_TEXT}${backgroundedHint(options)}` : BACKGROUNDED_TEXT }])];
  if (totals.source === "derived" && children.length === 0) return undefined;
  const items: RenderItem[] = [agentGutter(`${event.id}:done`, toolOwnerKey(event.id), [{ text: agentDoneText(totals) }])];
  // The hint is a SIBLING of the block, two literal spaces then `(ctrl+o to expand)` (429654).
  // `!i && <Text dimColor>["  ", <Bg/>]</Text>` (429654). `Bg` returning null takes the whole row with it,
  // which is exactly what an unbound `app:toggleTranscript` must do here: no offer, not an empty indent.
  if (compact) { const hint = resolveExpandHint(options.expandHint); return hint === "" ? items : [...items, { kind: "line", id: `${event.id}:done-hint`, ownerKey: toolOwnerKey(event.id), line: { text: `  ${hint}`, dim: true } }]; }
  // What ctrl+o expands TO: the nested rows the compact unit folds away, with their own typed result rows.
  return [...items, ...nestedItems(children, options, /* linesOnly */ false)];
}

// ── F3 Task 8: the same-message agent batch (LT3) ───────────────────────────────────────────────────────
/** `Xha`'s per-agent rows sit in a `paddingLeft: 3` column, each behind a two-column tree connector — `ZK_`
 *  (397730) renders `├`/`└`/`│` (and the empty `space`) inside a `width: 2` DIM Box, so the glyph is dim and
 *  the column it is padded to is not. */
const AGENT_BATCH_PAD = "   ";
const treeSegments = (glyph: string): Segment[] => (glyph === "" ? [{ text: `${AGENT_BATCH_PAD}  ` }] : [{ text: AGENT_BATCH_PAD }, { text: glyph, dim: true }, { text: " " }]);
/** Upstream `ZVp` (429756) resolves a running agent's `⎿` row from the progress messages forwarded for it: a
 *  trailing run of ≥2 read/search results collapses to a fold clause, otherwise it is the LAST tool_result's
 *  `userFacingName` (plus its summary). Our retained document holds the child CALLS rather than a progress
 *  stream, so the fallback branch is honoured exactly — the last nested call's display name — and the
 *  trailing-run clause is deliberately NOT approximated from a different input. */
function agentLastToolInfo(children: readonly ToolEvent[], options: ProjectionOptions): string | undefined {
  const last = children.at(-1);
  return last === undefined ? undefined : displayName(last, options);
}
/** One `jla` (422163) block: the agent's own row, then — unless it is a RESOLVED background dispatch, whose
 *  totals and status upstream drops entirely (`!$yt &&` on both) — its dim `⎿` status row. `hideType` leads
 *  with the description because every member shares one type; otherwise the type leads and the description
 *  is parenthesized after it. The whole row is `dimColor` until the agent resolves, which costs the label its
 *  bold exactly as it does upstream (a `<Text dimColor bold>` never emits `\x1b[1m` — F1 Task 1). */
function agentBatchMemberItems(member: AgentBatchMember, hideType: boolean, isLast: boolean, part: (name: string) => string, ownerOf: (eventId: string) => string, options: ProjectionOptions): RenderItem[] {
  const async = member.isAsync && member.resolved, dim = member.resolved ? {} : { dim: true as const };
  const label = hideType ? member.description ?? member.agentType : member.agentType;
  const row: Segment[] = [...treeSegments(isLast ? "└" : "├"), { text: label, bold: true, ...dim }];
  if (!hideType && member.description !== undefined) row.push({ text: ` (${member.description})`, ...dim });
  const children = agentChildren(options.toolEvents ?? [], member.event.id);
  if (!async) row.push({ text: agentBatchTotalsText(agentTotals(member.event, options.agentMeta?.get(member.event.id), children, options.now)), ...dim });
  const items: RenderItem[] = [{ kind: "line", id: part(`agent:${member.event.id}`), ownerKey: ownerOf(member.event.id), line: segmented(row) }];
  if (async) return items;
  const status = member.resolved ? AGENT_BATCH_DONE : agentLastToolInfo(children, options) ?? AGENT_INITIALIZING;
  const gutter: Segment[] = [...treeSegments(isLast ? "" : "│"), { text: `⎿  ${status}`, dim: true }];
  return [...items, { kind: "line", id: part(`agent:${member.event.id}:status`), ownerKey: ownerOf(member.event.id), line: segmented(gutter) }];
}
/** The whole unit. `form` is the append-only discipline made visible: the PENDING copy carries its own id
 *  part so the eventual published copy — same membership, same text — cannot collide with it in Static's
 *  append-once bookkeeping, exactly as `GROUP_PART` does for a fold run. */
function agentBatchItems(batch: AgentBatch, form: "published" | "pending", options: ProjectionOptions): readonly RenderItem[] {
  const view = agentBatchView(batch, options.agentMeta), header = agentBatchHeader(view);
  const grey = resolveThemeColor(themeTokens().inactive), glyph = options.platform === "darwin" ? "⏺" : "●";
  // `ile` (422343): steady and status-coloured once every member has resolved; while any is still open it is
  // dim and blinks on the same 600 ms phase as every other leader — except that an ERROR pins it visible.
  const leader: Segment[] = view.allResolved
    ? [{ text: glyph, color: resolveThemeColor(themeTokens()[view.anyError ? "error" : "success"]) }, { text: " " }]
    : [{ text: view.anyError || Math.floor(options.now / 600) % 2 === 0 ? glyph : " ", dim: true, color: grey }, { text: " ", dim: true }];
  const segments: Segment[] = [...leader];
  if (header.before !== "") segments.push({ text: header.before });
  segments.push({ text: header.count, bold: true }, { text: header.after });
  if (header.manage) segments.push({ text: " " }, { text: AGENT_MANAGE_HINT, dim: true });
  // `Bg` returns null inside the transcript/verbose contexts, so the hint is compact-only — the same rule
  // Task 7's `Done (…)` sibling hint follows, and the detail projections ARE that verbose form (R6.3).
  if (header.expand && options.projection === "compact" && resolveExpandHint(options.expandHint) !== "") segments.push({ text: " " }, { text: resolveExpandHint(options.expandHint), dim: true, color: grey });
  const part = (name: string) => agentBatchItemId(batch.memberIds, form === "pending" ? `pending-${name}` : name);
  // A batch member is one Task CALL, and this file already treats a call as the hover unit even though
  // several calls ride one assistant message (`:448`/`:452`/`:466`, tool header/result). So a member's row
  // and its `⎿` status row are one unit, the header is another, and a three-member batch is four units.
  const ownerOf = (eventId: string) => toolOwnerKey(eventId, form === "pending" ? "pending" : undefined);
  const items: RenderItem[] = [{ kind: "line", id: part("header"), ownerKey: agentBatchOwnerKey(batch.memberIds, form), line: segmented(segments) }];
  view.members.forEach((member, index) => items.push(...agentBatchMemberItems(member, view.hideType, index === view.members.length - 1, part, ownerOf, options)));
  return items;
}

// ── F3 Task 9: the background hint under a running foreground Bash (LT20) ───────────────────────────────
/** Upstream `iwr` (bundle 240646037) renders it as a `<Box paddingLeft:5>` sibling of the progress body, so
 *  it is five plain columns — NOT the `⎿` gutter, which is a five-column box with a connector in it. */
const BACKGROUND_HINT_INDENT = "     ";
/** The gate is the CALL'S OWN `system/task_started` with `task_type:"local_bash"` (P84): the engine only
 *  becomes able to background a shell once that frame lands, so drawing the hint from the first frame of the
 *  call would advertise a key that does nothing for the seconds before it. An Agent dispatch's `task_started`
 *  (`local_agent`) is a different task type on the same sidechannel and must not light this row. Compact-only,
 *  like every other hint: the detail projections ARE upstream's verbose form, where `Ug`/`Bg` return null. */
function backgroundHintItem(event: ToolEvent, options: ProjectionOptions): RenderItem | undefined {
  if (event.name !== "Bash" || event.route !== "top-level" || options.projection !== "compact" || options.verbose) return undefined;
  // An explicitly-backgrounded call never gets the hint: upstream's `in_` returns early on
  // `run_in_background === true` (bundle 306279–306284), so its hint loop is unreachable there — while the
  // task_started sidechannel still fires `local_bash` for it, which is why the input check must come first
  // (t9 review: without it the row flashes "to run in background" on a call already in the background).
  if (isRecord(event.input) && event.input.run_in_background === true) return undefined;
  if (options.bashHint === undefined || options.agentMeta?.get(event.id)?.taskType !== "local_bash") return undefined;
  return { kind: "line", id: `${event.id}:background-hint`, ownerKey: toolOwnerKey(event.id), line: { text: `${BACKGROUND_HINT_INDENT}${options.bashHint}`, dim: true } };
}

/** One retained call → its renderable items. A `suppressed` tool projects to nothing — driven by the status Task 1's
 *  normalizer assigns, never by a renderer-side name check, so the suppression list has exactly one home. */
export function renderToolEvent(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderItem[] {
  const items = toolEventItems(event, normalized, options);
  // F4 Task 10c: `xvr`'s close, appended ONCE here rather than at each of the three returns below — an
  // Agent's terminal shape is decided in three different places (the `Vha` route, the generic body, the
  // launched-in-background early exit) and the attribution row must not be able to miss one of them.
  const lifecycle = agentLifecycleItem(event, normalized, options);
  return lifecycle === undefined ? items : [...items, lifecycle];
}
/** TOOL-STREAM T5 — the ONE exception to the line above, and the only one. `segmentRuns` pops an errored
 *  `popsOutOnError` tool out of its run and emits it standalone precisely so the failure is never swallowed
 *  (spec §3.1, rounds 5–6), and the pop ALSO ends the run. Two of those five names — TaskCreate, TaskUpdate —
 *  are on the suppressed list, so "standalone" resolved to `[]` and the cluster split around a row that did not
 *  exist: two adjacent, identical, unexplained group rows with the failure appearing nowhere. A call that
 *  earned a standalone slot renders its generic header there; `statusToken` maps `suppressed` to the error
 *  token, so the row carries the failure's colour. Same shape Task 8 owes a suppressed MEMBER of an expanded
 *  cluster. Non-errored suppression is untouched — that is canon (`Joi` 2.1.234:236734) and load-bearing. */
function poppedOnErrorItems(event: ToolEvent, options: ProjectionOptions): readonly RenderItem[] {
  return suppressedHeaderItems(event, "suppressed", options);
}
/** THE ONE SHAPE A SUPPRESSED CALL WEARS WHEN IT MUST BE SEEN, shared by T5's standalone pop-out above and
 *  T8's expanded member below so the two cannot drift into two answers for one question: the generic header
 *  row and nothing else — a suppressed tool has no result surface at all (`Joi`), and inventing one here
 *  would show more inside a cluster than the same call shows anywhere else.
 *    ONLY THE STATUS DIFFERS, AND IT MUST. T5's row exists BECAUSE the call failed, so it takes `suppressed`
 *  (which `statusToken` maps to the error token) and reads as the failure it is. An expanded cluster's
 *  members are whatever they happen to be, and colouring a perfectly ordinary ToolSearch red would invent a
 *  failure — so that caller passes the status the call's own result earned. */
function suppressedHeaderItems(event: ToolEvent, status: ToolStatus, options: ProjectionOptions): readonly RenderItem[] {
  return [{ kind: "line", id: `${event.id}:call`, ownerKey: toolOwnerKey(event.id), line: headerLine(event, status, options), wrap: "truncate-end" }];
}
/** T-CLICKGATE Task 3 — canon's expanded marker: `userMessageBackgroundHover` behind the whole body plus ONE
 *  padding row after it. Minted as REAL `RenderLine`s here, in the body array `resultBody` already builds,
 *  rather than as a wrapper-level `paddingBottom` — that keeps it a physical row `wrapItems`/`pageItemSlices`/
 *  `hitRowsOf` all count exactly once, the same as any other body row, with nothing downstream needing a
 *  special case. A SEGMENTED line paints through its own `Segment.bg` (`Line.tsx` never reads `RenderLine.bg`
 *  once `segments` is set), so both fields are stamped; neither producer here sets either one already
 *  (`grep bg:` across this file and `toolSummaries.ts` at the time of writing), so there is nothing to
 *  preserve underneath the overwrite. */
const expandedBg = (): string => resolveThemeColor(themeTokens().userMessageBackgroundHover);
function withExpandedMarker(body: readonly RenderLine[]): readonly RenderLine[] {
  const bg = expandedBg();
  const banded = body.map((l) => (l.segments ? { ...l, segments: l.segments.map((s) => ({ ...s, bg })) } : { ...l, bg }));
  return [...banded, { text: "", bg }];
}
function toolEventItems(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderItem[] {
  if (normalized.status === "suppressed") return [];
  // T-CLICKGATE Task 3 — `reid` (below) OVERWRITES every item's `ownerKey` at the two call sites that finalize
  // a top-level call (`projectAll`, `projectPending`, and the fold-member arm `expandedMemberItems`), always
  // with `toolOwnerKey(event.id, event.result ? event.result.resultSequence : "pending")` — never the bare
  // `toolOwnerKey(event.id)` this function used to compute. `expandedItemsRef` (`useChat.ts`) is keyed by
  // WHATEVER OWNER the click actually landed on (the hitmap reads the post-`reid` field), so this has to
  // compute the SAME final string ahead of `reid` to ask the right question — the bare form only ever matches
  // a nested Agent child (`nestedItems`, never `reid`'d, and never clickable at all — Agent success/running
  // both return before `resultBody` ever runs), so it happened to type-check while never once matching.
  const ownerKey = toolOwnerKey(event.id, event.result ? event.result.resultSequence : "pending");
  // Resolved ONCE, ahead of the header push, so both the header and the result wear `expanded: true` while
  // this owner is open: the existing hover Provider term (`FullscreenViewport`'s `s.item.expanded !== true`,
  // F9 T-MOUSE Task 3) already suppresses hover for any item carrying it, and reusing that one field is what
  // makes suppression cover the WHOLE owner — header included — with no new term for the viewport to read.
  const isExpandedOwner = options.expandedItems?.has(ownerKey) === true;
  const items: RenderItem[] = [{ kind: "line", id: `${event.id}:call`, ownerKey, line: headerLine(event, normalized.status, options), wrap: "truncate-end", ...(isExpandedOwner ? { expanded: true } : {}) }];
  if (normalized.status === "running") {
    const hint = backgroundHintItem(event, options);
    if (hint !== undefined) items.push(hint);
  }
  // F3 Task 7 owns the Agent's two live surfaces (the progress rows and the Done row). Its OTHER statuses —
  // `error`, `interrupted`, `rejected` — are exact surfaces the generic body already paints, and so is a
  // terminal shape `Vha` does not recognise (`agentTerminalItems` returns `undefined` and we fall through).
  if (isAgentTool(event.name) && normalized.status === "running") return [...items, ...agentProgressItems(event, options)];
  if (isAgentTool(event.name) && normalized.status === "success") {
    const agent = agentTerminalItems(event, options);
    if (agent !== undefined) return [...items, ...agent];
  }
  // T-CLICKGATE Task 3 — a result whose OWNER the reader clicked open renders at `detail-all` (unbounded, no
  // marker) regardless of the projection actually being painted elsewhere, and its rendered body wears the
  // expanded band. `clickable` is NOT re-derived here: `resultBody`'s own predicate is already computed
  // AS IF COMPACT (Task 1's fix wave), independent of the projection it is handed, so it reads the same
  // `true` whether this call passes `options` or the forced detail-all override — the click that opened this
  // very item is exactly what an unclickable result could never have received.
  const { body, clickable } = resultBody(event, normalized, isExpandedOwner ? { ...options, projection: "detail-all", verbose: true } : options);
  const finalBody = isExpandedOwner && body.length ? withExpandedMarker(body) : body;
  if (finalBody.length) items.push({ kind: "gutter-block", id: `${event.id}:result`, ownerKey, gutter: TOOL_RESULT_GUTTER, body: finalBody, ...(clickable ? { clickable: true } : {}), ...(isExpandedOwner ? { expanded: true } : {}) });
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
/** F3 Task 8, on exactly the same principle: an agent batch's identity is its MEMBERSHIP — the joined
 *  member tool-use ids — with the sequence left out, so two replay dividers cannot re-key a settled unit.
 *  Membership here never grows (a batch is one assistant message, complete the moment it is parsed), so the
 *  id is stable from the first pending frame to the published one; only the `part` prefix separates them. */
export const agentBatchItemId = (memberIds: readonly string[], part: string): string => `agents:${memberIds.join(",")}:${part}`;

// ── F10 T-HOVER H1: the seven owner minters, beside the id minters they mirror ────────────────────────────
// One home for the owner namespace — even though `streamOwnerKey`/`queuedOwnerKey` are called from other
// modules (`streamingItems.ts`, `ChatApp.tsx`) — is what keeps two producers from inventing colliding
// prefixes. Every transcript producer sets `ownerKey` beside `id`; the matrix (`test/tui/hover-owner.test.tsx`)
// is what holds that discipline over time rather than the type alone.
export const sdkOwnerKey = (base: string): string => `sdk:${base}`;
export const localOwnerKey = (identity: string): string => `local:${identity}`;
export const toolOwnerKey = (toolUseId: string, resultSequence?: number | "pending"): string =>
  resultSequence === undefined ? `tool:${toolUseId}` : `tool:${toolUseId}:${resultSequence}`;
export const groupOwnerKey = (memberIds: readonly string[]): string => `group:${memberIds.join(",")}`;
/** An agent BATCH's header row. The batch's identity is its membership, exactly as `agentBatchItemId` already
 *  decided; `form` is carried for the same reason the id part carries it — a pending copy and the published
 *  copy of one batch can both be on screen during the hand-off, and two hover units that compare equal would
 *  light both up. Its MEMBERS do not use this key — a batch member's row and its `⎿` status row own theirs
 *  through `toolOwnerKey`, exactly as an ordinary tool call's header and result do. */
export const agentBatchOwnerKey = (memberIds: readonly string[], form: "published" | "pending"): string =>
  form === "pending" ? `agents:${memberIds.join(",")}:pending` : `agents:${memberIds.join(",")}`;
/** The live streaming tier. `messageKey` is `LiveTurn.messageKey()` — the API message currently on the wire.
 *  NOT the settled item's key: the settled row is keyed on `entry.identity` (the SDK message uuid,
 *  `sdkEntryBase`) and the wire's `message.id` is a different id space, so hover does not survive the settle.
 *  It does not need to — the region holds at most one message at a time (`streamingItems.ts`'s own header). */
export const streamOwnerKey = (messageKey: string): string => `stream:${messageKey}`;
/** One queued prompt, keyed on the ENTRY's own identity — never on its position in the array (r3). A hover
 *  key must be stable across every mutation that leaves its subject on screen, and the queue's head drain
 *  (`useChat.ts`'s `drainNext`, `q.slice(1)`) shifts every survivor down one slot while the pointer has not
 *  moved. An index key is a key the survivors INHERIT; `q.id` is not. */
export const queuedOwnerKey = (entryId: string): string => `queued:${entryId}`;

/** PROJECTION IDENTITY ONLY — never append/dedup. Task 1's `appendSdk` deliberately refuses to hash a
 *  payload (two equal-looking calls can be genuinely distinct turns), but a retained entry with no
 *  source-stable identity still needs a deterministic, collision-free item id; the occurrence counter is
 *  what keeps two byte-identical retained rows from collapsing into one published item. FNV-1a. */
function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hashMessage(message: Record<string, unknown>): string {
  return fnv1a(JSON.stringify(message) ?? "").toString(36);
}
export function sdkEntryBase(entry: SdkEntry, occurrence: number): string {
  return entry.identity ?? `${hashMessage(entry.message)}:${occurrence}`;
}

/** A nested (subagent) row is retained source, but F1 never flattens it into an unrelated top-level row —
 *  F3 owns the parent/child progress and totals route. */
const isNested = (message: Record<string, unknown>): boolean => typeof message.parent_tool_use_id === "string" && message.parent_tool_use_id.length > 0;

/** A retained frame's content blocks. `message.content` can be a plain STRING instead of a block array —
 *  upstream normalizes the same shape (`cke`, L373253); a 60-file sample put it at ~6% of user rows, the
 *  sentinel-bearing ones included — and treating it as "no blocks" is what kept a replayed disk prompt
 *  (and, after F4 Task 10a, every disk sentinel) off the transcript entirely. Normalising in ONE place
 *  means the live path and the disk path see the same blocks. */
function contentBlocks(message: Record<string, unknown>): readonly unknown[] {
  const inner = message.message;
  if (!isRecord(inner)) return [];
  if (Array.isArray(inner.content)) return inner.content;
  return typeof inner.content === "string" ? [{ type: "text", text: inner.content }] : [];
}

/** LT14. `query.interrupt()` puts the interrupt on the wire as a plain `user` frame whose sole content block is
 *  the bracketed sentinel (P80 § A frame 2) — no subtype, no `isMeta`, nothing but the text to go on. Upstream
 *  routes BOTH spellings (`Tq`/`Wk`, L108575) to the same `BP` row at `ERe` exit 9, and F4 Task 10a splits them:
 *
 *  · the TOOL form `[Request interrupted by user for tool use]` still renders nothing here, because the tool row
 *    it interrupted already carries `Interrupted · What should Claude do instead?` and a second line would say
 *    the same thing twice. That divergence is F3's and it stands.
 *  · the PLAIN form `[Request interrupted by user]` has no tool row behind it — an interrupt taken between turns
 *    or during pure text generation — and until this task it suppressed with NO surface anywhere. It now falls
 *    through to `renderMessage`, where `species.ts` gives it upstream's standalone dim `⎿` row.
 *
 *  Still exact-match on a single block, so a user who quotes the sentence inside a longer prompt gets their own
 *  prompt row: the classifier's exit 9 is `text === Tq || text === Wk`, equality and not a substring test. */
function isInterruptSentinel(message: Record<string, unknown>): "plain" | "tool" | null {
  if (message.type !== "user") return null;
  const content = contentBlocks(message);
  if (content.length !== 1) return null;
  const block = content[0];
  if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return null;
  const kind = classifyUserText(block.text.trim());
  return kind === "interrupt-tool" ? "tool" : kind === "interrupt-plain" ? "plain" : null;
}

// ── F4 Task 10c (TR39): teammate attribution ──────────────────────────────────────────
// `species.ts` owns the three LINE forms (pack §9.8); this section owns every PROJECTION decision they need:
// which agent a child frame belongs to, what that agent is called, which of the eight colours it wears, and
// which projection sees which form.
//
// THE PROJECTION SPLIT, and the one deliberate divergence in it. Upstream computes `BGp = verbose ||
// isTranscriptMode` (L425393) and shows the expanded `Cvr` form under either, collapsing to `Ivr` only in
// the DEFAULT view. Our default view is `compact`, and there the child frames stay silent: F3 Task 7 already
// owns that surface with the agent's own progress rows (`⎿ Initializing…`, the last three child calls, the
// `Done (…)` rung), and adding a second running commentary beside it would report one dispatch twice. So the
// two forms land on the pager's own two levels instead — `detail-collapsed` collapses, `detail-all` expands
// — which is the same adaptation `outputFold.ts` already made for every other body ("the detail view's OWN
// collapsed form, which offers ctrl+e rather than ctrl+o"). Both upstream forms ship; only their homes move.
//
// Only ASSISTANT children render. A nested `user` frame on our wire is a subagent's tool RESULT, whose
// blocks this projection already skips, and a nested `thinking` block belongs to the subagent's own reasoning
// — upstream's teammate transport carries prose, and attributing a child's thinking to the parent transcript
// is exactly what `sdkMessageIdentity` refuses to do for the thinking clock.
const nestedTexts = (message: Record<string, unknown>): string[] =>
  message.type !== "assistant" ? []
    : contentBlocks(message).filter((b): b is Record<string, unknown> => isRecord(b) && b.type === "text" && typeof b.text === "string" && b.text.trim() !== "").map((b) => String(b.text));

/** What the row calls the agent. `agentSubagentType` is F3's rule and stays the ONE spelling — including its
 *  fold of `general-purpose`/`worker` back to the bare `Agent` — so a teammate row and the dispatch header
 *  above it can never disagree about a name. A dispatch we no longer hold (attached mid-session, rewound
 *  past) falls back to the `task_started` sidechannel, then to the bare noun. */
function teammateName(agentId: string, options: ProjectionOptions): string {
  const event = (options.toolEvents ?? []).find((candidate) => candidate.id === agentId);
  const meta = options.agentMeta?.get(agentId);
  return event === undefined ? meta?.subagentType ?? "Agent" : agentSubagentType(event, meta);
}
/** Which of the eight colours one agent wears. UPSTREAM HAS NO CYCLING: `t4` (L424866) reads a colour the
 *  teammate message itself carries — sourced from the agent definition or a user override (`Out`, L188606)
 *  — and defaults everything else to `cyan_FOR_SUBAGENTS_ONLY`. Our SDK stream carries no colour field at
 *  all, so a per-agent assignment has to be derived, and the choice is DISPATCH ORDER rather than a hash of
 *  the id: a parallel batch of agents (F3 Task 8's normal case) then gets eight distinct colours, where a
 *  hash collides at a rate of 1-in-8 per pair and would paint two concurrent teammates the same. Document
 *  order is deterministic and stable — tool ids are unique and the tool list only grows — so an agent's
 *  colour never moves under it. The hash is kept only for the frames whose dispatch we do not hold (an
 *  attach mid-session), where there is no order to read; a stable arbitrary colour beats no colour. */
function teammateColorIndex(agentId: string, options: ProjectionOptions): number {
  let index = 0;
  for (const event of options.toolEvents ?? []) {
    if (!isAgentTool(event.name)) continue;
    if (event.id === agentId) return index;
    index++;
  }
  return fnv1a(agentId) % SUBAGENT_TOKEN_NAMES.length;
}
/** Which chord the collapsed row offers. ONE reachable answer today: the row exists only in
 *  `detail-collapsed` (see the projection split above), and there `foldHint` is the constant
 *  `(ctrl+e to show all)` — `foldHint`'s other two arms (compact's threaded `(ctrl+o to expand)`, and `""`
 *  for an unbound chord) belong to the compact projection this row never enters. It still goes THROUGH
 *  `foldHint` rather than naming the literal, because that is the one place hint honesty is decided for
 *  every folded body in this file and a second copy of the sentence is exactly what F4 Task 10b removed. */
const teammateHint = (options: ProjectionOptions): string => foldHint(options).trim();

/** One nested frame → its rows. `[]` covers compact (F3's surface), every non-assistant child, and a child
 *  whose blocks are all tool traffic. The collapsed row here is a SINGLE-frame count; `buildAnchoredEntries`
 *  coalesces the adjacent ones, which is upstream's `Jbn` and cannot be seen from inside one entry. */
function nestedTeammateItems(message: Record<string, unknown>, options: ProjectionOptions, id: string): readonly RenderItem[] {
  if (options.projection === "compact") return [];
  const texts = nestedTexts(message);
  if (texts.length === 0) return [];
  const agentId = String(message.parent_tool_use_id), name = teammateName(agentId, options);
  if (options.projection === "detail-collapsed")
    return [{ kind: "line", id: sdkItemId(id, "teammate:collapsed"), ownerKey: sdkOwnerKey(id), line: teammateCollapsedLine(name, texts.length, teammateHint(options)) }];
  const color = subagentColor(teammateColorIndex(agentId, options));
  const items: RenderItem[] = [];
  texts.forEach((text, index) => {
    // `block:<i>:<line>` for `projectMessageEntry`'s reason: one markdown block renders many lines and two
    // items sharing an id publish once into Static, losing the rest.
    for (const [lineIndex, line] of teammateMessageLines(name, color, text, { width: options.columns }).entries())
      items.push({ kind: "line", id: sdkItemId(id, `teammate:${index}:${lineIndex}`), ownerKey: sdkOwnerKey(id), line });
  });
  return items;
}

/** The lifecycle close, `xvr`'s row. Upstream's trigger is an `idle_notification` frame a teammate sends
 *  itself; our wire has no such frame, so the honest equivalent is the dispatch's OWN terminal status — the
 *  same signal the `Done (…)` rung and the header bullet already read, which is why it cannot disagree with
 *  them. `rejected` joins `interrupted`: both are what the USER did to the call, and upstream has no third
 *  arm. Detail-only, like the collapsed form and for the same reason: compact is F3's surface, where the
 *  `Done (…)` rung is already the agent's terminal row.
 *
 *  IT ALSO REQUIRES A NAME, which is a gate the attributed message rows deliberately do NOT share — and
 *  this one is OURS, not a port. Upstream renders the lifecycle row for `general-purpose` too; its
 *  `general-purpose` special-case is only about COLOUR (`Out`, L188606, opens `if (e === "general-purpose")
 *  return`, so that agent carries no custom colour and `t4` falls back to `cyan_FOR_SUBAGENTS_ONLY`). The
 *  gate is reachability-grounded instead: on our wire the anonymous dispatch is the COMMON case, not the
 *  exception — `agentSubagentType` folds `general-purpose`/`worker` back to the bare noun, and F3's own
 *  batches are full of them — so `⏺ Teammate @Agent finished` under a `⏺ Agent(…)` header would be a row of
 *  pure noise repeating what the `Done (…)` rung directly above it already said. (Upstream's own
 *  `agentBatchView.sharedType` makes the same judgement about the bare noun in a different row: it refuses
 *  to qualify a header with it.) A message ROW keeps its `@Agent` header regardless, because there the
 *  question is "whose prose is this", which even the bare noun answers. */
const IDLE_REASON: Partial<Record<ToolStatus, TeammateIdleReason>> = { success: "available", error: "failed", interrupted: "interrupted", rejected: "interrupted" };
function agentLifecycleItem(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): RenderItem | undefined {
  if (!isAgentTool(event.name) || options.projection === "compact") return undefined;
  if (teammateName(event.id, options) === "Agent") return undefined;
  const idleReason = IDLE_REASON[normalized.status];
  if (idleReason === undefined) return undefined;                            // `running`/`suppressed`: nothing has finished
  // `flatText`, not `output`: the normalizer's display copy prefixes an error body with `Error: `, and
  // `failed: Error: boom` stutters where upstream's `failureReason` is a bare sentence off the notification.
  const failure = idleReason === "failed" ? normalized.flatText || normalized.output : undefined;
  const line = teammateLifecycleLine(teammateName(event.id, options), subagentColor(teammateColorIndex(event.id, options)), idleReason, failure, options.platform);
  return { kind: "line", id: `${event.id}:teammate-lifecycle`, ownerKey: toolOwnerKey(event.id), line };
}

/** The sole non-tool completed-SDK adapter: it reuses render.ts for assistant/user text and every other
 *  non-tool species, and SKIPS `tool_use`/`tool_result` so tools keep the one renderer route above. One
 *  block at a time, so the item id can carry the content index that makes it stable across a rehydration.
 *
 *  F4 Task 5: it stops voiding its options. It takes the FULL `ProjectionOptions` (not `ProjectionContext`)
 *  because `showThinking` is derived from the two knobs `ProjectionContext` deliberately omits — its one
 *  caller, `buildAnchoredEntries`, already holds them. `renderMessage` consumes `width` today; `platform`
 *  and `showThinking` are threaded here so Tasks 8/9 land inside render.ts alone. The DERIVATION: thinking is
 *  hidden only in the default folded view — every detail (ctrl+o) projection and every verbose read shows it,
 *  which is exactly `projection !== "compact" || verbose`. */
export function projectMessageEntry(entry: SdkEntry, options: ProjectionOptions, base?: string): readonly RenderItem[] {
  // F4 Task 10b adds `projection` + `expandHint`: `species.ts`'s `bash-output` is a FOLDED body (upstream folds
  // it through the very `p2`/`y_s` a tool result uses), so it needs the same "how much" knob every other body
  // takes, and its overflow marker offers the same live chord.
  const renderOpts = { width: options.columns, platform: options.platform, showThinking: options.projection !== "compact" || options.verbose, projection: options.projection, expandHint: options.expandHint, cwd: options.cwd };
  const message = entry.message;
  // F4 Task 10c: the nested branch stops being a hole. It STILL renders nothing in compact — see the
  // teammate section above for why that is F3's surface — but the detail projections now attribute it.
  if (isNested(message)) return nestedTeammateItems(message, options, base ?? sdkEntryBase(entry, 0));
  if (isInterruptSentinel(message) === "tool") return [];
  const content = contentBlocks(message);
  const id = base ?? sdkEntryBase(entry, 0);
  const items: RenderItem[] = [];
  // F9 T-IMAGE I4: `renderMessage` below is called once PER BLOCK (a single-element `content` array each
  // time), so it cannot count "the Nth image in THIS message" itself — that counter is computed here, over
  // the FULL retained block array, before the per-block loop, and handed back in via `imageOrdinal` (see
  // `RenderMessageOptions`'s doc in render.ts) so `[Image #N]` numbers match source order on every surface
  // this function feeds (compact/detail/pending alike — it is the one place all three converge). Keyed by
  // POSITION, not object identity: two `image` blocks can be structurally (and in a test fixture, actually)
  // the same object, and a `Map<block, N>` would collide the second occurrence onto the first's key.
  let imageOrdinal = 0;
  const imageOrdinalAt = content.map((block) => (isRecord(block) && block.type === "image" ? ++imageOrdinal : undefined));
  content.forEach((block, index) => {
    if (!isRecord(block) || block.type === "tool_use" || block.type === "tool_result") return;
    for (const [lineIndex, line] of renderMessage({ type: message.type, message: { content: [block] } }, { ...renderOpts, imageOrdinal: imageOrdinalAt[index] }).entries())
      // `block:<i>:<line>` rather than the bare `block:<i>`: one markdown block legitimately renders many
      // lines, and two items sharing an id would publish once and lose the rest.
      items.push({ kind: "line", id: sdkItemId(id, `block:${index}:${lineIndex}`), ownerKey: sdkOwnerKey(id), line });
  });
  return items;
}

/** Every `event.lines[index]` maps straight through: the local event already owns its exact RenderLine
 *  styling, so projection adds no second style rule (that is what makes `appendFollowGap`'s dim line
 *  identical in compact and detail).
 *
 *  ONE exception, F4 Task 10b: the compact-summary boundary. Upstream's `NAr` is `!isTranscriptMode && …`
 *  (L422289), so shape B shows `⏺ Compact summary` with NO expand clause under ctrl+O — offering the very
 *  view you are already in is the same dishonesty a stale chord is. THE WHOLE ROW IS RE-DERIVED HERE off the
 *  `COMPACT_SUMMARY_SPECIES` tag, in BOTH projections (E2). It used to be re-derived for the detail ones only
 *  and replayed verbatim in compact, which meant the chip a `/compact` baked in was whichever renderer
 *  happened to be painting at the time: a boundary compacted in classic kept its `(ctrl+o to expand)` alive
 *  inside fullscreen, where §3.4's suppression is blanket, and one compacted in fullscreen never got the chip
 *  back on the classic screen. Nothing on the wire says which renderer a compaction happened under, so there
 *  is no fact here to store — only an answer, and an answer computed before its inputs are final goes stale.
 *  The hint therefore comes from the live channel every other derived chip already reads: `""` under the
 *  fullscreen renderer (or an unbound chord), the user's chord otherwise, and `EXPAND_HINT_FALLBACK` when no
 *  keymap was in scope at all — `keys/hints.ts`'s three states, unchanged. Transcript mode still wins over
 *  all three, because `NAr` is about the SCREEN you are on and not about the chord.
 *
 *  A SECOND exception, the mirror of the first: a `level:"info"` system notice. sdk.d.ts's `level` doc says
 *  info "shows only in transcript mode", and `dVo`'s gate agrees (see `isTranscriptOnlyNotice`) — so the row
 *  is retained, baked, and projected to NOTHING here in compact. Retaining rather than dropping is the point:
 *  the old ingest-time drop meant ctrl+O could not show what compact was hiding, which is not "hidden", it is
 *  gone. `transcriptMode` (not `verbose`) is the port of upstream's screen, exactly as above: the transcript
 *  screen is the surface that passes `verbose: !0` down (L476168), and both our detail projections are it. */
export function projectLocalEvent(entry: LocalEntry, options?: ProjectionOptions): readonly RenderItem[] {
  const transcriptMode = options !== undefined && options.projection !== "compact";
  if (!transcriptMode && entry.event.data?.species === SYSTEM_INFO_SPECIES) return [];
  const lines = entry.event.data?.species === COMPACT_SUMMARY_SPECIES
    ? compactSummaryLines(transcriptMode ? "" : resolveExpandHint(options?.expandHint), options?.platform) : entry.event.lines;
  return lines.map((line, index) => ({ kind: "line" as const, id: localItemId(entry.identity, index), ownerKey: localOwnerKey(entry.identity), line }));
}

/** Re-key one call's items onto its ANCHOR (the call id + the sequence it publishes at), which is what keeps
 *  the open and the finalized copies of the same row distinct. The first line is the header and the first
 *  gutter-block the body; anything beyond that (Task 7's Agent rows) takes its ORDINAL, because the id is
 *  Static's append-once key and a collision there silently drops a row. */
const reid = (items: readonly RenderItem[], id: string, sequence: number | "pending"): RenderItem[] =>
  items.map((item, index) => ({ ...item, ownerKey: toolOwnerKey(id, sequence),
    id: toolItemId(id, sequence, index === 0 ? "header" : index === 1 && item.kind === "gutter-block" ? "body" : `part:${index}`) }));

// ── F1 Task 5c: the DEFAULT view's collapsed group row ──────────────────────────────────────────────────
// Task 5b's pure model decides WHAT a run collapses to; everything below decides how that reads on screen.
// Only `projection === "compact" && !verbose` folds — both detail projections (and therefore the Ctrl-O
// pager) keep the per-call `⏺ Read(a.ts)` rows, because those ARE upstream's ctrl+o verbose form (R6).
/** Every segment on a group row is dim (R3.5 as corrected below), so the only remaining axis is colour:
 *  the settled clause run carries the row grey, the active one is dim-and-uncoloured like the golden's. */
const dimmed = (text: string, color?: string): Segment => ({ text, dim: true, ...(color === undefined ? {} : { color }) });
/** R3.3's row geometry. Settled: an EMPTY two-column box (so two literal spaces, no glyph and no colour —
 *  R3.4) then the whole dim text run. Active: `ile`'s single glyph BLINKING on a 600 ms period (glyph for one
 *  half, a bare space for the other — R4.1), then the present-participle clauses undimmed, the separate `…`,
 *  one literal space and the always-dim expand hint (R3.6). The blink is a pure phase function of
 *  `options.now`, exactly like the standalone header's, so the caller owns the clock and a test can pin any
 *  frame. The elapsed `· Ns` ticker (`elapsed`, TS Task 11) rides between the clause run and the `…`, exactly
 *  where canon puts it (518636), and is FULLSCREEN-ONLY because canon's anchor is computed only `if (s &&
 *  Ns())` (R4.10, 518532) — so a classic transcript still has none. The bash `(Ns · N lines)` progress suffix
 *  that sits beside it in canon (518516–518530) is CUT rather than pending: probe 100 proved no per-tool
 *  progress feed and no output-line count are reachable headlessly, and a substitute for either would be a
 *  fabrication, not fidelity (spec §3.1, Revision Notes round 4).
 *    That gating does NOT extend to the 700 ms hint debounce,
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
function groupRowLine(counts: GroupCounts, active: boolean, options: ProjectionOptions, elapsed?: string): RenderLine {
  const grey = resolveThemeColor(themeTokens().inactive);
  const leader: Segment[] = active
    ? [{ text: Math.floor(options.now / 600) % 2 === 0 ? (options.platform === "darwin" ? "⏺" : "●") : " ", dim: true, color: grey }, { text: " ", dim: true }]
    : [{ text: "  " }];
  const run = composeFoldRun(foldClauses(counts, active, foldPolicy(options)), active ? "active" : "settled", { ellipsis: active, ...(elapsed === undefined ? {} : { elapsed }) });
  const hint = resolveExpandHint(options.expandHint);
  const segments: Segment[] = [...leader, { text: run, preStyled: true }, ...(hint === "" ? [] : [dimmed(" "), { text: hint, dim: true, color: grey } as Segment])];
  // `run` is the ONE segment whose `text` carries SGR bytes, so the line's plain text is stripped rather
  // than joined raw — width math, the pager and every text assertion must still see the bare sentence.
  return { text: segments.map((segment) => (segment.preStyled === true ? stripSgr(segment.text) : segment.text)).join(""), segments };
}
/** Canon `kth`'s own floor (518664: `if (YIl < 2000) return null`) — a call under two seconds gets no ticker
 *  at all, which is what keeps the row from flickering a duration on every quick read. */
const ELAPSED_TICKER_MIN_MS = 2000;
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
/** TOOL-STREAM T8 — THE CLUSTER, OPEN. Canon's expanded cluster shows every `tool_use` it absorbed, in the
 *  FULL listing form its virtual list renders (grounding §4) — which is the same form the ctrl+o pager
 *  shows, so `detail-all` is what a member is rendered under here and not the compact form (a compact Read
 *  clips its listing to three rows, and a cluster you opened in order to see the detail must not hide it).
 *
 *  IT IS A FRESH RENDER, NOT A REUSE, and it has to be: a `FoldGroup` carries `memberIds` and nothing else,
 *  the per-call items the compact projection built for those calls were never built (the whole point of the
 *  fold is that they collapsed), and the surrounding projection's items are compact anyway. So the events
 *  are looked up in `options.toolEvents` — injected by `projectAll`/`projectPending` from the very document
 *  being projected — and re-rendered. A member the document no longer holds is skipped rather than faked.
 *
 *  `emitted` IS THE DE-DUP, AND IT IS AN OBLIGATION INHERITED FROM TASK 3 rather than a defensive filter.
 *  `segmentRuns` emits an errored `popsOutOnError` bookkeeping call STANDALONE so the failure is never
 *  swallowed, and — when its window was not clear — leaves it in `memberIds` too, because relocation decides
 *  membership and that one did not relocate. Canon can do both at once: it keeps the `tool_use` in the
 *  cluster and pushes the `tool_result` out, two halves of one call. Our atoms carry both halves together,
 *  so drawing every member would draw that call a second time. The caller passes the ids IT is emitting on
 *  its own — the two projections emit different sets, so neither can be inferred from here. */
function expandedMemberItems(group: FoldGroup, anchorId: string, options: ProjectionOptions, emitted: ReadonlySet<string> | undefined): readonly RenderItem[] {
  const detail: ProjectionOptions = { ...options, projection: "detail-all", verbose: true };
  const byId = new Map((options.toolEvents ?? []).map((event) => [event.id, event] as const));
  const out: RenderItem[] = [];
  for (const memberId of group.memberIds) {
    if (emitted?.has(memberId) === true) continue;
    const event = byId.get(memberId);
    if (event === undefined) continue;
    const normalized = normalizeToolResult(event, { verbose: true });
    // A6: a suppressed member renders its generic header rather than the nothing `toolEventItems` gives it —
    // canon's expanded cluster shows every absorbed call, and a ToolSearch that vanished from the very view
    // opened to see what a row summarised would make the count and the listing disagree. Its status is the
    // one its own result earned, which is where this parts from T5's deliberately error-coloured pop-out.
    const items = normalized.status === "suppressed"
      ? suppressedHeaderItems(event, event.result === undefined ? "running" : event.result.isError ? "error" : "success", detail)
      : renderToolEvent(event, normalized, detail);
    for (const item of reid(items, event.id, event.result ? event.result.resultSequence : "pending")) out.push({ ...item, foldAnchor: anchorId, expanded: true });
  }
  return out;
}

/** R3.1's early exit: a run whose clauses all came out empty renders NOTHING at all. */
function groupItems(group: FoldGroup, form: GroupForm, options: ProjectionOptions, emitted?: ReadonlySet<string>): readonly RenderItem[] {
  const active = form === "active";
  // R3.2's ratchet: the DYNAMIC forms latch (write the max), and the PUBLISHED form PEEKS the same maximum
  // without writing — upstream's ratchet assignment is unconditional across renders of the mounted row
  // (task-4 review, `Ima` L427896), so the on-screen row must not downgrade when the run settles; but a
  // replay sweep must not CREATE latch entries for history, and a never-latched anchor peeks back its own
  // counts, which is upstream's fresh-mount recompute. R4.7's hint resolution stays dynamic-only. The
  // anchor is the run's EARLIEST-ISSUED call (`FoldGroup.anchorId`), not `memberIds[0]`: membership grows as
  // the run grows AND reorders as its members settle, so call order is the only thing that holds still (E1).
  const anchorId = group.anchorId;
  const pending = options.pending;
  const counts = pending === undefined ? group.counts
    : form === "published" ? pending.peek(anchorId, group.counts) : pending.latch(anchorId, group.counts);
  // R3.1's early exit — and the SECOND `foldClauses` call site, which asks the same question the row above
  // answers on screen: has this run anything to say? It must be asked under the same policy, because the
  // fullscreen-only shell clause is the only thing a run of nothing but non-read Bash calls can say. Asked
  // classically, the answer is `[]` and the run does not render wrong — it does not render at all.
  if (foldClauses(counts, active, foldPolicy(options)).length === 0) return [];
  // T8, AFTER the ratchet and after R3.1, both deliberately. The latch above must run whether the cluster is
  // open or closed, or collapsing it again would show counts that had stopped being maintained; and a run
  // with nothing to say has no row to click, so it has nothing to open either.
  if (options.expandedFolds?.has(anchorId) === true) return expandedMemberItems(group, anchorId, options, emitted);
  const tag = { foldAnchor: anchorId };
  const id = toolGroupItemId(group.memberIds, GROUP_PART[form]);
  // TS Task 11's ticker, canon `kth` (518661–518664) over the anchor `Ne` (518532–518543). Both halves of
  // canon's gate are here: `s` (the row is the ACTIVE form) and `Ns()` (the fullscreen renderer). The anchor is
  // the newest in-flight member's LOCAL start stamp — our wire carries no timestamps, so `useChat` stamps every
  // arriving `tool_use` (`stampToolStarts`) and this line only READS — and the delta is taken against the same
  // injected `options.now` the blink reads, so the projection stays clock-free and a test can pin any frame.
  // Deliberately NOT ratcheted: a newer member taking the anchor must drop the ticker back to its own age.
  //   The read is deliberately unable to write (T11 review): stamping here made the age a function of whether
  // a projection reached this line for that particular member — an expanded cluster returns above it, and a
  // parallel batch never reaches it for the older member — so a call could report an age far smaller than its
  // true one. An unstamped member (a replay) gets no ticker rather than a fabricated zero.
  //   `active` is REDUNDANT TODAY and kept anyway, which is the one thing here no test can bite: only an OPEN
  // run carries a `newestInFlightId`, and today an open run reaches this function only as the `active` form
  // (`projectAll` never anchors an open call at all). It is canon's own gate (`s`), and what it guards against
  // is expensive and silent — a ticker on an immutable Static row would freeze at whatever second it was
  // published on and never move again.
  const anchorMs = active && options.fullscreen === true && pending !== undefined && group.newestInFlightId !== undefined
    ? pending.startedAt(group.newestInFlightId) : undefined;
  const running = anchorMs === undefined ? undefined : options.now - anchorMs;
  const elapsed = running !== undefined && running >= ELAPSED_TICKER_MIN_MS ? ` · ${formatDuration(running)}` : undefined;
  const items: RenderItem[] = [{ kind: "line", id, ownerKey: groupOwnerKey(group.memberIds), line: groupRowLine(counts, active, options, elapsed), ...tag }];
  // R3.7: the hint gutter is ACTIVE-ONLY — `latestDisplayHint` rides on the settled message but never renders.
  if (active) {
    const hint = pending === undefined
      ? (group.hint === undefined ? undefined : { text: group.hint, italic: false })
      : pending.hint(anchorId, group.hint, group.latestThinkingSummary);
    if (hint !== undefined) {
      const grey = resolveThemeColor(themeTokens().inactive);
      // R4.7 step 5: the summary variant is dim + ITALIC and pre-clamped by `OAH(text, columns − X8o, PAH)`;
      // the ordinary hint (step 6) is neither clamped nor italic, just split on its own newlines.
      const text = hint.italic ? clampHintText(hint.text, options.columns - GROUP_HINT_GUTTER.length, HINT_MAX_LINES) : hint.text;
      const body = text.split("\n").map((line) => ({ text: line, dim: true, color: grey, ...(hint.italic ? { italic: true } : {}) }));
      items.push({ kind: "gutter-block", id: toolGroupItemId(group.memberIds, "pending-hint"), ownerKey: groupOwnerKey(group.memberIds), gutter: GROUP_HINT_GUTTER, gutterStyle: { color: grey, dim: true }, body, ...tag });
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
  // The suppressed interrupt sentinel is the one entry whose ATOM and whose ITEMS disagree, and deliberately:
  // upstream's rule is that any user message which is not a bare `tool_result` carrier breaks the run, and an
  // interrupt is the most emphatic break there is. Reading it off `items.length` (zero ⇒ neutral) would let the
  // reads before an interrupt and the reads after it merge into ONE summary row with the interrupt invisible
  // inside it — so the predicate is asked directly here rather than inferred from what projected.
  if (isInterruptSentinel(entry.message)) return "breaker";
  if (items.length === 0) return "neutral";
  const content = contentBlocks(entry.message);
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

/** F4 Task 10c: `Jbn` (L425363) — how many messages a collapsed teammate row is standing in for. A per-entry
 *  projection cannot answer it: upstream coalesces ADJACENT same-name messages and anything else in the
 *  stream (a panel, a leader message, a local visual) closes the run. `undefined` means "this entry is not
 *  part of any run", which is also the signal that closes an open one. */
const teammateRun = (message: Record<string, unknown>, options: ProjectionOptions): { name: string; count: number } | undefined => {
  if (options.projection !== "detail-collapsed" || !isNested(message)) return undefined;
  const count = nestedTexts(message).length;
  return count === 0 ? undefined : { name: teammateName(String(message.parent_tool_use_id), options), count };
};

function buildAnchoredEntries(document: TranscriptDocument, options: ProjectionOptions): Anchored[] {
  const anchored: Anchored[] = [];
  const occurrences = new Map<string, number>();
  let open: { name: string; count: number; record: Anchored } | undefined;
  for (const entry of document.entries()) {
    // A local visual breaks a fold run because it DRAWS between the two halves. One that projects to nothing
    // in this projection (a transcript-only info notice under compact) draws no such thing, so it is neutral
    // there and the reads around it still fold into one row — the same reasoning as the absorbed teammate
    // frame below, and the opposite of the interrupt sentinel, whose break is asserted rather than observed.
    if (entry.kind === "local-event") {
      const items = projectLocalEvent(entry, options);
      open = undefined; anchored.push({ sequence: entry.sequence, rank: 0, items, atom: items.length === 0 ? "neutral" : "breaker" }); continue;
    }
    const key = entry.identity ?? hashMessage(entry.message);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const run = teammateRun(entry.message, options);
    // ABSORB. The run's row belongs to the FIRST frame's anchor — it is already published there, and moving
    // it would re-key a settled item — so the count is rewritten in place and this frame anchors nothing.
    // The record is still pushed (empty) rather than skipped: sequences must stay dense for the sort.
    if (run !== undefined && open !== undefined && open.name === run.name) {
      open.count += run.count;
      const first = open.record.items[0];
      if (first?.kind === "line") open.record.items = [{ ...first, line: teammateCollapsedLine(open.name, open.count, teammateHint(options)) }];
      anchored.push({ sequence: entry.sequence, rank: 0, items: [], atom: "neutral" });
      continue;
    }
    const items = projectMessageEntry(entry, options, entry.identity ?? `${key}:${occurrence}`);
    const identity = sdkMessageIdentity(entry.message), thinking = identity === undefined ? undefined : thinkingSummaryOf(entry.message);
    const record: Anchored = {
      sequence: entry.sequence, rank: 0, items, atom: entryAtom(entry, items),
      ...(identity === undefined || thinking === undefined ? {} : { identity, thinking }),
    };
    anchored.push(record);
    open = run === undefined ? undefined : { name: run.name, count: run.count, record };
  }
  return anchored;
}

/** The blink repaint (`useChat` re-projects the transient region every 600 ms while a tool is open) calls
 *  `projectPending`, which folds the WHOLE anchored stream — so without a cache every frame re-renders every
 *  retained message, markdown and all, and a long resumed/attached transcript pays that per blink.
 *
 *  THE KEY IS `revision() × themeGeneration() × agentMetaGeneration() × columns × projection × verbose ×
 *  platform × expandHint`, and a hit requires ALL EIGHT unchanged. The knob half arrived with F4 Task 5
 *  and none of it is optional: `projectMessageEntry`
 *  no longer voids its options — it forwards `columns` (the width the markdown walker fits a table to),
 *  `platform` and a `projection`/`verbose`-derived `showThinking` into `renderMessage`. So one unmutated document at one
 *  revision now projects DIFFERENTLY per knob, and the old `revision × theme` key would serve whichever
 *  projection ran first to the other: compact and detail (ctrl+o) reads of the same document would agree on
 *  thinking visibility by call ORDER, and a ctrl+o read after a resize would serve stale-width markdown
 *  until the next document event (projection is event-driven; nothing re-projects on resize itself). Note
 *  `verbose` is currently implied by `projection` (only projectDetail sets it, as detail-all) but is keyed
 *  because it is an independent field on the type — same reasoning as showThinking's derivation. `platform`
 *  joined the key with F4 Task 8 and is NOT optional either, though the reasoning is different: it is
 *  process-constant in production, so Task 5 deliberately left it out — but the moment `withAssistantBullet`
 *  started switching `⏺`/`●` on it, `renderMessage` became platform-dependent and any caller that projects
 *  ONE document under two platforms (every test that does so, and any future host that reports a peer's
 *  platform) would be served the first one's glyph out of cache. A key input is decided by what the render
 *  reads, not by how often it changes.
 *
 *  WHAT THE CACHED BUILDER ACTUALLY READS, field by field — the honest list, because F4 Task 10c made the
 *  old blanket sentence ("everything else enters strictly later, in uncached code") false:
 *   · `columns`/`projection`/`verbose`/`platform`/`expandHint` — read here, and keyed (above).
 *   · `toolEvents` — read here since Task 10c (`teammateName`/`teammateColorIndex` walk it to name and
 *     colour a child frame's agent), and NOT keyed: it is `document.toolEvents()`, injected by `projectAll`
 *     from the very document this cache is keyed on, so every write that can change it bumps `revision()`.
 *   · `agentMeta` — read here since Task 10c through the same two helpers, and KEYED via
 *     `agentMetaGeneration()`, because it is the one live input that is NOT document-derived: a `useRef`
 *     map that `ingestTaskFrame` mutates in place on a `task` event which appends nothing. A `task_started`
 *     naming a dispatch we never held (an attach) would otherwise leave the cached anonymous `@Agent`
 *     header standing until some unrelated write bumped the revision.
 *   · `cwd`/`home`/`now`/`thoughtMs`/`pending`/`bashHint` — genuinely NOT read here. They enter strictly
 *     LATER, in `renderToolEvent`, `groupItems` and `segmentRuns`, none of which is cached, which is what
 *     lets the 600 ms blink and the ticking thinking clause move while this stream holds still. (The
 *     teammate LIFECYCLE row rides that same uncached path — `renderToolEvent` — so it is fresh by
 *     construction; only the message/collapsed rows built in here need the generation.)
 *  `projectLocalEvent` reads exactly three — `projection`, `platform` and (since E2) `expandHint`, for the
 *  compact boundary's re-derived row — and all three are already key inputs, so its one derived row cannot
 *  be served across a projection switch OR across a `/tui` flip (the flip moves `expandHint`, which is what
 *  puts it in the key; `fullscreen` itself is deliberately not keyed — see below).
 *
 *  The theme is a key input because `renderMessage` → markdown/highlight resolve theme tokens PER CALL
 *  (deliberately: a setTheme() must color the very next render — render.ts:47). A setTheme() touches no
 *  document, so `revision()` alone would serve the old palette out of cache. (Every theme-changing UI path
 *  today also appends a local notice, which bumps the revision — but that is an incidental coincidence, not
 *  something the cache may lean on, so the theme dependency is named here rather than assumed away.)
 *
 *  ACCUMULATION. `revision`/`theme`/`agents` stay on the OUTER entry and any change to any of them replaces
 *  it whole, so the inner per-knob map lives exactly one revision×theme×agents epoch. Within one epoch the live key set is tiny
 *  (compact, detail-collapsed, detail-all at one width) — but a resize DRAG bumps no revision, so an
 *  unbounded map would retain one fully projected transcript per column count crossed. Hence the LRU bound:
 *  insertion-ordered with a recency bump, `KNOB_KEYS` deep, the same idiom as markdown.ts's lexer cache.
 *
 *  Keyed by document in a WeakMap, so a replaced document (rewind, resume) drops its entry with itself. The
 *  cached array is copied out because callers own their list — `projectAll`/`projectPending` push tool anchors
 *  onto it and sort it in place — while the `Anchored` records inside it are never mutated and are shared. */
const KNOB_KEYS = 8;
const anchoredCache = new WeakMap<TranscriptDocument, { revision: number; theme: number; agents: number; byKnobs: Map<string, readonly Anchored[]> }>();
// `expandHint` joined the key with F4 Task 10b for exactly the reason `platform` joined it with Task 8: this
// stream now renders it (a `bash-output` sentinel's fold marker carries the chord), so a rebind that changes
// nothing in the document would otherwise be served the OLD sentence out of cache until the next append —
// which is the stale-hint dishonesty F2 shipped to end. A key input is decided by what the render reads.
// ABSENT ≠ EMPTY, and the two are opposite renders: an absent `expandHint` means "no hint threaded", and the
// producers fall back to `EXPAND_HINT_FALLBACK` (`(ctrl+o to expand)`); an explicit `""` means the chord is
// UNBOUND and the clause must not be printed at all. Collapsing both to `""` in the key served the fallback
// sentence to a projection that had just asked for silence — the dead-chord dishonesty again, cached. Hence
// the `=` marker: absent keys as nothing, an explicit value keys as `=<value>`, empty string included.
// `cwd` is deliberately NOT a key input even though the markdown walker now reads it (finding 3): it is fixed
// for the life of a `useChat` (`opts.cwd ?? process.cwd()`, never re-set — /add-dir adds ADDITIONAL dirs and
// leaves cwd alone, and an attach builds a fresh REPL rather than re-pointing a live one), so no cached row
// can outlive the value it was rendered against. Widening the key would only cost.
// `fullscreen` (Task 5) is NOT a key input either, by the same rule and not by omission: what it changes is the
// FOLD, and the fold runs strictly downstream of this cache (`foldAnchored`/`projectPending`, neither cached).
// `buildAnchoredEntries` never reads it, so two renderers legitimately share one anchored stream — and the one
// sentence the flag does move on a cached row, the expand chip, rides in on `expandHint`, which IS keyed.
const knobKey = (options: ProjectionOptions): string =>
  `${options.columns}|${options.projection}|${options.verbose}|${options.platform}|${options.expandHint === undefined ? "" : `=${options.expandHint}`}`;
/** DI-by-deps test seam: the builder is reached through this record, so a test can count rebuilds without
 *  reading the cache itself. Production never reassigns it. */
export const projectionDeps = { buildAnchored: buildAnchoredEntries };

function anchoredEntries(document: TranscriptDocument, options: ProjectionOptions): Anchored[] {
  // `agents` sits on the OUTER epoch beside `revision`/`theme`, not inside `knobKey`, for the reason the
  // ACCUMULATION note below gives: it is a global mutation counter, so a bump invalidates every knob at
  // once. Folding it into the knob string instead would leave the superseded compact/detail entries in the
  // LRU as dead weight and churn the 8-deep bound on a sidechannel that fires several times a turn.
  const revision = document.revision(), theme = themeGeneration(), agents = agentMetaGeneration(), key = knobKey(options);
  let entry = anchoredCache.get(document);
  if (entry === undefined || entry.revision !== revision || entry.theme !== theme || entry.agents !== agents) {
    entry = { revision, theme, agents, byKnobs: new Map() };
    anchoredCache.set(document, entry);
  }
  const hit = entry.byKnobs.get(key);
  if (hit !== undefined) { entry.byKnobs.delete(key); entry.byKnobs.set(key, hit); return [...hit]; }   // recency bump
  const anchored = projectionDeps.buildAnchored(document, options);
  if (entry.byKnobs.size >= KNOB_KEYS) { const oldest = entry.byKnobs.keys().next().value; if (oldest !== undefined) entry.byKnobs.delete(oldest); }
  entry.byKnobs.set(key, anchored);
  return [...anchored];
}

const bySequence = (a: Anchored, b: Anchored) => a.sequence - b.sequence || a.rank - b.rank;

/** memberId → its batch. The batch ANCHOR event (its first member) stands in for the whole unit in the
 *  anchored stream, so the fold sees one non-collapsible tool atom where it used to see N — which is the
 *  same run-breaking behaviour a standalone Agent already had, and identical in both projections. */
const batchByMember = (batches: readonly AgentBatch[]): ReadonlyMap<string, AgentBatch> =>
  new Map(batches.flatMap((batch) => batch.memberIds.map((id) => [id, batch] as const)));

function projectAll(document: TranscriptDocument, options: ProjectionOptions): readonly RenderItem[] {
  // The nested calls travel WITH the options (Task 7): an Agent's rows are derived from the document's other
  // events, and injecting them here keeps `renderToolEvent` a pure function of one call plus its context.
  const full: ProjectionOptions = { ...options, toolEvents: document.toolEvents() };
  const anchored = anchoredEntries(document, full);
  // F3 Task 8: a batched member never publishes on its own, and an INCOMPLETE batch publishes nothing at
  // all — every member stays inert to Static until the last result lands (`projectPending` draws it
  // meanwhile), exactly as `trailingRunCut` withholds a still-growable fold run. VERBOSE is what the batch
  // expands to: `bdf`'s very first statement is `if (r) return { messages: e }` (452545), so the ctrl+o
  // verbose form is the UNGROUPED one — each member back on Task 7's standalone path with its own `Done`
  // row. That is a narrower gate than the fold run's (`compact && !verbose`): a batch survives into the
  // collapsed detail view, which is exactly where upstream's `bdf` still groups.
  const batches = full.verbose ? [] : agentBatches(document.toolEvents()), batched = batchByMember(batches);
  for (const event of document.toolEvents()) {
    if (event.route !== "top-level" || !event.result || batched.has(event.id)) continue;
    anchored.push({ sequence: event.result.resultSequence, rank: 1, event, items: reid(renderToolEvent(event, normalizeToolResult(event, { verbose: full.verbose }), full), event.id, event.result.resultSequence) });
  }
  for (const batch of batches)
    if (batch.complete) anchored.push({ sequence: batch.anchorSequence, rank: 1, event: batch.members[0]!, items: agentBatchItems(batch, "published", full) });
  anchored.sort(bySequence);
  return full.projection === "compact" && !full.verbose ? foldAnchored(anchored, full) : anchored.flatMap((a) => a.items);
}

/** The one atom builder both folded projections share, and the gate that decides which tools the fold policy is
 *  even allowed to see. A tool anchor is a `tool` atom, with two reasons it stops being one:
 *  1. CLASSIC only — the tools we project to nothing (`isSuppressedTool`: ToolSearch/TaskCreate/TaskUpdate)
 *     become `neutral` and so JOIN the run they interrupt without earning a counter, approximating upstream's
 *     absorbed-silently branch (contract §1.2 accumulator row 4). That was a DELIBERATE DEVIATION from
 *     default-mode 2.1.220, whose `ds()`-gated policy (§1.1 case 4) falls through to case 6 and renders
 *     `⏺ ToolSearch(…)` STANDALONE, legitimately breaking the run: we render no row for those calls, so treating
 *     them as a break would split one summary into two adjacent rows with an invisible seam between them.
 *     Under `fullscreen` the deviation is RETIRED and the diversion lifts — canon 2.1.234 absorbs those names
 *     itself (`Krr` 236807–236809), `classifyToolEvent` classifies them `"silent"`, and routing them here would
 *     keep them out of `memberIds` and out of the anchor, which is precisely what the silent policy is for.
 *     TodoWrite/TaskGet/TaskList were never suppressed and always reached the policy; the gate is what makes
 *     the five-plus-one silent set behave uniformly instead of splitting three ways.
 *  2. Either renderer — `inert`: a call the compact projection has already PUBLISHED must not re-enter the
 *     dynamic region's fold (see `projectPending`).
 *  `fullscreen` defaults false, which is the classic gate above; Task 5 threads `ProjectionOptions.fullscreen`
 *  into every caller, so the flag now decides the diversion on live rows rather than only in unit tests. */
function foldAtoms(anchored: readonly Anchored[], opts: { thoughtMs?: ReadonlyMap<string, number>; inert?: (event: ToolEvent) => boolean; fullscreen?: boolean } = {}): FoldAtom[] {
  // One duration per MESSAGE, spent once. The engine emits one assistant frame per content block and all
  // of them share a single `message.id` (P82), while `LiveTurn` already sums every thinking block of that
  // id — so a message that arrived as two thinking frames would otherwise stamp its whole total twice.
  const spent = new Set<string>();
  return anchored.map((a, index): FoldAtom => {
    if (a.event !== undefined && (opts.fullscreen === true || !isSuppressedTool(a.event.name)) && !(opts.inert?.(a.event) ?? false)) return { kind: "tool", event: a.event };
    // `sequence` is the ARRAY back-pointer a `passthrough` replays through (see `foldAnchored`), so it must stay
    // the index; `messageSequence` carries the entry's real transcript sequence alongside it, which is what the
    // pop-out window test compares against a call's `callSequence`/`resultSequence`.
    if (a.atom === "breaker") return { kind: "breaker", sequence: index, messageSequence: a.sequence };
    // The thinking clock's one gate: a thought-bearing message (`a.thinking`) the caller's LIVE map has a
    // duration for. A disk-bootstrapped, replayed or attached entry is never in that map, so it earns no
    // clause without a single replay-side branch.
    const ms = a.identity === undefined || a.thinking === undefined || spent.has(a.identity) ? undefined : opts.thoughtMs?.get(a.identity);
    if (ms !== undefined) spent.add(a.identity!);
    return { kind: "neutral", sequence: index, messageSequence: a.sequence, ...(ms === undefined ? {} : { thoughtForMs: ms, thinkingSummary: a.thinking }) };
  });
}

/** The trailing run is the one accumulator `segmentRuns` flushes at the very end, and it is still GROWABLE:
 *  the next collapsible call joins it and would change its counts, its clause text and its membership-derived
 *  id. Ink's `<Static>` is append-only, so publishing it now and re-publishing it later would leave BOTH rows
 *  on screen — it (and the neutral items it deferred, which `segmentRuns` replays straight after it) must
 *  wait for the prose or standalone tool that closes the run. Until then `projectPending` carries the row in
 *  the DYNAMIC region — active while a member is still running, settled once they all are — so "withheld from
 *  Static" never means "invisible".
 *
 *  IT TAKES THE POLICY, and the failure if it does not is a DOUBLE ROW rather than a wrong one. "Still growable"
 *  is a classification question, so a fullscreen run ending in a non-read Bash is growable only when the flag is
 *  present; asked classically that run reads as settled, Static publishes the group, and `projectPending` — which
 *  folds the same stream under the same widened policy — draws the very same cluster again. Two rows on screen
 *  for one run, and the second is the one that keeps moving. */
function trailingRunCut(atoms: readonly FoldAtom[], items: readonly { kind: string }[], policy: FoldPolicy): number {
  let growing = false;
  for (const atom of atoms) {
    if (atom.kind === "neutral") continue;
    growing = atom.kind === "tool" && classifyToolEvent(atom.event, policy).collapsible;
  }
  if (!growing) return items.length;
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.kind === "group") return i;
  return items.length;
}

/** Compact-only (R6.1's inverse): the sorted anchor list becomes a fold-atom stream — index-keyed so a
 *  `passthrough` maps straight back to the entry's already-projected items — and `segmentRuns` decides which
 *  contiguous runs collapse. */
function foldAnchored(anchored: readonly Anchored[], options: ProjectionOptions): readonly RenderItem[] {
  const policy = foldPolicy(options);
  const atoms = foldAtoms(anchored, { thoughtMs: options.thoughtMs, ...policy });
  const standalone = new Map<ToolEvent, readonly RenderItem[]>(anchored.flatMap((a) => (a.event ? [[a.event, a.items] as const] : [])));
  const folded = segmentRuns(atoms, { cwd: options.cwd, home: options.home, ...policy });
  const visible = folded.slice(0, trailingRunCut(atoms, folded, policy));
  // T8's de-dup input (see `expandedMemberItems`): every call THIS stream gives a row of its own. Here that
  // is every `tool` item without exception — a non-collapsible tool renders its items, and the one that
  // renders none (an errored suppressed pop-out) gets the substitute row below.
  const emitted = new Set(visible.flatMap((item) => (item.kind === "tool" ? [item.event.id] : [])));
  const out: RenderItem[] = [];
  for (const item of visible) {
    if (item.kind === "group") { out.push(...groupItems(item.group, "published", options, emitted)); continue; }
    if (item.kind === "passthrough") { out.push(...(anchored[item.sequence]?.items ?? [])); continue; }
    // A popped-out failure whose own projection is empty gets the substitute row (see `poppedOnErrorItems`),
    // re-keyed exactly as `projectAll` keys a standalone unit so Static's append-once bookkeeping is unchanged.
    // The other three `popsOutOnError` names render normally and keep their real items.
    const items = standalone.get(item.event) ?? [];
    if (item.poppedOnError === true && items.length === 0 && item.event.result !== undefined) {
      out.push(...reid(poppedOnErrorItems(item.event, options), item.event.id, item.event.result.resultSequence)); continue;
    }
    out.push(...items);
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
  const batches = agentBatches(document.toolEvents()), batched = batchByMember(batches);
  // F3 Task 8: an INCOMPLETE batch is the one unit this region owns outright — Static has none of it, so it
  // draws here whole. Its members never anchor individually, in either projection.
  const batchItems = new Map<ToolEvent, readonly RenderItem[]>(), withheld = new Set<ToolEvent>();
  for (const event of document.toolEvents()) {
    if (event.route !== "top-level" || batched.has(event.id)) continue;
    // No `items` for either kind: this region renders group rows and per-call PENDING rows, both built below.
    if (event.result) { anchored.push({ sequence: event.result.resultSequence, rank: 1, event, items: [] }); continue; }
    if (liveIds === undefined || liveIds.has(event.id)) anchored.push({ sequence: event.callSequence, rank: 1, event, items: [] });
  }
  for (const batch of batches) {
    const anchor = batch.members[0]!;
    // The same live-turn rule the per-call rows follow: a disk-bootstrapped dangling batch is retained
    // history, not something that blinks — so it needs an OPEN member the live turn is actually running.
    if (!batch.complete && liveIds !== undefined && !batch.members.some((member) => member.result === undefined && liveIds.has(member.id))) continue;
    anchored.push({ sequence: batch.anchorSequence, rank: 1, event: anchor, items: [] });
    if (batch.complete) continue;                                   // published by `projectAll`; nothing to draw here
    withheld.add(anchor);
    batchItems.set(anchor, agentBatchItems(batch, "pending", full));
  }
  anchored.sort(bySequence);
  // The policy travels with BOTH folds below. They model the same screen from two sides — what Static already
  // holds, and what the dynamic region owes — so a flag on one and not the other is exactly the disagreement
  // that puts one cluster on screen twice.
  const policy = foldPolicy(options);
  const fold = { cwd: options.cwd, home: options.home, ...policy };
  // What Static already holds: the same fold the compact projection runs (open calls and withheld batches
  // inert there, exactly as `projectAll` omits them), minus the trailing run it withholds.
  const settledAtoms = foldAtoms(anchored, { thoughtMs: options.thoughtMs, ...policy, inert: (event) => !event.result || withheld.has(event) });
  const settled = segmentRuns(settledAtoms, fold);
  const published = new Set<string>();
  for (const item of settled.slice(0, trailingRunCut(settledAtoms, settled, policy)))
    if (item.kind === "group") for (const id of item.group.memberIds) published.add(id);
  const items: RenderItem[] = [];
  const dynamic = segmentRuns(foldAtoms(anchored, { thoughtMs: options.thoughtMs, ...policy, inert: (event) => published.has(event.id) }), fold);
  // T8's de-dup input, and this region's answer is NARROWER than the compact projection's: of the `tool`
  // items below, only a withheld batch and a still-OPEN call get a row here — a completed standalone was
  // published by `projectAll` and is skipped. So an errored pop-out (which by definition has a result) is
  // not emitted here, and an expanded cluster it stayed a member of therefore draws it, once.
  const emitted = new Set(dynamic.flatMap((item) => (item.kind === "tool" && (batchItems.has(item.event) || !item.event.result) ? [item.event.id] : [])));
  for (const item of dynamic) {
    if (item.kind === "group") { items.push(...groupItems(item.group, item.group.open ? "active" : "unclosed", full, emitted)); continue; }
    if (item.kind !== "tool") continue;
    // A withheld agent batch draws whole — its first member stands in for the unit, and one member having a
    // result says nothing about whether Static may have it (only "every member resolved" does).
    const batch = batchItems.get(item.event);
    if (batch !== undefined) { items.push(...batch); continue; }
    // A COMPLETED standalone tool is already published (only groups are ever withheld); only an open one has a row here.
    if (!item.event.result) items.push(...reid(renderToolEvent(item.event, normalizeToolResult(item.event, { verbose: false }), full), item.event.id, "pending"));
  }
  return items;
}

/** The sole gutter owner. `start`/`end` slice the body (the Ctrl-O pager scrolls a long result without re-projecting
 *  it); `showGutter={false}` keeps the five-column indent while dropping the connector for a continuation page.
 *  `rowSelections` (F9 T-MOUSE Task 6) is one entry per row THIS call paints, in the SAME order — length 1 for
 *  a `"line"` item, `body.length` for a `"gutter-block"` one — mirroring `FullscreenViewport.hitRowsOf`'s own
 *  per-slice row count exactly, since it is built from that identical flattening. `undefined` (every call site
 *  outside `FullscreenViewport`, and any frame with no live selection) paints nothing, matching every row's
 *  behaviour before this task existed. */
export function RenderItemView({ item, start, end, showGutter = true, rowSelections }: { item: RenderItem; start?: number; end?: number; showGutter?: boolean; rowSelections?: readonly (LineSelection | undefined)[] }): React.ReactElement {
  // LT10: a tool header truncates at the terminal edge (upstream `wrap:"truncate-end"`) — an MCP-length name
  // must never wrap one header into several transcript rows. Ordinary line items (assistant text, local
  // notices, dividers) carry no `wrap` and keep wrapping; body rows keep wrapping, fold already sized them.
  if (item.kind === "line") return <Line l={item.line} wrap={item.wrap} selection={rowSelections?.[0]} />;
  const body = item.body.slice(start ?? 0, end ?? item.body.length);
  // F9 T-MOUSE Task 3 — the gutter-block's own LEADING connector column (`⎿`) is the one dimmed run this
  // component paints OUTSIDE `Line.tsx` (every body row already goes through it, and un-dims there). Read
  // straight off the same context `FullscreenViewport` provides around the whole slice, so a hovered block's
  // connector brightens with its body rather than staying dim beside un-dimmed text underneath it.
  const hovered = useContext(HoverContext);
  return (
    <Box flexDirection="row">
      <Box width={item.gutter.length}><Text color={item.gutterStyle?.color} dimColor={hovered ? false : item.gutterStyle?.dim}>{showGutter ? item.gutter : ""}</Text></Box>
      <Box flexDirection="column">{body.map((line, i) => <Line key={i} l={line} selection={rowSelections?.[i]} />)}</Box>
    </Box>
  );
}
