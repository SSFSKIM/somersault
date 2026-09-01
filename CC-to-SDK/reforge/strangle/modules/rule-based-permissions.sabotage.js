// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { checkRuleBasedPermissions } from "./rule-based-permissions/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  checkRuleBasedPermissions(...args) {
    return checkRuleBasedPermissions(...args);
  },
});
