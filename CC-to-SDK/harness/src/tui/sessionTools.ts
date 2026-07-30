// tui/src/sessionTools.ts — pure U5 helpers for the session/context commands (/export /files, and Task
// 6's /stats /session). No fs/SDK effects: callers fetch messages and inject writers.
import type { RenderLine } from "./render.js";
import { rowKind, promptText } from "../sessions/rows.js";

const FILE_KEYS = ["file_path", "path", "notebook_path"] as const;
const toolFile = (b: any): string | undefined => {
  for (const k of FILE_KEYS) { const v = b?.input?.[k]; if (typeof v === "string") return v; }
  return undefined;
};

/** The conversation as portable markdown: prompts as `## ›` headings, assistant text as body, tool
 *  calls as one-line emphasized markers. Tool results and system rows are noise — skipped. */
export function exportMarkdown(msgs: any[], meta: { id?: string }): string {
  const out: string[] = [`# ccx conversation${meta.id ? ` (${meta.id.slice(0, 8)})` : ""}`, ""];
  for (const m of msgs) {
    if (rowKind(m) === "prompt") { out.push(`## › ${promptText(m)}`, ""); continue; }
    if (m?.type !== "assistant") continue;
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text?.trim()) out.push(b.text, "");
      else if (b?.type === "tool_use") { const f = toolFile(b); out.push(`*${b.name}${f ? ` — ${f}` : ""}*`, ""); }
    }
  }
  return out.join("\n");
}
export function defaultExportName(id?: string): string {
  return `conversation-${id ? id.slice(0, 8) : "new"}.md`;
}

/** File paths touched by tool calls, deduped, ordered by last touch (CC /files: "files in context"). */
export function filesInContext(msgs: any[]): string[] {
  const seen = new Map<string, number>();
  msgs.forEach((m, i) => {
    if (m?.type !== "assistant") return;
    for (const b of m.message?.content ?? []) {
      if (b?.type !== "tool_use") continue;
      const f = toolFile(b); if (f) seen.set(f, i);
    }
  });
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
}
export function formatFiles(paths: string[]): RenderLine[] {
  if (!paths.length) return [{ text: "no files touched in this conversation yet", dim: true }];
  return [{ text: `Files in context (${paths.length})`, bold: true }, ...paths.map((p) => ({ text: `  ${p}`, dim: true }))];
}
