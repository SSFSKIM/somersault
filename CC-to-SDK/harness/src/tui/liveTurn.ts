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
  // ── F3 Task 3: the thinking clock ────────────────────────────────────────────────────────────────
  // P82: NO stream_event frame carries a time-bearing field (`message_start.ttft_ms` is a duration, not
  // a clock), and the on-disk transcript keeps per-message FINISH stamps only — so the honest duration
  // source is LOCAL ARRIVAL, measured here, which the probe showed tracks the wire to within 1–14 ms
  // over an 8.5 s span (the SDK spawns the CLI on this very host; it is the same clock).
  private msgId?: string;                                 // id of the API message currently streaming (message_start)
  private openThinking = new Map<string, number>();       // `${msgId}:${index}` → local arrival of its content_block_start
  private thoughtMs = new Map<string, number>();          // message id → summed ms of its STOPPED thinking blocks
  private clock: () => number;
  private columns: () => number;
  /** `now` is injected for the same reason the projection's is: a test (and the frame-capture fixture)
   *  has to pin arrival stamps that would otherwise read the host wall clock. `columns` (F4 Task 5) mirrors
   *  it exactly: the live region renders markdown, markdown fits width-sensitive blocks to the terminal, and
   *  the REPL's own `columnsFn` is the honest source — read PER SNAPSHOT, never captured, so a mid-turn
   *  resize repaints the in-flight message. Default 80: `renderMarkdown`'s own. */
  constructor(deps: { now?: () => number; columns?: () => number } = {}) {
    this.clock = deps.now ?? (() => Date.now());
    this.columns = deps.columns ?? (() => 80);
  }
  /** Real running output-token count for the WHOLE turn (committed messages + the in-flight one). */
  get outputTokens(): number { return this.committedTokens + this.currentMsgTokens; }

  /** Assistant `message.id` → total thinking ms observed on THIS turn's wire. A stopped block is frozen at
   *  its `content_block_stop` arrival; a block still open reports elapsed-so-far against `now`, so a caller
   *  repainting on its own clock gets a ticking value without this class owning a timer. A SNAPSHOT: the
   *  caller (useChat's persistent map) keeps what it merged even after this turn is gone. */
  thinkingDurations(now: number): ReadonlyMap<string, number> {
    const out = new Map(this.thoughtMs);
    for (const [key, startedAt] of this.openThinking) {
      const id = key.slice(0, key.lastIndexOf(":"));
      out.set(id, (out.get(id) ?? 0) + Math.max(0, now - startedAt));
    }
    return out;
  }
  /** `event.index` restarts at 0 on EVERY API message (P82's hard constraint — an index-only key silently
   *  overwrites the earlier block), so the timer key is the pair. No message id ⇒ nothing to attribute the
   *  duration to, so the block is not clocked at all. */
  private blockKey(index: unknown): string | undefined {
    return this.msgId !== undefined && typeof index === "number" ? `${this.msgId}:${index}` : undefined;
  }

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
    if (e.type === "message_start") {
      this.committedTokens += this.currentMsgTokens; this.currentMsgTokens = 0; this.current = [];
      this.msgId = typeof e.message?.id === "string" && e.message.id ? e.message.id : undefined;
      return;
    }
    if (e.type === "content_block_start") {
      collapseThinking(this.current);                            // any new block collapses prior thinking
      const i = e.index, cb = e.content_block ?? {};
      // Thinking-ness is LATCHED here: `content_block_stop` carries no block type (P82), so a stop that
      // finds no latched start is simply not a thinking block.
      if (cb.type === "thinking") {
        const key = this.blockKey(i); if (key !== undefined) this.openThinking.set(key, this.clock());
        this.current.push({ kind: "thinking", index: i, text: "", collapsed: false });
      }
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
    if (e.type === "content_block_stop") {
      const key = this.blockKey(e.index), startedAt = key === undefined ? undefined : this.openThinking.get(key);
      if (key !== undefined && startedAt !== undefined) {
        this.openThinking.delete(key);
        const id = this.msgId!;
        this.thoughtMs.set(id, (this.thoughtMs.get(id) ?? 0) + Math.max(0, this.clock() - startedAt));
      }
      return;
    }
    if (e.type === "message_delta" && e.usage && typeof e.usage.output_tokens === "number") this.currentMsgTokens = e.usage.output_tokens;
    // message_stop → no-op
  }

  private renderBlock(b: Block): RenderLine[] {
    if (b.kind === "text") return b.text ? withAssistantBullet(renderMarkdown(b.text, { width: this.columns() })) : [];
    return b.collapsed ? [{ text: "✦ Thinking", dim: true }]
      : (b.text ? b.text.split("\n").map((t) => ({ text: t, dim: true })) : []);
  }
}
