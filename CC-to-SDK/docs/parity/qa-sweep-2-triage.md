# QA Sweep #2 — delta triage

Recurring sweep per umbrella spec D6 (`docs/superpowers/specs/2026-08-06-qa-sprint-waves-design.md`),
run 2026-08-10 against ccx at `d699e0839c` (the Wave C close commit — all four repair waves T/R/S/C
shipped). Six domain agents, same domains as sweep #1, each brief regression-first with a mandatory
`delta` field per finding. Corpus: `docs/parity/qa-findings/findings-s2qa{1..6}-*.jsonl` + frames in
`frames-s2qa{1..6}/`. Comparison binary: installed `claude` **2.1.226** (canon corpus remains pinned
to **2.1.220** — six patches of drift; see §5).

Isolation held on all six agents: real `~/.claude/ccx/prefs.json` mtime byte-identical at every
agent's start and end (`1786340224 Aug 10 14:37:04 2026`, the dispatch baseline). One new real-roster
entry appeared during the window; two agents independently proved it was not theirs (cwd = the real
harness dir, process start predates the fleet). Attributed to a concurrent non-fleet session.

**This document is input to the next planning round.** Per the umbrella's scope freeze, nothing here
enters a wave by itself.

---

## 1 · Scoreboard

131 findings: **51 fixed · 43 new · 33 persists · 4 regressed** — by severity: 4 P1 (3 of them
`fixed` verdicts), 30 P2 (13 `fixed`), 44 P3, 53 P4.

| Agent | domain | total | fixed | new | persists | regressed |
|---|---|---|---|---|---|---|
| s2qa1 | composer & input | 21 | 5 | 7 | 8 | 1 |
| s2qa2 | resize & repaint | 14 | 5 | 6 | 3 | 0 |
| s2qa3 | permissions & trust | 23 | 7 | 7 | 8 | 1 |
| s2qa4 | pickers & dialogs | 22 | 7 | 10 | 5 | 0 |
| s2qa5 | lifecycle & session truth | 28 | 15 | 5 | 7 | 1 |
| s2qa6 | chrome & F7 | 23 | 12 | 8 | 2 | 1 |

## 2 · The sprint's claims verify

Every headline defect the four waves shipped against is **independently confirmed dead**, each with
frames on file:

- **Both sweep-1 P1s.** `qa3-03` undialoged writes: ccx now launches in manual mode and gates
  Write/mutating-Bash identically to claude (s2qa3-01/02). `qa2-08` width repaint: 16/16 matrix
  cells clean, mid-stream resize keeps one spinner, shrink-and-restore leaves no residue
  (s2qa2-01/02/03).
- **Wave S truth family**: `/clear` blank pane, untrimmed rewind replay (screen and model agree),
  resumed-session number truth cross-process and in-process, `/cost` cache tokens, post-`/clear`
  stale-number reset, `/export`-after-rewind, short-id `--resume`, `--continue`
  (s2qa5-01/03/06/07/09/14/17/18/26/27).
- **Wave C chrome**: one-row footer with right region, decaying effort hint, statusLine hook render
  slot/dim/turn-boundary refresh, terminal title incl. reset-on-/clear, draft-collapsed footer,
  mode-chip parity, spinner token counter + completion line, `--version/--help/doctor`
  (s2qa6-01/02/03/07/09/10/11/12/13).
- **Wave T dialog ladder**: shift+tab order, auto-mode explainer copy, bypass consent gate (D7),
  plan option 1 wording, don't-ask-again round-trip (s2qa3-03/04/05/07/08).
- **The silent-network P1 class**: dead in both domains that probed it — retry ladder by ~30s,
  terminal `API Error` line byte-identical to claude's (s2qa5-24, s2qa6-08).

## 3 · Open worklist (ranked)

> **Disposition added 2026-08-11 (post-wave).** The triage text below is left exactly as filed — the
> `STATUS` lines are appended, nothing is rewritten. W1–W6 became the QA wave-2 delta (spec
> `docs/superpowers/specs/2026-08-11-qa-wave-2-delta-design.md`, ten tasks, acceptance A1–A10 all passing
> as written after a two-cell fix round). Parity re-scored in `docs/parity/tui-ux.md`'s wave-2 recount.

### W1 · `/copy` is broken and violates the boundary rule
*(filed P1 by the fleet; owner-adjudicated **P2** 2026-08-11 — no open P1 remains in the sweep)*
- **s2qa5-21 (P2, regressed)** — fresh foreground session, two completed replies on screen:
  `/copy` answers "nothing to copy".
- **s2qa5-22 (P2, new)** — resumed session: `/copy` pins to the FIRST assistant message of the
  replay, never advances, and survives two `/clear` boundaries — cleared-conversation text lands on
  the clipboard. A direct inversion of Wave S's measurement-dies-with-its-conversation rule, in a
  command Wave S never audited (its nine-surface fix predates no `/copy` cell in any wave grid).
- One defect family: whatever index `/copy` reads is not the live transcript's. Highest-priority
  candidate for the next fix round.

**STATUS (wave 2, Task 1) — SHIPPED, both.** s2qa5-21 and s2qa5-22 are one family and died together:
`/copy` reads the live wire and resets at `replaceDocument`, so it cannot pin to a replayed reply or
survive a `/clear`. API-error frames are filtered on both paths (live flag; disk `<synthetic>` marker,
because the session store strips the flag from persisted rows). Empty state is now canon's `No assistant
message to copy`. **Newly named, not shipped:** canon's `/copy N` over a 20-deep list (L444892/445068) —
backlog, and it marks the `/copy` parity row ✅ → 🟡.

### W2 · Dialog input regression + long-standing feedback loss
- **s2qa3-10 (P2, regressed)** — Enter on an amended deny row reverts the amendment instead of
  submitting; first Enter silently swallowed (Write and Bash dialogs alike).
- **s2qa3-12 (P2, persists = qa3-18)** — plan option 3 "Tell Claude what to change" rejects
  immediately instead of parking for feedback. Second sweep to file it.
- **s2qa4-11 (P2, new)** — double Ctrl-C inside an open dialog does not exit ccx; claude exits 0.
- **s2qa3-11 (P2, new)** — raw `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning printed into the TUI
  after the bypass gate is accepted (stderr leak into the frame).

**STATUS (wave 2, Tasks 2/3/4 + the acceptance fix) — all four SHIPPED.**
- s2qa3-10 — SHIPPED. `Select` gained an `onEmptySubmit` seam; an amended row submits on Enter, an empty
  one stays open with a nudge and the footer advertises `enter send · esc cancel`.
- s2qa3-12 — SHIPPED, and the fault was downstream of the dialog: `gate.ts` fabricated `"User rejected
  the plan. Continue planning."`, which the model obeyed. Removed. A bare rejection now **ends the turn**
  via the SDK deny arm's `interrupt` field (probe 106) — found only because live acceptance cell A4 failed
  and the verifier drove the same sequence against installed claude 2.1.227. **Residual:** the transcript
  row reads `⎿ Interrupted · What should Claude do instead?` where upstream reads `User rejected Claude's
  plan:` — new 🟡 parity row, backlog.
- s2qa4-11 — SHIPPED, **partially**: `ctrl+c` nulls dropped from six overlay contexts and an armed exit
  renders its hint over pane-owned surfaces. **Residual:** the `?` shortcuts overlay still swallows
  `ctrl+c` (it takes a preemptive swallow scope above the binding table) — backlog.
- s2qa3-11 — SHIPPED. Node's warning channel is taken over at the ccx entry: SDK-coded warnings to a debug
  seam, everything else re-printed once above the frame. Dropping `canUseTool` in bypass was rejected as
  unsafe (D-W3).

### W3 · Effort surfaces: right shape, wrong transaction semantics
First fleet contact with Wave C's effort work found the dialogs exist and survive model swaps
(s2qa4-02/21 pass), but:
- **s2qa4-05 (P2, new)** — `/model` effort row commits live on ←/→; Esc does not revert (claude
  treats the picker as a transaction).
- **s2qa4-06 (P2, new)** — effort stays adjustable with the cursor on Haiku; claude locks it with
  "Effort not supported for Haiku".
- P3/P4 tail: no `ultracode` level (s2qa4-07 — 2.1.226 addition, version-drift), stepper vs
  claude's slider (s2qa4-08), `help`/`current`/`auto` sub-verbs rejected (s2qa4-09 — a recorded
  Wave C owner knob, now fleet-confirmed), silent `/effort <level>` apply (s2qa4-10), no persistent
  idle-chrome surface for non-default effort (s2qa4-20).

**STATUS (wave 2, Task 5).** s2qa4-05 SHIPPED — the picker stages locally and commits on Enter across all
three commit paths, guarded on the dirty flag **and** the picked model's own axis (canon's second effort
write, which both the grounding and the implementer had misread); Esc reverts. s2qa4-06 SHIPPED — the
support gate's polarity was inverted (`supportsEffort === true`), and the live catalog omits the field for
haiku precisely because haiku has no axis (probe 103). s2qa4-10 SHIPPED as the wave's one folded tail item
— `/effort <level>` prints a `⎿` confirmation. **Not shipped, unchanged:** s2qa4-07 (`ultracode` — label
corrected: it exists in 2.1.220 behind the Workflows gate, L441199/76284, and ccx has no Workflows
surface, so it is parked rather than merely unbuilt), s2qa4-08 (stepper vs slider), s2qa4-09 (sub-verbs),
s2qa4-20 (idle-chrome surface). **Newly named:** `/effort`'s Esc prints nothing where canon prints
`⎿ Cancelled` — backlog.

### W4 · statusLine stdin contract gaps
- **s2qa6-04 (P2, new)** — `transcript_path` never emitted; `session_id` null at startup and after
  `/clear`.
- Tail: `fast_mode`/`prompt_id`/`rate_limits` absent, `context_window_size` 0 pre-first-turn
  (s2qa6-05); stale-forever vs claude's remove-row-on-failure (s2qa6-06, divergence-question);
  refresh triggers missing Ctrl-C + resize (s2qa6-22); SGR 2 dim vs palette grey 246 (s2qa6-23).

**STATUS (wave 2, Task 6 + the acceptance fix).** s2qa6-04 SHIPPED — `transcript_path` and `prompt_id`
latch off the headless-firing `UserPromptSubmit` hook (probe
`104-userpromptsubmit-transcript-path.ts`; both absent pre-first-turn, since `SessionStart` is dormant
headlessly — accepted and documented), and `session_id` is mint-and-reconcile, so it is never null.
s2qa6-05 SHIPPED except its `context_window_size` half's boundary case: `fast_mode`, `rate_limits` and a
real window at first paint all ship, but there is deliberately **no boundary read** (D-W8 — it would
reverse Wave S's hidden-until-measured rule; s2qa5-10 returns to the backlog). s2qa6-06 SHIPPED as the
**divergence question answered against ccx**: canon removes the row on failure (L484981), so Wave C's
keep-last-good is reversed (D-W6). Also fixed, found by acceptance cell A8 failing live: boot fired the
command twice and a turn fired it twice with a stale first reading — now one run per boot and one refresh
per turn, carrying that turn's own numbers. **Adjudicated NOT defects against canon:** s2qa6-22 (2.1.220
has no Ctrl-C/resize trigger — 2.1.226 drift) and s2qa6-23 (ccx's SGR 2 already matches canon; the sweep
compared 2.1.226's grey). **Newly named divergence:** the first row lands ~1.5 s after mount, because the
boot run waits on a context read measured at ~1.2 s (D-W11).

### W5 · Repaint, round two (real cells only — see §4 for the discarded one)
- **s2qa2-06 (P2, new)** — no transcript reflow on width change; old paint hard-wraps mid-word.
  (Claude fully re-wraps. Valid at 40-row cells where both TUIs are in the main-screen renderer.)
- **s2qa2-07 (P2, new)** — rapid resize burst leaves permanently stacked stale composer rules.
- **s2qa2-05 (P2, persists = qa2-10, narrowed)** — growing out of a height-clipped picker strands a
  stale copy of its header.

**STATUS (wave 2, Task 7).** s2qa2-05 SHIPPED — a grow-edge resync latched in ccx's pre-Ink resize
listener, because Ink's synchronous repaint both strands the header and zeroes the gate before effects
run; the reviewer falsified the pre-fix gate on hardware and verified the latch (`Select model` ×2 → ×1).
The matrix gains a permanent `g1` clip-then-grow cell and runs 8/8. s2qa2-07 **PARTIAL, honestly** — a
burst now settles once (trailing debounce plus a direction-independent post-settle pass claiming only the
legs no per-write correction measured), but a **drag faster than the handler** strands residue no
width-history repair can reach, because the handler never observes those legs; the earlier "12 ms" figure
is withdrawn for having no recorded method. s2qa2-06 **NOT SHIPPED** — out of wave scope, parked into
**FULLSCREEN-1** (D-W5): inside the current Ink `<Static>` renderer every honest fix either duplicates the
transcript into scrollback per reflow or needs the `ESC[3J` wipe Wave R rejected. Owner input wanted on
whether FULLSCREEN-1 gets scheduled; 2.1.226's alt-screen-at-24-rows default makes it more urgent.
**Instrument finding:** matrix cell `a3` is dead — see §5, item 5; filed, not papered over.

### W6 · /resume preview
- **s2qa4-13 (P2, new)** — preview leaks raw `<command-name>`/`<local-command-stdout>` envelope
  tags. Cheap, ugly, user-visible.
- **s2qa4-14 (P2, persists = qa4-07)** — preview is an excerpt, not the rendered transcript.

**STATUS (wave 2, Task 8).** s2qa4-13 SHIPPED, fully — the preview renders the projected transcript
(`projectCompact(replayDocument(...))` composed with `projectPending`; compact alone withholds the
trailing fold run, so a session ending in a tool call previewed without it), so there is no envelope-tag
text left to leak. s2qa4-14 SHIPPED **partially** — the preview IS the rendered transcript now,
tail-anchored in-pane with `↑ N more above` and a floor marker when the 200-message window cut, and the
count-vs-rows invariant holds on one predicate; but canon (L476605) **replaces the picker full-screen**
under its own footer, and the in-pane form is a recorded divergence (D-W9) whose takeover is a separate UI
unit in the backlog. **Newly named, not shipped:** `<system-reminder>` meta rows draw raw in the pane
**and** in live replay (new ❌ parity row; fix sites `species.ts`/`rows.ts`, with `getSessionMessages`
`isMeta` preservation unprobed), and an image-only session renders the empty state over a nonzero count
(the qa4-07 ii family).

The P3/P4 body (44+53 rows) stays in the findings files; persists-rows keep their sweep-1 ids in
their titles so the chain is greppable. Notable singles: plan-authoring leaks raw `Write`/
`ExitPlanMode` tool rows where claude renders a plan card (s2qa3-18); `/rename` never reaches the
fleet roster (s2qa5-05); roster `state:"working"` for idle sessions persists (s2qa5-23 = qa5-18).

## 4 · Adjudications — filed but not defects

- **The vanished composer placeholder** (s2qa1-08, s2qa6-18, echoed by s2qa2-11): **deliberate,
  already recorded.** Wave C Task 12 gave `promptSuggestionEnabled` a real owner and ccx defaults
  it OFF where upstream defaults on; the `Try "…"` template rides the same key upstream, so the
  blank composer is the spec's "accepted knock-on" (`ChatComposer.tsx` prop docs). An owner knob,
  not a regression: flipping the default (or splitting the placeholder off the suggestion key)
  restores it whenever the owner wants.
- **"No bottom-anchoring" (s2qa2-08, filed as qa2-12-persists): discarded as a defect.** Wave R
  withdrew EP-R3 — ccx matches upstream's *default* main-screen renderer; bottom-anchoring belongs
  to the fullscreen renderer ccx doesn't implement (open question FULLSCREEN-1). The re-appearance
  is explained by s2qa6-19: claude **2.1.226 auto-enters the alternate screen at 24-row panes**, so
  every 24-row cell compared different renderers — the exact D10 instrument confound, now
  version-triggered. Folds into FULLSCREEN-1 with new urgency: at small panes, *default* claude is
  now the fullscreen renderer.
- **Inline chips absent** (s2qa6-14): closed by owner decision D-C3, correctly filed as such.

## 5 · Environment facts for the next sweep

1. **Installed claude is 2.1.226; canon stays 2.1.220.** Domains where 2.1.226 visibly moved:
   two-Escape clear semantics (s2qa1-05), `ultracode` effort + `/effort` slider (s2qa4-07/08),
   alt-screen-at-24-rows (s2qa6-19). Sweep findings against moved surfaces carry
   `"version-drift?": true`; none were adjudicated against 2.1.226 as canon.
2. **`qa-driver.md` rot fixed in this commit**: the ccx ready-needle `⏎ send` no longer exists
   (Wave C removed the hint row; footer now mirrors claude's `⏸ manual mode on · ? for shortcuts`).
   All six agents burned a timeout on it before switching to `⏸ manual mode on`. §4.2's
   "neither TUI ever enables mouse reporting" is also stale at ≤24 rows for 2.1.226.
3. **`/copy` probes touch the real system clipboard** — the one surface `HOME` isolation cannot
   scope. Future briefs should note it; the operator's clipboard was overwritten this sweep.
4. Fleet mechanics held: six agents in parallel on one tmux server, prefix-scoped sessions,
   individual kills, zero cross-agent interference, zero real-`~/.claude` writes.
5. **Resize-matrix cell `a3` is dead — Wave C instrument repair, still open.** Found during wave
   2's Task 7 fix round, the first keyed matrix run since Wave C: a3 skips keyless, so nobody had
   run it live since Wave C Task 6 replaced the spinner tail (canon `C0p`: no interrupt offer in
   the parenthetical) and moved `esc to interrupt` to the footer hint list. a3's
   `spinner_rows`/`elapsed_rows` needles now count the footer and match nothing, failing a healthy
   build. Mechanism documented in the matrix script above the two functions (re-review verified it
   at source). Re-authoring needs its own live iteration against a streaming turn (spinner glyph
   row + clock behind a width gate and 16 s quiet threshold) — same rot class as item 2: the
   instrument rots under the code it verifies, and credential-gated cells rot invisibly.
