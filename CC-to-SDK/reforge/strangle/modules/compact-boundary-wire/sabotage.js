// SABOTAGE LAYER (§2.5). Every compacting scenario must go red: this object IS
// the `compact_metadata` the SDK emits, and three substance checks read
// `pre_tokens` out of it.
export function compactBoundaryWire() {
  return { trigger: "sabotage", pre_tokens: -1 };
}
