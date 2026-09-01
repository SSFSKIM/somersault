// SABOTAGE LAYER (§2.5). `plain` and `api-error` MUST go red with this built —
// one per `leanPrompt` arm, which is why both are in the row's coverage.
//
// Shape preserved, content destroyed: the ports are still called so the red comes
// from the differential surfaces rather than from a crash.
export function readDescription(model, lineNumbering, maxSizeClause, offsetLimitNote, leanPrompt, pdfCapable) {
  leanPrompt(model);
  pdfCapable();
  return "REFORGE_SABOTAGED_READ_DESCRIPTION";
}
