// appserver/items/replay.ts — persisted-transcript replay (spec D10): runs a saved session's frames
// through a FRESH TurnMapper (the same reducer the live path uses) so replayed item ids/shapes are
// byte-identical to what the live stream produced. User-prompt frames (no tool_result) bypass the
// mapper — TurnMapper has no live counterpart for them — and become userMessage items directly.
import type { Item } from "./types.js";
import { TurnMapper, userItem } from "./mapper.js";

function promptText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return String((content as any[]).find((b) => b?.type === "text")?.text ?? "");
  return "";
}

export function itemsFromTranscript(messages: unknown[]): Item[] {
  const mapper = new TurnMapper();
  const items: Item[] = [];
  for (const frame of messages) {
    const f = frame as any;
    if (f?.type === "user") {
      const content = f.message?.content;
      const hasToolResult = Array.isArray(content) && content.some((b: any) => b?.type === "tool_result");
      if (!hasToolResult) { items.push(userItem(promptText(content), String(f.uuid ?? ""))); continue; }
    }
    for (const ev of mapper.ingest(frame)) if (ev.kind === "completed") items.push(ev.item);
  }
  for (const ev of mapper.finalize(false)) if (ev.kind === "completed") items.push(ev.item);
  return items;
}
