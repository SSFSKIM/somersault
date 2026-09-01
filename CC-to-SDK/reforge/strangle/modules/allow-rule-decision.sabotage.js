// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { allowRuleDecision } from "./allow-rule-decision/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  allowRuleDecision(...args) {
    return allowRuleDecision(...args);
  },
});
