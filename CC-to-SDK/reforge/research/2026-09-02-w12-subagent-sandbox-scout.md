# W12 subagent-dispatch / sandbox scout — the two cores, the fork that headlessness closes, and the cut for C15 (pin 2.1.251)

Scope: C15 / W12 (`subsystem/subagent-dispatch`, `subsystem/sandboxing`, `tool/Agent` — the campaign's
last S-module wave before the query-loop/inversion wave), plus enough of §3.6 to say precisely what of
the isolation story is W12's and what is W13's. READ-ONLY: no build, no gate, no recording, no
scenario was run; nothing outside this file was written.

Method: TypeScript-parser declaration spans over `chunk-fy12d89p.js` (11,314 declarators, parsed clean),
`chunk-q4xe0m2r.js` (838), `chunk-bf5vvscj.js` (492), `chunk-bsdtxcdc.js`, `chunk-38213y7h.js`,
`chunk-13d9rycm.js`, `chunk-eyzf721y.js`; an owning-declaration resolver that maps any offset to its
smallest enclosing top-level declaration; a per-span callee extractor with bundle-wide reference counts
as the private/shared discriminator; a per-class `#private` member walk; substring counts over the
**1,802-file** module set (`cli` + every `.js` under `~/claude-code-bundle/2.1.251/modules/`, the set
`strangle/prepare.ts:textModules()` builds); an offset→chunk-relative-pretty-line calibration against
`cli.pretty.js` (to check the census's locator in the coordinate system it actually speaks); and — as
prior scouts established — **the 267 recorded cassettes and the accumulated transcripts read as
artifacts**, for what the corpus has actually dispatched rather than what its prompts ask for. Two
bounded measurement sub-agents ran under this scout (the sandbox chunk; the corpus coverage) and their
results are folded in below. Scratch scripts in `/tmp/w12scout/`, `/tmp/w12sbx/`, `/tmp/w12cov/`.

Grounding: campaign spec §1.1/§1.2/§1.3/§2.1–§2.4/§3.1/§3.3/§3.6/§6-W12 + the C15 child section and
the five 2026-09-02 Revision Notes; `reforge/research/2026-09-02-w75-hook-executor-design.md` (whose
port-cut rule this document inherits verbatim); the W8, W9, W10, W11 and W13 scouts (format, doctrine, and
the five claims they routed here — including the W13 scout landed today, which routes a third thing
at `ToolRuntimePort`); `2026-08-31-engine-census.md`; `reforge/ledger.json`;
`reforge/README.md`; `reforge/strangle/manifest.ts` and `attestation.ts`; `reforge/src/canonical.ts`,
`differ.ts`, `state.ts`, `harness.ts`; `docs/parity/coverage.md`; `research/fixtures/*.json`.

---

## 0. Sixteen corrections, before anything is budgeted

Every scout so far corrected the census it was handed. This one removes the row's only named
satellite (as W10 did), **exonerates** the census's locator (as W9 did), and finds that the wave's
most distinctive feature — forking a subagent off the parent's own context — is closed by
headlessness itself rather than by any gate, settings key or catalog.

1. **`chunk-bf5vvscj.js` is not the Agent/Task satellite. It is the plugin-hooks `$` runtime, and the
   ledger already assigns it to C8.** The census's subagent row and campaign §1.1 both carry it as
   the row's one named chunk (113 KB). Measured: it exports the hook-site registry (`agent.spawn`,
   `tool.call`, `prompt.section`, `ui.*`, `fs.*`, `store.*`, `http.fetch`), the verdict combinators
   (`ws.*`), and `LU.ledger()`; it contains **zero** occurrences of `Launch a new agent`, `Task`, or
   `worktree`, and one of `subagent_type`. `reforge/ledger.json` already lists it in
   `subsystem/hook-dispatch`'s footprint. **112,652 B leave the row**; about 700 B stay as an edge —
   the `agent.spawn` event descriptor (`vn`), its ten-field argument list (`Ut`), and the `$.agent`
   noun (`cp`). (§1.1, §6)

2. **The census's `fy12d89p @55–58k` locator is CORRECT — and it names about a quarter of the row.**
   Converted to the coordinate system it speaks (chunk-relative pretty lines, calibrated against
   `cli.pretty.js`): the Agent tool object, its 16.7 KB prompt, the run driver and the fork gates sit
   at **55,900–56,978**. Like W9's `@4–10k`, nobody should "fix" it. But five further belts carry the
   rest of the row and none is named anywhere: the **child-stream builder** at ≈53.5k, the
   **observer/delegated-observation belt** at ≈33.9k, the **agent-worktree family** at ≈47.8k, the
   **child-context inheritance contract** at ≈77k, and the **agent task-record family** at ≈105k.
   (§1.1)

3. **The child query loop IS the parent's, and that fixes the W12/W13 boundary exactly.** `Bb`
   (16,471 B, `async function*`) builds a child's context and then delegates the turn loop to
   **`Kx`** — the same 720 B generator that `chunk-dvbbv89q.js` (the headless loop),
   `chunk-6thm48px.js` (interactive) and `chunk-g461tywa.js` (the CLI handler) import. `Kx` has four
   in-chunk callers: `Bb` (subagent), `Uqn` (the backgrounded *main session*), `tT` (the forked-query
   wrapper) and `Oxt` (the model-facing hook evaluator). **There is no nested loop and no reentry:
   there is one loop with several callers.** §1.1's "medium (nested loop reentry)" is the wrong seam
   characterisation, and the right one is a clean split — **W12 owns everything that constructs
   `Kx`'s arguments and everything that cleans up after it; C16/W13 owns `Kx` and its `DAt`/`Djn`
   bodies.** (§1.3)

4. **`subagent_type: "fork"` is unreachable headlessly, and the guard is headlessness itself.**
   `TG() = qmr() !== "disabled"`; `qmr()` consults `adr()`, which is, in full:
   `function adr(){ if(a.CLAUDE_CODE_FORK_SUBAGENT===!0) return "env"; if(Le()) return "disabled"; return "default" }`
   and `Le() = !host.launchOptions.isInteractive()` — **true on every headless run**. This is not a
   `tengu_*` gate (§3.3 does not reach it), not a settings key (W10's sandbox shape does not apply),
   and not a catalog filter. It is the launch mode. The lever is `CLAUDE_CODE_FORK_SUBAGENT=true`, an
   environment variable outside X6 — the same class as W11's `MCP_SDK_GENERATION` and W10's
   `CLAUDE_CODE_USE_POWERSHELL_TOOL`. Everything downstream of it is OPEN by the same guard: the
   `Ux` fork definition, `Alt`/`Plt`, the fork's system-prompt inheritance, `forkContextMessages`,
   `useExactTools`, the REPL replay-log hydration, and the prompt's whole `## When to fork` section.
   (§1.5)

5. **Turning the fork on removes `run_in_background` from the Agent tool's presented schema.**
   `cln = m(() => { let e = Exn().omit({cwd:!0}); return $d()||TG() ? e.omit({run_in_background:!0}) : e })`.
   So the one env flip that opens the fork also **rewrites the tool's input schema** and would break
   `background-task`'s substance check, which asserts `input.run_in_background === true`. A
   flip-liveness cell here is a catalog-shape flip, not a behaviour flip, and it must be recorded that
   way. It is also the cleanest evidence that `TG()` is false in the corpus: `run_in_background` is
   present in all recorded schemas. (§1.5)

6. **W10's private-field blocker does not recur here.** The Agent tool is an **object literal** with
   17 members and zero private fields — the same shape as the Bash tool, and the same shape the
   campaign already splices. Across the whole subagent surface exactly **three** classes declare
   `#private` members, totalling **1,681 B**: `Elt` (610 B, 2 privates — the spawn counters), `vlt`
   (370 B, 3 — the per-spawn outcome handle), `r9` (701 B, 4 — an LRU used only by the web-fetch
   pre-classifier). None is a lifecycle handle that a port must marshal through. (§1.6)

7. **`parallel-tools` is not a subagent scenario, and the corpus has three, not four.** It is a
   three-command Bash batch (`m2c/scenarios.ts:170`). The Agent tool is driven by exactly `subagent`
   (m2c), `background-task` (m3, `substanceOnly`) and `hooks-subagent` (w5). (§5.1)

8. **The recorded Agent input surface is four keys wide, and there is no nested subagent anywhere.**
   Across all 267 cassettes there are 16 `Agent` `tool_use` occurrences carrying **3 distinct
   dispatches**, and their complete key inventory is `description`, `prompt`, `subagent_type` (value
   always `"general-purpose"`) and `run_in_background`. **`isolation`, `model`, `name` and `cwd` have
   zero recordings.** Every recorded child replies with plain text and calls no tool — even though
   `Agent` is present in its own catalog — so the depth axis, the depth cap, and the child's own
   dispatch path are entirely unexercised. The child's catalog *is* observable and already differs:
   **22 tools for the parent, 19 for a foreground child, 13 for a background child.** (§5.1)

9. **The seven sandbox attestation exclusions are wrong in premise a second time, and the remedy is
   an `Options` field.** W10 corrected "a `tengu_*` gate that X6 forbids flipping" to "a settings
   key". The half that correction still left standing is also wrong: `Settings.sandbox` is a **typed
   member of the installed SDK's `Options.settings`** (`enabled`, `failIfUnavailable`,
   `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, plus `network`/`filesystem`/`credentials`
   subtrees), *and* there is a second, direct `Options.sandbox`. Both bypass the environment
   entirely, both survive `settingSources: []`, and the harness already passes inline `settings` at
   17 sites. Fourteen branch exclusions across `permission-precheck` and `rule-based-permissions`
   argue unreachability from the environment; none of them argues it from the options, and the
   options are the reachable path. (§2.4, §6)

10. **The teammate surface's guard is a CLI argv flag, not an environment variable.**
    `io() = (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS || process.argv.includes("--agent-teams")) && I("tengu_amber_flint", true)`.
    The gate defaults **true**, so §3.3 leaves it on; what closes the surface is the flag. `m2/raw-protocol.ts`
    already drives the engine over raw stdio and controls its argv, so the 29,020 B teammate chunk
    (`chunk-eyzf721y.js`, seven **self-named** exports) is OPEN-with-a-named-lever that X6 does not
    forbid, rather than dead. (§1.7)

11. **Nothing in the harness resets or observes what a subagent leaves behind.** `resetSandbox()`
    clears the children of `reforge/sandbox/` and `<CONFIG_DIR>/plans` and nothing else. A dispatched
    agent's output file lands at `/private/tmp/claude-501/<project-slug>/<session-uuid>/tasks/<task-id>.output`
    — outside both the sandbox and `CONFIG_DIR`, so it is neither snapshotted by `src/state.ts` nor
    reset between runs. A worktree scenario would additionally leave a git worktree that nothing
    cleans. This is the same class of leak W9 found for the task store, one directory further out.
    (§4.1, §6)

12. **The caps are measured, and both are behaviour an owned module owes.** Spawn depth:
    `jS()` = `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` env, else the GrowthBook value of
    `tengu_hazel_trellis` with a compiled-in default of **3** — so **3** under §3.3. Concurrency:
    `AXn()` = `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? 20` — so **20**. Both produce a distinct,
    uniquely-anchored refusal sentence, and the depth cap additionally **removes the `Agent` tool from
    a child's catalog** once `agentDepth >= jS()`. (§1.4, §1.8)

13. **The sandbox chunk is 83.5 % vendored, and the seam is exact.** `chunk-q4xe0m2r.js`'s 581,554 B
    split at offset **485,420** (the `ct` declaration, the last thing the vendored package emits):
    **478,991 B / 474 declarations vendored** — picomatch (24,586 B @2,952–27,563),
    `@bufbuild/cel` + `@bufbuild/protobuf` (319,450 B @27,568–347,533, of which a single
    peggy-generated CEL grammar parser is 63,950 B), and `@anthropic-ai/sandbox-runtime` itself
    (134,955 B @347,688–485,420) — against **94,760 B / 230 declarations of Claude-Code-own layer**.
    §1.1's "module-level (CEL/protobuf tangle)" describes the *file*; the owned surface is a sixth of
    it and does not touch CEL at all. Every vendored byte is §1.2-excluded (engine-ts imports the real
    packages). (§2.1)

14. **`pt` and `ct` are object literals, not classes, and no `#private` field exists anywhere on the
    sandbox façade path.** `pt` is 2,672 B with **49** properties, of which 43 are ≤70 B
    pass-throughs and only six carry a body; `ct` is 743 B with 32 properties, all bare references.
    Four classes in the whole chunk declare a private member (`JT`, `Xl`, `wo` — all vendored CEL —
    and `j0`, a 614 B ripgrep-availability cache with one private field). So **neither half of W12
    inherits W10's blocker**: the subagent half has three tiny counter classes, and the sandbox half
    has none at all. (§2.2)

15. **On macOS, `checkDependencies()` does nothing — it never probes `sandbox-exec`.** `Rg` (605 B,
    the real probe) branches on `Ct()`; `"macos"` matches neither the Linux nor the Windows arm, so
    it returns `{errors:[],warnings:[]}` after the platform check alone. The literal
    `/usr/bin/sandbox-exec` occurs **exactly once across the 1,802-file module set**, inside `qh`,
    the argv assembly — at exec time, not at check time. macOS availability is *assumed from the
    platform identity*, so a missing binary surfaces as a spawn failure on the first command rather
    than as a dependency error at init. That is a behaviour an owned module must reproduce and an
    oracle can test with no sandbox at all. (§2.5)

16. **The census's `.claude/agents` locator does not hold for `q4xe0m2r`.** Its one occurrence in the
    chunk is inside `lc()`, a list of config directories the sandbox filesystem policy treats
    specially, beside `.claude/commands`, `.gitmodules`, `.bashrc`, `.mcp.json`. The chunk contains
    **zero** occurrences of `agentType`, `subagent_type`, `whenToUse` or any agent-loading
    identifier. The `.claude/agents` row's third chunk should be removed. (§6)

---

## 1. Subagent dispatch, measured

### 1.1 Where it lives, and what leaves the row

| unit | bytes | decls | what it is | verdict |
|---|---|---|---|---|
| `chunk-fy12d89p.js`, **tool + dispatch belt** (≈55.9–57.0k pretty) | **107,321** | 60 | the `Agent` tool object, its prompt, the run driver, the fork gates, schemas, spawn stats | W12 |
| `chunk-fy12d89p.js`, **child-stream belt** (≈53.5k) | included above (`Bb`, `Agr`, `e2`, `DRn`…) | — | the child-context assembly and the SubagentStart fan-in | W12 |
| `chunk-fy12d89p.js`, **agent task-record family** (≈105k) | **15,875** | 29 | `MG`/`Ilt` record creation, `kx`/`Vx`/`clt`/`llt`/`_ne` lifecycle writes, keepalive, `Uqn` | W12 writes, **C11c owns the store** |
| `chunk-fy12d89p.js`, **observer / delegated-observation belt** (≈33.9k) | **13,892** | 16 | `_W`, `I7e`, `SW`, `D7e`, `G_e`, `Zon`, `Qon`, `H7e`, `L9n`, `q7e` | W12 |
| `chunk-fy12d89p.js`, **agent-worktree family** (≈47.8k) | **17,136** | 15 | `Zye` create, `ZW`/`bN` remove, `q3n`/`hEn` naming, `Jye` validation, `Aqn` metadata clear | W12 (shared helpers with C11's worktree tools) |
| `chunk-eyzf721y.js` | **29,020** | 7 exports | **teammate spawn**, seven *self-named* exports (`spawnTeammate`, `reserveTeammateIdentity`, …) | W12, behind a CLI flag (§1.7) |
| `chunk-bsdtxcdc.js`, agent-context belt | ≈2,000 | ~16 | the `agentContext` AsyncLocalStorage (`fw`), `ka` (delegated observation), `vc` (depth), `TC`/`Rbt`/`kbt`/`A$`, `Jk` (`subagentSteer`), `U3t` (isolation evidence) | **shared** — C5 already ports `Jk` |
| `chunk-38213y7h.js`, `Th` + `po` | **153** | 2 | **the agent-id mint** and its (no-op) brand cast | shared, tiny |
| `chunk-9xdt2ay0.js` (whole chunk) | **1,137** | 1 export | `jS()`, the spawn-depth cap | W12, S-chunk |
| `chunk-9rtx6cwj.js` (whole chunk) | **1,026** | 2 exports | `io()`, the agent-teams switch | W12, S-chunk |
| `chunk-13d9rycm.js` `yl`/`eV` | ~730 of 26,040 | 2 | the `/tasks/<agent-id>.output` path and its binding | **C11c's / W10's** |
| `chunk-n90xnvep.js` | 11,912 | 7 exports | **a semantic barrel** — `Bb as runAgent`, `Agr as initializeAgentMcpServers`, `Aqn as clearWorktreeFromAgentMetadata`, `Qan as filterIncompleteToolCalls`, `Cgr as isDisposableSubagentCache`, `vgr as withScratchpadSection`, `Eqn as SIBLING_ROSTER_REMINDER_PREFIX` | naming artifact |
| `chunk-zp0shqm2.js` | 12,145 | 14 exports | **a second semantic barrel** — `kan as createSubagentContext`, `tT as runForkedAgent`, `Egr as ASYNC_SHARED_APP_STATE_KEYS`, `w4n as FORKED_AGENT_DEFAULT_MAX_TURNS`, `Han as forkPointUuidOf`, `pdt as prepareForkedCommandContext`, … | naming artifact |
| `chunk-jna7qpeb.js` | 14,142 | 2 exports | `installObserverSpawner` / `spawner` — the observer spawner | W12 (observer belt) |
| `chunk-habzwgt7.js` | 21,545 | 11 exports | agent-spawn helpers (17 `subagent_launch`, 14 `observer`) — a fourth `Bb`/`n9`/`MG` consumer | W12, unexamined this pass |
| **remote agent** (`Ev` 29,228, `Dle`, `Iee`, `i7`, `Slt`, `kEe`) | **31,440** | 6 | cloud-session launch | **§1.2 EXCLUDED** (server boundary) |
| `chunk-bf5vvscj.js` | **112,652** | 492 | **the plugin-hooks `$` runtime — NOT this row** (§0.1) | REMOVED (C8's) |

**Denominator: ≈188 KB owned by W12's subagent half** (154 KB in the engine chunk + 29 KB teammate +
~4 KB of small satellites), minus the 113 KB the census wrongly attributed and the 31 KB of remote
that §1.2 excludes. Add ≈36 KB of unexamined satellites (`jna7qpeb`, `habzwgt7`) if the observer belt
is taken whole.

**There are four dispatch entry points, not one.** `Bb` (`runAgent`) has **eleven consumers** — four
inside the engine chunk (`Ane.call` twice, `$Ft` the forked-skill dispatcher at 2,677 B, `eIn` the
skill invocation path at 3,685 B) and **seven importing chunks** (`n90xnvep` the barrel,
`chunk-xdx612ep.js` the 76,865 B Workflow runner, `chunk-2phb3yw1.js` teammate, `chunk-873qaqbz.js`,
`chunk-habzwgt7.js`, `chunk-jna7qpeb.js`, `chunk-304awr1a.js` the slash/skill expansion chunk W11
named). `n9` and `MG` each have three external importers. So an owned `Bb` serves the Agent tool, the
forked-skill path, the skill tool, Workflow and the observer spawner — **the wave's blast radius is
larger than the Agent tool, and that is an argument for owning it, not against.**

### 1.2 The `Agent` tool object, member by member

`Ane` = `kt({…})` at offset 1,953,698, **27,595 B, 17 members, zero private fields** — an object
literal passed to a tool factory, the same shape as `yi` (Bash) and the same shape the campaign's
proven S-method already splices.

| member | bytes | note |
|---|---|---|
| **`call`** | **22,962** | the dispatch — §1.3 |
| **`mapToolResultToToolResultBlockParam`** | **3,591** | four result statuses, all uniquely anchored — the proven splice shape |
| `prompt` | 249 | delegates to `wlt` (16,727 B) |
| `checkPermissions` | 245 | `!Jy(mode)` → allow; else `hlt` fast path → allow; else `passthrough` with `"Agent tool requires permission to spawn subagents."` |
| `getActivityDescription` | 92 | whitespace-collapse of `description`, `"Running task"` fallback |
| `toAutoClassifierInput` | 137 | `"(<subagent_type>): <prompt>"` |
| `outputSchema` / `inputSchema` | 32 / 31 | `xxn()` / `cln()` |
| `description` | 47 | the literal `"Launch a new agent"` |
| `searchHint` | 40 | `"delegate work to a subagent"` (2× bundle-wide) |
| `userFacingNameBackgroundColor` / `userFacingName` | 33 / 18 | `qFt` reads `subagent_type` |
| `isConcurrencySafe` / `isReadOnly` | 29 / 22 | both `return !0` |
| `maxResultSizeChars` | 22 | `JWt = 100,000` |
| `aliases` | 12 | `["Task"]` |
| `name` | 7 | `yt = "Agent"` |

The schema is worth stating in full because it is where the catalog surface lives. `vxn` (1,390 B) is
the base — `description`, `prompt`, `subagent_type`, `model` (`sonnet|opus|haiku|fable`),
`run_in_background`. `Exn` (1,351 B) merges `name`, the two **deprecated-and-ignored** fields
`team_name` and `mode`, and extends with `isolation` (`worktree|remote`) and `cwd`. `cln()` is then
`Exn().omit({cwd})`, further `.omit({run_in_background})` when `$d() || TG()`. **So headlessly the
model sees eight fields: `description`, `prompt`, `subagent_type`, `model`, `run_in_background`,
`name`, `team_name`, `mode`, `isolation` — and never `cwd`**, which `call` still destructures for
internal callers.

`wlt` (**16,727 B**) is the description builder: six conditional section headers
(`## When to fork`, `## Writing the prompt`, `## When not to use`, two `## When to use`,
`## Usage notes`) with per-guard suppression (`bz()` for the remote bullet, `lN()`/`na()` for the
teammate bullets, the fork gate for the whole first section). **The Agent tool's prose is larger than
its dispatch code and almost exactly the size of the Bash tool's prose (16,590 B)** — the same
observation W10 made, on the other big tool.

### 1.3 The dispatch, end to end

```
Ane.call(input, ctx, canUseTool, parentMsg, emit)          22,962 B
 ├ depth cap        vc(agentContext) >= jS()   → Ek "Subagent nesting limit reached (depth N of 3)"
 ├ teammate refusals (teammateContext||QV()) && name  → Ek; teammate && background → Ek
 ├ agent-type resolution
 │    Alt/Rlt (fork + general-purpose availability) · A3e (available agents) · pV (deny rules)
 │    d_() NFKC-fold normalisation → exact / ambiguous / normalised / not-found (4 refusals)
 ├ budget + concurrency          qB(maxBudgetUsd) → Ek ; At()/nt() → AXn()=20, takes a slot
 ├ TEAMMATE branch    io() && name && !fork && !isolation && !cwd
 │    → chunk-eyzf721y.js spawnTeammate(...)  → {status:"teammate_spawned"}
 ├ isolation resolution   lt = input.isolation ?? definition.isolation
 │    web-fetch agent → ignored (log) ; "remote" without login/gate → falls back to "worktree" or local
 ├ background decision    Xe = remote || (run_in_background===true || def.background || …) && !$d()
 ├ requiredMcpServers wait   up to 30 s polling appState.mcp.clients → Ek if unmet
 ├ HOOK: agent.spawn         MC.agentSpawnCore(resolveModel) → Fb.dollar(...).agent.spawn(mn)
 │                           → Xj.agentSpawnDecision → deny → Ek "Subagent spawn denied by a plugin: "
 │                           → the hook may REWRITE the model and nothing else (bf5vvscj's `vn`)
 ├ model resolution   q0(N8(def, parentModel), parentModel, fork?"inherit":model, mode)
 ├ system prompt      FORK: reuse ctx.renderedSystemPrompt (or rebuild via uD)
 │                    FRESH: zH([def.getSystemPrompt({primedAgentMemory})], model, extraDirs)
 ├ prompt messages    FORK: fWn(prompt, parentMsg)   FRESH: [xe({content: prompt})]
 ├ CHILD CATALOG      Yn = SD(childPermCtx, mcpTools, {skipReplFilter:true, skillTools})
 │                    FORK: availableTools = ctx.options.tools verbatim + useExactTools:true
 ├ observer arming    _W (declared observer) | I7e (inherited from parent pairing) → SW(...)
 ├ WORKTREE           lt==="worktree" → Zye(`agent-${agentId}`) → {worktreePath, worktreeBranch,
 │                    headCommit, gitRoot|hookBased}; U3t(agentId) records isolation evidence
 ├ agent id           Cn = Th()   →  "a" + 8 random bytes as hex   (16 hex chars)
 ├ name registration  ctx.agentLifecycle.registerName(name, agentId)
 ├ emit               dr().agentSpawned.emit({agentId, agentType, parentAgentId, taskRegistry})
 ├── ASYNC arm  ─────────────────────────────────────────────────────────────────
 │    MG({agentId, ownerAgentId, parentAgentId, spawnDepth, …}) registers a `local_agent` task
 │    fw(agentContext, () => H5(cwd, () => n9({... makeStream: Bb(...) ...})))   [not awaited]
 │    → {status:"async_launched", agentId, outputFile: yl(agentId), canReadOutputFile}
 └── SYNC arm  ──────────────────────────────────────────────────────────────────
      Ilt({... autoBackgroundMs: wxn() ...}) registers the task with an auto-background timer
      setTimeout(bxn = 2000) → emitToolProgress({kind:"background_hint"})
      race( n9(...) , qn.backgroundSignal )
        backgrounded → {status:"async_launched", …}   done → yEe(...) → {status:"completed", …}
      finally: In() (worktree disposition) · ys(taskId, status, {toolUseId, summary, usage})
```

**The child's turn loop.** `Bb` (16,471 B) is a wrapper, not a loop: it resolves the child's model
(`mnt`), permission context (a memoised `Cn(appState)` that clamps a declared `bypassPermissions` back
to the parent's mode unless the session is contained), tool set (`_E` → `KPn` → `e2`), system prompt
(`FRn`/`vgr`, plus `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`), MCP clients (`Agr`), skills preload,
attachments, and the child `toolUseContext` (`kan`); fires **SubagentStart** (`kUt`, skipped entirely
when `ka(agentContext)`); persists the fork-context reference; and then delegates to **`Kx`**. On the
way out it runs an **18-stage named cleanup ladder** (`SubagentStop`, `mcp`, `sessionHooks`,
`promptCacheTracking`, `propagateNestedMemory`, `readFileState`, `sentSkillNames`, `initialMessages`,
`liveMessages`, `replHydrationSnapshot`, `perfetto`, `otelSubagentSpan`, `transcriptSubdir`, `todos`,
`replContext`, `nonShellMonitors`, `shellTasks`), two of which are **`keepaliveGated`** — skipped when
the agent is async, stopped cleanly, and holds a live shell or monitor task.

`n9` (9,095 B) is the run supervisor around that stream: turn counting, an in-flight `tool_use_id`
set with an `isIdle` projection onto the task record, per-message transcript writes, model-swap
tracking, a **stall watchdog** (`CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS || 600_000`, re-armed on every
message and on throttled query progress, *deferred while any tool is in flight*), keepalive parking
("parked on keepalive — deferring owner notification until resume"), the handback safety classifier
`j4e`, and the terminal bookend `kx({status: completed|failed|killed})`.

### 1.4 What a child inherits — `kan`, the contract

`kan` (3,937 B) derives the child's `toolUseContext` from the parent's across ~60 named fields. It is
a pure function of `(parentCtx, overrides)` and it is the single most gradeable artifact in the wave.

| class | fields |
|---|---|
| **shared by reference** (33) | `messageQueue`, `hookOrigin`, `hookCaller`, `pluginSteered`, `dedupUnchangedReads`, `pendingNestedMemoryTriggers`, `sessionEnvVars`, `toolState`, `getMcp`, `getProactivityLevel`, `getWebBrowser`, **`taskRegistry`**, `queuedNotificationsRegistry`, **`sessionHooksRegistry`**, `artifactRegistries`, `agentLifecycle`, `teammateColors`, `rootToolSurface`, `storageV5`, `credentials`, `requestDialog`, `permissionRelays`, `agentWorktree`, `fileReadingLimits`, `isolationLatch`, … |
| **derived** | `abortController` = `w_(parent)` (a child controller) unless `shareAbortController`; `getAppState` forces `toolPermissionContext.shouldAvoidPermissionPrompts = true`; `permissionLayers` = parent's ++ `[{kind:"avoid_prompts"}]` ++ override's; `readFileState` = `f3(…, {stripSeededFromContext:true})`; `contentReplacementState` = `b8n(parent's)`; `queryTracking` = `{chainId: fresh, depth: parent.depth + 1}`; **`agentId` = `overrides.agentId ?? Th()`** |
| **reset** | `nestedMemoryAttachmentTriggers: []`, `loadedNestedMemoryPaths: {}`, `dynamicSkillDirTriggers: []`, `toolDecisions: undefined`, `onCompactEvent: undefined`, `turnStartIndex: 0`, `memorySelector: dD()`, `localDenialTracking: Tle()` |
| **severed** | `setToolPermissionContext` → **no-op**; `getFileHistoryState` → `() => undefined`; `applyFileHistoryOp` → only `touch` propagates; `setArtifactReadVersion` / `setArtifactContractTarget` → **no-ops when `ka(agentContext)`** (the delegated-observation filter) |
| **filtered write-back** | `setAppState` propagates **only** the four keys in `Egr = ["frameUrls","workshopVerifiedSlugs","sidecarHistorySlugs","prReviewSlugs"]`, all of them §1.2 artifact/PR periphery — so on the headless path **a child cannot mutate the parent's app state at all** |

### 1.5 Fresh vs fork, and why the fork is closed headlessly

| axis | fresh subagent | fork (`subagent_type: "fork"`) |
|---|---|---|
| system prompt | `zH([definition.getSystemPrompt(...)], model, dirs)` — the agent's own | **the parent's `renderedSystemPrompt` verbatim** (or rebuilt with `uD`) |
| messages | `[xe({content: prompt})]` — one user message | **`forkContextMessages: parent.messages`** + `fWn(prompt, parentAssistantMsg)` |
| tools | `SD(childPermCtx, …)` — a freshly built catalog | **`ctx.options.tools` verbatim, `useExactTools: true`** (so `KPn`'s filter is skipped) |
| model | `q0(N8(def, parent), parent, requested, mode)` | `"inherit"` — the `model` parameter is documented as ignored |
| REPL | fresh | `replHydration: {kind:"fork", log: [...parent's replayLog]}` |
| definition | the resolved `.claude/agents` entry | `Ux` — `{tools:["*"], maxTurns:200, model:"inherit", permissionMode:"bubble", getSystemPrompt:()=>""}` |
| refusals | agent-type ladder | `Plt`: `subagent_fork_remote_isolation`, `subagent_recursive_fork` |

**Does a fork copy the parent transcript?** No — it *passes it*. `forkContextMessages` is the parent's
own array; `Bb` prepends `Qan(_)` (a de-duplicated projection) and records a `fork-context-ref`
storage entry (`rzn`) rather than re-writing the messages. That record type is one of W9's
twenty-nine never-written ones, and this is its only producer.

**The guard, in full.** `TG()` → `qmr()` → `adr()`:
```js
function adr(){ if(a.CLAUDE_CODE_FORK_SUBAGENT===!0) return "env"; if(Le()) return "disabled"; return "default" }
function qmr(){ …; if(K9()) return "disabled"; if(a.CLAUDE_CODE_FORK_SUBAGENT===!1) return "disabled";
                if(latched) return latched; …}
```
`Le() = !host.launchOptions.isInteractive()`. **OPEN by construction headlessly, with a named env
lever outside X6**, and — per §0.5 — flipping it also removes `run_in_background` from the schema.

### 1.6 Module-level state, private fields, and shapes

**Private fields: three classes, 1,681 B, none load-bearing.**

| class | bytes | members | private | role |
|---|---|---|---|---|
| `r9` | 701 | 12 | 4 (`#e #t #n #r`) | LRU (2,048 entries / 600 s), used only by `SEe`, the web-fetch pre-classifier |
| `Elt` | 610 | 6 | 2 (`#e #t`) | spawn counters — `spawned`, `requested{background,foreground,unset}`, `max_depth`, `refused{depth_limit,concurrency_limit,budget}`, `by_type` |
| `vlt` | 370 | 6 | 3 | the per-spawn outcome handle (`completed`/`failed`/`killed`/`cancelledAfterCompletion`) |

**Module-level state (§2.1's declaration requirement):**

| state | where | scope | note |
|---|---|---|---|
| **`vbt = new X9`** — the `agentContext` AsyncLocalStorage | `chunk-bsdtxcdc.js` @608,428 | process | `fw(ctx, fn)` runs every child inside it; `ka`/`vc`/`TC` read it. **The one true async-context global in the wave.** |
| `gSe = new Ln(() => new Elt)` | `fy12d89p` @1,948,945 | host | spawn counters |
| `Fa().forkSubagentEnabledSource` | `chunk-w4pcf9py.js` | process, **write-once** | the fork latch |
| `Fa().maxSubagentSpawnDepthFromGrowthBook` | same | process, write-once | the depth-cap memo |
| `kt().agentIsolationEvidence` (`class NM`: `spawned`/`cleanlyRemoved` Sets) | `chunk-bsdtxcdc.js` @593,656 | host | worktree isolation evidence |
| `dr().agentBackgroundSignalResolvers`, `dr().outputPathBindings` | `chunk-bsdtxcdc.js` / `chunk-13d9rycm.js` | host | background-signal resolvers; task-output paths |
| `Jt().spawnProvenance` (via `hIe.recordSpawnProvenance`) | `fy12d89p` @1,648,601 | host | hook origin per agent id |
| `appState.agentNameRegistry` | app state | session | `name → agentId`, read by `SendMessage` addressing |
| `agentLifecycle` (`registerName`, `allocateName`, `markTypeInvoked`, `clearTodos`) | ctx | session | shared by reference into every child |

**Id shapes, measured.** `Th(name?)` (129 B, `chunk-38213y7h.js`): `a${randomBytes(8).toString("hex")}`,
or `a${sanitizedName}-${hex}` when a name is given. `po(e)` is `function po(e){return e}` — the
`AgentId` brand is **compile-time only, a runtime no-op**. Worktree names are `q3n(id) = "agent-"+id`,
matched by `hEn`'s regex table (`/^agent-a[0-9a-f]{16}$/`, `/^agent-a[0-9a-f]{7}$/`, plus workflow,
bridge, job and bg shapes). The output path is `yl(taskId)` — a `dr().outputPathBindings` lookup, else
`join(tasksDir(), taskId + ".output")`. **Task ids and agent ids share one alphabet**; §5.2 records
what that costs the differ.

### 1.7 Teammates, observers, and the remote arm

**Teammates** (`chunk-eyzf721y.js`, 29,020 B) are reached only from `Ane.call`'s one
`import.meta.require`, under `io() && name && !fork && !webFetch && !isolation && !cwd`. `io()` is
`(CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS || process.argv.includes("--agent-teams")) && I("tengu_amber_flint", true)`
— **the gate defaults true; the flag is what closes it**, and the flag is argv. The chunk names its
own API (`spawnTeammate`, `finalizeTeamMember`, `generateUniqueTeammateName`,
`registerOutOfProcessTeammateTask`, `reserveTeammateIdentity`, `resolveTeammateModel`,
`buildInheritedCliFlags`) — the third self-naming artifact the campaign has found, after W9's barrel
and W11's export aliases.

**Observers / delegated observation.** `_W` arms an observer declared on the spawned definition;
`I7e` fans an *inherited* arming out from the parent's pairing; `SW` registers the pairing.
`ka(ctx) = ctx?.agentType === "subagent" && ctx.delegatedObservation === true` is the predicate the
W7.5 hook design named for `Xxt`, and it has **three more consumers than that design records**:
`Bb` skips **SubagentStart** entirely for a delegated-observation child; `y9` returns before dispatching
**SubagentStop/Stop**; and `kan` severs both artifact writers. So delegated observation is not a
result filter — it is a **mode that removes three hook dispatches and two write paths**, and any
owned implementation that models it as an output filter is wrong.

**Remote (`isolation: "remote"`).** 31,440 B (`Ev` alone is 29,228) reaching `Iee` (eligibility),
`Ev` (cloud session create) and `Dle` (task registration + a permission relay). Guarded by
`bz()` — `!CLAUDE_CODE_EVAL_CONFINED && pr() && …` (a claude.ai login and a feature gate). **§1.2
server boundary; excluded, with the fallback behaviour still W12's**: when remote is unavailable the
tool *silently rewrites* `isolation` to `"worktree"` (or to local) and logs
`[remote agent] isolation:'remote' is unavailable …`. That fallback is reachable and gradeable.

### 1.8 The child's catalog is observable, and it is already diffed

`KPn` (423 B) is the child-catalog filter, and it is pure:

```js
C = tools.filter(A => {
  if (K_(A)) return true;                              // MCP tools always survive
  if (on(A, yu) && mode === "plan") return true;       // ExitPlanMode in plan mode
  if (Bk(A, SOe)) return false;                        // externally-excluded set
  if (!isBuiltIn && Bk(A, wXn)) return false;
  if (on(A, yt)) return agentDepth < jS();             // the Agent tool, gated by the DEPTH CAP
  if (TXn.has(A.name)) return EXn(isBuiltIn, agentType);   // TXn is empty — dead
  if (isAsync && !Bk(A, DVe)) { … return false }       // async children get a NARROWER catalog
  return true });
if (mode === "plan" && !C.some(A => on(A, yu))) C.push(r2);
```

The corpus already proves its output on the wire: **22 tools in the parent's catalog, 19 for a
foreground child, 13 for a background child.** That is three graded partitions of a pure function, for
free, today. `_E` (2,163 B) wraps it with the `tools`/`disallowedTools` frontmatter resolution and
produces `{validTools, invalidTools, unavailableTools, resolvedTools, allowedAgentTypes, hasWildcard}`
— the four buckets whose emptiness produces the `tengu_subagent_zero_tools` refusal. `e2` (421 B)
re-admits the built-in web-fetch agent under a five-term condition.

### 1.9 Anchors

Counted across the **1,802-file** module set; em-dashes written in the six-character `—` escape
form per W8's rule (six candidates counted 0 as characters and 1 as escapes — the rule bites here too).

**Unique (1 of 1):** `Launch a new agent to handle complex, multi-step tasks` · `Async agent launched
successfully.` · `Cloud agent launched.` · `Spawned successfully. (This tool result is internal
metadata` · `(Subagent completed but returned no output.)` · `subagent_tokens: ` · `Unexpected agent
tool result status: ` · `Subagent nesting limit reached (depth ` · `Concurrent subagent limit reached.
You can run ` · `Teammates cannot spawn other teammates — the team roster is flat.` · `would be
spawned with zero tools — refusing. ` · `Subagent spawn denied by a plugin: ` · `Fork cannot use
isolation: "remote" — …` · `Fork is not available inside a forked worker.` · `Fork — inherits
full conversation context.` · `Fork started — processing in background` · `[remote agent]
isolation:'remote' is unavailable ` · `Agent worktree kept at: ` · `Hook-based agent worktree kept at: `
· `backgrounded owner awaits keepalive, resume pending` · `## When to fork` · `SubagentStart hooks
cancelled (control stream closed)` · `[runAgent] SubagentStop on interrupted query failed: ` ·
`[runAgent cleanup] stage '` · `Sync agent recovering from error with ` · `The activity above is a
read-only digest of the agent you are observing — it is ` · `Other agents active in this session,
addressable via ` · `Agent tool requires permission to spawn subagents.` · `Makes it addressable via
SendMessage({to: name}) while running.` · `Deprecated; ignored. The session has a single implicit
team.` · `Agents run in the background by default; you will be notified when one completes.` ·
`Mutually exclusive with isolation:` · `always runs in background; availability is gated` ·
`subagent_type is required: the general-purpose agent is not available in this session` (in
`chunk-k8vt31j7.js`) · `bg-subagent progress write failed: ` · `Preloaded skill '` — plus the
telemetry names `tengu_subagent_zero_tools`, `tengu_agent_tool_completed`,
`tengu_subagent_type_normalized`, `tengu_async_agent_stall_timeout`, `tengu_agent_tool_remote_launched`,
`tengu_agent_max_turns_reached`.

**Ties needing a `coLiteral` or `signature`:** ` is ambiguous — matches ` (2, second in
`w7bq1qyb`) · `In-process teammates cannot spawn background agents.` (2, both inside `Ane.call`) ·
`Budget limit reached ($` (2, one in `dvbbv89q`) · `[web-fetch agent] isolation:'` (2) ·
`tengu_agent_tool_terminated` (3, all inside `Ane.call`/`n9`) · `tengu_subagent_type_miss` (3, all in
`Ane.call`) · `Forked agent [` (4) · `delegate work to a subagent` (2) · `subagent_launch` (**70**, of
which 18 are in the teammate chunk and 17 in `chunk-habzwgt7.js` — never use it as an anchor).

**Genuinely unanchorable, enumerated:** `Th`, `po`, `kan`, `KPn`, `e2`, `Alt`, `Rlt`, `Cne`, `N8`,
`vc`, `ka`, `TC`, `MG`, `Ilt`, `Dlt`, `Olt`, `fIe`, `Pat`, `mA` — all pure or near-pure, all small,
all fold-ins to a spliced caller that does have an anchor. **W12's anchor budget is the most
comfortable of any wave so far**: ~36 unique prose anchors across the subagent half alone.

---

## 2. The sandbox, measured

### 2.1 Composition: what of `q4xe0m2r` is sandbox logic and what is vendored

581,554 B, 838 top-level statements = 132 imports + 1 export statement (96 symbols) + 1 expression
statement + **704 code declarations** (229 `var`, 459 `function`, 16 `class`) carrying 573,751 B
(98.66 % declaration density). The vendored/own seam is at **offset 485,420**, the `ct` declaration —
the last thing the vendored package emits — confirmed independently by the caller boundary (the last
call to the package's own platform helper `Ct()` is at 485,222; the first call to the Claude-Code
state accessor `at()` is at 514,474).

| region | offsets | decls | bytes | identity |
|---|---|---|---|---|
| **picomatch** | 2,952–27,563 | 6 | **24,586** | constants / utils / scan / parse (15,199 B) / picomatch / a Windows-aware wrapper |
| **`@bufbuild/cel` + `@bufbuild/protobuf`** | 27,568–347,533 | 104 | **319,450** | BinaryReader/Writer, `descriptor.proto` codegen (31,750 B), registry, CEL overload ids (11,785 B), planner, and a **63,950 B peggy-generated CEL grammar parser** — the largest declaration in the file |
| `sl-gate` latch | 347,538–347,687 | 5 | 144 | Claude-Code-own |
| **vendored `@anthropic-ai/sandbox-runtime`** | 347,688–485,420 | 364 | **134,955** | its own debug logger (`SRT_DEBUG`), its own platform fn `Ct()`, seatbelt/bwrap/seccomp/srt-win |
| **Claude Code sandbox layer** | 485,420–581,553 | 225 | **94,616** | uses the harness accessors; ends at `pt` @577,398 |

**478,991 B / 474 declarations vendored (83.5 %) against 94,760 B / 230 declarations of
Claude-Code-own layer (16.5 %).** Every vendored byte is §1.2-excluded — engine-ts imports
`picomatch`, `@bufbuild/*` and `@anthropic-ai/sandbox-runtime` as packages. §1.1's
"module-level (CEL/protobuf tangle)" describes the *file*, and the tangle is not in the part W12 owns.

`picomatch` is present but a grep for the string `"picomatch"` returns **zero** — the minifier strips
package identifiers, so composition has to be read off exported-symbol prose and the node-builtin
import blocks bun emits at each package entry.

**And there is a barrel.** `chunk-6v95pkgg.js` (7,350 B) is a pure re-export alias table mapping every
minified sandbox symbol to its source name — `pt as SandboxManager`, `F2 as getEffectiveFilesystemPolicy`,
`Vwe as shouldForceSandboxOn`, `Qgt as getTenguSandboxGbConfig`, `eht as convertToSandboxRuntimeConfig`,
`HVe as isScrubOnlySandboxMode`, `lmn as classifyWindowsSandboxLaunchExit`, `W_r as HOST_CEL_POLICIES`
and ~36 more. This is the same gift W9 found in `chunk-e6cn1914.js`. It is **not** in
`research/fixtures/symbol-map-2.1.251.json`, and it should be — it is the ground-truth naming for the
whole surface and a pin bump re-derives it in place.

### 2.2 The façade, and the private-field verdict

| | offset | bytes | properties |
|---|---|---|---|
| `pt` (`SandboxManager`) | 577,398 | **2,672** | **49** |
| `ct` (the srt package façade) | 485,420 | **743** | **32** |

Both are **plain object literals** — no class, no prototype, no `this`, no constructor, **no
`#private` fields**. 43 of `pt`'s 49 properties are ≤70 B bare identifier or `ct.x` references (20 of
them delegate straight through to `ct`); only six carry a body: `getFsReadConfig` (636 B, memoised with
a raw-deny-list fallback on throw), `getFsWriteConfig` (195), `invalidateDependencyCache` (172),
`getNetworkRestrictionConfig` (134), `annotateStderrWithSandboxFailures` (70), `cleanupAfterCommand` (60).

Four classes in the chunk declare a private member: `JT` (6,026 B, 1 private), `Xl` (860, 1) and `wo`
(249, 1) — all vendored CEL — and `j0` (614 B, 1 private, a ripgrep-availability status cache) in the
Claude-Code layer. 68 of the 72 classes have none. **The sandbox surface reachable through `pt` is
private-field-free**, which together with §1.6 means **neither half of W12 inherits W10's blocker.**

### 2.3 The guard chain, every predicate resolved

```
pt.isSandboxingEnabled = Xa()   @566,749, 111 B
  function Xa(){ if(bu(), at().sandboxDisabledThisSession) return !1;
                 if(!Tm()) return !1;
                 return Eu().errors.length === 0 }
```

| id | @ | B | body / behaviour | reads |
|---|---|---|---|---|
| `Tm` | 567,102 | 38 | `Pi() && qa() && xm()` | — |
| `Pi` | 565,791 | 142 | `try{ if(Vwe()) return !0; return En()?.sandbox?.enabled ?? !1 } catch { log; return !1 }` | **merged settings `sandbox.enabled`** |
| `qa` | 566,534 | 215 | `policySettings.sandbox.enabledPlatforms`: `undefined`→true, `[]`→false, else `.includes(platform)`; throws→true | managed policy |
| `xm` | 566,451 | 83 | `platform === "windows" ? L2() : baseIsSupportedPlatform()` | — |
| `Vwe` | 565,679 | 112 | `shouldForceSandboxOn`: `if(!Qgt().disableNoSandbox) return !1; …` | gb config; env `IS_SANDBOX`; bwrap self-detect |
| `Eu` | 564,588 | 195 | `checkDependencies`: Windows-and-not-`L2()` → one error; else the memoised probe `i9` | — |
| `i9` | 565,556 | 123 | memoised `ct.checkDependencies({command: rgPath, args: rgArgs})` | — |
| `Qgt` | 514,474 | 50 | `at().tenguSandboxGbConfig()` | — |
| `PY` | 514,451 | **23** | **`function PY(){ return {} }`** — the memoised source of that config, with no setter anywhere | nothing |
| `L2` | 496,373 | 121 | `platform !== "windows" ? false : env CLAUDE_CODE_NANKEEN_KESTREL ? true : I("tengu_nankeen_kestrel", false)` | env + gate |
| `Ng` | 473,550 | 92 | `ct.isSupportedPlatform` | — |
| `Ct` | 348,215 | 137 | `switch("darwin"){…}` — **constant-folded in this artifact** | — |
| `D` | `chunk-zyp65cht.js` | — | `i().getPlatform()` — the harness platform service | — |

**Explicit answer to the brief's question: on macOS and Linux there is no `tengu_*` gate and no
`process.env` read anywhere in `Xa → Tm → Pi → qa → xm → Vwe → Eu`.** The only gate reachable from
the chain is `tengu_nankeen_kestrel`, inside `L2()`, which `xm()` calls **only on Windows**. The whole
chunk contains six `tengu_*` strings and 24 `process.env` reads, all but two inside the vendored
region. **W10's correction stands and tightens: it is a settings key, and now it is measured to be
the only input.**

**Three branches are dead in this build, and the reason is one function.** `Qgt()` is a memoisation
over `PY(){return{}}` with no setter, so `Qgt().disableNoSandbox`, `.filesystemPolicy` and
`.requireSandboxedAttempt` are all permanently `undefined`. Consequences: **`Vwe()` (`shouldForceSandboxOn`)
always returns `false`**, collapsing `Pi()` to exactly `settings.sandbox.enabled ?? false`;
`F2()`'s `"relaxedIfForced"` arm is unreachable; and `vm` (`isSandboxedAttemptGateEnabled`) is
hard-coded `return !1` even though a predicate is registered into `kv`, which has no reader.
`wvr` (`isSandboxHostAllowlistEnforced`) and `Svr` (`antSandboxConfig`) are likewise hard-false/null.

**`sandboxDisabledThisSession`** is a field of the module state class `gI` (@558,505, 717 B, 22
fields), memoised as `hm ??= new gI` by `at()`. Four sites: read in `Xa` and in `bvr`
(`isSandboxEgressRestricted`); **set `true` at exactly one place** — `NI`, the throw path of
`SandboxInitFailedError` ("Sandbox is enabled but failed to initialize"); reset to `false` in
`pt.invalidateDependencyCache`. So the latch is a **fail-closed, once-per-session poison** on init
failure, and an owned implementation that makes it recoverable is wrong.

### 2.4 What is reachable headlessly on this host

- **`/usr/bin/sandbox-exec` exists and works.** Measured on this machine (macOS 26.5.2, build 25F84,
  darwin-arm64): `-rwxr-xr-x root:wheel 102,560 B`, and
  `/usr/bin/sandbox-exec -p '(version 1)(allow default)' /bin/echo hi` prints `hi` and exits 0. It has
  carried Apple's deprecation notice since 10.10 and is still shipped and functional; Claude Code's
  macOS arm depends on it with no fallback.
- **`settings.sandbox.enabled` is writable through `Options.settings`.** `Settings.sandbox` is a typed
  member of the installed SDK's settings type (`enabled`, `failIfUnavailable`,
  `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, plus `network`/`filesystem`/`credentials`
  subtrees), loaded into the **flag-settings layer** — the highest-priority user-controlled layer,
  which W5 established reaches the settings chain with `settingSources: []` still in force and no
  filesystem write. There is also a second, direct `Options.sandbox`. The harness already passes
  inline `settings` at 17 sites (`w5/scenarios.ts` ×6, `w6/scenarios.ts` ×5, two probes).
  **`reforge/` contains zero occurrences of `settings.sandbox`, `sandbox.enabled`, `sandbox-exec` or
  `dangerouslyDisableSandbox` today.**
- So the conjunction `Xa()` needs, on this host: `sandbox.enabled: true` through `Options.settings`
  (→ `Pi()`), no managed-policy `enabledPlatforms` restriction (→ `qa()`, default true), macOS
  (→ `xm()`), no prior init failure (→ the latch), and `checkDependencies().errors.length === 0`
  — which on macOS is **vacuously true** (§2.5). **One settings key, one macOS host.**

### 2.5 The per-call decision, and the dependency check

`bv(input, opts)` — `chunk-fy12d89p.js` @1,012,478, **407 B**, not exported, seven call sites:

| # | condition | result |
|---|---|---|
| 1 | scrub mode (`bu() && l$()`) | **true** |
| 2 | `!pt.isSandboxingEnabled()` | false |
| 3 | bash on Windows with no shell (`WN() === null`) | false |
| 4 | `input.dangerouslyDisableSandbox` ∧ `!forced` ∧ `pt.areUnsandboxedCommandsAllowed()` | **false — this is the `dangerouslyDisableSandbox` arm** |
| 5 | no `input.command` | `Boolean(forced)` |
| 6 | `!forced && zrn(command)` | false |
| 7 | otherwise | **true** |

where `forced = opts.disableUnsandboxedCommands === true ‖ j2().unsandboxedCommandsDisabled ‖ env CLAUDE_CODE_EVAL_CONFINED`.
Call sites: `A8e` and `xrn` (the auto-allow-bash gate, two variants), two permission evaluators
(`Gx`, `Aon`), and three inside the Bash tool — `userFacingName` (renders **`"SandboxedBash"`** under
`CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR`), `checkPermissions` (`!bv(e) && bv({...e, dangerouslyDisableSandbox:false})`
— it detects a *needless* opt-out), and `call` (`bv(e, {disableUnsandboxedCommands: remoteConstraints.sandbox === "required"})`).

**`checkDependencies()` does nothing on macOS.** The real probe is `Rg` (605 B): it returns
`{errors:["Unsupported platform"]}` when `!Ng()`, then branches on `Ct()` — `"linux"` shells out for
`rg`, `bwrap`, `socat` and the seccomp binary (including an `execSync("npm root -g")` with a 5 s
timeout); `"windows"` runs `srt-win user status` and `srt-win wfp status` as children; **`"macos"`
matches neither branch and falls through to `{errors:[],warnings:[]}`.** The literal
`/usr/bin/sandbox-exec` occurs **once across all 1,802 module files**, inside `qh` — the argv
assembly, at exec time. macOS availability is inferred from the platform identity, never probed.

### 2.6 The profile builder is a pure function, and that is the wave's cheapest oracle

**macOS seatbelt: `PR` @435,399, 7,666 B — pure.** One destructured options object
(`{readConfig, writeConfig, httpProxyPort, socksProxyPort, needsNetworkRestriction, allowUnixSockets,
allowAllUnixSockets, allowLocalBinding, allowMachLookup, allowPty, allowGitConfig, enableWeakerNetworkIsolation,
allowAppleEvents, logTag}`), no captured mutable config, **no I/O and no spawn**, building a `string[]`
and returning `join("\n")`. Emitted skeleton in order: `(version 1)` · `(deny default (with message "<logTag>"))`
· process family (`process-exec`, `process-fork`, `process-info* (target same-sandbox)`, `signal`,
`mach-priv-task-port`) · `user-preference-read` · a **14-entry `mach-lookup` global-name allowlist** ·
optional `trustd.agent` · an optional Apple Events block · caller-supplied mach services (with
`global-name-prefix` when the pattern ends in `*`) · `ipc-posix-shm`/`ipc-posix-sem` · three
`iokit-open` classes · `iokit-get-properties` · `system-socket AF_SYSTEM proto 2` · a **57-entry
`sysctl-read` allowlist** plus `sysctl-write kern.tcsm_enable` · `distributed-notification-post` ·
`mach-lookup com.apple.SecurityServer` · six `file-ioctl` device literals and a `/dev/null` block ·
`; Network` (either `(allow network*)` or per-port/per-socket localhost and unix rules) · `; File read`
(`kR`) · `; File write` (`DR`) · read-denials inside write roots (`OR`) · an optional pty block.

**The one caveat that decides how it is tested:** `kR` is pure over already-normalised input, but `DR`
and `RR`→`fd` call **`gT` (@349,973, 673 B), which calls `fs.realpathSync` and `process.cwd()`**. So
`PR(inputs) → profile text` is pure **given pre-resolved paths, or with `gT` stubbed** — which is
exactly what a contract test supplies. Golden-file testing `PR` needs no process, no sandbox and no
host capability. `Mr` (@443,065) is just the profile's `JSON.stringify` quoting.

The spawn is one level up, in **`qh` (@443,105, 1,947 B)**: it calls `PR`, then assembles
`["env", …unsets, …sets, …proxyEnv, "/usr/bin/sandbox-exec", "-p", profile, shell, "-c", command]`,
reading `JAVA_TOOL_OPTIONS` and resolving the shell via `ds()`. It has a **fast path**: with no
network restriction, no denies, no write config, no env changes and no git safe-dirs, it returns the
command unwrapped.

**Linux bwrap: `IR` @418,999, 8,278 B — NOT pure.** An async mount planner that calls `realpathSync`,
`existsSync`, `statSync`, `lstatSync`, `readdirSync`, `readlinkSync` **and `mkdtempSync`** (it
materialises empty scratch directories to `--ro-bind` over non-existent deny paths, tracked for later
cleanup), performs a symlink-replacement-attack defence (mounting `/dev/null` over symlinked deny
targets), and an ancestor-pin verification pass that **throws** ("Refusing to build a mount plan with
unverifiable pin components."). Contract-testing it needs a real or virtualised filesystem tree.

**Linux seccomp: there is no filter builder to make pure.** `kh` (@410,817) is only an architecture
selector and is itself **constant-folded** (`switch("arm64")`). The filter is a **prebuilt native
binary** at `vendor/seccomp/<arch>/apply-seccomp`, located by `gR`/`bR` relative to `import.meta.url`
and, failing that, by `hR` shelling out to `npm root -g`. There is no BPF program constructed in
JavaScript.

### 2.7 Platform arms, and the filesystem policy

Classifying the 589 declarations at offset ≥ 347,688 by exclusive platform keyword:

| arm | decls | bytes | largest |
|---|---|---|---|
| macOS | 6 | **13,982** | `PR` 7,666 · `qh` 1,947 · `z_r` 2,253 · `U0` 1,107 · `Xh` 967 |
| Linux | 26 | **24,984** | `IR` 8,278 · `Gh` 3,070 · `Wh` 1,715 (socat) · `zh` 1,422 · `$h` 1,175 |
| Windows | 64 | **27,641** | `AVe` 2,240 (`ensurePersistentWindowsCa`) · `yh` 1,782 · `G0` 1,482 · `og` 1,376 (WFP verify) |
| shared / multi-arm | 493 | 162,964 | incl. `eht` **34,268** (`convertToSandboxRuntimeConfig`) |

Two different dispatch predicates, and it matters: **`D()`** (`i().getPlatform()`, the harness
platform service) drives the Claude-Code layer, while **`Ct()`** (the vendored package's own) drives
`Vg`/`Rg`/`dC` and is **constant-folded to `"darwin"` in this artifact**. So the runtime `switch` in
`Vg` (`case "macos": return qh(...)`) has one reachable arm in the pinned bundle, and any
platform-matrix claim read off this build is a claim about darwin-arm64 only.

Windows installer/launcher, resolved through the alias barrel: `j_r` = `installWindowsSandbox` (198 B),
`m6t` = `installWindowsSandboxAsync` (217 B), `lmn` = `classifyWindowsSandboxLaunchExit` (307 B — it
classifies exactly one condition, exit code 16 with `mapped_drive_cwd`), `yd` = `WindowsSandboxError`
(114 B).

**`F2` @515,987, 228 B, `getEffectiveFilesystemPolicy`:** `bu()` (scrub) → `"strict"`; Windows →
`"strict"`; else `FY()` (which resolves `sandbox.filesystem.disabled` across the settings layers, and
**declines to answer — returning `undefined` — when any layer defines `sandbox.filesystem` or a
credentials file in deny mode**); else `Qgt().filesystemPolicy ?? "strict"`, whose `"relaxedIfForced"`
arm is unreachable (§2.3). Net on macOS: **`"strict"` unless a settings layer sets
`sandbox.filesystem.disabled = true`.** `F2` does not build lists; consumers branch on it (four in the
engine chunk, one in the `/sandbox` CLI chunk) and the list construction runs
`pt.getFsReadConfig`/`getFsWriteConfig` → `ct.getConfig().filesystem` → `Vg`, which normalises, expands
globs on Linux, and hands `{denyOnly, allowWithinDeny}` / `{allowOnly, denyWithinAllow}` to `qh` → `PR`.

### 2.8 Sandbox anchors, and the caller surface

**24 of 25 candidate anchors are 1-of-1** across the module set (counted over the 1,801 top-level
files; the 1,802nd, `src/plugins/functionHooks/hooks-worker/hooks-worker.js`, carries no sandbox
string and does not change any count) — `(deny default (with message "` ·
`; Essential permissions - based on Chrome sandbox policy` · `/usr/bin/sandbox-exec` ·
`[Sandbox macOS] Applied restrictions - network: ` · `[Sandbox Linux] Mounted /dev/null at symlink ` ·
`[Sandbox Linux] Deferring mount point cleanup — ` · `Sandbox dependencies not available: ` ·
`Sandbox is enabled but failed to initialize` · `bubblewrap (bwrap) not installed` ·
`seccomp not available - unix socket access not restricted` ·
`Sandbox ancestor-pin verification failed: cannot lstat ` ·
`Refusing to build a mount plan with unverifiable pin components.` ·
`getFsReadConfig threw; falling back to raw deny lists: ` · `Failed to check enabledPlatforms: ` ·
`network.tlsTerminate and network.mitmProxy are mutually exclusive` · and ten more. The one tie is
`Windows sandbox is not enabled` (2 — the second copy in the `/sandbox` CLI chunk).

**297 files reference `chunk-q4xe0m2r.js`, but 265 of those are bun's bare dependency-ordering
prelude. Only 32 take symbols**, and the shape is very concentrated: `chunk-6v95pkgg.js` (the barrel)
takes 44, **`chunk-fy12d89p.js` takes 29**, `chunk-q2jy5252.js` 11, `chunk-158fdkah.js` 9,
`chunk-6thm48px.js` 6; 22 chunks take one or two, and 14 of those take only `pt` or `kl`. So the
sandbox's real consumer is the engine chunk, and the port surface is `pt`'s 49 properties minus the
ones nobody calls.

---

## 3. The `ToolRuntimePort` question: one core or two?

### 3.1 The measurement

§6 names one port for W12 (`ToolRuntimePort` — "execute a tool call in context"). Measured against the
two things the wave actually contains, that name covers a boundary that does not exist.

**They share no state.** The subagent surface's module-level state is the `agentContext`
AsyncLocalStorage `vbt`, the host-scoped spawn counters `gSe`, two write-once memos on `Fa()`, the
isolation-evidence sets on `kt()`, two maps on `dr()`, the session-scoped `agentNameRegistry`, and the
`agentLifecycle` object. The sandbox's is the `gI` state class behind `at()` (with its
`sandboxDisabledThisSession` latch), the `Qgt` config memo, and the `Eu`/`i9` dependency-probe memo.
The two sets are disjoint; nothing reads from both.

**They share no effectful call.** I resolved the engine chunk's 30 imported sandbox symbols plus `bv`
to their owning declarations at every reference site. The consumers are: `LG` and `yi` (the Bash spawn
and the Bash tool — **W10's**), `A8e`/`xrn`/`Gx`/`Aon` (the permission decision chain — **C9/W6's**),
`kPn`/`NPn`/`sP`/`vsn` (the settings-schema surface), and `DPt`/`Igt`/`xnr` (the `/sandbox` command
and status). **Not one W12 declaration touches the sandbox** — not `Ane.call`, not `Bb`, not `n9`, not
the worktree family. The word "sandbox" reaches subagent dispatch through exactly one shared idea
(`CLAUDE_CODE_EVAL_CONFINED`, which independently disables worktree creation and forces sandboxing on)
and no shared code.

**And their consumers are each other's peers, not each other.** The one place both meet is the *Bash
tool*, which calls `bv` for the sandbox and `Kdt`/`YFt` for the task registry — and the Bash tool is
C13's.

**And there is now a third claimant.** The W13 scout, landed today, routes the **per-tool invoker
`kUn`** (26,716 B, 13 parameters, offset 2,462,049 — `ORe.executeTool`'s callee) to
"`ToolRuntimePort`'s far side … C15/W12". Measured the same way: `kUn`'s callee set is the hook
dispatchers (`mQ`, `dQ`, `SL`, `VNt`), the permission plumbing, the input validators and the error
shapers — **it touches no sandbox symbol and no subagent-dispatch symbol either.** Its module-level
state is the `yk()` tool-state container, disjoint from both.

**Verdict: `ToolRuntimePort` is one name for three disjoint boundaries.** The recommendation below
splits it into `AgentRuntimePort` (subagent dispatch), `SandboxPolicyPort` + `SandboxExecPort` (the
sandbox), and leaves **`ToolExecutionPort` (`kUn`) as a named open question for the orchestrator** —
this scout did not measure `kUn` in depth, it is 26,716 B, and its natural neighbours are the hook
executors (C10.6–C10.8) and the permission chain (C9), not subagent dispatch. Silently absorbing it
into C15 under a shared port name would repeat the exact error this section documents. This is
binding-candidate as a *naming* decision, because the ledger keys edges on port names and one name
would make W10's, C9's and C16's edges mutually ambiguous.

### 3.2 The cut rule

Inherited verbatim from the executor design (`…w75-hook-executor-design.md` §3.2), the W9 scout and
the W10 scout: **anything that returns data goes behind a read-shaped port and leaves the consuming
logic owned and pure; anything that owns identity or a lifecycle goes behind a handle-shaped port.**

### 3.3 Subagent dispatch — `AgentRuntimePort` and six siblings

1. **`AgentRuntimePort`** — handle-shaped. `newAgentId(name?) -> AgentId`;
   `runInAgentContext(agentContext, fn)`; `runInCwd(path, fn)`; `currentAgentContext()`.
   *Handle-shaped because the agent context is an ambient scope with a lifetime, not a value.*
   **BINDING-CANDIDATE: `runInAgentContext` must be a real async-context scope, not a threaded
   parameter.** `ka`, `vc`, `TC`, `Rbt`, `A$`, `IH` and — critically — **three hook dispatch sites**
   (`kUt` SubagentStart, `y9` SubagentStop/Stop, and `Bb`'s `Bs = ka(lr) ? [] : kUt(...)`) read it
   ambiently from `vbt`. A rewrite that threads it explicitly changes which hooks a *nested tool call
   inside the child* sees, and nothing in the current diff surface would show it.

2. **`ChildQueryPort`** — handle-shaped. `run(params) -> AsyncGenerator<Frame>`. This is `Kx`, and it
   is **the edge to C16/W13**. *Handle-shaped because it is a lifecycle: the generator is raced,
   interleaved with a background signal, and abandoned.* **BINDING-CANDIDATE: it must be an async
   generator, not a promise.** `n9` consumes frames one at a time to re-arm the stall watchdog and
   maintain the in-flight tool-use set, and `Ane.call`'s sync arm races the same stream against
   `backgroundSignal`. A promise-shaped port erases backgrounding entirely — which is precisely the
   moat behaviour this wave exists to own.

3. **`TaskRegistryPort`** — handle-shaped, **shared with W10, far side C11c/W8c**. `register(record)`,
   `update(id, fn)`, `get(id)`, `remove(id)`, `all()`, `updateTranscript(id, fn)`,
   `getConcurrentSubagents()`, `takeConcurrencySlot() -> release`. W12 owns the `type: "local_agent"`
   record shape and its **eight writers** (`MG`, `Ilt`, `kx`, `Vx`, `clt`, `llt`, `_ne`, `ult`); C11c
   owns the store. **BINDING-CANDIDATE: `takeConcurrencySlot` returns a release function, not a
   boolean.** `Ane.call` threads that release through every failure path (`fo`, `onRunSettled`), and a
   boolean port leaks a slot on any throw — a leak no scenario would show and a mutation battery
   should kill.

4. **`NotificationPort`** — handle-shaped, **edge → C11c/W8c**. `emitTaskNotification(taskId, status,
   {toolUseId, summary, usage})` (= `ys`, with its `Ek` once-only claim), `emitTaskProgress`, the
   `task_started` emitter, and the `background_hint` progress frame. W12 owns *when* the bookends
   fire and *what they carry*; C11c owns the queue. Note W8's finding stands: the
   `background_tasks_changed` emitter lives in `chunk-g461tywa.js` and is unowned by anyone.

5. **`WorktreePort`** — handle-shaped. `create(name, {fromCwd, fromHead}) -> {worktreePath,
   worktreeBranch?, headCommit?, gitRoot?, hookBased?}`; `remove(path, branch, gitRoot, force, reason)`;
   `hasChangesSince(path, headCommit)`; `recordSpawned(agentId)` / `recordCleanlyRemoved(agentId)`;
   `clearMetadata(...)`. **BINDING-CANDIDATE: `create` must surface `hookBased` as a discriminator**,
   because the disposition closure `In()` takes three different exits on it — hook-based worktrees are
   always kept, keepalive-parked ones are kept with a different log line, and an unchanged one is
   removed *and* has its agent metadata cleared. Collapsing them makes "kept because a hook owns it"
   indistinguishable from "kept because the owner is parked", which is the class of erasure §3.1's
   mutation battery has to be able to kill.

6. **`AgentClockPort`** — handle-shaped. `now()`, `setTimeout(ms, fn) -> cancel`.
   **BINDING-CANDIDATE, and one port**, because the wave has **four** deadlines and an oracle that
   controls three controls nothing: `bxn = 2000` (the sync arm's background hint), `wxn()` (auto-
   background, 120 s only under `CLAUDE_AUTO_BACKGROUND_TASKS`), the stall watchdog
   (`CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS || 600_000`, with its `min(0.1 × T, 1000)` re-arm throttle),
   and the 30 s `requiredMcpServers` poll.

7. **`AgentTelemetryPort`** — handle-shaped. The eleven `tengu_agent_*`/`tengu_subagent_*` events, the
   `subagent_launch`/`subagent_complete` span pair, the OTel subagent span, and the `[Stall]
   agent_completion` structured log. Compared by trace, never by value. **ADVISORY.**

**Stub: `TeammatePort`** — `spawnTeammate(...)`, `offeredAgents(...)`, `allocateName`. Throwing, with
`io()`'s argv guard written down (§1.7). **BINDING-CANDIDATE: throw, do not return a null result** —
W9's and W10's rule; a silent null makes a wrongly-routed teammate spawn look like a subagent spawn.
**Stub: `RemoteAgentPort`** — `eligibility()`, `createSession(...)`, `registerRemoteTask(...)`.
Throwing; §1.2 server boundary. The *fallback* (remote → worktree → local, with its log line) stays
owned.
**Stub/advisory: `ObserverPort`** — `armObserver`, `deliverActivity`, `pairingFor`. The observer belt
is 13,892 B and is reachable only from an agent definition carrying `observer:`, which no scenario
supplies. ADVISORY, with `_W`/`I7e`'s guards written down.

**What stays owned and pure** — and this is the wave's argument:

| unit | ~bytes | note |
|---|---|---|
| `kan` — the ~60-field inheritance contract | 3,937 | pure `(parentCtx, overrides) -> childCtx` once the ports are injected; the single highest-value unit |
| `KPn` + `_E` + `e2` + `Xle` + `Eee` + `_x` — the child-catalog resolution | ~3,600 | pure; **already graded three ways by the corpus (22/19/13)** |
| `wlt` — the Agent tool's prompt | 16,727 | pure prose over six guard reads; prompt-oracle surface, not dispatch surface |
| the agent-type ladder: `Alt`, `Rlt`, `Plt`, `Cne`, `Wxn`, `Ixn`, `d_`, `tF`, `Gve`, `MB`, `Ux`, `lb` | ~2,500 | pure; six distinct refusal sentences |
| `yEe` + `YPn` + `QPn` + `IN` + `plt` + `Sz` + `zv` — result assembly and stats | ~4,500 | pure over a message array |
| `mnt` + `q0` + `N8` — model resolution | ~1,800 | pure given the session model |
| `Elt`/`vlt`/`Tlt` — spawn counters | 1,226 | pure value objects (their `#private` fields are internal, not a marshalling boundary) |
| `Ane.mapToolResultToToolResultBlockParam` | 3,591 | pure; four statuses, all uniquely anchored |
| `hEn` + `q3n` + `Jye` — worktree naming and validation | ~820 | pure string work |
| the schemas `vxn`/`Exn`/`cln`/`xxn`/`dlt`/`Cxn` | ~6,600 | data |

**Rounded: of the ~188 KB, about 45 KB is pure or pure-once-ported, about 17 KB is prompt prose graded
by the existing prompt oracle, about 14 KB is the observer belt (OPEN by guard), about 29 KB is
teammate (OPEN by argv), about 17 KB is worktree, and the effectful residue an owned implementation
must write behind ports is roughly 55 KB** — `Ane.call` (23.0), `Bb` (16.5), `n9` (9.1), the task-record
writers (net of the store, ~4), the worktree disposition closure (~2).

### 3.4 The sandbox — `SandboxPolicyPort` and two siblings

The measurement in §2.6 decides this cut: **the expensive, OS-coupled thing is the wrap and the
spawn; the profile is a pure function of data.** So the profile builder does not go behind a port —
it is the owned module, and the port is what feeds it.

1. **`SandboxPolicyPort`** — **read-shaped**. `isEnabled()`, `filesystemPolicy()`, `fsReadConfig()`,
   `fsWriteConfig()`, `networkRestrictionConfig()`, `areUnsandboxedCommandsAllowed()`,
   `isAutoAllowBashIfSandboxedEnabled()`, `checkDependencies() -> {errors, warnings}`,
   `disableThisSession()`. *Read-shaped because every member returns data and the consuming logic —
   `bv`'s seven-step decision and `PR`'s profile assembly — is pure and stays owned.*
   **BINDING-CANDIDATE: `checkDependencies()` returns the `{errors, warnings}` pair, not a boolean.**
   `Xa` tests `errors.length === 0` while the `/sandbox` surface renders both lists, and the macOS arm
   returns two empty arrays without probing anything (§2.5) — a boolean would make "checked and found
   nothing to check" indistinguishable from "checked and passed".
   **Second BINDING-CANDIDATE: `disableThisSession()` is one-way.** The latch has exactly one setter
   (the `SandboxInitFailedError` path) and is cleared only by an explicit cache invalidation; a port
   that lets it be toggled makes a fail-closed poison recoverable.

2. **`SandboxExecPort`** — handle-shaped. `wrapWithSandbox(command, shell, cfg, signal, attrs) -> string`;
   `wrapWithSandboxArgv(...) -> string[]`; `cleanupAfterCommand()`;
   `annotateStderrWithSandboxFailures(id, stderr)`. *Handle-shaped because it owns a child's
   confinement lifetime and leaves temp state behind (the Linux mount planner's scratch dirs; the
   macOS log monitor).* **BINDING-CANDIDATE: the two wrap members stay distinct and both THROW when
   `isEnabled()` is false** — W10 already recorded the argv variant's own refusal sentence
   (`sandbox wrapWithSandboxArgv returned empty argv`), and a silent passthrough makes a wrongly-routed
   sandboxed call indistinguishable from a correct unsandboxed one. **This is W10's `SandboxPort` stub,
   and its far side is these two ports, not one.**

3. **`SandboxPathPort`** — read-shaped, small. `realpath(path)`, `cwd()`, `exists(path)`.
   *This is the port that makes the profile builder testable*: `PR` is pure, but its write-rule
   helpers reach `gT`, which calls `realpathSync` and `process.cwd()`. Injecting three functions turns
   a 7,666 B OS-coupled-looking builder into a golden-file contract test with no process.
   **ADVISORY** in shape, **BINDING-CANDIDATE** in existence — without it, `PR` cannot be graded
   without a filesystem.

**Stub: `LinuxSandboxPort`** (`IR`'s mount planner, the socat bridge, the seccomp binary lookup) and
**Stub: `WindowsSandboxPort`** (`installWindowsSandbox`, the WFP verification, `classifyWindowsSandboxLaunchExit`).
Both throwing, both OPEN with the guard cited: `Ct()` is constant-folded to `"darwin"` in this
artifact (§2.7), so the Linux and Windows arms are not merely unexercised — **in the pinned bundle
their dispatch is a dead `switch` case**, and that is the honest exclusion reason, not "no Linux host".

**What stays owned and pure on the sandbox side:**

| unit | ~bytes | note |
|---|---|---|
| **`PR` — the seatbelt profile builder** | **7,666** | pure given `SandboxPathPort`; a golden-file oracle with no process (§4.3) |
| `kR` / `DR` / `OR` / `RR` / `fd` / `Mr` — the rule emitters | ~1,400 | pure once `gT` is injected |
| **`bv` — the per-call decision** | **407** | pure over `SandboxPolicyPort` reads; seven branches, a complete truth table |
| `F2` + `FY` + `MY` + `Zgt` — the filesystem-policy resolver | ~900 | pure over settings reads |
| `Xa`/`Tm`/`Pi`/`qa`/`xm`/`Vwe`/`Eu` — the guard chain | ~900 | pure over settings + platform reads |
| `M2` — the srt→Claude-Code remedy-string rewriter | 700 | pure string mapping |
| `eht` — `convertToSandboxRuntimeConfig` | **34,268** | the settings→srt-config translator; unread this pass, but it is a data transform and the largest own declaration |
| `qh`'s fast-path predicate | ~200 | pure; decides whether the command is wrapped at all |

**Rounded: of the 94,760 B Claude-Code-own sandbox layer, roughly 46 KB is pure or pure-once-ported
(the profile builder, the decision, the policy resolver, the guard chain, the config translator),
about 28 KB is the Windows arm, about 25 KB is the Linux arm, and the effectful residue on the macOS
path is under 3 KB** — `qh`'s spawn assembly, the cleanup, and the stderr annotator.

**That distribution is the second half of the wave's argument, and it mirrors W10's exactly: the
OS boundary everyone assumes is the blocker guards under 3 KB of the macOS path, and the 46 KB in
front of it is contract-testable with no sandbox, no host capability and no engine run.**

---

## 4. The grading surface

### 4.1 What exists today

- **`src/state.ts`** — a recursive content-hashed tree of `reforge/sandbox/` plus a derived exit
  outcome. It sees nothing under `<CONFIG_DIR>`, nothing about child processes, nothing about
  worktrees. Its own header says the full version arrives at W9.
- **`src/harness.ts:resetSandbox()`** — clears the children of `reforge/sandbox/` and
  `<CONFIG_DIR>/plans`, and nothing else. **A dispatched agent's output file lands at
  `/private/tmp/claude-501/<project-slug>/<session-uuid>/tasks/<task-id>.output` — outside both the
  sandbox and `CONFIG_DIR`** — so it is neither snapshotted nor reset. A worktree scenario would leave
  a git worktree that nothing cleans.
- **`src/differ.ts`** — lane partitioning (root / subagent by `parent_tool_use_id` / async task
  notifications) with order preserved *within* a lane, plus a relationship-preserving run-id **map**
  over `RUN_ID_KEYS` (which includes `agentId` and `task_id`). Request bodies partition on the
  engine's own `cc_is_subagent` billing marker. **This is real machinery and it already works for
  depth 1.**
- **`src/canonical.ts`** — the six run-scoped id shapes, four of which are subagent shapes:
  `agentId: a<16hex>`, `to: 'a<16hex>'`, `/tasks/a<16hex>.output`, `<task-id>a<16hex></task-id>`.
  These are used **only by the replay hash** (stateless, so blanket scrubs); the differ deliberately
  does not apply them and maps instead.
- **`m3/background-check.test.ts`** — 23 negative controls plus a positive, on the campaign's only
  substance grading of a subagent. It enforces five correlations (`task_started.tool_use_id` =
  the Agent block id; `task_notification.tool_use_id` = the same; `task_notification.task_id` =
  `task_started.task_id`; some `background_tasks_changed.tasks[]` carries it; the notification follows
  the start) and exactly-once-ness of all three landmarks.
- **`strangle/manifest.ts`** — `subagent-prompt` (`zH`) is already spliced with
  `coverage: ["subagent","background-task"]`; two sandbox ports are already declared as captures on
  `permission-precheck` and `rule-based-permissions`, derived from `&&(ID).isSandboxingEnabled()`.

### 4.2 The three capabilities no oracle has, that only this wave needs

The executor design named three (interleaved event log, stdout chunk reproduction, grading a promise
that never settles); W9 named three (flush-schedule control, dirty-precondition seeding, fs fault
injection); W10 named three (a scripted child process, injectable deadlines, child-process
supervision). W12's three:

1. **A scripted child *agent* — the synthetic response corpus applied to a second lane.** Every
   subagent the corpus has ever run was asked to say one word, and every one of them complied by
   emitting plain text and calling no tool. To grade `Bb` you need a child whose behaviour is
   *specified*: makes N tool calls, takes M turns, exceeds `maxTurns`, returns an API error, stalls,
   or spawns a grandchild. Two halves are needed and neither exists: an **`Options.agents` definition**
   (a fixed `AgentDefinition` with pinned `tools`, `maxTurns`, `model` and `permissionMode` — the
   corpus uses `Options.agents` **zero** times, so today the child's tool set is whatever `KPn`
   derived from the parent's) and **authored child-lane responses** — §3.2's synthetic response
   corpus, which is mandatory from W9 and which this is the first wave to need for a *second
   concurrent lane*. Without it, `n9`'s stall watchdog, `Bb`'s max-turns arm, the zero-tools refusal,
   the depth cap and the concurrency cap are all graded by whatever the model felt like doing.

2. **Descendant-process and worktree supervision, with survivors *declared* rather than forbidden.**
   W9 named process supervision as a carry-over and W10 named it as its third capability; W12 is the
   wave where the naive form is wrong. An async agent **legitimately outlives the parent turn** — that
   is the moat behaviour — so "no leaked children at scenario end" is not the invariant. The invariant
   is *the same set of survivors on both engines, with the deliberate ones declared*, plus the same
   set of worktrees under `.claude/worktrees/`, plus the same `<config>/tasks/` and task-output
   contents. Three concrete pieces: a third snapshot root for the config dir and the task-output
   directory (which is outside both roots today); a descendant-process set diffed between engines;
   and `resetSandbox()` learning both, for the same reason it learned `plans/`.

3. **A profile-text oracle beside the host-capability axis — and the measurement says the cheap half
   is the important one.** Grading the sandbox looks like it needs a scenario that can *require* a
   host capability (macOS with a working `sandbox-exec`; §2.4 confirms this host has one), and the
   harness has no notion of such a requirement. But §2.6 changes the shape of the answer: `PR` is a
   **pure `inputs → seatbelt profile text` function**, so the primary instrument should be the one
   `strangle/description-parity.test.ts` already established — **extract the builder out of the pinned
   bundle, evaluate it with stubbed ports over a full cross-product of its inputs, and require byte
   identity with the owned module.** That is stronger evidence than a differential red, it hand-writes
   no expectations, and it needs no sandbox at all. The live `sandbox-exec` run then becomes **one
   end-to-end control**, not the grading strategy. What the harness still owes is the *capability
   requirement* itself — a scenario that declares "needs macOS + `/usr/bin/sandbox-exec`" and is
   skipped-with-a-recorded-reason elsewhere. §3.6's isolation substrate at W13 needs the same notion,
   and W12 should not build it twice.

**A fourth, named as an axis rather than a capability: id correlation past depth 1.** The differ's
lane partition keys on `parent_tool_use_id`, which distinguishes root from subagent — but a *nested*
tool call inside a subagent, or a second-level agent, produces frames whose parent is the child's own
tool-use id, and **no recorded transcript has ever contained one**. Meanwhile `parentAgentId`,
`ownerAgentId` and `spawn_depth` are written into transcripts today and read by **nothing**, and agent
ids and task ids share one lexeme (`a` + 16 hex), so the differ's first-seen map cannot tell them
apart by shape. Before a depth-2 scenario is recorded, the lane model and the id map both need a
decision written down.

### 4.3 The dirty-state and edge matrix (the §3.1 S-module obligation)

Nineteen cells, each with the mechanism it grades and what creates it.

| # | cell | grades | status |
|---|---|---|---|
| D1 | one foreground subagent, fresh config | `Bb` happy path, `n9` completion, `yEe`, the `completed` formatter | **exists** (`subagent`) |
| D2 | one background subagent, notification folded into the next turn | `MG`, `task_started`, `ys`, the `async_launched` formatter | **exists** (`background-task`, `substanceOnly`) |
| D3 | subagent with SubagentStart/Stop/Stop hooks, agent-id correlated | `kUt`, `y9`, the id round trip | **exists** (`hooks-subagent`) |
| D4 | **two subagents in one assistant message** | `isConcurrencySafe: true`, per-child `kan` isolation, lane partitioning at width 2 | new; cheap |
| D5 | **a subagent that calls a tool** | the child catalog actually being used; the nested lane | new; needs §4.2(1) |
| D6 | **a nested subagent (depth 2), and the depth-3 refusal** | `vc`, `jS()=3`, `KPn`'s `agentDepth < jS()` catalog removal, `Subagent nesting limit reached` | new; needs §4.2(1) |
| D7 | concurrency cap refusal | `AXn()=20`, `Elt.recordRefused("concurrency_limit")`, `Concurrent subagent limit reached.` | new; expensive live, **cheap as a contract test** |
| D8 | agent-type ladder: not-found / ambiguous / normalised / denied-by-rule | `d_`, `Wxn`, `pV`, four distinct refusals + `tengu_subagent_type_normalized` | new; **four cheap recordings or one contract test** |
| D9 | zero resolved tools | `_E`'s four buckets, `tengu_subagent_zero_tools`, the refusal | new; one `agents` definition with a bogus `tools` list |
| D10 | `run_in_background` on a **long** child, parent turn ends first | the survivor invariant, `xWt`-equivalent delivery on the next turn | new; needs §4.2(2) |
| D11 | interrupt mid-subagent, sync and async arms | `Ane.call`'s three abort checks, `Vx`, `killedBy`, `tengu_agent_tool_terminated` | partly (`interrupt` exists for Bash) |
| D12 | stall watchdog fires | `n9`'s watchdog, its in-flight deferral, `tengu_async_agent_stall_timeout` | new; needs §4.2(1) + `AgentClockPort` |
| D13 | `maxTurns` reached | `Bb`'s `max_turns_reached` attachment, `tengu_agent_max_turns_reached` | new; needs an `agents` definition with a small `maxTurns` |
| D14 | subagent with `name` | `agentLifecycle.registerName`, `agentNameRegistry`, the `Other agents active in this session` meta message, SendMessage addressing | new; one recording, and it is the W8↔W12 seam |
| D15 | agent definition carrying its own `hooks:` | `LFt`, `Oct`, `cat`/`Vxe` (session-hook registration under the child's id) and the clear stage | new; one recording |
| D16 | **`isolation: "worktree"`, changed and unchanged** | `Zye`, `In()`'s three exits, `ZW`, `Aqn`, `U3t`'s evidence sets, `Agent worktree kept at: ` | new; needs a git sandbox fixture + §4.2(2) |
| D17 | worktree with no git repo, and with `WorktreeCreate`/`WorktreeRemove` hooks | `Ysn()`, the hook-based branch and its symlink/ancestry screens | new; the hook events are in the registry and no scenario fires either |
| D18 | **sandbox on × Bash** (read-only / write / network / `dangerouslyDisableSandbox`) | `bv`'s seven branches, `PR`'s profile, `qh`'s fast path, `SandboxedBash` | new; **one settings key on this host** |
| D19 | sandbox enabled but init fails | `NI` → `sandboxDisabledThisSession`, `Sandbox is enabled but failed to initialize`, and every later call taking the false arm | new; seed a profile the OS rejects |

D4, D8 and D18 are the three cheapest and they buy the most: a parallel dispatch, four refusal
sentences, and the whole sandbox conjunction. D5/D6/D12/D13 are the four that need the scripted child.
D16/D17 are the worktree pair and need the state surface first.

---

## 5. Coverage and budget

### 5.1 What the 59 scenarios + m2/m3 reach, per arm

**Three scenarios drive the `Agent` tool** — `subagent` (m2c), `background-task` (m3,
`substanceOnly`), `hooks-subagent` (w5). `parallel-tools` is a Bash batch and does not (§0.7). All
three use `baseOptions` plus `allowedTools:["Agent"]` and `permissionMode:"bypassPermissions"`, and
`baseOptions` supplies **no `settings`, no `model`, no `agents`**, with `settingSources: []`.

**Twelve cassettes carry an `Agent` `tool_use`** (three scenarios × four recorded variants), with
**16 occurrences of 3 distinct dispatches**. The complete recorded input key set is `description`,
`prompt`, `subagent_type` (always `"general-purpose"`) and `run_in_background` (`true` once, `false`
twice). Stream frames live in `reforge/transcripts/`: `task_started` and `task_notification` in 12
files, `task_updated` in 9, `background_tasks_changed` in **3** (the `background-task` trio only),
and `agent_progress` / `task_progress` in **zero**.

| arm | status | evidence |
|---|---|---|
| foreground dispatch → child stream → fold-back | FIRED | `subagent`, `hooks-subagent` |
| background dispatch → `task_started` → `task_notification` → fold-back | FIRED | `background-task`, graded by 23 negative controls |
| SubagentStart / SubagentStop + agent-id correlation | FIRED | `hooks-subagent` |
| the child's catalog derivation (`KPn`/`_E`) | **FIRED, three partitions, ungraded** | 22 parent / **19** foreground child / **13** background child, visible in the recorded request bodies; no check reads it |
| `spawn_depth`, `parentAgentId`, `ownerAgentId` in the task frames | **FIRED, unread** | present in every transcript, asserted by nothing |
| `kan`'s inheritance (60 fields) | FIRED implicitly | never asserted |
| the `completed` and `async_launched` formatters | FIRED | both |
| a subagent that calls any tool | **UNREACHED** | every recorded child emits plain text only |
| depth ≥ 2, and the depth cap | **UNREACHED** | no nested dispatch anywhere |
| the concurrency cap | **UNREACHED** | one agent per scenario |
| agent-type refusals (4 sentences) | **UNREACHED** | `subagent_type` is always `"general-purpose"` |
| zero-tools refusal | **UNREACHED** | needs an `agents` definition |
| `maxTurns`, the stall watchdog, the keepalive park | **UNREACHED** | need a scripted child |
| `name` → `agentNameRegistry` → SendMessage addressing | **UNREACHED** | `name` never set |
| `model` override | **UNREACHED** | `model` never set |
| `isolation: "worktree"` and everything under it | **UNREACHED** | `isolation` never set; no worktree scenario or probe exists anywhere in `reforge/` |
| observers / delegated observation | **UNREACHED** | needs an `observer:` agent definition |
| `subagent_type: "fork"` | **OPEN by construction** | `Le()` (§0.4) |
| teammates | **OPEN by construction** | `--agent-teams` argv (§0.10) |
| `isolation: "remote"` | **EXCLUDED** | §1.2 server boundary; the *fallback* is reachable |
| every sandbox arm | **OPEN, one settings key away** | §2.4 |

### 5.2 OPEN by construction, with the guards cited

Per the C10.5 lesson, each names a mechanism rather than an absence:

- **The fork.** `TG() → qmr() → adr()`, whose middle clause is `if(Le()) return "disabled"` and
  `Le() = !isInteractive()`. Lever: `CLAUDE_CODE_FORK_SUBAGENT=true`, an env var outside X6. **Note
  the interlock**: the same flip removes `run_in_background` from the presented schema (§0.5), so a
  flip-liveness cell here changes the catalog and would redden `background-task`. Record it as a
  *catalog-shape* flip, next to W10's PowerShell cell.
- **Teammates.** `io()`'s first clause is `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS || process.argv.includes("--agent-teams")`;
  the gate `tengu_amber_flint` defaults **true**, so §3.3 leaves it on and the argv flag is the whole
  guard. `m2/raw-protocol.ts` controls argv. **This is the cheapest OPEN in the wave to convert**, and
  it is not an X6 fight.
- **Coordinator mode.** `Fs() = truthy(CLAUDE_CODE_COORDINATOR_MODE) && (headless || remote)`. Env-dead;
  it gates the `CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL` arm and two prompt bullets.
- **Remote agents.** `bz()` needs a claude.ai login and a feature gate; §1.2 excludes the endpoint.
  The unavailability *fallback* (`[remote agent] isolation:'remote' is unavailable …` → worktree or
  local) is reachable and should be graded.
- **`shouldForceSandboxOn`, `filesystemPolicy` and `requireSandboxedAttempt`.** All three read
  `Qgt()`, which is memoised over `PY(){return{}}` with no setter bundle-wide. **DEAD structurally**,
  not incidentally (§2.3).
- **The Linux and Windows sandbox arms.** `Ct()` is constant-folded to `"darwin"` in the pinned
  artifact, so `Vg`'s dispatch `switch` has one reachable case. Not "no Linux host" — a dead case.
- **The seccomp filter.** There is no JavaScript to own: it is a prebuilt native binary located by
  path probing and `npm root -g` (§2.6).
- **Observers.** `_W` requires `definition.observer`; `I7e` requires an armed parent pairing. No agent
  definition in the corpus carries either, and `Options.agents` is unused.
- **`Monitor`-adjacent agent monitors** (`MIe`'s `monitor_mcp`/`monitor_ws` task types, `lat`'s
  cleanup). Gate-dead behind `tengu_amber_sentinel` per W8.

### 5.3 The recording and probe budget

Ranked by what each buys per unit of cost.

**Zero new recordings (contract tests over already-recorded artifacts):**
1. **The child catalog.** `KPn`/`_E`/`e2` are pure and the corpus already contains three graded
   partitions of their output (22/19/13). A contract test over the full tool array plus the four
   axes (`isBuiltIn`, `isAsync`, `permissionMode`, `agentDepth`) grades a function the corpus has
   already exercised three ways — the cheapest non-vacuity instrument in the wave.
2. **The agent-type ladder and the refusal sentences.** `d_`, `Alt`, `Rlt`, `Plt`, `Wxn`, `Cne` are
   pure; the four refusals partition cleanly.
3. **The seatbelt profile builder.** `PR` extracted from the pinned bundle, stubbed ports, byte
   identity against the owned module over a cross-product of its ~14 inputs — the
   `description-parity.test.ts` shape, and stronger evidence than any red.
4. **`bv`'s truth table** and the guard chain, both pure over `SandboxPolicyPort` reads.

**Six recordings, none needing new machinery:**
5. **`agent-sandboxed-bash`** — `settings: { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } }`,
   one Bash read, one Bash write outside the allow-set, one with `dangerouslyDisableSandbox`. *Grades
   the whole `Xa` conjunction, `bv`'s branches 2/4/6/7, `qh`'s fast path and `SandboxedBash`. One
   settings key on a host that already has a working `sandbox-exec` (§2.4).* **The wave's single
   highest-value recording, and it retires fourteen attestation exclusions.**
6. **`agent-parallel`** — two `Agent` blocks in one assistant message. *Grades `isConcurrencySafe`,
   per-child `kan` isolation, and the lane partition at width 2.*
7. **`agent-named`** — one subagent with `name`. *Grades `registerName`, the `Other agents active in
   this session` meta message, and the W8↔W12 addressing seam.*
8. **`agent-type-refusals`** — one turn asking for a nonexistent, then an ambiguous, then a
   deny-ruled `subagent_type`. *Grades four refusal sentences and `tengu_subagent_type_normalized`.*
9. **`agent-definition`** — an `Options.agents` definition with pinned `tools`, `maxTurns` and
   `model`. *Grades `_E`'s buckets, the `model` override, and `maxTurns`; it is also the prerequisite
   for the scripted child.*
10. **`agent-worktree`** — `isolation: "worktree"` against a seeded git sandbox, twice (child changes
    a file; child changes nothing). *Grades `Zye`, `In()`'s three exits, `ZW`, the evidence sets.
    Needs the state surface to see `.claude/worktrees/` first.*

**Two probes, both cheap and both decisive:**
11. **`w12/probe-subagent-depth.ts`** — drive a subagent that dispatches a subagent, through the raw
    protocol; classify FIRED/DEAD/OPEN for depth 2 and the depth-3 refusal, and report what the differ's
    lane partition does with the frames. *This is the one unknown that sizes the wave: everything about
    nesting is asserted from code today.*
12. **`w12/probe-agent-teams.ts`** — one session with `--agent-teams` on the raw driver; grade whether
    `spawnTeammate` is reachable and what `{status:"teammate_spawned"}` looks like on the wire.
    *29 KB of the row's denominator turns on the answer.*

**Total: 6 recordings + 2 probes + four contract-test families that need no recording at all.**

---

## 6. Parent-impact list

Every claim about W12 found wrong, with the measured correction. Nothing below was edited by this
scout — the orchestrator owns placement, and `strangle/*`, `ledger.json` and `attestation.ts` are
under concurrent edit (C10.6).

| where | claim | measured correction |
|---|---|---|
| campaign spec §1.1, subagent row | "medium (nested loop reentry) · `fy12d89p` @55–58k, `bf5vvscj`" | `bf5vvscj` is the **plugin-hooks `$` runtime** (`agent.spawn`/`tool.call`/`ui.*`/`fs.*` event registry, the `ws` verdict combinators, `LU.ledger()`) and `ledger.json` **already assigns it to C8**'s `subsystem/hook-dispatch` footprint — 112,652 B leave the row, ~700 B stay as an edge. "@55–58k" is **correct** (chunk-relative pretty lines 55,900–56,978) and names ~54 KB of ~188 KB; five more belts sit at ≈33.9k, ≈47.8k, ≈53.5k, ≈77k and ≈105k. **There is no nested loop and no reentry**: `Bb` delegates to `Kx`, the same generator the headless loop imports (§0.3). Seam quality is **high**, not medium — object literal, 36 unique prose anchors, three trivial private-field classes |
| campaign spec §1.1, sandboxing row | "module-level (CEL/protobuf tangle) · `q4xe0m2r`" | 83.5 % of the chunk is vendored (picomatch 24,586 + CEL/protobuf 319,450 + `sandbox-runtime` 134,955), all §1.2-excluded. The Claude-Code-own layer is **94,760 B** beginning at a clean offset (485,420) and **touches no CEL**. The façade `pt` is a 2,672 B **object literal**, not a class, with no private fields. On the macOS path the effectful residue is **under 3 KB**. Seam quality is **medium-high**, not low |
| campaign spec §6, W12 row | "Agent/subagent dispatch + sandbox interface (`ToolRuntimePort` boundary) · S-module (fable) · subagent depth; sandbox matrix; mutation battery" | Right on scope; wrong on shape. **They are two disjoint cores** — no shared state, no shared effectful call, no shared caller (§3.1) — so one port name covers a boundary that does not exist; recommend `AgentRuntimePort` + `SandboxPolicyPort`/`SandboxExecPort`. And "subagent depth" is the wave's **single biggest measurement hole**: no recorded transcript contains a depth-2 dispatch or a subagent that calls any tool |
| campaign spec §1.3 / the ledger | `tool/Agent` has `edges: []` | Measured edges: → C11c/W8c (the task registry, the notification bookends, `agentNameRegistry` addressing that `SendMessage` reads), → C12/W9 (subagent transcripts via `mp(agentId)`, and `fork-context-ref` whose **only** writer is the fork arm), → C8/W5 (SubagentStart/SubagentStop call sites and the `ka` suppression), → C16/W13 (`Kx`), → C9/W6 (the child's permission-context clamp and the `avoid_prompts` layer), → C14/W11 (`$Ft`, the forked-skill dispatcher, and the skill preload inside `Bb`), → C13/W10 (`qit`, which kills a child's orphaned shell tasks) |
| campaign spec §3.6 | "The isolation substrate is built at the inversion milestone (W13)" | Correct, and the split should be written down because the vocabulary collides. **W13/§3.6's "isolation" is the ownership gate** — engine-ts confined so the extracted artifacts are unreadable. **W12's "isolation" is three different things**: the Agent tool's `isolation: worktree\|remote` parameter, the OS sandbox `q4xe0m2r` builds for Bash, and `toolUseContext.isolationLatch` (a web-search exemption). The one thing W12 hands W13 is the *measurement*: the seatbelt profile builder is pure and the macOS wrap is `env … /usr/bin/sandbox-exec -p <profile> <shell> -c <cmd>` — which is exactly the mechanism §3.6 proposes for the ownership gate, already present and already working on this host |
| census line 51 (Agent/Task tool) | "`fy12d89p` @55–58k; `bf5vvscj` (113 KB) · ~180 KB · medium — nested loop reentry" | 113 KB leave (above); the ~180 KB figure survives by coincidence with a different composition (154 KB engine + 29 KB teammate + 4 KB satellites, minus 31 KB of §1.2 remote). Add: `chunk-eyzf721y.js`, `chunk-n90xnvep.js`, `chunk-zp0shqm2.js`, `chunk-jna7qpeb.js`, `chunk-habzwgt7.js`, `chunk-9xdt2ay0.js`, `chunk-9rtx6cwj.js` |
| census line 42 (Sandboxing) | "~180 KB own logic in a 582 KB chunk · low — CEL policy engine tangles with vendored protobuf" | The own logic is **94,760 B**, not ~180 KB, and it does **not** tangle with CEL: the vendored region ends at a single offset and the own layer imports nothing from it. Add `chunk-6v95pkgg.js` (the alias barrel) |
| census line 52 (`.claude/agents` loading) | "`fy12d89p` @37–40k; `q4xe0m2r`; `z0mqep56`" | `q4xe0m2r` contains **zero** occurrences of `agentType`, `subagent_type`, `whenToUse` or any agent-loading identifier; its one `.claude/agents` occurrence is a sandbox path-literal list beside `.claude/commands`, `.bashrc`, `.mcp.json`. Remove `q4xe0m2r` from that row |
| `reforge/ledger.json` | `subsystem/subagent-dispatch`, `subsystem/sandboxing`, `tool/Agent` all `edges: []`, `footprint: null` | Add the edges above. Also: `subsystem/sandboxing`'s consumers are **C13/W10 and C9/W6, not C15** — W12 owns the implementation, W10 and W6 own every call site, so the row needs both directions. And there is **no row** for the worktree-isolation mechanism (17 KB), the teammate surface (29 KB) or the observer belt (14 KB); `tool/EnterWorktree`/`ExitWorktree` are C11's *tools* and are a different mechanism from the agent worktree (they refuse each other explicitly — `YCe()`) |
| `strangle/attestation.ts`, **14** sandbox exclusions (7 on `permission-precheck`, 7 on `rule-based-permissions`) | each justified by "§3.3 pins the gate state and X6 forbids the env overrides that would flip it" | Wrong in premise **twice**. (a) W10's correction: it is `settings.sandbox.enabled`, not a gate, and no env var appears in the chain on macOS/Linux — now confirmed by resolving every predicate (§2.3). (b) The half W10 left standing: **`Options.settings.sandbox` and a direct `Options.sandbox` are typed members of the installed SDK**, they load into the highest-priority user-controlled settings layer, they survive `settingSources: []`, and the harness already passes inline `settings` at 17 sites. The conclusion (unreached today) is right; the *reason* is wrong and the remedy is **one settings object on a host that already has a working `sandbox-exec`** |
| W10 scout §5.3 | "`pt` (the `SandboxManager` façade, 2,672 B, ~50 members) delegates to `ct`" | Byte figure exact; **49** members exactly, of which 43 are ≤70 B pass-throughs and 20 delegate straight to `ct`; and **neither `pt` nor `ct` is a class** — both are object literals with no private fields. Add: `Xa()` calls `bu()` for effect before the latch read; `shouldForceSandboxOn` is **structurally dead** because `tenguSandboxGbConfig` is memoised over `PY(){return{}}` with no setter; `Ct()` and the seccomp arch selector are **constant-folded** to darwin/arm64 in this artifact |
| W10 scout §5.2, fourth item | "the sandbox's OS boundary … the harness has no notion of a host capability that a scenario can require" | Correct, and the measurement narrows what it costs: **the primary instrument needs no host at all**, because `PR` is a pure `inputs → profile text` function and the `description-parity.test.ts` shape applies. The capability notion is needed for **one** end-to-end control, not for the grading strategy. W12 should build the control and W13 the substrate |
| W10 scout §3.2, `SandboxPort` stub | one stub with six members | Its far side is **two** ports, not one: a read-shaped policy port (whose consuming logic — `bv`, `PR`, `F2` — stays owned and pure) and a handle-shaped exec port. The "must throw, not pass through" rule is right and carries over verbatim |
| W8 scout §7.4 | "`subsystem/moat-tools` … edges … `subsystem/subagent-dispatch` (background Agent → task registry)" | Correct and now sized: **eight** `local_agent` writers in W12 (`MG`, `Ilt`, `kx`, `Vx`, `clt`, `llt`, `_ne`, `ult`), plus `ys`/`emitTaskProgress`/`task_started`, plus a second seam W8 did not name — **`agentLifecycle.registerName` populates `appState.agentNameRegistry`, which is what makes `SendMessage({to: name})` resolve.** `Bb` also injects a `SIBLING_ROSTER_REMINDER_PREFIX` meta message listing the other live agents |
| W9 scout §6.3 | "→ C15/W12 (subagent transcripts, `route-by-agent`)" | Correct, with the producers named: `rte(messages, agentId, parentUuid, storageV5)` writes the child's chain under the **child agent id**, and `mp(agentId)` derives `<projectDir>/<sessionId>/subagents/agent-<id>.jsonl`. Add: **`rzn` writes the `fork-context-ref` record and its only caller is `Bb`'s fork arm** — so one of W9's twenty-nine never-written record types has a single writer, and that writer is behind `Le()` |
| W11 scout §4.1 | "`$Ft` dispatches a forked skill as a subagent" | Correct, and it is a **second dispatch entry point**: `$Ft` (2,677 B) calls `MG`, `fw`, `n9` and `Bb` directly and never goes through `Ane.call`. `eIn` (3,685 B, the skill invocation path) is a third. Counting only the Agent tool understates the surface by two callers and five importing chunks |
| `reforge/README.md` §Concurrency (~line 361) | the lane model — root / subagent (`parent_tool_use_id`) / async task notifications | Correct **at depth 1, which is the only depth the corpus has ever produced.** A depth-2 dispatch produces frames whose parent is the child's own tool-use id, and no transcript contains one. Before a nesting scenario is recorded the lane model needs a written decision (§4.2) |
| `reforge/src/harness.ts:resetSandbox()` | clears `sandbox/` children and `CONFIG_DIR/plans` | It cleans neither `<config>/tasks/` **nor** the agent's actual output file, which lands at `/private/tmp/claude-501/<project-slug>/<session-uuid>/tasks/<task-id>.output` — **outside both roots** — nor any git worktree an `isolation:"worktree"` agent would create. The doc comment's own precedent ("engine state a run creates has to be reset with the sandbox, wherever the engine happens to keep it") applies directly |
| `research/fixtures/symbol-map-2.1.251.json` | — | No entry for **four self-naming chunks** this wave depends on: `chunk-6v95pkgg.js` (the sandbox alias barrel, ~44 names), `chunk-n90xnvep.js` (`Bb as runAgent`, 7), `chunk-zp0shqm2.js` (`kan as createSubagentContext`, `tT as runForkedAgent`, 14), `chunk-eyzf721y.js` (`spawnTeammate`, 7). This is the same gap W11 flagged for `chunk-1bxday80.js`; the fix is the same — have `research/tools/symbol-map.ts` harvest `export{X as Name}` aliases |
| `docs/parity/coverage.md` domain 3 | "sandbox modeled … typed `sandbox.credentials` (probe 48 deny verified)" | Accurate about the SDK option and unrelated to `q4xe0m2r`. Worth a note, because this project now has **six** distinct things called "sandbox" or "isolation": `reforge/sandbox/` (the scratch dir), `Options.sandbox` (the SDK settings subtree), the OS seatbelt/bwrap sandbox, `isolation: worktree\|remote` (the Agent parameter), `toolUseContext.isolationLatch` (a web-search exemption), and §3.6's hermetic isolation substrate. `m2/probe-isolation.ts` is a seventh — it probes *config-directory* isolation |
| W13 scout (`…w13-query-loop-scout.md`) §2, §7 | "The per-tool invocation is `kUn` … That is `ToolRuntimePort`'s far side and belongs to **C15/W12**, not here" | The routing is defensible and the port name is not. Measured: `kUn` (26,716 B) touches **no** sandbox symbol and **no** subagent-dispatch symbol; its callees are the hook dispatchers (`mQ`, `dQ`, `SL`, `VNt`), the permission plumbing and the error shapers, and its module state is the `yk()` tool-state container. So `ToolRuntimePort` now names **three** disjoint cores. Recommend `kUn` becomes its own child with its own port (`ToolExecutionPort`), placed next to the hook executors and C9 rather than inside C15 — flagged as an orchestrator decision, since this scout did not measure it in depth |
| the W12 brief's own premise | "`parallel-tools` … drives the AGENT tool" | It is a three-command Bash batch (`m2c/scenarios.ts:170`). Three scenarios drive `Agent`, not four |

---

## 7. A proposed cut for C15 — advisory

### 7.1 One wave or two? Two, and the measurement says so rather than the topic

They share **no state, no effectful call and no caller** (§3.1). Their oracle needs are disjoint: the
sandbox needs a golden-file profile oracle and one host-capability control; the subagent core needs a
scripted child and descendant/worktree supervision. Their blockers are opposite in kind: **the sandbox
is unblocked today by one settings key on this host**, while the subagent core's most valuable arms
need machinery that does not exist. And their consumers are different waves — the sandbox's call sites
are C13/W10's and C9/W6's; the subagent core's are C11c/W8c's, C14/W11's and C16/W13's.

Fusing them would put a settings-key-away win — one that **retires fourteen standing attestation
exclusions and unblocks the `SandboxPort` stub C13d is waiting on** — behind a scripted-child oracle
that does not exist. That is the same mistake W9's cut avoided by putting the reader before the
writer and W10's avoided by putting the parser before the process core.

**Recommendation: split C15 into C15a (subagent dispatch) and C15b (the sandbox), and schedule C15b
first.**

### 7.2 C15b — the sandbox (two children; schedule first)

**C15b1 / W12b1 — the profile oracle and the settings-key scenario.** *(controlled, opus-tier; cut
NOW, blocked-by nothing; recordings serialize per X5)*
Three pieces. (1) A **profile-text oracle** on the `strangle/description-parity.test.ts` pattern:
extract `PR` out of the pinned bundle, evaluate it with a stubbed `SandboxPathPort` over a declared
cross-product of its ~14 inputs (read/write configs × network restriction × unix sockets × local
binding × mach lookup × pty × Apple Events × weaker network isolation), and require byte identity with
the owned module. No sandbox, no host capability, no engine run. (2) A **host-capability requirement**
primitive — a scenario may declare "needs macOS with an executable `/usr/bin/sandbox-exec`" and is
skipped with a recorded reason elsewhere; §3.6's substrate at W13 needs the same notion and should
inherit this one. (3) The **`agent-sandboxed-bash` recording**: `settings: { sandbox: { enabled: true,
autoAllowBashIfSandboxed: true } }`, a Bash read inside the allow-set, a Bash write outside it, and one
call with `dangerouslyDisableSandbox`.
*Observable acceptance:* the profile oracle fails on a perturbed input; the scenario is
skipped-with-reason on a host without `sandbox-exec` and green on this one; **the fourteen sandbox
attestation exclusions either retire or are re-justified on their real guard**, and the rider W10
already filed lands here rather than in C13c.
*Edges:* → C13/W10 (`SandboxPort`'s stub becomes two real ports), → C9/W6 (the exclusions live on
their rows), → C16/W13 (the capability primitive).

**C15b2 / W12b2 — the sandbox module behind `SandboxPolicyPort` / `SandboxExecPort`.** *(fable-tier;
cut when C15b1 lands)*
Owns the 94,760 B Claude-Code layer: `PR` and its rule emitters (7,666 + ~1,400 B), `bv` (407 B),
`F2`/`FY`/`Zgt` (~900), the guard chain `Xa`/`Tm`/`Pi`/`qa`/`xm`/`Vwe`/`Eu`/`i9` (~900), `M2`,
`qh`'s spawn assembly and its fast-path predicate, and `eht` (34,268 B, the settings→srt-config
translator). Linux and Windows ship as throwing stubs whose exclusion reason is the **constant-folded
`Ct()` dispatch**, not the absence of a host. Vendored picomatch / CEL / protobuf / `sandbox-runtime`
are §1.2 exclusions and engine-ts imports the packages.
*Observable acceptance:* §3.1's S-module bar. The behavioural-partition matrix **is** the profile
cross-product plus `bv`'s seven-branch truth table plus `F2`'s five outcomes. The mutation battery
must kill: a dropped deny rule, an allow emitted where a deny belongs, a lost `sandboxDisabledThisSession`
latch (made recoverable), `checkDependencies` collapsed to a boolean, and the two wrap members fused.
*Edges:* → C13/W10 (every call site), → C9/W6 (four call sites in the decision chain), → C3 (the
settings layers `Pi`/`FY` read).

### 7.3 C15a — subagent dispatch (four children)

**C15a1 / W12a1 — the pure belt.** *(autonomous, opus-tier; cut NOW, blocked-by nothing)*
~45 KB of pure code with 36 unique prose anchors and **zero new recordings**: the child-catalog
resolution (`KPn`/`_E`/`e2`/`Xle`/`Eee`/`_x` — already graded three ways by the corpus at 22/19/13),
the agent-type ladder and its six refusal sentences, `yEe` + the result-stat family, model resolution
(`mnt`/`q0`/`N8`), the six schemas, `mapToolResultToToolResultBlockParam` (four statuses, all uniquely
anchored), the spawn counters, and the worktree naming/validation (`q3n`/`hEn`/`Jye`).
*Observable acceptance:* every splice solo-sabotaged RED on `subagent`/`background-task`/`hooks-subagent`;
a contract test over `KPn` × the four axes whose expectation is the corpus's own three catalogs; the
agent-type ladder partitioned over its six refusals. *Why first:* it is a quarter of the row's
denominator at the risk profile of a formatter splice.

**C15a2 / W12a2 — the Agent tool's prompt.** *(autonomous, opus-tier; cut NOW, parallel with C15a1)*
`wlt`, 16,727 B, six conditional sections under six guard reads — the same play W3 ran on the preset's
sections, on a surface where the prose renders into every graded request body today. It is worth its
own child because a cut that fused it with the dispatch would put 17 KB of prose behind a
scripted-child oracle, which is exactly what W10 refused for the Bash prompt.
*Observable acceptance:* the rendered description is byte-identical on both engines for each guard
combination the corpus reaches, and the fork section's absence is asserted with `Le()` cited.

**C15a3 / W12a3 — subagent oracle machinery.** *(controlled, opus-tier; cut NOW, blocked-by nothing;
serializes per X5)*
The three §4.2 capabilities plus the two probes and the six recordings. (1) A **scripted child**:
`Options.agents` definitions with pinned `tools`/`maxTurns`/`model`/`permissionMode` (the corpus uses
`Options.agents` zero times today) and authored child-lane responses — §3.2's synthetic response
corpus extended to a second concurrent lane. (2) **Survivor supervision**: a third state-surface root
covering `<CONFIG_DIR>`, the task-output directory (which is outside both roots today) and
`.claude/worktrees/`; a descendant-process set diffed between engines **with deliberate survivors
declared rather than forbidden**, because a background agent legitimately outlives its parent turn;
and `resetSandbox()` learning all three. (3) The **lane-and-id decision** for depth ≥ 2, written down
before any nesting scenario is recorded. Plus `w12/probe-subagent-depth.ts` and
`w12/probe-agent-teams.ts`.
*Observable acceptance:* each capability ships with a negative control — a scripted child whose turn
count is perturbed must move the graded output; a scenario that leaks a *non-declared* child must FAIL
the state diff while a declared background agent must not; a seeded worktree must appear in the
snapshot. The two probes return FIRED/DEAD/OPEN with written reasons.
*Why a separate child:* it is the piece W12 shares with W9's carry-over and W10's C13c, and it is
dispatchable in parallel with C15a1/C15a2.

**C15a4 / W12a4 — the dispatch S-module.** *(fable-tier; cut when C15a3 lands)*
`Ane.call` (22,962 B), `Bb` (16,471), `n9` (9,095), `kan` (3,937), `$Ft` (2,677), `Agr`, `Kve`, `Oat`,
the eight task-record writers and the worktree disposition closure — about 55 KB of effectful residue
behind `AgentRuntimePort`, `ChildQueryPort`, `TaskRegistryPort`, `NotificationPort`, `WorktreePort`,
`AgentClockPort`, `AgentTelemetryPort`, plus the `TeammatePort` / `RemoteAgentPort` / `ObserverPort`
stubs.
*Observable acceptance:* §3.1's full S-module bar; the §4.3 matrix D1–D19; and a mutation battery that
must kill — **a leaked concurrency slot** (the release function dropped on a throw path), **a shared
`readFileState`** (`f3`'s copy replaced by the reference), **an app-state key propagated outside
`Egr`**, **a cleanup stage reordered or a `keepaliveGated` stage run when it should be skipped**, **a
stall watchdog that does not defer while tools are in flight**, **a worktree kept when it should be
removed**, and **a `task_notification` that fires twice or carries the wrong `tool_use_id`** (the
existing `background-check.test.ts` already encodes the last one, which is the template).
*Edges:* → C16/W13 (`ChildQueryPort` = `Kx`; **W12 must not own `Kx`**), → C11c/W8c
(`TaskRegistryPort`, `NotificationPort`, and the `agentNameRegistry` addressing seam), → C12/W9
(subagent transcripts and `fork-context-ref`), → C8/W5 (the SubagentStart/Stop call sites and `ka`'s
three suppressions), → C14/W11 (`$Ft`, `eIn` and the skill preload), → C13/W10 (`qit`'s orphaned-shell
kill), → C9/W6 (the child's permission-context clamp).

**C15a5 / W12a5 — worktree isolation, observers and teammates.** *(fable-tier; ADVISORY, cut last)*
The 17 KB agent-worktree family (`Zye`, `ZW`, `bN`, `Aqn`, `In()`'s three exits, the isolation-evidence
sets), the 14 KB observer belt plus `chunk-jna7qpeb.js`, and the 29 KB teammate chunk behind the
`--agent-teams` argv axis. All three are genuinely deferrable, none blocks anything, and each is a
separate *axis* rather than a scenario — the same shape W10 gave PowerShell.

### 7.4 Ordering and tiers

**Ordering.** C15b1 ∥ C15a1 ∥ C15a2 ∥ C15a3 now (disjoint files; recordings serialize per X5).
C15b2 after C15b1. C15a4 after C15a3. C15a5 last.
**Tiers.** C15a1 / C15a2 opus (bounded, well-anchored, no ports, no recordings). C15b1 / C15a3
controlled-opus (they record and they add machinery, each with negative controls). C15b2 / C15a4 /
C15a5 fable (§4's rule for S-module work).

**One decision this cut deliberately leaves open.** `kUn` (26,716 B), the per-tool invoker the W13
scout routed at `ToolRuntimePort`, is not placed here. It is a fourth disjoint core, this scout did
not measure it, and its neighbours are C10.6–C10.8 and C9. Placing it inside C15 on the strength of a
shared port *name* is the failure this document spent §3.1 documenting; the orchestrator should route
it explicitly, with its own port, wherever it belongs.

**The two numbers the orchestrator should grade this cut on.** First: **C15b is one settings key away
from retiring fourteen attestation exclusions and unblocking the stub C13d is waiting on**, and its
grading instrument is a contract test that needs no host. Second: **C15a1 + C15a2 are ~62 KB of the
~188 KB row, unblocked today, needing no port, no oracle capability and no new recording** — the same
shape W10's parser-and-safety-chain finding had, and for the same reason: the blocker is real and it
guards the smaller half.

---

## 8. Method notes worth keeping

- **A chunk named for a row may belong to a wave that already owns it.** `bf5vvscj` had been carried
  on the subagent row since the census while `ledger.json` simultaneously listed it inside
  `subsystem/hook-dispatch`'s footprint. The check is one `grep -c` for the row's own vocabulary
  (`Launch a new agent`: 0; `worktree`: 0; `subagent_type`: 1) against the ledger's existing
  footprints. Two documents disagreeing about the same chunk is a cheap, mechanical signal and nobody
  had run it.
- **Look for the barrel *before* scoping, and look for more than one.** W9's lesson found
  `chunk-e6cn1914.js`; W11 found `export{X as Name}` inside the module. This wave has **four** self-naming
  artifacts — `chunk-n90xnvep.js` (`Bb as runAgent`), `chunk-zp0shqm2.js` (`kan as createSubagentContext`,
  `tT as runForkedAgent`), `chunk-eyzf721y.js` (`spawnTeammate`) and `chunk-6v95pkgg.js` (44 sandbox
  names) — and none is in the symbol-map fixture. The generalisation: a subsystem's true API is
  usually written down somewhere in the bundle; find it before deriving one.
- **When a feature looks gated, check whether the guard is the launch mode.** The fork subagent reads
  like a gated feature and is not: `adr()`'s middle clause is `if(Le()) return "disabled"`, and `Le()`
  is `!isInteractive()`. Three prior scouts established the vocabulary of gate-dead / env-dead /
  entrypoint-dead / settings-dark; **mode-dead** is a fifth class, it is not reachable by any of the
  levers those scouts inventoried, and it is invisible to the gate-defaults fixture by construction.
- **A flip that opens one behaviour may close another.** Turning the fork on removes `run_in_background`
  from the Agent tool's presented schema, so the one env flip that would buy the fork's coverage would
  also redden the corpus's only background-agent scenario. Before budgeting a flip-liveness cell, read
  what else its predicate feeds — here, the *schema builder*.
- **Ask whether the OS-coupled thing is actually the coupled part.** The sandbox reads as the wave's
  hard half because it ends in `sandbox-exec`. Measured, the profile is a **pure function of data**
  and the process boundary is 1,947 B of argv assembly beneath it — so the right oracle is a golden
  file, not a host. The same question is worth asking of any subsystem whose difficulty is asserted
  from its output rather than from its code.
- **A vendored tangle can have a clean edge.** 83.5 % of the sandbox chunk is three npm packages, and
  the seam between them and the owned layer is a single offset that two independent signals agree on
  (the last vendored-helper call site and the first owned-accessor call site). "Interleaved with
  vendored code" was a reading of the file's *size*, not of its structure.
- **`grep` for a package name is not a composition measurement.** picomatch is 24,586 B of this chunk
  and the string `"picomatch"` appears zero times. Identity has to come from exported-symbol prose or
  from the node-builtin import blocks the bundler emits at each package entry.
- **An id lexeme shared by two concepts is a differ hazard before it is a bug.** Agent ids and task
  ids are both `a` + 16 hex, and the differ's run-id map keys on the JSON property name — which works
  today only because no transcript has ever contained a frame where the two disagree. Enumerate the id
  *shapes* alongside the id *keys* before the first scenario that can produce one.
