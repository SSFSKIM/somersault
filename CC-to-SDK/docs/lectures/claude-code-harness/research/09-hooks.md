# 09 — The Hooks System (Claude Code 2.1.251)

Source of every claim: `~/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines, beautified from
the Bun ESM chunk graph) plus `~/claude-code-bundle/2.1.251/modules/src/plugins/functionHooks/hooks-worker/hooks-worker.js`.
Anchors are written `cli.pretty.js:LINENO`. Symbols are minified **per chunk**, so names like `jy`,
`Nq`, `Fq`, `Rzn` are only meaningful inside the chunk that defines them; where the chunk's export
list gives a readable alias I use it. Nearly the whole engine lives in one chunk,
**`chunk-fy12d89p.js`** (cli.pretty.js:411873–520034), whose export table (cli.pretty.js:728892)
maps the minified names to readable ones. Everything here is Claude Code the CLI, not the Agent SDK.

---

## Executive summary (read this first)

1. **33 hook events** in 2.1.251 (`_y`, cli.pretty.js:183061) — up from the ~8–30 that older
   documentation and the February parity rows assume. The full list is the single source of truth
   for the settings schema, the `/hooks` UI, and the dispatch registry.
2. Every event resolves through one dispatch table, `HOOK_EVENT_REGISTRY` (`zCr`,
   cli.pretty.js:494378), mapping event name → trigger function. Two runners exist underneath:
   `executeHooks` (`jy`, cli.pretty.js:495487), an async generator used inside the REPL/turn loop,
   and `executeHooksOutsideREPL` (`AE`, cli.pretty.js:495956), a collect-all variant for
   lifecycle events with no conversation context.
3. There are **seven hook types**. Five are settings-authorable — `command`, `prompt`, `agent`,
   `http`, `mcp_tool` (`ms()`, cli.pretty.js:184253) — plus two internal ones: `callback` (in-process
   / SDK) and `function` (plugin hooks-module handlers running in a Bun Worker).
4. **The default hook timeout is 600 s**, not 60 s: `var Li = 600000` (cli.pretty.js:445027). Only a
   few events narrow it (UserPromptSubmit 30 s, model-switch 30 s, SessionEnd 1.5–60 s adaptive).
   `prompt` hooks default to 30 s and `agent` hooks to 60 s internally.
5. Hooks for one event run **fully in parallel, unbounded** — the results generator is merged with
   `QZ(Xe)` and no concurrency cap is passed (cli.pretty.js:495815; `QZ` at cli.pretty.js:459747).
   Identical hooks are deduped per `(pluginRoot|skillRoot, canonical-hook-key)` before running
   (`AM`/`Lq`, cli.pretty.js:495227/:495290).
6. Exit-code contract: `0` = success (stdout meaning is per-event), `2` = **blocking error**, stderr
   goes to the model, anything else = non-blocking warning to the user only. JSON on stdout
   overrides all of it (`Fq`, cli.pretty.js:494558). A first `{"async": true}` line backgrounds the
   process.
7. Decision precedence within one event is a strict monotone ladder, **deny > defer > ask > allow**,
   accumulated across all hooks and yielded only when the running winner equals the current hook's
   verdict (cli.pretty.js:495878–:495900).
8. Hook feedback reaches the model exclusively as `<system-reminder>`-wrapped meta user messages
   (`hl`, cli.pretty.js:518353; mappers at cli.pretty.js:518670).
9. Settings hooks are **snapshotted at startup** (`TX`, cli.pretty.js:7253; captured in `setup`,
   cli.pretty.js:326280) — later edits to `settings.json` do not take effect until `/hooks` is
   opened or the session restarts. Plugin/skill/device hooks are read live.
10. Kill switches, in precedence order: `--bare` → `policySettings.disableAllHooks` →
    `policySettings.allowManagedHooksOnly` → safe mode → `strictPluginOnlyCustomization` →
    user `disableAllHooks` (which *promotes* the session to managed-only, not to off) — all in
    `l()`, cli.pretty.js:7192.

---

## 1. Architecture

### 1.1 The dispatch registry

```js
var zCr = { PreToolUse: Tye, PostToolUse: b3e, PostToolUseFailure: zNt, PostToolBatch: Fct,
  PermissionDenied: VNt, PermissionRequest: Tee, Notification: EE, Stop: y9, SubagentStop: y9,
  StopFailure: HPe, TeammateIdle: HUt, TaskCreated: xUt, TaskCompleted: eGe,
  UserPromptSubmit: bSe, UserPromptExpansion: Ldt, SessionStart: vUt, SessionEnd: ZSe,
  Setup: RUt, SubagentStart: kUt, PreCompact: tz, PostCompact: kPe, PreModelSwitch: mdt,
  PostModelSwitch: gdt, ConfigChange: Vpt, CwdChanged: AUt, FileChanged: CUt,
  DirectoryAdded: YSe, InstructionsLoaded: Qqe, Elicitation: JSe, ElicitationResult: QSe,
  WorktreeCreate: tGe, WorktreeRemove: Kpt, MessageDisplay: Zqe }
```
— cli.pretty.js:494378, exported as `HOOK_EVENT_REGISTRY`. Note `Stop` and `SubagentStop` share one
implementation (`y9`, cli.pretty.js:494314) that branches on whether an `agentId` was passed.

### 1.2 Two runners

| runner | export | shape | used by |
|---|---|---|---|
| `jy` (cli.pretty.js:495487) | `executeHooks` | `async function*` yielding partial results as they arrive | every event that runs inside a turn / needs to stream progress |
| `AE` (cli.pretty.js:495956) | `executeHooksOutsideREPL` | `async function` returning `{command, succeeded, output, blocked, …}[]` | PreCompact, PostCompact, ConfigChange, DirectoryAdded, Elicitation(+Result), CwdChanged, FileChanged, InstructionsLoaded, Notification, SessionEnd, StopFailure, WorktreeCreate, WorktreeRemove |

`AE` explicitly **cannot run `prompt` or `agent` hooks** — it returns
`"Prompt stop hooks are not yet supported outside REPL"` / `"Agent stop hooks are not yet supported
outside REPL"` (cli.pretty.js:496004, :496029) — and errors internally if a `function` hook reaches
it (`"Function hook reached executeHooksOutsideREPL for ${x}. Function hooks should only be used in
REPL context (Stop hooks)."`, cli.pretty.js:496031).

`jy` itself is a thin wrapper that flushes the UI (`pm()`) around a small set of "user-visible
decision" events before delegating to `Xxt` → `Qxt`:

```js
var c6n = new Set(["PreToolUse","PermissionRequest","UserPromptSubmit","UserPromptExpansion","TaskCompleted","TeammateIdle"]);
```
— cli.pretty.js:495486. `Xxt` (cli.pretty.js:495511) is the *subagent filter*: when the calling
context is a restricted agent context (`ka(...)`), it strips every field of a hook result except
permission behaviour, `updatedInput`, `updatedToolOutput`, `preventContinuation`, `stopReason`,
`hookSource`, and (PreToolUse only) `blockingError`. `Qxt` (cli.pretty.js:495532) is the real engine.

### 1.3 The `Qxt` pipeline (one event fire, end to end)

1. **Trust gate** — `J7()` = `!L6()`; if the workspace is untrusted, log
   `Skipping ${event} hook execution - workspace trust not accepted` and return (cli.pretty.js:495539).
2. **Resolve matchers** — `Rzn` = `getMatchingHooks` (cli.pretty.js:495410).
3. **Filter** by `if` condition, by served-call eligibility, by `sessionFunctionHooksOnly` /
   `skipSessionFunctionHooks`.
4. **Telemetry + progress** — emits one `{type:"progress", data:{type:"hook_progress", hookEvent,
   hookName, command, promptText?, statusMessage?}}` message *per hook* before any of them start
   (cli.pretty.js:495573).
5. **Stringify the input once** — memoised (`ut`, cli.pretty.js:495578); a stringify failure yields a
   `hook_error_during_execution` attachment for every hook.
6. **Run all hooks concurrently** as async generators, merged by `QZ` with no limit.
7. **Fold results** in arrival order into yields, tracking the permission ladder.
8. **Telemetry close-out** — `tengu_repl_hook_finished` with `{numCommands, numSuccess, numBlocking,
   numNonBlockingError, numCancelled, totalDurationMs, additionalContextChars,
   classifierContextChars, systemMessageChars, initialUserMessageChars, hookSuccessStdoutChars}`
   plus a per-plugin `tengu_hook_plugin_injected` roll-up (cli.pretty.js:495942).

---

## 2. Event inventory

### 2.0 The canonical list

```js
var _y = ["PreToolUse","PostToolUse","PostToolUseFailure","PostToolBatch","Notification",
  "UserPromptSubmit","UserPromptExpansion","SessionStart","SessionEnd","Stop","StopFailure",
  "SubagentStart","SubagentStop","PreCompact","PostCompact","PreModelSwitch","PostModelSwitch",
  "PermissionRequest","PermissionDenied","Setup","TeammateIdle","TaskCreated","TaskCompleted",
  "Elicitation","ElicitationResult","ConfigChange","WorktreeCreate","WorktreeRemove",
  "InstructionsLoaded","CwdChanged","FileChanged","DirectoryAdded","MessageDisplay"];
```
— cli.pretty.js:183061 (chunk-7g4v1yq9.js). Unknown keys in `settings.hooks` are rejected with
`` `unknown hook event. Valid events: ${_y.join(", ")}` `` (cli.pretty.js:184260).

Note `StatusLine` and `FileSuggestion` appear in an adjacent set `G6` (cli.pretty.js:431714) but are
**not** hook events — they are separate settings-driven command surfaces that reuse the same spawn
path.

### 2.1 The common input base

Every hook input is `{...Ea(session, cwd, permissionMode, ctx), hook_event_name, …}` where `Ea` =
`createBaseHookInput` (cli.pretty.js:494446):

| field | type | notes |
|---|---|---|
| `session_id` | string | for a call served to a cloud session, becomes `` `served:${callerSessionId}` `` |
| `transcript_path` | string | `om(session.id)`; empty string for served calls |
| `cwd` | string | process cwd at fire time |
| `prompt_id` | string? | UUID correlating a user prompt with all events until the next one; equals the OTel `prompt.id` attribute. Absent until the first user input of the process |
| `permission_mode` | string? | |
| `agent_id` | string? | present **only** inside a subagent |
| `agent_type` | string? | subagent type name, or the main-thread agent for `--agent` sessions |
| `effort` | `{level: string}`? | e.g. `"low" … "max"`, after silent model downgrade; also exported as `CLAUDE_EFFORT` |

Zod definition: `Ee` at cli.pretty.js:306775.

The `matchQuery` — the string the matcher is compared against — is per-event, from
`hookMatchQuery` (`Czn`, cli.pretty.js:494956):

| event | matcher matches |
|---|---|
| PreToolUse / PostToolUse / PostToolUseFailure / PermissionRequest / PermissionDenied | `tool_name` |
| UserPromptExpansion | `command_name` |
| SessionStart | `source` |
| Setup | `trigger` |
| PreCompact / PostCompact | `trigger` |
| PreModelSwitch / PostModelSwitch | canonical `to_model` |
| Notification | `notification_type` |
| SessionEnd | `reason` |
| StopFailure | `error` |
| SubagentStart / SubagentStop | `agent_type` |
| Elicitation / ElicitationResult | `mcp_server_name` |
| ConfigChange | `source` |
| DirectoryAdded | `source` |
| InstructionsLoaded | `load_reason` |
| FileChanged | basename of `file_path` |
| PostToolBatch, Stop, UserPromptSubmit, TeammateIdle, TaskCreated, TaskCompleted, CwdChanged, MessageDisplay, WorktreeCreate/Remove | *(none — matcher is ignored, every hook runs)* |

---

### 2.2 `PreToolUse`

- **Trigger**: `executePreToolHooks` (`Tye`, cli.pretty.js:445032), called from `mQ`
  (cli.pretty.js:444916) inside the permission pipeline, before `hasPermissionsToUseTool`.
- **Timeout**: `Li` (600 s) — no caller narrows it.
- **Matcher**: `tool_name` (see §3.4 for grammar).
- **Input** (`UQ`, cli.pretty.js:306775):
  ```jsonc
  { ...base, "hook_event_name": "PreToolUse",
    "tool_name": "Bash", "tool_input": {…}, "tool_use_id": "toolu_…" }
  ```
- **Honoured output**: `hookSpecificOutput.permissionDecision` (`allow|deny|ask|defer`),
  `permissionDecisionReason`, `updatedInput`, `additionalContext`; plus the legacy top-level
  `decision: "approve"|"block"` + `reason`; plus `continue:false`/`stopReason`, `systemMessage`,
  `suppressOutput`, `terminalSequence`.
- **`updatedInput` validation**: re-parsed against the tool's own `inputSchema`; a failure that is
  not merely `unrecognized_keys` converts the hook into a **deny** with
  `` `PreToolUse hook for ${tool} returned updatedInput that failed schema validation: …` ``
  (cli.pretty.js:444932). `updatedInput` is only applied alongside `allow` or `ask`
  (cli.pretty.js:495903).
- **Interaction with the permission pipeline** (cli.pretty.js:444886–:444912):
  - `deny` → returned immediately, no further checks.
  - `allow` → still re-run through `Gx` (rule check); a **deny rule overrides** the hook
    (`Hook returned '…' for X, but deny rule overrides: …`); an **ask rule** forces the full
    pipeline; `requireCanUseTool` forces the full pipeline; in auto mode with the
    `tengu_virtual_knuth` flag the allow is "funneled" through the classifier with
    `hookAllowVouched: true`.
  - `ask` → full pipeline with `hookAskFloor: true`, meaning even a classifier allow re-surfaces as
    a prompt.
  - `defer` → yields `{type:"defer", hookName}`; renders as
    `` `${hookName} deferred ${toolName} · resume with -p --resume to continue` `` (cli.pretty.js:192700).
- **Confined sessions**: `cun` (cli.pretty.js:495524) drops `permissionDecision: allow` entirely with
  `"… permissionDecision=allow ignored: a confined session takes grants only from its command line"`.

### 2.3 `PostToolUse`

- **Trigger**: `executePostToolHooks` (`b3e`, cli.pretty.js:445049), after the tool resolves.
- **Timeout**: `Li` (600 s).
- **Matcher**: `tool_name`.
- **Input** (`FQ`):
  ```jsonc
  { ...base, "hook_event_name": "PostToolUse", "tool_name": "Edit", "tool_input": {…},
    "tool_response": {…}, "tool_use_id": "toolu_…",
    "duration_ms": 1234 }   // excludes permission-prompt and hook time
  ```
- **Honoured output**: `additionalContext`, `classifierContext`, `updatedToolOutput`,
  `updatedMCPToolOutput` (legacy), `decision:"block"` + `reason`, `continue:false`, `systemMessage`.
- **`updatedToolOutput`** replaces the tool result before it reaches the model. It is validated
  against the tool's `outputSchema`; a mismatch logs
  `` `PostToolUse hook returned updatedToolOutput that does not match ${tool}'s output shape` ``
  and, at cli.pretty.js:481354, emits a `hook_error_during_execution` attachment saying the original
  output is used. `updatedMCPToolOutput` is honoured only when `updatedToolOutput` is absent
  (cli.pretty.js:494667); otherwise `legacyMcpRewriteSuppressed` is set.
- **`classifierContext`** is the interesting new field: host-asserted context handed to the auto-mode
  permission classifier alongside the tool result. Capped at **2000 UTF-16 code units** shared across
  all hooks for one call (`fP = 2000`, cli.pretty.js:433152). Its schema description
  (cli.pretty.js:432729) is a full paragraph of relay discipline — the key operational facts are:
  honoured on synchronous responses only (an async hook's late response is silently ignored); only
  applies to calls the classifier transcript shows; a classifier assertion returned in the *same*
  hook result as a rewrite is dropped automatically if that rewrite is rejected or superseded.
- A special re-sync path: if a PostToolUse hook modified a file Claude just edited, the harness emits
  `` `PostToolUse hook modified ${file} after your edit (likely …)` `` as additional context and
  re-syncs `readFileState` (cli.pretty.js:474478).

### 2.4 `PostToolUseFailure`

- **Trigger**: `zNt`, cli.pretty.js:445053. Gated behind `oT("PostToolUseFailure", …)` — skipped
  entirely when no hook is registered.
- **Input** (`BQ`): `{…base, tool_name, tool_input, tool_use_id, error, is_interrupt?, duration_ms?}`.
  The `/hooks` UI text also promises `error_type` and `is_timeout` (cli.pretty.js:647884) — those are
  **not** in the zod schema nor in the constructed object (cli.pretty.js:445055). *(INFERRED: stale
  UI copy.)*
- **Honoured output**: `additionalContext` only, plus the generic fields.

### 2.5 `PostToolBatch`

- **Trigger**: `Fct`, cli.pretty.js:445059. Fires **once** after every tool call in a batch resolves,
  before the next model request. No matcher.
- **Input** (`VQ`): `{…base, tool_calls: [{tool_name, tool_input, tool_use_id, tool_response?}]}`.
- **Honoured output**: `additionalContext` (injected once for the whole batch); exit 2 stops the
  agentic loop with stderr shown to the user only.

### 2.6 `PermissionRequest`

- **Trigger**: `executePermissionRequestHooks` (`Tee`, cli.pretty.js:445070) — fires when a permission
  dialog *would* be displayed.
- **Input** (`zQ`): `{…base, tool_name, tool_input, permission_suggestions?: PermissionUpdate[]}`.
  Note: **no `tool_use_id` in the schema** despite the `/hooks` UI text claiming one.
- **Honoured output** — a nested decision object, not `permissionDecision`:
  ```jsonc
  { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
      "decision": { "behavior": "allow", "updatedInput": {…}, "updatedPermissions": [ …PermissionUpdate ] } } }
  // or
  { "hookSpecificOutput": { "hookEventName": "PermissionRequest",
      "decision": { "behavior": "deny", "message": "…", "interrupt": true } } }
  ```
  (cli.pretty.js:432729). A malformed `decision` produces the targeted error
  `` ' (PermissionRequest decision must be {"behavior": "allow"} or {"behavior": "deny", "message": "..."})' ``
  (cli.pretty.js:494041).

### 2.7 `PermissionDenied`

- **Trigger**: `VNt`, cli.pretty.js:445065, after the auto-mode classifier denies. Gated by `oT`.
- **Input** (`GQ`): `{…base, tool_name, tool_input, tool_use_id, reason}`.
- **Honoured output**: `hookSpecificOutput.retry: boolean` only — tells the model it may retry.

### 2.8 `Notification`

- **Trigger**: `EE`, cli.pretty.js:494231, via `AE` (fire-and-forget; the result array is discarded).
- **Matcher**: `notification_type`.
- **Input** (`KQ`): `{…base, message, title?, notification_type}`.
- **Observed `notification_type` values** (grep of `notificationType:` literals):
  `permission_prompt`, `idle_prompt`, `worker_permission_prompt`, `agent_needs_input`,
  `agent_completed`, `auth_success`, `push_notification`, `computer_use_enter`,
  `computer_use_exit`, `elicitation_complete`, `elicitation_response`. The schema types the field as
  a free string, so this is not closed.
- **Honoured output**: `hookSpecificOutput.additionalContext` exists in the schema but `EE` discards
  the results — in practice only `systemMessage` and `terminalSequence` have visible effect, via the
  generic paths. Exit 0 shows nothing; other codes show stderr to the user.

### 2.9 `UserPromptSubmit`

- **Trigger**: `executeUserPromptSubmitHooks` (`bSe`, cli.pretty.js:474043) from `U9`
  (cli.pretty.js:438484). Gated by `oT`.
- **Timeout**: `I_e = 30000` (30 s) — one of the few narrowed events (cli.pretty.js:445027, :474046).
- **Matcher**: none.
- **Input** (`jQ`):
  ```jsonc
  { ...base, "hook_event_name": "UserPromptSubmit", "prompt": "…",
    "source": "user" | "sdk" | "system" | "loop_wakeup" | "schedule_wakeup" | "poll_event",
    "session_title": "…" }
  ```
  `source` semantics are spelled out in the schema (cli.pretty.js:306775): `user` = interactive
  composer, `sdk` = `-p`/Agent SDK, `loop_wakeup` = dynamic `/loop`, `schedule_wakeup` = cron/routine
  fire, `system` = machine-injected turns (peer/channel messages, task notifications,
  auto-continuation), `poll_event` = the poll-event enqueue-time pass where a blocking verdict
  rejects the event. *Caveat*: the constructed object at cli.pretty.js:474036/:474043 spreads
  `...!1` where `source` would go — i.e. **`source` is currently never emitted** in 2.1.251, matching
  the schema note "Payloads may omit it while the field rolls out."
- **Honoured output**: `additionalContext`, `sessionTitle`, `suppressOriginalPrompt`, plus
  `decision:"block"` + `reason`, `continue:false` + `stopReason`.
- **Blocking rendering** — `Q7` (cli.pretty.js:495470):
  ```
  UserPromptSubmit operation blocked by hook:
  {blockingError}
  ```
  wrapped by `WX` (cli.pretty.js:438459) which appends `\n\nOriginal prompt: {text}` **unless**
  `suppressOriginalPrompt` is true.
- **Plain-stdout special case**: for `UserPromptSubmit` (and `UserPromptExpansion`), exit-0 plain
  stdout is promoted into `hookSpecificOutput.additionalContext` automatically
  (cli.pretty.js:94132 on the device path; on the local path plain stdout surfaces as a
  `hook_success` attachment, which is one of only three attachment types rendered to the model —
  see §5.5).
- **Timeout UX**: a timed-out UserPromptSubmit hook renders
  `` `${hookName} hook timed out${after Ns} — output discarded. Raise the hook's "timeout" to allow more time.` ``
  (cli.pretty.js:192672). If the hooks never ran at all, the prompt is blocked with
  `"Prompt blocked: the UserPromptSubmit hooks did not run over the submitted text."`
  (`XX`, cli.pretty.js:438463).

### 2.10 `UserPromptExpansion`

- **Trigger**: `Ldt`, cli.pretty.js:494343. Gated by `oT`. Fires when a typed slash command or MCP
  prompt expands into a prompt.
- **Matcher**: `command_name`.
- **Input** (`WQ`): `{…base, expansion_type: "slash_command"|"mcp_prompt", command_name, command_args,
  command_source?, prompt}`.
- **Honoured output**: `additionalContext`, `suppressOriginalPrompt`, `decision:"block"`.

### 2.11 `SessionStart`

- **Trigger**: `executeSessionStartHooks` (`vUt`, cli.pretty.js:494236). Wrapped in a
  `"startup-hook-hold"` lifecycle token (`Uie`, cli.pretty.js:494235) so the session waits for it.
- **Matcher**: `source` ∈ `startup | resume | clear | compact | fork`.
- **Input** (`YQ`):
  ```jsonc
  { ...base, "hook_event_name": "SessionStart",
    "source": "startup", "agent_type": "…?", "model": "…?", "session_title": "…?",
    // resume/fork only:
    "seconds_since_last_response": 0, "context_tokens": 0,
    "prompt_cache_likely_expired": false, "estimated_cache_write_usd": 0 }
  ```
- **Honoured output**: `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`
  (absolute paths registered with the FileChanged watcher), `reloadSkills`
  (re-scan skill + command directories after SessionStart hooks complete, so skills installed by the
  hook are usable in the same session — cli.pretty.js:453595 calls `sT(); bD(); Tv.emit()`).
- **Special**: HTTP hooks are **skipped** for SessionStart and Setup —
  `` `Skipping HTTP hook ${url} — HTTP hooks are not supported for ${event}` `` (cli.pretty.js:495436).
  `CLAUDE_ENV_FILE` is set for SessionStart/Setup/CwdChanged/FileChanged (cli.pretty.js:494796).
  `SessionStart` and `Setup` are the only two events whose stream-json `hook_started`/`hook_response`
  system messages are always emitted (`SJt = ["SessionStart","Setup"]`, cli.pretty.js:433264).
- **De-duplication on resume**: `frt`/`Zke` (cli.pretty.js:454054) hash SessionStart hook
  attachments so replaying a resumed transcript does not double-inject the same context.

### 2.12 `SessionEnd`

- **Trigger**: `ZSe`, cli.pretty.js:494258, via `AE`.
- **Matcher**: `reason` ∈ `clear | resume | logout | prompt_input_exit | other`
  (`Gqt`, cli.pretty.js:183061).
- **Input** (`RJ`): `{…base, hook_event_name:"SessionEnd", reason}`.
- **Timeout**: adaptive — `getSessionEndHookTimeoutMs` (`nGe`, cli.pretty.js:494392):
  `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` if set and > 0; else the max per-hook `timeout` across
  configured SessionEnd hooks, clamped to `[1500, 60000]` (`oun = 1500`, `b5n = 60000`,
  cli.pretty.js:494390).
- **Output**: essentially ignored; failures are written straight to stderr:
  `` `SessionEnd hook [${command}] failed: ${output}\n` `` (cli.pretty.js:494261). Session hooks are
  then cleared from the registry.

### 2.13 `Stop` / `SubagentStop`

- **Trigger**: `executeStopHooks` (`y9`, cli.pretty.js:494314) — one function, `SubagentStop` when an
  `agentId` is passed.
- **Matcher**: `agent_type` for SubagentStop; none for Stop.
- **Input** (`qQ` / `JQ`):
  ```jsonc
  { ...base, "hook_event_name": "Stop",
    "stop_hook_active": false,
    "last_assistant_message": "…?",
    "background_tasks": [ { "id","type","status","description","command?","agent_type?","server?","tool?","name?" } ],
    "session_crons":   [ { "id","schedule","recurring","prompt" } ] }
  ```
  SubagentStop adds `agent_id`, `agent_transcript_path`, `agent_type`.
  `background_tasks` and `session_crons` are the new "is the session done, or paused waiting on
  background work?" signal (`Gxt`/`qxt`, cli.pretty.js:494268/:494301); descriptions are clipped to
  1000 chars with an in-string `… [+N chars]` marker (`RMe = 1000`).
- **Honoured output**: `additionalContext` (described in the schema as *"Feedback for the model; the
  conversation continues so the model can act on it"*), `decision:"block"` + `reason`,
  `continue:false` + `stopReason`.
- **`stop_hook_active`**: threaded through the turn loop as `stopHookActive`
  (cli.pretty.js:487345); true on any turn that was itself restarted by a Stop-hook block.
- **The Stop-hook loop cap** (cli.pretty.js:487339):
  ```
  A hook blocked the turn from ending ${N} consecutive times — overriding and ending turn.
  For Stop/SubagentStop hooks, check stop_hook_active in the input and return success while it's true.
  Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit.
  ```
  Default cap: `a.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8`. Telemetry
  `tengu_stop_hook_block_count` records `{count, is_subagent, hit_max_turns, hit_cap, goal_active}`.
- **`/goal` integration**: a session-scoped `prompt`-type Stop hook backs the `/goal` feature. On a
  successful evaluation the hook removes itself from the registry (`sessionHooksRegistry.remove`,
  cli.pretty.js:485744) and emits `goal_status`. A prompt hook may return
  `{"ok": false, "impossible": true, "reason": …}` to declare the condition unachievable, which
  fails the goal rather than blocking forever.
- **Stop-hook UI is suppressed**: every attachment renderer returns `null` for
  `hookEvent === "Stop" | "SubagentStop"` (cli.pretty.js:192615, :192641, :192683, :192694) — Stop
  hook noise is folded into a dedicated summary row instead.
- **`turn_end_reactions` mode**: `y9`'s ninth argument selects which hook sources run —
  `"turn_end"` (all), `"turn_end_reactions"` (function hooks only), `"blockable_turn_end"` (skips
  session function hooks).

### 2.14 `StopFailure`

- **Trigger**: `HPe`, cli.pretty.js:494305. Fires **instead of** `Stop` when an API error ended the
  turn. Gated by `oT`.
- **Matcher**: `error`, from the closed set surfaced in `/hooks`: `rate_limit`, `overloaded`,
  `authentication_failed`, `oauth_org_not_allowed`, (`account_on_hold`), `billing_error`,
  `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown`
  (cli.pretty.js:647905).
- **Input** (`XQ`): `{…base, error, error_details?, last_assistant_message?}`.
- **Output**: **ignored** — "Fire-and-forget — hook output and exit codes are ignored."

### 2.15 `SubagentStart`

- **Trigger**: `kUt`, cli.pretty.js:494254.
- **Matcher**: `agent_type`.
- **Input** (`QQ`): `{…base, agent_id, agent_type}`.
- **Honoured output**: `additionalContext` — injected into the *subagent's* context
  (cli.pretty.js:464887).

### 2.16 `PreCompact`

- **Trigger**: `executePreCompactHooks` (`tz`, cli.pretty.js:494122), via `AE`.
- **Matcher**: `trigger` ∈ `manual | auto`.
- **Input** (`ZQ`): `{…base, trigger, custom_instructions: string|null}`.
- **Honoured output**: this is the one event where **plain stdout is the payload**. Successful,
  non-blocked hooks with non-empty trimmed stdout have their output joined with `\n\n` and returned
  as `newCustomInstructions` — appended as custom compaction instructions.
- **Blocking**: a blocked hook contributes to `blockedBy`, which aborts compaction.
- **User display**: builds a `userDisplayMessage` of lines like
  `` `PreCompact [${command}] completed successfully: ${stdout}` `` /
  `` `PreCompact [${command}] failed: ${stdout}` `` (cli.pretty.js:494131).
- Inside a restricted agent context, only `blockedBy` survives (no instruction injection).

### 2.17 `PostCompact`

- **Trigger**: `kPe`, cli.pretty.js:494154, via `AE`. Skipped entirely inside a restricted agent
  context.
- **Matcher**: `trigger`.
- **Input** (`eJ`): `{…base, trigger, compact_summary}` — the summary compaction produced.
- **Output**: only `userDisplayMessage` lines; stdout goes to the user, not the model.

### 2.18 `PreModelSwitch`

- **Trigger**: `mdt`, cli.pretty.js:483324. Timeout `O_e = 30000` (30 s).
- **Matcher**: canonical `to_model`. `nMt` (cli.pretty.js:494950) **strips `[1m]`/`[2m]` context
  suffixes** from the matcher before comparing (so `opus[1m]` matches `opus`), unless stripping would
  empty it.
- **Input** (`rJ` + `_P`, cli.pretty.js:306779/:306777):
  ```jsonc
  { ...base, "hook_event_name": "PreModelSwitch",
    "from_model": "…", "to_model": "…", "requested_model": "opus" | null,
    "source": "command" | "picker" | "sdk",
    "context_tokens": 0, "prompt_cache_warm": true, "cache_ttl": "5m" | "1h",
    "estimated_cache_write_usd": 0.0,
    "pricing": "configured" | "catalog" | "default" }
  ```
- **Honoured output**: `hookSpecificOutput.permissionDecision` `allow|deny|ask` (**no `defer`**) +
  `permissionDecisionReason`. Deny blocks the switch.

### 2.19 `PostModelSwitch`

- **Trigger**: `gdt`, cli.pretty.js:483376. Same matcher/base as PreModelSwitch; `source` widens to
  `command | picker | sdk | auto | resume`.
- **Honoured output**: `additionalContext` — shown to Claude on the next request
  (cli.pretty.js:486566).

### 2.20 `Setup`

- **Trigger**: `RUt`, cli.pretty.js:494245. Same startup-hold token as SessionStart.
- **Matcher**: `trigger` ∈ `init | maintenance`.
- **Input** (`$Q`): `{…base, trigger}`.
- **Honoured output**: `additionalContext`. HTTP hooks are skipped (same rule as SessionStart).

### 2.21 `TeammateIdle`

- **Trigger**: `HUt`, cli.pretty.js:494328. No matcher.
- **Input** (`iJ`): `{…base, teammate_name, team_name}` — `team_name` is marked `@deprecated`
  ("Sessions have a single implicit team").
- **Semantics**: exit 2 shows stderr **to the teammate** and prevents idle (it keeps working).
  Blocking message built by `WU("TeammateIdle", …)` (cli.pretty.js:495352).

### 2.22 `TaskCreated` / `TaskCompleted`

- **Triggers**: `xUt` / `eGe`, cli.pretty.js:494332/:494336. No matcher.
- **Input** (`aJ`/`lJ`): `{…base, task_id, task_subject, task_description?, teammate_name?,
  team_name?}`.
- **Semantics**: exit 2 shows stderr to the model and prevents task creation / completion.
  `preventContinuation` renders as `"TaskCompleted hook prevented continuation"`
  (cli.pretty.js:485811).

### 2.23 `Elicitation`

- **Trigger**: `JSe`, cli.pretty.js:494185, via `AE`. Fires when an MCP server requests user input,
  **instead of** showing the dialog if the hook answers.
- **Matcher**: `mcp_server_name`.
- **Input** (`cJ`): `{…base, mcp_server_name, message, mode?: "form"|"url", url?, elicitation_id?,
  requested_schema?}`.
- **Honoured output**: `hookSpecificOutput.action` ∈ `accept | decline | cancel` plus `content`.
  `decline` also sets a blocking error `` "Elicitation denied by hook" ``.

### 2.24 `ElicitationResult`

- **Trigger**: `QSe`, cli.pretty.js:494196. Fires *after* the user responds; the hook can observe or
  **override** before the answer goes back to the server.
- **Input** (`uJ`): `{…base, mcp_server_name, elicitation_id?, mode?, action, content?}`.
- **Honoured output**: same `action`/`content` override; `decline` yields
  `` "Elicitation result blocked by hook" ``.

### 2.25 `ConfigChange`

- **Trigger**: `Vpt`, cli.pretty.js:494175, via `AE`, when settings files change mid-session.
- **Matcher**: `source` ∈ `user_settings | project_settings | local_settings | policy_settings |
  skills` (`dJ`, cli.pretty.js:306779).
- **Input** (`pJ`): `{…base, source, file_path?}`.
- **Semantics**: exit 2 blocks the change from being applied to the session — **except** for
  `policy_settings`, where every result is force-unblocked (`return C.map(A => ({...A, blocked: !1}))`,
  cli.pretty.js:494179). Managed policy cannot be vetoed by a hook.

### 2.26 `WorktreeCreate`

- **Trigger**: `tGe`, cli.pretty.js:494348, via `AE`. Makes `--worktree` VCS-agnostic.
- **Input** (`gJ`): `{…base, name}` — a suggested worktree slug.
- **Output contract**: the **last non-empty trimmed line of stdout** is taken as the worktree path
  (`h5n`, cli.pretty.js:494360); `http`/`callback` hooks instead return
  `hookSpecificOutput.worktreePath`. Relative paths are resolved against the hook cwd.
- **Errors** (verbatim, cli.pretty.js:494353–:494358):
  - `WorktreeCreate hook failed: hook is configured but did not run (workspace not trusted or matcher mismatch)`
  - `WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath)`
  - `` `WorktreeCreate hook failed: ${failures.join("; ")}` `` (redacted variant: `WorktreeCreate hook failed (stderr redacted)`)
- Presence of a WorktreeCreate hook is what lets `--worktree` work outside git — the startup error
  otherwise reads `Configure a WorktreeCreate hook in settings.json to use --worktree with other VCS
  systems.` (cli.pretty.js:326289).

### 2.27 `WorktreeRemove`

- **Trigger**: `Kpt`, cli.pretty.js:494369. Short-circuits if `IE("WorktreeRemove").length === 0`.
- **Input** (`hJ`): `{…base, worktree_path}`.
- **Semantics**: returns true if *any* hook succeeded; failures log
  `` `WorktreeRemove hook failed [${command}]: ${output}` `` at error level.

### 2.28 `InstructionsLoaded`

- **Trigger**: `Qqe`, cli.pretty.js:494222, when a CLAUDE.md or rule file is loaded.
- **Matcher**: `load_reason`.
- **Input** (`mJ`): `{…base, file_path, memory_type: "User"|"Project"|"Local"|"Managed",
  load_reason: "session_start"|"nested_traversal"|"path_glob_match"|"include"|"compact",
  globs?, trigger_file_path?, parent_file_path?}`.
- **Output**: none honoured. `/hooks` states plainly:
  `This hook is observability-only and does not support blocking.`

### 2.29 `CwdChanged`

- **Trigger**: `AUt`, cli.pretty.js:494214, through the shared `zxt` helper
  (cli.pretty.js:494206) that also invalidates the session env cache (`MO()`).
- **Input** (`EJ`): `{…base, old_cwd, new_cwd}`.
- **Honoured output**: `hookSpecificOutput.watchPaths` (register absolute paths with the FileChanged
  watcher) and `systemMessage`. `CLAUDE_ENV_FILE` is set — bash exports written there apply to
  subsequent Bash tool commands.

### 2.30 `FileChanged`

- **Trigger**: `CUt`, cli.pretty.js:494218.
- **Matcher**: the **basename** of the changed file, e.g. `".envrc|.env"`.
- **Input** (`SJ`): `{…base, file_path, event: "change"|"add"|"unlink"}`.
- **Honoured output**: `watchPaths` (dynamically update the watch list), `systemMessage`.
  `CLAUDE_ENV_FILE` is set.

### 2.31 `DirectoryAdded`

- **Trigger**: `YSe`, cli.pretty.js:494181, via `AE`. Fires **after** `/add-dir` or the SDK
  `register_repo_root` control request, and after sandbox config refresh.
- **Matcher**: `source` ∈ `slash_command | register_repo_root`.
- **Input** (`TJ`): `{…base, directory, source}`.
- **Honoured output**: `systemMessage` values are collected and returned as `systemMessages`. For
  `/add-dir` a failure count is summarised to Claude; for `register_repo_root` everything is
  debug-logged only.

### 2.32 `MessageDisplay`

- **Trigger**: `Zqe`, cli.pretty.js:494226. Fires with each batch of newly completed lines while an
  assistant message streams. Runs with `forceSyncExecution: !0` and
  `suppressPerInvocationTelemetry: !0`.
- **Input** (`AJ`):
  ```jsonc
  { ...base, "hook_event_name": "MessageDisplay",
    "turn_id": "uuid", "message_id": "uuid",   // NOT the API msg_… id
    "index": 0, "final": false, "delta": "the newly completed lines" }
  ```
- **Honoured output**: `hookSpecificOutput.displayContent` — replaces the delta **on screen only**.
  "Display-only: the stored message and what the model sees are untouched."
- `toolUseID` is synthesised as `` `${message_id}-${index}` ``.

---

## 3. Configuration

### 3.1 The settings shape

```js
Qe  = f({ matcher: i().optional().describe('String pattern to match (e.g. tool names like "Write")'),
          hooks:   H(ms()).describe("List of hooks to execute when the matcher matches") })
X$  = jEt(ie(_y), H(Qe()))     // Partial<Record<HookEvent, HookMatcher[]>>
```
— cli.pretty.js:184253. Validation entry point is `CAn` (cli.pretty.js:184255), which reports
`hooks.<event>` errors individually and drops only the bad event, keeping the rest. Two verbatim
errors:

- `` `must be an object mapping hook event names to matcher arrays; received ${…}` ``
- `` `unknown hook event. Valid events: ${_y.join(", ")}` ``

A separate top-level guard at cli.pretty.js:210039 emits, into the settings-error surface:
`` `"hooks" must be an object mapping event names to matcher arrays; received ${s}. This field was ignored.` ``
with `docLink: "https://code.claude.com/docs/en/hooks"`.

`X$` (`HookConfigSchema`) is also embedded in the **agent definition** frontmatter schema
(`hooks: X$().optional()`, cli.pretty.js:451648) — subagents and `--agent` main threads can carry
their own hooks.

### 3.2 Hook types

All five settings-authorable types share `if`, `timeout` (seconds, positive), `statusMessage`, and
`once`. Definitions at cli.pretty.js:184247 (`gs()`).

**`command`**
```jsonc
{ "type": "command", "command": "…", "args": ["…"],
  "if": "Bash(git *)", "shell": "bash" | "powershell",
  "timeout": 60, "statusMessage": "…", "once": false,
  "async": false, "asyncRewake": false,
  "rewakeMessage": "…", "rewakeSummary": "…",   // @internal
  "cloud": "device" | "skip" }                  // @internal
```
- `args` selects **exec form**: `command` is resolved as an executable and spawned directly, no
  shell. `${CLAUDE_PLUGIN_ROOT}`-style placeholders are substituted per element as plain strings so
  paths with quotes/`$`/backticks never reach a shell parser. Without `args`, `command` runs through
  a shell (bash on POSIX; PowerShell on Windows without Git Bash).
- `shell`: `'bash'` uses your `$SHELL` (bash/zsh/sh); `'powershell'` uses pwsh.
- `async`: runs in background without blocking.
- `asyncRewake`: background **and wakes the model on exit code 2**. Implies async.
- `cloud`: where the hook may run when a cloud session is driven from this machine — `"device"`
  offers it even when its script sits somewhere the cloud session can write; `"skip"` never;
  omitted = the default heuristic (offered only if pinnable and outside cloud-writable paths). An
  unrecognised value reads as `"skip"`.

**`prompt`**
```jsonc
{ "type": "prompt", "prompt": "… $ARGUMENTS …", "model": "claude-sonnet-5",
  "continueOnBlock": false, "if": "…", "timeout": 30, "statusMessage": "…", "once": false }
```
- Evaluated by an LLM. Default model: `mm()` (the small fast model). `$ARGUMENTS` is substituted
  with the hook input JSON (`fA`, cli.pretty.js:493526).
- `continueOnBlock` sets the `continue` value on the synthesised `decision:"block"`.

**`agent`**
```jsonc
{ "type": "agent", "prompt": "Verify that unit tests ran and passed.", "model": "…",
  "if": "…", "timeout": 60, "statusMessage": "…", "once": false }
```
- Default model: **Haiku** (schema text) / `mm()` in code. Runs a full tool-using sub-agent.

**`http`**
```jsonc
{ "type": "http", "url": "https://…", "headers": { "Authorization": "Bearer $MY_TOKEN" },
  "allowedEnvVars": ["MY_TOKEN"], "if": "…", "timeout": 30, "statusMessage": "…",
  "once": false, "cloud": "device" | "skip" }
```
- POSTs the hook input JSON. Env-var interpolation in headers requires `allowedEnvVars`; unlisted
  `$VAR` references resolve to empty string with a warning
  (`` `Hooks: env var $${name} not in allowedEnvVars, skipping interpolation` ``, cli.pretty.js:493907).

**`mcp_tool`**
```jsonc
{ "type": "mcp_tool", "server": "my-server", "tool": "check",
  "input": { "path": "${tool_input.file_path}" },
  "if": "…", "timeout": 30, "statusMessage": "…", "once": false }
```
- `input` string values support `${path}` interpolation from the hook input JSON (`c5n`,
  cli.pretty.js:493944) — dotted path lookup, objects JSON-stringified, missing → empty string.

**`callback`** (internal / SDK): `{type:"callback", callback, internal?, timeout?}`. `internal: true`
callbacks are excluded from telemetry counts (`iMt`, cli.pretty.js:495287).

**`function`** (internal): `{type:"function", id, timeout, callback, errorMessage}`, created by
`sessionHooksRegistry.addFunctionHook` with a **5000 ms default timeout**
(cli.pretty.js:431623). These are the plugin hooks-module handlers.

### 3.3 The `if` condition

`X()` (cli.pretty.js:184246):
> *"Permission rule syntax to filter when this hook runs (e.g., `"Bash(git *)"`). Only runs if the
> tool call matches the pattern. Avoids spawning hooks for non-matching commands."*

Evaluated by `O5n` → `rMt` (cli.pretty.js:495042/:495057): only meaningful for the five tool events;
it parses the `if` string as a permission rule, compares the canonical tool name, and — when the rule
has content — runs the tool's own `preparePermissionMatcher`. For any non-tool event the hook is
**skipped** with `` `Hook if condition "${cond}" cannot be evaluated for non-tool event ${event}` ``
(cli.pretty.js:495428).

### 3.4 Matcher grammar

`$Me` (cli.pretty.js:495027) is the whole grammar:

1. Empty matcher, missing matcher, or `"*"` → **matches everything**. (`".*"` also counts as
   match-all for the `matcherIsMatchAll` telemetry flag, cli.pretty.js:495415.)
2. **Fast literal-list path** (`tMt`, cli.pretty.js:494941): if the matcher matches
   `/^[a-zA-Z0-9_|]+$/` — or `/^[a-zA-Z0-9_|, -]+$/` for the "expandable" events in `zie` — split on
   `|` (and `,` for expandable events), canonicalise each token, expand tool aliases, and test for
   **exact membership**. No regex semantics.
3. Otherwise **`new RegExp(matcher)`**, tested against the query, then against each alias variant
   (`MTt`, `Q6`). An invalid pattern logs `` `Invalid regex pattern in hook matcher: ${matcher}` ``
   and matches nothing.

`zie` — the events where comma-separated matchers and alias expansion apply:
```js
new Set(["PreToolUse","PostToolUse","PostToolUseFailure","PermissionRequest","PermissionDenied",
  "UserPromptExpansion","SessionStart","SessionEnd","Setup","PreCompact","PostCompact",
  "PreModelSwitch","PostModelSwitch","Notification","SubagentStart","SubagentStop",
  "Elicitation","ElicitationResult","ConfigChange","InstructionsLoaded","DirectoryAdded"])
```
— cli.pretty.js:495011.

**The MCP wildcard trap** is explicitly warned about (`x5n`, cli.pretty.js:495017), once per matcher:
> `` `Hook matcher \`${m}\` matches no tool (it is compared as an exact string). To match all tools from this server, use \`${m}__.*\`. See CHANGELOG v2.1.195.` ``

triggered when a token starts with `mcp__` and has no second `__` (`jhr`, cli.pretty.js:495013).

### 3.5 Sources and merge order

Three tiers, combined by `IE(event)` (cli.pretty.js:430158):

```js
function IE(e) {
  if (ho("hooks")) return [];                       // --bare: no hooks at all
  let t = zO()?.[e] ?? [];                          // registered: plugin / skill / device
  if (Nv()) return t.filter(d => !("pluginRoot" in d) && !("deviceOwner" in d));
  let r = f_(), o = r && !Dr() ? LW() : null, u = Jpn();
  return [ ...TX()?.[e] ?? [],                      // startup snapshot of settings hooks
           ...(r ? [] : die()?.[e] ?? []),          // main-thread agent definition hooks
           ...t.filter(d => !(r && ("pluginRoot" in d) && !o?.has(d.pluginId))
                         && !(u && ("deviceOwner" in d))) ];
}
```
- `TX()` = `initialHooksConfig` snapshot (cli.pretty.js:7253) — see §7.4.
- `die()` = `getMainThreadAgentHooks` — hooks from the active agent definition
  (`$Ct`, cli.pretty.js:727426).
- `zO()` = `getRegisteredHooks` — plugin hooks (`pluginRoot`/`pluginId`/`pluginName`), skill hooks
  (`skillRoot`/`skillName`), and device-forwarded hooks (`deviceOwner`).

Session-scoped hooks (`/goal`, SDK-added) are layered on top by `Wie` (cli.pretty.js:495359), which
also handles the managed-only shortcut:

```js
if (o?.managedHooksOnly) {
  let C = ye("policySettings");
  if (C?.disableAllHooks === !0) return [];
  return [...C?.hooks?.[r] ?? []];
}
```

The settings-file hook set itself is chosen by `l()` (cli.pretty.js:7192), which is where the kill
switches live:

```js
function l() {
  let o = ye("policySettings");
  if (o?.disableAllHooks === !0) return {};                       // hard off
  if (o?.allowManagedHooksOnly === !0 || Dr()) return o?.hooks ?? {};  // managed-only / safe mode
  if (Fd("hooks")) return o?.hooks ?? {};                          // strictPluginOnlyCustomization
  let t = En();
  if (t.disableAllHooks === !0) return o?.hooks ?? {};             // user disableAllHooks → managed-only
  return t.hooks ?? {};
}
```

Settings-file scan order for the `/hooks` listing is `$H = ["userSettings","projectSettings",
"localSettings"]` (cli.pretty.js:209538); merged settings additionally layer
`policySettings` and `flagSettings` above them.

### 3.6 Deduplication

Before running, identical hooks are collapsed per type. The canonical key is `AM(hook)`
(cli.pretty.js:495227):

| type | key |
|---|---|
| command | `command\0{shell}\0{command}\0{JSON(args)}\0{if}` |
| http | `http\0{url}\0{if}` |
| mcp_tool | `mcp_tool\0{server}\0{tool}\0{JSON(input)}\0{if}` |
| prompt / agent | `{prompt}\0{if}` (built inline at cli.pretty.js:495419) |

The dedupe map key is `Lq(entry, key)` = `` `${pluginRoot ?? skillRoot ?? ""}\0${key}` ``
(cli.pretty.js:495290) — so the *same* command declared in two settings scopes runs once, but the
same command shipped by two different plugins runs twice.

`callback` and `function` hooks are never deduped. The result is logged as
`` `Matched ${N} unique hooks for query "${q}" (${M} before deduplication)` `` (cli.pretty.js:495438).

---

## 4. The execution engine

### 4.1 `Nq` — spawning a `command` hook

`Nq` (cli.pretty.js:494730) is the single command-hook spawner. Sequence:

1. **Warn on mixed form**: `args` present *and* whitespace in `command` with no path separator →
   `` `Hook command "${cmd}" has both "args" and whitespace in "command". Exec form treats "command" as a single executable name; move the rest into "args". Example: { "command": "node", "args": ["script.js"] }.` ``
2. **PowerShell fix-ups**: `$CLAUDE_PROJECT_DIR` → warn that PowerShell reads it as `$null`, use
   `$env:CLAUDE_PROJECT_DIR` or `${CLAUDE_PROJECT_DIR}` (cli.pretty.js:494741); `m6n`
   (cli.pretty.js:496266) rewrites `${VAR}` → `${env:VAR}` for the three CLAUDE_* placeholders.
3. **Placeholder guards**: referencing `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_DATA}` from a
   non-plugin hook throws
   `` `Hook command references ${…} but the hook is not associated with a plugin. This variable is only available in hooks defined in a plugin's hooks/hooks.json file, not in settings.json. Command: …` ``
   (skill hooks get a variant saying only `${CLAUDE_PLUGIN_ROOT}` is available).
4. **Plugin existence check**: `` `Plugin directory does not exist: ${root} (${pluginId} — run /plugin to reinstall)` ``.
5. **`${user_config.*}` guard**: a plugin hook that interpolates user config into a *shell-form*
   command is refused —
   `` `Hook from plugin X references ${user_config.*} in a shell-form command. The substituted value would be re-parsed by the shell. Use exec form instead — {"command": "<executable>", "args": ["${user_config.KEY}", ...]} — or read $CLAUDE_PLUGIN_OPTION_<KEY> from the hook's environment.` ``
6. **Timeout**: `nn = e.timeout ? e.timeout * 1000 : Li` (600 000 ms).
7. **Env** (see §4.2), **cwd** (see §4.3), **spawn**.
8. **stdin**: the JSON input plus a trailing `\n`, then `end()`. `EPIPE` is caught and reported as
   `Hook command closed stdin before hook input was fully written (EPIPE)`.
9. **Async sniffing**: stdout is watched; the moment the accumulated buffer contains a `}` it is
   parsed once; if it is `{"async": true, …}` the process is backgrounded (unless
   `forceSyncExecution`).
10. **Output post-processing**: `q6()` (cli.pretty.js:431833) strips `<claude-code-hint …/>` markup
    from stdout/stderr/combined output before the harness sees it — a hook cannot forge harness hints.

Spawn details: `detached: true` on non-Windows, `windowsHide: true`. Shell resolution: PowerShell via
`gv()` — absent, it throws
`` `Hook "${cmd}" has shell: 'powershell' but no PowerShell executable (pwsh or powershell) was found on PATH. Install PowerShell, or remove "shell": "powershell" to use bash.` ``
On Windows without Git Bash: `` `Hook "${cmd}" requires bash but Git Bash was not found. Install Git for Windows (https://git-scm.com/downloads/win), or add "shell": "powershell" to this hook's config.` ``

### 4.2 Environment passed to command hooks

Built at cli.pretty.js:494777–:494796. Base is the harness's own env (`Na()`), or a per-device
override base with an `omit` list for served calls, then:

| variable | source |
|---|---|
| `CLAUDECODE=1` | `Oxe`, cli.pretty.js:431799 |
| `CLAUDE_CODE_SESSION_ID` | session id |
| `CLAUDE_CODE_CHILD_SESSION=1` | always |
| `CLAUDE_PID` | `String(process.pid)` |
| `AI_AGENT` | only when the input's source is `agent` |
| `CLAUDE_EFFORT` | when `effort.level` is present |
| `TRACEPARENT` | when OTel tracing is on |
| `CLAUDE_PROJECT_DIR` | project root (backslashes → `/` on Windows bash form) |
| `COLUMNS`, `LINES` | from `process.stdout` if a TTY |
| `CLAUDE_PLUGIN_ROOT` | plugin root, or the skill root for skill hooks |
| `CLAUDE_PLUGIN_DATA` | plugin data dir (plugin hooks only) |
| `CLAUDE_PLUGIN_OPTION_<KEY>` | one per plugin user-config key, name uppercased with non-alphanumerics → `_` |
| `CLAUDE_ENV_FILE` | SessionStart / Setup / CwdChanged / FileChanged only (`_2e`, cli.pretty.js:431484 → `<session-env>/<event>-hook-<idx>.sh`) |
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` | **only** for first-party official plugins on the `tengu_amber_lattice` allowlist (`Ghr`, cli.pretty.js:495319), and only when not sandboxed, not on a unix socket, etc. |
| `CLAUDE_CODE_CLOUD_SESSION_ID` | device-forwarded hooks for cloud sessions (cli.pretty.js:94061) |

A global `CLAUDE_CODE_SHELL_PREFIX` (or a per-device `shellPrefix`) is prepended to shell-form
commands (cli.pretty.js:494776).

### 4.3 Working directory

`safeHookCwd` (`uun`, cli.pretty.js:495951): use `hookInput.cwd` if it still exists; otherwise fall
back through `originalCwd`, `projectRoot`, home, warning once per host:
`` `Hooks: working directory ${cwd} no longer exists; running hooks from ${fallback} instead` ``.

### 4.4 Parallelism and progress

- All matched hooks are mapped to async generators and merged with `QZ(Xe)` — **no concurrency
  limit** (cli.pretty.js:495815; `QZ` at cli.pretty.js:459747 takes an optional cap that is not
  supplied here).
- Before any hook runs, one `hook_progress` progress message is emitted per hook, carrying
  `command` (or `statusMessage`, via `ck`, cli.pretty.js:433095) and, for prompt hooks, `promptText`.
- While a hook runs, `a3` (cli.pretty.js:433291) polls its output every **1000 ms** and emits
  stream-json `hook_progress` system messages — but only for events where `o3()` is true
  (cli.pretty.js:433276): always `SessionStart`/`Setup`, otherwise only when
  `setAllHookEventsEnabled(true)` has been called.

### 4.5 Output size caps

- **Persist-to-disk threshold**: `Z8n = 1e4` (10 000 chars, cli.pretty.js:128009). `persistHookOutput`
  (`yce`, cli.pretty.js:494462) spills anything longer to disk and replaces it with a pointer; on
  failure it truncates and appends
  `` `[Hook ${kind} truncated at ${threshold} chars — persist-to-disk failed: ${err}]` ``.
  Applied to `stdout`, `additionalContext`, `systemMessage`, and `initialUserMessage`.
- **classifierContext**: hard cap 2000 UTF-16 code units (`fP`, cli.pretty.js:433152).
- **`rewakeSummary`**: 300 chars (`k5n`, cli.pretty.js:494382).
- **Plugin `metrics`**: first 20 entries, booleans and numbers only (`a6n = 20`,
  cli.pretty.js:495339).
- **Launcher (CCR) hooks**: script size limited to `is = 131072` bytes (cli.pretty.js:124362).

### 4.6 Async hooks

Two mechanisms, both in `Nq`/`Kxt`:

**Config-based** (`"async": true` on the hook): stdin is written and the process is immediately
backgrounded; `Nq` returns `{stdout:"", stderr:"", output:"", status:0, backgrounded:true}`.

**Announced** (`{"async": true, "asyncTimeout": ms}` as the first JSON on stdout): detected by the
stdout sniffer, backgrounded mid-flight. Default async timeout **15 000 ms**
(`r.asyncTimeout || 15000`, cli.pretty.js:433397).

Backgrounded hooks are tracked in a `dVe` registry (cli.pretty.js:433370). `mVe`
(cli.pretty.js:433410) polls them; when the shell command completes it scans stdout line by line for
the **first non-`async` JSON object** and delivers it as an `async_hook_response` attachment. That
attachment is parsed leniently by `uVe` (cli.pretty.js:494042): schema-valid → used whole; otherwise
only `systemMessage`, `metrics`, and `hookSpecificOutput` are salvaged, with
`` `${name} async hook JSON output failed schema validation (…); ignored malformed field(s): …` ``.
For the model, only `systemMessage` and `hookSpecificOutput.additionalContext` survive
(cli.pretty.js:518971). In the UI it renders as `Async hook <event> completed`
(cli.pretty.js:192603) — suppressed entirely for SessionStart.

**`asyncRewake`** (`Kxt`, cli.pretty.js:494400) is the third mode: the hook runs detached, and if it
exits **2** the harness injects a wake-up into the conversation:
```js
HO({ summary: rewakeSummary ?? "Stop hook feedback",
     body: `${rewakeMessage ?? `Stop hook blocking error from command "${name}":`} ${stderr || stdout}`,
     priority: "next", stopHookActive: !0 });
```
`ASYNC_REWAKE_FLUSH_TIMEOUT_MS = 30000` (`Uhr`, cli.pretty.js:494382); pending rewakes are drained by
`flushPendingAsyncRewakeHooks` (`iun`, cli.pretty.js:494394).

---

## 5. Result contract

### 5.1 Exit codes (command / mcp_tool paths)

Decided in `Qxt` at cli.pretty.js:495741–:495790:

| exit | stdout parse | outcome |
|---|---|---|
| any | invalid JSON *and* exit ≠ 2 | `non_blocking_error`; stderr becomes `` `${validationError}\n\nHook exited ${code} with stderr:\n${stderr}` `` (`Xpt`, cli.pretty.js:494508) |
| 0 | valid JSON | `Fq` mapping (§5.2); if `!suppressOutput` and there was plain text too, also a `hook_success` attachment with content `` `${hookName} completed` `` |
| 0 | plain text | `hook_success` attachment carrying the trimmed stdout |
| 2 | — | **blocking**: `` {blockingError: `[${command}]: ${stderr || "No stderr output"}`} `` — unless JSON already produced one |
| 2 | — but looks like a missing script | downgraded to `non_blocking_error` (see below) |
| other | — | `non_blocking_error`, stderr shown to the user: `` `Failed with non-blocking status code: ${stderr.trim() || "No stderr output"}` `` |

**Missing-script downgrade** (`exitTwoMeansMissingScript` = `PUt`, cli.pretty.js:494914): for
`Stop`, `SubagentStop`, `TaskCompleted`, `TeammateIdle`, and plugin-owned `UserPromptSubmit` hooks,
an exit 2 with empty stdout and a stderr matching `/no such file|can't open/i` is treated as
non-blocking:
> `` `Hook script appears to be missing — "${cmd}" exited 2 with: ${stderr}. Treating as non-blocking. Run \`/plugin\` to reinstall '${pluginId}' or remove it from settings.` ``

**Announced-async then failed**: `` `Announced async, then failed with status code ${code}: ${stderr}` ``.

`ranByContract` is set when the process exited normally with a status ≤ 128 that is not 126/127 —
used only on the served-call path to decide whether a failed PreToolUse gate should refuse.

### 5.2 The JSON stdout protocol

Top-level schema (`J7t`, cli.pretty.js:432729):

| field | type | meaning |
|---|---|---|
| `continue` | boolean | `false` ⇒ `preventContinuation` |
| `stopReason` | string | shown when `continue` is false |
| `suppressOutput` | boolean | hide stdout from transcript |
| `decision` | `"approve" \| "block"` | legacy; `approve` ⇒ allow, `block` ⇒ deny + `blockingError: reason \|\| "Blocked by hook"` |
| `reason` | string | explanation |
| `systemMessage` | string | warning shown to the user |
| `terminalSequence` | string | escape sequence Claude Code emits on your behalf |
| `hookSpecificOutput` | union | per-event, must carry `hookEventName` |
| `metrics` | object | plugin telemetry — booleans/numbers, plugin hooks only (not in the zod object; salvaged separately) |

**`terminalSequence`** is validated by an allowlist (`bge`/`yJt`, cli.pretty.js:433180): only OSC
0, 1, 2, 9, 99, 777 and BEL; OSC 9 bodies may not begin with a digit unless in the `9;4` progress
form; total ≤ `fJt` bytes. Rejection logs:
> `` `Hook ${name} (${event}) returned a terminalSequence that was rejected by the allowlist (only OSC 0/1/2/9/99/777 and BEL are permitted, and OSC 9 bodies may not begin with a digit unless in the 9;4 progress form)` ``

`hookSpecificOutput` variants, in schema order:

| hookEventName | fields |
|---|---|
| PreToolUse | `permissionDecision` (`allow\|deny\|ask\|defer`), `permissionDecisionReason`, `updatedInput`, `additionalContext` |
| UserPromptSubmit | `additionalContext`, `sessionTitle`, `suppressOriginalPrompt` |
| UserPromptExpansion | `additionalContext`, `suppressOriginalPrompt` |
| SessionStart | `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths[]`, `reloadSkills` |
| Setup | `additionalContext` |
| PreModelSwitch | `permissionDecision` (`allow\|deny\|ask`), `permissionDecisionReason` |
| PostModelSwitch | `additionalContext` |
| SubagentStart | `additionalContext` |
| PostToolUse | `additionalContext`, `classifierContext`, `updatedToolOutput`, `updatedMCPToolOutput` |
| PostToolUseFailure | `additionalContext` |
| PostToolBatch | `additionalContext` |
| Stop | `additionalContext` |
| SubagentStop | `additionalContext` |
| PermissionDenied | `retry` |
| Notification | `additionalContext` |
| PermissionRequest | `decision: {behavior:"allow", updatedInput?, updatedPermissions?} \| {behavior:"deny", message?, interrupt?}` |
| Elicitation | `action` (`accept\|decline\|cancel`), `content` |
| ElicitationResult | `action`, `content` |
| CwdChanged | `watchPaths[]` |
| FileChanged | `watchPaths[]` |
| WorktreeCreate | `worktreePath` (required) |
| MessageDisplay | `displayContent` |

Two mismatch guards in `Fq` (cli.pretty.js:494558):
- `` `Unknown hook decision type: ${decision}. Valid types are: approve, block` ``
- `` `Unknown hook permissionDecision type: ${d}. Valid types are: allow, deny, ask, defer` ``
- `` `Hook returned incorrect event name: expected '${expected}' but got '${got}'. Full stdout: ${json}` ``

### 5.3 Parse behaviour

`parseHookOutput` (`xPe`, cli.pretty.js:494470):
- stdout not starting with `{` → plain text: `"Hook output does not start with {, treating as plain text"`.
- `{"async": true}` → the async marker.
- valid JSON, schema-valid → used. Unknown keys are **ignored with a log**
  (`p3`, cli.pretty.js:433315): `` `Hook JSON output had unrecognized keys (ignored): ${keys}.` `` plus,
  when `additionalContext` was placed at the top level,
  `` " Did you mean hookSpecificOutput.additionalContext (with a hookEventName)?" ``.
- valid JSON, schema-invalid → validation error prefixed
  `"Hook JSON output validation failed — "` (`vMe`, cli.pretty.js:494012), followed by the field
  error, sibling errors, the offending payload, and the whole expected schema pretty-printed by
  `jxt()` (cli.pretty.js:494051).
- Special-cased messages (`Hxt`, cli.pretty.js:494036):
  - `hookSpecificOutput is missing required field "hookEventName"`
  - `` ' (top-level decision is the legacy approve|block field; for "ask" use hookSpecificOutput.permissionDecision in a PreToolUse hook)' ``
  - `` ` (top-level decision is the legacy approve|block field; for "${d}" use hookSpecificOutput.permissionDecision in a PreToolUse hook, or hookSpecificOutput.decision: {"behavior": "${d}"} in a PermissionRequest hook)` ``
- Several JSON documents on separate lines, each parsing to an empty/invalid object → treated as
  plain text ("Hook output is several JSON documents, treating as plain text").
- Starts with `{`, ends with `}`, but unparseable →
  > `` `Hook output looks like a JSON object but is not valid JSON — ${err}. Emit the payload with a JSON encoder (jq, ConvertTo-Json, json.dumps) rather than string concatenation so backslashes and quotes inside strings are escaped.` ``

HTTP hooks use a stricter parser (`Ypt`, cli.pretty.js:494512): empty body → empty object;
non-JSON body → `` `HTTP hook must return JSON, but got non-JSON response body: ${body.slice(0,200)}…` ``.

### 5.4 Precedence across hooks

Accumulated in `Qxt` (cli.pretty.js:495878):

```js
switch (behavior) {
  case "deny":  winner = "deny"; break;
  case "defer": if (winner !== "deny") winner = "defer"; break;
  case "ask":   if (winner !== "deny" && winner !== "defer") winner = "ask"; break;
  case "allow": if (!winner) winner = "allow"; break;
  case "passthrough": break;
}
```
A result is only yielded when `winner === thisHook.behavior`, so once a deny lands, later allows are
swallowed. `blockingError` also forces `winner = "deny"` (cli.pretty.js:495861).

Non-decision outputs are **not** exclusive: every hook's `additionalContext`, `systemMessage`,
`watchPaths`, `classifierContext`, `sessionTitle`, `initialUserMessage` are all yielded, in arrival
order. `updatedToolOutput` from multiple PostToolUse hooks is last-write-wins — the
`classifierContext` schema text warns about exactly this ("hooks run in parallel on the ORIGINAL
output, so an identity rewrite competes last-write-wins with sibling rewrites and can clobber a real
redaction").

### 5.5 What the model actually sees

`hl()` is the system-reminder wrapper (cli.pretty.js:518353):
```js
function hl(e) { return `<system-reminder>\n${e}\n</system-reminder>`; }
```

Attachment → model-content mappers (cli.pretty.js:518670, :518981):

| attachment | rendered to model as |
|---|---|
| `hook_blocking_error` | `` `${hookName} hook blocking error from command: "${command}": ${blockingError}` `` (system-reminder) |
| `hook_additional_context` | `` `${hookName} hook additional context: ${content.join("\n")}` `` (system-reminder) |
| `hook_stopped_continuation` | `` `${hookName} hook stopped continuation: ${message}` `` (system-reminder) |
| `hook_success` | **only for SessionStart / UserPromptSubmit / UserPromptExpansion**, and only with non-empty content: `` `${hookName} hook success: ${content}` `` (system-reminder) |
| `hook_system_message` | a plain meta user message (no system-reminder wrapper), also mirrored to the user UI |
| `async_hook_response` | `systemMessage` and `hookSpecificOutput.additionalContext` as plain meta messages |
| `hook_non_blocking_error`, `hook_error_during_execution`, `hook_cancelled`, `hook_deferred_tool` | **nothing** — user-facing only |

For `Stop`/`SubagentStop` specifically, `oGe` = `getStopHookMessage` (cli.pretty.js:495455) wraps the
blocking error via `WU("Stop", …)`, and the result is injected as a meta user message that restarts
the turn.

The system prompt tells the model how to interpret all this (`_8t`, cli.pretty.js:430420):
> *"Users may configure 'hooks', shell commands that execute in response to events like tool calls,
> in settings. Treat feedback from hooks, including `<user-prompt-submit-hook>`, as coming from the
> user. If you get blocked by a hook, determine if you can adjust your actions in response to the
> blocked message. If not, ask the user to check their hooks configuration."*

### 5.6 What the user sees

UI renderers at cli.pretty.js:192615–:192710. Key strings:
- `` `${hookName} hook returned blocking error` `` + the trimmed error (error colour)
- `` `${hookName} hook error` `` + stderr/stdout
- `` `${hookName} hook warning` `` (execution error)
- `` `${hookName} hook stopped continuation: ${message}` `` (warning colour)
- `` `${hookName} deferred ${toolName} · resume with -p --resume to continue` ``
- `` `${hookName} hook timed out${after Ns} — output discarded. Raise the hook's "timeout" to allow more time.` `` (UserPromptSubmit only)
- `Async hook ${event} completed`
- Stop/SubagentStop: all suppressed; instead a per-turn row `Ran N PreToolUse hooks (Nms)`
  (cli.pretty.js:193426) and a `stop`/`subagent stop` summary (cli.pretty.js:168636).
- On PreToolUse/PermissionRequest failure the spinner picks up a one-line note via `sk.noteHookFailure`
  built by `Wxt` (cli.pretty.js:494054): `` `${event} hook output invalid: …` `` /
  `` `${event} hook failed: ${firstNonEmptyLine}` `` / `` `${event} hook failed to run` ``.

### 5.7 Stream-JSON surface

`eu` (cli.pretty.js:433304) emits, gated by `o3(event)`:
```jsonc
{"type":"system","subtype":"hook_response","hook_id":"…","hook_name":"…","hook_event":"…",
 "output":"…","stdout":"…","stderr":"…","exit_code":0,"outcome":"success"|"error"|"cancelled"}
```
plus `hook_started` (cli.pretty.js:433283) and `hook_progress` (cli.pretty.js:433287). `outcome` is
one of `success | error | cancelled`. The transcript-format documentation embedded in the bundle
describes the attachment form (cli.pretty.js:215421):
> `` Hook runs: `{"type":"attachment","attachment":{"type":"hook_success"|"hook_non_blocking_error"|"hook_error_during_execution"|"hook_cancelled","hookName":...,"hookEvent":...,"command":...,...}}` ``

---

## 6. Special integrations

### 6.1 `prompt` hooks — how the LLM evaluation works

`Cxt`, cli.pretty.js:493523.

- For `Stop`/`SubagentStop` the user's prompt is wrapped:
  ```
  Based on the conversation transcript above, has the following stopping condition been satisfied?
  Answer based on transcript evidence only.

  Condition: {prompt}
  ```
- System prompt (Stop variant) demands strict JSON:
  ```
  - {"ok": true,  "reason": "<quote evidence from the transcript that satisfies the condition>"}
  - {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
  - {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}
  ```
  with an explicit instruction not to defer to the assistant's own claim of impossibility.
  The non-Stop variant is a shorter two-shape version without `impossible`.
- Enforced by `outputFormat: {type:"json_schema", schema:{…required:["ok","reason"]…}}`,
  `thinkingConfig: {type:"disabled", mechanical:true}`, `tools: []`, `querySource: "hook_prompt"`.
- Transcript is passed for Stop hooks, truncated to **50 %** of the model's context window
  (`Axt = 0.5`, `MYn`, cli.pretty.js:493588) with a `[Earlier conversation truncated …]` preamble; a
  prompt-too-long error retries at 25 %.
- `ok: false` → `outcome: "blocking"`, `blockingError = "[{prompt}]: {reason}"`, and
  `preventContinuation` unless the event is Stop/SubagentStop or `continueOnBlock` is set.
- Timeout: `e.timeout ? *1000 : 30000`. On timeout, telemetry `tengu_hook_prompt_timeout` and the
  hook is reported cancelled.

### 6.2 `agent` hooks

`Oxt`, cli.pretty.js:493697.

- Runs a real sub-agent (`Kx`, `querySource: "hook_agent"`) with the session's tools **minus**
  the structured-output tool, the agent tool, and one more; plus a synthetic report tool (`Ext()`).
- System prompt: *"You are verifying a stop condition in Claude Code…"* / *"You are evaluating a
  {event} hook in Claude Code…"*, told the transcript path and to *"Use as few steps as possible"*.
- Agent id is prefixed `hook-agent-` (`$ie`, cli.pretty.js:493696); the agent runs in `dontAsk`
  permission mode with a session-scoped `Read(/{transcript})` grant.
- Hard cap **50 turns**; timeout `e.timeout ? *1000 : 60000`.
- Result shape is the same `{ok, reason, impossible?}` as prompt hooks.
- For a call served to a cloud session, the agent's `canUseTool` is wrapped (`e5n`,
  cli.pretty.js:493757) to refuse destructive Bash commands:
  `` `A hook agent evaluating a call served for a cloud session may not run a destructive command here (${tool}); refused.` ``

### 6.3 PreToolUse input rewriting

Covered in §2.2. The one subtlety worth restating: `updatedInput` is applied *only* when the hook's
own verdict is `allow` or `ask`, or when the hook returns `updatedInput` with **no** permission
decision at all (cli.pretty.js:495903/:495907). A `deny` that also carries `updatedInput` drops it.

### 6.4 UserPromptSubmit context injection and blocking

Covered in §2.9. Additional plumbing: `DUt` = `userPromptSubmitHooksKey` (cli.pretty.js:495384)
builds a stable JSON fingerprint of the currently-registered UserPromptSubmit hooks (managed set +
full set), used to detect config drift mid-turn; `j6e` (cli.pretty.js:438471) answers "does anything
screen prompts at all".

### 6.5 Stop-hook loops

Covered in §2.13. Three separate ceilings can end a Stop-block loop:
`maxTurns` (`max_turns_reached`), `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (default 8), and the abort signal.

### 6.6 PreCompact custom instructions

Covered in §2.16. Note the asymmetry: PreCompact is the only event where **plain stdout is a
first-class payload** rather than a transcript-only artifact.

### 6.7 SessionStart context, watchPaths, and reloadSkills

Covered in §2.11. `watchPaths` from SessionStart/CwdChanged/FileChanged all feed the same
`srt(paths)` watcher registration (cli.pretty.js:453596), which is what makes FileChanged hooks
usable at all — the watcher starts empty.

### 6.8 Device-forwarded hooks (cloud sessions driven from this machine)

A whole parallel path in `chunk-3wvhe393.js` (cli.pretty.js:93799+) lets a cloud session ask *this*
machine to run *its* hooks. Notable pieces:

- Exit-class mapping mirrors the local one but adds `spawn_failed`, `timeout`, and `cancelled`
  classes (`Vn`, cli.pretty.js:94093).
- A timeout that "fails closed" for PreToolUse/UserPromptSubmit/UserPromptExpansion produces
  `` `[${label}]: timed out after ${N}s on the attached machine` `` as a deny; otherwise it is a
  local warning with the output discarded.
- Held-hook reasons (`fge`, cli.pretty.js:433071) are user-facing prompts, e.g.
  *"A hook whose script lives inside the synced project would normally judge this command — it is not
  run for a call from a cloud session, which can rewrite that script — approve running the command?"*
- `prompt`/`agent` hooks are never offered to served calls: `$5n` (cli.pretty.js:495083) converts
  them into a PreToolUse `ask`.
- A PreToolUse `mcp_tool` gate that fails on a served call **refuses rather than skips**:
  `` `a PreToolUse mcp_tool hook here ${reason} for a call served for a cloud session; refusing rather than skipping that gate` `` (cli.pretty.js:495705).
- `/hooks` carries the consent dialog: *"Let cloud sessions started from this machine run its hooks?"*
  with *"Yes, run this machine's hooks for cloud sessions"* / *"No, keep them on this machine only"*.

---

## 7. Ops

### 7.1 `/hooks`

Slash command definition (cli.pretty.js:503917):
```js
{ type: "local-jsx", name: "hooks", description: "View hook configurations for tool events",
  immediate: !0, requires: { workspace: !1, ink: !0 } }
```
Note the description: **view**. The dialog is read-mostly:
- `"To add hooks, edit settings.json directly or ask Claude"`
- `"To modify or remove this hook, edit settings.json directly or ask Claude to help."`
- `"No hooks configured for this event"`

It does list every event with a one-line summary and a per-event description of the exit-code
contract and matcher field (`vo()`, cli.pretty.js:647878 — reproduced per event in §2). It lists
hooks from `userSettings`/`projectSettings`/`localSettings` (`wzn`, cli.pretty.js:433100) plus plugin
hooks from the live registry (`Vo`, cli.pretty.js:647995). It also owns the cloud-consent flow (§6.8).

Opening `/hooks` reloads the hook config — the bundled `update-config` skill tells the user exactly
that when a freshly written hook does not fire (cli.pretty.js:216399):
> *"the settings watcher isn't watching `.claude/` — it only watches directories that had a settings
> file when this session started. The hook is written correctly. Tell the user to open `/hooks` once
> (reloads config) or restart…"*

The onboarding tip (cli.pretty.js:660435):
> *"Hooks run your own scripts on events: before a tool call, after a response, on session start. Use
> them to enforce rules, log activity, or inject context. Run /hooks to see what fires when."*

and the feature blurb (cli.pretty.js:502850):
> *"**Hooks** allow you to run shell commands automatically on lifecycle events: get notified when
> Claude is blocked on your input, auto-format after edits, enforce checks before commits — these are
> deterministic and Claude can't skip them."*

### 7.2 Disable switches

| switch | effect |
|---|---|
| `--bare` (`ho("hooks")`) | `IE()` returns `[]` — no hooks at all |
| `policySettings.disableAllHooks` | `Nv()` true; `l()` returns `{}`; `Wie` managed path returns `[]`; SDK callback hooks still run (`"Policy disableAllHooks: skipping configured hooks for ${event} (SDK callback hooks still run)"`, cli.pretty.js:495961) |
| `policySettings.allowManagedHooksOnly` | `ywe()` true → only managed-settings hooks |
| safe mode (`Dr()`) | equivalent to managed-only; also `"Safe mode: skipping plugin hook registration"` |
| `strictPluginOnlyCustomization` incl. `"hooks"` (`Fd`) | falls back to policy hooks |
| user/flag `disableAllHooks` | **promotes** the session to managed-only (`ywe()` returns true), it does not turn hooks off entirely |

Schema text: `disableAllHooks: "Disable all hooks and statusLine execution"`;
`allowManagedHooksOnly: "When true (and set in managed settings), only hooks from managed settings
run. User, project, and local hooks are ignored."` (cli.pretty.js:111638). Both are marked
`restrictive: !0` in the policy-restriction table (cli.pretty.js:210499).

The disabled-state `/hooks` screen (title `Hook configuration · disabled`, cli.pretty.js:648760):
> `All hooks are currently **disabled**[ by a managed settings file]. You have **N** configured hook(s) that is/are not running.`
> `When hooks are disabled:` · `No hook commands will execute` · `StatusLine will not be displayed` ·
> `Tool operations will proceed without hook validation`
> `To re-enable hooks, remove "disableAllHooks" from settings.json or ask Claude.`

Managed-only banner: `Only hooks from managed settings can run. User-defined hooks from
~/.claude/settings.json, .claude/settings.json, and .claude/settings.local.json are blocked.`

`/goal` is gated on the same switches:
`` "/goal can't run while hooks are restricted (disableAllHooks or allowManagedHooksOnly is set in settings or by policy)." `` (cli.pretty.js:7291).

Also: `"Status line is configured but disableAllHooks is true"` (cli.pretty.js:157348) — the status
line rides the same spawn path.

### 7.3 Trust gate

Both runners refuse outright when the workspace is untrusted:
`` `Skipping ${event} hook execution - workspace trust not accepted` `` (`shouldSkipHookDueToTrust`
= `J7`, cli.pretty.js:494442 / used at :495539 and :495961).

### 7.4 Startup snapshot semantics

`d` class at cli.pretty.js:7161 holds `{initialHooksConfig: null}` per snapshot key. `TX()`
(cli.pretty.js:7253) lazily fills it from `l()` and never refreshes on its own; `Qpn()`/`avr()`/`OD()`
(cli.pretty.js:7231) explicitly re-`store()` it. Startup captures it in the boot sequence
(cli.pretty.js:326280) with telemetry `setup_hooks_snapshot_ms` / `setup_hooks_captured`.

Practical consequence for a re-implementer: **settings-file hooks are frozen at process start**;
plugin, skill, session, and agent hooks are read live on every fire.

### 7.5 Plugin hooks

- Plugins contribute via `hooksConfig` merged into the registry with
  `{matcher, hooks, pluginRoot, pluginName, pluginId}` (cli.pretty.js:483091).
- `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` substitution and the exec-form requirement for
  `${user_config.*}` are described in §4.1.
- Plugin gating messages (cli.pretty.js:483119):
  - `` `hooks module of plugin "${n}" not loaded: disableAllHooks in managed settings` ``
  - `` `hooks module of plugin "${n}" not loaded: hooks are disabled in this mode (--bare)` ``
  - `` `… an admin stood the guard down (safe mode / managed allowManagedHooksOnly)` ``
  - `` `… only managed plugins run (allowManagedHooksOnly / disableAllHooks)` ``
  - `` `hooks module of plugin "${n}" from ${source} not loaded: another plugin of that name loads first (a managed one, or an earlier source)` ``
- Per-plugin telemetry: `tengu_hook_plugin_injected` (char counts by category) and
  `tengu_hook_plugin_metrics` (the hook's own `metrics` object, ≤20 numeric/boolean entries), both
  only for `@`-scoped plugin ids (`Gie`, cli.pretty.js:495294).

### 7.6 Bundled launcher hooks

A small set of first-party hook scripts ships with the CLI (cli.pretty.js:44267), pinned by SHA-256:
```js
[{ id: "gh-api-readonly",  event: "PreToolUse",  matcher: "Bash",        interpreter: "python3",
   filename: "gh-api-readonly.py", maxBytes: 262144, requires: ["python3"] },
 { id: "ruff-autofix",     event: "PostToolUse", matcher: "Edit|Write",  interpreter: "python3",
   filename: "post-edit-lint.py",  maxBytes: 65536, requires: ["python3","ruff"] }]
```
The self-hosted-runner `launcher_hooks` validator (cli.pretty.js:124362) restricts these to
`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}\.(py|sh)$`, ≤ 131072 bytes, and to the nine events
`Stop, SubagentStop, UserPromptSubmit, SessionStart, SessionEnd, PreToolUse, PostToolUse, PreCompact,
Notification`. It also warns when a repo's own settings would suppress them:
> `` [runner:session] launcher_hooks materialized, but a repo .claude/settings.json or settings.local.json carries disableAllHooks:true — the child will drop every flagSettings hook (CCR-supplied Stop reply-gate included) ``

---

## 8. The hooks worker (`hooks-worker.js`) — what it actually is

**Important correction to the common assumption**: `hooks-worker.js` is **not** the runner for
shell-command hooks. Shell hooks are spawned inline by `Nq` in the main process. The worker is the
sandbox for **plugin *function hooks*** — the `functionHooks` plugin subsystem, where a plugin ships
a JS module that registers typed handlers.

Spawn (cli.pretty.js:446608):
```js
var AQ = (e) => ({ name: "hooks", workerData: { stamp: e } });
function DJe() {
  let e = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * QO.STAMP_WORDS);
  return { worker: new Worker(xQ(), AQ(e)), stamp: new Int32Array(e) };
}
```
`HOOKS_WORKER_URL = "/$bunfs/root/src/plugins/functionHooks/hooks-worker/hooks-worker.js"`. A single
Bun `Worker` hosts **all** plugin environments; the `SharedArrayBuffer` "stamp" is a lock-free
liveness/attribution channel read synchronously from the worker.

**Why a worker at all**: plugin-authored JS must not be able to block the REPL event loop, must be
killable, and must be reachable only through a plain-data boundary. Every value crossing the boundary
is validated as structured-cloneable; failures surface as
`` `next() argument is not plain data: …` `` and
`` `$.${name}.${method} returned a value that is not plain data: …` ``.

**IPC protocol** — the worker's `onmessage` switch (host → worker):

| message | payload | reply |
|---|---|---|
| `ping` | `{n}` | `pong {n}` |
| `load` | `{environmentId, port, args}` | `loaded {environmentId, events, matchers}` or `load_error {environmentId, error, cause?}` |
| `unload` | `{environmentId}` | — (closes the port, rejects pending ops) |
| `build` | `{environmentId, table, suppressed}` | `built` / `built_error` |
| `call` | `{callId, environmentId, call, callers}` | `call_result {callId, value}` / `call_error` |
| `dispatch` | `{id, event, payload, environments, origin}` | `result {id, …}` / `error {id, error}` |
| `abort` | `{id, reason}` | — |
| `press` | `{pressId, environmentId, handle, e}` | `press_result` / `press_error` |
| `press_release` | `{environmentId, handles}` | — |
| `next_result` / `next_error` | `{id, nextId, result\|error}` | resolves a pending `next()` |

Worker → host: `pong`, `loaded`, `load_error`, `built`, `built_error`, `call_result`, `call_error`,
`result`, `error`, `press_result`, `press_error`, `next`, `next_abort`, `log {text, level}`,
`hook_failed {…}`, `unhandled {error}`.

Each loaded environment additionally gets its own `MessagePort` carrying `op` / `op_abort` /
`op_result` / `flush` / `flushed` — this is the **host-op** channel by which plugin code calls back
into the harness (`hostOps` includes tool calls, fs ancestors, audio play, agent spawn, UI notices,
flag values — cli.pretty.js:446444). Errors are `HooksError`; unloading an environment rejects every
pending op with `"the plugin's environment was unloaded"`, and an op sent to a missing environment
rejects with `` `${op}: the plugin's environment is unloaded` ``.

On the harness side, function hooks reach the normal pipeline as `{type:"function"}` entries
(`u6n`, cli.pretty.js:496200), and PreToolUse specifically runs them as a **chain** rather than in
parallel (`Don` → `Ep.runPreToolUseChain`, cli.pretty.js:445020) so each handler sees the previous
one's `updatedInput`; the settings hooks are folded in as one link of that chain. Unhandled
rejections inside the worker are reported back as `{type:"unhandled", error}` and surfaced through
`Uf.setChainReporter`.

Function-hook errors surface as `hook_error_during_execution` with content
`"Messages not provided for function hook"` when the messages array is missing
(cli.pretty.js:495632) — function hooks are the only type that requires transcript access.

---

## 9. Constants quick-reference

| constant | value | anchor |
|---|---|---|
| `Li` — default hook timeout | `600000` ms | 445027 |
| `I_e` — UserPromptSubmit timeout | `30000` ms | 445027 / 474046 |
| `O_e` — model-switch hook timeout | `30000` ms | 445027 |
| `C7e` | `5000` ms | 445027 |
| `oun` — SessionEnd floor | `1500` ms | 494390 |
| `b5n` — SessionEnd ceiling | `60000` ms | 494390 |
| prompt-hook default timeout | `30000` ms | 493532 |
| agent-hook default timeout | `60000` ms | 493704 |
| function-hook default timeout | `5000` ms | 431623 |
| async default timeout | `15000` ms | 433397 |
| `Uhr` — async-rewake flush | `30000` ms | 494382 |
| `Z8n` — persist-to-disk threshold | `10000` chars | 128009 |
| `fP` — classifierContext cap | `2000` UTF-16 units | 433152 |
| `k5n` — rewakeSummary cap | `300` chars | 494382 |
| `RMe` — task/cron description cap | `1000` chars | 494267 |
| `a6n` — plugin metrics entries | `20` | 495339 |
| `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | default `8` | 487337 |
| agent-hook max turns | `50` | 493724 |
| hook progress poll interval | `1000` ms | 433300 |
| env vars | `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, `CLAUDE_CODE_SHELL_PREFIX` | 494392 / 487347 / 494805 |

---

## Deltas vs the February parity rows

The February scorecard rows were written against a snapshot where the hooks surface was much smaller.
What changed, row by row:

- **`02.9` — "Hooks defined in settings (command/prompt/agent/http)", "30 HookEvents".** Both numbers
  are now stale. There are **33** events (`_y`, cli.pretty.js:183061) and **five** settings-authorable
  hook types — `mcp_tool` joined command/prompt/agent/http (cli.pretty.js:184247). The row's framing
  ("far richer than the 4 disk variants") should read *five* disk variants, and the two internal types
  (`callback`, `function`) should be named because the SDK's in-process hooks map onto `callback`
  while `function` has no SDK analogue at all.
- **New since February, with no parity row at all**: `PostToolBatch`, `PostCompact`, `StopFailure`,
  `SubagentStart`, `UserPromptExpansion`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`,
  `Elicitation`, `ElicitationResult`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`,
  `CwdChanged`, `FileChanged`, `DirectoryAdded`, `MessageDisplay`. Several of these are not
  "observability" events — `WorktreeCreate` is a *required* extension point for non-git VCS,
  `Elicitation` can answer an MCP dialog on the user's behalf, and `MessageDisplay` can rewrite what
  the user sees on screen.
- **`04.3` / `04.4`** (tool and stop hook fan-out) remain accurate in shape, but the Stop family now
  has three sub-modes (`turn_end`, `turn_end_reactions`, `blockable_turn_end`), a hard consecutive
  block cap (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, default 8) that the SDK cannot observe, and a much
  richer input (`background_tasks`, `session_crons`, `last_assistant_message`).
- **`09.15` — "PermissionRequest hook overriding the verdict", "first hook wins".** The engine is not
  first-wins; it is a **monotone precedence ladder** `deny > defer > ask > allow` folded across all
  hooks running in parallel (cli.pretty.js:495878). The row should be reworded.
- **`09.1` — "HookPermissionDecision adds 'defer'".** Still true for PreToolUse; note that
  `PreModelSwitch` accepts `allow|deny|ask` **without** `defer`, and `PermissionRequest` uses a
  different shape entirely (`decision: {behavior}`), so "the hook permission decision type" is not
  one type.
- **`02.13` — ConfigChange.** Now has a documented carve-out: `policy_settings` results are
  force-unblocked, so a hook cannot veto managed-settings changes (cli.pretty.js:494179).
- **Timeout assumption.** Any parity note or clone that assumes a 60-second default hook timeout is
  wrong for 2.1.251 — the default is **600 s**, and only UserPromptSubmit, the model-switch pair, and
  SessionEnd narrow it.
- **Snapshot semantics** are not represented in any February row and materially change clone
  behaviour: settings-file hooks are captured once at startup.
- **`disableAllHooks` in user settings** does not disable hooks; it silently switches the session to
  managed-only. A clone that treats it as an off switch will diverge.
- The parity docs' hook rows live scattered across `02`, `04`, and `09`; given 33 events, five
  authorable types, a worker-hosted function-hook subsystem, and a device-forwarding path, hooks now
  warrant their own domain sheet rather than rows borrowed from three others.

---

## Open questions

1. **`once`.** Declared on all five settings hook types ("If true, hook runs once and is removed after
   execution", cli.pretty.js:184247) but I found **no consumer** anywhere in `cli.pretty.js` — no
   read of `.once` on a hook object, no settings mutation that removes a hook after a run. Either it
   is consumed inside a chunk in a way that survives my greps, it is enforced only in the plugin
   hooks-module layer, or it is currently dead. Needs a live test.
2. **`UserPromptSubmit.source`.** The schema documents six values and the `/hooks` UI does not mention
   it, but both construction sites spread `...!1` where the field would go (cli.pretty.js:474036,
   :474043), so the field appears never to be emitted. Confirm with a live hook.
3. **`PostToolUseFailure` payload drift.** The `/hooks` description promises `error_type` and
   `is_timeout`; neither is in the zod schema nor in the constructed object. Which is authoritative?
4. **`S3e = 6000`** (cli.pretty.js:445027) — declared alongside the hook timeouts but I found no use
   within the hooks chunk. Unknown purpose.
5. **Function-hook matcher wire format** (`wb.toWireTable(m.matchers)` in the worker) — the matcher
   semantics for plugin function hooks are compiled inside the worker and were not traced here; they
   may differ from the settings matcher grammar in §3.4.
6. **`extendedHookInput`** is threaded through `Qxt`'s signature (cli.pretty.js:495532) and set to
   `undefined` at the only Stop call site (`fe` at cli.pretty.js:494326). Dead parameter, or a
   feature flag path I did not find?
7. **`passthrough`** appears as a permission behaviour in the precedence switch
   (cli.pretty.js:495898) but no hook output can produce it — it comes from elsewhere in the
   permission system. Worth confirming it is unreachable from hooks.
8. **Ordering guarantees.** Hooks run unbounded-parallel and results are folded in *arrival* order, so
   `updatedToolOutput` and `systemMessage` ordering is nondeterministic across runs. Is any clone
   expected to reproduce that, or should it impose a stable order?
