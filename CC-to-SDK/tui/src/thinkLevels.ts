// tui/src/thinkLevels.ts — the single source of truth for the /think level↔budget vocabulary. The level
// NAMES borrow the SDK effort enum (low/medium/high/xhigh/max) + an `off` rung; the MECHANISM is the thinking
// token budget (the only runtime lever — Session.setMaxThinkingTokens / the set_thinking control frame).
export const THINK_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
const BUDGETS: Record<string, number> = { off: 0, low: 4000, medium: 10000, high: 16000, xhigh: 24000, max: 32000 };

/** Level name → thinking token budget (unknown → 0). */
export function thinkBudget(level: string): number { return BUDGETS[level] ?? 0; }

/** Reverse: an exact budget → its level name, else "<N/1000>k" (e.g. 15000 → "15k"). */
export function thinkLabel(budget: number): string {
  const hit = THINK_LEVELS.find((l) => BUDGETS[l] === budget);
  return hit ?? `${Math.round(budget / 100) / 10}k`;
}

/** A level NAME or a raw non-negative integer → {level, budget}; invalid → null. */
export function parseThinkArg(arg: string): { level: string; budget: number } | null {
  const a = arg.trim();
  if ((THINK_LEVELS as readonly string[]).includes(a)) return { level: a, budget: BUDGETS[a] };
  if (/^\d+$/.test(a)) { const budget = parseInt(a, 10); return { level: thinkLabel(budget), budget }; }
  return null;
}
