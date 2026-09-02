// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { cronDeleteDescription } from "./cron-delete-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { CRON_CREATE_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  cronDeleteDescription(durableAvailable, cronCreateToolName) {
    assertGraphValue("cron-delete-description", "cronCreateToolName", cronCreateToolName, CRON_CREATE_TOOL_NAME);
    return cronDeleteDescription(durableAvailable);
  },
});
