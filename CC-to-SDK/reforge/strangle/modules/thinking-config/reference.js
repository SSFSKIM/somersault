// PARITY LAYER (§2.5 `reference`) — resolve the session's thinking
// configuration from a `set_max_thinking_tokens` control request (upstream `Sf`,
// 2.1.251, chunk-dvbbv89q).
//
// THE ONE PLACE A HOST CAN CHANGE HOW MUCH THE MODEL THINKS. Two call sites,
// both on the control path: the `set_max_thinking_tokens` arm and the setter
// callback the SDK's own transport exposes. Its answer becomes the session's
// thinking config, which the request builder then reads on every turn.
//
// FOUR ARMS, and the partition is on the REQUESTED value rather than on the
// current one:
//
//   a number > 0   -> an explicit budget. `{type:"enabled", budgetTokens, display}`.
//   exactly 0      -> `{type:"disabled"}` — and note this arm DROPS the display,
//                     because a disabled config has nothing to display.
//   null/undefined, with an explicit config already in force
//                  -> keep that config and restamp its display, UNLESS it is
//                     disabled, in which case it is returned untouched. Same
//                     asymmetry as above, from the other direction: a disabled
//                     config never acquires a display.
//   null/undefined, with nothing in force
//                  -> `{type:"adaptive", display}` when a display was asked for
//                     AND adaptive thinking is allowed; otherwise UNDEFINED,
//                     which means "no thinking config at all" and is a different
//                     answer from `{type:"disabled"}` one layer down.
//
// WHAT THE WIRE ACTUALLY DOES WITH THIS, measured, because it bounds what any
// scenario can prove: the request builder decides `adaptive` vs `enabled` from
// the MODEL, not from this type. On an adaptive-capable model it emits
// `{type:"adaptive", display}` and discards `budgetTokens` entirely. So through
// a recording this function is observable in exactly two of its outputs — whether
// the config is disabled (the request then carries no `thinking` at all) and
// what the display is. The budget's own arms are graded by the parity oracle
// against upstream's bytes, and nowhere else.

/**
 * @param requestedTokens          the host's `max_thinking_tokens` (number, 0, null or absent)
 * @param display                  the host's `thinking_display`, already normalised by the caller
 * @param currentExplicit          the config already in force, when the session pinned one explicitly
 * @param adaptiveThinkingAllowed  port — is adaptive thinking available at all?
 */
export function resolveThinkingConfig(requestedTokens, display, currentExplicit, adaptiveThinkingAllowed) {
  if (requestedTokens == null) {
    if (currentExplicit) return currentExplicit.type !== "disabled" ? { ...currentExplicit, display } : currentExplicit;
    return display !== undefined && adaptiveThinkingAllowed() ? { type: "adaptive", display } : undefined;
  }
  if (requestedTokens === 0) return { type: "disabled" };
  return { type: "enabled", budgetTokens: requestedTokens, display };
}
