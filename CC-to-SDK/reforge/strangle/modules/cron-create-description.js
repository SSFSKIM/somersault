// ADAPTER — the graph-facing seam for the cron create description.
//
// Delegation signature:
//   cronCreateDescription(durableAvailable, cronCreateToolName, cronDeleteToolName, monitorToolName, recurringMaxAgeDays, monitorEnabled)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { cronCreateDescription, RECURRING_MAX_AGE_DAYS } from "./cron-create-description/reference.js";
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
