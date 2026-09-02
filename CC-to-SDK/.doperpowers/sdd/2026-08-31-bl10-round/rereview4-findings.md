# Codex Review

Target: branch diff against 7a8c290fa

The MCP dialog can exceed its promised terminal row budget for accepted server names, and expanded result headers can display a full-width clickable band that becomes inert when their body scrolls out of view. Both are user-visible regressions in the newly added behavior.

Full review comments:

- [P2] Clip MCP server headings before applying row budgets — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:209-209
  When a server name exceeds the dialog width or contains newlines, this raw heading wraps without being charged to the row budget. The same occurs in the tools view at line 236, where `mcpToolsVisibleRows()` explicitly assumes a one-row heading; for example, a valid long name produces a 17-line frame with `rows=14`, causing clipping or Ink's tall-frame replay. Flatten and truncate both headings as the detail view already does.

- [P2] Keep expanded headers clickable when body rows scroll out — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/toolRenderer.tsx:581-581
  When a long expanded result is scrolled so its banded header is visible but its body is outside the viewport, `clickableOwnersOf()` sees no clickable body row and therefore omits this owner. The header now paints and hit-tests across the full width, but `clickTargetAt()` fails the owner gate and cannot collapse it. Mark the header clickable when its result is expandable/expanded, or derive owner clickability beyond the currently painted body rows.
EXIT=0
