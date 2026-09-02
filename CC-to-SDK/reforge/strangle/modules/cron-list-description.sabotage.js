// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { cronListDescription } from "./cron-list-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { CRON_CREATE_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  cronListDescription(durableAvailable, cronCreateToolName) {
    assertGraphValue("cron-list-description", "cronCreateToolName", cronCreateToolName, CRON_CREATE_TOOL_NAME);
    return cronListDescription(durableAvailable);
  },
});
