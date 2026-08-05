# QA Sprint Waves — umbrella sprint spec (Waves T · R · S · C)

> **Living document.** §9 Progress, §10 Decision Log, §12 Surprises & Discoveries and §17 Retrospective
> stay current for the life of the sprint; every post-v1 edit lands in Revision Notes with a reason.
> Acceptance is observable behavior only. This umbrella carries **no implementation plans** — each wave
> derives its own feature spec + plan (the project's normal brainstorm → spec → plan → SDD pipeline) at
> dispatch time, from this document plus the triage.
>
> **Evidence sources.** The 97-finding QA corpus (`docs/parity/qa-findings/findings-qa{1..6}-*.jsonl`,
> commit 88e2122a3e; fleet of six agents driving ccx and the installed Claude Code side by side,
> 2026-08-06, charter `docs/parity/qa-sprint-1.md`, driver recipe `docs/parity/qa-driver.md`); the
> controller triage with dedup map and bundle adjudication (`docs/parity/qa-sprint-1-triage.md`,
> e5700ca34b); the owner's wave-selection message (2026-08-06: umbrella spec first, then Wave T).
>
> **Verification baseline.** All "current state" claims checked against `main` @ e5700ca34b. Canon is
> the 2.1.220 bundle (`~/claude-code-bundle/2.1.220/cli.pretty.js`); the fleet drove 2.1.222 live and
> every drift flag was adjudicated on the bundle (triage §4). Work lands on `main` per project git rules.
>
> **Sister documents.** Governing program spec: `2026-07-31-tui-clone-fidelity-design.md` (waves F0–F6
> shipped; this sprint interleaves with F7 — Wave C *is* F7, now grounded). Scorecard:
> `docs/parity/tui-ux.md`. The next milestone's reservation is §16 (panel-depth wave + rebase parking lot).

## §0 How to read this document

§5 points at the triage as the verification table and lists only the load-bearing corrections — read it
before building anything. §6 is the sprint's substance: four streams (waves), each cut into epics with
acceptance criteria. §13 explains why there is no issue board. §16 is what this sprint deliberately does
not do.

## §1 Purpose

When this sprint lands, the daily-driver experience of `ccx` stops diverging from Claude Code in the four
ways live use actually exposed:

- **The user is asked, told, and heard (Wave T).** A fresh `ccx` session never runs a destructive command
  without a consult; every "tell Claude what to do differently" affordance actually collects the text; a
  dead network surfaces a typed error with a retry countdown instead of an indistinguishable spinner.
- **The frame is always correct (Wave R).** Resizing the terminal — any direction, any moment, including
  mid-stream — produces the same clean reflow claude shows; `/clear` never leaves a blank pane; the
  composer sits at the bottom of the pane like upstream.
- **What's on screen is what the model has (Wave S).** After rewind, `/clear`, resume or compaction, the
  transcript, session identity, cost and context numbers all tell the truth.
- **The chrome speaks upstream's language (Wave C / F7).** One-row footer with a right-aligned region,
  statusLine hook, terminal title, live banner state, effort surfaces, and the composer keys a returning
  Claude Code user's fingers already know.

Final acceptance re-enacts these as behavior: the four wave-close TTY passes (isolated-HOME tmux, per the
driver recipe) plus a re-run of the QA scenarios that produced each wave's canonical findings, showing the
finding's repro no longer reproduces.

## §2 Sprint frame

| | |
|---|---|
| Goal | Close the QA Sprint 1 harvest: 2 P1s, ~25 P2s, the grounded P3 clusters, in four waves |
| Order | **T → R → S → C** (owner-selected; T first because safety posture outranks cosmetics) |
| Cadence | Each wave: feature spec → plan → subagent-driven execution → wave-close TTY pass → parity re-score → recurring QA sweep (§10 D6) |
| Team | Controller (this session) + opus implementation/review workers per SDD; codex-companion review at each wave close |
| Scope freeze | Nothing outside this document enters a wave; new discoveries go to §12 and the next sweep's triage |
| Prior milestone | F0–F6 declared closed (ledger); F6's "still open" remainder items are absorbed where §6 names them, otherwise stay in `tui-ux.md` |

## §3 Definition of done

- **Sprint gate (P0):** Wave T and Wave R epic acceptance criteria all pass — both P1s
  (`qa3-03` auto-mode exposure, `qa2-08` width repaint) dead, verified by re-running their exact QA repros
  in the isolated-TTY harness.
- Waves S and C complete their epics or explicitly roll unfinished P1-priority items into §9 at close.
- Each wave ends with: suites green (`npm run typecheck`, unit, tui), a keyed TTY pass for the wave's
  surfaces, `docs/parity/tui-ux.md` + `coverage.md` re-scored, ledger appended, memory updated.
- The recurring QA sweep has run at least once after a shipped wave and its delta triaged (§10 D6).

## §4 Context & orientation

A fresh joiner starts from `CC-to-SDK/CLAUDE.md` + `harness/CLAUDE.md` (module map), then:
`docs/parity/qa-sprint-1-triage.md` (the findings this sprint is made of),
`docs/parity/qa-driver.md` (how to drive either TUI in tmux without touching the real `~/.claude`),
`docs/parity/tui-ux.md` (scorecard + standing remainders). The TUI lives in `harness/src/tui/`
(ChatApp.tsx composition root, useChat.ts command/turn state, keys/ keymap, dialogs/pickers per F6);
the wire is `client/remote.ts` ⇄ `host/{ops,server,host}.ts`; permission flow is
`permissions/` + the six-kind dialog registry. Canon lookups: grep the 2.1.220 bundle, cite line numbers.

## §5 Verification table

**The table is `docs/parity/qa-sprint-1-triage.md`** — §1 dedup map (14 clusters), §2 ranked worklist,
§4 drift adjudications with bundle citations, §5 parity passes. Everything below is the delta this spec
adds on top of it; the note is never trusted past this section.

### §5.1 Confirmed bugs the sprint gate hangs on
- `[BUG]` **qa3-03 / C5** — ccx launches in `auto` permission mode; `git init` and `rm` ran unconsulted.
  P1, Wave T lead.
- `[BUG]` **qa2-08 / C1** — no clear-and-repaint on width change; stale chrome accumulates the whole
  resize history. P1, Wave R lead. Fix hint proven in-corpus: the ctrl+o pager close path already does the
  right thing (`qa2-11`, triage §5.4).
- `[BUG]` **qa5-05 + qa4-11 / C2** — rewind replays the untrimmed transcript while the model's context is
  provably trimmed. Two independent confirmations. Wave S lead.

### §5.2 Misreads & protective corrections (do NOT build these)
- `[MISREAD]` `tui-ux.md:1118` "listSessions() unscoped" — QA-4 measured scoping **correct**; the real gap
  is the missing widen controls (`Ctrl+A/B/W`, L476627). Reframed as `qa4-06`, Wave S. (Standing note
  amended at Wave S spec time.)
- `[MISREAD]`-class protective drift calls (triage §4): ccx's `ctrl+_` undo already matches 220 — the
  `ctrl+shift+_` binding is a 2.1.222 change, **do not chase it**; the `ctrl+e to show all` footer tail is
  POST-220; `#` memory mode is absent from 220 *and* 222 — a ccx-only surface awaiting keep-or-drop (§16).
- `[MISREAD?]` **owner testimony vs fleet evidence — click-to-expand.** The owner reports (twice, latest
  2026-08-06): *"click to expand is for general claude code cli, on any terminals."* The fleet's `qa2-02`
  found neither TUI requests any mouse-reporting mode and injected mouse bytes are swallowed. Both cannot
  be true as stated. Neither is trusted: **MOUSE-1** (§11) re-probes with folded content on screen,
  introspects modes *at that moment* (a conditional enable would be invisible to an idle-state check), and
  greps the bundle for mouse-enable emissions (`\x1b[?1000/1002/1003/1006h`). Until it lands, the mouse
  axis stays open, not closed.

### §5.3 Missing / partial
Carried per-epic in §6; the triage's §2 tables are the full inventory. One traceability catch made while
authoring this spec: **`qa4-07`** (`/resume` preview shows a two-line excerpt, P2, worklist #18) appears
in the ranked worklist but fell out of every wave list in triage §3 — it is hereby assigned to **EP-S6**.

## §6 Epic decomposition

Epic ids are `EP-<wave><n>`. Each epic cites its triage cluster/finding ids; the finding JSONL rows carry
the exact repros and frame evidence. Work-item tags: `(new)` / `(modify)`. Bundle citations are in triage
§4 unless inlined here.

---

### Stream T · Trust & safety — "the user is asked, told, and heard" (14 findings + 1 promoted decision)

#### EP-T1 · Launch permission posture (qa3-03, qa3-01, qa3-15, qa3-13) — P0
1. **Context:** QA-3: `git init` and `rm <file>` executed with no dialog on a fresh ccx; claude consults
   for both. Root cause `qa3-01`: ccx's launch mode is `auto`; claude's is manual/default.
2. **Decisions:** `[DECIDED-AUTO]` launch default becomes upstream's default (manual consults); `auto`
   stays reachable via the shift+tab ladder and flags. Alternative — keep `auto` and harden the
   classifier — rejected: the canon is the installed default build, and the classifier misordered
   (gated `touch`, allowed `rm`).
3. **Current state:** `[BUG]` default set in the REPL/host defaults path (`resolveOptions` /
   `cli/main.ts` — exact site pinned at Wave T spec time). Ladder itself is at parity (`qa3-15`,
   triage §5.5).
4. **Work items:** (modify) launch default → `default` mode; (new) four-line auto-mode safety notice
   written into the transcript on *entering* auto (verbatim L547286, incl. "Ideal for long-running
   tasks"/"Sessions are slightly more expensive"); (modify) while in there, examine the auto classifier's
   ordering as a recorded observation (fix only if the wave spec confirms a defect).
5. **Acceptance:** fresh isolated-HOME launch → `rm <file>` prompt produces a consult dialog before
   anything executes; footer/banner agree on the mode; shift+tab into auto prints the L547286 notice.
6. **Dependencies:** none; first epic of the sprint.

#### EP-T2 · Feedback is actually collected (qa3-04, qa3-18, qa3-05, qa3-06) — P0
1. **Context:** QA-3: "No, and tell Claude what to do differently" denies instantly — the promised text
   box never appears; same for the plan modal's "Tell Claude what to change".
2. **Decisions:** `[DECIDED-AUTO]` build these as upstream does: `type:"input"` rows with placeholders
   (L504858/L504874, L505627/L505650, L506280/L506294; plan modal L500713), not select rows — the F6
   `RLe` input-row primitive (empty-submit-cancels) already exists, this is wiring not invention.
   `ctrl+e` explain (`confirm:toggleExplanation`, L183499 + generator L504931) rides along only if the
   Wave T spec finds the SDK exposes enough to fill `riskLevel`/`explanation`; otherwise it defers to §16
   with a note.
3. **Current state:** `[PARTIAL]` — branches exist and fire; the input-collection half is missing. The
   parked deny-feedback state ("Interrupted · What should Claude do instead?", L422225) is `[NOT-BUILT]`.
4. **Work items:** (modify) deny-with-feedback and plan-feedback rows become input rows; (new) parked
   post-interrupt feedback state; (modify) `qa3-06` double-space in the amended deny label.
5. **Acceptance:** choosing either feedback row opens an inline input with upstream's placeholder; typed
   text reaches the model as the deny/keep-planning feedback; empty submit cancels per the RLe rule.
6. **Dependencies:** shares the dialog registry with EP-T3/EP-T6 — same-owner or sequenced.

#### EP-T3 · Plan dialog mounts live and grants correctly (qa3-16, qa3-17) — P0
1. **Context:** QA-3 live: plan approval arrived as a generic permission dialog — no `Ready to code?`, no
   plan frame, no file path, no ctrl+g — though F6's component tests all pass (they inject `kind:"plan"`).
   And option 1 grants `acceptEdits` where upstream grants `auto` (covers Bash too).
2. **Decisions:** `[DECIDED-AUTO]` diagnose before building: the suspect is a wire kind-classification
   miss (the decision never gets `kind:"plan"` on the live path). Verify with a live probe first; if the
   modal itself is sound, the fix is classification, not UI.
3. **Current state:** `[PARTIAL]` — PlanDialog built and component-tested (F6); live mount path `[BUG]`
   (suspected, unverified); grant mapping `[BUG]` (`acceptEdits` vs upstream `auto`).
4. **Work items:** (new) live probe/TTY repro pinning where the kind is lost; (modify) the classification
   or mount path; (modify) option-1 grant → upstream's semantics; (modify) restore `Ready to code?` /
   plan frame / file path / ctrl+g furniture live (L501111, L501091, L501126).
5. **Acceptance:** a live plan-mode session's approval dialog shows upstream's plan furniture; approving
   with option 1 leaves the session in the same permission posture upstream grants.
6. **Dependencies:** after EP-T1 (mode semantics must be settled before the grant mapping).

#### EP-T4 · Failure is visible (qa6-05) — P0
1. **Context:** QA-6: with the network unreachable, ccx showed a healthy-looking spinner for 72+ seconds.
   Upstream shows a typed error, live retry countdown and attempt counter within ~4 s
   (`· Retrying in ${n}${unit} · attempt ${n}/${max}`, L408007).
2. **Decisions:** `[DECIDED-AUTO]` probe-first (the A1 lesson): what the SDK actually emits headlessly on
   transport failure/retry is unknown — write the probe before designing the channel. The rendered shape
   follows the bundle regardless of which layer supplies the events.
3. **Current state:** `[NOT-BUILT]` — no transport-error channel into the live turn
   (`TurnSpinner.tsx`, `useChat.ts`).
4. **Work items:** (new) probe: SDK behavior on unreachable network mid-turn (events? throw? silence?);
   (new) error/retry channel host → wire → REPL; (modify) spinner region renders the typed error +
   countdown + attempt counter.
5. **Acceptance:** with networking cut mid-turn, ccx surfaces a visible typed error state within seconds,
   with retry progress; restoring the network resumes or fails the turn honestly.
6. **Dependencies:** independent; parallel-safe with EP-T2/T3.

#### EP-T5 · Bypass mode exists, gated by consent (qa3-14) — P1
1. **Context:** QA-3: `--dangerously-skip-permissions` is rejected outright; the consent gate upstream
   ships (WARNING dialog, L554075/L554070) has nothing to guard.
2. **Decisions:** `[DECIDED-AUTO]` build it — the program's canon is fidelity to the installed build, and
   the SDK's `bypassPermissions` mode is live-verified (memory: bypass silences the broker). Alternative —
   deliberately omit as a safety divergence — rejected: omission is itself a divergence and the consent
   gate is the safety mechanism.
3. **Current state:** `[NOT-BUILT]` (flag rejected at `cli/args.ts`).
4. **Work items:** (new) flag + consent dialog with upstream's verbatim warning copy; (modify) mode chip /
   ladder representation of bypass.
5. **Acceptance:** launching with the flag shows the WARNING gate; accepting enters bypass (no consults);
   declining exits or falls back per upstream behavior (pinned at spec time from the bundle).
6. **Dependencies:** after EP-T1 (same defaults surface).

#### EP-T6 · Dialog copy & framing polish (qa3-07, qa3-08) — P2 batch
Create-file dialog framed as a numbered diff between `╌╌╌` rules (qa3-07); don't-ask-again suggestion row
grammar — never conflate a directory grant with a command rule in one row (qa3-08). Acceptance: the two
dialogs render upstream's framing on the same fixtures the QA agents used. Batches with any EP-T2 fix
round touching the registry.

---

### Stream R · Repaint & geometry — "one frame primitive owns every reset" (8 findings + 1 promoted + 1 probe)

#### EP-R0 · MOUSE-1 probe (owner testimony vs qa2-02) — P0, first
Re-probe click-to-expand per §5.2: bundle grep for mouse-enable emissions; tmux mode introspection *with a
folded tool row on screen*; live click. Deliverable is a verdict written into §12, not code. If the owner's
observation reproduces, a new epic is cut at Wave R spec time; if not, the axis closes with evidence the
owner can check against their terminal (and we ask them for a screen recording — §11).

#### EP-R1 · Width-change clear-and-repaint (qa2-08, qa2-01, qa2-09, qa2-10a) — P0
1. **Context:** QA-2: 15/15 width-matrix cells fail; stale rules accumulate the entire resize history;
   mid-stream resize multiplies the spinner ×3; claude passes 15/15. Height-only resizes are always clean
   (triage §5.6) — the defect is pinned to the width path.
2. **Decisions:** `[DECIDED-AUTO]` generalize the proven-good path: the ctrl+o pager's close path already
   clears-and-repaints correctly (`qa2-11` evidence). One primitive, invoked from every frame-invalidating
   trigger. Alternative — per-site patches — rejected: C1b (`/clear`) shows the same missing primitive
   from another trigger; per-site fixes would multiply.
3. **Current state:** `[BUG]` — no SIGWINCH-driven clear; Ink repaints in place at the new width over
   stale rows.
4. **Work items:** (new) shared clear-and-full-repaint primitive; (modify) width-change handler invokes
   it (streaming and idle); (modify) picker/dialog widths re-derive on resize (qa2-10a).
5. **Acceptance:** the QA-2 width matrix re-run passes every cell — one composer block, zero stale rules,
   both directions, including mid-stream; the `/model` picker never leaves a stale narrow copy.
6. **Dependencies:** the primitive lands first; EP-R2 consumes it.

#### EP-R2 · Reset repaint: `/clear` blank pane (qa5-01) — P0
`/clear` currently leaves a fully blank pane until the next keystroke (process alive). Work: the clear
handler rebuilds state **and** invokes EP-R1's primitive. Acceptance: `/clear` immediately renders banner +
composer + footer with zero keystrokes. Depends on EP-R1.

#### EP-R3 · Bottom-anchored composer (qa2-12) — P1
Upstream pins the prompt block to the bottom of the pane; ccx sits at the top with up to 30 blank rows
below on short transcripts. Layout change in the ChatApp frame; watch the Ink frame-height law (F6 lesson:
a dynamic frame taller than the viewport leaks copies). Acceptance: on a fresh session the composer renders
at the pane bottom; long transcripts unchanged.

#### EP-R4 · Scrollback hygiene (qa2-11 torn borders, qa2-06 committed placeholder) — P2 batch
Pager close leaves torn modal-border fragments in scrollback; the pre-turn placeholder is committed above
the submitted prompt. Acceptance: after open/close and after a submit, scrollback contains neither artifact.

#### EP-R5 · Diff-body syntax highlighting (qa2-03, promoted from the unwaved bucket) — P1
Edit/Update diff bodies render flat; claude tokenizes each diff line. The highlighter exists (fenced code);
apply per diff row with the diff gutter colors composing over it. Acceptance: an Edit tool row shows
syntax-colored tokens inside added/removed/context lines, matching the QA-2 fixture frames.

---

### Stream S · Session truth — "what's on screen is what the model has" (16 findings + qa4-07)

#### EP-S1 · Rewind replays the trimmed transcript (qa5-05, qa4-11) — P0
1. **Context:** two agents independently: post-rewind replay shows turns the model provably no longer has
   (both probed the model; `/export` writes the trimmed file). The F6 live-fix poll accepts the OLD
   session file — non-empty ≠ correct.
2. **Decisions:** `[DECIDED-AUTO]` the rebuild must key on *content correctness*, not file existence —
   e.g. verify the replayed tail matches the rewind anchor (the trimmed file's last uuid ≤ anchor), or
   read via a host-supplied post-rewind snapshot instead of racing the disk.
3. **Current state:** `[BUG]` in `useChat.rebuildAfterRewind`'s poll acceptance.
4. **Work items:** (modify) rebuild acceptance criterion; (new) regression: replay row count equals the
   trimmed transcript's.
5. **Acceptance:** the exact ONE/TWO/THREE repro from `qa5-05`: after rewinding to ONE, the replayed
   transcript shows only ONE.
6. **Dependencies:** none. Wave S lead.

#### EP-S2 · Foreground session handle (qa5-03, qa5-04) — P0
`/rename` and `/tag` answer "no session yet" after completed turns; Esc-Esc has no anchors after `/clear` —
handlers read a fleet/detachable handle the foreground REPL never populates. Work: one identity source for
foreground and detachable paths. Acceptance: after any completed turn, `/rename` works; after `/clear` +
one turn, rewind anchors exist.

#### EP-S3 · Rewind confirm panel, full option set (qa4-09, qa5-06) — P1
Two rows today; upstream offers both Summarize variants (L487071) plus the code-aware three-way head
(L487070, `The code will be unchanged.` L487222). Acceptance: no-code-change rewind shows 4 options;
with code changes, the Restore code variants appear.

#### EP-S4 · List windowing primitive (qa4-10, qa2-10b, standing paging remainder) — P1
`(more above)`/`(more below)` windowing (L396412/L396420) applied to the rewind picker and `/model` at
small geometries; `pageup/pagedown/home/end` bound in Settings/Permissions contexts (four lines in
`bindings.ts` per `tui-ux.md:1045`). Acceptance: 60×15 pickers clip with indicators; paging keys move
Settings/Permissions lists.

#### EP-S5 · Cost & context truth (qa5-10, qa5-02) — P1
`/cost` counts cache tokens (currently orders-of-magnitude under); footer context %% resets on `/clear`.
Acceptance: `/cost` after a cached-heavy turn is within rounding of the SDK's usage totals; footer shows
fresh context immediately post-clear.

#### EP-S6 · Resume ergonomics (qa5-14, qa5-13, qa4-06, qa4-08, qa4-07) — P1
`--resume` accepts the 8-char short id ccx itself prints; `--continue` exists; `/resume` gains upstream's
widen controls (`Ctrl+A/B/W`, L476627), the `Resume cancelled` outcome line (L476806), and a real
transcript preview (qa4-07: slash entries included, correct message count). Acceptance: copying the id
ccx prints and passing it to `--resume` resumes that session; `ccx --continue` reopens the latest;
preview matches the session's actual content.

#### EP-S7 · Compaction surfaces (qa5-07, qa5-08) — P2
Busy state during `/compact` (upstream: 40-cell progress bar, L407347/L497331) and the spinner line
replaced by `⎿ Compacted (ctrl+o to see full summary)` (L314675). Acceptance: `/compact` shows progress
while running and leaves only the result line after.

#### EP-S8 · Lifecycle confirmations (qa4-04) — P2
`Switch model?` cache-invalidation confirm (L447014/L447033) when changing model mid-conversation.
Acceptance: `/model` switch mid-session shows the confirm; accepting switches, declining keeps.

---

### Stream C · Chrome & composer ergonomics — F7, grounded (17 findings + 3 promoted)

#### EP-C1 · Footer architecture (qa6-01, qa1-13, qa6-10-arch) — P0, prerequisite
One row, right-aligned second region; transient hints inline on the mode row (not their own line); typing
collapses the footer to the mode chip. This decision determines where EP-C4/C6/C7's chrome lands — it goes
first in the Wave C spec. Acceptance: footer geometry matches upstream's on the QA-6 fixture frames;
composer block height stops fluctuating while editing.

#### EP-C2 · statusLine hook (qa6-03) — P1, largest single item
QA-6 captured the full upstream contract: 19-field stdin JSON (L484846: `session_name`, `effort`,
`context_window`, `exceeds_200k_tokens`, `rate_limits`, …), render slot, coloring, truncation,
event-driven refresh. May split into its own mini-spec if Wave C gets wide (triage's own suggestion).
Acceptance: a configured statusLine command receives the documented payload and renders in the slot with
upstream's truncation.

#### EP-C3 · CLI surface (qa6-12) — P1
`--version`, `--help`, doctor-equivalent; unknown flags produce upstream-shaped errors instead of a bare
exit-2 one-liner (`args.ts:133`). Acceptance: `ccx --version` and `--help` print; a typo'd flag names the
offending token with guidance.

#### EP-C4 · Chrome truth batch (qa6-04 title, qa6-06 spinner, qa6-09 mode chip, qa2-13 duration row) — P1
Terminal title from the turn summary (L547702); spinner parenthetical gains output-token count + rotating
phase word (vocab L406847); mode chip renders display names + glyphs (⏸/⏵⏵) and cycles from upstream's
home state; end-of-turn `✻ Worked for 4s` row (past-tense vocab L428307). Acceptance: per-item vs the
QA-6/QA-2 fixture frames.

#### EP-C5 · Ghost-text follow-up suggestion (qa6-07, qa1-06) — P1
Model-generated context-aware follow-up pre-fill after each turn (IN-220 behind `promptSuggestionEnabled`,
L235116/L235123/L315485 — canon note: flag-gated in 220; the Wave C spec pins the default per the installed
build's cached flags, the F6 precedent). Probe-first: where the suggestion text comes from headlessly.
Acceptance: matches whichever default the flag adjudication lands, with the settings row present.

#### EP-C6 · Effort surfaces (qa4-01, qa6-02) — P1
`/model` effort selector row (`←/→ to adjust`, L441142), standalone effort dialog (L447278), ephemeral
`● high · /effort` hint on the 10s feedback system (L496132). SDK effort setters are live-verified
(turn-controls probes). Acceptance: effort adjustable from the picker; hint decays ~10 s.

#### EP-C7 · Composer keys & draft semantics (qa1-04+qa6-08, qa1-05+qa4-12+qa6-10-esc, qa1-01, qa1-02, qa1-03) — P0
Ctrl+C on a non-empty draft clears it (second Ctrl+C arms exit); a lone Esc actually clears after the CSI
disambiguation timeout — the footer's `Esc clear` stops being false (this already caused a real
mis-submission, `qa4-12`); Home/End/`ctrl+←/→` bound; word-forward lands at the start of the next word.
Acceptance: each key behaves as upstream on the QA-1 repro sequences; the exit-arm hint replaces the footer
in place and flashes briefly.

#### EP-C8 · Live banner & picker state (qa4-02, qa3-02, qa6-14 — promoted from the unwaved bucket) — P1
Banner and `/model` rows bind to live state: "Default (recommended)" points at ccx's actual default, banner
model/mode agree with the footer, display name + auth provider resolved. The qa6-14 rider (version in the
box header, `What's new` block) lands with EP-C4's chrome batch. Acceptance: banner, picker and footer
never disagree in the same frame.

## §7 Priority cut

| P0 (sprint gate) | Why |
|---|---|
| EP-T1 | The P1 harm: destructive commands unconsulted |
| EP-T2, EP-T3, EP-T4 | Promised affordances that lie; invisible failure |
| EP-R0 | Open contradiction with owner testimony — cheapest decisive probe |
| EP-R1, EP-R2 | The other P1 + its sibling trigger |
| EP-S1, EP-S2 | Display lies about model state; commands dead on the main path |
| EP-C1, EP-C7 | Architecture prerequisite; highest-frequency P2 keys |

Everything else P1 (rolls over inside its wave), except the named P2 batches (EP-T6, EP-R4, EP-S7, EP-S8)
which are opportunistic.

## §8 Dependency & parallelism map

- **Wave order is strict** (owner): T → R → S → C. Within a wave, epics parallelize per SDD except:
  EP-T1 → EP-T3/EP-T5 (mode semantics first); EP-R1 → EP-R2 (primitive first); EP-C1 → EP-C4/C6/C8
  (footer architecture first).
- Shared-surface ownership: the dialog registry (EP-T2/T3/T6) is one owner or sequenced tasks; the
  keymap table (EP-C7, EP-S4's paging keys) likewise.
- Probes precede specs where §6 says probe-first: EP-T4 (SDK transport failure), EP-T3 (plan-kind wire),
  EP-R0 (mouse), EP-C5 (suggestion source).

## §9 Progress *(living)*

- [ ] Wave T — spec → plan → execution → close pass → re-score
- [ ] Wave R (incl. EP-R0 verdict)
- [ ] Wave S
- [ ] Wave C
- [ ] Recurring sweep #2 run against a shipped wave, delta triaged

## §10 Decision Log *(living)*

- **D1 [DECIDED, owner 2026-08-06]** Wave order T → R → S → C; umbrella spec written before Wave T starts
  ("so we don't lose track"). Alternative R-first (both P1s early) rejected by owner's safety-first call.
- **D2 [DECIDED, owner]** Proceed to Wave T immediately after this spec — the per-wave pipeline needs no
  further green light; each wave's *spec* still gets its normal review pass.
- **D3 [DECIDED-AUTO]** No issue board (§13): the project tracks in-repo (this spec §9, the SDD ledger,
  `tui-ux.md`); registering ~30 GitHub issues is an outward batch action the owner never asked for and the
  board would duplicate the spec. Revisit only if the owner asks for a board.
- **D4 [DECIDED-AUTO]** Promote the three P2s out of the unwaved bucket: `qa2-03` → EP-R5,
  `qa4-02`+`qa3-02`+`qa6-14` → EP-C8. Leaving P2s unscheduled contradicts the ranked worklist. The
  remaining unwaved body (26 ids, all P3/P4) defers intact (§16).
- **D5 [DECIDED-AUTO]** `qa4-07` assigned to EP-S6 (triage omission caught in self-review, §5.3).
- **D6 [DECIDED, owner pre-approved contingent on yield; yield affirmed]** Recurring QA sweep runs after
  each shipped wave (not nightly) so each sweep measures a delta. Fleet briefs gain the rule: never
  free-type unverified slash commands into the canon binary (the `/history`→`/design-sync` incident).
- **D7 [DECIDED-AUTO]** Build bypass mode (EP-T5) rather than omit it — fidelity canon; the consent gate
  is the safety mechanism.
- **D8 [DECIDED-AUTO]** MOUSE-1 is a probe, not a build: neither the owner's testimony nor `qa2-02` is
  trusted until the re-probe lands (§5.2).

## §11 Open questions

| Item | Owner | Deadline |
|---|---|---|
| MOUSE-1: does click-to-expand reproduce with a fold on screen? If the probe still finds nothing, we need the owner's terminal name + a screen recording of a click expanding a fold | Controller (probe, Wave R start); owner (demo, only if probe is negative) | Wave R spec time |
| `ctrl+e` explain-command feasibility (EP-T2): does the SDK expose enough to fill riskLevel/explanation? | Wave T spec probe | Wave T spec time |
| `#` memory mode and the ccx-extra context %% (qa6-13, qa1-10): keep or drop | Owner, surfaced at Wave C spec review | Wave C spec time |

## §12 Surprises & Discoveries *(living)*

Seeded from grounding: the triage omission (`qa4-07`, §5.3); the `listSessions` misread reversal (§5.2);
the protective drift calls (`ctrl+_`, `ctrl+e to show all`, `#` memory — §5.2); `qa3-05`'s amend rows are
the *same mechanism* as EP-T2's input rows (one primitive serves both); the pager close path as the proven
repaint primitive (EP-R1); QA-1's `/history`→`/design-sync` fuzzy-match hazard (now a fleet-brief rule, D6).

## §13 Tracking map

**No issue board (D3).** The materialization contract for this project is:
- This spec's §9 is the wave checklist; the SDD ledger
  (`.doperpowers/sdd/progress.md`) is the per-task record; `docs/parity/tui-ux.md` and
  `docs/parity/coverage.md` are re-scored at each wave close.
- Each wave produces its own `docs/superpowers/specs/…` + `plans/…` pair citing this spec's epic ids, so
  epic → work mapping lives in those documents.
- Pre-existing open items dispositioned: the `tui-ux.md` standing remainders are absorbed
  (paging keys → EP-S4; listSessions note → amended by EP-S6's wave spec; PermissionsDialog raw arrows →
  §16 panel wave with `qa3-11/12`), none closed silently.

## §14 Risks

| Risk | Blast radius | Mitigation |
|---|---|---|
| EP-R1's primitive fights Ink's own repaint model | Whole Wave R | The pager close path already proves the approach inside this Ink fork; generalize, don't invent |
| EP-T3's suspect is wrong (modal, not classification) | Wave T schedule | Probe-first work item; the epic budgets for "build the mount" as the fallback |
| SDK gives no transport-failure events headlessly (EP-T4) | Weakens the retry UI | Probe decides the layer; worst case the host synthesizes from its own connection state |
| Wave C width (statusLine alone is L-sized) | Wave C overruns | EP-C2 pre-authorized to split into its own mini-spec |
| Live-use regressions between waves | Owner trust | D6's per-wave sweep is the regression net |

## §15 Interface contracts

- **The repaint primitive (EP-R1)** is consumed by EP-R2 and expected by future dialog work — name it,
  export it, test it once.
- **The dialog input-row primitive (RLe)** serves EP-T2's feedback rows and `qa3-05`'s amend rows — one
  shape.
- **Permission mode vocabulary** (EP-T1/T5): the wire's mode enum must carry bypass end-to-end
  (host ops → daemon → remote) before the chip renders it (EP-C4).
- **Footer architecture (EP-C1)** is the layout contract for EP-C2/C4/C6/C8 — merged before they stack.

## §16 Deferred — the next milestone's reservation

- **Panel-depth wave** (26 ids after D4's promotions): settings/help/theme/status/context/permissions
  depth, agents view, AskUserQuestion review screen, `@` agents completion, hardware cursor, `/history`
  ccx-extras, `qa2-05`'s ctrl+o interaction-model decision, attach/detach chrome (`qa5-15..18`),
  `qa1-07/08/09/11/12/14`, `qa2-04`, `qa4-03/05/13..17`, `qa3-11/12/19`, `qa5-09/11/12/17`, `qa6-13`,
  plus the PermissionsDialog raw-arrow standing remainder. Why deferred: large, coherent, mostly-P3;
  triage's own recommendation was a dedicated wave.
- **Future-rebase parking lot** (triage §4): `ctrl+e to show all` tail, `ctrl+shift+_` undo, and any
  2.1.222-only behavior — untouched until the canon bundle moves.
- **Keep-or-drop decisions** parked to Wave C review: `#` memory mode, ccx's inline context %%.

## §17 Outcomes & Retrospective

Pending — written at sprint close.

## Revision notes

- v1 (2026-08-06): authored from the QA Sprint 1 triage per the owner's directive; D1–D8 landed;
  `qa4-07` omission corrected.
