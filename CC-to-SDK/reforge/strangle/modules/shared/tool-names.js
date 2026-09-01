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
