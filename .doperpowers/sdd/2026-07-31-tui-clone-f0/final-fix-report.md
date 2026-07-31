# F0 Final-Review Fix Report

Date: 2026-08-01
Status: DONE_WITH_CONCERNS

## Scope and commits

This report records the consolidated final-review pass requested in:

`/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-review-findings.md`

Implementation and regression coverage are committed on `main` as:

- `fa4c313c885cd7872ad72ef630b1f95d23c6156b` — `f0: close final-review TUI fidelity defects`

The scorecard evidence update and this report are prepared as a follow-up documentation commit after that implementation SHA exists. No push was performed.

The following pre-existing untracked files were not edited, staged, removed, or used as test inputs:

- `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/test/tui/tmp-probe-rescue-popup.test.tsx`
- `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/70-subagent-session-addressability.ts`
- `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/70b-subagent-addressability-keyless.ts`
- `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/71-detached-session-survival.ts`
- `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/71-parent-lifecycle.ts`
- `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/71-worker-child.mjs`
- `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/.doperpowers/sdd/progress.md`

## Focused red-proof evidence

Every non-deferred finding received a focused regression proof before its correction. The initial red runs reproduced the following defects:

1. **Queue rescue / replacement state:** an open `/mod` completion popup survived queue rescue; the visible rescued text coexisted with stale autocomplete state and a subsequent Enter could submit `/model`. External replacement also retained stale history-navigation, undo, kill-run, and yank coordinates.
2. **Stale composer callbacks:** Enter/Escape/chord events delivered immediately after rerender still reached the previous callback closure.
3. **Focus-blind status hints:** permission/question/plan and overlay states still rendered the global composer hint, including `[y/n...]` or `Esc interrupt` where those bindings were not owned by the visible surface.
4. **Frame emulator:** plain and SGR-2 dim cells serialized identically; retained attributes were incomplete.
5. **Capture/diff false success:** early child exit, zero/empty input, partial capture, missing counterparts, and allowlisted missing files could report success.
6. **Global masks:** broad path, email, and agent-count masking erased semantic differences such as distinct file suffixes and task counts.
7. **Slash-command submission:** submitting a slash command reset the kill ring, so a following Ctrl-Y could not restore killed text.
8. **Suspend:** the Windows path still attempted POSIX signal/raw-mode behavior, and signal failure could leave raw mode and listeners installed.
9. **Escape arm state:** busy transitions and non-Escape chord branches could leave the Escape clear arm live into the next state.
10. **Permissions footer:** managed workspace rows advertised Enter despite having no Enter action.
11. **Documentation:** stale reference/citation and Task 11 quoting claims were inconsistent with the current source of truth.

The focused guard tests were then green after the minimal fixes. The implementation uses one deliberate `replaceBufferFromOutside` editor transition for prefill and external replacement, clears the queue ref synchronously before interrupt, synchronously tracks all handler-consumed callback/timing props through refs, derives status hints from active input ownership, preserves dim in extended pyte-compatible cells, fails closed in capture/diff, narrows masks, preserves kill-ring state through command submit, and rolls back suspend state on failure.

## Commands and final results

All package commands were run from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`.

- `npm run typecheck`
  - PASS; `tsc --noEmit` completed with no diagnostics.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`
  - PASS; **39 test files passed, 640 tests passed, 9 gated live tests skipped**.
  - The excluded file is the one pre-existing untracked concurrent probe named above.
- `npm run test:unit`
  - PASS; **135 test files passed, 1,227 tests passed**.
- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`
  - PASS; **7 Python tests passed**.
- `git diff --check`
  - PASS before the implementation commit.

Two command-shape mistakes were harmless and did not modify the tree: an initial npm gate was run from `CC-to-SDK/` instead of `harness/`, and a first explicit multi-file Vitest invocation was interpreted by Vitest 2 as conjunctive filters. The successful commands above are the authoritative gates.

## F0 acceptance 1–8

1. **Queue rescue with three queued messages — PASS.**
   - Unit coverage in `test/tui/chat.test.tsx` proves exact newline order, cursor-at-end, queue clearing, popup removal, and subsequent Enter submission.
   - Keyed pty acceptance was run once with credentials loaded only inside that command using `.env`.
   - The cleaned output ended with the composer holding `one`, `two`, and `three` in that order. Later frames contained no `⋯ queued:` rows. The turn was interrupted and the rescued buffer remained visible.
2. **Escape clear and immediate history restore — PASS.**
   - Keyless pty run: `RAW:draft`, Escape, Escape, Up.
   - Output showed `Esc again to clear`, an empty composer after the second Escape, and `draft` restored after Up.
3. **Kill ring, yank, and yank-pop — PASS.**
   - `test/tui/editor.test.ts` covers Ctrl-U/Ctrl-K/Ctrl-W, coalescing, ring cap, Ctrl-Y, Alt-Y cycling, run termination, and survival across normal and slash-command submission.
4. **Raw Ctrl-_ undo — PASS.**
   - Editor tests exercise the actual bare `0x1f` terminal byte and verify undo without inserting a control character.
5. **Help overlay ownership — PASS.**
   - TUI tests prove Ctrl-O and other non-Escape input do not close the overlay or fire underlying global chords; Escape is the close action.
6. **Ctrl-D and Ctrl-Z — PASS with one manual-operation concern.**
   - Keyless pty run showed `Press Ctrl-D again to exit`, remained alive after the first press, and exited on the driver's second press.
   - Unit tests prove POSIX listener-before-kill ordering, process-group signaling, rollback on signal/listener failure, and Windows-safe no-op behavior. Windows no longer advertises Ctrl-Z.
   - A live shell `fg` cycle was not performed by the automated pty driver; the POSIX signal ordering and raw-mode behavior are covered by injected unit tests. The first owner-run interactive `Ctrl-Z`/`fg` check remains a manual concern.
7. **Permission y/n bindings — PASS.**
   - `test/tui/components.test.tsx` proves y accepts and n rejects in the permission dialog, while question/plan dialogs no longer inherit a false global y/n hint.
8. **Scorecard honesty — PASS.**
   - `grep -c 'Claude Code Src' docs/parity/tui-ux.md` returned `0`.
   - `plan-usage` appears in the recorded-additions section rather than the parity denominator.
   - The headline is explicitly corrected from approximately 88% to approximately 63%; the scorecard names `~/claude-code-bundle/2.1.220/` and records the final-review implementation commit `fa4c313c88`.

## Frame instrument re-check

The final captures were produced with the same `/tmp/frame-scratch` cwd and 100x40 geometry as the goldens:

- Help overlay: **3 frames written** (`01-boot`, `02-help`, `03-closed`).
- Composer basics: **5 frames written** (`01-typed`, `02-esc-armed`, `03-cleared`, `04-killed`, `05-yanked`).

The corrected diff contract was exercised against both baselines:

- Help overlay: `0 clean, 0 allowlisted, 3 DIVERGENT`; exit code `1`.
- Composer basics: `0 clean, 0 allowlisted, 5 DIVERGENT`; exit code `1`.

These divergences are expected F0 baseline differences in boot layout/chrome and are not false-success results. The important instrument property is now fail-closed: missing, empty, partial, and missing-counterpart inputs cannot become clean through an allowlist.

## Concerns

- The frame baseline is intentionally divergent because the later visual-fidelity waves have not yet closed the large upstream boot/chrome/layout gap. This is recorded as a concern, not hidden as an allowlisted success.
- Automated acceptance cannot perform a human shell `fg` interaction after SIGTSTP; POSIX suspend ordering and rollback are unit-covered, but the first owner-run terminal acceptance should include Ctrl-Z, `fg`, and a subsequent keypress.
- No credentials, tokens, or `.env` contents were printed or committed. No push was performed.

## Second re-review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview-findings.md`.

Implementation and tests are committed on `main` as:

- `11f412e285fec056b26ee8a80d243e716425b4aa` — `f0: close second rereview boundary cases`

### TDD red proofs

The eight fresh boundary cases were written and run red before their production corrections:

1. **Help/root routing:** the immediate current-suspend callback test timed out because the root handler called the stale callback. The immediate help test also established the race boundary that the root must own.
2. **Dim mutation state:** byte-feed tests failed for bottom-margin scroll, erase under current dim attributes, insert mode, and wide-cell overwrite. The initial parallel-grid implementation attached dim to the wrong cells or left stale wide-cell stubs.
3. **Mask scope:** the semantic matrix failed because global email, percentage, cost, duration, and token masks collapsed arbitrary transcript values. The frame-scoped loader was initially absent and its new round-trip test failed with `load_masks() takes 1 positional argument but 2 were given`.
4. **Whitespace clear:** `clearToHistory` returned the whitespace buffer unchanged.
5. **Ctrl-W at line start:** Ctrl-W joined the lines but left the kill ring unchanged, so Ctrl-Y could not restore the line structure.
6. **Whitespace prepend:** the rescue test received `queued` instead of the required exact `queued\\n   `.
7. **Immediate busy hint:** the first busy render still contained `Esc again to clear` before the passive effect ran.
8. **Documentation:** stale source/scorecard claims were updated as part of this pass and the new reachable commit is recorded above.

### Corrections

- `ChatApp` now keeps root state and every handler-consumed callback in synchronously-current refs. It owns Escape while the visible help overlay is mounted; `ShortcutsOverlay` remains interactive for standalone use but is presentational in `ChatApp`, eliminating the passive-effect leak without duplicate close handlers.
- `DimScreen` now uses a pyte-compatible extended cell tuple carrying `dim`, so scroll, erase, insert/delete characters, insert/delete lines, and wide-cell overwrite move or clear dim with the actual pyte cell. No parallel mutation grid remains.
- `frame-diff.py` now selects `by_frame` masks by scenario/frame key. Global masks are restricted to home/user prefixes and UUIDs; dashboard and identity patterns are scoped to the two known golden scenarios. Arbitrary `Notify`, progress, cost, and token text remains distinguishable.
- Whitespace-only clear now empties the buffer without adding whitespace to history. Ctrl-W at column zero follows upstream's preceding-word-plus-newline kill, and yank restores the original multiline structure. Prepend rescue preserves any non-empty draft, including spaces. The clear hint is synchronously hidden on the first busy render and cannot resurrect after returning idle.

### Pass 2 gates

- `npm run typecheck`: **PASS**.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`: **PASS; 39 files, 646 tests passed, 9 gated live tests skipped**.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests passed**.
- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 13 tests passed**.
- `git diff --check`: **PASS** before commit.

### Pass 2 acceptance 1–8

1. **Queue rescue: PASS.** A keyed long-turn pty run ended with the exact composer lines `one`, `two`, `three` in order and no queued rows after Escape. The first short-turn attempt exposed a timing race where `one` had already drained; the long-turn rerun held all three queued and passed the required exact contract.
2. **Escape clear/restore: PASS.** Keyless pty output showed the clear hint, an empty composer after the second Escape, and no whitespace history restoration when Up followed a whitespace-only clear.
3. **Kill ring/yank-pop: PASS.** Editor tests now cover line-boundary Ctrl-W killing `old\\n` and Ctrl-Y restoring `old`/`new` lines without selecting an older ring entry.
4. **Raw Ctrl-_ undo: PASS.** Existing raw `0x1f` tests remained green in the full TUI suite.
5. **Immediate help ownership: PASS.** Keyless pty output showed `Keyboard shortcuts`; immediate Ctrl-O did not open the pager, and immediate Escape returned to the composer. The current-suspend callback rerender test also passed.
6. **Ctrl-D/Ctrl-Z: PASS with the existing manual fg concern.** The keyless Ctrl-D run showed `Press Ctrl-D again to exit`; unit coverage still proves POSIX suspend ordering and Windows-safe behavior. A human `fg` cycle remains outside the automated pty driver.
7. **Permission y/n and decision hint honesty: PASS.** Existing permission/question/plan tests and the full suite remained green; global composer hints remain hidden under decision owners.
8. **Scorecard/docs: PASS.** The scorecard no longer claims a global pending `[y/n...]` hint, queue destruction, global style masking, or a parallel dim grid. Plan/spec revision notes document the second boundary pass and cite this implementation commit.

### Pass 2 frame baseline

The corrected capture/diff instrument wrote the expected **3 help-overlay** and **5 composer-basics** frames. With scoped masks, the baseline remains intentionally divergent:

- Help overlay: `0 clean, 0 allowlisted, 3 DIVERGENT`; exit code `1`.
- Composer basics: `0 clean, 0 allowlisted, 5 DIVERGENT`; exit code `1`.

The mutation suite also proves style survives dim scroll/erase/insert/delete/wide-cell cases and that missing/empty/partial/missing-counterpart inputs cannot become clean.
