// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { remoteTriggerDescription } from "./remote-trigger-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  remoteTriggerDescription() {
    return remoteTriggerDescription();
  },
});
