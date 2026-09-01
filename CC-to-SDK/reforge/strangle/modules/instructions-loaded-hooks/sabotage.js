// SABOTAGE LAYER (§2.5). The memory-load recording MUST go red with this built:
// a CLAUDE.md in the sandbox loads as Project memory and `Qqe` dispatches once
// for it, so the consult is on the transcript — and a dispatcher that never asks
// the executor for anything leaves an events transcript the oracle's does not
// have.
//
// The condition needs a filesystem setting source open (`settingSources: []`,
// the corpus default, turns memory loading off), which is the one thing about
// this row a recording has to arrange rather than provoke.
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function instructionsLoadedHooks() {
  // as if the file had loaded with no hooks to run
}
