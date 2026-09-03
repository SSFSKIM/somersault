// SABOTAGE wiring — the covering signal scenarios MUST go red with this built.
import { twnIsShuttingDown } from "./twn-is-shutting-down/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  twnIsShuttingDown(self) {
    return twnIsShuttingDown(self);
  },
});
