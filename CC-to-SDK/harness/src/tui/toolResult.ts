// tui/src/toolResult.ts — F1 per-call normalizer: one retained ToolEvent (complete tool input + flat result
// content + optionally a UNIQUELY associated `tool_use_result` sidecar) → one renderable shape.
// Structured-first per call, deterministic fallback per call (P94, SDK 0.3.220): a recognized sidecar shape wins;
// otherwise we derive from the complete input plus the flat result text. Sidecar presence is per CALL — never
// infer it per tool or per session. Shape guards are deliberately narrow: an unrecognized or forwarded sidecar
// falls back and stays retained raw rather than being narrowed into a shape it does not have.
import type { ToolEvent } from "./transcriptModel.js";

export type ToolStatus = "running" | "success" | "error" | "interrupted" | "rejected" | "suppressed";
export interface NormalizedToolResult {
  tool: string; status: ToolStatus; source: "pending" | "structured" | "fallback";
  rawContent: unknown; flatText: string; summary: string; output: string; outputLines: readonly string[]; structured?: Record<string, unknown>;
}

/** Upstream's invisible bookkeeping/deferred-lookup tools: retained in full as source, projected as nothing. */
const SUPPRESSED = new Set(["TaskCreate", "TaskUpdate", "ToolSearch"]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const lineCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;   // sidecars are unknown-typed: -1 or 1.5 must fall back, not summarize

/** Rendering-only conversion, NOT a reduction of the source: a string is preserved verbatim; recognized
 *  `{type:"text", text}` blocks join in source order with `\n`. Any other block is left alone — `rawContent`
 *  keeps it, and F1 simply shows no generic textual detail for it until a later scope owns that shape. */
export function flatText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b): b is Record<string, unknown> => isRecord(b) && b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n");
}
const toLines = (text: string): readonly string[] => (text.length === 0 ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n"));
const countLines = (n: number): string => `${n} line${n === 1 ? "" : "s"}`;

// Narrow recognizers for the exact 0.3.220 sidecar shapes; each returns the sidecar itself so it is retained whole.
const readShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && isRecord(v.file) && lineCount(v.file.numLines) ? v : undefined);
const writeShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.filePath === "string" && typeof v.content === "string" && Array.isArray(v.structuredPatch) ? v : undefined);
const editShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.filePath === "string" && typeof v.oldString === "string" && typeof v.newString === "string" && Array.isArray(v.structuredPatch) ? v : undefined);
const bashShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.stdout === "string" && typeof v.stderr === "string" && typeof v.interrupted === "boolean" && typeof v.noOutputExpected === "boolean" && typeof v.isImage === "boolean" && (v.returnCodeInterpretation === undefined || typeof v.returnCodeInterpretation === "string") ? v : undefined);
const agentShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.agentId === "string" ? v : undefined);

/** `options.verbose` is the renderer's later expansion switch (Task 3). Retention here is deliberately
 *  verbose-independent: the normalizer never truncates its own source, so collapsing stays a projection choice. */
export function normalizeToolResult(event: ToolEvent, options?: { verbose?: boolean }): NormalizedToolResult {
  void options;
  const tool = event.name;
  // FIRST, ahead of the open-call check and every shape guard: the suppressed tools. They stay complete source
  // records (`flatText`/`rawContent` are faithful) and only their PROJECTION is empty — the one deliberate
  // exception to deriving `outputLines` from `flatText`. An OPEN suppressed call is `suppressed`, not `running`.
  if (SUPPRESSED.has(tool)) return { tool, status: "suppressed", source: event.result ? "fallback" : "pending", rawContent: event.result?.content, flatText: flatText(event.result?.content ?? ""), summary: tool, output: "", outputLines: [] };
  // The sole open-call shape (used by projectPending): it must never fabricate structured or flat result data.
  if (!event.result) return { tool, status: "running", source: "pending", rawContent: undefined, flatText: "", summary: tool, output: "", outputLines: [] };

  const { content, isError, sidecar } = event.result;
  const value = sidecar?.scope === "call" ? sidecar.value : undefined;       // only a uniquely associated sidecar is usable
  const flat = flatText(content), outputLines = toLines(flat), trimmed = flat.trim();
  const input = isRecord(event.input) ? event.input : {};
  let status: ToolStatus = trimmed === "Interrupted" ? "interrupted" : trimmed === "Tool use rejected" ? "rejected" : isError ? "error" : "success";
  let structured: Record<string, unknown> | undefined;
  let summary = tool;                                                        // generic default; unknown tools keep exactly this
  if (tool === "Read") {
    structured = readShape(value);
    summary = `Read ${countLines(structured ? (structured.file as Record<string, unknown>).numLines as number : outputLines.length)}`;
  } else if (tool === "Write") {
    structured = writeShape(value);
    const written = structured ? String(structured.content) : typeof input.content === "string" ? input.content : undefined;
    summary = `Wrote ${countLines(written === undefined ? outputLines.length : toLines(written).length)}`;
  } else if (tool === "Edit") {
    structured = editShape(value);                                           // absolute hunk positions retained for F4; F1 emits no diff
  } else if (tool === "Bash") {
    structured = bashShape(value);
    if (structured?.interrupted === true) status = "interrupted";            // `returnCodeInterpretation` is retained as source, never read as an exit code
  } else if (tool === "Agent") {
    structured = agentShape(value);                                          // F3 owns totals; F1 stays generic
  }
  return { tool, status, source: structured ? "structured" : "fallback", rawContent: content, flatText: flat, summary, output: outputLines.join("\n"), outputLines, ...(structured ? { structured } : {}) };
}
