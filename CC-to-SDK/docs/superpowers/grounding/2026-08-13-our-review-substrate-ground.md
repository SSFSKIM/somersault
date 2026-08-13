# Our review substrate — grounding for a code-review capability

**Scope.** Substrate assessment only: what already exists that a review capability could stand on, and
what genuinely does not. **No design is proposed here** and no code was changed. Every claim is cited
`path:line`, repo-root-relative (`CC-to-SDK/…`, `codex-rs/…`). Claims that are reasoning rather than
observation are labelled **(inference)**.

**Three headlines.**

1. **The single strongest seam is a native SDK tool we already probed and never consumed.**
   `ReportFindings` is a first-party Claude Agent SDK tool whose declared input is a review findings
   array with `file` / `line` / `summary` / `failure_scenario` / `category` / `verdict`
   (`CC-to-SDK/harness/node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:771-814`), it is
   **default-on in every session we open** (the `claude_code` preset,
   `CC-to-SDK/harness/src/config/tools.ts:16-18`), and probe 44 measured it **callable headlessly**
   (`CC-to-SDK/probes/probes/44-report-findings.ts`; verdict recorded at
   `CC-to-SDK/docs/parity/full-potential.md:51`). No wire, no config and no prompt in this repo reaches
   for it.
2. **Structured output is reachable from the app-server *inbound*, and unreachable *outbound*.** A
   client's `thread/start {config}` is an unfiltered spread into `openSession`
   (`CC-to-SDK/harness/src/appserver/server.ts:128-130`), so `outputFormat` already flows in
   (`CC-to-SDK/harness/src/config/resolveOptions.ts:55`). But the app-server's own engine interface
   declares `submit(): Promise<{result, error?}>`
   (`CC-to-SDK/harness/src/appserver/registry.ts:34`) — `structuredOutput` is type-erased at that
   boundary even though the real `Session` resolves it
   (`CC-to-SDK/harness/src/session/session.ts:32,322`) — and `turn/completed` carries only
   `{id, status, error?}` (`CC-to-SDK/harness/src/appserver/turns.ts:241-243`). **The result never
   leaves the server.**
3. **A complete, tested, git-based review pipeline already exists in this repo** — in the wrong
   process. `CC-to-SDK/claude-plugin-codex/plugins/claude-companion/` ships three review prompts, a
   findings JSON Schema, and a 346-line diff-acquisition module. It is a Codex-host-calls-Claude plugin,
   not harness code, but its diff half is portable nearly as-is.

---

## §1 — Turn / agent machinery: could a review be a specialized turn?

### 1.1 How the app-server runs model work today

One spine, `beginTurn` (`CC-to-SDK/harness/src/appserver/turns.ts:139-275`), shared by `turn/start`,
the queue drain, and compaction (its header says so at
`CC-to-SDK/harness/src/appserver/turns.ts:134-138`). It does five things, all synchronously at request
arrival: gates on `threadBusyReason` (`turns.ts:158-159`), claims `busy`, resets the per-turn replay
buffer and `interruptRequested` (`turns.ts:167-168`), mints the turn id (`turns.ts:175`), and then
defers the actual engine work onto `record.chain` (`turns.ts:179`).

The engine call itself is one line, inside `submitRunner`:
`record.session.submit(input, (m) => emitItems(...), { uuid })`
(`CC-to-SDK/harness/src/appserver/turns.ts:297`). Everything a client sees is derived from the streamed
frames by `TurnMapper` (`CC-to-SDK/harness/src/appserver/items/mapper.ts:59,117`), turned into
`item/started` / `item/*/delta` / `item/completed` notifications
(`CC-to-SDK/harness/src/appserver/turns.ts:77-81`).

The turn's terminal notification is built at `CC-to-SDK/harness/src/appserver/turns.ts:241-243`
(success path), `:255-258` (failure path), and `CC-to-SDK/harness/src/appserver/fleet.ts:219` (fleet
origin). All three emit `{id, status, error?}` and nothing else.

`turn/start`'s params are `{threadId, input, queue?}` — a bare prompt string, no per-turn config, no
schema, no target (`CC-to-SDK/harness/src/appserver/schema/turns.ts:6`).

### 1.2 The `Session` engine underneath

`CC-to-SDK/harness/src/session/session.ts` is one long-lived `query()` with a streaming input queue.
A turn is `enqueueTurn` → push an `SDKUserMessage` → wait for the correlated result frame
(`session.ts:93-95,118-123`). The turn settles as `TurnOutcome { result, structuredOutput?, error? }`
(`session.ts:32`), and `readLoop` populates all three from the result frame
(`session.ts:322`). Options are fixed at construction (`session.ts:64`) — **there is no per-turn option
override anywhere in this class**.

### 1.3 The three shapes a review could take, and what backs each today

| Shape | What already exists | What it would need |
|---|---|---|
| **Specialized turn on the existing thread** | The whole `beginTurn` spine; `turn/start` already accepts arbitrary prompt text. `/review` is *deliberately* routed this way in the TUI today — `CC-to-SDK/harness/src/tui/commands.ts:371` records "`/review` and `/doctor` are DELIBERATELY absent: both are prompt-type upstream, so submit-as-turn is exactly how they work" | A way to carry a *result* back (§2), and per-turn tool/prompt fencing that `Session` cannot do (options are construction-time, `session.ts:64`) |
| **Separate short-lived session** | `openSession(config)` (`CC-to-SDK/harness/src/session/index.ts:12-16`) and `createHarness` one-shot (`CC-to-SDK/harness/src/harness.ts:32`, per `CC-to-SDK/harness/CLAUDE.md:30`). `runStructured` already does exactly this from inside the interactive REPL — see `structuredExplainTransport`, `CC-to-SDK/harness/src/tui/dialogs/explainCommand.ts:115-135`, which fences the nested run with `settingSources: [], allowedTools: [], maxTurns: 2, forkSubagent: false, workflow: false` (`:129`) | Nothing structural. This is the path with the least missing substrate **(inference)** |
| **Subagent inside the turn** | `config.agents` → SDK `AgentDefinition` map, merged over three built-ins (`CC-to-SDK/harness/src/config/agents.ts:6-27`); the built-ins already model the read-only shape a reviewer wants (`Explore`/`Plan` carry `disallowedTools: ["Edit","Write","NotebookEdit"]`, `agents.ts:4,14,19`). `config.agent` applies an entry's prompt/tools/model to the **main** thread (`CC-to-SDK/harness/src/config/types.ts:127`, probe-53-verified). `Query.supportedAgents` reaches the wire via `thread/capabilities/read` (`CC-to-SDK/harness/src/session/session.ts:290-299`, `CC-to-SDK/harness/src/appserver/registry.ts:55-61`) | A reviewer agent definition; and note the app-server surfaces subagent turns only as a `toolCall` item with `view:"subagentTask"` (`CC-to-SDK/harness/src/appserver/items/types.ts:21`) |

### 1.4 `forkSubagent` and `Workflow` specifically

- **`forkSubagent`** is **default-on** (`CC-to-SDK/harness/src/config/types.ts:76,162`). Two things are
  required and both are wired: the env var `CLAUDE_CODE_FORK_SUBAGENT=1`
  (`CC-to-SDK/harness/src/config/resolveOptions.ts:23`) **and** a system-prompt advertisement
  (`CC-to-SDK/harness/src/config/outputStyle.ts:37`) — probe 33d proved the env var alone is inert
  (`types.ts:73-75`). The fork child **inherits the full parent transcript**, which is the recorded cost
  (`types.ts:75`). For a review that wants a *clean* context, this is the wrong tool **(inference)**;
  for a "review what you just did" self-check it is the right one.
- **`Workflow`** is **opt-in and off by default** (`types.ts:82,163`), because "a workflow is a cost
  MULTIPLIER (dozens of child agents), so the operator must enable it deliberately" (`types.ts:80`).
  Enabling it allowlists four tools (`CC-to-SDK/harness/src/config/tools.ts:6,21-23`) and appends a
  system-prompt note (`outputStyle.ts:38`). Children do **not** stream into the parent — the return
  value re-enters via `TaskOutput`/task-notification (`types.ts:77-79`). Probe 36 verified it headless;
  the parity doc records it as verified-but-not-surfaced-in-TUI
  (`CC-to-SDK/docs/parity/coverage.md:539`).

**Verdict for §1: a review does not need its own loop.** Every mechanism a multi-agent review would use
(fresh fenced session, agent definitions, fork, workflow fan-out) is already modelled and probed. What
is missing is not machinery but *carriage* — a way for a turn to return a typed payload (§2) and a way
for the app-server to name the target (§3).

---

## §2 — Structured output: `runStructured<T>()` and its exact constraints

### 2.1 What it is

`CC-to-SDK/harness/src/structured/run.ts:21-37`, 37 lines total, exported publicly at
`CC-to-SDK/harness/src/index.ts:47`.

```
runStructured(schema, prompt, config, deps)
  → createHarness({...config, outputFormat: {type:"json_schema", schema: z.toJSONSchema(schema, {target:"draft-7"})}})
  → harness.run(prompt)
  → find the result frame → turnFailureOf() → schema.parse(result.structured_output)
```

### 2.2 The exact constraints

1. **draft-7, mandatory — this is the ajv detail.** `structured/run.ts:24-26`:
   > "target draft-7: the CLI validates the schema with ajv, which does NOT register the 2020-12
   > meta-schema zod emits by default (`--json-schema is not a valid JSON Schema` — caught live)."

   Corroborated three more places: `CC-to-SDK/docs/parity/coverage.md:20-21`,
   `CC-to-SDK/docs/parity/full-potential.md:62`, and as an executable check —
   `CC-to-SDK/harness/test/unit/appserver/schemaGen.test.ts:61-69` (every emitted artifact must be
   draft-7 and no subschema may redeclare the dialect) and `:84-98` (every method schema must compile
   under `new Ajv({strict:true})`, which *is* draft-7 in ajv 8). The same gotcha is recorded at the
   emit boundary, `CC-to-SDK/harness/src/appserver/schema/emit.ts:14-15`.
2. **`maxTurns:1` starves it** — probe 36 measured `subtype=error_max_turns` with `result` undefined
   (`CC-to-SDK/probes/probes/36-output-format-json-schema.ts:10`). Give the turn headroom; the live
   test uses `maxTurns: 3` (`CC-to-SDK/harness/test/live/structured.live.test.ts:13`).
3. **Read `structured_output`, not `result`** — probe 36: "The schema-conforming payload arrives as a
   PARSED OBJECT in `result.structured_output`; `result.result` remains free prose"
   (`36-output-format-json-schema.ts:8-9`).
4. **It is one-shot by construction.** It builds its own `createHarness` (`run.ts:26`) — a separate
   `query()` — and any caller-set `outputFormat` is replaced (`run.ts:20`). It cannot be pointed at an
   existing live `Session`.
5. **Failure taxonomy is already distinguished.** `StructuredRunError` for "no result frame" / "run
   failed" / "no structured_output"; a **ZodError** for a present-but-mismatched payload
   (`run.ts:6-15,29-36`). The failure classifier is `turnFailureOf`, deliberately **not** `subtype` —
   probe 96 measured a dead connection reporting `subtype:"success"` with `is_error:true`
   (`run.ts:30-34`, `CC-to-SDK/harness/src/session/turnResult.ts:40`).

### 2.3 Is it usable from the app-server path?

**Inbound: yes, already.** `thread/start` takes `config: z.record(z.string(), z.unknown()).optional()`
(`CC-to-SDK/harness/src/appserver/schema/threads.ts:4-7`), and `buildConfig` is a raw spread with only
the permission broker added (`CC-to-SDK/harness/src/appserver/server.ts:128-130`), handed straight to
`openSession` (`server.ts:231`). So `outputFormat`, `agent`, `agents`, `appendSystemPrompt`,
`allowedTools`/`disallowedTools` are all already reachable from a client today.

**Outbound: no.** Three cuts, in order:

| Where | What it does | Cite |
|---|---|---|
| `EngineSession.submit` return type | declares `Promise<{result: unknown; error?: TurnFailure}>` — `structuredOutput` is not in the type at all | `CC-to-SDK/harness/src/appserver/registry.ts:34` |
| `beginTurn`'s `onSuccess` | receives `outcome` and reads only `outcome?.error` | `CC-to-SDK/harness/src/appserver/turns.ts:236-245` |
| `turn/completed` payload | `{id, status}` plus `error` only when failed | `CC-to-SDK/harness/src/appserver/turns.ts:241-243`; fleet mirror `fleet.ts:219` |

The real `Session` **does** carry it (`session.ts:32,322`), and the fleet host wire even ships the
turn's `result` across the socket (`CC-to-SDK/harness/src/appserver/fleetEngine.ts:363-367`) — the
app-server discards it at the last step. **(inference)** Surfacing a structured payload on
`turn/completed` therefore looks like a type widening plus one field, not new plumbing.

**One nuance the ajv rule creates for reuse:** the existing review schema in this repo,
`CC-to-SDK/claude-plugin-codex/plugins/claude-companion/schemas/review-output.schema.json:2`, declares
`"$schema": "https://json-schema.org/draft/2020-12/schema"` — **exactly the dialect the CLI's ajv
rejects**. It is passed to `outputFormat` unmodified by the other app-server
(`CC-to-SDK/app-server/src/handlers.ts:101`). See the open questions.

---

## §3 — Diff / git access: how would a review get its diff?

### 3.1 Nothing in `appserver/` reads git

`CC-to-SDK/harness/src/appserver/workspace.ts` is the whole workspace cluster and it is
filesystem-only: `fs/read` (`:73-130`, absolute paths, 4 MiB cap at `:41`), `fs/search`
(`:150-183`, the TUI's `@`-mention ranker reused verbatim, `:30`), and `thread/shellCommand`
(`:225-251`). A grep for `git` across `CC-to-SDK/harness/src/appserver/` returns nothing.

### 3.2 What git access does exist — all of it in the TUI

| Seam | What it runs | Cite |
|---|---|---|
| `runBash(command, cwd)` | full shell string through `exec`, 30 s SIGTERM timeout, 4 MiB `maxBuffer`, **never rejects** | `CC-to-SDK/harness/src/tui/bash.ts:19-30` |
| `/diff` slash command | literally `git status --short; git diff --stat` through `runBash` | `CC-to-SDK/harness/src/tui/useChat.ts:1836` |
| `hasWorktrees` | `execFile("git", …)` with hooks + fsmonitor disabled, 5 s timeout, failure→`false` | `CC-to-SDK/harness/src/tui/worktrees.ts:11,18,27` |
| placeholder harvest | `git log -n 1000 --pretty=format: --name-only --diff-filter=M` | `CC-to-SDK/harness/src/tui/placeholder.ts:55` |
| `diffSource.ts` | a diff **renderer** (jsdiff `structuredPatch` over Edit/Write tool inputs) — **not** an acquirer; it never shells out | `CC-to-SDK/harness/src/tui/diffSource.ts:99,134` |

### 3.3 Three routes a review's diff could take, and what each already has

1. **The model fetches it itself, via `Bash`.** The `claude_code` tool preset is the default
   (`CC-to-SDK/harness/src/config/tools.ts:16-18`), so `Bash`/`Read`/`Grep`/`Glob` are on in every
   session we open. This is what Codex's own skill-ified reviewer does — it tells the model to run
   `git merge-base` then `git diff` in prose
   (`codex-rs/skills/src/assets/samples/review-agent/SKILL.md:21-26`). **Needs no new seam at all.**
2. **The server collects it and pastes it into the prompt.** `thread/shellCommand` already runs
   arbitrary shell in the thread's own cwd (`workspace.ts:225-251`, cwd from `threadCwd`,
   `:236`) — but it is **display-only by deliberate design**: "the output goes to the calling client
   and the conversation is untouched — the model never sees it", a recorded deviation from Codex
   (D-M3-2, `workspace.ts:189-193` and `CC-to-SDK/docs/parity/appserver.md:498`). So a client *can*
   fetch a diff over the existing wire and put it in its own `turn/start {input}`, but the server
   cannot inject it.
3. **A dedicated git seam.** None exists. The nearest thing in the repo is the plugin's
   `git.mjs` (§4.1), which is not harness code.

**(inference)** Route 1 needs zero new substrate; route 2 needs zero new substrate *if the client does
the assembly*; only a server-owned review target (`uncommitted` / `base <ref>` / `commit <sha>`) forces
a new git seam.

---

## §4 — Existing review prior art in this repo

### 4.1 `claude-plugin-codex/plugins/claude-companion/` — a complete, tested review pipeline

The most directly reusable asset. (Its sibling `CC-to-SDK/codex-plugin-cc/` is an **empty directory** —
verified.) It is a Codex-host-calls-Claude plugin, so it drives the *other* app-server
(`CC-to-SDK/app-server/`, the Codex-protocol drop-in), not `harness/src/appserver/`.

**Prompts** (all `{{VAR}}`-templated), under `…/claude-companion/prompts/`:
- `claude-review.md` — 19 lines; neutral senior-reviewer scope statement (`:11-14`: correctness,
  security, data loss, races, API misuse; "Do not propose stylistic rewrites. Do not fix anything."),
  inline JSON contract (`:17`), mandated exact `file:line` and empty-findings-as-approve (`:18`).
  Vars: `TARGET_LABEL`, `REVIEW_INPUT`, `REVIEW_COLLECTION_GUIDANCE`.
- `adversarial-review.md` — 87 lines, XML-sectioned; adds `USER_FOCUS`. Carries a reusable
  attack-surface taxonomy (`:19-28`) and a four-question finding bar (`:38-46`).
- `stop-review-gate.md` — 38 lines; a Stop-hook gate whose whole contract is a first line of
  `ALLOW: <reason>` / `BLOCK: <reason>`, with a "only review if the previous turn changed code" guard
  (`:4-8`).

**Schema**: `…/schemas/review-output.schema.json` — `{verdict, summary, findings, next_steps}` all
required (`:5-10`); `verdict` is `approve|needs-attention` (`:14-17`); each finding requires
`severity, title, body, file, line_start, line_end, confidence, recommendation` (`:28-37`); `severity`
is `critical|high|medium|low` (`:41-46`). **Declared draft 2020-12 at `:2`** — see §2.3.

**Diff acquisition** — `…/scripts/lib/git.mjs`, 346 lines, pure `git`, no `gh`:
- `resolveReviewTarget` (`:134`) — `auto | working-tree | branch` plus explicit `--base <ref>`;
  auto = dirty tree → working-tree, else branch (`:175-189`).
- `detectDefaultBranch` (`:93`) — `symbolic-ref refs/remotes/origin/HEAD`, then local
  `main`/`master`/`trunk`, then `origin/*`.
- `buildBranchComparison` (`:68-69`) — `git merge-base HEAD <base>` → `<mergeBase>..HEAD`.
- `collectReviewContext` (`:299`) — **the load-bearing idea**: size the diff first, then pick
  `inline-diff` (paste it) vs `self-collect` (paste a summary and tell the reviewer to run git itself).
  Thresholds `DEFAULT_INLINE_DIFF_MAX_FILES = 2` and `DEFAULT_INLINE_DIFF_MAX_BYTES = 256 KB`
  (`:8-9`); `ENOBUFS` counts as over-cap rather than throwing (`:39`).

**Orchestration** — `…/scripts/lib/companion.mjs`: `REVIEW_KINDS` table (`:30-36`),
`buildReviewPrompt` (`:166`), `runReviewTurn` (`:176`), MCP tool definitions `review` /
`adversarial_review` (`:630-648`). **Its recorded caveat is the same gap §2.3 found, from the other
side** (`:159-165`): the app-server does not surface `structured_output`, so `outputSchema` is passed
forward-compatibly but "the prompt's own 'output strictly JSON' instruction is what actually has to
carry the contract". Confirmed in that server: `CC-to-SDK/app-server/src/handlers.ts:101` accepts
`outputSchema` → `cfg.outputFormat`, but the translator returns only `result.text` as `finalText`
(`CC-to-SDK/app-server/src/translator.ts:36-38`).

**Rendering** — `…/scripts/lib/render.mjs`: `parseStructuredOutput` (`:12`), `severityRank` (`:39`),
`normalizeReviewFinding` (`:81`, missing severity defaults to `low`), `renderReviewResult` (`:221`,
severity-sorted at `:261`, `- [sev] title (file:start-end)` at `:276-282`).
Tests exist for all of it under `…/claude-companion/tests/`.

### 4.2 The argus-review / codex-review plugin — not here, but its two ExecPlans are

The plugin itself lives outside this repo. What this repo carries is the design record:

- `docs/doperpowers/execplans/2026-07-17-codex-review-plugin.md` (469 lines) — traces the native Codex
  mechanism from the Rust source; ships a verbatim rubric port, a `resolve_target.sh` shell port of
  `merge_base_with_head`, and a `[P1] <title> — <path>:<start>-<end>` + `## Verdict` text contract.
  Records that native Codex does **not** enforce its JSON schema mechanically
  (`final_output_json_schema: None`) and that its renderer drops `overall_correctness` and all
  confidence scores.
- `docs/doperpowers/execplans/2026-07-17-codex-review-effort-levels.md` (269 lines) — **the multi-agent
  topology**: five levels (`plain|medium|high|xhigh|max`); lens-partitioned parallel **finders**
  (recall-biased) → independent **verifiers** → a sweep finder at `xhigh` → two adversarial **refuters**
  per severe finding at `max`. Its core insight: running N full-rubric reviewers gains nothing because
  the rubric's "prefer no findings" self-censorship is *correlated* across copies; the fix is
  topological — move false-positive suppression out of the finder and into the verifier. Ten exit-gate
  passes are logged with the failure modes each caught.

### 4.3 `.codex/skills/code-review*` at the repo root — a skill-per-lens fan-out

Five skills: an orchestrator (`.codex/skills/code-review/SKILL.md`: "one subagent per skill … xhigh
reasoning … every finding must include a specific file path and line number") plus four lenses —
`code-review-context/`, `code-review-testing/`, `code-review-change-size/`,
`code-review-breaking-changes/`. Same shape the effort-levels plan formalized.
Also `.github/codex/labels/codex-review.md`, a short GH-workflow review prompt.

**`doperpowers` skills themselves are not on disk here** — they load from the external plugin cache.
The only on-disk traces are the two ExecPlans above and session state under `.doperpowers/sdd/`.

### 4.4 Probes

- **`CC-to-SDK/probes/probes/44-report-findings.ts`** — the native `ReportFindings` tool, forced-call
  probe. Declared shape recorded at `:3-4`. Verdict: **ALIVE**, "callable headlessly; consumers harvest
  findings from the `tool_use` input (the result is just 'N findings reported')"
  (`CC-to-SDK/docs/parity/full-potential.md:51`). That harvest-from-`tool_use`-input mechanic is the
  reusable part. Listed in the watched-tool inventory at
  `CC-to-SDK/probes/probes/40-startup-warmquery.ts:22`.
- **`CC-to-SDK/probes/probes/36-output-format-json-schema.ts`** — its header (`:6`) literally names its
  consumer: "plan Task 8 (appserver outputSchema→outputFormat wiring) and **Task 13 (review prompts
  fallback)**". Structured output was probed *for* review from the start.

### 4.5 `codex-rs/` — the parity target, in detail

Codex has a full review feature. The assets that matter:

- **Rubric** — `codex-rs/prompts/templates/review/rubric.md` (96 lines, Apache-2.0). Eight bug criteria
  (`:12-19`), eight comment-construction guidelines (`:23-30`), the self-censorship line "If there is no
  finding that a person would definitely love to see and fix, prefer outputting no findings" (`:36`),
  repository-rule attribution precedence `AGENTS.override.md` → `AGENTS.md` (`:46-52`), the **P0-P3**
  taxonomy tagged into the title (`:56`), a mandated overall-correctness verdict (`:60-62`), and the
  output schema (`:69-95`). Loaded at `codex-rs/prompts/src/review_request.rs:9`.
- **Data shape** — `codex-rs/protocol/src/protocol.rs`: `ReviewRequest` (`:3458`), `ReviewOutputEvent
  {findings, overall_correctness, overall_explanation, overall_confidence_score}` (`:3467`),
  `ReviewFinding {title, body, confidence_score: f32, priority: i32, code_location}` (`:3487`),
  `ReviewCodeLocation {absolute_file_path, line_range}` (`:3497`), `ReviewLineRange {start, end}`
  (`:3504`), `ReviewDecision` (`:4120`). `ReviewTarget` is
  `UncommittedChanges | BaseBranch{branch} | Commit{sha,title?} | Custom{instructions}`
  (mirrored at `codex-rs/app-server-protocol/src/protocol/v2/review.rs:43`).
- **Execution** — `codex-rs/core/src/tasks/review.rs`: `start_review_conversation` (`:95`) clones the
  config, **disables WebSearch/Collab/MultiAgentV2** (`:107,111,112`), sets `base_instructions =
  REVIEW_PROMPT` (`:115`), `approval_policy = Never` (`:116`), and runs a one-shot child with
  `final_output_json_schema: None` (`:132`) and `initial_history: None` (`:133`) — a fresh, historyless
  child. `parse_review_output_event` (`:188`) is a tolerant parser: whole-string JSON → first-`{`-to-
  last-`}` substring → wrap the raw text.
- **Wire** — the app-server method is **`review/start`**
  (`codex-rs/app-server-protocol/src/protocol/common.rs:908-911`; params/response
  `…/v2/review.rs:17,31`), with `delivery: Inline | Detached` (`:9-12,25`) and a `reviewThreadId` in the
  response (`:37`). Handler: `codex-rs/app-server/src/request_processors/turn_processor.rs:298`
  (`review_start`), `:1261` (inline), `:1283` (detached). Entry points: `/review` slash command
  (`codex-rs/tui/src/slash_command.rs:89`) and `codex-rs/exec/src/cli.rs:244` (`--uncommitted` /
  `--base <BRANCH>` / `--commit <SHA>`).
- **Render** — `codex-rs/protocol/src/review_format.rs`: `format_location` → `path:start-end` (`:6`),
  `format_review_findings_block` (`:23`), `render_review_output_text` (`:64`) — which **drops
  `overall_correctness` and every confidence score** before the user sees them.
- **Skill-ified variant** — `codex-rs/skills/src/assets/samples/review-agent/SKILL.md` (57 lines),
  injected for *detached* delivery (`turn_processor.rs:1404-1407`). Drops the JSON schema for a text
  contract `[P1] Imperative finding title — path/to/file.rs:line` (`:43`), folds the merge-base ritual
  into prose (`:21-26`), and ends with `No findings.` (`:55`). **(inference)** This is the closest
  existing artifact to what a prompt-driven SDK harness would ship.
- **False friend** — `codex-rs/core/src/guardian/` and our own `CC-to-SDK/app-server/src/posture.ts:4`
  use "review"/`autoReview` for **approval posture** (`approvals_reviewer=auto_review`), not code
  review. Different feature.

### 4.6 `Claude Code Src/` — the TS reference harness

- `Claude Code Src/src/commands/review.ts:9-31` — `LOCAL_REVIEW_PROMPT`, the one place in the repo that
  gets a diff via **`gh`** (`gh pr list` / `gh pr view` / `gh pr diff`). Free-form markdown, no schema.
  `/ultrareview` registered at `:48`; `:45` notes "/review stays purely local".
- `Claude Code Src/src/commands/review/reviewRemote.ts` — the remote "bughunter" path, gated on
  `tengu_review_bughunter_config` (`:180`). Our parity docs call the remote half out of reach
  (`CC-to-SDK/docs/parity/35-mode-remote-server.md:10`).
- `Claude Code Src/src/commands/security-review.ts:6` — `SECURITY_REVIEW_MARKDOWN`.

---

## §5 — What the parity scorecard says today

### 5.1 `docs/parity/appserver.md` — **no review row exists**

The scorecard's denominator is generated by walking four sources — `host/ops.ts` (34 ops),
`bridge/types.ts` (11 verbs), `sessions/index.ts` (7 wrappers), `sdk.d.ts`'s `interface Query`
(27 methods) = 79 walked tokens — plus 9 hand-listed **server-origin** rows, for 88 total
(`CC-to-SDK/docs/parity/appserver.md:16-22,501-506`). Every `review` string in that file is incidental
(a past review round, `:272,280,281,328,419,474`). There is no review row, no gap note about review,
and no planned-status placeholder.

The nine server-origin rows are the precedent that matters: methods that "answer for the SERVER rather
than mirroring a seam", which "no walker can ever produce a row for"
(`CC-to-SDK/docs/parity/appserver.md:461-466`). `fs/read`, `fs/search`, `thread/shellCommand` and
`thread/reopen` all live there (`:490-497`). **(inference)** A review method would be the tenth row of
that same class.

### 5.2 `docs/parity/coverage.md` — review is not a domain; `ReportFindings` is logged as unconsumed drift

- The ten capability domains (`CC-to-SDK/docs/parity/coverage.md:333-342`) contain no review domain.
  The app-server lives inside domain 10 at **~76%** after M3 (`:342`).
- `ReportFindings` appears exactly twice, both times as **declared-but-not-consumed**:
  - `:517-518` — the 0.3.178 → 0.3.211 drift list: "4 native tools (`ReportFindings` **structured
    code-review findings**, `ClaudeDesign`, `RefreshMcpTools`, `ReadMcpResourceDir`)".
  - `:372` — the native-tool row: 37 tools (+4 in 0.3.211 incl. `ReportFindings`), policy "**rely-on,
    not consume**".
  - `:576-577` — probe-candidate closeout: "`ReportFindings` **ALIVE (44)**".
- `full-potential.md:51` carries the same verdict with the consumption mechanic
  (harvest from the `tool_use` input).
- The Claude-Code-command parity row for `/review` reads **provided**, on the grounds that prompt-kind
  commands run inside the spawned CLI or can be replicated as `.claude/commands/*.md`
  (`CC-to-SDK/docs/parity/21a-command-catalog-public.md:8`). **(inference)** That row is about the
  Claude Code *command*, not about a first-class review capability, and it is why review has never
  shown up as a gap.

**Net:** the scorecards say review is (a) not a tracked domain, (b) backed by one probed-alive native
tool we deliberately do not consume, and (c) satisfied at the slash-command level by
submit-as-prompt-turn. Nothing in them claims a review capability exists.

---

## Reuse vs build

| Capability a review needs | Existing seam that covers it | Status |
|---|---|---|
| Run model work with lifecycle, items, interrupt, decisions | `beginTurn` spine, `CC-to-SDK/harness/src/appserver/turns.ts:139-275` | **REUSE — complete** |
| A fresh, fenced, historyless child run | `openSession` / `createHarness`; the fencing recipe already demonstrated at `CC-to-SDK/harness/src/tui/dialogs/explainCommand.ts:129` | **REUSE — complete** |
| Read-only reviewer persona with edit tools removed | `config.agents` + `BUILTIN_AGENTS`' `READONLY_DISALLOW`, `CC-to-SDK/harness/src/config/agents.ts:4,14,19`; `config.agent` for main-thread application, `types.ts:127` | **REUSE — needs a definition, not machinery** |
| Multi-agent fan-out | `forkSubagent` default-on (`config/types.ts:76,162`); `Workflow` opt-in (`types.ts:82`, `tools.ts:6`) | **REUSE — both probed live** |
| Typed findings schema (file/line/severity) | Two candidates already in-repo: SDK-native `ReportFindingsInput` (`sdk-tools.d.ts:771-814`) and the plugin's `review-output.schema.json` | **REUSE — but see the draft-7 constraint** |
| Zod → validated JSON payload | `runStructured<T>()`, `CC-to-SDK/harness/src/structured/run.ts:21-37` | **REUSE — one-shot path only** |
| Schema reaching the engine from a client | `thread/start {config}` unfiltered spread, `CC-to-SDK/harness/src/appserver/server.ts:128-130` → `resolveOptions.ts:55` | **REUSE — already reachable** |
| **Typed payload reaching a client** | — `EngineSession.submit` type erases it (`registry.ts:34`); `onSuccess` ignores it (`turns.ts:236-245`); `turn/completed` has no field (`turns.ts:241-243`) | **MISSING** |
| **Any git/diff acquisition inside the harness** | — nothing in `appserver/`; TUI git is `/diff`'s `git status --short; git diff --stat` (`useChat.ts:1836`) and a worktree count (`worktrees.ts:18`) | **MISSING (as harness code)** — a complete implementation exists as plugin JS at `claude-plugin-codex/plugins/claude-companion/scripts/lib/git.mjs` |
| **A review target vocabulary** (`uncommitted` / `base <ref>` / `commit <sha>` / custom) | — nothing. Codex's is `ReviewTarget`, `codex-rs/protocol/src/protocol.rs:3454`; the plugin's is `resolveReviewTarget`, `git.mjs:134` | **MISSING** |
| Running an arbitrary shell command in the thread's cwd | `thread/shellCommand`, `CC-to-SDK/harness/src/appserver/workspace.ts:225-251` | **REUSE — but display-only** (D-M3-2, `workspace.ts:189-193`): output cannot enter the conversation |
| Reading a file / searching the tree for a client | `fs/read` (`workspace.ts:73`), `fs/search` (`workspace.ts:150`) | **REUSE — complete** |
| Rendering `path:start-end` findings, severity-sorted | `render.mjs:221,261,276-282` (plugin JS); Codex's `review_format.rs:6,23,64` | **REUSE as reference — not as harness code** |
| The rubric / finding bar / attack-surface taxonomy | `codex-rs/prompts/templates/review/rubric.md` (Apache-2.0); `claude-companion/prompts/adversarial-review.md:19-28,38-46` | **REUSE — licence attribution needed for the rubric** |
| **An item type / tool view for a review finding** | — `ToolView` has 9 values, none review-shaped; `toolView("ReportFindings")` falls to `"other"` (`CC-to-SDK/harness/src/appserver/items/types.ts:3,12-24`) | **MISSING** |
| **A notification for review lifecycle** (entered/exited review mode, as Codex emits) | — notifications are not zod-schematized at all; shapes live in code only (`schema/emit.ts` generates from `methodSchemas`, methods only) | **MISSING** |
| **A scorecard row to be honest against** | — no review row in `appserver.md`; no review domain in `coverage.md` | **MISSING** |

---

## Open questions

1. **Does a draft 2020-12 schema actually fail through `outputFormat`, or is it silently ignored?**
   `structured/run.ts:24-26` says the CLI's ajv rejects it with `--json-schema is not a valid JSON
   Schema`, caught live. Yet `CC-to-SDK/app-server/src/handlers.ts:101` passes the plugin's 2020-12
   schema (`review-output.schema.json:2`) straight through, and that plugin has a passing test suite.
   Either the failure is silent there (the plugin never reads `structured_output` anyway,
   `translator.ts:36`), or the two paths differ. **This is probe-shaped and cheap.**
2. **Which findings shape do we adopt, and is the choice free?** Three incompatible shapes are in play:
   SDK-native `{file, line?, summary, failure_scenario, category?, verdict?}`
   (`sdk-tools.d.ts:781-814`); the plugin's `{severity, title, body, file, line_start, line_end,
   confidence, recommendation}` (`review-output.schema.json:28-46`); Codex's
   `{title, body, confidence_score, priority: i32, code_location.line_range}`
   (`codex-rs/protocol/src/protocol.rs:3487-3504`). If `ReportFindings` is the carriage, its shape is
   not ours to choose; if `outputFormat` is, it is. Parity-chase argues for Codex's.
3. **Is `ReportFindings` reachable *and* harvestable through our item mapper?** Probe 44 proved the
   model can call it and that the payload lives in the `tool_use` **input**, not the result
   (`full-potential.md:51`). Our mapper does capture `arguments` on the `ToolCallItem`
   (`items/mapper.ts:59`), so **(inference)** the data may already reach the wire today as an
   undifferentiated `view:"other"` tool call. Unverified.
4. **Can a review turn be fenced at all on an existing thread?** `Session` fixes its options at
   construction (`session.ts:64`) and `turn/start` carries no per-turn config
   (`schema/turns.ts:6`). Codex's answer is a separate historyless child
   (`codex-rs/core/src/tasks/review.rs:132-133`). Whether we can fence in-thread — or must always
   spawn — is unsettled.
5. **Server-collected diff vs model-collected diff.** Route 1 (the model runs `git diff` via `Bash`)
   needs zero new substrate but puts the diff inside the model's own tool budget and makes the
   *reviewed* content non-deterministic. Route 2 (server collects, pastes) needs a git seam and would
   have to breach `thread/shellCommand`'s display-only rule (`workspace.ts:189-193`) or add a sibling.
   The plugin chose route 2 with a size-based fallback to route 1 (`git.mjs:299`, thresholds `:8-9`).
6. **How much of `git.mjs` is portable?** It is plain ESM with no plugin-specific imports in its diff
   half, but it is JS in a plugin workspace, not TypeScript in `harness/src/`. Unmeasured.
7. **Does surfacing `structured_output` on `turn/completed` have a fleet counterpart?** The host wire
   already ships the turn's `result` (`fleetEngine.ts:363-367`), but whether it also carries a
   structured payload is unread here, and the fleet event layer is the sole turn-lifecycle owner for
   that origin (`turns.ts:301-317`). A widening that works in-process may not work adopted.
8. **Where does a review row belong on the scorecard?** `appserver.md`'s walked-token denominator
   cannot produce one (`:16-22`), so it would be a tenth server-origin row (`:461-466`) — but
   `coverage.md` has no review domain at all, and the `/review` command row already reads "provided"
   (`21a-command-catalog-public.md:8`). Adding a capability without correcting that row would leave two
   documents disagreeing.
9. **Licence.** `codex-rs/prompts/templates/review/rubric.md` is Apache-2.0. The codex-review ExecPlan
   flagged that shipping it requires a NOTICE file. Unresolved for this repo.
