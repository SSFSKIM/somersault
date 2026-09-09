# Lane A — chrome and status

**Date:** 2026-09-09, completed 2026-09-10. **Canon:** Claude Code 2.1.263
(`/Users/new/claude-code-bundle/2.1.263/SPEC/`, binary `cli.pretty.js`).

**What this lane covers.** Every terminal surface that is *persistent chrome* rather than
conversation content: the frame the REPL paints around the message list, the footer cluster and its
six jobs, the spinner block and its sub-lines, the user's own `statusLine` script, the two
notification bars, the OS-level notification channels and the `Notification` hook, the terminal
title and tab status, the welcome header, the scroll pill, themes, colour and the accessible
renderer, and the context and rate-limit readouts that live in chrome rather than in the transcript.
Forty-four cards in ten sub-families.

**SPEC sections read.** 41.8.1, 41.8.4, 41.9.1–41.9.5, 41.10.1–41.10.5, 41.12.1, 41.12.4, 41.12.5,
41.14, 41.15.1–41.15.7, 41.16.11, 41.18.1–41.18.11, 41.18a.1, 41.18a.6, 41.18a.7, 41.19.1–41.19.10,
41.20.1–41.20.7, 41.21.1–41.21.5, 41.26.2; 42.22.5; 13.4.1–13.4.5, 13.18.4, 13.19.1–13.19.4;
48 §13.10–13.11, §14; 08 §3373–3389; A4 glossary (`/extra-usage`).

**Verification spent (`cli.pretty.js` at 2.1.263).** Twenty literal greps, each confirming a claim
a card's GUI form depends on. From the first pass: `Jump to bottom` (`:487336`),
`% until auto-compact` (`:505468`), `Context low (` (`:505479`),
`Claude is waiting for your input` (`:531216`), `indicator: "manual mode"` (`:282819`),
`Status line is configured but disableAllHooks is true` (`:505855`), ` · next try in ` (`:369742`),
`suppressHint` / `suppressHintExceptStatusLine` (`:507528`). Added in this pass:
`Context limit reached` (`:833373`), `continuing automatically at ` (`:832822`),
`Automatic continue cancelled` (`:533950`), `hideVimModeIndicator` (`:233888`),
`indicator=;status=;status-color=` (`:282689`), the tab-status palette with
`status: "Working…"` (`:390122`), `preferredNotifChannel` (`:98885`),
`statusline-command.sh` (`:694952`), `Session color set to` (`:32119`),
`Cannot set color: This session is a teammate` (`:32110`), and the OSC command table
`SET_TITLE_AND_ICON: 0 … ITERM2: 9 … KITTY: 99` (`:282602`).

**afleet files read.** Root spec §7.6, §7.7, §8.1–§8.3, §8.7, §8.8, §13, §17.8; C5 §6 and §9;
C6.1 §10; C6.2 "The header's menus and actions". Source:
`App/Timeline/Header/{ChannelHeaderReadout,HeaderReadoutView,ReadbackPoller}.swift`,
`App/Timeline/Rendering/{TimelineTableController,TimelineListView,TimelineRendering}.swift`,
`App/Notifications/{NotificationRouter,NotificationPosting,UserNotificationPoster,SystemOrInAppPoster}.swift`,
`App/Activity/ActivityModel.swift`, `App/Views/{ChannelColumnView,ActivityView,RootView,SettingsView}.swift`,
`App/Composition/AfleetStore.swift`, `App/Header/`,
`FleetKit/Sources/FleetSessions/Types/ChannelState.swift`. Inventory:
`docs/tui-parity/README.md` §5 A-41 and §7 (findings 1–5, 7, 11);
`docs/tui-parity/areas/41-tui-rendering.md` §§41.11, 41.13, 41.15, 41.18–41.21.

**Clone evidence mined.** `CC-to-SDK/docs/parity/tui-ux.md` §3 "Status / chrome", §6 "Polish", and
the Wave C, wave-2, fullscreen and F8 sections;
`docs/superpowers/specs/2026-08-20-f8-spinner-startup-terminal-design.md`;
`docs/superpowers/specs/2026-08-09-wave-c-chrome-composer-design.md`;
`docs/parity/spec-crosscheck-2026-09-03.md`.

**Denominator, with additions.** Every item in the task prompt is covered. Cards added beyond the
prompt's list, because the surfaces exist in this family and the map should show them: the
compaction gauge as the spinner's second row (A-18); the `Next: <task subject>` sub-line that shares
the tip slot (A-23); the `?` shortcuts panel, which *replaces* the footer rather than living in it
(A-15); the cloud / IDE / debug / `focus` / `memory paused` right-column chips (A-13, A-14); the
pinned bar as a distinct surface from the transient bar (A-27, A-28); the remote-frame notification
admission caps that let another process write into this session's chrome (A-29); the `Notification`
hook as afleet's *transport* rather than as an extension point (A-32); `subagentStatusLine` (A-26);
the context-limit banner, carded separately from the context meter because its states and copy
differ (A-37); `/rate-limit-options` and the `/usage-credits` / `/extra-usage` pair (A-39); and the
chrome-driving `/config` rows as one card (A-44), cited as settings rather than as lane E's panel.

**Numbering note.** A-16 is not a gap: card A-10 forward-referenced it for the
`hideVimModeIndicator` coupling, and it is the `statusLine` row, filled at the head of §4. Ids
A-01 … A-44 are contiguous.

**Corrections to the first pass.** Four "needs verification" claims are now read against the built
code and replaced: the timeline's sticky rule and silent re-pin (A-06), the jump-to-bottom pill and
its unseen count (A-07, both `built`), and reduced motion (A-19, `undesigned`, verified absent from
`App/`, `FleetKit/` and `Workbench/`).

---

## Headline

1. **The footer is four jobs wearing one row, and afleet should split them four ways rather than
   build a footer.** Hints belong on the composer shortcut bar and in the menu bar; the
   permission-mode pill belongs in the channel header beside model and effort; the focusable chips
   (`tasks`, `workflows`, `frame`) belong on panel tabs with badges; the connection chips belong in
   the header as small glyphs; and the user's `statusLine` belongs on a header sub-row. Nothing in
   afleet should be a one-row space-budgeted strip — the terminal's ` · `-joined, width-elided
   segment vocabulary (SPEC 41.15.4) exists only because it has eighty columns and one row.

2. **The user's `statusLine` script is the hardest single translation in this lane, and the honest
   answer is "run it, render it, and disclose what is missing".** afleet can rebuild most of the
   payload from wire data it already holds, but `prompt_cache`, `scratchpad_dir` and `prompt_id`
   have no source, and `cost` and `pr` can only be approximated (tui-parity README §7 finding 3).
   Proposal (A-16): honour the setting, run it on afleet's own cadence with the abort-not-queue
   rule, render the ANSI-parsed result as a **per-channel header sub-row**, surface failures with
   stderr instead of blanking silently, and put a "fields this host cannot supply" disclosure in
   Settings rather than emitting `null` forever.

3. **afleet has no working-state surface comparable to the spinner block, and that is the biggest
   loss.** The terminal gives four independent readouts on two rows — a verb, elapsed time, a live
   token counter and an escalating tool label — plus a sub-line carrying a tip, the next queued
   task, or a model-written narration sentence. A GUI channel that shows only "text appearing"
   tells the user less than the terminal does. This should be a **persistent activity strip pinned
   above the composer** (A-17), not a transient timeline row, so it survives scrolling.

4. **The two notification bars are one GUI widget each, and the split is the design.** Pinned
   entries never expire and are prefixed `⚠`; transient entries share one 8000 ms timer and truncate
   to one row. Map pinned → **channel banner**, transient → **toast over the channel**, and port the
   store's ordering, `invalidates`, `fold` (a merge function, not a flag) and head-requeue
   preemption verbatim — they are what stops a banner pile-up, and the clone independently reached
   the same conclusion at implementation contact. afleet's built `ChannelBanner` has seven cases,
   **all of them afleet's own multi-process concerns and none of them the terminal's**, while the
   rate-limit and auth banners its own root spec §7.6 designs do not exist in the enum.

5. **afleet's built context meter already exceeds the terminal's, and its notification copy falls
   short of it.** The meter (`App/Timeline/Header/HeaderReadoutView.swift:77`) draws a fill, a
   threshold mark and a per-category hover where the terminal renders **nothing at all** below the
   warn band — keep it and add the band arithmetic and canon's warn/blocked copy (A-36, A-37). In
   the other direction, `NotificationRouter` titles every engine notification `afleet — <type>` and
   says `The turn ended with success.` where canon says `Claude is waiting for your input` and
   `<label> finished`; tui-parity's instruction for these strings is "reuse verbatim" (A-31).

6. **Six terminal mechanisms are wholesale superseded and should be carded and closed, not
   ported** — `/tui`, the fullscreen boot canary, `/scroll-speed`, OSC 9;4, the screen-reader line
   renderer, and colour-capability detection. Each has exactly one thing worth inheriting, named in
   its card. The most valuable inheritance is a rule rather than a feature: **fullscreen-only
   behaviours are precisely the ones a GUI gets for free**, so translate the fullscreen branch
   everywhere and never the classic-inline degradations.

7. **Two dead or cheap features are free wins.** OSC 21337 tab status is fully implemented in canon
   with a three-state palette and a capability predicate hard-coded to `false` — afleet's `Presence`
   enum is already that palette plus one, so shipping it is a colour mapping (A-35). And the title's
   four-candidate precedence (`/rename` > AI title > agent title > haiku title > default) is what a
   window title, a sidebar row, the quick switcher and a popped-out window all want; afleet's
   current rung list is missing the top and bottom of it (A-34).

---

## 1. The frame: what the window inherits from the renderer

### A-01 · The layout frame and its three renderer branches

**Terminal.** The REPL root (SPEC 41.15.1) mounts a scrollable region, three dialog slots
(`inline`, `bottom`, `modal`), and a bottom column whose prompt row carries, in order, the pinned
notice bar, the text input, the footer, and the transient notification bar. One component owns the
three-region layout and has three branches (SPEC 41.15.2): **fullscreen** (a real scroll box, a
sticky-prompt pill, a jump-to-bottom pill, a sidebar column, a bottom column, a modal overlay),
**DECSTBM** (a scroll-region renderer with an absolutely positioned overlay), and **classic
inline** (scrollable, bottom, modal in document order and nothing else). The view-state enums that
gate chrome are in SPEC 41.15.6: `screen` (`prompt` | `transcript`), `replTab` (`convo` | `diff`),
`expandedView` (`none` | `tasks`), `viewSelectionMode`, `footerSelection`, dialog `layout` and
dialog hide reason.

**Job.** It guarantees that the conversation scrolls while the input, the mode indicator and the
warnings stay put — the single structural promise of the terminal UI.

**Wire.** Not applicable; this is host-side composition. tui-parity classes the renderer family as
terminal-only (T).

**afleet today.** `built` as the window's own shape — sidebar / channel header / timeline /
composer / right panel (root spec §8.1). afleet's shell is permanently the equivalent of the
terminal's **fullscreen** branch: a real scroll view, persistent regions, an overlay layer.

**GUI form.** No new work. This card exists to fix a rule the rest of the lane depends on:
**translate the fullscreen branch, never the classic-inline one.** Where SPEC says a surface
behaves differently inline (the status-line row collapses on failure; the footer's blank-space row
is dropped; queued messages are not listed; there is no jump-to-bottom pill), the GUI takes the
fullscreen behaviour. Where SPEC says a surface exists *only* in fullscreen (narration, the
reserved status-line row, `/scroll-speed`), that is a green light for the GUI, not a reason to
skip it.

```
┌──────────┬──────────────────────────────────────────────────┬────────────────┐
│ sidebar  │ channel header  · readbacks · meter · menus      │  panel tabs    │
│          ├──────────────────────────────────────────────────┤                │
│ Activity │ channel banner (pinned notices)          [A-27]  │  Thread        │
│ projects ├──────────────────────────────────────────────────┤  Agents        │
│ channels │                                                  │  Files         │
│          │                timeline                          │  Source Ctl    │
│          │                                    ┌───────────┐ │  Terminal      │
│          │                                    │ 3 new ↓   │ │  Browser       │
│          │                                    └───────────┘ │  GitHub        │
│          ├──────────────────────────────────────────────────┤                │
│          │ activity strip: ✳ Cogitating… · 42s · ↓1.2k [A-18]│               │
│          │ sub-line: Tip / Next: / narration        [A-22]  │                │
│          ├──────────────────────────────────────────────────┤                │
│          │ composer                                         │                │
│          │ shortcut bar: / commands  @ files  ! shell [A-11]│                │
│          │ statusLine output row (opt-in)           [A-16]  │                │
└──────────┴──────────────────────────────────────────────────┴────────────────┘
```

**Drops / keeps / gains.** Drops: three renderer branches, DECSTBM, the modal/inline/bottom slot
distinction. Keeps: the region contract (conversation scrolls, chrome does not). Gains: a
persistent right column and a sidebar the terminal only simulates.

**Open.** None.

### A-02 · The REPL welcome header

**Terminal.** SPEC 41.15.7. Two artefacts exist and only the second is in the REPL. The large
58-column art box needs 30 rows and appears only in four pre-REPL screens (onboarding, Pro-trial
start, `setup-token`, powerup discovery); below 30 rows it degrades to the line
`Welcome to Claude Code `. The **REPL header** is a responsive three- or four-line block beside a
9×3 animated sprite: a bold `Claude Code` with a dim `v<version>`; a dim line carrying model and
billing, split onto two lines by `shouldSplit` when their combined width plus separator exceeds
the budget; and an optional dim `@<agent> · <cwd>` line. There is **no `cwd:` label in this
build**. The path is project-relative, else `~`-relative, else absolute, middle-elided to
`max(columns − 15, 20)` minus the agent name. `PHe()` gives three forms: empty when
`CLAUDE_CODE_HIDE_CWD` is set; `<path> in <url>` with the scheme stripped when a direct-connect
MCP server URL is set; otherwise the path alone. The sprite animates only under the fullscreen
renderer. `hideWelcomeChrome` hides the header subtree but not the announcement slot; a second
gate suppresses the release-notes summary and the sprite entrance when the session was resumed, is
a background run, or is a teammate.

**Job.** Tells you, at a glance, which build, which model, which billing, which agent and which
directory this session is — the identity readback you check before typing.

**Wire.** P for most of it: `system/init` carries `claude_code_version`, `cwd`, `tools`,
`mcp_servers` and the model (verified in `cli.pretty.js:94598`). Billing tier and the sprite are
not on the wire (D / T). See tui-parity area 41 §41.15.

**afleet today.** The identity readbacks live in the channel header, not in a per-session banner
(root spec §8.3; C6.1 §10). afleet has no per-session "welcome" artefact.

**GUI form.** **Do not port the welcome block as a message.** Its four facts are all
already-persistent header readbacks in afleet, and a GUI that repeats them in the scroll region is
noise the terminal only tolerates because its header cannot persist. What should be ported is the
**one-shot announcement slot**: release notes for a new build and the "resumed session" suppression
rule. Region: a dismissible **channel banner** on the first channel opened after an engine version
change, reading the version and a "What's new" disclosure — suppressed for resumed sessions,
background runs and teammates, exactly as the terminal's second gate does. The sprite and the art
box are out.

**Drops / keeps / gains.** Drops: sprite, art box, per-session identity restatement, the `in <url>`
direct-connect form (afleet has no direct-connect MCP mode). Keeps: version announcement, the
resume/background/teammate suppression rule. Gains: the readbacks are always visible instead of
scrolled away.

**Open.** Should the version announcement be per-channel or once per app launch? The terminal is
per-session; afleet's sessions are channels, so per-channel would repeat it N times a day.

### A-03 · `/tui` — inline versus alternate screen

**Terminal.** SPEC 41.12.1's 12-row decision table picks `fullscreen` or `default` from a reason
code; four reasons (`env_off`, `sr_auto_off`, `tmux_cc_auto_off`, `win_ssh_auto_off`) are marked
*involuntary downgrades*. `/tui <default|fullscreen>` (SPEC 41.12.4) saves the preference and
relaunches, but only after clearing every blocker, and it refuses in specific words: with no
argument it prints `Current renderer: <mode><explanation>. Usage: /tui <default|fullscreen>`; in a
background session `Saved. Background sessions always use the fullscreen renderer while attached;
the <mode> renderer will apply to sessions started directly with \`claude\`.`; in screen-reader
mode `Screen-reader mode always uses the classic renderer, so the tui setting has no effect while
it is active.`; with background work running `Cannot switch renderers while work is running in the
background — wait for it to finish (or stop it via /tasks), then run /tui again.`

**Job.** Choosing between a flicker-free full-window app and a renderer that leaves output in
scrollback.

**Wire.** T — terminal-only, per tui-parity area 41 §41.12.

**afleet today.** `superseded` — afleet is a native window; there is no scrollback to preserve and
no alternate screen to enter.

**GUI form.** Superseded by the window itself. **What the GUI inherits:** every behaviour SPEC
marks fullscreen-only is now unconditional. Concretely — the queued-message list (SPEC 41.15.1),
the sticky-prompt pill and the jump-to-bottom pill (41.15.2), the reserved one-space `statusLine`
row that prevents layout shift (41.19.6), the footer's blank-space row that preserves row height
(41.15.4), the turn-narration sub-line whose gate requires `Ta()` (41.18a.1), `/scroll-speed`
(41.8.4) and the sprite animation (41.15.7). Any card in this lane that says "fullscreen only"
should be read as "available".

**Drops / keeps / gains.** Drops: the whole decision table, the command, the relaunch, the
downsell feedback dialog. Keeps: the fullscreen feature set as the baseline. Gains: no involuntary
downgrade path exists.

**Open.** None.

### A-04 · The fullscreen boot canary

**Terminal.** SPEC 41.12.5. Every fullscreen launch writes
`fullscreenBootPending[<pid>] = { startedAt, version, host, platform }` into `~/.claude.json`
before painting, erases it on a clean exit, and disarms it 10,000 ms (`Ky`) after the first frame.
Two strikes (`Gy`) trip a sticky auto-disable that downgrades later launches to the classic
renderer (reason `crash_auto_off`). Stale records expire: 600,000 ms (`Vy`) for a live process,
2,592,000,000 ms (`Yy`, 30 days) across hosts or platforms. A render error stamps the record
`died: "render_error"`.

**Job.** Stops a user from being trapped in a renderer that crashes before it can be turned off.

**Wire.** T.

**afleet today.** `superseded` — there is no alternate renderer to fall back from.

**GUI form.** Superseded. **What is worth inheriting is the pattern, not the mechanism:** a
crash-arming record that trips a degradation after N strikes with host/platform/staleness expiry
is the correct shape for afleet's own risky subsystems — the Monaco/Files viewer, GhosttyKit
terminal panes, the Browser tab. Log it as a backlog note for the panel layer (lane owns panels,
not this lane); nothing in chrome needs it.

**Drops / keeps / gains.** Drops: everything. Keeps: nothing user-visible. Gains: n/a.

**Open.** None.

### A-05 · `/scroll-speed`

**Terminal.** SPEC 41.8.4. A `local-jsx` dialog, enabled **only in fullscreen** and never in a
JetBrains terminal, that writes `userSettings.env.CLAUDE_CODE_SCROLL_SPEED`. The dialog body shows
`<n> line(s) per wheel notch`, appending ` (auto)` when unset and ` · auto is <n>` otherwise, and
lists a `Terminal` row and, when known, an `Editor` row. Its footer reads
`Scroll to feel it · ←/→ adjust · r reset to auto · Enter save · Esc cancel`. The underlying base
is 3 only when the host is xterm.js or `WT_SESSION` is set and the host is not a wheel-flood host,
2 for JetBrains (which bypasses the override entirely), and 1 otherwise; the env override is
parsed as a float, ignored when ≤ 0 or `NaN`, and capped at 20.

**Job.** Makes the wheel usable in terminals that emit a burst of events per notch or one row per
notch.

**Wire.** T.

**afleet today.** `superseded` — AppKit/SwiftUI scroll views take the system's scroll speed and
momentum.

**GUI form.** Superseded by native scrolling. **One thing to inherit:** the *live-preview* dialog
pattern — `Scroll to feel it` while adjusting — is the right shape for any afleet setting that
affects feel. Nothing else.

**Drops / keeps / gains.** Drops: the setting, the dialog, the per-host base table, the JetBrains
inversion workaround. Keeps: nothing. Gains: OS-native momentum and per-device scroll preferences.

**Open.** None.

### A-06 · The scroll model and the sticky rule

**Terminal.** SPEC 41.8.1. A scroll container tracks `scrollTop`, `scrollHeight`,
`scrollHeightHwm`, `scrollViewportHeight`/`Top`, `scrollTopRendered`, `pendingScrollDelta`,
`stickyScroll`, `scrollAnchor` and optional clamps. Two attributes tune it: `stickyScroll` forces
follow, and `followGrowth` (default true) follows only while already at the bottom. **Sticky
scroll is re-enabled automatically when the user scrolls back to the bottom.** The virtual list
(SPEC 41.15.3) adds scroll anchoring: when not sticky, the item whose layout top is nearest above
the viewport top is remembered and `scrollTop` is corrected next frame by however much that anchor
moved — so content growing above the viewport does not shift what you are reading.
`/config` carries `Auto-scroll` / `Auto-scroll output` bound to `autoScrollEnabled`, default
`true` (SPEC 41.26.2).

**Job.** Reading old output while a turn streams, without being yanked to the bottom, and getting
follow-mode back the moment you return to the bottom.

**Wire.** R — the host owns scroll state entirely; tui-parity area 41 §41.8 treats it as
host-rebuilt.

**afleet today.** `built`, and it keeps all three rules. `App/Timeline/Rendering/TimelineTableController.swift`
is an `NSTableView` controller, not a SwiftUI scroll view: `settleScroll(anchor:appended:)` follows
growth only while `scroll.isPinnedToBottom` **and** `context?.autoScrollEnabled ?? true`, otherwise
re-anchors on the item nearest the viewport top (`tableView.rect(ofRow:).minY - anchor.offset`);
`viewportMoved()` performs what its own comment calls the **silent re-pin** — returning to the bottom
re-arms the follow and clears the unseen count with no affordance to press. `autoScrollEnabled` is
already a readback on `ChannelHeaderReadout` (`App/Timeline/Header/ChannelHeaderReadout.swift:67`),
sourced from the channel's `get_settings`.

**GUI form.** Keep all three rules verbatim: (a) follow growth only while at the bottom;
(b) re-enable follow automatically on returning to the bottom — do **not** require a button press,
which is the common GUI mistake; (c) anchor to the nearest item above the viewport top so
streaming growth above does not shift the read position. Expose `autoScrollEnabled` as an afleet
setting with the terminal's default (`true`) and the terminal's label `Auto-scroll output`.
`[exceeds]` The GUI can anchor per-message rather than per-row, and can preserve anchor across a
window resize where the terminal must rescale every cached height by `oldCols / newCols`.

**Drops / keeps / gains.** Drops: the height cache, prefix sums, the 300-item cap, the column
rescale. Keeps: follow-growth, auto-re-stick, anchoring, the `autoScrollEnabled` setting. Gains:
smooth scrolling, per-message anchors, resize stability.

**Open.** None. (The re-stick question this card originally raised is answered above: afleet
re-sticks on return-to-bottom.)

### A-07 · The jump-to-bottom pill

**Terminal.** SPEC 41.15.2. Present in the fullscreen branch only. Its label is
`${n} new ${plural(n,"message")}` when unseen messages exist, otherwise `Jump to bottom`
(verified in `cli.pretty.js:487336`), with four responsive suffixes chosen by available width:
`(click) ↓`, `: <chord> to scroll`, `(<chord>) ↓`, and a bare `↓`. Scroll pinning is owned by a
store holding the main and modal viewports, an unseen-divider snapshot, a `repin` and a
`jumpToNew`.

**Job.** Tells you that you fell behind, by how much, and gives you one gesture back.

**Wire.** R — host-rebuilt; the unseen count is derived from messages the host already has.

**afleet today.** `built`, and closer to canon than expected. `JumpToBottomPill`
(`App/Timeline/Rendering/TimelineListView.swift:144`) draws only while `!scroll.isPinnedToBottom`,
carries the unseen count in its label — `"\(scroll.unseenCount) new"` when the count is non-zero,
otherwise `Jump to latest` — and uses `arrow.down` as its glyph. The count is maintained by
`TimelineScrollState.unseenCount`, incremented per appended row while unpinned and zeroed on
re-pin. What it loses against the terminal: no unseen **divider** in the list (the terminal has none
either, so this is a `[exceeds]` opportunity rather than a loss) and no keyboard binding.

**GUI form.** A floating pill at the bottom-right of the timeline, above the composer, shown only
when not at the bottom. Copy: `<n> new messages` with a `↓`; `Jump to bottom` with a `↓` when
`n == 0`. Drop the four responsive suffixes — a GUI pill is always clickable, so `(click)` is
noise, and the chord belongs in a tooltip. Keep the **unseen-divider snapshot**: the pill's count
and the timeline's "new messages" divider must come from the same snapshot taken when the user
left the bottom, so clicking the pill lands on the divider rather than the true bottom.
`[exceeds]` Clicking can scroll to the *divider*, which the terminal's `jumpToNew` also does but
cannot animate.

**Drops / keeps / gains.** Drops: the four width-responsive suffixes. Keeps: the count, the
`Jump to bottom` fallback copy, the divider snapshot, `jumpToNew` semantics. Gains: animated
scroll, hover state, and the pill can coexist with a persistent unread badge on the sidebar row.

**Open.** Should the pill's count be *messages* or *turns*? afleet's timeline rows are coarser
than the terminal's; counting raw messages may read oddly next to a channel badge that counts
something else. Owner call, and it must agree with lane G's fleet-level unread badge.

---

## 2. The footer cluster: one row, six jobs

### A-08 · The footer as a whole — where its six jobs land

**Terminal.** SPEC 41.15.4: "The footer is not one row." One component lays out a **left column**
(the `statusLine` row above the hint row) beside a **right-aligned column** (the transient
notification bar plus indicator chips). The hint row has two mutually exclusive layouts chosen by
a gate — a *dense* single-hint layout and a *classic* multi-segment layout — both a single
`height: 1, overflow: "hidden"` row whose segments are joined by a dim ` · `. Crucially, `rowWidth`
is **not** the terminal width: the footer subscribes to the layout pass and measures the *rendered*
width of its own left column, then decides which segments survive. Configuring a `statusLine` sets
a `suppressHint` flag that turns **off** the classic `? for shortcuts` and `esc to interrupt`
hints (SPEC 41.19.6; the `suppressHint` / `suppressHintExceptStatusLine` props verified in
`cli.pretty.js:507528`).

**Job.** A permanently visible, zero-cost answer to four questions: what mode am I in, what can I
press right now, what is the machine's state, and what did my own script want me to know.

**Wire.** Composition is host-side (R). The individual data behind each job has its own class; see
the per-job cards A-09 through A-16.

**afleet today.** `designed`/`built` in pieces, never as a cluster. Root spec §8.1's window frame
already places two of the six jobs: the header line `# fix-auth-tests · main · opus · Auto` carries
the mode readback, and the composer row carries `/ commands  @ files  ! shell` on the left and
`Auto ▾ │ opus ▾ │ high ▾ │ ⏎ send` on the right. There is no footer, no status-line row and no
indicator-chip region.

**GUI form.** **Do not build a footer.** The terminal's footer exists because one row is all the
space there is; a GUI that reproduces it inherits the width-budget logic (`rowWidth` measurement,
segment elision, dense-vs-classic layouts) for no benefit. Split the six jobs to the region that
already owns each:

| Footer job | Terminal home | afleet region | Card |
|---|---|---|---|
| Contextual hints | hint row segments | composer shortcut bar (persistent) + menu bar (discoverable) | A-09 |
| Row-replacing states | hint row, pre-empted | composer inline status text, in the same row as the shortcut bar | A-10 |
| Permission-mode pill | classic/dense pill | channel header readback + composer mode picker | A-11 |
| Focusable chips | `footerSelection` | panel tab badges (Agents, Thread) + Activity row | A-12 |
| Indicator chips | right column | channel header trailing glyph cluster | A-13 |
| Transient notifications | right column, mounted twice | toast over the channel | A-28 |
| `statusLine` output | left column, top row | opt-in header sub-row | A-16 |
| `?` help panel | replaces the footer | Help menu + a Keyboard Shortcuts window | A-15 |

Keep one structural rule from the terminal: **the hint region is subordinate to the composer, and
never steals it.** SPEC's row-replacing states pre-empt hints but never the input; afleet should
likewise let banners, toasts and status rows change around the composer without moving focus out
of a draft.

```
composer region, afleet
┌──────────────────────────────────────────────────────────────────────────────┐
│  Message #fix-auth-tests…                                                    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ / commands  @ files  ! shell        ⏸ Manual  │ opus ▾ │ high ▾ │ ⏎ send      │  ← A-09 / A-11
│ ⎇ statusLine output row (opt-in, ANSI-parsed, dim)                            │  ← A-16
└──────────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** Drops: the one-row constraint, `rowWidth` measurement, dense-vs-classic
layouts, segment elision, the `suppressHint` interaction (a GUI has room for both). Keeps: every
job, and the rule that chrome never takes the composer's focus. Gains: all six jobs visible at
once instead of competing for columns.

**Open.** Does afleet want a *persistent* shortcut bar, or one that appears on focus? The terminal
is always-on; the §8.1 frame shows always-on; confirm before lane C builds against it.

### A-09 · The hint vocabulary

**Terminal.** SPEC 41.15.4's hint segments, joined by a dim ` · `, with per-segment conditions:

| String | Condition |
|---|---|
| `? for shortcuts` | dense: selected; classic: only when no other hint and no pills fit |
| `esc to interrupt` / `esc to return to team lead` | a turn is running |
| `ctrl+t to show tasks` / `… to hide tasks` | todos exist |
| `enter to view tasks` / `down to manage` | the task chip is selected or not |
| `enter to view memories` | the memories chip is selected |
| `hold <space> to speak` | voice on, session idle, seen fewer than three times |
| `/tasks to see subagents` | subagent tasks exist |
| `/diff to hide diff` | the diff tab is active in a git repo |
| live-selection controls | fullscreen only, with a selection: `ctrl+c to copy`, `option+click to native select` (macOS) / `shift+click to native select`, or `set macOptionClickForcesSelection in VS Code settings` |
| `← for agents` / `← <n> agents` / `← <n> done` | the agents chip |
| `↳ <n> background` | ≥ 2 background tasks, dense layout |
| `<n> feedback drafts` | drafts exist |

`esc to interrupt` is **composed, not literal** — the footer's chord component renders
`<chord> to <action>` from the `chat:cancel` binding and the action word `interrupt`, so a user
rebind changes the displayed text. The only literal occurrence of the phrase is inside the
low-priority retry banner (`cli.pretty.js:369742`).

**Job.** Teaches the keyboard in context: each hint appears exactly when its action is available.

**Wire.** T/R — hints are host-side UI; the *conditions* (turn running, todos exist, subagents
exist) are all P from the wire, which afleet already tracks.

**afleet today.** `designed` — root spec §8.1 shows a fixed shortcut bar `/ commands  @ files
! shell`; §8.7 lists the app's shortcut set (Cmd+K, Esc, Cmd+Shift+Esc, Cmd+Enter, Cmd+S,
Cmd+1…7, Cmd+Shift+T, Shift+Tab, Cmd+Shift+A). The bar is static and does not change with turn
state, so the terminal's whole *contextual* dimension is currently absent.

**GUI form.** Keep the shortcut bar's three permanent affordances (`/ commands`, `@ files`,
`! shell`) and add a **contextual slot on the right of that same row** that carries at most one
hint, chosen by the terminal's own priority: interrupt while a turn runs, then queue state, then
nothing. Copy: keep the terminal's wording but render the chord as afleet's own key
(`esc to interrupt` → `Esc to interrupt`, macOS-cased); keep it composed from the live binding, as
the terminal does, so a rebind updates the label. Move the rest to their true homes: `? for
shortcuts` becomes the **Help ▸ Keyboard Shortcuts** menu item (A-15); `ctrl+t to show tasks`,
`← for agents` and `/tasks to see subagents` become **badges on the Agents panel tab**; `/diff to
hide diff` becomes the Source Control tab's state; the live-selection controls are superseded by
native text selection; `hold <space> to speak` is out of scope (no voice). `[exceeds]` A GUI hint
can be a real button, so `<n> feedback drafts` and `↳ <n> background` become clickable counters
rather than instructions.

**Drops / keeps / gains.** Drops: the ` · ` join, width elision, dense/classic split, selection
hints, voice hint, the two VS Code-specific strings. Keeps: contextual appearance, composed
chords, `Esc to interrupt` as the one live hint. Gains: clickable counters, a permanent
discoverable home for the rest.

**Open.** Which single hint wins the contextual slot when a turn is running *and* a queued message
exists? Terminal has no equivalent conflict because the queue chip lives elsewhere.

### A-10 · The row-replacing footer states

**Terminal.** SPEC 41.15.4. Five states pre-empt the hint row entirely:

| String | Condition |
|---|---|
| `Press <key> again to detach (session keeps running)` / `Press <key> again to exit` | an exit message is pending |
| `Pasting…` | a paste is in flight |
| `paste again to expand` | a collapsed paste can be expanded |
| `! for shell mode` | the composer is in bash mode; coloured `bashBorder` |
| a single blank space | nothing to show, in fullscreen — preserves the row height |

The non-`NORMAL` Vim indicator is **not** one of these: when history search is inactive the
composer renders the search editor, `-- <vimMode> --` and the hint row as siblings, so the
indicator shrinks the hint row's `rowWidth` rather than replacing it.

**Job.** Confirms a modal, momentary state at the exact place the user is looking — the row under
the input — without a dialog.

**Wire.** R — all five are local editor/composer states; none crosses the wire.

**afleet today.** `undesigned`. afleet's composer (root spec §8.5) has bash mode via `!`, image
paste and file drop, and a queued chip driven by `command_lifecycle`, but no spec text places a
transient status string under the field.

**GUI form.** One **inline status text** occupying the right end of the shortcut-bar row,
pre-empting the contextual hint from A-09. Keep three of the five verbatim in intent:
`Pasting…` while an attachment or a large paste is being processed (afleet's file drop makes this
more likely than the terminal's); a bash-mode indicator matching the terminal's coloured
`! for shell mode`; and the exit/detach arming state, which in afleet maps to **closing a channel
that is still running** — copy adapted to `Close again to leave this session running` versus
`Close again to stop this session`, preserving the terminal's crucial distinction between
detaching and exiting. Drop `paste again to expand` (afleet shows attachments as chips, not
placeholders) and the blank-space row (a GUI row has fixed height). The Vim indicator is out of
scope — afleet has no vim editor mode — but note that its *existence* is why the `statusLine`
setting has a `hideVimModeIndicator` field, which A-16 must handle.

**Drops / keeps / gains.** Drops: `paste again to expand`, the blank-space row, the Vim
indicator. Keeps: `Pasting…`, bash-mode indication, the detach-versus-exit distinction. Gains:
the same row can host a progress spinner for a long paste, which the terminal cannot.

**Open.** Does afleet distinguish "close the window" from "stop the session"? The terminal's
two-string split is the right model; the owner should confirm afleet's close semantics before the
copy is fixed.

### A-11 · The permission-mode pill and the Shift+Tab indicator

**Terminal.** SPEC 41.15.4 and 42.22.5. The pill is its own component rendering
`<symbol> <indicator><suffix>`, in the mode's colour, where the suffix is `" on"` unless the bare
form is requested. The mode table (`cli.pretty.js:282819`, verified) supplies symbol, indicator
and colour for six modes:

| mode | symbol | indicator | colour | rendered pill |
|---|---|---|---|---|
| `default` | `⏸` | `manual mode` | `inactive` | `⏸ manual mode on` |
| `plan` | `⏸` | `plan mode` | `planMode` | `⏸ plan mode on` |
| `acceptEdits` | `⏵⏵` | `accept edits` | `autoAccept` | `⏵⏵ accept edits on` |
| `bypassPermissions` | `⏵⏵` | `bypass permissions` | `error` | `⏵⏵ bypass permissions on` |
| `dontAsk` | `⏵⏵` | `don't ask` | `error` | `⏵⏵ don't ask on` |
| `auto` | `⏵⏵` | `auto mode` | `warning` | `⏵⏵ auto mode on` |

Their long titles are `Manual`, `Plan`, `Accept edits`, `Bypass Permissions`, `Don't Ask`, `Auto`.
SPEC 42.22.5: the parenthesised chord suffix is appended dimmed, so the composed footer string
reads `⏵⏵ accept edits on (shift+tab to cycle)`; a second site labels the same action
`auto-accept edits` instead of `cycle`. **The `default` mode's pill is suppressed in the footer**,
so in manual mode nothing advertises the chord there — `? for shortcuts` does. Lane C owns the
ring semantics; this card is the display only.

**Job.** The single most consequential piece of state in the session — how much the agent will do
without asking — visible at all times and in a colour that escalates with risk.

**Wire.** P. `set_permission_mode` and the mode readback are on the control protocol; afleet
already drives it (root spec §8.6 for `bypassPermissions` gating, corrected against the engine's
string comparison on `disableBypassPermissionsMode`).

**afleet today.** `built`/`designed`: root spec §8.1's header line ends `· opus · Auto` and the
composer's right side carries `Auto ▾`, so the mode is a *picker* rather than a status pill.
§8.6 handles the bypass disclaimer and the restart-with-flag path. What the built form loses
against the terminal: the **colour escalation** and the **symbol**. A picker labelled `Auto ▾` in
default chrome does not tell a glancing user that `Auto` is a `warning`-coloured mode and `Bypass`
is `error`-coloured, which is the terminal's whole point.

**GUI form.** Keep the picker (afleet's is better — it changes the mode in one click, where the
terminal cycles blindly), but **give it the terminal's symbol and colour semantics**: prefix the
picker label with `⏸` or `⏵⏵`, and tint the control by the mode's colour token — `inactive` for
Manual, the plan accent for Plan, the accept accent for Accept edits, `warning` for Auto, `error`
for Bypass Permissions and Don't Ask. Use the terminal's **short titles** as the picker labels
(`Manual`, `Plan`, `Accept`, `Bypass`, `DontAsk`, `Auto`) and the long `indicator` strings as the
menu-item labels, so both vocabularies survive. **Deviate on one point:** do not suppress the
Manual pill. The terminal hides it to save a row's width; a GUI has none of that pressure, and an
always-present readback is strictly safer. Keep the header's mode readback too, so the mode is
visible when the composer is scrolled or a panel is popped out. `[exceeds]` Hover can show the
mode's full description; a destructive mode can carry a persistent tint on the channel header
edge, which the terminal cannot afford.

**Drops / keeps / gains.** Drops: the `(shift+tab to cycle)` chord suffix in the label (it belongs
in the picker's menu), the default-mode suppression, the two competing action labels. Keeps: the
six modes, both symbols, all six colour tokens, both title vocabularies. Gains: direct selection,
hover description, a channel-level risk tint.

**Open.** Does afleet want the `dontAsk` mode in the picker at all? It is in canon's table but is
a hazardous mode with no disclaimer path specified in §8.6 (only `bypassPermissions` has one).

### A-12 · Focusable footer chips (`footerSelection`)

**Terminal.** SPEC 41.15.6. `footerSelection` is a union of `null`, `tasks`, `memories`, `bagel`,
`bridge`, `workflows`, `frame`. The candidate list is six conditional strings filtered for truthy
values; when `Fg > 0 || Aho` it is filtered again through a predicate that **excludes `memories`,
`bagel` and `bridge`** but retains `tasks`, `workflows` and `frame`, and keyboard navigation uses
that filtered array. Per-chip: `tasks` opens the task view; `memories` calls
`openSessionMemories("keyboard")` then clears the selection; `bagel` is a live code path whose
selector returns `false` unconditionally, so it **can never be selected in this build**; `bridge`
requires a REPL-bridge error or a connected explicit/reconnecting bridge, a minimum column count
and the bridge gate, and reconnects on `enter`; `workflows` opens the workflow list; `frame`
opens the frame URL. A selection no longer in the candidate list is tracked separately.

**Job.** Makes the footer keyboard-reachable: arrow to a chip, press enter, open the thing it
counts — without a slash command.

**Wire.** Mixed. Tasks/todos are P (task events). `memories`, `bridge`, `bagel`, `frame` are
X or T for afleet — no equivalent subsystem. `workflows` is D pending lane coverage.

**afleet today.** `built` in spirit, not in form: root spec §8.1 gives seven panel tabs
(Thread, Agents, Files, SCM, Term, Web, GH) bound to Cmd+1…7 (§8.7), which is a strictly better
version of the same idea — a persistent, keyboard-reachable, badged destination per subsystem.

**GUI form.** Superseded by the panel tab strip, with one thing to carry over: **the chips are
counters, and the tabs should be too.** Give the Agents tab the terminal's `← <n> agents` /
`← <n> done` counts and the Thread tab the todo count that drives `tasks`; badge them the way
the sidebar badges channels (root spec §8.2). Drop `memories`, `bagel`, `bridge` and `frame`
outright — `bagel` is dead in canon itself, and the other three name subsystems afleet does not
have. Keep the terminal's dynamic-eligibility rule: a tab with nothing in it shows no badge, and
navigation skips it.

**Drops / keeps / gains.** Drops: five of six chips, the selection state machine, the
column-count gate. Keeps: counts-as-affordances, eligibility-driven navigation. Gains: seven
always-visible destinations instead of a rotating strip; each pops out to its own window.

**Open.** None.

### A-13 · The right-column indicator chips

**Terminal.** SPEC 41.15.4's right-aligned column. The IDE chip reads
`⧉ <n> lines selected`, `⧉ <n> lines from diff`, `⧉ <n> lines from <path>` or `⧉ In <path>`. The
**cloud** item exists only while the app store holds a `remoteSessionUrl` and is a hyperlink to it
whose text is `◎ cloud` plus a status suffix: nothing in the `ide` colour while `connecting` or
`connected`, ` · reconnecting…` in `warning`, ` · disconnected` in `error`. It is
`wrap: "truncate"`, never folded, and is pushed after the HIPAA taint label and before the IDE
item. Others: `Debug`, `focus`, `memory paused`.

**Job.** Ambient connection and context state: what this session is attached to and what is
suspended.

**Wire.** Mostly X/T for afleet — the IDE selection bridge, the cloud session URL and the HIPAA
taint label are terminal-side integrations with no headless equivalent recorded in tui-parity.
`memory paused` corresponds to `/pause-memory`, which afleet routes but does not display.

**afleet today.** `undesigned`. The header line in §8.1 carries only title, branch, model and
mode; there is no trailing status cluster.

**GUI form.** A small **trailing glyph cluster on the channel header**, right of the menus, one
glyph per live condition with a tooltip carrying the full string. Carry over three of the five
with their exact semantics: a **connection state** chip using the terminal's three-state colour
rule (accent = connected/connecting, warning = reconnecting, error = disconnected) for afleet's
own engine process — the terminal's cloud chip is the closest thing to "is this session's
subprocess healthy", which afleet must show and currently does not; a **memory paused** chip; and
a **debug** chip when afleet is running against `fake-claude` or a non-default engine path
(root spec §6.10). Drop the IDE selection chip (afleet's Files panel *is* the editor, so the
terminal's "N lines selected in your IDE" has no referent) and the HIPAA taint label
(out-of-scope: no enterprise policy surface). Keep the terminal's ordering rule — taint, cloud,
IDE — as a fixed left-to-right order so the cluster never reflows.

**Drops / keeps / gains.** Drops: IDE selection chip, HIPAA label, `focus` chip. Keeps: the
three-state connection colouring, the fixed ordering, `memory paused`. Gains: hover tooltips carry
the full string, so no truncation; the connection chip can be clickable to restart the engine.

**Open.** Should the engine-health chip be per-channel (each channel is a process) or one
app-level indicator? Per-channel is truer to the model; lane G should confirm it does not collide
with fleet presence.

### A-14 · Terminal-only footer chips with no GUI referent

**Terminal.** Three footer segments named in SPEC 41.15.4 have no analogue: `focus`
(terminal focus tracking, DEC mode-driven, SPEC 41.13.5), the live-selection controls
(`ctrl+c to copy` / `option+click to native select` / `set macOptionClickForcesSelection in VS
Code settings`), and the `Debug` chip's renderer-internals meaning (SPEC 41.27.4).

**Job.** Compensating for things the terminal cannot do natively: knowing whether the window has
focus, and selecting text.

**Wire.** T.

**afleet today.** `superseded`.

**GUI form.** Superseded by AppKit: `NSWindow` focus is a first-class notification, text
selection is native and always available, and the copy-on-select setting
(`copyOnSelect`, SPEC 41.26.2, default `true`) becomes a system behaviour rather than a mode.
Nothing to build. The one inheritance: SPEC's live-selection hints exist because the terminal must
*teach* selection; afleet must not add hints for behaviours macOS already teaches.

**Drops / keeps / gains.** Drops: all three. Keeps: nothing. Gains: real selection, real focus
events, per-window focus rather than one process-wide flag.

**Open.** None.

### A-15 · The `?` shortcuts panel

**Terminal.** SPEC 41.15.4. Toggling help **replaces the whole footer** with a panel listing, in
order: `! for shell mode`, `/ for commands`, `@ for file paths`, `/btw for side question`,
`double tap esc to clear input`, `shift + tab to auto-accept edits`, `ctrl + o for verbose
output`, `ctrl + t to toggle tasks`, `ctrl + _ to undo`, `ctrl + z to suspend`, `ctrl + v to paste
images`, `alt + p to switch model`, `alt + o to toggle fast mode`, `ctrl + s to stash prompt`,
`ctrl + g to edit in $EDITOR`, `/keybindings to customize`. These are **default display labels**
where a chord comes from the binding registry, so user keybindings change them. Three rows are
conditional: suspend, fast mode and `/keybindings`.

**Job.** The one place a user discovers the keyboard without leaving the prompt.

**Wire.** T/R — pure UI.

**afleet today.** `undesigned`. Root spec §8.7 fixes a shortcut set but specifies no place to see
it; §13 records that `~/.claude/keybindings.json` is not honoured yet, so afleet's shortcuts are
its own.

**GUI form.** Two destinations, not one. (a) The **macOS menu bar** is the native answer and is
currently almost unused (§2 of the brief calls it "a legitimate destination"): every shortcut in
§8.7 should appear next to its command in File/Edit/View/Window, which makes the whole set
discoverable with zero new UI. (b) A **Help ▸ Keyboard Shortcuts** window for the ones that have
no menu command (composer gestures: `/`, `@`, `!`, ghost-text Tab-accept). Copy: keep the
terminal's phrasing where the action is the same (`/ for commands`, `@ for file paths`,
`! for shell mode`), macOS-casing the chords. `[exceeds]` The menu bar shows the chord next to the
action *and* invokes it, which the terminal's list cannot.

**Drops / keeps / gains.** Drops: the footer takeover, `ctrl + z to suspend`, `ctrl + g to edit
in $EDITOR`, `/keybindings to customize` (until §13's gap closes). Keeps: the action vocabulary,
the rule that labels come from live bindings. Gains: menu-bar discoverability and invocation.

**Open.** Owner call on whether afleet ever honours `~/.claude/keybindings.json` (§13 lists it as
later work); if it does, the shortcut labels must become binding-derived, as canon's are.

---

## 3. The spinner block: the working-state surface

### A-17 · The spinner row

**Terminal.** SPEC 41.18.1–41.18.4. Eight components make one to three rows. The **glyph** cycles
a 12-frame mirrored array — `·` `✢` `✳` `✶` `✻` `✽` and back (`·` `✢` `✳` `✶` `✻` `✻` under
`TERM=xterm-ghostty`) — driven by a **cosine ease** over a 2000 ms period, so the glyph ping-pongs
and dwells at the ends rather than stepping linearly. The render tick is 100 ms (effective 112 ms
after 16 ms quantisation), 50 ms (effective 64 ms) while `mode === "requesting"`. The **message**
is composed from a fixed chain —
`overrideMessage ?? activeTask.activeForm ?? activeTask.subject ?? (defaultVerb || sampledVerb)` —
always suffixed with `…`, and shimmers one character every 200 ms (50 ms while requesting).

Suffix candidates follow in a fixed order — `spinnerSuffix`, elapsed time, token counter, then
thinking/tool status — joined with ` · ` and wrapped in literal parentheses. **They are not
unconditionally drawn.** The row budget after the message is
`columns − (messageWidth + 2) − 5`; the common visibility flag is
`verbose || hasStatus || totalTokens > 0 || elapsedMs > 16000`; elapsed is admitted only if it
fits after the status candidate and separator; tokens additionally require `totalTokens > 0`; an
overlong progressive thinking label falls back to the literal `thinking` if that fits.

**Elapsed** uses the shared duration formatter, which floors everything from 1 ms to 59999 ms to
whole seconds — **500 ms renders as `0s`, not `0.5s`** — then `Nm Ns`, `Nh Nm Ns`, `Nd Nh Nm`, with
paused time subtracted. **Tokens** are *response characters ÷ 4*, animated toward the true value
rather than jumping, formatted with compact notation lowercased (`842`, `1.2k`, `15.0k`), prefixed
`↓` in every mode except `requesting`, which uses `↑` — e.g. `↓ 1.2k tokens`. The **thinking
label** escalates by elapsed thinking time: `thinking` → `still thinking` (10 s) →
`thinking more` (20 s) → `thinking some more` (30 s) → `almost done thinking` (45 s). The tool
branch reads `running tool for <d>`, with siblings `ran tool for <d>` and `thought for <n>s`.

**Job.** Proof that the machine is alive, plus four independent signals — what it is doing, how
long it has taken, how much it has produced, and whether it is thinking or running a tool. Without
it a long turn is indistinguishable from a hang.

**Wire.** R with one D. Root spec §13 records that **no live tool output reaches the wire**
("Bash, WebSearch, MCP progress and hook status text are silent while a tool runs; afleet tails
task output files and ticks elapsed locally"), so the tool-status branch must be rebuilt host-side
from tool-start/tool-end events. Elapsed is R (host clock). The token counter is D in the
terminal's own form — it is *response characters ÷ 4*, an estimate of the streaming text afleet
also receives, so afleet can compute the identical number from its own delta stream. The verb and
`activeTask.activeForm` come from the task/todo stream (P).

**afleet today.** `designed` only as streaming behaviour: root spec §8.3 specifies delta
coalescing at thirty updates per second and a stable-prefix markdown parse, and §13 says afleet
"ticks elapsed locally". There is no specified working-state row carrying a verb, a token count or
a thinking label.

**GUI form.** A **persistent activity strip pinned between the timeline and the composer**, in the
channel column — not a timeline row, because a timeline row scrolls away and the terminal's
spinner never does. One line, left-aligned:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ✳  Cogitating…    42s · ↓ 1.2k tokens · still thinking          Esc to stop │
│     Tip: Use /btw to ask a quick side question…                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Keep, verbatim: the glyph set and its cosine ease (a GUI can animate it properly at 60 fps rather
than 112 ms steps); the message composition chain, including `activeTask.activeForm` taking
precedence over the random verb, which is what makes the strip informative rather than decorative;
the `…` suffix; the ` · ` separator; the `↓`/`↑` token prefix; the five-step thinking escalation
with its 10/20/30/45 s thresholds and exact copy; the `running tool for <d>` / `ran tool for <d>` /
`thought for <n>s` vocabulary. **Deviate on two points, both because the GUI has width:** show
elapsed and tokens *unconditionally* once a turn is running rather than behind the
`elapsedMs > 16000` visibility flag and the fit tests — the terminal hides them to save columns,
and a user who wants to know how long a turn has run should not have to wait 16 seconds to find
out; and use a real sub-second elapsed reading rather than inheriting the formatter's `0s` floor,
which is a formatting artefact, not a design choice. Put the interrupt affordance at the right end
of the strip as a real button labelled from the live binding (`Esc to stop`), which is where the
terminal's `esc to interrupt` hint effectively points.

`[exceeds]` The strip can carry a determinate progress element the terminal cannot: afleet knows
the tool call count and the task list, so `3 of 7 tools` is available where the terminal has only
an indeterminate glyph.

**Drops / keeps / gains.** Drops: the width-budget admission logic, the `elapsedMs > 16000` gate,
the shimmer character walk, the ghostty-specific frame array, the sub-millisecond formatter
branch. Keeps: glyph set, ease, message chain, separator, token form and prefix, thinking
escalation and thresholds, tool-status vocabulary. Gains: always-visible elapsed and tokens, a
real interrupt button, determinate tool progress.

**Open.** Should the strip persist between turns showing the last turn's duration (the terminal's
`ran tool for <d>` / `thought for <n>s` hint at this), or vanish when idle? Persisting gives a
free "last turn took 2m 14s" readback; vanishing is truer to canon.

### A-18 · The compaction gauge (the spinner's second row)

**Terminal.** SPEC 41.18.4: when a compaction percentage exists and at least 8 columns remain, a
second row is drawn under the spinner row carrying that gauge. It is a distinct row from the
suffix chain and is not subject to the suffix admission tests.

**Job.** Tells you the pause is a compaction, not a hang, and how far along it is — the one
long-running internal operation with no streaming output.

**Wire.** R/D. Compaction is visible to afleet only as its boundary; root spec §13 records that
**microcompact is invisible** ("the engine rewrites old tool results in the model's context
(`hint_clears`) while afleet still shows the originals"), so a live percentage during a full
compaction needs verification against tui-parity's 41.18 rows — unverified here.

**afleet today.** `undesigned`. afleet renders a compact boundary row in the timeline (root spec
§8.4's row vocabulary includes a compact boundary) but nothing during the compaction.

**GUI form.** A determinate progress bar occupying the activity strip's second line while
compaction runs, replacing the tip/narration sub-line, labelled `Compacting conversation…`. If the
wire supplies no percentage, use an indeterminate bar rather than inventing one; the terminal's
gauge only appears when a percentage exists, so its absence is a canon-compatible state.
`[exceeds]` The bar can persist as a completed state in the timeline's compact boundary row,
linking the two surfaces.

**Drops / keeps / gains.** Drops: the 8-column guard. Keeps: the second-row placement, the
percentage when available. Gains: a determinate bar with a real fill.

**Open.** Does any headless frame carry compaction progress? Needs a probe; if not, this is
indeterminate-only.

### A-19 · Reduced motion

**Terminal.** SPEC 41.18.3. `prefersReducedMotion` (the `/config` row **`Reduce motion`**, writing
`prefersReducedMotion` to local settings, default `false` — SPEC 41.26.2) is honoured everywhere,
and a gate can force it on in VS Code-family terminals and xterm.js hosts. When on: **every
interval becomes `null`, so no re-render loop runs**; the glyph becomes a static filled circle
`●` cross-faded on the same 2000 ms cosine; the frame index pins to 0 and the shimmer index parks
off-screen at −100; the brief spinner substitutes a static `"…  "` for its animated dots. The
independent streaming-text animation is suppressed under reduced motion and under Windows Terminal
regardless.

**Job.** Makes a permanently animating UI usable for people whom motion harms, without removing
the state it conveys.

**Wire.** T/R — a local preference.

**afleet today.** `undesigned`, verified: `reduceMotion`, `accessibilityReduceMotion` and
`accessibilityDisplayShouldReduceMotion` appear nowhere in `App/`, `FleetKit/` or `Workbench/`, and
the root spec does not mention reduced motion. Every animated surface afleet adds (the activity
strip of A-17, the sidebar activity dot of A-34) inherits this gap.

**GUI form.** Honour **`NSWorkspace.shared.accessibilityDisplayShouldReduceMotion`** — macOS
already publishes exactly this preference, so afleet should read the system value rather than
adding a setting, which is where a GUI does better than the terminal's own `/config` row. Apply
the terminal's rule literally: the activity glyph becomes a static `●` with a colour cross-fade
instead of a shape cycle; the streaming-text reveal animation is disabled; the jump-to-bottom
scroll becomes instant. Keep the terminal's insight that **reduced motion must not remove
information** — the glyph still cross-fades, so "working" is still visible.

**Drops / keeps / gains.** Drops: the `/config` row (superseded by the system preference), the
shimmer parking trick, the terminal-family force gates. Keeps: the static `●`, the 2000 ms
cross-fade, suppression of the streaming animation. Gains: it tracks the OS preference live,
without a restart.

**Open.** Should afleet also offer an app-level override, for users who want motion in afleet but
not system-wide? The terminal has one; macOS convention says no.

### A-20 · Retry and stall variants

**Terminal.** SPEC 41.18.5. While `retryStatus` is non-null the glyph **and** message are replaced:

| Kind | Headline | Suffix |
|---|---|---|
| `stalled` | `Waiting for API response` | a suffix naming the retry delay and suggesting a network check |
| `low_priority_waiting` | the wait banner, `""` fallback, width-truncated | ` · next try in <d> · attempt <n> · esc to interrupt` (verified verbatim, `cli.pretty.js:369742`) |
| `noResponse` | `No response from the API after <waited>`, width-truncated | final retry: ` · retrying once, waiting up to <wait>`; else ` · retrying, waiting up to <wait> · attempt N/M`; plus a dim second line `A proxy or gateway that buffers streaming responses can cause this · set CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS to change the first wait` |
| default | `API error`, a rate-limit headline, or the formatted error | the retry countdown plus `attempt N/M` |

Stalls emit telemetry at three thresholds — **10 s, 45 s, 300 s**. The rate-limit headline
vocabulary is `session limit`, `weekly limit`, `Opus limit`, `Sonnet limit`, `Fable limit`,
`usage credit limit` (SPEC 41.16.11).

**Job.** Distinguishes "the model is thinking" from "the network is broken" from "you are rate
limited" — three states that look identical without this, and the difference decides whether you
wait or act.

**Wire.** P for the rate-limit case (root spec §13 names `rate_limit_event.resetsAt`), D for the
network-retry case: retry attempts happen inside the engine process and are not, on this evidence,
surfaced as frames. Verify against tui-parity 41.18 before building; unverified here.

**afleet today.** `undesigned`. Root spec §13 records the related gap: "No auto-continue at a
usage-limit reset. The terminal parks and resumes; headless fails the turn. Rebuilt from
`rate_limit_event.resetsAt` in v1.1." So today a rate-limited afleet turn simply fails.

**GUI form.** Replace the activity strip's contents, exactly as the terminal replaces the glyph
and message — the strip is already the right region, and using a banner would over-escalate a
transient retry. Keep all four headlines and the `attempt N/M` / `next try in <d>` suffix
vocabulary verbatim; keep the proxy-buffering second line, which is a genuinely diagnostic
sentence a GUI has more room for, not less. Keep the 10 s / 45 s / 300 s thresholds as the points
at which afleet escalates: at 45 s the strip should gain a **Cancel** button next to the
interrupt; at 300 s it should raise a channel banner, because a five-minute stall in a background
channel is something the user must be told about even while looking elsewhere. `[exceeds]` A GUI
can escalate to a notification for a stalled *background* channel; the terminal has only the row
in front of you.

**Drops / keeps / gains.** Drops: width truncation of headlines. Keeps: four headline forms, the
retry-suffix vocabulary, the proxy hint, the three thresholds, the six rate-limit labels. Gains:
threshold-driven escalation across channels; a stall in a channel you are not watching becomes
visible.

**Open.** Does the headless engine emit anything on a retry? If not, afleet sees a long silence
and must infer the stall from its own clock — which is enough for the `stalled` variant but not
for `attempt N/M`.

### A-21 · The verb list

**Terminal.** SPEC 41.18.6. One array of **186 gerunds** — `Accomplishing`, `Actioning`,
`Actualizing`, `Architecting`, `Baking`, … `Zesting`, `Zigzagging` — including `Clauding`,
`Flambéing`, `Sautéing`, `Whatchamacalliting`. Selection is a uniform unseeded random sample taken
**once per turn**, stored as `defaultVerb` on the per-agent spinner record and re-rolled at each
turn boundary, so **within a turn the word does not change**. The effective list is
settings-driven: `spinnerVerbs: { mode: "append" | "replace", verbs: string[] }` — `replace` with
a non-empty list swaps the array, `append` extends it. There is **no seasonal or holiday variant
and no switch to disable it**; the only calendar-conditional spinner content is the
feature-of-the-week tip campaign. A plugin render hook receives three raw props — `word`
(`defaultVerb`), `message` (`overrideMessage`), `mode` — never the composed string.

**Job.** Turns dead time into a moment of personality, and — because the verb is stable within a
turn but changes between turns — gives a free visual signal that a new turn started.

**Wire.** T/R — purely local; afleet would ship its own copy of the list.

**afleet today.** `undesigned`.

**GUI form.** Keep the mechanism exactly: sample once per turn, hold it stable for the turn,
re-roll at the boundary. **Keep the whole 186-word list verbatim**; it is canon's voice, and
paraphrasing it would be the single most noticeable infidelity in this lane. Honour
`spinnerVerbs` from the user's `settings.json` with the same `append`/`replace` semantics, since
afleet reads the same settings tree. Deviate on nothing. `[exceeds]` afleet can show the verb per
channel, so a fleet view gets six different verbs at once — which is the terminal's charm
multiplied, and worth taking.

**Drops / keeps / gains.** Drops: the plugin render hook (no plugin surface in afleet). Keeps: the
list, the once-per-turn sampling, the stability rule, `spinnerVerbs`. Gains: many verbs visible at
once across channels.

**Open.** None.

### A-22 · Spinner tips: registry, selection, cadence

**Terminal.** SPEC 41.18.7–41.18.11. Tips are the **third line** of the spinner block, rendered
`<label>: <content>` where the label is `Tip` unless an organisation override supplies its own. The
registry is 70 built-in entries plus a dynamic marketplace-plugin family. Each has `id`,
`content(ctx)`, `cooldownSessions` **measured in CLI startups, not wall clock**, optional
`priority`, `maxLifetimeShows`, `advertisedCommand` (the tip is dropped if that command is
unavailable), `providerAgnostic` (required when not on first-party Anthropic inference) and
`isRelevant(ctx)`.

Eligibility is a seven-step filter chain: drop tips whose callback previously threw; keep only
`providerAgnostic` tips off first-party inference; drop unavailable `advertisedCommand`s; run
`isRelevant`; drop tips within cooldown; drop tips at `maxLifetimeShows`; append organisation tips.
**Ranking is deterministic, not random**: primary key is sessions elapsed since last shown,
descending (a never-shown tip scores `Infinity`); tiebreak is `priority`, descending; the winner is
taken. State lives in three `~/.claude.json` keys — `tipsHistory`, `tipLifetimeShownCounts`,
`numStartups` — and the recorder is idempotent within a startup.

**Cadence is one tip per turn**, chosen at the turn boundary behind a per-turn latch. Two
replacements pre-empt the registry when `spinnerTipsEnabled !== false` and there is no next task:
after **strictly more than 30 minutes** in a single turn, `Use /clear to start fresh when
switching topics and free up context`; after **strictly more than 30 seconds**, if the user has
never used `/btw`, `Use /btw to ask a quick side question without interrupting Claude's current
work`. The `/config` row is `Show tips`, writing `spinnerTipsEnabled` to local settings, default
`true`. Organisation overrides (`spinnerTipsOverride`) cap tip text at 500 characters, count at
200, the tips file at 262144 bytes, the label at 40 characters, ids to
`/^[A-Za-z0-9._-]{1,64}$/`, `cooldownSessions` to 0…1000 and `priority` to −10…10; only
`policySettings`, `flagSettings` and `userSettings` are trusted sources, and project scope may
contribute only plain-string tips.

**Job.** Teaches the product during time the user is already spending, at a rate low enough not to
nag — the cooldown-in-startups clock is what makes it feel occasional rather than repetitive.

**Wire.** T/R. The registry, the cooldown clock and `~/.claude.json` are all local; afleet reads
the same file for its project map (root spec §8.2), so the persistence keys are reachable.

**afleet today.** `undesigned`.

**GUI form.** Keep the sub-line as the activity strip's second row, `<label>: <tip>`, dim and
italic (the terminal draws the narration line `dimColor`, `italic`, `truncate-end` — SPEC
41.18a.7). Keep the deterministic ranking and the startup-based cooldown clock **but change the
clock's unit**: afleet's "sessions" are channels, not process launches, so a literal port would
burn every cooldown in an hour. Use *app launches* as the `numStartups` equivalent and keep the
per-startup idempotent recorder, which preserves the intended pacing. Keep `spinnerTipsEnabled`,
`spinnerTipsOverride` and all the organisation limits verbatim — these are policy surface an
enterprise deployment will expect to still work. Filter the registry to tips whose
`advertisedCommand` afleet actually routes (§7.7), which the terminal's own step 3 already does
for free. Keep both 30-minute and 30-second replacements and their exact copy.

**Drops / keeps / gains.** Drops: the marketplace-plugin family, tips advertising terminal-only
commands, the CLI-startup clock's literal meaning. Keeps: the seven-step filter, deterministic
ranking, both replacements and their thresholds and copy, the three persistence keys, the
organisation limits, `Show tips`. Gains: a tip can be a clickable link that runs the command it
advertises, which the terminal can only do with an OSC 8 hyperlink.

**Open.** Owner call: are tips wanted at all in a GUI, where a menu bar and panels already teach
the product? Keeping them is the faithful answer; a lower cadence may be the right one.

### A-23 · The `Next: <task subject>` sub-line

**Terminal.** SPEC 41.18.10. The sub-line has a three-way priority: **narration**, then
`Next: <task subject>`, then `<label>: <tip>`. So a pending next task always outranks a tip, and
narration outranks both.

**Job.** Tells you what the agent will do after the current step, without opening the task list —
the cheapest possible plan readback.

**Wire.** P — task/todo state is on the wire and afleet already renders an Agents panel and a task
run row (root spec §8.8, §8.4).

**afleet today.** `built` adjacent: the Agents panel shows the agent tree with per-agent state
(root spec §8.8), and the timeline has a task run row. What is absent is the *one-line lookahead*
in chrome, so a user must open a panel to learn what is next.

**GUI form.** Keep the three-way priority verbatim in the activity strip's second row:
narration > `Next: <subject>` > `Tip: <tip>`. Keep the `Next: ` prefix. Make the subject clickable,
scrolling the Agents panel to that task. `[exceeds]` afleet can show the count too
(`Next: Run the test suite · 3 more`), which the terminal's single-slot row cannot afford.

**Drops / keeps / gains.** Drops: nothing. Keeps: the priority order and the `Next: ` prefix.
Gains: clickable, and a remaining-count suffix.

**Open.** None.

### A-24 · The turn-narration sub-line

**Terminal.** SPEC 41.18a. A **model-written status sentence**: while a turn runs the harness
periodically issues a *separate* request with its own system prompt and a digest of the turn so
far, and paints the returned sentence where the tip would go. It is **off in this build** unless
explicitly enabled: `CLAUDE_CODE_ENABLE_NARRATION === false` disables it; unset plus a
non-interactive or coordinator session disables it; **it requires the fullscreen renderer** —
`Ta()` false means off, so narration exists only in fullscreen; a dynamic config value above zero
sets the interval; otherwise a truthy variable gives the default **30000 ms**. A second predicate
requires that the focus view is not showing.

The reply is joined, trimmed, reduced to its **first non-blank line**, has control characters
replaced by spaces and whitespace collapsed, has a leading bullet or a `now:` / `status:` / `done:`
label stripped, and is **rejected outright** when it matches `none|n/a|nothing|nothing yet|-|—|not
stated|nothing to report`. A rejected-because-empty answer leaves the previous line in place;
anything else unparseable is a failure. A surviving line is truncated to **240 characters** with a
trailing `…`. It is drawn `dimColor`, `italic`, `wrap: "truncate-end"`, and adds one row of bottom
margin. Three conditions gate the read: the agent id is absent or the current session, brief mode
is off, and no retry banner is showing.

**Job.** A plain-language "what is happening right now" for a turn whose tool calls are opaque —
the only surface in the product that explains the work while it is happening.

**Wire.** D. Narration is generated by a second model request inside the CLI; nothing in the
headless stream carries it, and afleet cannot ask the engine to produce it. Rebuilding it means
afleet issuing its own model call — a product decision, not a rendering one. Unverified against
tui-parity, which is silent on 41.18a as far as this lane read.

**afleet today.** `undesigned`. Note that its terminal gate requires fullscreen, and A-03
establishes that afleet inherits every fullscreen-only behaviour — so the gate is not the obstacle;
the wire is.

**GUI form.** **Design it, do not build it yet.** If afleet ever adds it, keep the whole cleanup
pipeline verbatim — first non-blank line, control-character replacement, label stripping, the
rejection vocabulary, the 240-character truncation with `…`, the "empty answer keeps the previous
line" rule — because those rules are what stop a model-written line from being noise. Keep the
render style (`dim`, `italic`, truncated) and the three read gates. Keep the 30-second default
interval. Region: the activity strip's second row, outranking `Next:` and the tip.
`[exceeds]` A GUI can wrap to two lines instead of truncating at 240 characters, and can fade the
line in on change rather than swapping it.

**Drops / keeps / gains.** Drops: the environment-variable gate (it becomes an afleet setting),
the fullscreen predicate. Keeps: the cleanup pipeline, the rejection list, the styling, the
interval, the priority slot. Gains: wrapping instead of truncation.

**Open.** Product decision for the owner: is afleet willing to spend a second model call per 30
seconds per running channel to narrate? Across a fleet that is a real cost, and it is the reason
canon ships it off by default.

---

## 4. The user's status line

*(A-16 was reserved by A-10's forward reference to the `hideVimModeIndicator` coupling; it is
filled here, at the head of the family it belongs to.)*

### A-16 · The `statusLine` row — a user's own script in the chrome

**Terminal.** SPEC 41.19. A settings key `statusLine: { type: "command", command, padding?,
refreshInterval?, hideVimModeIndicator? }` — `"command"` is the only accepted literal, there is
**no `timeout` field and no `type: "static"`** (SPEC 41.19.1, verified in `cli.pretty.js:233888`).
The harness pipes a large JSON payload to the command's stdin and paints its stdout in the footer,
directly above the hint row, one truncating `Text` per line, dim, with `padding` applied
horizontally only.

The payload (SPEC 41.19.3) is the contract users actually write against: `session_id`,
`transcript_path`, `cwd`, `model{id,display_name}`, `workspace{current_dir,project_dir,added_dirs,
git_worktree?,repo?}`, `version`, `output_style{name}`, `context_window{…,used_percentage,
remaining_percentage}`, `effort{level}?`, `thinking{enabled}`, `rate_limits{five_hour?,seven_day?,
spend_limit?}`, `vim{mode}?`, `agent{name}?`, `pr?`, `worktree?`, plus six groups the documented
schema never mentions but the producer emits: top-level `agent_type`, `scratchpad_dir`, `cost{…}`,
`exceeds_200k_tokens`, `prompt_cache{14 fields}`, `fast_mode` and `remote{session_id}`. Two traps
the spec records: `agent.type` is documented but **never emitted** (the real field is top-level
`agent_type`, so `jq -r '.agent.type'` always yields `null`), and there is no `hook_event_name`.
Rate-limit windows are pre-filtered so a window whose `resets_at` has passed is dropped before the
payload is built.

Cadence (SPEC 41.19.5): one immediate run on first subscribe; a 300 ms-debounced run on any of
eight inputs (`tokenUsage`, `permissionMode`, `vimMode`, `mainLoopModel`, `fastMode`,
`effortValue`, `thinkingEnabled`, `prStatus`) **or a new assistant message**; an immediate
un-debounced run when the command text changes; a periodic run only when `refreshInterval` is set
(`max(1, n) × 1000` ms, itself debounced); and a one-shot run 1000 ms after the soonest rate-limit
or prompt-cache expiry. **Every run aborts the in-flight one** — a slow command is cancelled, never
queued. Nothing in the render path runs the command; renders read a memoised snapshot, and the last
text is cached per session so a remount shows the previous value immediately.

Rendering (SPEC 41.19.6): output is trimmed, split on newlines, each line trimmed, **empty lines
dropped entirely**, rejoined; no line cap, no character truncation in the executor, and ANSI is
**not** stripped. The renderer runs a real ANSI parser — colours, backgrounds, dim, bold, italic,
underline, strikethrough, inverse and OSC 8 hyperlinks all survive — with `dimColor` forced onto
every span, plus a fix-up that re-prefixes each line with the accumulated SGR of all preceding lines
(because each line is an independent `Text` and SGR state would otherwise reset at every newline).
**There is no spinner and no placeholder**: before the first result the row is empty; in fullscreen
a single space reserves it so the layout does not shift; a slow command keeps showing the previous
text; failures and empty output collapse the row silently and no failure detail ever reaches the UI.
Gates: `disableAllHooks`, the feature gate, and **workspace trust** — the last two producing
warn-level diagnostics only in the debug log (`Status line is configured but disableAllHooks is
true`, verified in `cli.pretty.js:505855`). Configuring a status line also sets `suppressHint`,
which turns **off** the classic-layout `? for shortcuts` and `esc to interrupt` hints
(`cli.pretty.js:507528`). Execution is the shared hook runner: `/bin/sh` on Unix, cwd = the
payload's `cwd` with fallbacks, env = a credential-scrubbed `process.env` plus `CLAUDECODE=1`,
`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_PID`, `CLAUDE_PROJECT_DIR`,
`COLUMNS`, `LINES`, and `CLAUDE_EFFORT` when the payload has one; because the schema has no
`timeout`, the effective hard timeout is **600 seconds**.

The clone verified two of these at implementation contact: the failure semantics are asymmetric —
every failure resolves to `undefined`, and a **failed command removes the row** (`tui-ux.md` §3
`statusLine` row and the F8 "§3 `statusLine`" note, which records this as a reversal of an earlier
divergence); and the fullscreen blank row is held open **only when the setting is configured but
unresolved** (`tui-ux.md` D1, verified with a deliberately slow script by check F10).

**Job.** It is the one place in the product a user owns outright. A status line is how people put
their branch, their AWS profile, their token spend, their PR number and their own colour scheme in
front of themselves permanently, without asking anyone. Removing it removes the only
user-programmable pixel in the UI.

**Wire.** P for the *setting*, R for the *execution*, D for six payload fields. tui-parity
area 41 §41.19: the setting is readable through `get_settings` (live:
`{"type":"command","command":"bash /Users/probe/.claude/statusline-command.sh"}`), but **nothing
runs it headless** — the component mounts only when `screen === "prompt"`, which does not exist
headless — so the host must spawn it. Most of the payload is reconstructible from control requests
afleet already issues: `get_context_usage` → `context_window`, `get_usage` → `rate_limits`,
`get_binary_version` → `version`, `initialize` → `output_style`, `agent`, `effort`, and host-owned
state for `cwd`, `workspace`, `transcript_path`, `worktree`, `session_name`. The **D** set is
`cost` (`get_session_cost` returns only a rendered `text` blob, verified live), `prompt_cache` (all
14 fields), `exceeds_200k_tokens`, `pr`, `scratchpad_dir` and `prompt_id`; README §7 finding 3 says
plainly that "a user's existing status script that reads `.cost.total_cost_usd` or `.pr.number`
will print nothing in the GUI."

**afleet today.** `undesigned`. `statusLine` appears in `docs/tui-parity/` and nowhere in the root
spec, the child specs or `App/`. afleet has a Settings window (C5 §9: Environment, Engine, Config
home, Storage, Developer — `App/Views/SettingsView.swift:119-151`) with no status-line pane, and
`ChannelHeaderReadout` (`App/Timeline/Header/ChannelHeaderReadout.swift`) carries branch, model,
mode, effort and context but nothing user-programmable.

**GUI form.** **Honour it: run the command, render it, and disclose the fields the host cannot
supply.** Region: a **second row of the channel header**, under the title/branch/model/mode/effort
row, per channel, full width, dim, monospaced, left-aligned, appearing only when a status line is
configured and has produced output. Not the composer and not a status bar at the window's foot:
the payload is per-session, so the readout must be per-channel, and the header is where the other
per-channel readbacks already live.

```
┌ # fix-auth-tests · main · opus · Auto · ▓▓▓▓▓░░░ 61% ────────────── ⋯ ┐
│ ⎇ main ✚2 ~1 · claude-opus-5 · $4.12 · 61% · ⧗ 3pm reset        [!] │  ← statusLine row
├──────────────────────────────────────────────────────────────────────┤
│  you                                                          16:42  │
```

Keep, exactly: the payload's shape and key names including the six undocumented groups (real
scripts read `cost.total_cost_usd` and `fast_mode`); the eight refresh inputs plus new-assistant-
message, at the same 300 ms debounce; the **abort-not-queue** rule, which is what stops a slow
script from making the row lag minutes behind; `refreshInterval` with its 1-second floor;
`padding` as horizontal only; the ANSI parser including OSC 8 hyperlinks and the cross-line SGR
carry-over, without which a multi-line coloured status line loses its colour after line 1; the
empty-line drop; the "slow command keeps showing the previous text" rule; and the **workspace-trust
gate**, which matters more in a GUI than a terminal because afleet opens many projects at once and
must not execute a repo-adjacent command in an untrusted one.

Two deliberate deviations, both `[exceeds]`. (1) **Surface failures instead of blanking silently.**
The terminal writes `spawn_failed` / `timeout` / `nonzero_exit` / `exec_error` to a debug log the
user never opens; tui-parity area 41 §41.19 names this as an explicit GUI exceed. afleet should
render a small `[!]` affordance at the row's right end which, on click, opens a popover with the
exit code, the last stderr and a *Run again* button. (2) **Name the missing fields once, in
Settings, rather than emitting `null` forever.** A "Status line" pane listing the payload groups
with a per-group source — supplied from the wire / computed by afleet / **not available in afleet**
(`prompt_cache`, `scratchpad_dir`, `prompt_id`; `cost` and `pr` marked "approximated", since afleet
can sum `stream_event` usage against model pricing and query the PR from the git remote) — turns a
silent wrong answer into a known limitation. Emit the unavailable keys as absent rather than `null`
so `jq` defaults and `//` fallbacks in existing scripts still fire.

Drop `hideVimModeIndicator` as a *behaviour* (afleet has no vim editor mode, so there is no
indicator to hide) but keep **reading and preserving the key**, since afleet must not rewrite a
settings file it does not fully model. Drop the `suppressHint` coupling: a GUI has room for both
the status line and the shortcut bar, and tui-parity area 41 §41.19 explicitly says a GUI need not
copy it.

**Drops / keeps / gains.** Drops: `hideVimModeIndicator`'s effect, the `suppressHint` coupling, the
fullscreen reserved-blank-row trick (a GUI row can collapse without shifting anything),
`vim.mode`. Keeps: the payload contract, the cadence and abort rule, `padding`, `refreshInterval`,
the ANSI parser with OSC 8 and SGR carry-over, the trust gate, the empty-line drop, the
previous-text-while-slow rule. Gains: visible failures with stderr, a Settings disclosure of
unsupplied fields, per-channel rendering across many simultaneous sessions, clickable OSC 8 links
that open in afleet's own browser panel.

**Open.** Owner call: is running an arbitrary user shell command per channel, on every assistant
message, acceptable in a GUI that may hold twenty live channels? The terminal runs one. afleet may
need a global concurrency cap and a per-channel opt-out, which is a product decision, not a
rendering one. Second: should afleet also honour `fileSuggestion` (SPEC 41.19.8, the sibling
command hook that replaces the `@` file index)? tui-parity recommends routing `@` completion
through the `file_suggestions` control request instead, which keeps the user's command working for
free — lane C owns the composer, so this card only flags it.

### A-25 · `/statusline` — the setup flow

**Terminal.** SPEC 41.19.7. A `prompt`-type command that dispatches the built-in
`statusline-setup` agent with `allowedTools: [Task, Read(~/**), Edit(~/.claude/settings.json)]`,
`disableNonInteractive: true`, `disableModelInvocation: true`. With no argument the prompt is
`Configure my statusLine from my shell PS1 configuration`; with an argument, the argument. The
agent's system prompt is itself the definitive user-facing documentation of the payload schema
(SPEC 41.19.2), and it instructs the agent to read `~/.zshrc`, `~/.bashrc`, `~/.bash_profile` in
that order and to write long commands to `~/.claude/statusline-command.sh` — a **convention only**;
no code path reads that filename (`cli.pretty.js:694952`). In safe mode the command refuses without
running the agent, explaining that safe mode only displays the managed policy status line and that
the fix is to `restart without --safe-mode` or `unset CLAUDE_CODE_SAFE_MODE` depending on how safe
mode was entered.

**Job.** Nobody hand-writes a JSON-consuming shell script from scratch. The setup flow is what
makes the status line reachable by people who only know they liked their old prompt.

**Wire.** X → R. tui-parity area 41 §41.19: the command is refused headless because of
`disableNonInteractive` (live: `/statusline isn't available in this environment.`), **but the agent
is a normal built-in agent**, so a GUI can dispatch the same setup flow by sending the equivalent
user message — "the cheapest way to get parity on status-line configuration", in the inventory's
own words.

**afleet today.** `undesigned`. The composer command router (root spec §7.7) is where a `/statusline`
entry would land; it has none.

**GUI form.** A **button, not a command**: *Set up from my shell prompt…* in the Settings "Status
line" pane proposed by A-16, which sends the router's equivalent user message into the current
channel and lets the conversation do the work — exactly the terminal's mechanism, with the entry
point moved from a slash command to the place a user goes when they want to configure something.
Keep the no-argument prompt string verbatim. Keep the `~/.claude/settings.json` write target.
`[exceeds]` afleet can show a **live preview** of the resulting row against the current channel's
real payload before the settings file is written — the terminal cannot, because the agent edits the
file and the row simply changes underneath the user. Also keep `/statusline` as a router entry that
opens the same pane, so muscle memory works.

**Drops / keeps / gains.** Drops: the safe-mode refusal text (afleet has no safe mode), the
terminal-oriented gating. Keeps: the agent, its tool allowlist, the default prompt, the settings
target. Gains: a Settings entry point, a live preview before commit.

**Open.** None.

### A-26 · `subagentStatusLine` — per-task decoration

**Terminal.** SPEC 41.19.10. A separate setting that decorates each running task row. It does
**not** go through the hook runner: it shells out directly with a 5000 ms timeout; its stdin is the
shared hook base plus `columns` and a `tasks[]` array; its stdout is **JSONL** — one
`{ id, content }` object per line, malformed lines logged and skipped; its cadence is an initial
tick after 300 ms and then every 5000 ms, guarded against re-entrancy.

**Job.** Lets a user annotate a fleet of running subagents with facts only they can compute — a
ticket id, a queue depth, a cost per agent — in the one place those agents are listed.

**Wire.** R. tui-parity area 41 §41.19 calls it "obscure but cheap: a GUI with a task list can run
the same command and decorate rows identically"; the task list itself comes from
`background_tasks` / `task_*` frames, which afleet already consumes.

**afleet today.** `undesigned`, but the host surface exists: the Agents panel (root spec §8.8)
renders the channel's agent runs as a tree with a transcript beside it, and that tree's rows are
exactly what this setting decorates.

**GUI form.** Keep the whole mechanism unchanged and render each `content` as a trailing dim
suffix on its Agents-panel row, matched by `id`. Keep the 5000 ms timeout, the 300 ms-then-5000 ms
cadence, the re-entrancy guard, the JSONL parse with malformed lines skipped, and `columns` in the
payload (afleet supplies the panel's character-equivalent width, so a script that pads to `columns`
still lines up). Same ANSI parser as A-16. Same trust gate. Same failure disclosure: an `[!]` on
the panel header rather than silence.

**Drops / keeps / gains.** Drops: nothing. Keeps: the shell-out contract, JSONL, cadence, timeout,
`columns`. Gains: rows that can be wider than a terminal's, and per-row hover to see the full
`content` when it is longer than the column.

**Open.** None.

---

## 5. The two notification bars

### A-27 · The pinned bar

**Terminal.** SPEC 41.15.5. Two bars exist: a **pinned** one above the input and a **transient**
one below it. The pinned bar sorts its entries by the same priority map as the queue
(`immediate: 0, high: 1, medium: 2, low: 3`), prefixes **every row with `⚠`**, and defaults each
row to the `warning` colour. **Pinned entries never expire**; they leave only by explicit removal.
A pinned entry with `wrap: true` wraps through its JSX, segments or text branch; without it, it
truncates. Entries carry `key`, `priority`, an optional write-only `kind`
(`feedback | contextual | warning | event | hint | upsell` — SPEC records that no consumer reads
it), and either `jsx`, `segments` or `text`.

The rate-limit auto-continue notice is the family's most important tenant (SPEC 41.16.11): it is
registered **pinned at `high`**, so `Usage limit reached · continuing automatically at 3pm · esc to
cancel` renders as `⚠ Usage limit reached · continuing automatically at 3pm · esc to cancel` — not
in the message list and not in the spinner (`continuing automatically at ` verified in
`cli.pretty.js:832822`).

**Job.** A condition that is still true. Unlike a toast, a pinned row is a claim about the present
state of the session, and it is the only chrome that says "you cannot proceed / something is
waiting" without stealing focus.

**Wire.** D for most of it. tui-parity README §7 finding 7: `system/notification` carries only
`{key, text, priority, color?, timeout_ms?}` — **the pinned/transient split, `jsx`, `segments`,
`invalidates` and `fold` are all local**, as are most call sites (the rate-limit family, the
ultrathink confirmation, the paste eviction, the clipboard miss, the scroll-as-arrows hint). The
host must synthesise equivalents from `rate_limit_event`, `api_retry`, `informational`,
`permission_denied` and its own state.

**afleet today.** `built`, with the wrong denominator. `ChannelBanner`
(`FleetKit/Sources/FleetSessions/Types/ChannelState.swift:105-114`) has exactly seven cases —
`releasedToTerminal`, `contended`, `settingDidNotSurvive`, `mcpDeclineRefused`,
`managedSettingsPending`, `untrusted`, `heldElsewhere` — all of them afleet's own multi-process
concerns, **none** of them the terminal's. It renders as a single `Label` with
`exclamationmark.triangle` under the channel title (`App/Views/ChannelColumnView.swift:119-122`),
which is the right widget and the right glyph. The gap is that root spec §7.6 designs a rate-limit
banner ("A `rate_limit_event` renders a banner at the top of the channel with the limit that
applies and its reset time … until the next event clears it") and an auth banner with a *Sign in*
action, and **neither exists in the built `ChannelBanner` enum**; rate-limit and auth appear only
as Activity **rows** (`App/Activity/ActivityModel.swift:51-53`: `rateLimitRefused` → `Rate
limited`, `rateLimitInfo` → `Rate limit`, `authProblem` → `Sign-in`). The header view is also
marked "Deliberately plain, and replaced whole by C6" (`App/Views/ChannelColumnView.swift:14`), so
this is a seam that is about to be rebuilt — the right moment to widen it.

**GUI form.** The **channel banner** region (root spec §2), directly above the timeline, one strip
per active condition, stacked in priority order, each dismissible only by resolution. Keep the
priority ordering. Keep the never-expire rule — that is the whole distinction between this and
A-28. Keep `⚠` in spirit as the leading glyph and the warning colour, which afleet already uses.
Widen `ChannelBanner` with the terminal's families the wire can supply: rate limit (with the reset
clock and the auto-continue state), auth problem (with the *Sign in* action §7.6 already
specifies), managed-settings-substituted, and the context-limit case of A-37. `[exceeds]` A GUI
banner can carry **actions** — *Cancel the wait*, *Sign in*, *Open usage options* — where the
terminal can only print `esc to cancel` and hope; and it can wrap to two lines instead of choosing
between wrap and truncate.

```
┌ # fix-auth-tests · main · opus · Auto ───────────────────────────────┐
│ ⚠ Usage limit reached · continuing automatically at 3pm              │
│                                     [Cancel the wait]  [Options…]    │
├──────────────────────────────────────────────────────────────────────┤
│  … timeline …                                                        │
```

**Drops / keeps / gains.** Drops: the write-only `kind` field, the wrap/truncate choice, the
`⚠` character itself (an SF Symbol replaces it). Keeps: never-expire, priority ordering, the
warning colour, one row per condition. Gains: buttons, two-line wrap, a matching Activity row so
the same condition is visible from outside the channel.

**Open.** Should a pinned banner also raise a macOS notification when the channel is not in view?
The terminal has no such distinction. afleet's `NotificationRouter` already suppresses
notifications for channels in view (`App/Notifications/NotificationRouter.swift:98-104`), so the
policy exists; the owner decides whether banners join decisions and turn-completions in it.

### A-28 · The transient bar

**Terminal.** SPEC 41.15.5. The transient renderer dispatches on `jsx`, then `segments`, then
`text`, always with `wrap: "truncate"` — **one row, never more** — dimming plain text exactly when
no colour is set. It is mounted twice: in the right-hand footer column and as an absolutely
positioned overlay one row above the prompt. The store around it is the part worth copying:

| Rule | Behaviour |
|---|---|
| Timeout | **One shared 8000 ms timer**, not one per entry. `timeoutMs: 2147483647` is the idiom for "never auto-dismiss but still evictable". |
| Ordering | Lowest numeric priority wins under a **strict** comparison, so ties resolve to the earliest-inserted entry. |
| `immediate` | Bypasses the queue and becomes current synchronously, pushing the incumbent back to the **head** of the queue. |
| Preemption survival | An incumbent survives preemption only if it is not `immediate`, or sets `requeueOnPreempt`, or was held during the diff panel — and is never survived if the incoming entry's `invalidates` lists its key. |
| `fold` | A **merge function**, not a flag: `fold(existing, incoming)` replaces the matching entry. If the match is current, the pending expiry is cancelled and re-armed with the merged `timeoutMs`; if queued, the slot is replaced and no timer is touched. Teammate-started and teammate-shut-down folds *increment a count* rather than last-writer-wins. |
| Dedup | Without `fold`, an entry whose key matches the current or any queued entry is **discarded**, not promoted — first-writer-wins. |
| Diff-panel hold | While the diff panel is visible only `exemptFromDiffPanelHold` entries display; an arriving `immediate` is copied with `heldDuringDiffPanel: true` **keeping its `immediate` priority**, so it can still preempt when it becomes eligible. |

Representative texts: `Deeper reasoning requested for this turn` (ultrathink, `immediate`,
5000 ms), `Scroll wheel is sending arrow keys · use PgUp/PgDn to scroll` (`immediate`, 12000 ms,
`warning`), `Automatic continue cancelled · /rate-limit-options to re-arm` (`immediate`, 8000 ms,
verified in `cli.pretty.js:533950`). The clone rebuilt this store as its shared primitive and
recorded the same semantics at implementation contact — "four priorities, `fold`, `invalidates`,
`pinned`, 8 s default, preemption with head requeue. Every surface that used to hand-roll a timer
posts here" (`tui-ux.md` §3, Wave C row `ST8`) — which is the strongest available evidence that a
single queue, not per-surface timers, is the correct shape.

**Job.** Acknowledges a momentary thing — a keystroke landed, a paste was evicted, a wait was
cancelled — at the place the user is looking, without a dialog and without a permanent scar.

**Wire.** D, same as A-27: only `{key, text, priority, color?, timeout_ms?}` crosses
(tui-parity README §7 finding 7). Most transient entries are host-side anyway, so in afleet they
become the GUI's own.

**afleet today.** `built` as an accident, in the wrong place, with the wrong lifetime.
`ActivityModel.banners` (`App/Activity/ActivityModel.swift:97, 513-525`) is a list of
`AfleetNotification` capped at 8, rendered in the **Activity view** (`App/Views/ActivityView.swift:
72-82`) with an explicit *Dismiss* button, and it exists as spike S-C5-1's in-app fallback for when
`UNUserNotificationCenter` authorisation is absent or afleet is foregrounded
(`App/Notifications/SystemOrInAppPoster.swift`). So afleet has a queue with a cap and no timer, in
a view the user has to navigate to. That is not a transient bar; it is a mailbox.

**GUI form.** A **toast stack over the channel column**, bottom-trailing, above the composer, one
toast at a time with the queue behind it. Port the store's rules wholesale — they are the reason
the terminal never piles up banners:

- Four priorities, strict comparison, ties to earliest-inserted.
- One shared dismissal timer at **8000 ms** default, per-entry `timeoutMs` override.
- `immediate` preempts synchronously and requeues the incumbent at the head.
- `invalidates` as key-list cancellation; `fold` as a merge function, including the
  count-incrementing form for repeated events (afleet's fleet makes "3 agents finished" far more
  likely than the terminal's single session).
- First-writer-wins dedup when no `fold` is given.

Translate the diff-panel hold to afleet's equivalent: **while a modal sheet is up** (the consent
sheet, root spec §2), hold everything except entries marked exempt, keeping `immediate` priority
through the hold. `[exceeds]` A GUI toast can wrap to two or three lines instead of truncating, can
carry an action button, and can be hovered to pause its timer — all three are things the terminal's
one truncating row cannot do. Keep `ActivityModel.banners` as it is for the *unauthorised
notification* fallback, but stop conflating it with this surface: a toast that was shown and expired
should still leave an Activity row, which is the GUI's real advantage over an 8-second string.

**Drops / keeps / gains.** Drops: `wrap: "truncate"`, the double mount (footer column plus
absolute overlay), the write-only `kind`. Keeps: all queue semantics — priorities, shared timer,
8000 ms, `immediate` preemption with head requeue, `invalidates`, `fold` including the counting
form, first-writer-wins dedup, the modal hold. Gains: multi-line toasts, action buttons,
hover-to-pause, and a durable Activity row behind every transient.

**Open.** Fleet-wide question that belongs with lane G: when six channels each raise a toast, does
the user see six toasts over the focused channel, or one aggregated toast plus five Activity rows?
The terminal never faced this. Recommend aggregation by `fold`, but it is an owner call.

### A-29 · Notifications arriving from another process

**Terminal.** SPEC 41.15.5. Frames from the bridge and from cross-session messaging can become
notifications in *this* session's bar, and are validated and clamped before they may. The
validator accepts a frame only when `key` and `text` are strings and `priority` is one of the four
names. Normalisation then: retains `key.slice(0, 256)` and prefixes it with `remote:` (so the final
key can be 263 UTF-16 code units); truncates `text` to **1000** characters and replaces every run
of `\r`, `\n`, `\v`, `\f` and surrounding whitespace with a single space, so **a remote frame can
never occupy more than one row**; **demotes a remote `immediate` to `high`**; keeps `color` only
when it is a string of at most 64 characters that is not an `Object.prototype` key; and clamps
`timeout_ms` into 0…60000. At most **three** `remote:`-prefixed entries may be queued; a fourth
evicts the oldest by key.

**Job.** Lets one session tell you something about another without letting another session own your
screen. Every one of the six constants is a containment rule.

**Wire.** T/X for the mechanism; the *content* is P where afleet has an equivalent channel.
tui-parity does not class this row; treating the bridge path itself as out of afleet's scope is my
reading, **unverified**.

**afleet today.** `superseded`, and the supersession is structural: afleet *is* the multi-session
host, so a "notification from another session" is a notification from another **channel** of the
same app, which afleet already models as an Activity row plus a sidebar badge (root spec §8.2,
§7.6) rather than as a foreign frame injected into the current channel's chrome.

**GUI form.** Superseded by the sidebar and Activity. **What must be inherited is the containment
policy, not the transport.** Every rule above is a defence a multi-session GUI needs at least as
much as the terminal did, because afleet renders text from many engine processes at once: cap the
per-channel foreign-origin toast count (the terminal's three), strip newlines from any string that
will occupy chrome so one channel cannot push another's UI around, cap length before render, refuse
a colour string that is not in afleet's own palette (stronger than the terminal's 64-character
check), and **never let a foreign origin claim the top priority** — the demotion of remote
`immediate` to `high` is the single rule most worth carrying, because `immediate` is the only
priority that preempts synchronously.

**Drops / keeps / gains.** Drops: the `remote:` key prefix, the bridge transport, the 256/64/60000
constants as literals. Keeps: the containment policy — length caps, newline flattening, colour
allowlisting, foreign-origin priority demotion, a queue cap with oldest-first eviction. Gains:
origin is a first-class fact in afleet (the channel and project are known), so a foreign
notification can be attributed and clicked through rather than merely prefixed.

**Open.** None.

---

## 6. Notifications that leave the window

### A-30 · The channel picker and `auto` resolution

**Terminal.** SPEC 41.20.1–41.20.3. `preferredNotifChannel` has seven values —
`auto`, `iterm2`, `terminal_bell`, `iterm2_with_bell`, `kitty`, `ghostty`,
`notifications_disabled` — default `auto`, and it is one of the legacy keys that may still live in
`~/.claude.json` rather than `settings.json` (`preferredNotifChannel` verified in
`cli.pretty.js:98885`). `auto` resolves by terminal: `Apple_Terminal` → `terminal_bell` **only when
the profile's audible bell is off** (probed via AppleScript for the profile name, then the plist's
`Bell` key, so the bell produces a *visual* flash rather than a noise); `iTerm.app` → `iterm2`;
`kitty` → `kitty`; `ghostty` → `ghostty`; **anything else → no method available**. The four
emitters are `ESC]9;<title: message>BEL` (iTerm2), three OSC 99 writes (kitty — a title chunk with
`d=0`, a body chunk, then a terminating chunk with `d=1:a=focus`, so **clicking the notification
focuses the window**), `ESC]777;notify;<title>;<body>BEL` (Ghostty) and a raw `\x07` (bell). All
but the bell are DCS-wrapped under tmux or screen. The app name is `Claude Code`. All notification
text is sanitised first: every code point U+0000–U+001F and U+007F–U+009F becomes a space.
`/config` labels them by wire protocol: `iTerm2 (OSC 9)`, `Terminal Bell (\a)`, `Kitty (OSC 99)`,
`Ghostty (OSC 777)`, `iTerm2 w/ Bell`, `Disabled`.

**Job.** Getting the user's attention when they are not looking at the terminal — which, in
practice, mostly fails: tui-parity area 41 §41.20.2 spells out the consequence, that in most
terminals (plain xterm, tmux, VS Code) the user gets **no OS notification at all**. The clone
confirms it from the other side: it built every channel byte-exactly, under `$TMUX` and `$STY` as
well as bare, and still holds the row at 🟡 because **"no notification has been observed arriving in
a real emulator"** (`tui-ux.md` §3 Desktop notifications, F8 wave).

**Wire.** R. `preferredNotifChannel` is readable through `get_settings` (live: `"terminal_bell"`)
and writable through headless `/config notifChannel=`; tui-parity area 41 §41.20 says a GUI should
read it **as intent** — `notifications_disabled` must silence native notifications too, anything
else means "notify me". The escape sequences themselves are T.

**afleet today.** `built`, and unambiguously better. `UserNotificationPoster`
(`App/Notifications/UserNotificationPoster.swift`) posts through `UNUserNotificationCenter` with
`.alert`, `.sound` and `.badge`; `SystemOrInAppPoster` decides per post from the launch
authorisation status and app activation, falling back to an in-app Activity banner plus a Dock tile
badge when authorisation is not `authorized` or afleet is foregrounded — with the trap documented
in its own header comment, that `deliveredNotifications()` lists a request the centre accepted even
when the user was never shown anything, so the code asks for the authorisation status instead of
asking the centre. Preferences are three booleans (`NotificationPreferences` in
`App/Composition/AfleetStore.swift:96-106`: `permissionRequests`, `turnCompleted`,
`channelFailed`), all defaulting true.

**GUI form.** Keep afleet's native channel; there is nothing here to port. Two things to inherit.
(1) **Honour `preferredNotifChannel` as intent**: read it per channel from `get_settings` and treat
`notifications_disabled` as a hard mute for that session's notifications, so a user who turned the
terminal's notifications off does not get them back by opening afleet. The other six values all
mean "notify me" and collapse to afleet's own toggles. (2) **Match the kitty `a=focus` affordance**
— tui-parity area 41 §41.20.3 names it explicitly as "the affordance to match: clicking a GUI
notification must focus and reveal that session." Also carry the control-character sanitiser
(U+0000–U+001F, U+007F–U+009F → space) into the notification body, since afleet posts engine text
verbatim.

**Drops / keeps / gains.** Drops: all seven channel values as a *picker*, the four escape-sequence
emitters, the AppleScript bell probe, the tmux DCS wrapper, the `/config` protocol labels. Keeps:
`preferredNotifChannel` read as intent (especially `notifications_disabled`), the control-character
sanitiser, the app-name convention. Gains: notifications that actually arrive, a Dock badge, a
sound, an in-app fallback when authorisation is absent — none of which the terminal has.

**Open.** None.

### A-31 · The fourteen notification types and their texts

**Terminal.** SPEC 41.20.1 and 41.20.6. `War` is the notification-type domain, fourteen values:
`permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `agent_needs_input`,
`agent_completed`, `elicitation_url_dialog`, `worker_permission_prompt`, `push_notification`,
`computer_use_enter`, `computer_use_exit`, `quota_auto_resume_fired`, `quota_auto_resume_stale`,
`quota_auto_resume_disabled`. The texts are worth quoting because users recognise them:

| Text | Type |
|---|---|
| `Claude is waiting for your input` | `idle_prompt` (verified in `cli.pretty.js:531216`) |
| `Claude needs your permission to use <tool>` | `permission_prompt` — **hook-only**, see below |
| `Claude Code login successful` | `auth_success` |
| `<name> needs permission for …` / `<name> needs network access to <host>` | `worker_permission_prompt` |
| `<label> needs your input` | `agent_needs_input` |
| `<label> finished` / `<label> failed` | `agent_completed` |
| `Claude is using your computer · press Esc to stop` (or `press Ctrl+C to stop` when the Esc hotkey failed to register) | `computer_use_enter` |
| `Claude is done using your computer` | `computer_use_exit` |
| `Usage limit available — Claude is continuing your task` / `Usage limit reset — press enter to continue` | `quota_auto_resume_fired` / `_stale` |
| `Automatic continue was turned off — the task will not resume on its own` (+ four more phase variants) | `quota_auto_resume_disabled` |

The `permission_prompt` row is the one with real behaviour attached and the one afleet inherits:
it does **not** go through the terminal dispatcher at all. It calls the `Notification`-hook runner
directly, is skipped entirely under `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS`, fires
only after a **6000 ms** timer, and its disposer clears that timer — so **a prompt answered inside
six seconds never notifies**. The timer is `unref`'d so it cannot hold the process open.

**Wire.** D natively, P with the recommended workaround. tui-parity README §7 finding 2: the
internal `os_notification` message that carries these fourteen types and their texts is **dropped by
filter `Cu`** (SPEC 45.9.2), so without intervention a GUI cannot know when to notify with the right
wording; the recommended fix is to **install a `Notification` hook via `initialize.hooks` and read
it back through `--include-hook-events`, which upgrades the whole lane to P.** Message texts
themselves are marked "reuse verbatim; users recognise them" (area 41 §41.20.6).

**afleet today.** `built`, taking exactly the recommended route, and it loses the copy. Root spec
§8.7 registers the hook and states the input is display-ready; `NotificationRouter.postHook`
(`App/Notifications/NotificationRouter.swift:190-202`) copies the hook input's own `message` into
the body **verbatim, rather than reconstructing it** — which is right, and means all fourteen texts
arrive intact. But the title it composes is `"afleet — \(notification_type)"`, so the user sees a
raw protocol identifier — `afleet — agent_needs_input` — above a well-written sentence. afleet's
three self-generated notifications are worse: `A channel is waiting on you` /
`Permission to use <tool>.`, `A turn finished` / `The turn ended with <subtype>.` and `A turn
failed` — where the terminal says `Claude is waiting for your input` and `<label> finished`, afleet
says `The turn ended with success.`, exposing a wire subtype as user copy. The 6-second permission
delay is inherited for free because it is the binary's, and §8.7 correctly records it as such.

**GUI form.** **Keep the engine's text and fix the title.** The title should be the **channel
name** (`# fix-auth-tests`), with the project as subtitle, because in a fleet the identifying fact
is *which session*, not *what kind of event* — a notification type in the title is information the
body already carries in English. Map `notification_type` to the notification's grouping identifier
and to the Activity row's kind, never to displayed text. Replace afleet's three self-generated
strings with the terminal's vocabulary where an equivalent exists: `Claude is waiting for your
input` for an idle prompt, `<label> finished` / `<label> failed` for a completed run,
`Claude needs your permission to use <tool>` for a permission ask — the tui-parity instruction is
"reuse verbatim", and `The turn ended with <subtype>.` fails it. Keep the in-view suppression rule
afleet already has, and keep the 6-second permission delay by leaving it to the engine. `[exceeds]`
Add the click action the terminal only has under kitty: clicking reveals the channel and scrolls to
the decision. Add per-type toggles in Settings rather than afleet's three coarse booleans, since the
engine now supplies fourteen distinguishable types.

**Drops / keeps / gains.** Drops: `afleet — <type>` as a title, `The turn ended with <subtype>.`,
the two computer-use texts (afleet has no computer-use surface), the terminal-channel-specific
types. Keeps: all engine-supplied texts verbatim, the type as a grouping key, the 6-second
permission delay, in-view suppression. Gains: channel-named titles, click-through, per-type
toggles, a Dock badge count.

**Open.** Does afleet want a notification for `auth_success`? The terminal notifies on login
because the login flow leaves the terminal; afleet's sign-in lives in a Terminal tab (root spec
§7.6), so the same reasoning applies and I would keep it — but it is a taste call.

### A-32 · The `Notification` hook as afleet's transport

**Terminal.** SPEC 41.20.5. Every OS notification also fires the `Notification` hook with
`{ hook_event_name: "Notification", message, title, notification_type }` on top of the shared hook
base (`session_id`, `transcript_path`, `cwd`, …). In the terminal this is an *extension point* —
the hook is how a user routes Claude Code's notifications to Slack, a phone or a speaker.

**Job.** In the terminal: user-programmable notification routing. In afleet: the only way the
fourteen types reach the host at all.

**Wire.** P by construction — this is the mechanism tui-parity README §7 finding 2 recommends to
lift notifications from D to P.

**afleet today.** `built`, and the implementation records a hazard worth preserving in the study.
`InitializeConfiguration.afleetDefaults` registers two callback ids, `afleet.notification` and
`afleet.config-change`; `InboundPolicy` therefore **surfaces** them rather than answering by policy,
which means **the engine is waiting** — a router that posted the notification and stopped would
leave the turn hanging. `NotificationRouter` answers every surfaced hook callback with an empty
continue, and its default arm is unconditional rather than a list of known ids, "so registering a
third id cannot reintroduce the hang"
(`App/Notifications/NotificationRouter.swift:76-96, 205-218`). Answers are serialised through a
chained `answerTask` so the engine is answered in ask order.

**GUI form.** Nothing to redesign; the card exists to record the rule. **A host that consumes the
terminal's notifications through the hook has taken on an obligation to answer, and the obligation
is per-callback-id, not per-feature.** Two things to carry forward as afleet grows: (a) an
unconditional default answer arm, so adding a registered id can never re-introduce a hang; (b) the
user's own `Notification` hook, if they have one in `~/.claude/settings.json`, still fires inside
the engine — afleet must not assume it owns the event exclusively, and should not, for example,
suppress a notification on the assumption that nothing else consumes it. `[exceeds]` afleet could
expose the hook's payload in the Activity row's detail, which the terminal never shows.

**Drops / keeps / gains.** Drops: nothing. Keeps: the hook contract, the answer obligation, the
serialised answer order. Gains: notification types the terminal only ever spends on escape
sequences become structured host data.

**Open.** None.

### A-33 · The OSC 9;4 progress bar

**Terminal.** SPEC 41.20.4. iTerm2's progress protocol, written when the terminal's capability
table says the terminal supports it: clear `ESC]9;4;0;BEL`, `error` `;2;<pct>`, `indeterminate`
`;3;`, `running` `;1;<pct>`, percentage clamped to 0…100 and rounded. Which state is written is a
pure function of four booleans — disabled → `null`; `isLoading || hasToolsInProgress ||
hasPendingBackgroundWork` → `indeterminate`; otherwise `completed`. The fourth input matters: **a
session whose foreground turn has finished but which still has a backgrounded subagent or workflow
running stays `indeterminate` rather than reporting `completed`.** The component holds the last
written state in a ref, deduplicates the initial `null`, and clears on unmount only when the
current ref is non-null; it renders no elements of its own. Gated by `terminalProgressBarEnabled`
(default true, `/config` label `Terminal progress bar`). The clone shipped this indeterminate-only
and recorded canon's own tmux-kills-`TERM_PROGRAM` behaviour as transcribed rather than patched
(`tui-ux.md` §3 Terminal progress bar, T-CH34).

**Job.** Tells the *operating system's* chrome — a taskbar, a tab, a Dock tile — that this window is
busy, so the user learns it without looking at the window.

**Wire.** R. tui-parity area 41 §41.20.4: `/config progressBar=true|false` works headless, and
"the macOS analogue is a Dock badge / progress indicator. Honour `terminalProgressBarEnabled` as
'show me progress in the OS chrome'."

**afleet today.** `built` in part, on a different meaning. `DockBadge.set(_:)`
(`App/Notifications/NotificationRouter.swift:220-229`) writes `NSApp.dockTile.badgeLabel` from
`ActivityModel.banners.count` — that is a count of undelivered *notifications*, not a
busy/idle signal. No surface reports "some channel is working" to the OS.

**GUI form.** Two distinct OS signals, and afleet should build the second. Keep the Dock badge as
a **count of things needing the user** (pending decisions across all channels, which is what the
sidebar's Activity count already is — root spec §8.2) rather than the notification-fallback count
it currently shows. Add the terminal's actual semantic as **Dock tile progress**: an indeterminate
indicator whenever any channel satisfies the terminal's own predicate — a turn running, tools in
progress, **or pending background agents or workflows** — cleared when none does. Keep the
four-boolean rule verbatim, especially the background-work clause, because the interesting fleet
case is exactly "the foreground looks finished but three subagents are still running". Honour
`terminalProgressBarEnabled` per the tui-parity reading: a user who turned the terminal's progress
bar off should not get a Dock indicator. `[exceeds]` afleet knows how many channels are busy and
can show a **determinate** progress from completed-to-total task counts, which the terminal's
`indeterminate`-only implementation cannot; and it can put the same signal in the sidebar per
channel, which is where a fleet operator actually looks.

**Drops / keeps / gains.** Drops: OSC 9;4, the capability table, the `error` state (no producer
uses it), the tmux `TERM_PROGRAM` quirk. Keeps: the four-boolean state function including pending
background work, `terminalProgressBarEnabled` as intent, the clear-on-teardown discipline. Gains:
a Dock badge that means "needs you" and a Dock progress that means "working", separated; a
determinate variant; per-channel busy glyphs.

**Open.** Should the Dock badge count decisions only, or decisions plus failed turns? afleet's
Activity view carries both. The terminal has no badge, so there is no canon answer.

---

## 7. The title and the tab

### A-34 · Title resolution and the animated prefix

**Terminal.** SPEC 41.21.1–41.21.4. `n7(title)` writes `ESC]0;<title>BEL`, stripping ANSI first;
`null` suppresses the write. A store computes the title from four candidates with fixed precedence
— `sessionTitle` (an explicit `/rename`) > `aiSessionTitle` (the model-generated session title) >
`agentTitle` (the main-thread agent type when the session was started with `--agent`) >
`haikuTitle` (the utility-model-generated short title) > the default `Claude Code`.

The prefix is a working/idle signal. `ice = ["◐", "◑"]` alternates every **960 ms**, and `sce = "✳"`
is the static form, so the title is `<prefix> <title>` — `✳ Claude Code` when idle. The interval is
armed only when five conditions hold: no title suppression, no `noPrefix`, not pinned static under
a multiplexer (`tengu_static_title_under_mux`, default on), the turn **is** animating, and
`isTerminalFocused` is true. **When the terminal loses focus the interval stops and the glyph
freezes at whatever frame it was showing** — the selector keeps returning the last index rather
than resetting. On exit the title is cleared with `ESC]0;BEL`, written synchronously.

`CLAUDE_CODE_DISABLE_TERMINAL_TITLE` has six functional read sites and does **not** suppress every
OSC 0 write: the FleetView attach path writes the title directly and unconditionally, so a
successful background-job attach retitles the terminal even with the variable set. `/resume` sets
`claude · resume`. `terminalTitleFromRename` controls whether `/rename` feeds the title at all.
The clone built this from nothing and holds it at 🟡 on exactly two named arms — the
`terminalTitleFromRename` setting and the kitty ST-terminator variant, "both recorded as deliberate
skips before implementation and both reachable" (`tui-ux.md` §3 Terminal title) — and separately
recorded that its reduced-motion resolver reaches the title only at construction, so a mid-session
toggle takes effect on the next launch (`tui-ux.md` §3 Reduced motion).

**Job.** Two jobs in one string. Identity: which session is this, in a window switcher that shows
nothing else. Activity: is it working right now, visible from the tab bar without switching to it.

**Wire.** P for the title candidates. `rename_session` and `generate_session_title` are control
requests; the AI session title and the haiku title both reach the host; the agent type is in
`initialize`. tui-parity area 41 §41.21.4 marks the gating settings readable and recommends
honouring `terminalTitleFromRename`. Activity is P from frame traffic afleet already reads.

**afleet today.** `built` thinly, and this is the cheapest high-value gap in the lane. Window
titles are `navigationTitle(row?.title ?? "afleet")` for the channel column
(`App/Views/ChannelColumnView.swift:44`) and a literal `"afleet"` for the root
(`App/Views/RootView.swift:89`); sidebar rows show "title (custom, else AI title, else first
prompt)" per root spec §8.2, which is the terminal's precedence **missing its top and bottom rungs**
— no explicit-rename rung above the AI title, no agent-type or haiku rung below it, and "first
prompt" is afleet's own invention rather than canon's `Claude Code` default. Sidebar badges already
include a "running glyph for a turn in progress" (§8.2), so the activity half exists as a glyph but
not as an animation, and no `[!]`-style freeze-on-blur rule is specified.

**GUI form.** One resolution function, four consumers. Implement SPEC 41.21.2's precedence exactly
— explicit rename > AI session title > agent title > haiku title > a default — and feed it to
**(a)** the macOS window title, **(b)** the sidebar channel row, **(c)** the quick switcher's
entry, and **(d)** the popped-out panel window's title. Replace afleet's "first prompt" rung with
the terminal's `agentTitle` and `haikuTitle` rungs, keeping "first prompt" only as the last resort
before a literal default, since the terminal's haiku title is generated for exactly this purpose
and reaches afleet on the wire. Honour `terminalTitleFromRename`: if the user turned it off, an
explicit `/rename` should not change what the window is called.

Translate the prefix to a **per-channel activity dot in the sidebar**, not a glyph in the title
string: `◐/◑` becomes a small animated indicator, `✳` becomes its static idle form. Keep the
960 ms period, which is slow enough to read as "alive" rather than "urgent". **Keep the
freeze-on-blur rule** — when afleet is not the frontmost application, stop animating and hold the
last frame; the terminal does this to avoid repainting an unwatched window, and macOS wants it for
the same reason plus battery. Bind it to reduced motion (A-19): with reduce-motion on, the dot is
static in both states and the distinction is carried by colour, exactly as the terminal falls back
to `✳`. `[exceeds]` A GUI title can carry the project as a subtitle and the running state as a
document-modified dot, and every popped-out window can be titled independently — three things one
OSC 0 string cannot do.

**Drops / keeps / gains.** Drops: OSC 0, the exit clear, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` and
its six read sites, the multiplexer pin, `claude · resume`, the FleetView attach retitle. Keeps:
the four-candidate precedence, `terminalTitleFromRename`, the 960 ms alternation, the
freeze-on-blur rule, the static idle form. Gains: one title function feeding four surfaces,
subtitles, per-window titles, and an activity indicator that is a real view rather than two
characters.

**Open.** Should a channel whose engine has died show a distinct third state? The terminal has only
working and idle. afleet has crashed and released channels (`ChannelBanner.releasedToTerminal`), so
a third dot state is available and probably wanted — owner call on whether it belongs in the dot or
stays in the banner.

### A-35 · Tab status (OSC 21337) — dead in canon, free in the GUI

**Terminal.** SPEC 41.21.5. A tab-status protocol is fully implemented — a state palette, an
encoder and a clear string — but **the capability predicate is hard-coded `false`, so nothing is
ever emitted**. The palette that would be used, verified at `cli.pretty.js:390122`:

| State | Indicator colour | Status word | Status colour |
|---|---|---|---|
| `idle` | `rgb(0,215,95)` | `Idle` | `rgb(136,136,136)` |
| `busy` | `rgb(255,149,0)` | `Working…` | `rgb(255,149,0)` |
| `waiting` | `rgb(95,135,255)` | `Waiting` | `rgb(95,135,255)` |

The `showStatusInTerminalTab` `/config` row exists and is gated by `tengu_terminal_sidebar`. The
clone lists `CH30` tab status among the surfaces it left unbuilt for the same reason.

**Job.** Would answer "which of my twelve sessions needs me" from the tab bar. It answers nothing
today.

**Wire.** X → **GUI exceeds**. tui-parity area 41 §41.21.5 puts it plainly: "A dead feature in the
terminal that a GUI can simply ship: per-session status colour + word in the tab. The palette is in
the spec."

**afleet today.** `undesigned` as a three-state model, `built` as a two-state one. Root spec §8.2
gives sidebar rows a "running glyph for a turn in progress" and presence text from the registry;
`ChannelHeaderView.presenceLabel` (`App/Views/ChannelColumnView.swift:135-144`) already
distinguishes `idle`, `busy`, `waiting(what)` and `unknown` — **afleet's presence model is
canon's palette plus one**, and it is rendered as caption text, not colour.

**GUI form.** Ship the dead feature. Use the palette's three states as the sidebar channel row's
status colour and the quick switcher's, mapping afleet's existing `Presence` cases directly:
`.idle` → `Idle` green, `.busy` → `Working…` orange, `.waiting` → `Waiting` blue, `.unknown` →
no colour. Keep the canon words verbatim including the ellipsis in `Working…`, since they are the
product's own vocabulary for these states and nothing better exists. Keep the colours as the
starting palette but resolve them through afleet's theme so they survive dark mode and the
daltonized variants (A-42) — the raw RGB triples are tuned for a terminal background.
`showStatusInTerminalTab` becomes an afleet setting for whether the sidebar shows status colour at
all; keep the config row's identity so the value round-trips. `[exceeds]` afleet has a fourth state
the terminal never modelled — a channel held by another process (`ChannelBanner.contended` /
`heldElsewhere`) — which deserves its own colour.

**Drops / keeps / gains.** Drops: OSC 21337, the encoder, the clear string, the always-false
capability predicate, `tengu_terminal_sidebar`. Keeps: the three state names, the three colours as
a starting palette, `showStatusInTerminalTab` as a preference. Gains: the feature actually renders;
a fourth contended state; theme-resolved colours; the same status in the switcher and in a
popped-out window.

**Open.** None.

---

## 8. Context and usage as chrome

### A-36 · The context indicator

**Terminal.** SPEC 13.19.1. A one-line indicator under the input box, driven by the band function
of SPEC 13.4.5. With the default 200,000-token window: effective window 180,000 (window minus a
20,000-token output reserve), compact threshold 167,000, warn threshold 147,000, blocked threshold
177,000. Bands are `ok`, `warn`, `compact`, `blocked`, and **`blocked` wins over `compact`**.

The indicator's most consequential property is that **it renders `null` while the band is `ok`** —
there is no permanent meter — and it is also suppressed for the remainder of any turn in which a
compaction completed. Above `ok` it renders one of two label shapes: `${shown}% until auto-compact`
when the window is enforced, `${100 - shown}% context used` when the window source is `auto`
(`% until auto-compact` verified in `cli.pretty.js:505468`). With auto-compact **on** the line is
dim, and appends ` · <warning tip>` when a rotating warning tip exists. With auto-compact **off**
the line is in the **error** colour and takes one of three forms, selected by a nested ternary in
which the tip is tested first (`cli.pretty.js:505478-505479`):

```text
Context low (<n>% remaining) · <warning tip>          ← whenever a tip exists
Context low (<n>% remaining)                          ← remote autocompact state, or DISABLE_COMPACT
Context low (<n>% remaining) · Run /compact to compact & continue
```

(`Context low (` verified in `cli.pretty.js:505479`.) The clone reached the same place from the
other direction and recorded it as a correction to its own design: "The persistent chip is gone
(D-C3) and the warning is a queued notification on upstream's ladder, hidden below threshold
exactly as `level === "ok"` is" (`tui-ux.md` §3, Context-left % row).

**Job.** Tells you the conversation is about to be rewritten under you, early enough to do
something about it — finish the thought, `/compact` deliberately, or start a new session.

**Wire.** R, and easy to get wrong. tui-parity README §7 finding 4: `get_context_usage` returns
`percentage`, `totalTokens`, `maxTokens`, `autoCompactThreshold` and `isAutoCompactEnabled` on
demand, **but nothing pushes it** outside `CLAUDE_CODE_REMOTE`, so a GUI must poll or its meter
goes stale.

**afleet today.** `built`, and it already exceeds the terminal. `ContextMeterView`
(`App/Timeline/Header/HeaderReadoutView.swift:77-121`) draws a 64×6 capsule with a tint fill for
`totalTokens / maxTokens`, **a one-pixel secondary rule at `autoCompactThreshold / maxTokens`** —
nil when the engine reports no threshold or has auto-compact off, "there is no mark to draw for a
compaction that will not happen" — a trailing `<n>%` label, a hover tooltip carrying the engine's
own per-category breakdown, and an accessibility label
`context used: <n> percent of <max> tokens`. C6.1 §10 records the cadence deliberately: the header
**polls `get_context_usage` after each `result` frame** — "the one place a turn is known to have
ended" — and not on a timer, citing the same parity finding. `ReadbackPoller.swift` is the
mechanism.

**GUI form.** Keep the built meter; it is the right answer and the terminal's absence-until-warn
behaviour is a width constraint, not a design principle. Three additions, all copy rather than
mechanism.

1. **Adopt the band function, not just the percentage.** afleet has `totalTokens`, `maxTokens` and
   `autoCompactThreshold`, which is everything SPEC 13.4.5 needs; compute `ok / warn / compact /
   blocked` and colour the fill accordingly — normal below warn, warning at warn, error at blocked.
   Keep the rule that **`blocked` wins over `compact`**.
2. **Promote warn and above to text, using canon's copy.** Below the meter (or as a banner at
   `blocked`, which is A-37), render the terminal's own strings: `<n>% until auto-compact` when
   auto-compact is on and enforced, `<n>% context used` when the window source is `auto`, and the
   error-coloured `Context low (<n>% remaining) · Run /compact to compact & continue` when
   auto-compact is off. Preserve the three-way selection including the "tip wins" ordering if
   afleet ever ships tips (A-22); otherwise use the `/compact` form.
3. **Keep the gauge visible at `ok`** — the one deliberate deviation. `[exceeds]` A header has room
   the footer never had, and a permanently visible fill with a threshold mark answers "how much
   room is left" without waiting for the answer to become bad news.

Poll cadence: keep C6.1's after-`result` rule, and add a poll after each assistant message as
tui-parity suggests, since a long single turn can cross the compact threshold without producing a
`result`. `[exceeds]` The hover breakdown by category is a genuine GUI-only win over `/context`.

**Drops / keeps / gains.** Drops: the render-nothing-at-`ok` rule, the post-compaction suppression
(a GUI meter that vanishes for a turn is a bug, not a courtesy), the single-line width budget.
Keeps: the band arithmetic and its ordering, all three copy forms and the ternary that chooses
between them, `autoCompactThreshold` as a drawn mark, the after-`result` poll. Gains: a permanent
gauge, a per-category hover, an accessibility label, colour-coded bands.

**Open.** Should the meter be per-channel only, or should the sidebar show a compact indicator for
channels near their limit? The terminal has one session and no answer. A fleet operator probably
wants the second; it belongs with lane G.

### A-37 · The context-limit banner

**Terminal.** SPEC 13.19.2. When the window is actually exhausted, a separate error-coloured
element renders four concatenated children (`Context limit reached` verified in
`cli.pretty.js:833373`):

```text
Context limit reached · <continue><autoCompactOff><tip>
```

`<continue>` is `/compact or /clear to continue`, or `/clear to continue` when `DISABLE_COMPACT` is
set. `<autoCompactOff>` is ` · auto-compact is off · /config to turn it on`, added **only** when
there is no active remote autocompact state and the user turned `autoCompactEnabled` off in their
own settings — so the harness distinguishes "off because you chose it" from "off because policy
says so" and only nags in the first case. `<tip>` is ` · ` plus the current warning tip, or empty.

**Job.** The session is stopped. This is not a warning about the future; it is the reason nothing
happened, and it names the two commands that unstick it.

**Wire.** R. Derivable from the same `get_context_usage` fields afleet already polls, plus
`isAutoCompactEnabled`; tui-parity is silent on this specific element, and treating it as the
`blocked` band of finding 4 is my reading, **unverified**.

**afleet today.** `undesigned`. `ChannelBanner` has no case for it
(`FleetKit/Sources/FleetSessions/Types/ChannelState.swift:105-114`), and afleet's meter shows a
percentage at 100% with no explanation and no action.

**GUI form.** A **channel banner** (A-27), error-coloured, above the timeline, with the terminal's
sentence and two buttons. Keep `Context limit reached` verbatim as the headline. Keep the
conditional `<autoCompactOff>` clause and its distinction between user-chosen and policy-imposed —
render it only when afleet can see that the user's own setting is off, and route its `/config to
turn it on` to afleet's own settings surface rather than the slash command. Replace `/compact or
/clear to continue` with two buttons, *Compact now* and *Clear*, which send the equivalent commands
through the router (root spec §7.7) — the terminal names commands because it can only print text;
a banner with buttons is the same information with the friction removed. `[exceeds]` afleet can
also offer *Fork this channel*, which the terminal cannot: starting fresh while keeping the old
transcript readable is a strictly better third option than `/clear`.

**Drops / keeps / gains.** Drops: the `DISABLE_COMPACT` variant (afleet does not set it), the tip
clause unless tips ship. Keeps: the headline, the conditional auto-compact-off clause and its
user-versus-policy distinction, the two remedies. Gains: buttons instead of command names, a fork
option, an Activity row so a blocked channel is visible from outside it.

**Open.** None.

### A-38 · The rate-limit family and auto-continue

**Terminal.** SPEC 41.16.11 — six surfaces, and the spec is explicit that there is **no
`Claude usage limit reached` literal**; the family is `Usage limit reached · …`.

*The pinned notice* (A-27's most important tenant), registered pinned at `high`, one of three
forms: `Your usage limit has reset · press enter to continue`, `Usage limit reached · continuing
shortly · esc to cancel`, or `Usage limit reached · continuing automatically at <time> · esc to
cancel` (or `… when it resets …` when no time is known).

*Transcript notices*, one per state-machine event — `taken-over`, `cancelled`, `auto-armed`,
`fired-now`, `stale`, `disabled`, `horizon-exceeded`, `continuation-dropped`, `cap-exhausted` —
each with its own sentence, the last three explaining precisely why an automatic continue will
*not* happen: the limit now resets more than 24 hours out; the continuation was blocked before it
reached the model; repeated usage-limit hits exhausted the re-arm cap.

*The inline block* under the rate-limit message: `Continuing shortly · esc to cancel` or
`Continuing automatically at <time> · esc to cancel`, plus `Press ⏎ to continue after reset`, the
headline coloured `error` (`warning` for spend limits).

*Approaching-limit strings*, one builder joining up to three ` · `-separated parts: `You've used
<N>% of your <limit>` (or `Approaching <limit>` with no percentage), then `resets <clock>`, then an
optional call to action that varies by account type and billing access. The limit labels are
`session limit`, `weekly limit`, `Opus limit`, `Sonnet limit`, `Fable limit`, `usage credit limit`.

*Formatting*: the reset clock is 12-hour, minutes suppressed on the hour, meridiem lower-cased —
`3pm` or `3:45pm` — switching to a dated form beyond 24 hours. *Cancellation*: escape and ctrl+c
both cancel and raise an 8-second toast `Automatic continue cancelled · /rate-limit-options to
re-arm` (`cli.pretty.js:533950`); the kill-agents binding is a two-press confirm.

**Job.** A rate limit is the one failure the user cannot fix and must simply wait out. The family's
whole design is to make waiting legible: what limit, when it resets, whether the machine will
resume by itself, and how to stop it if it should not.

**Wire.** P for the events, D for most of the copy. Root spec §13 names `rate_limit_event.resetsAt`
as the rebuildable source, and §7.6 says the banner shows "the limit that applies and its reset
time … until the next event clears it". tui-parity README §7 finding 7 puts the notification texts
themselves in the local-only set.

**afleet today.** `designed`, `built` partially, and split across two surfaces. §7.6 designs the
banner; the built `ChannelBanner` enum has no rate-limit case; what exists is
`ActivityRow.Kind.rateLimitRefused` → `Rate limited` and `.rateLimitInfo` → `Rate limit`
(`App/Activity/ActivityModel.swift:51-52`). Root spec §13 records the underlying gap plainly:
**"No auto-continue at a usage-limit reset. The terminal parks and resumes; headless fails the
turn. Rebuilt from `rate_limit_event.resetsAt` in v1.1."** §7.6 also records a live-observed trap
worth keeping in view — an organisation with overage off reports `status: "allowed"` with
`overageStatus: "rejected"` on a turn that completes, "and that pair must not render as a refusal".

**GUI form.** One **channel banner** carrying the whole state machine, plus an Activity row.
Keep the copy verbatim — `Usage limit reached · continuing automatically at 3pm`, `Your usage limit
has reset · press enter to continue`, and the three "will not resume" explanations, which are the
most information-dense strings in the product. Keep the reset-clock format (`3pm`, `3:45pm`, dated
beyond 24 hours) — it is short because a footer was short, but it is also simply good. Keep the
limit-label vocabulary. Keep the `error` versus `warning` colour split between usage limits and
spend limits.

Translate the keyboard affordances to buttons: `esc to cancel` → *Cancel the wait*; `press enter to
continue` → *Continue*; `/rate-limit-options to re-arm` → *Options…* opening A-39's sheet. Keep
escape bound as well, since afleet already binds Esc to interrupt (root spec §8.7) and the terminal
trained the gesture. The transcript notices become **timeline notice rows** (root spec §2 lists a
notice row form), preserving the terminal's split between a persistent banner and a durable
transcript record — the banner says what is true now, the row says what happened.

`[exceeds]` afleet can do the thing the terminal cannot: a rate limit is account-wide, so **one
banner belongs at the fleet level**, not per channel, with the per-channel banner naming which of
its channels are parked. And when the reset time is known, afleet can show a live countdown and a
*Notify me when it resets* toggle backed by `UNUserNotification` — the terminal can only tell you
to keep the session open.

**Drops / keeps / gains.** Drops: `esc to cancel` as literal copy, the spinner retry row's version
(A-20 covers it), the inline block's duplication of the banner. Keeps: all headline strings, the
three refusal explanations, the reset-clock format, the limit labels, the colour split, the
cancellation gesture. Gains: buttons, a fleet-level banner, a live countdown, a reset notification,
and an Activity row per event.

**Open.** Product decision for the owner: root spec §13 defers auto-continue to v1.1, but the
*display* half of this family is worth building before the behaviour, because "the turn failed
because of a usage limit that resets at 3pm" is strictly better than a failed turn — and it needs
no auto-continue at all.

### A-39 · `/rate-limit-options` and `/usage-credits`

**Terminal.** SPEC 48 §13.11. A hidden `local-jsx` command available to claude.ai subscribers,
titled `What do you want to do?`, offering up to eight entries, each independently gated: *Add
funds to continue with usage credits* / *Switch to usage credits* / *Ask your admin for more usage*;
*Upgrade your plan*; *Stop and wait for limit to reset*; *Wait here, then continue automatically at
`<t>`*; *Don't continue automatically*; *Reset your session limit now*; the spent-reset label
rendered `disabled`; and *Continue now at lower priority…*. Ordering is controlled by an experiment
gate, not by the surface that opened the dialog. Choosing the wait confirms it with `Claude Code
will continue automatically <phrase>. Keep this session open; it may still pause for permission
prompts. Press esc to cancel the wait.`; cancelling says `Automatic continue cancelled. Your session
will wait for you instead; /rate-limit-options can arm it again.` `/extra-usage` is a hidden alias
of `/usage-credits` whose entire description is `Renamed to /usage-credits` (SPEC 08 §3388,
A4 glossary), and `DISABLE_EXTRA_USAGE_COMMAND` removes the purchase flow.

**Job.** The one place a rate limit becomes a set of choices instead of a wall — and the only path
to spending money to continue.

**Wire.** X per panel. tui-parity README §7 finding 5: every `local-jsx` panel is unreachable
headless and "the failure text points users back to the terminal", so a GUI must rebuild the UI and
**intercept the refusal text so users never see 'run it from the Claude Code terminal'.** The
entitlement facts behind the gates (`subscriptionType`, `rateLimitTier`, billing access) come from
account metadata (SPEC 08), which afleet can read; the purchase flow itself is a web surface.

**afleet today.** `undesigned`, and `out-of-scope` in part: the root spec's Settings window is
"currently afleet's own settings, not Claude Code's" (C5 §9), and no billing surface is specified
anywhere in the design.

**GUI form.** A **sheet** opened from the A-38 banner's *Options…* button and from the Activity
row, not a slash command — the terminal made it a hidden command because there was nowhere else to
put it. Keep the title `What do you want to do?` verbatim, keep the entry copy verbatim, keep each
entry's gate, and keep the disabled spent-reset entry visible rather than hidden, because its
presence is what tells a user the option existed and is used up. Keep both confirmation sentences,
dropping only the terminal-specific `Keep this session open` clause — afleet keeps the session open
by existing, which is the point.

Route the two purchase entries out to the web (`claude.ai/settings/usage`, or
`claude.ai/admin-settings/usage` for team and enterprise, per SPEC 48 §14) rather than rebuilding
the 15-state credit dialog; that is a purchase flow, not chrome, and the root spec's §3 scope gives
afleet no billing surface. Keep `/rate-limit-options` and `/usage-credits` as router entries that
open the sheet, and **intercept the headless refusal text** for both, per the tui-parity
instruction.

**Drops / keeps / gains.** Drops: the in-terminal credit purchase dialog, `/extra-usage` as a
separate name (keep it as an alias that opens the same sheet), the experiment-driven entry
ordering. Keeps: the title, all entry copy and gates, the disabled spent-reset entry, both
confirmation sentences. Gains: reachable from a banner rather than a hidden command; the web
purchase flow opens in afleet's own Browser panel.

**Open.** Owner call, and a real scope question: does afleet want any billing surface at all in
v1? A defensible minimum is the *wait* and *don't continue automatically* entries only, with
everything money-shaped deep-linked to the web.

---

## 9. Colour, themes and the accessible renderer

### A-40 · Themes: six tables, `auto`, custom themes, `/theme`

**Terminal.** SPEC 41.10. The `theme` setting takes three shapes: `"auto"`, one of six built-in ids
(`dark`, `light`, `light-daltonized`, `dark-daltonized`, `light-ansi`, `dark-ansi`), or
`"custom:<slug>"`. Each built-in table has the **same 72 keys**; colours are `rgb(r,g,b)` in the
four truecolor themes and `ansi:<name>` in the two ANSI themes. The key set is semantic, not
palette-shaped — `autoAccept`, `planMode`, `permission`, `bashBorder`, `diffAdded`,
`diffAddedWord`, `diffAddedDimmed`, `rate_limit_fill`, `userMessageBackground`, `selectionBg`,
`fastMode`, `briefLabelYou`, the eight `*_FOR_SUBAGENTS_ONLY` colours, seven `rainbow_*` colours
and a `*Shimmer` bright-end twin for every animated token. Any unrecognised theme name resolves to
`dark`.

`auto` resolves through three sources in order: the cached **OSC 11** background query, classified
by relative luminance (`0.2126r + 0.7152g + 0.0722b > 0.5` → light); then `COLORFGBG`'s last
`;`-separated field (indices 0–6 and 8 mean dark, 7 and 9–15 light, anything outside 0–15 ignored);
then `"dark"`. The query is re-sent on every DEC 2031 theme-change notification, so a terminal that
went silent once is re-probed. Custom themes are `<slug>.json` in `~/.claude/themes/`, and the spec
records a real asymmetry: the **write** schema requires `{name, base, overrides}` while the **read**
schema enforces nothing — every field optional, only the top level must be a non-array object, with
`base` falling back to `dark` and `overrides` to `{}` when unusable. `/theme` is `local-jsx` whose
`immediate` flag is **a function of the TUI mode**, `(e, t) => t === "fullscreen"`, so the picker
replaces the prompt immediately in fullscreen and queues like any other dialog inline.

The clone learnt one quirk at implementation contact worth carrying: its `auto` theme had been a
static alias for dark, so a light-terminal user who selected `auto` silently got the dark palette;
it now resolves off `COLORFGBG` with the OSC 11 tier still deferred (`tui-ux.md` §6, `auto` theme
row). Its `/theme` ships five of the built-ins, the two missing ones being specifically the ANSI
variants.

**Job.** Legibility, first — a dark palette on a light background is unreadable — and after that,
the semantic key set is what makes `plan mode` and `auto-accept` recognisable at a glance without
reading the words.

**Wire.** R. `theme` is readable and writable through `/config`; tui-parity area 41 §41.22.1 lists
`/theme` among the `local-jsx` panels that are unreachable headless (finding 5), so afleet
reimplements the picker.

**afleet today.** `undesigned` as theming; `built` as system appearance. Root spec §8.1 says
"Appearance follows the system with the macOS 26 material set; the sidebar uses native vibrancy;
type is the system font", and `App/Views/SettingsView.swift` has no appearance pane — its five
sections are Environment, Engine, Config home, Storage, Developer. So afleet has exactly the `auto`
behaviour and none of the rest.

**GUI form.** **Do not port the theme system; port the key set.** macOS gives afleet light/dark
following the system for free, which is a strictly better `auto` than an OSC 11 probe, and a native
app that ships six palettes when the OS ships two is fighting its platform. What afleet must take
from SPEC 41.10.3 is the **72 semantic tokens**: afleet is already drawing plan mode, auto-accept,
permission cards, diffs with word-level highlighting, subagent colours and a rate-limit fill, and
each of those needs a named colour that resolves per appearance. Define them once as an asset
catalogue with light and dark variants, seeded from the terminal's `dark` and `light` tables, so a
user who moves between the two products sees the same green for `diffAdded` and the same purple for
`autoAccept`.

Keep three things. (1) **The daltonized variants become an accessibility preference**, not a theme
— see A-42. (2) **Custom themes**: honour `theme: "custom:<slug>"` by reading
`~/.claude/themes/<slug>.json` with the terminal's *permissive* read semantics (every field
optional, unusable `base` → dark, unusable `overrides` → `{}`) and mapping the overrides onto the
same 72 tokens. A user who themed their terminal should see it in afleet; the mapping is
one-to-one because the key set is shared. (3) **`/theme` as a router entry** opening an appearance
pane in Settings, with the headless refusal text intercepted.

**Drops / keeps / gains.** Drops: the six built-in tables as selectable themes, the two ANSI
tables (meaningless without a terminal palette), OSC 11 and `COLORFGBG` detection, DEC 2031
re-probing, the fullscreen-conditional `immediate` flag, the `ansi:<name>` colour form. Keeps: the
72 semantic token names and their light/dark values, `custom:<slug>` with permissive read
semantics, `~/.claude/themes/` as the location, `/theme` as a route. Gains: system appearance
following, per-token light/dark asset resolution, and colours that stay correct when the user
switches appearance mid-session — which the terminal only manages by re-probing.

**Open.** Should afleet write to `~/.claude/themes/`, or only read? Reading is unambiguously right;
writing means afleet edits a file the terminal owns. Recommend read-only, and let `/theme` in the
terminal remain the authoring path.

### A-41 · `/color` — the per-session accent

**Terminal.** SPEC 41.9.5. `/color` sets a session-scoped accent used for the prompt bar and, when
the session is a teammate or subagent, its label. The accepted names are the eight keys of the
subagent palette — `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan` — plus five
reset aliases (`default`, `reset`, `none`, `gray`, `grey`). An empty argument picks a **random**
colour. An unknown name returns `Invalid color "<name>". Available colors: <list>, default`. The two
success strings are `Session color reset to default` and `Session color set to: <name>`
(`cli.pretty.js:32119`). A teammate session refuses outright: `Cannot set color: This session is a
teammate. Teammate colors are assigned by the team leader.` (`cli.pretty.js:32110`). The chosen
colour is pushed to the bridge as a session colour tag.

**Job.** Telling your windows apart. With four terminals open on four branches, the prompt-bar
colour is the fastest disambiguator there is.

**Wire.** T/R for the mechanism; the *palette* is the eight `*_FOR_SUBAGENTS_ONLY` theme keys,
which afleet needs anyway for the Agents panel. tui-parity does not carry a row for `/color`; that
it is a `local-jsx` command and therefore unreachable headless is my reading, **unverified**.

**afleet today.** `undesigned`. Channels are distinguished by name and project section (root spec
§8.2) with no per-channel colour.

**GUI form.** Keep it, and widen it. A **per-channel accent colour**, set from the channel's
context menu and from a `/color` router entry, applied to the channel row's glyph in the sidebar,
the channel header's tint and the composer's focus ring — the GUI equivalents of "the prompt bar".
Keep the eight-name palette exactly (it is the same set the Agents panel uses for subagents, so a
subagent and a channel of the same colour agree), keep the reset aliases, keep the random-on-empty
behaviour, and keep the two success strings and the invalid-name string as the router's replies.
Keep the teammate refusal: if a session is a teammate its colour is the leader's to assign, and
afleet should show the assigned colour and disable the control rather than silently ignoring a
change. `[exceeds]` A GUI can colour four surfaces where the terminal colours one, and can persist
the choice per channel across restarts, which a session-scoped setting cannot.

**Drops / keeps / gains.** Drops: the bridge colour tag (afleet is the bridge), session scoping in
favour of per-channel persistence. Keeps: the eight names, the five reset aliases, random-on-empty,
all four reply strings, the teammate refusal. Gains: four tinted surfaces, persistence, and a
colour picker rather than a name to type.

**Open.** None.

### A-42 · Colour capability and the daltonized variants

**Terminal.** SPEC 41.9 and 41.10.3. The renderer detects a colour level, applies a Claude-specific
override chain over it, and downgrades truecolor when the terminal cannot take it — machinery that
exists entirely because a terminal's colour support is unknown. What survives translation is the
**daltonized pair**: `dark-daltonized` and `light-daltonized` are full 72-key tables in which the
red/green distinctions are re-cut for colour-vision deficiency. The substitutions are systematic and
visible in the table — `success` moves from `rgb(78,186,101)` green to `rgb(51,153,255)` blue;
`diffAdded` moves from a green wash `rgb(34,92,43)` to a blue one `rgb(0,68,102)`; `diffAddedWord`
from `rgb(56,166,96)` to `rgb(0,119,179)`; `bashBorder` from pink `rgb(253,93,177)` to blue
`rgb(51,153,255)`. Red is retained and shifted, blue replaces green.

**Job.** Diffs, success/failure and permission states are all encoded in red-versus-green in the
default themes. For roughly one in twelve men, that encoding carries no information at all.

**Wire.** T for capability detection; R for the theme choice. Not classified in tui-parity;
**unverified** beyond the `theme` setting being readable.

**afleet today.** `undesigned`, and the risk is already present. `ContextMeterView` distinguishes
fill from track by tint versus `.quaternary`, which is safe; but afleet's built diff rendering and
decision cards inherit the same red/green convention the terminal uses, and no colour-vision
preference exists anywhere in `App/Views/SettingsView.swift`.

**GUI form.** Drop the capability detection entirely — a Mac display is truecolor. Keep the
daltonized tables as an **accessibility preference**, not a theme: a single "Colour-blind safe
palette" switch in Settings that swaps the red/green tokens of A-40's key set for the daltonized
values, orthogonally to light/dark. That is a better shape than canon's, where the four
combinations are four separate theme ids the user must pick between; afleet gets the same four
combinations from two independent controls. Seed it with the terminal's own substitutions so the
two products agree on what "success" is coloured. `[exceeds]` A GUI should also stop encoding
state in colour alone: `+`/`−` gutters on diffs, a glyph on success and failure rows, and the tab
status **word** alongside its colour (A-35 already keeps `Idle` / `Working…` / `Waiting`), so the
palette is a reinforcement rather than the channel.

**Drops / keeps / gains.** Drops: colour-level detection, the truecolor downgrade, the ANSI
fallback, the daltonized variants as separate theme ids. Keeps: the daltonized substitutions
themselves, as a preference. Gains: orthogonal light/dark × standard/daltonized, and
non-colour redundancy for every state the palette encodes.

**Open.** None.

### A-43 · The screen-reader renderer and accessibility

**Terminal.** SPEC 41.14. Four inputs turn on the accessible path — `--ax-screen-reader`,
`CLAUDE_AX_SCREEN_READER`, `settings.axScreenReader`, and separately `CLAUDE_CODE_ACCESSIBILITY`
(which keeps the cursor visible, uses the native cursor and always draws the line-number gutter).
When screen-reader mode is on, rendering **diverts entirely** from the cell diff to a line-oriented
renderer: flatten the host tree to plain text plus preserve-whitespace ranges, merge those ranges,
hard-wrap each logical line to the terminal width, compute a **park position** where the cursor
should rest so the reader announces the right line, diff against the previous line array by common
prefix, and use two fast paths — a pure append to one line, and a pure erase — before falling back
to reprinting from the first differing line. Two timers shape it: a **startup quiet period**
(default 3000 ms, clamped to 600000) during which no output is emitted at all, and a **pre-park
delay** (default 50 ms) before a large redraw, parking the cursor at column 1 so the reader is not
interrupted mid-utterance. A three-value park anchor (`clean`, `lastRowAnchored`, `broken`) is reset
on resize, `SIGCONT` and alternate-screen transitions. Screen-reader mode also **forces the native
cursor on and disables fullscreen and DECSTBM scrolling** — a whole renderer branch turned off.

**Job.** Making a continuously repainting TUI usable with a screen reader at all. Nearly every
mechanism here is a workaround for the fact that a terminal has no accessibility tree.

**Wire.** T. Purely local rendering.

**afleet today.** `built` by inheritance, and inconsistently. AppKit and SwiftUI give afleet a real
accessibility tree, VoiceOver rotor navigation and live regions for free — everything the terminal
rebuilds by hand. `ContextMeterView` is a good example of using it deliberately
(`accessibilityElement(children: .ignore)` plus `accessibilityLabel("context used: <n> percent of
<max> tokens")`, `App/Timeline/Header/HeaderReadoutView.swift:119-120`); `ChannelHeaderView` labels
its origin glyph. But the coverage is per-view rather than systematic, and no child spec states an
accessibility contract.

**GUI form.** **Superseded by the platform**, with three principles to inherit rather than
mechanisms.

1. **Streaming text must be a live region with a rate limit.** The terminal's startup quiet period
   and pre-park delay exist for one reason: a surface that repaints faster than speech can keep up
   is worse than no surface. afleet coalesces deltas at thirty updates per second (root spec §8.3);
   the accessibility layer must announce at a human rate instead — the completed message, or the
   turn's end, not the delta stream. This is the single highest-risk accessibility decision in the
   app and the terminal already learnt it.
2. **A changing surface should announce the change, not the whole surface.** That is what the
   common-prefix diff and the two fast paths are for. In afleet it means each timeline row is an
   accessibility element that announces once when it settles.
3. **Chrome needs labels, not just values.** The terminal's line renderer flattens everything to
   text, which forces every readout to have words. `61%` alone is meaningless; `context used: 61
   percent of 200000 tokens` is what afleet already does and every other readout in this lane —
   the activity strip, the mode pill, the banners, the status line — needs the same treatment.

Additionally, honour `settings.axScreenReader` as a hint: a user who set it in the terminal has
told the product something true about themselves, and afleet can use it to default the
reduce-motion and announce-rate behaviours even before VoiceOver is detected. `[exceeds]` A real
accessibility tree beats every line-renderer heuristic in this section; the parts of this card that
are work are the announcement policy, not the rendering.

**Drops / keeps / gains.** Drops: the line renderer, park positions and anchors, the append and
erase fast paths, the quiet and pre-park timers, the native-cursor forcing, the fullscreen and
DECSTBM disabling, all four environment switches as switches. Keeps: `settings.axScreenReader` as
an intent hint, and the three principles above. Gains: a real accessibility tree, rotor navigation,
per-element labels, and no renderer branch to maintain.

**Open.** Does the owner want an accessibility contract written into a child spec, the way the
timeline's differential invariant is? Recommend yes: an announcement-rate rule is the kind of thing
that is nearly free to specify up front and very expensive to retrofit.

---

## 10. The settings that drive chrome

### A-44 · The chrome-affecting `/config` rows

**Terminal.** SPEC 41.26.2. Lane E owns the panel; this card owns the eleven rows that change what
this lane's surfaces draw, and where each is stored — which is what decides whether afleet can honour
them.

| id | Label | Type | Writes to | Default | Drives |
|---|---|---|---|---|---|
| `progressBar` | `Terminal progress bar` | boolean | `terminalProgressBarEnabled` | `true` | A-33 |
| `showStatusInTerminalTab` | `Show status in terminal tab` | boolean | **global config** | `false` | A-35 |
| `turnDuration` | `Show turn duration` | boolean | `showTurnDuration` | `true` | A-17's elapsed time |
| `timestamps` | `Show message timestamps` | boolean | `showMessageTimestamps` | `false` | timeline rows (lane B) |
| `timeFormat` | `Time format` | enum `auto`/`12-hour`/`24-hour`/`24-hour-utc` | user settings | `auto` | every clock in chrome |
| `reduceMotion` | `Reduce motion` | boolean | `prefersReducedMotion` (**local**) | `false` | A-19, A-34 |
| `autoScroll` | `Auto-scroll` / `Auto-scroll output` | boolean | `autoScrollEnabled` | `true` | A-06, A-07 |
| `tips` | `Show tips` | boolean | `spinnerTipsEnabled` (**local**) | `true` | A-22 |
| `verbose` | `Verbose output` / `Verbose` | boolean | `verbose` (user) | `false` | spinner and result density |
| `theme` | `Theme` | managedEnum, hint `For custom themes, use /theme.` | `theme` | `dark` | A-40 |
| `notifChannel` | `Notifications` / `Local notifications` | managedEnum or cycling enum | `preferredNotifChannel` | `auto` | A-30 |

Two structural facts matter more than the individual rows. There are only **three row types** —
`boolean`, `enum`, `managedEnum`; no number and no free-text row exists. And a `boolean` renders
its value as the literal string `true` or `false` — there is no glyph and no on/off wording.

**Job.** These are the knobs a user has already turned. Every one of them is a statement about how
they want the product to behave that afleet can read on first launch instead of asking again.

**Wire.** R, and **only half writable**. tui-parity README §7 finding 11: `update_settings` writes
*localSettings only*, and the headless `/config key=value` path accepts 38 of roughly 60 rows —
"everything backed by the global config (`diffTool`, `copyOnSelect`, `gitignore`, `prStatus`,
**`showStatusInTerminalTab`**, `apiKey`, …) plus `autoContinueAtUsageLimit`, `timestamps`" is
unwritable. Reading is broader than writing: `get_settings` returns the merged view.

**afleet today.** `undesigned` for all eleven. `App/Views/SettingsView.swift` has five sections
(Environment, Engine, Config home, Storage, Developer) and C5 §9 states the window holds "afleet's
own settings, not Claude Code's". The nearest thing to an inherited row is `autoScrollEnabled`,
which C6.1 threads from the channel's `get_settings` onto `ChannelHeaderReadout`
(`App/Timeline/Header/ChannelHeaderReadout.swift:67`) and into the table controller's follow rule —
proof that the read path works and that one row already flows end to end.

**GUI form.** **Read all eleven; write only what is writable; never silently disagree.** Three
rules.

1. **Read on channel start and honour immediately**, using `autoScrollEnabled`'s existing path as
   the template. Six of the eleven map directly onto afleet surfaces that exist or are proposed in
   this lane: `autoScroll` (A-06), `reduceMotion` (A-19), `tips` (A-22), `progressBar` (A-33),
   `showStatusInTerminalTab` (A-35), `notifChannel` (A-30), plus `theme` (A-40) as `custom:<slug>`.
2. **Split the Settings window in two**, an "afleet" group and a "Claude Code" group, rather than
   merging them into one undifferentiated list. A user must be able to tell which setting travels
   with them back to the terminal and which is local to this app, because the two have different
   blast radii. Mark rows the protocol cannot write as read-only, with the reason and a link that
   opens the settings file — silently accepting a change that will not persist is the worse
   failure.
3. **`timeFormat` is a system preference in a GUI.** macOS already knows the user's 12/24-hour
   preference and afleet should follow it, but the terminal's `24-hour-utc` value has no macOS
   equivalent and is genuinely useful to someone reading logs across time zones — keep it as an
   afleet override on top of the system default, and keep the terminal's value names so it
   round-trips.

Drop `verbose` (it is a terminal density control; afleet's disclosure is per-row folding, owned by
lane B) and `turnDuration` as a *toggle* — afleet's activity strip (A-17) shows elapsed time while
a turn runs, and a per-turn duration in the turn summary is cheap enough to always show. Drop the
`true`/`false` literal rendering, which is a terminal limitation, not a design.

**Drops / keeps / gains.** Drops: the three-row-type constraint, the `true`/`false` value strings,
`verbose`, `turnDuration` as a toggle, `showStatusInTerminalTab`'s terminal-tab meaning (A-35
re-points it at the sidebar). Keeps: all eleven values and their names, their defaults, the
local-versus-user-versus-global storage distinction as a writability fact, and `24-hour-utc`.
Gains: a settings surface that says which side of the fence each row lives on, and rows that are
honoured at channel start instead of asked about again.

**Open.** Should afleet write to `~/.claude/settings.json` at all, or only through
`update_settings` (localSettings)? Writing directly is more capable and more dangerous — it is the
terminal's own file. Recommend protocol-only writes in v1, with a *Reveal in Finder* affordance for
the rest; the owner should confirm, because it determines whether afleet's Settings window can ever
be the primary place a user configures Claude Code.

---

## Ranking input

| Card | Surface | afleet status | User value | Build cost | Depends on |
|---|---|---|---|---|---|
| A-01 | The layout frame and its renderer branches | `built` | low — a rule, not a feature | S — no work, it fixes a convention | — |
| A-02 | The REPL welcome header | `designed` (readbacks built; no announcement slot) | low — identity is already in the header | S — a one-shot announcement slot | A-34 (title precedence) |
| A-03 | `/tui` inline vs alternate screen | `superseded` | low | S — closed by a card | A-01 |
| A-04 | The fullscreen boot canary | `superseded` | low | S | A-01 |
| A-05 | `/scroll-speed` | `superseded` | low | S | A-06 |
| A-06 | The scroll model and the sticky rule | `built` | high — silently wrong scrolling ruins reading | S — already correct; add the `autoScroll` setting | A-44 |
| A-07 | The jump-to-bottom pill | `built` | med — falls-behind feedback | S — present; add a keyboard binding | A-06 |
| A-08 | The footer as a whole | `designed`/`built` in pieces | high — decides where four other cards land | M — a placement decision plus header/menu-bar work | A-09, A-11, A-13, A-16 |
| A-09 | The hint vocabulary | `designed` | med — teaches the keyboard in context | M — one contextual slot plus a menu-bar pass | A-08, A-15 |
| A-10 | Row-replacing footer states | `undesigned` | med — modal feedback under the field | S — one inline status text | A-08 |
| A-11 | The permission-mode pill and Shift+Tab | `built`/`designed` | high — the most consequential state in a session | S — mostly built | — |
| A-12 | Focusable footer chips | `built` in spirit (panel tabs) | low | S — badge the tabs | — |
| A-13 | Right-column indicator chips | `undesigned` | med — engine health per channel | M — a glyph cluster plus health plumbing | A-08 |
| A-14 | Terminal-only footer chips | `superseded` | low | S | — |
| A-15 | The `?` shortcuts panel | `undesigned` | high — nothing in afleet lists its shortcuts | M — a menu-bar pass plus a shortcut sheet | A-09, root §8.7 |
| A-16 | The `statusLine` row | `undesigned` | high — the only user-programmable pixel | **L** — payload, runner, ANSI parser, disclosure | `get_context_usage`, `get_usage`, `get_binary_version`, A-36 |
| A-17 | The spinner row → activity strip | `designed` (streaming only) | **high — the lane's biggest loss** | L — a new persistent region with four readouts | A-18, A-20, A-22, A-23, A-24 |
| A-18 | The compaction gauge | `undesigned` | med — explains a long pause | S once A-17 exists | A-17; a probe for compaction progress |
| A-19 | Reduced motion | `undesigned` | med — accessibility, and everything animated depends on it | S — one system predicate, honoured everywhere | A-17, A-34, A-35 |
| A-20 | Retry and stall variants | `undesigned` | high — distinguishes broken from slow | M — needs a retry signal from the engine | A-17, A-38 |
| A-21 | The verb list | `undesigned` | low — personality | S — ship the list | A-17 |
| A-22 | Spinner tips | `undesigned` | low — owner may not want them at all | M — registry, ranking, cooldown persistence | A-17, A-44 (`tips`) |
| A-23 | The `Next:` sub-line | `built` adjacent (Agents panel) | med — what happens after this step | S | A-17, Agents panel |
| A-24 | The turn-narration sub-line | `undesigned` | med — the only surface that explains opaque work | L — a second model call per channel | A-17; owner cost decision |
| A-25 | `/statusline` setup | `undesigned` | med — makes A-16 reachable | S — dispatch the built-in agent | A-16, §7.7 router |
| A-26 | `subagentStatusLine` | `undesigned` | low — obscure but cheap | S | A-16, Agents panel |
| A-27 | The pinned bar → channel banner | `built`, wrong denominator | high — rate limit, auth, context limit all land here | M — widen `ChannelBanner`, add actions | A-37, A-38 |
| A-28 | The transient bar → toast stack | `built` as an accident | high — every momentary confirmation in the app | M — port the queue semantics | A-27 |
| A-29 | Remote-frame admission caps | `superseded` | med — the containment policy is worth keeping | S — apply caps to foreign-origin text | A-28 |
| A-30 | Notification channels | `built`, better than canon | med — honour `notifications_disabled` | S | A-44 (`notifChannel`) |
| A-31 | The fourteen types and their texts | `built`, loses the copy | **high — copy regression against canon today** | S — swap strings, retitle | A-32 |
| A-32 | The `Notification` hook as transport | `built` | high — the whole notification lane depends on it | S — already correct; keep the default answer arm | — |
| A-33 | The OSC 9;4 progress bar → Dock | `built` in part, wrong meaning | med — busy vs needs-you in the Dock | S — split badge from progress | A-44 (`progressBar`) |
| A-34 | Title resolution and the animated prefix | `built` thinly | **high — cheapest high-value win in the lane** | S/M — one resolver, four consumers, one dot | A-19, A-35 |
| A-35 | Tab status (OSC 21337) | `undesigned` (three-state), `built` (two-state) | high — "which of twelve needs me" | S — a colour mapping over `Presence` | A-34, A-40, A-42 |
| A-36 | The context indicator | `built`, exceeds canon | high — the band copy is missing | S — add band arithmetic and canon copy | A-37, A-44 |
| A-37 | The context-limit banner | `undesigned` | high — explains a stopped session | S once A-27 is widened | A-27, A-36 |
| A-38 | Rate-limit family and auto-continue | `designed`, partly built | **high — a failed turn today, a legible wait tomorrow** | M for display, L with auto-continue (root §13 defers to v1.1) | A-27, A-39, `rate_limit_event` |
| A-39 | `/rate-limit-options`, `/usage-credits` | `undesigned`, partly `out-of-scope` | med — the only path to continue by paying | M — a sheet plus web deep links | A-38; owner scope decision |
| A-40 | Themes and the 72-token key set | `undesigned` (system appearance built) | high — every other card's colours come from here | M — an asset catalogue plus custom-theme read | A-42 |
| A-41 | `/color` per-channel accent | `undesigned` | med — telling channels apart | S | A-40 |
| A-42 | Daltonized variants | `undesigned` | high — red/green carries state today | S — one preference over A-40's tokens | A-40 |
| A-43 | The screen-reader renderer | `built` by inheritance, inconsistent | high — an announcement-rate rule is cheap now, expensive later | M — an accessibility contract plus a pass over chrome | A-17, A-19 |
| A-44 | Chrome-driving `/config` rows | `undesigned` | high — eleven answers the user already gave | M — read all, write the writable, split the window | A-06, A-19, A-22, A-30, A-33, A-35, A-40 |

---

## For the map

- **One widget carries eight of this lane's surfaces: the channel banner.** Rate limit (A-38), auth
  (root §7.6), context limit (A-37), trust, contended session, managed settings, the pinned
  notification family (A-27) and afleet's seven existing `ChannelBanner` cases all want the same
  strip. It needs a priority order, a never-expire rule, room for actions, and a matching Activity
  row — design it once, as a system, rather than seven times.

- **The channel header is the lane's most contended region and is already carrying five readbacks.**
  Title, branch, model, mode, effort and the context meter are built; this lane proposes adding the
  permission-mode pill (A-11, already there), connection glyphs (A-13), the `statusLine` sub-row
  (A-16) and a status colour (A-35). That is a real overload risk. The resolution that keeps working:
  **one row of identity, one row of user-owned text, and glyphs only for state that has no words** —
  and the menu bar, which afleet has barely used, absorbs everything that is a command rather than a
  readout.

- **The terminal's chrome is built out of two primitives, and both are worth taking whole.** A
  **priority queue with fold and invalidates** (A-28) and a **band function over thresholds**
  (A-36) between them explain the notification bars, the rate-limit family, the context indicator
  and the context-limit banner. Both are small, both are the product of iteration a GUI would
  otherwise redo badly, and both were independently re-derived by the somersault clone at
  implementation contact — the strongest signal in this lane that they are load-bearing.

- **Translate the fullscreen branch, never the classic-inline one.** Established by A-01 and used by
  eight later cards. The fullscreen-only behaviours — a reserved status-line row, a sticky prompt,
  the jump-to-bottom pill, the queued-message list — are exactly the ones a GUI gets for free; the
  inline degradations exist to share a terminal with the shell and have no referent here.

- **A principle the terminal follows that the GUI must keep: chrome never steals the composer, and
  never moves it.** Every footer state in A-10 replaces a *hint*, never the input. Every
  notification in A-27/A-28 is drawn around the prompt, not over it. The fullscreen renderer holds a
  one-space row open so nothing shifts when the status line resolves. A GUI with more space has more
  ways to violate this, not fewer.

- **State that matters is never encoded in colour alone in the terminal, and afleet should hold the
  line.** The mode pill has a word, the tab status has `Idle` / `Working…` / `Waiting` beside its
  colour, diffs have `+`/`−`. The daltonized tables (A-42) exist because the product knows its
  palette does real work; a GUI that leans harder on colour than a terminal does would be a
  regression.

- **The copy is the asset.** Roughly forty verbatim strings in this lane — `Claude is waiting for
  your input`, `Usage limit reached · continuing automatically at 3pm`, `Context low (<n>%
  remaining) · Run /compact to compact & continue`, the three "will not resume" explanations —
  are the product of many iterations and are recognised by users. tui-parity's instruction for them
  is "reuse verbatim". afleet is currently *regressing* on this in the one place it already ships
  (A-31), which is the cheapest defect in the lane to fix.

- **A GUI's real advantage over this chrome is not space; it is persistence and actionability.**
  The terminal's banners expire, its notices scroll away, its keyboard hints name commands. afleet
  can keep every one of them as a durable Activity row, and turn every `esc to cancel` and
  `/compact to continue` into a button. That single transformation applies to A-10, A-27, A-28,
  A-37, A-38 and A-39.

---

## Spec defects

- **SPEC 41.15.5 says `kind` is "write-only — no consumer reads it"** while also enumerating six
  values (`feedback | contextual | warning | event | hint | upsell`). If that is right, the field is
  dead weight in the interface and the enumeration is misleading to a re-implementer; if some
  consumer exists, the claim is wrong. Worth one grep in a future pass. Not load-bearing for this
  lane — A-27 and A-28 drop the field either way.

- **SPEC 41.19.3 documents `prompt_cache` as having 14 fields** while `docs/tui-parity/areas/41-tui-rendering.md`
  (the "payload — real producer" row) says 12. The SPEC's own `interface` block lists fourteen keys.
  The inventory's count is stale; harmless, but it will confuse anyone reconciling the two.

- **tui-parity carries no row for SPEC 41.18a (the turn-narration sub-line)** as far as this lane
  read, so A-24's wire class is my reading rather than the inventory's. Given the mechanism — a
  second model request made inside the CLI — D is nearly certain, but the inventory should say so.

- **tui-parity carries no row for `/color` (SPEC 41.9.5)**, so A-41's class is likewise unverified.
  It is a `local-jsx` command and therefore presumably covered by README §7 finding 5's blanket
  statement, but the palette it draws from is the same one the Agents panel needs, which makes it
  more interesting than a generic panel row.

- **afleet root spec §7.6 designs two banners that the built `ChannelBanner` cannot express.** The
  section says a `rate_limit_event` "renders a banner at the top of the channel with the limit that
  applies and its reset time" and that an `auth_status` problem "renders a banner with the state and
  a *Sign in* action"; `FleetKit/Sources/FleetSessions/Types/ChannelState.swift:105-114` has seven
  cases and neither of these. Both facts currently surface only as Activity rows
  (`App/Activity/ActivityModel.swift:51-53`). Either the enum is incomplete or §7.6 is describing
  the Activity view; the spec should say which.

- **afleet root spec §8.2's channel-title precedence is missing two of canon's rungs.** It gives
  "title (custom, else AI title, else first prompt)" where SPEC 41.21.2 has custom > AI title >
  agent title > haiku title > default. `agentTitle` and `haikuTitle` both reach the host, and "first
  prompt" is afleet's own invention with no canon referent. A-34 proposes the correction.

- **No afleet spec mentions reduced motion or an announcement rate for streaming text.** Verified
  absent from `App/`, `FleetKit/` and `Workbench/`. Both are cheap to specify now and expensive to
  retrofit; A-19 and A-43 give the content.
