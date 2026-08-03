# TUI/UX parity — `ccx` chat REPL vs. original Claude Code

> **Goal (2026-06-29):** bring our SDK-backed interactive REPL (`ccx`, the product
> north star) to the *look-and-feel* level of the original Claude Code TUI. This scorecard is the
> **source of truth for visual/interaction parity** — distinct from `coverage.md` (which scores SDK
> *capability* realization). Tracked feature-by-feature against the real Claude Code bundle at
> **`~/claude-code-bundle/2.1.220/`** (`cli.pretty.js` plus its `MAP.md`). Scores below are dated
> **2026-07-31**.
>
> **This file is a coarse summary, not the primary record.** The detailed per-feature ledger is the
> research inventory's **271 IDs**, at `docs/superpowers/research/2026-07-31-tui-clone/00-INVENTORY.md`.
> A wave closes a named subset of those IDs; that count is the auditable source of truth. This
> scorecard's rows are a public rollup derived from it — a single row here can stand in for several
> inventory IDs, so treat a row's percentage as directional, not exact.
>
> **F0 correction (2026-07-31).** This file previously stated its method as "tracked against the
> reference TS harness" in a February snapshot of Claude Code that the owner has since banned as stale,
> after it produced wrong strings repeatedly. Every row below has been re-derived against the real
> 2.1.220 bundle, not that snapshot. Two standing instruments now exist to
> keep future scores honest: an executable **honesty audit**
> (`harness/test/tui/honesty.test.tsx`) that fails the suite if `ShortcutsOverlay`'s advertised keymap
> names a chord with no proof of live behavior behind it, and a **frame instrument**
> (`harness/scripts/capture-frames.py` + `harness/scripts/frame-diff.py`, first goldens committed under
> `harness/test/fixtures/upstream-frames/`) that diffs a pyte-emulated screen capture of our binary
> against a capture of the real 2.1.220 binary, frame for frame. Neither instrument existed when the
> pre-F0 scores in this file were taken — a pty run read by a human cannot reliably catch a wrong glyph,
> a missing dim, or a four-column gutter, which is exactly the class of error this correction found.
>
> **Method:** the reference is read for *exact* glyphs / strings / key-bindings / option labels, so we
> match fidelity rather than approximate. Each item is scored ✅ have · 🟡 partial · ❌ missing ·
> 🚫 out-of-scope (bridge-coupled / non-terminal / explicit non-goal), with 🚫 excluded from the
> denominator. **A row scored ✅ for something upstream does not have at all is not parity** — on a
> cloning scorecard that is a category error, so such rows are moved to the "Recorded additions" table
> below, out of the denominator, rather than counted as an achievement. **Two scoring eras — do not
> compare across them.** The `start` and `pre-C5` columns weight rows by user-visible impact; from C5
> (2026-07-28) onward the score is a plain ✅=1.0 · 🟡=0.5 · ❌=0 row count, because impact weights were
> never written down and so could not be reproduced or audited. See the C5 recompute note under the
> headline table.

## Headline

Starting point (pre-work, 2026-06-29): the REPL already has a solid spine — multiline editor with
paste/history/`@`-mention/`/`-command autocomplete, lightweight markdown, live token streaming with
thinking-collapse + tool status + subagent nesting + a task panel, inline permission dialog, model &
session pickers, a status bar, slash commands, and resume/replay. What it lacked was the *chrome and
polish* that makes CC instantly recognizable: **no welcome banner, a non-CC spinner (no verbs / wrong
glyph / no "esc to interrupt"), no `●` message identity, no `!`/`#` input modes, no queued input, no
`/cost`, and thin terminal-native editor ergonomics** (Ctrl-A/E/K/U/W, Ctrl-L, Ctrl-C-twice).

| Category | Parity (start) | Parity (pre-C5) | Parity (pre-F0, post–sprint-W3) | Parity (now, post-F2) |
|---|---|---|---|---|
| 1. Input / composer ergonomics | ~45% | ~88% | ~95% | **~86%** (was ~78% post-F0; F2 landed the keymap — see §1a) |
| 2. Transcript / message rendering | ~50% | ~74% | ~83% | **~57%** |
| 3. Status / chrome (banner, spinner, status bar) | ~35% | ~72% | ~92% | **~36%** |
| 4. Modals / overlays | ~60% | ~88% | ~88% (4 new W3 rows — see W3 recount note) | **~50%** |
| 5. Slash commands | ~55% | ~70% | ~86% (6 new W3 rows — see W3 recount note) | **~88%** (F2: `/keybindings` 🟡→✅ — it opens the real file now) |
| 6. Polish (glyphs, colors, affordances) | ~40% | ~74% | ~94% | **~61%** |
| 7. Control plane (dialogs, ladder, background tasks) — §8 | ~0% | ~81% | ~80% (untouched in W3) | **~75%** |
| **Overall** | **~46%**<br>*(impact-weighted)* | **~83%**<br>*(impact-weighted)* | **~88%**<br>*(plain row count)* | **~65%**<br>*(plain row count)* |

**F0 correction note (2026-07-31) — the headline fell from ~88% to ~63%, and this is the point of the
exercise, not a regression to explain away.** Nothing that worked on 2026-07-30 stopped working; the
drop is entirely a measurement correction, made of three additive effects:

1. **Rows that were genuinely wrong get marked down.** ~26 rows across §1–§4/§8 move from ✅ (1.0) to
   🟡 (0.5) because the pre-F0 scores were taken against the stale, now-banned TypeScript research
   snapshot and never checked against the real bundle — e.g. the assistant bullet is `⏺` on macOS in
   the plain `text` token, not an accent-coloured `●`; the footer has none of model/cost/context that
   the old "Status bar" row claimed; `⎿` is emitted once at five columns upstream, not prefixed to
   every line; the transcript pager is a scrollback view, not the verbose-mode flip `ctrl+o` actually
   is upstream. None of these rows regressed — they were mis-scored from the start; see the per-section
   corrections below each table for the specific citation on every row that moved.
2. **~14 new rows enter the denominator at ❌** because the old file simply had no row for them: the
   theme token contract (`ST4`), the keybinding table (`ST5`) and its ordered-context precedence
   resolver (`ST6`), the notification queue, `statusLine`, terminal title, desktop notifications, tab
   status, reduced motion, resize/`SIGCONT` handling, the `Select`/`Tabs` primitives, `DiffDialog`,
   `EnterPlanMode`, and the background-dialog detail sub-dialogs. These are real, previously invisible
   gaps — not manufactured to hit a target number.
3. **Two over-ships leave the numerator.** The rate-limit usage warning chip and `#` memory mode
   were scored ✅ for features upstream does not have at all; both move to the "Recorded additions"
   table below the headline, out of the denominator entirely. Image paste flips `🚫` → `❌`-pending-P87 (its `🚫`
   rationale was wrong — reading the system clipboard is terminal-native, not "non-terminal / out of
   scope" — so it now counts against the denominator instead of being excluded from it).

**Four rows moved the *other* direction, ✅ preserved with a `fixed 2026-07-31 (F0)` note**, because F0
itself shipped the fix in the same wave this correction pass belongs to: the kill-ring now retains
discarded text (`Ctrl+Y`/`Alt+Y` yank/yank-pop), `Ctrl-_` undo is reachable (it arrives as the bare
`0x1f` byte, not a `ctrl`-flagged key), `Esc` during a busy turn pops the queue back into the composer
instead of destroying it, and the `?` help overlay now closes on Escape only. Four more rows were
updated to reflect F0 behavior changes without a prior wrong score to correct (Ctrl-D now needs two
presses; Ctrl-Z now suspends to the shell — matching upstream's own `SIGTSTP` reservation — with the
detach capability moved to a `/detach` command instead of overloading a reserved key; `y`/`n` are now
bound in the permission dialog). See § "F0 fixes verified in code" below the tables for the evidence.

**Arithmetic, category by category** (✅=1.0 · 🟡=0.5 · ❌=0, `🚫` excluded, unweighted average of the 7
category percentages, per the C5 recompute method below):

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score |
|---|---|---|---|---|---|
| 1. Input / composer | 18 | 3 | 4 | 25 | 19.5/25 = 78.0% |
| 2. Transcript | 3 | 11 | 1 | 15 | 8.5/15 = 56.7% |
| 3. Status / chrome | 3 | 7 | 8 | 18 | 6.5/18 = 36.1% |
| 4. Modals / overlays | 4 | 9 | 4 | 17 | 8.5/17 = 50.0% |
| 5. Slash commands | 16 | 4 | 1 | 21 | 18/21 = 85.7% |
| 6. Polish | 3 | 5 | 1 | 9 | 5.5/9 = 61.1% |
| 7. Control plane (§8) | 5 | 5 | 0 | 10 | 7.5/10 = 75.0% |
| **Overall (unweighted avg of the 7 rows above)** | | | | | **≈ 63.2% → ~63%** |

**F2 recount (2026-08-04, the keymap wave).** Two categories move, and only because rows actually
changed state — no re-scoring of anything already counted:

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score | what moved |
|---|---|---|---|---|---|---|
| 1. Input / composer | 22 | 4 | 2 | 28 | 24/28 = 85.7% | `ST5` (the table) and `ST6` (the resolver) ❌→✅; three new rows enter at ✅/✅/🟡 — the user keybindings file, generic chords, and hints generated from the live binding |
| 5. Slash commands | 17 | 3 | 1 | 21 | 18.5/21 = 88.1% | `/keybindings` 🟡→✅ — it opens the real `~/.claude/keybindings.json` in `$EDITOR`, which is exactly what upstream's command does |
| **Overall (unweighted avg of the 7 categories)** | | | | | **≈ 64.7% → ~65%** | §2/§3/§4/§6/§7 unchanged |

The three new §1 rows are upstream features we previously had no row for (`06 K4`, `06 K5`, and
upstream's own "every hint string generated from the live binding"), not credit for inventions of ours.
The hint row is honestly 🟡, not ✅: three surfaces derive, two footers and one fold marker do not — §1a
names them.

The spec that ordered this correction estimated the fall would land "into the low 70s"; the computed
number lands lower, at ~63%. That is not a contradiction to paper over: the spec's figure was a
back-of-envelope estimate ("roughly fifteen new rows scored 0"), and the actual count is 14 new-zero
rows landing in 4 of the 7 categories rather than spread evenly — §3 (Status/chrome) in particular goes
from 12 rows to 18 by adding 7 new zeros to a category that only had 11 non-🚫 rows before, which drags
its own percentage down to 36% and pulls hard on the unweighted 7-category average. A handful of §6
"Polish" rows (spinner animation, random verbs, `●`/`⎿` glyphs, "esc to interrupt" everywhere) were also
marked down to 🟡 even though section 12 of the research inventory did not name their exact line numbers
— they were left as duplicate ✅ rows of facts the inventory *did* establish elsewhere (the same spinner
timing bug scored 🟡 in §3's "Spinner glyph" row, the same bullet-colour bug scored 🟡 in §2's "Assistant
message identity" row); leaving the §6 copies at ✅ would have left a contradiction inside this same
file. Each such row's note below cites which other row's finding it mirrors, so the provenance is
auditable rather than invented.

**W1 recount note (2026-07-30, TUI/UX sprint Wave 1):** §1 21✅/1❌ of 22 non-🚫 rows (Ctrl-L
converged to clear-input, Ctrl-J/Ctrl-_/Ctrl-S/Shift+Tab/external-editor added); §4 recounted plainly
for the first time (6✅+1🟡 of 7); §5 **went down 88→84 despite seven commands shipping**, because the
audit-driven rows (`/config`+`/permissions` settings UI as their own ❌ row, `/diff` honest at 🟡)
grew the denominator — gaps that were previously invisible are now counted, which is the point of the
sprint's honesty posture.

**W1 keymap deferrals — RESOLVED by Wave 2 (2026-07-31):** the three deferred bindings all shipped
and are scored rows below — `ctrl+o` (`app:toggleTranscript` → the transcript pager, §4), `ctrl+r`
(`history:search` → the prompt-history search, §4), and `ctrl+x ctrl+k` (`chat:killAgents` →
double-press stop-all, §8). Standing intentional divergences, restated: real CC's `cmd+k`
screen-clear never reaches a terminal app, so screen clear stays `/clear`; `Ctrl-B` here is
background-panel/backgrounding rather than upstream's `task:background` context binding.
**Superseded by F0 (2026-07-31, KB5):** `Ctrl-Z` no longer detaches — it now suspends the process to the
shell exactly like upstream's own `Ctrl-Z` (`SIGTSTP`, resumed on `fg`/`SIGCONT`), because upstream
reserves that key and our detach-on-`Ctrl-Z` was a real divergence from it. The detach capability was
not dropped, only rebound: it is now the `/detach` command (leaves the session running, reattach with
`ccx attach`) — see the "Recorded additions" table, since upstream has no detach concept at all.

**W2 divergences (2026-07-31, TUI/UX sprint Wave 2 — all deliberate, bundle-checked):**
- The transcript pager is a **bordered overlay in the composer slot, not an alternate-screen view**:
  unmounting Ink's append-only `<Static>` would replay the entire scrollback on remount (the Wave-1
  Static lesson), so the transcript stays mounted above the pager. Long wrapped lines can occasionally
  overrun the pager's window height — the height budget is conservative (`rows - 10`) by design.
- `ctrl+e` (`transcript:toggleShowAll`) is **deferred**: our transcript has no collapsed/brief variant
  to expand. `home`/`end` never reach an Ink app as key flags — `g`/`G` are the equivalents.
- Spec acceptance #5's "searched" is satisfied by the **Ctrl-R prompt-history search**, not an
  in-pager text search — consistent with U4's own definition and with the bundle's Transcript context
  having no search binding.
- History-search semantics match upstream exactly, including the surprising one: **Esc ACCEPTS** the
  selection into the composer (`historySearch:accept`); Ctrl-C is cancel; Enter executes.
- A `local_agent` task's `.output` is a symlink to the full subagent transcript JSONL (the bundle's
  own warning) — the background panel deliberately does not tail it.

**W3 recount note (2026-07-31, TUI/UX sprint Wave 3):** §4 gains 4 rows for the new dialogs —
AddDirDialog and PermissionsDialog score ✅ (verbatim upstream copy, full tab/flow parity), SettingsDialog
and ThemeDialog score 🟡 (real, disclosed scope cuts: 5 of upstream's ~54 Config rows, 5 of its 7+
themes — see the W3 divergences below) — landing §4 at **10✅+3🟡 of 13 rows (~88%)**, DOWN from ~94%.
That drop is the honesty posture working as designed, not a regression: nothing that worked before
stopped working — two of the four newly-assessable rows are honestly 🟡, and 🟡 rows drag a section's
percentage down by construction (✅=1.0, 🟡=0.5). §5 drops its one placeholder ❌ row (the old combined
"`/config` `/permissions` settings UI · `/theme`" line) and gains 6 concrete ones (`/add-dir`,
`/config`+`/settings`, `/permissions`+`/allowed-tools`, `/theme`, `/output-style`, `/keybindings`) — 3✅
(`/add-dir`, `/permissions`, `/output-style` — the last matches upstream's **own** redirect-into-`/config`
behavior exactly, a Wave-3 bundle-extraction surprise, not a corner we cut) and 3🟡 (`/config`, `/theme`,
`/keybindings` — the same disclosed scope cuts as §4, plus `/keybindings` viewing rather than editing) —
landing §5 at **16✅+4🟡 of 21 rows (~86%)**, up from ~84%. **F2 update (2026-08-04):** `/keybindings`
moved 🟡→✅ when the user layer shipped, so §5 now reads **17✅+3🟡 of 21 (~88%)**; the W3 arithmetic above
is left as written because it records what W3 measured, not what is true today. **Overall ~89% → ~88%** is a real, small,
plainly-computed movement: §5's rise (+2 in the unweighted 7-category average) is outweighed by §4's fall
(-6) in that same average — one point net, from adding ten honestly-scored rows to a wave that shipped
seven working features. Not a regression in anything previously counted; a truer denominator.

**W3 divergences (2026-07-31, TUI/UX sprint Wave 3 — from the plan's Global Constraints line 37 unless
noted otherwise, each with its reason):**
- **No custom/ANSI themes** — `/theme` ships 5 of upstream's exactly **7** built-in theme rows (`theme.ts`
  `THEME_LABELS`) — **F0 correction: not "7+"**, the two we lack are specifically the ANSI variants, whose
  whole point is that the terminal owns the colours, so custom-theme-authoring UI is a separate,
  larger gap than "the rest."
- **`auto` currently equals `dark`** — **F0 correction:** the reason recorded here was wrong for this
  foreground REPL. Upstream's Tier 2 detection (`COLORFGBG` env read) is a pure env read that works
  today; Tier 1 (OSC 11) needs raw stdin plus a stdout write, both of which the foreground REPL already
  owns. The constraint is real only for the daemon path — see §4's ThemeDialog row.
- **Theme changes apply to NEW output only** — Ink's append-only `<Static>` keeps whatever colors its
  already-rendered lines were written with; only the live binding (`ACCENT`/`themeTokens()`) that new
  renders read updates immediately (the same `<Static>` constraint Wave 1 recorded for `/clear`).
- **SettingsDialog has no header-focus state**, so upstream's `Settings dialog dismissed` string is
  unused, and only our **5 functional Config rows** ship (Theme/Model/Output style/Default permission
  mode/Thinking mode) against upstream's ~54, most of which have no ccx equivalent (no real Claude Code
  client to configure).
- ~~**`/keybindings` views the keymap rather than opening it for editing**~~ — **RETIRED by F2
  (2026-08-04).** The premise ("we have no rebinding mechanism to open a file for") stopped holding when
  the user layer shipped: `/keybindings` opens the real `~/.claude/keybindings.json` in `$EDITOR`, seeds a
  starter template if the file does not exist, and every save applies to the running REPL. See §1a.
- **`/permissions` rule mutations live in the flag layer (session) plus the chosen settings file** (for
  the next launch) — upstream's own in-session rule engine is CLI-internal and unreachable from the SDK,
  so this harness owns both halves itself (`applyFlagSettings` for the live effect, `mergeSettingsFile`
  for persistence).
- **Permission-rule saves do not fire upstream's shadowing-warning notices** — no signal exists on our
  side to detect that a new rule shadows an existing one.

Three further divergences surfaced only **during Task 7's implementation** of `/permissions` (not on the
plan's line-37 list, recorded here per Task 8's brief):
- **The Recently-denied tab's footer drops upstream's `Enter to approve · r to retry` chords**, shipping
  `↑/↓ to navigate · Esc to cancel` instead. Reason: nothing in our session interface can replay an
  already-settled denial, so both keys were no-ops, and a rendered footer advertising dead keys is
  exactly the false-affordance pattern Wave 1's honesty pass removed. A deliberate controller decision
  overriding the wave's verbatim-copy rule, not drift.
- **The `/permissions` add-rule flow reuses one footer across both of its steps** (text entry and the
  destination picker) — the plan pins only one footer string for the flow and inventing an unpinned
  second one would be worse than reusing the first.
- **Upstream's `header` footer variant is unused, as is `Settings dialog dismissed`** — neither of our
  dialogs implements upstream's header-focus mode, so both header-scoped strings stay dead code by
  design (consistent with Task 5's SettingsDialog decision above, restated because Task 7 independently
  hit the same gap).

**C5 recompute method (2026-07-28), disclosed for auditability:** each row is scored ✅=1.0 ·
🟡=0.5 · ❌=0, `🚫` rows excluded from the denominator; a category's percentage is that plain
count over its non-🚫 row total (no hidden per-row impact weights); the headline is the unweighted
average of the 7 category percentages. Categories 4 and 7 carry no C5 rows and are left at their
previously-published values rather than re-derived — so they are impact-weighted values averaged in
alongside five freshly counted ones. **~83% → ~88% is therefore NOT a like-for-like delta**: the
baseline was computed under the older impact-weighted convention. The C5 movement that is real and
directly checkable is per-row, in the tables below (26 rows flipped ❌/🟡 → ✅), not in the headline
arithmetic. Re-derive the earlier columns under the plain count if a true trend line is ever needed. This lands the honest headline at **~88%**,
short of the spec's ~93–95% aspiration (`docs/superpowers/specs/2026-07-28-c5-tui-closure-design.md`
§ Purpose) — the gap is the residual 🟡/❌ rows this stage deliberately left alone: Bash output's
missing exit-code framing (no reliable exit code exists in a `tool_result`, so this stays 🟡 rather
than being promoted), long-output expand, the `›` user-echo divergence (an intentional CC deviation),
vim mode, external editor, tip-of-day, and focus-border styling — all either explicit spec non-goals
or LOW-priority tail items, never rows tuned to hit the target number.

**Shipped:**
- **U1 — Welcome banner** (`banner.ts` + `useChat` seed). Accent `✻ Welcome to Claude Code` box +
  cwd/model/mode snapshot + "Tips for getting started", seeded into the Static scrollback (scrolls away
  like CC; skipped when launching into a resume). Pure builder, 7 tests.
- **U2 — Authentic CC spinner** (`spinner.ts` pure + `TurnSpinner.tsx`). The iconic `✻` asterisk-pulse
  (`·✢✳✶✻✽` out-and-back, Claude accent) + a random verb from the **verbatim 187-verb** CC vocabulary
  (fixed per turn) + the `(elapsed · esc to interrupt)` affordance. Shown for the **whole turn** (below
  streamed content), not just the pre-first-frame gap; superseded `ThinkingIndicator`. 8 tests.
- **U3 — Message identity glyphs** (`theme.ts` + `RenderLine.gutter` + `withAssistantBullet`). Every
  assistant response now opens with the accent `●` bullet (continuation lines aligned), and tool results
  render as a dim `⎿` tree — CC's signature transcript shape. The `gutter` field (a leading styled marker
  the `<Line>` view renders as its own `<Text>`) lets the bullet keep the accent color while the text
  keeps its markdown style; nested/subagent replay strips it. Both live (`liveTurn`) and replayed
  (`render`) paths. 4 tests updated.
- **U4 — `/cost` + `/status`** (`commands.ts` formatters + `useChat` dispatch). `/cost` reads
  `session.usage()` (`SDKControlGetUsageResponse`) → total cost (or "included in your `<plan>` plan" on
  subscription auth) + in/out tokens + duration + per-model breakdown; `/status` snapshots the live
  local state (model · mode · thinking · context% · cwd · session id). Added `usage()` to the
  `ChatSession` interface. 7 tests.
- **U5 — `!` bash mode + `#` memory mode + input-mode indicator** (`bash.ts` + `memory.ts` +
  `editor.inputMode` + `useChat` routing + `ChatComposer` chrome). A leading `!` runs the rest as a shell
  command locally in cwd (echoed `! cmd`, dim output, capped, `exit N` on failure) — a quick shell escape
  that never hits the model (intentional local-only divergence; `exec` is the right tool for an
  interactive shell escape). A leading `#` appends the note to the project `CLAUDE.md` under a `## Memories`
  section. The composer derives the mode purely from the buffer's first char and shows a magenta (bash) /
  blue (memory) border + hint. Side effects injected as `deps` (unit-tested without spawning/writing).
  13 tests.
- **U6 — Queued input while busy** (`useChat` queue + `ChatApp` indicator). Submitting a prompt while a
  turn runs enqueues it (shown as `⋯ queued: …`) and it dispatches FIFO when the turn ends — each drained
  turn's `finally` re-drains, self-chaining. Only turns queue; local commands + `!`/`#` run immediately
  (control-channel / local, safe mid-turn). `Esc` (interrupt) rescues queued text into the composer before
  clearing the queue — a clean stop that does not destroy typed work.
  4 tests.
- **U7 — Editor ergonomics** (`editor.ts` readline keys + `ChatComposer` chrome + `useChat.clear`). Adds
  the terminal-native muscle-memory keys: **Ctrl-A/E** (line start/end), **Ctrl-K/U** (kill to end/start),
  **Ctrl-W** (kill word back); unhandled ctrl combos never insert. A dim **placeholder** ("Ask Claude
  anything…") on the empty buffer and a persistent **footer hint** (`⏎ send · \⏎ newline · @ files · /
  commands · ! bash · Tab mode`). **Ctrl-L / `/clear`** now *truly* clears — model reset + a `clearToken`
  that remounts the append-only `<Static>` + an ANSI screen+scrollback clear (`\x1b[2J\x1b[3J\x1b[H`, TTY-only,
  injectable). 11 tests. (Ink's `<Static>` is write-once — only the ANSI escape erases scrolled history; CC
  does the same.)

**C5 — TUI closure shipped (2026-07-28)**, `docs/superpowers/specs/2026-07-28-c5-tui-closure-design.md`:

- **Esc-Esc rewind — the flagship (U12).** Four layers: the anchor classifier (`sessions/rows.ts`
  `rewindAnchorsFrom`/`rowKind`) reads persisted `getSessionMessages` rows by content shape (no meta
  flags exist) and pairs each real prompt with its file anchor (`uuid`) and conversation anchor
  (`prevUuid`, the nearest real predecessor row — phantom command-echo/compact-summary rows are walked
  past); the host (`host/host.ts` `rewindAnchors`/`rewindDryRun`/`rewind`) validates before any side
  effect, swaps engines at the current runtime mode for `conversation`/`both`, and clears the
  background-task roster with a notice since the engine swap kills the old CLI's shells; the client
  (`client/chatAdapter.ts`) passes the three ops through; the REPL (`tui/RewindPicker.tsx` +
  `tui/useChat.ts` + the Esc-Esc arming in `tui/ChatApp.tsx`, 1.5s idle-only window, busy Esc stays
  interrupt) lists prompts newest-first, shows a dry-run file-change summary, and offers CC's 3-way
  restore (conversation+code / conversation-only / code-only), pre-filling the composer with the
  selected prompt's text on a conversation restore (CC's edit-and-resend loop). Also reachable via
  `/rewind`.
- **The usage surface (F4).** `tui/usageFormat.ts` (`formatUsage`/`usageWarning`/`usageSummaryLine`)
  renders `session.usage().rate_limits` as per-window utilization bars (`/usage`), a one-line `/status`
  summary, and a status-bar warning chip once any window crosses 80% (`ChatStatusBar.tsx`); degrades
  honestly to a `plan usage not available under this credential` line when `rate_limits_available` is
  false (OAuth-token auth, probe 55).
- **`?` shortcuts overlay** (`tui/ShortcutsOverlay.tsx`, opened by `?` on a genuinely empty composer —
  `ChatComposer.tsx`) lists every binding this package actually wires (readline keys, word movement,
  Tab ladder, Esc-Esc, Ctrl+B, `!`/`#` modes); Escape alone closes it.
- **Alt/Ctrl word movement** (`tui/editor.ts` `wordLeft`/`wordRight`, checked ahead of the ctrl-combo
  branch so no meta chord falls through to insertion).
- **Transcript fidelity.** Tool-invocation rows adopt CC's `● Name(target)` bullet (`render.ts`
  `toolUseLines`, replacing `⚙`); Edit/Write diffs gain a real hunk body — up to 3 dim numbered context
  lines each side of the change, numbered `-`/`+` rows for the changed lines (`render.ts`
  `toolDiffLines`) — the shipped numbering is **hunk-relative** (1-based within the
  `old_string`/`new_string` snippet). **P94 complete on SDK 0.3.220:** flat `tool_result.content` and the
  optional per-call `SDKUserMessage.tool_use_result` sidecar must both remain retained; recognized sidecars
  improve fidelity, while flat/input fallbacks remain mandatory for sidecar-less and forwarded calls. The
  evidence report also records UUID/provenance ownership and the separate Write proof. **Superseded by F1
  (see the F1 section below):** the split live/replay renderer is gone, `render.ts` no longer renders any
  tool row, and the `✗`-prefixed red failure line it used to emit is replaced by the shared renderer's
  status colouring — upstream shows no `✓`/`✗` glyph anywhere in the transcript.
- **Markdown tables** (`markdown.ts` `flushTableBuffer` — a buffered run of `|`-lines becomes a
  column-padded table only once a `|---|` separator confirms it, otherwise it's re-emitted as prose
  untouched) and a **zero-dependency syntax highlighter** (`tui/highlight.ts` — a manual regex lexer
  for keywords/strings/comments/numbers across ts/js/py/sh/json; **not a real grammar**, a
  recognizable-90% approximation per the spec's Decision Log against pulling in a ~1MB dependency).
- **Compact-boundary divider** (`tui/useChat.ts`, a `system`/`compact_boundary` frame renders
  `─── context compacted ───`) and **`/copy`** (`tui/copy.ts`, DI'd `pbcopy`/`xclip` spawn — copies the
  last assistant reply, live or replayed via `sessions/rows.ts` `lastAssistantText`).

---

## Recorded additions (ours, outside the parity denominator)

On a **cloning** scorecard, scoring ✅ for something upstream does not have at all is a category error —
it flatters the headline with rows that were never a gap to begin with. This table is where those rows
live instead: recorded so the capability isn't lost from the document, but out of every category's
non-🚫 row count and out of the headline arithmetic above.

| Feature | What it is | Why it's not a parity row |
|---|---|---|
| plan-usage warning chip (≥80% rate-limit utilization) | **C5** (F4) `usageFormat.ts` `usageWarning` → `ChatStatusBar.tsx` — a red chip in the footer once any rate-limit window crosses 80% | **F0 correction.** Upstream has no such chip at all — rate limits surface only via `/usage` and `statusLine`. Was scored ✅ in §3 pre-F0; that was the category error this table exists to fix. `/usage` itself (§5) is real upstream-equivalent functionality and stays a normal scored row |
| `/detach` (leave the session running, reattach with `ccx attach`) | Detaches this client from a live session without ending it — a multi-client capability of our `ccx attach` architecture | Upstream has no detach concept at all — a genuine addition from our client/session split, not a divergent form of an existing upstream feature. **F0 (t6, KB5):** previously bound to `Ctrl-Z`, which collided with upstream's real reservation of that key for `SIGTSTP`; moved to the `/detach` command so the capability survives while `Ctrl-Z` itself becomes a real parity row (§1) |
| `#` memory-mode composer input | **U5** `memory.ts` appends a leading-`#` note under `## Memories` in `CLAUDE.md` | Upstream's mode detector recognises only `!`; this is a genuine local addition, retained and disclosed but excluded from the cloning denominator. Its start-of-buffer gate prevents it from swallowing a `#` mid-prompt. |

The real `message_delta` output-token count (§3, "Live token counter during turn") is deliberately kept
over upstream's animated `responseLength/4` estimate (spec Decision Log E4). It remains a parity row
because upstream has the same live-token-counter concept, even though the computation differs.

---

## F0 fixes verified in code (2026-07-31)

The task-10 brief listed eight items F0 was expected to have fixed; each was checked against the actual
source and commit history in `CC-to-SDK/harness/src/tui/`, not taken on the brief's word. All eight are
real, each landed in its own commit on `main`, and each is now backed by a test (including two that
required a captured red-proof after an initial review found the first test was tautological):

**Final-review correction pass (2026-08-01, commit `fa4c313c88`).** The consolidated review follow-up
closed the remaining queue-rescue replacement-state race, stale composer callback/timing reads,
focus-blind status hints, Windows suspend rollback, managed-permissions footer lie, and frame
instrument false-success/masking gaps. The pass also adds regression coverage for each correction and
keeps the committed frame baseline intentionally divergent: the corrected diff reports 3 divergent
help-overlay frames and 5 divergent composer frames rather than silently treating them as clean.

**Second re-review boundary pass (2026-08-01, commit `11f412e285fec056b26ee8a80d243e716425b4aa`).** Root input
routing now owns the visible help race with synchronously-current refs; whitespace-only clear and queue
prepend preserve the intended bytes without polluting history; line-boundary Ctrl-W restores multiline
structure through the kill ring; and the frame emulator/masks are mutation-safe and scenario-scoped.

**Third re-review boundary pass (2026-08-01, commit `181470a918`).** Permission confirmation now accepts
only bare `y`/`n`; composer keyboard affordances render with the editor state rather than lagging through a
parent effect; a Ctrl-D arm is hidden whenever exit is impossible; and capture rejects an immediately-dead
child. Frame comparison now separates write-time, dashboard-anchored identity redaction from scoped quota
and status masks; the original capture round-trips byte-for-byte; continuation-cell wide-glyph overwrites
clear both real pyte cells and styles; and no frame-diff documentation example can become an allowlist row.

| # | Fix | Commit | Where scored above |
|---|---|---|---|
| 1 | Kill-ring: `Ctrl-K`/`Ctrl-U`/`Ctrl-W` used to discard killed text; now a real ring (cap 10) with `Ctrl-Y` yank / `Alt-Y` yank-pop | `a853e8dbc8` (+ fix-up `cc2a42282f`) | §1 "Ctrl-K / Ctrl-U", "Ctrl-W" |
| 2 | `Ctrl-_`/`Ctrl--` undo was unreachable (terminals send the bare `0x1f` byte, not a `ctrl`-flagged key; a literal `\x1f` was inserted instead) | `aeb212804b` | §1 "Ctrl-_ / Ctrl--" |
| 3 | Escape during a busy turn used to destroy the queue; now pops it back into the composer | `cd0b92baae` | §1 "Queued messages while busy" |
| 4 | Esc-Esc on a **non-empty** composer now arms a clear-hint and clears text on the second press, instead of falling into the rewind flow; rewind is gated to an empty composer only | `ce2c22b278` | §6 "Double-Esc to rewind affordance" |
| 5 | `?` help overlay used to close on **any** key (which could double-fire into `ChatApp`'s global chords underneath, e.g. `Ctrl-O`); now closes on Escape only | `52d724ea5b` (+ red-proof fix `257010f1c2`) | §1 "`?` shortcuts / help menu" |
| 6 | `Ctrl-D` now needs two presses within upstream's real **800ms** window (not the plan's originally-assumed 2000ms); `Ctrl-Z` now suspends to the shell (`SIGTSTP`/`SIGCONT`, targeting the process group, past Ink's ref-counted raw-mode) instead of detaching; detach moved to `/detach` | `324853e1b9` (+ raw-mode/timing fix `cf1d0a4f14`) | §1 "Ctrl-C twice / Ctrl-D", "Ctrl-Z" |
| 7 | `y`/`n` bound in the permission dialog (accept-once / reject) alongside the existing arrows/numbers/legacy aliases | `bab51d62ae` | §4 "Permission approval dialog" |

Two further F0 deliverables have no single row of their own — they are the instruments this document's
own method note above points to, and are recorded here so a reader of the scorecard knows they exist:

- **The honesty audit** (`harness/test/tui/honesty.test.tsx`, commits `444b17364a` + `b278e3f986`) maps
  every row in `ShortcutsOverlay.tsx`'s advertised keymap to an executable proof and fails the suite if
  a row has no live proof behind it. Sabotage-verified twice (an injected fake row, and a reintroduced
  dead `Ctrl-_` branch both correctly turned the audit red); a follow-up pass then found and fixed two
  of the audit's *own* checks that were comparing hand-copied literal strings instead of rendered
  output — both were proven inert by sabotage before the fix and caught by it after.
- **The frame instrument** (`harness/scripts/capture-frames.py` + `harness/scripts/frame-diff.py`,
  commits `31c7528c80` + `181470a918`) captures a pyte-emulated screen state of a running TUI at named
  checkpoints and diffs two capture directories with dashboard-only nondeterminism masked out. SGR 2
  dim is a first-class cell attribute through pyte scroll/erase/insert/delete and wide-cell continuation
  overwrites. Tracked-golden writes require named identity rules with per-rule and total match coverage,
  staging every frame until the complete batch validates; arbitrary transcript identity, quota, cost,
  duration, token, timestamp and UUID text remains distinguishable. First goldens against the real,
  installed `claude` 2.1.220 binary are committed under `harness/test/fixtures/upstream-frames/`
  (`help-overlay/`, `composer-basics/`). Running it against our own `ccx` today reports both sets
  DIVERGENT (expected — the boot-frame gap is real and large; the composer-editing semantics matched
  closely on manual review even though the frames diverge on layout/chrome), which is the honest
  starting baseline future waves measure against, not a defect in the instrument.

---

## F1 (2026-08-03) — the rendering substrate

F1 replaced the split live/replay renderer with **one retained transcript document** (`tui/transcriptModel.ts`)
that every surface projects from (`tui/toolRenderer.tsx`), so a tool row can no longer differ between what
you saw while it ran and what you see after a `/resume`. Only the rows below changed; everything scored
elsewhere in this file is unaffected.

### Now faithful

| Row | What shipped | Evidence |
|---|---|---|
| Unified live/replay tool renderer | `transcriptModel.ts` retains complete SDK messages verbatim (flat `tool_result` **and** the per-call `tool_use_result` sidecar); `toolRenderer.tsx` is the single projection to `RenderItem`s; live, replay, attach, resume, rewind and the Ctrl-O pager all route through it | `npx vitest run test/tui/f1-frame-parity.test.tsx` (5) + two `scripts/frame-diff.py` runs over four pyte captures of the real `ChatApp` — the sidecar and flat-only live-vs-replay pairs each report `2 clean, 0 allowlisted, 0 DIVERGENT` |
| Default-view folding | A contiguous run of read/search/list/MCP calls collapses to one dim summary row (`  Read 1 file (ctrl+o to expand)`), and the per-call `⏺ Read(path)` form is now the ctrl+o view — which is what 2.1.220 actually does (`toolFold.ts` + `toolRenderer.tsx`) | `test/tui/toolFold.test.ts` (41), `test/tui/toolRenderer.test.tsx` (42) |
| Active group row | While a member is running: a dim blinking `⏺` at 600 ms in the `inactive` colour, the present-participle clause, and a transient `⎿ <hint>` gutter — all from the retained source, with no timer in the projection | `test/tui/toolRenderer.test.tsx -t "blinking active group row"`, `test/tui/chat.test.tsx -t "repaints an open tool"` |
| One `⎿` gutter | `RenderItemView` is the sole owner of the connector; it lives in a fixed five-column sibling box, so exactly one appears per result no matter how the body wraps | `test/tui/toolRenderer.test.tsx -t "sibling gutter"` |
| Long-output detail | Compact shows three rows plus `… +N lines (ctrl+o to expand)`; ctrl+o opens the full retained source; ctrl+e collapses locally to `ctrl+e to show all` | `test/tui/transcriptPager.test.tsx` (6), `test/tui/chat.test.tsx -t "Ctrl-E"` |
| Tool statuses, rejection, interruption | Running dim, success/error colours, no `✓`/`✗` anywhere; `⎿ Interrupted · What should Claude do instead?` and `⎿ Tool use rejected` as fixed one-row prompts | `test/tui/toolRenderer.test.tsx -t "interruption and rejection"`, `-t "resolved success and error"` |
| Bash/Edit/Write rows (LT12) | Argument clipping, the recognized `sed -i` path resolving to `Update(<display path>)` | `test/tui/toolResult.test.ts -t "sed -i"` |
| Generic-error normalization (LT15) | Ten physical rows plus a dim overflow marker outside the error-coloured text | `test/tui/toolRenderer.test.tsx -t "ten-row"`, `test/tui/toolResult.test.ts -t "LT15"` |
| ST4 / TH2 / TH4 / TH7 — theme tokens | 30 tokens × 4 themes verbatim from the 2.1.220 capture, upstream's own colour grammar and is-light predicate, resolved at the moment of use so a `/theme` change recolours the next render | `test/tui/theme.test.ts` + the raw-SGR case in `test/tui/f1-frame-parity.test.tsx` (dark vs light produce identical text and different SGR from the same projected items) |
| OSC-8 file links | `Read`/`Edit`/`Write` header paths are cwd-relative labels over a `file://` link with BEL terminators | `test/tui/toolRenderer.test.tsx -t "exact OSC-8"` + the raw-Ink case in `f1-frame-parity.test.tsx` |

### Real-2.1.220 comparison (`f1-tool-rendering`)

The tracked golden `test/fixtures/upstream-frames/f1-tool-rendering/01-read-complete.ansi` is a real
`claude` 2.1.220 frame captured mid-Read. Our binary is captured against it keylessly through
`test/fixtures/f1-tool-transcript-frame.tsx` (a deterministic replay fixture mounting the real `ChatApp`)
and validated by a row-scoped required-state contract under `capture-frames.py --require-state`.

- **Binding check passes.** The `read-progress` (`Read(?:ing)? \d+ file`) and `gutter-path`
  (`⎿.*src/app\.ts`) selectors match and the `logged-out-footer` / `tool-rejected` selectors stay absent.
- **The `⎿  src/app.ts` hint row is now byte-identical to the golden**, connector included — the Task 7
  comparison found our connector rendering plain where upstream renders the whole row dim `#999999`, and
  the renderer was fixed rather than the difference masked.
- **The whole-frame diff stays DIVERGENT and is read as a diagnostic, not a gate.** Nothing is
  allowlisted; `test/fixtures/upstream-frames/allowlist.md` still has zero entries. The residual
  divergence is (a) chrome outside F1's scope — the welcome/release-notes banner box, the model line, the
  composer echo of the user prompt, the animated spinner row and the mode/effort footer — and (b) one
  run inside the F1 row, `" file…"`, described below.

### Known divergences and deferrals

| Item | State | Owner |
|---|---|---|
| Bold count in the folded row | **Regression against the contract, not fixable in this Ink.** R3.5 says the count stays bold inside the dim run ("Ink composes dim+bold"). Probed: Ink drops `bold` outright when `dimColor` is set on the same `<Text>` (`<Text dimColor bold>1</Text>` emits `\x1b[2m1\x1b[22m`), and embedding raw SGR is rewritten by chalk's nested-close handling. The count therefore renders dim-not-bold today | F3 — needs a raw-SGR line writer or dim hoisted onto the parent `<Text>` with a bold child (which also reproduces upstream's own `\x1b[22m` tail artifact) |
| `" file…"` plain in the golden | Deliberately not reproduced. Everything after upstream's bold count renders bright because the count's `\x1b[22m` closer clears faint as well as bold. Emitting a broken reset to match would be fabricating a bug | recorded, no owner |
| Settled group row colour | **Resolved 2026-08-03.** A dedicated settled-state probe against installed 2.1.220, run under the tracked capture environment (pinned `TERM=xterm-256color`/`COLORTERM=truecolor`, wrapper and palette vars removed), paints the settled row `#999999` — the same grey as the active row. The `#949494` first recorded in the live-confirmation note was that earlier probe environment's ambient-palette variant (`COLORFGBG` present), not a second upstream colour. The settled clause run now carries the `inactive` token; see the render contract § 0 pin | closed |
| Nested (`parent_tool_use_id`) replay rows | **Deliberate, tested deferral — a shipped behaviour that is gone.** `replay.ts:42–46` used to render subagent rows indented and dimmed; F1 Task 4 drops them from the top-level projection instead of flattening them into unrelated rows | F3 (subagent grouping, parent/child progress and totals) |
| String-content user rows render nothing | `render.ts`'s user branch only iterates array `content`, but `sessions/rows.ts` `promptText` shows persisted rows can carry a bare string — such a row projects to no line at all | F3/F4 |
| Fullscreen-only clauses, grouped Agent batches, typed result summaries, elapsed `· Ns` | Not built. All are `ds()`-gated fullscreen-only or need parent/child state F1 does not model; a substitute would be fabrication, not fidelity | F3 |
| Markdown/diff closure | Not built | F4 |

---

## 1 — Input / composer ergonomics

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Multiline editor (paste split, `\`-continuation) | 🟡 | — | `editor.ts` — paste = one `useInput`, insert-and-split. **F0 correction:** upstream turns a >800-char or >2-newline paste into a `[Pasted text #N +M lines]` chip stored out of band and substituted at submit; ours inserts the pasted text verbatim, no chip |
| History up/down (draft stash/restore) | 🟡 | — | `editor.ts` historyPrev/Next. **F0 correction:** ours is in-memory per composer mount; upstream persists `~/.claude/history.jsonl` across sessions with newest-wins dedup and a per-index edit cache |
| `@`-file mention fuzzy autocomplete | ✅ | — | `editor.ts` + `fileComplete.ts` |
| `/`-slash command autocomplete | ✅ | — | `editor.ts` command state + `commandComplete.ts` |
| `!` bash mode (run shell directly, no model) | ✅ | — | **U5** `bash.ts` local exec in cwd, echoed `! cmd` + `⎿`-style output (local-only by design; no model context injection) |
| Input mode indicator (bash/memory/command) | ✅ | — | **U5** `inputMode()` → magenta bash / blue memory border + hint |
| Ctrl-A / Ctrl-E (line start/end) | ✅ | — | **U7** `editor.ts` readline keys |
| Ctrl-K / Ctrl-U (kill to end/start) | ✅ | — | **U7** `editor.ts`. **fixed 2026-07-31 (F0, t1, CM10/CM11):** killed text used to be discarded — the correction had this at 🟡. It now feeds a real kill ring (cap 10, coalescing runs), with `Ctrl+Y` yank / `Alt+Y` yank-pop and a `Ctrl+Y to paste deleted text` hint after a ≥3-char Ctrl-U kill, matching upstream |
| Ctrl-W (kill word back) | ✅ | — | **U7** `editor.ts`. **fixed 2026-07-31 (F0, t1):** same kill-ring fix as Ctrl-K/Ctrl-U above |
| Word movement (Alt/Ctrl ←→) | ✅ | — | **C5** `editor.ts` `wordLeft`/`wordRight` (Alt-←→ and Alt-b/f), checked ahead of the ctrl-combo branch so no meta chord falls through to insertion |
| Ctrl-L (clear **input**) | ✅ | — | **W1** converged on 2.1.220's `chat:clearInput` (the old app-level screen-clear was a divergence); screen clear stays `/clear` — real CC's `cmd+k` never reaches a terminal app (intentional divergence, recorded) |
| Ctrl-J (newline) | ✅ | — | **W1** `editor.ts` — 2.1.220 `chat:newline`, alongside `\`-continuation. **F0 note (t4, KB4/KB23):** the `key.ctrl==="j"` branch this used to dispatch through was dead code — real terminals send a bare `\n`, never a ctrl-flagged `"j"` — and was deleted; the newline still works via the generic bare-`"\n"` insert path, so behavior is unchanged, only the dead branch is gone |
| Ctrl-_ / Ctrl-- (undo edit) | ✅ | — | **W1** `editor.ts` snapshot-on-change stack (cap 100) — 2.1.220 `chat:undo`. **fixed 2026-07-31 (F0, t4, KB4):** this row was scored ✅ but was actually **unreachable** — terminals send the bare `0x1f` byte with `key.ctrl===false`, so the old `ctrl+"_"`/`ctrl+"-"` branch never fired and a literal `\x1f` was inserted instead (only reducer-level tests existed, which is why nothing caught it, and `ShortcutsOverlay.tsx` was advertising a dead chord). Fixed by matching the raw `\x1f` byte directly; the dead `ctrl+"_"/"-"` branch was removed |
| Ctrl-S (stash / restore input) | ✅ | — | **W1** `editor.ts` — 2.1.220 `chat:stash`: parks a non-empty buffer, restores on the next Ctrl-S from empty |
| Shift+Tab cycles permission mode (bare Tab popup-only) | ✅ | — | **W1** converged on 2.1.220's `chat:cycleMode` = `shift+tab`; bare Tab now belongs to autocomplete alone (our old bare-Tab cycle was a divergence) |
| Ctrl-C twice / Ctrl-D to exit | ✅ | — | **U8** Ctrl-C interrupts a turn, else "Press Ctrl-C again to exit". **F0 update (t6, KB3):** Ctrl-D used to exit on a single empty-buffer press; it now needs two presses within the arm window, matching upstream's `Pee` helper — including its exact **800ms** window (`cli.pretty.js:183445`, the same constant as the Esc-Esc clear timer), corrected down from this plan's originally-assumed 2000ms after reading upstream's own patched-Ink suspend code |
| Queued messages while busy | ✅ | — | **U6** turns queue while busy + drain FIFO on turn end; `⋯ queued:` indicator. **fixed 2026-07-31 (F0, t3, CM49), hardened in the sixth final-review pass:** Esc/Ctrl-C during a busy turn now pops the queue back into the composer (prepended ahead of any in-progress draft) before clearing it. Its current editor state is app-scoped, so the rescued/edited draft and kill ring survive the tested temporary pager, history, settings-shaped, and decision overlay remounts; submit reset stays empty and stale autocomplete is intentionally normalized. This is an evidence-backed temporary-remount guarantee, not a claim about unimplemented persistent/global editor storage |
| Placeholder / ghost text ("Ask Claude…") | 🟡 | — | **U7** dim placeholder on empty buffer. **F0 correction:** upstream's placeholder is a 4-rule precedence chain over a git-seeded random pool (one rule is the queue hint); ours is one fixed string |
| `?` shortcuts / help menu | ✅ | — | **C5** `ShortcutsOverlay.tsx` — a real bordered overlay listing the keymap, opened by `?` on a genuinely empty composer; the U7 footer hint line stays alongside it. **fixed 2026-07-31 (F0, t5, KB6):** this row was scored ✅ but the overlay closed on **any** key, and that same key also fired `ChatApp`'s global chords underneath it (e.g. `Ctrl-O` would both close the overlay and open the transcript pager in one keystroke) — the correction had this at 🟡. It now closes on Escape only and swallows every other key, matching upstream's `Help` context (which binds only `escape`); a sabotage-verified honesty-audit test pins this |
| Vim mode (`/vim`) | ❌ | LOW | owner-deferred (the sprint's only deferral) |
| External editor (Ctrl-X Ctrl-E / Ctrl-G → `$EDITOR`) | ✅ | — | **W1** `externalEditor.ts` — spawnSync terminal handoff (raw mode released/restored), null-safe (editor failure keeps the buffer), popups cleared on applied edit |
| Ctrl-Z (suspend to shell) | ✅ | — | **fixed 2026-07-31 (F0, t6, KB3/KB5):** new row — previously `Ctrl-Z` detached this client (a divergence with no upstream equivalent, undocumented as a row). It now suspends the whole process group to the shell on `SIGTSTP` and resumes on `SIGCONT`/`fg`, matching upstream's own reserved `Ctrl-Z` exactly, including targeting the process group (not just our own pid) and restoring raw mode past Ink's ref-counted `setRawMode` (`suspend.ts`, read from upstream's own `handleSuspend` at `cli.pretty.js:177985`). Detach moved to `/detach` — see Recorded additions |
| Image paste (Ctrl-V) | ❌ | pending P87 | **F0 correction:** was scored `🚫` "non-terminal / out of scope" — **the rationale was wrong**. Upstream's `ctrl+v` reads the system clipboard, which is terminal-native; whether the SDK surface lets us reach it is an open probe (P87: image content blocks), not an out-of-scope call. Reclassified `🚫` → `❌`-pending-P87, which brings it into the denominator |
| Keybinding table (`ST5`) | ✅ | — | **shipped 2026-08-04 (F2).** `src/tui/keys/bindings.ts` is the single declarative source of truth: upstream's 20 context names, a closed 55-action vocabulary, 136 default entries across the 12 contexts that carry any (97 bindings + 39 explicit unbinds), and a reserved-key registry — with `null` entries stating declaratively which globals a surface kills, which is what the old imperative owner gate did by hand. Every `useInput` callback in `src/tui/` is gone (the F0 row's "17 ad-hoc callbacks" count is now zero) |
| Keybinding precedence model (`ST6`) | ✅ | — | **shipped 2026-08-04 (F2).** `keys/resolver.ts` + `keys/KeymapProvider.tsx`: one raw-stdin root consumer with our own keypress parser (P86 measured that Ink's `useInput` cannot express the table — it projects every key onto 14 booleans and throws `keypress.name` away), an ordered context stack each mounted surface pushes onto, first-match-wins with `null` consuming the key as explicitly unbound, plus `swallowAll` and preemptive scopes above the chain. The double-fire bug class it exists to remove is now structurally impossible rather than hand-gated |
| User keybindings (`~/.claude/keybindings.json`) | ✅ | — | **shipped 2026-08-04 (F2, `06 K5`).** Upstream's own path and file shape, so an existing Claude Code keymap applies to `ccx` unchanged: additive merge over the defaults, later-wins within a context, `null` unbinds, live reload on save (no restart), and typed validation (`parse_error`/`invalid_context`/`invalid_action`/`duplicate`/`reserved`, plus our own binding-keeping `suspicious_key` warning) reported into the transcript. `command:<name>` bindings run a slash command, Chat-context only (`06 K6`) |
| Generic chords, 1 s inter-key window (`KB22`) | ✅ | — | **shipped 2026-08-04 (F2, `06 K4`).** Any binding may be a space-separated sequence; the pending prefix is armed by the table rather than hardcoded, `escape` cancels, and the key that breaks a pending chord is swallowed (upstream `Q4u`). Replaces the two bespoke `useRef` timestamp chords with their 2 s window |
| Hint strings generated from the live binding | 🟡 | — | **F2, partial and disclosed.** The composer footer ladder, the status-bar mode chip and the whole `?` shortcuts grid derive their chords from the live table, so a rebinding moves them and an unbind prints `(unbound)`. Three surfaces still print literals: the transcript-pager footer (a multi-alias ladder a generated string would render worse than the hand-written one), the history-search footer and `toolRenderer.ts`'s `(ctrl+o to expand)` fold marker (both excluded on cost, the fold marker additionally pinned to the upstream golden — a lookup could reach it). See §1a |


## 1a — Keybindings: the F2 keymap as data

The keymap is one declarative table (`harness/src/tui/keys/bindings.ts`), one resolver
(`keys/resolver.ts`), one raw-stdin root consumer (`keys/KeymapProvider.tsx`), and one user layer
(`~/.claude/keybindings.json`, `keys/userBindings.ts`). Nothing under `src/tui/` calls Ink's `useInput`
any more. This section is the honest ledger of that wave: what a terminal cannot deliver, what each of
the research inventory's 40 keybinding rows looks like now, and which behaviours changed on purpose.

### Unreachable keys — recorded, not written and left dead

P86 (`docs/superpowers/research/2026-07-31-tui-clone/09-p86-ink-input-matrix.md`) measured what actually
arrives at a terminal application. These families are in **no table and no hint string**, because binding
them would be advertising a key that cannot fire. This is the F2 non-goal stated as a list rather than as
silence.

| Unreachable key | Why | Evidence |
|---|---|---|
| `super`+letter on a non-CSI-u terminal (`cmd+k`, `cmd+c`, `cmd+v`, …) | macOS terminals intercept the Command modifier and never forward it; only a terminal speaking the CSI-u protocol emits a distinguishable form (`\x1b[107;9u` for `cmd+k`), which Ink does not decode and no default terminal sends | P86 §1.7 "CSI-u chords", and the `cmd+k → chat:clearScreen` row of the "Misparsed" table: "most terminals never send cmd+k to the application at all". The reserved-key registry names seven macOS `super` chords the SYSTEM eats — `super+c/v/x/q/w/tab/space` — so a rebinding of one of those is refused with the reason. It does NOT cover the rest of the family: `super+k` and every other `super`+letter is accepted silently and then never fires, because the terminal does not forward the modifier. Growing the registry to the whole family is a behaviour change, deliberately not made here |
| `ctrl+shift+<letter>` on a non-CSI-u terminal | The byte stream is **identical** to plain `ctrl+<letter>` — the shift bit is not encoded at all outside CSI-u, so `ctrl+shift+b` and `ctrl+b` are the same key to any parser | P86 §1.7 and the `ctrl+shift+b → app:toggleBrief` row: "byte-identical to ctrl+b and **undeliverable in principle**" |
| `shift+enter` without `/terminal-setup` or CSI-u | Plain `shift+enter` sends bare CR, byte-identical to `enter`. It becomes distinguishable only if the host terminal's own keymap is rewritten to send `ESC CR` (upstream's `/terminal-setup`, `KB21`/`06 K40`, an explicit F2 non-goal) or if the terminal speaks CSI-u (`\x1b[13;2u`) | P86 §1.4 "Enter forms", the `\x1b\r` and `\x1b[13;2u` rows; both are misparsed by Ink, and the plain form is not sent at all |
| `ctrl+m` as distinct from `enter` | Impossible in any terminal: both are CR (0x0D). There is no encoding in which they differ | Upstream reserves it for the same reason (`06 §1.4`); our reserved-key registry carries it verbatim — "Cannot be rebound - identical to Enter in terminals (both send CR)" — as an **error**-severity entry, so a user binding is dropped with that message |
| Windows / ConPTY behaviour | **Not determined**, and not determinable from this machine: `pty.fork` does not exist on Windows and ConPTY's input translation is a different code path from the POSIX pty every P86/P86b measurement used. Nothing in the table is claimed to work there | P86 §5, "Settled (was 'not determined')" — the one row that stayed open |

**Dropped with a rationale (from `KB8`/`06 K17`).** Upstream's four `meta+*` chat keys are `meta+p`
(model picker), `meta+t` (thinking), `meta+o` (fast mode) and `meta+w` (workflow keywords). F2 shipped
the first two as `alt+p` / `alt+t`. **`meta+o` and `meta+w` are deliberately not bound**: `ccx` has no
"fast mode" and no workflow-keyword surface for them to open, so binding them would either do nothing or
invent a feature to justify a key. They are recorded here rather than left as a silent omission.

### K1–K40 — the keybinding ledger, post-F2

The 40 rows of the research gap table (`06-keys-themes.md` §1.9), re-scored after F2. ✅ have ·
🟡 partial · ❌ missing · 🚫 out of scope (the surface does not exist in `ccx`, or upstream's own binding
is vestigial). This ledger is **not** part of the §1 percentage — §1 carries the five rolled-up rows;
these are the auditable detail behind them.

| ID | Upstream | Ours, post-F2 | Status |
|---|---|---|---|
| K1 | Declarative table, 19 contexts × ~180 bindings | `keys/bindings.ts`: 20 contexts, 136 default entries, one source of truth | ✅ |
| K2 | Ordered-context first-match-wins resolver, `Global` last | `keys/resolver.ts` + the provider's scope stack; `null` consumes as explicitly unbound | ✅ |
| K3 | `swallowAll` + `preemptiveScopes` above the chain | `useSwallowKeys` / `useKeyScope({preemptive})`; the swallower resolves to its own innermost scope | ✅ |
| K4 | Generic chords, 1 s window | Any binding may be space-separated; `escape` cancels; the breaking key is swallowed | ✅ |
| K5 | `~/.claude/keybindings.json`, additive, `null` unbinds, hot reload, typed validation, reserved registry | All of it, on upstream's own path and file shape; issues land in the transcript, never in a crash | ✅ |
| K6 | `command:<name>` bindings (Chat-only) | Validated at load and dispatched through the composer's own submit seam — the same path a typed `/name` takes, unknown names included | ✅ |
| K7 | Key normalisation + alias table, `alt ≡ meta` | `keys/normalize.ts`: one canonical spec string; `meta`/`opt`/`option` fold into `alt`, `cmd`/`win` into `super`, `ctrl+-` ≡ `ctrl+_` | ✅ |
| K8 | Platform branching (`alt+v` vs `ctrl+v` paste, `shift+tab` vs `meta+m`, iTerm2 coercion, tmux hint) | None — `shift+tab` is the default for `chat:cycleMode` (rebindable), and there is no paste key at all (see K35) | ❌ |
| K9 | Kill ring with `ctrl+y` / `alt+y` | `editor.ts` kill ring (cap 10, coalescing runs) + the yank hint | ✅ (F0) |
| K10 | `ctrl+b`/`ctrl+f`/`ctrl+h` in the composer | Not bound in the composer: `ctrl+b` is ours for background (a recorded standing divergence), `ctrl+f`/`ctrl+h` are unbound | ❌ |
| K11 | `ctrl+n`/`ctrl+p` as composer history | Not bound in Chat (they are list-nav keys in `Select`/`MessageSelector`/`Transcript`) | ❌ |
| K12 | `alt+d` delete-word-after | Not bound | ❌ |
| K13 | `escape escape`: text ⇒ clear, empty ⇒ rewind | Exactly that (F0 CM15); the arms live in the composer and `ChatApp`, the key in the table | ✅ |
| K14 | `←←` on an empty composer ⇒ agents view | No agents view exists in `ccx` | 🚫 |
| K15 | Confirmation `y` / `n` | Bound, alongside the digits and the legacy `a`/`A`/`d` aliases | ✅ (F0) |
| K16 | Confirmation `tab` next field · `shift+tab` cycle mode · `ctrl+e` explanation | Not built — an explicit F2 non-goal | ❌ |
| K17 | `meta+p` · `meta+t` · `meta+o` · `meta+w` | `alt+p` (model picker) and `alt+t` (thinking) ship; `meta+o`/`meta+w` dropped with the rationale above | 🟡 |
| K18 | `cmd+k` clear screen | Unreachable (see the table above); screen clear stays `/clear` | 🚫 |
| K19 | `ctrl+shift+b` brief · `ctrl+]` artifact | No such surfaces, and `ctrl+shift+<letter>` is unreachable anyway | 🚫 |
| K20 | `ctrl+up`/`down`, `meta+up`/`down` diff file list | Vestigial upstream (no handler registered anywhere in their bundle) and no diff file list here | 🚫 |
| K21 | The whole `DiffDialog` / `DiffPanel` contexts | No such surface; `DiffDialog`/`DiffPanel` validate as context names and carry no bindings, exactly as upstream ships `DiffPanel` | 🚫 |
| K22 | The `Scroll` context (wheel, `ctrl+home`/`end`, shift-arrow selection, copy) | Not built — an explicit F2 non-goal (`KB12`); needs terminal mouse-mode ownership | ❌ |
| K23 | The `Footer` context (focusable footer indicators) | No focusable footer | 🚫 |
| K24 | The `Attachments` context (image attachment navigation) | No image attachments (see K35) | 🚫 |
| K25 | The `Plugin` context | No plugin surface in the REPL | 🚫 |
| K26 | `ModelPicker`: `←`/`→` effort, `s` session-only | Not bound; our picker is arrows + enter through the `Select` context | ❌ |
| K27 | `MessageSelector`: `j`/`k`, `ctrl+n`/`ctrl+p`, eight top/bottom jump aliases | All of them (`KB14`, F2) | ✅ |
| K28 | `Select`: `j`/`k`, `ctrl+n`/`ctrl+p`, `pageup`/`pagedown`, `home`/`end` | All of them, once, for every list overlay — they share the context (`KB15`, F2) | ✅ |
| K29 | `Settings`: `r` retry, `d`/`w` period, `t` sort, `ctrl+u`/`ctrl+d` half-page | Not built — an explicit F2 non-goal (`KB16`); our Usage/Stats tabs are static | ❌ |
| K30 | `Transcript`: `ctrl+e` toggle-show-all, `home`/`end` | Both bound, plus the pager's own scroll set, and the two root globals that were dead inside it are `null` in the table rather than silently live | ✅ |
| K31 | `Task`: `ctrl+x ctrl+b` as an alias for `ctrl+b` | Bound, and scoped to a running turn (`KB18`, F2) | ✅ |
| K32 | `ThemePicker`: `ctrl+t` highlight toggle, `ctrl+e` edit custom theme | Not built — an explicit F2 non-goal (`KB19`) | ❌ |
| K33 | Pager extras `{` `}` `/` `n` `N` `[` `v` | Not built (`KB20`) | ❌ |
| K34 | `space` ⇒ `voice:pushToTalk` in Chat | No voice mode; `space` types a space | 🚫 |
| K35 | `ctrl+v` / `alt+v` ⇒ `chat:imagePaste` | Not built; the open question is the SDK image-block surface (P87), not the key | ❌ |
| K36 | `Help` binds only `escape` | Structural now: the overlay pushes `Help` and swallows, so the provider drops everything else — including `Global`'s own keys | ✅ (F0 + F2) |
| K37 | `ctrl+z` is a reserved-key **warning**, not a binding | Same: the registry warns, and `ctrl+z` is handled pre-table (SIGTSTP), above context dispatch, so it fires under a swallow and mid-chord | ✅ |
| K38 | `ctrl+d` on an empty composer needs two presses | Two presses, upstream's own 800 ms window | ✅ (F0) |
| K39 | Four working `chat:undo` aliases | `ctrl+_`/`ctrl+-` reachable (matched as the raw `0x1f` byte, and canonicalised to one spec) | ✅ (F0) |
| K40 | `shift+enter` newline via `/terminal-setup` | Not built; the key itself is unreachable without it (see the table above) | ❌ |

**Ledger score: 18✅ + 1🟡 of 31 non-🚫 rows ≈ 60%.** The nine 🚫 rows are surfaces `ccx` does not have
or bindings upstream itself never wired.

### Accepted behaviour deltas from F2

Five behaviours changed in ways a user could notice. Each is deliberate and each has a reason:

- **The key that breaks a pending chord is swallowed.** Type `ctrl+x` and then `h`, and the `h` is
  dropped rather than inserted. This is upstream's own chord machine (`Q4u`) and the price of generic
  chords: while a prefix pends, only extensions and `escape` are considered. Pre-F2 our two bespoke
  chords let the stray key through into the editor.
- **`space` now confirms the highlighted row inside `/config`'s embedded theme picker.** The `Settings`
  context binds `space` → `select:accept` (upstream's own binding), and the theme rows live under it —
  consistent with the row's own "Enter/Space to change" footer, which previously only half worked.
- **Embedded "Add directory…" prompts under the permissions dialog no longer move the parent row
  cursor while a path is typed.** The embedded prompt owns its own context, so `j`/`k` inside a path go
  into the path. Before, they were also list navigation in the dialog behind it.
- **`meta+o` and `meta+w` are not bound** (rationale above): no fast mode and no workflow-keyword
  surface exists for them to reach.
- **Hint strings can now say `(unbound)`.** Unbind an action in `keybindings.json` and the shortcuts
  grid says so instead of continuing to advertise the old chord. That is the intended outcome of
  deriving hints, not a rendering gap.

### Hint derivation — generated, and the three exceptions

Derived from the live table (`keys/hints.ts` + `useBindingLookup`): the composer's footer ladder, its `Esc`
hint, its two double-press arms (Esc-clear and Ctrl-D exit) and the autocomplete popup's footer; the status
bar's mode-chip parenthetical; and every table-owned row of the `?` shortcuts grid. The mode chip carries two
gates on top of the derivation, both upstream's own: it renders only in a **non-default mode**
(`04-chrome.md` §1.2 rung 10, §1.3) and only while the **composer actually owns the keyboard** — a hint is
honest only relative to its focused owner. Ownership reaches the bar as a prop derived from state during
render, not as a read of the scope registry, which a passive-effect cleanup mutates without repainting
anything. `test/tui/keys-acceptance.test.tsx`'s derivation guard greps all three components for the display
literal of every hinted action, so a chord typed back in fails the build. Still literal, deliberately:

- **The transcript-pager footer** is a multi-alias ladder (`j/k ↑↓ line · Ctrl-U/D ½page · …`): most of
  its actions carry three or four aliases, and a generated string would list all of them and read worse
  than the hand-written one. Upstream's own hint ladder is hand-written per rung for the same reason.
- **The history-search footer** is excluded on cost, not on alias count — the earlier wording here was
  wrong about it. Four of its five rungs are single-binding (`execute`=enter, `next`=ctrl+r,
  `cycleScope`=ctrl+s, `cancel`=ctrl+c) and only `accept` has a pair (escape, tab). It stays literal
  because it is one line, served correctly by one string, and deriving it buys nothing a user would see.
- **`toolRenderer.ts`'s `(ctrl+o to expand)` fold marker** is excluded on cost and on the text being
  pinned to the tracked 2.1.220 golden capture — NOT, as previously written here, because the module
  cannot reach a lookup: it is called from `useChat.ts:26`, a hook, through an existing
  `ProjectionContext` parameter, so one could be threaded in without touching the module's purity. It is
  recorded here so it stays a decision rather than a gap.
- **ChatApp's two double-press notices** (`Press Ctrl-C again to exit`, `Press Esc again to rewind`)
  are still literal too, and ChatApp is not in the derivation guard's grep set — recorded here (t10
  re-review) so the exception is a decision, not an unnoticed gap.

One honesty caveat on the derivation itself (t10 re-review): the composer's double-press arm hints
(`Esc again to clear`, `Press Ctrl-D again to exit`) DO follow the user's keymap now, but the handlers
behind `chat:cancel`, `chat:clearInput` and `app:exit` still re-derive from physical key flags
(`ChatComposer.tsx` site comment) — so under a full rebind those hints confidently name a key that does
nothing, a slightly worse failure than the old stale literal, which at least named a key that worked.
Registering those three the way `chat:cycleMode` was in t10-fix is the open follow-up.

The editor's own keys (`⏎`, `\⏎`, the readline set, `Ctrl-_`, `Ctrl-S`, the `!`/`#`/`@`/`/` prefixes)
are literal by design: `editor.ts` is the keymap's FALLBACK and no context binds them, so there is no
live binding to derive. `test/tui/honesty.test.tsx` pins every one of them to an executable proof.

## 2 — Transcript / message rendering

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| User prompt echo | 🟡 | LOW | we show `› text` dim (intentional clean variant). **F0 correction:** the note was wrong, not just the score — upstream does not use plain `>`, it uses **`❯ ` (U+276F)** in the `subtle` colour on a `userMessageBackground` band |
| Assistant message identity (`●` bullet, accent) | 🟡 | — | **U3** accent `●` gutter + aligned continuation (live + replay). **F0 correction:** two divergences under one ✅ — upstream's bullet is **`⏺`** on macOS (not `●`), and its colour is the plain `text` token, **not an accent** |
| Thinking blocks (stream + collapse) | 🟡 | — | `liveTurn.ts` `✦ Thinking`; CC `✻`/token count. **F0 correction:** upstream shows a **duration**, not a token count; the streaming glyph is `✻` but the content gutter is `∴`; and the content is **hidden by default** |
| Tool-use rows | 🟡 | — | **C5** `render.ts` `toolUseLines` — CC's `● Name(target)` bullet form (was `⚙`); live turn status glyphs unchanged. **F0 correction (`ST1`):** only the **replay** path renders `● Name(target)` — the live path renders `Name target`, no parens, no bold. Upstream bolds the name and the row adds the parens; two paths disagreeing about the same tool call is itself the defect |
| Tool result tree glyph (`⎿`) | 🟡 | — | **U3** dim `⎿` result tree. **F0 correction:** ours prefixes `  ⎿ ` (4 cols) to **every** line of a multi-line result; upstream emits it **once** at 5 columns, with the content in a sibling flex column |
| Markdown: headers/lists/quote/fenced | 🟡 | — | `markdown.ts` (lightweight). **F0 correction:** no links, no images, no strikethrough, no `hr`, no task lists, no nested lists, no depth-varying heading style, no block separation — not a ✅ |
| Markdown: inline mixed bold/italic spans | ✅ | — | **U11** per-span `segments` (bold/italic/code) rendered within a line |
| Markdown: tables | 🟡 | — | **C5** `markdown.ts` `flushTableBuffer` — a buffered run of `\|`-lines becomes a column-padded table only once a `\|---\|` separator confirms it; otherwise re-emitted as prose untouched. **F0 correction:** upstream draws a box table with per-column alignment, three-way width fitting, a rule between every pair of data rows, a 200-row cap, and a vertical record fallback — ours has none of that |
| Markdown: code-block syntax highlight | ✅ | — | **C5** `highlight.ts` — a zero-dependency regex lexer (keywords/strings/comments/numbers for ts/js/py/sh/json). **Not a full grammar** — a hand-rolled single-pass lexer, a recognizable-90% approximation (spec Decision Log against a ~1MB dependency), unknown langs fall back to dim |
| Edit/Write diff | 🟡 | — | **C5** `render.ts` `toolDiffLines` — a real hunk body: up to 3 dim numbered context lines each side of the change, numbered `-`/`+` rows for the changed lines. The shipped implementation remains **hunk-relative**. **P94 correction, confirmed on 0.3.220:** recognized Edit sidecars expose absolute `structuredPatch[].oldStart/newStart`; the separate Write case exposes content/file metadata. Flat-only and forwarded calls still require input fallback. **F0 correction:** no add/remove counts header, **foreground colour instead of background bands**, no word diff, no wrapping, and a 24-line cap upstream does not have |
| Bash output rendering | 🟡 | MED | **C5**: only error framing landed — a failed `tool_result` (`is_error`) renders red with a `✗` prefix on its first line (`render.ts` `resultLines`). **P94 correction, confirmed on 0.3.220:** some Bash calls carry structured stdout/stderr/interrupted/noOutputExpected/isImage and optional `returnCodeInterpretation`, while most remain flat-only. No numeric exit code appeared, so `$`/exit-code framing remains unreachable and the row stays 🟡 |
| Long-output truncation + expand | 🟡 | **MED (structural)** | we cap; no interactive expand. **F0 correction:** the LOW priority was wrong — `(ctrl+o to expand)` is one mechanism that also drives collapsed groups, verbose diffs and expanded thinking; this is `ST2`, a structural gap, not a tail item |
| Compact boundary marker | 🟡 | — | **C5** `useChat.ts` — a `system`/`compact_boundary` frame renders a `─── context compacted ───` divider notice. **F0 correction:** upstream renders a bulleted `Compact summary` with a message count and an expand affordance, not a rule |
| Welcome banner / splash | ✅ | — | **U1** `banner.ts` — accent `✻ Welcome` box + cwd/model/mode + tips |
| Tip of the day | ❌ | LOW | `tipScheduler.ts` |
| Message timestamps | 🚫 | — | off by default in CC |

## 3 — Status / chrome

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Status bar (model · mode · ctx%) | 🟡 | — | `ChatStatusBar.tsx`. **F0 correction:** upstream's footer has **none of the three** by default — model lives in the startup header, `/status` and `statusLine`; cost only in `/cost` and `statusLine`; ctx% is a transient notification, not a persistent readout. Downgraded rather than moved to Recorded additions, since the underlying concept (showing model/ctx) does exist upstream, just relocated — a form divergence, not a pure addition (would rise to ✅ once gated behind the `statusLine` extension point the Decision Log calls for, with the upstream-exact minimal footer as default) |
| Spinner glyph (`✻` asterisk-pulse) | 🟡 | — | **U2** `spinner.ts` `·✢✳✶✻✽` fwd+reverse, Claude accent. **F0 correction:** glyph set is right, but the **timing model is wrong** (upstream: 2000ms triangle wave over 6 base glyphs, 100/50ms clock; ours: 120ms over 12) and the ghostty `TERM` glyph variant is missing |
| Spinner thinking verbs (187, random) | 🟡 | — | **U2** verbatim 187-verb vocabulary, fixed per turn. **F0 correction:** upstream has **186**, not 187 — we carry one extra (`"Evaporating"`, pure drift, no argument for it, recommended for deletion in a future wave). And the random verb is the **last** fallback, not the primary source — upstream shows the active todo's `activeForm` first |
| "esc to interrupt" affordance on spinner | 🟡 | — | **U2** `(elapsed · esc to interrupt)`. **F0 correction:** upstream puts this in the **footer** hint ladder, only while loading — never inside the spinner text itself. Scored 🟡 rather than lower since the affordance is genuinely present and discoverable, just in the wrong widget (would rise to ✅ by moving it to the footer hint ladder) |
| Live token counter during turn | ✅ | — | **U10** real running output tokens from `message_delta` usage, in the spinner |
| Elapsed timer during turn | ✅ | — | **U2** whole-turn elapsed in the spinner |
| Context-left % + threshold warning | 🟡 | — | **U13** ctx% color-escalates green→yellow→red + "⚠ auto-compact soon" near the window. **F0 correction:** different trigger model (upstream is a queued notification, hidden entirely at `level === "ok"`), different text, different surface (transient, not a persistent status-bar segment) |
| Permission-mode indicator (color) | 🟡 | — | `ChatStatusBar.tsx` modeColor. **F0 correction:** our colours are ours, not upstream's 6-entry table; no symbol (`⏸`/`⏵⏵`), no ` on` suffix. **F2 update (2026-08-04, corrected in the t10 fix round):** the `(shift+tab to cycle)` parenthetical now ships and is DERIVED from the live keymap — it prints whatever the user has bound `chat:cycleMode` to, and it renders only when BOTH of upstream's conditions hold: a non-default mode, and the composer actually owning the keyboard. The first shipped version printed it in every mode including `default`, where upstream prints none; that divergence was recorded as progress here and is now fixed. Still 🟡, and the list is longer than it was: the remaining gaps are the crowding rung of upstream's eleven-rung footer ladder (rung 10 fires only when the footer is not crowded — our footer architecture has no such contest, so the rung is not replicated), the symbol (`⏸`/`⏵⏵`), the ` on` suffix and the six-entry colour table |
| Cost in status / `/cost` | ✅ | — | **U4** `/cost` via `session.usage()` |
| `? for shortcuts` hint line | 🟡 | — | **C5** `ShortcutsOverlay.tsx`, opened by `?` — supersedes the footer-hint-only prior state (§1). **F0 correction:** we show a fixed 3-item string; upstream is an **11-rung one-winner ladder** where `? for shortcuts` appears only when everything else is empty and the mode chip is default |
| Vim mode indicator | ❌ | LOW | tied to vim mode |
| Notification queue (`ST8`) | ❌ | — | **F0 — new row, no prior row existed.** Upstream has a real notification queue: 4 priorities, `fold`/`invalidates`/`pinned` semantics, an 8s default lifetime, preemption + requeue. We have `notice()`, which just appends a transcript line — no queue, no priority, no folding |
| `statusLine` extension point | ❌ | — | **F0 — new row, no prior row existed.** Upstream's real architecture for exactly the information our footer currently hard-codes — a scriptable status-line extension, and a compatibility surface for third-party scripts. Owner decision (Decision Log): build the extension point, ship an upstream-exact minimal default footer (mode chip + one-rung hint), and gate model/cost/ctx%/streaming/bg-count/thinking-level behind it as opt-in settings rather than deleting them |
| Terminal title | ❌ | — | **F0 — new row, no prior row existed.** No coverage in this harness at all |
| Desktop notifications | ❌ | — | **F0 — new row, no prior row existed.** No coverage in this harness at all |
| Tab status | ❌ | — | **F0 — new row, no prior row existed.** No coverage in this harness at all |
| Reduced motion | ❌ | — | **F0 — new row, no prior row existed.** No accessibility affordance for suppressing the spinner/animation |
| Resize / `SIGCONT` repaint handling | ❌ | — | **F0 — new row, no prior row existed.** Upstream repaints correctly across a terminal resize and a suspend/resume cycle; ours was proven this wave (F0 t6) to leak Ink's ref-counted raw-mode state on suspend before the fix, and resize handling generally has no dedicated row or test |

## 4 — Modals / overlays

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Permission approval dialog | 🟡 | — | **U9** numbered arrow-selectable Yes / Yes-don't-ask-again / No (↑↓·Enter·1/2/3·Esc; legacy a/A/d kept). **F0 correction:** upstream has **13 dialog kinds** behind a per-tool matcher; ours is one shape for all tools. Missing: per-tool titles, question lines, real inline diffs in the body, destructive-command warnings, symlink warnings, session/prefix/domain persist rows; our `allow_always` is an in-memory `Set<toolName>` that never persists and never emits `updatedPermissions`. **fixed 2026-07-31 (F0, t7, KB1):** `y`/`n` are now bound (`y`=accept once, `n`=reject) alongside the existing ↑↓·Enter·1/2/3·Esc and legacy a/A/d — upstream's two most reflexive confirmation keys were dead before this. The global composer status hint is hidden while the decision owns input, so Question/Plan surfaces do not advertise permission-only chords. |
| Bash permission shows full command | 🟡 | — | **U9** `$ <command>` shown in full; file tools show the path. **F0 correction:** we clip to 140 chars; upstream shows the rendered command **plus** the description **plus** a destructive-pattern warning |
| Model picker | 🟡 | — | `ModelPicker.tsx`. **F0 correction:** no effort axis, no `s` session-only toggle, no pricing/entitlement metadata, no overflow counter or row window, different header and subtitle |
| Resume session picker | 🟡 | — | `SessionPicker.tsx`. **F0 correction:** upstream has a search bar, expandable groups, `Space` preview, `Ctrl+R` rename, `Ctrl+A/B/W` scope toggles and an `(N of M)` header; ours is a flat list |
| Task/todo panel | 🟡 | — | `TaskPanel.tsx`. **F0 correction:** different glyphs, no strikethrough on completed items, no bold on in-progress, no header counts, no owner/blocker/activity lines, not persisted to a setting |
| Ctrl-T todo-panel toggle | ✅ | — | **W1** — 2.1.220 `app:toggleTodos` (default visible) |
| Transcript pager (Ctrl-O) | 🟡 | — | **W2** `TranscriptPager.tsx` + pure `pager.ts` — the bundle's 18-binding Transcript context (j/k · ctrl-u/d half · ctrl-b/f b/space page · g/G · arrows · q/Esc/ctrl-c exit), opens at bottom; bordered overlay, not alt-screen (see W2 divergences). **F0 correction:** scored against the wrong mechanism — upstream's `ctrl+o` is a **verbose-mode flip** (`ST2`) that changes what every renderer emits, not a scrollback pager. Both are useful features; they are not the same feature. `ST2` is the real row for upstream's mechanism (see §2's "Long-output truncation + expand") |
| History search (Ctrl-R) | ✅ | — | **W2** `HistorySearchOverlay.tsx` + pure `historySearch.ts` — incremental prompt search over session/project/everywhere scopes (Ctrl-S cycles, initial "everywhere"), substring-then-subsequence ranking, Esc/Tab accept into composer · Enter execute · Ctrl-C cancel — the bundle's HistorySearch context key for key |
| SettingsDialog (`/config`, `/settings`) | 🟡 | — | **W3** `SettingsDialog.tsx` — four tabs (Status·Config·Usage·Stats, wrapping tab/shift+tab/←→), Config tab live rows + `/` search + Esc-close change summary (`Set {label} to {value}`, bold value); but only **5 of upstream's ~54 Config rows** ship (Theme/Model/Output style/Default permission mode/Thinking mode — the ones this harness's engine can actually apply) and there is no header-focus mode, so upstream's `Settings dialog dismissed` string is unused (W3 divergence) |
| PermissionsDialog (`/permissions`, `/allowed-tools`) | ✅ | — | **W3** `PermissionsDialog.tsx` — all five upstream tabs (Recently denied/Allow/Ask/Deny/Workspace), provenance-aware rule rows, add-rule flow with the destination picker (project-local/project/user settings, verbatim upstream typo `Saved in at ~/.claude/settings.json` kept), delete confirm, a read-only panel for non-editable rules, workspace directory add/remove. Divergences: rules apply via the flag layer **and** get written to the chosen settings file (upstream's rule engine is CLI-internal, invisible to us) — functionally equivalent but no upstream shadowing warnings fire; the Recently-denied footer intentionally drops two dead key chords (W3 divergences) |
| ThemeDialog (`/theme`) | 🟡 | — | **W3** `theme.ts` (live-binding token set) + `ThemeDialog.tsx` — picker with the exact `demo.js` live diff preview, Esc-restore. **F0 correction:** it is exactly **7 built-in picker rows** (`auto` + 6 palettes) upstream ships, not "7+" — the two we lack are the **ANSI variants**, whose whole point is that the terminal owns the colours, so ship 5 of 7, not "5 of 7+". **The `auto`-equals-`dark` note's stated reason was wrong for the foreground REPL**: upstream's Tier 2 detection (`COLORFGBG` env read) works today with no extra work, and Tier 1 (OSC 11) needs raw stdin plus a stdout write — both of which the foreground REPL already owns. The constraint is real only for the daemon path; the gap here is smaller than the old note claimed. A theme still recolors NEW output only — Ink's `<Static>` scrollback keeps whatever colors it was written with (unchanged, genuine `<Static>` constraint) |
| AddDirDialog (`/add-dir`) | ✅ | — | **W3** `AddDirDialog.tsx` + `addDir.ts` — verbatim 2.1.220 validation copy (not-found / not-a-directory / already-added variants) and confirm dialog (session-only / remember-to-local-settings / cancel); grants go through `applyFlagSettings({additionalDirectories})` for outside-cwd paths only (probe 75) — inside-cwd paths are rejected as already accessible, so the other engine door probe 75 found, `register_repo_root`, stays permanently unused by this command |
| `/help` overlay | 🟡 | LOW | we print lines; CC has a modal |
| IDE diff viewer | 🚫 | — | IDE-coupled |
| MCP elicitation dialog | 🚫 | — | rarely fires headless |
| `Select`/`Tabs` primitives (`ST7`) | ❌ | — | **F0 — new row, no prior row existed.** Upstream has one `Select` (absolute indexes, `↑`/`↓` gutter overflow, `inlineDescriptions`, `type:"input"` rows, height-clamped paging) and one `Tabs`, reused by 9 different dialogs. Every dialog we have hand-rolls its own list and key handling instead |
| `DiffDialog` | ❌ | — | **F0 — new row, no prior row existed.** A real upstream dialog kind with no ccx equivalent — distinct from the diff *sidebar*, which is vestigial upstream dead code (E1 in the spec, not cloned on purpose). `/diff` here is a terminal stand-in (`git status --short`/`git diff --stat`, §5), not this dialog |
| `EnterPlanMode` | ❌ | — | **F0 — new row, no prior row existed.** The counterpart to `ExitPlanMode` (§8, "Plan-mode approval dialog") — how a user or model *enters* plan mode with its own dialog upstream. We have the Tab-ladder `plan` rung (§8) but no dedicated entry dialog |
| Background-dialog detail sub-dialogs | ❌ | — | **F0 — new row, no prior row existed.** Upstream's background-task panel has per-task detail sub-dialogs beyond the flat row list `BgTasksPanel.tsx` (§8) provides |

## 5 — Slash commands

| Command | Status | Notes |
|---|---|---|
| `/clear` `/compact` `/context` `/model` `/resume` `/continue` `/help` `/think` `/yolo` | ✅ | local, dispatched |
| live skill/plugin/user catalog (105) | ✅ | command palette (Increment D) |
| `/cost` | ✅ | **U4** — `session.usage()` → cost (or "included in <plan>") + tokens + duration + per-model |
| `/status` | ✅ | **U4** — model · mode · thinking · context · cwd · session snapshot |
| `/vim` | ❌ | LOW (owner-deferred) |
| honesty routing of catalogued client-side controls | ✅ | **W1** — `agents`/`color`/`config`/`effort`/`extra-usage`/`fast`/`heapdump` print an explicit "why not here" line instead of silently becoming prompt turns; `/review` + `/doctor` stay prompt turns (prompt-type upstream) |
| `/add-dir` | ✅ | **W3** `AddDirDialog.tsx` — rejects inside-cwd paths as already accessible; outside-cwd paths grant access via `additionalDirectories` (probe 75) — `register_repo_root`, probe 75's other engine door, is reachable but never used by this command (its only usable domain is exactly what `/add-dir` rejects); "remember" writes `.claude/settings.local.json` |
| `/config` (alias `/settings`) | 🟡 | **W3** — opens `SettingsDialog`'s Config tab; also `/config key=value` inline parsing with upstream's exact error copy. Only 5 of upstream's ~54 rows are wired — see §4's SettingsDialog row |
| `/permissions` (alias `/allowed-tools`) | ✅ | **W3** — opens `PermissionsDialog`; five tabs, add/delete rules, workspace directory management — see §4's PermissionsDialog row |
| `/theme` | 🟡 | **W3** — opens `ThemeDialog`; 5 of exactly 7 built-in upstream themes shipped (not "7+" — F0 correction), `auto` currently ≡ `dark` for a reason smaller than previously stated — see §4's ThemeDialog row (F0-corrected) |
| `/output-style` | ✅ | **W3** — prints the exact redirect line then opens `/config`'s Output-style row. This matches upstream's **own** 2.1.220 behavior — its standalone picker is itself a hidden redirect into `/config` (bundle-extraction surprise, see the spec) |
| `/keybindings` | ✅ | **W3 → F2 (2026-08-04).** Upstream opens `~/.claude/keybindings.json` in `$EDITOR`, and so do we — seeding a documented starter file when none exists, and applying every save live (no restart). The W3 divergence ("viewing, not editing") is retired: the user layer it needed now exists. The read-only `?` keymap remains only as the fallback for a shell with neither `$VISUAL` nor `$EDITOR`, which says so in the notice |
| `/export` (file or clipboard) | ✅ | **W1** `sessionTools.ts` `exportMarkdown` — prompts as `## ›` headings, tools as one-line markers |
| `/files` (files touched in conversation) | ✅ | **W1** `filesInContext` — tool-input paths, deduped, last-touch order |
| `/diff` | 🟡 | **W1** terminal stand-in (`git status --short; git diff --stat` via the `!`-runner) — real CC has a full DiffDialog with per-turn sources (Wave-2+ candidate) |
| `/stats` | ✅ | **W1** conversation shape (prompts/replies/tool calls) + per-model tokens + cost |
| `/session` | ✅ | **W1 — deliberate divergence:** upstream's `/session` is a cloud-URL/QR bridge feature (out of scope); ours shows local id/title/tag/branch + `ccx --resume` hint |
| `/rename` `/tag` | ✅ | **W1** — SDK-native `renameSession`/`tagSession` (tag toggles: same name twice clears) |
| `/copy` | ✅ | **C5** `copy.ts` (DI'd `pbcopy`/`xclip` spawn) — copies the last assistant reply, live or replayed (`sessions/rows.ts` `lastAssistantText`) |
| `/usage` | ✅ | **C5** (F4) — `usageFormat.ts` `formatUsage` renders per-window utilization bars from `session.usage()`; honest unavailable-line when `rate_limits_available` is false |
| `/rewind` | ✅ | **C5** — opens the Esc-Esc picker via command (`useChat.ts`), the same entry point as the gesture |

## 6 — Polish

| Detail | Status | Priority |
|---|---|---|
| Asterisk-pulse spinner animation | 🟡 | **U2**. **F0 correction:** mirrors §3's "Spinner glyph" finding — glyph set is right, but the timing model is wrong (upstream's 2000ms triangle wave over 6 glyphs vs. our 120ms/12) |
| Random thinking verbs | 🟡 | **U2**. **F0 correction:** mirrors §3's "Spinner thinking verbs" finding — 186 upstream verbs not 187 (we carry one extra), and the random verb is upstream's last fallback, not its primary source (the active todo's `activeForm` goes first) |
| `●`/`⎿` message prefix glyphs + accent colors | 🟡 | **U3**. **F0 correction:** mirrors §2's "Assistant message identity" and "Tool result tree glyph" findings — the bullet is `⏺` on macOS in the plain `text` token (not an accent `●`), and `⎿` is emitted once at 5 columns upstream, not prefixed per line (`>` user echo kept as `›` by choice, itself corrected to upstream's `❯ ` in §2) |
| "esc to interrupt" everywhere a turn runs | 🟡 | **U2**. **F0 correction:** mirrors §3's "esc to interrupt affordance on spinner" finding — upstream puts this in the footer hint ladder only while loading, never inside the spinner text |
| Ctrl-C interrupt + double-press-to-exit | ✅ | **U8** |
| Double-Esc to rewind affordance | ✅ | **C5 — the flagship (U12)**: `RewindPicker.tsx` + `sessions/rows.ts` (content-shape anchor classifier, shared with `replay.ts`) + `host/host.ts` (`rewindAnchors`/`rewindDryRun`/`rewind`, validated before every side effect) + `ChatApp.tsx` Esc-Esc arming (1.5s idle-only window; busy Esc stays interrupt). Restores conversation and/or code via CC's 3-way picker; a conversation restore pre-fills the composer with the prompt text (CC's edit-and-resend loop). **fixed 2026-07-31 (F0, t2, CM15):** Esc-Esc used to open this rewind flow unconditionally. It is now gated to an **empty** composer only — with typed text present, the first Escape arms an "Esc again to clear" hint and the second press clears the text back into history instead (`clearToHistory`), so typed text can never be lost into a rewind prompt. Rewind itself is unchanged once the composer is empty |
| Newline instructions hint | ✅ | **U7** footer (`\⏎ newline`) |
| Focus borders / input box styling | 🟡 | LOW |
| Theme token contract (`ST4`) | ❌ | **F0 — new row, no prior row existed.** Upstream reads 72 semantic theme tokens by name across 956 prop usages. Our `ThemeTokens` set is 3 tokens (`accent`, `diffAdd`, `diffRemove`); ~15 colours our TUI actually paints are hardcoded ANSI names scattered across 5 files, invisible to `setTheme()`. This is the prerequisite every other theme row (ThemeDialog, diff colouring, subagent attribution colours) sits on top of |

## 8 — Control plane

> A distinct axis from §1–6: those measure *look-and-feel*; this measures whether the model's
> control-plane calls (`AskUserQuestion`, `ExitPlanMode`, background shells, subagent task lifecycle)
> reach a human **at all** — the gap `docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md`
> (Goal B of the clone spine) closed. Before this work the sweep behind that spec found **zero** handling
> for all four surfaces. Shipped GB1–GB10 (`main` `fb8933dee8..260fad720e`).

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| AskUserQuestion dialog | 🟡 | — | **GB8** `QuestionDialog.tsx` — sequential per-question flow (`[i/N]` progress, header chip), options as numbered rows + arrows, `multiSelect` toggled with space, an always-present "Other" free-text row → `response`; consults `canUseTool` in every permission mode incl. `bypassPermissions` (probe 65). Divergence: CC renders multiple questions as **side-by-side tabs**; we go one at a time — keyboard-identical outcomes, an accepted divergence (spec Decision Log). **F0 addition:** two more missing facts on record — upstream also has a **design-preview two-column variant** when any option carries a `preview`, and an **AFK auto-resolve** that submits partial answers on timeout; neither exists here |
| Plan-mode approval dialog (ExitPlanMode) | 🟡 | — | **GB9** — moved here from §4 (was ❌). `PlanDialog.tsx` renders the plan as markdown in a 14-line scrollable window (↑↓ scroll), then CC's three choices (`1` approve + auto-accept edits · `2` approve, manual edits · `3`/Esc reject with a one-line feedback prompt); approve lets the CLI flip `permissionMode` itself (probe 66) — the dialog only reports the human's choice. **F0 correction:** upstream's is the **only** `layout:"modal"` dialog, titled `"Ready to code?"`, with up to **6 conditional options** including a clear-context family that **denies and re-seeds a fresh turn**, and an inline `"No, keep planning"` text input that keeps the dialog open on an empty submit. Ours has 3 fixed options |
| `plan` on the Tab ladder | ✅ | — | **GB7** the ladder is now `default → acceptEdits → plan → auto` (`useChat.ts` `ladderNext`); off-ladder modes (`bypassPermissions`) still re-enter at `default` |
| Ctrl+B background | 🟡 | — | **GB10** `ChatApp.tsx` — the key and the host `background` op are fully wired (`backgroundNow` → `Session.backgroundAll()`, probe 39) and idle `Ctrl+B` opens the background-task panel; but **live acceptance (2026-07-28)** found the real CLI does not detach an in-flight foreground `Bash` call — the op is accepted and the SDK reports success, yet the command runs to completion in the foreground regardless. The verified surface is **model-initiated** background shells (`run_in_background: true`): `⚙ N` status-bar count, `/bg` panel row, and stop-from-panel all confirmed live |
| `/bg` panel | 🟡 | — | **GB10 + W2** `BgTasksPanel.tsx` — one row per background task with **status glyph + command line** (harvest-enriched `BgTaskRow`), plus up to 5 recently-finished rows (dim, with final status); ↑↓ select, `k`/`x` stop (running rows only), Esc close. Divergence: the command is **`/bg`**, not `/tasks` — `/tasks` would collide with the existing `TaskPanel.tsx` (the model's todo checklist), a deliberate rename recorded in the spec's Decision Log |
| Background task **output** reachable (Enter-to-tail) | ✅ | — | **W2** probe-74 mechanism: the backgrounded tool_result names the output file ("Output is being written to: <path>"); `bgTaskMeta.ts` harvests path+command+status client-side from frames the REPL already receives (zero host/wire change — works identically over `ccx attach`), and Enter on a panel row tails the file's last 12 lines in-panel (Enter again re-reads; `local_agent` rows deliberately not tailed) |
| Ctrl-X Ctrl-K kill agents | ✅ | — | **W2** — 2.1.220 `chat:killAgents` flow verbatim: "No background agents running" when idle; first press arms ("Press Ctrl-X Ctrl-K again to stop background agents"), second within 3s stops all |
| Task lifecycle notices | ✅ | — | **GB7** `task_started`/`task_notification` frames render as one-line transcript notices (`⚙ task started: …` / `✓ task done: …` / `✗ task failed: …` / `◼ task stopped: …`), honoring `skip_transcript` |
| Subagent attribution on dialogs | 🟡 | — | **GB5** a host-side correlation map (`parentToolUseID` from nested frames → `subagentType` from `task_started` frames) stamps `Subagent (<type>) asks:` on the Question/Plan/Permission dialogs when known; **best-effort** — a miss renders unattributed and never blocks (no per-subagent drill-in transcript view — spec Non-goals). **F0 correction:** upstream renders this as a **frame-header suffix** (`· from the <name> agent`), not a separate line above, and colours subagents from 8 reserved theme tokens |
| Status-bar mode truth | ✅ | — | **GB5** the host intercepts the CLI's own `system`/`status` frames and pushes the real `permissionMode` on every `state` event (one field, last-write-wins between the CLI's own flip and the host's setter calls); closes the previously recorded "status bar starts at `default`" quirk — see the `full-use-checklist.md` A1 note, updated alongside this |

**Score: ~75% (F0 recount: 5✅ + 5🟡 of 10 rows = 7.5/10).** The previous ~80% (W2's first plain recount:
6✅+4🟡) is not wrong about capability — nothing regressed — but one of the six ✅ rows, Plan-mode
approval dialog, was scored against the wrong reference (see the F0 correction on that row above: 3
fixed options against upstream's up to 6 conditional ones, including a clear-context/re-seed family we
don't have) and moves to 🟡. AskUserQuestion and Subagent attribution stay 🟡 with two more missing
facts recorded each. Four rows are accepted, spec-recorded divergences from CC's exact form while
delivering the same functional/keyboard outcome (sequential questions, `/bg` naming, best-effort
attribution, the frame-header-suffix vs. separate-line attribution styling). Ctrl+B background remains
the one **live-acceptance-verified functional gap**, not a form divergence: the key/op path backgrounds
nothing for an already-running foreground shell, and only the model-initiated path
(`run_in_background: true`) reaches the panel. The other rows work identically in the foreground REPL
and over `ccx attach` — closing the spec's motivating failure ("a `--bg` worker that hits a question
and can only stall"). **Live acceptance ran 2026-07-28**
(`docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md` § Outcomes): the AskUserQuestion
round-trip (detached + Other free-text), the plan-approval loop, and subagent attribution all PASS;
background shells PASS for the model-initiated path and are where the Ctrl+B gap above was found.

---

## Execution plan (increments)

Ordered by **first-impression impact ÷ effort**. Each increment: pure reducer + thin view, keyless
unit tests, typecheck + build green, commit, update this scorecard.

- ✅ **U1 — Welcome banner** · ✅ **U2 — Authentic spinner** · ✅ **U3 — Message identity** ·
  ✅ **U4 — `/cost` + `/status`** · ✅ **U5 — `!` bash + `#` memory + mode indicator** ·
  ✅ **U6 — Queued input** · ✅ **U7 — Editor ergonomics** (all SHIPPED — see "Shipped" above).

**Round 1 (U1–U7) complete: overall ~46% → ~70%.** The recognizable CC look-and-feel (welcome banner,
asterisk-pulse verb spinner, `●`/`⎿` transcript, `!`/`#` modes, queueing, readline keys) is in place.

**Round 2:** ✅ **U8 — Ctrl-C interrupt + double-press exit + Ctrl-D** (`ChatApp` arms "Press Ctrl-C
again to exit" when idle, interrupts when busy; `ChatComposer` Ctrl-D-on-empty = EOF exit; bin renders
with `exitOnCtrlC:false`; 2 tests).

✅ **U9 — richer permission dialog** (`PermissionDialog` rewrite: numbered arrow-selectable Yes /
Yes-don't-ask-again / No over the tool + full target; ↑↓·Enter·1/2/3·Esc; legacy a/A/d kept; shared by
chat REPL + daemon console; 4 tests).

✅ **U10 — live token counter in spinner** (`liveTurn.outputTokens` from `message_delta` usage →
`useChat.turnTokens` → `TurnSpinner`; spinner status now `(3s · 142 tokens · esc to interrupt)`; 3 tests).

✅ **U11 — inline markdown spans** (`RenderLine.segments` + `markdown.parseInline`/`inlineLine` + `<Line>`
renders segments; whole-line single styles still fold into the line; `withAssistantBullet` indents the
first segment too; flows to live streaming + replay free; 5 markdown tests).

✅ **U13 — context threshold warning** (`ChatStatusBar.ctxColor`: ctx% escalates green→yellow→red and
shows "⚠ auto-compact soon" at ≥80%; status-bar hints updated for the new dialog + `? help`; 2 tests).

✅ **U14 — review-fix hardening** (two independent reviews — codex-companion fell back to Opus, plus a
Claude reviewer — **converged on the same 5 bugs**; all fixed, +5 regression tests, 221 green):
- **P1** queued unknown/typo `/cmd` stalled the drain — `dispatch` now returns whether it started a turn;
  `drainNext` re-drains non-turn items so the chain never stalls.
- **P2** mid-session `/resume` dropped the first N replay lines (the append-only `<Static>` wasn't
  remounted) — `resumeInto` now bumps `clearToken`.
- **P2** Tab/Esc were double-handled (accepting a `/`/`@` completion also cycled mode / interrupted the
  turn) — Tab/Esc are now routed *through* the composer (global only when no popup is open); `ChatApp`
  no longer owns them, and its Ctrl-C/Ctrl-L handler is now always-active (so Ctrl-C can quit during a
  pending dialog).
- **P2** replayed nested (subagent) lines with inline markdown lost their indent/dim (segments weren't
  indented) — fixed.
- **P3** `liveTurn.outputTokens` reset per-message on tool-using turns — now accumulates across messages.
- Plus: `interrupt` bumps a `drainGen` so a scheduled drain can't fire post-interrupt; `#` memory note
  collapses multi-line to one bullet. (Lesson: an interactive Ink app needs a TTY — smoke-test under a
  PTY (`script`), not a pipe, or you hit a spurious "Raw mode is not supported" error.)

**C5 (2026-07-28) shipped the remaining highest-ROI gaps** — see the "C5 — TUI closure shipped" block
above: Esc-Esc rewind (U12, the flagship), the usage surface (F4), the `?` overlay, word movement,
tool-row/diff/bash-error framing, tables, syntax highlight, the compact-boundary divider, and `/copy`.

### Remaining gaps as of C5 (pre-F0; all explicit spec non-goals or LOW-priority tail items)
- Vim mode (`/vim` + its status indicator) — owner-deferred, the sprint's only deferral. (The
  external editor formerly listed here shipped in W1 — Ctrl-X Ctrl-E / Ctrl-G, `externalEditor.ts`.)
- Bash output's `$`/exit-code framing — still not reachable: P94 confirms structured stdout/stderr,
  interruption/no-output flags, and optional string `returnCodeInterpretation` on some calls, but no numeric
  exit code; flat-only calls retain only result text plus `is_error` (the error-framing half already landed).
- Long-output interactive expand, the `›` vs `>` user-echo glyph (intentional divergence), and
  focus-border/input-box styling polish.

**F0 (2026-07-31) correction to this list: the biggest remaining gaps are not tail items.** This
section's heading was accurate for what C5 left behind, but F0 added ~14 rows the pre-F0 file had no
row for at all, and several of them are the *opposite* of low-priority tail work — the research
inventory itself rates the theme token contract (`ST4`), the keybinding table (`ST5`) and its
precedence resolver (`ST6`) as **Tier 1, Large effort**: "the largest structural gap in the whole
inventory," in the inventory's own words, and the root cause of the exact key-handling bugs F0 just
spent six tasks fixing one at a time. Treating them as tail items would repeat the mistake this
correction pass exists to end. See the new rows in §1 (`ST5`/`ST6`), §3 (`statusLine`, notification
queue, terminal title, desktop notifications, tab status, reduced motion, resize handling), §4
(`Select`/`Tabs` primitives, `DiffDialog`, `EnterPlanMode`, background-dialog sub-dialogs), and §6
(`ST4`) for the full list, each with its own priority note.
