// SABOTAGE wiring — `sysprompt-preset` MUST go red with this built.
import { toneAndStyleSection } from "./tone-and-style-section/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  toneAndStyleSection() {
    return toneAndStyleSection();
  },
});
