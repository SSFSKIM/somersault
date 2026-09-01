// PARITY LAYER (§2.5 `reference`) — the Grep tool's description function.
//
// Upstream: `gmn(e)` in chunk-hdmehzg7.js @ 2.1.251, spliced at the free-function
// shape. The chunk itself is not ownable whole (17 exports: the REPL registry
// class and its variant/session predicates, the deferred-tool policy `TM`, the
// built-in tool-name set, the ToolSearch description builder), so §2.2's fallback
// applies and only this function is excised.
//
// The three tool names it interpolates are §2.4 `primitive`s owned in
// shared/tool-names.js and equality-asserted at the adapter. `leanPrompt` and
// `subagentSteer` stay `effectful-port`s — and `subagentSteer` LATCHES on its
// first call, so it is called exactly where upstream calls it: inside the full
// arm, after the lean test, never at module load.
import { AGENT_TOOL_NAME, BASH_TOOL_NAME, GREP_TOOL_NAME } from "../shared/tool-names.js";

export { AGENT_TOOL_NAME, BASH_TOOL_NAME, GREP_TOOL_NAME };

/**
 * Upstream `gmn`.
 *
 * @param model         the session model id, or undefined
 * @param leanPrompt    port: is this model on the lean system prompt?
 * @param subagentSteer port: "default" | "no_nudges" | "counter_steer" (latches)
 */
export function grepDescription(model, leanPrompt, subagentSteer) {
  if (leanPrompt(model)) {
    return `Content search built on ripgrep. Prefer this over \`grep\`/\`rg\` via ${BASH_TOOL_NAME} — results integrate with the permission UI and file links.

- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep — escape literal braces (\`interface\\{\\}\`).
- Filter with \`glob\` (e.g. "**/*.tsx") or \`type\` (e.g. "js", "py", "rust").
- \`output_mode\`: "content" (matching lines), "files_with_matches" (paths only, default), or "count".
- \`multiline: true\` for patterns that span lines.`;
  }
  // The subagent nudge is a WHOLE LINE, newline included, or nothing at all —
  // upstream splices it between two bullets, so an empty arm must leave the
  // following "  - Pattern syntax" line starting exactly where it did.
  const agentNudge =
    subagentSteer() === "default"
      ? `  - Use ${AGENT_TOOL_NAME} tool (if available) for open-ended searches requiring multiple rounds
`
      : "";
  return `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use ${GREP_TOOL_NAME} for search tasks. NEVER invoke \`grep\` or \`rg\` as a ${BASH_TOOL_NAME} command. The ${GREP_TOOL_NAME} tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
${agentNudge}  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`
`;
}
