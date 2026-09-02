// SABOTAGE LAYER (§2.5). `sysprompt-preset` MUST go red with this built: the
// section is rendered into the `system` array of every preset request, so a
// dropped heading is a byte difference on the requests surface.
export function executingActionsSection() {
  return "# Executing actions with care";
}
