// SABOTAGE LAYER (§2.5). Three scenarios must go red: every compaction in the
// corpus ends at this constructor, and its output is a transcript frame the
// differ compares field by field.
export function compactBoundary() {
  return {
    type: "system",
    subtype: "compact_boundary",
    content: "REFORGE_SABOTAGED_COMPACT_BOUNDARY",
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: "00000000-0000-4000-8000-000000000000",
    level: "info",
    compactMetadata: { trigger: "sabotage", preTokens: -1 },
  };
}
