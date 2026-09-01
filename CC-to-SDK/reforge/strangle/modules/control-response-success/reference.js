// PARITY LAYER (§2.5 `reference`) — the success envelope every control_response
// leaves through (upstream `gK`, 2.1.251, chunk-g1qrzvef).
//
// One hundred and two bytes, zero free variables, and SEVEN call sites across
// the headless runtime and the remote-control worker. Every `initialize`, every
// `set_permission_mode`, every `set_model`, every `mcp_message` — every request
// the SDK sends the engine that succeeds — comes back through here, which makes
// it the highest-liveness-per-byte unit in the campaign so far: sabotaging it
// reddens on `initialize` alone, and every SDK-driven scenario sends one.
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
