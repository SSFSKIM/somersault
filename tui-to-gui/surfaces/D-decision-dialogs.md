# Lane D — decision dialogs

**Date.** 2026-09-09. **Canon.** Claude Code 2.1.263 (`/Users/new/claude-code-bundle/2.1.263/`).

**What this lane covers.** Every terminal dialog that asks the user to decide something during a
session: the dialog widget system itself, the permission family and all its routes, plan mode,
`AskUserQuestion`, MCP elicitation, the two forwarded dialog kinds, the consent and trust gates,
and the confirmations the terminal raises on its own.

**SPEC 263 read.** `41-tui-rendering.md` §41.22.1–41.22.12 (whole block);
`24-permission-system.md` §24.14.1–24.14.6, §24.15.1–24.15.5, §24.17.1–24.17.4, §24.18.3,
§24.19, §24.20.3, §24.20.9; `25-bash-command-analysis.md` §25.20, §25.22.4;
`21-plan-mode-and-questions.md` §5.5, §5.6, §6.9, §7.1–7.7, §8, §11, §12.6–12.13;
`26-auto-mode.md` §26.16.8, §26.17.4, §26.20.2, §26.21.3; `31-mcp-client.md` §15.1–15.4;
plus targeted greps into 03/10/17/22/23/30/33/34/36/37/38/42/46/47/48.

**afleet files read.** Root spec `docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md`
§6.11, §6.12, §7.6, §8.4, §8.6; `docs/doperpowers/specs/2026-09-08-c6.3-decisions.md`;
`App/Decisions/{DecisionCard,DecisionAnswerMapping,DecisionCardView,PermissionCardView,PlanCardView,QuestionCardView,DialogCardView,ElicitationCardView,ElicitationForm,DecisionAnswering,RetractionRegistry}.swift`;
`App/Consent/{ConsentSheet,TrustBanner,ChannelDecorations,PrecommitModel}.swift` and both READMEs;
`docs/tui-parity/README.md`, `docs/tui-parity/areas/24-21-permissions-plan-questions.md`,
`.../26-auto-mode.md`, `.../41-tui-rendering.md`.

**somersault clone read.** `CC-to-SDK/docs/parity/tui-ux.md` §4 and the F6 / Wave T sections;
`docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md`;
`docs/superpowers/specs/2026-07-31-tui-clone-fidelity-design.md` (F6 part);
`docs/parity/spec-crosscheck-2026-09-03.md`.

**Verification spent (`cli.pretty.js` at 2.1.263).** Nine greps, chosen where a card's GUI form
turns on the literal:

| What | Result |
|---|---|
| `title: "Bash command"` | `:518740` — full Bash dialog JSX; three title variants, description line, warning line, `Do you want to proceed?`, footer |
| `action: "amend"` | `:15099` — `tab to amend` exists and is **conditional**; there is no `ctrl+e explain` anywhere in the build |
| `uD = { accept:…, reject:… }` | `:15117` — the two feedback placeholders, verbatim |
| `"Edit file"` / `"Create file"` | `:370450`, `:370458` — file-dialog titles and the withheld-content sentences |
| `Do you want to ` (all sites) | `:15110`, `:519963`, `:516356`, `:520914`, `:520535`, `:110809` — the per-family question lines |
| `Yes, and don't ask again` (all sites) | `:14493`, `:15517`, `:516271`, `:520158`, `:520655`, `:520669`, `:520814`, `:477050` — every persistent row is built from a **narrow suggestion display string**, never a bare tool name |
| `var Xw = 150` | `:643765` — the dialog input-grace constant |
| `chord: "ctrl+e"` | `:374856` — only the agents view; not a permission affordance |
| `"explain"` | `:364564`, `:758677` — a syntax-highlighter keyword and a feedback-category enum; no explain pane exists |

**Denominator additions and corrections** (all listed in the task prompt were covered; these are
changes to what the prompt assumed):

1. **There is no `ctrl+e explain` in the consult footer at 2.1.263.** The footer is
   `escape to cancel · tab to amend`, and `tab to amend` appears only while no feedback input is
   already open (`cli.pretty.js:15099`). Card D-22 records this.
2. **The permission dialog has no destination picker.** Every "don't ask again" row files to
   `localSettings` and nowhere else (SPEC 24.15.5). The three-way picker
   (`localSettings`/`projectSettings`/`userSettings`) belongs to `/permissions` → "Add a new
   rule…" only. afleet's permission card *adds* a picker; card D-21 rules on whether that is a
   legitimate `[exceeds]` or an over-grant.
3. Added, found in the family and not listed: `permission_powershell` (D-13),
   `permission_monitor` and `permission_browser` (D-19), the artifact-review step of the plan
   dialog (D-27), the teammate plan-approval pair (D-30), the `mcp_elicitation_waiting` dialog as
   a surface distinct from URL mode (D-36), and the API-key trust dialog (D-46).

## Headline

- **The permission dialog is not one dialog, it is twelve.** SPEC 24.14.2 declares twelve dialog
  kinds, each with its own title, its own body renderer and its own question sentence
  (`Do you want to proceed?` for a command, `Do you want to <verb> <file>?` for a file,
  `Do you want to allow Claude to fetch this content?` for a fetch). afleet's
  `PermissionCardView` is a single generic card with a title, a description line and a
  tool-input view; every route-specific line the terminal draws — the Bash `(unsandboxed)` /
  `(runs on <host>)` title, the destructive `Note: may …` warning, the `Create file` /
  `Overwrite file` distinction, the withheld-content sentences — is absent. Cards D-11–D-20.
- **afleet's biggest loss is the `Note: may …` warning line.** SPEC 25.20 gives sixteen
  destructive patterns whose warning is rendered in `warning` colour immediately above
  `Do you want to proceed?`. It is the only thing between a user and `git push --force`, it costs
  nothing to reproduce (the pattern table is closed and public), and the built card shows nothing.
  Card D-11.
- **"Yes, and don't ask again" is a narrow rule, not a whole-tool grant — and afleet's destination
  picker widens it in a second way the terminal never does.** Every canon row is built from the
  engine's suggestion display string (`cli.pretty.js:520655`, `:520669`, `:14493`) and always files
  to `localSettings` (SPEC 24.15.5). afleet's picker offers `userSettings` and `projectSettings`
  too. That is a defensible `[exceeds]` for a GUI with room to explain, but it must show the rule
  text it is filing and the file it is filing into. Card D-21.
- **Esc is a soft ask, not a deny — and afleet has no soft-reject.** SPEC 24.14.5's `cancelled`
  branch returns `{behavior:"ask", message}`, aborting the turn, with three sub-branches
  (external racer → soft ask and no abort; withdrawn request → the "answer applied to nothing"
  sentence; otherwise abort). afleet's card has *Deny* (a booked `user_reject`) and closing the
  card is not modelled at all for permission asks. Card D-23.
- **The dialog store's three rules are the GUI's whole contract with the composer.** A dialog
  never steals a half-written prompt: `draft` outranks `typing`, and a suppressed dialog parks as
  a dim placeholder (`Claude has a question for you — it shows once you send or clear what you're
  typing.`), and the 150 ms input grace (`cli.pretty.js:643765`) swallows keys typed in the moment
  the dialog appeared. afleet has no equivalent of any of the three. Cards D-04, D-05.
- **Four consent moments the wire never forwards are afleet's to own, and only two are built.**
  Finding 19 / §6.11–6.12 cover workspace trust (banner, built) and `.mcp.json` project servers
  (sheet, built). Managed-settings security and external-CLAUDE.md includes have no surface at
  all, and both change what the engine runs. Cards D-40, D-43, D-44.
- **The plan dialog loses five of its eight options and its editor.** Canon builds up to five
  approve rows from `{clear-context, bypass, auto, acceptEdits, default}` plus the ultraplan
  hand-off, plus `Ctrl+G` to open the plan in `$EDITOR` and `Shift+Tab` to approve-with-feedback.
  afleet ships three buttons. The GUI has a better answer than the terminal here (a real editor in
  the Files panel), and does not use it. Cards D-26, D-28.

---

## A. The dialog widget system, as GUI principles

These eight cards are the terminal's dialog machinery. They are not surfaces a user names, but
every card after them applies them, so they are carded first with evidence and then cited.

### D-01 · The dialog frame: no box, one rule, four chrome slots

**Terminal.** A Claude Code dialog **has no border box** (SPEC 41.22.7). The frame is one
horizontal rule drawn with U+2500 `─` plus two columns of horizontal padding
(`WA = 2, Vx = 1, Sv = 2`, `chunk-92g8hxqw.js:204785`); inside a constrained viewport the rule is
dropped and the padding shrinks to 1. The fullscreen modal swaps the rule glyph to U+2594 `▔`.
The frame takes `title` (bold, in `color`, default `"permission"`), `titleEnd`
(right-aligned, dim, `wrap: "truncate-start"`), `subtitle` (dim, under the title), `onCancel`
(bound to `confirm:no`, hint `cancel`), and an `inputGuide` footer row that renders dim and
italic. `hideBorder` drops the rule and the outer padding; `hideInputGuide` drops the footer.
Body and footer live inside a focus-claiming keyboard scope named `Confirmation`
(`chunk-92g8hxqw.js:205009`).

**Job.** Give a decision a visible boundary and a fixed place for its four facts — what is being
asked, about what, in what session context, and how to get out — so a user can answer without
reading the body twice.

**Wire.** Not a wire concern: the frame is host chrome. The *contents* of each slot come from the
`can_use_tool` payload's `title` / `display_name` / `description` fields (class P, area file
`24-21-permissions-plan-questions.md`).

**afleet today.** `built` — `App/Decisions/DecisionCardView.swift` and the per-kind views draw a
title `Text(...).font(.body.weight(.semibold))` plus body plus a button row inside the timeline's
row chrome. There is no subtitle slot and no `titleEnd` slot; `PermissionCardView` puts the
subagent label inline beside the title instead. No card draws a cancel hint.

**GUI form.** Region: **Decision card**, inline in the Timeline, as §8.4 already places it. Keep
the four slots as named regions of the card so every dialog family fills the same shape:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⏺ Bash command (unsandboxed)                        in a subagent run  │  title · titleEnd
│   ~/dev/afleet                                                         │  subtitle
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │ git push --force origin main                                     │   │  body
│ │ Force-push the rebased branch                                    │   │
│ └──────────────────────────────────────────────────────────────────┘   │
│ ⚠ Note: may overwrite remote history                                   │
│ Do you want to proceed?                                                │
│ [ Allow once ]  [ Yes, and don't ask again for Bash(git push:*) ▾ ]     │  options
│ [ No, tell Claude what to do differently ]                             │
│ esc close · ⇥ amend                                                    │  footer
└────────────────────────────────────────────────────────────────────────┘
```

Deviations, named: (a) the GUI **does** draw a card boundary, because a timeline of stacked rows
needs one where a terminal's single-dialog-at-a-time screen did not — this is the one place a box
is a gain, not an infidelity; (b) `titleEnd` becomes a right-aligned secondary label with a
tooltip carrying the full text, replacing `truncate-start`; (c) the footer is a real hint row,
not auto-generated from the focused element's ancestors (D-06).

**Drops / keeps / gains.** Drops: the rule glyph, the constrained-viewport collapse, `hideBorder`.
Keeps: the four slots, their order, the title colour meaning `permission`. Gains: `[exceeds]` a
persistent boundary so several dialogs can be open at once in the list, which the terminal cannot
do.

**Open.** Does the owner want the card boundary drawn for *all* dialog families or only the
consequential ones? A trust gate and a `Do you want to proceed?` look equally weighty in a box.

### D-02 · Mounting mid-turn: a dialog opened during a turn keeps the prompt

**Terminal.** SPEC 41.22.2. The host stores React elements in a `Map` keyed by a minted id and
opens a `local_jsx` descriptor. Five call sites differ in three user-observable flags:

| Call site | `immediate` | `hidesPrompt` | `retireAtTurnBoundary` |
|---|---|---|---|
| Normal slash dispatch | dynamic | `true` | `true` |
| Mid-turn immediate command | `true` | `false` | `true` |
| Submit-controller mid-turn | `true` | `false` | `true` |
| Rewind | `false` | `true` | `false` |
| Memory viewer | `false` | `true` | `false` |

So **the same slash command typed mid-turn keeps the prompt live and typed at rest hides it.**
Turn-boundary retirement closes every opted-in dialog at three points: before dispatching the
query, on an empty batch, and in the `finally` arm. Unmount is the settled promise: `"closed"`
when programmatically aborted, `"dismissed"` when the user escaped.

**Job.** Never make a user stop typing because a background process decided to show something,
and never leave a stale dialog attached to a turn that has ended.

**Wire.** `T` — terminal-only mechanism. afleet's dialogs arrive as `can_use_tool` /
`request_user_dialog` control requests, not as locally-mounted JSX; there is no `hidesPrompt`
field on the wire (area file `41-tui-rendering.md`, dialog rows). The *behaviour* is what
transfers.

**afleet today.** `superseded` in mechanism, `undesigned` in behaviour. afleet's cards are
timeline rows and never occupy the composer, so `hidesPrompt` has no analogue. But
`retireAtTurnBoundary` has one and it is not built: nothing in `App/Decisions/` closes a card at a
turn boundary; cards go inert only when the engine cancels them (`DecisionCardView` D12 readings).

**GUI form.** Region: Timeline + Composer. Two rules to keep:

1. **A card never takes the composer.** afleet already satisfies this by construction. State it as
   an invariant in the map so a future "modal permission sheet" does not undo it.
2. **Turn-boundary retirement becomes card expiry.** A card whose originating turn has ended and
   whose request the engine has retired renders its inert reading (`DecisionCardView` D12) rather
   than staying answerable. Today afleet waits for the engine to say so; a `result` frame for the
   turn that raised the card is the same signal arriving earlier.

**Drops / keeps / gains.** Drops: `hidesPrompt`, the five call-site matrix, the
`closed`/`dismissed` distinction. Keeps: turn-boundary retirement as card expiry. Gains:
`[exceeds]` several cards from several turns coexist and each retires independently.

**Open.** None.

### D-03 · A dialog blocks input by unmounting the composer, not by disabling it

**Terminal.** SPEC 41.22.4, and this is the sentence to carry: **the prompt is unmounted, not
disabled.** When any dialog whose `hidesPrompt` is not `false` is open, the composer subtree is
removed from the tree (`chunk-qs63rzfp.js:531626`). Keyboard isolation then follows from three
independent mechanisms and no "modal" flag: the composer's handlers are gone with it; the dialog
frame claims `activeElement` on the focus manager and key events dispatch from the focused node;
and scope-chain resolution walks up from the focused node, so `Chat`-context bindings are simply
not on the path.

**Job.** Make it impossible to type into a field that will not be read, and impossible for a chat
shortcut to fire while a decision is pending.

**Wire.** `T`. No wire representation.

**afleet today.** `superseded`. afleet's composer stays live beside a pending card by design, and
that is the right GUI answer: a window can show a card and a field at once where a terminal
cannot. `DecisionAnswering` disables a card's buttons while an answer is in flight
(`isAnswering`), which is the *opposite* pattern — disable, not unmount.

**GUI form.** Keep afleet's inversion, but adopt the principle behind it: **a control that cannot
act must not be present, not merely greyed.** `PermissionCardView` already does this correctly for
`requires_user_interaction` — "The one-tap approve and deny are removed entirely — not disabled —
because answering here would answer a question the user has not been shown." Apply the same rule
to the `Always allow` button when `suppress_always_allow_rule` is set (already done), and to any
future action gated by a payload flag. The in-flight `.disabled(isAnswering)` is a different case
and stays: the control still exists and will act again.

**Drops / keeps / gains.** Drops: composer unmounting, focus-manager isolation, scope chains.
Keeps: "absent, not disabled" as the rule for payload-gated actions. Gains: `[exceeds]` the user
can keep typing to Claude while a decision waits.

**Open.** None.

### D-04 · The dialog store: a stack, `place: "under"`, `holdsTop`, and the 150 ms grace

**Terminal.** SPEC 41.22.5. State is `{ open: [] }`, a stack of descriptors, with helpers for the
topmost **bare** (agent-initiated) dialog, the topmost **user-invoked** panel, any dialog of a
kind, removal by id (which re-stamps the one beneath), and a per-kind subscription. Placement
fields:

| Field | Origin | Effect |
|---|---|---|
| `place: "under"` | per-call | Unshifts behind the current stack **only when an already-open bare dialog exists**; otherwise normal push |
| `holdsTop` | schema field, **only `mcp_elicitation`** | Can demote a newly opened same-class dialog underneath, again only when a bare dialog is already open |
| `succeeds` | per-call | Opts out of the `holdsTop` demotion |
| `hideWhile` | schema field, default `["panel"]` | Which suppression reasons hide this dialog |
| `shownAt` | reducer / `armInputGrace` | Starts a **150 ms** input grace (`var Xw = 150`, verified in `cli.pretty.js:643765`) |
| `revealSeq` | bumped when the dialog above closes | Re-fires per-reveal impression hooks |

`armInputGrace` is passed by the permission dispatcher exactly when the ask is placed `under` or
carries a denial-limit fallback (`cli.pretty.js:371099`).

**Job.** Order competing asks so the one the user is mid-answer on is not displaced, and swallow
the keystroke that was already in flight when a dialog appeared — the single most common way a
terminal user approves something by accident.

**Wire.** `R` — the host rebuilds it. The wire delivers independent control requests with no
ordering or stacking semantics; area file `41-tui-rendering.md` records the dialog store as
host-side. Nothing on the wire says "place this under".

**afleet today.** `undesigned`. Cards are timeline rows in arrival order. `DecisionAnswering`
guards double-answering of one card but nothing orders two cards, and there is no grace period:
a card that renders under the mouse can be clicked in the same frame.

**GUI form.** Region: Timeline (ordering) + Decision card (grace).

- **Ordering.** Timeline order is arrival order and should stay so — reordering rows under a
  reader is worse than any stacking rule. Translate `place: "under"` and `holdsTop` into
  **focus** rather than position: the card that owns Return (`isActive`, already modelled in
  `PermissionCardView`) is the *oldest unanswered* card, and a newly arrived card does not take it.
  An `mcp_elicitation` card is the exception that keeps focus when it has it (`holdsTop`).
- **The grace.** `[keep]` Adopt the 150 ms grace literally, on every card's action buttons and on
  the Return binding: a control is inert for 150 ms after the card first becomes visible. This is
  cheap, it is canon, and the GUI failure mode it guards is worse than the terminal's — a mouse is
  already travelling when a row appears and reflows the list.
- `revealSeq` has no analogue and is dropped.

**Drops / keeps / gains.** Drops: the stack, `place`, `succeeds`, `revealSeq`. Keeps: the 150 ms
grace verbatim; `holdsTop` as focus retention for elicitation. Gains: `[exceeds]` all pending
decisions are visible simultaneously and in the Activity view, so "which is on top" stops being a
question the user has to be protected from.

**Open.** Should the grace apply to the *Deny* button too, or only to approvals? Canon arms it for
the whole dialog. Denying by accident is recoverable; approving is not. Owner's call.

### D-05 · Suppression: `progress → panel → draft → typing`, and the draft placeholder

**Terminal.** SPEC 41.22.5. One function returns the active suppression reason in strict priority
order (`chunk-qs63rzfp.js:496147`):

```js
return w ? "progress" : ne ? "panel" : me ? "draft" : I ? "typing" : null;
```

A dialog's `hideWhile` (default `["panel"]`) says which reasons hide it. A dialog hidden by
`draft` does not vanish — it renders a **dim placeholder** in its place, one of two strings
(`chunk-qs63rzfp.js:521796`), the em dash being U+2014:

```text
Claude has a question for you — it shows once you send or clear what you're typing.
Claude has a suggestion for you — it shows once you send or clear what you're typing.
```

The first is used for a question dialog, the second for a suggestion dialog.

**Job.** This is the terminal's promise that **it will never steal a half-written message.** The
placeholder is the other half of the promise: the user is told a decision is waiting, and told
exactly what to do to see it.

**Wire.** `T` for the mechanism; the *need* is host-side and universal.

**afleet today.** `undesigned`. Nothing in `App/Composer/` or `App/Decisions/` consults composer
draft state, and no placeholder string exists anywhere in the tree.

**GUI form.** afleet does not need suppression — a card and a composer coexist — so the literal
mechanism is `superseded` by the layout. What must survive is the **principle and its two
consequences**, and one of them is live in afleet today:

1. **A decision never moves the caret or takes focus while the composer holds a draft.** afleet
   must not auto-focus a newly arrived card's approve button if the composer has text. This is
   the exact `draft > typing` ordering, translated: draft beats arrival.
2. **A decision that is off-screen must still be announced.** The terminal's placeholder becomes
   afleet's **jump-to-decision pill** — a strip pinned above the composer while an unanswered card
   is scrolled out of view, reading `Claude has a question for you` with the card's title, and
   scrolling to it on click. Region: Channel banner / above-composer strip. This is the
   placeholder's job done better, because the GUI can offer the jump the terminal could not.
3. `progress` and `panel` have GUI analogues worth keeping as *non*-suppressors: a card must
   render while a turn is streaming (afleet already does) and while the right-hand Panel is open.

**Drops / keeps / gains.** Drops: the four-reason priority chain, `hideWhile`, the placeholder
strings verbatim. Keeps: draft-beats-arrival for focus; announcement of a hidden decision. Gains:
`[exceeds]` a click-through jump instead of a sentence telling you to clear your input.

**Open.** Should the pill count multiple pending decisions (`3 decisions waiting`), or name the
oldest? Activity already carries the count; the pill may be better as a single named jump.

### D-06 · The keyboard-hint footer, its vocabulary, and the two scopes

**Terminal.** SPEC 41.22.10–41.22.11. Roughly 460 hints are generated from `{chord, action}` pairs
by three components: `D` (literal chord, two output shapes — `(x to y)` and `x to y`), `je` (the
configurable form, resolving the user's binding for a semantic `(action, context)` pair and
emitting `tengu_keybinding_fallback_used` on a miss; a deliberately unbound action renders
nothing), and `ue`, the joiner that drops empty children and inserts a dim ` · ` after the first
item — **this is the source of every middle dot in a hint row.** Three formatting presets exist
(`default`, `compact`, `symbol`) differing in key case, modifier case, `caretCtrl` (`ctrl+X` →
`^X`), and separators; `format: { keyCase: "lower" }` is by far the most common override. The
key-name table maps 14 keys across title/lower/glyph columns and modifiers render as
`ctrl`/`Ctrl`/`⌃`, `shift`/`Shift`/`⇧`, `opt`/`Opt`/`⌥` on macOS, `cmd`/`Cmd`/`⌘` on macOS.

`Q`, the auto-generated guide, walks the focused element's ancestors, collects registered
handlers to a boundary node, formats each as `<chord> <description>`, sorts by explicit order then
depth, and **retains at most four** (`var Te = 4`). The action→description vocabulary is closed:
eight `confirm:*` (`confirm:yes` → `confirm`, `confirm:no` → `cancel`, `confirm:previous`/`next` →
`navigate`, `nextField`/`previousField`, `toggle`, `cycleMode`), eight `select:*`, eight
`abovePrompt:*`, two `tabs:*` and six `app:*`. The static default footer renders
`Enter to confirm · Esc to cancel`.

Scopes (SPEC 41.22.11): 26 named scopes; the two that matter here are
`Confirmation` — *"When a confirmation/permission dialog is shown"* — and `Select` — *"When a
select/list component is focused."*

**Job.** Tell the user what keys work here, in words drawn from a fixed vocabulary so the same
action always reads the same way, and honour their rebindings.

**Wire.** `T`. Keybindings are terminal configuration; the area file `42-input-keybindings.md`
classes the whole keybinding system as terminal-only.

**afleet today.** `undesigned` for hints. `PermissionCardView` binds `.defaultAction` to *Allow
once* (gated on `isActive` and `default_to_no`) and nothing else; no card draws a hint row.

**GUI form.** Region: Decision card footer.

- Draw a hint row on the **active** card only, dim, using macOS glyph forms (`⏎`, `⎋`, `⇥`, `⌘`),
  joined with ` · `, cap **four items** as canon does.
- Keep the `confirm:*` vocabulary as the card's action names so the words match across families:
  `confirm`, `cancel`, `navigate`, `toggle`, `next field`.
- The default footer is `⏎ confirm · ⎋ cancel`; the permission family's is
  `⎋ cancel · ⇥ amend` (D-22).
- `[exceeds]` The GUI can also put every card action in the **Menu bar** (Decision menu:
  Approve ⌘⏎, Deny ⌘⌫, Amend ⇥), which the terminal has no room for — and the menu bar is
  currently near-unused (§2).

**Drops / keeps / gains.** Drops: `je` user rebinding, the three presets, telemetry on fallback.
Keeps: the four-item cap, the ` · ` joiner, the `confirm:*` word list, the `Confirmation` scope as
"a card owns the keyboard while it is active". Gains: `[exceeds]` menu-bar equivalents and
discoverable shortcuts.

**Open.** afleet has no keybinding configuration surface. If one is ever added, `je`'s rule —
an unbound action renders no hint — is the right default.

### D-07 · The select list, multi-select and text input primitives

**Terminal.** SPEC 41.22.8–41.22.9. The **select list**: cursor glyph resolves through a five-way
priority chain — disabled (space, `aria-hidden`), focused (`❯` in `suggestion`), last row with
more below (`↓`, `aria-label: "(more below)"`, dim), first row with more above (`↑`,
`"(more above)"`, dim), mouse-hovered (`❯`, dim), otherwise space. The selected marker is `✔` in
`success` with `aria-label: "(selected)"`. Row colour is `inactive` when disabled, `success` when
selected, `suggestion` when focused. Numbering is **absolute and 1-based**, padded to the digit
count of the total plus two; only digits 1–9 are actionable and `"0"` maps to index −1 and is
rejected. Navigation **wraps around** in both directions and resets the visible window. Page size
defaults to 5, clamped to terminal height with 8 rows reserved for chrome.

**Multi-select**: the checkbox is composed from brackets, not the `figures` glyphs — `[✔]` in
`success` when checked, `[ ]` when not. Its key handler is a fixed branch order (tab / shift+tab /
down-ctrl+n-`j` / up-ctrl+p-`k` / pagedown / pageup / ctrl+return / return-on-submit /
return-with-no-submit / return-or-space toggle / digits / escape). Bare `j` and `k` are ignored
when ctrl or shift is held. When the **focused option** has `type === "input"` a restricted-key
filter admits only `up`, `down`, `escape`, `tab`, `return`, `ctrl+n`, `ctrl+p`, `ctrl+return`.

`En`, the shared confirmation selector, defaults labels to `Yes`/`No`, supports `cancelFirst` and
an initial focus, and builds `{label, value:"confirm"}` and `{label, value:"cancel"}` in the
requested order — so the IDE dialog's `yes`/`no` values are one caller's list, not the contract.

**Job.** One list widget every dialog reuses, so keyboard behaviour is identical across families
and a numbered row can be picked without arrowing.

**Wire.** `T` for the widget; the *option list* itself is P (the payload's options).

**afleet today.** `built`, partially. `QuestionCardView.option(_:of:)` draws each option as a
`Button` with a trailing `Text("Chosen")`; `PermissionCardView` draws a fixed `HStack` of buttons.
There is no shared list component, no numbering, no checkbox glyph, no wrap-around, no keyboard
navigation between options at all. `ElicitationForm` has its own field set.

**GUI form.** Region: Decision card body. Build **one** `DecisionOptionList` used by the
permission, plan, question and elicitation cards:

```
 ❯ 1. Yes                                                  ← focused row: accent, ❯ or SF chevron
   2. Yes, and don't ask again for Bash(git push:*)         ← file: .claude/settings.local.json
   3. No, tell Claude what to do differently
```

Keep: **absolute 1-based numbering with digit shortcuts 1–9**, the selected `✔`, the three row
states (disabled / selected / focused), `↑`/`↓` navigation, `space` to toggle in multi-select,
`escape` to cancel. Drop: wrap-around (a GUI list with a scrollbar does not need it, and wrapping
past the end surprises), the five-row page size (the card is as tall as it needs), the ASCII
fallback, `j`/`k` (afleet has no vim-mode surface).

`[exceeds]` The GUI can show each option's consequence inline — the destination file, the rule
text, the mode name — where the terminal had to fold it into the label.

**Drops / keeps / gains.** Drops: wrap-around, page size, `figures` fallbacks, vim keys.
Keeps: numbering + digit shortcuts, `✔`, the three row states, escape. Gains: per-row consequence
lines, hover, click.

**Open.** Digit shortcuts collide with nothing in afleet today, but they will if the composer ever
takes focus-follows-mouse. Scope them to the active card.

### D-08 · When a dialog cannot open: the two failure strings

**Terminal.** SPEC 41.22.3. Two strings for two failures. Interactive, emitted as an
immediate-priority feedback notification when the registry lookup fails or the tool-use context
has no dialog host (telemetry reasons `cmd_local_jsx_no_dialog_resolution` and
`cmd_local_jsx_no_panel_host`):

```text
/<name> is currently unavailable.
```

Non-interactive:

```text
/<name> opens an interactive panel and isn't available in this environment. Run it from the Claude Code terminal instead.
```

**Job.** Tell the user why nothing happened, and — in the headless case — where to go instead.

**Wire.** `X` — unreachable. These fire inside the CLI before anything is forwarded; afleet
running headless is precisely the "this environment" the second string names.

**afleet today.** `undesigned` as a string, but the situation is live and handled elsewhere:
`DecisionCard.dialogKind` returns nil for any kind afleet did not declare, `InboundPolicy` leaves
it unanswered and `WireReducer` opens it `.inert` (C6.3, §6.3). The user sees an inert row with
`summaryLine`, and no sentence saying why.

**GUI form.** Region: Decision card. An undeclared or unrenderable dialog kind renders a card
whose body is the kind name and one sentence:

```text
This session raised a dialog afleet does not render (<kind>). Open the session in Terminal to answer it.
```

with an *Open in Terminal* action (the same `openInTerminal` route `TrustBanner` uses). This is
the second canon string translated: name the limitation, name the escape hatch. `[exceeds]` afleet
can offer the escape hatch as a button; the terminal could only print a sentence.

**Drops / keeps / gains.** Drops: the slash-command framing, the telemetry reasons. Keeps: "say
why, and say where to go instead". Gains: a working route out.

**Open.** Does opening the same session in Terminal actually let the user answer a pending
control request raised against the headless host? Probe needed — this is the difference between a
real escape hatch and a dead button.
