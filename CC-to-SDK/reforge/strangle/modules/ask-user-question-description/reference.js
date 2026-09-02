// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// Plan-mode catalog only (51 of 82 recorded cassettes), so `perm-plan-mode` covers it.
//
// This is the constant the tool's `prompt({model})` opens with; the method then
// appends two gate-driven strings that no corpus run produces. Owning the
// constant owns the 842 bytes every plan-mode request actually carries and
// leaves the two gated tails to C11b's reachability probe, which is the right
// split — a splice that swallowed the method would claim arms nothing grades.
import { ENTER_PLAN_MODE_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from "../shared/tool-names.js";

export function askUserQuestionDescription() {
  return `Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: To switch into plan mode, use ${ENTER_PLAN_MODE_TOOL_NAME} (not this tool). Once in plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?", "Should I proceed?", or otherwise reference "the plan" in questions \u2014 the user cannot see the plan until you call ${EXIT_PLAN_MODE_TOOL_NAME} for approval.
`;
}
