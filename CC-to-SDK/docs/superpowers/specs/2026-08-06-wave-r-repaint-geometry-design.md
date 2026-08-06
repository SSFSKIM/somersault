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
7. **A7 (`/clear` fidelity)** After `/clear`, the `❯ /clear` echo is still visible and **the scrollback
   above is intact**. Upstream's inline reset erases the viewport only, deliberately omitting `ESC[3J`
   (L177120, L176988); `ccx` currently sends `\x1b[2J\x1b[3J\x1b[H` at `useChat.ts:336` and wipes it.
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

**A second requirement the spike already produced, which no code reading would have surfaced:** when
content reflows taller, the viewport **scrolls**, pushing the top of the frame off screen. So an erase
count computed from frame geometry **must be clamped to the rows still on screen**; erasing the raw count
walks past the viewport top and damages what is above it.

**Promote-or-discard criterion.** If every non-pyte emulator measured reflows, promote strategy (a) with
the clamp and record pyte's divergence as an instrument limitation (which A12 already accounts for). If
any real terminal truncates, (a) is unsafe and the wave takes (b) — in which case EP-R1 grows
substantially and the owner is told before implementation, because that is a different-sized wave.

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

### Work items

- **(new)** Invalidate Ink's `lastOutput` dedupe across a reset. The `ResumeSafeStdout` proxy sees every
  write and is the likeliest seam; the implementation may find a cleaner one, and is free to — the
  requirement is the behaviour, not the mechanism.
- **(modify)** Replace the `3J` in the reset payload so the scrollback survives, matching upstream inline
  (A7). Upstream's `/clear` emits no escape of its own; the renderer owns it through one forced-repaint
  primitive (`forceRedraw` → `forceFullReset` → `TJr(next, "clear")`).

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

**Composition is band-under-token** (`ZmH`, L419733: `[{ ...c, background: y ? o : n }, A]`) — the diff
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
- **W-R6 [PENDING SP-R0]** The erase strategy. Written here before EP-R1's first line of implementation.

## Open questions

| Item | Owner | Deadline |
|---|---|---|
| **HLJS-1** — override W-R5 and stay zero-dep? Proceeding on the recommendation unless told otherwise | Owner (override only) | Spec review |
| **FULLSCREEN-1** — does upstream's fullscreen renderer become a roadmap item, and at what priority? Out of scope for Wave R either way. It is a promoted opt-in, not a silent rollout (parent §12 item 17a) | Owner, with a controller recommendation | Wave R close-out |
| **MOUSE-1 residual (b)** — which row does the owner click: the collapsed `Ran N shell commands` summary, or something reading `+N lines (ctrl+o to expand)`? Never observed as a click target across twelve polls. Does not block anything | Owner | Whenever convenient |
| **SP-R0** — does any real terminal truncate rather than reflow? If so the wave changes size and the owner is told before implementation | Controller (spike) | Before EP-R1 |

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

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **v1 (2026-08-06)** — authored after the five-worker grounding round, against parent spec §12 items
  10–19. Born landed: every decision above was settled by evidence before this document existed, and the
  epics were re-cut in the parent spec first.

## Deferred (out of this wave)

- **Upstream's fullscreen renderer** — alternate screen, app-owned scrollable viewport, and the three
  mouse affordances it advertises (click to expand collapsed tool results, click to position the cursor,
  copy-on-select). This is the mode the owner uses daily. It is a wave of its own; FULLSCREEN-1 decides
  whether and when.
- **ctrl+o screen-swap semantics** — upstream swaps the whole screen rather than overlaying. Recorded as
  a divergence during EP-R4 grounding; not chased here.
