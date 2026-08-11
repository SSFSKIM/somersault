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
// TRANSCRIBED from upstream's ladder `uOu` (`L163990-99`) + `Hli` (`L488912`):
//   percentLeft            = max(0, round((threshold − used) / threshold × 100))      (`L163991`)
//   isAboveWarningThreshold = used >= threshold − 20 000                              (`L163991`, `s = i - 20000`)
//   warn label             = `${percentLeft}% until auto-compact`   (dim; `L488935`)
//   error label            = `Context low (${percentLeft}% remaining) · Run /compact to compact & continue`
// The clamp is upstream's own (`Math.max(0, …)`), and it is why the escalated line reads `(0% remaining)` the
// moment the ceiling is crossed rather than counting into negatives.
//
// THE CEILING IS UPSTREAM'S OWN FORMULA, constant by constant (this was a spec mis-citation once — the spec
// read the ×0.8 buffer fraction `Mds` at `L164000` as the ceiling, but that fraction feeds a DIFFERENT
// threshold: `Dds` at `L163987`, the compaction PRE-WARMING one. The ladder never touches it):
//   ceiling = window − min(maxOutputTokens, 20 000) − 13 000
//           = `Sfo(Tbe(model, window))`, i.e. `Tbe` (`L164098`) `o - min(wfo(model), mOu)` with `mOu = 20 000`
//             (`L164151`), fed through `Sfo` (`L163981`) `e - 13000`.
// ccx has one honest input — `getContextUsage()` returns `{totalTokens, maxTokens}` — and that is enough,
// because `min(maxOutputTokens, 20 000)` SATURATES at 20 000 for every current Claude model (they all allow
// at least 32k output; the cap is the `min`'s right arm, never the model's row). So the two terms collapse to
// a flat 33 000 and no per-model output-budget lookup is needed. A model that ever shipped with a max-output
// under 20 000 would make this warn slightly early — nothing in the catalog does.
//
// ONE DELIBERATE SIMPLIFICATION, pinned by the spec rather than invented here: WARN AND ERROR ARE SPLIT AT
// THE CEILING. Upstream's two buffers are BOTH 20 000, so its own split is not a token threshold at all — it
// is `isAutoCompactEnabled()` (`Xk()`, `L488936`), a config flag ccx does not surface. The spec pinned the
// ladder by ZONE instead (warn in the last 20 000 before the ceiling, error at and past it), which is the
// same escalation a user experiences and the one this port can actually compute.
//
// THE TWO-TEXT VARIANT WE DO NOT SHIP, recorded so a later task does not rediscover it as a bug. Upstream's
// `Hli` (`L488912`) picks its text off the auto-compact WINDOW SOURCE, not off the zone: when the window is
// unconfigured (`source === "auto"`, i.e. `!Xqe(model, window)`) it renders `${100 − N}% context used`
// (`L488935`, left arm), and only a CONFIGURED window gets `${N}% until auto-compact` (right arm). Its
// `Context low (…)` line, meanwhile, is the arm taken when auto-compact is DISABLED (`L488945`), not when the
// context is worse. Both selectors are flags ccx has no reading of, so this port ships the spec's zone ladder
// and the `% until auto-compact` wording throughout. Deliberate, owner-decided, not an oversight.

/** `mOu` (`L164151`): the cap on the output reserve. `min(maxOutputTokens, 20 000)` saturates here for every
 *  current Claude model, which is what lets the ceiling below be a constant. */
export const MAX_OUTPUT_RESERVE_TOKENS = 20_000;
/** `sOu`/`Sfo`'s flat subtraction (`L164000`, applied `L163981`): headroom above the output reserve. */
export const COMPACT_HEADROOM_TOKENS = 13_000;
/** The whole reserve upstream keeps below the window before auto-compacting: 33 000. */
export const AUTO_COMPACT_RESERVE_TOKENS = MAX_OUTPUT_RESERVE_TOKENS + COMPACT_HEADROOM_TOKENS;
/** `WARNING_THRESHOLD_BUFFER_TOKENS` (`L163991`, `s = i - 20000`) — how far ahead of the ceiling the first
 *  warning appears. */
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

/** The auto-compact ceiling: the point at which the engine compacts on its own. `window − 33 000`, which is
 *  upstream's `Sfo(Tbe(model, window))` with the saturated `min` folded in (see the header). */
export function autoCompactCeiling(window: number): number { return window - AUTO_COMPACT_RESERVE_TOKENS; }

/** The ladder. `used`/`window` are `getContextUsage()`'s `totalTokens`/`maxTokens`; either being absent (an
 *  engine that has not answered yet, or a session with no window to report) means we know nothing and must
 *  say nothing — an invented denominator here would be a warning about a number we made up. A window no
 *  larger than the reserve is the same kind of nothing: its ceiling is zero or negative, and the percentage
 *  computed off it would read back a confident figure from a meaningless denominator. */
export function tokenWarning(used: number | undefined, window: number | undefined): TokenWarningPost | null {
  if (typeof used !== "number" || typeof window !== "number" || !(window > AUTO_COMPACT_RESERVE_TOKENS)) return null;
  const ceiling = autoCompactCeiling(window);
  if (used < ceiling - TOKEN_WARN_LEAD_TOKENS) return null;
  const percentLeft = Math.max(0, Math.round(((ceiling - used) / ceiling) * 100));
  return used >= ceiling
    ? { text: `Context low (${percentLeft}% remaining) · Run /compact to compact & continue`, error: true }
    : { text: `${percentLeft}% until auto-compact`, error: false };
}
