// tui/src/retryStatus.ts — Wave T Task 12: recognition of the SDK's `system/api_retry` frames as LIVE-TURN
// chrome. Probe 96 established that every retry attempt emits
// `{type:"system", subtype:"api_retry", attempt, max_retries, retry_delay_ms, error_status, error}` and that
// the frame already reaches the REPL unrecognised; this module is the whole recognition step. The row that
// REPLACES the spinner (canon mount L407973) is Task 13's — nothing here renders, and nothing here may
// become a transcript row: one ten-attempt ladder is ONE replaced spinner row, not ten notices, which is why
// `species.ts` keeps painting nothing for this subtype.
//
// `stalled` covers the pre-evidence window canon paints as `Waiting for API response` (label L407992, tail
// L407997): a blackholed endpoint burns ~75 s of connect timeout BEFORE the first api_retry frame exists, so
// no frame can produce it. It is CLIENT-owned — `useChat`'s turn-start watchdog mints it (Task 13) — and it
// lives in this union because it fills the same live-turn slot as the frame-driven half.
export type RetryStatus =
  | { kind: "stalled" }
  | { kind: "retrying"; attempt: number; maxRetries: number; deadline: number; label: string };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Canon `rZp` (L437178-437190) — upstream's own prose table for exactly this failure, ported verbatim. Its
 *  argument is the HTTP status of the attempt that failed; the wire's `error_status` is that status, or
 *  `null` when no response ever arrived, which lands on the same `API error` default canon falls back to. */
function errorProse(status: unknown): string {
  switch (status) {
    case 429: return "Rate limited";
    case 529: return "API overloaded";
    case 401: case 403: return "Authentication failed";
    default: return "API error";
  }
}

/** Map one SDK message to the retry status it announces, or `undefined` if it announces none. `now` is the
 *  arrival instant the countdown is seeded from — `deadline = now + retry_delay_ms`, since the frame carries
 *  a delay, not a wall-clock target (canon recomputes `ceil((deadline - now)/1000)` per animation frame). */
export function retryStatusFrom(frame: unknown, now: number): RetryStatus | undefined {
  const f = frame as { type?: unknown; subtype?: unknown; attempt?: unknown; max_retries?: unknown; retry_delay_ms?: unknown; error_status?: unknown } | null | undefined;
  if (!f || typeof f !== "object" || f.type !== "system" || f.subtype !== "api_retry") return undefined;
  const attempt = num(f.attempt), maxRetries = num(f.max_retries);
  // Canon `b0p` (L408007) is
  // `attempt >= Math.min(3, maxRetries) || error.isNetworkDown || error.connection?.isSSLError || rateLimits`,
  // and the label (L408010) is `!showDetail ? "API error" : rateLimits ? "<Type> reached" : error.formatted`.
  // DELIBERATE SIMPLIFICATION: this wire frame carries none of the other three signals — no rate-limit
  // metadata, no network-down flag, no SSL detail (probe 96 read it key by key) — so upstream's disjunction
  // reduces to the attempt count alone, and the rate-limit label branch is unreachable here. A ceiling of 0
  // is not a real ceiling: `Math.min(3, 0)` would fire showDetail on attempt 0 of a frame that simply omitted
  // `max_retries`, so an absent/non-positive ceiling falls back to canon's own constant 3.
  // The stand-in for upstream's `error.formatted` is `rZp(error_status)`, NOT the frame's `error` field:
  // `error` is `pir(...)` (L157864-157873) and yields one of overloaded | rate_limit | authentication_failed
  // | server_error | unknown — wire slugs, none of which appears anywhere in canon's UI, and the one probe 96
  // actually recorded is "unknown", strictly less informative than the `API error` literal it would replace.
  // `rZp` is canon's prose for this very frame and already degrades to that same literal when there is no
  // detail to show (no response at all → `error_status: null` → the default arm).
  const showDetail = attempt >= (maxRetries > 0 ? Math.min(3, maxRetries) : 3);
  const label = showDetail ? errorProse(f.error_status) : "API error";
  return { kind: "retrying", attempt, maxRetries, deadline: now + num(f.retry_delay_ms), label };
}
