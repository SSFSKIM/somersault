# Codex Review

Target: branch diff against 7a8c290fa

The MCP dialog is omitted from the central overlay input-owner routing, causing deterministic fullscreen placement and concurrent-decision problems. The new hint and MCP data paths also present incorrect information in common states.

Full review comments:

- [P1] Route MCP through the overlay input owner — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/ChatApp.tsx:1892-1893
  When a bare `/mcp` opens this new arm, `state.mcpDialog.open` is absent from the `inputOwnerRef` overlay predicate above. In fullscreen, `seamActive` therefore remains false and the rows-sized browser renders in the half-height dock, while footer and mouse gates still treat the absent composer as the input owner; if a permission arrives mid-dialog, both surfaces can render instead of suppressing the decision. Add MCP state to the same overlay-owner predicate as Settings and Permissions.

- [P2] Advertise only actions active in the current dialog — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/dialogs/keyhints.ts:104-107
  This enumerates every default action in a named scope and checks only whether it has a binding, not whether the current surface registered a handler. Consequently, read-only Settings tabs advertise navigate/select/search even though all are no-ops and omit the working tab-switch hint due to the four-hint cap; Help search similarly advertises tab switching while `disableNavigation` removes its handlers. Build hints from per-state reachable actions rather than the entire scope.

- [P2] Surface MCP status-fetch failures — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:64-67
  If `mcpServerStatus()` rejects, such as with an older unsupported host or a transport failure, this catch converts the failure to `[]`, after which the dialog reports `No MCP servers configured.` and `0 servers`. The previous command-level error path exposed the failure, so this now misreports an unavailable status source as a valid empty configuration; retain and render an error state instead.

- [P2] Keep MCP root rows within one terminal line — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:50-52
  For a server with a long name or failure message, this renders the combined label verbatim and Ink wraps it, while `mcpListVisibleRows()` budgets every root entry as exactly one row. On narrow or short terminals that makes the supposedly windowed list exceed its row budget and can clip overflow indicators or the footer. Clip or sanitize the root label to the available columns, or move the detailed error into the server view.
EXIT=0
