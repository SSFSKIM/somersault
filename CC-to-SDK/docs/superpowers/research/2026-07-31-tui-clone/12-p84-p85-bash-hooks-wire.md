# P84 + P85 — Bash stdout, the background affordance, hook timing, and the classifier verdict

**Status:** **Complete. LT19 / LT20 / LT21 / LT22 gates closed.**
**Questions (master spec, verbatim):**
*P84 — "Does a client see incremental stdout for a running Bash? Any wire counterpart to the background affordance?"* (gates `LT19`, `LT20`)
*P85 — "Do PreToolUse hook summaries with timing reach a client? Does the auto-mode classifier's verdict?"* (gates `LT21`, `LT22`)
**Probes:** `probes/probes/84-bash-stdout-background.ts`, `probes/probes/85-hook-timing-classifier.ts`

## Verdicts

**LT19 — DEAD.** A foreground `Bash` is silent on the wire for its entire runtime. Across three live
runs of a 10-second `tick` loop, the only frames between the `tool_use` block and its `tool_result`
were `system/task_started` (once, ~5 s after the `tool_use` block) and `system/task_notification`
(once, at completion). No frame carried a byte of stdout, no `tool_progress` heartbeat exists for a
local Bash, and `includePartialMessages: true` adds only the assistant message's own
`content_block_stop` / `message_delta` / `message_stop`. Stdout arrives exactly once, whole, in the
`tool_result`. The upstream `height:5` live-output box has no data source in this SDK.

**LT20 — ALIVE as an action, client-side as a hint.** `Query.backgroundTasks(toolUseId)` is real and
complete: called with the running Bash's `tool_use` id it returns `true`, emits
`system/background_tasks_changed` and `system/task_updated{patch:{is_backgrounded:true}}`, and the
blocked `tool_result` returns **within 1 s** carrying `Command was manually backgrounded by user with
ID: <task_id>. Output is being written to: <path>`. **But the affordance is never announced.** Nothing
on the stream says a Bash is backgroundable; `run_in_background` appears nowhere in the `init` frame
(`init.tools` is a bare `string[]` of 29 names), so the hint text is client-side knowledge of the Bash
input schema. There is one hard timing rule: the request only works **after**
`system/task_started`. Fired 3 s after the `tool_use` block but before `task_started`, the targeted
form returns `false` and the no-argument form returns **`true` while backgrounding nothing** — the loop
ran to completion in the foreground with full output.

**LT21 — DEAD.** Hooks execute and are invisible to clients on **both** hook species. SDK in-process
`options.hooks` callbacks fired (`PreToolUse` deliberately blocking 702 ms, then `PostToolUse`) and
produced zero client frames. Settings-layer **command** hooks (`options.settings.hooks`, the
`--settings` layer) provably executed — both marker files were written — and also produced zero client
frames and no hook stdout anywhere on the stream. The declared `system/hook_started`,
`system/hook_progress`, `system/hook_response`, `tool_use_summary` and `tool_progress` frames never
appeared. There is no wire source for `⎿ Ran N PreToolUse hooks (120ms)`.

**LT22 — DEAD.** Nothing annotates a permission verdict live. `system/permission_denied` — the frame
that declares `decision_reason_type: 'classifier'` — did not arrive on any of five permission paths,
including the one run where a tool was genuinely refused. That refusal surfaced two ways, neither
usable for `⎿ Allowed by auto mode classifier`: English prose in the model-facing `tool_result`
(`"Claude requested permissions to write to <path>, but you haven't granted it yet."`), and a single
entry in the terminal `result.permission_denials` carrying `{tool_name, tool_use_id, tool_input}` and
**no reason, no deciding component, and no timing** — available only after the turn ends. Approvals are
annotated nowhere at all: an auto-mode allow is indistinguishable on the wire from a tool that needed
no permission.

## Runtime provenance

| | |
|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` **0.3.220**; bundled CLI manifest **2.1.220** |
| Node / OS | Node **v24.18.0**, macOS **26.5.2** (arm64) |
| Models | P84: `claude-haiku-4-5-20251001`. P85: `claude-haiku-4-5-20251001` (hooks, control) + `claude-sonnet-5` (auto mode — `auto` is model-gated, probe 18d/72) |
| Authentication | first-party **`CLAUDE_CODE_OAUTH_TOKEN`** from `CC-to-SDK/.env`; `ANTHROPIC_API_KEY` absent (checked by name only, never printed) |
| Isolation | every case runs in its own `mkdtemp` cwd with `settingSources: []`; P85 case B additionally passes hooks through the `settings` flag layer |
| Runs | P84 canonical 2026-08-04 (phases A, B, B2 + schema phase); P85 canonical 2026-08-04 (cases A, B, C, D, D2, D3, E) |

Rerun: `cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/84-bash-stdout-background.ts`
(and `… npx tsx probes/85-hook-timing-classifier.ts`).

## P84 — observed frame evidence

### The silent gap (phase A, no intervention)

A 10-second loop, `tool_use` at 5.0 s, `tool_result` at 18.5 s — a **13.5 s gap** containing five
frames total, three of which belong to the assistant message that emitted the call:

```
stream_event/content_block_stop ×1   stream_event/message_delta ×1   stream_event/message_stop ×1
system/task_started ×1               system/task_notification ×1
tool_progress ×0
```

Both engine frames verbatim (paths and ids are per-run):

```json
{"type":"system","subtype":"task_started","task_id":"b6i3nzre3",
 "tool_use_id":"toolu_01UFkK…","description":"for i in $(seq 1 10); do echo tick $i; sleep 1; done",
 "task_type":"local_bash","uuid":"…","session_id":"…"}
```
```json
{"type":"system","subtype":"task_notification","task_id":"b6i3nzre3",
 "tool_use_id":"toolu_01UFkK…","status":"completed","output_file":"",
 "summary":"for i in $(seq 1 10); do echo tick $i; sleep 1; done","uuid":"…","session_id":"…"}
```

The probe scanned every frame's full JSON for the mid-loop markers `tick 3` / `tick 4` / `tick 5`:
**zero hits** in all three phases. `task_notification.output_file` is the **empty string** for a
foreground Bash — the output file exists only once the task is backgrounded.

Timing worth designing against: `task_started` arrived **5.2 s after** the `tool_use` block in phase A
(10.2 s vs 5.0 s), and 5.3–5.4 s after it in the other two phases.

### The background affordance (phases B and B2)

| Phase | `backgroundTasks(toolUseId)` fired | targeted return | no-arg return | effect |
|---|---|---|---|---|
| B | `tool_use` + 3 s (**before** `task_started`) | `false` | `true` | **none** — no `background_tasks_changed`, loop ran the full 13.5 s, `tool_result` = all ten ticks |
| B2 | on `system/task_started` (9.5 s) | `true` | not needed | `tool_result` **1.0 s later**, task moved to background |

Phase B2's frames, all at 9.5 s, in arrival order:

```json
{"type":"system","subtype":"background_tasks_changed",
 "tasks":[{"task_id":"b8va45m4b","task_type":"local_bash","description":"Run loop counting 1-10 with 1 second delays"}]}
{"type":"system","subtype":"task_updated","task_id":"b8va45m4b","patch":{"is_backgrounded":true}}
```
```
tool_result is_error=false
  Command was manually backgrounded by user with ID: b8va45m4b.
  Output is being written to: <cwd>/<session_id>/tasks/b8va45m4b.output
```

This **extends and corrects probe 67**, which called the no-argument `backgroundTasks()` three seconds
into a foreground Bash, got no snapshot, and left open whether the negative was ours or the CLI's. It
was neither: the call was simply made before the engine registered the task. After `task_started` the
control request works exactly as declared.

The returned `true` from the no-argument form in phase B is a **wire gotcha**: the boolean is not an
acknowledgement that the Bash you are watching is now in the background. Only
`system/task_updated{is_backgrounded:true}` (or the `background_tasks_changed` membership) proves it.

### Where the hint can come from (phase C)

```
init frame keys: type, subtype, cwd, session_id, tools, mcp_servers, model, permissionMode,
                 slash_commands, apiKeySource, claude_code_version, output_style, agents, skills,
                 plugins, capabilities, analytics_disabled, product_feedback_disabled, uuid,
                 memory_paths, fast_mode_state, fast_mode_disabled_reason
init.tools     : string[] (29 entries), "Bash" present, names only — no schemas
"run_in_background" anywhere in the init frame: NO
foreground tool_use input keys: command, description, run_in_background  (the model set it to false)
```

So a client learns "this tool can be backgrounded" from the SDK's own typing
(`sdk-tools.d.ts` → `BashInput.run_in_background`) or, opportunistically, from the model's own
`tool_use.input` when it happens to include the key — never from an engine announcement.

## P85 — observed frame evidence

### Hooks (cases A and B)

Both hook species were driven to completion and neither produced a client frame:

| Case | Hook species | Proof it ran | `system/hook_started` / `hook_progress` / `hook_response` | `tool_use_summary` / `tool_progress` | hook stdout on the stream |
|---|---|---|---|---|---|
| A | SDK in-process `options.hooks` | callbacks logged: `PreToolUse(Bash)` blocked **702 ms**, then `PostToolUse(Bash)` | NONE | NONE | n/a |
| B | settings-layer `type:"command"` hooks via `options.settings.hooks` | **marker files written by both hooks** (`Pre=true Post=true`) | NONE | NONE | NO — `PROBE85-PRE-STDOUT` / `PROBE85-POST-STDOUT` appear in no frame |

Case B is the falsification that matters: without the marker files, "no hook frames" would be
indistinguishable from "the settings layer never loaded the hooks." It did load them, they ran, they
slept 700 ms, they printed to stdout, and the client stream never mentioned them. The complete
non-`init` system-frame vocabulary in both cases was `status` and `thinking_tokens` — nothing else.

Case B's full frame census (case A is the same shape):

```
system/init×1  system/status×2  system/thinking_tokens×9  stream_event×29
rate_limit_event×1  assistant×4  user×1  result×1
```

Note also that `PreToolUse`'s 702 ms of blocking is invisible in the frame timeline — there is no gap
marker, no pending state, nothing between the assistant message and the tool result to attribute the
delay to. A client cannot even infer that a hook ran, let alone time it.

### The auto-mode classifier (cases C, D, D2, D3) and the denial control (case E)

All auto cases: `permissionMode:"auto"` on `claude-sonnet-5`, `settingSources: []`, **no `canUseTool`**
— so anything that executes was approved by the classifier path (probe 18d's discriminator).

| Case | Operation | Outcome | Non-`init` system frames | `result.permission_denials` |
|---|---|---|---|---|
| C | Edit `note.txt` in cwd | **allowed**, file changed | `status ×3` | `[]` |
| D | `rm disposable.txt` (pre-existing, in cwd) | **allowed**, file deleted | `status ×2`, `thinking_tokens ×2` | `[]` |
| D2 | `Write` into `$HOME`, then `sudo -n true` | **both allowed** (`$HOME` file created, removed by the probe; sudo failed on its own password requirement, not on permission) | `status ×2` | `[]` |
| D3 | Write `.claude/settings.json` (protected path — probe 18e's blocked op) | **allowed**, file created | `status ×3`, `thinking_tokens ×6` | `[]` |
| E | Edit `note.txt` under `permissionMode:"default"`, no broker | **denied**, file unchanged | `status ×3`, `thinking_tokens ×26` | one entry (below) |

Case E's denial, the only real refusal observed, in the two places it is visible:

```
tool_result is_error=true
  Claude requested permissions to write to <path>, but you haven't granted it yet.

result.permission_denials[0] =
  {"tool_name":"Edit","tool_use_id":"toolu_019qaK…",
   "tool_input":{"file_path":"<path>","old_string":"ORIGINAL","new_string":"CHANGED","replace_all":false}}
```

No `decision_reason_type`, no `decision_reason`, no `message`, no timestamp — and no
`system/permission_denied` frame at any point in the turn.

**Scope note, stated honestly.** On `claude-sonnet-5` the classifier **allowed every operation we could
safely construct**, including two that probe 18e/18d predicted it would block on `claude-sonnet-4-6`:
deleting a pre-existing in-cwd file, and writing the protected path `.claude/settings.json`. It also
allowed a write outside the working directory (into `$HOME`) and a `sudo` invocation. We therefore
never observed a classifier-originated *denial*, and cannot say from this run whether such a denial
would populate `decision_reason_type:'classifier'`. That does not soften the LT22 verdict: the
`permission_denied` frame did not appear even for the genuine denial in case E, and the classifier's
*approvals* — the common case, and the one `⎿ Allowed by auto mode classifier` renders — are annotated
nowhere. The allow-side breadth is an independent finding worth carrying to the harness's autonomy
posture (`resolveAutoModel` / `kairos/safety.ts`), where `auto` on a v5 model is currently assumed to
block protected-path and outside-cwd writes.

## What F3 may build

**`LT20` ships, with the hint synthesized client-side.** Render the dim
`(ctrl+b to run in background)` row under a foreground Bash from static knowledge — the tool is `Bash`
and the call did not set `run_in_background` — because no wire event offers the affordance. Gate it on
arrival of `system/task_started` for that `tool_use_id`, not on the `tool_use` block: for the first
~5 s the control request is refused, and the no-argument fallback lies about succeeding. Bind the key
to `backgroundTasks(toolUseId)` with the id from the frame, treat `system/task_updated`
`{patch:{is_backgrounded:true}}` (plus the `background_tasks_changed` membership) as the only proof of
success, and swap the row for the backgrounded presentation when the short-circuited `tool_result`
arrives with its output-file path. That file is tailable (probe 74), so a background Bash can stream
even though a foreground one cannot.

**`LT19`, `LT21`, `LT22` stay non-goals — now for recorded reasons rather than assumed ones.**
`LT19`'s live-output box has no wire source at all: a foreground Bash produces two engine frames in
thirteen seconds and no stdout until completion. `LT21`'s `⎿ Ran N PreToolUse hooks (120ms)` has no
source either — hooks run (in-process and as settings commands, both verified executing) without
emitting one client frame, so a client can only time hooks it runs itself, which is a harness feature
rather than a rendering one. `LT22` has no live source: verdicts never reach a client as a frame, and
the only structured trace is a reason-less `result.permission_denials` entry that arrives after the
turn — enough to mark a past row "denied", never enough for `Allowed by auto mode classifier`. All
three should be marked **unreachable on 0.3.220**, not merely unbuilt, in `00-INVENTORY.md`.

One rendering scrap does survive for F4/`LT14` rather than F3: the denial sentinel
`"Claude requested permissions to write to <path>, but you haven't granted it yet."` arrives as
`tool_result` text with `is_error:true`, and `result.permission_denials` gives the matching
`tool_use_id` — enough to mark that specific row rejected once the turn ends.
