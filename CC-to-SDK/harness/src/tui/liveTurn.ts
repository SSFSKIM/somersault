// tui/src/liveTurn.ts — the TRANSIENT live region ONLY (F1 Task 4): the partial `stream_event` text/thinking
// snapshot of the message that is streaming right now, plus the turn's running output-token count.
// It renders NO tool row and NO completed message: a COMPLETE assistant/user message belongs to the retained
// `TranscriptDocument` (Task 1) and an open tool call to `projectPending` (Task 3), so nothing here can put a
// second copy of either on screen. Pure reducer — no React, no SDK.
import type { RenderLine } from "./render.js";
import { withAssistantBullet, THINKING_PLACEHOLDER } from "./render.js";
import { renderMarkdown } from "./markdown.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import type { SpinnerMode, ThinkingBurst } from "./spinner.js";

/** Wave C Task 6: everything the live-turn spinner's parenthetical needs, read off the SAME frames this
 *  class already consumes rather than by a second subscriber to the wire. `chars` is upstream's
 *  `responseLength`; the other three feed the phase ladder. */
export interface SpinnerMeter {
  /** Target for the eased token estimate — streamed characters, floored by the real usage figure (D-C6). */
  chars: number;
  mode: SpinnerMode;
  hasActiveTools: boolean;
  isThinking: boolean;
  lastBurst?: ThinkingBurst;
}
export const IDLE_METER: SpinnerMeter = { chars: 0, mode: "requesting", hasActiveTools: false, isThinking: false };

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
  // ── Wave C Task 6: the spinner meter ─────────────────────────────────────────────────────────────
  // Four cheap counters over frames already being read. `rawChars` is upstream's `responseLength`
  // (L374708–374720): text deltas AND tool-input JSON, never thinking deltas — upstream feeds those to a
  // token counter instead, and the F4 t9 note above records why. `openTools` is the tool WINDOW the phase
  // ladder times; it is keyed on complete messages because that is where ids and results both arrive.
  // The burst is INDEPENDENT of `thoughtMs` above on purpose: that map is keyed by message id and gives up
  // when a `message_start` carries none, whereas the spinner still has to say "thinking".
  private rawChars = 0;
  private mode: SpinnerMode = "requesting";
  private openTools = new Set<string>();
  private openThinkingIdx = new Set<number>();            // indices of the CURRENT contiguous thinking window
  private burst?: ThinkingBurst;
  private clock: () => number;
  private columns: () => number;
  private platform: NodeJS.Platform;
  private cwd?: string;
  /** `now` is injected for the same reason the projection's is: a test (and the frame-capture fixture)
   *  has to pin arrival stamps that would otherwise read the host wall clock. `columns` (F4 Task 5) mirrors
   *  it exactly: the live region renders markdown, markdown fits width-sensitive blocks to the terminal, and
   *  the REPL's own `columnsFn` is the honest source — read PER SNAPSHOT, never captured, so a mid-turn
   *  resize repaints the in-flight message. Default 80: `renderMarkdown`'s own.
   *  `platform` (F4 Task 8) is the SAME value `useChat` puts in its `ProjectionContext`, and it is threaded
   *  for one reason: the streaming bullet and the settled bullet are the same glyph, so a live message must
   *  not paint `⏺` and then re-paint as `●` the instant it lands in the retained document. Captured, not a
   *  thunk — unlike width and the clock, a host does not change platform mid-turn.
   *  `cwd` is threaded for the SAME live-vs-settled reason: the streaming region renders markdown, a relative
   *  `file:` link in it normalises against a directory, and the settled row will use the session's — so a
   *  live message must not point a link at this process's cwd and then silently re-point on landing.
   *  Captured for the same reason platform is: a session's cwd is fixed for its whole life. */
  constructor(deps: { now?: () => number; columns?: () => number; platform?: NodeJS.Platform; cwd?: string } = {}) {
    this.clock = deps.now ?? (() => Date.now());
    this.columns = deps.columns ?? (() => 80);
    this.platform = deps.platform ?? process.platform;
    this.cwd = deps.cwd;
  }
  /** Real running output-token count for the WHOLE turn (committed messages + the in-flight one). */
  get outputTokens(): number { return this.committedTokens + this.currentMsgTokens; }

  /** The spinner's whole input, as of the last frame. `chars` RECONCILES the estimate to the truth (D-C6):
   *  the raw streamed length undercounts (thinking tokens and structured tool input are billed but only
   *  partly typed), so the moment a `message_delta` reports real usage the target jumps to four characters
   *  a token and the easing walks up to it. Raw characters take back over as soon as they exceed it, which
   *  keeps the number climbing between the once-per-message usage frames. */
  meter(): SpinnerMeter {
    return {
      chars: Math.max(this.rawChars, this.outputTokens * 4),
      mode: this.mode,
      hasActiveTools: this.openTools.size > 0,
      isThinking: this.openThinkingIdx.size > 0,
      ...(this.burst && { lastBurst: this.burst }),
    };
  }

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
    this.trackTools(mm);
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

  /** The tool window the phase ladder times. A call opens when the assistant message carrying it lands and
   *  closes when its result comes back on a user message — the same pair `syncLiveOpen` uses for the
   *  blinking active-group row, read here off frames this class is handed anyway. Delivering a result also
   *  means a NEW request is going out, which is upstream's `stream_request_start` → `"requesting"`. */
  private trackTools(mm: any): void {
    const content = mm.message?.content;
    if (!Array.isArray(content)) return;
    if (mm.type === "assistant") { for (const b of content) if (b?.type === "tool_use" && typeof b.id === "string") this.openTools.add(b.id); return; }
    let closed = false;
    for (const b of content) if (b?.type === "tool_result" && typeof b.tool_use_id === "string") closed = this.openTools.delete(b.tool_use_id) || closed;
    if (closed) this.mode = "requesting";
  }

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
        if (this.openThinkingIdx.size === 0) this.burst = { startedAt: this.clock() };
        this.openThinkingIdx.add(i); this.mode = "thinking";
        this.current.push({ kind: "thinking", index: i, text: "", collapsed: false });
      }
      else if (cb.type === "text") { this.mode = "responding"; this.current.push({ kind: "text", index: i, text: "" }); }
      else if (cb.type === "tool_use") this.mode = "tool-input";
      // tool_use partials are NOT tracked: the open call reaches the screen through projectPending, off the
      // retained document, the moment the complete assistant message lands.
      return;
    }
    if (e.type === "content_block_delta") {
      const b = this.find(e.index), d = e.delta ?? {};
      // The spinner's char count runs BEFORE the block lookup: a tool_use block is not tracked as a Block
      // at all (its row belongs to projectPending), but its streaming JSON is half of what upstream counts.
      if (d.type === "text_delta" && typeof d.text === "string") this.rawChars += d.text.length;
      else if (d.type === "input_json_delta" && typeof d.partial_json === "string") this.rawChars += d.partial_json.length;
      if (!b) return;
      if (b.kind === "text" && d.type === "text_delta") b.text += d.text ?? "";
      else if (b.kind === "thinking" && d.type === "thinking_delta") b.text += d.thinking ?? "";
      // input_json_delta / signature_delta → ignored
      return;
    }
    if (e.type === "content_block_stop") {
      // The burst closes on the LAST open thinking block, so several thinking blocks in one message read as
      // one window — which is what upstream's mode-based burst measures.
      if (this.openThinkingIdx.delete(e.index) && this.openThinkingIdx.size === 0 && this.burst)
        this.burst = { startedAt: this.burst.startedAt, endedAt: this.clock(), ms: Math.max(0, this.clock() - this.burst.startedAt) };
      const key = this.blockKey(e.index), startedAt = key === undefined ? undefined : this.openThinking.get(key);
      if (key !== undefined && startedAt !== undefined) {
        this.openThinking.delete(key);
        const id = this.msgId!;
        this.thoughtMs.set(id, (this.thoughtMs.get(id) ?? 0) + Math.max(0, this.clock() - startedAt));
      }
      return;
    }
    if (e.type === "message_delta") {
      this.mode = "responding";
      if (e.usage && typeof e.usage.output_tokens === "number") this.currentMsgTokens = e.usage.output_tokens;
      return;
    }
    if (e.type === "message_stop") this.mode = "tool-use";   // L374680: the message is done; whatever it asked for runs next
  }

  private renderBlock(b: Block): RenderLine[] {
    if (b.kind === "text") return b.text ? withAssistantBullet(renderMarkdown(b.text, { width: this.columns(), cwd: this.cwd }), this.platform) : [];
    // F4 Task 9 (+ t9 review): an OPEN thinking block renders NOTHING here. Upstream's stream handler never
    // accumulates thinking text — a thinking delta feeds only a token counter (L374721–374730), in pointed
    // contrast to text deltas (L374708–374716) — so the live surfaces for in-flight thinking are the
    // spinner's stream-mode label and the flattened summary in the active group slot, both ported elsewhere.
    // F1's dim live prose was a divergence: it showed text the settled transcript then hides. The COLLAPSED
    // form keeps `e8o`'s `✻ Thinking…` verbatim (shared with the transcript's `redacted_thinking` row via
    // render.ts) — a recorded better-than-blank invention; upstream shows nothing there either.
    return b.collapsed ? [{ ...THINKING_PLACEHOLDER }] : [];
  }
}
