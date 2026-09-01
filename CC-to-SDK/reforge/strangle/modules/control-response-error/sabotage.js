// SABOTAGE LAYER (§2.5). Every protocol refusal is flattened to one message, so
// the sentence a guard wrote — the mode-change guard's five refusals, the
// unknown-subtype message, a validation range — never reaches the SDK host.
// The envelope is still well-formed and still correlated: inert, and wrong
// exactly where the protocol's only human-readable field is.
export function controlResponseError(requestId, error) {
  return { type: "control_response", response: { subtype: "error", request_id: requestId, error: "reforge sabotage" } };
}
