// SABOTAGE wiring — `hooks-file-watch` MUST go red with this built.
import { fileChangedHooks } from "./file-changed-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  fileChangedHooks() {
    return fileChangedHooks();
  },
});
