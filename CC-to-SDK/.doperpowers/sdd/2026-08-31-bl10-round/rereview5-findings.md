# Codex Review

Target: branch diff against 7a8c290fa

The new dialog windows discard command and MCP detail output without a way to navigate to it, and Permissions advertises a no-op action for immutable rows. These are user-visible regressions in the changed surfaces.

Full review comments:

- [P2] Keep clipped status output reachable — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/SettingsDialog.tsx:531-532
  When Status/Usage/Stats produces more rows than the budget—such as `/cost` with many model rows or any command in a short pane—this drops the tail and displays only a counter. These tabs mount no scrolling handler, so the hidden formatter rows cannot be viewed, violating the information-equivalence gate in `CC-to-SDK/docs/superpowers/specs/2026-08-31-bl10-menus-click-spacing-design.md:53-60`; use a scrollable window instead of discarding rows.

- [P2] Preserve full MCP detail values — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:219-219
  When a server reports a long error, URL, or stdio command, the root row is already clipped and this drill-down truncates the field again. There is no deeper view, scrolling, or copy route, so the omitted diagnostic is unrecoverable; tool descriptions repeat this behavior with `descLines.slice(0, descKeep)`. Preserve complete metadata behind a scrollable or expandable detail pane.

- [P2] Suppress selection hints for immutable directories — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/PermissionsDialog.tsx:687-687
  On the Workspace tab with a cwd/launch directory focused, `activate()` intentionally does nothing unless `source === "session"`, but this uniform hint list still renders `select:accept` as `Enter select`. The previous managed-directory footer omitted that action, so this introduces a visible no-op; derive hints from the focused item or omit select for immutable rows.
EXIT=0
