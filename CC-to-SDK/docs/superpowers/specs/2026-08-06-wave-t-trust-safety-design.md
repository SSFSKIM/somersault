# Wave T — Trust & Safety: "the user is asked, told, and heard"

> **Living document.** `## Decision Log`, `## Surprises & Discoveries`, `## Outcomes & Retrospective` and
> `## Revision Notes` stay current through execution. Acceptance is observable behavior only.
>
> **Parent:** `2026-08-06-qa-sprint-waves-design.md` §6 Stream T (epics EP-T1…EP-T6). Findings corpus:
> `docs/parity/qa-sprint-1-triage.md` (cluster C4, C5; worklist rows 1, 7, 9, 14, 15 and the P3
> permissions block). This spec supersedes the triage's Wave T mission wherever the grounding round
> contradicted it.
>
> **Grounding evidence (2026-08-06, three parallel workers).** Every canon claim below carries a
> `cli.pretty.js` line citation from `~/claude-code-bundle/2.1.220/`; every current-state claim carries a
> `harness/src/...` file:line. Live SDK facts come from `probes/probes/96-transport-failure-surface.ts`
> and `probes/probes/97-plan-decision-wire-shape.ts`, both run keyed against SDK 0.3.220 / CLI 2.1.220.
> Raw worker reports: `$CLAUDE_JOB_DIR/tmp/waveT-{bundle-transcription,ccx-grounding,probe-findings}.md`.
>
> **Baseline:** `main` @ c3b70e57c6. Canon = the installed DEFAULT 2.1.220 build.

## Purpose

A person using `ccx` for real work should never be surprised by what it did, never be promised an input
box that does not appear, and never watch a healthy-looking spinner while nothing is happening. Wave T
closes the six trust gaps the QA fleet found, in the order a user meets them: the permission posture at
launch, the affordances inside a consult, the plan handoff, and the failure surface.

Concretely, when this wave lands:

- A fresh `ccx` session asks before `rm`, exactly as Claude Code does, and the banner, the footer and the
  engine agree about which mode that is.
- Every consult tells you how to amend it (`Tab`) and how to understand it (`ctrl+e`), and an empty amend
  does nothing rather than silently denying.
- Approving a plan grants what its label says it grants.
- An unreachable API turns the spinner into a typed error with a live retry countdown within seconds.
- Entering bypass mode requires accepting a warning; declining exits.

## Acceptance (the wave gate)

Each criterion is checked in the isolated-HOME tmux harness (`docs/parity/qa-driver.md`), re-running the
QA finding's own repro. `[BEHAVIOR]` markers are what a reviewer observes, not what the code contains.

1. **A1 (qa3-03, P1)** From a fresh launch in a scratch project, prompting for a destructive shell command
   (`rm <file>`) produces a permission dialog *before* the file is gone. Re-running the QA-3 repro
   verbatim no longer executes unconsulted.
2. **A2 (qa3-02)** In the same frame, the welcome banner's mode, the status bar's mode chip, and the
   host's reported mode are the same string.
3. **A3 (auto notice)** Cycling into auto mode with shift+tab appends the auto-mode notice to the
   transcript once; relaunching and entering auto again does not repeat it.
4. **A4 (qa3-05)** Every consult dialog's footer shows the escape, amend, and explain hints; the amend
   hint disappears once the focused row is already in input mode.
5. **A5 (qa3-04)** Pressing `Tab` then `Enter` with nothing typed on a No row leaves the dialog open and
   sends no decision. Typing text then `Enter` denies with that text visible to the model.
6. **A6 (ctrl+e)** Pressing `ctrl+e` on a Bash consult renders an explanation, a reasoning line, and a
   colored risk line; pressing it again hides them; the command line dims while shown.
7. **A7 (qa3-17)** With auto mode available, the plan modal's first approval row reads `Yes, and use auto
   mode`, and approving it leaves the session in `auto` (observable in the mode chip and the host status).
8. **A8 (qa3-16)** The plan body renders inside dashed rules, and when an editor is configured the footer
   shows `ctrl+g edit in <editor> · <plan file path>` with the path the SDK supplied.
9. **A9 (plan feedback)** An empty `Enter` on `No, keep planning` does nothing; typed feedback reaches the
   model and the plan modal closes.
10. **A10 (qa6-05, P2)** With the API endpoint unreachable, the spinner row is replaced within ~2 s of the
    first retry event by `✻ API error · Retrying in <duration> · attempt n/max`, the duration counts down
    once per second, and a stalled variant appears before any retry evidence arrives. The turn ends with
    exactly one error line, not two.
11. **A11 (qa3-14)** Launching with `--dangerously-skip-permissions` shows the bypass warning with the
    cancel button focused; declining exits with a non-zero code; accepting proceeds and never asks again.
12. **A12 (qa3-07)** A create-file consult renders the new file's content inside dashed rules, with
    `(No content)` when the body is empty.
13. **A13 (qa3-08 residue)** The generic don't-ask-again row's text describes the rule it actually
    writes — no "commands in \<cwd\>" for a whole-tool grant.

Suites green throughout: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`.

---

## EP-T1 · Launch permission posture

### Canon

- Mode table `gGl` (L41536) — the vocabulary every chip and label draws from:
  `default` → title `Manual`, short `Manual`, indicator `manual mode`, symbol `⏸`, color `inactive`;
  `plan` → `Plan`/`Plan`/`plan mode`/`⏸`/`planMode`; `acceptEdits` → `Accept edits`/`Accept`/`accept
  edits`/`⏵⏵`/`autoAccept`; `bypassPermissions` → `Bypass Permissions`/`Bypass`/`bypass permissions`/
  `⏵⏵`/`error`; `dontAsk` → `Don't Ask`/`DontAsk`/`don't ask`/`⏵⏵`/`error`; `auto` → `Auto`/`Auto`/
  `auto mode`/`⏵⏵`/`warning`.
- `AUTO_MODE_DESCRIPTION` (L547285-86) is **one string**, verbatim:

  > Auto mode lets Claude handle permission prompts automatically — Claude checks each tool call for risky
  > actions and prompt injection before executing. Actions Claude identifies as safe are executed, while
  > actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal for
  > long-running tasks. Sessions are slightly more expensive. Claude can make mistakes that allow harmful
  > commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode.

- Insertion mechanics (L547935-955): a `useEffect` keyed on `permissionContext.mode`; returns immediately
  unless the mode is `auto`; fires once per process via a ref; **800 ms** `setTimeout`; skipped when the
  mode came from a fallback; gated on `shouldShowAutoModeEntryWarning` (`OMa`, L454515-17) which is false
  once `hasSeenAutoModeEntryWarning` is set in app config or any settings scope sets
  `skipAutoPermissionPrompt`; then appended to the **static** message list as `ml(text, "notice")` — a
  transcript notice row, *not* a dialog and *not* a styled block.
- Two other auto-mode surfaces exist and are **out of scope** (deferred, see Deferred): the "Auto mode is
  now Claude Code's default permission mode." startup notice (title/body/docs-URL column, L454518,
  L454530-44) and the `AutoDefaultNudgeDialog` (L547203-57, writes
  `userSettings.permissions.defaultMode`).

### Current state

- `src/config/types.ts:161` — `permissionMode: "auto" as PermissionMode` inside `DEFAULTS`, applied at
  `src/config/resolveOptions.ts:60-61`. This single seam serves `createHarness`, the lib `Session`,
  `daemon/supervisor.ts makeSession` **and** the REPL host.
- `src/cli/main.ts:239` (banner) and `:244` (`hookOpts.initialMode`) both read
  `inv.config.permissionMode ?? "default"`; `inv.config.permissionMode` is undefined unless
  `--permission-mode` was passed. The status bar corrects itself only when the first host `state` event
  arrives (`src/tui/useChat.ts:570`). That is the qa3-02 contradiction.
- `resolvedPermissionMode(config)` is exported at `src/config/resolveOptions.ts:113-115` and is the
  correct value for both call sites.
- Ladder: `src/tui/settingsRows.ts:27` `PERMISSION_MODE_OPTIONS = ["default","acceptEdits","plan","auto"]`,
  shared with `/config` deliberately; `src/tui/useChat.ts:85-87` (`LADDER`, `ladderNext`), cycled from
  `src/tui/ChatApp.tsx:259`.
- **No ccx-side consult suppression exists** — the broker is installed unconditionally
  (`src/config/resolveOptions.ts:68`) and the host always supplies one (`src/host/host.ts:340`). What
  reaches `canUseTool` is the SDK classifier's call (`src/config/types.ts:34-40`, probe 64).

### Work

1. **(modify)** REPL-only launch mode. The host construction in `src/cli/main.ts` passes an explicit
   `permissionMode: "default"` when the invocation did not specify one. Do **not** touch
   `DEFAULTS.permissionMode` — headless `-p`, `--bg` and the daemon keep `auto` deliberately.
   Watch the two side effects that read the resolved value: `resolveOptions.ts:65` (auto→model swap, keyed
   on the *explicit* config, so unaffected) and `:67` (`allowDangerouslySkipPermissions`).
2. **(modify)** `src/cli/main.ts:239` and `:244` → `resolvedPermissionMode(inv.config)`.
3. **(new)** Auto-mode entry notice: fires when the REPL observes the mode becoming `auto` (ladder,
   `/config`, or a host state event), after an 800 ms delay, once per install — persisted in the same
   prefs file the theme/model preferences use (`src/tui/prefs.ts`), keyed `hasSeenAutoModeEntryWarning`.
   Rendered as a transcript notice row with the verbatim string above.

### Acceptance
A1, A2, A3.

---

## EP-T2 · The consult tells you what you can do

### Canon

- **Footer** (Bash dialog frame, L505286): a `·`-joined dim row of `escape / cancel`, the amend hint, and
  the explain hint. The amend hint `hintNode` (L505188) is `<Hint chord="tab" action="amend"/>`, rendered
  **only** when the focused row's type is accept-or-reject **and that row is not already in input mode**
  (`aZf`, L505186). The explain hint's action flips between `explain` and `hide` (L505286).
- **Focus auto-collapse** (`handleFocus`, L505162-69): moving focus away from a feedback row collapses its
  input mode **if its text is empty**.
- **Empty submit** (L397113-19 / L397147-53 / L397227-33): `if (text.trim() || hasPastedImages ||
  option.allowEmptySubmitToCancel) onChange(value) else onCancel()`. Every consult feedback row sets
  `allowEmptySubmitToCancel` (L504858, L504864, L504874, L505627, L505650, L506280, L506286, L506294) —
  so upstream's empty submit *selects the row with no feedback*. **The plan modal's row is the single
  exception** (L500713) and is additionally guarded by `if (!trimmedFeedback && !hasImages) return`
  (L500733, L500976).
- **Explain** (`bsl`, L504910-42) — a real model call, reproducible headlessly:
  - Gate: `settings.permissionExplainerEnabled !== false` (L504907-09).
  - Model: the current main-loop model (L504924), not a fixed cheap one.
  - One forced-tool request: `tool_choice: {type:"tool", name:"explain_command"}`.
  - System prompt (L504943), verbatim: `Analyze shell commands and explain what they do, why you're
    running them, and potential risks.`
  - User prompt (L504915-24): `Tool: <name>`, optional `Description: <desc>`, `Input:` + pretty JSON,
    optional recent-context block, then `Explain this command in context.`
  - Tool schema (L504955): `explanation` (what it does, 1-2 sentences), `reasoning` (why YOU are running
    it, starting with "I"), `risk` (what could go wrong, under 15 words), `riskLevel` enum
    `LOW|MEDIUM|HIGH`; all four required.
  - Render (`Rsl`, L505053-104): explanation, then reasoning (margin-top 1), then a risk row whose label
    is `Low risk` / `Med risk` / `High risk` (`XQf`, L505005-14) colored `success`/`warning`/`error`
    (`YQf`, L504995-5004). Loading text `Loading explanation…` (L505121); failure text
    `Explanation unavailable` (L505058).
  - Lazy and one-shot: the first toggle starts the request and stores the promise; later toggles only flip
    visibility (L505023-30); unmount aborts (L505042).
  - Wired into **Bash and PowerShell consults only** (L505225, L506435).
- **Interrupt row** (`zWo`, L422222-25): two dim spans rendering `Interrupted · What should Claude do
  instead?`. It is a *static transcript substitution*, triggered when a message matches one of three
  sentinels: `API Error: Request was aborted.`, `[Request interrupted by user for tool use]`, or
  `The user doesn't want to take this action right now. STOP what you are doing and wait for the user to
  tell you how to proceed.` (all at L108575; sites L422821, L427691, L429122, L429730, L430889). There is
  **no input widget** — the next user turn is an ordinary composer submit.

### Current state

- Input rows exist: `src/tui/select/Select.tsx` (option shape `:46-56`, `InputText` `:128-132`, submit
  rule `:210-213`, Tab intercept `:231-232`). **The flag name is inverted from its effect:**
  `allowEmptySubmitToCancel: true` means an empty Enter is *carried to `onChange`*, i.e. it does not
  cancel.
- `src/tui/dialogs/optionRows.ts:28-32` builds the No row with `allowEmptySubmitToCancel: true`;
  placeholder `and tell Claude what to do differently` (`:20`); toggle at `:43-55`; escape-leaves-input at
  `:57-60`.
- Decision plumbing is complete: `DecisionOutcome` carries `feedback` on both `deny` (`src/permissions/
  types.ts:29`) and `plan_reject` (`:48`); `src/permissions/gate.ts:62` turns it into the SDK deny
  `message`, falling back to `denyMessage` (`:27-31`).
- Footers today are a bare `<Text dimColor>esc cancel</Text>` in all six dialog bodies (e.g.
  `src/tui/dialogs/GenericPermission.tsx:80`).
- **WebFetch** is the one dialog whose No row is a plain label reading `No, and tell Claude what to do
  differently (esc)` (`src/tui/dialogs/smallDialogOptions.ts:104`) with no text path at all (`:110-114`) —
  a transcription of upstream, which hangs no feedbackConfig on it either.
- No explain affordance anywhere. No interrupt-sentinel row.
- `qa3-06`'s "double space": not a literal. An empty amended row renders label `No` + separator `", "` +
  `InputText`'s inverse-video **space** cursor + placeholder (`Select.tsx:129`, `:290-293`).

### Work

1. **(new)** A shared consult footer component rendering `esc cancel · tab amend · ctrl+e explain`, with
   the amend hint suppressed while the focused row is already an input row, and the explain hint present
   only on the dialogs that support it (Bash first). Mount it in all six dialog bodies.
2. **(modify)** `optionRows.ts` feedback rows: an empty submit is a **no-op** — the dialog stays open and
   no decision is sent. Implement by dropping `allowEmptySubmitToCancel` and giving `Select.submitInput` a
   third behavior (`onCancel` today is "close the dialog", which is also wrong for this row). Keep the
   digit-selection path (`Select.tsx:222-231`) consistent.
3. **(modify)** Focus auto-collapse per L505162-69.
4. **(new)** `ctrl+e` explain: a small module that issues the forced-tool call, the toggle hook (lazy,
   one-shot, abort on unmount), and the three-row render with the risk labels above. Gate on a setting
   defaulting to on. The command line dims while the explanation is visible and the plain description row
   hides (L505286).
5. **(modify)** WebFetch's No-row copy — it must not promise a channel it cannot deliver.
6. **(modify)** The empty-input separator so an empty amended row reads `No, <cursor><placeholder>` without
   the doubled space. Both `Select.tsx:129` and `:293` are shared by every input row (including the Bash
   prefix row, `bashOptions.ts:191`, which sets `labelValueSeparator: ": "`) — the change must not regress
   those.
7. **(new)** The interrupt transcript row, substituted on the three sentinels.

### Acceptance
A4, A5, A6, plus: interrupting a turn appends `Interrupted · What should Claude do instead?` once.

---

## EP-T3 · Plan modal: options that mean what they say

### Canon

- Option builder `sYf` (L500696-714). With `showClearContext` a first row appears
  (`Yes, clear context (<n>% used) and bypass permissions` / `… and use auto mode` / `… and auto-accept
  edits`). Then **always exactly one of**: `Yes, and bypass permissions` (bypass available) /
  `Yes, and use auto mode` (auto available) / `Yes, auto-accept edits` (neither) — all sharing the value
  `yes-accept-edits-keep-context` except the auto one (`yes-resume-auto-mode`). Then
  `Yes, manually approve edits` (`yes-default-keep-context`). Then the feedback row
  `{type:"input", label:"No, keep planning", placeholder:"Tell Claude what to change",
  description:"shift+tab to approve with this feedback"}` (L500713).
- Grants (`lYf` L500721-38, `gWt` L500932-87): `yes-accept-edits-keep-context` →
  `bypassPermissions` if available else `acceptEdits`, via `permissionUpdates:
  [{type:"setMode", mode, destination:"session"}]` (L500729, L500647-49). `yes-resume-auto-mode` with auto
  available → **allow with an empty `permissionUpdates`** and the mode set imperatively (L500727-28,
  L500968). `yes-default-keep-context` → `default`. Every **clear-context** variant answers the tool
  `{behavior:"deny"}` and re-drives the plan as a fresh turn carrying `initialMessage.mode`
  (L500948-64) — a different mechanism, out of scope here.
- Auto availability `gI()` (L372364-72): false if the circuit breaker trips, if settings disable auto, or
  if the current model does not support it.
- `shift+tab` inside the modal (L501044-49) approves via `yes-accept-edits-keep-context` (or
  `yes-accept-edits` when clear-context is showing) **carrying the typed feedback** — that is what the No
  row's description advertises.
- Frame (L501082-139): `Ready to code?` title (L501111), `Here is Claude's plan:` (L501091, straight
  apostrophe), the plan inside a **dashed-rule box** (`SM`, L424994-425003 — Ink `borderStyle:"dashed"`
  with left/right off, dropped entirely in accessibility mode), the prompt line `Claude has written up a
  plan and is ready to execute. Would you like to proceed?` (L501121).
- Footer (L501126), conditional on a resolvable external editor (`q$b`, L500870-75):
  `ctrl+g edit in <editor>` then ` · <shortened plan path>` when a plan file path exists; a transient
  `Plan saved!` clears after 5000 ms (L500819).
- Empty-plan variant (L501054-81): frame `Exit plan mode?`, body `Claude wants to exit plan mode`, options
  `Yes`/`No`, yes → allow with `setMode: default` (L501004).
- Double-submit guard `rYf = 300` ms (L501141, L500934).

### Live wire (probe 97)

- The consult arrives as `toolName === "ExitPlanMode"`, input keys `["plan","planFilePath"]`.
- The third `canUseTool` argument has the same ten keys as every other consult, but only `signal`,
  `toolUseID`, `requestId` and `displayName` (value: the bare string `"ExitPlanMode"`) are defined.
  `suggestions`, `blockedPath`, `decisionReason`, `title`, `description`, `agentID` are all undefined.
  **Name-driven classification is the only option** — which is exactly what ccx already does.
- `input.plan` is the full plan markdown; `input.planFilePath` points at a copy the CLI already wrote
  under `~/.claude/plans/`. **This closes the "plan file path was never built" gap — the path is on the
  wire.**
- Ten milliseconds after the allow, the session emits `{type:"system", subtype:"status",
  permissionMode:"default"}` — the post-approval mode is *reported*, not inferred.
- The plan file is written by a `Write` call that never reaches `canUseTool` (plan mode privileges it), so
  the host cannot gate or see it. `ExitPlanMode` is a deferred tool: the model calls
  `ToolSearch("select:ExitPlanMode")` first.

### Current state

- Classification is correct and live-proven: `src/permissions/gate.ts:21-23` routes `ExitPlanMode` →
  `"plan"`, stamped at `:47/:50`, preserved through `pending.ts:73`, `host.ts:625-627`, `wire.ts:20`,
  `chatAdapter.ts:40` (the `kind:"permission"` literal is a pre-Goal-B default the spread overrides), and
  consumed at `src/tui/ChatApp.tsx:457`.
- `src/tui/PlanDialog.tsx:100-104` — three static rows; row 1 `Yes, auto-accept edits`
  (`yes-accept-edits-keep-context`), row 2 `Yes, manually approve edits`, row 3 the input row which
  deliberately omits `allowEmptySubmitToCancel` (`:97-99`) so an empty Enter reaches `onCancel` → `:212`
  `onDecision({kind:"plan_reject"})` — a feedback-less reject.
- Because the row carries no `showLabelWithValue` and the Select is mounted without `inlineDescriptions`,
  the placeholder replaces the label (`Select.tsx:295-297`) — the live frame shows `3. Tell Claude what to
  change` rather than `3. No, keep planning`.
- Grant: `approve(value === "yes-accept-edits-keep-context")` (`:205`) → `plan_approve` with a **boolean**
  `acceptEdits` (`src/permissions/types.ts:47`) → `host.ts:663` arms it → `host.ts:527`
  `setPermissionMode("acceptEdits")`; the appserver mirrors this at `src/appserver/planUpgrade.ts:32`.
- No dashed rules around the plan body (only the DialogFrame's top rule and the option box's border,
  `PlanDialog.tsx:292-293`). The ctrl+g row **is** built (`:299-309`) but hides when no editor resolves
  (`:167`) — which is why the QA capture lacked it. No plan file path anywhere.

### Work

1. **(modify)** Option set follows availability: query whether auto and bypass are available and build the
   second row's label/value accordingly (`Yes, and use auto mode` / `Yes, and bypass permissions` /
   `Yes, auto-accept edits`). Clear-context variants stay out of scope (Deferred).
2. **(modify)** Widen `plan_approve` from `acceptEdits: boolean` to the granted mode, and update both
   appliers (`host.ts:527`, `appserver/planUpgrade.ts:32`). The auto grant is imperative upstream
   (empty `permissionUpdates`), so the applier sets the mode directly, matching today's shape.
3. **(modify)** Approve-with-feedback: `shift+tab` and a typed yes-row submit carry the feedback into the
   allow, per the row's own description.
4. **(modify)** Empty `Enter` on the No row is a no-op (upstream's guard), not a feedback-less reject.
5. **(new)** Dashed-rule framing around the plan body.
6. **(new)** Render `input.planFilePath` in the ctrl+g footer segment (` · <shortened path>`), now that
   the wire is known to carry it.
7. **(new)** A guard test pinning the live tool name `ExitPlanMode` — `gate.ts:22`'s literal is the single
   point of evidence for the whole plan surface, and a rename would silently degrade every plan consult to
   a generic dialog.

### Acceptance
A7, A8, A9.

---

## EP-T4 · Failure is visible

### Canon

- The retry row **replaces** the spinner: `{retryStatus ? <RetryRow/> : <Spinner…/>}` (L407973).
- Stalled variant (L407989-8001): `✻` (error color, `i5` = `✻`, L41482) then
  `Waiting for API response` (L407992) + dim ` · will retry in <dur> · check your network` (L407997).
- Retrying variant (L408002-34): `✻ <label>` + dim `` ` · Retrying in ${dur}${reset} · attempt ${n}/${max}` ``
  (L408007), where `dur` is a **formatted duration** (`ra()`: `"12s"`, `"1m 5s"`, or most-significant-only
  past 300 s) and `reset` is an optional rate-limit parenthetical, **not** a unit.
- `label` (L408008-11): the literal `API error` unless `showDetail`, which is
  `attempt >= min(3, maxRetries) || isNetworkDown || isSSLError || rateLimits` (`b0p`, L408007); with a
  rate limit it becomes `<Type> reached`; otherwise the formatted error. Truncated to the row width
  (L408014-16).
- Countdown: recomputed each render as `ceil((deadline - now)/1000)` seconds (L407976) — it ticks with the
  spinner's animation frame, there is no dedicated timer.
- Under the row, the tip line is suppressed while retrying (L408162); for overload-ish errors at
  `attempt >= min(3, maxRetries)` a dim one-liner appears (`ypo()`, L157242+), e.g.
  ` If it persists, check <status page>.`
- Connection copy (`sir`, L157101-47) — no string containing "offline" exists in the bundle. Notable
  members: `Unable to connect to API. Check your internet connection`, `Request timed out. Check your
  internet connection and proxy settings`, `` `Unable to connect to API (${code})` ``.
- After exhaustion the loop throws and the row disappears (L376480-83).

### Live wire (probe 96)

- Every retry emits `{type:"system", subtype:"api_retry", attempt, max_retries, retry_delay_ms,
  error_status, error}` — field-for-field the declared `SDKAPIRetryMessage`. `attempt` and `max_retries`
  come straight off the wire; the countdown is a local timer seeded from `retry_delay_ms`.
- Observed ladder (connection refused, `max_retries: 10`): delays 563 → 1215 → 2413 → 4938 → 9735 →
  18319 → 33073 → 38733 → 38751 → 39236 ms, total ~190 s to exhaustion.
- **A blackholed endpoint burns ~75 s before the first retry event**; a refused one starts in ~20 ms.
  That silent window is exactly QA's 72-second spinner, and only the host can cover it.
- `max_retries` is a ceiling, not a promise: a 401 gave up after 3.
- The child process `stderr` callback yielded **zero** lines in every variant — messages are the only
  channel.
- **The terminal-frame trap:** the SDK yields a synthetic assistant message
  (`model:"<synthetic>"`, `is_api_error_message:true`, typed `error`) and then a `result` frame whose
  `subtype` is still `"success"`, with the failure in `is_error:true`, `terminal_reason:"api_error"`,
  `api_error_status` — **and then throws**. Throw text varies: `Claude Code process exited with code 1`
  (exhausted), `Claude Code returned an error result: …` (non-retryable), `Claude Code process aborted by
  user` (abort).

### Current state

- No retry channel: `api_retry` messages are not forwarded host → wire → REPL.
- `src/tui/TurnSpinner.tsx:13-25` — animated glyph, per-turn verb, `(<elapsed> · <n> tokens · esc to
  interrupt)`, re-ticking every 120 ms, with **no stale, reconnect or error state**.
- The turn wait `src/client/chatAdapter.ts:110` has **no deadline** — only a host frame or a socket close
  settles it. `REQUEST_TIMEOUT_MS = 10_000` (`src/client/remote.ts:12`) covers short ops only; the
  `prompt` op's ack, not the turn.
- No reachability check anywhere in `src/`.
- **Double render:** a mid-turn failure appends `✗ <msg>` from both `src/tui/useChat.ts:546` (event arm)
  and `:1231-1232` (submit-rejection arm), because `chatAdapter.ts:55` rejects the waiter and `:59`
  forwards the same event.

### Work

**No wire work is needed — verified 2026-08-06.** `src/host/host.ts:261-270`'s `onMessage` emits **every**
SDK message as `{kind:"message", data}` (only `stream_event` is excluded from the replay buffer, and it is
still emitted live), and `src/tui/useChat.ts:503` already routes every `system` frame whose subtype is not
`compact_boundary` into `systemNoticeLines`. So `api_retry` frames **already arrive at the REPL today** and
are simply not recognised. EP-T4 is a recognition-and-render change inside `useChat`/`TurnSpinner`, not a
host/wire change.

1. **(modify)** Recognise `data.type === "system" && data.subtype === "api_retry"` in `useChat`'s message
   arm and drive a retry-status state from it (attempt, max_retries, retry_delay_ms, error_status, error).
   Make sure `systemNoticeLines` does not also paint a transcript row for the same frame.
2. **(new)** A retry/stalled row that **replaces** the spinner while a status is set, with a local
   one-second countdown seeded from `retry_delay_ms`, upstream's label rule (`API error` for the first
   two attempts, detail after), and teardown when the next real message arrives or the turn ends.
3. **(new)** A stalled state covering the pre-evidence window: after N seconds of a turn with no message
   of any kind, show the `Waiting for API response` variant. Pick N from the probe data (the refused case
   produces evidence in ~20 ms; the blackholed case takes ~75 s) — the spec's recommendation is 10 s,
   settled at plan time.
4. **(modify)** Terminal-frame classification: read `is_error` / `terminal_reason` / `api_error_status`,
   never `subtype`, when deciding whether a turn succeeded.
5. **(modify)** Collapse the double `✗` render to one.

### Acceptance
A10.

---

## EP-T5 · Bypass consent gate

### Canon (`SAm`, L554034-79)

- Title (L554075): `WARNING: Claude Code running in Bypass Permissions mode`, frame color `error`.
- Body (L554070), three paragraphs, verbatim:
  1. `In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially
     dangerous commands.` then a blank line then `This mode should only be used in a sandboxed
     container/VM that has restricted internet access and can easily be restored if damaged.`
  2. `By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions
     mode.`
  3. A link row to `https://code.claude.com/docs/en/security`.
- Buttons (L554075): confirm `Yes, I accept`, cancel `No, exit`, **cancel rendered first and focused**.
- Accept (L554051-53) persists `userSettings.skipDangerousModePermissionPrompt = true`, then continues
  startup. Once set at any scope (`M8()`, L43492) the dialog never shows again.
- Decline (L554055-56) exits with code **1** — no fallback to another mode. Escape (L554063-64) exits with
  code **0**.
- Shown when the launch mode is bypass and acceptance is not yet recorded (L554501-04).

### Current state

- `--permission-mode bypassPermissions` parses (`src/cli/args.ts:40`, `:113`); `/yolo` sets it at runtime
  (`src/tui/useChat.ts:711`, advertised `src/tui/commands.ts:40`). No consent dialog on either path.
- `--dangerously-skip-permissions` is not in `KNOWN_UNSUPPORTED` (`src/cli/args.ts:36`), so it falls to
  the generic `unknown flag` throw at `:133`.
- **The runtime-flip hazard:** `allowDangerouslySkipPermissions` is set only from the launch mode
  (`src/config/resolveOptions.ts:66-67`). A flip via `/yolo`, the ladder's off-ladder re-entry, or the
  `set_permission_mode` op never sets it — and `src/tui/useChat.ts:1438` swallows the rejection
  (`.catch(() => {})`) before `:1439` paints the chip. If the SDK refuses, the status bar lies. Code-shape
  hazard, not yet live-measured — the plan's first task for this epic is to measure it.

### Work

1. **(new)** Accept `--dangerously-skip-permissions` as an alias for `--permission-mode bypassPermissions`.
2. **(new)** The blocking consent dialog with the verbatim copy, cancel-first/cancel-focused, the three
   exit codes above, and persisted acceptance (prefs, mirroring `skipDangerousModePermissionPrompt`).
3. **(modify)** Runtime flips must surface a refusal instead of swallowing it: `applyMode` reports the
   error and leaves the chip on the real mode.

### Acceptance
A11, plus: `/yolo` against a refusing engine shows an error line and the chip does not change.

---

## EP-T6 · Dialog framing and the grant mismatch

### Canon

- **Create file** (`UMy` L228441-61, `ial` L505666-96): title `Create file` (vs `Overwrite file` when it
  exists); question `Do you want to create <bold basename>?`; body = the file content in a
  **dashed-rule box** (`SM`, L424999), rendered as a syntax-highlighted code block with **no line
  numbers** (`EM` L423741-81 — `startLine` defaults to 1, so the gutter array is null, L423770-72); empty
  content renders the literal `(No content)` (L505687). The **overwrite** branch is the numbered diff
  (`lre`, L420073). **There is no `╌` character anywhere in the bundle** (`grep -c` = 0).
- **Don't-ask-again rows** (`Wdi`, L504780-804), all seven arms — including two that deliberately combine
  a directory grant and a command rule in one row: `Yes, and allow access to <dirs> and <cmds> commands`
  (L504800, when exactly one of each) and `Yes, and allow <dirs> access and <cmds> commands` (L504801).
  The command-only arm is `Yes, and don't ask again for <cmds> commands in <projectRoot>` (L504792,
  straight apostrophe — the editable prefix row at L504864 uses a curly one; upstream is inconsistent and
  both should be reproduced exactly).
  The real constraint: the **editable prefix** input row is suppressed whenever any suggestion is an
  `addDirectories` or a non-shell `addRules` (L504862, L506284).

### Current state

- `src/tui/dialogs/FilePermission.tsx:122-131` — a new file takes the `CodeBlock` branch (`:71-83`):
  highlighted lines, no numbers, **no dashed rules**. `patch` is undefined when the file does not exist
  (`:108-110`). `renderDiff` with its numbered gutter (`src/tui/diffRender.ts`) sits one branch away.
- `src/tui/dialogs/bashOptions.ts:145-165` (`suggestionSummary`) is a faithful transcription of `Wdi`,
  including the combined arms at `:159-163`. **`qa3-08`'s grammar complaint is a request to diverge from
  canon, not to fix a transcription error.**
- **The real defect, which QA missed:** `src/tui/dialogs/smallDialogOptions.ts:238` renders
  `Yes, and don't ask again for <tool> commands in <cwd>` while `genericDecision` (`:244-248`) issues
  `allowRule({toolName})` — a **whole-tool, unscoped** grant with no `ruleContent` and no directory. The
  row says "commands in this directory" and grants the tool everywhere, forever.

### Work

1. **(modify)** Wrap the create-file body in a dashed-rule box and keep the unnumbered highlighted block;
   confirm `(No content)` (already present at `FilePermission.tsx:131`).
2. **(modify)** The generic don't-ask-again row's copy to describe a whole-tool grant, or narrow the rule
   to match the copy. **Recommendation: narrow the copy** — a whole-tool grant is what upstream's generic
   arm actually issues, and widening the rule is the more dangerous change.
3. **(no change)** The Bash combined-arm grammar. Recorded in the Decision Log so it is not re-raised.

### Acceptance
A12, A13.

---

## Decision Log

- **W-T1 [DECIDED-AUTO]** Launch-default change is REPL-scoped (`cli/main.ts`), not `DEFAULTS`. Rejected:
  changing `config/types.ts:161`, which would silently re-posture headless `-p`, `--bg` and the daemon
  where `auto` is deliberate.
- **W-T2 [DECIDED-AUTO]** The `rm`-allowed/`touch`-gated classifier ordering is not ccx work: no ccx-side
  suppression exists; the SDK classifier decides what reaches `canUseTool` (`config/types.ts:34-40`).
- **W-T3 [DECIDED-AUTO]** No plan-classification fix. Probe 97 shows name-driven classification is the
  only option available (every other options field is undefined) and ccx already does it; QA's own frame
  shows PlanDialog mounted. Replaced with option parity + a tool-name guard test. Rejected: the triage's
  "wire kind-classification miss" hypothesis, disproven by evidence.
- **W-T4 [DECIDED-AUTO]** The retry banner renders from SDK-provided `api_retry` events (probe 96), not
  host-synthesized state. Rejected: a host-side timeout/heartbeat as the *primary* source — it remains
  necessary only for the pre-evidence stalled window.
- **W-T5 [DECIDED-AUTO]** Turn success/failure is classified from `is_error`/`terminal_reason`, never
  `result.subtype`, which reports `"success"` on a dead connection.
- **W-T6 [DECIDED-AUTO]** Empty submit on a consult feedback row becomes a **no-op**, diverging from
  upstream (which selects the row with no feedback, L397113-19). Reason: upstream pairs that behavior with
  a visible `tab / amend` hint and focus auto-collapse; ccx's version silently sends a bare deny, which is
  the trust defect QA filed. The plan modal's row already has upstream's guard and keeps it.
- **W-T7 [DECIDED-AUTO]** `ctrl+e` explain is in scope: fully reproducible headlessly (one forced-tool
  Messages call, 4-field schema, current main model). Rejected: deferring it — the amend hint and the
  explain hint share the footer, and building the footer twice is waste.
- **W-T8 [DECIDED-AUTO]** The Bash don't-ask-again combined-row grammar is **not** changed. It is a
  faithful transcription of `Wdi` L504800/L504801; QA's "never in one row" premise is refuted by the
  bundle. The generic dialog's copy-vs-grant mismatch is fixed instead.
- **W-T9 [DECIDED-AUTO]** The create-file body is a dashed-rule box around an **unnumbered** highlighted
  block. Rejected: the `╌╌╌` numbered diff from the QA finding — that character does not exist in 2.1.220
  and numbering belongs to the overwrite branch.
- **W-T10 [DECIDED-AUTO]** Bypass decline exits (code 1) rather than falling back to a safer mode, per
  L554055-56. Rejected: falling back to `default`, which would leave a user who declined in a session they
  did not ask for.
- **W-T11 [DECIDED-AUTO]** The plan file path is rendered from `input.planFilePath` (probe 97), closing a
  gap the grounding had listed as "never built". No plans-directory construction is needed in ccx.
- **W-T12 [DECIDED-AUTO, verified in-tree]** EP-T4 adds **no wire event**. `host.ts:261-270` already emits
  every SDK message and `useChat.ts:503` already receives every `system` frame, so `api_retry` reaches the
  REPL today unrecognised. Rejected: a new typed `HostEvent` variant — it would duplicate an existing
  channel and force a host/client version dance for data already on the wire.

## Open questions

None blocking. Two settled at plan time: the stalled-state threshold N (recommendation 10 s), and whether
the auto-notice "once per install" flag lives in ccx prefs or a new marker file (recommendation: prefs).

## Surprises & Discoveries

Seeded from the grounding round — see the parent spec §12 for the six overturned premises. Wave-local
additions during execution go here.

## Outcomes & Retrospective

Pending — written at wave close.

## Revision Notes

- v1 (2026-08-06): authored from the parent umbrella spec plus the three grounding reports.

## Deferred (out of this wave)

- The plan modal's **clear-context** row family (deny + re-drive as a fresh turn with
  `initialMessage.mode`, L500948-64) — a different mechanism from a permission grant, and unreachable
  until ccx models context-clearing at plan exit.
- The two other auto-mode surfaces: the "Auto mode is now Claude Code's default" startup notice (L454518)
  and the `AutoDefaultNudgeDialog` (L547203-57).
- `qa3-11` (`/permissions` search box and the Recently-denied caption), `qa3-12` (tab-switch hint) and
  `qa3-19` (AskUserQuestion review screen) stay in the panel-depth wave (parent §16).
- Upstream's PowerShell consult family — ccx has no PowerShell dialog and no user need has surfaced.
- The `Plan saved!` transient and plan publishing (`/plan share`, artifact review step) — a distinct
  feature area.
