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

The focused guard tests were then green after the minimal fixes. The implementation uses one deliberate `replaceBufferFromOutside` editor transition for prefill and external replacement, clears the queue ref synchronously before interrupt, synchronously tracks all handler-consumed callback/timing props through refs, derives status hints from active input ownership, preserves dim in a parallel pyte grid, fails closed in capture/diff, narrows masks, preserves kill-ring state through command submit, and rolls back suspend state on failure.

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
