// SABOTAGE LAYER (§2.5). `hooks` MUST go red with this built: the scenario
// registers a PreToolUse callback around a Bash call and the harness records
// every consult, so a dispatcher that yields nothing leaves an events transcript
// the oracle's does not have.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function* preToolHooks() {
  // neither path taken: no chain, no settings execution, no record built
}
