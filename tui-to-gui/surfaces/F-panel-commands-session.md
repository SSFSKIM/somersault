# Lane F — the session and information panel commands

**Lane.** F. The terminal surfaces that *show session state* or *act on the session as a whole*:
the shared Settings dialog's Status, Usage and Stats tabs, the context grid, compaction, the
Background dialog, the Help dialog, the resume picker, the rewind message selector and its restore
choices, diff and export, the session-lifecycle commands, the scheduling surfaces, the diagnostics
and feedback commands, and the pass-through prompt commands.

**Date.** 2026-09-10. **Canon.** Claude Code 2.1.263. **Cards.** F-01 … F-45 (45).

## What I read

**SPEC 263** (`/Users/new/claude-code-bundle/2.1.263/SPEC/`):
`41-tui-rendering.md` §41.22.1–41.22.4 (the 74-entry lazy dialog registry, mount flags and the
`hidesPrompt` rule, failure strings), §41.26 (the `/config` shell, for the Settings-dialog
boundary with lane E);
`28-slash-commands.md` §5 and §5.0a (the whole built-in catalogue — the source for every command
row quoted here), §9.3–9.5 (prompt expansion, fork dispatch, coordinator refusals), §10
(the six transcript wrapper tags and their two echo shapes), §11 (stacked commands);
`35-session-persistence.md` §35.19.1–35.19.10 (`/resume`: data flow, grouping, the three filters,
search, constants, pagination, row rendering, every verbatim string, keybindings, telemetry),
§35.20 (`/rename`), §35.21 (`/export`), §35.22 (`/branch`, `/fork`), §35.26.3 (`/clear` and the
history file);
`13-context-management.md` §13.18.1–13.18.4 (`/compact`, `/context` including the grid geometry and
the Suggestions producers, `/autocompact`), §13.19.1–13.19.4 (the context indicator, the
context-limit banner, the compaction boundary, the spinner states);
`20-tasks-and-background-work.md` §20.14.1–20.14.4 (the `/tasks` dialog, its ten sections, its keys
and their two guide mismatches, the Remote Control variant's two-phase stop), §20.15.1;
`15-file-tools.md` §15.12.7–15.12.8 (rewind restore, the safety-refusal strings, the entry points
and the option list), §15.13.1–15.13.3 (`/diff`: the two renderings, their strings, the git
plumbing);
`42-input-and-keybindings.md` §42.21.3 (double-Escape, the `MessageSelector` context, the
consequence blurbs);
`49-updates-and-diagnostics.md` §49.19 (`/doctor`), §49.20 (`/debug`), §49.21.1–49.21.3
(`/status` and the Status tab), §49.22.1–49.22.12 (`/bug`, `/feedback`, the disabled reasons, the
notice card and the draft panel), §49.28.1–49.28.4 (`/upgrade`, `/wellbeing`, `/version`,
`/release-notes`);
`22-scheduling-loops-and-goals.md` §22.20 (`/loops`), §22.21 (`/goal`);
`40-workflows.md` §40.17.4–40.17.5 (`/workflows`, the agent-detail Outcome pane, the save dialog);
`08-auth-and-credentials.md` §13.1–13.1.1 (the usage endpoint and its four-state degraded seeding);
`05-feature-gates-and-telemetry.md` §13.2 (`stats-cache.json`);
`30-plugins-and-marketplaces.md` §27.9 (checked, and *not* the Settings dialog's Stats tab).

**afleet** (`/Users/new/developer/github/afleet`, read-only): the root design spec §3, §7.5, §7.7,
§8.2, §8.4, §8.5, §13, §17.8; the C5 app-shell spec §4–5 and §9; C6.2 "Edit, rewind and Fork from
here"; C6.3 "The Thread tab";
`FleetKit/Sources/FleetSessions/Router/RouterTable.swift` (read in full — the 27 local rows, both
refusal patterns, `terminalOnlyReasons`, the drift ladder) and `CommandRouter.swift`;
`App/Composer/EditAndRewind.swift`, `CommandRouting.swift`, `ComposerShortcuts.swift`;
`App/Timeline/Header/ChannelHeaderReadout.swift`, `ReadbackPoller.swift`, `HeaderReadoutView.swift`;
`App/Timeline/Rendering/Rows/MessageRows.swift`, `TimelineRowBuilders.swift`;
`App/Header/HeaderMenus.swift`, `SettingPickers.swift`; `App/Decisions/TaskCardView.swift`;
`App/Views/SidebarView.swift`, `QuickSwitcherView.swift`, `SettingsView.swift`;
`App/Switcher/QuickSwitcherModel.swift`; `App/Fleet/ProjectGrouping.swift`,
`FleetBrowserModel.swift`; `ClaudeWire/Sources/WireFrames/OutboundRequests.swift`;
`Workbench/Sources/PanelHostAPI/PanelTabID.swift`;
`FleetKit/Sources/FleetTimeline/Reduce/WireReducer.swift`, `RecordReducer.swift`;
`docs/tech-debt-tracker.md` items 206 and 207;
`docs/tui-parity/README.md` (§2.1 legend, findings 1, 8, 9, 10, 17, 20, §5, §7 in full) and
`areas/28-slash-commands.md`, `areas/20-tasks-background.md`,
`areas/03-49-35-settings-diagnostics-sessions.md`,
`areas/13-10-23-context-memory-session-tools.md`, `areas/15-16-17-file-bash-sandbox.md`,
`areas/22-47-40-goals-git-workflows.md`, `areas/42-input-keybindings.md`,
`areas/41-tui-rendering.md`; `evidence/2026-09-03-slash-commands-headless.md`.

**somersault clone**: `CC-to-SDK/docs/parity/tui-ux.md` §4 rows *Resume session picker*,
*`/resume` preview body*, *Task/todo panel*, *Transcript pager*, *History search*, *`/help` dialog*,
*Background-dialog detail sub-dialogs*, *Rewind picker anatomy*, *SettingsDialog*; §5 rows for
`/cost`, `/status`, `/export`, `/diff`, `/stats`, `/session`, `/rewind`, `/usage`, and the combined
`/clear /compact /context /resume /continue /help` row; §8 background rows; the F6
"Unreachable — recorded, not built" block; and
`CC-to-SDK/docs/superpowers/specs/2026-08-07-wave-s-session-truth-design.md` (the session-truth
wave, its five verified canon quirks and its two open defects).

## Verification spent (`cli.pretty.js` at 2.1.263)

Nine greps, spent where SPEC 263 is silent or where a claim is load-bearing.

1. `grep -n 'No code restore'` → **498276**. The message-selector row renderer, confirming the
   per-row dry-run anatomy verbatim: `<basename> ` + a `+A −R` stat for one file,
   `<N> files changed ` otherwise, `No code changes` when the dry run is clean, `⚠ No code restore`
   when there is no checkpoint — and the special first row `/resume <id> (previous session)`.
   (F-28, F-27.)
2. `grep -n 'Show help and available commands'` → **787261**, then reading **219360–219500**.
   **SPEC 263 has no `/help` section**, so all of F-13 is from the binary: the three tabs
   `General` / `Commands` / `Custom commands` (`:219456`, `:219464`, `:219470`), the shell
   `qp({ title: "Help", color: "professionalBlue", defaultTab: "general" })` (`:219479`), the
   General body and its `var lo = 44` row threshold (`:219385`), the browser titles
   `Browse default commands` / `Browse custom commands`, the empty message
   `No custom commands found`, the builtin-vs-custom predicate (`:219411`), and the three footers
   (`:219484`, `:219489`, `:219494`).
3. `grep -n 'defaultTab: "Status"'` → **416266**. `/status` is three lines opening the shared
   four-tab `Settings` dialog. (F-01.)
4. `grep -n 'id: "usage"\|id: "stats"'` → **394993** and **394998**, and the shell at
   **394947–395015**: the four tab children (`Status` :394983, `Config` :394988, `Usage` :394993, `Stats` :394998), `Settings dialog dismissed` (`:394969`), and the
   `$s !== "Stats"` quirk that suppresses the shell's `confirm:no` binding on one tab. (F-01, F-03.)
5. `grep -n 'defaultTab: o === "stats"'` → **840964**:
   `defaultTab: o === "stats" ? "Stats" : "Usage"` — the proof that **`/cost` and `/stats` are
   aliases of `/usage`**, not separate surfaces. SPEC records this only in the §5 catalogue row.
   (F-02, F-03.)
6. Reading **393158–393500**: the `so(...)` limit-bar renderer (`<n>% used`, `Resets <when>`, the
   50-column fill, the `maxWidth >= 62` guard) and the Usage tab's bar list — `Current session`,
   `Current week (all models)`, `Current week (Sonnet only)`, the per-model `limits` rows,
   `Claude Code and Cowork credit` with its `One-time credit · Expires <date>` subtext. (F-02.)
7. `grep -n 'Total cost'` → **699873**: the session-cost block's five labels, the `Usage by model:`
   rows and the prompt-cache sentence. Reading **392822–393160** gave the third block —
   `What's contributing to your limits usage?`, `Skills, subagents, plugins, and MCP servers`,
   `% of usage`, the `Skills` / `Subagents` / `Plugins` / `MCP servers` / `Loops` sections and the
   empty state `No attribution data yet · accumulates as you use Claude`. (F-02.)
8. Reading **393600–394950**: the Stats tab — `Overview`, the three periods, the nine labels,
   `Tokens per Day`, `Models`, the book-comparison list, `Stats dialog dismissed`,
   `No stats available yet. Start using Claude Code!`. (F-03.)
9. Reading **629037–629383**: the `/context` panel — `Context Usage`,
   `Estimated usage by category`, `Available`, `Auto-compact window: `, `Suggestions`, the three
   remote-failure strings, and `/context all to expand` at **629317**. (F-04, F-05.)

## Denominator covered

Every surface the lane brief names. Resolutions that differ from the brief's assumptions, and the
additions:

- **`/cost` and `/stats` are not separate surfaces** — both are aliases of `/usage` and open the
  same Settings dialog on the `Usage` and `Stats` tabs (verification 5). Carded as F-02 and F-03
  rather than as three cost commands.
- **`/tag` is not a command in 2.1.263.** `tag` is a read-only session field, used in the `/resume`
  row description and as one of four search targets, with no writer in the catalogue. The clone's
  `/tag` is a clone invention. Carded inside F-26.
- **`/doctor` is a bundled prompt command, not a panel**, and afleet refuses it on evidence its own
  repository contradicts — carded as a live defect (F-37). `/review`, `/commit` and
  `/security-review` are likewise skills or absent from the catalogue rather than table commands
  (F-15).
- **`/loops`, `/wellbeing` and `/version` are compiled in and switched off** (`isEnabled: () => !1`).
  Carded anyway, with status per §3 (F-34, F-43).
- **Additions beyond the brief** (six): `/debug` (F-38, a sibling of `/doctor`); `/autocompact`
  (F-07, the setting behind the context meter); `/recap` (F-26); the `/feedback` **draft panel,
  notice card and footer counter** (F-40, a surface distinct from the `/bug` dialog); the
  Remote-Control variant of the Background dialog (F-11, kept for its two-phase stop rule); and
  **stacked commands** (F-16), which the brief mentions only in passing but which is a distinct
  user-visible surface with three strings of its own.

## Headline

1. **The context meter is the model for this whole lane, and afleet already has it.** A small
   persistent readback in the channel header that opens into the full surface on click covers
   `/context`, `/cost`, `/status`, `/goal` and the session's identity rows. Build that pattern once
   (chip → popover → poppable panel tab) and five cards land on it. The terminal has the same
   instinct in its status bar and cannot follow the click anywhere; this is the cleanest place the
   GUI exceeds it.
2. **The rewind family is the biggest functional loss in the built app, and it is one seam away
   from being the biggest win.** afleet has a restore chooser with no way to name a target
   (`/rewind` returns `.notARequest` without an argument, `CommandRouter.swift:327`) and a target
   picker — the `Edit` button — that only ever rewinds the conversation
   (`EditAndRewind.swift:9`: "**This is not `/rewind`**"). Canon offers six choices with a dry-run
   diffstat per candidate message. Join the two and the app gains real undo. **But first check one
   thing:** file checkpointing is off headless unless `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`
   is in the engine's environment (tui-parity README finding 8) — if afleet does not set it, every
   code-restore option is dead on arrival.
3. **`§7.7` promises three native destinations that do not exist.** `/tasks`, `/agents` and
   `/resume` route to `.native("tasks" | "agents" | "switcher")` and
   `App/Header/SettingPickers.swift:492` accepts only `modelPicker` and `effortPicker`. afleet's own
   tech-debt item 207 says so. One surface registry unblocks the Background panel (F-09), the resume
   picker's filters and preview (F-18, F-20) and lane G at once — and until it exists, typing
   `/tasks` or `/resume` in afleet does nothing at all.
4. **About forty commands share one refusal sentence, and it is about to be false.**
   `RouterTable.terminalOnlyReasons` has three keys; everything else gets "afleet has no equivalent
   of that screen", which will be said about `/context` while the meter is on screen. Every card
   here ends by naming a destination; collecting them into one copy table is the cheapest, highest
   visible-quality work in the lane (F-14).
5. **Two canon surfaces are dead code, and knowing which changes the roadmap.** `/resume`'s search
   over message *content* is hard-nulled in 2.1.263 (SPEC 35.19.4), so afleet's deliberate exclusion
   of full-text search costs **nothing** against canon — a gap users imagine that does not exist.
   `/loops` is `isEnabled: () => !1` with a complete implementation, and tui-parity's own verdict is
   "A GUI should build exactly this panel". One is a non-problem; the other is free ground.
6. **Plan limits belong to the account, not the channel, and nothing in afleet shows them.**
   `get_usage` is P and unused; `get_session_cost` is D (it returns a rendered text blob).
   Being cut off mid-turn is the worst surprise this product has, and the terminal only tells you
   when you ask. A limit chip that appears above a threshold, plus a Settings pane carrying canon's
   five bar titles verbatim, is the highest user value per unit cost in this lane (F-02).
7. **`/stop` means two different things and `/doctor` is refused although it works.** Canon's
   `/stop` ends a background session; afleet's `.interrupt` stops the turn — same word, destructive
   difference. And `RouterTable.swift:95` blocks `/doctor` with copy describing a terminal screen,
   while afleet's own captured evidence records that on 2.1.259 `/doctor` ran as a prompt and the
   model answered it. Both are small fixes and both are the kind of thing that makes users distrust
   a command bar.

## A. Session status, cost and usage — the shared Settings dialog's three non-config tabs

Lane E owns the `Settings` dialog *shell* (its card E-02: four tabs, `Settings dialog dismissed`,
the `Config` tab). Three of its four tabs are mine, because three commands open the same shell
with a different tab preselected: `/status` → `Status`, `/usage` and `/cost` → `Usage`,
`/stats` → `Stats`.

### F-01 · The `Status` tab, and `/status`

**Terminal.** `/status` renders no screen of its own. Its whole module is three lines —
`return e(n4, { onClose: o, context: t, defaultTab: "Status" })` — opening the shared dialog whose
title is `Settings`, not `Status` (SPEC 49.21, verified at `cli.pretty.js:416266` and the shell at
`:394947`). The tab is a two-column table of bold `Label:` plus value, built by two producers
separated by a blank row (SPEC 49.21.1). Group 1: `Version`, `Session name` (or the dim
placeholder `/rename to add a name`), `Session ID` **or** `Cloud session ID`, `Session kind`
(`interactive`, `background job · unattended`, `background job · attached`), then conditional
`tmux session`, `Channels`, `Peer address`, `Memory`, `cwd`, the account rows (`Login method`,
`Auth token`, `API key`, `Profile`, `Organization`, `Email`, or `Login: Expired — log in again`),
`Claude Code on the web`, `Compliance` (`HIPAA` / `ZDR (Zero Data Retention)` /
`Organization policy`), then up to twenty-eight provider rows (§49.21.1a). Group 2: `Model`,
`IDE`, `MCP servers` (`<n connected>, <n cached>, <n need auth>, … · /mcp`), `Setting sources`,
`Skipped sources`, `Managed settings (remote)`, `Organization policy`. Below them one bold heading,
`System diagnostics`, concatenating install warnings, settings-validity warnings (e.g.
`No write permissions for auto-updates`), launcher diagnostics, and one line per oversized memory
file. Headless, `/status` prints only the generic panel refusal (F-14).

**Job.** "What am I actually talking to, as whom, from where, and is anything wrong with the
setup?" It is the one screen that answers identity, connectivity and health in one place — the
thing a user screenshots into a bug report.

**Wire.** Mixed, and mostly rebuildable. `get_settings` returns `effective`/`applied`/`sources`
and the handshake carries model, cwd, session id and MCP server status; the account, provider,
compliance and diagnostics rows have no frame (`docs/tui-parity/areas/03-49-35-settings-diagnostics-sessions.md`,
class R with D for the provider/compliance rows). afleet already computes most of the identity
half itself, since it launches the process.

**afleet today.** `undesigned`. `/status` is absent from `RouterTable.local`'s 27 rows
(`FleetKit/Sources/FleetSessions/Router/RouterTable.swift:35-62`) and from the root spec, so it
falls to `CommandRouter.swift:64`'s `return .text(text)`, reaches the engine, and comes back as
the panel refusal, which `RefusalInterceptor` replaces with the generic sentence
`"/status drives a screen Claude Code draws in the terminal itself, and afleet has no equivalent
of that screen."` (`RouterTable.swift:104`). `App/Views/SettingsView.swift` is afleet's own five
sections (Environment, Engine, Config home, Storage, Developer — C5 §9) and holds none of these
rows.

**GUI form.** Split by scope, because the terminal's single table mixes two lifetimes.

*Per-channel facts* → a **channel Info popover**, anchored on the channel header's title, opened
by clicking the title or `⌘I`. Keeps, verbatim and in order: `Session name` (with the same
`/rename to add a name` placeholder, but as a click-to-rename affordance), `Session ID`,
`Cloud session ID`, `Session kind`, `cwd`, `Model`, `Memory`, `Channels`, `Peer address`. Each
value row gets a copy-on-click affordance `[exceeds]` — a session id is a thing users paste.

*Account, provider, compliance, setting sources* → a **Claude Code › Account** pane in the
Settings window (the sixth top-level section lane E proposes). These are machine- and
account-scoped; showing them per channel is the terminal's constraint, not a truth about the data.

*`System diagnostics`* → the **Activity view**, which already exists for "cross-channel
notifications, failures, denials, rate limits, auth" (§2). Each diagnostic becomes an Activity row
with its own severity, so a `No write permissions for auto-updates` is noticed once rather than
only when someone types `/status`. `[exceeds]` — the terminal only shows these when asked.

```
┌ afleet · somersault ─────────────────────────────── main · opus · plan · 42% ─┐
│                                    ▲ click title                              │
│   ┌ Session ────────────────────────────────────────────────────────┐         │
│   │  Name        wave-s session truth            ✎                  │         │
│   │  Session ID  0f3a91c8-…-4b21              ⧉                     │         │
│   │  Kind        interactive                                        │         │
│   │  cwd         ~/Developer/GitHub/somersault                   ⧉  │         │
│   │  Model       claude-opus-5 (Default)                            │         │
│   │  Memory      Paused for this session                            │         │
│   │  ────────────────────────────────────────────────────────────   │         │
│   │  Account, providers and compliance → Settings › Claude Code     │         │
│   │  2 setup warnings → Activity                                    │         │
│   └─────────────────────────────────────────────────────────────────┘         │
```

**Drops / keeps / gains.** *Drops:* the single-screen composition (deliberate — three lifetimes,
three homes) and the `· /mcp` inline command hints, which become buttons. *Keeps:* every label and
value string, the ordering within each group, the conditional rows and their exact absence rules.
*Gains:* copyable values, always-on diagnostics in Activity, provider rows readable without
opening a channel.

**Open.** Does the owner want the Info popover on the title click, or does the title click belong
to rename? (The terminal has no equivalent contention.) Which of the twenty-eight provider rows
afleet can populate at all depends on whether it launches the engine with those env vars — a probe.

### F-02 · The `Usage` tab: plan limits, session cost, and what is consuming the limit

**Terminal.** `/usage`, aliases `cost` and `stats`, is one `local-jsx` command
(`Show session cost, plan usage, and activity stats`, SPEC 28 §5) whose module is
`defaultTab: o === "stats" ? "Stats" : "Usage"` (verified at `cli.pretty.js:840964`). So **`/cost`
is not a separate surface in 2.1.263** — it opens this tab. The tab has three stacked blocks
(verified at `cli.pretty.js:393440-393500`):

1. **Limit bars.** One `so(...)` bar per window: `Current session` (`five_hour`),
   `Current week (all models)` (`seven_day`), `Current week (Sonnet only)` (`seven_day_sonnet`,
   only on `max`/`team`/unknown plans), then one per entry of the `limits` array, then
   `Claude Code and Cowork credit` (`cinder_cove`) with the subtext `One-time credit · Expires
   <Month D>`. Each bar is a 50-column fill plus `<n>% used` and a dim `Resets <when>` line, and
   is rendered only when `maxWidth >= 62` (`cli.pretty.js:393159-393210`). A null `utilization`
   removes the bar entirely. While the fetch is in flight: `Loading usage data…`.
2. **The session cost block** (`cli.pretty.js:699873`), dim, fixed-width labels:
   `Total cost:`, `Total duration (API):`, `Total duration (wall):`, `Total code changes: <n>
   lines added, <n> lines removed`, then `Usage by model:` with one right-aligned
   `<model>:` row per model reading `<n> input, <n> output, <n> cache read, <n> cache write[,
   <n> web search] ($x.xx)`, then the prompt-cache line (`<n> requests`, `<n>% of input tokens
   from cache`, `no misses` or `<n> misses (last <t> ago…, <n> tokens re-cached)`, expected
   rebuilds). When models are unrecognised the cost is suffixed
   `(costs may be inaccurate due to usage of unknown models)`.
3. **`What's contributing to your limits usage?`** — a local-session scan with a day/week toggle
   (`settings:periodDay` / `settings:periodWeek`), a `% of usage` column, and the sections
   `Skills`, `Subagents`, `Plugins`, `MCP servers`, `Loops` under the subheading
   `Skills, subagents, plugins, and MCP servers`. Empty state:
   `No attribution data yet · accumulates as you use Claude` (all verified at
   `cli.pretty.js:392900-393160`).

The degraded path matters: when `/api/oauth/usage` fails, the panel is seeded from live
rate-limit response headers, then from `cachedUsageUtilization` in `~/.claude.json`, and the
per-model weekly row is synthesised because header seeds carry no `limits` array (SPEC 8 §13.1.1).

**Job.** Two different needs share one screen: "how close am I to being cut off, and when does it
reset" (account-scoped, urgent) and "what did this conversation cost and what is eating the
budget" (channel-scoped, diagnostic).

**Wire.** Split, and one half is worse than it looks. tui-parity `areas/13-10-23-…md` §13.F
records all three aliases resolving to the same headless `/usage` text command, which returns
`Current session: <n>% used · resets …` / `Current week (all models): <n>% used · resets …`, and
advises "Prefer the `get_usage` control request over parsing this text" — so the **plan limits are
P**. But `areas/41-tui-rendering.md` records a **D** against `get_session_cost`: it returns only a
*rendered `text` blob*, not the structured cost record, so the five labelled rows and the per-model
table must be parsed out of prose or recomputed. The contributing scan is **R** — a local
transcript scan the host redoes. Both requests exist in afleet
(`ClaudeWire/Sources/WireFrames/OutboundRequests.swift:115-116`) and both are **defined and never
called** in product code; the only consumers are live-gate tests.

**afleet today.** `routed-only`. §7.7's row reads `| /compact, /context, /cost, /usage | sent as
text; results render from frames |`, and `RouterTable.swift:61-62` routes both `/cost` and
`/usage` with `strategy: .text, explanation: "Sent to the engine as text."` The engine refuses
them as interactive panels, so the user gets afleet's drift copy and no data. There is no cost or
usage surface anywhere in the app: `Workbench/Sources/PanelHostAPI/PanelTabID.swift:6` lists
`thread, agents, files, sourceControl, terminal, browser, github`, and C5 §9's Settings screen has
no usage group.

**GUI form.** Split again, and this is the split that matters most in the lane.

*Plan limits* → a **Settings › Claude Code › Account & Usage** pane, plus a **menu-bar / sidebar
footer chip** that appears only above a threshold. Limits are per-account and shared by every
channel on the machine; rendering them per channel would show the same number N times and would
make "am I about to be cut off" a per-channel question, which it is not. The pane keeps all five
bar titles verbatim, the `<n>% used` readback, the `Resets <when>` subtext and the
`Claude Code and Cowork credit` row with its expiry wording. `[exceeds]` — the bars can be live
(polled on the same cadence as the header context meter) rather than a snapshot taken when a
command was typed.

*Session cost* → the **channel Info popover** of F-01 gains a `Cost` section carrying the five
label rows and the per-model table verbatim. `[exceeds]` — the per-model rows become a small
sortable table rather than right-aligned text.

*Contributing scan* → the **Activity view**, as a "Usage" mode. It is cross-session by
construction (it scans local sessions), which is exactly the Activity view's remit.

**Drops / keeps / gains.** *Drops:* the terminal's single tab; the `maxWidth >= 62` fallback (the
GUI always has room). *Keeps:* every bar title, `<n>% used`, `Resets`, the cost block's five
labels and their token vocabulary, the prompt-cache sentence, the three section names of the
contributing scan, and the empty state. *Gains:* live limits, a cut-off warning the user does not
have to ask for, cross-channel cost.

**Open.** Should the limit chip be in the sidebar footer or the macOS menu bar extra? The menu bar
is the one region the app has barely used (§2) and a rate limit is exactly the kind of
always-relevant, rarely-clicked fact it exists for — but that is a product call.

### F-03 · The `Stats` tab (`/stats`)

**Terminal.** `/stats` is the third alias of `/usage`; it opens the same shell with
`defaultTab: "Stats"`. The tab is a machine-wide activity roll-up over
`~/.claude/stats-cache.json` (SPEC 5 §13.2: `dailyActivity`, `dailyModelTokens`, `modelUsage`,
`totalSessions`, `totalMessages`, `longestSession`, `hourCounts`, `firstSessionDate`). Its
surface, verified at `cli.pretty.js:393600-394950`: a period toggle `Last 7 days` /
`Last 30 days` / `All time`; an `Overview` block with `Sessions`, `Total tokens`, `Active days`,
`Current streak`, `Longest streak`, `Longest session`, `Favorite model`, `Peak hour`,
`Most active day:`; a `Tokens per Day` chart; a `Models` breakdown with
`No model usage data available` when empty; a whimsical comparison against a fixed list of book
lengths (`War and Peace`, `Moby-Dick`, `The Hobbit`, …); and a screenshot action reporting
`Screenshot copied to clipboard` or, on Linux,
`Failed to copy to clipboard. Please install xclip: sudo apt install xclip`. Empty state:
`No stats available yet. Start using Claude Code!`. Failures: `Failed to load stats` /
`Failed to load stats: <e>`. Dismissal appends `Stats dialog dismissed` — a *third* dismissal
string, distinct from the shell's `Settings dialog dismissed` and `/config`'s
`Config dialog dismissed`. The tab is also the only Settings tab that suppresses the shell's
`confirm:no` binding (`$s !== "Stats"` at `cli.pretty.js:394974`), so Esc behaves differently
there.

**Job.** A retrospective: how much have I used this tool, over what period, on which models. It is
partly practical (token spend by model) and partly a personal-stats toy.

**Wire.** D. Nothing on the wire carries the cross-session roll-up; `stats-cache.json` is an
on-disk artefact the host would read directly (SPEC 5 §13.2 gives the schema and the migration
rules, so this is one of the cheapest R-class rebuilds in the study).

**afleet today.** `undesigned`. `/stats` is not in `RouterTable.local` and not in the root spec;
it routes as text and is refused.

**GUI form.** **Settings › Claude Code › Account & Usage**, below the limit bars of F-02, as a
second pane section — same period toggle, same nine Overview labels, the `Tokens per Day` chart as
a real chart, and the `Models` breakdown as a table. The book comparison is kept verbatim; it is
the one piece of personality in the whole family and costs nothing. The screenshot action becomes
"Copy as image" and drops the xclip error (macOS-only host). `[exceeds]` — the chart can be
hoverable and the period toggle can be any range.

**Drops / keeps / gains.** *Drops:* the Linux clipboard failure string; the Esc-binding quirk.
*Keeps:* the three periods, the nine Overview labels, `Tokens per Day`, `Models`, both empty
states, the book list. *Gains:* a real chart, hover readouts, arbitrary ranges.

**Open.** None.

## B. Context and compaction

### F-04 · The `/context` grid

**Terminal.** `/context` has two registrations: a `local-jsx` coloured grid when interactive
(`Visualize current context usage as a colored grid`, arg `[all]`) and a `local` markdown form
when not (SPEC 13.18.2). The interactive panel is titled `Context Usage`, with the heading
`Estimated usage by category`, a legend row per category showing `<tokens> tokens` and
`<pct>%`, the auto-compact line `Auto-compact window: <auto | <n> tokens …>`, `Free space` and
`Available` rows, a `Suggestions` block (F-05), and — when the detail sections are collapsed —
the dim hint `/context all to expand` (all verified at `cli.pretty.js:629037-629383`,
`:629317`). Grid geometry is two independent booleans, narrow (`< 80` columns) and 1M window,
giving four shapes: **10 × 10**, **20 × 10**, **5 × 5**, **5 × 10** squares. Categories in
emission order: `System prompt`, `System tools`, `MCP tools`, `MCP tools (deferred)`,
`System tools (deferred)`, `Custom agents`, `Memory files`, `Skills`, `Messages`, then the buffer
(`Autocompact buffer` when auto-compact is on, else `Compact buffer` at 3,000 tokens), then
`Free space`. Every non-deferred category gets `max(1, round(tokens / window * squares))` squares,
Free space uses an unclamped round and fills the residue, and the buffer squares are appended
last. Two over-limit banners: `Context exceeds the <n>-token limit by <n> tokens — run /compact or
/clear to continue.` and `Context is <n> tokens past the <n>-token compaction window — run
/compact to reduce usage.` A remote connection has three failure lines of its own:
`Context usage isn't available over this remote connection`, `Couldn't fetch context from remote:
<e>`, `Couldn't show context usage: the remote sent a reply this version can't display`. The
markdown form's ordering differs from the panel's — with auto-compact off the `Compact buffer` row
is *not* filtered and appears among the ordinary rows before `Free space` (SPEC 13.18.2,
"Row ordering").

**Job.** "Why is my context full, and what is it full of?" It converts an opaque percentage into
an attributable budget — the only surface that names memory files, MCP tools and skills as
line items with token costs.

**Wire.** **P for the data, R for the visualisation** (`areas/28-slash-commands.md`,
`areas/13-10-23-…md` §13.C). `get_context_usage` returns the whole structured `contextUsage`
record — categories with `kind: used|free|buffer|deferred`, `mcp_tools`, `memory_files`, `agents`,
`skills`, `over_limit` (SPEC 13.18.2's `rpr`). One caveat the inventory flags: `gridRows.color` is
a **theme token name** (`promptBorder`, `inactive`, `permission`, `claude`, `warning`,
`purple_FOR_SUBAGENTS_ONLY`), so a host must map tokens to its own palette rather than take colours
literally. afleet already calls it:
`App/Timeline/Header/ReadbackPoller.swift:30` builds
`AnyControlRequest(subtype: "get_context_usage", payload: .object([:]))`. tui-parity §7 names a
context panel as a place the GUI can exceed the terminal.

**afleet today.** Split status. The **meter** is `built`:
`App/Timeline/Header/ChannelHeaderReadout.swift:8` lists the context meter as one of the five
header readbacks (C6 §10), `HeaderReadoutView.swift:78-121` draws a 64×6 capsule with a percentage
label, an auto-compact threshold tick and a per-category tooltip. The **grid and the category
detail** are `routed-only`: `RouterTable.swift:60` sends `/context` as text
(`"Sent to the engine as text."`), where the engine refuses it as an interactive panel. Note also
that the poller runs "after each `result` frame and never on a timer"
(`ChannelHeaderReadout.swift:59`), so the number is stale between turns.

**GUI form.** The header meter stays as the resting state; **clicking it opens a Context
popover**, the full translation of the panel. Region: channel header → popover (§2), poppable into
the panel column as a tab for someone tuning a long session `[exceeds]`.

Layout, top to bottom: the total (`<used> / <window> (<pct>%)`), the over-limit banner in the error
colour when present with its verbatim copy, the grid, the category legend, the collapsible detail
sections, and Suggestions.

The **grid is kept, not replaced by a bar**. A stacked bar would be the obvious GUI form and would
be worse: the square grid is what makes "System prompt is a tenth of my window" legible at a glance,
and it is the surface's signature. Fixed at 10 × 10 for ordinary windows and 20 × 10 for 1M
windows; the two narrow shapes are dropped (they exist only because the terminal can be 60 columns
wide). Hovering a square highlights its category row and vice versa `[exceeds]`. Category order,
names and colours are kept verbatim, including the two buffer names and their different placement.
The `deferred` categories keep their distinct treatment.

The detail sections — MCP tools by server, memory files by path, agents by source
(`Project`/`User`/`Local`/`Flag`/`Policy`/`Plugin`/`Built-in`), skills by source — become
disclosure rows sorted by tokens descending, each row clickable to open the offending file in the
Files tab `[exceeds — the terminal can only name the path]`. `/context all` maps to "expand all",
so the hint text `/context all to expand` is dropped in favour of a disclosure control.

```
┌ Context ─────────────────────────────────────────────── 68% of 200,000 ─┐
│  ■■■■■■■■■■   System prompt      4,102    2.1%                          │
│  ■■■■■■■■■■   System tools      12,880    6.4%                          │
│  ■■■■■■■■□□   MCP tools          9,431    4.7%   › 3 servers            │
│  ■■■■■■□□□□   Memory files       6,004    3.0%   › 4 files              │
│  ■■■■■■■■■■   Skills             3,118    1.6%   › 11 skills            │
│  ■■■■■■■■■■   Messages         100,220   50.1%                          │
│  ░░░░░░░░░░   Free space        31,245   15.6%                          │
│  ▒▒▒▒▒▒▒▒▒▒   Autocompact buf.  33,000   16.5%                          │
│  ─────────────────────────────────────────────────────────────────────  │
│  Auto-compact window: auto (200,000 tokens)                             │
│  Suggestions (2)                                                      ▾ │
└─────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** *Drops:* the two narrow grid shapes; the `/context all to expand` hint
(replaced by disclosure); the markdown form's divergent row ordering (the GUI has one ordering,
the panel's — stated per SHARED-BRIEF §5.6). *Keeps:* the grid, all eleven category names, the two
buffer names and their placement rule, the square-allocation rounding, both over-limit banners
verbatim, the auto-compact window line. *Gains:* live rather than on-demand, hover cross-highlight,
click-through to the file or server that costs the tokens, poppable into a panel tab.

**Open.** The header meter polls only after a `result` frame. Should the popover poll on open and
on a timer while visible? That is an afleet-internal question the card only flags.

### F-05 · The `/context` Suggestions block

**Terminal.** Below the grid, the interactive view appends a `Suggestions` block sorted
warnings-first then by estimated savings (SPEC 13.18.2). Five producers, each a
`{ severity, title, detail, savingsTokens? }`: fullness (`Context is <n>% full`, warning, fires at
≥ 80% when not over limit, with three alternative details depending on whether autocompact is
enabled, `DISABLE_COMPACT` is set, or neither); per-tool (`<Tool> results using <n> tokens
(<n>%)`, warning for Bash/PowerShell and info otherwise, with tool-specific advice such as
`Pipe output through head, tail, or grep to reduce result size. Avoid cat on large files — use
Read with offset/limit instead.`); duplicate Read (`File reads using <n> tokens (<n>%)`); memory
(`Memory files using <n> tokens (<n>%)` with `Largest: <top three>. Use /memory to review and
prune stale entries.`); and autocompact-off (`Autocompact is disabled` with the flat detail
`Without autocompact, you will hit context limits and lose the conversation. Enable it in /config
or use /compact manually.`). Savings estimates are fixed fractions: Bash/PowerShell 50%, Read 30%,
Grep 30%, WebFetch 40%, other tools 20%, file reads 30%, memory 30%, all `Math.floor`ed.

**Job.** Turning the diagnosis into an action. It is the only place the product tells a user *how*
to spend less context.

**Wire.** D (unverified as such by the inventory). The structured `contextUsage` record documented
at SPEC 13.18.2 carries the *inputs* (`messageBreakdown`, `memory_files`, percentages) but not the
computed suggestions; the panel builds them locally from `Pe(data)`. So a host that has
`get_context_usage` can recompute them exactly — the constants (15%, 10,000 tokens, 5%, 80%,
5,000) and the templates are fully specified.

**afleet today.** `undesigned`. Nothing in afleet computes or shows suggestions.

**GUI form.** The bottom section of the Context popover, one row per suggestion: severity dot,
title in the terminal's exact wording, detail below, and — where a savings figure exists — a
right-aligned `~<n> tokens`. Each row gets an action button where one is obvious: the memory
suggestion opens the largest file in the Files tab, the autocompact-off suggestion opens
Settings › Claude Code › Auto-compact, the fullness suggestion runs `/compact`. `[exceeds]` — the
terminal names the remedy in prose and makes the user type it.

**Drops / keeps / gains.** *Drops:* nothing. *Keeps:* all nine templates verbatim, the severity
split, the sort (warnings first, then savings), the thresholds. *Gains:* one-click remedies.

**Open.** None.

### F-06 · `/compact`, its progress display and its summary

**Terminal.** `/compact` is a `local` command,
`Free up context by summarizing the conversation so far`, arg
`<optional custom summarization instructions>`, disabled by `DISABLE_COMPACT` (SPEC 13.18.1).
It runs `PreCompact`, summarises, runs `PostCompact`, then returns `displayText` built as the
literal `Compacted ` plus up to three newline-joined lines: the transcript hint
`(<binding> to see full summary)` — usually `(ctrl+o to see full summary)`, omitted in verbose
mode — the hooks' display message, and a tip. Progress is the spinner
(SPEC 13.19.4): `Running PreCompact hooks…`, `Compacting conversation` (plus an optional hint),
`Running PostCompact hooks…`, `Running SessionStart hooks…`; remote sessions instead print the
system record `Compacting conversation…`. Five failure strings map from the compaction reason:
`Not enough messages to compact.`, `Compaction canceled.`,
`Compaction failed · conversation could not be reduced below the context limit`,
`Compaction failed · attached media exceeds size limits`,
`Error during compaction: <detail>`. Two guards precede all of it:
`Claude ended this conversation. Start a new session (or /clear) to continue.` and
`No messages to compact`. Afterwards the transcript carries a dim `Compacted` boundary row whose
detail is `<n> messages summarized (<binding> to see them)`, `<n> tokens summarized (…)`, or
`<binding> for history` (SPEC 13.19.3).

**Job.** Reclaiming context without losing the thread — and, through the custom-instructions
argument, controlling *what* survives. The summary itself is the artefact; the boundary row is the
receipt.

**Wire.** P for the boundary, **D for the progress**. `compact_boundary` carries
`compact_metadata` — `trigger`, `pre_tokens`, `post_tokens`, `cumulative_dropped_tokens`,
`duration_ms`, `user_context`, `messages_summarized`, `precomputed`, `preserved_segment`,
`preserved_messages` — and afleet already reduces it
(`FleetKit/Sources/FleetTimeline/Reduce/RecordReducer.swift:131`). But **`compact_progress` is
dropped by the wire filter `Cu`** (`areas/13-10-23-…md`, citing `cli.pretty.js:172548`), so the
four spinner phases below **cannot be received**; a host sees silence between the command and the
boundary. `/compact` is also the one command with `deferSlashToEngine` true, so it genuinely
belongs on the text route.

**afleet today.** `routed-only`, with the boundary `built`. `RouterTable.swift:59` routes
`/compact` as text with the explanation `"Compacts in the engine; renders as a divider."`;
`App/Timeline/Rendering/Rows/TimelineRowBuilders.swift:73` renders
`case .compactBoundary(let item): CompactBoundaryRow(item: item)`. What is missing is everything
around it: no progress state, no failure copy, no way to reach the summary.

**GUI form.** Keep the text route (it is the only route the wire offers) and build the three
surfaces around it.

1. **Progress** → the composer's existing turn spinner should carry the four hook/compaction
   messages verbatim, so `Running PreCompact hooks…` reads the same as in the terminal. **This is
   blocked on the wire**: `compact_progress` never arrives (above). Until it does, the honest form
   is a single indeterminate `Compacting conversation…` — the string remote sessions already use
   (SPEC 13.19.4) — and the four-phase version is a protocol ask, not a build task. Do not invent
   phase names the host cannot observe.
2. **The boundary row** keeps its dim `Compacted` text and its three detail forms, but the
   `(ctrl+o to see full summary)` binding becomes a **disclosure triangle on the row itself**.
   The terminal has to send the user to another screen because it has one screen; afleet can
   expand the summary in place. `[exceeds]`
3. **Failures** → an inline notice row above the boundary, carrying the five reason strings and
   the two guards verbatim. Today they would arrive as raw assistant text.

Custom instructions: the composer already has a `/compact ` completion; keep the argument hint
`<optional custom summarization instructions>` as ghost text.

**Drops / keeps / gains.** *Drops:* the `ctrl+o` binding reference. *Keeps:* `Compacted`, all
three boundary detail forms, the four spinner phases, the five failure strings, the two guards,
the custom-instructions argument. *Gains:* the summary expands in place; failures are legible.

**Open.** None.

### F-07 · `/autocompact` — the setting behind the meter

**Terminal.** Two registrations (SPEC 13.18.3), `argumentHint: "[auto|<tokens>]"`: a `local-jsx`
dialog when interactive, a `local` text form when not or when the workspace is remote. The dialog
is titled `Auto-compact window`, subtitled `Current setting: <description>`, and steps up/down in
100,000-token increments between 100,000 and 1,000,000 with `auto` as a wrapping zero position.
Body copy, verbatim: `This command configures when auto-compaction happens. The actual threshold
is the minimum of this setting and your model's maximum context window.`; a paragraph whose middle
is the bold `strongly recommended`; the conditional
`Auto-compact is currently disabled (see /config)`; the conditional
`Overriding auto may result in high token usage, especially when resuming long sessions.`; the
selector label `Select auto-compact window: `; and the env-var lock
`CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting
here.` Cancelling replies `Auto-compact window unchanged: <description>`. The window description
itself has six source-dependent renderings (`auto`, `auto (<n> tokens)`,
`<n> tokens (from CLAUDE_CODE_AUTO_COMPACT_WINDOW)`, `<n> tokens (default for an unrecognized
model)`, `<n> tokens (default for this model)`, `<n> tokens (from settings)`), each optionally
suffixed ` · capped to <m> by model`. The separate on/off switch lives in `/config` as
**Auto-compact** in the `Model & output` group.

**Job.** Deciding when the conversation gets summarised out from under you — the single setting
that most changes how a long session behaves.

**Wire.** The setting is written through `apply_flag_settings` with `autoCompactWindow` (SPEC
13.18.3 step 4 emits exactly that event, and an automatic reset is an explicit `null`), and the
remote `autocompact_state` frame reports the live value (SPEC 13.21.1). afleet's own
`applyFlagSetting` strategy already exists for `/effort`, `/agent` and `/fast`
(`RouterTable.swift:38,41,43`), so the mechanism is present.

**afleet today.** `undesigned`. `/autocompact` is not in `RouterTable.local` and not in the root
spec, though the header meter already draws "an auto-compact threshold tick"
(`HeaderReadoutView.swift:78-121`) — so afleet *displays* the threshold and offers no way to
change it.

**GUI form.** A row in **Settings › Claude Code › Defaults**, paired with the `/config`
`Auto-compact` boolean so the on/off switch and the window sit together — the terminal separates
them across two panels only because they are two commands. The row is a stepper with an `Auto`
position, showing the current six-way description as its subtitle so the *source* of the value
stays visible (`from settings`, `default for this model`, `capped to <m> by model`). When
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set the row is disabled with the env-var sentence verbatim as
its reason — that pattern (a locked row that says who locked it) is lane E's `/config` pattern and
should be the same control here. A secondary entry point: the header context meter's popover shows
the same threshold with an "Adjust…" link.

**Drops / keeps / gains.** *Drops:* the wrapping stepper (a GUI stepper clamps); the `(see
/config)` cross-reference, since the switch is now adjacent. *Keeps:* all six descriptions, the
cap suffix, both cautionary paragraphs, the env lock sentence. *Gains:* the switch and the window
in one place; the threshold visible on the meter and editable from it.

**Open.** None.

### F-08 · `/clear`

**Terminal.** A `local` command with aliases `reset` and `new`, arg `[name]`, description
`Start a new session with empty context; previous session stays on disk (resumable with /resume)`
(SPEC 35, verified in the catalogue at 28 §5). It does **not** touch `~/.claude/history.jsonl`
(SPEC 35.26.3: "`/clear` does not touch it"), so the composer's `↑` history survives a clear.
The transcript resets and a new session id is minted.

**Job.** Starting over without losing the old conversation — the cheapest context reclaim, and
the one users reach for when compaction would keep the wrong things.

**Wire.** P. The engine emits a `conversation_reset` frame.

**afleet today.** `built`, in the sense that matters. §7.7: `| /clear | sent as text;
conversation_reset frame resets the timeline |`; `RouterTable.swift:48` routes it as text with
`"Clears the conversation; the timeline resets on conversation_reset."`, and
`FleetKit/Sources/FleetTimeline/Reduce/WireReducer.swift:295` handles `case .conversationReset:`.
What the built form loses is the *promise in the copy*: the terminal's description tells the user
the old session stays on disk and is resumable with `/resume`, and afleet's channel simply empties
with no statement about where the old conversation went.

**GUI form.** Keep the route. Add two things. First, a **compact boundary-style notice row** at
the top of the emptied timeline: `Cleared. The previous conversation is kept — <link>open it</link>`,
where the link opens the pre-clear session as its own channel. afleet has an advantage the terminal
does not: it can *show* the old session rather than describing a command to reach it `[exceeds]`.
Second, the `[name]` argument becomes the new channel's name, matching `/rename`'s path.

Do not put `/clear` behind a confirmation. It is reversible by construction, and the terminal
treats it as such.

One hazard the clone found and afleet inherits: the somersault clone's `FOLLOWER-CLEAR-1`
(Wave S, `docs/superpowers/specs/2026-08-07-wave-s-session-truth-design.md`) records that
`/clear` in one client "leaves every other attached client showing the whole old conversation …
`host.clearSession()` swaps the engine and **broadcasts nothing**". afleet can have two views on
one session (a popped-out panel, a second window), so the notice row must be driven by the
`conversation_reset` frame in the reducer, not by the composer that sent the command.

**Drops / keeps / gains.** *Drops:* nothing. *Keeps:* the aliases, the argument, the "previous
session stays on disk" guarantee, the history-survives-clear behaviour. *Gains:* a link to the
cleared session instead of an instruction to type a command.

**Open.** None.

## C. Background work — the `/tasks` panel

Lane G owns the in-transcript background indicators and the fleet/agent surfaces; this sub-family
owns the **panel** `/tasks` opens and the two session-lifecycle commands beside it.

### F-09 · The Background dialog (`/tasks`) — the list

**Terminal.** `/tasks`, alias `bashes`, `View and manage everything running in the background`,
`immediate: true` (SPEC 20.14). The dialog is titled `Background`, colour `background`, cancel
message `Background dialog dismissed`. Its subtitle joins the non-zero counts of `agents`,
`active shells` and `active agents` with ` · ` (singular forms `agent`, `active shell`,
`active agent`). Rows sort running-first then `startTime` descending, and fall into ten fixed
sections in this order: `Agents`, `Shells`, `Monitors`, `MCP tasks`, `Cloud agents`,
`Local agents`, `Completed`, `Dynamic workflows`, and two unheaded ones (`dream`,
`auto_mode_scan`). Each header renders as `  <Label> (<count>)`. The `Agents` and `Shells` headers
are *conditional*: only four of the ten section arrays lift header suppression, so a list of
teammates plus monitors shows the teammates unheaded — a real quirk, not a bug. Row labels are
per-kind: a shell shows its `command` (or its `description` when it is a monitor), a cloud agent
its `title`, a local agent its `description`, a teammate `@<agentName>`, a workflow
`summary ?? description`. Empty state: `No tasks currently running`. Keys: `↑`/`↓` `select`,
`enter` `view`, `f` `foreground`, `x` `stop`, `ctrl+x ctrl+k` `stop all agents` (advertised by the
dialog but handled by the chat-level `chat:killAgents` binding, not by the dialog), `escape`
`close`. Two guide/behaviour mismatches are canon: `f` also foregrounds the synthetic leader row
with the message `Viewing leader`, which the guide never advertises; and `enter` on a *completed*
local agent foregrounds it (`Viewing agent`) rather than opening details. Pressing `x` immediately
after the selection was auto-adjusted is swallowed once, so a re-index cannot kill the wrong task.

**Job.** The single answer to "what is this session still doing that I cannot see" — shells,
monitors, subagents, teammates, cloud agents and workflows in one list, each stoppable.

**Wire.** **X for the dialog, R for its content, P for the one action that matters.**
`areas/20-tasks-background.md`: "Everything the dialog *shows* is rebuildable from the registry
mirror; everything it *does* is reachable via `stop_task`. The dialog itself is unreachable."
`stop_task {task_id}` → `{}` is "the one background-task *action* a headless host has, and it is
complete", with the failure strings `No task found with ID: <id>. Did you mean: …`,
`Multiple teammates match "<name>": …` and `Task <id> is not running (status: <status>)`.
**Foregrounding is D** — "No control request foregrounds a task … an in-process TUI state change
with no protocol surface." Stop-all is R (N × `stop_task`). Backgrounding *all* eligible tasks is
P via `background_tasks`, but backgrounding one running foreground shell is D.

**afleet today.** `routed-only`, and this is the largest hole in the lane.
`RouterTable.swift:53` routes `/tasks` to `.native("tasks")` with the explanation
`"Shows the running tasks with per-task Stop."`, and §7.7 promises `| /tasks | the registry
mirror, with per-task stop_task |` — but **there is no screen behind the name**.
`App/Header/SettingPickers.swift:492` gates on `pickerSurfaces = ["modelPicker", "effortPicker"]`,
so `tasks` sets `ComposerModel.openSurface` and nothing opens; the app's own tech-debt tracker
records it (item 207, `docs/tech-debt-tracker.md:1271`: "`agents` and `tasks` set
`ComposerModel.openSurface` and there is still no screen behind either name"). Two adjacent things
*are* built and are not this: `App/Views/SidebarView.swift:100`'s `Section("Background")` lists
detached **jobs** with `Adopt` / `Attach` / `Logs` / `Stop`, and
`App/Decisions/TaskCardView.swift` is a per-run **timeline card** carrying `stop_task {task_id}`
and `background_tasks {tool_use_id}`. Neither enumerates the registry.

**GUI form.** The registry list belongs in the **panel column, as a section of the Agents tab**,
not as a modal. The terminal's dialog is modal because a terminal has one screen; the whole point
of a running-work list is to watch it while you keep working, which is what a persistent panel tab
is for. `[exceeds]`

Layout: the Agents tab gains a `Running` section above its existing content, with the subtitle
string kept verbatim (`3 agents · 2 active shells`), the eight named section headers in the
terminal's fixed order and the same `<Label> (<count>)` format, and the per-kind row labels
unchanged. The two unheaded sections stay unheaded. **Drop the conditional-header suppression
rule** — it exists to save two terminal rows and produces the confusing unheaded-teammates case;
say so as a deviation.

Row actions become hover buttons rather than keys: `Stop` (→ `stop_task`), `View` (→ opens the
detail, F-10), and `Foreground`. Foreground is the one action with no wire route, so the button
must not exist until it does: in afleet, "foreground this task" means *scroll the timeline to the
row that owns it*, which is a host-side navigation and a better answer than the terminal's screen
swap. Keep the terminal's three confirmation messages (`Viewing agent`, `Viewing teammate`,
`Viewing leader`) as toast text only if the navigation is not obvious; otherwise drop them.

`/tasks` typed in the composer focuses the Agents tab's Running section — the same resolution the
router already promises, now with a destination. Empty state keeps `No tasks currently running`.

```
┌ Panel ── Thread │ Agents │ Files │ Source Control │ Terminal │ Browser │ GitHub ┐
│ Running · 3 agents · 2 active shells                                            │
│   Agents (3)                                                                    │
│     @reviewer          running   2m14s                    [View] [Stop]         │
│     @indexer           running     48s                    [View] [Stop]         │
│   Shells (2)                                                                    │
│     npm run dev        running   6m02s                    [View] [Stop]         │
│     rg -n "openSur…"   running      3s                    [View] [Stop]         │
│   Completed (1)                                                                 │
│     Summarise the spec  done      1m11s                   [View]                │
│                                                    [Stop all agents]            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** *Drops:* modality; the conditional-header rule; `ctrl+x ctrl+k` as a
dialog-advertised chord (it becomes a button, and stays a global shortcut); the swallow-first-`x`
guard (a click has no re-index hazard). *Keeps:* the title word `Background`, the subtitle
grammar, the eight section names and their order, the `<Label> (<count>)` format, the per-kind
labels, the sort, the empty state. *Gains:* persistent visibility, hover actions, click-through to
the originating timeline row.

**Open.** Does the Running section belong in the Agents tab (lane G's territory) or as its own
`Tasks` tab? Shells and monitors are not agents. This needs one decision across lanes F and G.

### F-10 · The task detail sub-views

**Terminal.** `enter` on a viewable row opens a per-kind detail view (`{ mode: "detail", itemId }`,
SPEC 20.14.2 branch 3). The clone built these against the binary and its scorecard row
*Background-dialog detail sub-dialogs* (`CC-to-SDK/docs/parity/tui-ux.md` §4) records the anatomy:
`Shell details` with a **last-lines output box**, or `<agentType> › <description>` with
**Progress / Prompt / Error** sections. The clone marks three elements it could not reach: the
shell's ` (exit code: N)` suffix, the `of <bytes>` half of `Showing N lines`, and the
once-a-second runtime tick. The teammate detail view exposes its own `onForeground` callback,
gated on `status === "running"`, which is the *only* way `enter` leads to foregrounding a
teammate — one step after the list. `monitor_ws` rows have no detail view at all, and `mcp_task`
rows only when the MCP detail module has loaded. If the dialog auto-opened on a single task and
that task disappears, the dialog closes; otherwise it falls back to the list.

**Job.** Seeing what a background thing is actually producing, without foregrounding it and
without waiting for it to finish.

**Wire.** R. The registry mirror carries the task's type, status, description and progress; a
shell's output tail is the same `local_bash` output the transcript already receives. The clone
reached "Enter-to-tail" against a live CLI (§8 row *Background task output reachable*, probe 74,
tailing the last 12 lines in-panel), so the tail is demonstrably available to a host.

**afleet today.** `undesigned`. No detail view exists; §7.5's Task thread is reply-less
(`| Task | background shell or monitor | its task frames and output | stop only |`), and
`TaskCardView` shows name, elapsed, Stop and Move-to-background — no output.

**GUI form.** Selecting a row in the Running section fills the **lower half of the same panel tab**
(master/detail inside one tab, no navigation stack), or opens the Thread tab focused on that
task's thread when one exists — afleet already models a task as a thread (§7.5), which is a better
home for its output than a sub-dialog. Content per kind, keeping the terminal's section names:

| Kind | Sections |
|---|---|
| shell | `Shell details`, then a scrolling output view (not a last-N-lines box) `[exceeds]` |
| agent / teammate | `<agentType> › <description>`, then `Progress`, `Prompt`, `Error` |
| workflow | hands off to F-36's workflow detail |
| monitor / MCP task | status and last event |

The three elements the clone could not reach are reachable here and should ship: the exit code
next to a finished shell, the byte count beside the line count, and a live elapsed tick. The
terminal wanted all three.

**Drops / keeps / gains.** *Drops:* the last-lines truncation; the sub-dialog framing. *Keeps:*
`Shell details`, the `<agentType> › <description>` header, `Progress` / `Prompt` / `Error`, the
disappear-while-open fallback. *Gains:* full scrollback, exit code, byte count, live elapsed,
copyable output.

**Open.** None.

### F-11 · The Remote Control variant of the Background dialog

**Terminal.** When a Remote Control transport is attached, `/tasks` loads a different, smaller
component over the `remoteBackgroundTasks` slice of app state (SPEC 20.14.4). Same title
`Background` and same cancel message, but subtitle `Running in the cloud session`, a three-entry
input guide (`↑`/`↓` `navigate`, `x` `stop`, `escape` `close`), and a fixed footer note:
`Each task's output reaches the transcript when it finishes; a per-task view isn't sent to this
terminal.` Stopping is two-phase and new in 2.1.263: the row **stays listed** with the suffix
` · stopping…` until the host confirms, and a failure shows `Couldn't stop it: <message>` in the
error colour and leaves the row so the stop can be re-issued.

**Job.** Honest degradation. It tells the user exactly what this view cannot show and keeps a
killed row visible until the kill is real.

**Wire.** P for the stop (`{ subtype: "stop_task", task_id }`), D for everything else — the detail
views are not sent.

**afleet today.** `out-of-scope` as a *variant*: afleet hosts the engine locally, so it is never
the thin client. But its **stop semantics are directly applicable** and afleet does not have them.

**GUI form.** Do not build the variant. Do adopt its two behaviours in F-09: a stop is optimistic
only after the host confirms — until then the row shows ` · stopping…` — and a failed stop shows
`Couldn't stop it: <message>` and leaves the row. Every remote surface in afleet (a job on another
machine, a cloud agent) has the same property, and this is canon's own answer to it.

**Drops / keeps / gains.** *Drops:* the whole variant. *Keeps:* two-phase stop, the ` · stopping…`
suffix, `Couldn't stop it: <message>`. *Gains:* n/a.

**Open.** None.

### F-12 · `/background` and `/stop`

**Terminal.** Two `local-jsx` commands registered only when FleetView is on (SPEC 28 §5).
`/background`, alias `bg`, `Send this session to the background and free the terminal`, arg
`[prompt]`. `/stop`, `Stop this background session; transcript and worktree are kept` — registered
only in a background session. `/background`'s refusals, recorded in
`areas/20-tasks-background.md`: `Cannot background — session persistence is disabled…`,
`Nothing to background yet — send a message first.`,
`Forking is not available in coordinator sessions. Use /branch instead.`,
`Couldn't fork — this conversation is still being saved. Try again in a moment.` Its spawn
failures print `Couldn't start a background session (<detail>)` (SPEC 20.15.1). Unlike `/fork`,
the `/background` hand-off *does* write a `continued-in` record, because the parent stops
(SPEC 35.22.2's `keepParent` contrast).

**Job.** Getting the long thing off your desk without killing it, and killing it later.

**Wire.** X for both as commands (`areas/28-slash-commands.md`: `/stop`'s "`stop_task` addresses
background *tasks*, not this session concept"). The capability exists in afleet's own lifecycle
layer rather than on the wire.

**afleet today.** Both `built`. `RouterTable.swift:51` routes `/background` to
`.lifecycle(.sendToBackground)` with the confirmation copy
`"This channel's process is replaced by a background job; its local shells close."`
(`App/Composer/CommandRouting.swift:111`); `RouterTable.swift:52` routes `/stop` to `.interrupt`
with `"Stops the current turn; Stop everything also stops background tasks."` Both also appear as
header-menu actions (`App/Header/HeaderMenus.swift:50-51`) behind confirms.

Two divergences worth naming. First, afleet's `/stop` is **the turn interrupt**, while the
terminal's `/stop` **ends a background session** — same name, different verb. A user who learns
`/stop` in one and types it in the other gets something they did not ask for. Second, afleet's
confirmation is stronger than the terminal's (which just goes), and correctly so: afleet closes
local shells in the process, which the terminal does not.

**GUI form.** Keep both routes and both confirmation strings. Rename the *concepts* in the UI so
the collision is visible: the header menu's stop-the-turn action reads **Stop** and the sidebar
Background row's action reads **Stop job** — the sidebar already has that button
(`SidebarView.swift:305-308`). Then map the terminal's `/stop` to the *job* verb when the channel
is attached to a background job, and to the interrupt otherwise, which is what the terminal's own
registration condition does (it registers `/stop` only in a background session).

Carry `/background`'s four refusal strings verbatim into the confirm sheet's disabled reasons —
today afleet would attempt the hand-off and fail later.

**Drops / keeps / gains.** *Drops:* nothing. *Keeps:* both commands, the four refusals, the
transcript-and-worktree-are-kept promise. *Gains:* the collision made visible; refusals shown
before the action rather than after.

**Open.** Is `/stop` meaning "interrupt" a deliberate afleet choice or an accident? It changes what
a user's muscle memory does. Owner's call.

## D. Help, and the command surface itself

### F-13 · The `/help` dialog

**Terminal.** SPEC 263 has **no section for the `/help` dialog** — chapter 41 stops at the
transcript pager's help panel — so this card is built from the binary. `/help` is `local-jsx`,
`Show help and available commands`, `immediate` when fullscreen (SPEC 28 §5), and its component is
at `cli.pretty.js:219415-219500`. It is a tabbed dialog: `qp({ title: "Help", color:
"professionalBlue", defaultTab: "general" })` (`:219479`) with three tabs — `General`, `Commands`,
`Custom commands` (`:219456`, `:219464`, `:219470`).

*General* (`:219386-219410`) is three stacked blocks: the tagline `Claude understands your
codebase, makes edits with your permission, and executes commands — right from your terminal.`; a
dim line `New here? Run /powerup to learn the features most people miss.` which is **suppressed
below 44 terminal rows** (`var lo = 44`, `:219385`); and a bold `Shortcuts` heading over the
shortcut grid component, rendered `gap: 2, fixedWidth: true`.

*Commands* and *Custom commands* are the same browser component with different filters and titles:
`Browse default commands` and `Browse custom commands`. The split predicate is
`fo.type !== "prompt" || fo.source === "builtin" || fo.source === "bundled"` (`:219411`) — so a
bundled *skill* like `/doctor` lists as a default command, and only user/plugin prompt commands are
"custom". Hidden commands are filtered from both. Rows are `/<name>` plus a description truncated
to `columns - 10`, de-duplicated by name and sorted by name; the visible count is
`floor((maxHeight - 10) / 2)`. Empty state for the custom tab: `No custom commands found`.

Three footer lines below the tabs (`:219484`, `:219489`, `:219494`): always
`For more help: https://code.claude.com/docs/en/overview`; conditionally (rows ≥ 44 and a second
gate) the dim `Something else? Use /feedback to report bugs or request features.`; then a dim
`<esc> to cancel`, replaced by `Press <key> again to exit` while an interrupt chord is pending.
Dismissal appends the system message `Help dialog dismissed`.

**Job.** Discovery. It is where a user learns what commands exist and what the keys do — and, for
a GUI, it is the surface most at risk of being quietly dropped because "the menus cover it".

**Wire.** **R, with a documented fidelity ceiling.** `areas/28-slash-commands.md`: "The GUI must
build its own palette from `initialize.commands` — which lacks grouping, type, source and
`isHidden`, so the TUI's grouping cannot be reproduced faithfully." The Commands/Custom split
depends on `type` and `source`, neither of which crosses the wire; a host cannot reproduce the two
tabs correctly. The inventory also flags `help` as one of two `HEADLESS_YIELDABLE_NAMES`, so a
plugin may legally claim the name — a GUI that hard-codes `/help` can be shadowed. Live on 2.1.259
`/help` was refused with `/help isn't available in this environment.` The somersault clone hit the
same ceiling and recorded it: its `/help` row ships the three tabs but notes "the Custom-commands
tab can never populate (the SDK's `SlashCommand` carries no builtin-vs-user field)".

**afleet today.** `undesigned`, measurably: `/help` occurs zero times in the root design spec and
is not in `RouterTable.local`. It routes as text, the engine refuses it, and `RefusalInterceptor`
replaces the sentence with the generic
`"/help drives a screen Claude Code draws in the terminal itself, and afleet has no equivalent of
that screen."` A user asking for help is told there is no help.

**GUI form.** Two destinations, because the terminal's three tabs are two different jobs.

*Commands* → the **composer's `/` picker**, which afleet already has (the shortcut bar reads
`/ commands  @ files  ! shell`, §2). That picker *is* the Commands tab: same list, same
`/<name> — description` row, same de-duplication and name sort, plus type-to-filter. It should
gain the empty state and the two-tab grouping **only if** the wire ever carries `source` — until
then, one flat list with a note, and the card says so rather than shipping a tab that can never
populate.

*Shortcuts* → a **Keyboard Shortcuts window** on the macOS `Help` menu (`⌘?`), which is where a Mac
user looks. The grid keeps the terminal's three-column shape and, critically, resolves every chord
from afleet's live binding table so a rebind moves both surfaces — the clone verified that this is
achievable (its `/help` row: "the same component the `?` overlay draws, so a rebind moves both").

*The tagline and the docs link* → the shortcuts window's footer, keeping
`For more help: https://code.claude.com/docs/en/overview` verbatim and dropping
`New here? Run /powerup …` (a terminal-only command) and its 44-row suppression rule.

Typing `/help` opens the shortcuts window and focuses the command picker behind it.

**Drops / keeps / gains.** *Drops:* the modal dialog; the `Custom commands` tab (cannot populate);
the `/powerup` line and its row threshold; `Help dialog dismissed`. *Keeps:* the command list's
shape and sort, the tagline, the docs URL, the `/feedback` footer (rewritten to afleet's feedback
route), the shortcut grid's three columns. *Gains:* shortcuts always reachable from the Help menu;
live-bound chords; a searchable command list that is also how you run the command.

**Open.** Is the shortcut grid worth building before afleet's keybindings are user-editable? It is
cheap either way, but its value multiplies once they are.

### F-14 · The lazy-dialog failure strings, and what a panel command does mid-turn

**Terminal.** Seventy-four slash commands resolve to a chunk imported on demand (SPEC 41.22.1's
registry). Two failure strings exist for two different failures (SPEC 41.22.3). Interactive, when
the registry lookup fails or the tool-use context has no dialog host, emitted as an
immediate-priority feedback notification with telemetry reasons `cmd_local_jsx_no_dialog_resolution`
and `cmd_local_jsx_no_panel_host`:

```text
/<name> is currently unavailable.
```

Non-interactive:

```text
/<name> opens an interactive panel and isn't available in this environment. Run it from the Claude Code terminal instead.
```

There is a third, more common sentence that is not from this mechanism and is easy to conflate:
`/<name> isn't available in this environment.`, the universal headless refusal that
`areas/28-slash-commands.md` §3.1 verified against thirty-two commands live on 2.1.259 — "every
refusal used exactly that text", delivered as **an `assistant` frame with no user echo at all", so
*echo present ⇒ the command ran; assistant frame only ⇒ it was refused*.

One behaviour of the dialog host is user-visible and worth carrying (SPEC 41.22.2): a slash command
typed **mid-turn** keeps the prompt live (`hidesPrompt: false`), while the same command typed at
rest **unmounts** the composer. Dialogs that opt into `retireAtTurnBoundary` are closed when the
next query dispatches. So the terminal's own rule is: *never take the composer away from a user who
is mid-thought.*

**Job.** Telling the user why nothing happened, in a way that distinguishes "this build is broken"
from "this surface does not exist here".

**Wire.** T for the mechanism, but the *strings* are what a host must intercept. tui-parity
`areas/41-tui-rendering.md:522` records both longer forms.

**afleet today.** `built`, and it is one of the better-built things in the lane.
`RouterTable.swift:73-75` carries both patterns as anchored regexes —
`bareRefusalPattern` and `interactivePanelRefusalPattern` — and `RefusalInterceptor` replaces the
matched assistant text with afleet's own copy, because §7.7 forbids showing the user a sentence
telling them to go back to the terminal. The replacement ladder is
`RouterTable.explanation(forDrift:shape:)`: the routed command's own explanation, then a
`terminalOnlyReasons` entry, then a per-shape generic. **The gap is the copy, not the mechanism**:
`terminalOnlyReasons` has exactly three keys — `/doctor`, `/color`, `/reload-plugins`
(`RouterTable.swift:94-98`) — and about forty panel commands fall through to
`"<name> drives a screen Claude Code draws in the terminal itself, and afleet has no equivalent of
that screen."` For most of this lane's commands that sentence is now *false*: it will say afleet
has no equivalent of `/context` while the header meter is showing one.

**GUI form.** No new widget. The work is **one line of copy per command**, and it is the single
highest-leverage item in this lane because it is what makes the app feel complete rather than
subset. Each line says what afleet does instead and where: `"/context is the meter in the channel
header — click it for the full breakdown."`, `"/usage is in Settings › Claude Code › Account &
Usage."`, `"/tasks is the Running section of the Agents tab."`, `"/help — the command list is the
composer's / picker; the shortcuts are ⌘? ."` Where afleet genuinely has nothing, the line says so
plainly and names what is planned, per §7.7's rule that no line sends the user out of the app.

Also adopt the mid-turn rule: **no surface in this lane may steal the composer while a draft or a
turn is in flight.** Everything proposed here is a popover, a panel section or a Settings pane, so
this holds by construction — but it should be stated, because a modal sheet would break it.

**Drops / keeps / gains.** *Drops:* the terminal's two strings, replaced by afleet's own (already
the design). *Keeps:* the two-shape distinction and the drift counting; the never-send-them-back
rule; the mid-turn composer rule. *Gains:* ~40 lines of accurate copy instead of one generic
sentence.

**Open.** None — this is a writing task, and this lane's cards supply the destinations.

### F-15 · Pass-through prompt commands (`/review`, `/security-review`, `/commit`, `/ultrareview`, `/autofix-pr`)

**Terminal.** A `prompt` command is a markdown template the model executes; it has no screen of its
own. What the user sees is four things (SPEC 28 §9.3, §10):

1. The **echo**, a user message wrapping the invocation. The `prompt` form (`Fe`,
   `cli.pretty.js:540585`) has no indentation and drops `<command-args>` when empty:
   `<command-message>NAME</command-message>` / `<command-name>/NAME</command-name>` /
   `<command-args>ARGS</command-args>`. The `local`/`local-jsx` form (`qV`) puts `<command-name>`
   first and carries **literal 12-space indentation on lines 2 and 3** — a difference a renderer
   must not normalise away silently.
2. **Skill-loading metadata** instead of the echo, when the command is not user-invocable and came
   from `skills`, `syncedSkills`, `plugin`, `mcp` or `memoryStore`:
   `<command-message>` / `<command-name>` (no leading `/`) / `<skill-format>true</skill-format>`.
3. The **progress message** — spinner text declared on the command: `analyzing code changes for
   security risks` for `/security-review`, `analyzing your codebase` for `/init`, `running checkup`
   for `/doctor`, `analyzing your sessions` for `/insights`. tui-parity is explicit that this "is
   client-side spinner text the GUI must supply itself".
4. The **caveat**, prepended to any command that did not request a model turn:
   `<local-command-caveat>Caveat: The messages below were generated by the user while running local
   commands. DO NOT respond to these messages or otherwise consider them in your response unless
   the user explicitly asks you to.</local-command-caveat>`, on a message with `isMeta: true`.

Two behaviours change what the user sees. A `prompt` command may declare `allowedTools`, which
arrive as a `command_permissions` attachment scoping the turn — so a skill can grant permissions
the session does not otherwise have. And when `getContextOf(cmd, args, ctx) === "fork"`, the
command runs as a background subagent and returns immediately with
`<local-command-stdout>Running in the background as @<agent-name></local-command-stdout>`.

Of the five named commands, only `/security-review` and `/ultrareview` are catalogue rows;
`/review` exists as an alias of the bundled `code-review` skill (with
`subcommands: { ultra: "ultrareview" }`), and **`/commit` does not appear in the corpus at all** —
it is a user- or plugin-supplied command in practice. `/ultrareview` and `/autofix-pr` are cloud
launchers gated on entitlement, with descriptions computed at render time
(`Start a cloud agent that finds and verifies bugs in your branch (<time>, <cost> USD) · Runs in
Claude Code on the web. See <docs-url>`).

**Job.** Running a long, tool-heavy recipe without writing the prompt. The user need is that the
*recipe* is legible — which skill ran, with which permissions, and how long it will take.

**Wire.** **P.** `areas/28-slash-commands.md`: the host sends the literal `/<name> <args>` as a
`user` frame and the engine does the rest; `/security-review` is classed P with "`progressMessage`
… is client-side spinner text". Six tags must be parsed by a renderer: `<command-name>`,
`<command-message>`, `<command-args>`, `<local-command-stdout>`, `<local-command-stderr>`,
`<local-command-caveat>`. Stacking is P up to `MAX_STACKED = 5`.

**afleet today.** `routed-only` by §7.7's class 3 — "everything else in the `commands` list (custom
commands, skills, plugin commands, headless-capable built-ins) is sent as text and executes in the
engine". `/autofix-pr` is `out-of-scope`: `areas/28-slash-commands.md` classes it X as a cloud
feature (ch. 37), and cloud sessions are a standing exclusion (root spec §17.8). Lane B owns the
tag-stripping renderer; what is undesigned here is the *chrome* — no progress message, no
permission readback, no fork-dispatch affordance.

**GUI form.** One pattern for the whole class, in the **timeline**.

The echo becomes a **command chip** on the user row: a monospace `/security-review` pill with the
arguments beside it, and the six wrapper tags never rendered (lane B). The clone's honesty rule is
worth adopting: it routes commands it cannot run to an explicit "why not here" line rather than
letting them silently become prompt turns.

The progress message becomes the **turn spinner's text**, supplied by afleet from a table keyed by
command name — the wire will not send it. When a command declares `allowedTools`, the chip carries
a small badge reading `+3 tools for this turn`, expanding to the list: a skill silently widening
permissions is exactly the kind of thing afleet's decision surfaces exist to make visible
`[exceeds — the terminal shows this only in the attachment]`.

Fork dispatch keeps its message but as a **task row**, not stdout text: `Running in the background
as @<agent-name>` becomes a row in the Running section (F-09) with the agent's name, which is where
the user will look for it.

For `/ultrareview` and `/autofix-pr`, keep the computed descriptions verbatim in the command
picker — the `(<time>, <cost> USD)` estimate is the whole basis for deciding to run them — and mark
both as unavailable with a reason, since afleet excludes cloud sessions.

**Drops / keeps / gains.** *Drops:* all six wrapper tags from display; the caveat text (it is
addressed to the model, not the user); the 12-space indentation quirk (preserved on the wire, never
shown). *Keeps:* the command name and args as shown text, the progress messages verbatim, the
fork-dispatch sentence, the cloud commands' cost/time descriptions. *Gains:* a visible
tool-permission badge; background dispatch as a real row.

**Open.** Which commands' progress messages does afleet hard-code? The list is small and static in
canon, but a plugin can add one and the wire will not carry it — accept the gap or ask for it.

### F-16 · Stacked commands

**Terminal.** A `prompt` command may be followed immediately by another slash command, to a depth
of five (SPEC 28 §11). Peeling stops at the first non-`prompt` command, at a `context: "fork"` head,
at `argsMayContainSlashCommands` (which the bundled `/loop` skill sets precisely so `/loop 5m /foo`
keeps `/foo` as an argument), and at a redaction mismatch. Each stacked command's messages are
appended, its tool lists concatenated onto the head's, and its `model` and `effort` override the
head's. Blocked or failing stacks produce
`Stacked skill /<name> blocked by UserPromptExpansion hook` and
`Stacked skill /<name> failed to load: <error>`; hitting the cap produces
`Stacked command limit (5) reached — remaining input passed as arguments`.

**Job.** Composing recipes in one line — `/plan /security-review` — without a scripting layer.

**Wire.** P, up to `MAX_STACKED = 5` (`areas/28-slash-commands.md`).

**afleet today.** `undesigned`. Nothing in afleet knows the concept; a stacked line is sent as text
and works by accident, which is the right default — but none of the three failure strings is
surfaced.

**GUI form.** The composer's `/` picker keeps offering completions after the first command, so a
stack is discoverable rather than folklore `[exceeds]`. The user row renders **one chip per stacked
command**, left to right, so what ran is visible. The three failure strings become notice rows above
the turn, verbatim. The cap message matters most: without it, input silently becomes arguments.

**Drops / keeps / gains.** *Drops:* nothing. *Keeps:* the depth of five, the peel-stopping rules,
all three strings. *Gains:* completion after the first command; the stack visible as chips.

**Open.** None.

### F-17 · Coordinator-mode refusals

**Terminal.** When `CLAUDE_CODE_COORDINATOR_MODE` is set and the client is remote or
non-interactive, a `prompt` command in the coordinator's main context is **not expanded**; an
explanatory message is emitted instead (SPEC 28 §9.5). Neither refusal is a fixed block — both are
assembled line by line and joined with newlines. The *refusal* branch (for
`disableModelInvocation`, an MCP prompt reached from a non-MCP command, or a `skillOverrides`
disable) opens with either the MCP variant or
`Skill "/<name>" is user-invocable only (<disable-model-invocation | disabled for model invocation
in settings>) and cannot run in coordinator mode: the coordinator does not load skill content, and
workers cannot invoke it via the Skill tool.`, then `Description: …`, then the conditional
`Note: the subcommands "…" route to their own dedicated commands and DO still work when the user
types them directly in the terminal …`, then a closing paragraph beginning `Do not instruct workers
to invoke this via the Skill tool — it will be refused.` The *worker-available* branch instead
reads `Skill "/<name>" is available for workers.`, `Description:`, `When to use:`,
`This skill grants workers additional tool permissions: …`, and closes
`Instruct a worker to use this skill by including "Use the /<name> skill" in your Agent prompt.`
Separately, `/fork` refuses in coordinator sessions with
`Forking is not available in coordinator sessions. Use /branch instead.`

**Job.** Explaining to a coordinating agent — and to the human reading its transcript — why a
command did nothing, and what to do instead.

**Wire.** These are ordinary meta messages on the turn, so P for delivery. The mode itself is an
environment variable afleet controls when it launches the engine.

**afleet today.** `undesigned`. Coordinator mode is not modelled; the messages would render as raw
assistant text.

**GUI form.** These are **agent-facing**, not user-facing, and that is the translation. In afleet
they should render as a **collapsed notice row** on the turn — one line
(`/<name> is not available in coordinator mode`) with the full assembled text behind a disclosure —
because the human is reading over the coordinator's shoulder and needs to know the command did
nothing, not to read four paragraphs written for a model. The `Use /branch instead` fork refusal is
the exception: it names a user action, so it stays a full-width notice with `/branch` as a button.

Whether afleet ever runs a coordinator is lane G's question; this card exists so the strings have a
home when it does.

**Drops / keeps / gains.** *Drops:* full-height display of model-directed prose. *Keeps:* every
line verbatim behind the disclosure; the fork refusal at full weight. *Gains:* the human can see at
a glance that nothing ran.

**Open.** Does afleet plan a coordinator mode at all? If not, this card is a `superseded` marker
rather than a build item.

## E. Session history: resume, rename, branch, fork

### F-18 · The `/resume` picker — the list, its grouping and its three filters

**Terminal.** `/resume`, alias `continue`, `Resume a previous conversation`, arg
`[conversation id or search term]` (SPEC 35.19). The header is the literal `Resume session`,
suffixed ` (<focused> of <total>)` when the list is longer than one screen and ` · Refreshing…`
while loading — so the familiar header is `Resume session (3 of 47)`. There are **no column
headers**; it is a label/description list. Sessions are discovered across the current project
directory, sibling worktree directories, `.session-aliases`, worktree sweep directories and
cross-project directories whose recorded cwd matches, enriched 50 rows at a time.

Rows sharing a `sessionId` fold into a group: the header row carries ` (+N other session)` /
` (+N other sessions)` and a `▼ `/`▶ ` prefix, children are indented with `  ▸ `. Other badges:
` (sidechain)` and `  ⧉ <n>` for the artifact count. The title resolves
`agentName → customTitle → aiTitle → summary → firstPrompt → "Autonomous session" → first 8
characters of the session id`, with XML-ish tag blocks stripped. The description line is
`<relative time> · [bg ·] [<branch> ·] <size-or-count>[ · #<tag>][ · @<agent>][ · <repo>#<PR>]`,
joined by ` · `; because list rows always carry `fileSize`, **the row shows a byte size, not a
message count**. With all-projects on, ` · <projectPath>` is appended. Relative time reads
"3 hours ago" in list rows and "3h ago" in the preview footer, from the same formatter given
different options.

Three filter toggles, each with its own footer label: `Ctrl+A` `show all projects` /
`only show current repo`; `Ctrl+B` `show all branches` / `only show current branch`; `Ctrl+W`
`show all worktrees` / `only show current worktree` (shown only when more than one worktree
exists). The plain footer reads `Ctrl+A to show all projects · Space to preview · Ctrl+R to rename ·
Type to search · Esc to cancel`. Empty states: `No sessions match "<query>".`,
`No conversations found.`, and `No conversations found in this project.` with the hint
`Ctrl+A to show all projects`. Pagination fetches three screens once focus comes within two
screens of the end and gives up after five consecutive empty requests.

A quiet trap: the current session is **not** reliably in the list. The current-id exemption is only
the first of three filters, so a current session on another branch or outside the active worktree
is dropped; and the `/resume` command removes the current session from its input entirely before
the component sees it.

**Job.** Finding the conversation you were in — by project, branch, worktree, name or recency —
and getting back into it.

**Wire.** **R, from disk. "No control request at all."** (`areas/03-49-35-…md` §35.2; the picker
itself is X, the list is R.) A host enumerates `~/.claude/projects/**/*.jsonl` and relaunches with
`--resume`. `--continue` is P: it picks the newest non-superseded, non-live conversation, refusing
with `No conversation found to continue`. README finding 1 is load-bearing here: **`--resume` does
not replay history** — a resumed headless session emits nothing until the first new turn, so the
transcript JSONL is the only source of prior messages.

**afleet today.** `routed-only` for the command, `built` for a *different* surface.
`RouterTable.swift:58` routes `/resume` to `.native("switcher")` — "Focuses the channel switcher" —
and §7.7 confirms `| /resume | focuses the sidebar switcher |`. But the switcher is not reachable
from the composer (tech-debt 207, the same gap as `/tasks`), so today `/resume` does nothing.
What *is* built is the sidebar (`App/Views/SidebarView.swift`) and the ⌘K quick switcher
(`App/Switcher/QuickSwitcherModel.swift`, `App/Views/QuickSwitcherView.swift`).

Measured against the terminal, the built surfaces keep the job and lose six affordances:

| Terminal | afleet today |
|---|---|
| `Resume session (N of M)` count | per-project `<n> channels` only; no global count (`QuickSwitcherModel.swift:74`) |
| search over title, **branch, tag, PR identifier** | fuzzy over `[title, cwd.lastPathComponent, gitBranch, agentName]` (`:88`) — no tag, no PR |
| `Ctrl+A` / `Ctrl+B` / `Ctrl+W` filters | none; sidebar sections group by project and hide beyond 30 days, the switcher searches the whole index (`:36`) |
| fork-lineage grouping with ` (+N other sessions)` | none |
| `Space` preview | a one-line `row.preview` in the sidebar (`SidebarView.swift:253`); the switcher's second line is a directory (`:139`) |
| `Ctrl+R` rename in place | none; no `contextMenu` in `SidebarView.swift` |
| description line: `bg`, size, `#tag`, `@agent`, `repo#PR` | title plus directory |
| sort by `modified` desc | recency, capped at 10 on an empty query |

**One thing afleet does *not* lose, and this matters.** The terminal's search over message content
is **dead code in 2.1.263**: the index handle is hard-nulled and the results state is only ever set
to `null` (SPEC 35.19.4), so the 300 ms debounce runs and can never produce a content result.
afleet excludes full-text search by design (root spec §3, deferred in §17.8) — and that exclusion
costs **nothing** against canon. The gap users imagine here does not exist.

**GUI form.** Keep the sidebar and ⌘K as the two homes; `/resume` focuses ⌘K with its query
prefilled from the argument. Add five things, in value order.

1. **The filter row.** ⌘K gains three toggles — `This project` / `This branch` / `This worktree` —
   as a segmented row under the field, defaulting the way the terminal defaults (projects
   restricted, branches unrestricted, worktree restricted). Keep the terminal's *label pairs* as
   tooltips, since they name what the toggle will do rather than what it is doing.
2. **The description line, verbatim.** Each row's second line becomes the terminal's own
   `<relative time> · bg · <branch> · <size> · #<tag> · @<agent> · <repo>#<PR>`, with the same
   ordering and the same ` · ` separator. This is the single cheapest fidelity win in the lane:
   afleet already has every field and shows two of them.
3. **Search over branch, tag and PR.** Extend the candidate list to `gitBranch`, `tag` and
   `pr #<n> <repo>`, matching the terminal's four match targets exactly. A pasted PR URL should be
   rewritten to `PR #<n> <repo>` before matching, as the terminal does.
4. **Fork-lineage grouping.** Sessions sharing a `sessionId` fold into one row with the
   ` (+N other sessions)` badge and a disclosure triangle. afleet's session store has no lineage
   axis today (the clone hit the same wall), so this is the one item gated on a store change.
5. **The count.** `⌘K` header shows `<n> of <m>` while filtered.

Rename in place is F-21; the preview is F-20.

```
┌ ⌘K ───────────────────────────────────────────────────────────────────────┐
│  ⌕ wave s                                             12 of 47            │
│  [This project] [ This branch ] [This worktree]                           │
│  ─────────────────────────────────────────────────────────────────────    │
│  ▼ wave s session truth                        (+2 other sessions)        │
│      3 hours ago · main · 412KB · #wave-s · @architect                    │
│    ▸ wave s session truth                                                 │
│        yesterday · engine-core · 88KB                                     │
│    somersault bl10 round                                                  │
│      2 days ago · bg · main · 1.2MB · SSFSKIM/somersault#13               │
│  ─────────────────────────────────────────────────────────────────────    │
│  ⏎ open   ␣ preview   ⌘R rename                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** *Drops:* the pagination scheme (a GUI list scrolls); the "current
session is sometimes missing" behaviour, which is a bug the GUI should not reproduce; the two
relative-time formats (one is enough). *Keeps:* the header count, all three filters and their label
pairs, the title-resolution precedence, the description line and its field order, all four badges,
the four search targets, the three empty states. *Gains:* filters and search compose live; the list
is always open rather than summoned.

**Open.** Fork lineage needs a session-store field afleet does not have. Worth it, or is a flat
list by `modified` enough? Owner's call — the terminal's own grouping exists because one file can
hold several leaves, which is a persistence detail afleet may not inherit.

### F-19 · `/resume` search mode

**Terminal.** Typing any unmodified printable character enters search seeded with it (SPEC 35.19.9);
`/` also enters search. The query is a plain case-insensitive substring test over **display title,
git branch, tag and PR identifier** — nothing else (SPEC 35.19.4). A pasted PR URL is rewritten to
`PR #<n> <repo>` before matching. The search footer differs from the list footer by a capital S:
`Type to Search · Ctrl+A to show all projects · Enter to select · Esc to clear`. `Esc` takes **two
presses** to leave search when there is text: the first clears the query, the second exits. In the
select layer, `j` and `k` navigate rather than typing, and digits `1`–`9` jump to that row while
`0` and out-of-range digits are swallowed as silent no-ops — an invisible binding, since the
expanded layout does not render numbers.

**Job.** Getting to one conversation out of hundreds by typing part of its name.

**Wire.** R, over the same on-disk enumeration as F-18.

**afleet today.** `built` and modeless — ⌘K is a search field first. Its candidate list is
`[title, cwd.lastPathComponent, gitBranch, agentName]` with fuzzy scoring and a recency tie-break
(`QuickSwitcherModel.swift:88`, `:139`). Against canon it *adds* fuzzy matching and the cwd, and
*misses* tag and PR.

**GUI form.** Keep afleet's modeless field — a search field that is always live is strictly better
than a mode, and the terminal's `j`/`k`-navigate-instead-of-type and swallowed-digit quirks are
consequences of modelessness being impossible in its select layer. Add the two missing match
targets and the PR-URL rewrite (F-18 item 3). Keep the double-Esc semantic in spirit: first Esc
clears the query, second closes the switcher — that is standard Mac behaviour and happens to match
canon exactly.

**Drops / keeps / gains.** *Drops:* the mode; the `j`/`k` and digit bindings; the two footers.
*Keeps:* the four match targets, case-insensitive substring semantics as a floor (afleet's fuzzy is
a superset), the PR-URL rewrite, the clear-then-close Esc ladder. *Gains:* modeless search, fuzzy
matching, cwd as a target.

**Open.** None.

### F-20 · The `/resume` preview — `Space` and the full-screen transcript takeover

**Terminal.** `Space` (or `Ctrl+V`) on a focused row opens a preview. In 2.1.263 this is **not** an
in-pane pane: the clone's `/resume preview body` row records, against canon re-cited at
`yvc L583551` with the takeover at `L584057-584059`, that canon **replaces the picker with a full
screen rendered transcript** under its own footer — no picker frame, no header row, no alt-screen —
forced to the detail-all projection, tail-anchored to
`budget = fullscreen ? min(200, overlayRows()) : 200` fed from twice that many raw messages, with
**no `↑ N more above` indicator, because canon has none here**. Strings: `Loading session…`,
`Enter to resume`, `Esc to cancel`, and a metadata line `<relative time> · <n> messages[ ·
<branch>]` (SPEC 35.19.8). The preview uses the `Confirmation` context, so `Enter` or `y` resumes
and `Esc` or `n` returns to the intact list. The clone verified the whole takeover and closed it
with an image-only session that previews `[Image #1]` and resumes with the loaded payload.

**Job.** Answering "is this the one?" without paying the cost of opening it — the question every
long session list creates.

**Wire.** R, from the transcript JSONL. README finding 20 is the relevant lever: `--session-mirror`
works on 2.1.259 and emits `transcript_mirror {filePath, entries}`, "so a GUI that renders from
transcript records can use one reducer for archived and live channels".

**afleet today.** `undesigned` as a preview. The sidebar shows a one-line `row.preview`
(`SidebarView.swift:253`) and the switcher's second line is a directory. There is no way to look
inside a session before opening it.

**GUI form.** This is where the GUI most obviously exceeds the terminal, and it should not copy the
terminal's shape. The terminal takes over the whole screen because it has one; afleet has two
columns and a panel.

**Preview in place**: focusing a row in ⌘K (or hovering it in the sidebar) fills a **preview pane
beside the list** with the last N messages of that session, rendered through afleet's *real*
timeline renderer — the clone's finding is the load-bearing one here: its first attempt printed raw
persisted row text and leaked `<command-name>` and `<local-command-stdout>` envelope tags into the
preview, and the fix was to run the same projection the replay path uses. afleet must do the same:
the preview is the timeline, at a smaller budget, not a text tail.

Keep `Enter` to open and `Esc` to dismiss. Keep the metadata line `<relative time> · <n> messages ·
<branch>` verbatim — note it says **messages** where the list row says bytes, and both are worth
keeping because they answer different questions. Drop `Loading session…` in favour of a skeleton.

`[exceeds]` — the preview can be scrollable, can show images inline (the clone's `[Image #1]`
becomes a thumbnail), and does not have to replace the list.

**Drops / keeps / gains.** *Drops:* the full-screen takeover; the no-overflow-indicator rule; the
`y`/`n` confirmation keys. *Keeps:* `Space`/`Enter`/`Esc`, the metadata line, the detail-all
projection, the ~200-message budget as a default, the rule that the preview goes through the real
renderer. *Gains:* side-by-side, scrollable, images, no mode switch.

**Open.** Should hovering a sidebar row preview it, or only ⌘K focus? Hover-preview is powerful and
can be noisy.

### F-21 · `Ctrl+R` — rename a session from the picker

**Terminal.** `Ctrl+R` on a focused row enters rename mode: the header becomes `Rename session:`,
the input's placeholder is the focused session's display title (falling back to
`Enter new session name`), and the footer is `Enter to save · Esc to cancel` (SPEC 35.19.8). An
empty or whitespace-only value closes the editor without writing. The write is **not** `/rename`'s:
the picker calls `saveCustomTitle` directly, applying only `String.prototype.trim` — no
sanitisation, no uniqueness check, no session-registry update (SPEC 35.19.9). Two other sessions
can therefore end up with the same name.

**Job.** Naming the conversation you just found, at the moment you can see it is unnamed — which is
when you actually know what to call it.

**Wire.** **P**, and better than the terminal's own path: README finding 10 records
`generate_session_title {description, persist}` → `{title}`, and `rename_session {title}` (error
`title must be non-empty`) is the write.

**afleet today.** `undesigned` as an in-list action. Rename exists as `/rename`
(`RouterTable.swift:39`, `.renameSession`) and as a header menu item
(`HeaderMenus.swift:48`: `Button("Rename…") { model.isRenaming = true }`), but there is no
`contextMenu` in `SidebarView.swift` and no rename in ⌘K.

**GUI form.** Two entry points, both standard Mac and both matching where the user's attention is:
a **context menu** on any sidebar row (`Rename…`, plus `Open`, `Duplicate as branch` per F-24,
`Reveal transcript`, `Archive`) and **⌘R** in ⌘K on the focused row. Editing is in-place on the row
label, committed with `Return` and cancelled with `Esc` — the terminal's own two keys.

Fix the terminal's defect rather than copying it: use the `/rename` write path (F-23), so the name
is sanitised, checked for collision against live sessions and written to the registry. The terminal
has two rename paths with different guarantees only because they were built separately; a GUI has
no reason to reproduce that.

**Drops / keeps / gains.** *Drops:* rename *mode* and its header/footer; the unsanitised write.
*Keeps:* `Return`/`Esc`, the placeholder-is-the-current-title behaviour, the
empty-value-cancels rule. *Gains:* rename from the sidebar, collision handling, the AI-title
generator on the same menu.

**Open.** None.

### F-22 · The resume host screen and its refusals

**Terminal.** Resuming from the CLI (rather than mid-session) goes through a host screen with its
own strings (SPEC 35.19.8): `Loading conversations…`, `Resuming conversation…`,
`Failed to resume the conversation.`, `Run claude --resume <id> to retry, or claude to start a new
session.`, `Run claude to start a new session.` Three refusals matter:

- **Cross-directory:** `This conversation is from a different directory.` / `To resume, run:` /
  a constructed `cd <path> && claude --resume <id>` line / `(Command copied to clipboard)`.
- **Live background holder:** `That session is still running as a background session (<job>).` /
  `Run claude attach <job> to open it, or claude stop <job> first to resume it here.` /
  `To branch off a copy instead, run:` / ` claude --resume <id> --fork-session`, with a trailing
  dim `to branch off a copy.` when no job id is known.
- **Ambiguity, from the slash command:** `Session <id> was not found.` and
  `Found <n> sessions matching <arg>. Please use /resume to pick a specific session.`

Other slash-command strings: `Failed to load conversations`, `Failed to resume conversation`,
`Failed to resume: <e>`, `Resume cancelled`, `No conversations found to resume.` The terminal title
while the picker is open is `claude · resume`.

**Job.** Explaining why a conversation will not open, and giving the exact command that would work.

**Wire.** R. The live-session registry (`~/.claude/sessions/`) is the source for the
background-holder refusal; the recorded `projectPath` is the source for the cross-directory one.

**afleet today.** `undesigned`. afleet launches engines itself and would hit both conditions —
opening a channel for a session another process holds, or one recorded in a different directory —
with no copy for either. The sidebar's Background section has `Adopt` and `Attach`
(`SidebarView.swift:305-308`), which is exactly the remedy the terminal describes in prose.

**GUI form.** These become **states of the channel, not screens**. Opening a held session shows a
**channel banner** (§2) reading `This session is running as a background job` with two buttons,
`Attach` and `Stop and open here` — afleet already has both verbs, so the terminal's two commands
become two clicks `[exceeds]`. A third button, `Open a copy`, performs the `--fork-session` branch
the terminal spells out.

The cross-directory case is not a refusal in afleet at all: a channel carries its own cwd, so
opening a session recorded elsewhere is legal. Show it as an informational banner
(`Recorded in ~/other/repo`) with `Open there` and `Open here` — and drop the constructed `cd … &&`
command and its `(Command copied to clipboard)` line entirely, since neither has meaning in a GUI.

Keep the failure strings as banner text: `Failed to resume the conversation.` and
`Failed to resume: <e>`. Drop the retry-command sentences.

**Drops / keeps / gains.** *Drops:* every "run this command" sentence; the clipboard copy; the
terminal title. *Keeps:* the three refusal *conditions* and their leading sentences, the ambiguity
messages (which map to a filtered ⌘K), `Resume cancelled`. *Gains:* Attach / Stop-and-open /
Open-a-copy as buttons; cross-directory ceases to be a refusal.

**Open.** None.

### F-23 · `/rename`

**Terminal.** `Rename the current conversation`, alias `name`, arg `[name]`, with `local-jsx` and
`local` forms (SPEC 35.20). With no argument it generates a name from the conversation; failing
that, `Could not generate a name: no conversation context yet. Usage: /rename <name>`. With an
argument it sanitises, and an all-invisible name yields `That name is empty once invisible
characters are removed. Usage: /rename <name>`. Teammates refuse:
`Cannot rename: This session is a teammate. Teammate names are set by the team leader.` Three
success forms: `Session renamed to: <name>`; the yield form
`Session renamed to: <name> ("<requested>" is held by another live session on this machine)`; and
`Session is named: <name> (a newer rename landed first)`. When the registry write fails, the
message is suffixed `. Other sessions may still show the old name: the session registry could not
be updated (run with --debug for the cause)`. An explicit rename injects a `<system-reminder>`
telling the model the user named the session, and a name collision produces the notice
`Another live session on this machine goes by "<a>", so this session is now "<b>". Use /rename to
pick a different name.` Two guards write nothing at all: a superseded rename and an unchanged name.

**Job.** Giving a conversation a name you will recognise in the list a week later — and, through
the system reminder, telling the model what the session is *about*.

**Wire.** **P.** `rename_session {title}` writes it (error `title must be non-empty`) and
`generate_session_title {description, persist}` → `{title}` produces the generated name (README
finding 10).

**afleet today.** `built`. `RouterTable.swift:39` routes `.renameSession` with
`"Renames the channel and the transcript's title."`, and the header menu has `Rename…`
(`HeaderMenus.swift:48`). What the built form loses: the no-argument **generate** path (afleet has
no caller for `generate_session_title`), all three success forms, the collision notice, and the
teammate refusal.

**GUI form.** Keep the route. The rename affordance (F-21) gains a **Suggest** button that calls
`generate_session_title` and fills the field — a GUI can offer the generated name for editing
rather than committing it, which is strictly better than the terminal's "type nothing and accept
whatever comes back" `[exceeds]`.

Collisions and supersessions become **row states, not messages**: when the engine yields a name, the
row shows the actual name with a small `⚠` and the tooltip carrying the collision sentence verbatim.
The registry-write-failed suffix becomes a warning icon with the same text. The teammate refusal
disables the rename affordance with its sentence as the reason.

The `<system-reminder>` stays on the wire and is never shown (lane B's rule).

**Drops / keeps / gains.** *Drops:* the three success messages as transcript lines. *Keeps:* every
refusal and collision string, the sanitisation, the generate path, the two silent guards. *Gains:*
a suggested name you can edit; collision state on the row instead of a message that scrolls away.

**Open.** None.

### F-24 · `/branch`

**Terminal.** `Create a branch of the current conversation at this point`, arg `[name]`
(SPEC 35.22.1). **It has nothing to do with git**: it copies the transcript into a brand-new
`<newSessionId>.jsonl`, rewriting every kept record with the new session id, a new `parentUuid`
chain, `isSidechain: false` and `forkedFrom: { sessionId, messageUuid }`. Titles are made unique by
appending ` (Branch)`, then ` (Branch 2)`, ` (Branch 3)`, choosing the lowest free integer. Success:
`Branched conversation<" name">. You are now in the new branch (session <id>). Use /resume <old>
("<oldtitle>") to return to the original, or run `claude -r <old>` in a new terminal.`, or the
non-resuming `Branched conversation. Resume with: /resume <id>`. Failures: `No conversation to
branch`, `No messages to branch`, `Conversation too long to branch through storage`,
`Conversation unreadable through storage`, `Branch could not be written through storage`,
`Failed to branch conversation: <e>`.

**Job.** Trying a different direction without losing the current one — and, per the coordinator
refusal in F-17, the *sanctioned* alternative to `/fork` when forking is unavailable.

**Wire.** **R, from disk** (`areas/03-49-35-…md`): copy the JSONL up to the chosen message and
launch with `--session-id`. There is no control request. tui-parity is blunt that this is one of the
"unreachable and trivially exceeded" cases.

**afleet today.** `undesigned` — `/branch` occurs zero times in the root design spec and is not in
`RouterTable.local`. The adjacent `/fork` is built (F-25) and does something different.

**GUI form.** A **`Duplicate as branch`** item on the sidebar row's context menu and in the channel
header menu, next to `Fork`. It creates a new channel from a copy of this conversation, named with
the terminal's own ` (Branch)` / ` (Branch <n>)` scheme, and **leaves the current channel where it
is** — that is the difference from fork, and the copy should say it: the new channel opens in a new
row while the old one keeps its place.

The success sentence collapses to a toast plus the new row: afleet does not need to tell the user
how to get back to the original, because the original is still in the sidebar. That is the single
biggest simplification in this sub-family. The five storage failures become an alert with the
verbatim string.

`[exceeds]` — branching from *a chosen message* rather than the current point is one click here
(F-27's rewind picker already selects a message), where the terminal only branches at the end.

**Drops / keeps / gains.** *Drops:* the whole success sentence and its `/resume` instructions.
*Keeps:* the ` (Branch <n>)` naming scheme, the five failure strings, the copy-not-move semantics.
*Gains:* branch-from-any-message; the original stays visible.

**Open.** Should `Duplicate as branch` copy the *whole* conversation or up to the selected message?
The terminal does the former only because it has no selector; afleet has one.

### F-25 · `/fork`

**Terminal.** Two commands share the name, selected by fleet enablement (SPEC 35.22.2). The **fleet
variant** — `Copy this conversation into a new background session and keep working here` — copies
the conversation into a new *background session* via `--resume <path|id> --fork-session
--session-id <uuid>`, with `keepParent: true`, so no `continued-in` record is written, the worktree
is not handed back and the child is not auto-renamed. Its four entry guards, in order:
`Forking is not available in coordinator sessions. Use /branch instead.`;
`Can't fork: session persistence is off, so the new session would have nothing to start from. Run
the task here, or fork from a session that saves its transcript.`;
`Can't fork: this session was started with launch flags (safe or bare mode, <flags>) that the copy
wouldn't inherit, so it would run with fewer restrictions than this session. Run the task here, or
start a session without those flags and fork from there.`; and
`Nothing to fork yet. Send a message first.` Downstream:
`Couldn't fork: <e>. This session is unaffected; try again.` and
`Couldn't fork — this conversation is still being saved. Try again in a moment.` The **legacy
variant** — `Spawn a background agent that inherits the full conversation`, arg `<directive>` —
spawns no process at all; it launches an in-process subagent and prints
`<glyph> forked <name> (<id-suffix>)`, with `Usage: /fork <directive>` and
`Cannot fork before the first conversation turn`.

**Job.** Handing the current conversation to something that keeps working while you keep working.

**Wire.** X as a command, **P as a mechanism**: `--fork-session` is a launch flag afleet controls
(`areas/03-49-35-…md` §35.5).

**afleet today.** `built`. §7.7: `| /fork | new channel with --fork-session |`;
`RouterTable.swift:50` routes `.lifecycle(.fork)` with `"Opens a new channel forked from this
session."` This is the closest afleet gets to canon in the whole lane. What it loses is the four
entry guards: afleet attempts the fork and discovers the problem afterwards.

**GUI form.** Keep the route and the header-menu item. Add the four guards as **pre-flight disabled
reasons** on the menu item and the confirm sheet, verbatim — three of the four name a condition
afleet can check before acting (coordinator mode, persistence off, launch flags), and the fourth
(no messages yet) is trivial.

Name the fork/branch distinction in the menu, because the terminal's two descriptions are the only
place it is explained: `Fork to a background session` (the copy keeps working on its own) versus
`Duplicate as branch` (a copy you switch to). Both descriptions are canon's own words.

The legacy variant's in-process subagent maps onto afleet's subagent surfaces (lane G), not onto a
new channel; it should not be conflated with the fleet fork.

**Drops / keeps / gains.** *Drops:* the legacy variant's console line. *Keeps:* the four guards,
both post-failure strings, the `keepParent` semantics (the parent keeps running and keeps its
worktree), both command descriptions as menu copy. *Gains:* guards before the action.

**Open.** None.

### F-26 · `/session`, `/recap`, and the `/tag` that is not a command

**Terminal.** Three small surfaces, each resolving differently.

`/session`, alias `remote`, `Show cloud session URL and QR code` — registered only in remote mode
and hidden unless the `fanout` capability is present (SPEC 28 §5). Class **X**; it is a cloud
bridge, ch. 37.

`/recap`, `Generate a one-line session recap now`, a `local` command with
`thinClientDispatch: "post-text"` (SPEC 28 §5). It is the manual trigger for the automatic
away-summary: the setting `awaySummaryEnabled` is documented as "When false, the session recap
(shown when you return after being away for 5+ minutes) is disabled" (SPEC 3, settings table), and
`/config` carries the row `Session recap` bound to it (SPEC 41.26's `recap` entry, label
`Session recap`).

`/tag` **is not a command in 2.1.263.** `tag` is a read-only session field — it appears in the
`/resume` row description as `#<tag>` and is one of the four search targets — with no writer in the
catalogue. The somersault clone ships a `/tag` of its own (its §5 row pairs `/rename` and `/tag`
with "SDK-native `renameSession`/`tagSession`"), which is a **clone invention, not canon**, and per
SHARED-BRIEF §5.4 does not carry.

**Job.** `/session`: getting a phone onto this conversation. `/recap`: catching up after stepping
away. `tag`: a second, coarser axis for finding sessions later.

**Wire.** `/session` X (cloud, out of afleet's scope). `/recap` **P** —
`areas/28-slash-commands.md`: "`| /recap | local | runs-as-text Y | send as text (post-text) |
One-line session recap | P |`". The tag field is R from the transcript metadata.

**afleet today.** All three `undesigned`; none occurs in the root spec or `RouterTable.local`.
`/session` is additionally `out-of-scope` — cloud sessions are excluded (§17.8).

**GUI form.**

- `/session` → `out-of-scope`. Its refusal line should say so rather than falling to the generic:
  `"/session shares a cloud session; afleet runs the engine on this machine."`
- `/recap` → keep the text route; it works. The **away-summary** behind it is the real surface and
  it is a GUI opportunity: tui-parity §7 notes that `away_summary` "has no host-focus source in the
  protocol; a GUI has one". afleet knows when its window lost and regained focus, so it can trigger
  the recap on actual return rather than on a five-minute timer, and render it as a **notice row**
  at the point the user left off. `[exceeds]`
- `tag` → surface the field. It is already in the `/resume` description line (F-18 item 2) and the
  search targets (item 3); add `Tag…` to the sidebar row's context menu **only if** a wire writer
  exists. Do not invent one: canon has no `/tag`, and the clone's is not evidence.

**Drops / keeps / gains.** *Drops:* `/session` entirely; any `/tag` write until a writer is found.
*Keeps:* `/recap` and its post-text route; the `Session recap` setting; the tag field as a display
and search axis. *Gains:* a recap triggered by real focus return.

**Open.** Is there a wire route to *write* a session tag? The inventory does not record one. A probe
would settle it, and the answer decides whether `Tag…` ships.

## F. Rewind: the message selector and the restore choices

### F-27 · The double-Escape gesture and the `Rewind` selector

**Terminal.** `/rewind`, aliases `checkpoint` and `undo`, is a `local` command whose **entire
module** is `onQueryEvent({ type: "open_message_selector" })` — arguments are ignored
(SPEC 15.12.8). The same dialog opens on a double-tap of Esc within the 800 ms default window, and
**the first press produces no visible change at all** (SPEC 42.21.3). Cloud sessions refuse with
`Rewind is not yet available in cloud sessions`.

The dialog's title is `Rewind`; its input guide advertises `enter` `continue` and `escape`
`cancel`; its empty state is `Nothing to rewind to yet.` The `MessageSelector` keyboard context is
active **only** when no restore is in flight, there is no error, no message is confirmed, and more
than one candidate exists. Rows are the session's user messages in transcript order, with an
italic `(current)` marker under the cursor at open, and a special first row
`/resume <id> (previous session)` when the session has a parent — verified at
`cli.pretty.js:498276`.

**Job.** Undo, at the granularity of a conversation turn. It is the only affordance that reverses
both what the model believes and what it wrote to disk.

**Wire.** **The dialog is X; the function is R.** `areas/28-slash-commands.md` on `/rewind`:
"Same inversion as `/reload-plugins`: command refused, control requests available. The GUI must
build the checkpoint browser." `open_message_selector` is dropped by the wire filter `Cu`
(SPEC 45.9.2), so both the command and the Esc-Esc gesture are unreachable to a host. The
**enumeration is the real gap** (`areas/22-47-40-…md`): `file_snapshot` is D — "What is missing is
the *enumeration* of which messages have checkpoints. Workaround: read the `file_snapshot` records
from the session JSONL, or attempt `rewind_files` with `dryRun` and treat the error as 'no
checkpoint here'." And README finding 8: **file checkpointing is off headless unless
`CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` is in the environment**; without it every
`rewind_files` answers `File rewinding is not enabled.`

**afleet today.** `built`, differently, and the difference is the biggest functional loss in the
lane. There is **no message selector**: grepping the Swift for `open_message_selector` or
`messageSelector` returns nothing, and Escape is bound only to interrupt
(`App/Composer/ComposerShortcuts.swift:26`: `case .interrupt, .stopEverything: .escape`). What
exists is **Edit** — an inline button on each rendered user-message row
(`App/Timeline/Rendering/Rows/MessageRows.swift:129-131`) driving
`App/Composer/EditAndRewind.swift`, whose own header says it plainly (line 9): "**This is not
`/rewind`.** The slash command is a strategy that also moves files; *Edit* is one
`rewind_conversation` through `LifecycleAPI.send(_:on:)` and nothing else. No `rewind_files` request
is emitted here in either direction, on either answer." Meanwhile `/rewind` **is** routed
(`RouterTable.swift:49`, `.rewind`) with a genuine three-way choice
(`CommandRouter.swift:200-205`: `cancel` / `conversationOnly` / `conversationAndFiles`) — but
**bare `/rewind` is a no-op**: `CommandRouter.swift:327` returns `.notARequest` without an argument,
and `.notARequest` is swallowed at `App/Composer/CommandRouting.swift:442`. So afleet has a restore
chooser with no way to name a target, and a target picker with no restore choices, and the two
never meet.

**GUI form.** Join them. The gesture is a **hover action on any user message row** — afleet's
existing `Edit` button becomes a two-item control, `Edit` and `Rewind…` — plus a **picker** for
users who want to scan: `⌘⇧Z` (or a `Rewind…` item in the channel header menu) opens a
**Rewind sheet** listing the session's user messages, newest last, with the same `(current)` marker
and the per-row summaries of F-28.

Do not reproduce double-Escape. Escape in afleet already means interrupt, canon's own first press
is a silent no-op that teaches nothing, and a Mac has a menu bar and a shortcut table. Say this as
a deviation: the gesture is dropped, the surface is kept.

Keep the four activation conditions as sheet states rather than as a silent disable: a restore in
flight shows progress, an error shows the error, and one-or-fewer candidates shows
`Nothing to rewind to yet.` verbatim.

The special `/resume <id> (previous session)` row maps to "open the parent session" and belongs
here only if afleet tracks fork lineage (F-18 item 4); until then, drop it.

**Drops / keeps / gains.** *Drops:* double-Escape; the `/resume <id>` lineage row; the arguments-
ignored quirk. *Keeps:* the title `Rewind`, `Nothing to rewind to yet.`, the `(current)` marker,
transcript order, the four activation conditions. *Gains:* rewind from the message you are looking
at, without a mode.

**Open.** The wire gap is real and blocking for the code half: file checkpointing requires
`CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` in the launched engine's environment. Does afleet set
it? If not, every code-restore option in F-29 is dead on arrival and the sheet should not offer
them. This is a one-line check and the highest-priority unknown in this lane.

### F-28 · The per-row dry-run summaries

**Terminal.** Each selector row carries a two- or three-line body whose second line is the
checkpoint's dry-run result, computed **before** anything is selected — verified at
`cli.pretty.js:498276`. The forms:

| Condition | Line |
|---|---|
| exactly one file changed | `` `<basename> ` `` followed by a `+A −R` stat element |
| more than one | `` `<N> files changed ` `` followed by `+A −R` |
| dry run clean | `No code changes` |
| no checkpoint at all | `⚠ No code restore` |

The somersault clone rebuilt this and recorded the mechanics its scorecard row *Rewind picker
anatomy* describes: the summaries are computed "**before** anything is selected (windowed,
sequential, each row lighting up as its dry run lands)". Two elements it could not reach were the
skipped-files sentence and the lineage row.

**Job.** Choosing *which* point to go back to, on the evidence of what going back would cost. Without
the per-row stat the list is a wall of prompts.

**Wire.** **R, composed from a P primitive.** `rewind_files {user_message_id, dry_run}` returns
`{canRewind, error?, filesChanged?, insertions?, deletions?, skippedLinks?}` (`areas/42-…md:373`),
which is exactly the four forms above — `filesChanged.length`, `insertions`, `deletions`, and the
`error` when there is no checkpoint. Because enumeration is D (F-27), the dry-run probe **is** the
enumeration: a host issues one dry run per candidate row and treats the error as "no checkpoint
here".

**afleet today.** `undesigned`. `rewind_files` has exactly one caller
(`CommandRouter.swift:329,347`, the `/rewind` strategy) and it dry-runs a single named target, not
a list.

**GUI form.** The sheet's rows carry the summaries verbatim, including the `⚠` glyph. The clone's
windowed-sequential loading is the right pattern and should be copied: issue dry runs for the
visible window only, in order, and let each row's summary appear as it lands, with a subdued
placeholder until then. Firing one request per message in a 400-message session would be absurd,
and the terminal does not do it either.

`[exceeds]` — hovering a row's stat shows the file list as a tooltip, and clicking it opens the
diff of what would be restored in the Source Control tab. afleet has a real diff viewer; the
terminal has a basename and two integers.

**Drops / keeps / gains.** *Drops:* nothing. *Keeps:* all four summary forms verbatim, the `⚠`,
the compute-before-selection behaviour, windowed sequential loading. *Gains:* file list on hover,
diff on click.

**Open.** None beyond F-27's environment question.

### F-29 · The restore choices and their consequence blurbs

**Terminal.** Selecting a row opens the option list, built as `Kn(codeRestorable)` where
`codeRestorable` is "file rewinding is available **and** the checkpoint diff lists at least one
changed file". With it true there are six options; with it false the two code options are absent
altogether (SPEC 15.12.8, SPEC 42.21.3):

```text
Restore code and conversation
Restore conversation
Restore code
Summarize from here
Summarize up to here
Never mind
```

`defaultFocusValue` is `both` when code is restorable and `conversation` otherwise. Alongside the
options sits an input: `{ type: "input", placeholder: "add context (optional)", initialValue: "",
allowEmptySubmitToCancel: true, showLabelWithValue: true, labelValueSeparator: ": " }`. The
consequence blurbs have exactly five arms:

| Option | Blurb |
|---|---|
| `summarize` | `Messages after this point will be summarized.` |
| `summarize_up_to` | `Preceding messages will be summarized. This and subsequent messages will remain unchanged — you will stay at the end of the conversation.` |
| `both`, `conversation` | `The conversation will be forked.` |
| `code`, `nevermind` | `The conversation will be unchanged.` |

The clone flagged the copy trap that follows: **`Restore code`'s explanatory line reads `The
conversation will be unchanged.`** — the option and its line are independent and trivially swapped
(Wave S). It also verified, against `cli.pretty.js L487190-208`, that upstream builds the option
list from code-restorability alone with **no anchor-shape gate anywhere**, so the option is offered
on the first message and prints "forked" for it too; its decision was "keep the copy, invent
nothing."

Diff-stat previews under the options: `The code will be unchanged.` (checkpoint missing or the code
toggle is off), `The code has not changed (nothing will be restored).` (dry run empty), and the
composed `The code will be restored <+A −R> in <files>.` where `<files>` is one basename,
`<a> and <b>`, or `<a> and <n − 1> other files`. And the standing warning recorded in
`areas/42-…md`: `Rewinding does not affect files edited manually or via bash.`

**Job.** Choosing *what* to undo — the model's memory, the files on disk, or both — with the
consequence stated before you commit.

**Wire.** **R, over three different mechanisms the host must compose itself**
(`areas/42-input-keybindings.md:373`, verbatim mechanism cell): "conversation → `rewind_conversation`;
code → `rewind_files {user_message_id, dry_run?}`; summarize → a user frame with
`summarize_metadata {messages_summarized, user_context?, direction: "from"|"up_to"}`. All six
options are reachable, but as **three different mechanisms** the GUI must compose itself."
`rewind_conversation` takes `target_message_uuid` — **not** `user_message_id`, a real trap — and
returns `{rewound, targetMessageUuid, prefillText, precedingAssistantUuid}`, accepting
`interrupt_if_running` (README finding 9).

One caveat on the summarize pair: `areas/13-10-23-…md` §13.A classes *initiating* a partial
compaction as **X** — "there is no control request that invokes partial compaction… The *outcome*
is visible (a `compact_boundary` with `trigger: "manual"`, `user_context` and `messages_summarized`
set), so a GUI can render a partial compaction produced elsewhere but cannot initiate one." That
contradicts the A-42 row's `summarize_metadata` frame. **Flagged as a spec defect below**; until it
is settled, treat the summarize pair as unverified.

**afleet today.** `built`, partially, in the wrong place. `RewindChoice`
(`CommandRouter.swift:200-205`) offers three of the six — `cancel`, `conversationOnly`,
`conversationAndFiles` — with a dry-run confirmation, matching §7.7's row exactly: "`rewind_files
{dry_run: true}` to preview; then `rewind_conversation`; then `rewind_files {dry_run: false}` only
when the conversation rewind was honoured and the user asked for the files too". Missing:
`Restore code` alone, both summarize options, the `add context (optional)` input, every consequence
blurb, and all three diff-stat previews. And, per F-27, nothing can reach it.

**GUI form.** The Rewind sheet's lower half, once a row is selected: a radio list of the options in
the terminal's exact order and wording, each with its consequence blurb below it in secondary text,
the diff-stat preview line under the code-bearing options, the `add context (optional)` field, and
the manual-edit warning as a persistent footnote.

Keep the availability rule verbatim — the two code options vanish (not disable) when there is no
restorable checkpoint — and keep the default focus rule (`both` when code is restorable, else
`conversation`). **Fix the copy trap**: `Restore code` should read `The conversation will be
unchanged; files return to this point.` The clone kept canon's line because it was building a
faithful clone; this study's stance is faithful-by-default-and-say-what-you-changed, and a blurb
that describes the option next to it is a defect, not a style.

Order the radio list as canon does but group visually: the three restores, a rule, the two
summarize options, and Cancel as the sheet's standard button rather than a list row (`Never mind`
is a list row only because a terminal list has no buttons).

`[exceeds]` — the diff-stat preview line becomes a link that opens the actual diff in the Source
Control tab before committing.

```
┌ Rewind ───────────────────────────────────────────────────────────────────┐
│  ▸ "add the band marker to the separator"          3 files changed  +41 −8│
│    "reconcile the two SDK adoptions"               No code changes        │
│    "start the bl10 round"                          ⚠ No code restore      │
│  ─────────────────────────────────────────────────────────────────────────│
│  ◉ Restore code and conversation                                          │
│      The conversation will be forked.                                     │
│      The code will be restored +41 −8 in Separator.tsx and 2 other files. │
│  ○ Restore conversation      The conversation will be forked.             │
│  ○ Restore code              The conversation will be unchanged; files …  │
│  ─────────────────────────────────────────────────────────────────────────│
│  ○ Summarize from here       Messages after this point will be summarized.│
│  ○ Summarize up to here      Preceding messages will be summarized. …     │
│  ─────────────────────────────────────────────────────────────────────────│
│  add context (optional)  [                                              ] │
│  Rewinding does not affect files edited manually or via bash.             │
│                                              [ Cancel ]  [ Rewind ]       │
└───────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** *Drops:* `Never mind` as a list row; the swapped `Restore code` blurb
(named deviation). *Keeps:* all six option labels, the availability and default-focus rules, four
of the five blurbs verbatim, all three diff-stat previews, the `add context (optional)` input and
its empty-submit-cancels behaviour, the manual-edit warning. *Gains:* the diff before committing;
visual grouping of three mechanisms.

**Open.** Does `summarize_metadata` actually initiate a partial compaction, or only describe one?
Two area files disagree (below). A probe settles whether the two summarize options ship at all.

### F-30 · Rewind outcomes: prefill, skipped links, and the fork fallback

**Terminal.** A conversation rewind returns `prefillText` — the rewound message's text, put back in
the composer so the user can edit and resend. A code restore that skipped paths for link safety
reports `Restored the code, but skipped <n> files: <reason>. Skipped files were left untouched —
run with --debug for the paths.`, where the reason is the shared constant `the tracked path is (or
became) a link or other non-regular file, its directory changed since the checkpoint, or its backup
could not be safely read` (SPEC 15.12.7). A restore that changed nothing while at least one file
failed is an **error**, not a silent success: `No files were restored: <n> files failed (backup
missing, or the file could not be updated)[, and <n> paths were skipped for link safety]`. Below
that sit sixteen `detail` strings from the safety pre-check and the copier (`destination is a
symlink`, `destination is hard-linked (nlink=<n>)`, `parent directory moved (<a> != <b>)`,
`backup source became a symlink (O_NOFOLLOW)`, and twelve more).

**Job.** Telling the truth about a partial restore. A rewind that silently half-worked is worse
than one that failed.

**Wire.** P for the outcome — `rewind_files` returns `skippedLinks` — and P for the prefill
(`rewind_conversation` returns `prefillText` and `precedingAssistantUuid`, README finding 9). The
clone could not reach the skipped sentence because its own SDK surface returned `void`; the
control-request path does carry the count.

**afleet today.** `built`, and this is the part afleet does best.
`App/Composer/EditAndRewind.swift` prefills the composer with `prefillText` and — the good detail —
**refuses to clobber a draft the user typed while the request was in flight**
(`line 81: if draft == draftWhenAsked { draft = prefill } else { editNote = Self.typedAheadNote }`).
When the rewind is refused it opens a **fork from just before the target** instead, hands the
prefill to the sibling channel's composer, and explains itself in one of three sentences
(lines 166-170): `"The conversation was not rewound — the engine could not reach that message — so
a fork was opened from just before it instead."`, `"…a later turn arrived that afleet had not shown
yet…"`, and the default `"The conversation was not rewound, so a fork was opened from just before
that message instead."` That fallback has no terminal equivalent: canon simply refuses.

**GUI form.** Keep all of it. Extend it three ways.

1. **Carry the skipped-links outcome.** When a code restore reports `skippedLinks > 0`, show the
   terminal's sentence verbatim as a notice row — but replace `run with --debug for the paths` with
   the paths themselves, which the GUI can list. `[exceeds]`
2. **Carry the no-files-restored error** as an alert, verbatim, with the sixteen `detail` strings
   available behind a disclosure. These are the strings that explain *why* a rewind did nothing,
   and today afleet would show nothing at all.
3. **Keep the fork fallback and generalise it.** It is the single best deviation from canon in the
   built app: instead of an error, the user gets a working copy at the right point. Apply it to the
   Rewind sheet too, so a refused restore from the picker offers `Open a copy from here` rather
   than just reporting a refusal.

**Drops / keeps / gains.** *Drops:* `run with --debug for the paths`. *Keeps:* the prefill and its
typed-ahead guard, the skipped sentence and its constant, the no-files-restored error, the sixteen
details, the fork fallback and its three sentences. *Gains:* actual paths; the fallback offered
from the picker too.

**Open.** None.

### F-31 · Rewind refusals — the eight strings, and the four file errors

**Terminal.** Two disjoint failure vocabularies, and conflating them is the trap.

`rewind_conversation` refuses with a small set of `error` values. `areas/42-input-keybindings.md`
line 372 lists **eight** and instructs a host to render them: `commands queued`, `prompt pending`,
`turn running`, `target not found`, `stale target`, `unseen later turn`, `poll tool_result target`,
`delivered poll events in range`. `areas/03-49-35-…md` §35.7 lists **ten**, adding
`failed to persist rewind anchor` and `state changed`. The top-gaps entry summarises the class:
"All reachable; none composed for you. Plus / eight distinct refusal strings to render."

`rewind_files` refuses with four entirely different strings (SPEC 15.12.8):
`File rewinding is not enabled.`, `No file checkpoint found for this message.`,
`rewindFiles: no turn received yet`, and `Rewind is not yet available in cloud sessions`. The
inventory notes explicitly that there is **no** `Checkpointing is not available…` string anywhere in
the corpus — a plausible-sounding invention to avoid.

One structural fact from the clone's Wave S: **a manual `/compact` destroys rewind anchors, and
that is correct.** Probe 68e measured a four-anchor session dropping to one after compaction, and
not one of the four surviving — "the model no longer holds those turns, so offering to rewind to
one would be an offer to restore a conversation nobody has." A GUI that keeps stale anchors after
compaction is lying.

**Job.** Saying why the undo did not happen, in language that distinguishes "try again in a moment"
from "this will never work here".

**Wire.** P — these are the control requests' own `error` values.

**afleet today.** `undesigned` for the copy. The mechanism exists
(`CommandRouter.swift:326-349` reads the answers) and the fork fallback (F-30) handles the
conversation refusals gracefully, but not one of the twelve strings has afleet copy, and the
`rewind_files` refusals in particular would surface as nothing.

**GUI form.** A refusal table, one line of afleet copy per error value, rendered in the Rewind
sheet under the action button rather than as a transcript message — the user is looking at the
sheet when it happens. Group them by what the user should do:

| Class | Errors | afleet copy shape |
|---|---|---|
| transient — retry | `commands queued`, `prompt pending`, `turn running` | "…is busy. The rewind will run when the turn finishes." with a Retry button, or offer `interrupt_if_running` as "Interrupt and rewind" |
| stale view — reload | `stale target`, `unseen later turn`, `state changed` | "The conversation moved since this list was built." with a Refresh button |
| not found | `target not found`, `poll tool_result target`, `delivered poll events in range` | disable the row rather than fail on click |
| persistence | `failed to persist rewind anchor` | show verbatim; it is a real disk problem |
| files off | `File rewinding is not enabled.` | the *actionable* one — it means the engine was launched without checkpointing; the copy should say afleet can enable it and restart the channel |
| no checkpoint | `No file checkpoint found for this message.` | already covered by the row's `⚠ No code restore` (F-28); never reached from a well-built list |
| cloud | `Rewind is not yet available in cloud sessions` | out of scope for afleet |

And: **drop anchors on compaction.** When a `compact_boundary` arrives, every rewind target before
it becomes unavailable, and the sheet says so once rather than failing per row.

**Drops / keeps / gains.** *Drops:* raw error tokens as user-facing text. *Keeps:* all twelve error
values as the taxonomy, the compaction-destroys-anchors rule, the distinction between the two
vocabularies. *Gains:* `interrupt_if_running` offered as a button; a self-healing "enable
checkpointing and restart" path.

**Open.** Eight strings or ten? Two area files disagree (below), and the two extra ones are worth
copy if they are real.

## G. Diff and export — the command surfaces

Lane B owns diff *rendering* and clipboard copy. These two cards own what the commands offer.

### F-32 · `/diff` — two renderings, one command

**Terminal.** `/diff` is `local-jsx` with a **description getter** that has two values
(SPEC 15.13.1): `Toggle the diff panel showing uncommitted changes` when not remote, the
`tengu_jazzy_ripple` kill switch is off and the surface supports the panel; otherwise
`View uncommitted changes and per-turn diffs`. There is no `argumentHint` and no `aliases`, and
**anything typed after `/diff` is discarded** — the module never reads the argument string.
`immediate` is true only when the presentation is `fullscreen`.

Branch A, the **sidebar panel**, toggles a REPL tab and renders nothing itself; its three guard
messages are `The diff panel isn't available right now — run /diff again to see your changes`,
`The diff panel shows git changes — the current directory isn't in a git repository`, and
`Resize your terminal to at least 110 columns to show the diff panel`
(`DIFF_SIDEBAR_MIN_COLS = 110`, auto-open at 144). Its base mode is one of `session`,
`uncommitted`, `branch`, persisted as `diffSidebarBaseMode` and cycled with `ctrl+x b`.

Branch B, the **`DiffDialog` modal**, is a tabbed view with a `Current` tab plus one `T<n>` tab per
turn. Its strings: `No changed files`, `untracked`, `Binary file`, `Large file modified`,
` (truncated)`, `No file changes in this turn`, `No changes yet`,
`Too many files to display details`, `Loading diff…`, `Turn <n>`, `Staged and new files`,
`Branch changes`, `Uncommitted changes`, `(no commits yet)`, `(vs <baseBranch>)`,
`(git diff HEAD)`, and the dismissal `Diff dialog dismissed`.

The plumbing shells out to `git` read-only with `--ignore-submodules=all` on every invocation, and
caps at 5 s, 50 per-file stat entries, 500 untracked files scanned, 1 MB per file, 400 hunk lines
per file, and 500 files before falling back to shortstat only. It **refuses to run mid-merge or
mid-rebase**, checking `MERGE_HEAD`, `REBASE_HEAD`, `CHERRY_PICK_HEAD` and `REVERT_HEAD`.

**Job.** Seeing what changed — right now, over this turn, or against the branch base — without
leaving the conversation.

**Wire.** **P for the data, R for the panel, X for the command** (`areas/28-slash-commands.md`).
`get_workspace_diff` returns
`{diff: {stats: {filesCount, linesAdded, linesRemoved}, perFileStats[…], hunks, skippedLarge,
restricted, source}}`, and the inventory reads the command's `thinClientDispatch:
"control-request"` as "the CLI telling a GUI what to do instead". One documented **D**: the three
base modes are unreachable — "`get_workspace_diff` takes **no mode argument**", so
`session` / `uncommitted` / `branch` cannot be selected over the wire.

**afleet today.** `undesigned` as a command — `/diff` occurs zero times in the root spec and is not
in `RouterTable.local`, so it routes as text and is refused. But the **destination exists**: the
panel column already has a `sourceControl` tab
(`Workbench/Sources/PanelHostAPI/PanelTabID.swift:6`).

**GUI form.** `/diff` focuses the **Source Control tab**. That is the whole command: the terminal's
two renderings exist because a terminal must choose between a sidebar and a modal, and afleet has
had the sidebar since C7.

What the Source Control tab should take from the two renderings:

- **The three base modes as a segmented control** — `Session`, `Uncommitted`, `Branch` — with the
  terminal's own header captions as the mode readback: `Uncommitted changes`, `Branch changes`,
  `(vs <baseBranch>)`, `(git diff HEAD)`, `(no commits yet)`. Because the wire carries no mode
  argument, afleet computes these itself from git, which it can do since it owns the working
  directory. Say that explicitly: this is a place the GUI must go around the protocol.
- **The per-turn tabs** as a filter, not tabs: a `Changes in this turn` toggle on the tab, and
  per-turn diffs reachable from the timeline row that made them (lane B). `Turn <n>` and
  `No file changes in this turn` are kept as copy.
- **All the truncation states**, verbatim: `Binary file`, `Large file modified`, ` (truncated)`,
  `Too many files to display details`, `untracked`, and both empty states. A real diff viewer still
  needs to say when it gave up.
- **The mid-merge refusal**, verbatim in spirit: a banner saying the repository is mid-merge or
  mid-rebase rather than showing a misleading diff.

Drop the `110 columns` guard and the `run /diff again` retry sentence — both are terminal geometry.
Drop `Diff dialog dismissed`.

`[exceeds]` — tui-parity §7 lists "a real diff viewer for `Edit`/`Write` with `structuredPatch`" as
a place the GUI exceeds the terminal, and the 1 MB / 400-hunk-line caps exist because an 80-column
pager cannot show more. A GUI can lift them.

**Drops / keeps / gains.** *Drops:* the two-branch split; the modal; the column guard; the
dismissal string; the arguments-discarded quirk. *Keeps:* the three base modes and their captions,
every truncation and empty-state string, the mid-merge refusal, the read-only git discipline.
*Gains:* one destination, real diffs, no caps.

**Open.** The base modes are computed host-side because the wire has no argument. Does afleet want
to shell out to git itself, or ask for a mode argument on `get_workspace_diff`? A protocol ask,
noted not designed.

### F-33 · `/export`

**Terminal.** `Export the current conversation to a file or clipboard`, arg `[filename]`
(SPEC 35.21). With an argument it writes straight to that path and prints
`Conversation exported to: <path>`; with none it opens a small dialog. The dialog's strings:
`Export conversation`, `Select export method`, `Copy to clipboard` /
`Copy the conversation to your system clipboard`, `Save to file` /
`Save the conversation to a file in the current directory` (or
`Save the conversation to a file in the directory claude was launched from` in a remote workspace),
and `Enter filename:`. Results: `Conversation copied to clipboard`,
`Conversation exported to: <path>`, `Failed to export conversation: <e>`, `Export cancelled`.

**The format is plain text and only plain text.** The export renders the transcript through the same
renderer the detailed-transcript view uses, concatenates the static frames with no separator, and
strips ANSI. There is **no JSON and no Markdown option**. The default filename is
`<YYYY-MM-DD-HHMMSS>-<slug>.txt`, the slug being the first user message's first line, truncated to
49 characters plus `…` only when it exceeds 50, then lower-cased and reduced to `[a-z0-9-]`;
an empty slug yields `conversation-<stamp>.txt`. A path with no extension gets `.txt`.

**Job.** Getting the conversation out — into a bug report, a document, a colleague's inbox.

**Wire.** **R, from disk; no control request** (`areas/03-49-35-…md`). tui-parity §7 names it
directly as a place the GUI wins: "**real export formats instead of `/export`**", and §5 groups it
with the "unreachable and trivially exceeded" set.

**afleet today.** `undesigned`; zero mentions in the root spec, not in `RouterTable.local`. The
somersault clone shipped `exportMarkdown` instead — "prompts as `## ›` headings, tools as one-line
markers" — which is a clone invention, not canon, and is evidence only that the file is easy to
produce.

**GUI form.** A **Share / Export sheet** from the channel header menu and `⇧⌘E`, keeping the
terminal's two destinations as the top-level choice (`Copy to clipboard`, `Save to file`) and its
default filename scheme verbatim — the date-stamp-plus-slug convention is genuinely good and users
will have files named that way already.

Then exceed it, because this is the clearest low-cost win in the lane. Offer a **format** control
with `Markdown` as the default, `Plain text` as canon's own format, and `JSON` (the transcript
records). Markdown is the format the conversation is *already in* — afleet renders Markdown in the
timeline — and plain text throws that away. Include an `Attachments` toggle: afleet has images the
terminal could only render as placeholders, and an export that silently drops them is worse than
the terminal's.

Keep all four result strings. Replace `Failed to export conversation: <e>` with the same text plus
a Reveal-in-Finder affordance on success.

**Drops / keeps / gains.** *Drops:* the plain-text-only constraint; the "current directory" versus
"launched from" wording (a Mac save panel has no such ambiguity). *Keeps:* both destinations and
their descriptions, the filename scheme, all four result strings, `Enter filename:` as the save
panel's default name. *Gains:* Markdown and JSON, images, a save panel.

**Open.** Should export cover a message range (from the rewind selector's message list) rather than
the whole conversation? The terminal cannot; afleet already has the selector.

## H. Scheduling: loops, goals and workflows

### F-34 · `/loops`

**Terminal.** `List, create, and delete loops`, `immediate: true`, and **`isEnabled: () => !1` — a
constant false, so the command is unreachable in 2.1.263** (SPEC 22.20). Its implementation is
complete and lazily loadable, and it is the only surface that shows cron jobs and Stop-hook goals
together. Two screens: `Loops` (subtitle `Recurring crons and stop-hooks active for this session`)
and `New loop`. List keys `↑`/`↓` select, `d` delete, `n` new, `escape` close; empty state
`No active loops`. Cron rows render `<human schedule> · <prompt truncated to 50> · <id>`; goal rows
render `goal: <condition truncated to 50> · stop-hook`. The create screen is an `every` / `until`
radio pair, an `Interval >` field (12 columns, placeholder `10m`) shown only in `every` mode, and a
`Prompt   >` / `Condition>` field (placeholder `e.g. /babysit-prs` or
`e.g. tests pass and PR is merged`). Its keys are unusual: `tab`, and `←` at offset 0 or `→` at end
of text, all **toggle the mode** rather than moving between fields; `↑`/`↓` switch fields and only
in `every` mode; `Enter` in the interval field advances focus, and only `Enter` in the prompt field
creates. Messages: `Loop <id> deleted`, `Failed to delete loop <id>: <e>`, `Stop hook cleared`,
`Stop hook not found`, `Invalid interval: <text>`, `Loop <id> created (<human>)`, `Stop hook set`.

**Job.** Seeing and controlling everything that will make this session act again without you —
scheduled jobs and stop conditions — in one list.

**Wire.** **X.** `areas/22-47-40-…md`: "`isEnabled: () => !1` — unreachable … and absent from the
live 2.1.259 command list. Its implementation is complete … It is the only surface that would have
shown cron jobs and goals together. **A GUI should build exactly this panel.**" That last sentence
is the inventory's own recommendation, not mine.

**afleet today.** `undesigned`; not in `RouterTable.local`, and `/loops` was refused live
(`evidence/2026-09-03-slash-commands-headless.md:48`).

**GUI form.** Build it, as a **Scheduled section in the Activity view** — Activity is already the
cross-channel view of things that happen without you watching. One list, two row kinds, using the
terminal's own row grammar: `<human schedule> · <prompt> · <id>` for crons and
`goal: <condition> · stop-hook` for goals, with a per-row delete.

The create form becomes a small sheet with a real segmented control for `every` / `until` — the
terminal's tab-toggles-mode-but-arrows-switch-fields scheme is a workaround for having no pointer
and should not be reproduced. Keep both placeholders (`10m`, `e.g. /babysit-prs`,
`e.g. tests pass and PR is merged`) and `Invalid interval: <text>`, which is the only validation
message.

This card is `undesigned` in afleet and *unreachable* in canon, which makes it the clearest case in
the lane of the GUI shipping something the terminal has but cannot show. Priced accordingly: the
data is a cron store plus the session hook registry, both host-side.

**Drops / keeps / gains.** *Drops:* the create screen's key scheme; the two-screen split. *Keeps:*
both row grammars, both placeholders, the seven result messages, the empty state, the subtitle's
promise that crons and stop-hooks live together. *Gains:* a surface canon compiled in and switched
off.

**Open.** Does afleet want a scheduler at all, or is this out of scope until the fleet story lands?
It touches lane G.

### F-35 · `/goal`

**Terminal.** A goal is a session-scoped `Stop` hook of type `prompt` whose prompt is the user's
condition; the end-of-turn hook runner asks a model whether it holds and blocks stopping until it
does (SPEC 22.21). Two descriptors: `local-jsx` `Set a goal Claude checks before stopping`, arg
`[<condition> | clear]`; and `local` `Set a goal — keep working until the condition is met`, hidden
while interactive.

Two gates, verbatim: `/goal is only available in trusted workspaces. Restart, accept the trust
dialog, and try again.` and `/goal can't run while hooks are restricted (disableAllHooks or
allowManagedHooksOnly is set in settings or by policy).` The condition is capped at 4,000
characters (`Goal condition is limited to 4000 characters (got <n>)`), and the clear aliases are
`clear`, `stop`, `off`, `reset`, `none`, `cancel`.

The panel, re-rendered on a 1 s timer, has three states: **Active** — title `<glyph> Goal active`,
subtitle `running <elapsed>[ · <n> turn(s)] · <n> tokens`, body `Goal: <condition>` and
`Last check: <reason>`, guide `/goal clear to stop early`; **Recently achieved** — title
`Goal achieved` in the success colour, subtitle `<duration> · <n> turn(s) · <n> tokens`, guide
`/goal <condition> to set another`; **Neither** — title `Goal`, body `No goal set`, hint
`/goal <condition> to set one`. Text-mode replies: `No goal set. Usage: /goal <condition>`,
`Goal active: <condition> (<not yet evaluated | N turn(s)>)` plus `Last check: <reason>`,
`Goal cleared: <condition>`, `Goal set: <condition>`. While a goal is active the status bar shows
an animated `/goal active` chip with the elapsed time. Setting a goal also injects a long kickoff
meta message instructing the model to start working toward it immediately.

**Job.** "Keep going until this is true" — the one control that changes when the model is allowed
to stop.

**Wire.** **P for the command, R for the panel, D for the live state.**
`areas/22-47-40-…md`: the `local` descriptor is `supportsNonInteractive: true` with
`thinClientDispatch: "post-text"`, and live it returned `No goal set. Usage: /goal <condition>`;
`/goal clear` is P; the panel-without-argument is R; the `active_goal` frame is **D**; `ProposeGoal`
is X (TTY-gated).

**afleet today.** `undesigned`. `/goal`'s single mention in the root spec is a probe note; it is
not in `RouterTable.local` and runs as text.

**GUI form.** Two pieces.

*Setting and clearing* → keep the text route; it works today and is P. The composer's `/` picker
carries the argument hint `[<condition> | clear]`, and both gate messages become inline refusals
above the field (afleet already has "inline refusal explanation above the field", §2) rather than
transcript text.

*The active state* → a **goal chip in the channel header**, next to the mode and effort readbacks —
the terminal puts it in the status bar for the same reason. The chip reads `Goal · <elapsed>`, and
its popover is the terminal's Active panel: `Goal: <condition>`, `Last check: <reason>`, the
turn and token counts, and a `Clear` button. The Achieved state becomes a timeline notice row
(`Goal achieved · <duration> · <n> turns`), which is where a completed thing belongs; the Neither
state simply means no chip.

Because `active_goal` is D, afleet must track the state from its own `/goal` sends and the
`goal_status` attachments in the transcript. Say that; do not assume a frame.

Do not render the kickoff meta message (lane B strips meta).

**Drops / keeps / gains.** *Drops:* the modal panel; the 1 s re-render; the Neither state's hint.
*Keeps:* both gate messages, the 4,000-character cap and its message, the six clear aliases, the
Active panel's four fields, the Achieved subtitle, the status chip. *Gains:* the goal visible in
the header at all times rather than when asked.

**Open.** `active_goal` being D means the chip can drift if a goal is set by something other than
afleet's own send. Acceptable, or worth a protocol ask?

### F-36 · `/workflows`

**Terminal.** `Browse running and completed workflows`, `immediate: true`, enabled only when
workflows are (SPEC 40.17.4). The list is titled `Dynamic workflows`, shows `<n> running` and
`<n> completed` counts, `▲ N more above` / `▼ N more below` scroll indicators, and the empty state
`No dynamic workflows in this session.` Keys: `↑`/`↓` select, `enter` view, `x` stop (running only),
`s` save, `escape` close. Loading shows `Loading dynamic workflow history…`; dismissal appends
`Dynamic workflows dialog dismissed`. History is merged with live `local_workflow` tasks,
deduplicated on `runId`, sorted newest first; a single item auto-opens the detail.

The detail view has three nested levels — `phases`, `agents`, `agent` — with a footer hint list
assembled from `<arrows> agent`/`select`, `j/k scroll`, `⏎ expand`/`collapse`, `x stop`,
`x stop workflow`, `r restart`, `p pause`/`p resume`, `f filter`, `esc back`, `s save`. New in
2.1.263 is the **agent-detail Outcome pane**: JSON outcomes are pretty-printed with syntax colours
and real line breaks, folding behind an expand toggle after 20 lines with the count line
` · <n> lines · ⏎ expand`; it refuses to render past 40 levels of nesting
(`JSON outcome nested past MAX_DEPTH`) or on an unrepresentable number
(`JSON outcome number not representable`), falling back to plain wrapping, and escapes control,
bidi-override and invisible characters back to `\uXXXX`. The Activity list above it is capped at
the last three tool calls with the header suffix ` · last 3 of <n> tool calls`. The save dialog is
titled `Save dynamic workflow`, subtitled `<Project|User> scope · <path>`, prompts `Save as:`, and
on collision prints `<path> already exists. Press Enter again to overwrite, or change the name.`

**Job.** Watching a multi-agent workflow run: which phase, which agent, what it produced, and the
ability to stop, pause, retry or save the whole thing as a reusable script.

**Wire.** **X for the dialog**, with a partial live path: `areas/22-47-40-…md` notes the live list
comes from `background_tasks` (`workflowProgress`), while **per-agent skip / retry / pause are D
with no workaround**.

**afleet today.** `undesigned`; not in `RouterTable.local`, no mention in the root spec.

**GUI form.** This is lane G's territory in substance — a multi-agent run is a fleet surface — so
this card proposes the *placement* and hands the detail over: workflows belong in the **Agents panel
tab** alongside F-09's Running section, with the list's `<n> running` / `<n> completed` counts and
its empty state kept verbatim, and the three-level detail (`phases` → `agents` → `agent`) as an
outline rather than nested boxes.

Three things are worth carrying specifically, because they are 2.1.263's own answers to problems a
GUI will hit:

1. **The Outcome pane's escaping rule.** Control, bidi-override and invisible characters escape to
   `\uXXXX` before rendering. An agent's outcome is untrusted text; canon treats it as such and so
   should afleet.
2. **The two refuse-rather-than-mislead guards** (`MAX_DEPTH`, unrepresentable number) — a viewer
   that silently truncates deep JSON is worse than one that says it will not render it.
3. **The save dialog**, verbatim: title, `<Project|User> scope · <path>` subtitle, `Save as:`, and
   the overwrite confirmation sentence.

Stop and pause map to buttons; **skip and retry must not ship** until the wire carries them (D, no
workaround) — offering a button that cannot act is worse than its absence.

**Drops / keeps / gains.** *Drops:* the nested-box drawing; the scroll indicators; the ten-item
footer hint list; skip/retry until the wire supports them. *Keeps:* the counts, the empty state,
the three levels, the Outcome pane's escaping and both refusal guards, the last-3-tool-calls cap
and its suffix, the whole save dialog. *Gains:* a persistent view of a long workflow.

**Open.** Lane G should own the detail design; this card asserts only that `/workflows` resolves to
the Agents tab and lists what must survive.

## I. Diagnostics, feedback and meta

### F-37 · `/doctor`

**Terminal.** `/doctor`, alias `checkup`, is **not code**: it is a bundled *prompt* command, one
large markdown template the model executes agentically (SPEC 49.19). "There is no Ink screen, no
keypress handling and no per-check gating in the harness; every 'skip' the text describes is an
instruction the model follows." Registration: `survivesBundledKillSwitch: true`,
`requires: { workspace: true }`, `terminalOriented: true`, `disableModelInvocation: true`,
`progressMessage: "running checkup"`, no `allowedTools` (unrestricted, unlike `/debug`). Its
`menuDescription` is `Health-check your setup and fix issues: installation, unused extensions,
duplicated or bloated memory files, slow hooks, updates, permissions`. The prompt runs ten checks —
setup health, unused skills/MCP/plugins, CLAUDE.md dedup, trimming derivable content, lazy loading,
slow hooks, context-heavy extensions, version, auto mode as default, and pre-approving frequently
denied read-only commands — and ends with a `## Report format` section. A user argument is appended
under the fixed heading `## Additional instructions from the user`.

**Job.** An audit that also proposes fixes. It is the only surface that turns configuration
findings into actions.

**Wire.** **P.** It is a prompt command; sending `/doctor` as text runs it. But README finding 17 is
the trap: "**`/doctor` runs as a prompt.** It is listed in `terminal_slash_commands` but on 2.1.259
it is a bundled skill; sent as text it went to the model, which answered from context. Hiding it is
the right call, but it is not a refusal." So the engine advertises it as terminal-only *and* runs
it — a host that trusts `terminal_slash_commands` will refuse a command that works.

**afleet today.** `undesigned` as a surface, and **wrongly refused as a command**.
`RouterTable.swift:95` carries a bespoke terminal-only reason —
`"/doctor draws the CLI's installation and health report on the terminal's own screen, which afleet
has no equivalent of yet."` — which fires when the engine lists `doctor` in
`terminal_slash_commands`. Against 2.1.259, evidence recorded the opposite:
`docs/tui-parity/evidence/2026-09-03-slash-commands-headless.md:57` — "`/doctor` (in
`terminal_slash_commands`) was NOT refused: it was echoed as a prompt-type command and the MODEL
answered it". afleet is blocking a command that runs, with copy describing a screen that does not
exist. **This is a live defect, not a gap.**

**GUI form.** Remove `/doctor` from `terminalOnlyReasons` and let it run as a prompt command
(F-15's pattern): a command chip, the progress message `running checkup` as spinner text, and the
report rendered as an ordinary assistant turn.

Then exceed it where the GUI can. `/doctor`'s findings are configuration problems, and afleet is
about to have a configuration surface (lane E's Settings › Claude Code). Each finding that names a
file or setting should be **actionable from the report**: a `Fix` button on a duplicated CLAUDE.md
finding opens the file in the Files tab, one on a "pre-approve these commands" finding opens the
Permissions pane with the rules staged. The terminal has to ask the model to do it; afleet can hand
the user the control.

**Drops / keeps / gains.** *Drops:* the terminal-only refusal (a defect). *Keeps:* the command as a
prompt, `running checkup`, the argument's fixed heading, the report format. *Gains:* findings that
link to the settings they are about.

**Open.** None — the refusal removal is a bug fix, and the rest is F-15's pattern.

### F-38 · `/debug`

**Terminal.** The second bundled prompt command in chapter 49, and unlike `/doctor` it has a **side
effect: invoking it turns debug logging on for the rest of the session** (SPEC 49.20). Registration:
`menuDescription: "Turn on debug logging and investigate problems"`,
`description: "Enable debug logging for this session and help diagnose issues"`, pinned
`allowedTools: ["Read", "Grep", "Glob"]`, `argumentHint: "[issue description]"`,
`disableModelInvocation: true`, and no `progressMessage`. The assembled prompt is headed
`# Debug Skill` and contains `## Debug Logging Just Enabled`, `## Session Debug Log` with a
`### Last 20 lines` block, `## Issue Description`, `## Settings`, `## Instructions`, and — when a
daemon is running — a `## Daemon` block with `### daemon.lock`, `### daemon.status.json` and
`### Daemon log (<path>)`. Constants: 20 log lines shown, a 64 KiB tail read for the session and
daemon logs, 8 KiB for the lock and status files.

**Job.** Turning on the recorder and handing the model the tail, so a vague "it's being weird"
becomes a diagnosable report.

**Wire.** **P.** Prompt command; sent as text it runs.

**afleet today.** `undesigned`; zero mentions, not in `RouterTable.local`, runs as text — which
means it already works. What is missing is any indication that debug logging is now **on**, which
is a state change with a cost.

**GUI form.** Let it run (F-15's pattern), and add the one thing the terminal lacks: a **debug
state readback**. Once `/debug` has run, afleet should show a small `Debug logging` indicator in
the channel Info popover (F-01) with a `Reveal log` action, because a user who turned logging on
three hours ago has no way to know. `[exceeds]` — the terminal announces it once in a prompt
heading the user may never read.

Add `Reveal debug log` and `Enable debug logging` to the Help menu, so the capability is reachable
without typing.

**Drops / keeps / gains.** *Drops:* nothing. *Keeps:* the command, the pinned tool list, the
argument hint. *Gains:* a visible on-state and a way to open the log.

**Open.** None.

### F-39 · The `/bug` dialog

**Terminal.** `/bug`, alias `share`, `Report a bug or share your conversation`, arg `[report]`;
`/feedback`, `Send feedback to Anthropic or report a bug`, arg `[report]`. Neither has an
`isEnabled`; disablement is reported at invocation as a printed reason (SPEC 49.22.1-2). Mode is
chosen at invocation: **post** (first-party provider with credentials → upload), **bundle**
(third-party provider or no credentials → write a local zip), **disabled** (a kill switch or
policy → print the reason and stop).

The dialog is titled `Submit feedback / bug report` with states
`userInput → scope → consent → submitting → done`. Step 1 prompts `Describe the issue below:`; an
empty submit sets `Please describe the issue before submitting.`; any error adds
`Edit and press Enter to retry, or Esc to cancel`. Step 2 asks
`How much session history should we include?` with three options — `This session only`,
`This session + the last 24 hours`, `This session + the last 7 days` — skipped and pinned to
session scope in remote workspaces. Step 3 renders the mode's consent intro
(`This report will include:` / `An archive will be saved to disk containing:`), an indented bullet
list — `- Your feedback / bug description:`, `- Environment info:`, `- Remote workspace:`,
`- Git repo metadata:`, `- Session transcript:` — and the mode's footer
(`We may use these to debug related issues and improve Claude Code.` /
`Nothing leaves this machine until you send the bundle file. Secrets (API keys, tokens,
credentials) are redacted before writing.`). Submitting shows `Submitting report…` or
`Saving bundle…`. Cancelling yields `Feedback cancelled` or `Feedback / bug report cancelled`.

Four disabled reasons (`<cmd> has been disabled via the DISABLE_FEEDBACK_COMMAND environment
variable`, the `DISABLE_BUG_COMMAND` twin — **either variable disables both commands** — the
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` twin, and a long policy-404 sentence), plus three org
policy refusals and five runtime failures including
`Couldn't send feedback: not signed in. Run /login, then retry.` and
`Couldn't send feedback<detail>. If it keeps failing, you can file at
https://github.com/anthropics/claude-code/issues instead.`

**Job.** Reporting a problem with the evidence attached, having been told exactly what evidence is
being attached.

**Wire.** **R.** `areas/28-slash-commands.md` recovers the control request:
`submit_feedback {description, surface?, draft_id?, type?, title?, area?, attach_transcript?}` →
`{feedback_id, unavailable_reason?, is_zdr_org?, failure_reason?, status_code?, ccshare_url?}`,
classed **X (dialog) / R (function)** with an added **D + privacy** finding: "the non-draft path
always uploads `messages` regardless of `attach_transcript`". `feedback` is also one of the two
`HEADLESS_YIELDABLE_NAMES` a plugin may claim.

**afleet today.** `undesigned`; both commands are absent from the spec and the router.

**GUI form.** A **Report a Problem sheet** on the Help menu (`Help › Report a Problem…`), which is
where a Mac user looks, plus `/bug` and `/feedback` routing to it.

Keep the three-step flow as one scrolling sheet: description field, a scope segmented control with
the three option labels verbatim, and the consent block — **the consent block is the point of this
surface and must be reproduced exactly**: the intro sentence for the mode, the five labelled
bullets with their real values, and the mode footer. A GUI that replaces it with "we may collect
diagnostic data" has broken the surface.

The privacy finding changes one thing materially: because the non-draft path uploads `messages`
regardless of `attach_transcript`, afleet must not offer an "include transcript" toggle it cannot
honour. The consent block should state what is actually sent, and the D should be raised as a
protocol ask rather than papered over.

Keep the mode distinction visible: in bundle mode the primary button reads `Save bundle` and the
footer keeps `Nothing leaves this machine until you send the bundle file…`, ending with a
Reveal-in-Finder. Keep all four disabled reasons and the five runtime failures verbatim, and keep
the GitHub-issues fallback URL as a link.

**Drops / keeps / gains.** *Drops:* the four-state machine as visible steps; the `share` mode
(unreachable in 2.1.263). *Keeps:* every string above, the two modes, the three scopes, the five
consent bullets. *Gains:* a Help-menu entry point; Reveal-in-Finder on a bundle.

**Open.** The `attach_transcript` D is a genuine privacy question. Does afleet ship the toggle,
omit it, or ask for the protocol fix first? Owner's call.

### F-40 · The `/feedback` draft panel, the notice card and the footer counter

**Terminal.** A distinct surface from F-39. When drafts are enabled and `/feedback` is typed with no
argument, a panel opens instead of the dialog (SPEC 49.22.12): title `Feedback drafts`, states
`list → review → submitting → receipt`, rows grouped under `This session` and `Other sessions`,
each rendered `[<type>] <title>  <age> · <cwd> · <transcript available | transcript expired (report
only)>` with ages `<n>m`, `<n>h`, `<n>d` or `now`.

Two companions. A **footer counter**, always present when the session has queued drafts: a dim
`<n> feedback draft(s)`. And a **notice card** (SPEC 49.22.11) with the header
`<icon> <Bug report|Product feedback|Feature request> drafted: <title>`, a dim preview of at most
six rows, and an action line reading `1 → review`, `2 → send`, `0 → dismiss`, plus `+<n> more
queued`. Pressing `2` asks for confirmation with `Send without reviewing` and
`(full draft + env, no transcript)`. Dismissing can raise `Turn off Claude-drafted feedback?` until
two declines are recorded; accepting shows, for five seconds,
`Claude-drafted feedback is off. Turn back on in /config`.

**Job.** Claude noticed something was broken and wrote the report for you; this is where you review
and send it. It is the only place in the product where the *model* initiates a user-facing artefact
that needs consent.

**Wire.** R, over the same `submit_feedback` request, with `feedback_draft_queued` as a stdout
frame (`areas/28-slash-commands.md`).

**afleet today.** `undesigned`.

**GUI form.** The notice card is a **timeline decision card** — afleet has six decision-card kinds
already (§8.4) and this is exactly one: an assistant-initiated artefact awaiting a user verdict.
Keep the header format verbatim including the three type words, the six-row preview cap, and the
three actions as buttons (`Review`, `Send`, `Dismiss`) with the `+<n> more queued` suffix. Keep the
send confirmation's parenthetical `(full draft + env, no transcript)` — it is a consent statement.

The draft *panel* becomes a **sheet from the notice card's `Review`** and from Help › Report a
Problem…'s "Drafts" tab, keeping both group headers and the row format including the transcript
availability clause, which tells the user whether the report will still be useful.

The footer counter becomes a badge on the Help menu item, not a persistent chip — a queued draft is
not urgent.

Keep the turn-off question and its two-decline suppression rule verbatim; that is a
well-designed piece of consent hygiene and worth copying exactly, with `Turn back on in /config`
rewritten to name afleet's own settings location.

**Drops / keeps / gains.** *Drops:* the numeric key actions; the persistent footer chip; the 5 s
toast timing. *Keeps:* the card header format, the six-row preview, all three actions, the send
confirmation's parenthetical, both group headers, the row format and age formats, the turn-off
question and its decline rule. *Gains:* a real decision card; drafts reachable from a menu.

**Open.** None.

### F-41 · `/release-notes` and the startup update notice

**Terminal.** `/release-notes`, `View release notes`, always enabled and always visible
(SPEC 49.28.4). **Two sources that never meet**: the picker reads *only* the fetched cache
(`<configDir>/cache/changelog.md`, GET from `raw.githubusercontent.com`), while the startup notice
reads *only* an embedded snapshot compiled into the binary. With an empty cache the picker prints
one line and closes: `See the full changelog at:
https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md`. Otherwise: title
`Release notes`, subtitle `Select a version to view its notes.`, ten visible rows, a first option
`Show all` described `<n> versions`, then `Version <v>` described `<n> item(s)`. The chosen text is
appended as a notice, `Version <v>:` followed by `· <bullet>` lines; `Show all` joins the
per-version blocks **oldest first — the opposite order from the menu**.

The startup notice is not a list: it renders one bold sentence, `Updated to latest.` or
`Updated to latest. Got <n> features, <n> bugfixes and <n> other changes.`, over a dim hyperlink
line `code.claude.com/docs/en/changelog for details`. Bug-fix rollup entries contribute **zero** to
every count. It is suppressed for restored, background and teammate sessions, has no dismissal key,
and stamps `lastReleaseNotesSeen` even when the computed summary is empty. SPEC's own consequence
note: the embedded snapshot stops at `2.1.260` while the build reports `2.1.263`, so anyone
upgrading from `2.1.260`–`2.1.262` gets no notice at all while the key still advances.

**Job.** Knowing what changed in the tool you are using.

**Wire.** **R** (`areas/28-slash-commands.md`): "`get_binary_version` (verified live) gives the
version; the notes themselves ship in the package and can be read from disk." The upgrade *notice*
is **D** — "no frame carries any of it"; the workaround is `get_binary_version` plus
`~/.claude/.last-update-result.json`. tui-parity §7 names "a fetched changelog instead of
`/release-notes`" as a place the GUI exceeds the terminal, and §5 puts `/release-notes` in the
"unreachable and trivially exceeded" set.

**afleet today.** `undesigned`; zero mentions.

**GUI form.** A **What's New window** on the Help menu, and `/release-notes` opens it. It reads the
same fetched cache, rendering the changelog as Markdown with a version sidebar — which collapses
the picker, the `Show all` option and the reversed-order quirk into one scrollable document
`[exceeds]`. Keep the empty-cache fallback as a link, verbatim.

The startup notice becomes a **one-line banner in the sidebar footer** after a version change,
reading the terminal's own sentence (`Updated to latest. Got <n> features, <n> bugfixes and <n>
other changes.`) and opening What's New on click. Two canon behaviours to keep: the rollup entries
counting zero, and the suppression rules for restored/background sessions. One to fix: afleet
should compute the summary from the *fetched* changelog, not an embedded snapshot, which removes
the empty-notice defect canon has.

**Drops / keeps / gains.** *Drops:* the picker, `Show all`, the reversed ordering, the two-sources
split. *Keeps:* both notice sentences and their count grammar, the rollup-counts-zero rule, the
suppression rules, the docs URL and the GitHub fallback URL. *Gains:* a real changelog reader; a
notice that is never empty.

**Open.** None.

### F-42 · `/upgrade`

**Terminal.** `Upgrade to Max for higher rate limits and more Opus` — **unrelated to software
updates** (SPEC 49.28.1); `claude upgrade` is the one that installs a build. It opens
`https://claude.ai/upgrade/max?utm_source=claude_code&utm_medium=cli&utm_campaign=upgrade_command`
and starts a fresh login flow, printing `Starting new login following /upgrade. Exit with Ctrl-C to
use existing account.` An account already on the top Max tier is short-circuited with
`You are already on the highest Max subscription plan. For additional usage, run /login to switch to
an API usage-billed account.` If the browser will not open:
`Failed to open browser. Please visit <url> to upgrade.`

**Job.** Buying more capacity at the moment you run out of it.

**Wire.** **X** (`areas/28-slash-commands.md`, `areas/03-49-35-…md`), and in the "unreachable and
trivially exceeded" set.

**afleet today.** `undesigned`; zero mentions.

**GUI form.** Not a command surface at all — a **button on the rate-limit banner** and in
Settings › Claude Code › Account & Usage, reading `Upgrade plan`, opening the same URL with the same
campaign parameter in the Browser tab (afleet has one, §2) rather than the system browser. That
placement is the translation: the terminal makes upsell a command because it has no other place to
put it; a GUI puts it where the limit is being hit. Keep the already-on-top-tier sentence as the
button's disabled reason, and drop the browser-failure string (the Browser tab does not fail that
way).

The login restart is a real consequence and needs afleet's own confirmation copy — `/upgrade`
starting a fresh login is surprising, and the terminal warns about it.

**Drops / keeps / gains.** *Drops:* the command; the browser-failure string. *Keeps:* the URL and
its campaign parameter, the top-tier sentence, the warning that a new login starts. *Gains:*
placement at the moment of need.

**Open.** None.

### F-43 · `/version` and `/wellbeing` — compiled in, switched off

**Terminal.** Two commands present in the build and unreachable.

`/version` has **two definitions, both `isEnabled: () => !1`** (SPEC 49.28.3):
`Show this session's version (autoupdate may have a newer one)` and
`Print the version this session is running (not what autoupdate downloaded)`. Had the second been
reachable it would print `<version> (built <BUILD_TIME>)` — which differs from `claude --version`'s
`2.1.263 (Claude Code)`.

`/wellbeing`, aliases `breaks`, `break-reminder`, `downtime`,
`Configure optional break reminders and quiet-hours nudges`, is likewise `isEnabled: () => !1`, and
its module is a stub returning `Wellbeing settings are not available in this build` (SPEC 49.28.2).
The picker labels survive — reminder intervals `Off` / `Every 5 minutes` / `Every 15 minutes` /
`Every 30 minutes` / `Every 1 hour`, break thresholds `5 minutes` / `10 minutes` / `15 minutes` /
`30 minutes`, quiet hours `Off` / `22:00 – 07:00` / `23:00 – 06:00` / `00:00 – 07:00` — as does the
settings schema (`breakReminder.*`, `quietHours.*`) and the activity ledger
`<configDir>/active-time.json` that keeps a year of windows. No nudge is ever emitted.

**Job.** `/version`: identifying the build in a bug report. `/wellbeing`: not working through the
night.

**Wire.** Both **X**. `/version` is superseded — `areas/03-49-35-…md:178`: "Superseded by
`get_binary_version`" — and `areas/28-slash-commands.md:199` records `/wellbeing` as "Never
registered."

**afleet today.** `/version` `superseded`, `/wellbeing` `out-of-scope`, both per those rows.
`GetBinaryVersion` exists in afleet's wire types
(`ClaudeWire/Sources/WireFrames/OutboundRequests.swift:117`) and is **defined and never used**.

**GUI form.** `/version` → not a command. Its content belongs in the channel Info popover's
`Version` row (F-01) and in the standard **About afleet** window, which should name both the app
build and the engine build, since a user reporting a bug needs both. Call `get_binary_version`;
it is one line and the type already exists.

`/wellbeing` → `out-of-scope` for the engine's version of it, but the *ledger* is interesting and
this is worth one sentence rather than silence: `active-time.json` accumulates a year of activity
windows whether or not the feature ships, and a Mac app has `NSWorkspace` notifications and Focus
modes that the terminal does not. If afleet ever wants break nudges, canon's settings schema
(interval, threshold, quiet-hours start/end validated `HH:MM`) is a ready-made shape. Not a build
item; a note for the backlog.

**Drops / keeps / gains.** *Drops:* both commands. *Keeps:* the version string's two components in
About; the wellbeing schema as a reference. *Gains:* engine build visible without a command.

**Open.** None.

### F-44 · `/init` and `/import`

**Terminal.** `/init` is a **prompt** command whose description getter flips on
`CLAUDE_CODE_NEW_INIT` between `Initialize a new CLAUDE.md file with codebase documentation` and
`Initialize new CLAUDE.md file(s) and optional skills/hooks with codebase documentation`, with
`progressMessage: "analyzing your codebase"` (SPEC 28 §5, §25.1).

`/import`, `Import config from another AI coding agent`, arg `[codex|gemini] [--dry-run]`, gated on
`tengu_import`, has a `local-jsx` dialog and a `local` text form (SPEC 28 §5, 03 §18.5).

**Job.** `/init`: giving a repository its instructions file. `/import`: bringing another agent's
configuration across.

**Wire.** `/init` **P** — a prompt command; `areas/28-slash-commands.md` notes its
`progressMessage` "is client-side spinner text the GUI must supply itself", and records two prompt
bodies (a legacy one and a new eight-phase one behind the flag). `/import` **R** — "the dry-run
preview the dialog shows is not reproduced by the text variant", so a host that routes it as text
loses the preview.

**afleet today.** Both `undesigned`; zero mentions, neither in `RouterTable.local`, both pass
through as text.

**GUI form.** `/init` is F-15's pattern with one addition: afleet should supply the progress message
`analyzing your codebase` and, because `/init` writes a file, surface the written `CLAUDE.md` as a
click-through to the Files tab when the turn finishes. Offer it once, contextually — a project with
no `CLAUDE.md` gets a dismissible suggestion in the new-channel state rather than a command the
user must know about `[exceeds]`.

`/import` is the more interesting one because of the dry-run gap: routed as text, afleet gets the
import without the preview, which is the wrong default for a command that writes configuration. The
GUI form is an **Import sheet** in Settings › Claude Code, listing what would be imported with a
per-item checkbox — the dialog's dry-run made visible and made selective. Until that exists,
afleet should route `/import` with `--dry-run` appended and show the result, rather than silently
applying.

**Drops / keeps / gains.** *Drops:* nothing. *Keeps:* both `/init` descriptions and its progress
message, `/import`'s argument grammar and its dry-run preview. *Gains:* a contextual `/init`
suggestion; a selective import.

**Open.** Which `/init` body does afleet's engine use? The eight-phase one behind
`CLAUDE_CODE_NEW_INIT` produces skills and hooks as well as a memory file, which changes what the
click-through should point at.

### F-45 · `/exit`

**Terminal.** `local-jsx`, aliases `quit`, with a **description getter**: `Detach from this
background session (it keeps running)` when the session is backgrounded, else `Exit the CLI`
(SPEC 28 §5). Marked `terminalOriented` and `fleetHostCall`. Two meanings, one name — and the
getter is the only place the difference is stated.

**Job.** Leaving. In a background session, leaving *without* stopping the work.

**Wire.** **T**, with the mechanism `end_session` (`areas/28-slash-commands.md`).

**afleet today.** `undesigned`; zero mentions.

**GUI form.** `superseded`. Closing a channel window or quitting the app is the GUI's exit, and it
already distinguishes the two cases: closing an attached channel detaches (the job keeps running,
and the sidebar's Background section shows it with `Attach`), while quitting the app ends what it
owns. The terminal needs a command because a terminal has no window chrome.

One thing to carry: the getter's **copy** is the clearest statement in canon of the detach-versus-
end distinction, and afleet's close-channel confirmation should use it —
`This background session keeps running; you can attach again from Background.` Typing `/exit` should
close the channel, not be refused.

**Drops / keeps / gains.** *Drops:* the command as a surface. *Keeps:* the detach-versus-exit
distinction and its wording. *Gains:* the distinction expressed by window behaviour rather than by
a description getter nobody reads.

**Open.** None.

## Ranking input

| Card | Surface | afleet status | User value | Build cost | Depends on |
|---|---|---|---|---|---|
| F-01 | `Status` tab / channel Info popover | undesigned | med — identity and health, mostly for support | M — popover + Settings pane + Activity rows | E-01 (Settings section), F-02 |
| F-02 | `Usage` tab — limits, session cost, contributors | routed-only | **high** — being cut off is the worst surprise the product has | M — `get_usage` is P; cost is D (text blob) | Settings › Account & Usage; a limit chip host |
| F-03 | `Stats` tab | undesigned | low — retrospective, partly a toy | S — read `stats-cache.json`, one chart | F-02's pane |
| F-04 | `/context` grid | routed-only (meter built) | **high** — the only attributable context budget | M — data is P; the grid is real drawing work | header meter (built), `get_context_usage` (called) |
| F-05 | `/context` Suggestions | undesigned | med — turns diagnosis into action | S — recompute from the same record | F-04 |
| F-06 | `/compact` progress + summary | routed-only (boundary built) | med — a long silent operation | S for the boundary disclosure; progress **blocked** on `compact_progress` (D) | timeline row builders |
| F-07 | `/autocompact` | undesigned | med — the setting that most changes long sessions | S — one Settings row via `apply_flag_settings` | E's Settings pane; F-04's meter |
| F-08 | `/clear` | built (route + reset) | low — works; only the copy is missing | S — one notice row | `conversation_reset` reducer |
| F-09 | Background dialog list | routed-only, **no screen** | **high** — §7.7 promises it; nothing is there | M — registry mirror + `stop_task` | lane G (Agents tab ownership) |
| F-10 | Task detail sub-views | undesigned | med — output without foregrounding | M — per-kind panes | F-09 |
| F-11 | Remote-Control variant | out-of-scope (adopt its stop) | low as a variant, **high as a rule** | S — two-phase stop in F-09 | F-09 |
| F-12 | `/background`, `/stop` | built | med — the `/stop` name collision misleads | S — guards + naming | header menus (built) |
| F-13 | `/help` dialog | undesigned | **high** — a user asking for help is told there is none | M — command picker + shortcuts window | composer `/` picker; keybinding table |
| F-14 | Lazy-dialog failure strings | built (mechanism), copy missing | **high** — ~40 commands share one false sentence | S — writing, no new widget | every card in this lane supplies a destination |
| F-15 | Pass-through prompt commands | routed-only | med — chrome around a working route | S–M — chip, spinner text, tool badge | lane B (tag stripping) |
| F-16 | Stacked commands | undesigned | low — works by accident today | S — three strings + chips | F-15 |
| F-17 | Coordinator-mode refusals | undesigned | low — no coordinator in afleet yet | S — one collapsed notice row | lane G |
| F-18 | `/resume` picker list + filters | routed-only (switcher unreachable) | **high** — the sidebar is the app's spine | M — filters and description line are cheap; lineage grouping is not | tech-debt 207; session store (lineage) |
| F-19 | `/resume` search | built (metadata-only) | med — two missing match targets | S — add tag and PR | F-18 |
| F-20 | `/resume` preview | undesigned | **high** — "is this the one?" is the list's whole problem | M — must go through the real renderer | timeline renderer; `transcript_mirror` |
| F-21 | `Ctrl+R` rename in place | undesigned | med — naming at the moment you can see it is unnamed | S — context menu + ⌘R | F-23's write path |
| F-22 | Resume host screen refusals | undesigned | med — silent failure otherwise | S — two banners over existing verbs | sidebar Adopt/Attach (built) |
| F-23 | `/rename` | built | med — loses generate, collision, teammate refusal | S — `generate_session_title` is P | F-21 |
| F-24 | `/branch` | undesigned | med — the sanctioned alternative to fork | M — transcript copy + new channel | F-27 (branch from a message) |
| F-25 | `/fork` | built | low — works; four guards missing | S — pre-flight reasons | header menu (built) |
| F-26 | `/session`, `/recap`, `tag` | undesigned (`/session` out-of-scope) | low–med — focus-triggered recap is a real gain | S | window focus events |
| F-27 | Rewind selector + gesture | built differently (Edit only) | **high** — undo is the highest-stakes affordance | M — sheet + hover action | **blocked:** `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` |
| F-28 | Per-row dry-run summaries | undesigned | **high** — without them the list is unusable | M — windowed sequential `rewind_files` dry runs | F-27 |
| F-29 | Restore choices + blurbs | built (3 of 6, unreachable) | **high** — three mechanisms, one decision | M — compose three requests | F-27, F-28; summarize pair unverified |
| F-30 | Rewind outcomes + fork fallback | built (best-in-lane) | med — carry skipped-links and the failure ladder | S — surface what the answer already carries | `EditAndRewind.swift` |
| F-31 | Rewind refusals | undesigned | med — twelve error values, no copy | S — a copy table | F-29 |
| F-32 | `/diff` | undesigned (tab exists) | med — Source Control tab needs the modes and states | M — modes computed host-side (wire D) | `sourceControl` tab; lane B |
| F-33 | `/export` | undesigned | med — cheap, visible, exceeds canon outright | S — sheet + three formats | timeline renderer |
| F-34 | `/loops` | undesigned (canon: unreachable) | low–med — the inventory recommends building it | M — cron store + hook registry | F-35; lane G |
| F-35 | `/goal` | undesigned | med — changes when the model may stop | S — text route works; chip + popover | header readbacks; `active_goal` is D |
| F-36 | `/workflows` | undesigned | med — lane G owns the substance | L — three-level detail | **lane G** |
| F-37 | `/doctor` | **wrongly refused** | med — it is a live defect | S — delete one dictionary entry | `RouterTable.terminalOnlyReasons` |
| F-38 | `/debug` | undesigned (works as text) | low–med — an invisible on-state | S — indicator + Reveal log | F-01 popover |
| F-39 | `/bug` dialog | undesigned | med — the consent block is the surface | M — sheet; privacy D unresolved | Help menu; `submit_feedback` |
| F-40 | `/feedback` drafts + notice card | undesigned | med — a model-initiated artefact needing consent | M — decision card + sheet | §8.4 decision cards; F-39 |
| F-41 | `/release-notes` + startup notice | undesigned | low–med — cheap and trivially exceeded | S — Markdown window + banner | `get_binary_version` |
| F-42 | `/upgrade` | undesigned | med — placed at the limit, it is the conversion point | S — a button | F-02's limit banner |
| F-43 | `/version`, `/wellbeing` | superseded / out-of-scope | low | S — one About row | `get_binary_version` (defined, unused) |
| F-44 | `/init`, `/import` | undesigned | med — `/import` writes config with no preview | S for `/init`; M for the Import sheet | E's Settings pane |
| F-45 | `/exit` | superseded | low | S — one confirmation string | close-channel behaviour |

## For the map

- **One widget carries a third of this lane: a header popover over a readback.** The context meter,
  the goal chip, the session Info popover and the cost block are all "a small persistent readback in
  the channel header that opens into the full surface on click". Building that pattern once — chip,
  popover, poppable-into-panel — pays for F-01, F-02, F-04, F-05 and F-35. The terminal has the same
  instinct (its status bar carries the goal chip and the context indicator) but cannot follow the
  click anywhere.
- **The Settings window is about to be overloaded, and this lane is half the reason.** Lane E adds a
  `Claude Code` section for `/config`, `/permissions`, `/mcp`, `/hooks`, `/skills`; this lane adds
  `Account & Usage` (F-02, F-03, F-42), `Auto-compact` (F-07) and `Import` (F-44). That is a
  four-pane section before anyone has argued about grouping. Worth settling the pane list across
  lanes E and F once rather than twice.
- **Three commands resolve to a destination that does not exist, and they are all in this lane's
  neighbourhood.** `RouterTable` routes `/tasks`, `/agents` and `/resume` to `.native("tasks")`,
  `.native("agents")` and `.native("switcher")`, and `SettingPickers.swift:492` accepts only
  `modelPicker` and `effortPicker`. afleet's own tech-debt item 207 says so. One seam — a surface
  registry the composer can open by name — unblocks F-09, F-18 and lane G at once.
- **The refusal copy is the product's voice for about forty commands, and it currently has three
  lines.** `terminalOnlyReasons` covers `/doctor`, `/color`, `/reload-plugins`; everything else gets
  a sentence that will soon be false ("afleet has no equivalent of that screen" said while the
  equivalent is on screen). Every card in this lane ends by naming a destination; the map should
  collect them into one copy table, because that table is what makes the app feel finished.
- **A principle the terminal follows and the GUI must keep: never take the composer away from a
  user who is mid-draft.** SPEC 41.22.2's `hidesPrompt` flag is exactly this — a panel command typed
  mid-turn keeps the prompt live, the same command at rest unmounts it. Every surface proposed in
  this lane is a popover, a panel section or a Settings pane for that reason. A modal sheet anywhere
  in this family would break a rule canon enforces in code.
- **Canon's "read it, then act on it" gap is the GUI's biggest systematic win here.** `/context`
  names the memory file that costs 6,000 tokens and tells you to run `/memory`. `/doctor` finds a
  duplicated CLAUDE.md and asks the model to fix it. `/resume` prints a `cd … && claude --resume`
  line and copies it to your clipboard. In every case the terminal's output ends where the GUI's
  should begin: the finding should be the control. This is a cross-lane principle, not a card.
- **Two surfaces in this lane are dead code in 2.1.263 and both are worth having.** `/loops` is
  `isEnabled: () => !1` with a complete implementation, and tui-parity's own recommendation is "A
  GUI should build exactly this panel"; `/resume`'s message-content search is hard-nulled, which
  means afleet's deliberate exclusion of full-text search costs nothing against canon. Reading the
  binary rather than the docs is what separates these two cases, and both change a roadmap decision.
- **`/stop` means two different things in canon and in afleet, and nobody has noticed.** Canon's
  `/stop` ends a background session; afleet's routes to `.interrupt`. Same name, different verb,
  and the header menu already has both. A naming pass across lanes F and G is cheap and prevents a
  destructive surprise.
- **Three cards are blocked on one environment variable.** F-27, F-28 and F-29 — the whole rewind
  family's code half — depend on the engine being launched with
  `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` (README finding 8). Whether afleet sets it is a
  one-line check that decides whether half this sub-family is buildable at all. It should be the
  first thing the roadmap resolves.

## Spec defects

1. **SPEC 263 has no section for the `/help` dialog.** Chapter 41 covers dialogs as a widget system
   (§41.22) and the transcript pager's help panel, but nothing specifies `/help`'s three tabs, its
   command-browser filters, its 44-row suppression rules or its three footers. F-13 is built
   entirely from `cli.pretty.js:219360-219500`. This is a real hole: `/help` is one of the most
   frequently invoked commands in the product.

2. **SPEC 263 has no section for the `Usage` and `Stats` tabs.** SPEC 49.21 specifies `/status` and
   the shell's four tabs by name; SPEC 8 §13 specifies the `/api/oauth/usage` endpoint and its
   degraded-mode seeding; SPEC 5 §13.2 specifies `stats-cache.json`. Nothing specifies what either
   tab *draws*. F-02 and F-03 are built from `cli.pretty.js:392822-394950`. Note also that
   `30-plugins-and-marketplaces.md` §27.9 is titled "Stats tab" and is a **different** surface (the
   plugin dialog's), which makes the gap easy to miss by grep.

3. **`/cost` and `/stats` are not documented as aliases where a reader would look.** They appear
   only in the `28-slash-commands.md` §5 catalogue row for `/usage`. Chapters 13, 8 and 49 discuss
   cost and usage without noting that the three command names open one dialog on three tabs
   (verified at `cli.pretty.js:840964`). A reader searching for `/cost` finds nothing.

4. **tui-parity contradicts itself on the rewind refusal count.**
   `areas/42-input-keybindings.md:372` lists **eight** `rewind_conversation` refusal strings and its
   top-gaps entry repeats "eight distinct refusal strings to render";
   `areas/03-49-35-settings-diagnostics-sessions.md` §35.7 lists **ten**, adding
   `failed to persist rewind anchor` and `state changed`. F-31 carries all ten and flags the
   disagreement. One of the two rows is stale.

5. **tui-parity contradicts itself on whether summarize-from-here is initiable.**
   `areas/42-input-keybindings.md:373` gives the mechanism as "a user frame with
   `summarize_metadata {messages_summarized, user_context?, direction: "from"|"up_to"}`";
   `areas/13-10-23-context-memory-session-tools.md` §13.A says "there is no control request that
   invokes partial compaction … a GUI can render a partial compaction produced elsewhere but cannot
   initiate one." These cannot both be right, and the answer decides whether two of the six restore
   options in F-29 ship at all.

6. **afleet refuses `/doctor` on evidence its own repository contradicts.**
   `FleetKit/Sources/FleetSessions/Router/RouterTable.swift:95` carries a terminal-only reason for
   `/doctor`, while `docs/tui-parity/evidence/2026-09-03-slash-commands-headless.md:57` records that
   on 2.1.259 `/doctor` "was NOT refused: it was echoed as a prompt-type command and the MODEL
   answered it", and README finding 17 says the same. The router blocks a command that works. Filed
   as F-37.

7. **The root design spec's §7.7 promises `/tasks` and `/resume` destinations that do not exist.**
   The router table rows read `| /tasks | the registry mirror, with per-task stop_task |` and
   `| /resume | focuses the sidebar switcher |`, and `RouterTable.swift` routes both to
   `.native(...)`; `App/Header/SettingPickers.swift:492` accepts only `modelPicker` and
   `effortPicker`. afleet's tech-debt item 207 records the gap, but §7.7 still reads as though the
   destinations are built.

8. **SPEC 13.18.2's markdown/panel row-ordering asymmetry is documented but not flagged as a
   defect.** With auto-compact disabled the buffer is named `Compact buffer`, which the markdown
   renderer's filter does not exclude, so it appears among the ordinary rows *before* `Free space`;
   with auto-compact enabled the `Autocompact buffer` is filtered out and appended *after* it. The
   spec describes both behaviours accurately and does not say which is intended. A reimplementer has
   to guess.
