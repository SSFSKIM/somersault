# Lane D — decision dialogs

**Date.** 2026-09-10 (resumed from a partial run of 2026-09-09). **Canon.** Claude Code 2.1.263
(`/Users/new/claude-code-bundle/2.1.263/`). **Cards.** D-01 – D-62, in eight sub-families.

**What this lane covers.** Every terminal dialog that asks the user to decide something during a
session: the dialog widget system itself, the permission family and all nine of its tool routes,
plan mode, `AskUserQuestion`, MCP elicitation, the forwarded dialog kinds, the trust and consent
gates the wire never delivers, and the confirmations the terminal raises on its own.

**SPEC 263 read.** `41-tui-rendering.md` §41.22.1–41.22.12 (whole block, plus the registry resolved
from the build); `24-permission-system.md` §24.5–24.6 (rule dialects), §24.8.4, §24.9,
§24.10.8, §24.11, §24.12.4, §24.13, §24.14.1–24.14.6, §24.15.1–24.15.5, §24.16.1, §24.17.1–24.17.4,
§24.18.2–24.18.3, §24.19, §24.20.1–24.20.4, §24.20.9; `25-bash-command-analysis.md` §25.9, §25.18,
§25.20, §25.22.4; `21-plan-mode-and-questions.md` §2.1, §4, §5.1–5.6, §6.7–6.9, §7.1–7.7, §8.1–8.3,
§10.3, §11, §12.2–12.13; `26-auto-mode.md` §26.16.8, §26.17.3–26.17.5, §26.20.2, §26.21.3;
`31-mcp-client.md` §15; plus targeted reads in 03, 06, 08, 10, 17, 20, 22, 23, 28, 30, 33, 34, 36,
37, 38, 42, 46, 47, 48.

**afleet files read.** Root spec `docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md`
§3, §6.11, §6.12, §7.4, §7.6, §7.7, §8.4, §8.5, §8.6, §17.8;
`docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` (Residue, Design, Engine anchors, Outcomes);
`App/Decisions/{DecisionCard,DecisionAnswerMapping,DecisionAnswering,DecisionCardView,DecisionRowView,PermissionCardView,PlanCardView,QuestionCardView,DialogCardView,ElicitationCardView,ElicitationForm,DiffRendering,AttributedDiffRenderer,RetractionRegistry}.swift`
and its `README.md`; `App/Consent/{ConsentSheet,TrustBanner,ChannelDecorations,PrecommitModel}.swift`
and its `README.md`; `App/Header/{QuitGuard,HeaderMenus}.swift`, `App/Shell/CommandRouting.swift`,
`ClaudeWire` `InitializeConfiguration.swift`; `docs/tui-parity/README.md` (§4 finding 19, §5),
`docs/tui-parity/areas/24-21-permissions-plan-questions.md`, `.../26-auto-mode.md`,
`.../41-tui-rendering.md`, `.../46-19-48-37-chrome-web-enterprise-cloud.md`,
`.../22-47-40-goals-git-workflows.md`.

**somersault clone read.** `CC-to-SDK/docs/parity/tui-ux.md` §4 "Modals / overlays" and the F6 and
Wave T sections (rows `DG1`–`DG19`, `DG27`, the consult footer row, the bypass gate row, the unbuilt
registry kinds row); `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md`;
`docs/superpowers/specs/2026-07-31-tui-clone-fidelity-design.md` (F6 part);
`docs/parity/spec-crosscheck-2026-09-03.md`.

**Verification spent (`cli.pretty.js` at 2.1.263).** The lane's greps, chosen where a card's GUI
form turns on the literal. Sub-family slices spent their own budgets on top of these; each is cited
in place.

| What | Result |
|---|---|
| `title: "Bash command"` | `:518740` — the whole Bash dialog JSX: three title variants, description line, warning row, `Do you want to proceed?`, footer |
| `"Edit file"` / `"Create file"` | `:370450`, `:370458`, `:370478` — four file titles, the verb phrases, all five withheld-content sentences |
| the file-action question renderer | `:519963` — `` `Do you want to ${verbPhrase} **${fileName}**?` `` |
| `Read outside the working directories` | `:370531` — the one-time outside-reads offer replaces title *and* question |
| `label: "Yes"` / `label: "No"` | `:15706`, `:15711` — the option labels are the **bare words**; "tell Claude what to do differently" is not a label |
| `uD = { accept:…, reject:… }` | `:15117` — the two feedback placeholders, verbatim |
| `action: "amend"` | `:15099` — `tab to amend` exists and is conditional on the focused option's input mode being closed |
| `ctrl+e"` (every site) | `:278427`, `:374856`, `:542409` — `Chat`→external editor, the agents group hint, `Transcript`→toggleShowAll, `ThemePicker`→editCustom. **None in `Confirmation`; no explain action exists** |
| `Yes, and don't ask again` (every site) | `:14493`, `:15517`, `:477050`, `:516271`, `:520158`, `:520655`, `:520669`, `:520814`, and the curly-apostrophe labels at `:518628`, `:520342` — every persistent row is built from a **narrow suggestion display string**, never a bare tool name |
| `Do you want to ` (every site) | `:15110`, `:110809`, `:370524`, `:516356`, `:519963`, `:520535`, `:520914` — the per-family question lines |
| `permission_webfetch` | `:370569` — the real kind literal; SPEC 24.14.2 misprints it as `permissionJXbfetch` |
| `srPrefix: "Permission Required:"` | `:423055` — the family's only screen-reader affordance |
| the dialog-kind registry `fk` | `:520309` — 42 syntactic keys, one null spread, **41 kinds at runtime** (enumerated in D-09) |
| `var Xw = 150` | `:643765` — the dialog input-grace constant |

**Denominator: additions and corrections.** Everything the task prompt listed is covered. These are
the places the prompt's assumptions or the SPEC's own text turned out to be wrong, each recorded in
the card that carries it:

1. **The registry holds forty-one dialog kinds, not the handful the prompt names** (D-09, resolved
   from the build). SPEC 41.22.6 counts them and enumerates only the six that carry a `layout`;
   SPEC 41.22.1, titled "The lazy dialog registry", documents the 74-entry *slash-command* registry
   instead. Seven registered kinds appear in neither the prompt nor tui-parity finding 19:
   `left_arrow_confirm`, `cost_threshold`, `resume_return`, `it2_setup`, `fullscreen_upsell`,
   `auto_default_nudge`, `effort_medium_nudge`.
2. **There is no `ctrl+e explain` at 2.1.263** (D-22). The footer is `escape to cancel` plus a
   conditional `tab to amend`, and `amend` opens the focused option's inline feedback input — it
   does not open an editor. The clone's scorecard cites an older bundle for the three-hint form.
3. **The option set is `Yes` / persistent row / `No`, with bare labels** (D-24). The prompt's
   "no, tell Claude what to do differently" is the reject input's placeholder.
4. **The permission dialog has no destination picker** (D-21): every rule row files to
   `localSettings` (SPEC 24.15.5), and the three-way picker belongs to `/permissions`. afleet adds
   one — and tui-parity sanctions it explicitly, so the card rules it a legitimate `[exceeds]` with
   three conditions.
5. **The forwarded family is three, not two** (section F): finding 19 adds the Slack-connect kinds
   alongside `refusal_fallback_prompt` and `fable_overage_consent_prompt`.
6. **`permissionJXbfetch` in SPEC 24.14.2 is a corrupted name** for `permission_webfetch` (D-16).
7. Added, found in the family and not listed in the prompt: the read-only allowlist that makes most
   Bash asks never happen (D-12), `permission_powershell` (D-13), `permission_monitor` and
   `permission_browser` (D-19), the decision-reason banner as its own surface (D-20), the
   artifact-review step of the plan dialog (D-29), the teammate plan-approval pair (D-32),
   `mcp_elicitation_waiting` and `mcp_url_elicitation` as surfaces distinct from form mode (D-38),
   the API-key trust dialog (D-48), `chrome_install_upsell` / `chrome_install_setup` (D-49), and
   `cloud_sync_offline` (D-54).

## Headline

- **The permission dialog is not one dialog, it is twelve — and afleet routes three.** SPEC 24.14.2
  declares twelve kinds, each with its own title, body and question sentence (`Do you want to
  proceed?` for a command, `Do you want to <verb> <file>?` for a file, `Do you want to allow Claude
  to fetch this content?` for a fetch). `DecisionCard.decode` branches on `tool_name` into
  permission / question / plan and nothing else, so every route-specific title and question line the
  terminal draws is absent — the Bash `(unsandboxed)` title, the `Create file` / `Overwrite file`
  distinction, the five withheld-content sentences, `Use skill "x"?`. The bodies are largely there
  already; what is missing is the route table above them. Cards D-10 – D-19.
- **The single biggest loss is the `Note: may …` warning line.** SPEC 25.20 gives sixteen
  destructive patterns whose warning renders in `warning` colour immediately above `Do you want to
  proceed?` — `Note: may overwrite remote history`, `Note: may recursively force-remove files`,
  `Note: may destroy Terraform infrastructure`. It is the only thing between a user and
  `git push --force`, the pattern table is a closed public constant, and no `Note: may` string
  exists anywhere in afleet. Card D-11.
- **afleet's rejection message is a truncation, and the truncation is behavioural.**
  `PermissionCardView.unstatedDenial` sends `The user doesn't want to proceed with this tool use.` —
  the first sentence of canon's `_T`. The two sentences it drops are the two that do work: the
  parenthetical telling the model the edit was **not** written, and `STOP what you are doing and
  wait for the user to tell you how to proceed.` A denied model is currently not told to stop.
  One constant. Card D-24.
- **Three of afleet's decision cards have no third answer.** The permission card cannot stop a turn
  (only `Deny`, always `interrupt: false`); the question card ships with only `Send`, so canon's
  `Esc → {behavior:"deny"}` has no equivalent; the URL-mode elicitation card hides `Accept`, so the
  flow cannot be completed. In each case the terminal's third answer is load-bearing. The invariant
  the map should carry: **every decision card offers every settlement its request declares, and
  closing the card is always one of them.** Cards D-23, D-34, D-38.
- **"Yes, and don't ask again" is a narrow rule, and afleet's scope picker is a sanctioned exceed
  with three conditions.** Every canon row is built from the engine's suggestion display string
  (`cli.pretty.js:520655`, `:520669`, `:14493`) and files to `localSettings` only; tui-parity states
  outright that a headless host *may* offer project and user scope at approval time, "which the TUI
  cannot". afleet does. It must then name the **file** rather than the scope word, adopt canon's
  8/64/160 display limits, and honour the two suppressions it currently ignores (org ask ceiling,
  rule-minting-forbidden request sources). Card D-21.
- **Canon declares a mount per dialog kind; afleet flattens forty-one kinds into one Timeline row.**
  The registry carries `inline`, `bottom` (above the prompt) and `modal` placements. The four-way
  GUI destination rule — inline card, above-composer dock, **channel-scoped** sheet, banner or
  notification — is the most reusable output of the lane, and it also identifies the thirteen
  registered "dialogs" that are advertisements and should never be cards at all. Any sheet must be
  modal to the channel, never to the app: an app-modal plan approval freezes nineteen unrelated
  conversations. Card D-09.
- **Four consent moments the wire never forwards are afleet's to raise, and two have no surface.**
  Finding 19 lists fifteen dialog kinds that resolve to their default immediately whatever the host
  declares. Workspace trust (banner) and `.mcp.json` project servers (sheet) are built. **Managed
  settings security and external CLAUDE.md includes are not** — and the parity inventory calls the
  managed-settings gate "waived headless: a dangerous remote payload is applied with no prompt
  (security-relevant)". Both change what the engine runs before any card can appear. Cards D-42,
  D-44, D-45, D-46.

---

## A. The dialog widget system, as GUI principles

These nine cards are the terminal's dialog machinery. They are not surfaces a user names, but
every card after them applies them, so they are carded first with evidence and then cited. D-09
closes the section with the registry itself — the full inventory of forty-one dialog kinds, which
is this lane's denominator.

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
│ [ tell Claude what to do differently…                              ]   │  feedback
│ [ Allow once ]  [ Always allow · Bash(git push:*) ▾ ]  [ Deny ]        │  options
│ ⎋ close · ⌘⏎ allow · ⌘⌫ deny                                           │  footer
└────────────────────────────────────────────────────────────────────────┘
```

Deviations, named: (a) the GUI **does** draw a card boundary, because a timeline of stacked rows
needs one where a terminal's single-dialog-at-a-time screen did not — this is the one place a box
is a gain, not an infidelity; (b) `titleEnd` becomes a right-aligned secondary label with a
tooltip carrying the full text, replacing `truncate-start`; (c) the footer is a real hint row,
not auto-generated from the focused element's ancestors (D-06); (d) the feedback field is always
visible rather than revealed by a second Return — canon's option labels are the bare words `Yes`
and `No` (`cli.pretty.js:15706`, `:15711`) and "tell Claude what to do differently" is the inline
input's *placeholder*, not a button label (D-24).

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

### D-09 · The dialog registry and the three mounts

**Terminal.** There are **two** registries and SPEC 41.22.1's heading names only one. §41.22.1's
"lazy dialog registry" (`qme`, `chunk-qs63rzfp.js:485809`) registers **slash commands that mount
JSX**, not dialog kinds: one object literal of 74 entries over 73 distinct chunks (`output-style`
and `vim` share one), ending in six spreads of which two are non-empty (`{background, daemon,
stop}` and `{workflows}`) and four are build-time residue. The resolver prefers a command-supplied
loader — `w.load ?? (Object.hasOwn(qme, w.name) ? qme[w.name] : void 0)` — which is how `/brief`
and `/focus` bypass it. Every chunk exports `call(onDone, toolUseContext, args, commandName) →
Promise<ReactElement | null>`. There is **no preloading, no `React.lazy` and no Suspense**.

The registry of **dialog kinds** is `fk`, declared in §41.22.6: 42 syntactic keys, one (`HEt`, the
review-artifact kind) a null conditional spread the bundler folded out, so **41** entries at
runtime. Layout is declarative — `Gf(registry, dialog, tuiMode)` — defaults to `inline`, and only
six entries carry a `layout`. The spec's excerpt keys them by minified identifier; resolved against
each `Kr({ kind: … })` site in the build (verified in `cli.pretty.js:520309`), the inventory is:

| GUI destination | Kinds (canon mount bracketed where not `inline`) |
|---|---|
| **Timeline decision card** — gates one tool call in one turn | `permission_prompt`, `permission_bash`, `permission_powershell`, `permission_file`, `permission_webfetch`, `permission_browser`, `permission_skill`, `permission_monitor`, `permission_ask_user_question`, `permission_enter_plan_mode`, `permission_workflow` (via `jEt` → `workflowPermissionDialog`), `computer_use_approval`, `sandbox_network_access`, `goal_proposal`, `peer_inbound_approval`, `refusal_fallback_prompt`, `fable_overage_consent_prompt`, `auto_mode_setup_review`, `auto_mode_flagged_allow` |
| **Above-composer dock** — a form whose answer is the next thing typed | `mcp_elicitation` [bottom], `mcp_elicitation_waiting` [bottom], `mcp_url_elicitation` [bottom] |
| **Channel-scoped sheet** — changes the session's mode for every later turn | `permission_exit_plan_mode_v2` [modal], `ultraplan_choice` [modal], `ultraplan_launch` |
| **Channel banner or notification** — recommends, does not gate | `lsp_recommendation`, `plugin_hint`, `it2_setup`, `chrome_install_upsell`, `chrome_install_setup`, `remote_callout`, `fullscreen_upsell`, `auto_default_nudge`, `effort_medium_nudge`, `cost_threshold`, `cloud_sync_offline`, `managed_settings_security`, `ide_onboarding` |
| **Not a card in the window** | `left_arrow_confirm` (D-58), `resume_return`, and `local_jsx` [modal in fullscreen, bottom when `immediate`, else inline] — the 74 slash panels all arrive through this one kind |

**Job.** Declare a decision's weight once, at the kind, so the same question always lands in the
same place; and load its body only when asked, so 73 panels cost nothing until one opens.

**Wire.** `X` for the slash panels — `docs/tui-parity/README.md` (A-41): "74 lazy dialog registry
entries are all `local-jsx` panels: unreachable as commands … most have a control-request or
on-disk equivalent". For the kinds, README finding 19: only `refusal_fallback_prompt`,
`fable_overage_consent_prompt` and the Slack-connect kinds cross as `request_user_dialog`;
elicitation goes out as `elicitation`; `permission_*` travel as `can_use_tool`; **every other kind
resolves to its declared default immediately**, whatever `supportedDialogKinds` says.

**afleet today.** `built` for the two forwarded kinds only — root spec §8.4's dialog table declares
`refusal_fallback_prompt` and `fable_overage_consent_prompt`, drawn by
`App/Decisions/DialogCardView.swift`; `DecisionCard.dialogKind` returns nil for every other kind
(D-08). Placement is uniform: every card is a Timeline row. Half the 74 slash panels have a native
destination in §7.7's router table, but that table names mechanisms, not widgets.

**GUI form.** Keep canon's principle — **placement is declared per kind, not chosen per event** —
and give the three mounts three regions the window already has, plus one the terminal had nowhere
to put:

```
┌ Channel banner ───────────────────────────────────────────────┐  ← suggestion kinds
├ Timeline ─────────────────────────────────────────────────────┤
│   ┌ decision card ────────────────────────────────┐            │  ← inline (default)
│   └───────────────────────────────────────────────┘            │
├ elicitation dock ─────────────────────────────────────────────┤  ← bottom
├ Composer ─────────────────────────────────────────────────────┤
└───────────────────────────────────────────────────────────────┘
     ┌ sheet, modal to THIS channel only ───────────┐              ← modal
```

The rule: **mount by what the answer changes and how long it can wait.** One tool call → inline
card. A form the composer must not steal → the dock, because a form that scrolls out of view is a
form the user abandons (canon gave `bottom` to exactly the three kinds carrying a text or URL
field). A session-wide mode change gating the next turn → sheet. A recommendation → banner or
notification.

Three deviations, named. (a) The terminal has **no overlay**: a dialog is a flex child in document
order, and only the DECSTBM scroll-region renderer positions absolutely — `modal` is a *slot in the
layout frame*, not a layer. A sheet is the honest GUI form of that slot. (b) `[exceeds]` The sheet
must be modal to the **channel**, never the app: canon's modal blocks one process, and an app-modal
plan approval here would freeze nineteen unrelated conversations. (c) The suggestion bucket is a GUI
addition — canon renders `plugin_hint` and `chrome_install_upsell` as dialogs for want of anywhere
else, and a decision card that is really an advertisement devalues every real card beside it.

**Drops / keeps / gains.** Drops: the layout resolver, `tuiMode`, chunk loading. Keeps: per-kind
declared placement, the three-way weighting, inline as default. Gains: a fourth non-decision
destination; channel-scoped modality.

**Open.** Which of the thirteen suggestion kinds should reach the user at all? `chrome_install_upsell`,
`fullscreen_upsell` and `it2_setup` are arguably `out-of-scope` rather than banner material.

---

## B. The permission dialog family

Twelve dialog kinds, one shell. Three of the twelve belong to other sub-families and are carded
there (`permission_ask_user_question` → D-33, `permission_enter_plan_mode` → D-26,
`permission_exit_plan_mode_v2` → D-27). The nine that are tool approvals are here, followed by the
five cards that describe machinery every one of them shares: the reason banner, the persistent row,
the footer, the answer branches and the feedback rows.

### D-10 · The permission ask: dispatch, twelve kinds, and the generic `Tool use` dialog

**Terminal.** SPEC 24.14.1–24.14.3. `useCanUseTool` resolves `allow` and `deny` silently and only
`ask` reaches a human, and even then not always: `PermissionRequest` hooks run first when
`awaitAutomatedChecksBeforeDialog` is set, and the ask is offered to a relay (bridge, channel,
teammate) unless it is `localDisplayOnly`, `forcedByCaller`, a denial-limit fallback or
remote-executed. Only what survives both opens a dialog. The dispatch table maps a tool to one of
**twelve** declared kinds and falls back to the generic `permission_prompt` when nothing matches:

| Kind | Extra payload | Carded |
|---|---|---|
| `permission_prompt` | — | D-10 |
| `permission_bash` | `command`, `classifierState` | D-11 |
| `permission_powershell` | `command` | D-13 |
| `permission_file` | `filePath`, `operationType` | D-14, D-15 |
| `permission_webfetch` | `hostname` | D-16 |
| `permission_browser` | `verbPhrase` | D-19 |
| `permission_skill` | `skill` | D-18 |
| `permission_monitor` | `intervalMs` | D-19 |
| `permission_workflow` | `script` | D-18 |
| `permission_ask_user_question` | `questions` | D-33 |
| `permission_enter_plan_mode` | — | D-26 |
| `permission_exit_plan_mode_v2` | `plan` | D-27 |

The generic dialog's title is `Tool use`; its body is `renderedToolUseMessage`, and when a tool's
`renderToolUseMessage` throws the line becomes `parameters could not be rendered — deny unless
expected`. Options assemble in a fixed order — `Yes`, then the persistent row when offered, then
the auto-mode row when offered, then `No` — except under `default_to_no`, where `No` is unshifted
to the front instead of appended (SPEC 24.14.3).

**Job.** Put the specific thing about to happen in front of the user in the vocabulary of that
thing — a command as a command, a file change as a diff — rather than as a generic tool call.

**Wire.** `P` for the ask itself, `R` for the twelve-way routing: `can_use_tool` carries
`{tool_name, display_name, input, description?, …}` and no dialog kind, so the host chooses the
renderer (tui-parity `areas/24-21-permissions-plan-questions.md`, §24.14.a rows for the generic,
Bash, PowerShell, file, WebFetch, MCP, Agent and Browser/Skill/Monitor/Workflow dialogs — all `R`).
`renderedToolUseMessage` is not on the wire, which that file calls out as "where a GUI most
obviously exceeds the TUI".

**afleet today.** `built`, with three routes where canon has twelve.
`App/Decisions/DecisionCard.swift:57-75` switches on `toolName` only — `AskUserQuestion` →
question, `ExitPlanMode` → plan, **everything else** → one `.permission` case — and
`App/Decisions/PermissionCardView.swift` draws it: title = `display_name ?? tool_name`,
description as a `.callout` line, then `ToolInputView`, which has real branches for
bash / read / write / edit / glob / grep / webFetch / webSearch and falls to a key-value dump for
the rest. So the *body* is already route-aware for the file and command tools; the *title*, the
*question sentence* and every route-specific warning are not.

**GUI form.** Region: **Decision card** in the Timeline, keeping D-01's four slots. One change of
structure: make the route explicit. A `PermissionRoute` resolved from `tool_name` supplies three
things the card does not have today — the title (`Bash command`, `Edit file`, `Fetch`, …), the
question sentence, and the body renderer — instead of the title coming from `display_name` and the
question not existing. `ToolInputView`'s existing branches become the body half of that route, so
this is a reorganisation, not new rendering. The generic route keeps `Tool use` as its title and
the key-value dump as its body, and keeps canon's render-failure sentence for input the card cannot
parse. `[exceeds]` The GUI can also show the tool's *result shape* — what a `Read` will return, how
many files a `Glob` matches — which the terminal has no room for; out of scope for this card but
the route table is where it would live.

**Drops / keeps / gains.** Drops: `renderedToolUseMessage` (the GUI renders input natively —
better), the relay offer (afleet *is* the relay). Keeps: the twelve routes as twelve titles and
questions; the option order; the render-failure sentence. Gains: native bodies per route.

**Open.** None.

### D-11 · Bash command: the title variants, the description, and the destructive warning

**Terminal.** Verified whole at `cli.pretty.js:518740`. The frame's title is one of three:
`` `Bash command (runs on ${host})` `` when the call is routed to a named host, `Bash command
(unsandboxed)` when sandboxing is enabled but this call is not sandboxed, otherwise `Bash command`.
The subtitle slot carries the auto-mode upsell when it is offered. The body is a padded box with
the command in default colour (or a withheld marker) and, under it, `description` in dim. Then, in
order: the decision-reason banner (D-20) with `toolType: "command"`; the **destructive warning** in
`color: "warning"` with a blank line under it; the question `Do you want to proceed?`; a dim
standing-unavailable line when the named host is not reachable; the options; and the footer (D-22).

The warning comes from SPEC 25.20's closed table of **sixteen** patterns matched in order against
the command truncated to 10,000 UTF-16 units. The sixteen strings are literal and short —
`Note: may discard uncommitted changes` (`git reset --hard`), `Note: may overwrite remote history`
(`git push --force`), `Note: may permanently delete untracked files` (`git clean -f`),
`Note: may discard all working tree changes` (`git checkout .` / `git restore .`),
`Note: may permanently remove stashed changes`, `Note: may force-delete a branch`,
`Note: may skip safety hooks` (`--no-verify`), `Note: may rewrite the last commit` (`--amend`),
three `rm` forms, two SQL forms, `Note: may delete Kubernetes resources`,
`Note: may destroy Terraform infrastructure`. They do not change the verdict; they annotate.

Most Bash calls never reach this dialog at all: SPEC 25.9's read-only argv allowlist, safe-flag
table and regex allowlist, plus the sandbox auto-allow paths of §25.18, resolve to `allow` before
any prompt (D-12).

**Job.** Show the exact bytes that will run, say what they are for, and — for the sixteen commands
that destroy something — say what they destroy, in the half-second before the user presses Return.

**Wire.** `R`. `permission_bash` is never sent; the host reconstructs from `tool_name === "Bash"`
and `input.command` (tui-parity §24.14.a, Bash row). `classifierState` has no wire equivalent (`D`).
The warning is not on the wire either, but it does not need to be: the pattern table is a closed,
public constant the host can evaluate on `input.command` itself.

**afleet today.** `built` and thin. `PermissionCardView` draws `display_name ?? tool_name` as the
title (so `Bash`, never `Bash command (unsandboxed)`), the description line, and
`ToolInputView.bash` renders `command` in monospace with selection enabled. There is **no**
destructive warning anywhere in `App/Decisions/` — no `Note: may` string exists in the tree — and no
`Do you want to proceed?` line.

**GUI form.** Region: **Decision card**. Add three things and change nothing else:

1. **The title variants.** `Bash command`, `Bash command (unsandboxed)`, `Bash command (runs on
   <host>)`. The middle one is the one that matters: it is the only place the terminal tells a user
   this command escapes the sandbox.
2. **The warning row**, verbatim, above the question, in the app's warning colour with the SF
   Symbol `exclamationmark.triangle.fill`. Sixteen regexes evaluated on `input.command`. This is
   the highest value-per-line change in the lane.
3. **The question line** `Do you want to proceed?` above the buttons, because a card in a scrolling
   list needs to say that it is asking, where a terminal dialog that owned the screen did not.

`[exceeds]` The GUI can syntax-highlight the command, wrap it without a gutter, and — where the
warning fires — name the concrete target the terminal only computes for telemetry
(SPEC 25.20's `git_destructive_target`: `main_like` versus `feature` for a force push). Showing
"force-pushing to **main**" instead of "may overwrite remote history" is strictly more useful and
the computation is already specified.

**Drops / keeps / gains.** Drops: the withheld-marker form (the GUI can always show the command),
the standing-unavailable line until afleet routes commands to named hosts. Keeps: three titles, the
description, the sixteen warnings, the question. Gains: highlighting, the named force-push target.

**Open.** Should the warning also gate the button — for example, requiring the destructive approval
to be clicked rather than Return-able? Canon does not. The 150 ms grace (D-04) may be enough.

### D-12 · The asks that never happen: the read-only allowlist and the rules that pre-answer

**Terminal.** The most common outcome of a permission check is that no dialog is drawn. SPEC 25.9
gives three layers for Bash — an argv-level allowlist (`$po`), a per-command safe-flag table
(`Apo`, walked by `GFe`), and a regex allowlist (`Hpo`) — that classify a command as read-only and
allow it outright. SPEC 25.18 adds the sandbox auto-allow paths, over the AST and, for commands the
parser gave up on, over the text. Above both sit the rule layers of SPEC 24.5–24.8: eleven sources,
merged by precedence, with `deny` beating `ask` beating `allow`. The user sees none of this. What
they see is the *absence* of a prompt — and, when it goes wrong, a prompt for something they
believe they already allowed.

**Job.** Keep the number of decisions a person has to make small enough that the ones they do make
get read. A permission system that asks about `ls` trains the user to press Return.

**Wire.** `P` for the outcome (an allowed call simply never produces `can_use_tool`), `R` for the
explanation: the rule grammar, the aliasing table and the per-tool specifier dialects are all
host-side reimplementations (tui-parity §24.5–24.9 rows, classed `R`, with the matcher itself
flagged there as "a real UX-superiority opportunity — the TUI shows none of this").

**afleet today.** `undesigned`. Nothing in afleet models why a call was *not* asked about; the
absence of a card is the whole surface.

**GUI form.** Region: **Panel** (a Permissions tab or the Settings window), not the Decision card —
this is a surface for the moment *after* a user asks "why did it just do that without asking?".
Two pieces, both cheap because the data is already fetchable:

- **A rule inspector.** Given a rule and a candidate call, say whether the rule covers it. The
  terminal cannot do this; the tui-parity inventory names it explicitly as the opportunity.
- **A "why no prompt" readback on any tool-call row in the Timeline**: `allowed by
  Bash(git status:*) — user settings`, or `read-only command`, or `sandboxed`. Hover-only, so it
  costs no vertical space.

Both are `[exceeds]`. Neither is on the critical path; the card exists so the map shows that the
permission denominator includes the decisions the user never sees.

**Drops / keeps / gains.** Drops: nothing (there is nothing drawn to drop). Keeps: the principle
that a safe call is not a decision. Gains: an inspectable answer to "why".

**Open.** Does afleet have the rule set at hand? `get_settings` returns only the five settings
sources; `cliArg`, `command`, `session`, `toolsNarrowing`, `mcpServerPolicy` and `hostCredential`
are memory-only (tui-parity §24.8 row, classed `D` for those six). A "why no prompt" readback would
be right most of the time and silent the rest — which is acceptable for a hover, not for a claim.

### D-13 · PowerShell command

**Terminal.** `cli.pretty.js:520535`. Structurally the Bash dialog with two differences: the title
has only two forms (`PowerShell command (unsandboxed)` / `PowerShell command`) — there is no
`runs on <host>` variant — and the warning table is SPEC 25.22.4's **fifteen** patterns rather than
Bash's sixteen. Six of the fifteen are PowerShell-specific and have no Bash counterpart:
`Note: may clear content of multiple files` (`Clear-Content *`), `Note: may format a disk volume`
(`Format-Volume`), `Note: may clear a disk` (`Clear-Disk`), `Note: will shut down the computer`
(`Stop-Computer`), `Note: will restart the computer` (`Restart-Computer`), and
`Note: permanently deletes recycled files` (`Clear-RecycleBin`). Note the tense: two of them say
`will`, not `may` — the only two in either table that do.

**Job.** The Bash card's job on Windows.

**Wire.** `R`, identical to Bash: `permission_powershell` is never sent, reconstruct from
`input.command` (tui-parity §24.14.a, PowerShell row).

**afleet today.** `undesigned` for the route; a PowerShell call would fall into
`ToolInputView`'s `.other` branch and render as a key-value dump, because `ToolInput` has a `.bash`
case and no PowerShell case (`App/Decisions/PermissionCardView.swift`, the `ToolInputView` switch).
afleet is macOS-only, so this is latent rather than broken.

**GUI form.** Region: **Decision card**. Same route as D-11 with the second table and the two-form
title. The only design decision is whether to carry it at all: afleet targets macOS, and a session
hosted on a remote Windows machine is the only path to a PowerShell ask. Carry the table — it is
fifteen constants — and let the route light up if that path ever exists.

**Drops / keeps / gains.** Drops: nothing. Keeps: two titles, fifteen warnings, `Do you want to
proceed?`. Gains: none specific.

**Open.** Does afleet ever host a Windows engine? If never, this card is `out-of-scope` rather than
`undesigned` and the orchestrator should rank it last.

### D-14 · File edit, create, overwrite and write: the four titles and the inline diff

**Terminal.** `cli.pretty.js:370430-370531`. The file dialog picks its **title** from the operation
actually resolved against disk, not from the tool name: `Edit file` for `Edit`, and for `Write` one
of `Create file` (no existing file), `Overwrite file` (a file was read), or `Write file` (existence
could not be determined). The **subtitle** is the path. The **question** is not
`Do you want to proceed?` but a composed sentence,
`` `Do you want to ${verbPhrase} ${fileName}?` `` with the filename bold
(`cli.pretty.js:519963`), where `verbPhrase` is `make this edit to`, `create`, `overwrite` or
`write to`. The body is a real diff — `file-edit-diff` for `Edit` (all edits, `replace_all` carried
through), `file-write-diff` for `Write` (old content against new).

The diff is replaced by a sentence when the content cannot be shown, and these sentences are the
load-bearing copy of the whole family, because each one says *approval here is unreviewable*:

```text
Proposed edit is too large to show — cannot be reviewed, so approval is one-time only (deny unless expected).
Proposed content is too large to show — cannot be reviewed, so approval is one-time only (deny unless expected).
Existing file is too large to preview — approving will overwrite <path>.
File is on a network path that cannot be previewed — approving will write to <path>.
Current contents of <path> cannot be shown in full — the overwrite cannot be reviewed, so approval is one-time only (deny unless expected).
```

Two quirks worth carrying. First, a `Bash` `sed -i` call is re-dressed as a **file** dialog:
title `Edit file`, verb `make this edit to`, a simulated diff of what `sed` would produce, and a
per-failure explanation when it cannot be simulated (`cli.pretty.js:370561`). Second, when the ask
is the one-time outside-reads offer the title and question are replaced wholesale with
`Read outside the working directories` and `Allow reads outside the working directories?`
(`cli.pretty.js:370531`, SPEC 24.18.3). Answers are `accept-once`, `accept-session`, `reject` and
`block-outside-reads`.

**Job.** Let a person approve a change by reading the change, not by trusting a filename — and,
when the change cannot be shown, say so loudly enough that they deny instead.

**Wire.** `R`. `permission_file` is never sent; reconstruct from `input.file_path` plus
`old_string`/`new_string`/`content`, and infer `operationType` by stat-ing the file. tui-parity's
file row is explicit that the terminal's structured patch is computed at *call* time, not at ask
time, so the host must compute its own diff. MultiEdit folds into the same dialog with no separate
kind.

**afleet today.** `built` and the strongest of afleet's routes. `ToolInputView` gives `.write` and
`.edit` a path line plus `DiffView(input:)`, backed by `App/Decisions/DiffRendering.swift` (365
lines) and `AttributedDiffRenderer.swift`. What is missing is everything around the diff: the four
titles (afleet shows `Write` or `Edit`), the composed question sentence, the create/overwrite
distinction, and — most consequentially — the five withheld-content sentences. A too-large edit in
afleet renders as whatever `DiffRendering` does with it, with no sentence saying the approval is
unreviewable.

**GUI form.** Region: **Decision card**, with the diff as the body.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⏺ Overwrite file                                                       │
│   FleetKit/Sources/Session.swift                                       │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │  12 -    let mode: PermissionMode                                │   │
│ │  12 +    var mode: PermissionMode                                │   │
│ │  13 +    var lastAsk: Date?                                      │   │
│ └──────────────────────────────────────────────────────────────────┘   │
│ Do you want to overwrite Session.swift?                                │
│ [ Allow once ]  [ Yes, and don't ask again for Edit(FleetKit/**) ▾ ]    │
│ [ No, tell Claude what to do differently ]                             │
└────────────────────────────────────────────────────────────────────────┘
```

Keep the four titles, the bold-filename question, and all five withheld sentences verbatim — they
are the only copy in the family that changes what a careful user does. `[exceeds]` The GUI has a
real editor: the diff should be scrollable, syntax-highlighted, expandable to full file context,
and openable in the Files panel (Monaco) beside the card. That also gives afleet the thing the
terminal reaches for `Ctrl+G` to get (D-30) — editing the proposal before approving — via
`updatedInput`, which tui-parity confirms is fully expressible (`P`), with the caveat that
`userModified` is not on the wire, so the model is never told the user edited.

**Drops / keeps / gains.** Drops: the terminal's fixed-width patch rendering, the ASCII gutter.
Keeps: four titles, the verb-phrase question, the five withheld sentences, the outside-reads title
swap. Gains: a real diff, syntax highlighting, expand-to-context, edit-before-approve.

**Open.** If a user edits the proposed content before approving, should afleet say so to the model
in a following user message, given `userModified` cannot cross? Owner's call: it costs a turn.

### D-15 · NotebookEdit

**Terminal.** `cli.pretty.js:370480-370522`. Title `Edit notebook`, **no subtitle** (the path is
not shown — the only file route that omits it). The verb phrase branches on `edit_mode`:
`insert this cell into`, `delete this cell from`, or `make this edit to`, so the question reads
`Do you want to insert this cell into notebook.ipynb?`. The body is a `notebook-edit-diff` carrying
`cellId`, `newSource`, `cellType`, `editMode` and, when it could be read, the old cell source.
Reading the old cell has **six** distinct failure explanations, each folded into one sentence:

```text
Current cell contents cannot be shown (<reason>) — the <edit|deletion> cannot be reviewed, so approval is one-time only (deny unless expected).
```

with `<reason>` one of `the current cell contents cannot be shown in full`, `the notebook could not
be parsed for preview`, `the target cell was not found in the notebook`, `the notebook is on a
network path`, `the notebook is too large to preview`, `the notebook could not be read`. The
notebook renderer runs at `verbose: true, width: 120`.

**Job.** A notebook cell is not a file: the unit of change is a cell, addressed by id, and a diff
of the JSON would be unreadable. This route exists so the user reviews a cell.

**Wire.** `R`, folded into the file dialog by tui-parity's file row (Edit / Write / MultiEdit /
NotebookEdit reconstructed from the input).

**afleet today.** `undesigned`. `ToolInput` has no notebook case; a `NotebookEdit` ask parses as
`.other` and renders as a key-value dump of `notebook_path`, `cell_id`, `new_source`, `cell_type`,
`edit_mode` (`App/Decisions/PermissionCardView.swift`, `ToolInputView` switch and
`GenericToolInputView`). That is not nothing — the raw source is shown — but there is no old cell,
no diff, and none of the six sentences.

**GUI form.** Region: **Decision card**. Add a notebook route: title `Edit notebook`, the
three-way verb phrase, and a body that shows the cell being changed with its language
(`cell_type === "markdown"` → Markdown, else Python) and the old cell above the new when it can be
read. `[exceeds]` afleet's Files panel already needs a notebook viewer; the card's body should be
the same component, so a user can open the whole notebook beside the card and see the cell in
place — which is exactly what the terminal cannot do and what makes a one-cell diff safe to
approve. Keep the six-reason sentence: `deny unless expected` is the right default when the before
state is unknown.

**Drops / keeps / gains.** Drops: `width: 120`. Keeps: the title, the three verbs, the six failure
reasons. Gains: the cell in the context of its notebook.

**Open.** Does afleet's Files panel render `.ipynb` today? If not, this card's `[exceeds]` half
depends on lane E/F's notebook viewer.

### D-16 · WebFetch and WebSearch: the `Fetch` dialog and the domain rule

**Terminal.** `cli.pretty.js:520914`. Title `Fetch` — not `WebFetch`, not the tool's display name.
The body is a padded box with the URL and its context; then the decision-reason banner with
`toolType: "tool"`; then the question, which is its own sentence and shared with nothing else:
`Do you want to allow Claude to fetch this content?`. The dialog kind is `permission_webfetch`
(the literal, verified at `cli.pretty.js:370569`) and its payload field is `hostname`.

The persistent row for this route is a **domain** rule, and the domain dialect is narrower than it
looks (SPEC 24.6.3). The only accepted specifier is `domain:<host-pattern>`; URLs and bare hosts are
rejected by the validator. Matching is case-insensitive, strips a trailing dot, and `*` expands to
`[^.:]*` so it cannot cross a label boundary or a port separator. Critically,
`domain:*.example.com` requires **at least one** label before `example.com` and therefore does
**not** match `example.com` itself — the single most likely way a user writes a rule that silently
fails. The candidate is built from the request URL's hostname alone; redirect hops are never added,
so a rule that allows the first host does not allow where the redirect lands.

`WebSearch` has no domain dialect at all: SPEC 24.9.1 rejects wildcards in `WebSearch` rules, so a
search ask can only ever be allowed whole-tool or once. One quirk the somersault clone verified at
implementation contact: `Fetch` is **the one footerless permission dialog** — upstream mounts a bare
frame there and draws no hint row (`CC-to-SDK/docs/parity/tui-ux.md:1701`, row `DG13`, and the
consult-footer row at `:306` confirming "`FetchPermission` staying footerless is **not** the gap").

**Wire.** `R` for the dialog, `P` for the rule: reconstruct the hostname with
`new URL(input.url).hostname`, and the suggestion rows arrive ready-made as
`WebFetch(domain:<host>)` inside `permission_suggestions` (tui-parity §24.14.a WebFetch row,
§24.12 suggestion row).

**Job.** Tell the user which host is about to be contacted, and let them say "this host is fine"
without saying "the web is fine".

**afleet today.** `built` and generic. `ToolInputView.webFetch` draws `fetch.url` as a plain
`.callout` line and `.webSearch` draws the query; the title is `display_name ?? tool_name`, so
`WebFetch`; there is no `Fetch` title and no fetch question. The domain rule reaches the card only
as whatever `permission_suggestions` contains, rendered by `expansionReading` as
`Always allow adds an allow rule for WebFetch(domain:example.com) to This project, locally.`

**GUI form.** Region: **Decision card**. Keep the `Fetch` title and the fetch question. Two GUI
gains that matter more here than in any other route:

- **Show the host, not the URL.** Draw the hostname prominently and the path secondarily, because
  the hostname is what the decision is about and what the rule will name. `[exceeds]`
- **Show what the rule would and would not cover.** `domain:*.example.com` not matching
  `example.com` is a footgun the terminal leaves in place. A GUI with room can render the rule and
  one line under it: `covers api.example.com, docs.example.com — not example.com`. This is the
  rule-inspector of D-12 applied at the one place it is cheapest.

Keep the redirect fact as copy: if afleet ever shows a fetch result whose final URL differs from the
requested one, say so on the result row, because the permission was granted for the first host only.

**Drops / keeps / gains.** Drops: nothing. Keeps: the `Fetch` title, the fetch question, the domain
dialect. Gains: host-first layout, a rule-coverage line.

**Open.** None.

### D-17 · MCP tool asks, and the organisation ask ceiling

**Terminal.** An MCP tool has no dialog kind of its own; it takes the generic dialog with three
flags set: `isMcp`, `hasMcpSuffix`, and `isAskCappedByOrg`. The last is the one with teeth. When
`tool.mcpInfo.effectiveMaxPermission === "ask"`, the organisation has capped the tool at *ask*, the
decision reason becomes `Your organization requires approval for this tool` (SPEC 24.20.9), and the
"don't ask again" row is **hidden** — `nn(payload)` returns true and `Wst` therefore returns false
(SPEC 24.14.3). So the user sees an approval they must give again every single time, with one
sentence saying why. The rule dialect (SPEC 24.6.4) is `mcp__<server>` or `mcp__<server>__<tool>`;
the server name is never globbed; parentheses are rejected; and a wildcard tool name is refused in
an **allow** rule unless the `mcp__<server>__` prefix is literal, with the suggestion
`An allow pattern must name the scope it widens — globs are permitted only in the tool position
after a literal mcp__<server>__ prefix. Deny and ask rules accept wildcards anywhere`. The generic
body marks an MCP call with an `(MCP)` marker and clips the description to **three lines** — both
verified against the binary by the somersault clone (`CC-to-SDK/docs/parity/tui-ux.md:1701`, row
`DG19`).

**Job.** Make a third-party server's tool call as legible as a first-party one, and make an
organisation's "always ask" stick.

**Wire.** `P` for the text, `D` for the flag. `tool_name` arrives as `mcp__<server>__<tool>` and
`display_name` humanised; `isAskCappedByOrg` is not a wire field, but its effect is, because the
capped ask arrives with `decision_reason: "Your organization requires approval for this tool"`
(tui-parity §24.14.a MCP row: "P for the text, D for the flag that hides don't ask again").

**afleet today.** `built`, generic, and **wrong on the ceiling**. An MCP ask parses as
`.other` in `ToolInput`, so `GenericToolInputView` dumps its arguments — acceptable. But
`DecisionCard.alwaysAllow` gates only on `suppress_always_allow_rule` and on the suggestions being
present and modellable (`App/Decisions/DecisionCard.swift:157-170`). An org-capped ask that still
carries suggestions would therefore show *Always allow* where canon hides it. The engine may or may
not send suggestions in that case — unverified — but the card should not depend on that.

**GUI form.** Region: **Decision card**. Three changes:

1. **Read the ceiling from the reason.** When `decision_reason` is
   `Your organization requires approval for this tool`, hide *Always allow* and render the sentence
   where the reason banner goes. This is the honest reading of the only signal the wire carries.
2. **Name the server.** `mcp__github__get_issue` should render as `github · get_issue`, with the
   server name carrying the same weight as a tool name, because the trust decision is about the
   server. `[exceeds]` — link it to the `/mcp` browser (lane E's surface).
3. **Show the rule dialect's shape** in the persistent row: `mcp__github__get_*` covers a server's
   tools, `mcp__github` covers the server. Do not let a user type parentheses.

**Drops / keeps / gains.** Drops: `hasMcpSuffix` as a rendering flag. Keeps: the org-ceiling
sentence and the hidden persistent row; the rule dialect. Gains: server-first naming, a route into
the MCP browser.

**Open.** Does the engine send `permission_suggestions` on an org-capped ask? If it does, afleet's
current card offers a grant the terminal refuses to offer. Worth one probe.

### D-18 · Agent, Skill and workflow asks, and the request-source badge

**Terminal.** Three routes and one piece of shared chrome.

`permission_skill` carries a `skill` payload; the ask message is `Execute skill: <name>` and the
suggestions are `Skill(<name>)` and `Skill(<name>:*)` (SPEC 24.6.6, tui-parity §24.14.a
Browser/Skill/Monitor/Workflow row). The somersault clone verified two details of this body against
the binary: its question is `Use skill "<name>"?`, and the exact and `prefix:*` persistent rows
**coexist** — they are independent gates, so a skill ask can show two don't-ask-again rows rather
than one (`CC-to-SDK/docs/parity/tui-ux.md:1701`, row `DG14`). `permission_workflow` carries a `script` payload and is the
one kind declared outside the permission chunk (`chunk-pk0trr3f.js:458839`); it is also the route
that offers the auto-mode row with the description `· workflows run best with it on`
(SPEC 24.14.3). `Agent` has no kind of its own — a subagent's ask takes the generic dialog with
`requestSource.type === "subagent"`.

The shared chrome is `requestSource`, passed to the dialog frame by every permission dialog
(visible in the Bash JSX at `cli.pretty.js:518740`). Its four types are `remote-agent`, `plugin`,
`workflow-agent` and `subagent`, and two of them do more than label: `y5(requestSource)` suppresses
the persistent row for sources that may not mint rules, and `handleUserAllow` runs
`withoutGrantsForRemoteScope` for remote and plugin-steered calls, keeping only the *restrictive*
half of any update list (SPEC 24.15.5). The frame also carries the accessibility prefix
`srPrefix: "Permission Required:"` (`cli.pretty.js:423055`) — the only screen-reader affordance in
the family.

**Job.** Say who is asking. An approval given to the main thread and an approval given to a plugin
are not the same approval, and one of them may not be turned into a standing rule.

**Wire.** `D` for the identity, `P` for the fact. `can_use_tool` carries `agent_id?` and nothing
else: the agent's **name or type is not on the wire**, and the join key to the `Agent` tool call is
`parent_tool_use_id`, not `agent_id`, so correlation is heuristic when several subagents run
(tui-parity §24.14.a Agent row, classed `D`). Skill asks arrive normally with their message and
suggestions (`P`).

**afleet today.** `built`, minimally. `PermissionCardView.subagentLabel` renders the literal string
`In a subagent run` beside the title whenever `agent_id` is non-empty, with a comment naming exactly
the gap above: "the run's type and description are C3's join and arrive with the Agents tab; the id
alone is what this card has". `remote-agent`, `plugin` and `workflow-agent` have no representation,
and no code suppresses *Always allow* for a source that may not mint rules.

**GUI form.** Region: **Decision card**, title row (D-01's `titleEnd` slot).

- Keep `In a subagent run` and **upgrade it when the Agents tab lands**: the badge should read the
  agent's type and name once C3's join exists, and link to the agent's row in the Agents panel.
  `[exceeds]` — the terminal can only name it; the GUI can go there.
- Add the other three source badges as afleet learns to distinguish them, and — this is the
  behavioural half — **hide *Always allow* for a plugin- or remote-sourced ask**, because canon
  strips those grants server-side anyway (`withoutGrantsForRemoteScope`) and offering a button
  whose effect is silently discarded is worse than not offering it.
- Skill and workflow asks get their own titles (`Run skill`, `Run workflow`) and bodies (the skill
  name; the workflow script), rather than the generic dump they get today.
- Carry `Permission Required:` into the card's VoiceOver label. It is free and it is the only
  accessibility copy canon supplies.

**Drops / keeps / gains.** Drops: nothing. Keeps: the four source types as badges, the
grant-suppression rule, `· workflows run best with it on` if afleet ever offers auto mode.
Gains: a link to the agent, a real accessibility label.

**Open.** Can afleet distinguish `plugin` and `remote-agent` sources at all today? The wire gives
`agent_id` only; if not, the card should say "source unknown" rather than imply main thread.

### D-19 · Browser and Monitor asks

**Terminal.** Two small kinds with two unusual properties.

`permission_browser` (`cli.pretty.js:520960` region, component `s1e`) carries a `verbPhrase` and a
`chrome` object with the target URL. Its options are `Allow` / `allow-domain` / `deny`, and its
persistent row is unique in the family: `` `Allow all actions on <host> for this session` `` with
the host bold, filed to **`session`**, not `localSettings` (`cli.pretty.js:520960`, the `SAt`
factory). It is offered only when `kAt` passes — the always-allow flag is set, the org has not
capped the tool, a `chrome` host exists, and the host **does not contain `*`** — and it is
suppressed outright when the URL had to be withheld.

`permission_monitor` carries `intervalMs`: the ask is not "may I do this once" but "may I do this
every N milliseconds until told otherwise". SPEC 24.6.7 gives `Monitor` its own specifier
semantics, and the somersault clone found the body has **two arms** — a polling monitor and a
WebSocket monitor, which read differently because only one of them has an interval to state
(`CC-to-SDK/docs/parity/tui-ux.md:1701`, row `DG15`).

**Job.** Browser: scope a grant to a site rather than to a tool, and only for as long as the
session lasts. Monitor: make a *recurring* permission legible as recurring.

**Wire.** `R`. Neither kind is sent; reconstruct from `tool_name` and `input` (tui-parity §24.14.a
Browser/Skill/Monitor/Workflow row).

**afleet today.** `undesigned`. Both fall to `GenericToolInputView`. The root spec's §3 scope does
include a Browser panel tab, so a browser ask is reachable in principle; a Monitor ask would render
its `intervalMs` as a raw key-value pair with no sentence saying it repeats.

**GUI form.** Region: **Decision card**.

- **Browser**: title from the verb phrase, body showing the target page (favicon, title, host,
  path). Keep the session-scoped host row verbatim — including its scope, because a browser grant
  that survives a restart is a different, larger grant than the one canon offers. `[exceeds]` the
  GUI can show a live thumbnail of the page from the Browser tab, which is a far better basis for
  "do you trust this site" than a URL string.
- **Monitor**: the card must say the interval in words — `every 30 seconds, until you stop it` —
  and the approval must be revocable from somewhere. That somewhere already exists: the Activity
  view and the channel-header "stop everything" menu. A recurring grant with no visible list of
  what is currently granted is the one place this family can quietly accumulate.

**Drops / keeps / gains.** Drops: the `*`-in-host suppression rule (afleet can render a warning
instead). Keeps: the session-scoped browser row and its wording; the interval as the Monitor card's
subject. Gains: page preview; a revocation surface for recurring grants.

**Open.** Where does a live list of session-scoped grants live — Activity, the Panel, or Settings?
Owner's call; the browser row and the Monitor interval both need it.

### D-20 · The decision-reason banner, the denial-limit disclosure and the auto-deny countdown

**Terminal.** SPEC 24.14.3. Above the options every permission dialog renders `Ig`, a stack of
stanzas built by `Re(reason, toolType, mode)`. Each stanza has a `reasonString` and an optional
`configString` telling the user where to go to change it:

| Reason | Reads | Config hint |
|---|---|---|
| `classifier` = `auto-mode` | `Auto mode classifier requires confirmation for this <tool>.` + reason, in `error` | — |
| `classifier`, other | `Classifier <name> requires confirmation for this <tool>.` + reason | — |
| `rule`, ask rule under auto mode | `Ask rule <rule> overrides auto mode for this <tool>.` | `/permissions to let auto mode decide` |
| `rule`, otherwise | `Permission rule <rule> requires confirmation for this <tool>.` | `/permissions to update rules` (empty for policy settings) |
| `hook` | `Hook <name> requires confirmation for this <tool>` + reason + dim source | `settings.json` / `plugin hooks.json` / `SKILL.md` `to update hooks` |
| `safetyCheck` / `other` | the reason alone | — |
| `workingDir` | the reason alone | `/permissions to update rules` |
| `subcommandResults` | recursive — resolves to the nested ask rule if there is one, else the first sub-result that renders | that of what it resolved to |

The **12-line combined budget** applies only when a denial-limit disclosure is present; without one
the stanzas are not truncated at all. With one, each stanza is first given `min(itsLines, 4)` and
the remainder of the twelve is handed back in the fixed order consent, streak, ask rule — so a
single stanza can occupy all twelve when the others are short.

The disclosure itself comes from SPEC 26.17.3: `` `${N} consecutive actions were blocked. Please
review the transcript before continuing.` `` or, past the total limit,
`` `${D} actions were blocked this session. Please review the transcript before continuing.` ``,
followed by a blank line and `` `Latest blocked action: ${reason}` ``. The limits are
`{maxConsecutive: 3, maxTotal: 20}`. In the `timed` fallback shape the dialog also renders a
countdown (SPEC 24.14.3): `` `<⚠> Claude Code will automatically deny this request in ${t}, to
avoid blocking progress on an unattended session` ``, where `t` is `about N minutes` / `about N
seconds` in the compact form and a live `M:SS` timer otherwise. The default timeout is 120,000 ms
(SPEC 26.17.4). On expiry the dialog auto-denies with the classifier's own resolution message.

**Job.** Answer "why am I being asked this?" in the dialog rather than in a log, and — for an
unattended session — refuse to block forever.

**Wire.** `P` for the reason text (with holes) and `D` for the countdown. `decision_reason` and
`decision_reason_type` are on `can_use_tool`, and the schema warns the reason "may carry ANSI
escapes; sanitize before rendering". But for `rule`, `mode`, `subcommandResults` and
`permissionPromptTool` reasons the redactor sends **empty** text, so the host must rebuild the
sentence from `decision_reason_type` + `matched_ask_rule` + the mode it already knows (tui-parity
§24.10–24.11 rows). `denialLimitFallback` has no `can_use_tool` field at all (`D`); headless the
limits are enforced by throwing `Agent aborted: too many classifier denials in headless mode`.

**afleet today.** `built`, and this is afleet's best-executed piece of the family.
`PermissionCardView.reason` strips ANSI with a hand-written CSI scanner and, when the reason is
empty, rebuilds it from `decision_reason_type` and `matched_ask_rule` via `rebuiltReason` — exactly
the workaround the parity file prescribes — with sentences for `hook`, `classifier`, `safetyCheck`,
`subcommandResults` and `sandboxOverride`, plus `Matched the ask rule <Tool(content)>.` What is
missing is the **config hint** half of every stanza and anything at all for the denial-limit
disclosure or the countdown.

**GUI form.** Region: **Decision card**, between body and options, exactly where canon puts it.

- Keep the rebuilt reason. Add the config hint as a **button**, not text: `Permission rule
  Bash(rm *) requires confirmation` followed by `[ Edit rules ]`, `[ Edit hooks ]`. tui-parity says
  this outright — "a GUI should replace these with real buttons that open its own rule/hook editors
  — a clear improvement over text telling the user to type a slash command that headless does not
  even have". `[exceeds]`
- Drop the 12-line budget. A GUI card can scroll, and the budget exists only because a terminal
  dialog could not.
- **Rebuild the denial-limit disclosure host-side.** afleet can count `system/permission_denied`
  frames with `decision_reason_type: "classifier"` and render its own 3-consecutive / 20-total
  warning; the parity file gives the constants. This matters because it is the signal that a
  session has gone wrong, and afleet runs many sessions at once — the count belongs in the
  **Activity view** as well as on the card.
- The countdown is `[drop]` for now: afleet's user is at a window with the session visible, not at
  an unattended terminal, and an auto-deny timer that fires while a person is reading is worse than
  no timer. Revisit if afleet ever runs sessions on a schedule.

**Drops / keeps / gains.** Drops: the 12-line budget, the countdown, the ANSI. Keeps: the eight
stanza forms, the reason rebuild, the config hint as an action. Gains: buttons instead of slash
commands; a cross-session denial-streak reading in Activity.

**Open.** Should the denial-streak warning interrupt (a banner) or accumulate (an Activity row)?
Canon interrupts, but canon has one session.

### D-21 · "Yes, and don't ask again": the consent rows, and where they file

**Terminal.** SPEC 24.14.4. The persistent row is not a button with a fixed label — it is a
`ConsentRow`, an immutable `{node, applies}` pair that can only be minted by a factory, each of
which re-validates its own updates through the `PermissionUpdate` Zod schema before accepting them.
Limits: at most **8** rules or directories shown in one row, at most **64** updates accepted from an
untrusted producer, at most **160** display units of rendered width. Only updates whose destination
is `localSettings` or `session` are displayable at all, and for the three rule-update types display
additionally requires `behavior: "allow"`.

The label is composed from the engine's own **suggestion display string**, never from a bare tool
name. Every site does this — `cli.pretty.js:14493`, `:15517`, `:477050`, `:516271`, `:520158`,
`:520655`, `:520669`, `:520814` — which is what the somersault cross-check
(`CC-to-SDK/docs/parity/spec-crosscheck-2026-09-03.md`) verified at implementation contact: the row
grants the narrow suggestion, not the tool. The variants:

| Factory | Row |
|---|---|
| rule, content `*` | `Yes, and don’t ask again for any <Tool> command` |
| rule, with content | `Yes, and don’t ask again for: <content>` |
| whole-tool | `Yes, and don't ask again for <userFacingName> commands in <cwd>` (cwd progressively abbreviated) |
| mode | `Yes, and switch to <mode description> for this session` |
| plan variant | `Yes, auto-accept edits` / `Yes, manually approve edits` |
| directories | `Yes, and always allow access to <dirs> for this session` |
| browser | `Allow all actions on <host> for this session` |
| auto mode | `Yes, and switch to auto mode` / `Yes, and use auto mode` |
| combined | seven forms joined by `qw`/`fIt`, e.g. `Yes, and allow access to <dirs> and <commands> commands` |

Combined rows join with `"; "` and re-validate the union.

**Where it files is fixed.** Every rule row goes to `localSettings` →
`<project>/.claude/settings.local.json` → `permissions.allow` (SPEC 24.15.5). Mode and directory
rows go to `session` and are never written to disk. The three-way scope picker
(`localSettings` / `projectSettings` / `userSettings`) exists only in `/permissions` → "Add a new
rule…". The permission dialog has no picker.

**Job.** Let a user stop being asked the same question, without letting them accidentally grant more
than the question was about.

**Wire.** `P` for the update, `R` for the row text. `permission_suggestions` arrives on the request
carrying the exact updates; the label is composed host-side. And — the fact this card turns on —
tui-parity states plainly that a headless host **may** file at project or user scope: "the TUI's
prompt only ever writes `localSettings`; only `/permissions` offers the three-way scope picker …
**yes** — `PermissionUpdate.destination` is a full `RuleSource` … A GUI can therefore offer the
scope picker *at approval time*, which the TUI cannot" (§24.14.b, row "Can a headless host write a
rule at project or user scope from the prompt?", classed `P`).

**afleet today.** `built`, and it exceeds canon deliberately.
`App/Decisions/DecisionCard.swift:139-170` offers `AlwaysAllowOffer` over the three settings
destinations, preselected from the suggestion's own destination and falling back to
`localSettings`; `setMode`-only suggestions get the button with no picker; an all-unmodelled
suggestion list gets no button. `PermissionAnswerMapping` re-files each suggestion at the chosen
destination and sends them as `updatedPermissions` with
`decisionClassification: .userPermanent`. And `PermissionCardView.expansionReading` writes one
sentence per suggestion *before* the click — `Always allow adds an allow rule for Bash(git push:*)
to This project, locally.` — naming every directory in full rather than a count.

**Verdict on the deviation.** Legitimate `[exceeds]`, on three conditions the built card already
mostly meets. (1) The row must show the **rule text**, not the tool name — afleet's expansion
sentence does. (2) It must show the **file** it will write — afleet names the destination in prose
(`This project, locally`) but not the path; it should read `.claude/settings.local.json`, because
"locally" is not a place a user can go look. (3) The picker must not widen what the rule *covers*,
only where it lives — afleet's `filed(at:)` changes the destination and nothing else, which is
correct.

**GUI form.** Region: **Decision card**, options row. Keep afleet's shape and make three changes:

```
[ Allow once ]   [ Always allow ▾ ]        ← ▾ opens: This project, locally  ·  This project  ·  Your settings
                 Adds an allow rule for Bash(git push:*)
                 to ~/dev/afleet/.claude/settings.local.json
[ Deny ]
```

1. Name the **file**, not the scope word.
2. Adopt canon's display limits — 8 items, 64 updates, 160 units — so a hostile or runaway
   suggestion list cannot blow up the card. tui-parity flags exactly this ("worth mirroring").
3. Carry canon's suppression conditions afleet does not yet honour: hide the row when the request
   source may not mint rules (D-18) and when the org caps the tool at ask (D-17).

`[exceeds]` The GUI can also show, under the row, which existing rule *already* nearly covers this
call — the rule inspector of D-12 — turning "don't ask again" from a blind grant into an edit.

**Drops / keeps / gains.** Drops: `localSettings`-only filing; the `"; "` join (a GUI can list).
Keeps: narrow-suggestion semantics, the row variants' wording, the three display limits.
Gains: the scope picker, the named file, the pre-click expansion sentence.

**Open.** Should `Always allow` default to `localSettings` (canon's only destination) or remember
the user's last choice? Remembering is friendlier and quietly escalates scope. Owner's call.

### D-22 · The footer: `escape to cancel`, `tab to amend`, and the explain pane that does not exist

**Terminal.** The permission dialog's footer is one dim row joined by `ue` with a middle dot:
`escape to cancel` always, plus `tab to amend` **conditionally**. The condition, read from
`cli.pretty.js:15099`, is that the focused option carries a feedback config whose inline input is
not already open (`focused === "accept" && !acceptInputMode || focused === "reject" &&
!rejectInputMode`). So the hint appears while `Yes` or `No` has focus, and disappears the moment
Tab has been pressed.

**What `amend` does** is toggle the focused option into an inline text input (D-24), not open an
editor. The Bash dialog has a second, separate amendment that no other route has: an
`editablePrefix` and a `yes-prefix-edited` answer value (`cli.pretty.js:518713`), which lets the
user edit the *rule prefix* of the don't-ask-again row before granting it — the terminal's only
"grant something narrower than what was suggested" affordance.

**There is no explain affordance at 2.1.263.** `ctrl+e` is bound in exactly four places, none of
them `Confirmation`: `Chat` → `chat:externalEditor`, the agents view's group hint
(`cli.pretty.js:374856`), `Transcript` → `transcript:toggleShowAll`, and `ThemePicker` →
`theme:editCustom` (`cli.pretty.js:278427`, `:542409`). There is no `action: "explain"` and no
`explain` handler anywhere in the build; `"explain"` as a literal finds only a syntax-highlighter
keyword and a feedback-category enum (`:364564`, `:758677`). tui-parity reached the same conclusion
at 2.1.257 and says so in as many words: "the classifier 'explain' affordance — **no such option
exists**. What ships is the decision-reason banner … plus the `/permissions` → `Recently denied`
tab". The somersault clone's §4 consult-footer row cites an upstream
`escape / cancel · tab amend · ctrl+e explain` at `L505286` and lists `DG4`'s explain pane as a
reachable F6 non-goal (`CC-to-SDK/docs/parity/tui-ux.md:306`, `:271`); that reference is to an
older bundle, and the clone's own note that the hint "never renders" is the observation that
matches 2.1.263. Treat the task prompt's `ctrl+e explain` as not canon at this version.

**Job.** Tell the user the two things they can do that are not clicking a button.

**Wire.** `T`. Keybindings are terminal configuration.

**afleet today.** `undesigned`. No card draws a hint row; `PermissionCardView` binds
`.defaultAction` to *Allow once* (gated on `isActive` and `default_to_no`) and nothing else. The
denial `TextField` is always visible rather than revealed by an amend gesture, which is the GUI
answer to the same need and is fine — see D-24.

**GUI form.** Region: **Decision card** footer, on the active card only, per D-06.

- `⎋ close · ⌘⏎ allow · ⌘⌫ deny`, dim, capped at four items. Note the deviation: afleet's Escape
  **closes the card**, it does not cancel the request (D-23), so the word must be `close` and not
  `cancel`.
- Do not build an explain pane. Build the two things canon actually offers instead: the reason
  banner with real buttons (D-20) and a rule-coverage line (D-21). If the owner wants "explain",
  the honest form is a link to the matched rule or hook in a settings editor, not a generated
  paragraph.
- Carry the Bash editable prefix as a real control: the persistent row's rule text should be
  **editable in place** before `Always allow` is clicked. This is `yes-prefix-edited` translated,
  and it is the one affordance in the family that lets a careful user grant less than they were
  offered.

**Drops / keeps / gains.** Drops: `tab to amend` as a hint (the field is always visible), the
`ctrl+e explain` that never existed. Keeps: the footer as a four-item dim row; the editable rule
prefix. Gains: menu-bar equivalents (D-06); an editable rule text.

**Open.** None.

### D-23 · Escape, the answer branches, and `default_to_no`

**Terminal.** SPEC 24.14.5 gives the dialog three answers and each one branches.

**Allow** resets the denial streak if it closed a fallback, sets the global
`hasSeenAutoModeOutsideReadPrompt` flag if the ask offered the outside-reads choice, then runs
`handleUserAllow`, which sanitises the updates, strips grants for remote and plugin scopes, strips
whole-tool grants for an ask, and persists what is left.

**Deny** books `{decision:"reject", source:{type:"user_reject", hasFeedback}}` and then chooses a
model-facing string, unless the ask had already been withdrawn, in which case the result is
`{behavior:"ask"}` carrying:

```text
The request this approval was for had already been withdrawn; the answer applied to nothing.
```

**Cancelled (Esc)** is the branch that surprises. It notifies the bridge with
`{behavior:"deny", message:"User aborted"}`, books `{type:"user_abort"}`, and then takes the
**first** of three sub-branches: an external racer present (teammate agent, async subagent,
remote-executed call, or a hook/plugin-steered context) returns a **soft** `{behavior:"ask"}` and
does **not** abort the turn; an ask that already ended returns the withdrawn sentence; otherwise
`cancelAndAbort(undefined, true)` aborts. `cancelAndAbort` itself returns `behavior: "ask"` — a soft
denial that carries rejection text to the model without recording a permanent decision — and aborts
the turn unless there is feedback, content blocks, or the caller is a subagent.

`default_to_no` changes the option order rather than merely the focus: `No` is unshifted to the
front of the list instead of appended (SPEC 24.14.3), so it takes the first digit shortcut as well
as the initial focus.

**Job.** Distinguish three different things a user can mean — "not this", "not this, and here is
what to do instead", and "stop, I did not mean to be here" — and make the third one cheap.

**Wire.** `R`, with a hole that is behavioural rather than cosmetic. The response union is
`allow{updatedInput?, updatedPermissions?, toolUseID?, decisionClassification?}` or
`deny{message, interrupt?, toolUseID?, decisionClassification?}`. tui-parity is explicit: "the
TUI's `behavior:"ask"` shape is not expressible on the wire — every headless rejection is a hard
`deny` and is recorded in `result.permission_denials`. Behavioural, not cosmetic." The host must
compose the whole model-facing string itself and choose `interrupt` to reproduce the abort. A late
answer after `control_cancel_request` is discarded, so the host must dismiss rather than answer.

**afleet today.** `built` for allow and deny, **absent** for cancel. `DecisionAnswerMapping`
produces `.permission(.deny(message:interrupt:false, classification:.userReject))` — a hard,
booked deny that never interrupts — and there is no `.closeDialog` path for a permission card
(`App/Decisions/DecisionAnswerMapping.swift`; `closeDialog` exists only for the two forwarded dialog
cards). `default_to_no` is honoured for focus and for unbinding the Return shortcut
(`PermissionCardView.initialFocus`, `.approveShortcut`) but not for option order — afleet's buttons
are always Allow, Always allow, Deny.

**GUI form.** Region: **Decision card**, options row.

- **Give the card a third exit.** Today a user who did not mean to see this card can only Deny,
  which books a rejection and tells the model to stop. Add a **Cancel** that sends
  `deny{message: <the §24.20.3 user-abort text>, interrupt: true}` and is labelled for what it does
  — `Stop this turn`, not `Cancel`, because on this wire it is not soft. Keep Deny as the
  "not this one, carry on" answer with `interrupt: false`. That is the honest GUI mapping of a
  distinction the wire cannot carry, and it is better than canon's, because canon's Esc silently
  means two different things depending on who is racing.
- **`default_to_no` should reorder, not only refocus.** Put Deny first in the row when the flag is
  set. afleet already gets the important half right (no Return binding).
- **Dismiss on `control_cancel_request`.** The card must go inert rather than answer; the withdrawn
  sentence is the right inert reading.

**Drops / keeps / gains.** Drops: the soft-ask shape (unavailable), the three cancel sub-branches,
the outside-reads latch. Keeps: `default_to_no` order and focus; the withdrawn-request sentence;
the distinction between "no" and "stop". Gains: an explicit stop that says what it does.

**Open.** Should closing a card with the window's close gesture (or Escape) do nothing, deny, or
stop the turn? Canon's Esc stops the turn. In a window with twenty channels, an accidental Escape
that aborts a turn is expensive. Recommend: Escape closes nothing; the stop is a labelled button.

### D-24 · Feedback: the two placeholders, and the four strings the model sees

**Terminal.** SPEC 24.14.6. Selecting `Yes` or `No` a second time — or pressing Tab (D-22) —
expands the focused option into an inline text input. **The option labels themselves are bare `Yes`
and `No`** (`cli.pretty.js:15706`, `:15711`); the familiar "tell Claude what to do differently" is
not a label, it is the input's **placeholder**:

```js
uD = { accept: "tell Claude what to do next", reject: "tell Claude what to do differently" }
```

(`cli.pretty.js:15117`.) Accept feedback is appended to the tool result as an extra text block.
Reject feedback becomes a prefix. SPEC 24.20.3 gives four rejection strings chosen by whether the
caller is a subagent and whether the user typed anything; the two feedback forms are
newline-terminated prefixes and the user's text follows directly with no tag around it:

```text
The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.
The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:
Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task.
Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user said:
```

The first two are the main thread's; the last two a subagent's.

**Job.** Let a rejection be steering rather than a wall — the difference between the model stopping
and the model trying the right thing next.

**Wire.** Asymmetric, and this is the sharpest gap in the lane. Reject feedback is `R`: the host
composes the whole string from §24.20.3 and sends it as `deny.message`. **Accept feedback is `D`:**
there is no field for it. tui-parity: "A GUI cannot attach 'yes, but do X' text to an approval.
Workaround: approve, then send a `user` stdin frame — which lands as a separate turn, not as part
of the tool result, and only after the tool has run." Pasted images on a rejection (`contentBlocks`)
are `D` as well.

**afleet today.** `built` for reject, **absent** for accept, and the string is truncated.
`PermissionCardView` shows a permanently visible `TextField("Why not", text: $denial)` above the
buttons — a better GUI shape than canon's press-twice reveal — and `denialMessage` falls back to
`PermissionCardView.unstatedDenial`, which is
`"The user doesn't want to proceed with this tool use."` — the **first sentence only** of canon's
`_T`. The two sentences it drops are the two that do work: the parenthetical telling the model the
edit was not written, and `STOP what you are doing and wait for the user to tell you how to
proceed.` There is no accept-feedback field.

**GUI form.** Region: **Decision card**, above the options.

1. **Send the whole string.** Replace `unstatedDenial` with canon's `_T` verbatim, and pick between
   the four forms by `agent_id` presence and whether the user typed. When the user typed, send
   `<prefix>\n<their text>` exactly — prefix, newline, text, no tag. This is a one-constant fix with
   a real behavioural effect: the model currently is not told to stop.
2. **Keep the always-visible field**, with canon's placeholder `tell Claude what to do differently`
   rather than `Why not`. The placeholder is the instruction; "Why not" reads as an interrogation.
3. **Add the accept field** with placeholder `tell Claude what to do next`, and be honest about
   what it does: since the wire has no accept-feedback field, afleet must approve and then send the
   text as a user turn. Label it so the user knows the ordering — the text arrives *after* the tool
   runs, not before. This is the one place in the lane where the GUI must explain a wire limit
   rather than hide it.
4. `[exceeds]` The GUI can accept a **pasted image** in the rejection field and send it in the
   following user turn, which the terminal's `contentBlocks` path does natively and the wire does
   not carry.

**Drops / keeps / gains.** Drops: the press-twice reveal; `contentBlocks` on the deny itself.
Keeps: the two placeholders verbatim; all four rejection strings; the prefix-newline-text shape.
Gains: an always-visible field, images via a follow-up turn.

**Open.** Should accept-feedback be offered at all, given it cannot be part of the tool result?
It is genuinely useful ("yes, but use `--dry-run` next time") and genuinely mistimed. Owner's call;
the card recommends offering it with the ordering stated.

### D-25 · Auto mode: the flagged allow, the denied notice, and what the model is told

**Terminal.** In auto mode a classifier screens the call and most decisions never reach a dialog.
Three user-visible surfaces remain.

**The denial notice** (SPEC 26.16.8) is a `warning` notification keyed `auto-mode-denied`,
`priority: "immediate"`, assembled from three segments: the tool's user-facing name lowercased plus
` denied by auto mode` in the error colour; then, only when a reason exists, ` · <reason>` dim,
truncated to 79 characters plus `…`; then ` · /permissions` dim, always. So the line reads
`bash denied by auto mode · writes outside the working directory · /permissions`. A `noVerdict`
denial raises nothing.

**The flagged allow.** When the classifier allows but flags, the ask still reaches the dialog and
the reason banner's first stanza reads `Auto mode classifier requires confirmation for this
<tool>.` in the error colour, followed by the classifier's own reason (D-20). The auto-mode row
`Yes, and switch to auto mode` / `Yes, and use auto mode` carries the description
`· workflows run best with it on` and produces **no** permission update — the mode change is
handled separately.

**The model-facing text** differs in auto mode. The classifier denial prefixes are
`Permission for this action was denied by the Claude Code auto mode classifier. Reason: ` and
`Permission for this action has been denied. Reason: ` (SPEC 24.20.4), and when the auto-mode
consent flow is enabled the shared "work around it honestly" preamble is replaced by a much longer
variant (SPEC 24.20.1, `bhs`) instructing the model to try a narrower alternative first, to **batch**
its consent asks rather than end the turn with asks outstanding, and to phrase each as one sentence
naming the action with the consent-requiring part in bold.

**Job.** Keep the user informed about the decisions a machine made on their behalf, in a form
compact enough that hundreds of them do not become noise.

**Wire.** `P` for the denial, `D` for the mode's availability. Denials arrive as
`{type:"system", subtype:"permission_denied", tool_name, tool_use_id, agent_id?,
decision_reason_type?, decision_reason?, message}`, explicitly best-effort — "in rare races a denial
can book without a frame" — with `result.permission_denials` authoritative. Whether `auto` is even
offerable is `D`: `isAutoModeAvailable` is not on the wire, and the only probe is to attempt
`set_permission_mode {mode:"auto"}` and read the error, which costs a round trip and, on success,
actually switches the mode (tui-parity `areas/26-auto-mode.md` and §24.2 rows).

**afleet today.** `undesigned`. Nothing in `App/Decisions/` or `App/Activity/` consumes
`system/permission_denied`; the auto-mode denial line has no equivalent, and afleet offers no
auto-mode row on the permission card.

**GUI form.** Region: **Activity view** first, **Channel banner** second — not the Timeline.

- **The denial line becomes an Activity row.** `bash · denied by auto mode · <reason>` with the
  channel, the time, and a `[ Review rules ]` action replacing canon's ` · /permissions` text. This
  is the translation that most changes what afleet should build: the terminal shows one notice in
  one session, and afleet is a window over every session on the machine, so the natural home for a
  stream of machine-made denials is the cross-channel query the app already has. The root spec's
  §2 already lists denials as an Activity subject.
- **Do not truncate to 79 characters.** That bound exists for a one-line terminal notice; an
  Activity row can wrap to two lines and a hover can show the whole reason.
- **The auto-mode row on the card** stays unbuilt until afleet can tell whether auto mode is
  available. Offering a row that fails at `set_permission_mode` is worse than not offering it.
- **The consent-flow preamble is not afleet's to render** — it is system-prompt text the model
  sees — but it predicts a shape afleet should be ready for: a model that batches several consent
  asks into one message. If that lands, the Timeline will show one assistant message asking about
  three things, and the right GUI answer is a card with three checkboxes, not three cards.

**Drops / keeps / gains.** Drops: the 79-character truncation, the ` · /permissions` suffix,
`noVerdict` silence (afleet can log it). Keeps: the notice's three segments as row, reason and
action. Gains: cross-session aggregation; a durable list instead of a transient notice.

**Open.** Does the owner want auto mode offered from afleet at all? It changes who decides. If yes,
the availability probe is a real cost and belongs in the roadmap, not in a card.

---

## C. Plan mode

### D-26 · Entering plan mode: the `permission_enter_plan_mode` confirmation

**Terminal.** `EnterPlanMode` is available in afleet's headless configuration because afleet supplies a permission-prompt transport (SPEC 21 §5.1). Its `permission_enter_plan_mode` dialog is exceptional: the default path allows the tool without asking, and only an `ask` rule, hook or remote relay raises it (SPEC 21 §5.5). When raised, it shows `Enter plan mode?`, four bullets, `No code changes will be made until you approve the plan.`, then `Yes, and switch to **plan mode (research and propose changes without making them)** for this session` and `No, start implementing now` (verified in `cli.pretty.js:519153–519168`). Approval sets mode `plan` at destination `session`; denial leaves implementation available. Success renders `⏺ Entered plan mode` plus `Claude is now exploring and designing an implementation approach.`; denial renders `⏺ User declined to enter plan mode` (SPEC 21 §2.1, §5.5–5.6).

**Job.** Make an escalated planning transition explicit: what plan mode permits, what it delays, and that the mode lasts only for this session.

**Wire.** `X for the dialog / R if reached`: the named dialog kind never crosses; an escalation arrives as ordinary `can_use_tool` for `EnterPlanMode`, and the host must rebuild the copy. Transcript rendering is `R` from the tool result (`/Users/new/developer/github/afleet/docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/5 rows).

**afleet today.** `undesigned` as this surface. The generic permission path in `/Users/new/developer/github/afleet/App/Decisions/DecisionCard.swift` can classify `EnterPlanMode` only as a permission and `/Users/new/developer/github/afleet/App/Decisions/PermissionCardView.swift` lacks the four-bullet body; neither root §8.4 nor `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` specifies the special case.

**GUI form.** Region: **Decision card**, only when the engine actually escalates. Reuse D-01's frame and D-07's option list; preserve the copy and order, with the approving row's secondary line `Session only`. On ordinary unprompted entry, add no invented confirmation: render the compact two-line success in the Timeline and update the header mode readback.

**Drops / keeps / gains.** Drops: a dialog on the normal auto-allowed path. Keeps: exact escalated copy, session scope, success/decline transcript distinction. Gains: none.

**Open.** None.

### D-27 · The plan-approval dialog: shell, empty plan, and proceed step

**Terminal.** A blank plan collapses to `Exit plan mode?` / `Claude wants to exit plan mode`, with `Yes, and switch to **default (ask each time)** for this session` and `No` (SPEC 21 §7.1). A nonempty plan shows `Ready to code?`, `Here is Claude's plan:`, rendered markdown, then a separately ruled decision area reading `Claude has written up a plan and is ready to execute. Would you like to proceed?` (SPEC 21 §7.3; verified in `cli.pretty.js:519546`). At more than 200,000 characters or after markdown-safety failure, the body becomes `(the plan is too large to be shown in full — approval is withheld; send feedback asking for a shorter plan, or press Esc)` and all approve rows disappear (`cli.pretty.js:519198`). After resolution the transcript distinguishes `⏺ Exited plan mode`, `⏺ User approved Claude's plan`, and the team-lead states (SPEC 21 §7.7).

**Job.** Put the exact artifact being authorized beside the mode change it unlocks; a user must not approve implementation without being able to inspect the plan.

**Wire.** `P` for `input.plan` and `input.planFilePath`; `R` for the shell, empty variant, safety guard and transcript lines. `ExitPlanMode` arrives as `can_use_tool` with `requires_user_interaction: true` (`/Users/new/developer/github/afleet/docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/6–7 rows).

**afleet today.** `built`, but materially reduced. `/Users/new/developer/github/afleet/App/Decisions/PlanCardView.swift` shows the display name, raw selectable text and three buttons. It omits both canonical shells, the consent sentence, empty-plan variant, markdown rendering, safety-withhold state and post-approval transcript copy despite root §8.4 and `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` G1c.

**GUI form.** Region: **Decision card**, with the plan body scrollable and the decision footer sticky. Use D-07's shared option list.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Ready to code?                                            Plan · session only │
│ Here is Claude's plan:                                                       │
│ ┌──────────────────────── rendered Markdown ───────────────────────────────┐ │
│ │ …                                                                        │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ Claude has written up a plan and is ready to execute. Would you like to      │
│ proceed?                                                                     │
│ [ approval options … ]                                                       │
│ [ No, keep planning                         Tell Claude what to change ]      │
└──────────────────────────────────────────────────────────────────────────────┘
```

For blank input, replace the body with the compact two-row confirm. Keep an explicit safety ceiling, but base it on renderer/resource safety rather than copying a terminal-size cap; withhold every approval whenever the body cannot be shown faithfully.

**Drops / keeps / gains.** Drops: terminal rule glyphs. Keeps: two variants, body-before-choice order, approval withholding, resolution distinctions. Gains: `[exceeds]` native markdown, links and selection.

**Open.** What GUI rendering budget should replace the terminal's 200,000-character guard?

### D-28 · Approval options and what each persists

**Terminal.** The list is state-built, in this order (SPEC 21 §7.4–7.5):

| State | Row | Result |
|---|---|---|
| clear-context gate + bypass / auto / neither | `Yes, clear context (<N>% used) and bypass permissions` / `… use auto mode` / `… auto-accept edits` | deny this tool call, clear context, seed a fresh turn in that mode |
| bypass available | `Yes, and switch to **BYPASS PERMISSIONS (no further prompts)** for this session` | allow + session `setMode:bypassPermissions` |
| auto available | `Yes, and use auto mode` | allow + session `setMode:auto` |
| neither privileged mode | `Yes, auto-accept edits` | allow + session `setMode:acceptEdits` |
| always, unless withheld | `Yes, manually approve edits` | allow + session `setMode:default` |
| Ultraplan available, none running | `No, refine with Ultraplan on Claude Code on the web` | deny + remote handoff |
| always | `No, keep planning`; input placeholder `Tell Claude what to change` | reject, remain in `plan` |

Keep-context approvals echo `updatedInput` and persist only a session mode, never `settings.json`. Clear-context choices do not execute `ExitPlanMode`; they rebuild the turn around the plan. `Shift+Tab` approves with typed feedback; Esc rejects bare (SPEC 21 §7.6). Implementation contact also established two renderer facts: the keep-planning input's label does not print (its placeholder is the visible row), and—despite SPEC 21 §7.5 saying empty submission is a no-op—empty Enter follows `onCancel` and denies exactly like Esc (`/Users/new/Developer/GitHub/somersault/CC-to-SDK/docs/parity/tui-ux.md`, “Plan-mode approval dialog” row). Rejection stays in plan mode and uses the model-facing rejection forms of SPEC 21 §6.9.

**Job.** Let the user approve both a plan and the permission posture for executing it, or give actionable revision feedback without accidentally leaving plan mode.

**Wire.** Keep-context choices are `P`; rejection is `R`; clear-context is `D`; Ultraplan is `X`. Auto availability itself is `D`, while bypass availability is host-known (`/Users/new/developer/github/afleet/docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/6–7 rows).

**afleet today.** `built`, partial. `/Users/new/developer/github/afleet/App/Decisions/PlanCardView.swift` offers only *Approve*, *Approve and auto-accept edits*, and *Reject with feedback*; `/Users/new/developer/github/afleet/App/Decisions/DecisionAnswerMapping.swift` persists only `default` or `acceptEdits` at `session`. Its bare rejection substitutes `The user rejected this plan.` with `interrupt: false`, losing canon's bare-reject turn ending. Root §8.4 and `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` G1c intentionally cover only those three arms.

**GUI form.** Use D-07's **DecisionOptionList**, preserving order and showing a secondary consequence under every approval (`Keeps context · Manual approval`, for example). Show only modes whose availability is established; do not grey out unknowable auto or unreachable Ultraplan. Keep rejection as the final inline text row. Empty feedback must take the bare-reject path and end the turn; nonempty feedback stays non-interrupting so Claude can revise.

**Drops / keeps / gains.** Drops: unreachable rows until their capability exists. Keeps: ordering, state-built labels, session-only persistence, remain-in-plan rejection. Gains: `[exceeds]` explicit consequences per row.

**Open.** Should bypass be visually marked destructive beyond its canonical uppercase label?

### D-29 · The optional artifact-review step

**Terminal.** When the plan-artifact feature is on and the plan is nonempty, approval opens one step earlier: `Claude has written up a plan. Would you like to review it as an artifact first?`, with `Review plan as artifact` and `Skip` (SPEC 21 §7.2; verified in `cli.pretty.js:519227–519546`). Publishing then reports exactly one of `Publishing plan for review…`, `Review your plan: <url>`, `Couldn't publish plan — run /plan share to retry, or --debug for details.`, `Publishing plans isn't available right now — the plan was not published.`, or the stale-plan URL warning. Either choice continues to D-27's proceed step; publishing is review, not approval.

**Job.** Offer a richer, shareable review surface without conflating publication with permission to execute.

**Wire.** `D/X`: no artifact-publish control request exists in the recorded request set, so the host cannot implement the publish arm; skipping to approval is available (`/Users/new/developer/github/afleet/docs/tui-parity/areas/24-21-permissions-plan-questions.md`, optional artifact-review row).

**afleet today.** `undesigned`. Root §8.4 has no artifact pre-step, `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` does not include it, and `/Users/new/developer/github/afleet/App/Decisions/PlanCardView.swift` starts directly with approval.

**GUI form.** Do not render a dead first step today; go directly to D-27. If artifact publishing becomes a real afleet capability, add a compact preflight at the top of the same Decision card, not another modal: *Open review artifact* launches the Browser panel and changes the card to the URL/status line; *Skip* reveals the approval list. Keep approval controls unavailable until this pre-step settles, and never treat a successful publish as consent.

**Drops / keeps / gains.** Drops: the currently unreachable publish step. Keeps: proceed step and the separation of review from approval. Gains: `[exceeds]` an embedded Browser-panel review when capability exists.

**Open.** None until artifact publishing has a supported wire route.

### D-30 · Editing the plan in the dialog, and the plan file

**Terminal.** `Ctrl+G` opens the current plan in `$EDITOR`; changed file-backed content sets the edited flag, is persisted and re-snapshotted, and shows `✓ Plan saved!` for five seconds. The footer is `ctrl+g edit in <editor> · <plan file path>` (SPEC 21 §6.7, §7.6; verified in `cli.pretty.js:519546`). The main file is `~/.claude/plans/<slug>.md` unless project-contained `plansDirectory` overrides it; related names are `<slug>-agent-<id>.md` and `<slug>.workshop.md` (SPEC 21 §4.1–4.3). Hosted sessions snapshot eligible plan/workshop files into the transcript; retention sweeps old Markdown only in the default plans directory (SPEC 21 §4.4–4.5). The approval dialog exposes only current content, path, save state and whether an actual edit changes the approved-result heading.

**Job.** Let the approver correct the artifact they are authorizing, while keeping the saved file, visible plan and submitted `updatedInput.plan` identical.

**Wire.** `P`: `input.plan`, `input.planFilePath`, `get_plan`, and edited `updatedInput.plan` are available; snapshots and retention happen automatically. The `$EDITOR` round trip is `T` and the GUI editor is `R` (`/Users/new/developer/github/afleet/docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/4 and Ctrl+G rows).

**afleet today.** `undesigned` for editing and `built` read-only. `/Users/new/developer/github/afleet/App/Decisions/PlanCardView.swift` renders plan text without the path or edit action. `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` explicitly defers Monaco to C7.2; root §8.4 promises only plan markdown.

**GUI form.** Add *Edit plan* to D-27's footer. It opens the **Files panel** at `planFilePath`, pins the pending decision above the editor, and updates the card preview after save. Show the shortened path and a transient `Plan saved` confirmation; on approval send the edited content as `updatedInput.plan`, letting SPEC 21 §6.7 persist and mark it. `[exceeds]` Show a real diff from the received plan before the user approves. Do not expose slug minting, snapshots or retention as dialog controls. The `/plan` panel (SPEC 21 §10.3) is read-only, not a decision surface; lanes E/F should translate it as a Files/plan viewer rather than add another lane-D card.

**Drops / keeps / gains.** Drops: `$EDITOR` and storage internals. Keeps: path, changed-only edit semantics, saved feedback, edited-plan heading. Gains: native editor and before/after diff.

**Open.** Should saving immediately modify the plan file, or only stage content until an approval/rejection resolves?

### D-31 · `/ultraplan` and `ultraplan_choice`

**Terminal.** `/ultraplan <prompt>` (and a carefully bounded `ultraplan` keyword match) is enabled only when dynamic config enables it, remote sessions are possible, the current session is local, and policy allows remote sessions (SPEC 21 §11.1). Its `ultraplan_launch` dialog asks before creating a web session; phase updates culminate in a browser review. If the approved cloud plan targets local execution, dialog kind `ultraplan_choice` opens with title `Ultraplan approved`, subtitle `How should the plan be implemented?`, the plan, and: `Implement here` / `Inject plan into the current conversation`; `Start new session` / `Clear conversation and start with only the plan`; `Cancel` / `Don't implement — save plan and return` (verified in `cli.pretty.js:516453` and kind registration `cli.pretty.js:787829`). `here` injects the approved plan into this conversation; `fresh` saves the session, clears context and seeds only the plan; cancel/dismiss saves `<adjective>-<verb>-<noun>-ultraplan.md` and reports `Ultraplan rejected · Plan saved to <path>` or `Ultraplan dismissed · Plan saved to <path>` (SPEC 21 §11.4–11.5; verified in `cli.pretty.js:787885–787910`).

**Job.** Obtain richer remote planning without blocking local work, then make the consequential return choice explicit: continue here, isolate implementation, or save and stop.

**Wire.** `X`. `/ultraplan` is absent from the headless command list, and neither `ultraplan_launch` nor `ultraplan_choice` is forwarded; the whole family is unreachable (`/Users/new/developer/github/afleet/docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/11 rows).

**afleet today.** `undesigned`. `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md` §7.7 has no native `/ultraplan` route, `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` declares only two unrelated forwarded dialog kinds, and `/Users/new/developer/github/afleet/App/Decisions/DecisionCard.swift` cannot represent either Ultraplan kind.

**GUI form.** Do not pass the command through or declare its dialog kinds: show the router's local unavailable explanation. If afleet later builds cloud planning directly on its remote-session machinery, use a **sheet** for launch consent and a durable **Decision card** plus Activity item for the return choice. Preserve all three rows and descriptions; make the cloud URL, phase and saved-plan path clickable. The plan remains visible above the choice, and D-04's grace applies.

**Drops / keeps / gains.** Drops: keyword interception and unreachable local-JSX transport. Keeps: explicit launch consent, asynchronous status, the three return choices, save-on-cancel. Gains: `[exceeds]` persistent cross-channel progress and direct Browser links.

**Open.** Is native cloud planning on afleet's roadmap, or should `/ultraplan` remain an explicit terminal-only refusal?

### D-32 · Teammate plan approval: lead and teammate sides

**Terminal.** A teammate for whom plan mode is required does not open D-27. `ExitPlanMode` posts `plan_approval_request` with teammate name, timestamp, plan path/content and request id to the team lead (SPEC 21 §8.1). The lead alone may approve or reject. Approval derives the teammate's inherited permission mode from lead/team state—never from a picker—and clamps `plan` to `default`; rejection carries optional lead feedback, defaulting to `Plan needs revision` (SPEC 21 §8.2). The teammate accepts only its lead's response and binds it by request id. Rejection stays in plan mode; approval validates/clamps the inherited mode and exits. A mismatched verdict becomes `The team lead's verdict was for a different request, not this plan. Call ExitPlanMode again to resubmit it for approval.` (SPEC 21 §8.3). While waiting, the transcript says `⏺ Plan submitted for team lead approval`; approval later shows `✓ Plan Approved by <lead>`, optional `Feedback: <feedback>`, and `You can now proceed with implementation. Your plan mode restrictions have been lifted.` (SPEC 21 §7.7).

**Job.** Make plan-mode governance visible to both people: the lead sees exactly whose plan is awaiting judgment, and the teammate knows whether to wait, revise or implement.

**Wire.** `X`: `plan_approval_request` / `plan_approval_response` are in-process team inbox frames, not headless control requests (`/Users/new/developer/github/afleet/docs/tui-parity/areas/24-21-permissions-plan-questions.md`, teammate plan-approval row).

**afleet today.** `undesigned`. Root §8.4's plan card covers only local `can_use_tool`; `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-08-c6.3-decisions.md` G1c and `/Users/new/developer/github/afleet/App/Decisions/PlanCardView.swift` likewise model one session's approval, with no lead/teammate identity or waiting state.

**GUI form.** Once team frames are available, create one shared object with two presentations. On the **lead** channel and Activity view: a Decision card titled `Plan from <teammate>`, rendered markdown, *Approve* and *Request changes* with feedback; no permission-mode picker. On the **teammate** Timeline and Agents run node: an inert `Waiting for <lead>` state, then approved/rejected feedback. Approval mode is read-only metadata after resolution. A request-id mismatch is an error state with *Resubmit plan*, not an answerable stale card. `[exceeds]` Link both presentations to the teammate run and plan file.

**Drops / keeps / gains.** Drops: inbox/log mechanics. Keeps: lead-only authority, request binding, waiting state, feedback, derived mode. Gains: fleet-wide Activity visibility and bidirectional navigation.

**Open.** None until afleet receives team approval frames.

---

## D. AskUserQuestion

### D-33 · The question dialog: header, option lists, the side-by-side previews

**Terminal.** SPEC 21 §12.6–12.7. `checkPermissions` returns
`{behavior:"ask", message:"Answer questions?"}` with `answers`/`annotations` deliberately stripped,
and `requiresUserInteraction: () => true`, reaching the local dialog kind
`permission_ask_user_question`. The payload is 1–4 questions, each with a `header` (≤12 chars),
2–4 options of `{label, description, preview?}`, and `multiSelect` (§12.2). The dialog draws **one
chip per question plus a trailing `✓ Submit` tab**, hidden when there is exactly one single-select
question — then answering submits immediately. Each chip carries a checkbox glyph for answered/not
and the `header`, or `Q<n>` when blank; `Tab`/`Shift+Tab` move between questions. Previews are
normalised first: empty ones drop to `undefined`, over-2000-character or markdown-unsafe ones become
*withheld*, the rest become processed markdown. **The layout then forks**: a single-select question
with any surviving preview and no screen reader renders the **preview layout** — a 30-column option
list left, the focused option's full markdown preview right, a `Notes:` field below (`press n to add
notes`), footer `enter select · ↑/↓ navigate · n add notes · tab switch questions · ctrl+g edit in
<editor> · escape cancel`; a withheld preview reads `(preview cannot be shown in full — compare the
option labels and descriptions instead)`. Everything else uses the **standard layout**: options in
order, then `Other`, then a numbered `Chat about this` row, and in plan mode a `Planning: <plan file
path>` line above the question (never on the preview layout). The `Submit` tab shows `Review your
answers` and, when blanks remain, `You have not answered all questions`. Local answers are the
sanitised, de-duplicated `displayLabel`, not the raw label (§12.8). Two mutually exclusive layouts
from one payload is the fact a GUI has to decide about.

The clone hit the same fork and split it: its `QuestionDialog` renders questions **sequentially**
with an `[i/N]` progress chip rather than as tabs, an accepted divergence, and records the preview
two-column variant and the AFK auto-resolve as facts it does not implement
(`CC-to-SDK/docs/parity/tui-ux.md` line 2379, rows GB8 / F6 `DG45`).

**Job.** Let the model buy one decision from the user without ending its turn — and let the user
compare the options against each other, side by side, before spending it.

**Wire.** `P` for the payload, `R` for the widget: the questions arrive whole on `can_use_tool`
`input`, and the chips, tabs, review step and preview layout are all host rebuilds
(`docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/12 rows "Header chips" and
"Per-option previews"). One conditional gap: the preview section of the tool prompt is **omitted for
`sdk-`-prefixed client types**, so the model never emits previews unless the host sets
`CLAUDE_CODE_QUESTION_PREVIEW_FORMAT` (same file, top gap 13, "D with workaround").

**afleet today.** `built` — `App/Decisions/QuestionCardView.swift`, C6.3 §"The permission card"
neighbourhood and engine anchor 9. It **keeps** every question rendered at once, the `header` as a
caption, each option's label as a button with its `description` beside it, the singular `preview`
field read correctly, per-question notes into `annotations.notes`, and the answer echo the engine
requires (whole input plus `answers` keyed by raw question text, multi-select joined with `", "`,
via `DecisionCard.echo`). It **loses**: the tab strip, the answered checkbox, the `✓ Submit` tab and
the whole review step; the side-by-side preview layout — a preview renders as a monospaced `Text`
under its option, unrendered and unwidthed; the withheld-preview sentence; `annotations.preview`,
which the card hard-codes to `nil` even where canon would record the processed preview; the
`Planning: <path>` line; numbering and digit shortcuts; and **any way to decline** — the card's only
control is `Send`, so canon's `Esc → {behavior:"deny"}` has no afleet equivalent.

**GUI form.** Region: **Decision card**, Timeline. Keep afleet's all-at-once stacking — a window has
the height a terminal did not, and a tab strip that hides an unanswered question is worse in a
scrollable list than a heading is. Replace the chips with a **per-question heading row**: the
`header` as a pill, a filled/hollow dot for answered, and a `Review` summary row above `Send`
carrying canon's `You have not answered all questions` when blanks remain. Adopt the preview fork as
a **layout of the option row, not of the dialog**: when any option of a single-select question
carries a preview, that question's options render two-column with the preview rendered as markdown
in the right pane at the focused option, which is canon's arrangement without canon's whole-dialog
mode switch. Add a `Decline` action carrying canon's deny path (D-34).

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Answer questions?                                                                │
│ ● Library ─────────────────────────────────────────────────────── answered       │
│   Which library should we use for date formatting?                               │
│  ┌──────────────────────────┬────────────────────────────────────────────────┐   │
│  │ ❯ 1. date-fns (Recomm…)  │  import { format } from "date-fns"             │   │
│  │      tree-shakeable      │  format(new Date(), "yyyy-MM-dd")              │   │
│  │   2. Luxon               │                                                │   │
│  │      immutable, zones    │  ~12 kB gzipped after tree-shaking             │   │
│  │   3. Other…              │                                                │   │
│  └──────────────────────────┴────────────────────────────────────────────────┘   │
│   Note: ______________________________________________  → annotations.notes      │
│ ○ Approach ────────────────────────────────────── not answered yet               │
│   …                                                                              │
│ You have not answered all questions.                                             │
│ [ Send ]  [ Ask Claude to clarify ]  [ Decline ]        ⏎ send · ⎋ decline        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The option list is D-07's shared `DecisionOptionList`; the two-column split is the only question-only
addition. `[exceeds]` The GUI can render a `preview` as real markdown with images and syntax
colour, and can show two previews at once on a wide window, where the terminal renders one focused
preview at 30 columns.

**Drops / keeps / gains.** Drops: tabs, the mode switch between layouts, `ctrl+g edit in <editor>`,
`displayLabel` sanitisation (a GUI has no newline problem). Keeps: 1–4 questions, 2–4 options,
`header`, `description`, `preview`, `multiSelect`, the review warning, the answer echo. Gains:
rendered previews, side-by-side at full width, all questions visible at once.

**Open.** Should a question with previews open its right pane by default, or on hover/focus of an
option? Canon has no choice here; a window does, and it changes how much vertical space one question
takes in a list of four.

### D-34 · Multi-select questions and the `Other` free-text row

**Terminal.** SPEC 21 §12.7–12.8. Every question — single- or multi-select — gets an **automatic
`Other` row the model never asked for**: a `type: "input"` option whose literal label is `Other`
(verified in `cli.pretty.js:517646`), with placeholder `Type something.`, or `Type something` for
multi-select. The tool prompt tells the model so, and forbids it from adding its own: *"Users will
always be able to select \"Other\" to provide custom text input"* and *"There should be no 'Other'
option, that will be provided automatically."* (§12.4, §12.2). **The preview layout has no `Other`
row at all** — `Vae` binds its list to the options and renders exactly those (§12.7). A third row
follows in the standard layout: a numbered `Chat about this` (verified at
`cli.pretty.js:517685`, and as a `{type:"text", value:"__chat__"}` option at `:517646`), which
resolves to `{behavior:"deny", feedback:<clarification preamble>}` — a fully specified preamble
opening `The user wants to clarify these questions.` and listing every question as `- "<text>"` plus
`Answer: <a>` or `(No answer provided)` and `User notes: <n>`. Multi-select values are joined with
`, ` after quoting any value containing `, ` or `"`. An `Other` answer is the typed text; an
image-only paste becomes the literal `(Image attached)`, text-plus-image `<text> (Image attached)`;
notes with no selection become the sentinel `(notes only)`. The clone ships `Other` as a real
`type:"input"` row whose empty Enter declines, and **omits `Chat about this` deliberately** because
it calls `onRespondToClaude`, a third wire channel its dialog does not have
(`CC-to-SDK/docs/parity/tui-ux.md` lines 1733, 2379).

**Job.** Guarantee the user is never trapped inside the model's list — they can always answer in
their own words, or push back on the question itself.

**Wire.** `R`. `Other` is not in the model's schema; the UI adds it and the typed text becomes the
`answers` value verbatim. `Chat about this` is `R` too, and on the wire the deny **must carry a
non-empty `message`**, unlike the terminal's bare `{behavior:"deny"}`
(`docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/12 rows "The automatic `Other`
free-text row", "`Chat about this` row", "Cancellation behaviour").

**afleet today.** `built`, partially — `App/Decisions/QuestionCardView.swift`. It **keeps**
`multiSelect` toggling, an always-present `TextField("Other", …)`, and the invariant that matters:
for a single-select question, typing into `Other` clears the picked options and picking an option
clears `Other`, so the answer is never a pair the user did not choose. It **loses** the `Other`
placeholder copy, the `(Image attached)` and `(notes only)` sentinels (a notes-only question sends
`answers[q] = ""`, where canon sends `(notes only)`), the preview layout's deliberate *absence* of
`Other`, and `Chat about this` entirely — there is no deny path on the card at all, so a user who
does not accept the framing of the question has only silence.

**GUI form.** Region: Decision card body. Keep `Other` as the last row of the option list for every
question, drawn as an inline text field with canon's placeholder — `Type something.` single-select,
`Type something` multi-select — and keep afleet's mutual-exclusion rule as written. Do **not**
reproduce the preview layout's missing `Other`; that is a terminal space constraint, not a decision,
and the GUI has the row. Multi-select rows take D-07's `[✔]` checkbox. Add **`Ask Claude to clarify`**
as a secondary action on the card, composing canon's preamble verbatim from the questions and
whatever is answered so far and sending `{behavior:"deny", message:<preamble>}` — this is the one
canon affordance whose absence changes what the model does next, and it is pure string assembly.
`[exceeds]` A pasted image belongs in the note field with a real thumbnail rather than behind the
`(Image attached)` sentinel, once `contentBlocks` has a route.

**Drops / keeps / gains.** Drops: the sentinels, the preview layout's `Other` omission, digit
selection. Keeps: the automatic `Other`, its placeholders, the exclusive-answer rule, the `, `
join, the clarification preamble. Gains: a decline that says why, and images shown rather than named.

**Open.** Owner call: does `Ask Claude to clarify` sit beside `Send` on every question card, or only
when nothing has been answered? Canon puts it in the list unconditionally.

### D-35 · The timeout and away-from-keyboard auto-resolution (`askUserQuestionTimeout`)

**Terminal.** SPEC 21 §12.9. A question dialog can resolve itself. The AFK path is enabled when the
terminal is not in screen-reader mode, there is **no external racer** (bridge or channel client), the
session is not a background session, and either the mapped setting is non-`null` or
`CLAUDE_AFK_TIMEOUT_MS` is set. The setting maps `60s → 60000`, `5m → 300000`, `10m → 600000`, and
`never` **and absent both → `null`** — so out of the box **there is no timeout at all**; the schema
says so in its own words: `Idle time before Claude's questions auto-continue with any answers
selected so far. Defaults to never — auto-continue only runs when explicitly set to 60s/5m/10m.`
(verified in `cli.pretty.js:233888`; the `/config` row is labelled `Question auto-continue timeout`,
`:258018`). The setting can never *disable* a timeout the environment variable enabled — the two are
combined with `||`. The countdown component takes `timeoutMs` = env, else the mapped setting, else
`60000`; its threshold is `min(CLAUDE_AFK_COUNTDOWN_MS ?? 20000, timeoutMs)`; idle is measured from
`max(lastInteractionTime, dialogOpenedAt)` and **terminal focus resets the clock**. Inside the
threshold the dialog shows `auto-continue in <n>s · any key to stay` (verified in
`cli.pretty.js:518249`). On expiry it resolves **exactly as a submit**, with `afkTimeoutMs` set, and
the transcript reads `No response after <n>s — continued with the answers selected so far`
(`continued without an answer` when nothing was picked, §12.11). Distinct and unrelated: the generic
`request_user_dialog` park deadline of five minutes (SPEC 45 §45.22.13) governs D-40/D-41, not this.

**Job.** Let a long agent run survive its operator walking away, without discarding what they had
already chosen — and warn them, with a live countdown, before it does.

**Wire.** `D`. The AFK path requires *no* external racer and a non-background session, so attaching a
host disables it outright; and `afkTimeoutMs` lives on the output schema, not the input, so a host
cannot even mirror the flag with confidence
(`docs/tui-parity/areas/24-21-permissions-plan-questions.md`, §21/12 "Away-from-keyboard
auto-resolution" — class `D` — and its Unverified item 2).

**afleet today.** `undesigned`. Nothing under `App/Decisions/` carries an idle clock;
`QuestionCardView` has no timer, no countdown and no partial submit. `DialogCardView`'s
`DialogDeadline` is the *other* deadline (the five-minute park timer for forwarded dialogs) and does
not apply to `can_use_tool` questions — the card correctly does not claim it does.

**GUI form.** Region: Decision card footer, plus Settings. This is the one canon behaviour a GUI
should adopt **and change**. Adopt: an optional per-app idle timeout with canon's exact vocabulary
(`60s` / `5m` / `10m` / `Never`, default `Never`) in the Settings window, and canon's countdown copy
`auto-continue in <n>s · any key to stay` in the card footer inside the last 20 seconds, with any
interaction anywhere in the window resetting the clock — the window's focus state is a better idle
signal than a terminal's, and afleet already knows when it is frontmost. Change: on expiry send the
partial answer through the ordinary `answerQuestion` path **without** `afkTimeoutMs`, since the field
is output-only and may not survive `updatedInput` validation, and mark the card's outcome
`auto-continued` so the timeline says what happened. `[exceeds]` A macOS notification when the
countdown starts turns "the agent guessed while I was at lunch" into "I was told".

**Drops / keeps / gains.** Drops: `afkTimeoutMs` on the wire, the model-facing AFK tool-result text,
the screen-reader and racer gates. Keeps: the four-value vocabulary, the `Never` default, the
20-second countdown and its copy, "submit whatever is selected". Gains: a notification, and an idle
signal that is the whole app rather than one terminal.

**Open.** Should the app-level default stay `Never` like canon, or should an unattended fleet default
to `10m`? afleet's premise — many sessions, one operator — argues for the second, and it is a product
call, not a fidelity one.

### D-36 · Extended questions: `kind`, `placeholder`, numeric bounds

**Terminal.** SPEC 21 §12.13. A second, richer question form sits behind a host capability. The gate
is `host.launchOptions.extendedQuestionsEnabled()`, set only when `CLAUDE_CODE_QUESTION_EXTENDED` is
set **and** the entrypoint is one of `sdk-ts`, `sdk-py`, `sdk-cli`, `local-agent`, `claude-desktop`,
`claude-desktop-3p`, or the resolved client type is `remote`. It is **off in an ordinary terminal and
on exactly the kind of host afleet is.** Five effects: an extra prompt paragraph telling the model
how to use it; a different input schema adding a top-level `title` and, per question,
`kind: "choice" | "text" | "number"`, `description`, `placeholder` (text only) and
`min`/`max`/`step`/`defaultValue`/`unit` (number only), with option `description` becoming optional
and the options array losing its schema-level minimum; `checkPermissions` stamping an explicit
`kind: "choice"` on every question that omitted one and forwarding `title`; the always-extended
output schema with `followUp`; and the extra bracketed fields on the auto-mode classifier line. Six
verbatim refinement messages guard it, including `A number question needs numeric min and max with
min < max.` and `defaultValue must lie within min..max.` The prompt paragraph is explicit that this
form has **no `Other` and no `Skip`**: *"the user can always type their own answer or leave a
question unanswered"*, and that the user may ask for another round — which is what `followUp: true`
means, and it changes the transcript heading to `User asked Claude for more questions`.

**Job.** Let the model ask for a quantity or an open sentence without faking it as a choice, and let
the user ask for another round instead of answering a question badly.

**Wire.** `P`, unverified in the inventory: the extended fields ride the same `can_use_tool` `input`
that carries the base schema, and `docs/tui-parity/areas/24-21-permissions-plan-questions.md` records
the base bounds row as `P` but does not carry a row for the extended variant at all. Enabling it is a
launch-line concern (an environment variable on the spawned process), not a control request.

**afleet today.** `built`, ahead of its spec — `App/Decisions/QuestionCardView.swift`'s
`QuestionPrompt` parses `kind`, `placeholder`, `min`, `max`, `step`, `defaultValue` and `unit`, draws
a text field for `text`, a text field plus unit label plus a `min …, max …, step …` caption for
`number`, and treats an **unrecognised `kind` as a text field** on the stated ground that a control
that can carry an answer beats one that cannot. `defaultValue` is shown *and* read back, so the field
does not lie about what it would send. C6.3's engine anchors call this a widening root §8.4 does not
mention "and would otherwise have shipped as a broken card the day the flag turns on". What it
**loses**: the top-level `title` (never rendered), the per-question `description` helper line,
`followUp` (no "ask me more" action and no reading of the flag), and `number` is a text field rather
than the slider/stepper the schema describes — the bounds are shown as a caption but not enforced.

**GUI form.** Region: Decision card body. Render `title` as the card's heading in place of the
generic tool title, `description` as a secondary line under each question, `text` as a multi-line
field carrying `placeholder`, and `number` as a **stepper with the bounds enforced** and `unit`
suffixed — a slider where `step` is present and the range is small, a stepper otherwise; this is the
control the schema was written for and the terminal could only approximate. Keep afleet's
unrecognised-kind fallback verbatim. Add an **`Ask me more`** action that sends the answer with
whatever is filled in; the engine reads `followUp` and asks again, and the transcript already has
wording for it. And set `CLAUDE_CODE_QUESTION_EXTENDED` on spawn — the flag is free, the card is
already built for it, and the alternative is shipping a parser nothing ever exercises.

**Drops / keeps / gains.** Drops: the classifier line, the six refinement messages (server-side).
Keeps: `kind`, `placeholder`, `min`/`max`/`step`/`defaultValue`/`unit`, the no-`Other` rule for this
variant, the unrecognised-kind fallback. Gains: a real stepper/slider, a title, and `followUp` as a
button.

**Open.** Turning the flag on changes what the model asks for across every session. Owner call on
whether that is a default or a per-project setting.

## E. MCP elicitation

### D-37 · Elicitation, form mode: the generated form and its field types

**Terminal.** SPEC 31 §15.1–15.3. A connected MCP server may call `elicitation/create` mid-tool-call;
the harness increments `pendingElicitations` (which **pauses the tool idle watchdog**), runs the
`Elicitation` hook — a hook response short-circuits the dialog entirely — and otherwise opens dialog
kind `mcp_elicitation` with `holdsTop: true` and default result `{action:"cancel"}`. Form mode renders
the `message` plus one field per `requestedSchema.properties` entry, with `Accept` and `Decline` rows
at the bottom. The supported types are string, string-enum, boolean, number, **integer** and
array-of-enum; anything else throws `Unsupported schema: <json>`. `oneOf` takes precedence over
`enum` and uses each string `const`'s `title` as its label; `enumNames` is honoured when aligned;
`items.anyOf` takes precedence over `items.enum` for arrays. Validation is where the surface actually
lives, and every message is a literal: `This field is required`,
`Must be at least <n> character(s)`, `Must be at most <n> character(s)`,
`Must be a valid email address, e.g. user@example.com`, `Must be a valid URI, e.g. https://example.com`,
`Must be a valid date, e.g. 2024-03-15, today, next Monday`,
`Must be a valid date-time, e.g. 2024-03-15T14:30:00Z, tomorrow at 3pm`, the four numeric forms
(`Must be <an integer|a number> between <min> and <max>` / `>= <min>` / `<= <max>` / bare), and
`Select at least <n> item(s)` / `Select at most <n> item(s)`. A `date`/`date-time` field whose input
does not match `^\d{4}-\d{2}-\d{2}(T|$)` falls through to a **model-backed natural-language date
parser** ("tomorrow", "next Monday"), failing with `Unable to parse date/time. Please enter in ISO
8601 format manually.` Empty values placeholder as `not set`, free-text as `Type something…`; a schema
with no properties **auto-selects `Accept`**; a SEP-2663 task id in `_meta` appends ` (task
<shortId>)` to the header. The clone scores this row `🚫 — rarely fires headless`
(`CC-to-SDK/docs/parity/tui-ux.md` line 2314), so it carries no implementation-contact quirk.

**Job.** Let a tool the model is already running stop and ask the human for structured input —
credentials, a target, a date — without the model having to guess and without the call failing.

**Wire.** `P` (data) / `R` (widget): everything needed to render the form, `requested_schema`
included, arrives on the `elicitation` control request
`{mcp_server_name, message, mode?, url?, elicitation_id?, requested_schema?, title?, display_name?,
description?}` and the host answers `{action, content?}`. The inventory calls the widget "one of the
larger single build items in this area, and one where a native GUI clearly beats a terminal form"
(`docs/tui-parity/areas/31-27-mcp-hooks.md` §8, row 1). A host that never answers leaves the tool call
hanging — the idle watchdog is paused (same file, row "Any error during elicitation").

**afleet today.** `built` — `App/Decisions/ElicitationCardView.swift` and
`App/Decisions/ElicitationForm.swift`, C6.3 residue **D8**, engine anchor 10. It **keeps** the server
name, `title`/`display_name`, the message, the stated type subset (string, string-enum as a picker,
number, integer, boolean, array-of-string as a multi-select), `required` / `title` / `description` /
`default`, `Accept`/`Decline`/`Cancel` in both modes, and three careful things canon also gets right:
an object with **no properties is a form** whose empty answer is acceptable; an emptied list is `[]`
while an emptied string is *absent*; and a property outside the subset falls back to a raw JSON field
showing its own schema, with the card saying `Part of this form is shown as raw JSON: the server asked
for a shape afleet does not draw.` It **loses**: every one of canon's validation strings — no
`minLength`/`maxLength`/`minimum`/`maximum`/`minItems`/`maxItems` is shown or enforced, so a form that
the terminal would refuse to submit, afleet sends; the `format` family (`email`, `uri`, `date`,
`date-time`) and the natural-language date parser; `oneOf` string-const choices with their `title`
labels and `items.anyOf` labels and `enumNames`, all of which afleet routes to raw JSON; the `not set`
and `Type something…` placeholders; and the ` (task <shortId>)` header suffix. Required-ness is
enforced only as *present*, never as *valid*.

**GUI form.** Region: Decision card body, Timeline. Keep afleet's field set and its three-state entry
model. Add canon's constraint layer, because it is the difference between a form and a text box: draw
`minLength`/`maxLength` as a live character counter, `minimum`/`maximum` as a stepper's bounds,
`minItems`/`maxItems` as a checkbox-group caption, and render the exact validation sentences under the
offending field, gating `Accept` on all of them rather than on presence alone. Handle `format` with
native controls — an email field, a URL field, and a **`DatePicker` for `date`/`date-time`**, which
removes the need for canon's model-backed date parser entirely (a picker cannot produce "next
Monday"). Route `oneOf`/`anyOf` string-const members into the existing picker/multi-select with their
`title` labels instead of into raw JSON. `holdsTop: true` is D-04's focus-retention rule: an
elicitation card keeps card focus once it has it.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Connect to Linear                                    linear-mcp            │
│ Pick the workspace and the date range to import.                           │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ Workspace (required)                                                   │ │
│ │   Which Linear workspace to read from.                                 │ │
│ │   [ Acme Engineering            ▾ ]      ← enum → picker, "Not chosen"  │ │
│ │ Since (required)                                                       │ │
│ │   [ 2024-03-15  📅 ]                     ← format: date → DatePicker    │ │
│ │ Labels                                                                 │ │
│ │   [✔] bug   [ ] feature   [✔] chore      Select at least 1 item(s)      │ │
│ │ Max issues                                                             │ │
│ │   [  200  ▴▾ ] issues                    Must be an integer between …  │ │
│ │ Notify                                   [ ● ] on                      │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ [ Accept ]  [ Decline ]  [ Cancel ]                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

`[exceeds]` Native pickers, steppers, date pickers and live validation are strictly better than a
terminal list, and the raw-JSON escape hatch means an unsupported schema is still answerable where
canon throws `Unsupported schema:` and shows nothing.

**Drops / keeps / gains.** Drops: the natural-language date parser, `Unsupported schema:` as a failure
mode, the `not set` placeholder. Keeps: the field subset, `required`, `default`, the exact validation
sentences, `Accept`/`Decline`, the empty-schema auto-accept. Gains: native controls, live validation,
an answerable form for a schema outside the subset.

**Open.** The subset's boundary is a tracker entry in C6.3 D8; widening it should be driven by a
schema a real server sent, not by a shape somebody imagined. Which servers does the owner expect
afleet users to run?

### D-38 · Elicitation, URL mode, and the `mcp_elicitation_waiting` dialog

**Terminal.** SPEC 31 §15.3. `mode: "url"` is not a form: the payload carries `url` and
`elicitation_id` and **no schema**. The dialog shows the message and the URL with four actions —
` Accept  `, ` Reopen URL  `, ` Decline` and ` Cancel` — and then enters a **waiting phase**, a second
and distinct dialog:

```text
Waiting for the server to confirm completion…
Continue without waiting
```

That waiting dialog is its own kind, `mcp_elicitation_waiting`, with results
`["dismiss", "retry", "cancel", "cancelled"]`, default `"cancelled"`, and action label
`Skip confirmation`. Three safety strings guard a URL the terminal cannot render faithfully, and two
of them **disable opening altogether**: `This URL extends past this screen — its beginning is not
visible here. Review it in full before accepting.`; `This URL cannot be shown exactly as it would
open, so opening it is disabled. Decline to continue.`; `This URL's browser-ready form is too long to
hand to a browser safely, so one-click opening is disabled. The URL above is shown in full. Decline to
continue.` Three kinds are declared as SDK dialog kinds so a headless host can serve them:
`mcp_elicitation`, `mcp_elicitation_waiting`, `mcp_url_elicitation`.

**Job.** Hand the user off to a browser for something the terminal cannot do — an OAuth consent, a
purchase — and then hold the tool call open until the server says it is done, without making the user
guess when to come back.

**Wire.** `P (conditional)`. The URL elicitation arrives on the same `elicitation` request with
`mode: "url"`, but the waiting phase is a `request_user_dialog` **gated on
`initialize.supportedDialogKinds`**: "if the host does not declare `mcp_elicitation` /
`mcp_elicitation_waiting` / `mcp_url_elicitation`, the flow degrades to its no-dialog behaviour … A
GUI must declare all three" (`docs/tui-parity/areas/31-27-mcp-hooks.md` §8, row 2; and the JSON-RPC
`-32042` retry row at line 183 needs `mcp_url_elicitation` specifically).

**afleet today.** `built` for URL mode, **`undesigned` and unreachable for the waiting dialog.**
`ElicitationCardView.urlBody` draws the URL as selectable monospaced text plus
`Open this address to continue with the server.`, deliberately **not** as a link: C6.3's comment
records that opening belongs to C5's `HostLinkRouter` through a per-row capability that has not
landed, and that reaching `ChannelContext.links` another way would be the second link registry X7
exists to prevent. What it **loses** against canon: `Accept` is hidden entirely in URL mode
(`if !isURLMode` guards it), so the user can decline or cancel but cannot say *I did it* — canon's
whole point; `Reopen URL` has no analogue; the three URL-safety sentences are absent (afleet shows the
address in full, which is the honest form of the same concern, but never disables anything); and
**afleet declares only `["refusal_fallback_prompt", "fable_overage_consent_prompt"]** in
`ClaudeWire/Sources/WireTransport/InitializeConfiguration.swift:39`, so `mcp_elicitation_waiting` never
arrives at all and the waiting phase degrades silently to its no-dialog behaviour.

**GUI form.** Region: Decision card. Three changes, in order of consequence. (1) **Restore `Accept`
in URL mode** — it is the action that resolves the elicitation, and hiding it makes a URL elicitation
unanswerable in the affirmative, which is exactly the failure C6.3 §6.4 forbids. (2) **Declare
`mcp_elicitation`, `mcp_elicitation_waiting` and `mcp_url_elicitation`** in `supportedDialogKinds`, and
render the waiting phase as a **state of the same card** rather than a second card: the card shows
`Waiting for the server to confirm completion…` with a spinner and one action,
`Continue without waiting` (canon's `dismiss`), plus `Cancel`. One card that changes state is truer to
what the user is doing than two stacked cards. (3) Open the URL through `HostLinkRouter` once the
capability lands — into the **Browser tab**, which is the place canon's hand-off never had; until
then keep the selectable-text form and its sentence. Keep the safety concern in GUI terms: show the
full URL, show its host in bold, and do not shorten.

**Drops / keeps / gains.** Drops: `Reopen URL` as a separate row (the Browser tab is still open), the
three terminal-rendering safety strings, the waiting dialog as a separate surface. Keeps: `Accept`,
`Decline`, `Cancel`, `Continue without waiting`, the full URL. Gains: `[exceeds]` the hand-off lands
in a Browser tab beside the conversation instead of in an unrelated application, and the card can show
the OAuth page and the waiting state at once.

**Open.** Does the Browser tab count as "opened" for the purposes of `Accept`, or should `Accept` stay
manual? Canon has no Browser tab and cannot answer this.

### D-39 · `elicitation_complete` and how an elicitation ends (accept / decline / cancel)

**Terminal.** SPEC 31 §15.1–15.2, §15.4. An elicitation has exactly three settlements —
`accept` (with `content`), `decline`, `cancel` — and the harness's default on every failure path is
`{action:"cancel"}`: the temporary handshake handler answers `cancel`, a thrown error yields `cancel`
and logs `Elicitation error: <err>`, and the dialog's own default result is `cancel`. Around them sit
two hooks: `Elicitation` may auto-answer *instead of showing the dialog* (`Elicitation resolved by
hook: <json>`), and `ElicitationResult` may **rewrite the action or content after the user has
answered**; a blocking error from either forces `decline`. Each settlement raises a harness
notification `Elicitation response for server "<name>": <action>` (`notificationType:
"elicitation_response"`). Separately, a server may push
`notifications/elicitation/complete`, which resolves a pending URL flow and raises
`MCP server "<name>" confirmed elicitation <id> complete` (`notificationType: "elicitation_complete"`);
an unknown id logs `Ignoring completion notification for unknown elicitation: <id>`. On settlement the
harness decrements `pendingElicitations` — restarting the tool idle watchdog — and stamps
`lastElicitationClosedAt`. For a URL elicitation the user accepted but the hook did not, the waiting
state is abandoned.

**Job.** Guarantee the tool call that is blocked on a human always ends, and give the pushed
completion a place to land so the user is not staring at a spinner the server has already finished
with.

**Wire.** `P`. `elicitation_complete` is a real frame on the wire (SPEC 45 §45.9), and the inventory
names closing the waiting dialog on it as a place the GUI is **ahead** of the terminal: "A GUI can
close its waiting dialog on this frame — better than the TUI's poll-and-dismiss"
(`docs/tui-parity/areas/31-27-mcp-hooks.md` §8, row "notifications/elicitation/complete", and the same
point as item 14 of that file's "Where the GUI can exceed the TUI"). The two hooks run identically
headless and an SDK host can register for both via `initialize.hooks` (same file, rows 5–6).

**afleet today.** `built` for the three settlements, `undesigned` for the completion push.
`DecisionAnswerMapping.swift` maps `acceptElicitation(content:)`, `declineElicitation` and
`cancelElicitation` onto `InboundAnswer.elicitation(.accept/.decline/.cancel)`, each guarded on the
payload actually being an elicitation, and `ElicitationCardView` offers `Decline` and `Cancel` in both
modes and whatever the schema — C6.3 D8's rule that an unanswerable request is the one failure mode
that must not exist. The completion frame is **decoded and dropped**:
`ClaudeWire/Sources/WireFrames/SystemFrames.swift:273-280` defines `ElicitationCompleteFields`
(`mcp_server_name`, `elicitation_id`, `uuid`, `session_id`) and registers it in the subtype table, and
nothing anywhere under `App/` consumes `elicitationComplete`. Neither hook is registered: afleet's
`initialize` declares `Notification` and `ConfigChange` only
(`ClaudeWire/Sources/WireTransport/InitializeConfiguration.swift`).

**GUI form.** Region: Decision card + Activity view. Three moves. (1) **Consume
`elicitation_complete`**: match `elicitation_id` against the open card and settle its waiting state
(D-38) without user action, showing the outcome `the server confirmed this`. This is the frame's whole
purpose and it costs one reducer case. (2) **Every settlement leaves a reading on the card** rather
than removing it — `accepted`, `declined`, `cancelled` — because an elicitation is the only decision
whose consequence (a tool call resuming) happens elsewhere in the timeline, and D-01's inert readings
already have the vocabulary. (3) Answer on window close: the harness pauses the tool idle watchdog
while an elicitation is open, so an unanswered card blocks a server-side call indefinitely; afleet
should send `cancel` when a channel is torn down with an elicitation pending, which is canon's own
default on every failure path. The two hooks stay `out-of-scope` here — an auto-answering hook is a
policy surface, not a decision surface, and belongs with Settings.

**Drops / keeps / gains.** Drops: the harness notification strings, the `Elicitation` /
`ElicitationResult` hooks, `lastElicitationClosedAt`. Keeps: the three settlements, `cancel` as the
default on every failure, `decline` on a blocked hook. Gains: `[exceeds]` a pushed completion closes
the card instead of the user waiting out a poll.

**Open.** None.

## F. The forwarded dialog kinds

These are the dialogs the headless dispatcher actually sends as `request_user_dialog`. tui-parity
finding 19 names three families, not two: `refusal_fallback_prompt`,
`fable_overage_consent_prompt` **and the Slack-connect kinds** (MCP elicitation goes out separately
as its own `elicitation` request — section E). afleet declares only the first two in
`initialize.supportedDialogKinds`, so the Slack-connect kinds are undeclared rather than
unavailable; they belong to lane G's fleet surfaces and are noted here only so the denominator is
honest. Everything else in the registry resolves to its declared default immediately, whatever the
host declares — which is what makes section G's cards afleet's own to raise.

### D-40 · `refusal_fallback_prompt`

**Terminal.** When the API returns `stop_reason: "refusal"` the harness can re-run the same turn on a
different model (SPEC 06 §20.3), and when it can, it asks first. The dialog's schema is
`{originalModel, fallbackModel, apiRefusalCategory?, guidanceText?, retractedMessageUuids?}` with
results `["retry_fallback", "edit_prompt", "cancelled"]` and default `cancelled`
(`cli.pretty.js:702406`). Its title is **`Session paused`** in `warning` colour (verified in
`cli.pretty.js:520579`). Its body is the composed fallback notice of §20.3 — for an ordinary category
`<Model>'s safeguards flagged this message. This sometimes happens with safe, normal conversations.`,
for `cyber`/`bio` instead `<Model>'s safeguards flagged this message. Our intentionally broad
safeguards allow us to deliver more capabilities faster, but can sometimes flag legitimate coding,
cybersecurity, and biology tasks.` — followed by `Send feedback with /feedback or learn more: <support
URL>` (or `You can learn more: <URL>`), and, when the category sanitises to a token,
a blank line and ``Details: `[<token>]` ``. An optional `guidanceText` renders dim beneath, truncated
to 512 code units. The two options carry the model names: `Switch to <FallbackName>` and
`Edit prompt and retry with <OriginalName>`, degrading to `Switch to the fallback model` and
`Edit prompt and retry` when a name does not resolve (verified in `cli.pretty.js:520551`). Escape
sends `cancelled`. Forwarded to a bridge consumer the dialog is presented as a pseudo tool:
`tool_name: "dialog:refusal_fallback_prompt"`, `display_tool_name: "Claude needs your input"`,
`action_description: "choose: retry on fallback model or edit prompt"`
(`cli.pretty.js:829921`; SPEC 36 §4738). If the host does not declare the kind, the flow degrades to
**the classic refusal error** and no dialog is parked (SPEC 45 `supportedDialogKinds` schema text).

**Job.** Turn a dead turn into a choice: the same work on another model, or your own prompt back to
edit — instead of an error the user can only stare at.

**Wire.** `P`. One of only three dialog families that cross the wire at all: the headless dispatcher
forwards `refusal_fallback_prompt`, `fable_overage_consent_prompt` and the Slack-connect kinds, and
MCP elicitation separately; everything else resolves to its declared default whatever the host
declares (`docs/tui-parity/README.md` finding 19, and
`docs/tui-parity/areas/24-21-permissions-plan-questions.md` top gap 2).

**afleet today.** `built` — `App/Decisions/DialogCardView.swift`, root §8.4's dialog table, C6.3
§"The two dialog cards" and engine anchor 2. It **keeps** all three results plus close-as-cancelled,
`guidanceText` verbatim, the nullable-not-merely-absent reading of `apiRefusalCategory`, the
five-minute deadline stated on the card (`This dialog expires in 5 minutes.`), and — the part with no
canon equivalent — a `RetractionRegistry` that evicts `retractedMessageUuids` from the timeline **on
resolution and only on resolution**, with the card saying `<n> streamed messages will be taken back
once this is settled.` It **loses**: canon's title (`The model declined this prompt.` against
`Session paused`); the entire composed notice — the safeguards sentence, the reassurance clause, and
the support link are all absent, replaced by `<original> declined; <fallback> can take it instead.`
and `Category: <cat>`; and the model names in the option labels (`Retry on the fallback model` /
`Edit the prompt` are static). It also **adds** a fourth button: `Keep the refusal` and `Close` both
send `cancelled`, so one result has two controls.

**GUI form.** Region: Decision card, Timeline, with a row in Activity. Adopt canon's copy, because
this dialog's whole job is explaining an event the user did not cause: title `Session paused` with
warning styling, and the composed notice as the body, including the support link as a real hyperlink
and the `Details: [<category>]` line — afleet has `apiRefusalCategory` and can compose the sentence
from §20.3's rule exactly. Put the model names back in the labels: `Switch to <fallbackModel>` and
`Edit prompt and retry with <originalModel>`, which is what tells the user what they are agreeing to.
Collapse `Keep the refusal` and `Close` into one `Keep the refusal` action, with closing the card as
its equivalent gesture — two controls for one wire result is a state the user has to reason about for
nothing. Keep the retraction sentence and the deadline sentence; both are `[exceeds]` — canon shows
neither. On `edit_prompt`, prefill the composer with the last user text, as root §8.4 already
specifies.

**Drops / keeps / gains.** Drops: the bridge pseudo-tool framing, the 512-code-unit guidance
truncation (the GUI can wrap), the duplicate cancel button. Keeps: `Session paused`, the notice, the
support link, the two named options, `cancelled` as default. Gains: the retraction count, the visible
deadline, a real link, and a card that survives in the timeline as a record of what happened.

**Open.** Should the retracted messages be visually struck through while the card is pending, rather
than only counted? Canon has no answer; the GUI can show what it is about to take back.

### D-41 · `fable_overage_consent_prompt`

**Terminal.** The forwarded dialog is
`{overagesEnabled, modelName?, balanceCents?, currency?}` with results
`["consent", "switch_default", "cancelled"]` and default `cancelled` (`cli.pretty.js:725659`). The
**local** dialog it stands in for is far larger (SPEC 06 §20.4): six rendered states —
`loading` (`Checking usage credits…`), `choose`, `buy` (an in-CLI purchase flow),
`reenabling` (`Turning on usage credits…`, failing with `Couldn't turn on usage credits. Run
/usage-credits to try again.`), `buy-external` (`Setting up usage credits…` / `Opening usage
credits…`) and `confirm-admin-request` (`This will send a request to your organization's admins to
<what>.` / `Only send this if you're running into usage limits — your admins are notified and review
each request.`, buttons `Send request` / `Cancel` focused on `Cancel`). The `choose` state's title is
one of `Switch to <FableName>?`, `You've reached your Fable limit`, or `<FableName> now uses usage
credits`; its body opens `<Fable> runs on usage credits` or `You've used your included Fable usage for
this week. Continuing on <Fable> uses usage credits`, then `, purchased separately from your plan.` or
` — you have <amount> in credits.`; and a dimmed second line reads `Usage credits are turned off.
Re-enable to use <Fable>.` or `You don't have usage credits yet.` plus
`Starts with a $20 monthly limit · run /usage-credits to adjust` and `By continuing, you agree to turn
on usage credits per our Help Center: <URL>`. Option 1 is `Switch to <FallbackModel> and continue` /
`Not now` / `No, keep my current model`; option 2 is one of six labels from `Continue with <Fable>` to
`Request usage credits from your admin`. **None of that copy is on the wire.** SPEC 06 §20.5 is what
runs when the dialog cannot be shown at all, and after a `consent` the engine may still emit
`system/model_consent_fallback` — because a bare reply never provisions billing.

**Job.** Stop the session before it spends money the user has not agreed to spend, and offer the
cheaper path — a different model — in the same breath.

**Wire.** `P` for the forwarded shape, `D` for everything else: the second of the three families the
headless dispatcher forwards (`docs/tui-parity/README.md` finding 19). The payload is four fields; the
balance and currency are declared but **unfed by the engine's only construction site**, which sends
`{overagesEnabled, modelName}` (C6.3 engine anchor 3 and its consequences, `cli.pretty.js:770104`).

**afleet today.** `built` — `App/Decisions/DialogCardView.swift`, root §8.4's dialog table, C6.3
§"The two dialog cards" and residue **D7**. It **keeps** all three results plus close-as-cancelled,
the rule that `consent` is offered **only** when `overagesEnabled` is true (a bare wire reply never
enables billing — enforced twice, in the view and in `DecisionAnswerMapping`), the deadline sentence,
and two readings ruled deliberately: an absent or `null` `balanceCents` draws **no** balance line
rather than a zero, while a literal `0` **is** drawn, because a user with no credits being asked to
buy some is the case this card exists for. It **loses** almost all of canon's copy — but the loss is
the wire's, not afleet's: the six states, the title variants, the `$20 monthly limit` line, the Help
Center URL, the admin-request flow and the in-CLI purchase all live in the local dialog and never
cross. The one afleet-side loss is the **billing route**: root §8.4 wants `Set up usage credits…` to
open the Anthropic billing page in the Browser tab, the payload carries no URL, and D7 rules that
afleet will not invent one — so the action currently only shows the note `Usage credits are set up
outside this session; the engine sent no address to open.` and leaves the card pending. That is an
action that does nothing.

**GUI form.** Region: Decision card, Timeline, plus a row in Activity — this is a money decision and
belongs in the cross-channel view. Keep every rule above. Two changes. (1) `Set up usage credits…`
must **do something**: route it to a Terminal tab running `/usage-credits` in this session, which is
the affordance canon's own copy points at (`run /usage-credits to adjust`) and which afleet can reach
without asserting a first-party URL — the same escape-hatch shape D-08 uses for an unrenderable
dialog. Keep it non-resolving, as §8.4 requires. (2) Say what `Switch to the default model` costs:
the card should read `The session switches models until credits exist` and, after the answer, render
the `system/model_consent_fallback` frame's `content` as the card's outcome and follow
`fallback_model` in the header badge — root §8.4 specifies both, and the C6.3 ruling that the frame's
*absence* is equally correct (nothing is emitted when provisioning succeeded) must hold, so nothing
waits on it.

**Drops / keeps / gains.** Drops: the six local states, the purchase and admin-request flows, the
title and option-label variants, the Help Center line — all unreachable. Keeps: the three results, the
`consent` gate, the no-defaulting balance rule, the deadline, `cancelled` as default. Gains: an
Activity row for a billing decision, and an outcome line that names the model the session actually
landed on.

**Open.** Owner call: is `/usage-credits` in a Terminal tab an acceptable destination for the billing
route, or does afleet want a first-party URL from a source it trusts before it offers the action at
all?

---

## G. Trust and consent gates

Sixteen dialogs that are not tool permissions and still ask the user to decide. Every one of them
is an entry in the dialog-kind registry `fk` — 41 runtime entries, default layout `inline`
(SPEC 41.22.6, `chunk-qs63rzfp.js:520301`) — and every one of them is on tui-parity finding 19's
never-forwarded list (`docs/tui-parity/README.md`, finding 19, lines 182–190). The wire carries
`request_user_dialog` for three families only; each kind below resolves to its declared default the
instant the engine raises it, whatever afleet declares in `supportedDialogKinds`. So for this
sub-family the wire question is settled before it is asked, and the real question is the one each
card answers: **what does afleet show, and from what file or signal does it know to show it.**

### D-42 · Workspace trust

**Terminal.** SPEC 03 §15. Rendered from the startup setup screens when `!Bo() || Nae()` — not
effectively trusted, or the *backstop* case where trust is inherited from an ancestor but this
folder declares its own grants (§15.7). Panel title `Accessing workspace:`
(verified in `cli.pretty.js:584071`), then the home-shortened cwd in bold, then two paragraphs
(verified in `cli.pretty.js:584074`):

```text
Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.
```
```text
Claude Code'll be able to read, edit, and execute files here.
```

When the folder declares grants, a disclosure block follows with up to three conditional bullets —
`This folder pre-approves {N} tool permission[s] in {sources}:` (capped at 8 rules),
`This folder adds {N} director{y|ies} to the workspace in {sources}:` (capped at 6), and
`This folder runs commands to mint HTTP headers (headersHelper), declared in {sources}` — closing
dim with `These will apply without asking. Only proceed if you trust this configuration.` A
`Security guide` link points at `https://code.claude.com/docs/en/security`. Options render
**cancel first and cancel focused**: `Yes, I trust this folder` against
`No, continue without these permissions` in the backstop case, otherwise `No, exit`
(verified in `cli.pretty.js:584090`). Accept writes
`projects[<canonical repo root>].hasTrustDialogAccepted = true`; acceptance at `$HOME` is never
persisted, so a home-directory session re-prompts forever. Decline exits 1 and prints nothing; Esc
on an untrusted workspace exits 0. The trust key is the canonical git root, so every worktree of a
repository shares one grant (§15.1). §15.5 is the table of what an untrusted workspace loses: project
and local `permissions.allow` and `additionalDirectories`, hook capture *and* hook execution,
`statusLine`, `subagentStatusLine`, `fileSuggestion`, every credential helper, `settings.env` in
full mode, `.mcp.json` auto-approval, project plugins and `extraKnownMarketplaces`.

**Job.** Refuse to let a checkout's own configuration execute code on this machine until a human
has said, once, that this checkout is theirs.

**Wire.** `X` plus `D`. `docs/tui-parity/README.md` line 523: trust is silently degraded in `-p` —
the persisted flag stays false and the whole §15.5 list is dropped — and line 636 states it as the
security-relevant loss of the A-06/08/02 area, "afleet must own its trust decision". Finding 19
confirms no dialog kind carries it.

**afleet today.** `built` — `App/Consent/TrustBanner.swift` and `App/Consent/PrecommitModel.swift`
over root spec §6.11. `PrecommitModel.untrustedSentence` is
`"This project has not been trusted in Claude Code."`, the channel opens history-only, and the one
action is *Review trust in terminal*, which runs `claude` interactively in a Terminal pane and
re-reads the flag when the pane exits. afleet never writes trust. **What it keeps:** the gate itself
and the refusal to spawn — the strongest part of the terminal's behaviour. **What it loses:** the
whole disclosure block. The terminal tells a user exactly which rules, which directories and which
`headersHelper` commands the folder will switch on; afleet's banner names none of them, so the
decision it hands to the terminal is made with less information than the terminal itself would show.

**GUI form.** Region: **Channel banner**, with a review sheet behind it. This card establishes the
layout every gate in this sub-family reuses — a one-line strip that states the refusal, a secondary
line that states the consequence, and one action that opens either a sheet (when afleet can show the
evidence) or a Terminal pane (when only Claude Code can act):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🔒 This project has not been trusted in Claude Code.   [ What it grants ▾ ]  │
│    This channel is history-only until you trust it.  [ Review in terminal ]  │
├──────────────────────────────────────────────────────────────────────────────┤
│  What this folder would switch on                                            │
│  • 6 tool permissions in .claude/settings.json  Bash(npm:*), Bash(git:*), …  │
│  • 1 directory added to the workspace  ../shared-lib                         │
│  • 1 command that mints HTTP headers (headersHelper) in .mcp.json            │
│  These will apply without asking. Only proceed if you trust this config.     │
│                                                    Security guide ↗          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Everything in the disclosure is readable from files afleet already resolves: `.claude/settings.json`
and `.claude/settings.local.json` for `permissions.allow` and `permissions.additionalDirectories`,
`.mcp.json` for `headersHelper`. Keep the closing dim sentence and the `Security guide` link
verbatim. `[exceeds]` The GUI can list all the rules rather than the terminal's first eight, and can
link each path into the Files panel. Keep afleet's never-write rule: the disclosure is read-only and
*Review in terminal* stays the only way to grant.

**Drops / keeps / gains.** Drops: the modal startup placement, the exit codes, the backstop variant's
third button (`No, continue without these permissions` — afleet has no in-session grant to drop).
Keeps: the refusal to run, the disclosure's three bullets and its closing sentence, the security
link. Gains: an expandable evidence list, uncapped, with file links.

**Open.** The backstop case — a folder trusted through an ancestor that declares its own grants —
produces a *different* question ("continue without these permissions") that afleet's binary
trusted/untrusted banner cannot express. Does the owner want that third state, or is deferring it to
the terminal acceptable?

### D-43 · The bypass-permissions disclaimer

**Terminal.** SPEC 24 §24.17.3. `BypassPermissionsModeDialog`, shown once per machine unless any of
user, local, flag or policy settings carries `skipDangerousModePermissionPrompt`. Frame colour
`error`; title `WARNING: Claude Code running in Bypass Permissions mode`; three body paragraphs and
a documentation link, verbatim:

```text
In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially dangerous commands.

This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.
```
```text
By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.
```
```text
https://code.claude.com/docs/en/security
```

Buttons `Yes, I accept` / `No, exit`, rendered **cancel first, cancel focused, indexes hidden**
(verified in `cli.pretty.js:272185`). Accept writes `{skipDangerousModePermissionPrompt: true}` to
**user settings** and continues; decline exits 1; Esc exits 0. §24.17.1: `--dangerously-skip-permissions`
sets the startup mode, `--allow-dangerously-skip-permissions` only sets availability. §24.17.2: either
flag under root exits 1; `permissions.disableBypassPermissionsMode === "disable"` prints
`Bypass permissions mode was disabled by settings` and clears *both* doors; `--bg` into bypass refuses
with `--bg with bypassPermissions requires accepting the disclaimer first. Run \`claude --dangerously-skip-permissions\` once interactively.`
§24.17.4 is the quiet one: a subagent definition's `permissionMode: bypassPermissions` is installed
into the child context **unchanged** unless the bypass policy is disabled or the session is
`--restricted` — the warning text names a "contained no-internet environment" requirement that is
compiled to the constant `!1` and never checked.

**Clone evidence.** `CC-to-SDK/docs/parity/tui-ux.md` §4 row *Bypass-permissions consent gate
(`SAm`)* (✅, Wave T t15) transcribed the frame, the three paragraphs, the cancel-first focus and both
exit codes against the binary, and recorded two deltas: the acceptance persists to the clone's own
prefs rather than `~/.claude/settings.json`, and `ccx -p` into bypass stays ungated because upstream's
gate is interactive-only.

**Job.** Make the one mode that stops asking cost one deliberate acknowledgement, and put the
responsibility sentence in front of the person taking it.

**Wire.** `X`. Not a forwarded dialog kind; the CLI's own gate never runs for an afleet child,
because the gate lives in the interactive startup path (`docs/tui-parity/README.md` finding 19; the
clone recorded the same interactive-only placement).

**afleet today.** `designed` — root spec §8.6. `bypassPermissions` appears in the mode picker only
when `disableBypassPermissionsMode` is not the string `"disable"` read from `get_settings.effective`
(the engine compares a string, not a boolean; corrected 2026-09-08). First selection shows "the same
disclaimer the CLI shows"; on acceptance afleet stores the acceptance in its own store, performs a
quiescent restart of the channel with `--allow-dangerously-skip-permissions` (§7.4) and then sends
`set_permission_mode`. No code implements it: `App/Consent/` has only the trust banner and the
project-server sheet.

**GUI form.** Region: **Consent sheet** (§2), which the root spec already names as the destination
for the bypass disclaimer. Keep the title, all three paragraphs and the link verbatim; keep the
destructive framing (title in the error accent); keep cancel-first and cancel-as-default-button, which
is the terminal's `cancelFirst, focus: "cancel"` translated. Translate the exit codes rather than
copying them: decline leaves the mode unavailable and restarts nothing (§8.6 already says this), and
closing the sheet is a decline, because there is no third answer here — unlike D-44's sheet, nothing
is left outstanding when the user walks away from a mode they did not ask for. Keep the acceptance in
afleet's own store, following the clone's precedent and afleet's never-write-under-configHome rule
(§17.8, X9). `[exceeds]` The GUI should show which channel the acceptance applies to and offer to
revoke it; the terminal's flag is once-per-machine and has no off switch short of editing settings.

**Drops / keeps / gains.** Drops: exit codes, the root refusal, the `--bg` refusal string (afleet
never launches `--bg` into bypass). Keeps: title, three paragraphs, link, cancel-first, once-per-user
persistence. Gains: a revocable, per-app acceptance and a named scope.

**Open.** §24.17.4 means a subagent definition can carry the session into bypass without any dialog,
in a session the user never put into bypass. afleet renders subagent permission cards with the
agent's type (§8.4); should a subagent running under a definition-declared `bypassPermissions` get a
standing banner? It is the only bypass entry with no consent moment anywhere.

### D-44 · `.mcp.json` project MCP server approval

**Terminal.** SPEC 31 §6.1. Both dialogs open with the same explanation, assembled from a text node,
a link whose child is `MCP documentation` and a trailing period:

```text
MCP servers may execute code or access system resources. All tool calls require approval. Learn more in the MCP documentation.
```

Single server: title `New MCP server found in this project: <displayName>`, colour `warning`, focus
defaulting to the **last** option, three rows (verified in `cli.pretty.js:290079`):

```text
Use this MCP server
Use this and all future MCP servers in this project
Continue without using this MCP server
```

`yes` appends the name to `localSettings.enabledMcpjsonServers` and to the session-approved set;
`yes_all` also sets `localSettings.enableAllProjectMcpServers = true`; `no` appends to
`disabledMcpjsonServers`; cancelling counts as `no`. Multiple servers: title
`<N> new MCP servers found in this project`, subtitle `Select any you wish to enable.`, a
multi-select **pre-checked with every server**, submit row `Enable selected`, footer hints
`space select` / `Esc reject all`; unselected names are written as rejections and cancelling rejects
all. Plugin-scoped servers display as `<server> (from plugin <plugin>)`. The whole state machine is
resettable with `claude mcp reset-project-choices`, which clears the three keys from both
`~/.claude.json` and `settings.local.json` (§7.8). Trust is upstream of it: while the workspace is
untrusted, `.mcp.json` auto-approval is disabled and a declared server sits at `pending`
(SPEC 03 §15.5).

**Job.** Stop a checked-in file from starting an arbitrary local process under the user's identity
before anyone has read what that process is.

**Wire.** `X`. `docs/tui-parity/README.md` A-31 row: "The `.mcp.json` approval dialog never happens
headless: project servers are silently approved (X, security moment lost; build a consent step from
the file)", and finding 19 confirms no dialog kind reaches the host. Consent must therefore be taken
**before the child exists**, since a post-handshake `mcp_toggle` arrives after the server has run.

**afleet today.** `built` — `App/Consent/ConsentSheet.swift`, `ConsentBanner`, `PrecommitModel` and
`ChannelDecorations.swift`, over root spec §6.12. afleet computes each declared server's state the way
the CLI does (rejected / approved / pending), raises a sheet listing every pending server with its
transport summary — the command a stdio server would run, the URL an http or sse server would reach —
and offers *Accept* (remembered in afleet's own store per project and per entry hash), *Decline*
(written into `disabledMcpjsonServers` of the local-settings store, the one Claude Code-owned file
afleet writes) and *Not now* (writes nothing, leaves the banner). **Keeps:** the pre-spawn placement,
the per-server disclosure, the exact file and key the terminal writes, and fail-closed refusal.
**Divergence, and a good one:** the terminal treats a cancelled dialog as `no`; afleet's *Not now*
records nothing, because a window dismissal is not a refusal (`ConsentSheet.swift` header, tracker
170). **Loses:** the shared "MCP servers may execute code…" explanation and its documentation link;
the `yes_all` row (`enableAllProjectMcpServers`); **per-server granularity** — the terminal's
multi-select lets a user enable two of three servers, afleet's Accept/Decline is all-or-nothing; the
`<server> (from plugin <plugin>)` display form; and any route to
`claude mcp reset-project-choices`, so a decline is permanent from inside afleet.

**GUI form.** Region: **Consent sheet**, as built, with three additions. (1) Restore the explanation
sentence and the `MCP documentation` link above the rows — it is the only place the user is told that
approving a server is not approving its tool calls. (2) Make each row a checkbox, pre-checked, exactly
as the terminal's multi-select is; *Accept* then means "accept the checked ones" and writes the
unchecked ones as declines, which is precisely the terminal's submit semantics and costs afleet one
control per row. (3) Add a *Reset project choices* action to the channel's MCP menu (§2, channel
header) that clears the three keys the same way §7.8 does, so a decline is reversible without a
terminal. Keep *Not now* as afleet's third answer and keep the banner it leaves behind.

**Drops / keeps / gains.** Drops: `yes_all` as a one-click row (a checkbox list makes it redundant),
the `space select` / `Esc reject all` hints. Keeps: pre-spawn timing, the transport disclosure, the
write target and policy, per-server granularity once checkboxes land. Gains: `[exceeds]` a
non-destructive dismissal, a reversible decline, and each server's command shown selectable rather
than truncated.

**Open.** Should an edited `.mcp.json` entry re-ask silently (the current hash rule) or announce that
it is re-asking? The terminal has no equivalent — its approval is by name and never re-checked.

### D-45 · Managed settings security

**Terminal.** SPEC 03 §15.8 and SPEC 48 §2.9.2–2.9.3. A **separate** consent system from workspace
trust that shares no state with it; it exists because a managed settings payload can contain keys
that execute code. `jU(settings)` extracts a `DangerousSettingsSummary` over three key lists — eleven
shell settings (`apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `fileSuggestion`,
`gcpAuthRefresh`, `otelHeadersHelper`, `processWrapper`, `policyHelpers`, `proxyAuthHelper`,
`statusLine`, `subagentStatusLine`), three path settings, eleven sandbox settings — plus unsafe `env`
entries and hooks. `claudeMd` is deliberately **excluded**: a managed CLAUDE.md raises no dialog and
editing one does not invalidate an approval. Title `Managed settings require approval`; body:

```text
Your organization has configured managed settings that could allow execution of arbitrary code or interception of your prompts and responses.
Settings requiring approval:
Only accept if you trust your organization's IT administration and expect these settings to be configured.
```

with a telemetry-only variant. Buttons `Yes, I trust these settings` / `No, exit Claude Code`.
The dialog kind is `managed_settings_security`, result `approved | rejected | deferred_no_consent_surface`,
**default `deferred_no_consent_surface`**; when revealed during a login handoff (`reveal: "login_handoff"`)
it is hardened — cancel pre-focused, number-key selection disabled, and a 250 ms input-refusal window.
Consent lives at `<config>/remote-settings-consent.json`, version 1, mode `0o600`, at most 20 records,
24-hour write throttle, holding only a bare-hex SHA-256 of the canonical extraction. **The consequential
branch:** in `-p`/non-TTY mode the outcome is `deferred_non_interactive` and the payload **is applied
with no prompt** (SPEC 48 §2.9.3).

**Job.** Stop an organisation's remotely-delivered settings from running commands on this machine
until the machine's owner has approved that exact payload.

**Wire.** `X`, security-relevant. `docs/tui-parity/README.md` A-46/19/48/37: "The managed-settings
approval gate is waived headless: a dangerous remote payload is applied with no prompt
(`deferred_non_interactive`) (X, security-relevant; read `remote-settings.json` and
`remote-settings-consent.json` yourself and refuse to launch)." Finding 19 lists
`managed_settings_security` among the never-forwarded kinds. This is the sharpest gap in the lane:
afleet's child applies the payload, and neither afleet nor the user is told.

**afleet today.** `built`, **and wrong**. Root spec §6.12, second bullet has the design right:
afleet reads `remote-settings.json` and `remote-settings-consent.json` under `<configHome>` and
refuses to spawn while a payload is pending approval, with a banner telling the user to open
`claude` in a terminal once. Both halves are on `main`:
`FleetKit/Sources/FleetSessions/Preconditions/ManagedSettingsReader.swift:12-22` is the reader,
`SpawnPreconditions.swift` refuses the spawn on `isPending`, and `ChannelState.swift:111` carries
`managedSettingsPending` as a `ChannelBanner` case. The bug is the hash. The reader SHA-256s the
**raw bytes** of `remote-settings.json` and looks for a top-level `approvedHash`, where canon hashes
a canonical string of four *extracted* fields stored at `records[<orgUuid>].dangerousSettingsHash`;
it also skips canon's `j5()` harmless-payload predicate. Any managed deployment therefore reads
pending forever and the channel never spawns, even after approval (`spec-defects.md`, lane D,
*afleet specs and code*). What is genuinely absent is the review sheet: `PrecommitModel` renders
exactly two verdicts, `consentNeeded` and `untrusted`.

**GUI form.** Region: **Channel banner** plus a review sheet, in D-42's shape. **What afleet shows:**
"Your organization has sent managed settings that have not been approved on this machine.", secondary
line "This channel starts nothing until they are approved.", and *Review in terminal*. The review
sheet lists what the terminal lists — each dangerous key and its command string, each unsafe `env`
entry, each sandbox key, and whether hooks are present — under the terminal's own framing sentence,
so the user reads the same disclosure before they walk to the terminal. **When afleet knows to show
it:** entirely from two files it already has a reader for. `<configHome>/remote-settings.json` is the
payload cache and `<configHome>/remote-settings-consent.json` is `{version, records: {<orgUuid>:
{accountUuid, dangerousSettingsHash, updatedAt}}}`. afleet extracts the four fields the CLI hashes
(shell settings, unsafe `env`, sandbox settings, hooks — never `claudeMd`), builds the canonical
string, takes its SHA-256, and compares against the record for the org uuid; the legacy form that
appended `claudeMd` is accepted as a match, as the CLI accepts it. No hash record, or a different
hash, means pending — refuse to spawn. afleet must not write the consent file: it lives under
`<configHome>` and §17.8's standing exclusion (X9) forbids any write there. So the only action is the
terminal handoff, re-read on pane exit exactly as `PrecommitModel.reviewTrustInTerminal()` already
does for trust.

**Drops / keeps / gains.** Drops: the exit-1 rejection, the login-handoff hardening, the telemetry
variant. Keeps: the disclosure content, the refusal to run, the hash comparison rule including its
legacy form. Gains: `[exceeds]` the terminal shows this once at startup and then never again;
afleet's banner is persistent and per-channel, so a payload that changes mid-life is visible rather
than applied silently.

**Open.** afleet cannot approve, only refuse. That is correct under X9 but it means an enterprise user
must visit a terminal for every payload change. Is a one-time "open Claude Code in a terminal now"
onboarding step better than a per-channel banner?

### D-46 · External CLAUDE.md includes

**Terminal.** SPEC 10 §10.3.4. `includeExternal` is
`analysisOnly || li().hasClaudeMdExternalIncludesApproved || false`; when false, any `@`-import whose
target resolves outside the cwd is **dropped**. The dialog is titled
`Allow external CLAUDE.md file imports?` and carries:

```text
This project's CLAUDE.md imports files outside the current working directory. Never allow this for third-party repositories.
```

with the list header `External imports:`, the overflow pair `… +N imports not shown.` /
`Yes covers those too, plus any this project adds later.`, the footer
`Important: Only use Claude Code with files you trust. Accessing untrusted files may pose security risks`
and the buttons `Yes, allow external imports` / `No, disable external imports`, cancel focused first.
Either answer writes `hasClaudeMdExternalIncludesApproved` and `hasClaudeMdExternalIncludesWarningShown`
into the per-project record of `~/.claude.json`. It is offered only when at least one out-of-cwd
import exists and neither flag is set. User-scope roots bypass the gate by a hard-coded `true`, except
under the `local-agent` entrypoint. A `/config` row named `External CLAUDE.md includes` toggles the
same flag.

**Job.** Stop a checked-out repository from pulling instructions into the model's context from
somewhere the user is not looking.

**Wire.** `X`. Finding 19; also `docs/tui-parity/README.md` §6 item 10, which names external CLAUDE.md
imports as one of the five skipped trust and consent moments. Note the failure mode inverts the others:
headless does not *approve* the imports, it silently **drops** them, so the harm is a session running
with instructions the user believes are loaded.

**afleet today.** `undesigned`. The root spec's §6.12 covers two consent moments and this is not one of
them; nothing in `App/Consent/` or the child specs mentions it.

**GUI form.** Region: **Channel banner**, D-42's shape, but the copy states a degradation rather than a
refusal — this gate blocks nothing dangerous, so it must not block a spawn. **What afleet shows:**
"3 files this project's CLAUDE.md imports from outside the project are not being loaded.", secondary
"Claude Code drops external imports until you approve them for this project.", action
*Review in terminal*, plus an expander listing the resolved paths under the terminal's own footer
sentence. **When afleet knows to show it:** it needs no new reader. §6.11 already reads
`projects[<canonical root>]` from `ConfigHome.globalConfig` read-only for `hasTrustDialogAccepted`;
`hasClaudeMdExternalIncludesApproved` and `hasClaudeMdExternalIncludesWarningShown` are siblings in
the same record (SPEC 03 §15.1's defaults object lists all three together). afleet parses the project's
`CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` for `@`-imports, resolves each against the
channel's cwd, and raises the banner when at least one resolves outside and the approved flag is
false. One extra key read on a read afleet already performs.

**Drops / keeps / gains.** Drops: the approve action (afleet never writes `~/.claude.json`), the
overflow copy. Keeps: the list of external imports, the footer's trust sentence, the "never for
third-party repositories" warning. Gains: `[exceeds]` the terminal shows this once and then the
degraded state is invisible; afleet's banner makes a silently-reduced instruction set permanently
visible, and can link each dropped path into the Files panel.

**Open.** Is a persistent banner right for a degradation with no security consequence, or should this
be a one-line notice row in the timeline at session start?

### D-47 · Plugin consent and the plugin hint

**Terminal.** SPEC 30 §22 is explicit that **there is no "do you trust this marketplace?" dialog** —
adding a marketplace is unconfirmed in both the TUI and the CLI. The surfaces that exist: the trust
disclaimer, rendered unconditionally and non-blocking on every plugin details pane
(`Make sure you trust a plugin before installing, updating, or using it. Anthropic does not control
what MCP servers, files, or other software are included in plugins…`, with managed
`pluginTrustMessage` appended); the non-blocking `Will install:` capability summary; the blocking
install-scope menu, defaulting to `Install for you (user scope)`; and two blocking CLI `[y/N]`
prompts, both defaulting to **N**, for a `command`-source install and for a `headersHelper`. Enabling
a plugin that declares hooks, MCP servers or monitors is not separately confirmed. Separately,
`plugin_hint` (SPEC 30 §28.5, registry entry `cli.pretty.js:520301`) is the in-turn recommendation
raised from a stripped tool-output marker: title `Plugin recommendation`, body
`The <sourceCommand> command suggests installing a plugin.` plus `Plugin:`, `Marketplace:` and an
optional `Description:` row, question `Would you like to install it?`, options `Yes, install` /
`No` / `No, and don't show plugin installation hints again`. Any answer appends the id to
`claudeCodeHints.plugin`; `disable` sets `claudeCodeHints.disabled = true`; a cancelled dialog records
nothing.

**Job.** Put the "Anthropic does not vet this" sentence in front of an install, and make the two
code-executing install paths opt-in rather than opt-out.

**Wire.** `X`. `docs/tui-parity/README.md` A-30/29/32: "No plugin trust or consent dialog is reachable
(X, see finding 19)"; the same area records `/plugin` as `X` for the panel and `R` for the capability,
rebuildable from registry files plus the `claude plugin` CLI. `plugin_hint` is on finding 19's
never-forwarded list, so it resolves to its default and the user never sees a recommendation.

**afleet today.** `undesigned`. Plugin installation is not in the root spec §3 v1 or v1.1 lists and no
child spec touches it; `reload_plugins` is the only plugin-adjacent control request the design uses.

**GUI form.** Region: none in v1 — and say so rather than inventing one. The card's content is a
constraint on any future plugin surface: if afleet ever installs a plugin, it does so by shelling out
to `claude plugin`, and both `[y/N]` prompts default to N and must be rendered as real blocking
questions, not auto-answered. The trust disclaimer is display-only and belongs verbatim on whatever
details view a plugin browser grows, with `pluginTrustMessage` appended when managed settings supply
it. `plugin_hint`'s loss is not worth recovering: it is an upsell whose default is already "do
nothing", and its answer writes to `~/.claude.json`, which afleet may not write. Status for the hint
specifically: `superseded` — afleet's own plugin surface, if built, replaces the in-turn offer.

**Drops / keeps / gains.** Drops: the hint dialog entirely. Keeps: the trust disclaimer text and the
N-default on both install prompts, as a rule for a future surface. Gains: none in v1.

**Open.** None for v1.

### D-48 · The API-key trust dialog

**Terminal.** SPEC 08 §10.4. Key identity is the **last 20 characters** of the trimmed key; state is
`approved` / `rejected` / `new` from `customApiKeyResponses` in `~/.claude.json`. The dialog appears
only when `ANTHROPIC_API_KEY` is set, the provider is first-party and the state is `new`. Title
`Detected a custom API key in your environment`, then `ANTHROPIC_API_KEY: sk-ant-...<tail>`, then the
question `Do you want to use this API key?` with options `Yes` and `No (recommended)`; `focus: "cancel"`
selects the recommended decline. Yes appends the tail to `customApiKeyResponses.approved`; No and Esc
append it to `rejected`. `/config` exposes the same toggle as `Use custom API key: <suffix>` and moves
the tail between the two arrays. SPEC 08 line 270 records the headless bypass of this prompt
explicitly.

**Job.** Stop an environment variable — inherited from a shell profile, a direnv file or a parent
process — from silently redirecting the session's billing and its organisation policy.

**Wire.** `X`. Not a registry dialog kind and not on any control request; the prompt is bypassed
non-interactively (SPEC 08 §10.2/10.4). Finding 19 does not list it because it never was a
`request_user_dialog` at all.

**afleet today.** `undesigned`. No mention in the root spec or child specs.

**GUI form.** Region: **Channel banner**, one line, dismissible. **What afleet shows:** "This channel
uses a custom API key from your environment (`sk-ant-…<tail>`)." with actions *Use it* and *Ignore it*
— where *Ignore it* means the channel respawns without `ANTHROPIC_API_KEY` in the child environment,
which is the only mechanism afleet has, since it may not write `~/.claude.json`. **When afleet knows to
show it:** root spec §3 already gives afleet login-shell environment resolution, so it holds the exact
environment it is about to hand the child. It computes the 20-character tail the same way and reads
`customApiKeyResponses.approved`/`.rejected` from the global config it already opens read-only for
trust (§6.11). New tail, first-party provider → banner. Keep the terminal's recommendation direction:
the safe answer is the default, and *Ignore it* is the emphasised action.

**Drops / keeps / gains.** Drops: persistence of the answer (afleet cannot write the arrays), the
`/config` toggle. Keeps: the tail-only display, the recommended-decline default. Gains: `[exceeds]`
afleet can act on the answer by changing the child's environment, which the terminal cannot do without
a restart the user has to perform.

**Open.** Should an ignored key be remembered per channel in afleet's own store, the way the bypass
acceptance is (§8.6)? Otherwise the banner returns on every spawn.

### D-49 · Chrome install and computer-use approval

**Terminal.** Three kinds. `chrome_install_upsell` (`cli.pretty.js:276849`, verified) is the in-turn
offer raised from the Chrome skill behind a nine-term gate; results
`install | not_now | dont_ask_again | cancelled`, options `Install extension` /
`Opens the install page in Chrome`, `Not now` / `Continue without browser tools`, `Don't ask again` /
`Revisit anytime with /chrome` (SPEC 46 §46.15.3). Choosing install opens `https://claude.ai/chrome`
and starts `chrome_install_setup`, a driver dialog whose payload is `{phase, installPageOpened}` over
five phases and whose results are `continue | keep_waiting | skip | cancelled`, with a 2 s poll, a
30 s slowdown, a 15 s reconnect nudge and a 45 s stall threshold. `computer_use_approval`
(`cli.pretty.js:33155`, verified) is the kind behind the computer-use consent surfaces: `request_access`
raises "a single dialog listing all requested apps and either allows the whole set or denies it", with
separate checkboxes for clipboard read, clipboard write and system key combos, and a `reason` the model
must supply as a "One-sentence explanation shown to the user in the approval dialog. Explain the task,
not the mechanism." Screen takeover is a **separate** consent — its own card, raised automatically the
first time a display-scope tool runs, and `request_access` cannot obtain it (SPEC 46 §46.24.2). The
per-call browser dialog is a different surface again (SPEC 46 §46.17.3): title
`Claude in Chrome wants to <verb phrase> on <host>`, options `Allow`,
`Allow all actions on <host> for this session`, `Deny (esc)`.

**Job.** Bound what an agent may touch outside the terminal — which browser, which applications, and
whether it may take the screen — with a grant the user can see the extent of.

**Wire.** `X`. `docs/tui-parity/README.md` A-46/19/48/37: "Computer use cannot be enabled headless at
all; the only workaround is hosting `claude --computer-use-mcp` yourself through `--mcp-config` (X)",
and `--chrome` must be passed explicitly (R). Both `chrome_install_*` and `computer_use_approval` are
on finding 19's never-forwarded list.

**afleet today.** `undesigned`. afleet's Browser panel (C7.6, merged) is the *user's* browser in a
panel tab, not Claude in Chrome; nothing in the design hosts the computer-use MCP server or renders
an app-grant dialog.

**GUI form.** Region: none in v1. If afleet ever passes `--chrome` or hosts `--computer-use-mcp`, the
per-call browser dialog (§46.17.3) is a **permission card** and already fits the D-11–D-21 family —
its title, the dimmed URL under it and the session-scoped always-allow row are the only additions. The
`request_access` app grant is the one that needs a new surface: a sheet listing every requested app,
the model's `reason` sentence, and three checkboxes, allowed or denied as a whole set — and the screen
takeover kept as a second, separate card, because canon is explicit that approving apps is not
approving takeover. The install upsell is `superseded`: afleet has its own Browser panel, so the
in-turn "install our extension" offer has no place in it.

**Drops / keeps / gains.** Drops: the upsell and its setup driver entirely. Keeps, if the capability
is ever taken: whole-set app grants, the separate takeover consent, the `reason` sentence. Gains: none
in v1.

**Open.** None for v1; this is a scope question, not a design one.

### D-50 · `sandbox_network_access`

**Terminal.** SPEC 17 §14. The dialog kind is `sandbox_network_access`, payload
`{host, port?, forwardedFromWorker?, workerName?}`, result
`{allow, persistToSettings, persistRow?} | "cancelled"`, default `cancelled`. Three rows: `Yes`
(session grant only), `Yes, and don't ask again for <display>` (persists a validated `PermissionRow`
whose `applies` carries `{type:"addRules", rules:[{toolName:"WebFetch", ruleContent:"domain:<host>"}],
behavior:"allow", destination:"localSettings"}`), and
`No, and tell Claude what to do differently (esc)`. The persist row is **suppressed entirely** when
managed settings allow only managed sandbox domains, when the host is a misleading-consent host, or
when the host cannot be displayed in full. It is one of exactly three kinds allowed to appear while
another dialog is open (`nHo = new Set(["managed_settings_security", "sandbox_network_access",
"mcp_url_elicitation"])`), its pending state shows in the status line as `allow network: <host>` under
the `sandbox` slot — or `sandbox-queued` when another dialog is in front — and in-flight asks are
de-duplicated per host. In auto mode there is no dialog at all: SPEC 26 §26.22.1 routes the same
question through the auto-mode classifier as a synthetic `SandboxNetworkAccess` action with its own
severity site, and it **fails closed** on classifier unavailability.

**Job.** Keep a sandboxed command's network reach to hosts a human named, without making the human
re-name them every turn.

**Wire.** `P` — and this is the exception in the sub-family. `docs/tui-parity/README.md` A-17 row: "The
network-access prompt arrives as `can_use_tool` with the persist rule in `permission_suggestions` (P)."
The *dialog kind* never forwards (finding 19), but the ask itself reaches afleet as an ordinary
permission request carrying its own suggestion.

**afleet today.** `built`, by inheritance — `App/Decisions/PermissionCardView.swift` renders it as any
other permission card, and the persist row arrives as a `permission_suggestions` entry, so
*Always allow* is already correct. **Loses:** the host-specific question (afleet's generic title and
description line do not say "allow network access to `<host>`"), the status-line pending readback
(`allow network: <host>` / `sandbox-queued`), and the per-host de-duplication — two concurrent asks for
the same host become two cards.

**GUI form.** Region: **Decision card**, as built. Three deltas worth taking, all cheap: render the
host as the card's primary subject rather than burying it in the tool input (D-01's `title` slot);
collapse concurrent cards for the same host into one, which is the terminal's `q7.ask` de-duplication;
and surface the pending state where the terminal surfaces it — the channel header, next to the mode
readback, since the status line's `sandbox` slot has no other home. Keep the suppression rule for the
persist row verbatim: when `permission_suggestions` is empty, *Always allow* must be absent, not
disabled (D-03's rule, already honoured by `PermissionCardView`). `[exceeds]` The GUI can show the
domain rule text and the destination file on the persist row (D-21), which the terminal folds into a
label.

**Drops / keeps / gains.** Drops: `place: "under"` stacking, the `sandbox-queued` state name. Keeps:
the three options, the persist-row suppression conditions, cancel-as-default. Gains: host as a
first-class subject, header readback, de-duplication.

**Open.** In auto mode the classifier answers instead of the user (SPEC 26 §26.22.1) and fails closed.
afleet offers `auto` in its mode picker; should a classifier-denied host produce a visible row, or is
silence correct? The terminal logs it at `warn` and shows nothing.

### D-51 · `lsp_recommendation` and `ide_onboarding`

**Terminal.** Two kinds, both offers rather than gates. `lsp_recommendation` (SPEC 34, descriptor at
`chunk-qs63rzfp.js:520301`) carries `{pluginName, pluginDescription?, marketplaceName, fileExtension}`,
`hideWhile: ["panel", "draft"]`, default `cancelled`, and a **six-member** result union
(`yes | no | timeout | never | disable | cancelled`). Title `LSP plugin recommendation`; body
`LSP provides code intelligence like go-to-definition and error checking`, then `Plugin:`,
`Marketplace:`, a conditional `Description:` and `Triggered by: <extension> files`, then
`Would you like to install this LSP plugin?`; options `Yes, install` / `No, not now` /
`Never for this plugin` / `Disable all LSP recommendations`. It self-answers after **30,000 ms** —
`cancelled` under one predicate, `timeout` otherwise. `ide_onboarding` (SPEC 33 §33.10.3) carries
`{installationStatus}`, is placed under the transcript, and renders
`✻ Welcome to Claude Code for <IDE display name>` with an installed-version subtitle and four capability
lines (open files and selected lines, `Review Claude Code's changes +11 -22 in the comfort of your IDE`
— a fixed illustrative diff-stat, not a real count — `Cmd+Esc for Quick Launch`, and the
reference-files chord), closing `Press enter to continue`. It is shown once per distinct terminal
identity via `hasIdeOnboardingBeenShown[<terminal>]`.

**Job.** Tell a user that the harness noticed something about their environment and could do more with
their permission.

**Wire.** `X` for both, finding 19. `docs/tui-parity/README.md` A-33/34/43/44 adds the verdict:
"`lsp_recommendation` is a dialog kind the GUI can win outright; LSP has no status surface at all
(exceed)", and, for IDE, that registering as Claude Code's IDE would not deliver diff-in-editor for
afleet's own headless child.

**afleet today.** `out-of-scope` for both, and the exclusions are explicit. Root spec §3, "Out of
scope" line: "agent teams as channel members, cloud and Remote Control sessions, DMs, reactions as
actions, full-text search, staging and committing from Source Control, branch and worktree management
UI, a native code editor, **LSP**, other harnesses, notarized distribution" — repeated as a standing
exclusion in §17.8. For IDE, §3 withdraws IDE registration from v1.1 outright ("Registering as Claude
Code's IDE (*SPEC 33*) is no longer a v1.1 item"), leaving it "a later option only for feeding
diagnostics to the model".

**GUI form.** `superseded` in both cases, by surfaces afleet already has. The IDE onboarding dialog
exists to tell a user their editor is now wired to Claude Code; afleet **is** the editor surface — the
Files panel with Monaco (C7.5/C7.2) and the composer's `@path#L12-30` mentions are the capabilities
the dialog advertises, present rather than announced. The LSP recommendation exists because the
terminal cannot provide code intelligence itself; afleet's Monaco instance is the answer the terminal
was recommending a plugin for. Neither needs a card. What is worth carrying is the tui-parity note:
LSP diagnostics reach the model but never the host, and the terminal shows them to no one either — an
absolute gap and the strongest `[exceeds]` opportunity in the area, but it belongs to the Files panel's
lane, not to a dialog.

**Drops / keeps / gains.** Drops: both dialogs entirely. Keeps: nothing. Gains: `[exceeds]` the
capability each dialog was offering, present by construction.

**Open.** None.

### D-52 · `goal_proposal`

**Terminal.** SPEC 22. The `goal_propose` tool has a direct arm and a dialog arm. The dialog arm mints
a request id, latches it, and opens
`{kind:"goal_proposal", payload:{condition}, result:{approved, explicit?}, default:{approved:false}}`
(verified in `cli.pretty.js:161590`) with `{place: "under"}`, so it renders beneath ongoing work rather
than blocking it. The setting `modelProposedGoals` (`auto` / `alwaysAsk` / `disabled`, read from
trusted sources only — SPEC 03 §9.1) decides whether the dialog is forced. On resolution the answer is
re-checked against three staleness conditions — a newer proposal, the setting having become `disabled`,
and the session having entered plan mode — and telemetry records six decisions:
`approved`, `approved_stale`, `approved_disabled`, `approved_plan_mode`, `declined`, `unanswered`. An
approval enqueues `/goal <condition>`; a decline is not reported back, and the tool result tells the
model so verbatim: "If they decline you will not be notified — do not ask about the decision or
re-propose the same condition."

**Job.** Let the model ask, without interrupting, whether it should keep working toward a condition —
and let silence mean no.

**Wire.** `X`, twice over. Finding 19 lists `goal_proposal` among the never-forwarded kinds, so it
would resolve to `{approved: false}` immediately. But the tool refuses before that: SPEC 22 §refusal
table row 2 returns `Goal proposals are only available in interactive local sessions.` for a
non-interactive session, and row 9 returns `Goal proposals need an interactive session to render the
approval prompt; none is available here.` when there is no dialog channel. `docs/tui-parity/README.md`
A-22/47/40 adds that `active_goal` frames are `CLAUDE_CODE_REMOTE`-only, so goal state is not
observable either.

**afleet today.** `undesigned`. No root-spec or child-spec mention.

**GUI form.** Region: **Decision card**, if the wire ever carries it — and the translation is already
written. `place: "under"` is exactly D-04's rule: the proposal must not take focus from an older
unanswered card, and it must never take the composer. The result shape has one field the timeline
should honour: `explicit` distinguishes a decline from a non-answer, which is the terminal's own
`declined` versus `unanswered`, and an afleet card that expires unanswered should book the latter.
Until the wire carries it, afleet's honest position is that a model-proposed goal is unreachable, and
the timeline should not fabricate one. Status stands at `undesigned`; the value is low because the
mechanism refuses on session shape before dialog support is even consulted.

**Drops / keeps / gains.** Drops: everything, currently. Keeps: `place: "under"` as focus discipline
and the explicit/unanswered distinction, for whenever it lands. Gains: none.

**Open.** None afleet can act on.

### D-53 · `peer_inbound_approval` and `remote_callout`

**Terminal.** `peer_inbound_approval` (`cli.pretty.js:497037`, verified; SPEC 38 §38.22.5) is the
held-message dialog for cross-session peer messages. Title `Held message from another session`, then
`Another Claude session sent a message: from <address>` — with ` [verified pid <n>]` and
` (peer claims name: <name>)` appended when available — then
`Message body (this is what will be delivered):`, and two options:
`Deny — drop it and tell the sender it was declined` and `Deliver this message to Claude`. The
explanation names the cause: "The sending session's permission mode class doesn't match this session's,
so it wasn't delivered automatically." The preview is aggressively sanitised, with the suffix
`…[N lines, M chars total — expand to review before approving]`. The gate is the `crossSessionInbound`
setting (`default | accept | hold | refuse`), which fails closed to `hold` on any unrecognised
permission mode. After resolution the outcome is re-checked and three warning lines cover an approval
that landed too late. `remote_callout` (SPEC 36) is the one-time Remote Control enable card:
descriptor `{kind:"remote_callout", payload:{}, result: enable|dismiss|cancelled, default: "cancelled",
hideWhile:["panel","draft"]}`, requested with `{place: "under"}`, titled `Remote Control`, with two
options — `Enable Remote Control` / `Opens a secure connection to claude.ai.` and `Never mind` /
`You can always enable it later with /remote-control.` The `remoteDialogSeen` flag is written **only on
acceptance**, and an `enable` answered after the signed-in account changed is discarded.

**Job.** Two different asks: whether a message from another agent may enter this session's queue, and
whether this session may be reachable from outside the machine.

**Wire.** `X` for both, finding 19. For peer messages the gap is deeper than the dialog: the hold
buffer lives in the child's memory and nothing publishes it, so afleet cannot see that a message is
held at all. For Remote Control, `docs/tui-parity/README.md` A-50/36/39/38 records the opposite —
"A headless-hosted session can be Remote-Controlled from claude.ai mobile: the `remote_control` handler
is in the dispatcher and this machine reports `remote_control_available: true` headless (P, highest-leverage
capability in the area)" — so the *capability* is reachable while its consent card is not.

**afleet today.** `out-of-scope` for `remote_callout`: root spec §3, "Out of scope: agent teams as
channel members, **cloud and Remote Control sessions**, DMs, reactions as actions…", restated in
§17.8's standing exclusions. `undesigned` for `peer_inbound_approval`, with no reachable data behind
it.

**GUI form.** For peer messages: nothing to build, and the card records why. If afleet ever wants it,
the missing piece is not a widget but a signal — the hold buffer has no frame — so this is a protocol
question the study does not answer. For Remote Control: the exclusion is worth re-examining once,
because the capability is one control request away and the consent card is the only thing standing
between an afleet channel and a phone. If it is ever taken, canon's two rules transfer intact: write
the seen-flag only on acceptance, and re-check the account between ask and answer. Neither is optional
— both exist because the answer can outlive the question.

**Drops / keeps / gains.** Drops: both dialogs. Keeps: acceptance-only persistence and the account
re-check, as constraints on any future build. Gains: none.

**Open.** Owner's call: the "Remote Control sessions" exclusion in §3 reads as excluding *cloud
sessions driven from claude.ai*, but tui-parity found the reverse capability — afleet's own local
channel exposed to the phone. Are those the same exclusion?

### D-54 · `cloud_sync_*`

**Terminal.** Two kinds, both verified in the binary and neither named in SPEC 263:
`cloud_sync_offline` (`cli.pretty.js:167266`) and `cloud_sync_consent` (`cli.pretty.js:222630`). The
offline dialog's copy is in SPEC 37 §37.18.10 (`chunk-6wg4v2yj.js:167266`, the same site):

```text
File sync is offline for this session
Changes are no longer being copied between this project directory and the cloud session until service is restored. Your session will continue without file sync and Claude will run its tools on your local files only instead.
```

with three "while this computer is closed or offline" variants appended to the status block, and a
whole family of one-line reasons keyed by cause (`offline`, `refused`, `too_large`, `withdrawn`,
`gave_up`, twenty more). The consent side is the directory-sync opt-in taken before a cloud session is
created (SPEC 37 §37.6 step 2, "Sync-consent dialog `Pt({dialogs, explicitRef, storageV5, signal})` —
the SDK host is asked for consent"). A canon quirk worth carrying: SPEC 37 §15477 records that
`dirSyncConsent` "has no in-bundle caller" — the field appears seven times and nothing reads it as a
caller-supplied value.

**Job.** Get permission before a folder on this machine is mirrored into a container, and tell the user
plainly when that mirror stops.

**Wire.** `X`. Finding 19 lists `cloud_sync_*` among the never-forwarded kinds;
`docs/tui-parity/README.md` A-46/19/48/37 adds that a GUI driving a cloud session gets an empty
`initialize` reply and that cloud-session create progress never leaves the process.

**afleet today.** `out-of-scope`. Root spec §3: "Out of scope: agent teams as channel members,
**cloud and Remote Control sessions**…", restated in §17.8. afleet hosts local processes; there is no
cloud session to sync a directory with.

**GUI form.** None. Recorded for the map because the offline family is the best-written degradation
copy in the whole bundle and is worth stealing wholesale if afleet ever grows a surface that can lose a
connection mid-session: it states what stopped, what still works, what the user should do differently,
and what will happen when it comes back — in that order, in one paragraph, with no jargon.

**Drops / keeps / gains.** Drops: everything. Keeps: the degradation-copy structure as a pattern.
Gains: none.

**Open.** None.

### D-55 · `auto_mode_setup_review` and the first-environment consent dialog

**Terminal.** `auto_mode_setup_review` and `auto_mode_flagged_allow` are both registry kinds
(`cli.pretty.js:518604`, verified) and neither is named in SPEC 263, which describes the flow without
the kind literal. SPEC 26 §26.20.2 is the `/auto-mode-setup` wizard: a seven-state machine whose first
screen asks `Teach auto mode about your environment?` over the body
`Claude Code reads this project, your recent Claude sessions, and optionally your shell history and
other repositories. Claude analyzes this data and customizes auto mode to make better decisions.`,
then `How you use Claude here` with four postures (`Work`, `Open source`, `Hobby`, `Mixed`) and two
depth checkboxes (`Also scan shell history`, `Also scan your other repos`). An existing-entries step
offers `Add to them (keeps your existing entries)` / `Start fresh (replaces the environment section)` /
`Cancel`. The scan runs foreground or background (`Gathering data and drafting your auto-mode setup;
back soon`), and the proposal returns as a dialog titled `Review proposed auto-mode setup`, whose
decline prints `Discarded — nothing was saved. Re-run /auto-mode-setup anytime.` SPEC 26 §26.21.3 is
the separate first-environment consent, bordered in the `permission` colour with the confirm option
focused on **cancel**: title `Replace the built-in environment?` over

```text
Writing your own environment replaces the built-in default document — the classifier context that defines trusted hosts, sensitive targets, and repository scope. The editor starts from the full default text so you can edit rather than rewrite; deleting all your environment entries later restores the default.
```

**Job.** Auto mode decides tool calls with a classifier; both dialogs govern the document that
classifier reads. The first asks whether the machine may be scanned to draft it; the second asks
whether the shipped default may be replaced.

**Wire.** `X`. Finding 19 lists `auto_mode_setup_review` (and `auto_mode_flagged_allow`) among the
never-forwarded kinds; `/auto-mode-setup` is itself a `local_jsx` slash command, also on that list, so
neither the wizard nor its review can be raised from a headless host.

**afleet today.** `undesigned`, and consequential. afleet's composer offers a permission-mode picker
including `auto` (root spec §8.5, §8.6's sibling), and auto mode is exactly the mode whose safety
depends on the environment document — the same document that governs `SandboxNetworkAccess`
(D-50, SPEC 26 §26.22.1). afleet can select the mode and cannot see, edit or draft the document behind
it.

**GUI form.** Region: **Settings window** (§2), Engine pane, one row — and an honest one. **What afleet
shows:** an "Auto mode environment" row reading either "Using Claude Code's built-in environment
document" or "Custom environment: N entries", with a single action *Set up in terminal* that opens a
Terminal pane running `/auto-mode-setup`, exactly the handoff `PrecommitModel.reviewTrustInTerminal()`
already implements. **When afleet knows to show it:** the `autoMode` settings block is readable through
`get_settings` (`effective`), which afleet already polls for `disableBypassPermissionsMode` (§8.6), and
`claude auto-mode config` is the CLI readback the success message itself points at. Do not rebuild the
wizard: it scans the user's shell history and other repositories, which is a consent afleet has no
surface to take and no reason to duplicate. Do carry §26.21.3's cancel-focused framing into the row's
copy — replacing the built-in document is the destructive direction and the row should say so.

**Drops / keeps / gains.** Drops: the wizard, the posture picker, the depth checkboxes, the proposal
review. Keeps: the readback, the handoff, and the warning that a custom environment replaces rather
than extends. Gains: `[exceeds]` a persistent readback of which environment is in force, which the
terminal only shows inside a slash command.

**Open.** Should afleet offer `auto` in the mode picker at all while it cannot show the environment
document? The mode is safe by construction only relative to a document the user may never have seen.

### D-56 · Worktree exit: keep or remove

**Terminal.** SPEC 47 §47.12.7. On session exit inside a worktree session, three automatic paths run
before any dialog: a guest session (`enteredExisting`) returns immediately with
`Returned to <cwd> (worktree at <path> left in place)`; an inaccessible worktree is treated as gone;
and a worktree with **no uncommitted files, no commits ahead of `originalHeadCommit` and no custom
session title** is removed without asking, printing `Cleaning up worktree (no pending changes)…` then
`Worktree removed (no changes)`. Otherwise the dialog opens, titled `Exiting worktree session`, with
one of six subtitles chosen by state — the two that matter most being
`You have N uncommitted files and M commits on <branch>. All will be lost if you remove.` and
`This session was named "<title>". Keep the worktree to resume it later, or remove it to clean up.`
Options without tmux are `Keep worktree` / `Stays at <path>` and `Remove worktree` /
`All changes and commits will be lost.`; with tmux there are three, defaulting to
`Keep worktree and tmux session`. **Cancelling is not `keep`**: Esc calls the exit-cancellation
callback, so the session resumes with the worktree record intact and the lock unreleased. SPEC 23
documents the mid-session twin, `ExitWorktree`, whose `action` is `keep` or `remove` and whose no-op
message names the boundary: it "will not touch worktrees created manually or in a previous session".

**Job.** Never delete uncommitted work silently, and never leave a directory and a branch behind
without saying so.

**Wire.** `X → R`. `docs/tui-parity/README.md` A-22/47/40: "The worktree exit dialog is not a dialog
kind; a headless session exiting inside a worktree silently leaves the worktree and branch on disk. The
GUI runs the three probes and drives `ExitWorktree` itself (X to R)."

**afleet today.** `out-of-scope` by the letter of the spec — root spec §3, "Out of scope: … branch and
**worktree management UI** …", restated in §17.8's standing exclusions — but the exposure is real and
the exclusion does not cover it. afleet's sidebar sub-groups channels by worktree (§7.1), so worktrees
are a first-class display concept; and the model can call `EnterWorktree` mid-session in an afleet
channel, after which nothing in afleet or in the headless child will ever ask at exit. The result is
accumulated directories and branches under `.claude/worktrees/` that no surface names.

**GUI form.** The minimum that closes the leak without building a management UI, and it is small:
when a channel afleet owns is closed, archived or reaped, and the child reports a worktree session,
run the terminal's own three probes — `git status --porcelain`, `git rev-list --count <base>..HEAD`,
and the session-title check — and apply canon's rule. Clean and unnamed → remove silently, as the
terminal does. Anything else → a confirmation sheet carrying the matching subtitle verbatim and the
two actions `Keep worktree` / `Remove worktree`, driving `ExitWorktree` with the chosen `action`.
Keep the terminal's most important detail: **cancel is not keep** — dismissing the sheet must leave the
channel open and the worktree untouched, not silently keep it, because the two look identical and only
one of them is a decision. `[exceeds]` afleet can show the uncommitted files as a real diff in the
Source Control panel before the user chooses, which is the single strongest argument for building this
rather than deferring it.

**Drops / keeps / gains.** Drops: the tmux variants, the guest path, the exit-time framing. Keeps: the
three probes, the auto-remove condition, the six subtitles' information, cancel ≠ keep. Gains: a real
diff behind the decision.

**Open.** Owner's call, and it is a scope call: does "worktree management UI" exclude a confirmation
that prevents data loss the app itself caused? Everything else in §3's exclusion list is a feature;
this is a leak.

### D-57 · `dialogExpiry` — the setting that ages dialogs out

**Terminal.** SPEC 45.22.13. Every parked `request_user_dialog` carries a deadline resolved in a fixed
precedence: `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` taken as-is; else the `dialogExpiry` setting mapped by
`Cto` — `60s` → 60,000 ms, `5m` → 300,000 ms, `10m` → 600,000 ms, **`never` → 0**, unset → `undefined`;
else the default `300000` ms. The timer is installed **only when the resolved deadline is positive**,
so `dialogExpiry: "never"` installs no timer and an unanswered dialog stays parked indefinitely. When
it does fire, the request is recorded in `timedOutUserDialogs`, machine-cancelled with a locally
injected `{behavior:"cancelled"}` success, and logged as
`tengu_request_user_dialog_timeout {dialog_kind, timeout_ms}`; a late answer is discarded. Three
settings facts matter for a GUI: the key is read **from trusted sources only** — user, policy and flag,
never a checked-in project or local settings file (SPEC 03 §9.1, §9.x note: "read from trusted sources
only (user/policy/flag) — workspace-resident project and local settings are ignored"); its default is
`5m` (SPEC 03 §3155); and in the restrictive-only table its restrictive value is **`"never"`**
(SPEC 03 §5.7), so an organisation can only tighten it toward *no expiry at all*. `/config` exposes it
as `Dialog expiry` with options `default, 60s, 5m, 10m, never` (SPEC 41, config rows). Its sibling
`askUserQuestionTimeout` governs `AskUserQuestion` separately and has the same `never` shape.

**Job.** Stop a blocking question from holding a session forever — while letting a security-conscious
deployment choose the opposite, because a silently auto-cancelled consent gate is worse than a stuck
one.

**Wire.** `P` for the effect, `D` for the control. The cancellation arrives as a real
`{behavior:"cancelled"}` on the parked request, which afleet already handles; the setting itself is
readable through `get_settings.effective` but not writable — `update_settings` writes exactly one key
(`outputStyle`, `docs/tui-parity/README.md` finding 7), and every other persisted setting needs
`/config key=value` as text or a file edit.

**afleet today.** `built`, partially, and already correct in the design. Root spec §8.4: "An unanswered
dialog is cancelled by the binary at its dialog deadline — five minutes, configurable (2.1.263) — and
the card goes inert", which C6.3 implements (`DecisionCardView`'s inert reading, `RetractionRegistry`), and `DialogDeadline.text`
does say a deadline exists.
**What it loses:** `DialogDeadline.standard` passes `dialogExpiry: nil`
(`App/Decisions/DialogCardView.swift:44`), so every card states the engine default — *This dialog
expires in 5 minutes.* — whatever the session is set to. The environment override
`CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` is honoured, by `DialogDeadline(environment:dialogExpiry:)`;
the setting is not, though it is on `get_settings.effective` and §8.6 already polls it. And an
expiry that fires reads as the generic inert state, so a user who left the window cannot tell a
question that expired from one that was answered.

**GUI form.** Region: **Decision card** footer plus **Settings window**. Two things. (1) On a card whose
kind is a forwarded `request_user_dialog`, show the remaining time as a dim relative deadline in the
footer row (D-06's hint row: `expires in 4m`), and switch it to a stated outcome when it fires —
`Expired — no answer was sent` — rather than the generic inert reading, because "cancelled by the
binary" and "cancelled by you" are different facts and canon distinguishes them. Do not run a
per-second countdown: a decision card is not a timer, and the terminal shows nothing at all here, so a
relative label refreshed on the minute is already an `[exceeds]`. (2) In the Settings window's Engine
pane, show `Dialog expiry` as a **readback** of the effective value with a note that it is changed in
Claude Code — afleet cannot write it and must not write under `<configHome>` (§17.8, X9). Carry the
restrictive-direction fact into the copy: `never` is the *safer* setting, not the lax one, which is the
opposite of what a "timeout" row usually implies.

**Drops / keeps / gains.** Drops: the environment-variable override, the telemetry, the write path.
Keeps: the five-minute default as the assumed deadline, the machine-cancel semantics, the
trusted-sources-only reading. Gains: `[exceeds]` a visible deadline and a distinguished expiry outcome,
neither of which the terminal shows.

**Open.** Should afleet's own unforwarded gates (D-42, D-44, D-45) expire at all? They are afleet's,
not the engine's, and a trust banner that ages out is a trust banner that stops protecting. The
recommendation is no — but the asymmetry with engine-raised cards should be deliberate, not accidental.

---

## H. Confirmations the terminal raises on its own

Not tool permissions: the host asking about its own state.

### D-58 · Exit with running tasks or background work

**Terminal.** There is **no exit confirmation**. Exit is a double-press arm with a notification:
`ctrl+c` clears the input and arms, a second press within 800 ms exits, hint `Press Ctrl-C again to
exit` — or `Press Ctrl-C again to detach (session keeps running)` in a background session
(SPEC 42.21.4). `ctrl+d` arms only on an empty buffer (`Press Ctrl-D again to exit`); at the end of
a non-empty line it is inert (SPEC 42.21.5). Nothing counts running work. The one canon dialog that
counts it guards **backgrounding**, not exit: `left_arrow_confirm`, title `Background this session?`,
cancel `Stay`, `hideWhile: []`, its subtitle assembled from up to four fragments (verified in
`cli.pretty.js:484904-484954`) — `${summary} running — they will be stopped.`, `N task(s)
carr(ies|y) over to the background session.`, an artifact-auto-reply sentence, and `N running
workflow subagent(s) restart(s) from the beginning…` — and its confirm reading `Background anyway
(tasks will be stopped)` or `Background`. SPEC 20 states the cost of leaving: `Note: it does not
survive exiting this session.` The clone byte-verified the 800 ms window and corrected Ctrl-D from
one press to two (`CC-to-SDK/docs/parity/tui-ux.md`, "Ctrl-C twice / Ctrl-D to exit").

**Job.** Stop the user destroying running work by reflex.

**Wire.** `P` with a named gap — `docs/tui-parity/README.md` (A-20): "Ending the session kills every
running background shell … there is no graceful-detach route (P, needs a warning at teardown)."

**afleet today.** `built`, and the strongest translation in the lane —
`App/Header/QuitGuard.swift` on `applicationShouldTerminate`. `Quit afleet?` / `Quit` / `Cancel`;
the text names every busy owned channel **by title**, counts live Terminal panes, and advises
releasing with *Open in terminal* "into a terminal of your own". Asks once; three termination passes
with re-census; `.waiting` counts as busy, so a channel holding a permission card is protected.

**GUI form.** This is what one process becoming twenty sessions does to a confirmation: canon can
arm, because the user is looking at what dies; afleet must **enumerate**, because nineteen channels
are behind the sidebar. Keep it, with two deltas: port `left_arrow_confirm`'s cost fragments so the
dialog says what dies and not only which; and make *Send to background* and *Open in terminal*
**buttons in the dialog** rather than advice to cancel and start over.

**Drops / keeps / gains.** Drops: the arm, the hint strings, `ctrl+d`. Keeps: leaving kills running
shells, stated before the act. Gains: named channels, a pane census, a per-channel escape.

**Open.** Should the dialog offer *Background all busy channels and quit*? It is one verb afleet has.

### D-59 · The kill-agents confirmation

**Terminal.** SPEC 42.21.8. `ctrl+x ctrl+k` needs a double press within **3000 ms** (`var Irt =
3000`), which is both the arming window and the hint lifetime. The arm is a notification, not a
dialog: `Press ${chord} again to stop background agents`, priority `immediate`; idle, `No background
agents running` for 2000 ms. Admitted when any of six conditions holds (running agent, armed rewind,
passive background task, live-document watch, artifact room, `Sn`), but the **command queue clears
only** on the first three; dropped commands go to history with undo disarmed. The clone shipped it
verbatim (`CC-to-SDK/docs/parity/tui-ux.md`, "Ctrl-X Ctrl-K kill agents").

**Job.** One gesture that stops everything the session started, with a beat of hesitation, because
there is no undo.

**Wire.** `D` — `docs/tui-parity/README.md` (A-42): no wire equivalent; nearest is
`interrupt {cancel_queued: true}` plus one `stop_task` per live task, and a plain `interrupt` does
not stop tasks (A-20 adds that `perTaskStopAffordance` must be declared or it does).

**afleet today.** `built` — `App/Composer/CommandRouting.swift` `.stopEverything`: `Stop everything
in this channel?` / `The running turn and every background task in this channel stop. Their shells
close.` / `Stop Everything`. Raised from the channel-header menu (`App/Header/HeaderMenus.swift:50`)
and the composer shortcut bar (`App/Composer/ComposerShortcuts.swift`), through one gate.

**GUI form.** Trading a two-press-plus-toast for a real confirm is right where the chord is also a
menu item a mouse can reach. Three deltas: disable *Stop Everything* on an idle channel with canon's
own reason, `No background agents running`, instead of opening a dialog about nothing; say in the
message that the **command queue** goes, since afleet renders a visible queue chip and canon clears
it; and promise canon's recovery — cancelled queue entries return to composer history.

**Drops / keeps / gains.** Drops: the 3000 ms arm, the chord, the six-condition test. Keeps: the
stated cost; the queue clearing. Gains: a reachable menu item, one gate for two entry points.

**Open.** Canon's gesture is session-wide, afleet's channel-wide. Is a machine-wide stop wanted?

### D-60 · `/clear` while a prompt is queued

**Terminal.** **This confirmation does not exist at 2.1.263.** `/clear` is a plain `local` command
with `post-text` dispatch and no dialog: no entry in the `fk` registry (D-09), no `Confirmation`
binding (SPEC 42.6.6), no confirmation string in chapters 13, 23, 28 or 35. Its description is
`Start a new session with empty context; previous session stays on disk (resumable with /resume)`
(SPEC 35.26.6). The only queue-destroying action canon guards is `chat:killAgents`, and it guards it
with a double press (D-59). Canon's safety story here is **recovery, not prevention**: dropped
queue entries go to prompt history, which SPEC 35 records survives — "in normal use, `/clear` does
not touch it" — as does the previous conversation, on disk and resumable.

**Job.** Do not silently destroy a queued prompt. Canon discharges it through history, not a gate.

**Wire.** `R`. `/clear` goes as text; the `conversation_reset` frame resets the timeline
(`docs/tui-parity/README.md` A-42; root spec §7.7's `/clear` row).

**afleet today.** `routed-only` — §7.7's row is the single line "sent as text; `conversation_reset`
frame resets the timeline"; nothing in `App/` specifies a form, and no confirmation is missing.

**GUI form.** Do not invent a dialog canon does not have. Carry the recovery instead, visibly where
the terminal did it silently: the notice row posted on `conversation_reset` says how many queued
prompts were dropped, states that their text is in composer history, and `[exceeds]` carries an
*Open the previous session* link — the honest GUI form of "you can get it back", on a route afleet
already has.

**Drops / keeps / gains.** Drops: nothing. Keeps: recovery over prevention. Gains: a visible count
and a click back to the cleared session.

**Open.** None.

### D-61 · Logout

**Terminal.** `/logout` is `local-jsx`, described `Sign out from your Anthropic account`, gated on
`!DISABLE_LOGOUT_COMMAND` and declaring `fleetHostCall` (SPEC 08 §13). **It asks nothing.** Its whole
body is two strings: `Signing out…` and `Couldn't sign out — ${message}`. The CLI sibling matches:
`claude auth logout` prints `Successfully logged out from your Anthropic account.`, or
`Logout failed: <message>` on stderr with exit 1 (SPEC 08 §14.3). One process, one account, cheap
re-login — canon spends no gate on it.

**Job.** End the machine's credential. In a terminal that is one session's problem.

**Wire.** No route — `docs/tui-parity/README.md` (A-42) lists `/logout` under "No route at all" with
the substitute named: shell out to `claude auth logout`. Class `X` for the panel.

**afleet today.** `built` — `App/Composer/CommandRouting.swift` `.logout`: `Sign out of every channel
on this machine?` / `Every owned channel and every afleet-launched job on this machine signs out.` /
`Sign Out`, drawn by `ComposerShortcuts.swift`'s `confirmationDialog`. The fuller flow is `designed`
at root spec §7.7's `/logout` row and acceptance item 59: spawn barrier, census of owned channels and
afleet-launched jobs, `claude stop <short>` verified against the roster, per-channel *Wait* or *Stop*
with *Stop everything* semantics, then `claude auth logout`, success only when every listed process
has exited, plus the warning that foreign sessions keep their token until they restart.

**GUI form.** Keep, and finish. The clearest case in the lane of a confirmation the terminal does not
need and the window does — the multiplier is the fleet, not the danger. The built two-button alert is
the degenerate case; the designed form is a Consent sheet (app-modal is right here: logout is global)
listing channels and jobs by name with a live-task count and a *Wait* / *Stop* choice each, a drain
progress state, and a line naming any foreign session that keeps its token.

**Drops / keeps / gains.** Drops: `Signing out…` as the whole UI. Keeps: the two outcome sentences as
the sheet's terminal states. Gains: `[exceeds]` a census, per-channel wait-or-stop, honesty about
foreign sessions.

**Open.** Does the sheet block, or run in the background with an Activity row? A logout waiting on
one compiling channel should not hold a modal sheet.

### D-62 · The other users of the `Confirmation` keyboard scope

**Terminal.** SPEC 42.6.6 gives the scope nine defaults — `y`/`enter` → `confirm:yes`, `n`/`escape`
→ `confirm:no`, `up`/`down` → previous/next, `tab` → `nextField`, `space` → `toggle`, `shift+tab` →
`cycleMode` — plus `confirm:previousField` and `permission:toggleDebug`, both unbound. Only two
components claim the scope with `claimFocus` in the entire build (`scope: "Confirmation"` occurs at
`cli.pretty.js:205009` and `:192398`, nowhere else); ~126 further sites bind into it.

| Claimer | Evidence | Carded here? |
|---|---|---|
| The dialog frame — all 41 registered kinds | SPEC 41.22.7, `cli.pretty.js:205009` | Yes — D-01, D-09 |
| The `/resume` picker's **preview** pane: "`Enter` or `y` resumes and `Esc` or `n` returns to the list" | SPEC 35, session-picker section | **New** — a real decision, but the resume lane's, not D's |
| The memory / **auto-memory settings selector**, a list rather than a dialog | `cli.pretty.js:192394-192398` (the `Auto-memory:` row) | **New, and not a decision** — a list borrowing the vocabulary for focus |
| The session-picker's **rename** footer (`confirm:no`, `fallback: "Esc"`, rendering `Enter to save · Esc to cancel`) | SPEC 35 | New, trivial — a hint row |
| `confirm:cycleMode`'s four consumers: the permission dialog's session row and feedback toggle; the plan dialog's approve-with-feedback; the working-directory row (`Yes, keep allowing reads outside the working directories` / `No, ask again next time`); the `/powerup` lesson carousel advancing a slide | SPEC 42.22.6 | First three carded (D-21, D-22, plan family). The carousel is **new and not a decision** |
| `permission:toggleDebug`, unbound by default | SPEC 42 action table | New — a debug toggle inside the permission dialog |

**Job.** One keyboard vocabulary for everything yes/no-shaped, so `y` and `Esc` mean the same thing
wherever the user is.

**Wire.** `T` — `docs/tui-parity/README.md` (A-42) classes the keybinding layer terminal-only;
`~/.claude/keybindings.json` is invisible to the headless CLI.

**afleet today.** `undesigned`. afleet has no keyboard-scope layer: `PermissionCardView` binds
`.defaultAction` and nothing else (D-06), and neither new surface above exists in `App/Decisions/`.

**GUI form.** The finding is negative and worth carding for that reason: **`Confirmation` is a focus
vocabulary, not a decision class.** A settings list, a resume preview, a rename footer and a lesson
carousel all claim it, and three of those decide nothing. afleet must not infer "decision surface"
from the scope, nor build a card per claimer. What transfers is D-06's verb list as the naming
convention for card actions, and one-card-owns-the-keyboard for real decisions only.

**Drops / keeps / gains.** Drops: the scope mechanism, the binding sites, `y`/`n` as global answer
keys (a window has focus; a bare letter cannot be an answer). Keeps: the verb vocabulary. Gains:
none — this card exists to stop a wrong inference.

**Open.** None.

---

## Ranking input

| Card | Surface | afleet status | User value | Build cost | Depends on |
|---|---|---|---|---|---|
| D-01 | The dialog frame: title, titleEnd, subtitle, cancel hint | `built` (2 of 4 slots) | med — the shared shape every family fills | S — two slots on an existing view | — |
| D-02 | Mid-turn mounting and turn-boundary retirement | `superseded` (mechanism) / `undesigned` (expiry) | med — a stale answerable card is a wrong answer | S — retire on the turn's `result` frame | D-09 |
| D-03 | Blocking input by unmounting, not disabling | `superseded` | low — afleet's inversion is right; keep "absent, not disabled" | S — a review rule, not a build | — |
| D-04 | The dialog store: ordering and the 150 ms input grace | `undesigned` | high — the grace is the cheapest guard against an accidental approval | S — one timer, one active-card rule | D-01 |
| D-05 | Suppression, the draft placeholder, the jump-to-decision pill | `undesigned` | high — never steal a half-written prompt; announce an off-screen decision | M — a pinned strip plus scroll-to-card | Composer, Timeline scroll anchor |
| D-06 | The keyboard-hint footer and the two scopes | `undesigned` | med — discoverability; the menu bar is empty | M — hint row plus a Decision menu | D-01, menu bar |
| D-07 | The select list, multi-select and text input primitives | `built` per family, not shared | high — one widget four families reuse | M — one `DecisionOptionList` | D-01 |
| D-08 | When a dialog cannot open: the two failure strings | `undesigned` (situation handled) | med — an inert row with no sentence is a dead end | S — one sentence plus *Open in Terminal* | D-09 |
| D-09 | The dialog registry and the three mounts | `designed` (2 of 41 kinds; uniform inline placement) | high — the placement law every other card inherits | M — one dock region, one channel-scoped sheet presenter | D-01, D-04, D-26, D-38 |
| D-10 | The permission ask: dispatch and the twelve kinds | `built` (3 routes of 12) | high — every route-specific title and question hangs off it | M — a route table; the bodies mostly exist | D-01, D-07 |
| D-11 | Bash command: titles, description, destructive warning | `built`, thin | high — the warning is the only guard on a destructive command | S — 16 regexes, 3 titles, one question line | D-10, D-20 |
| D-12 | The asks that never happen: allowlist and rules | `undesigned` | low — explanatory, not blocking | M — needs a rule matcher | D-21, lanes E/F settings |
| D-13 | PowerShell command | `undesigned` | low — latent on a macOS host | S — 15 constants | D-11 |
| D-14 | File edit / create / overwrite and the inline diff | `built`, diff strong | high — the review surface for every file change | M — 4 titles, question, 5 withheld sentences | D-10, Files panel (Monaco) |
| D-15 | NotebookEdit | `undesigned` | med — notebooks are common in this audience | M — a cell renderer | D-14, notebook viewer |
| D-16 | WebFetch / WebSearch and the domain rule | `built`, generic | med — host-scoped grants are easy to get wrong | S — title, question, host-first layout | D-10, D-21 |
| D-17 | MCP tool asks and the organisation ask ceiling | `built`, ceiling not honoured | high — an org policy afleet currently ignores | S — read the reason, hide the row | D-21, `/mcp` browser (lane E) |
| D-18 | Agent, Skill, workflow and the request-source badge | `built`, minimal | med — who is asking changes what the answer means | M — badges plus grant suppression | D-21, Agents panel |
| D-19 | Browser and Monitor asks | `undesigned` | med — Monitor grants recur and nothing lists them | M — two bodies plus a grants list | D-21, Browser tab, Activity |
| D-20 | The decision-reason banner and the denial streak | `built`, reason rebuild strong | high — answers "why am I being asked this?" | M — config hints as buttons, streak counter | D-25, Activity |
| D-21 | "Yes, and don't ask again": consent rows and destination | `built`, exceeds canon | high — the one control that changes future behaviour | S — name the file, adopt limits, honour suppressions | D-17, D-18 |
| D-22 | The footer, amend, and the editable rule prefix | `undesigned` | med — shortcut discoverability; narrowing a grant | S for the hint row, M for the editable rule | D-06, D-21 |
| D-23 | Escape, the answer branches, `default_to_no` | `built` for allow/deny; no cancel | high — no way to stop a turn from the card | S — one more action plus option order | D-24 |
| D-24 | Feedback: the placeholders and the four rejection strings | `built` for reject, truncated | high — the model is currently not told to stop | S for the constant, M for accept feedback | D-23 |
| D-25 | Auto mode: flagged allow, denied notice, denial limits | `undesigned` | med — matters only if afleet offers auto mode | M for Activity rows, L if the mode is offered | D-20, Activity view |
| D-26 | Enter-plan-mode confirmation | `undesigned` | med — explains an escalated mode transition | S — specialise an existing permission card | D-01, D-07, D-10 |
| D-27 | Plan-approval shell, empty-plan variant, proceed step | `built`, materially partial | high — prevents approval without faithful plan review | M — shell, markdown, guard, transcript states | D-01, D-07, markdown renderer |
| D-28 | Approval options and what each persists | `built`, materially partial | high — the selected execution mode must match the grant | M — state-built options, corrected rejection semantics | D-07, D-27, mode-availability signals |
| D-29 | The optional artifact-review step | `undesigned` | low — an optional richer review path | L — artifact publishing plus Browser integration | D-27, Browser panel |
| D-30 | Editing the plan in the dialog, and the plan file | `built` read-only; editing `undesigned` | high — lets a user correct the artifact they approve | M — Files-panel editor, save sync, diff | D-27, Files panel, Monaco |
| D-31 | `/ultraplan` and `ultraplan_choice` | `undesigned` | med — remote planning with an explicit handoff | L — native cloud-session orchestration is absent | remote sessions, Browser, Activity |
| D-32 | Teammate plan approval, lead and teammate sides | `undesigned` | high — governs delegated implementation safely | L — team approval frames unavailable headless | team wire, Agents panel, Activity |
| D-33 | The question dialog: header, options, side-by-side previews | `built` | high — the model's only way to buy a decision mid-turn | M — preview two-column and review row are new | D-07, D-34 |
| D-34 | Multi-select and the `Other` free-text row | `built`, partial | high — `Other` is the escape from the model's list; no decline exists | S — `Other` exists; the decline is string assembly | D-33, D-07 |
| D-35 | Timeout and away-from-keyboard auto-resolution | `undesigned` | med — matters for an unattended fleet, not a watched session | S — idle timer, countdown line, Settings enum | D-33, Settings window |
| D-36 | Extended questions: `kind`, `placeholder`, numeric bounds | `built` ahead of spec; flag not set | med — free capability afleet parses and never exercises | S for the flag, M for stepper / `title` / `followUp` | D-33, launch-line seam |
| D-37 | Elicitation, form mode | `built` | high — the one surface where a native GUI plainly beats the terminal | L — the whole constraint/validation layer is missing | D-07, C5 HostLinkRouter |
| D-38 | Elicitation, URL mode and `mcp_elicitation_waiting` | `built` for URL; waiting unreachable | high — `Accept` is hidden, so the flow cannot complete | S for `Accept` + declaring 3 kinds; M for the waiting state | `supportedDialogKinds`, HostLinkRouter, Browser tab |
| D-39 | `elicitation_complete` and the three settlements | settlements `built`; completion frame dropped | med — closes a waiting card, prevents a hung tool call | S — one reducer case plus cancel-on-teardown | D-38, ClaudeWire `SystemFrames` |
| D-40 | `refusal_fallback_prompt` | `built` | high — explains an event the user did not cause; the copy is absent | S — copy composition plus label interpolation | D-01, `RetractionRegistry` |
| D-41 | `fable_overage_consent_prompt` | `built` | med — a money decision, but rare, and the wire carries little copy | S — route the billing action; render the fallback | D-40, Activity, Terminal tab |
| D-42 | Workspace trust | `built` (`App/Consent/TrustBanner.swift`, `PrecommitModel`, §6.11) | high — the gate deciding whether a checkout's config may execute | S — gate exists; only the grants disclosure is new | D-44 (same banner+sheet shape) |
| D-43 | The bypass-permissions disclaimer | `designed`, not built (root spec §8.6) | high — the one mode that stops asking, reachable from the mode picker today | M — sheet, quiescent restart, own-store acceptance | §7.4 quiescent restart; `get_settings.effective` |
| D-44 | `.mcp.json` project MCP server approval | `built` (`App/Consent/ConsentSheet.swift`, §6.12) | high — stops a checked-in file spawning a process before the handshake | S — three additions to a shipped sheet | D-42's banner; C4's local-settings writer |
| D-45 | Managed settings security | `built` **but wrong** — hashes the file, not the extraction | high — currently a permanent spawn refusal on any managed deployment | S to fix the hash and the `j5()` predicate; M with the review sheet | SPEC 48 §2.9.4 record shape; D-42's handoff |
| D-46 | External CLAUDE.md includes | `undesigned` (no reader in the tree) | med — silent instruction loss; no security consequence | S — one extra key on a read §6.11 already performs | D-42's global-config reader |
| D-47 | Plugin consent and `plugin_hint` | `undesigned` (plugins outside §3 v1/v1.1); hint `superseded` | low — no plugin install surface exists to gate | S if ever needed | a future plugin browser |
| D-48 | The API-key trust dialog | `undesigned` (key deliberately forwarded, `LaunchConfiguration.swift:146`) | med — silently changes billing account and org policy | S — env afleet already resolves plus one global-config key | §3 login-shell environment resolution |
| D-49 | Chrome install and `computer_use_approval` | `undesigned`; the upsell `superseded` by the Browser panel | low — computer use is unreachable headless (`X`) | L if the capability is ever taken | outside v1 in practice |
| D-50 | `sandbox_network_access` | `built` by inheritance (arrives as `can_use_tool`, `P`) | med — works already, but the host is buried in the tool input | S — host into the title slot, per-host de-dup, header readback | D-01 title slot, D-21 persist row |
| D-51 | `lsp_recommendation` and `ide_onboarding` | `out-of-scope` (§3, §17.8) | low — superseded by Files/Monaco and `@path` mentions | — | — |
| D-52 | `goal_proposal` | `undesigned`; the tool refuses on session shape first | low — unreachable twice over | — | would need a wire change (outside this study) |
| D-53 | `peer_inbound_approval` and `remote_callout` | `out-of-scope` for the callout (§3); `undesigned` + unreachable for peer inbound | low now, med if §3 is revisited | M for Remote Control consent | owner's scope call on §3 |
| D-54 | `cloud_sync_*` | `out-of-scope` (§3, §17.8) | low — no cloud session exists to sync | — | — |
| D-55 | `auto_mode_setup_review` and the first-environment consent | `undesigned` | med — afleet offers `auto` with no view of the environment doc that makes it safe | S — one Settings row plus terminal handoff; do not rebuild the wizard | `get_settings.effective` poll; `PrecommitModel` handoff |
| D-56 | Worktree exit: keep or remove | `out-of-scope` by §3 — but the leak is afleet's own | med — the model can call `EnterWorktree` and nothing ever asks at exit | S — three git probes plus a confirm sheet driving `ExitWorktree` | Source Control panel; owner scope call |
| D-57 | `dialogExpiry` | `built` with a live bug: `dialogExpiry` is always nil | med — every card claims five minutes regardless of the real setting | S — one field on the `get_settings` poll; make the label *remaining* | §8.6's existing poll |
| D-58 | Exit or quit with running tasks | `built` — `App/Header/QuitGuard.swift` | high — the only thing between Cmd+Q and twenty abandoned sessions | S — copy plus two buttons on an existing guard | registry mirror (task counts); §7.4 verbs |
| D-59 | Kill agents / stop everything | `built` — `CommandRouting.swift`, `HeaderMenus.swift:50` | med — destructive, mouse-reachable, cost partly unstated | S — a disabled-state reason and one sentence about the queue | queue chip (§8.5); `perTaskStopAffordance` |
| D-60 | `/clear` with a queued prompt | `routed-only` (§7.7, one row) | low — no canon confirmation exists; the value is the recovery notice | S — one notice row plus a link | `conversation_reset` notice; composer history |
| D-61 | Logout | `built` (two-button alert); `designed` (census flow, §7.7, item 59) | high — global, irreversible-feeling, and the built form is the degenerate case | M — a sheet with a live census and per-row Wait/Stop | §7.7 spawn barrier; roster; Activity |
| D-62 | Other claimants of the `Confirmation` scope | `undesigned` (afleet has no scope layer) | low — a negative finding that prevents wrong builds | S — nothing to build | D-06; routes two surfaces out of lane D |

## For the map

- **One option list, four families.** D-07's `DecisionOptionList` is what the permission, plan,
  question and elicitation cards should all draw: absolute 1-based numbering with digit shortcuts,
  the three row states, `✔` for selected, escape to cancel, and a per-row consequence line the
  terminal had to fold into the label. Today each family has its own ad-hoc control.
- **Placement is declared per kind in canon; afleet flattens forty-one kinds into one Timeline
  row.** D-09's four-way destination rule — inline card, above-composer dock, channel-scoped sheet,
  banner or notification — is the most reusable output of this lane, and it also identifies the
  thirteen registered "dialogs" that are advertisements and should never be cards at all.
- **Any sheet is modal to the channel, never to the app.** Canon's `modal` blocks one terminal
  process; in a window holding twenty sessions an app-modal plan approval freezes nineteen
  unrelated conversations. This is the general shape of the multiplier: every terminal confirmation
  that guarded one process must be re-scoped before it is ported.
- **Never steal the composer mid-draft.** The terminal's suppression order puts `draft` above
  `typing` and parks a suppressed dialog behind a placeholder sentence. afleet's layout makes
  suppression unnecessary, but the principle survives as two rules: a newly arrived card never
  takes focus while the composer holds text, and a decision scrolled out of view is announced with
  a jump-to-decision pill rather than left to be discovered. Cards D-04, D-05.
- **Every decision card offers every settlement its request declares, and closing the card is
  always one of them.** Three cards violate this today (D-23 permission, D-34 question, D-38 URL
  elicitation). Its corollary, which afleet already got right once in `ConsentSheet`: **a window
  dismissal is never an answer** — canon says the same thing about the worktree dialog
  ("Cancelling is not `keep`", SPEC 47 §47.12.7).
- **Copy is where the built cards lose, not structure.** D-27, D-33, D-37 and D-40 all keep the
  right shape and drop the sentences — the refusal notice and its support link, elicitation's
  fifteen validation strings, the plan review warning, the withheld-content warnings. These are
  closed sets, verbatim in SPEC, and cost nothing to reproduce. A **copy-parity pass across the
  decision family** is a small, high-value backlog item spanning three lanes.
- **`initialize.supportedDialogKinds` is a one-line declaration that silently deletes surfaces.**
  afleet declares two kinds; canon forwards more. `mcp_elicitation_waiting` and
  `mcp_url_elicitation` are absent, so a URL elicitation degrades to no-dialog behaviour and nobody
  sees an error. Any lane proposing a dialog-backed surface must check that line first.
- **One shared surface serves five unforwarded gates.** D-42, D-44, D-45, D-46 and D-48 are all
  "a strip above the timeline stating a refusal or a degradation, a second line stating the
  consequence, and one action opening either a sheet (afleet can show the evidence) or a Terminal
  pane (only Claude Code can act)". afleet has built two independently and a third path bypasses
  `App/Consent` entirely. One component, five callers. And they come in **two registers** that must
  not be confused: trust and managed settings *refuse to run*; external includes and `dialogExpiry`
  *silently degrade*.
- **Canon prefers recovery to prevention, and afleet keeps inheriting the gate without the
  recovery.** `/clear` has no dialog because dropped prompts go to history; kill-agents clears the
  queue but writes the commands to history; `/logout` asks nothing because re-login is cheap. Where
  afleet adds a confirmation the terminal lacks — correctly, in D-58 and D-61 — it should carry the
  recovery sentence too, or the GUI is strictly more frightening and no safer.
- **Every config hint is a button afleet already has somewhere.** Canon ends its stanzas with
  `/permissions to update rules`, `settings.json to update hooks`, ` · /permissions`. A GUI should
  replace each with a route into its own editor; tui-parity says so explicitly. This is the cheapest
  recurring `[exceeds]` in the lane and it depends on lanes E and F owning those editors.

## Spec defects

**SPEC 263.**

- **24.14.2 has a corrupted kind name.** The table lists `permissionJXbfetch`; the build declares
  `permission_webfetch` at the very site the table cites (`cli.pretty.js:370569`).
- **41.22.1's heading does not match its content.** It is titled "The lazy dialog registry" but
  documents `qme`, the 74-entry registry of *slash commands that mount JSX*. The dialog-**kind**
  registry is `fk`, and it appears a section later under §41.22.6. A reader navigating by section
  number for "the dialog kinds" lands on the wrong object.
- **41.22.6 counts `fk` at 41 runtime entries and enumerates only the six that carry a `layout`.**
  The other thirty-five appear nowhere in SPEC 41. D-09 resolves all forty-one from the build.
- **There is no dialog-kind index anywhere in the library, and five kinds are absent entirely.**
  A `grep -rl` over the whole SPEC directory returns nothing for `computer_use_approval`,
  `cloud_sync_offline`, `cloud_sync_consent`, `peer_inbound_approval` or `auto_mode_setup_review`,
  all present in the binary (`cli.pretty.js:33155`, `:167266`, `:222630`, `:497037`, `:518604`).
- **24.17.4 reasons about the wrong version.** Inside the 2.1.263 library it concludes that a check
  "does not correspond to any live check in 2.1.257", leaving the bypass containment check's 2.1.263
  status unstated.
- **21 §7.5 says an empty keep-planning submission is a no-op.** Implementation contact found an
  empty Enter routes through `onCancel` and denies exactly like Esc
  (`CC-to-SDK/docs/parity/tui-ux.md`, plan-mode approval row).
- **22 and 37 name call sites whose copy is quoted nowhere:** `goal_proposal`'s descriptor is
  verified (`cli.pretty.js:161590`) but its title and options are not in SPEC 22, and
  `cloud_sync_consent`'s rendered text is in neither SPEC 37 §37.6 nor the binary excerpt the
  chapter quotes.

**tui-parity.**

- **Finding 19 undercounts and under-lists.** It says "the 9 `permission_*` kinds"; SPEC 24.14.2
  declares twelve and `fk` carries eleven plus `permission_workflow` via a spread. Its "every other
  kind" enumeration omits eight registered kinds: `left_arrow_confirm`, `cost_threshold`,
  `resume_return`, `it2_setup`, `fullscreen_upsell`, `auto_default_nudge`, `effort_medium_nudge`,
  `ultraplan_choice`.
- **Finding 19 and §5 disagree about the Slack-connect kinds.** Finding 19 names them as forwarded;
  §5's `initialize` recommendation lists only `refusal_fallback_prompt` and
  `fable_overage_consent_prompt`, and no area row covers the Slack kinds. One of the two is
  incomplete.
- **The §21/12 table has no row for extended questions** (SPEC 21 §12.13 — `kind`, `placeholder`,
  `min`/`max`/`step`, `defaultValue`, `unit`), even though the gate turns on for exactly afleet's
  class of host (`sdk-*`, `local-agent`, `remote`). The inventory is silent where it matters most.

**afleet specs and code.**

- **`ManagedSettingsReader.isPending` can never match** — a real bug, not a spec gap
  (`FleetKit/Sources/FleetSessions/Preconditions/ManagedSettingsReader.swift`). It SHA-256s the raw
  bytes of `remote-settings.json` and looks for a top-level `approvedHash`; canon hashes a canonical
  string of four *extracted* fields stored at `records[<orgUuid>].dangerousSettingsHash`
  (SPEC 03 §15.8, SPEC 48 §2.9.4). Any managed deployment reads "pending" forever and the channel
  never spawns, even after approval. It also skips canon's `j5()` predicate, so a payload with
  nothing dangerous in it also blocks. The file calls the record shape an unrecorded unknown;
  SPEC 48 §2.9.4 records it fully.
- **`DialogDeadline.standard` passes `dialogExpiry: nil`** (`App/Decisions/DialogCardView.swift:44`),
  so every dialog card states five minutes regardless of the session's setting. The value is on
  `get_settings.effective`, which §8.6 already polls.
- **`PermissionCardView.unstatedDenial` sends one sentence of a three-sentence constant** (D-24),
  dropping the instruction that tells a denied model to stop.
- **C6.3 §D6 mandates `interrupt: false` for every denial.** A bare plan rejection must interrupt to
  match the terminal's turn-ending behaviour; `App/Decisions/DecisionAnswerMapping.swift` follows the
  rule as written.
- **Root spec §8.4's dialog table says the refusal card renders "the guidance text and refusal
  category"**, omitting the composed safeguards notice and support link that are canon's actual body
  (SPEC 06 §20.3). The built card follows the spec, so the defect propagated into shipped copy.
- **Root spec §8.4 is silent on card expiry** (D-02), although `FleetQuitTermination.isBusy` already
  treats a `.waiting` card as busy — the one place afleet does model a pending card's liveness.

**This lane's task prompt.** Three of its givens are not canon at 2.1.263 and are corrected in
place: `ctrl+e explain` (D-22), the option label "no, tell Claude what to do differently" (D-24),
and the workspace-trust question `Do you trust the files in this folder` — the real copy is
`Quick safety check: Is this a project you created or one you trust? …` under the title
`Accessing workspace:` with buttons `Yes, I trust this folder` / `No, exit`
(`cli.pretty.js:584071`, `:584074`, `:584090`), and the `.mcp.json` row is `Use this MCP server`
(`:290079`). D-42 and D-44 carry the corrections.

**Verification gaps, flagged rather than asserted.** The `Other` row's placeholder `Type something.`
is stated as a literal in both SPEC 21 §12.7 and the tui-parity area file but was not resolved in
the build (the label `Other` is verified at `cli.pretty.js:517646`). `left_arrow_confirm`'s opening
chord is documented nowhere — SPEC 42 records only its telemetry — so D-62's reading of it as the
left-arrow / send-to-background gesture is `unverified`.
