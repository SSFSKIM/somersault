// SABOTAGE wiring — `search-tools` MUST go red with this built.
import { globResultBlock } from "./glob-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  globResultBlock(output, toolUseId) {
    return globResultBlock(output, toolUseId);
  },
});
