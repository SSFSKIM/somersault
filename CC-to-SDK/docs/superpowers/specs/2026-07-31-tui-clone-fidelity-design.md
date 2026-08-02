# TUI clone fidelity — design

> The successor to the TUI/UX sprint (`2026-07-30-tui-ux-sprint-design.md`), and the consumer of the
> six-report research inventory at
> `../research/2026-07-31-tui-clone/00-INVENTORY.md` — **271 deduplicated gaps** between
> `ccx`'s Ink REPL and Claude Code 2.1.220. The sprint asked "does the surface exist?". This asks
> "does it look and behave like Claude Code?", and answers it at the level of glyphs, colours, exact
> literals, key precedence and layout.

## Purpose

The owner's brief is one sentence: **the only goal is cloning with highest possible fidelity.**
Fidelity is the tiebreaker for every ambiguous call — where our behaviour and upstream's differ and
both are defensible, upstream wins. This document turns that sentence into a buildable program: nine
waves, each with a theme, hard dependencies, explicit non-goals, and acceptance written as what a
person sitting in a terminal would see.

Two things make this the right moment. First, we have the real thing to copy: `~/claude-code-bundle/2.1.220/`
is the exact binary our SDK spawns, reprinted to 579,698 readable lines, and six research reports have
already read it into a gap inventory with per-item evidence. Second, the two questions that would have
made a third of the work guesswork are settled by committed live probes — the tool wire's shape (probe 77)
and the permission callback's real field set (probe 78).

The headline finding of the research is not the gap count. It is that **our own parity scorecard scores
✅ on roughly twenty rows that measurably diverge**, so the instrument we would use to measure this
effort is currently broken. Fixing the map is therefore the first deliverable, not the last.

## Grounding

Every load-bearing premise below is either a committed live probe, a bundle line citation carried from
the research reports, or a constraint we have already paid for in a shipped wave.

| Evidence | What it settles | Strength |
|---|---|---|
| **probe 77** (`probes/probes/77-tool-result-shape.ts`, commit `19f9845555`) | The SDK's tool wire is **flat text**. Every `tool_result` carried only `{tool_use_id, type, content, is_error}` with `content` a plain string — no `structuredPatch`, no line counts, no match counts. Upstream's typed result rows must be **derived client-side**. Read/Grep/Glob counts derive from result text, Write from `input.content`, Edit's add/remove from `old_string`/`new_string`; **absolute diff line numbers are the sole exception**. Also: this SDK's tool vocabulary is not upstream's — the model reached for **Bash to grep and glob**, there is **no `LS`**, and todos are `TaskCreate`/`TaskUpdate` **behind `ToolSearch`** | direct |
| **probe 78** (`probes/probes/78-permission-wire-shape.ts`, commit `a9cd9d9272`) | `canUseTool`'s options argument carries `signal · suggestions · blockedPath · decisionReason · title · displayName · description · toolUseID · agentID · requestId`. The declared `suppress_always_allow_rule`, `decision_reason_type` and `classifier_approvable` are **absent on the live wire** — the static reading of `sdk.mjs` is confirmed. `updatedPermissions` **round-trips**: granting on the first consult produced **zero consults** on the second identical call. And the design-changing part: **the engine suggests the rule itself**, per tool, in `suggestions`, in exactly the shape the return value accepts (`{type:"addRules",rules:[{toolName,ruleContent}],behavior,destination}` for Read; `{type:"setMode",mode:"acceptEdits"}` for Write/Edit) | direct |
| Research reports 01–06 + `00-INVENTORY.md` (2026-07-31) | 271 deduplicated gaps with per-item bundle citations; 9 structural, 8 tier-0 harm, ~38 do-not-clone, ~14 places we ship more than upstream | derived from the bundle |
| Bundle `cli.pretty.js` — keymap `jar` L186,116 · context registry `War` L186,159 · resolver `ePt` L183,234 · scope chain `Gbp` L398,368 · dispatch `cZs` L398,121 · `keybindings.json` loader `TQr` L186,316 | Upstream's keybinding architecture: a declarative table over 19 context blocks (20 valid contexts), resolved against an **ordered** context array built by walking the focused node's parent chain, **first match wins**, `Global` always last, with `swallowAll` and `preemptiveScopes` layered above it | direct |
| Bundle — statusLine component `b0b` L484852 · payload builder `H0b` L484846 · runner `B8s` L366191 · config parser `sMt` L147037 · schema L188988–189060 | The statusLine extension point: `{type:"command", command, padding?, refreshInterval?, hideVimModeIndicator?}`, a 20-field stdin JSON plus **five undocumented emitted fields** (`cost`, `exceeds_200k_tokens`, `fast_mode`, `remote`, `pr.kind`), 300 ms-debounced re-run on nine signals, optional polling, AbortController, workspace-trust gate, **nothing rendered on non-zero exit** | direct |
| **probe 55** (F4) | `usage().rate_limits` is populated **only under the interactive credential**; under `CLAUDE_CODE_OAUTH_TOKEN` it is `null`. The statusLine payload's `rate_limits` block is therefore sometimes unsourceable | direct |
| **probes 37/37b** (Wave 1) | In-place rewind is **destructive**; `forkSession` branches. Relevant to the one place we keep a safety step upstream does not have | direct |
| TUI/UX sprint Wave 1–2 lessons | Ink's `<Static>` is append-only: unmounting replays the whole scrollback. This kills the alt-screen renderer, the composer's fullscreen viewport, and theme-repaint-of-history — all recorded already at `docs/parity/tui-ux.md:91–93` | direct (paid for) |
| TUI/UX sprint Wave 3 (`/permissions`) | Rule mutations ship as a **flag-layer + settings-file dual write** — apply live via `applyFlagSettings`, persist to `.claude/settings*.json` for the next launch. The persistence half of "don't ask again" has a shipped precedent | direct (shipped) |

## Scope, honestly

**What "highest possible fidelity" costs.** Of 271 gaps, roughly 38 are argued do-not-clone and
roughly 25 are unreachable (§ Cannot build), leaving **about 205 buildable entries**. Around 55 of
them are single-line or single-function edits; the rest are not. At the inventory's own S/M/L
estimates that is on the order of **60–75 engineer-days of implementation**, before planning, review
and acceptance. This repo's demonstrated cadence — spec → child plan → subagent-driven execution →
independent review → pty acceptance — has been landing waves of ~15 items in 2–4 calendar days. These
waves carry 15–45 items each. Expect **4–8 calendar days per wave and 6–10 calendar weeks end to
end**, plus five probe sessions.

That is not a sprint. It is a quarter-scale program, and it should be run like the TUI/UX sprint was:
each wave merged to `main` and live-tested by the owner before the next one starts.

**Where the asymptote is.** Even with every buildable entry shipped, we do not reach 100%, and the
residual is not cosmetic:

1. **The transcript is a transcript of a different agent.** Probe 77 found the model reaches for Bash
   where upstream's model reaches for Grep and Glob, and there is no `LS`. A Claude Code user will see
   `⏺ Bash(rg -n "foo" src/)` where they expect `⏺ Grep(foo)`. No renderer work changes that; the
   difference lives in the tool catalog and the model's choices, not in our UI. We can soften it by
   classifying Bash command text into upstream's search/read/list clause families (upstream already
   does exactly this in `Kr_`), so the *collapsed summary* reads like Claude Code's even when the
   expanded row does not. The owner has since settled the further question (2026-07-31): **the model
   keeps Bash — no Grep/Glob steering.** Current Claude Code itself moved search into Bash (the owner's
   observation, corroborated by a live harness session exposing no Grep/Glob to the model), so
   Bash-as-search plus the `Kr_`-style clause classifier *is* the upstream-faithful shape, not a
   concession. P94's census remains needed for `ST3`/`LT2`'s vocabulary, but its steering sub-question
   is closed.
2. **Anything gated on an alternate screen.** Ink's `<Static>` is append-only. The fullscreen
   renderer, the composer's scrolling viewport, right-column suppression and theme repaint of history
   are out, permanently.
3. **Typed permission reasons.** Probe 78 confirmed three declared fields never arrive. Our "don't
   ask again" row will sometimes appear where upstream hides it, and our consent-reason line can only
   be upstream's free-text sentence, never its eight typed variants with their config hints.
4. **Derived summaries are derived.** Absolute diff line numbers come from reading the file
   ourselves; when the file has changed since the edit we fall back and say so. Upstream reads the
   tool's own return value and is never wrong.
5. **Remote-coupled chrome and IDE surfaces** — PR badges, cloud sessions, announcements, artifact
   publishing, LSP diagnostics, `⧉ N lines selected`. No channel exists.

A fair statement of the ceiling: **roughly 85–90% of the observable surface**, with the residual
concentrated in (1) — which is the most visible of the five and the least fixable by this program.

## The instrument, before the work

The previous sprint's acceptance was a pty run plus a human reading the transcript. That caught real
defects and it cannot possibly catch this class: a bullet that is `●` where it should be `⏺`, a colour
that is accent where it should be plain text, a `⎿` at four columns instead of five. Fidelity defects
are exactly what human transcript-reading misses.

So F0 ships a **frame corpus** before any fidelity work begins:

- `harness/scripts/capture-frames.py` drives a target binary — real `claude` **or** `ccx` — under a pty
  at fixed geometries (100×40 wide, 68×24 narrow), through a scripted keystroke file, capturing raw
  output **including SGR** after each step. (The existing `clean-pty.py` strips ANSI; here the ANSI *is*
  the artefact.)
- Golden frames are captured once from real Claude Code and committed under
  `harness/test/fixtures/upstream-frames/<script>/<NN>.ansi`, with the bundle version recorded
  alongside.
- Nondeterministic regions — model-authored text, durations, session ids, absolute paths, token
  counts — are masked before diffing.
- A wave's acceptance is: **the frames its scripts cover diff clean outside the masks.** Every
  deliberate divergence is registered in an allowlist keyed by inventory ID, so an unexplained diff
  always fails.

Most fidelity questions need no model turn at all — open the help overlay, open the model picker, type
and clear, cycle permission modes, resize — which keeps the upstream capture cheap and repeatable. A
small number of scripted deterministic turns cover the live-turn and transcript waves.

## The waves

Nine scheduled waves, **F0–F8**, plus an explicitly unscheduled tail. (The `F` prefix keeps them
distinct from the TUI/UX sprint's Wave 1–3, which are already in commit history and memory.) Every
wave ends with a `tui-ux.md` update and a frame-corpus run. Dependencies are hard unless marked *soft*.

---

### F0 — Stop lying: the harm list and the map · ~3 days

**Theme.** Nothing here is about fidelity. Every item either costs a user typed text, advertises a key
that does not work, or scores our own progress wrong. All of it is S-effort and none of it needs a new
abstraction.

**Delivers.**
- **Text destruction:** `CM49` (Escape pops the queue back into the composer before interrupting,
  instead of discarding it), `CM15/CM16` (Esc-Esc clears the composer and pushes the text to prompt
  history; rewind arms only on an empty composer), `CM10`+`CM11` (a real kill ring with `ctrl+y` yank
  and `alt+y` yank-pop, plus the `Ctrl+Y to paste deleted text` notice after a kill of ≥3 characters).
- **False advertising:** `KB4` (`ctrl+_` undo — make it reachable by matching `input === "\x1f"`;
  settled 2026-07-31: the undo stack already exists and works in `editor.ts`, only the chord never
  reaches it because terminals send the bare byte, which today falls through into the buffer),
  `KB6` (the `?` overlay binds Escape only, and `ChatApp`'s global handler is gated on `shortcutsOpen`
  so the key cannot double-fire), `KB23` (delete the three dead branches: `pager.ts:32`'s `key.shift`,
  `editor.ts:239`'s `ctrl+j`, and KB4's).
- **Surprises:** `KB3` (`ctrl+d` needs two presses), `KB5` (`ctrl+z` returns to the shell as SIGTSTP;
  detach moves to the `/detach` slash command **only** — no chord, owner decision 2026-07-31: detach
  is ccx-only so any chord is a divergence and a permanent collision hazard for F2's upstream table),
  `KB1` (bind `y`/`n`, keep `a`/`A`/`d`/`D` and digits as aliases).
- **The honesty audit:** a test that enumerates every chord printed by `ShortcutsOverlay` and the
  footer against the live handler set. No string may advertise a chord that is not live.
- **The map:** apply all ~20 scorecard corrections (§ The scorecard), add the missing structural rows,
  move over-ships out of the parity denominator, repoint the scorecard's stated method away from
  `Claude Code Src/`, and recompute the headline.
- **The instrument:** `capture-frames.py` plus the first upstream golden captures.

**Depends on.** Nothing.

**Non-goals.** Any new abstraction. The kill ring here is a plain ring, not the `pastedContents`-aware
undo integration (`CM17`, F5). The keybinding table is *not* built here — F0's fixes are point fixes
that F2 re-homes into the table.

**Acceptance.**
1. With a turn running and three messages queued, pressing Escape leaves the composer holding all
   three, newline-joined, cursor at the end, queue empty, turn interrupted. Nothing typed is lost.
2. With text in the composer, Escape shows `Esc again to clear`; a second Escape empties it; pressing
   Up immediately brings it back as the newest history entry. The rewind picker never opens while the
   composer holds text.
3. `ctrl+u` on a full line then `ctrl+y` restores it verbatim; `alt+y` cycles to the previous kill.
4. Pressing `ctrl+_` undoes the last edit. No control character ever appears in the buffer.
5. With the `?` overlay open, `ctrl+o` neither closes the overlay nor opens the transcript pager —
   only Escape closes it, and no key pressed while it is open reaches the app underneath
   (`ctrl+z` suspend excepted: suspension is process-level, like a real shell).
6. `ctrl+d` on an empty composer prints a hint and stays; a second press exits. `ctrl+z` suspends to
   the shell and `fg` resumes with the transcript intact.
7. `y` accepts and `n` rejects in a permission dialog.
8. `docs/parity/tui-ux.md` scores no ✅ on any row the research listed as divergent, names
   `~/claude-code-bundle/2.1.220/` as its reference, and its headline has moved down.

---

### F1 — The rendering substrate · ~5 days

**Theme.** One renderer, one gutter, one result vocabulary, one verbose flag, one colour token set.
Nothing downstream can be built twice after this lands.

**Delivers.**
- `ST1` — a single tool-row renderer serving both the live turn and replay. Today `liveTurn.ts:renderBlock`
  emits `Name target` and `render.ts:renderMessage` emits `● Name(target)` for the same call; the six
  research reports disagreed about our own behaviour because they read different files.
- `ST9` — the gutter and overflow primitives: `⎿` emitted **once** at five columns with the body in a
  sibling column (not prefixed to every line at four), and one `… +N {unit}` overflow component with an
  optional expand hint, replacing three ad-hoc "more" strings.
- `ST3` — the result-summary normalization layer grounded by completed P94 evidence on SDK 0.3.220:
  preserve both flat `tool_result` content and the per-call `SDKUserMessage.tool_use_result` sidecar, plus
  privacy-safe result provenance. Prefer a uniquely associated recognized sidecar shape, then fall back to
  deterministic derivation from complete tool input plus flat result text. A successful result completes
  only the waiter owning its `user_message_uuid`; when origin is explicit, it must match that waiter's
  submitted provenance class. UUID-less SDK errors may use FIFO only when their explicit origin matches the
  head waiter. Background/synthetic results remain retained records, not interchangeable completions.
  Upstream's Bash-command classifier (`Kr_`) remains the transferable collapse predicate. Unknown,
  forwarded, or sidecar-less calls use the generic fallback rather than guessed structure.
- `ST2` — one canonical retained transcript source with two projections. The normal live projection stays
  append-only and compact; `ctrl+o` opens a distinct detailed transcript over the retained messages/events,
  untruncated by default. `ctrl+e` inside that transcript explicitly toggles show-all/collapse and never
  mutates already printed live history. This ships with its first consumer, `LT6`: compact output shows the
  first three wrapped lines at `cols−10`, then `… +N lines (ctrl+o to expand)` with the one-hidden-line
  special case; the detailed show-all projection renders the complete source and no hint.
- `ST4` — widen `ThemeTokens` from 3 to the ~30 of upstream's 72 that we actually paint, and route every
  hardcoded colour word in `render.ts`, `highlight.ts`, `markdown.ts`, `ChatStatusBar.tsx` and
  `ChatComposer.tsx` through it. Plus `TH2` (the `rgb()`/`#hex`/`ansi256()`/`ansi:<name>` value grammar
  with a validator), `TH4` (`light*` prefix drives contrast decisions), `TH7` (the six-token diff family).
- Free riders, all S, once one renderer exists: `LT7`, `LT8`, `LT10`, `LT11`, `LT12`, `LT13`,
  `LT15`, plus `LT14`'s interruption and rejection surfaces. `LT14`'s auto-classifier annotation remains
  behind P85/F3, and `LT5` moves with the collapsed-group state that owns its elapsed suffix in F3.

**Depends on.** F0 (soft — avoids merge conflicts in `editor.ts` / `ChatApp.tsx`). P94 (hard, for ST3's
vocabulary).

**Non-goals.** The collapsed-group clause grammar (`LT2`, F3). Markdown (F4). ANSI and custom themes,
shimmer tokens, theme repaint of history.

**Acceptance.**
1. The same Read call renders byte-identically during the turn and after `/resume` — including a
   sidecar-bearing live fixture and its flat-only fallback fixture — verified by frame diff, not inspection.
2. A tool row reads `⏺ **Read**(src/app.ts)`: the bullet is `⏺` on macOS and `●` elsewhere, the name is
   bold, the parens are added by the row, and the path is cwd-relative and an OSC-8 link.
3. A tool result shows `⎿` exactly once, at column five, with its body in a column beside it.
4. A 40-line compact result shows three lines and `… +37 lines (ctrl+o to expand)`; `ctrl+o` opens the
   detailed transcript with all 40 retained source lines and no hint. Inside that view `ctrl+e` collapses
   the result and changes the local hint to `ctrl+e to show all`; pressing it again restores all 40.
5. A running tool shows a dim bullet blinking at 600 ms, a finished one the success colour, a failed
   one the error colour. No `✓` or `✗` appears anywhere.
6. Switching theme visibly recolours every element of newly rendered output; grepping the five named
   files for bare colour words returns nothing.
7. An interrupted tool reads `⎿ Interrupted · What should Claude do instead?`; a denied one reads
   `⎿ Tool use rejected`.

---

### F2 — The keymap as data · ~4 days

**Theme.** Port upstream's architecture rather than patch keys. Three separate key bugs have shared one
root cause: we have no precedence model.

**Delivers.**
- `ST5` — the declarative binding table: contexts named after upstream's 19 blocks, our bindings, one
  source of truth; `car()`-style normalisation with `alt ≡ meta`; a reserved-key registry.
- `ST6` — the ordered-context resolver. Upstream builds its context array by walking the focused node's
  parent chain and appending `Global` last; **Ink has no focus tree and no propagation stopping**, so we
  substitute deliberately: one `useInput` subscriber at the root, an explicit React context stack that
  each mounted surface pushes its context name onto, first match wins, a binding to `null` consumes the
  key as explicitly unbound. `swallowAll` and preemptive scopes layer above the chain, as upstream's do.
  This replaces 17 ad-hoc `useInput` callbacks and the nested-ternary-plus-six-flags arrangement in
  `ChatApp.tsx` that currently produces the double-fires.
- `KB22` — generic space-separated chords with a **1 s** inter-key timeout (ours is a bespoke 2 s
  hardcoded to `ctrl+x`), Escape cancels a pending chord.
- `~/.claude/keybindings.json`: additive merge, later-wins within a context, `null` unbinds, chokidar hot
  reload, typed validation (`parse_error`/`invalid_context`/`invalid_action`/`duplicate`/`reserved`), and
  the `command:<name>` action form legal only in the Chat context.
- **Every hint string generated from the live binding** — which is what makes `DG63` (the shortcuts grid)
  and `CH2` (the hint ladder) cheap later, and makes F0's honesty audit structural rather than a test.
- Re-home F0's point fixes into the table. Plus `KB8`, `KB14`, `KB15`, `KB18`.

**Depends on.** F0 (hard — its fixes are the first table entries), F1 (soft). Scoped by **P86**.

**Non-goals.** `KB12` (the Scroll context: mouse, wheel, selection, copy), `KB13` (focusable footer),
`KB16` (Settings keys), `KB19` (theme-picker extras), `KB21` (`/terminal-setup` writing the host
terminal's keymap). Bindings P86 shows Ink cannot deliver are **recorded as unreachable, not written and
left dead** — that is the whole point of running the probe first.

**Acceptance.**
1. Adding `{"context":"Chat","bindings":[{"key":"ctrl+g","action":"chat:externalEditor"}]}` to
   `~/.claude/keybindings.json` takes effect without restarting ccx; setting an existing key to `null`
   unbinds it and the next context down does **not** inherit it.
2. With the `?` overlay open, no keypress reaches the chat. With a picker open, `j`/`k` move its
   selection and never the transcript.
3. `ctrl+x` then `ctrl+k` within a second stops all agents; `ctrl+x` then Escape cancels; `ctrl+x`, a
   two-second pause, then `ctrl+k` does nothing.
4. Rebinding `chat:cycleMode` changes the parenthetical printed in the footer's mode chip and in the
   shortcuts overlay, with no code change.
5. `alt+d` and `meta+d` do the same thing.
6. Every key P86 found undeliverable appears in `tui-ux.md` as unreachable with its evidence, and in no
   table and no hint string.

---

### F3 — The live turn · ~4 days

**Theme.** What you watch while Claude works: collapsed groups, typed result rows, agent progress.

**Delivers.** `LT1` (per-tool typed result rows on F1's derivation layer — `Read 340 lines`,
`Found 3 files`, `Added 2 lines, removed 3 lines`, `Wrote 42 lines`, `Received 42.1 kB (200 OK)`),
`LT2` (collapsed read/search/list groups with a clause grammar built from **our** census — first clause
capitalised, `", "` joins, bold counts, latch-to-max, finished group entirely dim), `LT5` (the group's
single elapsed suffix after two seconds; never a per-row duration), `LT3` (≥2 same-name
tool_use blocks collapse to `Running 3 agents…` / `3 agents finished`), `LT4` (the throttled live hint
line), `LT16` and `LT17` (agent progress: last three inner rows plus `… +N tool uses (ctrl+o to expand)`,
then `Done (7 tool uses · 24.1k tokens · 1m 12s)`), `LT18` (Write preview = first 10 highlighted lines),
`LT20` (the `(ctrl+b to run in background)` row hint), `CH23` (the 77-entry irregular-past conjugation
table that drives the **grouped activity line**, not the spinner).

**Depends on.** F1 (hard: ST1 + ST2 + ST3 + ST9). P82 gates `LT2`/`LT5`'s duration source. P94's
Agent sidecar supplies exact top-level tool/token/duration totals; P83 still gates nested or flat-only
Agent fallback and teammate identity semantics.

**Non-goals.** `LT19` (Bash incremental stdout), `LT21` (hook-timing rows), `LT22` (auto-mode classifier
annotations) — all gated on P84/P85 and all low value if those come back negative.

**Acceptance.**
1. Three consecutive reads collapse into one row reading `Read 3 files`, gaining ` · 12s` once the oldest
   unresolved tool passes two seconds. **No per-row elapsed appears anywhere.**
2. A Read shows `⎿ Read 340 lines`; a Bash used as a search shows `Found 3 files`; a Write shows
   `Wrote 42 lines`; an Edit shows `Added 2 lines, removed 3 lines`.
3. A `TaskCreate` renders nothing at all, and a `ToolSearch` contributes no visible row and no clause.
4. A running subagent shows its last three rows plus `… +12 tool uses (ctrl+o to expand)`; `ctrl+o`
   expands it; on finish the row reads `Done (…)` with a token count.
5. A foreground Bash shows a dim `(ctrl+b to run in background)` beneath it, indented five columns.

---

### F4 — The static transcript: markdown, diffs, message species · ~6 days

**Theme.** What you read after the turn. The largest single-domain block, and the one that unblocks the
dialog wave.

**Delivers.**
- **Markdown on `marked`** (`TR5`) with the full node set and an LRU-cached lexer, and everything it
  unlocks: `TR6`–`TR21` — heading depth styles with two trailing newlines, the literal `-` bullet,
  nested indent at `2×depth` with `1.`/`a.`/`i.` numbering honouring `start`, task lists, the `▎`
  blockquote rail with italic content, `---` for `hr`, OSC-8 links with a `text (url)` fallback, images,
  strikethrough, inline code in the `permission` token, box-drawn tables with per-column alignment and a
  rule between every pair of data rows, `gap: 1` between top-level blocks, unindented code blocks, the
  **language-label polarity flip** (shown only when the language is *unrecognised*; unknown blocks stop
  being dimmed), and the widened fence-language regex. `TR18` (streaming fence re-prepend) if cheap.
- **Diffs**: `TR23` (the `Added **3** lines, removed **1** line` header with positional capitalisation),
  `TR24` (hunks interspersed with a dim `...` and **no `@@` headers**), `TR25` (**absolute line numbers
  read from disk**, per the owner's decision, falling back to snippet-relative with a visible marker when
  the file is missing or has changed), `TR26` (full-width background bands, not foreground colour),
  `TR27` (word-level intra-line diff bailing above 40% change), `TR28` (wrapping at
  `width − gutter − 3` with a blank number gutter on continuations), `TR29` (**no** line-count
  truncation — only collapse plus the expand hint, replacing our hard 24-line cap).
- **Identity**: `TR1` (bullet in the plain `text` token, not accent), `TR2` (`❯ ` in `subtle` on a
  `userMessageBackground` band), `TR3` (>10 000-char prompts fold head/rule/tail), `TR4` (queued
  messages indented two columns).
- **Thinking**: `TR30` (hidden unless verbose), `TR31` (`✻ Thinking…` — U+273B, not our U+2726),
  `TR32` (`∴` gutter, dim italic, content through the markdown renderer), `TR33` (`Thought for 12s` —
  a live-ticking duration, gated on P82).
- **Message species**: `TR35` (the ten sentinel-tagged user texts routed to dedicated renderers, with
  `<local-command-caveat>` rendering nothing), `TR36` (the compact-summary form, gated on P81),
  `TR37` (the ~12 system subtypes), `TR38` (the assistant-text error sentinels, gated on P80),
  `TR39` (teammate attribution with `TH6`'s eight reserved subagent colour tokens).

**Depends on.** F1 (hard: tokens, gutter, verbose flag). Probe batch B (P80, P81, P82).

**Non-goals.** `TR22` (full highlight.js — see § Exceptions), `TR34` (image attachments, P87), custom
themes.

**Acceptance.**
1. A reply containing nested bullets, an ordered list starting at 3, a task list, a blockquote, a
   horizontal rule, a link, an image and struck-through text renders each one the way Claude Code does —
   frame-diff clean.
2. A three-column table draws a box with a rule between every pair of data rows and per-column alignment.
3. An Edit renders `Added 3 lines, removed 1 line`, full-width bands, word-level highlighting inside a
   changed line, and **line numbers that match `cat -n` on that file**. Editing the file behind ccx's
   back and re-rendering shows snippet-relative numbers with a visible approximation marker, never a
   confident wrong number.
4. Thinking is invisible by default; `ctrl+o` reveals it with an `∴` gutter, markdown formatting and a
   `Thought for 12s` summary.
5. Pasting a 12 000-character prompt into the transcript shows head, a titled `(N lines hidden)` rule,
   and tail.

---

### F5 — The composer · ~6 days

**Theme.** Every keystroke before Enter.

**Delivers.** Paste chips end to end (`CM21`–`CM27`: the `[Pasted text #N +M lines]` chip above 800
characters or two newlines, atomic deletion, cursor snap-out, smart spacing, the `Pasting…` indicator,
ANSI/CRLF/tab normalisation). Persisted history (`CM52`–`CM57`: `~/.claude/history.jsonl`, append-only
with a lock, **newest-wins dedup across the whole scan** rather than consecutive-only, a per-index edit
cache, mode filtering, the one-time `ctrl+r` hint). Queue semantics on top of F0's rescue (`CM47`,
`CM48`, `CM51`). Form and editing model (`CM1`–`CM5`, `CM8`, `CM12`, `CM14`, `CM17`, `CM18`, `CM20`).
Autocomplete (`CM28`–`CM30`, `CM34`–`CM40`: Tab accepts without executing while Enter accepts *and*
executes, wrapping selection, upstream's popup geometry, the whitespace-preceded slash trigger, ghost
text, `argumentHint` inline, iterative directory completion, debounced async sources with stale-response
guards). Both search UIs (`CM58` inline reverse-i-search, `CM59` picker preview pane).

**Depends on.** F0 (hard — the Escape and kill semantics must be right first), F2 (hard — every binding
here goes in the table, not into a new `useInput`). Scoped by P86.

**Non-goals.** Vim (`CM60`). Images and clipboard (`CM42`–`CM45`, gated on P87). Mouse (`CM33`).
Highlight spans in the buffer (`CM61`). The other completion sources — emoji, Slack, MCP resources,
teammates (`CM41`). `CM7` (fullscreen viewport) and `CM6` (focus-loss cursor) are recorded unreachable.

**Acceptance.**
1. Pasting 40 lines inserts `[Pasted text #1 +40 lines]`; one backspace deletes the whole chip; the
   submitted message contains the full 40 lines.
2. Prompt history survives quitting and relaunching ccx. The same prompt sent twice appears once,
   newest-first. Editing a recalled prompt, arrowing away and arrowing back preserves the edit.
3. Typing `/mod` shows dim ghost text completing it; Tab accepts without submitting; Enter accepts and
   submits.
4. Accepting `@src/` in the file popup reopens the popup one level deeper instead of closing it.
5. The composer has a rule above and below and no side borders; `❯` dims while a turn runs; arrowing
   history writes `── History 3/57 ──` into the top rule and hides it once the entry is edited.

---

### F6 — Dialogs, pickers, panels · ~6 days

**Theme.** The largest cluster (69 entries), and the one probe 78 unlocked. Upstream has no "a
permission dialog": it has a registry of 13 kinds behind a per-tool matcher, and everything except
ExitPlanMode renders **inline in the transcript** with the composer still mounted.

**Delivers.**
- `ST7` — one `Select` (absolute indexes, gutter overflow arrows, inline descriptions, `type:"input"`
  rows, height-clamped paging) and one `Tabs`, replacing nine hand-rolled lists.
- **The permission family**: `DG1` (the kind registry and matcher, including Bash-as-`sed -i` routing to
  the file dialog), `DG2`, `DG3` (the 16-pattern destructive-command warning table), `DG6`–`DG10`,
  `DG12`–`DG15`, `DG19`, `DG21` (attribution as a frame-header suffix, not a line above), `DG24`,
  `DG26`, `DG27` (inline in the transcript).
- **A real "don't ask again"**, built the way probe 78 showed: **echo the engine's own `suggestions`
  entry back** in `updatedPermissions` rather than inventing a rule grammar, with the option wording
  following the suggestion *kind* (a directory glob for reads, accept-edits for writes — which is
  exactly why upstream's two dialogs offer different things). Persist via the Wave-3 dual write. Where
  two variants arrive (the raw and the symlink-resolved path), the dialog picks or offers.
- **Plan mode**: `DG28`, `DG29` (the only modal dialog: `Ready to code?`), `DG30`, `DG31` (an inline
  input whose empty submit keeps the dialog open), `DG34`.
- **Rewind**: `DG38`–`DG40`, `DG42`, `DG44` — including per-row `+A −R` computed **before** selection.
- **Pickers**: `DG45`, `DG46`, `DG49`, `DG50`, `DG51`, `DG55`.
- **Panels**: `DG56`–`DG60`, `DG62`, `DG63` (the shortcuts grid resolved from F2's live table).

**Depends on.** F1 (tokens, gutter), **F4 (hard — the permission dialog bodies *are* the transcript's
diff and markdown leaf renderers; building them before F4 means building them twice)**, F2 (contexts,
`Confirmation`/`Select`/`Tabs`).

**Non-goals.** `DG35`–`DG37` (DiffDialog and the vestigial sidebar — see § Exceptions), `DG4` (the
ctrl+e LLM explain pane), `DG16` (workflow dialog), `DG47`/`DG48` (pricing and effort axis, P88),
`DG41` (anchored summarize, P91), `DG53`, `DG64`, `DG17` (PowerShell). `DG22`/`DG23` are unreachable.

**Acceptance.**
1. A Bash permission prompt is titled `Bash command`, shows the rendered command and its dim
   description, asks `Do you want to proceed?`, and for `rm -rf` or `git reset --hard` adds the matching
   warning line in the warning colour.
2. Choosing `Yes, and don't ask again for: npm run *`, then quitting and relaunching ccx, runs the same
   command with no prompt — and the rule is visible in `.claude/settings.local.json`.
3. An Edit permission prompt shows the real diff inline in the transcript with the composer still
   visible below it, not a full-screen replacement.
4. A plan approval is titled `Ready to code?`; choosing `No, keep planning` and submitting empty
   feedback leaves the dialog open rather than denying.
5. The rewind picker shows each row's file-change summary before anything is selected.
6. `j`/`k`, `ctrl+n`/`ctrl+p`, PageUp/PageDown and Home/End move the selection in every list in the app.

---

### F7 — The footer contract, notifications, and statusLine · ~5 days

**Theme.** The out-of-the-box footer becomes Claude Code's. Everything we show beyond it survives as an
opt-in, and the extension point upstream actually uses gets built.

**Delivers.**
- `ST8` — the notification queue: four priorities, `fold`/`invalidates`/`pinned`, 8 s default,
  preemption and requeue. Today `notice()` appends a transcript line.
- **The default footer, upstream-exact**: `CH1` (the mode chip from a six-entry symbol/indicator/colour
  table, rendered in **every** mode including default) and `CH2` (the 11-rung hint ladder with exactly
  one winner, `? for shortcuts` only when everything else is empty and the mode is default, bash mode
  short-circuiting). Plus `CH9` (width-aware truncation at three points) and `CH8` (`{tokens} tokens`
  under verbose only).
- **The demotions** (owner decision 1): model name (`CH3`), plan-usage chip (`CH6`), thinking level
  (`CH7`), `esc to interrupt` moved into the hint ladder (`CH19`), the streaming chip and background
  count (`CH5`) all become **settings-gated opt-ins**, default off. Capability preserved; the
  out-of-the-box experience is Claude Code's.
- `CH4` — the context indicator becomes a **threshold-triggered transient notification**, hidden
  entirely at `ok`, with upstream's wording; plus `CH32` and `CH33`, the other queue producers.
- `CH11` — **the statusLine extension point**: the `{type:"command", command, padding?,
  refreshInterval?}` config, the 20-field stdin JSON plus the five undocumented emitted fields, the
  300 ms debounce over the nine signals, `refreshInterval` polling, AbortController cancelling the prior
  run, the workspace-trust gate, multi-line dim truncated output, and **nothing rendered on non-zero
  exit** — no stale text, no error shown. Plus a `statusline-setup`-equivalent agent.

**Depends on.** F1 (tokens). P89 (the context-window block and CH4's thresholds), P95 (which payload
fields we can source at all).

**Non-goals.** `CH22` (the tip scheduler — see § Exceptions), `CH38` (screen-reader layout), `CH39`
(auth and updater chrome), `CH10` (chrome-wide OSC-8 for PR badges and cloud sessions — the data does
not exist).

**Acceptance.**
1. On a fresh install the footer contains exactly the permission-mode chip and one hint line. No model
   name, no cost, no percentage, no streaming chip, no background count.
2. Setting `footer.showModel: true` restores the model chip and nothing else.
3. Configuring `statusLine` to `jq -r .model.display_name` prints the model above the hint row, re-runs
   within 300 ms of a permission-mode change, and renders **nothing at all** when the command exits
   non-zero.
4. **A status line script written for real Claude Code runs unmodified against ccx.** Fields we cannot
   source are absent or null; none is invented.
5. Context usage is invisible until the threshold, then appears as `23% until auto-compact` and expires
   on its own; a second notification of the same kind replaces rather than stacks.

---

### F8 — Spinner, startup, and terminal integration · ~4 days

**Theme.** The parts of the chrome that talk to the terminal emulator, plus the two screens a user sees
most often without reading.

**Delivers.** Spinner: `CH12` (frame index as a **2000 ms triangle wave over six base glyphs** on a
100 ms clock, 50 ms while requesting — ours is a 120 ms tick over twelve frames), `CH13` (the
`xterm-ghostty` glyph variant), `CH14` (delete `"Evaporating"`, our 187th verb), `CH15` (the random verb
is the **last** fallback, after `overrideMessage` and the active task's `activeForm`, gated on P90),
`CH17` (the `(a · b · c · d)` tail with per-slot width budgets and elapsed only past 16 s), `CH18` (the
thinking-word escalation ladder), `CH21` (the rows beneath the spinner: compaction progress, `Next:`,
retry banner). Startup: `CH24` (the unboxed returning-user header versus the boxed first-run welcome,
with the layout flip at 70 columns), `CH25` (tips as a completion checklist), `CH26` (one-line
degradation under `rows < 30`). Terminal: `CH28` (OSC 0 title with the idle `✳` prefix and the busy
alternation), `CH30` (OSC 21337 tab status), `CH31` (desktop notifications per emulator), `CH34` (the
iTerm2 progress bar), `CH36` (`SIGCONT` resize resync), `CH37` (`prefersReducedMotion`), and `TH3`
(`auto` theme resolved live — the `COLORFGBG` tier is a pure env read that works today; the OSC 11 tier
is gated on P93).

**Depends on.** F1 (tokens), F7 (the notification queue for `CH21`'s retry banner). **P93 gates the
entire OSC family** — if writing escapes from inside a live Ink render corrupts the frame, `CH28`,
`CH30`, `CH34` and `TH3`'s first tier all fall to the tail together.

**Non-goals.** `CH29` (model-generated session topic), `CH35` (alt-screen — unreachable), `CH22`,
`CH38`, `CH39`.

**Acceptance.**
1. Side by side with real Claude Code at the same terminal width, the spinner's glyph sequence and
   cadence are indistinguishable on a masked frame diff.
2. Under `TERM=xterm-ghostty` the final spinner glyph differs, as upstream's does.
3. Ten seconds into a turn the word becomes `still thinking`; twenty, `thinking more`; forty-five,
   `almost done thinking`.
4. The terminal tab title reads `✳ <session topic>` while idle, alternates two braille glyphs while
   busy, and is restored when ccx exits.
5. A first run shows the boxed welcome with `borderText: " Claude Code v… "`; the second run shows the
   unboxed header. At fewer than 30 rows both degrade to one line.

---

### F9 — Tail (deferred, not scheduled)

Recorded so the boundary is explicit: `CM60` (vim), `TH1`/`TH9`/`TH10` (ANSI theme variants, custom and
plugin themes), `DG35`/`DG36` (DiffDialog), `KB12` and `CM33` (mouse, wheel, selection, copy), `CH38`
(screen-reader layout), `CH29` (topic titles), `CM41` (the other completion sources), `CM61` (buffer
highlight spans), `DG64` (memory panel and rich `/context`), `TR22` (see § Exceptions), `TH5` (shimmer),
`KB16`, `KB19`, `KB21`, `DG4`, `DG16`, `DG53`, and anything a probe returns negative on.

---

### What changed from the research inventory's eight-wave proposal

Six changes, each with its reason:

1. **The keymap moved from fifth to third — ahead of the composer.** The inventory ran composer parity
   (W4.3) before the keybinding table (W4.4). The composer wave adds a readline set, a kill ring, popup
   navigation and paste-chip motions; building those against 17 ad-hoc `useInput` callbacks and then
   porting them into a table afterwards is exactly the build-it-twice failure the inventory's own
   Tier-1 test is designed to catch. This also matches the owner's decision 3, which sequences the
   keymap after the harm list and renderer unification.
2. **The verbose/collapsed flag (`ST2`) moved out of its own wave and into the substrate.** The
   inventory made it the defining deliverable of W4.2 (the live turn). But three separate waves consume
   it — the live turn, the transcript's thinking and diffs, and the compact-summary row — so leaving it
   until the second consumer wave means threading it through renderers twice. It ships in F1 with one
   proven consumer (`LT6`) so it is not built speculatively.
3. **The transcript and markdown wave moved ahead of the dialogs wave.** The inventory ordered dialogs
   (W4.5) before transcript (W4.6), but `DG7` states plainly that the permission dialog's body *is* the
   transcript's diff leaf renderer, and `DG29`'s plan dialog renders markdown. The original order builds
   a throwaway diff body inside the dialog wave and rewrites it a wave later.
4. **The chrome wave split in two.** The inventory's W4.7 held the notification queue, the footer
   rebuild, the spinner, startup and terminal integration — and that was *before* statusLine was in
   scope. With owner decision 1 promoting statusLine from Tier 5 to a first-class deliverable, one wave
   would carry three independent subsystems. F7 is a contract wave (what the default footer is, what is
   opt-in, what the extension point is); F8 is polish plus OS integration with a different risk profile
   — P93 could remove half of it in one result.
5. **The scorecard correction became a deliverable of F0 rather than a standing to-do.** The inventory
   filed it as §12. But every wave after F0 reports progress against that scorecard, and it currently
   scores ✅ on behaviour that diverges. Correcting the instrument is honesty work of exactly the same
   kind as the rest of F0.
6. **A frame corpus was added to F0.** Not in the inventory at all. Fidelity defects are precisely the
   class that a human reading a pty transcript does not see, and every wave's acceptance depends on
   being able to detect them.

Two things I deliberately did **not** change: the harm list stays first (its argument — every entry
costs a user something real today and every entry is S-effort — is correct and does not depend on the
fidelity brief), and the renderer unification stays second (it is the one item the six reports proved
necessary by disagreeing with each other about our own behaviour).

## Probes

Three are done. Fourteen remain, of which one is still new here. A probe is not optional documentation: an
item whose probe has not returned is **unschedulable**, and an item whose probe returns negative is
**recorded as unreachable, not built and left dead**.

| # | Question | Gates | When |
|---|---|---|---|
| **77 ✅** | What is in a `tool_result`? Anything structured? | `ST3`, `LT1`, `TR23`, `TR25` — and the whole derivation premise | done |
| **78 ✅** | Which `canUseTool` fields arrive populated? Does `updatedPermissions` round-trip? | **the entire F6 permission cluster**; also settles the inventory's P79 for the `session` destination | done |
| **P94 ✅** | **Tool census.** Completed on the harness's SDK 0.3.220 with Fable 5 and OAuth-only authentication. The natural corpus and separate Write-only case passed, every call/result paired, and every canonical result matched its submitted UUID. Read/Edit/Write/Bash/Agent/TaskOutput shapes, optional Bash `returnCodeInterpretation`, ordinary redirect classification, and the flat fallback are recorded in `../research/2026-07-31-tui-clone/07-p94-tool-census.md`. Frequencies stay in that evidence report and are never dispatch constants. | `ST3`'s structured-first/fallback vocabulary, `LT1`'s per-tool rows, `LT2`'s clause grammar | done |
| **P86** | Ink input capability matrix in our terminals: `home`/`end`/`pageup`/`pagedown`, `shift+return`, `super`/`meta` chords, mouse click and wheel, terminal focus events, bracketed-paste boundaries | **scopes F2 and F5** — separates unreachable from unbuilt | before F2; needs a pty, not the SDK, so it can run from day one |
| **P80** | Does `[Request interrupted by user]` reach a client as a user message? Do context-limit, credit-balance and abort conditions arrive as assistant text with upstream's sentinel strings, or as SDK errors? | `LT14`, `TR38` | batch B, before F3 |
| **P81** | Does the `compact_boundary` frame carry a summarised-message count and direction? | `TR36` | batch B |
| **P82** | Are there per-block timestamps on the thinking stream, enough to compute `Thought for 12s`? | `TR33`, `LT2`'s first clause | batch B |
| **P83** | For nested/flat-only Agent calls, are assistant `usage` blocks summable and is there identity beyond `parent_tool_use_id`? P94 confirmed on 0.3.220 that recognized top-level Agent sidecars can carry exact `totalToolUseCount`, `totalTokens`, `totalDurationMs`, `toolStats`, model, status, and async/completed variants, but some Agent calls remain flat-only. | `LT17` fallback, `TR39`, `DG21` | batch B |
| **P89** | Does `getContextUsage` expose window size, reserved output and the auto-compact point — enough for upstream's token-absolute `warn`/`compact`/`blocked` levels rather than a naive percentage? | `CH4`, and statusLine's `context_window` block | before F7 |
| **P95** *(new)* | **statusLine payload sourcing.** Which of the 20 documented plus five undocumented fields can we actually populate — `transcript_path`, `prompt_id`, `context_window.*`, `rate_limits` (probe 55 says null under OAuth), `cost`, `output_style`, `agent`, `worktree`? | `CH11`'s fidelity claim and the degradation contract | before F7 |
| **P84** | Does a client see incremental stdout for a running Bash? Any wire counterpart to the background affordance? | `LT19`, `LT20` | before F3 (cheap; share a session) |
| **P85** | Do PreToolUse hook summaries with timing reach a client? Does the auto-mode classifier's verdict? | `LT21`, `LT22` | with P84 |
| **P90** | Do the SDK's task items carry `activeForm`, owner, blocker, activity? | `DG58`, `CH15` | before F8 |
| **P93** | Can we send OSC 11 / OSC 0 / OSC 21337 from inside a live Ink render without corrupting the frame, and does the OSC 11 reply parse? *(Terminal question, not SDK.)* | `TH3`, `CH28`, `CH30`, `CH34` | before F8 |
| **P87** | Does the SDK accept image content blocks on a user turn? Can a pasted screenshot round-trip? | `CM42`–`CM45`, `TR34` — a whole sub-domain, and a scorecard reclassification | tail decision |
| **P88** | Is per-model pricing and entitlement metadata reachable from the SDK? Is reasoning effort settable, or is `setMaxThinkingTokens` the only knob? | `DG47`, `DG48` | tail decision |
| **P91** | Is there an anchored summarize? Can a client start a fresh session seeded with a first message plus a transcript pointer? | `DG41`, `DG32` | tail decision |
| **P92** | Does the SDK surface auth-state changes and API-refusal/fallback events? | `CH39`, `DG65` | tail decision |

**Dropped from the research reports' probe lists.** Report 02's "does the SDK surface a queued-message
state?" — our queue is entirely client-side in `useChat.ts`; there is nothing for the SDK to surface.
Report 05's "is a per-anchor rewind dry-run cheap enough for every row?" — a performance measurement of
our own code, folded into `DG39`'s implementation. The inventory's **P79** is answered by probe 78 for
the half the SDK owns (`session` destination round-trips and suppresses); the on-disk half is our own
settings-file write, which shipped in TUI/UX Wave 3.

## Cannot build

Two categories, deliberately separated, because conflating them is how a merely-unverified item
becomes permanently unbuilt.

### Genuinely unreachable — settled, no probe will change it

| What | Evidence | What it costs us |
|---|---|---|
| `suppress_always_allow_rule`, `decision_reason_type`, `classifier_approvable` | Probe 78 on the live wire: absent by both snake and camel name. Confirms the static reading (`sdk.d.ts` L3596–3625 declares them; `sdk.mjs` has zero occurrences) | `DG22`: our "don't ask again" row will sometimes appear where upstream hides it. `DG20`: only the free-text `decisionReason` sentence is available — never upstream's eight typed variants with their config hints, nor the error-coloured classifier case |
| `isAskCappedByOrg` (MCP `effectiveMaxPermission === "ask"`) | No field on the callback | `DG23`: the MCP-capped suppression of the persist row |
| Structured tool results | Probe 77 | Every result summary is derived. Most derive cleanly; **absolute diff line numbers do not** — hence owner decision 2 |
| Upstream's per-tool clause table, transcribed | Probe 77: Bash-as-search, no `LS`, todos behind `ToolSearch` | A Grep/Glob-keyed table fires on nothing. `LT2`'s grammar is built from our census, with upstream's Bash-command classifier as the transferable part |
| Alt-screen rendering, and everything gated on it | Ink `<Static>` is append-only; unmounting replays the scrollback (paid for in TUI/UX Wave 1) | `CH35`; the composer's `maxVisibleLines` viewport (`CM7`); the footer's right-column suppression; upstream's `ds()`-gated collapse clauses |
| Theme change repainting history | Same `<Static>` constraint, recorded at `tui-ux.md:91–93` | `TH12`: a theme change recolours new output only |
| IDE and LSP surfaces | No IDE attach channel | LSP diagnostics on tool rows; `Opened changes in <IDE> ⧉`; the IDE picker; the `⧉ N lines selected` chip |
| Artifact publishing | claude.ai-coupled | `DG33`, `DG54`, `ctrl+]` (`KB10`) |
| Remote-flag services | No gate service | `CH27` announcements, PR badges, cloud-session chips, closed-issue polling |
| The diff sidebar | **No handler is registered anywhere in the bundle** for `app:diffFileListUp/Down` — the actions exist only in the table, the description map and the action enum | `DG37`, `KB11`. See § Exceptions — this one is not merely unreachable, it is vestigial upstream |
| `cmd+*` chords | macOS system keys never reach a terminal app | `KB9` (`cmd+k` clear screen), already a recorded divergence |
| Voice push-to-talk | No audio surface | `CM`/`KB` push-to-talk rows |
| `rate_limits` under OAuth | Probe 55: populated only under the interactive credential | statusLine's `rate_limits` block is null for subscription-authenticated users. Emitted as null, never faked |

### Merely unverified — a probe decides

Bash incremental stdout (P84) · hook timing and the auto-mode verdict (P85) · image content blocks
(P87) · reasoning effort and pricing metadata (P88) · token-absolute context thresholds (P89) · task
item fields (P90) · anchored summarize and seeded fresh turns (P91) · auth and refusal events (P92) ·
Chrome/browser tool presence in `canUseTool` (unanswered by probe 78, which covered Read/Write/Edit) ·
Ink's key and mouse capability set (P86) · OSC round-tripping from inside an Ink render (P93) ·
statusLine payload sourcing (P95).

**None of these may be recorded as unreachable until its probe returns.** And one is unverified in the
*other* direction: report 02 searched six ways for an upstream session-resume divider and found no
renderer. Either upstream has none and our `─── resumed: … ───` line is an over-ship, or the search
missed it. Kept, flagged unverified.

## The scorecard

`docs/parity/tui-ux.md` is the measure this effort will be judged by, and it is currently wrong in
about twenty places. **It is corrected in F0, before any wave scores against it.**

**The corrections, by section.** Transcript: the user echo is `❯ ` on a background band, not `>`; the
assistant bullet is `⏺` on macOS in the plain `text` token, not an accent; thinking shows a *duration*
and is hidden by default; the tool-row row is scored against replay only while the live path renders
something else; `⎿` is emitted once at five columns; markdown is missing links, images, strikethrough,
rules, task lists, nested lists and block separation; tables are far from upstream's; the diff row is
silent about foreground-versus-band colouring, the missing counts header and our 24-line cap; the
long-output row is scored LOW when it is the structural `ST2`; the compact boundary is a bulleted
summary, not a rule. Chrome: the footer has **none** of model, cost or context percentage; the spinner's
timing model is wrong; the verb list has one extra; `esc to interrupt` belongs in the footer; the
context indicator is a transient; the mode chip needs its symbol, ` on` suffix and cycle hint; the hint
line is an eleven-rung ladder. Composer: paste is not chipped; history is not persisted; the kill keys
discard; `ctrl+_` is **unreachable and inserts a control character**; Escape destroys the queue; the
placeholder is a precedence chain; the help overlay closes on any key. Dialogs: one dialog stands where
upstream has thirteen kinds; the model picker, resume picker and task panel are each partial; the
transcript-pager row is scored against the wrong mechanism entirely.

**Four structural changes matter more than any single row.**

1. **The stated method is wrong.** The header still reads "Tracked feature-by-feature against the
   reference TS harness in `../../Claude Code Src/`" — the stale February snapshot the owner has ruled
   out and that has already produced wrong strings. Repoint it to `~/claude-code-bundle/2.1.220/`.
2. **Over-ships are scored as parity.** The plan-usage chip is scored ✅ for something upstream does not
   have. Under a cloning brief that is a category error. Every over-ship moves into a separate
   *recorded additions* table, out of the parity denominator.
3. **The three largest gaps have no rows at all** — the theme token contract (`ST4`), the keybinding
   table (`ST5`) and the precedence model (`ST6`). Neither does the notification queue, statusLine,
   terminal title, desktop notifications, tab status, reduced motion, resize handling, the
   `Select`/`Tabs` primitives, DiffDialog, or EnterPlanMode.
4. **One 🚫 is misused.** Image paste is marked "non-terminal / out of scope"; reading the system
   clipboard is terminal-native. It becomes ❌-pending-P87, which changes the denominator.

**Expect the headline to fall.** Rows moving from 1.0 to 0.5 or 0, plus roughly fifteen new rows scored
0, plus over-ships leaving the numerator, should take the overall figure from ~88% into the low 70s.
That fall is the point of the exercise, and the drop should be stated in the scorecard, not smoothed.

**A recommendation beyond the corrections.** The scorecard's rows are coarser than the thing they
measure — a single ✅ has been covering four separate divergences. Adopt the inventory's **271 IDs as
the working denominator**: each wave closes a named subset, the count is auditable, and the scorecard's
rows become a coarse public summary derived from it rather than the primary record. That also makes
"highest possible fidelity" measurable against a denominator that does not move when someone rewrites a
row.

## Exceptions to fidelity-first

Fidelity is the tiebreaker, not an absolute. Six places where cloning upstream would import something
vestigial, harmful, or worse than what we have. Each is a recorded exception, not silent
non-compliance.

**E1 — The diff sidebar and its bindings (`DG37`, `KB11`).** Vestigial upstream: no handler is
registered anywhere in the 579,698-line bundle for `app:diffFileListUp/Down`. The actions exist only in
the table, the description map and the enum. Cloning it would clone dead code, and — worse — putting
those rows into F2's binding table would recreate at the architectural level exactly the harm F0 exists
to eliminate: an advertised chord that does nothing. **Do not clone; do not table.**

**E2 — The honesty invariant outranks fidelity, and the tip catalog is where it bites (`CH22`).**
Upstream's ~40 tips name commands and surfaces we do not have (`/btw`, artifacts, cloud sessions).
Cloning the catalog verbatim would reintroduce F0's harm at scale. Generalised as a standing rule:
**no string we render may advertise a chord, command, or surface that does not resolve in our live
binding table or command catalog.** Where this conflicts with fidelity, honesty wins. If the tip
mechanism ships at all, upstream's scheduling semantics are cloned and the catalog is ours.

**E3 — Anything that routes to an Anthropic-operated service must be repointed or omitted.** Upstream's
`/help` ends with `Something else? Use /feedback…`; the bundle also polls closed issues, badges PRs and
chips the auto-updater. Cloning the feedback affordance verbatim would send a user's complaints about
*our* clone to Anthropic's Claude Code intake. Omit, or repoint at our own issue tracker, and say which
in the divergence allowlist. This is the one class where visual fidelity actively misleads.

**E4 — Real token counts over upstream's animated estimate (`CH20`).** Upstream animates
`responseLength/4` toward a guess at 50 ms steps; we have real `message_delta` output tokens. Cloning
would replace a true number with a fabricated one. **Keep ours.** Same principle governs two decided
behaviours elsewhere in this spec: the diff line numbers fall back visibly rather than print a
confident wrong number (decision 2), and unsourceable statusLine fields are emitted null rather than
invented (`CH11`).

**E5 — Two-stage rewind confirmation (`DG43`).** With checkpointing off, upstream restores immediately
on selection. Our in-place rewind is destructive (probes 37/37b) and our checkpointing can be
unavailable at runtime — the SDK rejects checkpointing combined with an external session store. The
extra keystroke is cheap and the failure it prevents is unrecoverable. **Keep ours.**

**E6 — `#` memory mode in the composer (`CM65`).** Upstream's mode detector recognises only `!`. Ours is
a genuine addition, and it is the only over-ship that changes what typing a printable character does —
so it comes with a condition: it must be gated by the same start-of-buffer rule upstream applies to
`!`, so it can never swallow a `#` mid-prompt. Recorded as a divergence, not carried silently.

**Additions retained, for completeness** (kept rather than removed, but not exceptions in the same
sense): the `⚙ N bg` background indicator — our fleet feature has no other surface, and it becomes a
settings-gated footer opt-in under decision 1; `/bg` as the command name, with `/tasks` and `/bashes`
added as aliases routing to the same panel; and the detach feature, moved off `ctrl+z` to comply with
upstream's reservation while keeping the capability.

**Deleted rather than kept:** `"Evaporating"`, our 187th spinner verb against upstream's 186 — pure
drift with no argument for it. And the `⟳ streaming` chip: the spinner already says it.

## Decision Log

**Settled by the owner, 2026-07-31 — recorded as decided, not reopened.**

- **Build the `statusLine` extension point; make the default footer upstream-exact; keep our extras as
  opt-in settings.** The research filed statusLine at Tier 5 on the argument that it exists only because
  upstream *is* the CLI — an instrumentation escape hatch. That reading is wrong for a cloning brief:
  it is upstream's real architecture for exactly the information we currently hard-code into the
  footer, and third-party status line scripts are a compatibility surface. So the default footer
  becomes the permission-mode chip and the single-hint ladder, nothing more, and the model name, cost,
  context percentage, streaming chip, background count and thinking level all become settings-gated
  rather than deleted. **Capability preserved; the out-of-the-box experience is Claude Code's.**
  Rejected: deleting the extras (throws away working features to score a parity row). Rejected: keeping
  the current footer and calling it a divergence (it is the single most-looked-at surface in the app).
- **Diff line numbers: read the file from disk at render time, fall back visibly.** Probe 77 established
  `structuredPatch` is not on the wire, so upstream's absolute numbering is not derivable. Our REPL is a
  local client sharing the working directory, so reading the file is legitimate — it is a disk read per
  Edit render, and it is the only route. When the file is missing or has changed since the edit, fall
  back to the current snippet-relative numbering with a visible marker. **Being visibly approximate
  beats being confidently wrong.** Rejected: staying snippet-relative always (a permanent, silent
  divergence on one of the most-read surfaces). Rejected: pretending the numbers are absolute.
- **Keybindings: port the architecture, not the keys.** Upstream resolves a declarative table through an
  ordered context stack, first match wins. We have hit three separate key bugs — help-overlay
  double-fire, the unreachable `ctrl+_`, the dead `pager.ts` shift branch — whose shared root cause is
  the missing precedence model. Patching keys individually leaves the generator of the bug class in
  place. **It is its own wave, sequenced after the harm list and the renderer unification** (F2).
  Rejected: fixing the seven ungated surfaces by extending `ChatApp`'s hardcoded flag list — that is the
  same architecture with more entries.
- **Markdown: take a dependency on `marked`, which is what upstream uses.** The project's
  zero-dependency instinct was right for the syntax highlighter and is wrong here; the alternative is
  maintaining a tokenizer forever, and our current line-oriented regex cannot nest at all. Rejected:
  extending the regex renderer (`TR8` alone — nested lists with per-depth numbering — is more work than
  adopting the library, and every later markdown row compounds it).

**Taken in this spec.**

- **Nine waves, not eight, and reordered.** Reasons in full under § What changed. The load-bearing
  three: the keymap precedes the composer, the transcript precedes the dialogs, and the verbose flag is
  substrate.
- **The frame corpus is a deliverable, not a nice-to-have.** A pty run read by a human cannot detect a
  wrong glyph, a missing dim, or a four-column gutter. Every wave's acceptance depends on an
  instrument that can. Rejected: more Ink component tests — 318 of them were green while three real
  defects shipped, and they measure components, not the product.
- **The scorecard is corrected before the work, not after.** Every wave reports against it; an
  instrument that scores ✅ on divergence makes the whole program unfalsifiable.
- **`ST2` ships with a consumer.** Building the verbose flag with nothing to expand would be
  speculative; `LT6` rides along in F1 so the mechanism is proven end to end the day it lands.
- **Tool vocabulary: the model keeps Bash — no Grep/Glob steering** (owner decision, 2026-07-31,
  closing what this spec originally left open). Rationale: current Claude Code itself dropped
  Grep/Glob from the model's toolset in favour of Bash (owner's recollection, corroborated by a live
  harness session whose tool list carries no Grep/Glob), and the bundle's own `Kr_` classifier exists
  precisely to collapse Bash search/read/list commands into upstream-style summaries. So steering
  would have chased an *older* upstream at a capability cost, while Bash + clause classification
  matches the current one. Rejected alternative: restrict Bash-as-search via permission rules to push
  the model onto Grep/Glob — changes agent behaviour, risks capability, and no longer buys fidelity.
  P94 shrinks accordingly: it is now purely the census for `ST3`/`LT2` (observed tools, frequencies,
  argument/result shapes), not a steering experiment.
- **Tool results are structured-first per call, not derived-only per session** (P94 final SDK 0.3.220
  evidence, 2026-08-02). `tool_result.content` remains flat while `SDKUserMessage.tool_use_result` is an
  optional separate channel whose presence varies even within one tool. Preserve both channels, prefer a
  uniquely associated recognized sidecar, and retain deterministic flat/input fallback. Successful result
  completion is waiter-owned by UUID and submitted provenance class; UUID-less errors require an explicit
  origin matching the FIFO-head waiter. Background/synthetic frames cannot complete another turn. Rejected:
  derived-only rendering, sidecar-only rendering, and globally treating every locally injected prompt as
  human.
- **Ctrl-O is a second projection, not mutation of static history** (bundle trace, 2026-08-02). The live
  log remains append-only; canonical messages/events survive underneath it. Ctrl-O opens a detailed
  transcript that reprojects those originals untruncated, while transcript-local Ctrl-E explicitly
  toggles show-all/collapse. Rejected: re-rendering already emitted Ink `<Static>` rows, which would replay
  terminal history and still cannot recover facts discarded into `RenderLine[]`.

## Surprises & Discoveries

- **Probe 77 was right about the block and wrong about the message.** Final SDK 0.3.220 P94 evidence confirms
  `SDKUserMessage.tool_use_result` alongside flat `tool_result.content`, but sidecar presence varies per call:
  even Agent and the high-volume Read/Bash tools had flat-only calls. The enduring contract is structured-first
  with a flat/input fallback, never either premise globally. One Bash sidecar also added optional
  `returnCodeInterpretation`; it is structured source, not a numeric exit code. (2026-08-02)
- **One query can emit multiple successful `result` frames, and locally generated does not mean human.** The
  exact final P94 run closed each case with one UUID-matched human result; a separate successful 0.3.220 run
  also emitted task-notification successes without user UUIDs. Independent review then exposed proactive
  heartbeat and tool-triggered compaction as local automatic inputs. Session completion is therefore bound to
  both submitted UUID and provenance class, not a blanket human stamp. (2026-08-02)
- **Current Fable tool density changes the economics of live probes.** The canonical eight-case run still
  produced hundreds of calls and delegated in six cases, while the old Sonnet-era assumptions expected a
  short direct sweep. Corpus probes need per-case deadlines, safe partial aggregates, explicit model/runtime
  provenance, and frequencies confined to the evidence report rather than copied into dispatch code. (2026-08-02)
- **`LT5` could not be an F1 free rider.** Its elapsed suffix belongs to the collapsed-group state that F1
  explicitly excludes and F3 owns. Moving it to F3 avoids inventing a dead pre-group timer solely to satisfy
  a misplaced inventory label. (2026-08-02)
- **Probe 78's real finding was not the field census — it was that we do not have to build a rule
  grammar.** The engine *suggests* the permission rule itself, per tool, in exactly the shape
  `updatedPermissions` accepts, and echoing it back verbatim suppresses the next consult. It also
  explains an upstream behaviour the research could only describe: upstream's file-edit prompt offers
  "accept edits" while its read prompt offers a directory glob because **the option wording follows the
  suggestion kind**, not the tool name. Two variants arrive for a path outside cwd — the raw and the
  symlink-resolved `/private` form — so the dialog must pick one or offer both. (2026-07-31)
- **The six research reports disagreed about our own behaviour, and the disagreement was the finding.**
  Report 01 said our live turn shows one result line at 48 characters; report 02 said our result path
  caps at 12 lines by 100 characters. Both were right: they read `liveTurn.ts` and `render.ts`, which
  emit different text for the same tool call. That is `ST1`, discovered by contradiction rather than by
  inspection. (2026-07-31)
- **Upstream ships dead code, and a cloning brief will faithfully reproduce it unless someone looks.**
  The diff sidebar's actions are in the keybinding table, the description map and the action enum — and
  no handler is registered for them anywhere in 579,698 lines. Fidelity-first is not the same as
  transcription. (2026-07-31)
- **Our scorecard's stated method still points at the source the owner has banned.** The header reads
  "tracked against the reference TS harness in `Claude Code Src/`" — the February snapshot that has
  produced wrong strings repeatedly. Every score in it was taken against that reference. This is the
  twenty-first correction and arguably the one that explains the other twenty. (2026-07-31)

- **Ink's `setRawMode` is a reference count, so the obvious suspend implementation is a silent no-op —
  and upstream's own code is the proof.** `useStdin()`'s `setRawMode` is shared by every mounted
  `useInput` consumer and only reaches the tty when the count falls to zero
  (`ink/build/components/App.js:104-131`); our app always holds it at two or more, so F0's
  plan-authored `setRawMode(false)` never left raw mode. Upstream hit the same wall and solved it from
  *inside* their patched Ink — `handleSuspend` (`cli.pretty.js:177985`) drains the count in a `while`
  loop and restores it with a counted loop. The same read settled two more values we had guessed: it
  signals `kill(0, …)`, the whole process group rather than its own pid, and its double-press-to-exit
  helper `Pee` (`:183445`) defaults to `fpy = 800` ms — the *same* constant as the Esc chord — where our
  plan had specified 2000 ms for Ctrl-D. `Pee` also never disarms on an intervening keystroke, so the
  asymmetry with our Esc arm is upstream-faithful, not an inconsistency to fix. **The general lesson:
  when a plan-authored premise about a dependency turns out to be wrong, the reference implementation
  has usually already hit the same wall — read its solution before designing your own.** A second,
  narrower trap rode along: a repaint forced by bumping unread state writes nothing, because Ink skips
  the terminal write when rendered output is unchanged (`ink/build/ink.js:132`) — invisible in tests
  because `ink-testing-library` renders with `debug: true`, which bypasses that gate. (2026-07-31)

- **The anti-lying audit shipped with two lies of its own, and both were the same mistake.** F0's honesty
  audit asserts that no string advertises a chord the app does not honour. Two of its checks compared
  **hand-copied literals** rather than rendered output: the footer/status-bar mapping never rendered
  either component, and the pending-hint assertion dropped the three leading spaces the source actually
  prints. Both were proven inert by sabotage — editing the real strings left both tests green. The
  twenty-six per-chord proofs, written against real behaviour, all bit correctly. **The rule: an
  assertion about what the UI says must be taken from what the UI rendered, never from a copy kept beside
  the test.** A comment promising that humans will hand-update the copy is a discipline note, not a
  contract, and in an audit it is worse than no check at all — it certifies the falsehood it exists to
  catch. Both instances originated in the plan's own template, which is where the correction was made.
  (2026-07-31)
- **The frame instrument had a silent fidelity hole at the emulator boundary.** pyte's `Char` preserves bold,
  italic, underline, blink, reverse, and strikethrough but deliberately drops SGR 2 dim/faint. The capture
  path now carries dim in a parallel cell grid and reconstructs it alongside the retained attributes; capture
  and diff also fail closed on premature child exit, missing frames, empty inputs, and missing counterparts.
  (2026-08-01)
- **Wholesale editor replacement is a state transition, not a buffer setter.** Queue rescue and external-editor
  replacement both cross the editor boundary, so they must clear popup, history-navigation, kill-run, yank,
  and undo state while retaining history, stash, and kill-ring state. The queue path also updates its ref before
  interrupting so a synchronous turn-end event cannot drain a rescued prompt back into the host. (2026-08-01)
- **A status hint is only honest relative to its focused owner.** Composer, autocomplete, overlay, and decision
  surfaces now have explicit ownership; the status bar hides its composer affordances under every other owner,
  and the composer derives Esc help from busy/empty/draft state. (2026-08-01)

## Outcomes & Retrospective

### F0 outcome — completed 2026-08-02

F0 established an honest, testable foundation for the remaining fidelity waves. It removed the user-harm
cases in scope: queued prompts return to the composer on interrupt, Esc-Esc clears without losing history,
the editor has a durable kill ring with yank/yank-pop and reachable raw-byte undo, Ctrl-D uses upstream's
timed double-press contract, Ctrl-Z performs POSIX process suspension, detach is available only through
`/detach`, permission dialogs accept bare `y`/`n`, and the help overlay has truthful Escape-only ownership.
Editor state now survives temporary overlay and decision unmounts without stale completion,
history-navigation, undo, or yank coordinates leaking across wholesale replacements.

The wave also made later parity claims falsifiable. The honesty audit reads rendered UI and proves every
advertised chord against live behavior. The frame instrument compares pyte-emulated screen states, retains
dim and other SGR attributes, handles wide cells and terminal mutation semantics, fails closed on incomplete
inputs, publishes exact validated frame sets, derives canonical nested scenario keys, and enforces declared
identity-redaction contracts before tracked fixtures can be written, compared, fingerprinted, or printed.
The scorecard now names the installed 2.1.220 bundle as its reference, moves upstream-absent additions outside
the denominator, and reports the measured baseline as approximately 63% rather than the previous unauditable
approximately 88%.

All eight F0 acceptance contracts pass. Final verification covers typecheck, package build, 40 tracked TUI
files and 665 tests, 1,227 unit tests, 16 integration tests, 7 contract tests, the complete 86-test Python
suite both with and without `CLAUDE_JOB_DIR`, two independent ten-run Python stability loops, current
queue-rescue/Escape/Ctrl-D PTY traces, scorecard invariants, and the expected frame baseline. The real
synthetic-shell PTY acceptance performs Ctrl-Z, observes the shell, preserves shell output, sends `fg`, and
verifies cursor-hide ordering before the resumed TUI becomes ready. A separate human-operated terminal smoke
test was not performed; the automated test exercises the actual OS job-control path, while a human run would
add only subjective terminal-emulator observation. The frame baseline intentionally remains divergent —
three help frames and five composer frames — because F1–F8 own the visual gaps that F0's instrument now
measures rather than hides.

The review sequence changed the engineering lesson of F0. Most late defects were not isolated feature
mistakes; they lived at boundaries between React render state and Ink's passive input subscriptions, between
process-level and composer-level key listeners, between terminal cell width and serialized screen text, or
between validated staging and published fixture sets. The reliable pattern is therefore to model the current
input owner explicitly, keep handler-read values synchronously current, treat external buffer replacement as
a full state transition, sabotage every guard test against the regression it claims to prevent, and make
evidence tools fail closed. A plan-mandated test or architecture is not exempt from review: several of F0's
most important corrections were defects copied directly from the approved plan.

P94 is complete on the harness's exact SDK 0.3.220, including the separate Write-only proof, and the
Session ownership prerequisite now distinguishes human from automatic local turns while correlating every
successful completion by UUID. F1 is schedulable; F1–F8 remain otherwise pending.

## Revision Notes

- 2026-07-31 — created from the six-report research inventory
- 2026-07-31 — Task 6 review corrected three plan-authored values against upstream: the suspend
  implementation (Ink's ref-counted `setRawMode` and the dead repaint counter), the Ctrl-D double-press
  window (2000 ms → upstream's 800 ms), and the suspend signal target (own pid → process group). Recorded
  under Surprises & Discoveries; the plan's Global Constraints and Task 6 code were corrected to match.
  (`../research/2026-07-31-tui-clone/00-INVENTORY.md`, 271 gaps) under the owner's fidelity-first brief,
  with four architecture decisions settled in advance (statusLine and the default footer; diff line
  numbers from disk; the keybinding architecture as its own wave; `marked` as a dependency) and two
  runtime facts settled by committed probes 77 and 78. The inventory's eight-wave proposal was
  restructured into nine — see § What changed — principally to put the keymap ahead of the composer and
  the transcript ahead of the dialogs, both to avoid building the same surface twice.
- 2026-07-31 — the open tool-vocabulary question is closed by the owner: the model keeps Bash, no
  Grep/Glob steering (current Claude Code itself moved search into Bash). P94 narrowed to a pure
  census; Decision Log and § Where the asymptote is updated in place.
- 2026-07-31 — F0 brainstorm settlements: `KB4` resolved to make-reachable (the undo stack already
  exists in `editor.ts`; only the `0x1f` byte match is missing); `KB5`'s detach re-home resolved to
  the `/detach` slash command only, no chord (owner). Golden captures will be taken from the
  installed `claude` 2.1.220, which matches the reference bundle version exactly.
- 2026-07-31 — F0 planning pass: acceptance item 5 was self-contradictory ("ctrl+o closes the
  overlay … Only Escape closes it") — corrected to escape-only per K36. And a refinement of § The
  instrument: frames are **emulated-screen dumps** (pyte-rendered grid with reconstructed SGR), not
  raw pty streams — raw streams are not comparable across two binaries' repaint strategies; the
  screen state is. "The ANSI is the artefact" still holds: the dumps carry the SGR.
- 2026-08-01 — final review hardening: wholesale editor replacement now clears stale buffer-derived state
  while preserving durable state; status hints are focus-owner/kind aware; Windows no longer advertises or
  attempts POSIX suspend; pyte dim/faint and retained SGR attributes are preserved; capture/diff and mask
  tests fail closed rather than certifying incomplete or semantically different frames.
- 2026-08-01 — second re-review boundary hardening: the visible help overlay now has a root-owned Escape
  route across Ink's passive-effect race; whitespace-only clear/prepend behavior is byte-preserving but
  history-neutral; Ctrl-W follows upstream's preceding-word-plus-line-break kill at line boundaries; and
  SGR 2 is an extended cell attribute that follows pyte's own scroll/erase/insert/delete pipeline rather
  than a parallel grid. Dashboard nondeterminism masks are scoped by scenario/frame, so transcript values
  such as arbitrary email, percentage, cost, duration, and token counts remain comparable.
- 2026-08-02 — whole-range review and final verification closed the remaining cross-boundary gaps. Ctrl-Z
  resume now owns Ink's stale erase bookkeeping at the render boundary and restores cursor visibility in
  shell/TUI order; the real PTY acceptance executes an actual shell `fg` cycle rather than relying only on
  mocks. Tracked frame comparison requires an explicit redaction contract before any fingerprint or
  diagnostic output, required-state counts must be positive non-boolean integers, and dashboard/diagnostic
  identities use delimiter-based Unicode-safe component recognition. The final full Python gate exposed two
  older synthetic tracked-fixture tests that had not declared their identity-free contracts; only those test
  fixtures changed, and both complete 86-test environments plus both ten-run stability modes then passed.
- 2026-08-02 — P94 completed against the harness's exact SDK 0.3.220 and `claude-fable-5[1m]` under
  OAuth-only authentication. The r3 probe passed its natural corpus and separate absolute-path Write case,
  confirmed optional per-call sidecars plus flat fallbacks, recorded safe result ownership, preserved Bash
  redirect classification, and found optional `returnCodeInterpretation` without a numeric exit code.
  Independent review of the Session prerequisite then caught automatic heartbeat/compaction prompts being
  stamped human; the final rule stores each waiter's submitted provenance, matches success by UUID plus any
  explicit origin, and permits UUID-less error FIFO only for the same explicit origin class. F1 is now
  schedulable. The installed bundle trace separately settled ST2 as an append-only live projection plus a
  Ctrl-O detailed transcript over retained source, with transcript-local Ctrl-E show-all/collapse. LT5 moved
  to the F3 collapsed-group state that owns it.
