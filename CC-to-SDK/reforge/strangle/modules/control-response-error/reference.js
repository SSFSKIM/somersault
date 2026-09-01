// PARITY LAYER (§2.5 `reference`) — the error envelope every failed
// control_request leaves through (upstream `$U`, 2.1.251, chunk-g1qrzvef).
//
// Ninety-seven bytes, zero free variables, NINE call sites. The success
// envelope's twin, and the pair is what makes the control protocol legible: a
// response is a success or an error, the discriminator is `subtype`, and the
// `request_id` sits beside it rather than above it.
//
// THE ERROR IS A STRING, not a structured object — every refusal in the protocol
// (an unknown subtype, a mode the guard rejected, a thinking budget out of
// range) is flattened to one message here, which is why the guard messages
// upstream writes are full sentences rather than codes. The mode-change guard's
// five refusals are the clearest case: they are user-facing prose precisely
// because this envelope is the only thing carrying them.
//
// `response.error` rather than `response.response`: an error envelope has NO
// payload slot, so a handler that wanted to return data with a failure cannot.

/**
 * @param requestId the id the SDK is waiting on
 * @param error     the message explaining the refusal
 */
export function controlResponseError(requestId, error) {
  return { type: "control_response", response: { subtype: "error", request_id: requestId, error } };
}
