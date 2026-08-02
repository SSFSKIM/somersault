// tui/src/liveTurn.ts — the TRANSIENT live region ONLY (F1 Task 4): the partial `stream_event` text/thinking
// snapshot of the message that is streaming right now, plus the turn's running output-token count.
// It renders NO tool row and NO completed message: a COMPLETE assistant/user message belongs to the retained
// `TranscriptDocument` (Task 1) and an open tool call to `projectPending` (Task 3), so nothing here can put a
// second copy of either on screen. Pure reducer — no React, no SDK.
import type { RenderLine } from "./render.js";
import { withAssistantBullet } from "./render.js";
import { renderMarkdown } from "./markdown.js";
import { resolveThemeColor, themeTokens } from "./theme.js";

// F1 Task 2 role map: a failed turn's line is `error`. Read per snapshot (never cached) so a mid-session
// /theme change repaints the in-flight turn on the next frame.
const role = (name: "error") => resolveThemeColor(themeTokens()[name]);

type Block =
  | { kind: "text"; index: number; text: string }
  | { kind: "thinking"; index: number; text: string; collapsed: boolean };

const ev = (m: any) => (m?.type === "stream_event" ? m.event : undefined);
function collapseThinking(blocks: Block[]): void { for (const b of blocks) if (b.kind === "thinking") b.collapsed = true; }

export class LiveTurn {
  private current: Block[] = [];       // partial blocks of the in-flight message, in start order
  private errorLine?: string;
  model?: string;                      // captured from the first assistant frame's message.model
  private committedTokens = 0;         // summed output tokens of completed messages this turn
  private currentMsgTokens = 0;        // running output tokens of the in-flight message (message_delta usage, resets per message)
  /** Real running output-token count for the WHOLE turn (committed messages + the in-flight one). */
  get outputTokens(): number { return this.committedTokens + this.currentMsgTokens; }

  /** Feed one frame from the host event stream. Ignores every frame that is not a partial or a completed
   *  assistant/user message. */
  ingest(m: unknown): void {
    const e = ev(m);
    if (e) { this.onStreamEvent(e); return; }
    const mm = m as any;
    if (mm?.type !== "assistant" && mm?.type !== "user") return;
    // A NESTED (subagent) message rides the same stream but belongs to its own turn: it supersedes nothing
    // here, so it must neither wipe the partials the parent is still streaming nor claim the turn's model.
    if (typeof mm.parent_tool_use_id === "string" && mm.parent_tool_use_id) return;
    if (mm.type === "assistant" && !this.model && mm.message?.model) this.model = String(mm.message.model);
    // The document owns this message from here on — drop the partials it supersedes, or the same text
    // renders twice (once transient, once published).
    this.current = [];
  }

  fail(message: string): void { this.errorLine = message; }

  /** Current live-region lines; call after each ingest. */
  snapshot(): RenderLine[] {
    const out = this.current.flatMap((b) => this.renderBlock(b));
    if (this.errorLine) out.push({ text: `✗ ${this.errorLine}`, color: role("error") });
    return out;
  }

  private find(index: number): Block | undefined { return this.current.find((b) => b.index === index); }

  private onStreamEvent(e: any): void {
    if (e.type === "message_start") { this.committedTokens += this.currentMsgTokens; this.currentMsgTokens = 0; this.current = []; return; }
    if (e.type === "content_block_start") {
      collapseThinking(this.current);                            // any new block collapses prior thinking
      const i = e.index, cb = e.content_block ?? {};
      if (cb.type === "thinking") this.current.push({ kind: "thinking", index: i, text: "", collapsed: false });
      else if (cb.type === "text") this.current.push({ kind: "text", index: i, text: "" });
      // tool_use partials are NOT tracked: the open call reaches the screen through projectPending, off the
      // retained document, the moment the complete assistant message lands.
      return;
    }
    if (e.type === "content_block_delta") {
      const b = this.find(e.index), d = e.delta ?? {};
      if (!b) return;
      if (b.kind === "text" && d.type === "text_delta") b.text += d.text ?? "";
      else if (b.kind === "thinking" && d.type === "thinking_delta") b.text += d.thinking ?? "";
      // input_json_delta / signature_delta → ignored
      return;
    }
    if (e.type === "message_delta" && e.usage && typeof e.usage.output_tokens === "number") this.currentMsgTokens = e.usage.output_tokens;
    // content_block_stop / message_stop → no-op
  }

  private renderBlock(b: Block): RenderLine[] {
    if (b.kind === "text") return b.text ? withAssistantBullet(renderMarkdown(b.text)) : [];
    return b.collapsed ? [{ text: "✦ Thinking", dim: true }]
      : (b.text ? b.text.split("\n").map((t) => ({ text: t, dim: true })) : []);
  }
}
