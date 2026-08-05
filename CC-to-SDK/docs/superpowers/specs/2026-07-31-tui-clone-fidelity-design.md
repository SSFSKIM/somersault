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
| **probe 77** (`probes/probes/77-tool-result-shape.ts`, commit `19f9845555`) + **P94/94b** on the shipped SDK 0.3.220 (final SHA-256 `ef882c088ae10ac0bbe996d3cd2c44d8a9aa8504a3cb6886c903e89e4cd1a7dc` / `6c4af1b24c3f60441b7b0df2d07c7631c3ab8de5f4ea784fb50b10c94c5e9959`) | Probe 77 correctly observed that the ordinary `tool_result` block is flat, but P94 found an optional separate `SDKUserMessage.tool_use_result` sidecar on 52 of 328 natural calls and the directed Write call. F1 therefore normalizes **structured-first per call with deterministic flat/input fallback**, never derived-only or sidecar-only. Recognized Edit sidecars carry `structuredPatch` absolute hunk positions; Bash sidecars carry stdout/stderr/interruption and optional string `returnCodeInterpretation`, but no numeric exit code. The live vocabulary used Bash for search/list/read behavior, no natural `Grep`/`Glob`/`LS`, and task bookkeeping through Task tools. Probe 94b additionally proves UUID-less compact successes require compact-lifecycle correlation rather than generic FIFO. Final validation used first-party Claude Code OAuth, fails closed on competing credentials or alternate provider routing, requires the SDK initialization provider to resolve to `firstParty`, and runs model-controlled tools in a credential-denying, network-denying, write-restricted fail-closed sandbox (credential/network/write isolation, not read containment — see the evidence report) | direct |
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
  deterministic derivation from complete tool input plus flat result text. UUID-bearing results complete
  only the waiter owning that exact `user_message_uuid`; when origin is explicit, it must match that waiter's
  submitted provenance class. UUID-less results may use FIFO when their explicit origin matches the head
  waiter. An origin-absent UUID-less result may settle only a FIFO-head compact waiter that observed its own
  compact lifecycle marker. Background/synthetic results remain retained records, not interchangeable completions.
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
  substitute deliberately: one root **raw-stdin consumer with our own keypress parser** (P86/P86b:
  `useInput` cannot express the table — see Revision Notes 2026-08-03; the recipe is
  `exitOnCtrlC: false` + `useStdin().setRawMode(true)` + `setEncoding("latin1")` + our `data`
  listener), an explicit React context stack that
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
`LT2`'s remaining half (F1 shipped the collapse; F3 ships the **real bold count inside the dim row**
via the raw-SGR fold-row writer — see Decision Log 2026-08-04 — the thought clause's `thoughtForMs`
population from locally clocked thinking blocks per P82, and the latch-to-max counters), `LT3` (≥2
same-name tool_use blocks in one assistant message collapse to `Running 3 agents…` / `3 agents
finished`), `LT4`'s default-reachable pieces (the 700 ms hint debounce and the italic thinking-summary
hint with its 3 s linger — the bash progress suffix is `ds()`-gated and stays out), `LT16` and `LT17`
(agent progress: last three inner rows plus `… +N tool uses (ctrl+o to expand)`, then
`Done (7 tool uses · 24.1k tokens · 1m 12s)` with the P83 totals ladder — sidecar, then
`task_notification.usage`, then client-derived count/duration), `LT18` (Write preview = first 10
highlighted lines), `LT20` (the `(ctrl+b to run in background)` row hint — client-side schema
knowledge, gated on the call's `task_started` arrival per P84).

**Depends on.** F1 (hard: ST1 + ST2 + ST3 + ST9). P82 ✅ (duration source = local arrival clock,
keyed by message id + block index; replay omits durations). P94's Agent sidecar supplies exact
top-level totals when present; P83 ✅ settles the fallback ladder and identity fields.

**Non-goals.** `LT19`, `LT21`, `LT22` — P84/P85 came back negative 2026-08-04; all three are recorded
in § Cannot build. `LT5`'s elapsed suffix and `CH23`'s conjugation table — bundle-verified
`ds()`/brief-mode-gated, dead in the tracked default; recorded in § Cannot build, not built (revision
note 2026-08-04; supersedes their listing as deliverables here).

**Acceptance.**
1. Three consecutive reads collapse into one row reading `Read 3 files`, its count genuinely bold
   inside the dim run (byte-shape matching upstream's golden, post-count dim loss included). **No
   per-row elapsed appears anywhere, and no group elapsed suffix in default mode** (R4.10).
2. A Read shows `⎿ Read 340 lines`; a Bash used as a search shows `Found 3 files`; a Write shows
   its 10-line highlighted preview + bare `… +N lines` marker (the census's default create form —
   `Wrote 42 lines` renders only when no content is available to preview; revision note 2026-08-04);
   an Edit shows `Added 2 lines, removed 3 lines`.
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

Ten are done (probes 77/78/P94/P86 through the F0–F2 waves; batch B — P80/P81/P82/P83 — plus P84/P85
landed 2026-08-04, before F3, exactly as scheduled). Eight remain, of which one is still new here. A
probe is not optional documentation: an
item whose probe has not returned is **unschedulable**, and an item whose probe returns negative is
**recorded as unreachable, not built and left dead**.

| # | Question | Gates | When |
|---|---|---|---|
| **77 ✅** | What is in a `tool_result`? Anything structured? | `ST3`, `LT1`, `TR23`, `TR25` — and the whole derivation premise | done |
| **78 ✅** | Which `canUseTool` fields arrive populated? Does `updatedPermissions` round-trip? | **the entire F6 permission cluster**; also settles the inventory's P79 for the `session` destination | done |
| **P94 ✅** | **Tool census.** Completed on the harness's SDK 0.3.220 with Fable 5 and first-party OAuth-only authentication. The natural corpus and separate Write-only case passed, every call/result paired, and every canonical result matched its submitted UUID. Read/Edit/Write/Bash/Agent/TaskOutput shapes, optional Bash `returnCodeInterpretation`, ordinary redirect classification, and the flat fallback are recorded in `../research/2026-07-31-tui-clone/07-p94-tool-census.md`. Final probe hashes are `ef882c088ae10ac0bbe996d3cd2c44d8a9aa8504a3cb6886c903e89e4cd1a7dc` and `6c4af1b24c3f60441b7b0df2d07c7631c3ab8de5f4ea784fb50b10c94c5e9959`; both fail closed on competing credentials and alternate provider routes and require the resolved SDK provider to be `firstParty`; P94 additionally uses a minimal child environment plus a credential/network/write-denying sandbox (read containment is explicitly not claimed), while 94b exposes no tools. Frequencies stay in the evidence report and are never dispatch constants. | `ST3`'s structured-first/fallback vocabulary, `LT1`'s per-tool rows, `LT2`'s clause grammar | done |
| **P86 ✅** | Done 2026-08-03 (probes 86/86b, report `../research/2026-07-31-tui-clone/09-p86-ink-input-matrix.md`). `useInput` destroys key identity (`home ≡ end ≡ insert ≡ F1–F12`); F2 replaced it with a root raw-stdin parser. Unreachable key classes recorded in `tui-ux.md` §1a. | **scopes F2 and F5** — separates unreachable from unbuilt | done |
| **P80 ✅** | Done 2026-08-04 (`probes/80b-interrupt-error-sentinels.ts`, report `../research/2026-07-31-tui-clone/13-p80-p81-sentinels-compact.md`). `query.interrupt()` puts the literal sentinel on the wire: a real `type:"user"` frame whose sole text block is `[Request interrupted by user for tool use]`, after the rejected `tool_result` frame, before `result{terminal_reason:"aborted_tools"}`. AbortController is NOT interchangeable: the iterator throws, no frames follow, the sentinel lands only in the session file. API errors arrive as assistant text — `error:"invalid_request"` + `is_api_error_message:true` with upstream's `Prompt is too long · …` wording — with the trap that the turn's `result` frame still reports `subtype:"success"` while `is_error` is true. Credit-balance covered by labelled static grep only (`billing_error` tag exists in the binary). | `LT14`, `TR38` | done |
| **P81 ✅** | Done 2026-08-04 (`probes/81-compact-boundary.ts`, same report). `compact_boundary` carries a trigger tag (`manual`), `pre_tokens`/`post_tokens` (+ undeclared `cumulative_dropped_tokens`), a duration and relink anchors — but NO summarised-message count and NO direction field; a count must be derived locally. Critical: `getSessionMessages` strips `subtype`/`compactMetadata`/`isCompactSummary`, so the boundary must be captured while it streams — it is unrecoverable from the persisted-message API. | `TR36` | done |
| **P82 ✅** | Done 2026-08-04 (`probes/82-thinking-timestamps.ts`, report `../research/2026-07-31-tui-clone/10-p82-thinking-timestamps.md`). No time-bearing field on any `stream_event` frame; completed-message ISO timestamps are block-FINISH stamps with no start counterpart. Local arrival clocking is the duration source (proven within 1–14 ms of the wire span over an 8.5 s block); the timer key must be (message id, block index) because `event.index` restarts per API message. Replay/resume cannot recover durations — omit, never infer from finish-to-finish deltas. | `TR33`, `LT2`'s first clause | done |
| **P83 ✅** | Done 2026-08-04 (`probes/83-agent-usage-identity.ts`, report `../research/2026-07-31-tui-clone/11-p83-agent-usage-identity.md`). Child `usage` blocks are NOT summable (265–342% overshoot — per-turn context re-count); the sidecar's `totalTokens` is itself the final child message's four usage fields summed. Faithful fallback totals: `system/task_notification.usage` `{total_tokens, tool_uses, duration_ms}` keyed by Agent tool_use_id (arrives just before the `tool_result`; the ONLY totals source for parallel dispatches, whose sidecars come back `async_launched` with no totals); tool-use count by counting child `tool_use` blocks per `parent_tool_use_id` (exact ×5); duration by first-child-frame→result arrival (±1–7 ms). Identity is rich: child frames carry `subagent_type`/`task_description`/child `message.model`; `system/task_started` binds tool_use_id↔task_id↔type↔description first. Child frames carry the PARENT's session_id; `stream_event` partials have null `parent_tool_use_id` (no token-level streaming inside a subagent). | `LT17` fallback, `TR39`, `DG21` | done |
| **P89** | Does `getContextUsage` expose window size, reserved output and the auto-compact point — enough for upstream's token-absolute `warn`/`compact`/`blocked` levels rather than a naive percentage? | `CH4`, and statusLine's `context_window` block | before F7 |
| **P95** *(new)* | **statusLine payload sourcing.** Which of the 20 documented plus five undocumented fields can we actually populate — `transcript_path`, `prompt_id`, `context_window.*`, `rate_limits` (probe 55 says null under OAuth), `cost`, `output_style`, `agent`, `worktree`? | `CH11`'s fidelity claim and the degradation contract | before F7 |
| **P84 ✅** | Done 2026-08-04 (`probes/84-bash-stdout-background.ts`, report `../research/2026-07-31-tui-clone/12-p84-p85-bash-hooks-wire.md`). A foreground Bash is wire-silent for its whole runtime (only `system/task_started` ~5 s late and `task_notification` at completion; zero stdout, no `tool_progress`) — `LT19` is unreachable. Nothing announces the background affordance (`run_in_background` absent from the init frame): `LT20`'s hint is client-side schema knowledge, gated on the call's `task_started` arrival. The ACTION is real: `backgroundTasks(toolUseId)` after `task_started` backgrounds the command and the `tool_result` short-circuits within ~1 s with the output-file path (corrects probe 67: called early, targeted form returns false and the no-arg form returns true while backgrounding nothing). | `LT19`, `LT20` | done |
| **P85 ✅** | Done 2026-08-04 (`probes/85-hook-timing-classifier.ts`, same report). Both hook species execute invisibly — no `hook_started`/`hook_progress`/`hook_response`/`tool_use_summary` frames — so `LT21` is unreachable. No classifier verdict is annotated anywhere (no `system/permission_denied` across five permission paths; a genuine denial's only traces are prose in the model-facing tool_result and a reason-less `result.permission_denials` entry), so `LT22` is unreachable. | `LT21`, `LT22` | done |
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
| Numeric Bash exit codes on the tool-result wire | P94 on SDK 0.3.220: recognized Bash sidecars carry stdout/stderr/interruption fields and may carry the optional string `returnCodeInterpretation`, but no numeric exit code | Upstream's `$`/numeric-exit-code framing cannot be reproduced from the reachable SDK wire. F1 uses recognized structured Bash fields when uniquely associated and the flat result/error fallback otherwise |
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
| Incremental stdout for a running Bash | P84 on 0.3.220: the wire is silent between `tool_use` and `tool_result` (only `task_started` ~5 s late and `task_notification` at completion) | `LT19`'s last-5-lines live box and the `(elapsed · timeout)` progress indicator. The background *action* remains reachable via `backgroundTasks(toolUseId)` after `task_started` |
| Hook execution visibility on the client stream | P85 on 0.3.220: in-process and settings-layer hooks both run invisibly — no `hook_started`/`hook_progress`/`hook_response`/`tool_use_summary` frames | `LT21`'s `Ran N PreToolUse hooks (Xms)` rows |
| The auto-mode classifier's verdict | P85 on 0.3.220: no `system/permission_denied` across five paths; a denial leaves only tool_result prose and a reason-less `result.permission_denials` | `LT22`'s `Allowed/Denied by auto mode classifier` annotations |
| Token-level streaming inside a subagent | P83 on 0.3.220: every `stream_event` partial carries a null `parent_tool_use_id` | `LT16`'s inner rows update per complete child message, never per token |
| The default-mode elapsed suffix and conjugated agent clause | Bundle-verified 2026-08-04: `V8p`'s anchor is computed only under `if (s && ds())` (L427963–427974), and the default finalizer `ke_` (L302123) never sets `agentCount`/`agentDescriptions`, so `s8p`'s single call site (L428041) is dead when `ds()` is false | `LT5`'s ` · 12s` group suffix and `CH23`'s 77-entry conjugation table are fullscreen/brief-mode-only upstream; the tracked default (`ds() === false`, R2.1) shows neither. Recorded, not built |

### Merely unverified — a probe decides

Image content blocks (P87) · reasoning effort and pricing metadata (P88) · token-absolute context
thresholds (P89) · task item fields (P90) · anchored summarize and seeded fresh turns (P91) · auth and
refusal events (P92) · Chrome/browser tool presence in `canUseTool` (unanswered by probe 78, which
covered Read/Write/Edit) · OSC round-tripping from inside an Ink render (P93) · statusLine payload
sourcing (P95). *(P84, P85 and P86 moved to the settled table above on their 2026-08-03/04 returns.)*

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
- **Diff line numbers: use a recognized structured patch first; use a disk-assisted, visibly approximate
  fallback only for flat-only results.** P94 corrected probe 77's block-level observation: the ordinary
  `tool_result.content` remains flat, but a uniquely associated `SDKUserMessage.tool_use_result` may carry
  `structuredPatch` with absolute hunk positions. Use those positions directly and never reread the file
  in that branch. For a flat-only, unknown, unmatched, or ambiguous sidecar, retain the complete Edit
  input and flat result; a local disk read may anchor the input diff only when the expected content still
  matches. When the file is missing or has changed, use hunk-relative numbering with a visible marker.
  **Being visibly approximate beats being confidently wrong.** Rejected: rereading disk despite a
  recognized structured patch (it can observe state newer than the completed edit). Rejected: staying
  snippet-relative always (a permanent divergence for flat-only results). Rejected: pretending fallback
  numbers are absolute.
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
  uniquely associated recognized sidecar, and retain deterministic flat/input fallback. UUID-bearing result
  completion is waiter-owned by exact UUID and submitted provenance class. UUID-less frames may use explicit
  matching-origin FIFO; origin-absent FIFO is restricted to a compact waiter that observed its own compact
  lifecycle marker. Background/synthetic frames cannot complete another turn. Rejected:
  derived-only rendering, sidecar-only rendering, and globally treating every locally injected prompt as
  human.
- **Ctrl-O is a second projection, not mutation of static history** (bundle trace, 2026-08-02). The live
  log remains append-only; canonical messages/events survive underneath it. Ctrl-O opens a detailed
  transcript that reprojects those originals untruncated, while transcript-local Ctrl-E explicitly
  toggles show-all/collapse. Rejected: re-rendering already emitted Ink `<Static>` rows, which would replay
  terminal history and still cannot recover facts discarded into `RenderLine[]`.
- **The folded row's count MUST render bold in F3 — the flat count is rejected** (owner, 2026-08-03).
  The Ink `<Text dimColor bold>` limitation (Surprises, 2026-08-03) does not downgrade the requirement;
  F3 ships a mechanism that produces a real bold count inside the dim row. Mechanism choice is delegated
  to F3 design — candidates are a raw-SGR line writer for fold rows, or upstream's own shape (bold child
  nested inside a dim parent, accepting upstream's post-count dim loss, which the golden shows is what
  2.1.220 actually emits). Rejected: shipping the count unbolded.
- **Bold-count mechanism chosen: a raw-SGR fold-row writer emitting upstream's exact byte shape —
  bold count nested in the dim run, post-count dim loss included** (F3 design, 2026-08-04). Direct
  bundle read (L428046) confirms upstream renders the whole clause run as ONE `<Text dimColor={!s}>`
  with nested `<Text bold>` children, whose `\x1b[22m` closer clears faint — the golden's plain
  `" file…"` tail IS upstream's emission, so matching it byte-for-byte drives that row's remaining six
  divergent cells to zero. Our Ink cannot compose bold+dim via props (Surprises, 2026-08-03) and chalk
  rewrites raw SGR inside a styled `<Text>`, so the fold row is emitted as one pre-styled string
  through an unstyled `<Text>`; a TDD passthrough test must pin that an unstyled Text preserves raw
  SGR before anything builds on it. Rejected: a "corrected" writer that keeps dim after the count
  (diverges from the golden forever — better-than-upstream is still divergence under this brief).
- **F4 design settlements (2026-08-04).** (1) **Markdown renders marked tokens into our
  `RenderLine[]`/`Segment[]` model, not glued ANSI strings.** Upstream glues chalk output into one
  wrapping `<Text>`; we keep the line model so the one `renderMarkdown` swap upgrades all three call
  sites (render.ts, liveTurn, PlanDialog), the frame corpus and pager keep working, and `preStyled`
  stays the narrow fold-row escape hatch. Consequence: `Segment`/`RenderLine` gain
  `strikethrough`/`underline`/`bg` and `Line.tsx` forwards them — substrate-first task. Rejected:
  emitting glued ANSI through preStyled segments (forfeits theme resolution, frame-corpus
  comparability, and every existing Line-model consumer). (2) **Take `diff` (jsdiff) as F4's second
  dependency.** Upstream itself calls jsdiff (`_vs`/diffWords; `structuredPatch` shapes match); the
  flat-only Edit fallback needs real hunk construction and the word-level intra-line diff needs a
  word differ. Same argument that admitted `marked`: maintaining a diff engine forever is the wrong
  trade. Rejected: hand-rolled LCS. (3) **Species are reachability-scoped.** The ten sentinel routes
  and ~12 system subtypes are upstream-internal kinds; we build a renderer for every species
  reachable on the SDK wire (declared in the `SDKMessage` union or observed live) and record the
  rest unreachable with evidence — the F2/F3 discipline applied to message species. (4) **`TR18` is
  satisfied by architecture:** we re-lex the accumulated text each repaint and marked already treats
  an unterminated fence as code, so the fence re-prepend trick is unnecessary; pinned by a
  mid-stream open-fence test rather than ported. (5) **`TR33` is already F3's shipped mechanism**
  (local-clock thinking durations + the fold clause); F4 verifies and pins rather than rebuilds.
  (6) **The highlighter keeps the `TR22` exception but adopts upstream's hljs scope colour map**
  (keyword→blue, string→red, number→green, comment→green) — an S-effort fidelity gain inside the
  recorded exception, not a reopening of it.

## Surprises & Discoveries

- **The Agent sidecar's `totalTokens` is not an aggregate, and summing child usage fabricates one.**
  P83: per-message child `usage` blocks re-count the child's context every turn (cache reads climb
  monotonically), overshooting the sidecar by 265–342%; the sidecar's own `totalTokens` is exactly the
  final child message's four usage fields summed. The honest fallback was hiding in plain sight:
  `system/task_notification.usage` carries `{total_tokens, tool_uses, duration_ms}` keyed by the Agent
  tool_use_id, arrives just before the `tool_result`, and is the ONLY totals source for parallel
  dispatches (their sidecars return `async_launched` with no totals — parallelism, not agent type,
  triggers that). (2026-08-04)
- **Two stop paths, two different wires.** `query.interrupt()` yields a real user frame carrying the
  literal `[Request interrupted by user for tool use]` sentinel plus a `result{terminal_reason:
  "aborted_tools"}`; an AbortController abort throws out of the iterator with NO further frames — the
  sentinel lands only in the session file. A client that treats them as one path renders the wrong
  thing on one of them. Also: API errors arrive as assistant text (`is_api_error_message:true`) while
  the turn's `result` frame still says `subtype:"success"` — is_error is the trustworthy bit. (2026-08-04)
- **`compact_boundary` must be captured in flight.** The streamed frame carries trigger, token deltas
  and anchors (no summarised count, no direction — derive locally), but `getSessionMessages` strips
  `subtype`/`compactMetadata`/`isCompactSummary`, so the boundary is unrecoverable from the
  persisted-message API afterwards. (2026-08-04)
- **The auto-mode classifier's permissiveness is model-dependent, and sharply so.** P85's incidental:
  on `claude-sonnet-5` it allowed every operation the probe could safely construct — deleting a
  pre-existing file, writing into `$HOME`, invoking sudo, writing `.claude/settings.json` — the last
  of which probe 18e saw BLOCKED on sonnet-4-6. Relevant to the harness's autonomy posture beyond F3;
  the `sdk-permissionmode-canusetool-matrix` memory should carry it. (2026-08-04)
- **Probe 77 was right about the block and wrong about the message.** Final SDK 0.3.220 P94 evidence confirms
  `SDKUserMessage.tool_use_result` alongside flat `tool_result.content`, but sidecar presence varies per call:
  even Agent and the high-volume Read/Bash tools had flat-only calls. The enduring contract is structured-first
  with a flat/input fallback, never either premise globally. One Bash sidecar also added optional
  `returnCodeInterpretation`; it is structured source, not a numeric exit code. (2026-08-02)
- **OAuth-only is a credential condition, not an endpoint condition.** An inherited custom
  `ANTHROPIC_BASE_URL` routed a valid subscription token to a gateway that rejected it as an API key, while
  `accountInfo()` still correctly reported the selected token source. P94 and 94b now reject custom base URLs
  and alternate cloud-provider routes before starting a live turn, so their evidence is explicitly first-party.
  (2026-08-02)
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
- **Ink cannot express bold-and-dim on one `<Text>`, so the folded row's bold count does not render bold.**
  The render contract's R3.5 assumes "Ink composes dim+bold". Probed directly against the installed Ink:
  `<Text dimColor bold>1</Text>` emits `\x1b[2m1\x1b[22m` with no `\x1b[1m` at all, and embedding a raw
  `\x1b[1m…\x1b[22m` inside a dim `<Text>` is rewritten by chalk's nested-close handling into a bold run that
  never closes. Upstream gets bold+dim only by nesting a bold child inside a dim parent — which is also why
  its own row loses dim for everything after the count. A declared styling combination is not a reachable
  one; this needs a raw-SGR line writer or a dim-hoisting `Line`, and is recorded as an F3 item rather than
  papered over. (2026-08-03)
- **The tracked 2.1.220 golden contradicts two statically-derived contract rules, and the binary wins.**
  R4.2 says the unresolved leader glyph is "dimColor with no color"; the golden's cells are dim **and**
  `#999999`, and so is the `(ctrl+o to expand)` hint and the whole `  ⎿  <path>` hint row, connector
  included. R3.5's `dimColor={!isActive}` also has its polarity backwards for the active row. Both were
  adopted from the capture and the divergence on that row fell from eleven cells to six. (2026-08-03)
- **The settled row's grey is the same `#999999` as the active row's; the `#949494` was ambient palette.**
  The one colour the ACTIVE golden could not settle was the settled row's own, and the live-confirmation
  note recorded a different grey (`#949494`) for it — which read as two upstream colours and kept the
  settled clause run dim-and-uncoloured. A dedicated settled-state probe run under the *tracked capture
  environment* (pinned `TERM=xterm-256color`/`COLORTERM=truecolor`, wrapper and palette variables removed)
  paints `#999999`. The `#949494` was the ambient-palette variant of the earlier probe's own environment
  (`COLORFGBG` present), not a second upstream value. The settled clause run now carries the `inactive`
  token. The lesson generalizes: a colour measured outside the pinned capture environment is a measurement
  of that environment, and cannot be compared against one taken inside it. (2026-08-03)
- **A persisted user row whose `content` is a bare string projects to no line at all, and the naive fix is
  worse than the gap.** `render.ts`'s user branch iterates array `content` only, while `sessions/rows.ts`
  `promptText` explicitly handles the string shape — so the two disagree about what a persisted prompt
  looks like, and F1's upstream comparison fixture paints no prompt row. It was left unfixed deliberately:
  simply rendering string content would also start painting `<command-name>` / `<local-command-*>` envelope
  rows raw on the attach path, which `replayDocument` filters but the `initialEntries` bootstrap does not.
  The fix belongs with a shared bootstrap filter, not with the renderer. (2026-08-03)
- **Frame comparison is sensitive to repaint history, not just to the projection.** The live route reaches a
  settled screen by shrinking (active row plus hint gutter into one settled row), and Ink's incremental
  erase sequences inherit whatever SGR is current — so the live screen's blank padding cells kept a `dim`
  attribute the replay screen's did not, while every cell holding a character was identical. The fixture's
  key script now opens and closes the ctrl+o pager before the compact frame, repainting the region from a
  state both routes share, which removes the inherited-terminal-state term instead of masking it. (2026-08-03)
- **`useInput` does not merely inconvenience the binding table — it destroys key identity, and only a
  measurement showed it.** P86 put every key through Ink's fixed 14-boolean record and found `home ≡ end ≡
  insert ≡ F1–F12`, `ctrl+home ≡ ctrl+end`, Backspace ≡ Delete, and the whole `\x1f` control class landing in
  text-insert paths: the parser underneath knows which key it was and the hook throws the name away. So the
  raw-stdin root consumer is not an architectural preference we could have argued our way to — the design was
  **forced by a probe**, and the plan that predated it ("one `useInput` subscriber at the root") would have
  shipped a table that could not express half its own rows. The full byte tables and the working substitute
  recipe are in the 2026-08-03 Revision Note; the lesson to carry is that a dependency's declared surface
  ("`useInput` gives you the key") and its reachable one are different questions, and only one of them is
  answerable by reading. (2026-08-04)
- **A swallow resolves against the innermost LIVE scope and ignores `preemptive`, so the swallow and the scope
  have to live in the same component.** `swallowContexts` identifies the swallower as the newest active scope,
  which is true by construction for a modal (it mounts last and nothing mounts inside it) — but it means a
  component that swallows while a DIFFERENT component owns the innermost scope swallows on that other
  component's behalf, and that a preemptive scope elsewhere does not rescue it. Splitting the two across
  components produced exactly the surprising case: the rewind hold swallows with no scope of its own, which
  correctly eats `Global` too, and that is only correct because ChatApp deactivates its own `Task` scope during
  the hold — otherwise `Task` would have been "the swallower" and its `ctrl+x ctrl+b` chord would have survived
  a modal whose entire purpose is to survive nothing. (2026-08-04)
- **The migration audit was per-CONTEXT and the thing it was auditing was per-SURFACE, and one overlay fell
  through the gap.** Task 8's sweep enumerated the twenty context names and checked each had an owner; the old
  imperative gate it was replacing was written per visible surface. A surface whose context was already
  "covered" by another component was therefore invisible to the audit — the embedded add-directory prompt
  under the permissions dialog, assigned a park-dialog context that something else already owned. **A fidelity
  audit must enumerate the surfaces a user can see, not the abstractions the new design happens to group them
  into**; the grouping is precisely what hides the omission. (2026-08-04)
- **A `null`-unbound chord must not arm its own prefix, or a user's unbind can make the plain key permanently
  unreachable.** Merge is additive — a later layer can change an action or add a key, never delete an entry —
  so if a null-bound `"ctrl+x ctrl+k"` still contributed `ctrl+x` to the prefix set, a user who unbound the
  chord would find `ctrl+x` eating the next keystroke forever, with nothing left to complete it. Cross-context
  shadowing does not need the null to arm either: the pending walk still checks exact completions per context,
  so a chord unbound above a live lower one resolves as `unbound` on its own. (2026-08-04)
- **An uppercase single letter in a binding spec means shift, which is why the caps warning exists.** `"CTRL+G"`
  does not bind ctrl+g — it binds ctrl+**shift**+g, because a lone capital letter is the documented shorthand
  for `shift+<letter>` and it applies to the key name whether or not the writer meant it to. Someone who
  shouted the modifier usually shouted the key too, so the two failures arrive together and the binding lands
  on a key they will never press. Hence `suspicious_key`: a warning that KEEPS the binding (it is legal) but
  says what was actually installed. (2026-08-04)
- **The `latin1` encoding flip had to be gated on a migrated consumer existing, and the ungated version was a
  live mojibake regression.** Setting `stdin.setEncoding("latin1")` is what makes non-ASCII input recoverable
  — but while any un-migrated `useInput` component was still mounted, that component received raw bytes it
  decoded as characters, so every accented character typed at launch rendered as mojibake in the real REPL
  while every test stayed green. The flip is therefore conditional on the registry being non-empty, which is
  both the transitional fix and the permanent right answer: a bare provider with no consumers must not touch
  an encoding nobody is decoding. (2026-08-04)

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

P94 is complete on the harness's exact SDK 0.3.220, including the separate Write-only proof and first-party
route isolation. Its exact final source hashes are `ef882c088ae10ac0bbe996d3cd2c44d8a9aa8504a3cb6886c903e89e4cd1a7dc`
and `6c4af1b24c3f60441b7b0df2d07c7631c3ab8de5f4ea784fb50b10c94c5e9959`. The Session ownership
prerequisite now distinguishes human from automatic local turns while correlating every successful completion
by UUID. F1 is schedulable; F1–F8 remain otherwise pending.

### F1 outcome — completed 2026-08-03

F1 replaced the split live/replay renderer with a single canonical source. `tui/transcriptModel.ts` retains
complete SDK messages verbatim — flat `tool_result` content and the optional per-call `tool_use_result`
sidecar alike, associated only when the association is unambiguous — together with inherently local visual
events, in one ordered document. `tui/toolRenderer.tsx` is the only projection from that document to
renderable items, and live, replay, attach, resume, rewind and the Ctrl-O pager all reach a row through it.
Ink's `<Static>` therefore holds finalized rows only; open calls and the trailing, still-growable fold run
live in the transient region and are re-projected, never republished. Ctrl-E inside the detail view is a
purely local verbosity flip over the same retained source rather than a second mutable history.

The owner-approved 5b/5c amendment pulled the default-view collapse layer forward from F3, because the
committed per-call `⏺ Read(path)` row turned out to be upstream's ctrl+o form, not its default one. The
default view now folds a contiguous run of read/search/list/MCP calls into one dim summary row, with an
active form (blinking leader, present-participle clause, transient `⎿` hint) while any member is running.

Evidence is split deliberately, because a full-screen comparison against full Claude Code chrome cannot be
a gate while overall parity sits near 63%. The binding checks are row-scoped: a required-state contract
enforced by a new `capture-frames.py --require-state` flag, which extends contract loading, the
missing-contract preflight and per-frame validation to untracked scratch output — without that flag the
selectors declared for these keys loaded nowhere and every capture exited zero having verified nothing.
Four pyte captures of the real `ChatApp`, driven through a credential-free replay fixture
(`test/fixtures/f1-tool-transcript-frame.tsx`), prove that the sidecar-bearing and flat-only Read render
identically through the live host-event route and the bootstrap/replay route: two `frame-diff.py` runs,
each `2 clean, 0 allowlisted, 0 DIVERGENT`, with a sidecar-versus-flat cross-comparison confirming the
diff is not vacuous. Paired OSC-8 evidence comes from real Ink bytes rather than a text frame: the header
path carries the exact BEL-terminated open and close sequences, and the same projected items emit identical
text with different SGR under the dark and light palettes.

The real-upstream comparison is credential-isolated in both directions: the golden was captured from the
installed `claude` 2.1.220 under OAuth, and our counterpart capture needs no credential at all. Read as a
diagnostic it found one genuine F1-owned divergence — the `⎿` hint row's connector rendered plain where
upstream renders the whole row dim `#999999` — and the renderer was fixed until that row became
byte-identical to the golden. Nothing was allowlisted; `allowlist.md` still holds zero entries, and the
Python contract test that used to assert emptiness is now a closed rule allowing at most the one reviewed
upstream key. The residual whole-frame divergence is chrome F1 does not own plus one upstream escape-sequence
artifact, both recorded in the parity scorecard rather than registered.

All seven F1 acceptance contracts pass with the named evidence. Final verification covers typecheck, package
build, the TUI suite (817 tests over the keyless files), 1,245 unit tests, 17 integration tests, 7 contract
tests, the Python suite, `verify:pack`, and a clean `git diff --check`. The tracked TUI test inventory is
**54 files** — `git ls-files 'test/tui/*.test.*'`, whose `*` crosses `/`, so that is 45 keyless files plus
the 9 credential-gated `test/tui/live/*.e2e.test.ts`; the "44" recorded here at closeout was neither.
(The Python suite stands at 108 tests / 144 subtests after the closeout review fixes.)

### F2 outcome — completed 2026-08-04

F2 replaced seventeen ad-hoc `useInput` callbacks and a nested-ternary-plus-six-flags ownership scheme with a
keymap that is data. `keys/bindings.ts` is the single table — upstream's 20 context names, a closed 55-action
vocabulary, 136 default entries across the 12 contexts that carry any, and a reserved-key registry;
`keys/resolver.ts` walks an ordered context array with first-match-wins, where a `null` binding consumes the
key as explicitly unbound and stops the search, which is how a surface now states declaratively which of the
root globals reach it. `keys/KeymapProvider.tsx` is the one component that reads stdin bytes, parses them with
our own keypress parser (P86: Ink's hook cannot express the table), and dispatches through a registry ordered
by mount, with `swallowAll` and preemptive scopes above the chain. Chords are generic and space-separated with
a 1 s window; `~/.claude/keybindings.json` merges additively over the defaults on upstream's own path and file
shape, hot-reloads on save, validates into typed issues that land in the transcript rather than in a crash,
and supports the `command:<name>` form, which dispatches through the same submit seam a typed `/name` takes.
Zero `useInput` calls remain anywhere under `src/tui/`.

The wave's last task closed the loop the table exists for: **hints are derived, not typed**. The composer's
footer ladder, the status bar's mode chip and every table-owned row of the `?` shortcuts grid read the live
binding, so a rebinding moves them and an unbind prints `(unbound)` instead of continuing to advertise a dead
chord. Under the default keymap the derived grid reproduces the previously hand-written strings byte for byte,
which is what lets F0's honesty audit — a corpus of executable proofs keyed by those strings — keep auditing
the grid unchanged. Three hint surfaces stay literal on purpose and are recorded rather than quietly excepted:
the transcript-pager and history-search footers (multi-alias ladders a generated string would render worse
than the hand-written one) and `toolRenderer.ts`'s `(ctrl+o to expand)` fold marker (a pure projection module
with no context to read the table from, pinned to the tracked 2.1.220 golden).

All six acceptance items are executed as tests in `test/tui/keys-acceptance.test.tsx` rather than asserted
about, each shown to bite under a deliberate sabotage. Two of the spec's own wordings were corrected in the
process: acceptance 1's `ctrl+g` example is already a default and would have passed with the whole user layer
deleted (the test adds `alt+e` and keeps `ctrl+g` as the survives-the-merge check), and acceptance 6 is
asserted per unreachable class rather than per section heading. The unreachable families P86 settled —
`super`+letter and `ctrl+shift+<letter>` off CSI-u, `shift+enter` without `/terminal-setup`, `ctrl+m` as
anything other than Enter, and Windows/ConPTY as undetermined — are recorded in the parity scorecard's new
§1a with their evidence, alongside `meta+o`/`meta+w`, which are dropped because the surfaces they would open
do not exist here.

Verification: `npm run typecheck` and `npm run build` clean; the eleven `keys-*` suites (418 tests) plus the
full tracked keyless TUI inventory (56 files, 1,247 tests) green; `npm run test:unit` green (135 files, 1,245
tests). The scorecard moves §1 from
~78% to ~86% (`ST5`/`ST6` ❌→✅, three new rows for the user file, generic chords and derived hints) and §5
from ~86% to ~88% (`/keybindings` opens the real file now), for an overall ~63% → ~65%. The keybinding ledger
behind those rows — all forty `K1`–`K40` research rows, re-scored — sits at 18✅ + 1🟡 of 31 non-🚫 rows.

## Revision Notes

- 2026-08-05 — **F6's "composer still mounted" premise was wrong — upstream HIDES the prompt input
  whenever a dialog is visible (T5 review, bundle-traced).** `KVf` renders only under
  `zU.kind === "none"` and the dialog-visibility gate (L549494); `Fui()` (L499192) is `"visible"`
  exactly when the dialog store has an open, unsuppressed dialog. `layout:"inline"` vs `"modal"`
  (L507338) decides WHERE the dialog draws — in the scrollable transcript flow vs the overlaid modal
  slot — not composer coexistence. Upstream protects a mid-typing draft by the OPPOSITE mechanism:
  the dialog is **suppressed while typing** (`Xrl()` L499196 returns null while the composer's
  activity flag is set — non-empty input sets it, cleared 1500 ms after the last keystroke,
  L547796-802) and the composer shows a dim `Waiting for permission…` row (L496241) until typing
  pauses. The F6 theme sentence and acceptance #3 are corrected accordingly: the Edit prompt's diff
  renders in the transcript flow (not a screen-covering modal, transcript stays); the composer is
  hidden while the dialog is visible; a prompt arriving mid-draft is suppressed behind
  `Waiting for permission…`. DG27 is delivered in that corrected form.
- 2026-08-05 — **F6's DG28 ("Enter plan mode?" dialog) is unreachable headlessly (probe 81).**
  `EnterPlanMode` executes without ever consulting `canUseTool` — there is no hook to hang the
  dialog on. Recorded beside CM6/CM7; the spec's Delivers line is superseded.
- 2026-08-05 — **F5 acceptance #1's "40 lines" is 40 NEWLINES (Task 3).** `kmt` (L317378) counts newline
  matches, not visual rows, so the paste that mints `[Pasted text #1 +40 lines]` is one containing 40
  newlines — 41 lines of text. The threshold itself is also rows-dependent (`max(0, min(rows-10, 2))`), so
  the plan's flat "> 2 newlines" holds only on a terminal at least 12 rows tall.
- 2026-08-05 — **F5 acceptance #3's ghost text is the MID-TEXT surface (Tasks 9/10).** `Pli` (L489935)
  demands whitespace or CJK punctuation before the slash, so a buffer-leading `/mod` cannot produce a ghost;
  it opens the popup (`YRr`'s head branch, L490747). The criterion's three clauses are pinned on the two
  surfaces upstream splits them across: ghost + Tab mid-text, Enter-accepts-and-executes at the head.
- 2026-08-05 — **The 100 000-character cap gates the paste EXPAND, not only its hint (Task 5).** `bDo`
  (L317410) carries the `> lgr` refusal inside the locator `kne` calls, so a paste over the cap can never be
  expanded back inline; the plan described it as a hint-only gate.
- 2026-08-05 — **The paste cache is written at SUBMIT, inside the history append (Tasks 5/7).** The bundle's
  only `DUd` call is in `uu_` (L317608), behind `CLAUDE_CODE_SKIP_PROMPT_HISTORY` and behind the 1024-char
  inline split. The Task-5 write-at-chip-creation seam was a privacy edge (it wrote before submit and
  ignored the skip variable) and was deleted in Task 7.
- 2026-08-05 — **There is no `mode` column in the prompt history (Task 6).** Upstream writes `hon(text, mode)`
  (L548774) and every reader derives the mode back off the `!` prefix (`mP`, L489529). The plan sketched a
  `mode` field; a second source of truth for the same bit is exactly how a recalled `!git status` ends up in
  prompt mode, so the prefix stays canonical.
- 2026-08-05 — **There is no live garbage collection of text paste entries (Task 4).** Upstream's sweep
  (L495715–L495728) collects image/audio entries only and the text map survives to submit (L536788–L536792).
  An earlier draft GC'd text chips and lost payloads silently at every park site (history recall, kill ring,
  stash). Motions also step OVER a chip rather than treating it as impassable (L394793/L394803).
- 2026-08-05 — **`CM48`'s real guard is the first-line rule, not a popup rule (Task 8).** `Uge`
  (L495509–L495533) declines the drain when the buffer has more than one line *and the cursor has crossed the
  first newline*; the plan's guard was written as "any open popup". Our port keeps upstream's rule and adds
  only a declining-not-blocking arm for the popup, because in this port the popup's own ↑/↓ selection lives
  in the editor reducer rather than in a component above it.
- 2026-08-05 — **The inline reverse-i-search has NO scope cycling (Task 12).** `r9f`'s action memo (L489750)
  registers exactly four `historySearch:*` actions and `cycleScope` is registered only by the picker
  (L492190); upstream's inline corpus `kBs` (L317456) is unfiltered, i.e. permanently `everywhere`. A first
  implementation built cycling on a controller instruction and was strictly reverted on the bundle read; the
  bound `ctrl+s` is inert there, and a test pins the inertness.

- 2026-08-04 — **F4 acceptance #4's wording split across two surfaces, ratified against the bundle
  during Task 11 review.** The criterion reads as if the detail view carries `∴` + markdown +
  `Thought for 12s` together; upstream carries no duration in its transcript/ctrl+o view. At
  L429333 `collapsed_read_search` passes `verbose || transcriptMode` down, and that branch
  (L427922–427942) ungroups and renders each thinking block through `zAr` — gutter and markdown
  body only; the `Thought for …` clause is assembled solely in the compact fold-run branch
  (L427983). The shipped pins therefore split the criterion: gutter+body in detail, duration as the
  compact fold clause — which is what both products actually do. The criterion's sentence, not the
  code, was imprecise.
- 2026-08-04 — **Census 01#153 corrected during Task 7 review: the Agent `Done (…)` row is a `⎿`
  gutter row, not a bulleted line.** Direct bundle read of `Vha` (L429640–429654): all three Agent
  result rows — `Cloud agent launched`, `Backgrounded agent`, and the completed `Done (…)` — render
  inside `Cr height:1` (the standard result gutter), the completed one wrapping its synthetic
  message with `shouldShowDot: false` and a SIBLING dim `  (ctrl+o to expand)` line (compact only).
  The census's "rendered with the standard ⏺ bullet, not as a ⎿ row" was wrong; the fix round also
  verified upstream's mandatory fraction digit in `_d` at ≥1000 (`12.0k`, never `12k`) and its
  no-fabrication rule (`status !== "completed"` → null — never a `Done (0 tool uses)`). Two
  deliberate divergences recorded: we UPGRADE `Backgrounded agent` to `Done (…)` when a
  `task_notification` arrives pre-publication (upstream keeps the launch row; ours is strictly more
  honest), and our detail projection orders Done-then-nested where upstream's transcript mode orders
  prompt → nested → content → Done (left for Task 10 triage with the running-branch/short-terminal
  gaps).
- 2026-08-04 — **F3 acceptance #2's Write clause corrected during Task 6 review.** The census
  (01#58–62) shows upstream's DEFAULT create render is the 10-line highlighted preview alone with a
  bare `… +N lines` marker; `Wrote N lines` belongs to the condensed/scratchpad styles this clone
  does not model. The stacked count-plus-preview the plan first specified was an invention and was
  dropped; the count row survives as the honest no-content fallback only.
- 2026-08-04 — **F3 probe round complete (P80–P85) and four F3 amendments recorded.** (1) Acceptance
  #1's ` · 12s` group elapsed suffix removed: R4.10 is bundle-verified (`V8p`'s anchor computed only
  under `if (s && ds())`, L427963–427974) — the suffix is fullscreen-only and the tracked default is
  `ds() === false` (R2.1). (2) `CH23` removed from Delivers: `s8p` has one call site (L428041) inside
  the agent clause, and the default finalizer `ke_` never sets `agentCount`/`agentDescriptions`, so
  the conjugation table is dead outside brief mode — recorded in § Cannot build with `LT5`.
  (3) `LT19`/`LT21`/`LT22` moved from probe-gated non-goals to settled unreachable (P84/P85 negative).
  (4) `LT4` split by reachability: 700 ms debounce and the thinking-summary hint are default-reachable
  and ship; the bash progress suffix is `ds()`-gated and does not. Also corrected: F1's
  `toolRenderer.tsx` comment claiming the 700 ms debounce is `ds()`-gated — the contract's R4.7 shows
  the debounce unconditional; only the elapsed anchor and bash suffix are gated. `LT20` reworded: the
  hint is client-side schema knowledge gated on `task_started` (P84); the wire announces nothing.
- 2026-08-03 — **F2 architecture revision (probe-driven): ST6's "one `useInput` subscriber at the
  root" is superseded by a root raw-stdin consumer with our own keypress parser.** P86
  (`../research/2026-07-31-tui-clone/09-p86-ink-input-matrix.md`, probes 86/86b) proved `useInput`'s
  fixed 14-boolean record cannot carry the upstream binding table: `home ≡ end ≡ insert ≡ F1–F12`
  (byte-identical events), `ctrl+home ≡ ctrl+end`, `shift+home ≡ shift+end`, Backspace ≡ Delete, and
  the `\x1f` control class lands in text-insert paths — the parser knows the key, the hook discards
  it. The follow-up (86b) measured the substitute working end to end: render with
  `exitOnCtrlC: false` (mandatory — Ink's ctrl+C exit rides its stdin listener, not `useInput`),
  take raw mode through `useStdin().setRawMode(true)` so Ink keeps owning termios restore and stdin
  unref, `stdin.setEncoding("latin1")` (utf8 mangles high bytes irrecoverably; `setEncoding(null)`
  silently falls back to utf8), then attach our own `data` listener and parse bytes ourselves —
  which dissolves every collision and needs no consumed-filter because no `useInput` remains
  anywhere. The rest of ST6 (explicit React context stack, first match wins, `null` consumes as
  explicitly unbound, `swallowAll`/preemptive layers) is unchanged.
- 2026-08-03 — **F1 amendment (owner-approved): the default-view collapse layer moved from F3 into
  F1** as plan Tasks 5b/5c. Live pty probes against installed 2.1.220 proved the default transcript
  folds contiguous read/search/list tool runs into one dim `Read N files (ctrl+o to expand)` summary
  row (even a Bash `grep` folds, via a per-command classifier), that Bash/Edit/Write render standalone,
  and that our committed per-call render is exactly upstream's ctrl+o verbose form. Without the
  collapse layer the F1 golden could not be faithful. The full normative contract, bundle-line-tagged
  and live-confirmed, is `../research/2026-07-31-tui-clone/08-render-contract-2.1.220.md`. Still in
  F3: fullscreen-only (`ds()`) clauses, `grouped_tool_use` Agent batches, typed result summaries,
  totals. Related upstream facts recorded there for later waves: errored reads are invisible on a
  settled summary row; and click-to-expand of collapsed blocks is **fullscreen-mode-only** (contract
  § 12 — mouse reporting mounts only behind `ds()`, expansion is per-item verbose keyed by tool-use
  id, there is no keyboard equivalent for a single block, and fullscreen strips the textual
  `(ctrl+o to expand)` hint in favor of hover+click), so it belongs to the fullscreen wave, not F1.
- 2026-08-03 — **F1 closed.** Two rules in the render contract are corrected against the tracked 2.1.220
  golden `harness/test/fixtures/upstream-frames/f1-tool-rendering/01-read-complete.ansi`, whose per-cell
  attributes a pyte capture reconstructs exactly: R4.2's "dimColor with no color" is wrong (the active
  leader glyph is dim **and** `#999999`, as are the expand hint and the whole `  ⎿  <path>` hint row,
  connector included), and R3.5's `dimColor={!isActive}` has its polarity backwards for the active row.
  Both are adopted in `tui/toolRenderer.tsx`. Not adopted: the golden's plain `" file…"`, which is
  upstream's own `\x1b[22m` artifact — the bold count's closer clears faint as well as bold. R3.5's
  "Ink composes dim+bold" is separately false for our renderer (probe: `<Text dimColor bold>` drops bold
  entirely), so the folded row's count is not bold today; that is an F3 item, recorded in
  `../../parity/tui-ux.md`. The settled row's own grey is `#999999` as well — pinned by a dedicated
  settled-state probe under the tracked capture environment, which also identified the note's `#949494` as
  that probe environment's ambient-palette variant — and the settled clause run carries `inactive`.
  Instrument change: `scripts/capture-frames.py --require-state` extends required-state loading, the
  missing-contract preflight and per-frame validation to untracked output, so a row-scoped contract can
  gate a scratch capture; tracked behaviour is unchanged with or without the flag.
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
  Independent probe review hardened attribution, exact Write side effects, emitted tool configuration, cross-platform
  self-tests, and clean-install typing. Its unchanged final source passed every natural case and Write through an
  honestly recorded sharded validation after one all-corpus case timeout; the original successful run remains the
  sole frequency census. Independent review of the Session prerequisite then caught automatic heartbeat/compaction prompts being
  stamped human and the SDK's UUID-less compact-success exception. Permanent probe 94b proved human compact
  returns a human-origin UUID-less success, a normal automatic turn retains its exact UUID despite absent
  result origin, and automatic compact returns an origin-absent UUID-less success after a compact lifecycle
  marker. The final rule is UUID-first, then explicit matching-origin FIFO, with origin-absent FIFO restricted
  to a lifecycle-marked compact waiter; exact `submitAutomatic("/compact")` commands use that compact route
  rather than a normal automatic waiter. F1 is now schedulable. The installed bundle trace separately settled ST2 as an append-only live projection plus a
  Ctrl-O detailed transcript over retained source, with transcript-local Ctrl-E show-all/collapse. LT5 moved
  to the F3 collapsed-group state that owns it.
- 2026-08-02 — P94's final boundary review closed dynamic-key privacy, double-quoted shell-substitution,
  exact Write-sidecar, portable fixture-test, and OAuth-gate defects. Live retry diagnosis then found an
  inherited custom `ANTHROPIC_BASE_URL`: the refreshed subscription token was valid against Anthropic's
  first-party endpoint but the gateway rejected it as an API key. Both probes now fail closed on custom base
  URLs and alternate cloud-provider routes. Exact final sources `ef882c088ae10ac0bbe996d3cd2c44d8a9aa8504a3cb6886c903e89e4cd1a7dc`
  and `6c4af1b24c3f60441b7b0df2d07c7631c3ab8de5f4ea784fb50b10c94c5e9959` passed self-tests, TypeScript
  compilation, directed Write, and all three result-correlation cases with empty stderr.
- 2026-08-02 — whole-boundary Codex review closed seven final evidence-edge cases: P94b now rejects unhealthy
  successes, contains lifecycle failures in privacy-safe JSON, scopes compact markers to the second submitted
  turn, and rejects empty case selectors; P94 associates sidecars only through exactly one unresolved result
  with a nonempty ID, runs its fixture tests portably on Windows Node 18, and labels observed Bash-family
  metrics per call. The exact final hashes above additionally passed forced safe-failure and empty-selector
  regressions before the first-party live Write and compact-correlation reruns.
- 2026-08-03 — clean-pass re-review exposed the last first-party proof gap: inherited provider selectors cannot
  be exhaustively denied by name. P94 and 94b now classify `initialization.account.apiProvider` into the fixed
  privacy-safe vocabulary `firstParty` / `missing` / `other` and accept only `firstParty`. Their exact final
  live reports recorded `resolvedApiProviders:["firstParty"]` and `apiProvider:"firstParty"` for all cases.
- 2026-08-03 — final security review made the live evidence boundary fail closed around model-controlled tools.
  P94 now uses a minimal OAuth-only subprocess environment, denies credential variables inside sandboxed
  commands, denies network and unsandboxed escape, restricts home/temp reads with fixture re-allow, path-gates
  native tools, and disables web/skill surfaces; a dedicated live control proved token hiding, fixture access,
  protected-read denial, and outside-write denial. P94b exposes no tools or skills. Both probes now reject
  malformed result frames before ownership; `api_error_status: null` remains valid per the SDK contract. Exact
  final sources passed secure Write, all compact cases, and a natural four-Bash/one-Read sandbox run with zero
  malformed results and empty stderr.
- 2026-08-03 — follow-up review corrected the result-frame validator against the declared union and recorded the
  sandbox's real limit. The first validator required a string `result` on every frame, which rejects every
  conforming `SDKResultError` (that arm declares `errors: string[]` and no `result`) while accepting a sparse
  three-field object as a healthy terminal success. Both probes now validate `SDKResultMessage` as a
  discriminated union: the terminal fields both arms declare are required (finite `duration_ms`,
  `duration_api_ms`, `num_turns`, `total_cost_usd`; string-or-null `stop_reason`; object `usage`/`modelUsage`;
  array `permission_denials`; nonempty `uuid`/`session_id`), `success` additionally requires string `result` and
  allows `api_error_status` only as `null` or a finite number, and the four declared error subtypes require
  string-array `errors` without depending on `result`. Optional `user_message_uuid` keeps UUID-less compact
  successes valid. Finite-only numeric checks stop `NaN`/infinities from passing shape validation and then
  evading the `>= 400` health test. Exact final sources
  `ef882c088ae10ac0bbe996d3cd2c44d8a9aa8504a3cb6886c903e89e4cd1a7dc` and
  `6c4af1b24c3f60441b7b0df2d07c7631c3ab8de5f4ea784fb50b10c94c5e9959` were re-verified live: the directed Write
  case reported one valid healthy originating result with zero malformed frames, and all three correlation cases
  reported `apiProvider:"firstParty"` with six valid frames and no failures. The same review found the sandbox
  is credential/network/write isolation rather than read containment — a live control read `/etc/hosts` from
  sandboxed Bash and the native path gate authorizes lexically, so an in-fixture symlink is not resolved before
  authorization. That limit is recorded in the evidence report rather than claimed closed, because the probe
  runs trusted first-party prompts.

- 2026-08-04 — **F4 constants pack re-verified the transcript census against the bundle: 29
  contradictions (9 substantive) recorded and the pack made authoritative.**
  `research/2026-07-31-tui-clone/14-f4-constants-pack.md` extracts every F4-load-bearing constant
  verbatim; on conflict with `02-transcript.md` the pack wins (header note added there). Substantive
  corrections folded into the F4 plan: the ERe sentinel router has 15 exits; the VAr error switch
  has 11 cases + 2 default predicates + a 1000-char truncation; context-line content is undimmed
  (gutter-only); the word-diff path wraps one column wider; `dVo` nulls `api_error` and suppresses
  `level==="info"`; the metadata compact hint reads "expand history"; singular "Message" in the
  collapsed teammate line; a second label-polarity mode exists only when highlighting is globally
  disabled (unreachable for us). Also settled three census inferences: `aHr` collapses scratchpad
  paths only (we model none — recorded unreachable), the single-line thinking form is provably
  dead, and `Pt()` is a build-time `"macos"` constant, so the platform bullet switch is a
  product-level port, not a bundle-runtime one.
