# W1 (C4) anchor scout — remaining tool-result formatters + retrofit inputs

**Scope:** campaign spec `docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`, child **C4 / W1**.
Read-only scouting against the pinned extraction `~/claude-code-bundle/2.1.251/modules/`, with `cli.pretty.js`
for readable windows. No build, gate, or recording was run. Counts are real substring counts (`str.count`) over
the exact file set `strangle/prepare.ts:textModules()` uses — `cli` plus every `*.js` under the modules dir —
never `grep -c`; every anchor was also counted across **five** bundles (2.1.220 / 234 / 236 / 241 / 251) as a
survival signal. Capture classes follow §2.4 and each cites the helper's actual body.

## 1. Targets — summary

| # | Target | Anchor (proposed) | Count 251 / 5-ver | Chunk | Pretty line | Shape | Node chars | Captures | Covering scenario |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Read** result | `PDF pages extracted: ` | 1 / 1,1,1,1,1 | `chunk-fy12d89p.js` | 490807 | sibling-method | 1590 | 8 | `file-tools` (exists) |
| 2 | **Edit** result | `All occurrences were successfully replaced.` | 1 / 1,1,1,1,1 | `chunk-fy12d89p.js` | 512873 | sibling-method | 672 | 1 | **none — new `edit-tool`** |
| 2b | **Edit** validator (errors) | `String to replace not found in file` | 1 / 1,1,1,1,1 | `chunk-fy12d89p.js` | ~512790 | sibling-method (`validateInput`) | 3317 | many (fs/gate/telemetry) | **none — see §4** |
| 3 | **Bash** result | `<error>Command was aborted before completion</error>` | **2 / 2,2,2,2,2** | `chunk-fy12d89p.js` (twin in `chunk-hw8qz4q5.js`) | 515942 | sibling-method | 1269 | 11 | `bash-tool` (exists) |
| 4 | **Grep** result | `"occurrence":"occurrences"` | 1 / 1,1,1,1,1 | `chunk-fy12d89p.js` | 466459 | sibling-method | 964 | 2 | `search-tools` (exists) |
| 5a | **TaskGet** result | `Blocked by: ${` | 1 / 1,1,1,1,1 | `chunk-fy12d89p.js` | 479769 | sibling-method | 450 | 0 | **none — new `task-family`** |
| 5b | **TaskUpdate** result | `Task completed. Call TaskList now` | 1 / 1,1,1,1,1 | `chunk-fy12d89p.js` | 479954 | sibling-method | 428 | 2 | **none — new `task-family`** |
| 5c | **TaskList** result | `No tasks found` | 1 / 1,1,1,1,1 | `chunk-fy12d89p.js` | 480020 | sibling-method | 390 | 0 | **none — new `task-family`** |

All eight are methods on per-tool **object literals** — exactly the shape
`ast.ts:matchesShape("sibling-method")` accepts (`isMethodDeclaration` with an `ObjectLiteralExpression`
parent), identical to the three owned splices. **No new target shape is needed.** Row 2b (`validateInput`) is
the same shape but a validator, not a formatter — see §4. New minified surface if all seven formatters land:
**5,763 chars**, against 805 owned today.

## 2. Captures, classified (§2.4), with proposed derivations

`ID` below is `manifest.ts`'s `[A-Za-z_$][\w$]*`. Every derivation anchors on non-identifier text, so a rename
cannot silently change what it selects and a moved shape fails loudly (the `pick()` contract).

### 2.1 Read (`switch(e.type)` over image / notebook / pdf / parts / file_unchanged / text)

| as | graph id | class | evidence | derive |
|---|---|---|---|---|
| `notebookResultBlock` | `hyt` | pure-helper | local fn; folds notebook cells to blocks, params only | `case"notebook":return(ID)\(` |
| `formatBytes` | `Ft` | pure-helper | `chunk-n2te6bm7.js` **single-export chunk**; pure `bytes→"12.3KB"` | `PDF file read: \$\{ID\.file\.filePath\} \(\$\{(ID)\(` |
| `seededUnchangedNotice` | `oYn` | pure-helper | `chunk-hx5r9amq.js`; pure template over a path | `==="seeded"\?(ID)\(` |
| `unchangedNotice` | `rYn` | pure-helper | `chunk-hx5r9amq.js`; returns a constant string | `:(ID)\(\)\};case"text"` |
| `stalenessPrefix` | `_Pt` | **effectful-port** | reads module WeakMap `wPt` populated by the Read **call** path, then `Date.now()`-derived day count (`cqt`) | `\.content\)ID=(ID)\(` |
| `numberLines` | `tVt` | pure-helper | `chunk-vvj94wew.js`; pure cat -n over content | `\+(ID)\(\{\.\.\.ID\.file,tabAwareSeparator:` |
| `tabAwareSeparator` | `XDe` | **effectful-port** | gate read `gpe("tengu_tab_read_sep", !1)` — resolves to compiled-in `false` under C3's pinned disabled state | `tabAwareSeparator:(ID)\(\)\}` |
| `numberOneLine` | `nVt` | pure-helper | `chunk-vvj94wew.js`; `` `${n}${sep}${line}` `` with `\r` strip | `\+(ID)\(""` |

`_Pt` is the one awkward capture: a **side channel**, not an argument. `wPt.set(result, mtime)` runs inside the
Read tool's `call` (pretty 491070) only for memory-directory files (`qS(path)`), and the formatter then renders
`<system-reminder>This memory is N days old…</system-reminder>\n` — stateful *and* clock-dependent. The corpus
never populates it (recorded `file-tools` Read result is `"1\tREFORGE_FILE_BODY\n2\t"`, no prefix).

### 2.2 Edit — one capture; 2.3 Bash — eleven

`freshnessSuffix` = `q6t`, `primitive`, the **same constant the Write splice already derives** — but Edit's use
site is a *nested* conditional (`staleRecovered ? "(note: …)" : userModified||memdirStamped ? "" : q6t`), which
the Write row's `ID=ID||ID?"":(ID)` pattern does not match, so it needs its own regex: `\?"":(ID);if\(`. Bash's eleven:

| as | graph id | class | evidence |
|---|---|---|---|
| `imageResultBlock` | `y1t` | pure-helper | local; base64 sniff + block build, no I/O |
| `splitPreview` | `Vze` | pure-helper | `chunk-9bs8dvhj.js`; pure length split on a newline boundary |
| `previewBytes` | `$De` | **primitive** | `chunk-9bs8dvhj.js`: `var $De=2000` |
| `persistedOutputNotice` | `rue` | pure-helper | `chunk-9bs8dvhj.js`; pure string build over its argument object |
| `newline` | `kK` | **primitive** | `` var kK=`\n` `` |
| `backgroundNotice` | `b1t` | pure-helper | local; parameters only |
| `backgroundOutputPath` | `yl` | **effectful-port** | `chunk-13d9rycm.js`: reads the live `outputPathBindings` registry + session dir |
| `readToolName` | `_t` | **primitive** | `chunk-bsdtxcdc.js`: `var _t="Read"` |
| `useTaskAck` | `FE` | pure-helper | `chunk-2z83fvw5.js`: `function FE(){return!1}` — constant in this build, but it is a policy predicate; own it, do not inline `false` into the formatter's structure |
| `taskAckEnvelope` | `GMt` | **effectful-port** | local; reaches `xQe()` (gate) and `K9e()` (configured timeout) through `Q0e()` |
| `taskAckEnding` | `qMt` | **effectful-port** | local; `xQe()` gate |

All eleven derive off non-identifier text: `readToolName:(ID)\}`, `=(ID)\(\{filepath:`,
`=(ID)\(\{backgroundTaskId:`, `outputPath:(ID)\(`, `ending:(ID)\(`, `if\((ID)\(\)\)return\{tool_use_id`,
`\+=(ID);ID\+="<error>Command was aborted`.

### 2.4 Grep (two captures) and the task family

**Grep:** `paginationNote` = `iEe` (`pure-helper`; local, builds `"limit: N, offset: M"`), derive
`"content"\)\{let ID=(ID)\(`; `plural` = `k` (`pure-helper`; `chunk-04aem4bh.js`,
`k(n, sing, plural=sing+"s")`), derive `\$\{(ID)\(ID,"file"\)\}`.

**Task family:** TaskGet and TaskList take **zero** captures. TaskUpdate takes two, both `effectful-port`: `rb` (agent/team
context lookup, `chunk-mk4am7jk.js`) and `io` (env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` + gate
`tengu_amber_flint`, `chunk-9rtx6cwj.js`); derive with `\?\.to==="completed"&&(ID)\(\)&&` and
`==="completed"&&ID\(\)&&(ID)\(\)\)`. Both are false headlessly, so its completion-nudge branch is dead in the
corpus — say so in the row rather than pretending it is covered.

## 3. The Bash anchor problem (parent-impact)

The Bash formatter's body contains **no graph-unique string literal**. Its complete literal set is `""`,
`"string"`, `"text"`, `"tool_result"` (577 graph-wide) and `"<error>Command was aborted before
completion</error>"` — which occurs **twice in every one of the five bundles**: `chunk-fy12d89p.js` (the Bash
tool the corpus reaches) and `chunk-hw8qz4q5.js` (the Windows/PowerShell sibling, which shares the permission
chunk). `build.ts` requires graph-total === 1, so the pure-literal anchor is rejected today.

Minimal unique extensions were computed in both directions and both are identifier-tainted:
`…</error>"}let p` (depends on the minified local `pe` still starting with `p`) and `e+="<error>…` (tail of
`fe`). Both bet on a minifier letter — the bet this project already watched lose twice in one bump
(`hui`→`q6t`, `yzv`→`APn`).

**Recommendation:** ask C1 (contract X3) for an optional `chunk?: string` scoping field on `Splice`; the build
then asserts uniqueness *within* the declared chunk (verified: 1 hit in `chunk-fy12d89p.js`) and still fails
loudly if the anchor is absent or doubled there. The literal-anchor bet stays intact and the chunk name is
already in the footprint ledger. Fallback: the identifier-tainted anchor, flagged fragile in the row.
Property-name anchors were evaluated too (`staleReadFileStateHint:`, `ghRateLimitHint:`, `backgroundCwdHint:`
survive minification) but each occurs 3× in the chunk and pairing two crosses a minified binding.

## 4. Edit's error results are a different function

`"String to replace not found in file."`, `"Found N matches of the string to replace, but replace_all is
false…"`, `"File has been modified since read…"` and `"File has not been read yet…"` are **not** produced by
`mapToolResultToToolResultBlockParam`. They are returned by the Edit tool's `async validateInput(...)` as
`{result:!1, behavior:"ask", message, errorCode}` — a separate sibling-method, 3,317 minified chars, ending
immediately before the formatter (pretty ~512790–512870). Its anchor is unique across all five bundles and its
shape is supported, but it is a validator with fs reads, `readFileState` access, telemetry
(`s("tengu_edit_tool_stale_read", …)`) and gate reads — mostly `effectful-port` captures, and roughly four
times the body of any formatter in this wave. **Recommendation:** keep it out of C4's formatter set and record
it as its own ledger row for the validator sub-family (the census row is "formatters **+ validators**"). If C4
takes it anyway it needs its own scenario (a deliberately-missing `old_string`) and a separate gate row.

## 5. Coverage — what exists, what must be authored

Verified against `reforge/transcripts/m1-*-A.jsonl`, which record the exact tool_result each formatter produced:

| Formatter | Scenario | Recorded result | Branch coverage |
|---|---|---|---|
| Read | `file-tools` | `"1\tREFORGE_FILE_BODY\n2\t"` | 1 of 6 result types (`text`); `_Pt` prefix empty; separator `\t` |
| Bash | `bash-tool` (also traversed by `hooks`, `partial-tool-args`, `parallel-tools`) | `"REFORGE_TOOL_OK"` | stdout-only; stderr / interrupted / background / persisted-output / image branches unexercised |
| Grep | `search-tools` | `"Found 1 file\nneedle.txt"` | `files_with_matches` only; `content` and `count` modes unexercised |
| Glob (owned) | `search-tools` | `"needle.txt"` | truncation branch **never taken** → `APn` is 0%-covered |
| Write (owned) | `file-tools`, `search-tools` | `"File created successfully at: … (file state is current in your context — no need to Read it back)"` | `create` only; `update` unexercised |
| TaskCreate (owned) | `todo-tool` | `"Task #1 created successfully: REFORGE_TODO_ITEM"` | full |
| Edit | — | — | **none** |
| TaskGet / TaskUpdate / TaskList | — | — | **none** |

Confirmed: the 22-scenario corpus (m1 9 + m2c 8 + m3 5) contains **no Edit scenario and no TaskGet/TaskUpdate/
TaskList scenario**. Two new scenarios are the minimum for C4's gate; the depth scenarios below are what W1's
declared corpus family ("per-tool result depth") actually asks for.

**`edit-tool` (required).** Prompt: Write `${SANDBOX}/edit-target.txt` with three exact lines
(`ALPHA`/`BETA`/`ALPHA`); Edit `BETA`→`GAMMA`; then Edit with `replace_all: true` turning `ALPHA`→`DELTA`;
reply exactly `EDIT_OK`. Substance check: `Write` used, `Edit` used **twice** with `replace_all` true exactly
once, every `file_path` inside `SANDBOX`, final text contains `EDIT_OK`. Formatter output made observable:
`The file <p> has been updated successfully.<suffix>` and `The file <p> has been updated. All occurrences were
successfully replaced.<suffix>` — both branches plus the `q6t` suffix, so solo sabotage cannot stay green.

**`task-family` (required).** Prompt, in order: `TaskList` (before creating anything), `TaskCreate` two tasks
(`REFORGE_TASK_ONE`, `REFORGE_TASK_TWO`), `TaskList` again, `TaskGet` the first, `TaskUpdate` the first to
`completed`; reply exactly `TASKS_OK`. `allowedTools` all four, `maxTurns: 8`. Substance check: each tool used
at least once, both subjects present in tool inputs, final text `TASKS_OK`. Formatter output made observable:
`"No tasks found"`, `#1 [pending] REFORGE_TASK_ONE`, TaskGet's multi-line `Task #1: …/Status: …/Description: …`,
and `Updated task #1 status`. Note in the row that TaskUpdate's completion-nudge branch stays dark headlessly
(`rb() && io()` both false).

**Depth scenarios (recommended, same wave).** `read-depth`: read a file twice (second read takes
`file_unchanged` → `rYn()`), read an empty file, and read with `offset`/`limit`. `grep-modes`: one Grep with
`output_mode:"content"` and one with `"count"` over the needle file, covering `iEe` and the pluralization arm.
`bash-stderr`: one command that writes to stderr and exits nonzero, covering the stderr arm and `is_error`.

## 6. Retrofit inputs for the three existing splices

**`write-tool-result` — `freshnessSuffix` (`primitive`).** The owned value is exactly, in
`chunk-hx5r9amq.js` as `q6t`, and unchanged across all five bundles:

```
" (file state is current in your context — no need to Read it back)"
```

One leading space, an em dash U+2014 (not a hyphen), no trailing space; independently confirmed by the recorded
Write result in `m1-file-tools-A.jsonl`. Retrofit: the owned module declares the constant and the adapter
equality-asserts the graph's `q6t` against it per delegation. The **Edit** formatter consumes the same
constant, so it belongs in one shared owned constants module, asserted from both adapters.

**`glob-result` — `truncationNotice` (`pure-helper`).** Graph function `APn` (2.1.241: `yzv`), pretty 466304.
Exact semantics, to be reimplemented and used in both wirings:

- `totalMatches === undefined` → `"(Results are truncated. Consider using a more specific path or pattern.)"`
- `countIsComplete` truthy → `` `(Showing ${shown} of ${totalMatches} matching files; ${totalMatches - shown} more are not listed. Narrow the pattern or path to see the rest.)` ``
- otherwise → `` `(Showing the first ${shown} files; there are more than ${totalMatches} matches. Narrow the pattern or path to see the rest.)` ``

where `shown = output.filenames.length`. The corpus **never** truncates, so this helper has zero differential
coverage — the §2.4 contract test is not optional here. Minimum partitions: `totalMatches` undefined;
`countIsComplete` true with remainder > 0 and with remainder 0; `countIsComplete` false.

**`task-create-result`.** No captures; the retrofit is layout-only (`reference`/`custom`/`sabotage` files plus
skeleton registration) — nothing crosses the adapter.

## 7. Parent-impact items for C4

1. **Bash needs a manifest change or a fragile anchor** (§3) — the one item reaching back into C1's X3 schema;
   everything else in W1 fits the shipped mechanism unchanged.
2. **Edit's error mapping is a separate 3.3k-char validator** (§4) — an explicit scope call, not a discovery.
3. **Read's `_Pt` is a WeakMap + clock side channel** (§2.1) — the only capture here that cannot become owned
   data; declare it a typed port and a ledger edge to the Read-execution wave.
4. **Bash's solo-sabotage blast radius is four scenarios**, not one (`bash-tool`, `hooks`, `partial-tool-args`,
   `parallel-tools`). Name them all in the row's `coverage` so the expected-RED set is not read as a regression.
5. **Two new scenarios gate the wave** (`edit-tool`, `task-family`); both need live recording, which
   serializes through the orchestrator per X5 — schedule them before implementation lands.
6. **Branch coverage is thin where the gate is not** (§5): sabotaging a whole method reddens its scenario even
   when the corpus touches one branch of six. The depth scenarios are what make W1's GREEN mean §3.1's GREEN.
