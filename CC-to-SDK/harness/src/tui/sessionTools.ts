// tui/src/sessionTools.ts — pure U5 helpers for the session/context commands (/export /files, and Task
// 6's /stats /session). No fs/SDK effects: callers fetch messages and inject writers.
import type { RenderLine } from "./render.js";
import { rowKind, promptText } from "../sessions/rows.js";
import type { SessionUsage } from "./commands.js";

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

const kk = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`);
const sumTok = (ms: Record<string, { inputTokens?: number; outputTokens?: number }>, key: "inputTokens" | "outputTokens") =>
  Object.values(ms).reduce((a, m) => a + (m[key] ?? 0), 0);

/** `/stats` — conversation shape (prompts/replies/tool calls) + cumulative usage in one glance. */
export function formatStats(u: SessionUsage, msgs: any[]): RenderLine[] {
  const prompts = msgs.filter((m) => rowKind(m) === "prompt").length;
  const replies = msgs.filter((m) => m?.type === "assistant").length;
  let tools = 0;
  for (const m of msgs) if (m?.type === "assistant") for (const b of m.message?.content ?? []) if (b?.type === "tool_use") tools++;
  const s = u.session ?? {}; const models = s.model_usage ?? {};
  const out: RenderLine[] = [
    { text: "Session stats", bold: true },
    { text: `  prompts    ${prompts}`, dim: true },
    { text: `  replies    ${replies}`, dim: true },
    { text: `  tool calls ${tools}`, dim: true },
    { text: `  tokens     ${kk(sumTok(models, "inputTokens"))} in · ${kk(sumTok(models, "outputTokens"))} out`, dim: true },
  ];
  if (s.total_cost_usd) out.push({ text: `  cost       $${s.total_cost_usd.toFixed(4)}`, dim: true });
  for (const [name, m] of Object.entries(models))
    out.push({ text: `  ${name}  ${kk(m.inputTokens ?? 0)} in · ${kk(m.outputTokens ?? 0)} out`, dim: true });
  return out;
}

/** `/session` — LOCAL session info (deliberate divergence: upstream's /session is a cloud-URL/QR
 *  bridge feature; recorded in the spec's Revision Notes). */
export function formatSessionInfo(s: { id: string; info?: any; cwd?: string }): RenderLine[] {
  const out: RenderLine[] = [{ text: "Session", bold: true }, { text: `  id         ${s.id}`, dim: true }];
  const i = s.info ?? {};
  if (i.customTitle) out.push({ text: `  title      ${i.customTitle}`, dim: true });
  else if (i.summary) out.push({ text: `  summary    ${i.summary}`, dim: true });
  if (i.tag) out.push({ text: `  tag        #${i.tag}`, dim: true });
  if (i.gitBranch) out.push({ text: `  branch     ${i.gitBranch}`, dim: true });
  if (s.cwd) out.push({ text: `  cwd        ${s.cwd}`, dim: true });
  if (i.lastModified) out.push({ text: `  modified   ${new Date(i.lastModified).toLocaleString()}`, dim: true });
  out.push({ text: `  resume     ccx --resume ${s.id}`, dim: true });
  return out;
}
