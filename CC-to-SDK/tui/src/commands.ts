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
  { name: "continue", summary: "resume the most-recent session" },
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

export type InitialResume = { kind: "id"; id: string } | { kind: "continue" };

/** The session id with the greatest lastModified, or undefined for an empty list. */
export function pickMostRecent(sessions: { sessionId: string; lastModified: number }[]): string | undefined {
  let best: { sessionId: string; lastModified: number } | undefined;
  for (const s of sessions) if (!best || s.lastModified > best.lastModified) best = s;
  return best?.sessionId;
}

/** CLI args → an initial-resume intent: `--resume <id>` / `--continue` / `-c`. */
export function parseResumeIntent(args: string[]): InitialResume | undefined {
  const ri = args.indexOf("--resume");
  if (ri >= 0 && args[ri + 1]) return { kind: "id", id: args[ri + 1] };
  if (args.includes("--continue") || args.includes("-c")) return { kind: "continue" };
  return undefined;
}
