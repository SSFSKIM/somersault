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

/** Launch-time `--think` argument → the SDK config's `thinking` field (undefined when `think` is absent
 *  or fails to parse). Shared by every `--think`-consuming launch path — `runForegroundImpl`, the
 *  `--__host` child (hostMain.ts, both bg and interactive), and the `-p` runOnce path — so the flag
 *  behaves identically no matter which one reads it (F4: it used to work on foreground only). */
export function thinkingConfigFrom(think?: string): { type: "disabled" } | { type: "enabled"; budgetTokens: number } | undefined {
  const parsed = think ? parseThinkArg(think) : undefined;
  return parsed ? (parsed.budget === 0 ? { type: "disabled" } : { type: "enabled", budgetTokens: parsed.budget }) : undefined;
}
