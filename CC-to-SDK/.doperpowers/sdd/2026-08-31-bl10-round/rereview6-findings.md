# Codex Review

Target: branch diff against 7a8c290fa

The patch introduces misleading Settings search hints and several MCP dialog correctness and geometry defects. These affect valid interaction sequences and input/error shapes even though the common paths are covered by the added tests.

Full review comments:

- [P2] Hide browse hints during settings search — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/SettingsDialog.tsx:547-548
  When the Config tab's `/` query is open, `Tabs` is disabled and `Select` is unmounted, but this still derives hints from the full Settings and Tabs scopes. The resulting bar advertises navigation, selection, and search actions even though Up clears the query and Space or `/` insert text, contradicting the adjacent `SEARCH_FOOTER`; use an empty or search-specific `hintActions` set in this state as `HelpDialog` does.

- [P2] Bound rejected MCP status messages to the viewport — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:171-174
  When `mcpServerStatus()` rejects with a long or multiline `Error.message`, this path renders the entire message without the width or row budgeting used by the list, fields, and detail views. On a short terminal that can push the frame to or beyond `rows`, triggering Ink's tall-frame clear/replay behavior or hiding the footer; flatten and truncate or window the failure text too.

- [P2] Resolve MCP actions from the live view state — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:131-131
  When stdin coalesces multiple keys into one chunk, every event is dispatched before React rerenders, so `pop` and the `onAccept` callbacks all observe the same render-time `view`. Consequently `Enter Enter` at the root advances only to `server-menu` instead of `server-tools`, and `Esc Esc` from tool detail pops only one level; dispatch against a synchronously updated view ref so each key applies to the state produced by the previous one.

- [P2] Preserve unmodified MCP server identifiers — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/mcpDialogModel.ts:63-65
  When two configured server names differ only by whitespace normalized by `flattenLabel` (for example `foo` and `foo `), both rows receive the same `name`. `McpDialog` later uses that value as its React key and view lookup, so selecting the second row resolves the first server's details; retain the raw name as the identity and store a separate flattened display label.
EXIT=0
