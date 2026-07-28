// sessions/rows.ts — content-shape classification of persisted transcript rows (getSessionMessages).
// The rows carry NO meta flags (probe 68b) — a "user" row can be a real prompt, a tool_result, a CLI
// slash-command echo, local-command stdout/caveat, or a compact continuation summary, and only the
// content shape tells them apart. ONE module so the rewind picker and transcript replay cannot drift.
import type { RewindAnchor } from "../session/chatSession.js";

export type RowKind = "prompt" | "tool_result" | "command_echo" | "command_output" | "caveat" | "compact_summary" | "other";

/** First text of a user row (string content, or the first text block). */
export function promptText(m: any): string {
  const c = m?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return String(c.find((b: any) => b?.type === "text")?.text ?? "");
  return "";
}

export function rowKind(m: any): RowKind {
  if (m?.type !== "user") return "other";
  const c = m.message?.content;
  if (Array.isArray(c) && c.some((b: any) => b?.type === "tool_result")) return "tool_result";
  const text = promptText(m);
  if (/^\s*<command-name>/.test(text)) return "command_echo";
  if (/^\s*<local-command-stdout>/.test(text)) return "command_output";
  if (/^\s*<local-command-caveat>/.test(text)) return "caveat";
  // English-string sniffing, but the only signal there is: the CLI writes this exact preamble on the
  // continuation-summary row that replaces pre-compact history (probe 68b).
  if (/^This session is being continued from a previous conversation/.test(text)) return "compact_summary";
  if (!m.uuid) return "other";
  return "prompt";
}

/** The phantom kinds a conversation anchor must never land on (probe 68b: untested resumeAt semantics). */
const PHANTOM: ReadonlySet<RowKind> = new Set(["command_echo", "command_output", "caveat", "compact_summary"]);

/** User-prompt anchors, NEWEST-FIRST. prevUuid = the nearest PRECEDING row with a uuid whose kind is
 *  real (assistant/tool_result/prompt) — phantom rows are walked past, so rewinding also drops them. */
export function rewindAnchorsFrom(messages: any[]): RewindAnchor[] {
  const out: RewindAnchor[] = [];
  messages.forEach((m: any, i: number) => {
    if (rowKind(m) !== "prompt") return;
    let prevUuid: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const p = messages[j] as any;
      if (p?.uuid && !PHANTOM.has(rowKind(p))) { prevUuid = String(p.uuid); break; }
    }
    out.push({ uuid: String(m.uuid), prevUuid, text: promptText(m), index: i });
  });
  return out.reverse();
}

/** The last assistant reply's text in a persisted transcript ("" if none). Lets a replayed view (resume,
 *  rewind) seed /copy with the reply that is actually ON SCREEN — the live message arm never saw it. */
export function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any;
    if (m?.type !== "assistant") continue;
    const t = (m.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
    if (t.trim()) return t;
  }
  return "";
}
