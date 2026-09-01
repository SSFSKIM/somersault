// ADAPTER — the graph-facing seam for the permission chain's deny-stamping link.
//
// Delegation signature:
//   permissionDecisionWithSink(tool, input, context, assistantMessage,
//                              toolUseId, precheckArg, sink, decide)
//
// `decide` is upstream's mode-aware decision body (`von`) — a typed port and a
// ledger edge to W6, which owns it.
import { permissionDecisionWithSink } from "./permission-decision/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionDecisionWithSink(tool, input, context, assistantMessage, toolUseId, precheckArg, sink, decide) {
    return permissionDecisionWithSink(tool, input, context, assistantMessage, toolUseId, precheckArg, sink, decide);
  },
});
