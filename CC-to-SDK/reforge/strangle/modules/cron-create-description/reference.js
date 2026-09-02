// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// CronCreate's is the largest of the four the cron chunk owns, and the only one
// in the belt with a branch NO SCENARIO RENDERS: `monitorEnabled` is
// `RI() = I("tengu_amber_sentinel", false)`, the Monitor gate, whose compiled-in
// default is false and which has no per-gate env override in the committed gate
// fixture. So the "## Not for live watching" paragraph — the one place in the
// whole catalog where one tool's description points at Monitor — is unreachable
// through the corpus and is graded by strangle/moat-parity.test.ts instead.
//
// The other parameter is upstream's own: durable scheduling on or off, which
// swaps the "## Durability" section for "## Session-only" and adds a sentence to
// the runtime paragraph. Both arms are graded the same way.
import { CRON_CREATE_TOOL_NAME, CRON_DELETE_TOOL_NAME, MONITOR_TOOL_NAME } from "../shared/tool-names.js";

/**
 * Upstream `NX = AM.recurringMaxAgeMs / 86400000` — 604,800,000 ms over a day in
 * ms, i.e. SEVEN. Owned as the number the prose says rather than as the
 * division, because the prose is what has to stay in step; the adapter
 * equality-asserts the graph's copy on every delegation.
 */
export const RECURRING_MAX_AGE_DAYS = 7;

export function cronCreateDescription(durableAvailable, monitorEnabled) {let o=durableAvailable?`## Durability

By default (durable: false) the job lives only in this Claude session \u2014 nothing is written to disk, and the job is gone when Claude exits. Pass durable: true to write to .claude/scheduled_tasks.json so the job survives restarts. Only use durable: true when the user explicitly asks for the task to persist ("keep doing this every day", "set this up permanently"). Most "remind me in 5 minutes" / "check back in an hour" requests should stay session-only.`:`## Session-only

Jobs live only in this Claude session \u2014 nothing is written to disk, and the job is gone when Claude exits.`,s=durableAvailable?"Durable jobs persist to .claude/scheduled_tasks.json and survive session restarts \u2014 on next launch they resume automatically. One-shot durable tasks that were missed while the REPL was closed are surfaced for catch-up. Session-only jobs die with the process. ":"";return`Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week. "0 9 * * *" means 9am local \u2014 no timezone conversion needed.

## One-shot tasks (recurring: false)

For "remind me at X" or "at <time>, do Y" requests \u2014 fire once then auto-delete.
Pin minute/hour/day-of-month/month to specific values:
  "remind me at 2:30pm today to check the deploy" \u2192 cron: "30 14 <today_dom> <today_month> *", recurring: false
  "tomorrow morning, run the smoke test" \u2192 cron: "57 8 <tomorrow_dom> <tomorrow_month> *", recurring: false

## Recurring jobs (recurring: true, the default)

For "every N minutes" / "every hour" / "weekdays at 9am" requests:
  "*/5 * * * *" (every 5 min), "0 * * * *" (hourly), "0 9 * * 1-5" (weekdays at 9am local)

## Avoid the :00 and :30 minute marks when the task allows it

Every user who asks for "9am" gets \`0 9\`, and every user who asks for "hourly" gets \`0 *\` \u2014 which means requests from across the planet land on the API at the same instant. When the user's request is approximate, pick a minute that is NOT 0 or 30:
  "every morning around 9" \u2192 "57 8 * * *" or "3 9 * * *" (not "0 9 * * *")
  "hourly" \u2192 "7 * * * *" (not "0 * * * *")
  "in an hour or so, remind me to..." \u2192 pick whatever minute you land on, don't round

Only use minute 0 or 30 when the user names that exact time and clearly means it ("at 9:00 sharp", "at half past", coordinating with a meeting). When in doubt, nudge a few minutes early or late \u2014 the user will not notice, and the fleet will.

${o}
${monitorEnabled()?`
## Not for live watching

${CRON_CREATE_TOOL_NAME} re-runs a prompt at fixed wall-clock intervals. To watch a log file, process, or command output and be notified the moment something changes, use the ${MONITOR_TOOL_NAME} tool instead \u2014 ${MONITOR_TOOL_NAME} streams events as they happen; cron polls on a schedule.
`:""}
## Runtime behavior

Jobs only fire while the REPL is idle (not mid-query). ${s}The scheduler adds a small deterministic jitter on top of whatever you pick: recurring tasks fire up to 10% of their period late (max 15 min); one-shot tasks landing on :00 or :30 fire up to 90 s early. Picking an off-minute is still the bigger lever.

Recurring tasks auto-expire after ${RECURRING_MAX_AGE_DAYS} days \u2014 they fire one final time, then are deleted. This bounds session lifetime. Tell the user about the ${RECURRING_MAX_AGE_DAYS}-day limit when scheduling recurring jobs.

Returns a job ID you can pass to ${CRON_DELETE_TOOL_NAME}.`}
