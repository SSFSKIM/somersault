// SABOTAGE LAYER (§2.5). Every mode request is refused.
//
// Observable because the arm branches on `ok`: a refusal turns the host's
// `set_permission_mode` answer from a success frame into an error frame carrying
// this sentence, which the raw driver reads straight off the wire and the SDK's
// own setter surfaces as a rejection. The quieter mutants — applying the mode
// without transitioning, or returning the context unchanged — were exactly the
// shape C9 measured INERT on this subsystem, so they live in the parity oracle
// instead.
export function applyPermissionModeRequest() {
  return { ok: false, error: "reforge sabotage: the mode setter refused" };
}
