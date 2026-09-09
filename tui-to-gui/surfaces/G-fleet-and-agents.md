# Lane G — fleet, agents and background work

**Date:** 2026-09-09. **Canon:** Claude Code 2.1.263 (`/Users/new/claude-code-bundle/2.1.263/SPEC/`,
binary `/Users/new/claude-code-bundle/2.1.263/cli.pretty.js`).

**What this lane covers.** Every terminal surface that shows *more than one unit of work at once*,
or one unit of work that is not the foreground turn: FleetView (the whole-screen multi-session
list), the agents chip and the `Agents` keyboard scope, subagents as they render inside a
transcript, background shells and their live tail, the background-task registry and its
notifications, the persisted task list and the `ctrl+t` panel, teams and teammates, workflow
phases, the daemon roster and cross-session messaging, Remote Control as seen from the session
being driven, and the notification kinds that exist to tell a human that some *other* unit of work
needs them.

**SPEC sections read.** 39.32.2, 39.32.6–39.32.12 (FleetView: entry, anatomy, keys, bands, nudges,
settings), 39.24.1–39.24.6 (teammate UI), 39.25.2 (`/list-agents` row formats), 39.26.1–39.26.3
(coordinator mode); 41.15.4 (the footer cluster, for the agents and background chips), 41.15.9
(FleetView in the frame), 41.16.1 (agent-tree connectors, fork marker), 41.9.5 (the eight-name
subagent palette), 41.19.10 (`subagentStatusLine`), 41.20.1 (the `War` notification-type domain),
41.21.5 (tab status); 42.6.10 (the `Task` scope), 42.6.20 (the `Agents` scope); 18.23.1–18.23.4
(task record, completion notification, parking, output file), 18.20 / 18.30 (fork, `/subtask`);
20.6 (activeForm and the task panel), 20.10.1–20.10.5 (`<task-notification>`), 20.13–20.13.2
(Monitor), 20.15.1 (`/background` and its banner), 20.16.4 (the OSC 9;4 progress indicator);
16.13 "Progress polling" (the last-five-lines live preview), 16.16 (background shells: completion,
lifecycle, `Ctrl+B`, stall watchdog), 16.18 "The background notice"; 40.20.1 (the ultracode veto),
40.17 (the phases UI); 38 and 36 and 50 read via a scoped extraction (below).

**Verification spent (`cli.pretty.js` at 2.1.263).** Seven literal greps.
`uo = { review: "Ready for review", blocked: "Needs input", working: "Working", done: "Completed" }`
(`:372101`) — the four band labels and therefore three of the six status words.
`"Needs you"` (`:374069`) — the simple-view rewrite. `So(...)`, the FleetView label chain, read in
source at `:373749-373760`, which yields two fallbacks the SPEC prose does not name:
`session you came from` and `untitled session`. `Your conversation moved to the background — enter
opens it · esc returns to it · ctrl+c twice quits` (`:374537`). `" for agents"` (`:506190`) and the
chip's numeric branch (`:506202-506212`), which shows the count is clamped to `99+` and coloured
`warning` when `awaiting` / `success` when `done`. `" background"` (`:506844`). And one **negative**
result that matters: **`⚙` does not occur anywhere in the 2.1.263 binary** (`grep -o '⚙'` returns
nothing over all 848,201 lines). There is no `⚙ N bg` indicator in canon at this version — see
Spec defects.

**afleet files read.** Root spec §3, §7.1, §7.2, §7.4, §7.6, §7.7, §8.2, §8.8, §9.5, §13, §14,
§17.8 and the Decision Log; C5 §4–§5; C6 "The Agents panel" and the C6.4 plan; C7 and C7.4;
C3/C4 (agent run tree, registry mirror); `App/Fleet/*`, `App/Activity/*`, `App/Agents/*`,
`App/Views/SidebarView.swift`, `App/Views/ActivityView.swift`,
`App/Timeline/Rendering/Rows/AgentChip.swift`, `.../TaskRunRow.swift`,
`FleetKit/Sources/FleetTimeline/*`; `docs/tui-parity/README.md` §4 findings 2–5 and 22, §5 rows
A-18/A-20/A-36/A-38/A-39/A-50; `docs/tui-parity/areas/18-agents-subagents.md`,
`.../20-tasks-background.md`, `.../50-36-39-38-notifications-remote-teams-daemon.md`.

**Clone evidence mined.** `CC-to-SDK/docs/parity/tui-ux.md` §8 "Control plane" (all nine rows), §4
rows "Task/todo panel", "Ctrl-T todo-panel toggle", "Background-dialog detail sub-dialogs", and the
F3 "live turn" section — in particular its *Unreachable* table, which is the single most important
piece of evidence in this lane (see Headline 5); `docs/parity/spec-crosscheck-2026-09-03.md`.

**Denominator, with additions.** The task prompt's list is covered. Surfaces found in the family
and added, with a note on each in its card: the FleetView **onboarding band descriptions** and
empty state (G-02), the FleetView **group presentation** and its reserved header labels (G-05),
the `claude agents --json` / non-TTY refusal path (G-09), the **stall watchdog** notification that
turns a stuck background shell into a user-visible event (G-26), `TaskStop` / stop-all as a fleet
action (G-27), the **agent-resumed** notice that fires when a user restarts a parked agent
(G-17), and the **teammate mode-change warning** (G-33). `/tasks` itself is lane F's; its
registry contents are carded here only where they differ from what lane F would show.

---

## 1. The fleet screen

### G-01 · FleetView — the whole-screen multi-session list

**Terminal.** FleetView **replaces the entire screen**; it is not a panel inside the REPL
(SPEC 41.15.9). It is reached seven ways (SPEC 39.32.2), of which three matter to a GUI: typing
`claude agents`, launching bare `claude` with the global-config flag `defaultToAgentsView`, and
pressing left-arrow out of the REPL (`entryChannel` = `cli_agents` / `default_home` /
`repl_back`). It has two tabs, `local` and `remote`, and `remote` is unreachable in this build
(SPEC 39.32.4, 39.32.9). Its body is a list of background jobs grouped into four bands, a
composer at the bottom that both filters the list and dispatches new sessions, and an optional
peek pane. Empty state (SPEC 39.32.9, `chunk-jta2pccx.js:374788`):
`Nothing running in the background.` followed by
`Hand off a task and it keeps working while you do something else — even if you close this terminal.`;
logged out it reads `You are not logged in. Run claude /login first, or press l to log in.` When
the current conversation was just backgrounded into it, a dim origin banner sits above the list
(verified at `cli.pretty.js:374537`):
`Your conversation moved to the background — enter opens it · esc returns to it · ctrl+c twice quits`.
The terminal title becomes `${n} awaiting input · claude agents`, or `claude agents` when
`n === 0` (SPEC 39.32.9). Refresh cadence constants are `120000 / 2000 / 500 / 30000 / 30000` ms.

**Job.** One place that answers "what is running on this machine, and which of it is stuck on
me?" without opening each session. It is the reason a user can hand work off and close the
terminal at all.

**Wire.** Not a wire surface — FleetView reads the cloud jobs client and the daemon roster
directly. afleet's route is the CLI: `docs/tui-parity/README.md` §5 A-50/36/39/38 and root spec
§9.5 both name `claude agents --json` plus the roster file, and `ListAgents` is a **D** ("returns
a formatted string; read `~/.claude/sessions/*.json` for the roster"). The per-session live
detail FleetView shows for jobs afleet itself hosts is `P`/`R` from that channel's own stream.

**afleet today.** `superseded` — by the sidebar plus Activity, by design. Root spec §8.2 makes
projects sections, sessions channel rows with badges, and gives Background its own section; §7.6
makes Activity a cross-channel query including "running and failed agent runs from the registry
mirror". `App/Fleet/FleetBrowserModel.swift`, `ChannelRegistrar.swift`, `ProjectGrouping.swift`
and `App/Views/SidebarView.swift` are the built form. What is lost against FleetView is not the
list — it is the **band grouping** and the **status vocabulary** (G-02, G-03), which the sidebar
does not have.

**GUI form.** No new screen. The translation is: FleetView's *list* is the sidebar; FleetView's
*bands* become sidebar ordering and badge semantics (G-03); FleetView's *composer* is Cmd+K plus
New channel (G-05); FleetView's *peek pane* is the channel itself (G-06). The three surfaces that
have no home and should get one:

- The **origin banner** has a real GUI analogue: when a channel is sent to the background from
  afleet (`/background`, header menu "send to background"), the channel does not close — it moves
  to the Background section and its header shows a one-line strip. Keep the terminal's three
  affordances but re-word for a GUI: `Running in the background · still open here · Stop`. `[exceeds]`
  the terminal has to choose between the fleet screen and the conversation; afleet shows both.
- The **empty state** copy is worth keeping verbatim on the Background section when it is empty:
  `Nothing running in the background.` plus the hand-off sentence, as a dimmed placeholder row.
- The **title count** maps to the macOS **dock badge**: number of channels in the `blocked` band
  (SPEC 39.32.9's `n` is exactly "awaiting input"), not total unread. That is a different number
  from the sidebar's per-channel decision count and should be sourced the same way.

```
┌ Sidebar ────────────────┐┌ Channel ─────────────────────────────────────────────┐
│ ⬤ Activity          3   ││  refactor the parser        main · opus · plan       │
│                         │├──────────────────────────────────────────────────────┤
│ NEEDS YOU           2   ││ ▸ Running in the background · still open here · Stop │
│   ▸ refactor parser  ●  │├──────────────────────────────────────────────────────┤
│   ▸ migrate schema   ●  ││                                                      │
│ WORKING             4   ││  (conversation)                                      │
│   ▸ audit deps      ⟳   ││                                                      │
└─────────────────────────┘└──────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** *Drops:* the screen itself, the `local`/`remote` tabs (remote is dead
in canon), the whole-screen takeover. *Keeps:* the empty-state copy, the origin banner's three
actions, the awaiting-input count as a dock badge. *Gains:* the fleet and one conversation are
visible at once; multiple windows; the list is never a modal state you must leave.

**Open.** Should the awaiting-input dock badge count decisions or channels? The terminal counts
*sessions*; afleet's sidebar already counts *decisions* in the Activity row, and two different
numbers for the same idea will confuse. Owner call.

### G-02 · The fleet row: naming chain and the six status words

**Terminal.** The row's display name comes from `So` (SPEC 41.15.9; read in the binary at
`cli.pretty.js:373749-373760`) as a fallback chain, in order: the job's `name`; else the words of
`displayIntent ?? intent`, capped at **25 columns**; else, if this row is the session you came
from, `current session` — or `session you came from` in the alternate phrasing flag; else, for a
`bg`-template row in state `working`, `new session` — or `untitled session`; else the template
name. The status word comes from a six-outcome table `Sn` (SPEC 39.32.9,
`chunk-jta2pccx.js:373853-373865`), evaluated in this order:

| Order | Condition | Word | Colour |
|---|---|---|---|
| 1 | activity `success` and settled | `Done` | success |
| 2 | activity `failure` and settled | `Failed` | error |
| 3 | activity `stopped` and settled | `Stopped` | inactive |
| 4 | mode `busy` or `shell` | `Working` | default |
| 5 | state `blocked` or mode `waiting` | `Needs input` | warning |
| 6 | otherwise | `Idle` | default, dim |

Rows 4 and 5 take their words from the band label map `uo` (verified at `cli.pretty.js:372101`:
`{ review: "Ready for review", blocked: "Needs input", working: "Working", done: "Completed" }`).
The simplified renderer rewrites row 5 to `Needs you` (verified at `cli.pretty.js:374069`). Four
columns are solved once per render over the whole row set (SPEC 41.15.9): **age** (widest age
string, floored at a constant), **label** (widest name, floored at 12, capped at
`max(40, floor(columns/3))`), **artifact** (a PR/frame badge, or zero width), **detail** (the
remainder, floored at 8). The artifact badge has four forms (SPEC 39.32.9): nothing; `${n} PRs`;
`#${number}` or bare `PR`; and `⧉` or `${n} ⧉` for frame children.

**Job.** Tell the user, in one line and at a glance, which of several sessions is finished, which
failed, which wants them, and how old each is — with a name they recognise even when they never
named the session.

**Wire.** For channels afleet hosts, everything except the name is `P`/`R`: run state from the
stream, ages from the transcript. The **name** chain is the interesting part — `intent` has no
wire equivalent, but afleet already computes an equivalent (root spec §8.2: custom, else AI
title, else first prompt), and the AI title is `P` via `generate_session_title` (README §4
finding 10). For jobs afleet does not host, the fields come from `claude agents --json` and the
roster (root spec §9.5).

**afleet today.** `built`, partially. `App/Fleet/ChannelRow.swift` and root spec §8.2 give a row
with title, relative time, one-line preview, origin glyph, and badges: unread dot, red decision
count, running glyph, and "presence text from the registry for foreign live". It has **no status
word**. The four-state badge vocabulary it does have (unread / decisions / running / presence) is
not the six-outcome table, and in particular there is no `Done` / `Failed` / `Stopped`
distinction after a turn ends — a failed session and a finished one look identical.

**GUI form.** Sidebar channel row. Adopt the six status words **verbatim** as a trailing status
chip on the row, with the terminal's colour roles (success / error / inactive / default /
warning / dim) mapped to afleet's semantic colours, and **adopt the evaluation order** — it
matters that a settled `Failed` beats a live `Working`, because a session that failed and then
had a keepalive is not "working". Row anatomy, left to right: origin glyph, title, decision
badge, status chip, relative age. `Needs input` is the word to use, not `Needs you` — the simple
view is a narrow-terminal degradation, not a preference (SPEC 39.32.9). Adopt the **name chain**
in FleetView's order, ahead of afleet's current one, with the 25-column cap becoming a
line-limit-1 truncation at the row's available width; keep afleet's AI title where FleetView
would use `intent` words, since it is strictly better copy for the same slot. Keep the
`current session` / `new session` fallbacks for the two cases that produce them (a channel with
no prompt yet; the channel you just came from) — an unnamed row that reads `new session` is
better than one that reads a slug. `[exceeds]` the artifact column becomes a real affordance: a
PR badge that is a link into the GitHub tab, and `⧉` frame children as an expandable disclosure,
rather than a width-budgeted glyph.

**Drops / keeps / gains.** *Drops:* the four solved column widths (a GUI row does not need a
global width solve); `Needs you`. *Keeps:* the six words, their order, their colours, the naming
chain and its two fallbacks, the artifact badge's four forms. *Gains:* status chip and decision
badge coexist; the PR badge is clickable; hover shows the full name the 25-column cap would clip.

**Open.** afleet's `preview` line and the terminal's `detail` column carry different things (last
message vs. current activity). Should the row show both on two lines, or one? Two lines costs
density in a long sidebar.

### G-03 · The four bands, the group presentation, and the reserved headers

**Terminal.** Rows are grouped into four bands in a fixed order (SPEC 39.32.9, verified at
`cli.pretty.js:372101`): `review` → `Ready for review`, `blocked` → `Needs input`, `working` →
`Working`, `done` → `Completed`. Each has a description shown **during onboarding only**:
`Sessions that have a question or need your decision land here` (blocked), `Sessions Claude is
actively working on — they keep running even if you close the terminal` (working), `Finished
sessions wait here for you to review` (done); `review` has an empty description. Band assignment
is separate from the status word, and its live busy/waiting and open-PR checks run *before* the
success case, so a job whose text emitted a completion marker is not guaranteed the `done` band.
Separately, `ctrl+s` (`agents:switchView`) cycles a **group presentation**: `state` → `directory`
→ `group` when groups are enabled, `state` → `directory` only when not; the choice persists as
the global-config key `fleetViewGroupMode`, and a persisted `group` downgrades to `state` when
groups are off. Reserved group-header labels are `(ungrouped)` and `(earlier)` plus `pinned` and
`past` (SPEC 39.32.9, `chunk-7wsy8vxb.js:189395`). The bands are populated by a classifier that
reads the job's **message text** for three markers on their own lines — `result:` → success,
`needs input:` → blocked, `failed:` → failure — a convention the built-in `claude` background
agent's system prompt states explicitly (SPEC 39.32.11).

**Job.** Put the sessions that need a human at the top, always, and separate "finished, go read
it" from "still going" so the user does not have to check.

**Wire.** `R`. The three markers are a prompt convention, not a protocol; afleet does not run the
background agent's system prompt, so it must derive the band from what it *does* have: pending
decisions (blocked), a running turn (working), a settled `result` (review/done). README §5 A-20
records that there is no query for the current task set at all, so the registry mirror
(`task_started` / `task_updated` / `background_tasks_changed`) is the source, `R`, foundational.

**afleet today.** `undesigned`. Root spec §8.2 groups the sidebar by **project**, with Background
and Archived as fixed sections; there is no state-based grouping anywhere, and
`App/Fleet/ProjectGrouping.swift` is project/worktree grouping only.

**GUI form.** This is the single highest-value adoption in the lane. Give the sidebar a
**grouping control** with exactly the terminal's three modes, in the terminal's cycle order and
with a persisted preference: **State** (the four bands), **Directory** (today's project
sections — the current and only behaviour), **Group** (user-defined groups; G-04). Put it as a
segmented control or a small menu in the sidebar header, bound to a menu-bar item; do **not**
bind `ctrl+s`. In State mode the sections are the four band labels **verbatim and in the
terminal's order**, with `Ready for review` above `Needs input` above `Working` above
`Completed`. Keep the three onboarding descriptions as the sections' empty-state text — the
terminal shows them once during onboarding, which a GUI can do better by showing each only while
its band is empty. Keep `(ungrouped)` and `(earlier)` as the reserved header labels in Group
mode so the two products agree. `[exceeds]` afleet's band assignment can be *correct* rather than
text-classified: a pending decision is a fact on the wire, not a `needs input:` line the model
had to remember to write. Say so in the card and in the code — this is a place the GUI is
strictly better, and the README's A-20 note that the classifier is invisible to the protocol is
the reason.

```
┌ Sidebar — grouping: [State] Directory Group ┐
│ ⬤ Activity                              3   │
│ READY FOR REVIEW                            │
│   ▸ audit dependencies      Done       2m   │
│ NEEDS INPUT                             2   │
│   ▸ refactor the parser  ⚑ Needs input 40s  │
│ WORKING                                     │
│   ▸ migrate the schema   ⟳ Working     11m  │
│ COMPLETED                                   │
│   ▸ fix the flaky test      Failed     1h   │
└─────────────────────────────────────────────┘
```

**Drops / keeps / gains.** *Drops:* the text-marker classifier; the onboarding-only timing of the
descriptions. *Keeps:* the four labels, their order, the three descriptions, the three grouping
modes and their cycle order, the persisted preference, the reserved header labels. *Gains:* the
band is derived from protocol facts, and grouping and project sections can coexist rather than
replacing each other.

**Open.** In State mode, do projects disappear entirely, or does each band sub-group by project?
The terminal has no answer — it has no project concept. Owner call; sub-grouping is more
information but two levels of section in a sidebar is a lot.

### G-04 · Fleet row actions: pin, reorder, rename, group, stop, delete

**Terminal.** FleetView's key handler `wg` (SPEC 39.32.10) binds row actions, of which only three
are user-rebindable — `agents:switchView`, `agents:togglePin` and `chat:externalEditor`; every
other action is hard-coded. The row actions: `shift+↑`/`shift+↓` reorder the focused row (only
when there are no suggestions and no preview); `ctrl+t` (`agents:togglePin`) pins/unpins, **daemon
rows only**; `ctrl+r` renames the session (a focused, non-pending job that is daemon-backed or
carries a socket) or renames a group (a focused group header that is not one of the reserved
labels); `ctrl+e` assigns a group (groups on, preview closed, empty query, a focused non-pending
daemon-backed job — a missing selection, a header, a pending job or a non-daemon job is rejected
with a hint); `ctrl+x` on a job stops it, then on a second armed press deletes it; `ctrl+x` on a
group header ungroups or deletes the whole group. The help overlay (`?`) assembles its lines
conditionally and includes `shift+↑↓ to reorder`, `ctrl+r to rename`, `ctrl+e to set group`,
`<key> to unpin` / `to pin to top`, `alt+1-N to open`, `ctrl+x to <verb>` and `← to go back`.

**Job.** Curate the list: keep the two sessions you care about at the top, name them so you can
find them tomorrow, bin the ones that are done.

**Wire.** Rename is `P` for afleet-hosted channels (README §4 finding 10,
`generate_session_title {description, persist}`); for foreign jobs it is the daemon's rename op,
which root spec §9.5 says afleet does **not** speak in v1 ("The daemon control socket (SPEC
38.11) is not spoken directly in v1"). Stop/delete are the CLI verbs `stop` and `rm` (root spec
§9.5, `X`-adjacent: reachable by process, not by protocol). Pin and reorder are local UI state
with no wire component.

**afleet today.** Partially `built`, partially `designed`. Root spec §8.2 gives project
**pinning** ("pinning persists") but at the *project* level, not the channel level; §9.5 gives
Background jobs *Adopt*, *Attach* and *Stop*; the header menu (§2 region vocabulary) has rename
and "send to background". There is no channel pin, no reorder, and no group concept.

**GUI form.** Row context menu plus hover actions on the sidebar row, and the same set on the
channel header's menu. The set, in the terminal's own vocabulary: **Pin to top** / **Unpin**
(the terminal restricts this to daemon rows; afleet should allow it on any channel — the
restriction is a daemon-registry artefact, not a user model), **Rename…** (inline edit in place,
which is what `ctrl+r` does), **Set group…** / **Move to group** (only in Group mode; the
terminal's rejection hints become disabled menu items with the reason as the tooltip),
**Stop**, **Delete**. Keep the terminal's **two-step arm** for delete — `ctrl+x` stops first and
only deletes on a second press — as a GUI confirmation: the first click stops, the menu item then
reads **Delete** and requires a confirm. Reorder is **drag to reorder** within a section, which
is the GUI's answer to `shift+↑↓` and strictly better; persist the order per grouping mode.
`alt+1…alt+9` (open the Nth job of the focused origin) maps to **Cmd+1…Cmd+9** on the sidebar,
which is the Slack convention the shell already borrows. `[exceeds]` drag-to-reorder, drag between
groups, multi-select for bulk stop.

**Drops / keeps / gains.** *Drops:* the `?` help overlay (a GUI shows affordances, it does not
list them); the daemon-row restriction on pin; the hard-coded chord set. *Keeps:* pin/reorder/
rename/group/stop/delete as the complete action set, the two-step delete arm, the group-header
actions, the reserved-label protection. *Gains:* drag, multi-select, per-mode persisted order,
menu-bar and context-menu duplication of every action.

**Open.** Should groups (`ctrl+e`) exist in afleet at all, given the sidebar already has projects
and pinning? They are a *cross-project* grouping the terminal needs because it has no projects.
Owner call — the honest reading is that afleet's projects already do this job and Group mode is
the one of the three modes that could be dropped.

### G-05 · The fleet composer: filter, dispatch, templates, suggestions

**Terminal.** FleetView's bottom composer is dual-purpose: typing filters the list (a "query"),
and `enter` on an empty selection **dispatches a new background session** with the typed text as
its prompt. It carries a subset of the REPL composer: `@` to mention, `!` for bash mode (preview
closed, not simple view, empty query, prompt mode), image paste (`ctrl+v`, or `alt+v` on
Windows/WSL), `ctrl+g` to edit the query in `$EDITOR` (preview closed, not simple view),
`ctrl+j` for newline, and `ctrl+enter` to start and open. `tab` on an empty query with templates
available toggles show-all-agents; `tab` with suggestions applies the picked suggestion. `↑`/`↓`
move focus, except that a plain arrow with the preview closed and a multiline query is forwarded
to the editor; `home`/`end`/`pageup`/`pagedown` jump or page when there are no suggestions and no
composed dispatch. The default agent for a dispatched job when no agent name is typed is the
built-in `claude` agent, whose `whenToUse` says so explicitly (SPEC 39.32.11). `esc` clears a
nonempty query before it does anything else; `ctrl+c` clears the query, leaves bash mode, then
arms exit unconditionally.

**Job.** One box that both finds a session and starts one, so handing off work is as cheap as
typing it.

**Wire.** Dispatch is process spawn, not protocol; afleet spawns `claude` itself for every owned
channel (root spec §6.1). Prompt suggestions are `P` and free: README §5 A-50/36/39/38 records
`--prompt-suggestions` as "free parity not being taken".

**afleet today.** `built` for the search half, `built` for the spawn half, **not unified**.
Cmd+K is the quick switcher over "projects, channels and jobs with fuzzy matching" (root spec
§8.2, region vocabulary §2), and **New channel** is a separate flow from a section header with
project/cwd/worktree, model, permission mode, agent persona and name. So afleet has both jobs but
in two places, where the terminal has one box.

**GUI form.** Keep them separate — this is a deviation with a reason. FleetView fuses them
because it has one input; afleet's New channel flow captures five fields (cwd, worktree, model,
mode, persona) that a one-line prompt cannot, and collapsing it would lose them. What the quick
switcher **should** adopt is the terminal's *dispatch-from-search* affordance as a final row:
when the Cmd+K query matches nothing, the last row reads `Start a new session: "<query>"` and
`enter` opens New channel pre-filled with that prompt and the current project's defaults. Adopt
the built-in `claude` agent as the default persona for that path, matching FleetView. Take
`--prompt-suggestions` (README A-50 says it is free) and render suggestions as rows under the
composer, `tab` to accept — that is the one composer behaviour from this screen worth
transplanting to afleet's own composer, and it is lane D's surface to own. `[exceeds]` the New
channel sheet can show the worktree, the model and the mode before you commit; the terminal
dispatches blind.

**Drops / keeps / gains.** *Drops:* the fused filter/dispatch box, bash mode in the switcher,
`ctrl+g` on the query, the show-all-agents `tab` toggle. *Keeps:* dispatch-from-search, the
default `claude` persona, prompt suggestions with `tab`-to-accept. *Gains:* the spawn form is a
form, with the five fields the terminal cannot ask for.

**Open.** None.

### G-06 · The peek pane

**Terminal.** Selecting a row opens a **peek pane** over the fleet list: the job's recent output
with its own composer, so the user can answer a blocked session without leaving the screen. `→`
on an empty query in prompt mode opens the focused row; `enter` dispatches, opens, expands or
shows-all depending on state; `←` goes back. Inside the pane, `space` on an empty composer
navigates **back**, but deferred by `Bd = 500` ms so a push-to-talk binding can claim the key
first — and if the composer is in bash mode no handler is installed at all, so `space` just
inserts a space (SPEC 39.32.6). `tab` on an empty composer accepts a prompt suggestion. `q` and
`l` (quit / log in) are simple-view keys that require the preview to be **closed**.

**Job.** Answer a session that is blocked without losing your place in the list.

**Wire.** For an afleet-hosted channel this is just the channel. For a foreign job, the transcript
JSONL is the source (README §4 finding 1: `--resume` replays nothing; the JSONL is the only
history) — `R`, disk.

**afleet today.** `superseded` — by clicking a channel. The window shows the list and the
conversation simultaneously, so a peek pane has no job left.

**GUI form.** None. The one behaviour worth carrying is the **deferred `space`**: it exists
because a terminal must overload one key for two purposes. A GUI must not reproduce that, and
should not reproduce the 500 ms delay anywhere. Record it as a terminal-only mechanism.
`[exceeds]` list and conversation side by side, plus multiple windows, is the whole reason the
pane is unnecessary.

**Drops / keeps / gains.** *Drops:* everything. *Keeps:* nothing. *Gains:* no modal peek state to
enter or leave; two channels can be open in two windows.

**Open.** None.

### G-07 · Fleet nudges — the band-transition notifications

**Terminal.** A nudge store outside the view watches band membership and raises **edge-triggered**
OS notifications when a job *enters* a band, with an `idle-seed` suppression so jobs already idle
at first observation do not fire (SPEC 39.32.7). Two messages, both verbatim
(`chunk-jta2pccx.js:376247`, `:376251`):
`` `${label} needs your input: ${needs}` `` — or `` `${label} needs your input` `` when there is no
`needs` text — with `notificationType: "agent_needs_input"`; and
`` `${label} ${outcome === "failure" ? "failed" : "finished"}` `` with
`notificationType: "agent_completed"`. The store also emits a state event carrying
`{ needs_input_count, done_count, succeeded_count, increased }`, so the counts are tracked as a
set, not per-job. Deduplication is per `(sessionId, kind)` — the fleet view "surfaces a job
notification it has not shown before" (SPEC 20.18, `tengu_bg_agent_notification`).

**Job.** Tell the human that a session they are not looking at now needs them, once, without
re-telling them every refresh.

**Wire.** `agent_needs_input` and `agent_completed` are in the `War` notification-type domain
(SPEC 41.20.1, verified in the type list at `cli.pretty.js:818236`). README §5 A-50/36/39/38:
`os_notification` is **dropped** on the wire and "the `Notification` hook is the only complete
channel" (`D`). So afleet raises these itself from its own registry mirror, exactly as FleetView
does from its own — which is the right shape anyway.

**afleet today.** `designed`. Root spec §7.6: "macOS notifications fire for decisions and
completed turns in channels not in view." That is the same two events under different names —
decisions ≈ `agent_needs_input`, completed turns ≈ `agent_completed` — and `App/Notifications/`
plus `App/Activity/ChannelEventPump.swift` are the built seam. What the design does **not** have
is the terminal's two guards: **edge-triggering** and the **idle-seed suppression**.

**GUI form.** macOS `UNUserNotification`, raised from the same band computation as G-03, with the
terminal's copy adopted verbatim as the notification **body**, and the channel name as the title:

| Band transition | Title | Body |
|---|---|---|
| → `blocked` with a `needs` string | channel name | `needs your input: <needs>` |
| → `blocked`, no `needs` string | channel name | `needs your input` |
| → `done`, outcome success | channel name | `finished` |
| → `done`, outcome failure | channel name | `failed` |

Adopt both guards. **Edge-triggered**: fire on the transition into the band, never on the state.
**Idle-seed**: when afleet starts and adopts existing sessions, seed the band state without
firing — otherwise launching the app notifies about every session on the machine, which is the
exact bug the terminal's suppression prevents. Suppress entirely for the channel that is
currently in view and focused (root spec §7.6 already says "not in view"; the terminal has no
concept of "in view" and so cannot). Clicking the notification opens the channel and, for
`agent_needs_input`, scrolls to and focuses the pending decision card. `[exceeds]` afleet knows
which channel is on screen and which window has focus; the terminal knows only that it is the
foreground process.

**Drops / keeps / gains.** *Drops:* the aggregate `{needs_input_count, done_count,
succeeded_count}` state event (afleet's Activity view carries that information continuously).
*Keeps:* the two `notificationType` names as afleet's own event kinds, the four copy variants
verbatim, edge-triggering, idle-seed suppression, per-`(session, kind)` dedup. *Gains:* click
routes to the decision, not just the session; focus-aware suppression; the sidebar badge is the
persistent form of the same signal, so a missed notification is not a lost one.

**Open.** Where does the `needs` string come from for an afleet channel? In canon it is a
short "what I need" phrase from the job's own text. afleet's equivalent is the pending decision's
own title (a permission ask names a tool; a question names the question). Confirm that reading
against a live decision card before shipping the copy.

### G-08 · The agents chip, `← opens agents`, and the `Agents` keyboard scope

**Terminal.** The REPL footer carries an **agents chip** that is the doorway to FleetView
(SPEC 41.15.4). With no agents it renders the dim left-arrow glyph and `for agents` (verified at
`cli.pretty.js:506190`: `[DP, " for agents"]`). With agents it renders the arrow, then a count
clamped to `99+`, then the pluralised noun — coloured `warning` when the aggregate state is
`awaiting`, `success` when `done`, dim when `none` (read at `cli.pretty.js:506202-506212`); SPEC
41.15.4 records the three rendered forms as `← for agents`, `← <n> agents` and `← <n> done`. Two
global-config keys govern the doorway (SPEC 39.32.8): `leftArrowOpensAgents` (left-arrow from the
REPL opens FleetView, default enabled) and `defaultToAgentsView` (bare `claude` opens FleetView),
both exposed in `/config` as `← opens agents` and `open agents view by default` (SPEC 3, at
`chunk-*:5529-5530`). Inside FleetView a dedicated **`Agents` keybinding context** resolves before
`Chat` and `Global`, and exactly two chords are rebindable in it: `ctrl+s` → `agents:switchView`
and `ctrl+t` → `agents:togglePin` (SPEC 42.6.20; the honour-list at SPEC 39.32.10 adds
`chat:externalEditor` and rejects everything else).

**Job.** From inside one conversation, see at a glance that other work exists and how much of it
wants you, and get there with one key.

**Wire.** Local UI state; the count is the host's own registry mirror (`R`, README §5 A-20). The
two config keys are Claude Code's, not afleet's, and afleet does not present Claude Code settings
(root spec §2/§8; the Settings window is "afleet's own settings, not Claude Code's").

**afleet today.** `superseded` — the sidebar *is* the chip, permanently expanded. Root spec §8.2
gives Activity a count of pending decisions at the top of the sidebar, which is the chip's
`awaiting` colour and count in a persistent form.

**GUI form.** No chip. Three things to carry:
1. The chip's **tri-state colour** is the right rule for the sidebar's **Activity row** badge:
   `warning` when any channel is awaiting input, `success` when work has finished unseen,
   neutral/dim otherwise. That is more information than a plain count and costs nothing.
2. The `99+` clamp is worth keeping verbatim on every count badge in the sidebar.
3. The two config keys are **out of scope** for afleet's Settings (they configure the `claude`
   binary's own home screen, which afleet never shows). Record them here so the map shows the
   full denominator; do not build a row.
The `Agents` keyboard scope has no GUI analogue — a GUI's "scope" is focus, and the sidebar's
keyboard scope is already whatever SwiftUI focus gives it. The two rebindable actions map to
menu-bar items (View ▸ Grouping, for `agents:switchView`; and a Pin item on the channel menu),
which is where afleet should be putting keyboard shortcuts generally.

**Drops / keeps / gains.** *Drops:* the chip, the `Agents` scope, `leftArrowOpensAgents`,
`defaultToAgentsView`. *Keeps:* the tri-state colour rule, the `99+` clamp, `switchView` and
`togglePin` as the two actions worth a shortcut. *Gains:* the fleet is always visible, so the
"how much wants me" signal never needs a key at all.

**Open.** None.

### G-09 · `claude agents --json` and the non-TTY refusal

**Terminal.** `claude agents` is registered with the description `Manage background agents` and
refuses a non-TTY stdout with (SPEC 39.32.2, `chunk-p61gzb13.js:445116`):
`requires an interactive terminal (stdout is not a TTY) — use 'claude agents --json' for a
machine-readable listing`. There is no `--fleet` flag, no `fleet` subcommand and no `teams`
subcommand anywhere in the bundle. While FleetView is open it holds a lease on the background
supervisor labelled `claude agents`.

**Job.** Give a non-terminal consumer the same list the screen shows.

**Wire.** This *is* afleet's route into the fleet it does not host. Root spec §9.5: "The
Background section reads the roster and `claude agents --json`, and drives jobs through the CLI
verbs `stop`, `attach`, `logs`, `rm`, `respawn`." Classification `R` via process, not protocol.

**afleet today.** `designed`. Root spec §9.5 names the read and the five verbs; the split by
"whether they produce a screen" was decided 2026-09-05 with C7's cut — `attach` and `logs` run in
a Terminal pane, `stop`/`respawn`/`rm` are one-shot lifecycle actions with no PTY. No code in
`App/Fleet/` reads it yet.

**GUI form.** Not a surface; a data source. Two things the card fixes: (a) afleet should not hold
the `claude agents` supervisor lease — it is not FleetView and taking the lease would contend with
a user's own terminal; (b) the `--json` shape is the schema the sidebar's foreign-job rows are
built from, so the naming chain (G-02) and band assignment (G-03) must be derivable from it or
fall back gracefully. Poll it on the terminal's own slow cadence (`30000` ms from SPEC 39.32.9's
refresh constants) rather than inventing one, and refresh on window focus.

**Drops / keeps / gains.** *Drops:* the CLI surface. *Keeps:* the 30 s cadence, the five verbs.
*Gains:* the list is live and merged with afleet's own channels rather than a snapshot.

**Open.** Does `claude agents --json` carry enough for the naming chain and the artifact badge, or
only ids and states? Nothing in `docs/tui-parity/` records its shape. **A probe answers this** —
run `claude agents --json` with a background job live and record the fields.

