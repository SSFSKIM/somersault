# Codex Review

Target: branch diff against 7a8c290fa

The patch leaves multiple user-visible correctness gaps in the new dialog and expanded-band behavior, including unreachable Settings data and incomplete click-band coverage. It also reports misleading MCP state and key affordances.

Full review comments:

- [P2] Band click-expanded advisor rows — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/toolRenderer.tsx:951-951
  When a clickable `advisor_tool_result` is opened, `advisorOpts.expanded` renders the full body, but the emitted items still receive only `clickable`, never `expanded` or `band`. Consequently advisor rows miss the new full-width paint/hit behavior, so clicking the blank tail still cannot collapse them and hover remains enabled; derive these flags from `options.expandedItems?.has(ownerKey)` here as the tool-result path does.

- [P2] Preserve oversized lines in the Settings scroll window — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/SettingsDialog.tsx:170-172
  On a short or narrow pane where one fetched `RenderLine` wraps to more physical rows than `budget`—for example a long per-model cost row or fetch error—this loop breaks before advancing `end`. Scrolling then advances `start` past that line, so it is never rendered at any position, violating the information-preservation goal; window the `paintedRows` themselves or otherwise expose partial rows instead of skipping an oversized logical line.

- [P2] Paint the gutter on every row of an expanded result — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/toolRenderer.tsx:2007-2008
  For an expanded `gutter-block` with multiple body rows, this single gutter `Text` paints its background only on the first row; subsequent rows get layout padding in the first `item.gutter.length` columns but no band color. The hitmap now treats every such row as full-width, so those visually blank cells are clickable and the advertised band is discontinuous; render a background-filled gutter cell for each body row.

- [P2] Hide the MCP count until loading finishes — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:342-342
  While `fetchServers()` is pending, `servers` is `undefined`, `fetchError` is absent, and `serverCount` is therefore zero, so the dialog displays `0 servers` next to `Loading…`. A slow or stuck request leaves a false empty-fleet claim visible; omit the subtitle until `servers` has actually resolved, just as it is omitted for fetch errors.

- [P2] Suppress inert MCP navigation hints for one-row views — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:336-337
  When `count === 1`—such as one configured server, one tool, or the single “View tools” row—the full `Select` scope advertises `↑ navigate` and `PgUp page up`, although every movement clamps back to index 0 and does nothing. Use precise hint actions so single-row views expose only select/cancel, adding navigation hints only when there is another row to reach.
EXIT=0
