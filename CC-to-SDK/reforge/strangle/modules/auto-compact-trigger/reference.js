// PARITY LAYER (§2.5 `reference`) — the predicate that decides a conversation
// must be compacted (upstream `nKn`, 2.1.251, chunk-fy12d89p).
//
// The main query loop asks this before every turn. It is the POLICY half of
// compaction; the DRIVER that acts on a `true` — the async generator that routes
// through the reactive path, runs the hooks and calls the summarizer — is the
// query loop's (C16/W13), and is deliberately not this wave's. Owning the policy
// without the driver is the point: the policy is 270 minified characters of
// decision, the driver is a loop.
//
// FOUR REFUSALS THEN A MEASUREMENT. The refusals are ordered and each is its own
// early return, so the measurement below them runs only when all four pass:
//
//   1. the query source IS a compaction. Compaction must not recurse.
//   2. the query source is one whose output is not conversational — a prompt
//      suggestion, a summary, a narration. Those runs are short by construction
//      and compacting them would rewrite a context their caller owns.
//   3. auto-compaction is switched off (a setting, plus two kill-switch env
//      vars). Every corpus scenario leaves it on.
//   4. the surface is open BUT the model's context window is not configured. The
//      second half is the one that surprises: the window's SOURCE has to be
//      something other than "auto" — a settings value, an env override, a
//      client-data window or the model's own compiled-in default. MEASURED for
//      the corpus's model: the source is `model-default`, so this passes.
//
// Then: measure the context, classify it against the threshold, log the decision,
// and return true for the two levels that mean "act" — `compact` and `blocked`.
// `blocked` is included on purpose: past the blocking limit the engine cannot
// proceed at all, so compaction is the only way forward, and an implementation
// that treated `blocked` as "too late" would deadlock the session.
//
// THE OFFSET IS SUBTRACTED FROM THE MEASUREMENT, NOT THE THRESHOLD. Upstream
// computes `contextTokens(...) - tokenOffset` and passes the RESULT to the
// classifier, so the offset also moves the `blocked` comparison. Subtracting it
// on the other side would be arithmetically similar and behaviourally different.
//
// THE LOG LINE IS NOT DECORATION, and it is the reason `effectiveWindow` is a
// port rather than a computed local: upstream evaluates it EAGERLY, inside the
// template literal, on every call — so it runs even when the decision would not
// need it, and an implementation that made it lazy would drop a call the
// oracle makes. It is also, in practice, the only externally visible trace this
// predicate leaves: it is what proved the trigger reachable headlessly at all.

/** Upstream `FD`. A compaction's own query source; the recursion guard. */
export function isCompactQuerySource(querySource) {
  if (querySource === "compact") return true;
  return false;
}

/** Upstream `AZt` — query sources whose output is not the conversation. */
export const NON_CONVERSATIONAL_QUERY_SOURCES = ["prompt_suggestion", "away_summary", "agent_summary", "narration"];

const NON_CONVERSATIONAL = new Set(NON_CONVERSATIONAL_QUERY_SOURCES);

/** Upstream `tC`. `undefined` is NOT suppressed — an unnamed source is a real turn. */
export function isSuppressedQuerySource(querySource) {
  return querySource !== undefined && NON_CONVERSATIONAL.has(querySource);
}

/**
 * @param messages            the conversation so far
 * @param model               the main-loop model
 * @param autoCompactWindow   the configured window, or undefined
 * @param querySource         who is driving this turn ("sdk" on the headless seam)
 * @param tokenOffset         tokens already accounted for elsewhere; defaults to 0 upstream
 * @param agentContext        upstream's sixth parameter, unused by the body — forwarded verbatim
 * @param autoCompactEnabled  () -> boolean                       setting + kill switches (port)
 * @param compactionSurfaceOpen () -> boolean                     remote-surface circuit (port)
 * @param windowIsConfigured  (model, window) -> boolean          window source !== "auto" (port)
 * @param contextTokens       (messages, charsPerToken) -> number last usage + estimate (port)
 * @param charsPerToken       (model) -> number                   the estimator's divisor (port)
 * @param classifyContextLevel (tokens, model, window) -> { level } threshold policy (port)
 * @param log                 (line) -> void                      the engine's debug log (port)
 * @param effectiveWindow     (model, window) -> number           window minus max output (port)
 */
export async function autoCompactTrigger(
  messages,
  model,
  autoCompactWindow,
  querySource,
  tokenOffset = 0,
  agentContext,
  autoCompactEnabled,
  compactionSurfaceOpen,
  windowIsConfigured,
  contextTokens,
  charsPerToken,
  classifyContextLevel,
  log,
  effectiveWindow,
) {
  void agentContext;
  if (isCompactQuerySource(querySource)) return false;
  if (isSuppressedQuerySource(querySource)) return false;
  if (!autoCompactEnabled()) return false;
  if (compactionSurfaceOpen() && !windowIsConfigured(model, autoCompactWindow)) return false;

  const tokens = contextTokens(messages, charsPerToken(model)) - tokenOffset;
  const classified = classifyContextLevel(tokens, model, autoCompactWindow);
  log(`autocompact: tokens=${tokens} level=${classified.level} effectiveWindow=${effectiveWindow(model, autoCompactWindow)}`);
  return classified.level === "compact" || classified.level === "blocked";
}
