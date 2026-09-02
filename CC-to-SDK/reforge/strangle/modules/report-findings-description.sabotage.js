// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { reportFindingsDescription } from "./report-findings-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  reportFindingsDescription() {
    return reportFindingsDescription();
  },
});
