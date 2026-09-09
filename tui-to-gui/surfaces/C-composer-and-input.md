# Lane C — composer and input

**Date:** 2026-09-09. **Canon:** Claude Code 2.1.263 (`~/claude-code-bundle/2.1.263/SPEC/`,
`cli.pretty.js`).

**SPEC read (by section, not skimmed):** 42.4–42.8 (contexts, action catalogue, the whole default
binding table, `keybindings.json`, validation and every warning string), 42.12 (editor buffer,
control-key map, named keys, kill ring, left-arrow guard, undo), 42.13 (vim), 42.14 + 42.14.1–2
(multi-line, Apple Terminal probe, `/terminal-setup`), 42.15.1–8 (paste), 42.16.1–4 (`!` `@` `#`
`/`), 42.17.1–8 (autocomplete engine), 42.18.1–7 (file suggestions and the index), 42.19.1–4
(history and `ctrl+r`), 42.20.1–6 (submit, queue, drain, mid-turn absorption, `/btw`), 42.21.1–2
and 42.21.4–12 (interrupt ladder; 42.21.3 is lane F's), 42.22.1–7 (`Shift+Tab`), 42.23.1–3,
42.24.1–7. Also SPEC 41.15.8 (autocomplete menu rendering), 41.16.4 (input box border),
41.24.5 (paste feedback), 41.25 (`/terminal-setup`, cross-read), and 28-slash-commands §21
(slash autocomplete ranking, rows, argument hints, ghost text).

**afleet read:** root spec §6.6, §7.7, §8.1, §8.5, §8.6, §8.7, §13, §14 items 11–12;
`docs/doperpowers/specs/2026-09-08-c6.2-composer.md` in full (Design, gate audit, Decision Log,
`[parent-impact]` filings, *Engine facts settled at grill time*); every file under `App/Composer/`
(`ComposerModel`, `ComposerField`, `ComposerShortcuts`, `ComposerView`, `ComposerMount`,
`CommandRouting`, `CommandCompletionView`, `FileMentions`, `GhostText`, `QueueChip`,
`QueueChipView`, `Attachments`, `RefusalSurface`, `ShellEscape`, `EditAndRewind`,
`ChannelSurfaceState`, `README.md`); `App/Header/SettingPickers.swift` (mode/model/effort
readbacks, via C6.2 §*The pickers*); `App/Shell/PanelKeyboardFocus.swift` (via
`ComposerShortcuts`); `FleetKit/.../Router/CommandRouter.swift` (via C6.2 and
`CommandRouting.swift`); `docs/tui-parity/areas/42-input-keybindings.md` in full and
`docs/tui-parity/README.md` §A-42.

**Clone evidence carried:** `CC-to-SDK/docs/parity/spec-crosscheck-2026-09-03.md` finding **X3**
("Esc / Ctrl-C during a running turn empties the queue into the composer. Canon (220, 251 and
257 alike): running turn → abort and return; the pop-to-composer is the *idle* branch") and its
defect 4 ("Canon drains every same-mode queued prompt into one turn; ours runs one turn per
entry").

**Verification spent** (greps of `/Users/new/claude-code-bundle/2.1.263/cli.pretty.js`): the four
queued-message placeholder hints at `:509734` and `:509736`; `paste again to expand` at `:506684`;
`Esc again to clear` at `:627073` with `timeoutMs: 1000`; `double tap esc to clear input` at
`:507067`; the left-arrow constants and both hint strings at `:626107`; `Ctrl+Y to paste deleted
text` at `:627109`; `No background agents running` at `:499683`.

**Denominator:** every item the task listed, in 52 cards. **Additions I found and added:** the
empty-prompt hint row (`! for shell mode` / `@ for file paths` / `/ for commands` / `/btw for side
question`, SPEC 42.16.2), which the root spec's §8.1 wireframe already draws as a shortcut bar but
which no built code renders (C-22); the slash-command *usage-recency* ranking of SPEC 28 §21.2,
which is a real ordering the GUI would otherwise lose (C-30); and `/focus` versus `app:toggleBrief`
as two independent states (C-49).

---

## Headline

1. **The queue is afleet's biggest single loss.** The terminal renders each queued prompt as a
   read-only user row above the input, lets Up pull *all* of them back into the draft as editable
   text, and drains **every same-mode plain prompt as one turn** — skipping over slash commands
   rather than stopping at them (SPEC 42.20.4). afleet's `QueueChipView` shows a count, a label and
   a *Cancel* button, and nothing else: no edit, no reorder, no pull-back, no "these will run as one
   turn" (C-37…C-40). Edit is reachable today as cancel + re-send, which is exactly the
   decomposition `tui-parity` §42.20.3 already recorded.
2. **`!` shell mode has no visible mode at all in afleet.** The terminal switches the prompt glyph
   to `!`+NBSP, tints the whole input border `bashBorder`, keeps the `!` out of the buffer, and
   leaves on Backspace/Escape at offset 0. afleet's `ShellEscape` reads the leading `!` off the
   *submitted* text — the user is typing into an ordinary field with no signal that Enter will run
   a command on their machine (C-17). And while it runs, nothing is drawn: the only feedback is a
   post-hoc refusal sentence (C-18). This is the cheapest high-value fix in the lane.
3. **`~/.claude/keybindings.json` should be honoured, and the honouring model is a
   context→region map plus a menu-bar projection, not a chord table.** Root spec §13 says "not
   yet". Nine of the terminal's 26 contexts have a real afleet focus region (Chat→composer,
   Autocomplete→completion popover, Confirmation→decision card, Scroll→timeline, Transcript→timeline,
   Task→task row, MessageSelector→edit picker, Settings→Settings window, Attachments→tray); the
   rest are terminal-only. Global-context chords become **menu-bar items with visible equivalents**,
   which is where afleet's menu bar earns its keep (C-44, C-45). A native app can also bind
   `ctrl+i`, `ctrl+m`, `ctrl+[`, `ctrl+h` and `capslock` that the terminal had to reserve `[exceeds]`.
4. **Vim mode: do not implement it; do disclose it.** `editorMode` is a persisted setting resolved
   from *every* enabled settings source (SPEC 42.13.8), so a project or policy file can turn it on
   without the user ever typing `/vim`. afleet mentions it nowhere. Implementing SPEC 42.13's exact
   scope — 4 modes, 3 operators with count multiplication, 15 text-object pairs, dot-repeat over 18
   recorded change kinds, and the `escape`-belongs-to-vim-unless-NORMAL precedence — is an L, and
   a divergent vim is worse than none. Recommendation: read `editorMode` from
   `get_settings.effective`, and when it is `vim`, say so once in the composer's settings menu.
   Otherwise afleet's Esc-is-always-interrupt silently contradicts the user's own setting (C-06).
5. **Accept semantics are load-bearing and afleet has none of them.** Tab never executes; Enter
   with nothing selected dismisses and submits the line as typed (for exactly four
   `suggestionType`s); `@` does longest-common-prefix completion first, so a **single match needs
   two Tabs**; file/Slack/resume/MCP-template menus deliberately start with nothing selected
   (SPEC 42.17.6). afleet's completion lists are click-only — Tab is spent entirely on ghost text,
   Enter goes straight to send, and arrow keys do not move a selection (C-27, C-28).
6. **Paste placeholders are the one terminal workaround the GUI should replace and then pay back.**
   `[Pasted text #N +M lines]` exists because a terminal cannot draw a chip; afleet should keep
   pasting text as text and add a chip for a large paste. But `history.jsonl` stores the
   *placeholder* form with the ≤1024-char inline / content-hash split (SPEC 42.19.1–2), so a GUI
   that never writes it stops sharing history with the terminal — which root spec §13 already
   concedes and should now schedule (C-10, C-13, C-32).
7. **The interrupt ladder should not be ported as a ladder, but two of its rungs must survive.**
   Double-press exists because a terminal has one key and no buttons. Keep: `chat:killAgents`'s
   *content* (`interrupt {cancel_queued:true}` plus one `stop_task` per live id — plain `interrupt`
   does **not** stop tasks), which afleet already has as *Stop everything*; and the exit-vs-detach
   distinction (`Press Ctrl-C again to detach (session keeps running)`), which is precisely afleet's
   background-channel case (C-41, C-42).

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
seeding the composer history only, never written; print sessions neither read nor write it."

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
