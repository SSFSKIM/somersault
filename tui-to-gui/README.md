# TUI to GUI: how every Claude Code terminal surface translates into the afleet window

Status: **draft in progress, 2026-09-09; resumed 2026-09-10 in somersault after the first run was cut off.** Canon is Claude Code 2.1.263 (the installed CLI
and the spec library at that version). Living document; the per-family card files under
`surfaces/` are the detail, this file is the map. Sections marked *(pending)* are filled as
the lanes land.

## 1. Purpose

afleet's charter is a UX equal to or better than the terminal's while hosting the unmodified
engine. `docs/tui-parity/` settled the first half of that claim at the protocol level: for
every terminal affordance, whether the headless wire can supply its data. This document
settles the second half at the UX level: for every terminal **surface** a user sees or
operates, what it becomes in the window.

Seven children of the root spec have merged and the app runs. The root spec (§8) designs the
timeline, the decision cards, the composer and the Agents panel in depth. It leaves the rest
of the terminal to one-line router entries (§7.7: "`/mcp` → MCP popover from `mcp_status`")
or to silence: the sixty-row `/config` registry, the permission rule editor, the MCP browser,
hooks, plugins, skills, memory, `/status`, `/context`, `/tasks`, `/help`, the transcript
view, the message selector, vim mode, themes, the keybindings file, the status-line protocol,
the spinner with its tips and stall copy, the notification bar, the footer's hint vocabulary,
and the differences between the fullscreen and inline renderers. Those are the surfaces a
daily user meets, and they are where a GUI that "hosts the whole harness" is judged.

The stance, fixed by the owner on 2026-09-09: **faithful by default, exceed where the GUI
can.** Each surface keeps its information, states, ordering and copy unless a GUI reason says
otherwise, and every deviation is named with its reason. Slack is adopted as a skeleton only
(sidebar, channels, threads, Activity, badges); afleet's own workspace features surround it,
and no terminal surface is forced into Slack's widget vocabulary.

Written for whoever cuts and builds afleet's next children, and for the owner to judge the
layout calls.

## 2. Method and evidence

Three sources, in order of authority for what the terminal does; one for what afleet does.

1. **The 2.1.263 spec library** at `~/claude-code-bundle/2.1.263/SPEC/`, cited as *SPEC
   41.18.5*. Its own review did not converge on every chapter, so load-bearing claims were
   re-read in `cli.pretty.js` at that version; cards say `(verified in cli.pretty.js:LINE)`
   where that happened.
2. **The somersault clone's scorecard** (`CC-to-SDK/docs/parity/tui-ux.md`, 667 rows) and
   its per-wave specs: a terminal clone built against the binary, whose rows record the canon
   quirks learnt at implementation contact (byte-verified glyphs, probe-verified semantics).
   Only its verified quirks are carried; its own layout choices are not canon.
3. **afleet's protocol inventory** (`docs/tui-parity/`) for the wire class of every
   affordance; this document never re-derives P/R/D/X/T.
4. **afleet's specs and source** for what is built, designed, routed-only or undesigned:
   the root spec, the C5, C6 and C7 family specs, and `App/`, `FleetKit/`, `Workbench/` on
   `main` at the date above.

Eight lanes produced the card files, one per family of surfaces; a ninth source is the
prior-art survey. Each card follows one schema: *Terminal* (what it draws, cited), *Job*,
*Wire*, *afleet today*, *GUI form* (with a wireframe where layout matters), *Drops / keeps /
gains*, *Open*.

| File | Family | Cards |
|---|---|---|
| `surfaces/A-chrome-and-status.md` | footer, notification bar, spinner and tips, status line, title and tab status, welcome, themes, colour, fullscreen vs inline | *(pending)* |
| `surfaces/B-transcript-rendering.md` | glyphs and gutters, every per-tool result form, diffs, markdown, the fold and `ctrl+o`/`ctrl+e`/verbose/brief, compaction display | *(pending)* |
| `surfaces/C-composer-and-input.md` | editor buffer, vim, paste, `! @ # /` modes, autocomplete, history, queue and steering, interrupt ladder, Shift+Tab ring, keybindings file | *(pending)* |
| `surfaces/D-decision-dialogs.md` | the dialog store's rules, every permission variant, plan approval, questions, elicitation, the two forwarded dialogs, trust and consent moments | *(pending)* |
| `surfaces/E-panel-commands-settings.md` | `/config`, `/permissions`, `/mcp`, `/hooks`, `/plugin`, `/skills`, `/memory`, pickers, auth and client setup commands | *(pending)* |
| `surfaces/F-panel-commands-session.md` | `/status`, `/context`, `/cost`, `/tasks`, `/help`, `/resume`, `/rewind` and the message selector, `/diff`, `/export`, compaction, loops and goals | *(pending)* |
| `surfaces/G-fleet-and-agents.md` | FleetView and the agents view, subagents in the transcript, background work, teams, presence, Remote Control | *(pending)* |
| `surfaces/H-prior-art.md` | how other agent GUIs translate the same surfaces; pattern cards with recommendations | *(pending)* |

### 2.1 Status legend used in every card

| Status | Meaning |
|---|---|
| `built` | code on `main`; the card names the file and the child spec section, and says what the built form keeps and loses against the terminal |
| `designed` | a spec specifies it; no code |
| `routed-only` | §7.7 names a native destination; nothing specifies its form |
| `undesigned` | no spec mentions it |
| `superseded` | a terminal-specific mechanism the GUI replaces wholesale; the card says by what |
| `out-of-scope` | excluded by root §3 or §17.8 |

## 3. The window, and where the terminal's regions land *(pending)*

The region map: the terminal's screen composition (root, layout frame, message list, footer
cluster, notification bar, dialog mounts, autocomplete menu, transcript screen) against the
window's regions (sidebar, channel header, timeline, channel banner, composer, decision card,
panel, Activity, quick switcher, Settings window, consent sheet, notifications, menu bar).
Filled from the lanes' "For the map" sections.

## 4. Translation principles *(draft; confirmed against the lanes when they land)*

Rules the terminal follows that the GUI keeps, each with its source, and rules that change
because the medium changed.

Kept:

- **Decisions appear in the conversation flow, not as OS modals.** The terminal mounts
  permission and question dialogs inline; only two of its forty-two dialog kinds are modal
  (SPEC 41.22.6). afleet's decision cards already follow this; every new decision surface
  does too.
- **Never steal the composer mid-draft.** A dialog arriving while the user is typing is
  parked with a visible placeholder (`Claude has a question for you — it shows once you send
  or clear what you're typing.`, SPEC 41.22.5), and a dialog that appears accepts no keystroke
  already in flight (the 150 ms grace).
- **Every displayed setting is a readback, never the last click** (root §7.7, C6.2). A
  picker shows what `get_settings` reports after the request, and a disagreement is shown,
  not hidden.
- **Faithful copy.** Where the terminal's string is the product's voice (permission
  questions, refusal text, tip text, status words), the GUI uses it verbatim and cites it.
- **The fold's reading order.** Prose first, tool activity folded under it, expandable in
  place; the GUI adds persistence and hover but keeps the order.

Changed:

- **Keyboard chords become menu items with shortcuts.** A terminal reserves keys and
  documents chords in a footer; a macOS app owns a menu bar, so every `chat:*` and `app:*`
  action gets a menu home and a discoverable shortcut, and the footer's hint row is not
  reproduced as a row.
- **Panels replace re-executed dialogs.** A terminal panel command (`/config`, `/mcp`,
  `/tasks`) is a transient screen; the GUI gives the same content a persistent place
  (Settings pane, popover, panel tab) and the slash command becomes a shortcut to it.
- **Live where the terminal was static.** The terminal draws a result once; the GUI can
  keep a running tool's output, a context meter and a task list live without a keystroke.

## 5. Surface index *(pending)*

One row per card across all lanes: id, surface, afleet status, GUI region, and whether the
GUI form keeps, loses or exceeds the terminal.

## 6. Where the built app loses something the terminal has *(pending)*

The audit result: built surfaces whose form drops information, a state or an action the
terminal had, with the card that proposes the delta.

## 7. Ranked backlog *(pending)*

Every surface not yet `built` in its proposed form, ranked by user value against build cost,
with dependencies on afleet seams.

## 8. Proposed roadmap cut *(pending)*

A candidate grouping of the backlog into children for the root spec's §17, each with purpose,
observable acceptance, the seams it touches and its edges. A proposal for the owner and the
decomposing step, not a decision.

## 9. Prior art *(pending)*

What the survey changes in the recommendations above, and what the field does that neither
the terminal nor afleet's spec has.

## 10. Open questions for the owner *(pending)*

## Decision Log

- Decision: The study covers the full terminal denominator, including surfaces the GUI
  supersedes, and records afleet's status per surface from evidence in the specs and source.
  Rationale: A map with holes cannot rank a backlog; a `superseded` card costs one paragraph.
  Rejected: covering only the undesigned remainder (misses built surfaces that lose
  information; misses the audit).
  Date/Author: 2026-09-09 / owner with Claude

- Decision: Faithful by default, exceed where the GUI can; every deviation named.
  Rationale: The owner's choice on 2026-09-09. The terminal's surfaces encode years of
  product decisions; the GUI inherits them unless the medium gives a reason.
  Rejected: idiomatic redesign (loses the inherited decisions); strictly faithful (forbids
  images, real diffs, persistence, hover — the reasons a GUI exists).
  Date/Author: 2026-09-09 / owner with Claude

- Decision: Slack is a skeleton, not a widget vocabulary.
  Rationale: The owner's statement on 2026-09-09: afleet adopts Slack's layout and adds its
  own agent-workspace features. Each surface's widget is chosen on its merits, preferring a
  form the window already has.
  Rejected: mapping each terminal surface to Slack's nearest feature; macOS-native-first.
  Date/Author: 2026-09-09 / owner with Claude

- Decision: Text wireframes in the root spec's style; no HTML prototype in this round.
  Rationale: The owner's choice. The layout calls that need a visual judgment are listed in
  §10 so a prototype can be scoped later if wanted.
  Rejected: a clickable HTML mock (larger effort; deferred, not refused).
  Date/Author: 2026-09-09 / owner with Claude

- Decision: The study ends with a ranked backlog and a proposed roadmap cut, not child specs.
  Rationale: The owner's choice. The cut is input to the decomposing step, which owns the
  gate and the edges.
  Date/Author: 2026-09-09 / owner with Claude

- Decision: The study lives in somersault at `tui-to-gui/`; afleet is its consumer and is
  read-only input.
  Rationale: The owner's instruction on 2026-09-10: afleet is the product under development
  and the research is conducted under the somersault repository. When the study lands,
  afleet gets a pointer to it beside `docs/tui-parity/`, in a change made from an afleet
  session.
  Rejected: writing it in afleet at `docs/tui-to-gui/` (the first run's default, which the
  owner overturned; the partial lane files written there on 2026-09-09 were copied here and
  the untracked originals left for the owner to remove).
  Date/Author: 2026-09-10 / owner

- Decision: Canon is 2.1.263.
  Rationale: The installed CLI; afleet's C6.3 already pins engine anchors to it; the spec
  library has a re-cut at that version.
  Rejected: 2.1.257 (the older cut; afleet's parity inventory was written against it and
  cross-checked on 2.1.259).
  Date/Author: 2026-09-09 / Claude

## Surprises & Discoveries

*(pending — filled from the lanes' spec-defect sections and anything that overturned an
assumption above)*

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-09-09: created; sections 1, 2, 4 (draft) and the Decision Log seeded from the owner's
  answers. The remaining sections are filled when the lanes land.
- 2026-09-10: moved to somersault on the owner's instruction; the eight lanes resumed from
  their partial files (A–G) or from scratch (H).
