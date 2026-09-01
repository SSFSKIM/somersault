// SABOTAGE wiring — the compaction recording MUST go red with this built.
import { postCompactHooks } from "./post-compact-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  postCompactHooks() {
    return postCompactHooks();
  },
});
