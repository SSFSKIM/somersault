// appserver/items/types.ts — structured Item model (spec D10): id-stable shapes shared by the live
// TurnMapper (mapper.ts) and Task 5's transcript replay so live and replayed ids/items match exactly.
export type ToolView = "command" | "fileChange" | "fileRead" | "search" | "webSearch" | "webFetch" | "mcp" | "subagentTask" | "other";
export interface UserMessageItem { type: "userMessage"; id: string; text: string }
export interface AgentMessageItem { type: "agentMessage"; id: string; text: string; aborted?: true }
export interface ReasoningItem { type: "reasoning"; id: string; text: string; aborted?: true }
export interface ToolCallItem { type: "toolCall"; id: string; tool: string; view: ToolView; arguments: Record<string, unknown>; status: "inProgress" | "completed" | "failed"; result?: string; parentToolUseId?: string }
export type Item = UserMessageItem | AgentMessageItem | ReasoningItem | ToolCallItem;
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
