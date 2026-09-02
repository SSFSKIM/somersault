// ADAPTER — the graph-facing seam for the schedule wakeup description.
//
// Delegation signature:
//   scheduleWakeupDescription(oneHourCacheTtl, scheduleWakeupPreamble)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { scheduleWakeupDescription, SCHEDULE_WAKEUP_PREAMBLE } from "./schedule-wakeup-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  scheduleWakeupDescription(oneHourCacheTtl, scheduleWakeupPreamble) {
    assertGraphValue("schedule-wakeup-description", "scheduleWakeupPreamble", scheduleWakeupPreamble, SCHEDULE_WAKEUP_PREAMBLE);
    return scheduleWakeupDescription(oneHourCacheTtl);
  },
});
