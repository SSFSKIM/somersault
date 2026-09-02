# Codex Review

Target: branch diff against 7a8c290fa

The new dialog routing can hide command results, race with other overlays, and mishandle same-chunk MCP navigation. It also introduces misleading settings-path and dismissal feedback in the newly added routes.

Full review comments:

- [P1] Keep clipped Settings rows reachable — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/SettingsDialog.tsx:520-526
  When the formatted output exceeds the height budget, this permanently drops the tail and only shows a marker, but the Status/Usage/Stats panes register no scrolling or paging actions. On a short terminal or with several plan/model rows, `fetchSettingsUsage()` places all `/cost` fields after the usage rows, so `/cost` can display none of the cost information; the Stats in-flight disclaimer can likewise become unreachable. Make this body scrollable/pageable rather than truncating the command result.

- [P2] Open the status dialog before refreshing context — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/useChat.ts:2282-2283
  When `getContextUsage()` is slow, `/status` leaves the composer active while this await runs because local commands are dispatched fire-and-forget. If the user opens `/mcp` or `/config` meanwhile, the delayed continuation later opens Settings over that surface and can leave both overlay flags set, so closing one unexpectedly reveals the other; it also delays all visible dialog feedback. Open Settings immediately and let the already-refreshing `fetchSettingsStatus()` populate it.

- [P2] Advance the MCP stack from live state — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:135-135
  When two navigation events arrive in one stdin chunk, the key provider dispatches both before React rerenders, but `pop` and the view-specific `onAccept` handlers keep reading this render-captured `view`. For example, `"\r\r"` on a server with tools executes the root-list handler twice and stops at `server-menu` instead of drilling to `server-tools`; repeated back actions have the same stale-stack problem. Keep the current view in a synchronously updated ref and derive each transition from it.

- [P2] Show the effective user-settings path — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/settingsFile.ts:46-46
  When `CLAUDE_CONFIG_DIR` is set, including an attach using the host's recorded root, this now writes user rules to `<configDir>/settings.json`, while `PermissionsDialog.tsx` still tells users the destination is `~/.claude/settings.json`. Anyone choosing “User settings” is therefore directed to inspect or edit a different file from the one actually changed; derive the displayed destination from the effective settings path or use non-path-specific copy.

- [P3] Match dismissal text to the Settings dialog — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/useChat.ts:2965-2965
  When the generalized opener is called by `/status`, `/usage`, `/cost`, or `/stats` and the user closes without changing Config values, `closeSettings()` still appends “Config dialog dismissed.” The visible dialog is titled Settings and the initiating command was not `/config`, so the runtime feedback is misleading; preserve the existing wording only for the Config route or use the dialog's actual title.
EXIT=0
