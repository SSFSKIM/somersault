# Wave C — Chrome & composer ergonomics ("F7, grounded")

**Purpose.** The last wave of QA Sprint 1 (parent: `2026-08-06-qa-sprint-waves-design.md`, Stream C).
Settle the footer architecture, then fill it — the one-row-plus-right-region footer, the notification
queue, the statusLine hook, the CLI surface, the chrome truth batch (title/spinner/mode chip/duration
row), the ghost-text follow-up, the effort surfaces, the composer keys, and the live banner — all built
from the 2.1.220 bundle canon and QA-6's captured frames instead of reverse-engineered guesses.
Sibling waves T (trust & safety), R (repaint & geometry), S (session truth) are shipped.

**Canon.** `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js` (`L<n>` citations). Fixture frames:
`docs/parity/qa-findings/frames-qa6/`, `frames-qa1/`.

**Grounding evidence (durable annex, committed):** `2026-08-09-wave-c-grounding/`
— `waveC-grounding-bundle.md` (the full upstream transcription, ~397 citations; **the canon reference
for every verbatim string, timing constant and layout rule in this wave — implementers read it, not
the bundle**), `waveC-grounding-ccx.md` (current-state pins, per-finding verdicts),
`waveC-grounding-probes.md` (live SDK verdicts; probes 100/100b/100c; probe 101 — accountInfo field
inventory — added at spec-review time).

**Tracking reconciliation vs the umbrella** (spec-review finding #15): the qa6-14 rider (version in
the box header, `What's new`) was umbrella-assigned to "EP-C4's chrome batch" but lands here in
EP-C8, where the banner work lives; and qa6-13 appears both in umbrella §16's deferred panel-wave
bucket AND as a keep-or-drop parked to this review — this spec resolves it (remove-with-owner-
override) and §16's listing should be read as superseded.

## What the grounding round overturned (write the spec against THIS, not the QA text)

1. **Ctrl+C is both-at-once, not either/or** (qa1-04/qa6-08): upstream's first Ctrl-C on a non-empty
   draft *clears the draft AND arms exit* in the same press (`Pee` double-press primitive, 800 ms
   window, L395616/L183445). The ccx defect is only the missing clear.
2. **Esc-Esc clear is upstream canon and upstream advertises it** (qa1-05 said the opposite): first
   Esc arms and posts the ephemeral hint `Esc again to clear` (1000 ms, L395621/L395624); second Esc
   within 800 ms clears and stashes the draft. ccx's behavior is right; its *persistent* `esc clear`
   footer copy and missing armed-state feedback are the defect.
3. **Home/End and ctrl+arrows are NOT keymap bindings upstream either** — they are handled inside the
   text-input key switch (L395798, L395760). A table-only port misses them by construction. ccx's
   parser already decodes all four; they die at `editorAdapter.ts:44` / `editor.ts:394`.
4. **The follow-up suggestion is a forked full-conversation query on the session's MAIN model**
   (temperature 1, no token cap, tools sent but denied via `canUseTool`, L235208) rendered as the
   composer **placeholder** (dim, first char inverted), accepted with **Tab or Right arrow** — not a
   cheap Haiku call, not `inlineGhostText`, no Ctrl+E, and **no interrupt-triggered generation**.
5. **The SDK's declared prompt-suggestion surface is dead headlessly** (probes 100/100b: 4 sessions,
   12 turns, 0 frames, even with the CLI's own env override that bypasses every gate). ccx must
   generate its own. A warm suggester session costs ~5.0 s / ~$0.0045 per suggestion.
6. **The feature-flag adjudication lands OFF**: `tengu_chomp_inflection` defaults `false` in-code;
   there is no local flag cache to override it (the installed build resolves flags live via
   GrowthBook — the repo's statsig-cache recipe is obsolete). EP-C5 ships off by default.
7. **The spinner's token count is an animated ESTIMATE upstream** — eased `responseChars / 4`
   (L407947), not the usage field. That dissolves the probe-measured "usage arrives once per message"
   cadence problem: fidelity means estimating from streamed text length, reconciled at message end.
8. **The terminal title has a real headless source**: the engine auto-writes an `ai-title` row into
   the session JSONL during the first turn; `getSessionInfo().customTitle`/`.summary` expose it
   (probe 100, three sessions). Title = OSC 0, BEL-terminated, prefix `✳` idle / `⠂`↔`⠐` at 960 ms
   while busy (no literal `_` exists; QA saw a braille dot).
9. **statusLine failures are silent by design** (all four failure modes return `undefined`, stderr to
   debug log only, L366191); default hook timeout is **600 s**; re-runs are 300 ms-debounced off nine
   state deltas; `refreshInterval` is the only timer and absent by default. Only **user/policy**
   settings may install a statusLine (L154558) — project/local cannot.
10. **qa3-02 is already fixed** (Wave T EP-T1: one `resolvedPermissionMode(foregroundConfig)` reader
    for banner + footer). Do not re-implement. And the ccx spinner's token counter already exists
    (`spinner.ts:80-83`); QA measured it during a network-failure turn.
11. **The `Default (recommended)` picker row is SDK-authored** — ccx renders the SDK catalog's own
    strings while overriding the default with `DEFAULTS.model = claude-opus-5`. qa4-02 is a product
    decision (re-describe locally), not a rendering bug.
12. **The unknown-flag error shape is stock commander**: `error: unknown option '--x'` on stderr,
    optional `(Did you mean --y?)`, **no usage block, exit 1** (ccx today: `ccx: unknown flag`,
    exit 2).

## Two owner decisions, resolved with overridable recommendations (§11 of the umbrella parked them here)

- **`#` memory mode (qa1-10): REMOVE.** No upstream counterpart at 2.1.220 *or* 2.1.222 (the
  composer resolver returns only `prompt|bash`, L374525-37). Fidelity is the programme's stated goal;
  keeping a phantom third mode costs every future keymap/footer/hint decision a special case. Removal
  touches 7 src files + ~7 test files (inventory in `waveC-grounding-ccx.md` §qa1-10). The
  `## Memories` sections users may have accumulated in CLAUDE.md stay untouched on disk — only the
  entry affordance goes. *Owner may override to keep; nothing else in the wave depends on the choice.*
- **Inline context %% + `⚠ auto-compact soon` chip (qa6-13): REMOVE from the always-on footer; keep
  the information.** Upstream exposes context only through statusLine / slash commands / the
  `token-warning` notification. ccx keeps every consumer: `/status`, `/cost`, `/context`, the
  statusLine payload's `context_window` block, and gains upstream's token-warning notification in the
  new queue **with upstream's posting semantics, now pinned** (spec-review finding #5): post
  `{key:"token-warning", priority:"medium", timeoutMs:18000000, fold, exemptFromDiffPanelHold}`
  (L489324) whenever the warning level ≠ ok, where the level ladder (`uOu`, L163990) is: **warn**
  when used tokens ≥ (auto-compact ceiling − 20 000); **compact** at the ceiling; **blocked** at
  (window − 3 000); ceiling = window minus a 0.2 buffer fraction by default (L164111-27). Text
  (L488940): `{N}% until auto-compact` (N = percent of the ceiling remaining) in the warn zone,
  escalating to the error-colored `Context low ({N}% remaining) · Run /compact to compact & continue`
  at compact/blocked. ccx computes the ladder from `getContextUsage()`. The same applies to the
  ccx-extra `usageWarn` and `⚙ N bg` chips — `usageWarn` folds into the notification queue; `⚙ N bg`
  maps to upstream's `← for agents` slot semantics (EP-C1). *Owner may override.*

---

## EP-C1 · Footer architecture + notification queue (qa6-01, qa1-13, qa6-10) — P0, prerequisite

1. **Context.** Upstream's below-composer block is ONE flex row (`oVf`, L494667):
   `paddingLeft 2, columnGap 1`; LEFT column = optional statusLine row stacked above the footer row;
   RIGHT column = `marginLeft:"auto", alignItems:"flex-end"` carrying the ephemeral-notification slot
   and persistent chips. ccx today paints up to eleven independent left-aligned rows across two
   components (`ChatComposer.tsx:936-973`, `ChatApp.tsx:758-764`) with no right-aligned primitive —
   the comment at `ChatComposer.tsx:961-964` already assigns this fix to F7.
2. **Decisions.**
   - `[DECIDED-AUTO]` Build the **notification queue first** — it is the shared primitive that hosts
     qa1-13's transient hints, qa6-02's effort hint, EP-C7's `Esc again to clear`, and the token/usage
     warnings. Semantics transcribed from `Ds()` (L393965): one `current` + queue + `pinned`;
     priorities `immediate:0 > high:1 > medium:2 > low:3`; default `timeoutMs` 8000; `immediate`
     preempts synchronously; `fold` merges same-key; `invalidates` drops keys; renderer = single-line,
     `wrap:"truncate"`, dim when no color (`$Rr`, L488834).
   - `[DECIDED-AUTO]` **Notification placement matches the live build, not the non-`ds()` fallback**:
     the ephemeral-notification slot renders as an absolutely-positioned one-row overlay ABOVE the
     composer's top rule, flush right (`position:"absolute", marginTop:-1`, L496241 — this is where
     QA-6 photographed `● high · /effort`). The footer row's right region (`marginLeft:"auto"`,
     L494681) carries only the persistent chips. A plan that puts ephemeral hints in the footer-row
     right column fails the A1 fixtures.
   - `[DECIDED-AUTO]` Footer row contract (`Wci`/`ctl`): four early-return states (exit-armed ·
     pasting · paste-expand-hint · bash-mode `! for shell mode`) **replace the whole row** — and the
     statusLine row hides with the exit-arm state (L494626). Otherwise:
     `mode chip · [hint list]` where the hint list truncates (never wraps) and joins with `" · "`
     (space-middot-space, dim).
   - `[DECIDED-AUTO]` Collapse rule is upstream's, literally: `suppressHint = draft.length > 0 ||
     isSearching || statusLineConfigured` kills the hint list; `!isInputEmpty` additionally kills the
     agents affordance; **the mode chip always survives** (L496241, L494599).
   - `[DECIDED-AUTO]` ccx's `⚙ N bg` chip becomes the upstream-shaped agents affordance in the hint
     list position (`← for agents` / `← N agents` / `← N done`, count colors warning/success, 2500 ms
     flash — L493228) wired to ccx's background pane; the raw `⚙ N bg` chip retires with the old bar.
   - `[DECIDED-AUTO]` `? for shortcuts` obeys upstream's crowd-out rule (L494091): present only when
     no other hint, mode is home-state, and nothing else competes.
   - Per the owner-decision section above: `ctx N%`, `⚠ auto-compact soon`, `usageWarn` leave the
     always-on row; token/usage warnings re-enter as queued notifications.
3. **Current state.** DIVERGENT (shape) + ABSENT (queue, right region) + PARTIAL (collapse trims two
   suffixes only). Full pins in `waveC-grounding-ccx.md` §EP-C1.
4. **Work items.** (new) `notifications.ts` queue + the right-aligned overlay slot component;
   (rewrite) the below-composer block into the one-row two-region layout; (migrate) the nine
   hand-rolled transient rows **by destination, matching upstream's placement**: queue notifications
   (`esc again to clear`, `Ctrl+Y to paste deleted text`, `(ctrl+r to search history)` → upstream has
   no such hint — retire it or queue it, implementer picks queue) · footer early-return states
   (pasting, paste-expand, bash-mode `! for shell mode`, Ctrl-C/Ctrl-D exit arms) · in-row elements
   (the history-search box renders ON the footer row, `gap:1`); (modify) draft-signal plumbing so the
   footer owner sees `suppressHint`; (delete) `ChatStatusBar` entirely — `model`, `think`, and the
   `⟳ streaming` chips all leave the footer (upstream's footer has none of them): model identity
   lives in the banner, `/status` and the statusLine payload; thinking state lives in `/status`, the
   statusLine payload's `thinking.enabled`, and the thinking-toggle notifications; streaming state is
   what the spinner is for.
5. **Acceptance.** Footer geometry matches `frames-qa6/cc-idle.txt` on the fixture terminal size
   (one row, left segments dim-grey, right region flush-right on the row above the composer rule);
   composer block height does not change while typing (hints suppress, chip survives, no row count
   change); each early-return state replaces the row in place.

## EP-C2 · statusLine hook (qa6-03) — P1, largest single item

1. **Context.** Zero statusLine code exists in ccx. The full upstream contract is transcribed in
   `waveC-grounding-bundle.md` §EP-C2: settings schema (`type:"command"`, `command`, `padding`,
   `refreshInterval`, `hideVimModeIndicator`), the 19-field stdin payload built by `H0b` (L484846),
   execution `B8s` (L366191), cadence `b0b` (L484860), render slot + coloring + truncation (L484935+).
2. **Decisions.**
   - `[DECIDED-AUTO]` **User-level settings only** may install a statusLine, matching L154558
     (project/local sources refused). ccx reads it from its own settings loader (a new read path —
     ccx currently never reads settings for UI), key `statusLine`, same shape.
   - `[DECIDED-AUTO]` Payload: every field ccx can honestly populate, omitting conditional fields it
     cannot (the builder's own `...x && {}` pattern): `session_id`, `cwd`, `session_name` (custom ??
     ai-title via `getSessionInfo`), `model {id, display_name}`, `workspace {current_dir,
     project_dir, added_dirs}`, `version` (ccx's own), `output_style`, `cost` (ccx's usage fold),
     `context_window` (from `getContextUsage()`, `current_usage: null` before the first turn),
     `exceeds_200k_tokens`, `effort {level}`, `thinking {enabled}`. Omitted with a spec note:
     `transcript_path`/`prompt_id` (SDK-internal), `rate_limits` (credential-scope gap, qa5-12),
     `vim` (no vim mode), `fast_mode`, `agent`, `remote`, `pr`, `worktree` (no ccx counterpart yet).
   - `[DECIDED-AUTO]` Cadence: one undebounced run on mount; 300 ms-debounced re-runs on the ccx
     equivalents of upstream's nine deltas (turn end / usage update / mode / model / effort /
     thinking / statusLine-command change); optional `refreshInterval` (seconds, min 1) poll; each
     run aborts the previous.
   - `[DECIDED-AUTO]` Failures are **silent** (undefined result leaves the previous text in place;
     stderr to ccx's debug channel only). Timeout 600 s default. stdout normalization: trim, split,
     per-line trim, drop blanks, rejoin.
   - `[DECIDED-AUTO]` Render: own row above the footer row (slot Box `gap:2`), `paddingX = padding
     ?? 0`, per-line `wrap:"truncate"`, script ANSI preserved **with dim forced onto every span**,
     SGR carry-forward across lines (the `m3f` rule); shown only under the FULL upstream guard
     (L494626): prompt mode only (hidden in bash mode), not exit-armed, not pasting, pane ≥ 15 rows,
     statusLine configured. A configured statusLine sets `suppressHint` (EP-C1's flag) —
     `? for shortcuts` disappears.
3. **Current state.** ABSENT entirely.
4. **Work items.** (new) settings read path; (new) payload builder; (new) debounced runner with
   abort + timeout; (new) render row wired into EP-C1's left column; (new) `CLAUDE_PROJECT_DIR`,
   `COLUMNS`, `LINES` in the child env.
5. **Acceptance.** A configured command receives the documented JSON on stdin and renders dim in the
   slot with upstream truncation; a failing/slow command changes nothing on screen; the
   `? for shortcuts` segment is absent while configured; re-runs observed on mode/model changes
   (keyless-observable deltas) and none while idle without `refreshInterval`; the turn-end re-run
   rides the keyed A6 live turn rather than A3.

## EP-C3 · CLI surface (qa6-12) — P1

1. **Context.** ccx: `--version`/`--help` throw `ccx: unknown flag …` exit 2 (`args.ts:145`,
   drifted from the triage's `:133`); no doctor. Upstream shapes transcribed in bundle §EP-C3.
2. **Decisions.** `[DECIDED-AUTO]` Mirror upstream's shapes with ccx's identity: `ccx --version` →
   `0.1.0 (cc-harness)` reading `package.json` (single line, exit 0); `ccx --help` → commander-shaped
   `Usage: ccx [options] [command] [prompt]` + description + sorted Options + Commands (the real
   subcommand registry: `agents attach stop rm serve fleet`); unknown flag → stderr
   `error: unknown option '--x'`, and the `(Did you mean --y?)` tail only for `--`-prefixed tokens
   passing commander's strict similarity gate `(maxLen − distance) / maxLen > 0.4` (L391971,
   L392704 — verbatim rule so the test pins the right boundary), **exit 1** (a deliberate exit-code
   change from 2 → 1, matching upstream; `KNOWN_UNSUPPORTED` flags keep their distinct refusal);
   `ccx doctor` → identity block (version, commit if known, platform, invoked path, node version,
   SDK version) + `No installation issues found.`, exit 0 unconditionally.
3. **Current state.** ABSENT; clean insertion points pinned (`args.ts:97` switch, `main.ts:107`).
4. **Work items.** (new) pre-parse intercepts for `--version`/`-v`/`--help`/`-h`; (new) help
   printer; (new) `doctor` subcommand; (modify) unknown-flag error shape + suggestion + exit code
   (update the tests that pin exit 2).
5. **Acceptance.** All four verbatim shapes; `ccx --typo'd-flag` names the token and suggests the
   near-miss; exit codes 0/0/1/0 respectively.

## EP-C4 · Chrome truth batch (qa6-04 title, qa6-06 spinner, qa6-09 mode chip, qa2-13 duration row) — P1

1. **Context.** Bundle §EP-C4 carries the full transcriptions. ccx pins: title ABSENT (and no turn
   summary existed until probe 100 found the engine's ai-title); spinner PARTIAL; mode chip PARTIAL
   (order + suppression already right); duration row ABSENT.
2. **Decisions.**
   - **Title** `[DECIDED-AUTO]`: emit OSC 0 BEL (`\x1b]0;<prefix> <title>\x07`), prefix `✳` idle,
     `⠂`/`⠐` alternating 960 ms while busy; title = rename title ?? engine ai-title (fetched via
     `getSessionInfo()` after the first turn completes) ?? `--name` ?? literal fallback; honored
     kill switch `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`; cleared to empty (`\x1b]0;\x07`) on exit;
     title persists after turn end (only the prefix reverts). Direct stdout write, bypassing Ink.
     Two canon details recorded as **deliberate skips**: the `terminalTitleFromRename` setting (ccx's
     rename always wins over the ai-title, unconditionally) and the kitty ST-terminator OSC variant
     (BEL everywhere).
   - **Spinner** `[DECIDED-AUTO]`: token count becomes upstream's animated estimate — eased
     `streamedChars / 4` — reconciled to the real usage figure when each message's `message_delta`
     lands (this supersedes the per-message step counter; probe (c) proved real usage arrives only
     once per message); prefix arrow `↓` (tool/responding/thinking) / `↑` (requesting); phase word
     ladder `thinking → still thinking (10s) → thinking more (20s) → thinking some more (30s) →
     almost done thinking (45s)`, `running tool for Ns`, `thought for Ns`; gerund re-picked between
     phases (upstream's `resetOverrides` semantics) instead of fixed per turn; elapsed formatter
     ported whole — upstream's `ra`/`formatDuration` (L107033), the **spaced, unpadded** `1m 5s` /
     `1h 2m 3s` form the spinner actually calls at `C0p` L407947 (corrected 2026-08-10 in the Task 6
     review: this line originally said the `1m05s` no-space form, which is `$st`/`formatBarElapsed`
     — a real upstream function, but one belonging to the agent and session rows, not this tail; the
     claim came from a stale pre-Wave-C `spinner.ts` header comment that the grounding repeated);
     width-adaptive visibility gates (elapsed → tokens → phase in upstream's
     precedence, 16 s quiet threshold).
   - **Mode chip** `[DECIDED-AUTO]`: adopt the six-mode table verbatim (L41556) — glyph `⏸` for
     default/plan, `⏵⏵` for acceptEdits/auto/bypassPermissions/dontAsk; text
     `{symbol} {indicator} on` (`⏸ manual mode on`, `⏵⏵ accept edits on`, …); colors
     inactive/planMode/autoAccept/error/error/warning; `(shift+tab to cycle)` parenthetical spelled
     lowercase via the chord formatter, suppressed on home state (rule already shipped).
   - **Duration row** `[DECIDED-AUTO]`: `✻ {Verb} for {duration}`, all dim, glyph in a minWidth-2
     box, verb uniform-random from the 8-entry past-tense list (L428307), setting `showTurnDuration`
     default true; renders as a transcript row when a turn completes (not while interrupted).
3. **Current state.** Per pins above.
4. **Work items.** (new) `terminalTitle.ts` + wiring at turn start/end + ai-title fetch; (modify)
   `spinner.ts`/`TurnSpinner.tsx` (estimate, arrow, phase, rotation, formatter); (modify) status-bar
   chip → EP-C1's footer chip using the mode table; (new) duration transcript row.
5. **Acceptance.** Per-item against `frames-qa6`/`frames-qa2` fixtures: title escape observed in a
   pty (script capture) with prefix alternation; spinner parenthetical materializes progressively
   (`✶ Baking…` → `(1s · thinking)` → `(2s · ↓ 84 tokens · thinking)`); all six mode chips verbatim;
   `✻ Worked for 4s` closes a live turn and `showTurnDuration:false` removes it.

## EP-C5 · Ghost-text follow-up suggestion (qa6-07, qa1-06) — P1, off by default

1. **Context.** Overturns 4-6 above. Upstream contract in bundle §EP-C5: trigger fire-and-forget at
   turn end; eligibility chain (≥2 assistant messages, last result not error, cache warm, enabled,
   no pending permission, not plan mode); the 44-line SUGGESTION-MODE prompt (verbatim in the annex);
   twelve-rule post-filter; four-state machine (`empty → generated → shown → accepted`); renders as
   the composer placeholder (dim, first char inverted when focused); accept = Tab or Right arrow on
   an empty buffer; abort on every keystroke; survives Ctrl-C; reset on submit.
2. **Decisions.**
   - `[DECIDED-AUTO]` **Off by default** (overturn 6 + ~$0.0045/turn + ~5 s latency). Setting key
     `promptSuggestionEnabled`, written explicitly (not absent-means-on, deliberately diverging from
     upstream's polarity because our default differs); `/config` gains the boolean row
     `Prompt suggestions` (the row model + prefs plumbing already exist — 4 wiring points).
   - `[DECIDED-AUTO]` Generator = **one warm suggester engine session** (probe 100c: ~5.0 s,
     ~$0.0045/suggestion, no cost creep over consecutive requests), fed the transcript tail + the
     verbatim upstream prompt, async and cancellable — the composer never blocks, a keystroke aborts,
     a suggestion landing after the user started typing is dropped (`timing` reset). Haiku-class
     model for the suggester (deliberate divergence from upstream's main-model fork, recorded: the
     fork-with-cache-piggyback that makes main-model affordable upstream does not exist headlessly;
     probe-measured quality at haiku was acceptable).
   - `[DECIDED-AUTO]` Port the post-filter and state machine as data (twelve rules, four states,
     transitions per the annex table); accept keys Tab/Right gated on empty buffer + no completion
     popup; placeholder render reuses the existing `PlaceholderCursor` path. The eligibility chain
     ports WITHOUT the `cache_cold` rule — its rationale (the fork piggybacks on the main thread's
     prompt cache) does not exist for the divergent warm suggester (spec-review finding #7).
   - `[DECIDED-AUTO]` **Suggester lifecycle** (spec-review finding #6): spawned lazily on the first
     eligible turn-end with the setting on — never at REPL boot; ONE suggester per REPL session,
     reused across turns (probe 100c: no cost creep over consecutive requests); any conversation
     replacement (`/clear`, `/resume`, rewind — the `replaceDocument` boundary, the wave-S principle)
     aborts any in-flight generation, discards the pending suggestion, and RETIRES the suggester —
     the next eligible turn spawns a fresh one so no stale cross-conversation context leaks into
     suggestions; torn down on REPL exit. Its ~$0.0045/turn is NOT folded into `/cost` (which reads
     the main engine's usage) — matching upstream, whose fork is likewise invisible
     (`skipTranscript`); recorded as an accepted accounting gap.
   - `[DECIDED-AUTO]` The fresh-session `Try "<template>"` static placeholder is also gated on
     `promptSuggestionEnabled` (upstream L1542 rule) — with the setting off-by-default this changes
     the first-run look; acceptable, recorded.
3. **Current state.** Renderer BUILT (placeholder + ghost machinery), content ABSENT, SDK channel
   probe-dead, settings row ABSENT (4 wiring points exist).
4. **Work items.** (new) `suggester.ts` warm-session generator + abort plumbing; (new) suggestion
   state slice + transitions; (modify) placeholder ladder to give the suggestion top precedence;
   (modify) Tab/Right accept in the composer; (new) `/config` row + prefs field.
5. **Acceptance.** With the setting on and a keyed live run: after an eligible turn the composer
   placeholder becomes a dim ≤12-word suggestion accepted by Tab and by Right, dismissed by typing,
   surviving Ctrl-C, absent after an error turn and in plan mode; with the setting off (default):
   no generation call is ever made (assert zero suggester traffic).

## EP-C6 · Effort surfaces (qa4-01, qa6-02) — P1

1. **Context.** Bundle §EP-C6. ccx: `--effort` launch-only; `/effort` actively redirected to
   `/think` by `CLIENT_SIDE_NOTES` (`commands.ts:264`); no picker row, no chip, no hint. SDK runtime
   effort setters are live-verified (turn-controls probes, Wave 1/4 evidence).
2. **Decisions.**
   - `[DECIDED-AUTO]` `/model` picker gains the effort row between list and footer:
     `{glyph} {Level} effort[ (default)]  ←/→ to adjust` (xhigh renders `xHigh`; glyphs
     ○ ◐ ● ◉ ◈, color `claude` when set, `subtle` unsupported; unsupported branch
     `● Effort not supported for <model>`); max shows the verbatim caveat line. ←/→ step through
     supported levels, selection applies with the model choice.
   - `[DECIDED-AUTO]` `/effort` becomes real: the standalone dialog (`←/→ to adjust · Enter to
     confirm · Esc to cancel`) calling the SDK runtime setter; the `CLIENT_SIDE_NOTES` redirect is
     deleted. The `think` state is a different knob and keeps its own `/think` command; its footer
     chip is gone with `ChatStatusBar` (EP-C1) — thinking visibility lives in `/status`, the
     statusLine payload, and the thinking-toggle notifications.
   - `[DECIDED-AUTO]` The ephemeral hint `● high · /effort` (glyph per level, raw lowercase level,
     10 000 ms) posts to EP-C1's queue with `key:"effort-level", priority:"high"` at session start
     and re-posts (restarting the clock) on every effort change; absent when the model does not
     support effort.
3. **Current state.** PARTIAL (launch-only).
4. **Work items.** (new) effort row in `ModelPicker` + `modelPickerModel`; (new) `/effort` dialog;
   (modify) delete the redirect note; (new) runtime setter call + state; (new) hint post.
5. **Acceptance.** Effort adjustable from the picker and `/effort`, verified live via a follow-up
   `/status`-visible state change; the hint appears at launch and decays at ~10 s
   (`frames-qa6/cc-idle` shows the slot); unsupported-model branch renders when the catalog says so.

## EP-C7 · Composer keys & draft semantics (qa1-01..05, qa6-08, qa6-10-esc, +qa4-12) — P0

1. **Context.** Overturns 1-3. ccx pins in `waveC-grounding-ccx.md` §EP-C7 (four independent arm
   hints with four windows; `app:interrupt` has no draft channel; word ops exist unwired).
2. **Decisions.**
   - `[DECIDED-AUTO]` Adopt the `Pee` double-press primitive (800 ms default) as ONE shared helper;
     migrate Ctrl-C exit-arm (2000 ms → 800 ms), Ctrl-D, Esc-clear onto it.
   - `[DECIDED-AUTO]` Ctrl-C first press: clear draft + cursor to 0 + reset history nav, AND arm
     exit with the footer-replacing `Press Ctrl-C again to exit` (hyphenated spelling is canon) for
     800 ms. Requires a clear channel from the app handler into the composer (the grounding names
     `clearInput` as the reachable reducer).
   - `[DECIDED-AUTO]` Esc: keep the double-press clear (it was always canon), but the armed state
     posts `Esc again to clear` (1000 ms) to the notification queue, and the **persistent `esc
     clear` footer copy is deleted** (the lie qa4-12 paid for). Second Esc stashes the draft to
     history before clearing (already shipped). Lone-Esc CSI disambiguation stays at ccx's parser
     value; upstream's 50 ms is recorded as reference.
   - `[DECIDED-AUTO]` Home/End → visual line start/end; ctrl+←/→ (and fn-modified) → word motion —
     both wired at the ccx equivalent of the input layer (`editorAdapter` NAMED table + a ctrl-arrow
     arm), NOT the keymap table, matching upstream's architecture (overturn 3).
   - `[DECIDED-AUTO]` `wordRight` lands at the **start of the next word** (upstream `nextWord`,
     L394936). Blast radius accepted and tested: `deleteWordAfter` (alt+d) and every alt+f/alt+right
     position test moves with it.
3. **Current state.** DIVERGENT ×3, ABSENT ×2 (all pinned).
4. **Work items.** (new) `doublePress.ts`; (modify) `ChatApp` interrupt handler + composer clear
   channel; (modify) `editorAdapter`/`editor` for home/end/ctrl-arrows/word boundary; (modify)
   footer copy per EP-C1; (delete) the four hand-rolled arm implementations — including the
   ccx-only `Press Esc again to rewind` arm (`ChatApp.tsx:759`), which keeps its semantics and
   1500 ms window (no upstream grounding exists for it) but migrates onto the shared `doublePress`
   helper with its hint posted to the queue instead of rendering as its own row.
5. **Acceptance.** The QA-1 repro sequences replay correctly under the pty driver: Ctrl-C on a
   draft clears it and flashes the arm ≤ 800 ms; Esc-Esc clears with the 1000 ms hint visible after
   the first Esc; Home/End/ctrl+arrows move as upstream; alt+f lands at next-word-start.

## EP-C8 · Live banner & picker state (qa4-02, qa6-14; qa3-02 CLOSED) — P1

1. **Context.** qa3-02 shipped with Wave T — out of scope. The remaining defects: the banner prints
   the *unresolved* model (`(default)`) while the footer prints the resolved one (cause: one raw
   expression at `main.ts:339/372` vs `:377` — cite repinned in v3); no version in the box header;
   no auth-provider line;
   the SDK-authored `Default (recommended)` row describes the SDK's default (Sonnet) while ccx's
   `DEFAULTS.model` is claude-opus-5.
2. **Decisions.**
   - `[DECIDED-AUTO]` Banner box header becomes upstream's shape: border text
     ` Claude Code v<ccx version> ` → for ccx: ` ccx v0.1.0 ` (claude-color name + inactive
     version, offset 3; compact <70 cols drops the version) — ccx keeps its own product name; we do
     not impersonate the upstream binary in identity strings (F0 honesty rule).
   - `[DECIDED-AUTO]` The model/auth line: `<model display name>[ with <Effort> effort] ·
     <billing label>`. **Probe 101 (run at spec-review time) settled what `accountInfo()` actually
     delivers headlessly: exactly two fields — `apiProvider` ("firstParty") and `tokenSource`
     ("CLAUDE_CODE_OAUTH_TOKEN") — no `subscriptionType`, despite its declaration in sdk.d.ts.** So
     upstream's tier labels (`Claude Max` / `Claude Pro`) are unreachable; ccx's honest mapping:
     `tokenSource === "CLAUDE_CODE_OAUTH_TOKEN"` → `Claude subscription`; API-key auth → upstream's
     `API Usage Billing`; non-firstParty providers → upstream's provider name set (`Amazon Bedrock`,
     `Google Vertex AI`, …); anything unknown → omit the label rather than guess. Recorded
     divergence: tier granularity lost headlessly. Banner is handed the RESOLVED model (display name
     via the session catalog when available, else the resolved id) — the one-expression fix.
   - `[DECIDED-AUTO]` The banner stays a `<Static>` seed (re-architecture refused: Ink Static is
     append-only and the banner scrolls away in upstream too). Recorded divergence: after a
     mid-session `/model` change the seeded banner is stale scrollback; the footer, `/status` and
     the picker are the live surfaces and must agree (Wave T's shared-reader pattern extends to
     model + effort).
   - `[DECIDED-AUTO]` The `Default (recommended)` row: keep the SDK row but **rewrite its
     description locally** to name what selecting it actually does in ccx —
     `Use the default model (currently <resolved DEFAULTS.model display name>)` — so the row stops
     describing a default ccx overrides. Selecting it clears the explicit model (value null
     semantics preserved).
   - `[DECIDED-AUTO]` qa6-14's `What's new` block: SKIPPED — ccx has no changelog feed; a fabricated
     one violates honesty. Recorded as a deliberate gap (the version header + auth line are the
     qa6-14 deliverables).
3. **Current state.** Pinned per grounding; banner liveness ABSENT-by-construction (accepted).
4. **Work items.** (modify) `banner.ts` header/model/auth lines + resolved-model handoff in
   `main.ts`; (modify) `modelPickerModel` default-row description; (tests) banner/picker/footer
   agreement at launch.
5. **Acceptance.** At launch, banner · `/status` · `/model` picker name the same resolved model
   (the footer carries no model chip after EP-C1 — v3 amendment) and the auth line shows the
   correct billing label under the OAuth token; the default row's description names ccx's actual
   default.

---

## Priority & dependencies

- P0: EP-C1 (prerequisite — merged before C2/C4/C6/C8 stack on it), EP-C7.
- All epics after C1 parallelize per SDD except: EP-C2, EP-C4(chip), EP-C6(hint), EP-C8 consume
  C1's queue/footer contracts. **EP-C7 splits along the same line** (spec-review finding #2): the
  editor/key-motion items (Home/End, ctrl-arrows, word boundary, the `doublePress` helper itself)
  are independent and may run before or parallel to C1; the arm/hint RENDERING items (the
  footer-replacing exit-arm state, `Esc again to clear` on the queue, deleting the persistent
  `esc clear` copy) are gated on C1's queue + footer contract. EP-C2's split-out pre-authorization
  (umbrella §14) is NOT exercised — it stays here.
- EP-C5 is the only keyed-live-heavy epic; its default-off state keeps every other epic's tests
  keyless.

## Acceptance grid (executed at wave close, cells run as written)

| cell | check | how |
|---|---|---|
| A1 | Footer one-row geometry + right region vs `cc-idle` fixtures | pty frames, keyless |
| A2 | Typing collapse: hints out, chip stays, height constant | pty, keyless |
| A3 | statusLine: payload JSON + silent failure + suppressed shortcuts hint | pty + scratch script, keyless |
| A4 | `--version` / `--help` / unknown-flag / `doctor` shapes + exit codes | subprocess, keyless |
| A5 | Terminal title: OSC 0 emitted, prefix alternates, cleared on exit | pty raw capture, keyed (ai-title) |
| A6 | Spinner: progressive parenthetical, estimate motion, phase ladder | keyed live turn |
| A7 | Mode chip: all six verbatim renders + cycle + home-state suppression | unit + pty, keyless |
| A8 | Duration row `✻ <Verb> for <t>` + setting off removes it | keyed live turn |
| A9 | Suggestion: on → generated/shown/accepted/dismissed paths; off → zero traffic | keyed live + unit |
| A10 | Effort: picker row stepping, `/effort` dialog, 10 s hint decay | pty keyed |
| A11 | Ctrl-C clear+arm, Esc-Esc + hint, Home/End, ctrl+arrows, word boundary | pty keyless |
| A12 | Banner//status/picker model agreement + `Claude subscription` billing label (probe-101 mapping) | keyed (accountInfo) |
| A13 | `#` memory mode removed: composer, hints, help grid, tests updated — *contingent on D-C2 standing; owner override voids the cell* | unit, keyless |
| A14 | ctx%% chip removed; token-warning posts at (ceiling − 20k) with `{N}% until auto-compact` — *contingent on D-C3 standing* | unit + pty |
| A15 | Full suite green (`npm run typecheck`, `test:unit`, `test:tui`, build) | keyless |

## Decision Log

- D-C1 `[DECIDED-AUTO]` Notification queue built first as the wave's shared primitive (hosts
  qa1-13/qa6-02/EP-C7 hints/token warnings). Alternative — per-surface hand-rolled timers (the ccx
  status quo, 4 copies) — rejected: it is the cause of the stacked-row divergence.
- D-C2 `[RECOMMENDED, owner-overridable]` Remove `#` memory mode (fidelity canon; phantom mode taxes
  every chrome decision). Alternative — keep as ccx-extra — rejected absent owner override.
- D-C3 `[RECOMMENDED, owner-overridable]` Remove inline ctx%%/auto-compact/usageWarn/bg chips from
  the always-on footer; carry via statusLine payload, slash commands, and queued notifications.
  Alternative — keep as ccx-extras — rejected: the footer IS the fidelity surface under test.
- D-C4 `[DECIDED-AUTO]` EP-C5 ships **off by default** with an explicit setting key (in-code gate
  default false + $0.0045/5 s per suggestion). Alternative — match upstream's absent-means-on —
  rejected: our default differs, silent polarity would mislead.
- D-C5 `[DECIDED-AUTO]` Suggester runs on a warm Haiku-class session, not the main model.
  Upstream's main-model fork is affordable only via cache piggyback that headless lacks (probe 100c
  cost table). Deliberate, recorded divergence.
- D-C6 `[DECIDED-AUTO]` Spinner token count = eased chars/4 estimate reconciled per message
  (upstream's own mechanism), superseding the real-usage step counter.
- D-C7 `[DECIDED-AUTO]` Unknown-flag exit code changes 2 → 1 to match upstream; tests repinned.
- D-C8 `[DECIDED-AUTO]` Banner remains a Static seed; post-change staleness is a recorded
  divergence. Alternative — lift the banner out of `<Static>` — rejected: Ink re-render of
  scrollback is the exact class of fight Wave R settled against.
- D-C9 `[DECIDED-AUTO]` ccx keeps its own identity strings (`ccx v0.1.0`, `(cc-harness)`) in
  version/banner surfaces — shape fidelity, not impersonation.
- D-C10 `[DECIDED-AUTO]` `What's new` feed skipped (no changelog source; fabricating one violates
  honesty). Version header + auth line satisfy qa6-14's substance.

## Surprises & Discoveries *(living — seeded from grounding)*

- The twelve overturns listed at the top; the corrections table in the annex is the full record.
- **A thirteenth, found by the spec review itself**: `accountInfo()` headlessly returns ONLY
  `{apiProvider, tokenSource}` — `subscriptionType` is declared in sdk.d.ts but never arrives
  (probe 101). The reviewer flagged the spec's own citation of probe 28 as overreach; the fresh
  probe proved the overreach real. Declared ≠ reachable applies to spec REVIEWS too.
- The installed CLI (2.1.226) resolves feature flags via GrowthBook at runtime — no on-disk flag
  cache exists anymore; the repo's statsig-cache grounding recipe is obsolete.
- The engine auto-titles every session headlessly (`ai-title` JSONL row, first turn, disk-read via
  `getSessionInfo`) — found while probing the terminal title, useful far beyond it.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v4 2026-08-10 — Task 6 review: upstream's spinner elapsed is `ra`/formatDuration (`1m 5s` spaced),
  not `$st` (`1m05s`); the no-space claim traced to a stale pre-Wave-C ccx comment that the grounding
  repeated. EP-C4's duration row uses the same `ra`.
- v1 2026-08-09 — authored from the three-worker grounding round (D9 pattern), born landed.
- v3 2026-08-09 — plan-review fallout (opus plan reviewer, 4 Critical + 14 Important + 13 Minor
  against the PLAN; three touched the spec): A12's third agreement surface repointed from the
  footer to `/status` (EP-C1 removes the footer's model chip — the spec's own decision, missed in
  its own acceptance cell); the `main.ts:338` cite repinned to `:339`; and NEW probe 102 settled
  EP-C6's mechanism — the SDK has no `setEffort`; the runtime hook is
  `Query.applyFlagSettings({effortLevel})`, live-verified mid-session, WITH NO VALIDATION (bogus
  values resolve silently — ccx validates client-side). Probe 102's v1 harness bug is its own
  lesson: an exhausted streaming-input generator closes the transport's write side, making every
  control call throw — `setModel` "failed" identically, which exposed the probe rather than the
  setter.
- v2 2026-08-09 — spec-review round (fable reviewer, 6 Important + 9 Minor, 0 Critical; all
  adopted): notification placement corrected to the overlay row (the live build's `ds()` branch);
  EP-C7 dependency line split editor-vs-rendering; `think`/`⟳ streaming` chips explicitly
  dispositioned; billing label re-grounded by NEW probe 101 (accountInfo delivers only
  apiProvider+tokenSource headlessly — tier labels unreachable, honest mapping specified);
  token-warning posting semantics transcribed from L163990/L488940/L489324 (warn at ceiling−20k,
  ceiling = window×0.8 default); suggester lifecycle pinned (lazy spawn, retire at the
  replaceDocument boundary, no /cost folding); `cache_cold` gate dropped; migration items split by
  destination; statusLine render guard cited whole; A3 made honestly keyless; Esc-rewind arm given
  migrated semantics; commander suggestion rule quoted verbatim; title setting + kitty variant
  recorded as skips; A13/A14 marked contingent on the owner-overridable decisions; umbrella
  tracking reconciled (qa6-14 rider → EP-C8; qa6-13 double-listing superseded).
