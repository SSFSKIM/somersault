// PARITY LAYER (§2.5 `reference`) — the whole of upstream `chunk-y30v0ja7.js`.
//
// This is the campaign's first S-CHUNK (§2.2): not a function excised out of a
// chunk, but the chunk itself replaced by a reforge-authored module exporting the
// same surface. The scout's inventory is what made that safe
// (reforge/research/2026-08-31-w2-schunk-scout.md §1): three exports, no top-level
// side effects, no live bindings, no re-exports — and the build re-derives every
// one of those facts per run rather than trusting the scout (strangle/chunk.ts).
//
// The chunk is a grab-bag: two tool-name constants that thirteen chunks read, and
// the Glob tool's description function that exactly one chunk reads. All three are
// owned here.
//
// ## The two ports, and why they stay ports
//
// `globDescription` takes the graph's lean-prompt policy and subagent-steer
// resolver as arguments. Neither is ownable at W2: `leanPrompt` reaches an env
// override, a feature gate, clientData and a model-family test, memoized per host;
// `subagentSteer` LATCHES on its first call and emits telemetry when it returns
// something other than "default". Both are §2.4 `effectful-port` — declared ledger
// edges to the waves that own prompt policy and subagent dispatch.
//
// The latch is why the call ORDER below is load-bearing and not incidental:
// upstream consults `leanPrompt` first and only calls `subagentSteer` when the
// lean branch was not taken. Calling the steer resolver at module load, or ahead
// of the lean test, would latch a value at a different moment in the session and
// could hand a later reader a different answer.
import { AGENT_TOOL_NAME, GLOB_TOOL_NAME, REPL_TOOL_NAME } from "../shared/tool-names.js";

export { GLOB_TOOL_NAME, REPL_TOOL_NAME };

/** Upstream `t`: the four-bullet list, the description's common core. */
const BULLETS = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns`;

/**
 * Upstream `o`: the same list plus the nudge toward the subagent tool. Built at
 * module load upstream too — `AGENT_TOOL_NAME` is a frozen string, so the moment
 * of interpolation cannot observe anything.
 */
const BULLETS_WITH_AGENT = `${BULLETS}
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the ${AGENT_TOOL_NAME} tool instead (if available)`;

/** The one-paragraph form, used when the session is on a lean-prompt model. */
const LEAN =
  'Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.';

/**
 * Upstream `O_n`. Called two ways by the Glob tool object: `description()` passes
 * no model at all, and `prompt({model})` — the one that fills
 * `requestBody.tools[].description` — passes the session's.
 *
 * @param model         the session model id, or undefined
 * @param leanPrompt    port: is this model on the lean system prompt?
 * @param subagentSteer port: "default" | "no_nudges" | "counter_steer" (latches)
 */
export function globDescription(model, leanPrompt, subagentSteer) {
  if (leanPrompt(model)) return LEAN;
  return subagentSteer() === "default" ? BULLETS_WITH_AGENT : BULLETS;
}
