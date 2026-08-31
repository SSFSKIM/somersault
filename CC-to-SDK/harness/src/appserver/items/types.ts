// appserver/items/types.ts — structured Item model (spec D10): id-stable shapes shared by the live
// TurnMapper (mapper.ts) and Task 5's transcript replay so live and replayed ids/items match exactly.
import type { ReviewFinding } from "../reviewFindings.js";

export type ToolView = "command" | "fileChange" | "fileRead" | "search" | "webSearch" | "webFetch" | "mcp" | "subagentTask" | "other";
/** `origin` marks a message the local user did not write — an M9 cross-session arrival, carrying the
 *  sender attribution VERBATIM as the engine stamped it (`verifiedPeerPid` is the only field in that
 *  exchange the kernel vouches for, so re-deriving it would substitute this server's opinion). Additive and
 *  optional: an ordinary prompt has none, and a client built before M9 ignores the field rather than
 *  breaking on it. It is what lets a client render an arrival AS an arrival on all three paths it can reach
 *  one by — live, replayed from the transcript, projected from the arrival log. */
export interface UserMessageItem { type: "userMessage"; id: string; text: string; origin?: Record<string, unknown> }
export interface AgentMessageItem { type: "agentMessage"; id: string; text: string; aborted?: true }
export interface ReasoningItem { type: "reasoning"; id: string; text: string; aborted?: true }
export interface ToolCallItem { type: "toolCall"; id: string; tool: string; view: ToolView; arguments: Record<string, unknown>; status: "inProgress" | "completed" | "failed"; result?: string; parentToolUseId?: string }
/** M4 §review: one review verdict, carrying exactly what the `review/findings` notification carries minus
 *  the envelope (`item/completed` already names the thread and the turn). It exists so a client that
 *  subscribes to ITEMS alone still renders the review inline with the rest of the turn — and, because
 *  items ride the per-turn replay buffer (turns.ts's `emitItems`) while notifications are live-only, so a
 *  client that joins mid-review still receives every verdict already reached.
 *
 *  The ONLY Item no `TurnMapper` ever produces: it is derived from a tool call's INPUT rather than from
 *  the frame's own shape, so review.ts emits it directly. That also means it never appears in a transcript
 *  replay (items/replay.ts) — a completed review's findings live in its transcript as the `ReportFindings`
 *  tool call they came from.
 *
 *  `aborted` carries the same meaning it does on the two items above, and is set for the same reason: a
 *  review turn that was interrupted or failed still reaches this item with an empty findings list, and
 *  untagged that is indistinguishable from a review that finished and found nothing. Stamped by review.ts
 *  rather than by `finalize` only because no mapper owns this item. */
export interface ReviewItem { type: "review"; id: string; findings: ReviewFinding[]; unstructured: boolean; level?: string; prose?: string; aborted?: true }
export type Item = UserMessageItem | AgentMessageItem | ReasoningItem | ToolCallItem | ReviewItem;
export type ItemDeltaChannel = "text" | "thinking" | "arguments";
/** `contextUsage` (M5 Task 13, spec D-M5-22): 0.3.234's structured twin of the `/context` report, carried
 *  by the SDK as a WRAPPER-LEVEL sibling on the assistant frame that delivers the markdown table — probe
 *  111 measured `message.context_usage` absent, and the result frame carrying nothing at all, which is the
 *  measurement that decided this shape: result frames are resolved into the submit waiter and never
 *  relayed to fleet followers, so a result-frame carrier would have been unreachable on that origin.
 *
 *  It rides the EVENT rather than the Item because it describes the FRAME, not any block inside it, and it
 *  rides EVERY event that frame produced rather than only the completion: a frame whose only block is a
 *  `tool_use` emits a `started` and no `completed` until its result lands, and stamping completions alone
 *  would drop the twin for it. Relayed VERBATIM (`unknown`) — it is an SDK-owned payload, and this server
 *  re-describing `SDKContextUsage` would be a second shape to keep in step with the first.
 *
 *  NO RETENTION: nothing on `ThreadRecord` holds it, and `thread/contextUsage/read` is untouched — that
 *  route answers from `getContextUsage()`, which is richer and costs no turn, where the twin is obtainable
 *  only by spending a `/context` turn. This is additive to the turn's own event stream, not a replacement
 *  for that read. */
export type ItemEvent = { kind: "started"; item: Item; contextUsage?: unknown } | { kind: "delta"; itemId: string; channel: ItemDeltaChannel; delta: string } | { kind: "completed"; item: Item; contextUsage?: unknown };

export function toolView(name: string): ToolView {
  if (name.startsWith("mcp__")) return "mcp";
  switch (name) {
    case "Bash": case "BashOutput": case "KillShell": return "command";
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit": return "fileChange";
    case "Read": return "fileRead";
    case "Grep": case "Glob": return "search";
    case "WebSearch": return "webSearch";
    case "WebFetch": return "webFetch";
    case "Task": case "Agent": return "subagentTask";
    default: return "other";
  }
}
