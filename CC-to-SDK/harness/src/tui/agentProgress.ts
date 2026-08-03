// tui/src/agentProgress.ts — F3 Task 7 (LT16/LT17): what an Agent unit knows about itself. Pure derivations
// over retained `ToolEvent`s plus ONE client-side map of the `system/task_*` sidechannel; no React, no clock
// of its own (`now` and every arrival stamp are injected, exactly like the thinking clock's).
//
// THE LADDER (P83, 11-p83-agent-usage-identity.md). The one thing no rung may ever do is SUM child `usage`:
// the child's context is re-read every turn, so summing overshoots the true total by 265–342% (and summing
// output alone undershoots by 94%). Three rungs, selected WHOLE — a rung supplies the numbers it carries and
// the row simply omits a clause it has no source for:
//   1. the recognized COMPLETED sidecar (P94 § Agent: `status:"completed"` + `totalToolUseCount` /
//      `totalTokens` / `totalDurationMs`). Presence is per CALL — 2 of 11 census Agent calls were flat-only.
//   2. `system/task_notification.usage` `{total_tokens, tool_uses, duration_ms}`, keyed by the Agent
//      `tool_use_id`. It matched the sidecar to within 1 ms on duration and 4.6% on tokens, arrives ~1 ms
//      BEFORE the tool_result, is emitted independently of `forwardSubagentText` — and is the ONLY totals
//      source at all for a PARALLEL dispatch, whose sidecar comes back `async_launched` with no totals.
//   3. client-derived: the tool-use count from the nested calls (exact on 5 of 5 dispatches) and the duration
//      from the dispatch→result local clock (±7 ms), with the token clause OMITTED. `Done (3 tool uses · 9s)`
//      is honest; `Done (… · 10.6k tokens · …)` off a sum would be a 265% lie.
import type { RenderLine } from "./render.js";
import { formatCompactNumber, formatDuration } from "./format.js";
import { callSidecar } from "./toolResult.js";
import type { ToolEvent } from "./transcriptModel.js";

/** The three numbers `system/task_progress`/`task_notification` carry (P83 [Q5]). Stored only when ALL
 *  three arrived numeric: half a rung on screen is a fabricated row. */
export interface AgentNotifyUsage { total_tokens: number; tool_uses: number; duration_ms: number; }
/** Everything the wire told us about one dispatch that is NOT in the retained document. `subagentType` and
 *  `taskType` are remembered from `task_started` because `task_notification` does not repeat them (P83), and
 *  `taskType` is what tells a `local_bash` task from a `local_agent` one (P84 — Task 9 reads it). The three
 *  stamps are LOCAL arrival times: P82/P83's rule that the wire carries no clock, so the honest duration is
 *  the one we measured on the host that spawned the CLI. */
export interface AgentMeta {
  taskId?: string; subagentType?: string; taskType?: string; description?: string;
  dispatchedAt?: number; startedAt?: number; firstChildAt?: number; resultAt?: number;
  notify?: AgentNotifyUsage;
}
export type AgentTotalsSource = "sidecar" | "notification" | "derived";
export interface AgentTotals { toolUses: number; tokens?: number; durationMs?: number; source: AgentTotalsSource; }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
const span = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** `Agent` and nothing else. 2.1.220's registry also names `Task`, but every Agent dispatch P83 and P94
 *  observed on OUR wire arrived as `Agent` — widening this would render a totals row for a shape no probe
 *  has ever seen. */
export const isAgentTool = (name: string): boolean => name === "Agent";
/** Upstream groups same-message tool calls on `${message.id}:${tool.name}` (census 01#253–257); our retained
 *  equivalent of "one assistant message" is the callSequence. Task 8's batch detection keys on this. */
export const agentBatchKey = (event: ToolEvent): string => `${event.callSequence}:${event.name}`;
/** Upstream `zVp` (429740): how many inner rows an open Agent shows before the hidden-count marker. */
export const AGENT_PROGRESS_ROWS = 3;
/** Upstream `KVp` (429822): the pre-first-progress-message placeholder. */
export const AGENT_INITIALIZING = "Initializing…";

/** The nested calls one Agent owns, in the order they were made. Task 8 reuses it for its per-agent rows. */
export function agentChildren(events: readonly ToolEvent[], parentId: string): readonly ToolEvent[] {
  return events.filter((e) => e.route === "nested" && e.parent_tool_use_id === parentId).sort((a, b) => a.callSequence - b.callSequence);
}

/** Rung 1's guard, as narrow as `toolResult`'s other shape guards: a sidecar that merely claims `completed`
 *  without a usable count is NOT this shape, and falls through to the rung below rather than rendering a
 *  count it does not have. Each optional number is then guarded at the clause that spells it out. */
function completedSidecar(event: ToolEvent): Record<string, unknown> | undefined {
  const sidecar = callSidecar(event);
  return sidecar !== undefined && sidecar.status === "completed" && int(sidecar.totalToolUseCount) !== undefined ? sidecar : undefined;
}

export function agentTotals(event: ToolEvent, meta: AgentMeta | undefined, children: readonly ToolEvent[], now: number): AgentTotals {
  const sidecar = completedSidecar(event);
  if (sidecar !== undefined) {
    const tokens = int(sidecar.totalTokens), durationMs = span(sidecar.totalDurationMs);
    return { toolUses: int(sidecar.totalToolUseCount)!, ...(tokens === undefined ? {} : { tokens }), ...(durationMs === undefined ? {} : { durationMs }), source: "sidecar" };
  }
  const notify = meta?.notify;
  if (notify !== undefined) return { toolUses: notify.tool_uses, tokens: notify.total_tokens, durationMs: notify.duration_ms, source: "notification" };
  // Dispatch→result, never first-child→result: an async dispatch's child frames arrive AFTER its result, so
  // the first-child proxy goes negative there (P83 [Q4], −2520 ms), while dispatch→result needs no child
  // frame to have been forwarded at all. An open call ticks against the caller's clock; a settled one reads
  // the stamp taken when its result arrived, so a later re-projection (ctrl+o) cannot inflate it.
  const from = meta?.dispatchedAt, to = event.result === undefined ? now : meta?.resultAt;
  const durationMs = from === undefined || to === undefined ? undefined : Math.max(0, to - from);
  return { toolUses: children.length, ...(durationMs === undefined ? {} : { durationMs }), source: "derived" };
}

/** Bundle 429650 verbatim: `` `Done (${[l === 1 ? "1 tool use" : `${l} tool uses`, yd(c) + " tokens", ra(a)].join(" · ")})` ``
 *  (`yd` is the census's `_d`; the row itself is a `⎿` gutter block with the bullet suppressed — see `Vha`)
 *  — with the clauses we have no source for simply absent from the join, which is the same assembly upstream
 *  performs and the only honest shape for the derived rung. */
export function agentDoneText(totals: AgentTotals): string {
  const parts = [totals.toolUses === 1 ? "1 tool use" : `${totals.toolUses} tool uses`];
  if (totals.tokens !== undefined) parts.push(`${formatCompactNumber(totals.tokens)} tokens`);
  if (totals.durationMs !== undefined) parts.push(formatDuration(totals.durationMs));
  return `Done (${parts.join(" · ")})`;
}
/** Upstream `bM({count, unit:"tool use", expandable:true})` (429740) — the same dim `… +N …` marker the
 *  output fold and the Write preview use, with the tool-use unit and the expand hint. */
export const hiddenToolUsesLine = (hidden: number): RenderLine => ({ text: `… +${hidden} tool use${hidden === 1 ? "" : "s"} (ctrl+o to expand)`, dim: true });

/** Prepend `pad` as its OWN plain segment (never merged into the first one): a tool header's first segment is
 *  the status-coloured bullet, and folding the indent into it would paint two coloured cells that upstream
 *  paints as plain background. */
export function indentRenderLine(line: RenderLine, pad: string): RenderLine {
  if (line.segments === undefined || line.segments.length === 0) return { ...line, text: pad + line.text };
  return { ...line, text: pad + line.text, segments: [{ text: pad }, ...line.segments] };
}

const entryFor = (meta: Map<string, AgentMeta>, id: string): AgentMeta => {
  const existing = meta.get(id);
  if (existing !== undefined) return existing;
  const fresh: AgentMeta = {}; meta.set(id, fresh); return fresh;
};

/** One `system/task_*` frame → the map. The join key is `tool_use_id` (P83 [Q5]: the sidechannel is keyed by
 *  it, NOT ptid-routed), so a frame without one — the host's synthetic rewind notification — is ignored
 *  rather than guessed at. Both wire shapes are accepted because the host forwards whichever arrived: a
 *  `system` envelope with a `subtype`, or a bare type tag. `task_progress` is deliberately NOT ingested: it
 *  is a RUNNING counter and the completed row must read the settled one. */
export function ingestTaskFrame(meta: Map<string, AgentMeta>, frame: unknown, now: number): void {
  if (!isRecord(frame)) return;
  const sub = frame.type === "system" ? frame.subtype : frame.type;
  const id = str(frame.tool_use_id);
  if (id === undefined) return;
  if (sub === "task_started") {
    const entry = entryFor(meta, id);
    const taskId = str(frame.task_id), subagentType = str(frame.subagent_type), taskType = str(frame.task_type), description = str(frame.description);
    if (taskId !== undefined) entry.taskId = taskId;
    if (subagentType !== undefined) entry.subagentType = subagentType;
    if (taskType !== undefined) entry.taskType = taskType;
    if (description !== undefined) entry.description = description;
    entry.startedAt ??= now;
    return;
  }
  if (sub !== "task_notification") return;
  const usage = isRecord(frame.usage) ? frame.usage : undefined;
  const total_tokens = int(usage?.total_tokens), tool_uses = int(usage?.tool_uses), duration_ms = span(usage?.duration_ms);
  if (total_tokens === undefined || tool_uses === undefined || duration_ms === undefined) return;   // a partial rung is not a rung
  entryFor(meta, id).notify = { total_tokens, tool_uses, duration_ms };
}

/** The tools whose dispatch is worth a stamp: the Agent whose duration this module reports, and the Bash
 *  whose `task_started` (P84) Task 9's background hint is gated on. */
const DISPATCH_TOOLS = new Set(["Agent", "Bash"]);
const blocksOf = (message: Record<string, unknown>): Record<string, unknown>[] => {
  const inner = message.message, content = isRecord(inner) ? inner.content : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
};
/** One COMPLETE host message → the local arrival stamps. Every stamp is first-write-wins, so a follow
 *  replay or a redelivered bootstrap frame cannot move a duration that has already been measured. */
export function stampAgentCalls(meta: Map<string, AgentMeta>, message: unknown, now: number): void {
  if (!isRecord(message)) return;
  const parent = str(message.parent_tool_use_id);
  if (message.type === "assistant") {
    // A NESTED frame dispatches nothing of ours: it marks the moment the subagent first spoke.
    if (parent !== undefined) { entryFor(meta, parent).firstChildAt ??= now; return; }
    for (const block of blocksOf(message)) {
      const id = str(block.id);
      if (block.type === "tool_use" && id !== undefined && DISPATCH_TOOLS.has(String(block.name))) entryFor(meta, id).dispatchedAt ??= now;
    }
    return;
  }
  if (message.type !== "user" || parent !== undefined) return;
  for (const block of blocksOf(message)) {
    const id = str(block.tool_use_id);
    if (block.type !== "tool_result" || id === undefined) continue;
    const entry = meta.get(id);                                                // only a call we stamped a dispatch for
    if (entry !== undefined) entry.resultAt ??= now;
  }
}
