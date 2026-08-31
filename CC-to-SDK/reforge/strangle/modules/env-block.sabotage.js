// SABOTAGE wiring — `subagent` MUST go red with this built.
import { envBlock } from "./env-block/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async envBlock() {
    return envBlock();
  },
});
