// tui/src/transcriptModel.ts — F1 canonical transcript: the ONE retained, source-faithful document every surface
// (live, replay, attach, resume, rewind, Ctrl-O pager) projects from. It parses only COMPLETE assistant/user
// messages — `stream_event` partials stay transient in LiveTurn — keeps each message verbatim, and extracts tool
// calls plus their results WITHOUT ever guessing an owner. The optional top-level `tool_use_result` sidecar
// (P94, SDK 0.3.220) is associated with a call only when that association is unique; every other sidecar is
// retained at message scope together with the reason it stayed there, so nothing is dropped and nothing is faked.
// Purely a source model: it makes no rendering decision (Task 3 owns projection).
import type { RenderLine } from "./render.js";

export type TranscriptSource = "host" | "disk" | "local";
export type SidecarAssociation =
  | { scope: "call"; value: unknown }
  | { scope: "message"; value: unknown; reason: "no-tool-result" | "missing-tool-use-id" | "unmatched-tool-use" | "ambiguous-tool-results" | "duplicate-tool-use" | "duplicate-tool-result" };
/** An inherently LOCAL transcript record (never an SDK message): the faithful `RenderLine[]` payload of a
 *  client-side visual — `/help`, `/usage`, `/status`, local Bash, welcome, notices, errors — kept in the one
 *  ordered document so local and SDK history can never drift. Not a reduction of any SDK message. */
export type LocalTranscriptEvent = {
  kind: "notice" | "user-echo" | "command-echo" | "resume-divider" | "rewind-divider" | "source-gap" | "decision-settled" | "visual";
  lines: readonly RenderLine[];
  data?: Record<string, unknown>;
};
/** The sole startup handoff: array order IS the total SDK/local order, and every local envelope already carries
 *  the stable identity that projection reuses. */
export type TranscriptBootstrapEntry =
  | { kind: "sdk"; source: "disk"; message: Record<string, unknown> }
  | { kind: "local"; identity: string; event: LocalTranscriptEvent };
export type TranscriptEntry =
  | { sequence: number; source: "host" | "disk"; kind: "sdk-message"; identity?: string; message: Record<string, unknown>; sidecar?: SidecarAssociation }
  | { sequence: number; source: "local"; kind: "local-event"; identity: string; event: LocalTranscriptEvent };
export interface ToolEvent {
  id: string; name: string; input: unknown; callSequence: number;
  route: "top-level" | "nested"; parent_tool_use_id?: string;
  result?: { content: unknown; isError: boolean; resultSequence: number; sidecar?: SidecarAssociation };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
function contentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  const inner = message.message, content = isRecord(inner) ? inner.content : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}
/** A SOURCE-STABLE identity only: user `uuid`, assistant `message.id`, or the tuple of tool-use IDs. Never a
 *  structural hash of payload text — two equal-looking calls can be genuinely distinct turns, and hiding one
 *  would lose truth. No identity ⇒ always append. */
function identityOf(message: Record<string, unknown>): string | undefined {
  if (nonEmpty(message.uuid)) return `uuid:${message.uuid}`;
  const inner = message.message, id = isRecord(inner) ? inner.id : undefined;
  if (nonEmpty(id)) return `message:${id}`;
  const ids = contentBlocks(message).filter((b) => b.type === "tool_use").map((b) => b.id).filter(nonEmpty);
  return ids.length ? `tool-use:${ids.join(",")}` : undefined;
}

function uniqueCall(id: unknown, callsById: ReadonlyMap<string, readonly ToolEvent[]>): ToolEvent | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const calls = callsById.get(id); return calls?.length === 1 ? calls[0] : undefined;
}
/** The sidecar association rule, evaluated against the PRE-message call state. It governs ONLY the structured
 *  `tool_use_result`; an ordinary flat `tool_result` block attaches under its own independent conditions. */
function sidecarFor(blocks: readonly Record<string, unknown>[], callsById: ReadonlyMap<string, readonly ToolEvent[]>, value: unknown): SidecarAssociation | undefined {
  if (value === undefined) return undefined;
  if (blocks.length === 0) return { scope: "message", value, reason: "no-tool-result" };
  if (blocks.length !== 1) return { scope: "message", value, reason: "ambiguous-tool-results" };
  const id = blocks[0]?.tool_use_id;
  if (typeof id !== "string" || id.length === 0) return { scope: "message", value, reason: "missing-tool-use-id" };
  const call = uniqueCall(id, callsById);
  if (call?.result) return { scope: "message", value, reason: "duplicate-tool-result" };
  return call ? { scope: "call", value } : { scope: "message", value, reason: callsById.has(id) ? "duplicate-tool-use" : "unmatched-tool-use" };
}

export class TranscriptDocument {
  private list: TranscriptEntry[] = [];
  private tools: ToolEvent[] = [];
  private callsById = new Map<string, ToolEvent[]>();
  private identities = new Set<string>();
  private seq = 0;

  /** Retain one COMPLETE SDK message. Returns false when it is not a completed assistant/user message, or when
   *  its source-stable identity was already retained (disk bootstrap vs. live follow repetition). */
  appendSdk(source: "host" | "disk", message: Record<string, unknown>): boolean {
    if (!isRecord(message)) return false;
    const type = message.type;
    if (type !== "assistant" && type !== "user") return false;
    const identity = identityOf(message);
    if (identity !== undefined) { if (this.identities.has(identity)) return false; this.identities.add(identity); }
    const sequence = ++this.seq;
    const entry: TranscriptEntry = { sequence, source, kind: "sdk-message", message, ...(identity === undefined ? {} : { identity }) };
    const blocks = contentBlocks(message);
    if (type === "assistant") this.extractCalls(message, blocks, sequence);
    else {
      const results = blocks.filter((b) => b.type === "tool_result");
      const sidecar = sidecarFor(results, this.callsById, message.tool_use_result);   // pre-message state
      this.attachResults(results, sequence);
      if (sidecar?.scope === "call") { const call = uniqueCall(results[0]?.tool_use_id, this.callsById); if (call?.result) call.result.sidecar = sidecar; }
      else if (sidecar) entry.sidecar = sidecar;
    }
    this.list.push(entry);
    return true;
  }

  /** Retain one local visual. Deduplicated ONLY by the caller's stable identity — equal-looking events with
   *  different identities are distinct history. */
  appendLocal(event: LocalTranscriptEvent, identity: string): boolean {
    if (this.identities.has(identity)) return false;
    this.identities.add(identity);
    this.list.push({ sequence: ++this.seq, source: "local", kind: "local-event", identity, event });
    return true;
  }

  /** The truncated-follow marker: attaching mid-session cannot recover earlier live output, so say so rather
   *  than silently presenting a partial transcript as complete. */
  appendFollowGap(identity: string): boolean {
    return this.appendLocal({ kind: "source-gap", lines: [{ text: "Earlier live output unavailable while attaching", dim: true }] }, identity);
  }

  entries(): readonly TranscriptEntry[] { return this.list; }
  toolEvents(): readonly ToolEvent[] { return this.tools; }

  private extractCalls(message: Record<string, unknown>, blocks: readonly Record<string, unknown>[], callSequence: number): void {
    const parent = nonEmpty(message.parent_tool_use_id) ? message.parent_tool_use_id : undefined;
    for (const b of blocks) {
      if (b.type !== "tool_use") continue;
      const id = typeof b.id === "string" ? b.id : "";
      const call: ToolEvent = { id, name: typeof b.name === "string" ? b.name : "", input: b.input, callSequence, route: parent === undefined ? "top-level" : "nested", ...(parent === undefined ? {} : { parent_tool_use_id: parent }) };
      this.tools.push(call);
      if (id) this.callsById.set(id, [...(this.callsById.get(id) ?? []), call]);
    }
  }

  /** Attach a flat `tool_result` block to its call only when the ownership is unambiguous: its nonempty
   *  `tool_use_id` appears ONCE in this user message, exactly one preceding call owns that ID, and that call has
   *  no result yet. So one multi-result message can complete several distinct calls, while repeated same-ID
   *  blocks and a later result for a completed call stay raw in the message entry instead of last-write-wins. */
  private attachResults(results: readonly Record<string, unknown>[], resultSequence: number): void {
    const counts = new Map<string, number>();
    for (const b of results) if (nonEmpty(b.tool_use_id)) counts.set(b.tool_use_id, (counts.get(b.tool_use_id) ?? 0) + 1);
    for (const b of results) {
      const id = b.tool_use_id;
      if (!nonEmpty(id) || counts.get(id) !== 1) continue;
      const call = uniqueCall(id, this.callsById);
      if (!call || call.result) continue;
      call.result = { content: b.content, isError: b.is_error === true, resultSequence, sidecar: undefined };   // uniform shape: an unassociated result carries the key, explicitly empty
    }
  }
}
