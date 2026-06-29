# TUI/UX parity — `cc-harness-chat` vs. original Claude Code

> **Goal (2026-06-29):** bring our SDK-backed interactive REPL (`cc-harness-chat`, the product
> north star) to the *look-and-feel* level of the original Claude Code TUI. This scorecard is the
> **source of truth for visual/interaction parity** — distinct from `coverage.md` (which scores SDK
> *capability* realization). Tracked feature-by-feature against the reference TS harness in
> `../../Claude Code Src/`.
>
> **Method:** the reference is read for *exact* glyphs / strings / key-bindings / option labels, so we
> match fidelity rather than approximate. Each item is scored ✅ have · 🟡 partial · ❌ missing ·
> 🚫 out-of-scope (bridge-coupled / non-terminal / explicit non-goal). Percentages weight by
> user-visible impact, excluding 🚫 from the denominator.

## Headline

Starting point (pre-work, 2026-06-29): the REPL already has a solid spine — multiline editor with
paste/history/`@`-mention/`/`-command autocomplete, lightweight markdown, live token streaming with
thinking-collapse + tool status + subagent nesting + a task panel, inline permission dialog, model &
session pickers, a status bar, slash commands, and resume/replay. What it lacked was the *chrome and
polish* that makes CC instantly recognizable: **no welcome banner, a non-CC spinner (no verbs / wrong
glyph / no "esc to interrupt"), no `●` message identity, no `!`/`#` input modes, no queued input, no
`/cost`, and thin terminal-native editor ergonomics** (Ctrl-A/E/K/U/W, Ctrl-L, Ctrl-C-twice).

| Category | Parity (start) | Parity (now) |
|---|---|---|
| 1. Input / composer ergonomics | ~45% | ~63% |
| 2. Transcript / message rendering | ~50% | ~64% |
| 3. Status / chrome (banner, spinner, status bar) | ~35% | ~54% |
| 4. Modals / overlays | ~60% | ~60% |
| 5. Slash commands | ~55% | ~68% |
| 6. Polish (glyphs, colors, affordances) | ~40% | ~64% |
| **Overall (impact-weighted)** | **~46%** | **~65%** |

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
| Placeholder / ghost text ("Ask Claude…") | ❌ | MED | CC `usePromptInputPlaceholder.ts` |
| Ctrl-A / Ctrl-E (line start/end) | ❌ | **HIGH** | `useTextInput.ts` — terminal-native, expected |
| Ctrl-K / Ctrl-U (kill to end/start) | ❌ | **HIGH** | `useTextInput.ts` |
| Ctrl-W (kill word back) | ❌ | **HIGH** | `useTextInput.ts` |
| Word movement (Alt/Ctrl ←→) | ❌ | MED | `useTextInput.ts` |
| Ctrl-L (clear screen) | ❌ | MED | standard Unix |
| Ctrl-C twice / Ctrl-D to exit | ❌ | **HIGH** | `earlyInput.ts` — graceful exit affordance |
| Queued messages while busy | ✅ | — | **U6** turns queue while busy + drain FIFO on turn end; `⋯ queued:` indicator; Esc clears |
| `?` shortcuts / help menu | ❌ | MED | `PromptInputHelpMenu.tsx` |
| Vim mode (`/vim`) | ❌ | LOW | large; reachable but low ROI |
| External editor (Ctrl-G / `$EDITOR`) | ❌ | LOW | `PromptInputHelpMenu` |
| Image paste (Ctrl-V) | 🚫 | — | non-terminal / out of scope here |

## 2 — Transcript / message rendering

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| User prompt echo | 🟡 | LOW | we show `› text` dim (intentional clean variant); CC uses `>` |
| Assistant message identity (`●` bullet, accent) | ✅ | — | **U3** accent `●` gutter + aligned continuation (live + replay) |
| Thinking blocks (stream + collapse) | ✅ | — | `liveTurn.ts` `✦ Thinking`; CC `✻`/token count |
| Tool-use rows | 🟡 | LOW | we use `⚙`/live `⟳✓✗` status; CC uses `●` |
| Tool result tree glyph (`⎿`) | ✅ | — | **U3** dim `⎿` result tree |
| Markdown: headers/lists/quote/fenced | ✅ | — | `markdown.ts` (lightweight) |
| Markdown: inline mixed bold/italic spans | ❌ | MED | we strip mixed-style lines (one RenderLine = one style) |
| Markdown: tables | ❌ | LOW | `MarkdownTable.tsx` |
| Markdown: code-block syntax highlight | ❌ | LOW | needs a highlighter; we dim+indent |
| Edit/Write diff | 🟡 | MED | we show +/- capped; CC adds line numbers + context |
| Bash output rendering | 🟡 | MED | generic result preview; no `$`/exit-code framing |
| Long-output truncation + expand | 🟡 | LOW | we cap; no interactive expand |
| Compact boundary marker | ❌ | LOW | `CompactBoundaryMessage.tsx` |
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
| Live token counter during turn | ❌ | MED | CC shows running output tokens in spinner status |
| Elapsed timer during turn | ✅ | — | **U2** whole-turn elapsed in the spinner |
| Context-left % + threshold warning | 🟡 | MED | we show ctx%; no auto-compact warning color |
| Permission-mode indicator (color) | ✅ | — | `ChatStatusBar.tsx` modeColor |
| Cost in status / `/cost` | ✅ | — | **U4** `/cost` via `session.usage()` |
| `? for shortcuts` hint line | ❌ | MED | `PromptInputFooter.tsx` |
| Vim mode indicator | ❌ | LOW | tied to vim mode |

## 4 — Modals / overlays

| Feature | Status | Priority | Notes / CC reference |
|---|---|---|---|
| Permission approval dialog | 🟡 | MED | we have `[a]/[A]/[d]`; CC: numbered "Yes / Yes-allow-session / No" + tool detail |
| Bash permission shows full command | 🟡 | MED | we show brief arg; CC highlights the command |
| Model picker | ✅ | — | `ModelPicker.tsx` |
| Resume session picker | ✅ | — | `SessionPicker.tsx` |
| Task/todo panel | ✅ | — | `TaskPanel.tsx` |
| Plan-mode approval (ExitPlanMode) | ❌ | MED | `ExitPlanModePermissionRequest` |
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
| `/vim` | ❌ | LOW |
| `/doctor` `/config` `/theme` `/terminal-setup` | 🚫/LOW | env/IDE-coupled |
| `/copy` | ❌ | LOW — clipboard |

## 6 — Polish

| Detail | Status | Priority |
|---|---|---|
| Asterisk-pulse spinner animation | ✅ | **U2** |
| Random thinking verbs | ✅ | **U2** |
| `●`/`⎿` message prefix glyphs + accent colors | ✅ | **U3** (`>` user echo kept as `›` by choice) |
| "esc to interrupt" everywhere a turn runs | ✅ | **U2** |
| Double-Esc to exit / rewind affordance | ❌ | MED |
| Newline instructions hint | ❌ | LOW |
| Focus borders / input box styling | 🟡 | LOW |

---

## Execution plan (increments)

Ordered by **first-impression impact ÷ effort**. Each increment: pure reducer + thin view, keyless
unit tests, typecheck + build green, commit, update this scorecard.

- **U1 — Welcome banner** (§2,§3): a launch splash (product name + cwd + model + mode + tips +
  `? for shortcuts`). First thing a user sees. ✅/❌ tracked above.
- **U2 — Authentic spinner** (§3,§6): `✻` asterisk-pulse frames + the 187 random verbs +
  `(Ns · esc to interrupt)` status; show it during streaming too, not just the pre-first-frame gap.
- **U3 — Message identity** (§2,§6): `●` assistant bullet (accent) + `>` user + `⎿` tool-result tree —
  CC's recognizable transcript shape.
- **U4 — `/cost` + `/status`** (§3,§5): cheap, `usage()` already wired.
- **U5 — `!` bash + `#` memory modes + mode indicator** (§1): distinctive CC input affordances.
- **U6 — Queued input while busy** (§1): type-ahead during a turn.
- **U7 — Editor ergonomics** (§1): Ctrl-A/E/K/U/W, Ctrl-L, Ctrl-C-twice/Ctrl-D, placeholder, `?` help.

Later / lower ROI: inline markdown spans, plan-mode approval, richer permission dialog, vim mode,
tables, syntax highlight.
