// appserver/items/types.ts — structured Item model (spec D10): id-stable shapes shared by the live
// TurnMapper (mapper.ts) and Task 5's transcript replay so live and replayed ids/items match exactly.
import type { ReviewFinding } from "../reviewFindings.js";

export type ToolView = "command" | "fileChange" | "fileRead" | "search" | "webSearch" | "webFetch" | "mcp" | "subagentTask" | "other";
export interface UserMessageItem { type: "userMessage"; id: string; text: string }
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
 *  tool call they came from. */
export interface ReviewItem { type: "review"; id: string; findings: ReviewFinding[]; unstructured: boolean; level?: string; prose?: string }
export type Item = UserMessageItem | AgentMessageItem | ReasoningItem | ToolCallItem | ReviewItem;
export type ItemDeltaChannel = "text" | "thinking" | "arguments";
export type ItemEvent = { kind: "started"; item: Item } | { kind: "delta"; itemId: string; channel: ItemDeltaChannel; delta: string } | { kind: "completed"; item: Item };

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
