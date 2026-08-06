# Wave R — Repaint & Geometry: "the renderer's caches must be voidable"

> **Living document.** `## Decision Log`, `## Surprises & Discoveries`, `## Outcomes & Retrospective` and
> `## Revision Notes` stay current through execution. Acceptance is observable behavior only.
>
> **Parent:** `2026-08-06-qa-sprint-waves-design.md` §6 Stream R. Findings corpus:
> `docs/parity/qa-sprint-1-triage.md` (clusters C1, C1b; worklist rows 2, 3, 10, 11 and the P4 chrome
> block). This spec supersedes the triage's Wave R mission wherever the grounding round contradicted it —
> which is nearly everywhere.
>
> **Grounding evidence (2026-08-06, five parallel workers + controller verification).** Every canon claim
> carries a `cli.pretty.js` line citation from `~/claude-code-bundle/2.1.220/`; every current-state claim
> carries a `harness/src/...` or `harness/node_modules/ink/...` file:line. Raw worker reports:
> `$CLAUDE_JOB_DIR/tmp/wave-r-g{1,2,3,4,5}-*.md`; controller's independent notes and the citations he
> re-opened himself: `$CLAUDE_JOB_DIR/tmp/wave-r-controller-notes.md`.
>
> **Baseline:** `main` @ a2329ca2e1. Canon = the installed DEFAULT 2.1.220 build, **inline renderer**
> (see W-R1 — the mode distinction is new to this wave and is load-bearing throughout).

## Purpose

A person resizing their terminal while using `ccx` should see the interface it would have drawn had it
started at that size. Today it sees wreckage: every width the window has ever been leaves a horizontal
rule behind, the composer is drawn two or three times, and during a streaming turn three different
elapsed-time spinners can sit on screen at once. `/clear` leaves nothing at all until a key is pressed.

Wave R does not add a feature. It repairs the one thing a terminal program cannot get wrong and still be
trusted: **that what is on screen is the current frame, and nothing else.**

Concretely, when this wave lands:

- Resizing the window in either direction, at any moment including mid-turn, leaves exactly one composer
  block and no leftover rules — and resizing back to where you started looks like you never left.
- `/clear` redraws the banner, composer and footer immediately, with no keystroke, and without destroying
  the scrollback above it.
- Opening and closing the transcript pager leaves no torn border fragments behind, and a resize afterwards
  still erases correctly.
- The body of an Edit diff is syntax-highlighted the way Claude Code highlights it — added and context
  lines tokenized, removed lines deliberately flat, the diff band under the tokens rather than over them.

**What this wave is not.** Two items the triage assigned here have left it. `EP-R0` (click-to-expand) is
closed with no code: it is real, but it belongs to upstream's fullscreen renderer, which `ccx` does not
implement at all. `EP-R3` (bottom-anchored composer) is withdrawn: measured properly, `ccx` already
matches upstream's default, and the reported defect was an artifact of the measuring instrument. Both are
recorded in the parent spec §12 items 12 and 17, and both feed the open FULLSCREEN-1 question rather than
this wave.

## Acceptance (the wave gate)

Each criterion is checked in the isolated-HOME tmux harness (`docs/parity/qa-driver.md`), re-running the
QA finding's own repro. `[BEHAVIOR]` markers are what a reviewer observes, not what the code contains.

**Instrument rule, binding on every criterion below (W-R2).** No frame claim is made from a single
instrument. `capture-frames.py` runs on pyte, which **truncates instead of reflowing** and therefore
cannot reproduce the width defect at all; `tmux capture-pane` **cannot distinguish a painted blank row
from an unwritten one**. Criteria A1–A5 must be measured under **tmux or a real terminal**; any criterion
asserting blankness must additionally pre-fill the screen with a marker character so unwritten rows are
distinguishable. A criterion measured only under pyte is not met, however green it looks.

1. **A1 (qa2-08, P1)** The QA-2 width matrix re-runs green in every cell: from a session with content on
   screen, shrinking the width leaves exactly one composer block and zero leftover rules; growing it does
   the same; and returning to the launch geometry is indistinguishable from never having resized.
2. **A2 (qa2-01)** After a sequence of three or more different widths, no rule from any intermediate width
   remains. (The filed defect is specifically that residue *accumulates*, one copy per width visited.)
3. **A3 (qa2-09)** Resizing during a streaming turn leaves one elapsed-time spinner and one
   `esc to interrupt`. **After interrupting, no stale spinner row survives** — the finding's claim that
   this self-heals at end of turn is refuted (parent §12 item 14), so the criterion tests the interrupt
   path explicitly rather than assuming recovery.
4. **A4 (qa2-10a)** Resizing while the `/model` picker is open leaves no stale narrow copy of the picker
   above the live one.
5. **A5 (qa2-06)** Submitting a prompt after a width change leaves no composer placeholder above the
   submitted prompt. (This finding moved here from EP-R4: it does not reproduce as originally filed, only
   after a resize — parent §12 item 19.)
6. **A6 (qa5-01, P0)** Typing `/clear` redraws banner, composer and footer **with zero keystrokes**,
   within one frame. Measured with the marker pre-fill so "blank" is proven rather than inferred.
7. **A7 (`/clear` fidelity)** After `/clear`, **the scrollback above the viewport is intact**. Upstream's
   inline reset erases the viewport only, deliberately omitting `ESC[3J` (L177120, L176988); `ccx`
   previously sent `\x1b[2J\x1b[3J\x1b[H` at `useChat.ts:336` and wiped it. *(Amended at Task 7: the
   original criterion also required the `❯ /clear` echo to survive — false. The echo is painted inside
   the viewport moments before the reset, and upstream's `clearTerminal` event carries
   `viewportRows: e.viewport.height` (L178442, controller-verified), i.e. the whole viewport is erased,
   echo included. What survives is exactly what had already scrolled above — which is what the `3J`
   was destroying.)*
8. **A8 (qa2-11)** After opening and closing the ctrl+o pager, the scrollback contains no modal-border
   fragments — **and a width change performed immediately afterwards still satisfies A1**. The second
   half is the real test: the pager's damage is to the renderer's bookkeeping, so a fix that only cleans
   the visible debris leaves the cause in place.
9. **A9 (qa2-03, P1)** An Edit tool row shows token-level colours inside **added and context** lines, a
   **single flat run** on removed lines, and a word-diff boundary that changes only the background colour
   while the token's foreground stays constant.
10. **A10 (qa2-03, palette)** The token colours match upstream **for the active theme** — dark and light
    are different maps (`K$p` / `Y$p`, L419855), and a non-truecolor terminal degrades to the palette-index
    map (`jmH`, same line) rather than to no colour.
11. **A11 (qa2-03, language detection)** An edit to a file named `Dockerfile` (no extension) is highlighted
    as dockerfile, per upstream's filename map `X$p` (L419856).
12. **A12 (regression coverage)** A resize regression test exists and runs in CI under a **reflowing**
    emulator. There is none today; A1–A5 are otherwise unprotected against reintroduction.

---

## SP-R0 · Spike: which erase strategy survives real terminals — **gates EP-R1**

**Deliverable is knowledge, not code.** The whole wave's P0 rests on a choice that cannot be made by
reading source.

**The question.** `ccx` must erase the previous frame before repainting it at a new width. Two candidate
strategies exist and they fail in opposite conditions:

- **(a) Computed physical-row erase.** Compute the rows the previous frame *now* occupies at the new
  width, `Σ max(1, ceil(displayWidth(line) / newWidth))`, and erase exactly that many. Correct only if the
  emulator **reflows** already-painted output. If it truncates instead, this over-erases and eats visible
  transcript.
- **(b) Erase the whole viewport and repaint everything visible.** This is upstream's approach and it is
  immune to reflow policy, because it never depends on where anything used to be. `ccx` cannot copy it
  directly: upstream's renderer owns every visible cell, while part of `ccx`'s screen is Ink `<Static>`
  output that Ink will not re-emit. Adopting it means either re-emitting `fullStaticOutput` (O(session)
  per resize) or building a viewport `ccx` owns.

**Measured so far (controller):** **tmux reflows** — a 111-character line in a 120-column pane becomes two
physical rows at 80, exactly `ceil(111/80)`. **pyte does not** — it truncates, discarding the overflow and
leaving row positions untouched.

**Still to measure:** at least one real terminal (the owner's, ideally), and the behaviour of a line that
is *exactly* the pane width, where an off-by-one in wrap accounting hides.

**A second requirement the spike produced** — *and then corrected, see below*: when content reflows taller,
the viewport **scrolls**, pushing the top of the frame off screen, so an erase count computed from frame
geometry appeared to need clamping to the rows still on screen.

> **CORRECTED by SP-R0's own measurement.** The clamp is **not** what makes the erase safe. Unclamped 14
> and clamped 11 produced byte-identical screens, history size included: cursor-up (`ESC[1A`) **saturates
> at the top margin and cannot reach the scrollback**, so an over-erase can never walk past the viewport
> top. It can still destroy *visible* rows — the spike measured six live transcript rows lost — so the
> protection that matters is computing the right count, not bounding a wrong one. Keep the clamp as a
> cheap one-line guard against a miscalculation; do not present it as the safety mechanism.

### The reframing that came out of measuring (controller, and it changes the spike)

Working through the two measurements produced an insight that neither report contains: **the defect exists
exactly where strategy (a) is correct, and is absent exactly where it is wrong.**

- On a **reflowing** emulator, a 111-character logical line written at 120 columns becomes 2 physical rows
  at 80. Ink erases 1. One row of residue. **Bug present**, and `ceil(111/80) = 2` is the right erase.
- On a **truncating** emulator, that line stays 1 physical row (the overflow is discarded). Ink erases 1.
  **No bug at all** — and strategy (a) would erase 2, eating a row of transcript.

So the two regimes are not "one is safe, one is unsafe": they need *different* counts, and using the wrong
one is harmful in the truncating case. That rules out "just always compute and erase" and gives the spike
a third candidate:

- **(c) Ask the terminal.** Query the cursor position with `ESC[6n` (DSR) across the resize. The reply
  reports where the cursor actually ended up, which encodes what the emulator did to the painted frame —
  no assumption about reflow policy required, and it works on emulators nobody has tested. Costs a
  round-trip on stdin and needs a timeout for terminals that do not answer, which is the risk to evaluate.

**Promote-or-discard criterion.** Prefer **(c)** if the DSR round-trip proves reliable under tmux, pyte
and a real terminal, including a timeout path that degrades to doing nothing rather than to erasing
wrongly — it is the only candidate that does not depend on knowing the emulator. Fall back to **(a) with
the clamp** if DSR is unreliable, gated on a reflow probe run once at startup. Take **(b)** only if both
fail, and tell the owner first: it means owning the viewport, which is a different-sized wave.

**The one measurement that still wants the owner's machine.** The owner's terminal is **Apple Terminal**
(`deepLinkTerminal: "Terminal"`, and Claude Code has written `optionAsMetaKeyInstalled: true` plus a
`com.apple.Terminal.plist` backup path into their config). Whatever we ship must be right there.

### Spike results so far — two candidates already weakened, and a method correction

Run by the controller before the plan was written, so the plan is not built on hope.

**(c) is refuted as formulated.** A DSR probe (`$CLAUDE_JOB_DIR/tmp/dsr-probe.mjs`) painted a 119-character
line in a 120-column tmux pane, queried the cursor with `ESC[6n`, resized to 80, and queried again. The
cursor reported **row 3 both times**, where a reflowing emulator predicts +1. The reason is not that tmux
truncates — it reflows, measured independently — but that **tmux holds the cursor's screen row fixed and
scrolls the excess off the top**, so reflow and scroll cancel exactly in the signal we were reading.
Cursor row alone therefore cannot distinguish the regimes. A richer DSR scheme might (querying before and
after with a known anchor), but the simple form is dead.

**(a) is not yet validated, because the synthetic probe did not reproduce the bug.** A second probe
(`erase-probe.mjs`) painted a four-line frame with full-width rules at 120 columns, resized to 80, and
compared Ink's erase count against the computed physical count. The arithmetic came out exactly as the
diagnosis predicts — **Ink would erase 5 rows where the frame now occupies 7** — but *both* strategies
left a clean screen, because on an otherwise-empty pane tmux's scroll-on-reflow carried the excess rows
off the top before any erase ran.

**The method correction that follows, and it is the spike's most useful output:** the defect involves a
real transcript above the frame and repeated renders, not a single synthetic paint. **SP-R0 must reproduce
`qa2-08` against the real `ccx` binary first, and only then evaluate strategies against that reproduction.**
A synthetic harness that cannot show the bug cannot certify a fix — which is the same trap as the pyte
instrument (W-R2), arriving from a different direction.

### SP-R0 — LANDED 2026-08-06. Reproduced, characterised, strategy chosen.

Full verdict: `$CLAUDE_JOB_DIR/tmp/wave-r-sp-r0-verdict.md`. Strategy decision is W-R6.

**Reproduced on the first attempt** against the real binary, from a fresh session with **no transcript**:
120×40 → 80×40 shows two composer blocks and three residue rows. Raw pty bytes settle two things a screen
capture cannot — Ink **does** re-render on `SIGWINCH` and soft-wraps the still-120-character rule itself
(defect (i) confirmed), and its erase is `eraseLines(7)` where the reflowed frame occupies **10** rows.

**Conditions the defect requires** — narrower than anyone assumed:
1. a width **shrink** (grow produces 0 residue),
2. at least one emitted frame line longer than the new width,
3. at least one row of content **above** the frame on screen.

Nothing else. Not a transcript, not a full pane, not scrollback.

**Residue is exactly** `min(rowsAboveFrame, physicalRows(prev @ newWidth) − logicalLines(prev))` —
measured 3 per shrink, additive across widths, never cleaned.

**That formula also explains the controller's negative result completely**, which is the satisfying part:
the synthetic probe painted its frame at the **top** of an empty pane, where `rowsAboveFrame` is 0, so the
residue fell off the viewport before any erase ran. The probe was not badly built; it was missing
condition 3, and the formula predicts its exact behaviour. A diagnosis that explains its own earlier
counter-evidence is worth more than one that merely fits the bug.

**Recording:** the verdict goes into this spec's `## Surprises & Discoveries` and the chosen strategy into
the `## Decision Log` as W-R6, before EP-R1's first line of implementation.

---

## EP-R1 · Width-change repaint — P0

### Current state: two independent defects, not one

**(i) Nothing re-renders.** `grep -rn "on(\"resize\"|on('resize'|SIGWINCH" harness/src/` returns nothing —
`ccx` never subscribes to resize. Ink's own handler (`node_modules/ink/build/ink.js:83`) re-runs Yoga
layout and re-serializes the **existing** React tree; it never re-renders components. So any string a
component built from the width — the composer's `RULE.repeat(width)` — is frozen at the launch width
forever. `ChatComposer.tsx:252` documents the intent — *"The terminal's width, read per render (a
function, not a number, so a resize is visible without a new prop identity)"* — so the reading is right
and the trigger is simply absent.

**(ii) The erase is short.** `node_modules/ink/build/log-update.js`:

```js
stream.write(ansiEscapes.eraseLines(previousLineCount) + output);
previousLineCount = output.split('\n').length;      // LOGICAL lines
```

`previousLineCount` counts newlines in the emitted string; `eraseLines` erases that many **physical** rows.
The two agree only while the width has not changed since that string was written. After a shrink the
emulator re-wraps the painted frame, the erase falls short, and the remainder survives — and accumulates,
one copy per width visited. A second contributor: `if (output === previousOutput) return;` writes
*nothing at all* when a resize yields a byte-identical frame, leaving the re-wrapped copy standing.

**Why height is clean** (the fleet's own control, `qa2-08`): neither cause fires. No chrome string is
built from the row count, and emulators do not re-wrap when only rows change. **A correct diagnosis has to
predict the observation nobody was trying to explain, and this one does.**

### What upstream does, and what we take from it

Upstream does **not** ship stock Ink's renderer — `grep -c previousLineCount` on the bundle returns **0**.
It owns a screen cell buffer, subscribes at L180674, branches on a width mismatch at L178320 into `TJr`
(L178440), and repaints every cell. On the wire the first bytes after each `SIGWINCH` are
`ESC[H` + (`ESC[2K` `ESC[1B`) × N + `ESC[H`, where **N is the NEW viewport height every time**, with no
`2J` and no `3J`.

**The principle we copy: never consult the previous frame's geometry, so the erase cannot be short.**
The bytes we do not copy — see W-R3.

### Work items

- **(spike)** SP-R0 lands first and chooses the erase strategy.
- **(new)** A resize subscription that makes terminal size **real React state**, threaded to
  `ChatApp.tsx:140/143` so width-derived strings rebuild. This alone fixes defect (i).
- **(new)** Frame-geometry tracking through the **existing** `ResumeSafeStdout` proxy
  (`chatMain.tsx:40-65`), which already intercepts every byte Ink writes and is already load-bearing for
  the resume path. No Ink patching and no reaching into `log-update`'s closure is required.
- **(new)** The erase itself, emitted through that proxy's TTY-gated write shape and `deps`-overridable
  for tests, per the strategy SP-R0 chose, **with the viewport clamp**.
- **(modify)** Picker and dialog widths re-derive on resize (`qa2-10a`).
- **(new)** The resize regression test of A12, under a reflowing emulator.

**Explicitly not done here**, both verified as traps:

- **Do not bump `staticEpoch`** (`ChatApp.tsx:342`). It is a `<Static>` remount key; remounting replays
  the entire scrollback, and a resize does not change the transcript.
- **Do not reuse `useChat.ts:336`'s `\x1b[2J\x1b[3J\x1b[H` payload.** The `3J` wipes the scrollback the
  committed transcript lives in. Reuse the *shape* of that call, not its bytes — and note the shape is
  already what we want: `const clearScreen = deps.clearScreen ?? (() => { … process.stdout.isTTY … })`,
  i.e. TTY-gated and `deps`-overridable for tests, exactly the seam the new erase needs.

### Acceptance

A1, A2, A3, A4, A5, A12 — under tmux or a real terminal (never pyte alone).

---

## EP-R2 · `/clear` leaves a blank pane — P0, **independent of EP-R1**

### Current state: the filed diagnosis and the filed dependency are both wrong

`ccx`'s own code is correct. `useChat.ts:336` already emits the erase and homes the cursor. **The repaint
is never written**, because Ink's `Instance.clear()` (`ink.js:213`) resets log-update's counters but not
`this.lastOutput` — so the post-clear frame is byte-identical to the pre-erase one and the dedupe at
`ink.js:132` skips the write:

```js
if (!hasStaticOutput && output !== this.lastOutput) { this.throttledLog(output); }
```

It is byte-identical *because* the transcript lives in `<Static>`: a clear does not change the dynamic
frame (composer, status bar) at all. And the `hasStaticOutput` escape route is closed by the very same
event — wiping `<Static>` makes `staticOutput === '\n'`, which the guard at `ink.js:103` treats as empty.

**Consequence for the plan: a clear-only primitive does not fix this.** EP-R1 repairs the erase count;
this defect is a different cache that EP-R1 never touches. The parent spec's `EP-R1 → EP-R2` edge is
retracted (W-R4); they parallelize, subject to the shared-ownership note below.

### Upstream's shape, read line by line — and it is the shape we should copy

`forceRedraw` (L180978), controller-verified:

```js
forceRedraw(e) {
  if (!this.options.stdout.isTTY || this.isUnmounted || this.isPaused) return !1;
  if (e?.flushReact) rxe.flushSyncFromReconciler();
  …
  if (this.hasStaleTerminalSize()) return this.handleResize(), !0;
  if (this.altScreenActive) this.needsEraseBeforePaint = !0, …
  else this.log.forceFullReset(), this.prevFrameContaminated = !0;
  return this.resetScreenReaderDiffState(), this.onRender(), !0;
}
```

`forceFullReset()` (L178271) does one thing — `this.forceReset = !0` — which the renderer consumes at
L178318 (`if (this.forceReset) return this.forceReset = !1, TJr(t, "clear", …)`), taking the same
clear-and-repaint branch a resize takes.

**Three things to take from this.** First, **upstream never writes escapes from the command handler**: it
sets a flag and re-renders, and the renderer decides the bytes. Second, `onRender()` is called
**unconditionally** — there is no output-equality dedupe on this path, which is exactly the guard that
breaks `ccx`. Third, a forced redraw and a resize are **the same primitive** (`hasStaleTerminalSize()` →
`handleResize()`), which is the grain of truth in the triage's "one primitive" instinct, arriving at a
different level than it supposed. Two named concepts worth borrowing outright: `prevFrameContaminated`
("the screen holds something we did not put there") and `probeExternalClear` (L180993), where upstream
actively asks the terminal whether an external agent wiped the screen — notably gated on altscreen, which
is further evidence that DSR is not a general-purpose tool here (SP-R0 candidate (c)).

### Work items

- **(new)** Make a reset produce a render that **cannot be skipped**, mirroring the shape above: mark the
  frame contaminated, then force the render — rather than `ccx`'s current "write an erase and hope a
  render follows". The `ResumeSafeStdout` proxy sees every write and is one candidate seam; the
  requirement is the behaviour, not the mechanism.
- **(modify)** Replace the `3J` in the reset payload so the scrollback survives, matching upstream inline
  (A7). Upstream's `/clear` emits no escape of its own, and its inline reset is viewport-only.
  **Note the false canon claim to correct while there:** `useChat.ts:334-335` says the wipe is *"exactly
  like CC's /clear"*. It is not — upstream preserves scrollback inline. That comment is a defect in its
  own right under the programme's "comments as canon record" rule.

### Acceptance

A6, A7.

---

## EP-R4 · Pager-close debris — P2

### Current state: cause found, and it is a standing hazard rather than cosmetic

Raw pty after Escape: **zero bytes for 8 seconds**, then an erase of 7 lines for a frame that occupied
~36. The pager frame is taller than the pane, so Ink takes the full-screen branch at `ink.js:121`:

```js
if (outputHeight >= this.options.stdout.rows) {
    this.options.stdout.write(ansiEscapes.clearTerminal + this.fullStaticOutput + output);
    this.lastOutput = output;
    return;
}
```

That branch writes **straight to stdout, bypassing log-update entirely**, leaving `previousOutput` and
`previousLineCount` stale for everything that follows.

**This is the concrete mechanism behind the programme's recorded "a frame taller than the viewport leaks
copies" hazard** (F6 lesson). It is worth restating in the sharper form: the branch does not merely cost a
redraw — it **desynchronizes the renderer's bookkeeping**, so the *next* resize is wrong too. Any future
full-height surface inherits this, which is why EP-R3's withdrawal was a relief rather than a loss.

### Work items

- **(modify)** Resynchronize the renderer's frame accounting after any full-screen-branch write. Since
  the `ResumeSafeStdout` proxy observes the write, EP-R1's geometry tracking can detect it — this is why
  the two epics share an owner.

### Acceptance

A8 — including its second half, the resize-after-close check that proves the bookkeeping was
resynchronized rather than the debris merely wiped.

---

## EP-R5 · Diff-body syntax highlighting — P1

### Current state: the observation is right, the proposed fix is wrong in three ways

`ccx` renders every diff row as one foreground run over one background: `diffRender.ts:152` `plainRows`
wraps a plain string and emits a single segment. Upstream tokenizes. But:

**1. Removed lines must stay flat.** L419813:

```js
let { lineNumber: g, marker: y, code: _ } = d[m], E = y === "-" ? [[cWo(o), _]] : i2p(s, _, o), ...
```

The `-` branch emits one style/text pair; only the non-`-` branch tokenizes. `ccx`'s flat removed row is
already correct, and the triage's acceptance criterion ("tokens inside added/**removed**/context lines")
would have been a regression. Corrected here as A9.

**2. The highlighter we have is for a different surface.** `harness/src/tui/highlight.ts` is a clone of
upstream's *markdown fenced-code* map `DhH` (L420495) — four chalk colours, ten languages — and its own
header records the trade: *"zero-dep syntax highlighter for fenced code (spec Decision Log: no 1MB dep for
a LOW row)"*. The diff path is real highlight.js behind a 24-scope truecolor map. `ccx` also ported `H2p`
(L419987), which is upstream's **fallback** renderer, taken only when highlighting is switched off
(gated by `CLAUDE_CODE_SYNTAX_HIGHLIGHT`, `uAr()` L419858).

**3. Three palettes, not one.** L419855 carries `K$p` (Monokai/dark), `Y$p` (light, entirely different
values), and `jmH` (256-colour fallback via palette indices). Language detection is not extension-only:
`X$p` (L419856) maps bare filenames — `Dockerfile`, `Makefile`, `Rakefile`, `Gemfile`, `CMakeLists`.

**Composition is band-under-token** (`ZmH` L419733; the literal itself at **L419757**: `l.push([{ ...c, background: y ? o : n }, A])`) — the diff
owns the background only. Pinned live on a word-diff row where one string token kept its foreground while
the background flipped and flipped back.

### Work items

- **(new)** Take the `highlight.js` dependency (W-R5).
- **(new)** Port the three scope maps and the filename map.
- **(modify)** Make wrapping segment-aware — `plainRows` currently flattens to one segment.
- **(modify)** Invert the word-diff arm: tokens first, background overlaid. `Segment` (`render.ts:18`)
  already carries `color` and `bg` independently, so the overlay itself is a spread.

### Acceptance

A9, A10, A11.

---

## Decision Log

- **W-R1 [DECIDED, grounding]** **Canon for this wave is upstream's INLINE renderer**, not whatever the
  owner's terminal shows. Claude Code has a second, gated **fullscreen** renderer (alternate screen,
  bottom-anchored prompt, mouse reporting) that the owner runs and `ccx` does not implement. Its default
  branch (L455996) is a bare fragment with no height and no anchor — structurally what `ccx` already does.
  *Rejected alternative:* treat the owner's observed behaviour as the target. It would have had us build a
  bottom-anchored full-height frame, which puts `ccx` permanently on the `ink.js:121` branch that
  desynchronizes the renderer's bookkeeping (EP-R4) and would have made EP-R1 untestable.
- **W-R2 [DECIDED, grounding]** **No frame claim rests on one instrument.** pyte truncates rather than
  reflowing and cannot see the width defect; `tmux capture-pane` cannot tell a painted blank from an
  unwritten cell and manufactured `qa2-12`. *Rejected alternative:* standardize on one instrument for
  comparability — it trades a known blind spot for an invisible one.
- **W-R3 [DECIDED]** **Copy upstream's principle, not its bytes.** We adopt "never consult the previous
  frame's geometry"; we do not adopt `ESC[H` + viewport erase + full repaint verbatim, because upstream's
  renderer owns every visible cell and `ccx`'s does not — homing and repainting would orphan the `<Static>`
  transcript. *Also rejected:* Ink's own escape hatch (`clearTerminal + fullStaticOutput + output`), which
  carries `ESC[3J` (destroying scrollback, which upstream pointedly avoids inline) and re-emits the whole
  session's static history on every resize.
- **W-R4 [DECIDED, grounding]** **`EP-R1 → EP-R2` is retracted.** They fix different caches — the erase
  count and the `lastOutput` dedupe. A clear-only primitive leaves `/clear` broken. They parallelize;
  EP-R1/EP-R4 share an owner because both touch frame accounting.
- **W-R5 [DECIDED, controller-recommended, owner may override — §11 HLJS-1]** **Take the `highlight.js`
  dependency** for the diff path. The zero-dep trade was made explicitly for a LOW-priority surface; this
  is P1, the programme's stated goal is fidelity over convenience, and ~1 MB in `node_modules` is noise
  beside the Agent SDK's bundled ~270 MB CLI binary. *Rejected alternative:* extend `highlight.ts`. It
  costs the **same** structural work (segment-aware wrapping, word-diff inversion) and still misses the
  palettes and ~373 of ~383 languages — structurally right and visibly wrong.
- **W-R6 [DECIDED, SP-R0 landed 2026-08-06]** **Ship strategy (a) — erase `physicalRows(previousFrame,
  newWidth) + 1` — gated by strategy (c) used as a *reflow oracle* rather than as a replacement.**
  Evidence: replaying `ccx`'s real frame bytes across a real resize, (a) left a perfectly clean screen.
  *Rejected:* **(b)** erase-viewport-and-repaint also worked but **provably duplicates scrollback on every
  resize** (the duplicate rows were captured), and for `ccx` it means re-emitting the whole session because
  Ink will not re-emit `<Static>`. *Repaired rather than rejected:* **(c)**. Its refutation holds only for
  the cursor **row**; the cursor **column** is not pinned and moves 121 → 41 across a 120→80 reflow —
  exactly `((121−1) mod 80) + 1` — whereas pyte destroys the cell instead. That is a working reflow oracle
  at the cost of one DSR round-trip, and it needs no new stdin reader: `keys/parse.ts:133-134` already
  routes an unmapped CSI final byte to `ignored("unknown-sequence")`, and `CSI_LETTER` (`parse.ts:46`) has
  no `R`, so a DSR reply is already swallowed safely (controller-verified).
  **The gate is required because the errors are asymmetric**: under-erasing is today's cosmetic residue,
  while over-erasing **destroyed six live transcript rows** in the spike's own test. Never correct
  optimistically.
- **W-R7 [DECIDED, from an incident]** **Subagents do not drive GUI applications on the owner's machine.**
  Measuring Apple Terminal's reflow policy by scripting `Terminal.app` left a modal sheet on a window,
  which blocked that application's entire AppleEvent queue — including the calls needed to dismiss it.
  Recovery required a human click. The cost/benefit is plainly wrong: a datum worth one line of a spec put
  the owner's primary terminal into a state only they could clear. Terminal-behaviour facts that need a
  real GUI terminal are gathered by **handing the owner a 30-second script to run**, never by driving the
  app. *Rejected alternative:* force-quitting to recover — it would have killed the owner's own long-lived
  shells (the process had been up 3 days 22 hours).
- **W-R8 [DECIDED, from an incident]** **Teardown kills only the sessions you created, by name — never
  `tmux kill-server`.** The Task 4 drag measurement finished its runs correctly and then tore down with
  `tmux kill-server`, which killed the **owner's own two long-lived sessions (`main` and `sdk`)** along
  with the agent's. Its own sessions had already exited, so the destructive call bought nothing at all.
  The rule: every tmux-driving task names its sessions with the task's own prefix and tears down with a
  per-session `tmux kill-session -t <name>` in a `finally`; **no agent runs `kill-server`, `kill-session
  -a`, or any other all-sessions form, ever.** This generalises W-R7 rather than repeating it — W-R7 says
  do not drive the owner's applications, and W-R8 says a shared daemon is one of the owner's applications
  even when you are a legitimate client of it. *Rejected alternative:* trusting the driver doc to imply
  it — `docs/parity/qa-driver.md` already showed per-session teardown and that was not enough, so the
  prohibition has to be stated as a prohibition.
- **W-R9 [DECIDED]** **The resize correction fires at frame-write time, not at signal time.** Task 4 as
  shipped paired a synchronous erase with Ink's own repaint, on the assumption that a `SIGWINCH` implies
  an immediate Ink write. Ink's source refutes the assumption twice: `resized()` routes the actual write
  through a leading+trailing `throttle` (`ink.js:45`, `:133`), and `log-update` dedupes identical output
  into **no write at all**. Measured consequence: a one-column drag left 3 stale rule rows (strictly
  better than baseline's ~6, no content loss — the 46-cell comparison — but short of A2). The repair:
  the stdout proxy corrects the *write itself* — at the moment a frame write arrives, the previous
  frame, the parked row, Ink's own erase-prefix count, and the **live** width are all known exactly, so
  the shortfall is injected between Ink's prefix and the body in one chunk. No write → no under-erase →
  nothing to correct; a deferred write is corrected against the width true at write time. Bursts stop
  being a case. Plan Task 4b. *Rejected alternatives:* keeping the signal-time pairing and debouncing our
  erase to match Ink's throttle (couples us to an undocumented timer constant, and still cannot see the
  dedupe-to-nothing case); widening the correction to fire on `"unknown"` verdicts to catch more drags
  (violates W-R6's asymmetry — the unmeasured-terminal over-erase is the one unacceptable failure).

## Open questions

| Item | Owner | Deadline |
|---|---|---|
| **HLJS-1** — override W-R5 and stay zero-dep? Proceeding on the recommendation unless told otherwise | Owner (override only) | Spec review |
| **FULLSCREEN-1** — does upstream's fullscreen renderer become a roadmap item, and at what priority? Out of scope for Wave R either way. It is a promoted opt-in, not a silent rollout (parent §12 item 17a) | Owner, with a controller recommendation | Wave R close-out |
| **MOUSE-1 residual (b)** — which row does the owner click: the collapsed `Ran N shell commands` summary, or something reading `+N lines (ctrl+o to expand)`? Never observed as a click target across twelve polls. Does not block anything | Owner | Whenever convenient |
| ~~**SP-R0** — does any real terminal truncate rather than reflow?~~ **LANDED 2026-08-06.** Reproduced, characterised, strategy chosen (W-R6). The wave does not change size | — | closed 2026-08-06 |
| **APPLE-TERM-1** — does Apple Terminal reflow on narrow? The only measurement the spike could not take, and the owner's own terminal. **W-R6's design does not depend on the answer** (the DSR oracle detects the policy at runtime), so this is confirmation, not a gate. Needs a 30-second manual run of the spike's `dsr2.py` in a Terminal window | Owner (30 seconds, whenever convenient) | Not blocking |

## Surprises & Discoveries

Seeded from the grounding round; parent spec §12 items 10–19 carry the full evidence. The three that most
changed this document:

1. **The wave lost two epics and gained a spike.** `EP-R0` closed with no code and `EP-R3` was withdrawn
   as not-a-defect — both because the grounding round found a *configuration* difference rather than a
   code difference. Meanwhile the P0's fix turned out to rest on an unmeasured assumption about terminal
   reflow, which became SP-R0.
2. **The fix hint the triage was proudest of had no referent.** "The ctrl+o pager's close path already
   clears and full-repaints" was the load-bearing `[DECIDED-AUTO]` of the whole stream. That path is
   `onClose={() => setTranscriptOpen(false)}` — a `useState` setter. What the fleet saw was an ordinary
   re-render, which any keystroke also causes, and which does not remove the residue.
3. **Our own instrument cannot see our own P0.** `capture-frames.py` runs on pyte, which truncates instead
   of reflowing. A regression test written with the standard tool would have passed before the fix, after
   a wrong fix, and with no fix at all — and there is no resize test in the repo today, so the highest
   priority defect in the sprint has zero coverage and the obvious way to add it is blind.
4. **The defect's real precondition is one nobody had named**, and it retroactively vindicated a failed
   probe. `qa2-08` needs *content above the frame*; with the frame at the top of an empty pane the residue
   scrolls off before the erase runs. The controller's synthetic probe had been written off as "could not
   reproduce"; the residue formula from SP-R0 predicts its behaviour exactly. **A probe that fails is
   evidence about its conditions, not only about the hypothesis** — and the diagnosis that explains the
   earlier counter-evidence is the one to trust.
5. **A measurement cost the owner a manual recovery, and the lesson is a standing rule (W-R7).** Trying to
   read Apple Terminal's reflow policy by scripting `Terminal.app` left a modal sheet that blocked the
   application's whole AppleEvent queue — including the calls that would dismiss it. Nothing was lost and
   isolation held (real `prefs.json` mtime unchanged), but clearing it needed a human click on a terminal
   that had been running for nearly four days. The agent was right not to force-quit. The rule that
   follows: **never drive a GUI application on the owner's machine** — hand them a script instead.
6. **Moving the cursor is not enough to park it — the park has to PAD.** Task 4's implementer measured
   this before writing any implementation code, and it overturned the design the STEP 0 gate had settled.
   tmux clamps a reflowing cursor to its line's *used* cells (`grid_wrap_position`:
   `if (px >= gl->cellused) xx = ax + gl->cellused;`), and Ink leaves the cursor on the **blank** row below
   the frame — `cellused == 0`. So a bare `\x1b[117G` reports column **1** after every drag, `probeReflow`
   correctly refuses column 1 as near-margin, and every verdict would have been `"unknown"` forever. That
   is precisely the inert-fix outcome the escalation threshold exists to catch, and it was one measurement
   away from shipping. Writing spaces out to the park column makes the cells used, and the same drags then
   report the re-wrap arithmetic exactly (120→80 → 37, the exact-half 120→60 → 57). **Consequence:** the
   padded row re-wraps too, so the erase count carries `ceil(parkedCol / newWidth)` for the cursor row
   rather than the plan's flat `+ 1`.
7. **Our erase was written to interleave with Ink's, and Ink offers no such guarantee.** The synchronous
   path erases the rows *above* what Ink is about to erase, on the contract that Ink's own
   `eraseLines(previousLineCount)` follows immediately and the two runs share one row. Ink's repaint
   actually goes through `throttle(this.log, undefined, {leading:true, trailing:true})` (`ink.js:45`), so a
   second resize inside the throttle window defers Ink's half to the trailing edge while ours runs anyway,
   against a cursor Ink has not moved. The review reproduced the resulting residue against the real binary;
   the controller then confirmed the mechanism in Ink's own source. Two independent facts break the
   contract, and **both say the same thing: we cannot predict Ink's write from a `SIGWINCH`.**
   `ink.js:83` `resized()` calls `onRender()` directly, but `onRender` (`:133`) hands off to
   `throttledLog`, so a burst produces one immediate write and one deferred to a trailing timer. And
   `log-update.js`'s `render` returns early when `output === previousOutput`, so Ink may write **nothing at
   all**. **The general lesson is bigger
   than the bug:** an acceptance matrix that drives one `tmux resize-window` per cell with a capture
   between is not testing the workload a person produces by dragging a window edge, which is a *burst* of
   `SIGWINCH`. Stepped resizes and drags are different workloads, and this correction passed the first
   while failing the second.
8. **The drag failure is an unimproved case, not a regression — measured, not argued.** With the design
   in question, the tempting move is to reason about whether shipping it is safe. Instead the two builds
   were driven through the same four drag shapes, three repetitions each, 46 cells: the corrected build is
   **better than or equal to the uncorrected one everywhere**, and **no content was lost in either**, with
   all eight marker rows and four content anchors byte-identical in the scrollback capture (not the visible
   pane — the instrument rule matters here). The fine one-column drag is the honest gap: 1 composer block
   and 3 stale rule rows, against the baseline's 3–4 composers and ~6 stale rows. That converts the
   decision from "is this safe to ship" into "is a strict improvement enough for A2", which is a different
   and much easier question to answer.
9. **After W-R9, the residual windows are named, bounded, and all on the under-erase side.** Task 4b's
   write-time corrector leaves exactly two uncorrected windows, both known rather than discovered: (a)
   **pre-verdict frame writes** — during a literal one-column drag every probe is refused (a ≤3-column
   step can never satisfy `colBefore > newWidth` with the park at `oldWidth − 3`), so a session's *first*
   fine drag paints 1–4 stale rule rows until a ≥4-column shrink lets a probe answer; measured
   indistinguishable from Task 4's signal-time design on that cell (means 2.25 vs 1.63 stale rows over 8
   interleaved reps) while strictly better everywhere else. (b) **`<Static>` flushes** open with an
   erase-only `log.clear()` that the corrector deliberately does not touch (it corrects frame writes
   only). Both windows under-erase; neither can lose content. Closing (a) means accumulating the
   shortfall of pre-verdict writes and discharging it when the verdict lands — a design change deferred
   as a wave close-out decision, not folded into Task 4b.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **v1 (2026-08-06)** — authored after the five-worker grounding round, against parent spec §12 items
  10–19. Born landed: every decision above was settled by evidence before this document existed, and the
  epics were re-cut in the parent spec first.
- **2026-08-07 (Task 4b)** — W-R9 added: the resize correction moved from signal time to frame-write
  time after Ink's source refuted the SIGWINCH-implies-write assumption; Surprises 6–9 record the padded
  park, the throttle/dedupe mechanism, the 46-cell drag measurement, and the two named residual windows.
- **2026-08-07 (Task 7)** — A7 amended: the `❯ /clear` echo does NOT survive upstream's inline reset
  (the `clearTerminal` event erases `viewportRows: e.viewport.height`, L178442); the criterion's
  substance — scrollback intact, no `ESC[3J` — is unchanged. The Task 7 implementer caught the
  contradiction and followed the bundle; the controller verified the line before amending.

## Deferred (out of this wave)

- **Upstream's fullscreen renderer** — alternate screen, app-owned scrollable viewport, and the three
  mouse affordances it advertises (click to expand collapsed tool results, click to position the cursor,
  copy-on-select). This is the mode the owner uses daily. It is a wave of its own; FULLSCREEN-1 decides
  whether and when.
- **ctrl+o screen-swap semantics** — upstream swaps the whole screen rather than overlaying. Recorded as
  a divergence during EP-R4 grounding; not chased here.
