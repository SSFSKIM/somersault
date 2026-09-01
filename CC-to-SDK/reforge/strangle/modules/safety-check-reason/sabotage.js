// SABOTAGE LAYER (§2.5) — INVERTED, not silenced.
// The previous twin returned `undefined`, which is what the healthy finder
// returns on every corpus input, so it could not have been observed by anything.
// This one always FINDS a safety check, which is the answer no corpus decision
// produces and every caller acts on.
export function findSafetyCheckReason(reason, accept) {
  return { type: "safetyCheck", reason: "reforge sabotage: a safety check that is not there" };
}
