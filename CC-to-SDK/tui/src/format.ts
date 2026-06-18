const TOOL_ARG_MAX = 48;

function summarizeInput(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return s.length > TOOL_ARG_MAX ? s.slice(0, TOOL_ARG_MAX - 1) + "…" : s;
}

/** Operator-grade: assistant text verbatim; tool_use → `⚙ Name(arg)` markers. No diffs, no tool results. */
export function streamLine(message: unknown): string[] {
  const m = message as any;
  const out: string[] = [];
  if (m?.type === "assistant") {
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) out.push(b.text);
      else if (b?.type === "tool_use") out.push(`⚙ ${b.name}(${summarizeInput(b.input)})`);
    }
  }
  return out;
}

export function streamLines(messages: unknown[]): string[] {
  return messages.flatMap(streamLine);
}
