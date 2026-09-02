// The catalog's tool-name literals, owned outright in ONE place (§2.4 `primitive`).
//
// Upstream these are single-token `var` constants scattered across the satellite
// chunks — `ti="Glob"` and `$s="REPL"` in chunk-y30v0ja7, `Xo="Grep"` in
// chunk-hdmehzg7, `yt="Agent"` and `Qe="Bash"` and `_t="Read"` in the primitives
// chunk — and they are read by prose in a dozen unrelated places: description
// text, permission-rule matching, tool-name sets, prompt nudges.
//
// A shared home is not tidiness. Every owned module that interpolates a tool name
// into prose transcribes the same literal, and two transcriptions of one constant
// are exactly the drift the W2 scout named for the file-state suffix
// (reforge/research/2026-08-31-w2-schunk-scout.md §4): the value can change while
// the minified NAME stays put, which moves no anchor and no footprint hash. One
// binding, asserted from every adapter that receives the graph's copy, is the
// only cheap thing that can see that happen.
export const READ_TOOL_NAME = "Read";
export const GLOB_TOOL_NAME = "Glob";
export const GREP_TOOL_NAME = "Grep";
export const BASH_TOOL_NAME = "Bash";
export const AGENT_TOOL_NAME = "Agent";
export const REPL_TOOL_NAME = "REPL";
// Upstream `ar`, in the primitives chunk. Read by the subagent prompt's notes
// block, by permission-rule matching and by a dozen prose sites.
export const WRITE_TOOL_NAME = "Write";

// ---- the moat catalog (C11a / W8a) -----------------------------------------
// Eight more, read by the description belt's prose. Upstream scatters them the
// same way: `lm`/`FS` in the cron chunk, `ma` in the Monitor barrel, `Ji` in the
// AskUserQuestion chunk, `UE`/`Wh` in the plan-mode chunks, `Xr` in the
// SendMessage name chunk, `Ys` beside the ListAgents description. Every one is
// interpolated into another tool's description, which is exactly the drift a
// single owned binding exists to catch: the value can move while the minified
// name stays put, and no anchor or footprint hash moves with it.
export const CRON_CREATE_TOOL_NAME = "CronCreate";
export const CRON_DELETE_TOOL_NAME = "CronDelete";
export const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";
export const ENTER_PLAN_MODE_TOOL_NAME = "EnterPlanMode";
export const EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode";
export const SEND_MESSAGE_TOOL_NAME = "SendMessage";
export const LIST_AGENTS_TOOL_NAME = "ListAgents";
// The one tool in this file the engine never presents: `Monitor`'s own
// `isEnabled()` reads `tengu_amber_sentinel`, whose compiled-in default is false
// and which has no per-gate env override, so it is absent from all 82 recorded
// cassettes. Its NAME is here because CronCreate's description points at it — the
// only place in the whole catalog where a live tool's prose names a gate-dead
// one, and the arm that does is dark in the corpus for the same reason.
export const MONITOR_TOOL_NAME = "Monitor";
