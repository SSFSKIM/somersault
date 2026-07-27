// tui/src/replay.ts — pure: a resumed session's persisted messages → transcript lines (full-fidelity, reusing
// render.ts). Skips tool_result bodies (the ⚙ marker conveys the action, matching live, which never dumps result
// bodies); caps to the last N messages with an elision marker; indents nested (subagent) messages; frames the
// block with resumed/live dividers. Header label/time/turns are DERIVED from the messages (no clock, no fetch).
import { renderMessage, trunc, type RenderLine } from "./render.js";

const isToolResult = (m: any): boolean =>
  m?.type === "user" && Array.isArray(m.message?.content) && m.message.content.length > 0 && m.message.content.every((b: any) => b?.type === "tool_result");
function firstUserText(messages: any[]): string {
  for (const m of messages) {
    if (m?.type === "user" && Array.isArray(m.message?.content)) {
      const t = m.message.content.find((b: any) => b?.type === "text");
      if (t?.text) return String(t.text);
    }
  }
  return "";
}
const hhmm = (ts: unknown): string => (typeof ts === "string" && ts.length >= 16 && ts[10] === "T" ? ts.slice(11, 16) : "");
const divider = (label: string): RenderLine => ({ text: `─── ${label} ───`, dim: true });

export function replayLines(messages: any[], opts: { cap?: number; id?: string } = {}): RenderLine[] {
  const cap = opts.cap ?? 200;
  const shown = messages.filter((m) => !isToolResult(m));                 // drop tool_result bodies
  const elided = Math.max(0, shown.length - cap);
  const kept = elided > 0 ? shown.slice(shown.length - cap) : shown;
  const turns = shown.filter((m) => m?.type === "user").length;
  const label = trunc(firstUserText(messages) || (opts.id ? opts.id.slice(0, 8) : "session"), 40);
  const time = hhmm(messages.at(-1)?.timestamp);
  const head = `resumed: ${label} · ${turns} turn${turns === 1 ? "" : "s"}${time ? " · " + time : ""}`;
  const out: RenderLine[] = [divider(head)];
  if (elided > 0) out.push({ text: `… ${elided} earlier message${elided === 1 ? "" : "s"} elided`, dim: true });
  for (const m of kept) {
    const lines = renderMessage(m);
    // nested (subagent) messages: indent + dim, DROP the gutter (the ● bullet belongs to the top-level turn).
    // For segment lines the <Line> renders `segments` (ignoring line-level dim/text), so dim+indent EACH segment.
    if (m?.parent_tool_use_id) for (const l of lines) {
      const { gutter, segments, ...rest } = l; void gutter;
      if (segments && segments.length) out.push({ ...rest, text: "  " + rest.text, dim: true, segments: segments.map((s, i) => ({ ...s, dim: true, text: i === 0 ? "  " + s.text : s.text })) });
      else out.push({ ...rest, text: "  " + rest.text, dim: true });
    }
    else out.push(...lines);
  }
  out.push(divider("resumed here · live"));
  return out;
}
