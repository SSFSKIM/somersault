// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// The smallest description in the catalog (106 rendered bytes) and the one whose
// two arms differ by six words. Same anchor argument as its sibling: the shared
// opening clause occurs once per arm, so the anchor is taken from the durable
// arm's tail.
import { CRON_CREATE_TOOL_NAME } from "../shared/tool-names.js";

export function cronListDescription(durableAvailable) {return durableAvailable?`List all cron jobs scheduled via ${CRON_CREATE_TOOL_NAME}, both durable (.claude/scheduled_tasks.json) and session-only.`:`List all cron jobs scheduled via ${CRON_CREATE_TOOL_NAME} in this session.`}
