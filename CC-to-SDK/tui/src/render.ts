// tui/src/render.ts — pure, UI-agnostic rich formatter: one SDK message → renderable lines (data, not ink).
export interface RenderLine { text: string; color?: string; dim?: boolean; bold?: boolean; italic?: boolean; }

export const trunc = (s: string, n = 48): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const firstArg = (input: Record<string, unknown>): string => {
  const v = Object.values(input ?? {})[0];
  return v === undefined ? "" : trunc(typeof v === "string" ? v : JSON.stringify(v));
};
const path = (input: Record<string, unknown>) => String(input.file_path ?? input.path ?? "");

/** The salient argument of a tool, used by the live one-line tool marker and the diff header. */
export function toolTarget(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") return trunc(String(input.command ?? ""), 80);
  if (name === "Edit" || name === "Write" || name === "Read") return path(input);
  return firstArg(input);
}

function toolUseLines(name: string, input: Record<string, unknown>): RenderLine[] {
  if (name === "Bash") return [{ text: `⚙ Bash ${trunc(String(input.command ?? ""), 80)}` }];
  if (name === "Read") return [{ text: `⚙ Read ${path(input)}` }];
  return [{ text: `⚙ ${name}(${firstArg(input)})` }];
}

/** Truncation-aware Edit/Write diff: header + capped +/- lines + a "… N more lines" note. Reused by liveTurn. */
export function toolDiffLines(name: string, input: Record<string, unknown>, cap = 24): RenderLine[] {
  const head: RenderLine = { text: `⚙ ${name} ${String(input.file_path ?? input.path ?? "")}` };
  const body: RenderLine[] = [];
  if (typeof input.old_string === "string") for (const l of input.old_string.split("\n")) body.push({ text: `  - ${l}`, color: "red" });
  const added = typeof input.new_string === "string" ? input.new_string : typeof input.content === "string" ? input.content : "";
  if (added) for (const l of added.split("\n")) body.push({ text: `  + ${l}`, color: "green" });
  if (body.length <= cap) return [head, ...body];
  return [head, ...body.slice(0, cap), { text: `  … ${body.length - cap} more lines`, dim: true }];
}

function resultLines(content: unknown): RenderLine[] {
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";
  if (!text.trim()) return [];
  return text.split("\n").slice(0, 12).map((l) => ({ text: `  │ ${trunc(l, 100)}`, dim: true }));
}

/** Map one SDK message to renderable lines. Unknown/empty/result/system → []. */
export function renderMessage(m: any): RenderLine[] {
  if (!m || typeof m !== "object") return [];
  if (m.type === "assistant") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) out.push({ text: l });
      else if (b?.type === "thinking" && b.thinking) for (const l of String(b.thinking).split("\n")) out.push({ text: l, dim: true });
      else if (b?.type === "tool_use") out.push(...(b.name === "Edit" || b.name === "Write" ? toolDiffLines(b.name, b.input ?? {}) : toolUseLines(b.name, b.input ?? {})));
    }
    return out;
  }
  if (m.type === "user") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) out.push({ text: `› ${l}`, dim: true });
      else if (b?.type === "tool_result") out.push(...resultLines(b.content));
    }
    return out;
  }
  return [];
}
