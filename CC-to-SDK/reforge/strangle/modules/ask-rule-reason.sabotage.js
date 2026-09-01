// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { isAskRuleDrivenReason } from "./ask-rule-reason/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  isAskRuleDrivenReason(...args) {
    return isAskRuleDrivenReason(...args);
  },
});
