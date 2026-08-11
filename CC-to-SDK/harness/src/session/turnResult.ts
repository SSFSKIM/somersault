// src/session/turnResult.ts — Wave T Task 14: the ONE place that decides whether a terminal `type:"result"`
// frame means the turn succeeded.
//
// Probe 96 (2026-08-06, `probes/probes/96-transport-failure-surface.ts`) settled why `subtype` cannot be
// that decision. On a dead connection — blackholed endpoint, refused connection, non-retryable 401 — the
// SDK's terminal frame is `subtype:"success"` and the failure lives entirely in
// `is_error:true · terminal_reason:"api_error" · api_error_status:(401|null)`, with the error TEXT in
// `result`. A classifier keyed on `subtype` reads a dead connection as a completed turn.
//
// `is_error` is the field to key on because sdk.d.ts declares it REQUIRED on BOTH result shapes
// (`SDKResultSuccess` and `SDKResultError`) — it is the only field with that property. `api_error_status`
// is a second, NARROWER signal: it counts only at `>= 400` (see the threshold note on the check below),
// and its `null` form never decides on its own. `terminal_reason` enriches the tag rather than deciding,
// because several of its declared values ("background_requested", "tool_deferred", "completed") are not
// failures at all.

/** A turn that REACHED a terminal result frame and reported failure. Deliberately distinct from a
 *  transport exception (the SDK's async iterator throwing), which stays a rejection: a turn that ran and
 *  reported an error carries a session id, usage, cost and an error text, and collapsing the two would
 *  throw all of that away. */
export interface TurnFailure {
  /** Human-readable cause — the frame's own `result` text when it has one (probe 96 puts
   *  "API Error: Unable to connect to API (ConnectionRefused)" there), else the joined `errors[]`. */
  message: string;
  terminalReason?: string;
  apiErrorStatus?: number;
}

/** Classify one `type:"result"` frame. `undefined` means the turn genuinely succeeded. */
export function turnFailureOf(m: unknown): TurnFailure | undefined {
  const mm = m as any;
  if (!mm || typeof mm !== "object" || mm.type !== "result") return undefined;
  const status = typeof mm.api_error_status === "number" ? mm.api_error_status : undefined;
  // The `>= 400` threshold is this repo's OWN, taken from the reviewed correlation probes so the rule
  // cannot drift between them and here: `probes/probes/94-tool-census.ts:768` and
  // `probes/probes/94b-result-correlation.ts:170-171` both call a result frame unhealthy only at
  // `(apiErrorStatus ?? 0) >= 400`, and `validResultFrameShape` (94-tool-census.ts:1321-1322) accepts ANY
  // finite `api_error_status` — including `null` — on a `subtype:"success"` frame. Treating every finite
  // status as failure would therefore contradict our own health rule and mint failures for healthy frames
  // (runStructured throws on the tag), while buying nothing: `is_error` alone already covers every frame
  // probe 96 measured. Written in the probes' exact form, which also leaves NaN a non-failure.
  if (mm.is_error !== true && !((status ?? 0) >= 400)) return undefined;
  const reason = typeof mm.terminal_reason === "string" ? mm.terminal_reason : undefined;
  const errors = Array.isArray(mm.errors) ? mm.errors.filter((e: unknown) => typeof e === "string" && e.length > 0) : [];
  const text = typeof mm.result === "string" && mm.result.trim() ? mm.result.trim() : errors.join("; ");
  return {
    message: text || reason || (typeof mm.subtype === "string" ? mm.subtype : "turn failed"),
    ...(reason ? { terminalReason: reason } : {}),
    ...(status === undefined ? {} : { apiErrorStatus: status }),
  };
}
