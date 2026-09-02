# Codex Review

Target: branch diff against 7a8c290fa

The new Settings and MCP dialogs contain reproducible data-loss, navigation-state, and terminal-geometry defects. Typecheck and tests could not run because dependencies were absent and the read-only checkout prevented Vitest's temporary/cache writes.

Full review comments:

- [P2] Preserve access to clipped Settings rows — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/SettingsDialog.tsx:519-532
  When Status/Usage/Stats exceeds the height budget—commonly `/status` on a short terminal or `/cost` after several model switches—the tail is replaced by a passive `… +N more lines` marker. These read-only tabs register no scrolling or selection mechanism, so the omitted fields are permanently inaccessible, regressing the former text commands and their information-preservation contract; window the body with navigable scrolling instead of discarding the tail.

- [P2] Flatten multiline MCP labels before windowing — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:83-88
  When an MCP tool description contains a newline, `stringWidth` ignores the line break while both the direct and `truncateLabel` paths preserve it, so one tool option paints multiple terminal rows even though `mcpToolsVisibleRows` budgets exactly one. Multiline descriptions are valid MCP metadata and can therefore overflow the dialog or clip its footer; normalize embedded line breaks before measuring and truncating these labels.

- [P2] Keep server-menu navigation from resetting root focus — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:148-152
  After opening a server other than the first, pressing any navigation key in `server-menu` uses that view's count of one but writes the clamped result into `serverFocus`; Esc then returns to the root with focus unexpectedly reset to the first server. The menu should use separate focus state—or make navigation a no-op—rather than mutating the root-list cursor.

- [P2] Bound MCP detail views to the available rows — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:245-249
  A server error/command or tool description can be arbitrarily long, but the server-menu and tool-detail views render these strings without clipping or vertical windowing. In the classic renderer a sufficiently long MCP diagnostic or description can exceed the terminal height and trigger Ink's tall-frame replay, while fullscreen simply makes part of the detail unreachable; apply the dialog's row budget to these views as well.
EXIT=0
