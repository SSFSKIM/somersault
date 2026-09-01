// ADAPTER — the graph-facing seam for the system prompt's block partition.
//
// Delegation signature:
//   systemPromptBlocks(blocks, options,
//                      staticPromptEnabled, boundaryMarker, billingHeaderPrefix,
//                      identityPrompts, reportingOutcomes, telemetry)
//
// FOUR of the six captures are `primitive` and are forwarded only so this
// adapter can assert them (§2.4): the boundary marker, the billing-header
// prefix, the three identity sentences and the reporting-outcomes section are
// all owned outright by the module. That is an unusually high yield for one
// splice — a prompt constant whose WORDING changes while its minified name stays
// put moves no anchor, no target hash and no capture hash, so these four
// comparisons are the only cheap thing in the whole mechanism that can see it,
// and they run on every delegation.
//
// The remaining two genuinely read state: the static-prompt gate (provider +
// two feature gates) and the telemetry sink.
import { assertGraphMembers, assertGraphValue } from "./shared/assert.js";
import { IDENTITY_PROMPTS } from "./shared/identity-prompts.js";
import {
  BILLING_HEADER_PREFIX,
  DYNAMIC_BOUNDARY_MARKER,
  REPORTING_OUTCOMES_SECTION,
  systemPromptBlocks,
} from "./system-prompt-blocks/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  systemPromptBlocks(
    blocks,
    options,
    staticPromptEnabled,
    boundaryMarker,
    billingHeaderPrefix,
    identityPrompts,
    reportingOutcomes,
    telemetry,
  ) {
    assertGraphValue("system-prompt-blocks", "boundaryMarker", boundaryMarker, DYNAMIC_BOUNDARY_MARKER);
    assertGraphValue("system-prompt-blocks", "billingHeaderPrefix", billingHeaderPrefix, BILLING_HEADER_PREFIX);
    assertGraphMembers("system-prompt-blocks", "identityPrompts", identityPrompts, IDENTITY_PROMPTS);
    assertGraphValue("system-prompt-blocks", "reportingOutcomes", reportingOutcomes, REPORTING_OUTCOMES_SECTION);
    return systemPromptBlocks(blocks, options, staticPromptEnabled, telemetry);
  },
});
