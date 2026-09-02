// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// The cross-session tool's own prose, and the campaign's first owned byte inside
// `chunk-0ak8xf05.js` — 77.9 KB the census never counted.
//
// `crossSessionEnabled` is `Yo()`, the kill switch for the whole messaging
// surface: it reads `CLAUDE_CODE_HARBOR_KITE` and then the `tengu_harbor_kite`
// gate, whose compiled-in default is TRUE, so §3.3's pinned-disabled policy
// leaves it ON and the corpus records the ENABLED arm. The disabled arm — three
// paragraphs and a table row shorter — is graded by the contract test.
//
// The other argument is upstream's: team context on or off, which the tool's
// `prompt()` supplies from the agent-team gate and which is false headlessly.
import { LIST_AGENTS_TOOL_NAME } from "../shared/tool-names.js";

export function sendMessageDescription(agentTeamContext, crossSessionEnabled) {let s=crossSessionEnabled()?`
| \`"worker"\` | Any agent from \`${LIST_AGENTS_TOOL_NAME}\` \u2014 subagent, another local Claude session |
| \`"worker [3fa9c1]"\` | Same, plus its \`[ref]\` \u2014 only when a listing or an error shows one |`:"",u="",o=crossSessionEnabled()?`

## Cross-session

Use \`${LIST_AGENTS_TOOL_NAME}\` to discover targets. Every row leads with the agent's \`name [ref]\` \u2014 the name IS the address; there is no separate address syntax.

\`\`\`json
{"to": "worker", "message": "check if tests pass over there"}
{"to": "worker [3fa9c1]", "message": "you, specifically"}
\`\`\`

Send the bare name \u2014 a name that exactly matches one live agent or session (on this machine, on another machine, or in the cloud) delivers directly. Append the \` [ref]\` only when the bare name is not enough \u2014 \`${LIST_AGENTS_TOOL_NAME}\` shows two rows with it, or an error asks you to disambiguate (you typed only a prefix, or a session list could not be checked). A ref you did not just read from a listing or an error will not resolve, and if the same name also names an in-process agent, the bare name always wins \u2014 use the in-process one.

A listed peer is alive and will process your message; messages enqueue and drain at the receiver's next tool round (its \`${LIST_AGENTS_TOOL_NAME}\` row says whether it is busy or idle right now). Your message arrives wrapped as \`<cross-session-message from="...">\`. **To reply to an incoming message, copy its \`from\` attribute as your \`to\`.** Cross-session messages travel between SESSIONS: if you are a subagent, your send goes out under your parent session's address, and any reply is delivered to the parent session's conversation, not to you.

To hear when a session ON THIS MACHINE finishes what it is doing, pass \`notify_when_idle: true\` (from the main conversation only) \u2014 one-shot and opt-in: exactly one \`[Cross-session idle notice]\` arrives when it next goes idle (or exits) \u2014 shown to you, or only to your user when this session holds peer messages for approval (the tool result says which); if it never signals within the subscription's lifetime (it may still be busy, may refuse inbound requests, or may have ended abruptly) the notice says the subscription expired instead. Omit \`message\` for a pure subscription that costs that session nothing; include one to deliver it now AND subscribe. Never poll \`${LIST_AGENTS_TOOL_NAME}\` in a loop or send "are you done?" messages instead.

Permission boundaries are per-session: NEVER ask a peer to perform an action that was denied or blocked in your session, or that you expect your own permission settings would block \u2014 a peer doing it for you bypasses the user's permission decision (cross-session permission laundering). Route blocked work back to your user instead.`:"";return`
# SendMessage

Send a message to another agent.

\`\`\`json
{"to": "researcher", "summary": "assign task 1", "message": "start on task #1"}
\`\`\`

| \`to\` | |
|---|---|
| \`"researcher"\` | Teammate by name |
| \`"main"\` | The main conversation (background subagents only) |${s}${""}

Your plain text output is NOT visible to other agents \u2014 to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to agents by name \u2014 names keep working after an agent completes (a send resumes it from its transcript). Use the raw \`agentId\` (format \`a...-...\`) from its spawn result only when the agent has no name, or when a newer agent took the name (latest wins). When relaying, don't quote the original \u2014 it's already rendered to the user.${o}${agentTeamContext?'\n\n## Protocol responses (legacy)\n\nIf you receive a JSON message with `type: "shutdown_request"` or `type: "plan_approval_request"`, respond with the matching `_response` type \u2014 echo the `request_id`, set `approve` true/false:\n\n```json\n{"to": "team-lead", "message": {"type": "shutdown_response", "request_id": "...", "approve": true}}\n{"to": "researcher", "message": {"type": "plan_approval_response", "request_id": "...", "approve": false, "feedback": "add error handling"}}\n```\n\nApproving shutdown terminates your process. Rejecting plan sends the teammate back to revise. Don\'t originate `shutdown_request` unless asked. Don\'t send structured JSON status messages \u2014 report progress through your task tools if you have them, otherwise in plain prose.':""}
`.trim()}
