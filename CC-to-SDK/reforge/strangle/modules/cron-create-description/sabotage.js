// SABOTAGE LAYER (§2.5). `plain` MUST go red with this built: CronCreate's
// description is in all 82 recorded cassettes, so a replaced body is a byte
// difference in the request the differential compares.
export function cronCreateDescription(durableAvailable, monitorEnabled) {
  return "[sabotaged cron-create-description]";
}
