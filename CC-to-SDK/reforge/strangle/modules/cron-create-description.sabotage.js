// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { cronCreateDescription, RECURRING_MAX_AGE_DAYS } from "./cron-create-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";
import { CRON_CREATE_TOOL_NAME, CRON_DELETE_TOOL_NAME, MONITOR_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  cronCreateDescription(durableAvailable, cronCreateToolName, cronDeleteToolName, monitorToolName, recurringMaxAgeDays, monitorEnabled) {
    assertGraphValue("cron-create-description", "cronCreateToolName", cronCreateToolName, CRON_CREATE_TOOL_NAME);
    assertGraphValue("cron-create-description", "cronDeleteToolName", cronDeleteToolName, CRON_DELETE_TOOL_NAME);
    assertGraphValue("cron-create-description", "monitorToolName", monitorToolName, MONITOR_TOOL_NAME);
    assertGraphValue("cron-create-description", "recurringMaxAgeDays", recurringMaxAgeDays, RECURRING_MAX_AGE_DAYS);
    return cronCreateDescription(durableAvailable, monitorEnabled);
  },
});
