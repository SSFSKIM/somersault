// tui/src/liveTurn.ts — pure reducer: SDK turn frames (stream_event partials + full assistant/user/result)
// → live RenderLine[] snapshots. Owns ALL streaming state so useChat/render stay lean. No React, no SDK; clock is injected.
import type { RenderLine } from "./render.js";
import { trunc, toolTarget, toolDiffLines } from "./render.js";
import { renderMarkdown } from "./markdown.js";

type Block =
  | { kind: "text"; index: number; text: string }
  | { kind: "thinking"; index: number; text: string; collapsed: boolean }
  | { kind: "tool"; index: number; id: string; name: string; target: string; status: "running" | "done" | "error"; preview?: string; startedAt: number; nested?: RenderLine[]; toolCount?: number; doneAt?: number; input?: Record<string, unknown> };
type ToolBlock = Block & { kind: "tool" };

const ev = (m: any) => (m?.type === "stream_event" ? m.event : undefined);
function firstResultLine(content: unknown): string {
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";
  return text.split("\n").map((s) => s.trim()).find((s) => s.length) ?? "";
}
function collapseThinking(blocks: Block[]): void { for (const b of blocks) if (b.kind === "thinking") b.collapsed = true; }

export class LiveTurn {
  constructor(private now: () => number = () => Date.now()) {}
  private committed: Block[] = [];     // blocks from completed messages, in order
  private current: Block[] = [];       // blocks of the in-flight message, in start order
  private byTool = new Map<string, ToolBlock>();
  private sawPartials = false;         // distinguishes partials-on (flush on message_start) from off
  private ended = false;               // set by finalize() — running tools then render as a settled marker
  private errorLine?: string;
  model?: string;                      // captured from the first assistant frame's message.model

  /** Feed one frame from Session.submit's onMessage. Ignores unknown/irrelevant frames. */
  ingest(m: unknown): void {
    const e = ev(m);
    if (e) { this.sawPartials = true; this.onStreamEvent(e); return; }
    const mm = m as any;
    const ptid = mm?.parent_tool_use_id;
    if (ptid) { this.onNested(String(ptid), mm); return; }     // subagent inner turn (whole message; never partial)
    if (mm?.type === "assistant") this.onAssistant(mm);
    else if (mm?.type === "user") this.onUser(mm);
    // result / system / unknown → ignored (the turn's end is driven by useChat resolving)
  }

  private onNested(ptid: string, mm: any): void {
    const agent = this.byTool.get(ptid);
    if (!agent || agent.kind !== "tool") return;               // unknown parent → ignore
    if (!agent.nested) { agent.nested = []; agent.toolCount = 0; }
    for (const b of mm.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) agent.nested.push({ text: `  │ ${l}`, dim: true });
      else if (b?.type === "tool_use") { agent.toolCount = (agent.toolCount ?? 0) + 1; agent.nested.push({ text: `  ⚙ ${b.name}${b.input ? " " + toolTarget(String(b.name), b.input) : ""}`, dim: true }); }
      else if (b?.type === "tool_result") { const p = trunc(firstResultLine(b.content)); if (p) agent.nested.push({ text: `  ⎿ ${p}`, dim: true }); }
    }
  }

  fail(message: string): void { this.errorLine = message; }

  /** Current live-region lines; call after each ingest. */
  snapshot(): RenderLine[] {
    const out = [...this.committed, ...this.current].flatMap((b) => this.renderBlock(b));
    if (this.errorLine) out.push({ text: `✗ ${this.errorLine}`, color: "red" });
    return out;
  }

  /** Authoritative scrollback lines; settles open thinking/tool blocks. */
  finalize(): RenderLine[] { this.flush(); this.ended = true; return this.snapshot(); }

  private find(index: number): Block | undefined { return this.current.find((b) => b.index === index); }
  private flush(): void { collapseThinking(this.current); this.committed.push(...this.current); this.current = []; }

  private onStreamEvent(e: any): void {
    if (e.type === "message_start") { this.flush(); return; }   // a new message → seal the prior one
    if (e.type === "content_block_start") {
      collapseThinking(this.current);                            // any new block collapses prior thinking
      const i = e.index, cb = e.content_block ?? {};
      if (cb.type === "thinking") this.current.push({ kind: "thinking", index: i, text: "", collapsed: false });
      else if (cb.type === "text") this.current.push({ kind: "text", index: i, text: "" });
      else if (cb.type === "tool_use") {
        const tb: ToolBlock = { kind: "tool", index: i, id: String(cb.id ?? ""), name: String(cb.name ?? ""), target: "", status: "running", startedAt: this.now() };
        this.current.push(tb); if (tb.id) this.byTool.set(tb.id, tb);
      }
      return;
    }
    if (e.type === "content_block_delta") {
      const b = this.find(e.index), d = e.delta ?? {};
      if (!b) return;
      if (b.kind === "text" && d.type === "text_delta") b.text += d.text ?? "";
      else if (b.kind === "thinking" && d.type === "thinking_delta") b.text += d.thinking ?? "";
      // input_json_delta / signature_delta → ignored (target comes from the full message)
    }
    // content_block_stop / message_delta / message_stop → no-op
  }

  private onAssistant(mm: any): void {
    const content: any[] = mm.message?.content ?? [];
    if (!this.model && mm.message?.model) this.model = String(mm.message.model);
    if (!this.sawPartials) this.flush();                         // partials-off: each assistant msg is its own boundary
    content.forEach((b, i) => {
      if (b?.type === "text") {
        const ex = this.find(i);
        if (ex && ex.kind === "text") ex.text = String(b.text ?? "");                 // authoritative overwrite (dedup)
        else this.current.push({ kind: "text", index: i, text: String(b.text ?? "") }); // fallback (no partial)
      } else if (b?.type === "thinking") {
        if (!this.find(i)) this.current.push({ kind: "thinking", index: i, text: String(b.thinking ?? ""), collapsed: false });
      } else if (b?.type === "tool_use") {
        const id = String(b.id ?? ""); const ex = id ? this.byTool.get(id) : undefined;
        if (ex) { ex.name = String(b.name ?? ex.name); ex.target = toolTarget(ex.name, b.input ?? {}); if (ex.name === "Edit" || ex.name === "Write") ex.input = b.input ?? {}; }
        else {
          const nm = String(b.name ?? "");
          const tb: ToolBlock = { kind: "tool", index: i, id, name: nm, target: toolTarget(nm, b.input ?? {}), status: "running", startedAt: this.now(), input: (nm === "Edit" || nm === "Write") ? (b.input ?? {}) : undefined };
          this.current.push(tb); if (id) this.byTool.set(id, tb);
        }
      }
    });
  }

  private onUser(mm: any): void {
    for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_result") continue;
      const tb = this.byTool.get(String(b.tool_use_id ?? ""));
      if (!tb) continue;
      tb.status = b.is_error ? "error" : "done";
      if (!b.is_error) { const p = trunc(firstResultLine(b.content)); if (p) tb.preview = p; }
      if (tb.name === "Agent") tb.doneAt = this.now();          // collapse Agent on its top-level result
    }
  }

  private renderBlock(b: Block): RenderLine[] {
    if (b.kind === "text") return b.text ? renderMarkdown(b.text) : [];
    if (b.kind === "thinking")
      return b.collapsed ? [{ text: "✦ Thinking", dim: true }]
        : (b.text ? b.text.split("\n").map((t) => ({ text: t, dim: true })) : []);
    const label = b.target ? `${b.name} ${b.target}` : b.name;
    if (b.name === "Agent") {
      if (b.doneAt != null) { const s = Math.floor((b.doneAt - b.startedAt) / 1000); return [{ text: `⚙ ${label} ✓ (${b.toolCount ?? 0} tools · ${s}s)` }]; }
      return [{ text: `⚙ ${label}` }, ...(b.nested ?? [])];      // expanded while running
    }
    if ((b.name === "Edit" || b.name === "Write") && b.input) {
      const head = b.status === "done" ? `✓ ${label}` : b.status === "error" ? `✗ ${label}` : this.ended ? `· ${label}` : `⟳ ${label}`;
      return [{ text: head, ...(b.status === "error" ? { color: "red" } : {}) }, ...toolDiffLines(b.name, b.input).slice(1)];   // diff body under the status header
    }
    if (b.status === "error") return [{ text: `✗ ${label}`, color: "red" }];
    if (b.status === "done") return [{ text: `✓ ${label}${b.preview ? "  │ " + b.preview : ""}` }];
    if (this.ended) return [{ text: `· ${label}`, dim: true }];               // settled after finalize
    const s = Math.floor((this.now() - b.startedAt) / 1000);
    return [{ text: `⟳ ${label}${s >= 1 ? ` ${s}s` : ""}` }];                 // running, elapsed ≥1s
  }

  get subagentActive(): boolean { return [...this.byTool.values()].some((b) => b.name === "Agent" && b.doneAt == null); }
}
