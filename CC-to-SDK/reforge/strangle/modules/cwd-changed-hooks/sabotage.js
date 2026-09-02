// SABOTAGE LAYER (§2.5). `hooks-cwd-change` MUST go red with this built: the
// scenario registers a CwdChanged callback alongside the settings-layer matcher
// that arms the notifier, and the harness records every consult — so a
// dispatcher that never reaches the watcher helper collects `fired: false` and
// leaves an events transcript the oracle's does not have.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export function cwdChangedHooks() {
  // no record, no helper call: the cwd-changed hooks never run
  return Promise.resolve({ results: [], watchPaths: [], systemMessages: [] });
}
