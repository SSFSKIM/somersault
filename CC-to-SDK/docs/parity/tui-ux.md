# TUI/UX parity — `ccx` chat REPL vs. original Claude Code

> **Goal (2026-06-29):** bring our SDK-backed interactive REPL (`ccx`, the product
> north star) to the *look-and-feel* level of the original Claude Code TUI. This scorecard is the
> **source of truth for visual/interaction parity** — distinct from `coverage.md` (which scores SDK
> *capability* realization). Tracked feature-by-feature against the real Claude Code bundle at
> **`~/claude-code-bundle/2.1.220/`** (`cli.pretty.js` plus its `MAP.md`). The current headline is dated
> **2026-08-06 (post-Wave T)**; each recount block below carries its own date, and older ones are left as
> written rather than back-edited.
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

| Category | Parity (start) | Parity (pre-C5) | Parity (pre-F0, post–sprint-W3) | Parity (post-F2) | Parity (post-F3) | Parity (post-F4) | Parity (post-F5) | Parity (post-F6) | Parity (now, post-Wave T) |
|---|---|---|---|---|---|---|---|---|---|
| 1. Input / composer ergonomics | ~45% | ~88% | ~95% | ~86% (was ~78% post-F0; F2 landed the keymap — see §1a) | ~86% | ~86% | **~88%** (F5's composer: 3 rows rise, 1 falls, 5 new rows — see the F5 recount) | **~88%** (F6 t12 adds one row — the autocomplete row anatomy `DG55`, whose kind lane is flag-gated off exactly as upstream's is) | ~88% (untouched by Wave T) |
| 2. Transcript / message rendering | ~50% | ~74% | ~83% | ~57% | ~63% (F1 substrate rows scored at last, +5 new F3 rows) | **~70%** (F4's static transcript: 8 rows rise, 1 falls, 7 new rows — see the F4 recount) | ~70% (untouched by F5) | ~70% (untouched by F6) | ~70% (Wave T re-notes the sentinel-router row; no row changes state) |
| 3. Status / chrome (banner, spinner, status bar) | ~35% | ~72% | ~92% | ~36% | ~36% | ~36% (untouched by F4) | **~36%** (untouched by F5) | **~36%** (untouched by F6) | **~37%** (Wave T adds one new row at 🟡 — the API-retry indicator that replaces the spinner) |
| 4. Modals / overlays | ~60% | ~88% | ~88% (4 new W3 rows — see W3 recount note) | ~50% | ~50% | ~50% (untouched by F4) | **~50%** (untouched by F5) | **~72%** (F6's dialogs wave: 6 rows rise, 2 new rows, 1 leaves the denominator — see the F6 recount) | **~73%** (Wave T adds two new rows — the consult footer at 🟡, the bypass consent gate at ✅) |
| 5. Slash commands | ~55% | ~70% | ~86% (6 new W3 rows — see W3 recount note) | ~88% (F2: `/keybindings` 🟡→✅ — it opens the real file now) | ~88% | ~88% (untouched by F4) | **~88%** (untouched by F5) | ~88% (score unchanged by F6; `/help` and `/rewind` are re-noted) | ~88% (score unchanged by Wave T; `/yolo` is re-noted as consent-gated) |
| 6. Polish (glyphs, colors, affordances) | ~40% | ~74% | ~94% | ~61% | ~61% | ~61% (untouched by F4) | **~61%** (untouched by F5) | ~61% (untouched by F6) | ~61% (untouched by Wave T) |
| 7. Control plane (dialogs, ladder, background tasks) — §8 | ~0% | ~81% | ~80% (untouched in W3) | ~75% | ~72% (F3 deleted an over-shipped row) | ~72% (untouched by F4) | **~72%** (untouched by F5) | **~83%** (F6 rebuilt the plan dialog and the background panel — 2 rows rise) | ~83% (no row changes state; two ✅ rows that were scored ahead of their evidence are now earned — see the Wave T recount) |
| **Overall** | **~46%**<br>*(impact-weighted)* | **~83%**<br>*(impact-weighted)* | **~88%**<br>*(plain row count)* | ~65%<br>*(plain row count)* | ~65%<br>*(plain row count)* | ~66%<br>*(plain row count)* | **~67%**<br>*(plain row count)* | **~71%**<br>*(plain row count)* | **~71%**<br>*(plain row count)* |

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
The hint row is honestly 🟡, not ✅: three surfaces derive, two footers and one fold marker did not — §1a
names them.

**F3 recount (2026-08-04, the live-turn wave).** Two categories move. §2's movement is deliberately split
into two steps, because conflating them would credit F3 with work F1 did:

*Step A — F1 substrate rows scored at last (NOT F3's credit).* F1 shipped the unified live/replay
renderer and the single five-column `⎿` gutter, and its section explicitly left §2's table alone. Both
§2 rows still carried F0 notes that are now **factually false** about the shipped code, so they are
corrected and scored here rather than left wrong:

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score | what moved |
|---|---|---|---|---|---|---|
| 2. Transcript | 5 | 9 | 1 | 15 | 9.5/15 = 63.3% | "Tool-use rows" and "Tool result tree glyph" 🟡→✅ — the live/replay disagreement and the per-line connector the F0 notes describe were both fixed by F1 |

*Step B — F3's own movement.* Five new rows enter §2 for upstream features the file had no row for, and
§8 retires one:

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score | what moved |
|---|---|---|---|---|---|---|
| 2. Transcript | 6 | 13 | 1 | 20 | 12.5/20 = 62.5% | +5 new rows: Write create preview ✅; typed result rows, the Agent unit, Agent batches and the `ctrl+b` hint each 🟡 with their divergences named. The "Thinking blocks" row keeps 🟡 (the duration is now real; the two glyphs are not) |
| 7. Control plane (§8) | 4 | 5 | 0 | 9 | 6.5/9 = 72.2% | "Task lifecycle notices" ✅ **retired**: F3 deleted the transcript notices because upstream renders none, so the row leaves the denominator rather than scoring a ✅ for an over-ship |
| **Overall (unweighted avg of the 7 categories)** | | | | | **≈ 65.1% → ~65%** | (85.7 + 62.5 + 36.1 + 50.0 + 88.1 + 61.1 + 72.2) ÷ 7 |

**Read the headline honestly: F3 shipped a great deal and the overall number did not move** (64.7% →
65.1%). That is the measurement method working, not a wasted wave. Three effects cancel: F1's two
substrate rows lift §2 by +6.6 points; F3's five new rows *lower* §2 again to 62.5%, because four of them
enter at 🟡 and every one of them enlarges the denominator with a gap the file previously could not see;
and §7 gives back 2.8 points for a row we deleted on purpose. The wave's real output is that the live
turn now has rows at all — twelve upstream behaviours went from invisible to either built, deliberately
diverged, or **provably unreachable** (six of those, excluded from the denominator with probe or bundle
citations, in the F3 section below).

**F4 recount (2026-08-04, the static transcript wave).** One category moves. F4 is the first wave whose
work lands almost entirely inside a single section, so the split below is per-row rather than per-step.

*The scoring rule this recount applies, stated once so it is auditable.* **✅** = every upstream behaviour
the row names is built and pinned, and any remaining difference is a **recorded deliberate delta** — a
choice, listed in the F4 divergence table below. **🟡** = something upstream does is genuinely not built.
A row is not promoted for effort, and a recorded delta does not by itself demote one; that is the same rule
§1a's "Accepted behaviour deltas" and §5's `/session` row already ran under, written down here because F4
applies it seven times in one pass — every ✅ in the row table below is a row whose whole named gap list is
closed.

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score |
|---|---|---|---|---|---|
| 2. Transcript | 13 | 12 | 2 | 27 | 19/27 = 70.4% |
| **Overall (unweighted avg of the 7 categories)** | | | | | **≈ 66.2% → ~66%** — (85.7 + 70.4 + 36.1 + 50.0 + 88.1 + 61.1 + 72.2) ÷ 7 |

Row by row, so the +7.9 points in §2 are checkable rather than asserted:

| Row | Was | Now | Why |
|---|---|---|---|
| User prompt echo | 🟡 | ✅ | The F0 correction named `❯ ` (U+276F) in `subtle` on a `userMessageBackground` band; all three shipped, plus the 10 000-char fold |
| Assistant message identity | 🟡 | ✅ | Both named divergences closed: the bullet is per-platform `⏺`/`●`, in the plain `text` token, not an accent |
| Thinking blocks | 🟡 | ✅ | The two glyph divergences the F3 note left standing are closed — content hidden by default, `∴` gutter in detail, `✻` placeholder |
| Markdown: block grammar | 🟡 | ✅ | Every one of the eight gaps the F0 correction listed is built and pinned |
| Markdown: tables | 🟡 | ✅ | Box grid, per-column alignment, three-way fitting, a rule between every data-row pair, the 200-row cap and the vertical fallback — the whole F0 list |
| Edit/Write diff (header, bands, word diff, wrap) | 🟡 | ✅ | All five named gaps closed, and the 24-row cap upstream does not have is gone |
| Compact boundary marker | 🟡 | ✅ | The bulleted `Compact summary` with its expand affordance replaced our invented rule — `test/tui/species-system.test.ts:61` |
| Markdown: code-block syntax highlight | ✅ | 🟡 | **A downgrade, and the honest kind.** The old ✅ predates anyone counting: we highlight 10 languages, upstream ~383. See the divergence table |
| Diff line numbering ladder | — | ✅ | New row: sidecar-absolute → disk-anchored absolute → visibly approximate |
| Markdown: links, images, strikethrough + terminal gates | — | 🟡 | New row: OSC-8, the three image forms and the `dHn` gate ship; the link title suffix is coloured where upstream's is not |
| Syntax-highlighted diff bodies | — | ❌ | New row: upstream colours the code inside a diff band before falling back to the plain renderer; we render plain |
| User-frame sentinel router (`ERe`) | — | 🟡 | New row: 12 of 15 exits plus the fallthrough, three recorded unreachable — but one shipped route is unverified |
| Error sentinels (`VAr`) | — | 🟡 | New row: 11 cases + 2 default predicates, byte-verified; one runtime-proven, nine static-only, one wrap-over-clip deviation |
| System notices (`dVo`) | — | 🟡 | New row: the generic exit and its suppression rules ship; nine subtypes are unreachable and the route is unobserved live |
| Teammate attribution | — | 🟡 | New row: the nested detail branch and the collapsed `› N messages from @name` ship; the colour assignment is ours, not upstream's |

**Read this headline the way the last two were written: +1.1 points is the honest number for a wave that
closed the whole static transcript.** §2 rises 7.9 points on seven promoted rows, and seven new rows —
five of them 🟡 or ❌ — grow the denominator from 20 to 27 at the same time. One previously-✅ row is marked
down on a gap nobody had measured. Averaged across seven categories, six of which F4 never touched, that
lands at ~66%. The wave's real output is not the headline: it is that the markdown engine, the diff ladder,
the identity glyphs, thinking and the sentinel router all have rows with evidence pointers behind them for
the first time, and that the residual gaps are named and sized rather than invisible.

**F5 recount (2026-08-05, the composer wave).** One category moves, and it is §1 for the first time since F2.
The same scoring rule the F4 recount stated applies unchanged: ✅ means every upstream behaviour the row names
is built and pinned and any remaining difference is a **recorded deliberate delta**; 🟡 means something
upstream does is genuinely not built. Effort does not promote a row and a recorded delta does not demote one.

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score |
|---|---|---|---|---|---|
| 1. Input / composer | 27 | 4 | 2 | 33 | 29/33 = 87.9% |
| **Overall (unweighted avg of the 7 categories)** | | | | | **≈ 66.5% → ~67%** — (87.9 + 70.4 + 36.1 + 50.0 + 88.1 + 61.1 + 72.2) ÷ 7 |

Row by row, so the +2.2 points in §1 are checkable rather than asserted:

| Row | Was | Now | Why |
|---|---|---|---|
| Multiline editor (paste chips, `\`-continuation) | 🟡 | ✅ | The F0 correction named the chip; the whole `CM21`–`CM27` chain ships, including the two thresholds, atomic deletion, expand-on-repaste and the persisted cache |
| History up/down (draft stash/restore) | 🟡 | ✅ | `history.jsonl` survives a relaunch, dedups newest-wins across the whole scan, and caches per-index edits — the three things the F0 correction said we lacked |
| Placeholder / ghost text | 🟡 | ✅ | The one fixed string became `CM3`'s four-rule ladder over the git-seeded `Try "…"` pool, denylist and selector included |
| `@`-file mention fuzzy autocomplete | ✅ | 🟡 | **A downgrade, and the honest kind.** `CM35`, `CM39` and `CM40` all closed this wave — and closing them exposed lane-A's longest-common-prefix Tab, which is genuinely not built. The old ✅ predates anyone counting the census rows behind it |
| Composer visual form (`CM1`/`CM2`/`CM4`/`CM5`) | — | ✅ | New row: rules not a box, `❯`+NBSP dimming while a turn runs, the inverted placeholder cursor, and the `History n/total` label in the top rule |
| Readline tail (`CM12`) | — | 🟡 | New row: five of upstream's six composer keys ship; `ctrl+b` is dead behind our own `task:background` binding |
| Suggestion popup geometry (`CM30`) | — | 🟡 | New row: `DXe`'s clamp, padding, mid-anchored scroll, two-line rows and middle-elide all ship; `X4t`'s query-substring highlighting does not |
| Inline reverse-i-search (`CM58`) | — | ✅ | New row: upstream's own `ctrl+r` surface for a classic layout, Esc-accepts included |
| History picker preview pane (`CM59`) | — | ✅ | New row: the six-line `round` preview, the `… +N lines` tail and the ≥100-column side-by-side layout |

**Read the headline the way the last three were written: +0.9 points overall is the honest number for a wave
that closed most of the composer.** §1 rises 2.2 points on three promotions and three new ✅ rows, while one
✅ is marked down and two new 🟡 rows enlarge the denominator from 28 to 33 — a denominator that now has rows
for the popup's geometry, the readline tail, the composer's own frame and both search surfaces, none of which
this file could see a week ago. Six of the seven categories were never touched, so the average barely moves.
The wave's real output is not the headline: it is that every keystroke before Enter now has either a pin, a
recorded divergence with a bundle citation, or a named gap with an owner.

**F6 recount (2026-08-06, the dialogs wave).** Three categories move, and §4 moves further in one wave than
any section has since F0's correction — because §4 is what F6 was about. The scoring rule the F4 recount
stated applies unchanged: **✅** = every upstream behaviour the row names is built and pinned, and any
remaining difference is either a **recorded deliberate delta** or a **recorded unreachable** (the same
exclusion §1a's unreachable keys and the F3/F4/F5 tables already run under); **🟡** = something upstream does
is genuinely not built *and* is reachable, with the missing arm named on the row. Effort does not promote a
row and a recorded delta does not demote one.

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score |
|---|---|---|---|---|---|
| 1. Input / composer | 28 | 4 | 2 | 34 | 30/34 = 88.2% |
| 4. Modals / overlays | 10 | 6 | 2 | 18 | 13/18 = 72.2% |
| 7. Control plane (§8) | 6 | 3 | 0 | 9 | 7.5/9 = 83.3% |
| **Overall (unweighted avg of the 7 categories)** | | | | | **≈ 71.3% → ~71%** — (88.2 + 70.4 + 36.1 + 72.2 + 88.1 + 61.1 + 83.3) ÷ 7 |

Row by row, so the +22.2 points in §4 are checkable rather than asserted:

| Section | Row | Was | Now | Why |
|---|---|---|---|---|
| §4 | Permission approval dialog | 🟡 | ✅ | Every gap the F0 correction named is closed: upstream's **kind registry** replaces the one-shape-fits-all body (`permissionKind` = `Ksn` L279164, six arms), per-tool titles, question lines, real inline diffs, the 16-pattern destructive table, symlink warnings, and session/prefix/domain persist rows all ship — and `allow_always`'s in-memory `Set<toolName>` is replaced by the engine's own suggestion echoed back as `updatedPermissions`, which probe 81 proved survives a relaunch |
| §4 | Bash permission shows full command | 🟡 | ✅ | The 140-character clip is gone; `dZf`'s body renders the command verbatim with its dim description and the matching destructive warning above the question line |
| §4 | Task/todo panel | 🟡 | ✅ | All six named gaps closed — `DG56`'s header counts, `DG57`'s `✔`/`◼`/`◻` with strikethrough-dim and bold, `DG58`'s owner tag / blocker line / activity sub-line (each gated on the wire actually carrying its field, probe 81 Q3), and `DG59`'s `showExpandedTodos` round trip |
| §4 | `/help` overlay | 🟡 | ✅ | `DG62`: a real tabbed dialog (General / Commands / Custom commands) whose browser lists the **live** catalog, and `DG63`'s three-column shortcuts grid resolved from F2's binding table rather than a hard-coded list |
| §4 | `Select`/`Tabs` primitives (`ST7`) | ❌ | ✅ | Both built (`select/Select.tsx`, `select/MultiSelect.tsx`, `select/Tabs.tsx` + the pure `selectModel.ts`) and adopted by every list this wave touched — the nine hand-rolled lists are gone |
| §4 | Background-dialog detail sub-dialogs | ❌ | ✅ | `DG60`: Enter opens the per-type detail sub-view — `Shell details` with its last-lines output box, and the `<agentType> › <description>` view with Progress / Prompt / Error sections |
| §4 | Model picker | 🟡 | 🟡 | Four of six named gaps closed (header, subtitle, `s` session-only toggle, overflow counter + row window). **Missing arm:** the reasoning-effort axis (`DG48`) and the pricing/entitlement row metadata (`DG47`), both probe-gated (P88) F6 non-goals |
| §4 | Resume session picker | 🟡 | 🟡 | Four of six closed (search bar, `Space` preview, `Ctrl+R` rename, the `(N of M)` header). **Missing arm:** `Ctrl+A/B/W` scope toggles and the expandable fork-lineage groups — neither has an axis in our session store |
| §4 | Rewind picker anatomy (`DG38`–`DG40`, `DG42`, `DG44`) | — | 🟡 | **New row.** Per-row `+A -R` computed **before** selection, oldest-first with the trailing italic `(current)`, per-option explanation lines and the manual-edit warning all ship. **Missing arm:** `DG41`'s `Summarize from here` / `Summarize up to here` pair, an explicit F6 non-goal |
| §4 | Unbuilt permission registry kinds | — | ❌ | **New row, no prior row existed.** Four of upstream's nine `w8y` routes still fall through to the generic body — the workflow dialog (`DG16`), PowerShell (`DG17`), the browser/Claude-in-Chrome dialogs (`DG18`) — plus `DG4`'s `ctrl+e` LLM explain pane. All four are explicit F6 non-goals, and all four are reachable, so they enter the denominator as their own row rather than dragging the shipped registry row down |
| §4 | `EnterPlanMode` | ❌ | 🚫 | **Leaves the denominator on evidence, not on convenience.** Probe 81 Q2: `EnterPlanMode` executes headlessly (assistant `tool_use`, turn result `success`) and **never consults `canUseTool`** — zero consults — so there is no hook to hang `DG28`'s dialog on. Recorded beside `CM6`/`CM7`; the spec's Delivers line is superseded by a Revision Note |
| §7 | Plan-mode approval dialog (ExitPlanMode) | 🟡 | ✅ | Rebuilt from `Gnl`: the `Ready to code?` title, the modal layout, `sYf`'s three reachable option arms with the keep-planning **inline input**, `DG34`'s `ctrl+g` editor round trip and `✓ Plan saved!`, and the `Exit plan mode?` empty-plan branch. The F0 note's two remaining claims are both retired — the clear-context family is recorded unreachable (it needs host state and entitlements no client sees), and "keeps the dialog open on an empty submit" was **factually wrong about the bundle** and is corrected in the spec's Revision Notes |
| §7 | `/bg` panel | 🟡 | ✅ | Rebuilt as upstream's `Background` dialog (`rsi` L481110): counts subtitle, gated section headers, per-type badge rows and the detail sub-views. The row's one named divergence — the `/bg` name — is retired: `DG61`'s own prescription (`add /tasks and /bashes as aliases`) is exactly what shipped |
| §1 | Autocomplete row anatomy (`DG55`) | — | ✅ | **New row.** `S_a`'s kind lane, `ZLb`'s 123-name bucket table and the three row-level width sums ship — and, like upstream's, the lane is **flag-gated off by default** (`VJa` spreads it on `CLAUDE_CODE_ENABLE_MENU_KIND_LANES \|\| tengu_mint_lanes`, and the installed 2.1.220's `~/.claude.json` caches that gate `false`). The tag and source lanes are recorded unreachable — neither field exists on our `CommandEntry` |

**Read the headline the way the last four were written: +4.8 points overall is the honest number for the
wave that closed the dialogs.** §4 rises 22.2 points on six promotions, while two new rows — one 🟡, one ❌ —
enlarge its denominator from 17 to 18 and one row leaves it on probe evidence. §7 rises 11.1 points on two
promotions. Four of the seven categories were never touched. The wave's real output is not the headline: it
is that the permission family stopped being one improvised box and became upstream's registry, that "don't
ask again" stopped being a lie (an in-memory `Set` that never persisted) and became a rule the engine writes
and re-reads across a relaunch, and that every list in the app is now one primitive with one key contract —
which is what makes acceptance #6 a five-line helper rather than seven bespoke tests.

**Wave T recount (2026-08-06, the trust-&-safety wave).** Wave T is the first wave in this file that came
from the **QA fleet** rather than from the census: seventeen tasks answering findings a human hit while
using the binary (spec `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md`, `main`
`7af9e093dc..4a7a640d85`). Two categories move, both by **adding rows that did not exist**, and no
previously-counted row changes state. The scoring rule the F4 recount stated applies unchanged: ✅ means
every upstream behaviour the row names is built and pinned and any remaining difference is a **recorded
deliberate delta** or a **recorded unreachable**; 🟡 means something upstream does is genuinely not built
*and* is reachable, with the missing arm named on the row.

| Category | ✅ | 🟡 | ❌ | non-🚫 rows | Score |
|---|---|---|---|---|---|
| 3. Status / chrome | 3 | 8 | 8 | 19 | 7/19 = 36.8% |
| 4. Modals / overlays | 11 | 7 | 2 | 20 | 14.5/20 = 72.5% |
| **Overall (unweighted avg of the 7 categories)** | | | | | **≈ 71.5% → ~71%** — (88.2 + 70.4 + 36.8 + 72.5 + 88.1 + 61.1 + 83.3) ÷ 7 |

The three new rows, so the +0.7 in §3 and +0.3 in §4 are checkable rather than asserted:

| Section | Row | Now | Why |
|---|---|---|---|
| §3 | API-retry / stalled indicator (`qyn`, L407975–408035) | 🟡 | **New row, no prior row existed.** The row now *replaces* the spinner at ChatApp's single indicator mount exactly as `qyn` does, with upstream's two variants (`✻ Waiting for API response · check your network`; `✻ <label> · Retrying in <dur> · attempt n/max`), `ra`'s duration formatting, a per-second countdown seeded from the wire's `retry_delay_ms`, and a client-side stalled watchdog anchored to turn start for the ~75 s window a blackholed endpoint burns before the first frame exists (probe 96). **Missing arm:** `ypo()`'s dim `If it persists, check <status page>.` one-liner under the row for overload-ish errors — reachable from the frame's own `error_status` and not built. Two further reductions are **recorded unreachable, not counted**: the stalled row's ` · will retry in <dur>` clause (its deadline is the CLI subprocess's own abort timeout, on no wire frame) and the rate-limit `<Type> reached` label branch (no rate-limit metadata on the frame) |
| §4 | Consult footer (`escape / cancel · tab amend · ctrl+e explain`, L505286) | 🟡 | **New row, no prior row existed** — the F6 ✅ on the permission-dialog row never named the footer, and five of the six bodies were shipping a bare `esc cancel`. The shared footer now mounts in all five footered bodies with `aZf`'s gating (the amend hint disappears the moment the focused row is already in input mode) and the explain verb flipping `explain`↔`hide`. **Missing arm:** in the shipped binary the `ctrl+e explain` hint **never renders** — the Bash body declares the transport prop optional and undefaulted and nothing in `src/` passes it, so a user sees two hints where upstream's Bash consult shows three. `FetchPermission` staying footerless is **not** the gap: upstream mounts a bare `jr` there too (W-T18) |
| §4 | Bypass-permissions consent gate (`SAm`, L554034–79) | ✅ | **New row, no prior row existed** — ccx entered the one mode that stops asking with no warning at all. Upstream's frame in the `error` colour, the verbatim title and three body paragraphs, the docs link, **cancel rendered first and focused**, accept persisting the acceptance so it never asks again, decline exiting **1** and Escape exiting **0**, gated on the resolved launch mode so both flag spellings are one check — and covering `ccx --detachable`, which renders the same REPL. Recorded deltas: the acceptance persists to ccx prefs rather than `~/.claude/settings.json` (the same precedent `history.jsonl` and the default model follow), and bare `y`/`n` are inert here where upstream's `Confirmation` scope binds `n` |

**Read the headline the way the last five were written: the overall number does not move, and that is the
honest result.** Wave T shipped seventeen reviewed tasks and its own live probe, but almost all of that
work landed *inside* rows this file had already scored ✅ — the permission dialogs, the plan dialog, the
status-bar mode truth. A ✅ row cannot rise. What the wave actually bought is recorded two ways instead:
the three new rows above, which enlarge the denominator with gaps the file could not see a day ago, and
the **notes on four standing rows that were scored ahead of their evidence** and are only now earned —
§4's permission-approval row (which was ✅ while an empty amend silently denied), §7's plan-approval row
(✅ while approving granted `acceptEdits` whatever the label said), §7's status-bar-mode-truth row (✅
while the launch banner and the turn-0 chip disagreed with the engine) and §5's `/yolo` (✅ while it
walked into bypass unasked). Those corrections are stated on the rows rather than folded into the
arithmetic, because re-scoring them down and back up in one pass would move a number without informing
anyone.

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
| Refused-mode-change notice (`✗ <mode> refused by the engine (…) — staying in <mode>`) | **Wave T (t16)** — when the engine rejects a runtime `setPermissionMode`, the REPL prints the refusal and leaves the chip on the mode the engine is actually in, instead of swallowing the rejection and painting the requested mode anyway | Upstream's TUI owns the permission mode in-process and flips it itself, so it has **no refusal to render** and no copy for one — all three bundle strings about mode refusal belong to other surfaces. The row is harness-authored by necessity, which is exactly what puts it here rather than in §3. Probe 99 is the evidence that the refusal is real (`auto` off its supported set, and `bypassPermissions` at runtime, are both refused) |
| `/yolo`'s consent gate, and the `--bg`-into-bypass refusal's `/yolo` sibling | **Wave T (t15)** — the runtime route into bypass shows the same `SAm` consent the launch path does, and honours the persisted acceptance thereafter | Upstream's gate is launch-only (L554501-04) because upstream's Shift+Tab ladder **cannot reach bypass at all** (`settingsRows.ts:23-27` transcribes that exclusion). `/yolo` is a ccx-specific door, so gating it is closing our own hole rather than cloning theirs. The dialog it opens is a parity row (§4); only the extra door is the addition. (`ccx --bg` into bypass being refused is **not** listed here — that one is transcribed from upstream's own `--bg` validator at L451420-21) |

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
| Bold count in the folded row | **CLOSED by F3 (Tasks 1–2).** The diagnosis stood: Ink drops `bold` when `dimColor` rides the same `<Text>`, and chalk rewrites embedded SGR. The fix was the raw-SGR line writer this row called for — a `preStyled` segment renders through a **bare** `<Text>`, so `sgrFoldRow.composeFoldRun` emits the clause run's bytes itself (`\x1b[2mReading \x1b[1m3\x1b[22m files…\x1b[22m`) and the count is genuinely bold inside the dim run. Ink re-emits a *normalized* stream, so frame assertions pin the rendered attributes, never byte-identity (`sgr-passthrough.test.tsx`, `sgr-foldrow.test.ts`, `toolRenderer.test.tsx -t "genuinely BOLD count"`) | closed |
| `" file…"` plain in the golden | **REVERSED by F3 (Task 2), deliberately.** F1 read this as a bug it would be dishonest to copy; F3's Decision Log settled the opposite way — it is upstream's *emitted artifact*, produced by the same one-`<Text dimColor>`-with-a-nested-`<Text bold>` markup the count needs, and reproducing the markup faithfully reproduces the tail for free. The writer never re-opens dim after a count, so the tail (ellipsis included, since it rides the run) is plain, exactly as the golden's cells are | closed |
| Settled group row colour | **Resolved 2026-08-03.** A dedicated settled-state probe against installed 2.1.220, run under the tracked capture environment (pinned `TERM=xterm-256color`/`COLORTERM=truecolor`, wrapper and palette vars removed), paints the settled row `#999999` — the same grey as the active row. The `#949494` first recorded in the live-confirmation note was that earlier probe environment's ambient-palette variant (`COLORFGBG` present), not a second upstream colour. The settled clause run now carries the `inactive` token; see the render contract § 0 pin | closed |
| Nested (`parent_tool_use_id`) replay rows | **CLOSED by F3 (Task 7).** They come back as the Agent unit's own nested rows — last three plus a hidden-count marker in compact, the full list under ctrl+o — attributed to their parent rather than flattened into unrelated rows (§2 row `LT16`/`LT17`) | closed |
| String-content user rows render nothing | **CLOSED by F4 (Task 10a).** String-form `message.content` is normalized in both `renderMessage` and `projectMessageEntry` (upstream `cke` L373253). The scope was measured rather than guessed: 5.8% of user rows across a 60-file sample, and 77 replayed disk prompts in that sample previously rendered nothing and now show | closed |
| Fullscreen-only clauses, grouped Agent batches, typed result summaries, elapsed `· Ns` | **Split by F3.** Grouped Agent batches (`LT3`) and typed result summaries (`LT1`) are **built** — both are new §2 rows. The `ds()`-gated fullscreen-only clauses and the elapsed `· Ns` suffix are **unreachable**, not deferred: see the F3 "Unreachable" table below | partly closed, partly 🚫 |
| Markdown/diff closure | **CLOSED by F4.** The markdown engine is a `marked` token walker transcribing `f2`; the diff is the `diffSource` → `diffRender` ladder. See the F4 section below | closed |

---

## F3 (2026-08-04) — the live turn

F1 built the substrate (one retained document, one projection); F2 built the keymap; **F3 is what the
transcript says while a turn is actually running.** Nine tasks shipped the fold row's real bold count, a
thinking clock that survives its own turn, typed result rows for every recognized tool, the Write create
preview, the subagent (Agent) unit with an honest totals ladder, same-message Agent batches, and the
`ctrl+b` background hint — plus wire-true interrupt classification. The scored rows all live in §2 above
and in the recount under the headline; this section carries the detail, the evidence, and — the part
that matters most on a cloning scorecard — **what upstream does that we deliberately did not build, and
why**.

The wave's governing discipline was live-probe-first, and it earned its keep twice. P84/P85 turned three
planned features into recorded impossibilities before a line was written (below). And the batch key
shipped in Task 8 keyed on the wrong field: `callSequence` looked right against the bundle and would
**never have fired on the real wire**, because the engine emits one frame per content block. The keyed
live run caught it (`test/live/f3-live-turn.e2e.test.ts`, `split=true` observed) — declared ≠ reachable,
again.

### Now faithful

| Row | What shipped | Evidence |
|---|---|---|
| Real bold count in the fold row (`LT2`) | A `preStyled` segment renders through a bare `<Text>`, so `sgrFoldRow.composeFoldRun` writes the clause run's SGR itself: dim run, a genuine `\x1b[1m…\x1b[22m` count, no dim re-open after it (upstream's own tail artifact), and the settled run additionally wrapped in the `inactive` grey. Closes F1's one recorded regression | `test/tui/sgr-passthrough.test.tsx` (5), `test/tui/sgr-foldrow.test.ts` (10), `test/tui/toolRenderer.test.tsx -t "genuinely BOLD count"` |
| Thinking clock (`LT4`, reachable half) | Thinking time measured from local `content_block_start`/`stop` arrival stamps, keyed `(msgId, blockIdx)`, thinking-ness **latched at start** (a `content_block_stop` carries no block type — P82); the duration outlives the `LiveTurn` that produced it in a `useChat`-owned map and merges at every repaint and at turn end; a held thought attaches to the open-or-next run. The REPL now enables `includePartialMessages` for **interactive** sessions at the `SessionHost` seam, so both front doors (foreground REPL and `--detachable`/`attach`) get partials while headless is untouched | `test/tui/liveTurn.test.ts`, `test/tui/useChat.test.tsx`, `test/tui/foldPendingState.test.ts`, `test/live/f3-live-turn.e2e.test.ts` (a) |
| Pending-region latch + hint debounce (`LT4`) | Upstream's exact four ref-held counters ratchet per anchor, a 700 ms first-immediate debounce on the `⎿` hint, and a 3 s linger on the thinking summary; the published row **peeks** the latched maximum so an on-screen row never downgrades at settle, while a fresh replay recomputes honestly | `test/tui/foldPendingState.test.ts` |
| Typed result rows (`LT1`) | 19 templates, sidecar-first with honest fallbacks; suppressed and interrupted/rejected route ahead of them; the per-call `⏺ Read(path)` header is the ctrl+o form and never carries file content | `test/tui/toolSummaries.test.ts`, `test/tui/toolResult.test.ts`, `test/tui/toolRenderer.test.tsx` |
| Write create preview (`LT18`) | First 10 lines highlighted, bare `… +N lines` marker, preview alone | `test/tui/toolSummaries.test.ts` § "the Write create preview" |
| Agent unit + honest totals (`LT16`/`LT17`) | `Initializing…` → last-3 rows + `… +N tool uses (ctrl+o to expand)` → a `⎿` gutter `Done (…)` row with a sidecar → notification → derived ladder. **Derived totals omit the token clause rather than fabricate one**, and an unrecognized terminal shape gets no `Done` row at all (upstream returns null there too) | `test/tui/agentProgress.test.ts`, `test/tui/toolRenderer.test.tsx` § "F3 Task 7" |
| Same-message Agent batches (`LT3`) | `Running N agents…` / `N agents finished`, keyed on the API `message.id`, published only when every member has a result, absorbed members render nothing, verbose never groups | `test/tui/toolRenderer.test.tsx` § "F3 Task 8", `test/live/f3-live-turn.e2e.test.ts` (c) |
| `ctrl+b` background hint (`LT20`) | `task_started`-gated, `local_bash`-only, keymap-derived, tmux-doubled only when the resolved chord is still `ctrl+b`, and short-circuited on `run_in_background: true` | `test/tui/toolRenderer.test.tsx` § "F3 Task 9", `test/tui/keys-hints.test.ts` |
| Interrupt classification (`LT14`) | Classified off the **retained sidecar string** `"User rejected tool use"` rather than off screen text; the bracketed sentinel user frame renders nothing **and** breaks fold runs | `test/tui/toolRenderer.test.tsx` § "F3 Task 9 — the interrupt sentinel user frame" |
| Acceptance #1 composite | Three consecutive reads → one `Read 3 files` row, bold count inside the dim run, and **no elapsed anywhere** — on the group row, the active row, or the ctrl+o per-call rows | `test/tui/f3-acceptance.test.tsx` (4) |

### Unreachable — recorded, not built

Upstream behaviours this wave proved we cannot reproduce honestly. They are **🚫, excluded from the
denominator**, exactly like the unreachable keys in §1a: building a substitute would be fabrication, not
fidelity. Each cites the probe or bundle read that settled it.

| Upstream behaviour | Why it is unreachable | Evidence |
|---|---|---|
| `LT19` — live last-5-lines box and `(elapsed · timeout)` progress under a running Bash | The wire is **silent** for a foreground Bash's whole runtime: between `tool_use` and `tool_result` there is only a `system/task_started` arriving ~5 s late and a `task_notification` at completion. No stdout, no `tool_progress`. There is nothing to render | probe `84-bash-stdout-background.ts`; report `research/2026-07-31-tui-clone/12-p84-p85-bash-hooks-wire.md` |
| Bash progress suffix (`R4.11`) | Same silence, same conclusion — and its anchor is `ds()`-gated besides | P84; bundle `R4.6`/`R4.11` |
| `LT21` — `Ran N PreToolUse hooks (Xms)` rows | Both hook species execute **invisibly**: no `hook_started`/`hook_progress`/`hook_response`/`tool_use_summary` frames reach the client stream | probe `85-hook-timing-classifier.ts` |
| `LT22` — `Allowed/Denied by auto mode classifier` annotations | No classifier verdict is annotated anywhere. Across five permission paths there is no `system/permission_denied`; a genuine denial leaves only prose in the model-facing `tool_result` and a **reason-less** `result.permission_denials` entry | probe `85-hook-timing-classifier.ts` |
| `LT5` — the ` · 12s` elapsed suffix on a collapsed group | Upstream computes its anchor only inside `if (s && ds())` (bundle L427963–427974), i.e. **fullscreen/brief mode only**. The tracked default view (`ds() === false`, R2.1) shows none. Now pinned by an executable guard, not just prose | bundle read 2026-08-04; `test/tui/f3-acceptance.test.tsx` |
| `CH23` — the 77-entry agent-clause conjugation table | `s8p` has exactly one call site (L428041), and the default finalizer `ke_` (L302123) never sets `agentCount`/`agentDescriptions` — so the table is **dead code** in the default view | bundle read 2026-08-04 |

### Deliberate divergences from upstream

Each of these is a place where we know what 2.1.220 does and chose something else. Recorded here so the
choice is auditable rather than invisible; each is one line of the 🟡 on its §2 row.

| Divergence | Upstream | Ours, and why |
|---|---|---|
| Derived Agent totals omit the token clause | `Done (N tool uses · X tokens · Ts)` | When neither the sidecar nor a `task_notification` supplies a token count, we derive tool uses and duration from the children and **drop the token clause** rather than invent a number. Fabricating a total to match a shape would be the exact dishonesty the P83 rule exists to prevent |
| `Backgrounded agent` → `Done` upgrade | The launch row stays a launch row | A `task_notification` that arrives **before** publication upgrades the row to the real `Done (…)`. More honest than leaving a stale "backgrounded" claim on a finished agent |
| Agent detail row ordering | prompt → nested rows → content → `Done` | Ours is `Done` first, then the nested rows. A cosmetic ordering divergence in the ctrl+o view only; the compact view matches |
| The `ctrl+b` hint under a running **sync** Agent | Upstream shows the same 2-second-timer hint under a synchronous Agent (bundle 281153), skipping it only when async | Ours is Bash-only. Whether the Agent unit should grow it is a decision for that surface's owner, not something to bolt on mid-wave |
| Thinking-summary linger with no clear | Upstream's 3 s linger is only observable **after** the producer clears the summary | Ours hands the summary back 3 s after its last change even while the producer keeps supplying it — the only self-consistent reading of a ratchet that is never cleared |
| Grep/Glob expand hint | Present in both projections | **Compact-only.** Upstream's verbose branch genuinely has no `Bg` component, so showing it there would be ours, not theirs |
| `TaskStop` 160-char clip | Clipped on **display width** (`Ut`) | Clipped on code units. Differs only for wide/combining characters in a stop reason |
| Bash timeout source | Read from the progress message | Read from the call input — the progress message does not exist on our wire (P84, above) |
| Running fold run in transcript (ctrl+o) mode | A running branch shows a reduced row set | Ours shows all rows and no hidden-count marker in the detail projection |
| Short-terminal Agent fallback | An `In-progress` fallback row when the terminal is too short | Not implemented |
| `hideType` teammate-name suppression in batches | Suppresses the agent type when the member's name is a teammate name | Not modelled — we have no teammate-name concept |
| Write `condensed`/scratchpad/plan variants, Edit `previewHint`/`collapsed` | Distinct row forms | Skipped: each needs client state we do not model. Named on the `LT1` row rather than approximated |
| TMUX detection for the hint's doubled chord | Gated on `TERM_PROGRAM` | Ours is broader (any `TMUX` evidence). Arguably more correct; recorded because it is still a difference |

### Open evidence gaps (honest closure candidates, not claims)

- **Multi-open-call interrupt frame shape is UNOBSERVED.** P80 § A dumped a single-Bash interrupt only, so
  what the wire looks like when several calls are open at once is unknown. Task 9 deliberately did **not**
  widen the classifier on speculation. A micro-probe that interrupts two concurrent calls would settle it.
- **Eight tools' sidecar shapes were bundle-read, not live-observed.** They fail closed to the flat
  fallback, so the failure mode is a plainer row, never a wrong one — but a probe that actually selects
  those eight would convert a reading into evidence.
- **The pyte golden re-baseline is still owed** (F2 residue). It now also covers the fold row's new raw-SGR
  bytes and every new F3 row, so `scripts/capture-frames.py` goldens under
  `test/fixtures/upstream-frames/` are further behind the shipped renderer than they were at F2. The
  binding-check contract still passes; the whole-frame diff remains a diagnostic, not a gate.

---

## F4 (2026-08-04) — the static transcript

F1 built the substrate, F2 the keymap, F3 what the transcript says while a turn runs. **F4 is what the
transcript says once the turn is over** — the part a reader spends most of their time looking at. Eleven
tasks replaced the line-oriented markdown renderer with a `marked` token walker transcribing the bundle's
own node switch, built box tables, ported links/images/strikethrough and their terminal-capability gates,
rebuilt the Edit/Write diff as a source ladder plus a banded renderer, corrected the assistant and prompt
identity glyphs, hid thinking by default and gave it upstream's `∴` detail form, and — the largest single
piece of previously-invisible behaviour — built the **user-frame sentinel router**, the switch that decides
whether a `user` frame on the wire is a prompt at all.

Two disciplines shaped the wave and both earned their keep. **The bundle outranks the constants pack, which
outranks the census**, and that order was exercised four times: `JhH`'s marker depth is the child's depth
(the census and the plan pin were both one level off), nested table rows keep their closing pipe, tables are
exempt from ambient dim, and eight subagent colour tokens live in six theme blocks rather than the four the
pack captured. Each correction was written back into the pack with a dated self-correction block rather than
silently absorbed. **And a shipped route is not a proven one**: the MCP resource/polling exit is built to a
verbatim bundle form and has never been observed, so it is recorded below and excluded from the score.

### Now faithful

| Row | What shipped | Evidence |
|---|---|---|
| Markdown block grammar | A `marked` token walker over `f2`'s node switch (L420590–420711) with `Oaa`'s three-way chunking, a real LRU(500) lexer cache and upstream's byte-identical fast-path regex. Nested lists, `start`-honouring ordered lists with `JhH` depth numbering, literal task-list boxes, the dim `▎ ` quote rail, `hr`, depth-varying headings, and blank-line structure that falls out of the walk | `test/tui/markdown.test.ts`, `test/tui/markdown-integration.test.tsx` |
| Links, images, strikethrough | OSC-8 hyperlinks behind the `mI`/`hgs` env gate with the `text (url)` fallback, `mailto:`/`file://`/label-equals-url collapses, the three image forms, and `dHn`'s strikethrough allowlist verbatim — force-override ahead of the exclusions, the ordering trap included | `test/tui/markdown-links-code.test.ts` |
| Box tables | `IBp` (L420907) transcribed: grid, force-centred header, three-way fitting, a rule between every data-row pair, the 200-row cap, and `kaa`'s vertical fallback on both triggers. Widths measured with `string-width`, which *is* `Ut` (`ambiguousIsNarrow` by default since v5) | `test/tui/mdTable.test.ts`, `test/tui/f4-acceptance.test.tsx` § #2 |
| The diff source ladder | Recognized sidecar (absolute, disk never read) → local diff anchored on a unique disk match (absolute) → visibly approximate. Memoized on the retained call input with sidecar-identity revalidation, so an in-place sidecar upgrade is not frozen out by the memo | `test/tui/diffSource.test.ts` |
| The diff renderer | `fbn`'s header, `H2p`'s full-width bands and number gutter, `chH`'s remove-run rewind, `shH`'s run pairing and `lhH`'s word diff with the `0.4` bail. No cap of any kind | `test/tui/diffRender.test.ts`, `test/tui/f4-acceptance.test.tsx` § #3 |
| Prompt + assistant identity | One `userEchoLines` for all four echo surfaces — `❯ ` on a full-width band, the 10 000-char fold with its titled rule — and the per-platform `⏺`/`●` bullet in the plain `text` token | `test/tui/identity.test.tsx`, `test/tui/f4-acceptance.test.tsx` § #1, § #5 |
| Thinking | Hidden by default (`Gha`'s guard), `∴` dim+italic gutter with a dim markdown body in detail, `✻ Thinking…` placeholder including for `redacted_thinking` | `test/tui/thinking.test.tsx`, `test/tui/f4-acceptance.test.tsx` § #4 |
| The sentinel router | `ERe`'s 12 reachable exits plus the fallthrough, tag constants verbatim, regexes shared with `sessions/rows.ts`, and string-form `content` normalized on both paths | `test/tui/species.test.ts`, `test/tui/species-system.test.ts` |
| Error sentinels, system notices, compact boundary | `VAr`'s eleven cases + two default predicates + truncation; the generic notice exit with its wrap and suppression rules; the bulleted `Compact summary` | `test/tui/species-system.test.ts` |
| Teammate attribution | Nested detail branch, per-agent colour, `› N messages from @name` at detail-collapsed, lifecycle rows for named subagents | `test/tui/teammate.test.tsx` |
| Expand-hint honesty | Nine sites that typed `(ctrl+o to expand)` as a literal now read the **live** keymap table, `keybindings.json` overrides included, with the hint in the projection cache key; an unbound `app:toggleTranscript` produces no clause at all | `test/tui/toolRenderer.test.tsx`, `test/tui/keys-hints.test.ts` |
| Acceptance composites | The wave's five spec criteria as executable pins, each mutation-proven | `test/tui/f4-acceptance.test.tsx` (13) |

### Unreachable — recorded, not built

🚫, excluded from the denominator, on the same rule as §1a's unreachable keys and the F3 table above.

| Upstream behaviour | Why it is unreachable | Evidence |
|---|---|---|
| `ERe` exit 2 — `planContent` | Not a text sentinel at all: a PROP on the UI-layer message object (`DAe.planContent` L429357) the CLI sets when a queued prompt carries a plan-file reference. SDK messages have no such field; a text-only router cannot reach it by construction | bundle L426428 → `p4t` L425978 |
| `ERe` exit 3 — the agent-teams teammate transcript | Double-gated: `mc()` (L224777) needs BOTH the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var AND the `tengu_amber_flint` statsig gate, and `kvr` needs a `<teammate-message …>` tag only the CLI's teammate transport writes. Our teammates ride their own bus | bundle L426436 → `cqo` L425393 |
| `ERe` exit 4 — `<channel source="` / cross-session inbox | The same feature's channel transport. Nothing on our wire writes the tag; the SDK has no channel transport at all | bundle L426444 → `HWp` L426253 |
| Four `errorSentinelLines` arms — the usage-limit nudge, the login box, the entitlement clause, the resolved model name | Each needs CLI-internal state (`Dcs`/`l8o`, `case lir`/`<aca/>`, `J2e("warning")`, `nm(wT())`) that no SDK frame carries | bundle read 2026-08-04 |
| Nine `dVo` system-notice branches | Their subtypes are absent from `sdk.d.ts`'s system union, and the structured frames fall out of the generic exit by construction | `sdk.d.ts` + bundle read |
| `XWo` shape A (`summarizeMetadata`) and the transcript-mode compact-summary body | P81 read the live `compact_boundary` frame key by key; neither field is on it | probe 81 |

### Deliberate divergences from upstream

Every place F4 knows what 2.1.220 does and shipped something else, with the reason. Each is one line of the
🟡 on its §2 row, or — where the row is ✅ — the recorded delta that kept it ✅ under the rule stated in the
F4 recount.

| Divergence | Upstream | Ours, and why |
|---|---|---|
| The `~` approximate line-number marker | No approximate mode exists — every diff upstream paints came off a file it had just read | When the source ladder cannot prove where a snippet sits, the gutter is prefixed `~`. There is no glyph to copy, and painting bare 1-based numbers would read exactly like absolute ones — the confidently-wrong failure the ladder exists to prevent. **Being visibly approximate beats being confidently wrong** |
| Wrap over clip on error sentinels | `height: 1` **clips** five `VAr` arms in every view | We wrap. At 80 columns only the credit-balance arm actually diverges — and there upstream's clip deletes its own billing URL, so copying it would hide the one piece of information the message exists to deliver |
| The `✻ Thinking…` collapsed placeholder | Shows nothing in that position | Kept as a recorded invention. Upstream's live region has no thinking-text accumulator at all (deltas feed a token counter, L374721–374730), so there is nothing to port; the placeholder is a better stand-in than F1's `✦ Thinking`, and it reuses upstream's own `e8o` component rather than inventing a shape |
| Live echoes and notice rows bake at ingest | Re-flows on resize | A local entry's lines are minted at the width of the moment and projected verbatim, so an already-echoed prompt (and an already-rendered system notice) keeps its original band across a terminal resize. Retained SDK frames are unaffected — they re-project. Fixing it needs render *recipes* in `TranscriptDocument`, a substrate change, not a renderer change |
| `hr` closes its line | Emits `---` with NO trailing newline, gluing the next block onto the same physical line (`---below`) | We close the line. A deliberate non-reproduction of an upstream artifact |
| Deep-nest first-item indent | A ragged first-item indent at deep nesting levels | Smoothed uniform. The same call as the `hr` line — an artifact we chose not to copy |
| Fenced-code highlighting coverage | hljs's whole registry — ~383 language names and aliases | **~373 of them render PLAIN here.** `KNOWN_LANGS` is 10 (ts/js/py/sh/json and friends); the label-polarity rule is faithful, so ` ```rust ` correctly draws no label, but nothing colours its body. **The largest remaining fenced-code gap**, and the one most likely to be visible to a reader |
| Syntax-highlighted diff bodies | `lre` → `R2p` colours the code inside a band before falling back to `H2p` | We render diff bodies plain — bounded by the same 10-language highlighter |
| `syntaxHighlightingDisabled` label mode | With highlighting globally off, EVERY tagged fence draws its label (`s?.supportsLanguage` short-circuits to undefined) | Unbuilt: we ship no such setting, so the mode is unreachable here rather than missing |
| The `⧉` artifact glyph | Appended to canonical `claude.ai/code/(artifact\|frame)/<uuid>` links | Not ported. Bundle-verified (`AIg` L100700 / `x8r`): the arm fires only on hrefs this harness never mints. A fixture carrying a real UUID slug pins the absence honestly. **A harness that ever starts minting those links must revisit this** |
| The `Found N files` expand hint on the compact path | `$Wo`'s non-verbose branch appends `Bg` (L421528) | **Shipped and unreachable.** One bounded bundle check settled it this wave: `PMd`'s flush (`a()`, L302172–302178) pushes a `collapsed_read_search` whenever the accumulator holds any message — **no minimum-size gate, no error escape** (`erroredToolUseIds` only filters memory ops, L302144), and `VFt` makes Grep/Glob unconditionally collapsible. A `collapsed_read_search` renders only through `Ima` (L429332). So a Grep's own `Found N files` row cannot appear in the default view, and the hint riding it cannot either — while the verbose branch that *does* show the row has no hint. Our form is faithful; it is **not counted as observed parity** |
| Prose coalescing | `Jbn` walks a prose-only list, so adjacent assistant prose merges reliably | Our "adjacent" test breaks on subagent tool traffic, which makes the coalescer **near-inert on real transcripts**. A design question for the next wave, recorded rather than papered over |
| Batch-member lifecycle rows | — | A member of an Agent batch gets no lifecycle row at detail-collapsed, non-verbose |
| Teammate colour assignment | The colour rides the teammate message via the agent definition or a user override, defaulting to cyan | Ours is assigned by dispatch order and re-derived deterministically per call. Chosen over a hash (which collides 1-in-8 on parallel pairs). Consequences recorded: the attach path's fallback may disagree, and a rewind shifts later agents' indices |
| Named-subagent gate on lifecycle rows | Renders `general-purpose` in default cyan | Ours are gated on NAMED subagents — a reachability choice of ours, not a port |
| `PlanDialog` width | Reads the terminal | Fixed at 80 columns. Untouched by F4's width plumbing; recorded so the next dialog wave owns it |
| Link title suffix | Uncoloured | Ours is coloured |
| `dHn`'s second term | `dHn() && vt.level > 0` — chalk's colour level | Only `dHn` is ported. Colour level does not exist at our style-as-data layer; Ink decides colour at paint time |
| `/compact` completion notice | `✻` + upstream's own wording | Ours reads `✦ compacted N → M` (`commands.ts:78`) — the last surviving `✦` in the tree (t9 review Minor 4). A local invention predating F4; owed a fix, recorded here so it cannot hide |

### Open evidence gaps (honest closure candidates, not claims)

- **The MCP resource/polling route is implemented but UNVERIFIED.** All five `<mcp-resource-update>` /
  `<mcp-polling-update>` tag sites in 2.1.220 are readers (L426198–426202, L426420, L426513); the artifact
  contains no writer, so the injection is produced outside this bundle. The form is pinned verbatim by the
  constants pack, but nothing has ever been observed. A live MCP-subscription probe would settle it. Until
  then it does not count toward parity.
- **The system-notice route has not been observed live** — a keyed run provoking an informational frame
  would convert a bundle read into evidence.
- **Nine of the eleven error-sentinel arms are static-only.** Only `Prompt is too long` is runtime-proven
  (P80); the rest rest on the same-channel producer chain (`hey()` → `_u()`), which is a sound reading, not
  a measurement.
- **Interrupted / rejected teammate lifecycle arms are reasoned, not observed.** A live probe would settle
  them the way P80 settled the interrupt sentinel.
- **Router exits 7, 10, 12 and 15 (`<bash-stdout>`, `<bash-input>`, `<user-memory-input>`,
  `<fork-boilerplate>`) are reasoned, not observed** (t10a review): the real CLI's writers exist and our
  reader passes its rows through unmodified, but no such row appeared in the 60-file sample.
- **The diff band × `⎿`-gutter geometry has been computed, never seen** (t7 handoff): every constant traces
  to a bundle line, but no rendered frame of a real Edit has been inspected. The wave-close keyed e2e owes
  exactly that frame — and the pyte golden set predates F4 entirely, so a re-baseline is owed with it.
- **`toolRenderer.tsx` is 799 lines** and the `agentUnit.tsx` extraction seam noted in F3 is still owed.

---

## F5 (2026-08-05) — the composer

F4 finished what the transcript says. **F5 is everything that happens before Enter** — the bordered row a
reader looks at for the whole session, and the twelve tasks behind it: the paste-chip chain, the persisted
prompt log, the queue drain, the placeholder generator, the trigger and accept contracts, one popup, the
async `@`-walk, and both history-search surfaces. It closes most of census §D (`CM1`–`CM65`).

Three disciplines carried over from F4 and each earned its keep again. **The bundle outranks the plan**, and
this wave it overruled the plan or the brief *eight* times: paste chipping is rows-dependent (`kmt` counts
newlines, and the threshold reads the live terminal height); the `100 000`-character cap gates the paste
EXPAND and not just its hint; the paste cache is written at SUBMIT inside the history append, never at chip
creation; there is **no `mode` column** in the history file (the `!` prefix is the mode); there is **no live
garbage collection** of text paste entries; motions step OVER a chip rather than treating it as a wall; the
`Dee` debounce is trailing-only so even the first walk waits; and the inline search has **no scope cycling**
at all. **A shipped route is not a proven one** — the `?2004` bracketed-paste handoff and the external-editor
stdin handoff are both still owed a real-TTY look, and they are listed as gaps rather than counted. And
**where a spec sentence and the bundle disagree, the sentence is corrected** — acceptance #1's "40 lines" and
acceptance #3's "typing `/mod` shows ghost text" are both recorded splits, argued in
`test/tui/f5-acceptance.test.tsx`'s header and in the spec's Revision Notes.

### Now faithful

| Row | What shipped | Evidence |
|---|---|---|
| The composer's visual form | `CM1`'s two full-width `─` rules with no verticals or corners (`borderLeft/Right:!1`, L496235), `CM2`'s `❯`+NBSP / `!`+NBSP glyph dimmed while a turn runs, `CM5`'s inverted-first-character placeholder cursor, `CM4`'s `History n/total` spliced into the top rule through `$Bu`'s three-lead-dash arithmetic (clamp included), and `CM8`'s italic dim `Save and close editor to continue...` in place of the input row while `$EDITOR` holds the terminal | `test/tui/composer-frame.test.tsx`, `test/tui/f5-acceptance.test.tsx` § #5 |
| Paste chips, end to end | `CM21`'s two thresholds (`>800` chars **or** `> max(0, min(rows-10, 2))` newlines — the row count is live), `CM27`'s ANSI/CRLF/tab normalisation in `k0`'s own order, `CM22`'s atomic `deleteTokenBefore` and the cursor snap-out, chip-transparent motions, `CM24`'s paste-again-to-expand behind `bDo`'s 100 k cap, `CM25`'s `Pasting…`, `CM26`'s 0600 content-hash cache, and `fSe`'s submit-time expansion | `test/tui/paste-chips.test.ts`, `test/tui/paste-expand.test.tsx`, `test/tui/f5-acceptance.test.tsx` § #1 |
| Persisted prompt history | `CM52`'s `history.jsonl` in upstream's own line shape (`{display, timestamp, project, sessionId, pastedContents}`, the `nu_` 1024-char inline/hash split, the `CLAUDE_CODE_SKIP_PROMPT_HISTORY` gate over the whole append), `CM53`'s whole-scan newest-wins dedup, `CM54`'s per-index edit cache carrying the full `{display, pastedContents, mode}` triple, `CM55`'s bash latch and display filter, `CM56`'s once-per-process `ctrl+r` hint after the second Up, and `CM57`'s chip restore with `ou_`'s literal for a body that is gone | `test/tui/history-nav.test.tsx`, `test/tui/f5-acceptance.test.tsx` § #2 |
| The editing tail | `CM12`'s `ctrl+f`/`ctrl+h`/`ctrl+n`/`ctrl+p` and `alt+d`; `CM17`'s undo ring at upstream's cap 50 with a 1000 ms coalesce window and `pastedContents` inside every entry; `CM18`'s cursor-relative backslash-Enter setting `hasUsedBackslashReturn`; `CM20`'s `Z_a` newline-hint ladder; `CM14` pinned (our buffer's lines *are* logical lines) | `test/tui/editor-readline.test.ts`, `test/tui/editor.test.ts` |
| Queue semantics | `CM51`'s typed entry (`{value, mode, priority, pastedContents, origin}`) with `P5`'s editable predicate, `CM48`'s Up/`ctrl+p` drain — queued entries first, the draft last, non-editable entries left in place, ids re-minted twice so no two chips collide — and `CM47`'s `Press up to edit queued messages` rung | `test/tui/queue-composer.test.tsx` |
| The placeholder generator | `CM3`'s four-rule precedence ladder over `MVf`'s eight `Try "…"` templates, `wNb`'s nine-regex denylist verbatim, `INb`'s ramp-and-cap file selector with per-directory caps and all-or-nothing return, and `xNb`'s git harvest with its unscoped re-run | `test/tui/queue-composer.test.tsx` |
| Trigger and accept contracts | `CM34`'s whitespace-or-CJK-preceded slash trigger plus the six-name denylist and the separate head case, `CM35`'s `@` character class and quoted paths, `CM28`'s Tab-accepts / Enter-accepts-and-executes split with upstream's argument-hint exception, `CM29`'s wrapping selection, and `CM38`'s `No commands match "…"` | `test/tui/autocomplete-triggers.test.ts`, `test/tui/f5-acceptance.test.tsx` § #3 |
| One popup, upstream's geometry | `DXe`'s clamped height `max(1, min(max(6, ⌊rows/2⌋), rows-3))` with blank padding to a fixed height, the mid-anchored scroll window, `a0H`'s two-line rows, the 40 %-capped name column, `suggestion`-coloured selection over dim rows, `bLt`'s middle-elide keeping the basename, and `Ptl` as the exclusive below-composer slot predicate | `test/tui/suggest-popup.test.tsx` |
| Ghost text and the inline hint | `CM36`'s mid-text ghost — `zJa`'s shortest-prefix pick, the inverted first grapheme, Tab accepting through `Pe`'s ghost arm, and the render gate that draws it only with the caret at the end of the buffer — and `CM37`'s `argumentHint` after a completed `/command ` | `test/tui/suggest-popup.test.tsx`, `test/tui/f5-acceptance.test.tsx` § #3 |
| The async `@`-walk | `CM39`'s trailing-only 50 ms debounce with a generation guard that discards a slow walk a newer one has overtaken, and `CM40`'s iterative descent — a directory splices with a trailing slash and NO space, which leaves the trigger live and re-roots the walk one level deeper | `test/tui/file-complete-async.test.tsx`, `test/tui/f5-acceptance.test.tsx` § #4 |
| Both search surfaces | `CM58`'s inline reverse-i-search — `search prompts:` / `no matching prompt:`, the last-occurrence substring walk, the per-walk display dedup, the parked draft restored on an emptied query or a cancel, Esc-accepts — and `CM59`'s preview pane (`round`, dim border, six content lines, `… +N lines`, side-by-side at ≥100 columns) | `test/tui/inline-history-search.test.tsx`, `test/tui/historySearchOverlay.test.tsx` |
| Acceptance composites | The wave's five spec criteria as executable pins, each driven through the real `<ChatComposer>` and each mutation-proven | `test/tui/f5-acceptance.test.tsx` (5) |

### Unreachable / not built — recorded, not counted

🚫 where excluded from the denominator (same rule as §1a's unreachable keys and the F3/F4 tables); the
unbuilt-but-reachable entries are named here **and** carried as the 🟡 on their §1 row.

| Upstream behaviour | Why | Status |
|---|---|---|
| `CM6` — the cursor stops being drawn inverted when the terminal loses focus | Focus reporting (DECSET 1004) is not read anywhere in this harness and the spec records it unreachable | 🚫 |
| `CM7` — the fullscreen `maxVisibleLines` viewport with cursor-centred scroll | Belongs to the fullscreen (`ds()`) mode this clone does not model; recorded unreachable in the spec | 🚫 |
| `CM19` — `shift+enter` as a distinct newline | Our editor **does** insert a newline on the `ESC CR` form, so a terminal already configured by upstream's `/terminal-setup` (or one speaking CSI-u) works. We ship no installer, and plain `shift+enter` is byte-identical to Enter — see §1a's unreachable-keys table | 🟡 on K40 |
| `CM33` — mouse hover/click on popup rows | Explicit F5 non-goal; needs terminal mouse-mode ownership (the same gap as K22) | 🚫 |
| `CM41` — the other completion sources (emoji, Slack `#channel`, `@teammate`, MCP resources/templates, bash path completion, `/resume <title>`, per-command `getArgumentCompletions`) | Explicit F5 non-goal; most have no ccx surface behind them | 🚫 |
| `CM42`–`CM45` — image chips, `ctrl+v` clipboard reads, drag-and-drop, the OSC-8 chip link | Explicit F5 non-goal, gated on P87 (the SDK image-block surface). The `ctrl+v` row stays ❌-pending-P87 in §1, as F0 reclassified it | 🚫 / ❌ |
| `CM50` — the per-item queue-edit cursor (`queueEditIndex`, `popEditableAt(i)`) | Behind upstream's own `CLAUDE_CODE_KB_COHESION_FIXES` flag, i.e. not default behaviour there either. Not built | not built |
| `CM60` — vim mode | Owner-deferred since C5; unchanged | 🚫 |
| `CM61` — live highlight spans in the buffer | Explicit F5 non-goal. Its popup-side cousin `X4t` (highlighting the query substring inside a suggestion row) **is** in scope and is not built — it is the 🟡 on the popup row and has a ticket | 🚫 / 🟡 |
| Lane-A's longest-common-prefix Tab (L490925–L490934) | Upstream's mention lane completes to the longest shared prefix when Tab cannot disambiguate. Genuinely not built — a real affordance gap, and the reason the `@`-mention row is marked down | not built |
| The paste-cache eviction sweep (`OUd`, L317354 / L439899) | Upstream retires cached paste bodies on a retention schedule. We write them and never sweep, so a long-lived fleet root grows without bound | not built |

### Deliberate divergences from upstream

Every place F5 knows what 2.1.220 does and shipped something else, with the reason.

| Divergence | Upstream | Ours, and why |
|---|---|---|
| Where the prompt log lives | `~/.claude/history.jsonl` | `history.jsonl` and `paste-cache/` at the **ccx fleet root** (`CCX_FLEET_ROOT`), by the `prefs.ts` precedent. Same format, our root — so a test run isolates cleanly and we never write into a real Claude Code user's prompt log |
| The append is a bare `appendFileSync`, not a lock | Batches pending entries and takes a `proper-lockfile` lock around a coalesced async flush (`lu_`) | One `O_APPEND` write of a few hundred bytes per prompt, which is atomic on every filesystem we target. Upstream's batching exists to amortise an async lock we do not take. The residual: two ccx processes interleaving at >4 KiB lines could in principle tear one, and a prompt line is nowhere near that |
| History is read whole | `DBn` pages BACKWARDS in 4 KiB chunks so a huge log is never resident | Read the file, reverse, cap. At 100 entries of recall the file is tens of KiB; the paging machinery would be larger than the file |
| No `cu_` write suppressor | Skips the append when the previous entry matches display + project + session and neither carries pastes | We write the duplicate line; `readHistory`'s dedup hides it from every reader, so the only cost is file growth |
| Undo coalescing shape | A **deferred debounce** — a sub-window change reschedules a `setTimeout`, and undo cancels the pending timer | A **coalescing snapshot-on-change**: a push inside the 1000 ms window is skipped instead of deferred. Both directions are recorded at the reducer, because they differ at one edge — after a burst, upstream's pending timer can still land one entry we never take |
| No live GC of text paste entries | — | Bundle-verified as ours to keep: upstream's `useEffect` sweep (L495715–L495728) collects **image/audio** entries only, and the text map survives to submit (L536788–L536792). An earlier draft GC'd text chips and caused silent payload loss at every park site (history recall, kill ring, stash) |
| Smart spacing after a chip | — | **Dropped with bundle evidence.** The census read `CM22` as including a smart-space rule; the bundle applies it to image chips only. Not shipped, recorded rather than silently omitted |
| `id 0` asymmetry | — | `chipSpans` filters id 0 out (`KF`'s own `.filter(n => n.id > 0)`) while the delete-token regex accepts it, so a hand-typed `[Pasted text #0]` is deletable as a token but is never a chip. Upstream's own shape; recorded because the two regexes look like they should agree |
| Dead map entries ride to submit | Same | An entry whose label was deleted out of the buffer stays in the map until the buffer is replaced. Upstream-literal, cited at the site |
| The `?2004` handoff | — | We **disable** bracketed-paste mode before handing the terminal to a child (external editor, suspend) and re-enable it after: a mode-unaware child that receives `\x1b[200~` prints it. Upstream leaves it on. Deliberate; the enable/paste path itself is now TTY-verified (wave close: a `tmux paste-buffer -p` chip round trip) |
| Torn `\x1b[200~` carry holds ≥2-byte prefixes only | Upstream reads the whole marker atomically off its own parser | final-fix: a chunk ending in a 1-byte tear (a lone trailing `\x1b`) is NOT held — holding it would make the Escape key wait for the next keystroke (this input path has no escape timeout by design). 2–5-byte tears are carried; the 1-byte case is pinned as the accepted residual |
| The `Z_a` newline hint sits in the composer footer | Rendered as a row inside the `?` help overlay | Kept in the footer, where our own hint ladder already lives and where the editor's literal used to be. Cost: the verbose rung is 37 characters, so the footer wraps to a second line below ~100 columns |
| Hint rows STACK below the composer | `Ptl` (L494604) makes the slot **exclusive** — one of the suggestion popup, the footer ladder, the bash/memory hint rows or the help ladder, never two | Our `!popupDrawn` transcribes `Ptl` for the two footer rows only; the bash/memory hint rows still stack alongside. Owned by the chrome wave (CH2/F7), recorded here |
| `ctrl+b` is ours | `ctrl+b` moves the cursor left in the composer (`CM12`) | `ctrl+b` is `task:background` in the `Global` context, so the editor's `moveLeft` branch exists and is unreachable. A standing pre-F5 divergence (K10), now with a shipped-but-shadowed handler behind it |
| `ctrl+r` routes to the INLINE search | Ships both surfaces and picks by layout: inline when `yie()` is false, the full-screen picker when true (L489752 / L496209) | Our REPL is permanently classic layout, so `ctrl+r` is upstream's own inline choice. The picker keeps a door of its own: **`/history`**, a recorded ccx addition (upstream needs no such command because fullscreen hands it the picker) |
| `CM56`'s hint is rendered in the composer | Routed through upstream's **notification queue**, which owns placement and lifetime | Ours draws it as a composer row. Closing it belongs to F7, which owns the queue; the once-only guard is also **process-lifetime** here (a durable ref survives a dialog remount) rather than notification-scoped |
| Prompts submitted before F5 are invisible to search | — | Both search surfaces read `history.jsonl`, which only started being written by F5 task 6. Older prompts exist in the session transcripts and in neither surface. In exchange both now carry the `!` bash prefix and the `pastedContents` a transcript row never had — and `scope:"session"` matches only entries written after the session's first state event, since earlier ones carry no session id |
| The inline corpus is deduped and capped | `kBs` streams the raw log, unfiltered and unbounded | Both surfaces read one reader (`readHistory` = `UUd`), which dedups by display and caps at 100 distinct entries — so `ctrl+r` cannot reach past the 100th distinct prompt |
| `ctrl+s` is inert in the inline search | Registers exactly four `historySearch:*` actions; `cycleScope` belongs to the picker alone | Same: no scope cycling inline. A first draft built it and was **strictly reverted** on the bundle read; a test now pins the inertness, so the key resolves and drops rather than being accidentally revived |
| Forward `Delete` inside the inline search | — | Treated as a backspace on the query. Our one key fallback feeds the query field, and a forward-delete has no meaning in a single-line reverse-i-search |
| `Escape` dismisses the `CM38` empty message | `Lt` is false while the message is on screen, so Escape falls through | Ours widens `completionActive` to cover it, so one Escape dismisses every completion surface alike. Deliberate, argued at the declaration |
| `queuedCommandUpHintCount` is incremented | **Never** — `grep` over the whole bundle finds the default and the read, no writer, so its own `< 3` gate can never close | We increment it, which makes the `Press up to edit queued messages` rung retire after three sessions as the code plainly intends. A recorded invention, not a port |
| The `Try "…"` pick is process-scoped | Same (`Vr` is a lodash memo-once-per-process) | Same scope, different mechanism: a frozen random *sequence* on the app ref, so the ladder still re-evaluates every render while the sentence stays stable across keystrokes |
| `submitCount` counts queued-while-busy prompts | Gates its equivalent on `!busy` | Cosmetic; affects only how quickly the first-three-sessions rung retires |
| Queue `origin` is a bare string | An object (`{kind: …}`) | Nothing on our side reads more than the discriminant |

### Open evidence gaps (honest closure candidates, not claims)

- ~~Three real-TTY checks owed~~ **All three MADE at wave close (2026-08-05, tmux against the built binary)
  — and one found a product-bricking defect.** The frame at 100 real columns renders the two rules, `❯`+NBSP
  and the `Try "…"` placeholder exactly; a `tmux paste-buffer -p` paste minted `[Pasted text #1 +3 lines]`
  end to end (which also proves the `?2004h` enable — tmux only sends the markers when the app asked for
  the mode); one backspace ate the chip atomically. The external-editor round trip DEADLOCKED the whole app:
  vi restores the shared tty open-file-description to blocking mode at exit, a still-armed libuv tty watcher
  then issues a blocking `read()` that freezes the loop before SIGCHLD is processed (main thread sampled in
  `uv__stream_io → read`; the child stays a zombie; the awaited handoff is unsalvageable because the read
  fires before any of our JS). Fixed in `f5(tty-fix)`: the editor is back on upstream's `spawnSync` shape
  (paint-then-block — the in-flight row provably paints first, held through the frozen loop), and a new
  `restoreTtyNonblock` (a `spawnSync`'d perl `fcntl` on the inherited fd 0) repairs `O_NONBLOCK` after every
  tty handoff, editor and Ctrl-Z/`fg` alike — a repair upstream does not have and tolerates by riding each
  blocking read on the next keypress. Three vi round trips + typing-after + Ctrl-Z/`fg` verified live.
- **The real-filesystem 50 ms `@`-walk path is unexercised.** Every `CM39`/`CM40` test injects `readdir`; the
  debounce constant is pinned as the composer's default, but no test has watched a real directory tree land.
- **Upstream's `Wci` exclusive-slot chooser has never been compared visually.** We transcribe `Ptl` for two
  rows and stack the rest; whether a real 2.1.220 frame ever shows two hint rows at once is unverified, and
  a pyte capture would settle it.
- **`ChatComposer.tsx` is 861 lines.** The named next split is `renderBuffer` / `suggestProps` / `seedHistory`
  (~90 pure lines). `editor.ts` came down to 533 after the `completions.ts` extraction and is fine.
- **Nothing enforces the negative-assertion / random-`Try`-pool collision rule.** A frame assertion of the
  form "does not contain X" can collide with a randomly drawn placeholder sentence; one such collision was
  found and fixed in t8 by choosing a token no template can produce. Future tests are on their honour.

---

## F6 (2026-08-06) — dialogs, pickers, panels

F5 finished the composer. **F6 is everything that interrupts it** — the census's largest cluster (§F, 69
entries `DG1`–`DG69`) and the one probe 78 unlocked. Fourteen tasks: the `Select`/`Tabs` substrate, the
permission wire, six permission bodies behind upstream's own kind registry, the inline/suppressed dialog
model, the `Ready to code?` plan dialog, the rewind picker, both pickers, the todo panel, the `Background`
dialog and `/help`'s tabbed dialog. Of the 40 census ids the spec's F6 Delivers named, **35 ship whole, 3 ship partial and 2 do not ship at
all** — and the five exceptions are named here rather than folded into a round number. `DG28` does not ship:
probe 81 proved it unreachable. `DG44` does not ship: our `rewind()` returns `void`, so the count its sentence
is about does not exist. `DG30` ships partial (three option arms of upstream's six; the other three need host
state and entitlements no client sees), `DG24` ships partial (the deny half only — the SDK's allow arm has no
message field), and `DG55` ships **default-off**, which is what parity with the installed build means. `DG31`
ships whole but in a **corrected** form. All five carry a spec Revision Note.

Four disciplines carried over and each earned its keep. **The bundle outranks the plan**, and this wave it
overruled a brief or the plan in ten of the fourteen tasks — the biggest being T5's, which overturned the
spec's own framing: upstream does *not* keep the composer beside a dialog, it **hides** it and protects a
mid-typing draft by **suppressing the dialog instead**. **A census reading is not a bundle reading**: two
census sentences were traced to their source and found to sit on arms the headless path cannot reach —
`DG31`'s "empty submit keeps the dialog open" (it denies, exactly as Esc does) and `DG2`'s unconditional
prefix row (both middle rows are gated on the engine having sent suggestions at all). **Declared ≠
reachable**, which is why probe 81 ran before the wave rather than after it, and settled three premises the
acceptance depends on. And **honesty beats byte fidelity**: three upstream literals were deliberately
trimmed or dropped because shipping them verbatim would have advertised a channel that does not exist here
(the plan dialog's `…with this feedback`, `/help`'s `/feedback` line, upstream's `/powerup` line).

### Now faithful

| Row | What shipped | Evidence |
|---|---|---|
| One list primitive, everywhere | `ST7`'s `Select` — absolute 1-based indexes padded to the count's width, the `↑`/`↓` gutter overflow arrows, `type:"input"` rows, the height-clamped edge-anchored scroll window (`nz_` L396851), digit selection, wrap at both ends — plus `MultiSelect` (`V3` L397431, `[✔]`/`[ ]`, the bold `Submit`/`Next` row at `marginLeft:3`) and `Tabs` (`Jx` L434983). Nine hand-rolled lists retired | `test/tui/select.test.tsx`, `select-model.test.ts`, `multiselect.test.tsx`, `tabs.test.tsx` |
| The permission kind registry | `DG1`: `permissionKind` transcribes `Ksn` (L279164) including the two hard-coded routes — the six-tool file family (`qrn` L228385, Glob/Grep/Read included) and **Bash-as-`sed -i`** re-routed to the file dialog with a simulated diff (`c1t` L227825 transcribed as an argv walk in `sedEdit.ts`). Six arms land on a real body; the pre-F6 generic reconstruction is deleted | `test/tui/permission-kind.test.ts`, `components.test.tsx` |
| The Bash body | `DG2`'s `Bash command` title, the verbatim command with its dim description, `zTe`'s `Do you want to proceed?`; `DG3`'s 16-pattern destructive table eval-compared row for row against `lLu`/`cLu` (L154066) including the 10 000-character scan slice and first-match-wins; `DG5`'s editable prefix row with the curly apostrophe and its `npm run *` seed | `test/tui/bash-permission.test.tsx`, `destructive.test.ts`, `bash-options.test.ts` |
| The file body | `DG6`'s four titles + relative-path subtitle, `DG7`'s **real inline diff** through F4's own renderer (create/overwrite/notebook variants included), `DG8`'s bold-basename question, `DG9`'s four session-scope wordings by in-dir × read/write with the `(shift+tab)` chord **resolved live from the keymap**, `DG10`'s `.claude/`-self-edit row, `DG12`'s symlink warning | `test/tui/file-permission.test.tsx`, `file-options.test.ts` |
| The four small bodies | `DG13`'s `Fetch` (the one footerless dialog — upstream mounts a bare `jr`), `DG14`'s `Use skill "x"?` with its **coexisting** exact and `prefix:*` rows (`Ptm`/`Otm` are independent gates), `DG15`'s Monitor poll/WebSocket arms, `DG19`'s generic `Tool use` with the `(MCP)` marker and the 3-line description clip | `test/tui/small-permissions.test.tsx`, `small-dialog-options.test.ts` |
| A real "don't ask again" | The engine's own `suggestions` echoed back as `updatedPermissions` with `destination` set to `localSettings` — never a rule grammar of ours — carried verbatim across all five serialization boundaries, and constructed from `iHr`'s own shape (L371709) only where the engine sent nothing. **Probe 81 Q1 proved the persistence half live**: the rule lands in `.claude/settings.local.json` in upstream's grammar and a fresh `query()` over the same cwd consults zero times. **Probe 82 Q1 then settled the half that was still open** — do headless *Bash* consults carry suggestions at all? They do, and richer than Read's: `git init` arrives as `addRules` with `ruleContent:"git init *"` and **`destination:"localSettings"` already set by the engine** (Read's arrived as `session`), which is exactly the prefix grammar T6's seed derives; a compound `mkdir -p sub && touch sub/a.txt` arrives as one `addRules` carrying **two per-subcommand rules**; and `rm -f sub/a.txt` arrives as **three** suggestions (exact-command `addRules` + `addDirectories` + `setMode acceptEdits`), so `Wdi`'s mixed-arm summary wording is reachable for Bash after all. `decisionReason: "This command requires approval"` arrived on the first consult only | `test/unit/permission-wire.test.ts`, `f6-acceptance.test.tsx` § #2, probes 81 + 82 (`probes/probes/82-f6-close-live-checks.ts`) |
| Upstream's three dialog states | `DG27` as corrected: **none** → **suppressed** (`Xrl()` L499196 renders nothing while the composer's activity flag holds, behind a dim `Waiting for permission…` row, L496241) → **visible** (`KVf`'s gate L549494 unmounts the prompt input entirely). The activity flag is `value.trim().length > 0`, cleared by a trailing 1500 ms debounce (`fs` L547654) and cancelled outright on an emptied buffer | `test/tui/inline-dialog.test.tsx` (12), `f6-acceptance.test.tsx` § #3 |
| The plan dialog | `DG29`'s two-sibling modal anatomy (`Gnl` L500755) — scroll region, `Ed` titled `Ready to code?`, `Here is Claude's plan:`, the markdown body, the consent reason, then a separate top-bordered box holding the prompt and the option list; `DG31`'s keep-planning **inline input** (whose label never prints — `showLabel` is false without `inlineDescriptions`); `DG34`'s `ctrl+g` editor round trip with `✓ Plan saved!`; and `DZe`'s `Exit plan mode?` empty-plan branch | `test/tui/planDialog.test.tsx`, `f6-acceptance.test.tsx` § #4 |
| The rewind picker | `DG38`'s `Rewind` frame and the `/rewind` aliases `checkpoint`/`undo` (L353066), `DG39`'s second row line computed **before selection** through a windowed sequential dry-run walk, `DG40`'s trailing italic `(current)` with the cursor opening on it in transcript order, `DG42`'s per-option explanations and the manual-edit warning | `test/tui/rewind-picker.test.tsx`, `f6-acceptance.test.tsx` § #5 |
| Both pickers | `DG46`'s `Select model` header in `remember` with the default-for-new-sessions subtitle and the session-only line, `DG49`'s `s` toggle with the default persisted and **read back at boot**, `DG50`'s `… +N models` overflow counter over a 10-row window (unclamped exactly like `rva`), and `DG51`'s `Resume session (N of M)` header, search field, `Space` preview and `Ctrl+R` rename | `test/tui/model-picker.test.tsx`, `session-picker.test.tsx` |
| The panels | `DG56`'s todo header counts with the in-progress clause gated on non-zero, `DG57`'s `✔`/`◼`/`◻` with strikethrough-dim / bold / plain and **no empty state**, `DG58`'s owner tag / blocker line / activity sub-line each gated on the wire carrying its field, `DG59`'s `showExpandedTodos` round trip, and `DG60`'s whole `Background` dialog with its counts subtitle, gated section headers, badge rows and detail sub-views | `test/tui/task-panel.test.tsx`, `bg-dialog.test.tsx` |
| `/help` and the grid | `DG62`'s tabbed dialog over the **live** command catalog, and `DG63`'s three-column grid of sentences resolved from F2's binding table — the same `ShortcutsGrid` the `?` overlay draws, so a rebind moves both | `test/tui/help-dialog.test.tsx`, `shortcuts-grid.test.tsx`, `honesty.test.tsx` |
| Acceptance composites | The wave's six spec criteria as executable pins — criteria 1, 3 and 4 driven through the real `<ChatApp>` over the wire, criterion 6 as one shared helper over seven Select-driven surfaces | `test/tui/f6-acceptance.test.tsx` (42) |

### Unreachable / not built — recorded, not counted

🚫 where excluded from the denominator (same rule as §1a's unreachable keys and the F3/F4/F5 tables); the
unbuilt-but-reachable entries are named here **and** carried as the 🟡 or ❌ on their §4/§7 row.

| Upstream behaviour | Why | Status |
|---|---|---|
| `DG28` — the `Enter plan mode?` dialog | **Probe 81 Q2**: `EnterPlanMode` executes headlessly and never consults `canUseTool` — zero consults, so there is no hook to hang a dialog on. The spec's Delivers line is superseded by a Revision Note | 🚫 |
| `DG22` / `DG23` — `suppressAlwaysAllowRule` and the org `ask` cap that hide the persistent row | Declared in `sdk.d.ts`, absent from the wire by measurement (probe 78). Every upstream "don't ask again" row is gated on `showAlwaysAllow`, whose managed-policy, org-cap and per-tool-suppression terms are all unreachable; what we ship is the half of each gate that is real data | 🚫 |
| `Ed`'s `srPrefix` — the screen-reader `Permission Required:` | Ink exposes no accessibility surface, and rendering it as a text node would put a phantom line in every permission frame. Record beside `DG22`/`DG23` | 🚫 |
| `mDr`'s typed consent-reason variants (`classifier`, `rule`, `hook`, `workingDir`, `subcommandResults`) and their dim `configString` hint lines | The SDK forwards `decisionReason` as a bare string (probe 78 A1). Only the `safetyCheck`/`other` arm — which returns the reason verbatim — is reachable, and it is what ships | 🚫 |
| Allow-side feedback (`and tell Claude what to do next`) — half of `DG24` | `sdk.d.ts`'s allow arm is `{updatedInput?, updatedPermissions?, toolUseID?, decisionClassification?}` — **there is no `message` field**. The deny arm's `message` is the only channel back to the model, so the deny half of `DG24` ships and the allow half cannot. No side channel was invented | 🚫 |
| `Bash command (unsandboxed)`, `F8o`'s command expansion, the async prefix refinement, `n6b`'s redirection-stripping normaliser | The title variant is gated on `Oo.isSandboxingEnabled()` and this harness never sandboxes; `F8o` and `n6b` need a tree-sitter bash parse (`I2e` L360019) we do not carry | 🚫 |
| `Kur()`'s managed-policy gate on both middle Bash rows, and the `Yes, and switch to auto mode` row (`DG25`) | A managed-policy surface and a claude.ai entitlement respectively; neither exists here | 🚫 |
| `BZf`'s read-and-apply Edit diff (three lines of surrounding context) | Ours is F4's rung 2 — a diff of the two snippets — with the ladder's honesty intact (absolute numbers when the snippet anchors on disk exactly once, a visible `~` prefix otherwise). Reusing F4's renderer keeps exactly one diff implementation | not built |
| The IDE arms (`Opened changes in <IDE> ⧉`, `Save file to continue…`) and the three remote-workspace Write titles | claude.ai / editor-coupled | 🚫 |
| `DG30`'s clear-context / Ultraplan / bypass / auto-mode plan options | Clear-context needs a live context-usage percentage and a host-state flag no client sees; Ultraplan is a remote-session entitlement whose arm ends in a **deny** plus an app-state hand-off, not a tool answer; bypass and auto sit behind a `gI()` entitlement probe | 🚫 |
| `DG29`'s `a4` scroll container for the plan region | Stock Ink 5 has no scrollable box. We clip at the same computed height and print `… +N more lines (ctrl+u/ctrl+d scroll)`; the keys are an **invented binding**, recorded below | 🚫 + substitute |
| `DG32` (clear-context re-seed), `DG33` (artifact pre-step), `DG41` (the summarize pair) | `DG32` follows `DG30`'s unreachable options; `DG33` is claude.ai-coupled; `DG41` is an explicit F6 non-goal and is the 🟡 on the rewind row | 🚫 / not built |
| `DG44`'s `Restored the code, but skipped N files: …` | `rewind()` returns `Promise<void>` and `RewindDryRun` carries no `skippedLinks`, so the count that sentence is about does not exist on our wire. The three *reachable* failure arms ship | 🚫 |
| `DG40`'s leading `/resume <id> (previous session)` row | It exists only when a caller passes `parentSessionId` + `onResumePreviousSession` — a forked-session lineage `RewindOps` has no concept of. Faking it would put a row on screen that cannot resume anything | 🚫 |
| Upstream's `A1()` checkpointing flag, its non-checkpointing list prompt, and its `ds()` split-view row halving | No equivalent state on our wire or in this clone | 🚫 |
| `DG45`'s `Chat about this` row | Picking it calls `onRespondToClaude`, a **third** wire channel; our dialog has two callbacks, so routing it would fabricate an answer or report a refusal the user never made. Omitted rather than dead-rowed | 🚫 |
| `DG47` pricing/entitlement row metadata · `DG48` the reasoning-effort axis | **`DG48`'s reachability is SETTLED, not probe-gated** (citation corrected 2026-08-06): `supportsEffort` (`sdk.d.ts:1244`) and `supportedEffortLevels` (`:1248`) are declared on the rows `supportedModels()` returns, so the axis has real data behind it and is **unbuilt, not unreachable** — the row stays 🟡 pending the build, and the old "probe-gated (P88)" note misdescribed it. `DG47`'s pricing/entitlement metadata is the part still unverified. `modelPicker:decreaseEffort`/`increaseEffort` stay deliberately **undeclared** in `VALID_ACTIONS` until the handlers exist — a name that validates and resolves but reaches no handler is the dishonest rebind F2 exists to end | not built |
| `DG51`'s `Ctrl+A/B/W` scope toggles and expandable fork-lineage groups; the row's size/message-count clause; the full-transcript preview | **Corrected 2026-08-06 — the earlier "the wire has none of it" reason was wrong about the SDK.** Three of the four fields DO exist: `listSessions()` takes `includeWorktrees` (`sdk.d.ts:979`) and each row carries `gitBranch` (`:4355`) and `fileSize` (`:4343`), so the worktree and branch axes and the size clause are **reachable and simply not built**. Only two things are genuinely absent: fork lineage (no parent-session field anywhere on the row, which is what upstream's expandable groups are grouping by) and a message count. The preview is a fixed 12-line tail by choice. The row stays 🟡 with the reachable remainder as its named arm | not built (3) / 🚫 (2) |
| `DG55`'s `tag` and `source` lanes | `tag` is set only for `type:"prompt"` + `kind:"workflow"`, a flag we do not carry; `source` maps command **provenance** (`projectSettings` → `project`, `plugin` → `org`) while our `CommandEntry.source` answers local-vs-catalog, a different question. Both stay named zeros in the width sums | 🚫 |
| `DG58`'s `ownerActive` gate · the shell detail's ` (exit code: N)` and the `of <bytes>` half of `Showing N lines` · the once-a-second `Runtime:` tick | `ownerActive` needs a teammate registry; the exit code is absent from `task_notification` (probe 74); we tail the output file rather than measuring it; the runtime recomputes on render | 🚫 |
| `DG62`'s Custom-commands tab content | The SDK's `SlashCommand` is `{name, description, argumentHint, aliases}` — no `type`, no `source`, no `isHidden` — so upstream's builtin-vs-user split cannot be evaluated at all and the tab always shows its empty state. `splitCommands()` is the single place to change if the shape ever gains a field | 🚫 |
| `RNa`'s two-state dismiss footer (`Press <key> again to exit`) | That armed state is `ctrl+c`'s double-press, and `ctrl+c` is nulled in the `Help` context as it is under every ccx dialog. Only the cancel arm can ever render | 🚫 |
| Three `DG63` grid entries — `ctrl + v to paste images`, `/btw for side question`, `alt + o to toggle fast mode` | The features do not exist here | not built |
| `DG35`–`DG37` (DiffDialog + the vestigial sidebar) · `DG4` (`ctrl+e` explain) · `DG16` (workflow) · `DG17` (PowerShell) · `DG18` (browser) · `DG53` · `DG64` | Explicit F6 non-goals. `DG37` is vestigial **upstream** — no handler is registered anywhere in the bundle. The other five permission-side ones are the ❌ on §4's new "unbuilt registry kinds" row | not built |
| Mouse hover / click on option rows; image paste and attachment rows inside `type:"input"` rows | No mouse substrate and no image surface (the same P87 gate `CM42`–`CM45` sit behind). This also makes `lYf`'s `hasImages` clause permanently false, which is *why* an empty plan submit can only reach the deny arm | 🚫 |
| `Select`'s `expanded` and `compact-vertical` render branches; `wrap:"wrap-trim"`; upstream's `disabled → blank gutter` arm; `resetCursorOnUpdate` | The first two have no F6 caller and no Ink 5 equivalent; the third is **dead code for every compact caller** upstream (`Fae` never passes `disabled`); the fourth has no `Select` equivalent | not built |

### Deliberate divergences from upstream

Every place F6 knows what 2.1.220 does and shipped something else, with the reason.

| Divergence | Upstream | Ours, and why |
|---|---|---|
| The `(MCP)` marker test | `Ej` asks the tool registry for its display name and tests `userFacingName().endsWith(" (MCP)")`, then **strips** the suffix off the name it prints | We test the wire name's `mcp__` prefix — no client can make a registry lookup — and we have no display name to strip, so the raw wire name prints (`mcp__notes__append(f.ts) (MCP)`). A native tool carrying the suffix without the prefix would render unmarked |
| The generic body's rendered tool use | A per-tool renderer inside the engine (`renderedToolUseMessage`) | `Object.values(input)[0]` — order-sensitive by construction, and narrowed at the fix round to the **generic body alone**, which has no named field to read and no second reader to disagree with. A named-argument table per tool would be sturdier |
| The default model is persisted to the ccx prefs file | `Dcn` = `yi("userSettings", {model})` → `~/.claude/settings.json` | Our `prefs.ts`, by the same precedent `history.jsonl` follows: same promise, our root, so a test run isolates and we never write into a real Claude Code user's settings. `ccx attach` cannot apply it at all — the host it joins already owns its model |
| The resume picker's search is **modeless** | A `search` mode that disables the list while you type | Ours filters live with the cursor on the list; printables arrive through `Select`'s `onUnhandledKey`, and one Esc both clears a live query and closes when there is nothing to clear. Consequences, both pinned: `space` previews only from an empty query, and `hideIndexes` is on so digits reach the search field rather than selecting a row |
| The plan dialog's shift+tab hint reads `shift+tab to approve` | `shift+tab to approve with this feedback` | The feedback half is unreachable (the allow arm has no message field), so the full literal would advertise a channel that silently drops the user's sentence. Honesty beats byte fidelity; exported as `SHIFT_TAB_HINT` if the ruling ever changes |
| `ctrl+u` / `ctrl+d` scroll the plan region | Mouse-scrollable `a4` container | **An invented binding**, recorded prominently at the component header and in `GRANDFATHERED` (now seven entries). The prescribed `onUnhandledKey` route is impossible: an explicit unbind resolves as CONSUMED and never reaches a fallback, and `Select`'s fallback returns early while a text row has the cursor |
| `plan_approve` gained an optional `plan?: string`, merged into `updatedInput` | Replaces the whole input with `{plan}` when edited and `{}` when not | A merge keeps a future `ExitPlanMode` argument alive across a `ctrl+g` edit rather than silently dropping it. Both wire validators declare the field, because zod would strip it otherwise |
| One channel for `acceptEdits` | The plan approval can carry both a boolean and a `setMode` permission update | We send the boolean only. `appserver/planUpgrade.ts` already applies the mode from it; a second channel would double-apply |
| The rewind list runs **oldest-first** | Same (`T` is transcript order with `(current)` appended, cursor on it) | This is us *converging*: the C5 picker rendered newest-first, which put a row meaning "now" at the top or nowhere. Recorded because it is a visible behaviour change to a flagship surface |
| The rewind window rides the edge; the summary walk is windowed to 10 | A centred window (`max(0, min(w − ⌊_/2⌋, T.length − _))`) over an in-memory `fileHistory` needing no window at all | The window shape is the price of the uniformity ruling — one `Select` for every list — so our `↑ N more above` counters are honest about *our* window, not upstream's. The walk is windowed because each row costs a UDS round trip plus an engine call; 10 rather than the plan's 20 on the live-rewind-timeout precedent |
| `checking file changes…` while a chosen row's dry run lands | No such literal — upstream's pre-panel await is an in-memory lookup | A recorded **addition**: our transport is slower, and a panel that opens on stale numbers is worse than one that says it is waiting. Escape abandons the hold via a token |
| Rewind failure headings follow the **requested scope** | Two independent try/catch blocks report the pair actually caught, so a `both` that failed on one half narrows the heading | One host call that either completes or throws once. A `both` failing only on its code half reads `Failed to restore the conversation and code:` where upstream would have said `the code` |
| Rewind is always two-stage | Restores immediately when checkpointing is off | `DG43`, a standing **keep**: ours is safer and the extra step is cheap |
| `/bg` is the command name | `/tasks`, alias `/bashes` | `DG61`, a standing **keep** — `/tasks` collides with `TaskPanel` (the model's todo checklist). Both upstream names now exist as **aliases** onto the same dialog, which is the census's own prescription |
| `Background dialog dismissed` prints nothing | Cancels with `onDone("Background dialog dismissed", {display:"skip"})` | `display:"skip"` resolves to `messages: []` at the local-jsx call site (L241496) — **upstream prints nothing either**. The literal is exported as `BG_DISMISSED` and deliberately unused. `/help`'s dismissal is `display:"system"` and genuinely does print; the two were checked separately and resolved opposite ways |
| The todo panel defaults **open** | `showExpandedTodos` defaults `false` | The panel has shipped open for four waves. The flip is conditional on porting the spinner-side fallbacks that make upstream's closed default survivable (the `activeForm` spinner message and the `Next:` line), which we do not have |
| Local agents wear upstream's **teammate** labels (`Agents` header, `N agents` subtitle) | Reserves those for teammates and says `N active agents` for local agent rows | One coherent recorded pair, not two choices: the snapshot has no teammate concept to distinguish them from. A future teammate-aware wire moves both together |
| The help frame is `permission`-coloured | `professionalBlue` | Our token set has no such role (see §6's `ST4` row — three tokens against upstream's 72) |
| `/help`'s Commands browser has a `/` search | `FIr` is a plain scrolling list with `disableSelection` and no query | An **addition**: with ~105 live commands a query earns its place, and it reuses SettingsDialog's own idiom |
| The `/feedback` line is gated on the live catalog reporting a `feedback` command | Rendered unconditionally at ≥44 rows | ccx has no `/feedback`, so the literal would be a false promise; the gate makes it appear by itself if the engine ever reports one. Upstream's `/powerup` line is dropped for the same reason, which is what made the two treatments consistent |
| `/keybindings to customize` is unconditional in the grid | Gated on a release flag | The command genuinely exists here, so omitting it would be the dishonest choice |
| An unbound action contributes **no grid cell**, and the column re-flows | `Y6t` composes fixed child slots (two literal `null`s sit in column 2), so a dropped entry most likely leaves a blank row | `$e`'s three-state contract applied to a sentence — `(unbound) to switch model` is not a sentence. Observable only to a user who unbinds an advertised action |
| Bare `y`/`n` no longer answer an `AskUserQuestion` | Upstream's question dialog is a list with no such shortcut | Converging: the pre-F6 `y`/`n` was an F0 re-homing onto `Confirmation`. Pinned as **inert** rather than silently dropped, because it is the one change a user could notice and dislike. The permission and plan dialogs still take `y`/`n` |
| An empty `MultiSelect` submit is inert | `onSubmit(selectedValues)` fires regardless | Keeping the pre-F6 guard rather than committing an empty answer to the SDK |
| A multiline paste into a `Select` input row **drops** the newline | `Vs` is genuinely multiline | `InputText` is single-line — T1's recorded simplification. It also makes the old accident (a stray `\r` settling a decision) structurally impossible |
| The background dialog **clamps** at both ends where every `Select`-rendered list wraps | Upstream's option map wraps unconditionally | It drives `useSelectKeys` directly (it renders its own section-grouped rows), so it inherits that hook's `wrap:false` default — the same default the five F2-era overlays were built on. Every key still moves the selection; pinned explicitly in `f6-acceptance.test.tsx` § #6 rather than left as an accident |
| `Home`/`End` are dead inside `MultiSelect` | — | Bundle-faithful: `tQs` binds neither anywhere. Narrower than acceptance #6's literal wording, which is about the single-select surfaces |
| `hideIndexes` still numbers an input row; input rows pad one column wider than plain rows; `id 0` chips; `✔` measuring two columns | — | Four **fidelity-to-a-quirk** items, each upstream's own shape and each pinned so a later "fix" fails a test instead of passing silently. `p1t`'s double slash (`//<dir>/**`) is the same class — probe 78 recorded exactly that string on the live wire |
| Upstream's apostrophe is inconsistent and we reproduce it | U+2019 in the editable prefix row's label, ASCII `'` in `Wdi`'s commands arm | Both pinned |
| `TERM !== "linux"` is only the non-Windows half of `EJi` | The full predicate also reads `WT_SESSION`, `TERMINUS_SUBLIME`, `ConEmuTask` and a TERM allow-list | `TaskPanel`'s glyph fallback carries the half; `Select.tsx` carries the whole predicate — **so the two disagree on Windows**. One shared helper's worth of work, owned by whoever ports the Windows path |
| `commandKind` asks the `ZLb` table **before** the catalog proxy | `p9f` asks `type === "prompt"` first | `CommandEntry` has no `type`; `source === "catalog"` is a weak proxy that would paint all ten of upstream's own client-side controls (`agents`, `config`, `effort`, …) as `skill`. The cost is real and observed: this repo's `schedule` skill shares a name with `ZLb`'s agent bucket and renders `agent`. Moot in the default build, where the lane is off |
| Every allow arm omits `updatedInput` | Upstream's carry `updatedInput: e.input` (the input unchanged) | `allow_once.updatedInput` is a **full replacement** on the SDK side, so sending an unchanged copy buys nothing and risks everything |
| Session rename is optimistic | Re-scans every log | The new title is overlaid locally and the write is fire-and-forget, so a failed write leaves the picker showing a title the store does not have until it is reopened |
| The `SessionPicker` scope is **preemptive**, and there is a 22nd key context for it | Upstream hangs a raw `onKeyDown` on the container and has no context for the resume picker at all | Scope precedence is mount order, so the inner `Select`'s `ctrl+r: null` ate the rename key — found by a failing test, not by reasoning. Only the three keys this context binds change hands |
| A 21st context, `SelectDecision` | Upstream expresses the same distinction in its owner gate | A list **answering the model** is not an overlay: `Select`'s overlay-flavoured nulls silently killed five root globals over a parked question. `SelectDecision` is `Select`'s eight actions with `Confirmation`'s suppression set instead |
| The `Help` context takes the Settings/Select suppression set rather than `useSwallowKeys` | `ShortcutsOverlay` protects itself by swallowing | `swallowContexts` resolves the **innermost** live scope, and this dialog mounts `Tabs` and `Select` inside itself — a swallow here would eat its own Escape |
| `MessageSelector` survives as five keys, not thirteen | — | Its eight jump aliases are retargeted onto `select:first`/`select:last` and the other five `messageSelector:*` actions are removed from `VALID_ACTIONS`. `escape` stays because it is the one key the rewind picker must answer with no list mounted |
| `EDITOR_PAINT_MS` is skipped in the plan dialog | — | That timer exists to flush the composer's `Save and close editor to continue…` row before the block; this dialog paints no such row, and deferring the spawn would break the same-tick suspend law |
| `splitSimpleCommand` **rejects when unsure** | Upstream parses bash | No grammar here, so an unquoted pipe, a real `$` expansion, an unterminated quote or a leading `VAR=` returns null and lands on the ordinary Bash dialog. Known over-rejections (`sed -i s/foo$/bar/ f`, brace expansion) are rare and fail safe — a missed preview, never a wrong one |
| **`pageup`/`pagedown`/`home`/`end` are dead in `SettingsDialog` and `PermissionsDialog`** | Its lists page and jump like every other | **A shortfall against acceptance #6's literal wording, surfaced by writing that criterion's helper.** Both dialogs push the `Settings` context, which binds `up`/`down`/`j`/`k`/`ctrl+p`/`ctrl+n` and **no paging or jump keys at all**, and their key fallback swallows what the table did not resolve — so those four keys resolve to nothing and are not passed on either. Every list *this wave shipped* has all eight (they mount `Select`); these two predate it and were never migrated. Four lines in `bindings.ts` plus a re-run of their suites |
| `kXa`'s row clip and its `stackedOriginalInput` branch | Clips the prompt text with its own measured budget, and renders a *stacked* original-input form for a row whose prompt was edited and re-sent | Ours clips at `columns − REWIND_ROW_PADDING_RIGHT` (a constant, not a measurement) and has **no stacked branch** — an edited-and-resent prompt renders as the one line it is now, losing the "this replaced that" pairing. Both deltas are cosmetic-to-informational, both recorded at `AnchorLine` |
| Our `ctrl+z` help-grid gate is the **platform** | `Tho()` gates the suspend row on the session **kind** (`!== "bg"`), not on the OS | We gate on Windows, where `SIGTSTP` does not exist, and show it everywhere else. The two agree on every foreground POSIX session and disagree for a background session on POSIX, where upstream hides the row and we show it. An honest recorded divergence, not a transcription |
| Tab toggles the deny row into feedback mode | `yesInputMode`/`noInputMode` is a state pair whose *trigger* the bundle never showed us | **A design decision, and it is now confirmed in practice rather than only argued.** T4 chose Tab because no trigger was visible in `dZf`'s body; T6–T8 then shipped six dialogs on that choice and each one's `onInputModeToggle` wiring works — so the mechanism is proven, and only the *key* remains ours. Recorded so a later bundle read that finds upstream's real trigger knows this was chosen, not transcribed |
| No synthetic **Current model** row | `zAe` prepends a row for the active model when it is absent from the catalog (L440960-968) | Our catalog comes from `supportedModels()`, which always contains the running model, so the row could only ever appear in a state we cannot produce. Omitted rather than built dead — but this is an assumption about the SDK, not a proof, and a provider whose catalog omits its own default would expose it |
| Row bodies are not width-clamped by a `maxWidth` | Ink's own `maxWidth` bounds a row's text box | **Ink 5 has no `maxWidth` prop.** Every clamp in the F6 dialogs is arithmetic on a `columns` value threaded down by hand, which means a surface that forgets to thread it silently gets the default 80 rather than a visibly wrong layout — the quiet failure mode, and the reason `columns` is a required prop on the bodies that measure |
| The Windows UNC guard keeps the platform test and two head forms | `Kk` checks a dozen UNC spellings | All of them sit behind `if (Pt() !== "windows") return !1`, so the whole check is dead on every platform this harness runs on |

### Open evidence gaps (honest closure candidates, not claims)

- ~~Seven real-TTY checks owed~~ **ALL SEVEN MADE at wave close (2026-08-06, tmux against the built binary,
  keyed, isolated `HOME` so consults fire like a fresh install). No functional defect found** — the first
  wave-close TTY pass of the program to come back clean. Results: **T5** — a mid-draft Edit consult showed
  the dim `Waiting for permission…` row while typing continued, the reveal fired inside the window with a
  clean redraw, and the draft returned intact after the decision; **T7** — the Edit dialog rendered
  title/rel-path/real-diff/basename-question exactly, and **shift+tab picked the accept-session row live: the
  engine's `setMode acceptEdits` suggestion round-tripped and the status-bar mode chip flipped to
  acceptEdits on the spot**; **T8** — the footerless Fetch body laid out cleanly (one cosmetic note: when the
  model's `prompt` echoes the URL, the body prints the URL twice — data-faithful, looks odd); **T9** — the
  plan modal at 24 rows clips with the `… +N more lines (ctrl+u/ctrl+d scroll)` marker and both scroll
  directions work, counters updating; **T10** — two-line rewind rows with pre-computed summaries, the cursor
  opening on `(current)`, and the confirmation panel's explanation pair — all clean (the hold line did not
  appear because summaries land in milliseconds in-process; see the window bullet below); **T12** — the
  flag-on `/` popup draws `config` lanes and aligned blank `action` lanes; **T13** — the glyph gutter
  rendered cleanly at default ambiguous-width (the side-by-side against a narrow-configured terminal remains
  untested — the one residual sliver). Bonus: a live AskUserQuestion rendered the two-column layout, the
  `[1/2]` tab marker, and the unfocused-input placeholder-over-label rule, all as pinned.
- **Live-feedback round (2026-08-06, six reports from real ssh use, all closed same day — commits
  `03d1f9ee3a` + `2885985ec1`).** The clean TTY pass above did not catch what days of real use did:
  **(1)** ctrl+o during a streaming turn flooded scrollback — the pager box (`rows-6`) plus the spinner,
  task panel, queue echo and pending stream rows beside it exceeded the terminal height, and Ink deposits
  a frame copy per spinner tick for anything it cannot erase; the pager now hides every sibling transient
  region while mounted, the overlay-divergence equivalent of upstream's whole-screen swap (`rUb` L499000).
  **(2)** "diff context lines invisible" was environment, not code: pre-isolation F6 TTY runs had leaked
  `theme:"light"` (plus a `__sentinel` fixture key) into the user's REAL `~/.claude/ccx/prefs.json` —
  pollution removed; the isolate-HOME rule now has a shipped-harm example. **(3)** `/clear` had been
  UI-only (engine context kept — its own comment said so); it now rides a busy-gated `clear` host op
  through the same `swapEngine` seam as resume/rewind, with an explicit `resume: undefined` override so a
  `--resume`-born host cannot reopen the dropped conversation. **(4)** `/compact` died on the 10 s wire
  deadline mid-summarization every time on a real context — `COMPACT_TIMEOUT_MS = 300_000` (the rewind
  timeout lesson re-learned) plus an immediate `compacting…` notice. **(5)** rewind printed only the bare
  `⏪ rewound` divider: the replay raced the swap's new session id and the file's first flush (now a ~3 s
  poll that re-reads the id each attempt, and the adapter learns the new id from the `rewound` broadcast),
  and `app.clear()` cannot erase scrolled-out rows (the rebuild now performs `/clear`'s real `2J/3J/H`
  wipe first). **(6)** option+backspace deleted one character — the bundle routes `meta|ctrl+backspace` to
  `deleteWordBefore` **as a kill** and `meta+delete` to `deleteToLineEnd` (L395786–96); both ported, the
  old single-char pin rewritten for the word arm.
- ~~The relaunch half of acceptance #2~~ **PRODUCT-PROVEN at wave close (2026-08-06):** a Bash consult's
  suggestion row was applied in the ccx dialog, `.claude/settings.local.json` gained
  `Bash(touch /private/tmp/…/marker-a.txt)`, ccx was quit and relaunched, and the same command ran with
  **zero prompt**. Acceptance #4 was product-proven in the same session: an empty keep-planning submit
  produced `Error: User rejected the plan. Continue planning.` — the deny, exactly as Esc.
- **`REWIND_SUMMARY_WINDOW = 10` — probe 82 settled the cheap half.** The engine hop for
  `rewindFiles(dryRun)` measured 0–3 ms per anchor in-process **without checkpoints** (`canRewind:false`
  everywhere — a raw `query()` has no file checkpointing), so the hop is not intrinsically multi-second; the
  60 s timeout precedent is an attach/loaded-machine artifact. The checkpointed diff path remains unmeasured;
  the picker felt instant in the TTY pass. 10 stands; raising to 20 stays a one-line change.
- **`titleColor` on `nr` is unproven.** The frame trace transcribed for the Background dialog belongs to
  `Ed`, which takes a *separate* `titleColor`; `nr` paints its title with the same colour it borders with.
  Ours matches by coincidence of value, so the assumption must be re-derived before any dialog wants a title
  colour that differs from its border.
- **T5's `{active}` keyboard-ownership machinery is load-bearing for zero tests**, and this is stated rather
  than glossed: under the corrected hide/suppress model the composer and a dialog are never both mounted in a
  settled state, so reverting all four gates fails nothing. It is kept as a real registry capability and as
  the truthful expression of ownership for the one-flush window in which a retiring composer's registrations
  outlive its unmount — a window `ink-testing-library` cannot produce, since it delivers one chunk per write.
- **The `Confirmation` + `SelectDecision` stacking is load-bearing by MOUNT ORDER across four dialogs.** It
  works because each body mounts its `Select` as a child of the scope owner. Anything that mounts one as a
  **sibling** would invert Enter and Escape silently. Nothing enforces this but the comment at each site.
- **`suggest-popup.test.tsx`'s "/revi opens the popup" test uses a fixed `setTimeout(20)`** rather than
  `waitFor`, so it races the provider's passive stdin subscription under parallel load. Pre-existing, unrelated
  to F6, and worth converting.
- **Two pre-existing defects this wave's audit surfaced, neither caused by F6 and neither fixed in it.**
  (1) **`listSessions()` is called unscoped** at `useChat.ts:869` (the `/resume` picker) and `:905`
  (`/continue`), so the picker lists **every project's** sessions rather than this cwd's — which also makes
  §4's "no project axis" note read as a missing *feature* when the immediate problem is a missing *filter*.
  (2) **`PermissionsDialog.tsx:173-174` reads `key.upArrow`/`key.downArrow` raw** inside its add-rule
  destination sub-view, bypassing the keymap entirely — exactly the pattern F2 existed to eliminate, and the
  reason a rebind of `select:previous`/`select:next` does not reach that list. Both are small, both belong to
  the close pass, and both are recorded here rather than in a commit message so they cannot be lost.
- **T10 was not written test-first**, and says so: the rewind picker's design questions were settled by reading
  the bundle and writing the component, with tests immediately after and then sabotage-checked. Recorded as
  process debt rather than left to be inferred from the commit order.

---

## Wave T (2026-08-06) — trust & safety

F6 closed the dialogs against the *census*. **Wave T is the first wave driven by the QA fleet** — seventeen
tasks, each independently reviewed, answering findings a human hit while using the built binary, in the order
a user meets them: the permission posture at launch, the affordances inside a consult, the plan handoff, and
the failure surface (spec `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md`, `main`
`7af9e093dc..4a7a640d85`). The close-out verification pass walked all twenty acceptance criteria and found
**17 proven by test, 1 needing a live TTY (A1's engine half), 1 surface-shipped-with-wiring-deferred (A6),
and 1 not met as written (A9, whose premise the wave itself retracted).** Gates at close: typecheck clean,
`test:unit` 1453 passed, `test:tui` 2735 passed / 9 skipped, and `npm run build` — never run during the wave
— clean.

The wave's own recurring lesson is worth stating once, because it is the reason so little of it appears as
score movement: **six of its premises were overturned by reading the bundle or running a probe**, five of
them mid-execution. The QA finding is a report of a symptom, not a diagnosis, and three "defects" turned out
to be faithful transcriptions of upstream we would have broken by fixing (W-T16, W-T19, W-T22, W-T21).

### Now faithful

| Row | What shipped | Evidence |
|---|---|---|
| The launch posture | An interactive host is born in `default` (upstream's **Manual**, `gGl` L41536), scoped to the host *kind* so `ccx --detachable` — the same REPL, forked through `spawn.ts` — is covered rather than only the foreground call site (W-T14). Banner, `hookOpts.initialMode` and the host now read `resolvedPermissionMode` off one object, so the three cannot disagree at turn 0. Headless `-p`, `--bg` and the daemon keep `auto` deliberately | `test/unit/cli-main.test.ts`, `test/unit/host-mode-sync.test.ts` |
| The auto-mode entry notice | Entering `auto` appends `AUTO_MODE_DESCRIPTION` verbatim (L547285-86) as a transcript **notice** row — not a dialog, not a styled block — after upstream's own 800 ms delay, once per process and once per install (`hasSeenAutoModeEntryWarning` in ccx prefs, mirroring the app-config flag `OMa` reads at L454515-17) | `test/tui/auto-mode-notice.test.tsx` |
| The consult's affordances | The shared footer with `aZf`'s amend-hint gating; empty feedback rows collapsing when focus leaves (`handleFocus` L505162-69); an empty amend that collapses the row instead of silently denying; and `No,`+cursor+placeholder with no doubled space | `test/tui/consult-footer.test.tsx`, `option-rows.test.ts`, `small-permissions.test.tsx`, `select.test.tsx` |
| The plan handoff | `sYf`'s availability-driven option arms, a `plan_approve` that carries the **granted mode** applied by both wires, the model swapped **before** an `auto` grant (probe 99 makes that load-bearing), `SM`'s dashed rules round the plan body, the shortened `input.planFilePath` in the `ctrl+g` footer (probe 97 A2), and a guard test pinning the live tool name `ExitPlanMode` | `test/tui/planDialog.test.tsx`, `test/unit/host-mode-sync.test.ts`, `test/unit/appserver/decisions.test.ts` |
| The failure surface | `system/api_retry` frames recognised and rendered as the row that replaces the spinner, with a stalled variant anchored to turn start; and turn results classified by `is_error` / `terminal_reason` / `api_error_status ≥ 400` instead of `subtype`, which probe 96 showed still reads `"success"` on a dead connection. Three surfaces that were discarding the error tag now carry it. A killed turn ends with **exactly one** honest failure line | `test/tui/retry-row.test.tsx`, `useChat-error.test.tsx`, `test/unit/retry-status.test.ts`, `session-frames.test.ts`, `structured.test.ts` |
| The bypass gate | `SAm`'s consent on the launch path, on `/yolo` and on `--detachable`, with upstream's exit codes and its never-ask-again flag; plus a refusal for `ccx --bg` into bypass with no prior acceptance, transcribed from L451420-21 | `test/tui/bypass-consent.test.tsx` (14), `test/unit/args-bypass.test.ts` |
| Refusal over pretence | A rejected runtime `setPermissionMode` is reported and the chip stays on the real mode; a rejected model swap is reported rather than announced as done | `test/tui/mode-refusal.test.tsx` (6) |
| Framing and sentinels | The create-file body inside `SM`'s dashed rules (`ial` L505666-96) with `(No content)` intact, and upstream's third interrupt sentinel routed to the existing `Interrupted · What should Claude do instead?` row | `test/tui/file-permission.test.tsx`, `toolResult.test.ts` |

### Premises overturned — the wave's non-changes, recorded so they are not re-filed

| What the finding claimed | What the bundle said | Outcome |
|---|---|---|
| The generic don't-ask-again row's copy lies about its scope (`commands in this directory`, granting the tool everywhere forever) | The copy is upstream **verbatim** (L506166) and so is the content-less whole-tool rule it writes (L506109); the destination *is* the project root under `localSettings`, which ccx matches | **No change**, pinned as canon-by-transcription (W-T16) |
| WebFetch's No row promises a feedback channel it cannot deliver | The string is upstream's standing idiom across both row shapes — the same label again at L544640, a near-twin at L503212, and the identical words as the *placeholder* on three input-form decline rows. Upstream builds this one as a plain label with no feedback row either (L506771) | **No change**; A15 amended mid-execution (W-T22). The drafted rewrite would have replaced a verbatim canon string with copy appearing **nowhere** in the bundle |
| An empty `Enter` on the plan modal's `No, keep planning` row should be a no-op | The plan modal's `onCancel` **is** `xnl` (L500994) → `{behavior:"deny"}`, so upstream's empty Enter denies — exactly what ccx already did, pinned as an F6 acceptance criterion | **No change**; A9 withdrawn (W-T21), and the `Select` empty-submit outlet it was going to justify dropped from the wave |
| The interrupt row should substitute on all three sentinels including the tool form | Upstream paints the row **twice** on Esc-during-tool (once from `HVo`'s `F7` branch L429119, once from `ERe` exit 9 L426473). F3 suppressed the tool form on purpose | Only the genuinely-missing third sentinel routed (W-T19); the double-paint stays a **chosen** divergence |
| `auto` on an unsupported model silently falls back to `default` | **Probe 99**: the engine **refuses** — "Cannot set permission mode to auto: auto mode unavailable for this model" — and stays in the previous mode. So the grant is *lost*, not degraded, and the lying chip cannot arise on the auto path at all | The applier swaps the model first and reports refusals; a standing project premise corrected |
| `ctrl+e` explain is reproducible here because it is reproducible upstream | That was a statement about *upstream*. This harness had **no** one-off Messages transport at all — zero hits for `@anthropic-ai/sdk`, `new Anthropic`, `messages.create` or a bare `fetch(` | Gated on **probe 98**, which found three live paths and a cheaper one than the plan had (W-T13). Caught one step before it cost a task |

### Deliberate divergences from upstream

| Divergence | Upstream | Ours, and why |
|---|---|---|
| The interrupt line prints **once** on Esc-during-tool | Twice — `HVo`'s `F7` branch and `ERe` exit 9 both paint it | F3's decision, kept: the tool row already carries the text and a second line says it twice. Recorded prominently so a later fidelity audit does not "fix" the count back to two |
| The consult footer says `esc cancel` | `escape / cancel` | The five pre-existing footers and their tests already used the short form; re-spelling every chord is Wave C's chrome work, not this wave's |
| The retry label maps `error_status` onto canon's **connection prose** (`rZp` L437178-90) | `error.formatted` from the CLI's own error object | The wire's `error` field is a slug set (`unknown`, `overloaded`, …) that appears nowhere in canon's UI, and probe 96's own outage sample is literally `"unknown"` — strictly less informative than the `API error` literal it would replace |
| The turn classifier gates `api_error_status` at **`>= 400`** | — | This repo's own rule, taken from correlation probes 94/94b so the two cannot drift: the SDK emits a finite-but-null status on ordinary success frames, and an unthresholded read would mint failures for healthy ones (and make `runStructured` throw on a valid run) |
| The auto notice keeps only half of upstream's gate | `OMa` is `hasSeenAutoModeEntryWarning` **or** `skipAutoPermissionPrompt` at policy/user/flag scope | ccx has no settings-scope equivalent for the second term. Consequence, accepted: `ccx attach` onto a background host (which stays in `auto` by design) prints the notice at attach time — upstream's per-process ref guard behaves the same way |
| The bypass acceptance persists to ccx prefs; bare `y`/`n` are inert on that dialog | `yi("userSettings", …)` → `~/.claude/settings.json`; `Confirmation` binds `n` to the same 0 exit as Escape | Same precedent `history.jsonl` and the default model follow: our root, so a test run isolates and we never write into a real Claude Code user's settings. The `y`/`n` loss comes with pushing no `Confirmation` scope, which is what routes Escape to the frame's own 0 exit |
| `shift+tab` carries the approver's text into **ccx's decision record only**, and the hint says only `shift+tab to approve` | `shift+tab to approve with this feedback` (L500713) | The SDK's allow arm has no `message` field, so the full literal would advertise a channel that silently drops the sentence. Stated here because A18's own wording ("as the row's own description advertises") became circular once the description stopped advertising it |
| The dashed-rule box wraps the **overwrite diff** as well as the create body | Same — `ial` hands `SM` the already-resolved ternary (L505692) | Us converging, recorded because the criterion only asked for the create arm. The Edit arm is the other half and is **not** done — see the open items |
| `SM`'s screen-reader arm is not transcribed | `SM` drops the border entirely under a screen reader (`Ea()`, L424996) | Stock Ink 5 has no `isScreenReaderEnabled` context and this harness has no screen-reader surface to read it off — the same class of gap `DialogFrame.tsx` already records for `srPrefix`. We paint the rules unconditionally |

### Open items (named, owned, not counted as shipped)

- **A6 — the `ctrl+e` explain pane is a surface with its wiring deferred.** Prompt, schema, risk helpers,
  toggle, three-row render and a DI'd transport all ship and are pinned by 33 tests; **nothing in `src/`
  passes the transport**, so in the shipped binary there is no hint and the key falls through. Deliberate
  (`BashPermission.tsx:26-33`: "wiring a dialog that makes model calls by default is a separate, deliberate
  decision"), and it does **not** score as delivered — §4's registry-kinds row stays ❌ and the consult-footer
  row's 🟡 names the missing hint. Whoever wires it inherits probe 98's Path C (~6 s, zero new dependencies)
  and, if the dependency-and-credential question is ever answered, Path A at 2.8 s.
- **The Edit arm is still unfenced.** Canon's `Qsl` (L505548) wraps the edit diff in the same `SM` the create
  and overwrite arms now use; t17 scoped itself to `ial`. `test/tui/file-permission.test.tsx` **pins the
  absence**, so closing it is a visible edit rather than a silent one.
- **The approver's feedback does not surface on the REPL path.** `shift+tab`-with-text is recorded on ccx's
  own decision, and only the app-server's `decision/resolved` fan-out carries it to a client (`server.ts:278`);
  in `ccx` and `ccx attach` nothing shows it. An approved-plan transcript row carrying the approver's text is
  the fix, and it is not built.
- **`ccx -p` into bypass stays ungated.** The consent gate deliberately excludes `-p`, `--bg` and non-TTY
  runs, matching upstream's placement of its own gate inside the interactive startup — and `--bg` is
  separately refused. `-p` is the remaining door: it is not scored against the §4 row, because upstream's
  gate is interactive-only too, but it is the one bypass route in this harness with neither a prompt nor a
  refusal behind it.
- **A1's second half needs a live TTY.** That a fresh launch is in `default` is proven keylessly; whether
  the *engine* then consults before `rm` is SDK-classifier behaviour no keyless test can observe. The QA-3
  repro must be re-run in the tmux harness (`docs/parity/qa-driver.md`) to close it.
- **`ypo()`'s status-page line is not built** — the dim ` If it persists, check <status page>.` under the
  retry row for overload-ish errors. It is the named 🟡 arm on §3's new row.
- **A latent `Dpt` status mis-mapping, confirmed still present.** `toolResult.ts` maps
  `"User rejected tool use"` to the **interrupted** status where upstream routes that content to the
  tool-use-*rejected* component (`mVo`, L429120). ccx already has the natural target (`REJECTED_TEXT =
  "Tool use rejected"`, `toolRenderer.tsx:92`). Verified that t9's change cannot make it worse — `Dpt` and
  `F7` share only "The user doesn't want to " before diverging — but it is a candidate for a later wave.
- **`Select.tsx`'s `allowEmptySubmitToCancel` is still inverted from its name**: `true` means the empty
  submit is *carried through*, i.e. it does **not** cancel. Wave T removed the flag from every consult
  feedback row; the remaining users are `ModelPicker`, `ThemeDialog`, `SessionPicker`, `SettingsDialog`,
  `RewindPicker`, `MultiSelect` and the Bash editable-prefix row. A rename is cheap and removes a standing
  trap.
- **One test comment now contradicts the wave's own probe.** `test/unit/host-mode-sync.test.ts:150-152`
  still reads "`auto` is MODEL-gated: on an unsupported model the engine silently falls back to `default`".
  Probe 99 established the opposite. The test's *behaviour* is unaffected (swap-first is right either way);
  the comment will mislead the next reader.

### Evidence notes

- **Canon is now version-pinned to what actually runs.** `node_modules/@anthropic-ai/claude-agent-sdk/
  manifest.json` declares `"version": "2.1.220"`, commit `4073f595` — the CLI the SDK spawns is *the same
  build* as `~/claude-code-bundle/2.1.220/cli.pretty.js`. This program has been treating the bundle as
  canonical on the assumption that it matches the runtime; that assumption is now evidence. The corollary
  holds for every future wave: a bundle-derived claim about what the engine *writes* is settled, while a
  claim about what the SDK *forwards over the stream* still needs a live probe.
- **The third sentinel's prefix match is load-bearing, not defensive**: upstream's `Mpt` (L373032) appends
  a statsig-gated suffix, so `===` genuinely breaks when the flag is on. Its two siblings stay exact.
- **Probe 96** measured the outage ladder (563 ms → 39 s across ten attempts, ~190 s to exhaustion; ~75 s of
  silence before the first frame on a blackholed endpoint, ~20 ms on a refused one; `max_retries` is a
  ceiling, not a promise — a 401 gave up after three; the child's `stderr` yielded zero lines in every
  variant, so messages are the only channel). **Probe 97** put `planFilePath` on the wire and showed
  name-driven classification is the only option available. **Probe 98** settled `ctrl+e`'s feasibility.
  **Probe 99** settled runtime mode refusal.

---

## 1 — Input / composer ergonomics

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Multiline editor (paste chips, `\`-continuation) | ✅ | — | **F5 (t1/t3/t4/t5).** The F0 correction is closed: `CM21`'s chip fires above 800 characters **or** above the live `max(0, min(rows-10, 2))` newline threshold, the body is parked out of band and `fSe` substitutes it back at submit, one backspace eats the whole placeholder (`deleteTokenBefore`), motions step over it, `CM24`'s paste-again expands it inline under `bDo`'s 100 k cap, `CM25`'s `Pasting…` shows while a paste assembles, `CM26`'s cache survives sessions, and `CM27`'s ANSI/CRLF/tab normalisation runs in `k0`'s order. `CM18`'s backslash-Enter is now cursor-relative and sets `hasUsedBackslashReturn`. Recorded deltas: the cache lives under the fleet root, is never swept, and `CM22`'s smart-spacing clause turned out to be image-only upstream — see the F5 divergence table |
| History up/down (draft stash/restore) | ✅ | — | **F5 (t6/t7).** The F0 correction is closed: `history.jsonl` in upstream's own line shape persists across launches, `CM53`'s dedup is whole-scan newest-wins, `CM54`'s edit cache carries the full `{display, pastedContents, mode}` triple so an edited recall survives arrowing away and back, `CM55`'s bash latch filters the walk by the display's `!`, `CM56` raises the derived `ctrl+r` hint after the second Up, and `CM57` restores a recalled prompt's chips (rewriting a lost body to `ou_`'s literal). Recorded deltas: our file is at the fleet root, the append is a plain `appendFileSync` rather than a lock, the read is whole-file, and there is no `cu_` write suppressor |
| `@`-file mention fuzzy autocomplete | 🟡 | — | **F5 (t9/t11), and an honest downgrade.** Three census gaps closed at once — `CM35`'s full path character class and quoted `@"my file.ts"` paths, `CM39`'s trailing-only 50 ms debounce with a generation guard that discards an overtaken walk, and `CM40`'s iterative descent (accepting a directory splices `@src/` with no trailing space and re-roots the walk one level deeper). Closing them revealed the one thing genuinely **not built**: upstream's lane-A Tab completes to the longest common prefix when it cannot disambiguate (L490925–L490934). The old ✅ predates anyone counting; there is also no prebuilt fuzzy index, so a very large repository re-walks |
| `/`-slash command autocomplete | ✅ | — | **F5 (t9/t10) re-verified against the bundle.** `CM34`'s trigger (whitespace or CJK punctuation before the slash, cursor at token end, the six-name denylist, the separate head case), `CM28`'s Tab-accepts-without-executing / Enter-accepts-and-executes split including upstream's argument-hint exception, `CM29`'s wrapping selection, `CM36`'s mid-text ghost text, `CM37`'s inline `argumentHint`, and `CM38`'s `No commands match "…"`. One recorded delta: Escape also dismisses the empty-message state, where upstream's `Lt` is false |
| `!` bash mode (run shell directly, no model) | ✅ | — | **U5** `bash.ts` local exec in cwd, echoed `! cmd` + `⎿`-style output (local-only by design; no model context injection) |
| Input mode indicator (bash/memory/command) | ✅ | — | **U5** `inputMode()` → magenta bash / blue memory border + hint |
| Ctrl-A / Ctrl-E (line start/end) | ✅ | — | **U7** `editor.ts` readline keys. **F5 (t1):** `CM14` pinned rather than assumed — upstream's are `startOfLogicalLine`/`endOfLogicalLine` and our buffer's array entries ARE logical lines, so the census's "diverges once wrapping lands" does not apply to this model |
| Ctrl-K / Ctrl-U (kill to end/start) | ✅ | — | **U7** `editor.ts`. **fixed 2026-07-31 (F0, t1, CM10/CM11):** killed text used to be discarded — the correction had this at 🟡. It now feeds a real kill ring (cap 10, coalescing runs), with `Ctrl+Y` yank / `Alt+Y` yank-pop and a `Ctrl+Y to paste deleted text` hint after a ≥3-char Ctrl-U kill, matching upstream |
| Ctrl-W (kill word back) | ✅ | — | **U7** `editor.ts`. **fixed 2026-07-31 (F0, t1):** same kill-ring fix as Ctrl-K/Ctrl-U above |
| Word movement (Alt/Ctrl ←→) | ✅ | — | **C5** `editor.ts` `wordLeft`/`wordRight` (Alt-←→ and Alt-b/f), checked ahead of the ctrl-combo branch so no meta chord falls through to insertion |
| Ctrl-L (clear **input**) | ✅ | — | **W1** converged on 2.1.220's `chat:clearInput` (the old app-level screen-clear was a divergence); screen clear stays `/clear` — real CC's `cmd+k` never reaches a terminal app (intentional divergence, recorded) |
| Ctrl-J (newline) | ✅ | — | **W1** `editor.ts` — 2.1.220 `chat:newline`, alongside `\`-continuation. **F0 note (t4, KB4/KB23):** the `key.ctrl==="j"` branch this used to dispatch through was dead code — real terminals send a bare `\n`, never a ctrl-flagged `"j"` — and was deleted; the newline still works via the generic bare-`"\n"` insert path, so behavior is unchanged, only the dead branch is gone |
| Ctrl-_ / Ctrl-- (undo edit) | ✅ | — | **W1** `editor.ts` snapshot-on-change stack (cap 100) — 2.1.220 `chat:undo`. **fixed 2026-07-31 (F0, t4, KB4):** this row was scored ✅ but was actually **unreachable** — terminals send the bare `0x1f` byte with `key.ctrl===false`, so the old `ctrl+"_"`/`ctrl+"-"` branch never fired and a literal `\x1f` was inserted instead (only reducer-level tests existed, which is why nothing caught it, and `ShortcutsOverlay.tsx` was advertising a dead chord). Fixed by matching the raw `\x1f` byte directly; the dead `ctrl+"_"/"-"` branch was removed. **F5 (t1):** `CM17` closed — the ring is upstream's cap **50** (not 100), every entry carries `pastedContents` alongside the text and cursor so an undone paste takes its payload with it, and a change inside 1000 ms coalesces. Recorded delta: upstream defers through a rescheduled timer where we skip the push, which differs only at the trailing edge of a burst |
| Ctrl-S (stash / restore input) | ✅ | — | **W1** `editor.ts` — 2.1.220 `chat:stash`: parks a non-empty buffer, restores on the next Ctrl-S from empty |
| Shift+Tab cycles permission mode (bare Tab popup-only) | ✅ | — | **W1** converged on 2.1.220's `chat:cycleMode` = `shift+tab`; bare Tab now belongs to autocomplete alone (our old bare-Tab cycle was a divergence) |
| Ctrl-C twice / Ctrl-D to exit | ✅ | — | **U8** Ctrl-C interrupts a turn, else "Press Ctrl-C again to exit". **F0 update (t6, KB3):** Ctrl-D used to exit on a single empty-buffer press; it now needs two presses within the arm window, matching upstream's `Pee` helper — including its exact **800ms** window (`cli.pretty.js:183445`, the same constant as the Esc-Esc clear timer), corrected down from this plan's originally-assumed 2000ms after reading upstream's own patched-Ink suspend code |
| Queued messages while busy | ✅ | — | **U6** turns queue while busy + drain FIFO on turn end; `⋯ queued:` indicator. **fixed 2026-07-31 (F0, t3, CM49), hardened in the sixth final-review pass:** Esc/Ctrl-C during a busy turn now pops the queue back into the composer (prepended ahead of any in-progress draft) before clearing it. Its current editor state is app-scoped, so the rescued/edited draft and kill ring survive the tested temporary pager, history, settings-shaped, and decision overlay remounts; submit reset stays empty and stale autocomplete is intentionally normalized. This is an evidence-backed temporary-remount guarantee, not a claim about unimplemented persistent/global editor storage. **F5 (t8):** entries are now `CM51`'s typed record (`{value, mode, priority, pastedContents, origin}`) behind `P5`'s editable predicate, and `CM48`'s Up/`ctrl+p` drain pulls every editable entry back into the buffer — queued first, the draft last, non-editable entries left in the queue, chip ids re-minted twice so a queued chip cannot collide with one already in the draft. `CM50`'s per-item queue-edit cursor is not built; it is behind upstream's own `CLAUDE_CODE_KB_COHESION_FIXES` flag, so it is not default behaviour there either |
| Placeholder / ghost text ("Ask Claude…") | ✅ | — | **F5 (t8).** The fixed string is gone. `CM3`'s four-rule precedence ladder ships over `MVf`'s eight `Try "…"` templates, seeded from a git harvest of recently modified files (`xNb`, including its unscoped re-run) filtered by `wNb`'s nine-regex denylist and selected by `INb`'s ramp-and-cap rule; rule 3 is the queue hint. Recorded deltas: the `Try` pick is process-scoped through an app ref rather than a lodash memo, and we increment `queuedCommandUpHintCount` — upstream never does, so its own `< 3` gate is dead |
| `?` shortcuts / help menu | ✅ | — | **C5** `ShortcutsOverlay.tsx` — a real bordered overlay listing the keymap, opened by `?` on a genuinely empty composer; the U7 footer hint line stays alongside it. **fixed 2026-07-31 (F0, t5, KB6):** this row was scored ✅ but the overlay closed on **any** key, and that same key also fired `ChatApp`'s global chords underneath it (e.g. `Ctrl-O` would both close the overlay and open the transcript pager in one keystroke) — the correction had this at 🟡. It now closes on Escape only and swallows every other key, matching upstream's `Help` context (which binds only `escape`); a sabotage-verified honesty-audit test pins this |
| Vim mode (`/vim`) | ❌ | LOW | owner-deferred (the sprint's only deferral) |
| External editor (Ctrl-X Ctrl-E / Ctrl-G → `$EDITOR`) | ✅ | — | **W1** `externalEditor.ts` — spawnSync terminal handoff (raw mode released/restored), null-safe (editor failure keeps the buffer), popups cleared on applied edit. **F5 (t2 + tty-fix):** `CM8` shipped — while the editor holds the terminal the input row is replaced by upstream's italic dim `Save and close editor to continue...` (the two rules survive, as `...t_` does upstream) and the keymap provider stops reading fd 0 for the flight. The t2 awaited-spawn form proved fatal on a real TTY (the child leaves the shared tty OFD blocking; a re-armed watcher's `read()` freezes the loop before SIGCHLD — see the F5 open-gaps entry) and was reverted to upstream's `spawnSync` shape with paint-then-block, plus a `restoreTtyNonblock` fcntl repair after every handoff that upstream lacks. Live-verified: three vi round trips, buffer applied, app alive after |
| Ctrl-Z (suspend to shell) | ✅ | — | **fixed 2026-07-31 (F0, t6, KB3/KB5):** new row — previously `Ctrl-Z` detached this client (a divergence with no upstream equivalent, undocumented as a row). It now suspends the whole process group to the shell on `SIGTSTP` and resumes on `SIGCONT`/`fg`, matching upstream's own reserved `Ctrl-Z` exactly, including targeting the process group (not just our own pid) and restoring raw mode past Ink's ref-counted `setRawMode` (`suspend.ts`, read from upstream's own `handleSuspend` at `cli.pretty.js:177985`). Detach moved to `/detach` — see Recorded additions |
| Image paste (Ctrl-V) | ❌ | pending P87 | **F0 correction:** was scored `🚫` "non-terminal / out of scope" — **the rationale was wrong**. Upstream's `ctrl+v` reads the system clipboard, which is terminal-native; whether the SDK surface lets us reach it is an open probe (P87: image content blocks), not an out-of-scope call. Reclassified `🚫` → `❌`-pending-P87, which brings it into the denominator |
| Keybinding table (`ST5`) | ✅ | — | **shipped 2026-08-04 (F2).** `src/tui/keys/bindings.ts` is the single declarative source of truth: upstream's 20 context names, a closed 55-action vocabulary, 136 default entries across the 12 contexts that carry any (97 bindings + 39 explicit unbinds), and a reserved-key registry — with `null` entries stating declaratively which globals a surface kills, which is what the old imperative owner gate did by hand. Every `useInput` callback in `src/tui/` is gone (the F0 row's "17 ad-hoc callbacks" count is now zero) |
| Keybinding precedence model (`ST6`) | ✅ | — | **shipped 2026-08-04 (F2).** `keys/resolver.ts` + `keys/KeymapProvider.tsx`: one raw-stdin root consumer with our own keypress parser (P86 measured that Ink's `useInput` cannot express the table — it projects every key onto 14 booleans and throws `keypress.name` away), an ordered context stack each mounted surface pushes onto, first-match-wins with `null` consuming the key as explicitly unbound, plus `swallowAll` and preemptive scopes above the chain. The double-fire bug class it exists to remove is now structurally impossible rather than hand-gated |
| User keybindings (`~/.claude/keybindings.json`) | ✅ | — | **shipped 2026-08-04 (F2, `06 K5`).** Upstream's own path and file shape, so an existing Claude Code keymap applies to `ccx` unchanged: additive merge over the defaults, later-wins within a context, `null` unbinds, live reload on save (no restart), and typed validation (`parse_error`/`invalid_context`/`invalid_action`/`duplicate`/`reserved`, plus our own binding-keeping `suspicious_key` warning) reported into the transcript. `command:<name>` bindings run a slash command, Chat-context only (`06 K6`) |
| Generic chords, 1 s inter-key window (`KB22`) | ✅ | — | **shipped 2026-08-04 (F2, `06 K4`).** Any binding may be a space-separated sequence; the pending prefix is armed by the table rather than hardcoded, `escape` cancels, and the key that breaks a pending chord is swallowed (upstream `Q4u`). Replaces the two bespoke `useRef` timestamp chords with their 2 s window |
| Hint strings generated from the live binding | 🟡 | — | **F2, partial and disclosed.** The composer footer ladder, the status-bar mode chip and the whole `?` shortcuts grid derive their chords from the live table, so a rebinding moves them and an unbind prints `(unbound)`. **F4 (t10b) update:** the `(ctrl+o to expand)` fold marker is no longer a literal — nine transcript sites now read the live lookup through `ProjectionContext`, so a rebind moves every fold marker, group row and search sentence, and an unbound `app:toggleTranscript` removes the clause entirely. **Two** surfaces still print literals: the transcript-pager footer (a multi-alias ladder a generated string would render worse than the hand-written one) and the history-search footer (excluded on cost). ChatApp's two double-press notices are literal too and are outside the derivation guard's grep set. Still 🟡 for those. **F5 (t7/t10b):** `CM56`'s `search history` hint is derived too — a rebind moves it and it never prints a literal `ctrl+r`. See §1a |
| Composer visual form (`CM1`/`CM2`/`CM4`/`CM5`) | ✅ | — | **new row, shipped 2026-08-05 (F5 t2/t7).** `composerFrame.tsx`: two hand-painted full-width `─` rules and no verticals or corners (upstream's border object turns `borderLeft`/`borderRight` off, L496235); `❯`+NBSP — U+276F, not the U+203A we used to draw — swapping to `!`+NBSP in `bashBorder` for bash mode and dimming in every mode while a turn runs; the placeholder's first character drawn **inverted**, which IS the cursor; and `CM4`'s `History n/total` spliced into the top rule through `$Bu`'s three-lead-dash arithmetic and its clamp, disappearing the moment the recalled entry is edited. `CM6` (focus-loss cursor) and `CM7` (fullscreen viewport) are recorded unreachable, 🚫 |
| Readline tail: `ctrl+f`/`ctrl+h`/`ctrl+n`/`ctrl+p`, `alt+d` (`CM12`) | 🟡 | — | **new row, F5 t1.** Five of upstream's six ship, transcribed from its own ctrl/meta maps (L395676): `ctrl+f` right, `ctrl+h` delete-token-or-backspace (so it deletes a whole chip, like backspace), `ctrl+n`/`ctrl+p` as history next/prev — which also drive popup selection, because they call the same bodies the arrows do — and `alt+d` delete-word-after, which deliberately does NOT feed the kill ring. 🟡 for the sixth: **`ctrl+b` is dead in the composer**, claimed by our `task:background` binding in the `Global` context. The handler exists behind it, and a user cannot rebind their way to it |
| Suggestion popup geometry (`CM30`) | 🟡 | — | **new row, F5 t10.** `DXe` transcribed: height `max(1, min(max(6, ⌊rows/2⌋), rows-3))` blank-padded to a fixed size so the composer above it cannot jump, a mid-anchored scroll window, `a0H`'s two-line rows when a description overflows, the name column capped at 40 % of width, `suggestion`-coloured selection over dim rows (no inverse), and `bLt`'s middle-elide that keeps a path's basename. 🟡 for `X4t`: upstream highlights the matched query substring inside a row and we do not — ticketed |
| Inline reverse-i-search (`CM58`) | ✅ | — | **new row, F5 t12.** `ctrl+r` opens upstream's own inline surface inside the composer (it picks inline vs. picker by layout, and ours is permanently classic): `search prompts:` / `no matching prompt:`, a last-occurrence substring walk with a per-walk display dedup, the draft parked on open and restored on an emptied query or a cancel, Esc **accepts**, Enter executes. Recorded deltas: the corpus is deduped and capped at 100 by the shared reader, `ctrl+s` is inert (upstream registers no `cycleScope` here), forward-Delete acts as backspace, and prompts submitted before F5 are not in the log at all |
| History picker preview pane (`CM59`) | ✅ | — | **new row, F5 t12.** The picker gains upstream's preview: a `round`, dim-bordered box of six content lines with blank lines dropped after wrapping, the `… +N lines` tail (pluralised — the plan's `+N more` was wrong), and the responsive switch to a side-by-side layout at ≥100 columns with `qGf`'s own width arithmetic. Reachable through **`/history`**, a recorded ccx addition — upstream needs no such command because fullscreen hands it the picker |
| Autocomplete row anatomy (`DG55`) | ✅ | — | **new row, F6 t12.** `S_a`'s row is five lanes, not two: `[source] [name, highlighted] [tag] [kind lane, 7 cols] [description]`. The **kind lane** ships — `ZLb`'s 123-name bucket table copied whole and diffed programmatically, `commandKind()`, the lane's colour keyed off the *label* rather than the kind (which is why `info`/`action` can never be coloured), and the three row-level width sums that move with it (`SsI`'s 40 % name cap, `Nzo`'s wrapped-line indent, `a0H`'s description budget losing exactly 7). It is **flag-gated off by default, exactly as upstream's is**: `VJa` spreads the lane on `CLAUDE_CODE_ENABLE_MENU_KIND_LANES \|\| tengu_mint_lanes`, and the installed 2.1.220's `~/.claude.json` caches that gate `false`, so the build this file is measured against shows no lane either. The `tag` and `source` lanes are recorded **unreachable** — neither field exists on our `CommandEntry` — and stay named zeros in the sums. Recorded divergence: `commandKind` asks the table before the catalog proxy, which mis-buckets a user skill sharing a `ZLb` name (observed: this repo's `schedule` skill) but avoids painting all ten of upstream's own client-side controls as `skill` |


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
| K10 | `ctrl+b`/`ctrl+f`/`ctrl+h` in the composer | **F5 t1:** `ctrl+f` (right) and `ctrl+h` (delete-token-or-backspace, so it eats a whole paste chip) now ship in the editor's ctrl map. `ctrl+b` is still ours for background — the `moveLeft` branch exists behind a `Global` binding that always wins, and a user cannot rebind their way to it | 🟡 |
| K11 | `ctrl+n`/`ctrl+p` as composer history | **F5 t1:** both bound in the composer fallback, calling the same bodies the arrows do — so popup selection and the queue drain come along with them, exactly as upstream's `["n", () => Re()]` / `["p", () => he()]` do | ✅ |
| K12 | `alt+d` delete-word-after | **F5 t1:** bound, and deliberately does NOT feed the kill ring (upstream's `deleteWordAfter` is a plain `modifyText`, unlike `ctrl+k`/`u`/`w`). Recorded edge: at end-of-line it eats only the newline, inherited from `wordRight` | ✅ |
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
| K40 | `shift+enter` newline via `/terminal-setup` | **F5 t2:** the receiving half ships — the parser already singles out the `ESC CR` form and the editor now inserts a newline on it, so a terminal configured by upstream's own `/terminal-setup` (or one speaking CSI-u) works, and rung 1 of the `Z_a` hint is honest where it fires. We still ship no installer, and plain `shift+enter` remains byte-identical to Enter | 🟡 |

**Ledger score, post-F5 (2026-08-05): 20✅ + 3🟡 of 31 non-🚫 rows ≈ 69%** (was 18✅ + 1🟡 ≈ 60% at F2).
Four rows moved, all in F5 task 1–2: `K11` and `K12` ❌→✅, `K10` ❌→🟡 (two of its three keys), `K40` ❌→🟡
(the receiving half without the installer). The nine 🚫 rows are surfaces `ccx` does not have or bindings
upstream itself never wired.

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
- **The permissions dialog's top level gained the full `Settings` key families** (and the
  add-directory confirm menu embedded under it) — final-fix wave: dispatching on the semantic
  actions replaced branches that tested the physical defaults alone, so `space` now takes the
  highlighted row alongside Enter (`select:accept` binds both), and `j`/`k`/`ctrl+n`/`ctrl+p`
  now navigate alongside the arrows (`select:next`/`select:previous` bind all six) — the
  final-fix re-review caught that the original disclosure named only Space. Consistent with
  `SettingsDialog`'s existing behavior for every one of these keys; nothing destructive is one
  keypress away (every delete/remove still opens its own Enter-gated prompt).
  Residual, recorded as a decision: the permissions dialog's six SUB-views deliberately stay
  physical-key — widening accept to Space there WOULD put a rule delete one stray Space away — so
  a user rebind is inert inside them (component header records the reasoning).

### Hint derivation — generated, and the remaining exceptions (three at F2, two after F4)

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
- ~~**`toolRenderer.ts`'s `(ctrl+o to expand)` fold marker**~~ — **RETIRED by F4 (Task 10b).** The
  exception's own text predicted the fix: the hint is now threaded through `ProjectionContext` from
  `useChat`, which reads the LIVE lookup (user `keybindings.json` layers included) and puts the resolved
  string in the projection cache key. **Nine** sites that typed the literal — fold markers, group rows, the
  search sentence, the compact-summary hint, the long-output marker among them — now name whatever
  `app:toggleTranscript` is actually bound to, and an unbound action produces no clause at all rather than
  advertising a dead key. `EXPAND_HINT_FALLBACK` is the one surviving literal, used only when no provider
  is mounted. So of the exceptions listed here, **two remain** (the two footers), not three.
- **ChatApp's two double-press notices** (`Press Ctrl-C again to exit`, `Press Esc again to rewind`)
  are still literal too, and ChatApp is not in the derivation guard's grep set — recorded here (t10
  re-review) so the exception is a decision, not an unnoticed gap.

That caveat is CLOSED as of the final whole-branch review. The composer's double-press arm hints
(`Esc again to clear`, `Press Ctrl-D again to exit`) followed the user's keymap from t10, but the
handlers behind `chat:cancel`, `chat:clearInput` and `app:exit` still re-derived from physical key
flags, so a full rebind printed a correct hint beside a dead key. All three have their own action
registrations now, the way `chat:cycleMode` got one in t10-fix: the Esc-Esc clear arm and the Ctrl-D
EOF arm were lifted out of `handleKey` into `cancel()` / `exitArm()` unchanged, and `chat:clearInput`
re-enters the key path on the ctrl+l event its own editor branch is written for. Default behavior is
byte-identical (`escape.test.tsx` and `components.test.tsx` pass unmodified); the rebound halves are
pinned by `keys-migration-root.test.tsx` (k)–(k4). Two re-derivations remain deliberately: the `?`
that opens the shortcuts overlay is a CHARACTER no context binds (the rebindable `help:show` is
ChatApp's own registration), and the three dialogs' text-entry / modal-prompt phases, where a rebound
printable key must type itself (each dialog's header records the line).

The editor's own keys (`⏎`, `\⏎`, the readline set, `Ctrl-_`, `Ctrl-S`, the `!`/`#`/`@`/`/` prefixes)
are literal by design: `editor.ts` is the keymap's FALLBACK and no context binds them, so there is no
live binding to derive. `test/tui/honesty.test.tsx` pins every one of them to an executable proof.

## 2 — Transcript / message rendering

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| User prompt echo | ✅ | — | **F4 (t8) — the F0 correction is CLOSED and retired.** `render.ts` `userEchoLines` is THE single prompt renderer: the `❯ ` pointer (`Ge.pointer` U+276F, L104968) in `subtle` on a full-width `userMessageBackground` band (`Mqo` L426143 wrapping `xqo` L426067), every later row indented two columns under it, and the 10 000-char fold (`tWp`/`Rqo`/`rWp` L426183) with its `(N lines hidden)` rule — subtle dashes, dim title (`Sg` L183972/L183981). The live echo, the replayed one, the slash-command echo and the queued list all route through it, so the three surfaces that used to hand-roll `› ` cannot drift. The `⋯ queued:` invention is dead. Recorded delta: a live echo bakes at the width of the moment and does not re-flow on resize (divergence table). Evidence `test/tui/render.test.ts`, `test/tui/f4-acceptance.test.tsx` § acceptance #5 (the fold driven through `useChat.submit`) |
| Assistant message identity (`⏺`/`●` bullet) | ✅ | — | **F4 (t8) — the F0 correction is CLOSED and retired.** Both divergences it named are fixed: the glyph is per-platform (`Za = Pt() === "macos" ? "⏺" : "●"`, L41484 — the darwin build constant-folds to `⏺`, so the port is the switch, not the artifact) and it rides the plain `text` token, not an accent (`VAr` L422851). `platform` reaches the renderer through `renderMessage`'s options and is part of the projection cache key, so one document projected on two platforms cannot serve one answer. Evidence `test/tui/identity.test.tsx`, `test/tui/f4-acceptance.test.tsx` § acceptance #1 |
| Thinking blocks | ✅ | — | **F4 (t9) — the F0 correction is CLOSED and retired.** Thinking is **invisible by default**: `Gha`'s guard (L429455) returns null unless transcript-mode or verbose, so F1's always-visible dim lines are gone. The detail form is `zAr` (L422947–422969) — a `minWidth: 2` gutter carrying a dim+italic `∴` (`q3r` U+2234) beside a `<Markdown dimColor>` body, one gutter per block. The streaming placeholder is the other glyph, `✻ Thinking…` (`e8o` L422457, U+273B + U+2026), and a `redacted_thinking` block renders it too (L429450). F3's `Thought for Ns` clause on the fold run is untouched. Recorded delta: we keep the `✻` placeholder where the collapsed live region shows it, and upstream shows nothing there (divergence table). Evidence `test/tui/thinking.test.tsx`, `test/tui/f4-acceptance.test.tsx` § acceptance #4 |
| Tool-use rows | ✅ | — | **C5** `render.ts` `toolUseLines`, then **F1** `toolRenderer.tsx`. **F0 correction (`ST1`) now CLOSED by F1, scored here for the first time:** the live/replay split that made this 🟡 is gone — one retained transcript document and one projection serve live, replay, attach, resume, rewind and the ctrl+o pager, so both paths render the identical bolded `⏺ Read(src/app.ts)` form with parens and an OSC-8 target. Evidence `test/tui/f1-frame-parity.test.tsx` + `test/tui/toolRenderer.test.tsx -t "bold name-only segments"` (which also pins the single sibling gutter). *This movement is F1's credit, not F3's — see the split arithmetic under the F3 recount* |
| Tool result tree glyph (`⎿`) | ✅ | — | **U3**, corrected by **F1**. **F0 correction now CLOSED by F1, scored here for the first time:** `RenderItemView` is the sole owner of the connector and emits it exactly **once** per result in a fixed five-column sibling box, with the body in the sibling flex column — never prefixed per line. Evidence `test/tui/toolRenderer.test.tsx -t "one sibling gutter"` / `-t "places the one gutter in a five-column sibling"`. *F1's credit, not F3's* |
| Markdown: block grammar (headings, lists, task lists, blockquote, `hr`, spacing) | ✅ | — | **F4 (t2) — the F0 correction is CLOSED and retired.** The line-oriented regex renderer is gone; `markdown.ts` is a `marked` TOKEN WALKER transcribing the bundle's `f2` node switch (L420590–420711) and `Oaa`'s three-way chunking (L421134–421157). Every one of the eight gaps the F0 note listed now ships: nested lists at `"  ".repeat(depth)`, ordered lists honouring `start` with `JhH`'s depth numbering (arabic → letters → roman → arabic, at the CHILD's depth — the wave's first bundle-beats-plan correction, L420647→420650→420665), literal `[x] `/`[ ] ` task boxes, the dim `▎ ` blockquote rail with italic content, the `---` rule, depth-varying heading style (h1 bold+italic+underline), and block separation that falls out of the walk (`gap: 1` at chunk boundaries only, `space` tokens inside). Two recorded deltas, both non-reproduction of an upstream *artifact*: the `hr` closes its line where the bundle glues the next block onto it, and a deep-nest ragged first-item indent is smoothed (divergence table). Evidence `test/tui/markdown.test.ts` (24), `test/tui/f4-acceptance.test.tsx` § acceptance #1 |
| Markdown: inline mixed bold/italic spans | ✅ | — | **U11**, rebuilt by **F4 (t2/t3)**: `markdownInline.ts` is a recursive walker over `marked`'s inline tokens where style flows down by spreading, so `**bold *both***` yields ONE segment carrying bold AND italic — a nesting the old regex renderer could not express at all. A codespan takes the `permission` theme token (`TR15`; `permission` and `suggestion` are byte-identical in all four shipped themes, so the change is satisfied-by-value and no test can observe it — plan-review finding 12) |
| Markdown: links, images, strikethrough + terminal-capability gates | 🟡 | — | **F4 (t3) — new row, no prior row existed.** Links render as real OSC-8 hyperlinks (`ZF` L393098) when the terminal supports them and as `text (url)` when it does not, with the `mailto:` collapse, the `file://` normalisation (`jhH` L420707) and the url-equals-label collapse. Images take all three upstream forms (`alt (href)`, bare href, title-carrying — pack §1.9 L420619–420624). `del` marks its children through the `dHn` allowlist (L420498–420509) ported verbatim, force-override ahead of the Apple_Terminal / `TERM=linux` exclusions included. 🟡 for two named items: the link **title suffix is coloured** where upstream's is not, and upstream's render condition is `dHn() && vt.level > 0` — the second term is chalk's colour level, which does not exist at our style-as-data layer, so only `dHn` is ported. The `⧉` artifact arm is **not ported and unreachable** (divergence table). Evidence `test/tui/markdown-links-code.test.ts` |
| Markdown: tables | ✅ | — | **F4 (t4) — the F0 correction is CLOSED and retired.** `mdTable.ts` is a transcription of `IBp` (L420907): a box-drawing grid, per-column alignment with a force-CENTRED header (`bWo` L420839, biasing left), three-way width fitting (natural → slack-over-deficits → hard scale), a `middle` rule between **every** pair of data rows, the 200-row cap with its `toLocaleString`'d overflow note (`AWo` L420897), and `kaa`'s vertical record fallback on both triggers. Three bundle corrections landed with it, all confirmed: borders are NOT dim, tables are deliberately EXEMPT from ambient markdown dim (`Oaa` hands `dimColor` to prose and blockquote but not to `TWo`), and a nested row KEEPS its closing pipe. Width is measured in display columns via `string-width` — `Ut` = `Bun.stringWidth(s, {ambiguousIsNarrow:true})` exactly, so CJK measures 2. Evidence `test/tui/mdTable.test.ts`, `test/tui/f4-acceptance.test.tsx` § acceptance #2 |
| Markdown: code-block syntax highlight | 🟡 | — | **DOWNGRADED by F4 (t3), and the downgrade is the point.** The C5 ✅ was scored before anyone counted what upstream highlights. F4 fixed the *form*: fenced code is flush-left with no border, no line numbers and no cap (`f2`'s `code` case, L420597–420602); the label-polarity rule ships verbatim (a dim raw-lang line appears exactly when the FULL lang string is outside hljs's registry, so ` ```rust ` draws no label); `UPSTREAM_LANGS` is the real 383-name registry ∪ alias set lifted from L418473/L222493; and the colours are upstream's own flat `DhH` scopes rather than our theme's. What did **not** change: `KNOWN_LANGS` is 10 languages, so **~373 languages upstream colours render PLAIN here** — the largest remaining fenced-code gap, sized in the divergence table. `syntaxHighlightingDisabled` is unbuilt (same table) |
| Edit/Write diff — header, bands, word diff, wrapping | ✅ | — | **F4 (t7) — the F0 correction is CLOSED and retired.** All five gaps it named are closed. The header is `fbn` (L423885–423902): `Added 3 lines, removed 1 line`, clauses joined by the literal `", "`, counts bolded as their own spans, `> 1` pluralization, and POSITIONAL capitalization of `removed` (L423894). The body is `H2p` (L419987–420003): a full-width **background band** per row (not a foreground colour), a right-aligned number cell then one space then the marker, Ink `wrap` at `width - gutter - 3`, and the forced `text` foreground on every span. Word diff is `lhH` (L419944) with `shH`'s k-th-to-k-th run pairing (L419906) and the `ohH = 0.4` bail; it wraps one column wider than the plain path, as upstream's own arithmetic does. `chH`'s remove-run rewind puts a paired remove/add block on the same numbers. **The 24-row cap is gone** — upstream caps nothing. Evidence `test/tui/diffRender.test.ts`, `test/tui/f4-acceptance.test.tsx` § acceptance #3 |
| Diff line numbering — the source ladder | ✅ | — | **F4 (t6) — new row, no prior row existed.** The number over a diff row is only as good as its source, so `diffSource.ts` is an explicit three-rung ladder: (1) a shape-recognized `tool_use_result.structuredPatch` is taken verbatim and the disk is **never** read — a re-read would observe state newer than the completed edit it is numbering (pinned with a throwing reader); (2) a flat-only Edit is diffed locally with `structuredPatch` at 3 lines of context and anchored against disk **only** when the pre-edit snippet still sits there exactly once; (3) anything else is not diffable. Positions are all-or-nothing per patch. When rung 2 cannot prove an anchor the patch says so, and the renderer prefixes the gutter with `~` — a recorded invention, since upstream has no approximate mode to copy (divergence table). New capability over F3: a flat-only Edit now renders a header and a body where it used to emit no row at all. Evidence `test/tui/diffSource.test.ts`, `test/tui/f4-acceptance.test.tsx` § acceptance #3 (both rungs, matching and mismatching disk) |
| Syntax-highlighted diff bodies (`lre` → `R2p`) | ❌ | — | **F4 (t7) — new row, no prior row existed.** Upstream runs a diff body's code through the highlighter before falling back to the plain band renderer (`H2p`); the constants pack omitted that branch and the gap surfaced only in Task 7's review. We render diff bodies plain. Adjacent to the fenced-code gap above and bounded by the same 10-language highlighter |
| Bash output rendering | 🟡 | MED | **C5**: error framing (`render.ts` `resultLines`). **P94 correction, confirmed on 0.3.220:** some Bash calls carry structured stdout/stderr/interrupted/noOutputExpected/isImage and optional `returnCodeInterpretation`, while most remain flat-only. No numeric exit code appeared, so `$`/exit-code framing remains unreachable and the row stays 🟡. **F4 (t10b) update:** a `<bash-stdout>` species now folds through the shared `foldToolOutput` 3-row + expand-hint form (`p2`/`y_s`) — the fold is real upstream for bash output *only* — and a `<local-command-stdout>` renders as **markdown** (`km` L421121), not as plain lines |
| Typed result summary rows (`LT1`) | 🟡 | — | **F3 — new row, no prior row existed.** Upstream never dumps a tool's raw output into the default transcript: every recognized tool gets a one-line typed summary in the `⎿` gutter (`Read 340 lines`, `Found 3 files`, `Added 2 lines, removed 3 lines`, `Wrote 42 lines`, …). `toolSummaries.ts` ships **19 templates**, sidecar-first with an honest input/flat fallback, routed identically in both projections (`toolSummaries.test.ts`, `toolRenderer.test.tsx`). Named remaining gaps keep it 🟡: Write's `condensed`/scratchpad/plan variants and Edit's `previewHint`/`collapsed` forms are **not built** (they need state we do not model), `TaskStop`'s 160-char clip counts code units where upstream counts display width, `Bash`'s timeout is sourced from the call input rather than upstream's progress message, and **8 tools' sidecar shapes were bundle-read, not live-observed** (they fail closed to the fallback; an honest closure would be a probe that selects them) |
| Write create preview (`LT18`) | ✅ | — | **F3 — new row, no prior row existed.** A `Write` that creates a file previews its **first 10 lines**, syntax-highlighted, followed by a bare `… +N lines` marker with no expand affordance — and the preview renders **alone**, with no count header above it (upstream `jme` L423783, `C8o = 10`; census 01#58–62). `Wrote N lines` survives only as the fallback when no content is available anywhere. An unknown extension renders **plain**, not dim — the rows *are* the content. Evidence `test/tui/toolSummaries.test.ts` § "the Write create preview" |
| Subagent (Agent) unit — progress rows + `Done (…)` (`LT16`/`LT17`) | 🟡 | — | **F3 — new row; supersedes F1's recorded deferral of nested `parent_tool_use_id` rows.** A running `Agent` shows dim `Initializing…`, then its **last three** inner tool rows plus a dim `… +N tool uses (ctrl+o to expand)` marker (upstream `zVp = 3`); ctrl+o expands to the full nested list. Completion is a `⎿` **gutter** row with the bullet suppressed (bundle `Vha` 429640 — census 01#153 was wrong and was corrected in this wave) carrying `Done (7 tool uses · 24.1k tokens · 1m 12s)` from a three-rung honesty ladder: sidecar → `task_notification` → derived-from-children. Evidence `test/tui/agentProgress.test.ts`, `toolRenderer.test.tsx` § "F3 Task 7". 🟡 for five named divergences listed in the F3 divergence table below (derived totals omit the token clause rather than fabricate one; Backgrounded→Done upgrade; detail ordering; running-branch transcript-mode row set; no short-terminal `In-progress` fallback) |
| Grouped Agent batches (`LT3`) | 🟡 | — | **F3 — new row, no prior row existed.** Same-name `Agent` calls dispatched in **one API message** render as one unit — `Running 3 agents…` / `3 agents finished` — keyed on the API `message.id` (the engine emits one wire frame per content block, so a `callSequence` key would never have fired; the split-frame case is live-proven, `apiMessageIds=msg_011CdggL8MApN9DTU7LQgH1n`, `callSequences=2,4`). Publishes only when every member has a result; verbose never groups. Evidence `toolRenderer.test.tsx` § "F3 Task 8" + `test/live/f3-live-turn.e2e.test.ts`. 🟡: upstream's `hideType` suppression when a member's name is a teammate name is not modelled |
| Bash background hint (`LT20`) | 🟡 | — | **F3 — new row, no prior row existed.** A running foreground `Bash` grows a dim `(ctrl+b to run in background)` line at a five-column indent, gated on that call's own `task_started` frame (upstream registers the task and starts the hint timer in the same statement), never on `run_in_background: true`, with the chord derived from the **live** keymap (tmux doubling only when the resolved chord is still `ctrl+b`; unbound → no hint). Evidence `toolRenderer.test.tsx` § "F3 Task 9", `test/tui/keys-hints.test.ts`. 🟡: upstream renders the same hint under a running **synchronous Agent** too (bundle 281153); ours is Bash-only |
| Long-output truncation + expand | 🟡 | **MED (structural)** | we cap; no interactive expand. **F0 correction:** the LOW priority was wrong — `(ctrl+o to expand)` is one mechanism that also drives collapsed groups, verbose diffs and expanded thinking; this is `ST2`, a structural gap, not a tail item |
| Compact boundary marker | ✅ | — | **F4 (t10b) — the F0 correction is CLOSED and retired.** Our invented `─── context compacted ───` rule is replaced by upstream's form: a bulleted `⏺` row carrying a bold `Compact summary` plus the dim expand hint, suppressed in the detail projection exactly as upstream suppresses it. The message count the F0 note also asked for is **unreachable** — P81 read the live `compact_boundary` frame key by key and neither `summarizeMetadata` nor the transcript-mode summary body is on it (unreachable table below), so the row is scored on what the wire can actually support |
| User-frame sentinel router (`ERe`'s 15 exits) | 🟡 | — | **F4 (t10a) — new row, no prior row existed.** A `user` frame on our wire is very often not a prompt: it is a slash-command echo, local-command stdout, an interrupt sentinel, a background-task notification or an MCP resource push wearing a user frame. `species.ts` is upstream's one decision point (`ERe` L426424–426532) ported: 12 of its 15 exits plus the fallthrough, with the tag constants verbatim from L17765 and `sessions/rows.ts` importing its regexes back rather than keeping a second copy. Both the live path and the disk replay route through it, so a sentinel can no longer be band-wrapped as a prompt the human never typed. It also closed F1's recorded deferral: a **string-form** `message.content` (5.8% of user rows across a 60-file sample; 77 replayed disk prompts) used to render NOTHING and now shows. 🟡 for two reasons, both honest: three exits are **recorded unreachable** (table below), and the `<mcp-resource-update>`/`<mcp-polling-update>` route is **implemented but UNVERIFIED** — all five tag sites in 2.1.220 are readers and the artifact contains no writer, so its form is bundle-pinned and has never been observed. It is not counted as observed parity. **Wave T (t9) note, no score change:** upstream's interrupt substitution (`zWo` L422222-25) fires on **three** sentinels and ccx recognised two; the third (`The user doesn't want to take this action right now. STOP…`, L429122) now routes to the same `Interrupted · What should Claude do instead?` row, arriving as **tool-result content** rather than as an `ERe` exit, so it is matched in `toolResult.ts` and not here. The match is `startsWith`, and that is load-bearing rather than defensive: upstream's `Mpt` (L373032) appends a statsig-gated suffix to the sentinel, so `===` genuinely breaks when the flag is on — its two siblings stay exact-equality. F3's deliberate suppression of the **tool form** is preserved (`species.ts:258-260`), which means ccx paints the interrupt line **once** where upstream paints it twice on Esc-during-tool; that count is a chosen divergence (W-T19), recorded in the Wave T section below. This row's own 🟡 arms are untouched |
| Error sentinels (`VAr`) | 🟡 | — | **F4 (t10b) — new row, no prior row existed.** The eleven `VAr` cases plus two default predicates and the 1000-char truncation, literals byte-verified against L157931, with `is_api_error_message` as the trust bit. 🟡 because only default-predicate 1 (`Prompt is too long`) is runtime-proven (P80); the other nine are static reads of the same-channel producer chain, and one deliberate deviation ships: upstream's `height: 1` **clips** five arms in every view, and we **wrap** — at 80 columns only the credit-balance arm diverges, where upstream's clip deletes its own billing URL (divergence table) |
| System notices (`dVo`) | 🟡 | — | **F4 (t10b) — new row, no prior row existed.** The generic `⏺` fallback wrapping at `width - 10`, `api_error → null`, blanket suppression of `info`, and an empty-content frame rendering an empty bulleted row. 🟡 because nine `dVo` branches have subtypes that are **absent from `sdk.d.ts`'s system union** and the structured frames fall out of the generic exit by construction (unreachable table), and because the route itself has not been observed live — a keyed run provoking an informational frame would close that |
| Teammate attribution | 🟡 | — | **F4 (t10c) — new row, no prior row existed.** A teammate message gets a nested detail branch: `@name❯` in a per-agent colour at `paddingLeft: 2`, collapsing to `› N messages from @name` at pager detail-collapsed (singular `Message` pinned, L425483) and expanding at detail-all; the compact projection deliberately stays empty, since F3's agent-progress rows are the compact surface. The eight `*_FOR_SUBAGENTS_ONLY` colour tokens were re-derived from the bundle's six theme blocks (L156475) after the constants pack proved wrong about them, and all 32 values are byte-verified. 🟡 for three named items: the **colour assignment is our invention** (upstream carries the colour on the message via the agent definition, defaulting to cyan — we assign by dispatch order), the lifecycle rows are gated on NAMED subagents (our reachability choice, not a port), and a batch member gets no lifecycle row at detail-collapsed (divergence table) |
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
| API-retry / stalled indicator (`qyn`) | 🟡 | — | **Wave T (t12/t13/t13-fix) — new row, no prior row existed.** QA watched a motionless spinner for 72 seconds during an outage with no sign anything was wrong. Upstream never shows that: `qyn` (L407975-408035, mounted at L407973) takes the whole indicator slot the moment a retry status exists, and ccx now does the same — `state.retryStatus ? <RetryRow/> : <TurnSpinner/>` at ChatApp's single mount, never two rows side by side. Both variants are verbatim (`✻ Waiting for API response · check your network`, L407992/L407997; `✻ <label> · Retrying in <dur> · attempt n/max`, L408007), `✻` is `i5` (L41482) held still in the `error` colour, the duration is `ra`'s formatting and the countdown re-derives per tick from a deadline seeded off the wire's own `retry_delay_ms`. The frames were already arriving unrecognised — probe 96 measured the ladder (563 ms → 39 s over ten attempts, ~190 s to exhaustion) — so this is a recognition-and-render change, not a wire change, and `species.ts` still paints **nothing** for `api_retry` so a ten-attempt ladder is one replaced spinner row rather than ten transcript notices. The stalled variant is client-owned and anchored to turn start, covering the ~75 s a blackholed endpoint burns before any frame exists. **Missing arm:** `ypo()`'s dim ` If it persists, check <status page>.` line under the row for overload-ish errors at `attempt >= min(3, maxRetries)` — reachable from `error_status` and not built. Recorded unreachable, excluded rather than approximated: the stalled row's ` · will retry in <dur>` clause (its deadline is the spawned CLI's own per-request abort timeout, `Kn`, which no frame reports) and the rate-limit `<Type> reached` label branch (the frame carries no rate-limit metadata, so upstream's `b0p` disjunction reduces to the attempt count here). Upstream's tip-line suppression while retrying is moot — ccx has no tip line (§2's "Tip of the day" ❌). Evidence `test/tui/retry-row.test.tsx`, `test/unit/retry-status.test.ts` |
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
| Permission approval dialog | ✅ | — | **Wave T (t3/t5/t8/t17) — the F6 ✅ was scored ahead of its evidence, and the three defects it did not name are now closed.** With F6's registry in place a user could still press `Tab` then `Enter` on a No row with nothing typed and have the dialog **silently deny** (the row carried `allowEmptySubmitToCancel`, whose name is inverted from its effect); an empty feedback row stayed open after focus left it; and an empty amended row rendered a doubled space before the cursor. All three are fixed — the flag is dropped so an empty Enter routes to each body's own `onCancel` and merely collapses the row (`test/tui/small-permissions.test.tsx` "an EMPTY Enter … decides NOTHING"), focus auto-collapse transcribes `handleFocus` L505162-69, and `Select`'s separator drops its trailing space while a labelled input row is focused and empty so the row reads `No,`+cursor+placeholder (`select.test.tsx`, `bash-permission.test.tsx`). The create-file body also moved into `SM`'s dashed-rule box (see the F6 text below for what the row already had). **The score does not move — a ✅ row cannot rise — but the ✅ is only now earned.** Two Wave-T gaps live on their own rows rather than dragging this one: the consult footer (below) and the explain pane. **F6 (t4/t6/t7/t8) — every gap the F0 correction named is closed.** `permissionKind` transcribes upstream's own routing question (`Ksn` L279164) into six arms, and `PermissionDialog.tsx` is now a 50-line switchboard over them: `BashPermission` (`dZf` L505224) · `FilePermission` (`Cem` L505875) · `FetchPermission` (`ull` L506735) · `SkillPermission` (`oll` L506582) · `MonitorPermission` (`Ral` L506006) · `GenericPermission` (`Gal` L506118). Per-tool titles, question lines, **real inline diffs** through F4's renderer, the 16-pattern destructive table, symlink warnings and the session/prefix/domain persist rows all ship — and the in-memory `allow_always` `Set<toolName>` is gone: a persist row now echoes the engine's own `suggestions` entry back as `updatedPermissions` with `destination:"localSettings"`, which probe 81 proved lands in `.claude/settings.local.json` and suppresses the consult in a fresh process. `DG21` attribution is a frame-header suffix (`· from the <name> agent`), not a line above. The four registry kinds that still fall to the generic body have their own row below. The prior note read: **U9** numbered arrow-selectable Yes / Yes-don't-ask-again / No (↑↓·Enter·1/2/3·Esc; legacy a/A/d kept). **F0 correction:** upstream has **13 dialog kinds** behind a per-tool matcher; ours is one shape for all tools. Missing: per-tool titles, question lines, real inline diffs in the body, destructive-command warnings, symlink warnings, session/prefix/domain persist rows; our `allow_always` is an in-memory `Set<toolName>` that never persists and never emits `updatedPermissions`. **fixed 2026-07-31 (F0, t7, KB1):** `y`/`n` are now bound (`y`=accept once, `n`=reject) alongside the existing ↑↓·Enter·1/2/3·Esc and legacy a/A/d — upstream's two most reflexive confirmation keys were dead before this. The global composer status hint is hidden while the decision owns input, so Question/Plan surfaces do not advertise permission-only chords. |
| Consult footer (`escape / cancel · tab amend · ctrl+e explain`) | 🟡 | — | **Wave T (t4/t4-fix) — new row, no prior row existed**, and its absence is why the permission-dialog row above could carry a ✅ while a user had no way to learn that `Tab` amends a decision (qa3-05). Upstream's footer (L505286) is a `·`-joined dim row whose amend hint (`hintNode` L505188) renders **only** while the focused row is accept-or-reject **and not already in input mode** (`aZf` L505186), and whose explain verb flips `explain`↔`hide`. One shared `ConsultFooter` now mounts in the five footered bodies — Bash, File, Skill, Monitor, Generic — with that gating pinned (`test/tui/consult-footer.test.tsx`, 5 tests, plus a mount assertion in each body's suite). **Missing arm:** the `ctrl+e explain` hint is **never visible in the shipped binary**. The Bash body declares its explain transport as an optional, undefaulted prop and nothing in `src/` passes one (`BashPermission.tsx:68`; `PermissionDialog.tsx:43` constructs it without), so the hint is suppressed and the key falls through — upstream's Bash consult shows three hints where ours shows two. Two recorded deltas, neither a gap: ccx says `esc cancel` where upstream says `escape / cancel` (the five pre-existing footers and their tests already used the short form and this wave did not re-spell them), and `FetchPermission` stays **footerless** because upstream mounts a bare `jr` there with no `feedbackConfig` and no `esc cancel` either — its `(esc)` lives inside the No-row label (W-T18) |
| Bypass-permissions consent gate (`SAm`) | ✅ | — | **Wave T (t15/t15-fix) — new row, no prior row existed.** `ccx --permission-mode bypassPermissions` and `--dangerously-skip-permissions` used to enter the one mode that stops asking before it acts with **no warning at all** (qa3-14). Upstream's `SAm` (L554034-79) now ships: the `nr` frame in the `error` colour, the verbatim title `WARNING: Claude Code running in Bypass Permissions mode`, all three body paragraphs and the `code.claude.com/docs/en/security` link, **cancel rendered first and focused** (L554075), accept persisting the acceptance so it never asks again (`M8()` L43492), decline exiting **1** (L554056) and Escape exiting **0** (L554063-64). The gate keys on the **resolved** launch mode, so one check covers both flag spellings, and it covers `ccx --detachable` because that is the same REPL. Two ccx-side extensions ride the same dialog and are recorded as additions rather than parity: `/yolo` is gated too (upstream's gate is launch-only because upstream's ladder cannot reach bypass at all), and `ccx --bg` into bypass is **refused** without a prior interactive acceptance, transcribed from upstream's own `--bg` validator (L451420-21). Recorded deltas: the acceptance persists to ccx prefs, not `~/.claude/settings.json`; bare `y`/`n` are inert here where upstream's `Confirmation` scope binds `n` to the same 0 exit as Escape. **Open, and not scored against this row:** `ccx -p` into bypass stays ungated, matching upstream's own placement of the gate inside the interactive startup — see the Wave T open items. Evidence `test/tui/bypass-consent.test.tsx` (14), `test/unit/args-bypass.test.ts` |
| Bash permission shows full command | ✅ | — | **F6 (t4/t6).** The 140-character clip and the invented `$ ` prefix are gone. `dZf`'s body prints the command verbatim, the engine's `description` dim beneath it, and — between the command and `Do you want to proceed?` — the destructive-pattern warning in the `warning` role, from a 16-row table eval-compared against `lLu`/`cLu` (L154066) including its 10 000-character scan slice and first-match-wins order. Pinned end to end through the real `<ChatApp>` in `test/tui/f6-acceptance.test.tsx` § #1 |
| Model picker | 🟡 | — | **F6 (t11, `DG46`/`DG49`/`DG50`).** Four of the six gaps the F0 correction named are closed: `zAe`'s `Select model` header in `remember`, the default-for-new-sessions subtitle with its session-only override line, the `s` toggle (whose saved default is now **read back at boot** — it had no reader before), and the `… +N models` overflow counter over a 10-row window, unclamped exactly as `rva` is. **Missing arm:** the reasoning-effort axis (`DG48`) and the pricing/entitlement row metadata (`DG47`), both probe-gated (P88) F6 non-goals — and the two effort actions are deliberately **not declared** in `VALID_ACTIONS`, so a rebind cannot resolve to a handler that does not exist. Divergence: the saved default lands in ccx prefs, not `~/.claude/settings.json` |
| Resume session picker | 🟡 | — | **F6 (t11, `DG51`).** Four of the six gaps closed: the `Resume session (N of M)` header, a search field, `Space` preview (a 12-line tail) and `Ctrl+R` rename — the last two behind a new **preemptive** `SessionPicker` scope, because mount order made the inner `Select`'s `ctrl+r: null` eat the rename key. **Missing arm:** `Ctrl+A/B/W` scope toggles and the expandable fork-lineage groups; neither axis exists in our session store. Divergences: search is **modeless** (so digits reach the query, not a row) and rename is optimistic |
| Task/todo panel | ✅ | — | **F6 (t13, `DG56`–`DG59`).** All six gaps closed: `DG56`'s `**N** tasks (**M** done, …)` header with the in-progress clause gated on non-zero and its ` … +2 in progress` overflow; `DG57`'s `✔`/`◼`/`◻` with strikethrough-dim, bold and plain, and **no empty state**; `DG58`'s `(@name)` owner tag at ≥60 columns, the `› blocked by #12` line and the in-progress `activeForm` sub-line, each gated on the wire actually carrying its field (probe 81 Q3 — the model sends them only sometimes); `DG59`'s `showExpandedTodos` pref round trip. One recorded divergence: our default is **open** where upstream's is closed, because upstream's closed default is backed by spinner-side fallbacks we have not ported |
| Ctrl-T todo-panel toggle | ✅ | — | **W1** — 2.1.220 `app:toggleTodos` (default visible) |
| Transcript pager (Ctrl-O) | 🟡 | — | **W2** `TranscriptPager.tsx` + pure `pager.ts` — the bundle's 18-binding Transcript context (j/k · ctrl-u/d half · ctrl-b/f b/space page · g/G · arrows · q/Esc/ctrl-c exit), opens at bottom; bordered overlay, not alt-screen (see W2 divergences). **F0 correction:** scored against the wrong mechanism — upstream's `ctrl+o` is a **verbose-mode flip** (`ST2`) that changes what every renderer emits, not a scrollback pager. Both are useful features; they are not the same feature. `ST2` is the real row for upstream's mechanism (see §2's "Long-output truncation + expand") |
| History search (Ctrl-R) | ✅ | — | **W2** `HistorySearchOverlay.tsx` + pure `historySearch.ts` — incremental prompt search over session/project/everywhere scopes (Ctrl-S cycles, initial "everywhere"), substring-then-subsequence ranking, Esc/Tab accept into composer · Enter execute · Ctrl-C cancel — the bundle's HistorySearch context key for key |
| SettingsDialog (`/config`, `/settings`) | 🟡 | — | **W3** `SettingsDialog.tsx` — four tabs (Status·Config·Usage·Stats, wrapping tab/shift+tab/←→), Config tab live rows + `/` search + Esc-close change summary (`Set {label} to {value}`, bold value); but only **5 of upstream's ~54 Config rows** ship (Theme/Model/Output style/Default permission mode/Thinking mode — the ones this harness's engine can actually apply) and there is no header-focus mode, so upstream's `Settings dialog dismissed` string is unused (W3 divergence) |
| PermissionsDialog (`/permissions`, `/allowed-tools`) | ✅ | — | **W3** `PermissionsDialog.tsx` — all five upstream tabs (Recently denied/Allow/Ask/Deny/Workspace), provenance-aware rule rows, add-rule flow with the destination picker (project-local/project/user settings, verbatim upstream typo `Saved in at ~/.claude/settings.json` kept), delete confirm, a read-only panel for non-editable rules, workspace directory add/remove. Divergences: rules apply via the flag layer **and** get written to the chosen settings file (upstream's rule engine is CLI-internal, invisible to us) — functionally equivalent but no upstream shadowing warnings fire; the Recently-denied footer intentionally drops two dead key chords (W3 divergences) |
| ThemeDialog (`/theme`) | 🟡 | — | **W3** `theme.ts` (live-binding token set) + `ThemeDialog.tsx` — picker with the exact `demo.js` live diff preview, Esc-restore. **F0 correction:** it is exactly **7 built-in picker rows** (`auto` + 6 palettes) upstream ships, not "7+" — the two we lack are the **ANSI variants**, whose whole point is that the terminal owns the colours, so ship 5 of 7, not "5 of 7+". **The `auto`-equals-`dark` note's stated reason was wrong for the foreground REPL**: upstream's Tier 2 detection (`COLORFGBG` env read) works today with no extra work, and Tier 1 (OSC 11) needs raw stdin plus a stdout write — both of which the foreground REPL already owns. The constraint is real only for the daemon path; the gap here is smaller than the old note claimed. A theme still recolors NEW output only — Ink's `<Static>` scrollback keeps whatever colors it was written with (unchanged, genuine `<Static>` constraint) |
| AddDirDialog (`/add-dir`) | ✅ | — | **W3** `AddDirDialog.tsx` + `addDir.ts` — verbatim 2.1.220 validation copy (not-found / not-a-directory / already-added variants) and confirm dialog (session-only / remember-to-local-settings / cancel); grants go through `applyFlagSettings({additionalDirectories})` for outside-cwd paths only (probe 75) — inside-cwd paths are rejected as already accessible, so the other engine door probe 75 found, `register_repo_root`, stays permanently unused by this command |
| `/help` dialog | ✅ | — | **F6 (t14, `DG62`/`DG63`).** The printed list is gone. `RNa`'s tabbed dialog ships — General (upstream's pitch + the shortcuts grid), Commands (a browser over the **live** ~105-command catalog) and Custom commands — with the docs link and the two conditional footers. `DG63`'s three-column grid of sentences resolves every chord from F2's live binding table and is the **same component** the `?` overlay draws, so a rebind moves both. Recorded: the Custom-commands tab can never populate (the SDK's `SlashCommand` carries no builtin-vs-user field), the frame colour is `permission` rather than `professionalBlue`, and the `/` search in the browser is an addition |
| IDE diff viewer | 🚫 | — | IDE-coupled |
| MCP elicitation dialog | 🚫 | — | rarely fires headless |
| `Select`/`Tabs` primitives (`ST7`) | ✅ | — | **F6 (t1/t2).** Both built and adopted. `select/Select.tsx` + the pure `select/selectModel.ts` carry upstream's absolute 1-based indexes padded to the count's width, the `↑`/`↓` gutter overflow arrows, `inlineDescriptions`, `type:"input"` rows, digit selection, wrap at both ends and the **edge-anchored** height-clamped scroll window (`nz_` L396851); `select/MultiSelect.tsx` is `V3`'s check-box sibling (`[✔]`/`[ ]`, the bold submit row) and `select/Tabs.tsx` is `Jx`. Every list this wave touched mounts one of them — the nine hand-rolled lists and their bespoke key handling are gone, which is what makes `j`/`k`/`ctrl+n`/`ctrl+p`/PageUp/PageDown/Home/End uniform across the app (acceptance #6). Two contexts express the overlay-vs-decision split: `Select` unbinds the six root globals, `SelectDecision` does not |
| `DiffDialog` | ❌ | — | **F0 — new row, no prior row existed.** A real upstream dialog kind with no ccx equivalent — distinct from the diff *sidebar*, which is vestigial upstream dead code (E1 in the spec, not cloned on purpose). `/diff` here is a terminal stand-in (`git status --short`/`git diff --stat`, §5), not this dialog |
| `EnterPlanMode` (`DG28`) | 🚫 | — | **F6 — leaves the denominator on probe evidence (probe 81 Q2, 2026-08-05).** `EnterPlanMode` executes headlessly — assistant `tool_use`, turn result `success` — and **never consults `canUseTool`**: zero consults. There is no hook to hang upstream's `Enter plan mode?` dialog on, so this is unreachable in the same class as `CM6`/`CM7`, not an unbuilt feature. The spec's F6 Delivers line is superseded by a 2026-08-05 Revision Note. The Tab-ladder `plan` rung (§8) remains how plan mode is entered here |
| Background-dialog detail sub-dialogs | ✅ | — | **F6 (t13, `DG60`).** The flat row list is gone. `BgTasksPanel.tsx` is now upstream's `Background` dialog (`rsi` L481110): a counts subtitle, section headers gated on there being more than one category, per-type badge rows — and Enter opens the per-type **detail sub-view**, `Shell details` with its last-lines output box or `<agentType> › <description>` with Progress / Prompt / Error. Recorded unreachable inside it: the shell's ` (exit code: N)`, the `of <bytes>` half of `Showing N lines`, and the once-a-second runtime tick |
| Rewind picker anatomy (`DG38`–`DG40`, `DG42`, `DG44`) | 🟡 | — | **F6 — new row (t10).** `Q4f`'s anatomy on the shared `Select`: each row's `<basename> +A -R` / `N files changed +A -R` / `No code changes` / `⚠ No code restore` summary computed **before** anything is selected (windowed, sequential, each row lighting up as its dry run lands), the list in transcript order with the trailing italic `(current)` under the cursor at open, the `Rewind` frame, per-option explanation lines and the manual-edit warning. **Missing arm:** `DG41`'s `Summarize from here` / `Summarize up to here` pair with its `add context (optional)` input — an explicit F6 non-goal (P91). Recorded unreachable: `DG44`'s skipped-files sentence (our `rewind()` returns `void`) and `DG40`'s leading `/resume <id>` row (no fork lineage on our wire) |
| Unbuilt permission registry kinds, plus the explain pane | ❌ | — | **F6 — new row, no prior row existed.** Three of upstream's nine `w8y` routes still fall through to `GenericPermission` rather than getting a dialog of their own — but they are not equally reachable and the row says which is which. **Reachable and simply not built:** the **workflow** tool (`DG16` — phase summary, dashed-border raw script, token-cost caveat, `ctrl+g` edit) and the **browser / Claude-in-Chrome** dialogs (`DG18`), both explicit F6 non-goals. **Effectively unreachable on this harness:** **PowerShell** (`DG17`) — the route is gated on a Windows shell that cannot fire on the macOS/Linux hosts every gate and every test here runs on, so it is listed for completeness rather than counted as a gap anyone can hit today. The fourth item is not a registry kind at all: `DG4`'s `ctrl+e` **explain pane** (an LLM call returning `{explanation, reasoning, risk, riskLevel}`) is a sub-surface *inside* every permission dialog, and it is grouped here because it has the same owner and the same non-goal status, not because it is a route. The row is ❌ on the two reachable ones. **Wave T (t6/t7) update — `DG4`'s surface shipped and its production wiring did not, so the row stays ❌.** Built and pinned: upstream's verbatim system prompt (L504943), the user-prompt builder (L504915-24), the four-field forced-tool schema (L504955), the `Low risk`/`Med risk`/`High risk` labels with their `success`/`warning`/`error` colours (`XQf`/`YQf`), the three-row render (`Rsl` L505053-104) with `Loading explanation…` / `Explanation unavailable`, the lazy one-shot toggle that dims the command line and hides the plain description while shown, and abort-on-unmount — plus a DI'd `ExplainTransport` and a `structuredExplainTransport` built on the harness's existing structured-output path (probe 98 Path C: valid 3/3, ~6 s, zero new dependencies; Path A, raw Messages with a true forced tool at 2.8 s, is recorded as a future optimisation behind a dependency-and-credential decision). **Nothing calls a live model**: the transport prop is optional and undefaulted and no production call site supplies one, which is a deliberate decision recorded at `BashPermission.tsx:26-33` ("wiring a dialog that makes model calls by default is a separate, deliberate decision"). Per this file's rule a surface with its wiring deferred does not score as delivered, so `DG4` remains part of this row's ❌ and the missing hint is named on the consult-footer row above. It is also Bash-only here, as upstream's is (L505225 / L506435 wire it into the Bash and PowerShell consults only) |

## 5 — Slash commands

| Command | Status | Notes |
|---|---|---|
| `/clear` `/compact` `/context` `/model` `/resume` `/continue` `/help` `/think` `/yolo` | ✅ | local, dispatched. **Wave T (t15) note, no score change:** `/yolo` no longer flips straight into bypass — first use opens the same consent dialog the launch path uses (§4's row) and later uses respect the persisted acceptance. Upstream has no precedent to inherit here: its gate is launch-only *because* its ladder cannot reach bypass at all, so gating `/yolo` is a ccx-side closure of a ccx-side hole (Recorded additions) |
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
| `/rewind` (aliases `/checkpoint`, `/undo`) | ✅ | **C5**, extended by **F6 (t10, `DG38`)** — opens the Esc-Esc picker via command (`useChat.ts`), the same entry point as the gesture, and now under upstream's own two aliases (`["checkpoint","undo"]`, L353066) through a general alias mechanism the command table gained (the same mechanism gives `/bg` upstream's `/tasks` and `/bashes` — §8's row, not a §5 row of its own, so this section's denominator is unchanged) |

## 6 — Polish

| Detail | Status | Priority |
|---|---|---|
| Asterisk-pulse spinner animation | 🟡 | **U2**. **F0 correction:** mirrors §3's "Spinner glyph" finding — glyph set is right, but the timing model is wrong (upstream's 2000ms triangle wave over 6 glyphs vs. our 120ms/12) |
| Random thinking verbs | 🟡 | **U2**. **F0 correction:** mirrors §3's "Spinner thinking verbs" finding — 186 upstream verbs not 187 (we carry one extra), and the random verb is upstream's last fallback, not its primary source (the active todo's `activeForm` goes first) |
| `●`/`⎿` message prefix glyphs + accent colors | 🟡 | **U3**. **F0 correction:** mirrors §2's "Assistant message identity" and "Tool result tree glyph" findings — the bullet is `⏺` on macOS in the plain `text` token (not an accent `●`), and `⎿` is emitted once at 5 columns upstream, not prefixed per line (`>` user echo kept as `›` by choice, itself corrected to upstream's `❯ ` in §2) |
| "esc to interrupt" everywhere a turn runs | 🟡 | **U2**. **F0 correction:** mirrors §3's "esc to interrupt affordance on spinner" finding — upstream puts this in the footer hint ladder only while loading, never inside the spinner text |
| Ctrl-C interrupt + double-press-to-exit | ✅ | **U8** |
| Double-Esc to rewind affordance | ✅ | **C5 — the flagship (U12)**: `RewindPicker.tsx` + `sessions/rows.ts` (content-shape anchor classifier, shared with `replay.ts`) + `host/host.ts` (`rewindAnchors`/`rewindDryRun`/`rewind`, validated before every side effect) + `ChatApp.tsx` Esc-Esc arming (1.5s idle-only window; busy Esc stays interrupt). Restores conversation and/or code via CC's 3-way picker; a conversation restore pre-fills the composer with the prompt text (CC's edit-and-resend loop). **F6 (t10)** rebuilt the picker itself onto `Select` and onto upstream's `Q4f` anatomy — see §4's "Rewind picker anatomy" row for what moved; the Esc-Esc *affordance* this row scores is unchanged. **fixed 2026-07-31 (F0, t2, CM15):** Esc-Esc used to open this rewind flow unconditionally. It is now gated to an **empty** composer only — with typed text present, the first Escape arms an "Esc again to clear" hint and the second press clears the text back into history instead (`clearToHistory`), so typed text can never be lost into a rewind prompt. Rewind itself is unchanged once the composer is empty |
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
| AskUserQuestion dialog | 🟡 | — | **GB8** `QuestionDialog.tsx` — sequential per-question flow (`[i/N]` progress, header chip), options as numbered rows + arrows, `multiSelect` toggled with space, an always-present "Other" free-text row → `response`; consults `canUseTool` in every permission mode incl. `bypassPermissions` (probe 65). Divergence: CC renders multiple questions as **side-by-side tabs**; we go one at a time — keyboard-identical outcomes, an accepted divergence (spec Decision Log). **F0 addition:** two more missing facts on record — upstream also has a **design-preview two-column variant** when any option carries a `preview`, and an **AFK auto-resolve** that submits partial answers on timeout; neither exists here. **F6 (t2, `DG45`):** the bespoke renderer is gone — both branches now mount the shared primitives (`MultiSelect` for the multi-select question, `Select` for the single), so the check-box glyph is upstream's boxed `[✔]`, the commit moves from Enter to the bold **Submit** row, the answer follows selection order, and the "Other" row is a real `type:"input"` row whose empty Enter declines. Recorded: bare `y`/`n` are now inert over a question (upstream's list has no such shortcut), and upstream's third `Chat about this` row is omitted rather than dead-rowed — it calls `onRespondToClaude`, a third wire channel our dialog does not have |
| Plan-mode approval dialog (ExitPlanMode) | ✅ | — | **Wave T (t10/t10-fix/t11/t11-fix) — the F6 ✅ was scored ahead of its evidence on the half that matters most, and that half is now closed.** F6 rebuilt the anatomy but left the option set **static**: row 1 always read `Yes, auto-accept edits` and always granted `acceptEdits`, so on a session where auto or bypass was available the row's label and the grant disagreed (qa3-17). The options now follow availability exactly as `sYf` does (L500696-714) — `Yes, and bypass permissions` / `Yes, and use auto mode` / `Yes, auto-accept edits`, from `isAutoSupportedModel(model)` and the launch-time `allowDangerouslySkipPermissions`, falling back to upstream's neither-available arm when an attach client does not yet know its model — and `plan_approve` now carries the **granted mode** rather than a boolean, applied by both wires (`host.ts` and `appserver/planUpgrade.ts`). The host applier swaps the model **before** granting `auto` and reports a refusal instead of swallowing it, which probe 99 showed is load-bearing: off its supported set the engine **refuses** `auto` and stays put, so an unswapped grant is *lost*, not downgraded. Two more F6 gaps closed: the plan body now sits inside `SM`'s two dashed rules (L424994-425003, left and right edges off), and the `ctrl+g` footer appends the **shortened `input.planFilePath`** the wire already carries (probe 97 A2) — a path the spec had listed as "never built" until the probe found it on the wire. A guard test pins the live tool name `ExitPlanMode`, the single literal the whole plan surface classifies on. **The score does not move — a ✅ row cannot rise — but the ✅ is only now earned.** Two recorded items carry forward: `shift+tab` approves while the keep-planning row is being typed into and **carries the typed text into ccx's own decision record**, but on the REPL path nothing surfaces it (only the app-server's `decision/resolved` fan-out does), which is why the hint stays trimmed to `shift+tab to approve`; and an empty `Enter` on the keep-planning row **denies**, which is upstream's own `xnl` at L500994 — a Wave-T draft criterion asking for a no-op there was retracted mid-execution (W-T21) after the bundle was read. **F6 (t9, `DG29`/`DG30`/`DG31`/`DG34`) — rebuilt from `Gnl` (L500755).** The pre-F6 body (three hand-rolled lines, a `y` shortcut, ↑↓ scrolling the plan) is gone. What ships is upstream's two-sibling **modal** anatomy: the scroll region, the `Ed` frame titled `Ready to code?`, `Here is Claude's plan:`, the plan through F4's markdown renderer, the consent reason, and a **separate top-bordered box** holding the prompt, `sYf`'s option list and the `ctrl+g edit in <editor>` row — plus `DG34`'s editor round trip with its `success` `✓ Plan saved!`, and `DZe`'s `Exit plan mode?` branch for an empty plan. `DG31`'s keep-planning row is a real inline input (whose label never prints — `showLabel` is false without `inlineDescriptions`, so the placeholder *is* the row). **Both remaining claims in the F0 correction are retired.** The clear-context family (`DG30`) is recorded **unreachable**: it needs a live context-usage percentage and host-state flags no client sees, and its sibling arms are remote entitlements. And *"keeps the dialog open on an empty submit"* was **wrong about the bundle** — the census read `lYf`'s null-return, which sits on an images-only arm an empty submit cannot reach; `sYf` sets no `allowEmptySubmitToCancel`, so `RLe` routes empty text to `onCancel` → `xnl` → `{behavior:"deny"}`, exactly what Esc does. Corrected in the spec's Revision Notes and pinned as an **equality** between the two key paths in `f6-acceptance.test.tsx` § #4. Recorded divergences: Ink 5 has no scroll container, so the plan region clips at the same computed height with an invented `ctrl+u`/`ctrl+d` reading path; and the shift+tab hint is trimmed to `shift+tab to approve`, because upstream's `…with this feedback` would advertise the unreachable allow-side channel |
| `plan` on the Tab ladder | ✅ | — | **GB7** the ladder is now `default → acceptEdits → plan → auto` (`useChat.ts` `ladderNext`); off-ladder modes (`bypassPermissions`) still re-enter at `default` |
| Ctrl+B background | 🟡 | — | **GB10** `ChatApp.tsx` — the key and the host `background` op are fully wired (`backgroundNow` → `Session.backgroundAll()`, probe 39) and idle `Ctrl+B` opens the background-task panel; but **live acceptance (2026-07-28)** found the real CLI does not detach an in-flight foreground `Bash` call — the op is accepted and the SDK reports success, yet the command runs to completion in the foreground regardless. The verified surface is **model-initiated** background shells (`run_in_background: true`): `⚙ N` status-bar count, `/bg` panel row, and stop-from-panel all confirmed live |
| `/bg` panel (upstream's `Background` dialog) | ✅ | — | **F6 (t13, `DG60`/`DG61`) — rebuilt from `rsi` (L481110).** The flat panel is gone, and with it its title, its `glyph · short-id · type · command` row, its `none running` line and its footer. What ships is upstream's dialog: the counts subtitle (` · `-joined, zeros dropped, singularised), section headers **gated** on there being more than one category, per-type badge rows, `x` to stop a running task, `ctrl+x ctrl+k` stop-all, and Enter into the per-type detail sub-view (§4's own row). The one divergence this row used to carry — the `/bg` name — is **retired**: `DG61`'s own prescription was "add `/tasks` and `/bashes` as aliases that route to the same panel", and that is exactly what shipped, so both upstream names now work while `/bg` keeps its meaning against `TaskPanel`. Upstream's `Background dialog dismissed` string is exported and deliberately unused: its `display:"skip"` resolves to `messages: []`, so upstream prints nothing either |
| Background task **output** reachable (Enter-to-tail) | ✅ | — | **W2** probe-74 mechanism: the backgrounded tool_result names the output file ("Output is being written to: <path>"); `bgTaskMeta.ts` harvests path+command+status client-side from frames the REPL already receives (zero host/wire change — works identically over `ccx attach`), and Enter on a panel row tails the file's last 12 lines in-panel (Enter again re-reads; `local_agent` rows deliberately not tailed) |
| Ctrl-X Ctrl-K kill agents | ✅ | — | **W2** — 2.1.220 `chat:killAgents` flow verbatim: "No background agents running" when idle; first press arms ("Press Ctrl-X Ctrl-K again to stop background agents"), second within 3s stops all |
| ~~Task lifecycle notices~~ | 🚫 **retired** | — | **GB7 shipped this; F3 Task 7 DELETED it, and the row leaves the denominator rather than staying a ✅ for a behaviour that no longer exists.** `task_started`/`task_notification` frames used to render one-line transcript notices (`⚙ task started: …` / `✓ task done: …`). **Upstream renders none** — the lifecycle surfaces on the Agent unit's own rows (§2, `LT16`/`LT17`) and in the `/bg` panel — so the ✅ was an over-ship against the stale reference. It was also actively harmful: P84 shows a `task_started` arriving ~5 s into *every* foreground Bash, and each local notice is a fold **breaker**, so the notice was splitting fold runs mid-turn. The frames are still ingested (`bgHarvest` + `agentMeta`) and still repaint the ↓ panel; only the transcript line is gone (`useChat.ts`, `ev.kind === "task"`) |
| Subagent attribution on dialogs | 🟡 | — | **GB5** a host-side correlation map (`parentToolUseID` from nested frames → `subagentType` from `task_started` frames) feeds the dialogs when known; **best-effort** — a miss renders unattributed and never blocks (no per-subagent drill-in transcript view — spec Non-goals). **F6 (t4, `DG21`): the first half of the F0 correction is closed** — the attribution is now a **frame-header suffix** (`· from the <name> agent` / `· from the "<x>" workflow`, the `·` dimmed, the name clipped at 24 columns by upstream's own rule), not a separate `Subagent (<type>) asks:` line above. **Missing arm:** upstream also colours subagents from 8 reserved theme tokens; ours are uncoloured, which waits on `ST4` (§6's theme-token contract row) |
| Status-bar mode truth | ✅ | — | **Wave T (t1/t16) — the GB5 ✅ was true only from the first host `state` event onward, and the turn-0 half was a lie.** The banner and `hookOpts.initialMode` both read `inv.config.permissionMode ?? "default"`, which is undefined unless `--permission-mode` was passed — so a fresh launch printed `mode  default` while the engine ran `auto` (`DEFAULTS.permissionMode`), and the status bar only corrected itself when the first `state` event arrived (qa3-02). Both call sites now read `resolvedPermissionMode` off the **same object** the host is constructed from, so banner, turn-0 chip and engine are one string. The launch posture changed with it: an **interactive host is born in `default` (Manual)**, scoped to the host *kind* rather than to one call site so `ccx --detachable` — the same REPL, forked through `spawn.ts` — is covered too (W-T14, `hostMain.ts:51`); headless `-p`, `--bg` and the daemon keep `auto` deliberately, because a background run has nobody to ask. And a **refused** runtime mode change is now reported rather than painted: `applyMode`'s `.catch(() => {})` swallowed the engine's answer before the chip repainted, so the bar could show a mode the engine had rejected — probe 99 proved that refusal is real ("Cannot set permission mode to auto: auto mode unavailable for this model"). The refusal row itself is harness-authored — upstream's TUI flips the mode in-process and renders no refusal anywhere — and is listed under Recorded additions. Evidence `test/unit/cli-main.test.ts`, `test/tui/mode-refusal.test.tsx` (6), `probes/probes/99-runtime-mode-refusal.ts`. **GB5** the host intercepts the CLI's own `system`/`status` frames and pushes the real `permissionMode` on every `state` event (one field, last-write-wins between the CLI's own flip and the host's setter calls); closes the previously recorded "status bar starts at `default`" quirk — see the `full-use-checklist.md` A1 note, updated alongside this |

**Score after Wave T (2026-08-06): unchanged at ~83% — 6✅ + 3🟡 of 9 rows.** No row in this section
changed state. Wave T's control-plane work landed inside two rows that were already ✅ and could not rise:
the plan-approval dialog (option arms that follow availability, a grant that matches its label on both
wires, dashed rules, the plan file path) and status-bar mode truth (the launch posture, the turn-0 chip,
and a refused runtime mode change now reported rather than painted). Both rows now say plainly that their
✅ was scored ahead of its evidence and is only now earned; neither is re-scored, because moving a row down
and back up in one pass would change the arithmetic without telling anyone anything. The three 🟡 rows —
AskUserQuestion, Ctrl+B background, subagent attribution — keep exactly the arms F6 named. The F6 recount
this replaces read:

**~83% (F6 recount, 2026-08-06: 6✅ + 3🟡 of 9 rows = 7.5/9 = 83.3%).** Two rows rise, both because F6
rebuilt the surface behind them against the bundle rather than against the stale reference: **Plan-mode
approval dialog** 🟡→✅ (upstream's whole `Gnl` anatomy, with the two claims the F0 correction still held
against it resolved — one recorded unreachable, one found to be factually wrong about the bundle) and
**`/bg` panel** 🟡→✅ (upstream's `Background` dialog, with `DG61`'s own alias prescription shipped). The
three that stay 🟡 each keep a named arm: **AskUserQuestion** still renders questions sequentially rather
than as side-by-side tabs and has neither the design-preview variant nor AFK auto-resolve; **Ctrl+B
background** is still the live-verified functional gap below; **Subagent attribution** now hangs on the frame
header as `· from the <name> agent` (`DG21`, F6 t4) but does not colour subagents from upstream's eight
reserved theme tokens, which waits on `ST4` (§6). The previous score read:

**~72% (F3 recount: 4✅ + 5🟡 of 9 rows = 6.5/9 = 72.2%).** The single change from the F0 recount
below was the **retirement of "Task lifecycle notices"** — see that row: F3 deleted the behaviour because
upstream has none of it, so the row leaves the denominator instead of holding a ✅. Nothing else in this
section moved, and nothing regressed in capability. The F0 recount it replaces read:

**~75% (F0 recount: 5✅ + 5🟡 of 10 rows = 7.5/10).** The previous ~80% (W2's first plain recount:
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
