// SABOTAGE wiring — `hooks-cwd-change` MUST go red with this built.
import { cwdChangedHooks } from "./cwd-changed-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  cwdChangedHooks() {
    return cwdChangedHooks();
  },
});
