// SABOTAGE wiring — `sysprompt-preset` MUST go red with this built.
import { doingTasksSection } from "./doing-tasks-section/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  doingTasksSection() {
    return doingTasksSection();
  },
});
