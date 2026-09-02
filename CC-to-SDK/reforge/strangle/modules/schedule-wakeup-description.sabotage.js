// SABOTAGE wiring — the covering scenario MUST go red with this built.
import { scheduleWakeupDescription, SCHEDULE_WAKEUP_PREAMBLE } from "./schedule-wakeup-description/sabotage.js";
import { assertGraphValue } from "./shared/assert.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  scheduleWakeupDescription(oneHourCacheTtl, scheduleWakeupPreamble) {
    assertGraphValue("schedule-wakeup-description", "scheduleWakeupPreamble", scheduleWakeupPreamble, SCHEDULE_WAKEUP_PREAMBLE);
    return scheduleWakeupDescription(oneHourCacheTtl);
  },
});
