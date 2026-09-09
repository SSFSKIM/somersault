# Lane C — composer and input

**Date:** 2026-09-10 (first pass 2026-09-09; resumed and completed). **Canon:** Claude Code
2.1.263 (`~/claude-code-bundle/2.1.263/SPEC/`, `cli.pretty.js`). **64 cards, C-01…C-64.**

**SPEC read (by section, not skimmed):** 42.4 (the 26 contexts), 42.5–42.6 (action catalogue and
the whole default binding table), 42.7 (`keybindings.json`: location, gating, hot reload, schema,
`command:` bindings, merge order, load paths), 42.8 (validation and every warning string,
including the reserved tables), 42.9 (the `keybindings-help` skill), 42.10–42.11 (dispatch and
context activation), 42.12 (editor buffer, control-key map, named keys, kill ring,
left-arrow guard, undo), 42.13 (vim), 42.14 + 42.14.1–2 (multi-line, the Apple Terminal probe,
`/terminal-setup`), 42.15.1–8 (paste), 42.16.1–4 (`!` `@` `#` `/`), 42.17.1–8 (autocomplete
engine: dispatch, mid-line `/`, ghost text, the unified `@` provider, what the provider hands the
menu, accept semantics, Tab's duties, async), 42.18.1–7 (file suggestions and the index),
42.19.1–4 (history and `ctrl+r`), 42.20.1–6 including 42.20.4a (submit, queue, drain, mid-turn
absorption, `chat:queueSubmit`, `/btw`), 42.21.1–2 and 42.21.4–12 (the interrupt ladder; 42.21.3,
the message selector, is lane F's), 42.22.1–7 (`Shift+Tab`), 42.23.1–3, 42.24.1–7. Also
SPEC 41.15.8 (autocomplete menu rendering), 41.16.4 (input box border), 41.24.5 (paste feedback),
41.25 (`/terminal-setup`, cross-read), and 28-slash-commands §21.1–21.6 (slash autocomplete
trigger, both ranking paths, row rendering, argument hints and completions, inline ghost text).

**afleet read:** root spec §3, §6.6, §7.7, §7.8, §8.1, §8.5, §8.6, §8.7, §12, §13, §14
(items 8, 11, 12, 13, 35, 40, 60), §17.8; `docs/doperpowers/specs/2026-09-08-c6.2-composer.md` in
full (Design, gate audit, Decision Log, `[parent-impact]` filings, *Engine facts settled at grill
time*); every file under `App/Composer/` (`ComposerModel`, `ComposerField`, `ComposerShortcuts`,
`ComposerView`, `ComposerMount`, `CommandRouting`, `CommandCompletionView`, `CommandLinkTarget`,
`FileMentions`, `GhostText`, `QueueChip`, `QueueChipView`, `Attachments`, `RefusalSurface`,
`ShellEscape`, `EditAndRewind`, `ChannelSurfaceState`, `LateMountMetadata`, `README.md`);
`App/Header/SettingPickers.swift`, `HeaderMenus.swift`, `RestartRequiredSettings.swift`;
`App/AfleetApp.swift` (the repo's only `.commands { }`); `App/Shell/PanelKeyboardFocus.swift`;
`App/Views/SettingsView.swift`; `FleetKit/.../Router/CommandRouter.swift` and `RouterTable.swift`;
`docs/tui-parity/areas/42-input-keybindings.md` in full (including its ranked top-gaps list) and
`docs/tui-parity/README.md` §A-42.

**Clone evidence carried:** `CC-to-SDK/docs/parity/tui-ux.md` §1 and §1a (the K1–K40 ledger) and
`CC-to-SDK/docs/parity/spec-crosscheck-2026-09-03.md` — findings **X3** (Esc during a running turn
keeps the queue; the pop-to-composer is the *idle* branch), **X4** (`chat:clearInput` never cleared
the buffer at 220/251/257), **X8** (the Shift+Tab ring's availability gates), **X9**
(`popAllEditable`'s two filters), **L1** (the `prompt_suggestion` emitter gate flipped to
`!== false` by 2.1.251), **L9** (canon does *not* consume an explicit `null` binding), **L13**
(`#` is Slack completion, settled), and unknown unknowns **3** (the git-backed `@` index) and
**4** (canon drains every same-mode queued prompt as one turn).

**Denominator:** every item the task listed. **Additions found and added:** the empty-prompt hint
row (SPEC 42.16.2), which the root spec §8.1 wireframe draws and no code renders (**C-22**); the
slash-command usage-recency ranking of SPEC 28 §21.2 (**C-30**); `/focus` versus `app:toggleBrief`
as two independent states (**C-51**); `confirm:cycleMode` as a separate surface from the mode ring
(**C-50**); and the composer's complete absence of prompt history, which root spec §13 describes
as a partial feature (**C-32**).

**Verification spent** (greps of `/Users/new/claude-code-bundle/2.1.263/cli.pretty.js`): the four
queued-message hints at `:509734`/`:509736`; `Clear the input to edit this queued shell command` at
`:510253`; `paste again to expand` at `:506684`; `Esc again to clear` at `:627073` with
`timeoutMs: 1000`; `double tap esc to clear input` at `:507067`; the left-arrow constants and both
hints at `:626107`; `Ctrl+Y to paste deleted text` at `:627109`; `No background agents running` at
`:499683` and the arming hint at `:499714`; the four hint-row strings at `:507041`, `:507046`,
`:507051`, `:507056` and the bash-mode collapse at `:506740`; `No commands match` at `:501116`;
`Draft restored` at `:525423`; `search prompts:` / `no matching prompt:` at `:506365`;
`Filter history…` at `:502188`; `search history` at `:507924`; `Use ${chord} to toggle thinking`
at `:501476`; `Prompt dropped by a hook` at `:522523`;
`History search isn't available in cloud sessions yet` at `:510673`;
`No other permission modes are available in this cloud session` at `:510531`; the reserved-key and
`command:`-validation tables at `:542417`, `:542490` and `:542496`.

---

## Headline

1. **The queue is afleet's biggest single loss.** The terminal draws every queued prompt as a
   read-only user row above the input, lets the user pull one or all of them back as editable
   text, and drains **every same-mode plain prompt as one turn**, skipping over slash commands
   rather than stopping at them (SPEC 42.20.4). afleet's `QueueChipView` shows a count, a label
   and a *Cancel* button: no text, no edit, no reorder, no "these will run as one turn"
   (C-36…C-40). Edit is reachable today as cancel + re-send on the path afleet already has, which
   is exactly the decomposition `tui-parity` §42.20.3 recorded.
2. **`!` shell mode has no visible mode, and no visible run.** The terminal tints the border,
   changes the prompt glyph and collapses the hint row to `! for shell mode`; afleet reads the
   leading `!` off the *submitted* text, so the user types into an ordinary field with no signal
   that Enter will run a command on their machine (C-17). Then, for up to 120 seconds,
   **nothing is drawn at all** — `isSending` is read by no view — and the only feedback is a
   post-hoc sentence (C-18). A badge, a tint and a running strip with a Stop button is the
   cheapest high-value fix in the lane.
3. **Accept semantics are load-bearing and afleet has none of them.** Tab fills and never
   executes; Enter with nothing selected dismisses and submits the line as typed, for exactly four
   `suggestionType`s; click fills without running; `@` completes the longest common prefix first,
   so **a single match needs two Tabs**; file and title menus deliberately start with nothing
   selected (SPEC 42.17.6). Both of afleet's completion lists are **mouse-only** — no selection,
   no arrow keys — Tab is spent entirely on ghost text, and Enter on `/mod` sends the literal text
   (C-24, C-27).
4. **`~/.claude/keybindings.json` should be honoured, and the honouring model is a
   context → focus-region map plus a menu-bar projection, not a chord table** (C-54…C-61). Nine of
   the 26 contexts have a real afleet region; `Global` chords become menu items with visible
   equivalents; a native app can bind `ctrl+i`, `ctrl+m`, `ctrl+[`, `ctrl+h` and `capslock` that
   the terminal had to reserve `[exceeds]`. **But afleet's own §7.8 never-write rule forbids an
   editor**: the file is under the config home, so afleet can read, validate and explain it and
   cannot change it. That conflict needs the owner.
5. **Prompt history does not exist in afleet at all** — no Up/Down, no `ctrl+r`, no reader, no
   writer; `↑`/`↓` appear in the quick switcher and the browser panel and **zero times in
   `App/Composer/`**. Root spec §13 describes a partial feature (*"read for seeding the composer
   history only"*) that no code implements. Reading `history.jsonl` is unblocked and cheap (C-32,
   C-34); **writing it is blocked by the same §7.8 rule**, and without the write the two apps stop
   sharing one history (C-33).
6. **Nothing in the composer teaches the composer.** There is no placeholder text, no hint row,
   no argument hint, no provenance on a command row, no bolded match span, and a large paste
   becomes a 4000-line draft. The terminal's four dim strings — `! for shell mode`,
   `@ for file paths`, `/ for commands`, `/btw for side question` — are drawn in the root spec's
   own §8.1 wireframe and built nowhere (C-22), and the paste chip that should replace
   `[Pasted text #N]` is undesigned (C-11).
7. **Two families should be translated, not ported, and one setting should be disclosed rather
   than implemented.** The double-press ladder exists because a terminal has one key and no
   buttons: in a GUI it becomes a button plus Undo, and only two rungs must survive —
   `chat:killAgents`'s *content* (`interrupt {cancel_queued: true}` plus one `stop_task` per live
   id, which afleet already has as *Stop everything*) and the exit-versus-detach wording, which is
   afleet's background-channel case (C-42, C-43, C-45). And `editorMode: "vim"` can arrive from a
   project or policy file without the user asking, while afleet's Esc unconditionally interrupts
   the turn — so read the setting and say so once, rather than shipping a divergent vim (C-06).

---

## 1 · The field and its editing

### C-01 · The composer field and its border

**Terminal.** The prompt is not a box. Outside screen-reader mode `borderLeft` and `borderRight`
are `false` and `borderTop` is left unspecified, so the layout draws it — the input renders as
**two horizontal rules**, above and below (SPEC 41.16.4, `chunk-qs63rzfp.js:508653`). The colour is
chosen in four lines: bash mode gives `bashBorder`; an in-process agent store gives `promptBorder`;
otherwise this session's *own* agent or team colour, mapped to its `*_FOR_SUBAGENTS_ONLY` key.
Plan mode does **not** tint the border. Under the rule sit the mode pill, the context meter and a
hint row (SPEC 41.15.4, lane A's).

**Job.** Say where typing goes, and let the frame itself carry one bit of state — "this line is a
shell command", "this session is a teammate" — without spending a word on it.

**Wire.** T for the border; the *state* it encodes is P (`current_permission_mode`, agent colour
from the handshake). `tui-parity` 41 area rows for the input frame.

**afleet today.** `built` — `App/Composer/ComposerField.swift` is an `NSViewRepresentable` over an
`NSTextView` inside an `NSScrollView` with `drawsBackground = false`, `borderType = .noBorder`,
`isRichText = false`, `allowsUndo = true`, 4×6 text-container inset. There is **no border and no
tint at all**: the field carries no visible state.

**GUI form.** Composer region. A single rounded container with a 1 pt stroke, `.thinMaterial` or
`quaternaryLabel` at rest. Two tinted states, both faithful in *meaning* and native in execution:
`accentColor`-tinted stroke while the field has focus (macOS convention, no terminal equivalent),
and a **`bashBorder`-equivalent orange stroke plus a leading `!` badge inside the field** while the
draft starts with `!` (C-17). Drop the teammate colour: afleet channels are not teammates in v1.
Keep the top and bottom rules as the container's own edges — the terminal's sideless frame is a
cell-grid artefact, not a design.

```
┌ Timeline ───────────────────────────────────────────────────────────────────┐
├─────────────────────────────────────────────────────────────────────────────┤
│ / commands   @ files   ! shell                                    ⏎ send    │  ← C-22 hint row
│ ╭─────────────────────────────────────────────────────────────────────────╮ │
│ │ Investigate the failing auth tests_                                     │ │  ← field
│ ╰─────────────────────────────────────────────────────────────────────────╯ │
│ [img 1] [img 2]                            Auto ▾ │ opus ▾ │ high ▾        │  ← tray + pickers
└─────────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** Drops: the sideless frame, the teammate tint, screen-reader border
suppression (AppKit owns accessibility). Keeps: the bash tint as the one state the frame carries.
Gains: a focus ring, real hit-testing, and a container that can grow with content `[exceeds]`.

**Open.** Does afleet want the focus ring at all, given the composer is nearly always the focused
control? Owner's taste.

### C-02 · The editor buffer: word motion, control keys, named keys

**Terminal.** The prompt is an immutable `Zs` cursor rebuilt on every keystroke (SPEC 42.12).
`keybindingFlavor` is **deprecated and inert** in 2.1.263 — its own schema text is the normative
statement: `Deprecated: no longer has any effect. The prompt's word-editing keys always follow Bash
(readline) conventions.` (SPEC 42.12.2). The control map is fixed (SPEC 42.12.3): `ctrl+a/e` line
ends, `ctrl+b/f` char, `ctrl+h` backspace, `ctrl+k/u/w` kills, `ctrl+y` yank, `ctrl+n/p` history or
cursor, `alt+b/f` word, `alt+d` kill-word, `alt+y` yank-pop. Insertion is **not** a general
fallback: every `ctrl` event ends in the ctrl map and every `meta` event in the meta map, and an
unmapped one returns nothing rather than inserting. Word boundaries are `Intl.Segmenter` runs
re-split on `/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu`, so punctuation and `_` separate words. `tab`
returns `undefined` — the editor never consumes Tab. `return` (a CR key) and `enter` (a literal
newline record) are different cases.

**Job.** Text editing at the speed of a shell prompt, with the muscle memory a terminal user
already has.

**Wire.** T — the whole decoder and buffer are terminal-side (`tui-parity` §42.2–42.4: "the GUI
skips the entire decoder"). R (trivial) for the editing itself.

**afleet today.** `superseded` — `App/Composer/ComposerField.swift` uses `NSTextView`, which ships
`ctrl+a/e/b/f/k/y`, `opt`+arrows and `opt`+delete natively via AppKit's emacs bindings. afleet
declares only Return and Tab and passes everything else through: "swallowing a fifth is how a field
loses a system binding" (`ComposerKeyAction`).

**GUI form.** Keep as is. One deliberate divergence to record rather than fix: AppKit's word
boundaries are not the terminal's re-split readline runs, so `opt+←` over `foo_bar` moves one word
in afleet and two in the terminal. Not worth a custom layout manager. Also keep afleet's
marked-text guard — `hasMarkedText()` short-circuits `keyDown` so an input method's Return confirms
a candidate instead of sending (C6.2 Decision Log, "An input method's Return is not the
composer's"); the terminal has no equivalent and this is a straight `[exceeds]`.

**Drops / keeps / gains.** Drops: readline word re-splitting, the never-insert-on-unmapped-ctrl
rule, the `return`/`enter` distinction. Keeps: the emacs control keys, by inheritance. Gains: IME
correctness, system text services, spell-check, services menu `[exceeds]`.

**Open.** None.

### C-03 · The kill ring

**Terminal.** `ctrl+k`, `ctrl+u`, `ctrl+w`, `alt+d` and the `super`/`meta` deletion variants push
into a kill ring with `direction: "append" | "prepend"`; any other key dispatches
`{type: "interrupt"}` and ends the sequence; `ctrl+y` yanks, `alt+y` yank-pops the just-yanked span
(SPEC 42.12.5). After a `ctrl+u` that killed ≥ 3 characters a 5000 ms hint reads
`Ctrl+Y to paste deleted text` (verified in `cli.pretty.js:627109`).

**Job.** Cut-and-paste inside the draft without touching the system clipboard.

**Wire.** T / R (trivial).

**afleet today.** `superseded` — AppKit's own kill ring covers `ctrl+k`/`ctrl+y`. `alt+y` yank-pop
and the append/prepend sequencing are absent (`tui-parity` §42.12, "near-invisible to most users.
Low priority").

**GUI form.** No work. If the discovery hint is ever wanted, a native app has a better home for it:
the Edit menu, where `Cut`/`Paste` already live.

**Drops / keeps / gains.** Drops: yank-pop, append/prepend accumulation, the 5000 ms hint. Keeps:
kill-to-line-end and yank. Gains: the system clipboard is the same clipboard `[exceeds]`.

**Open.** None.

### C-04 · The left-arrow guard

**Terminal.** `←` on an *empty* input is overloaded — it detaches from an attached agent or goes
back to the agents list — so it runs through a six-outcome state machine (`fire`, `arm`, `absorb`,
`attach-arm`, `attach-absorb`, `reject`) over four timestamps, with constants
`oat = 3000, Tt = 1000, hr = 150` and the hints `Press ← again to go back to agents` and
`Ambiguous ←, press again to detach` (SPEC 42.12.6; verified in `cli.pretty.js:626107`). A press
inside a burst (`soloKeypress !== true`) is rejected as an ordinary cursor move. The attached
branches are **unreachable in 2.1.263** (`Nze` returns `!1`). Gated by
`tengu_left_arrow_editing_guard` (default on) and the `leftArrowOpensAgents` setting.

**Job.** Let one key mean two things without stealing a cursor move — a problem that exists only
because a terminal cannot tell a human keypress from a pasted arrow burst.

**Wire.** T (`tui-parity` §42.12: "A GUI has a back button. Drop it").

**afleet today.** `superseded` — the Agents panel is a tab (root spec §8.8) reachable by click and
by `Cmd+2`…`Cmd+7`; `←` in afleet's field is a cursor move and nothing else.

**GUI form.** No composer surface. The gesture's *intent* — "go back to the thing I came from" —
belongs to the panel's own navigation and to `Cmd+[`, not to the field.

**Drops / keeps / gains.** Drops: the whole machine and both hint strings. Keeps: nothing. Gains:
`←` is unambiguous.

**Open.** None.

### C-05 · Undo, `chat:undo` and `chat:newline`

**Terminal.** The prompt has its own undo stack, independent of `/rewind`: 50 entries,
1000 ms coalescing, and **no redo** — the index only decrements (SPEC 42.12.7,
`{ maxBufferSize: 50, debounceMs: 1000 }`). Each entry records text, cursor offset, the paste map
and a timestamp, so an undo restores `pastedContents` with the text. `chat:undo` is bound to four
chords (`ctrl+_`, `ctrl+-`, `ctrl+shift+-`, `ctrl+shift+_`) and vim's `u` calls the same function.
Explicit immediate snapshots are taken before paste insertion, newline insertion, external-editor
replacement, queue pop and paste expansion — though in non-vim editing the shared wrapper marks
none of them immediate, so the 1000 ms debounce can defer each (SPEC 42.21.11). `chat:newline`
(`ctrl+j`) snapshots, splices `\n`, advances the caret.

**Job.** Take back the last edit without losing the attachments that came with it.

**Wire.** R (trivial).

**afleet today.** `built` — `view.allowsUndo = true` in `ComposerField.makeNSView`. That is native
undo *and redo*. But afleet's undo does **not** cover `attachments`: an undo after a paste restores
text the field never changed (the paste attached an image without touching the draft) and leaves
the chip in the tray.

**GUI form.** Keep `NSUndoManager`. Add one thing: register attachment mutations
(`attach(from:)`, `removeAttachment(at:)`, `dropAttachments(_:)`) as undoable actions on the same
manager, so `Cmd+Z` after an accidental paste removes the chip. That is the terminal's
"restores `pastedContents` with the text" rule translated to afleet's chip model, and it is the
only part of SPEC 42.12.7 worth porting.

**Drops / keeps / gains.** Drops: the four chords, the 50-entry cap, the 1000 ms coalescing, the
no-redo rule. Keeps: undo restores attachments alongside text. Gains: redo, and undo in every
field `[exceeds]`.

**Open.** None.

### C-06 · Editor mode `vim` — the recommendation

**Terminal.** `editorMode: "normal" | "vim"`, default `normal`, resolved through the generic
settings resolver over **every enabled source** in the order `policySettings`, `flagSettings`,
`localSettings`, `projectSettings`, `userSettings`, then legacy `~/.claude.json` (SPEC 42.13.1,
42.13.8). `vim` selects a different input component that composes a vim reducer around the same
editor. Scope is exact and *bounded*: four displayed modes (`INSERT`, `NORMAL`, `VISUAL`,
`VISUAL LINE`); the motion table of SPEC 42.13.3; `d`/`c`/`y` with doubling and multiplying counts
(`3d2w` = 6 words); 15 text-object pairs; counts clamped at `1e4`; **one unnamed register** on the
session scratch; indent of exactly two spaces; dot-repeat over 18 recorded change kinds; **no
REPLACE mode**. Deliberately absent: `%`, `{}`, `()`, `H/M/L`, `n/N/*/#`, buffer search, marks,
`ge`, `[[`, `g_`, `it/at`, `is/as`, `ip/ap`. `vimInsertModeRemaps` maps exactly two printable NFC
characters to `<Esc>` within 1000 ms (SPEC 42.13.5). The precedence that matters: `chat:cancel` is
**deactivated while vim is on and the mode is not NORMAL**, so `escape` in INSERT/VISUAL is a vim
key and only NORMAL-mode `escape` interrupts (SPEC 42.13.7).

**Job.** Let a vim user edit a prompt the way they edit everything else.

**Wire.** P (read) — `get_settings.effective.editorMode` (`tui-parity` §42.13, live dump
`"normal"`). R (the layer). `update_settings` writes localSettings only, so a user-scope change
means writing `~/.claude/settings.json`, which root spec §7.8 forbids afleet to do.

**afleet today.** `undesigned` — no afleet spec or Swift file mentions `editorMode` or vim; the
only occurrences in the repo are `docs/tui-parity/` rows. Root spec §14 item 11 asks that **`/vim`
be hidden from autocomplete and refused with an explanation**, which the router already does
(C6.2 G1, terminal-only class), but that is the *command*, not the setting.

**GUI form.** **Recommendation: do not implement the vim layer; do surface the setting.** Three
reasons, in order. (a) The setting reaches a user without their asking — a `projectSettings` or
`policySettings` file sets it, so a shared repo can turn vim on for someone who has never typed
`/vim`. (b) afleet's Esc is unconditionally *interrupt the turn*
(`ComposerShortcuts.interrupt()` routes `/stop`), which is exactly the key the terminal gives to
vim in INSERT and VISUAL. A vim user in afleet presses Esc expecting NORMAL and kills their turn.
(c) A partial vim is worse than none: `tui-parity` §42.13 top-gap 13 says so and the scope above is
what "complete" means.

So: read `editorMode` off the existing `get_settings` readback the pickers already take
(`App/Header/SettingPickers.swift`), and when it resolves to `vim`, show one dismissible line in
the header's settings menu — `Editor mode is set to vim. afleet uses the native macOS field; Esc
interrupts the turn.` — naming the source (`projectSettings`, `userSettings`, …) that
`get_settings.sources` already carries. No modal, no banner, no repetition. If the vim layer is
ever built it is an L and it is a `Workbench`-shaped problem (the Files panel's editor core, C7.2,
already faces the same question) rather than a composer one.

**Drops / keeps / gains.** Drops: the entire layer, the remaps, the indicator, the `/`-opens-history
and `k`/`j`-fall-through-to-history gestures. Keeps: the fact that the setting exists and is
visible. Gains: none.

**Open.** **For the owner:** is disclosure enough, or is vim a v1.1 backlog item with the exact
SPEC 42.13 scope as its definition of done? The population question is real and I cannot answer it
— afleet has no telemetry and `editorMode` is not in the live handshake's readback except through
`get_settings`.

### C-07 · The vim mode indicator and `/vim`

**Terminal.** Below the prompt, dim: `-- INSERT --`, `-- VISUAL --`, `-- VISUAL LINE --`. NORMAL
renders nothing. Suppressed while history search is open and by `statusLine.hideVimModeIndicator`,
whose schema text is `Hide the built-in ` `-- INSERT --` ` / ` `-- VISUAL --` ` indicator below the
prompt. Use this when your status line script renders ` `vim.mode` ` itself.` (SPEC 42.13.6). The
same value is fed to the status line as `vim.mode`. There is **no per-mode cursor shape** — the
harness never emits DECSCUSR, so the cursor is a reverse-video block in every mode. `/vim` is a
hidden redirect behind `tengu_maple_sundial`, **default off**, so in a stock build the command does
not exist; when on it prints `/vim moved → Editor mode in /config` (SPEC 42.13.8, 42.24.4). The
three working routes are the `/config` Editor-mode row, `/config editor=vim`, and editing
`settings.json`.

**Job.** Tell the user which vim mode they are in; give `/vim` typists a signpost.

**Wire.** X for the command (absent from the live headless command list); R for the indicator.

**afleet today.** `built` for the refusal half — the router's terminal-only class refuses `/vim`
with `RouterTable.explanation(forTerminalOnly:)` rendered verbatim in `RefusalSurface`
(C6.2 G1; root spec §14 item 11). `undesigned` for the indicator, correctly, since there is no vim
layer.

**GUI form.** Keep the refusal exactly as built — and note the `[parent-impact]` C6.2 filed and
`main` resolved at `6abd4a0`: the sentence must not tell the user to go back to the terminal
(root spec §7.7). The right sentence for `/vim` specifically is that the editor mode is a
`settings.json` value afleet reads but does not implement, which is C-06's disclosure line. No
indicator. If vim is ever built, the indicator belongs inside the field's trailing edge, not on a
row of its own, and `hideVimModeIndicator` becomes moot (afleet has no status-line script).

**Drops / keeps / gains.** Drops: the three mode strings, `hideVimModeIndicator`, the
reverse-video-block cursor. Keeps: `/vim` refused locally with an explanation. Gains: `[exceeds]`
if vim ever ships, a real per-mode caret (bar in insert, block in normal) that the TUI cannot draw.

**Open.** None.

### C-08 · Multi-line entry: Shift+Enter, Enter, backslash-return, `ctrl+j`

**Terminal.** Four routes produce a newline (SPEC 42.14). **Backslash then Enter**: with
`multiline` on and `disableBackslashReturn` off, a trailing `\` is deleted and replaced by the
newline — "Works in every terminal with no setup". **Shift+Enter / Option+Enter**: the key event
carries `meta` or `shift`, reached two ways — the legacy ESC-CR convention, where the decoder
synthesises `meta` from the two-byte `\x1b\r`, or a native enhanced keyboard (Kitty CSI-u,
`modifyOtherKeys`) that reports a real shift bit. **Apple Terminal shift probe** (C-09).
**`ctrl+j`**, handled after the named-key switch and before generic Ctrl dispatch. `enter` as
distinct from `return` always inserts a literal newline; bracketed paste never produces `enter`
events, so clipboard newlines are split as *text*, not delivered key by key.

**Job.** Write a paragraph without sending it.

**Wire.** P→R (`tui-parity` §42.14: "Native and unambiguous in a GUI").

**afleet today.** `built` — `ComposerKeyAction.forReturn` is a value, not a branch: Shift+Return →
`.newline` (via `insertNewlineIgnoringFieldEditor`), bare Return and Cmd+Return → `.send`,
everything else → `.pass`. Caps Lock, Fn and the numeric-pad bit are stripped before the test,
and the keypad's Enter (key code 76) is accepted alongside Return (36). Root spec §8.5 and §8.7
were reconciled at C6.2's merge: Enter and Cmd+Enter both send, and they were never alternatives.

**GUI form.** **What a native field gives for free:** the modifier bit itself. There is no ESC-CR
convention, no `/terminal-setup`, no probe, no per-terminal capability question — `NSEvent`
carries `.shift` and AppKit hands it to `keyDown` unambiguously. **What it must still do:** decide
what Enter means, because that is a product decision the terminal also had to make. afleet's table
is right and should be documented in the UI: the hint row (C-22) carries `⏎ send` and the
placeholder should read `Message #<channel>…` with `⇧⏎ for a new line` in the hint row's trailing
slot on first use. **Drop backslash-return outright** — it would eat a legitimate trailing
backslash in a code snippet, which is the ordinary case in this app. **Drop `ctrl+j`**: it collides
with nothing but earns nothing either, and `ComposerShortcut` deliberately declares four keys.

**Drops / keeps / gains.** Drops: backslash-return, `ctrl+j`, the `return`/`enter` split, the ESC-CR
plumbing. Keeps: Shift+Enter newline, Enter send. Gains: Cmd+Enter as a second send so a field that
has taken Enter for something else still sends `[exceeds]`; the marked-text guard (C-02).

**Open.** None.

### C-09 · The Apple Terminal shift probe and `/terminal-setup`

**Terminal.** Apple Terminal does not distinguish Shift+Return from Return in its byte stream, so
the harness asks the OS: `TERM_PROGRAM === "Apple_Terminal"` plus `isModifierPressed("shift")` from
a lazily-required native module, pre-warmed on mount (SPEC 42.14.1). `/terminal-setup` writes the
ESC-CR sequence into each terminal's own config: a `keybindings.json` entry
(`workbench.action.terminal.sendSequence`, args `{text: "\x1B\r"}`) for VS Code, Cursor and
Windsurf; a TOML block for Alacritty; `["terminal::SendText", "\x1B\r"]` for Zed; and for Apple
Terminal one of three paths keyed on macOS ≥ 27 and screen-reader mode — on macOS ≥ 27 with a
screen reader it changes nothing and says `Shift+Return already enters a newline on this macOS
version…`; on macOS ≥ 27 without one it advertises `Shift+Return will now enter a newline.`; below
27 it sets `useOptionAsMetaKey` and says `Option+Enter will now enter a newline.` iTerm2, WezTerm,
Ghostty, Kitty, Warp and Windows Terminal are never given a binding. The two installation flags
(`shiftEnterKeyBindingInstalled`, `optionAsMetaKeyInstalled`) are **not reliable records that the
change was made** — read them as "`/terminal-setup` ran and did not throw" (SPEC 42.14.2; profile
writing in SPEC 41.25).

**Job.** Make Shift+Enter work at all, in a world where it might not reach the process.

**Wire.** T + X — `local-jsx` with `requires: {ink: true}`, absent from the live headless command
list (`tui-parity` §42.14).

**afleet today.** `superseded` — see C-08. The router's terminal-only class refuses
`/terminal-setup` locally.

**GUI form.** No surface. Keep the refusal, whose explanation should say the shortcut already works
here rather than describing a terminal profile. The onboarding hints (`Press Shift+Enter to send a
multi-line message`, `Run /terminal-setup to enable Shift+Enter for new lines`, `cooldownSessions:
10`) are not ported; C-22's hint row carries the same teaching continuously and for free.

**Drops / keeps / gains.** Drops: the probe, the native addon, every profile writer, both
installation flags, both onboarding hints. Keeps: nothing. Gains: Shift+Enter always works, in
every window, with no setup `[exceeds]`.

**Open.** None.

---

## 2 · Paste and attachments

### C-10 · Paste detection and the paste hook

**Terminal.** Two detection paths (SPEC 42.15.1). **Bracketed paste**: the decoder emits one record
with `isPasted: true` and the router turns it into a `PasteEvent`, whose constructor cleans the text
in two passes — eight-bit C1 forms are *unwrapped, payload kept*; seven-bit `ESC P` / `ESC ]` forms
are *stripped, payload and all*, through `Bun.stripANSI`. `rawEmpty` and `rawEndedWithFocusTail`
exist because a terminal may deliver a focus report inside the paste envelope when the user switches
to the window in order to paste. **Oversized keystroke**: any unmodified key whose derived text
exceeds `lK = 800` characters, with **no printability check** — `shift` and `super` are not tested,
so a shift-modified 900-character key still counts as a paste. The hook (SPEC 42.15.2) sets
`isPasting` so the footer shows `Pasting…` (SPEC 41.24.5); **defers a `return` pressed during a
paste** and replays a synthetic unmodified `return` when the paste completes as text (dropped
outright when an asynchronous *image* completion finishes instead); splits the blob on the boundary
before an absolute path then on newlines, **discarding every empty or whitespace-only fragment
before classification**, so a mixed image/text paste comes back with its blank separator lines
collapsed; and on macOS/WSL treats an *empty* paste with an image handler present as "the clipboard
holds an image", debounced 50 ms.

**Job.** Get a large or structured clipboard into the prompt without the terminal's byte stream
mangling it or its trailing newline submitting it.

**Wire.** T (`tui-parity` §42.15: "Native paste is atomic; the whole race disappears").

**afleet today.** `built`, partially — `ComposerField.paste(_:)` overrides `NSTextView.paste` and
asks `onPasteboard`; if the composer took ≥ 1 image the keystroke is consumed, otherwise
`super.paste(sender)` runs and text pastes as text (`App/Composer/Attachments.swift`,
`ComposerField.swift`). Every item's data is read for each declared type and the **first that
sniffs or decodes as an image wins**, so a screenshot offered as both TIFF and PNG is attached once.
`performDragOperation` uses the same intake.

**GUI form.** Keep the intake exactly. Three additions, all cheap. (a) **Sniff, do not trust the
UTI** — afleet already does this (`ImageIntake.mediaType(of:)` reads magic bytes because
"`NSPasteboard` will report a UTI for data it never inspected"), and that is strictly better than
the terminal's path-extension heuristic `[exceeds]`. (b) **Nothing to defer**: `NSPasteboard` is
atomic, so drop the deferred-return machinery and the `Pasting…` state — there is no window in
which a Return can race a paste. (c) **Do not collapse blank lines**: the terminal's
whitespace-fragment filter is an artefact of its split-then-classify pipeline; afleet pastes text
through AppKit untouched, which is correct.

**Drops / keeps / gains.** Drops: bracketed paste, the 800-character heuristic, the ANSI cleaning
passes, `rawEmpty`/`rawEndedWithFocusTail`, the deferred Return, `Pasting…`, the blank-fragment
filter. Keeps: multi-item paste, image-path recognition (as `.fileURL` intake). Gains: type
negotiation instead of heuristics, and drag-and-drop on the same code path `[exceeds]`.

**Open.** None.

### C-11 · Text placeholders and re-paste expansion

**Terminal.** Pasted text is normalised in three steps — ANSI stripped, CRLF and CR to LF, tabs to
four spaces — then either inserted literally or replaced by a placeholder (SPEC 42.15.3). The
threshold is `II.length > 800` **or** newline count `> max(0, min(rows - 10, 2))`, i.e. **2 newlines
on any terminal at least 12 rows tall**, 1 at 11 rows, 0 at 10 or fewer. The text goes into the
`pastedContents` map under a fresh integer id and the placeholder is inserted:
`[Pasted text #N]`, or `[Pasted text #N +M lines]` when M > 0. Five placeholder shapes exist in the
grammar: those two plus `[Image #N]`, `[Audio #N]` and `[...Truncated text #N +M lines...]`. The
cursor treats a placeholder as one indivisible unit — arrows and Backspace jump it whole
(SPEC 42.12.1, `placeholderContaining` / `snapOutOfPlaceholder`). **Re-pasting the same text over
its own placeholder expands it back** to the literal text instead of minting a second id, and while
that is possible a dim 8000 ms hint reads `paste again to expand` (verified in
`cli.pretty.js:506684`), gated at 100 000 characters.

**Job.** Keep a 400-line paste from burying the prompt, while leaving the user a way to see and
edit what they actually pasted.

**Wire.** R — the GUI sends the expanded text in the `user` frame (`tui-parity` §42.15:
"Placeholders exist because a terminal cannot render a collapsible chip… an unambiguous
improvement. **But** history interop requires writing the placeholder form back").

**afleet today.** `superseded` for the mechanism, `undesigned` for its replacement — afleet pastes
text verbatim into `NSTextView` with no threshold, no placeholder and no chip. A 4000-line paste
becomes a 4000-line draft in a scrolling field.

**GUI form.** Composer region, a **paste chip** inline in the tray beside image chips (C-16), not
inline in the text. Threshold: keep the terminal's `> 800 characters`; **drop the newline test** —
it is a row-budget calculation and afleet's field scrolls. A paste over the threshold inserts
nothing into the draft and adds a chip reading `Pasted text · 412 lines · 18 KB` with a disclosure
that opens the content in a popover (read-only, selectable, monospaced). The chip is removable like
an image chip and is expanded into the text at submit (C-13). Under 800 characters, paste as text —
that is the terminal's rule and it is right.

`[exceeds]` Three ways the chip beats the placeholder: it is genuinely atomic (an
`NSTextAttachment` cannot be half-deleted, so `snapOutOfPlaceholder` becomes structural rather than
a cursor rule); it can show a real preview rather than a line count; and it can be dropped without
editing the draft.

Drop `paste again to expand` — its job is "let me see what is behind the placeholder", which the
chip's disclosure answers directly and permanently rather than inside an 8000 ms window.

**Drops / keeps / gains.** Drops: the newline threshold, all five placeholder strings, the re-paste
expansion gesture and its hint, the tab→4-spaces normalisation (AppKit keeps tabs). Keeps: the
800-character threshold, CRLF→LF normalisation, atomicity. Gains: preview, removal, and a chip that
survives editing around it `[exceeds]`.

**Open.** **For the owner:** should a large paste ever land as text when the user clearly wants it
inline (a pasted diff they intend to edit)? A modifier — `⌥⌘V` "paste as text" — is the native
answer, but it is a new gesture the terminal has no analogue for.

### C-12 · Oversized-draft truncation

**Terminal.** A draft over `xht = 10 000` characters gets a *second*, different placeholder
(SPEC 42.15.5). The inner helper keeps `floor(1000/2) = 500` characters from each end and replaces
the middle with `[...Truncated text #id +N lines...]`. The caller is placeholder-aware: it walks
existing placeholders back to front, cuts non-text ones that overlap the middle aside for
reinsertion at offset 500, **expands overlapping text placeholders in place before the cut** so the
truncation entry holds real text rather than nested placeholders, then truncates. The spec is
explicit that the naive reading is "wrong twice over": the retained ends are 500 characters of the
*transformed* string, not the original, and step 5 can return the draft **entirely unchanged** when
expansion-then-removal leaves ≤ 1000 characters. At most one truncation attempt runs between empty
drafts.

**Job.** Stop a runaway draft from consuming the whole screen.

**Wire.** R (`tui-parity` §42.15: "A GUI has no line budget and should not truncate the draft at
all").

**afleet today.** `superseded` — no truncation exists; the field scrolls.

**GUI form.** No surface. A scrolling `NSTextView` with a max height and a scroller is the whole
answer. The one thing worth carrying forward is the *idea* the mechanism protects — that an
enormous draft is usually an accident — and the chip of C-11 already catches the accident at its
source (the paste) rather than after it.

**Drops / keeps / gains.** Drops: the 10 000 threshold, the 500-character ends, the
`[...Truncated text …]` form, the reinsertion dance, the latch. Keeps: nothing. Gains: the user
keeps every character they typed `[exceeds]`.

**Open.** None.

### C-13 · Expansion at submit time and missing-backing repair

**Terminal.** The placeholder is what the user sees; the model receives the real text
(SPEC 42.15.6). `j9(text, map)` substitutes every text placeholder back, walking matches in reverse
index order so earlier offsets stay valid, returning `{stripped, expanded, removed}`. The removal
branch is gated on the placeholder **not** being an image: an unavailable `[Pasted text #N]` or
`[...Truncated text #N …]` is deleted from both forms and reported, but an unavailable
**`[Image #N]` is left in place in both forms and is never reported**. The user-facing repair text
(SPEC 42.15.5) is `<label> #<id> is no longer available and was removed from the prompt`, plural
`… are no longer available and were removed from the prompt`, under the notification key
`pasted-text-unavailable`, with the label `Pasted text` or `Truncated text`.

**Job.** Send the model everything the user meant, and admit it when a piece has gone missing
rather than shipping a dangling `[Pasted text #3]` string into the conversation.

**Wire.** R — the GUI does the expansion before writing the frame (`tui-parity` §42.15).

**afleet today.** `undesigned` — there are no placeholders to expand. Images travel as
`ImageAttachment(mediaType:base64:)` on the `UserInput` (root spec §6.6), which is the right shape
and needs no expansion.

**GUI form.** With C-11's chip: at submit, splice each text chip's content into the draft at the
chip's position, in reverse order, and send one `UserInput`. There is no unavailability case in
afleet — the chip owns its bytes in memory for the composer's lifetime, and `ComposerRegistry`
retains the composer across a channel switch precisely so unsent input survives. So the whole repair
path and both its sentences are dropped, correctly. **The one place afleet must not drop it** is
history (C-33): a recalled history entry *can* carry a dead placeholder, because the terminal wrote
one, and afleet must decide what a chip with no backing shows.

**Drops / keeps / gains.** Drops: reverse-order substitution, `{stripped, expanded, removed}`, both
repair sentences, the never-report-a-dead-image asymmetry (which is a bug). Keeps: the model
receives the real text, not the display form. Gains: chips cannot go stale within a session
`[exceeds]`.

**Open.** None.

### C-14 · Paste storage and the paste cache

**Terminal.** `pastedContents` entries are `{id, type: "text" | "image", content?, contentHash?,
mediaType?, filename?}` (SPEC 42.15.7). When an entry is written into `history.jsonl`, content
longer than `o6r = 1024` characters is replaced by a `contentHash` and the body moves to the
`paste-cache` directory. `xXt = 1e7` is **not** a directory-size cap: it bounds only the in-memory
`retainedFailed` map — bodies kept in RAM after a cache write failed, evicted oldest-first — and the
disk-write path does no directory accounting and imposes no cap of its own.

**Job.** Let a recalled prompt from three days ago still expand its paste.

**Wire.** R — on disk, not on the wire.

**afleet today.** `designed` as a gap, not built — root spec §13: "`history.jsonl` is read for
seeding the composer history only, never written; print sessions neither read nor write it." Even
that read is aspirational: no Swift file opens the path (C-32).

**GUI form.** No composer surface of its own; this is C-33's implementation detail. If afleet ever
writes history (recommended there), it must reproduce the ≤ 1024-character inline / content-hash
split and write bodies into the same `~/.claude/paste-cache/` directory, or the terminal will show
a dead placeholder for every prompt afleet recorded. That is a **write under the config home**,
which root spec §7.8's never-write rule forbids — see C-33's Open.

**Drops / keeps / gains.** Drops: the `retainedFailed` RAM cap. Keeps: the split and the directory,
if history writing ships. Gains: none.

**Open.** Covered by C-33.

### C-15 · Image paste and the clipboard hint

**Terminal.** `chat:imagePaste` is bound to `ctrl+v` on macOS and Linux, `alt+v` only on Windows,
and **both** on WSL (SPEC 42.15.8). It reads the clipboard directly rather than waiting for a
terminal paste event; on failure it says `No image found in clipboard. Use <chord> to paste
images.`, or `No image found in clipboard. You're SSH'd; try scp?`. A success stores
`{type: "image", content, mediaType, filename, dimensions, sourcePath}` and inserts `[Image #N]`;
consecutive images in one gesture are separated by a space and marked `continuesGesture` so they
share one undo entry. There is **no per-platform branch in this build** — three command objects
declare `darwin`/`linux`/`win32` members but every selection site takes the first truthy member and
Darwin always wins, so the fallback shells out to `osascript` on every platform (SPEC 42.21.12). The
bytes do not always pass through a scratch file: a native reader returns a PNG buffer in memory, and
only when it is unavailable is `<tmpdir>/claude_cli_latest_screenshot.png` used — and its cleanup is
best-effort, with no `finally`. Separately, a **clipboard-image hint** is armed by exactly one
event — an unfocused→focused transition, seeded so a session that mounts already focused never
probes — then a 1000 ms timer, then a 30 000 ms cooldown, then the clipboard is inspected; only a
positive result raises the 8000 ms hint `Image in clipboard · <chord> to paste`.

**Job.** Get a screenshot into the prompt from a program that cannot draw one.

**Wire.** P — image content blocks on the `user` frame (`tui-parity` §42.15). The GUI must do the
resize and encode itself.

**afleet today.** `built` and better — `App/Composer/Attachments.swift`. `Cmd+V` with an image on
the pasteboard attaches it; PNG and JPEG travel verbatim, anything `NSBitmapImageRep` can decode is
re-encoded as PNG; caps are **8 images per message and 8 MiB each after conversion**, plus a
64 MiB bound on a *dropped file's* source bytes because "a decoder's input is not its output"
(C6.2 Decision Log). A Finder drop offering only a `.fileURL` is resolved and read. Refusals are
counted, never itemised: `Not attached: 2 image(s) beyond the 8 one message carries, 1 item(s) that
are not an image.`

**GUI form.** Keep. Three refinements. (a) **Show the dimensions and a thumbnail**: afleet's chip
reads `Image 1 (image/png)`, which is less than the terminal's own stored `dimensions` field would
allow; a 44 pt thumbnail plus `1284 × 812` is the native form `[exceeds]`. (b) **Drop the clipboard
hint entirely** — its whole purpose is discovery of a chord in a program with no affordances, and
afleet's tray plus `Cmd+V` is the affordance. (c) Keep the counted-not-named refusal note; it is
already the §11 rule and it is also better copy than the terminal's.

**Drops / keeps / gains.** Drops: `ctrl+v`/`alt+v` platform branching, the `osascript` fallback and
its scratch file, the SSH message, `continuesGesture`, the focus-transition probe and its hint.
Keeps: the caps as afleet states them, PNG conversion, the image block on the frame. Gains: drag
and drop, sniffed media types, a real thumbnail, removal by click `[exceeds]`.

**Open.** None.

### C-16 · The attachments strip

**Terminal.** A dedicated context, `Attachments`, "When navigating image attachments in a select
dialog" (SPEC 42.4), with four bindings (SPEC 42.6.14): `right` → `attachments:next`, `left` →
`attachments:previous`, `backspace`/`delete` → `attachments:remove`, `down`/`escape` →
`attachments:exit`. The backspace-removes-attachment gesture is INSERT-only under vim
(SPEC 42.13.7). The strip is a keyboard-navigated row of chips whose only actions are move and
remove.

**Job.** See what will travel with the message, and take one back off.

**Wire.** R — image blocks on the `user` frame (`tui-parity` §42.6.14: "Native attachment chips").

**afleet today.** `built` — `AttachmentTrayView` in `App/Composer/Attachments.swift` draws one
`.bordered` button per attachment, labelled `Image <n> (<mediaType>)` with a `photo` icon, plus the
refusal note above. Removal is a click on the chip itself, which is discoverable only by trying it.
`dropAttachments(_:)` removes sent images **by identity, one occurrence each**, because the tray
stays live across the send's await (C6.2 Decision Log, scalpel-2#4).

**GUI form.** Composer region, under the field, above the pickers. One row of chips, horizontally
scrolling. Each chip: 44 pt thumbnail, `1284 × 812 · PNG` beneath or beside, and an `×` on hover in
the top-trailing corner — clicking the chip *body* should open a Quick Look preview, not delete,
because clicking a thumbnail to destroy it is a mis-affordance the terminal never had to face.
Keyboard: Tab reaches the row, `←`/`→` move between chips, `Delete`/`Backspace` removes the focused
one, `Escape` returns focus to the field. That is the terminal's four bindings verbatim, and they
are the native conventions too.

```
│ ╭──────────────────────────────────────────────────────────────╮ │
│ │ Here is the failing screenshot_                              │ │
│ ╰──────────────────────────────────────────────────────────────╯ │
│ ┌────┐ 1284×812  ┌────┐ 640×480   Not attached: 1 item(s) that   │
│ │ ▣ ×│ PNG       │ ▣ ×│ JPEG      are not an image.              │
│ └────┘           └────┘                                          │
```

**Drops / keeps / gains.** Drops: the select-dialog framing, the vim INSERT-only rule. Keeps: all
four key actions, the chip-per-attachment model. Gains: thumbnails, Quick Look, drag to reorder if
wanted, and a hover `×` that separates "look at it" from "remove it" `[exceeds]`.

**Open.** Should the tray also hold the C-11 text-paste chip, or is that a second row? One row
reads better; mixed content in one row needs the two chip kinds to be visually distinct.

---

## 3 · Input modes: `!` `@` `#` `/`

### C-17 · `!` bash mode: entering, the indicator, leaving

**Terminal.** The prompt has exactly **two** modes, `bash` and `prompt` (SPEC 42.16). The `!`
never reaches the buffer: the change handler intercepts it when the cursor is at offset 0 and the
new value starts with `!`, either swallowing the single inserted character — leaving any existing
text untouched, so `!` typed in front of a draft enters bash mode and **keeps that draft** — or,
when the previous value was empty, stripping the `!` and keeping the remainder with tabs expanded
to four spaces. Pasting into an empty input does the same. `nue` puts the `!` back for history
storage, so recalling a bash line restores bash mode. **Indicator**: the prompt glyph becomes `!`
followed by a non-breaking space in the `bashBorder` colour, the input box border switches to
`bashBorder`, and the hint row under the prompt collapses to the single string `! for shell mode`
in that same colour (verified in `cli.pretty.js:506740`). **Leaving**: Backspace, Delete, Escape
or `ctrl+u`, normally with the caret at offset 0 — with `CLAUDE_CODE_KB_COHESION_FIXES` set,
Escape leaves from any offset; under vim, Escape in a non-NORMAL mode belongs to the vim layer and
does not leave bash mode at all. Bash mode also re-points autocomplete: path completion replaces
`@`-mentions and ghost text switches to shell history (C-25).

**Job.** Make it unmistakable that the next Enter runs a command on this machine rather than
sending a message — and make entering and leaving that state cost one keystroke.

**Wire.** R for the whole mode (`tui-parity` §42.16.1 classes every TUI-side row R). The
*execution* is D: the headless `bash_command` frame is a one-shot `/bin/sh -c` with no transcript
entry and no persistent shell, so the parity workaround is the one afleet took — run the shell
host-side and send a normal `user` frame with the same wrappers.

**afleet today.** `undesigned` as a mode; `built` as a submit-time prefix.
`ComposerModel.send()` (`App/Composer/ComposerModel.swift:258`) tests
`trimmed.hasPrefix("!")` on the **submitted** text and calls `runShellEscape`;
`ShellEscape.shellCommand(in:)` drops the leading `!`. **Nothing detects `!` while typing** —
no glyph, no tint, no stripped buffer, and `ComposerField` has no placeholder text at all. The
user types into an ordinary field with no signal, and Enter runs a command in their working
directory. Ownership is checked before the spawn (`sendWouldBeAccepted(on:)` refuses
`.foreignLive`, `.backgroundJob` and `.owned(.contended)`), which is the right order and is C6.2's
own hard-won lesson.

**GUI form.** Composer region. Make the mode visible the moment the draft starts with `!`,
before Enter: a **leading `!` badge inside the field's leading edge** plus the orange
`bashBorder`-equivalent stroke of C-01, and the hint row (C-22) collapsing to `! for shell mode`
exactly as canon does. Keep the `!` in the text — afleet's field is a normal `NSTextView` and
hiding a character the user typed would fight AppKit's own editing, undo and IME; the badge and
the tint carry the state instead. Keep the terminal's *entering* semantics where they are free
(typing `!` in front of an existing draft is bash mode with that draft; a leading `!` on a paste
counts) and drop the offset-0 leaving rule: in afleet, deleting the `!` leaves the mode, which is
what a text field does anyway. Add one thing the terminal cannot: **show the directory the
command will run in**, since afleet's channel has a `cwd` the user did not type and C6.2 records
that a stale cwd is *"the one mistake in this leaf that cannot be undone afterwards"* — a dim
`~/src/afleet` at the field's trailing edge while the draft starts with `!` is cheap and honest.

```
│ ! for shell mode                                            ~/src/afleet   │
│ ╭────────────────────────────────────────────────────────────────────────╮ │
│ │ !  git status --short_                                                 │ │  ← orange stroke
│ ╰────────────────────────────────────────────────────────────────────────╯ │
```

**Drops / keeps / gains.** Drops: the `!`-never-reaches-the-buffer rule, the NBSP glyph, the
offset-0 exit, the vim and cohesion-flag branches, `defaultShell`/PowerShell selection. Keeps: two
modes and no more, the border tint, the collapsed hint row, the history round-trip's leading `!`
(C-32). Gains: the working directory shown before the command runs `[exceeds]`.

**Open.** None.

### C-18 · What the composer shows while a `!` command runs

**Terminal.** The submitted line is written to the transcript as `<bash-input>…</bash-input>` and
executed with the sandbox disabled through the Bash tool, so shell state — `cd`, exports, the
working directory — survives across `!` lines (SPEC 42.16.1). The result is appended as a
synthetic user message `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`, and whether
the model then answers is `respondToBashCommands` (default true) **and** not interrupted **and**
not backgrounded **and** the abort controller not aborted. An interrupted command emits no output
wrappers at all and never queries the model. While it runs the prompt is a running turn like any
other: the transcript shows the tool row and the footer shows the spinner.

**Job.** Let the user watch the command they just ran, and let the model see its output.

**Wire.** D for the frame, R for the workaround, which afleet took (`tui-parity` §42.16.1
*"Workaround for parity: … run the shell in the GUI … and send a normal `user` frame containing
the same `<bash-input>`/`<bash-stdout>`/`<bash-stderr>` wrapping"*).

**afleet today.** `built`, and invisible. `App/Composer/ShellEscape.swift` spawns via
`posix_spawn` into its own process group, stdin `/dev/null`, cwd from the channel context, shell
from `ResolvedEnvironment` (default `/bin/sh`), a 120-second budget, per-stream retention caps and
`SIGTERM`→`SIGKILL` escalation before the reap; then posts exactly one `UserInput` whose text is
`ShellEnvelope.wrap(command:stdout:stderr:)`. **`isSending` is read by no view and `hostShell` is
`@ObservationIgnored`: there is no spinner, no disabled field, no running chip.** For up to two
minutes the only thing that happens is nothing. The four sentences it can produce all arrive
*after the fact*, through `RefusalSurface`: `There is no command after `!`, so nothing ran.`;
`afleet does not know this channel's working directory yet, so `!` cannot run here.`;
`The command was still running after 120 second(s) and was stopped; what it had written was
sent.`; `The command wrote more than `!` keeps and was stopped; what was kept was sent.` A
cancelled command posts nothing and says nothing.

**GUI form.** Composer region, and this is the cheapest high-value fix in the lane. While a `!`
command runs, replace the hint row with a **running strip**: a spinner, the command in monospace,
an elapsed counter, and a `Stop` button wired to the existing `cancelHostShell()`. The elapsed
counter is not decoration — the budget is 120 seconds and the current UI gives the user no way to
tell a slow command from a hung app. Keep the field editable (the terminal keeps its prompt
usable too) but keep send blocked, which afleet already does through `isSending`. On completion,
the wrapped user frame lands in the timeline as it does today. Two additions the terminal cannot
make: stream stdout into the strip as it arrives rather than only at the end `[exceeds]`, and
say *why* nothing was posted when the user cancels — canon at least emits an interruption message,
afleet emits silence.

```
│ ⠋ !git status --short                              12s   [ Stop ]          │
│ ╭────────────────────────────────────────────────────────────────────────╮ │
│ │ _                                                                      │ │
│ ╰────────────────────────────────────────────────────────────────────────╯ │
```

**Drops / keeps / gains.** Drops: `respondToBashCommands` (afleet always shows the model the
output, by design), the PowerShell branch, `<bash-exit-code>` (which the TUI path never emits
either). Keeps: the three wrappers, the sandbox-off trust model, the transcript entry. Gains: a
visible run, a Stop button, live output, and a sentence when a cancel eats the result
`[exceeds]`.

**Open.** **For the owner:** afleet's `!` has no persistent shell — each line is a fresh
`/bin/sh`, so `cd` and exports do not survive, while the terminal's Bash tool keeps them. Is that
worth closing (a long-lived shell per channel), or is the Terminal panel the answer for anyone
who needs state?

### C-19 · `@` mentions: the trigger, the token, the two providers

**Terminal.** `@` is a *token* trigger, never a mode (SPEC 42.16.2). It fires only at offset 0 or
immediately after whitespace or one of U+3002, U+3001, U+FF1F, U+FF01 — the CJK full stop,
ideographic comma and fullwidth question and exclamation marks — so **a mid-word `@` never
triggers and an email address is inert**. The token class is Unicode letters, numbers and marks
plus `_ - . / \ ( ) [ ] ~ :`; a quoted form `@"…"` admits spaces; a space, comma, `#`, `*`, `?`,
`$` or a second `@` terminates it. `awe(query)` routes `~/`, `/`, `./`, `../`, `~`, `.` and `..`
to the filesystem completer and everything else to the fuzzy index (C-31), with the unified
provider merging files, MCP resources, resource templates and agents (C-26). Expansion happens
at **submit** time, not accept time. One asymmetry: `#` is not in the completion token class, so a
`#L10` line-range suffix is never completed, but the submit-time extractor does parse it.

**Job.** Put a file in front of the model without leaving the sentence you are writing.

**Wire.** R for the trigger and token class; **P for expansion** — the same extractor runs on a
headless `user` frame, so the host can send the literal `@path` text (`tui-parity` §42.16.2;
flagged *unverified* end-to-end in that document's own Unverified list).

**afleet today.** `built`, narrower. `App/Composer/FileMentions.swift` triggers on the last `@`
in the draft when it sits at the start or after whitespace and the token holds no whitespace;
candidates come from the engine through `AnyControlRequest(FileSuggestions(query:))` — afleet
reads no directory itself — debounced 120 ms with the in-flight task cancelled per keystroke;
accept writes `@<path> ` with a trailing space. Rows are one monospaced `Text` each in a
180 pt-tall `.thinMaterial` list, **mouse-only, no selection, no keyboard navigation**
(`CommandCompletionView`-style shell). Root spec §14 item 12 asks only that *"typing `@src` lists
matching files"*.

**GUI form.** Keep the engine-owned index (it is the same index the terminal uses, and building
a second one is how the two apps start disagreeing — `tui-parity` §42.18 warns exactly this).
Close four gaps, in order of how much they cost. (a) **Keyboard**: `↑`/`↓` move a selection, Tab
accepts, Enter with nothing selected submits the line as typed — the accept semantics of C-27,
which afleet has none of. (b) **The CJK punctuation set and the token class**, copied verbatim;
`tui-parity` says *"Reproduce the CJK punctuation set; it is not obvious"*, and the product's
first users type Korean (C6.2's own reason for the IME guard). (c) **The empty-index retry**:
C6.2 settled at grill time that the engine's index builds asynchronously, so *"the first typed-token
query legitimately answers empty, and a host that treats one empty answer as 'no matches' is
simply too early"* — the terminal re-runs the last query when `indexBuildComplete` fires, and the
wire has no such signal, so afleet must retry on a short timer instead of showing "no matches".
(d) **The quoted form** `@"path with spaces"`, which is the only way to mention half the files on
a Mac. Row form: path with the matched span in bold, directory rows with a trailing separator and
a folder icon, file rows with the file's icon `[exceeds]`.

**Drops / keeps / gains.** Drops: nothing deliberate. Keeps: the trigger rule, the token class,
the engine's index and order, submit-time expansion. Gains: icons, bold match spans, and a
preview on hover `[exceeds]`.

**Open.** `@path#L12-30` line ranges are deferred to v1.1 by root spec §3. Worth confirming the
submit-time extractor accepts them from a host frame before the v1.1 work assumes it.

### C-20 · `#` — Slack channels, not memory

**Terminal.** There is **no `#` memory shortcut in 2.1.263** (SPEC 42.16.3). The mode enum has
two members, nothing sets a `"memory"` mode, and `user-memory-input` survives only as a
transcript tag for old sessions; memory editing is `/memory`. What `#` does at the prompt is
complete **Slack channel names**: the regex `(^|\s)#([a-z0-9][a-z0-9_-]*)$`, prompt mode only, a
*connected* MCP server whose name contains `slack`, and the active slash command not declaring
`completesHashChannels` (no shipped command does). The query is debounced 150 ms, answered by the
`slack_search_channels` MCP tool with `limit: 20, channel_types: "public_channel,private_channel"`
and a 5000 ms timeout, capped at 10 rows; recognised channels are highlighted in the live input.

**Job.** Address a Slack channel by name, with the same fluency as a file.

**Wire.** R, fully rebuildable: `mcp_status` gives the connected-server list for the
`name.includes("slack")` test and `mcp_call {tool: "slack_search_channels", …}` is the exact call
(`tui-parity` §42.16.3, ranked gap 10). Separately X for `/memory`, which is absent from the live
headless command list.

**afleet today.** `undesigned` — afleet's specs never mention `#` at all, and the router table
has no `#` anything. That is the right answer by silence rather than by decision: three
independent sources agree the memory mode does not exist (`tui-parity` §42.16.3 *"Do not build a
`#` memory affordance"*; the somersault clone's Wave C removed its own `#` memory mode as an
over-ship, owner decision D-C2; `spec-crosscheck-2026-09-03` L13, *"Confirmed and settled"*).
afleet does route `/memory` → `.memoryFiles`, opening the memory files in the Files tab, which is
the better answer anyway.

**GUI form.** Do not build a `#` memory affordance — record it here so nobody rediscovers the
idea. Build the Slack completer only if and when a Slack MCP server is a real afleet scenario;
it is a small, self-contained provider (one regex, one `mcp_call`, 10 rows, 150 ms) that reuses
the completion popover of C-24 and the MCP status afleet already reads for its `/mcp` popover. If
it is built, keep the live-input highlighting: it is the one part users see without opening a
menu.

**Drops / keeps / gains.** Drops: the memory mode that does not exist. Keeps: the option of the
Slack completer, exactly specified. Gains: none in v1.

**Open.** **For the owner:** is a Slack-connected MCP server a scenario afleet targets? If not,
this stays a documented non-feature.

### C-21 · `/` — the slash trigger

**Terminal.** `/` at offset 0 opens the command menu; a mid-line `/` produces **ghost text only**
and explicitly clears the menu (SPEC 42.16.4, 42.17.2). The predicate that decides whether a
leading `/` looks like a command accepts a name of `[a-zA-Z0-9.:\-_]` or an MCP prompt URL of the
shape `server:name://…`. The mid-line trigger requires whitespace or CJK punctuation before the
`/`, a non-empty partial, and the caret at the end of the partial run — which is why `src/foo`,
`and/or` and URLs are inert — and it is suppressed entirely when the line already begins with
`/add-dir`, `/cd`, `/resume`, `/plugin`, `/plugins` or `/marketplace`, because those take
arguments that legitimately contain slashes.

**Job.** Reach a command without leaving the field, and never mistake a path for one.

**Wire.** P for the menu's data — `initialize.commands`, 102 entries live — R for the trigger and
the filtering (`tui-parity` §42.16.4: *"The menu's data is on the wire. Rendering and filtering
are the GUI's"*). The GUI must render the CLI's list, not the TUI's: `/keybindings`, `/vim`,
`/focus`, `/terminal-setup`, `/btw`, `/memory` and `/rewind` are **absent** headless.

**afleet today.** `built`, minimally. `CommandRouting.swift:509` filters
`CommandRouter.autocomplete(handshake:systemInit:)` by literal case-sensitive `hasPrefix` on the
first space-delimited token, and `isCompleting` additionally requires that the draft contain no
space — so the menu closes the moment an argument begins. The candidate set is the local table
(27 rows) plus the handshake's commands plus `systemInit.slashCommands`, minus the engine's
terminal-only set, `.sorted()` lexicographically. There is **no mid-line trigger**, and none is
wanted: afleet's rule (token must be the whole first word) is stricter than canon's and cannot
fire on `src/foo`.

**GUI form.** Keep the leading-`/` rule and keep it strict. Add the argument phase canon has and
afleet drops: once a space is typed the menu should not vanish — it should become the argument
hint and, where the command declares completions, the argument list (C-29). Do **not** add the
mid-line trigger's *menu*; canon does not have one either. Do add the mid-line **ghost** only if
C-25's slash ghost is built, with canon's exact guard conditions, or it will fire inside every
path a user types.

**Drops / keeps / gains.** Drops: the MCP prompt-URL form (afleet has no MCP prompt commands in
v1), the six-name suppression set (which only exists to protect the mid-line trigger). Keeps: the
offset-0 rule, the name character class, the engine's list as the source of truth. Gains: nothing
yet — C-29 and C-30 carry the improvements.

**Open.** None.

### C-22 · The empty-prompt hint row

**Terminal.** Under the input, dimmed, the harness renders four teaching strings —
`! for shell mode` (`cli.pretty.js:507041`), `@ for file paths` (`:507051`), `/ for commands`
(`:507046`) and `/btw for side question` (`:507056`) — in the prompt's shortcut/help panel, shown
when `helpOpen` is true (SPEC 42.16.2). In bash mode the same row collapses to
`! for shell mode` in the `bashBorder` colour, unconditionally (`cli.pretty.js:506740`, C-17).
The row is the terminal's entire discovery mechanism for the four input modes.

**Job.** Teach the four sigils to someone who has never used them, without a tour.

**Wire.** R — pure presentation (`tui-parity` §42.16.2: *"Cheap onboarding; worth porting as
placeholder chips"*).

**afleet today.** `designed`, not built. The root spec's §8.1 wireframe draws a composer shortcut
bar reading `/ commands  @ files  ! shell`, and this study's region vocabulary lists it as part of
the composer. No code renders it: `ComposerField` is a bare `NSTextView` with **no placeholder
text at all**, and there is no hint row anywhere in `App/Composer/`. A new user sees an empty
rectangle.

**GUI form.** Composer region, one row above the field, dim, always present when the draft is
empty. Four chips, clickable — clicking inserts the sigil and opens the corresponding menu, which
is the affordance the terminal could only describe: `/ commands`, `@ files`, `! shell`,
`/btw side question`. Add the send hint at the trailing edge (`⏎ send`, and `⇧⏎ new line` on
first use), because Enter-versus-Shift-Enter is the one composer decision every user must learn
and afleet's own §8.5/§8.7 reconciliation shows it is not obvious. Collapse the row to the single
bash string plus the working directory while the draft starts with `!` (C-17), which is canon's
own behaviour. Hide the row once the draft is non-empty so it never competes with the text.
This is the highest ratio of user value to build cost in the lane: four labels and one placeholder.

**Drops / keeps / gains.** Drops: the `helpOpen` gate — afleet has room to show the row
permanently under an empty draft, which is when it is useful. Keeps: all four strings verbatim
and the bash-mode collapse. Gains: the chips are clickable, and the row can carry the send hint
`[exceeds]`.

**Open.** None.

---

## 4 · The autocomplete engine and its menu

### C-23 · Provider dispatch: eighteen branches whose order is the precedence

**Terminal.** Almost the whole engine is one hook re-run on every value change (SPEC 42.17.1).
Its store is `{suggestions, selectedSuggestion, suggestionType, commandArgumentHint}`, and
`suggestionType` — `none`, `command`, `file`, `directory`, `agent`, `slack-channel`, `emoji`,
`custom-title`, `shell` — is the discriminator that decides accept behaviour (C-27). Eighteen
branches run in a fixed order and **the order is the precedence**, but "first branch with
results" is not the rule: *terminal* branches (`/add-dir` and `/cd` arguments, `/resume <query>`,
custom-command argument completions) return whatever the outcome, clearing the menu when empty,
so typing `/add-dir ` and a non-matching fragment leaves the menu closed rather than falling back
to the slash menu; *fall-through* branches return only on a non-empty result, which is how a
path-like `@` token that matches nothing on disk still reaches the unified provider. The whole
engine is suppressed while reverse-searching or scrolling history.

**Job.** Decide, on every keystroke, which one of nine kinds of completion the user is asking for.

**Wire.** R — *"All of §42.17 is client-side. The only wire dependencies are the data sources"*
(`tui-parity` §42.17), with the warning that *"a GUI that runs providers concurrently and merges
will show different results. Reproduce the first-match-wins order."*

**afleet today.** `built` for two providers with no dispatcher between them.
`ComposerModel` exposes `isCompleting` (slash) and `isMentioning` (`@`) as independent booleans
computed from the draft; `ComposerView` renders whichever is true. There is no precedence rule, no
`suggestionType`, and no emoji, Slack, agent, resume, MCP-template, shell or argument provider.

**GUI form.** Introduce the discriminator even with two providers, because everything in C-27
hangs off it: one `completionKind` on the composer model, one popover (C-24), one accept path.
Order the branches canon's way for the ones afleet has — bash path before `@`, `@` explicit path
before `@` unified, slash menu before `@` — and keep the *terminal* branch behaviour for
argument completions when C-29 lands, or `/add-dir /nonexistent` will silently fall back to a
list of every command. Keep the suppression rule: while the history palette (C-34) is open, the
completion engine is off. Do not build the emoji provider — afleet has a system emoji picker and
`emojiCompletionEnabled` is a terminal convenience — and record that as a deliberate drop.

**Drops / keeps / gains.** Drops: the emoji menu and inline `:name:` replacement, the shell
completer, the MCP prompt-URL template stages, `dm-peer-` rows. Keeps: the ordered dispatch, the
type discriminator, the terminal-versus-fall-through distinction, the suppression rule. Gains:
none — this is plumbing that makes C-27 possible.

**Open.** None.

### C-24 · The completion menu

**Terminal.** The menu is a separate windowed list, not part of the message list (SPEC 41.15.8).
Its inline height budget is `max(1, min(max(6, floor(rows/2)), rows-3))`, and in the fullscreen
overlay exactly 5 display lines; the window is centred on the selection, growing backwards to half
the budget, then forwards, then backwards again for slack, and blank rows pad it to a constant
height so the prompt does not jump. Two row shapes: **compact** one-line `icon name – description`
for path-like ids (`file-`, `mcp-resource-`, `mcp-template`, `agent-`), with icons `+` for files,
a hollow diamond U+25C7 for MCP rows and `*` for agents; and **full two-column** rows for slash
commands, emoji, Slack channels, resume titles and command arguments, with a name column of
`min(maxColumnWidth ?? width+5, floor(columns × 0.4))`, then an optional `[tag] `, a
seven-column kind lane (gated off by default), an optional `[sourceTag] ` and the description.
Fuzzy-match spans are bold and undimmed. **Mouse hover overrides keyboard selection**, for both
the highlight and the accept. There is **no "N more" string and no header or footer row**; the
only empty state is the slash menu's `No commands match "<input>"` (SPEC 42.17.5, verified in
`cli.pretty.js:501116`).

**Job.** Show enough candidates to choose from without pushing the prompt off the screen.

**Wire.** T for the layout; the one behaviour `tui-parity` §42.17.5 says to keep is *"hover
overriding keyboard selection"*.

**afleet today.** `built`, one shape. Both `CommandCompletionView` and `FileMentionView` are a
`ScrollView` capped at `maxHeight: 180` over `.thinMaterial` with a 6 pt corner radius; command
rows are two lines (name in `.callout.monospaced()`, the local table's `explanation` in
`.caption`, absent for engine-only commands), mention rows are one monospaced line. No selection,
no highlight, no match bolding, no icons, no empty state.

**GUI form.** One popover component for every provider, anchored to the caret, `Escape` to
dismiss. Keep three canon behaviours: the two row shapes (compact for paths, two-column for
commands), **bold fuzzy-match spans** — which the somersault clone shipped and verified against
the bundle as `T_r`/`FIh` at 2.1.236, command rows only — and hover-overrides-selection, which is
native anyway. Keep the one empty-state string verbatim, `No commands match "<input>"`, and keep
the file provider's silence on empty (canon shows nothing rather than "no files", and with C-19's
async-index retry that silence is correct). Drop the height arithmetic: a popover has no row
budget and does not need padding to stop the prompt jumping. Add what the terminal cannot: icons
from `NSWorkspace` for file rows, and a description column that wraps rather than truncating at
60 columns `[exceeds]`.

**Drops / keeps / gains.** Drops: the height budget, the centring window, the blank padding, the
kind lane, ASCII icons. Keeps: the two row shapes, bold match spans, hover precedence, the empty
string. Gains: real file icons, no truncation, scrollable without a row budget `[exceeds]`.

**Open.** None.

### C-25 · Ghost text

**Terminal.** Two sources, chosen by mode (SPEC 42.17.3): in `prompt` mode the mid-line slash
completion (C-21), in `bash` mode a shell-history completion drawn from previously submitted `!`
lines — minimum two characters, corpus cached 60 000 ms, the 50-entry cap applying only to the
load so a long session's live cache can exceed it. Rendering is inside the text buffer and only
when the caret is at the absolute end of the last wrapped row: **the first grapheme of the ghost
is drawn as the inverted cursor cell and the remainder is dimmed**, and moving the caret hides it
because `insertPosition` must equal the cursor offset. **Ghost text is accepted by
`autocomplete:accept`, whose default binding is Tab — right-arrow does not accept**, and a user
who rebinds the action moves ghost acceptance with it. Accepting differs by mode: bash replaces
the whole line with no trailing space; prompt replaces the token with `/` + the full command
**plus one trailing space**.

**Job.** Finish the thing you are obviously typing, without a menu.

**Wire.** R (`tui-parity` §42.17.3: *"The inverted-first-grapheme trick is a terminal necessity;
a GUI can draw proper grey inline text"*, and *"Users may expect Right-arrow (shell convention);
accepting it would be a deliberate improvement"*).

**afleet today.** `built` — but from a **different source**. `App/Composer/GhostText.swift`
renders the engine's `prompt_suggestion` frame, gated on `promptSuggestionsEnabled` (default
false, a launch flag toggled by a quiescent restart from the header), shown **only when the draft
is empty**, drawn *under* the field as `Text(suggestion).lineLimit(2)` beside a literal `Tab`
label, and accepted by plain Tab (`ComposerKeyAction.forTab`, key code 48, any modifier passes
through). That is canon's **prompt suggestion** (C-28 duty 2), not canon's ghost text. afleet has
no slash ghost and no shell-history ghost.

**GUI form.** Keep afleet's prompt-suggestion ghost and move it **inline**: grey text continuing
the empty field, accepted by Tab, which is where a macOS user looks for it and what canon does
for its own ghost. Add the shell-history ghost — it is the higher-value of canon's two, because
`!` lines repeat and afleet's own `!` has no history at all today (C-32) — with canon's rules: two
characters minimum, prefix match, whole-line replacement, no trailing space. Add the slash ghost
only alongside C-21's guard conditions. One deliberate divergence: **accept with Right-arrow as
well as Tab**, which `tui-parity` names as a deliberate improvement and which every shell user
already has in their fingers; keep Tab as the primary so a terminal user is not surprised. Keep
the caret-at-end rule verbatim — it is why the ghost does not fight editing.

**Drops / keeps / gains.** Drops: the inverted-first-grapheme trick, the `insertPosition`
bookkeeping, the 60 s corpus cache's visibility. Keeps: caret-at-end, Tab accepts, per-mode
accept shapes. Gains: right-arrow acceptance, real grey inline text, and a ghost that can be two
lines `[exceeds]`.

**Open.** afleet's ghost source is a launch flag defaulting off, and the somersault clone's
crosscheck (finding L1) records that the `prompt_suggestion` emitter gate *"flipped to `!== false`
by 2.1.251"*, so the frame that was dead when the clone probed it is live now. Worth confirming
afleet's default-off is a product choice rather than an inherited verdict.

### C-26 · The unified `@` provider and what it hands the menu

**Terminal.** Branch 16 merges four sources for a non-empty query (SPEC 42.17.4): the file index
and the agent list in parallel, then MCP resources and resource templates. The non-file half is
ranked by a Fuse.js index (`threshold: 0.6`, weights `name` 3, `agentType` 3, `displayText` 2,
`uriTemplate` 2, `server` 1, `description` 1) with an explicit **+0.15 penalty for
`mcp_resource` rows**, and everything is sorted ascending on score, files entering that merge with
the file index's normalised rank score defaulting to `0.5`. For an **empty** query the provider
returns files, then MCP resources, then templates, then agents, capped at 15, with no Fuse index,
no penalty and no sort. Agent rows are labelled with the agent type followed by ` (agent)`. Caps
are 15 rows and descriptions clamped to 60 columns. Each row carries `id`, `displayText`,
`description?`, `tag`, `kind`, `sourceTag`, `color` and the match spans, and the `id` **prefix**
selects the compact row shape (C-24).

**Job.** Answer "@" with everything that can be attached, ranked as one list.

**Wire.** **D (partial)** and this is sharp: *"The merge is defined by the file score, and the
control response omits it… Workaround: assign files a synthetic score from their returned rank
(`i/n`), which reproduces the TUI's own normalisation exactly — the TUI's score is `rank/count`"*
(`tui-parity` §42.17.4, gap 5).

**afleet today.** `built` for files only. `FileMentions.swift` reads
`answer["suggestions"][].path` **in the engine's order** and its own comment records that `score`
*"is read by nothing … the CLI omits the field anyway"*. No agents, no MCP resources, no
templates, no `(agent)` labelling — and C6.2 scoped the merge out explicitly.

**GUI form.** Files-only is the right v1. When the merge is built, take `tui-parity`'s
`rank/count` reconstruction rather than inventing a score, keep the `+0.15` MCP-resource penalty
(it exists so a file beats a resource at equal fuzziness, which is the behaviour users expect),
keep the ` (agent)` suffix, and keep the empty-query ordering — files first, agents last —
because that ordering is what makes a bare `@` useful. afleet already has the agent list from
`initialize.agents` and MCP servers from `mcp_status`, so the data is in hand; only the ranking
is work.

**Drops / keeps / gains.** Drops: the 60-column description clamp, the `id`-prefix row-shape
trick (afleet can carry a real type field). Keeps: the four sources, the weights, the penalty, the
empty-query order, the 15 cap. Gains: type-tagged rows instead of prefix-sniffed ids `[exceeds]`.

**Open.** None.

### C-27 · Accept semantics: Tab, Enter and click are three different things

**Terminal.** Three entry points, and they deliberately differ (SPEC 42.17.6). **Tab** (the
default binding for `autocomplete:accept`) is always `shouldExecute: false` — it fills, never
runs — resolving the row as hovered, else keyboard-selected, else row 0. **Enter** is
`shouldExecute: true`, and **with nothing resolved it dismisses the menu and submits the line as
typed** — but only for the four `suggestionType`s `command`, `custom-title`, `file` and
`slack-channel`; any other type neither accepts nor submits. **Click** is an Enter with an
explicit index, so clicking a slash-command row *fills without running it* while Enter on the same
row runs it. The three diverge again per provider: the `file` provider does
**longest-common-prefix completion first**, so with exactly one match the first Tab inserts the
prefix bare and **a second Tab adds the closer**, while a click completes the row outright; all
three `directory` origins differ, with Enter on a bash-path menu inserting nothing and submitting
the line unchanged. Selection is preserved across re-queries by id and defaults to row 0 —
**except** `file`, `slack-channel`, `custom-title` and MCP templates, which deliberately start
with **nothing selected**. Paths containing a space are wrapped in double quotes with no
backslash escaping and no escaping of an embedded quote; the trailing space is added only when the
completion is final.

**Job.** Let the same three keys mean fill, run and choose, without the user thinking about it.

**Wire.** R, and `tui-parity` ranks it **gap 14**: *"Autocomplete accept semantics are quietly
load-bearing… Get these wrong and the GUI feels subtly broken to anyone coming from the
terminal."* Its own note on the file menu is blunt: *"with a file menu open, Enter submits rather
than accepting."*

**afleet today.** `undesigned`. There is no selection to resolve: both lists are click-only,
Tab is spent entirely on ghost text (`ComposerKeyAction.forTab` returns `.acceptGhost` or
`.pass`), and Enter goes straight to `send()`. Clicking a command row sets `draft = name + " "`,
which — because `isCompleting` requires the draft to contain no space — dismisses the list as a
side effect. Enter on `/mod` sends the literal text `/mod`, which the router falls through as a
prompt; canon would have completed it.

**GUI form.** Implement all three verbs, verbatim where canon is deliberate. **Tab fills, never
executes** — including on a slash command, so a user can Tab `/model` and then type the argument.
**Enter with a selection accepts and, for a slash command, runs it**; Enter with nothing selected
dismisses and submits the line as typed, for the same four kinds. **Click fills without running**,
which is the native expectation anyway (a click is a pointing gesture, not a commitment) and
matches canon exactly. Keep the two starts-with-nothing-selected menus (files and any
title-search), because they are what make Enter-submits-the-line safe. Keep the `@` two-Tab rule:
longest-common-prefix first, and only then the row — `tui-parity` calls it *"Classic shell
behaviour; users will notice its absence"*, and the somersault clone's own scorecard marks its
absence as *"an honest downgrade"*. Fix one canon defect rather than porting it: quote **and
escape** embedded quotes in a path, since canon's `xwe` does neither and a file named `a"b.txt`
produces a broken mention.

**Drops / keeps / gains.** Drops: the `dm-peer-` special case, the three `directory`-origin
divergences (afleet has one path provider), `shouldExecute` plumbing. Keeps: Tab-fills,
Enter-submits-when-nothing-selected for four kinds, click-fills-without-running, the two-Tab `@`
rule, nothing-selected defaults. Gains: correct quoting `[exceeds]`.

**Open.** **For the owner:** Tab is also macOS's focus-traversal key. Canon's Tab is spent on
completion whenever a menu or ghost is up, which is the right call inside the composer, but it
means Tab never leaves the field there. Confirm that is acceptable before it ships.

### C-28 · Tab's other duties, and async behaviour

**Terminal.** Tab's precedence in the prompt (SPEC 42.17.7): (1) menu or ghost present →
`autocomplete:accept`; (2) empty input with a pending prompt suggestion → accept the starter
prompt; (3) empty or whitespace input → a 3000 ms hint naming the `chat:thinkingToggle` chord,
`Use ${chord} to toggle thinking` (verified in `cli.pretty.js:501476`); (4) otherwise nothing —
the text buffer never consumes Tab. The `Autocomplete` context activates exactly when there are
suggestions **or** ghost text; `ctrl+n`/`ctrl+p` also move the selection, hand-wired rather than
bound. Submission is blocked while a menu is up unless the submit callback's second argument
bypasses it or **every row is a directory row** (a row counts as a directory purely by its
`description` string). Async (SPEC 42.17.8): all debounces are trailing-edge — files/`@` 50 ms,
Slack 150 ms, MCP templates 150 ms, everything else undebounced; minimum query lengths are 2 after
`:`, 2 for the bash ghost, 1 for the mid-line `/` ghost, 1 after `#`. **There is no loading
spinner.** Race guards are per provider, and the `/add-dir`/`/cd` branch has **none** — a slow
directory listing can overwrite the menu after the user has typed on.

**Job.** Keep one key useful in four situations, and keep a slow answer from overwriting a fast
one.

**Wire.** R, with one changed constraint `tui-parity` §42.17.8 flags: *"the 50 ms file debounce
now guards a control round-trip, not an in-process call… Latency is the GUI's new problem:
consider raising the debounce or showing an inline spinner."*

**afleet today.** `built` for duty 2 and the debounce. Tab accepts the prompt suggestion when one
is showing and otherwise inserts a tab character (AppKit's default, since `forTab` returns
`.pass`). `FileMentions.draftDidChange()` debounces **120 ms** — already raised above canon's
50 ms, for exactly the round-trip reason — and cancels the in-flight task per keystroke, which is
the race guard canon lacks in one branch. No thinking-toggle hint, no `ctrl+n`/`ctrl+p`, no
submission block while a menu is up.

**GUI form.** Order Tab's duties canon's way once C-27 lands: menu → ghost → prompt suggestion →
nothing. Keep 120 ms and keep the cancel-per-keystroke guard; add the one thing canon refuses,
**a spinner in the popover** when a query has been in flight past ~250 ms `[exceeds]`, because the
wire round-trip makes silence ambiguous in a way it was not in-process. Add the submission block
while a menu is up — without it, Enter can submit a half-typed mention — with canon's own escape
hatch (an accept path may submit through its own call). Do not port the directory-row exception:
it keys on a description string, which is an implementation accident. Drop the thinking-toggle
hint; afleet's thinking control lives in the header, not behind a chord.

**Drops / keeps / gains.** Drops: the thinking-toggle hint, the directory-row submit exception,
`ctrl+n`/`ctrl+p`. Keeps: the duty order, trailing-edge debounce, per-query cancellation, the
submit block. Gains: a spinner, and a debounce tuned for a round trip rather than a function call
`[exceeds]`.

**Open.** None.

### C-29 · Slash-command rows, argument hints and argument completions

**Terminal.** A row is `/` + display name, plus ` (alias)` when an alias matched, a `tag` of
`dynamic workflow` for workflow prompts, and a description that carries its provenance —
`(plugin)`, `(claude.ai sync)`, or a source label from `userSettings` → `user`,
`projectSettings` → `project`, `localSettings` → `project, gitignored`, `flagSettings` →
`cli flag`, `policySettings` → `managed` — with ` (arguments: a, b)` appended when the command
declares `argNames` (SPEC 28 §21.4). The name column is the widest command name plus 6. Once the
input contains a space (SPEC 28 §21.5), a resolved command's `getArgumentCompletions` takes
precedence over every static hint, is called with `(completedArgs, partialArg, ctx)`, returns at
most **12** rows and returns even when empty, clearing the list. Only when that callback is absent
does the static hint show: the command's `argumentHint` inline with the list cleared, or the
remaining positional names as `[name] [name]`. `/resume <query>` searches session titles and
offers up to 10; `/add-dir` and `/cd` switch to directory completion.

**Job.** Say what a command does, where it came from, and what it wants next.

**Wire.** P for the data — `initialize.commands` carries `name`, `description`, `argumentHint`
and `aliases` — R for the rendering.

**afleet today.** `built`, thin. A row is the name in monospace plus, when the local table knows
it, that table's own `explanation` sentence; an engine-only command shows the name alone.
`LocalCommand` has four fields (`name`, `strategy`, `readback`, `explanation`) and the repo has
**no `argumentHint`, `alias` or `usageHint` anywhere** — the handshake carries `argumentHint` and
afleet drops it. The list closes as soon as a space is typed, so no argument phase exists at all.

**GUI form.** Two-line rows: name, then description. Take the description from the handshake for
engine commands and from `RouterTable.explanation` for local ones — afleet's sentences are better
copy than canon's and they are the router's single source (C6.2's X10 rule), so keep them.
**Show provenance**, using canon's own labels: a `[project]`, `[user]` or `[managed]` chip, which
matters more in afleet than in the terminal because a channel can be in a repo the user did not
write. Then build the argument phase: on the first space, replace the list with the command's
`argumentHint` rendered dim inline after the text, exactly canon's placement; where afleet knows
the argument set locally — `/permissions <mode>`, `/effort <level>`, `/model <name>`, all of which
the pickers already enumerate — offer them as rows, capped at 12 like canon. That turns three of
afleet's most-used routed commands from "type it right" into "pick it".

**Drops / keeps / gains.** Drops: the `dynamic workflow` tag, the alias suffix, the fixed name
column. Keeps: name + description + provenance, the argument hint's placement and precedence, the
12-row cap. Gains: argument *rows* for the commands whose values afleet already knows `[exceeds]`.

**Open.** None.

### C-30 · Slash-command ranking

**Terminal.** With an empty query (SPEC 28 §21.2) the list is: up to **5 recency picks** —
`prompt` commands scored by usage with a **seven-day half-life and a 0.1 floor**, every
zero-scoring command discarded, so a fresh install shows none — then five alphabetically sorted
buckets: locals; `prompt` from user/local settings; from project settings; from policy settings;
everything else. Usage is recorded at most once per 60 000 ms per command. With a query
(§21.3) a Fuse.js index (`threshold: 0.3`, weights `commandName` 3, `displayName` 2, split-part
and alias keys 2, `displayPartKey` 1, `descriptionKey` 0.5) is sorted by: exact name match, exact
alias match, name prefix (shorter first), alias prefix (shorter first), Fuse score **quantised to
`floor(score × 10)`**, then usage boost descending — so the coarse quantisation is what lets
recency break ties. Hidden commands are reachable by typing an exact name.

**Job.** Put the command the user actually wants first, which is usually the one they used
yesterday.

**Wire.** R — the ordering is entirely client-side; only the command list is on the wire.

**afleet today.** `built` as `.sorted()`. `CommandRouter.autocomplete` returns a lexicographic
sort of a `Set`, filtered by case-sensitive `hasPrefix`. So `/c` lists `/cd`, `/clear`, `/color`,
`/compact`, `/config`, `/context`, `/cost` in alphabetical order forever, and typing `/Model`
matches nothing.

**GUI form.** Three changes, none of them large. (a) **Case-insensitive prefix matching**, then
canon's tie-break ladder: exact, prefix-shortest-first, fuzzy, recency. (b) **Usage recency with
canon's decay** — a seven-day half-life, a 0.1 floor, at most one record per minute per command,
capped at five picks and empty on a fresh install. afleet has a store of its own for this
(the app's own preferences, not `<configHome>`, which §7.8 forbids writing). (c) **Locals first
within equal score**, which afleet's `.sorted()` loses today and which matters because the local
27 are the ones with native destinations. Keep the empty-query bucket order otherwise. Show the
recency group visually separated `[exceeds]` — the terminal concatenates and hopes the user
notices.

**Drops / keeps / gains.** Drops: the Fuse quantisation trick (a GUI can sort on a real score),
hidden-command-by-exact-name (afleet has no hidden commands). Keeps: the half-life, the floor, the
five-pick cap, the bucket order, the tie-break ladder. Gains: a visible "recent" group `[exceeds]`.

**Open.** Where does the usage record live? Not under `<configHome>` (§7.8). afleet's own store
is the answer, at the cost of not sharing recency with the terminal.

### C-31 · File suggestions and the file index

**Terminal.** `generateFileSuggestions(cache, query, showOnEmpty, storageV5)` short-circuits to
the control channel in a cloud session, returns `[]` on an empty query unless `showOnEmpty`, hands
off entirely to a `fileSuggestion: {type: "command"}` helper when one is configured, answers `""`,
`"."` and `"./"` with a plain `readdir` of the cwd (directories carrying a trailing separator),
kicks a background refresh, strips a leading `./`, expands `~`, and searches the index for at most
**15** results (SPEC 42.18.1). Scoring (42.18.2) is 16 points per matched character, +8 after a
separator, +6 at a camelCase boundary, +4 adjacent, +8 at position 0, −3 per gap opened, −1 per
skipped character, plus up to 32 for a short path — with **smart case** (any uppercase makes the
match case-sensitive) and **no exact-prefix special case**, so ranking is emergent, not
prefix-first. The index is a process-level in-memory singleton with **no disk persistence**, built
from `git ls-files --recurse-submodules`, an untracked pass, `.claude` markdown and a ripgrep
fallback; ignore rules are an in-process, **fail-open** matcher reading only `.ignore` and
`.rgignore`, with `.gitignore` honoured indirectly. Refresh is demand-driven: 5000 ms minimum when
`.git/index` is unchanged, bypassed when its mtime changes, and — the trap — **in a non-git
directory a previous scan over 1000 ms suppresses further refreshes** until something resets the
cache. `respectGitignore` has a `/config` row; there is **no setting or environment variable that
bounds the index size and none that disables the `@` picker**.

**Job.** Answer `@` from the same set of files the terminal would, in the same order.

**Wire.** **P with three caveats** (`tui-parity` §42.18.1, and gap 5): the headless handler calls
the identical function, but `showOnEmpty` is hardcoded true, the **`score` field is dropped**, and
there is **no `indexBuildComplete` signal**, so an early query silently returns partial-index
results and nothing tells the host to retry.

**afleet today.** `built` by delegation, which is the right call — `FileMentions` asks the engine
and reads no directory itself, so afleet inherits the index, the ignore rules, a user's
`fileSuggestion` helper and the `respectGitignore` setting for free. It inherits the traps too:
the partial-index empty answer (C-19), and the non-git never-refresh rule, which in afleet means a
channel opened outside a repo can have a permanently stale picker with nothing on the wire to
reset it but `/clear`.

**GUI form.** Keep delegating. Add the two host-side compensations the wire forces: **retry once
the index is likely built** (a short backoff on an empty first answer, since there is no signal),
and **reconstruct the score as `rank/count`** when the unified merge of C-26 arrives. Surface the
`respectGitignore` setting in afleet's own settings pane, since it changes what `@` can see and
canon hides it behind `/config`. Do not build a second index: `tui-parity` warns that *"A GUI
building its own picker must not 'improve' this — divergence would confuse users comparing with
the terminal"*, and the somersault clone's crosscheck (unknown unknown 3) records exactly what
divergence cost it — a 1000-entry `readdir` that skipped every dotfile and could not complete
`.claude/agents/foo.md`.

**Drops / keeps / gains.** Drops: the whole client-side index, the scoring function, the walk,
the ignore loader, the refresh policy — all inherited rather than rebuilt. Keeps: the 15 cap, the
engine's order, the semantics users see. Gains: a settings row for `respectGitignore`, and no
second index to disagree with the first `[exceeds]`.

**Open.** The non-git stale-index trap has no wire reset. Is a periodic `/clear`-free remedy
possible, or does afleet document it?

---

## 5 · Prompt history

### C-32 · Up and Down: recalling a prompt

**Terminal.** `up` and `down` are declared as `history:previous`/`history:next` but **no
component registers a handler for either** — the behaviour lives in the editor's own key
handling, so rebinding those actions removes the default without moving the behaviour
(SPEC 42.19.3). Up recalls only when the caret is on **visual row 0** (the wrapped row, not the
logical line) and Down mirrors it on the last visual row; `up`/`down` with `shift`, `ctrl` or
`meta` are ignored outright. Above that sits the chat's own order: more than one autocomplete
suggestion showing swallows the key; a caret past the first logical newline swallows it; a queue
holding editable commands pulls **all** of them into the draft instead (C-38); only then does
history run. **There is no prefix search**: the only filter is the submit mode, captured on the
first Up, so a draft starting with `!` restricts navigation to bash entries. The original draft is
saved once, on the first Up out of index 0 and only when non-blank; each recalled entry keeps its
own edit map; recalling upward puts the caret at the **end**, restoring the draft puts it at
offset **0**; entries load in pages of 10 and recalled pastes are re-minted with fresh ids.
After the **second** Up in a session a 5000 ms hint names the `history:search` chord with the
description `search history` (verified in `cli.pretty.js:507924`).

**Job.** Send the thing you sent yesterday, or the thing you sent thirty seconds ago with one
word changed.

**Wire.** R — the file is on disk, not on the wire. `tui-parity` §42.19.3 adds a judgement worth
carrying: the no-handler quirk is *"A faithful GUI should not replicate this quirk"*, and
*"A GUI adding prefix search would exceed the TUI; users coming from the terminal will not expect
it."*

**afleet today.** `undesigned`, and further from the spec than the spec thinks. Root spec §13
says `history.jsonl` is *"read for seeding the composer history only"* — but there is **no
composer history to seed**: `↑`/`↓` are handled in exactly two places in the app
(`App/Views/QuickSwitcherView.swift`, and the Browser panel), **zero in `App/Composer/`**, and
`historyStore`, `promptHistory`, `commandHistory` and `inputHistory` have zero hits repo-wide.
Pressing Up in afleet's composer moves the caret and nothing else.

**GUI form.** Composer region. Bind `↑` on the first visual line to *previous prompt* and `↓` on
the last to *next*, which is canon's rule and also what every native shell-adjacent field does;
keep the modifier exclusion (a shifted arrow is a selection). Keep the draft-stash rule verbatim —
the first Up saves the live draft, the walk past the newest entry restores it with the caret at
offset 0 — because losing a half-written prompt to an arrow key is the failure this rule exists to
prevent. Keep the per-entry edit map: a user who edits a recalled prompt, walks away and walks
back should find their edit. Keep the bash-mode filter (a draft starting with `!` walks `!`
entries). **Do not add prefix search**; put search behind the palette of C-34 instead, which is
where a terminal user expects it and where a GUI can do it properly. Scope: canon's Up/Down is
always **project-scoped**, so afleet's should be per project section, not per channel — two
channels in one repo share one history, which is what the terminal does and what a user expects.

**Drops / keeps / gains.** Drops: the no-handler quirk, the visual-row-versus-logical-line
subtlety where a GUI's field disagrees, the page size of 10, the discovery hint. Keeps: caret-row
gating, the draft stash, the edit map, the mode filter, project scope, no prefix search. Gains:
history in a window that can also show it as a list `[exceeds]`.

**Open.** None.

### C-33 · `~/.claude/history.jsonl`, the store, and the interop question

**Terminal.** One **global** newline-delimited file at the user config directory joined with
`history.jsonl`; project and session are *fields*, not directories (SPEC 42.19.1). The record is
`{display, pastedContents, timestamp, project, sessionId?}`, where `display` is the prompt exactly
as the input showed it — **placeholders intact, a bash line keeping its leading `!`** — and each
line is appended at mode `0o600` under a file lock. Pasted content ≤ 1024 characters is inlined
and anything longer is content-addressed into the paste cache (C-14); **images and audio are never
written**, and on recall resolve to unavailable. The read cap is 100 per project though the file
itself is uncapped. Writes are suppressed by `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, by sensitive
slash commands, and by a secret scan over 65 536-byte windows. The entry is built at submit but
**written when the prompt is actually dispatched**, so a queued prompt enters history only when
the queue drains.

**Job.** One history, shared by every session on the machine, that survives restarts.

**Wire.** R, and `tui-parity` §42.19.1 is emphatic: *"The GUI must both read (to show history) and
write (so the terminal and the GUI share one history). Writing is the part that is easy to skip
and shouldn't be."* It also supplies the write-timing trick: gate the write on
`command_lifecycle: started` for the frame's uuid and the semantics match exactly.

**afleet today.** `designed` in one sentence and built in none. Root spec §13: *"`history.jsonl`
is read for seeding the composer history only, never written; print sessions neither read nor
write it."* No Swift file reads or writes the path — every occurrence in the repo is a test
allowlist, a fake-CLI fixture or documentation prose.

**GUI form.** Read it, and — this is the recommendation — **write it**, with three caveats.
Reading is straightforward and unlocks C-32 and C-34 immediately: parse the global file, filter to
the channel's project key, take the newest 100. Writing is what keeps the two apps one product: a
user who types in afleet and then opens the same project in a terminal should press Up and find
their prompt. To write it faithfully afleet must reproduce (a) the record shape including the
placeholder form of any paste chip (C-11) and the ≤ 1024-character inline / content-hash split
into `~/.claude/paste-cache/`; (b) the suppressions — `CLAUDE_CODE_SKIP_PROMPT_HISTORY`,
sensitive commands, and the secret scan, which `tui-parity` warns about directly: *"Skipping the
secret scan would write credentials to a shared file — do not"*; and (c) the dispatch-time write,
gated on `command_lifecycle: started`, so a cancelled queued prompt never lands.

**The blocker is afleet's own rule.** Root spec §7.8: *"The app never writes to `<configHome>`;
every mutation goes through the CLI or the control channel"*, and §12 repeats it — *"Nothing under
`<configHome>` is written by afleet"* — with acceptance item 35 enforcing it by `fswatch`. There
is no control request that appends a history entry, so faithful history interop and the never-write
rule are in direct conflict. Three ways out, for the owner: carve a second exception (the first is
the project's `.claude/settings.local.json`, §6.12); keep a separate afleet-only history and accept
that the two apps diverge; or ask for a wire route.

**Drops / keeps / gains.** Drops: the file lock (afleet would need its own), the `0o600` detail
only if a second store is chosen. Keeps: the record shape, the project field, the read cap, the
suppressions, dispatch-time writing. Gains: history that is visible as a list rather than only
walkable `[exceeds]` — if the write question is answered.

**Open.** **For the owner, and it decides C-32 and C-34:** does `history.jsonl` get an exception
to §7.8, or does afleet keep its own history and let the two apps diverge? Note the asymmetry —
afleet can *read* the terminal's history under the current rule, so the cheap half works today;
only the sharing is blocked.

### C-34 · `ctrl+r` — reverse search and the history picker

**Terminal.** Two implementations, chosen by whether the fullscreen renderer is active
(SPEC 42.19.4). **Inline reverse-i-search** is a case-insensitive **substring** search using
`lastIndexOf`, scanning newest-first over the *entire* file with no scope, skipping
content-identical repeats, with no fuzzy tier; the caret is parked at the match offset. `ctrl+r`
advances to the next older match, `escape`/`tab` accept and exit, `ctrl+c` restores the pre-search
snapshot, `enter` submits the match immediately, and Backspace on an empty query cancels. Its
label is `search prompts:` or, with no match, `no matching prompt:` (verified in
`cli.pretty.js:506365`). **The fullscreen picker** adds scope cycling on `ctrl+s` —
`session → project → everywhere`, **defaulting to `everywhere`** — matches substring first and
then, once the scan completes, an in-order subsequence tier, and budgets the scan at 16 777 216
charged as `textLength + 256` per entry in UTF-16 code units, so a content-hashed paste body
contributes nothing. It renders 100 entries immediately with the batch quadrupling, 6 preview
rows and an 8-column timestamp. Its title is `Search prompts · <scope>` with ` · newest N only`
appended when the scan truncated, its filter placeholder is `Filter history…`, and its empty
states are `Loading…`, `Couldn't read prompt history`, `Searching older prompts…`, `No history
yet` and `No matching prompts`. In a cloud session it is refused: `History search isn't available
in cloud sessions yet`.

**Job.** Find a prompt you wrote days ago without walking there one Up at a time.

**Wire.** R (`tui-parity` §42.19.4: *"A native table view with live filtering exceeds this
easily"*; the cloud refusal is T, and *"the file is local either way, so the GUI can offer it
where the TUI cannot"*).

**afleet today.** `undesigned` — grepping `reverseSearch`, `ctrl-r` and `ctrl+r` across the Swift
sources returns nothing.

**GUI form.** Build the picker, not the inline search. One surface — a **history palette**, the
same shape as the Cmd+K quick switcher afleet already has, opened from `Go ▸ Search prompt
history…` with `⌘⇧R` — beats two surfaces chosen by a renderer mode that afleet does not have.
Keep from the picker: the three scopes with `everywhere` as default (a cycle control or a
segmented picker, either is fine), substring matching first and a subsequence tier second, the
6-row preview, the timestamp column, the title with its scope, and every empty-state string
verbatim; they are precise and afleet has no better copy. Keep from the inline search exactly one
rule: **Enter submits the match immediately** — that is what makes `ctrl+r` fast, and a palette
that merely fills the field loses it. Add a modifier for "put it in the field instead of sending
it" (`⌘⏎`), which the terminal has no room for. Bind `⌃R` as a second accelerator so a terminal
user's fingers work. Drop the scan budget: a native table can load lazily, and the truncation
suffix ` · newest N only` exists only because the terminal had to stop reading.

**Drops / keeps / gains.** Drops: the inline surface, the caret-parking, the scan budget and its
truncation suffix, the cloud refusal, the vim-only second hint line. Keeps: the scopes and their
default, both match tiers, the preview, the timestamps, every empty-state string, Enter-submits.
Gains: live filtering over a real list, a second verb (fill instead of send), and search where the
terminal offers only in a fullscreen renderer `[exceeds]`.

**Open.** Depends entirely on C-33: with no history reader there is nothing to search.

---

## 6 · Submitting, queueing and steering

### C-35 · Why `enter` is special

**Terminal.** `enter` is bound to `chat:submit` in the `Chat` context, but the handler is
registered **conditionally** (SPEC 42.20.1): while `enter` still resolves to `chat:submit` — the
default — it is registered with `singleKey: false`, so the dispatcher's single-key pass skips it
and the key falls through to the editor, whose `return` handler chooses between newline and submit
(C-08). If the user rebinds `chat:submit` to another chord, `singleKey` flips true and the
dispatcher fires the handler directly. This is the general mechanism for *a key the editor must
see unless the user moved the action*.

**Job.** Let one key be both "insert a line" and "send", decided by context, without the
keybinding layer stealing it.

**Wire.** P for the submission itself — a `user` frame that **must** stamp
`origin: {kind: "human"}`, since *"an absent origin fails closed at strict `isHuman()` gates"*
(`tui-parity` §42.6.3) — R for the key.

**afleet today.** `built` and simpler, because AppKit has no keybinding layer to negotiate with.
`ComposerKeyAction.forReturn` is a pure function over key code and modifiers: Shift+Return →
`.newline`, bare Return and Cmd+Return → `.send`, anything else → `.pass`;
`ComposerField.keyDown` short-circuits on `hasMarkedText()` first. Root spec §6.6 stamps the human
origin. The draft is cleared only when the send returns without throwing — *"a composer that eats
a message on a refusal has lost the user's words"* (C6.2) — which is a rule canon does not state
and afleet should keep.

**GUI form.** Keep exactly as built. The one thing to carry forward from canon is the *principle*
behind `singleKey: false`: when afleet honours a user's `keybindings.json` (C-59), a user who has
moved `chat:submit` to another chord must find Enter reverting to a plain newline — otherwise
their file half-works. That is one line of logic in the resolver and it is the only part of this
mechanism worth reproducing.

**Drops / keeps / gains.** Drops: `singleKey`, the dispatcher pass, the fall-through. Keeps:
Enter sends, Shift+Enter newlines, Cmd+Enter sends, the human origin stamp, draft preservation on
refusal. Gains: the IME guard `[exceeds]`.

**Open.** None.

### C-36 · Queueing during a turn

**Terminal.** Submitting while a turn is active does not start a second turn; it appends to a
queue (SPEC 42.20.2). Only `prompt` and `bash` modes are queueable — anything else records
`prompt_queued` → `mode_not_queueable` and is refused. On queueing the input is cleared
completely: value, cursor, `pastedContents`, history navigation **and the undo buffer**. The queue
is an array with priorities `now: 0, next: 1, later: 2`; user prompts default to `next` and task
notifications to `later`. **There is no maximum queue size for user prompts** (the caps are on
peer messages — a configured value defaulting to 50, validated into [10, 5000] — and 1000 poll
events). A hook may drop a queued prompt during screening, reported as `Prompt dropped by a hook`.

**Job.** Let the user keep typing at the speed of thought while the agent is working.

**Wire.** P — *"Submitting during a turn queues, it does not steer"*, and the queue is visible
through `command_lifecycle` `queued`→`started`→`completed`. One rule from `tui-parity` §42.20.2:
*"Frames without a `uuid` emit no lifecycle events — always stamp a uuid."*

**afleet today.** `built`, engine-side. afleet does not decide to queue: it sends, and the engine
queues; the chip then renders `timeline.overlay.queue.queued` out of the channel's one fold
(C6.2's X4 rule — *"the ingestion holds the channel's only reducer, and nothing in the app folds
the wire"*). The field is cleared on a successful send. C6.2's own gate audit flags that the
chip's central clause — chip *iff* a turn was running — has no test and *"may not be reachable:
the chip is fold-only and the queueing decision is the engine's."*

**GUI form.** Keep the fold-only architecture; it is why afleet's queue cannot disagree with the
engine's. Add the one state the terminal makes obvious and afleet does not: **say, at submit time,
that this message is queued rather than sent.** The terminal's user watches their prompt appear as
a dimmed row above the input; afleet's user watches the field empty and a count increment
somewhere else. A one-line transition — the sent text animating into the queue strip of C-37 — is
the whole fix. Keep the clear-everything-on-queue rule for the field (afleet already clears text
and attachments; undo should follow, per C-05). Drop the mode gate: afleet's `!` is host-side and
never queues.

**Drops / keeps / gains.** Drops: the mode-not-queueable refusal, the priority enum (afleet sends
one priority), the peer and poll caps. Keeps: unbounded user queue, full input clear, uuid
stamping, the hook-drop notice. Gains: a visible transition from draft to queue `[exceeds]`.

**Open.** None.

### C-37 · Rendering the queue

**Terminal.** Queued prompts render as **read-only user-message rows just above the input**,
marked `isQueued`, which dims the row and swaps the accessibility label between `you:` and
`selected:` (SPEC 42.20.3). While the queue is non-empty and the input empty, a placeholder hint
tells the user what they can do with it; the four forms are gate-dependent and were verified in
the binary: `Press up to select a queued message to edit, or Enter to send them now` and
`Press up to edit queued messages, Enter to send them immediately` (`cli.pretty.js:509734`), and
`Press up to select a queued message, then Enter to edit it` and `Press up to edit queued
messages` (`:509736`).

**Job.** Show the user everything they have typed ahead, in the order it will run, in the words
they typed.

**Wire.** P — *"The GUI has everything it needs to render a live queue"*, with the ordering
caveat that a command starting a fresh turn emits `completed` **after** that turn's `result`,
while one folded into an in-flight turn emits it **before** (`tui-parity` §42.20.3).

**afleet today.** `built`, and this is the lane's largest single loss. `QueueChipView` draws
`\(model.rows.count) message(s) queued` in `.caption`, then one row per entry — a `clock` icon
plus the label resolved by matching the queued command uuid against the timeline's user messages,
falling back to the literal `Queued` when no item exists yet — and a `Cancel` button. Nothing
else: no full text, no ordering affordance, no indication that several entries will run as one
turn. C6.2's reasoning for the label lookup is sound (*"a queued message the user cannot see is
worse than an unlabelled one"*) and the pre-echo preview was scoped out deliberately as a parent
decision (tracker 154).

**GUI form.** Composer region, directly above the field: a **queue strip** of read-only rows,
one per entry, each showing the prompt's first line in the user-message row style with a dim
treatment — the terminal's `isQueued` rendering, translated. Each row carries a hover `×`
(cancel, C-38) and a `⋯` menu (*Edit*, *Send now*). Group rows that will drain together as one
turn behind a single left rule with a `will run as one turn` caption `[exceeds]`, which is
information canon has (C-39) and never shows. Keep the accessibility swap: a queued row reads
`queued:` rather than `you:`. Replace the four placeholder hints with affordances — a hint that
says "press up to edit" exists because the terminal has no other way to say it; a row with a menu
does not need it.

```
│ ⋮ queued · will run as one turn                                             │
│ │ run the failing test again with -v                              ⋯   ×    │
│ │ then summarise what changed                                     ⋯   ×    │
│ ╭────────────────────────────────────────────────────────────────────────╮ │
│ │ _                                                                      │ │
│ ╰────────────────────────────────────────────────────────────────────────╯ │
```

**Drops / keeps / gains.** Drops: all four placeholder hint strings, the `selected:` label form
(afleet has real selection). Keeps: read-only dimmed rows above the input, the user's own words,
queue order, the accessibility distinction. Gains: per-row actions, the batch grouping made
visible, and full text on hover `[exceeds]`.

**Open.** How much of a long prompt does a row show? One line with a tooltip is the cheap answer;
two lines with a fade reads better.

### C-38 · Editing the queue: pull-back, per-entry selection, cancel

**Terminal.** Two store operations pull entries back (SPEC 42.20.3). `popAllEditable` joins every
editable queued command with the current draft using newlines, re-mints colliding paste ids,
recomputes the cursor and removes the popped entries — with two filters: a **non-empty draft
excludes bash entries outright**, and the popped set's mode collapses to `bash` only if every
admitted entry was bash, otherwise the mode is `prompt` and bash entries are filtered out and left
queued. So an empty draft with `[prompt, bash, prompt]` pulls back the two prompts and leaves the
bash entry. `popEditableAt(index)` does the same for one. Pull-back is reachable from Up with a
non-empty queue, from Escape with a non-empty queue, and from the cancel path. With
`CLAUDE_CODE_KB_COHESION_FIXES`, Up and Down instead walk a `queueEditIndex` and Enter pulls the
selected entry, emitting `Clear the input to edit this queued shell command` when the draft is not
empty (verified in `cli.pretty.js:510253`).

**Job.** Change your mind about something you typed ahead, without losing it.

**Wire.** R, with the decomposition already worked out: *"'pull back to edit' = cancel +
re-send"* via `cancel_async_message {message_uuid}` and a fresh `user` frame — and the catch
that *"the lifecycle frame cannot distinguish a user-requested cancel from a swept one"*, so the
host must correlate against its own cancel responses and any `interrupt` receipt's `cancelled`
list before resending (`tui-parity` §42.20.3, gap 7).

**afleet today.** `built` for cancel, `undesigned` for edit. Cancel sends the raw
`AnyControlRequest(subtype: "cancel_async_message", payload: ["message_uuid": …])` — the leaf's
only raw request — with **no optimistic removal**: a row leaves only when `command_lifecycle` says
the id left the queue. `{cancelled: true}` additionally raises `HostSignal.promptCancelled(uuid:)`
so the fold drops the uuid; `{cancelled: false}` means *the message was not in the queue* and
shows nothing, which is the right reading of the engine's own schema note. Two refusal sentences
exist for a throw: `The message was not cancelled — <blocker>; it is still queued.` and
`The message was not cancelled; it is still queued.` There is no edit, no reorder, no pull-back.

**GUI form.** Build *Edit* on the cancel path afleet already has: cancel the entry, wait for the
lifecycle confirmation (not optimistically — keep that rule), then put its text in the draft with
the caret at the end. That is exactly `popEditableAt` decomposed, and `tui-parity` calls it
*"the right decomposition"*. Add *Send now* the same way for the head entry if wanted. Two canon
behaviours to keep and one to drop. Keep: **never overwrite a non-empty draft** — canon expresses
this as the bash filter and the cohesion-fix sentence; afleet should express it as "your draft is
not empty" on the row's Edit action, refusing rather than merging, since C6.2's prefill discipline
already says *a prefill is written only over the words the edit began with*. Keep: entries that
cannot be pulled back stay in the queue rather than vanishing. Drop: `popAllEditable`'s
join-everything-with-newlines behaviour, which is a terminal answer to having one text buffer and
no rows; afleet has rows, so per-entry edit is both simpler and better. Reordering is a drag on
the strip and has no canon equivalent `[exceeds]` — worth it only if the batch rule of C-39 makes
order matter to the user.

**Drops / keeps / gains.** Drops: `popAllEditable`, the mode-collapse filter, the two Up/Escape
routes, the cohesion-flag selection index and its sentence. Keeps: per-entry pull-back, the
non-empty-draft protection, no optimistic removal, the two cancel refusals. Gains: edit and cancel
as row actions instead of a two-key gesture, and correlation against afleet's own cancel responses
`[exceeds]`.

**Open.** **For the owner:** should *Edit* on a queued entry re-queue at the same position when
sent, or append at the end? Canon has no answer because it has no positions.

### C-39 · Draining: the batch rule

**Terminal.** A drain runs when both turn snapshots are inactive, the queue is non-empty and no
blocking dialog is up (SPEC 42.20.4). If the head is a slash command or a bash line, exactly
**one** entry drains. Otherwise the batch is chosen by scanning the **whole** queue — not a
consecutive run — taking every entry of the head's mode that is not a slash command; a slash
command or a different mode simply fails the predicate and **is skipped over, leaving the scan
running**. Only three things latch the scan closed: a `screeningPending` entry, or an entry with
`promptSubmitted` defined or `drainOnly === true` (which is still taken if it is the first match).
So a queue of `[plain, slash, plain]` drains **both** plain entries in one batch and leaves the
slash command for the next drain. **The batch becomes a single turn**, and the entries' history
rows are written first.

**Job.** Treat three type-aheads as one thought, not three conversations.

**Wire.** P, with the warning stated as a rule: *"The GUI must not assume one queued message =
one turn"* (`tui-parity` §42.20.4).

**afleet today.** `built` as one turn per entry, because that is what the engine does when the
host sends one frame per prompt and afleet adds no batching. The somersault clone hit the same
thing from the other side and recorded it as a defect: *"Canon drains every same-mode queued
prompt into one turn; ours runs one turn per entry. Three type-aheads cost three system prompts
here and one there"* (`spec-crosscheck-2026-09-03`, unknown unknown 4).

**GUI form.** Two things, one visible and one not. **Visible**: say which entries will run
together, which C-37's grouping does — a user who typed three sentences meant one instruction, and
seeing them bracketed as one turn is the difference between trusting the queue and cancelling it.
**Not visible**: afleet does not control the engine's batching from the host side, so the honest
form is to render what the lifecycle reports (entries that reach `started` together) rather than
predicting it. If afleet ever *does* control it — by composing several drafts into one frame —
canon's rule is the specification: same mode, slash commands skipped not stopped at, the three
latches respected. Note the cost of getting it wrong is money and latency, not correctness.

**Drops / keeps / gains.** Drops: the dialog gates, the latch bookkeeping, the drain scheduler.
Keeps: the batch as a user-visible fact. Gains: the grouping shown before it happens `[exceeds]`.

**Open.** Whether afleet can influence batching at all from the host side is unverified; the wire
takes one frame per submit. Worth a probe before promising the grouping.

### C-40 · Mid-turn absorption and `chat:queueSubmit`

**Terminal.** A drain is not the only way out of the queue (SPEC 42.20.4a). On each iteration the
query loop selects queued commands of priority at most `next` and **folds them into the turn
already in flight**: they are emitted as `queued_command` attachments, consumed with
`reason: "absorbed_mid_turn"`, their history written, and the attachments join the message list
handed to the next model iteration. So a prompt submitted mid-turn **can steer the turn that is
still running**. Four gates suppress it (fold suspension, a reached turn limit, the `cYe` filter
which excludes a string command starting with `/` unless `skipSlashCommands`, and a latch that
rejects later *prompt*-mode entries once tripped), and two safety valves leave commands queued
rather than dropping them. `chat:queueSubmit` (`ctrl+x enter`) is the same submit with a fourth
argument (SPEC 42.20.5): it bypasses the "suggestions are showing, do not submit" guard and sets
`wait: true`, which reaches the `prompt.submit` hook as `shouldWait` — but it does **not** park an
idle submission, because queueing is selected solely by "is a turn active", so on an idle session
`chat:queueSubmit` and `chat:submit` both dispatch at once.

**Job.** Say "also, do X" to a running agent and have it heard now rather than after.

**Wire.** R for `queueSubmit` — *"No `wait` field exists on the wire; `priority` is the closest
lever"* — and P for the absorption itself, which is the engine's own behaviour
(`tui-parity` §42.20.5).

**afleet today.** `undesigned` as a *surface*. Absorption happens or does not happen inside the
engine, and afleet renders the result: a queued entry that is absorbed reaches `started` inside
the running turn, which the chip already reflects. Nothing tells the user that their mid-turn
prompt is steering rather than waiting, and nothing offers the `queueSubmit` distinction.

**GUI form.** The user-visible fact worth surfacing is the difference between **"this will steer
the turn that is running"** and **"this will run after"**, because they are different acts. The
queue strip (C-37) already knows: an entry that reaches `started` before the current turn's
`result` was absorbed; one that starts after was drained. Label them — `steering this turn` versus
`queued` — and the queue stops being a black box. For `chat:queueSubmit`, offer *Send when this
turn ends* as a menu item (C-60) rather than a chord: it is a real intent the terminal expresses
with `ctrl+x enter` and the wire expresses with `priority`. Do not port the idle-parking illusion:
canon's own `wait` does nothing on an idle session, so afleet's item should be disabled when no
turn is running rather than silently sending.

**Drops / keeps / gains.** Drops: `ctrl+x enter`, the `wait` flag, the fold gates and latches, the
suggestions-guard bypass. Keeps: the absorbed-versus-drained distinction as a visible state.
Gains: the user learns which one happened `[exceeds]`.

**Open.** Reading absorption off lifecycle ordering (`completed` before or after the turn's
`result`) is the documented signal; it should be confirmed against a live capture before the label
is trusted.

### C-41 · `/btw` — the side question

**Terminal.** `/btw` is a `local-jsx` command with `immediate: true`, and that flag is the
input-layer switch: an immediate local-JSX command submitted while a turn is running takes a
branch **before** the queue (SPEC 42.20.6). Its panel mounts with
`{immediate: true, hidesPrompt: false, retireAtTurnBoundary: true}`, so the prompt stays usable
underneath and the panel retires at the turn boundary. The token is highlighted in the live input
by `/^\/btw\b/gi`, and the footer hint reads `/btw for side question` (verified in
`cli.pretty.js:507056`).

**Job.** Ask a question that must not become part of the conversation, without stopping the work.

**Wire.** R, and it is the chapter's one mandatory translation: `/btw` is **absent from the
headless command list**, but its descriptor carries `thinClientDispatch: "control-request"` → the
`side_question` control request, whose answer streams as the only `control_request_progress`
frames. *"A GUI that just forwards `/btw …` as text gets a refusal"* (`tui-parity` §42.20.6,
gap 6).

**afleet today.** `built` — `RouterTable` routes `/btw` → `.sideQuestion` with the explanation
`Asks a side question without affecting the conversation.`, and a `SideQuestionThread` holds the
`{question, response}` history. So afleet already does the one thing the terminal's form cannot be
copied into.

**GUI form.** Keep the routing. Two composer-side additions. (a) **Highlight the token in the
live field**, exactly as canon does with its regex, so the user sees that this line is about to
take a different path before they press Enter — afleet highlights nothing today. (b) **Give the
answer a home that is not the timeline**: canon's panel is a transient overlay that retires at the
turn boundary, which is a terminal's way of saying "this is not part of the conversation"; afleet
has a better one — the Thread panel tab, or a popover anchored to the composer, either of which
can persist and be scrolled `[exceeds]`. Keep the prompt usable while the answer streams
(`hidesPrompt: false` is a deliberate choice). Carry the hint string `/btw for side question` into
the hint row (C-22), since discovery is otherwise nil.

**Drops / keeps / gains.** Drops: `immediate: true`, the pre-queue branch, the retire-at-turn-
boundary panel. Keeps: the semantics, the hint string, the token highlight, a usable prompt while
it runs. Gains: an answer that persists and can be revisited `[exceeds]`.

**Open.** None.

---

## 7 · The interrupt ladder

### C-42 · Escape, and the double-press helper behind it

**Terminal.** Escape is handled in three places, in order (SPEC 42.21.2). **(1) `chat:cancel`**,
active only when there is something to cancel, with an internal precedence of: a running turn wins
over everything (abort and stop); else pull a matching editable queued command into the draft;
else cancel passive background work; else kill background agents. **Steps 3 and 4 are unreachable
from Escape** — it always passes `suppressBackgroundAgentKill: true` and both later branches open
with a guard on that flag, so Escape can only abort or pull back the queue; `ctrl+c` passes no such
flag and reaches them. **(2) The chat's `onKeyDownBefore`**: clear a queue-edit selection or
dismiss help, then let vim have the key if the mode is not NORMAL, then pull queued messages back,
then — with a non-empty transcript, an **empty** input and nothing loading — arm the double-Escape
rewind; the same pass resets bash mode at offset 0. **(3) The editor**: the first Escape on a
**non-empty** input shows the 1000 ms hint `Esc again to clear` and a second within the 800 ms
window clears the input, writing the cleared text to history first when `historyOnClear` is set.
The hint outlives the accept window by 200 ms — `tui-parity` calls this *"a real (small) bug; do
not port it"*. Most "press again" gestures share one 800 ms helper (SPEC 42.21.1); two do not —
`chat:killAgents` at 3000 ms and the left-arrow guard.

**Job.** One key that means "stop what is happening", graded by what is happening.

**Wire.** R for the ladder, both arms of which exist on the wire: *"Rebuild the ladder, not the
key… the ordering policy is the GUI's"* (`tui-parity` §42.6.3). The double-press helper itself is
T: *"Double-press ladders exist because a terminal has one key and no buttons. A GUI should use
distinct controls and a confirmation sheet."*

**afleet today.** `built` for the top rung only, and — by accident — correctly. `ComposerShortcut
.interrupt` binds `Escape` with no modifier and routes `model.interrupt()` →
`dispatch(routing: "/stop")` → `.interrupt` → `AnyControlRequest(Interrupt())`, whose
`cancelQueued` defaults false and serialises as `.object([:])`. **So afleet's Escape aborts the
turn and leaves the queue intact, which is exactly canon's running-turn branch.** It has no idle
branch: with no turn running, Escape sends an interrupt that does nothing, rather than pulling the
queue back (C-38) or clearing the draft. Root spec §14 item 8 is the acceptance: Esc stops the
turn within two seconds. The binding stands down while the keyboard is inside a panel
(`offered(keyboardIsInPanel:)`), so a full-screen program in a Terminal pane keeps its Escape.

**GUI form.** Keep Escape as *interrupt the turn* and keep the stand-down rule. Add the idle
branch as canon orders it, but with GUI verbs rather than a ladder: with no turn running and a
non-empty queue, Escape offers to pull the selected queue entry back (C-38); with no turn and no
queue and a non-empty draft, Escape clears the draft — **once, with Undo**, not twice within
800 ms. That single substitution is the whole translation of the double-press family: a terminal
arms a second press because it cannot show a button or offer an undo; a GUI has `⌘Z`. Drop the
`Esc again to clear` hint and its 200 ms bug with it. Keep the *ordering* verbatim, because it is
the part users feel: running turn beats queue beats draft.

**Drops / keeps / gains.** Drops: the 800 ms helper, both hint strings, the vim precedence, the
bash-mode reset, the unreachable branches 3 and 4. Keeps: Escape = interrupt, the precedence
order, the queue surviving an interrupt, the panel stand-down. Gains: clear-once-with-undo instead
of press-twice-fast `[exceeds]`.

**Open.** None.

### C-43 · Ctrl-C, Ctrl-D, and exit versus detach

**Terminal.** **Ctrl-C** is two layers (SPEC 42.21.4): the `app:interrupt` binding, whose gate is
broader than Escape's because it includes background agents, and the editor, where the **first**
press clears the input (unless `disableCtrlCClear`) *and* arms the exit message, and a second
within 800 ms exits. The message reads `Press Ctrl-C again to exit` — or, in a background or
catch-up session, **`Press Ctrl-C again to detach (session keeps running)`**. **Ctrl-D**
(SPEC 42.21.5): no component registers `app:exit` in the chat, so the key reaches the editor,
where the branch is chosen purely on the buffer being empty — non-empty forward-deletes and never
arms exit, and at the end of a non-empty line `del()` is a no-op, so **Ctrl-D there does nothing at
all**; on an empty buffer the first press shows `Press Ctrl-D again to exit` and the second exits.
Ctrl-D never clears the input.

**Job.** Get out — and, in a session that outlives the window, say clearly that leaving is not
stopping.

**Wire.** R. `interrupt` aborts the turn but **does not stop tasks**; closing stdin means "finish
the current turn and exit" (`tui-parity` §42.6.1). The judgement worth carrying:
*"The detach-vs-exit distinction is worth keeping in a GUI that supports background sessions."*

**afleet today.** `superseded`. There is no process to exit — closing a channel closes a view, and
`Cmd+W` closes a window; `App/Composer/` binds neither `ctrl+c` nor `ctrl+d`, and AppKit gives
`⌃C`/`⌃D` to the field's emacs bindings. afleet does have the state the detach wording is about:
the sidebar's **Background** section, `/background` → `.lifecycle(.sendToBackground)` behind the
confirmation `Send this channel to the background?`, and `Open in Terminal` behind
`Release this channel to your terminal?`.

**GUI form.** No composer surface, and one sentence to keep. The **exit-versus-detach
distinction** is precisely afleet's background-channel case, and afleet should say the same thing
in the same shape: closing a window or quitting the app while a channel is running must state that
the session keeps running — a sheet or a menu-item subtitle reading *the session keeps running in
the background*, not a bare confirmation. That is canon's only real contribution here and it is a
copy edit, not a feature. Drop the ladder: a GUI quits from a menu with a confirmation, and
Ctrl-C's clear-the-input half is `⌘Z`-able clearing (C-42).

**Drops / keeps / gains.** Drops: both ladders, both exit strings' mechanism, the Ctrl-D
forward-delete branch and its dead end-of-line case. Keeps: the detach wording's *meaning* on
afleet's own background path. Gains: `⌃C`/`⌃D` stay as native text-editing keys `[exceeds]`.

**Open.** None.

### C-44 · Ctrl-Z

**Terminal.** `ctrl+z` has **no default binding** — it is intercepted in the raw key stream before
any binding lookup (SPEC 42.21.6). The suspend sequence shows the cursor, disables all four
mouse-report modes, writes the terminal-modes teardown, unwinds the raw-mode counter, emits
`"suspend"`, uninstalls the patched stdout writer and sends `SIGTSTP` to the whole process group;
`SIGCONT` re-establishes everything. It is listed as terminal-reserved at **warning** severity, so
a user binding for it loads and is reachable in a background session
(`CLAUDE_CODE_SESSION_KIND=bg`) where the interception does not run. The help line advertises
`ctrl+z` for `suspend`.

**Job.** Put the program in the background of a shell. Not a job a window has.

**Wire.** T (`tui-parity` §42.2: *"A GUI has no process-suspend affordance and needs none"*).

**afleet today.** `superseded` — `⌘H` hides an app, `⌘M` minimises a window, and `⌃Z`/`⌘Z` is
Undo. afleet binds none of them specially.

**GUI form.** No surface. The one consequence for afleet is in C-58: `ctrl+z` is *not* reserved in
a GUI, so a user's `keybindings.json` entry for it would be honourable — and should not be, because
`⌘Z` is Undo and `⌃Z` is close enough to invite a mistake. Reserve it in afleet's own table with
the reason *Undo*.

**Drops / keeps / gains.** Drops: the whole sequence, both signals, the help line. Keeps: nothing.
Gains: the key is free for Undo `[exceeds]`.

**Open.** None.

### C-45 · `chat:killAgents`

**Terminal.** `ctrl+x ctrl+k`, confirmed by a second press within **3000 ms** — the one gesture
that does not use the shared 800 ms helper (SPEC 42.21.8). The arming press posts
`Press <chord> again to stop background agents` for 3000 ms, or, with nothing to stop,
`No background agents running` for 2000 ms (verified in `cli.pretty.js:499683`). The action is
admitted when **any** of six conditions holds — a running agent, an armed rewind, a passive
background task, a live-document watch, an artifact room, or one more — but **queue clearing is
guarded by a narrower predicate**: the whole command queue is cleared only when there is a running
agent, an armed rewind or a passive background task; confirming on a live-watch-only or
artifact-only path completes the gesture and **leaves the queue intact**. Cleared commands are
written to history with undo disarmed. Independently, the confirmed press stops every
live-document watch and disarms artifact auto-replies.

**Job.** Stop everything, including the work that is not the current turn.

**Wire.** **D** — `tui-parity` ranks it gap 2: *"No single control request. Nearest is
`interrupt {cancel_queued: true}` plus one `stop_task` per live task id… Not reachable at all: the
live-document watch teardown, the artifact auto-reply disarm, and the disclosure notification.
Note also `interrupt` alone does not stop tasks."*

**afleet today.** `built`, and it is the rung afleet got right. Root spec §7.7 defines *Stop
everything* as exactly `interrupt {cancel_queued: true}` plus `stop_task` per registry id;
`ComposerShortcut.stopEverything` binds `⌘⇧⎋`, does **not** stand down inside a panel, and routes
through `pendingConfirmation = .stopEverything` to the confirmation `Stop everything in this
channel?` with the destructive button `Stop Everything`. The header's Channel menu carries the
same item.

**GUI form.** Keep it exactly. Three notes. (a) The confirmation sheet **is** the double press —
that is the whole translation of the 3000 ms window, and it is better because it names what will
stop. (b) Say what will stop *in* the sheet: "this turn, N queued messages and N background
tasks", which afleet can enumerate and canon cannot fit. (c) Keep the `No background agents
running` case as a **disabled** menu item rather than a feedback line — a GUI can grey out what
has nothing to do. Keep the narrower queue-clearing predicate's *intent*: a *Stop everything* that
silently discards queued prompts the user still wants is worse than one that asks; naming the
count in the sheet resolves it.

**Drops / keeps / gains.** Drops: the chord, the 3000 ms window, both feedback strings, the
six-condition admission, the live-watch and artifact teardown (no afleet equivalent). Keeps:
`interrupt {cancel_queued: true}` plus per-task `stop_task`, the confirmation, the destructive
styling. Gains: an itemised sheet and a disabled state `[exceeds]`.

**Open.** None.

### C-46 · `chat:clearInput` and `chat:clearScreen`

**Terminal.** **Both actions are bound to the same handler** — `ctrl+l` and `cmd+k` — and that
handler has two steps: in the **fullscreen** layout only, clear the conversation view (earlier
messages stay reachable by scrolling); then bump a counter whose effect is a full `forceRedraw()`
(SPEC 42.21.7). **Neither clears the prompt buffer, despite the action name.** The buffer is
cleared by double-Escape or by the first `ctrl+c`. The unbound `app:redraw` has the redraw half
only.

**Job.** None, as shipped. This is a wiring bug with two action ids.

**Wire.** T — *"A known 2.1.257 wiring bug (chapter open question). Do not replicate; give the
GUI a real clear-input"* (`tui-parity` §42.21.7).

**afleet today.** `superseded`. afleet binds neither; `⌘K` is the quick switcher (root spec §8.7),
which collides with canon's `chat:clearScreen` binding and is the better use. `/clear` is a
router row (`.text`) whose timeline resets on `conversation_reset`.

**GUI form.** No surface, and a warning for C-59: a user's `keybindings.json` may bind `ctrl+l`
or `cmd+k` to these action ids, and afleet must decide what they mean. The honest mapping is
`chat:clearInput` → **actually clear the composer** (the name's intent, not canon's behaviour) and
`chat:clearScreen` → nothing, since afleet's timeline is not a screen buffer and `/clear` is the
real reset. Note that the somersault clone made the opposite choice — its scorecard records
`chat:clearInput` as clearing the buffer, and its own crosscheck (finding X4) then classes that as
a divergence from canon at 220, 251 and 257 alike. Both projects independently decided the name
should win over the behaviour; that is a signal, not a coincidence.

**Drops / keeps / gains.** Drops: `cmd+k`'s canon meaning, the fullscreen view clear, the redraw.
Keeps: the two action ids as honourable names in a keybindings file. Gains: a clear-input that
clears the input `[exceeds]`.

**Open.** None.

### C-47 · `chat:externalEditor`

**Terminal.** `ctrl+g` and `ctrl+x ctrl+e` open the draft in an external editor
(SPEC 42.21.9). The flow expands text pastes, optionally prepends the last 50 lines of the
previous assistant response under the header
`# ─── Write your reply below this line ──────────────────────────` (gated on
`externalEditorContext`), writes `<tmpdir>/claude-prompt-<uuid>.md`, spawns the editor, reads it
back, removes a trailing newline **only when it ends in one, not two**, restores existing
placeholders by first exact match, and always unlinks the temp file. Editor resolution is the
attached host's override, then `$VISUAL`, then `$EDITOR`, then the first of `code`, `vi`, `nano`
on `PATH`; `code` and `subl` get a wait flag injected. On a non-zero exit, a signal or a spawn
error the **draft is left untouched** and one of three messages is surfaced:
`Couldn't open ${editor} — ${message}`, `${editor} closed unexpectedly (${signal})`, or
`${editor} quit unexpectedly (exit code ${status})`.

**Job.** Write a long prompt in a real editor, because the prompt is not a real editor.

**Wire.** R (trivial) — nothing crosses the wire.

**afleet today.** `undesigned`. No such action exists; `App/Composer/` reads no file except a
dropped image's bytes.

**GUI form.** Low priority, because the premise is mostly gone: afleet's composer *is* a real
multi-line editor with system text services, and the terminal's version exists because its prompt
is not. Two things make it still worth a small item. (a) **Some users' prompts are documents**, and
`⌥⌘E` *Open draft in editor…* costs one temp file and a `NSWorkspace.open`; keep the round-trip
rules verbatim, especially draft-untouched-on-failure and the single-trailing-newline rule, both
of which exist because their absence loses text. (b) **`externalEditorContext`** — prepending the
last response as a reference block — is the genuinely useful half, and a GUI has a better form:
the response is already on screen beside the composer, so afleet does not need it in the file.
Skip that half. Editor resolution should be `$VISUAL`/`$EDITOR` then the user's default `.md`
application, since a Mac user's editor is a document association, not a `PATH` entry.

**Drops / keeps / gains.** Drops: both chords, the reference block, the `code -w`/`subl --wait`
special-casing, the placeholder restoration (afleet has chips, C-11). Keeps: the temp-file
round-trip, draft-untouched-on-failure, the trailing-newline rule, the three error sentences.
Gains: the document association instead of a `PATH` probe `[exceeds]`.

**Open.** None.

### C-48 · `chat:stash`

**Terminal.** `ctrl+s` is a one-key toggle over a **single in-memory slot** — not a stack, not on
disk — holding the text, the cursor offset, the paste map and any launch warning
(SPEC 42.21.10): with a non-blank draft it stashes; with a blank draft and something stashed it
pops. Automatic restoration happens on **submission**, not on the draft becoming blank, at two
sites: any ordinary non-slash submission while something is stashed pops it back immediately, and
the slash-command path pops only after the dispatch, and only when a stash exists and the draft
trims to empty. Both show `Draft restored` (verified in `cli.pretty.js:525423`). A one-time
discovery hint appears when a long draft shrinks.

**Job.** Get the draft out of the way for one command, and have it come back by itself.

**Wire.** R (trivial) — in-memory.

**afleet today.** `undesigned` as an action, `built` as an invariant. afleet never needs the
stash's main use because it never eats the draft: a routed command that dispatches removes only
its own text (`ComposerModel.send()` drops the routed prefix and leaves the rest), a refusal
leaves the whole line in the field with a sentence, and `ComposerRegistry` retains the composer
across a channel switch so an unsent draft survives. The stash's *other* use — park this, write
that — has no afleet equivalent.

**GUI form.** Do not port `ctrl+s` (on macOS that is Save, and afleet already uses `⌘S` for the
Files tab). Port the invariant, which afleet already has, and record it as one: **a command never
costs the user their draft.** If parking is ever wanted, the native form is drafts per channel —
which `ComposerRegistry` already stores — surfaced as "you have an unsent draft in #other-channel"
rather than a single anonymous slot `[exceeds]`. Keep `Draft restored` as the copy if a restore is
ever visible.

**Drops / keeps / gains.** Drops: the chord, the single slot, both restoration sites, the
discovery hint. Keeps: the invariant that a command does not eat a draft, and the sentence.
Gains: per-channel drafts instead of one slot `[exceeds]`.

**Open.** None.

---

## 8 · The `Shift+Tab` mode ring

### C-49 · `Shift+Tab`: the permission-mode ring

**Terminal.** One chord, one handler, `chat:cycleMode` in the `Chat` context, called with
`{kind: "carousel"}` (SPEC 42.22.1–2). The chord is `"shift+tab"` unconditionally in 2.1.263 —
the `meta+m` fallback is computed but unreachable, because the Bun-version test folds to true
(SPEC 42.6). Ring order is a bare switch (SPEC 42.22.3):
**`default → acceptEdits → plan → [bypassPermissions] → [auto] → default`**. `default`,
`acceptEdits` and `plan` are always present — plan has no availability gate; `bypassPermissions`
appears only when `isBypassPermissionsModeAvailable` holds and
`permissions.disableBypassPermissionsMode: "disable"` does not; `auto` only when the circuit
breaker, the `disableAutoMode` killswitch and model capability all pass. **`dontAsk` is never
entered by the cycle, only escaped** — it arrives from `permissions.defaultMode`, agent
frontmatter or a CLI flag. **The cycle does not reverse with a modifier**: a directional ring
exists but only the stub `proactivityMenu:*` actions reach it (SPEC 42.22.4). The chord is inert
while `ctrl+r` search is open or any non-autocomplete overlay is mounted (SPEC 42.22.2). While an
in-process teammate is being viewed the chord cycles *that teammate's* mode and returns, and that
branch is **not** announced to a screen reader, while a session-mode commit is, as `[<mode> on]`.
In a cloud session with nothing else available: `No other permission modes are available in this
cloud session`.

**Job.** Change how much the agent asks before acting, with one key, without leaving the draft.

**Wire.** R for the ring, P for the setter — `set_permission_mode {mode, ultraplan?}`; the GUI
sets an absolute mode and owns the ring order. **D for availability**: `initialize` returns
`current_permission_mode` but never says whether `bypassPermissions` or `auto` are in the ring
(`tui-parity` §42.22, ranked gap 4; workarounds are the host's own launch flags, `get_settings`
killswitches, or an optimistic `set_permission_mode` read back through its error).

**afleet today.** `built` — root spec §8.7 lists `Shift+Tab cycle permission mode` among the
app shortcuts, and C6.2 owns it: *"Shift+Tab cycles from the pickers' value, and the shortcut
keeps no cursor of its own"* — a second store had started every channel at `.default`, so the
first press on a channel launched in `acceptEdits` asked for the mode it was already in. An
engine that has reported nothing yet is treated as `.default`. §8.7 as amended at C7's
recomposition: *"Esc and Shift+Tab are bound only while the keyboard is outside the panel"*, so a
full-screen TUI inside a Terminal pane keeps its own keys. The mode readback lives in the channel
header (`App/Header/SettingPickers.swift`), not in the composer.

**GUI form.** Keep the chord as an accelerator and keep the pickers as the primary control —
that is `tui-parity`'s own recommendation (*"A GUI has no Shift+Tab ambiguity and should probably
use a segmented control, keeping the chord as an accelerator"*), and it is also why the terminal's
prose keeps naming the chord: the auto-mode description, `/powerup` and the tips engine all say
`Shift+Tab`, and that text arrives over the wire (SPEC 42.22.7). Two deviations worth making.
(a) **Offer the ring as a menu, not only as a cycle** `[exceeds]`: the header's mode picker
already shows every mode at once, which is strictly better than pressing the chord three times to
find out what the third mode is; keep the chord for the users whose fingers know it. (b) **Show
unavailable modes as disabled rows with their reason** rather than omitting them — the terminal
cannot, because its ring has no room for a disabled member; afleet can read the killswitches out
of `get_settings.effective` and say `bypassPermissions — disabled by settings`. Keep the ring
*order* exactly, so the chord lands where a terminal user expects. Keep the commit announcement:
post `[<mode> on]` through `NSAccessibility` when the mode changes, which `tui-parity` explicitly
asks for. Do not implement the teammate branch (afleet has no in-process teammates in v1).

**Drops / keeps / gains.** Drops: the carousel-only direction, the teammate branch, the
`meta+m` fallback, the cloud refusal string. Keeps: the ring order, the chord, the availability
gates, the screen-reader announcement. Gains: a picker that shows every mode and why one is
unavailable, and a mode change that does not require guessing `[exceeds]`.

**Open.** Availability is a data gap (`tui-parity` gap 4). Does afleet want to probe it with an
optimistic `set_permission_mode`, or to infer it from its own launch flags? A wrong guess shows
the user a mode that then fails.

### C-50 · `confirm:cycleMode` — the same chord in a decision card

**Terminal.** In the `Confirmation` context `shift+tab` is bound to `confirm:cycleMode`, which
does **not** touch permission modes (SPEC 42.22.6). In the tool-permission dialog it selects the
"accept for the rest of this session" row — labelled `Yes, keep allowing reads outside the
working directories` when a path rule is involved, otherwise `Yes` — or toggles the focused
feedback field. In the plan-approval dialog the same chord is documented as "approve with this
feedback". In the `/powerup` carousel it advances a slide.

**Job.** Give the dialog's most consequential answer a key, without leaving the dialog.

**Wire.** P — the dialog's own options arrive with the permission request (`tui-parity` §42.22:
*"A GUI must not globally bind Shift+Tab to mode-cycling or it will break the permission sheet"*).

**afleet today.** `built` for the card, `undesigned` for the chord — decision cards live in the
timeline (`App/Decisions/`, root spec §8.4) and afleet binds `Shift+Tab` to the mode cycle
globally while the keyboard is outside the panel (§8.7).

**GUI form.** Composer/timeline boundary. When a decision card holds keyboard focus,
`Shift+Tab` must mean the card's session-scope answer, not the mode ring — the terminal's
context system does this for free and afleet's flat binding does not. The rule generalises: every
chord afleet binds app-wide needs a focus-region exception list, which is exactly the mapping
C-59 proposes. Do not port the chord's third meaning (`/powerup` slides); afleet has no carousel.

**Drops / keeps / gains.** Drops: the carousel meaning. Keeps: the chord's dialog meaning and
its row label. Gains: focus-scoped chords, which the terminal expresses as contexts and a GUI
expresses as first responders `[exceeds]`.

**Open.** None.

---

## 9 · The remaining Chat and Global actions

### C-51 · The `app:*` toggles and `/focus`

**Terminal.** Five toggles register in one component, all `Global` (SPEC 42.23.1):
`app:toggleTodos` (`ctrl+t`) flips the footer panel to the tasks view; `app:toggleTranscript`
(`ctrl+o`) flips the transcript screen, first clearing brief-only mode when that is what is on;
`app:toggleBrief` (`ctrl+shift+b`) flips `isBriefOnly` but **only when entitled or already on**,
so the gate blocks enabling and never blocks turning it off; `app:toggleTerminal` is a no-op in
this build; `app:redraw` is unbound. Seven more `app:*` actions live elsewhere and are registered
*conditionally*, so their chords fall through to the editor when the diff view has nothing to
show: `app:openArtifact` (`ctrl+]`), `app:toggleReplTab`, `app:toggleDiffPreSession`,
`app:toggleDiffNoiseFilter`, `app:diffFileListUp`/`Down` (`ctrl+up`/`ctrl+down`/`meta+up`/
`meta+down`) and `app:cycleDiffBase` (`ctrl+x b`, `DiffPanel`). **`/focus` is not the same state
as `app:toggleBrief`** (SPEC 42.24.3): `/focus` writes `briefTranscript`, the toggle writes
`isBriefOnly`, and the reducer treats them independently. `/focus` needs the fullscreen renderer
to *enable* only — outside fullscreen it will still turn an active focus state off, and only when
there is nothing to disable does it refuse with `Focus view needs the fullscreen renderer. Run
/tui fullscreen to switch (this restarts and resumes your session), or set
CLAUDE_CODE_NO_FLICKER=1 and restart.`

**Job.** Change what the screen shows without changing what the session is doing — the terminal's
only way to have more than one view of one conversation.

**Wire.** `/focus` is X as a command (absent from the live headless command list) and R as state;
the brief flag goes through `apply_flag_settings` (`tui-parity` §42.24.3). Todos arrive as
`task_*` frames and `background_tasks_changed`; panel visibility is host state (R). The diff
actions are P through `get_workspace_diff`. `app:openArtifact` is D — no artifact-URL frame is in
the stdout catalogue (`tui-parity` §42.23.1).

**afleet today.** `superseded` for most of it. afleet's window already shows what these toggles
reveal: tasks are the Agents panel tab and the timeline's task run rows, the transcript *is* the
timeline, diffs are the Source Control tab, and an artifact URL can open in the Browser tab
(root spec §8.8). `undesigned` for the one that is not a view afleet already has: focus/brief.
Root spec §8.7's shortcut list has no equivalent of `ctrl+o`, `ctrl+t` or `ctrl+shift+b`.

**GUI form.** Do not port eleven chords. Port the one behaviour: **a density control on the
timeline**. Channel header, a `View ▾` menu with `Full`, `Focus` (user prompt, summary and
response only) and `Compact`; the terminal's own `/focus` semantics say what `Focus` hides. Bind
it to a menu-bar item under *View* with `Cmd+Shift+F`, so the chord is discoverable rather than
memorised. Two faithfulness notes: keep `Focus` per channel, because the terminal's state is
per-session; and do **not** merge it with a "brief" flag — canon has two independent states and
merging them is how afleet would inherit a bug rather than a feature. Everything else maps to a
panel tab, and the panel tabs already have `Cmd+2…Cmd+7`.

**Drops / keeps / gains.** Drops: `ctrl+t`, `ctrl+o`, `ctrl+shift+b`, `ctrl+]`, the four diff
chords, `app:redraw`, `app:toggleTerminal`, the fullscreen-renderer requirement and its refusal
sentence. Keeps: the focus view as a named, per-channel timeline density. Gains: several views
visible at once instead of toggled, and no renderer gate `[exceeds]`.

**Open.** **For the owner:** is a Focus density worth building in v1, or is it the kind of view
that only matters on an 80-column screen?

### C-52 · `task:background` and the tmux prefix

**Terminal.** `ctrl+b` and `ctrl+x ctrl+b` both map to `task:background` in the `Task` context,
and the handler backgrounds **every** eligible foreground task, not one (SPEC 42.23.2).
Eligibility has two branches: a local shell task needs a recorded `shellCommand` and not already
backgrounded; every other task (chiefly agents) needs to be a local non-main-session task, not
backgrounded, and not excluded by `$6t`. `ctrl+b` is also tmux's prefix, so the harness computes
its hint rather than choosing from a set: under tmux every keystroke that is exactly `ctrl+b` is
doubled, and with `CLAUDE_CODE_KB_COHESION_FIXES` set and no user rebinding the bare `ctrl+b`
leaves the single-key pass entirely, so only the chord fires. The rendered forms are
`(ctrl+b to run in background)`, `(ctrl+b ctrl+b (twice) to run in background)`,
`(ctrl+x ctrl+b to run in background)` and `(ctrl+x ctrl+b ctrl+b to run in background)`; the
hint is hidden when the action has no effective binding, and suppressed when background tasks
are disabled.

**Job.** Get a long-running thing out of the foreground without killing it.

**Wire.** P, and `tui-parity` calls it *"the cleanest parity row in the chapter"*:
`background_tasks` with no `tool_use_id` invokes the identical background-everything function;
with an id it backgrounds one. Refused when background tasks are disabled.

**afleet today.** `built` — the sidebar has a **Background** section and the channel header menu
carries *send to background* and *background all* (root spec §8.1, §2 of this study's region
vocabulary). The terminal's chord has no afleet equivalent and does not need one.

**GUI form.** Keep the two commands where they are and add the per-task action the terminal
cannot offer: a **Background** button on the task run row itself and in its context menu
`[exceeds]` — the terminal must background everything because it has one chord and no way to
point at a row. Give *background all* the menu-bar home (`Session ▸ Background all`) and, if any
chord at all, `Cmd+Shift+B`. **Drop `ctrl+b` outright**: it is tmux's prefix, and the whole tmux
accommodation — doubling, the cohesion-fixes single-key exit, the four hint strings — exists only
because a terminal shares its keyboard with a multiplexer. Keep one behaviour verbatim: the
refusal when background tasks are disabled, so the button explains itself rather than doing
nothing.

**Drops / keeps / gains.** Drops: both chords, the tmux doubling and its four hint forms, the
`CLAUDE_CODE_KB_COHESION_FIXES` single-key exit. Keeps: background-everything as one command, the
eligibility split, the disabled refusal. Gains: backgrounding one named task by pointing at it
`[exceeds]`.

**Open.** None.

### C-53 · The unbound families: `strip:*`, `proactivityMenu:*` and friends

**Terminal.** Thirteen `strip:*` actions (`jump1`…`jump9`, `next`, `previous`, `toggle`, `new`)
ship with no default binding and are hidden from the `keybindings-help` skill's table
(SPEC 42.23.3). Two `proactivityMenu:*` actions are **not** inert: they are registered in the
`ProactivityMenu` context and step the directional permission-mode ring, but because nothing
binds them the dialog advertises `left` and `right` instead. `chat:cycleProactivity`,
`chat:attentionUp` and `chat:attentionDown` remain unbound and hidden. A user's
`keybindings.json` may bind any of them by name.

**Job.** Nothing, for the user — these are ids the action catalogue carries ahead of the UI.

**Wire.** X (`tui-parity` §42.5: `strip:*` and `proactivityMenu:*` are both classed X, the
latter *"Dead in this build"*).

**afleet today.** `undesigned`, correctly — no afleet document mentions them.

**GUI form.** No surface. They matter for exactly one thing, and C-59 has to handle it: a user's
`keybindings.json` may contain a binding for an action afleet does not implement, and the honest
answer is to show it in the keybindings view as **known but unimplemented here**, not to drop it
silently the way the terminal's loader drops an *unknown* action. The distinction is worth
keeping: unknown action = the user's typo (the terminal says so, C-57); known-but-unimplemented =
afleet's gap.

**Drops / keeps / gains.** Drops: eighteen action ids. Keeps: their names, as things a
keybindings view can recognise and explain. Gains: a user learns why their binding does nothing
`[exceeds]` — the terminal only logs it.

**Open.** None.

---

## 10 · `~/.claude/keybindings.json`

### C-54 · The file, its gating and its hot reload

**Terminal.** One path: the user config directory joined with `keybindings.json`, i.e.
`~/.claude/keybindings.json` or `$CLAUDE_CONFIG_DIR/keybindings.json`. **There is no
project-scoped keybindings file** — the loader reads exactly this one path — and the file is
absent by default (SPEC 42.7.1). Customisation is gated twice: the gate
`tengu_keybinding_customization_release` (default true) and the safe/simple-mode capability
`Xr("keybindings")`; when disabled only the defaults are used and the watcher is skipped with
`[keybindings] Skipping file watcher - user customization disabled`. Otherwise a `chokidar`
watcher runs on the file with `awaitWriteFinish {stabilityThreshold: 500, pollInterval: 200}`,
`usePolling: true`, `interval: 2000` and `atomic: true`; `add` and `change` re-load and
re-validate, `unlink` reverts to the defaults, and edits take effect **without restarting**.
Four load paths share one parse; `ENOENT` is not an error, it returns the defaults with no
warnings. The schema top level is `{ $schema?, $docs?, bindings: KeybindingBlock[] }` and each
block is `{ context, bindings: Record<chord, action | "command:name" | null> }` (SPEC 42.7.2).
At runtime `$schema` and `$docs` are never read: given a valid `bindings` array they may hold any
JSON value at all.

**Job.** Let a user who has already taught one Claude Code their chords keep them.

**Wire.** R — not on the wire; the headless CLI never reads the file, and the host reads the
same path from disk. `tui-parity` ranks this the area's **gap 1**: *"users have real
`keybindings.json` files and the headless CLI never reads them"*, and the schema is public at
`https://www.schemastore.org/claude-code-keybindings.json`.

**afleet today.** `out-of-scope` for v1 by two lines. Root spec §13: *"`~/.claude/keybindings.json`
is not honoured yet. afleet ships its own shortcuts; reading the file with the terminal's merge
rules is later work."* §17.8 lists *"honouring `~/.claude/keybindings.json`"* under deferred.
Nothing in `App/` reads the file.

**GUI form.** Read it, honour it, never write it. A `KeybindingStore` at app scope parses the
same path (respecting `CLAUDE_CONFIG_DIR`), merges per C-55, and publishes a resolved binding set
that the focus regions of C-59 consult. Watching is free and better than the terminal's: a
`DispatchSource` on the file's vnode or an `NSFilePresenter` gives change events without the
2000 ms polling loop chokidar falls back to, and the reload must be atomic-write-safe the same
way (`atomic: true` exists because editors rename over the file). Reproduce the two gates'
*effect*, not their mechanism: afleet cannot read a Statsig gate, so assume customisation is on,
which is the default. **The write half is blocked by afleet's own rule**: root spec §7.8 says
*"The app never writes to `<configHome>`; every mutation goes through the CLI or the control
channel"*, and `keybindings.json` is under the config home — see C-61.

**Drops / keeps / gains.** Drops: the two feature gates, the polling watcher, `$schema`/`$docs`
tolerance (afleet can simply ignore them as the runtime does). Keeps: the path, the absence
default, hot reload, the schema. Gains: FSEvents instead of polling; and a file the user can
edit in one app and see take effect in both `[exceeds]`.

**Open.** Does afleet honour `CLAUDE_CONFIG_DIR` when it differs from the child's? The child
resolves its own config home; a host that reads a different one silently honours a different
file.

### C-55 · Merge order, `null` unbinding and precedence

**Terminal.** User bindings are **appended after** the defaults and nothing is removed; the
matcher scans the flattened list and keeps the **last** match, so a later user binding for the
same `(context, chord)` wins (SPEC 42.7.4). Explicit unbinding is `null`, and `null` survives the
load filter while an **unknown action id is silently dropped at load time**. A scope-chain
`unbound` result stops action resolution but does **not** by itself swallow the key: because the
consume callback never runs, the raw key keeps propagating and in the common case reaches the
prompt editor. A *legacy single-key* `unbound` differs again — it continues to the per-handler
scan, where another handler's context can resolve and fire. The one case where `unbound` consumes
is a chord prefix already pending. The asymmetry the help skill calls out: adding a chord does
**not** remove the default, so *moving* a binding means `null` on the old chord plus the new one.

**Job.** Make one user's file predictable against a table of 190-odd defaults they never wrote.

**Wire.** R (`tui-parity` §42.7.4: *"Get this exactly right or a user's 'move ctrl+g to ctrl+e'
file behaves differently in the GUI than in the terminal"*).

**afleet today.** `out-of-scope` — see C-54.

**GUI form.** Reproduce the resolution rule exactly: defaults, then user blocks, last match
wins per `(context, chord)`, `null` unbinds. Reproduce chord normalisation for comparison
(lower-case, the alias map `control→ctrl`, `option`/`opt`/`meta`→`alt`,
`command`/`cmd`/`super`/`win`→`cmd`, modifiers sorted) or two spellings of one chord will
disagree. The one place afleet should **not** reproduce the terminal is the fall-through: an
unbound chord in AppKit simply does not match a responder and the key event continues to the
first responder, which is the same *observable* behaviour the terminal reaches by a more
complicated route — implement the outcome, not the three-way `unbound` machinery. Note that the
somersault clone got exactly this wrong in the other direction: `spec-crosscheck-2026-09-03`
finding **L9** records that its resolver *consumes* an explicit `null` where canon lets the key
bubble to the editor.

**Drops / keeps / gains.** Drops: the legacy single-key scan, the pending-prefix consume case,
the flattened-list implementation. Keeps: append-after-defaults, last-wins, `null` unbinds,
unknown actions dropped, the normalisation. Gains: none — this card is pure fidelity.

**Open.** None.

### C-56 · `command:` bindings

**Terminal.** A binding value beginning with the eight characters `command:` runs a slash command
as if typed (SPEC 42.7.3). The published regex `/^command:[a-zA-Z0-9:\-_]+$/` is **advisory**:
membership is tested with `startsWith("command:")`, so `command:my cmd` and even the bare
`command:` are retained and get a handler — the bare form slices to the empty string and submits
`/`. The `Chat`-context rule is advisory too: the collector walks the whole merged binding list
with no context test, so a `command:` binding written into any block loads, though the handlers
themselves are registered in `Chat`, which is what decides when the chord matches. The prompt
buffer is untouched (the handler is given a no-op editor handle), and telemetry collapses every
such action to `command:custom`.

**Job.** Let a user put `/compact` on a key.

**Wire.** R — the GUI sends the same slash command it would send if the user typed it. One
caveat from `tui-parity` §42.7.3: *"A user's `command:` bindings can point at commands the
headless CLI refuses. The GUI should check the name against `initialize.commands` (102 entries
live) and grey out or locally implement the rest."*

**afleet today.** `out-of-scope` — see C-54. But the seam exists: C6.2's router already
dispatches a typed `/name` through `CommandRouter`, and every routed command has a native
destination or a local refusal, so a `command:` chord has somewhere to go the day the file is
read.

**GUI form.** Route a `command:` chord into the same `CommandRouter` entry point a typed line
takes, with the composer's text untouched — that is the terminal's no-op-editor-handle rule and
it matters: a chord that eats the draft is a chord users disable. Two GUI improvements, both
cheap. (a) **Resolve the name at load and show the outcome** in the keybindings view: routed
natively, passed through as text, refused locally, or unknown to this engine `[exceeds]` — the
terminal cannot tell the user any of that. (b) **Keep the bare-`command:` case from submitting
`/`**: treat an empty command name as a validation error, not as a keystroke that sends a stray
slash. That is a deliberate divergence from canon and the reason is that canon's behaviour here
is an artefact of `slice(8)`, not a design.

**Drops / keeps / gains.** Drops: submitting `/` for a bare `command:`, the advisory-regex
tolerance, `command:custom` telemetry. Keeps: the mechanism, the untouched draft, the Chat-scope
rule. Gains: per-binding resolution status in the UI `[exceeds]`.

**Open.** None.

### C-57 · Validation and every warning string

**Terminal.** Validation runs on every load and produces records of
`{type, severity, message, key?, context?, action?, suggestion?}`, **all of which go to the debug
log and none of which the user ever sees** (SPEC 42.8). The structural gate is all-or-nothing:
one malformed block fails the whole array and the loader falls back to the defaults alone.
Structural errors (SPEC 42.8.1): `keybindings.json must have a "bindings" array` /
`Use format: { "bindings": [ ... ] }`; `"bindings" must be an array` / `Set "bindings" to an array
of keybinding blocks`; `keybindings.json contains invalid block structure` / `Each block must have
"context" (string) and "bindings" (object mapping keys to a string action or null)`;
`Failed to parse keybindings.json: ${err}`; `keybindings.json must contain an array` /
`Wrap your bindings in [ ]`. Per-block (SPEC 42.8.2, blocks numbered from 1):
`Keybinding block ${i} is not an object`; `Keybinding block ${i} missing "context" field`;
`Unknown context "${ctx}"` with `Valid contexts: …`; `Keybinding block ${i} missing "bindings"
field`; `Empty key part in "${key}"` with `Remove extra "+" characters`; `Invalid action for
"${key}": must be a string or null`; the two **warning**-severity `command:` records
(`Invalid command binding "${action}" for "${key}": command name may only contain alphanumeric
characters, colons, hyphens, and underscores` and `Command binding "${action}" must be in "Chat"
context, not "${ctx}"` / `Move this binding to a block with "context": "Chat"`); the error
`Unknown action "${action}" for "${key}" in ${ctx} — this binding is ignored`; and the
push-to-talk warning `Binding "${key}" to voice:pushToTalk prints into the input during warmup;
use space or a modifier combo like meta+k`, whose trigger tests only the chord's **first**
keystroke. The suggester (SPEC 42.8.3) is three tiers: Levenshtein ≤ 2 → `Did you mean
"${r}"?`; else `Valid "${o}:" actions: …`; else `Valid action namespaces: …`. Duplicates are
detected twice (SPEC 42.8.4) — a raw-text regex pass emitting `Duplicate key "${k}" in ${ctx}
bindings` with `This key appears multiple times in the same context. JSON uses the last value,
earlier values are ignored.`, and a normalised pass emitting `Duplicate binding "${k}" in ${ctx}
context` with `Previously bound to "${h}". Only the last binding will be used.` — and only the
second is deduplicated, so one repeated key can be reported twice. The normalised pass **never
sees the defaults**, so rebinding a chord that already has a default produces no warning.

**Job.** Tell the user their file is wrong. The terminal does the work and then throws the
answer into a log file.

**Wire.** R (`tui-parity` §42.8: *"**Where a GUI exceeds the TUI:** surface these in a real
settings UI instead of a debug log"*).

**afleet today.** `out-of-scope` — see C-54.

**GUI form.** This is the lane's clearest `[exceeds]`. Run the same validator on load and on
every hot reload, and render its records **in the keybindings pane** (C-61), each row carrying
severity, the offending chord, the message and the suggestion verbatim — the strings above are
good copy and rewriting them would only cost the user their web-searchability. Three deviations,
all in the user's favour: (a) show the **line number**, which afleet has because it parses the
text and the terminal discards; (b) suppress the duplicated duplicate-report (one record per
repeated key, since canon's double-report is an implementation seam, not information); (c) warn
on a chord that collides with an afleet **menu-bar** shortcut or a macOS system key, which is
the same job as canon's reserved table (C-58) applied to a different keyboard. Keep the
all-or-nothing structural gate's *behaviour* — one broken block means defaults only — but say so
in the pane rather than silently.

**Drops / keeps / gains.** Drops: the debug-log-only destination, the double duplicate report,
the push-to-talk warning (afleet has no voice binding). Keeps: every message and suggestion
string, the severity split, the Levenshtein suggester, the structural gate's outcome. Gains: live
validation with line numbers, in the window, before the user restarts anything `[exceeds]`.

**Open.** None.

### C-58 · Reserved keys

**Terminal.** Three tables, assembled per platform (SPEC 42.8.5). **Non-rebindable, error
severity**: `ctrl+c` `Cannot be rebound - used for interrupt/exit (hardcoded)`; `ctrl+d`
`Cannot be rebound - used for exit (hardcoded)`; `ctrl+m` `Cannot be rebound - identical to Enter
in terminals (both send CR)`; `ctrl+[` `Cannot be rebound - identical to Escape in terminals`;
`ctrl+i` `Cannot be rebound - identical to Tab in terminals`; `ctrl+h` `Cannot be rebound -
identical to Backspace in terminals`; `capslock` `Caps Lock is not delivered to terminal
applications`. **Terminal-reserved**: `ctrl+z` `Unix process suspend (SIGTSTP)` at *warning*
severity — so a user binding for it is loaded and fires in a background session — and `ctrl+\`
`Terminal quit signal (SIGQUIT)` at error. **macOS only, error**: `cmd+c` `macOS system copy`,
`cmd+v` `macOS system paste`, `cmd+x` `macOS system cut`, `cmd+q` `macOS quit application`,
`cmd+w` `macOS close window/tab`, `cmd+tab` `macOS app switcher`, `cmd+space` `macOS Spotlight`.
The record reads `"${key}" may not work: ${reason}`. `/keybindings`'s template strips exactly the
non-rebindable set. Note the tension canon ships with: `ctrl+c` and `ctrl+d` are in the **default**
table while the user is told they cannot be rebound.

**Job.** Stop a user from binding a key the terminal will never deliver.

**Wire.** T→R, and `tui-parity` says the interesting half plainly: *"**Most of this list is a
terminal artefact.** … A GUI can honour bindings the terminal refused — a genuine superset. But
`cmd+c/v/x/q/w` remain real macOS system keys and must stay reserved."*

**afleet today.** `out-of-scope` — see C-54.

**GUI form.** Split the table by *why*. The seven non-rebindable entries divide into two
terminal artefacts afleet should **lift** — `ctrl+m`, `ctrl+[`, `ctrl+i`, `ctrl+h` and
`capslock`, all of which `NSEvent` delivers distinguishably — and two that stay reserved for a
different reason: `ctrl+c`/`ctrl+d` are not special to AppKit, so afleet may honour them, but
should warn that the same file in a terminal will not. `ctrl+z` and `ctrl+\` are free in a GUI
(no SIGTSTP, no SIGQUIT), and `ctrl+z` should be left to Undo. The macOS seven stay reserved
verbatim, and afleet must add its own: every chord the app's menu bar owns (C-60). So the
keybindings pane shows three severities — *reserved by macOS*, *reserved by afleet*, and
*works here, will not work in the terminal* — which is one more distinction than canon can make
and is exactly the information a user with one file and two apps needs.

**Drops / keeps / gains.** Drops: five terminal-only reservations and their reasons. Keeps: the
macOS table verbatim, the `may not work` phrasing. Gains: `ctrl+i`, `ctrl+m`, `ctrl+[`, `ctrl+h`
and `capslock` become bindable, and the pane says which bindings are portable `[exceeds]`.

**Open.** None.

### C-59 · The 26 contexts and how a GUI honours them

**Terminal.** A context names a UI situation; there are **26** in 2.1.263 (SPEC 42.4), each with
a user-facing description: `Global` *Active everywhere, regardless of focus*; `Chat` *When the
chat input is focused*; `Autocomplete` *When autocomplete menu is visible*; `Confirmation`,
`Help`, `ProactivityMenu` (no defaults), `Transcript`, `HistorySearch`, `Task`, `ThemePicker`,
`Settings`, `Tabs`, `Attachments`, `Footer`, `AbovePrompt`, `AbovePromptInput`,
`AbovePromptSelect`, `MessageSelector`, `DiffDialog`, `DiffPanel`, `ModelPicker`, `EffortSlider`,
`Select`, `Plugin`, `Scroll`, `Agents`. `Global` is always appended to the active list at
dispatch time. The active list is assembled from registered handler contexts, registered active
contexts and `Global`; an unknown context name parses, is reported, is retained in the merged
list — and never matches, because it can never enter that list.

**Job.** Make one chord mean different things depending on what has the keyboard.

**Wire.** R (`tui-parity` §42.4: *"Only matters if the GUI honours `keybindings.json`; it must
map each context onto its own focus regions"*).

**afleet today.** `undesigned` — afleet's shortcuts are flat, with one focus rule: root spec
§8.7 as amended at C7's recomposition, *"Esc and Shift+Tab are bound only while the keyboard is
outside the panel"*, so a full-screen program in a Terminal pane keeps its keys. That single
exception is the seed of the general mechanism.

**GUI form.** **The honouring model is a context → focus-region map plus a menu-bar projection
(C-60), not a chord table.** AppKit already has the machinery: a context is a first-responder
region, and the resolved binding set is consulted by whichever region is key. Nine contexts have
a real afleet region; the rest are terminal furniture.

| Terminal context | afleet focus region | Note |
|---|---|---|
| `Global` | the window (and the menu bar, C-60) | always active, as in canon |
| `Chat` | the composer field | the largest block of defaults |
| `Autocomplete` | the completion popover | accept/dismiss/previous/next (C-27) |
| `Confirmation` | a decision card that has focus | including `confirm:cycleMode` (C-50) |
| `Attachments` | the attachment tray | four bindings, all native (C-16) |
| `MessageSelector` | the edit/rewind picker | lane F's surface |
| `Transcript`, `Scroll` | the timeline | scrolling is native; `transcript:*` is real |
| `Task` | a focused task run row | `task:background` (C-52) |
| `Settings` | the Settings window | `settings:*` |
| `HistorySearch` | the history palette (C-34) | if built |
| `Tabs`, `Footer`, `AbovePrompt*`, `DiffDialog`, `DiffPanel`, `ModelPicker`, `EffortSlider`, `Select`, `Plugin`, `ThemePicker`, `Agents`, `Help`, `ProactivityMenu` | none, or a panel tab | terminal furniture, native widgets, or dead |

Three rules make the map behave. (1) A binding in a context afleet has no region for is
**loaded, listed and inert** — which is canon's own behaviour for an unknown context, and the
keybindings pane says so rather than dropping it. (2) `Global` bindings that collide with a
menu-bar shortcut lose to the menu bar and are flagged (C-58). (3) Chords are matched with the
terminal's grammar: space-separated keystrokes, greedy prefix, a 1000 ms pending window,
`escape` cancels a pending chord (SPEC 42.3.4) — `tui-parity` warns that without it *"users'
`ctrl+x …` chords misfire"*, and a two-keystroke chord is something AppKit has no native concept
of, so afleet must own the pending state and show it (a `ctrl+x …` indicator in the composer's
trailing edge is the cheapest honest form).

**Drops / keeps / gains.** Drops: thirteen contexts with no afleet region, the dispatch-time
active-context assembly. Keeps: the nine mappings, `Global`-always-appended, the chord grammar
and its 1000 ms window. Gains: focus regions are visible and clickable, so "which context am I
in" stops being a guess `[exceeds]`.

**Open.** **For the owner:** honouring the file is deferred by §17.8. Is the goal parity for a
terminal user's muscle memory (implement the map), or a native app with its own shortcuts (read
the file only to *warn* about collisions)? The first is an M; the second is an S and still
removes the worst surprise.

### C-60 · The default binding table and the macOS menu bar

**Terminal.** All defaults live in one array (SPEC 42.6). `Global` carries `ctrl+c`
`app:interrupt`, `ctrl+d` `app:exit`, `ctrl+t` `app:toggleTodos`, `ctrl+o`
`app:toggleTranscript`, `ctrl+shift+b` `app:toggleBrief`, `ctrl+r` `history:search`,
`ctrl+up`/`ctrl+down`/`meta+up`/`meta+down` for the diff file list and `ctrl+]`
`app:openArtifact`. `Chat` carries twenty-six entries: `escape` `chat:cancel`, `ctrl+l`
`chat:clearInput`, `cmd+k` `chat:clearScreen`, `ctrl+x ctrl+k` `chat:killAgents`, `shift+tab`
`chat:cycleMode`, `meta+p` `chat:modelPicker`, `meta+o` `chat:fastMode`, `meta+t`
`chat:thinkingToggle`, `meta+w` `chat:workflowKeywordToggle`, `enter` `chat:submit`,
`ctrl+x enter` `chat:queueSubmit`, `ctrl+j` `chat:newline`, `up`/`down` history,
four `chat:undo` chords, `ctrl+g` and `ctrl+x ctrl+e` `chat:externalEditor`, `ctrl+x ctrl+a` and
`ctrl+x tab` for the above-prompt plugin strip, `ctrl+s` `chat:stash`, `ctrl+v`
`chat:imagePaste` and bare `space` `voice:pushToTalk`. `Autocomplete` is four keys: `tab`,
`escape`, `up`, `down`.

**Job.** Give every action a default a terminal can actually deliver.

**Wire.** R — *"No action id ever crosses the wire"* (`tui-parity` §42.5).

**afleet today.** `built`, and short. Root spec §8.7: *"Cmd+K switcher, Esc interrupt,
Cmd+Shift+Esc stop everything (confirm), Cmd+Enter send, Cmd+S save the Files tab's editor,
Cmd+1…7 panel tabs, Cmd+Shift+T new terminal tab, Shift+Tab cycle permission mode, Cmd+Shift+A
Activity."* The macOS menu bar is, per this study's own region vocabulary, *largely unused so
far*. Note one collision already present: canon binds `cmd+k` to `chat:clearScreen` in `Chat`;
afleet binds `Cmd+K` to the quick switcher.

**GUI form.** **Terminal chords do not become GUI chords one for one; `Global`-context actions
become menu-bar items with visible equivalents.** That is where afleet's menu bar earns its
keep, and it is the difference between a chord a user must remember and one they can find. The
projection:

| Menu | Item | Shortcut | Terminal origin |
|---|---|---|---|
| Session | Interrupt | `Esc` | `app:interrupt` / `chat:cancel` |
| Session | Stop everything… | `⌘⇧⎋` | `chat:killAgents` (C-45) |
| Session | Background all | `⌘⇧B` | `task:background` (C-52) |
| Edit | Undo / Redo | `⌘Z` / `⇧⌘Z` | `chat:undo` |
| Edit | Paste as text | `⌥⌘V` | — (C-11) |
| Edit | Attach image… | — | `chat:imagePaste` |
| Edit | Open draft in editor… | `⌃G` or none | `chat:externalEditor` (C-47) |
| View | Focus / Full | `⌘⇧F` | `/focus`, `app:toggleBrief` (C-51) |
| View | Panel tabs 1–7 | `⌘1…⌘7` | — (afleet's own) |
| Go | Search prompt history… | `⌘⇧R` | `history:search` (C-34) |
| Go | Quick switcher | `⌘K` | — (afleet's own) |
| Message | Send | `⏎` / `⌘⏎` | `chat:submit` |
| Message | Send when this turn ends | `⌃X ⏎` or none | `chat:queueSubmit` (C-40) |
| Message | Side question… | — | `/btw` (C-41) |

Three rules for the projection. (a) **Keep a chord only when it is the terminal's and does not
collide with a macOS convention** — `Esc` and `Shift+Tab` do, `ctrl+l` and `cmd+k` do not
(afleet already owns `Cmd+K`). (b) **Every kept chord gets a visible home**, so the keyboard is
an accelerator rather than the only route. (c) **`ctrl+*` chords are legal on macOS and mostly
free**, so a user's own `keybindings.json` can still reach them (C-59) even where afleet's menu
bar uses `⌘`.

**Drops / keeps / gains.** Drops: the terminal's `ctrl+`-heavy defaults as *afleet's* defaults,
`space` for push-to-talk, the four undo chords. Keeps: `Esc`, `Shift+Tab`, `Enter`/`Cmd+Enter`,
`Tab` in the completion popover. Gains: a menu bar that teaches every action's shortcut, and
`⌘`-space chords the terminal cannot receive at all `[exceeds]`.

**Open.** **For the owner:** should afleet's *defaults* include the terminal's `ctrl+` chords as
aliases (so a terminal user's fingers work immediately), or stay purely native and let the
keybindings file carry them?

### C-61 · `/keybindings`

**Terminal.** A `local` command, `Open your keyboard shortcuts file`, gated by the same
customisation gate (SPEC 42.24.2). It writes `~/.claude/keybindings.json` **only if absent**,
from a template that is the full default table minus the non-rebindable keys, then opens it in
the external editor. Four textual outcomes: `Keybinding customization is disabled in this
environment.`; `Opened ${e} in your editor.${d}`; `Created ${e} with template. Opened in your
editor.${d}` (with a safe-mode suffix when custom keybindings are disabled for the session); and
`${t ? "Opened" : "Created"} ${e}. ${o.error}`. **The success pair does not prove an editor
launched** — the launcher returns `{content: null}` with no `error` when no editor resolves, and
the command tests only `o.error`, so a user with no `$EDITOR`, `$VISUAL` or recognised GUI editor
is told the file was opened when it was not. Write failures are not textual outcomes at all; they
throw.

**Job.** Get the user in front of their own bindings.

**Wire.** X — `supportsNonInteractive: false`, absent from the live headless command list.
`tui-parity` gap 8: *"The GUI must ship its own keybinding editor — and should, surfacing the
§42.8 validation live instead of writing it to a debug log."*

**afleet today.** `undesigned`. `/keybindings` is not in the root spec §7.7 router table, so it
falls to class 2, *terminal-only*: hidden from autocomplete and refused locally with a one-line
explanation (root spec §7.7; C6.2 G1).

**GUI form.** A **Keybindings pane in the Settings window** (root spec C5 §9's window, beside
Environment, Engine, ConfigHome, Storage, Developer), holding: the resolved binding set grouped
by the focus regions of C-59, each row showing chord, action, source (*default* or *your file*)
and status (*active*, *inert here*, *reserved*, *collides with a menu item*); the validation
records of C-57 with line numbers; and a *Reveal in Finder* / *Open in editor* action. **It does
not write the file** — root spec §7.8 forbids any write under the config home, and
`keybindings.json` is under it, so afleet's editor is a *reader* with an escape hatch to the
user's own editor, exactly as `/keybindings` ends up being. Keep the refusal for the typed
command and make its sentence point at this pane rather than at the terminal (root spec §7.7's
never-send-them-back rule, and the `[parent-impact]` C6.2 filed and `main` resolved at `6abd4a0`).

```
┌ Settings ▸ Keybindings ──────────────────────────────────────────────────────┐
│ ~/.claude/keybindings.json          ● loaded · 2 issues     [Open in editor] │
│                                                                              │
│ ⚠ line 14  Unknown action "chat:sumbit" for "cmd+;" in Chat — this binding   │
│            is ignored.  Did you mean "chat:submit"?                          │
│ ⚠ line 22  "cmd+w" may not work: macOS close window/tab                      │
│                                                                              │
│ Composer (Chat)                                                              │
│   ⌘;        chat:submit         your file    ⚠ ignored                       │
│   ⌃X ⌃K     chat:killAgents     default      active                          │
│   ⌃O        command:compact     your file    active → /compact               │
│ Completion popover (Autocomplete)                                            │
│   ⇥         autocomplete:accept default      active                          │
│ No region here (Footer, Tabs, Plugin, …)                                     │
│   ⌃F        footer:next         your file    inert in afleet                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Drops / keeps / gains.** Drops: the template writer, the external-editor spawn, all four
outcome strings and the lie in the success pair. Keeps: the file as the source of truth, and the
user's own editor as the way to change it. Gains: a real editor-grade view with live validation,
per-binding status and collision warnings `[exceeds]`.

**Open.** **For the owner:** §7.8's never-write rule means afleet cannot offer *edit* here.
Is `keybindings.json` worth a second carve-out (the first is the project's
`.claude/settings.local.json`, §6.12), or does read-plus-reveal suffice? `tui-parity` gap 8
assumes a GUI writes; afleet's own rule says it must not.

### C-64 · The `keybindings-help` skill

**Terminal.** A bundled model skill, `userInvocable: false`, `allowedTools: ["Read"]`, whose body
is reproduced verbatim in SPEC 42.9: eight fixed sections (`CRITICAL: Read Before Write`,
`File Format`, `Keystroke Syntax`, `Unbinding Default Shortcuts`, `How User Bindings Interact with
Defaults`, `Common Patterns`, `Behavioral Rules`, `Validation`, `Reserved Shortcuts`) plus three
tables generated from the live binding set — the contexts (with `ProactivityMenu` filtered out),
the actions, and the reserved keys under the source's own headings
`### Non-rebindable (errors)`, `### Terminal reserved (errors/warnings)` and
`### macOS reserved (errors)`. Its Behavioral Rule 3 tells the model to warn about `ctrl+b` and
`ctrl+a`, which is unrelated to the runtime tmux accommodation of C-52. It is how a user actually
edits `keybindings.json`: they ask the model to do it.

**Job.** Let "rebind Escape to something else" be a sentence rather than a JSON exercise.

**Wire.** P — *"the skill ships inside the binary and is model-invocable in any mode, headless
included"*, with the consequence that *"If the GUI writes bindings, it inherits whatever the model
produces from this skill"* (`tui-parity` §42.9).

**afleet today.** `undesigned`, and reachable anyway: the skill lives in the engine afleet hosts,
so a user who asks the agent in an afleet channel to rebind a key gets the same edit, written to
the same file, which afleet would then hot-reload (C-54). That is a channel through which afleet's
own state changes without afleet doing anything — worth knowing before C-61's pane claims to be
the source of truth.

**GUI form.** No surface of afleet's own. Two consequences to design for. (a) **The file can
change under afleet at any time**, by the model's hand as well as the user's, which is the real
argument for the hot reload of C-54 rather than a read at launch. (b) **afleet's keybindings pane
must not contradict the skill**: the skill's own rules — additive merge, `null` to unbind, move =
unbind plus add — are the rules of C-55, so a pane that explains them differently produces a user
who trusts neither. If afleet ever ships a "rebind this" affordance, routing it through the agent
and this skill is cheaper and more consistent than writing the file itself — and it sidesteps
§7.8, because the *engine* writes, not afleet.

**Drops / keeps / gains.** Drops: nothing (the skill is not afleet's to port). Keeps: its rules as
the rules afleet's pane states. Gains: a legitimate write path that does not violate the
never-write rule `[exceeds]` — the model edits the file through the engine.

**Open.** **For the owner:** is "ask the agent to rebind it" the answer to C-61's write problem?
It is the only route that exists today.


---

## 11 · Settings and environment that touch input

### C-62 · The settings that change how the composer behaves

**Terminal.** Fourteen keys touch input (SPEC 42.24.1), and only six have a `/config` row:
`editorMode` (`Editor mode`), `respectGitignore` (`Respect .gitignore in file picker`),
`leftArrowOpensAgents`, `copyOnSelect` (fullscreen only), `askUserQuestionTimeout` and
`externalEditorContext` (`Show last response in external editor`, or `Show responses in IDE` in
the IDE wording), plus `promptSuggestionEnabled` in the `Input & controls` group. The other
seven are **hand-edited JSON only**: `keybindingFlavor` (deprecated and inert),
`vimInsertModeRemaps`, `statusLine.hideVimModeIndicator`, `defaultShell` (*"Default shell for
input-box ! commands. Defaults to 'bash' on all platforms (no Windows auto-flip)"*),
`fileSuggestion`, `emojiCompletionEnabled` and `respondToBashCommands`. The `/config` panel's own
group is literally named `Input & controls` and contains `editor`, `askUserQuestionTimeout`,
`modelProposedGoals`, `copyOnSelect`, `promptSuggestionEnabled`, `agentsView`, `checkpoints`,
`workflows`, `workflowKeywordTriggerEnabled` and `artifacts`. **There is no `/config` row for
paste behaviour.** The `editorMode` row writes the **user** settings file; `~/.claude.json` is a
read-only legacy fallback for it and fifteen siblings.

**Job.** Let a user change how their prompt behaves without reading the source.

**Wire.** P for the readable ones through `get_settings.effective`; **R for user-scope writes**,
because `update_settings` writes **localSettings only**, so changing a user-scope value means
writing `~/.claude/settings.json` (`tui-parity` §42.24.1). The six with no `/config` row are where
*"A GUI settings panel that surfaces these exceeds the TUI, which requires hand-editing JSON."*

**afleet today.** `built` for three, `undesigned` for the rest.
`App/Header/SettingPickers.swift` reads `get_settings.applied.model`, `applied.effort` and
`permissions.disableBypassPermissionsMode`, plus `list_models` and the handshake's
`current_permission_mode`; it writes through `set_model`, `apply_flag_settings` (`effortLevel`
only) and `set_permission_mode`. `update_settings` appears nowhere in `App/Header/` — it is
reachable only through `outputStyle`, which the pickers do not own. The Settings window's panes
are `Environment`, `Engine`, `Config home`, `Storage`, `Developer`: **no input pane**. And
`editorMode` is read by nothing: grepping `editorMode`, `editor_mode`, `vim` and `emacs` across
`App`, `FleetKit`, `ClaudeWire`, `AfleetCore` and `Workbench/Sources` returns zero Swift hits.

**GUI form.** Add an **Input pane** to the Settings window, and make it read-only-plus-explain
where afleet cannot write. Read every key above off `get_settings.effective` and show each with
its **source** (`policySettings`, `projectSettings`, `userSettings`, …), which
`get_settings.sources` already carries and which matters far more in afleet than in the terminal:
a shared repo can set `editorMode`, `defaultShell` or `fileSuggestion` for a user who never asked
(C-06). Three values change composer behaviour directly and should be shown beside the surface
they affect rather than only in a pane: `respectGitignore` next to the `@` picker (C-31),
`defaultShell` next to the `!` badge (C-17) — though afleet's host-side shell reads
`ResolvedEnvironment.shell` and does **not** consult `defaultShell` today, which is a divergence
worth either closing or stating — and `promptSuggestionEnabled`, which afleet already exposes per
channel in the header. Writes: `update_settings` covers only `outputStyle`, and §7.8 forbids
writing `~/.claude/settings.json`, so the pane's honest verb for a user-scope value is *Reveal in
Finder*, exactly as for keybindings (C-61).

**Drops / keeps / gains.** Drops: `keybindingFlavor` (inert), `copyOnSelect` (fullscreen-only),
`leftArrowOpensAgents` (C-04), `vimInsertModeRemaps` and `hideVimModeIndicator` (C-06/C-07).
Keeps: the readable set, the `Input & controls` grouping as a template, the settings' own schema
sentences as copy. Gains: the seven JSON-only keys made visible, each with its source `[exceeds]`.

**Open.** **For the owner:** afleet's `!` uses `ResolvedEnvironment.shell` and ignores
`defaultShell`. Close the gap or document it?

### C-63 · Environment variables

**Terminal.** Twelve variables touch input (SPEC 42.24.6). Three matter to a host.
**`CLAUDE_CODE_SKIP_PROMPT_HISTORY`** suppresses all prompt-history writes.
**`CLAUDE_CODE_KB_COHESION_FIXES`** has six distinct effects, all through one read: `task:background`
leaves the single-key pass unless rebound; Up and Down walk a queued-message selection index
instead of pulling the whole queue back; `escape` leaves a non-prompt mode from any cursor offset;
Escape's queue handling changes; submission changes while a queue-edit selection is live; and
exit-hint labels switch from hard-coded key names to resolved binding text.
**`CLAUDE_CODE_GLOB_TIMEOUT_SECONDS`** overrides the ripgrep timeout for the shared file index
(default 20 000 ms, 60 000 on WSL), so it changes what `@` can find. The rest are terminal
plumbing: `CLAUDE_CODE_SESSION_KIND=bg` (disables `ctrl+z` suspend),
`CLAUDE_CODE_BS_AS_CTRL_BACKSPACE` (whose fallback is dead — the only caller passes the literal
`"darwin"`, so the effective default is **false on every platform**), `CLAUDE_CODE_ALTGR_AS_TEXT`
(three levels: the variable, then the host-reported `wtSession`, then `WT_SESSION`),
`CLAUDE_CODE_ENABLE_MENU_KIND_LANES`, `CLAUDE_CODE_ACCESSIBILITY`, `CLAUDE_CODE_NATIVE_CURSOR` and
`CLAUDE_CODE_TMUX_PREFIX_CONFLICTS`. Six gates also touch input, of which two are on by default:
`tengu_keybinding_customization_release` and `tengu_left_arrow_editing_guard`.

**Job.** Let an operator change input behaviour without a settings file.

**Wire.** Mixed: R for the two the host must honour itself, P for the glob timeout (an env var on
the child), T for the decoder and cursor ones, **D for the gates** — *"not readable over the
wire"*.

**afleet today.** `built` for the mechanism, `undesigned` for the meaning. Each channel captures a
`ResolvedEnvironment` once (C6.2's X11 rule) and the Settings window has an `Environment` pane, so
afleet already owns what the child sees. Nothing reads any of these names.

**GUI form.** Honour exactly two, and ignore the rest by design. (a)
**`CLAUDE_CODE_SKIP_PROMPT_HISTORY`** — if afleet ever writes history (C-33), it must honour the
variable in its own writer, not merely pass it to the child; `tui-parity` §42.24.6 says so
directly. (b) **`CLAUDE_CODE_GLOB_TIMEOUT_SECONDS`** — pass it through and surface it in the Input
pane beside the `@` picker, since a monorepo user who set it wants to know it applied. Ignore
`CLAUDE_CODE_KB_COHESION_FIXES`: five of its six effects are terminal-only and the sixth
(per-entry queue selection) is what C-38 builds unconditionally, so afleet ships the good half
without the flag. Ignore every decoder and cursor variable. Show the whole resolved environment in
the Environment pane, which afleet already does and the terminal cannot `[exceeds]`.

**Drops / keeps / gains.** Drops: nine variables and all six gates. Keeps: the history
suppression, the glob timeout, the resolved-environment capture. Gains: an environment a user can
see `[exceeds]`.

**Open.** None.

---

## Ranking input

| Card | Surface | afleet status | User value | Build cost | Depends on |
|---|---|---|---|---|---|
| C-01 | Composer field and its border | built (no border, no tint) | med — carries one state for free | S — a stroke and a badge | C-17 |
| C-02 | Editor buffer, control keys, word motion | superseded (`NSTextView`) | low — already native | — | — |
| C-03 | Kill ring | superseded (AppKit) | low | — | — |
| C-04 | Left-arrow guard | superseded (panel nav) | low | — | — |
| C-05 | Undo, `chat:undo`, `chat:newline` | built (undo does not cover attachments) | med — an accidental paste is undoable | S | C-16 |
| C-06 | Editor mode `vim` — the recommendation | undesigned | med — a policy file can set it silently | S to disclose, L to implement | C-62 |
| C-07 | Vim indicator and `/vim` | built (refusal only) | low | — | C-06 |
| C-08 | Multi-line entry, Shift+Enter | built | high — already right | — | — |
| C-09 | Apple Terminal probe, `/terminal-setup` | superseded | low | — | — |
| C-10 | Paste detection and the paste hook | built (sniffed intake, better than canon) | high | — | — |
| C-11 | Text placeholders → paste chip | superseded / replacement undesigned | high — a 4000-line paste today | M — chip, popover, submit splice | C-13, C-16 |
| C-12 | Oversized-draft truncation | superseded (field scrolls) | low | — | C-11 |
| C-13 | Expansion at submit time | undesigned (nothing to expand yet) | med | S with C-11 | C-11 |
| C-14 | Paste storage and the paste cache | designed-as-gap | low unless history ships | M | C-33 |
| C-15 | Image paste and the clipboard hint | built and better | high | S for thumbnails | C-16 |
| C-16 | The attachments strip | built (chips, click-to-remove) | med — mis-affordance on the chip body | S — hover `×`, Quick Look, keyboard | — |
| C-17 | `!` bash mode: entering, indicator, leaving | undesigned as a mode | **high — the user cannot see that Enter runs a command** | S — badge, tint, hint collapse | C-01, C-22 |
| C-18 | What the composer shows while `!` runs | built and invisible | **high — up to 120 s of nothing** | S — strip, elapsed, Stop | C-17 |
| C-19 | `@` mentions: trigger, token, providers | built, narrow | high — keyboard and CJK rules missing | M | C-24, C-27, C-31 |
| C-20 | `#` — Slack channels, not memory | undesigned | low — only with a Slack MCP server | M if ever | C-24 |
| C-21 | `/` — the slash trigger | built, minimal | med | S | C-29 |
| C-22 | The empty-prompt hint row | designed, not built | **high — the only discovery surface** | **S — four labels** | C-17 |
| C-23 | Provider dispatch and precedence | built (two providers, no dispatcher) | med — plumbing for C-27 | S | C-27 |
| C-24 | The completion menu | built, one shape | high — no selection, no match bolding | M | C-23 |
| C-25 | Ghost text | built (prompt suggestion, not canon's ghost) | med | S inline; M for shell-history ghost | C-32 |
| C-26 | Unified `@` provider | built, files only | low in v1 | M | C-31 |
| C-27 | Accept semantics (Tab / Enter / click) | undesigned | **high — the rule users notice** | M | C-24, C-19 |
| C-28 | Tab's other duties and async | built in part | med — spinner and submit block | S | C-27 |
| C-29 | Slash rows, argument hints and completions | built, thin | high — argument rows for `/model`, `/effort`, `/permissions` | M | C-21, C-24 |
| C-30 | Slash-command ranking | built as `.sorted()` | med — case-sensitivity is a papercut | S for case + ladder, M for recency | C-29 |
| C-31 | File suggestions and the file index | built by delegation (correct) | high — retry on the async index | S | C-19 |
| C-32 | Up and Down: recalling a prompt | undesigned | high — every terminal user reaches for it | M | C-33 |
| C-33 | `history.jsonl`, the store, interop | designed, not built | high (read) / owner call (write) | M read, L write + policy | §7.8 decision |
| C-34 | `ctrl+r` and the history palette | undesigned | med-high — reuses the switcher shape | M | C-33 |
| C-35 | Why `enter` is special | built | high — already right | — | C-59 |
| C-36 | Queueing during a turn | built engine-side | med — no submit-time signal | S | C-37 |
| C-37 | Rendering the queue | built (count + label + Cancel) | **high — the lane's biggest loss** | M — rows, actions, grouping | C-38, C-39 |
| C-38 | Queue editing: pull-back and cancel | cancel built, edit undesigned | high | M on the existing cancel path | C-37 |
| C-39 | Draining: the batch rule | built as one turn per entry | med — cost and latency, not correctness | S to show, unverified to control | C-37 |
| C-40 | Mid-turn absorption, `chat:queueSubmit` | undesigned as a surface | med — steering vs waiting | S label, M menu item | C-37 |
| C-41 | `/btw` | built (routed to `side_question`) | med — needs a home and a highlight | S | C-22 |
| C-42 | Escape and the double-press helper | built (top rung, accidentally correct) | high — idle branch missing | S | C-38 |
| C-43 | Ctrl-C, Ctrl-D, exit vs detach | superseded | med — the detach wording | S (copy) | — |
| C-44 | Ctrl-Z | superseded | low | — | C-58 |
| C-45 | `chat:killAgents` | built as *Stop everything* | high — already right | S — itemise the sheet | C-37 |
| C-46 | `chat:clearInput` / `clearScreen` | superseded (canon bug) | low | — | C-59 |
| C-47 | `chat:externalEditor` | undesigned | low-med | S | — |
| C-48 | `chat:stash` | invariant already held | low | — | — |
| C-49 | `Shift+Tab`: the mode ring | built | high — already right; disabled rows would help | S | C-62 |
| C-50 | `confirm:cycleMode` | card built, chord unscoped | med — the chord breaks the sheet today | S | C-59 |
| C-51 | `app:*` toggles and `/focus` | superseded / focus undesigned | low-med | M for a density control | — |
| C-52 | `task:background` and the tmux prefix | built | med — per-task Background button | S | — |
| C-53 | Unbound `strip:*` / `proactivityMenu:*` | undesigned (correct) | low | — | C-59 |
| C-54 | `keybindings.json`: file, gating, hot reload | out-of-scope (§17.8) | high for terminal users | M | owner |
| C-55 | Merge order and `null` unbinding | out-of-scope | high — fidelity or nothing | S with C-54 | C-54 |
| C-56 | `command:` bindings | out-of-scope | med | S with C-54 | C-54, C-21 |
| C-57 | Validation and every warning string | out-of-scope | med-high `[exceeds]` | M | C-54, C-61 |
| C-58 | Reserved keys | out-of-scope | med — afleet's own table is needed anyway | S | C-60 |
| C-59 | The 26 contexts → focus regions | undesigned | high — the honouring model | M | C-54 |
| C-60 | Default table → the macOS menu bar | built (nine shortcuts, no menus) | **high — the menu bar is nearly empty** | M | C-51, C-52, C-34 |
| C-61 | `/keybindings` → a keybindings pane | undesigned | med — blocked from editing by §7.8 | M | C-57, C-59 |
| C-62 | Settings that touch input | three built, the rest undesigned | med — sources matter in a shared repo | M | C-06, C-31 |
| C-63 | Environment variables | mechanism built, meaning unread | low-med | S | C-33 |
| C-64 | The `keybindings-help` skill | undesigned (reachable through the engine) | med — a write path that respects §7.8 | S | C-54, C-61 |

---

## For the map

- **One popover, five providers.** C-19, C-20, C-21, C-24, C-26, C-29, C-30 and C-34 all want the
  same widget: a caret-anchored list with a selection, bolded match spans, hover-overrides-keyboard
  and `Escape` to dismiss. afleet has two hand-rolled `.thinMaterial` lists with no selection.
  Building the widget once is the precondition for six cards, and the quick switcher already
  demonstrates the interaction afleet wants.
- **The composer region is overloaded and needs a strip stack.** Six surfaces compete for the space
  directly above the field: the hint row (C-22), the queue strip (C-37), the shell-running strip
  (C-18), the refusal sentence, the edit note, and the rewind confirmation. They are mutually
  exclusive in practice but nothing says so; a single ordered strip slot with a documented
  precedence (running > queue > refusal > note > hint) prevents the pile-up that the terminal
  avoids only because it has one line to spend.
- **Never steal the composer mid-draft.** The terminal's stash (C-48), its draft-restore on the
  first Up (C-32), its `popAllEditable` merge (C-38) and afleet's own three prefill rules
  (*a prefill is written only over the words the edit began with*) are the same principle four
  times. Every new surface that writes into the field — history recall, queue edit, ghost accept,
  fork prefill — must check it first.
- **A ladder becomes a button plus Undo.** Every "press again within 800 ms" in canon (C-42, C-43,
  C-45, and the left-arrow guard of C-04) exists because a terminal has one key and no buttons and
  no undo. The GUI translation is mechanical: a named control, a confirmation sheet when the act is
  destructive, and `⌘Z` when it is not. This is the single most repeated translation in the lane.
- **Read the engine's settings; do not fork them.** C-06 (`editorMode`), C-31
  (`respectGitignore`, `fileSuggestion`), C-62 and C-63 all reduce to the same move: read
  `get_settings.effective` *with its `sources`*, show the value and where it came from, and never
  write under `<configHome>`. A project or policy file can change a user's input behaviour without
  them knowing, and afleet is the only one of the two apps that can show them.
- **Discovery is a first-class surface, and afleet has none.** The terminal spends four dim strings
  and a placeholder on teaching (C-22, C-25, C-29's argument hints, C-32's `search history` hint).
  afleet's field has no placeholder text at all. Every one of these is a label, not a feature.
- **Two apps, one history and one keybindings file — or two products.** C-33 and C-54 hit the same
  wall from opposite sides: the shared state a user expects to be shared lives under
  `<configHome>`, which root spec §7.8 forbids afleet to write. The decision is a product decision,
  it is the same decision twice, and it should be made once.
- **afleet's refusal sentences are better copy than canon's, and there are now twenty of them.**
  `RouterTable`'s terminal-only explanations, `ShellEscape`'s four sentences, the queue's two
  cancel refusals, `EditAndRewind`'s nine — all written to the same standard (say what happened,
  say where the user's words are). They are an asset; the gap is that several are shown by views
  nobody reads (C6.2's own gate audit flags `editNote` and `interceptedReplacements` as
  reader-less). Wiring the existing sentences to a visible surface costs less than writing new ones.

---

## Spec defects

- **`tui-parity` §42.20.4 states the drain rule backwards.** Its row says the batch drains *"all
  consecutive same-mode plain prompts … stopping at a slash command"*. SPEC 42.20.4 says the scan
  covers the **whole** queue, is **not** consecutive, and a slash command **fails the predicate and
  is skipped over, leaving the scan running** — only `screeningPending`, `promptSubmitted` or
  `drainOnly` latch it closed. `[plain, slash, plain]` drains both plain entries. A host that
  builds to the parity row will render the wrong grouping (C-39).
- **`tui-parity` §42.4 says 23 contexts; SPEC 42.4 at 2.1.263 lists 26.** The area file was written
  against 2.1.257 and omits `AbovePrompt`, `AbovePromptInput` and `AbovePromptSelect` from its
  count. The task prompt inherits the 23. Anything that maps contexts to regions (C-59) needs the
  26.
- **Root spec §13 describes a feature that does not exist.** *"`history.jsonl` is read for seeding
  the composer history only"* implies a composer history; there is none — no reader, no store, no
  `↑`/`↓` handler in `App/Composer/`. The line should read that history is not implemented (C-32).
- **Root spec §7.8 and `tui-parity` gaps 1 and 8 are in direct conflict, and neither cites the
  other.** The parity inventory tells the host to ship a keybindings editor and to write
  `history.jsonl`; §7.8 forbids every write under `<configHome>`. Both documents are internally
  consistent and jointly unimplementable (C-33, C-61).
- **SPEC 42.15.6 records an asymmetry that is a bug, not a rule.** An unavailable `[Pasted text #N]`
  is removed and reported; an unavailable `[Image #N]` is left in both the display and expanded
  forms and **never reported**, so a dangling `[Image #3]` string reaches the model. Noted in
  C-13; the chapter states the behaviour without flagging it.
- **SPEC 42.24.2's `/keybindings` success strings can lie.** The launcher returns
  `{content: null}` with no `error` when no editor resolves, and the command tests only `o.error`,
  so a user with no `$EDITOR`, `$VISUAL` or recognised GUI editor is told
  `Opened … in your editor.` The chapter documents this correctly; it is listed here because any
  host that copies the outcome strings inherits the lie (C-61).
- **`tui-parity`'s own Unverified list still contains the one thing `@` depends on**:
  *"`@`-mention expansion for headless `user` frames … I did not trace the headless call site
  end-to-end."* Every card that sends a literal `@path` (C-19, C-26) rests on it.
