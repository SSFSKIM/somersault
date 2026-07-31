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

## Third re-review pass

Implementation is committed on `main` as `181470a918` (`f0: close third rereview boundary cases`). No
push was performed. The protected concurrent untracked probe files were not staged or edited.

### TDD red proofs and implementation decisions

1. **Permission safety.** The raw Ctrl-Y/Ctrl-N/Alt-Y/Alt-N regression test initially collected four
   decisions. `PermissionDialog` now requires a bare printable key before accepting `y` or `n`; arrows,
   Enter, numeric selection, and legacy aliases are unchanged.
2. **Immediate-dead capture.** A zero-wait `frame:boot` against `true` initially exited zero and wrote an
   ANSI blank frame. Each frame now performs a 20 ms bounded pty/readiness settle, observes `waitpid`, and
   requires at least one visible screen cell before writing. Ten immediate-dead attempts fail; a zero-wait
   live child that renders `ready` succeeds.
3. **One-frame composer lag.** The emitted-frame test initially captured `sentinel-draft` alongside stale
   `Esc rewind · ? help`. Editor keyboard affordances now render in `ChatComposer`, with the same state
   that renders drafts and autocomplete. `ChatStatusBar` carries metadata only; a synchronous draft-start
   callback remains solely to disarm ChatApp's unrelated rewind arm.
4. **Mask semantics and identity.** The old scoped-mask test collapsed arbitrary transcript cost/duration/
   token text. A shared `frame_masks.py` contract separates dashboard-anchored write-time identity
   redactions from scoped quota/status comparison masks. The test matrix preserves transcript email, UUID,
   path, count, percentage, cost, duration, token and timestamp differences; sanitized synthetic identities
   derived from the tracked ANSI layouts redact byte-identically to all eight stored fixtures.
5. **Wide continuation overwrite.** Overwriting the trailing half of a dim `界` initially retained the
   leading glyph. `DimScreen` now clears both actual pyte cells before a write targets either half; centre
   and row-edge continuation cases prove both glyph and dim style disappear.
6. **Ctrl-D affordance.** The old arm hint stayed visible after typing although Ctrl-D could not exit.
   The arm still follows upstream's intervening-key behavior, but its hint renders only when the composer
   is empty. Clearing text inside the live arm window restores the hint and makes the second press exit.
7. **Scorecard and operating docs.** The help-overlay C5 note now says Escape-only. `#` memory mode moved
   out of the cloning denominator into Recorded additions; parsed tables recompute input/composer to
   `19.5/25 = 78.0%` and the unweighted headline to `63.2%` (still `~63%`). The full-use checklist and
   capability coverage now identify Ctrl-Z as suspend and `/detach` as detach.
8. **Capture documentation.** `VERSION` records the exact 2.1.220, 100x40, `/tmp/frame-scratch`,
   redaction-required capture commands. The script refuses a tracked-fixture-shaped destination without
   `--redact-masks`; the test proves a safe run stores no raw identity. The allowlist parser now ignores
   prose/examples, restoring the required 3/3 help baseline.

### Final verification

Commands were run from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness` unless noted.

- `npm run typecheck`: **PASS**.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`: **PASS; 39 files,
  648 tests; 9 gated live tests skipped**.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests**.
- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 19 tests**.
- `git diff --check`: **PASS** before the implementation commit.
- The scorecard table parser reported: 18 complete, 3 partial and 4 missing of 25 input/composer rows,
  yielding 78.0%; the six other category percentages remain 56.7, 36.1, 50.0, 85.7, 61.1 and 75.0.

### F0 acceptance 1–8

1. **Queue rescue: PASS.** Existing ChatApp rescue coverage remained green in the complete TUI suite.
2. **Escape clear/history restore: PASS.** The complete TUI suite includes the existing clear/restore and
   rewind-arm regression tests.
3. **Kill ring/yank-pop: PASS.** The complete TUI suite includes the editor ring and multiline Ctrl-W tests.
4. **Raw Ctrl-_ undo: PASS.** The complete TUI suite includes the bare `0x1f` behavior proof.
5. **Help ownership: PASS.** The complete TUI suite includes overlay routing and Escape-only ownership.
6. **Ctrl-D/Ctrl-Z: PASS with the existing manual `fg` concern.** New coverage proves the Ctrl-D hint is
   absent for nonempty text, reappears only when its exit is executable, and exits on the second empty
   press. Existing suspend unit coverage remains green.
7. **Permission y/n: PASS.** Bare `y`/`n` still decide; raw Ctrl-Y, Ctrl-N, Alt-Y, and Alt-N decide nothing.
8. **Scorecard honesty: PASS.** The parsed table totals, corrected help statement, Recorded-additions move,
   detach wording and current frame/mask contract were checked as above.

### Frame baseline

A fresh capture at 100x40 with `/tmp/frame-scratch` wrote all expected files and no tracked fixture:

- Help overlay: **3 frames written; `0 clean, 0 allowlisted, 3 DIVERGENT`; exit 1**.
- Composer basics: **5 frames written; `0 clean, 0 allowlisted, 5 DIVERGENT`; exit 1**.

The divergence is the known fidelity baseline, not an instrument false-success. The only remaining concern
is the pre-existing manual shell `Ctrl-Z` → `fg` acceptance, which the automated pty driver cannot safely
perform; raw-mode ordering and restoration remain unit-covered.

## Fourth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview4-findings.md`.

### TDD red proofs and corrections

1. **Tracked fixture redaction coverage.** A tracked renamed scenario supplied with a masks file but no
   matching `redactions_by_frame` entry initially returned success, which proved that the flag-only guard
   could execute a child and write raw identity. Capture now resolves every scripted frame key before
   `mkdir` or `pty.fork` and refuses the entire batch when any key has an empty applicable rule set. The
   regression test covers no-match and partial-coverage batches, asserts no child side effect or frame
   file, and retains successful explicitly redacted and untracked captures.
2. **Retiring composer input ownership.** ChatApp writes a scoped input-owner ref during render and gives
   ChatComposer the same ref; its listener returns before every composer/autocomplete branch unless it is
   still owner. The initial test correctly found that the old listener fan-out could act after help became
   visible, but its Ctrl-Z conclusion was superseded in the fifth pass by upstream raw-input evidence:
   Ctrl-Z is a process-level exception that precedes Help. Ordinary immediate Help keys still prove no
   mode change, pager, or rewind arm, and a pending-dialog transition has the same stale-listener guard.
3. **External prefill and rewind.** The direct prefill regression initially observed zero draft-start
   notifications for an empty-to-nonempty replacement, and the ChatApp history-prefill regression rendered
   both `Esc clear` and `Press Esc again to rewind`. ChatComposer now synchronously notifies the current
   parent callback from the prefill effect before scheduling the replacement. Empty prefill and prepend to
   a nonempty draft do not notify again. The first post-history-prefill frame has no rewind arm and Escape
   takes only the local clear path.
4. **Hermetic fixture identity proof.** A clean shallow clone initially failed because the Python suite
   executed `git show` against unreachable object `d6b2b6d849`. The test now builds deterministic sanitized
   fake identities into the current tracked ANSI layouts and asserts exact redaction round-trips for all
   eight fixtures; no test or operational documentation uses that object. A fresh depth-one local clone
   ran all 21 Python tests successfully and its tracked fixture/test source contains neither the object
   identifier nor `git show` loading.

### Fourth-pass verification

- `npm run typecheck`: **PASS**.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`: **PASS; 39 files,
  652 tests passed, 9 gated live tests skipped**.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests passed**.
- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 21
  tests passed**.
- Focused red/green coverage: the old help implementation called suspend once; the old history-prefill
  frame retained the rewind arm; the old direct prefill callback count was zero; the old capture guard
  returned zero for an unmatched tracked key. All corresponding focused tests are green after correction.
- A fresh frame capture at 100x40 with `/tmp/frame-scratch` produced **3 help** and **5 composer** frames.
  The baseline remains `0 clean, 0 allowlisted, 3 DIVERGENT` for help and `0 clean, 0 allowlisted, 5
  DIVERGENT` for composer, each with expected diff exit code 1.
- F0 acceptance remains covered by the complete TUI/unit suites. The keyless PTY runs again showed the
  Escape-clear affordance and the Ctrl-D first-press hint followed by clean exit; the real terminal
  Ctrl-Z → `fg` round-trip remains the only manual concern. No credentials were printed.

## Fifth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview5-findings.md`.

1. **Counted, atomic tracked redaction.** `redactions_by_frame` now declares a contract object for every
   tracked frame key: named patterns with individual `minimum_matches` and a total `minimum_matches`.
   Capture counts substitutions, rejects a zero-match or changed-ANSI-boundary rule, stages all tracked
   frames outside the target, and promotes only after every expected frame validates. Red proofs showed
   that the former list-presence guard returned success for zero matches and wrote the first frame before a
   later required rule failed. The new tests cover those failures, exact two-identity coverage, an explicit
   safe no-identity frame, and confirm no raw fake identity is persisted.
2. **Visible owner wins over hidden decisions.** The input-owner ref now represents `decision` only where
   the render chain actually displays the decision. Higher-priority history, settings, model, and session
   overlays remain `overlay`, so a newly parked hidden decision cannot enable ChatApp root chords beneath
   them. The regression matrix parks an Edit decision under each surface, proves Ctrl-C is handled only by
   the visible surface, then closes it and answers the visible decision once with no exit arm.
3. **Upstream Ctrl-Z precedence restored.** Verified against
   `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js:177648-177703`: patched Ink calls
   `handleSuspend()` and `continue`s before `dispatchKeyboardEvent`, so Help and modal swallowing never
   receive Ctrl-Z. ChatApp now routes Ctrl-Z before every owner gate. The Help, history, settings, model,
   and session tests prove the current suspend callback runs exactly once without triggering an overlay
   action. Windows remains safe because `suspendProcess` is an existing no-op there.
4. **External-editor rewind disarm.** The Ctrl-G/Ctrl-X Ctrl-E replacement path now emits the same
   empty-to-nonempty draft-start notification used by typed input and prefill. The red sabotage observed a
   zero callback count and the contradictory `Esc clear` plus rewind hint in the first editor-result frame.
   The restored regression proves a nonempty external result disarms immediately, while an empty result
   does not; the next Escape follows local clear semantics rather than rewind.

### Fifth-pass verification

- `npm run typecheck`: **PASS**.
- Committed TUI suite: **39 files, 656 tests passed; 9 credential-gated live tests skipped**.
- Unit suite: **135 files, 1,227 tests passed**.
- Python frame suite: **25 tests passed** when run independently and again in a fresh depth-one clone.
  The clone contains neither `d6b2b6d849` nor `git show` fixture loading. A concurrent TUI/unit/Python
  invocation exposed the pre-existing 0.3-second live-child liveness test to scheduler contention; its
  standalone rerun passed without code changes, so it is not represented as a product failure.
- F0 acceptance 1–8 remains covered by the complete TUI/unit suites; the scorecard check still reports no
  `Claude Code Src` reference, the 2.1.220 bundle reference, and the corrected ~63% headline.
- Fresh 100x40 self-captures remain `0 clean, 0 allowlisted, 3 DIVERGENT` for help and `0 clean, 0
  allowlisted, 5 DIVERGENT` for composer, both expected diff exit code 1. No tracked fixture was rewritten.

## Sixth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview6-findings.md`.

1. **Critical — durable editor state across temporary composer removal.** The initial red regression proved
   that a current rescue draft disappeared as soon as the composer was unmounted for an overlay.
   `ChatApp` now owns an instance-scoped `MutableRefObject<EditorState>` and the consumed-prefill token.
   `ChatComposer` initializes from that object and synchronously writes every editor transition: typing,
   replacement/prefill, external edit, clear, history/completion transitions, kill/yank, and submit reset.
   It clears transient mention/command popup state only when remounting, so a stale autocomplete popup cannot
   appear behind a later overlay. The real ChatApp matrix retains an edited rescue through pager, history, and
   permission-decision remounts; the structurally identical settings-overlay harness covers that conditional
   replacement; kill/yank survives; and a submitted draft stays empty. A deliberate local-token sabotage
   red-proof re-applied `old rewind` and lost the user’s `revised` suffix after remount; the app-scoped token
   keeps the current draft instead. The state is per `ChatApp` invocation, not module-global.
2. **Important — insert-mode wide glyphs.** The red `CSI 4 h` test inserted `Z` before `界` and observed the
   shifted glyph erased by the overwrite prepass. `DimScreen.draw()` now performs leading/trailing wide-pair
   clearing only outside pyte insert-replace mode. Narrow-before-wide, dim/plain, lead/continuation-destination,
   and row-edge cases preserve both visible text and the glyph’s dim attribute; existing ordinary overwrite
   lead/stub regressions remain covered.

### Sixth-pass verification

- `npm run typecheck`: **PASS**.
- Committed TUI suite excluding the protected concurrent probe: **39 files, 659 tests passed; 9
  credential-gated live tests skipped**.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests passed**.
- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 27 tests
  passed**.
- `git diff --check`: **PASS**.
- Keyed PTY acceptance retained the exact queue-rescue contract: the final composer contained `one`, `two`,
  `three` in order and no queued rows. The keyless PTY runs showed Esc clear then history restore, and the
  first Ctrl-D hint followed by the driver’s second Ctrl-D exit. No credential value was printed.
- The scorecard and F0 plan now describe the evidence-backed temporary-remount guarantee rather than claiming
  a deliberately retained destroyed-text path or universal no-loss behavior.

### Sixth-pass frame baseline

Fresh 100x40 captures at `/tmp/frame-scratch` wrote all expected frames and left tracked fixtures untouched:

- Help overlay: **3 frames; `0 clean, 0 allowlisted, 3 DIVERGENT`; expected diff exit 1**.
- Composer basics: **5 frames; `0 clean, 0 allowlisted, 5 DIVERGENT`; expected diff exit 1**.

The expected divergence remains the known layout/chrome fidelity gap, not a capture or diff false success.
The only outstanding manual concern is still the owner-run terminal `Ctrl-Z` → `fg` round trip; injected
suspend tests cover raw-mode and signal ordering, but an automated pty cannot safely execute `fg`.

## Seventh plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview7-findings.md`.

1. **Important — chunk-invariant bottom-row autowrap.** The red `4×2` reproduction fed `1234界ab`
   and `Z` as separate stream chunks. The old speculative prepass cleared the bottom row’s `界` before pyte
   scrolled it, producing `  ab` where the one-chunk stream correctly produced `界ab`. `DimScreen.draw()` now
   repairs one printable character at a time immediately before pyte writes it: DECAWM pending-wrap above the
   bottom margin targets next-row column zero; bottom-margin wrap performs no preclear because pyte scrolls to
   a blank destination; DECAWM-off backs up by incoming width. The regressions compare every byte split against
   the one-chunk rendered frame, preserve dim/plain attributes, retain non-bottom destination repair, and cover
   no-autowrap right-edge overwrite. Insert-mode and prior ordinary lead/stub overwrite coverage remain green.
2. **Important — canonical tracked-fixture containment and staging.** Red proofs showed that symlink-root,
   symlink-ancestor, and case aliases bypassed the redaction gate and wrote raw identity; a tracked symlink
   with a nonexistent `new/scenario` tail then failed before the child because staging used the lexical parent.
   Detection now resolves with `Path.resolve(strict=False)`, uses root-safe `Path.parts` and `relative_to`,
   recognizes exact native-normalized marker components (including a wholly nonexistent marker path), and uses
   `samefile` only for existing case aliases. Resolution failures return exit 2 before a child starts. A
   tracked root produces the bare frame key without a leading slash. Staging now uses the nearest existing
   canonical ancestor, retains atomic promotion after complete redaction coverage, and leaves physical symlink
   escapes and nearby lookalikes untracked. Tests prove direct, `..`, symlinked-root/ancestor, case-gated,
   nonexistent-tail, escape, lookalike, no-spawn/no-write, and redacted missing-tail behavior.

### Seventh-pass verification

- Focused TDD: both frame-boundary reproducers failed before correction and pass afterward.
- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 33 tests
  passed**.
- `npm run typecheck`: **PASS**.
- Committed TUI suite excluding the protected concurrent probe: **PASS; 39 files, 659 tests passed; 9
  credential-gated live tests skipped**.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests passed**.
- Fresh 100x40 captures wrote 3 help and 5 composer frames without changing tracked fixtures. The expected
  baselines remain help **`0 clean, 0 allowlisted, 3 DIVERGENT`** and composer **`0 clean, 0 allowlisted,
  5 DIVERGENT`**, with exit code 1 from each diff.
- No credentials or raw tracked identity were printed or committed. The protected concurrent untracked files
  remain untouched. The existing manual `Ctrl-Z` → `fg` concern is unchanged.

## Eighth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview8-findings.md`.

1. **Important — Ctrl-Z composer fan-out.** Ink broadcasts the raw Ctrl-Z to both the root and composer
   listeners. The red proof constructed a real kill ring and yank-pop site, then showed that Ctrl-Z changed
   only `yankSite` to `null`; Alt-Y could no longer cycle from `two` back to `one`. A second red proof showed
   the same raw key disarmed a visible local Esc-clear arm. `ChatComposer` now returns on Ctrl-Z before input
   ownership, arm cleanup, chord handling, callbacks, or `applyKey`, leaving root `ChatApp` as the sole
   process-suspend owner. The durable `EditorState` comparison proves draft, cursor, history/stash, undo,
   popup, kill-ring, kill-run, and yank metadata remain exact; the integration test proves a one-call injected
   no-op suspend (the Windows contract) and a still-working Alt-Y afterward. Deliberately removing the guard
   made the metadata regression fail again, proving the test is not inert.

### Eighth-pass verification

- Focused TDD: exact state/yank-pop and local clear-arm tests were red before the guard, green after it, and
  the guard-removal sabotage restored the red yank-site failure.
- `npm run typecheck`: **PASS**.
- Committed TUI suite excluding the protected concurrent probe: **PASS; 39 files, 662 tests passed; 9
  credential-gated live tests skipped**.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests passed**.
- The first chained unit/Python invocation saw two existing PTY liveness failures (`pty closed before frame`)
  after the unit suite. Each failed case passed five isolated repetitions, and the full Python suite rerun
  alone passed: **33 tests passed**. No unrelated frame timing change was made.
- F0 acceptance remains covered by the full TUI/unit suites. A fresh keyless PTY Ctrl-D run displayed `Press
  Ctrl-D again to exit` before the driver’s second Ctrl-D exited. Ctrl-Z process precedence, one suspend call,
  no editor mutation, and the Windows-style no-op path are covered by injected TUI tests; the manual terminal
  `Ctrl-Z` → `fg` round trip remains the unchanged owner-run concern.
- No credential value was printed. Protected concurrent untracked files remain untouched.
