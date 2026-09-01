// SABOTAGE LAYER (§2.5). The envelope keeps its shape and loses its payload:
// every control_response comes back well-formed, correctly correlated, and
// empty. `initialize` is the first request of every SDK-driven run, so its
// capabilities vanish for every scenario at once. Inert rather than a hang —
// dropping the `request_id` would leave the SDK waiting rather than failing.
export function controlResponseSuccess(requestId, response) {
  return { type: "control_response", response: { subtype: "success", request_id: requestId, response: {} } };
}
