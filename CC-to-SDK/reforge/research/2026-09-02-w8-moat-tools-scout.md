# W8 moat-tools scout — the catalog, the cross-session layer, and what the campaign has wrong (pin 2.1.251)

Scope: C11 / W8 ("moat tools"), the campaign's next non-executor wave. READ-ONLY: no build, no gate,
no recording, no scenario was run; nothing outside this file was written.
Method: substring counts over the **1,802-file** module set (`cli` + every `.js`, the set
`strangle/prepare.ts:textModules()` builds); TypeScript-parser spans over the owning chunks;
`import{…}`/`import.meta.require` graph walks; and — new for this scout — **the 267 recorded cassette
request bodies read as the artifact for the tool catalog**. Scratch scripts in `/tmp/w8scout/`.
Grounding: campaign spec §1.2/§1.3/§2.1/§2.3/§2.4/§6-W8 + the C1 and C10.5 Revision Notes;
`2026-08-31-engine-census.md`; `2026-09-01-w5-w7-anchor-scout.md` (format and doctrine);
`reforge/README.md` wave records; `reforge/ledger.json`; `research/fixtures/*.json`.

---

## 0. Six corrections, before anything is budgeted

Every prior scout corrected the census. This one corrects the **spec**, the **README**, the **ledger**
and one **fixture** as well. Full list with evidence in §7; the six that change what W8 must do:

1. **The headless catalog is not "31 native tools". The baseline is 22, and 31 is a union that is
   never presented at once.** Measured from every recorded request body: 184 of 267 cassettes carry
   exactly **22** tools; the largest catalog any single session ever presented is **28**. The union
   over all 267 is **32** natives — §1.3's 31 plus `PowerShell`. §1.3 reads as a fixed catalog and is
   used that way by the ledger; it is a union. (§1)

2. **Four of the tools §1.3 lists are model-gated off for the corpus's own model.** `TaskCreate`,
   `TaskGet`, `TaskUpdate`, `TaskList` sit behind `KW()` → `FL()`, whose live arm is a **model-version
   comparison** against `XRn=[["opus",[4,8]],["sonnet",[5]],["fable",[5]],["mythos",[5]]]`. For
   `claude-sonnet-5` the comparison passes, so the tools are **suppressed** and the fall-through is
   `I("tengu_rosy_wren", false)`. Three of the four cassette families that carry them get them by
   **accident** — `claude-reforge-does-not-exist` and `claude-haiku-4-5` fail the version regex, which
   flips the gate open. (§1.2)

3. **`Read` does not leave the tool array when the PowerShell gate is flipped.** `reforge/README.md`
   ("An override changes the headless tool catalog itself — `Read` leaves the presented tool array and
   `PowerShell` takes its place") and the spec's C3 Revision Note ("swaps `Read` out of the headless
   tool catalog for `PowerShell`") both read a **positional** diff as a substitution. Measured from the
   two cassettes: baseline 22 tools, flipped **23**, `PowerShell` inserted at index 10 by the
   alphabetical sort in `SD`, `Read` shifted 10→11 and still present. The flip-liveness verdict is
   unaffected and the correct claim is stronger and simpler: **an in-allowlist override ADDS a tool to
   §1.3's moat surface.** (§7.3)

4. **The interrupt helpers are not W8's, and their row is an exclusion, not a debt.** C10 routed
   `Uq`/`jG`/`Ddt`/`Odt`/`O4e` here with the condition "an interrupt with live tasks, artifact
   subscriptions or a queued command, which W8's task family creates more cheaply". Measured: every
   one of them filters on the **artifact** auto-react surface and nothing else — `Uq` acts only on
   registry rows where `zdr(u)` (an armed auto-react subscription) holds, and `Pdt`/`Ddt` select on
   `origin.source ∈ {artifact-auto-react, artifact-room, artifact-changed, artifact-watch-lifecycle}`.
   The task family never sets `autoReactSlug`: the property has exactly **two** writers bundle-wide,
   both on the artifact auto-react WebSocket path, and that path runs through `Monitor`, which is
   gate-dead (below). So the condition is doubly guarded and headlessly uncreatable, and artifacts are
   already §1.2-excluded. (§4.4)

5. **`Monitor` — the "persistent notifications" half of the user's moat — is gate-dead at this pin,
   with no lever.** `MonitorTool.isEnabled(){return RI()&&as()}` and
   `RI(){return I("tengu_amber_sentinel",!1)}`. The gate's compiled-in default is `false`
   (`gate-defaults-2.1.251.json`), §3.3 pins every gate to its compiled-in default, and
   `tengu_amber_sentinel` is **not** among the 13 per-gate env overrides in that same fixture — so
   flip-liveness cannot reach it either. Monitor is absent from all 267 recorded catalogs, and the
   guards, not the absence, are what rule it out. (§2.4)

6. **Cross-session messaging IS live on the headless path — the opposite of what "moat, therefore
   probably unreachable" would predict.** `Yo()`, the kill switch for the whole surface, is
   `I("tengu_harbor_kite", true)` — default **TRUE**, so it survives §3.3's pinned-disabled state. The
   headless CLI's `setup()` calls `startCrossSessionInbox`, the headless streaming loop
   (`chunk-dvbbv89q.js`'s `ky`) wires `setOnPeerMessageStatus` and `setOnEnqueue` and carries its own
   headless-specific message (`[cross-session-inbound] headless: held peer message expired (no
   approval surface) — dropped with an expired receipt`), and `SendMessage` is in **all 267** recorded
   catalogs. The engine binds a Unix-domain socket and writes a `<config>/sessions/<pid>.json` record
   on every reforge run today. (§6)

---

## 1. The tool catalog, derived from the artifact

### 1.1 Where the catalog is built

`Y0()` in `chunk-fy12d89p.js` (@2431796, 793 B) is the master catalog builder: a single `return [...]`
with **67 top-level array elements**, most of them guarded spreads. `Xve()` (@2431696, 100 B) maps it
to enabled names; `bE` (@2432771, 973 B) applies the context filter; `SD` (@2433745, 167 B) merges MCP
tools and sorts by name. The moat tools are **not** "`fy12d89p` various" as §1.1's table says: 21 of
them are lazily pulled from **dedicated chunks** via `import.meta.require("/$bunfs/root/chunk-….js")`
inside `Y0`'s enclosing var-statement — dynamic requires, so they never appear in the static import
list a `deriveArgs` walk reads.

### 1.2 What is actually presented, measured over 267 cassettes

| shape | cassettes | tools | delta from baseline |
|---|---|---|---|
| baseline | 184 | **22** | — |
| + plan-mode family | 51 | 25 | `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode` |
| + task family | 19 | 26 | `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList` |
| + MCP | 4 | 23 | `mcp__reforge__echo_token` |
| + task + search | 4 | 28 | task family **and** `Glob`, `Grep` |
| + search | 4 | 24 | `Glob`, `Grep` |
| + PowerShell flip | 1 | 23 | `PowerShell` |

The baseline 22, in the order the engine sorts them: `Agent, Bash, CronCreate, CronDelete, CronList,
Edit, EnterWorktree, ExitWorktree, ListAgents, NotebookEdit, Read, RemoteTrigger, ReportFindings,
ScheduleWakeup, SendMessage, Skill, TaskOutput, TaskStop, WebFetch, WebSearch, Workflow, Write`.

**The two conditional families are opened by `allowedTools`, not by anything else.** Inside the option
normalizer in `chunk-fy12d89p.js`, one statement reads
`THn([ti,Xo].some(W)), AHn(nne.some(W))` — where `W` tests membership in the caller's `allowedTools`,
`[ti,Xo]` is `[Glob, Grep]`, and `nne=[TodoWrite,TaskCreate,TaskGet,TaskUpdate,TaskList]`. `THn` sets
`searchToolsOptIn`, which makes `Ny()` false, which makes the `lle()` exclusion set empty, which lets
Glob and Grep back in. `AHn` sets `todoToolsOptIn`, which short-circuits `FL()` to true, which enables
the task family regardless of model.

This corrects a comment in the corpus itself: `m2c/scenarios.ts`'s `todo-tool` note says "`allowedTools`
does not narrow the catalog under `bypassPermissions`". It does not narrow — but for these two families
it **widens**, and that is the cheapest lever W8 has for reaching the task tools deterministically.

### 1.3 Per-tool enablement guards (the gate-dead / entrypoint-dead / policy-dead split)

For every `Y0()` element that is NOT in the headless catalog, the named guard:

| tool | where | guard | class |
|---|---|---|---|
| `Monitor` | `chunk-7yzcjv8p.js` (`KEr`, 601 B + base `fe` 900 B); barrel `chunk-w975qc62.js` | `RI()&&as()`; `RI(){return I("tengu_amber_sentinel",!1)}` | **gate-dead**, no env override |
| `REPL` | `fy12d89p` `rG`, 3,630 B | `ty()` — requires `CLAUDE_CODE_ENTRYPOINT ∈ {cli,remote}` **and** `I("tengu_slate_harbor",!1)` | entrypoint-dead **and** gate-dead |
| `Poll` | `chunk-6xxyyh05.js`, 793 B | `U2()` — `CLAUDE_CODE_POLL_EVENTS===!0 && …` | env-dead |
| `TodoWrite` | `fy12d89p` `ESt`, 938 B | `!nw()&&FL()`; `nw()` false only when `CLAUDE_CODE_ENABLE_TASKS===!1` | superseded by the task family |
| `SendUserMessage` | `fy12d89p` `Jyt`, 2,033 B | `Ewe()||cue()` (coordinator mode / `pewter_owl_tool`) | mode-dead |
| `ToolSearch` | `chunk-j2t0e5ck.js` | `b_()` — first-party base URL required; a proxied run cannot satisfy it | unreachable by construction under the harness proxy |
| `PowerShell` | `chunk-hw8qz4q5.js`, tool object 7,739 B | `Ck()` — `CLAUDE_CODE_USE_POWERSHELL_TOOL` / `I("tengu_cobalt_ridge",!1)` | **reachable** through the in-allowlist override |
| `LSP`, `SendFeedback`, `SendFile`, `SendUserFile`, `Projects`, `DesignSync`, `EndConversation`, `ProposeGoal`, `ProposeSkills`, `PushNotification`, `ShareOnboardingGuide`, `ReadNotifications`, `ShowOnboardingRolePicker`, `Artifact` | various dedicated chunks | per-tool `isEnabled()`; the three connector tools share `isEnabled: P8` | product-periphery, §1.2-excluded |

`ListAgents` is the interesting one that IS enabled: `isEnabled(){return Yo()}` — the **same
cross-session kill switch** as `SendMessage`'s transport (§6).

---

## 2. Per tool: location, size, shape, private-field status

All sizes are minified bytes of the declaration as the TypeScript parser spans it. "Tool object" is
the `kt({…})` argument; "chunk" is the whole file.

### 2.1 The dedicated-chunk tools (the shape the census does not describe)

| tool | chunk | chunk B | tool object B | exports | static imports | consumers |
|---|---|---|---|---|---|---|
| `SendMessage` | `chunk-0ak8xf05.js` | 77,921 | 38,542 (`ms`) | 8 | 55 | 1 (dynamic, `fy12d89p`) |
| `Workflow` | `chunk-pvkxaysh.js` | 49,124 | 7,925 (`to`) | 2 | 39 | 2 (dynamic) |
| `RemoteTrigger` | `chunk-hgzkg676.js` | 18,087 | 3,421 (`Ke`) | 3 | 19 | 1 (dynamic) |
| `CronCreate` | `chunk-etg79xvw.js` | 7,529 | 1,856 (`D`) | **1** | 10 | 1 (dynamic) |
| `CronList` | `chunk-8sqz7v1v.js` | 5,745 | 864 (`T`) | **1** | 7 | 1 (dynamic) |
| `CronDelete` | `chunk-4ankbvm1.js` | 5,642 | 819 (`C`) | **1** | 6 | 1 (dynamic) |
| `ListAgents` | `chunk-44q73bmc.js` | 5,944 | 881 (`A`) | **1** | 6 | 1 (dynamic) |

**Four single-export chunks with one consumer each.** `chunk-44q73bmc.js` (ListAgents) is a smaller and
cleaner S-chunk target than the `y30v0ja7` pilot W2 already shipped: one export, six imports, and its
only consumer reaches it through `import.meta.require` — so the chunk-replacement mechanism applies
unchanged while the derived-export-name check has exactly one name to derive.

`Workflow` additionally runs `chunk-2sytyd7x.js` (28,580 B, `initBundledWorkflows`) as a side effect of
the IIFE that binds it (`f$=(()=>(…initBundledWorkflows(), …WorkflowTool))()`), so owning the tool does
not own its bundled-workflow registry.

### 2.2 The engine-chunk tools

All in `chunk-fy12d89p.js`, all `kt({…})` object literals bound to a top-level `var` — the
**`variable-declarator` + sibling-method** shape the campaign already owns (this is `mapToolResultTo…`'s
own family), not a new shape:

| tool | ident | B | @offset |
|---|---|---|---|
| `ExitPlanMode` | `r2` | 4,692 | 1870488 |
| `EnterWorktree` | `Pkt` | 4,853 | 2398999 |
| `AskUserQuestion` | `Yle` | 4,590 | 2323147 |
| `ExitWorktree` | `Okt` | 4,181 | 2409247 |
| `TaskOutput` | `hSt` | 3,826 | 2252147 |
| `TaskUpdate` | `jkt` | 3,107 | 2422768 |
| `ScheduleWakeup` | `dSt` | 2,915 | 2246014 |
| `TaskStop` | `Dre` | 1,515 | 2165711 |
| `EnterPlanMode` | `zFt` | 1,401 | 2393171 |
| `TaskCreate` | `Fkt` | 1,200 | 2416312 |
| `TaskGet` | `Ukt` | 1,079 | 2418489 |
| `TaskList` | `Gkt` | 1,043 | 2427741 |
| `ReportFindings` | `wSt` | 748 | 2265250 |

**Total across the 20 C11 tool objects: 89,458 B.** Shared cores add ~170,500 B (§4), so the wave's
honest denominator is **~260 KB minified**, not the "per-tool, scenario-led" open-ended thing §6's row
implies.

### 2.3 Private fields: the W10 blocker recurs exactly once, and it is small

Scanned every class in the moat surface (`0ak8xf05`, `pvkxaysh`, `hgzkg676`, `yx35jjkz`, `bzakfkb3`,
`jtg5esas`, `13d9rycm`, `kkfs5jjy`, `7yzcjv8p`, plus the relevant classes in `fy12d89p` / `bsdtxcdc`):

- **One class uses ECMAScript private fields:** `C_t` = `DiskTaskOutput` in `chunk-13d9rycm.js`
  (1,839 B, **12 private fields**, 12 methods) — the disk writer behind `TaskOutput` and background-job
  logs. Same shape as the Bash executor's class, one twentieth the size, and it wants a port anyway.
- **Everything else is closure- or public-field-based.** `Workflow`'s two big classes (`xe` 7,028 B /
  12 public fields / 32 methods; `ge` 5,542 B / 17 public / 21 methods) take class-method splices
  directly. The task-event queue `Tk` (`chunk-bsdtxcdc.js`, 2,167 B, 7 public fields, 12 methods) does
  too.
- **One core is neither** — and this is the harder case, not the private-field one. The
  message/notification queue is a **closure factory**, `ssn(e)` in `chunk-fy12d89p.js` (10,933 B): every
  piece of state is a `let` inside the factory (`o` the queue array, `_`/`C` the seen/terminal sets, `W`
  the uuid set, `Ee` the parked handle, `Fe` the settle promise…). There is no receiver to marshal
  through at all, so no method-level excision can reach it. It is an S-module behind a designed port or
  it is nothing. Recording this here because §2.1's private-field finding is stated as the hard case and
  a closure factory is strictly harder.

### 2.4 `Monitor`, in full, because it is the user's named moat

`MonitorTool` is `KEr` in `chunk-7yzcjv8p.js` (12,886 B), spread over a base object `fe` (900 B). Its
`mapToolResultToToolResultBlockParam` is a one-line formatter on the proven shape and renders exactly
the persistent-notification contract the user described:

> `Monitor started (task ${e.taskId}, ${e.persistent ? "persistent — runs until TaskStop or session end" : "timeout …"}). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.`

It is a 200-byte splice with a unique anchor (`Monitor started (task ` — 1× bundle-wide) sitting behind
a gate whose compiled-in default is `false` and which has no per-gate env override. **W8 cannot cover
it and should not splice it**: the exclusion cites `RI()`'s gate read, the fixture's recorded default,
and the fixture's own 13-entry override inventory that does not list it. It is the same shape as W4's
microcompaction exclusion and W7.5's segment-compaction ceiling, and it should be written the same way.

---

## 3. Anchors

Twenty candidate anchors, counted over the full 1,802-file set. **Nineteen are true-substring-unique
bundle-wide**; one needs lengthening:

| count | anchor | target |
|---|---|---|
| 1 | `" created successfully: "` | `TaskCreate.mapToolResultTo…` |
| 1 | `"No tasks found"` | `TaskList.mapToolResultTo…` |
| 1 | `"Blocked by: "` | `TaskGet.mapToolResultTo…` |
| 1 | `"Task completed. Call TaskList now to find your next available task"` | `TaskUpdate.mapToolResultTo…` |
| 1 | `"Successfully stopped task: "` | `TaskStop.call` |
| 1 | `"Task ID is required"` | `TaskOutput.validateInput` |
| 1 | `"task-output-waiting-"` | `TaskOutput.call` |
| 1 | `"No findings reported."` | `ReportFindings.mapToolResultTo…` |
| 1 | `"no further wakeups scheduled"` | `ScheduleWakeup.mapToolResultTo…` |
| 1 | `"Scheduling a /loop wakeup requires classifier review."` | `ScheduleWakeup.checkPermissions` |
| 1 | `"No scheduled jobs."` | `CronList.mapToolResultTo…` |
| 1 | `"Scheduled recurring job "` / `"Persisted to .claude/scheduled_tasks.json"` | `CronCreate.mapToolResultTo…` |
| 1 | `"Invalid cron expression '"` | `CronCreate.validateInput` |
| 1 | `"No scheduled job with id '"` | `CronDelete.validateInput` |
| 1 | `"SendMessage output is not an object"` | `SendMessage.mapToolResultTo…` |
| 1 | `'broadcast (to: "*") is no longer supported'` | `SendMessage.validateInput` |
| 1 | `"Entered worktree at "` / `"Exited worktree. Your work is preserved at "` | `EnterWorktree.call` / `ExitWorktree.call` |
| 1 | `"Workflow script has a syntax error and was not launched:"` | `Workflow.mapToolResultTo…` |
| 1 | `"Your plan has been submitted to the team lead for approval."` | `ExitPlanMode.mapToolResultTo…` |
| 1 | `"Entered plan mode. You should now focus on exploring the codebase"` | `EnterPlanMode.call` |
| 1 | `"[cross-session-inbound] held inbound peer message"` | the inbound gate (§6) |

Only prose. No minified identifier appears in any of them. Two mechanical notes W8 must carry:

**(a) Em-dashes are six-character `\u2014` escapes in the source text, and an anchor has to be
written in that form.** Measured: the bundle contains **zero** literal em-dash bytes and 1,248
`\u2014` escape sequences in the engine chunk alone (75 in the SendMessage chunk, 13 in Workflow's, 9
in the cross-session gate's). So the anchor `"Loop stopped — any dynamic loop"`, written with the
character, counts **0** over the 1,802 files; written as `"Loop stopped \u2014 any dynamic loop"`,
with the literal backslash-u escape, it counts **1**. This is W7.5's "read what the function returns, not what its source says" lesson applied to the
other side of the transform: for the *owned copy* the source form is wrong, and for the *anchor* the
source form is the only one that matches. A large share of the moat tools' best prose has an em-dash in
it, so the rule bites here more than it did anywhere before.

**(b) `TaskStop.validateInput` is the one target with no anchor of its own, and it is also the first
row that would hit `selectExcision`'s known wrinkle.** Its two candidate literals both fail:
`"Missing required parameter: task_id"` occurs **twice, both inside the single `Dre` declaration**
(offsets 2166148 in `validateInput` and 2166909 in `call`), which is exactly the same-node duplicate
the spec's Deferred section records as a tie `selectExcision` throws on; and `" is not running
(status: "` also occurs twice, once inside `validateInput` and once at offset 2162442 **outside `Dre`
entirely**, so a `coLiteral` cannot separate them either — both live in `chunk-fy12d89p.js`. The
options are a `signature`-based sibling selection among the members, or leaving `validateInput` to the
S-module in §8's C11c and taking only `TaskStop.call` (unique anchor
`"Successfully stopped task: "`) as an S-method now.

**Genuinely unanchorable, enumerated rather than asserted:** `TaskStop.validateInput` (above), and
`TaskList.call`, `TaskGet.call` and `ListAgents.call`, which emit no prose of their own — they are pure store reads whose only literals are
property names. `TaskCreate.mapToolResultTo…` has **zero free captures and one anchor** and is
therefore fine, but its sibling `Fkt.call`'s only prose is the hook-cancel notice. For the three
`call` bodies the honest move is a `coLiteral` scoped to their own chunk plus the sibling-selection
`signature` the manifest already supports, or leaving them to the S-module in §8's C11c.

---

## 4. Captures and the shared cores

### 4.1 The formatters are extraordinarily clean

Free-variable inventory per §2.4's taxonomy, computed by AST (bound names subtracted, property names
excluded), with in-chunk call-site counts as the pure-helper/fold-in discriminator:

| target | B | captures | classification |
|---|---|---|---|
| `TaskCreate.mapToolResultTo…` | 155 | **0** | — |
| `TaskGet.mapToolResultTo…` | 450 | **0** | — |
| `TaskList.mapToolResultTo…` | 390 | **0** | — |
| `ReportFindings.mapToolResultTo…` | 163 | 1 (`k`, 72 call sites) | `pure-helper` |
| `ScheduleWakeup.mapToolResultTo…` | 1,250 | 3 (`ma`, `ny`, `FS` — tool-name constants) | 3 × `primitive` |
| `TaskUpdate.mapToolResultTo…` | 428 | 2 (`rb` 2 sites, `io` 15 sites) | `pure-helper` ×2 |
| `TaskOutput.mapToolResultTo…` | 1,069 | 3 (`yye` 4 sites, `mSt` 2, `rF` 7) | `pure-helper` ×3 |
| `TaskStop.call` | 428 | 2 (`v7` 2,131 B / 3 sites, `Kle` 4 sites) | `effectful-port` + `pure-helper` |
| `TaskStop.validateInput` | 546 | 5 (`Rre`, `ECe`, `Kle`, `WA`, `gd`) | 1 port + 4 `pure-helper` |
| `TaskCreate.call` | 607 | 9 (`zE`, `wJn`, `xUt`, `mf`, `ds`, `Hzn`, `la`, `n`, `Njt`) | 2 ports (task store, hook dispatch) + 7 helpers |

Three formatters with **zero** captures is the cleanest splice population the campaign has seen; the
`ScheduleWakeup` formatter's three captures are all tool-name string constants, which is the
`primitive` class's ideal case (every delegation becomes a free equality check).

### 4.2 The shared cores, and who sits on which

| core | where | B | shape | sits under |
|---|---|---|---|---|
| Task store | `chunk-kkfs5jjy.js` | 14,093 | 19 exports, 16 imports, 12 consumers, **no classes** | TaskCreate/Get/Update/List, TaskStop, Agent, Workflow |
| Task-output store | `chunk-13d9rycm.js` | 26,040 | 38 exports; `DiskTaskOutput` class, **12 private fields** | TaskOutput, BashOutput, background Agent logs |
| Team/task identity | `chunk-mk4am7jk.js` | 4,019 | 26 exports, **35 consumers** | SendMessage, Cron*, Task*, `fy12d89p` |
| Task-name constants | `chunk-n855n58h.js` | 1,056 | 3 exports, 0 imports | everything |
| Message/notification queue | `ssn` in `fy12d89p` | 10,933 | **closure factory** | every enqueue path incl. peer inbound |
| Task-event queue | `Tk` in `chunk-bsdtxcdc.js` | 2,167 | class, 7 public fields, 12 methods | every `task_*` frame |
| `emitTaskNotification` | `ys` in `chunk-bsdtxcdc.js` | 290 | free function, anchor `subtype:"task_notification"` (1×) | the terminal bookend `background-task` grades |
| `emitTaskProgress` | `W3e` in `fy12d89p` | 332 | free function, anchor `subtype:"task_progress"` (1×) | running-status frames |
| `task_started` emitter | `fy12d89p` | — | anchor `subtype:"task_started"` (1×) | background dispatch |

**The `background_tasks_changed` emitter is not in either chunk** — `subtype:"background_tasks_changed"`
occurs **twice, both in `chunk-g461tywa.js`** (the CLI command handler, 302 KB). Since
`m3/scenarios.ts`'s `background-task` check asserts on that frame, W8 owning the other three emitters
still leaves the level signal in an unowned chunk. Say so on the ledger row rather than implying the
frame family is closed.

### 4.3 Two storage edges into W9, both already leaking observably

- **Task store:** `<config>/tasks/<sessionId>/<taskId>.json` plus a `.lock`. Measured in the live
  harness config right now: **1,085 session directories, 1,613 JSON records, 6.3 MB**, accumulated
  because `src/harness.ts:resetSandbox()` wipes only the sandbox and `CONFIG_DIR/plans`. Benign for
  determinism today (each run gets a fresh session id, so nothing reads a prior run's tasks) but it is
  exactly the shape of the plan-directory bug that harness function was written to fix, and
  `TaskList`'s empty-list arm — the one `w1/scenarios.ts` deliberately orders its prompt to reach —
  depends on that directory being fresh. A resumed session sees the prior tasks; that is the partition
  W8's contract test owes.
- **Peer-session registry:** `<config>/sessions/<pid>.json`, one record per live session carrying
  `{pid, sock, sessionId, peerFeatures, procStart}`, read by `listRegisteredSessionRecords` /
  `listLivePeerSessions` and written at inbox start. The directory exists in the harness config today
  (empty between runs — records are unlinked on exit).

Both belong on the `subsystem/session-storage` (C12) row as W8→W9 edges. Neither is currently visible
to the state-surface diff, whose full form (§3.2, "the session/config store, leaked child processes and
sockets") lands in W9.

### 4.4 The interrupt-helper family, measured

`hD` 1,786 B · `Uq` 1,003 B (`chunk-jmdx1n3e.js`, 78,868 B) · `Odt` 340 B · `Ddt` 302 B · `jG` 276 B ·
`O4e` 69 B. They partition a pending-notification queue and re-enqueue artifact disclosures. The
firing condition, read off the code rather than assumed:

- `jG` removes queued messages matching `Pdt(e) = e.origin?.kind==="task-notification" && KAn(e.origin.source)`, and `KAn(e) = e==="artifact-auto-react" || e==="artifact-room"`.
- `Ddt` buckets on `artifact-auto-react-stop-disclosure`, `artifact-changed`, `artifact-watch-lifecycle`.
- `Uq` iterates the task registry but acts only on rows where `zdr(u)` — `isAutoReactArmedSubscription` — holds.
- `autoReactSlug`, the property `zdr` tests, has exactly **two writers bundle-wide**: the artifact
  auto-react WebSocket watcher in `chunk-jmdx1n3e.js` and the `monitor_ws` task record in
  `chunk-7yzcjv8p.js`. Both are the Monitor WebSocket path, which is gate-dead (§2.4).

So: **an interrupt with a live task creates none of these**, the task family cannot create the
condition at any price, and the subsystem that can is §1.2-excluded and gate-dead. The row is an
evidence-backed exclusion citing `Pdt`/`KAn`/`zdr`/`RI` — not a W8 debt, and not "dark".

---

## 5. Coverage and the recording budget

### 5.1 What the 59-scenario corpus + m2/m3 already reach

Read from the scenario sources (`m1`, `m2c`, `m3`, `w1`–`w6`), not from tags:

- **Executed** (a `call()` runs and its result is graded): `TaskCreate`, `TaskGet`, `TaskUpdate`,
  `TaskList` (`task-family`, `todo-tool`, `hooks-tasks`), and `Agent`'s background dispatch
  (`background-task`, which grades `task_started` / `background_tasks_changed` / `task_notification`
  through `checkBackgroundTask`).
- **Catalog-only** — description and JSON schema render into the graded request bodies on every turn,
  and nothing else: `SendMessage` (3,386 B of description), `Workflow` (3,480), `EnterPlanMode` (4,011),
  `EnterWorktree` (3,220), `ScheduleWakeup` (3,148), `CronCreate` (2,924), `RemoteTrigger` (2,834),
  `ExitWorktree` (1,923), `ExitPlanMode` (1,849), `TaskOutput` (1,049), `AskUserQuestion` (842),
  `ListAgents` (777), `ReportFindings` (574), `TaskStop` (378), `CronDelete` (167), `CronList` (106).

That second list is the wave's free lunch and it is large. The ledger assigns C11 twenty-two tool
rows; two of them (`WebFetch`, `WebSearch`) are not moat work (§7.4), leaving **twenty**. **All twenty
already render their description and JSON schema onto the differential `requests` surface on every
turn, with zero new recordings** — the same opening W3 used for the prompt sections, on a surface where
every arm is live. **Sixteen of the twenty do nothing else: they have zero execution coverage.**

### 5.2 Firing conditions per un-reached arm, and their honest cost

| arm | firing condition | cost |
|---|---|---|
| `ScheduleWakeup.call` stop-arm + formatter | one call with `stop:true`; the arm is pure, arms no timer, returns `{stopped:true,cancelledWakeups:0}` | **1 cheap recording**, fully deterministic |
| `CronList` empty + `CronCreate` + `CronDelete` | three calls in one turn against a fresh config; `CronCreate.validateInput` has four distinct refusal arms reachable with bad expressions | **1–2 recordings**; writes `.claude/scheduled_tasks.json`, so `resetSandbox` must learn it |
| `ReportFindings` empty + non-empty | two calls | **1 recording** |
| `TaskOutput` / `TaskStop` | dispatch a background `Agent`, then `TaskOutput` on its id, then `TaskStop` | **1 recording**, but inherits `background-task`'s measured raciness — grade `substanceOnly` |
| `TaskGet` not-found, `TaskList` non-empty ordering | extend `task-family`'s prompt | **0 new recordings** (re-record one) |
| `SendMessage` refusal arms (`broadcast`, empty message, unresolvable address, `!Yo()`) | one call each with a bad `to` | **1 recording**, single session, deterministic |
| `SendMessage` delivery + `ListAgents` non-empty | **two live sessions sharing a config dir** | **probe first** (§6.4), then 1 recording if it settles |
| `EnterWorktree` / `ExitWorktree` | a git repo in the sandbox; `EnterWorktree.call` relocates the session cwd and permission root | **2 recordings**; needs a sandbox git fixture and touches the permission root, so it interacts with W6's surface |
| `EnterPlanMode` / `ExitPlanMode` | `permissionMode:"plan"`; `perm-plan-mode` already runs in that mode | **1 recording**, and note the harness already wipes `CONFIG_DIR/plans` for exactly this reason |
| `AskUserQuestion` | needs a host that answers; `validationErrorSteer`'s "<2 options" arm needs only a malformed call | **1 recording** for the refusal arm; the answered arm needs `canUseTool`-style brokering |
| `Workflow.call` | `validateInput` refuses on three named settings/policy conditions before any script runs | **1 recording** for the refusal arms; the run arm dispatches subagents (W12 territory) |
| `RemoteTrigger.call` | every branch is a cloud API call | **excluded** — server boundary, §1.2 |

**Total budget: 9–11 new recordings**, of which 8 are single-session and deterministic, one is racy and
must be graded `substanceOnly`, and one (`SendMessage` delivery) is gated on a probe.

### 5.3 OPEN-by-construction headlessly — with the guards, not the absence

Per the C10.5 lesson, each of these names a mechanism:

- **`Monitor`, all arms.** `RI(){return I("tengu_amber_sentinel",!1)}`; default `false` in
  `gate-defaults-2.1.251.json`; absent from that fixture's 13-entry `perGateEnvOverrides`, so
  flip-liveness has no lever.
- **The interrupt-helper family.** `Pdt`/`KAn` select only `artifact-auto-react`/`artifact-room`
  origins; `Uq` acts only where `zdr(u)` holds; `autoReactSlug`'s two writers are both the Monitor
  WebSocket path (above).
- **`RemoteTrigger.call`.** Its `call` reaches only the cloud trigger API; §1.2 excludes the server
  boundary.
- **`TaskUpdate`'s completion-nudge branch** (`rb() && io()`). Already recorded in
  `w1/scenarios.ts`'s own comment as needing an agent-team context; `rb`=`getAgentId`, `io` gates on
  team membership, and `chunk-mk4am7jk.js`'s team context is never set headlessly.
- **`SendMessage`'s `bridge` and `did:` (mailbox) routes.** `validateInput` refuses `uds`/`bridge` when
  `!Yo()`; `checkPermissions`'s bridge arm calls `PDe(session, …)` against cloud session auth; the
  mailbox route is `chunk-mj9p85j0.js`'s peer-file/DID transfer. All server-coupled.
- **`ToolSearch`.** `b_()` short-circuits on a first-party-base-URL predicate that a run pointed at the
  record/replay proxy cannot satisfy — the same mechanism the README already documented for
  `CLAUDE_CODE_LUMINOUS_WHISTLE`.

---

## 6. Cross-session messaging, specifically

### 6.1 The layer, measured

| piece | chunk | B | exports | role |
|---|---|---|---|---|
| Inbound **policy gate** | `chunk-jtg5esas.js` | 10,897 (9,652 of code) | 29 | `crossSessionInbound: accept\|hold\|refuse`, permission-mode matching, 100-deep hold buffer, receipts, kill switch |
| **UDS transport + peer registry** | `chunk-yx35jjkz.js` | 21,626 | 46 | `sendControlToUdsSocket`, `listLivePeerSessions`, `registerOutstandingSend`, sender pacing |
| **Inbox / socket lifecycle** | `chunk-bzakfkb3.js` | 35,405 | 16 | `startCrossSessionInbox`, `startUdsMessaging`, socket-path resolution, self-send ancestry verdict |
| Peer **idle notification** | `chunk-nve7whb5.js` | 16,603 | 31 | `peerIdleNotify`, idle notice frames |
| Idle **subscription** | `chunk-qd0hkxhg.js` | 18,461 | 6 | `subscribeToPeerIdle` and its prose lines |
| Peer **file transfer** | `chunk-mj9p85j0.js` | 4,828 | 12 | `SendFile`'s spool, integrity verify, prefix injection |
| The **tool** | `chunk-0ak8xf05.js` | 77,921 | 8 | `SendMessageTool` (38,542 B) + `SendMessagePreconditionError` |
| Barrel the driver requires | `chunk-hkw4kykv.js` | 12,450 | 15 | re-exports the inbox surface under semantic names |

### 6.2 Transport and storage

Unix domain socket at `$XDG_RUNTIME_DIR || os.tmpdir()` + `/cc-socks/<pid>.sock`, with a per-uid
fallback at `/tmp/cc-socks-<uid>/<pid>.sock` when the path exceeds the sockaddr length limit. Peer
discovery is a **directory of JSON files**: `<configDir>/sessions/<pid>.json`, each
`{pid, sock, sessionId, peerFeatures, procStart}`, filtered by `/^\d+\.json$/` and liveness-probed.
Messages carry `msg_id`, a `hopChain` (loop guard), `verifiedPeerPid` and `verifiedPeerProcStart`; the
receiving side runs admission control (`maxQueuedPeerMessages`, a sender pacer, a `peer_loop_guard`
telemetry claim) inside the `ssn` queue factory before the policy gate ever sees the message.

### 6.3 Is it reachable headlessly? Yes — inbound is wired, and the guards say so

- **Kill switch open.** `Yo(){let e=a.CLAUDE_CODE_HARBOR_KITE; if(e!==void 0) return Me(e); if(D()==="windows"&&!I("tengu_harbor_kite_win",!0))return!1; return I("tengu_harbor_kite",!0)}` — the gate default is **`true`**, so §3.3's pinned-disabled policy leaves it on.
- **Setup runs headlessly.** `chunk-g461tywa.js` (the CLI command handler, which `--print` goes
  through) logs `[STARTUP] Running setup()...` and awaits `chunk-cjd4a34r.js`'s `setup`, which reaches
  `startCrossSessionInbox(w, i)` unless `!Yo()` (false), `$n()` (remote workspace — false), or
  `Co() && no explicit socket` (`CLAUDE_CODE_SIMPLE` / `--bare` — false). All three guards pass under
  reforge's environment.
- **The headless loop wires the callbacks.** `ky` in `chunk-dvbbv89q.js` requires
  `chunk-hkw4kykv.js` twice — once for `setOnPeerMessageStatus` (logging
  `[headless] cross-session hold-receipt: status=…`) and once for `setOnEnqueue` — and wires
  `Rje`, `Hje`, `Pje`, `kje`, `Ije` from the policy gate.
- **The gate has a headless-specific arm.** With no approval surface, a held message is expired after
  `R9()` ms and dropped with an expired receipt:
  `[cross-session-inbound] headless: held peer message expired (no approval surface) — dropped with an expired receipt`.
  The hold cause is decided by `k(e,o)`: with `bypassPermissions` in force, `Y0e()` returns `"bypass"`
  and an unasserted sender gets `holdCause:"no-mode-asserted"`; a sender asserting a different mode
  gets `"mode-mismatch"`. **Every corpus scenario runs `bypassPermissions`, so the corpus's own mode is
  the one that puts inbound messages on the hold path.**
- **Empirically:** `reforge/config/sessions/` exists in the harness config directory today, created by
  engine runs (empty between them because records are unlinked on exit).

**The outbound tool is present but its delivery arm has never been exercised.** `SendMessage` is in all
267 catalogs. Its `validateInput` refuses `uds`/`bridge` addresses when `!Yo()`; since `Yo()` is true,
a real address would be attempted.

### 6.4 Probe design — the one live check that settles it

The remaining unknown is not *whether* the layer runs but whether a **second** engine is addressable
from a graded run. `selfSent` is decided by process-ancestry verification
(`readAncestors(pid).includes(process.pid)`, macOS path), not by naming yourself, so a single process
cannot self-address. Proposed `reforge/w8/probe-cross-session.ts`, one session per phase, serialized
through the orchestrator per X5:

1. **Phase A (registry).** Start engine A under the harness config, hold it on a long turn. Assert
   `<config>/sessions/<A.pid>.json` exists and carries a `sock` path; assert the socket file exists.
   Verdict: FIRED / DEAD.
2. **Phase B (discovery).** With A live, run engine B in the same config dir and have it call
   `ListAgents`. Grade whether A appears in the listing. This alone converts `ListAgents` from
   catalog-only to executed and needs no message.
3. **Phase C (delivery).** B calls `SendMessage` to A's address. Watch A's stderr for the
   `[cross-session-inbound]` line and classify the outcome — `accept` / `held (cause=…)` / `refused` —
   and B's for the hold-receipt line. Under `bypassPermissions` the expected verdict is
   **held → expired**, and *that is a real graded behavior*, not a failure.
4. **Phase D (policy axis).** Repeat C with `crossSessionInbound: "accept"` and `"refuse"` supplied
   through `Options.settings` — the flag-settings layer, which W5 established reaches the settings
   chain with `settingSources: []` still in force and no filesystem write. This is what makes the
   gate's three policies gradeable without a second machine.

Normalization the probe owes the differ: pids, socket paths, `msg_id`, `procStart`. All are already the
kind of thing `src/canonical.ts` scrubs.

**Recommendation: run this probe before W8's cut is finalized.** It is the difference between a wave
that owns a formatter family and a wave that owns the campaign's most distinctive subsystem, and the
guards say the affirmative answer is the likely one.

---

## 7. Parent-impact list

### 7.1 Campaign spec (`docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`)

| claim | measured |
|---|---|
| §1.1 table: "Moat tools … `fy12d89p` various" | Seven of them live in **dedicated chunks** reached by `import.meta.require`, four of those with a **single export** (`ListAgents`, `CronCreate`, `CronDelete`, `CronList`). W8 has S-chunk candidates; W5/W6 did not. |
| §1.3 / line 12 / line 490 / line 942: "31 native tools presented headlessly" | The **baseline is 22**; the union over 267 recordings is **32** (31 + `PowerShell`); the largest single-session catalog is **28**. §1.3 should say "22 baseline, 32 in union, conditions per tool". |
| §1.3: "presence in the tools array proves the *catalog* traverses the seam" | True, but four of the listed tools (`TaskCreate/Get/Update/List`) are in three of the 267 catalogs only because two cassettes use model ids that fail a version regex. Presence was measured on an accident. |
| §6 W8 row: "task family, SendMessage/ListAgents, Workflow, ScheduleWakeup, plan/worktree · mechanism: scenario-led" | Right on scope, wrong on shape. The wave is **~260 KB** (89.5 KB of tool objects + ~170.5 KB of shared cores), it has **S-chunk** targets, and its stateful core is a **closure factory**, not a class. "Scenario-led" understates it: 16 of 20 tools are already gradeable with zero recordings. |
| C1 Revision Note: private fields are W10's blocker | Recurs in W8 exactly **once**, on `DiskTaskOutput` (1,839 B, 12 private fields). Everything else is public-field or closure. Add: a **closure factory** (`ssn`, 10,933 B) is strictly harder than a private-field class — no receiver exists to marshal through. |
| Deferred section / C10 flow-back: "the interrupt arm's five helpers … a named firing condition W8's task family creates more cheaply than W7.5 could" | The condition is an **artifact auto-react subscription**, not a live task. `autoReactSlug` has two writers, both on the gate-dead Monitor WebSocket path. Route to the exclusion ledger with the artifact surface (§1.2), not to W8. |
| §3.3: "431 sites, 379 distinct gates" | The committed fixture says **505 call sites / 439 distinct gates**, plus **2,549 `unresolved`** sites whose callee is not a resolved resolver alias. The spec number is stale in both directions. |
| C3 Revision Note: the PowerShell flip "swaps `Read` out of the headless tool catalog for `PowerShell`" | It **adds** `PowerShell` (22→23 tools) at the sorted index 10; `Read` shifts to 11 and stays. Positional diff misread as substitution. |

### 7.2 Census (`reforge/research/2026-08-31-engine-census.md`)

| claim | measured |
|---|---|
| No row exists for SendMessage / ListAgents / Workflow / ScheduleWakeup / Cron / RemoteTrigger / Monitor / worktree tools | The census has **no moat-tool row at all** — the closest are "Agent / Task tool", "TodoWrite / task list" and "Skills". ~260 KB of load-bearing client logic is uncounted, including the entire ~100 KB cross-session messaging layer. |
| "TodoWrite / task list … already spliced (`task-create-result`)" | `TodoWrite` (`ESt`, 938 B) is **disabled by default** at this pin — `isEnabled(){return !nw()&&FL()}`, and `nw()` is true unless `CLAUDE_CODE_ENABLE_TASKS===false`. The spliced formatter belongs to `TaskCreate`, a different tool. The corpus's `todo-tool` scenario already records that asking for TodoWrite produces a `TaskCreate` call. |
| "Bash tool … high — ES class with `#`-private fields" | Holds, and is now bounded: the private-field shape appears **once** in the moat surface. |

### 7.3 `reforge/README.md`

- The flip-liveness section's "`Read` leaves the presented tool array and `PowerShell` takes its place"
  is the positional-diff misread above. The paragraph's conclusion (env override consulted before the
  compiled-in default) is unaffected.
- The "Named debts" list has no entry for the moat tools, cross-session messaging, or the task/session
  storage leak.

### 7.4 Ledger (`reforge/ledger.json`)

- **`tool/PowerShell` has no row.** X2 says one row per headless catalog tool; `PowerShell` is
  presented headlessly under an override that is inside the env allowlist and is proven so by the
  committed `m3-flip-observed-flip-CLAUDE_CODE_USE_POWERSHELL_TOOL` cassette. It should be a row
  assigned to C13/W10 (its chunk `hw8qz4q5` is already W10's per the W5–W7 scout), not absent.
- **`tool/WebFetch` and `tool/WebSearch` are assigned C11.** WebFetch's description already landed with
  C5's `subsystem/tool-descriptions`; WebSearch is server-executed and its own row says so. Neither is
  moat work. Reassign to C5/C4 or mark excluded, so W8's row count reflects W8.
- **`subsystem/moat-tools` has no `edges`.** Measured edges: `subsystem/session-storage` (the task
  store and the peer-session registry), `subsystem/hook-dispatch` (TaskCreate/TaskUpdate call the
  W5-owned `TaskCreated`/`TaskCompleted` dispatchers — the anchors
  `"TaskCreated hooks cancelled (control stream closed)"` and `"TaskCompleted hooks cancelled …"` are in
  those two `call` bodies), `subsystem/subagent-dispatch` (background Agent → task registry),
  `subsystem/bash-executor` (Bash backgrounding → the same registry), `subsystem/permissions`
  (`EnterWorktree` relocates the permission root).
- **No row for `Monitor`.** It never traverses the seam, so it does not need a tool row — but it does
  need a line in the exclusion ledger, because "the moat includes persistent notifications" is a
  standing product claim and this is the measured answer to it.

### 7.5 Fixture (`research/fixtures/gate-defaults-2.1.251.json`)

`perGateEnvOverrides` lists 13 entries and **misses `tengu_harbor_kite` ← `CLAUDE_CODE_HARBOR_KITE`**,
the kill switch for the entire cross-session messaging surface. `research/tools/extract-gate-defaults.ts`'s
`recordEnvOverride` requires the then-branch to `return` the env-derived identifier *directly*
(`returnsIt` accepts only `ts.isIdentifier(st.expression)`), and `Yo()` returns `Me(e)` — the value
passed through a boolean coercer. Any override written that way is invisible to the sweep. Not a live
leak (the allowlist rejects all other `CLAUDE_CODE_*` either way), but §3.3 treats this inventory as the
measure of the operator-steering surface, so it understates it. A one-line widening — accept a call
expression whose sole argument is the identifier — would catch it; W8 should hand this to whoever owns
C3's fixture rather than patching it inside a tool wave.

---

## 8. A proposed cut (advisory)

Four children. The ordering is deliberate: the free coverage first, the probe second because it decides
how big the wave is, the stateful core last.

### C11a / W8a — the description-and-formatter belt (autonomous, opus-tier)

**Purpose.** Take the ~60 KB of the moat surface that is already graded and needs no new recording.
**Scope.** (1) The 16 tool `description`/`prompt` builders and schema getters that render into every
graded request body today — the W3 prompt-section play, on a surface where all 16 arms are live.
(2) The zero-and-low-capture formatters: `TaskCreate`, `TaskGet`, `TaskList` (0 captures each),
`ReportFindings` (1 pure-helper), `ScheduleWakeup` (3 primitives), `TaskUpdate`, `TaskOutput`.
**Observable acceptance.** Every splice solo-sabotaged RED on a named existing scenario; the three
zero-capture formatters additionally get a contract test over partitioned inputs, because their domain
(empty list, blocked-by chains, owner suffix) is wider than `task-family` exercises.
**Edges.** None new. **Anchors.** All prose, all unique; carries the `—` escape rule (§3a).
**Recordings.** 0 (one `task-family` re-record to widen its ordering assertions).

### C11b / W8b — reachability probes and the recordings they justify (controlled, opus-tier)

**Purpose.** Convert catalog-only tools into executed ones, and settle cross-session delivery.
**Scope.** (1) `w8/probe-cross-session.ts` per §6.4, four phases, three-valued verdict per phase.
(2) `w8/probe-tool-reachability.ts`: one session per catalog tool, each invoking the tool once with a
minimal valid input, reporting FIRED / DEAD / OPEN with a written reason — the W7 control-subtype probe's
shape applied to the tool axis, and the thing that stops W8 budgeting scenarios for arms that cannot fire.
(3) The 9–11 recordings §5.2 justifies, in the order the probe ranks them.
**Observable acceptance.** A committed `research/fixtures/tool-catalog-2.1.251.json` — derived from
`Y0()`'s 67 elements, each with its guard expression and its measured presence across the cassette
corpus, gate-checked per run, the seventh pin-keyed fixture. Every tool row in the ledger gains a
verdict with a cited guard.
**Edges.** X5 (recordings serialize). **Track.** Controlled: it records.

### C11c / W8c — the task and notification core (fable-tier, cut when C11b lands)

**Purpose.** Own the shared core the whole background family sits on, behind designed ports.
**Scope.** `TaskStorePort` over `chunk-kkfs5jjy.js`; `TaskOutputPort` over `chunk-13d9rycm.js` with
`DiskTaskOutput`'s twelve private fields behind the port rather than marshalled; `NotificationQueuePort`
over the `ssn` closure factory; and the three frame emitters (`ys`, `W3e`, the `task_started` site),
each of which has a unique `subtype:"…"` anchor and is small enough to splice ahead of the port.
**Observable acceptance.** §3.1's S-module bar — behavioral-partition matrix (empty store, resumed
store with prior tasks, output truncation at `MAX_TASK_OUTPUT_BYTES`, eviction, symlink repoint), the
mutation battery, and a port trace compared rather than only an output. The `background_tasks_changed`
emitter stays unowned (it is in `chunk-g461tywa.js`) and the row says so.
**Edges.** → C12/W9 (both storage edges, §4.3), → C15/W12 (background Agent), → C13/W10 (Bash
backgrounding), → C8/W5 (the two task hook dispatchers).
**Dependency.** Needs C11b's recordings; wants W9's state-surface diff but should not wait for it.

### C11d / W8d — cross-session messaging (fable-tier, cut only if C11b's probe fires)

**Purpose.** The campaign's most distinctive subsystem, and the one the user named first.
**Scope.** The inbound policy gate `chunk-jtg5esas.js` first — 9,652 B of code, no classes, every
branch carrying its own prose sentence, and a settings axis (`accept`/`hold`/`refuse`) that
`Options.settings` can drive with no filesystem write. Then `SendMessage`'s `validateInput`,
`checkPermissions`, `mapToolResultTo…` and `renderToolUseMessage` (8.5 KB of the 38.5 KB object) as
S-method rows, leaving `call` (28.4 KB) to a later increment. `ListAgents` (`chunk-44q73bmc.js`, one
export, 5,944 B) as the **S-chunk** row.
**Observable acceptance.** The gate's three policies × the mode axis, graded on the
`[cross-session-inbound]` log lines and the receipt statuses; `ListAgents` graded on both the empty and
non-empty listing.
**Edges.** → C12/W9 (`<config>/sessions/<pid>.json`), → C9/W6 (`Y0e()` reads the permission mode and
the hold cause is decided by it).
**Risk to state plainly.** If C11b's probe reports that a second addressable session cannot be created
under the harness, this child collapses to the refusal arms only and the delivery half becomes an
exclusion with the probe as its evidence. Cut it after the probe, not before.

### Not W8's

`Monitor` (gate-dead, §2.4) · the interrupt helpers (artifact surface, §4.4) · `RemoteTrigger.call`
(server boundary) · `PowerShell` (W10's chunk; it needs a ledger row, not a wave) · `WebFetch` /
`WebSearch` (already C5's and the server's) · `Skill` (C14) · `Agent` (C15) · the
`background_tasks_changed` emitter (`chunk-g461tywa.js`, unowned).

---

## 9. Method notes worth keeping

- **The cassette corpus is an enumeration artifact, not just a grading surface.** The tool catalog, its
  conditional families, the description arms each tool renders, and the PowerShell-flip correction all
  came out of reading 267 recorded request bodies. "Derive the enumeration from the artifact" has a
  second artifact available now, and it is the only one that answers *what the engine actually
  presented* rather than *what its code could present*.
- **A positional diff is not a substitution.** The PowerShell finding survived three documents because
  a diff keyed on array index reported `tools[10]: "Read" != "PowerShell"` and every reader took it at
  face value. Any diff over an ordered collection should say whether the length changed before anyone
  reads a per-index difference as a swap.
- **An extractor that requires an exact syntactic form will miss the variants.** The gate fixture's
  override sweep misses `return Me(e)` because it accepts only `return e` — and the one it misses is
  the kill switch for a whole subsystem. When a tool defines a population by pattern, the pattern's
  near-misses are the population's real boundary and should be reported alongside it.
- **Check the escape layer before counting an anchor.** Zero literal em-dash bytes exist in the
  bundle; 1,248 six-character `\u2014` escapes do, in the engine chunk alone. A prose anchor that
  reads correctly in a report can count zero in the artifact, and the failure is silent in both
  directions — the report looks right and the build cannot find the target.
