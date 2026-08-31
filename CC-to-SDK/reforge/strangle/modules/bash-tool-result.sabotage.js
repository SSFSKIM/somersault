// SABOTAGE wiring — `bash-tool`, `hooks`, `partial-tool-args` and
// `parallel-tools` MUST all go red with this built.
import { bashToolResultBlock } from "./bash-tool-result/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  bashToolResultBlock(output, toolUseId) {
    return bashToolResultBlock(output, toolUseId);
  },
});
