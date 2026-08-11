# QA Sprint 1 — triage

Controller pass over the six QA agents' 97 findings (`docs/parity/qa-findings/findings-qa{1..6}-*.jsonl`),
dedup'd, adjudicated against the 2.1.220 canon (`~/claude-code-bundle/2.1.220/cli.pretty.js`), and ranked.

**This document is input to the normal brainstorm → spec → plan pipeline.** It contains no implementation
plans; §3's waves are candidate groupings, not commitments.

Corpus at a glance: 97 findings · 3 P1-broken, 25 P2-wrong, 39 P3-missing, 30 P4-polish ·
52 defect, 34 gap, 11 divergence-question · 13 flagged `"version-drift?": true`.
Twenty findings merge into an existing cluster below, nine are recorded parity passes (§5), leaving
**68 worklist rows**.

---

## 1 — Dedup map

Clusters where several findings are one underlying defect. The canonical id is the one an implementer
should own; members are the other observations of the same root and should be closed by the same change.

### C1 · Width-change repaint — no clear-and-full-repaint on `SIGWINCH`
- **Canonical: `qa2-08`** (P1) — composer/footer chrome is never re-rendered on a width change: shrink
  duplicates the composer block and leaves hard-wrapped remainder rules; grow leaves rules at the old
  narrower width; stale rules accumulate the entire resize history; returning to the launch geometry does
  not clear them. Fails 15/15 matrix cells; claude passes 15/15.
- Members:
  - `qa2-01` — QA2-SEED-1 reproduced and generalized (the 120×40 → 80×24 seed case, plus the new fact that
    resizing *back* does **not** restore a correct frame, contradicting the seed note).
  - `qa2-09` (P1) — the same renderer mid-stream: two different elapsed-time spinners visible at once,
    composer painted up to 3×, `esc to interrupt` three times in one frame. Self-heals at end of turn.
  - `qa2-10` (P2, resize half only) — a stale narrow copy of the `/model` picker above the live one.
- **Fix hint, from the fleet's own evidence:** `qa2-11` records that the ctrl+o pager's **close path already
  does** a clear-and-full-repaint — after opening and closing the pager, `composer_blocks=1` and
  `stale_rules=[]`. Open+close is a working manual workaround. Wiring that same clear into the width-change
  path is the suspected single fix for `qa2-08`, `qa2-09` and `qa2-10`'s resize half.
- **Split out of `qa2-10`:** its second observation — at 60×15 ccx renders all four model rows and lets the
  dialog header scroll off, where claude clips the list and shows a `↓` more-indicator — is **not** a resize
  defect. It is list windowing; it joins **C9**.

### C1b · Forced repaint on state reset (same missing primitive, different trigger)
- **Canonical: `qa5-01`** (P2) — `/clear` leaves a completely blank 120×40 pane, no banner, no composer, no
  footer, no scrollback, until the next keystroke. Process alive. Same missing "rebuild state, then force a
  full repaint" step as C1, reached from a different trigger. Kept separate from C1 because the trigger and
  the owning handler differ; expect the fix to share a primitive.

### C2 · Rewind replays the untrimmed transcript — confirmed independently by two agents
- **Canonical: `qa5-05`** (P2) — after a rewind the replay shows ONE/TWO/THREE when only ONE survives.
- Member: `qa4-11` — same defect, independently reproduced with different markers.
- **Both agents verified the trim itself is real:** the model context IS correctly trimmed (`qa5-05` probed
  it — the model no longer knows about the discarded turns; `/export` writes a correctly trimmed file;
  `qa4-11` probed it the same way and got the same answer). **The display replay alone is wrong** — it is
  fed the pre-rewind transcript list instead of the trimmed one. This is the highest-confidence root cause
  in the corpus: two agents, two sessions, same conclusion.

### C3 · Rewind confirm panel is missing both Summarize options
- **Canonical: `qa4-09`** (P3) — ccx offers 2 rows (Restore conversation / Never mind); upstream offers 4.
- Member: `qa5-06` — exact duplicate, independently observed.
- Grounding note (beyond both findings): the bundle shows upstream offers **more than four** when code
  changes exist — `Restore code and conversation` / `Restore conversation` / `Restore code` is the
  three-way head of the list (L487070). Both agents only ever saw the no-code-change variant.

### C4 · Feedback branches fire the decision without collecting the feedback
- **Canonical: `qa3-04`** (P2) — `No, and tell Claude what to do differently` denies immediately; the user
  is never prompted for the promised text.
- Member: `qa3-18` (P2) — the plan modal's `Tell Claude what to change` rejects the plan immediately and the
  model resumes streaming, with the same "the user never got to say what to change" symptom.
- Grounding: upstream implements both as `type: "input"` rows with placeholders, not select rows
  (L504858/L504874, L505627/L505650, L506280/L506294, and for the plan modal L500713). The shape ccx is
  missing is the *input row*, not the branch.

### C5 · ccx launches in `auto` permission mode
- **Canonical: `qa3-03`** (P1) — `git init` and `rm <file>` run with no consult where Claude Code gates
  both. **This is the user-visible harm and the top of the worklist.**
- Members:
  - `qa3-01` (P2) — the root cause: ccx's launch permission mode is `auto`, claude's is manual/default.
  - `qa3-15` (P4) — the shift+tab ladder has the same four modes in the same order; the only difference is
    the entry point. Same fact, no separate work.
- Note for the implementer: `qa3-03` observes ccx's auto classifier gating the harmless `touch` while
  allowing the destructive `rm`. Changing the launch default removes the exposure; it does not by itself
  explain the classifier's ordering, which is worth a look while in there.

### C6 · The welcome banner is a static string that disagrees with live state
- **Canonical: `qa4-02`** (P2) — the `/model` picker's `Default (recommended)` row advertises Sonnet 5 while
  ccx actually runs `claude-opus-5`; the banner stays frozen at the literal `(default)`.
- Members:
  - `qa3-02` (P2) — banner says `mode default`, footer says `mode auto`, in the same frame. Behaviour
    matches the footer.
  - `qa6-14` (P3) — banner shows the model as the literal string `(default)` with no display name and no
    auth provider, while the same frame's status bar resolves it to `claude-opus-5`.
- `qa6-14` carries an independent F7 sub-gap that rides along and is **not** covered by fixing the banner
  binding: no version in the box header, and no `What's new` / changelog block at all.

### C7 · No per-turn ghost-text follow-up suggestion
- **Canonical: `qa6-07`** (P3) — claude pre-fills the composer with a dim, model-generated, context-aware
  follow-up after every turn; ccx returns to a static rotating placeholder.
- Member: `qa1-06` (P3) — the same gap, observed from the composer side, with three concrete upstream
  examples (`count from 41 to 80`, `Never mind, wrong directory`, `Try "fix typecheck errors"`).

### C8 · Session handle is not populated for the foreground REPL
- **Canonical: `qa5-03`** (P2) — `/rename` and `/tag` answer `no session yet — send a first prompt` after
  three completed turns, while the roster file on disk holds the session id at that same moment.
- Member: `qa5-04` (P2) — Esc-Esc rewind has no anchors at all after `/clear`, despite four completed turns.
- QA-5 attributes both to the same handle reset; the suspects field names the fleet/detachable session
  handle that a foreground REPL never populates.

### C9 · Lists have no windowing or overflow affordance
- **Canonical: `qa4-10`** (P3) — the rewind picker draws every anchor at once, no `↑ more above` /
  `↓ more below`, so a long conversation has no visible overflow handling.
- Members:
  - `qa2-10b` (split from `qa2-10`) — the `/model` picker overflows its box at 60×15 and lets the header
    scroll off, where claude clips and shows `↓`.
  - **Standing remainder** (`docs/parity/tui-ux.md:1045`) — `pageup`/`pagedown`/`home`/`end` are dead in
    `SettingsDialog` and `PermissionsDialog`; both push the `Settings` context, which binds no paging or
    jump keys and swallows the fallthrough. Recorded there as four lines in `bindings.ts` plus suite re-runs.
- The windowing primitive itself is IN-220 (`(more above)` / `(more below)` at L396412/L396420).

### C10 · Composer motion keys
- **Canonical: `qa1-01`** (P2) — Home and End are both no-ops.
- Members: `qa1-02` (P2, ctrl+left / ctrl+right are unbound — alt+arrows do work), `qa1-03` (P2,
  word-forward lands at the end of the current word where claude lands at the start of the next).
- Three observations, one surface (the keymap table plus the word-motion helper). Sized and owned together.

### C11 · Ctrl+C on a non-empty draft
- **Canonical: `qa1-04`** (P2) — claude clears the draft and stays alive; ccx keeps the draft and arms exit,
  so a second Ctrl+C quits and loses it.
- Member: `qa6-08` (P4) — the same inverted behaviour, plus two independent chrome sub-findings that ride
  along: the exit-arm hint is an *added fourth row* in ccx (claude replaces the footer in place), and it
  persists for seconds where claude flashes it for ~250–500 ms.

### C12 · The footer advertises `Esc clear`, which does nothing
- **Canonical: `qa1-05`** (P2) — a single Escape never clears the draft, even after 3 s; two Escapes
  back-to-back do. The footer claims `Esc clear` the whole time. Suspected root: a lone ESC is held for a
  possible CSI prefix and then dropped rather than dispatched on timeout.
- Members: `qa4-12` (P4, same false advertisement after a rewind, where it had already caused a real
  incident — a new prompt silently concatenated onto the restored draft and was submitted as one message),
  `qa6-10` (P3, the `Esc clear` string is what ccx's hint row 2 collapses to while typing).

### C13 · Footer architecture
- **Canonical: `qa6-01`** (P3) — claude's footer is ONE row with a right-aligned second region; ccx stacks
  three left-aligned rows and has no right region at all.
- Member: `qa1-13` (P4) — transient hints (`Ctrl+Y to paste deleted text`, `search prompts:`) get their own
  full-width line in ccx and are inlined on claude's mode row, so ccx's composer block grows and shrinks by
  a line as you edit.
- `qa6-10`'s other half (typing collapses claude's whole footer to the mode chip; ccx only trims its hint
  rows) is the same architecture question and should be settled with it.

### C14 · Effort is entirely absent from ccx
- **Canonical: `qa4-01`** (P3) — no effort selector row in the `/model` picker, no effort chip anywhere.
- Member: `qa6-02` (P3) — the right-aligned ephemeral `● high · /effort` hint that decays after ~9–10 s.
- One absent capability, two surfaces.

---

## 2 — Ranked worklist

Ranked by user-visible impact. The two items the controller pinned to the top are pinned regardless of
tie-breaks. Domain uses the QA `surface` vocabulary. Effort is a rough guess: **S** = one focused change,
**M** = several files plus tests, **L** = a new subsystem or a design question first.

### Pinned to the top

| # | Id | Title | Sev | Domain | Suspect / fix hint | Effort |
|---|---|---|---|---|---|---|
| 1 | **qa3-03** (+`qa3-01`, `qa3-15`) | Destructive commands (`git init`, `rm <file>`) run with no consult | P1 | dialog | Downstream of ccx defaulting to `auto` permission mode at launch — change the launch default in `resolveOptions` / REPL defaults. Classifier ordering (gates `touch`, allows `rm`) is worth a second look while in there | S |
| 2 | **qa2-08** (+`qa2-01`, `qa2-09`, `qa2-10a`) | Composer/footer chrome never re-renders on a width change; stale rules accumulate; mid-stream resize multiplies the spinner | P1 | chrome | The ctrl+o pager's **close path already clears and full-repaints** (`qa2-11`) — wire that same clear into the width-change path | M |

### P2 — visibly wrong, ordered by how often a real user hits it

| # | Id | Title | Sev | Domain | Suspect / fix hint | Effort |
|---|---|---|---|---|---|---|
| 3 | qa5-01 | `/clear` leaves a completely blank pane until the next keystroke | P2 | session | Same missing forced-full-repaint as #2, different trigger; clear handler builds new-session state but never repaints | S |
| 4 | qa1-04 (+`qa6-08`) | Ctrl+C with a draft keeps the draft and arms exit instead of clearing it | P2 | composer | Ctrl+C handler should clear a non-empty composer before arming exit | S |
| 5 | qa1-05 (+`qa4-12`, `qa6-10`) | Footer advertises `Esc clear`; a single Escape does nothing | P2 | composer | Raw-stdin ESC disambiguation: a lone ESC is held for a possible CSI prefix and dropped rather than dispatched on timeout. Has already caused a real mis-submission (`qa4-12`) | S |
| 6 | qa1-01 (+`qa1-02`, `qa1-03`) | Home/End unbound; ctrl+left/right unbound; word-forward lands one token short | P2 | composer | Keymap table has no `ESC[H`/`ESC[F`/`ESC[1~`/`ESC[4~` or `ESC[1;5C/D`; `nextWordBoundary` uses emacs end-of-word semantics | S |
| 7 | qa6-05 | On an unreachable network ccx shows NO error — spinner is indistinguishable from a slow turn for 72 s+ | P2 | chrome | No transport-error channel into the live turn (`TurnSpinner.tsx`, `useChat.ts`). Upstream shows a typed error, a live retry countdown and an attempt counter within ~4 s | M |
| 8 | qa5-05 (+`qa4-11`) | Rewind replays the UNTRIMMED transcript — display shows turns the model no longer has | P2 | transcript | Confirmed by two agents. Context trim is correct; the replay is fed the pre-rewind transcript list instead of the trimmed one | M |
| 9 | qa3-04 (+`qa3-18`) | Deny-with-feedback and plan-reject-with-feedback fire the decision without collecting the text | P2 | dialog | Upstream renders these as `type:"input"` rows with placeholders, not select rows | M |
| 10 | qa2-03 | Edit/Update diff bodies render as flat unhighlighted text; claude tokenizes inside the diff | P2 | transcript | Diff renderer emits plain rows; the code highlighter is never applied per diff line | M |
| 11 | qa2-12 | Composer is not bottom-anchored — the whole UI sits at the top with up to 30 blank rows below | P2 | chrome | Always visible on any short transcript | M |
| 12 | qa4-02 (+`qa3-02`, `qa6-14`) | Banner/picker disagree with live state: picker says Sonnet 5, ccx runs opus-5; banner says `mode default`, footer says `mode auto` | P2 | picker | Model row descriptions copied verbatim from upstream without re-pointing "Default" at ccx's own default; banner is static where the status bar is live | S |
| 13 | qa5-03 (+`qa5-04`) | `/rename` and `/tag` say "no session yet" after completed turns; rewind has no anchors after `/clear` | P2 | session | Handlers read a fleet/detachable session handle a foreground REPL never populates | M |
| 14 | qa3-16 | Plan-approval modal is missing `Ready to code?`, the plan frame, the plan file path and ctrl+g | P2 | dialog | **Suspected (verify, do not assume):** a wire kind-classification miss — the decision arrives as a generic permission rather than `kind: plan`, so `PlanDialog` never mounts. If that holds, one classification fix restores the furniture; if not, the modal needs building | M |
| 15 | qa3-17 | Plan option 1 grants `acceptEdits` where upstream grants `auto` — same keystroke, different permission rules | P2 | dialog | Trust-relevant: upstream's grant also covers Bash, not just edits | S |
| 16 | qa5-10 | `/cost` undercounts by orders of magnitude — cache tokens not counted at all | P2 | panel | Cost accumulator reads only uncached input/output token fields | S |
| 17 | qa5-14 | `--resume` rejects the 8-char short id that ccx itself prints everywhere | P2 | session | ccx prints short ids in the detachable banner and the rewind divider; the id a user copies is the one `--resume` refuses. Falls through to a fresh REPL silently | S |
| 18 | qa4-07 | `/resume` preview shows a two-line excerpt instead of the session transcript | P2 | picker | Slash-command entries omitted entirely; message count counts only text turns (2 vs upstream's 6 for the same session) | M |
| 19 | qa6-09 | Mode chip prints raw camelCase enums, no ⏸/⏵⏵ glyph, and cycles from a different home state | P2 | chrome | `ChatStatusBar.tsx:34-40`, `cycleMode` in `useChat.ts`. Home-state suppression rule already matches | S |
| 20 | qa5-02 | Footer still shows the pre-clear context percentage right after `/clear` | P4→P2 in practice | session | Filed P4; listed here because it sits on the `/clear` path with #3 and is one line | S |

### P3 — upstream capability absent, grouped by feature

**Permissions & dialogs**

| Id | Title | Sev | Domain | Note | Effort |
|---|---|---|---|---|---|
| qa3-05 | Consult dialogs have no `Tab to amend` / `ctrl+e to explain`; Tab does nothing on the Yes row | P3 | dialog | Pairs with #9 — the amend affordance and the input row are the same mechanism | M |
| qa3-13 | No explainer when entering auto mode; upstream writes a four-line safety notice into the transcript | P3 | transcript | Trust-relevant copy, verbatim in the bundle | S |
| qa3-11 | `/permissions` has no search box; `Recently denied` lists user denials, contradicting its own caption | P3 | panel | The caption ccx already ships says "denied by the auto mode classifier" — the list contents contradict it | M |
| qa3-14 | No bypass-permissions mode; `--dangerously-skip-permissions` is rejected, so the consent gate does not exist | P3 | chrome | Deliberate-or-not is a product question, not just a gap | M |
| qa3-19 | AskUserQuestion has no question tab bar, no review-and-submit step, no `Chat about this` | P3 | dialog | Three separate sub-surfaces; the review screen is the largest | L |
| qa3-07 | Create-file dialog shows the raw body; upstream frames it as a numbered diff between `╌╌╌` rules | P4 | dialog | | S |
| qa3-08 | Don't-ask-again suggestion row is ungrammatical and conflates a directory grant with a command rule | P4 | dialog | Upstream never puts both in one row | S |
| qa3-12 | `/permissions` omits `←/→ to switch` from the footer on the first tab, though the key works | P4 | panel | The hint appears only after you have already discovered the key | S |
| qa3-06 | Amended deny label has a double space | P4 | dialog | | S |

**Rewind & session lifecycle**

| Id | Title | Sev | Domain | Note | Effort |
|---|---|---|---|---|---|
| qa4-09 (+`qa5-06`) | Rewind confirm offers 2 options; upstream offers 4 (both Summarize variants missing) | P3 | dialog | Bundle also shows a `Restore code` / `Restore code and conversation` head neither agent saw | M |
| qa4-10 (+`qa2-10b`, standing remainder) | Lists have no windowing or overflow affordance | P3 | picker | Windowing primitive exists upstream; `SettingsDialog`/`PermissionsDialog` also bind no paging keys | M |
| qa5-08 | No busy state during `/compact` — no progress bar, no `esc to interrupt`, composer looks idle | P3 | chrome | Upstream shows a 40-cell bar with a live percentage | M |
| qa5-13 | ccx does not accept `--continue` | P3 | session | | S |
| qa5-15 | A remote client's user prompt is not echoed on the other attached client — replies appear with no visible question | P3 | session | ccx-only contract; symmetric in both directions. Assistant output, tool rows and results all mirror correctly | M |
| qa5-17 | `/copy` after an interrupted long response copies 5 chars | P3 | session | Not driven on claude this run — uncovered on the upstream side | S |
| qa5-07 | `/compact` leaves the "compacting…" spinner line permanently in the transcript next to the result | P4 | session | Upstream replaces it with `⎿ Compacted (ctrl+o to see full summary)` | S |
| qa4-04 | No `Switch model?` cache-invalidation confirmation when changing model mid-conversation | P3 | dialog | | S |
| qa4-06 | `/resume` has no project/branch/worktree scoping controls, no project group header, no size column | P3 | picker | **Correction to the standing remainder** — see §4's note; scoping is measured correct, the widen control is missing | M |
| qa4-08 | Cancelling `/resume` leaves a bare echo with no outcome line | P4 | picker | ccx prints dismissal lines for every other dialog | S |
| qa5-18 | Roster entries stay `state:"working"` while both sessions sit idle | P4 | session | ccx-only surface | S |
| qa5-16 | Detachable and attached clients drop the model chip and context chip from the footer | P4 | chrome | ccx-only surface | S |

**Panels (depth catalog)**

| Id | Title | Sev | Domain | Note | Effort |
|---|---|---|---|---|---|
| qa4-14 | `/settings` Config tab exposes 5 rows against upstream's ~31, and has no search box | P3 | panel | QA-4 captured the full upstream row list — usable as the spec input | L |
| qa5-09 | `/status` is a 5-line block with no session identity; upstream is a tabbed panel with id, name, version, auth source, diagnostics | P3 | panel | | M |
| qa5-11 | `/context` is a single line; upstream renders a block grid with per-bucket shares and a skills ledger | P3 | panel | | M |
| qa4-16 | `/help` General tab: wrong undo binding, two upstream entries missing, eight ccx-only entries upstream does not list | P3 | panel | See §4 — the undo-binding half is version drift, the rest is real | S |
| qa4-15 | `/theme` is missing 3 options, the checkmark, numbering and the syntax-theme control | P3 | picker | | M |
| qa5-12 | `/usage` unavailable under the OAuth token; upstream exposes a Usage tab under the same token | P3 | panel | Credential-scope handling, not drift — see §4 | M |
| qa4-13 | Todo panel has no ctrl+t footer hint (undiscoverable) and adds an extra in-progress subline | P3 | panel | Toggle itself works both ways | S |
| qa4-17 | No `←` agents view; ccx's ctrl+b opens a small Background panel instead | P3 | panel | QA-4 captured the full upstream session-manager layout | L |

**Composer & transcript**

| Id | Title | Sev | Domain | Note | Effort |
|---|---|---|---|---|---|
| qa6-07 (+`qa1-06`) | No per-turn ghost-text follow-up suggestion | P3 | chrome | Upstream is model-generated and context-aware; survives a Ctrl+C that clears a real draft | M |
| qa2-13 | No end-of-turn duration row (`✻ Worked for 4s`) — every claude turn is closed by one | P3 | transcript | Verb drawn from the same rotating vocabulary as the spinner | S |
| qa1-09 | `@` completion offers files only (fully recursive on the first keystroke); claude offers one level plus agents | P3 | composer | Narrowing and Tab-complete are already identical | M |
| qa1-12 | ccx never advertises an external editor; `ctrl+x ctrl+e` works but nothing mentions it | P3 | composer | | S |
| qa1-07 | ccx hides the hardware cursor and paints its own reverse-video caret; claude moves the real terminal cursor with correct double-width accounting | P3 | composer | Affects screen readers and terminal integrations, not just looks | M |
| qa2-05 | ctrl+o is a different interaction model: ccx opens a modal pager overlay, claude toggles the transcript in place | P3 | transcript | **Decision item, not a bug** — see §4; the in-place mode is IN-220 | L |
| qa2-06 | The pre-turn composer placeholder is committed to scrollback above the submitted prompt | P4 | transcript | | S |
| qa2-11 | Closing the ctrl+o pager leaves torn modal-border fragments in the scrollback | P4 | panel | The pager itself is the one resize-clean surface (§5) | S |
| qa1-08 | Bash mode renders a doubled `!` sigil in the composer and in recalled history | P4 | composer | Execution is correct; display-only | S |
| qa2-04 | Fenced-code highlighting mis-anchors: the span swallows leading indent and drops the function-name token | P4 | transcript | | S |
| qa1-11 | `/history` picker draws a 12-column preview pane inside a 118-column box | P4 | picker | ccx-only surface (no upstream `/history`); compared against ccx's own ctrl+r | S |
| qa1-14 | Picker action hints are lowercase where claude capitalizes the key names | P4 | picker | | S |
| qa4-03 | `/model` checked row is one column out of alignment — the ✔ pushes the description right | P4 | picker | Checkmark concatenated into the label instead of a reserved column | S |
| qa4-05 | Model confirmations use short aliases and are not rendered in the `⎿` result gutter | P4 | picker | | S |

**F7 chrome (grounded by QA-6's catalog)**

| Id | Title | Sev | Domain | Note | Effort |
|---|---|---|---|---|---|
| qa6-01 (+`qa1-13`) | Footer is three stacked left-aligned rows; claude's is one row with a right-aligned region | P3 | chrome | The architecture decision the rest of F7 hangs off | M |
| qa6-03 | No `statusLine` customization hook at all | P3 | chrome | QA-6 captured the **full stdin contract**, render slot, colouring, truncation and refresh cadence — the spec input is already written | L |
| qa6-12 | No `--version`, no `--help`, no doctor; unknown flags exit 2 with a bare one-line error | P3 | chrome | `harness/src/cli/args.ts:133` throws on any unrecognised leading-dash token | S |
| qa4-01 (+`qa6-02`) | No effort selector row in `/model`, no effort chip, no ephemeral effort hint | P3 | picker | | M |
| qa6-04 | ccx never sets the terminal title; claude sets `_ <turn summary>` and it persists | P3 | chrome | Same text as `statusLine`'s `session_name` | S |
| qa6-06 | Spinner parenthetical carries elapsed only; claude carries elapsed + output-token count + phase word, and the gerund rotates mid-turn | P4 | chrome | | S |
| qa6-13 | Context percentage: ccx shows it inline with built-in colour thresholds and an auto-compact warning; claude exposes it only via statusLine/slash commands | P3 | chrome | **Divergence, ccx-extra** — a keep-or-drop decision, not a defect | S |

### P4 — remaining polish

Everything at P4 not already listed above is carried inside its cluster row: `qa3-06`, `qa3-07`, `qa3-08`,
`qa3-12`, `qa4-03`, `qa4-05`, `qa4-08`, `qa4-12`, `qa5-02`, `qa5-07`, `qa5-16`, `qa5-18`, `qa6-06`,
`qa6-08`, `qa1-08`, `qa1-11`, `qa1-13`, `qa1-14`, `qa2-04`, `qa2-06`, `qa2-11`. Several are one-line copy or
padding changes and would batch efficiently into a single polish pass.

### Recorded, no ccx work

| Id | Why |
|---|---|
| qa2-07 | Upstream's own ctrl+o collapse leaves a duplicated half-drawn Update block in scrollback. Canon behaviour, recorded not filed. ccx's Esc-close leaves scrollback unchanged |
| qa1-15 | With `EDITOR` unset, claude blocks the whole REPL on a GUI editor that may never open and Ctrl+C exits the session; ccx falls back to vi. ccx's behaviour is better and the charter forbids filing that as a defect |
| qa2-02 | Mouse re-confirmed a non-axis on the terminal build (§5) |

---

## 3 — Wave proposal

Four candidate waves off the top of the worklist, plus one bucket deliberately left unwaved. Missions only —
these feed brainstorm → spec → plan, they are not plans.

### Wave R · Repaint & geometry — "one frame primitive owns every reset"
**Mission:** every path that invalidates the frame (width change, `/clear`, dialog close, stream end) goes
through one clear-and-full-repaint, and the composer anchors to the bottom of the pane.
**Ids (8):** `qa2-08` · `qa2-01` · `qa2-09` · `qa2-10` · `qa5-01` · `qa2-12` · `qa2-11` · `qa2-06`
**Why first:** contains one of the two P1s, and the fix hint is already proven — the pager close path does
the right thing today, so the work is wiring, not invention.

### Wave T · Trust & safety — "the user is asked, told, and heard"
**Mission:** ccx never runs a destructive command without asking, always collects the feedback it promises,
and never leaves a failure invisible.
**Ids (14):** `qa3-03` · `qa3-01` · `qa3-15` · `qa3-04` · `qa3-18` · `qa3-05` · `qa3-17` · `qa3-13` ·
`qa6-05` · `qa3-16` · `qa3-07` · `qa3-08` · `qa3-06` · `qa3-14`
**Why:** contains the other P1 and the highest-consequence P2 in the corpus (a session that looks healthy
for 72 seconds while the network is down). The plan-modal items ride along because `qa3-17` is a
permission-grant bug wearing a plan-modal costume.

### Wave S · Session truth — "what's on screen is what the model has"
**Mission:** the transcript, the session identity and the cost/context numbers all tell the truth after a
rewind, a `/clear`, a resume, or a compaction.
**Ids (16):** `qa5-05` · `qa4-11` · `qa5-03` · `qa5-04` · `qa4-09` · `qa5-06` · `qa4-10` · `qa5-10` ·
`qa5-14` · `qa5-13` · `qa5-02` · `qa5-07` · `qa5-08` · `qa4-04` · `qa4-06` · `qa4-08`
**Why:** the untrimmed rewind replay is the single highest-confidence defect in the corpus (two independent
confirmations, both with the trim itself verified correct), and it is a *correctness-of-display* bug —
exactly the class a user cannot detect and therefore trusts.

### Wave C · Chrome & composer ergonomics — "the F7 wave, now grounded"
**Mission:** settle the footer architecture, then fill it — using QA-6's captured upstream catalog instead
of a reverse-engineered guess.
**Ids (17):** `qa6-01` · `qa1-13` · `qa6-10` · `qa6-03` · `qa6-12` · `qa6-04` · `qa6-06` · `qa6-09` ·
`qa6-07` · `qa1-06` · `qa4-01` · `qa6-02` · `qa2-13` · `qa1-04` · `qa6-08` · `qa1-05` · `qa1-01` (+`qa1-02`,
`qa1-03`)
**Why:** `qa6-01` is a prerequisite decision — the one-row-plus-right-region shape determines where five
other findings land. The composer keys are folded in here because they are the highest-frequency P2s in the
corpus and share the keymap/hint surface. The `statusLine` contract (`qa6-03`) is the largest single item
and could split out if the wave gets too wide.

### Not yet waved · Panel depth
`qa4-14` · `qa4-15` · `qa4-16` · `qa4-17` · `qa5-09` · `qa5-11` · `qa5-12` · `qa4-13` · `qa3-11` · `qa3-12`
· `qa3-19` · `qa1-09` · `qa1-07` · `qa1-11` · `qa1-12` · `qa2-03` · `qa2-04` · `qa4-02` · `qa3-02` ·
`qa6-14` · `qa4-03` · `qa4-05` · `qa1-08` · `qa1-14` · `qa5-15` · `qa5-16` · `qa5-17` · `qa5-18` · `qa6-13`
· `qa2-05`

This is a large, coherent, mostly-P3 body (the settings/help/theme/status/context/permissions panels, the
agents view, AskUserQuestion) that deserves its own wave rather than being smuggled into one of the four
above. `qa4-02`'s banner cluster and `qa2-03`'s diff highlighting are the two P2s in here and could be
promoted into Wave C and Wave R respectively if either wave has room.

---

## 4 — Version-drift adjudications

Adjudicated against `~/claude-code-bundle/2.1.220/cli.pretty.js` (579,698 lines). The fleet drove 2.1.222
live; anything the bundle does not carry belongs to a future rebase, not this sprint.

### Flagged set

| Id | Claim under test | Verdict | Bundle citation |
|---|---|---|---|
| `qa3-05` | Consult-dialog `Tab to amend` and `ctrl+e to explain` | **IN-220** | Amend rows are `type:"input"` with placeholders `and tell Claude what to do next` / `and tell Claude what to do differently` — **L504858, L504874** (also L505627/L505650, L506280/L506294). The explain action is the keybinding `confirm:toggleExplanation` — **L183499**; its generator returns `riskLevel`/`explanation`/`reasoning` — **L504931**, with the `Low risk` string at **L505008** and the `explain_command` tool at **L504955** |
| `qa3-13` | Four-line auto-mode safety notice on entering auto mode | **IN-220** | Full string, verbatim including `Ideal for long-running tasks` and `Sessions are slightly more expensive` — **L547286**; shorter variants at **L454518** and **L547227** |
| `qa3-16` | Plan modal: `Ready to code?`, plan frame, plan-file path, ctrl+g | **IN-220** | `Ready to code?` — **L501111**; `Here is Claude's plan:` — **L501091**; footer `ctrl+g` + `edit in ${editor}` with the file path appended — **L501126**; the plans directory itself — **L370737** (`join(<claude dir>, "plans")`) and the `plansDirectory` setting — **L371061** |
| `qa3-19` | AskUserQuestion tab bar, review-and-submit screen, `Chat about this` | **IN-220** | `Chat about this` row — **L504112**; `Review your answers` — **L504194**; `Ready to submit your answers?` — **L504217**; `Submit answers` / `Cancel` confirm — **L504222**; per-question `Submit`/`Next` button — **L504153** |
| `qa4-01` | `/model` effort selector row and effort chip | **IN-220** | The row is built at **L441142**: `<glyph> <Level> effort (default)` plus `←/→ to adjust`, and the unsupported branch `Effort not supported for <model>`. The standalone effort dialog's `to adjust · to confirm · to cancel` hint — **L447278** |
| `qa4-09` | Rewind confirm `Summarize from here` / `Summarize up to here` | **IN-220** | Both labels — **L487071**; the code-aware head (`Restore code and conversation` / `Restore conversation` / `Restore code`) — **L487070**; `The code will be unchanged.` — **L487222** |
| `qa5-12` | `/usage` tab available under the OAuth token | **IN-220** | Usage tab — **L444333**; `defaultTab: "Usage"` route — **L482957**; the rate-limit buckets it renders — **L156612**, **L156664**. **This is a ccx credential-scope gap, not drift** |
| `qa6-02` | Right-aligned ephemeral `● high · /effort` hint decaying after ~9–10 s | **IN-220** | The ephemeral-hint mechanism with an explicit effort key and a 10-second timeout: `Nd({ key: "effort-level", kind: "feedback", …, timeoutMs: 1e4 })` — **L496132**. Sibling hints on the same system at **L395652**, **L489313**, **L491098**, **L495470** |
| `qa6-07` | Per-turn model-generated ghost-text follow-up suggestion | **IN-220** | `promptSuggestionEnabled` gate — **L235116**, **L235123**; the user-facing settings row `Prompt suggestions` — **L315485**. Note it is behind the `tengu_chomp_inflection` flag in 220, so it may not have been *visible* on every 220 install |
| `qa2-05` | ctrl+o is an in-place detailed-transcript toggle, not a modal pager | **IN-220** | Global binding `"ctrl+o": "app:toggleTranscript"` — **L186118**; the status line `Showing detailed transcript · <chord> to toggle · ↑↓ scroll · v to open in editor · ? for shortcuts` — **L547303**, **L547310**. The `ctrl+e to show all` tail QA-2 saw on 2.1.222 is **not** in that 220 string — the mode is IN-220, that one tail segment is POST-220 |
| `qa1-10` | `#` memory mode removed in 2.1.222 | **POST-220 (inverse — see note)** | The composer's mode resolver returns only `"prompt"` or `"bash"` — **L374525–L374537**; `mode === "bash"` / `mode === "prompt"` are the only two modes anywhere (**L494779**, **L501969**, **L549238**). No `#` composer mode exists in 220 either. **So this is not a 222 removal — ccx's `#` memory mode is a ccx-only surface with no upstream counterpart at our pinned version.** It is a keep-or-drop product decision, not parity work |
| `qa2-07` | claude's own ctrl+o toggle-off leaves a duplicated Update block | **UNRESOLVED** | Grepped: `app:toggleTranscript` (L186118), `Showing detailed transcript` (L547303/L547310), and the surrounding render region. A scrollback-repaint artifact is not groundable by string search — it is emergent rendering behaviour. Recorded as an upstream observation; no ccx action either way |
| `qa4-11` | claude's immediate post-rewind replay omits the rewound-away turns | **UNRESOLVED** | Grepped the rewind confirm surface (L487070, L487071, L487222) and the `(more above)`/`(more below)` windowing primitives (L396412, L396420); found the option set but nothing that decides *which* transcript the post-restore replay is fed. QA-4 itself filed at reduced confidence and noted the MARKER turns reappear in claude's live transcript a few dialogs later, so upstream's own trimmed replay may be transient. **This does not weaken `qa5-05`/`qa4-11`'s ccx-side finding** — ccx's replay showing turns the model has provably forgotten is wrong on its own terms |

### Additional items the controller checked (not flagged by the fleet)

| Id | Claim | Verdict | Citation |
|---|---|---|---|
| `qa4-16` | claude's `/help` shows `ctrl + shift + _` for undo | **POST-220** | 2.1.220's keymap binds undo to plain `ctrl+_` — **L459483** (`pA("chat:undo","Chat","ctrl+_")`), with the Global table at **L186118**. ccx's `ctrl + _` matches the canon; the `shift` is a 222 change. **The rest of `qa4-16` stands:** `/btw for side question` — **L459504** — and the image-paste hint — **L495951** — are both IN-220 and both missing from ccx |
| `qa3-04` | The parked deny-feedback state | **IN-220** | `Interrupted · What should Claude do instead?` — **L422225** |
| `qa3-11` | `/permissions` search box, and `Recently denied` showing classifier denials only | **IN-220** | The `⌕`-prefixed search component mounted inside the permissions dialog — **L472577** (component definition, default placeholder `Search…` and `⌕` prefix, at **L435311**). Both captions ccx already ships are verbatim upstream — **L472262**, **L472283**. `Add a new rule…` — **L472688** |
| `qa4-06` | `/resume` scoping controls | **IN-220** | `Ctrl+A` show all projects / only show current repo, `Ctrl+B` branch, `Ctrl+W` worktree — all three — **L476627** |
| `qa4-08` | `Resume cancelled` outcome line | **IN-220** | **L476806** |
| `qa4-14` | `/settings` search box | **IN-220** | `placeholder: "Search settings…"` — **L441977** region |
| `qa4-15` | `/theme` ANSI-only options, custom theme, syntax-theme control | **IN-220** | `Dark mode (ANSI colors only)` / `Light mode (ANSI colors only)` — **L440674**, **L442200**; `New custom theme…` — **L440681**; `Syntax theme:` line — **L440760** |
| `qa4-04` | `Switch model?` cache-invalidation confirm | **IN-220** | Title — **L447014**; body copy `…the full history gets re-read on your next message.` — **L447033** |
| `qa3-14` | Bypass-permissions consent gate | **IN-220** | `WARNING: Claude Code running in Bypass Permissions mode` — **L554075**; body — **L554070** |
| `qa2-13` | End-of-turn duration row | **IN-220** | Past-tense verb vocabulary `["Baked","Brewed","Churned","Cogitated","Cooked","Crunched","Sautéed","Worked"]` — **L428307**; the gerund vocabulary the spinner shares — **L406847** |
| `qa6-05` | Retry countdown with attempt counter | **IN-220** | `· Retrying in ${n}${unit} · attempt ${n}/${max}` — **L408007** |
| `qa5-08` | `Compacting conversation…` progress surface | **IN-220** | **L407347**, **L497331**; the `(ctrl+o to see full summary)` result hint — **L314675** |
| `qa1-09` | `@` completion offering agents | **IN-220** | `${agentType} (agent)` completion rows with `whenToUse` descriptions — **L490288** |
| `qa4-17` | `← for agents` footer affordance | **IN-220** | **L493235** |
| `qa6-03` | `statusLine` hook | **IN-220** | Settings schema — **L41379**, **L42035**; the documented stdin payload — **L189024**; the payload builder carrying `session_name`, `effort`, `context_window`, `exceeds_200k_tokens`, `rate_limits` — **L484846** |
| `qa6-04` | Terminal title from the turn summary | **IN-220** | `terminalTitleFromRename` setting wired to the session rename — **L547702** |
| `qa4-10` | List windowing indicators | **IN-220** | `(more above)` / `(more below)` primitives — **L396420**, **L396412**; a consuming call site — **L441980** |
| `qa1-12` | External-editor hint on the composer | **IN-220** | The `external-editor-hint` ephemeral hint with `chat:externalEditor` fallback `ctrl+g` — **L489313**; the shortcut listing — **L459610** |

### Future-rebase parking lot (excluded from every wave)

| Id / clause | Verdict | Reason |
|---|---|---|
| `qa2-05`'s `ctrl+e to show all` footer segment | POST-220 | The detailed-transcript mode is IN-220 (L547303) but that tail segment is not in the 220 string. Build the mode against the 220 footer; revisit the segment on rebase |
| `qa4-16`'s `ctrl + shift + _` undo binding | POST-220 | 220 binds plain `ctrl+_` (L459483). ccx already matches the canon — **do not "fix" this** |
| `qa1-10`'s `#` memory mode | POST-220 (inverse) | Absent from 220 *and* 222. Not a rebase item — a ccx-only surface awaiting a keep-or-drop decision |
| `qa2-07` | UNRESOLVED, parked | Upstream rendering artifact; no ccx-side work implied in either direction |
| `qa4-11`'s upstream-side claim | UNRESOLVED, parked | The ccx-side defect it confirms (`qa5-05`) is **not** parked — it is Wave S's lead item |

### One correction to the standing remainder

`docs/parity/tui-ux.md:1118` records `listSessions()` as **called unscoped**, so that the `/resume` picker
lists every project's sessions. **QA-4 measured the opposite and showed its work:** a session written to
`~/.claude/projects/-private-tmp-qa4-root-proj-ccx2/…jsonl` (verified on disk) does **not** appear when the
picker is opened from `proj-ccx`. Scoping is correct today. The real gap is that there is **no way to widen
it** — upstream's `Ctrl+A` / `Ctrl+B` / `Ctrl+W` scope toggles (L476627) are absent, so other projects'
sessions are unreachable from the picker. That is `qa4-06`, and it reframes the standing note from "missing
filter" to "missing widen control". The note should be amended when Wave S is specced.

The other two standing items are unchanged and were not exercised this sprint: `PermissionsDialog.tsx:173-174`
reading raw arrow keys (not observed by QA-3, who only reached the footer-hint and search-box gaps), and the
dead paging keys in `SettingsDialog`/`PermissionsDialog` (folded into cluster **C9**).

---

## 5 — Parity passes worth pinning

Behaviours the fleet drove and found **already at parity**. Listing them so the next re-score can count them
and so regression tests have something specific to cite. Each is two-sided evidence unless marked otherwise.

1. **Tool folds and long-output folds are byte-identical** (`qa2-14`) — `⏺ Bash(seq 1 300 | sed …)` plus a
   3-line head and `… +297 lines (ctrl+o to expand)`; multi-read collapses to `Read 2 files (ctrl+o to
   expand)` on both. Only divergence: claude prints absolute paths inside `Read(...)` when expanded, ccx
   prints the basename.
2. **Mid-draft permission suppression and the idle reveal** (`qa3-10`) — the dim `Waiting for permission…`
   row while typing, the draft surviving intact, the full dialog replacing it after ~3 s idle, and the draft
   restored after answering. Identical on both sides.
3. **Don't-ask-again write-through and relaunch silence** (`qa3-09`) — ccx writes
   `.claude/settings.local.json` and the rule survives relaunch, matching claude's behaviour for the
   command-rule case. (Divergence recorded, not a failure: ccx persists only the command rule and drops the
   directory-access half of its own suggestion text.)
4. **The ctrl+o pager reflows correctly at every terminal size** (`qa2-11`) — the one resize-clean surface in
   ccx: borders exactly `pane_width`, footer text wraps, zero stale rules, zero overlong lines across the
   whole 120×40 → 60×15 → 80×24 → 160×40 → 120×40 sweep. This is the behaviour Wave R should generalize.
5. **The shift+tab permission ladder has the same four modes in the same order** (`qa3-15`) — the only
   difference is the entry point, which is `qa3-03`'s root cause, not a ladder defect.
6. **Height-only resizes are always clean** (`qa2-08` controls) — 120×24 → 120×40 and 80×40 → 80×15 both
   pass. Height is never the trigger; this pins the defect to the width path specifically.
7. **`/resume` project scoping is correct** (`qa4-06`, measured on disk) — cross-project sessions do not leak
   into the picker. See §4's correction.
8. **The mouse axis is closed on the terminal build** (`qa2-02`) — neither TUI requests any mouse-reporting
   mode (`any=0 btn=0 std=0 sgr=0 all=0 alt=0` on both), and injected SGR press/release, X10 press and wheel
   up/down are cleanly swallowed by both: nothing leaks as composer text, nothing scrolls, both stay alive.
9. **Neither TUI rings the terminal bell, and neither shows an unprompted toast** (`qa6-11`) — bell flag and
   activity flag both 0 across every turn completion, error and retry cycle over a ~60-minute session.
   *Caveat recorded by QA-6:* the notification channel was left at its default; a run that sets
   `preferredNotifChannel` would be needed to catalogue the bell/iTerm2 paths.
10. **`ctrl+x ctrl+e` external editor round-trips correctly** (`qa1-12`, `qa1-15`) — with `EDITOR=vi` both
    open vi in-terminal on a temp prompt file and return the edited text to the composer. The gap is only
    that ccx never advertises it (`qa1-12`).
11. **Kill ring and the paste-deleted-text hint work** (`qa1-13`, `qa6-08`) — ctrl+u fills the ring and
    `Ctrl+Y to paste deleted text` appears; the divergence is placement and duration, not function. The
    upstream hint is the same copy on the same ephemeral system (bundle L395652).
12. **`alt+left` / `alt+right` word motion works** (`qa1-02`, explicitly noted) — the failure is confined to
    the ctrl-modified forms.
13. **Bash mode executes correctly** (`qa1-08`) — the transcript shows the real command and its real output;
    `qa1-08` is display-only.
14. **`@` completion narrowing and Tab-complete are identical** (`qa1-09`) — typing `bet` narrows to
    `src/utils/beta.ts` and Tab completes the same way on both.
15. **`ctrl+t` toggles the todo panel correctly both ways** (`qa4-13`) — the gap is the missing footer hint.
16. **`/settings` tabs all exist and cycle** with Tab and Right, and `/usage` degrades **honestly** rather
    than silently (`qa4-14`) — `plan usage not available under this credential (claude setup-token has no
    profile scope)`.
17. **Paste chips and `alt`/`option`+backspace** — pass by *absence of a finding*. Both were named seeds in
    QA-1's charter (paste → chips; alt+backspace "just fixed, verify live") and neither produced an entry.
    Recorded honestly as a weaker signal than the two-sided items above; a regression test should assert
    them directly rather than cite this line.

---

## 6 — Fleet meta

Six QA agents drove ccx and the installed Claude Code CLI side by side for roughly an hour each and filed
**97 findings** — 3 P1-broken, 25 P2-wrong, 39 P3-missing, 30 P4-polish, spread across chrome (25), dialogs
(13), composer (12), pickers (12), session (12), transcript (11), panels (11) and the one mouse
re-confirmation. **All six isolation assertions passed**: every agent ran under a fresh `HOME` with a
seeded onboarding and a scratch project, and every report closed with the real `~/.claude/ccx/prefs.json`
mtime unchanged before versus after — the leaked-theme incident that put that rule in the charter did not
recur. Token spend was roughly **40 ccx turns plus 41 claude turns** across the whole fleet, most of them
cheap deterministic `Reply with exactly: X` probes, with real turns spent only where the surface under test
needed them (streaming, tool folds, permission consults, the resize matrices which cost nothing once content
was staged). One hazard is worth carrying into any future fleet: **QA-1 typed `/history` on claude, which
has no such command; it fuzzy-matched to `/design-sync` and *ran it*.** An unrecognised slash command on
upstream is not a no-op — agents driving claude should assume a mistyped or ccx-only command may execute
something else entirely, and should verify the command exists on the side they are driving before sending it.
