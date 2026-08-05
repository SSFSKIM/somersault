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
   shows the ctrl+g hint followed by ` · <plan file path>` with the path the SDK supplied. **ccx keeps its
   existing `ctrl+g to edit in <editor>` wording** — upstream's is `edit in <editor>` (L501126), and
   re-spelling every hint is Wave C's chrome work, not this wave's (plan review I11).
9. **A9 (plan feedback)** An empty `Enter` on `No, keep planning` does nothing; typed feedback reaches the
   model and the plan modal closes.
10. **A10 (qa6-05, P2)** With the API endpoint unreachable, the spinner row is replaced within ~2 s of the
    first retry event by `✻ API error · Retrying in <duration> · attempt n/max`, the duration counts down
    once per second, and a stalled variant appears before any retry evidence arrives. **No transcript row
    is added per retry** — the ten-attempt ladder produces one replaced spinner row, not ten notices.
11. **A10b (measured, not assumed)** A turn killed by an unreachable endpoint ends with **exactly one**
    honest failure line in the transcript. Which line, and from which arm, is settled by the measurement
    task (W-T15) before implementation — today's behavior may be zero lines, not two.
12. **A11 (qa3-14)** Launching in bypass — by either flag spelling — shows the warning with the cancel
    button focused; declining exits with a non-zero code; accepting proceeds and never asks again.
13. **A12 (qa3-07)** A create-file consult renders the new file's content inside dashed rules, with
    `(No content)` when the body is empty.
14. **A13 (revised)** The generic don't-ask-again row keeps upstream's copy verbatim, and a test pins it
    as canon-by-transcription rather than as a defect (see W-T16 — the original finding was wrong).
15. **A14 (EP-T2 W3)** Moving focus off an *empty* feedback row collapses it back to a plain row; a row
    holding typed text stays open.
16. **A15 (EP-T2 W5)** The WebFetch No row no longer promises a feedback channel it cannot deliver, and
    keeps its inline `(esc)` — that dialog stays footerless, as upstream builds it.
17. **A16 (EP-T2 W6)** An empty amended row renders `No,<cursor><placeholder>` with no doubled space.
18. **A17 (EP-T2 W7)** An interrupted *tool call* still shows the interrupt line exactly **once** (the
    F3 suppression at `species.ts:258-260` is preserved), and the third upstream sentinel now shows it too.
19. **A18 (EP-T3 W3)** `shift+tab` and a typed approval carry the typed text into the approval, as the
    row's own description advertises.
20. **A19 (EP-T5 W3)** A refused runtime mode change leaves the chip on the real mode and reports the
    refusal; `/yolo` into bypass is gated by the same consent the launch path uses.

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

1. **(modify)** Launch mode for the **interactive host kind**, not for one call site. `runForegroundImpl`
   (`main.ts:221-225`) is only one of two ways an interactive session is born: `main.ts:147-151`'s
   `--detachable` path forks a host through `spawn.ts:53` (`--__kind interactive`) whose `configFlags`
   (`spawn.ts:17-23`) forwards `--permission-mode` **only when explicitly passed**, so a fix scoped to the
   foreground call site would leave `ccx --detachable` — the same REPL — silently in `auto` while A1
   passed anyway (spec review I1). Apply the default wherever an interactive host is constructed, covering
   both paths. Do **not** touch `DEFAULTS.permissionMode` — headless `-p`, `--bg` and the daemon keep
   `auto` deliberately. Watch the two side effects: `resolveOptions.ts:65` (auto→model swap, keyed on the
   *explicit* config, so unaffected) and `:67` (`allowDangerouslySkipPermissions`).
2. **(modify)** `src/cli/main.ts:239` and `:244` → `resolvedPermissionMode(inv.config)`.
3. **(new)** Auto-mode entry notice: fires when the REPL observes the mode becoming `auto` (ladder,
   `/config`, or a host state event), after an 800 ms delay, once per install — persisted in the same
   prefs file the theme/model preferences use (`src/tui/prefs.ts`), keyed `hasSeenAutoModeEntryWarning`.
   The field does **not** exist yet: add it to the `CcxPrefs` interface (`prefs.ts:24`); the tolerant
   loader needs no new validation for a boolean. Rendered as a transcript notice row with the verbatim
   string above.
   **Two recorded divergences.** (a) Upstream's gate `OMa` (L454515-17) is
   `hasSeenAutoModeEntryWarning` **or** `skipAutoPermissionPrompt` at policy/user/flag scope; ccx keeps
   only the first half because it has no settings-scope equivalent for the second. (b) Because headless
   and daemon hosts stay in `auto` (W-T1), `ccx attach` to a background host will print the notice at
   attach time — upstream's per-process ref guard behaves the same way, so this is accepted, not a bug.

**Note on the mode table above: vocabulary only.** Nothing in this wave renders the titles, symbols or
colors — the chip's chrome belongs to Wave C's EP-C4 (parent §15). It is transcribed here so EP-T5's
bypass entry and EP-T3's grant labels draw from one source. A2 requires only that the three surfaces
agree on the same string.

### Acceptance
A1 (including `ccx --detachable`), A2, A3.

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
- Footers today are a bare `<Text dimColor>esc cancel</Text>` in **five** dialog bodies —
  `BashPermission.tsx:94`, `FilePermission.tsx:234`, `SkillPermission.tsx:69`, `MonitorPermission.tsx:94`,
  `GenericPermission.tsx:80`. **`FetchPermission.tsx` has none, deliberately** (its header at `:12`
  records upstream's bare `jr` with no `feedbackConfig` and no `esc cancel`; the `(esc)` lives inside the
  No-row label). It stays footerless.
- **WebFetch**'s No row is a plain label reading `No, and tell Claude what to do differently (esc)`
  (`src/tui/dialogs/smallDialogOptions.ts:104`) with no text path at all (`:110-114`) — a transcription of
  upstream, which hangs no feedbackConfig on it either. Only the misleading clause changes; the `(esc)`
  stays, because that label is where WebFetch's escape hint lives.
- No explain affordance anywhere.
- **The interrupt row mostly ships already** (spec review I3 — the grounding round never covered this
  area and the first draft assumed it absent). `src/tui/species.ts:76` defines
  `INTERRUPTED_TEXT = "Interrupted · What should Claude do instead?"`; `:73-74` carry two of the three
  sentinels; `:274` and `:561` render the row for the plain-interrupt and aborted-API cases. `:268`
  returns `null` for the **tool** form on purpose (`:258-260`: the tool row already carries the text and a
  second line would say it twice — an F3 decision). Only the third sentinel
  (`The user doesn't want to take this action right now. STOP…`, L429122) is genuinely absent.
- `qa3-06`'s "double space": not a literal. An empty amended row renders label `No` + separator `", "` +
  `InputText`'s inverse-video **space** cursor + placeholder (`Select.tsx:129`, `:290-293`).

### Work

1. **(new)** A shared consult footer component rendering `esc cancel · tab amend · ctrl+e explain`, with
   the amend hint suppressed while the focused row is already an input row, and the explain hint present
   only where it is supported. Mount it in the **five** bodies listed above; `FetchPermission` stays
   footerless. **Chord spelling:** ccx says `esc cancel`, not upstream's `escape / cancel` — the five
   existing footers and their tests already use the short form, and this wave does not re-spell them.
2. **(modify)** `optionRows.ts` feedback rows: **drop `allowEmptySubmitToCancel`. That is the whole
   change** — no `Select` modification is needed (spec review I7). An empty Enter then routes to the
   dialog's `onCancel`, which for all five bodies is
   `escapeFeedbackMode(feedback) → setFeedback(collapsed)` (`GenericPermission.tsx:74` and its four
   twins), so the row collapses and the dialog stays open with no decision sent — exactly A5.
   **Do not touch `Select.submitInput`**: it is shared by `ModelPicker`, `ThemeDialog`, `SessionPicker`,
   `SettingsDialog`, `RewindPicker`, `MultiSelect` and the Bash editable-prefix row, whose own
   `allowEmptySubmitToCancel: true` is load-bearing (`bashOptions.ts:188-192` → `bashDecision:213-216`
   turns an empty prefix into `allow_once`, matching L505212-17).
3. **(modify)** Focus auto-collapse per L505162-69.
4. **(new, GATED)** `ctrl+e` explain — **blocked on probe 98** (see W-T13). The bundle proves *upstream*
   can do it; nothing proves *this harness* can. Independently confirmed twice: the harness has **no**
   one-off Messages transport at all — zero hits in `src/` for `@anthropic-ai/sdk`, `new Anthropic`,
   `messages.create`, or even a bare `fetch(`. Ship the surface with the transport **injected and
   undefaulted**: the constants, the prompt builder, the risk helpers, the toggle and the three-row render
   are all deliverable and testable today; only the production wiring waits on the probe. While visible,
   the command line dims **and the plain description row hides** (L505286), and the whole affordance is
   gated on a setting defaulting to on (`permissionExplainerEnabled !== false`, L504907-09).
5. **(modify)** WebFetch's No-row copy: drop the `and tell Claude what to do differently` clause it cannot
   deliver, keep `(esc)`.
6. **(modify)** The empty-input separator so an empty amended row reads `No,<cursor><placeholder>` without
   the doubled space. `Select.tsx:129` and `:293` are shared by every input row (including the Bash prefix
   row, `bashOptions.ts:191`, `labelValueSeparator: ": "`) — the change must not regress those.
7. **(modify, scope reduced)** Route the **third** sentinel
   (`The user doesn't want to take this action right now. STOP what you are doing and wait for the user to
   tell you how to proceed.`) to the existing `INTERRUPTED_TEXT` row. The tool-form sentinel **stays
   `null`** per `species.ts:258-260` — do not "fix" it.

### Acceptance
A4, A5, A6 (gated on W-T13), A14, A15, A16, A17.

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

1. **(modify)** Option set follows availability. **The two sources, named** (spec review I6 — upstream's
   `gI()` has no single ccx equivalent): auto availability is `isAutoSupportedModel(model)` from
   `src/config/autoModel.ts`; bypass availability is the launch-time `allowDangerouslySkipPermissions`
   (`resolveOptions.ts:67`). `PlanDialog` takes no `model` prop today — thread one in. **The attach case
   is real**: `useChat.ts:1423-1426` records that `model` is `undefined` for an attach client that has not
   seen a turn end, and `applyMode` refuses to guess there. When the model is unknown, fall back to
   upstream's neither-available arm, `Yes, auto-accept edits`. Clear-context variants stay out of scope.
2. **(modify)** Widen `plan_approve` to carry the granted mode. The existing shape is
   `{ kind: "plan_approve"; acceptEdits: boolean; updatedPermissions?: PermissionUpdateLike[]; plan?: string }`
   (`types.ts:47`) — **the new mode field is authoritative and `updatedPermissions` stays unused for the
   mode**, preserving the no-double-upgrade rule documented at `PlanDialog.tsx:190-193`. Update both
   appliers (`host.ts:527`, `appserver/planUpgrade.ts:32`). **The applier must also do what
   `useChat.applyMode` does at `:1428-1433`: swap the model before granting `auto`, and report failure
   instead of swallowing it.** `host.ts:526-530`'s empty `catch {}` plus auto's silent fallback to
   `default` on an unsupported model would otherwise write `this.mode = "auto"` while the engine sits in
   `default` — re-creating in a new place the exact lying-chip failure EP-T5 W3 exists to remove.
3. **(modify)** Approve-with-feedback: `shift+tab` and a typed yes-row submit carry the feedback into the
   allow, per the row's own description.
4. **(modify)** Empty `Enter` on the No row is a no-op (upstream's guard), not a feedback-less reject.
   **This is where the `Select` primitive change belongs** (moved here from EP-T2 by spec review I7):
   `PlanDialog.tsx:213`'s `cancel` serves two keys that must now diverge — Esc must still reject
   (upstream's `xnl`, L500995, answers `{behavior:"deny"}`) while an empty Enter must do nothing, and
   `Select` currently gives the caller no way to tell them apart. Add a distinct empty-submit outlet.
   Guard the blast radius with a test that the Bash prefix row's empty submit still yields `allow_once`.
5. **(new)** Dashed-rule framing around the plan body.
6. **(new)** Render `input.planFilePath` in the ctrl+g footer segment (` · <shortened path>`). The
   existing literal is `ctrl+g to edit in {name}` (`PlanDialog.tsx:302`); keep it and append the path —
   re-spelling the hint to upstream's `edit in <editor>` is chrome churn that belongs to Wave C.
7. **(new)** A guard test pinning the live tool name `ExitPlanMode` — `gate.ts:22`'s literal is the single
   point of evidence for the whole plan surface, and a rename would silently degrade every plan consult to
   a generic dialog.

### Acceptance
A7 (including: on a model that does not support auto the row reads `Yes, auto-accept edits`, and the chip
never shows a mode the engine is not in), A8, A9, A18.

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

1. **(modify)** Consume the frame that **already arrives**: recognise
   `data.type === "system" && data.subtype === "api_retry"` in `useChat`'s message arm
   (`useChat.ts:503` region) and drive live-turn retry state from it. Route:
   `session.ts:258` → `host.ts:269` → `chatAdapter.ts:33` → `useChat.ts:503`.
   **NON-GOAL, and it is load-bearing:** the retry row is live-turn chrome, **not** a transcript row.
   `species.ts:641`'s `SILENT_SUBTYPES` path deliberately returns `null` for `api_retry` and
   `test/tui/species-system.test.ts:279` pins that null. It stays green. Making `systemNoticeLines` paint
   this frame would both break that test and produce ten transcript rows during the observed ten-attempt
   ladder instead of one replaced spinner row.
2. **(new)** A retry/stalled row that **replaces** the spinner while a status is set, with a local
   one-second countdown seeded from `retry_delay_ms`, upstream's label rule (`API error` for the first
   two attempts, detail after), and teardown when the next real message arrives or the turn ends.
3. **(new)** A stalled state covering the pre-evidence window: after N seconds of a turn with no message
   of any kind, show the `Waiting for API response` variant. Pick N from the probe data (the refused case
   produces evidence in ~20 ms; the blackholed case takes ~75 s) — the spec's recommendation is 10 s,
   settled at plan time.
4. **(measure first, then modify)** The two places ccx keys on `result.subtype` are
   `src/session/session.ts:93` (`resultWaiter` — waiter *matching*, not success classification) and
   `src/structured/run.ts:29` (the one genuine success classifier, which on a dead connection returns a
   *successful* structured run carrying the API-error text). Fix the classifier to read
   `is_error` / `terminal_reason` / `api_error_status`.
5. **(measure first)** The double-`✗` claim is **unverified** and may be backwards. `session.ts:61` is
   `this.done = this.readLoop().catch(() => {})` — the SDK's post-result throw is swallowed at the session
   level. If `resultWaiter` matches probe 96's frame (`subtype:"success"`), `submit()` **resolves**,
   `runTask` takes the success path, the turn-end frame carries no `error`, and the REPL renders **zero**
   `✗` lines — the only artifact being the synthetic assistant message painted as a warning bullet by
   `species.ts:568-576`. The double render the grounding described belongs to the *other* path, where
   `submit` rejects (socket close, or the readLoop's `finally` rejection at `session.ts:262`). The
   grounding report itself hedged this ("I did not run it to confirm the duplicate") and the first spec
   draft hardened the hedge into a criterion. **Run the refused-endpoint shape through `ccx` and record
   which path it takes before writing any fix.**

### Acceptance
A10, A10b.

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
   **The gate keys on the RESOLVED launch mode**, so both flag spellings are covered by one check.
3. **(modify)** Runtime flips must surface a refusal instead of swallowing it: `applyMode` reports the
   error and leaves the chip on the real mode (`useChat.ts:1439`'s `.catch(() => {})` before `:1440`'s
   chip paint).
4. **(new)** **`/yolo` is gated too** (spec review I8). Upstream's gate is launch-only (L554501-04), but
   upstream's ladder cannot reach bypass at all (`settingsRows.ts:23-27` transcribes that exclusion), so
   `/yolo` is a ccx-specific hole with no upstream precedent to inherit. It shows the same consent dialog
   on first use and respects the persisted acceptance thereafter.

### Acceptance
A11, A19.

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
- **A claimed defect that is not one — retracted (spec review I2).** The first draft called
  `src/tui/dialogs/smallDialogOptions.ts:238` a trust defect: "says commands in this directory, grants the
  tool everywhere, forever." Both halves were wrong. The copy is upstream **verbatim** (L506166) and so is
  the content-less whole-tool rule it writes (L506109); and the grant is **not** "everywhere" — upstream's
  `o2k` is the project root and the destination is `localSettings`, which ccx matches
  (`smallDialogOptions.ts:43-45`, `destination: LOCAL_SETTINGS`), so the scope clause is accurate. What is
  genuinely awkward is the Bash-flavoured word "commands" applied to a non-shell tool — the same class of
  upstream awkwardness W-T8 refuses to "fix" for the Bash combined arm. Fixing one and not the other would
  be incoherent. **No change; a test pins the string as canon-by-transcription.**

### Work

1. **(modify)** Wrap the create-file body in a dashed-rule box and keep the unnumbered highlighted block;
   confirm `(No content)` (already present at `FilePermission.tsx:129`).
2. **(no change, pin it)** The generic don't-ask-again row. Add/keep a test asserting the exact upstream
   string (already pinned at `test/tui/small-dialog-options.test.ts:200`) with a comment recording that it
   is a transcription, not a bug — so the next reader does not re-file it.
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
- **W-T7 [SUPERSEDED by W-T13]** ~~`ctrl+e` explain is in scope: fully reproducible headlessly.~~ The
  reproducibility claim was about *upstream*, not about this harness. The footer half of the argument
  survives — build the footer once — but the explain hint is now gated on probe 98.
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

- **W-T13 [RESOLVED by probe 98, 2026-08-06]** `ctrl+e` explain is **buildable**, and the cheapest viable
  path needs no new dependency. The first draft's "LANDED" had been wrong for the right reason to catch:
  it read a statement about *upstream's* reproducibility as a statement about ccx. Probe 98 measured three
  paths live, all subscription-billed:
  - **Path A — raw Messages with a true forced tool.** `@anthropic-ai/sdk` constructed with the OAuth
    token as `authToken` (and `apiKey: null` so it cannot fall back to a metered key) plus the header
    `anthropic-beta: oauth-2025-04-20` — a literal read out of the bundled CLI, not guessed — accepted a
    real `tool_choice` request and returned all four fields in **2.8 s**, `stop_reason: tool_use`, no
    prose to strip. Billing verified rather than assumed: the response carries unified subscription
    rate-limit headers and no metered per-token headers.
  - **Path B — nested `query()` fenced to one in-process MCP tool.** Called the tool 3/3 times but took
    **14–16 s**, dominated by CLI subprocess spawn.
  - **Path C — native structured output** (`outputFormat: json_schema`), which the harness **already
    wraps** at `src/structured/run.ts`. Valid 3/3, ~**6 s**, **zero new dependencies**.

  **Decision: build on Path C for this wave.** It reaches the same validated four-field object through
  code the harness already owns, with no dependency promotion and no credential handling. Path A is
  faster and is the truer transcription of upstream's mechanism, but it costs promoting
  `@anthropic-ai/sdk` from transitive peer to declared dependency *and* making the harness source a
  bearer credential itself — which is free with `CLAUDE_CODE_OAUTH_TOKEN` set, but for a CLI-only login
  means reading and refreshing a token out of `~/.claude/.credentials.json`. That is a dependency-and-auth
  decision worth its own ticket, not a step inside this wave. Recorded as a future optimisation; the
  `ExplainTransport` seam makes the swap a one-file change.

  The episode is the "declared ≠ reachable" trap the project's doctrine names, caught one step before it
  cost a task — and then resolved *better* than the original plan, because the probe found a path nobody
  had proposed.
- **W-T14 [DECIDED]** The launch-default change is scoped to the **interactive host kind**, not to
  `runForegroundImpl`. Rejected: the call-site-scoped fix, which leaves `ccx --detachable` in `auto`.
- **W-T15 [OPEN → measurement decides]** Whether a dead connection today produces zero, one or two error
  lines. Both code paths exist; the spec must not assert one. Measure before fixing.
- **W-T16 [DECIDED]** The generic don't-ask-again row is **not** changed — it is a faithful transcription
  and its scope clause is accurate. Rejected: narrowing the copy, which would diverge from canon for the
  same reason W-T8 refuses to.
- **W-T17 [DECIDED]** `Select` is **not** modified for EP-T2 — dropping the option flag suffices, because
  every consult body's `onCancel` already collapses feedback mode. The primitive change moves to EP-T3,
  which genuinely needs Esc and empty-Enter to diverge.
- **W-T18 [DECIDED]** `FetchPermission` stays footerless and keeps `(esc)` in its No-row label; only the
  undeliverable clause is removed. Rejected: mounting a footer there, which would add an `esc cancel` row
  upstream does not have (L506752-771) and could carry neither hint.
- **W-T19 [DECIDED]** The interrupt tool-form sentinel stays silent (`species.ts:268`). Rejected: the
  first draft's "substitute on all three sentinels", which would regress an F3 decision and double-print
  on every interrupted tool call.
- **W-T20 [DECIDED]** `/yolo` is gated by the same consent as launch. Rejected: matching upstream's
  launch-only gate, because upstream's ladder cannot reach bypass at all — inheriting the *shape* of its
  gate without its *fence* leaves a hole upstream does not have.

## Open questions

Two settled at plan time: the stalled-state threshold N (recommendation 10 s), and whether the auto-notice
flag lives in ccx prefs or a new marker file (recommendation: prefs). Two gated on evidence: W-T13
(probe 98) and W-T15 (measurement) — neither blocks the rest of the wave.

## Surprises & Discoveries

Seeded from the grounding round — see the parent spec §12 for the six overturned premises. Wave-local
additions during execution go here.

## Outcomes & Retrospective

Pending — written at wave close.

## Revision Notes

- v1 (2026-08-06): authored from the parent umbrella spec plus the three grounding reports.
- v1.1 (2026-08-06): W-T12 — `api_retry` already reaches the REPL; EP-T4 needs no wire work.
- v1.2 (2026-08-06): **independent spec review folded in** (report:
  `$CLAUDE_JOB_DIR/tmp/waveT-spec-review.md`; 3 Critical, 8 Important, 6 Minor). All three Critical
  findings were re-verified by the controller against the tree before acceptance. Changes: `ctrl+e`
  gated on a new probe 98 (W-T13) after its feasibility claim proved to be about upstream rather than
  this harness; EP-T4's retry item rewritten as *consume the arriving frame* with an explicit non-goal
  protecting `test/tui/species-system.test.ts:279`; the terminal-line count demoted from a criterion to a
  measurement (W-T15) after the review showed today's behavior may be zero lines, not two; the launch
  default re-scoped to the interactive host *kind* so `ccx --detachable` is covered (W-T14); EP-T6's
  "real defect" retracted as faithful transcription (W-T16); the `Select` primitive change moved from
  EP-T2 to EP-T3 where it is actually needed (W-T17); the footer count corrected to five with
  `FetchPermission` staying footerless (W-T18); the interrupt work reduced to the one genuinely missing
  sentinel after the review found the row already ships and the tool form is deliberately silent (W-T19);
  `/yolo` brought under the consent gate (W-T20); EP-T3's availability sources named and its applier
  required to swap the model rather than re-create the lying-chip bug; six work items that had no
  acceptance criterion given A14–A19; citation drift corrected.

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
