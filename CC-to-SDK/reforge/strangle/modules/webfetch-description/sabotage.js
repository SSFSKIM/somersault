// SABOTAGE LAYER (§2.5). `plain` (full arm) and `api-error` (lean arm) MUST both
// go red with this built.
export function webFetchDescription(model, artifactException, leanPrompt, cacheTtlPhrase) {
  leanPrompt(model);
  cacheTtlPhrase();
  return "REFORGE_SABOTAGED_WEBFETCH_DESCRIPTION";
}
