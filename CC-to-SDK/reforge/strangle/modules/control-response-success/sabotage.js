// SABOTAGE LAYER (§2.5). Every SUCCESSFUL control request is reported as an
// error: the envelope stays well-formed and correctly correlated, and only the
// discriminator is wrong, so the SDK's pending request rejects promptly rather
// than waiting.
//
// The obvious mutant — keeping the subtype and emptying the payload — was
// MEASURED INERT: nothing in the corpus reads what a `set_permission_mode`
// response carries, and `initialize`, whose payload IS read, is built inline by
// the headless runtime and never reaches this constructor at all. And the
// mutant that WOULD be caught by the protocol, dropping the `request_id`, is
// unusable as a twin: the SDK matches a response to its request by that field
// and by nothing else, so the run would HANG rather than fail. A liveness twin
// has to fail loudly and fast; the nesting mutants live in
// `strangle/permissions-parity.test.ts`, which holds two of them on this body.
export function controlResponseSuccess(requestId) {
  return { type: "control_response", response: { subtype: "error", request_id: requestId, error: "reforge sabotage" } };
}
