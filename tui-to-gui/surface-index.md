# Surface index

Total cards: 400


## Counts per lane

| Lane | Cards |
|---|---|
| A | 44 |
| B | 68 |
| C | 64 |
| D | 62 |
| E | 56 |
| F | 45 |
| G | 61 |

## Counts per status

| afleet status | Count |
|---|---|
| built | 159 |
| designed | 34 |
| routed-only | 10 |
| undesigned | 157 |
| superseded | 26 |
| out-of-scope | 14 |

## Counts per GUI region (across all lanes)

| GUI region | Count |
|---|---|
| timeline | 75 |
| composer | 62 |
| none | 48 |
| Settings | 42 |
| decision card | 41 |
| sidebar | 29 |
| channel banner | 19 |
| channel header | 15 |
| panel:Agents | 11 |
| notification | 10 |
| panel:Files | 9 |
| menu bar | 8 |
| popover | 8 |
| Activity | 7 |
| consent sheet | 4 |
| panel:Browser | 3 |
| panel:Thread | 3 |
| panel:Source Control | 2 |
| toast | 2 |
| panel:Terminal | 1 |
| quick switcher | 1 |

## Lane A — chrome and status (44 cards)

| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |
|---|---|---|---|---|---|---|---|---|
| A-01 | The layout frame and its three renderer branches | built | sidebar | T | low | S | yes | — |
| A-02 | The REPL welcome header | designed | channel banner | P/D/T | low | S |  | A-34 (title precedence) |
| A-03 | `/tui` — inline versus alternate screen | superseded | none | T | low | S |  | A-01 |
| A-04 | The fullscreen boot canary | superseded | none | T | low | S |  | A-01 |
| A-05 | `/scroll-speed` | superseded | none | T | low | S |  | A-06 |
| A-06 | The scroll model and the sticky rule | built | none | R | high | S | yes | A-44 |
| A-07 | The jump-to-bottom pill | built | timeline | R | med | S | yes | A-06 |
| A-08 | The footer as a whole — where its six jobs land | designed | composer | R | high | M |  | A-09, A-11, A-13, A-16 |
| A-09 | The hint vocabulary | designed | composer | T/R/P | med | M | yes | A-08, A-15 |
| A-10 | The row-replacing footer states | undesigned | none | R | med | S |  | A-08 |
| A-11 | The permission-mode pill and the Shift+Tab indicator | built | composer | P | high | S | yes | — |
| A-12 | Focusable footer chips (`footerSelection`) | built | panel:Agents | P/X/T/D | low | S | yes | — |
| A-13 | The right-column indicator chips | undesigned | channel header | X/T | med | M |  | A-08 |
| A-14 | Terminal-only footer chips with no GUI referent | superseded | notification | T | low | S |  | — |
| A-15 | The `?` shortcuts panel | undesigned | menu bar | T/R | high | M | yes | A-09, root §8.7 |
| A-17 | The spinner row | designed | timeline | R/D/P | high | L | yes | A-18, A-20, A-22, A-23, A-24 |
| A-18 | The compaction gauge (the spinner's second row) | undesigned | timeline | R/D | med | S | yes | A-17; a probe for compaction progress |
| A-19 | Reduced motion | undesigned | none | T/R | med | S |  | A-17, A-34, A-35 |
| A-20 | Retry and stall variants | undesigned | channel banner | P/D | high | M | yes | A-17, A-38 |
| A-21 | The verb list | undesigned | none | T/R | low | S | yes | A-17 |
| A-22 | Spinner tips: registry, selection, cadence | undesigned | menu bar | T/R | low | M |  | A-17, A-44 (`tips`) |
| A-23 | The `Next: <task subject>` sub-line | built | panel:Agents | P | med | S | yes | A-17, Agents panel |
| A-24 | The turn-narration sub-line | undesigned | none | D | med | L | yes | A-17; owner cost decision |
| A-16 | The `statusLine` row — a user's own script in the chrome | undesigned | channel header | P/R/D | high | L | yes | `get_context_usage`, `get_usage`, `get_binary_version`, A-36 |
| A-25 | `/statusline` — the setup flow | undesigned | Settings | X/R | med | S | yes | A-16, §7.7 router |
| A-26 | `subagentStatusLine` — per-task decoration | undesigned | notification | R | low | S |  | A-16, Agents panel |
| A-27 | The pinned bar | built | channel banner | D | high | M | yes | A-37, A-38 |
| A-28 | The transient bar | built | toast | D | high | M | yes | A-27 |
| A-29 | Notifications arriving from another process | superseded | sidebar | T/X/P | med | S |  | A-28 |
| A-30 | The channel picker and `auto` resolution | built | notification | R/T | med | S | yes | A-44 (`notifChannel`) |
| A-31 | The fourteen notification types and their texts | built | notification | D/P | high | S | yes | A-32 |
| A-32 | The `Notification` hook as afleet's transport | built | notification | P/D | high | S | yes | — |
| A-33 | The OSC 9;4 progress bar | built | sidebar | R | med | S | yes | A-44 (`progressBar`) |
| A-34 | Title resolution and the animated prefix | built | sidebar | P | high | S/M | yes | A-19, A-35 |
| A-35 | Tab status (OSC 21337) — dead in canon, free in the GUI | undesigned | sidebar | X | high | S | yes | A-34, A-40, A-42 |
| A-36 | The context indicator | built | sidebar | R | high | S | yes | A-37, A-44 |
| A-37 | The context-limit banner | undesigned | channel banner | R | high | S | yes | A-27, A-36 |
| A-38 | The rate-limit family and auto-continue | designed | channel banner | P/D | high | M/L | yes | A-27, A-39, `rate_limit_event` |
| A-39 | `/rate-limit-options` and `/usage-credits` | undesigned | Activity | X | med | M |  | A-38; owner scope decision |
| A-40 | Themes: six tables, `auto`, custom themes, `/theme` | undesigned | Settings | R | high | M |  | A-42 |
| A-41 | `/color` — the per-session accent | undesigned | sidebar | T/R | med | S | yes | A-40 |
| A-42 | Colour capability and the daltonized variants | undesigned | Settings | T/R | high | S | yes | A-40 |
| A-43 | The screen-reader renderer and accessibility | built | timeline | T | high | M | yes | A-17, A-19 |
| A-44 | The chrome-affecting `/config` rows | undesigned | Settings | R | high | M |  | A-06, A-19, A-22, A-30, A-33, A-35, A-40 |

## Lane B — transcript rendering (68 cards)

| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |
|---|---|---|---|---|---|---|---|---|
| B-01 | Chrome glyphs and the row-prefix vocabulary | superseded | timeline | T | med | S | yes | — |
| B-02 | The bullet state machine | built | timeline | R | med | S | yes | B-14 |
| B-03 | Gutters, indentation and unselectable chrome | built | none | T | low | S | yes | B-58 |
| B-04 | The user message row and the input-box rules | built | composer | R | low | S | yes | — |
| B-05 | The assistant prose row and the streaming tail | built | none | R | med | S | yes | B-55 |
| B-06 | The fold | built | timeline | R | high | S | yes | B-14 |
| B-07 | `ctrl+o` — the transcript screen, and afleet's missing raw layer | routed-only | timeline | P/T | high | M | yes | B-56, ThreadView route |
| B-08 | `ctrl+e` — show all / hide previous messages | superseded | none | R | low | S |  | B-56 |
| B-09 | `verbose` | undesigned | channel header | R | med | S |  | B-06, B-10 |
| B-10 | Brief mode, `/brief` and `/focus` | routed-only | channel header | R | high | M | yes | B-06, B-12 |
| B-11 | Thinking blocks | built | timeline | P/R | med | S | yes | tracker 127, 138 |
| B-12 | The tool-call cluster | built | timeline | P/R | high | M | yes | B-14, tracker 128 |
| B-13 | Speaker labels and work segments | built | none | R | low | S |  | — |
| B-14 | The renderer side table | built | timeline | R/D | high | M | yes | — |
| B-15 | Shared result primitives and the universal error form | built | timeline | R/P | med | S | yes | B-44, B-45 |
| B-16 | `Read` — text files | built | timeline | P | med | S | yes | B-14 |
| B-17 | `Read` — images, PDFs and notebooks | built | timeline | P | high | M | yes | B-14, B-53 |
| B-18 | `Edit` | built | timeline | P | high | S | yes | B-40 |
| B-19 | `Write` | built | timeline | P | med | S | yes | B-51 |
| B-20 | `MultiEdit` — not a rendered tool in 2.1.263 | superseded | none | T | none | none |  | — |
| B-21 | `NotebookEdit` | undesigned | timeline | R | med | M | yes | B-14, B-17 |
| B-22 | `Bash` — the command header and the completed result | built | timeline | P | high | S | yes | B-14 |
| B-23 | `Bash` — live output, background and the sandbox badge | built | timeline | D/P | high | M | yes | root spec §7.3 tailer |
| B-24 | `TaskOutput` and background task rows | built | timeline | R/P | med | S | yes | B-22, B-29 |
| B-25 | `Glob` | built | timeline | P | med | S | yes | B-14 |
| B-26 | `Grep` | built | timeline | P | high | M | yes | B-14, FileLink |
| B-27 | `WebFetch` | built | timeline | R | med | S | yes | B-48 |
| B-28 | `WebSearch` | built | timeline | D/P | med | S | yes | B-54 |
| B-29 | `Agent` — completion | built | timeline | R/P | med | S | yes | AgentChip |
| B-30 | `Agent` — progress and the backgrounded form | built | panel:Agents | R | med | M | yes | C6.4 Agents tab |
| B-31 | `AskUserQuestion` — the answered echo | undesigned | timeline | P/D | med | S | yes | lane D |
| B-32 | `ExitPlanMode` and `EnterPlanMode` | undesigned | timeline | P/R | med | S |  | lane D, B-48 |
| B-33 | `Skill` | undesigned | timeline | P/R | med | S | yes | **B-61** |
| B-34 | `LSP` | undesigned | timeline | R/D | med | S | yes | B-14 |
| B-35 | `ReportFindings` | undesigned | timeline | P | med | M | yes | `CLAUDE_CODE_REPORT_FINDINGS` |
| B-36 | `memory_write` and the memory tools | undesigned | timeline | R | low | S | yes | B-48 |
| B-37 | MCP tools, MCP progress, and the Chrome / computer-use families | built | timeline | P/D/R | med | M | yes | B-14 |
| B-38 | The long tail: scheduling, worktrees, notifications, messaging and list tools | undesigned | timeline | R/P | med | S |  | B-14 |
| B-39 | `TodoWrite` | built | timeline | D | med | S/M | yes | — |
| B-40 | The diff in a tool result | undesigned | timeline | P | high | S | yes | B-18, B-41 |
| B-41 | Diff row geometry and the four truncations | built | sidebar | T/R/P | high | M | yes | AttributedDiffRenderer |
| B-42 | The diff sidebar | built | panel:Source Control | T/R | med | S | yes | C7.7 |
| B-43 | The post-edit diagnostics row | undesigned | timeline | D | low | L |  | owner decision |
| B-44 | Interruption rendering | undesigned | timeline | P | high | S | yes | B-15 |
| B-45 | Rejection rendering | built | timeline | P | med | S | yes | B-15 |
| B-46 | `Waiting for permission…` | undesigned | timeline | P | med | S | yes | lane D |
| B-47 | Rate-limit auto-continue rendering | undesigned | channel banner | R/X | med | M | yes | lane E, Activity |
| B-48 | The markdown pipeline and token rendering | built | timeline | R | med | S | yes | — |
| B-49 | Tables | built | none | R | low | S | yes | — |
| B-50 | Lists | built | timeline | R | low | S | yes | — |
| B-51 | Code blocks, syntax highlighting and the line-number gutter | built | timeline | R | med | S | yes | B-19, B-21, B-40 |
| B-52 | Mermaid — never drawn in the terminal | designed | timeline | R | high | M |  | architect ruling |
| B-53 | Inline images and image placeholders | built | timeline | P | high | M | yes | B-17 |
| B-54 | Links, hyperlinks and the `owner/repo#123` linkifier | built | timeline | R/T | med | S | yes | GitHub panel |
| B-55 | Streaming markdown, `textWrap` and the width utilities | built | timeline | R | low | S | yes | — |
| B-56 | Virtual list, scroll anchoring, the commit cursor and static commitment | built | timeline | R/T | med | S | yes | tracker 132 |
| B-57 | Untrusted-text sanitising | built | notification | R | high | S | yes | — |
| B-58 | Selection, `copyOnSelect`, `copyFullResponse` and `/copy` | undesigned | timeline | X/T | high | S |  | B-03 |
| B-59 | `/export` | undesigned | menu bar | X/R | med | M | yes | B-07 (JSON), menu bar |
| B-60 | Timestamps, turn duration and the turn-summary row | built | timeline | P/R | med | S | yes | — |
| B-61 | Command echo wrappers | undesigned | timeline | P | high | S | yes | — |
| B-62 | Queued command echoes and queued messages | undesigned | composer | P | med | S | yes | B-61, lane C |
| B-63 | Hook system messages and hook rows | built | timeline | n/a | low | S | yes | — |
| B-64 | Skill-loading metadata and the vanished attachments | built | timeline | D | low | S | yes | B-07, B-33 |
| B-65 | Sent files and user attachments | built | timeline | P | med | S | yes | B-17 |
| B-66 | The compact boundary | built | timeline | P/R | med | S | yes | B-07 |
| B-67 | The five-phase compaction progress | undesigned | channel banner | D | med | S | yes | Channel banner |
| B-68 | Microcompact | undesigned | timeline | D | med | S/M | yes | root spec §7.3 |

## Lane C — composer and input (64 cards)

| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |
|---|---|---|---|---|---|---|---|---|
| C-01 | The composer field and its border | built | composer | T/P | med | S | yes | C-17 |
| C-02 | The editor buffer: word motion, control keys, named keys | superseded | composer | T/R | low | none | yes | — |
| C-03 | The kill ring | superseded | composer | T/R | low | none | yes | — |
| C-04 | The left-arrow guard | superseded | composer | T | low | none |  | — |
| C-05 | Undo, `chat:undo` and `chat:newline` | built | composer | R | med | S | yes | C-16 |
| C-06 | Editor mode `vim` — the recommendation | undesigned | panel:Files | P/R | med | S/L |  | C-62 |
| C-07 | The vim mode indicator and `/vim` | built | composer | X/R | low | none | yes | C-06 |
| C-08 | Multi-line entry: Shift+Enter, Enter, backslash-return, `ctrl+j` | built | composer | P/R | high | none | yes | — |
| C-09 | The Apple Terminal shift probe and `/terminal-setup` | superseded | composer | T/X | low | none | yes | — |
| C-10 | Paste detection and the paste hook | built | composer | T | high | none | yes | — |
| C-11 | Text placeholders and re-paste expansion | superseded | composer | R | high | M | yes | C-13, C-16 |
| C-12 | Oversized-draft truncation | superseded | composer | R | low | none | yes | C-11 |
| C-13 | Expansion at submit time and missing-backing repair | undesigned | composer | R | med | S | yes | C-11 |
| C-14 | Paste storage and the paste cache | designed | composer | R | low | M |  | C-33 |
| C-15 | Image paste and the clipboard hint | built | composer | P | high | S | yes | C-16 |
| C-16 | The attachments strip | built | composer | R | med | S | yes | — |
| C-17 | `!` bash mode: entering, the indicator, leaving | undesigned | composer | R/D | high | S | yes | C-01, C-22 |
| C-18 | What the composer shows while a `!` command runs | built | composer | D/R | high | S | yes | C-17 |
| C-19 | `@` mentions: the trigger, the token, the two providers | built | composer | R/P | high | M | yes | C-24, C-27, C-31 |
| C-20 | `#` — Slack channels, not memory | undesigned | popover | R/X | low | M |  | C-24 |
| C-21 | `/` — the slash trigger | built | composer | P/R | med | S |  | C-29 |
| C-22 | The empty-prompt hint row | designed | composer | R | high | S | yes | C-17 |
| C-23 | Provider dispatch: eighteen branches whose order is the precedence | built | composer | R | med | S |  | C-27 |
| C-24 | The completion menu | built | popover | T | high | M | yes | C-23 |
| C-25 | Ghost text | built | composer | R | med | S/M | yes | C-32 |
| C-26 | The unified `@` provider and what it hands the menu | built | composer | D | low | M | yes | C-31 |
| C-27 | Accept semantics: Tab, Enter and click are three different things | undesigned | composer | R | high | M | yes | C-24, C-19 |
| C-28 | Tab's other duties, and async behaviour | built | popover | R | med | S | yes | C-27 |
| C-29 | Slash-command rows, argument hints and argument completions | built | composer | P/R | high | M | yes | C-21, C-24 |
| C-30 | Slash-command ranking | built | composer | R | med | S/M | yes | C-29 |
| C-31 | File suggestions and the file index | built | composer | P | high | S | yes | C-19 |
| C-32 | Up and Down: recalling a prompt | undesigned | composer | R | high | M | yes | C-33 |
| C-33 | `~/.claude/history.jsonl`, the store, and the interop question | designed | composer | R | high | M/L | yes | §7.8 decision |
| C-34 | `ctrl+r` — reverse search and the history picker | undesigned | quick switcher | R/T | med/high | M | yes | C-33 |
| C-35 | Why `enter` is special | built | composer | P/R | high | none | yes | C-59 |
| C-36 | Queueing during a turn | built | composer | P | med | S | yes | C-37 |
| C-37 | Rendering the queue | built | composer | P | high | M | yes | C-38, C-39 |
| C-38 | Editing the queue: pull-back, per-entry selection, cancel | built | composer | R | high | M | yes | C-37 |
| C-39 | Draining: the batch rule | built | composer | P | med | S | yes | C-37 |
| C-40 | Mid-turn absorption and `chat:queueSubmit` | undesigned | composer | R/P | med | S/M | yes | C-37 |
| C-41 | `/btw` — the side question | built | composer | R | med | S | yes | C-22 |
| C-42 | Escape, and the double-press helper behind it | built | composer | R/T | high | S | yes | C-38 |
| C-43 | Ctrl-C, Ctrl-D, and exit versus detach | superseded | composer | R | med | S | yes | — |
| C-44 | Ctrl-Z | superseded | composer | T | low | none | yes | C-58 |
| C-45 | `chat:killAgents` | built | composer | D | high | S | yes | C-37 |
| C-46 | `chat:clearInput` and `chat:clearScreen` | superseded | composer | T | low | none | yes | C-59 |
| C-47 | `chat:externalEditor` | undesigned | composer | R | low/med | S | yes | — |
| C-48 | `chat:stash` | undesigned | panel:Files | R | low | none | yes | — |
| C-49 | `Shift+Tab`: the permission-mode ring | built | composer | R/P/D | high | S | yes | C-62 |
| C-50 | `confirm:cycleMode` — the same chord in a decision card | built | composer | P | med | S | yes | C-59 |
| C-51 | The `app:*` toggles and `/focus` | superseded | timeline | X/R/P/D | low/med | M | yes | — |
| C-52 | `task:background` and the tmux prefix | built | menu bar | P | med | S | yes | — |
| C-53 | The unbound families: `strip:*`, `proactivityMenu:*` and friends | undesigned | composer | X | low | none | yes | C-59 |
| C-54 | The file, its gating and its hot reload | out-of-scope | none | R | high | M | yes | owner |
| C-55 | Merge order, `null` unbinding and precedence | out-of-scope | none | R | high | S |  | C-54 |
| C-56 | `command:` bindings | out-of-scope | composer | R | med | S | yes | C-54, C-21 |
| C-57 | Validation and every warning string | out-of-scope | menu bar | R | med/high | M | yes | C-54, C-61 |
| C-58 | Reserved keys | out-of-scope | menu bar | T/R | med | S | yes | C-60 |
| C-59 | The 26 contexts and how a GUI honours them | undesigned | menu bar | R | high | M | yes | C-54 |
| C-60 | The default binding table and the macOS menu bar | built | menu bar | R | high | M | yes | C-51, C-52, C-34 |
| C-61 | `/keybindings` | undesigned | Settings | X | med | M | yes | C-57, C-59 |
| C-64 | The `keybindings-help` skill | undesigned | Settings | P | med | S | yes | C-54, C-61 |
| C-62 | The settings that change how the composer behaves | built | Settings | P/R | med | M | yes | C-06, C-31 |
| C-63 | Environment variables | built | composer | R/P/T/D | low/med | S | yes | C-33 |

## Lane D — decision dialogs (62 cards)

| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |
|---|---|---|---|---|---|---|---|---|
| D-01 | The dialog frame: no box, one rule, four chrome slots | built | decision card | P | med | S | yes | — |
| D-02 | Mounting mid-turn: a dialog opened during a turn keeps the prompt | superseded | timeline | T | med | S | yes | D-09 |
| D-03 | A dialog blocks input by unmounting the composer, not by disabling it | superseded | composer | T | low | S | yes | — |
| D-04 | The dialog store: a stack, `place: "under"`, `holdsTop`, and the 150 ms grace | undesigned | timeline | R | high | S | yes | D-01 |
| D-05 | Suppression: `progress → panel → draft → typing`, and the draft placeholder | undesigned | composer | T | high | M | yes | Composer, Timeline scroll anchor |
| D-06 | The keyboard-hint footer, its vocabulary, and the two scopes | undesigned | decision card | T | med | M | yes | D-01, menu bar |
| D-07 | The select list, multi-select and text input primitives | built | decision card | T/P | high | M | yes | D-01 |
| D-08 | When a dialog cannot open: the two failure strings | undesigned | decision card | X | med | S | yes | D-09 |
| D-09 | The dialog registry and the three mounts | built | channel banner | X | high | M | yes | D-01, D-04, D-26, D-38 |
| D-10 | The permission ask: dispatch, twelve kinds, and the generic `Tool use` dialog | built | decision card | P/R | high | M | yes | D-01, D-07 |
| D-11 | Bash command: the title variants, the description, and the destructive warning | built | decision card | R/D | high | S | yes | D-10, D-20 |
| D-12 | The asks that never happen: the read-only allowlist and the rules that pre-answer | undesigned | Settings | P/R | low | M | yes | D-21, lanes E/F settings |
| D-13 | PowerShell command | undesigned | decision card | R | low | S |  | D-11 |
| D-14 | File edit, create, overwrite and write: the four titles and the inline diff | built | decision card | R | high | M | yes | D-10, Files panel (Monaco) |
| D-15 | NotebookEdit | undesigned | decision card | R | med | M | yes | D-14, notebook viewer |
| D-16 | WebFetch and WebSearch: the `Fetch` dialog and the domain rule | built | decision card | R/P | med | S | yes | D-10, D-21 |
| D-17 | MCP tool asks, and the organisation ask ceiling | built | decision card | P/D | high | S | yes | D-21, `/mcp` browser (lane E) |
| D-18 | Agent, Skill and workflow asks, and the request-source badge | built | decision card | D/P | med | M | yes | D-21, Agents panel |
| D-19 | Browser and Monitor asks | undesigned | decision card | R | med | M | yes | D-21, Browser tab, Activity |
| D-20 | The decision-reason banner, the denial-limit disclosure and the auto-deny countdown | built | decision card | P/D | high | M | yes | D-25, Activity |
| D-21 | "Yes, and don't ask again": the consent rows, and where they file | built | decision card | P/R | high | S | yes | D-17, D-18 |
| D-22 | The footer: `escape to cancel`, `tab to amend`, and the explain pane that does not exist | undesigned | decision card | T | med | S/M |  | D-06, D-21 |
| D-23 | Escape, the answer branches, and `default_to_no` | built | decision card | R | high | S | yes | D-24 |
| D-24 | Feedback: the two placeholders, and the four strings the model sees | built | decision card | R/D/X | high | S/M | yes | D-23 |
| D-25 | Auto mode: the flagged allow, the denied notice, and what the model is told | undesigned | Activity | P/D | med | M/L |  | D-20, Activity view |
| D-26 | Entering plan mode: the `permission_enter_plan_mode` confirmation | undesigned | decision card | X/R | med | S |  | D-01, D-07, D-10 |
| D-27 | The plan-approval dialog: shell, empty plan, and proceed step | built | decision card | P/R | high | M | yes | D-01, D-07, markdown renderer |
| D-28 | Approval options and what each persists | built | none | P/R/D/X | high | M | yes | D-07, D-27, mode-availability signals |
| D-29 | The optional artifact-review step | undesigned | decision card | D/X | low | L | yes | D-27, Browser panel |
| D-30 | Editing the plan in the dialog, and the plan file | undesigned | panel:Files | P/T/R | high | M | yes | D-27, Files panel, Monaco |
| D-31 | `/ultraplan` and `ultraplan_choice` | undesigned | decision card | X | med | L | yes | remote sessions, Browser, Activity |
| D-32 | Teammate plan approval: lead and teammate sides | undesigned | Activity | X | high | L | yes | team wire, Agents panel, Activity |
| D-33 | The question dialog: header, option lists, the side-by-side previews | built | decision card | P/R/D | high | M | yes | D-07, D-34 |
| D-34 | Multi-select questions and the `Other` free-text row | built | decision card | R | high | S | yes | D-33, D-07 |
| D-35 | The timeout and away-from-keyboard auto-resolution (`askUserQuestionTimeout`) | undesigned | decision card | D | med | S | yes | D-33, Settings window |
| D-36 | Extended questions: `kind`, `placeholder`, numeric bounds | built | decision card | P | med | S/M | yes | D-33, launch-line seam |
| D-37 | Elicitation, form mode: the generated form and its field types | built | decision card | P/R | high | L | yes | D-07, C5 HostLinkRouter |
| D-38 | Elicitation, URL mode, and the `mcp_elicitation_waiting` dialog | built | decision card | P | high | S/M | yes | `supportedDialogKinds`, HostLinkRouter, Browser tab |
| D-39 | `elicitation_complete` and how an elicitation ends (accept / decline / cancel) | built | decision card | P | med | S | yes | D-38, ClaudeWire `SystemFrames` |
| D-40 | `refusal_fallback_prompt` | built | decision card | P | high | S | yes | D-01, `RetractionRegistry` |
| D-41 | `fable_overage_consent_prompt` | built | decision card | P/D | med | S | yes | D-40, Activity, Terminal tab |
| D-42 | Workspace trust | built | channel banner | X/D | high | S | yes | D-44 (same banner+sheet shape) |
| D-43 | The bypass-permissions disclaimer | designed | consent sheet | X | high | M | yes | §7.4 quiescent restart; `get_settings.effective` |
| D-44 | `.mcp.json` project MCP server approval | built | consent sheet | X | high | S | yes | D-42's banner; C4's local-settings writer |
| D-45 | Managed settings security | designed | channel banner | X | high | S/M | yes | SPEC 48 §2.9.4 record shape; D-42's handoff |
| D-46 | External CLAUDE.md includes | undesigned | channel banner | X | med | S | yes | D-42's global-config reader |
| D-47 | Plugin consent and the plugin hint | undesigned | decision card | X/R | low | S |  | a future plugin browser |
| D-48 | The API-key trust dialog | undesigned | channel banner | X | med | S | yes | §3 login-shell environment resolution |
| D-49 | Chrome install and computer-use approval | undesigned | decision card | X/R | low | L |  | outside v1 in practice |
| D-50 | `sandbox_network_access` | built | decision card | P | med | S | yes | D-01 title slot, D-21 persist row |
| D-51 | `lsp_recommendation` and `ide_onboarding` | out-of-scope | decision card | X | low | none | yes | — |
| D-52 | `goal_proposal` | undesigned | decision card | X | low | none |  | would need a wire change (outside this study) |
| D-53 | `peer_inbound_approval` and `remote_callout` | out-of-scope | none | X/P | low/med | M |  | owner's scope call on §3 |
| D-54 | `cloud_sync_*` | out-of-scope | none | X | low | none |  | — |
| D-55 | `auto_mode_setup_review` and the first-environment consent dialog | undesigned | Settings | X | med | S | yes | `get_settings.effective` poll; `PrecommitModel` handoff |
| D-56 | Worktree exit: keep or remove | out-of-scope | decision card | X/R | med | S | yes | Source Control panel; owner scope call |
| D-57 | `dialogExpiry` — the setting that ages dialogs out | built | decision card | P/D | med | S | yes | §8.6's existing poll |
| D-58 | Exit with running tasks or background work | built | sidebar | P | high | S | yes | registry mirror (task counts); §7.4 verbs |
| D-59 | The kill-agents confirmation | built | toast | D | med | S | yes | queue chip (§8.5); `perTaskStopAffordance` |
| D-60 | `/clear` while a prompt is queued | routed-only | decision card | R | low | S | yes | `conversation_reset` notice; composer history |
| D-61 | Logout | built | consent sheet | X | high | M | yes | §7.7 spawn barrier; roster; Activity |
| D-62 | The other users of the `Confirmation` keyboard scope | undesigned | none | T | low | S |  | D-06; routes two surfaces out of lane D |

## Lane E — panel commands: settings (56 cards)

| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |
|---|---|---|---|---|---|---|---|---|
| E-01 | Where Claude Code settings live inside afleet | undesigned | Settings | n/a | high | M | yes | C5 §9 Settings window |
| E-02 | The `/config` dialog shell: four tabs, search, footers, close record | undesigned | Settings | R | high | M | yes | E-01 |
| E-03 | The 28 rows that become afleet preferences (Settings → Claude Code → Defaults / Account) | undesigned | Settings | R | high | M | yes | E-01, E-02 |
| E-04 | The five dual rows: a per-channel value and a persisted default | built | channel header | P/R | high | S | yes | E-03, header pickers |
| E-05 | The 20 rows afleet supersedes (terminal rendering and terminal mechanisms) | superseded | Settings | R | med | S | yes | E-02 |
| E-06 | The 7 rows outside afleet's scope | out-of-scope | none | n/a | low | S |  | E-02 |
| E-07 | The `/config` sub-dialogs with no slash command of their own | undesigned | Settings | R | low/med | S | yes | E-03 |
| E-08 | The `/permissions` dialog shell: six tabs, the filter gesture, four footers | designed | Settings | X/R | high | L | yes | E-01, a rules model |
| E-09 | Rule rows, provenance, and the `Rule details` pane | undesigned | panel:Files | R/D | high | M | yes | E-08, `get_settings.sources[]` |
| E-10 | Add a new rule: the free-text editor and the destination picker | designed | panel:Files | P/D | high | M | yes | E-09, a project-scope file writer |
| E-11 | Deleting a rule, and the sources that refuse | undesigned | none | D | med | M |  | E-10 |
| E-12 | The `Recently denied` and `Auto mode` tabs | undesigned | Activity | R/D | med | S/M | yes | Activity view (lane D/G) |
| E-13 | The `Workspace` tab: working directories | designed | Settings | R/D | med | S | yes | E-35 for the editing half |
| E-14 | The server list: `Manage MCP servers` | built | Settings | P/D | high | S/M | yes | richer `MCPServerStatus` decode |
| E-15 | The per-server detail view and its action menu | undesigned | panel:Files | P/D/R | high | M | yes | E-14 |
| E-16 | Authentication: `needs-auth`, the OAuth flow, and clearing auth | undesigned | panel:Browser | P/X | high | M | yes | E-15, Browser panel |
| E-17 | `View tools`, and the resources and prompts the panel never shows | undesigned | composer | R | med | S | yes | E-15 |
| E-18 | The project `.mcp.json` approval — the one place afleet is already ahead | built | none | X | high | S | yes | — |
| E-19 | The `/hooks` viewer: four levels, read-only by design | undesigned | Settings | X/R | med | M | yes | E-01, disk read |
| E-20 | Hooks disabled, safe mode, policy — and the snapshot-reload trap | undesigned | channel banner | R/D/P | med/high | S | yes | E-19, channel banner |
| E-21 | The `/plugin` panel shell: five tabs | undesigned | Settings | X/R/P | med | M | yes | E-01 |
| E-22 | Discover, the plugin detail pane, and the install flow | undesigned | none | R | med | L | yes | E-21 |
| E-23 | The Installed tab: scopes, enable and disable, favourites, disuse | undesigned | none | P/R | med/high | M | yes | E-21, file writer |
| E-24 | The Marketplaces tab | undesigned | consent sheet | R | med | M | yes | E-21 |
| E-25 | The Errors tab | undesigned | Activity | P/R | high | S | yes | Activity view |
| E-26 | `/reload-plugins` | built | channel banner | P/D | med | S | yes | — |
| E-27 | `/cloud-plugins` | out-of-scope | none | X/R | low | S |  | — |
| E-28 | The `/model` picker | built | timeline | P/R/D | high | S/M | yes | `ModelOption` decode |
| E-29 | The `/effort` picker | built | none | X/P/D | high | S | yes | E-28 |
| E-30 | `/fast` | routed-only | channel header | P | med/high | S | yes | picker surface registry |
| E-31 | `/autocompact` | undesigned | channel header | P/X/D | med | S | yes | context meter (lane A) |
| E-32 | `/advisor` | undesigned | Settings | X/D | low/med | S | yes | probe |
| E-33 | `/powerup` and `/passes` | undesigned | composer | X/T | low | S |  | — |
| E-34 | `/sandbox` | undesigned | Settings | X/R/D | med/high | M | yes | `claude sandbox status` |
| E-35 | `/add-dir` | designed | Settings | X/R/P | high | S/M | yes | `HeaderLaunchSetting` cases |
| E-36 | `/cd` | designed | channel header | R/P | med/high | M | yes | trust dialog, `NSOpenPanel` |
| E-37 | `/skills` and the four override states | undesigned | Settings | X/R/P/D | high | M | yes | file writer, `reload_skills` |
| E-38 | `/reload-skills` and `/skill-doctor` | built | channel banner | P | med | S | yes | E-37 |
| E-39 | `/memory` | designed | panel:Files | X/R/T | high | M | yes | Files panel |
| E-40 | `/theme` | undesigned | Settings | X/R | med | M | yes | design system |
| E-41 | `/output-style` | built | channel header | P/R/D | high | S | yes | header picker row |
| E-42 | `/agents` | routed-only | Settings | P/D | high | M | yes | frontmatter parser |
| E-43 | `/login` | built | Settings | X/P | med | S | yes | — |
| E-44 | `/logout` | built | Settings | X | med | S | yes | — |
| E-45 | `/setup-bedrock` and `/setup-vertex` | undesigned | Settings | X | low | S |  | — |
| E-46 | `/privacy-settings` | undesigned | Settings | X | high | S | yes | channel banner |
| E-47 | `/usage-credits` and `/extra-usage` | undesigned | timeline | P/X | med | S |  | — |
| E-48 | `/rate-limit-options`, and the auto-continue gap | designed | channel banner | X/D/P | high | S/M | yes | `overlay.banners` wiring |
| E-49 | `/pro-trial-expired` and `/upgrade` | undesigned | Settings | X/R | low/med | S | yes | Account pane |
| E-50 | `/ide` | superseded | panel:Files | X/T | low | S | yes | — |
| E-51 | `/chrome` | out-of-scope | panel:Browser | X/R | low | S |  | — |
| E-52 | `/desktop` and `/mobile` | undesigned | Settings | X/T/R | low | S | yes | probe for `/desktop` |
| E-53 | `/teleport`, `/remote-control`, `/remote-env`, `/web-setup` | out-of-scope | none | X | low | S |  | — |
| E-54 | `/design-login` | undesigned | Settings | X | low | S |  | — |
| E-55 | `/install-github-app` | undesigned | panel:Browser | X | med | M | yes | GitHub panel (C7) |
| E-56 | `/daemon` | built | sidebar | X/R | low | S | yes | — |

## Lane F — panel commands: session (45 cards)

| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |
|---|---|---|---|---|---|---|---|---|
| F-01 | The `Status` tab, and `/status` | undesigned | popover | R/D | med | M | yes | E-01 (Settings section), F-02 |
| F-02 | The `Usage` tab: plan limits, session cost, and what is consuming the limit | routed-only | Settings | P/D/R | high | M | yes | Settings › Account & Usage; a limit chip host |
| F-03 | The `Stats` tab (`/stats`) | undesigned | Settings | D/R | low | S | yes | F-02's pane |
| F-04 | The `/context` grid | built | popover | P/R | high | M | yes | header meter (built), `get_context_usage` (called) |
| F-05 | The `/context` Suggestions block | undesigned | popover | D | med | S | yes | F-04 |
| F-06 | `/compact`, its progress display and its summary | routed-only | composer | P/D | med | S | yes | timeline row builders |
| F-07 | `/autocompact` — the setting behind the meter | undesigned | Settings | n/a | med | S |  | E's Settings pane; F-04's meter |
| F-08 | `/clear` | built | timeline | P | low | S | yes | `conversation_reset` reducer |
| F-09 | The Background dialog (`/tasks`) — the list | routed-only | panel:Agents | X/R/P/D | high | M | yes | lane G (Agents tab ownership) |
| F-10 | The task detail sub-views | undesigned | panel:Thread | R | med | M | yes | F-09 |
| F-11 | The Remote Control variant of the Background dialog | out-of-scope | none | P/D | low/high | S |  | F-09 |
| F-12 | `/background` and `/stop` | built | sidebar | X | med | S | yes | header menus (built) |
| F-13 | The `/help` dialog | undesigned | composer | R | high | M |  | composer `/` picker; keybinding table |
| F-14 | The lazy-dialog failure strings, and what a panel command does mid-turn | built | Settings | T | high | S | yes | every card in this lane supplies a destination |
| F-15 | Pass-through prompt commands (`/review`, `/security-review`, `/commit`, `/ultrareview`, `/autofix-pr`) | routed-only | timeline | P | med | S/M |  | lane B (tag stripping) |
| F-16 | Stacked commands | undesigned | composer | P | low | S | yes | F-15 |
| F-17 | Coordinator-mode refusals | undesigned | none | P | low | S |  | lane G |
| F-18 | The `/resume` picker — the list, its grouping and its three filters | routed-only | sidebar | R/X/P | high | M |  | tech-debt 207; session store (lineage) |
| F-19 | `/resume` search mode | built | none | R | med | S | yes | F-18 |
| F-20 | The `/resume` preview — `Space` and the full-screen transcript takeover | undesigned | sidebar | R | high | M | yes | timeline renderer; `transcript_mirror` |
| F-21 | `Ctrl+R` — rename a session from the picker | undesigned | sidebar | P | med | S |  | F-23's write path |
| F-22 | The resume host screen and its refusals | undesigned | channel banner | R | med | S | yes | sidebar Adopt/Attach (built) |
| F-23 | `/rename` | built | none | P | med | S | yes | F-21 |
| F-24 | `/branch` | undesigned | sidebar | R | med | M | yes | F-27 (branch from a message) |
| F-25 | `/fork` | built | none | X/P | low | S | yes | header menu (built) |
| F-26 | `/session`, `/recap`, and the `/tag` that is not a command | undesigned | sidebar | X/P/R | low/med | S | yes | window focus events |
| F-27 | The double-Escape gesture and the `Rewind` selector | built | channel header | X/R/D | high | M | yes | unblocked: `LaunchConfiguration.swift:151` sets the checkpointing flag; needs an owned-vs-adopted capability flag |
| F-28 | The per-row dry-run summaries | undesigned | none | R/P/D | high | M | yes | F-27 |
| F-29 | The restore choices and their consequence blurbs | built | none | R/X | high | M | yes | F-27, F-28; owned-vs-adopted flag; summarize pair unverified |
| F-30 | Rewind outcomes: prefill, skipped links, and the fork fallback | built | none | P | med | S | yes | `EditAndRewind.swift` |
| F-31 | Rewind refusals — the eight strings, and the four file errors | undesigned | none | P | med | S |  | F-29 |
| F-32 | `/diff` — two renderings, one command | undesigned | panel:Source Control | P/R/X/D | med | M | yes | `sourceControl` tab; lane B |
| F-33 | `/export` | undesigned | channel header | R | med | S |  | timeline renderer |
| F-34 | `/loops` | undesigned | Activity | X | low/med | M |  | F-35; lane G |
| F-35 | `/goal` | undesigned | composer | P/R/D/X | med | S |  | header readbacks; `active_goal` is D |
| F-36 | `/workflows` | undesigned | panel:Agents | X/D | med | L |  | **lane G** |
| F-37 | `/doctor` | undesigned | Settings | P | med | S |  | `RouterTable.terminalOnlyReasons` |
| F-38 | `/debug` | undesigned | popover | P | low/med | S | yes | F-01 popover |
| F-39 | The `/bug` dialog | undesigned | none | R/X/D | med | M |  | Help menu; `submit_feedback` |
| F-40 | The `/feedback` draft panel, the notice card and the footer counter | undesigned | timeline | R | med | M |  | §8.4 decision cards; F-39 |
| F-41 | `/release-notes` and the startup update notice | undesigned | sidebar | R/D | low/med | S | yes | `get_binary_version` |
| F-42 | `/upgrade` | undesigned | Settings | X | med | S |  | F-02's limit banner |
| F-43 | `/version` and `/wellbeing` — compiled in, switched off | superseded | popover | X | low | S |  | `get_binary_version` (defined, unused) |
| F-44 | `/init` and `/import` | undesigned | panel:Files | P/R | med | S/M | yes | E's Settings pane |
| F-45 | `/exit` | undesigned | sidebar | T | low | S |  | close-channel behaviour |

## Lane G — fleet and agents (61 cards)

| Card | Surface | afleet status | GUI region | Wire class | Value | Cost | Exceeds? | Depends on |
|---|---|---|---|---|---|---|---|---|
| G-01 | FleetView — the whole-screen multi-session list | superseded | sidebar | D/P/R | med | S | yes | G-03 (bands), G-07 (dock badge) |
| G-02 | The fleet row: naming chain and the six status words | built | sidebar | P/R | high | S | yes | registry mirror; `generate_session_title` |
| G-03 | The four bands, the group presentation, and the reserved headers | undesigned | sidebar | R | high | M | yes | G-02; the decision queue |
| G-04 | Fleet row actions: pin, reorder, rename, group, stop, delete | built | sidebar | P/X | med | M | yes | G-03 |
| G-05 | The fleet composer: filter, dispatch, templates, suggestions | built | composer | P | low | S | yes | quick switcher |
| G-06 | The peek pane | superseded | none | R | low | none | yes | — |
| G-07 | Fleet nudges — the band-transition notifications | designed | notification | D | high | M | yes | G-03; `App/Notifications/` |
| G-08 | The agents chip, `← opens agents`, and the `Agents` keyboard scope | superseded | sidebar | R | low | S |  | sidebar badges |
| G-09 | `claude agents --json` and the non-TTY refusal | designed | sidebar | R | med | M |  | root §9.5 |
| G-10 | The `Agent` call's row: launch, live progress, completion | built | timeline | P | high | M | yes | C6.1 row registry |
| G-11 | The backgrounded-agent variant and `↓ to manage` | built | panel:Agents | D/P/R | med | S | yes | G-24; task card |
| G-12 | Parallel-agent groups and the agent tree | built | timeline | R | med | S | yes | G-10; Y4 navigation |
| G-13 | Agent colour: the eight-name subagent palette | designed | none | R | low/med | S |  | agent definition parse |
| G-14 | Nested depth: what deeper agents render and what is forwarded | designed | panel:Agents | R | med | M | yes | **C6.4** |
| G-15 | Model-written progress summaries | designed | none | R/P | med | S | yes | `agentProgressSummaries`; a probe |
| G-16 | The completion notification and the result hand-back | built | timeline | D | high | S | yes | G-27 |
| G-17 | Parking, keepalives, and the "resumed by the user" notice | designed | panel:Agents | D | med | M | yes | **C6.4** |
| G-18 | Fork agents: `/fork`, `/subtask` and the `⑂` marker | designed | sidebar | T | med | M |  | channel spawn |
| G-19 | `subagentStatusLine` | undesigned | none | R | low | M | yes | lane A's status line |
| G-20 | A permission ask raised by a subagent | built | timeline | R | high | S/M | yes | **C6.4**; lane D's card frame |
| G-21 | The Agents panel: the audit against §8.8 | designed | panel:Agents | P/R/D | high | L |  | **C6.4** (unblocked, undispatched) |
| G-22 | The background chip in the footer | built | channel header | R | med | S | yes | registry mirror |
| G-23 | The run-in-background hint | undesigned | none | D | med | S | yes | G-24 |
| G-24 | `ctrl+b` / `task:background` — background *everything* | built | channel header | D/P | med | S | yes | X5 actions |
| G-25 | The live preview under a running background shell | designed | timeline | D/R | high | M | yes | output-file path (already parsed) |
| G-26 | The background notice in the tool result | built | panel:Agents | P | med | S | yes | G-25 |
| G-27 | The task-notification row in the transcript | built | notification | D | high | S | yes | reducer |
| G-28 | `TaskOutput` | undesigned | none | P/D | low | S | yes | reducer must watch `task_updated` |
| G-29 | `Monitor` rows | undesigned | none | D | low | M | yes | G-25 |
| G-30 | The interactive-prompt stall watchdog | undesigned | timeline | D | high | S | yes | G-25; Activity |
| G-31 | Stopping: `TaskStop`, per-task stop, and stop-all | built | none | P | med | S | yes | X5; `perTaskStopAffordance` |
| G-32 | `/background` and the backgrounded banner | designed | none | n/a | low | S | yes | header menu |
| G-33 | The OSC 9;4 progress indicator | undesigned | Settings | R | med | S |  | registry mirror |
| G-34 | The Remote-Control `/tasks` variant — the constraint afleet lives under | built | timeline | n/a | med | S | yes | task card |
| G-35 | The persisted task list and its record | undesigned | panel:Thread | R | med/high | M | yes | `CLAUDE_CODE_ENABLE_TODO_TOOLS` |
| G-36 | The `ctrl+t` task panel | undesigned | panel:Thread | R | med/high | M |  | G-35 |
| G-37 | `activeForm` and the spinner's fallback ladder | built | none | R | low | S | yes | lane A's spinner |
| G-38 | The periodic task reminders | undesigned | Settings | n/a | low | S |  | G-36 |
| G-39 | Teammates: what they are and whether afleet can see them | undesigned | panel:Agents | D | low | S |  | G-21 |
| G-40 | The teammate message row | undesigned | timeline | D | low | S |  | G-49 |
| G-41 | Teammate lifecycle frames and their panels | undesigned | decision card | D | low | S |  | G-27 |
| G-42 | `/list-agents` — the roster listing | designed | sidebar | D | med | S | yes | G-09 |
| G-43 | Coordinator mode | undesigned | channel banner | n/a | med | S | yes | channel spawn |
| G-44 | The `ultracode` veto (`alt+w`) | undesigned | composer | n/a | med | M | yes | composer; a probe |
| G-45 | The workflow phases view, live | undesigned | timeline | R | med/high | M | yes | registry mirror; a probe |
| G-46 | The teammate mode-change warning | undesigned | channel header | T | med | S |  | G-21 |
| G-47 | The registry record and presence: `status`, `waitingFor`, `tempo` | designed | sidebar | D | high | S |  | G-02, G-61 |
| G-48 | `ListAgents`, the roster, and what a listing says | designed | sidebar | D | med/high | S | yes | G-09 |
| G-49 | `SendMessage`: what the sender sees | designed | timeline | P/R | med/high | S | yes | **C6.4** |
| G-50 | The inbound cross-session message | built | timeline | P | med | S | yes | `PeerMessageItem` |
| G-51 | Held messages and `crossSessionInbound` | undesigned | decision card | D | high | M | yes | lane D's card frame |
| G-52 | The daemon: `/daemon`, `claude daemon status`, and the hub | designed | Settings | X | low/med | S |  | C5 §9 |
| G-53 | Job attach and detach | designed | panel:Terminal | X | med | M | yes | C7.4 |
| G-54 | `/remote-control` — the status card | undesigned | Settings | P | med/high | M | yes | own consent card |
| G-55 | The `/rc` pill and the `bridge_status` line | undesigned | channel header | P | med | S |  | lane A's A-13 cluster |
| G-56 | Bridge failure, disconnection, and attestation drops | undesigned | channel banner | P | med | S | yes | channel banner |
| G-57 | Remote provenance, `/mobile` and `/desktop` | undesigned | notification | P | med | S |  | G-50 |
| G-58 | The notification kinds that exist to report on *other* work | built | notification | D | high | M | yes | `App/Notifications/`; presence file |
| G-59 | `away_summary` — not a notification | undesigned | Activity | D | high | M/L |  | Activity; registry |
| G-60 | Channel-sourced messages | built | timeline | P/D | med | M | yes | G-50; launch line |
| G-61 | Terminal tab status and session colour, as sidebar cues | built | sidebar | T | high | S | yes | G-47 |
