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
belongs to, and read `W-R1…W-R7` in its Decision Log.** Canon citations (`L…`) refer to
`~/claude-code-bundle/2.1.220/cli.pretty.js`.

**Provenance:** this is **v2**, rewritten after an independent plan review that returned **nine Critical
findings** against v1 — four acceptance criteria with no implementing task, three tests that would have
reported green on the broken build, and one task that contradicted itself. Every "do NOT do X" below came
from a measurement where X produced a worse defect than the one being fixed. Take those seriously.

## Global Constraints

- **Dense hand-style, NO Prettier.** Match the surrounding file's formatting exactly. Do not reformat
  lines you did not change.
- **ESM:** every relative import specifier ends in `.js`.
- **TDD:** failing test → run it → minimal implementation → run it → commit. Every task ends committed.
- **Gates before each commit:** `npm run typecheck`, plus the suites covering your change
  (`npm run test:unit` and/or `npm run test:tui`). Both must be green; report the counts.
- **Never read or write the real `~/.claude`.** Set `CCX_FLEET_ROOT` to a temp dir. A test that touches
  the real prefs file is a defect regardless of whether it passes.
- **Never print or commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.** **Every *unit and TUI* test
  here is keyless.** Two acceptance runs (A3 mid-turn resize, and the two-turn width matrix cell) need a
  live turn — those are **controller-run**, keyed from `../.env`; an implementer stops at the clean skip.
- **NEVER drive a GUI application (W-R7).** No AppleScript against `Terminal.app`, iTerm, or anything
  else on this machine. Doing this during SP-R0 blocked Terminal's entire AppleEvent queue behind a modal
  sheet and needed a human to clear it. If you believe you need a real GUI terminal, stop and say so.
- **Resize acceptance runs under tmux, never under `capture-frames.py` (W-R2).** pyte truncates instead of
  reflowing and cannot reproduce the defect — a green pyte frame proves nothing about a resize fix. When
  asserting a row is *blank*, pre-fill the screen with a marker character first: `tmux capture-pane`
  cannot distinguish a painted blank from an unwritten cell.
- **The resize defect needs all three conditions to reproduce** (SP-R0): a width **shrink**, at least one
  emitted frame line **longer than the new width**, and at least one row of content **above the frame**.
  A repro missing any one of them shows a clean screen on a broken build.
- **Over-erasing is worse than under-erasing.** Under-erase leaves today's cosmetic residue; over-erase
  destroyed six live transcript rows in SP-R0's test. **Never correct optimistically.**
- **Commit messages:** `f5(waveR-tN): <what changed>`. No `Co-Authored-By`, no attribution trailers.
- **Do not push and do not open a PR.**

### Definitions used by several tasks

- **The QA-2 width matrix** (referenced by A1, A2, A12) is this fixed cell list, run from a session with
  content on screen, capturing after each step:
  `120×40 → 80×24 → 120×40` · `120×40 → 60×15 → 120×40` · `80×24 → 160×40 → 80×24` ·
  `120×40 → 100×40 → 90×40 → 80×40` (the accumulation cell, A2) · `120×24 → 120×40` and `80×40 → 80×15`
  (height-only controls, which must stay clean). A cell passes when the capture shows **exactly one
  composer block and zero rules at any width other than the current one**.
- **Driving tmux** — follow `docs/parity/qa-driver.md`. Sessions are named `wr-tN-*`; always
  `tmux kill-session` in a `finally`. Resize with `tmux resize-window -t <s> -x <cols> -y <rows>`.

### Task order

Tasks 1–6 (EP-R1) are **strictly sequential** and share `chatMain.tsx` / `ChatApp.tsx`. Tasks 7 (EP-R2)
and 8 (EP-R4) touch the same render bookkeeping and follow them, in that order. Tasks 9–12 (EP-R5) are
independent of everything above and may run in parallel under a **different owner**, but among themselves
are **strictly sequential: 9 → 10 → 11 → 12**. Task 13 is last.

---

## Task 1: Terminal size becomes React state

**Epic:** EP-R1, defect (i). **Files:** `src/tui/chatMain.tsx`, `src/tui/ChatApp.tsx`,
`test/tui/resize-state.test.tsx` (create).

**Why:** `grep -rn "on(\"resize\"|on('resize'|SIGWINCH" src/` returns nothing — `ccx` never subscribes.
Ink's own handler (`node_modules/ink/build/ink.js:83`) re-runs Yoga layout and re-serializes the existing
React tree but **never re-renders components**, so `ChatApp.tsx:140`'s `terminalColumns()` is only re-read
when something else causes a render. Width-derived strings freeze at the launch width.
`ChatComposer.tsx:252` documents the intended per-render read; the trigger is simply absent.

**Interfaces produced (later tasks depend on these names) — AS BUILT, corrected after Task 1 shipped:**
- `ChatApp` gains a **top-level optional prop** `onResize?: (cb: () => void) => () => void` — subscribe,
  returns the unsubscribe. Used as `<ChatApp onResize={…} />`, **not** `deps={{ onResize }}`.
  *The brief originally said "an optional dep"; the implementer correctly refused.* `deps` is typed
  `Parameters<typeof useChat>[2]` (`ChatApp.tsx:129`) — it is literally `useChat`'s own dep bag, and
  `useChat` has no use for a resize subscription, so putting it there would widen an unrelated contract.
  It follows the `suspend` prop's precedent instead.
- `terminalColumns()` / `terminalRows()` keep their **function-valued** shape. Do not convert them to plain
  numbers — `ChatComposer` reads `columns()` per render deliberately (`ChatComposer.tsx:252`).
- **Behaviour change later tasks must know:** the size is now sampled at mount and on each resize event,
  not on every call. **A test that wants a new width must fire the `onResize` emitter — mutating the
  backing variable alone is no longer enough.**
- **`onResize` must have a stable identity at every call site** — a module-scoped function or a
  `useCallback`, **never an inline arrow**. It is in the subscribing effect's dependency array, so a fresh
  closure per render tears down and re-attaches the listener every frame. (Task 1 review, Minor 2.)

- [ ] **Step 1: Write the failing test.** In `test/tui/resize-state.test.tsx`, render `ChatApp` with an
      injected `columns` dep backed by a mutable variable and a fake `onResize` emitter. Assert the frame
      contains a rule of the initial width; change the variable; fire the emitter; `await` a tick; assert
      the rule is now the new width. Use the `mount()` helper from `test/tui/select.test.tsx` — `useInput`
      subscribes in a passive effect, so writing before an awaited tick drops input.
- [ ] **Step 2: Run it and watch it fail** — `npx vitest run test/tui/resize-state.test.tsx`. Expect the
      rule to keep the old width.
- [ ] **Step 3: Implement.** Subscribe via the dep, store size in React state, feed `ChatApp.tsx:140/143`.
- [ ] **Step 4: Run the test — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 5: Commit** — `f5(waveR-t1): terminal size is React state, so a resize re-renders`.

---

## Task 2: The stdout proxy records the last frame's geometry

**Epic:** EP-R1, groundwork. **Files:** `src/tui/chatMain.tsx`, `test/unit/resume-safe-stdout.test.ts`.

**Why:** `createResumeSafeStdout` (`chatMain.tsx:40-65`) already wraps `stdout.write` in a Proxy whose
`get` trap returns `ccx`'s own `write`, so **every byte Ink emits already passes through code we own**.

**Interfaces produced — later tasks use these exact names:**

```ts
export function physicalRows(frame: string, width: number): number;
// ResumeSafeStdout gains:
lastFrame(): string | undefined;
```

**The trailing-newline convention — pin this, Task 4 depends on it.** Ink writes `output = str + '\n'` and
records `previousLineCount = output.split('\n').length`, i.e. **logical lines + 1**.
**`physicalRows(frame, width)` counts the frame's own lines only and does NOT add the trailing term.**
Task 4 adds the `+ 1` explicitly so the convention is visible at the point of use. SP-R0's worked example,
to be used as a test fixture: **6 logical lines · Ink erased 7 · the reflowed frame occupied 10 physical
rows · the correct erase is 11.**

**Identifying a frame write.** Four kinds of write reach the proxy. Record **only** the last one that is a
frame:
1. **Frame writes** — may be prefixed by Ink's erase sequence. Strip a leading run of
   `\x1b[2K` / `\x1b[1A` / `\x1b[G` before recording; what remains is the frame.
2. **Erase-only writes** (`Instance.clear()` → `log.clear()`) — nothing remains after the strip. **Do not
   record**; leave the previous frame in place.
3. **Static/transcript writes** — committed scrollback, not the live frame. **Do not record.**
4. **Suppressed writes** — anything written while `suppressNextWrite` is set exists to swallow Ink's stale
   resume clear. **Do not record.**

- [ ] **Step 1: Write the failing tests.** One per write kind above, asserting what `lastFrame()` returns
      after each. Plus `physicalRows` cases: a line **exactly** the width (the off-by-one that hides
      here), an empty line (counts 1), a line with wide/CJK characters (use `string-width`, already a
      dependency), and the SP-R0 fixture asserting 10.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** `physicalRows` as `Σ max(1, ceil(stringWidth(line) / width))` over
      `frame.replace(/\n$/, "").split("\n")`, plus frame capture with the four rules.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t2): the stdout proxy records the last frame and its physical height`.

---

## Task 3: The reflow oracle

**Epic:** EP-R1, the gate on the correction (W-R6). **Files:** `src/tui/reflowOracle.ts` (create),
`src/tui/keys/KeymapProvider.tsx`, `test/unit/reflow-oracle.test.ts` (create).

**Why:** the erase is only correct on an emulator that **reflows**. On one that truncates there is no
defect and the same correction destroys rows. SP-R0 refuted using the cursor **row** (tmux pins it and
scrolls the excess off the top, so reflow and scroll cancel) but proved the cursor **column** works:
across 120→80 it moves 121 → 41, exactly `((121−1) mod 80) + 1`, whereas pyte destroys the cell.

**Interfaces produced — Task 4 repeats these verbatim:**

```ts
export type ReflowVerdict = "reflow" | "truncate" | "unknown";
export function probeReflow(deps: {
  write: (s: string) => void;
  onReply: (cb: (row: number, col: number) => void) => () => void;
  colBefore: number; oldWidth: number; newWidth: number;
  timeoutMs?: number;               // default 150
}): Promise<ReflowVerdict>;
```

Verdict rule: `"reflow"` iff the reported column equals `((colBefore − 1) mod newWidth) + 1` **and**
`newWidth < oldWidth`; `"truncate"` on any other answered column; `"unknown"` on timeout.

**The delivery gap you must close first — v1 of this plan was unimplementable without it.** A DSR reply
`ESC[…R` parses to `ignored("unknown-sequence")` (`keys/parse.ts:133-134`; `CSI_LETTER` at `parse.ts:46`
has no `R`), which is correct — **but `KeymapProvider.tsx:151` then drops it**:

```ts
if (ev.kind === "ignored") return;    // mouse/focus/garbage: consumed, never inserted
```

Add an `onUnknownSequence?: (raw: string) => void` forward **before** that early return, and route the
oracle through it. **Do not add a second stdin reader** — two consumers of raw stdin will race.

- [ ] **Step 1: Write the failing tests.** Feed a synthetic `\x1b[<row>;<col>R` and assert each of the
      three verdicts, including that the timeout path **resolves** rather than hanging. Add a
      `KeymapProvider` test that an unknown CSI sequence reaches `onUnknownSequence` and still does not
      reach the keymap.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** the forward and `reflowOracle.ts`.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck`, `npm run test:unit`, `npm run test:tui`.
- [ ] **Step 5: Commit** — `f5(waveR-t3): a DSR-based reflow oracle, delivered through the key parser`.

---

## Task 4: Erase the previous frame on a reflowing width shrink

**Epic:** EP-R1, the fix. **Files:** `src/tui/resizeRepaint.ts` (create), `src/tui/chatMain.tsx`,
`test/unit/resize-repaint.test.ts` (create).

**Why:** Ink erases `output.split('\n').length` **logical** lines
(`node_modules/ink/build/log-update.js`) but a width change makes the emulator re-wrap the painted frame
into a different number of **physical** rows. SP-R0 measured `eraseLines(7)` for a frame occupying 10.
Residue is exactly `min(rowsAboveFrame, physicalRows(prev @ newWidth) − logicalLines(prev))`.

**Consumes:** `physicalRows`, `lastFrame` (Task 2); `ReflowVerdict`, `probeReflow` (Task 3, signature
repeated above — use it verbatim).

**The erase count is `physicalRows(lastFrame, newWidth) + 1`** — the `+ 1` mirrors Ink's trailing-newline
term, which Task 2's helper deliberately excludes. Worked example to pin in a test: **6 logical, Ink
erased 7, occupied 10, correct 11.**

**Emit nothing when `lastFrame()` is `undefined`, and cap the count at the terminal height.**
*(Corrected — the first version of this paragraph was wrong, and the Task 2 review disproved it.)*
I had claimed the `stdout.rows` cap "keeps every failure on the under-erase side". **It does not.** After
`app.clear()` the recorded frame can be stale in the **taller** direction while the cap never binds — the
review's counter-example is a recorded frame of 20 rows against 6 rows of real content in a 40-row
terminal, erasing 21 and destroying 15 live rows. The cap is not a safety mechanism; it is a bound on a
miscalculation.
**What actually makes it safe is upstream, in Task 2:** an erase-only write now clears the recorded frame,
so `lastFrame()` is `undefined` whenever the previous frame is known to be off screen. **Task 4 must emit
nothing in that case.** Combined with the "emit nothing unless the verdict is `reflow`" rule, that is what
keeps every remaining failure on the under-erase side. Ink's tall-frame chunk is never recorded either
(it fires on every ctrl+o pager open), so `lastFrame()` is a **lower** bound after it — EP-R4 resyncs.

**Timing.** Ink's own `resized` handler (`ink.js:83`) runs synchronously on `SIGWINCH` and repaints before
any of our async work can finish. **The erase must be emitted before Ink's repaint**, i.e. from a
synchronous `resize` listener registered **before** Ink's (Ink subscribes in its constructor at
`ink.js:77`, so ours must be attached first — do it in `chatMain.tsx` before `render()`), or the erase
lands after the new frame and destroys it. Because `probeReflow` is async, cache the verdict: probe once
on the **first** resize and reuse it, re-probing only if the answer was `"unknown"`.

- [ ] **Step 1: Write the failing tests.** With injected deps (last frame, old/new width, verdict, a
      recording writer): a **shrink** with `"reflow"` emits an erase covering `physicalRows + 1`; a
      **grow** emits nothing; `"truncate"` emits nothing; **`"unknown"` emits nothing** (the asymmetry
      rule). Add the SP-R0 worked-example fixture asserting 11.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Emit through a TTY-gated, `deps`-overridable writer — copy the *shape* of
      `useChat.ts:336` (`const clearScreen = deps.clearScreen ?? (() => { … isTTY … })`) but **not its
      payload**. Clamp to rows on screen as a one-line bound against miscalculation; the spec records that
      the clamp is *not* what makes the erase safe.
      **Do NOT** send `\x1b[3J` (wipes the scrollback the transcript lives in; upstream omits it inline).
      **Do NOT** bump `staticEpoch` (`ChatApp.tsx:342`) — remounting `<Static>` replays the whole
      scrollback and a resize does not change the transcript. **Do NOT** re-emit `fullStaticOutput` —
      measured to duplicate scrollback on every resize.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Verify against the real binary under tmux** with all three reproduction conditions.
      Record before/after captures in the task report.
- [ ] **Step 6: Commit** — `f5(waveR-t4): erase the previous frame's physical rows on a reflowing shrink`.

---

## Task 5: The model picker is given a width, and the width matrix gets a test

**Epic:** EP-R1 (`qa2-10a`, A5, A12). **Files:** `src/tui/ChatApp.tsx`,
`harness/scripts/resize-matrix.sh` (create), `test/tui/`.

**Why (sharper than filed):** `ModelPicker` **accepts** `rows` and `columns` props (`ModelPicker.tsx:31`)
but `ChatApp.tsx:431` renders it **passing neither**, so it falls back to its own mount-time
`process.stdout` read and can never re-derive. The fix is to thread Task 1's state, not to add a
re-derivation. Check every other dialog rendered near `ChatApp.tsx:431` for the same omission.

- [ ] **Step 1: Write the failing tests.** (a) A component test that a mounted `ModelPicker` re-derives
      its width when the injected size changes. (b) `resize-matrix.sh`, driving the real binary under tmux
      through **every cell of the QA-2 width matrix defined in Global Constraints**, asserting the pass
      condition per cell. It must include an explicit **A5 cell**: content on screen → shrink → submit a
      prompt → assert no composer placeholder above the submitted prompt.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Pass `rows`/`columns` from Task 1's state at `ChatApp.tsx:431` and to any
      sibling dialog missing them.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 5: Wire `resize-matrix.sh` into CI** so A12's "runs in CI" is true, and say in the task
      report exactly where it runs.
- [ ] **Step 6: Commit** — `f5(waveR-t5): the picker is passed a width; the width matrix runs in CI`.

---

## Task 6: Mid-turn resize, and the interrupt path

**Epic:** EP-R1, acceptance A3. **Files:** `test/tui/`, `harness/scripts/resize-matrix.sh`,
plus any fix the test exposes.

**Why:** `qa2-09` — resizing during a streaming turn showed up to four `esc to interrupt` rows with three
different elapsed times in one frame. **The finding's claim that this self-heals at end of turn is
refuted** (spec §12 item 14): after interrupting, every stale spinner row persisted verbatim. Tasks 1–5
may or may not fix this; nothing so far tests it, and v1 of this plan had no task for it at all.

- [ ] **Step 1: Write the failing test.** With a fake session that streams, resize mid-stream, then
      interrupt. Assert **exactly one** elapsed-time row and **exactly one** `esc to interrupt` in the
      frame after the interrupt. Keyless — drive the fake, not a live model.
- [ ] **Step 2: Run it.** If it already passes on top of Tasks 1–5, say so in the report and keep the test
      (it is A3's regression guard); do not invent a fix for a defect that is gone.
- [ ] **Step 3: If it fails, implement the fix.** The likely cause is that the in-flight turn's rows are
      rebuilt from a width captured at turn start — check `liveTurn.ts` and its `columns()` re-read.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 5: Add the live A3 cell to `resize-matrix.sh`**, guarded so it skips cleanly without a key.
- [ ] **Step 6: Commit** — `f5(waveR-t6): a mid-turn resize leaves one spinner, and the interrupt clears it`.

---

## Task 7: `/clear` repaints, and stops lying about scrollback

**Epic:** EP-R2. **Files:** `src/tui/useChat.ts`, `src/tui/chatMain.tsx`, `test/tui/clear-repaint.test.tsx`.

**Why:** `ccx`'s erase is fine; **the repaint is never written.** `Instance.clear()` (`ink.js:213`) resets
log-update's counters but **not `this.lastOutput`**, so the post-clear frame is byte-identical to the
pre-erase one and the dedupe at `ink.js:132` skips the write. It is byte-identical because the transcript
lives in `<Static>` — a clear changes neither composer nor status bar. The `hasStaticOutput` escape is
closed by the same event: wiping `<Static>` makes `staticOutput === '\n'`, which `ink.js:103` treats as
empty. Upstream's shape is the model: `forceRedraw` (L180978) sets a flag via `forceFullReset` (L178271)
and calls `onRender()` **unconditionally**.

**Test-design warning (v1's test would have passed on the broken build).** Asserting that the frame
*contains* banner/composer/footer proves nothing — the **stale** frame contains all three; that is exactly
what the defect leaves on screen. **Assert that a write landed after `/clear`**, using the existing
`stdout.frames.slice(start)` idiom already used in `test/tui/`.

- [ ] **Step 1: Write the failing test.** Record `stdout.frames.length` before `/clear`; submit it; await
      a tick; assert **at least one new frame was written** and that it carries the banner. Separately
      assert the emitted reset payload contains **no** `\x1b[3J`.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Make the reset produce a render that cannot be skipped — mark the frame
      contaminated and force the render, rather than writing an erase and hoping a render follows. Change
      the payload at `useChat.ts:336` to a viewport-only erase.
- [ ] **Step 4: Fix the false canon comment.** `useChat.ts:334-335` claims the wipe is *"exactly like CC's
      /clear"*. It is not — upstream preserves scrollback inline. Under this repo's "comments as canon
      record" rule an overstated citation is a real defect. Correct it and cite L177120 / L176988.
- [ ] **Step 5: Run — expect PASS.** Then `npm run typecheck` and `npm run test:tui`.
- [ ] **Step 6: Verify under tmux** with the marker pre-fill; confirm the `❯ /clear` echo survives and the
      scrollback above is intact.
- [ ] **Step 7: Commit** — `f5(waveR-t7): /clear forces an undedupable repaint and keeps scrollback`.

---

## Task 8: Closing the pager stops poisoning the renderer

**Epic:** EP-R4. **Files:** `src/tui/TranscriptPager.tsx`, the Task 2 seam,
`test/unit/pager-bookkeeping.test.ts` (create).

**Why:** raw pty after Escape shows **zero bytes for 8 seconds**, then an erase of 7 lines for a frame
that occupied ~36. The pager frame is taller than the pane, so Ink takes the full-screen branch at
`ink.js:121` and writes **straight to stdout, bypassing log-update**, leaving `previousOutput` and
`previousLineCount` stale for everything afterwards. This is the mechanism behind the recorded "a frame
taller than the viewport leaks copies" hazard: it desynchronizes the bookkeeping, so the *next* resize is
wrong too.

**Test-design warning (v1's test could not fail).** `ink-testing-library`'s stdout stub exposes no `rows`,
so `ink.js:121`'s `outputHeight >= this.options.stdout.rows` never fires under `test/tui/`, and the proxy
is not installed there at all. **Write this as a unit test** against the proxy with a stub that exposes
`rows`, simulating a full-screen-branch write directly. Then confirm the real behaviour under tmux.

- [ ] **Step 1: Write the failing unit test.** Simulate a taller-than-`rows` write reaching the proxy,
      then a resize, and assert the erase computed by Task 4 matches the **actual** frame rather than the
      stale bookkeeping.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Detect the full-screen-branch write through the proxy and resynchronize the
      recorded frame geometry.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Verify under tmux** — open the pager, close it, **then resize**, and confirm the screen is
      clean. This second-order check is A8's real content; a test that only looks for border fragments
      would pass over a fix that leaves the cause in place.
- [ ] **Step 6: Commit** — `f5(waveR-t8): resynchronize frame geometry after a full-screen-branch write`.

---

## Task 9: Take highlight.js and port upstream's three scope maps

**Epic:** EP-R5 part 1 (W-R5). **Files:** `harness/package.json`, `src/tui/diffHighlight.ts` (create),
`test/unit/diff-highlight.test.ts` (create).

**Why:** `src/tui/highlight.ts` is a clone of upstream's **markdown fenced-code** map `DhH` (L420495) —
four chalk colours, ten languages, written zero-dep by an explicit trade for a LOW-priority row. The
**diff** path is real highlight.js behind a 24-scope truecolor map. **L419855 carries three maps**:
`K$p` (Monokai/dark), `Y$p` (light, entirely different values), `jmH` (256-colour fallback via palette
indices). `X$p` (L419856) maps bare filenames — `Dockerfile`, `Makefile`, `Rakefile`, `Gemfile`,
`CMakeLists`.

**Leave `highlight.ts` alone.** It serves fenced code and its theme-independence is a recorded decision.

**Interfaces produced:**

```ts
export type DiffPalette = "dark" | "light" | "ansi256";
export function selectPalette(deps?: { env?: NodeJS.ProcessEnv; theme?: string }): DiffPalette;
export function detectLanguage(filePath: string): string | undefined;
export function highlightDiffLine(code: string, lang: string | undefined, palette: DiffPalette): Segment[];
```

`selectPalette` picks `ansi256` when the terminal is **not** truecolor (`COLORTERM` is neither
`truecolor` nor `24bit`), else `dark`/`light` from the active theme. Without this, `jmH` would be ported
and never selected — A10 would be unmet with all its tests green.

- [ ] **Step 1: Write the failing tests.** Colours match upstream per palette (dark and light **must**
      differ); unknown language → one unstyled segment; `detectLanguage("Dockerfile")` → `dockerfile`;
      `selectPalette` returns `ansi256` with `COLORTERM` unset and `dark` with `COLORTERM=truecolor`.
      Copy the RGB values verbatim from L419855 — they are data, not approximations.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Add `highlight.js` to `dependencies`; port the three scope maps and `X$p`.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck`, `npm run test:unit`, and **`npm run build`**
      (a new dependency must resolve in the built `.d.ts` surface).
- [ ] **Step 5: Commit** — `f5(waveR-t9): highlight.js plus upstream's three diff scope maps`.

---

## Task 10: Carry the file path to the diff renderer

**Epic:** EP-R5 part 2 — **without this, A11 is unreachable.** **Files:** `src/tui/diffSource.ts`,
`src/tui/diffRender.ts`, `src/tui/toolSummaries.ts`, `test/unit/`.

**Why:** `ResolvedPatch` (`diffSource.ts:17`) is
`{ hunks; numbering; added; removed }` — **no file path** — and `renderDiff(patch, width)` has nowhere to
get one, so no Edit row can be language-detected. The path *is* available upstream of the result:
`derivedPatch(oldText, newText, filePath, readFile)` already receives it at `diffSource.ts:92`.

- [ ] **Step 1: Write the failing test.** Assert `resolvePatch({ input: { file_path: "/x/Dockerfile", … } })`
      returns a patch carrying `filePath`, and that it survives the `memo` `WeakMap` cache
      (`diffSource.ts:113`) rather than being dropped on a cache hit.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Add `filePath?: string` to `ResolvedPatch`; populate it in both `sidecarPatch`
      and `derivedPatch`; thread it through `renderDiff` to the row renderers.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t10): ResolvedPatch carries the file path`.

---

## Task 11: Tokenize added and context rows — and leave removed rows flat

**Epic:** EP-R5 part 3. **Files:** `src/tui/diffRender.ts`, `test/unit/`.

**Why:** upstream tokenizes added and context lines only. **L419813**, verbatim:

```js
let { lineNumber: g, marker: y, code: _ } = d[m], E = y === "-" ? [[cWo(o), _]] : i2p(s, _, o), …
```

The `-` branch emits one style/text pair. **`ccx`'s flat removed row is already correct** — highlighting
it would be a regression, and the triage's original criterion said to do exactly that.

**Disambiguation — there are TWO `wrapRows`.** `diffRender.ts:99` and `render.ts:98` are
identically-named, identically-bodied, and unrelated. **Only `diffRender.ts:99` is in scope** (its callers
are `:135`, the word-diff arm, and `:155`, `plainRows`). Changing `render.ts:98` would break markdown
rendering.

- [ ] **Step 1: Write the failing tests.** Added row → multiple segments, differing `color`, one constant
      `bg`. **Removed row → exactly one content segment.** Context row → tokens, *and* the number cell
      keeps its `dim` while the text does not (the asymmetry documented in `plainRows`' own comment).
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Make `diffRender.ts:99`'s wrapping segment-aware; tokenize non-`-` rows via
      Task 9 using Task 10's path; band each token — `Segment` (`render.ts:18`) carries `color` and `bg`
      independently, so the band is a spread. Preserve the right-fill that runs the band to full width.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t11): tokenize added and context diff rows; removed rows stay flat`.

---

## Task 12: The word-diff arm puts the band under the token

**Epic:** EP-R5 part 4. **Files:** `src/tui/diffRender.ts` (`wordDiffRows`, caller at `:135`), `test/unit/`.

**Why:** composition is **band-under-token** — the diff owns the background only. `ZmH` (L419733), with
the literal at **L419757**:

```js
if (l.push([{ ...c, background: y ? o : n }, A]), f = f.slice(E), m = _, m >= g.end)
```

Pinned live: on a word-diff row a string token kept one foreground while its background flipped and
flipped back across the word boundary.

- [ ] **Step 1: Write the failing test.** Build a row where a single syntactic token spans a word-diff
      boundary. Assert `color` is identical across the split and only `bg` changes.
- [ ] **Step 2: Run it and watch it fail** (today the arm splits by band first).
- [ ] **Step 3: Implement.** Invert the order in `wordDiffRows`: tokenize first, overlay the word-diff
      background onto the token segments.
- [ ] **Step 4: Run — expect PASS.** Then `npm run typecheck` and `npm run test:unit`.
- [ ] **Step 5: Commit** — `f5(waveR-t12): word-diff background overlays tokens instead of splitting them`.

---

## Task 13: Final verification

- [ ] **Step 1: Full gates.** `npm run typecheck`, `npm run test:unit`, `npm run test:tui`,
      `npm run build`. Report the counts; all must be green.
- [ ] **Step 2: Execute the spec's acceptance section as written** —
      `docs/superpowers/specs/2026-08-06-wave-r-repaint-geometry-design.md` § *Acceptance (the wave gate)*,
      criteria **A1–A12**, with the exact conditions each states. **A1–A5 under tmux or a real terminal,
      never pyte alone; blankness assertions use the marker pre-fill.** The two live cells (A3, and the
      two-turn matrix cell) are controller-run and keyed.
- [ ] **Step 3: Record honestly.** Any criterion not met is reported as not met, with its output. Route
      anything that changed the design into the spec's `## Surprises & Discoveries` or `## Decision Log`.
- [ ] **Step 4: Commit** — `f5(waveR-t13): final verification pass`.

---

## Deferred out of this plan

- **EP-R0 / click-to-expand** and **EP-R3 / bottom-anchored composer** — closed and withdrawn by the
  grounding round; both fold into the open FULLSCREEN-1 question.
- **APPLE-TERM-1** — Apple Terminal's reflow policy. Task 3's oracle detects the policy at runtime, so
  this is confirmation rather than a gate. It needs a script run by the owner; **no task here may attempt
  it by driving the GUI (W-R7).**
