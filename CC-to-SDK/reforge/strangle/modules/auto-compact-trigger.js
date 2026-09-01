// ADAPTER — the graph-facing seam for the auto-compaction predicate.
//
// Delegation signature:
//   autoCompactTrigger(messages, model, autoCompactWindow, querySource,
//                      tokenOffset, agentContext,
//                      autoCompactEnabled, compactionSurfaceOpen,
//                      windowIsConfigured, contextTokens, charsPerToken,
//                      classifyContextLevel, log, effectiveWindow)
//
// TEN captures, and the split between them is the wave's boundary with the
// query loop. Two are `pure-helper` and owned outright — the recursion guard and
// the non-conversational-source set are string tests over a frozen list, so the
// module ships them and upstream's copies are never called. The other eight are
// `effectful-port`s and each is a ledger edge:
//
//   the settings + kill-switch read, the remote-surface circuit and the window
//   resolver read configuration and environment; the token estimator, its
//   per-model divisor, the threshold classifier and the effective-window
//   computation are the query loop's context accounting (C16/W13); the log is
//   the engine's debug sink.
//
// Owning the arithmetic behind them would mean owning the model registry and
// the token estimator, which is a different subsystem and a different wave. What
// this wave owns is the DECISION: which refusals, in which order, and which
// levels mean act.
import { autoCompactTrigger } from "./auto-compact-trigger/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  autoCompactTrigger(
    messages,
    model,
    autoCompactWindow,
    querySource,
    tokenOffset,
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
    return autoCompactTrigger(
      messages,
      model,
      autoCompactWindow,
      querySource,
      tokenOffset,
      agentContext,
      autoCompactEnabled,
      compactionSurfaceOpen,
      windowIsConfigured,
      contextTokens,
      charsPerToken,
      classifyContextLevel,
      log,
      effectiveWindow,
    );
  },
});
