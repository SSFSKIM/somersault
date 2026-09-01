// SABOTAGE LAYER (§2.5). Every switch is refused as unrecognised.
//
// Observable twice over, which is why this twin rather than a quieter one: the
// arm turns the refusal into an ERROR control_response the raw driver reads off
// the wire, and the model never changes, so the turn that follows is issued
// against the model the session started with and the request body diverges too.
// The quiet mutants — accepting without applying, or dropping the notices — are
// the shape C9 measured inert on this kind of setter, so they live in the parity
// oracle instead.
export async function applyModelSwitchRequest() {
  return { ok: false, error: "reforge sabotage: the model switch refused" };
}
