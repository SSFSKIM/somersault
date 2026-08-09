// tui/src/tokenWarning.ts — Wave C Task 14: the context-pressure LADDER, pure. No React, no Ink, no clock,
// no theme — it answers "what, if anything, should the notification queue be saying about the context right
// now", and `useChat` turns that answer into a `CcxNotification` at the one place it already re-measures.
//
// WHY THIS IS A NOTIFICATION AT ALL. ccx used to paint `ctx N%` and `⚠ auto-compact soon` as always-on chips
// on a status bar Wave C Task 2 retired. The spec's owner-decision section (D-C3) removed the chips and kept
// the information: upstream exposes context pressure through the statusLine, the slash commands, and exactly
// one queue entry — `token-warning`, `priority:"medium"`, `timeoutMs:18000000` (`L489324`), whose text comes
// from `<Hli tokenUsage model/>` (`L488940`). Every other ccx consumer of the number survives untouched
// (`/status`, `/cost`, `/context`, the statusLine payload's `context_window` block).
//
// TRANSCRIBED from upstream's `calculateTokenWarningState` + `TokenWarning.tsx`:
//   percentLeft            = max(0, round((threshold − used) / threshold × 100))
//   isAboveWarningThreshold = used >= threshold − 20 000
//   warn label             = `${percentLeft}% until auto-compact`   (dim; the auto-compact-enabled arm)
//   error label            = `Context low (${percentLeft}% remaining) · Run /compact to compact & continue`
// The clamp is upstream's own, and it is why the escalated line reads `(0% remaining)` the moment the ceiling
// is crossed rather than counting into negatives.
//
// TWO DELIBERATE SIMPLIFICATIONS, both pinned by the spec rather than invented here:
//
//  1. THE CEILING IS `window × 0.8`. Upstream's is `contextWindow − min(maxOutputTokens, 20 000) − 13 000`,
//     which needs the model's max-output row and its SDK betas; ccx has one honest input — `getContextUsage()`
//     returns `{totalTokens, maxTokens}` and nothing else — so the spec pinned the 0.2 buffer fraction
//     (L164111-27) as the ccx reading. A model whose real reserve differs will warn slightly early or late;
//     it cannot warn about a window it does not have.
//  2. WARN AND ERROR ARE SPLIT AT THE CEILING. Upstream's two buffers are BOTH 20 000, so its own split is
//     not a token threshold at all — it is `isAutoCompactEnabled()`, a config flag ccx does not surface. The
//     spec pinned the ladder by ZONE instead (warn in the last 20 000 before the ceiling, error at and past
//     it), which is the same escalation a user experiences and the one this port can actually compute.

/** The 0.2 buffer fraction the spec pins (upstream L164111-27). */
export const AUTO_COMPACT_BUFFER_FRACTION = 0.2;
/** `WARNING_THRESHOLD_BUFFER_TOKENS` — how far ahead of the ceiling the first warning appears. */
export const TOKEN_WARN_LEAD_TOKENS = 20_000;
/** The queue key (`L489324`). Re-posting it FOLDS, which is what makes each turn-end refresh update in place
 *  instead of stacking a second row. */
export const TOKEN_WARNING_KEY = "token-warning";
/** `L489324`, verbatim: five hours. Effectively "until something replaces or removes it" — which is why the
 *  producer removes the entry when the ladder falls back to ok, rather than leaving a stale five-hour row. */
export const TOKEN_WARNING_TIMEOUT_MS = 18_000_000;

/** What the queue should say, or `null` for "nothing". `error` selects the error colour at the producer —
 *  this module stays theme-free so it can be unit-tested without a resolved palette. */
export interface TokenWarningPost { text: string; error: boolean }

/** The auto-compact ceiling: the point at which the engine compacts on its own. */
export function autoCompactCeiling(window: number): number { return window * (1 - AUTO_COMPACT_BUFFER_FRACTION); }

/** The ladder. `used`/`window` are `getContextUsage()`'s `totalTokens`/`maxTokens`; either being absent (an
 *  engine that has not answered yet, or a session with no window to report) means we know nothing and must
 *  say nothing — an invented denominator here would be a warning about a number we made up. */
export function tokenWarning(used: number | undefined, window: number | undefined): TokenWarningPost | null {
  if (typeof used !== "number" || typeof window !== "number" || !(window > 0)) return null;
  const ceiling = autoCompactCeiling(window);
  if (used < ceiling - TOKEN_WARN_LEAD_TOKENS) return null;
  const percentLeft = Math.max(0, Math.round(((ceiling - used) / ceiling) * 100));
  return used >= ceiling
    ? { text: `Context low (${percentLeft}% remaining) · Run /compact to compact & continue`, error: true }
    : { text: `${percentLeft}% until auto-compact`, error: false };
}
