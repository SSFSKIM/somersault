// SABOTAGE wiring — `sysprompt-preset` MUST go red with this built.
import { executingActionsSection } from "./executing-actions-section/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  executingActionsSection() {
    return executingActionsSection();
  },
});
