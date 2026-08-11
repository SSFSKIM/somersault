# P83 — Agent child-frame usage summability + subagent identity

**Status:** **Complete. F3's `LT17` sidecar-less fallback is decided.**
**Canonical runs:** 2026-08-04 · SDK 0.3.220 · Node 24.18.0 · macOS · parent `claude-fable-5`, child `claude-sonnet-5` (passes A/B) and `claude-fable-5` (passes C/D)
**Authentication:** first-party `CLAUDE_CODE_OAUTH_TOKEN` (`initializationResult().account.apiProvider === "firstParty"` asserted in every pass); no `ANTHROPIC_API_KEY` in the environment.
**Probe:** `probes/probes/83-agent-usage-identity.ts`
**Gates:** `F3 LT17` (the `Done (7 tool uses · 24.1k tokens · 1m 12s)` row), `TR39` (teammate attribution), `DG21`.

## Verdict

**Summable: no. Reconstructible: yes — but not by summing, and not from child frames alone.**

1. Child assistant frames do carry their own `message.usage`, and it is **per-API-message**, not cumulative
   totals. But the child's context is cumulative, so `cache_read_input_tokens` grows every turn; summing
   usage across child messages therefore multiplies the context and **overshoots `totalTokens` by
   +265% to +342%** in the canonical run. Summing only `output_tokens` **undershoots by −94%**. No
   summation candidate matched the sidecar on any run.
2. The sidecar's `totalTokens` is not a sum at all. It is exactly
   `usage.input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the
   **final** child message — a context-footprint number, not a billing aggregate. Verified exactly on
   5 of 5 completed sidecars that printed `usage`.
3. Two of the three `LT17` numbers are faithfully reconstructible from child frames:
   **tool-use count matched the sidecar exactly in 5 of 5 dispatches**, and
   **first-child-frame-arrival → tool_result-arrival was within 1–7 ms of `totalDurationMs`** (≤0.1%).
   The token number is the weak one: the best child-frame proxy (final child message, all four usage
   fields) landed **−17 tokens (−0.6%)** when `forwardSubagentText: true`, but **−600 tokens (−21%)**
   when it is left at its default `false`, because the child's final report turn is then never forwarded.
4. **There is a better channel than child frames.** Every dispatch emitted
   `system/task_started`, `system/task_progress`, and `system/task_notification` frames keyed by the
   Agent **`tool_use_id`**, and `task_notification.usage` carries exactly the three numbers `LT17`
   needs: `{ total_tokens, tool_uses, duration_ms }`. Against the sidecar it matched `tool_uses`
   exactly (5/5), `duration_ms` to within 1 ms (5/5), and `total_tokens` to within +4.6%/−0.3%. It
   **arrived 1 ms before** the Agent `tool_result` in the foreground case, so it is available at the
   moment the Done row renders. It is emitted independently of `forwardSubagentText`.
5. **Identity beyond `parent_tool_use_id` exists and is rich.** Every child `assistant` **and** `user`
   frame carries `subagent_type` and `task_description`; child assistant frames carry the child's own
   `message.model` (observed as `claude-sonnet-5` while the parent was `claude-fable-5`). What child
   frames do **not** carry is an agent/task id or a child session id — `session_id` on child frames is
   the **parent's** session id. The agent id arrives only as `sidecar.agentId` and as
   `system/task_*.task_id`, which the `task_started` frame joins to `tool_use_id` and `subagent_type`.
6. Flat-only (no `tool_use_result` at all) was **not** reproduced. A different totals-free shape was:
   **two Agent calls issued in one parent message were launched asynchronously**, and their sidecars
   were `status:"async_launched"` with no `totalTokens`, `totalToolUseCount`, `totalDurationMs`, or
   `toolStats`. A single dispatch of the same built-in `general-purpose` agent returned a full
   `completed` sidecar, so **parallel dispatch — not agent type — caused it**.

## Method

Four passes, each on a fresh `mkdtemp` fixture holding four two-line marker files, torn down after the
run. Each pass ran one query with `tools: ["Agent","Read"]`, `settingSources: []`, `skills: []`,
`persistSession: false`, `permissionMode:"bypassPermissions"`, parent `maxTurns: 10`, and a 7-minute
abort deadline. The parent was instructed to dispatch and do nothing else; each child was instructed to
make exactly one `Read` call per fixture file and then stop.

| Pass | `forwardSubagentText` | agent | dispatches | child model | child tool calls |
|---|---|---|---:|---|---:|
| A | `true` | custom `probe-reader` (`tools:["Read"]`, `model:"sonnet"`, `maxTurns:6`) | 1 | `claude-sonnet-5` | 3 |
| B | `false` | same custom agent | 1 | `claude-sonnet-5` | 3 |
| C | `true` | built-in `general-purpose` | 2 (parallel) | `claude-fable-5` | 2 + 2 |
| D | `true` | built-in `general-purpose` | 1 | `claude-fable-5` | 3 |

Pass A was executed four times across the session; its frame structure, identity fields, and the sign
and magnitude of every candidate error were stable across all four. The worked example below is the
final pass-A run (parent session `…897b3e`). Passes B, C, D were executed once each.

## [Q1] Which frame classes carry `parent_tool_use_id`

From pass A (`includePartialMessages: true`), counted as `ptid-set` / `ptid-null`:

| Frame class | ptid set | ptid null |
|---|---:|---:|
| `assistant` | 5 | 2 |
| `user` | 4 | 1 |
| `stream_event` | **0** | 22 |
| `system/init`, `system/status`, `system/task_started`, `system/task_progress`, `system/task_updated`, `system/task_notification` | 0 | all |
| `command_lifecycle`, `rate_limit_event`, `result` | 0 | all |
| `tool_progress` | — | not emitted in any pass |

Two consequences. **Partial frames never carry `parent_tool_use_id`** on 0.3.220 — all 22
`stream_event` frames belonged to the parent, so a token-level streaming renderer *inside* a subagent
is not reachable through partials; child text arrives only as completed `assistant` frames. And the
`system/task_*` sidechannel is **not** ptid-routed: it is keyed by `tool_use_id` and `task_id`
instead, which is why it survives when child frames are not forwarded.

## [Q2] Child usage: exists, per-message, and not summable

Every child assistant frame carried `message.usage` in every pass (5/5, 3/3, 3/3+3/3, 4/4 frames).
Canonical pass-A child, sequenced per distinct `message.id`:

```
input_tokens          [   2,    2,    2,    2]
output_tokens         [   3,   73,   72,    9]
cache_creation_tokens [1010,  369,  139,  141]
cache_read_tokens     [1220, 2230, 2599, 2738]
```

`input_tokens` and `output_tokens` are **per-message deltas**. The cache fields are the *context* the
child carried into that turn, so they climb monotonically — the child's whole conversation is re-read
each turn. Summing them therefore counts the same context four times over.

**Frames and messages are not 1:1.** Pass A produced 5 assistant frames over 4 distinct `message.id`s;
pass D produced 4 frames over 2 ids; pass B produced 3 frames over **1** id, all three carrying an
identical `usage` object. A naive per-frame sum therefore double- or triple-counts a single API turn on
top of the context problem (pass B per-frame `all_four` = 6690 against a 2830 sidecar). **Any client
aggregation must dedupe by `message.id` first**, and even then must not sum.

## [Q3] Tool-use count — exact match

Counting child `tool_use` blocks grouped by `parent_tool_use_id` reproduced `totalToolUseCount`
exactly on every dispatch that had one, and matched `task_notification.usage.tool_uses` on every
dispatch including the async ones:

| Pass | client-counted child `tool_use` blocks | `sidecar.totalToolUseCount` | `task_notification.tool_uses` |
|---|---:|---|---:|
| A | 3 | 3 | 3 |
| B | 3 | 3 | 3 |
| C (call 1) | 2 | *(absent — async)* | 2 |
| C (call 2) | 2 | *(absent — async)* | 2 |
| D | 3 | 3 | 3 |

The sidecar's `toolStats` (`readCount: 3`, everything else 0) agreed with the observed block names,
so the per-family breakdown is also client-derivable when frames are forwarded.

## [Q4] Duration — an excellent proxy in the foreground, useless when async

| Pass | first child frame → `tool_result` | dispatch → `tool_result` | `sidecar.totalDurationMs` | Δ (first child) |
|---|---:|---:|---:|---:|
| A | 9233 ms | 9240 ms | 9236 ms | **−3 ms** |
| A (earlier run) | 7273 ms | 7285 ms | 7278 ms | −5 ms |
| B | 6336 ms | 6344 ms | 6337 ms | −1 ms |
| D | 6086 ms | 6095 ms | 6089 ms | −3 ms |
| C (call 1) | **−2520 ms** | 10 ms | *(absent)* | — |

For a foreground dispatch both wall-clock proxies are within 7 ms of the true value; `dispatch →
tool_result` is the safer of the two because it does not require any child frame to have been
forwarded. For an **async** dispatch the `tool_result` lands ~10 ms after dispatch and the child frames
arrive *after* it, so both proxies are meaningless — the duration must come from
`task_notification.usage.duration_ms` (which matched the foreground sidecar to within 1 ms in every
pass that had both).

## [Q5] Identity — exact key paths

Present on **child assistant** frames (`parent_tool_use_id !== null`):

```
assistant.parent_tool_use_id      the owning Agent tool_use id
assistant.subagent_type           "probe-reader" / "general-purpose"
assistant.task_description        "Read probe fixture files"  (the Agent input's description)
assistant.session_id              == the PARENT session id (no separate child session)
assistant.uuid
assistant.timestamp
assistant.message.id              dedupe key; several frames can share one
assistant.message.model           "claude-sonnet-5" while the parent ran "claude-fable-5"
assistant.message.usage           per-message usage (see Q2)
```

Present on **child user** frames (the tool_result half — attribution works for both halves of a call):

```
user.parent_tool_use_id, user.subagent_type, user.task_description,
user.session_id, user.uuid, user.timestamp
```

**Absent from child frames:** `agent_id` / `agentId`, `task_id`, and any child-specific session id.
Those live in two other places:

```
tool_use_result.agentId           e.g. "…e7e1e3"            (only when a sidecar arrives)
tool_use_result.agentType         "probe-reader"
tool_use_result.resolvedModel     "claude-sonnet-5"
system/task_started.task_id       == the sidecar's agentId
system/task_started.tool_use_id   == the Agent tool_use id  ← the join
system/task_started.subagent_type "probe-reader"
system/task_started.task_type     "local_agent"
system/task_started.description   "Read probe fixture files"
system/task_progress.{task_id, tool_use_id, subagent_type, description, usage{total_tokens,tool_uses,duration_ms}}
system/task_notification.{task_id, tool_use_id, status, usage{total_tokens,tool_uses,duration_ms}}
system/task_updated.{task_id, patch{status, end_time}}
```

`task_started` is the identity join: it binds `tool_use_id ↔ task_id ↔ subagent_type ↔ description`
before any child frame arrives. `task_notification` does not repeat `subagent_type`, so a renderer must
remember the `task_started` binding. The declared `tool_progress.subagent_type` /
`subagent_retry` route (`sdk.d.ts`) produced **zero frames** in all four passes — it is presumably
threshold-gated on long-running tools and must not be relied on.

## [Q6] Flat-only, and the totals-free shape that did reproduce

No Agent call in this probe was flat-only. P94's canonical census remains the frequency evidence there:
**9 of 11 Agent calls carried an object sidecar and 2 were flat-only**, with the standing rule that
sidecar presence is per call and must never be inferred session-wide.

What *did* reproduce is a totals-free sidecar. In pass C the parent issued two Agent calls in one
message; both returned within ~10 ms with:

```
tool_use_result = { agentId, canReadOutputFile, description, isAsync, outputFile,
                    prompt, resolvedModel, status: "async_launched" }
```

— no `totalTokens`, no `totalToolUseCount`, no `totalDurationMs`, no `toolStats`, no `usage`, and no
`agentType`. Pass D dispatched the same built-in `general-purpose` agent **once** and got a full
`completed` sidecar, so the trigger is parallel dispatch, not the agent type. For these two calls the
completion totals arrived **only** through `system/task_notification` (`total_tokens` 4195 / 4188,
`tool_uses` 2 / 2, `duration_ms` 4484 / 5545). `system/background_tasks_changed` frames accompanied
them, and the run emitted 3 result frames rather than 1.

## Worked example — one run, every candidate against the sidecar

Pass A, parent session `…897b3e`, Agent `…wMh4eg`, child `probe-reader` on `claude-sonnet-5`, 3 Reads.

Ground truth from the sidecar:

```
status                = "completed"
totalToolUseCount     = 3
totalTokens           = 2907
totalDurationMs       = 9236
usage                 = { input_tokens: 2, output_tokens: 26,
                          cache_creation_input_tokens: 141, cache_read_input_tokens: 2738 }
toolStats             = { readCount: 3, searchCount: 0, bashCount: 0, editFileCount: 0,
                          linesAdded: 0, linesRemoved: 0, otherToolCount: 0 }
```

Note first that `2 + 26 + 141 + 2738 = 2907 = totalTokens`. The sidecar's `usage` **is** the final
child message's usage, and `totalTokens` is its four fields added. This held on every completed
sidecar observed (A ×3 runs, B, D).

Client-side reconstructions from child frames:

| Candidate | Value | vs `totalTokens` 2907 |
|---|---:|---:|
| `sum_dedup_output_only` | 157 | −2750 (−94.6%) |
| `sum_dedup_input_plus_output` | 165 | −2742 (−94.3%) |
| `sum_dedup_all_four` | 10611 | +7704 (**+265.0%**) |
| `sum_perFrame_all_four` (no dedupe) | 12846 | +9939 (**+341.9%**) |
| `finalMessage_all_four` | 2890 | **−17 (−0.6%)** |
| `finalMessage_context_only` | 2881 | −26 (−0.9%) |
| `maxMessage_all_four` | 2890 | −17 (−0.6%) |

The residual −17 is exactly the difference between the forwarded final frame's `output_tokens` (9) and
the sidecar's (26): the usage attached to a forwarded child frame is a mid-stream snapshot taken when
the frame was emitted, not the settled per-message total. The same −17 appeared in three separate
pass-A runs and in pass D. In pass B (`forwardSubagentText: false`) the same candidate was **−600
(−21.2%)**, because the child's final report turn is not forwarded at all and the last *observed*
message is one of the tool-calling turns.

Other channels for the same run:

| Number | Sidecar | Client from child frames | `task_notification` |
|---|---:|---:|---:|
| tool uses | 3 | **3 (exact)** | **3 (exact)** |
| tokens | 2907 | 2890 (−0.6%) | 3041 (+4.6%) |
| duration | 9236 ms | 9233 ms (−3 ms) | 9235 ms (**−1 ms**) |

`task_notification` arrived **1 ms before** the Agent `tool_result`.

## Implication for `LT17`

A sidecar-less `Done (…)` row can be synthesized honestly, but it must be built from the task
sidechannel rather than from summed child usage. F3 should bind `tool_use_id → { task_id,
subagent_type, description }` on `system/task_started`, keep the latest
`system/task_progress.usage` as the live counter (it already supplies a running `tool_uses` and
`duration_ms` for the in-flight spinner), and treat `system/task_notification.usage` as the completion
totals: it is keyed by the same `tool_use_id`, is independent of both `forwardSubagentText` and sidecar
presence, arrives just before the `tool_result`, and reproduced `tool_uses` and `duration_ms` to within
1 ms of the sidecar on every foreground dispatch — while being the *only* totals source at all for
parallel `async_launched` dispatches, whose sidecar carries no totals whatsoever. Where child frames
are forwarded they remain a legitimate secondary source for the tool-use count (exact, 5/5) and for a
duration proxy (≤7 ms), but the token figure must never be a sum: summing child usage overstates by
265–342% because the child's context is re-counted every turn, and the only near-correct child-frame
token estimate — the final forwarded message's four usage fields — is itself −0.6% low with text
forwarding on and −21% low with it off. The precedence for the row is therefore: recognized completed
sidecar first; `task_notification.usage` second; child-frame count plus dispatch-to-result duration
third, with the token component **omitted** rather than summed when neither of the first two is
available, since a `Done (3 tool uses · 9.2s)` row is honest and a `Done (… · 10.6k tokens · …)` row is
a 265% lie. `TR39` and `DG21` get their attribution from the same binding: `subagent_type` and
`task_description` are on every child frame including the tool-result half, the child's own
`message.model` is on child assistant frames, and the agent id comes from
`task_started.task_id` (equal to `sidecar.agentId`) — but note that child frames report the **parent's**
`session_id`, so a subagent is not addressable as a separate session on the wire.

## Scope and limitations

- Five Agent dispatches over four passes on one SDK version, one host, one fixture shape. Token deltas
  are run-specific; the *signs and structural conclusions* were stable across four pass-A repetitions.
- Only `Read` was exercised inside the child. `toolStats` families beyond `readCount` are untested here.
- `task_notification` fired for all five dispatches, but five calls is not proof it is unconditional.
  A renderer must still degrade gracefully when it is absent.
- Flat-only Agent results (no `tool_use_result`) were not reproduced; P94's 2-of-11 observation stands
  as the only evidence for their frequency.
- `tool_progress` frames were never observed, so the declared subagent-retry identity route is untested.
- The async path was reached incidentally via parallel dispatch, not via `run_in_background: true`
  (the model set `run_in_background: false` on every single-dispatch call). Explicit background agents
  are not covered.
- The probe prints truncated session/task/tool ids and truncates task descriptions; fixture content is
  probe-authored. No credential is read or printed.

## Reproduction

From `CC-to-SDK/probes`, with OAuth only:

```sh
set -a; . ../.env; set +a
npx tsc --noEmit
npx tsx probes/83-agent-usage-identity.ts                 # passes A,B,C
npx tsx probes/83-agent-usage-identity.ts --passes=a,d    # canonical worked example + async control
```

Each pass costs roughly $0.07–$0.23 on the subscription. `--passes=` selects any subset of `a,b,c,d`.
