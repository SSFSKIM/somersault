# Claude Code 2.1.220 — default transcript tool-rendering contract

Static analysis of `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js`.
Every rule is tagged with the bundle line(s) that prove it. Minified identifiers are
kept verbatim so the evidence can be re-checked; a glossary is at the end.

## Live confirmation (2026-08-03, isolated-config pty sessions against installed 2.1.220)

Two interactive probe sessions (100×40/44 pty, OAuth first-party, isolated `CLAUDE_CONFIG_DIR`)
confirmed the default-mode contract end to end before it was adopted as normative:

- Two `Read` calls in one turn settle to one row `  Read 2 files (ctrl+o to expand)` — grey,
  count bold, two-space leader, no `⏺`, no `⎿` line. Matches R1.1/R3.4–R3.8. **Grey pinned
  2026-08-03 (Task 7 closeout):** under the tracked capture environment (pinned
  `TERM=xterm-256color`/`COLORTERM=truecolor`, wrapper/palette vars removed) BOTH the active and
  the settled row render `#999999` — verified by a dedicated settled-state probe; the `#949494`
  first recorded here was the ambient-palette variant (`COLORFGBG` present in that probe env).
- ctrl+o replaces that row with `⏺ Read(src/app.ts)` + `⎿  Read 2 lines` per call and the footer
  `Showing detailed transcript · ctrl+o to toggle · ctrl+e to show all`. Matches R6.1–R6.3.
- `Bash(echo one)` / `Bash(echo two)` render standalone (`echo` is on the ignored list `Vr_`);
  a Bash `grep` folded into `  Searched for 1 pattern (ctrl+o to expand)`. Matches R1.2/R1.3.
- `Edit` settles as `⏺ Update(src/b.ts)` + `⎿  Added 1 line, removed 1 line` + numbered red/green
  diff; `Write` as `⏺ Write(src/new.txt)` + `⎿  Wrote 1 line to src/new.txt` + content preview —
  both standalone (no `isSearchOrReadCommand` ⇒ classifier case 6). Matches R1.1.
- Active form observed live: `⏺ Reading 1 file… (ctrl+o to expand)` with transient
  `⎿  src/missing.ts` hint line. Matches R4.1–R4.8.
- A `Read` of a missing file still settled to `  Read 1 file (ctrl+o to expand)` with no error
  styling. Matches R5.2.

---

## 0. Pipeline order (normative)

The transcript renderer builds its display list in this exact order (**L456906**):

```js
let { messages: er } = bdf(cr, t, n);              // 1. parallel same-tool grouping
let Yr = yMd( hdf( ydf( PMd(er, t) ) ), n);        // 2. collapse  3. teammate batch
                                                    // 4. hook merge 5. bg-command batch
```

and then, **only in fullscreen brief mode** (**L456908–456915**):

```js
if (!(ds() && (briefTranscript || remoteReplyChannel) && !transcriptScreen)) return Be;
return NMd(Be, t, …)                                // 6. per-turn "brief" summary
```

Upstream of that (**L456906**), when the view is neither verbose nor fullscreen the
message list is first trimmed to the **last user turn only**: `ve = n || ds() ? Se : FE(Se, void 0)`
where `FE` slices from the last "real" user message (**L375448–375451**).

**R0.1** A faithful clone must implement stages 1 and 2. Stages 3–6 are conditional
(3/4 always run but are no-ops without teammates/hooks; 5 and 6 require `ds()`).

**R0.2** `bdf(…, verbose)` returns the input unchanged when `verbose` is true (**L452546–452547**) —
verbose mode disables `grouped_tool_use` entirely.

---

## 1. THE PARTITION — which tool call goes where

### 1.1 The classifier: `VFt(toolName, input, tools)` — **L301895–301913**

Returns a flags record. Evaluated in this exact priority order; **first match wins**:

| # | Predicate | Line | Result flags |
|---|---|---|---|
| 1 | `name === Fg` (`"REPL"`) | 301896–301899 | `isCollapsible: !W2e()`, `isREPL: !W2e()`, `isAbsorbedSilently: !W2e()` |
| 2 | `ye_(name, input)` — Write/Edit whose `file_path`/`path` is an auto-managed memory path | 301900–301901 | `isCollapsible:true, isMemoryWrite:true` |
| 3 | `_e_(name, input)` — Write/Edit whose path is a scratchpad display path | 301902–301903 | `isCollapsible:true, isScratchpadWrite:true` |
| 4 | `ds() && name === ZS` (`"ToolSearch"`) | 301904–301905 | `isCollapsible:true, isAbsorbedSilently:true` |
| 5 | tool descriptor `.isMcp` | 301906–301908 | `isCollapsible:true, mcpServerName: <server>` |
| 6 | tool has **no** `isSearchOrReadCommand` method | 301909–301910 | **all false → standalone render** |
| 7 | otherwise | 301911–301912 | see below |

Case 7 verbatim (**L301911–301912**):

```js
let o = n.isSearchOrReadCommand(t ?? {}),
    i = o.isList ?? !1,
    s = o.isSearch || o.isRead || i,
    a = $Z.includes(e);                       // $Z = [Bash, PowerShell]  (L112934)
return { isCollapsible: s || (ds() ? a : !1),
         isSearch: o.isSearch, isRead: o.isRead, isList: i,
         isBash: ds() ? !s && a : void 0, … };
```

**R1.1** Only five tools implement `isSearchOrReadCommand`; everything else falls out at
step 6 and renders standalone:

| Tool | Line | Verdict |
|---|---|---|
| `Glob` | 220176–220177 | `{isSearch:true, isRead:false}` — always **search** |
| `Grep` | 220297–220298 | `{isSearch:true, isRead:false}` — always **search** |
| `Read` | 307640–307641 | `{isSearch:false, isRead:true}` — always **read** |
| `Bash` | 306444–306448 | classified per-command by `Kr_` |
| `PowerShell` | 301423–301426 | classified per-command by `te_` |

**R1.2 — Bash command classification (`Kr_`, L306129–306152).** The command is split into
statements; the head word of each is looked up:

> **Parser correction (2026-08-03, Task 5b review round 3).** The statement extraction is NOT
> tree-sitter: 2.1.220 ships a hand-written JS bash parser (`SF()` → `Zqg = { parse: aVg }`,
> L140408/L140656). Two consequences verified directly against that parser: (a) **leading**
> redirects are part of the `command` node (`f = [...assignments, ...redirects, command_name,
> ...args]`, L141080–141082), so `2>/dev/null rg x` has head word `2>/dev/null` and renders
> STANDALONE — only trailing redirects on a `redirected_statement` are stripped by `OE`; and
> (b) a double-quoted heredoc delimiter containing `` ` ``, `$`, `\` or newline **aborts the
> whole parse** (L141326), and on abort `OE` falls back to the entire command as ONE statement
> (L359731–359733) — so such a command classifies on its first head word alone.

- ignored (never decide anything): `echo printf true false :` (`Vr_`, L306395)
- **search**: `find grep rg ag ack locate which whereis` (`jr_`)
- **read**: `cat head tail less more wc stat file strings jq awk cut sort uniq tr` (`Wr_`)
- **list**: `ls tree du` (`qr_`)
- **any** head word outside those sets ⇒ `{isSearch:false, isRead:false, isList:false}` — the whole
  command is *not* a read/search (L306140–306141), i.e. one non-read word poisons the pipeline.

The PowerShell equivalent (`te_`, L301211–301237) uses `QZy` = `select-string get-childitem findstr where.exe`
(search) and `ZZy` = `get-content get-item test-path resolve-path get-process get-service get-childitem
get-location get-filehash get-acl format-hex` (read), ignoring `write-output write-host` (`ee_`), all at **L301415**.

**R1.3 — CRITICAL: a read/search/list Bash call folds into the summary even when `ds()` is false.**
`isCollapsible: s || (ds() ? a : !1)` (L301912): `s` is true for `ls`/`cat`/`grep`, so those collapse
unconditionally. Only a Bash call that is *not* read/search/list (`isBash`) needs `ds()`.
So `Bash("npm test")` renders standalone by default; `Bash("ls -la")` folds into
"listed 1 directory" **always**.

### 1.2 Counter assignment — `PMd`'s accumulator branch chain, **L302194–302256**

Given `c = Ee_(msg, tools)` (the per-message tool info) and `d = c.toolUseCount`, the branches are
evaluated in this order (`else if` chain — again first match wins):

| Order | Condition | Line | Effect |
|---|---|---|---|
| 1 | `isMemoryWrite` && team-memory path (`AMd`) | 302198–302199 | `teamMemoryWriteCount += d` |
| 2 | `isMemoryWrite` (personal) | 302200–302201 | `memoryWriteCount += d`; push `memoryOps` |
| 3 | `isScratchpadWrite` | 302202–302207 | `scratchpadWriteCount += d`, `scratchpadLinesAdded/Removed += Xon(...)`; `latestDisplayHint = wd(path)` |
| 4 | `isAbsorbedSilently` | 302208–302209 | **no counter at all** (empty statement) — message still joins the group |
| 5 | `mcpServerName` | 302210–302214 | `mcpCallCount += d`; add server name; if `input.query` → hint = `"<query>"` |
| 6 | `ds() && isBash` | 302215–302222 | `bashCount += d`; hint = `Wfo(cmd) ?? KFs(cmd)`; remember cmd per tool-use-id |
| 7 | `isList` | 302223–302227 | `listCount += d`; if `input.command` → hint = `KFs(cmd)` |
| 8 | `isSearch` | 302228–302237 | `searchCount += d`; then team-mem (`SMd`) → `teamMemorySearchCount`, memory (`ge_`) → `memorySearchCount`, else push `input.pattern` to `nonMemSearchArgs` and hint = `"<pattern>"` |
| 9 | else (**read**) | 302238–302252 | for each `readPaths` entry: add to `readFilePaths`; team-mem → `teamMemoryReadFilePaths`; auto-memory → `memoryReadFilePaths` + memoryOp; else hint = `wd(path)`. If `readPaths` is empty → `readOperationCount += d` and hint = `KFs(input.command)` |

**R1.4** `readPaths` is only computed when the call is a *pure* read (**L301954**):
`n = !isMemoryWrite && !isScratchpadWrite && !isAbsorbedSilently && !mcpServerName && !(ds() && isBash) && !isList && !isSearch`.
It harvests `input.file_path` only (**L302058–302077**) — so a `Bash("cat x")` read has no path and
lands in `readOperationCount`.

**R1.5 — the readCount quirk.** In `ke_` (**L302123**):
`r = e.readFilePaths.size > 0 ? e.readFilePaths.size : e.readOperationCount`.
If **any** path-bearing read exists, the whole `readOperationCount` (the `cat`/`head` reads) is
**discarded**. `readFilePaths` is a `Set`, so re-reading the same file counts once.
Final `readCount = max(0, r − memoryReadFilePaths.size − teamMemoryReadFilePaths.size)`;
`searchCount = max(0, searchCount − memorySearchCount − teamMemorySearchCount)`.

**R1.6 — `replCount` is hard-coded `0`** in the constructed message (**L302123**), and REPL calls are
`isAbsorbedSilently` by default (`W2e()` = `CLAUDE_REPL_VERBOSE && s1()`, **L301617–301618**).
So the "REPL'd N times" clause is unreachable in the normal pipeline. Keep the clause for parity,
never emit it.

**R1.7 — counters that do NOT exist in the collapse pipeline.** `ke_` (L302123–302151) never sets
`agentCount`, `editFileCount`, `frameCount`, `linesAdded`, `linesRemoved`, `otherToolCount`.
Those are produced exclusively by `kMd` (**L302548–302587**) inside `NMd`, the fullscreen brief-mode
transform. Consequence for a default clone: **the "edited N files", "published", "ran N agents",
"called N tools" clauses never appear in the ordinary transcript.**

`kMd`'s mapping, for completeness (**L302548–302586**):
- `Agent`/`Task` → `agentCount = n`, `agentDescriptions` (each `description`, whitespace-collapsed, ≤300 chars)
- `.isMcp` → `mcpCallCount = n`, `mcpServerNames`
- `mwo = {Edit, Write, NotebookEdit}` (**L242526**) → `editFileCount = n`, `linesAdded/Removed` via `Xon` (**L242500–242520**: Edit = newline-count of `new_string`/`old_string` summed over `edits[]`; Write = lines of `content`; NotebookEdit = lines of `new_source`)
- Artifact tool → `frameCount` for non-`list` actions, `otherToolCount` for `action:"list"`
- anything else → `otherToolCount = n`

### 1.3 Run boundaries — contiguous, not whole-turn

`PMd` (**L302172–302284**) walks the message list with a single open accumulator `o` and a
flush closure `a()` that pushes `ke_(o)` then the deferred buffer `i` (**L302174–302189**).

| Message shape | Line | Effect on the run |
|---|---|---|
| tool_use with `isCollapsible \|\| isREPL` | 302194–302256 | **joins** (counter + `o.messages.push`) |
| user message whose tool_results are **all** in `o.toolUseIds` (`Te_`, L302018–302024) | 302257–302259 | **joins**; errors recorded via `Le_`; bash git-ops parsed via `xe_` |
| `system/stop_hook_summary` with `hookLabel === "PreToolUse"` (`Se_`), run non-empty | 302260–302261 | **joins** (hook counters) |
| `attachment/relevant_memories`, run non-empty | 302262–302263 | **joins** |
| queued-command prompt attachment (`OMd`, L302285–302297) | 302264–302265 | **FLUSH**, then emit |
| assistant `thinking`/`redacted_thinking` with text (`Ae_`) | 302266–302272 | **joins**: `thoughtForMs += min(Δt, 600000)`, `latestThinkingSummary = text.trim().replace(/\s+/g," ")` |
| `RMd(l)` = assistant thinking/redacted, or `attachment`, or `system` (L301991–302002); or `YFs(l)` = assistant text exactly `"(no content)"` or `"No response requested."` (L301979–301987) | 302273–302277 | **does NOT break**: buffered into `i`, replayed immediately after the collapsed row |
| **anything else** — assistant text with real content, a non-collapsible tool_use, a real user prompt | 302278–302279 | **FLUSH**, then emit standalone |

**R1.8** Grouping is **contiguous-run based**. Errors never break a run. Assistant prose does.
A non-collapsible tool call does. `a()` is also called once at the end (L302283).

**R1.9** `eRo` (**L301971–301978**) is the "assistant said something real" predicate used by the
brief transform; `LMd` treats the two sentinels above as not-real.

---

## 2. THE `ds()` GATE

**Definition — L110109–110139.** It is *not* a feature flag for Bash folding per se; it is the
**fullscreen / flicker-free renderer** predicate, reused as the gate for the richer summary clauses.

```js
function ds(e = epe) {
  if (l$() === "local-agent")                  return false;   // 110110
  if (Z.CLAUDE_CODE_SESSION_KIND === "bg")     return true;    // 110112
  if (kR())                                    return false;   // 110114 (screen-reader)
  if (RZi())                                   return false;   // 110116 (CLAUDE_CODE_NO_FLICKER===false
                                                               //         || DISABLE_ALTERNATE_SCREEN)
  if (Z.CLAUDE_CODE_NO_FLICKER === true)       return true;    // 110118
  if (B0e(e))                                  return false;   // 110120 tmux -CC
  if (LZi())                                   return false;   // 110125 Windows over SSH
  switch (eo().tui) { case "fullscreen": return true;
                      case "default":     return false; }      // 110130–110135
  if (JOg(e)) return true;                                     // 110136  GrowthBook tengu_amber_creek
  return e.gbGateCached ??= Ke("tengu_pewter_brook", false);   // 110138  GrowthBook
}
```

`tui` is `S.enum(["default","fullscreen"]).optional()` with **no schema default** (settings schema, L42039).

**R2.1 Default (no env var, no `tui` setting, gates off) ⇒ `ds()` is `false`.** Both GrowthBook
gates default to `false` in code, so a clone's default must be `ds() === false`. Note this is a
*server-controlled* experiment, so real installs may differ; make it a config knob.

**R2.2 What `ds()` gates:**
- `ToolSearch` absorbed silently (L301904)
- non-read Bash/PowerShell folding (`isBash`, L301912) and its counters/state (L302118–302119, 302215)
- git-op extraction from bash stdout (`xe_`, L302258–302259) and the commits/pushes/branches/prs clauses (L428004–428025)
- the "ran N shell commands" clause (L428054)
- the live thinking timer `q8p` instead of a static duration (L427984–427995)
- the bash progress suffix (L427947) and the elapsed `· Ns` suffix (L427964)
- the background-command batching pass `yMd` (L301666) and the whole brief transform `NMd` (L456910)

**R2.3** With `ds()` false, **`Bash("npm test")` stands alone**; only read/search/list shell commands
fold (R1.3).

---

## 3. THE SETTLED ROW

Source: `Ima`, **L427895–428064**. The JSX at **L428062–428063** is the whole row.

### 3.1 Early exit
**R3.1** `if (!H && !T && !se) return null;` (**L427944–427945**) — where `H` = any of
memorySearch/memoryRead/memoryWrite > 0, `T` = `E8p(e)` any team-memory count (**L427606–427607**),
`se` = `search||read||list||repl||mcp||bash||gitOpBash||other||agent||edit||scratchpad||frame||thinking`
(**L427898**). A run of only absorbed calls (ToolSearch, REPL) renders **nothing**.

### 3.2 Ratcheting counters
**R3.2** `readCount`, `searchCount`, `listCount`, `mcpCallCount`, `bashCount` are held in refs and
**monotonically ratcheted**: `w.current = Math.max(w.current, c)` etc. (**L427896–427897**). They never
decrease across re-renders of the same row.

**R3.3** `re = ds() ? Math.max(0, bashCount − gitOpBashCount) : 0` (**L427898**) — shell commands that
produced a detected git operation are **excluded** from "ran N shell commands"; they are represented
by the commit/push/branch/pr clauses instead.

### 3.3 Row geometry

```
<Box flexDirection="column" marginTop={addMargin ? 1 : 0}>          // L428062
  <Box flexDirection="row">
    {isActive ? <ile shouldAnimate isUnresolved isError={A}/>       // active: blinking glyph
              : <Box minWidth={2}/>}                                // settled: EMPTY 2-col box
    <Text dimColor={!isActive}>
      {clauses}{teamMemoryClauses}
      {anchorMs>0 && <V8p …/>}                                      // "· Ns", ds()-only
      {isActive && "…"}
      {" "}
      <Bg/>                                                         // "(ctrl+o to expand)"
    </Text>
  </Box>
  …
```

**R3.4 Settled leader is two literal spaces** produced by an *empty* `<Box minWidth={2}>` — there is
no glyph and no color (**L428062**). Active leader is the `ile` component (§4.1).

**R3.5 The entire text run is `dimColor` when settled** (`dimColor: !s`, L428062) and **not dim when
active**. Counts nested inside stay `bold` (Ink composes dim+bold).

> **F1 Task 7 correction (2026-08-03), measured on the tracked golden**
> `harness/test/fixtures/upstream-frames/f1-tool-rendering/01-read-complete.ansi` — a real 2.1.220 ACTIVE
> single-read frame whose per-cell attributes the pyte capture reconstructs exactly. Its cells read:
> `⏺` dim+`#999999` · `" Reading "` dim · `1` bold+dim · `" file…"` PLAIN · `" "` dim ·
> `"(ctrl+o to expand)"` dim+`#999999`.
>
> 1. **R3.5's polarity is backwards for the active row.** The active text run IS dim. The plain `" file…"`
>    is not evidence against that: it is the bold count's own `\x1b[22m` closer clearing faint as well as
>    bold, i.e. one outer dim run broken mid-way — which also tells us upstream renders the count as a
>    bold child inside a dim parent rather than as a sibling.
> 2. **R4.2's "dimColor with no color" is wrong.** The leader glyph carries `#999999`, and only the glyph
>    cell does — the space after it is dim and uncoloured. The `(ctrl+o to expand)` hint carries the same
>    colour, and since `Bg` is one component on both rows (R3.6) its colour is the same settled.
> 3. **R4.6's hint gutter is dim+`#999999` across the connector too**, not plain text with a dim body.
> 4. **"Ink composes dim+bold" is false for this Ink.** Probed: `<Text dimColor bold>1</Text>` emits
>    `\x1b[2m1\x1b[22m` with no `\x1b[1m`, and a raw `\x1b[1m…\x1b[22m` embedded in a dim `<Text>` is
>    rewritten by chalk's nested-close handling into a bold run that never closes. Getting bold+dim
>    requires the nesting shape in (1).
>
> Still open: the SETTLED row's own colour. §0's live-confirmation note records it as grey `#949494`,
> a DIFFERENT grey from this frame's `#999999`, and there is no settled golden yet.

**R3.6 The `(ctrl+o to expand)` hint is on BOTH the active and the settled row**, separated by exactly
one literal space (`" ", <Bg/>` at L428062). `Bg` (**L421333–421348**) renders
`<Text dimColor><$e chord={pc("app:toggleTranscript","Global","ctrl+o")} action="expand" parens
format={{keyCase:"lower"}}/></Text>`; `$e` with `parens` emits `"(" + chord + " to " + action + ")"`
(**L183876–183883**) ⇒ **`(ctrl+o to expand)`**. `Bg` returns `null` inside the `SAr` provider or the
`q3e` context (L421335–421336) — i.e. suppressed inside nested agent transcripts.
The plain-string equivalent is `Pmy()` (**L186448–186451**): `chalk.dim("(ctrl+o to expand)")`.

**R3.7 The `⎿` hint line is ACTIVE-ONLY.** `s && Se !== void 0 && …` (**L428062**). `latestDisplayHint`
is carried on the settled message but never rendered. Settled rows are exactly one line
(plus the optional hook line and memory-op lines).

### 3.4 Clause order and text — exact, as coded

Helper (**L427976–427981**):

```js
function we(key, verb, obj) {
  let first = Ae.length === 0;
  if (!first) Ae.push(<Text>{", "}</Text>);
  Ae.push(<Text>{first ? verb[0].toUpperCase()+verb.slice(1) : verb}
                {obj != null && <>{" "}{obj}</>}</Text>);
}
```

**R3.8 Only the first clause is capitalized**; separators are the literal `", "`.

| # | key | Line | active verb | settled verb | object |
|---|---|---|---|---|---|
| 1 | `thought` | 427982–427998 | `Thinking` | `Thought` | `for ` + **bold** duration. `ds()` ⇒ live-ticking `q8p` (L428065–428086, `ra(max(1000, base+elapsed))`), else static `ra(max(1000, thoughtForMs))`. Pushed **directly**, not via `we()`, so always capitalized and always first |
| 2 | `edit` | 428000–428001 | `editing` | `edited` | **bold** N + ` file(s) ` + `<g3 added removed/>` |
| 3 | `scratchpad` | 428002–428003 | `making` | `made` | **bold** N + ` scratchpad edit(s) ` + `<g3/>` |
| 4 | `committed`/`amended`/`cherry-picked` | 428004–428011 | — | `committed` / `amended commit` / `cherry-picked` | **bold** sha list joined `", "` — `ds()` only |
| 5 | `push` | 428012–428015 | — | `pushed to` | **bold** deduped branch list — `ds()` only |
| 6 | `br-<action>-<ref>` | 428016–428020 | — | `merged` / `rebased onto` | **bold** ref — `ds()` only, one clause per branch op |
| 7 | `pr-<action>-<n>` | 428021–428025 | — | `created`/`edited`/`merged`/`commented on`/`closed`/`marked ready`/`marked draft`/`enabled auto-merge on`/`disabled auto-merge on` | link or **bold** `PR #N` — `ds()` only |
| 8 | `frame` | 428026–428027 | `publishing` | `published` | *(none)* |
| 9 | `search` | 428028–428029 | `searching for` | `searched for` | **bold** N + ` pattern`/` patterns` |
| 10 | `read` | 428030–428031 | `reading` | `read` | **bold** N + ` file`/` files` |
| 11 | `list` | 428032–428033 | `listing` | `listed` | **bold** N + ` directory`/` directories` |
| 12 | `repl` | 428034–428035 | `REPL'ing` | `REPL'd` | **bold** N + ` time`/` times` (unreachable, R1.6) |
| 13 | `mcp` | 428036–428039 | `calling` | `called` | server names (`^claude\.ai ` stripped) joined `", "`, or `"MCP"`; if N>1 append ` ` + **bold** N + ` times` |
| 14 | `agent` | 428040–428051 | `running` | `ran` | three shapes — see R3.9 |
| 15 | `other` | 428052–428053 | `calling` | `called` | **bold** N + ` tool`/` tools` |
| 16 | `bash` | 428054–428055 | `running` | `ran` | **bold** N + ` shell command(s)` — `ds()` only |
| 17 | `mem-read` | 428056–428057 | `recalling` | `recalled` | **bold** N + ` memory`/` memories` |
| 18 | `mem-search` | 428058–428059 | `searching` | `searched` | literal `memories` |
| 19 | `mem-write` | 428060–428061 | `writing` | `wrote` | **bold** N + ` memory`/` memories` |
| 20 | team-memory clauses | `lma`, 427609–427668 | `Recalling`/`Searching`/`Writing` | `Recalled`/`Searched`/`Wrote` | `<b>N</b> team memories` / `team memories` / `<b>N</b> team memories`; same `", "` separator logic, capitalized only if no preceding clause |

**R3.9 Agent clause shapes** (**L428040–428051**): if `agentCount === 1`, the batch is not
async (`NAH`, L428121–428155), and an `agentDescriptions[0]` exists that `s8p` can conjugate
(L427477–427491), the clause is **just the conjugated description in bold** with no verb, lower-cased
unless first (`J8o`, L424981–424983). Else if a description exists: `ran agent · <b>desc</b>`.
Else: `ran <b>N</b> agent(s)`.

**R3.10 Optional extra lines on a settled row**

- memory ops (**L428062**, component `Evr` L424934–424963), rendered when `message.memoryOps` and
  `zqr()`: up to `lGp = 5` lines `"  ⎿  "` + `Recalled`/`Remembered` (active: `Recalling`/`Remembering`)
  + truncated path/label; then a `"  ⎿  +N more (ctrl+o to expand)"` overflow line. All `dimColor`.
- hook line (**L428063**), rendered whenever `hookTotalMs > 0` regardless of active:
  `"  ⎿  " + "Ran " + hookCount + " PreToolUse" + " " + ("hook"|"hooks") + " (" + ELt(hookTotalMs) + ")"`,
  `dimColor`. `ELt(ms) = (ms/1000).toFixed(1) + "s"` (**L107030–107032**).
- pending text (**L428063**), active only: a row with a 2-col gutter containing the dim `Za` glyph
  and the wrapped dim text. Only set by the brief transform (`P.pendingText`, L302533–302534).

---

## 4. THE ACTIVE ROW

### 4.1 Leader glyph — `ile`, **L422343–422354**

```js
<Box minWidth={2}>
  <Text aria-label={isError ? "tool error:" : "tool:"}
        color={isUnresolved ? undefined : isError ? "error" : "success"}
        dimColor={isUnresolved}>
    {!shouldAnimate || blinkOn || isError || !isUnresolved ? Za : " "}
  </Text>
</Box>
```

**R4.1** There is **no spinner character cycle**. It is a single glyph that **blinks** —
`Za` for half the period, a space for the other half.
`Za = platform === "macos" ? "⏺" (⏺) : "●" (●)` (**L41484**).
Blink period `jyH = 600`ms, phase `Math.floor(elapsed/600) % 2 === 0` (**L422333–422340**);
blinking is suppressed when the terminal is unfocused (`fy()`, L177210) or a screen reader is
active (`Ea()`, L422344 / L182559).

**R4.2** While unresolved the glyph is `dimColor` with no color; once resolved it becomes
`color="success"`, or `color="error"` when errored. `Ima` always passes `shouldAnimate: true`,
`isUnresolved: true` for the collapsed row (**L428062**), so the collapsed active leader is always
a dim blinking `⏺`.

**R4.3** After 5 s unresolved (`Z4p = 5000`, L422328) the resolve transition rings the terminal bell
(**L422345–422352**).

### 4.2 Present-participle verbs and the ellipsis
**R4.4** See the table in §3.4 (`isActiveGroup` picks the left column). The trailing
`"…"` (`…`) is a **separate Text node emitted only when active**, placed after the elapsed
suffix and before the space + expand hint (**L428062**).

### 4.3 `isActiveGroup`
**R4.5** `isActiveCollapsedGroup = isCollapsedRow && (Mln(msg, inProgressToolUseIDs) || (isLoading && !hasContentAfter))`
(**L453664–453668**). `Mln` = any tool-use id in the group is in-flight (**L302044–302046**).

### 4.4 The `⎿` hint gutter
**R4.6** Exact markup (**L428062**):

```jsx
<Box flexDirection="row">
  <Box width={5} flexShrink={0}>
    <Text aria-hidden dimColor>{"  ⎿  "}</Text>     {/* 2 spaces, ⎿, 2 spaces */}
  </Box>
  <Box flexDirection="column" flexGrow={1}> … </Box>
</Box>
```

Gutter width is exactly **5 columns** (`X8o = 5`, L424984). The standalone tool-result gutter `Cr`
uses the visually identical `"  " + "⎿ "` (**L406895**) — 2 spaces, ⎿, space, NBSP.

**R4.7 Hint content resolution** (**L427898–427922**):
1. `te = message.latestDisplayHint`.
2. If undefined: last `readFilePaths` entry through `wd()`, else last `searchArgs` entry wrapped in
   double quotes (**L427899–427902**).
3. If active, scan in-flight progress messages (**L427903–427921**):
   - `repl_tool_call` in phase `start`/`executing` ⇒ `input.file_path ?? "\"pattern\"" ?? input.command ?? toolName`
   - `mcp_progress` ⇒ `"<msg> (<pct>%)"` / `"<pct>%"` / `"<msg>"` / `"Processing… <n>"`; message
     whitespace-collapsed and truncated to 199 chars + `…`
4. Debounced: `de = e8p(te, MAH)` with `MAH = 700`ms (**L427922, L428157, L427401–427413**) — the hint
   updates at most every 700 ms.
5. Thinking summary wins when present: `ae = QWp(isActive ? latestThinkingSummary : undefined, DAH)`
   with `DAH = 3000`ms linger (**L427922, L427382–427396**). When shown it renders
   `<km dimColor italic>{OAH(text, columns − 5, 10)}</km>` — italic, dim, wrapped to
   `columns − X8o` and clamped to `PAH = 10` lines with a trailing `…` (**L428062, L428105–428120**).
6. Otherwise the plain hint is split on `\n` and each line rendered `dimColor`; the bash progress
   suffix is appended to the **last** line only (**L428062–428063**).

**R4.8 Hint value builders.** `wd(path)` (**L36791–36799**) = cwd-relative path if it does not escape
the cwd, else `~`-prefixed, else absolute. `KFs(cmd)` (**L301889–301894**) = `"$ "` + command with
each line whitespace-collapsed and blank lines dropped, truncated to `wMd = 300` chars + `…`.
`Wfo(cmd)` (**L165431–165442**) = the leading `# comment` line of a shell script (excluding `#!`),
used in preference to `KFs` for bash hints. Search patterns and MCP queries are wrapped in `"`.

### 4.5 Elapsed suffix `· Ns` — `V8p`, **L428087–428104**

```js
zp(shouldAnimate ? 1000 : null);          // re-render every second
let elapsed = Date.now() - anchorMs;
if (elapsed < 2000) return null;          // L428091–428092
return <Text>{" · "}<Text bold>{ra(elapsed)}</Text></Text>;   // L428100
```

**R4.9** Rendered as `" · "` (space, middle dot, space) followed by the **bold** duration, and only
after **2000 ms**. `ra` (**L107033–107039**): `<60 s` ⇒ `Math.floor(ms/1000)+"s"` (`0s` for exactly 0);
above that, `Nm Ns` / `Nh Nm Ns` / `Nd Nh Nm`.

**R4.10** The anchor `Re` is the timestamp of the most recent in-flight tool_use message and is only
computed **when `ds()` is true** (`if (s && ds())`, **L427963–427974**). Without fullscreen there is
no elapsed suffix.

### 4.6 Bash progress suffix — **L427946–427962**

```js
let he = "";
if (ds() && isActive) {
  // over in-flight ids, take the largest bash_progress/powershell_progress elapsedTimeSeconds
  if (maxSec !== undefined && maxSec >= 2) {
    let d = ra(maxSec * 1000);
    he = totalLines > 0 ? ` (${d} · ${totalLines} ${totalLines === 1 ? "line" : "lines"})`
                        : ` (${d})`;
  }
}
```

**R4.11** Format is `" (12s · 340 lines)"` or `" (12s)"`, threshold **2 seconds**, appended to the last
hint line, `ds()`-gated.

---

## 5. ERRORS

**R5.1** `Ima` computes `A = fhr(message).some(id => lookups.erroredToolUseIDs.has(id))` (**L427896**)
and passes it **only** as `isError` to `ile` (**L428062**).

**R5.2** Therefore an errored read has **no visible effect on a settled collapsed row**: the settled
leader is an empty `<Box minWidth={2}>`, so there is no glyph to color. There is no red text, no
error marker, no count adjustment.

**R5.3** While active, `isError` forces the glyph to render solid (no blink-off frame) but the color
stays `undefined`/dim because `isUnresolved` is true (**L422353**). The `error` color only appears on
a *resolved* standalone tool row.

**R5.4** The per-run `erroredToolUseIds` set collected by `Le_` (**L302153–302159**) is used for exactly
one thing: filtering memory ops out of the summary — `memoryOps.filter(op => op.toolUseId === undefined
|| !erroredToolUseIds.has(op.toolUseId))` (**L302144**). It is not attached to the emitted message.

**R5.5** In brief mode (`NMd` with `keepAllText`), errored tool_use/tool_result pairs are pulled back
out of the summary and rendered standalone (**L302400–302430**).

---

## 6. VERBOSE / ctrl+o

**R6.1 Trigger.** The collapsed row renders expanded when `verbose || isTranscriptMode`
(**L429333**: `const tE = hz || y2` passed as `Ima`'s `verbose`). So ctrl+o (transcript screen)
expands every collapsed row.

**R6.2 The verbose branch returns early at L427923–427943 — the summary row is NOT rendered at all.**
Its children, in order:

1. For each message in the group whose `content[0]` is text containing `<task-notification`
   (`Iy = "task-notification"`, **L17765**): `<Box marginTop=1><Rvr param={{type:"text",text}}/></Box>`
   (**L427930–427934**).
2. Flatten assistant + grouped messages, then for each `content[0]` (**L427935–427941**):
   - `thinking` with text ⇒ `<Box marginTop=1><zAr param addMargin={false} isTranscriptMode verbose/></Box>`
   - `tool_use` ⇒ `<W8p content tools lookups inProgressToolUseIDs shouldAnimate theme/>`
3. Hook lines (**L427942**): a header `"  ⎿  " + "Ran " + N + " PreToolUse hook(s) (" + ELt(total) + ")"`
   then one `"     ⎿ " + command + " (" + ELt(ms) + ")"` per hook. All `dimColor`. Note the
   **5-space + `⎿` + single space** prefix on the per-hook lines, distinct from the 2-space form.
4. Relevant memories (**L427942**): `"  ⎿  Recalled " + basename(path)` then the memory body in a
   `paddingLeft={5}` box.

**R6.3 `W8p` is the standard tool row** (**L427800–427863**):
`<Box flexDirection="column" marginTop={1} key={id}>` containing
`<Box flexDirection="row">[<ile shouldAnimate={animate && inProgress} isUnresolved={!resolved}
isError={errored}/>][<Text bold>{tool.userFacingName(input)}</Text>][ "(" + Q3t(tool, input,
{verbose:true}) + ")" ][ renderToolUseTag(...) ]</Box>`, then the verbose result
`renderToolResultMessage(parsedOutput, [], {verbose:true, tools, theme})` (**L427846**), then
`Cma` (§8). Same `ile` + bold-name + parenthesized-args shape as the standalone renderer at
**L424755–424761**, so R6's premise holds. The `⎿` on results comes from each tool's own
`renderToolResultMessage` via the `Cr` gutter (**L406888–406917**), not from `W8p`.

**R6.4** Verbose adds **no timestamps**. Timestamps are a separate orthogonal setting
(`showMessageTimestamps` + `Ke("tengu_silk_hinge")`, **L456875**) applied by the outer row wrapper.

---

## 7. `grouped_tool_use`

**R7.1 Construction — `bdf`, L452545–452606.** Groups tool_use blocks that share
**the same assistant `message.id` AND the same tool name**, with a minimum of **2** (**L452560**),
and **only for tools that declare `renderGroupedToolUse`** (`bGH`, **L452532–452537**).
The emitted node (**L452591**):

```js
{ type:"grouped_tool_use", toolName, messages: f, results: g,
  displayMessage: f[0], uuid: `grouped-${f[0].uuid}`, timestamp: f[0].timestamp, messageId }
```

The member tool_use messages and their matching tool_result user messages are removed from the list
(**L452594–452603**).

**R7.2 Exactly one tool declares `renderGroupedToolUse`: `Agent` (`qo`)** — UI table at **L430977**:
`Mya = { [qo]: { renderGroupedToolUse: Xha, … } }`. Not MultiEdit, not Read. So `grouped_tool_use` is
in practice **the parallel-subagent batch**.

**R7.3 Rendering — `xma` → `Xha`, L428214–428228 / L429748–429760.** `xma` builds a per-call record
(`isResolved`, `isError`, `isInProgress`, `progressMessages`, `result`) and delegates. `Xha` renders:

```
[ile spinner]  <b>N</b> background agents launched (↓ to manage)     // all async, all resolved
[ile spinner]  <b>N</b> [<Type> ]agents finished                     // resolved, not async
[ile spinner]  Running <b>N</b> [<Type> ]agents…                     // unresolved
                                                    + " " + <Bg/>    // unless all async
[per-agent rows via jla, one per call]
```

`<Bg/>` (the `(ctrl+o to expand)` hint) is suppressed when every call is async (**L429760**).
`Type` is shown only when all calls share one agent type and it is not the generic `"Agent"`.

**R7.4 Differences from `collapsed_read_search`:**

| | `collapsed_read_search` | `grouped_tool_use` |
|---|---|---|
| Built by | `PMd` (**L302123**), over a *contiguous run* of *different* tools | `bdf` (**L452591**), over *one assistant message*, *one* tool name |
| Membership rule | classification-based (`isCollapsible`) | `renderGroupedToolUse` presence + count ≥ 2 |
| Renderer | `Ima` — one aggregate sentence with counts | `Xha` — a header line **plus one child row per call** |
| Expand | verbose/transcript renders `W8p` per call | the tool owns its verbose rendering |
| Extra keys | ~25 counter fields | `toolName`, `results`, `messageId` |

**R7.5** A `grouped_tool_use` node is itself eligible for the collapse pipeline: `ve_`, `be_`, `MMd`,
`we_` all understand the type (**L302011–302016, L301947–301951, L302031–302036, L302053–302056**), and
`VFt` is applied to `messages[0].input` with `toolName`. Since `Agent` has no `isSearchOrReadCommand`
it is never collapsible, so in practice grouped nodes flush the run and render standalone.

**R7.6** `Ee_`/`be_` results are memoized in a `WeakMap` keyed by message, invalidated when the tools
array or the resolved tool changes (**L301931–301940**).

---

## 8. The `cHr` predicate

**Definition — L373043–373045:**

```js
function cHr(e) { return e.startsWith(PBo) || e.startsWith(nB_); }
```

with (**L376061**):
- `PBo = "Permission for this action was denied by the Claude Code auto mode classifier. Reason: "`
- `nB_ = "Permission for this action has been denied. Reason: "`

**R8.1 `cHr` detects a permission-denial tool_result** — either an auto-mode-classifier denial or a
generic permission denial.

**R8.2 Its use in `Cma`** (**L427865–427893**, the component rendered by `W8p` at L427855): it finds the
tool_result matching the tool-use id and **returns `null` unless** the content is a string that
`cHr` matches (**L427877, L427881–427882**). So `Cma` is "render the permission-denial explanation
under an errored tool call, and nothing else". `W8p` invokes it only when `resolved && errored`
(**L427855**).

**R8.3** The rendered form comes from `v4t` (**L427717–427744**):
`<Cr><Text dimColor>Denied by auto mode classifier · <reason> · see <link></Text></Cr>`,
where the reason is extracted by `IVs` (**L373046–373053**, text between the prefix and
`". If you have other tasks"`) and the link points at
`https://code.claude.com/docs/s/claude-code-auto-mode`.

---

## 9. Answer to the `Oqy` set at L282649

`Oqy = new Set(["Read","Write","Edit","Glob","Grep","NotebookEdit","TodoWrite","TaskCreate","TaskGet",
"TaskList","TaskStop","TaskUpdate"])` (**L282649**) is used only by `rvd` (**L282638–282646**), which
returns a **native timeout in milliseconds** for a tool invoked through the REPL tool wrapper:
Bash/PowerShell → configured bash timeout, one other tool → 30 000 ms, **members of `Oqy` → 10 000 ms**.
It has **nothing to do with rendering or collapsing.**

---

## 10. Glossary of resolved identifiers

| Symbol | Line | Meaning |
|---|---|---|
| `Za` | 41484 | `"⏺"` (⏺) on macOS, `"●"` (●) elsewhere |
| `ile` | 422343 | 2-col leader box: blinking `Za`, dim while unresolved, `success`/`error` once resolved |
| `Bg` | 421333 | dim `(ctrl+o to expand)`; null inside `SAr`/`q3e` contexts |
| `$e` | 183855 | chord renderer; `parens` ⇒ `"(<chord> to <action>)"` |
| `Pmy` | 186448 | string form: `chalk.dim("(ctrl+o to expand)")` |
| `wd` | 36791 | display path: cwd-relative, else `~/…`, else absolute |
| `g3` | 184138 | `+N` in `diffAddedWord`, space, `-N` in `diffRemovedWord`; null when both 0 |
| `Cr` | 406888 | result gutter `"  " + "⎿ "`, dim, aria-hidden; nested `Cr` renders children bare |
| `ra` | 107033 | duration formatter (`12s`, `1m 5s`, `2h 3m 4s`, `1d 2h 3m`) |
| `ELt` | 107030 | `(ms/1000).toFixed(1) + "s"` |
| `X8o` | 424984 | gutter width `5` |
| `MAH`/`DAH`/`PAH` | 428157 | hint debounce `700`, thinking-summary linger `3000`, summary max lines `10` |
| `wMd` | 302645 | command-hint truncation `300` |
| `rRo` | 302645 | thinking-gap cap `600000` ms |
| `jyH` | 422340 | blink period `600` ms |
| `Z4p` | 422328 | bell-after-unresolved `5000` ms |
| `lGp` | 424984 | max memory-op lines `5` |
| `aPa` | 456874 | non-transcript tail cap `30` messages |
| `$Z` | 112934 | `[Bash, PowerShell]` |
| `mwo` | 242526 | `{Edit, Write, NotebookEdit}` |
| `Fg`/`ZS`/`qo`/`C5` | 108477 / 77880 / 108173 | `"REPL"` / `"ToolSearch"` / `"Agent"` / `"Task"` |
| `fl`/`nu`/`RT`/`ri`/`Vi` | 100719 / 100726 / 100726 / 100705 / 100726 | `Edit` / `Write` / `NotebookEdit` / `Bash` / `PowerShell` |
| `W2e` | 301617 | `CLAUDE_REPL_VERBOSE && s1()` — REPL verbosity |
| `Iy` | 17765 | `"task-notification"` envelope tag |
| `BC` / `die` | 104957 | `"(no content)"` / `"No response requested."` |

---

## 11. Minimum faithful-clone checklist

1. Classify each tool call with the `VFt` priority chain (R1.1–R1.3); default `ds()` to false (R2.1).
2. Accumulate over **contiguous runs**, flushing on assistant prose / non-collapsible tool /
   user prompt; never flush on errors, thinking, attachments, system messages (R1.8).
3. Dedupe reads by path; drop `readOperationCount` when any path-bearing read exists (R1.5).
4. Emit no row when every call was absorbed (R3.1); ratchet counts monotonically (R3.2).
5. Settled row = `"  "` + dim(`clauses` + `" "` + `"(ctrl+o to expand)"`), first clause capitalized,
   counts bold, no `⎿` line (R3.4–R3.8).
6. Active row = blinking dim `⏺` + non-dim(`present-participle clauses` + `"…"` + `" "` +
   `"(ctrl+o to expand)"`), plus a `"  ⎿  "` hint line, 700 ms debounced (R4.1–R4.8).
7. `· Ns` after 2 s and the bash `(Ns · N lines)` suffix are fullscreen-only (R4.9–R4.11).
8. Errors are invisible on a settled row (R5.2).
9. ctrl+o replaces the row with per-call `⏺ Tool(args)` + result blocks, thinking blocks,
   hook lines, and memory recalls — never with the summary line (R6.1–R6.4).
10. `grouped_tool_use` is the parallel-`Agent` batch only, with its own header + per-agent rows (R7.2–R7.3).


## 12. Click-to-expand

The `/tui` switch announcement advertises `· Click to expand collapsed tool results` (**L453184**;
the steady-state variant at **L454487** words it `· Click to move your cursor or expand collapsed
results`). This section resolves what actually backs that line.

### 12.1 Availability — fullscreen only

**R12.1 Mouse reporting is emitted only by the alt-screen component `uet`.** On mount it writes
`pVe() + AUe(mouseTracking)` (**L535814**) and on unmount `Gpe` (the disable bundle) (**L535817,
L535820**). `AUe` (**L177057–177066**) maps the mode string to DECSET bundles built at **L177070**:

| mode | sequence | modes set |
|---|---|---|
| `"full"` | `rcy` | `1000` MOUSE_NORMAL + `1002` MOUSE_BUTTON + `1003` MOUSE_ANY + `1006` MOUSE_SGR |
| `"scroll"` | `ncy` | `1000` MOUSE_NORMAL + `1006` MOUSE_SGR |
| `"off"` | `""` | none |
| (teardown) | `Gpe` | disables `1006`, `1003`, `1002`, `1000` |

**R12.2 The mode comes from `bHe()` (L110210–110216):** `"off"` when `CLAUDE_CODE_DISABLE_MOUSE` is
set truthy, `"scroll"` when `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` is set truthy, otherwise **`"full"`**.
So click reporting is on by default *wherever the alt screen is on*, and `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1`
is the documented way to keep wheel-scroll but kill click-to-expand.

**R12.3 `uet` is mounted only in fullscreen.** Three gates, all `ds()`-derived:

- main chat screen: `if (ds()) return Xge(YU(fNn)); return YU(fNn);` (**L549519–549521**), where
  `Xge` (**L549377–549381**) is `embedded ? <Box …> : <uet mouseTracking={bHe()}>`
- transcript screen: `if (_t) return Xge(YU(jn)); return YU(jn);` (**L549391–549393**) with
  `_t = embedded || (ds() && !searchBarOpen && !disableRenderCap) ? scrollRef : undefined` (**L549385**)
- every other top-level screen: `Qhi` (**L555070–555084**) — `if (!ds()) return children;` before
  wrapping in `<uet mouseTracking={bHe()}>`

**R12.4 A second, independent gate:** click handlers exist only on the virtualized list `Ohf`, which
`czH` renders only when `re = scrollRef != null && !CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL`
(**L456875, L456997**); the non-virtual path is a plain `Ze.flatMap(Wr)` with no click plumbing.
In the chat view the scrollRef is supplied when `ds() || HVe()` (**L549395**). `HVe()`
(**L181553–181569**) is the DECSTBM scroll-region renderer — it returns `false` whenever `ds()` is
true (**L181562–181563**) and is gated on `CLAUDE_CODE_DECSTBM` or GrowthBook `tengu_marlin_porch`
(default `false`). Under `HVe` the list *is* virtualized and the `onClick` props *are* attached, but
no `uet` is mounted, so no mouse reports are ever received and nothing is clickable in practice.

**R12.5 Verdict: click-to-expand does not exist in the default (`ds() === false`) renderer.**
It requires the flicker-free/alt-screen path — `/tui fullscreen`, `CLAUDE_CODE_NO_FLICKER=1`,
`CLAUDE_CODE_SESSION_KIND=bg`, or one of the two GrowthBook gates in `ds()` (§2).

**R12.6 Corollary for the summary row.** The virtual list wraps its children in
`<q3e.Provider value={true}>` (**L456997**), and `Bg` returns `null` under that context
(**L421334–421336**). Likewise `y_s` drops the ` (ctrl+o to expand)` suffix from truncated tool
output when the same flag is passed (**L186490**: `vt.dim(Bst(u) + (r ? "" : \` ${Pmy()}\`))`, called
as `y_s(content, columns, useContext(q3e))` at **L420192**). So **in fullscreen the textual
`(ctrl+o to expand)` hint disappears from both the collapsed summary row and truncated results** —
the mouse affordance replaces it. A clone that ships both must swap them the same way.

### 12.2 What a click changes

**R12.7 Per-item expansion state is a `Set` of keys held by `czH`** (**L456924–456934**):

```js
let [expandedKeys, setExpandedKeys] = useState(() => new Set);
let onItemClick = useCallback((msg) => {                    // L456924
  let k = Zhf(msg);
  setExpandedKeys(prev => { let n = new Set(prev);
                            n.has(k) ? n.delete(k) : n.add(k); return n; });
}, []);
let isItemExpanded = useCallback(                            // L456934
  (msg) => expandedKeys.size > 0 && expandedKeys.has(Zhf(msg)), [expandedKeys]);
```

It is a **toggle**, not a one-way expand, and it is component-local state — not persisted, reset
when the transcript component remounts.

**R12.8 The key is `Zhf(msg)` (L456788–456790):**
`(msg.type === "assistant" || msg.type === "user" ? t3e(msg) : null) ?? msg.uuid` — the **tool-use
id** for assistant/user messages (so a tool_use and its tool_result share one key), and the plain
`uuid` for synthetic nodes. For a collapsed row that uuid is `collapsed-<firstMessageUuid>`
(**L302123**); for a grouped row, `grouped-<firstMessageUuid>` (**L452591**).

**R12.9 Expansion is implemented as per-item verbose.** The row factory passes
`verbose: n || isItemExpanded(msg)` into the message wrapper (**L456975**), which forwards it to
`yre`, whose collapsed branch computes `verbose = verboseProp || isTranscriptMode` (**L429333**).
So an expanded `collapsed_read_search` renders **exactly the §6 verbose layout**: one `W8p`
`⏺ ToolName(args)` + result block per call, plus thinking blocks, the `⎿ Ran N PreToolUse hooks`
lines, and recalled-memory blocks — and **the summary line is replaced, not supplemented**
(`Ima` returns from the verbose branch at **L427923–427943** before the summary row is built).

For a truncated tool result the same `verbose` flag makes `p2` skip `y_s` and render the full body
(**L420181**: `dF0 = verbose || …`), i.e. the folded output rows unfold in place.

**R12.10 Expanded rows also change container styling** (`KVH`, **L456313**):
`backgroundColor: "userMessageBackgroundHover"` and `paddingBottom: 1`.

**R12.11 What is clickable** — `isItemClickable` (**L456938–456960**), in order:

| Message | Line | Clickable? |
|---|---|---|
| `collapsed_read_search` | 456939–456940 | **always** |
| `attachment` with `goal_status` + `reason` | 456941–456945 | yes, but only when **not** verbose and **not** the transcript screen |
| `assistant` whose `content[0]` is `advisor_tool_result` / `advisor_result` | 456946–456949 | yes |
| `user` tool_result with `is_error` | 456955–456956 | yes iff `o3p(content)` (content is long enough to fold) |
| `user` tool_result, non-error | 456957–456960 | yes iff the owning tool's `isResultTruncated(result, {columns})` is true |
| anything else | 456950–456951 | no |

Note `grouped_tool_use` is **not** in that list — a parallel-Agent batch is not click-expandable.

**R12.12 Blank-cell and hyperlink rules** (**L456313–456317**):

```jsx
onClick: clickable ? (ev) => { if (ev.hyperlinkUrl) return ev.allowDefault();
                               onClickK(msg, ev.cellIsBlank); } : undefined
```
and `onClickK` ignores the event when `cellIsBlank` is true (**L456542–456545**). So clicking the
padding to the right of the text does nothing while collapsed; once expanded,
`hoverIgnoresBlankCells: !expanded` (**L456317**) relaxes the *hover* rule. Clicking a rendered
hyperlink defers to the terminal's default (open URL) instead of toggling.

**R12.13 Hover affordance.** `KVH` wraps children in `<Xho.Provider value={hovered && !expanded}>`
(**L456317**); the `Text` component reads that context and, when hovered, **stops applying the dim
color** (`rdy = dimColor && !hovered ? theme.inactive : color`, **L181678–181680**). Since a settled
collapsed row is entirely `dimColor` (R3.5), hovering it brightens the whole row. That is the only
visual "this is clickable" cue — there is no cursor change and no added text.

### 12.3 Hit-testing

**R12.14 Yes — a real geometric hit-test against the laid-out Ink tree.**
`Ksr(node, col, row, depth)` (**L178113–178145**) tests the click cell against each node's computed
rect from the layout map `bS`, descending children last-to-first (topmost wins) and honoring
`hasAbsoluteDescendant`; it bails at `MAX_TREE_DEPTH = 256` (**L178108, L178114–178115**).

**R12.15 Dispatch** — `gBu(root, col, row, cellIsBlank, hyperlinkUrl)` (**L178167–178196**):
hit-test, move focus to the nearest ancestor with a `tabIndex` (**L178171–178180**), then construct
a `vJr` event carrying `{col, row, localCol, localRow, cellIsBlank, hyperlinkUrl, allowDefault()}`
(**L178086–178101**) and **bubble `onClick` from the hit node up the parent chain**, recomputing
`localCol/localRow` per handler (**L178185–178187**). Hover uses the same hit-test in `yBu`
(**L178197–178213**), which honors `hoverIgnoresBlankCells` (**L178201**).

**R12.16 Where row geometry is maintained.** Each rendered item registers a measurement ref
`measureRef(itemKey)` on its wrapper Box (**L456313**), and the virtual-scroll hook `Imf`
(**L456320**) owns the derived map: `offsets`, `getItemTop(idx)`, `getItemElement(idx)`,
`scrollToIndex`, plus the mounted `range` and the top/bottom spacer heights. `Ohf` keeps a live
mirror in a ref (**L456323–456324**) for the imperative paths. So the click path does **not** consult
that map — the Ink layout rects (`bS`) are the source of truth for hit-testing; `Imf`'s offsets are
for scrolling and search-jump (`scanElement`/`setPositions`, **L456370, L456347**).

### 12.4 Keyboard equivalent

**R12.17 There is none.** The full default keybinding table (**L186118**) exposes, in the
`Transcript` context, only `ctrl+e → transcript:toggleShowAll`, `ctrl+c`/`escape`/`q →
transcript:exit`, and the `scroll:*` family; globally only `ctrl+o → app:toggleTranscript` and
`ctrl+shift+b → app:toggleBrief`. The exhaustive action allowlist `f_s` (**L186160**) contains no
per-block expand action at all. Expanding **one** collapsed block is mouse-only; the keyboard can
only expand **everything** (ctrl+o, which flips the whole transcript to `isTranscriptMode` and
therefore renders every collapsed row verbose per R6.1).

### 12.5 Clone checklist addendum

11. Gate click-to-expand behind the same flag as fullscreen; expose a `disableMouseClicks` escape
    hatch that downgrades mouse mode to wheel-only (R12.1–R12.5).
12. Keep expansion state as a local `Set` keyed by tool-use-id-or-uuid, toggled per click (R12.7–R12.8).
13. Render an expanded item by re-rendering it with `verbose = true` — the summary line is
    *replaced* by the per-call rows, not appended to (R12.9).
14. Suppress the textual `(ctrl+o to expand)` hint wherever click is available (R12.6).
15. Un-dim on hover is the only affordance; ignore clicks on blank cells; let hyperlink clicks
    through (R12.12–R12.13).
16. Do not offer a single-block keyboard expand — that would be a divergence, not parity (R12.17).
