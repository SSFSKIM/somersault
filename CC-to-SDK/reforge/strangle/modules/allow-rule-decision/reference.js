// PARITY LAYER (§2.5 `reference`) — what an ALLOW rule actually decides
// (upstream `y7e`, 2.1.251, chunk-fy12d89p).
//
// Reached only when a `permissions.allow` rule has already MATCHED the tool
// call. The naive reading of that is "so it is allowed"; upstream's answer is
// the opposite, and this function is where the difference lives: a matched allow
// rule does not end the decision, it changes the DEFAULT. The tool's own
// `checkPermissions` still runs, and it may still deny or still ask.
//
// THE FOUR OUTCOMES, in the order they are decided:
//
//   the tool DENIES        -> the deny wins outright. An allow rule cannot
//                             overrule the tool's own objection.
//   the tool ASKS          -> the ask wins, with `suggestions` STRIPPED and
//                             `matchedAskRule` set to the ALLOW rule that got us
//                             here. Both halves are deliberate: suggestions
//                             offer the user a permission update, and offering
//                             one for a rule that already matched is noise; and
//                             the field named `matchedAskRule` carries an ALLOW
//                             rule, which reads like a bug and is not — it is
//                             "the rule that forced this prompt".
//   the tool throws         -> the error classifier decides. A deny survives; a
//                             crash the classifier does not recognise becomes an
//                             ask ONLY when the caller opted into
//                             `crashIsObjection`, which is how a tool that
//                             cannot answer is prevented from silently passing.
//   anything else          -> the prepared ask, built BEFORE the try block.
//
// THE PREPARED DEFAULT IS BUILT FIRST, and it is the arm that runs when the
// tool answers `allow` or `passthrough`: an allow rule matched, the tool did not
// object, and the decision is still `ask` carrying the rule as its reason. The
// caller (`permission-precheck`) is what turns that into an allow, under mode
// arms this function knows nothing about.
//
// THE SCHEMA PARSE IS INSIDE THE TRY, so a malformed input reaches the error
// classifier rather than escaping — the same guard the rule checker uses, and
// the reason both share the classifier port.
//
// `permissionMessage` is FORWARDED rather than owned even though this wave owns
// it: the seam does not carry the four sub-ports that module needs, so the
// delegation reaches the strangled graph's copy — which is the owned module
// behind its own adapter. Ownership composes without the seam having to.

/**
 * @param tool               the tool being decided
 * @param input              its raw input
 * @param context            the permission context
 * @param matchedRule        the allow rule that matched
 * @param options            caller options; `crashIsObjection` opts into the crash arm
 * @param permissionMessage  port — the request sentence builder
 * @param classifyToolError  port — turn a thrown tool error into a decision, or rethrow
 * @param crashReason        primitive — the reason text a recognised crash carries
 */
export async function allowRuleDecision(
  tool,
  input,
  context,
  matchedRule,
  options,
  permissionMessage,
  classifyToolError,
  crashReason,
) {
  const prepared = {
    behavior: "ask",
    decisionReason: { type: "rule", rule: matchedRule },
    message: permissionMessage(tool.name),
  };
  try {
    const parsed = tool.inputSchema.parse(input);
    const decision = await tool.checkPermissions(parsed, context);
    if (decision?.behavior === "deny") return decision;
    if (decision?.behavior === "ask") {
      const { suggestions, ...rest } = decision;
      return { ...rest, matchedAskRule: matchedRule };
    }
  } catch (error) {
    const classified = classifyToolError(error, tool, input, context);
    if (classified !== undefined && classified.behavior === "deny") return classified;
    if (classified === undefined && options?.crashIsObjection === true) {
      const reason = { type: "other", reason: crashReason };
      return { behavior: "ask", message: permissionMessage(tool.name, reason), decisionReason: reason };
    }
  }
  return prepared;
}
