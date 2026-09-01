// ADAPTER — the graph-facing seam for the `compact_boundary` constructor.
//
// Delegation signature:
//   compactBoundary(trigger, preTokens, logicalParentUuid, userContext,
//                   messagesSummarized, uuid)
//
// One capture, and it is a port for the reason ports exist: upstream imports
// `randomUUID` from node's `crypto` and calls it here, so the value is fresh per
// call and belongs to the runtime rather than to the graph. Owning it would mean
// owning identity minting, which is the session subsystem's (C12) — recorded as
// a ledger edge rather than folded away.
import { compactBoundary } from "./compact-boundary/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  compactBoundary(trigger, preTokens, logicalParentUuid, userContext, messagesSummarized, uuid) {
    return compactBoundary(trigger, preTokens, logicalParentUuid, userContext, messagesSummarized, uuid);
  },
});
