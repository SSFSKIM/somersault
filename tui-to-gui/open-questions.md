# TUI-to-GUI study — open questions

Collected from every card's **Open.** paragraph across
`/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/{A,B,C,D,E,F,G}-*.md` (400 cards total;
185 say "None" or a None-with-rationale and are skipped; 215 carry a live open question).

---

## 1. Owner decisions (153 cards, 19 themes)

Themes are ordered by how many cards hang on the decision.

### Settings/MCP/plugin panel scope and consent decisions — 23 cards
**Decision:** for each `/config`-adjacent sub-panel (MCP servers, hooks, plugins, permissions rows,
skills, memory, login), whether afleet builds it in v1 and what its edge-case behavior is (subprocess
calls, re-ask semantics, editor vs viewer).
Cards: E-01, E-03, E-07, E-11, E-12, E-13, E-16, E-17, E-18, E-19, E-20, E-24, E-29, E-37, E-39,
E-40, E-43, E-51, C-18, C-20, C-51, C-62, D-44.
- "Is a `claude mcp get` subprocess per server acceptable to fill in descriptions, or should the panel stay wire-only?" (E-17)
- "Should afleet go further and offer a hook *editor* ... ?" (E-19)
- "Should an edited `.mcp.json` entry re-ask silently (the current hash rule) or announce that it is re-asking?" (D-44)

### Approval-dialog content decisions — 18 cards
**Decision:** for each control-request/approval-dialog family, whether afleet adds friction,
disclosure, or new UI beyond what canon renders.
Cards: D-11, D-13, D-14, D-19, D-20, D-24, D-25, D-28, D-30, D-31, D-34, D-35, D-36, D-37, D-38,
D-40, D-46, D-48.
- "Should the warning also gate the button — for example, requiring the destructive approval to be clicked rather than Return-able?" (D-11)
- "Should the app-level default stay `Never` like canon, or should an unattended fleet default to `10m`?" (D-35)
- "Does the owner want auto mode offered from afleet at all?" (D-25)

### Panel-command UX: session, resume, export, bug-report — 10 cards
**Decision:** how afleet's session/resume/export/rewind commands should behave now that the app has
selectors and panes the terminal never had.
Cards: F-02, F-12, F-13, F-15, F-18, F-24, F-32, F-33, F-35, F-39.
- "Should `Duplicate as branch` copy the *whole* conversation or up to the selected message?" (F-24)
- "Should export cover a message range (from the rewind selector's message list) rather than the whole conversation?" (F-33)
- "Is `/stop` meaning \"interrupt\" a deliberate afleet choice or an accident?" (F-12)

### Scope exclusions in root §3 worth revisiting — 9 cards
**Decision:** whether specific root-spec §3 exclusions (teams, plugins, coordinator mode, worktree UI,
"Remote Control sessions") should actually be relaxed or reinterpreted for v1.
Cards: D-09, D-53, D-56, E-21, E-42, F-17, F-34, B-04, G-43.
- "does \"worktree management UI\" exclude a confirmation that prevents data loss the app itself caused?" (D-56)
- "the \"Remote Control sessions\" exclusion in §3 reads as excluding *cloud sessions driven from claude.ai*, but tui-parity found the reverse capability — afleet's own local channel exposed to the phone. Are those the same exclusion?" (D-53)
- "Does afleet want a plugin surface in v1 at all, or is this the right thing to defer?" (E-21)

### Transcript rendering taste calls — 9 cards
**Decision:** a set of independent taste/spend calls on how the transcript renders tool rows, icons,
diagrams and exports.
Cards: B-01, B-06, B-07, B-23, B-39, B-43, B-52, B-53, B-59.
- "vendor mermaid.js 11.16.1 into the app bundle, or not?" (B-52)
- "Does the owner want per-tool icons at all, or a uniform neutral mark?" (B-01)
- "Is Markdown or JSON the better default?" (B-59)

### Chrome/footer taste calls — 9 cards
**Decision:** a set of independent taste calls on status chrome — version banners, pill counts, hint
priority, and close/stop copy.
Cards: A-02, A-07, A-08, A-09, A-10, A-16, A-17, A-43, F-01.
- "is running an arbitrary user shell command per channel, on every assistant message, acceptable in a GUI that may hold twenty live channels?" (A-16)
- "Should the pill's count be *messages* or *turns*?" (A-07)
- "Which single hint wins the contextual slot when a turn is running *and* a queued message exists?" (A-09)

### Permission/consent dialog policy defaults — 8 cards
**Decision:** what afleet's default trust/consent posture should be for hazardous or ambiguous
permission states canon never fully specified.
Cards: A-11, D-04, D-21, D-42, D-43, D-50, D-55, D-57.
- "Does afleet want the `dontAsk` mode in the picker at all?" (A-11)
- "Does the owner want that third state, or is deferring it to the terminal acceptable?" (D-42)
- "Should `Always allow` default to `localSettings` (canon's only destination) or remember the user's last choice?" (D-21)

### Notification and badge-counting policy — 8 cards
**Decision:** what a badge or notification counts and when it fires now that afleet runs many
channels at once instead of the terminal's one session.
Cards: A-27, A-28, A-31, A-33, A-34, G-01, G-16, G-58.
- "Should the awaiting-input dock badge count decisions or channels?" (G-01)
- "when six channels each raise a toast, does the user see six toasts over the focused channel, or one aggregated toast plus five Activity rows?" (A-28)
- "Should a completed turn in a channel the user *is* looking at, in a window that is *not* frontmost, notify?" (G-58)

### Per-channel vs app-wide scope of a setting or indicator — 8 cards
**Decision:** for each fleet-visible setting or status indicator, whether it lives per-channel,
per-project, or globally.
Cards: A-13, A-36, B-10, E-02, E-04, E-08, E-14, E-28.
- "Should the MCP pane be per-channel (each channel has its own client set) or per-project?" (E-14)
- "Should the Permissions pane be per-project (rules are mostly project-scoped) or global with a project filter?" (E-08)
- "Should the engine-health chip be per-channel (each channel is a process) or one app-level indicator?" (A-13)

### Writing under the config home (§7.8 carve-outs) — 7 cards
**Decision:** which files under the terminal's config home afleet may write to directly, beyond the
one precedent §7.8 already grants.
Cards: A-40, A-44, C-33, E-05, E-10, E-23, E-34.
- "Is a direct write to `<project>/.claude/settings.json` acceptable, given §7.8 grants exactly one precedent (the declined MCP server) ... ?" (E-10)
- "does `history.jsonl` get an exception to §7.8, or does afleet keep its own history and let the two apps diverge?" (C-33)
- "Should afleet write to `~/.claude/settings.json` at all, or only through `update_settings` (localSettings)?" (A-44)

### Fleet-scale sidebar, presence and grouping decisions — 7 cards
**Decision:** how the sidebar and presence model should represent projects, groups, forks and
cross-session visibility that a single-session terminal never needed.
Cards: G-03, G-04, G-18, G-39, G-47, G-51, G-60.
- "is one-way presence acceptable for v1, or is a `publish_presence` control request worth asking Anthropic for before the app ships?" (G-47)
- "Which default should afleet spawn with? `accept` makes afleet channels freely reachable by the user's other sessions, `hold` makes every inbound message a decision." (G-51)
- "Should groups (`ctrl+e`) exist in afleet at all, given the sidebar already has projects and pinning?" (G-04)

### Dialog/decision-card close, escape and stop semantics — 6 cards
**Decision:** what the window's close gesture, Escape, and stop/quit verbs should each do to a
running or pending channel.
Cards: D-01, D-05, D-23, D-58, D-59, D-61.
- "Should closing a card with the window's close gesture (or Escape) do nothing, deny, or stop the turn?" (D-23)
- "Canon's gesture is session-wide, afleet's channel-wide. Is a machine-wide stop wanted?" (D-59)
- "Does the sheet block, or run in the background with an Activity row?" (D-61)

### Billing and usage-credit surfaces — 6 cards
**Decision:** whether afleet builds any in-app billing/rate-limit surface at all, or routes every
money-shaped action to the web or a terminal tab.
Cards: A-38, A-39, B-47, D-41, E-47, E-48.
- "does afleet want any billing surface at all in v1?" (A-39)
- "Does the owner want any purchase flow inside afleet at all?" (E-47)
- "is `/usage-credits` in a Terminal tab an acceptable destination for the billing route, or does afleet want a first-party URL from a source it trusts before it offers the action at all?" (D-41)

### Composer and paste/gesture UX decisions — 6 cards
**Decision:** a handful of composer-specific gesture and default calls (paste-as-text, Tab ownership,
queue-edit position, vim disclosure).
Cards: C-01, C-06, C-11, C-25, C-27, C-38.
- "should a large paste ever land as text when the user clearly wants it inline (a pasted diff they intend to edit)?" (C-11)
- "Tab is also macOS's focus-traversal key ... Confirm that is acceptable before it ships." (C-27)
- "is disclosure enough, or is vim a v1.1 backlog item with the exact SPEC 42.13 scope as its definition of done?" (C-06)

### Keybindings: parity vs native, and the no-write rule — 5 cards
**Decision:** whether afleet's keyboard model should chase terminal muscle-memory parity or go
native, and whether `keybindings.json` earns a write carve-out.
Cards: A-15, C-59, C-60, C-61, C-64.
- "Is the goal parity for a terminal user's muscle memory (implement the map), or a native app with its own shortcuts (read the file only to *warn* about collisions)?" (C-59)
- "Is `keybindings.json` worth a second carve-out ..., or does read-plus-reveal suffice?" (C-61)
- "should afleet's *defaults* include the terminal's `ctrl+` chords as aliases ..., or stay purely native ...?" (C-60)

### Product personality: tips, motion, warmth, personalization — 5 cards
**Decision:** whether to keep the terminal's small personality touches (tips, a random verb, motion,
per-agent colour) in a GUI that already teaches itself differently.
Cards: A-19, A-22, B-60, E-33, G-13.
- "are tips wanted at all in a GUI, where a menu bar and panels already teach the product?" (A-22)
- "Keep the random verb? It is charming in a terminal and may read as noise in a work window." (B-60)
- "Should a user be able to override an agent type's colour in afleet's settings?" (G-13)

### Cost of background model calls — 4 cards
**Decision:** which per-channel background behaviors (turn narration, thinking summaries, away
recaps) are worth spending an extra model call on, multiplied across a whole fleet.
Cards: A-24, B-11, G-35, G-59.
- "is afleet willing to spend a second model call per 30 seconds per running channel to narrate? Across a fleet that is a real cost ..." (A-24)
- "does the recap cost a model turn per channel? ... twelve channels means twelve one-turn forks" (G-59)
- "it turns the model's planning behaviour on ... it is not free, it changes how the model works" (G-35)

### Agent/background-task surface ownership — 3 cards
**Decision:** where background shells, monitors and agent-progress rows live in the panel structure,
and how much running-agent history stays visible.
Cards: F-09, G-10, G-29.
- "Does the Running section belong in the Agents tab (lane G's territory) or as its own `Tasks` tab?" (F-09)
- "is three still right, or should a running agent show five and a finished one collapse to zero?" (G-10)
- "Is it worth afleet building a bespoke surface for a feature most users never see?" (G-29)

### What the terminal handoff may say — 2 cards
**Decision:** when afleet is allowed to tell the user to go finish something in a terminal, and how
that moment is worded.
Cards: D-45, E-27.
- "Is a one-time \"open Claude Code in a terminal now\" onboarding step better than a per-channel banner?" (D-45)
- "Does the \"never tell the user to go back to the terminal\" rule admit an exception for commands about products afleet deliberately does not host?" (E-27)

---

## 2. Probes (35 cards)

Each line: card id — question — what would answer it.

- A-18 — Does any headless frame carry compaction progress? — live probe (headless engine during compaction)
- A-20 — Does the headless engine emit anything on a retry? — live probe (headless engine during a tool retry)
- B-21, D-15 — Does afleet's Files panel render `.ipynb` today? — afleet source read (Files panel)
- B-35 — Is `CLAUDE_CODE_REPORT_FINDINGS` set in afleet's spawned environment? — afleet source read (child-launch env vars)
- B-42 — Does C7.7's Source Control panel already offer a *session* diff base? — afleet source read (Source Control panel)
- B-56 — At what transcript length does tracker 132's per-reload hosting measurement actually stall? — live probe (long transcript, measure reload cost)
- B-63 — Is the aggregate `(412ms)` hook timing reconstructible from `hook_started`/`hook_response` timestamps? — live probe (capture hook wire frames)
- B-66 — Is `messages_summarized` present at afleet's target CLI version? — binary grep (vendored CLI)
- C-19 — Does the submit-time extractor accept `@path#L12-30` line ranges from a host frame? — afleet source read (submit-time extractor)
- C-39 — Can afleet influence prompt-queue batching at all from the host side? — live probe (wire capture on submit)
- C-40 — Does reading absorption off `completed`-vs-`result` ordering hold up? — live probe (live capture during mid-turn absorption)
- C-49 — Can afleet probe permission-mode availability with an optimistic `set_permission_mode`? — live probe (attempt `set_permission_mode`)
- C-54 — Does afleet honour `CLAUDE_CONFIG_DIR` when it differs from the child's? — afleet source read (config-home resolution)
- D-08 — Does opening the same session in Terminal actually let the user answer a pending control request raised against the headless host? — live probe (headless host + Terminal handoff)
- D-12 — Does afleet have the full permission rule set at hand via `get_settings`? — afleet source read / live probe (`get_settings` response shape)
- D-17 — Does the engine send `permission_suggestions` on an org-capped ask? — live probe (org-capped MCP tool ask)
- D-18 — Can afleet distinguish `plugin` and `remote-agent` request sources today? — afleet source read (request-source field handling)
- E-01 — Does `/config key=value` sent to a channel with no model configured still write? — live probe (afleet flag set, no-model channel)
- E-09 — Can any of the six memory-only permission sources be inferred from `system/permission_denied` frames? — live probe (wire capture on denial)
- E-16 — Does afleet need a probe to read the needs-auth cache file for retry timing? — afleet source read / binary grep (cache file schema)
- E-32 — Does `apply_flag_settings {advisorModel: "opus"}` move `get_settings.applied.advisor`? — live probe (one round trip)
- E-52 — Does `/desktop` write `<sessionId>.desktop-released.json`? — live probe (`/desktop` call)
- F-01 — Which of the twenty-eight provider rows can afleet populate, depending on launched env vars? — afleet source read (child-launch env vars)
- F-26 — Is there a wire route to *write* a session tag? — binary grep (wire route inventory)
- F-29 — Does `summarize_metadata` actually initiate a partial compaction, or only describe one? — live probe
- F-31 — Are there eight rewind-refusal strings or ten? — binary grep (terminal CLI strings)
- F-44 — Which `/init` body does afleet's engine use (`CLAUDE_CODE_NEW_INIT` or not)? — afleet source read (child-launch flags)
- G-07 — Where does the fleet-nudge "needs" string come from for an afleet channel? — live probe (confirm against a live decision card)
- G-14 — Does afleet pass `--forward-subagent-text` unconditionally? — afleet source read (child-launch flags)
- G-15 — What do the `agentProgressSummaries` frame's field names and cadence look like? — live probe (afleet flag set, slow agent)
- G-17 — Does the parked-agent inference mis-fire on a shell keepalive (`bash:<id>`) rather than a child agent? — live probe (long background shell owned by a subagent)
- G-25 — Does `tool_progress` now carry live output for a foreground call (re-run probe 84 post-2.1.259)? — live probe
- G-44 — Does `suppressWorkflowKeyword` have a headless route? — binary grep / live probe (headless engine)
- G-45 — Is workflow phase structure on the wire, or only inside the `Workflow` tool's result? — live probe (headless two-phase `local_workflow`)

---

## 3. Build-time unknowns (17 cards)

- B-12 — Right threshold for collapsing a tool-call cluster in a wider window (two calls vs three).
- B-17 — Cache decoded images to disk or hold in memory across a long session.
- B-37 — How many MCP servers a typical afleet session hosts (determines if the progress bar is worth building).
- B-68 — Whether the reducer should prefer its in-memory copy over a re-read file on a clearing-sentinel version.
- C-16 — Whether the attachment tray also holds the text-paste chip, or that needs a second row.
- C-30 — Where the slash-command usage record physically lives in afleet's own store.
- C-31 — Whether a periodic, `/clear`-free remedy for the non-git stale file-index is feasible.
- C-37 — How much of a long queued prompt a row should show (one line + tooltip vs two lines + fade).
- D-27 — What GUI rendering budget replaces the terminal's 200,000-character plan guard.
- D-33 — Whether a question dialog's preview pane opens by default or on hover/focus, given list density.
- E-31 — Whether a draggable `/autocompact` threshold needs a confirmation step or a snap-back preview.
- E-36 — Whether the `.mcp.json` consent sheet should appear before or after a working-directory move.
- E-56 — Whether Background rows should show `PID` and schedule.
- F-04 — Whether the `/context` popover should poll on open and on a timer while visible.
- F-20 — Whether hovering a sidebar row should preview it, or only `⌘K` focus should.
- F-27 — Deriving, at attach time, a host-side capability flag for "adopted" (non-afleet-launched) sessions so F-29's restore options can be hidden correctly.
- G-02 — Whether a fleet row shows both `preview` and `detail` on two lines, or collapses to one.

---

## Counts

- Owner decisions: 153 cards across 19 themes
- Probes: 35 cards (34 lines after one merge)
- Build-time unknowns: 17 cards
- Unclassified: 13 Open paragraphs (see below)
- Total open-question cards: 215 (153 + 35 − 3 dual-tagged owner/probe [E-01, E-16, F-01] + 17 + 13 = 215)

## Open paragraphs that could not be classified

These pose no live owner/probe/build decision — they are cross-lane bookkeeping notes, dependency
pointers to another card, or (in G-09's case) a question already resolved within the paragraph itself:

- B-31 — orchestrator dedupe note (answered echo belongs to lane D, rendered in lane B)
- B-32 — same dedupe note as B-31 (pending-plan card is lane D's)
- B-62 — cross-lane split note (queue chip: composer half to C, timeline half to B)
- C-14 — cross-reference only ("Covered by C-33")
- C-34 — dependency note only ("Depends entirely on C-33")
- D-06 — hypothetical future-feature default, not a current decision
- D-07 — scoping statement with no open question
- E-35 — question posed and already answered "None found" within the same paragraph
- E-55 — lane-ownership/scheduling note, not a design question
- F-36 — lane-ownership note ("Lane G should own the detail design")
- G-09 — paragraph opens "Resolved during this study" and documents a resolution, not an open question
- G-19 — sequencing/roadmap note ("Rank it behind lane A's status-line card")
- G-21 — explicitly "a scheduling fact, not a design question"
