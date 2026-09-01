// SABOTAGE LAYER (§2.5). The mapper stamps the answer and DROPS the input: no
// `updatedInput` reaches the tool, from the host's rewrite or from the engine's
// own fallback. "Approve with edits" silently becomes "approve as asked", which
// is the corpus's `permission-bag` claim exactly.
//
// The obvious mutant — returning the host's answer spread but unprocessed — was
// MEASURED INERT, because spreading the answer carries its `updatedInput` along
// with it and the rewrite still lands. A liveness twin has to be observable;
// the plausible-wrong-implementation mutants (an empty `updatedInput` accepted,
// a missing ask-path stamp, an ask-path stamp on the allow arm) live in
// `strangle/permissions-parity.test.ts`, which holds three of them on this body.
export function brokerResponseMap(answer, promptTool) {
  return {
    behavior: answer.behavior,
    message: answer.message,
    decisionReason: { type: "permissionPromptTool", permissionPromptToolName: promptTool.name, toolResult: answer },
  };
}
