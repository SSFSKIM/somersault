// SABOTAGE LAYER (§2.5) — one twin per RETAINED EXPORT, not one per chunk.
//
// §2.2 prices S-chunk at "behavioral coverage + sabotage evidence for every
// retained export, not just the headline function", so the build wires exports
// one at a time: `--sabotage glob-description:globDescription` takes only that
// binding from this file and leaves the other two on `reference.js`. A single
// all-three twin would pass as long as ANY export is live — the same vacuous
// shape the gate's per-splice loop exists to refuse.
//
// Each twin keeps the SHAPE (a string of the right kind, a function of the right
// arity) and corrupts only the content, so a red comes from the differential
// surfaces rather than from a crash.
export const GLOB_TOOL_NAME = "ReforgeSabotagedGlob";
export const REPL_TOOL_NAME = "ReforgeSabotagedRepl";

export function globDescription(model, leanPrompt, subagentSteer) {
  leanPrompt(model);
  return "REFORGE_SABOTAGED_GLOB_DESCRIPTION";
}
