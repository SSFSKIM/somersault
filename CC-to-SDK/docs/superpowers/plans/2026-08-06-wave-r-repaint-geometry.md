# Wave R — Repaint & Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ccx` repaint correctly. A width change must leave exactly the frame it would have drawn at
that width; `/clear` must redraw immediately without destroying scrollback; closing the pager must not
poison the renderer's bookkeeping; and Edit diff bodies must be syntax-highlighted the way Claude Code
highlights them.

**Architecture:** Four independent defects in three different stale caches inside Ink 5.2.1, plus one
rendering gap. Nothing here patches Ink. Every intervention goes through seams `ccx` already owns — the
`ResumeSafeStdout` proxy (`src/tui/chatMain.tsx:40-65`), which sees every byte Ink writes, and the
`deps`-injection pattern used throughout `src/tui/`. One new npm dependency (`highlight.js`, W-R5).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React + Ink 5.2.1, Vitest,
`ink-testing-library`, tmux for the resize acceptance runs.

**Spec:** `docs/superpowers/specs/2026-08-06-wave-r-repaint-geometry-design.md`. **Read the epic your task
belongs to, and read `W-R1…W-R7` in its Decision Log — they record what was rejected and why, and three of
them exist because a plausible approach was measured and failed.** Canon citations (`L…`) refer to
`~/claude-code-bundle/2.1.220/cli.pretty.js`.

**Provenance:** authored after a five-worker grounding round and the SP-R0 spike, both of which overturned
the triage's proposed fixes. Where a task says "do NOT do X", X was measured and produced a worse defect
than the one being fixed. Take those seriously.

## Global Constraints

- **Dense hand-style, NO Prettier.** Match the surrounding file's formatting exactly. Do not reformat
  lines you did not change.
- **ESM:** every relative import specifier ends in `.js`.
- **TDD:** failing test → run it → minimal implementation → run it → commit. Every task ends committed.
- **Gates before each commit:** `npm run typecheck`, plus the suites covering your change
  (`npm run test:unit` and/or `npm run test:tui`). Both must be green; report the counts.
- **Never read or write the real `~/.claude`.** Set `CCX_FLEET_ROOT` to a temp dir. A test that touches
  the real prefs file is a defect regardless of whether it passes.
- **Never print or commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.** Every test here is keyless.
- **NEVER drive a GUI application (W-R7).** No AppleScript against `Terminal.app`, iTerm, or anything
  else on this machine. Scripting `Terminal.app` during SP-R0 blocked its entire AppleEvent queue behind
  a modal sheet and needed a human to clear it. If you believe you need a real GUI terminal, stop and say
  so; the owner runs a script.
- **Resize acceptance runs under tmux, never under `capture-frames.py` (W-R2).** pyte truncates instead of
  reflowing and cannot reproduce the defect — a green pyte frame proves nothing about a resize fix. When
  asserting a row is *blank*, pre-fill the screen with a marker character first: `tmux capture-pane`
  cannot distinguish a painted blank from an unwritten cell.
- **The resize defect needs all three conditions to reproduce** (SP-R0): a width **shrink**, at least one
  emitted frame line **longer than the new width**, and at least one row of content **above the frame**.
  A repro missing any one of them shows a clean screen on a broken build.
- **Over-erasing is worse than under-erasing.** Under-erase leaves today's cosmetic residue; over-erase
  destroyed six live transcript rows in SP-R0's test. Never correct optimistically.
- **Commit messages:** `f5(waveR-tN): <what changed>`. No `Co-Authored-By`, no attribution trailers.
- **Do not push and do not open a PR.**
- **Task order.** Tasks 1–5 (EP-R1) are strictly sequential and share `chatMain.tsx` / `ChatApp.tsx`.
  Task 6 (EP-R2) and Task 7 (EP-R4) touch the same render bookkeeping and follow them. Tasks 8–10 (EP-R5)
  are independent of all of the above and may be done by a different owner in parallel.

---

## Task 1: Terminal size becomes React state

**Epic:** EP-R1, defect (i). **Files:** `src/tui/chatMain.tsx`, `src/tui/ChatApp.tsx`,
`test/tui/resize-state.test.tsx` (create).

**Why:** `grep -rn "on(\"resize\"|on('resize'|SIGWINCH" src/` returns nothing — `ccx` never subscribes.
Ink's own handler (`node_modules/ink/build/ink.js:83`) re-runs Yoga layout and re-serializes the existing
React tree but **never re-renders components**, so `ChatApp.tsx:140`'s `terminalColumns()` is only ever
re-read when something else causes a render. Width-derived strings — the composer's full-width rules —
freeze at the launch width. `ChatComposer.tsx:252` documents the intended per-render read; the trigger is
simply absent.

- [ ] **Step 1: Write the failing test.** In `test/tui/resize-state.test.tsx`, render `ChatApp` with an
      injected `columns` dep backed by a mutable variable and a fake resize emitter, assert the rendered
      frame contains a rule of the initial width, change the width, emit resize, `await` a tick, and
      assert the rule is the new width. Use the `mount()` helper pattern from `test/tui/select.test.tsx`
      (`useInput` subscribes in a passive effect — a test that writes before an awaited tick drops input).
- [ ] **Step 2: Run it and watch it fail** — `npx vitest run test/tui/resize-state.test.tsx`. Expect the
      rule to keep the old width.
- [ ] **Step 3: Implement.** Add a resize subscription that sets React state and thread it to
      `ChatApp.tsx:140` (`terminalColumns`) and `:143` (`terminalRows`). Inject the emitter through the
      existing `deps` pattern so the test needs no real TTY. Keep the function-valued prop shape —
      `ChatComposer` reads `columns()` per render deliberately.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 5: Commit** — `f5(waveR-t1): terminal size is React state, so a resize re-renders`.

---

## Task 2: The stdout proxy records the last frame's geometry

**Epic:** EP-R1, groundwork for the erase. **Files:** `src/tui/chatMain.tsx`,
`test/unit/resume-safe-stdout.test.ts` (create or extend).

**Why:** `createResumeSafeStdout` (`chatMain.tsx:40-65`) already wraps `stdout.write` in a Proxy whose
`get` trap returns `ccx`'s own `write`, so **every byte Ink emits already passes through code we own**.
That is how we learn the previous frame without patching Ink or reaching into `log-update`'s closure.

- [ ] **Step 1: Write the failing test.** Assert that after writing a frame through the proxy,
      `lastFrame()` returns that exact string, and that `physicalRows(frame, width)` computes
      `Σ max(1, ceil(displayWidth(line) / width))` — cover a line exactly equal to the width (the
      off-by-one that hides here), an empty line, and a line with wide/CJK characters (use
      `string-width`, already a dependency).
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Extend `ResumeSafeStdout` with frame capture and export the pure
      `physicalRows(frame, width)` helper. **Do not** record writes made while `suppressNextWrite` is set —
      that path exists to swallow Ink's stale resume clear and is not a frame.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t2): the stdout proxy records the last frame and its physical height`.

---

## Task 3: The reflow oracle

**Epic:** EP-R1, the gate on the correction (W-R6). **Files:** `src/tui/reflowOracle.ts` (create),
`test/unit/reflow-oracle.test.ts` (create).

**Why:** the erase count is only correct on an emulator that **reflows**. On one that truncates there is
no defect and the same correction would destroy rows. SP-R0 refuted using the cursor **row** (tmux pins it
and scrolls the excess off the top, so reflow and scroll cancel) but proved the cursor **column** works:
across a 120→80 reflow it moves 121 → 41, exactly `((121−1) mod 80) + 1`, whereas pyte destroys the cell.

- [ ] **Step 1: Write the failing test.** Drive the oracle with an injected writer/reader pair: feed a
      synthetic `ESC[<row>;<col>R` reply and assert it reports *reflowing* for a column consistent with
      `((col₀−1) mod newWidth)+1`, *not reflowing* otherwise, and **`unknown` on timeout**. Assert the
      timeout path resolves rather than hanging.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Write DSR (`\x1b[6n`), read the CPR reply, compare. **No new stdin reader is
      needed and none may be added**: `keys/parse.ts:133-134` already routes an unmapped CSI final byte to
      `ignored("unknown-sequence")`, and `CSI_LETTER` (`parse.ts:46`) has no `R` — a DSR reply is already
      swallowed safely. Consume it through the existing parser path. Timeout must degrade to `unknown`.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t3): a DSR-based reflow oracle, timeout-safe`.

---

## Task 4: Erase the previous frame on a width shrink

**Epic:** EP-R1, the fix. **Files:** `src/tui/chatMain.tsx` (or a new `src/tui/resizeRepaint.ts`),
`test/unit/resize-repaint.test.ts` (create), `test/tui/` as needed.

**Why:** Ink erases `output.split('\n').length` **logical** lines
(`node_modules/ink/build/log-update.js`) but a width change makes the emulator re-wrap the painted frame
into a different number of **physical** rows. SP-R0 measured it directly: `eraseLines(7)` for a frame that
occupies 10 rows. Residue is exactly
`min(rowsAboveFrame, physicalRows(prev @ newWidth) − logicalLines(prev))`, additive across widths.

- [ ] **Step 1: Write the failing test.** With injected deps (last frame, old/new width, oracle verdict,
      a recording writer), assert: on a **shrink** with the oracle reporting *reflow*, the emitted erase
      covers `physicalRows(prev, newWidth) + 1` rows; on a **grow**, nothing is emitted; with the oracle
      reporting *no reflow* or *unknown*, **nothing is emitted** (the asymmetry rule — under-erase is
      cosmetic, over-erase destroys transcript).
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Emit the erase through the proxy's TTY-gated, `deps`-overridable write shape —
      copy the *shape* of `useChat.ts:336` (`const clearScreen = deps.clearScreen ?? (() => { … isTTY … })`)
      but **not its payload**. Keep the clamp to rows on screen as a one-line bound against a
      miscalculation; the spec records that it is *not* what makes the erase safe (cursor-up saturates at
      the top margin and cannot reach scrollback).
      **Do NOT** send `\x1b[3J` — it wipes the scrollback the committed transcript lives in, and upstream
      pointedly omits it inline. **Do NOT** bump `staticEpoch` (`ChatApp.tsx:342`) — it is a `<Static>`
      remount key and remounting replays the entire scrollback; a resize does not change the transcript.
      **Do NOT** re-emit `fullStaticOutput` — measured to duplicate scrollback on every resize.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Verify against the real binary under tmux.** Reproduce with all three conditions (shrink,
      an over-long frame line, ≥1 row above the frame), then confirm one composer block and zero residue.
      Record the before/after captures in the task report.
- [ ] **Step 6: Commit** — `f5(waveR-t4): erase the previous frame's physical rows on a reflowing shrink`.

---

## Task 5: Pickers and dialogs re-derive their width, and the regression test lands

**Epic:** EP-R1, `qa2-10a` + acceptance A12. **Files:** `src/tui/ModelPicker.tsx` and the other
width-deriving surfaces, `test/tui/`, plus a tmux-driven resize regression script under `harness/scripts/`.

**Why:** `qa2-10a` — a stale narrow copy of the `/model` picker sits above the live one after a resize.
And there is **no resize regression test in the repo at all**: `scripts/frames/` holds five `.keys`
scripts, none for resize, and the two test files mentioning "resize" assert width-keyed cache eviction and
per-snapshot `columns()` re-reads, not repaint. A1–A5 are otherwise unprotected.

- [ ] **Step 1: Write the failing tests.** A component test that a mounted picker re-derives its width when
      the injected size changes; and a resize regression script that drives the real binary under tmux
      through the QA-2 width matrix and asserts one composer block and zero stale rules per cell.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Thread Task 1's size state into the picker/dialog width derivations.
- [ ] **Step 4: Run both — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 5: Commit** — `f5(waveR-t5): pickers re-derive width on resize; the width matrix has a test`.

---

## Task 6: `/clear` repaints, and stops lying about scrollback

**Epic:** EP-R2. **Files:** `src/tui/useChat.ts`, `src/tui/chatMain.tsx`, `test/tui/clear-repaint.test.tsx`.

**Why:** `ccx`'s erase is fine; **the repaint is never written.** Ink's `Instance.clear()`
(`ink.js:213`) resets log-update's counters but **not `this.lastOutput`**, so the post-clear frame is
byte-identical to the pre-erase one and the dedupe at `ink.js:132`
(`if (!hasStaticOutput && output !== this.lastOutput)`) skips the write. It is byte-identical because the
transcript lives in `<Static>` — a clear does not change the composer or status bar at all. The
`hasStaticOutput` escape is closed by the same event: wiping `<Static>` makes `staticOutput === '\n'`,
which `ink.js:103` treats as empty.

Upstream's shape is the model (verified): `forceRedraw` (L180978) sets a flag via `forceFullReset`
(L178271) and calls `onRender()` **unconditionally** — no output-equality dedupe on that path.

- [ ] **Step 1: Write the failing test.** Assert that after a `/clear` the next committed frame contains
      the banner, composer and footer **without any further input**. Assert separately that the emitted
      reset payload contains no `\x1b[3J`.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Make the reset produce a render that cannot be skipped — mark the frame
      contaminated and force the render, rather than writing an erase and hoping a render follows. Change
      the payload at `useChat.ts:336` from `\x1b[2J\x1b[3J\x1b[H` to a viewport-only erase so scrollback
      survives, matching upstream inline.
- [ ] **Step 4: Fix the false canon comment.** `useChat.ts:334-335` claims the wipe is *"exactly like CC's
      /clear"*. It is not — upstream preserves scrollback inline. Under this repo's "comments as canon
      record" rule an overstated citation is a real defect. Correct it and cite L177120 / L176988.
- [ ] **Step 5: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 6: Verify under tmux** with the marker pre-fill, so "not blank" is proven rather than
      inferred. Confirm the `❯ /clear` echo survives and the scrollback above is intact.
- [ ] **Step 7: Commit** — `f5(waveR-t6): /clear forces an undedupable repaint and keeps scrollback`.

---

## Task 7: Closing the pager stops poisoning the renderer

**Epic:** EP-R4. **Files:** `src/tui/TranscriptPager.tsx` and the render-bookkeeping seam from Task 2,
`test/tui/`.

**Why:** raw pty after Escape shows **zero bytes for 8 seconds**, then an erase of 7 lines for a frame
that occupied ~36. The pager frame is taller than the pane, so Ink takes the full-screen branch at
`ink.js:121` and writes **straight to stdout, bypassing log-update**, leaving `previousOutput` and
`previousLineCount` stale for everything afterwards. This is the concrete mechanism behind the recorded
"a frame taller than the viewport leaks copies" hazard: the branch does not merely cost a redraw, it
**desynchronizes the bookkeeping**, so the *next* resize is wrong too.

- [ ] **Step 1: Write the failing test.** The acceptance that matters is the second-order one: open the
      pager, close it, **then resize**, and assert Task 4's erase still produces a clean screen. A test
      that only checks for visible border fragments would pass over a fix that leaves the cause in place.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Detect the full-screen-branch write through the proxy (Task 2 already sees
      every byte) and resynchronize the recorded frame geometry.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 5: Commit** — `f5(waveR-t7): resynchronize frame geometry after a full-screen-branch write`.

---

## Task 8: Take highlight.js and port upstream's three scope maps

**Epic:** EP-R5, part 1 (W-R5). **Files:** `harness/package.json`, `src/tui/diffHighlight.ts` (create),
`test/unit/diff-highlight.test.ts` (create).

**Why:** `src/tui/highlight.ts` is a clone of upstream's **markdown fenced-code** map `DhH` (L420495) —
four chalk colours, ten languages, written zero-dep by an explicit trade for a LOW-priority row. The
**diff** path is a different renderer: real highlight.js behind a 24-scope truecolor map. L419855 carries
**three** maps — `K$p` (Monokai/dark), `Y$p` (light, entirely different values), and `jmH` (256-colour
fallback via palette indices) — and `X$p` (L419856) maps bare filenames (`Dockerfile`, `Makefile`,
`Rakefile`, `Gemfile`, `CMakeLists`), so language detection is not extension-only.

**Leave `highlight.ts` alone.** It serves fenced code and its theme-independence is a recorded decision.

- [ ] **Step 1: Write the failing test.** Assert `highlightDiffLine(code, lang, theme)` returns `Segment[]`
      whose colours match upstream's map for the theme — dark and light must differ — and that an unknown
      language returns a single unstyled segment. Assert `detectLanguage("Dockerfile")` → `dockerfile`.
      Copy the exact RGB values from L419855; they are verbatim data, not approximations.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Add `highlight.js` to `dependencies`. Port the three scope maps and the
      filename map into `diffHighlight.ts`.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck`, `npm run test:unit`, and
      **`npm run build`** (a new dependency must resolve in the built `.d.ts` surface).
- [ ] **Step 5: Commit** — `f5(waveR-t8): highlight.js plus upstream's three diff scope maps`.

---

## Task 9: Tokenize added and context diff rows — and leave removed rows flat

**Epic:** EP-R5, part 2. **Files:** `src/tui/diffRender.ts`, `test/unit/`.

**Why:** upstream tokenizes added and context lines only. **L419813**, verbatim:

```js
let { lineNumber: g, marker: y, code: _ } = d[m], E = y === "-" ? [[cWo(o), _]] : i2p(s, _, o), …
```

The `-` branch emits one style/text pair. **`ccx`'s flat removed row is already correct** and the
triage's original acceptance criterion ("tokens inside added/**removed**/context lines") would have been a
regression. Today `plainRows` (`diffRender.ts:152`) wraps a plain string and emits one banded segment per
row, so wrapping must become segment-aware.

- [ ] **Step 1: Write the failing test.** For an added row, assert multiple segments with differing
      `color` over one constant `bg`. For a **removed** row, assert exactly one content segment. For a
      context row, assert tokens *and* that the number cell keeps its `dim` while the text does not — the
      existing asymmetry documented in `plainRows`' comment.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Make `wrapRows` segment-aware, tokenize non-`-` rows through Task 8, and band
      each token: `Segment` (`render.ts:18`) carries `color` and `bg` independently, so the band is a
      spread over the token's segment. Preserve the right-fill that runs the band to full width.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t9): tokenize added and context diff rows; removed rows stay flat`.

---

## Task 10: The word-diff arm puts the band under the token

**Epic:** EP-R5, part 3. **Files:** `src/tui/diffRender.ts` (`wordDiffRows`), `test/unit/`.

**Why:** composition is **band-under-token** — the diff owns the background only. `ZmH` (L419733):
`[{ ...c, background: y ? o : n }, A]`. Pinned live: on a word-diff row a string token kept one foreground
while its background flipped and flipped back across the word boundary.

- [ ] **Step 1: Write the failing test.** Build a row where a single syntactic token spans a word-diff
      boundary. Assert the `color` is identical across the split and only `bg` changes.
- [ ] **Step 2: Run it and watch it fail** (today the word-diff arm splits by band first).
- [ ] **Step 3: Implement.** Invert the order in `wordDiffRows`: tokenize first, then overlay the
      word-diff background onto the token segments.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t10): word-diff background overlays tokens instead of splitting them`.

---

## Task 11: Final verification

- [ ] **Step 1: Full gates.** `npm run typecheck`, `npm run test:unit`, `npm run test:tui`,
      `npm run build`. Report the counts; all must be green.
- [ ] **Step 2: Execute the spec's acceptance section as written** —
      `docs/superpowers/specs/2026-08-06-wave-r-repaint-geometry-design.md` § *Acceptance (the wave gate)*,
      criteria **A1–A12**, using the exact conditions each states. **A1–A5 under tmux or a real terminal,
      never pyte alone; blankness assertions use the marker pre-fill.**
- [ ] **Step 3: Record honestly.** Any criterion not met is reported as not met, with its output. Route
      anything that changed the design into the spec's `## Surprises & Discoveries` or `## Decision Log`.
- [ ] **Step 4: Commit** — `f5(waveR-t11): final verification pass`.

---

## Deferred out of this plan

- **EP-R0 / click-to-expand** and **EP-R3 / bottom-anchored composer** — closed and withdrawn respectively
  by the grounding round; both fold into the open FULLSCREEN-1 question.
- **APPLE-TERM-1** — Apple Terminal's reflow policy. W-R6's design detects the policy at runtime, so this
  is confirmation rather than a gate. It needs a 30-second script run by the owner; **no task here may
  attempt it by driving the GUI (W-R7).**
