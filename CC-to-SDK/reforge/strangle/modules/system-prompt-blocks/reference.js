// PARITY LAYER (§2.5 `reference`) — the system prompt's block partition and its
// cache scoping (upstream `tOe`, 2.1.251, chunk-fy12d89p).
//
// THIS IS THE ONE FUNCTION EVERY REQUEST'S `system` ARRAY COMES OUT OF. It takes
// the flat list of prompt strings the assembler produced and turns it into
// scoped blocks: which text ends up in which block, in what order, and which
// prompt-cache scope each block carries. The wire shaping — `type: "text"` and
// `cache_control` — belongs to `system-prompt-wire`, which calls this.
//
// ## The partition
//
// Four kinds of block are recognised, by VALUE rather than by position, which is
// why the three constants below are the module's own:
//
//   billing    the one block starting with the billing-header prefix
//   identity   whichever of the three identity sentences the selector chose
//   outcomes   the "# Reporting outcomes" section, when the provider serves it
//   the rest   everything else, joined with a blank line into one block
//
// The boundary MARKER is not a block: it is a position sentinel the caller may
// splice into the list (the SDK exports it as `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`),
// and it is dropped from the output on every path.
//
// ## The three paths, and what decides between them
//
// `staticPromptEnabled()` is a provider-and-gate read (`firstParty`/`anthropicAws`
// plus two gates). It is FALSE under reforge's pinned gate environment (§3.3),
// measured: `sysprompt-preset` renders the preset's full section list and the
// request carries no boundary marker, which is only possible when the section
// builder's `staticPromptEnabled() ? [marker] : []` took the empty arm. So the
// corpus reaches the third path only, and the first two are graded by
// `strangle/prompt-parity.test.ts` against the pinned upstream body instead.
//
//   1. static enabled, caller asked to skip the global cache, no marker
//      → billing null, identity "org", outcomes null, rest "org"
//   2. static enabled, marker present
//      → billing null, identity NULL, outcomes null,
//        everything BEFORE the marker "global", everything after "org"
//   3. otherwise (and after a "missing boundary marker" telemetry note)
//      → billing null, identity "org", outcomes null, rest "org"
//
// Path 2 is the only one that gives the identity block a `null` scope and the
// only one that mints a "global" scope; paths 1 and 3 differ only in their
// telemetry. `null` means "no cache_control on this block" downstream.
//
// ## Ordering is a contract
//
// The output is always billing, identity, outcomes, rest — the ORDER OF THE
// PUSHES, not the order the blocks arrived in — and the outcomes block is
// emitted only when billing AND identity are both present. A partition that
// preserved arrival order would produce a different prompt and a different cache
// prefix, so the pushes below are deliberately in upstream's order.
import { IDENTITY_PROMPT_SET } from "../shared/identity-prompts.js";

/** Upstream `wO`, and the SDK's public `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`. */
export const DYNAMIC_BOUNDARY_MARKER = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

/** Upstream `tL`. The billing block is identified by this prefix, not by position. */
export const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";

/** Upstream `aE` — the "# Reporting outcomes" section, recognised by identity. */
export const REPORTING_OUTCOMES_SECTION = `# Reporting outcomes

Report what actually happened, not what you intended. When you say something is done, sent, saved, fixed, or verified, that claim must rest on a result you observed in this session — tool output, the file as it now reads, the page as it now loads — not on what the step should have produced. If you did not check, say you did not check. If any step failed, was skipped, or came back different from what you expected, say so in the first sentence of your report, before anything else, even when the rest of the work succeeded. Never quietly work around a failure in a way that makes it look resolved; a problem the user can see is recoverable, one your summary hides is not. When you stop before the task is complete, your first line says so plainly and names what is left. Do not describe partial work as done, and do not let a summary read as more certain than the evidence behind it.`;

/** Blocks are joined into one with a blank line between them. */
const JOIN = "\n\n";

/**
 * Split the prompt list into its four recognised kinds.
 *
 * `boundaryAt < 0` means "no split": everything unrecognised goes to `rest` and
 * `dynamic` stays empty. Otherwise the index decides which side of the marker a
 * block falls on, which is what makes the prefix before it globally cacheable.
 */
function partition(blocks, boundaryAt, identityPrompts) {
  const out = { billing: undefined, identity: undefined, outcomes: undefined, rest: [], dynamic: [] };
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block || block === DYNAMIC_BOUNDARY_MARKER) continue;
    if (block.startsWith(BILLING_HEADER_PREFIX)) out.billing = block;
    else if (identityPrompts.has(block)) out.identity = block;
    else if (block === REPORTING_OUTCOMES_SECTION) out.outcomes = block;
    else if (boundaryAt < 0 || i < boundaryAt) out.rest.push(block);
    else out.dynamic.push(block);
  }
  return out;
}

/** Upstream pushes the three singletons in this order, and skips absent ones. */
function head(parts, identityScope) {
  const blocks = [];
  if (parts.billing) blocks.push({ text: parts.billing, cacheScope: null });
  if (parts.identity) blocks.push({ text: parts.identity, cacheScope: identityScope });
  // Deliberately conditional on the other two: an outcomes section with no
  // billing header or no identity line is not emitted at all.
  if (parts.outcomes && parts.billing && parts.identity) blocks.push({ text: parts.outcomes, cacheScope: null });
  return blocks;
}

/**
 * @param blocks              the flat prompt list, marker and falsy entries included
 * @param options             `{ skipGlobalCacheForSystemPrompt }`, or undefined
 * @param staticPromptEnabled () -> boolean   provider + gate read (port)
 * @param telemetry           (event, payload) -> void  (port)
 */
export function systemPromptBlocks(blocks, options, staticPromptEnabled, telemetry) {
  const staticEnabled = staticPromptEnabled();
  const boundaryAt = blocks.findIndex((block) => block === DYNAMIC_BOUNDARY_MARKER);

  // Path 1 — tool-based caching: the caller is opting out of the global scope,
  // so nothing is globally scoped and the marker is known to be absent.
  if (staticEnabled && options?.skipGlobalCacheForSystemPrompt && boundaryAt === -1) {
    telemetry("tengu_sysprompt_using_tool_based_cache", { promptBlockCount: blocks.length });
    const parts = partition(blocks, -1, IDENTITY_PROMPT_SET);
    const out = head(parts, "org");
    const rest = parts.rest.join(JOIN);
    if (rest) out.push({ text: rest, cacheScope: "org" });
    return out;
  }

  if (staticEnabled) {
    // Path 2 — the caller marked a static/dynamic split, so the prefix ahead of
    // the marker gets the cross-session "global" scope. The identity line joins
    // that prefix uncached rather than taking "org", which is the one place the
    // three paths disagree about a block other than the rest.
    if (boundaryAt !== -1) {
      const parts = partition(blocks, boundaryAt, IDENTITY_PROMPT_SET);
      const out = head(parts, null);
      const staticText = parts.rest.join(JOIN);
      if (staticText) out.push({ text: staticText, cacheScope: "global" });
      const dynamicText = parts.dynamic.join(JOIN);
      if (dynamicText) out.push({ text: dynamicText, cacheScope: "org" });
      telemetry("tengu_sysprompt_boundary_found", {
        blockCount: out.length,
        staticBlockLength: staticText.length,
        dynamicBlockLength: dynamicText.length,
      });
      return out;
    }
    telemetry("tengu_sysprompt_missing_boundary_marker", { promptBlockCount: blocks.length });
  }

  // Path 3 — the default, and the only one the corpus reaches.
  const parts = partition(blocks, -1, IDENTITY_PROMPT_SET);
  const out = head(parts, "org");
  const rest = parts.rest.join(JOIN);
  if (rest) out.push({ text: rest, cacheScope: "org" });
  return out;
}
