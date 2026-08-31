// SABOTAGE wiring — `search-tools` MUST go red with this built.
import { grepToolResultBlock } from "./grep-tool-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  grepToolResultBlock(output, toolUseId) {
    return grepToolResultBlock(output, toolUseId);
  },
});
