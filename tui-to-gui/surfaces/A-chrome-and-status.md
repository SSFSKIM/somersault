# Lane A — chrome and status

**Date:** 2026-09-09. **Canon:** Claude Code 2.1.263 (`/Users/new/claude-code-bundle/2.1.263/SPEC/`,
binary `cli.pretty.js`).

**What this lane covers.** Every terminal surface that is *persistent chrome* rather than
conversation content: the frame the REPL paints around the message list, the footer cluster, the
spinner block and its sub-lines, the two notification bars and the OS-level notification channels,
the `statusLine` command protocol, the terminal title, the welcome header, the scroll pill,
themes and the accessible renderer, and the context/rate-limit readouts that live in chrome rather
than in the transcript.

**SPEC sections read in full.** 41.8.1, 41.8.4, 41.9.5, 41.10.1–41.10.5, 41.12.1, 41.12.4,
41.12.5, 41.14, 41.15.1–41.15.7, 41.16.11, 41.18.1–41.18.11, 41.18a.1, 41.18a.6, 41.18a.7,
41.19.1–41.19.10, 41.20.1–41.20.7, 41.21.1–41.21.5, 41.26.2; 42.22.5; 13.4.5, 13.19.1–13.19.2,
13.18.4.

**Verification spent (`cli.pretty.js` at 2.1.263).** Eight literal greps, all confirming a
load-bearing claim a card depends on: `Jump to bottom` (`:487336`), `% until auto-compact`
(`:505468`), `Context low (` (`:505479`), `Claude is waiting for your input` (`:531216`),
`indicator: "manual mode"` (`chunk-e4pfvp7x.js:282819`, at `cli.pretty.js:282819`),
`Status line is configured but disableAllHooks is true` (`:505855`), ` · next try in `
(`:369742`), and the footer's `suppressHint` / `suppressHintExceptStatusLine` props (`:507528`).

**afleet files read.** Root spec §7.6, §8.1, §8.3, §8.7, §13; C5 §6 and §9; C6.1 §10; C6.2
"The header's menus and actions"; `App/Header/*`, `App/Notifications/*`,
`App/Views/SettingsView.swift`, `App/Composer/ComposerView.swift`, `App/Timeline/*` (activity
row only); `docs/tui-parity/README.md` §5 A-41 and §7; `docs/tui-parity/areas/41-tui-rendering.md`
§§41.15, 41.18–41.21.

**Clone evidence mined.** `CC-to-SDK/docs/parity/tui-ux.md` §3 "Status / chrome", the Wave C and
F8 sections; `docs/superpowers/specs/2026-08-20-f8-spinner-startup-terminal-design.md`;
`docs/superpowers/specs/2026-08-09-wave-c-chrome-composer-design.md`;
`docs/parity/spec-crosscheck-2026-09-03.md`.

**Denominator, with additions.** The task prompt's list is covered card for card. Six surfaces
found in the family and added: the compaction gauge as the spinner's second row (A-19), the
`Next: <task subject>` sub-line that shares the tip slot (A-24), the `?` shortcuts panel that
*replaces* the footer (A-15), the cloud/IDE/debug/focus/`memory paused` right-column chips (A-14),
the pinned-bar `⚠` prefix as a distinct surface from the transient bar (A-27/A-28), and the
remote-frame notification admission caps that let another process write into this session's
notification bar (A-29). The context-limit banner (SPEC 13.19.2) is carded separately from the
context meter because its states and copy differ (A-38).

---

## Headline

1. **The footer is four jobs wearing one row, and afleet should split them four ways, not build a
   footer.** Hints belong on the composer shortcut bar and in the menu bar; the permission-mode
   pill belongs in the channel header next to model and effort; the focusable chips (`tasks`,
   `workflows`, `frame`) belong on panel tabs with badges; the right-column connection chips
   belong in the header as small status glyphs. Nothing in afleet should be a one-row
   space-budgeted strip — the terminal's ` · `-joined, width-elided segment vocabulary
   (SPEC 41.15.4) exists only because it has 80 columns and one row.

2. **The user's `statusLine` script is the hardest single translation in this lane, and the honest
   answer is "run it, render it, and label what is missing".** afleet can build most of the
   payload (`session_id`, `cwd`, `model`, `workspace`, `version`, `output_style`, `cost`,
   `context_window`, `rate_limits`) from wire data it already holds, but three groups have no
   source in a GUI host: `vim.mode` (no vim editor), `prompt_cache` (never on the wire), and
   `exceeds_200k_tokens`/`fast_mode` only if afleet tracks them itself. Proposal: honour the
   setting, run the command on afleet's own cadence, render the ANSI-parsed result as a
   **header sub-row per channel**, and put a "fields this host cannot supply" disclosure in
   Settings rather than silently emitting `null`.

3. **afleet has no working-state surface at all comparable to the spinner block, and that is the
   biggest loss.** The terminal gives four independent readouts on two rows — a verb, elapsed
   time, a live token counter, and an escalating thinking/tool label — plus a sub-line carrying a
   tip, the next queued task, or a model-written narration sentence. A GUI channel that shows only
   "streaming text appearing" tells the user less than the terminal does while idle-looking. This
   should be a **persistent activity strip pinned above the composer**, not a transient row in the
   timeline, so it survives scrolling.

4. **Two of the terminal's notification bars are one GUI widget, and the split matters.** Pinned
   entries never expire and are prefixed `⚠` (SPEC 41.15.5); transient entries share one 8000 ms
   timer and are truncated to one row. Map pinned → **channel banner** (persistent, dismissible
   only by resolution), transient → **toast over the channel**, and keep the terminal's priority
   ordering and `invalidates`/`fold` semantics, because they are what stops a banner pile-up.

5. **The context meter is currently invisible in the terminal until it matters, and afleet should
   invert that.** SPEC 13.19.1: the indicator renders `null` while the band is `ok`, then
   `<n>% until auto-compact` or `<n>% context used`, then the error-coloured
   `Context low (<n>% remaining) · Run /compact to compact & continue`. A GUI header has room for
   a permanent meter `[exceeds]`; keep the terminal's *copy* for the warn and blocked states and
   promote them to a banner, but show the gauge always.

6. **Six terminal mechanisms are wholesale superseded and should be carded and closed, not
   ported:** `/tui` inline-vs-alternate-screen, the fullscreen boot canary, `/scroll-speed`, the
   OSC 9;4 progress bar, OSC 21337 tab status (already inert in canon), and the screen-reader
   line renderer. Each has one thing worth inheriting — named in its card — and the rest is
   terminal plumbing. The most valuable inheritance: **fullscreen-only behaviours** (the reserved
   one-space status-line row, the queued-message list, the sticky prompt, the jump-to-bottom pill)
   are exactly the ones the GUI gets for free, so the GUI should translate the *fullscreen* branch
   everywhere and never the classic-inline degradations.

7. **The terminal title is afleet's cheapest high-value win and is currently unbuilt.** SPEC
   41.21.2's four-candidate precedence (`/rename` > AI session title > agent title > haiku title >
   `Claude Code`) is exactly what a macOS window title, a channel row label and a Dock badge all
   want, and the animated `◐`/`◑` prefix that freezes on focus loss is a working/idle signal afleet
   can reproduce as a per-channel activity dot in the sidebar.

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

**afleet today.** afleet's timeline is a SwiftUI scroll view (`App/Timeline/`); whether it
implements anchoring and auto-re-stick needs to be read against the built code, and the sticky
re-enable rule is the specific behaviour to check.

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

**Open.** Does afleet's timeline currently re-stick on return-to-bottom, or only on send? Needs a
read of the built scroll code.

### A-07 · The jump-to-bottom pill

**Terminal.** SPEC 41.15.2. Present in the fullscreen branch only. Its label is
`${n} new ${plural(n,"message")}` when unseen messages exist, otherwise `Jump to bottom`
(verified in `cli.pretty.js:487336`), with four responsive suffixes chosen by available width:
`(click) ↓`, `: <chord> to scroll`, `(<chord>) ↓`, and a bare `↓`. Scroll pinning is owned by a
store holding the main and modal viewports, an unseen-divider snapshot, a `repin` and a
`jumpToNew`.

**Job.** Tells you that you fell behind, by how much, and gives you one gesture back.

**Wire.** R — host-rebuilt; the unseen count is derived from messages the host already has.

**afleet today.** Needs verification against `App/Timeline/`; a scroll-to-bottom affordance may
exist but the *unseen count* and the unseen-divider snapshot are the parts that are likely absent.

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

**afleet today.** Needs verification against afleet's appearance handling; the root spec does not
mention reduced motion.

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
