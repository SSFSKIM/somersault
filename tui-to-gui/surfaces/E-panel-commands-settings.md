# Lane E — the settings-type panel commands

**Date:** 2026-09-09. **Canon:** Claude Code 2.1.263 (`/Users/new/claude-code-bundle/2.1.263/`).

The terminal implements roughly fifty of its slash commands as `local-jsx` panels — full-screen
Ink dialogs that read or write configuration. None of them exists on the headless wire. This lane
translates the ones that are *settings-shaped*: `/config`, `/permissions`, `/mcp`, `/hooks`,
`/plugin`, `/skills`, `/memory`, `/theme`, `/output-style`, the model and turn-shaping pickers,
`/sandbox`, `/add-dir`, `/cd`, `/agents`, the auth and account commands, and the environment and
client commands.

## What was read

**SPEC 263 chapters:** `41-tui-rendering.md` §41.22.1 (the lazy dialog registry — the 74-panel
denominator), §41.26.1–41.26.4 (`/config` in full), §41.10.5 (`/theme`); `24-permission-system.md`;
`31-mcp-client.md`; `27-hooks.md`; `30-plugins-and-marketplaces.md`; `29-skills.md`;
`32-output-styles.md`; `10-memory-and-instructions.md`; `18-agent-tool-and-subagents.md`;
`06-models-and-selection.md`; `17-sandbox.md`; `23-session-and-utility-tools.md`;
`08-auth-and-credentials.md`; `49-updates-and-diagnostics.md`; `28-slash-commands.md` §5;
`33`, `36`, `37`, `38`, `46`, `47`.

**afleet:** root spec `docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md` §7.7 (router
table + launch-settings matrix), §8.6 (bypass), §13 (known gaps), §17.8 (deferred / out of scope),
§7.8 (the store, and the never-write-under-configHome rule);
`2026-09-06-c5-app-shell.md` §9 (Settings);
`2026-09-08-c6.2-composer.md` *The pickers, and readbacks over clicks*, *The bypass gate*,
*The header's menus and actions*;
`App/Views/SettingsView.swift`; `App/Header/SettingPickers.swift`, `HeaderMenus.swift`,
`BypassGate.swift`, `RestartRequiredSettings.swift`, `ChannelHeaderActionsModel.swift`;
`FleetKit/Sources/FleetSessions/Router/CommandRouter.swift` and `RouterTable.swift` (contract X10);
`docs/tui-parity/README.md` §4 findings 6, 7, 12, 13, 14, 18 and §5 rows A-28, A-24/21, A-31/27,
A-30/29/32, A-03/49/35, A-06/08/02, A-33/34/43/44; `docs/tui-parity/areas/28-slash-commands.md`
and `areas/41-tui-rendering.md` §41.26.

**somersault clone:** `CC-to-SDK/docs/parity/tui-ux.md` §4 rows *SettingsDialog*, *PermissionsDialog*,
*ThemeDialog*, *AddDirDialog*, *Model picker*, *Effort dialog*; §5 slash-command rows; the W3
divergence notes.

**Verification spent** (`cli.pretty.js` at 2.1.263): `Config dialog dismissed` (:392342),
`Settings dialog dismissed` (:394969 — a *second*, distinct string SPEC 41.26 does not mention),
`Search settings…` / `No settings match "` / `cancelHint: "Escape to save and close"` (all :392590),
`Changing thinking mode mid-conversation…` and the seven-entry theme label map `Gd` (:392623).

**Denominator additions.** Two surfaces the task prompt did not list but that belong to this lane
and are carded: the outer four-tab `Settings` dialog shell that `/config` actually opens (its
`Status`/`Usage`/`Stats` tabs hand off to other lanes, but the shell and its dismissal string are
mine), and `/cloud-plugins`, which the prompt names only inside the `/plugin` bullet but which is
a separate registry entry with its own persistence.

## Headline

1. **afleet has no Claude Code settings surface at all.** `App/Views/SettingsView.swift` is five
   sections of afleet's own diagnostics — Environment, Engine, Config home, Storage, Developer
   (C5 §9). Not one of `/config`'s 60 rows, and nothing from `/permissions`, `/hooks`, `/plugin`,
   `/skills` or `/agents`, appears anywhere in the app. The whole family is `undesigned` or
   `routed-only`. This lane's proposal is a sixth top-level section, **Claude Code**, with four
   panes (Defaults, Permissions, Extensions, Account), plus a per-channel Overrides sheet.
2. **The write ceiling, not the row list, is the architecture.** Five write classes, and every row
   must name which one it uses: session control request; `update_settings` (exactly one key,
   `outputStyle` — tui-parity finding 7); the headless `/config key=value` text command (37 keys,
   enumerated at `areas/41-tui-rendering.md` §41.26); a `claude` CLI subprocess; or "open the
   file", because root spec §7.8's X9 forbids afleet writing under `<configHome>`. A GUI that
   hides this ceiling will show the user a switch that silently does nothing.
3. **`/config`'s 60 rows do not survive as one list, and should not.** Sorted by what the row
   governs rather than by upstream's eight section headers: 20 are persisted engine preferences
   that belong in the Settings window, 8 are per-channel session state the header pickers already
   carry, 16 are terminal-rendering preferences afleet supersedes outright, and 16 are
   out-of-scope (cloud, Remote Control, teammate mode, IDE, API key). Faithfulness means keeping
   each row's label, value domain and lock reason — not its position in a scrolling list.
4. **`/permissions` is the largest build in the lane and the clearest place the GUI wins.**
   `RouterTable` routes bare `/permissions` to `.permissionsView`, `StrategyExecutor` builds a
   `PermissionsView` from `get_settings` — and nothing in `App/` consumes it. The wire cannot
   enumerate merged effective rules with provenance (A-24/21: X plus D), so afleet must re-merge
   the settings files itself; having done that it can offer hover-to-reveal-source, click-to-open
   the owning file, and cross-channel rule search, none of which fits an 80-column dialog.
5. **`/mcp` is built but shrunk to two columns.** `HeaderMenus.swift`'s `MCPServerList` shows name
   and status text and nothing else. The eight `mcp_*` control requests behind it are the richest
   control-request coverage in the protocol (A-31/27) and not one of reconnect, toggle,
   authenticate, clear-auth or the permission-mode override is wired. Highest value per unit cost
   in this lane.
6. **The per-channel pickers keep the readback discipline and drop every explanatory string.**
   `SettingPickers.swift` renders three bare `Menu`s of raw values. Against the terminal the model
   picker loses its per-model descriptions, its `Select model` header, its default-for-new-sessions
   toggle and its `… +N models` overflow counter; the effort menu loses the five-glyph ladder, the
   level descriptions and the `max` caveat (clone rows *Model picker* and *Effort dialog*, both
   byte-verified). These are cheap to restore and are what makes a picker legible.
7. **The refusal copy is a product surface, and today it has three rows.**
   `RouterTable.terminalOnlyReasons` covers `/doctor`, `/color` and `/reload-plugins`; everything
   else falls to one generic sentence about a screen afleet has no equivalent of. About forty
   panel commands land there. Each needs its own line saying what afleet does instead — that is
   most of the copy work in this lane, and it is what stops the app feeling like a subset.

## A. The settings architecture, and `/config`

### E-01 · Where Claude Code settings live inside afleet

**Terminal.** There is no such thing as "the Claude Code settings surface" in the terminal. There
are seventeen separate panels, each owning a slice: `/config` owns 60 preference rows across four
tabs (SPEC 41.26.1), `/permissions` owns the rule stack (SPEC 24 §24.19), `/mcp` owns servers
(SPEC 31 §18), `/hooks` is a read-only viewer (SPEC 27 §21), `/plugin` and `/skills` own the
extension registries, `/memory` owns the instruction files, and `/model`, `/effort`, `/theme` and
`/output-style` own one row each — three of which `/config` *also* owns, opening the same
sub-dialog (`Theme`, `Model`, `OutputStyle` are `managedEnum` rows whose activation opens the
picker, SPEC 41.26.4). The terminal's own hint copy admits the duplication: the `theme` row reads
`For custom themes, use /theme.`, the `model` row `For a specific model ID, use /model.`, and
`/output-style` is now a stub whose whole body is `Output style moved to /config`
(`areas/28-slash-commands.md` row `/output-style`).

**Job.** A user needs to answer four different questions and the terminal makes them one screen
each: *what is this channel running right now* (model, mode, effort), *what will the next channel
start with* (defaults), *what is installed and connected* (MCP, plugins, skills, hooks, agents),
and *who am I signed in as*. Losing these loses control of the engine entirely — you can talk to
Claude but not configure it.

**Wire.** Reading is nearly complete, writing nearly absent (README §5, A-03/49/35). `get_settings`
returns `effective`, `applied` and `sources`; `update_settings` writes exactly one key,
`outputStyle`, into `localSettings` (`T_ = new Set(["outputStyle"])`, README finding 7); the
headless `/config key=value` text command writes 37 more through the CLI itself; everything else is
a file the app is forbidden to write (root spec §7.8: *the app never writes to `<configHome>`*).
There is **no settings-change frame** — external edits are picked up in about 1.5 s but silently
(A-03/49/35), so every readback is a poll.

**afleet today.** `undesigned` for the whole engine half. `App/Views/SettingsView.swift` implements
C5 §9's five sections and they are all about afleet: Environment (shell, capture mode, PATH count),
Engine (binary path, installed version, protocol baseline, gate verdict, last census, unknown frame
count), Config home (root, source, project and transcript counts), Storage (schema status per
namespace, *Delete diagnostics*), Developer (binary override, raw frame capture, transcript watcher,
isolated settings, web inspector, reveal log). Nothing reads or writes a Claude Code setting. The
only engine settings afleet touches are the three header pickers (C6.2 *The pickers*) and the
`/config` text pass-through in `RouterTable` (`.text`, explanation
`Runs in the engine; the persisted setting is read back with get_settings.`).

**GUI form.** Three surfaces, one model, and the division between them is the *lifetime* of the
value, not its subject matter.

1. **Settings window → a new top-level section `Claude Code`**, sibling to the five afleet
   sections, with four panes: **Defaults** (the `/config` preference rows that afleet honours),
   **Permissions** (E-08…E-13), **Extensions** (MCP, plugins, skills, hooks, agents — E-14…E-23,
   E-37), **Account** (E-38…E-43). Every pane carries the same scope control at the top —
   `User · Project · Local · Managed` — because a Claude Code setting is never one value; it is a
   stack, and the terminal only ever shows the winner plus a lock reason.
2. **Per-channel header pickers**, where they already are: model, effort, permission mode, plus a
   fourth for output style. These are *readbacks of this channel's session state* and write through
   control requests. They gain the terminal's own default-promotion affordance — a
   `Set as default for new channels` checkbox inside the popover, which is the terminal's `s`
   chord in the model picker (clone row *Model picker*, byte-verified) and is exactly what keeps
   session state and persisted preference from being confused.
3. **A per-channel Overrides sheet** from the header's Channel menu, for the launch-time settings a
   channel carries that the window cannot change: the `--add-dir` list, cwd, prompt suggestions,
   `--setting-sources`, the bypass flag. These are root spec §7.7's `restartRequired` class, already
   modelled as `LaunchSettingMatrix.restartRequired` in `RouterTable.swift`; the sheet marks each
   row with its restart cost and funnels through one `RestartRequest`, which is what
   `App/Header/RestartRequiredSettings.swift` already exists to do.

**How a write happens — five classes, and the row says which.** Every row in the Claude Code
section carries a trailing badge naming its write route, because the ceiling is not something the
user can be expected to infer:

| Class | Badge | Mechanism | Rows it covers |
|---|---|---|---|
| 1 · Session request | *(none — applies immediately)* | `set_model`, `set_permission_mode`, `apply_flag_settings` | model, effort, mode, agent, fastMode |
| 2 · Local settings | *(none)* | `update_settings {source: "localSettings"}` | `outputStyle`, and nothing else (finding 7) |
| 3 · Engine text | `via engine` | `/config key=value` sent as text down a live channel; the CLI writes the user settings file | the 37 keys of `areas/41-tui-rendering.md` §41.26 |
| 4 · CLI subprocess | `via claude` | `claude mcp …`, `claude plugin …`, `claude auth logout` | MCP servers, plugins, sign-out |
| 5 · File | `Open file` | afleet opens the owning settings file in the Files panel and reveals the key; the user edits and saves | the 22 non-headless `/config` keys, hooks, permission rules outside `localSettings` |

Class 3 has a cost the terminal never pays: it needs a live channel, it puts a turn-shaped exchange
into that channel's timeline, and no frame announces the result, so afleet must re-read with
`get_settings` afterwards. The proposal is that afleet keeps **one settings channel per config
home** — a hidden session, spawned on demand and reaped when the window closes — so class-3 writes
never appear in a conversation the user is having. The cheaper fallback is to send it down the
focused channel and render the exchange as a notice row rather than a message; that is a taste
call and it is in *Open* below.

**What the user sees when a row cannot be written from afleet.** Never a dead switch. The row
renders its value, a source line, and the affordance that *can* change it. Three states, modelled
on the terminal's own indented dim reason line (SPEC 41.26.3), which `areas/41-tui-rendering.md`
§41.26 names as one of exactly two things worth copying from that panel:

| State | Rendering |
|---|---|
| Locked by managed settings or policy | value greyed, `🔒 Managed`, and the reason line underneath naming the managed settings path. The control is inert and says why. |
| Writable only on disk (class 5) | value shown, trailing `Open file` button that reveals the key in the Files panel. |
| Not meaningful in afleet | the row does not appear in Defaults at all; it appears in a collapsed **Not used by afleet** disclosure at the foot of the pane, with one line saying what afleet does instead. Hiding it outright would make the app look like it had lost a setting; showing it as a live control would be a lie. |

```
┌─ Settings ──────────────────────────────────────────────────────────────────────┐
│ ┌────────────────┐ ┌──────────────────────────────────────────────────────────┐ │
│ │ AFLEET         │ │  Claude Code › Defaults                                  │ │
│ │  Environment   │ │  ┌────────────────────────────────────────────────────┐  │ │
│ │  Engine        │ │  │ Scope  (•User)  Project   Local   Managed          │  │ │
│ │  Config home   │ │  │ ⌕ Search settings…                                 │  │ │
│ │  Storage       │ │  └────────────────────────────────────────────────────┘  │ │
│ │  Developer     │ │                                                          │ │
│ │                │ │  CONVERSATION                                            │ │
│ │ CLAUDE CODE    │ │  Auto-compact                           [on ]            │ │
│ │ ▸ Defaults     │ │  Thinking mode                          [on ]  via engine│ │
│ │   Permissions  │ │    ⚠ Changing thinking mode mid-conversation will        │ │
│ │   Extensions   │ │      increase latency and may reduce quality.            │ │
│ │   Account      │ │  Rewind code (checkpoints)              [on ]  via engine│ │
│ │                │ │  Session recap                          [off]  via engine│ │
│ │                │ │                                                          │ │
│ │                │ │  MODEL & OUTPUT                                          │ │
│ │                │ │  Model                    (Sonnet 5   ⌄)       via engine│ │
│ │                │ │  Output style             (default    ⌄)                 │ │
│ │                │ │  Default permission mode  (default    ⌄)  🔒 Managed     │ │
│ │                │ │    Set by managed settings at /Library/Application       │ │
│ │                │ │    Support/ClaudeCode/managed-settings.json              │ │
│ │                │ │  Question auto-continue timeout   never       Open file  │ │
│ │                │ │                                                          │ │
│ │                │ │  ▸ Not used by afleet (16)                               │ │
│ └────────────────┘ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.**
*Drops:* the single scrolling 60-row list and its enum-cycling-on-Enter activation; the eight
upstream section headers (gated off by default anyway — `hpe()` returns
`H("tengu_maple_sundial", false)`, SPEC 41.26.1).
*Keeps:* every row's label verbatim, its value domain, its lock reason line, the search box, the
thinking-mode warning, and the change record on close.
*Gains:* `[exceeds]` a scope switcher — the terminal shows one merged value and a lock reason;
afleet can show the whole stack. `[exceeds]` a persistent window rather than a modal that steals
the screen. `[exceeds]` per-row provenance with click-through to the owning file.

**Open.**
- Hidden settings channel versus writing down the focused channel: which pollution is worse? Owner.
- Should the Claude Code section be per-config-home (afleet supports `CLAUDE_CONFIG_DIR`) or
  global? The Settings window today is global; `Config home` is one of its five sections, so a
  second config home is already conceivable.
- A probe is needed to confirm that `/config key=value` sent to a channel with no model configured
  still writes (the settings channel would have no useful model).

### E-02 · The `/config` dialog shell: four tabs, search, footers, close record

**Terminal.** `/config` (alias `/settings`) opens a four-tab dialog — `Status`, `Config`, `Usage`,
`Stats` — titled `Settings` (SPEC 41.26.1). Tab switching uses the `Tabs` keyboard scope. The
Config tab is the row registry; by default it renders in registry order with no section headers,
and only when the `tengu_maple_sundial` gate is on does it sort into eight sections
(`Appearance`, `Model & output`, `Display`, `Input & controls`, `Connections`, `Advanced`,
`Experimental`, `Internal`), with `Advanced` rendered as `ADVANCED — MOVING TO SETTINGS.JSON` when
the focused row is one of the five migration members (SPEC 41.26.1). The label column is
`min(44, max(14, availableWidth - 16))`; the selection glyph is `❯`; policy-locked rows show an
indented dim reason line and migrating rows are marked `→ settings.json` (SPEC 41.26.3). Search box
placeholder `Search settings…`, empty state `No settings match "<q>"`, scroll indicators
`↑ N more above` and `↓ N more below`; the cancel hint is `Escape to save and close`
(verified in `cli.pretty.js:392590`). Three footer states — navigation (`←/→/tab to switch`,
`down to return`, `Esc to close`), filtering (`Type to filter`, `enter/down to select`,
`up to tabs`, `Esc to clear`) and editing, whose first chord is lock-dependent:
`enter/space to change` when unlocked, `enter/space to retry` when `lock.source === "policy"`, and
**omitted entirely** for any other lock source, so the footer starts at `/ to search`
(SPEC 41.26.3). Activation: Enter, space, left, right and tab all fire the focused row; a boolean
toggles in place; a plain enum *cycles* to the next option; a `managedEnum` or `pickToCommit` enum
opens one of eleven sub-dialogs — `Theme`, `Model`, `RemoteHomeSettings`, `ExternalIncludes`,
`OutputStyle`, `Language`, `AgentsView`, `Notifications`, `EnumPicker`, `EnableAutoUpdates`,
`ChannelDowngrade` (SPEC 41.26.4). Any printable key seeds the search box. Under
`CLAUDE_CODE_ACCESSIBILITY` the list is replaced by a numbered form prompting
`Enter a number to change [1-N], or <key>:` and rejecting bad input with
`Invalid selection "<x>". Enter a number between 1 and N.` (SPEC 41.26.3). On close the panel
emits a **system message** summarising what changed — `Set theme to <name>`,
`Set editor mode to <mode>`, an enabled/disabled line for auto-compact — or
`Config dialog dismissed` when nothing changed (SPEC 41.26.4, verified `cli.pretty.js:392342`).
The outer dialog has a second, distinct dismissal string, `Settings dialog dismissed`
(verified `cli.pretty.js:394969`), which SPEC 41.26 does not mention; the clone found the same
split and left its own header-focus mode unbuilt (tui-ux.md W3 divergences).

**Job.** One place to find and change any engine preference, with search when you do not know the
name, and a record in the conversation of what you changed.

**Wire.** R. The dialog itself is unreachable (`local-jsx`, refused headless); the *capability* is
`get_settings` for reading and the two write routes of E-01. `areas/41-tui-rendering.md` §41.26
classifies the whole panel R and singles out two things to copy: the policy-locked reason line and
search-as-you-type.

**afleet today.** `undesigned`. `/config` is in `RouterTable.local` with strategy `.text`, so a
typed `/config key=value` reaches the engine and works; a bare `/config` also goes as text and
prints the settable-key list, which `areas/28-slash-commands.md` notes is a usable substitute for
the lost `getArgumentCompletions`. Nothing renders a panel.

**GUI form.** The Defaults pane of E-01, not a modal. Concretely:
- **Tabs.** `Status`, `Usage` and `Stats` are not settings and belong to other lanes' surfaces
  (`/status` reconstruction, the context meter, `/cost`). The Claude Code section carries only the
  Config tab's content; a small `View session status →` link at the foot of Defaults sends the user
  to the channel header's status readouts rather than duplicating them.
- **Search.** Keep `Search settings…` verbatim as the field placeholder and
  `No settings match "<q>"` verbatim as the empty state. Scoped to the pane, filtering on label
  *and* setting key (`[exceeds]` — the terminal filters the rendered label only, so a user who
  knows `autoCompactEnabled` cannot find `Auto-compact`).
- **Activation.** Booleans are `Toggle`s. Plain enums are pop-up buttons, **not** cycling controls:
  cycling on Enter is a terminal affordance for a surface with no pointer, and
  `areas/41-tui-rendering.md` §41.26 says so directly. Named deviation.
- **Sections.** Use the eight upstream section names as the pane's group headers even though the
  terminal keeps them behind a gate, because a 60-row unheaded list is a terminal compromise, not a
  design. Drop `Internal`; fold `Experimental` into a disclosure.
- **Lock reason.** Keep the indented reason line verbatim under the row, and keep the distinction
  the footer encodes: a `policy` lock is *retryable* (the terminal offers `enter/space to retry`),
  any other lock is not. In the GUI, a policy-locked row keeps a live control with a `Retry` action;
  a managed-settings lock renders inert.
- **Close record.** Keep it. `areas/41-tui-rendering.md` §41.26 calls putting settings changes into
  the transcript "a nice touch worth keeping — it gives the model and the user a record", and it is
  the only mechanism that tells a *running* channel that a setting moved. afleet posts one notice
  row per changed setting into every affected channel, using the terminal's own sentence shape
  (`Set <label> to <value>`). No row is posted when nothing changed — afleet drops both
  `Config dialog dismissed` and `Settings dialog dismissed`, because a window that is always open
  has no dismissal event. Named deviation.
- **Accessibility.** macOS accessibility replaces the numbered-form variant wholesale. The one
  behaviour worth carrying is the knock-on `areas/41-tui-rendering.md` line 118 records: under the
  terminal's accessibility flag, lists get a keyboard-numbered alternative to pointer selection.

**Drops / keeps / gains.**
*Drops:* the modal frame, the tab chrome, enum cycling, the two dismissal strings, the numbered
accessibility form, the `→ settings.json` migration marker (the migration is a CLI-internal move
between `~/.claude.json` and `settings.json`, SPEC 03 §18.3 — afleet writes neither).
*Keeps:* row labels, value domains, search copy, the lock reason line, the policy/other lock
distinction, the thinking warning, the change record's sentence shape.
*Gains:* `[exceeds]` search over keys as well as labels; `[exceeds]` the pane stays open while the
user works, so a setting can be changed against a live channel and its effect watched.

**Open.** Does a settings change deserve a timeline notice row in *every* affected channel, or one
Activity-view entry? The terminal has one screen so the question does not arise.

