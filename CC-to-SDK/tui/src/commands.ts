// tui/src/commands.ts — pure slash-command surface: parse + table + result-line formatters. No React/SDK side effects.
import type { CompactOutcome, ContextUsageSummary } from "cc-harness";
import type { RenderLine } from "./render.js";

export interface ParsedCommand { name: string; args: string }

/** Leading "/" → {name, args}; non-slash or bare "/" → null. */
export function parseCommand(input: string): ParsedCommand | null {
  const t = input.trim();
  if (!t.startsWith("/")) return null;
  const body = t.slice(1).trim();
  if (!body) return null;                                       // bare "/" is not a command
  const sp = body.indexOf(" ");
  return sp < 0 ? { name: body, args: "" } : { name: body.slice(0, sp), args: body.slice(sp + 1).trim() };
}

export const COMMANDS: { name: string; summary: string }[] = [
  { name: "model", summary: "<name> — switch model (no arg shows current)" },
  { name: "compact", summary: "compact the conversation context" },
  { name: "context", summary: "show context-window usage" },
  { name: "clear", summary: "clear the screen (session context kept)" },
  { name: "resume", summary: "resume a prior session" },
  { name: "help", summary: "list commands" },
];

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`);   // 31000→"31k", 18500→"18.5k"

export function formatHelp(): RenderLine[] {
  return [{ text: "commands:", dim: true }, ...COMMANDS.map((c) => ({ text: `  /${c.name}  ${c.summary}`, dim: true }))];
}
export function formatModel(next?: string, current?: string): RenderLine[] {
  return next ? [{ text: `model → ${next}` }] : [{ text: `model: ${current ?? "(default)"}`, dim: true }];
}
export function formatCompact(o: CompactOutcome): RenderLine[] {
  return o.ok ? [{ text: `✦ compacted ${k(o.preTokens ?? 0)} → ${k(o.postTokens ?? 0)}` }]
              : [{ text: `compact: ${o.error ?? "nothing to compact"}`, dim: true }];
}
export function formatContext(s: ContextUsageSummary): RenderLine[] {
  return [{ text: `ctx ${s.percentUsed}% · ${k(s.tokensUsed)} / ${k(s.maxTokens)} · ${s.status}`, dim: true }];
}
export function formatResumed(summary: string, id: string): RenderLine[] {
  return [{ text: `↻ resumed "${summary}" (${id.slice(0, 8)})`, dim: true }];
}
export function formatUnknown(name: string): RenderLine[] {
  return [{ text: `Unknown command: /${name} · try /help`, color: "red" }];
}
