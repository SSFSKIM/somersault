// SABOTAGE LAYER (§2.5). Every compacting scenario must go red: this is the user
// message the transcript carries after the boundary, and in the two continuation
// scenarios it is also the first user block of the following request body.
export function compactSummaryText() {
  return "REFORGE_SABOTAGED_COMPACT_SUMMARY_TEXT";
}

export function compactContinuation() {
  return "REFORGE_SABOTAGED_COMPACT_CONTINUATION";
}
