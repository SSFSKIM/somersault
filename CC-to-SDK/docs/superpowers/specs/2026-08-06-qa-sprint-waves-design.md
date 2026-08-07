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
  **RESOLVED 2026-08-06 — both are right, about different renderers (§12 item 17).** Click-to-expand is
  real and live-reproduced, in upstream's **fullscreen** renderer only; the fleet measured the **inline**
  renderer, where its reading is correct. The conditional-enable instinct above was the right one — the
  condition is the rendering mode, not the presence of a fold. The bundle-grep half would never have
  worked: the escapes are **composed at runtime from integers**, so the literal `?1000h` appears nowhere.

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
   classifier — rejected **and now known to be impossible**: ccx has **no dialog suppression of its own**
   (the broker is installed unconditionally, `resolveOptions.ts:68`); the SDK's classifier alone decides
   whether a call reaches `canUseTool`, so the `rm`-vs-`touch` ordering is not ours to fix. Changing the
   posture is the only lever we hold.
   `[DECIDED-AUTO]` scope the change to the REPL host construction in `cli/main.ts`, NOT
   `DEFAULTS.permissionMode` (`config/types.ts:161`) — that single line governs headless `-p`, `--bg` and
   the daemon too, where `auto` is the deliberate choice.
3. **Current state:** `[BUG]` `config/types.ts:161` is `"auto"`, applied at `resolveOptions.ts:60-61`.
   Separately `[BUG]` `cli/main.ts:239,244` read `inv.config.permissionMode ?? "default"` — the banner
   claims `default` while the engine starts in `auto`, which is `qa3-02`'s contradiction; the exported
   `resolvedPermissionMode()` is the correct value and the fix is two lines. Ladder at parity (`qa3-15`).
4. **Work items:** (modify) REPL launch mode → `default`; (modify) the two banner call sites; (new)
   auto-mode entry notice — a **single-string transcript `notice` message** (not four lines, not a
   dialog: `AUTO_MODE_DESCRIPTION` L547286), inserted **800 ms** after the mode becomes auto and shown
   **once per install** (L547935-955). The two other auto surfaces (the "auto is now the default"
   startup notice L454518, the `AutoDefaultNudgeDialog` L547227) are distinct and defer to §16.
5. **Acceptance:** fresh isolated-HOME launch → `rm <file>` prompt produces a consult dialog before
   anything executes; banner, footer and engine agree on the mode in the same frame; shift+tab into auto
   prints the L547286 notice once and never again.
6. **Dependencies:** none; first epic of the sprint.

#### EP-T2 · Feedback is discoverable and never fires empty (qa3-04, qa3-18, qa3-05, qa3-06) — P0
1. **Context (corrected by grounding):** the input row EXISTS and works end to end
   (`optionRows.ts:28-32` → `Select.tsx:210-213` → `bashDecision` → `gate.ts:62` → the SDK's deny
   `message`). Two real defects hide under QA's "fires without collecting": nothing on screen advertises
   Tab (every dialog footer is a bare `esc cancel` where upstream's is
   `Esc to cancel · Tab to amend · ctrl+e to explain`), and `allowEmptySubmitToCancel: true` on the No row
   means Tab-then-Enter with nothing typed sends a bare deny — exactly QA's repro.
2. **Decisions:** `[DECIDED-AUTO]` the fix is the footer hint + the empty-submit rule, not a new widget.
   Upstream's `hintNode` (L505188) shows `tab / amend` only while the focused row is NOT already in input
   mode, and auto-collapses the other row when focus leaves it empty (L505162-69) — transcribe that
   logic. WebFetch is the one dialog whose No row is a plain label promising a channel it cannot deliver
   (`smallDialogOptions.ts:104`) — upstream hangs no feedbackConfig on it either, so the fix is the copy,
   not a new row. `ctrl+e` explain is **feasible** (bundle §7: one forced-tool Messages call, 4-field
   schema, current main model) and is scoped as its own work item, not deferred.
3. **Current state:** `[PARTIAL]` — collection built, discoverability `[NOT-BUILT]`, empty-submit `[BUG]`.
   The "parked post-interrupt state" premise was `[MISREAD]`: L422225 is a static dim transcript row
   substituted on three interrupt sentinels, with no input widget at all.
4. **Work items:** (new) upstream footer hint row across the six dialogs; (modify) empty submit on a
   feedback row is a no-op, not a bare deny; (new) `ctrl+e` explain-command (forced-tool call, 3-row
   render, Low/Med/High risk labels); (modify) WebFetch No-row copy; (modify) `qa3-06` — the "double
   space" is the inverse-video cursor block plus `", "` separator (`Select.tsx:129/293`), fix by
   suppressing the separator on an empty input row; (new) the interrupt-sentinel transcript row.
5. **Acceptance:** every consult footer shows the amend and explain hints; Tab-then-Enter on an empty
   feedback row does nothing; typed text still reaches the model; ctrl+e renders explanation, reasoning
   and a risk line.
6. **Dependencies:** shares the dialog registry with EP-T3/EP-T6 — same-owner or sequenced.

#### EP-T3 · Plan modal option parity and grants (qa3-16, qa3-17) — P0
1. **Context (corrected by grounding, 2026-08-06):** the "generic permission dialog" premise was FALSE —
   QA's own frame (`frames-qa3/qa3-14-ccx-plan-modal.txt`) shows `PlanDialog` mounted live with
   `kind:"plan"` intact end-to-end. The real residue: the dashed rules around the plan body, the
   availability-driven option set, the grant semantics, and approve-with-feedback.
2. **Decisions:** `[DECIDED-AUTO]` no classification work; harden with a guard test on the live tool
   name (`gate.ts:22`'s literal `"ExitPlanMode"` is the single point of evidence). Option rows follow
   upstream's `sYf` availability logic; the clear-context row family (deny + re-drive as fresh turn,
   L500948–964) is a separate mechanism and defers to §16 with a divergence note, as does the
   plans-directory file path.
3. **Current state:** `[PARTIAL]` — modal live-mounts; option 1 grants `acceptEdits`
   (`PlanDialog.tsx:101`, `host.ts:527`) where upstream's availability ladder grants `auto` (imperative,
   empty permissionUpdates, L500727/L500968) or `bypassPermissions` (L500729); no dashed-rule framing;
   empty submit on the No row sends a feedback-less `plan_reject` where upstream's guard makes it a
   no-op (L500976, the one row without `allowEmptySubmitToCancel`).
4. **Work items:** (modify) option set + labels per `sYf` availability; (modify) widen `plan_approve`
   to carry the granted mode; both upgrade appliers (`host.ts:527`, `appserver/planUpgrade.ts:32`);
   (modify) approve-with-feedback (shift+tab and yes-row text ride into the allow); (modify) empty-submit
   no-op on the No row; (new) dashed-rule plan-body framing; (new) live-tool-name guard test.
5. **Acceptance:** with auto available, row 1 reads `Yes, and use auto mode` and approving it leaves the
   session in `auto`; typed keep-planning feedback reaches the model; empty Enter on the No row does
   nothing.
6. **Dependencies:** after EP-T1 (mode semantics settled first).

#### EP-T4 · Failure is visible (qa6-05) — P0
1. **Context:** QA-6: with the network unreachable, ccx showed a healthy-looking spinner for 72+ seconds.
   Upstream **replaces** the spinner row (not decorates it, L407973) with `✻ <label> · Retrying in <dur>
   · attempt n/max`, where the label is the literal `"API error"` for attempts 1–2 and the real error
   text only once `attempt >= min(3, maxRetries)` or the error is network-down/SSL/rate-limited
   (`b0p`, L408007). A stalled (pre-retry) variant exists: `Waiting for API response · will retry in
   <dur> · check your network` (L407992/L407997).
2. **Decisions (probe 96, live 2026-08-06):** `[DECIDED-AUTO]` the retry data is **SDK-provided, not
   host-synthesized**: every retry emits `{type:"system", subtype:"api_retry", attempt, max_retries,
   retry_delay_ms, error_status, error}`, matching `SDKAPIRetryMessage`. The countdown is a local timer
   seeded from `retry_delay_ms`. Three host-owned pieces the SDK does NOT give us: a pre-evidence
   "connecting/stalled" state (a blackholed endpoint burns ~75 s of connect timeout in silence; a refused
   one starts the ladder in ~20 ms), banner teardown (nothing announces a retry succeeded, and
   `max_retries:10` is a ceiling — a 401 gave up after 3), and the **terminal-frame trap**: the SDK yields
   a `result` frame whose `subtype` is still `"success"` on a dead connection and THEN throws — the
   failure lives in `is_error:true` / `terminal_reason:"api_error"` / `api_error_status`. Any classifier
   keyed on `subtype` misreads a total transport failure as a completed turn.
3. **Current state:** `[NOT-BUILT]` — no retry channel; `TurnSpinner.tsx:14-25` has no stale/degraded
   state; the turn wait (`chatAdapter.ts:110`) has **no deadline at all** — only a socket close settles
   it. `[BUG]` on the way: a mid-turn failure renders `✗ <msg>` twice, from `useChat.ts:546` (event arm)
   and `useChat.ts:1231` (submit-rejection arm), off the same frame.
4. **Work items:** (new) forward `api_retry` system messages host → wire → REPL; (new) retry/stalled
   spinner-replacement row with local countdown and teardown; (modify) terminal-frame classification to
   read `is_error`/`terminal_reason`, not `subtype`; (modify) de-duplicate the double `✗` render.
5. **Acceptance:** with the API endpoint unreachable mid-turn, ccx replaces the spinner with the typed
   error row and a live countdown showing the SDK's own attempt/max within seconds of the first retry,
   and a stalled row before that; a failed turn ends with exactly one error line.
6. **Dependencies:** independent; parallel-safe with EP-T2/T3.

#### EP-T5 · Bypass consent gate + the runtime-flip hazard (qa3-14) — P1
1. **Context (corrected by grounding):** "no bypass mode" was `[MISREAD]` — `--permission-mode
   bypassPermissions` already parses (`cli/args.ts:40,113`) and `/yolo` sets it at runtime
   (`useChat.ts:711`). What is absent is upstream's flag NAME and, more importantly, the consent gate.
   The grounding also surfaced a hazard QA never saw: `allowDangerouslySkipPermissions` is set only from
   the LAUNCH mode (`resolveOptions.ts:66-67`), so a runtime flip may be refused by the SDK while
   `useChat.ts:1438` swallows the rejection and `:1439` paints the status bar red anyway — the UI would
   claim bypass while the engine is not in it.
2. **Decisions:** `[DECIDED-AUTO]` build the gate to upstream's mechanics: two-button confirm with
   **cancel first and focused** (L554075), accept persists `skipDangerousModePermissionPrompt` so it
   never shows again (`M8()`, L43492), decline **exits with code 1** and does NOT fall back to another
   mode, Escape exits with code 0. The mode's own chrome (`Bypass Permissions` / `⏵⏵` / error color,
   L41536) belongs to EP-C4 but the vocabulary is pinned here (§15).
3. **Current state:** `[PARTIAL]` — mode reachable, gate `[NOT-BUILT]`, runtime-flip `[BUG]` (code-shape,
   not yet live-measured).
4. **Work items:** (new) `--dangerously-skip-permissions` as an accepted alias; (new) blocking consent
   dialog with the three verbatim paragraphs + docs link; (new) persisted acceptance; (modify) runtime
   flips to bypass must surface a refusal instead of swallowing it.
5. **Acceptance:** launching in bypass shows the WARNING gate before any turn; declining exits non-zero;
   accepting once means the gate never reappears; `/yolo` against a refusing engine reports the refusal
   instead of showing a false red chip.
6. **Dependencies:** after EP-T1 (same defaults surface).

#### EP-T6 · Dialog framing + the grant-mismatch (qa3-07, qa3-08) — P2 batch
**Both QA descriptions were wrong about the canon and the grounding replaced them.** (a) `qa3-07`: there
is no `╌` character anywhere in 2.1.220 (`grep -c` = 0) — a NEW file renders as a plain
syntax-highlighted block with **no line numbers**, framed only by Ink's dashed top/bottom border
(`SM`, L424999), with `"(No content)"` when empty; the numbered diff exists only on the **overwrite**
branch (`lre`, L420073). ccx's `CodeBlock` is already close; the work is the dashed-rule box and the
empty-content literal. (b) `qa3-08`: "upstream never puts a directory grant and a command rule in one
row" is **refuted** — `Wdi` has two branches that do exactly that (L504800/L504801), and ccx's copy is a
faithful transcription. The real rule is narrower (the *editable prefix* row is suppressed when any
`addDirectories` or non-shell `addRules` suggestion is present, L504862). What the grounding found
instead, and QA did not: the **generic** dialog's row promises a cwd-scoped "commands" grant
(`smallDialogOptions.ts:238`) while `genericDecision` issues a whole-tool unscoped rule — e.g. "don't ask
again for WebSearch commands in /Users/…" grants WebSearch everywhere, forever. That is the trust defect
in this epic; the grammar is not. Acceptance: the create dialog matches upstream's framing on the QA
fixture; the generic don't-ask-again row's copy matches the rule it actually writes.

---

### Stream R · Repaint & geometry — "the renderer's caches must be voidable" (8 findings + 1 promoted + 1 probe)

> **Re-cut by the grounding round, 2026-08-06.** The stream's original thesis — *one frame primitive owns
> every reset* — did not survive: the primitive it was to be extracted from does not exist, and the four
> findings turn out to sit on **three different stale caches** inside Ink (the erase line count, the
> `lastOutput` dedupe, and the full-screen branch that bypasses log-update entirely). The shared capability
> is real but is stated correctly as *ccx cannot void the render stack's caches and force a full,
> correctly-sized repaint*. Net effect on scope: **EP-R0 closed with no code**, **EP-R3 withdrawn as not a
> defect**, `qa2-06` merged into EP-R1, and EP-R2's dependency on EP-R1 retracted. Two epics grew
> (EP-R1 gained a gating spike; EP-R5 gained two palettes and a dependency decision). Evidence: §12
> items 11–19.

#### EP-R0 · MOUSE-1 probe (owner testimony vs qa2-02) — **CLOSED 2026-08-06, no code**
Verdict in §12 item 17. Click-to-expand is real and live-reproduced, but it belongs to upstream's
**fullscreen renderer** — SGR mouse reporting welded to the alternate screen, advertised in upstream's own
switch notice at L453184 alongside click-to-position-cursor and copy-on-select. The owner runs that mode;
the fleet's isolated profile ran inline, where its all-zeros reading is correct. **No new Wave R epic is
cut**: ccx has no alternate-screen mode at all, so this is "missing the fullscreen renderer", which is a
roadmap question (§11 FULLSCREEN-1), not a repaint defect. No screen recording needed.

#### EP-R1 · Width-change clear-and-repaint (qa2-08, qa2-01, qa2-09, qa2-10a) — P0
1. **Context:** QA-2: 15/15 width-matrix cells fail; stale rules accumulate the entire resize history;
   mid-stream resize multiplies the spinner ×3; claude passes 15/15. Height-only resizes are always clean
   (triage §5.6) — the defect is pinned to the width path.
2. **Decisions:** the original `[DECIDED-AUTO]` is **RETRACTED** (§12 items 13, 19) — the pager close path
   is `onClose={() => setTranscriptOpen(false)}` and nothing more, so there was no proven-good path to
   generalize. Replacing it: **`[DECIDED]` fix the two real causes, and copy upstream's *principle* rather
   than its bytes.** Upstream never consults the previous frame's geometry, so its erase cannot be short
   (§12 item 15). A verbatim port is rejected: upstream's renderer owns the whole viewport and repaints
   every cell from its own buffer, while ccx's visible screen is partly Ink `<Static>` that Ink will not
   re-emit — erasing the viewport and homing would orphan the transcript. Ink's own escape hatch
   (`clearTerminal + fullStaticOutput + output`) is also rejected: it carries `ESC[3J`, which destroys the
   scrollback the transcript lives in, and re-emitting static history is O(session) per resize.
3. **Current state:** `[BUG]`, and it is **two** independent defects, not one.
   (a) **Nothing in `harness/src/` subscribes to resize at all**; Ink's own handler re-runs Yoga layout and
   re-serializes the existing tree without re-rendering React, so width-derived strings such as the
   composer's `RULE.repeat(width)` freeze at the launch width. (b) Ink erases with a **logical** line count
   (`log-update.js`) while a width change makes the emulator re-wrap the painted frame into a different
   number of **physical** rows, so the erase falls short and the remainder survives and accumulates.
   `qa2-09`'s "self-heals at end of turn" is refuted (§12 item 14), and `qa2-06` merges in here (§12
   item 19) — it reproduces only after a width change and is un-erased dynamic output, not `<Static>`.
4. **Work items:** **(spike, first)** measure emulator reflow behaviour and pick the erase strategy — see
   Dependencies; (new) a resize subscription that makes terminal size real React state, threaded to
   `ChatApp.tsx:140/143`; (new) frame-geometry tracking via the **existing** `ResumeSafeStdout` proxy
   (`chatMain.tsx:40-65`), which already intercepts every byte Ink writes; (new) the erase itself, emitted
   through that proxy's TTY-gated write shape, `deps`-overridable for tests; (modify) picker/dialog widths
   re-derive on resize (`qa2-10a`). **Explicitly not**: bumping `staticEpoch` (remounting `<Static>`
   replays the whole scrollback, and a resize does not change the transcript) and reusing
   `useChat.ts:336`'s `\x1b[2J\x1b[3J\x1b[H` payload (the `3J` wipes scrollback).
5. **Acceptance:** the QA-2 width matrix re-run passes every cell — one composer block, zero stale rules,
   both directions, including mid-stream and after an interrupt; the `/model` picker never leaves a stale
   narrow copy; a submit after a width change leaves no placeholder above the prompt (`qa2-06`).
   **The matrix MUST be run under tmux or a real terminal, never under `capture-frames.py`** — pyte
   truncates instead of reflowing and therefore cannot reproduce this defect at all (§12 item 16). There is
   no resize regression test in the repo today; adding one under a reflowing emulator is part of this epic.
6. **Dependencies:** **a spike gates the implementation.** The computed-physical-row erase
   (`Σ max(1, ceil(displayWidth(line)/newWidth))`) is only valid if the emulator reflows. Measured so far:
   **tmux reflows, pyte does not**; at least one real terminal is still unmeasured. The spike also has a
   confirmed second requirement — a resize can push frame rows off the top of the viewport, so **the erase
   count must be clamped to the rows still on screen**. Promote or discard the strategy on that evidence.
   **EP-R2 no longer depends on this epic** (§12 item 19).

#### EP-R2 · Reset repaint: `/clear` blank pane (qa5-01) — P0, **independent of EP-R1**
`/clear` leaves a fully blank pane until the next keystroke (process alive). **The filed diagnosis is
wrong and so was the dependency edge** (§12 item 19). ccx's own code is correct — `useChat.ts:336` already
emits the erase and homes the cursor. The repaint is never written because Ink's `Instance.clear()`
(`ink.js:213`) resets log-update's counters but **not `this.lastOutput`**, so the post-clear frame is
byte-identical to the pre-erase one and the dedupe at `ink.js:132` skips the write. It is byte-identical
because the transcript lives in `<Static>`, leaving the dynamic frame unchanged by a clear; and the
`hasStaticOutput` escape at `ink.js:103` is closed by the same event, since wiping `<Static>` makes
`staticOutput === '\n'`, which that guard treats as empty. **So a clear-only primitive does not fix this** —
the blocker is a cache EP-R1 never touches. Work: invalidate Ink's `lastOutput` dedupe across a reset,
by whatever means the implementation proves (the `ResumeSafeStdout` proxy sees every write and is the
likeliest seam). Acceptance: `/clear` immediately renders banner + composer + footer with zero keystrokes,
and — matching upstream inline — **the `❯ /clear` echo survives** and the scrollback above is not wiped
(upstream omits `ESC[3J`; ccx currently sends it, a recorded divergence to fix here).

#### EP-R3 · Bottom-anchored composer (qa2-12) — **WITHDRAWN, not a defect**
§12 item 12. Measured at 100×40 with the screen pre-filled with markers so unwritten rows are
distinguishable from painted ones: ccx and upstream-**default** place the composer within one row of each
other, and **neither pads anything below it**. The "up to 30 blank rows" were unwritten pane rows, an
artifact of reading the screen with `tmux capture-pane`, which cannot tell a painted blank from an
untouched cell. Upstream bottom-anchors only in its **fullscreen** renderer (`cZo` L455844, fullscreen
branch L455888); its default branch (L455996) is a bare fragment with no height and no anchor — which is
structurally what ccx already does. Building the anchor would also have been actively harmful: a
bottom-anchored layout is by definition a full-height frame, which puts ccx permanently on the
`outputHeight >= rows` branch (`ink.js:121`) that bypasses log-update and desynchronizes its bookkeeping
(§12 item 19) — it would have made EP-R1 untestable. **Reclassified from defect to unimplemented mode**
and folded into §11 FULLSCREEN-1.

#### EP-R4 · Pager-close debris (qa2-11) — P2, **`qa2-06` moved to EP-R1**
Closing the ctrl+o pager leaves torn modal-border fragments. **Cause found** (§12 item 19): raw pty shows
**zero bytes** for 8 s after Escape, then an erase of 7 lines for a frame that occupied ~36. The pager
frame is taller than the pane, so Ink takes the full-screen branch at `ink.js:121` and writes **straight to
stdout, bypassing log-update**, leaving `previousOutput`/`previousLineCount` stale for everything that
follows. This is the concrete mechanism behind the programme's recorded "a frame taller than the viewport
leaks copies" hazard, and it means the branch does not merely cost a redraw — it **desynchronizes the
renderer's bookkeeping**, which is a standing hazard for any future full-height surface.
`qa2-06` (committed placeholder) is **removed from this epic**: the filed repro does not reproduce, it
fires only after a width change, and it is un-erased dynamic output from EP-R1's cause.
Acceptance: after opening and closing the pager, the scrollback contains no border fragments, and a
subsequent resize erases correctly (proving the bookkeeping was resynchronized, not merely papered over).
Upstream divergence recorded, not chased: its ctrl+o swaps the whole screen rather than overlaying.

#### EP-R5 · Diff-body syntax highlighting (qa2-03, promoted from the unwaved bucket) — P1
Confirmed as an observation; **the fix shape on file is wrong in three ways** (§12 item 18).
1. **Removed lines must stay flat.** L419813: `E = y === "-" ? [[cWo(o), _]] : i2p(s, _, o)` — upstream
   tokenizes added and context lines only. ccx's flat `-` row is already correct; highlighting it would be
   a regression. The original acceptance criterion ("tokens inside added/**removed**/context lines") is
   therefore wrong and is corrected here.
2. **The highlighter does not exist for this surface.** `harness/src/tui/highlight.ts` is a clone of
   upstream's *markdown fenced-code* map `DhH` (L420495) — four chalk colours, ten languages, written
   zero-dep by an explicit recorded trade for a LOW row. The diff path is real highlight.js behind a
   24-scope truecolor map. ccx also ported `H2p` (L419987), upstream's *fallback* renderer for when
   highlighting is **off** (gated by `CLAUDE_CODE_SYNTAX_HIGHLIGHT`, `uAr()` L419858).
3. **Three palettes, not one.** L419855 carries `K$p` (Monokai/dark), `Y$p` (light, entirely different
   values), and `jmH` (256-colour fallback via palette indices). Language detection is not
   extension-only — `X$p` (L419856) maps bare filenames (`Dockerfile`, `Makefile`, `Rakefile`, `Gemfile`,
   `CMakeLists`). ccx's band colours cannot be judged wrong until compared **per theme**.
**Composition is band-under-token:** the diff owns the background only (`ZmH`, L419733) — pinned live on a
word-diff row where one string token kept its foreground while the background flipped and flipped back.
**Work:** take the `highlight.js` dependency (§11 HLJS-1, controller-recommended); port the three scope
maps and the filename map; make wrapping segment-aware (`diffRender.ts:152` `plainRows` currently wraps a
plain string and emits one segment); invert the word-diff arm so tokens come first and the background
overlays. `Segment` (`render.ts:18`) already carries `color` and `bg` independently, so the overlay itself
is a spread. **Acceptance:** an Edit tool row shows token-level colours inside **added and context** lines
and a **single flat run on removed** lines; a word-diff boundary changes only the background; the palette
matches upstream per theme; a `Dockerfile` edit is detected as dockerfile.

---

### Stream S · Session truth — "what's on screen is what the model has" (16 findings + qa4-07)

#### EP-S1 · Rewind replays the trimmed transcript (qa5-05, qa4-11) — P0
1. **Context:** two agents independently: post-rewind replay shows turns the model provably no longer has
   (both probed the model; `/export` writes the trimmed file). The F6 live-fix poll accepts the OLD
   session file — non-empty ≠ correct.
2. **Decisions:** ~~`[DECIDED-AUTO]` the rebuild must key on *content correctness* … verify the replayed
   tail matches the rewind anchor~~ **RETRACTED 2026-08-07 by live measurement (§12 item 20).** The
   persisted session file is **append-only and never truncated** (19 → 20 → 24 rows across a rewind and a
   follow-up turn), so its tail never becomes the anchor and a correctness-gated poll can only ever
   exhaust its window. **`[DECIDED]` the transcript is a TREE, and the replay must walk it:** rebuild the
   branch by following `parentUuid` from the newest leaf back to the root. Slicing the flat rows at
   `prevUuid` is rejected too — it holds for one rewind, but two rewinds leave sibling branches interleaved
   in file order, which only the parent chain disambiguates.
3. **Current state:** `[BUG]`, but **not** where it was filed. The rewind is *correct at the data layer* —
   the post-rewind user row's `parentUuid` points at the assistant row of the turn before the anchor, i.e.
   the fork lands exactly right. The defect is entirely in the replay: `rebuildAfterRewind`
   (`useChat.ts:1288-1303`) hands `getSessionMessages`' flat row list to `replayDocument`, and
   **`parentUuid` appears nowhere in `src/`**. The poll's non-empty acceptance is a symptom, not the cause.
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
| ~~EP-R0~~ | **Closed 2026-08-06 with no code** — settled by the grounding round (§12 item 17) |
| EP-R1, EP-R2 | The other P1 + a sibling trigger with a *separate* cause (grounding corrected the edge) |
| EP-S1, EP-S2 | Display lies about model state; commands dead on the main path |
| EP-C1, EP-C7 | Architecture prerequisite; highest-frequency P2 keys |

Everything else P1 (rolls over inside its wave), except the named P2 batches (EP-T6, EP-R4, EP-S7, EP-S8)
which are opportunistic.

## §8 Dependency & parallelism map

- **Wave order is strict** (owner): T → R → S → C. Within a wave, epics parallelize per SDD except:
  EP-T1 → EP-T3/EP-T5 (mode semantics first); EP-C1 → EP-C4/C6/C8 (footer architecture first).
  **`EP-R1 → EP-R2` is RETRACTED** (§12 item 19): they fix different caches — EP-R1 the erase count,
  EP-R2 Ink's `lastOutput` dedupe — and a clear-only primitive leaves `/clear` broken. They parallelize.
- **New Wave R edge: a spike gates EP-R1's implementation** — the erase strategy depends on emulator
  reflow behaviour, measured so far as tmux yes / pyte no. Deliverable is a strategy verdict, not code.
- Shared-surface ownership: the dialog registry (EP-T2/T3/T6) is one owner or sequenced tasks; the
  keymap table (EP-C7, EP-S4's paging keys) likewise. **EP-R1, EP-R2 and EP-R4 all touch Ink's render
  bookkeeping** — EP-R4's cause (the full-screen branch bypassing log-update) is the same subsystem, so
  sequence them under one owner rather than parallelizing blindly.
- Probes precede specs where §6 says probe-first: EP-T4 (SDK transport failure), EP-T3 (plan-kind wire),
  EP-C5 (suggestion source). ~~EP-R0 (mouse)~~ — landed 2026-08-06.

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
- **D8 [DECIDED-AUTO, LANDED 2026-08-06]** MOUSE-1 was a probe, not a build: neither the owner's testimony
  nor `qa2-02` was trusted until the re-probe landed (§5.2). **Outcome: both were right about different
  renderers** (§12 item 17). The decision to withhold trust from both sides is retained as precedent — the
  reconciling fact (a whole second rendering mode) was reachable only by running the program, and would
  have been missed by adjudicating either testimony against the bundle alone.
- **D10 [DECIDED, Wave R grounding]** When owner testimony and fleet measurement conflict, **check what
  configuration each side was running before deciding who is wrong.** Wave R's two largest overturns
  (`qa2-12` withdrawn, MOUSE-1 reconciled) both came from the same root: the fleet's isolated profile and
  the owner's real profile put Claude Code in **different rendering modes**, so the two sides were
  describing different programs. The fleet's isolation discipline is correct and stays — but an isolated
  run measures the *default* configuration, which is not necessarily the one anybody actually uses.
  Rejected alternative: treat owner testimony as lower-grade evidence than instrumented measurement. It
  would have closed both questions wrongly.
- **D11 [DECIDED, Wave R grounding]** **No single instrument is trusted for frame evidence.**
  `capture-frames.py` (pyte) truncates instead of reflowing, so it cannot see resize defects at all;
  `tmux capture-pane` cannot distinguish a painted blank row from an unwritten one, which manufactured
  `qa2-12`. Every frame claim names its instrument, and any claim about repaint or blank space is made
  under at least two (§12 items 12, 16). Rejected alternative: standardize on one instrument for
  comparability — it would trade a known blind spot for an invisible one.
- **D9 [DECIDED-AUTO, Wave T grounding]** Grounding runs BEFORE each wave's feature spec, as three
  parallel workers: bundle transcription, ccx current-state pinning, live probes. Six of Wave T's
  premises were overturned by it (§12) — including one epic that would have chased a nonexistent bug.
  Repeat the pattern for Waves R, S and C.
- **D10 [DECIDED-AUTO]** Wave T's launch-default change is scoped to the REPL host construction, not
  `DEFAULTS.permissionMode`: the latter governs headless `-p`, `--bg` and the daemon, where `auto` is the
  deliberate choice. Alternative (change the shared default) rejected — it would silently re-posture every
  non-interactive surface.
- **D11 [DECIDED-AUTO]** The `rm`-allowed/`touch`-gated classifier ordering is NOT ccx work: the broker is
  installed unconditionally and the SDK's own classifier decides what reaches `canUseTool`
  (`config/types.ts:34-40`, probe 64). Recorded so no future wave re-opens it as a ccx defect.

## §11 Open questions

| Item | Owner | Deadline |
|---|---|---|
| ~~MOUSE-1: does click-to-expand reproduce?~~ **SETTLED 2026-08-06 (§12 item 17)** — yes, live-reproduced, but only inside the **fullscreen renderer**, which the owner runs and the fleet's isolated profile did not. Upstream advertises it in its own switch notice (L453184). Both testimonies stand; the fleet's finding is re-scoped to the inline renderer. No terminal name or screen recording needed | — | closed 2026-08-06 |
| ~~**MOUSE-1 residual (a):** is the `tengu_pewter_brook` remote gate a broad default?~~ **CLOSED 2026-08-06 — the premise was wrong.** The gate reads `false` on this account; the owner is in fullscreen because they opted in explicitly after three upsell impressions. Fullscreen is a promoted opt-in, not a silent rollout (§12 item 17a) | — | closed 2026-08-06 |
| **MOUSE-1 residual (b):** which row does the owner click — the collapsed `Ran N shell commands` summary, or something literally reading `+N lines (ctrl+o to expand)`? The latter was never seen as a click target in fullscreen across twelve polls | Owner | Whenever convenient; does not block Wave R |
| **HLJS-1:** EP-R5 needs a real `highlight.js` dependency to match upstream's diff tokenizing (24-scope truecolor map, ~383 languages). This reverses a recorded decision — `highlight.ts` was written zero-dep *explicitly* because fenced code was a LOW row. **Controller recommends taking the dependency**: same structural work either way, this is P1, fidelity is the programme's stated goal, and ~1 MB is noise beside the SDK's bundled ~270 MB binary. Proceeding on that basis unless overridden | Owner (override only) | Wave R spec review |
| ~~**FULLSCREEN-1**~~ **DECIDED 2026-08-07 (owner, at Wave R close-out): the fullscreen renderer becomes its own wave on the roadmap** — after Waves S and C close this sprint. Scope when it opens: alternate screen, app-owned scrollable viewport, the three mouse affordances (click-to-expand — EP-R0's origin — click-to-position, copy-on-select), and upstream's promoted-opt-in entry (three upsell impressions then explicit opt-in, §12 item 17a). It absorbs the deferred ctrl+o screen-swap divergence and MOUSE-1 residual (b) | — | closed 2026-08-07 |
| ~~`ctrl+e` explain-command feasibility~~ **LANDED**: fully reproducible headlessly — one forced-tool Messages call (`explain_command`, 4-field schema) against the current main model, 3-row render. Scoped into EP-T2 | — | closed 2026-08-06 |
| `#` memory mode and the ccx-extra context %% (qa6-13, qa1-10): keep or drop | Owner, surfaced at Wave C spec review | Wave C spec time |

## §12 Surprises & Discoveries *(living)*

Seeded from triage: the triage omission (`qa4-07`, §5.3); the `listSessions` misread reversal (§5.2);
the protective drift calls (`ctrl+_`, `ctrl+e to show all`, `#` memory — §5.2); `qa3-05`'s amend rows are
the *same mechanism* as EP-T2's input rows (one primitive serves both); the pager close path as the proven
repaint primitive (EP-R1); QA-1's `/history`→`/design-sync` fuzzy-match hazard (now a fleet-brief rule, D6).

**Wave T grounding round (2026-08-06) — six QA premises overturned before a line was written.** Full
evidence in `$CLAUDE_JOB_DIR/tmp/waveT-{bundle-transcription,ccx-grounding,probe-findings}.md`; the
durable facts are transcribed into the Wave T spec.

1. **The plan modal was never broken.** QA's own captured frame proves `PlanDialog` mounted live with
   `kind:"plan"` intact; probe 97 confirms name-driven classification (`toolName === "ExitPlanMode"`) is
   the only signal available — every other options field is undefined — which is exactly what
   `gate.ts:22` already does. A whole suspected-defect epic dissolved into option-parity work (EP-T3).
2. **`╌╌╌` does not exist in 2.1.220.** Zero occurrences bundle-wide; the create-file dialog is an
   unnumbered highlighted block in a dashed-border box, and the numbered diff is the *overwrite* branch.
   The QA description would have had us build the wrong widget (EP-T6).
3. **"Upstream never conflates a directory grant with a command rule" is refuted** — two `Wdi` branches
   do exactly that, and ccx's copy is a faithful transcription. *(Second half corrected during execution:
   this item originally claimed the generic dialog "grants the whole tool everywhere" as a defect QA
   missed. Wave T's spec review refuted that too — see W-T16. The copy is upstream verbatim at L506166,
   the content-less whole-tool rule at L506109, and the grant is scoped to `localSettings`, i.e. the
   project, not "everywhere". It ships unchanged, pinned as canon.)*
4. **The deny-feedback channel works** — the failure is discoverability (no `Tab to amend` hint anywhere)
   plus an inverted empty-submit rule that turns an empty amend into a bare deny.
5. **Bypass mode already exists** (`--permission-mode bypassPermissions`, `/yolo`); the gate is what's
   missing — plus a latent hazard where a *runtime* flip can be refused by the SDK while the status bar
   paints it red anyway (`useChat.ts:1438`'s swallowed rejection).
6. **The retry banner is SDK-provided** (probe 96: `system/api_retry` with attempt/max/delay), so EP-T4 is
   a rendering job, not a synthesis job — but the SDK's terminal frame reports `subtype:"success"` on a
   dead connection, so the failure must be read from `is_error`/`terminal_reason`. A blackholed endpoint
   also burns ~75 s in silence before the first retry event, which is precisely QA's 72-second spinner.

**Wave T execution round — three more premises overturned, this time by workers mid-task.** The grounding
round caught six before any code; these three survived it and were caught only when someone opened the
bundle to implement the change. Recorded in the Wave T spec as W-T16, W-T19, W-T21, W-T22.

7. **The plan modal's empty-Enter was already correct** (W-T21). Task 3's implementer noticed the planned
   "fix" collided with a deliberate F6 acceptance pin and flagged it instead of complying; the bundle
   (L500994) showed upstream denies there, exactly as ccx already did.
8. **The interrupt row already shipped** (W-T19); only one of three sentinels was missing, and the
   tool-form's silence is a deliberate F3 decision the draft would have regressed into double-printing.
9. **The WebFetch No-row copy is upstream verbatim** (W-T22). Task 8's implementer read L506771 and found
   our "broken promise" is Claude Code's own standing idiom — repeated at L544640, near-twinned at L503212,
   and used as the `placeholder` on every input-form decline row. The drafted rewrite was reverted and the
   row pinned as canon; the missing feedback row is deferred as a product question about upstream.

**The pattern across all nine: the QA report described symptoms accurately and diagnosed causes
unreliably.** Every overturn came from reading the canonical bundle rather than from reasoning about the
report. Treat a QA finding's *observation* as evidence and its *diagnosis* as a hypothesis — and note that
three of these nine got past a dedicated grounding round and two independent reviews, surfacing only at the
moment of implementation. Keep implementers licensed to stop and challenge their own brief; the two who did
are the reason items 7 and 9 are in this list.

**Probe-hygiene lesson (probe 97, run 1 discarded):** a live probe with default `settingSources` inherits
this machine's global agents, hooks and skills — the model dispatched a subagent and never reached the
surface under test. Probes needing a clean session must set `settingSources: []`.

**Wave R grounding round (2026-08-06) — opened with two controller-verified facts.** Evidence in
`$CLAUDE_JOB_DIR/tmp/wave-r-controller-notes.md`; both were read first-hand, not delegated.

10. **The comparison target was never the citation target — and it drifts weekly.** `claude --version`
    now reports **2.1.223**, a Mach-O arm64 binary at `~/.local/share/claude/versions/2.1.223` (272 MB,
    no `cli.js`; grep it with `strings -a`). Builds 2.1.221 (Aug 4) and 2.1.222 (Aug 5) sit beside it.
    Canon is the **2.1.220** JS bundle (Jul 30). **The fleet ran 2026-08-05, so every "claude does X"
    in the triage is a statement about 2.1.222**, adjudicated against 220 source. Three releases separate
    the two. This is a standing caveat on the whole corpus, not a MOUSE-1 detail: any live-vs-bundle
    disagreement is a version-drift candidate before it is a misread. It also supplies a clean
    reconciliation route for MOUSE-1 (§11) that no amount of 220-reading could have produced.
11. **The width-resize defect is Ink's erase accounting, not a missing resize handler** (ink 5.2.1).
    `ink.js:83` already subscribes to `stdout.on('resize')` and recomputes layout. The defect is in
    `log-update.js`: `previousLineCount = output.split('\n').length` counts **logical** lines, then
    `eraseLines(previousLineCount)` erases that many **physical** rows. The two agree only while the
    width has not changed since the frame was written. After a shrink the terminal re-wraps the
    already-emitted frame, the erase falls short, and the remainder survives — which is exactly the
    reported hard-wrapped remainder rules and their accumulation across a resize history. A second
    contributor: `if (output === previousOutput) return;` writes *nothing* when a resize yields a
    byte-identical frame, leaving the re-wrapped copy standing. **The mechanism predicts the fleet's own
    control result** — height-only resizes re-wrap nothing, so their erase is exact and they are always
    clean. `ink.js:121` already carries the escape hatch (`outputHeight >= stdout.rows` writes
    `clearTerminal + fullStaticOutput + output`), which is both the shape of the fix and the source of
    the recorded "frame taller than the viewport leaks copies" hazard that EP-R3 must respect.
    **Consequence for EP-R1's `[DECIDED-AUTO]`:** "wire in the pager's clear" is only correct if the
    pager close path actually invalidates that accounting. The decision is provisional until the pager's
    real mechanism is read; the durable requirement is that a width change must invalidate Ink's erase
    accounting, however that is reached.
12. **Claude Code has a second rendering mode the programme had never seen, and the owner runs it.**
    `~/.claude/settings.json` line 268 carries `"tui": "fullscreen"` (controller-verified, read-only).
    Fullscreen enters the **alternate screen buffer** (`ESC[?1049h` in the raw pty bytes) and bottom-anchors
    the prompt; the default is inline with no anchor. Bundle: the wrapper `cZo` (L455844) has three
    branches — fullscreen (L455888) is a `flexGrow:1` sticky scroller over a `flexShrink:0` prompt block
    capped at `rows − 2`; **the default branch (L455996) is a bare fragment with no height and no anchor,
    which is structurally what ccx already does**. `CLAUDE_CODE_NO_FLICKER=1` forces the mode.
    **`qa2-12` is therefore not a defect** — at 100×40 with the screen pre-filled with markers, ccx and
    upstream-default put the composer within one row of each other and *neither* pads below; the "30 blank
    rows" were unwritten pane rows that `tmux capture-pane` cannot distinguish from painted ones. It is
    reclassified from defect to **unimplemented mode**. The larger point outlives the finding: **the
    owner's daily experience of Claude Code is a mode ccx does not implement at all**, so their reports
    and the fleet's isolated-HOME measurements describe two different programs. This also supplies the
    leading MOUSE-1 hypothesis — the alternate screen has no native scrollback, so a fullscreen TUI must
    handle wheel and click itself.
13. **EP-R1's `[DECIDED-AUTO]` is refuted, and upstream's real mechanism is now known to the byte.**
    The ctrl+o pager close path is `onClose={() => setTranscriptOpen(false)}` — a `useState` setter and
    nothing else; there is no clear anywhere in the pager. What the fleet recorded as "the pager close path
    already clears" was just a React re-render rebuilding width-derived strings, which any keystroke does
    equally well, and which does **not** remove the residue. The decision had no referent. What upstream
    actually does (every anchor re-opened and every constant resolved by the controller): it does not ship
    stock Ink's renderer at all (`grep -c previousLineCount` → **0**), owning its own screen cell buffer;
    it subscribes at L180674; it branches on a width mismatch at L178320 into `TJr` (L178440), which emits
    a `clearTerminal` op and repaints every cell. The bytes (L177120, L176982-176990, L166348, L166401-402):
    **inline** = `ESC[H` + (`ESC[2K` `ESC[1B`) × viewportRows + `ESC[H`, **deliberately without `ESC[3J`
    so the scrollback transcript survives**; **fullscreen** = `ESC[2J` `ESC[3J` `ESC[H`.
    A second ccx defect surfaced alongside: **nothing in `harness/src/` subscribes to resize at all**, and
    Ink's own handler only re-runs Yoga layout and re-serializes the existing tree without re-rendering
    React — so width-derived strings freeze at the launch width. Two independent defects; a fix must
    address both. **A naive port of upstream's sequence is wrong for ccx** — upstream's renderer owns the
    whole viewport and can repaint every visible cell, while ccx's visible screen is partly Ink `<Static>`
    output Ink will not re-emit, so erasing the viewport and homing would orphan the transcript. Recorded
    design direction, to be tested rather than assumed: make terminal size real React state, and erase
    exactly the **physical** rows the previous frame occupies *at the new width*.
14. **`qa2-09`'s "self-heals at end of turn" is refuted.** After four mid-turn resizes the grounding run
    saw four `esc to interrupt` rows carrying three different elapsed times in one frame, and after
    interrupting, **every stale spinner row persisted verbatim**. The mid-stream case is worse than filed,
    not better.
15. **Upstream's resize contract, confirmed on the wire, and the design principle behind it.** The bundle
    reading in item 13 was then verified against recorded pty bytes: the first bytes after each `SIGWINCH`
    are `ESC[H` + (`ESC[2K` `ESC[1B`) × N + `ESC[H`, then a full repaint, where **N is the NEW viewport
    height every time** — 24, 24, 40 across a 120×40 → 80×24 → 100×24 → 120×40 sequence. No `2J`, no `3J`.
    **The principle: upstream never consults the previous frame's geometry, so its erase cannot be short.**
    That is the whole difference from Ink, which erases a remembered count. Both sides were proven to be in
    **inline** mode by byte census (zero `ESC[?1049h` in either stream), so the fleet's "claude passes
    15/15" stands and Wave R's target is unambiguously the inline mode. Also measured: **ccx emits zero
    `ESC[H` of any kind — it never positions the cursor absolutely at all.**
    Two candidate seams in ccx were checked and **both rejected for reuse**: `useChat.ts:336` does write
    `\x1b[2J\x1b[3J\x1b[H`, but `3J` wipes the scrollback where ccx's committed transcript lives via Ink
    `<Static>` — reuse its *shape* (a TTY-gated direct stdout write, overridable through `deps`) with an
    erase-viewport payload instead; and bumping `ChatApp.tsx:342`'s `staticEpoch` would be actively harmful,
    since remounting `<Static>` replays the entire scrollback, and a resize does not change the transcript.
    **Stated limitation, not papered over:** upstream's *fullscreen* resize behaviour remains unmeasured —
    an isolated HOME strands 2.1.223 on the pre-REPL onboarding screens, so the gate's consumer never
    mounts. Wave R does not need it (the mode ccx must match is inline), but no claim about fullscreen
    rendering is made from this round. The unblock recipe is a seeded `$HOME/.claude.json` carrying
    `hasCompletedOnboarding` plus a per-project `hasTrustDialogAccepted` / `hasCompletedProjectOnboarding`
    entry, with `ESC[?1049h` in the pty bytes as the proof the mode is actually on.
16. **Our own frame instrument cannot see the wave's P0 defect** (controller-measured, two commands).
    The width defect exists because the emulator re-wraps already-painted output when the pane narrows.
    Measured with one 111-character line in a 120-column pane taken to 80 columns:
    - **tmux reflows** — the line becomes two physical rows (`ceil(111/80)`), and the content growing by
      one row **pushed the top row off the viewport into scrollback**.
    - **pyte does NOT reflow** — it truncates, discarding the overflow and leaving every row in place.
    Since `scripts/capture-frames.py` is built on pyte, **it structurally cannot reproduce `qa2-08`**: a
    regression test written against the standard instrument would pass before the fix, after a wrong fix,
    and with no fix at all. **EP-R1's acceptance must be measured under tmux or a real terminal, and that
    belongs in the acceptance criteria, not in a comment.** The two instruments have opposite blind spots —
    pyte hides reflow defects, `tmux capture-pane` cannot distinguish a painted blank row from an unwritten
    one (item 12) — so neither may be used alone. Checked while writing this: **there is no resize fixture
    or resize regression test in the repo at all** (`scripts/frames/` holds five `.keys` scripts, none for
    resize; the two test files mentioning "resize" assert width-keyed cache eviction and per-snapshot
    `columns()` re-reads, not repaint). So the P0 has zero regression coverage today and the obvious
    instrument for adding it is blind — both halves of that must be fixed together.
    The tmux measurement also adds a requirement no code reading would have surfaced: because a resize can
    push frame rows off the top of the viewport, **an erase count computed from the frame's geometry must
    be clamped to the rows still on screen**, or the erase walks past the viewport top and damages what is
    above it.
17. **MOUSE-1 is settled — the owner is right, the fleet is right, and upstream says so in its own words.**
    Live-reproduced three times: clicking a collapsed tool result expands it. It is **not** "on any
    terminal" — it exists only in the **fullscreen renderer**, which the owner has been in continuously
    (item 12). The mechanism is ordinary SGR mouse reporting (`?1000h ?1002h ?1003h ?1006h`) welded to the
    alternate screen: one component enables both on mount and disables both on unmount. The escapes are
    **composed at runtime from integers** (L177070), which is why grepping a bundle or binary for the
    literal `?1000h` finds nothing — a false-negative trap for any future search. **Not OSC 8**: the fold
    row is plain text, and a hyperlink click can only open a URL, never toggle in-process state.
    **The decisive citation is upstream's own switch notice, L453184** — controller-verified verbatim. On
    switching to fullscreen Claude Code prints "Using flicker-free rendering", then
    `· Click to move your cursor in the text input`, **`· Click to expand collapsed tool results`**, and
    `· By default, text auto-copies when you select it (/config to change)`. Three mouse affordances ccx
    has none of, advertised as the mode's selling points.
    `qa2-02` is **confirmed but mis-scoped**: all-zeros and clean-swallow are accurate for the *inline*
    renderer its isolated profile produced; the implied "upstream has no mouse support" is wrong. Version
    is a red herring — the machinery and the feature string are identical across 220/221/222/223.
    **For ccx this is not a mouse bug.** ccx emits only `?2004` and `?25`, has no alternate-screen mode,
    and already parses SGR mouse only to discard it. Click-to-expand sits downstream of a renderer ccx does
    not have; it should be filed as *missing upstream's fullscreen renderer*, with mouse falling out of
    that work rather than driving it.
    **(a) — corrected by the controller, do not propagate the reporting agent's version.** The report
    attributed the warm-vs-cold difference to a cached remote gate `tengu_pewter_brook` which it "measured
    True". Reading the real config directly: **`tengu_pewter_brook: false`.** So the gate is *off* for this
    account, and cannot be why the owner is in fullscreen. The actual reason is simpler and is right there
    in the same file — the owner **opted in explicitly** (`"tui": "fullscreen"`, settings line 268), having
    been shown the mode's upsell three times (`fullscreenUpsellSeenCount: 3`, alongside `copyOnSelect:
    true`). The report's own decisive experiment agrees and needs no gate: **a cold profile seeded with
    only `"tui":"fullscreen"` produced `ESC[?1049h` plus all four mouse modes on first launch.** The
    setting alone is sufficient.
    What survives, and it is the product-relevant part: **fullscreen is an actively promoted opt-in, not a
    silent rollout.** Upstream repeatedly upsells it and ships a `/tui` command to switch. That is a
    weaker argument than "most users are already in it" for prioritising the renderer, and the priority
    question should be decided on that honest footing (§11 FULLSCREEN-1).
    **(b)** One question only the owner can answer: which row they click — the collapsed
    `Ran N shell commands` summary, or something literally reading `+N lines (ctrl+o to expand)`. The
    latter was never observed as a click target in fullscreen across twelve polls.
    **Reproduction trap worth carrying:** a `pty.fork()` child inherits the parent's cwd and strands on the
    trust dialog, which looks exactly like "fullscreen won't turn on". **Absence of `ESC[?1049h` means
    "never reached the REPL", not "fullscreen is off"** — this is what blocked the parallel agent at
    item 15.
18. **EP-R5's observation is confirmed; its proposed fix shape is not.** Upstream really does tokenize
    inside diff bodies — on one added row, five distinct foregrounds over a single constant background
    (`export`, `const`, an identifier, a string, a number, each its own colour). Two corrections follow.
    **(a) Removed lines are NOT tokenized, and ccx's flat removed row is already correct.**
    Controller-verified verbatim at **L419813**:
    `let { lineNumber: g, marker: y, code: _ } = d[m], E = y === "-" ? [[cWo(o), _]] : i2p(s, _, o), ...`
    — the `-` branch emits one style/text pair; only the non-`-` branch tokenizes. Building highlighting
    into removed rows would be a *regression*. **(b) The composition is band-under-token**: the diff owns
    only the background. Pinned live on a word-diff row where one string token kept a single foreground
    while its background flipped and flipped back; mechanism `ZmH` at L419733 (`{ ...c, background: ... }`).
    **The load-bearing assumption — "the highlighter exists; apply it per diff row" — is wrong.**
    `harness/src/tui/highlight.ts` is a clone of upstream's **markdown fenced-code** map `DhH` (L420495):
    four chalk colours, ten languages, and its own header records the trade — *"zero-dep syntax highlighter
    for fenced code (spec Decision Log: no 1MB dep for a LOW row)"*. The **diff** path is a different
    renderer entirely: real highlight.js behind a 24-scope truecolor map (`K$p`, L419855) over ~383 hljs
    names and aliases. ccx also ported upstream's *fallback* renderer `H2p` (L419987) — the branch upstream
    takes only when highlighting is **off**.
    Mechanically the reuse is possible (`highlightCode` is per-line callable and returns `Segment[]`;
    `Segment` at `render.ts:18` carries `color` and `bg` independently, so band-over-token is a spread),
    but it needs segment-aware wrapping (`diffRender.ts:152` `plainRows` rewrite) and the word-diff arm's
    order inverted — **the same structural work either way**, ending either visibly right or visibly wrong.
    **Controller recommendation, open to owner override (§11 HLJS-1): take the real dependency.** The
    original trade was made explicitly for a LOW-priority surface; this is P1, the programme's stated goal
    is fidelity over convenience, and ~1 MB of `node_modules` is noise beside the Agent SDK's bundled
    ~270 MB CLI binary. Reusing `highlight.ts` costs the same work and still misses the palette and ~373 of
    ~383 languages.
    **One caution the report did not raise:** every RGB above was measured on 2.1.223 under one theme.
    Band colours must be pinned **per theme** before ccx's are called wrong — the fenced-code precedent in
    `highlight.ts`'s header is that upstream's code colours are deliberately theme-*independent*, so the
    diff path's theme behaviour is an open question, not an assumption. Version drift is otherwise nil:
    every RGB matches a 2.1.220 constant, and `strings -a` on the 223 binary still carries
    `Monokai Extended`, `addDecoration`, `deleteWord`.
    **Caution resolved, and it grows the epic (controller, L419855-419856).** Opening that line shows
    **three** maps side by side, not one: `K$p` is the Monokai/dark map the live measurement caught
    (`keyword` rgb(249,38,114), `string` rgb(230,219,116)); `Y$p` is a **light** map with entirely
    different values (`keyword` rgb(167,29,93), `string` rgb(24,54,145)); and `jmH` is a **256-colour
    fallback** built from palette indices (`Z3(13)`, `Z3(14)`, `Z3(12)`…) for terminals without truecolor.
    So unlike the fenced-code map, **the diff highlighter IS theme-dependent, and it also degrades for
    non-truecolor terminals** — EP-R5 must ship three palettes, not one, and ccx's band colours cannot be
    judged wrong until the comparison is made per theme. Two further requirements surface on the same
    lines: `X$p` (L419856) maps bare **filenames** to languages (`Dockerfile`, `Makefile`, `Rakefile`,
    `Gemfile`, `CMakeLists`), so language detection is not extension-only; and `uAr()` (L419858) reads
    `CLAUDE_CODE_SYNTAX_HIGHLIGHT`, i.e. highlighting is **gated**, which is exactly why the fallback
    renderer `H2p` that ccx already ported exists. All of this strengthens HLJS-1's recommendation: the
    scope is a faithful three-palette hljs port, and hand-extending a four-colour lexer to reach it is not
    a smaller job than taking the dependency.
19. **The reset cluster: all three confirmed, all three diagnoses on file wrong, and EP-R2 does not
    depend on EP-R1 the way the spec assumed.**
    **`qa5-01` (`/clear` blank pane).** The erase happens and the cursor is homed correctly — ccx's own
    code is fine (`useChat.ts:336` already emits `\x1b[2J\x1b[3J\x1b[H`). **The repaint is never written**,
    because Ink's `Instance.clear()` (`ink.js:213`) resets log-update's counters but **not
    `this.lastOutput`**, so the post-clear frame is byte-identical to the pre-erase one and the dedupe at
    `ink.js:132` (`if (!hasStaticOutput && output !== this.lastOutput)`) skips the write. It is
    byte-identical precisely because the transcript lives in `<Static>` — the dynamic frame (composer,
    status bar) is unchanged by a clear. The `hasStaticOutput` escape is closed by the same event: wiping
    `<Static>` makes `staticOutput === '\n'`, which the guard at `ink.js:103` treats as empty.
    **Therefore a clear-only primitive fixes `qa2-08` but leaves `qa5-01` broken** — ccx already erases;
    the blocker is Ink's dedupe. **EP-R2 needs its own remedy and cannot be a consumer of EP-R1's.**
    **`qa2-11` (pager border debris).** Raw pty shows **zero bytes** for 8 s after Escape, then an erase
    of 7 lines for a frame that occupied ~36. Cause: the pager frame is taller than the pane, so Ink takes
    the full-screen branch at `ink.js:121` and writes **straight to stdout, bypassing log-update entirely**,
    leaving `previousOutput`/`previousLineCount` stale. This is the concrete mechanism behind the
    programme's recorded "a frame taller than the viewport leaks copies" hazard — that branch does not just
    cost a redraw, it **desynchronizes the renderer's bookkeeping** for everything that follows.
    **`qa2-06` (committed placeholder).** The filed repro does **not** reproduce (clean across nine submits
    with a scrolled transcript). It reproduces **only after a width change**, and it is neither `<Static>`
    nor an echo: it is un-erased dynamic composer output, from the same logical-vs-physical count as
    item 11. **It merges into EP-R1 and should not be a separate P4 item.**
    **Upstream, for contrast:** `/clear` emits no escape of its own — the renderer owns it, through one
    forced-repaint primitive (`forceRedraw` → `forceFullReset` → `TJr(next, "clear"|"resize"|"offscreen")`).
    Live inline claude repaints the whole block with zero keystrokes and keeps the `❯ /clear` echo. Two
    divergences to record: upstream inline erases only the viewport (**no `3J`** — ccx wipes scrollback),
    and ctrl+o swaps the whole screen rather than overlaying.
    **The shared-primitive question, answered properly:** yes, one capability underlies all four findings —
    *ccx cannot void the render stack's caches and force a full, correctly-sized repaint* — but the spec's
    stated rationale for it was false (there is no good pager path to generalize) and its dependency edge
    was backwards. Ship EP-R1 as "erase on resize"; EP-R2 is a separate fix for a separate cache.

20. **EP-S1's defect is real, but the session transcript is a TREE and every proposed fix so far assumed a
    list.** Controller-measured live (keyed, isolated HOME, 2026-08-07). The rewind executes *correctly at
    the data layer*: after restoring to the point before `TWO`, the next user row's `parentUuid` points at
    the assistant row of `ONE` (`parent=2b996d94`), i.e. the conversation forked exactly where it should.
    What is wrong is only the **replay**: `rebuildAfterRewind` calls `getSessionMessages(id)` and hands the
    flat row list to `replayDocument` (`useChat.ts:1288-1303`), so all three turns render above a
    `⏪ rewound here · live` marker. **`parentUuid` appears nowhere in `src/`** — nothing walks the branch.
    **The persisted file is append-only and is NEVER truncated:** measured 19 rows before the rewind → 20
    immediately after it settles → 24 after one follow-up turn, same file throughout. That kills two fixes:
    the spec's `[DECIDED-AUTO]` ("poll until the file's tail matches the rewind anchor") can never succeed,
    because the tail never becomes the anchor; and the grounding worker's cheaper alternative (slice the
    rows at `prevUuid`) is still list-thinking — it holds for one rewind, but two rewinds leave sibling
    branches interleaved in file order, which only the parent chain disambiguates. **The fix is to replay
    the branch: walk `parentUuid` from the newest leaf back to the root.** Rewriting EP-S1 accordingly.
    **Second finding, unfiled by anyone: ccx cannot rewind to its own first message.** That anchor has no
    `prevUuid`, `defaultRestoreOption` therefore computes `conversation: false`, and the confirm panel
    renders with **no restore option at all** — a single row reading `1. Never mind` under the lines
    `The conversation will be unchanged.` / `The code will be unchanged.` Frame kept at
    `waveS-04-first-anchor-unrestorable.txt`. It belongs to EP-S3 (the confirm panel's option set).
    **Instrument lesson, and it is the sharpest of the sprint — FIVE bugs in one 180-line repro script,
    every one of which produced a confident wrong answer rather than an error.** (a) The turn-wait needle
    matched the prompt's own echo, so the script submitted `THREE` while `TWO` was still in flight.
    (b) The picker needle `ewind` matched the *footer's* permanent `Esc rewind · ? help`, so `waitfor`
    returned before the dialog existed. (c) Keys sent during the dialog's open transition are swallowed, so
    blind `Up Up` left the cursor on `(current)`, whose Enter is a no-op that looks like a successful
    rewind. (d) The transcript renders every submitted prompt with the **same `❯` glyph** the picker uses
    for its cursor, so a `❯ <label>` needle matched scrollback and reported "cursor on ONE after 0 Ups"
    while it was still on `(current)` — the needle must carry the dialog's `│ ` border. (e) The rewind
    pre-fills the composer, so a later `type_line` concatenated onto it (`Reply with exactly: TWO/export …`)
    and the failed `/export` looked exactly like `qa5-03`'s session-handle defect. **Every ccx TUI repro
    must assert on dialog-scoped needles and verify state after each keystroke**; a run that "reproduces"
    on the first try deserves the same suspicion as one that fails.

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
- v1.1 (2026-08-06): Wave T grounding round folded in. Rewrote EP-T1 through EP-T6 against the bundle
  transcription, the ccx pinning and probes 96/97; added D9–D11; seeded §12 with the six overturned
  premises; closed the `ctrl+e` open question. Reason: six of Wave T's premises were factually wrong and
  building from them would have produced the wrong widgets (a `╌╌╌` diff frame, a plan-classification fix
  for a working classifier, a grammar "fix" that diverged from canon).
