// SABOTAGE wiring — installs the twin. `file-tools` MUST go red with this built.
import { writeToolResultBlock } from "./write-tool-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  writeToolResultBlock(output, toolUseId) {
    return writeToolResultBlock(output, toolUseId);
  },
});
