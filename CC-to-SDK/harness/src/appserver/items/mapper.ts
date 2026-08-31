// appserver/items/mapper.ts — pure reducer: SDK turn frames (stream_event partials + full assistant/user)
// → structured ItemEvent[] (started/delta/completed). Mirrors tui/liveTurn.ts's frame routing (stream_event /
// parent_tool_use_id / assistant / user) but emits id-stable Items instead of render lines. No I/O, no clock
// unless injected — Task 5's transcript replay must derive identical ids from the persisted frames.
import type { Item, ItemEvent, AgentMessageItem, ReasoningItem, ToolCallItem, UserMessageItem } from "./types.js";
import { toolView } from "./types.js";

function firstResultLine(content: unknown): string {
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";
  return text.split("\n").map((s) => s.trim()).find((s) => s.length) ?? "";
}

export function userItem(text: string, uuid: string): UserMessageItem {
  return { type: "userMessage", id: uuid, text };
}

/** A user item for a message THIS user did not write: a cross-session arrival (M9). Same shape and same id
 *  rule as `userItem` — the id is the frame's own uuid, which is how a client dedupes the live item against
 *  the one `thread/read` returns — plus the `origin` that says who sent it.
 *
 *  Its own constructor rather than an optional third parameter on `userItem`, because the two say different
 *  things: an ordinary prompt has NO origin to carry, and a call site that could pass one and didn't would
 *  be indistinguishable from one that had nothing to pass. All THREE paths an arrival reaches a client by
 *  build the item here — the live drain (peerAdoption.ts), the cold replay of a persisted peer row and the
 *  projection of a logged entry (items/project.ts) — so the three cannot disagree about its shape. */
export function arrivalItem(text: string, uuid: string, origin: Record<string, unknown>): UserMessageItem {
  return { type: "userMessage", id: uuid, text, origin };
}

/** M5 Task 13 (spec D-M5-22): 0.3.234 delivers a `/context` turn's structured card as `context_usage`, a
 *  WRAPPER-LEVEL sibling on the assistant frame — `frame.context_usage`, not `frame.message.context_usage`
 *  (probe 111 measured the inner one absent, which is also why it is never replayed to the model). The
 *  frame's markdown table stays on `message.content` and is still the canonical fallback, so the item
 *  itself is unchanged; the twin rides beside it on the events this frame produced (`items/types.ts` says
 *  why every event and not only the completion).
 *
 *  Read off the WRAPPER only. A reader that fell back to the inner key would be reading a place the engine
 *  never writes, and would still pass any test that exercises only the real shape.
 *
 *  A frame that produced no events has nothing to stamp, so a twin riding one would be dropped. The one
 *  such case is the reconcile frame of a message already itemized through `stream_event` partials
 *  (`onAssistant`'s `streamedMsgIds` dedup). That bound was parked here as UNOBSERVED — probe 111's
 *  `/context` frame list carried no `stream_event`, but it opened its session WITHOUT
 *  `includePartialMessages`, under which the SDK emits no partials for ANY message, so the absence was a
 *  property of the probe's options and said nothing about `/context` (review F4).
 *
 *  IT IS NO LONGER UNOBSERVED. The final review ran exactly the configuration that settles it, keyed: a
 *  thread opened WITH `includePartialMessages: true` running a `/context` turn. The CLI-synthesized
 *  assistant frame carrying `context_usage` produced NO `stream_event` partials (its id reached
 *  `onAssistant` with previously-streamed false), and the real frames fed through this mapper produced two
 *  events, both carrying `contextUsage`. So the dedup path cannot drop the twin on this CLI, and the
 *  reconcile path stays unbuilt on a measurement rather than on a park. It remains a bound, not a
 *  guarantee: it is one CLI build's behaviour, and a future `/context` that streams would put the twin on
 *  a frame with no events again. `onAssistant`'s early return carries the other half of this note. */
function stampContextUsage(events: ItemEvent[], frame: { context_usage?: unknown }): ItemEvent[] {
  const usage = frame?.context_usage;
  if (usage === undefined || usage === null) return events;
  for (const ev of events) if (ev.kind !== "delta") ev.contextUsage = usage;
  return events;
}

export class TurnMapper {
  private msgId?: string;                              // current message id (from message_start / full frame)
  private blockIndexToId = new Map<number, string>();   // in-flight message's block index -> item id (stream path)
  private open = new Map<string, Item>();               // itemId -> in-progress agentMessage/reasoning item (stream path only)
  private streamedMsgIds = new Set<string>();           // msgIds seen via stream_event — guards the full-frame reconcile (no dup)
  private argBuffers = new Map<string, string>();       // toolu id -> accumulated input_json_delta raw JSON
  private tools = new Map<string, ToolCallItem>();      // toolu id -> tool item (open or closed), for tool_result lookup

  ingest(frame: unknown): ItemEvent[] {
    const f = frame as any;
    if (f?.type === "stream_event") return this.onStreamEvent(f.event);
    if (f?.parent_tool_use_id) return [];               // nested/subagent frame: attribution only, not itemized (M1)
    if (f?.type === "assistant") return this.onAssistant(f);
    if (f?.type === "user") return this.onUser(f);
    return [];                                           // result/system/unknown → ignored
  }

  private onStreamEvent(e: any): ItemEvent[] {
    if (!e) return [];
    if (e.type === "message_start") {
      this.msgId = String(e.message?.id ?? "");
      this.blockIndexToId.clear();
      return [];
    }
    if (e.type === "content_block_start") {
      const i = e.index, cb = e.content_block ?? {};
      const msgId = this.msgId ?? "";
      if (cb.type === "text") {
        const id = `${msgId}#${i}`;
        const item: AgentMessageItem = { type: "agentMessage", id, text: String(cb.text ?? "") };
        this.blockIndexToId.set(i, id); this.open.set(id, item); this.streamedMsgIds.add(msgId);
        return [{ kind: "started", item }];
      }
      if (cb.type === "thinking") {
        const id = `${msgId}#${i}`;
        const item: ReasoningItem = { type: "reasoning", id, text: String(cb.thinking ?? "") };
        this.blockIndexToId.set(i, id); this.open.set(id, item); this.streamedMsgIds.add(msgId);
        return [{ kind: "started", item }];
      }
      if (cb.type === "tool_use") {
        const id = String(cb.id ?? "");
        const item: ToolCallItem = { type: "toolCall", id, tool: String(cb.name ?? ""), view: toolView(String(cb.name ?? "")), arguments: cb.input ?? {}, status: "inProgress" };
        this.blockIndexToId.set(i, id); this.tools.set(id, item); this.argBuffers.set(id, ""); this.streamedMsgIds.add(msgId);
        return [{ kind: "started", item }];
      }
      return [];
    }
    if (e.type === "content_block_delta") {
      const id = this.blockIndexToId.get(e.index);
      if (!id) return [];
      const d = e.delta ?? {};
      if (d.type === "text_delta") {
        const delta = String(d.text ?? "");
        const item = this.open.get(id) as AgentMessageItem | undefined;
        if (item) item.text += delta;
        return [{ kind: "delta", itemId: id, channel: "text", delta }];
      }
      if (d.type === "thinking_delta") {
        const delta = String(d.thinking ?? "");
        const item = this.open.get(id) as ReasoningItem | undefined;
        if (item) item.text += delta;
        return [{ kind: "delta", itemId: id, channel: "thinking", delta }];
      }
      if (d.type === "input_json_delta") {
        const delta = String(d.partial_json ?? "");
        this.argBuffers.set(id, (this.argBuffers.get(id) ?? "") + delta);
        return [{ kind: "delta", itemId: id, channel: "arguments", delta }];
      }
      return [];                                         // signature_delta etc. → ignored
    }
    if (e.type === "content_block_stop") {
      const id = this.blockIndexToId.get(e.index);
      if (!id) return [];
      const openItem = this.open.get(id);
      if (openItem) { this.open.delete(id); return [{ kind: "completed", item: openItem }]; }
      const tool = this.tools.get(id);
      if (tool && this.argBuffers.has(id)) {
        const raw = this.argBuffers.get(id) ?? ""; this.argBuffers.delete(id);
        if (raw) { try { tool.arguments = JSON.parse(raw); } catch { tool.arguments = {}; } }
      }
      return [];                                         // tool stays inProgress until its tool_result
    }
    return [];                                           // message_delta (turn-level usage) → not item-level (M1)
  }

  private onAssistant(mm: any): ItemEvent[] {
    const msgId = String(mm.message?.id ?? "");
    // Already itemized via stream_event — no dup. This return is AHEAD of `stampContextUsage`, and that is
    // a bounded consequence rather than an oversight (D-M5-22 residual, decided in fix wave E): those item
    // events went out while the message was streaming, so a `context_usage` wrapper key arriving now has no
    // event of its own to ride, and delivering it would mean a new notification carrying no item. The only
    // producer we have measured — a `/context` turn under `includePartialMessages: true` — does not stream
    // this frame, so the twin reaches both events by the normal path.
    if (msgId && this.streamedMsgIds.has(msgId)) return [];
    const content: any[] = mm.message?.content ?? [];
    const out: ItemEvent[] = [];
    content.forEach((b, i) => {
      if (b?.type === "text") {
        const item: AgentMessageItem = { type: "agentMessage", id: `${msgId}#${i}`, text: String(b.text ?? "") };
        out.push({ kind: "started", item }, { kind: "completed", item });
      } else if (b?.type === "thinking") {
        const item: ReasoningItem = { type: "reasoning", id: `${msgId}#${i}`, text: String(b.thinking ?? "") };
        out.push({ kind: "started", item }, { kind: "completed", item });
      } else if (b?.type === "tool_use") {
        const id = String(b.id ?? "");
        const item: ToolCallItem = { type: "toolCall", id, tool: String(b.name ?? ""), view: toolView(String(b.name ?? "")), arguments: b.input ?? {}, status: "inProgress" };
        this.tools.set(id, item);
        out.push({ kind: "started", item });
      }
    });
    return stampContextUsage(out, mm);
  }

  private onUser(mm: any): ItemEvent[] {
    const out: ItemEvent[] = [];
    for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_result") continue;
      const tool = this.tools.get(String(b.tool_use_id ?? ""));
      if (!tool) continue;
      if (tool.status !== "inProgress") continue;         // duplicate tool_result for an already-closed tool: ignore (no re-completion, no mutation)
      tool.status = b.is_error ? "failed" : "completed";
      tool.result = firstResultLine(b.content);
      out.push({ kind: "completed", item: tool });
    }
    return out;
  }

  /** Turn end (normal completion or interruption): settle every still-open item. */
  finalize(interrupted: boolean): ItemEvent[] {
    const out: ItemEvent[] = [];
    for (const item of this.open.values()) {
      if (interrupted && (item.type === "agentMessage" || item.type === "reasoning")) item.aborted = true;
      out.push({ kind: "completed", item });
    }
    this.open.clear();
    for (const tool of this.tools.values()) {
      if (tool.status !== "inProgress") continue;
      tool.status = interrupted ? "failed" : "completed";
      out.push({ kind: "completed", item: tool });
    }
    return out;
  }
}
