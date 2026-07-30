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
`/export` · `/summary` · `/diff` · `/files` · `/session` · `/tag` · `/stats`. All read or format state we
already hold; grouped because none needs an SDK answer.

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

- The SDK's live command catalog is mostly **skills and plugins**; real Claude Code's client-side controls
  live in its own client and never appear in a catalog we can query. So the gap is not discoverable from
  the SDK — it must be read off the reference. (2026-07-30, probe 73)
- The scroll window in our command popup was already implemented and **inert**, because ranking truncated
  the list to 8 before the window or the arrow-key clamp ever saw it. Two correct-looking pieces, one
  dead feature. (2026-07-30)
- A pty driver that writes typed text and its Enter in a single chunk fakes an "Enter does not submit"
  bug: that is a paste, and the editor is right to insert a newline. The Enter must be its own write.
  (2026-07-30 — cost a nearly-filed false defect)

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-07-30 — created after a live-testing session produced three defects and the owner's call for an
  extensive UI sprint; grounded in the freshly extracted 2.1.220 bundle.
