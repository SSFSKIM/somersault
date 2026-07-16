import { USAGE_LIMIT_ERROR_PREFIXES, USAGE_TRANSITION_PREFIXES, USAGE_WARNING_PREFIXES, ORG_POLICY_LIMIT_PREFIXES } from "@anthropic-ai/claude-agent-sdk";

/** Typed billing/limit states (Wave 1 item 3 — the 2026-07 auth incident, productized).
 *  A limited turn often still reports subtype "success" with the error as the result TEXT, so
 *  classification is text-first, over the SDK's runtime-exported prefix constants PLUS observed
 *  families the SDK does not declare. */
export type LimitKind = "usage-limit" | "usage-warning" | "usage-transition" | "org-policy" | "credits-exhausted" | "rate-limit";
export interface LimitState { kind: LimitKind; message: string; resetsAt?: number; }

// Observed in the wild but ABSENT from the SDK's declared prefixes — keep both families.
// 2026-07 incident: an org-side policy flip made every turn "succeed" with this text (exit 1 after).
const OBSERVED_ORG_POLICY = ["Your organization has disabled Claude subscription access"];
// Metered API-key exhaustion (surfaced when the key shadows/replaces the OAuth token).
const OBSERVED_CREDITS = ["Credit balance is too low"];

const starts = (text: string, prefixes: readonly string[]) => prefixes.some((p) => text.startsWith(p));
const contains = (text: string, needles: readonly string[]) => needles.some((n) => text.includes(n));

/** Classify a result/error text. Returns undefined for normal text. Order matters: the SDK's
 *  usage-limit prefixes ("You've hit your"…) are disjoint from warnings ("You've used"…), but the
 *  observed families are matched by containment (they surface embedded in longer result texts). */
export function classifyLimitText(text: string): LimitState | undefined {
  if (!text) return undefined;
  if (starts(text, USAGE_LIMIT_ERROR_PREFIXES)) return { kind: "usage-limit", message: text };
  if (starts(text, ORG_POLICY_LIMIT_PREFIXES) || contains(text, OBSERVED_ORG_POLICY)) return { kind: "org-policy", message: text };
  if (contains(text, OBSERVED_CREDITS)) return { kind: "credits-exhausted", message: text };
  if (starts(text, USAGE_TRANSITION_PREFIXES)) return { kind: "usage-transition", message: text };
  if (starts(text, USAGE_WARNING_PREFIXES)) return { kind: "usage-warning", message: text };
  return undefined;
}

/** Classify a streamed SDK message. Handles `result` frames (by text) and `rate_limit_event` frames
 *  (status "rejected" → rate-limit, carrying resetsAt). Every other message type → undefined, so
 *  callers can apply state-of-last-signal semantics (a clean result / allowed event CLEARS). */
export function classifyLimitMessage(m: unknown): LimitState | undefined {
  const mm = m as any;
  if (!mm || typeof mm !== "object") return undefined;
  if (mm.type === "rate_limit_event") {
    const info = mm.rate_limit_info;
    if (info?.status !== "rejected") return undefined;
    return { kind: "rate-limit", message: `rate limited (${info.rateLimitType ?? "unknown"})`, ...(info.resetsAt !== undefined ? { resetsAt: info.resetsAt } : {}) };
  }
  if (mm.type === "result") return classifyLimitText(String(mm.result ?? ""));
  return undefined;
}
