// SABOTAGE wiring — installs the twin. `edit-tool` MUST go red with this built.
import { editToolResultBlock } from "./edit-tool-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  editToolResultBlock(output, toolUseId) {
    return editToolResultBlock(output, toolUseId);
  },
});
