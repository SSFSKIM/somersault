# Codex Review

Target: branch diff against 7a8c290fa

The patch introduces inaccessible command output, an acceptance script that intentionally fails, and MCP dialog accuracy/geometry defects. These are functional regressions despite the extensive added coverage.

Full review comments:

- [P2] Keep clipped settings output reachable — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/SettingsDialog.tsx:531-532
  When Status/Usage/Stats output exceeds the row budget—for example `/cost` after using several models or on a short terminal—this slice permanently omits every line after `shown` and renders only a marker. These read-only tabs have no scrolling or paging handler, so the hidden fields cannot be viewed, unlike the previous transcript dumps; make the body navigable or retain the text-output path.

- [P2] Do not make the hover acceptance suite fail by design — /private/tmp/bl10-review-scope/CC-to-SDK/harness/scripts/hover-cells.sh:166-168
  With tmux installed, the default `npm run test:hover-cells` includes h1. The preceding comments state that local events intentionally do not un-dim on hover, making `after_dim >= before_dim` the expected result, but this branch still sets `rc=1`, so the suite always exits unsuccessfully; assert unchanged dimming or use a genuinely hoverable fixture.

- [P2] Bound MCP detail names before charging fixed rows — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:272-273
  When an MCP server or tool name is wider than the dialog or contains a newline, these raw `Text` nodes wrap even though `mcpToolDetailDescriptionRows` reserves exactly one row for each. The additional rows can push the detail frame to the terminal height and trigger Ink's tall-frame replay; flatten and truncate these names under the same width budget used by the root and tool-list labels.

- [P2] Do not report zero servers when loading failed — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:299-299
  When `fetchServers()` rejects, the catch path assigns `servers=[]`, causing this subtitle to claim `0 servers` beside the error message. A transport failure means the count is unknown, not zero, so preserve the failed state and omit or replace the count instead of presenting a contradictory empty-state claim.
EXIT=0
