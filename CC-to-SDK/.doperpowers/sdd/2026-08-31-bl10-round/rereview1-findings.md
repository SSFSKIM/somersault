# Codex Review

Target: branch diff against 7a8c290fa

The modal `/status` conversion breaks a required PTY CI suite, and several new dialog paths mishandle bounded geometry, compatibility, or batched input. Automated validation could not run because this checkout lacks installed dependencies.

Full review comments:

- [P1] Update PTY staging before making `/status` modal — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/useChat.ts:2283-2283
  When the PTY suites run, `resize-matrix.sh::stage_content()` and `hover-cells.sh` still submit `/status` as a text-only staging command and then assume the composer is active; this now leaves Settings open, so frame checks inspect the dialog and later commands such as G1's `/model` are swallowed. Change the staging command or dismiss the dialog; the matrix is CI-required per `CC-to-SDK/harness/CLAUDE.md:15-16`.

- [P2] Window `/cost` output before opening the modal — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/useChat.ts:2264-2264
  When usage contains enough rate-limit or per-model rows to exceed the terminal height, `/cost` now routes the unbounded `formatUsage + formatCost` output into Settings' read-only pane, which renders every line without scrolling or windowing. Unlike the old scrollback output, rows become clipped or trigger Ink's tall-frame replay, so the modal is not information-equivalent; add paging/windowing before switching this arm.

- [P2] Preserve legacy MCP `state` values — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/mcpDialogModel.ts:59-62
  For an older or loosely typed session returning `{name, state: "connected"}`, the pre-patch `formatMcpStatus` explicitly used `status ?? state`, but this normalizer ignores `state` and reports the server as failed. Preserve that accepted fallback before validating the known status values.

- [P2] Read MCP focus from a live ref — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:130-134
  When movement and Enter are decoded from one stdin chunk, `onMove` schedules state but no render occurs before `onAccept`; the plain `index` and callbacks therefore still read the previous server/tool focus and open the wrong row. Keep focus ref-backed and pass a getter/read the current ref, as required by `useSelectKeys`' multi-event contract.

- [P2] Reserve the extra rows in the MCP tools view — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/McpDialog.tsx:189-192
  When a server has more tools than fit in a short pane, this reuses the root-list row budget even though the tools view adds a server heading and `marginTop`; long tool names can also make an option wrap. The frame therefore reaches or exceeds `rows` before the outer footer, clipping hints or triggering tall writes. Use a tools-specific chrome budget and enforce one physical row per option.

- [P2] Suppress Help's dismiss hint during search — /private/tmp/bl10-review-scope/CC-to-SDK/harness/src/tui/HelpDialog.tsx:192-192
  While a Commands or Custom-commands search is active, Escape runs `help:dismiss` but its handler only clears the query; the browser footer correctly says `Esc to clear`, while this scope-derived bar simultaneously says `Esc dismiss`. Omit or override the Help hint for the search state so the two visible instructions agree.
EXIT=0
