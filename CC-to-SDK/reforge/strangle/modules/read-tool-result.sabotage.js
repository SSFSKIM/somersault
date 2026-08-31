// SABOTAGE wiring — `file-tools` MUST go red with this built.
import { readToolResultBlock } from "./read-tool-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  readToolResultBlock(result, toolUseId) {
    return readToolResultBlock(result, toolUseId);
  },
});
