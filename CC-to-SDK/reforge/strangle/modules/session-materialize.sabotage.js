// SABOTAGE wiring — `resume` MUST go red with this built.
import { materializeSessionFile } from "./session-materialize/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async materializeSessionFile() {
    return materializeSessionFile();
  },
});
