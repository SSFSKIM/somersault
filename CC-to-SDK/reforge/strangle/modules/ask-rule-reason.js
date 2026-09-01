// ADAPTER — the graph-facing seam for the ask-rule predicate.
//
// Delegation signature: isAskRuleDrivenReason(reason)
//
// `captures: []` — verified zero free variables: the body is a shape test over
// its argument and a recursive call to itself.
import { isAskRuleDrivenReason } from "./ask-rule-reason/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  isAskRuleDrivenReason(...args) {
    return isAskRuleDrivenReason(...args);
  },
});
