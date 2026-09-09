# TUI to GUI: how every Claude Code terminal surface translates into the afleet window

Status: **study complete, 2026-09-10.** Canon is Claude Code 2.1.263 (the installed CLI and the
spec library at that version). Living document; the per-family card files under `surfaces/` are
the detail, this file is the map. Written in somersault; consumed by afleet.

| File | What it holds |
|---|---|
| `README.md` | this map: regions, principles, the audit, the ranked backlog, the roadmap proposal, the owner's questions |
| `SHARED-BRIEF.md` | the method and the card schema every lane followed |
| `surfaces/A-chrome-and-status.md` | 44 cards: frame, footer, spinner, status line, notification bars and OS notifications, title and tab status, context and rate-limit readouts, themes, accessibility |
| `surfaces/B-transcript-rendering.md` | 68 cards: row grammar, density and disclosure, clusters and thinking, every per-tool result form, diffs, interruption and rejection, markdown, scrolling, copy and export, compaction |
| `surfaces/C-composer-and-input.md` | 64 cards: the field, paste and attachments, `! @ # /` modes, autocomplete, history, queue and steering, the interrupt ladder, `Shift+Tab`, `keybindings.json` |
| `surfaces/D-decision-dialogs.md` | 62 cards: the dialog system as principles, the twelve permission routes, plan mode, questions, elicitation, forwarded dialogs, trust and consent gates, the terminal's own confirmations |
| `surfaces/E-panel-commands-settings.md` | 56 cards: `/config` and its sixty rows, `/permissions`, `/mcp`, `/hooks`, `/plugin`, pickers, `/sandbox` `/add-dir` `/cd`, skills and memory, themes and output styles, auth and client commands |
| `surfaces/F-panel-commands-session.md` | 45 cards: Status, Usage and Stats, `/context` and compaction, the Background dialog, `/help`, `/resume`, rewind, `/diff` `/export`, loops and goals, diagnostics and feedback |
| `surfaces/G-fleet-and-agents.md` | 61 cards: FleetView, subagents in the transcript, background shells and tasks, the task list, teams, the daemon and presence, Remote Control, fleet notifications |
| `surfaces/H-prior-art.md` | 14 pattern cards over 41 products, with a product-by-family matrix and sources |
| `surface-index.md` | one row per card: status, region, wire class, value, cost, exceeds, dependencies |
| `spec-defects.md` | everything the lanes found wrong in SPEC 263, `docs/tui-parity/` and afleet's own specs and code |
| `open-questions.md` | every card's open question, clustered: 215 in all — 153 owner decisions in 19 themes, 35 probes, 17 build-time unknowns, 13 cross-lane notes, with three cards carrying both a decision and a probe |
| `reviews/` | the two independent reviews of this map (Claude and a GPT gateway agent), 2026-09-10; their verified findings were applied, see §11 and the Revision Notes |

## 1. Purpose

afleet's charter is a UX equal to or better than the terminal's while hosting the unmodified
engine. `docs/tui-parity/` in afleet settled the first half of that claim at the protocol level:
for every terminal affordance, whether the headless wire can supply its data. This document
settles the second half at the UX level: for every terminal **surface** a user sees or operates,
what it becomes in the window.

Seven children of afleet's root spec have merged and the app runs. The root spec (§8) designs the
timeline, the decision cards, the composer and the Agents panel in depth. It leaves the rest of the
terminal to one-line router entries (§7.7: "`/mcp` → MCP popover from `mcp_status`") or to
silence: the sixty-row `/config` registry, the permission rule editor, the MCP browser, hooks,
plugins, skills, memory, `/status`, `/context`, `/tasks`, `/help`, the transcript view, the message
selector, vim mode, themes, the keybindings file, the status-line protocol, the spinner with its
tips and stall copy, the notification bar, the footer's hint vocabulary, and the differences between
the fullscreen and inline renderers. Those are the surfaces a daily user meets, and they are where
a GUI that "hosts the whole harness" is judged.

The stance, fixed by the owner on 2026-09-09: **faithful by default, exceed where the GUI can.**
Each surface keeps its information, states, ordering and copy unless a GUI reason says otherwise,
and every deviation is named with its reason. Slack is adopted as a skeleton only (sidebar,
channels, threads, Activity, badges); afleet's own workspace features surround it, and no terminal
surface is forced into Slack's widget vocabulary.

Written for whoever cuts and builds afleet's next children, and for the owner to judge the layout
calls.

## 2. Method and evidence

Three sources, in order of authority for what the terminal does; one for what afleet does.

1. **The 2.1.263 spec library** at `~/claude-code-bundle/2.1.263/SPEC/`, cited as *SPEC 41.18.5*.
   Its own review did not converge on every chapter, so load-bearing claims were re-read in
   `cli.pretty.js` at that version; cards say `(verified in cli.pretty.js:LINE)` where that
   happened. About eighty such greps were spent across the lanes.
2. **The somersault clone's scorecard** (`CC-to-SDK/docs/parity/tui-ux.md`, 667 rows) and its
   per-wave specs: a terminal clone built against the binary, whose rows record the canon quirks
   learnt at implementation contact. Only its verified quirks are carried; its own layout choices
   are not canon, and two of its rows turned out to be stale against 2.1.263 (the `⚙ N bg` chip and
   the task panel's `activeForm` line).
3. **afleet's protocol inventory** (`docs/tui-parity/`) for the wire class of every affordance;
   this document never re-derives P/R/D/X/T. Where an area file and the README disagreed, the
   README's finding was taken and the disagreement filed in `spec-defects.md`.
4. **afleet's specs and source** for what is built, designed, routed-only or undesigned: the root
   spec, the C5, C6 and C7 family specs, and `App/`, `FleetKit/`, `Workbench/` on `main` at
   2026-09-10. Every status claim in a card names the file it was read from.

Seven lanes produced 400 surface cards, one file per family; an eighth produced the prior-art
survey. Each card follows one schema: *Terminal* (what it draws, cited), *Job*, *Wire*, *afleet
today*, *GUI form* (with a wireframe where layout matters), *Drops / keeps / gains*, *Open*. The
orchestrator spot-checked two or three load-bearing claims per lane against afleet's source or the
binary before accepting the lane; all held, and four lane findings were corrected from outside —
two during the study and two at review (see §11).

### 2.1 Status legend used in every card

| Status | Meaning |
|---|---|
| `built` | code on `main`; the card names the file and the child spec section, and says what the built form keeps and loses against the terminal |
| `designed` | a spec specifies it; no code |
| `routed-only` | §7.7 names a native destination; nothing specifies its form |
| `undesigned` | no spec mentions it |
| `superseded` | a terminal-specific mechanism the GUI replaces wholesale; the card says by what |
| `out-of-scope` | excluded by root §3 or §17.8 |

## 3. The window, and where the terminal's regions land

The terminal composes one screen from a scrollable message list, three dialog slots, and a bottom
column holding the pinned notice bar, the input, the footer and the transient notification bar
(A-01). The rule that governs every card in this study: **translate the fullscreen renderer
branch, never the classic-inline one.** afleet's window is permanently the equivalent of the
fullscreen branch (a real scroll view, persistent regions, an overlay layer), so the fullscreen-only
behaviours (a reserved status-line row, a sticky prompt, the jump-to-bottom pill, the queued-message
list) are what a GUI gets for free, and the inline degradations exist only to share a terminal with
a shell.

```
┌──────────┬──────────────────────────────────────────────────┬────────────────┐
│ sidebar  │ channel header · readbacks · meter · menus       │  panel tabs    │
│          ├──────────────────────────────────────────────────┤                │
│ Activity │ channel banner (pinned notices, priority queue)  │  Thread        │
│ projects ├──────────────────────────────────────────────────┤  Agents        │
│ channels │                                                  │  Files         │
│  (bands) │                timeline                          │  Source Ctl    │
│          │        decision cards inline · dock above field  │  Terminal      │
│          │                                    ┌───────────┐ │  Browser       │
│          │                                    │ 3 new ↓   │ │  GitHub        │
│          ├──────────────────────────────────────────────────┤  Raw           │
│          │ activity strip: verb · elapsed · tokens · tool   │  Background    │
│          │ sub-line: tip / Next: / narration                │                │
│          ├──────────────────────────────────────────────────┤                │
│          │ strip slot: running > queue > refusal > note > hint               │
│          │ composer  [mode] [model] [effort]  attachments   │                │
│          │ statusLine output row (opt-in)                   │                │
└──────────┴──────────────────────────────────────────────────┴────────────────┘
      toasts over the channel · sheets modal to the channel · Settings window · menu bar
```

### 3.1 Region map

| Terminal region | Window region | Governing cards |
|---|---|---|
| Message list (scroll, anchoring, static commitment) | Timeline | A-06, A-07, B-56 |
| Footer: mode indicator | Channel header pill (built) | A-11 |
| Footer: hint vocabulary | Composer shortcut bar and the menu bar; never a footer row | A-08, A-09, C-22, C-60 |
| Footer: focusable chips (`tasks`, `workflows`, `frame`) | Panel tabs with badges | A-12 |
| Footer: right-column indicator chips | Channel header glyph cluster, fixed order, overflow rule | A-13, G-22, G-55 |
| Footer: row-replacing states (exit-armed, pasting, bash) | Inline status text under the field | A-10, C-17, C-18 |
| Spinner block (verb, elapsed, tokens, tool label; tip, `Next:`, narration) | Activity strip pinned above the composer | A-17 to A-24 |
| `statusLine` script output | Per-channel header sub-row, ANSI-parsed | A-16, A-25 |
| Pinned notification bar (`⚠`, never expires) | Channel banner, priority-queued | A-27, A-37, A-38, D-42 to D-46, E-20, E-48 |
| Transient notification bar (8 s timer) | Toast stack over the channel, same queue semantics | A-28 |
| Terminal notifications, OSC 9;4, tab status | macOS notifications through the `Notification` hook; Dock badge; sidebar status colour | A-30 to A-35, G-33, G-61 |
| Dialog slot `inline` | Decision card in the timeline | D-09 |
| Dialog slot `bottom` | Dock above the composer | D-09 |
| Dialog slot `modal` | Sheet modal to the channel, never to the app | D-09 |
| Autocomplete menu | One caret-anchored completion popover, five providers | C-23 to C-31, C-34 |
| Queued-message list above the input | Queue strip in the composer's strip slot | C-36 to C-40 |
| `ctrl+o` transcript screen | Raw panel tab | B-07 |
| `ctrl+t` task panel, `/tasks` dialog | Background panel tab | F-09, F-10, G-35, G-36 |
| `/config`, `/permissions`, `/hooks`, `/plugin`, `/skills` | Settings window, new `Claude Code` section | E-01 to E-03, E-08, E-19, E-21, E-37 |
| `/mcp` | Popover from the header, detail in a sheet, OAuth through the Browser tab | E-14 to E-17 |
| `/status`, `/context`, `/cost`, `/goal` | Header readback opening a popover, poppable into a panel | F-01, F-02, F-04, F-35 |
| `/help` | Command picker plus a shortcuts window from the Help menu | F-13, A-15 |
| `/resume` picker | Sidebar plus the quick switcher; preview through the real renderer | F-18 to F-22 |
| Rewind selector | Hover action on a user row opening a channel sheet | F-27 to F-31 |
| FleetView and the agents view | Sidebar grouped by the four bands; Agents panel | G-01 to G-09, G-21 |
| Keyboard chords | Menu bar items with visible shortcuts; `keybindings.json` read and projected | C-54 to C-61 |

### 3.2 Three regions are overloaded, and one rule each keeps them working

- **The channel header.** Built: title, branch, model, mode, effort, context meter. Proposed by
  four lanes: connection glyphs, the status line, a background chip, a bridge chip, a coordinator
  readback, a task count, output style, fast, sandbox state, a status colour. The rule (A, E, G):
  one row of identity, one row of user-owned text, glyphs only for state that has no words, and
  the header holds **live per-channel values**; persisted preferences go to Settings and launch
  settings to a per-channel Overrides sheet. The split is decided by the value's lifetime, not its
  subject.
- **The strip above the composer.** Six surfaces compete for it: the hint row, the queue, the
  running-shell strip, the refusal sentence, the edit note, the rewind confirmation. The rule (C):
  one ordered strip slot with a documented precedence, running > queue > refusal > note > hint.
- **The Settings window.** Lane E adds a `Claude Code` section; lane F adds Account and Usage,
  Auto-compact and Import. The rule (E, F): settle the pane list once across both lanes: Defaults,
  Permissions, Extensions, Account and Usage, with the write class shown on every row.

## 4. Principles

### 4.1 Kept from the terminal

- **Decisions are inline.** The terminal mounts permission and question dialogs inline; only a
  handful of its forty-one dialog kinds are modal. afleet's cards already follow this. Where a
  sheet is unavoidable it is modal to the channel: an app-modal plan approval in a window holding
  twenty sessions freezes nineteen unrelated conversations (D-09).
- **Never steal the composer mid-draft, and never move it.** A dialog arriving while the user types
  is parked with a visible placeholder and accepts no keystroke already in flight (the 150 ms
  grace). Every footer state replaces a hint, never the input. Every new surface that writes into
  the field (history recall, queue edit, ghost accept, fork prefill) checks the draft first
  (A-10, C-48, D-04, D-05, F-14).
- **Every displayed setting is a readback, never the last click.** A picker shows what
  `get_settings` reports after the request; a disagreement is shown, not hidden. Read the engine's
  settings with their `sources`; do not fork them (C-06, C-62, E-28).
- **State is never encoded in colour alone.** The mode pill has a word, tab status has a label
  beside its colour, diffs have `+`/`−`. The daltonized tables exist because the palette does real
  work (A-35, A-42).
- **Never render optimistic state for work you cannot see.** Canon built a second `/tasks` dialog
  for Remote Control rather than let a client lie about a remote task list, and its stop is
  two-phase. afleet is that client for every channel it hosts (G-34, G-48).
- **A refusal names its remedy.** Canon pairs every cause with a remediation sentence; adopt it as
  the house rule for every disabled control (G-51, G-54, F-14).
- **Recovery, not prevention.** Canon's habit is to let an action happen and make it undoable rather
  than to ask first. Where afleet adds a confirmation the terminal does not have, the confirmation
  carries the recovery sentence too, or the window is strictly more frightening than the terminal
  and no safer (D-58, D-61).
- **Two divergences from canon are protected, not corrected.** afleet escapes raw HTML where the
  terminal passes `token.text` through unescaped, and sanitises untrusted text host-side where the
  terminal sanitises at paint time. Both are safer than canon, both are recorded in afleet's source,
  and a later faithfulness pass must not undo either (B-48, B-57).
- **Every decision card offers every settlement its request declares, and closing the card is one
  of them.** A window dismissal is never an answer (D-23, D-34, D-38, D-44).
- **Faithful copy.** Roughly a hundred verbatim strings across the lanes (permission questions,
  refusal text, tip text, status words, band labels, `Claude is waiting for your input`) are the
  product's voice. Keep the sentence; replace only the gesture it names (`ctrl+o to expand` becomes
  the row's own control) and never keep a reference to a surface afleet does not have (A-31, B-64).
- **The fold's reading order.** Prose first, tool activity folded under it, expandable in place.

### 4.2 Changed by the medium

- **Keyboard chords become menu items with shortcuts.** A native app owns a menu bar, so every
  `chat:*` and `app:*` action gets a menu home and a discoverable shortcut, and the footer's hint
  row is not reproduced (C-60). `keybindings.json` is honoured as a context-to-focus-region map
  plus a menu-bar projection, not a chord table (C-59).
- **Panels replace re-executed dialogs.** A terminal panel command is a transient screen; the GUI
  gives the same content a persistent place and the slash command becomes a shortcut to it.
- **Live where the terminal was static.** A running tool's output, the context meter, the task
  list and the live tail stay live without a keystroke, and the tail survives the shell's exit
  (G-25).
- **The transcript is scannable and clickable; completeness belongs to the panels.** Six
  transcript cards independently end with "and open it in a panel". The terminal puts everything in
  the row because it has nowhere else (B, for the map 3).
- **A ladder becomes a button plus Undo.** Every "press again within 800 ms" exists because a
  terminal has one key, no buttons and no undo. The GUI form is a named control, a confirmation
  sheet when destructive, `⌘Z` when not (C-42 to C-45).
- **Canon's "read it, then act on it" gap closes.** `/context` names the memory file that costs
  6,000 tokens and tells you to run `/memory`; `/doctor` finds a duplicate and asks the model to
  fix it. In the window the finding is the control (F, for the map 6; D-20's config hints).
- **Provenance is shown.** The terminal shows one merged value; `get_settings.sources[]` carries
  the stack, so rule shadowing, ineffective plugin writes and settings precedence are all one
  merge-and-explain utility (E-09).
- **Model-facing text is not user-facing text.** `<task-notification>`, the background notice, the
  cross-session trailer and the channel envelope are written for the model; only the summary reaches
  a row (G, for the map 6).

### 4.3 Multiplied by the fleet

The terminal is one session. Three consequences recur across lanes and belong at the map level:

- **Every confirmation that guarded one process is re-scoped before it is ported** (channel-modal
  sheets; per-channel version announcements would repeat N times a day, A-02).
- **A rate limit, a compaction, a failing hook and a held message are channel events a fleet
  operator needs to see from outside the channel.** They land in Activity and on the sidebar
  badge as well as in the channel (B-47, B-67, G-51).
- **Owned and adopted channels are two capability classes.** afleet launches its own engines with
  the file-checkpointing flag, so rewind works on them; a session adopted from a terminal keeps no
  checkpoints. One host-side capability flag, derived at attach time, should be defined once rather
  than per surface (F-27 to F-29).

### 4.4 The reusable systems the lanes found

Each lane found that a handful of shared components carry most of its cards. These are the seams a
roadmap should cut around, because building any of them once retires ten to twenty cards:

| System | What it is | Cards it carries |
|---|---|---|
| Channel banner as a priority queue | ordering, `invalidates`, `fold` as a merge function, head-requeue preemption, never-expire for pinned entries, room for actions, a matching Activity row | A-27, A-37, A-38, D-42 to D-46, E-20, E-48, B-67 |
| Band function over thresholds | one function from a number to a band with copy per band; drives the context indicator, the context-limit banner, the rate-limit family | A-36 to A-39 |
| Structured result slot | a `structured` body beside `raw` on the tool result row, with two states | B-14, then B-16 to B-41 |
| Persisted per-row disclosure | expansion state per row, scoped to the channel, surviving channel switches | B-06, B-10, B-12 |
| Completion popover | caret-anchored list with selection, bolded match spans, hover-overrides-keyboard, `Escape`; five providers | C-19 to C-31, C-34 |
| Composer strip slot | one ordered slot above the field with a fixed precedence | C-18, C-22, C-37, C-41 |
| Decision option list | numbering with digit shortcuts, three row states, a consequence line per row, escape to cancel; four families share it | D-07, D-10 to D-41 |
| Dialog destination rule and route table | per kind: inline card, dock, channel sheet, banner or notification; per permission kind: title, body, question | D-09, D-10 |
| Consent gate strip | a refusal or degradation line, a consequence line, one action opening a sheet or a Terminal pane; two registers | D-42 to D-48 |
| Settings row with write class and provenance | effective value, winning source, which of five write classes reaches it, what to do when none does | E-01 to E-03, E-08 to E-11, E-19, E-23, E-37 |
| Surface registry | a table the composer and router can open a native surface by name from, with a fallback that reports | E-30, E-42, F-09, F-18, G-21 |
| Header readback popover | a small persistent readback that opens into the full surface on click, poppable into a panel | F-01, F-02, F-04, F-05, F-35 |
| Refusal copy table | one honest line per slash command saying what afleet does instead | F-14, E-27, E-45, E-53 |
| Sidebar channel row | naming chain, six status words, band grouping, row actions, foreign rows, presence, activity states with detail override | G-02 to G-04, G-09, G-47, G-61 |
| Task and agent card | one unit of work with status, activity line, cost, output file and actions, in three densities | G-10, G-11, G-21, G-25, G-27, G-29, G-31, G-34 |
| Comment mechanism | inline comments on a diff, a plan or a file that bundle into the next user message with the location injected | H card 4, D-30, B-40 |

## 5. Surface index

`surface-index.md` carries one row per card with status, GUI region, wire class, value, cost,
an `Exceeds?` flag, and dependencies; `scripts/build_surface_index.py` regenerates it from the
card files. The flag is set whenever a card's gains list names anything at all, so it is true for
315 of 400 cards and is a pointer to read the card, not a measure. Counts at 2026-09-10:

| Lane | Cards | built | designed | routed-only | undesigned | superseded | out-of-scope |
|---|---|---|---|---|---|---|---|
| A chrome and status | 44 | 15 | 5 | 0 | 19 | 5 | 0 |
| B transcript | 68 | 42 | 1 | 2 | 20 | 3 | 0 |
| C composer | 64 | 32 | 3 | 0 | 14 | 10 | 5 |
| D decisions | 62 | 31 | 1 | 1 | 23 | 2 | 4 |
| E settings panels | 56 | 12 | 7 | 1 | 30 | 2 | 4 |
| F session panels | 45 | 10 | 0 | 5 | 28 | 1 | 1 |
| G fleet and agents | 61 | 19 | 16 | 0 | 23 | 3 | 0 |
| **All** | **400** | 161 | 33 | 9 | 157 | 26 | 14 |

Two readings of the status column matter for the roadmap. First, `built` (161) is the status of
the card's surface, not of its fidelity: §6 lists the built surfaces whose form drops something, and
eleven of the rows in §6.1 are `built`; the rest are routed or undesigned surfaces whose current
behaviour is itself the defect. Second, `undesigned` (157) plus `routed-only` (9) plus `designed`
(33) is the unbuilt half of the terminal — 199 cards — and this is where they land: Settings 36,
timeline 28, composer 21, decision card 16, sidebar 15, channel banner 13, channel header 9, Files
panel 8, Activity 7, Agents panel 6, 21 across nine smaller regions, and 19 with no GUI surface at
all. That distribution is why the roadmap cut in §8 groups by region rather than by lane, and it is
why the settings child is the largest of them.

By region across all lanes, all statuses: timeline 75, composer 62, Settings 42, decision card 41,
sidebar 29, channel banner 19, channel header 15, Agents panel 11, notifications 10, Files panel 9,
menu bar 8, popover 8, Activity 7, consent sheet 4, Browser panel 3, Thread panel 3, Source Control
panel 2, toast 2, Terminal panel 1, quick switcher 1; 48 cards have no GUI surface at all
(superseded mechanisms, negative findings, cross-cutting rules such as reduced motion).

## 6. Where the built app loses something the terminal has

The audit result. The first group changes behaviour today and should be fixed before any new
surface is cut; the second is fidelity the built forms drop.

### 6.1 Live defects in shipped code

| Card | What happens today | What canon does | Child |
|---|---|---|---|
| D-45 | `ManagedSettingsReader.isPending` hashes the raw file and looks for `approvedHash`; a managed deployment never spawns | hashes four extracted fields under `records[<orgUuid>].dangerousSettingsHash`, with a predicate that skips harmless payloads | C8 |
| D-24 | the denial sent to the model is one sentence | three sentences; the dropped two say the edit was not written and tell the model to stop | C8 |
| D-57 | every card claims the engine default (five minutes) unless `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` is set; the session's `dialogExpiry` setting is never read | reads the session's `dialogExpiry` | C8 |
| B-61 | a slash command or skill invocation renders as literal XML in a user bubble | the six wrapper tags are parsed into a command echo | C8 |
| B-44 | an interrupted tool renders as a red error, keyed on `is_error` | an interruption row that says nothing refused it | C8 |
| B-46 | a row waiting on a permission card says `Running…` | `Waiting for permission…` replaces the body | C8 |
| A-31 | notifications are titled `afleet — <type>` with `The turn ended with success.` | `Claude is waiting for your input`, `<label> finished`; tui-parity says reuse verbatim | C8 |
| E-42, F-09, F-18 | `/agents`, `/tasks`, `/resume` route to native surfaces the picker model rejects; typing them does nothing | a static notice that the wizard was removed (the definitions view is E-42's own proposal), the Background dialog, the resume picker | C8 |
| E-08 | `/permissions` prints the applied model and effort under a permissions heading | the six-tab rule editor | C8 |
| E-39 | `/memory` renders a file count | the memory file list | C8 |
| E-48, A-27 | `overlay.banners` computes rate-limit and auth banners that nothing reads; `ChannelBanner` has neither case | a pinned banner with the reset time and a Sign in action (afleet's own root §7.6) | C8 |
| F-37 | `/doctor` is refused with terminal-only copy | it runs as a prompt; afleet's own evidence records it | C8 |
| E-26 | the `/reload-plugins` refusal says changes are picked up at restart | afleet ships a live reload button | C8 |
| D-23, D-34, D-38 | the permission card cannot stop a turn; the question card has no decline; the URL elicitation hides Accept | each request's third settlement | C8 |
| C-18 | `!` shell mode draws nothing for up to 120 s while the command runs; `isSending` has no reader | a running strip with elapsed time | C8 |
| G-37 | `TaskRunRow.activeForm(of:)` reuses canon's name for a different thing | `activeForm` is a field of the persisted task list read only by the spinner | C8, before C14 builds on the panel |

Four rows that stood here in the first draft have moved. `/fast` (E-30) is not broken: the router
never reaches the picker branch for it, so the command works and only its visible state is missing.
`/stop` (F-12) is a deliberate divergence, not a defect, and is now an owner question (§10 item 8).
D-17's grant-row suppression depends on a probe nobody has run and sits with the probes in §10's
preamble. B-57's sanitiser matches canon after all; the one honest line left from it is in §6.2.

### 6.2 Fidelity the built forms drop

| Card | Built form | What it loses | Child |
|---|---|---|---|
| B-14, B-16 to B-39 | ten tool result forms; the rest render `Done · N lines` | about thirty forms, all class R with the data on the wire except live Bash output (B-23, class D, which gets the file-tail workaround) | C9 |
| B-18, B-40 | `Added N lines, removed M lines` | the diff; afleet owns a diff renderer whose only caller is the permission card | C9 |
| B-06, B-12 | the fold with no count and no persistence; clusters with counts only | the `(N to expand)` count, categorised tense-switching sentences, per-row memory across channel switches | C9 |
| B-17, B-53 | `Read image` | the size and the kind canon puts in its own placeholder (`Read image (240KB)`); the terminal never draws pixels either, so the picture itself is the `[exceeds]`, not a loss | C9 |
| B-56 | scroll anchoring with the anchor correction | the two-frame range freeze after a width change, so a row that changes height after it is drawn moves the reading position | C9 |
| B-57 | a sanitiser that matches canon's whole strip set in a single pass | nothing canon strips; whether the strings handed to `UNUserNotification` carry canon's stricter clamp is unverified | C9 |
| B-58 | four individually selectable subviews; `copyOnSelect` deliberately dropped as against macOS convention | cross-row selection, a copy action, a context menu, `/copy`, a chrome-excluded selection plane | C9 |
| C-37 to C-40 | a queue chip with a count, a label and Cancel | every queued prompt as a row, pull-back to editable text, one-turn batch drain | C10 |
| C-17 | `!` read off the submitted text | a tinted border, a changed prompt glyph, a collapsed hint row | C10 |
| C-24, C-27 | two mouse-only completion lists | selection, arrow keys, Tab-fills-never-executes, the two-Tab `@` rule | C10 |
| C-22, C-32 | no placeholder, no hint row, no prompt history | four hint strings, Up/Down recall, `ctrl+r` | C10 |
| D-10, D-11 | three permission routes of twelve; no warning line | route-specific titles and questions; sixteen `Note: may …` destructive warnings | C11 |
| D-21 | a three-scope destination picker (exceeds canon) | the file name rather than the scope word, the 8/64/160 display limits | C11 |
| D-27, D-33, D-37, D-40 | the right shape | the refusal notice and support link, fifteen elicitation validation strings, the plan review warning, the withheld-content sentences | C8 |
| E-14 | a name and a raw status string per MCP server | scope, tools, config, error; reconnect, enable, authenticate, clear auth (seven control requests with no caller) | C12 |
| E-28, E-29 | model and effort pickers | per-model descriptions, the `Select model` header, the overflow counter, a default-for-new-sessions control, the `max` caveat | C12 |
| E-30 | `/fast` toggles `fastMode` and reads it back | any visible state: nothing in the window says whether fast mode is on, and the ten disabled reasons have nowhere to render | C12 |
| F-27 to F-29 | an Edit button that only rewinds the conversation | six restore choices with a per-message dry-run diffstat; the flag that enables it is already set | C13 |
| F-23 | `/rename` | generate, collision handling, the teammate refusal | C13 |
| G-02 | title, time, preview, four badges | the naming fallback chain and the six status words; a failed and a finished session look identical | C14 |
| G-10, G-27 | a thin Agent row; a task-notification row | three states with a live progress line; outcome colour, duration, coalescing, hide-when-no-summary | C14 |
| G-47 | a registry record | `status`, `waitingFor` and `tempo`, so other tools see afleet channels as unknown activity (by decision, root §13) | C14 |
| A-34 | three rungs (custom, then AI title, then first prompt) | canon's five: custom > AI title > agent title > haiku title > default | C14 |
| A-36 | a context meter that exceeds canon | the band arithmetic and the warn/blocked copy | C14 |

## 7. Ranked backlog

Ranking is by user value against build cost from the lanes' ranking rows, then adjusted for
dependencies: a seam that unblocks many cards ranks above any card it unblocks. Cost is S (a day
or less), M (a week or less), L (larger). The full per-card table is `surface-index.md`.

### Tier 0. Fix before cutting anything: live defects, S or S/M

D-45 managed-settings hash (S/M) · D-24 the three-sentence denial (S/M) · D-57 `dialogExpiry` ·
B-61 command echo wrappers · B-44 interruption state · B-46 waiting-for-permission · A-31
notification copy · F-37 `/doctor` · E-26 reload copy · D-23 / D-34 / D-38 third answers (D-38
S/M) · C-18 shell-running strip. Every other item is S.

`/stop` (F-12) left this tier: root §7.7 defines it as `interrupt` deliberately, so it is an owner
question (§10 item 8), not a bug. D-17 left it for a probe (§10's preamble), B-57 because the
sanitiser already matches canon, `/fast` (E-30) because it works. G-37's rename is still C8's, but
it is a naming cleanup rather than a live defect, so it rides with C14's prerequisites. A-34's
title precedence is fidelity, not a defect, and moves to Tier 2.

### Tier 1. Seams: each is the prerequisite for ten or more cards

| Rank | Seam | Cost | Unblocks |
|---|---|---|---|
| 1 | Surface registry the router can open by name, with a reporting fallback | S | E-42, F-09, F-18, F-20, G-21 |
| 2 | Structured result slot on the tool result row | M | B-16 to B-41 (about thirty forms, diffs, images) |
| 3 | Channel banner as a priority queue, reconciled with `overlay.banners` | M | A-27, A-37, A-38, E-20, E-48, D-42 to D-46, B-67 |
| 4 | Completion popover with selection and accept semantics | M | C-19 to C-31, C-34 |
| 5 | Decision option list and the dialog destination rule | M | D-07, D-09, D-10 and every card in D's families B to F |
| 6 | Settings `Claude Code` section with the write-class row | M | E-01 to E-11, E-19, E-23, E-37, F-02, F-07 |
| 7 | Header readback popover pattern | S | F-01, F-02, F-04, F-05, F-35, G-22 |
| 8 | Sidebar channel row: naming chain, status words, bands | M | G-02, G-03, G-07, G-47, G-61 |
| 9 | Persisted per-row disclosure scoped to the channel | S | B-06, B-10, B-12 |
| 10 | Composer strip slot with precedence | S | C-18, C-22, C-37, C-41 |
| 11 | Refusal copy table, one line per command | S | F-14 and about forty commands across E and F |
| 12 | Task and agent card in three densities | M | G-10, G-11, G-25, G-27, G-29, G-31, G-34 |

### Tier 2. High value, ordered

Where an item's owner is not obvious from its region, the child from §8 is named.

1. **A failed and a finished session look the same** (G-02): the naming fallback chain and the six
   status words on the sidebar row. The first question a fleet operator asks of the window, and the
   cheapest high-value answer in the study. S. Owner C14.
2. **Title precedence** (A-34): three rungs today — custom, then AI title, then first prompt — where
   canon has five. Fidelity rather than a defect, ranked this high because it is cheap. S/M.
   Owner C14.
3. **Edit diff in the result row** (B-18, B-40, B-41): route `structuredPatch` into the renderer
   afleet already has; add line numbers, hunk headers and bands. S then M.
4. **The queue** (C-37 to C-40): rows, pull-back, batch-drain disclosure. M.
5. **Usage and limits** (F-02, A-38, A-39, E-48): `get_usage` chip above a threshold, the five bar
   titles verbatim, the rate-limit banner, `/rate-limit-options`. M; auto-continue L. Lane F calls
   this its highest user value per unit cost, and it is placed here rather than by its index row
   for that reason.
6. **The activity strip** (A-17 to A-24): verb, elapsed, live tokens, escalating tool label; the
   sub-line for tips, `Next:` and narration. L, and the biggest loss in chrome.
7. **The twelve permission routes and the destructive warning** (D-10, D-11, D-14, D-16): a route
   table over bodies that mostly exist; sixteen regexes and three titles. S plus M.
8. **MCP browser** (E-14 to E-17): decode the full status, wire the seven dead control requests,
   run OAuth through the Browser tab. M.
9. **Rewind** (F-27 to F-31): join the restore chooser and the target picker; dry-run diffstat per
   message; owned-versus-adopted rendering. M.
10. **Background panel** (F-09, F-10, G-35, G-36): the registry mirror with per-task stop, detail
    sub-views, the persisted task list. M.
11. **Tool result forms, the long tail** (B-16 to B-39): one card per tool once the slot exists;
    `ReportFindings`, `Grep` match lists, images and PDFs, notebooks. Every one is class R with the
    data already on the wire except live Bash output (B-23, class D), which gets the file-tail
    workaround instead. S each, M in total.
12. **Sidebar bands and nudges** (G-03, G-07): the four bands as a grouping mode with canon's labels;
    band-transition notifications. M.
13. **Held cross-session messages** (G-51): a message held for a channel that cannot take it, with
    the refusal naming its remedy and an Activity row outside the channel. M. Owner C14.
14. **`/help` and the shortcuts window** (F-13, A-15): the three tabs, the 44-row suppression, the
    menu-bar pass that makes shortcuts discoverable. M.
15. **Permissions editor** (E-08 to E-11): six tabs, provenance and shadowing, add-rule with a real
    answer for user scope. L.
16. **`/memory`'s file list** (E-39): the memory files with their sources, where afleet renders a
    count. M. Owner C12.
17. **The `/agents` definitions view** (E-42): canon removed its wizard and prints a static notice,
    so this is afleet's own surface rather than a port, and it waits on the owner wanting one. M.
    Owner C12.
18. **Live tail and stall watchdog** (G-25, G-30, B-23): five rows newest-first with the footer
    formats, kept after exit, searchable; a watcher over the tail. M.
19. **`/context` grid and Suggestions** (F-04, F-05): the only attributable context budget; data
    is on the wire. M.
20. **Prompt history** (C-32 to C-34): Up/Down and `ctrl+r` over `history.jsonl`, read side. M;
    the write side is an owner question.
21. **Composer discovery** (C-22, C-11, C-29): the hint row, the paste chip, argument hints. S, M, M.
22. **Consent gates that refuse or degrade** (D-43, D-46, D-48, D-55): the bypass disclaimer,
    external includes, the API-key trust, the auto-mode environment view. S to M each.
23. **Subagent rendering** (G-10 to G-20, C6.4): the Agent row's three states, member rows,
    completion and hand-back, the labelled permission ask; the Agents panel audit's six gaps. L.
24. **Themes, daltonized variants, reduced motion, announcement rate and the second Dock signal**
    (A-40, A-42, A-19, A-43, A-33): the 72-token key set as an asset catalogue; one preference; one
    predicate; one contract; and the busy-versus-idle Dock signal A-33 proposes beside the badge
    count it already inherits. M.
25. **Copy and export** (B-58, B-59, F-33): cross-row selection with a chrome exclusion, a copy
    action and a context menu over the four subviews that are already selectable, three menu items,
    four export formats. S, M.
26. **Raw panel tab** (B-07): the missing third density layer, with search. M.
27. **Pickers restored, and the fast toggle** (E-28, E-29, E-41, E-30): descriptions and headers; an
    output-style control on a request that already works; a header toggle showing `fastMode`, which
    is wired but invisible. S. Owner C12.
28. **Keybindings honoured** (C-54 to C-61): read, validate, project onto the menu bar; the editor
    is an owner question. M.
29. **Peek-before-attach** (H card 9, G-06): the middle rung between an Activity row and opening the
    channel. M.
30. **The comment mechanism** (H card 4, D-30, B-40): inline comments on diffs, plans and files that
    bundle into the next message. L.
31. **`statusLine`** (A-16, A-25): run it, render it on a header sub-row, disclose the fields the
    host cannot supply. L.
32. **Mermaid** (B-52): vendor and render in a web view; awaits the architect ruling. M.
33. **`/resume` preview and filters** (F-18 to F-22): filters and the description line are cheap;
    lineage grouping and a real-renderer preview are not. M.
34. **Workflow phases and the ultracode veto** (G-44, G-45): a phase card; a matcher in the
    composer. M.
35. **Presence publication** (G-47, G-58, G-59): inbound reading is S; outbound publication is an
    owner decision; "while you were away" is the best thing a fleet product can say. S to L.

### Tier 3. Closed by a card, no build

Superseded mechanisms with one inheritance each: `/tui`, the boot canary, `/scroll-speed`, the
screen-reader line renderer, colour-capability detection (A-03 to A-05, A-14, A-29), the editor
buffer and kill ring (C-02 to C-04), the Apple Terminal probe (C-09), oversized-draft truncation
(C-12), Ctrl-Z (C-44), `clearScreen` (C-46), the peek pane's terminal form (G-06), the agents chip
(G-08), FleetView's own screen (G-01), `MultiEdit` (B-20), `ctrl+e` (B-08), `/version` (F-43).
OSC 9;4 is not in this list: the Dock badge inherits its progress meaning, but A-33 also proposes a
second, busy-versus-idle Dock signal, which is Tier 2 item 24.

Four canon surfaces are dead code whose design is worth taking whole: tab status behind a false
predicate (A-35, G-61), `/loops` behind `isEnabled: () => !1` (F-34), FleetView's `remote` tab with
its launch composer (G-05), and the coordinator panel (G-43).

### Tier 4. Gated on an owner decision

See §10. The largest: writes under the config home (keybindings editor, history write, user-scope
permission rules, cloud-plugins consent), outbound presence publication, the narration sub-line's
model-call cost, the hidden settings channel for text-command writes, and the root §3 exclusions
that the cards keep bumping into (Remote Control consent, worktree exit, Slack `#` channels).

## 8. Proposed roadmap cut

A candidate grouping of the backlog into children for the root spec's §17, for the owner and the
decomposing step. Not a decision. Each child names its purpose, an observable acceptance, the
seams it owns, and its edges. The order is a dependency order, not a priority order; C8 is small,
comes first, and is the only thing everything else waits on.

There is no seams child. Each shared system in §4.4 is owned by the child that first needs it and
delivered as that child's first leaf; every other child takes it as a dependency edge and builds
against it. A seams child that owns nine systems at once is neither small nor demonstrable, and it
makes six children wait on all nine when each of them needs one or two.

| Shared system | Owner | The consumer that forces it first |
|---|---|---|
| Refusal copy table | C8 | every slash command afleet does not host |
| Structured result slot | C9 | the edit diff in the tool result row |
| Persisted per-row disclosure | C9 | the fold's count, remembered across a channel switch |
| Completion popover | C10 | `/` and `@` completion with a keyboard accept |
| Composer strip slot | C10 | the running-shell strip for `!` mode |
| Decision option list | C11 | the twelve permission routes |
| Dialog destination rule and route table | C11 | a `Create file` ask with its own title and question |
| Consent gate strip | C11 | the five unforwarded gates |
| Settings row with write class and provenance | C12 | the sixty `/config` rows |
| Surface registry | C13 | `/tasks` opening the Background panel |
| Header readback popover | C13 | `/context` and `/status` |
| Owned-versus-adopted capability flag | C13 | rewind's six restore choices |
| Channel banner as a priority queue | C14 | the rate-limit and auth banners `overlay.banners` already computes |
| Toast stack | C14 | the transient notices the banner queue hands off, one at a time |
| Band function over thresholds | C14 | the context indicator and the rate-limit family |
| Sidebar channel row | C14 | the six status words and the naming chain |
| Task and agent card | C14 | the Agents panel |
| Comment mechanism | undecided | §10 item 13; it spans C9, C11 and the Files tab |

The banner and the toast stack are one design in two registers and belong to one child: the banner
is persistent and stacks, one strip per active condition (A-27); the toast is transient, one at a
time, with the queue semantics (A-28).

**C8. Correctness and copy.** Every live defect in §6.1, plus the refusal copy table, the
verbatim-copy pass across the decision family (D-27, D-33, D-37, D-40) and notification copy (A-31).
It owns four things outright that no later child repeats: the third answers (D-23, D-34, D-38),
`dialogExpiry` (D-57), the interruption state (B-44) and `Waiting for permission…` (B-46).
Acceptance: a managed deployment spawns after it has been approved; a denied model is told the edit
was not written and to stop; a slash command echoes as a command rather than as XML; an interrupted
tool reads as interrupted and a permission-blocked one reads as waiting; a dialog card states the
deadline the session actually has; every slash command afleet does not host answers with one honest
line naming what afleet does instead. Owns: the refusal copy table. Edges: none; first.

**C9. Transcript fidelity.** Edit diffs, images and PDFs, the thirty remaining tool result forms,
the cluster sentence and the fold count, the rejection forms (B-45; interruption and waiting are
C8's), the scroll-anchoring width freeze, the Raw tab, copy and export, microcompact staleness,
mermaid if the architect rules it in. Owns the structured result slot and persisted per-row
disclosure, and delivers both as its first leaf. Acceptance: C6.1's own gate, plus — every tool in
the 2.1.263 roster has a form that is not `Done`; an edit shows its diff in the row with line
numbers and hunk headers; a picture shows as a picture and a placeholder carries its size and kind;
a fold reopened after a channel switch is still open; a row that changes height after it is drawn
does not move the reading position. Edges: C8.

**C10. Composer.** The queue, shell mode, accept semantics, the hint row, prompt history (read
side), the paste chip, argument hints, the menu-bar projection of the default keybinding table and
the `keybindings.json` read. Owns the completion popover and the composer strip slot, delivered
first. Acceptance: a queued prompt is visible as its own text and can be pulled back into the field;
`!` is visible before Enter and shows elapsed time while it runs; Tab fills `/model` without
executing it, Enter with a row selected runs it, and Enter with nothing selected submits the typed
text; Up recalls the last prompt; every chord in the default table has a menu item showing its
shortcut. Edges: C8; the write side of history and the keybindings editor wait on the owner (§10).

**C11. Decisions and consent.** The twelve routes with their own titles and questions, the sixteen
destructive warnings, the grant row's file name and display limits, plan editing through the Files
tab, the elicitation form layer, `supportedDialogKinds` widened, the five unforwarded gates, the
bypass disclaimer. Owns the decision option list, the dialog destination rule and route table, and
the consent gate strip; the permission route titles and questions are this child's and appear
nowhere else. Acceptance: `git push --force` shows `Note: may overwrite remote history` under a
title and question that belong to `Bash` rather than a generic one; a plan can be edited and the
edit is what gets approved; a URL elicitation completes with its validation strings; a channel with
a managed payload explains itself and hands off to a terminal. Edges: C8.

**C12. Claude Code settings.** The Settings section with Defaults, Permissions, Extensions, Account
and Usage; the write-class model; the permissions editor; the MCP browser with OAuth through the
Browser tab; hooks, plugins and skills viewers; the pickers restored and a visible fast toggle;
`/memory`'s file list; output style; `/add-dir` and `/cd`; `plugin_errors` decoded; an `/agents`
definitions view if the owner wants one. Owns the settings row with write class and provenance.
Acceptance: every one of the sixty `/config` rows is visible with its effective value, its winning
source and its write class; a rule's provenance and its shadowing are explained where the rule is;
a needs-auth MCP server can be authenticated without leaving the window; fast mode's state is
readable from the window rather than recalled from the last message. Edges: C8; the user-scope
write destination waits on the owner.

**C13. Session panels.** The context grid and Suggestions, usage and limits with the rate-limit
family, rewind, the Background panel with the persisted task list, `/help` and the shortcuts window,
`/resume` filters and preview, `/export`, `/branch`, the diagnostics commands. Owns the surface
registry, the header readback popover and the owned-versus-adopted capability flag; the registry is
its first leaf, because three routed-only commands land on nothing without it. Acceptance: `/tasks`
opens the Background panel with the running tasks in it and each one can be stopped from there; the
context budget is attributable per category; being near a limit is visible before the cut-off; a
message can be rewound with a per-message diffstat and all six restore choices on an owned channel,
and an adopted channel says which of them it cannot offer and why; a user who asks for help gets it.
Edges: C8; consumes C14's banner queue for the rate-limit banner and shares Settings panes with C12.

**C14. Fleet, agents and chrome.** The sidebar row with bands and nudges, subagent rendering and the
Agents panel (C6.4's remainder), the task and agent card, the activity strip, the live tail and
watchdog, task-notification rules, held cross-session messages, peek-before-attach, tab status and
session colour, title precedence, the notification taxonomy and "while you were away", presence
reading, workflow phases. Owns the channel banner priority queue and the toast stack, the band
function, the sidebar channel row and the task and agent card. It waits on nothing but C8: G-21
records C6.4's remainder as already unblocked, so the Agents panel is its first leaf. One
prerequisite before that leaf: rename `TaskRunRow.activeForm(of:)` (G-37), so canon's `activeForm`
keeps its own meaning in the code the panel is built on. Acceptance: a failed session and a finished
one are distinguishable at a glance in the sidebar; what needs you is at the top; a running channel
shows a verb, elapsed time, live tokens and the escalating tool label; a finished background shell
keeps its tail and the tail is searchable; an Activity row can be answered without opening the
channel; a subagent's permission ask says which agent it came from. Edges: C8; outbound presence
waits on the owner.

**Cross-cutting, own it once.** Themes, daltonized variants, reduced motion and the announcement
rate (A-19, A-40 to A-43) touch every child and are a standing constraint on all of them rather than
a leaf of any one. The comment mechanism (H card 4) spans C9, C11 and the Files tab and is the one
item whose child depends on the owner's appetite for it.

### The alternative: defects, then user journeys

The adversarial review of this cut proposed a different one: keep C8 as the first child, then group
everything after it by what a user is trying to do rather than by which region of the window it
lives in. Its five journeys:

1. **Start and remain safely usable** — spawn preconditions, trust and managed settings, the consent
   gates, the refusal copy, the banners that say a channel is blocked and why.
2. **Understand and recover a turn** — the transcript's forms and folds, interruption and rejection,
   the diff, rewind, copy and export.
3. **Compose and steer** — the field, completion, the queue, shell mode, history, the interrupt
   ladder, the keybinding projection.
4. **Supervise the fleet** — the sidebar, Activity, the task and agent card, notifications, peek,
   presence.
5. **Inspect and configure the harness** — `/config`, permissions, MCP, hooks, plugins, skills,
   usage, `/context`, `/help`.

The two cuts agree on more than they differ on. Both put C8 first, and both extract each shared
system inside the child that first consumes it rather than in a seams child. They differ on one
thing: whether a child is a region of the window or a thing a user is doing. The region cut keeps
each child inside one code area with one design owner, and it is the shape afleet's existing C5 to
C7 children already have. The journey cut makes each release demonstrable end to end, which the
region cut has to work at deliberately, but it spreads every child across the whole app, so two
children edit the same files and no child has a single owner.

The recommendation is the region cut with journey acceptance criteria — which is what the
acceptances above already are: each is a sentence about something a user can now do, not about code
that now exists. The choice belongs to the owner, and it is §10's first item.

## 9. Prior art

What the survey of 41 products (`surfaces/H-prior-art.md`) changes in the recommendations above,
and what the field does that neither the terminal nor afleet's spec has:

- **afleet is on the winning side of the field's architectural split.** Of fourteen multi-session
  Claude Code managers, only those that talk to the engine structurally render a real permission
  card; the pty wrappers pay a documented tax, and one rewrote onto the SDK after calling its
  output parsing fragile. afleet's decision cards are a differentiator, not table stakes.
- **The commercial terms are a standing policy risk, not a live cost.** Anthropic announced on
  2026-05-14 that Agent SDK and `claude -p` usage would leave subscription limits for a capped
  credit, and paused that change on 2026-06-15 with a revision promised. Zed's mitigation, a
  PTY-hosted `claude` kept beside its structured integration, is the field's only worked answer.
  Whether afleet wants that escape hatch is an owner decision; keeping the seam that would allow it
  is an architectural one.
- **Peek-before-attach** is the strongest single idea found: a panel that shows the untruncated
  sentence a row cuts off, the linked PR, the waiting time and a reply box, so most decisions never
  open the transcript. afleet's Activity view is one rung short of it (backlog item 29).
- **Adopt the engine's own status vocabulary.** `claude agents --json` publishes enumerated
  `state`, `status` and `waitingFor` values; afleet reads them as free strings. Adopting them
  inbound costs nothing and turns "needs you" into five named causes. Legibility in the other
  direction — other tools reading afleet's channels — is a separate job: afleet publishes none of
  these fields today, so it needs the outbound publication in §10 item 3 (G-47).
- **One comment mechanism for diffs, plans and files** appears in eight products and is Anthropic's
  house pattern; afleet has every part it needs (backlog item 30).
- **Name the three things a message typed mid-turn can mean**: queue, steer, stop-and-send. afleet
  can detect turn boundaries where Zed cannot. One product documents the hazard that matters — Roo
  Code warns that queued messages act as approval for the next action, outside its auto-approve
  settings. The rule is H's derivation from that hazard rather than anything a product ships:
  afleet's queue never carries approval, and the composer's contract should say so before someone
  adds the convenience.
- **Where afleet already leads, in shipped code**: the permission card's three-scope destination
  picker, matched only by Nimbalyst among the wrappers; and three surfaces lane E found that beat
  the terminal outright and are worth protecting rather than extending — `/logout`'s account census
  (E-44), the `.mcp.json` configuration-hash re-consent (E-18), and the Background section standing
  in for the daemon hub (E-56).
- **Where afleet's design leads, unbuilt**: the Agents tab's task-keyed tree with per-node
  transcripts (G-21, root §8.8, C6.4 not dispatched), and the live thinking-token estimate that no
  surveyed product claims — `ThinkingDisclosure.swift:29-36` renders a duration, not a token count
  (tracker 127). Both are on paper, and neither is a differentiator until it ships.
- **Per-channel cost attribution is the fourth fleet-level gap** H names, alongside the peek rung,
  the comment mechanism and the queue verbs. No surveyed product answers it and afleet has no
  surface for it: what this channel has cost, beside what the account has spent.

## 10. Open questions for the owner

Collected from the cards' *Open* paragraphs: 215 non-empty ones. 153 are owner decisions in nineteen
themes, 35 are probes (a binary grep, a live run with afleet's flag set, or an afleet source read
would answer them), 17 are build-time unknowns, and 13 are cross-lane bookkeeping notes with no
decision in them; three cards carry both a decision and a probe, which is why 153 + 35 − 3 + 17 + 13
comes to 215. The sharpest of the probes is D-17's — whether the engine sends
`permission_suggestions` on an org-capped ask, which decides whether afleet's persistent-grant row
can offer a grant the organisation forbids. The full clustered list, with the sharpest verbatim
question under each theme and the probe list ready to run, is `open-questions.md`. The decisions
below are the ones that unblock the most cards, in this map's own ordering; the file orders themes
by raw card count, where the settings and MCP panel's scope (23 cards) and the approval dialogs'
content (18 cards) lead.

1. **Region cut or journey cut** (§8). Both proposals put C8 first and both extract each shared
   system inside the child that first consumes it. They differ on whether a child is a region of the
   window or a user journey. The recommendation is the region cut with journey acceptance criteria,
   but this decision shapes every child after C8 and the study will not make it.
2. **Writes under the config home.** Root §7.8's never-write rule (X9) blocks a keybindings
   editor (C-61), the write half of prompt history (C-33), user-scope permission rules from the
   destination picker (E-10), and cloud-plugins consent (E-27). tui-parity tells the host to ship
   two of these. One decision, made once: keep X9 absolute, carve a per-file exception, or route
   such writes through the CLI as a subprocess.
3. **Outbound presence.** afleet publishes no `status`, `waitingFor` or `tempo`, so its channels
   read as unknown activity to every other tool. A protocol ask, an explicit statement of the cost,
   or a write under the config home (G-47).
4. **Model-call spend for chrome.** The narration sub-line is a second model call per running
   channel about every 30 seconds (A-24); model-written progress summaries and "while you were
   away" prose (G-15, G-59) are the same question at different sizes.
5. **A hidden settings channel** for the 37 `/config` rows only the headless text command can
   write, so a settings write never lands as a turn in a conversation the user is having (E-01).
6. **Root §3 exclusions the cards keep meeting.** Remote Control consent and its status card
   (D-53, G-54), worktree exit with a dirty tree that afleet's own model can create (D-56),
   Slack `#` channels (C-20), agent teams (G-39 to G-41).
7. **Usage-limit auto-continue.** Root §17.8 files it under *Deferred*; E-48's card argues it is a
   fleet-defining feature rather than a nicety, because a fleet that stops at a rate limit and waits
   for a human has stopped being a fleet. A §17.8 scope question, like item 6.
8. **`/stop`.** Canon's `/stop` ends a background session and keeps its transcript and worktree;
   afleet routes it to `interrupt`, which ends the turn — deliberately, per root §7.7. Same word,
   destructive difference. Keep the divergence and say so in the refusal copy table, or rename
   afleet's (F-12).
9. **Per-channel or per-app.** The engine-version announcement (A-02), settings-change notices
   (E's open), and the daltonized preference: which surfaces are once per launch and which once
   per channel.
10. **Auto mode.** afleet offers `auto` in the mode picker with no view of the environment document
    that makes it safe (D-55) and no Activity rows for flagged allows and denial limits (D-25).
11. **Spinner tips, and personality generally.** Whether the tip registry, the verb list and the
    animated title prefix belong in a workspace product at all (A-21, A-22, A-34).
12. **Mermaid.** Vendoring mermaid.js in a web view, pending the architect ruling C6.1 deferred
    to (B-52).
13. **The comment mechanism and the peek rung**: both are `[exceeds]` items with no terminal
    referent; both change the shape of the next fleet child (H cards 9 and 4).
14. **A second hosting path.** Whether to keep an architectural seam for a PTY-hosted `claude`
    beside the structured host, given the paused billing change (H headline 2, card 10).

## 11. Surprises and discoveries

Things the lanes established that overturned an assumption held by the task prompts, the
inventory, the clone or afleet's own specs. Each is recorded in the card named.

- The `⚙ N bg` footer chip does not exist at 2.1.263; the glyph is `↳` and it appears only at two
  or more tasks, with a typed label at one. The `⚙` came from the clone's row built against
  2.1.220 (G-22).
- The `/agents` management wizard was removed; the command prints a static notice (E-42). There is
  no `#` quick-memory shortcut; `#` is Slack channels (C-20, E-39).
- `MultiEdit` is not a rendered tool in 2.1.263 (B-20). `/tag` is not a command; `/cost` and
  `/stats` are aliases of `/usage` (F-03, F-26). `/loops`, `/wellbeing` and `/version` are compiled
  in behind `isEnabled: () => !1` (F-34, F-43).
- SPEC 263 has no section for the `/help` dialog, the `Usage` and `Stats` tabs, the tool-call
  cluster renderer, the `ReportFindings` renderer, the task-notification row or the `/mcp` list's
  row rendering; all were built from the binary (F-13, F-02, B-12, B-35, G-27, E-14).
- The dialog registry holds 41 kinds, not the nine permission kinds plus a list; five kinds are
  absent from the spec library entirely; `ctrl+e explain` does not exist; the option labels are the
  bare words `Yes` and `No`; the workspace-trust copy is `Quick safety check: …` (D-09, D-22, D-24,
  D-42).
- Canon labels a subagent's permission ask `· from the <agentName> agent`; subagent colour is
  declarative frontmatter with `general-purpose` deliberately uncoloured; sub-subagents do not
  nest in the transcript (G-13, G-14, G-20).
- The task-notification row is one line carrying `<summary>`, and nothing at all when there is no
  summary (G-27).
- afleet sets `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` on every engine it launches, so file
  rewind is live on owned channels; the open question moved to adopted sessions (F-27).
- `/resume`'s message-content search is hard-nulled in 2.1.263, so afleet's exclusion of full-text
  search costs nothing against canon (F-19).
- tui-parity states the queue drain rule backwards: the scan covers the whole queue and skips
  slash commands rather than stopping at them (C-39). It also counts 23 keybinding contexts where
  2.1.263 has 26 (C-59), and four of its area rows claim `update_settings` writes keys it cannot
  (E, spec defects 10).
- Anthropic's move of Agent SDK usage off subscriptions, announced 2026-05-14, was paused on
  2026-06-15; the lane's first draft reported it as in effect and was corrected from the primary
  source (H headline 2, card 10).
- The first run of this study wrote into the afleet repository; the rerun did not, and the
  untracked copies there are stale.

## Decision Log

- Decision: The study covers the full terminal denominator, including surfaces the GUI
  supersedes, and records afleet's status per surface from evidence in the specs and source.
  Rationale: A map with holes cannot rank a backlog; a `superseded` card costs one paragraph.
  Rejected: covering only the undesigned remainder (misses built surfaces that lose information;
  misses the audit).
  Date/Author: 2026-09-09 / owner with Claude

- Decision: Faithful by default, exceed where the GUI can; every deviation named.
  Rationale: The owner's choice on 2026-09-09. The terminal's surfaces encode years of product
  decisions; the GUI inherits them unless the medium gives a reason.
  Rejected: idiomatic redesign (loses the inherited decisions); strictly faithful (forbids images,
  real diffs, persistence, hover, the reasons a GUI exists).
  Date/Author: 2026-09-09 / owner with Claude

- Decision: Slack is a skeleton, not a widget vocabulary.
  Rationale: The owner's statement on 2026-09-09: afleet adopts Slack's layout and adds its own
  agent-workspace features. Each surface's widget is chosen on its merits, preferring a form the
  window already has.
  Rejected: mapping each terminal surface to Slack's nearest feature; macOS-native-first.
  Date/Author: 2026-09-09 / owner with Claude

- Decision: Text wireframes in the root spec's style; no HTML prototype in this round.
  Rationale: The owner's choice. The layout calls that need a visual judgment are listed in §10 so
  a prototype can be scoped later if wanted.
  Rejected: a clickable HTML mock (larger effort; deferred, not refused).
  Date/Author: 2026-09-09 / owner with Claude

- Decision: The study ends with a ranked backlog and a proposed roadmap cut, not child specs.
  Rationale: The owner's choice. The cut is input to the decomposing step, which owns the gate and
  the edges.
  Date/Author: 2026-09-09 / owner with Claude

- Decision: The study lives in somersault at `tui-to-gui/`; afleet is its consumer and is
  read-only input.
  Rationale: The owner's instruction on 2026-09-10: afleet is the product under development and
  the research is conducted under the somersault repository. When the study lands, afleet gets a
  pointer to it beside `docs/tui-parity/`, in a change made from an afleet session.
  Rejected: writing it in afleet at `docs/tui-to-gui/` (the first run's default, which the owner
  overturned; the partial lane files written there on 2026-09-09 were copied here and the
  untracked originals left for the owner to remove).
  Date/Author: 2026-09-10 / owner

- Decision: Canon is 2.1.263.
  Rationale: The installed CLI; afleet's C6.3 already pins engine anchors to it; the spec library
  has a re-cut at that version.
  Rejected: 2.1.257 (the older cut; afleet's parity inventory was written against it and
  cross-checked on 2.1.259).
  Date/Author: 2026-09-09 / Claude

- Decision: Translate the fullscreen renderer branch everywhere, never the classic-inline one.
  Rationale: afleet's window is structurally the fullscreen branch; the inline degradations exist
  to share a terminal with a shell and have no referent in a window (A-01).
  Rejected: carding both branches per surface (doubles the cards for no GUI difference).
  Date/Author: 2026-09-10 / Claude, from lane A

- Decision: Live defects in shipped afleet code are reported in the study and proposed as the first
  child, not fixed from here.
  Rationale: afleet is read-only input to this study and is being built in its own sessions.
  Date/Author: 2026-09-10 / Claude

## Outcomes & Retrospective

Written at the close of the study, 2026-09-10.

- 400 surface cards across seven families, 14 prior-art pattern cards over 41 products, one
  surface index, one defect list for three owners, and this map. Every lane covered its full
  denominator; the only named coverage gap is that lane G did not re-read
  `docs/tui-parity/areas/20-tasks-background.md` row by row.
- The first run on 2026-09-09 was cut off by an API failure after writing partial files for seven
  lanes and nothing for the eighth. Because the brief told lanes to write incrementally, the
  fragments were usable and the rerun continued from them; the resumption rule is now brief §9.
- Four lane findings were corrected from outside the lane. Two during the study: lane F's open
  question about the checkpointing flag was answered from afleet's launch configuration, and lane
  H's billing finding was corrected from Anthropic's help page; both were folded into the lane
  files by the lanes themselves. Two at review, against afleet's source: lane B had
  `TextSanitiser` missing canon's second sanitising stage, which its single pass already covers
  (B-57), and lane E had `/fast` falling through to a picker surface that does not exist, which the
  router never reaches for that command (E-30). D-45's card status was corrected at review too —
  the reader and its banner case are built, and the bug is the hash inside them.
- What the study did not do: it did not run probes, write Swift, or design protocol changes, and
  it did not produce a visual prototype. The probes the cards ask for are listed with the open
  questions; the layout calls that want a visual judgment are in §10.

## Revision Notes

- 2026-09-09: created; sections 1, 2, 4 (draft) and the Decision Log seeded from the owner's
  answers. The remaining sections are filled when the lanes land.
- 2026-09-10 (review): two independent reviews (`reviews/`) found two false defect claims (B-57, E-30), wrong unbuilt-by-region counts, deliberate divergences listed as defects, and an incoherent seams child; all applied — §5 recounted, §6 and §7 corrected with a Child column, §8 rewritten without a seams child and with the journey alternative recorded, four cards and the index corrected.
- 2026-09-10: moved to somersault on the owner's instruction; the eight lanes resumed from their
  partial files (A to G) or from scratch (H). Sections 3 to 11 written from the completed lanes;
  `surface-index.md` and `spec-defects.md` added.
