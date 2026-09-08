# spec257 cross-check — session persistence UI (ch. 35) + tasks/background UI (ch. 20)

Lane: `/resume` picker + `/rename` `/export` `/fork`; `/tasks` panel, `activeForm`, `<task-notification>` rendering.
Bundles read: `~/claude-code-bundle/{2.1.220,2.1.251,2.1.257}/cli.pretty.js`. Every item marked **verified** carries a
line I read myself in at least one bundle; **spec-only** means I took the spec's word.

---

## 1. Corrections — things we BUILT that canon does differently

### C1. Every chord in the picker's three footers is lower-cased in ours; canon title-cases it. **verified**
Ours: `harness/src/tui/sessionPickerModel.ts:97` `RESUME_FOOTER = "space to preview · Ctrl+R to rename · Type to search · esc to cancel"`,
`:128` `RENAME_FOOTER = "enter to save · esc to cancel"`, `:129` `PREVIEW_FOOTER = "enter to resume · esc to cancel"`.
Canon (§35.19.8): the footer children are `{chord, action}` pairs rendered through the `F` hint component
[`2.1.257/cli.pretty.js:297453`], whose **default** format is `{keyCase:"title", modCase:"lower", charCase:"preserve"}`
[`:319866`] and whose key table is `{enter:["Enter",…], escape:["Esc",…], " ":["Space",…]}` [`:319894`]. `chord:"space"`
and `chord:"enter"` carry **no** `format` override, so they render `Space` / `Enter`; `Esc` is a literal `fallback:"Esc"`
on the `confirm:no` hint. Preview footer confirmed at [`:297024`] (`chord:"enter", action:"resume"` + `fallback:"Esc"`).
User-visible: our three footers read `space to preview … esc to cancel` where canon reads `Space to preview … Esc to cancel`.
**220→251→257:** identical formatter and identical footer construction in all three (`2.1.220:183852-183853` / `:476627`,
`2.1.251:315985` / `:878481`). This is a transcription miss at 220, not drift. Our own source comment at
`sessionPickerModel.ts:95-96` claims upstream "prints `space`/`enter`/`esc` in lower case through `$e`" — that is the bug.

### C2. The picker row's description drops canon's size clause, mis-styles the time, and never shows `#tag`. **verified**
Ours: `sessionPickerModel.ts:47-52` `sessionMeta` = `<relative> · <branch>`, with `formatRelativeTime`
(`harness/src/tui/format.ts:100-108`) producing the **narrow** form `3h ago`.
Canon `jet`/`Nqr` (§35.19.7) [`2.1.257:287667-287676`, `2.1.220:107122-107131`]:
`[vy(modified,{style:"short"}), …"bg", …gitBranch, fileSize?Ut(fileSize):`${messageCount} messages`]` then `#tag`,
`@agentSetting`, `repo#PR`, joined `" · "`. Two consequences:
* `style:"short"` is **not** the narrow branch — `P1` only special-cases `"narrow"` and otherwise falls through to
  `Intl.RelativeTimeFormat("en",{style:"long"})` [`2.1.257:287648-287659`, `2.1.220:107104-107114`]. So canon list rows read
  `3 hours ago` and only the *preview* footer (which passes no options) reads `3h ago`. Ours reads `3h ago` everywhere.
* Field order is `time · bg · branch · size` — the size clause sits **after** the branch, and `Ut()` is the byte formatter
  (§35.19.7, `2.1.257:359697`). `fileSize` and `tag` both exist on `SDKSessionInfo`
  (`harness/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4776`, `:4796`), so both clauses are reachable.
**220→251→257:** byte-identical in all three.

### C3. `/rename` with no argument: ours prints the current title, canon generates one. **verified**
Ours: `harness/src/tui/useChat.ts:2416` — `if (!cmd.args) { … notice("title: <customTitle> — /rename <new title> to change") }`,
advertised at `harness/src/tui/commands.ts:100`.
Canon `performRename` (§35.20) [`2.1.257:762034-762052`]: an empty argument runs the kebab-case name generator
(§35.15.5 prompt at `chunk-vnapv42r.js:761982`) and, when there is nothing to summarise, answers the literal
`Could not generate a name: no conversation context yet. Usage: /rename <name>` — present verbatim in **all three**
bundles (`grep -c` = 1 each). Success line `Session renamed to: ${name}` likewise in all three
(`2.1.220`, `2.1.257`). User-visible: `/rename` alone is a no-op status line for us and a real feature upstream.
**220→251→257:** no drift. Reachability: the SDK has no name-generator entry point, but a one-shot `query()` over the
transcript with that prompt is ordinary client work.

### C4. `/export` is a Markdown file writer for us and a two-option plain-text dialog upstream. **verified**
Ours: `harness/src/tui/sessionTools.ts:23-41` (`EXPORT_HEADER = "# ccx conversation"`, `exportMarkdown`,
`defaultExportName` → `conversation-<id8>.md`) driven from `harness/src/tui/useChat.ts:2374-2390`; the command summary
at `harness/src/tui/commands.ts:95` says "export the conversation as markdown".
Canon (§35.21) [`2.1.257:334661`]: no argument opens a dialog whose verbatim strings are `Export conversation` /
`Select export method` / `Copy to clipboard` / `Copy the conversation to your system clipboard` / `Save to file` /
`Save the conversation to a file in the current directory` / `Enter filename:` [`:334605-334633`]; the payload is the
**rendered transcript with `Bun.stripANSI` applied**, not Markdown [`chunk-bq8epagv.js:395437-395440`]; the default
filename is `<YYYY-MM-DD-HHMMSS>-<first-prompt-slug>.txt` with the slug rules at [`:334642-334657`]; result strings are
`Conversation copied to clipboard`, `Conversation exported to: <path>`, `Failed to export conversation: <msg>`,
`Export cancelled`. `Select export method` is present in all three bundles. Canon's declared description is
`Export the current conversation to a file or clipboard` (present in 220 and 257).
Our overwrite guard (refuse unless the file starts with `EXPORT_HEADER`) has no canon twin — canon just writes.
**220→251→257:** no drift. Scorecard scores this ✅ at `docs/parity/tui-ux.md:2296` with no divergence note.

### C5. Our picker lists the session you are already in; canon's `/resume` removes it and all sidechains. **verified**
Ours: `harness/src/tui/useChat.ts:2587` `openPicker()` passes `listSessions(NARROWED_SCOPE)` straight through; nothing
filters the live id. Canon [`2.1.257:641708`] `filter((S) => !S.isSidechain && zc(S) !== g)` — present identically at
`2.1.251:850277` and `2.1.220:476813`. §35.19.3 spells out why: the in-component `ue` current-id exemption only
short-circuits the *first* eligibility test, and the slash-command path removes the row before the component sees it.
User-visible: our top row is usually "resume the conversation you are in".

### C6. The `(N of M)` header clause is dim in canon, plain in ours. **verified**
Ours: `harness/src/tui/SessionPicker.tsx:283-288` renders `resumeHeader(...)` — one string — inside a single
`<Text bold color="suggestion">`, so the count inherits bold+suggestion.
Canon [`2.1.257:297435`]: `children: ["Resume session", L==="list" && W.length > Ie && <Text dimColor>{" (N of M)"}</Text>, …]`
— title bold/suggestion, count clause **dim**. Identical at `2.1.220:476609`. Our own comment at
`SessionPicker.tsx:47-49` already states "this header carries a dim `(3 of 47)` clause"; the implementation lost it.

### C7. The task panel's second line prints `activeForm`; canon prints the owner teammate's live activity. **verified**
Ours: `harness/src/tui/TaskPanel.tsx:57` — `const activity = inProgress && !blocked && task.activeForm ? …`.
Canon's row takes `activity` as a prop sourced from the running-subagent progress map
`X[identity.agentName] = recentActivities ?? lastActivity.activityDescription` [`2.1.257:439586-439593`], passed as
`activity: x.owner ? X[x.owner] : void 0` [`:439627`]. Grepping the whole panel range `439560-439700` for `activeForm`
returns **zero** hits; the row only reads `subject`, `status`, `owner`. So canon shows the sub-line **only for a task
whose owner is a live teammate**, and never for an ownerless in-progress task. Ours shows it for every in-progress
unblocked task that carries an `activeForm`. Impact: an extra dim line per in-progress task versus canon.
This is a defensible substitution (no teammate registry headlessly) but the scorecard presents it as parity
(`docs/parity/tui-ux.md:2183`-region row "Task/todo panel", "the in-progress `activeForm` sub-line"), and it should be
recorded as a divergence instead. **220→251→257:** identical in 220 (`2.1.220:407190`) and 257.

### C8. Preview footer pluralisation. **verified**
Ours: `sessionPickerModel.ts:147-150` `previewMeta` → `${count} ${count===1?"message":"messages"}`.
Canon hardcodes the plural: `[lt, " ·", " ", U.messageCount, " messages", Qt]` [`2.1.257:297019`,
`2.1.251:878047`, `2.1.220:476179`]. A one-message session reads `1 messages` upstream. Low stakes; listed because our
file claims byte-fidelity to `dGa` L476179.

### C9. `/tasks` (our `/bg`) is missing the `Completed` section — added between 220 and 251. **REAL 220→251 DRIFT, verified**
Ours: `harness/src/tui/bgDialogModel.ts:20-23` — sections `agents · shells · monitors · tasks`, transcribed from
`rsi` at 2.1.220 L481110-481256.
Canon section table [`2.1.220:481255`] is `agents, shells, monitors, mcp-tasks, cloud-agents, local-agents, workflows,
dream, auto-mode-scan`. **`{key:"completed", label:"Completed"}` appears in `2.1.251:120611` and `2.1.257:408137` and is
absent from 2.1.220.** §20.14.1 gives its membership rule `Ywe`: completed `local_agent`s that are backgrounded, not
observers, `evictAfter !== 0`, and whose only keepalive is the idle-window flag. Our finished rows (from
`harness/src/tui/bgTaskMeta.ts:90-95`) currently sort into whichever type-derived section they came from, so a completed
agent stays under `Agents`. Reachability: our snapshot carries `task_type` + a synthesised terminal status, so a
"Completed" bucket is buildable; the exact `Ywe` predicate (keepalive reasons, `evictAfter`) is not on our wire — FLAG.

### C10. The `/tasks` footer omits two canon key rows and the subtitle omits one clause. **verified**
Ours: `bgDialogModel.ts:93` `BG_FOOTER = "↑↓ select · enter view · x stop · escape close"`; `bgSubtitle` (`:71-77`) emits
only `N agents` and `N active shells`. `grep -n '"f"\|foreground\|killAgents'` over `BgTasksPanel.tsx` returns nothing.
Canon's input guide [`2.1.220:481255`, `2.1.251:120611`, `2.1.257:408137` — identical in all three] carries
`select · view · foreground · stop · stop all agents · close`, i.e. an `f` row and a nested `ctrl+x ctrl+k` row, and a
three-clause subtitle `agents · active shells · active agents`. §20.14.2 also records that `ctrl+x ctrl+k` is a
*label only* in the dialog — the chord is executed by the chat-level `chat:killAgents` binding.
Reachability: foregrounding a background subagent has no SDK client equivalent — FLAG; the third subtitle clause does.

### C11. The picker loads 30 sessions once; canon enriches in 50s and paginates. **verified (constants), spec-only (load-more mechanics)**
Ours: `harness/src/tui/useChat.ts:773-774` — `readSessions({… limit: 30})`, no load-more anywhere. Beyond row 30 a
session is unreachable from the picker *and* unfindable by the search box (our filter is client-side over the loaded set,
`sessionPickerModel.ts:56-60`).
Canon (§35.19.1/.5/.6): enrichment batch `var hWe = 50` [`2.1.257:161314`]; picker constants
`var Ir=2, Mr=4, Or=2000, mn=1000, hn=50000, Nr=0.3, Fr=60000, Br=50, $r=5` [`2.1.257:297192`; the same list at
`2.1.220:476665`]; load-more fetches three screens when focus is within two screens of the end and gives up after
`$r = 5` consecutive empty requests.

### C12. Empty-state gating. **verified**
Ours: `SessionPicker.tsx:296-300` shows `noConversations(scope)` whenever the raw list is empty, regardless of the query.
Canon [`2.1.257:297435`]: the `No conversations found…` element is gated on `i.length===0 && L==="list" && !N && !Le.trim()`
— an empty query is required — and its `Ctrl+A` hint is `w ? void 0 : <hint>` (suppressed once all-projects is on).
Ours therefore answers "No conversations found in this project." to a typed query over an empty store where canon
answers `No sessions match "<q>".` Cosmetic, listed last.

---

## 2. Unknown unknowns — canon behaviour with no `tui-ux.md` row and no implementation

**U1. `/branch` — the transcript fork — has no row anywhere, and the SDK primitive is already wired.**
§35.22.1 [`2.1.257:144920`, impl `chunk-9hj16ntd.js:347191-347650`]: `/branch [name]` copies the in-memory conversation
into a brand-new `<sessionId>.jsonl` in the same project, rewriting each record with
`{sessionId, parentUuid, isSidechain:false, forkedFrom:{sessionId, messageUuid}}`, then titles it by taking the derived
first prompt (whitespace-collapsed, truncated to 100 chars, else the literal `Branched conversation`) and appending
`" (Branch)"`, `" (Branch 2)"`, `" (Branch 3)"` — the lowest free integer among titles matching
`^<base> \(Branch(?: (\d+))?\)$`. Success line, verbatim [`:347634`]:
`Branched conversation${T}. You are now in the new branch (session ${r}). Use /resume ${n}${E} to return to the original, or run \`claude -r ${n}\` in a new terminal.`
Failure `Failed to branch conversation: ${I}`; refusals `No conversation to branch`, `No messages to branch`.
`grep -n '/branch' docs/parity/tui-ux.md docs/parity/tech-debt-tracker.md` → nothing. **Reachability: high.**
`forkSession()` is exported from the SDK (`sdk.d.ts:733`), already wrapped at `harness/src/sessions/fork.ts:10`, already
used by `harness/src/daemon/supervisor.ts:270` and `harness/src/appserver/sessionLib.ts:329`, and already probed
(`probes/probes/59-fork-transcript-copy.ts`). The only missing piece is the REPL command + the unique-title rule.
**verified** (declaration and success string read in `2.1.257`).

**U2. `<task-notification>` coalescing in the transcript.** §20.10.8 [`2.1.257:126259-126284`, eligibility
`:126212-126235`]: consecutive user messages whose *first* text block is a well-formed `<task-notification>` with
`<status>completed</status>` and a `<`-free `<summary>` collapse into a single synthetic row
`<task-notification><status>completed</status><summary>${n} background commands completed</summary></task-notification>`
(family chosen by the summary prefix `Background command ` / `Remote task "`; the remote family renders
`${n} remote tasks completed`). Both literals are present in all three bundles. Coalescing is **skipped** in the
transcript screen and in show-all mode, which is what lets the individual rows stay visible there. Ours renders one row
per notification unconditionally (`harness/src/tui/species.ts:378-388`); `grep -rn 'background commands completed'` over
`harness/` returns nothing. **Reachability: full** — this is a pure projection-layer rule over messages we already hold,
and our verbose/`ctrl+o` distinction maps onto canon's show-all/transcript exemption. **verified.**

**U3. The optimistic streaming preview of `TaskCreate`/`TaskUpdate`.** §20.6 [`2.1.257:81941-81979`]: while an assistant
message is *still streaming*, partial tool inputs are parsed (`c({subject:i(), activeForm:i().optional()})` and the
`TaskUpdate` sibling with a fourth `"deleted"` status) and projected into a provisional todo list keyed by tool-use id;
the real id is learned later by matching the tool result against `/^Task #(\S+) created successfully/` (constant `Gmo`,
present in all three bundles). `TaskCreate`/`TaskUpdate` additionally return
`{type:"set_expanded_view", expandedView:"tasks"}` from `call` [`:113583`, `:113746`], which force-opens the panel.
Ours (`harness/src/tui/taskList.ts:56-62`) does the same tool-use→result id matching but only from the *completed*
assistant frame, and nothing forces the panel open. Reachability: the id-matching half is already ours; the streaming
half needs partial-JSON tool input from `stream_event`, which the SDK does emit — worth a probe before designing. **verified.**

**U4. `/tasks` auto-opens the detail view.** §20.14.3 [`2.1.257:407960-407967`]: with an `initialDetailTaskId`, or when
exactly one task qualifies and it is viewable and not a completed-but-retained agent, the dialog opens **directly on the
detail pane**; when the detail's task disappears it closes if it auto-opened and otherwise falls back to the list. Ours
always opens on the list. No scorecard row. **spec-only** (I did not read 407960).

**U5. The picker's display-eligibility filter.** §35.19.3 [`2.1.257:297243-297254`, read directly]: before any scope
filter, a row survives only if it is the current session, **or** carries `customTitle ?? aiTitle`, **or** `m_t(messages)`
holds, **or** has a `firstPrompt`. Ours renders every row `listSessions` returns. Reachability: `summary`/`firstPrompt`
are on `SDKSessionInfo`, so a title-or-prompt eligibility test is buildable; the `m_t(messages)` arm is not. **verified.**

**U6. In-list navigation keys we do not have.** §35.19.9 + [`2.1.257:297363-297396`, read directly]: `/` (unmodified)
enters search; `Ctrl+V` is a second preview trigger beside `Space`; `j`/`k`/`ctrl+n`/`ctrl+p`/`pageup`/`pagedown`/`home`/`end`
are bound in the shared `Select` context [`:112105`]; digits `1`–`9` select by position and `0`/out-of-range digits are
`preventDefault`ed into silent no-ops. We ship `Ctrl+V` (`SessionPicker.tsx:212`) but not `/`, and `hideIndexes` removes
the digit column by design. `/` is the only cheap missing one and there is no row for it. **verified.**

---

## 3. Known gaps now specified — the spec supplies what we lacked

**G1. `CTRL-B-1` is founded on a false premise, and the spec settles it.** Our permanent recorded divergence
(`harness/src/tui/sessionPickerModel.ts:16-21`) says: *"Ctrl-B (all branches) is a PERMANENT RECORDED DIVERGENCE:
`listSessions` has no branch axis, and the only branch datum we hold is the `gitBranch` a row happens to carry — which
cannot widen a query it never narrowed."* Canon's Ctrl+B **is not a widening**. It is a pure client-side filter over the
already-loaded rows, defaulting to **off**: `[q, Be] = d(!0)` [`2.1.257:297218`] and
`if (!q && Z) t = t.filter((a) => a.gitBranch === Z)` [`:297255-297256`] — read directly. The footer label pair is
`q ? "only show current branch" : "show all branches"` [`:297453`], and the hint is gated on `Z` (a known current branch)
existing. So Ctrl+B **narrows** to the current branch and is exactly implementable against our `gitBranch` field.
Scorecard rows to revise: `docs/parity/tui-ux.md:2256` and `:1688`. **verified.**

**G2. The row's size clause — DG51's named "reachable and simply not built" arm.** `docs/parity/tui-ux.md:1688` already
records `fileSize` (`sdk.d.ts:4776`) as reachable but had no formatter. Canon supplies it verbatim (§35.19.7,
[`2.1.257:359697`]): `e=t/1024; e<1 → "${t} bytes"; e<1024 → "${e.toFixed(1).replace(/\.0$/,"")}KB"; …MB; …GB` — and the
field's position (fourth, after the branch) and the fallback `${messageCount} messages` when `fileSize` is absent.
Same code at `2.1.220:107122`. **verified.**

**G3. `#tag` in the description and in the search haystack — reachable, and not in DG51's list.**
`SDKSessionInfo.tag` exists (`sdk.d.ts:4796`). Canon appends `#${tag}` to the description [`2.1.257:287670`] and matches
the query against **display title, gitBranch, tag and `pr #<n> <repo>`** [`:297280-297284`]. Ours matches title +
sessionId only (`sessionPickerModel.ts:56-60`) — so of canon's four haystack fields we have two reachable (title, branch,
tag) and match one. We also have `/tag` shipped (`docs/parity/tui-ux.md:2301`), so tagged sessions are currently
unsearchable in our own picker. **verified.**

**G4. `/rename` sanitisation, which we do not do at all.** §35.15.3 [`2.1.257:675040-675045`, `OA = 200` at `:674288`,
`En` at `:685678`]: `ds()` = trim → collapse `[\p{Cc}\p{Cf}  ]+` runs to one space → delete `[\x00-\x1f\x7f-\x9f]`
→ truncate to **200 code points** → trim; an empty result is a rejection with
`That name is empty once invisible characters are removed. Usage: /rename <name>`. Note the asymmetry the spec pins:
`ds` is applied by `/rename` but **not** by the picker's inline Ctrl+R rename, which calls `saveCustomTitle` with only
`String.prototype.trim` [`:297340`] — which is exactly what ours does (`SessionPicker.tsx:183`), so our picker path is
already right and only the `/rename` path is missing the sanitiser. **spec-only** for `ds` internals; the refusal
string I did not re-grep.

**G5. `/export`'s slug and stamp algorithm** (see C4): `bt()` stamp `YYYY-MM-DD-HHMMSS`, slug = first user record's text
→ first line only → truncate to 49 + `…` **only if longer than 50** → lower-case → strip `[^a-z0-9\s-]` → `\s+`→`-` →
collapse `-+` → trim `-`; empty slug ⇒ `conversation-<stamp>.txt`; extensionless path gets `.txt`; parent dirs created
[`2.1.257:334642-334657`, `:334545-334552`]. Ours is `conversation-<id8>.md` (`sessionTools.ts:38-40`). **spec-only.**

**G6. The `/tasks` per-kind row labels and section membership** (§20.14.1, [`2.1.257:408146-408168`]): `local_bash` →
`description` when `kind==="monitor"` else `command` (ours matches, `bgDialogModel.ts:49-50`); `local_agent` →
`description`; `in_process_teammate` → `@${identity.agentName}`; `local_workflow` → `summary ?? description`. Also the
header-suppression rule ours does not model: `Agents` renders only when a shell/cloud-agent/local-agent/completed row
exists, `Shells` only when a teammate/cloud/local/completed row exists, and the other five section arrays never lift the
suppression — so a list of teammates plus monitors shows the teammates **unheaded**. Headers render as `  <Label> (<count>)`
(ours matches). **verified** for the section table, **spec-only** for the suppression predicate.

---

## 4. Verbatim assets worth pinning (we do not have these)

Point-only; all cites are `2.1.257/cli.pretty.js` unless noted.

* **Picker constants** `:297192` — `Ir=2, Mr=4, Or=2000, mn=1000, hn=50000, Nr=0.3, Fr=60000, Br=50, $r=5`; enrichment
  batch `hWe = 50` at `:161314`. (Our `RESUME_CHROME_ROWS=10` is our own; canon's is `8 + (breadcrumb?1:0) + 2` over
  3-row options, `:297419`.)
* **Row badges** `:297209-297211` — ` (sidechain)`, ` (+${N} other session)` / ` (+${N} other sessions)`, and the
  artifact badge `  ⧉ ${N}` (glyph resolved: `Kl = "⧉"` in `chunk-yte5spsr.js`, range `839572-839671`). Child rows
  indent `"    "`; all-projects appends ` · ${projectPath}` (`:297213`).
* **Byte formatter `Ut`** `:359697` (see G2).
* **Title resolver `getLogDisplayTitle`** `:577603-577605` — full ladder including `agentName`, `aiTitle`, the
  `Autonomous session` fallback for a `<tag>`-opening firstPrompt, and the XML-block stripper
  `/<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g` at `:577551`. Ours (`sessionPickerModel.ts:39-42`) has no stripper;
  `SDKSessionInfo` folds `aiTitle` into `summary`, so only the stripper and the fallback are actionable.
* **`--resume` host-screen copy** (§35.19.8, `chunk-gknwc3xw.js:526973-527091`) — `Loading conversations…`,
  `Resuming conversation…`, `Failed to resume the conversation.`, `This conversation is from a different directory.`,
  `(Command copied to clipboard)`, the background-holder refusal pair, and the constructed
  ` ${cd <dir> &&|;} claude --resume <id> --fork-session` line. We have no equivalent surface; if `ccx --resume` ever
  grows failure copy, this is the source. Terminal title while the picker is open: `claude · resume` [`:526823`].
* **`/rename` outcome sentences** `chunk-vnapv42r.js:762034-762052` — `Session renamed to: ${i}`,
  `Session renamed to: ${i} ("${c}" is held by another live session on this machine)`,
  `Session is named: ${i} (a newer rename landed first)`, and the registry-failure suffix
  `. Other sessions may still show the old name: the session registry could not be updated (run with --debug for the cause)`.
* **`/export` dialog + result strings** `chunk-8yc58w5k.js:334605-334633`, `:334574`, `:334585`, `:334588`, `:334599` (C4).
* **`/branch` strings** `chunk-9hj16ntd.js:347634`, `:347638`, `:347642` (U1).
* **`<task-notification>` element grammar** §20.10.1-.2 [`:577472`, `:577478`, `:48598-48606`] — tag order
  `task-id, tool-use-id, task-type, output-file, status, summary`, each dropped when falsy, `body` concatenated raw,
  `trailing` appended *outside* the element; XML escaper `Bt` escapes `&` then `<` then `>` only
  [`chunk-krrpw763.js:584774`]. Our `species.ts` reads `<summary>`/`<status>`/`duration_ms` — the rest of the grammar is
  unmodelled and is what a coalescer (U2) would need.
* **Background-shell summary grammar** §20.10.5 [`:127917-127936`] — `Background command "<desc>" completed (exit code N)`,
  `… failed with exit code N`, `… was stopped`, and the four `Monitor "<desc>" …` variants (note: monitors say `exit`,
  bash says `exit code`). These arrive on our wire pre-composed, so they are reference, not build targets — except that
  the `Background command ` prefix (`Lke`, `:577478`) is the coalescing family key.
* **Todo-panel arithmetic** §20.6 [`:439596-439700`] — header two shapes, overflow order in-progress→pending→completed,
  glyph/colour table. All three already ours (`taskPanelModel.ts`); pinned here only because the citation moved.

---

## 5. Confirmations — things we built that the spec confirms

* `Resume session` title, ` (N of M)` gating on `list && filtered > visible`, ` · Refreshing…` — text exact
  (`sessionPickerModel.ts:65-69` vs `:297435`).
* Empty states `No sessions match "<q>".` / `No conversations found.` / `No conversations found in this project.` and
  the scope-awareness of the last two — exact (`:80-84` vs `:297435`).
* `Rename session:` + the `Enter new session name` placeholder resolved through the title ladder, and rename starting
  from an **empty** buffer (`ve("")` at `:297392`) — exact.
* `Ctrl+A`/`Ctrl+W` label pairs and the "name the state you move to" convention, plus the `Ctrl+W`-needs-multiple-worktrees
  gate — exact (`sessionPickerModel.ts:101-118` vs `:297453`).
* Preview replaces the picker element wholesale rather than sitting beside it; preview meta line is
  `<relative> · <N> messages[ · <branch>]`; `Loading session…` renders bare with no frame — all confirmed by §35.19.
* `Ctrl+V` as the second preview trigger, and `Esc`-clears-then-closes semantics (canon splits it across modes; ours
  folds it, as recorded) — `:297393`.
* Picker inline rename applies only `.trim()`, no `ds()` sanitisation, no uniqueness check — ours matches canon exactly
  (`SessionPicker.tsx:183` vs `:297340`).
* Todo panel: window `rows<=10 ? 0 : min(5,max(3,rows-14))`, `RECENT_COMPLETE_MS = 30000`, id comparator, sort order
  fresh-completed → in-progress → pending(unblocked first) → old-completed, overflow clause order and zero-dropping,
  header's two shapes with `open` counting only `pending`, glyphs `✔`/`◼`/`◻` with colours `success`/`claude`/none,
  `(@owner)` at ≥60 columns, ` › blocked by #a, #b`, subject width `max(15, cols-15-ownerWidth)` — all byte-identical
  between `taskPanelModel.ts`/`TaskPanel.tsx` and `:439572-439700`.
* Spinner `activeForm ?? subject` ladder — `harness/src/tui/spinner.ts:339` matches the fallback rule the `TaskCreate`
  prompt states (§20.6, `:113540`).
* Background dialog: title `Background`, `No tasks currently running`, the never-printed
  `Background dialog dismissed` (`display:"skip"`), `  <Label> (<count>)` headers, `x` = stop, `escape` = close —
  all confirmed at `:408137-408181`.
* `/tasks` + `/bashes` as the canonical names with no upstream `/bg` — confirmed in all three bundles; our alias
  inversion is already a recorded keep-decision (`commands.ts:66-72`).
* `<task-notification>` species classification by `text.includes("<task-notification")` and rendering the `<summary>`
  with a status-coloured bullet — consistent with §20.10.

---

## 6. Spec defects

**D1. §20.6 misattributes the `activeForm` fallback to the inline task panel.** The section opens "Three consumers
implement that fallback" and names "**1. The inline task panel** [`chunk-c872axth.js:439572-439700`]". That module never
reads `activeForm`: `grep -c activeForm` over lines `439560-439700` of `2.1.257/cli.pretty.js` returns **0**, and the row
component only touches `dt.owner`, `dt.status`, `dt.subject`. The panel's second line is the *owner teammate's* live
progress description (`X[identity.agentName] = Tmt(progress.recentActivities) ?? progress.lastActivity.activityDescription`,
`:439586-439593`, passed as `activity:` at `:439627`). The real consumers of the `activeForm ?? subject` fallback are the
spinner, the rate-limit `RESUME.md` checkpoint (§20.6 item 2) and the background-job fan projection (item 3). The
section's own prose two paragraphs later ("A second line shows the owner's live activity description") contradicts its
own numbered list. Consequence for a reimplementer: they will wire `activeForm` into the panel row, which is exactly the
divergence we shipped (C7).

**D2. §35.19.8 minor — the "plain session list" example footer omits `Ctrl+B`.** The spec renders the canonical list
footer as `Ctrl+A to show all projects · Space to preview · Ctrl+R to rename · Type to search · Esc to cancel`, but the
`Ctrl+B` item is gated only on `Z` (a known current git branch) [`:297453`], which is true in every git repo. In the
overwhelmingly common case the real footer carries `Ctrl+B to only show current branch` between the `Ctrl+A` and `Space`
items. Not wrong, but the "so a plain session list renders …" framing will mislead. (Not a defect in the underlying
table, which lists the condition correctly.)
