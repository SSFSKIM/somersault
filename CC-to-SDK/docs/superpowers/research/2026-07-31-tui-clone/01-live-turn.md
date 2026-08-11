# W4 research — the live turn: tool-call and tool-result rendering

Reference: `~/claude-code-bundle/2.1.220/cli.pretty.js` (579,698 lines). Every line number below is
from that file. Ours: `CC-to-SDK/harness/src/tui/{liveTurn.ts,render.ts,Transcript.tsx,useChat.ts}`.

Conventions used throughout:
- `Za` = the bullet glyph, **`⏺` (U+23FA) on macOS, `●` (U+25CF) elsewhere** — line 41484:
  `Za = Pt() === "macos" ? "⏺" : "●"`.
- `Cr` = the result-gutter wrapper (line 406888). It renders a **dim** leading element whose text is
  `["  ", "⎿ \xA0"]` — two spaces, `⎿`, a space, a non-breaking space = **5 columns** — as a
  *sibling flex element*, with the content in its own `flexGrow` column beside it. So the `⎿`
  appears **once**, on the first line, and every wrapped/subsequent line of the result is indented to
  column 5. `Cr` accepts `height`, and when given it also sets `overflowY:"hidden"` (so a
  `height:1` result is hard-clipped to one row). Nested `Cr` inside `Cr` degrades to bare children
  (context `BEr`), so nested renderers never double-gutter.
- `Et(e, t, r = t + "s")` (line 15084) — the pluralizer: `e === 1 ? t : r`.
- `Bg` (line 421333) — a dim `(ctrl+o to expand)`. It is built from the live keybinding table
  (`app:toggleTranscript`, Global, fallback `ctrl+o`) through `$e` (line 183855), which renders
  `("(" + chord + " to " + action + ")")` when `parens` is set. **`Bg` returns `null` inside the
  transcript/verbose contexts** — the hint is only shown where expanding is possible.
- `ra(ms)` (line 107033) — duration: `<60s` → `"12s"` (floored); else `"3m 4s"` / `"1h 2m 3s"` /
  `"1d 2h 3m"`. `_d(n)` (line 107091) — `Intl` compact, lowercased: `"12.4k"`.
- `wd(path)` (line 36791) — cwd-relative if inside cwd, else `~`-prefixed if under `$HOME`, else
  absolute.

---

## Q1 — Per-tool result rows

The result row is produced by `tool.renderToolResultMessage(output, progressMessages, ctx)` and
wrapped in `Cr` (the `⎿` gutter). The name→renderer registry is `Mya`, lines **430977–431001**.
Most renderers wrap themselves in `Cr` with `height:1`, i.e. **one line, hard-clipped**.

### Read (module at 424394; result renderer `dbH` at 424415)

Discriminated on the result's `type`:

| `type` | Literal | Line |
|---|---|---|
| `text` | `Read `**`{numLines}`**` line` / ` lines` | 424434 |
| `notebook` | `Read `**`{cells.length}`**` cells` (no singular form here); empty → `No cells found in notebook` in `color:"error"` | 424424–424426 |
| `image` | `Read image (`*humanSize*`)` | 424419 |
| `pdf` | `Read PDF (`*humanSize*`)` | 424429 |
| `parts` | `Read `**`{count}`**` page`/` pages` ` (`*humanSize*`)` | 424432 |
| `file_unchanged` | dim `Already in context ({basename})` when `source === "seeded"`, else dim `Unchanged since last read` | 424437 |

Counted number: **lines of file text actually returned** (`numLines`), cells, pages, or bytes.
Pluralization: `count === 1 ? "line" : "lines"` (explicit ternaries, not `Et`).
Bolded: the number only.

Errors (`pbH`, 424446), non-verbose: `File not found` (error color) when the message contains the
not-found sentinel `goe`; else `Error reading file`; else fall through to the generic `UP`.

### Write (module 424184; `lbH` at 424341)

- `type: "create"`:
  - plan-mode target path, not verbose, style ≠ `condensed` → dim `/plan to preview` (424345)
  - style `condensed`, not verbose → `Wrote `**`{N}`**` line`/`lines` ` to `**`{relativePath}`** (424349)
  - not verbose and the path is a scratchpad/jobs path (`aHr`, line 371190) → `Wrote `**`{N}`**` `*line/lines* ` (ctrl+o to expand)` (424357)
  - otherwise → a syntax-highlighted preview of the content, first `C8o = 10` lines
    (`jme`, 423783; the constant at 423857), followed by `bM({count: totalLines - 10})` → dim
    `… +{N} lines`
- `type: "update"` → the diff renderer `fbn` (below)

`N` counts newline-delimited lines of the written content (`bbn`, 424186: split on `\n`, minus one
if the content ends with `\n`). Errors (`abH`, 424336): `Error writing file`.

### Edit (module 424057; `VHH` at 424065) and the shared diff renderer `fbn` (423885)

The summary line, computed from the `structuredPatch` hunks:

```
Added {bold N} line|lines, removed {bold M} line|lines
```

- `Added …` is emitted only when N > 0; the removed clause only when M > 0 (423889, 423895).
- The separator between them is the literal `", "` (423893).
- **Capitalization is positional**: the removed clause starts `gXe === 0 ? "R" : "r"` + `"emoved "`,
  i.e. `Removed 3 lines` standalone, `Added 2 lines, removed 3 lines` together (423895).
- **Pluralization here uses `> 1`, not `Et`**: `gXe > 1 ? "lines" : "line"` — so `1` → `line`,
  `≥2` → `lines`. Same for removed.
- The counts are per-line `+`/`-` counts summed across hunks (`NHH`/`FHH`, 423879–423884).

Under the summary, the full colored hunk body renders at width `columns - 12` (423944, `K3e`).
Three collapse variants (423903–423926):
- `previewHint` set (plan-mode file) and not condensed/verbose → *only* the dim hint, e.g.
  `/plan to preview`
- style `condensed` and not verbose → *only* the summary line
- `collapsed` (scratchpad path) and not verbose and N+M > 0 → summary line + `(ctrl+o to expand)`

Errors (`KHH`, 424071): `File must be read first` (dim) when the error mentions
"File has not been read yet"; `File not found`; else `Error editing file`.

**MultiEdit does not exist in 2.1.220.** There is no `= "MultiEdit"` anywhere in the bundle. The
multi-edit shape is an `edits: [...]` array on the *Edit* tool (see `zHH`, 424073, which branches on
`"edits" in e`).

### Bash (module 423512; result `_HH` → `r4e` at 423453)

`r4e({stdout, stderr, isImage, returnCodeInterpretation, noOutputExpected, backgroundTaskId}, timeoutMs)`:

- `isImage` → dim `[Image data detected and sent to Claude]` (423470)
- stdout → `p2({content, verbose})`; stderr (after stripping `<sandbox_violations>` and a
  `Shell cwd was reset to …` trailer) → `p2({content, verbose, isError:true})` (color `error`)
- a captured `Shell cwd was reset to …` renders as its own dim line
- **empty output** → exactly one dim line, in priority order (423487):
  `Running in the background (↓ to manage)` when `backgroundTaskId` · else `returnCodeInterpretation`
  · else `Done` when `noOutputExpected` · else `(No output)`
- `timeoutMs` present → a trailing dim `(timeout 2m)` (`eRe`, 416953)

PowerShell's variant (`SbH`, 424569) is identical except it also has the literal `Interrupted` for
`interrupted === true`.

**`p2` (420173) is the generic output body and the single most important truncation rule.**
Non-verbose it calls `y_s(content, columns, isTranscript)` (186474):
- wrap width = `max(columns - w9u, 10)` where `w9u = 10` (186523)
- keep the first **`Sut = 3`** wrapped lines (186523)
- special case: if exactly **one** line would be hidden, show 4 lines and hide none (186467)
- then append a dim line `… +{N} lines (ctrl+o to expand)` — built by `Bst(n, "line")` (107148),
  which returns `` `… +${e} ${Et(e, t)}` ``; the ` (ctrl+o to expand)` suffix is added by `y_s`
  unless in transcript mode (186490)
- the whole thing is pre-clipped to `Sut * width * 4` characters before wrapping

So the default Bash/MCP/etc. result is **3 lines then `… +47 lines (ctrl+o to expand)`**.

### Grep and Glob — one shared renderer `ola` (421541), errors `nla` (421534)

Both use `$Wo` (421481), whose text is:

```
Found {bold N} {label}[ across {bold M} {label2}]  (ctrl+o to expand)
```

| Grep `output_mode` | Call | Rendered |
|---|---|---|
| `content` | `$Wo(numLines, "lines")` | `Found 12 lines` |
| `count` | `$Wo(numMatches, "matches", numFiles, "files")` | `Found 12 matches across 3 files` |
| `files_with_matches` (default) and **all of Glob** | `$Wo(numFiles, "files")` | `Found 3 files` |

**Pluralization rule here is unusual** (421488): `count === 0 || count > 1 ? label : label.slice(0, -1)`
— the label is stored plural and the trailing `s` is *stripped* for exactly 1. So `0` renders
`Found 0 files`, `1` renders `Found 1 file`.
`(ctrl+o to expand)` is appended only when `count > 0` (421515).
Verbose form: a `⎿` prefix line plus the raw match content indented `marginLeft: 5`.
Errors: `File not found` or `Error searching files`.

### Task / Agent (module 429533; result `Vha` at 429608)

| Result `status` | Rendered | Line |
|---|---|---|
| `remote_launched` | `Cloud agent launched` + dim ` · {taskId} · {sessionUrl}` | 429611 |
| `async_launched` | `Backgrounded agent` + dim ` (↓ to manage · ctrl+o to expand)` | 429615 |
| `completed` | `Done ({toolUses} · {tokens} tokens · {duration})` + a trailing dim `  (ctrl+o to expand)` | 429620–429622 |

The `completed` text is assembled at 429620:
`` `Done (${[l === 1 ? "1 tool use" : `${l} tool uses`, _d(c) + " tokens", ra(a)].join(" · ")})` ``
— so `Done (7 tool uses · 24.1k tokens · 1m 12s)`.
**CORRECTED 2026-08-04 (F3 Task 7 review, direct bundle read of `Vha` L429640–429654):** the earlier
claim here that this is "rendered with the standard `⏺` bullet, not as a `⎿` row" is WRONG. All three
result rows (`remote_launched`, `async_launched`, `completed`) render inside `Cr height:1` — the
standard `⎿` gutter — and the completed one wraps its synthetic message with `shouldShowDot: false`
(no bullet), followed by a SIBLING dim `  (ctrl+o to expand)` line, compact mode only. Also verified:
`_d` sets `minimumFractionDigits: 1` at ≥1000 (`12.0k`), and `status !== "completed"` returns null.

Progress, while the agent runs (`RXe`, 429702):
- no progress messages yet → dim `Initializing…` (`KVp`, 429822)
- terminal too short (rows < `toolCallCount * fTH + mTH`) → dim
  `In progress… · {bold N} tool`/` uses`[` · 24.1k tokens`]` · (ctrl+o to expand)` (429708)
- otherwise the **last `zVp = 3`** inner rows rendered condensed, then
  `bM({count: hidden, unit: "tool use", expandable: true})` → dim `… +5 tool uses (ctrl+o to expand)`
  (429740)

### WebFetch (421897/421900)

Progress: dim `Fetching…`. Result: `Received {bold humanSize} ({code} {codeText})`, e.g.
`Received 42.1 kB (200 OK)`. Verbose additionally dumps the extracted result body.

### WebSearch (421919/421935)

Progress: dim `Searching: {query}` then dim `Found {N} results for "{query}"`.
Result: `Did {N} search` + `es` when `N !== 1` + ` in {duration}` where duration is
`` `${Math.round(s)}s` `` when ≥1s else `` `${Math.round(s*1000)}ms` `` (421936).
So: `Did 3 searches in 4s`, `Did 1 search in 820ms`.

### TodoWrite — **renders nothing at all**

Definition at 284495–284516: `userFacingName() { return "" }` and
`renderToolUseMessage() { return null }`, and there is **no entry for `F5` in the `Mya` registry**.
The tool-use row renderer bails on an empty user-facing name (`if (Hvr === "") { g_t = null; … }`,
424743). The todo list is surfaced only through the separate todo panel (`ctrl+t`).

### NotebookEdit (module 424506)

Has `renderToolUseMessage`/`renderToolResultMessage`/rejection, but the rejection form
(`oda`, 424456) is the only one I read in full: `User rejected {mode} cell in ` +
bold relative path + ` at cell {cell_id}`, with the new source rendered as highlighted code.
Result-row template: **not determined** (I did not read `_bH`).

### BashOutput

There is no `BashOutput` tool name in 2.1.220. The equivalent is **`TaskOutput`** (`bee`, module at
430708, result `JwH` → `wKp` at 430721):
- no task → dim `No task output available`
- `local_bash` → routed through the Bash result renderer `r4e`
- `local_agent`, retrieved OK, non-verbose → dim `Read output (ctrl+o to expand)` (430789)
- `local_agent`, retrieved OK, verbose → `{description} ({N} lines)` + prompt + response + error block
- still running / not ready → dim `Task is still running…`; else dim `Task not ready`
- `remote_agent` → `  {description} [{status}]`, and non-verbose with output → dim
  `     (ctrl+o to expand)` (430830)

Progress (`XwH`, 430714): the task description on one line, then
`     Waiting for task (esc to give additional instructions)`.
Tag (`YwH`, 430710): a dim ` {task_id}` suffix on the tool row.

### Others worth having

| Tool | Result literal | Line |
|---|---|---|
| Skill | `Successfully loaded skill` [` · {N} tool`/`tools allowed`] [` · {model}`], dot-joined; or `Done` / `Running in the background` when `status === "forked"` | 430872 |
| TaskStop | `{command, ≤2 lines / ≤160 chars}…` + ` · stopped` (`… · stopped` when truncated, ` · stopped` when not) | 421886 |
| EnterPlanMode | a plan-colored `⏺` + ` Entered plan mode`, then indented dim `Claude is now exploring and designing an implementation approach.` | 421946 |
| EnterPlanMode rejected | `⏺ User declined to enter plan mode` | 421950 |
| EnterWorktree | `Switched to worktree on branch {bold branch}` + dim path | 421954 |
| ExitWorktree | `Kept worktree` / `Removed worktree` [` (branch {bold b})`] + dim `Returned to {cwd}` | 421958 |
| LSP | `Found {bold N} {definitions\|references\|symbols\|callers\|callees\|call items\|implementations}` [` across {bold M} files`], or `Hover info available` | 421551, table at 421601 |
| ListPlugins/ListSkills/Search* | a shared `makeResultCountRenderer("plugin"\|"skill")` | 431001 |

### The generic error/result fallback `UP` (421420)

Used whenever a tool has no `renderToolUseErrorMessage`. Message normalization:
1. non-string result → `Tool execution failed`
2. strip `<sandbox_violations>…</sandbox_violations>` and `<error>` tags, trim
3. non-verbose and contains `InputValidationError: ` → `Invalid tool parameters`
4. already starts with `Error: ` or `Cancelled: ` → verbatim
5. otherwise → `` `Error: ${msg}` ``

Rendered in `color:"error"`, clipped to `SHn = 10` lines (421434, constant at 421358), then
`bM({count: lines - 10, expandable: true})` → dim `… +{N} lines (ctrl+o to expand)`.

---

## Q2 — Collapsing of consecutive tool calls

The previous pass's finding is **substantially right but the clause list and the "what breaks it"
rule are both wider than reported, and there are two independent collapsing mechanisms.**

### The pipeline (line 456906)

```
raw messages → bdf(...)  → PMd(...) → ydf → hdf → yMd
               grouped_    collapsed_
               tool_use    read_search
```

Plus a third, `NMd` (302354), used only for **brief mode** (`ctrl+shift+b`, `app:toggleBrief`).

### Mechanism A — `grouped_tool_use` (`bdf`, 452545)

Groups **≥2 tool_use blocks with the same tool name inside the same assistant API message**
(key `` `${message.id}:${tool.name}` ``, 452555), and only for tools that declare a
`renderGroupedToolUse`. In 2.1.220 that is the Agent/Task tool. Their `tool_result` user messages are
absorbed into the group. This is what produces parallel-agent rows.

Rendered by `Xha` (429745). Header, next to the animated status glyph:
- all resolved and every agent is async → `{bold N} background agents launched` + dim `(↓ to manage)`
- all resolved → `{bold N} ` + (`{Type} agents` when all share one non-default type, else `agents`) + ` finished`
- otherwise → `Running {bold N} ` + `{Type} agents`/`agents` + `…`
- plus `(ctrl+o to expand)` unless every agent is async
Then one `jla` row per agent.

### Mechanism B — `collapsed_read_search` (`PMd`, 302172) — the default-screen collapse

Per-message reducer over the transcript. The accumulator is created by `IMd` (302115) and finalized
by `ke_` (302123).

**What is collapsible** — `VFt(name, input, tools)` at 301895:

| Condition | Flags |
|---|---|
| `REPL` | collapsible, `isREPL` (unless a runtime flag `W2e()` is set) |
| Write/Edit whose path is an auto-managed memory path | collapsible, `isMemoryWrite` |
| Write/Edit whose path is a scratchpad path | collapsible, `isScratchpadWrite` |
| `ToolSearch` (under flag `ds()`) | collapsible, **`isAbsorbedSilently`** — counted nowhere, contributes no clause |
| any MCP tool (`isMcp`) | collapsible, records `mcpServerName` |
| a tool whose `isSearchOrReadCommand(input)` returns any of `isSearch`/`isRead`/`isList` | collapsible with that flag |
| `Bash`/`PowerShell` (`$Z = [ri, Vi]`, line 112934) under flag `ds()` | collapsible, `isBash` |
| everything else | **not collapsible** |

`isSearchOrReadCommand` implementations: Glob → `{isSearch:true}` (220176); Grep → `{isSearch:true}`
(220297); Read → `{isRead:true}` (307640); Bash/PowerShell classify the command text
(`Kr_`, 306129) — every non-ignored word-0 must be in one of these sets or the whole command is
uncollapsible (306395):

```
search : find grep rg ag ack locate which whereis
read   : cat head tail less more wc stat file strings jq awk cut sort uniq tr
list   : ls tree du
ignored: echo printf true false :
```

**Edit and Write on ordinary paths are NOT collapsible** — they break the group and render as normal
tool rows.

**What starts / extends / breaks a group** (302172–302282):

- **starts / extends** — a tool_use assistant message (or a `grouped_tool_use`) whose classification
  is non-null, i.e. collapsible or REPL. Counters bump; the message is stashed in the group.
- **extends** — a user message whose `tool_result` blocks **all** have `tool_use_id`s already in the
  group (`Te_`, 302043). Its `is_error` ids are recorded (they turn the group's glyph red).
- **extends** — a `system`/`stop_hook_summary` with `hookLabel === "PreToolUse"`, and a
  `relevant_memories` attachment, but only if the group is already non-empty.
- **extends** — an assistant message whose *first* content block is non-empty `thinking`
  (`Ae_`, 302029). Contributes `thoughtForMs` (wall clock between timestamps, capped at
  `rRo = 600000` ms per gap) and `latestThinkingSummary`.
- **defers** — thinking/`redacted_thinking`, **any** attachment, **any** system message
  (`RMd`, 302019), and an assistant message whose first block is the `(no content)` /
  `No response requested.` sentinel (`YFs`, 302012). These are buffered and re-emitted immediately
  *after* the group flushes, so they don't break it.
- **breaks (flush + emit standalone)** — a `queued_command` prompt attachment (`OMd`, 302267), and
  the final `else`: **any assistant text message, any user message that isn't a matching tool_result,
  and any non-collapsible tool call.**

**What each number counts** (`ke_`, 302123):

- `readCount` = `readFilePaths.size` if any paths were captured, else `readOperationCount`, minus
  memory reads and team-memory reads. **Deduplicated by path** — reading the same file three times
  counts once. `readOperationCount` (raw call count) is the fallback for reads with no path, e.g.
  Bash `cat`.
- `searchCount` = raw count of search tool uses, minus memory searches and team-memory searches.
  **Not deduplicated.**
- `listCount` = raw count of `isList` calls.
- `replCount` — **hardcoded to 0 in `ke_`** (302123), so the REPL clause never appears in the
  default-screen collapsed group; it only appears via `nRo` (below).
- `mcpCallCount`, `scratchpadWriteCount` (+ lines added/removed), memory counts, and — gated on the
  runtime flag `ds()` — `bashCount`, `gitOpBashCount`, and structured `commits`/`pushes`/`branches`/`prs`.

**Clause templates and order** — `Ima` (427895). Clauses are pushed by a helper `we(key, verb, object)`
at 427989: the **first** clause upper-cases the verb's first character, every later one stays
lower-case, and clauses are joined by a literal `", "` Text node. All counts are bold.
`isActiveGroup` (`s`) selects present participle vs past tense.

| # | Condition | Running | Done | Object | Line |
|---|---|---|---|---|---|
| 1 | thinking | `Thinking for {bold dur}` | `Thought for {bold dur}` | — | 427997 |
| 2 | `editFileCount` | `editing` | `edited` | `{bold N} file`/`files {+A/-R}` | 428013 |
| 3 | `scratchpadWriteCount` | `making` | `made` | `{bold N} scratchpad edit`/`edits {+A/-R}` | 428015 |
| 4 | commits | `committed` / `amended commit` / `cherry-picked` | same | `{bold shas}` | 428017 |
| 5 | pushes | `pushed to` | same | `{bold branches}` | 428025 |
| 6 | branches | `merged` / `rebased onto` | same | `{bold ref}` | 428029 |
| 7 | PRs | `created`/`edited`/`merged`/`commented on`/`closed`/`marked ready`/`marked draft`/`enabled auto-merge on`/`disabled auto-merge on` | same | `PR #{n}` (a link when a URL is known) | 428034 |
| 8 | `frameCount` | `publishing` | `published` | — | 428039 |
| 9 | `searchCount` | `searching for` | `searched for` | `{bold N} pattern`/`patterns` | 428041 |
| 10 | `readCount` | `reading` | `read` | `{bold N} file`/`files` | 428043 |
| 11 | `listCount` | `listing` | `listed` | `{bold N} directory`/`directories` | 428045 |
| 12 | `replCount` | `REPL'ing` | `REPL'd` | `{bold N} time`/`times` | 428047 |
| 13 | `mcpCallCount` | `calling` | `called` | `{serverNames}` [` {bold N} times`, only when N > 1] | 428049 |
| 14 | `agentCount` | `running` | `ran` | see below | 428053 |
| 15 | `otherToolCount` | `calling` | `called` | `{bold N} tool`/`tools` | 428064 |
| 16 | `bashCount − gitOpBashCount` | `running` | `ran` | `{bold N} shell command`/`commands` | 428066 |
| 17 | `memoryReadCount` | `recalling` | `recalled` | `{bold N} memory`/`memories` | 428068 |
| 18 | `memorySearchCount` | `searching` | `searched` | `memories` (no count) | 428070 |
| 19 | `memoryWriteCount` | `writing` | `wrote` | `{bold N} memory`/`memories` | 428072 |
| 20 | team-memory (appended after the list, `lma` at 427609) | `recalling`/`searching`/`writing` | `recalled`/`searched`/`wrote` | `{bold N} team memory`/`memories`, `team memories` | 427609 |

The agent clause has three shapes (428053–428062): if exactly one agent and it's not backgrounded and
its description conjugates cleanly, the description itself becomes the clause via `s8p` (427477) —
**a real English verb conjugator** with irregular tables (`write→wrote→writing`, `run→ran→running`,
…, 427506) — so `"review the auth flow"` renders as `Reviewing the auth flow` then
`Reviewed the auth flow`. Otherwise `ran agent · {bold description}`, else `ran {bold N} agent`/`agents`.

**Rows 2, 8, 14, 15 (`editFileCount`, `frameCount`, `agentCount`, `otherToolCount`) are only ever
populated by `kMd` (302548), which is called from `NMd` — brief mode.** On the default screen they
are always zero, so `edited N files`, `ran N agents`, `called N tools`, `published` do **not** appear
there. This corrects the earlier pass if it implied otherwise.

**Layout of the collapsed row** (428062):
```
[glyph, 2 cols]  <clauses>  [ · {bold elapsed}]  [… when active]  (ctrl+o to expand)
                 ⎿  <latest display hint>          ← only while active
```
- the whole clause Text is `dimColor={!isActiveGroup}` — a **finished group is entirely dim**, an
  active one is normal-weight with a blinking glyph.
- active groups append a literal `"…"` (428062).
- an elapsed suffix ` · {bold ra(ms)}` appears once the group's oldest unresolved tool has been
  running **≥ 2000 ms** (`V8p`, 428106).
- `(ctrl+o to expand)` is always the trailing element.
- **Counts are latched to their max** via refs (427898): `w/k/L/x/R.current = max(current, value)` for
  read/search/list/mcp/bash — so the numbers never decrease as messages re-group mid-turn.

**The hint line.** While active, a second row `  ⎿  {hint}` (5-column gutter) shows what is happening
right now (427905–427930): the current file path via `wd()`, or `"{pattern}"` for a search, or
`$ {command}` (`KFs`, 301883 — whitespace-collapsed, prefixed `$ `, capped at `wMd = 300` chars with
`…`), or MCP progress as `{message} ({pct}%)` / `Processing… {n}`. It is throttled to at most one
change per **`MAH = 700` ms** (`e8p`, 427401). If a thinking summary is available it wins for
**`DAH = 3000` ms** and renders dim+italic, truncated to `PAH = 10` wrapped lines (427936, constants
at 428193).

### Mechanism C — the spinner / agent-summary string builder `nRo` (302588)

A *separate*, string-only implementation of the same idea, used by the status spinner (`oRo`, 302623)
and by the Agent progress rows (429735). Same verbs, narrower clause set, and it appends a literal
`…` when running:

```
[Recalled N memories, ][Searched memories, ][Wrote N memories, ]
[Searched for N patterns, ][Read N files, ][Listed N directories, ][REPL'd N times]
```
plus the team-memory clauses from `vMd` (301839). Joined with `", "`, first clause capitalized,
`…` suffix when running (302610). `oRo` only uses it when the **last ≥2 activities** were all
search/read; otherwise it falls back to the most recent `activityDescription`.

---

## Q3 — In-flight rendering

### The status glyph `ile` (422343)

```js
jsx(Box, { minWidth: 2, children: jsx(Text, {
  "aria-label": isError ? "tool error:" : "tool:",
  color:    isUnresolved ? undefined : isError ? "error" : "success",
  dimColor: isUnresolved,
  children: (!shouldAnimate || phase || isError || !isUnresolved) ? Za : " " }) })
```

| State | Glyph | Color |
|---|---|---|
| running (unresolved) | `⏺`/`●`, **blinking** — replaced by a space on alternate phases | no color, `dimColor: true` |
| finished | `⏺`/`●` steady | theme `success` |
| errored | `⏺`/`●` steady | theme `error` |
| queued (permission not yet granted, not started) | `⏺`/`●` steady | `dimColor: true`, plain Text, no animation (424748) |

The blink period is **`jyH = 600` ms** — `e5p` (422335) computes `floor(elapsed / 600) % 2 === 0`.
Animation is suppressed under a reduced-motion check (`Ea()`). The glyph box is `minWidth: 2`, so the
row always starts at column 2. There is no separate spinner character on a tool row — **the bullet
itself is the spinner**.

`ile` also fires a terminal bell (`G3t()`) when a tool that was unresolved for more than
`Z4p = 5000` ms resolves (422348).

### The body under a running row (424780)

```
!resolved && ( pendingPermission ? dim "Waiting for permission…"
             : queued            ? tool.renderToolUseQueuedMessage()
             :                     tool.renderToolUseProgressMessage(progress, ctx) )
```
Bash's queued form is dim `Waiting…` (423584); its progress form with no data yet is dim `Running…`
(423579). With data (`Dyt`, 417004): the **last 5 lines** of output, dim, inside a fixed
`height: 5` `overflow: hidden` box, then a dim `~{totalLines} lines` (when byte totals are known) or
`+{totalLines - 5} lines`, then the elapsed indicator `({elapsed})` / `({elapsed} · timeout {t})`
(`eRe`, 416953).

### Failure

There is no per-row `✗`. Failure is expressed three ways:
1. the glyph turns `error`-colored (above),
2. the result body is the tool's `renderToolUseErrorMessage` or `UP`, rendered in `color:"error"`,
3. for a collapsed group, `isError` on the group glyph if any absorbed `tool_result` had `is_error`.

### Interruption

Interrupting inserts a synthetic **user** message whose single text block is
`[Request interrupted by user]` (`Tq`) or `[Request interrupted by user for tool use]` (`Wk`) —
both at line 108575. Wherever that text is seen (426473 in the user-message renderer, 427696 in the
tool-error path) it renders as `BP` (422234) = `Cr height:1` containing `zWo` (422222):

```
  ⎿ Interrupted · What should Claude do instead?
```
both spans dim. A rejected tool renders `Yqo` (427683): `  ⎿ Tool use rejected` (dim).
`v4t` (427694) also handles a plan rejection and an auto-mode denial:
`Denied by auto mode classifier … see <link>`. A permitted auto-mode call gets a dim
`  ⎿ Allowed by auto mode classifier` under the result (429041).

The turn spinner's own affordance is `esc to interrupt`, built from the chord renderer with
`format: {keyCase: "lower"}` (494189).

---

## Q4 — The tool-call row itself

Built by `W8o` (424639), final assembly at 424775:

```
<Box row nowrap minWidth={len(name) + (showDot ? 2 : 0)}>
  {glyph}                                             ← ile, or a dim static bullet when queued
  <Box flexShrink=0><Text color={bg} bold wrap="truncate-end">{userFacingToolName}</Text></Box>
  {rendered !== "" && <Box flexWrap="nowrap"><Text>({rendered})</Text></Box>}
  {tool.renderToolUseTag?.(...)}
</Box>
```

Three things that are easy to get wrong:
- **the parentheses are added by the row, not by the per-tool renderer** (424761);
- the **tool name is bold** and truncates with `wrap: "truncate-end"` (no ellipsis character — Ink's
  truncate-end mode);
- if `renderToolUseMessage` returns `null`, or the input fails the tool's zod schema, or
  `userFacingName()` is `""`, **the entire row renders nothing** (424743, 424756). This is an
  inference from `SXe = EXe.success ? J9p(...) : null; … if (G8o === null) { g_t = null; break }` —
  its practical consequence is that a tool row does not appear until its streamed input parses.

Per-tool argument:

| Tool | What goes inside `(...)` | Truncation | Line |
|---|---|---|---|
| Read | `wd(file_path)` (full path when verbose), as an **OSC-8 hyperlink** to `file://…` (`$P`, 421727). Suffixes: ` · pages {n}`; verbose+offset/limit → ` · lines 10-40` or ` · from line 10` | none | 424395 |
| Edit | `wd(file_path)`, hyperlinked; `""` (row hidden) for plan-mode paths | none | 424058 |
| Write | same shape as Edit | none | 424185 (`ibH`) |
| Bash | a `sed -i` command renders as the **file path** instead (`c1t`, 227825). Otherwise the command, non-verbose clipped to **`R6p = 2` lines** and **`obn = 160` chars**, `.trim()`ed, with a literal `…` appended when clipped. Under flag `ds()` a git-op summary (`Wfo`) replaces it, clipped to 160 chars + `…` | 2 lines / 160 chars | 423571, constants 423600 |
| PowerShell | identical, `W9p = 2` / `ada = 160` | | 424585 |
| Agent/Task | the `description`, whitespace-collapsed (`replace(/\s+/g," ").trim()`); `null` if either `description` or `prompt` is missing | none | 429673 |
| TodoWrite | `null` — no row | — | 284511 |
| Grep/Glob/WebFetch/WebSearch | fall through to the tool's own `renderToolUseMessage` (`NEo` for Grep/Glob at 220217/220331; `{url, prompt}` for WebFetch at 271518; `{query, allowed_domains, blocked_domains}` for WebSearch at 284146) — **exact templates not determined**, I did not read those four |

Tags (a dim suffix outside the parens):
- Read: the scratchpad label, if any (424409)
- Agent: the model chain, ` model` or `a → b` when several models were used (429679)
- TaskOutput: ` {task_id}` (430710)

---

## Q5 — Things not asked about that matter

1. **`Cr`'s `height: 1` clipping.** Most one-line result renderers pass `height: 1` *and* `Cr` sets
   `overflowY: "hidden"`. A long single-line result is hard-clipped to one terminal row rather than
   wrapped. Our renderer wraps.
2. **`(ctrl+o to expand)` is not decoration — it names a real expanded view.** Pressing `ctrl+o`
   switches `screen` to `"transcript"`, which sets `verbose` for every renderer (429333:
   `const tE = hz || y2`), which (a) makes `Ima` render the *individual* tool rows instead of the
   summary, (b) makes `p2`/`UP` skip truncation, (c) makes `Bg` render `null`. So the hint and the
   expansion are one mechanism.
3. **Counts latch to their max** inside `Ima` (427898) so a re-grouping never makes a number go down
   mid-turn.
4. **Read counts are path-deduplicated; search counts are not** (302123). Two reads of the same file
   show `read 1 file`.
5. **`ToolSearch` is absorbed silently** (301897) — it collapses into the group and contributes no
   clause at all, so deferred-tool lookups are invisible.
6. **Hook rows.** A collapsed group that absorbed PreToolUse hook summaries appends
   `  ⎿  Ran {N} PreToolUse hook`/`hooks ({duration})` (428076), and in verbose mode one row per hook
   command.
7. **The LSP-diagnostics attachment** renders after edits as
   `Found {bold N} new diagnostic issue`/`issues in {M} file`/`files (ctrl+o to expand)` (424918).
   Note: this one hard-codes the literal `(ctrl+o to expand)` rather than using `Bg`.
8. **`bM({count, unit, expandable})`** (421455) is the one shared "there is more" primitive:
   `… +{N} {unit}`/`{unit}s` + optional ` (ctrl+o to expand)`, dim, `null` when count ≤ 0. It is used
   for lines, for tool uses, and for memory ops (`+{N} more`, 424955).
9. **Bash background hint.** While a foreground Bash runs, a dim
   `(ctrl+b to run in background)` renders at `paddingLeft: 5` (423521), with a tmux-specific
   `ctrl+b ctrl+b (twice)` variant.
10. **Verbose Grep/Glob/LSP use a hand-written gutter** `"\xA0\xA0⎿ \xA0"` (421503, 421572) rather
    than `Cr` — a small internal inconsistency, but it means the verbose layout is
    gutter-line-then-`marginLeft:5`-content rather than a flex row.

---

## Gap table

Effort is for our codebase: **S** ≈ under an hour, **M** ≈ half a day, **L** ≈ a day or more.

| # | Upstream behavior | Our behavior | Class | Effort | Needs probe? |
|---|---|---|---|---|---|
| 1 | Per-tool typed result rows (`Read 340 lines`, `Found 3 files`, `Added 2 lines, removed 3 lines`, `Wrote 42 lines`, `Received 42.1 kB (200 OK)`, `Did 3 searches in 4s`, `Done (7 tool uses · 24.1k tokens · 1m 12s)`) driven by a **structured** tool output | `liveTurn.ts:127` takes `trunc(firstResultLine(content))` — the first non-blank line of the text `tool_result`, capped at 48 chars, shown after `│` | missing | L | **yes** — every one of these reads a *structured* `toolUseResult` (`{numLines}`, `{numFiles}`, `{structuredPatch}`, `{bytes, code, codeText}`). Over the Agent SDK we see only `tool_result.content`. Whether any structured payload reaches an SDK client (and in what shape) is unverified. Without it these must be re-derived client-side (line-count the text, parse the Grep/Glob output) or dropped. **Probe first, then decide per tool.** |
| 2 | Collapsed groups of adjacent read/search/list tools, with the full clause grammar of Q2 | none — `liveTurn.ts:132` emits one line per tool, forever | missing | L | no — grouping is pure client-side reduction over messages we already have. The `ds()`-gated clauses (bash/git) and brief-mode clauses (edit/agent/other) can be skipped. |
| 3 | `(ctrl+o to expand)` as a live affordance that flips renderers into verbose | `ctrl+o` opens `TranscriptPager.tsx` (a scrollback pager). No verbose/collapsed distinction exists in our transcript; the parity doc already records `ctrl+e`/`transcript:toggleShowAll` as deferred for exactly this reason | divergent | M | no |
| 4 | Truncation = first **3** wrapped lines + `… +N lines (ctrl+o to expand)`, wrap width `columns − 10` | `render.ts:86` caps at **12** lines and 100 chars/line with **no** "more" marker; live turn shows only the first line | partial | S | no |
| 5 | Result gutter `⎿` appears **once**, content is a flex column indented to column 5 | `render.ts:87-88` prefixes `  ⎿ ` to **every** line | divergent | S | no |
| 6 | Running glyph = the **same bullet**, dim + blinking at 600 ms | `liveTurn.ts:150` uses `⟳` plus an elapsed-seconds suffix; static | divergent | S | no |
| 7 | Done glyph = bullet in theme `success` colour; failed = bullet in theme `error` | `liveTurn.ts:146-147` uses `✓` / `✗ … color:"red"` | divergent | S | no |
| 8 | Row form `⏺ **Bold(**arg**)**` with the tool name bold and the parens added by the row | live turn (`liveTurn.ts:137`) uses `Name target` with **no parens and no bold**; replay (`render.ts:43`) uses `● Name(target)` with no bold. The two paths disagree with each other | partial | S | no |
| 9 | `Za` = `⏺` (U+23FA) on macOS, `●` (U+25CF) elsewhere | we hard-code `●` everywhere (`render.ts:23,43`) | divergent | S | no |
| 10 | Bash row arg: `sed -i` swaps to the file path; else 2 lines / 160 chars + `…` | `render.ts:35` truncates the command at 80 chars, no line clamp, no `sed` case | partial | S | no |
| 11 | Read/Edit/Write row arg is `wd(path)` — cwd-relative or `~`-shortened — and an OSC-8 hyperlink | `render.ts:31,36` prints the raw `file_path` verbatim, no hyperlink | partial | S | no (hyperlinks are pure ANSI; Ink supports them via `ink-link`, which the bundle also vendors) |
| 12 | TodoWrite renders **nothing** in the transcript | `render.ts:43` renders `● TodoWrite([...])` with a JSON-stringified first arg | divergent | S | no |
| 13 | Interruption → `⎿ Interrupted · What should Claude do instead?`; rejection → `⎿ Tool use rejected` | `liveTurn.ts:148` renders a settled running tool as dim `· Name target`; there is no interrupted/rejected literal anywhere | missing | S | **partial** — the `[Request interrupted by user]` synthetic user message is the trigger. Whether the SDK surfaces that message to a client is unverified. |
| 14 | Live Bash progress: last 5 output lines in a `height:5` clipped box + `+N lines` + `({elapsed} · timeout {t})` | none — a running Bash shows only `⟳ Bash <cmd> 3s` | missing | M | **yes** — upstream reads `progressMessages` of type `bash_progress` from its own executor. The Agent SDK gives a client no incremental stdout for a running Bash. Very likely not applicable; probe to confirm. |
| 15 | Agent progress: last 3 inner rows + `… +N tool uses (ctrl+o to expand)`; short-terminal fallback `In progress… · N tool uses · 24.1k tokens · (ctrl+o to expand)`; initial `Initializing…` | `liveTurn.ts:47-56` renders **all** nested rows, unbounded, as `  │ text` / `  ● Name target` / `  ⎿ preview`, all dim | partial | M | no — we already receive nested messages via `parent_tool_use_id` |
| 16 | Agent completion `Done (N tool uses · Xk tokens · Ys)` as a bulleted assistant line | `liveTurn.ts:139` renders `● Agent <target> ✓ (N tools · Ss)` — right idea, different literals, no token count | partial | S | **partial** — the token figure comes from the subagent's usage. We do see nested assistant messages with `usage`; summing them is plausible but unverified. |
| 17 | Parallel same-name tool calls in one API message collapse (`Running 3 agents…` / `3 agents finished`) | none | missing | M | no |
| 18 | `Waiting for permission…` under a row whose permission prompt is open | our permission UI is a separate dialog (`PermissionDialog.tsx`); the row shows nothing | partial | S | no |
| 19 | Group elapsed suffix ` · 12s` once the oldest unresolved tool passes 2000 ms; per-row elapsed is **not** shown | `liveTurn.ts:149-150` shows per-row elapsed from 1 s | divergent | S | no |
| 20 | Finished collapsed group is entirely dim; active group is normal-weight | n/a (no groups) | missing | — | no — folds into #2 |
| 21 | The live hint line `⎿ {current path \| "pattern" \| $ command}`, 700 ms throttled | none | missing | M | no |
| 22 | Generic error normalization (`Tool execution failed`, `Invalid tool parameters`, `Error: …` prefixing, `<error>`/sandbox-violation stripping) then 10-line clip + `… +N lines` | `render.ts:87` renders raw text red with a `✗` on line 1 | partial | S | no |
| 23 | Structured diff body from a real `structuredPatch` with absolute file line numbers | `render.ts:52-78` synthesizes a hunk from `old_string`/`new_string` with **hunk-relative** numbering (already disclosed in the parity doc) | partial | M | **yes** — needs the same structured `toolUseResult` question as #1. If unavailable, reading the file from disk client-side is the only route to absolute numbers. |
| 24 | Write preview = first 10 syntax-highlighted lines + `… +N lines` | `render.ts:71-77` emits every line as `+ line`, capped at 24, then `… N more lines` | partial | S | no |
| 25 | `bM` as one shared "there is more" primitive (`… +N lines` / `… +N tool uses` / `+N more`) | three ad-hoc forms: `… N more lines` (`render.ts:77`), `… N earlier messages elided` (`replay.ts:33`) | divergent | S | no |
| 26 | PreToolUse hook summary rows `Ran N PreToolUse hooks (Xms)` | none | missing | S | **yes** — the memory note `sdk-hooks-headless-reachability` says only 8/30 hook events fire headlessly, and hook *timing* is not obviously exposed to a client |
| 27 | LSP-diagnostics attachment `Found N new diagnostic issues in M files (ctrl+o to expand)` | none | not applicable | — | no — needs an IDE/LSP attachment channel we do not have |
| 28 | Auto-mode annotations `Allowed by auto mode classifier` / `Denied by auto mode classifier … see <link>` | none | missing | S | **yes** — we run `permissionMode: auto`, but whether the classifier's verdict reaches a client is unverified |
| 29 | Bash background hint `(ctrl+b to run in background)` under a running foreground Bash | we have `/bg` and Ctrl-B backgrounding but no inline row hint | partial | S | no |
| 30 | Live and replay use the **same** renderer for a tool row | our live path (`liveTurn.ts:renderBlock`) and replay path (`render.ts:renderMessage`) produce different text for the same tool call | divergent | M | no — this is the highest-leverage refactor: unify before adding anything above |

**Counts by classification: missing 9 · partial 11 · divergent 9 · not applicable 1 (30 rows).**
Needs-a-probe: 7 rows (#1, #13, #14, #16, #23, #26, #28).

---

## Confidence and gaps

**High confidence** (read the literal and its selecting branch directly): the bullet glyph and its
platform branch; `ile`'s colour/dim/blink matrix and the 600 ms period; the `Cr` gutter geometry; the
`Bg` / `$e` construction of `(ctrl+o to expand)`; `y_s`/`Sut = 3`/`Bst` truncation; the Read, Write,
Edit, Bash, Grep/Glob, WebFetch, WebSearch, Agent, TaskOutput, Skill, TaskStop result templates and
their pluralization; the `Ima` clause table, its ordering, its verb-capitalization rule and its
running/done verb pairs; `VFt`'s collapsibility matrix; `PMd`'s start/extend/break rules; `bdf`'s
same-message-same-name grouping rule; `nRo`'s string form; the interrupted and rejected literals.

**Stated inferences** (marked as such above, with the fragment they rest on):
- A tool row renders nothing while its streamed input fails schema validation — inferred from
  `SXe = EXe.success ? J9p(...) : null` followed by `if (G8o === null) { g_t = null; break bb1; }`
  at 424756/424758. I did not find a separate partial-input rendering path, but I also did not
  exhaustively rule one out.
- That `editFileCount` / `agentCount` / `otherToolCount` / `frameCount` are brief-mode-only rests on
  `ke_` (302123) never setting them and `kMd` (302548) being reached only from `NMd` (302354),
  whose sole caller is 456912.

**Not determined:**
- The runtime flag `ds()` — it gates the bash-count clause, the git commit/push/branch/PR clauses,
  and Bash/PowerShell collapsibility. Its identifier is reused across the bundle and I could not
  isolate the definition. Treat the git clauses as "exists, may be off by default".
- NotebookEdit's `renderToolResultMessage` (`_bH`) — I read only its rejection form.
- The exact `renderToolUseMessage` templates for Grep, Glob, WebFetch and WebSearch (what goes inside
  the parens). I have their line numbers (220217, 220331, 271518, 284146) but did not read them.
- `AskUserQuestion` (`M3p`, 421712) and `ExitPlanMode` (`QBp`, 421302) result rows.
- The `fTH` / `mTH` constants that decide the Agent short-terminal fallback threshold.
- Whether the theme tokens `success` / `error` resolve to the same colours we use — the theme table
  is at line 41474 and I did not read it.

**The one thing that would most change these conclusions:** whether the Claude Agent SDK hands a
client anything like upstream's structured `toolUseResult` (`{type:"text", file:{numLines}}` for
Read, `{structuredPatch, originalFile}` for Edit, `{numFiles, numMatches, mode}` for Grep,
`{bytes, code, codeText}` for WebFetch). Roughly a third of Q1 is unbuildable at full fidelity
without it and only approximable from raw result text. That is a single probe — dump the raw
`tool_result` blocks (and any sibling fields) for one call of each of Read / Edit / Grep / Bash /
WebFetch — and it should be run before any of #1, #16, or #23 is planned.
