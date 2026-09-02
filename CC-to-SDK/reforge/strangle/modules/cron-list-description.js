// ADAPTER — the graph-facing seam for the cron list description.
//
// Delegation signature:
//   cronListDescription(durableAvailable, cronCreateToolName)
//
// The §2.4 `primitive` captures cross only so this adapter can equality-assert
// them: an upstream constant whose VALUE moves while its minified name stays put
// moves no anchor and no footprint hash, and this is the only cheap check that
// sees it.
import { cronListDescription } from "./cron-list-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { CRON_CREATE_TOOL_NAME } from "./shared/tool-names.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  cronListDescription(durableAvailable, cronCreateToolName) {
    assertGraphValue("cron-list-description", "cronCreateToolName", cronCreateToolName, CRON_CREATE_TOOL_NAME);
    return cronListDescription(durableAvailable);
  },
});
