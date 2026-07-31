# TUI/UX parity — `ccx` chat REPL vs. original Claude Code

> **Goal (2026-06-29):** bring our SDK-backed interactive REPL (`ccx`, the product
> north star) to the *look-and-feel* level of the original Claude Code TUI. This scorecard is the
> **source of truth for visual/interaction parity** — distinct from `coverage.md` (which scores SDK
> *capability* realization). Tracked feature-by-feature against the reference TS harness in
> `../../Claude Code Src/`.
>
> **Method:** the reference is read for *exact* glyphs / strings / key-bindings / option labels, so we
> match fidelity rather than approximate. Each item is scored ✅ have · 🟡 partial · ❌ missing ·
> 🚫 out-of-scope (bridge-coupled / non-terminal / explicit non-goal), with 🚫 excluded from the
> denominator. **Two scoring eras — do not compare across them.** The `start` and `pre-C5` columns
> weight rows by user-visible impact; from C5 (2026-07-28) onward the score is a plain
> ✅=1.0 · 🟡=0.5 · ❌=0 row count, because impact weights were never written down and so could not
> be reproduced or audited. See the C5 recompute note under the headline table.

## Headline

Starting point (pre-work, 2026-06-29): the REPL already has a solid spine — multiline editor with
paste/history/`@`-mention/`/`-command autocomplete, lightweight markdown, live token streaming with
thinking-collapse + tool status + subagent nesting + a task panel, inline permission dialog, model &
session pickers, a status bar, slash commands, and resume/replay. What it lacked was the *chrome and
polish* that makes CC instantly recognizable: **no welcome banner, a non-CC spinner (no verbs / wrong
glyph / no "esc to interrupt"), no `●` message identity, no `!`/`#` input modes, no queued input, no
`/cost`, and thin terminal-native editor ergonomics** (Ctrl-A/E/K/U/W, Ctrl-L, Ctrl-C-twice).

| Category | Parity (start) | Parity (pre-C5) | Parity (now, post–sprint-W3) |
|---|---|---|---|
| 1. Input / composer ergonomics | ~45% | ~88% | ~95% |
| 2. Transcript / message rendering | ~50% | ~74% | ~83% |
| 3. Status / chrome (banner, spinner, status bar) | ~35% | ~72% | ~92% |
| 4. Modals / overlays | ~60% | ~88% | ~88% (4 new W3 rows — see W3 recount note) |
| 5. Slash commands | ~55% | ~70% | ~86% (6 new W3 rows — see W3 recount note) |
| 6. Polish (glyphs, colors, affordances) | ~40% | ~74% | ~94% |
| 7. Control plane (dialogs, ladder, background tasks) — §8 | ~0% | ~81% | ~80% (untouched in W3) |
| **Overall** | **~46%**<br>*(impact-weighted)* | **~83%**<br>*(impact-weighted)* | **~88%**<br>*(plain row count)* |

**W1 recount note (2026-07-30, TUI/UX sprint Wave 1):** §1 21✅/1❌ of 22 non-🚫 rows (Ctrl-L
converged to clear-input, Ctrl-J/Ctrl-_/Ctrl-S/Shift+Tab/external-editor added); §4 recounted plainly
for the first time (6✅+1🟡 of 7); §5 **went down 88→84 despite seven commands shipping**, because the
audit-driven rows (`/config`+`/permissions` settings UI as their own ❌ row, `/diff` honest at 🟡)
grew the denominator — gaps that were previously invisible are now counted, which is the point of the
sprint's honesty posture.

**W1 keymap deferrals — RESOLVED by Wave 2 (2026-07-31):** the three deferred bindings all shipped
and are scored rows below — `ctrl+o` (`app:toggleTranscript` → the transcript pager, §4), `ctrl+r`
(`history:search` → the prompt-history search, §4), and `ctrl+x ctrl+k` (`chat:killAgents` →
double-press stop-all, §8). Standing intentional divergences, restated: our `Ctrl-Z` detach has no
upstream equivalent (kept, and it stays live even while W2's overlays are open); real CC's `cmd+k`
screen-clear never reaches a terminal app, so screen clear stays `/clear`; `Ctrl-B` here is
background-panel/backgrounding rather than upstream's `task:background` context binding.

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
landing §5 at **16✅+4🟡 of 21 rows (~86%)**, up from ~84%. **Overall ~89% → ~88%** is a real, small,
plainly-computed movement: §5's rise (+2 in the unweighted 7-category average) is outweighed by §4's fall
(-6) in that same average — one point net, from adding ten honestly-scored rows to a wave that shipped
seven working features. Not a regression in anything previously counted; a truer denominator.

**W3 divergences (2026-07-31, TUI/UX sprint Wave 3 — from the plan's Global Constraints line 37 unless
noted otherwise, each with its reason):**
- **No custom/ANSI themes** — `/theme` ships 5 of upstream's 7+ theme rows (`theme.ts` `THEME_LABELS`);
  the rest would need theme-authoring UI this harness has no use for yet.
- **`auto` currently equals `dark`** — terminal-background detection isn't available headlessly, so the
  "Auto (match terminal)" row picks a fixed default rather than truly detecting anything.
- **Theme changes apply to NEW output only** — Ink's append-only `<Static>` keeps whatever colors its
  already-rendered lines were written with; only the live binding (`ACCENT`/`themeTokens()`) that new
  renders read updates immediately (the same `<Static>` constraint Wave 1 recorded for `/clear`).
- **SettingsDialog has no header-focus state**, so upstream's `Settings dialog dismissed` string is
  unused, and only our **5 functional Config rows** ship (Theme/Model/Output style/Default permission
  mode/Thinking mode) against upstream's ~54, most of which have no ccx equivalent (no real Claude Code
  client to configure).
- **`/keybindings` views the keymap rather than opening it for editing** — upstream opens
  `~/.claude/keybindings.json` in `$EDITOR`; we have no rebinding mechanism to open a file for, so the
  command opens the existing read-only `?` keymap viewer instead and says so up front.
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
  (control-channel / local, safe mid-turn). `Esc` (interrupt) clears the queue — a clean "stop everything".
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
  Tab ladder, Esc-Esc, Ctrl+B, `!`/`#` modes); any key closes it.
- **Alt/Ctrl word movement** (`tui/editor.ts` `wordLeft`/`wordRight`, checked ahead of the ctrl-combo
  branch so no meta chord falls through to insertion).
- **Transcript fidelity.** Tool-invocation rows adopt CC's `● Name(target)` bullet (`render.ts`
  `toolUseLines`, replacing `⚙`); Edit/Write diffs gain a real hunk body — up to 3 dim numbered context
  lines each side of the change, numbered `-`/`+` rows for the changed lines (`render.ts`
  `toolDiffLines`) — numbering is **hunk-relative** (1-based within the `old_string`/`new_string`
  snippet only; the file is never read from disk, so absolute file-line numbers are not available); a
  failed tool_result renders red with a `✗` prefix on its first line (`render.ts` `resultLines`, keyed
  on `is_error` — the only signal a `tool_result` carries, there is no exit code).
- **Markdown tables** (`markdown.ts` `flushTableBuffer` — a buffered run of `|`-lines becomes a
  column-padded table only once a `|---|` separator confirms it, otherwise it's re-emitted as prose
  untouched) and a **zero-dependency syntax highlighter** (`tui/highlight.ts` — a manual regex lexer
  for keywords/strings/comments/numbers across ts/js/py/sh/json; **not a real grammar**, a
  recognizable-90% approximation per the spec's Decision Log against pulling in a ~1MB dependency).
- **Compact-boundary divider** (`tui/useChat.ts`, a `system`/`compact_boundary` frame renders
  `─── context compacted ───`) and **`/copy`** (`tui/copy.ts`, DI'd `pbcopy`/`xclip` spawn — copies the
  last assistant reply, live or replayed via `sessions/rows.ts` `lastAssistantText`).

---

## 1 — Input / composer ergonomics

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Multiline editor (paste split, `\`-continuation) | ✅ | — | `editor.ts` — paste = one `useInput`, insert-and-split |
| History up/down (draft stash/restore) | ✅ | — | `editor.ts` historyPrev/Next |
| `@`-file mention fuzzy autocomplete | ✅ | — | `editor.ts` + `fileComplete.ts` |
| `/`-slash command autocomplete | ✅ | — | `editor.ts` command state + `commandComplete.ts` |
| `!` bash mode (run shell directly, no model) | ✅ | — | **U5** `bash.ts` local exec in cwd, echoed `! cmd` + `⎿`-style output (local-only by design; no model context injection) |
| `#` memory mode (append to CLAUDE.md) | ✅ | — | **U5** `memory.ts` appends under `## Memories` |
| Input mode indicator (bash/memory/command) | ✅ | — | **U5** `inputMode()` → magenta bash / blue memory border + hint |
| Ctrl-A / Ctrl-E (line start/end) | ✅ | — | **U7** `editor.ts` readline keys |
| Ctrl-K / Ctrl-U (kill to end/start) | ✅ | — | **U7** `editor.ts` |
| Ctrl-W (kill word back) | ✅ | — | **U7** `editor.ts` |
| Word movement (Alt/Ctrl ←→) | ✅ | — | **C5** `editor.ts` `wordLeft`/`wordRight` (Alt-←→ and Alt-b/f), checked ahead of the ctrl-combo branch so no meta chord falls through to insertion |
| Ctrl-L (clear **input**) | ✅ | — | **W1** converged on 2.1.220's `chat:clearInput` (the old app-level screen-clear was a divergence); screen clear stays `/clear` — real CC's `cmd+k` never reaches a terminal app (intentional divergence, recorded) |
| Ctrl-J (newline) | ✅ | — | **W1** `editor.ts` — 2.1.220 `chat:newline`, alongside `\`-continuation |
| Ctrl-_ / Ctrl-- (undo edit) | ✅ | — | **W1** `editor.ts` snapshot-on-change stack (cap 100) — 2.1.220 `chat:undo`; terminals send 0x1F for both |
| Ctrl-S (stash / restore input) | ✅ | — | **W1** `editor.ts` — 2.1.220 `chat:stash`: parks a non-empty buffer, restores on the next Ctrl-S from empty |
| Shift+Tab cycles permission mode (bare Tab popup-only) | ✅ | — | **W1** converged on 2.1.220's `chat:cycleMode` = `shift+tab`; bare Tab now belongs to autocomplete alone (our old bare-Tab cycle was a divergence) |
| Ctrl-C twice / Ctrl-D to exit | ✅ | — | **U8** Ctrl-C interrupts a turn, else "Press Ctrl-C again to exit"; Ctrl-D on empty = EOF exit |
| Queued messages while busy | ✅ | — | **U6** turns queue while busy + drain FIFO on turn end; `⋯ queued:` indicator; Esc clears |
| Placeholder / ghost text ("Ask Claude…") | ✅ | — | **U7** dim placeholder on empty buffer |
| `?` shortcuts / help menu | ✅ | — | **C5** `ShortcutsOverlay.tsx` — a real bordered overlay listing the keymap, opened by `?` on a genuinely empty composer; the U7 footer hint line stays alongside it |
| Vim mode (`/vim`) | ❌ | LOW | owner-deferred (the sprint's only deferral) |
| External editor (Ctrl-X Ctrl-E / Ctrl-G → `$EDITOR`) | ✅ | — | **W1** `externalEditor.ts` — spawnSync terminal handoff (raw mode released/restored), null-safe (editor failure keeps the buffer), popups cleared on applied edit |
| Image paste (Ctrl-V) | 🚫 | — | non-terminal / out of scope here |

## 2 — Transcript / message rendering

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| User prompt echo | 🟡 | LOW | we show `› text` dim (intentional clean variant); CC uses `>` |
| Assistant message identity (`●` bullet, accent) | ✅ | — | **U3** accent `●` gutter + aligned continuation (live + replay) |
| Thinking blocks (stream + collapse) | ✅ | — | `liveTurn.ts` `✦ Thinking`; CC `✻`/token count |
| Tool-use rows | ✅ | — | **C5** `render.ts` `toolUseLines` — CC's `● Name(target)` bullet form (was `⚙`); live turn status glyphs unchanged |
| Tool result tree glyph (`⎿`) | ✅ | — | **U3** dim `⎿` result tree |
| Markdown: headers/lists/quote/fenced | ✅ | — | `markdown.ts` (lightweight) |
| Markdown: inline mixed bold/italic spans | ✅ | — | **U11** per-span `segments` (bold/italic/code) rendered within a line |
| Markdown: tables | ✅ | — | **C5** `markdown.ts` `flushTableBuffer` — a buffered run of `\|`-lines becomes a column-padded table only once a `\|---\|` separator confirms it; otherwise re-emitted as prose untouched |
| Markdown: code-block syntax highlight | ✅ | — | **C5** `highlight.ts` — a zero-dependency regex lexer (keywords/strings/comments/numbers for ts/js/py/sh/json). **Not a full grammar** — a hand-rolled single-pass lexer, a recognizable-90% approximation (spec Decision Log against a ~1MB dependency), unknown langs fall back to dim |
| Edit/Write diff | ✅ | — | **C5** `render.ts` `toolDiffLines` — a real hunk body: up to 3 dim numbered context lines each side of the change, numbered `-`/`+` rows for the changed lines. **Numbering is hunk-relative** (1-based within the `old_string`/`new_string` snippet) — we never read the file from disk, so absolute file-line numbers are not available; scored honestly |
| Bash output rendering | 🟡 | MED | **C5**: only error framing landed — a failed `tool_result` (`is_error`) renders red with a `✗` prefix on its first line (`render.ts` `resultLines`). A `tool_result` carries no exit code, so `$`/exit-code framing is not reachable; stays 🟡, not promoted |
| Long-output truncation + expand | 🟡 | LOW | we cap; no interactive expand |
| Compact boundary marker | ✅ | — | **C5** `useChat.ts` — a `system`/`compact_boundary` frame renders a `─── context compacted ───` divider notice |
| Welcome banner / splash | ✅ | — | **U1** `banner.ts` — accent `✻ Welcome` box + cwd/model/mode + tips |
| Tip of the day | ❌ | LOW | `tipScheduler.ts` |
| Message timestamps | 🚫 | — | off by default in CC |

## 3 — Status / chrome

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Status bar (model · mode · ctx%) | ✅ | — | `ChatStatusBar.tsx` |
| Spinner glyph (`✻` asterisk-pulse) | ✅ | — | **U2** `spinner.ts` `·✢✳✶✻✽` fwd+reverse, Claude accent |
| Spinner thinking verbs (187, random) | ✅ | — | **U2** verbatim 187-verb vocabulary, fixed per turn |
| "esc to interrupt" affordance on spinner | ✅ | — | **U2** `(elapsed · esc to interrupt)` |
| Live token counter during turn | ✅ | — | **U10** real running output tokens from `message_delta` usage, in the spinner |
| Elapsed timer during turn | ✅ | — | **U2** whole-turn elapsed in the spinner |
| Context-left % + threshold warning | ✅ | — | **U13** ctx% color-escalates green→yellow→red + "⚠ auto-compact soon" near the window |
| Permission-mode indicator (color) | ✅ | — | `ChatStatusBar.tsx` modeColor |
| Cost in status / `/cost` | ✅ | — | **U4** `/cost` via `session.usage()` |
| `? for shortcuts` hint line | ✅ | — | **C5** `ShortcutsOverlay.tsx`, opened by `?` — supersedes the footer-hint-only prior state (§1) |
| Plan-usage warning chip (≥80% utilization) | ✅ | — | **C5** (F4) `usageFormat.ts` `usageWarning` → `ChatStatusBar.tsx` — a red chip once any rate-limit window crosses 80%, mirroring U13's ctx% escalation style |
| Vim mode indicator | ❌ | LOW | tied to vim mode |

## 4 — Modals / overlays

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Permission approval dialog | ✅ | — | **U9** numbered arrow-selectable Yes / Yes-don't-ask-again / No (↑↓·Enter·1/2/3·Esc; legacy a/A/d kept) |
| Bash permission shows full command | ✅ | — | **U9** `$ <command>` shown in full; file tools show the path |
| Model picker | ✅ | — | `ModelPicker.tsx` |
| Resume session picker | ✅ | — | `SessionPicker.tsx` |
| Task/todo panel | ✅ | — | `TaskPanel.tsx` |
| Ctrl-T todo-panel toggle | ✅ | — | **W1** — 2.1.220 `app:toggleTodos` (default visible) |
| Transcript pager (Ctrl-O) | ✅ | — | **W2** `TranscriptPager.tsx` + pure `pager.ts` — the bundle's 18-binding Transcript context (j/k · ctrl-u/d half · ctrl-b/f b/space page · g/G · arrows · q/Esc/ctrl-c exit), opens at bottom; bordered overlay, not alt-screen (see W2 divergences) |
| History search (Ctrl-R) | ✅ | — | **W2** `HistorySearchOverlay.tsx` + pure `historySearch.ts` — incremental prompt search over session/project/everywhere scopes (Ctrl-S cycles, initial "everywhere"), substring-then-subsequence ranking, Esc/Tab accept into composer · Enter execute · Ctrl-C cancel — the bundle's HistorySearch context key for key |
| SettingsDialog (`/config`, `/settings`) | 🟡 | — | **W3** `SettingsDialog.tsx` — four tabs (Status·Config·Usage·Stats, wrapping tab/shift+tab/←→), Config tab live rows + `/` search + Esc-close change summary (`Set {label} to {value}`, bold value); but only **5 of upstream's ~54 Config rows** ship (Theme/Model/Output style/Default permission mode/Thinking mode — the ones this harness's engine can actually apply) and there is no header-focus mode, so upstream's `Settings dialog dismissed` string is unused (W3 divergence) |
| PermissionsDialog (`/permissions`, `/allowed-tools`) | ✅ | — | **W3** `PermissionsDialog.tsx` — all five upstream tabs (Recently denied/Allow/Ask/Deny/Workspace), provenance-aware rule rows, add-rule flow with the destination picker (project-local/project/user settings, verbatim upstream typo `Saved in at ~/.claude/settings.json` kept), delete confirm, a read-only panel for non-editable rules, workspace directory add/remove. Divergences: rules apply via the flag layer **and** get written to the chosen settings file (upstream's rule engine is CLI-internal, invisible to us) — functionally equivalent but no upstream shadowing warnings fire; the Recently-denied footer intentionally drops two dead key chords (W3 divergences) |
| ThemeDialog (`/theme`) | 🟡 | — | **W3** `theme.ts` (live-binding token set) + `ThemeDialog.tsx` — picker with the exact `demo.js` live diff preview, Esc-restore; only **5 of upstream's 7+ theme rows** ship (no custom/ANSI themes), `auto` currently just equals `dark` (no headless terminal-background detection), and a theme recolors NEW output only — Ink's `<Static>` scrollback keeps whatever colors it was written with |
| AddDirDialog (`/add-dir`) | ✅ | — | **W3** `AddDirDialog.tsx` + `addDir.ts` — verbatim 2.1.220 validation copy (not-found / not-a-directory / already-added variants) and confirm dialog (session-only / remember-to-local-settings / cancel); grants go through `applyFlagSettings({additionalDirectories})` for outside-cwd paths only (probe 75) — inside-cwd paths are rejected as already accessible, so the other engine door probe 75 found, `register_repo_root`, stays permanently unused by this command |
| `/help` overlay | 🟡 | LOW | we print lines; CC has a modal |
| IDE diff viewer | 🚫 | — | IDE-coupled |
| MCP elicitation dialog | 🚫 | — | rarely fires headless |

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
| `/theme` | 🟡 | **W3** — opens `ThemeDialog`; 5 of upstream's 7+ themes, `auto` currently ≡ `dark` — see §4's ThemeDialog row |
| `/output-style` | ✅ | **W3** — prints the exact redirect line then opens `/config`'s Output-style row. This matches upstream's **own** 2.1.220 behavior — its standalone picker is itself a hidden redirect into `/config` (bundle-extraction surprise, see the spec) |
| `/keybindings` | 🟡 | **W3** — upstream opens `~/.claude/keybindings.json` in `$EDITOR` for in-place rebinding; we have no rebinding mechanism, so this opens the existing read-only `?` keymap viewer instead and says so up front (recorded divergence — viewing, not editing) |
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
| Asterisk-pulse spinner animation | ✅ | **U2** |
| Random thinking verbs | ✅ | **U2** |
| `●`/`⎿` message prefix glyphs + accent colors | ✅ | **U3** (`>` user echo kept as `›` by choice) |
| "esc to interrupt" everywhere a turn runs | ✅ | **U2** |
| Ctrl-C interrupt + double-press-to-exit | ✅ | **U8** |
| Double-Esc to rewind affordance | ✅ | **C5 — the flagship (U12)**: `RewindPicker.tsx` + `sessions/rows.ts` (content-shape anchor classifier, shared with `replay.ts`) + `host/host.ts` (`rewindAnchors`/`rewindDryRun`/`rewind`, validated before every side effect) + `ChatApp.tsx` Esc-Esc arming (1.5s idle-only window; busy Esc stays interrupt). Restores conversation and/or code via CC's 3-way picker; a conversation restore pre-fills the composer with the prompt text (CC's edit-and-resend loop) |
| Newline instructions hint | ✅ | **U7** footer (`\⏎ newline`) |
| Focus borders / input box styling | 🟡 | LOW |

## 8 — Control plane

> A distinct axis from §1–6: those measure *look-and-feel*; this measures whether the model's
> control-plane calls (`AskUserQuestion`, `ExitPlanMode`, background shells, subagent task lifecycle)
> reach a human **at all** — the gap `docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md`
> (Goal B of the clone spine) closed. Before this work the sweep behind that spec found **zero** handling
> for all four surfaces. Shipped GB1–GB10 (`main` `fb8933dee8..260fad720e`).

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| AskUserQuestion dialog | 🟡 | — | **GB8** `QuestionDialog.tsx` — sequential per-question flow (`[i/N]` progress, header chip), options as numbered rows + arrows, `multiSelect` toggled with space, an always-present "Other" free-text row → `response`; consults `canUseTool` in every permission mode incl. `bypassPermissions` (probe 65). Divergence: CC renders multiple questions as **side-by-side tabs**; we go one at a time — keyboard-identical outcomes, an accepted divergence (spec Decision Log) |
| Plan-mode approval dialog (ExitPlanMode) | ✅ | — | **GB9** — moved here from §4 (was ❌). `PlanDialog.tsx` renders the plan as markdown in a 14-line scrollable window (↑↓ scroll), then CC's three choices (`1` approve + auto-accept edits · `2` approve, manual edits · `3`/Esc reject with a one-line feedback prompt); approve lets the CLI flip `permissionMode` itself (probe 66) — the dialog only reports the human's choice |
| `plan` on the Tab ladder | ✅ | — | **GB7** the ladder is now `default → acceptEdits → plan → auto` (`useChat.ts` `ladderNext`); off-ladder modes (`bypassPermissions`) still re-enter at `default` |
| Ctrl+B background | 🟡 | — | **GB10** `ChatApp.tsx` — the key and the host `background` op are fully wired (`backgroundNow` → `Session.backgroundAll()`, probe 39) and idle `Ctrl+B` opens the background-task panel; but **live acceptance (2026-07-28)** found the real CLI does not detach an in-flight foreground `Bash` call — the op is accepted and the SDK reports success, yet the command runs to completion in the foreground regardless. The verified surface is **model-initiated** background shells (`run_in_background: true`): `⚙ N` status-bar count, `/bg` panel row, and stop-from-panel all confirmed live |
| `/bg` panel | 🟡 | — | **GB10 + W2** `BgTasksPanel.tsx` — one row per background task with **status glyph + command line** (harvest-enriched `BgTaskRow`), plus up to 5 recently-finished rows (dim, with final status); ↑↓ select, `k`/`x` stop (running rows only), Esc close. Divergence: the command is **`/bg`**, not `/tasks` — `/tasks` would collide with the existing `TaskPanel.tsx` (the model's todo checklist), a deliberate rename recorded in the spec's Decision Log |
| Background task **output** reachable (Enter-to-tail) | ✅ | — | **W2** probe-74 mechanism: the backgrounded tool_result names the output file ("Output is being written to: <path>"); `bgTaskMeta.ts` harvests path+command+status client-side from frames the REPL already receives (zero host/wire change — works identically over `ccx attach`), and Enter on a panel row tails the file's last 12 lines in-panel (Enter again re-reads; `local_agent` rows deliberately not tailed) |
| Ctrl-X Ctrl-K kill agents | ✅ | — | **W2** — 2.1.220 `chat:killAgents` flow verbatim: "No background agents running" when idle; first press arms ("Press Ctrl-X Ctrl-K again to stop background agents"), second within 3s stops all |
| Task lifecycle notices | ✅ | — | **GB7** `task_started`/`task_notification` frames render as one-line transcript notices (`⚙ task started: …` / `✓ task done: …` / `✗ task failed: …` / `◼ task stopped: …`), honoring `skip_transcript` |
| Subagent attribution on dialogs | 🟡 | — | **GB5** a host-side correlation map (`parentToolUseID` from nested frames → `subagentType` from `task_started` frames) stamps `Subagent (<type>) asks:` on the Question/Plan/Permission dialogs when known; **best-effort** — a miss renders unattributed and never blocks (no per-subagent drill-in transcript view — spec Non-goals) |
| Status-bar mode truth | ✅ | — | **GB5** the host intercepts the CLI's own `system`/`status` frames and pushes the real `permissionMode` on every `state` event (one field, last-write-wins between the CLI's own flip and the host's setter calls); closes the previously recorded "status bar starts at `default`" quirk — see the `full-use-checklist.md` A1 note, updated alongside this |

**Score: ~80% (W2 first plain recount: 6✅ + 4🟡 of 10 rows = 8/10).** The previous ~81% was the
impact-weighted era; the 81→80 movement is a **method change plus two added rows**, not a regression —
per-row, Wave 2 only added ✅s (output-tail, killAgents) and enriched `/bg`. 4 of the original 8 rows
were fully CC-faithful (✅); 4 carry a caveat (🟡). Three are accepted,
spec-recorded divergences from CC's exact form while delivering the same functional/keyboard outcome
(sequential questions, `/bg` naming, best-effort attribution). The fourth — Ctrl+B background — is a
**live-acceptance-verified functional gap**, not a form divergence: the key/op path backgrounds nothing
for an already-running foreground shell, and only the model-initiated path (`run_in_background: true`)
reaches the panel. The other seven rows work identically in the foreground REPL and over `ccx attach` —
closing the spec's motivating failure ("a `--bg` worker that hits a question and can only stall").
**Live acceptance ran 2026-07-28** (`docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md`
§ Outcomes): the AskUserQuestion round-trip (detached + Other free-text), the plan-approval loop, and
subagent attribution all PASS; background shells PASS for the model-initiated path and are where the
Ctrl+B gap above was found.

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

### Remaining gaps (all explicit spec non-goals or LOW-priority tail items)
- Vim mode (`/vim` + its status indicator) — owner-deferred, the sprint's only deferral. (The
  external editor formerly listed here shipped in W1 — Ctrl-X Ctrl-E / Ctrl-G, `externalEditor.ts`.)
- Bash output's `$`/exit-code framing — not reachable: a `tool_result` carries no exit code, only
  `is_error` (the error-framing half already landed).
- Long-output interactive expand, the `›` vs `>` user-echo glyph (intentional divergence), and
  focus-border/input-box styling polish.
