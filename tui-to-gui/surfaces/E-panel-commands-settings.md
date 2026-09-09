# Lane E — the settings-type panel commands

**Date:** 2026-09-10 (first cut 2026-09-09; this file is the completed lane).
**Canon:** Claude Code 2.1.263 (`/Users/new/claude-code-bundle/2.1.263/`).
**Cards:** 56, `E-01` … `E-56`, in eleven sub-families.

The terminal implements roughly fifty of its slash commands as `local-jsx` panels — full-screen Ink
dialogs that read or write configuration — and **none of them exists on the headless wire**. This
lane translates the ones that are *settings-shaped*: `/config`, `/permissions`, `/mcp`, `/hooks`,
`/plugin`, `/skills`, `/memory`, `/theme`, `/output-style`, the model and turn-shaping pickers,
`/sandbox`, `/add-dir`, `/cd`, `/agents`, the auth and account commands, and the environment and
client commands. Lane A owns colour application and `/statusline`; lane C owns `/vim`,
`/keybindings` and `/terminal-setup`; lane D owns the decision cards these settings govern; lane G
owns the agent *run* surfaces (this lane owns agent *definitions*).

## What was read

**SPEC 263 chapters.** `41-tui-rendering.md` §41.22.1 (the 74-entry lazy dialog registry — the
denominator), §41.26.1–41.26.4 (`/config` in full, including the 60-row registry), §41.10.5
(`/theme`); `24-permission-system.md` (§24.5.1 grammar, §24.8.1 precedence, §24.9 validation,
§24.12 workspace directories, §24.15 persistence, §24.19 the dialog); `31-mcp-client.md` (§3 scopes,
§6.1 project approval, §8.7 state machine, §10 auth and the needs-auth cache, §11.5 tool policy,
§18 the panel); `27-hooks.md` (§2 the 33 events, §6.1 sources, §20 the seven disable switches, §21
the viewer); `30-plugins-and-marketplaces.md` (§10 `enabledPlugins`, §13 updates, §22 trust, §25.1
the CLI, §27 the panel and `/reload-plugins`, `/cloud-plugins`, §30.1 the error variants);
`29-skills.md` (§5.1 discovery, §16.1 the four override states, and the `/skills`, `/reload-skills`,
`/skill-doctor` sections); `32-output-styles.md` (§32.3, §32.4.1, §32.7.3, §32.11, §32.12.2);
`10-memory-and-instructions.md` (§10.3.3 discovery, §10.5 imports, §10.24 the picker and the `#`
negative); `18-agent-tool-and-subagents.md` (§18.8 discovery and frontmatter, §18.30.1 the removal);
`06-models-and-selection.md` (the model and effort domains); `17-sandbox.md`;
`23-session-and-utility-tools.md`, plus `03-settings-and-configuration.md` §17.7 and
`11-query-loop-and-messages.md` §11.9.18 where `/add-dir` and `/cd` actually live;
`08-auth-and-credentials.md` (§3.1, §4.7, §8.7, §12, §23.1); `48-enterprise-and-policy.md` (§12.8,
§13, §15, §16); `49-updates-and-diagnostics.md` §49.28.1; `28-slash-commands.md` §5 (the catalogue),
§8.1 and §22 (the three refusal strings); `33`, `36`, `37`, `38`, `42`, `44`, `45`, `46`, `47`.

**afleet.** Root spec `docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md` §3 (scope),
§6.2, §6.4, §6.12 (project MCP consent), §7.4, §7.6 (the banners), §7.7 (the router table and the
launch-settings matrix), §7.8 (the store and X9), §8.1–8.2, §13, §17.8; `2026-09-06-c5-app-shell.md`
§9 (Settings); `2026-09-08-c6.2-composer.md` *The pickers, and readbacks over clicks*, *The bypass
gate*, *The header's menus and actions*; `2026-09-07-c6-conversation-surface.md` (C6.4, the Agents
tab). Code: `App/Views/SettingsView.swift`, `App/Header/{SettingPickers,HeaderMenus,BypassGate,
RestartRequiredSettings,ChannelHeaderActionsModel}.swift`, `App/Composer/CommandRouting.swift`,
`App/Consent/ConsentSheet.swift`, `App/Decisions/{DecisionCard,DialogCardView,PermissionCardView,
DecisionAnswerMapping}.swift`, `App/Activity/{ActivityQuery,ActivityModel}.swift`,
`App/Agents/AgentNavigation.swift`, `App/Timeline/Rendering/Rows/NoticeRows.swift`,
`App/Views/UpgradeView.swift`, `FleetKit/Sources/FleetSessions/Router/{RouterTable,CommandRouter,
LogoutPlan}.swift`, `FleetKit/Sources/FleetSessions/Preconditions/{ProjectMCPConsent,
SpawnPreconditions,LocalSettingsStore}.swift`, `FleetKit/Sources/FleetSessions/Fleet.swift`,
`FleetKit/Sources/FleetTimeline/Reduce/{WireReducer,Overlay}.swift`,
`ClaudeWire/Sources/WireFrames/{OutboundRequests,SystemFrames,InboundRequests,OtherFrames}.swift`,
`ClaudeWire/Sources/WireTransport/{InitializeConfiguration,LaunchConfiguration}.swift`.
Parity: `docs/tui-parity/README.md` §4 findings 6, 7, 12, 13, 14, 18 and §5 rows A-28, A-24/21,
A-31/27, A-30/29/32, A-03/49/35, A-06/08/02, A-33/34/43/44; `areas/41-tui-rendering.md` §41.26,
`areas/24-21-permissions-plan-questions.md`, `areas/31-27-mcp-hooks.md`,
`areas/30-29-32-plugins-skills-styles.md`, `areas/13-10-23-context-memory-session-tools.md`,
`areas/18-agents-subagents.md`, `areas/06-08-02-models-auth-bootstrap.md`,
`areas/15-16-17-file-bash-sandbox.md`, `areas/46-19-48-37-chrome-web-enterprise-cloud.md`,
`areas/50-36-39-38-notifications-remote-teams-daemon.md`, `areas/33-34-43-44-ide-lsp-voice-artifacts.md`,
`areas/28-slash-commands.md`, `areas/03-49-35-settings-diagnostics-sessions.md`,
`docs/tech-debt-tracker.md` item 206, and `evidence/2026-09-03-*`.

**somersault clone.** `CC-to-SDK/docs/parity/tui-ux.md` §4 rows *SettingsDialog*,
*PermissionsDialog*, *ThemeDialog*, *AddDirDialog*, *Model picker*, *Effort dialog*, §5
slash-command rows, the W3 divergence notes and the bl10 close-out; `docs/parity/command-coverage.md`;
`harness/src/tui/PermissionsDialog.tsx` and `harness/test/tui/permissions-dialog.test.tsx`.

**Verification spent** (`cli.pretty.js` at 2.1.263, ~45 literals across the lane; the file's line
numbers are global and match the SPEC's `chunk-*.js:NNNN` citations, which made this cheap). The
load-bearing ones: `Config dialog dismissed` (:392342) and the second, undocumented
`Settings dialog dismissed` (:394969); `Search settings…` / `No settings match "` /
`Escape to save and close` (:392590); the thinking warning and the theme label map (:392623);
the permissions dialog title (:13104), its six tabs (:13058–13098), its four footers (:13109), the
destination options and **the `Saved in at ~/.claude/settings.json` typo** (:10609), the delete
confirm (:12351), the workspace add's always-session destination (:13003); `Manage MCP servers`
(:483933), `connected · session token rejected` (:483976, :382921), the ten menu labels
(:383146–383172), the project-approval dialog (:290079), `Skipping connection (cached needs-auth)`
(:68588); the `/hooks` read-only line (:853460), its empty state (:853527, :853592) and
`Hook configuration · disabled` (:854001); the `/plugin` and `/reload-plugins` command objects
(:788504), the trust disclaimer (:381037), `/reload-plugins isn't available over a remote
connection` (:197780); the whole `/model` picker chrome including `… +N models` (:502349, :1013,
:502359), the effort help table (:271747) and its picker rows (:591483), the effort **track**
(:225421); `/sandbox`'s status getter (:788527) and its platform probes (:475362, :475377);
`set_cwd: invalid request — trust_accepted requires trusted_directory` (:251771) and `Moved to`
(:579499); the skills empty state (:262311) and the `skillOverrides` describe (:233888); the theme
list (:536296), `New custom theme…` (:536303), the subtitle (:536317) and the `demo.js` preview
(:536373); the output-style tombstone (:349475); the `/agents` removal notice (:788497); the eleven
`API Error` auth sentences (:723139); `/daemon`'s `return !1` gate (:164786).

## Denominator, and what was added

Every item the task prompt lists is carded. Six additions, each flagged in its card:

1. **The outer four-tab `Settings` dialog shell** that `/config` actually opens (E-02) — its
   `Status`, `Usage` and `Stats` tabs hand off to other lanes, but the shell and its second,
   separate dismissal string are this lane's.
2. **`/cloud-plugins`** (E-27), named by the prompt only inside the `/plugin` bullet but a separate
   registry entry with its own persistence file.
3. **`/reload-skills` and `/skill-doctor`** as a card of their own (E-38) rather than a clause.
4. **The `/config` sub-dialogs with no command of their own** (E-07) — `Language`, `Notifications`,
   `EnumPicker`, `EnableAutoUpdates`, `ChannelDowngrade`, `ExternalIncludes`, `RemoteHomeSettings`.
5. **`/passes` and `/powerup`** share a card (E-33); the prompt lists them under the model bullet
   but neither is a picker.
6. **`/daemon`** (E-56), which the prompt lists and which turns out to ship with its gate hard-wired
   off — a card that documents an unreachable surface afleet has already replaced.

Two prompt premises did not survive contact with 2.1.263 and are corrected in place: **`/agents`
has no management panel** (the wizard was removed; E-42 rebuilds it as a deliberate product
decision rather than a port), and **there is no `#` quick-memory shortcut or destination picker**
(SPEC 10 §10.24.3 records the negative; E-39 says so and builds nothing).

## Headline

1. **afleet has no Claude Code settings surface at all, and the whole family is unbuilt.**
   `App/Views/SettingsView.swift` is five sections of afleet's own diagnostics (C5 §9). Not one of
   `/config`'s 60 rows, and nothing from `/permissions`, `/hooks`, `/plugin`, `/skills` or the
   agent definitions, appears anywhere in the app. The proposal is a sixth top-level section,
   **Claude Code**, with four panes — Defaults, Permissions, Extensions, Account — plus a
   per-channel Overrides sheet for the launch settings a restart owns (E-01).
2. **The write ceiling, not the row list, is the architecture.** Five write classes, and every row
   must name which one it uses: a session control request; `update_settings`, which accepts
   **exactly one key, `outputStyle`**, into `localSettings` (README finding 7); the headless
   `/config key=value` text command, good for 37 of the 60 rows; a `claude …` subprocess; or "open
   the file", because root spec §7.8's X9 forbids afleet writing under `<configHome>`. A GUI that
   hides this ceiling ships switches that silently do nothing. The sharpest consequence is in the
   permissions destination picker (E-10): afleet may write project and project-local settings — it
   already writes one such file — and may **not** write user settings, so the third destination
   needs a real alternative rather than a disabled radio button.
3. **`/permissions` is the largest build in the lane, and today it prints your model.**
   `RouterTable.swift:37` routes the bare form to `.permissionsView`, `CommandRouter.swift:366`
   builds one from `get_settings`, and its single consumer,
   `App/Composer/CommandRouting.swift:435-437`, renders `4 applied setting(s): advisor, effort,
   model, ultracode.` — so typing `/permissions` in afleet shows your model and effort under a
   permissions heading. Already logged as tech-debt item 206. The GUI wins big here: the terminal
   hides provenance until you select a row and never explains why a rule did not fire, and both are
   computable from `get_settings.sources[]` (E-08, E-09).
4. **`/mcp` is the best value-per-cost in the lane: eight control requests built, seven with no
   caller.** `App/Header/HeaderMenus.swift:71-92` renders a name and a raw status string per server
   and nothing else — and the reduction starts at the type, since `MCPServerStatus` carries two
   fields and discards `scope`, `tools`, `config` and `error`. Reconnect, enable/disable,
   authenticate and clear-auth are all wire-complete and UI-dead (E-14 … E-16). Auth is the
   standout: afleet has a Browser panel, so the OAuth callback never has to be copied by hand.
5. **Four surfaces are wired to nothing and fail silently.** `/fast` routes to a picker surface that
   does not exist (`pickerSurfaces == ["modelPicker","effortPicker"]`), and so does `/agents`;
   `/memory` fetches the file paths and renders their **count**; `overlay.banners` is computed with
   `rateLimit` and `auth` kinds and **nothing reads it**, so the rate-limit banner root spec §7.6
   designs does not exist. These are not designs to write; they are four short wiring jobs, and
   three of them are the cheapest high-value items in the lane (E-30, E-39, E-42, E-48).
6. **The pickers keep the right discipline and drop every explanatory string.** C6.2's
   readback-not-the-click rule is exactly right and should not change. But `ModelOption` drops
   `description` at the decode boundary, so the model picker *cannot* render the per-model
   descriptions, the `Select model` header, the `… +N models` overflow counter or a
   default-for-new-sessions control; the effort menu shows raw `low`/`medium`/`high`/`xhigh` with
   no gloss, no `max` caveat and no reason why `max` is missing. Three of these are one field and a
   layout (E-28, E-29). And `outputStyle` — the one setting afleet can write with a single control
   request, already plumbed through FleetKit — has no control at all (E-41).
7. **The refusal copy is a product surface with three rows and about forty commands landing on it.**
   `RouterTable.terminalOnlyReasons` covers `/doctor`, `/color` and `/reload-plugins`; everything
   else gets one of two generic sentences about a screen afleet has no equivalent of. One of the
   three is also wrong — it tells users afleet picks up plugin changes on restart, when afleet
   ships a live `reload_plugins` button. Writing one honest line per command, saying what afleet
   does instead, is most of the copy work in this lane and is what stops the app reading as a
   subset of the terminal.

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
   **Permissions** (E-08…E-13), **Extensions** (MCP, plugins, skills, hooks, agents — E-14…E-27,
   E-37…E-42), **Account** (E-43…E-49). Every pane carries the same scope control at the top —
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
| 5 · File | `Open file` | afleet opens the owning settings file in the Files panel and reveals the key; the user edits and saves | the 23 non-headless `/config` keys, hooks, permission rules outside `localSettings` |

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
│ │                │ │  ▸ Not used by afleet (27)                               │ │
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


## B. The 60 `/config` rows, grouped by where they land

The registry is at SPEC 41.26.2. Every row below is assigned to exactly one destination; the four
buckets sum to 60. The **headless** column is the tui-parity finding at
`/Users/new/developer/github/afleet/docs/tui-parity/areas/41-tui-rendering.md` line 592: the live
headless `/config key=value` accepts a named subset of the registry (that row claims *38* keys and
then enumerates *37*; the enumeration is what afleet must code against — see *Spec defects*).
The **write class** column is E-01's five-class table.

### E-03 · The 28 rows that become afleet preferences (Settings → Claude Code → Defaults / Account)

**Terminal.** These are the registry rows whose subject is the *engine's* behaviour rather than the
terminal's drawing: compaction, memory, workflows, notifications, question timeouts, cross-session
messaging, the API key. In `/config` they are interleaved with rendering rows in registry order and
carry no visual distinction; only the gated section sort (`tengu_maple_sundial`, SPEC 41.26.1)
separates `Model & output` and `Connections` from `Display` and `Input & controls`. Each row's
target is fixed by which of the four writers built it — `h()` user `settings.json`, `L()`
`settings.local.json`, `k()` one user key, `E()` the global config store `~/.claude.json`
(SPEC 41.26.2).

| Key | Label (verbatim) | Type | Target | Headless | Class |
|---|---|---|---|---|---|
| `autoCompact` | `Auto-compact` | boolean | `autoCompactEnabled`, user | yes | 3 |
| `autoContinueAtUsageLimit` | `Continue automatically at usage limit` | boolean | user | no | 5 |
| `switchModelsOnFlag` | `Switch models when a message is flagged` | boolean | user | yes | 3 |
| `promptSuggestionEnabled` | `Prompt suggestions` | boolean | user | yes | 3 |
| `recap` | `Session recap` | boolean | `awaySummaryEnabled` | yes | 3 |
| `checkpoints` | `Rewind code (checkpoints)` | boolean | `fileCheckpointingEnabled` | yes | 3 |
| `orgMemoryRead` | `Synced project memory (this directory; applies next session)` | boolean | — | no | 5 |
| `orgMemoryWrites` | `Synced project memory writes (enable reads first)` / `… (this directory; applies next session)` | boolean | — | no | 5 |
| `workflows` | `Dynamic workflows` | boolean | `enableWorkflows` | yes | 3 |
| `workflowKeywordTriggerEnabled` | `Ultracode keyword trigger` | boolean | user | yes | 3 |
| `workflowSizeGuideline` | `Dynamic workflow size` | enum `unrestricted`/`small`/`medium`/`large` | global config | yes | 3 |
| `artifacts` | `Artifacts` | boolean | `enableArtifact` | no | 5 |
| `precomputeCompactionEnabled` | `Precompute compaction` | boolean | user | no | 5 |
| `worktreeBaseRef` | `Worktree base ref` | enum `fresh`/`head` | `worktree.baseRef` | yes | 3 |
| `useAutoModeDuringPlan` | `Use auto mode during plan` | boolean | user | yes | 3 |
| `autoScroll` | `Auto-scroll` / `Auto-scroll output` | boolean | `autoScrollEnabled` | yes | 3 |
| `copyOnSelect` | `Copy on select` | boolean | global config | yes | 3 |
| `autoUpdatesChannel` | `Auto-update channel` | managedEnum → `EnableAutoUpdates` / `ChannelDowngrade` | — | no | 5 |
| `notifChannel` | `Notifications` / `Local notifications` | managedEnum → `Notifications`, or cycling enum | `preferredNotifChannel` | yes | 3 |
| `inputNeededNotifEnabled` | `Push when actions required` | boolean | user | yes | 3 |
| `agentPushNotifEnabled` | `Push when Claude decides` | boolean | user | yes | 3 |
| `language` | `Language` | managedEnum, free-text coerced | user | yes | 3 |
| `askUserQuestionTimeout` | `Question auto-continue timeout` | enum `never`/`60s`/`5m`/`10m` | user | no | 5 |
| `modelProposedGoals` | `Claude-proposed goals` | enum `auto`/`alwaysAsk`/`disabled` | user | no | 5 |
| `dialogExpiry` | `Dialog expiry` | enum `default`/`60s`/`5m`/`10m`/`never` | user | no | 5 |
| `crossSessionInbound` | `Messages from your other sessions` | enum `default`/`accept`/`hold`/`refuse` | user | no | 5 |
| `showExternalIncludesDialog` | `External CLAUDE.md includes` / `External CLAUDE.md files` | managedEnum → `ExternalIncludes` | — | no | 5 |
| `apiKey` | `Use custom API key: <suffix>` | boolean | global config | no | 5 (Account pane) |

Sixteen of the 28 are class 3; twelve are class 5.

**Job.** These are the preferences that decide how the engine behaves across every channel: whether
context is compacted, whether a rate limit stalls or continues, whether an unanswered question
auto-continues after a timeout, whether another session's message can interrupt this one, whether
memory syncs, which notification path fires. In a fleet app half of them are *more* load-bearing
than in the terminal, because there are twenty channels and nobody watching most of them.

**Wire.** R throughout. Reads come from `get_settings` (`effective` / `applied` / `sources`,
README §5 A-03/49/35). Writes: class 3 for the sixteen, class 5 for the twelve — afleet cannot
write them itself (root spec §7.8 forbids writing under `<configHome>`). No settings-change frame
exists, so a write must be followed by a `get_settings` re-read; external edits land in about 1.5 s
and are silent (A-03/49/35).

**afleet today.** `undesigned`. `App/Views/SettingsView.swift` has no engine-preference rows at
all; `RouterTable.swift:44` routes `/config` as `.text` with the explanation
`Runs in the engine; the persisted setting is read back with get_settings.`, so a user who types
`/config autoCompact=false` today does get the write — with no UI and no confirmation beyond the
engine's own line.

**GUI form.** The Defaults pane of E-01 (Account pane for `apiKey`), grouped under six headings
taken from the terminal's own gated section names where they fit — `Conversation`,
`Model & output`, `Memory`, `Workflows`, `Notifications`, `Advanced`. Each row: label verbatim,
control matched to type (`Toggle` for boolean, pop-up for enum, text field for `language`), the
effective value, a dim source line (`User settings` / `Project settings` / `Managed`), and the
write-class badge from E-01 (`via engine` for class 3, `Open file` for class 5). Four rows need
more than the generic treatment:

- `askUserQuestionTimeout` and `dialogExpiry` gain a cross-link to the decision card surfaces
  (lane D): these two set how long an unanswered decision waits before the engine acts. In a
  window showing twenty channels this is the single most consequential preference in the registry
  and it should be surfaced in the Defaults pane's first group, not buried where the registry puts
  it. `[exceeds]` — the pane shows the current value alongside a count of decisions currently
  waiting.
- `crossSessionInbound` gains the same treatment for `hold` and `refuse`, since afleet's Activity
  view is where a held inbound message would land.
- `orgMemoryRead` / `orgMemoryWrites` keep their `applies next session` label suffix verbatim and
  render with the restart badge that E-01's Overrides sheet uses, because the label is telling the
  truth: the value is read at spawn.
- `notifChannel` gets a warning line afleet must author (not canon): afleet delivers its own
  `UNUserNotification`s, so leaving the engine's channel on `auto` produces two notifications for
  one event. The proposal is that afleet writes `notifChannel` at spawn and shows the row as
  `Managed by afleet` with a link to the app's own Notifications settings.

**Drops / keeps / gains.**
*Drops:* registry ordering; the interleaving with rendering rows.
*Keeps:* every label verbatim including the two conditional label variants, every enum domain in
source order, the target file per row, the lock reason line.
*Gains:* `[exceeds]` the write-class badge, so the user knows before clicking whether the change
lands from here; `[exceeds]` the timeout rows shown against live waiting-decision counts.

**Open.** Should afleet own `notifChannel` outright (write it at spawn, present it as managed) or
leave it to the user and accept double notifications? Owner.

### E-04 · The five dual rows: a per-channel value and a persisted default

**Terminal.** Five registry rows name something a running session also carries: `model` (`Model`,
managedEnum, hint `For a specific model ID, use /model.`), `thinking` (`Thinking mode`, boolean,
`alwaysThinkingEnabled`, with the inline warning `Changing thinking mode mid-conversation will
increase latency and may reduce quality.` under it — SPEC 41.26.3, verified `cli.pretty.js:392623`),
`permissionMode` (`Default permission mode`, enum built as `default`, `plan`, then every member of
`ly` that is neither already present nor `bypassPermissions` — SPEC 41.26.2), `outputStyle`
(`Output style`, managedEnum, hint `For custom styles, open /config.`, local settings) and `fast`
(`Fast mode (<model>)`, boolean, `fastMode`, label interpolating the fast model's name). In the
terminal the distinction is invisible: changing the row changes both the persisted default and, for
some rows, the live session, and only the label prefix `Default` on `permissionMode` says which.
`fast` is the only one of the five the headless `/config` cannot write.

**Job.** Answering two different questions with one control — *what is this channel running* and
*what will the next channel start with*. Conflating them is the terminal's compromise, not a design.

**Wire.** P for the live half, R for the persisted half. `set_model` sets a session's model;
`set_permission_mode` sets its mode; `apply_flag_settings` carries `fastMode` and thinking tokens
(README §5 A-06/08/02). `update_settings` writes exactly one key and it is one of these five —
`outputStyle` into `localSettings` (README §4 finding 7). The other four persisted halves go through
class 3.

**afleet today.** `built`, partially. `App/Header/SettingPickers.swift` renders model, effort and
permission mode as three header menus; `LaunchSettingMatrix.runtimeMutable` in
`FleetKit/Sources/FleetSessions/Router/RouterTable.swift:133` names
`["model", "permissionMode", "effort", "agent", "sessionName", "thinkingTokens", "fastMode", "cwd"]`
as the settings a live channel can change. What is missing is the *persisted* half: nothing in the
app promotes a channel's value to a default, and there is no output-style control anywhere.

**GUI form.** The live value lives in the channel header; the default lives in the Defaults pane;
they are linked by one affordance in each direction.

```
┌─ Channel header ────────────────────────────────────────────────────────────┐
│  #api-refactor   main   [Sonnet 5 ⌄]  [default ⌄]  [medium ⌄]      ▓▓▓░ 62% │
└─────────────────────────────────────────────────────────────────────────────┘
                     │ click
                     ▼
        ┌──────────────────────────────────────────────┐
        │ Select model                                 │
        │  ● Sonnet 5      Fast, everyday coding        │
        │  ○ Opus 5        Deepest reasoning            │
        │  ○ Haiku 5       Cheapest, quick edits        │
        │  ○ Default       Let Claude Code choose       │
        │  ⋯ 4 more models                             │
        │ ──────────────────────────────────────────── │
        │ ☐ Set as default for new channels            │
        │      writes `model` to settings.json         │
        └──────────────────────────────────────────────┘
```

The checkbox is the whole design. It is the terminal's own default-promotion affordance from the
model picker (clone row *Model picker*, byte-verified), lifted out of a key chord into a visible
control and generalised to all five rows. Unchecked, the change is a control request against this
channel only. Checked, afleet additionally performs the class-3 or class-2 write and the Defaults
pane's row updates. The Defaults pane's copy of the row shows the persisted value with a trailing
`3 channels differ →` link that opens the quick switcher filtered to those channels — `[exceeds]`,
and the answer to a question the terminal cannot even ask.

`thinking` carries its warning verbatim in both places. `fast` renders as a header toggle labelled
with the interpolated fast model name exactly as the terminal does, and its persisted half is
class 5 (`Open file`), which the badge says.

**Drops / keeps / gains.**
*Drops:* the conflation itself, and the `Default` label prefix on `permissionMode` (the pane's
position now says it).
*Keeps:* labels, hints, enum construction order, the thinking warning verbatim, the fast-model
interpolation.
*Gains:* `[exceeds]` explicit promote-to-default; `[exceeds]` a cross-channel divergence readback.

**Open.** When a user changes a default while ten channels are live, does afleet offer
`Apply to all open channels`? The terminal never faces the question.

### E-05 · The 20 rows afleet supersedes (terminal rendering and terminal mechanisms)

**Terminal.** Twenty registry rows configure how the Ink renderer draws or how the terminal
emulator behaves, and have no meaning in a window afleet paints itself:

| Key | Label | What it governs | Replaced by |
|---|---|---|---|
| `tips` | `Show tips` | spinner tip line (`spinnerTipsEnabled`) | afleet's own progress row |
| `feedbackDrafts` | `Claude-drafted feedback` | a TUI prompt surface | not drawn |
| `reduceMotion` | `Reduce motion` | animation suppression (`prefersReducedMotion`) | macOS Reduce Motion |
| `verbose` | `Verbose output` / `Verbose` | full vs truncated tool output | per-row expansion in the timeline |
| `progressBar` | `Terminal progress bar` | OSC progress sequence | Dock/menu-bar progress |
| `showStatusInTerminalTab` | `Show status in terminal tab` | terminal tab title | window title + sidebar badges |
| `turnDuration` | `Show turn duration` | footer duration | turn summary row |
| `timestamps` | `Show message timestamps` | `showMessageTimestamps` | timeline's own timestamp rule |
| `timeFormat` | `Time format` (`auto`/`12-hour`/`24-hour`/`24-hour-utc`) | clock rendering | macOS locale |
| `gitignore` | `Respect .gitignore in file picker` | the `@` picker's filter | afleet's own file picker |
| `copyFullResponse` | `Skip the /copy picker` | `/copy` behaviour | copy actions on rows |
| `agentsView` | `Agents view` | the fullscreen agents view | Agents panel tab |
| `defaultToAgentsView` | `Open agents view by default` | ditto | panel tab persistence |
| `leftArrowOpensAgents` | `← opens agents` | a keybinding | lane C / menu bar |
| `theme` | `Theme` | Ink colour theme | afleet appearance (lane A) |
| `defaultView` | `Default view` (`transcript`/`chat`/`default`) | the two TUI view modes | one timeline |
| `editor` | `Editor mode` (`normal`/`vim`) | composer keymap | lane C (`/vim`) |
| `prStatus` | `Show PR status footer` / `Show PR status` | footer line | GitHub panel tab |
| `diffTool` | `Diff tool` (`terminal`/`auto`) | how a diff is shown | Files panel diff viewer |
| `teammateMode` | `Teammate mode` (`auto`/`tmux`/`iterm2`/`in-process`), or `Teammate mode [overridden: <value>]` | how a teammate session is hosted | afleet spawns its own sessions |

Thirteen of the twenty are headless-writable, which matters: afleet should *write* several of them
at spawn rather than merely ignore them.

**Job.** In the terminal these tune a single scrolling screen to one person's eyesight, terminal
emulator and taste. In afleet the equivalent decisions are made by the window.

**Wire.** R for reading, class 3 for the thirteen writable ones. tui-parity line 110 dissents on
one: `copyOnSelect` is called out as a preference "a GUI should honour … it is a real user
preference and cheap to read" — which is why that row is in E-03 and not here, and it is worth
saying that the same argument does *not* extend to the twenty above.

**afleet today.** `superseded` by construction — afleet draws its own timeline (C6.1) and owns its
own appearance; none of these rows exists in `App/Views/SettingsView.swift` and none should.

**GUI form.** Not rendered as controls. Two consequences instead:

1. **Spawn-time normalisation.** afleet should write, once per config home, the subset that would
   otherwise make the engine emit terminal-shaped output into a channel afleet has to parse:
   `progressBar=false`, `showStatusInTerminalTab=false`, `tips=false`, `theme` left alone. This is a
   class-3 write and it is the only place in this lane where afleet writes a setting the user did
   not ask for; the Defaults pane therefore lists them in a `Managed by afleet` disclosure with
   one line each and a `Restore` action. Named deviation from faithfulness, with the reason.
2. **A visible ledger.** The `Not used by afleet` disclosure at the foot of the Defaults pane (E-01)
   lists all twenty with their labels and a one-line `Replaced by` sentence — the table's fourth
   column, verbatim. A user coming from the terminal must be able to search a setting name and find
   out where it went; silence would read as a missing feature.

**Drops / keeps / gains.**
*Drops:* twenty controls.
*Keeps:* the labels, as search targets, and an explanation for each.
*Gains:* `[exceeds]` the replacement is usually better (real diffs, per-row expansion, native
reduce-motion); the ledger makes that legible instead of leaving a hole.

**Open.** Is spawn-time normalisation acceptable to the owner, given root spec §7.8's
never-write-under-configHome rule applies to *files* and this is a class-3 engine write? It is a
rule-boundary question, not a taste one, but it deserves a decision.

### E-06 · The 7 rows outside afleet's scope

**Terminal.** `remoteHomeSettings` (`Use this machine's settings in cloud sessions`, a boolean
projection of the three-state `remoteHomeSettingsMode` whose stored values are exactly
`forward` / `keep_local`; its shared setter refuses a direct enable with
`Turn this on from the /config panel, which shows what will be sent`, SPEC 41.26.2);
`unattendedServing` (`Unattended commands from cloud sessions on this computer`, a consent-gated
`pickToCommit` enum `declined`/`accepted` where a managed lock leaves only `declined` writable);
`remoteControl` (`Enable Remote Control for all sessions`, ordinary enum `true`/`false`/`default`
until a lock reason arrives, then a managedEnum displaying `disabled` with
`writableWhileLocked: ["false"]`); `chrome` (`Claude in Chrome enabled by default` /
`Claude in Chrome`); `autoConnectIde` (`Auto-connect to IDE (external terminal)`);
`autoInstallIdeExtension` (`Auto-install IDE extension`); `externalEditorContext`
(`Show last response in external editor` / `Show responses in IDE`).

**Job.** Cloud sessions, Remote Control, Chrome control and IDE attachment — four product surfaces
afleet does not host.

**Wire.** Four of the seven are headless-writable (`chrome`, `remoteControl`, `autoConnectIde`,
`externalEditorContext`), so the ceiling is not what excludes them.

**afleet today.** `out-of-scope`. The root spec's scope sections exclude cloud sessions, Remote
Control and IDE attachment from the workspace (root spec §3 and §17.8); afleet's Browser panel is
its own WebKit surface, not Claude-in-Chrome, and its Terminal panel is GhosttyKit, not an IDE.

**GUI form.** Listed in the `Not used by afleet` disclosure with their labels and one sentence
each, read-only, no control. `remoteControl` gets a second sentence because its locked form is
security-relevant: if a managed policy has locked it, afleet should show the lock and the reason
even though it offers no control, so an administrator can confirm the policy took.

**Drops / keeps / gains.**
*Drops:* seven controls and the two sub-dialogs behind them.
*Keeps:* labels and lock states as read-only facts.
*Gains:* nothing.

**Open.** None.

### E-07 · The `/config` sub-dialogs with no slash command of their own

**Terminal.** Activating a `managedEnum` or `pickToCommit` row opens one of eleven sub-dialogs
(SPEC 41.26.4): `Theme`, `Model`, `RemoteHomeSettings`, `ExternalIncludes`, `OutputStyle`,
`Language`, `AgentsView`, `Notifications`, `EnumPicker`, `EnableAutoUpdates`, `ChannelDowngrade`.
Four have their own commands and their own cards here (`Theme` → E-40, `Model` → E-28,
`OutputStyle` → E-41, `AgentsView` → superseded in E-05). The remaining seven are reachable
*only* through `/config`: `Language` (free-text coerced, `Default (English)` is a display fallback
and selecting `default` writes `undefined`, SPEC 41.26.2), `Notifications` (the channel picker
behind `notifChannel`, gate-dependent — a sub-dialog when `hpe()` is on, a cycling enum otherwise),
`EnumPicker` (the generic picker for `pickToCommit` enums), `EnableAutoUpdates` and
`ChannelDowngrade` (the two halves of `autoUpdatesChannel`, where moving to an older channel needs
its own confirmation), `ExternalIncludes` (behind `showExternalIncludesDialog`, governing external
`CLAUDE.md` includes) and `RemoteHomeSettings` (`origin: "config_panel"`, which the interactive
path uses to bypass the setter's refusal, SPEC 41.26.2).

**Job.** They exist because a terminal row can hold one value and some values need a list, a
confirmation, or a preview before committing.

**Wire.** R. None is reachable headlessly; the underlying keys are written by class 3 or 5 as
E-03's table says.

**afleet today.** `undesigned` — no equivalent anywhere.

**GUI form.** Five of the seven disappear into the control type: `Language` is a combo box (text
field with completions, keeping the `Default (English)` placeholder and writing `undefined` on
`default`), `Notifications` is a pop-up, `EnumPicker` is a pop-up, `ExternalIncludes` is a list
editor inside the Memory section of the Extensions pane (E-28). Two keep a confirmation step
because they are consequential and the terminal marks them so:

- `EnableAutoUpdates` / `ChannelDowngrade`: the auto-update channel row opens a small sheet, and
  selecting an older channel than the installed one raises the downgrade confirmation. afleet has
  a second reason to keep it — `App/Views/SettingsView.swift`'s Engine section already reports the
  installed engine version and the protocol gate verdict, so a channel change is a change to *the
  binary afleet is hosting* and must be shown against that readback, not in isolation.
- `RemoteHomeSettings` stays out (E-06).

**Drops / keeps / gains.**
*Drops:* the sub-dialog as a distinct modal layer for five of seven.
*Keeps:* the downgrade confirmation, the `Default (English)` fallback semantics, the
write-`undefined`-on-default rule for `language` and `defaultView`.
*Gains:* `[exceeds]` the auto-update channel is shown next to the engine version and gate verdict
afleet already computes.

**Open.** Does afleet want the engine to auto-update at all under it, given the Engine section
pins a protocol baseline? Arguably afleet should pin the channel and say so. Owner.

## C. `/permissions`

### E-08 · The `/permissions` dialog shell: six tabs, the filter gesture, four footers

**Terminal.** `/permissions` (alias `/allowed-tools`, catalogue description
`Manage allow and deny tool permission rules`, no argument hint, SPEC 28 §5) is
`{type: "local-jsx", immediate: true}` and opens a tabbed dialog titled `Permissions` in the
`permission` colour (verified `cli.pretty.js:13104`). The tabs, in order, are `Recently denied`,
`Allow`, `Ask`, `Deny`, `Auto mode` and `Workspace` — **six**, not five: `Auto mode` is inserted
between `Deny` and `Workspace` and rendered only when auto mode is available
(`cli.pretty.js:13077`, assembled at `:13098`). The footer has four mutually exclusive states
(`cli.pretty.js:13109`), separator `·`:

| State | Footer |
|---|---|
| Header focused | `←/→ to switch · ↓ to select · Esc to cancel` |
| Searching | `Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear` |
| Recent tab, list focused | `Enter to approve · r to retry · ↑/↓ to navigate · Esc to cancel` |
| Default | `↑/↓ to navigate · Enter to select · ←/→ to switch · Esc to cancel` |

Filtering starts on `/` with an empty query, or on any single printable key **except**
`j`, `k`, `m`, `i`, `r` and space, which are navigation (`cli.pretty.js:12551-12557`). There are
**no empty-state strings**: an empty rule tab shows only the `Add a new rule…` row, and a filter
with no matches shows a zero-option list and nothing else (confirmed by absence). On close the
panel logs `Permissions dialog dismissed`; the workspace sub-dialog logs its own
`Workspace dialog dismissed` (verified `cli.pretty.js:12635`, `:10948`).

**Job.** One place to see and change what Claude is allowed to do, split by the three decisions the
engine can make about a tool call plus the two things that are not rules at all — what was just
denied, and where the session may read.

**Wire.** X for the panel, R for the content. `areas/24-21-permissions-plan-questions.md:205`:
the command is *"**absent** from the … headless command list … The whole rules editor is
unreachable as a command. Everything below is therefore a rebuild, and the rebuild is the single
largest piece of work in this area."* Line 208 gives the data routes: `Allow`/`Ask`/`Deny` from
`get_settings.sources[]` (verified live, per-source `permissions.{allow,ask,deny}`),
`Recently denied` from buffered `system/permission_denied` frames plus `result.permission_denials`.

**afleet today.** `designed` as a route, unbuilt as a surface.
`FleetKit/Sources/FleetSessions/Router/RouterTable.swift:37` carries
`.init(name: "/permissions", strategy: .setPermissionMode, readback: .handshakePermissionMode, explanation: "Changes the permission mode; on its own opens the read-only rules view.")`;
`CommandRouter.swift:105-113` splits the bare form to `.permissionsView`, which at `:366-368`
performs `GetSettings()` and returns a `PermissionsView`. That view holds an opaque `settings:
JSONValue` and a computed `applied` dictionary and **no rule accessors at all** — its own doc
comment at `:262-268` explains that naming a field `rules` and filling it from `applied` would
render the model and the effort level under a permissions heading. Its single consumer is
`App/Composer/CommandRouting.swift:435-437`, which prints a composer note of the shape
`4 applied setting(s): advisor, effort, model, ultracode.` — so today, typing `/permissions` in
afleet shows you your model and effort. Already logged as
`docs/tech-debt-tracker.md:1245-1253` item 206, *"A strategy's answer is a one-line note where
three of them are screens."* Root spec §13 and §17.8 do not mention permissions at all.

**GUI form.** Settings window → Claude Code → **Permissions** pane, and additionally reachable
from the channel header's mode picker (`Manage rules…`) and from any denial in the Activity view.
Sidebar of six sections in the terminal's order, list on the right, detail inspector below or
beside it. Deviations, each named:

- **The dialog becomes a pane, not a modal.** Rules are read while work is happening; a modal that
  steals the screen is a terminal constraint.
- **Scope selector at the top**, `User · Project · Local · Managed · All`, defaulting to `All`
  with per-row provenance. The terminal has no such control because it merges silently.
  `[exceeds]`, and it is the pane's main reason to exist.
- **Live search field** replacing the seeded-keystroke gesture, keeping `Type to filter`
  semantics. The excluded-letters rule (`j`, `k`, `m`, `i`, `r`) disappears with it — a pointer
  surface has no need to reserve letters for navigation.
- **Footers become a single hint line** under the list, showing only the keyboard equivalents that
  still exist (`↑/↓`, `Enter`, `⌫`). The four-state footer is a consequence of one screen doing
  four jobs.
- **Empty states are added.** The terminal shows nothing; a pane that is blank on first open reads
  as broken. Proposed copy, authored not canon: `No allow rules. Claude asks before every tool
  call that is not covered by a mode.` Named deviation.
- **Dismissal messages dropped** — no dismissal event in a persistent pane.

```
┌─ Settings › Claude Code › Permissions ─────────────────────────────────────────┐
│ Scope  ( All ⌄ )                       ⌕ Filter rules…            [+ Add rule] │
│ ┌──────────────┬───────────────────────────────────────────────────────────┐   │
│ │ Recently     │  Bash(git push:*)                        User settings    │   │
│ │  denied   3  │    Any Bash command starting with git push                 │   │
│ │ Allow    12  │  Bash(npm test:*)                        Project settings  │   │
│ │ Ask       2  │    Any Bash command starting with npm test                 │   │
│ │ Deny      4  │  WebFetch                                Managed  🔒       │   │
│ │ Auto mode    │    Any use of the WebFetch tool                            │   │
│ │ Workspace 3  │  ⋯                                                         │   │
│ └──────────────┴───────────────────────────────────────────────────────────┘   │
│ ┌─ Rule details ─────────────────────────────────────────────────────────────┐ │
│ │ Bash(git push:*)   Any Bash command starting with git push                 │ │
│ │ From user settings · ~/.claude/settings.json          [Open file] [Delete] │ │
│ │ ⓘ Shadowed by Deny(Bash(git push:*)) from managed settings — never applies │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.**
*Drops:* the modal, the four footers, the seeded-keystroke filter, the two dismissal strings.
*Keeps:* six tabs and their order and names, the conditional `Auto mode` tab, the
`Add a new rule…` row and its position, the `permission` accent colour.
*Gains:* `[exceeds]` scope selector; `[exceeds]` provenance on the row rather than only in the
detail pane; `[exceeds]` empty states; `[exceeds]` shadowed-rule diagnostics (see E-09).

**Open.** Should the Permissions pane be per-project (rules are mostly project-scoped) or global
with a project filter? The terminal is always in one project so the question does not arise.

### E-09 · Rule rows, provenance, and the `Rule details` pane

**Terminal.** A rule renders as its formatted string (`Tool` or `Tool(specifier)`) with a
description beneath it in the four shapes `Any Bash command starting with <prefix>`,
`The Bash command <command>`, `Any Bash command`, `Any use of the <Tool> tool` — a non-`Bash` rule
*with* content has no description at all (SPEC 24 §24.19). Rows are sorted **flat alphabetically**
by the lower-cased rule string (`localeCompare`, `cli.pretty.js:12500-12528`); they look grouped by
tool only because the tool name is the prefix, and SPEC §24.19's phrase "grouped by tool" describes
the effect, not a grouping pass. **The row carries no source label.** Provenance appears only after
selection, in a pane titled `Rule details` (`cli.pretty.js:11688`), as a dim line
`` `From ${source}` `` (`cli.pretty.js:12254-12266`) using eleven display names
(`cli.pretty.js:235235-235258`): `user settings`, `shared project settings`,
`project local settings`, `command line arguments`, `enterprise managed settings`, `CLI argument`,
`command configuration`, `current session`, `CLI tool narrowing`, `MCP server policy`,
`cloud-session credential guard`. The eleven sources merge in the iteration order `userSettings`,
`projectSettings`, `localSettings`, `flagSettings`, `policySettings`, `cliArg`, `command`,
`session`, `toolsNarrowing`, `mcpServerPolicy`, `hostCredential` (SPEC 24 §24.8.1), and within one
behaviour **first match wins for whole-tool lookups, last source wins for content lookups**. The
grammar is `toolName` optionally followed by `(ruleContent)`, where `Tool`, `Tool()` and `Tool(*)`
all collapse to the same parsed rule and parens inside content are not balanced (SPEC 24 §24.5.1);
a widening update that does not round-trip `parse(format(rule)) === rule` is dropped (§24.15.2).

**Job.** Answering "what is Claude allowed to do here, and who decided that" — and, when a rule
does not fire, why not.

**Wire.** R, with a documented data gap. `get_settings.sources[]` exposes the five *settings*
sources; `cliArg`, `command`, `session`, `toolsNarrowing`, `mcpServerPolicy` and `hostCredential`
live in process memory and are **not on the wire** — D for those six
(`areas/24-21-permissions-plan-questions.md:69`). Shadowed-rule diagnostics are R and the area file
calls them out as high value: *"this is the feature that explains 'why didn't my allow rule
work?'"* (line 215). Round-tripping is R and line 59 warns *"A GUI rule editor that does not
round-trip will silently lose rules."*

**afleet today.** `undesigned`. Nothing in the repository models a rule: `alwaysAllowRules` and
`alwaysDenyRules` have zero hits repo-wide. The merge walk a rules view needs is nonetheless
already written once, for a single key —
`App/Header/SettingPickers.swift:310-323` (`bypassIsDisabled(in:)`) reads *"from `effective.permissions`
and from every `sources[].settings.permissions`, because a source can carry it while the merged
view does not."* That is the shape the whole pane needs, generalised.

**GUI form.** Row: rule string in monospace, description beneath in secondary text (kept verbatim
including the no-description case for non-`Bash` rules with content), source name right-aligned in
the row rather than hidden in the detail pane — `[exceeds]`, and the single highest-value change
in the lane, because the terminal makes you select a row to learn who owns it. Sort: keep flat
alphabetical by default, add an optional group-by-source. Detail pane keeps the title
`Rule details` and the `From <source>` line verbatim, and adds three things the terminal cannot:

1. **Shadowing diagnostics.** `⚠ Shadowed by <rule> from <source> — this rule never applies`,
   computed entirely from `get_settings.sources[]` per the area file. Authored copy.
2. **Open file.** Reveals the owning settings file in the Files panel with the rule's line
   selected — the answer for every source afleet cannot write (E-10).
3. **The six invisible sources, named.** afleet cannot enumerate `cliArg`, `session`,
   `toolsNarrowing`, `mcpServerPolicy`, `command` or `hostCredential`, so the pane must say so
   rather than imply the list is complete. Proposed foot-of-list line, authored:
   `Rules from launch flags, the current session and MCP server policy are enforced but not listed
   here.` Without it the pane lies by omission.

**Drops / keeps / gains.**
*Drops:* nothing of the row itself.
*Keeps:* rule formatting, the four description shapes and the null case, alphabetical order, the
eleven source display names, `Rule details`, `From <source>`.
*Gains:* `[exceeds]` provenance on the row; `[exceeds]` shadowing diagnostics; `[exceeds]`
click-through to the owning file; an honest statement of what is not listed.

**Open.** Is it worth a probe to see whether any of the six memory-only sources can be inferred
from `system/permission_denied` frames? It would turn a D into a partial R.

### E-10 · Add a new rule: the free-text editor and the destination picker

**Terminal.** `Add a new rule…` is prepended to the `Allow`, `Ask` and `Deny` lists, but only when
no filter is active (`cli.pretty.js:12502-12503`). Selecting it opens a free-text editor titled
`Add allow permission rule`, `Add deny permission rule` or `Add ask permission rule` — the raw
behaviour word, so the `ask` title reads ungrammatically (`cli.pretty.js:10691`). Its help line is
`Permission rules are a tool name, optionally followed by a specifier in parentheses.` /
`e.g., WebFetch or Bash(ls *)` with the two examples in bold (`cli.pretty.js:10709`); the
placeholder is `Enter permission rule…` (`:10714`); `enter` submits and `escape` cancels.
**There is no validation.** Empty input is silently ignored and anything else goes straight to the
parser (`cli.pretty.js:10685-10690`); the sixteen validation strings of SPEC 24 §24.9.1 belong to
the settings-file Zod path and never appear in this dialog. Step two is the destination picker,
titled `Add <behavior> permission rule` / `… rules` and prompting
`Where should this rule be saved?` (`Where should these rules be saved?` for more than one,
`cli.pretty.js:10648`). The three options, in the order `localSettings`, `projectSettings`,
`userSettings` (`cli.pretty.js:235296`), are (`cli.pretty.js:10602-10611`):

| Label | Description |
|---|---|
| `Project settings (local)` | `Saved in <path>/.claude/settings.local.json` |
| `Project settings` | `Checked in at <path>/.claude/settings.json` |
| `User settings` | `Saved in at ~/.claude/settings.json` |

The third is a hardcoded literal, not a computed path: hence the `Saved in at` typo, **verified at
`cli.pretty.js:10609`**, and hence the description going stale under `CLAUDE_CONFIG_DIR`. Choosing
a destination applies the rule in memory and persists it, then computes shadowed-rule warnings
(`cli.pretty.js:10625-10630`).

**Job.** Adding a standing permission without waiting for the next prompt, and choosing whether it
is yours, the project's, or checked in for the team.

**Wire.** P at approval time, D from a panel. `PermissionUpdate` rides `updatedPermissions` on an
open `can_use_tool` and its `destination` may be `userSettings`, `projectSettings` or
`localSettings` (root spec §7.7; README §5 A-24/21), so *the full union is expressible* — but only
while a decision is open. Standalone, `update_settings` accepts exactly one key, `outputStyle`,
and one source, `localSettings` (README §4 finding 7; live probe error
`update_settings keys not allowed: permissions` at
`docs/tui-parity/evidence/2026-09-03-control-request-shapes.md:32`). **The area file's proposed
workaround of writing `permissions` through `update_settings` is refuted by that probe and is a
defect in the area file** — see *Spec defects*.

**afleet today.** `designed` only in the one §7.7 line. `ClaudeWire/Sources/WireFrames/OutboundRequests.swift:159`
hardcodes `source: "localSettings"` on `update_settings`, and its only production caller is
`FleetKit/Sources/FleetSessions/Fleet.swift:631`, for `outputStyle`. No code path sends a
`permissions` payload.

**GUI form.** `[+ Add rule]` in the pane's toolbar, opening a sheet with three fields rather than
two steps: **Tool** (a combo box seeded from the handshake's tool list plus connected MCP tools),
**Specifier** (free text, with the `Bash(ls *)` example as placeholder), **Behaviour**
(`Allow` / `Ask` / `Deny`, preselected from the current tab), and **Destination**. The sheet
previews the parsed rule as it types — the terminal's help sentence, kept verbatim, sits under the
preview. Two deliberate improvements the wire inventory explicitly endorses:

- **Validate before writing.** Run the §24.9 checks live and refuse the malformed forms
  (missing delimiter, `)` before the first `(`, trailing text after the final `)`, a paren in the
  tool-name prefix), and refuse anything that does not round-trip `parse(format(rule)) === rule`.
  `areas/24-21…:62` — *"Rejecting before write is strictly better UX than the TUI, which validates
  only at load."* `[exceeds]`.
- **Fix the typo and compute the path.** `User settings` renders `Saved in <resolved path>` using
  the real config home. The clone made the same call and pinned it negatively in a test
  (`CC-to-SDK/harness/test/tui/permissions-dialog.test.tsx:945`). Named deviation; the terminal's
  literal is wrong under `CLAUDE_CONFIG_DIR`, which afleet supports.

**The destination picker is where afleet's write ceiling bites, and it splits three ways:**

| Destination | afleet route | What the user sees |
|---|---|---|
| `Project settings (local)` → `<project>/.claude/settings.local.json` | direct file write — afleet already writes exactly this file for a declined `.mcp.json` server, "with the CLI's own store resolution and symlink-refusing atomic write" (root spec §7.8) | writes immediately |
| `Project settings` → `<project>/.claude/settings.json` | same mechanism; the path is under the project, so X9 does not cover it | writes immediately, with a note that it is checked in |
| `User settings` → `~/.claude/settings.json` | **blocked**: X9, root spec §17.8, *"any write under `<configHome>`"* is a standing exclusion | the option stays enabled but writes nothing directly — it opens the file in the Files panel with the rule pre-composed on the clipboard, or, when a decision is open in any channel, offers `Add on the next approval instead` |

That third row is the honest answer and the one the lane's central question asks for. The
alternative — silently downgrading a user-scope choice to local scope — would be worse than a
refusal, and a disabled option would leave the user with no route at all.

**Drops / keeps / gains.**
*Drops:* the two-step flow, the raw-behaviour titles, the `Saved in at` typo.
*Keeps:* the help sentence and its examples verbatim, the placeholder, the three destinations and
their order, the prompt copy including its singular/plural pair, the post-write shadowing check.
*Gains:* `[exceeds]` live validation and round-trip refusal; `[exceeds]` a rule preview;
`[exceeds]` a resolved user-settings path; an explicit route for the destination afleet cannot
write.

**Open.** Is a direct write to `<project>/.claude/settings.json` acceptable, given §7.8 grants
exactly one precedent (the declined MCP server) and describes it as *the one Claude Code-owned file
afleet does write*? This card proposes widening that precedent to permission rules; that is a
decision for the owner, and the alternative (open-file for all three scopes) is a materially worse
surface.

### E-11 · Deleting a rule, and the sources that refuse

**Terminal.** There is no delete chord: `Enter` on a rule row opens a confirmation panel in the
`error` border colour reading `Delete allowed tool?` / `Delete denied tool?` / `Delete ask tool?`
in bold — the behaviour label, so it says *tool* where it deletes a *rule* — then the rule string,
its description, a dim `From <source>` line, and
`Are you sure you want to delete this permission rule?` (`cli.pretty.js:12268-12277`, `:12351-12357`).
`Esc` cancels. A rule from `policySettings`, `flagSettings` or `command` cannot be deleted at all:
the store throws `Cannot delete permission rules from read-only settings`
(SPEC 24 §24.15.4). Instead of a delete affordance those rules render an explanatory panel —
managed settings gets two lines, `This rule is configured by managed settings and cannot be
modified.` and `Contact your system administrator for more information.`; a flag or command source
gets `This rule comes from a read-only source (<x>) and cannot be modified here.` where `<x>` is
exactly `the --settings flag` or `a slash command`; the legacy `autoMode.deny` key gets its own
two-sentence explanation ending `…move the rule to autoMode.soft_deny in your settings file to
manage it here.`; and the generic fallback is `This rule cannot be edited here: <reason>` /
`Edit it in your settings file, or delete it here.` (`cli.pretty.js:12316-12336`).
`cliArg` and `session` rules are removed from memory only.

**Job.** Undoing a permission you no longer want, and understanding why some you cannot.

**Wire.** D. *"No standalone control request removes a rule"* — a `removeRules` update can only
ride an `updatedPermissions` on an open `can_use_tool` allow
(`areas/24-21-permissions-plan-questions.md:163`; root spec §7.7 states the same).

**afleet today.** `undesigned`; the §7.7 row records the gap and nothing implements it.

**GUI form.** A `Delete` button in the `Rule details` pane and a `⌫` chord on the selected row,
both leading to a confirmation alert that keeps the terminal's body copy verbatim
(`Are you sure you want to delete this permission rule?`) and **fixes the title** to
`Delete this allow rule?` / `Delete this deny rule?` / `Delete this ask rule?` — the terminal's
`Delete allowed tool?` misnames the object and the `ask` arm is ungrammatical. Named deviation.
The five read-only explanations are kept verbatim, rendered in the detail pane in place of the
buttons, exactly as the terminal does.

Deletion routes like addition: local and project scope are direct file writes; a user-scope rule
opens the file. For a rule afleet can reach only through a decision, the detail pane offers
`Remove on the next approval` — which queues the `removeRules` update to ride the next
`can_use_tool` in that channel. That is a mechanism the terminal has no name for; it needs a
visible pending state (`1 rule change pending — applies at the next permission prompt`) or it will
look broken. Authored copy.

**Drops / keeps / gains.**
*Drops:* the `Delete <label> tool?` title wording, `Enter`-as-delete.
*Keeps:* the confirmation body, the error colour, the `From <source>` line, all five read-only
explanation strings verbatim, the in-memory-only semantics for `cliArg` and `session`.
*Gains:* a real delete key; an explicit pending-change state for the wire's one-way door.

**Open.** Is a queued rule removal that fires on the next approval acceptable, or too surprising?
The alternative is no deletion at all for user scope.

### E-12 · The `Recently denied` and `Auto mode` tabs

**Terminal.** `Recently denied` is the first tab and is not a rule list: it holds this session's
classifier denials with a per-item approve and retry, and it is the only tab with its own footer,
`Enter to approve · r to retry · ↑/↓ to navigate · Esc to cancel`. `Auto mode` appears only when
auto mode is available and lists the classifier's rule sections; its delete confirmation is
different from the rule tabs' — `Are you sure you want to delete this rule? The classifier stops
applying it on your next request.` (`cli.pretty.js:12027`) — and its structure entries carry
`A section header that organizes the environment entries below it; it renders into the classifier
prompt as written.` plus `Re-run /auto-mode-setup to restructure, or edit your settings file
directly.` The `Add a new rule…` row is suppressed on both tabs (`cli.pretty.js:12502`).

**Job.** *Recently denied* answers "Claude just got blocked — let it through this once, or
permanently"; *Auto mode* exposes the classifier's own rules, which are prose, not `Tool(spec)`
rules, and behave differently.

**Wire.** R. `Recently denied` is rebuilt from buffered `system/permission_denied` frames plus
`result.permission_denials` (`areas/24-21…:208`). Whether auto mode is offerable at all is D:
*"no field … probing costs a round trip and, on success, actually switches the mode"* (line 49).

**afleet today.** `undesigned` as a tab; but the denial *data* is already a first-class afleet
concept — the Activity view is specified as a cross-channel query of *"decisions, notifications,
failures, denials, rate limits, auth"* (root spec §8.1), and lane D owns the decision card that
produced each denial.

**GUI form.** These two tabs land in different places, and that is the point.

- **`Recently denied` is superseded by the Activity view.** afleet already collects denials across
  every channel; a per-session tab inside a settings pane is strictly worse. The Permissions pane
  keeps the tab as a link — `Recently denied (3) → Activity`, filtered — rather than a second
  implementation. `[exceeds]`: cross-channel, persistent, and adjacent to the decision that caused
  it, where the terminal's list is one session's and dies with it. The two row actions survive as
  row actions in Activity: `Approve` and `Retry`, keeping the terminal's verbs.
- **`Auto mode` stays a tab**, because its rows are a different kind of object and mixing them into
  the rule list would misrepresent them. Its distinct delete copy and its structure-entry
  explanations are kept verbatim. When auto mode is unavailable the tab is hidden, matching the
  terminal — but afleet cannot know whether it is available without probing (D), so the tab is
  shown whenever the session's mode ring includes it and hidden otherwise, and that inference is
  marked unverified.

**Drops / keeps / gains.**
*Drops:* the `Recently denied` tab as a tab; the recent-tab footer.
*Keeps:* `Approve` and `Retry` as verbs, the auto-mode delete sentence, the structure-entry copy,
the conditional visibility of `Auto mode`.
*Gains:* `[exceeds]` denials become cross-channel and durable instead of session-local.

**Open.** Does the owner want the Permissions pane to link out to Activity, or to embed the same
list? Linking risks the pane feeling incomplete; embedding duplicates a surface lane D and the
Activity view own.

### E-13 · The `Workspace` tab: working directories

**Terminal.** The `Workspace` tab opens with the line `Claude Code can read files in the workspace,
and make edits when auto-accept edits is on.` (SPEC 24 §24.12.3, verified `cli.pretty.js:13091`),
then lists the original cwd as `-  <shortPath>` with a dim `(Original working directory)` marker,
then each additional working directory, then `Add directory…` (`cli.pretty.js:10930-10960`). Adding
opens the free-text directory dialog titled `Add directory to workspace` with tab-completion
(`tab` completes, `enter` adds, `Esc` cancels) and the §24.12.2 validation messages
(`Please provide a directory path.`, `Path <p> was not found.`,
`<p> is not a directory. Did you mean to add the parent directory <parent>?`,
`<p> is already added as a working directory.`, `Added <p> as a working directory.`).
**A quirk worth carrying: adding from this tab is always session-scoped.** The free-text branch
calls back with `remember = false`, so the update is `{type: "addDirectories", destination:
"session"}` and the confirmation always reads `Added directory <path> to workspace for this
session` (`cli.pretty.js:13003`, `:583147`). The persisted branch exists but is reachable only from
`/add-dir <path>`, whose picker offers `Yes, for this session`,
`Yes, and remember this directory`, `No` (`cli.pretty.js:583051`). Removal shows an `error`-bordered
dialog: `Remove directory from workspace?`, the path in bold, and
`Claude Code will no longer have access to files in this directory.` (`cli.pretty.js:10886-10901`).
On disk the key is `permissions.additionalDirectories`; `--add-dir` lands in `cliArg` and a `PWD`
that differs from `cwd()` lands in `session` (SPEC 24 §24.12.1).

**Job.** Letting a session read and edit outside its starting directory, and seeing at a glance how
far its reach extends.

**Wire.** R for the list, D for both mutations. There is **no runtime add**: README §4 finding 6 —
*"`add_directory` is not `/add-dir`. The handler reads `mount_path`, requires
`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` and stages a file for a cloud container… There is no
runtime equivalent of `/add-dir` for a local headless session; only `--add-dir` at launch."* And no
runtime remove: *"no `remove_directory` control request exists in the 66-request set"*
(`areas/24-21…:96`); removal can only ride `removeDirectories` on an open `can_use_tool`.

**afleet today.** `designed`. Root spec §7.7 routes `/add-dir <path>` to *"a quiescent restart with
the new `--add-dir` list"*, and `RouterTable.swift:134` lists `addDir` in
`LaunchSettingMatrix.restartRequired`. No UI exists — `additionalDirectories` has no Swift source
anywhere, only a probe file.

**GUI form.** This tab is the one place in the lane where the terminal's surface and afleet's
mechanism disagree at the root, and the card follows afleet's. The Workspace tab in the Permissions
pane is **read-only** — it shows the merged directory list per channel with each entry's source
(`Original working directory`, `--add-dir`, `settings`, `PWD`) — and the *editing* lives on the
channel, in the per-channel Overrides sheet of E-01, because adding a directory to a running afleet
channel means restarting it. So:

- Read here, edit there. The pane's header line is kept verbatim; a trailing
  `Edit in the channel's workspace settings →` link opens the Overrides sheet for the focused
  channel.
- The Overrides sheet's directory list uses a native `NSOpenPanel` for adding — the terminal's
  tab-completion field and its five validation strings are replaced by the file picker, which
  cannot produce four of the five errors. `<p> is already added as a working directory.` survives
  and is kept verbatim. Named deviation. `[exceeds]`: a real directory picker with sidebar
  favourites and recent places.
- Every add or remove is marked with the restart cost the row carries in
  `LaunchSettingMatrix.restartRequired`, and several changes batch into one `RestartRequest` —
  `App/Header/RestartRequiredSettings.swift` exists for exactly this. The terminal's
  always-session-scoped quirk disappears: afleet's list is the launch list, so every change is
  durable for that channel by construction, and a separate `Remember for new channels in this
  project` checkbox writes `permissions.additionalDirectories` to project-local settings (E-10's
  write routes).
- The removal confirmation keeps its copy verbatim, with the restart cost appended.

**Drops / keeps / gains.**
*Drops:* the tab-completion field and four of its five validation strings, the session/remember
distinction, `Add directory…` as an inline row.
*Keeps:* the workspace explanation line, the `(Original working directory)` marker, the
already-added error, the removal confirmation copy, `Workspace dialog dismissed`'s job (a change
record) as a timeline notice row.
*Gains:* `[exceeds]` a native directory picker; `[exceeds]` per-source attribution for each
directory; `[exceeds]` batched restarts rather than one restart per directory.

**Open.** Should removing a directory also offer to remove it from project settings, or only from
this channel's launch list? The terminal conflates the two; afleet has to choose.

## D. `/mcp`

### E-14 · The server list: `Manage MCP servers`

**Terminal.** `/mcp` has **two** registrations sharing one name (SPEC 31 §18, SPEC 28 §5): an
interactive `local-jsx` with `thinClientDispatch: "twin"` and argument hint
`[reconnect <server>|enable|disable [<server>|all]]`, and a hidden non-interactive `local` twin
with `supportsNonInteractive: true`. The interactive panel is titled `Manage MCP servers` with
subtitle `<N> server(s)` (verified `cli.pretty.js:483933`) and groups servers under scope headings
in the order `Project MCPs`, `Local MCPs`, `User MCPs`, `Enterprise MCPs`, `Managed MCPs`,
`Active agent MCPs`, plus `Built-in MCPs` and `claude.ai`. Each row is
`[pointer][name] · [glyph] [status][ · managed]`; the status has **thirteen branches**, tested in
order (`cli.pretty.js:483965-484030`):

| Status text | Glyph / tone |
|---|---|
| `disabled` | `radioOff`, inactive |
| `connected · session token rejected` | `triangleUpOutline`, warning (verified `cli.pretty.js:483976`) |
| `connected · tools fetch failed` | warning |
| `connected · no tools` | warning |
| `connected · <n> tool(s)` | `tick`, success |
| `connected` | `tick`, success |
| `cached <time> · connects on first use · <n> tool(s)` | its own |
| `reconnecting (<n>/<m>)…` | inactive |
| `connecting…` | inactive |
| `needs authentication` | warning |
| `not configured` | inactive |
| `config issue` | `cross`, error |
| `failed` | `cross`, error |

The footer reads `※ Run claude --debug to see error logs`, `※ Error logs shown inline with
--debug` and `https://code.claude.com/docs/en/mcp for help`. The non-interactive twin prints one
line and uses a **different** status vocabulary (`connected`, `cached (connects on first use)`,
`connecting`, `disabled`, `not connected`, `needs authentication`, `pending approval`, verified
`cli.pretty.js:193185`), and `claude mcp list` uses a **third** (`✓ Connected`, `! Needs
authentication`, `⊘ Disabled for this project (re-enable via /mcp)` …, SPEC 31 §7.4). A suppressed
duplicate renders `<name> · ○ hidden — same URL as your server '<other>'` with one of six hint
lines.

**Job.** Knowing which of your tool providers are actually working, at what scope they are
configured, and which need attention — before a tool call fails.

**Wire.** P for the list, D for most of its detail. `mcp_status` answers
`{mcpServers: [{name, status, serverInfo?, error?, config?, scope?, tools?, capabilities?}]}`
(`areas/31-27-mcp-hooks.md:79`) — but the projection maps `cached` → `pending` (D, line 46),
populates `error` only when `status === "failed"` so a `needs-auth` server carries no error text
(D, line 48), drops `errorCode` (D, line 49), drops `negotiatedProtocolVersion` (D, line 50), and
omits suppressed duplicates entirely (D, line 35). `config` is redacted by transport and the stdio
`env` block is deliberately absent. **There is no push frame: `mcp_status` is poll-only** (README
§5 A-31/27). Scope arrives on the wire (`local`/`user`/`project`/`dynamic`/`enterprise`/
`claudeai`/`agent`) but `dynamic` conflates `--mcp-config` with plugin servers, which the terminal
splits by `pluginSource` — not carried (line 28).

**afleet today.** `built`, and reduced to two fields. `App/Header/HeaderMenus.swift:71-92` is the
whole surface: a popover listing `Text(server.name)` and `Text(server.status)` in secondary text,
with `No MCP servers.` as the empty state. Its own doc comment says *"the servers the strategy
answered with and their status, and nothing derived from either."* The reduction happens upstream
too — `ClaudeWire/Sources/WireFrames/SystemFrames.swift:8` defines `MCPServerStatus` with exactly
`name` and `status`, and `FleetKit/…/CommandRouter.swift:370-375` parses `mcp_status` into the same
two fields, discarding `scope`, `tools`, `config`, `error` and `capabilities` at the type level.
The rows are inert: there is no click target and no detail view. `mcpServers` is populated once per
popover open (`ChannelHeaderActionsModel.swift:64-67`) and never refreshed. Root spec §7.7's row is
one line — `/mcp` → *"MCP popover from `mcp_status`, with the `mcp_*` requests behind it"* — so the
surface is `routed-only` in design terms and thinly `built` in code.

**GUI form.** Settings → Claude Code → Extensions → **MCP**, plus the header popover kept as a
status-only glance with a `Manage…` link. The pane restores what the type reduction dropped:

```
┌─ Settings › Claude Code › Extensions › MCP ────────────────────────────────────┐
│  4 servers                       ⌕ Filter        [+ Add server]  [Reconnect all]│
│  ── Project MCPs ── .mcp.json ─────────────────────────────────────────────────│
│   ✔ supabase          connected · 12 tools                                      │
│   ⚠ linear            needs authentication              [Authenticate]          │
│  ── User MCPs ── ~/.claude.json ───────────────────────────────────────────────│
│   ✔ advisor           connected · 3 tools                                       │
│   ○ playwright        disabled                          [Enable]                │
│  ── Built-in MCPs ── always available ─────────────────────────────────────────│
│   ✔ afleet            connected · 1 tool                                        │
└────────────────────────────────────────────────────────────────────────────────┘
```

Deviations and additions, each named:
- **Scope headings restored from `mcp_status.scope`**, keeping the terminal's heading words and
  their path suffixes verbatim (`<projectRoot>/.mcp.json`, `~/.claude.json [project: <cwd>]`,
  `~/.claude.json`, `provided by your organization`). afleet cannot split `dynamic` into
  command-line versus plugin (D), so it uses one heading, `Dynamic MCPs`, and says so on hover.
- **The thirteen status strings and their glyph/tone mapping are kept verbatim** — including
  `connected · session token rejected`, which is the one status that tells a user their session
  token, not their config, is the problem. afleet can render eleven of them; `cached` arrives as
  `pending` and `reconnecting (n/m)` never arrives, so those two are marked unverified and render
  as `connecting…`. Named loss, wire-caused.
- **A poll, made visible.** Because there is no push frame, the pane polls `mcp_status` on open,
  on window focus, and every 30 s while visible, and shows `Updated <n>s ago` — a GUI that silently
  polls will show a stale `failed` after the user fixed it. `[exceeds]` over the terminal only in
  honesty; the terminal has the same staleness and no readback.
- **The first-poll trap is honoured**: root spec §6.2 records that *"an `mcp_status` sent
  immediately after the handshake returned an empty list"* with in-process bring-up completing
  ~0.9 s after `initialize`, and that afleet *"never fails a launch on the first empty answer"*.
  The pane must show `Starting…`, not `No MCP servers.`, until a second poll.
- **The three `--debug` footer lines are dropped**; afleet's equivalent is the Errors surface of
  E-25 and the Developer section's raw-frame capture.

**Drops / keeps / gains.**
*Drops:* the `--debug` footer, the two duplicate status vocabularies (afleet uses the interactive
one everywhere), suppressed-duplicate rows (not on the wire).
*Keeps:* the title, the scope headings and their order and path suffixes, eleven of thirteen status
strings with glyphs and tones, the `· managed` suffix.
*Gains:* `[exceeds]` a visible freshness readback; `[exceeds]` filter; `[exceeds]` the list is
persistent instead of a popover that closes on any click.

**Open.** Should the MCP pane be per-channel (each channel has its own client set) or per-project?
The wire answers per session. A fleet app with twenty channels in one project will show the same
server twenty times unless afleet dedupes, and dedupe hides a server that failed in only one
channel.

### E-15 · The per-server detail view and its action menu

**Terminal.** Selecting a server opens a view titled `<name> MCP Server` whose table rows are, in
order, `Status:`, `Issue:` (only when failed or needs-auth with an error), `Auth:`, `Protocol:`,
`Managed:`, `URL:`, `Config location:`, then capabilities and `Tools:` outside the table
(SPEC 31 §18.3, labels confirmed `cli.pretty.js:383173`). A stdio server gets a different row set:
`Status:`, `Command:`, `Protocol:`, `Args:`, `Config location:`, `Tools:`, `Issue:`
(`cli.pretty.js:383250`). The detail status set has eleven branches, **without** the list's tool
count and reconnect counter. The action menu is ten labelled entries, conditionally present
(SPEC 31 §18.3, all confirmed `cli.pretty.js:383146-383172`): `Enable`, `View tools`,
`Clear authentication` (connector), `Authenticate` (connector), `Re-authenticate`,
`Clear authentication`, `Authenticate`, `Reconnect`, `Disable`, `Back`. Auth entries are withheld
when the server is disabled, policy-blocked, first-party-hosted, or failed with
`HEADERS_HELPER_AUTH_REJECTED`. Reconnect shows `Connecting to <name>…` /
`Establishing connection to MCP server` / `This may take a few moments.` or
`Reconnecting to <name>` / `Restarting MCP server process`. An agent-scope server gets a read-only
variant with subtitle `agent-only`, rows `Type:`, `URL:`/`Command:`, `Used by:`, status
`○ not connected (agent-only)` and the note
`This server connects only when running the agent.`

**Job.** Diagnosing one server: is it reachable, what is it configured as, where does that config
live, and what can I do about it right now.

**Wire.** Mixed. `mcp_reconnect` and `mcp_toggle` are **P** (`areas/31-27…:53`, `:31`). The rows
are largely D: no `errorCode`, no `Used by:`, no `Auth:`, no protocol version, no error text for
`needs-auth`. `config` is on the wire but transport-redacted, which covers `URL:`, `Command:` and
`Args:` but not `env`. `Config location:` is not on the wire — it must be derived from `scope`
(R, line 27). One thing the GUI gets for free that the terminal has no surface for at all:
`set_mcp_permission_mode_override` — *"There is no TUI surface for this at all — a GUI exceeds the
TUI here"* (line 83).

**afleet today.** `undesigned`. Seven of afleet's eight implemented `mcp_*` requests have **no UI
caller** — `ClaudeWire/Sources/WireFrames/OutboundRequests.swift` defines `MCPAuthenticate` (:77),
`MCPOAuthCallbackURL` (:85), `MCPClearAuth` (:89), `MCPStatus` (:137), `MCPSetServers` (:138),
`MCPReconnect` (:141), `MCPToggle` (:144) and `MCPCall` (:162); only `MCPStatus` is reachable from
`App/`. `set_mcp_permission_mode_override` is not implemented at all. This is the highest
value-per-cost gap in the lane: the wire work is done and the UI is four buttons.

**GUI form.** An inspector below or beside the list, not a pushed view. All seven row labels kept
verbatim with their conditional presence, both transport variants, and the agent-only variant
including its note. Rows afleet cannot fill (`Auth:`, `Protocol:`, `Used by:`, and `Issue:` for a
`needs-auth` server) are **omitted rather than shown empty**, with one line at the foot:
`Some details are only available in the terminal.` Authored copy; an empty labelled row reads as a
bug. `Config location:` becomes a click-through that reveals the file in the Files panel.

The ten menu entries become buttons in the inspector's action row, keeping their labels verbatim
and their conditional logic exactly — including withholding auth for policy-blocked and
first-party-hosted servers, which is a security behaviour, not a convenience. Two additions:

- **`Tool permissions`** — a per-server control for `set_mcp_permission_mode_override`, which the
  terminal cannot offer. Placed in the inspector, not the permissions pane, because it is scoped to
  a server. `[exceeds]`, and named as such by the inventory.
- **Reconnect progress kept as a row state**, not a screen: the terminal's three progress lines
  become the inspector's status line while the request is in flight. The reconnect ladder itself
  (five attempts, backoff `min(1000·2^(n−1), 30000)`) is engine-internal and not on the wire (D),
  so afleet cannot show `reconnecting (3/5)`; it shows an indeterminate progress state and says
  `Reconnecting…`.

**Drops / keeps / gains.**
*Drops:* the pushed-view navigation, `Back`, the reconnect attempt counter, the empty rows for
D-class fields.
*Keeps:* the title, both row orders, the eleven detail status branches, all ten menu labels and
their conditions, the agent-only variant and its note, the reconnect progress copy.
*Gains:* `[exceeds]` per-server tool-permission override; `[exceeds]` click-through to the config
file; `[exceeds]` actions reachable without leaving the list.

**Open.** None for the design; the build order question (which of the seven dead requests to wire
first) is a ranking input, and the answer is `mcp_toggle` and `mcp_reconnect`.

### E-16 · Authentication: `needs-auth`, the OAuth flow, and clearing auth

**Terminal.** A server that fails an auth challenge lands in `needs-auth` and is cached there —
`<claudeConfigDir>/mcp-needs-auth-cache.json`, TTL 900000 ms normally, 14400000 ms for claude.ai
connectors, 90000 ms for a qualifying 401 reauth failure (SPEC 31 §10.3, debug line
`Skipping connection (cached needs-auth)` verified `cli.pretty.js:68588`). It surfaces in four
places: the list badge `⚠ needs authentication`; a persistent startup notice
`<N> MCP server(s) need authentication · run /mcp` (`cli.pretty.js:392310`, id `mcp-needs-auth`);
two synthetic tools `mcp__<server>__authenticate` and `mcp__<server>__complete_authentication` that
replace the server's real tools **in interactive sessions only**; and, non-interactively, a system
reminder telling the model the session cannot run OAuth. Choosing `Authenticate` draws
`Authenticating with <name>…`, `A browser window will open for authentication`,
`If your browser doesn't open automatically, copy this URL manually`,
`If the redirect page shows a connection error, paste the URL from your browser's address bar:` and
`Return here after authenticating in your browser. Press Esc.` The CLI serves a loopback listener on
`127.0.0.1:<port>/callback` whose success page reads `Authentication successful` /
`You can close this tab and return to Claude Code.`, whose state-mismatch page reads
`Authentication failed` / `Invalid state parameter. Close this tab and try again from Claude Code.`,
and which times out at 300000 ms with `Authentication timeout` (SPEC 31 §10.4). Clearing auth for a
connector draws `Clear authentication for <name>`,
`Find the MCP server in the browser and click "Disconnect".`, `Press Enter when done.` and
`Authentication cleared for <name>.`

**Job.** Getting a server working again without leaving the app, and knowing which server is
blocking a task.

**Wire.** P, and this is the strongest single result in the parity inventory. README §4 finding 14:
*"The account login flow and MCP OAuth are drivable headless. … `mcp_authenticate` returns
`{authUrl, callbackExpected, redirectScheme: localhost, state}`; the CLI opens the localhost
callback listener itself."* Three response shapes exist (connector, OAuth-with-URL, completed-from-
cache), and the flow *"always runs with `skipBrowserOpen: true`, so the CLI never opens a browser
on this path — the host owns opening `authUrl`"* (`areas/31-27…:108-118`). `mcp_oauth_callback_url`
is needed only when the browser cannot reach the loopback port. `mcp_clear_auth` works for `sse`
and `http` and refuses connectors with `Cannot clear auth for server type "claudeai-proxy"` (X;
connector disconnect is a claude.ai web action). **The trap the inventory names explicitly**
(line 160): *"A GUI's 'Retry' button will appear to do nothing while the needs-auth cache is warm,
because `connectToServer` short-circuits. … Practical guidance: drive re-auth through
`mcp_authenticate`, not `mcp_reconnect`."*

**afleet today.** `undesigned` as a surface, wire-complete underneath. The three auth requests
exist in `OutboundRequests.swift:77-89` and have no caller. The root spec's §6.4 table at line 488
already assigns them — *"MCP OAuth from the MCP popover (Parity F-14)"* — so this is a designed
mechanism with no designed surface. `needs-auth` appears **nowhere** in the workspace design spec;
today the raw string `needs-auth` would print as grey text beside the server name.

**GUI form.** afleet is better placed for this than the terminal, because it has a Browser panel.

1. **The badge.** `⚠ needs authentication` on the row, kept verbatim, with an inline
   `[Authenticate]` button — the terminal needs three navigations to reach the same action.
2. **The flow.** `mcp_authenticate` → open `authUrl` **in the Browser panel tab**, exactly as root
   spec §7.7 already specifies for `/login` (*"afleet opens the automatic URL in the Browser tab and
   the CLI's localhost listener completes it"*). When `redirectScheme` is `localhost` the CLI
   completes the exchange itself and afleet just polls `mcp_status`; when the callback cannot reach
   the loopback port, afleet reads the URL out of its own web view and sends
   `mcp_oauth_callback_url` — which is strictly better than the terminal's
   `paste the full URL from your browser's address bar`, because afleet already has the URL.
   `[exceeds]`, and it removes the single ugliest step in the terminal flow.
3. **The Retry trap, designed around.** afleet's reconnect affordance on a `needs-auth` server
   sends `mcp_authenticate`, never `mcp_reconnect`. This is not a preference; a reconnect will
   appear to do nothing for up to four hours.
4. **The startup notice** becomes a channel banner (§2) reading
   `<N> MCP server(s) need authentication`, with `Fix…` opening the MCP pane filtered — keeping the
   terminal's sentence minus its `· run /mcp` tail.
5. **Clear authentication** keeps its four strings verbatim for connectors, including the
   click-`Disconnect`-in-the-browser instruction, with the browser step opening in the Browser
   panel. For `sse`/`http` it is a direct `mcp_clear_auth`.
6. **The synthetic auth-stub tools are superseded.** They exist so an interactive *model* can run
   the flow; afleet's user runs it from the pane. They are suppressed non-interactively anyway
   (X), so nothing is lost.

**Drops / keeps / gains.**
*Drops:* the auth-stub tools, the copy-the-URL-manually instruction, the loopback listener's HTML
pages (afleet's web view shows them but the user never needs them), the terminal's
`Press Esc` return instruction.
*Keeps:* `⚠ needs authentication`, the authenticating progress copy, the clear-auth sequence
verbatim, the connector refusal, the startup notice sentence.
*Gains:* `[exceeds]` the browser is inside the app, so the callback URL never has to be copied by
hand; `[exceeds]` one-click authenticate from the row.

**Open.** The needs-auth cache TTL is not on the wire (D). Should afleet show *when* a server will
retry by itself, and if so does it need a probe to read the cache file (which it may read but not
write)?

### E-17 · `View tools`, and the resources and prompts the panel never shows

**Terminal.** The per-server menu offers `View tools` when the server is connected or cached with
at least one tool, and nothing else: **there is no `View resources` and no `View prompts` action,
and the detail table carries no resource or prompt counts** — confirmed by exhausting the §18.3
menu table and the binary's label dump. Resources are reached only through the
`ListMcpResources` / `ReadMcpResource` tools and `@server:uri` mentions (SPEC 31 §13, §13.5);
prompts become slash commands named `mcp__<server>__<prompt>` (SPEC 31 §14). SPEC 31 §18 documents
**nothing** about what `View tools` draws; the only description found anywhere is the somersault
clone's, which built *"a canon-shaped view-stack browser (list → server menu → tools → tool detail,
router L582270) over a defensive normalization of `session.mcpServerStatus()`"*
(`CC-to-SDK/docs/parity/tui-ux.md:1072-1074`) — so a **tool-detail level exists below `View
tools`**, and the SDK's shape needed normalising.

**Job.** Seeing what a server actually gives the model, which is the only way to tell a
misconfigured server from a working one that offers nothing useful.

**Wire.** R, degraded. `mcp_status.tools` is present only for connected and cached clients and
carries `{name, annotations:{readOnly?, destructive?, openWorld?}}` — *"no descriptions and no
input schemas"*, live-confirmed as `[{"name":"advisor_ask","annotations":{}}]`
(`areas/31-27…:79`, `:141`). For a normal (non-SDK) server *"there is **no** control request that
returns tool descriptions"*; `claude mcp get <name>` fills the rest from disk. Resources are worse:
*"The wire has no way to enumerate MCP resources for an `@` picker… For ordinary servers there is
no host-side resource listing at all"* (line 195), and `capabilities` is only
`{experimental:{…}}`, *"so a GUI cannot learn whether a server offers prompts or resources"*.

**afleet today.** `undesigned`. `mcp_status.tools` is discarded at the type level
(`SystemFrames.swift:8`), so afleet does not even have the names.

**GUI form.** A `Tools` section inside the E-15 inspector — a disclosure listing tool names with
their three annotation badges (`read-only`, `destructive`, `open-world`), which is exactly what the
wire carries and no more. Descriptions and schemas are shown when afleet can get them from
`claude mcp get <name>` (class 4, a CLI subprocess) and omitted otherwise, with the section header
reading `Tools (12) — names only` when descriptions are unavailable. Naming the limitation in the
header is the honest form; a list of bare names under a header that promises more reads as a
broken feature.

Two things afleet should add that the terminal does not have, both cheap:
- **Prompts.** MCP prompts arrive as slash commands `mcp__<server>__<prompt>` in the handshake's
  `commands` list, which afleet already consumes for autocomplete (root spec §7.7). Grouping them
  by server in the inspector costs a filter and gives the panel something the terminal never
  shows. `[exceeds]`.
- **Resources, honestly absent.** One line: `Resources are not listed here; type @<server>:<uri>
  in the composer to attach one.` Authored copy, and true — `@server:uri` resolves when typed even
  though the picker has no data for it (`areas/31-27…` README bullet).

**Drops / keeps / gains.**
*Drops:* the pushed tools screen and the tool-detail level beneath it (afleet's inspector holds
both).
*Keeps:* the fact that `View tools` is offered only for connected or cached servers with tools.
*Gains:* `[exceeds]` prompts grouped by server; annotations shown as badges; an explicit statement
of what is not listed.

**Open.** Is a `claude mcp get` subprocess per server acceptable to fill in descriptions, or should
the panel stay wire-only? A subprocess per server on every pane open is not free.

### E-18 · The project `.mcp.json` approval — the one place afleet is already ahead

**Terminal.** A `.mcp.json` server the user has not decided about triggers, at startup, a dialog
titled `New MCP server found in this project: <displayName>` in the `warning` colour with three
options and **default focus on the last** (verified `cli.pretty.js:290079`): `Use this MCP server`,
`Use this and all future MCP servers in this project`, `Continue without using this MCP server`.
Cancelling counts as declining. The shared explanation reads `MCP servers may execute code or
access system resources. All tool calls require approval. Learn more in the MCP documentation.`
Several servers get a multi-select variant titled `<N> new MCP servers found in this project` with
subtitle `Select any you wish to enable.`, submit button `Enable selected`, and `Esc reject all`.
`yes` appends to `localSettings.enabledMcpjsonServers`; `yes_all` also sets
`enableAllProjectMcpServers = true`; `no` appends to `disabledMcpjsonServers` (SPEC 31 §6.1).

**Job.** The security moment: a repository you just cloned can declare a server that runs code, and
this is the only thing standing between cloning and running it.

**Wire.** X, and the inventory calls the loss out in as many words: *"The `.mcp.json` approval
dialog never happens headless: project servers are silently approved (X, security moment lost;
build a consent step from the file)"* (README §5 A-31/27). Worse, with `--setting-sources` lacking
`projectSettings` the servers are **silently dropped** instead (`areas/31-27…:29`).

**afleet today.** `built`, and better than the terminal in two respects.
`FleetKit/Sources/FleetSessions/Preconditions/ProjectMCPConsent.swift` models the verdict
(`rejected` > `approved` > `pending`) reading the same keys the CLI reads, and hashes the whole raw
`.mcp.json` entry so *"args/env/headers/url changes reopen consent"* — the terminal's approval is
by name and does not reopen when the command changes. `App/Consent/ConsentSheet.swift` presents
`Project MCP servers` with three buttons `Not now` / `Decline` / `Accept`, `Accept` as the default
action and `Not now` deliberately leftmost, and a preamble explaining that acceptance is remembered
*"until that configuration changes"*. Root spec §6.12 specifies it, and it is the one Claude
Code-owned file afleet writes. Decline is gated on no live owned process because *"an `mcp_toggle`
after the fact arrives too late"* (`SpawnPreconditions.swift:72-73`).

**GUI form.** Keep what is built; close three gaps against canon.

- **The missing third option.** The terminal offers `Use this and all future MCP servers in this
  project`, which writes `enableAllProjectMcpServers`. afleet has no equivalent, so a project that
  adds a server every week reprompts every week. Add it as a checkbox inside the sheet —
  `Trust future servers in this project too` — rather than a fourth button.
- **Default focus.** The terminal focuses the *declining* option and treats cancel as decline;
  afleet makes `Accept` the default action and closing the sheet a *Not now*. The afleet choice is
  defensible (a three-way answer where the terminal has a two-way one), but it inverts a security
  default deliberately chosen upstream. Flag for the owner rather than change silently.
- **The explanation sentence.** afleet's preamble is its own; the terminal's
  `MCP servers may execute code or access system resources. All tool calls require approval.` says
  the risk in one line and should be kept alongside afleet's remembering-semantics sentence.
- **Per-server detail.** afleet shows name plus a transport summary; the terminal shows a display
  name that renders plugin servers as `<server> (from plugin <plugin>)`. Keep that form.

**Drops / keeps / gains.**
*Drops:* the multi-select variant's `Enable selected` phrasing (afleet's sheet is already
multi-server), `Esc reject all` (afleet's Escape is *Not now*, a deliberate difference).
*Keeps:* the risk sentence, plugin display names, the per-project scope.
*Gains:* `[exceeds]` re-consent when a server's configuration changes, not just its name;
`[exceeds]` a three-way answer with a genuine *decide later*; `[exceeds]` the consent happens
before the first spawn rather than as a startup interruption.

**Open.** Should closing the sheet default to decline, matching upstream's security posture? Owner.

## E. `/hooks`

### E-19 · The `/hooks` viewer: four levels, read-only by design

**Terminal.** `/hooks` is `{type: "local-jsx", description: "View hook configurations for tool
events", immediate: true, requires: {workspace: false, ink: true}}` (verified
`cli.pretty.js:788497`) and opens a four-level browser (SPEC 27 §21.2): `Hooks` with subtitle
`<N> hook(s) configured` → `<Event> - Matchers` → `<Event> - Matcher: <matcher|(all)>` →
`Hook details`. It seeds one bucket per event from a flat list of **all 33 events** in SPEC 27 §2
order, so every event appears whether or not it has hooks; an event with no matcher target skips
level two. Matcher rows read `[<sources>] <matcher or "(all)">` with description `<N> hook(s)`;
hook rows read `[<type>] <summary>` with the source's long label and, for plugin hooks,
` (<plugin>)`. Ordering is by source precedence `localSettings`, `projectSettings`, `userSettings`,
then plugin and built-in, ties by `localeCompare`. The detail screen's rows are `Event:`,
`Matcher:`, `Type:`, `Source:`, `Plugin:`, `Status message:`, then a captioned box whose caption is
`Command` / `Prompt` / `URL` / `MCP tool` / `Script file` / `Script`.

**It says three times that it is read-only** (SPEC 27 §21.1, verified `cli.pretty.js:853460`):
`ℹ This menu is read-only. To add or modify hooks, edit settings.json directly or ask Claude.`,
`To add hooks, edit settings.json directly or ask Claude`, and
`To modify or remove this hook, edit settings.json directly or ask Claude to help.` The empty state
is two lines on both the matcher and hook screens (verified `cli.pretty.js:853527`, `:853592`):
`No hooks configured for this event` / `To add hooks, edit settings.json directly or ask Claude`.
Eight sources exist but the viewer's collector walks only `userSettings`, `projectSettings`,
`localSettings` plus session hooks, and adds plugin entries — so **`flagSettings` and
`policySettings` hooks are enforced and never listed** (SPEC 27 §21.3). Dismissal logs
`Hooks dialog dismissed`.

**Job.** Answering "what runs when Claude does X, and where is it configured" — the only way to
audit a hook without reading four settings files by hand.

**Wire.** X for the command (*"Refused headless — live-confirmed: sending `/hooks` returned
`/hooks isn't available in this environment.`"*, `areas/31-27-mcp-hooks.md:336`), R for everything
in it, from `get_settings` plus disk. Line 337 makes the build cheap and the ceiling explicit:
*"This lowers the bar substantially: a GUI only needs a viewer, and can then exceed the TUI by
adding an editor (`update_settings` writes `localSettings`; user/project settings need direct file
writes)."* Line 340 poses the one judgement call: *"`flagSettings` (`--settings`) is deliberately
**not** listed by `/hooks`, so a GUI that passes `--settings` should decide whether to be more
honest than the TUI here."*

**afleet today.** `undesigned` as a viewer, and unusually well-equipped underneath. What exists is
*runtime* hook observability: `ClaudeWire/…/InitializeConfiguration.swift:4-13` enumerates all 33
events; afleet registers two SDK callbacks (`afleet.notification`, `afleet.config-change`, `:27-29`);
`--include-hook-events` is passed (`LaunchConfiguration.swift:86`); `system/hook_started`,
`hook_progress` and `hook_response` are fully decoded (`SystemFrames.swift:99-126`), folded
(`WireReducer.swift:350-370`) and rendered as a one-line timeline row
(`App/Timeline/Rendering/Rows/NoticeRows.swift:8-22`). None of that is a *configuration* viewer:
nothing reads a `hooks` key from `get_settings`. `/hooks` has no row in `RouterTable.local` and no
row in root spec §7.7, so it falls to the generic interactive-panel sentence.

**GUI form.** Settings → Claude Code → Extensions → **Hooks**, a three-column browser (events with
counts | matchers | hooks) with the detail inspector below — the terminal's four levels flattened
into one screen, which is the whole point of having a window. Kept verbatim: the 33 events in
canon order including empty ones, the row label shapes, the source ordering, the six detail rows
and the caption map, the two-line empty state.

Three deliberate changes:
1. **The read-only sentence is kept, but afleet's version names its own affordance.** The
   terminal's `edit settings.json directly or ask Claude` becomes
   `This view is read-only. Open the settings file to add or change a hook.` with an `Open file`
   button that reveals the exact file and key in the Files panel. Faithful in substance —
   still read-only — and actionable, which the terminal's sentence is not.
2. **`flagSettings` and `policySettings` hooks are listed**, marked `not shown in the terminal`.
   afleet is a host that may pass `--settings`; hiding hooks it caused would be a bug wearing
   fidelity as an excuse. `[exceeds]`, and the inventory asks for exactly this decision.
3. **Runtime and configuration joined.** Each hook row shows its last run from the frames afleet
   already folds — `last ran 4m ago · exit 0` — which no terminal surface can show, because
   `/hooks` reads config and the transcript shows runs and the two never meet. `[exceeds]`, and it
   is nearly free given `HookRunItem` exists.

**Drops / keeps / gains.**
*Drops:* the four-level navigation, the `Back` walk, `Hooks dialog dismissed`.
*Keeps:* all 33 events including empty buckets, row-label shapes, source ordering and labels, the
detail row order and caption map, the empty state, read-only-ness.
*Gains:* `[exceeds]` flag- and policy-sourced hooks listed; `[exceeds]` last-run status per hook;
`[exceeds]` click-through to the owning file.

**Open.** Should afleet go further and offer a hook *editor* (the inventory says `localSettings` is
writable and the rest needs file writes)? This card proposes viewer-plus-open-file for v1 and flags
the editor as a separate, larger surface.

### E-20 · Hooks disabled, safe mode, policy — and the snapshot-reload trap

**Terminal.** Three banner states and one whole-screen pre-empt (SPEC 27 §21.4). Safe mode draws
`ℹ Safe mode` with `Hooks from settings files are suspended and will not run this session[
(managed policy hooks still apply)]; session hooks created by /goal, agents, and skills still run.
Settings edits save but don't load until safe mode is off.` Policy restriction draws
`Hooks Restricted by Policy` / `Only hooks from managed settings can run. User-defined hooks from
~/.claude/settings.json, .claude/settings.json, and .claude/settings.local.json are blocked.` And
when all hooks are off, a screen titled `Hook configuration · disabled` (verified
`cli.pretty.js:854001`, the `·` is `\xB7`) pre-empts **every** mode except the cloud-consent one:

```
All hooks are currently disabled[ by a managed settings file]. You have <N> configured hook(s)
that <is|are> not running.

When hooks are disabled:
· No hook commands will execute
· StatusLine will not be displayed
· Tool operations will proceed without hook validation

To re-enable hooks, remove "disableAllHooks" from settings.json or ask Claude.
```

The last line is suppressed when the switch came from managed policy. SPEC 27 §20 lists **seven**
disable switches (`policySettings.disableAllHooks`, `allowManagedHooksOnly`, safe mode,
`strictPluginOnlyCustomization: ["hooks"]`, non-managed `disableAllHooks`, bare mode, untrusted
workspace), and records that **SDK callback hooks are exempt from the policy kill switch**. Opening
`/hooks` has a side effect: it **forces a settings reload**, refreshing the frozen snapshot
(SPEC 27 §21.7).

**Job.** Telling a user why their hook did not fire — which is the single most common hook
question, and the reason the disabled screen pre-empts everything else.

**Wire.** R for all three banners from `get_settings.effective` (`disableAllHooks`,
`allowManagedHooksOnly`, `strictPluginOnlyCustomization`) plus knowledge of afleet's own flags
(`areas/31-27…:341-343`). One **D** and it is sharp (line 345): *"**No control request refreshes
the hooks snapshot.** … a GUI that writes a new hook to `.claude/settings.json` may find it does
not fire until the session restarts… Safe workaround: restart the child session after writing
hooks, or register the hook as an SDK callback via a fresh `initialize` instead of writing a
file."* And a **P with a trap** (line 346): headless `-p` skips the trust dialog, so *"a GUI
running `-p` in an untrusted directory silently runs no hooks at all"*; the inventory's advice is
to check `projects[<cwd>].hasTrustDialogAccepted` in `~/.claude.json` and present a trust step.

**afleet today.** `undesigned`. Nothing renders any of the three states. The trust check the
inventory asks for is partly present in spirit — afleet has a trust dialog for `set_cwd`
(root spec §7.7) — but nothing connects it to hooks being silently inert.

**GUI form.** All three states render as a banner **at the top of the Hooks pane**, keeping the
copy verbatim including the two conditional clauses and the suppression of the last line under
managed policy. Two additions afleet needs because it is a multi-channel host:

- **A channel banner, not only a settings banner.** If hooks are disabled for a channel, the
  channel banner region (§2) carries `Hooks disabled` with a link to the pane. A user watching a
  timeline should not have to open Settings to learn that their `PreToolUse` guard is off.
- **The reload trap, made visible.** After afleet writes or the user edits a hook file, the pane
  shows `Changed hooks are not loaded in 3 running channels` with a `Restart channels` action that
  reuses `App/Header/RestartRequiredSettings.swift`'s quiescent restart. This is the honest
  translation of the terminal's hidden side effect: `/hooks` forces a reload, afleet cannot, so
  afleet says so and offers the only mechanism that works. Authored copy.

The seventh disable switch — untrusted workspace — gets its own line, because the inventory's trap
says it fails *silently* under `-p`: `Hooks are not running: this directory has not been trusted.`
with a `Trust this directory` action driving the existing `set_cwd` trust round trip.

**Drops / keeps / gains.**
*Drops:* the whole-screen pre-empt (a banner does the job in a pane), the `/hooks`-forces-a-reload
side effect (afleet has no such request).
*Keeps:* all three banner texts verbatim, the conditional clauses, the last-line suppression, the
three-bullet consequence list.
*Gains:* `[exceeds]` the disabled state reaches the channel banner, not only the settings screen;
`[exceeds]` a restart affordance for the snapshot trap; `[exceeds]` a named, actionable
untrusted-workspace state where the terminal's headless path is silent.

**Open.** Should afleet prefer SDK callback hooks (which survive the managed `disableAllHooks`
switch, and are exempt by design) for its own needs, and does surfacing that exemption to users
amount to advertising a policy bypass? A real question for an enterprise-facing app.

## F. `/plugin` and marketplaces

### E-21 · The `/plugin` panel shell: five tabs

**Terminal.** `/plugin` (aliases `plugins`, `marketplace`, description `Manage Claude Code
plugins`, verified `cli.pretty.js:788504`) opens a panel titled `Plugins` with five tabs in order
(SPEC 30 §27.2): `Discover`, `Installed`, `Marketplaces`, `Errors` (rendered `Errors (<N>)` when
non-advisory errors exist) and `Stats` (gated on `tengu_lantern_prism`). Two redirect banners tell
users where things moved: `Skills are now managed here under the Skills section.` (verified
`cli.pretty.js:385939`) and `/skill-doctor moved — skill usage and context costs now live in this
Stats tab.` It has its own keybinding context (`Plugin`): `space` toggles, `i` installs, `f`
favourites; `/` opens search and any other printable key seeds it; `u`/`U` mark a marketplace for
update, `d`/`D` open its remove confirmation, `y`/`n` answer confirmations. `/plugin help` prints a
thirty-line usage block. The argument grammar has two traps: `install` splits `name@marketplace`
on the **last** `@`, and `eval` parses to `menu`, so the eval view is unreachable from the slash
command.

**Job.** One place to find, install, enable, update and diagnose everything that extends Claude
Code — the app store, and the only surface that explains why an extension is not working.

**Wire.** X for the panel, R for the capability. `areas/30-29-32-plugins-skills-styles.md:155-163`:
`/plugin` has no `local` twin, is verified absent from the live headless command list, and
invoking it returns *"`/<name>` opens an interactive panel and isn't available in this environment.
Run it from the Claude Code terminal instead."* — *"**Therefore every row below is X for the panel
itself and R for the capability.**"* Line 167 calls it *"the single largest rebuild in the area"*.
The capability route is the `claude plugin …` CLI (class 4) plus `reload_plugins` (P).

**afleet today.** `undesigned`, and unassigned. `/plugin`, `/plugins`, `/marketplace`, `/hooks` and
`/cloud-plugins` appear **nowhere** in root spec §7.7's router table, §13 or §17.8 — verified by
whole-file grep — so by §7.7's own class-3 rule they are pass-through text, and the engine's
refusal is intercepted and replaced with the generic sentence
`/plugin opens one of Claude Code's full-screen panels, which afleet has no equivalent of here.`
(`RouterTable.swift:119-121`). In code: no panel, no tabs, zero occurrences of `marketplace` in any
afleet source, and `SystemInitFields.plugins` (`SystemFrames.swift:20`) is decoded and never
consumed — the engine's plugin inventory reaches afleet and is discarded.

**GUI form.** Settings → Claude Code → Extensions → **Plugins**, a sidebar of five sections rather
than tabs, in the terminal's order and with its names. `Stats` is folded into the Skills pane
(E-30) rather than duplicated, since the terminal itself says the content moved there from
`/skill-doctor`; the two redirect banners are dropped, as afleet has no history of moving them.
The `Plugin` keybinding context survives as menu-bar commands and row shortcuts (`space` toggle,
`⌘I` install, `⌘D` favourite) rather than bare letters.

The panel-level decision this card fixes: **afleet's plugin surface is per-config-home, not
per-channel.** Plugins are installed for a user, a project or a repo checkout; a channel merely
loads them. So the pane lives in Settings and its only channel-aware element is the reload state
of E-26 — which channels are running with stale plugins.

**Drops / keeps / gains.**
*Drops:* the `Stats` tab (folded into Skills), the two redirect banners, `/plugin help`, the bare
single-letter chords, the `eval` grammar dead end.
*Keeps:* the four remaining tab names and their order, the error-count badge and its advisory-error
exclusion, the search-on-any-key behaviour as a live filter field.
*Gains:* `[exceeds]` a persistent pane; `[exceeds]` the five sections visible at once instead of a
tab strip in eighty columns.

**Open.** Does afleet want a plugin surface in v1 at all, or is this the right thing to defer? It
is the largest single build in the lane and the least connected to running a fleet of sessions.

### E-22 · Discover, the plugin detail pane, and the install flow

**Terminal.** The `Discover` tab lists installable plugins with a radio, display name, marketplace,
`[Community Managed]` badge, `[not installable on claude.ai yet]`, an eligible-install count for
the official marketplace, and a description truncated at 60 columns. It has **seven empty states**,
each encoding a real policy condition (SPEC 30 §27.4) — `Git is required to install marketplaces.`
/ `Please install git and restart Claude Code.`; `Your organization policy does not allow any
external marketplaces.` / `Contact your administrator.`; `Your organization restricts which
marketplaces can be added.` / `Switch to the Marketplaces tab to view allowed sources.`;
`No plugins available.` / `Add a marketplace first using the Marketplaces tab.`;
`Failed to load marketplace data.` / `Check your network connection.`;
`All available plugins are already installed.` / `Check for new plugins later or add more
marketplaces.`; and the project-scope variant. The detail pane shows name, `from <marketplace>`,
`Version:`, `Last updated:`, description, `By:`, a trust warning, the context-cost block, and
`Will install:` with six component lines (`Commands:`, `Agents:`, `Skills:`, `Hooks:`,
`MCP Servers:`, `LSP Servers:`) or `Component summary not available for remote plugin` /
`Components will be discovered at installation`. Context cost renders
`Context cost<estimated>:` / `· Every turn: <n> tokens` / `· When invoked: <n> tokens`, with
`Every turn` coloured `warning` at or above 2000 tokens. The install menu is six entries
(`Install for you (user scope)`, `Install for all collaborators on this repository (project
scope)`, `Install for you, in this repo only (local scope)`, `Open homepage`, `View on GitHub`,
`Back to plugin list`), the first pre-selected and relabelled `Installing…` while running. Results
read `✓ Installed <name><depNote>.` with an activation tail — ` Plugin is now active.`,
` Run /reload-plugins to apply.`, ` The plugin couldn't be loaded — see /plugin for details.` or a
disabled-by-default variant. **There is no "do you trust this marketplace?" dialog** (SPEC 30 §22);
the only standing text is the unconditional disclaimer (verified `cli.pretty.js:381037`):
`Make sure you trust a plugin before installing, updating, or using it. Anthropic does not control
what MCP servers, files, or other software are included in plugins and cannot verify that they will
work as intended or that they won't change. See each plugin's homepage for more information.`

**Job.** Finding an extension and understanding what it will do to your session before you install
it — components, token cost, and who wrote it.

**Wire.** R throughout, via the `claude plugin` CLI (class 4): `plugin install <plugin>` with
`-s <scope>`, `plugin details <name>` for the component inventory and projected token cost
(`areas/30-29-32…:171-173`). The inventory's guidance on the empty states is explicit (line 170):
*"The seven empty states encode real policy conditions… reproduce them or the user sees an
unexplained blank list."* It also flags an operational trap (top gap #7): *"the CLI refuses `-y`
when it detects it is inside a Claude Code session, and without a TTY it only displays the command.
A GUI shelling out must scrub Claude Code entrypoint env vars and either allocate a PTY or pass
`-y`."*

**afleet today.** `undesigned`. No install path of any kind; no shell-out to `claude plugin`
anywhere.

**GUI form.** A two-pane browse-and-detail layout, list left, detail right, with the six component
lines as a real inventory list and the context-cost block promoted to the top of the detail pane
rather than buried below the description — `[exceeds]`, and justified: a plugin that costs 2000
tokens every turn is the most consequential fact on the screen for a fleet running twenty channels,
and the terminal already colours it `warning`. All seven empty states are kept verbatim, both
lines each. The trust disclaimer is kept verbatim and is *not* collapsible.

The install menu becomes three scope buttons with the terminal's labels verbatim plus two link
buttons; the `Installing…` state is kept. The scope choice writes `enabledPlugins` through the CLI
subprocess (class 4), and afleet must do what the inventory warns: scrub the Claude Code entrypoint
environment variables and allocate a PTY or pass `-y`, or the subprocess will refuse or merely
print the command. That is an implementation constraint, not a design one, but a card that omitted
it would produce a feature that silently does nothing.

The activation tails are rewritten for afleet's mechanism — ` Run /reload-plugins to apply.`
becomes an inline `Apply now` button that issues `reload_plugins` (E-26), which the inventory
explicitly asks for (line 173: *"Rewrite the `/reload-plugins` tail — the GUI's equivalent is a
button that issues `reload_plugins`."*).

**Drops / keeps / gains.**
*Drops:* the 60-column description truncation, the `Back to plugin list` entry, the
`Run /reload-plugins` phrasing.
*Keeps:* the seven empty states verbatim, the detail row order, the six component lines and both
unavailable variants, the context-cost block and its 2000-token warning threshold, the three scope
labels verbatim, the trust disclaimer verbatim, the install result sentences.
*Gains:* `[exceeds]` context cost shown before the description; `[exceeds]` an `Apply now` button
instead of an instruction to type a command.

**Open.** None; the scope of this card is settled by the terminal.

### E-23 · The Installed tab: scopes, enable and disable, favourites, disuse

**Terminal.** `Installed` groups plugins into eight scope sections ordered `Flagged`, `Project`,
`Local`, `User`, `Enterprise`, `Managed`, `Built-in`, `Skills`, preceded by three cross-cutting
sections: `Needs attention`, `Favorites`, `Not used recently`. Favourites persist in the global
config key `favoritePlugins`; usage in `pluginUsage`, keyed `<name>@<marketplace>` with
`{usageCount, lastUsedAt, lastUsedNumStartups}`; a plugin qualifies as unused only at 14 days
**and** 10 sessions. Copy includes `Loading installed plugins…`, `Manage plugins`,
`No plugins or MCP servers installed.`, `▸ Show disabled (<N>) · unused claude.ai connectors (<M>)`
and `Run /reload-plugins to apply changes`. The per-plugin menu has eleven entries, the first three
toggling: `Disable plugin`/`Enable plugin`, `Remove from favorites`/`Add to favorites`,
`Unmark for update`/`Mark for update`, `Configure`, `Configure options`, `Update now`, `Uninstall`,
`Open homepage`, `View repository`, `Usage`, `Back to plugin list`. Refusals are specific:
`Built-in plugins cannot be updated or uninstalled.`, `This plugin is managed by your organization.
Contact your admin to disable it.`, `Local plugins cannot be updated remotely. To update, modify
the source at: <path>`. **The best copy in the chapter is a confirmation** (SPEC 30 §27.6):

```
<name> is enabled in .claude/settings.json (shared with your team)
Disable it just for you in .claude/settings.local.json?
The plugin stays installed for the project; only your local override changes.
```

The enable/disable state is the setting key `enabledPlugins`, `plugin-id@marketplace-id` →
`string[] | boolean | null`, whose own describe text spells out the precedence trap: *"Settings
precedence is user < project < local < flag < policy, so to disable a plugin that project settings
enable, set it to false in `.claude/settings.local.json` — setting false in
`~/.claude/settings.json` is overridden by the project."* Array values are inert in 2.1.263 and
must be preserved and round-tripped, never interpreted.

**Job.** Turning an extension off without uninstalling it, at the right scope, and finding the
ones you have forgotten you are paying context for.

**Wire.** P for reading (`enabledPlugins` via `get_settings`), R for writing:
*"Writing is disk-only — `update_settings` accepts only `outputStyle`… The GUI must write
`settings.json` / `settings.local.json` itself and then call `reload_plugins`"*
(`areas/30-29-32…:38-56`). The favourites and usage data are fully reproducible from
`~/.claude.json` (lines 176-177). And the inventory names the single highest-value message:
*"The **ineffective-write detection** (`Plugin "<id>" would still be enabled after writing <scope>
settings: <source> settings govern it`) is the highest-value message here and is easy to omit; it
needs `get_settings.sources[]`."*

**afleet today.** `undesigned`. No plugin state is read or written anywhere; `favoritePlugins`,
`pluginUsage`, `enabledPlugins` and `installed_plugins.json` have zero occurrences in afleet
sources.

**GUI form.** One list with a scope column and a group-by control defaulting to the terminal's
scope order, keeping all eight group names and the three cross-cutting sections. Per-row: a toggle
for enabled, a star for favourite, the usage line `last used <N> days ago` under the same 14-day
and 10-session rule, and a context-cost chip. The eleven menu entries become a row context menu
with their labels verbatim; the three refusal sentences are kept verbatim and rendered in place of
the disabled control.

Two things must be built exactly, or the surface misleads:
- **The local-override confirmation, verbatim.** It is the clearest explanation of settings
  precedence anywhere in the product, and afleet's own write ceiling makes it more relevant, not
  less: `.claude/settings.local.json` is a file afleet may write (root spec §7.8's precedent),
  while `~/.claude/settings.json` is not (X9). So for afleet the local-override path is not merely
  the correct answer, it is often the *only* writable one — the confirmation becomes the primary
  flow rather than an edge case.
- **Ineffective-write detection**, computed from `get_settings.sources[]` before any write, with
  the inventory's sentence shape. Without it a user disables a plugin at user scope, the project
  re-enables it, and nothing says why. `[exceeds]` relative to a naive rebuild; parity with the
  terminal's own message.

Array values of `enabledPlugins` are read, preserved and written back untouched.

**Drops / keeps / gains.**
*Drops:* `Back to plugin list`, the `Run /reload-plugins` phrasing (E-26's button), the terminal's
disclosure row for disabled plugins (a filter instead).
*Keeps:* the eight scope groups and their order, the three cross-cutting sections, the disuse
thresholds, all eleven menu labels, the three refusal sentences, the local-override confirmation
verbatim, `enabledPlugins` semantics including inert arrays.
*Gains:* `[exceeds]` context cost per row; `[exceeds]` ineffective-write detection before the
write, not after.

**Open.** afleet writes `.claude/settings.local.json` today only for a declined MCP server. Does
plugin enable/disable widen that precedent, or should it shell out to `claude plugin disable`
(class 4) and let the CLI own every write? The CLI route is safer and slower; the direct write is
what E-10 already proposes for permission rules.

### E-24 · The Marketplaces tab

**Terminal.** `Marketplaces` lists configured marketplaces with `Loading marketplaces…`,
`Manage marketplaces`, `▸ + Add Marketplace`, and a batched pending-changes model:
`Pending changes: Enter apply`, `Update <N> marketplaces`, `Remove <N> marketplaces`,
`Processing changes…` (SPEC 30 §27.7). The official marketplace's name is wrapped in `✻`. The
detail menu offers `Browse plugins (<N>)`, `Update marketplace`,
`Disable auto-update`/`Enable auto-update`, `Remove marketplace`, with the explanation
`Auto-update enabled. Claude Code will automatically update this marketplace and its installed
plugins.` The add form is titled `Add Marketplace` with `Enter marketplace source:` and four
examples (`owner/repo (GitHub)`, `git@github.com:owner/repo.git (SSH)`,
`https://example.com/marketplace.json`, `./path/to/marketplace`), validating with
`Please enter a marketplace source` and `Invalid marketplace source format. Try: owner/repo,
https://..., or ./path`. **The form writes `extraKnownMarketplaces` to *user* settings regardless
of the current scope** (`cli.pretty.js:380599`) — a bug a GUI can fix. There is a full CLI twin:
`claude plugin marketplace add|list|remove|update` (SPEC 30 §25.1).

**Job.** Adding a source of plugins, keeping it current, and removing it — the trust boundary of
the whole plugin system, and the one place where adding something is *not* confirmed.

**Wire.** R via the CLI (`areas/30-29-32…:181`), with one explicit endorsement:
*"The batching UX is worth copying — one confirmation for N marketplace operations."*

**afleet today.** `undesigned`; zero occurrences of `marketplace` in afleet sources.

**GUI form.** A list with the pending-changes model kept intact — mark several marketplaces for
update or removal, then one `Apply` with one confirmation, which is exactly what a batched
`claude plugin marketplace` subprocess run wants anyway. The add form keeps its four examples
verbatim (they are the documentation of the source grammar) and both validation strings. Two
changes:

- **The add form offers a scope**, defaulting to the scope the pane is filtered to, instead of
  always writing user settings. The terminal's behaviour is a defect, not an intention; the fix is
  named as a deviation with its citation. `[exceeds]`.
- **Trust is stated at add time.** The terminal confirms nothing when a marketplace is added, and
  the parity inventory's finding is that no plugin trust dialog is reachable headless at all
  (*"No plugin trust or consent dialog is reachable over the headless protocol, regardless of what
  the host declares in `initialize.supportedDialogKinds`"*). afleet already builds a consent sheet
  for project MCP servers (E-18) and should reuse it here: adding a marketplace shows the source,
  what it will be allowed to install, and requires an explicit accept. Named deviation, security
  direction, and consistent with how afleet already treats `.mcp.json`.

**Drops / keeps / gains.**
*Drops:* the `✻` wrapper for the official marketplace (a badge instead), the single-letter `u`/`d`
marks.
*Keeps:* the batched pending-changes model and its four strings, the detail menu labels, the
auto-update explanation, the add form's examples and validation copy.
*Gains:* `[exceeds]` a scope choice on add; `[exceeds]` an explicit trust step where the terminal
has none.

**Open.** Is adding a trust step for marketplaces the owner's call to make, given upstream
deliberately does not have one? This card says yes and flags it.

### E-25 · The Errors tab

**Terminal.** `Errors` (badged `Errors (<N>)`, counting non-advisory plugin errors and failed
marketplace installs, where advisory means `autoupdate-deferred-entry-helper` and
`autoupdate-disabled-by-policy`) renders thirty tagged error variants, each with a longer rendering
and guidance, and offers five resolve actions: `navigate`, `remove-extra-marketplace`,
`remove-installed-marketplace`, `managed-only`, `none`. Copy includes `No plugin errors`,
`✔ Removed "<name>" from user, project settings`, `✔ Removed marketplace "<name>"`,
`Failed to remove "<name>": <msg>`, `Installation failed` and
`Managed by your organization — contact your admin` (SPEC 30 §27.8).

**Job.** The answer to "I installed it and nothing happened."

**Wire.** **P for the data, R for the guidance**, and the inventory calls it the best-value item in
the chapter (`areas/30-29-32…:182`): *"`system/init.plugin_errors[] = {plugin, type, message}`
carries the type tag and short message; the long guidance strings are TUI-only. This is the best-
value rebuild in the chapter."*

**afleet today.** `undesigned`, and worse than undesigned: **`plugin_errors` is not decoded at
all**. `SystemFrames.swift` has no such field, so the tagged errors arrive on every handshake and
are dropped before anything could render them. Adding the field is a few lines.

**GUI form.** A list in the Plugins pane and, more importantly, **rows in the Activity view**,
which root spec §8.1 already defines as the cross-channel query of *"decisions, notifications,
failures, denials, rate limits, auth"*. A plugin error is a failure and belongs there; a user who
never opens Settings still needs to learn that a plugin failed to load. Each row shows the plugin,
the type tag rendered as a human sentence (afleet authors thirty short sentences from the tag
vocabulary — the guidance strings are not on the wire), the engine's short `message` verbatim, and
the resolve action where afleet can perform it. `No plugin errors` is kept as the empty state.

The count badge on the pane's sidebar row keeps the advisory-error exclusion exactly: an autoupdate
deferral is not an error the user must act on, and counting it would train people to ignore the
badge.

**Drops / keeps / gains.**
*Drops:* the thirty long guidance strings (not on the wire; afleet authors shorter equivalents from
the type tag).
*Keeps:* the type vocabulary, the engine's short message verbatim, the five resolve actions where
performable, the advisory exclusion in the badge count, `No plugin errors`.
*Gains:* `[exceeds]` plugin failures appear in Activity across every channel, not in a tab nobody
opens.

**Open.** None. This is the cheapest high-value item in the sub-family and the card recommends it
be done first, before any of the browse or install surfaces.

### E-26 · `/reload-plugins`

**Terminal.** `/reload-plugins` is `type: "local"` with `supportsNonInteractive: true`,
`terminalOriented: true`, `thinClientDispatch: "control-request"` and argument hint `[--force]`
(verified `cli.pretty.js:788504`); it is the one command in this sub-family that is **not** in the
74-entry lazy dialog registry, because it draws no panel. It clears the plugin, marketplace, skill,
agent and command caches, reloads plugin commands, skills, agent definitions, plugin MCP servers
and LSP servers, bumps `mcp.pluginReconnectKey`, reloads plugin hooks and emits `skillsChanged`.
It reports `Reloaded: <N> plugins · <N> skills · <N> agents · <N> hooks · <N> plugin MCP servers ·
<N> plugin LSP servers` and `<N> errors during load. Run /plugin for details.` It cannot reload one
thing: `Plugin MCP server changes take effect in your next session.` Before reloading it computes
the prompt-cache impact and, without `--force`, **aborts** with
`This reload changes MCP tools (<server>) and adds the LSP tool — your next message will re-read
the whole conversation instead of using the cache. Run /reload-plugins --force to apply.` Over a
remote connection it refuses with `/reload-plugins isn't available over a remote connection in this
session.` (verified `cli.pretty.js:197780`).

**Job.** Applying a plugin change to a session that is already running, without losing it.

**Wire.** **P for the reload, D for the pre-flight** (`areas/30-29-32…:186`): *"The control-request
handler calls `cH()` directly. It **skips** the `fee()` prompt-cache impact probe… It also has no
`--force`… Workaround: the GUI can compare `mcp_status` before and after the reload and warn the
user itself, but it cannot warn *before* committing."* The `Plugins changed. Run /reload-plugins to
activate.` banner is Ink-only and must be synthesised (D, line 187).

**afleet today.** `built`, and mis-described. `ClaudeWire/…/OutboundRequests.swift:149` defines
`ReloadPlugins`; `App/Header/ChannelHeaderActionsModel.swift:153-165` sends it and renders every
count it answers with (`"\(count("commands")) command(s), \(count("agents")) agent(s), …"`); the
Extensions header menu has a `Reload Plugins` item (`HeaderMenus.swift:58-68`). But
`RouterTable.terminalOnlyReasons` still tells a user who types `/reload-plugins` that
*"/reload-plugins reloads plugins into a running terminal screen; afleet picks a plugin change up
when the channel next restarts."* — which understates afleet's own shipped capability. That string
should be replaced by a route to the existing action; it is a one-line fix and the clearest
concrete defect this lane found in afleet's copy.

**GUI form.** Keep the header menu item and add three things:

1. **Route the typed command.** `/reload-plugins` gets a `RouterTable.local` row with strategy
   `.native("reloadPlugins")` so typing it does what the menu does. Remove its
   `terminalOnlyReasons` entry.
2. **A stale-plugins banner, synthesised.** The terminal's `Plugins changed. Run /reload-plugins to
   activate.` is Ink-only, so afleet must raise it itself — after any install, enable, disable or
   marketplace update, every channel whose plugin set is now stale shows a channel banner
   `Plugins changed` with `Reload` and `Reload all channels`. Multi-channel is the reason this
   matters more in afleet than in the terminal: the terminal has one session to reload.
3. **The pre-flight, rebuilt.** The control request skips the prompt-cache impact check, so afleet
   performs the inventory's workaround in the other direction: it reads `mcp_status` *before*
   reloading, and if the pending change touches MCP servers it shows the terminal's warning
   sentence, adapted — `Reloading will change MCP tools; your next message re-reads the whole
   conversation instead of using the cache.` — with `Reload now` and `Reload when this channel is
   idle`. That second option is afleet's own and is the better default for a channel mid-turn.

The result line keeps its counts and its `<N> errors during load.` clause, rendered as a timeline
notice row rather than a message, with `Run /plugin for details.` replaced by a link to the Errors
pane. The `Plugin MCP server changes take effect in your next session.` caveat is kept verbatim and
paired with afleet's restart affordance, which *can* deliver the next session immediately.

**Drops / keeps / gains.**
*Drops:* `--force` (no wire equivalent), the remote-connection refusal, the
`Run /plugin for details.` phrasing.
*Keeps:* the result counts, the errors clause, the MCP-server caveat verbatim, the prompt-cache
warning's substance.
*Gains:* `[exceeds]` reload across many channels; `[exceeds]` reload-when-idle; `[exceeds]` an
immediate restart for the one thing reload cannot apply.

**Open.** None.

### E-27 · `/cloud-plugins`

**Terminal.** `/cloud-plugins` (`Choose whether cloud sessions use the plugins enabled on this
machine`, verified `cli.pretty.js:688713`) asks
`Use your enabled plugins in cloud sessions you run from this machine?` and explains, at length,
that only *choices* travel — plugin names and marketplace addresses — and that *"Saying yes sends
nothing else: no plugin files, no other settings, no credentials, no local paths."* Options are
`Yes, use my enabled plugins in cloud sessions`, `No, keep them on this machine only` and
`Not now`, with `Not now` focused by default and mapped to Escape. The answer persists **not in
settings** but in `<configHome>/state/cloud-plugins-consent.json` as
`{version, choice, decidedAt, hostname}`, and a hostname mismatch reads back as *unset*, so the
answer never travels between machines (SPEC 30 §27.13). The payload travels as
`apply_flag_settings {settings: {cloudPluginsForwarded: <patch>}}` followed by `reload_plugins`.

**Job.** A consent decision about what leaves the machine — for a product afleet does not host.

**Wire.** X for the dialog, R for the mechanism (`areas/30-29-32…:190`): both the file write and
the two control requests are available to a host.

**afleet today.** `out-of-scope`, and there is a document conflict worth recording. The parity
inventory proposes that a GUI write `<configHome>/state/cloud-plugins-consent.json`; root spec
§17.8's standing exclusion is *"any write under `<configHome>` (X9)"*, and §17.8 also excludes
*"cloud and Remote Control sessions"* outright. The exclusion wins: afleet does not start cloud
sessions, so it has no occasion to forward anything.

**GUI form.** Nothing is built. A user who types `/cloud-plugins` gets a router row with afleet's
own sentence rather than the generic panel refusal:
`/cloud-plugins decides whether cloud sessions started from this machine reuse your local plugin
choices. afleet does not start cloud sessions, so there is nothing here to decide; run it in the
Claude Code terminal if you use them.` Authored copy, and it obeys root spec §7.7's rule that the
router *"never shows a message telling the user to go back to the terminal"* only in its first
clause — the second clause names the terminal as a fact about a product afleet does not host, which
is different from telling the user afleet is inadequate. Flagged for the owner as a wording call.

**Drops / keeps / gains.**
*Drops:* the whole dialog.
*Keeps:* nothing rendered; the consent file is neither read nor written.
*Gains:* nothing.

**Open.** Does the "never tell the user to go back to the terminal" rule admit an exception for
commands about products afleet deliberately does not host? Owner.

## G. The model and turn-shaping pickers

### E-28 · The `/model` picker

**Terminal.** `/model` has twin registrations (SPEC 28 §5): a `local-jsx` picker whose description
is a getter, `Set the AI model for Claude Code (currently <model>)`, and a headless `local` twin.
The picker's chrome is **not in SPEC 263** — a grep of all 51 chapters for `Select model` returns
nothing — and was byte-verified for this study at `cli.pretty.js:502349`: header `Select model`
in `remember`, bold; subtitle `Switch between Claude models. Your pick becomes the default for new
sessions. For other/previous model names, specify with --model.`; when a session override is
active, `Currently using <X> for this session only (base model: <Y>). Selecting a model here
replaces both.`; search placeholder `Search models…`; empty search `No models match "<query>"`;
overflow counter `… +N models` (builder `cli.pretty.js:1013`, call site `:502359`, unit `model`).
Rows are `label · description` pairs (SPEC 06 §…): `Sonnet 5 · Efficient for routine tasks`,
`Opus 5 · Best for everyday, complex tasks`,
`Fable 5.1 · Most capable for your hardest and longest-running tasks`,
`Haiku 4.5 · Fastest for quick answers`, `Use Opus in plan mode, Sonnet otherwise`, plus
`Default (recommended)`, with suffix slots ` · Requires usage credits`, ` · Draws from usage
credits`, ` · ~2× usage vs Sonnet`, `$N/$M per Mtok`, ` · Org default`,
` · Set by your organization`, ` · Set by ANTHROPIC_DEFAULT_MODEL`.

**The default-for-new-sessions control is inverted from what one would guess:** persisting is the
*default* behaviour, and the footer chord `s` is labelled `use this session only`. The confirmation
is `Set model to <name>` plus ` and saved as your default for new sessions` or
` for this session only`. Persistence is `settings.model` in user settings. There is **no selection
glyph** — the menu title is the indicator.

**Job.** Choosing what this channel thinks with, seeing what each option costs, and deciding
whether the choice outlives the channel.

**Wire.** P for the mechanism, R for the picker (`areas/06-08-02-models-auth-bootstrap.md:19-21`).
`set_model {model?}` — omitted, `null` or `"default"` resets; it runs `PreModelSwitch`/
`PostModelSwitch` hooks so it is async and fallible, and the success response carries **no
payload**, which is why the readback matters. Round-trip `models[].value` verbatim, never
`resolvedModel` (line 25). Two D-class gaps: `unavailable_models` is empty unless the entrypoint is
`claude-vscode` (line 27), and per-model `notice`/`badge`/`tooltip` are never projected onto rows
(line 28).

**afleet today.** `built`, and stripped to names. `App/Header/SettingPickers.swift:1062` renders a
`Menu` of `Button(option.displayName)` — one string per row. The cause is upstream of the view:
`ModelOption` (`SettingPickers.swift:12-17`) and `options(in:)` (`:25-34`) decode only `value`,
`resolvedModel`, `displayName`, `supportsEffort` and `supportedEffortLevels`, so **`description`
is dropped at the decode boundary** and the picker could not render the terminal's second column
even if it wanted to. Also missing: the header, the search field, the overflow counter, and any
notion of a persisted default — every afleet write is per-channel. Router row
`RouterTable.swift:36` is `.setModel` with readback `.getSettingsApplied` and explanation
`Changes the model for this channel without a Claude turn.` The design intent is right and worth
quoting, because it is what makes the picker trustworthy (C6.2 *The pickers, and readbacks over
clicks*): *"Each shows a readback, never the last click… A readback that disagrees with the click
leaves the readback on screen and raises the disagreement; it does not silently re-issue."*

**GUI form.** Keep afleet's readback discipline exactly; restore the four things the terminal has
and afleet dropped.

```
┌ Select model ──────────────────────────────────┐
│ ⌕ Search models…                               │
│ ● Sonnet 5     Efficient for routine tasks     │
│                $3/$15 per Mtok                 │
│ ○ Opus 5       Best for everyday, complex tasks│
│                · ~2× usage vs Sonnet           │
│ ○ Fable 5.1    Most capable for your hardest   │
│                and longest-running tasks       │
│                · Draws from usage credits      │
│ ○ Haiku 4.5    Fastest for quick answers       │
│ ○ Default (recommended)      · Org default     │
│   … +4 models                                  │
├────────────────────────────────────────────────┤
│ ☑ Also make this the default for new channels  │
└────────────────────────────────────────────────┘
```

1. **Decode `description`.** One line in `ModelOption`; without it every other improvement is
   cosmetic. The suffix slots (`· Requires usage credits`, `$N/$M per Mtok`, `· Org default`) are
   part of the description string and come free with it.
2. **The header and search field**, kept verbatim (`Select model`, `Search models…`,
   `No models match "<query>"`), with the subtitle rewritten for afleet's semantics — the
   terminal's subtitle asserts that a pick becomes the default, which in afleet it does not unless
   the checkbox is ticked. Named deviation, and the reason the checkbox exists.
3. **The overflow counter `… +N models`** kept verbatim over the same ten-row window, as a
   `Show all` affordance rather than a dead label. `[exceeds]`.
4. **The default-promotion checkbox**, which is the terminal's `s` chord made visible and inverted
   back to the safer polarity: in afleet, unchecked means this channel only. The terminal's
   polarity (persist by default) is wrong for a fleet, where a click in one channel silently
   changing every future channel is a surprise. Named deviation, with the reason.

The confirmation sentence is kept in both variants and rendered as a timeline notice row.

**Drops / keeps / gains.**
*Drops:* the persist-by-default polarity and the `s` chord; the subtitle's assertion.
*Keeps:* header, row labels and descriptions and all suffix slots, search copy, the overflow
counter, both confirmation sentences, the readback-not-the-click rule.
*Gains:* `[exceeds]` an explicit, visible default-promotion control; `[exceeds]` search over a
picker afleet currently renders as a flat menu.

**Open.** Should the persisted default be per config home, per project, or global? The terminal has
one answer (user settings); afleet's sidebar is organised by project and a per-project default is a
plausible product decision.

### E-29 · The `/effort` picker

**Terminal.** Levels are `low`, `medium`, `high`, `xhigh`, `max`, with `med` accepted for `medium`
and `ultracode` as a pseudo-level mapping to `xhigh` (SPEC 06). **`max` is never persistable** —
the persistence filter excludes it. Two distinct description sets exist: the help text
(byte-verified `cli.pretty.js:271747`) reads `low: Quick, straightforward implementation`,
`medium: Balanced approach with standard testing`,
`high: Comprehensive implementation with extensive testing`,
`xhigh: Extended reasoning with thorough analysis (Fable 5, Opus 4.7+, Sonnet 5)`,
`max: Maximum capability with deepest reasoning (Fable 5, Opus 4.6+, Sonnet 4.6+)`; the picker rows
differ slightly (`low: Quick, straightforward implementation with minimal overhead`, verified
`cli.pretty.js:591483`). The `max` caveat is
`May use excessive tokens resulting in long response times or overthinking. Use sparingly for the
hardest tasks.`, rendered with a cost multiplier when one exists. The picker draws a **track**, not
a ladder of glyphs: `cli.pretty.js:225421` builds `trackChars` from U+2500 with a U+2506 marker,
with triangle positions, an accent start, and the sublabel `xhigh + workflows` on the ultracode
stop; the five stops are coloured `warning`, `success`, `permission`, `autoAccept-shimmer` and
`rainbow-animated`. There is **no `Select effort` header** anywhere in SPEC or in the binary; the
only adjacent title is the cache-miss modal `Change effort level?`, and cancelling prints
`Kept effort level as <level|auto>`. Persistence is `effortLevel` and
`modelSettings[<model>].effortLevel`; `ultracode` is session-scoped and never persisted by
interactive toggles.

**Job.** Trading latency and token spend against depth, per channel, with the cost of the choice
stated.

**Wire.** X for the slider, P for the mechanism: `apply_flag_settings {settings: {effortLevel, ultracode}}`
(`areas/06-08-02…:44-46`). **`max` is not accepted at runtime** — it is launch-only (`--effort max`).
`auto` is `effortLevel: null`. Cost multipliers are D (line 49). One route is closed entirely
(line 52): a launch-effort pin can only be released by `Run /effort <level> in an interactive
terminal to release the pin`, so *a GUI-only user can never release it through the protocol* — X.
And README finding 12 governs the whole family: *"`apply_flag_settings` accepts any key silently,
including nonsense, and answers `null`. Only `get_settings.applied` (`model`, `effort`, `advisor`,
`ultracode`) reflects what took effect."*

**afleet today.** `built`, and the thinnest picker in the app.
`App/Header/SettingPickers.swift:1080` renders the literal `"Default"` followed by the **raw engine
level strings** — `low`, `medium`, `high`, `xhigh` — uncapitalised, unglossed, with no descriptions,
no track, no caveat and no cost. `max` is excluded unconditionally
(`midSessionExcludedEffort`, `:178-182`), which is correct. Router row `RouterTable.swift:38` is
`.applyFlagSetting(key: "effortLevel")` with readback `.getSettingsEffective` and explanation
`Changes the effort level; max cannot be set mid-session.`

**GUI form.** A segmented control of five stops with labels and their picker descriptions beneath
the selection, replacing the terminal's drawn track — a track made of box-drawing characters is a
terminal's way of having a slider, and a segmented control *is* the slider. Named deviation.
Kept verbatim: the five level names and their picker descriptions, the `max` caveat with its cost
multiplier when present, and the cancel sentence `Kept effort level as <level>`.

Three afleet-specific requirements:
- **`max` is shown, disabled, with its reason.** afleet excludes it silently today; the terminal's
  own explanation exists (`max cannot be set mid-session`) and belongs on the control, with
  `Start a new channel with max effort` as the affordance that does work — afleet can pass
  `--effort max` at launch, which is exactly what the restart machinery is for.
- **The launch pin, named.** If a channel was launched with a pinned effort, no afleet control can
  release it (X). The picker must say so rather than appear inert:
  `This channel's effort is pinned by its launch flags.` Authored copy; without it the control
  looks broken.
- **Per-model effort support.** `supportsEffort` and `supportedEffortLevels` are already decoded
  (`SettingPickers.swift:25-34`), so the control greys the stops a model does not support instead
  of offering a click that silently does nothing — which is what `apply_flag_settings`' silent
  acceptance would otherwise produce.

**Drops / keeps / gains.**
*Drops:* the drawn track and its five stop colours, the `xhigh + workflows` sublabel (folded into
the `xhigh` description), the two-description split (afleet uses the picker set).
*Keeps:* the five levels and their picker descriptions, the `max` caveat verbatim, the cancel
sentence, `auto` as `null`, session-scoped `ultracode`.
*Gains:* `[exceeds]` unsupported levels greyed rather than silently accepted; `[exceeds]` a named
launch-pin state; `[exceeds]` a route to `max` through a new channel.

**Open.** Should `ultracode` get a control at all, given it is a pseudo-level with a workflow
implication and never persists? The clone parked it for the same reason.

### E-30 · `/fast`

**Terminal.** `/fast` is an inline toggle rather than a browsing dialog, with `local-jsx` and
`local` twins. On it prints `↯ Fast mode ON · model set to Opus 5 · $10/$50 per Mtok`; off,
`Fast mode OFF`; unavailable, `Fast mode unavailable: <msg>` with ten disabled-reason tokens
including `sdk_opt_in_required` → `Fast mode is not available in the Agent SDK`; cancelling prints
`Fast mode unchanged (cancelled)`. It persists `fastMode` and `fastModePerSessionOptIn`, with an
org-level cache `penguinModeOrgEnabled` in `~/.claude.json`. The `/config` registry carries the
same switch as `Fast mode (<model>)`, interpolating the fast model's name (SPEC 41.26.2).

**Job.** Trading model quality for latency on a channel where you are waiting.

**Wire.** P, after an opt-in that reads like a refusal. README finding 13: fast mode is
**opt-in, not unavailable** — `apply_flag_settings {fastMode: true}` clears `sdk_opt_in_required`
and the toggle then works normally. The parity area file still says the opposite
(`areas/28-slash-commands.md:135`, *"hide the control rather than offer a dead toggle"*); that row
is stale and superseded by the README and by the errata at `areas/41-tui-rendering.md:5`. A GUI
that trusts the area file will ship no control at all.

**afleet today.** `routed-only`, and broken end to end. `RouterTable.swift:43` routes `/fast` to
`.applyFlagSetting(key: "fastMode")` with readback `.fastModeState` — but
`CommandRouter.picker(for:)` sends the bare form to `.native("fastPicker")`, and
`SettingPickersModel.pickerSurfaces` is `["modelPicker", "effortPicker"]`
(`SettingPickers.swift:149`), so the surface does not exist and the command falls through to
`links.open(.command("fastPicker"))` **with nothing to land on**. Typing `/fast` in afleet today
opens nothing and reports nothing. Root spec §7.7 has the mechanism right (`/fast` →
`apply_flag_settings {fastMode: true}` *"as the opt-in, then the toggle"*), so this is an
implementation hole, not a design one.

**GUI form.** A fourth header control beside model, mode and effort — a toggle, not a menu, since
it has two states. Its label carries the fast model's name exactly as `/config`'s row does
(`Fast · Opus 5`), and its tooltip carries the pricing clause from the ON message. The opt-in is
invisible: afleet sends `apply_flag_settings {fastMode: true}` on first use and reads back, exactly
as the root spec says. The ten disabled reasons render as the toggle's disabled tooltip, using the
engine's `<msg>` verbatim.

**Drops / keeps / gains.**
*Drops:* the `↯` glyph and the three status sentences as transcript lines; the cancel state (a
toggle has none).
*Keeps:* the model name and pricing clause in the control's label and tooltip, the disabled reasons
verbatim, the opt-in-then-toggle sequence.
*Gains:* `[exceeds]` the state is always visible in the header rather than recalled from the last
message.

**Open.** None. This is a bug fix plus a toggle, and it is the cheapest item in the lane.

### E-31 · `/autocompact`

**Terminal.** `/autocompact` has a `local-jsx` dialog titled **Auto-compact window** with ±100k
arrows and a `local` twin. Descriptions differ by form: `Set how full the context gets before
auto-summarizing` for the dialog, `Configure the auto-compact window size` for the text form. Its
parse error is instructive: `Couldn't parse '<x>'. Expected 'auto' or 100k–1M tokens (e.g. 500k,
200000, or 200 as shorthand)`. It persists `autoCompactWindow` and `autoCompactEnabled` — the
latter being `/config`'s `Auto-compact` row (E-03).

**Job.** Deciding how much conversation the engine keeps before summarising, which for a
long-running channel is the difference between coherence and a surprise compaction mid-task.

**Wire.** P for the text form, X for the dialog. The `autocompact_state` push frame is D — emitted
only under `CLAUDE_CODE_REMOTE` — but `get_context_usage` carries the same four numbers, so the
readback is available.

**afleet today.** `undesigned`. Zero references repo-wide; root spec §7.7 has no row. There is one
adjacent thing built: `App/Header/HeaderReadoutView.swift:86` draws a read-only threshold tick on
the context meter, so afleet already *shows* the auto-compact point and cannot change it.

**GUI form.** Make the tick draggable. The context meter is already in the channel header and
already marks the threshold; turning that mark into a control is the natural GUI form and needs no
new surface. Dragging writes `autoCompactWindow` (class 3 or 5 per E-03) and the meter animates to
the new threshold. The parse-error copy disappears with the text field, but its *domain* is kept as
the drag limits (100k–1M, plus `auto`), and a right-click menu offers `auto` and the shorthand
values as presets.

The `Auto-compact` on/off row stays in the Defaults pane (E-03), and the meter's tick disappears
when it is off — which is a better readback than the terminal has.

**Drops / keeps / gains.**
*Drops:* the dialog, the ±100k arrows, the parse-error string.
*Keeps:* the value domain and the `auto` option, both setting keys.
*Gains:* `[exceeds]` the threshold is set by dragging the meter that displays it — one control for
the readback and the setting, which no terminal can do.

**Open.** Does a draggable threshold need a confirmation, given a compaction is irreversible for
the running channel? Probably a snap-back-on-release preview; a build question.

### E-32 · `/advisor`

**Terminal.** `/advisor` is `local-jsx`, gated on `tengu_sage_compass2`, described as
`Let Claude consult a stronger model at key moments` with argument hint `[<models>|off]`. It sets
`advisorModel`, which also arrives as a launch flag `--advisor <model>` and rides `flagSettings`
(`cli.pretty.js:449119`). **There is no headless twin.**

**Job.** Letting a cheap model escalate to an expensive one at the moments that matter, without
paying for the expensive one all the time.

**Wire.** Contested: `areas/06-08-02…:87` says **X** (no `local` twin); `areas/28-slash-commands.md:95`
says **D**. No arbiter, so both are reported. What is certain: `advisor` is one of the four keys
`get_settings.applied` reflects (README finding 12), so whatever sets it, the readback works — and
`apply_flag_settings` is the local path's mechanism for exactly this class of key.

**afleet today.** `undesigned`. `advisor` appears once, in a comment
(`App/Header/ChannelHeaderReadout.swift:41`), and is never decoded. No router row, no §7.7 row.

**GUI form.** A row in the per-channel Overrides sheet (E-01) and a matching row in the Defaults
pane: a model pop-up plus `Off`, sourced from the same `list_models` data the model picker uses,
with the terminal's description as the row's help text. The write is
`apply_flag_settings {advisorModel}` with a `get_settings.applied` readback — the same shape as
effort, and the same discipline. Because the wire class is contested, the row ships behind a probe:
if `apply_flag_settings` does not move `applied.advisor`, the row becomes an `Open file` class-5
row instead. The card names the probe rather than guessing.

**Drops / keeps / gains.**
*Drops:* the dialog and the `[<models>|off]` argument grammar.
*Keeps:* the description as help text, the value domain, `off`.
*Gains:* `[exceeds]` the advisor model is visible in a readback beside the main model, where the
terminal only shows it if you ask.

**Open.** A probe is needed: does `apply_flag_settings {advisorModel: "opus"}` move
`get_settings.applied.advisor`? One round trip settles X versus D.

### E-33 · `/powerup` and `/passes`

**Terminal.** `/powerup` is an onboarding tour of 52 cards, described as `Discover Claude Code
features through quick interactive lessons`, promoted by the banner
`New here? Run /powerup to learn the features most people miss.` (verified
`cli.pretty.js:219396`) with the card title `Learn the moves` (`:227675`); it persists
`powerupsUnlocked` and is gated on `tengu_birch_lantern`. `/passes` is hidden unless the account is
eligible, and offers `Share a free week of Claude Code with friends and earn usage credits`
(definition at `cli.pretty.js:788490`).

**Job.** `/powerup` teaches the product; `/passes` is a referral offer.

**Wire.** X for both — `local-jsx` with no twin. `/powerup` is classified **T** by
`areas/28-slash-commands.md` and **X** by `areas/41-tui-rendering.md`; both letters are reported.

**afleet today.** `undesigned`; zero references repo-wide for either, and no §7.7 row.

**GUI form.** Neither is ported as such, for different reasons.

- **`/powerup` is superseded** by afleet's own onboarding, whatever that turns out to be: 52 cards
  teaching terminal keybindings, the transcript view and the composer's chords would teach the
  wrong product. The one thing worth carrying is the *idea* of the promotion banner — a dismissible
  first-run banner pointing at afleet's own features. Typing `/powerup` shows afleet's onboarding
  entry point rather than a refusal.
- **`/passes` is an account offer** and belongs in the Account pane (E-38 family) as a link, if the
  account's eligibility is visible at all. It is not, on the wire — so the honest form is a router
  explanation: `/passes offers a free week of Claude Code to share; it runs on your account, and
  afleet has no view of whether your account is eligible. Open claude.ai to use it.` Authored copy.

**Drops / keeps / gains.**
*Drops:* the 52-card tour, the referral dialog.
*Keeps:* the promotion-banner pattern; the offer's description as link text.
*Gains:* nothing; afleet's onboarding is a separate product surface.

**Open.** Does afleet have an onboarding story at all yet? If not, `/powerup`'s existence is a
reminder that it needs one, and that is a product question rather than a translation.

## H. Workspace: `/sandbox`, `/add-dir`, `/cd`

### E-34 · `/sandbox`

**Terminal.** `/sandbox` is a **tabbed dialog**, not a toggle (SPEC 17). Its tab count varies with
a dependency probe: an error shows `Dependencies` alone; a warning shows `Mode`, `Dependencies`,
`Overrides`, `Config`; a clean probe shows `Mode`, `Overrides`, `Config`. The footer is
`←/→ to switch · ↑/↓ to navigate · Enter to select · Esc to close`. Its status-line description is
a getter, `<icon> <state> (⏎ to configure)` (byte-verified `cli.pretty.js:788527`, `⏎` is U+23CE),
over the states `sandbox enabled (auto-allow)`, `sandbox enabled`, `, fallback allowed`,
`sandbox disabled` and ` (managed)`. The `Mode` tab is headed `Configure mode` with the choices
`Sandbox BashTool, with auto-allow`, `Sandbox BashTool, with regular permissions` and `No Sandbox`,
confirming with `✓ Sandbox enabled with auto-allow for bash commands`,
`✓ Sandbox enabled with regular bash permissions`, `✓ Sandbox enabled` or `○ Sandbox disabled`. The
`Overrides` tab is headed `Configure overrides` with `Allow unsandboxed fallback` /
`Strict sandbox mode` and the refusal `Sandbox is not enabled. Enable sandbox to configure override
settings.` The `Config` tab shows `Sandbox is not enabled` when off, else `Excluded Commands:`
(literal `None` when empty) plus filesystem and network sections. Keys are
`sandbox.{enabled, autoAllowBashIfSandboxed, allowUnsandboxedCommands, excludedCommands,
failIfUnavailable, network.*, filesystem.*}`, and **most sub-keys are honoured only from user,
managed/policy or `--settings` sources — project settings are ignored.** Platform gating, verified:
macOS shows `seatbelt: ` / `built-in (macOS)` (`cli.pretty.js:475362`) and runs
`/usr/bin/sandbox-exec`; Linux shows `bubblewrap (bwrap): `, `socat: `, `seccomp filter: `; WSL1 is
refused outright.

**Job.** Deciding whether Bash runs inside a sandbox, and — the part that matters most — whether
being sandboxed means commands stop asking permission.

**Wire.** X for the command; R for every surface except the `Config` tab, which is **D**: the
effective post-merge path and domain lists live only in the `sandbox_instructions` attachment,
which the headless filter drops, and eleven trusted-tier keys are unreachable through the protocol
(`areas/15-16-17-file-bash-sandbox.md:197`, `:252-254`). The rebuild source is
`claude sandbox status`, which prints one JSON line with `{available, installed, policyLocked,
reasons[], supported, enabled, enabledSource, unavailableReason, strictMode, strictModeSource,
filesystemPolicy}` (class 4). One genuine GUI win (line 228): `<sandbox_violations>` is stripped by
the TUI but arrives **unstripped** in the `tool_result` on the wire — afleet can show violations
the terminal hides.

**afleet today.** `undesigned`. No router row, no GUI, no setting; root spec §7.7 has no row. The
only trace is a permission-card explanation, `App/Decisions/PermissionCardView.swift:297`:
`"This call asked to run outside the sandbox."` — so afleet renders the *consequence* of the
sandbox without ever showing its state.

**GUI form.** Settings → Claude Code → **Sandbox**, one pane with three groups matching the
terminal's three tabs (`Mode`, `Overrides`, `Dependencies`) and a fourth, read-only `Config` group.
Because most sandbox keys are honoured only from user, managed or flag sources, and afleet may
write none of those (X9 covers user; managed is not afleet's; `--settings` is a launch flag), this
pane is **read-mostly**: it renders the state from `claude sandbox status` and offers `Open file`
for the writable keys. That is not a shortcoming to hide — a sandbox whose settings a host app can
silently change is a worse sandbox.

Three deliberate additions:
- **A channel-header readback.** The terminal puts sandbox state in its status line; afleet's
  equivalent is a small shield glyph beside the permission-mode control, with the terminal's state
  strings verbatim (`sandbox enabled (auto-allow)`, `sandbox disabled`, ` (managed)`) as its
  tooltip. A user needs to know whether Bash is sandboxed at the moment they approve a Bash call.
- **Sandbox violations surfaced.** The wire carries `<sandbox_violations>` unstripped; afleet
  renders them on the tool-result row as `Blocked by sandbox: <path or host>`. `[exceeds]`, and it
  is the single most useful thing this pane can do, because a violation is exactly when a user
  wants to change a setting.
- **The dependency probe kept as a group**, with the platform-specific labels verbatim
  (`bubblewrap (bwrap): installed`, `seccomp filter: … (required to block unix domain sockets)`)
  and the WSL1 refusal, because afleet may host a remote engine one day and the platform answer is
  not always macOS.

**Drops / keeps / gains.**
*Drops:* the tab-count-varies-by-probe behaviour, the footer, the `⏎ to configure` getter,
`/sandbox exclude` as a command (an `Excluded Commands` list editor instead).
*Keeps:* the three mode labels and their four confirmations, the overrides labels and the
not-enabled refusal, the dependency labels, the `Config` sections including the literal `None`.
*Gains:* `[exceeds]` sandbox violations shown on the tool result; `[exceeds]` a persistent sandbox
readback in the channel header.

**Open.** Should afleet ever write sandbox settings, given the terminal deliberately ignores
project-scope sources for them? This card says read-mostly with `Open file`; the owner may want a
stronger stance (never writable from the GUI at all).

### E-35 · `/add-dir`

**Terminal.** `/add-dir` has twin registrations (both `Add a new working directory`, argument hint
`<path>`) and a free-text dialog with path completion. Its validation copy is the richest in the
lane (SPEC 24 §24.12.2): `Please provide a directory path.`, `Path <p> was not found.`,
`<p> is not a directory. Did you mean to add the parent directory <parent>?`,
`<p> is already the current working directory.`, `<p> is already added as a working directory.`,
`<p> is already accessible within <the current working directory|the additional working directory>
<dir>.`, `<p> is a network path, which cannot be added as a working directory…`, plus null-byte and
unresolvable variants; success is `Added <p> as a working directory.` **The interactive dialog has
a persist toggle SPEC §24.12.3 does not describe**: `cli.pretty.js:13006` writes
`destination: <persist> ? "localSettings" : "session"` and reports
`Added directory <path> to workspace and saved to local settings` or `… for this session`, and the
`/add-dir <path>` picker offers `Yes, for this session`, `Yes, and remember this directory`, `No`
(`cli.pretty.js:583051`). The SPEC's session-only claim describes the headless arm.

**Job.** Letting a session read and edit a directory outside its starting tree — a monorepo
sibling, a shared library, a scratch area.

**Wire.** **X, authoritatively.** README finding 6: *"`add_directory` is not `/add-dir`. The
handler reads `mount_path`, requires `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` and stages a
file for a cloud container… There is no runtime equivalent of `/add-dir` for a local headless
session; only `--add-dir` at launch."* Three area files still grade it R or P and all three are
superseded by their own errata headers. There is no `remove_directory` in the request set.

**afleet today.** `designed` and half-built. `RouterTable.swift:40` routes `/add-dir` to `.restart`
with the explanation `Adds a directory by restarting this channel under the same session id.`;
`addDir` is in `LaunchSettingMatrix.restartRequired` (`:134`); the quiescent-restart machinery is
built and tested, with `LiveFleetTests.swift:440-455` asserting the relaunched argv carries
`["--add-dir", <path>]`. **But `HeaderLaunchSetting` (`RestartRequiredSettings.swift:12-33`) has
only two cases — `promptSuggestions` and `allowBypass` — so no header affordance reaches
`/add-dir`; only the typed command can.**

**GUI form.** A directory list in the per-channel Overrides sheet (E-01, E-13), with `+` opening a
native `NSOpenPanel`. This is where the GUI genuinely wins and also where it must be honest:

- **Four of the eight validation strings become unreachable** because a file picker cannot produce
  a non-existent path, a non-directory, an empty path or a null byte. The four that survive are
  kept verbatim: already-the-cwd, already-added, already-accessible-within, and the network-path
  refusal. Named deviation. `[exceeds]` — the errors are prevented rather than reported.
- **The persist toggle survives as a checkbox**, `Remember for new channels in this project`,
  writing `permissions.additionalDirectories` to project-local settings through E-10's write
  routes. The terminal's two labels (`Yes, for this session` / `Yes, and remember this directory`)
  collapse into one checkbox, which is the same choice with one fewer step.
- **The restart cost is stated before the click, not after.** Every add or remove is a restart;
  several batch into one `RestartRequest`. The sheet shows `Restarts this channel` on the button
  and the existing `RestartRequiredSettings` copy pattern supplies the sentence
  (`This channel is restarting to change its working directories.`).
- **Removal exists**, which the wire cannot do at runtime either — it is the same restart with a
  shorter list, and the terminal's removal confirmation copy from the Workspace tab (E-13) is
  reused verbatim.

**Drops / keeps / gains.**
*Drops:* the free-text field with completion, four validation strings, the three-option picker.
*Keeps:* four validation strings verbatim, the success sentence, the session-versus-remember
choice, `permissions.additionalDirectories` as the persisted key.
*Gains:* `[exceeds]` a native directory picker; `[exceeds]` removal, batching, and a stated restart
cost; `[exceeds]` a reachable affordance where afleet today has only a typed command.

**Open.** Multi-select in the open panel means several directories in one restart — good — but the
terminal's argument hint is singular. Is there any reason not to accept several? None found.

### E-36 · `/cd`

**Terminal.** `/cd` is `local-jsx` with **no headless twin**, described as `Move this session to a
new working directory`, argument hint `<path>`. Its success line is `Moved to <path>` with a
persist-failure variant naming `.claude/settings.local.json` (`cli.pretty.js:579499`). It re-homes
everything scoped to a project — permission rules, hooks, project MCP servers, project skills — and
an untrusted target re-shows the trust dialog, with project-scoped grants withheld until trust is
given. It shares a tab-completion provider with `/add-dir`, and that provider is the only async one
with **no race guard**: a slow listing can overwrite the menu after further typing
(SPEC 42 §…:5293-5306).

**Job.** Moving a running session to a different project without losing it — the one command that
changes what "this project" means.

**Wire.** R for the command, **P for the capability, and better than the terminal**. `set_cwd
{path, trust_accepted?, trusted_directory?}` answers `{status: "ok", cwd, changed,
transcript_relocated}`, `{status: "needs_trust", directory, trust_root?}` or
`{status: "rejected", reason ∈ busy|unsafe_path|not_found|not_a_directory|blocked_by_rule,
message}`. The invalid-combination error is verbatim `set_cwd: invalid request — trust_accepted
requires trusted_directory (echo the directory from the needs_trust response)`
(`cli.pretty.js:251771`). The turn must be idle. Accepting trust persists
`projects[<git root>].hasTrustDialogAccepted` in `~/.claude.json` — a write the CLI performs, not
the host.

**afleet today.** `designed`, mechanism-complete, surface-absent. `RouterTable.swift:42` routes
`/cd` to `.setCwd` with the explanation
`Changes the working directory; an untrusted directory asks for trust first.`, and root spec §7.7
specifies the full round trip including the `transcript_relocated: true` case that rebinds
transcript paths and watchers. `cwd` is in `LaunchSettingMatrix.runtimeMutable`. There is no
directory picker and no header affordance.

**GUI form.** A `Move to another directory…` item in the channel header's Channel menu, opening a
native `NSOpenPanel`, plus a drop target: dragging a folder onto the channel header offers the same
move. `[exceeds]` — the terminal cannot accept a drag.

The five rejection reasons map to five distinct messages, using the engine's `message` verbatim,
and `busy` gets afleet's own affordance rather than an error: `This channel is mid-turn.` with
`Move when it finishes`, since afleet knows when the turn ends and the terminal makes the user
retry. `needs_trust` opens afleet's trust dialog, and the card is explicit that afleet must echo
`trusted_directory` — the CLI refuses `trust_accepted` alone, and the error string above is what a
GUI sees when it gets this wrong.

Two consequences of the move that the terminal states only in a system reminder, and that afleet
should render as a confirmation before moving, because in a window the user can see what they are
about to lose:

```
┌ Move #api-refactor to ~/src/other-project? ────────────────────┐
│  This channel will re-home to the new project:                  │
│   · project permission rules, hooks and skills change            │
│   · project MCP servers reload (consent may be asked again)      │
│   · the transcript moves with the channel                        │
│                                        [Cancel]  [Move]          │
└─────────────────────────────────────────────────────────────────┘
```

Authored copy, derived from the engine's own system reminder. After a successful move with
`transcript_relocated: true`, the channel moves to its new project section in the sidebar — a
visible confirmation the terminal has no way to give.

**Drops / keeps / gains.**
*Drops:* the free-text field and its race-prone completion provider (the picker has no race).
*Keeps:* `Moved to <path>`, the trust round trip and its exact argument requirement, the five
rejection reasons and their messages, the re-homing semantics.
*Gains:* `[exceeds]` a native picker and a drag target; `[exceeds]` move-when-idle instead of a
`busy` rejection; `[exceeds]` a pre-move summary of what re-homes; `[exceeds]` the sidebar shows
the move happened.

**Open.** When a move re-triggers project MCP consent (E-18), should the consent sheet appear
before the move or after? Before is safer and needs the `.mcp.json` read ahead of the request.

## I. Skills, memory, appearance, agents

### E-37 · `/skills` and the four override states

**Terminal.** `/skills` (`List available skills`, `local-jsx`, no `local` twin) is a **flat list with
no detail view** — verified by reading the dialog component at `cli.pretty.js:262300-262350`; the
row *is* the detail. Each row renders `<glyph> <label padded to 9>  <name> · <source> · <tokens>
tok`, and Enter or space cycles the row through four override states whose meanings come straight
from the settings describe string (verified `cli.pretty.js:233888`):

| Value | Glyph | Label | Listed to the model | Model may invoke | User may type `/name` |
|---|---|---|---|---|---|
| `on` | `✔` | `on` | `- name: description` | yes | yes |
| `name-only` | `●` | `name-only` | `- name` | yes | yes |
| `user-invocable-only` | `◯` | `user-only` | no | no | yes |
| `off` | `✘` | `off` | no | no | no |

Severity rises `on < name-only < user-invocable-only < off`. A row can be **locked**, prefixed `🔒 `
and suffixed ` · locked by <policy|flag|author|plugin>`, in that precedence order — and
`source === "plugin"` always resolves to `on`, so **plugin skills can never be overridden
individually**. Source labels are `claude.ai sync`, `mcp`, `plugin`, `memory store`, `built-in`,
else the scope (`user`, `project`, `project, gitignored`, `cli flag`, `managed`). Copy: title
`Skills`, `Search skills…`, `No skills found` / `Create skills in .claude/skills/ or
~/.claude/skills/` / `Plugin skills are managed via /plugin` (verified `cli.pretty.js:262311`),
`No skills match "<q>"`, footers `enter/space to cycle, / to search, <s> to sort, <esc> to close`
and `type to filter · ↓/enter to select · esc to clear`, and on close `Updated <N> skill
override(s)` or `No changes` / `Skills dialog dismissed`. Safe mode replaces the list with
`Custom skills are disabled in safe mode — <restart hint> to load them`. On dismissal the panel
writes `skillOverrides` to **`localSettings`**, skipping locked rows, and — importantly — writes
`undefined` (deleting the key) when the chosen state equals the inherited baseline from project or
user settings.

**Job.** Controlling what the model is told it can do. Every listed skill costs tokens on every
turn, so this panel is simultaneously a capability control and a context-budget control.

**Wire.** X for the dialog, R for the capability (`areas/30-29-32-plugins-skills-styles.md:280`,
*"no `local` twin — verified absent from the live command list"*). `skillOverrides` is P to read
and R to write (line 278; it is one of three deep-merged settings keys). Two warnings the inventory
issues directly: line 284, *"The delete-when-equal-to-baseline rule matters: without it the GUI
accretes redundant keys in every project"*; and gap 12 (line 410), *"**Plugin skills cannot be
disabled individually, and the GUI must not pretend otherwise.** … A skills manager that offers a
per-skill toggle on plugin rows will appear broken."* The token estimate needs `when_to_use`, which
is **D** — not on the wire, read from frontmatter on disk.

**afleet today.** `undesigned`. `/skills`, `/reload-skills` and `/skill-doctor` appear nowhere in
afleet source and have no router rows; `SystemFrames.swift:20` decodes `skills: [String]` from the
handshake and **nothing reads it**. Typing `/skills` yields the generic panel refusal.

**GUI form.** Settings → Claude Code → Extensions → **Skills**: a table with columns Skill, Source,
State, Tokens, sortable by any of them (the terminal has one sort toggle). The four states become a
four-way segmented control per row rather than a cycling Enter, with the terminal's glyphs kept as
the segment icons and its labels as the segment names. Locked rows render the control disabled with
the lock suffix verbatim; **plugin rows render the control disabled with `Managed in Plugins →`**,
which is the inventory's warning turned into copy.

Three things this pane should do that the terminal does not:
- **Show the cost of the choice as you make it.** A per-turn token total at the top, updating as
  states change: `Skills cost 1,240 tokens per turn (18 of 31 listed)`. The terminal shows per-skill
  tokens and never the sum, and the sum is the number that matters. `[exceeds]`.
- **Read `when_to_use` from disk** to make the token estimate real, which the wire cannot supply.
- **Implement the delete-when-equal-to-baseline rule exactly**, and show provenance per row so a
  user can see they are overriding a project default rather than setting a value.

The write is a `.claude/settings.local.json` file write (afleet's existing precedent) followed by
`reload_skills`. The empty state and the safe-mode line are kept verbatim.

**Drops / keeps / gains.**
*Drops:* the cycling Enter, the flat single-column row format, the dismissal strings.
*Keeps:* the four states with their glyphs, labels and semantics; the lock precedence and its
suffix; the source labels; the empty-state copy; the safe-mode line; `localSettings` write
semantics including the delete-when-baseline rule; plugin rows being uncontrollable.
*Gains:* `[exceeds]` a running per-turn token total; `[exceeds]` sortable columns; `[exceeds]`
provenance per row.

**Open.** Should the pane also list the skills the terminal hides (bundled, built-in, memory-store)?
They cost context too. The terminal's exclusion looks like a simplification rather than a decision.

### E-38 · `/reload-skills` and `/skill-doctor`

**Terminal.** `/reload-skills` is `local`, headless-capable, `Pick up skills added or changed on
disk during this session` (verified `cli.pretty.js:788504`); it clears every command and skill
cache and diffs by name, reporting
`Reloaded skills: <N> skill(s) available (<added/removed/no changes>)` with the suffix
` (custom skills are disabled in safe mode)` when relevant. `/skill-doctor` — `Show which loaded
skills are unused and costing context`, gated on `tengu_lantern_prism` — is **not a linter**: it
reports skills loaded but never invoked and what their listing costs per turn. Interactively it
redirects (`/skill-doctor moved — skill usage and context costs now live in this Stats tab.`);
non-interactively it prints a table with columns `skill  source  context  7d tokens  uses  last
used`, sorted by staleness with never-used first, under the explanatory lines
`context = this skill's one-line listing in the system prompt, included every turn` and
`7d tokens = tokens attributed to the skill over the last 7 days of sessions on this machine`, with
`(no skills loaded)` as the empty table and `All loaded skills have been used at least once.` as
the clean verdict.

**Job.** Picking up an edit without restarting, and finding the skills that cost tokens every turn
and earn nothing.

**Wire.** Both P (`areas/30-29-32…:285-291`). `/skill-doctor`'s text form works headlessly; only its
sortable table needs rebuilding. And line 291 gives a free win: *"**The GUI gets automatic pickup of
edited skill files for free.**"*

**afleet today.** `built` for reload, absent for the doctor. `ReloadSkills`
(`OutboundRequests.swift:148`) is sent by `ChannelHeaderActionsModel.reloadSkills()` from the
Extensions header menu (`HeaderMenus.swift:62`), reporting `"<N> skill(s) loaded."` No router row
for the typed command; no skill-doctor anything.

**GUI form.** Reload keeps the header menu item, gains a router row so the typed command works, and
gains the terminal's richer result sentence — added and removed counts, not just a total, since the
diff is what the user wants to know after editing a file. Because afleet watches files anyway for
its Files panel, it should offer what the inventory points at: **detect a changed skill file and
offer `Reload` in a channel banner**, rather than requiring the user to remember.

`/skill-doctor` is not a separate surface. Its six columns become columns in the Skills pane
(E-37) — `context`, `7d tokens`, `uses`, `last used` — with the staleness sort as one of the
sort options and the two explanatory lines kept verbatim as a footnote under the table. This is
what the terminal itself did when it moved the content into the `/plugin` Stats tab; afleet moves
it one step further into the pane that can act on it, so the user sees an unused skill and turns it
off in the same row. `[exceeds]`, and it costs nothing beyond the columns.

**Drops / keeps / gains.**
*Drops:* `/skill-doctor` as a separate surface, its redirect line, its ASCII table layout.
*Keeps:* the reload result template with its added/removed clause and the safe-mode suffix, the six
doctor columns and their sort, the two explanatory sentences verbatim, `(no skills loaded)` and the
all-used verdict.
*Gains:* `[exceeds]` a reload prompt when a skill file changes on disk; `[exceeds]` usage data and
the override control in one row.

**Open.** None.

### E-39 · `/memory`

**Terminal.** `/memory` (`Edit CLAUDE.md files and memory settings`, verified
`cli.pretty.js:787259`) opens a picker whose rows are heterogeneous by design: first the toggles
(`Auto-memory: on|off`, `Auto-dream: on|off · last ran <relative>`,
`Write to synced project memory: on|off`, the read-only
`Synced project memory: active|parked|ended`), then `Sync memories from: <project|off>`, then the
instruction files, then folder-opening rows (`Open auto-memory folder`, `Open team memory folder`,
`Open synced project memory: <mount>`, `Open <agentType> agent memory`). The file rows exclude
auto-memory records and three synthetic markers, and always append a `User` row for
`<configDir>/CLAUDE.md` and a `Project` row for `<cwd>/CLAUDE.md` even when they do not exist, so a
fresh install offers to create both. Descriptions are a first-match chain:
`Saved in ~/.claude/CLAUDE.md` → `Checked in at ./CLAUDE.md` or `Saved in ./CLAUDE.md` →
`@-imported` → `dynamically loaded`. Selecting a file creates it if missing and opens **`$VISUAL`
then `$EDITOR`**, reporting `Opened <path>` plus the guidance line
`> To change editor, set $EDITOR or $VISUAL environment variable.` and, in safe mode,
`> Safe mode: this session doesn't load CLAUDE.md files, so changes take effect after you
<restart>.` Failures read `Couldn't open <path> in an editor. If no editor is configured, set
$EDITOR or $VISUAL, then run /memory again.` Over a remote connection the whole thing is replaced
by `Memory files aren't available over this remote connection` (verified `cli.pretty.js:192492`).
Discovery is an eight-stage walk (managed → policy helper → managed `claudeMd` → managed rules →
user → ancestors highest-first with cwd last → additional directories, gated on an environment
variable → auto-memory). `@path` imports resolve relative to the importing file, depth ≤ 5, and an
out-of-cwd import needs the consent dialog **`Allow external CLAUDE.md file imports?`** with the
body `This project's CLAUDE.md imports files outside the current working directory. Never allow this
for third-party repositories.`

**There is no `#` quick-memory shortcut in 2.1.263** — SPEC 10 §10.24.3 records an exhaustive
negative search, and SPEC 42's section on `#` is titled "`#` — Slack channels, not memory". The
task prompt's assumption of a `#` destination picker does not apply to this canon.

**Job.** Finding and editing the instructions the model is given, at the right scope, and knowing
which files are actually loaded.

**Wire.** X for the picker, R for the list (`areas/13-10-23-context-memory-session-tools.md:116-117`):
`get_context_usage.memoryFiles` returns `[{path, type, tokens}]` with `type` drawn from the
five-member `MemoryType`. *"What is missing: `parent` (so `@-imported` cannot be labelled),
`globs`…"* — so afleet can list files and their tiers but cannot reconstruct the import tree from
the wire. Opening in `$EDITOR` is X *"but trivially superseded"* (line 118). The `#` shortcut is
classed **T** with an instruction: *"**A GUI must not build a `#` memory affordance.**"* The
external-import consent dialog is X today because afleet declares `supportedDialogKinds: []`, and
gap 12 (line 309) spells out the consequence: *"out-of-cwd `@` imports from project files are
silently dropped and the user is never told."*

**afleet today.** `designed`, with the surface stubbed. `RouterTable.swift:55` routes `/memory` to
`.memoryFiles` with the explanation `Opens the memory files in the Files tab.`;
`CommandRouter.swift:377-379` performs `GetContextUsage()` and returns the paths — and
`App/Composer/CommandRouting.swift:440-441` renders the entire result as
`editNote = "\(files.count) memory file(s)."` The paths are fetched and discarded, and the promised
Files tab never opens. The code says so itself at `CommandRouting.swift:409-411`: *"a permissions
view, an MCP popover and a memory list are panels of their own, which this leaf does not draw
(tracker 206)."*

**GUI form.** Two surfaces, because the terminal's picker is doing two jobs.

1. **The files go to the Files panel**, which is what root spec §7.7 already promises and what
   afleet is uniquely equipped for: a real editor (Monaco) instead of `$EDITOR`, with the memory
   files as a scoped tree grouped by tier (`Managed`, `User`, `Project`, `Local`, `AutoMem`) in
   discovery order, each showing its token cost from `memoryFiles`. The terminal's
   create-if-missing behaviour is kept for the two always-offered rows. `[exceeds]` — editing
   instructions next to the conversation they govern, with no editor resolution, no `$VISUAL`
   guidance line, and no failure mode.
2. **The toggles go to the Defaults pane** (E-03's neighbours): `Auto-memory`, `Auto-dream` with
   its `last ran` readback, `Write to synced project memory`, and the read-only
   `Synced project memory` state. These are settings, not files, and the terminal only mixes them
   because it has one screen. Their write class is 5 (`Open file`) — the parity area file claims
   `update_settings` can write `autoMemoryEnabled`, and that claim is **wrong**; the allow-list is
   `outputStyle` alone (README finding 7, and see *Spec defects*).

Two things afleet must add rather than port:
- **The external-import consent dialog.** afleet declares no dialog kinds, so imports outside the
  cwd are dropped silently. Rebuilding the consent — reusing the E-18 consent sheet — turns a
  silent capability loss into a decision, and the terminal's body copy including
  `Never allow this for third-party repositories.` is kept verbatim.
- **The import tree.** `parent` is not on the wire, but afleet can parse `@path` from the files it
  already reads and draw the tree the terminal shows as indentation. `[exceeds]`, and it is the
  only way to answer "why is this file loaded?"

**No `#` affordance is built.** If afleet ever adds a `#` completion it is for something else.

**Drops / keeps / gains.**
*Drops:* the picker, the `$EDITOR`/`$VISUAL` resolution and its three guidance lines, the
folder-opening rows (the Files panel reveals a folder natively), the remote refusal.
*Keeps:* the tier taxonomy and discovery order, the description chain, create-on-select for the two
offered files, the safe-mode warning, the external-import consent body verbatim.
*Gains:* `[exceeds]` a real editor in the window; `[exceeds]` per-file token cost shown in the
tree; `[exceeds]` a reconstructed import tree; `[exceeds]` external-import consent where afleet
currently drops imports silently.

**Open.** Should memory files get a dedicated Files-panel scope, or a `Memory` tab of their own?
The former is cheaper and keeps one editor.

### E-40 · `/theme`

**Terminal.** `/theme` (`Change the theme`, `local-jsx`, `immediate` only in fullscreen — so
inline it queues behind the current turn, SPEC 41.10.5) opens a picker whose seven built-in rows
are, verbatim and in order (`cli.pretty.js:536296`, corroborated by the label map at `:392623`):
`Auto (match terminal)`, `Dark mode`, `Light mode`, `Dark mode (colorblind-friendly)`,
`Light mode (colorblind-friendly)`, `Dark mode (ANSI colors only)`, `Light mode (ANSI colors
only)`. Then user themes as `<name> (custom)` and plugin themes as `<name> (from <plugin>)`, then
`New custom theme…`. Title `Theme` in the `permission` colour; subtitle
`Choose the text style that looks best with your terminal` (`cli.pretty.js:536317`); key hints
`enter select`, `<ctrl+e> edit` (only on a custom theme), `escape cancel`; a syntax-highlight status
line toggled with Ctrl+T. **The preview is live and it is a rendered code diff, not a swatch**
(`cli.pretty.js:536373`): moving the cursor recolours the entire UI against a fixed `demo.js` patch
turning `Hello, World!` into `Hello, Claude!`, Enter saves, Escape restores. Persistence is the key
`theme` in **`userSettings`**, accepting `auto`, one of six ids, or `custom:<slug>`; custom themes
are `~/.claude/themes/<slug>.json`.

**Job.** Making the text legible in the user's terminal — including the two colour-blind variants,
which are the product's only accessibility affordance of this kind.

**Wire.** X for the picker, R for the setting (`areas/41-tui-rendering.md:77-81`). Line 77 issues
the one instruction that matters: the two daltonized variants are *"the product's only colour-blind
affordance and a GUI that ships only light/dark regresses accessibility."* Gap 12 (line 703):
*"Custom themes… live only on disk. A GUI that ignores `~/.claude/themes/*.json` silently discards
personalisation the user set up in the terminal. Class R, cheap to fix."*

**afleet today.** `undesigned` for Claude Code's theme, and correctly so at the top level: afleet
draws its own window, so the engine's Ink palette governs nothing afleet renders. Every `theme` hit
in afleet source is the embedded terminal's colour scheme (`Workbench/…/TerminalAppearance.swift`)
or Monaco's. The only prose is `RouterTable.swift:96`'s `/color` explanation.

**GUI form.** `superseded` for the engine's theme, with two real obligations that follow from it —
this card owns the picker surface; lane A owns colour application.

1. **afleet's own appearance control must carry the accessibility variants.** The terminal ships
   `dark-daltonized` and `light-daltonized` and afleet's Settings has no appearance section at all.
   Whatever afleet's palette becomes, shipping only light and dark is the regression the inventory
   names. The picker form is the same: a list with a **live preview** — and afleet can preview a
   real diff in a real editor rather than a four-line ASCII patch. `[exceeds]`.
2. **The embedded terminal's theme should follow the engine's `theme` setting.** afleet hosts
   GhosttyKit panes in the Terminal tab; a user who set `dark-ansi` because their terminal owns its
   colours has expressed a preference that applies to exactly that pane. Reading `theme` from
   `get_settings` and mapping it onto `TerminalAppearance` is the honest use of the setting.

Everything else is dropped: the seven labels are terminal-palette names, `Auto (match terminal)`
has no meaning in a window that follows the system, `custom:<slug>` themes are Ink token maps, and
Ctrl+T's syntax-highlighting toggle is a code-rendering choice lane B owns.

**Drops / keeps / gains.**
*Drops:* the picker, the seven labels, custom and plugin themes, the `demo.js` preview, the
syntax-highlight status line, `theme` as an afleet-written setting.
*Keeps:* the requirement for colour-blind variants; live preview as a pattern; the setting as a
*read* for the embedded terminal.
*Gains:* `[exceeds]` the preview can be a real diff in a real editor; `[exceeds]` macOS appearance
integration (system light/dark, increased contrast) that a terminal palette cannot reach.

**Open.** Does afleet want its own theme system at all beyond system light/dark plus a
colour-blind-safe palette? That is a design-system decision, not a translation.

### E-41 · `/output-style`

**Terminal.** `/output-style` is a **tombstone**. SPEC 32 §32.11.1: *"There is no functional
`/output-style` command in 2.1.263."* It is hidden, gated on `tengu_maple_sundial` (default off),
built by a factory shared with `/vim`, and its whole behaviour is to print
`/output-style moved → Output style in /config` (verified `cli.pretty.js:349475`) and open the
settings dialog on the Config tab. The real surface is `/config`'s `Preferred output style`
sub-view, subtitled `This changes how Claude Code communicates with you`. The five built-ins are
`default` (shown as `Default` / `Claude completes coding tasks efficiently and provides concise
responses`, a UI-only string), `Proactive`, `Concise`, `Explanatory` and `Learning`, each with its
description verbatim. Custom styles are discovered in three roots (managed, `<configHome>/output-styles`,
each ancestor's `.claude/output-styles`) — note `localSettings` is **not** scanned even though it is
where the selection is written. A style becomes the system-prompt section
`# Output Style: <name>` followed by its body, eleventh of twenty-six sections; a style whose
frontmatter omits `keep-coding-instructions` causes the `# Doing tasks` section to be **dropped
entirely**, which the inventory calls *"the single most behaviour-changing frontmatter decision in
the format, and it is silent."*

**Job.** Changing how Claude talks — terse, explanatory, teaching — without editing a system prompt.

**Wire.** The best-supported write in the entire lane. `initialize.available_output_styles` carries
the five built-ins (P, *"verified live as exactly these five"*), plugin styles as
`<plugin>:<style>` (P), and custom style **names** (P) but not their descriptions (R). And
`outputStyle` is the **one key `update_settings` accepts**, into `localSettings`, values as strings
(README finding 7). Two traps: the headless `/config outputStyle=<v>` shorthand accepts only the
five built-in keys, so a custom style must go through `update_settings`; and a plugin style with
`force-for-plugin: true` *"overrides the user's setting entirely and is invisible to
`initialize.output_style`… the GUI's style picker would show 'default' while a plugin's style is
actually in force"* (D). After writing a new style file the GUI should issue `reload_plugins` —
`reload_skills` does not clear the cache.

**afleet today.** `built` in FleetKit, unreachable from the app.
`Fleet.swift:631,653-654` maps `"outputStyle"` to `UpdateSettings`, `RuntimeState.swift` tracks the
applied value and verifies it after a restart, `ChannelState.swift:187` holds it, and
`WireEvent.swift:12-13` decodes `availableOutputStyles` — **which nothing reads**. There is no
picker, no router row and no UI anywhere in `App/`. This is the only setting in the entire product
that afleet can write with one control request, and it has no control.

**GUI form.** A fourth header picker beside model, mode and effort, populated from
`available_output_styles`, writing through `update_settings` and reading back — the same discipline
C6.2 specifies for the other three. Rows keep the five names and their descriptions verbatim,
including `default`'s UI-only description. Custom and plugin styles appear by name with their
source (`from <plugin>`); their descriptions are read from disk when afleet can reach the file, and
omitted otherwise rather than faked.

Three additions:
- **The `force-for-plugin` blind spot, named.** When a plugin forces a style, the wire still
  reports the user's choice, so the picker would lie. afleet cannot detect this from the wire (D),
  so the picker carries a footnote — `A plugin can override this for its own turns.` — rather than
  presenting the readback as complete. Authored copy; the alternative is a control that silently
  disagrees with reality.
- **The `keep-coding-instructions` consequence, surfaced.** When a custom style omits it, afleet
  can see that in the frontmatter it reads and should say so on the row:
  `Replaces Claude Code's task instructions.` The terminal never mentions it.
- **`/output-style` the command routes to the picker**, matching the terminal's own redirect
  semantics. The clone shipped exactly the redirect and scored it faithful; afleet's equivalent of
  "open `/config`'s row" is "open the picker".

**Drops / keeps / gains.**
*Drops:* the redirect line, the `/config` sub-view as a separate surface.
*Keeps:* the five names and descriptions verbatim, the sub-view's subtitle, custom and plugin style
naming, the `reload_plugins`-after-write rule.
*Gains:* `[exceeds]` a persistent header readback of the active style; `[exceeds]` a named warning
for the plugin-force blind spot and the dropped-instructions frontmatter.

**Open.** None. This is the highest ratio of value to effort in the lane: one picker, one control
request that already exists, one field already decoded.

### E-42 · `/agents`

**Terminal.** The `/agents` wizard **was removed**. In 2.1.263 the command is `local`,
headless-capable, and prints a static notice (verified `cli.pretty.js:788497`):

```
The /agents wizard has been removed.

Ask Claude to create or update subagents for you (e.g. "create a code-reviewer subagent that ..."),
or edit the files directly:
  • .claude/agents/       (this project)
  • ~/.claude/agents/     (all projects)

Docs: https://code.claude.com/docs/en/sub-agents
```

So there is no list, create, edit, delete or colour flow to translate — the task prompt's
description of `/agents` describes a surface that no longer exists in this canon. What survives is
the data model the wizard used to edit: agent files discovered in four roots in precedence order
(managed, `<configHome>/agents`, additional working directories, then each ancestor's
`.claude/agents`), with frontmatter keys `description` (required), `tools`, `disallowedTools`,
`model`, `effort`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, `initialPrompt`,
`memory`, `background`, `isolation`, `observer`, plus the **markdown-only** `name`, `color` and
`experimental.cacheTtl`. The colour palette is exactly eight: `red`, `blue`, `green`, `yellow`,
`purple`, `orange`, `pink`, `cyan`.

**Job.** Seeing which subagents exist, what each is allowed to do, and — since a subagent inherits
tools, model and permission mode — auditing a delegation before it happens.

**Wire.** P for the command (it runs headless and its output arrives as a local command output),
and a rich D underneath (`areas/18-agents-subagents.md:82-86`): `initialize.agents[]` is
`{name, description, model?}` only, live-verified across eleven entries, and
`system/init.agents` is a bare array of names — *"No `color`, no `tools`, no `source`, no
`whenToUseLean`, no file path."* Colour is nowhere on the wire; the workaround is to parse the
`.md` frontmatter or read `subagents/agent-<id>.meta.json` after a spawn. Line 85 is the
opportunity: the frontmatter fields *"are equally blind on both surfaces; a GUI that parses the
frontmatter can **exceed** the TUI."* And line 324 says it outright: *"The wizard is gone in
2.1.257+; a GUI's own agent editor is a clear improvement over the TUI here."*

**afleet today.** `routed-only`, and the route dead-ends. `RouterTable.swift:57` maps `/agents` to
`.native("agents")` with the explanation `Lists the agents from the handshake.`, but `.native`
resolves through `SettingPickersModel`, whose `pickerSurfaces` is `["modelPicker", "effortPicker"]`
— so `/agents` presents nothing at all and reports nothing. `App/Agents/` is not a management UI: it
holds `AgentNavigation.swift`, a protocol keyed by the engine's `task_id` with a no-op default, and
its README describes the future Agents **tab** as *"the run tree, the per-run transcript, node
actions, chip navigation"*. That tab is C6.4, `not-dispatched`. Nothing in afleet reads
`.claude/agents/` or any frontmatter field. Note that lane G owns the run-monitor surface; this
card owns only the *definitions*.

**GUI form.** Settings → Claude Code → Extensions → **Agents**, a definitions browser and editor —
the surface upstream removed, rebuilt because a GUI can afford it and the inventory recommends it.
List by source in discovery precedence order, each row showing name, colour swatch, model,
permission mode and a one-line description; the detail pane shows the full frontmatter as a form
and the body as a Monaco editor. Writes go to `~/.claude/agents/<name>.md` or
`<project>/.claude/agents/<name>.md`, which is a plain file write in a directory X9 does not cover
for the project case and does cover for the user case — so user-scope agents get the `Open file`
route of E-01's class 5, and project-scope agents can be written directly.

Kept exactly: the four discovery roots and their precedence, every frontmatter key with its
validation (the `permissionMode` error string is quotable verbatim from SPEC 18), the markdown-only
key set, and the **eight-colour palette** — no more and no fewer, since a ninth colour would not
render.

Two things this pane makes possible that neither surface has:
- **Colour, resolved.** afleet needs agent colour for the timeline's agent chips and the Agents tab
  and cannot get it from the wire; parsing frontmatter here supplies it for both. One parse, two
  consumers. `[exceeds]`.
- **A capability audit.** Showing `tools`, `disallowedTools` and `permissionMode` per agent answers
  "what can this subagent do without asking me?", which is a security question the terminal cannot
  answer at all now that the wizard is gone.

The removal notice is not shown. Typing `/agents` opens the pane.

**Drops / keeps / gains.**
*Drops:* the removal notice.
*Keeps:* the discovery roots and precedence, the frontmatter schema and validation strings, the
eight-colour palette, the markdown-only key distinction.
*Gains:* `[exceeds]` an editor for a surface upstream deleted; `[exceeds]` colour parsed once and
used by the timeline; `[exceeds]` a per-agent capability audit.

**Open.** Rebuilding a surface upstream removed is a product decision, not a fidelity one. It is
justified here by afleet being an agent workspace — subagents are the product — but the owner should
confirm the direction before this is built.

## J. Auth and account

### E-43 · `/login`

**Terminal.** `/login` is `local-jsx` whose description is a getter — `Switch Anthropic accounts`
when signed in, `Sign in with your Anthropic account` when not (SPEC 28 §5). It runs a state
machine `idle → console_method | ready_to_start | platform_setup | gateway_setup →
waiting_for_login → success | account_on_hold | error → about_to_retry` (SPEC 08 §4.7, verified
`cli.pretty.js:787556`). Its top-level menu is three rows:

```
Select login method:
  Claude account with subscription · Pro, Max, Team, or Enterprise
  Anthropic Console account · API usage billing
  3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI
```

with the Console submenu `Sign in with your Console account (recommended)` /
`Create an API key (legacy) · adds a key to your Console workspace` / `Go back`. Other copy:
`Claude Code can be used with your Claude subscription or billed based on API usage through your
Console account.`, `Browser didn't open? Use the url below to sign in`,
`Login successful. Press Enter to continue…`, `Logged in as <email>`,
`Failed to exchange authorization code for access token. Please try again.`, and the pinned-policy
refusal `Settings on this machine pin the login method or organization, so signing in without an
API key is not available here.` PKCE S256 with an **ephemeral** loopback port; credentials go to
the macOS keychain (service `Claude Code-credentials`) or `~/.claude/.credentials.json` at `0600`,
and account metadata to `~/.claude.json`'s `oauthAccount`. `/login` is one of five commands
declaring `fleetHostCall`, an explicit hook for a host to perform the operation on the worker's
behalf.

**Job.** Signing in, and switching between a subscription account and an API-billed one.

**Wire.** X for the panel, **P for the flow**. README finding 14: *"The account login flow and MCP
OAuth are drivable headless. `claude_authenticate` returns `{manualUrl, automaticUrl}`… `/login`,
`/logout` and the `/mcp` auth rows are therefore reproducible without a terminal."* The trio is
`claude_authenticate {loginWithClaudeAi?}`, `claude_oauth_callback {authorizationCode, state}` and
`claude_oauth_wait_for_completion {}` → `{account}`. Account state arrives as
`initialize.account = {email, organization, subscriptionType, tokenSource, apiKeySource,
apiProvider}` (P), and `--enable-auth-status` adds an `auth_status` frame (P, opt-in). What does
**not** exist is a logged-out boolean: the state arrives only as turn-failure text, and the
headless phrasing differs from the terminal's — *"the non-interactive variant is `Failed to
authenticate: OAuth session expired and could not be refreshed`… The GUI must map the
non-interactive phrasing (it will never see 'run /login')"* (`areas/06-08-02…:155`).

**afleet today.** `built`. `RouterTable.swift:45` routes `/login` to `.login` with the explanation
`Signs in through the Browser tab.`; `CommandRouter.swift:351-363` performs `claude_authenticate`,
opens the URL and awaits `claude_oauth_wait_for_completion`;
`App/Composer/CommandRouting.swift:594-597` routes the URL into the Browser panel and `:430-434`
reports `"Signed in."` Root spec §7.7 specifies the whole flow including the manual-URL fallback.
`ClaudeOAuthCallback` is defined but has **no non-test caller** — so the manual fallback is
specified and unwired.

**GUI form.** Keep the flow; add the account surface it currently lacks. `/login` belongs in the
**Account pane** (Settings → Claude Code → Account) as well as on the composer command, and the
pane is where the three-way method menu lives, with its labels and their subtitle clauses verbatim.
The browser step stays in the Browser panel — this is afleet's structural advantage and it is
already built.

Three things to finish:
- **Wire the manual fallback.** When the loopback listener cannot complete (a remote engine, a
  blocked port), afleet reads the redirect URL out of its own web view and sends
  `claude_oauth_callback`. The request exists; only the caller is missing.
- **Map the headless failure phrasings.** afleet will never see `Please run /login`; it sees
  `Failed to authenticate: OAuth session expired and could not be refreshed`. The banner copy must
  key off the headless strings, and the eleven `API Error` sentences from SPEC 08 §23.1 (verified
  `cli.pretty.js:723139`) are the vocabulary — `Not logged in · Please run /login`,
  `OAuth token revoked · Please run /login`, `Login expired · Please run /login`,
  `Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API
  key instead…` — each rewritten so its remedy names afleet's own action rather than a slash
  command.
- **Show the account.** `initialize.account` is on the wire and afleet renders none of it. The
  Account pane shows email, organization, plan display name (`Claude Enterprise`, `Claude Team`,
  `Claude Max`, `Claude Pro`, else `Claude API`), token source and API-key source, with the
  2.1.260 ` · not in use` suffix when a credential is present but not authenticating.

**Drops / keeps / gains.**
*Drops:* the `Press Enter to continue…` step, the copy-the-URL instruction (the browser is inside
the app).
*Keeps:* the three method labels and their subtitles, the Console submenu, the pinned-policy
refusal, `Logged in as <email>`, the exchange-failure sentence.
*Gains:* `[exceeds]` the OAuth browser is a panel tab, so nothing leaves the app; `[exceeds]` a
persistent account readback where the terminal has only `/status`.

**Open.** Should switching accounts be allowed while channels are running? `/logout` has a whole
census for this (E-44); `/login` currently has none, and switching the account under twenty live
channels is at least as consequential.

### E-44 · `/logout`

**Terminal.** `/logout` (`Sign out from your Anthropic account`, `local-jsx`) prints
`Signing out…` or `Couldn't sign out — <message>`, revokes both the `claudeAiOauth` and
`designOauth` refresh tokens server-side, removes any API key, deletes the credential store
(preserving `coworkRemoteDevice`) and clears thirteen `~/.claude.json` keys including
`oauthAccount`, `modelAccessCache` and `cachedUsageUtilization` (SPEC 08 §8.7). It also declares
`fleetHostCall`.

**Job.** Signing out — which on a machine running many sessions is not a single-process action.

**Wire.** **X**, and the sharpest constraint in this sub-family
(`areas/06-08-02-models-auth-bootstrap.md:138`): *"**no** `claude_logout` control request exists…
the GUI shells out to `claude auth logout`… the running session keeps its in-process token until
restarted."* So logout is a class-4 subprocess plus a lifecycle problem.

**afleet today.** `built`, and it is the largest single command implementation in the app —
`FleetKit/Sources/FleetSessions/Router/LogoutPlan.swift` (255 lines) implements exactly what root
spec §7.7 specifies: a spawn barrier, a census of owned channels and afleet-launched background
jobs from the roster, `claude stop <short>` for jobs verified gone from the roster, a Wait-or-Stop
choice for channels with live tasks, termination, then `claude auth logout`, then a report. Copy
already exists and is good: `Sign out of every channel on this machine?`,
`Every owned channel and every afleet-launched job on this machine signs out.`, button `Sign Out`
(`App/Composer/CommandRouting.swift:82,93,110,126`),
`A logout is running; your message is still in the field.` (`ComposerModel.swift:328`) and
`A logout is running; no channel may spawn until it finishes.` (`ChannelRow.swift:182`).

**GUI form.** This is the one card in the lane where afleet's built form **exceeds the terminal
already** and the proposal is to leave it alone and surface it better. Three refinements:

- **Give it a home in the Account pane**, not only the composer. Signing out is an account action
  and a user looking for it will look in Settings.
- **Show the census as a list, not a sentence.** The plan already computes owned channels with
  their live tasks and afleet-launched jobs; rendering them as rows with per-row `Wait` and `Stop`
  turns the terminal's blunt choice into a per-channel one. `[exceeds]`, and the data is already
  in hand.
- **Keep the foreign-session sentence.** Root spec §7.7 names it: foreign sessions keep their token
  until they restart, because logout is a separate process and a running session holds its
  in-process token. That sentence must survive into the UI, or a user will believe they have signed
  out everywhere.

**Drops / keeps / gains.**
*Drops:* `Signing out…` as a transcript line (a progress sheet instead).
*Keeps:* the failure sentence, the credential and `~/.claude.json` clearing semantics (performed by
the CLI, not afleet), the foreign-session caveat.
*Gains:* `[exceeds]` a machine-wide census, a spawn barrier, per-channel wait-or-stop, and job
cleanup — none of which the terminal attempts, because it has one session to think about.

**Open.** None.

### E-45 · `/setup-bedrock` and `/setup-vertex`

**Terminal.** Both are `local-jsx` and hidden unless the corresponding environment variable is set
(`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX`). `/setup-bedrock` (`Reconfigure Amazon Bedrock
authentication, region, or model pins`) is an eight-step wizard titled `Set up Amazon Bedrock`
with the method labels `AWS profile (SSO or named profile)`, `Bedrock API key (bearer token)`,
`Access key + secret` and `Use credentials already in my environment`; `/setup-vertex`
(`Reconfigure Google Vertex AI authentication, project, region, or model pins`) is a seven-step
wizard titled `Set up Google Vertex AI` subtitled `How do you authenticate to Google Cloud?`.
Completing either marks onboarding complete and **relaunches the process** (SPEC 02 §8.9.1).

**Job.** Pointing Claude Code at a third-party model provider.

**Wire.** X, with an explicit instruction (`areas/06-08-02…:197-199`): *"A GUI must never promise
Bedrock/Vertex onboarding."*

**afleet today.** `undesigned`, and effectively out of reach: afleet passes the provider environment
variables through an allowlist (`ClaudeWire/…/LaunchConfiguration.swift:194-197`) and never writes
them. No router rows.

**GUI form.** Not rebuilt. The Account pane detects the provider from
`initialize.account.apiProvider` and, when it is Bedrock or Vertex, renders a read-only block:
provider, region and the model pins as reported, with one line saying where they are configured.
Typing either command gets afleet's own explanation rather than the generic panel refusal:
`/setup-bedrock runs Claude Code's Amazon Bedrock onboarding wizard, which writes provider
credentials and then relaunches the CLI. afleet hosts the CLI rather than configuring its
providers; set it up once in a terminal and afleet will use it.` Authored copy, and it is the
honest form — the wizard relaunches the process it runs in, which is not something a host can offer
on the host's behalf.

**Drops / keeps / gains.**
*Drops:* both wizards entirely.
*Keeps:* the provider readback in the Account pane.
*Gains:* nothing.

**Open.** None.

### E-46 · `/privacy-settings`

**Terminal.** `/privacy-settings` (`View and update your privacy settings`, `local-jsx`, enabled
only for a claude.ai account in a privacy-capable organization — Pro and Max per SPEC 48 §16)
opens either a toggle row, `Help improve our AI models`, with values `true`, `false` and
`false (for emails with your domain)`, or the consent dialog `Updates to Consumer Terms and
Policies` whose options are `Accept terms · Help improve our AI models: ON` / `… OFF` and, during
the grace period, `Not now`. Its fallback line is `Review and manage your privacy settings at
https://claude.ai/settings/data-privacy-controls`, and its outcomes are
`Privacy settings dialog dismissed`, `Unable to retrieve updated privacy settings` and
`"Help improve our AI models" set to <v>.` **It writes nothing locally** — the choice is a
server-side account field changed by a `PATCH`, with a 24-hour local cache.

**Job.** A consent decision with a legal deadline attached.

**Wire.** X, with a consequence afleet cannot ignore (`areas/46-19-48-37…:157`): *"Headless mode
prints the consent notice to stderr instead, and after the deadline exits with status 1… afleet
must surface that stderr text or the user gets an unexplained exit."*

**afleet today.** `undesigned`, and this is a **live failure mode, not a missing feature**: when the
consent deadline passes, a channel afleet spawns will exit with status 1 and afleet has nothing to
show for it. Nothing in `App/` reads the engine's stderr for this purpose.

**GUI form.** Two pieces, and the second is the one that matters.

1. **A read-only row in the Account pane** showing the current value of `Help improve our AI
   models` with the terminal's own fallback line as a link to
   `https://claude.ai/settings/data-privacy-controls`. afleet cannot change a server-side account
   field and should not pretend to.
2. **A channel banner built from the stderr notice.** When a spawn fails or a channel exits with
   status 1 and the consent notice is on stderr, afleet renders that text verbatim in the channel
   banner with `Open privacy settings` linking out. Without it the user sees a channel that
   refuses to start for no visible reason — which is the single worst outcome in this sub-family,
   because it looks like afleet is broken.

**Drops / keeps / gains.**
*Drops:* the toggle and the terms dialog.
*Keeps:* the setting's label and value vocabulary as a readback, the fallback URL line verbatim,
the stderr notice text verbatim.
*Gains:* `[exceeds]` an unexplained exit becomes an explained one.

**Open.** None, but this is a correctness item rather than a translation, and it should rank
accordingly.

### E-47 · `/usage-credits` and `/extra-usage`

**Terminal.** `/usage-credits` (`Configure usage credits or request them from your admin when you
hit a limit`) is a fifteen-state machine — `loading, enabling, adjusting, auto_reload_saving,
buy_purchasing, buy_success, buy_polling, not_enabled, enabled, buy_select, buy_custom,
buy_confirm, adjust_limit, auto_reload_config, error` — with a 2000 ms poll over 30 attempts, a $5
minimum custom purchase, a typed-`yes` confirmation above $1,000 and a $10,000 hard maximum
(SPEC 48 §12.8). Copy includes `Turn on usage credits`, `Keep using Claude when you hit a limit.`,
`No card on file — add a payment method at <url>`,
`Out of usage credits — buy more below to keep going.`,
`You've hit your monthly limit — raise it below, or it resets next month.`,
`This spend limit goes into effect immediately.` and
`Automatically buy more usage credits when your balance is low.` `/extra-usage` is the hidden
former name, described `Renamed to /usage-credits`. **These two are the only commands in this
sub-family with a headless `local` twin**, and the twin's answer is a redirect:
`Requesting usage credits notifies your organization admins. To review and send the request, run
/usage-credits in an interactive Claude Code session.`

**Job.** Paying to keep going when a limit is hit — the one settings surface with money in it.

**Wire.** P for the text form, X for the dialog (`areas/46-19-48-37…:170`: *"the 15-state purchase
dialog itself is `local-jsx` and unreachable; headless gets the `local` variant"*). Live evidence
confirms both are in `slash_commands` — **the only two of the twenty-one auth and environment
commands that are**. The behaviour is flagged **unverified** at `areas/06-08-02…:393`.

**afleet today.** `undesigned` as a user-invocable surface, `built` as an engine-pushed one.
`App/Decisions/DecisionCard.swift:31-34` handles exactly two dialog kinds, one of which is
`fable_overage_consent_prompt`, and `DialogCardView.swift` renders its options `Use usage credits`,
`Set up usage credits…`, `Switch to the default model`, `Not now`. But
`DecisionAnswerMapping.swift:142-143` maps `setUpUsageCredits` to `nil` deliberately, and
`DialogCardView.swift:107` says why: `Usage credits are set up outside this session; the engine
sent no address to open.` So today, when the engine offers to set up credits, afleet's card has a
button that does nothing.

**GUI form.** Do not rebuild the purchase machine. Money flows belong to the account, not to a
terminal host, and a fifteen-state purchase dialog reimplemented against an unverified surface is
the worst kind of ambition. Instead:

- **Send the text command.** `/usage-credits` is headless-capable; afleet routes it as `.text` and
  renders the engine's redirect sentence verbatim in the timeline. That is a real answer, and it is
  what the twin exists for.
- **Fix the dead button.** `Set up usage credits…` on the overage decision card should open
  `https://claude.ai/settings/usage` in the Browser panel. The engine sends no address, so afleet
  supplies one — a card whose primary action does nothing is worse than a card with one fewer
  option.
- **Show the balance where the limit is felt.** If `get_usage` carries credit state (it carries
  `spend` and `severity` per `areas/06-08-02…:184`), the Account pane shows it beside the plan.

**Drops / keeps / gains.**
*Drops:* the fifteen-state purchase flow, all its thresholds and confirmations.
*Keeps:* the headless redirect sentence verbatim, the decision card's four option labels.
*Gains:* a working button where one is currently inert.

**Open.** Does the owner want any purchase flow inside afleet at all? This card says no and routes
to the web, and the alternative is a substantial build against an unverified surface.

### E-48 · `/rate-limit-options`, and the auto-continue gap

**Terminal.** `/rate-limit-options` (`Show options when rate limit is reached`, hidden, enabled for
claude.ai subscribers) opens a menu titled `What do you want to do?` with up to eight conditional
entries: `Add funds to continue with usage credits`, `Switch to usage credits`,
`Ask your admin for more usage`, `Upgrade your plan`, `Stop and wait for limit to reset`,
`Wait here, then continue automatically at <t>`, `Don't continue automatically`,
`Reset your session limit now` and `Continue now at lower priority…`. Arming the wait confirms with
`Claude Code will continue automatically <when>. Keep this session open; it may still pause for
permission prompts. Press esc to cancel the wait.` and cancelling with
`Automatic continue cancelled. Your session will wait for you instead; /rate-limit-options can arm
it again.` The limit-type display names are a client-side map: `five_hour → session limit`,
`seven_day → weekly limit`, `seven_day_opus → Opus limit`, `seven_day_sonnet → Sonnet limit`,
`seven_day_overage_included → Fable limit`, `overage → usage credit limit` (SPEC 48 §13.2).

**Job.** Deciding what happens when you run out — and, for anyone running unattended work, arming
the machine to resume by itself.

**Wire.** X for the panel, and the inventory is emphatic that this matters
(`areas/46-19-48-37…:172`): *"**This is the entry point to auto-continue.** Without it a headless
host cannot arm a wait explicitly."* The option set itself is D — *"a GUI must hard-code its own
remediation copy"*. The *state* is P and rich: the `rate_limit_event` frame carries
`{status: "allowed"|"allowed_warning"|"rejected", resetsAt?, rateLimitType?, utilization?,
unifiedWindows?}` and *"Everything a banner needs is on the wire"* (`areas/06-08-02…:169`);
`get_usage.rate_limits` is richer than SPEC 08 documents. Two D-class holes: the grace-window and
slow-lane meters are not in the frame, and **auto-continue armed/stale state has no frame at all**
— *"Real gap. The GUI must implement the wait-and-resubmit itself"* (line 173).

**afleet today.** `designed` and unrendered. Root spec §7.6 specifies it: *"A `rate_limit_event`
renders a banner at the top of the channel with the limit that applies and its reset time."*
`RateLimitEventFields` is decoded (`OtherFrames.swift:29-33`) and Activity classifies
`rateLimitRefused` and `rateLimitInfo` (`ActivityQuery.swift:14-17`). But
`FleetKit/…/Overlay.swift:39-48` defines `Banner.Kind` including `rateLimit` and `auth`, it is
populated at `WireReducer.swift:289-293`, and **nothing reads `overlay.banners`** — verified across
`App/`, `Workbench/`, `AfleetCore` and `FleetKit/Sources`. The separate `ChannelBanner` type that
`App/` does render has seven cases, all lifecycle and ownership, and no rate-limit or auth case. So
rate limits reach the user only as Activity rows, and the designed banner does not exist. Usage-limit
auto-continue is in root spec §17.8's **Deferred** list, to be *"rebuilt from
`rate_limit_event.resetsAt`"*.

**GUI form.** Three pieces, in ascending order of value.

1. **Render the banner that is already designed and already computed.** Connect `overlay.banners`
   to the channel banner region, with the six display names kept verbatim and the reset time
   rendered as a live countdown. This is a wiring job, not a design.
2. **Make it a menu, not a message.** The banner's actions are the terminal's eight entries,
   conditional on the same state: `Wait here, then continue automatically at <t>`,
   `Stop and wait for limit to reset`, `Switch to usage credits`, `Upgrade your plan`. Both
   confirmation sentences are kept verbatim, adapted for the missing Escape (`Cancel wait`).
3. **Build auto-continue, and make it a fleet feature.** It has no frame, so afleet implements the
   wait-and-resubmit itself from `resetsAt` — and unlike the terminal, afleet can arm it for
   several channels at once and show them all waiting in the Activity view. `[exceeds]`, and it is
   the single most valuable thing in this sub-family for a fleet: twenty channels that stall at a
   limit and resume by themselves are a different product from twenty channels that stop.

**Drops / keeps / gains.**
*Drops:* the modal menu, `Continue now at lower priority…` and `Reset your session limit now`
(unverified whether either is reachable without the panel — marked unverified).
*Keeps:* the six limit display names, the menu entries as banner actions, both confirmation
sentences.
*Gains:* `[exceeds]` a countdown; `[exceeds]` auto-continue across many channels with a
cross-channel view of what is waiting.

**Open.** Auto-continue is Deferred in root spec §17.8. This card argues it is a fleet-defining
feature rather than a nicety, and asks the owner to reconsider its position.

### E-49 · `/pro-trial-expired` and `/upgrade`

**Terminal.** `/pro-trial-expired` (`Options shown when the Pro plan Claude Code trial has ended`,
hidden) auto-opens when the trial has ended and a cached extra-usage disabled reason exists,
showing `Your Claude Code trial has ended.` / `What do you want to do?` with `Upgrade to Max` and
`Add funds to continue with usage credits`; the `Upgrade to Max` option is **omitted entirely**
(not annotated) under a feature gate. Trial state is `ineligible | not_started | active | expired`
with the badge `Trial: <n> day(s) left`. `/upgrade` (`Upgrade to Max for higher rate limits and
more Opus`) opens `https://claude.ai/upgrade/max` with a campaign parameter naming which surface
sent the user, then starts a fresh login, printing `Starting new login following /upgrade. Exit
with Ctrl-C to use existing account.` A Max-20x account short-circuits with `You are already on the
highest Max subscription plan. For additional usage, run /login to switch to an API usage-billed
account.` SPEC 48 §15 records that **there is no "contact sales" string anywhere in the bundle**.

**Job.** Converting a limit into a plan change.

**Wire.** X for both, *"unreachable and trivially exceeded (X to opportunity)"* (README §5).
The trial state is rebuildable from disk: `oauthAccount.claudeCodeTrialEndsAt` in `~/.claude.json`
(R, `areas/06-08-02…:180`).

**afleet today.** `undesigned` for both, with a name collision worth noting:
`App/Views/UpgradeView.swift` exists but is about **upgrading the CLI binary**
(`Text("Claude Code needs updating")`, `CommandRow(command: "claude update")`), not the plan. No
plan or subscription concept appears anywhere in afleet.

**GUI form.** Both fold into the Account pane and the rate-limit banner rather than becoming
surfaces of their own.

- **Trial state as a badge.** The Account pane shows `Trial: <n> days left` from
  `claudeCodeTrialEndsAt`, and when expired, the two options as buttons with their labels verbatim.
  afleet reads that key from `~/.claude.json`, which it may read freely; only writing is excluded.
- **`/upgrade` is a link with a campaign.** It opens `https://claude.ai/upgrade/max` in the Browser
  panel with the campaign parameter set to the surface that sent the user, exactly as the terminal
  does — the parameter is how the product learns which surface converts, and dropping it would
  quietly break someone's analytics. The Max-20x short-circuit sentence is kept verbatim, with its
  `/login` reference rewritten to afleet's account-switch action.
- **The post-upgrade re-login is not automatic.** The terminal starts a fresh login immediately;
  afleet has channels running, so it offers `Sign in again to pick up your new plan` rather than
  starting a login under twenty live sessions.

**Drops / keeps / gains.**
*Drops:* both dialogs; the automatic post-upgrade login.
*Keeps:* the trial badge and its states, both option labels, the campaign parameter, the Max-20x
sentence.
*Gains:* `[exceeds]` the upgrade page opens in a panel tab; `[exceeds]` trial state is visible
before it expires rather than in a dialog that appears once it has.

**Open.** None.

## K. Environment and clients

### E-50 · `/ide`

**Terminal.** `/ide` (`Manage IDE integrations and show status`, argument hint `[open]`) is a
select-list dialog with three arms — launch the IDE's CLI, pick an extension to install, or pick a
running IDE to connect to (with a trailing `None`). Copy: `Select IDE`,
`Connect to an IDE for integrated development features.`, `No available IDEs detected. Make sure
your IDE has the Claude Code extension or plugin installed and is running.`,
`Found <N> other running IDE(s). However, their workspace/project directories do not match the
current cwd.`, `Note: Only one Claude Code instance can be connected to VS Code at a time.` It
writes an in-memory `dynamicMcpConfig.ide` and reads lockfiles under `~/.claude/ide/`; its
persistent knobs (`autoConnectIde`, `autoInstallIdeExtension`, `diffTool`) live in `~/.claude.json`,
not `settings.json` (SPEC 33).

**Job.** Attaching the CLI to an editor so diffs and diagnostics land there.

**Wire.** X, and classified **T** by the inventory (`areas/33-34-43-44…:48`): *"A GUI that is itself
the editor has no use for the picker."* It is also the one of the twenty-one that was actually
probed live: `/ide isn't available in this environment.`

**afleet today.** `superseded`, deliberately and with reasoning already on record. Root spec §3
retired IDE registration from v1.1: *"the IDE diff race starts from the interactive permission
dialog and never from `can_use_tool` (A-33), so it would not deliver diff-in-editor for afleet's
own child; edit-before-approve is already `allow` with `updatedInput` plus the Monaco diff."*
§17.8 keeps *"IDE registration for diagnostics"* as a deferred option.

**GUI form.** Not built. afleet **is** the editor: the Files panel is Monaco with native viewers and
the decision cards already carry diffs. Typing `/ide` gets afleet's own explanation:
`/ide connects Claude Code to a separate editor so diffs and diagnostics appear there. afleet shows
diffs in the Files panel and on the decision card itself, so there is nothing to connect.`
Authored copy. The three `~/.claude.json` knobs appear in the `Not used by afleet` disclosure
(E-06) with the same sentence.

**Drops / keeps / gains.**
*Drops:* the picker and all its copy.
*Keeps:* nothing rendered.
*Gains:* `[exceeds]` the capability the picker exists to obtain is native.

**Open.** None.

### E-51 · `/chrome`

**Terminal.** `/chrome` (`Open Claude in Chrome settings`, gated on the
`allow_claude_browser_extension` policy) draws one framed dialog titled `Claude in Chrome` in the
`chromeYellow` colour: three status rows and a five-item menu, four of whose items merely open a
URL. Copy: `Claude in Chrome works with the Chrome extension to let you control your browser
directly from Claude Code…`, `Claude in Chrome is not supported in WSL at this time.`,
`Claude in Chrome requires a claude.ai subscription.`, `No browsers are connected. Open Chrome with
the Claude extension and make sure you're signed in to the same claude.ai account.` It has **no
`settings.json` keys**; its state lives in `~/.claude.json` (SPEC 46).

**Job.** Letting the model drive a real browser through an extension.

**Wire.** X for the dialog, with one dissent worth recording: `areas/46-19-48-37…:46` says
*"Reclassify to R if the GUI drives it through `mcp_call`"* — Claude-in-Chrome is an MCP server, and
afleet implements `mcp_call`.

**afleet today.** `out-of-scope` as drawn, `undesigned` as a capability. afleet has its own Browser
panel (WebKit), which is a different mechanism entirely: afleet's browser is a viewer, Claude in
Chrome is a control channel into the user's own Chrome with their own sessions.

**GUI form.** Not rebuilt. But the card records the opportunity rather than closing it: if afleet
ever wants the model to drive a *real* browser with the user's logged-in sessions, the route is the
`chrome` MCP server through `mcp_call`, surfaced in the MCP pane (E-15) like any other server —
not a rebuilt `/chrome` dialog. The status strings are worth keeping for that day, particularly
`No browsers are connected. …` which is the only diagnostic the surface offers.

Typing `/chrome` gets: `/chrome configures the Claude Chrome extension, which lets Claude drive
your own browser. afleet's Browser tab is its own view of the web and is not that extension.`

**Drops / keeps / gains.**
*Drops:* the dialog.
*Keeps:* the connection diagnostic as future copy.
*Gains:* nothing today; a named route for later.

**Open.** Does the owner want model-driven control of the user's real browser? It is a genuine
capability afleet's Browser tab does not have, and the wire route exists.

### E-52 · `/desktop` and `/mobile`

**Terminal.** `/desktop` (aliases `app`, `Continue the current session in Claude Desktop`) is the
one command in this study with **no SPEC section at all** — its chunk is never decompiled, and its
dialog, copy and writes are unknown. What is documented is adjacent: three tips promoting it, and
an artefact `projects/<key>/<sessionId>.desktop-released.json` *"written by the desktop app, never
by the CLI"*. `/mobile` (aliases `ios`, `android`, `Show QR code to download the Claude mobile
app`) is a two-tab dialog with tabs `iOS` and `Android`, each rendering a UTF-8 QR code over its
store URL; SPEC 36 §3.3 is unambiguous that *"`/mobile` therefore has nothing to do with pairing or
with any session: it is a pure app-download helper."* It writes nothing.

**Job.** `/desktop` hands a session to another app; `/mobile` is a download link.

**Wire.** Both X. `/desktop` is classed **X/T** with the observation that *"A macOS GUI hosting the
binary *is* the desktop app case; superseded"* (`areas/28-slash-commands.md:119`). `/mobile` is
X→R: *"A GUI renders a real QR image; strictly better, but it needs the URL, which the wire does
not carry"* (line 148).

**afleet today.** `undesigned`; zero references for either.

**GUI form.**

- **`/desktop` is superseded by afleet's existence.** afleet is a native macOS app hosting the same
  binary; handing a session to another desktop app is the thing afleet already did. The explanation
  says so: `/desktop hands the session to the Claude desktop app. afleet is that kind of app —
  this session is already here.` Because the command's behaviour is undocumented in SPEC 263, the
  card marks this reading **unverified**: if `/desktop` does something afleet does not replicate
  (a handoff protocol, a released-session file), that is unknown, and the artefact name suggests a
  release-and-adopt handshake worth a probe.
- **`/mobile` is a two-line card in the Account pane** with both store links and, since afleet can
  render a real image, a QR code for each — the two URLs are hard-coded constants, not wire data,
  which is exactly why the inventory calls this X→R. `[exceeds]` over an ASCII QR.

**Drops / keeps / gains.**
*Drops:* the two-tab dialog, the ASCII QR.
*Keeps:* both store URLs and the tab names as labels.
*Gains:* `[exceeds]` a real QR image and clickable links.

**Open.** A probe on `/desktop`: does it write `<sessionId>.desktop-released.json` and, if so, does
afleet need to honour a released session? SPEC 263 does not say, and afleet's session-ownership
model (§7.4) is exactly where a stray release marker would matter.

### E-53 · `/teleport`, `/remote-control`, `/remote-env`, `/web-setup`

**Terminal.** Four surfaces for running Claude Code somewhere other than this terminal.
`/teleport` (alias `tp`, `Send this session to the cloud, or resume one from claude.ai`) is
normally a resume-only picker with columns `Updated`, `Origin`, `Session Title`, since the
send-to-cloud gate defaults off; copy includes `Continue this session in the cloud`,
`Not connected · /remote-control`, `Moving your session…` and `Session now in the cloud: <id>`,
with eight preconditions including `git_dirty` and `git_unpushed`. `/remote-control` (alias `rc`,
description a getter — `Disconnect Remote Control` when connected, else `Control this session from
your phone or claude.ai/code`) shows a one-time consent card and then a connected card with a QR of
the session URL; its non-interactive refusal is `Remote Control asks for a one-time confirmation
before it's first enabled, and this session can't show it. Run /remote-control from an interactive
Claude Code session.` `/remote-env` (`Choose the default environment for cloud agents`) is a single
select list — `Select remote environment`, `Configure environments at: https://claude.ai/code`,
`No remote environments available.`, `— Self-hosted environments —`,
`Currently using: <name> (from <source> settings)` — writing `remote.defaultEnvironmentId` into
**user** settings and clearing the local value. `/web-setup` (`Set up Claude Code on the web with
your GitHub account`) is a four-state confirm dialog that lifts the local `gh` token
(`Connect Claude on the web to GitHub?`, `Your local credentials are used to authenticate with
GitHub`, `Not signed in to Claude. Run /login first.`).

**Job.** Moving work off this machine, or driving this machine from a phone.

**Wire.** All X. One is more interesting than the rest: for `/remote-control`, the mechanism *is*
reachable — a `remote_control` control request exists — but *"the handler does not consult
`remoteDialogSeen` — it calls `initReplBridge` directly. afleet should therefore show its **own**
consent card; the CLI will not ask"* (`areas/50-36-39-38…:154`). For `/teleport`, the three
cloud-session refusal sentences **do** arrive headless wrapped in `<local-command-stdout>`, so
afleet will see them if a user ever attaches to a cloud session.

**afleet today.** `out-of-scope`, cited: root spec §3 excludes *"cloud and Remote Control
sessions"* and §17.8 restates Remote Control as **"Explicitly out of scope"**. Zero code hits for
any of the four.

**GUI form.** None built. Four router explanations replacing the generic sentence, each saying what
afleet does instead:

- `/teleport` — `/teleport moves a session to Claude's cloud or pulls one back. afleet runs
  sessions on this machine; cloud sessions are outside what it hosts.`
- `/remote-control` — `/remote-control lets you drive this session from your phone or claude.ai.
  afleet does not connect channels to Remote Control.` **With the security note that matters**: if
  afleet ever did send `remote_control`, it must show its own consent card first, because the CLI
  will not — that is a one-line finding worth carrying forward even though the feature is out of
  scope.
- `/remote-env` — `/remote-env picks the default environment for cloud agents, which afleet does
  not start.`
- `/web-setup` — `/web-setup connects Claude on the web to your GitHub account using this machine's
  gh token. afleet does not set up the web product.`

And one thing afleet **should** handle even while the family is out of scope: if a user attaches
afleet to a session that is already running in the cloud, the engine emits the three cloud-session
sentences, and those arrive headless. Rendering them verbatim is the difference between an
explained refusal and a mystery.

**Drops / keeps / gains.**
*Drops:* all four surfaces.
*Keeps:* the three cloud-session refusal sentences, rendered verbatim when they arrive.
*Gains:* nothing.

**Open.** None. Scope is settled by root spec §3.

### E-54 · `/design-login`

**Terminal.** `/design-login` (`Authorize design-system access for /design-sync with your claude.ai
account`) is a six-state screen headed `Design login` whose explanation is precise about what it
does and does not touch: `Authorize design-system access (read and write your organization's
claude.ai/design projects) with your claude.ai account. This is separate from this session's
authentication and changes nothing else.` The manual paste form is `<code>#<state>` and appears
immediately in a remote session, with the prompt `Paste code here if prompted > `, success
`Design-system access authorized. /design-sync can now reach your claude.ai/design projects.` and
failure `Invalid code. Please make sure the full code was copied`. It writes a **separate
`designOauth` slot in the same secure store** as the main credential, with scopes
`user:design:read` and `user:design:write` (SPEC 44 §44.34.7).

**Job.** A second, narrower authorization for the design-sync feature.

**Wire.** X, and the CLI states the workaround itself, quoted in
`areas/33-34-43-44…:224`: *"Ask the user to run /design-login once from an interactive Claude Code
session on this machine — headless and SDK runs here then reuse that authorization."*

**afleet today.** `undesigned`; zero hits. Note that `/logout` (E-44) revokes the `designOauth`
refresh token too, so afleet's logout already touches this credential without ever having created
it.

**GUI form.** Not rebuilt as a flow. The Account pane shows a `Design system access` row with the
authorization's presence or absence, and the router explanation is the CLI's own advice made
concrete: `/design-login authorizes design-system access for /design-sync, and it is a one-time
authorization stored on this machine. Run it once in a terminal here and afleet's channels will
reuse it.` That is faithful — the CLI says exactly this — and it does not tell the user afleet is
inadequate, since the authorization genuinely is machine-scoped and shared.

If afleet later wants the flow, it is cheap: the manual-paste branch exists precisely because
remote sessions cannot reach the loopback listener, and afleet's Browser panel makes the paste
unnecessary — the same advantage as E-16.

**Drops / keeps / gains.**
*Drops:* the six-state screen.
*Keeps:* the explanation sentence as help text, the credential's presence as a readback.
*Gains:* nothing today.

**Open.** None.

### E-55 · `/install-github-app`

**Terminal.** `/install-github-app` (`Set up Claude GitHub Actions for a repository`) is a
**thirteen-screen state machine** — `check-gh`, `warnings`, `choose-repo`, `install-app`,
`setup-actions-prompt`, `check-existing-workflow`, `select-workflows`, `secret-probe`, `api-key`,
`oauth-flow`, `check-existing-secret`, `creating`, `success` — driving `gh` against the GitHub API.
It never mutates the local git tree: it creates a branch
`add-claude-github-actions-<timestamp>`, PUTs `.github/workflows/claude.yml` and/or
`claude-code-review.yml`, sets at most one secret (`ANTHROPIC_API_KEY` or
`CLAUDE_CODE_OAUTH_TOKEN`), and **never creates the pull request** — it opens a pre-filled compare
page. Copy includes `Checking GitHub CLI installation…`, `⚠ Setup Warnings`,
`We found some potential issues, but you can continue anyway` and the GitLab refusal
`The Claude GitHub App only works with GitHub repositories, and this repository's git remote is on
GitLab…` (SPEC 47 §47.9).

**Job.** Turning a repository into one where Claude reviews pull requests.

**Wire.** X — *"the whole 13-screen flow is unreachable"* (`areas/22-47-40…:187`).

**afleet today.** `undesigned`; zero hits. But afleet has a **GitHub panel tab** (root spec §8.1),
which is the natural home and the reason this card does not simply say `superseded`.

**GUI form.** Not a modal wizard; a section in the GitHub panel. afleet already has the panel, the
Browser tab for the OAuth and compare-page steps, and a Terminal tab that can run `gh`. The flow's
thirteen screens collapse into one pane with a checklist: GitHub CLI present, repository chosen,
app installed, workflows selected, secret set — each row showing its state and its action. The
`⚠ Setup Warnings` step keeps its heading and its `We found some potential issues, but you can
continue anyway` line verbatim, since a warnings step the user can proceed past is exactly right.
The GitLab refusal is kept verbatim. The never-create-the-PR behaviour is kept: afleet opens the
compare page in the Browser tab, which is better than the terminal opening the user's system
browser.

This is the only command in section K that this lane recommends building, and it is recommended
because afleet has all the pieces and a panel with nothing in it yet — not because the terminal
surface deserves porting.

**Drops / keeps / gains.**
*Drops:* the thirteen-screen sequence.
*Keeps:* the warnings step and its copy, the GitLab refusal, the workflow file set, the
one-secret rule, the never-create-the-PR behaviour.
*Gains:* `[exceeds]` a checklist showing the whole flow's state at once instead of thirteen screens
in sequence; `[exceeds]` the compare page opens in-app.

**Open.** Is the GitHub panel's scope settled enough to take this? It is lane-adjacent — the panel
belongs to C7 — and this card only claims the setup flow.

### E-56 · `/daemon`

**Terminal.** `/daemon` (`Manage background services and routines`) **ships and is unreachable**:
its gate is a literal `return !1` (verified `cli.pretty.js:164786-164788`), so it is registered in
neither the TUI nor the headless command list, and its chunk is in the lazy dialog registry all the
same. Had it been reachable it would draw a live hub with a `Scheduled` section (columns `Name`,
`Schedule`, `Next run`, `Last run`, `PID`) and a `Remote Control` section (columns `Name`,
`Directory`, `Status`, `PID`) ticking every second, writing `~/.claude/daemon.json`. The same hub
is reachable by another door — `claude daemon hub` — which refuses without a TTY:
`Interactive hub requires a TTY. See \`claude daemon --help\`.`

**Job.** Seeing and managing the background services running on this machine.

**Wire.** *"Nothing to port"* for the command (`areas/50-36-39-38…:383`); the hub blueprint is X→R
(line 384).

**afleet today.** `built`, in substance and by a different route. afleet reads
`<configHome>/daemon/roster.json` (`Fleet/HolderReader.swift`, `FleetObserver.swift`) and renders
background jobs in the sidebar's **Background** section with `Adopt`, `Attach` and `Stop`
(root spec §8.2) — which is the `Scheduled` half of the unreachable hub, live, in the main window.
Root spec §17.8 defers *"a direct daemon socket client"*.

**GUI form.** Nothing new is built for the command. The card exists to record that **afleet already
shipped the surface the terminal gated off**, and to name the two columns the sidebar lacks that the
hub blueprint has: `Next run` / `Schedule` for a scheduled job, and `PID`. Adding them to the
Background section's row detail is cheap and makes the sidebar a genuine daemon hub. `[exceeds]`,
and the comparison is a fair one only because the terminal's version does not run.

Typing `/daemon` opens the sidebar's Background section rather than refusing.

**Drops / keeps / gains.**
*Drops:* the hub as a screen, the one-second tick, `claude daemon hub`'s TTY refusal.
*Keeps:* the two section names and their column vocabulary.
*Gains:* `[exceeds]` the surface exists at all, and is in the main window rather than behind a
disabled gate.

**Open.** Should the Background rows show `PID` and schedule? It is a small addition and the
blueprint suggests it; a build-time call.

## Ranking input

Value is to a user of afleet as it exists; cost is the build in afleet, S ≤ a day, M ≤ a week,
L larger. "afleet" in *depends-on* names a seam that must exist first.

| Card | Surface | afleet status | User value | Build cost | Depends on |
|---|---|---|---|---|---|
| E-01 | Where Claude Code settings live | undesigned | high — nothing exists | M — the section shell + scope control | C5 §9 Settings window |
| E-02 | `/config` dialog shell → Defaults pane | undesigned | high — the container for 28 rows | M — pane, search, lock rendering | E-01 |
| E-03 | The 28 preference rows | undesigned | high — auto-continue, timeouts, memory | M — 28 controls, 2 write classes | E-01, E-02 |
| E-04 | The five dual rows | partly built | high — separates channel from default | S — a checkbox and a write | E-03, header pickers |
| E-05 | The 20 superseded rows | superseded | med — a ledger, plus spawn normalisation | S — a disclosure list | E-02 |
| E-06 | The 7 out-of-scope rows | out-of-scope | low | S | E-02 |
| E-07 | `/config` sub-dialogs | undesigned | low–med — auto-update channel matters | S | E-03 |
| E-08 | `/permissions` shell, six tabs | routed, unbuilt | **high — largest gap in the lane** | L | E-01, a rules model |
| E-09 | Rule rows, provenance, shadowing | undesigned | **high — answers "why didn't my rule work"** | M | E-08, `get_settings.sources[]` |
| E-10 | Add a rule + destination picker | designed (one line) | high | M | E-09, a project-scope file writer |
| E-11 | Delete a rule, read-only sources | undesigned | med — one-way door on user scope | M | E-10 |
| E-12 | Recently denied / Auto mode | undesigned | med — denials belong in Activity | S–M | Activity view (lane D/G) |
| E-13 | Workspace directories (read) | undesigned | med | S | E-35 for the editing half |
| E-14 | MCP server list | built, 2 fields | **high — cheap, visible** | S–M | richer `MCPServerStatus` decode |
| E-15 | MCP server detail + actions | undesigned | **high — 7 dead control requests** | M | E-14 |
| E-16 | MCP auth / OAuth / needs-auth | undesigned | **high — a broken server is a dead tool** | M | E-15, Browser panel |
| E-17 | View tools, prompts, resources | undesigned | med | S | E-15 |
| E-18 | Project `.mcp.json` approval | built, ahead of canon | high — already good | S — three small gaps | — |
| E-19 | `/hooks` viewer | undesigned | med — audit, not everyday | M | E-01, disk read |
| E-20 | Hooks disabled / safe mode / reload trap | undesigned | med–high — silent inertness | S | E-19, channel banner |
| E-21 | `/plugin` shell | undesigned, unassigned | med | M | E-01 |
| E-22 | Discover + install | undesigned | med | L — CLI subprocess, PTY handling | E-21 |
| E-23 | Installed: enable/disable, scopes | undesigned | med–high — context cost | M | E-21, file writer |
| E-24 | Marketplaces | undesigned | med | M | E-21 |
| E-25 | Errors | **not even decoded** | **high — cheapest high-value item** | S — decode `plugin_errors` + rows | Activity view |
| E-26 | `/reload-plugins` | built, mis-described | med — plus a copy bug | S | — |
| E-27 | `/cloud-plugins` | out-of-scope | low | S — one sentence | — |
| E-28 | `/model` picker | built, stripped | high — descriptions, default, search | S–M — one decode field + layout | `ModelOption` decode |
| E-29 | `/effort` picker | built, stripped | high — descriptions, `max` reason | S | E-28 |
| E-30 | `/fast` | **routed to nothing** | med–high — a broken command | S — a toggle | picker surface registry |
| E-31 | `/autocompact` | undesigned | med | S — drag the meter's tick | context meter (lane A) |
| E-32 | `/advisor` | undesigned | low–med | S, after a probe | probe |
| E-33 | `/powerup`, `/passes` | undesigned | low | S — two sentences | — |
| E-34 | `/sandbox` | undesigned | med–high — violations are invisible | M | `claude sandbox status` |
| E-35 | `/add-dir` | typed-command only | high — no affordance today | S–M | `HeaderLaunchSetting` cases |
| E-36 | `/cd` | designed, no surface | med–high | M | trust dialog, `NSOpenPanel` |
| E-37 | `/skills` + overrides | undesigned | high — capability + context budget | M | file writer, `reload_skills` |
| E-38 | `/reload-skills`, `/skill-doctor` | reload built | med | S — columns in E-37 | E-37 |
| E-39 | `/memory` | **count only** | **high — a promised panel that isn't there** | M | Files panel |
| E-40 | `/theme` | superseded | med — accessibility obligation | M — afleet's own appearance | design system |
| E-41 | `/output-style` | FleetKit built, no UI | **high — one control request, no control** | S | header picker row |
| E-42 | `/agents` definitions | **routed to nothing** | high — colour + capability audit | M | frontmatter parser |
| E-43 | `/login` | built | med — finish the fallback + account readback | S | — |
| E-44 | `/logout` | built, exceeds canon | med — surface it in Settings | S | — |
| E-45 | `/setup-bedrock`, `/setup-vertex` | undesigned | low | S — one sentence each | — |
| E-46 | `/privacy-settings` | undesigned | **high — an unexplained exit today** | S — surface stderr | channel banner |
| E-47 | `/usage-credits`, `/extra-usage` | dead button | med — fix the inert action | S | — |
| E-48 | `/rate-limit-options` + auto-continue | **designed, banner unread** | **high — fleet-defining** | S (banner) + M (auto-continue) | `overlay.banners` wiring |
| E-49 | `/pro-trial-expired`, `/upgrade` | undesigned | low–med | S | Account pane |
| E-50 | `/ide` | superseded | low | S — one sentence | — |
| E-51 | `/chrome` | out-of-scope | low | S | — |
| E-52 | `/desktop`, `/mobile` | undesigned | low | S | probe for `/desktop` |
| E-53 | `/teleport`, `/remote-control`, `/remote-env`, `/web-setup` | out-of-scope | low | S — four sentences | — |
| E-54 | `/design-login` | undesigned | low | S | — |
| E-55 | `/install-github-app` | undesigned | med | M | GitHub panel (C7) |
| E-56 | `/daemon` | built by another route | low | S — two columns | — |

**If only ten things are built from this lane**, they are E-25, E-41, E-30, E-48, E-39, E-14, E-46,
E-42, E-15 and E-35 — six of which are wiring or decoding jobs against work that already exists.

## For the map

- **One widget recurs across nine cards: a settings row with a write-class badge and a provenance
  line.** `/config`, `/permissions`, `/hooks`, `/skills`, `/plugin` and the memory toggles all need
  the same thing — effective value, which source won, whether this app can change it, and what to
  do when it cannot. Build it once. It is the lane's single most reusable component and the
  difference between a settings window and a wall of switches that may or may not work.
- **The write ceiling should be modelled, not remembered.** Five classes (control request,
  `update_settings`, `/config` text, CLI subprocess, open-file) with one enum and one badge, decided
  per key from a table, so no future surface has to rediscover that `update_settings` writes exactly
  one key. Three separate rows in afleet's own parity inventory already got this wrong (see *Spec
  defects*), which is the evidence that memory is not enough.
- **A region is overloaded and a region is empty.** The channel header is acquiring model, mode,
  effort, output style, fast, sandbox state and a context meter; the Settings window has five
  sections about afleet and none about the engine it hosts. The split this lane proposes — live
  per-channel values in the header, persisted preferences in Settings, launch settings in an
  Overrides sheet — is the only one that keeps the header readable, and it is decided by the
  *lifetime* of the value, not its subject.
- **`overlay.banners` is computed and unread, and that one unwired seam costs three surfaces.**
  Rate limits (E-48), auth failures (E-43) and hook-disabled state (E-20) all want the channel
  banner region. `Banner.Kind` already has `rateLimit` and `auth` cases; `ChannelBanner`, the type
  `App/` actually renders, has neither. Reconciling the two types is a prerequisite for the lane's
  highest-value items.
- **The terminal never steals the composer, and afleet must not steal the channel.** Every panel in
  this family is modal in the terminal because it has one screen; every one becomes a pane or a
  sheet in afleet. The corollary is stricter than it looks: a settings *write* must not put a
  turn-shaped exchange into a conversation the user is having. That is why E-01 proposes a hidden
  settings channel for class-3 writes, and it is the one architectural question in the lane the
  owner must answer.
- **Four commands are wired to a surface that does not exist, and they all fail the same way.**
  `.native(...)` resolves through `SettingPickersModel.pickerSurfaces`, which contains two entries,
  so `/fast`, `/agents`, `/tasks` and anything else added to `.native` silently does nothing. The
  pattern needs a registry with a fallback that at least reports, or the next command added will
  fail the same way.
- **Provenance is the GUI's structural advantage over the terminal, everywhere in this lane.** The
  terminal shows one merged value and, occasionally, a lock reason; `get_settings.sources[]` carries
  the whole stack. Rule shadowing, ineffective plugin writes, skill override baselines and settings
  precedence are all the same computation, and all four are described in the parity inventory as
  high-value. One merge-and-explain utility serves them all.
- **Roughly forty commands land on two generic refusal sentences, and the copy is a product
  surface.** Writing one line per command — what it does, what afleet does instead — is a bounded
  piece of work (about forty short paragraphs, most of them already drafted in these cards) and it
  is what decides whether afleet reads as its own product or as a subset of the terminal. Root spec
  §7.7 already forbids telling the user to go back to the terminal; a few commands (E-27, E-45,
  E-53, E-54) are about products afleet deliberately does not host, and whether naming the terminal
  is allowed there is an open wording question.
- **Three surfaces afleet already has beat the terminal outright, and none of them is presented as
  such.** `/logout`'s census (E-44), the project MCP consent sheet's configuration-hash re-consent
  (E-18) and the Background section standing in for the gated-off daemon hub (E-56). When the map
  ranks work, these are worth protecting, not extending.

## Spec defects

**In SPEC 263.**

1. **SPEC 31 §18.2 does not document the `/mcp` server list's row rendering.** The thirteen status
   branches, their glyphs and tones were recovered from `cli.pretty.js:483960-484065`. The list's
   status set differs from the detail view's documented set by two branches
   (`connected · <n> tool(s)` and `reconnecting (<n>/<m>)…`), which a reader of §18.3 alone would
   not know.
2. **SPEC 31 §18 documents nothing about the `View tools` sub-view** or the tool-detail level
   beneath it. The only description of that view stack found anywhere is the somersault clone's
   (`CC-to-SDK/docs/parity/tui-ux.md:1072-1074`).
3. **SPEC 24 §24.19 omits five behaviours of the permissions dialog** that a rebuild depends on: the
   `Rule details` panel title, the `From <source>` provenance line, the `Delete <label> tool?`
   confirmation copy, the `/`-and-any-printable-key filter gesture, and the fact that the Workspace
   tab's add is **always session-scoped**. All five verified in `cli.pretty.js`.
4. **SPEC 24 §24.12.3 says `/add-dir` applies `destination: "session"`.** The interactive dialog
   writes `destination: <persist> ? "localSettings" : "session"` (`cli.pretty.js:13006`). The SPEC
   statement describes the headless arm only and reads as general.
5. **SPEC 41.26.2's `Gn` caption map has no arm for `callback` or `function` hook types**, which
   would render an empty caption — unreachable in practice, but undocumented as such. (SPEC 27
   §21.3's map, same finding.)
6. **SPEC 06 does not record the `/model` picker's chrome at all** — no `Select model` header, no
   subtitle, no overflow counter, in any of the 51 chapters. Likewise SPEC 41.10.5 covers the
   `/theme` command object but not the picker, and SPEC 06 records no `/effort` header (none exists
   in the binary either). All recovered here from `cli.pretty.js`.
7. **`/desktop` has no SPEC section.** Its chunk (`chunk-ahmkq2k0.js`) is never decompiled in any
   chapter, and SPEC 41 — the chapter its catalogue row points to — does not list it as an open
   question. Its dialog, copy and writes are unknown, which is why E-52's reading is marked
   unverified.
8. **SPEC 27 Open Question 7 is unresolved and load-bearing for a rebuild**:
   `matcherMetadata.fieldToMatch` and `values` are declared for 22 events but read nowhere; the UI
   tests only the *presence* of `matcherMetadata`.

**In afleet's `docs/tui-parity/`.**

9. **`areas/41-tui-rendering.md:592` claims the live headless `/config` accepts 38 keys and then
   enumerates 37.** The enumeration is what a build must code against. Same row: its "60-row
   registry" list contains **59 names** — `unattendedServing` is missing, though SPEC 41.26.2's
   table has it. Both are small and both would silently mis-size a settings pane.
10. **Four rows assert that `update_settings` can write keys other than `outputStyle`**, which
    README finding 7 and a live probe both refute (`update_settings keys not allowed: permissions`,
    `evidence/2026-09-03-control-request-shapes.md:32`):
    `areas/24-21-permissions-plan-questions.md` (permission rules, several rows),
    `areas/31-27-mcp-hooks.md:30` (`enabledMcpjsonServers`), `areas/41-tui-rendering.md:81`
    (`theme`), `areas/13-10-23-context-memory-session-tools.md:119,121` (`autoMemoryEnabled`,
    `claudeMdExcludes`). The permissions and MCP rows carry errata blocks for *other* claims but not
    for this one. **README finding 7 is authoritative**; a design that follows the area files will
    ship writes that fail.
11. **`areas/28-slash-commands.md:135` still says fast mode is unavailable** and advises hiding the
    control; README finding 13 and the errata at `areas/41-tui-rendering.md:5` say it is opt-in and
    works after `apply_flag_settings {fastMode: true}`. A reader of the area file alone ships no
    `/fast` control at all.
12. **Three area files still grade `/add-dir` as R or P** (`areas/28-slash-commands.md:94`,
    `areas/24-21-…:94`, `areas/03-49-35-…:66`) against README finding 6's X. Each is superseded by
    its own errata header, but the row text was never corrected.
13. **"The eight `mcp_*` control requests" names three different sets** — README's eight (including
    `set_mcp_permission_mode_override`, excluding `mcp_call`), the area file's ten, and afleet's
    implemented eight (including `mcp_call`, excluding the override). Any card or plan citing "the
    eight" should name them.
14. **`areas/31-27-mcp-hooks.md:26` says "five config scopes" and lists four** — `managed` is
    missing; SPEC 31 §3.1 has five.
15. **Class disagreement on the MCP auth-stub tools**: README §5 marks their suppression **R**, the
    area file marks the same item **X** (lines 161, 384).
16. **The parity corpus is written against 2.1.257/2.1.259, not 2.1.263.** Two deltas already
    visible in this lane: `/rate-limit-options` lost its `Upgrade to Team plan` entry and its URL,
    and the `allow_desktop_handoff` policy key was removed.

**In the afleet specs.**

17. **Root spec §7.7's router table has no row for `/hooks`, `/plugin`, `/reload-plugins`,
    `/cloud-plugins`, `/skills`, `/reload-skills`, `/skill-doctor`, `/theme`, `/output-style`,
    `/sandbox`, `/advisor`, `/autocompact`, `/passes`, `/powerup` or any of the nineteen auth and
    environment commands other than `/login` and `/logout`** — verified by whole-file grep. They are
    not listed as known gaps in §13 either, nor deferred in §17.8. They fall to the generic
    pass-through fallback by omission rather than by decision.
18. **§7.7 describes one engine refusal string; there are three.** afleet's
    `RouterTable.bareRefusalPattern` and `interactivePanelRefusalPattern` match two of them
    (`cli.pretty.js:540254`, `:540305`). The third, gate-1 form
    `/<name> isn't available in this session.` (`:540312`) matches neither and would reach the
    channel unintercepted.
19. **`RouterTable.terminalOnlyReasons`'s `/reload-plugins` entry contradicts afleet's own shipped
    feature** — it says afleet picks up plugin changes at the next restart, while
    `ChannelHeaderActionsModel.reloadPlugins()` sends a live `reload_plugins`.
20. **Root spec §7.8's X9 and `areas/30-29-32-plugins-skills-styles.md:190` conflict** over
    `/cloud-plugins`: the parity file proposes writing
    `<configHome>/state/cloud-plugins-consent.json`, which X9 forbids. Resolved here in favour of
    X9 (E-27), since §17.8 also puts cloud sessions out of scope, but the conflict is unrecorded in
    both documents.
21. **Process defect, not a spec one:** the first run of this study wrote a copy of the whole
    `tui-to-gui/surfaces/` directory into the afleet repository at
    `/Users/new/developer/github/afleet/docs/tui-to-gui/`, which SHARED-BRIEF §0 forbids ("never
    write under it"). It is untracked (`?? docs/tui-to-gui/` in `git status`) and is a stale copy of
    the 321-line fragment. Nothing in this run wrote there; the orchestrator should delete it.
