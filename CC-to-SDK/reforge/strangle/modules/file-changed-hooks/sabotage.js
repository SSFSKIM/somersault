// SABOTAGE LAYER (§2.5). `hooks-file-watch` MUST go red with this built: the
// scenario registers a FileChanged callback with a matcher over the sandbox and
// the harness records every consult, so a dispatcher that never reaches the
// watcher helper leaves an events transcript the oracle's does not have.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export function fileChangedHooks() {
  // no record, no helper call: the file-changed hooks never run
  return Promise.resolve({ results: [], watchPaths: [], systemMessages: [] });
}
