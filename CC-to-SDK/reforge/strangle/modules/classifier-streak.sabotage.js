// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { classifierOnlyStreakActive } from "./classifier-streak/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  classifierOnlyStreakActive(...args) {
    return classifierOnlyStreakActive(...args);
  },
});
