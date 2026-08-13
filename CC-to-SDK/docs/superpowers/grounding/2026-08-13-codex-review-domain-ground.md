# Codex "review" domain — grounding (2026-08-13)

Source of truth: this worktree's `codex-rs/` tree. Every claim below carries a `path:line`
citation relative to the repo root. Where a statement is inference rather than something the
source states, it is prefixed **[inference]**. Where the source is silent, it appears in the
"Open questions" section rather than being guessed at.

Read this before designing an equivalent for `CC-to-SDK/harness/src/appserver/`.

---

## 0. TL;DR

- The app-server review domain is **one request method**: `review/start`
  (`codex-rs/app-server-protocol/src/protocol/common.rs:908-912`). There is no
  `review/cancel`, no `review/list`, no review-specific notification method.
- Review has **no notification stream of its own**. It reuses the ordinary turn/item stream
  (`turn/started`, `item/started`, `item/completed`, `turn/completed`, plus `thread/started`
  for detached delivery). The review's start and end are carried as two ordinary thread items,
  `enteredReviewMode` and `exitedReviewMode`
  (`codex-rs/app-server-protocol/src/protocol/v2/item.rs:381-392`).
- The **unit of work is a target descriptor, not a diff**: working tree, base branch, one commit,
  or free-form instructions (`codex-rs/app-server-protocol/src/protocol/v2/review.rs:43-65`).
  Codex does **not** compute or inject the diff. It writes an English prompt naming the target
  and lets the reviewing agent run `git` through its own shell tool
  (`codex-rs/prompts/src/review_request.rs:59-99`). The only host-side git work is a
  `git merge-base` lookup for the base-branch case
  (`codex-rs/git-utils/src/branch.rs:15-48`).
- Findings **are** structured internally — title, body, confidence, priority, absolute file path,
  inclusive line range (`codex-rs/protocol/src/protocol.rs:3466-3507`) — but that structure is
  **flattened to a single plain-text string before it reaches any app-server client**
  (`codex-rs/app-server-protocol/src/protocol/item_builders.rs:45-49`,
  `codex-rs/app-server-protocol/src/protocol/v2/item.rs:932-935`). `ReviewOutputEvent` and
  `ReviewFinding` do not appear anywhere in the generated v2 JSON schema (verified by grep over
  `codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.v2.schemas.json`).
- It is **a distinct agent loop, not one model turn**: a child session with its own system
  prompt, its own model, its own tool loop, whose events are re-stamped onto the parent turn
  (`codex-rs/core/src/tasks/review.rs:95-138`, `codex-rs/core/src/session/mod.rs:1824-1848`).

---

## 1. Protocol surface

### 1.1 Requests

| Method | Params | Result | Notes |
|---|---|---|---|
| `review/start` | `v2::ReviewStartParams` | `v2::ReviewStartResponse` | Declared at `codex-rs/app-server-protocol/src/protocol/common.rs:908-912`. Not marked `#[experimental(...)]` (contrast the `thread/realtime/*` arms directly above at `common.rs:890-907`), so it is a stable v2 method. `serialization: thread_id(params.thread_id)` serializes requests per thread. Dispatched at `codex-rs/app-server/src/message_processor.rs:1345-1347` into `TurnProcessor::review_start` (`codex-rs/app-server/src/request_processors/turn_processor.rs:298-306`). Returns immediately; see §2.3. |

That is the entire review request surface. Grep for `review/` over
`codex-rs/app-server-protocol/src/protocol/common.rs` yields exactly this one line.

Generated artifacts confirming the wire name:
`codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts:99` (`"method": "review/start"`),
`codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.v2.schemas.json:2791`,
`codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json:1631`,
`codex-rs/sdk/python/src/openai_codex/generated/v2_all.py:6774,7798`.

### 1.2 Request/response types

| Type | Fields | Citation |
|---|---|---|
| `ReviewStartParams` | `threadId: string`, `target: ReviewTarget`, `delivery?: ReviewDelivery` (`#[serde(default)]`, nullable-optional in TS) | `codex-rs/app-server-protocol/src/protocol/v2/review.rs:17-26` |
| `ReviewStartResponse` | `turn: Turn`, `reviewThreadId: string` | `codex-rs/app-server-protocol/src/protocol/v2/review.rs:31-38` |
| `ReviewDelivery` | `inline` \| `detached` (snake_case on the wire; mirrored from core via the `v2_enum_from_core!` macro) | `codex-rs/app-server-protocol/src/protocol/v2/review.rs:8-12`; core enum `codex-rs/protocol/src/protocol.rs:3422-3427` |
| `ReviewTarget` | internally tagged on `type`: `uncommittedChanges` \| `baseBranch{branch}` \| `commit{sha, title?}` \| `custom{instructions}` | `codex-rs/app-server-protocol/src/protocol/v2/review.rs:43-65`; core twin `codex-rs/protocol/src/protocol.rs:3429-3454` |
| `Turn` (returned) | `id`, `items: ThreadItem[]`, `itemsView`, `status`, `error`, `startedAt`, `completedAt`, `durationMs` | `codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs:256`; generated TS `codex-rs/app-server-protocol/schema/typescript/v2/Turn.ts` |

`reviewThreadId` equals the request's `threadId` for inline delivery and is a **new** thread id for
detached delivery (doc comment at `codex-rs/app-server-protocol/src/protocol/v2/review.rs:33-37`;
asserted at `codex-rs/app-server/tests/suite/v2/review.rs:132`).

### 1.3 Notifications the review drives

There is no `review/*` notification. Review reuses generic ones:

| Notification | When | Citation |
|---|---|---|
| `turn/started` | Start of the review turn — **but not emitted by the review task itself**; see §2.4 for the caveat | method declared `codex-rs/app-server-protocol/src/protocol/common.rs:1704`; documented for review at `codex-rs/app-server/README.md:1172` |
| `item/started` with `ThreadItem::EnteredReviewMode` | Immediately after the review child is spawned | emitted `codex-rs/core/src/session/review.rs:176-182`; method `common.rs:1710`; mapped `codex-rs/app-server/src/bespoke_event_handling.rs:974` |
| `item/started` / `item/completed` for ordinary items (command execution, file change, reasoning, MCP calls) | Throughout, because the review child's events are forwarded onto the parent turn | forwarding `codex-rs/core/src/tasks/review.rs:174-176`; test observing a `CommandExecution` item on the review turn `codex-rs/app-server/tests/suite/v2/review.rs:262-272` |
| `item/started` + `item/completed` with `ThreadItem::ExitedReviewMode` | Review finished or aborted | emitted `codex-rs/core/src/tasks/review.rs:246-251` |
| `turn/completed` | End of the review turn | method `common.rs:1706`; observed `codex-rs/app-server/tests/suite/v2/review.rs:281,432,561` |
| `thread/started` | **Detached delivery only**, for the new review thread; deliberately without a preceding `thread/status/changed` | `codex-rs/app-server/src/request_processors/turn_processor.rs:1351-1354`; asserted `codex-rs/app-server/tests/suite/v2/review.rs:404-427`; documented `codex-rs/app-server/README.md:474` |
| `error` | Asynchronous failure of prompt resolution (e.g. base-branch target in a non-git directory) after `review/start` already returned success | `codex-rs/core/src/session/handlers.rs:701-711`; method `common.rs:1686` |

Server **requests** (server→client, needing a reply) can also fire during a review: the review
child's tool calls route approvals back through the parent, so
`ServerRequest::CommandExecutionRequestApproval` is observed with `params.turn_id` equal to the
review turn id (`codex-rs/app-server/tests/suite/v2/review.rs:251-260`; approval re-routing at
`codex-rs/core/src/codex_delegate.rs:319-345`). Note that test is currently
`#[ignore = "TODO(owenlin0): flaky"]` (`codex-rs/app-server/tests/suite/v2/review.rs:195`).

The **legacy** `EventMsg::EnteredReviewMode` / `EventMsg::ExitedReviewMode` events
(`codex-rs/protocol/src/protocol.rs:1453-1457`, payloads at `:1903-1926`) are explicitly dropped
by the app-server; v2 clients see only the `TurnItem` lifecycle
(`codex-rs/app-server/src/bespoke_event_handling.rs:872-877`).

### 1.4 The two review thread items (the client-visible payload)

```rust
EnteredReviewMode { id: String, review: String },
ExitedReviewMode  { id: String, review: String },
```
`codex-rs/app-server-protocol/src/protocol/v2/item.rs:381-392`.

Conversion from core items (`codex-rs/app-server-protocol/src/protocol/v2/item.rs:928-935`):

- `EnteredReviewMode.review` = the core item's `user_facing_hint` — a short label such as
  `"current changes"`, `"changes against 'main'"`, `"commit 1234567: Tidy UI colors"`
  (`codex-rs/prompts/src/review_request.rs:110-124`).
- `ExitedReviewMode.review` = `review_output_text(...)`, i.e. the **rendered plain text** of the
  structured findings, or `REVIEW_FALLBACK_MESSAGE` when there is no output
  (`codex-rs/app-server-protocol/src/protocol/item_builders.rs:45-49`).

Wire example, from `codex-rs/app-server/README.md:1191-1202`:

```json
{ "method": "item/completed", "params": { "item": {
    "type": "exitedReviewMode", "id": "turn_900",
    "review": "Looks solid overall...\n\n- Prefer Stylize helpers — app.rs:10-20\n  ..." } } }
```

The README states this explicitly at `codex-rs/app-server/README.md:1204`: the `review` string
"already bundles the overall explanation plus a bullet list for each structured finding".

### 1.5 Structured finding types (core-internal, NOT on the app-server wire)

| Type | Shape | Citation |
|---|---|---|
| `ReviewOutputEvent` | `findings: Vec<ReviewFinding>`, `overall_correctness: String`, `overall_explanation: String`, `overall_confidence_score: f32` | `codex-rs/protocol/src/protocol.rs:3466-3472` (`Default` impl `:3474-3483`) |
| `ReviewFinding` | `title: String`, `body: String`, `confidence_score: f32`, `priority: i32`, `code_location: ReviewCodeLocation` | `codex-rs/protocol/src/protocol.rs:3486-3493` |
| `ReviewCodeLocation` | `absolute_file_path: PathBuf`, `line_range: ReviewLineRange` | `codex-rs/protocol/src/protocol.rs:3496-3500` |
| `ReviewLineRange` | `start: u32`, `end: u32` (inclusive) | `codex-rs/protocol/src/protocol.rs:3503-3507` |
| `ReviewRequest` (core SQ payload) | `target: ReviewTarget`, `user_facing_hint: Option<String>` | `codex-rs/protocol/src/protocol.rs:3456-3463` |
| `Op::Review` (core submission op) | `{ review_request: ReviewRequest }` | `codex-rs/protocol/src/protocol.rs:670-671` |

Rendering to text: `codex-rs/protocol/src/review_format.rs`.
`format_review_findings_block` (`:23-58`) emits a header (`"Full review comments:"` for >1
finding, `"Review comment:"` otherwise, `:31-35`), then per finding a line
`- {title} — {path}:{start}-{end}` (`:49`, location helper `:6-11`) with the body indented two
spaces (`:52-54`). `render_review_output_text` (`:64-82`) joins the trimmed
`overall_explanation` and the findings block with a blank line, falling back to
`REVIEW_FALLBACK_MESSAGE = "Reviewer failed to output a response."` (`:14`) when both are empty.

Note what is **lost** in that rendering: `confidence_score`, `overall_confidence_score`,
`overall_correctness`, and the numeric `priority` field (the priority survives only if the model
followed the rubric's instruction to prefix the title with `[P1]` etc. —
`codex-rs/prompts/templates/review/rubric.md:56`).

### 1.6 Adjacent-but-distinct: approvals auto-review ("guardian")

Grepping for "review" also surfaces a second, unrelated domain that must not be conflated with
code review. Two notifications exist for it:

| Notification | Payload | Citation |
|---|---|---|
| `item/autoApprovalReview/started` | `ItemGuardianApprovalReviewStartedNotification` | `codex-rs/app-server-protocol/src/protocol/common.rs:1711`; struct `codex-rs/app-server-protocol/src/protocol/v2/item.rs:1252-1274` |
| `item/autoApprovalReview/completed` | `ItemGuardianApprovalReviewCompletedNotification` | `codex-rs/app-server-protocol/src/protocol/common.rs:1712`; struct `codex-rs/app-server-protocol/src/protocol/v2/item.rs:1281-1307` |

Both are marked `[UNSTABLE] ... This shape is expected to change soon`
(`codex-rs/app-server-protocol/src/protocol/v2/item.rs:1250-1251`). This is the risk-assessment
subagent that decides approval requests when `approvals_reviewer = "auto_review"`
(`codex-rs/protocol/src/config_types.rs:159-182`), implemented in `codex-rs/core/src/guardian/`.
It has nothing to do with `review/start`. It is out of scope for this document beyond noting that
it exists and will pollute any `grep -i review`.

---

## 2. Runtime behavior and lifecycle

### 2.1 Two deliveries, two entirely different mechanisms

`review_start_inner` (`codex-rs/app-server/src/request_processors/turn_processor.rs:1377-1419`)
validates the target, then branches on `delivery.unwrap_or(Inline)` (`:1391`).

**Inline** (`start_inline_review`, `turn_processor.rs:1261-1281`) submits `Op::Review` to the
existing thread (`:1269-1276`). Nothing else. Core takes over from
`codex-rs/core/src/session/handlers.rs:854-857`.

**Detached** (`start_detached_review`, `turn_processor.rs:1283-1375`) does not use `Op::Review` at
all. It rewrites the prompt to point at a bundled skill —

```rust
format!("Use [$review-agent]({}) for this review.\n\n{target_prompt}", review_skill_path.display())
```
(`turn_processor.rs:1403-1409`, path `CODEX_HOME/skills/.system/review-agent/SKILL.md`) — and then
starts an ordinary forked thread with an ordinary turn via `AgentRunner::start`
(`turn_processor.rs:1309-1320`), which delegates to `ThreadManager::spawn_subagent` and forks the
parent's **full history**. That is why detached delivery is refused for paginated parent threads
(`turn_processor.rs:1292-1299`, comment at `:1289-1291`). The README confirms the design intent:
"Internally, this is a normal forked thread and turn whose prompt mentions the bundled
`$review-agent` skill, so normal turn steering, tool, permission, and item-stream behavior
applies" (`codex-rs/app-server/README.md:1168`).

The skill asset is `codex-rs/skills/src/assets/samples/review-agent/SKILL.md` (57 lines), embedded
with `include_dir!` at `codex-rs/skills/src/lib.rs:22` and materialized to
`CODEX_HOME/skills/.system/` on startup by `install_system_skills`
(`codex-rs/skills/src/lib.rs:29-68`). Its output contract is **markdown**, not JSON:
`[P1] Imperative finding title — path/to/file.rs:line` (`SKILL.md:41-53`).

Detached delivery also clones the **app-server's** config rather than the parent thread's
(`turn_processor.rs:1300-1303`), applying `review_model` if set. Per-thread settings overrides on
the parent do not carry over.

The rest of §2 describes the **inline** path, which is the interesting one.

### 2.2 The unit of work: a target descriptor, not a diff

`review_request_from_target` (`turn_processor.rs:374-436`) trims and validates the target, derives
the display hint via `codex_core::review_prompts::user_facing_hint` (`:429`), and hands a
`ReviewRequest` to core. Core resolves it into a prompt string in
`codex-rs/prompts/src/review_request.rs:59-99`:

- `UncommittedChanges` → a fixed sentence: *"Review the current code changes (staged, unstaged,
  and untracked files) and provide prioritized findings."* (`review_request.rs:18,61`).
- `BaseBranch { branch }` → calls `merge_base_with_head(cwd, branch)` (`review_request.rs:63`). On
  success it renders *"…The merge base commit for this comparison is `{{merge_base_sha}}`. Run
  `git diff {{merge_base_sha}}` to inspect the changes…"* (`review_request.rs:21`). On `Ok(None)`
  it falls back to a prompt that tells the model to compute the merge base itself with
  `git merge-base HEAD "$(git rev-parse --abbrev-ref "{{branch}}@{upstream}")"`
  (`review_request.rs:20,71-76`).
- `Commit { sha, title }` → *"Review the code changes introduced by commit `{{sha}}`…"*
  (`review_request.rs:31-32,78-90`).
- `Custom { instructions }` → the user's text verbatim; empty text errors with
  `"Review prompt cannot be empty"` (`review_request.rs:91-97`).

**The diff is never computed or injected by the host.** The resolved prompt string is the whole
seed message: `codex-rs/core/src/session/review.rs:42` and `:157-165` build exactly one
`UserInput::Text` from it, and the delegate is started with `initial_history: None`
(`codex-rs/core/src/tasks/review.rs:133`) and `additional_context: Default::default()`
(`codex-rs/core/src/codex_delegate.rs:242`). The integration test asserts the outbound request's
user message contains only the raw review prompt
(`codex-rs/core/tests/suite/review.rs:783-793`, message: *"user message should only contain the
raw review prompt"*).

The single piece of host-side git plumbing is `merge_base_with_head`
(`codex-rs/git-utils/src/branch.rs:15-48`), which prefers the branch's upstream when the remote is
ahead (`:30-35`) and shells out to the `git` binary — `Command::new("git")` at
`codex-rs/git-utils/src/operations.rs:113`, with `-c core.hooksPath=<disabled>` prepended
(`:105-108`). `gix` is a dependency of the crate but is confined to the unrelated baseline/snapshot
feature in `codex-rs/git-utils/src/baseline.rs`.

### 2.3 `review/start` returns immediately with a synthetic turn

`build_review_turn` (`turn_processor.rs:1219-1244`) fabricates a `Turn` with `status:
InProgress`, `itemsView: NotLoaded`, null timestamps, and exactly one synthetic
`ThreadItem::UserMessage` whose text is the display hint (inline) or the full skill-referencing
prompt (detached). `emit_review_started` (`turn_processor.rs:1246-1259`) sends the response before
any streaming begins. `review_start` returns `Ok(None)` so the framework does not send a second
response (`turn_processor.rs:298-306`).

Tests assert the pre-streaming shape: `codex-rs/app-server/tests/suite/v2/review.rs:134-146`
(inline) and `:386-398` (detached).

So the client contract is the same as `turn/start`: fire and follow the notification stream
(`codex-rs/app-server/README.md:81,188`).

### 2.4 What actually runs: a child session with its own loop

`Op::Review` → `review()` (`codex-rs/core/src/session/handlers.rs:680-712`) → `spawn_review_thread`
(`codex-rs/core/src/session/review.rs:5-183`), which builds a dedicated `TurnContext` and calls
`sess.spawn_task(tc, input, ReviewTask::new())` (`session/review.rs:173`), then emits the
`EnteredReviewMode` item (`:176-182`).

`ReviewTask::run` (`codex-rs/core/src/tasks/review.rs:52-88`) starts a **child Codex session**
through `run_codex_thread_one_shot` (`codex-rs/core/src/codex_delegate.rs:206-217`), tagged
`SubAgentSource::Review` (`tasks/review.rs:131`; enum at
`codex-rs/protocol/src/protocol.rs:2844`). Config differences applied to the child
(`tasks/review.rs:102-122`):

- `base_instructions = REVIEW_PROMPT` — the 95-line rubric compiled in with `include_str!`
  (`codex-rs/prompts/src/review_request.rs:9`, asset
  `codex-rs/prompts/templates/review/rubric.md`).
- `web_search_mode = Disabled` (`:105-110`); `Feature::Collab` and `Feature::MultiAgentV2`
  disabled (`:111-112`); additionally `WebSearchRequest`, `WebSearchCached`, `Goals` disabled at
  `codex-rs/core/src/session/review.rs:22-26`.
- `permissions.approval_policy = Constrained::allow_only(AskForApproval::Never)` (`:116`).
- `model = config.review_model` or the parent's slug (`:118-122`; config field
  `codex-rs/core/src/config/mod.rs:626`, TOML key `codex-rs/config/src/config_toml.rs:154`).

Nothing disables shell/exec — that is the point: the reviewer reads the repository with the same
tool loop a normal turn uses. This is **many model turns**, not one.

Event handling — `process_review_events` (`codex-rs/core/src/tasks/review.rs:140-181`) forwards
every child event onto the parent session (`:174-176`) **except**:

- assistant messages, which are buffered so the final one is dropped (`:148-153`),
- `ItemCompleted(TurnItem::AgentMessage)` and `AgentMessageContentDelta` (`:154-161`),
- `TurnComplete`, whose `last_agent_message` is parsed into the review output (`:162-169`),
- `TurnAborted`, which returns `None` (`:170-173`).

Forwarded events are re-stamped with the **parent review turn's** `sub_id` by
`Session::send_event` (`codex-rs/core/src/session/mod.rs:1824-1848`), which is why the review's
command executions and approvals appear on the parent turn. Tests confirm assistant text is
suppressed: `codex-rs/core/tests/suite/review.rs:420` (`review_filters_agent_message_related_events`)
and `:482` (`review_does_not_emit_agent_message_on_structured_output`).

**`turn/started` caveat.** `ReviewTask` does not emit `EventMsg::TurnStarted` itself — a `TODO`
says so explicitly (`codex-rs/core/src/session/review.rs:170-172`), `start_task`'s
`emit_turn_start_lifecycle` only runs extension hooks
(`codex-rs/core/src/tasks/lifecycle.rs:10-28`), and the only emitters are
`codex-rs/core/src/tasks/regular.rs:49`, `codex-rs/core/src/tasks/user_shell.rs:117`, and the
compact paths. **[inference]** The `turn/started` the README promises
(`codex-rs/app-server/README.md:1172`) reaches the client because the *child's* `TurnStarted`
falls through the catch-all forward arm (`tasks/review.rs:174-176`) and is re-stamped with the
parent turn id. No test in `codex-rs/app-server/tests/suite/v2/review.rs` asserts `turn/started`
(grep: no hits), and there is a protocol test named
`review_mode_items_replay_without_turn_started`
(`codex-rs/app-server-protocol/src/protocol/thread_history.rs:1832-1889`).

### 2.5 Output parsing: schema-less, with a text fallback

The rubric asks for a specific JSON object (`codex-rs/prompts/templates/review/rubric.md:69-95`,
including `* Do not wrap the JSON in markdown fences or extra prose.` at `:91`), but **no
structured-output schema is sent to the model**: `final_output_json_schema` is `None` at both call
sites (`codex-rs/core/src/tasks/review.rs:132`, `codex-rs/core/src/session/review.rs:146`;
asserted at `codex-rs/core/tests/suite/review.rs:881`). Contrast the guardian feature, which does
pass a schema (`codex-rs/core/src/guardian/review_session.rs:813`).

`parse_review_output_event` (`codex-rs/core/src/tasks/review.rs:188-203`) is a three-step ladder:
whole-string JSON parse (`:189`), then the substring between the first `{` and last `}` (`:192-198`),
then a fallback that stuffs the raw text into `overall_explanation` with an empty findings list
(`:199-202`). Test: plain text `"just plain text"` yields
`ReviewOutputEvent { overall_explanation: "just plain text", ..Default::default() }`
(`codex-rs/core/tests/suite/review.rs:370-418`).

Because `ReviewFinding::priority` is a bare `i32` with no `#[serde(default)]`
(`codex-rs/protocol/src/protocol.rs:3491`) while the rubric tells the model the field is optional
(`rubric.md:58,78`), an omitted `priority` fails deserialization for the whole payload and drops
the entire review to the raw-text fallback. **[inference]** — the two files are inconsistent; no
test covers the omitted-priority case.

### 2.6 Finalization and persistence

`exit_review_mode` (`codex-rs/core/src/tasks/review.rs:207-271`) runs on both success and abort:

1. Records a synthetic **user** message into the parent's conversation history containing the
   rendered review wrapped in `<user_action>` XML (`:212-244`; templates
   `codex-rs/prompts/templates/review/exit_success.xml` and `exit_interrupted.xml`, rendered by
   `codex-rs/prompts/src/review_exit.rs:16-24`).
2. Emits `EnteredReviewMode`'s counterpart, the `ExitedReviewMode` turn item, as started then
   completed (`:246-251`).
3. Records a plain-text **assistant** message with the same review text (`:252-265`).
4. Forces `session.ensure_rollout_materialized()` because a review can be the very first turn on a
   thread (`:267-270`).

Consequence: the review result lands in the parent's model context and rollout, so later turns can
reference it (`codex-rs/core/tests/suite/review.rs:837` —
`review_history_surfaces_in_parent_session`). The reviewer's *own* conversation does not
(`codex-rs/core/tests/suite/review.rs:659` — `review_input_isolated_from_parent_history`).

### 2.7 Cancellation

There is no review-specific cancel. The generic `turn/interrupt`
(`turn_processor.rs:1421-1484`) applies: it validates `turn_id` against the active turn
(`:1438-1449`), submits `Op::Interrupt`, and replies when `TurnAborted` arrives.

Core guarantees ordering: `ReviewTask::abort` calls `exit_review_mode(session, None, ctx)`
(`codex-rs/core/src/tasks/review.rs:90-92`), and the test
`abort_review_task_emits_exited_then_aborted_and_records_history`
(`codex-rs/core/src/session/tests.rs:10810-10870`) asserts `ExitedReviewMode` with
`review_output: None` is emitted **before** `TurnAborted`. `ReviewTask::run` skips the exit if the
token is already cancelled, avoiding a double emission (`tasks/review.rs:84-86`).
An interrupted review leaves the note *"User initiated a review task, but was interrupted."* in
the parent rollout (`codex-rs/core/tests/suite/review.rs:799-828`).

No app-server-level test interrupts a review
(`codex-rs/app-server/tests/suite/v2/turn_interrupt.rs` has no review case).

### 2.8 Steering is refused

A review turn is a `NonSteerableTurnKind::Review`
(`codex-rs/protocol/src/protocol.rs:1756-1760`). `turn/steer` against it fails with
`"cannot steer a review turn"` and `CodexErrorInfo::ActiveTurnNotSteerable { turnKind: "review" }`
(`turn_processor.rs:984-989`; error variant `codex-rs/protocol/src/protocol.rs:1790-1796`;
documented `codex-rs/app-server/README.md:1132`). `spawn_task` also aborts any in-flight task first
(`codex-rs/core/src/tasks/mod.rs:276-285`), and idle-triggered automatic turns are rejected while a
review runs (`codex-rs/core/src/codex_thread.rs:381-383`).

### 2.9 Errors and preconditions

Synchronous JSON-RPC errors from `review/start`:

| Condition | Code | Citation |
|---|---|---|
| Malformed thread id | invalid_request (-32600) | `turn_processor.rs:327-328` |
| Thread not found | invalid_request | `turn_processor.rs:330-334` |
| Blank `baseBranch.branch` | invalid_request | `turn_processor.rs:379-385`; test `app-server/tests/suite/v2/review.rs:289-322` |
| Blank `commit.sha` | invalid_request | `turn_processor.rs:386-390`; test `:454-488` |
| Blank `custom.instructions` | invalid_request | `turn_processor.rs:396-402`; test `:491-527` |
| Detached + paginated parent | invalid_request | `turn_processor.rs:1292-1299`; test `:43-84` |
| Detached prompt over `MAX_USER_INPUT_TEXT_CHARS` | invalid_params with `max_chars`/`actual_chars` | `turn_processor.rs:1410-1413`, `:456-466` |
| Core submit failure (inline) | internal_error | `turn_processor.rs:1276` |
| Agent runner failure (detached) | internal_error | `turn_processor.rs:1320` |

**There is no "not a git repo" precondition on the request.** Git is touched only for
`baseBranch`, only during prompt resolution inside core, and a failure there surfaces
asynchronously as an `error` notification after `review/start` has already succeeded
(`codex-rs/core/src/session/handlers.rs:701-711`). An unresolvable branch is not an error at all —
`merge_base_with_head` returns `Ok(None)` and the backup prompt is used
(`codex-rs/prompts/src/review_request.rs:71-76`).

### 2.10 Other entry points into the same domain

- TUI: `/review` opens a preset picker (`codex-rs/tui/src/chatwidget/review_popups.rs:6-61`) with
  branch and commit sub-pickers backed by `codex-git-utils`
  (`review_popups.rs:63-126`; helpers at `codex-rs/git-utils/src/info.rs:320,861,891`). It always
  sends `delivery: Inline` (`codex-rs/tui/src/app_server_session.rs:1202-1218`).
- Headless: `codex exec review` / `codex review` with `--uncommitted` / `--base` / `--commit`
  / `--title` / positional prompt (`codex-rs/exec/src/cli.rs:243-276`;
  `codex-rs/cli/src/main.rs:129-130,284-290,1032-1045`). It calls `review/start` with
  `delivery: None` and then synthesizes a `turn/started` notification locally
  (`codex-rs/exec/src/lib.rs:927-951`).

---

## 3. What would be hard to port to a Claude-SDK engine

### 3.1 Portable — this is protocol shape only

These carry no Codex-internal dependency and can be adopted essentially verbatim into
`CC-to-SDK/harness/src/appserver/`:

- **The method itself.** One request, `review/start`, params `{threadId, target, delivery?}`,
  result `{turn, reviewThreadId}`. Our server already has the `turn/start` idiom of returning an
  in-progress turn immediately (`CC-to-SDK/harness/src/appserver/server.ts:342`), so the response
  contract is a direct fit.
- **The `ReviewTarget` union.** Four variants, internally tagged on `type`, all plain data
  (`codex-rs/app-server-protocol/src/protocol/v2/review.rs:43-65`). Nothing engine-specific.
- **Validation and error mapping.** Trim-and-reject-empty for branch/sha/instructions, plus
  thread-not-found (`turn_processor.rs:374-436`). Mechanical.
- **The two thread items.** `enteredReviewMode {id, review}` and `exitedReviewMode {id, review}`
  are just strings (`codex-rs/app-server-protocol/src/protocol/v2/item.rs:381-392`). Our item
  layer (`CC-to-SDK/harness/src/appserver/items/`) can carry them with no new machinery.
- **Reusing the ordinary notification stream** rather than inventing review notifications. Our
  `thread/subscribe` fan-out already does this.
- **The finding→text renderer.** `codex-rs/protocol/src/review_format.rs` is 82 lines of pure
  string formatting with no dependencies; a direct port.
- **The rubric prompt.** `codex-rs/prompts/templates/review/rubric.md` (95 lines) and the
  `review-agent` skill (`codex-rs/skills/src/assets/samples/review-agent/SKILL.md`, 57 lines) are
  static text. They are model-agnostic in form, though not necessarily calibrated for Claude
  (see §3.3).
- **The base-branch merge-base lookup.** Three `git` subprocess calls
  (`codex-rs/git-utils/src/branch.rs:15-48`, `codex-rs/git-utils/src/operations.rs:92-114`) with
  the upstream-ahead preference. Trivially reimplemented.

### 3.2 Codex-internal — needs a different mechanism on our engine

| Codex mechanism | Why it does not port | What it would need on the Claude Agent SDK |
|---|---|---|
| **`Op::Review` as a first-class submission op** distinct from `Op::UserInput` (`codex-rs/protocol/src/protocol.rs:670-671`), dispatched into a `SessionTask` implementation with its own `TaskKind` (`codex-rs/core/src/tasks/review.rs:43-50`) | Codex's turn machinery is a task trait with `run`/`abort`/`kind`. The SDK gives us one `query()` stream per turn; we have no equivalent task taxonomy. | Either a dedicated review path in our turn layer (`CC-to-SDK/harness/src/appserver/turns.ts`) that models "this turn is a review", or expressing review as a normal turn whose prompt happens to be the review prompt. The latter is what Codex's own **detached** path already does — which is the strong hint about which direction ports cheaply. |
| **The child-session delegate** — a second full Codex session sharing the parent's MCP manager, skills service, plugins, auth, and exec policy, whose events are forwarded and re-stamped onto the parent turn (`codex-rs/core/src/codex_delegate.rs:81-136`, `codex-rs/core/src/tasks/review.rs:95-138`, re-stamping at `codex-rs/core/src/session/mod.rs:1824-1848`) | This is the single deepest coupling. It requires being able to run a nested agent session with a *different system prompt and model*, share the parent's service handles, and splice its event stream into the parent's turn under the parent's turn id. | The SDK's subagent/fork surface is the nearest analogue, but subagent events are not ours to re-stamp onto a parent turn. Realistic options: (a) run the review as its own session and expose it as a separate thread — i.e. adopt only `delivery: detached`; (b) run it as a normal turn on the same thread with an appended system prompt; (c) re-stamp in our own fan-out layer. Option (a) is closest to something we can guarantee. |
| **Per-turn `base_instructions` override** (`codex-rs/core/src/tasks/review.rs:115`) — replacing the whole system prompt for one turn | Codex rebuilds instructions per turn from `TurnContext`. Our engine's system prompt is bound at session/query construction. | Either a fresh session for the review (again pointing at detached-style delivery) or `systemPrompt` append at query time, which changes the semantics: Codex *replaces*, we would *append*. |
| **Per-turn feature clamps** — disabling web search, collab, multi-agent, goals for the review only (`codex-rs/core/src/tasks/review.rs:105-112`, `codex-rs/core/src/session/review.rs:22-26`) | Codex's `Constrained<T>` config wrapper locks a value so the delegate cannot re-enable it (`codex-rs/config/src/constraint.rs:104-119`). | Per-query `allowedTools`/`disallowedTools`, which is weaker: it is a filter, not a locked constraint. |
| **`approval_policy = Constrained::allow_only(Never)`** for the reviewer (`codex-rs/core/src/tasks/review.rs:116`) | Depends on Codex's sandbox + approval-policy model. | Our permission-mode/broker layer (`CC-to-SDK/harness/src/appserver/broker.ts`). Semantically close, but see the open question in §4 about whether this clamp actually holds. |
| **Sandboxed shell as the diff-reading mechanism** — the whole design assumes the reviewer can freely run `git diff`, `git log`, `git show` under Codex's per-OS sandbox (`codex-rs/sandboxing/`, `codex-rs/execpolicy/`) | The reviewer *is* a shell agent. Without a comparable execution surface the target descriptors are meaningless. | We have Bash. The gap is not capability but *permission posture*: Codex runs the reviewer with approvals off inside a sandbox; we would need an equivalent read-only-ish posture that does not prompt per command. |
| **`spawn_subagent` full-history fork** for detached delivery (`turn_processor.rs:1309-1320`) | Forking a thread's complete history into a new thread is a Codex `ThreadManager` primitive. | We have `thread/fork` (`CC-to-SDK/harness/src/appserver/server.ts:273`) and SDK resume, so this is closer than it looks — but our fork semantics need checking against "full history, including model context". |
| **System-skill materialization** — embedding `review-agent/SKILL.md` in the binary and writing it to `CODEX_HOME/skills/.system/` at startup, then referencing it by absolute path in the prompt (`codex-rs/skills/src/lib.rs:22,29-68`; prompt at `turn_processor.rs:1403-1409`) | Requires a bundled-skill install pipeline and a `$skill-name` prompt convention. | We already have a skills surface; this is a packaging decision, not a blocker. |
| **Rollout persistence of a synthetic user+assistant message pair** (`codex-rs/core/src/tasks/review.rs:233-265`) plus forced materialization (`:267-270`) | Codex writes directly into its rollout JSONL and in-memory history. | We would need the SDK equivalent of injecting a user/assistant exchange into session history so later turns can reference the review. This is the mechanism that makes "review, then ask about it" work, and it is not free on our side. |
| **Non-steerable turn kind** (`codex-rs/protocol/src/protocol.rs:1756-1760`, refusal at `turn_processor.rs:984-989`) | Requires the turn layer to know a turn's kind and refuse steering for it. | Our `turn/steer` (`CC-to-SDK/harness/src/appserver/server.ts:382`) would need a per-turn kind tag. Small but real. |
| **`x-openai-subagent: review` request header** on inline review calls (`codex-rs/core/tests/suite/review.rs:200-203`) | Provider-specific telemetry/routing. | Not applicable; drop it. |

### 3.3 Judgement calls the port forces, which the source cannot answer

- **Whether to expose structured findings.** Codex deliberately does not: the app-server wire
  carries only rendered text (§1.4). If we want `{title, body, priority, file, lineRange}` on the
  wire, that is a *divergence from Codex*, not a port of it. It is also the more useful shape for
  any client that wants to render inline comments, and our engine can request structured output
  more reliably than Codex's schema-less prompt-and-hope
  (`codex-rs/core/src/tasks/review.rs:132`, `:188-203`).
- **Whether to adopt `delivery: inline` at all.** Inline is where every hard coupling lives
  (child session, event re-stamping, per-turn instruction replacement). Detached is an ordinary
  forked thread running an ordinary turn. **[inference]** Adopting detached-only would give us the
  same protocol surface at a fraction of the engine work, at the cost of the "review appears in
  this conversation" UX.
- **Prompt calibration.** The rubric is written for a Codex model and encodes an output contract
  the model is expected to honor without a schema. Reusing it verbatim on Claude is a research
  question, not a port question.

---

## 4. Open questions I could not answer from the source

1. **Does the inline review actually emit `turn/started` on the wire?**
   `codex-rs/app-server/README.md:1172` says yes. `codex-rs/core/src/session/review.rs:170-172`
   says the review task does not emit one, and no test in
   `codex-rs/app-server/tests/suite/v2/review.rs` asserts it. My reading of the forward path
   (`tasks/review.rs:174-176` + `session/mod.rs:1824-1848`) suggests the *child's* `TurnStarted` is
   forwarded and re-stamped, but I did not run the server to confirm. Resolving this needs a live
   `review/start` against a real app-server.

2. **Does the reviewer's approval clamp actually hold?**
   `codex-rs/core/src/tasks/review.rs:116` sets
   `approval_policy = Constrained::allow_only(AskForApproval::Never)` on the child config, yet
   `codex-rs/app-server/tests/suite/v2/review.rs:196-286` (config `approval_policy = "untrusted"`)
   expects a `CommandExecutionRequestApproval` to reach the client during a review. Meanwhile
   `codex-rs/core/src/session/review.rs:140` sets the review *TurnContext*'s `approval_policy` from
   the parent. I could not determine which value is effective at the point a command is gated. The
   test is `#[ignore]`d as flaky (`review.rs:195`), so it may also be stale. This matters directly
   for our permission-broker design.

3. ~~What is `MAX_USER_INPUT_TEXT_CHARS`?~~ **Resolved:**
   `pub const MAX_USER_INPUT_TEXT_CHARS: usize = 1 << 20;` (1,048,576 characters) —
   `codex-rs/protocol/src/user_input.rs:9`. Not review-specific; it is the global user-input cap,
   applied to the detached review's synthesized prompt at `turn_processor.rs:1410-1413`.

4. ~~Does `spawn_subagent`'s fork copy model context or only the persisted rollout?~~
   **Partly resolved:** `ThreadManager::spawn_subagent`
   (`codex-rs/core/src/thread_manager.rs:824-857`) materializes and flushes the parent's rollout,
   reads it back with `include_history: true` (`:833-836`), converts it via
   `stored_thread_to_initial_history` (`:843`), and seeds the new thread with
   `fork_history_from_snapshot(ForkSnapshot::Interrupted, ...)` (`:847-853`). So the detached
   review thread starts with the parent's **full persisted conversation history** as model
   context. What remains open is whether our `thread/fork` + SDK resume reproduces that fidelity,
   which needs a live comparison rather than more reading.

5. **Behavior when the model omits `priority`.** The rubric says the field is optional
   (`rubric.md:58,78`); `ReviewFinding::priority` is a non-defaulted `i32`
   (`codex-rs/protocol/src/protocol.rs:3491`). I believe this drops the whole payload to the
   raw-text fallback, but no test covers it and I did not execute the parser.

6. **How the detached review's markdown output is surfaced.** The `review-agent` skill emits
   markdown, not JSON (`SKILL.md:41-53`), and the detached path never runs
   `parse_review_output_event`. **[inference]** the detached review's result is therefore just an
   ordinary assistant message on the review thread, with no `exitedReviewMode` item at all — but I
   found no test asserting the absence of that item, so this is unverified.

7. **Whether any client consumes the structured `ReviewOutputEvent`.** The TUI is an app-server
   client and receives only the flattened string
   (`codex-rs/tui/src/chatwidget/protocol.rs:355`,
   `codex-rs/tui/src/thread_transcript.rs:244-247`). The `[x]`/`[ ]` selection mode in
   `format_review_findings_block` (`codex-rs/protocol/src/review_format.rs:43-47`) implies a UI
   that lets a user check off findings, but the only two callers in the tree
   (`codex-rs/core/src/tasks/review.rs:219`, `codex-rs/protocol/src/review_format.rs:71`) both pass
   `None`, so that branch is currently dead. Whether any non-TUI client (IDE extension, cloud)
   reads the structured form is not answerable from this repo.

8. **`codex-rs/core/templates/review/`.** Two files
   (`history_message_completed.md`, `history_message_interrupted.md`) that duplicate the
   `codex-rs/prompts/templates/review/*.xml` assets and are referenced nowhere in the tree
   (grep for their basenames returns zero hits). They appear to be orphans from the prompt
   consolidation commit `ba2b67f9cd`. Not load-bearing, but worth not copying by mistake.

9. **Is there a review-effort or model-tier knob beyond `review_model`?** `review_model`
   (`codex-rs/core/src/config/mod.rs:626`) is the only review-specific model control I found;
   `auto_review_model_override` (`codex-rs/protocol/src/openai_models.rs:439`) belongs to the
   guardian domain. Two ExecPlans in this repo's own history reference
   "codex-review-effort-levels" (`docs/doperpowers/execplans/2026-07-17-codex-review-effort-levels.md`),
   which I did not read; they may describe an intended knob that is not in this tree.
