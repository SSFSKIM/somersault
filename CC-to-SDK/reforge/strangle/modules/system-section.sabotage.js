// SABOTAGE wiring — `sysprompt-preset` MUST go red with this built.
import { systemSection } from "./system-section/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  systemSection() {
    return systemSection();
  },
});
