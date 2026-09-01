// PARITY LAYER (§2.5 `reference`) — the success envelope every control_response
// leaves through (upstream `gK`, 2.1.251, chunk-g1qrzvef).
//
// One hundred and two bytes, zero free variables, and SEVEN call sites across
// the headless runtime and the remote-control worker.
//
// WITH ONE MEASURED EXCEPTION, and it is worth stating because the W5-W7 scout
// got it backwards: `initialize` does NOT come through here. The headless
// runtime builds the initialize and reinitialize responses as INLINE object
// literals — two of the three `subtype:"success"` sites in its own chunk — and
// routes every OTHER inbound subtype through this constructor, via the one
// responder the request loop shares (`set_permission_mode`, `set_model`,
// `set_max_thinking_tokens`, `interrupt`, `mcp_message`, remote-tools-announce).
// So the first request of every run is the one request this never serves, and a
// scenario that only says hello cannot see it at all. Measured by sabotage:
// `plain` stays green, `runtime-setters` goes red.
//
// THE SHAPE IS THE PROTOCOL. Three levels of nesting, `request_id` echoed back
// at the SECOND level rather than the first, and the payload under `response`.
// The SDK matches a response to its pending request by that `request_id` and by
// nothing else, so a mis-nested envelope does not error — it hangs.
//
// This is W7's seam as much as W6's: the permission wave takes it because the
// `can_use_tool` round trip is the only control request the permission chain
// itself issues, and leaving the return leg unowned would have made the chain's
// ownership stop mid-round-trip. W7 inherits the request leg and the subtype
// handlers.

/**
 * @param requestId the id the SDK is waiting on
 * @param response  the handler's payload
 */
export function controlResponseSuccess(requestId, response) {
  return { type: "control_response", response: { subtype: "success", request_id: requestId, response } };
}
