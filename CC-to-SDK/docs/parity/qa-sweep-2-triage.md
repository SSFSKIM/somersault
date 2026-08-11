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

### W2 · Dialog input regression + long-standing feedback loss
- **s2qa3-10 (P2, regressed)** — Enter on an amended deny row reverts the amendment instead of
  submitting; first Enter silently swallowed (Write and Bash dialogs alike).
- **s2qa3-12 (P2, persists = qa3-18)** — plan option 3 "Tell Claude what to change" rejects
  immediately instead of parking for feedback. Second sweep to file it.
- **s2qa4-11 (P2, new)** — double Ctrl-C inside an open dialog does not exit ccx; claude exits 0.
- **s2qa3-11 (P2, new)** — raw `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning printed into the TUI
  after the bypass gate is accepted (stderr leak into the frame).

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

### W4 · statusLine stdin contract gaps
- **s2qa6-04 (P2, new)** — `transcript_path` never emitted; `session_id` null at startup and after
  `/clear`.
- Tail: `fast_mode`/`prompt_id`/`rate_limits` absent, `context_window_size` 0 pre-first-turn
  (s2qa6-05); stale-forever vs claude's remove-row-on-failure (s2qa6-06, divergence-question);
  refresh triggers missing Ctrl-C + resize (s2qa6-22); SGR 2 dim vs palette grey 246 (s2qa6-23).

### W5 · Repaint, round two (real cells only — see §4 for the discarded one)
- **s2qa2-06 (P2, new)** — no transcript reflow on width change; old paint hard-wraps mid-word.
  (Claude fully re-wraps. Valid at 40-row cells where both TUIs are in the main-screen renderer.)
- **s2qa2-07 (P2, new)** — rapid resize burst leaves permanently stacked stale composer rules.
- **s2qa2-05 (P2, persists = qa2-10, narrowed)** — growing out of a height-clipped picker strands a
  stale copy of its header.

### W6 · /resume preview
- **s2qa4-13 (P2, new)** — preview leaks raw `<command-name>`/`<local-command-stdout>` envelope
  tags. Cheap, ugly, user-visible.
- **s2qa4-14 (P2, persists = qa4-07)** — preview is an excerpt, not the rendered transcript.

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
