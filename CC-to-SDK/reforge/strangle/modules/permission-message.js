// ADAPTER — the graph-facing seam for the permission-request message builder.
//
// Delegation signature:
//   permissionMessage(toolName, reason, renderRuleValue, renderRuleSource,
//                     splitRedirections, modeTitle)
//
// `pluralize` is an OWNED capture (§2.4): the module ships it and uses it in
// both wirings, so the graph's copy is derived and footprinted but never
// forwarded and never called.
import { permissionMessage } from "./permission-message/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  permissionMessage(toolName, reason, renderRuleValue, renderRuleSource, splitRedirections, modeTitle) {
    return permissionMessage(toolName, reason, renderRuleValue, renderRuleSource, splitRedirections, modeTitle);
  },
});
