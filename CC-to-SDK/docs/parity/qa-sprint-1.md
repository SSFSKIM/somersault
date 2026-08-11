# QA Sprint 1 — agent-driven live use of ccx vs Claude Code 2.1.220

Owner-approved shape (2026-08-06): **4–6 QA agents, one shot**; a recurring sweep follows only if this
sprint's yield justifies it. The premise, proven by the six-report live-feedback round that preceded this
sprint: the checklist-porting loop catches what the spec knows about; only human-style *use* catches the
rest (the ctrl+o frame flood, the dead `/clear`, the mouse axis). This sprint replaces the
owner-observes → controller-fixes loop with agents that actually work through both TUIs.

## Pathfinder outcomes (2026-08-06 — amend before dispatch; recipe: `qa-driver.md`)

- **Version drift is real:** the installed CLI auto-updated to **2.1.222**; the parity canon and the
  grounding corpus stay **2.1.220** (`cli.pretty.js` is not reliably runnable standalone — verified).
  Fleet compares live behavior against 2.1.222 and grounds against the 2.1.220 bundle; a finding whose
  behavior might postdate 220 gets `"version-drift?": true` and the controller adjudicates on the bundle.
- **The mouse axis is a terminal non-axis:** claude's terminal build requests NO mouse-reporting modes
  (conclusive via tmux's mouse-mode introspection, every state tested; injected SGR/X10 bytes are
  cleanly ignored by BOTH TUIs). The forked-Ink onClick/hover/wheel system in the bundle (L175130,
  L177466) evidently serves other hosts (IDE/desktop surfaces). QA-2's mouse block shrinks to a
  five-minute re-confirmation; the freed budget goes to the resize/repaint matrix below. OPEN QUESTION
  for the owner: where was click-to-expand observed (IDE terminal? desktop app?) — that surface may be
  a separate parity target, not the terminal build.
- **Resize/repaint is where the clone actually diverges** (the pathfinder's unplanned finding, now
  sprint finding **QA2-SEED-1**): at 80×24 after launching at 120×40, claude reflows cleanly; ccx leaves
  120-wide separator rules hard-wrapped into 80+40 fragments and paints the composer block twice; no
  self-heal on a timer, a keystroke collapses the duplicate but leaves a stale rule. Reproduced with no
  turn history. QA-2 runs a widths×heights×content-states matrix — cheap, deterministic, no tokens once
  content is staged.
- **Assert on frame TRANSITIONS, not single frames:** the prompt echo makes "reply text visible" pass
  before the model ever answers, and a "ready" needle valid in one permission mode is silently wrong in
  another. Every scenario is a state machine — each edge (ready → busy → reply → idle) has its own
  needle, and a missing busy edge is itself a failure.
- **Isolation is structural:** every agent uses the recipe's session-open preamble (fresh HOME, seeded
  onboarding, scratch project) and MUST end its report with the session-close assertion — the real
  `~/.claude/ccx/prefs.json` mtime, before vs after, unchanged.

## Ground rules (every agent, no exceptions)

- **Driver recipe:** follow `docs/parity/qa-driver.md` (the pathfinder's proven recipe) verbatim — tmux
  panes, `capture-pane -e` frames, wait-loops not sleeps, text and Enter as separate `send-keys`.
- **Isolation:** every TUI launch uses a fresh `HOME` (mktemp) + `CCX_FLEET_ROOT` under it + a scratch
  project dir. The real `~/.claude` and `~/.claude/ccx` are NEVER touched (stat-check before/after; a
  leaked `theme:"light"` into the owner's real prefs is the incident this rule exists for).
- **Secrets:** source `CC-to-SDK/.env` into the launch shell; never print, echo, or persist either token.
- **Quota discipline:** both TUIs bill the owner's Max subscription. Time-box ≈ 60 minutes of driving per
  agent; prefer cheap deterministic prompts ("Reply with exactly: X") for UI checks; spend real turns only
  where the surface under test needs them (streaming, tool folds, permission consults).
- **Two-sided evidence:** a finding without BOTH frames (ccx and claude, same scenario, same terminal
  size) is an observation, not a finding. Capture at 120×40 default; recheck at 80×24 when geometry is
  the point.
- **Canon:** the installed default build is the canon. If claude's behavior surprises you, it is still
  the spec — record it; never file "claude does X but ccx's way seems better" as a defect (file it as a
  `divergence-question` instead).

## Findings schema (one JSONL file per agent: `findings-<domain>.jsonl`)

```json
{"id": "<domain>-NN", "surface": "composer|transcript|dialog|picker|panel|session|chrome|mouse",
 "severity": "P1-broken|P2-wrong|P3-missing|P4-polish",
 "title": "one line",
 "repro": ["exact key/mouse sequence from a fresh launch"],
 "ccx": "what ccx did (frame excerpt or path to saved frame)",
 "claude": "what 2.1.220 did (same)",
 "suspects": "optional: file/line in harness/src if obvious",
 "kind": "defect|gap|divergence-question"}
```

Severity from the USER's chair: P1 = breaks the session or loses input; P2 = visibly wrong behavior;
P3 = upstream capability absent; P4 = cosmetic.

## The six domains

### QA-1 · Composer & editing
Checklist seeds: multi-line editing, word ops (alt/ctrl+arrows, alt+backspace — just fixed, verify live),
kill ring (ctrl+w/k/u/y, alt+y), undo (ctrl+_), history walk + both search UIs (ctrl+r inline, /history
picker), paste (small text, multi-line, image if possible → chips), `!` bash mode, `#` memory, `@`
mentions + file completion, `/` completion menu, queued prompts while busy (up-arrow edit), external
editor (ctrl+x ctrl+e), backslash-return continuation, IME/emoji/CJK width, ghost text + placeholder.
Exploration: draft real prompts the way a developer types — fast, with typos, corrections, pastes.

### QA-2 · Transcript rendering & mouse
Checklist seeds: streaming text + thinking indicator, tool-call folds and the `(ctrl+o to expand)`
markers, Edit/Write diff bodies (context-line contrast on dark AND light terminal themes), markdown
(tables, fences + syntax highlight, nested lists), long-output folds, agent/task batch rows, resize
reflow both directions, ctrl+o pager (during idle AND mid-stream — the frame-flood fix), ctrl+e collapse.
**Mouse (new axis, bundle L175130/L177466 — forked-Ink event system):** click-to-expand on folded rows,
wheel scroll, hover effects, click on links/badges — map everything clickable in claude; send the same
byte sequences to ccx and record what leaks (raw SGR mouse bytes appearing as composer text is itself a
P2). Exploration: run a real refactor task and watch the transcript the whole way.

### QA-3 · Permissions, dialogs, plan mode
Checklist seeds: consult dialogs for Bash/file/WebFetch/generic (rows, don't-ask-again suggestion rows,
settings.local.json write-through + relaunch silence), deny-with-feedback (Tab), mid-draft suppression
(`Waiting for permission…` after 1.5 s idle), AskUserQuestion (multi-question tabs, multi-select,
free-text Other), plan mode (shift+tab ladder, Ready-to-code modal, ctrl+u/d scroll, empty-submit deny,
keep-planning feedback), permission modes ladder incl. bypass warning dialog, /permissions dialog CRUD.
Exploration: a session with default permissions doing real file+shell work — every consult is a scenario.

### QA-4 · Pickers & panels
Checklist seeds: /model picker (arrows, `s` session-only, Enter default + persistence across relaunch),
/resume picker (search, preview pane, rename `r`, paging on long lists, cross-project scoping — known
gap, measure the blast radius), Esc-Esc rewind picker (anchors, dry-run summaries, confirm panel, the
new full-redraw behavior), ctrl+t todo panel, /bg + ctrl+b background panel, /help + `?` shortcuts
overlay (tabs, paging), /settings (all tabs, every row actuates?, paging keys — known-dead, verify),
/theme, /add-dir. Exploration: juggle several sessions/resumes the way a returning user does.

### QA-5 · Session lifecycle & commands
Checklist seeds: /clear (context ACTUALLY freed — ask the model what it remembers before/after; just
fixed), /compact (notice + completion + divider; just fixed), /resume + --resume + --continue, rewind
all three scopes, attach/detach (--detachable + ccx attach: replay fidelity, live handoff, answering a
parked consult from a second client), interrupt (Esc) mid-stream, ctrl+c double-tap exit, /quit, ctrl+z
suspend/fg, /export, /copy, /rename, /tag, /status /cost /usage /context /doctor equivalents, session-id
identity after /clear and rewind (the codex P2). Exploration: a morning-workflow soak — start, work,
step away, resume, rewind a mistake, continue.

### QA-6 · Chrome & everything else (feeds F7)
Checklist seeds: status bar contents vs upstream footer (model, mode chip, context %, bg count, usage
warnings), notifications/toasts (where does upstream surface async events — task done, plugin notice,
update available?), statusLine customization hooks, terminal title, bell/attention, spinner vocabulary
and timing, exit-arm hints, update flows, --version/--help output, error surfaces (network drop
mid-turn, engine crash), CLAUDE_*/env-var knobs that change chrome. Much of this is known-unbuilt in ccx
(F7 is the chrome wave) — for those, the deliverable is a precise behavioral catalog of upstream for F7
grounding, not a defect entry. Exploration: leave sessions idle/busy in background and watch what each
UI tells you unprompted.

## After the fleet

1. Controller dedups; every finding gets grounded in `cli.pretty.js` (2.1.220) with line citations before
   it becomes work — QA agents observe, the bundle adjudicates.
2. Ranked by user-visible impact; merged with the standing remainder (mouse/event axis, listSessions
   scoping, PermissionsDialog raw arrows, Settings paging, F7 chrome) into the next wave plan.
3. Yield review with the owner → go/no-go on the recurring sweep.
