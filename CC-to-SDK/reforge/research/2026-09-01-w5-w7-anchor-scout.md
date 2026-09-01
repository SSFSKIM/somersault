# W5–W7 anchor scout — hooks, permissions, control protocol (pin 2.1.251)

> **SUPERSEDED IN PART — 2026-09-02, by W6/C9 running the subsystem this report only read.**
> Two of the permission assertions below were true-as-believed at scouting time and are false as
> claims. They are left in the body because a scout is a record of what was believed when the wave was
> budgeted, and editing that record away destroys the evidence that a premise was refuted. Read them
> with these corrections — W7 is the next reader of this file, and both corrections change what it
> should assume.
>
> 1. **§2.4 and §4's item 4 — "`bypassPermissions` short-circuits the whole rule engine."** It does
>    not. Upstream's pre-check reaches its bypass arm at **rung 11 of 13**, below the tool deny rule,
>    the input deny rule, the allow rule and its delegation, the tool's own `checkPermissions`, the ask
>    rule, the interaction check, the MCP ask ceiling and the safety floor. Only the ASK is
>    short-circuited; a deny rule still bites under bypass. So the twenty-two bypass scenarios grade
>    most of the chain rather than none of it, and bypass belongs in the mode matrix rather than as the
>    negative control §2.4 proposes. Confirmed three ways: solo sabotage of the pre-check reddens eight
>    inherited bypass scenarios, the parity oracle carries "bypass short-circuits the deny rules" as a
>    mutant that must DIFFER, and the `perm-bypass-deny-rule` recording carries the denial frame.
> 2. **§2.4 and §4's item 4 — "`auto` is gate-guarded, and probably gate-dead under the pinned
>    environment."** It is not. Upstream's auto gate is three LOCAL conditions
>    (`!circuitBreaker && !settingsDisabled && modelSupportsAuto`), not a remote feature flag, so
>    §3.3's policy of pinning every gate to its compiled-in disabled default never touches it: `auto`
>    was ACCEPTED both at spawn and over the control channel. "Gate-dead" is therefore the wrong word
>    for any of `auto`'s arms. Where they genuinely go unreached the word is **corpus-dark** — no
>    scenario creates the condition — which is a different claim with a different remedy (write the
>    scenario) than an environment that forbids the mode.
> 3. **And the correction of §2.4 needed a correction of its own**, recorded here because it is the
>    same failure one layer down. W6's first pass reported that a `chmod` under `auto` "was allowed
>    with no consult" and read that as the classifier not being reached. "No consult" meant no
>    `canUseTool` consult, and the classifier is not visible from the host's seat at all. Watched on
>    the wire, `auto` DOES call it — a second, toolless, non-streaming `/v1/messages` request stopping
>    at `</severity>`, which answered `<severity>25`, below the block threshold, so the call was
>    allowed and no host was ever asked. The classifier's `decisionReason` is no longer OPEN either:
>    choosing a 400 for that request at record time reaches upstream's fail-closed arm ("Auto mode
>    classifier unavailable, denying with retry guidance (fail closed)"), which denies with
>    `{type:"classifier", classifier:"auto-mode"}` — and the `PermissionDenied` hook event fires on it,
>    on both hook paths.
>
> Evidence: `reforge/research/2026-09-01-w6-permission-matrix.md`; the `perm-bypass-deny-rule` and
> `perm-auto-classifier-deny` recordings; `reforge/w6/probe-permissions.ts`.

> **SUPERSEDED IN PART — 2026-09-02, by W7/C10 running the subsystem §3 only read.**
> Four of §3's assertions were true-as-believed at scouting time and are false as claims. They are left
> in the body for the same reason the permission corrections above are: a scout records what was
> believed when a wave was budgeted, and editing that away destroys the evidence that a premise was
> refuted. Read §3 with these corrections.
>
> 1. **§3.1 — "the dispatch is inside `runHeadless` (`GH`)."** It is not. `runHeadless` DRIVES the
>    dispatch: its last act is `for await (… of ky(…))`, and the ladder lives inside the anonymous
>    frame handler inside `ky` — which the bundle re-exports as `_runHeadlessStreamingForTesting`.
>    §3.1 dismissed `ky` as "a separate testing entry point, not the production path" on the strength
>    of that name. It IS the production streaming loop, exported so tests can drive it. The general
>    form: **an export name is a claim about who MAY call a function, not about who does.**
> 2. **§3.1 — "55 `else if` arms."** Fifty-two, over fifty-four subtypes (two arms carry two subtypes
>    each). And "~39 sendable subtypes" is thirty-seven. Both counts are now derived rather than read:
>    `research/fixtures/control-protocol-2.1.251.json`, re-derived on every gate run.
> 3. **§3.2's anchor table is wrong in two rows.** `initialize: sdkMcpServers and
>    webSearchIsolationExemptMcpServers` is the ARM's own validation sentence, not a literal inside
>    `Ey` — anchoring `Ey` on it would have excised the frame handler. `Ey`'s own anchor is
>    `tengu_reinit_pending_redelivery`. And `set_model failed` likewise lives in the arm, not in `km`;
>    `km`'s anchor is `set_model: system_prompt must be a non-empty string when present`.
> 4. **§3.2 — "take the interrupt arm's four/five named helpers."** They are not this subsystem's.
>    `Uq` is `killAutoReactSubscriptions` and `jG`/`Ddt`/`Odt`/`O4e` partition artifact and
>    task-notification rows; four of the five live in `chunk-fy12d89p`. Their firing condition is an
>    interrupt with live tasks, artifact subscriptions or a queued command, which the corpus's
>    `interrupt` scenario creates none of — so the row is OPEN with that condition named and belongs
>    with W8's task family. Not dark, and not W7's.
>
> Also inherited and confirmed: C9's correction that `gK`/`$U` do NOT carry `initialize` (the headless
> runtime builds that response inline) held up — W7 re-verified the rest of §3.2's table the same way.
>
> Evidence: `reforge/research/fixtures/control-protocol-2.1.251.json`; `strangle/manifest.ts` rows
> `initialize-handler` / `initialize-payload` / `permission-mode-setter` / `model-switch` /
> `thinking-config`; `w7/probe-control-subtypes.ts`; `strangle/control-parity.test.ts`.

Scope: C8 (W5 hook dispatch), C9 (W6 permission decisions + rule chunks), C10 (W7 control protocol).
Method: substring counts across all 2074 `modules/*.js`; TypeScript-parser spans over
`chunk-fy12d89p.js` / `chunk-dvbbv89q.js`; windowed reads of `cli.pretty.js`. READ-ONLY — no build,
gate or recording was run. Grounding: campaign spec §2.1/§2.2/§2.4/§3.2/§5 + its C1 Revision Note;
`2026-08-31-engine-census.md`; `strangle/manifest.ts`.

## 0. The finding that reframes all three waves: the engine ships its own name map

387 chunks re-export minified symbols under **source-level names**. Harvesting every
`export{<min> as <semantic>}` whose binding was imported from the engine chunk yields **832
minified→semantic names for `chunk-fy12d89p.js`** (`executePreToolHooks`, `checkRuleBasedPermissions`,
`guardPermissionModeChange`, …). `chunk-dvbbv89q.js` self-names 63 more (`runHeadless`,
`getCanUseToolFn`, `createCanUseToolWithPermissionPrompt`, …).

This changes scouting economics for every remaining wave, not just these three: targets are now
*looked up*, not hunted by literal. It is also a **pin-bump artifact worth regenerating** (§5) — the
map is derived, cheap, and a semantic name appearing/disappearing is a real signal. Recommend the
orchestrator lift this out of this report into a small tool under `reforge/research/tools/`.

**Three census rows are wrong and W5/W6 must not budget from them.** They were `rg -l` hits on
literals that live in *shared-constant* chunks, not in dedicated subsystem chunks:

| Census claim | Measured |
|---|---|
| `7g4v1yq9` (82 KB) = "hooks schema+events" | 72 exports, **521 consumers** — a bundle-wide constants chunk. Not a hooks chunk. |
| `x5kv85y3` (13 KB) = "hooks exec+digest" | `DEVICE_TEMPLATE_*`, `runTemplate`, `resolvePython3` — **remote device-hook templates**, 1 consumer (`8dmyrf1h`), off the headless path. |
| `hw8qz4q5` (114 KB) = "permission rule matching" | 4 exports: `PowerShellTool`, `detectBlockedSleepPattern`, `isAutobackgroundingAllowed`, `isBackgroundingSafe` — **the PowerShell tool + Bash backgrounding safety**. Belongs to W10, not W6. |
| `8c6qx8qp` (60 KB) = "permission rule parse/validate" | 79 minified exports, **533 consumers** — a shared utility chunk. |
| `scxwkz2z` (15 KB) = a hooks chunk | A **pure named-export barrel** over `fy12d89p` (84 aliases, 371 B of imports). Zero own code. |

**Net: neither W5 nor W6 has an S-chunk candidate.** Every real implementation is a free function
inside `chunk-fy12d89p.js`. W5/W6 are S-method waves on the `free-function` shape, with one new
sub-shape (below). `scxwkz2z` is worth *keeping* as documentation, not owning.

---

## 1. W5 — hook dispatch

### 1.1 Shape: the per-event dispatchers are `async function*`

Every `execute*Hooks` entry point is an **async generator** that builds the hook-input record and
`yield*`-delegates into `executeHooks` → `Xxt` → `Qxt`. C1's `free-function` shape synthesizes a
`return`-style delegation; it must gain **generator delegation (`yield*`) with async iteration**, or
W5 has no target at all. **Parent-impact: this is a fifth mechanism variant, cheaper than a new
`target` value (a flag on `free-function`), but it is a C1 change and it gates W5.**

### 1.2 Per-event seams (8 headlessly-live events; source: `docs/parity/coverage.md` L774)

Anchor `hook_event_name:"<Event>"` is **true-substring-unique bundle-wide** for 7 of 8.

| Event | fn | size | anchor | count |
|---|---|---|---|---|
| PreToolUse | `Tye` `executePreToolHooks` | 1,022 B | `hook_event_name:"PreToolUse"` | 1 |
| PostToolUse | `b3e` `executePostToolHooks` | 363 B | `hook_event_name:"PostToolUse"` | 1 |
| PostToolBatch | `Fct` `executePostToolBatchHooks` | 295 B | `hook_event_name:"PostToolBatch"` | 1 |
| UserPromptSubmit | `bSe` `executeUserPromptSubmitHooks` | 382 B | `hook_event_name:"UserPromptSubmit"` | **2 — needs `coLiteral`** |
| Stop **and** SubagentStop | `y9` `executeStopHooks` | 966 B | `hook_event_name:"Stop"` / `"SubagentStop"` | 1 / 1 |
| SubagentStart | `kUt` `executeSubagentStartHooks` | 332 B | `hook_event_name:"SubagentStart"` | 1 |
| MessageDisplay | `Zqe` `executeMessageDisplayHooks` | 364 B | `hook_event_name:"MessageDisplay"` | 1 |

`y9` serves **both** Stop and SubagentStop through an internal conditional — one splice, two events,
and a partition the corpus must cover on both arms (§2.4's contract-test clause).

### 1.3 The shared spine (where the ownership value actually is)

| fn | semantic | size | note |
|---|---|---|---|
| `Qxt` | (the executor `executeHooks` delegates to) | **23,385 B** | matching, command/callback/http/mcp hook invocation, timeouts, cancellation. The subsystem's real mass. |
| `AE` | `executeHooksOutsideREPL` | 6,323 B | |
| `Rzn` | `getMatchingHooks` | 3,129 B | dedupe by source, matcher-text recording |
| `mQ` (PreToolUse consumer) | — | 4,272 B | the **dispatch site**: consumes `Tye`'s yields, applies `permissionBehavior`/`updatedInput`/`blockingError` |
| `SL` (PostToolUse consumer) | — | 2,348 B | dispatch site |
| `fQ` | — | 842 B | second PostToolUse dispatch site |
| `Xxt` | — | 964 B | agent-context field filter over hook results |
| `jy` | `executeHooks` | 261 B | headless-suppression wrapper (`c6n` event set) |
| `xPe` / `Ea` / `oT` / `lun` / `tIe` / `OUt` | parseHookOutput / createBaseHookInput / hasHookForEvent / hookMatcherMatches / guardHookUpdatedInput / getPreToolHookBlockingMessage | 833 / 602 / 235 / 108 / 191 / 62 B | leaf helpers, all cleanly anchorable |

Recommended W5 cut: the 8 dispatchers + `jy`/`Xxt` + the leaf helpers first (≈6 KB, ~12 anchors),
then `Qxt` as its own unit. `Qxt` at 23 KB with 20+ destructured options and process spawning is
**S-module-shaped, not S-method-shaped** — flag it at dispatch; it may belong with W10's executor.

### 1.4 Coverage

The `hooks` scenario (`m1`, PreToolUse+PostToolUse around one `Bash echo`, `bypassPermissions`) is
the only hook scenario in the 24-scenario corpus. Under solo sabotage it reddens:
`Tye`, `b3e`, `mQ`, `SL`, `jy`, `Xxt`, `Ea`, `oT`, and `Qxt`'s callback path.
It does **not** reach: `Fct` (PostToolBatch — needs ≥2 parallel tools *plus* registered batch hooks;
`parallel-tools` exists but registers no hooks), `bSe`, `y9` (either arm), `kUt`, `Zqe`, `Rzn`'s
command/http/mcp dedupe branches, `xPe` (only command hooks emit parseable stdout), `tIe`, `OUt`.

**§3.2's hooks matrix owes 5 new recordings**, all cheap and headlessly recordable:
`hooks-prompt-submit` (UserPromptSubmit + additionalContext), `hooks-stop` (Stop),
`hooks-subagent` (SubagentStart + SubagentStop + Stop, on the existing `subagent` prompt),
`hooks-message-display` (MessageDisplay), `hooks-batch` (PostToolBatch on the `parallel-tools`
prompt with batch hooks registered). One further scenario is **not** free: `xPe`/`withHookStderr`
need a **command** hook (a shell script in the sandbox), not a callback — that is a new fixture
shape, and it is the only way to grade hook-output parsing. Recommend it; call it out as the
matrix's one non-trivial cell.

---

## 2. W6 — permission decisions

### 2.1 The decision chain (all in `chunk-fy12d89p.js`, all `free-function`)

| fn | semantic | size | params |
|---|---|---|---|
| `Dd` | `hasPermissionsToUseTool` | 67 B | 6 (arrow) |
| `kye` | `hasPermissionsToUseToolWithSink` | 125 B | 7 (arrow) |
| `von` | (the mode-aware decision body) | **11,584 B** | 7 (arrow) |
| `Aon` | (pre-check: abort, hooks, ask-path) | 2,413 B | 4 |
| `Gx` | `checkRuleBasedPermissions` | 1,431 B | 4 |
| `y7e` | (allow-rule application) | 503 B | 5 |
| `GIe` | `guardPermissionModeChange` | 608 B | 2 |
| `K0` | `setPermissionModeWithGuards` | 187 B | 4 |
| `V0` | `transitionPermissionMode` | 436 B | 4 |
| `ql` | `createPermissionRequestMessage` | 1,372 B | 2 |
| `Ree`/`Fy`/`R_e`/`e1t`/`Uct`/`tCr`/`sgr`/`agr` | leaf predicates | 30–203 B | |
| `eln` | `initializeToolPermissionContext` | 5,363 B | 1 |
| `Zan` | `initialPermissionModeFromCLI` | 1,140 B | 1 |

`Dd`/`kye` are **arrow functions in a comma-chained `var` declarator** (`Dd=async(…)=>{…},kye=…`).
C1's `free-function` shape resolves a `FunctionDeclaration`; an arrow initializer inside a
multi-declarator `VariableStatement` is a different node. **Parent-impact: W6 needs the
free-function shape to accept `VariableDeclaration → ArrowFunction` initializers, and the AST span
must be the initializer, not the declarator list.** Same gap as W5's generators — both are C1 work.

### 2.2 The headless broker seam

The SDK spawns the engine with `--permission-prompt-tool stdio` (verified in `sdk.mjs`). That routes
`getCanUseToolFn` (`Ty`, 847 B, `chunk-dvbbv89q.js`) to `transport.createCanUseTool(…)` — a **class
method in `chunk-g1qrzvef.js`**, which calls `Dd`, then on `ask` sends the `can_use_tool`
control_request and maps the response back through `Vvt` (550 B, same chunk: `permissionPromptTool`
decisionReason, `updatedInput`, `updatedPermissions`, `deny+interrupt`).

So `chunk-g1qrzvef.js` (36 KB, **7 exports, 2 consumers**) is the seam shared by W6 and W7.
Its S-chunk price is **39 imported chunks** — too entangled to own whole; take `Vvt`, `gK`, `$U`,
`UU` as free functions and `createCanUseTool` as a `class-method`.
`createCanUseToolWithPermissionPrompt` (`pf`, 1,801 B) is the *MCP* prompt-tool path — **not
reached headlessly under the SDK**; do not splice it without its own scenario (the `interrupt`-clause
lesson from C1).

### 2.3 Anchors — the weak spot

Unlike W5, the permission functions are literal-poor:

| target | best anchor | count | verdict |
|---|---|---|---|
| `GIe` | `Cannot set permission mode to bypassPermissions because the session was not launched` | 1 | clean |
| `pf` | `The permission prompt tool is no longer available` | 1 | clean (but dead headlessly) |
| `Gx` | `Permission to use ${` | 23 | **needs `coLiteral`** (`crashIsObjection` co-occurs) |
| g1qrzvef `createCanUseTool` | `Tool permission request aborted` | 2 | **needs `coLiteral`** |
| `Dd`/`kye` | `decideLocation:"pre-ask"` | 2 | **needs `coLiteral`** |
| `von`/`Aon`/`ql` | — | — | no distinctive literal; C4's `coLiteral` mechanism is load-bearing here |

Census literals re-verified: `No mode-specific handling for` **3** (not unique — it is the *Bash*
mode fallthrough `hrn`, with siblings), `Invalid permission rule` 1, `tengu_tool_use_granted_in_config`
1, `Permission mode override over the control channel is tighten-only` 1.

### 2.4 Coverage — and the bypassPermissions problem

Corpus permission-mode distribution: **24 uses of `bypassPermissions`, 2 of `default`
(`permission-broker`, `permission-bag`), and zero of `acceptEdits` / `plan` / `dontAsk` / `auto`.**
`bypassPermissions` short-circuits the whole rule engine (`T8e`: *"Bypass mode is handled in main
permission flow"*), so **22 of 24 scenarios grade none of §2.1's chain**. [SUPERSEDED — banner item
1: the bypass arm is rung 11 of 13, so those 22 grade most of the chain.] The two `default`
scenarios reach `Dd`→`kye`→`von`→`Aon`→`Gx`→ broker, but only along the *ask → SDK decides* path;
they never exercise an allow-rule, a deny-rule, an ask-rule, or a mode-specific handler.

**§3.2's 6-modes × representative-tools matrix therefore owes real recordings, not a re-slice of the
corpus.** Recordability, measured against `GIe`'s guards:

- `default`, `acceptEdits`, `plan`, `dontAsk` — recordable headlessly today (SDK `PermissionMode`
  declares all four; `acceptEdits`/`dontAsk` are already characterized in `coverage.md`).
- `bypassPermissions` — recordable (corpus default), but grades nothing; keep it as the negative
  control that proves the short-circuit, not as a matrix cell. [SUPERSEDED — banner item 1: it grades
  rungs 1–10, and it is a matrix cell.]
- `auto` — **gate-guarded**: `GIe` refuses unless `hE()` returns true, and reforge pins gates to
  their compiled-in disabled defaults (§3.3). **Delegated unknown: `auto` is probably unreachable
  under the pinned environment.** Probe it before budgeting the cell; if dead, record it as an
  evidence-backed matrix exclusion rather than leaving a hole. [SUPERSEDED — banner item 2: the gate
  is local, §3.3 does not touch it, and `auto` records through both paths.]

Cost estimate: **~10–12 new live recordings** (4 live modes × Write/Bash/Read representatives, plus
allow-rule / deny-rule / ask-rule settings fixtures). This is the largest corpus growth of the three
waves and the orchestrator should serialize it as its own recording batch (X5).

---

## 3. W7 — control protocol

### 3.1 The headless seam, located

C1's Revision Note is confirmed and now has coordinates. Print mode's dispatch is inside
`runHeadless` (`GH`, `chunk-dvbbv89q.js`, **16,018 B**), in a `for await (… of transport.structuredInput)`
loop: `cli.pretty.js` **360,614–362,051** (≈1,437 pretty lines), **55 `else if` arms** over
`request.subtype`, terminated by `else → "Unsupported control request subtype: …"`.

(The 140 KB `_runHeadlessStreamingForTesting` / `ky` is a separate testing entry point, not the
production path.)

[SUPERSEDED — banner items 1 and 2: the ladder is inside `ky`, which `runHeadless` DRIVES and which is
the production loop despite its export name; and it has 52 arms over 54 subtypes, not 55.]

### 3.2 The if/else-arm shape is a trap — take the handler bodies instead

Excising an arm as a delegated block is **not** a small generalization of the four shapes:

- arms carry `continue` and `break` **relative to the enclosing `for await`** (`set_permission_mode`,
  `initialize`, `end_session` all use them). A delegated call cannot express them; the adapter would
  have to interpret a returned control-flow token.
- arms `await` and close over ~40 loop-scope locals (`k`, `S`, `F`, `ct`, `t`, `e`, `Qe`, `nt`, `Ge`, …).
- the arms are not a homogeneous family — 55 of them, most peripheral (remote control, OAuth,
  workspace diff) and dead headlessly.

**Recommendation (parent-impact, and it should go back into §2.1 and §6's W7 row): drop the
if/else-arm target shape. W7's seam is the named handler functions the live arms delegate to** —
every one is a top-level `free-function` in an already-owned-shape node:

| subtype | handler | chunk | size | anchor | count |
|---|---|---|---|---|---|
| `initialize` | `Ey` | dvbbv89q | 2,948 B | `initialize: sdkMcpServers and webSearchIsolationExemptMcpServers` | 1 — **SUPERSEDED (banner item 3): that literal is the ARM's, not `Ey`'s** |
| `set_permission_mode` | `um` → `GIe`/`K0` | dvbbv89q / fy12d89p | 181 B / 608 B | the `GIe` literal above | 1 |
| `set_model` | `km` | dvbbv89q | 2,052 B | `set_model failed` | 2 (coLiteral) |
| `set_max_thinking_tokens` | `Sf` | dvbbv89q | 222 B | its validation message | 2 (coLiteral) |
| `mcp_message` | `QKn` | h4hvhzbw | — | — | scenario-led |
| `rewind_files` | `Tf` | dvbbv89q | 485 B | — | out of corpus |
| **every** subtype's response | `gK` / `$U` (`chunk-g1qrzvef.js`) | 100 B / 96 B | `subtype:"success",request_id:` | 24 (coLiteral) |

[SUPERSEDED — banner item 4: the five helpers named below belong to the auto-react and
task-notification subsystems, not to the control protocol.]
`interrupt` is the exception: its arm is **inlined**, no named handler, ~22 lines, and it is the one
arm whose body is genuinely arm-shaped. It has a unique literal (`interrupt cleared the queue`,
count 1) and delegates to four named helpers (`Uq`, `jG`, `Ddt`, `Odt`, `O4e`). **Take the helpers,
not the arm** — same reasoning; the arm keeps its `continue`-free straight-line shape but still
closes over eight loop locals.

`gK`/`$U` are the highest-leverage pair in W7: two ~100 B pure constructors through which **every
headless `control_response` passes**, so sabotage reddens on `initialize` alone, i.e. every
SDK-driven scenario. Low bytes, maximal liveness — a good first W7 splice.

### 3.3 Coverage — what the corpus reaches, and the raw-protocol hole

Inbound subtypes the 24-scenario corpus + 5 suites actually exercise: **`initialize`** (every
SDK-driven scenario), **`set_permission_mode`** (`runtime-setters`), **`interrupt`** (`interrupt`),
**`mcp_message`** (`mcp-tool`). Outbound (engine→SDK): **`can_use_tool`** (`permission-broker`,
`permission-bag`), **`hook_callback`** (`hooks`). That is 6 of the ~39 subtypes `sdk.mjs` can send —
and 4 of 55 arms.

`m2/raw-protocol.ts` currently sends **one `user` message and no control_request at all**, so the
"no-wrapper wire" suite grades zero of the control protocol. §3.2's "raw-protocol depth (every
control subtype)" is therefore almost entirely **unpaid**.

Owed, in priority order (all cheap — a control_request is a single stdin line, and the arms that
matter are validation-heavy):
1. **Extend `m2/raw-protocol.ts` to a subtype driver**: after `initialize`, send
   `set_permission_mode` (valid + invalid mode → error response), `set_max_thinking_tokens`
   (valid + invalid → error response), `get_binary_version`, `get_context_usage`, and an unknown
   subtype (→ the `Unsupported control request subtype` else-arm). Each grades `gK`/`$U`, the
   validation branches, and the else-arm — with **no extra live recording**, since none of these
   changes the model request. This is the single highest-value corpus addition in this report.
2. `set_model` — needs a live recording (it changes the request body).
3. `end_session` — a lifecycle claim `m2/cross-resume.ts` would strengthen.

### 3.4 Explicitly not W7

`case "interrupt"` / `case "set_permission_mode"` at `cli.pretty.js` 524,722/524,738
(`chunk-g461tywa.js`) and 206,143–206,280 (`chunk-89sa2r2x.js`) are the **interactive** engine
driver and the TUI's own dispatcher. C1 already proved the first dead under sabotage. Recorded here
so a later scout does not re-discover it.

---

## 4. Parent-impact summary

1. **§2.1's `switch-case` shape does not reach the control protocol, and neither does an
   if/else-arm shape.** W7's seam is the handler functions + `gK`/`$U`, all `free-function`.
   Recommend striking the arm shape from §2.1/§6-W7 rather than building it.
2. **C1's `free-function` shape needs two extensions before W5/W6 can be dispatched**: `async
   function*` targets delegated by `yield*` (all 8 hook dispatchers), and arrow-function
   initializers inside multi-declarator `var` statements (`Dd`, `kye`, `von`). Both are small; both
   are hard blockers.
3. **Neither W5 nor W6 has an S-chunk candidate** — §6's "W6 = S-method + S-chunk (`hw8qz4q5`,
   `8c6qx8qp` with inventories)" should be corrected to S-method only. The census rows behind it are
   wrong (§0); `hw8qz4q5` is W10's.
4. **§3.2's permission-mode matrix is the expensive one** (~10–12 recordings) because
   `bypassPermissions` — 22 of 24 corpus scenarios — short-circuits the entire decision chain.
   `auto` may be gate-dead; probe before budgeting. [SUPERSEDED — banner items 1 and 2: bypass
   short-circuits only the ask, and `auto` is not gate-dead. The matrix is still the expensive one.]
5. **The 832-name minified→semantic map should become a tracked, pin-bump-regenerated artifact.**
   It is derived in seconds, it corrects the census, and a name that moves is a §5 staleness signal
   no current inventory sees.
6. `Qxt` (23 KB, the hook executor) and `von` (11.6 KB, the mode decision) are **S-module-shaped**;
   do not let W5/W6 promise them as S-method rows without a design pass.
