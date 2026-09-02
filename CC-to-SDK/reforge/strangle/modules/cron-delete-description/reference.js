// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// Both arms are one sentence apart — the durable arm names the on-disk store,
// the session-only arm names the in-memory one — which is why the anchor is the
// path fragment rather than the opening clause: the opening clause occurs TWICE
// inside this one function, once per arm, and an anchor that matches twice is a
// coin flip the resolver refuses.
import { CRON_CREATE_TOOL_NAME } from "../shared/tool-names.js";

export function cronDeleteDescription(durableAvailable) {return durableAvailable?`Cancel a cron job previously scheduled with ${CRON_CREATE_TOOL_NAME}. Removes it from .claude/scheduled_tasks.json (durable jobs) or the in-memory session store (session-only jobs).`:`Cancel a cron job previously scheduled with ${CRON_CREATE_TOOL_NAME}. Removes it from the in-memory session store.`}
