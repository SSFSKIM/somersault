# TUI/UX sprint — design

**Purpose.** Our REPL passes 318 keyless Ink tests and still frustrates a live user. The gap is not
correctness, it is *surface*: commands that answer "Unknown command", background work you cannot inspect,
keys that do something different from what a Claude Code user's fingers expect. This sprint closes that
gap using a source of truth we did not have until now — the decompiled current binary — and an observation
harness that drives the real product instead of its components.

## Why now: two things changed on 2026-07-30

**1. A live user found three defects in one sitting that 318 green tests had missed.** The slash-command
palette was capped at 8 entries (about 90 of ~105 commands unreachable), `/exit` was unhandled, and a
quietly-successful `!` command rendered nothing at all. All three were invisible to in-process Ink tests
and visible in a single pty run. Tests prove components; only driving the binary proves the product.

**2. We now have the current implementation, not a stale snapshot.** `~/claude-code-bundle/2.1.220/`
holds Claude Code 2.1.220 (built 2026-07-24 — the exact binary our SDK spawns) reprinted to 579,698
readable lines, plus its 14 embedded modules. This supersedes `Claude Code Src/` for behavioral
questions: that reference is a February-vintage leak (its `@anthropic-ai/sandbox-runtime` pin is
`^0.0.50` against a current `0.0.67`), and the A1 lesson is that reasoning from it has repeatedly been
wrong. **Method going forward: the TS reference for structure and naming, the 2.1.220 bundle for what the
product actually does today.** Neither replaces a live probe for SDK reachability.

### What the bundle gives this sprint, concretely

- **A complete keymap.** Line 186,116 is a table of 20 UI contexts (Global, Chat, Autocomplete,
  Confirmation, Help, Transcript, HistorySearch, Task, ThemePicker, Settings, Tabs, Attachments, Footer,
  MessageSelector, DiffDialog, DiffPanel, ModelPicker, Select, Plugin, Scroll) mapping every key to a
  *named action* (`chat:cycleMode`, `app:toggleTranscript`, `scroll:halfPageUp`). We no longer guess
  keybindings; we read them.
- **The background-task output mechanism.** Line 283,979: *"Background tasks return their output file
  path in the tool result, and you receive a `<task-notification>` with the same path when the task
  completes."* This is the missing half of our background panel (see U2).
- **Dialog and settings implementations** for `/config` and `/permissions`, including labels and ordering.
- **A caveat that saves wasted effort:** their Ink is a *fork*, not upstream. It adds host components
  upstream lacks (`ink-link`, `ink-raw-ansi`) and attaches `accessibility`, `onRender`, and
  `onComputeLayout` to every node. Where fidelity depends on those, we substitute deliberately instead of
  chasing an impossible match.

## Decisions taken (owner, 2026-07-30)

| decision | value |
| --- | --- |
| Scope posture | extensive UI sprint, run as an observe→fix loop rather than one big design pass |
| `/config`, `/permissions` | **in scope** — both required |
| `/vim` | **deferred** — the only deferral |
| Everything else in the [command audit](../../parity/command-coverage.md)'s wanted list | in scope |
| Model `default` alias | resolves to `claude-opus-5` (shipped) |

## Acceptance — phrased as observable behavior

Each item is checked by a `scripts/drive-repl.py` run against the real binary, and the transcript of that
run is the evidence. "Works in a unit test" does not satisfy any line below.

1. Typing any command real Claude Code has either **does the thing** or **says precisely why it cannot**.
   No client-side control is silently forwarded to the model as a prompt.
2. With a background shell running, its presence, its command line, its status, and **its output** are all
   reachable without leaving the REPL.
3. Every key in the bundle's Global and Chat contexts either performs its named action or is documented as
   an intentional divergence in `docs/parity/tui-ux.md`.
4. `/config` and `/permissions` render a working settings surface; changes survive the turn that follows.
5. A transcript pager exists: the conversation can be scrolled back and searched without leaving the app.

## Slices

Ordered by user-visible value per unit of risk. Each slice ends with a pty run and a `tui-ux.md` update.

### U1 — stop lying about the surface
Route catalogued-but-unhandled client-side controls (`agents`, `color`, `config`, `doctor`, `effort`,
`extra-usage`, `fast`, `heapdump`, `rename`, `review`) away from "submit as a prompt". Unhandled means an
explicit message, never silence. `/help` reflects reality. No new SDK questions — pure honesty work.

### U2 — background work you can actually see
Today `BackgroundTaskInfo` carries only `{task_id, task_type, description}` because that is all the
streamed `background_tasks_changed` frame carries; the richer `BackgroundTaskSummary` (adding `status`,
`command`, `agent_type`, `server`, `tool`, `name`) appears **only on hook inputs**, and our panel is
reachable solely via Ctrl-B. Result: the status bar shows `⚙ 1 bg` and the user can learn nothing more.
Fix: capture the output-file path from the backgrounded tool result (the mechanism named above), show
command + status in the panel, and let Enter on a row tail that file. Consider a `Stop` hook to harvest
`BackgroundTaskSummary` for the fields the stream omits.

### U3 — the keymap, read from the bundle
Reconcile against the extracted table. Known divergences to settle first: our `Ctrl-L` clears the
**screen** where real Claude Code clears the **input** (screen-clear is `cmd+k`), and we cycle permission
mode on `Tab` where real Claude Code uses `shift+tab`. Then the missing actions: `ctrl+o` transcript
toggle, `ctrl+t` todo toggle, `ctrl+r` history search, `ctrl+j` newline, `ctrl+_` undo,
`ctrl+x ctrl+e` external editor, `ctrl+s` stash, `ctrl+x ctrl+k` kill agents. Divergences we keep (our
`Ctrl-Z` detach has no upstream equivalent) get recorded as such.

### U4 — the transcript pager and history search
The `Transcript` context in the bundle is a less-style pager (18 bindings: half/full page, line, top,
bottom, `g`/`G`, `j`/`k`, `q` to exit) and `HistorySearch` is a `ctrl+r` incremental search with a
cycleable scope. We have neither. This is the largest single UX absence in our REPL.

### U5 — session and context commands
`/export` · `/diff` · `/files` · `/session` · `/tag` · `/stats` · `/rename`. All read or format state we
already hold; grouped because none needs an SDK answer. (`/summary` was dropped and `/rename` pulled in
at planning time — see Revision Notes.)

### U6 — the directory question
Probe whether `register_repo_root` is reachable untyped before designing anything (it is a declared
control subtype that is **not** on the typed `Query` handle; `additionalDirectories` is launch-only, and
the SDK requires an added directory to be a subdirectory of cwd or of a launch-time directory). Then
`/add-dir` within whatever the probe permits. `/cd` does not exist in real Claude Code — adding it stays a
product choice, not a parity requirement.

### U7 — settings surfaces
`/config` · `/permissions` · `/theme` · `/output-style` · `/keybindings`. Read the bundle's
`Settings`/`Confirmation`/`Select`/`ThemePicker` contexts for bindings and the dialog implementations for
labels and ordering. Largest and most taste-dependent, so it lands last. `/vim` deferred by decision.

## The loop

1. **Observe** — `scripts/drive-repl.py` against the real binary, or the user's own live session.
2. **Ground** — before designing a fix, read the bundle for what the real product does. Behavioral
   questions about the SDK still need a live probe; the bundle answers "what does Claude Code do", never
   "what can our SDK reach".
3. **Fix** — TDD as usual, with a pty run as the acceptance evidence.
4. **Record** — `tui-ux.md` row, and a note here under Surprises when a premise flips.

## Decision Log

- **The 2.1.220 bundle supersedes `Claude Code Src/` for behavior.** Rejected: continuing to reason from
  the TS reference alone — it is a February snapshot and the A1 lesson is that its premises have gone
  stale repeatedly. Rejected: treating the bundle as a substitute for live probes — it tells us what
  Claude Code does, which is a different question from what our SDK exposes.
- **Observe→fix on the real binary, not component tests.** Rejected: adding more Ink component tests as
  the primary net. They were all green while three real defects shipped; they are a regression net, not a
  discovery one.
- **`/vim` deferred, `/config` and `/permissions` in.** Owner decision; vim emulation is a large surface
  with a narrow audience relative to the settings dialogs.
- **`/cd` is not a parity gap.** The reference harness has no such command; `/add-dir` is the real one.
  Recorded so nobody "restores" it as a fidelity item later.

## Surprises & Discoveries

- **Probe 75 (2026-07-31) settled U6's directory question in one run — BOTH doors are open:**
  the untyped funnel `(q as any).request({subtype})` is reachable (every typed Query method routes
  through it), and `register_repo_root` on a subdirectory of cwd succeeds with
  `reload_claude_md:true` genuinely injecting that directory's CLAUDE.md (magic-word-verified).
  Out-of-cwd it fails with exactly `"register_repo_root: <dir> is not a subdirectory of cwd"` — but
  the TYPED `applyFlagSettings({permissions:{additionalDirectories:[dir]}})` covers that case: an
  outside-cwd Read consulted canUseTool before the grant and was auto-allowed (zero consults) after.
  So `/add-dir` routes by path: inside cwd → register_repo_root (context load), outside →
  additionalDirectories (permission scope only). **Probe 75b (same day, plan-review finding 5):**
  the REMOVAL half verified live — re-sending a SHORTER `additionalDirectories` array really
  revokes (the next outside-cwd Read consulted canUseTool again; `get_settings.effective` shows the
  empty array). Replacement, not union; `/permissions` rule deletion and workspace removal are safe. Two traps for the plan: applyFlagSettings
  **replaces** whole top-level keys per call (the harness must own and re-send the complete
  `permissions` object on every mutation), and breaking out of a `for await` over the Query calls
  the generator's `return()` and kills the transport (probe bug, cost one false "not ready for
  writing" run). Bonus: untyped `get_settings` works — `{effective, sources[], applied{model,
  effort, advisor, ultracode}}` — a real backing store for U7's `/config`.
- **Probe 76 (2026-07-31): output styles are fully alive mid-session.** Init declares
  `available_output_styles: ["default","Proactive","Explanatory","Learning"]`;
  `applyFlagSettings({outputStyle})` is accepted, `get_settings.effective` reflects it, and the very
  next turn sees the style's injected "…output style is active" system reminder (clean before/after
  flip on haiku). U7's `/output-style` is a typed-lever feature: picker from init's list, apply via
  the flag layer — remembering the top-level-key replacement rule when other flag settings coexist.
- **Probe 74 (2026-07-31) settled U2's whole evidence base in one run:** the backgrounded-Bash
  tool_result is a parseable sentence carrying BOTH the task id and the output-file path ("Command
  running in background with ID: <id>. Output is being written to: <path>. …"); `task_started` carries
  `tool_use_id`, which links the task to the assistant tool_use whose `input.command` +
  `input.run_in_background` hold the command; `background_tasks_changed` entries are STILL only
  `{task_id, task_type, description}` on SDK 0.3.211; and the output file is line-flushed and readable
  mid-run. The probe's own file froze at tick 4 only because disposing the query kills the CLI
  subprocess (and its children) — in the REPL the session lives on. Net: U2 needed zero host/wire
  changes.
- **My own plan's gating-test sketch would have passed vacuously** (W2 Task 5): the Ctrl-T
  leak check asserted on the todo panel, but an empty `TaskPanel` renders nothing, so the assertion
  held whether or not the gate existed. The *implementer* caught it, seeded a task, and
  sabotage-verified; the reviewer independently re-verified by removing the gate. Same lesson class as
  W1's stash test: a plan-authored test is not exempt from the sabotage-check discipline. (2026-07-31)
- The SDK's live command catalog is mostly **skills and plugins**; real Claude Code's client-side controls
  live in its own client and never appear in a catalog we can query. So the gap is not discoverable from
  the SDK — it must be read off the reference. (2026-07-30, probe 73)
- The scroll window in our command popup was already implemented and **inert**, because ranking truncated
  the list to 8 before the window or the arrow-key clamp ever saw it. Two correct-looking pieces, one
  dead feature. (2026-07-30)
- A pty driver that writes typed text and its Enter in a single chunk fakes an "Enter does not submit"
  bug: that is a paste, and the editor is right to insert a newline. The Enter must be its own write.
  (2026-07-30 — cost a nearly-filed false defect)
- `rowKind()` classifies a user row as a *prompt* only when it carries a `uuid` — real persisted rows
  always do, but hand-written test fixtures don't; two Wave-1 tasks tripped on this. Fixture rule:
  give user rows a `uuid`. (2026-07-30, W1 Tasks 5–6)
- The Wave-1 review loop earned its cost twice over: Task 4 shipped an `editExternal` that could
  **throw into Ink's useInput** instead of honoring its own "return null" contract (caught only by the
  reviewer's targeted "what if readFileSync throws after a 0-exit" question), and Task 5's
  last-touch-ordering contract was untestable by its own fixture (touch order coincided with
  alphabetical). Both fixes were verified by sabotage-checks — the guard test proven against its own
  regression, per the standing lesson. (2026-07-30)
- `.doperpowers/sdd/` task-brief/report paths are **shared across concurrent sessions** and
  gitignored: a Wave-1 implementer overwrote the concurrent app-server session's `task-6-report.md`,
  unrecoverably. Namespace report files per plan (e.g. `task-N-<plan-slug>-report.md`) when two
  subagent-driven runs share a repo. (2026-07-30)
- **Reading the 2.1.220 extraction (not just the SDK) flipped three U7 premises during Wave-3
  execution:** (a) `/output-style` is itself a **hidden redirect into `/config`** upstream — the
  standalone picker described in the plan's Global Constraints is `/config`'s own Output-style row, not
  something the bare `/output-style` command opens directly, so shipping ours as a redirect-then-open
  matches upstream's real behavior exactly rather than being a corner cut; (b) `/keybindings` opens
  `~/.claude/keybindings.json` in `$EDITOR` — a file opener with **no in-app UI at all**, so there is no
  "real" keymap dialog to fall short of, only a file-edit affordance we don't have a mechanism for; (c)
  real `/add-dir` **rejects** a path that is already a subdirectory of cwd ("already accessible"), which
  is exactly `register_repo_root`'s only usable domain (probe 75) — so that door is the complement of
  what `/add-dir` will ever ask for, and stays permanently unused by this command even though it is
  reachable. (2026-07-31, W3 Task 6/Task 3)
- Upstream `/add-dir` loads the added directory's `CLAUDE.md` only when
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` is set, and an added directory surfaces **only in
  `/permissions` → Workspace**, never in `/status` — confirmed against our own `formatStatus()` (no
  directories field) and `listDirs()` (feeds only the Workspace tab), so shipping status un-augmented
  and Workspace as the sole directory-listing surface matches upstream rather than omitting something.
  (2026-07-31, W3 Task 3/Task 7)

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-07-30 — created after a live-testing session produced three defects and the owner's call for an
  extensive UI sprint; grounded in the freshly extracted 2.1.220 bundle.
- 2026-07-30 (Wave-1 planning) — **execution shape decided with the owner: controlled track, three
  waves** (Wave 1 = U1+U3+U5 · Wave 2 = U2+U4 · Wave 3 = U6+U7), one plan per wave, the owner
  live-testing between waves. Wave 1 plan: `../plans/2026-07-30-tui-ux-wave1.md`.
- 2026-07-30 (Wave-1 planning) — planning's hostile read corrected four U-slice premises:
  **`/summary` is dropped** (no such command exists in 2.1.220 — the wanted list inherited it from the
  stale February reference); **`/session` ships as a deliberate divergence** (upstream's `/session`
  shows a cloud-session URL/QR — bridge-coupled and out of scope — ours shows local session info +
  resume hint); **`/rename` and `/tag` moved from "honesty message" to implemented** (the lib already
  ships `renameSession`/`tagSession`/`getSessionInfo` over the SDK's native session store); and of U1's
  ten class-A names, **`review` and `doctor` stay prompt turns** (both are prompt-type upstream —
  reference `review.ts` + the bundle's `doctor` `getPromptForCommand`), leaving seven honesty messages.
- 2026-07-30 (Wave-1 planning) — U3 keymap items that depend on Wave-2 surfaces are deferred with them:
  `ctrl+o` (needs U4's transcript pager), `ctrl+r` (needs U4's history search), `ctrl+x ctrl+k` kill
  agents (pairs with U2's background work). `cmd+k` screen-clear is unreachable in most terminals
  (intercepted before the app sees it) — screen clear stays `/clear`, recorded as an intentional
  divergence.
- 2026-07-31 (Wave-2 planning) — **U2 resolved entirely client-side, no host/wire change**: probe 74
  proved the event stream the REPL already receives carries the command (tool_use input), the output
  path (tool_result sentence), and the status (task_notification); U2's "consider a `Stop` hook"
  alternative is REJECTED — a hook would run engine-side and never reach the `ccx attach` path, while
  the stream harvest works identically for both. The pager ships as a **bordered overlay, not an
  alternate screen** (unmounting Ink's append-only `<Static>` replays the whole scrollback on
  remount); `ctrl+e` toggleShowAll deferred (no collapsed transcript variant exists to expand);
  history search keeps upstream's exact semantics including Esc = **accept** (`historySearch:accept`),
  and acceptance #5's "searched" is satisfied by the Ctrl-R prompt-history search (the bundle's
  Transcript context has no in-pager search binding). Plan:
  `../plans/2026-07-31-tui-ux-wave2.md`; the independent plan review contributed three fixes
  (ChatApp deps seam, historyOpen key gating, a `RAW:` no-auto-Enter prefix for the pty driver).
- 2026-07-31 (Wave-3 planning) — scope decided with the owner ahead of the plan: `/config`'s Settings
  dialog ships only the **5 rows this harness's engine can actually apply** (Theme/Model/Output
  style/Default permission mode/Thinking mode), not upstream's ~54, most of which have no ccx
  equivalent; `/theme` ships **no custom/ANSI themes** (5 of upstream's 7+ rows); `/permissions` rule
  mutations use a **flag-layer + settings-file dual write** (apply live via `applyFlagSettings`, persist
  to the chosen `.claude/settings*.json` for the next launch), since upstream's own in-session rule
  engine is CLI-internal and unreachable from the SDK. Plan: `../plans/2026-07-31-tui-ux-wave3.md`.
