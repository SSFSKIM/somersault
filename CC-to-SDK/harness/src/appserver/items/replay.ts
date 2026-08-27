// appserver/items/replay.ts — persisted-transcript replay (spec D10): runs a saved session's frames
// through a FRESH TurnMapper (the same reducer the live path uses) so replayed item ids/shapes are
// byte-identical to what the live stream produced. User-prompt frames (no tool_result) bypass the
// mapper — TurnMapper has no live counterpart for them — and become userMessage items directly.
// Task 9: a real on-disk transcript also carries CLI bookkeeping rows (slash-command echoes, local
// command output, caveats, compaction summaries) that must never surface as ordinary user messages —
// `rowKind` (src/sessions/rows.ts, the same classifier tui/replay.ts uses) filters those out first.
//
// Task 11 (I3e): the flattener is `flattenForDisplay` (session/turnInput.ts), the SAME function
// `turns.ts`'s `submitRunner` calls for the LIVE user item — a persisted content array is exactly the
// `UserContentBlock[]` `session.ts`'s `userTurn` built it from (`normalizeTurnInput`'s own output), so
// calling the identical function on the identical shape is what makes a replayed image turn's text
// byte-identical to its live twin, `[Image #N]` label included, rather than two flatteners that merely
// happen to agree today.
import type { Item } from "./types.js";
import { TurnMapper, userItem } from "./mapper.js";
import { rowKind } from "../../sessions/rows.js";
import { flattenForDisplay, type UserTurnInput } from "../../session/turnInput.js";

const PHANTOM_ROW_KINDS = new Set(["command_echo", "command_output", "caveat", "compact_summary"]);

export function itemsFromTranscript(messages: unknown[]): Item[] {
  const mapper = new TurnMapper();
  const items: Item[] = [];
  for (const frame of messages) {
    if (PHANTOM_ROW_KINDS.has(rowKind(frame))) continue;
    const f = frame as any;
    // `!f.parent_tool_use_id` mirrors TurnMapper.ingest EXACTLY (it discards every nested/subagent frame
    // before its own type routing): a persisted `user` row taking this direct path first would surface a
    // subagent's prompt as an ordinary top-level user message, which the live path never emits — and the
    // cold-vs-live id stitch rests on the two paths producing identical items. Nested rows fall through to
    // the mapper, which drops them.
    if (f?.type === "user" && !f.parent_tool_use_id) {
      const content = f.message?.content;
      const hasToolResult = Array.isArray(content) && content.some((b: any) => b?.type === "tool_result");
      if (!hasToolResult) {
        // Task 10c: a PEER arrival's display text is the FRAMER's, not ours — the same rule the live
        // arrival path follows (peerInbound.ts's `noteArrival`), and the reason this branch needs it: the
        // comment above says the cold-vs-live id stitch rests on the two paths producing identical items,
        // and Task 10b already made both paths give this arrival the frame's own uuid. Same id with
        // different text is worse than either alone — a client that dedupes by id would then render
        // whichever copy it happened to see first. The raw persisted `content` also carries a CLI-added
        // preamble ("Another Claude session sent a message: "), so it is not what the peer sent either.
        const body = f.origin?.kind === "peer" && typeof f.origin.body === "string" ? f.origin.body : undefined;
        items.push(userItem(body ?? flattenForDisplay(content as UserTurnInput), String(f.uuid ?? "")));
        continue;
      }
    }
    for (const ev of mapper.ingest(frame)) if (ev.kind === "completed") items.push(ev.item);
  }
  for (const ev of mapper.finalize(false)) if (ev.kind === "completed") items.push(ev.item);
  return items;
}
