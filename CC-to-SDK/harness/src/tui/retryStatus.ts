// tui/src/retryStatus.ts — Wave T Task 12: recognition of the SDK's `system/api_retry` frames as LIVE-TURN
// chrome. Probe 96 established that every retry attempt emits
// `{type:"system", subtype:"api_retry", attempt, max_retries, retry_delay_ms, error_status, error}` and that
// the frame already reaches the REPL unrecognised; this module is the whole recognition step. The row that
// REPLACES the spinner (canon L407973) is Task 13's — nothing here renders, and nothing here may become a
// transcript row: one ten-attempt ladder is ONE replaced spinner row, not ten notices, which is why
// `species.ts` keeps painting nothing for this subtype.
//
// `stalled` covers the pre-evidence window canon paints as `Waiting for API response` (L407989-8001): a
// blackholed endpoint burns ~75 s of connect timeout BEFORE the first api_retry frame exists, so that state
// is host-owned and no frame can produce it. It lives in this union because it is the same live-turn slot.
export type RetryStatus =
  | { kind: "stalled" }
  | { kind: "retrying"; attempt: number; maxRetries: number; deadline: number; label: string };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Map one SDK message to the retry status it announces, or `undefined` if it announces none. `now` is the
 *  arrival instant the countdown is seeded from — `deadline = now + retry_delay_ms`, since the frame carries
 *  a delay, not a wall-clock target (canon recomputes `ceil((deadline - now)/1000)` per animation frame). */
export function retryStatusFrom(frame: unknown, now: number): RetryStatus | undefined {
  const f = frame as { type?: unknown; subtype?: unknown; attempt?: unknown; max_retries?: unknown; retry_delay_ms?: unknown; error?: unknown } | null | undefined;
  if (!f || typeof f !== "object" || f.type !== "system" || f.subtype !== "api_retry") return undefined;
  const attempt = num(f.attempt), maxRetries = num(f.max_retries);
  // Canon `b0p` (L408007-11) is
  // `attempt >= Math.min(3, maxRetries) || error.isNetworkDown || error.connection?.isSSLError || rateLimits`,
  // and the label is `!showDetail ? "API error" : rateLimits ? "<Type> reached" : error.formatted`.
  // DELIBERATE SIMPLIFICATION: this wire frame carries none of the other three signals — no rate-limit
  // metadata, no network-down flag, no SSL detail (probe 96 read it key by key) — so upstream's disjunction
  // reduces to the attempt count alone, and the rate-limit label branch is unreachable here. `error` is a
  // TYPED name on this wire ("unknown", "authentication_failed"), which is the closest thing we have to
  // upstream's `error.formatted`; with no name to show, the literal stands.
  const detail = typeof f.error === "string" && f.error.length > 0 ? f.error : undefined;
  const label = attempt >= Math.min(3, maxRetries) && detail ? detail : "API error";
  return { kind: "retrying", attempt, maxRetries, deadline: now + num(f.retry_delay_ms), label };
}
