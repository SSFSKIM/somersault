// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// ListAgents is the cross-session surface's other half: its `isEnabled()` is the
// SAME kill switch as SendMessage's transport (`Yo()`, whose gate default is
// true), which is why both are present in all 267 recorded catalogs while
// neither has ever been executed. This text is what the corpus grades today;
// the listing itself is C11b's probe and C11d's row.
import { SEND_MESSAGE_TOOL_NAME } from "../shared/tool-names.js";

export function listAgentsDescription() {
  return `Lists agents you can ${SEND_MESSAGE_TOOL_NAME} to \u2014 in-process subagents you spawned, the teammates on your team, other local Claude sessions on this machine, your Claude sessions running in the cloud (when this session has cloud access; a cloud session receives your message but cannot message any session back yet \u2014 do not ask it to reply, read its answer in its own transcript), and (when Remote Control is connected here) your account's other sessions \u2014 Remote Control sessions on other machines and cloud sessions, each row labeled by kind. Names are the address: send with \`${SEND_MESSAGE_TOOL_NAME}({to: "<name>", message: "..."})\`, copying the name exactly as a row prints it. Append a row's \` [ref]\` only when the bare name is not enough \u2014 two rows share it, or an error asks you to disambiguate.`;
}
