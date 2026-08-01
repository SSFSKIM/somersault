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

## Ninth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview9-findings.md`.

1. **Important — nested scenario scope was lost by diff.** The red reproduction placed a golden under
   `test/fixtures/upstream-frames/new/scenario` and scoped a comparison mask to
   `new/scenario/01-frame.ansi`. The old diff derived only `scenario/01-frame.ansi`, skipped the mask,
   reported a false divergence, and printed both synthetic identities. `frame_masks.py` now owns the sole
   `canonical_path`, tracked-fixture containment, and `frame_key` implementation; both capture and diff call
   it. Tracked keys preserve every canonical scenario component; root and one-level keys stay unchanged;
   symlink and `..` aliases use the same canonical target. Untracked directories use their canonical basename
   plus frame name (for example, `scratch/01-frame.ansi`), a deterministic documented convention. The new
   integration test proves direct, nested/`..`, one-level, symlink-root, scratch-symlink, and untracked keys,
   then runs the actual diff and confirms the scoped mask produces `1 clean, 0 allowlisted, 0 DIVERGENT`
   without printing either identity.
2. **Important — successful recapture retained obsolete ANSI frames.** The red reproduction started with
   old and extra `.ansi` files, captured one renamed frame, and showed that both stale files survived.
   Capture now creates a private `.capture-*` staging directory for every target, including untracked output.
   Only after all frames and redaction coverage validate does it promote each staged frame and remove immediate
   target-directory `.ansi` names absent from the validated set. Non-ANSI metadata is untouched. Failure or
   partial capture removes staging and leaves the prior output name-for-name and byte-for-byte intact. Because
   retained metadata prevents a portable whole-directory swap, a process crash during the final promotion/deletion
   merge can leave stale frames; it cannot publish an unvalidated frame, and the next successful capture converges
   to the exact set. The regression covers successful and failed untracked output, nested tracked output,
   metadata preservation, redaction, stale-frame removal, and staging cleanup.

### Ninth-pass verification

- Focused TDD: both nested-scope and exact-publication reproducers were red before the implementation and green
  afterward.
- The canonical helper has exactly one definition in `scripts/frame_masks.py`; capture and diff import it.
- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 35 tests
  passed**. An earlier full run hit the known intermittent PTY liveness failure in
  `test_capture_writes_expected_frames_for_live_child`; five isolated repetitions and the final full-alone run
  passed, so no unrelated timing change was made.
- `npm run typecheck`: **PASS**.
- Committed TUI suite excluding the protected concurrent probe: **PASS; 39 files, 662 tests passed; 9
  credential-gated live tests skipped**.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests passed**.
- `git diff --check`: **PASS**.
- Fresh 100x40 captures wrote three help and five composer frames without touching tracked fixtures. Baselines
  remain help **`0 clean, 0 allowlisted, 3 DIVERGENT`** and composer **`0 clean, 0 allowlisted, 5 DIVERGENT`**;
  each diff exited 1 as expected.
- No credentials were used or printed, no raw synthetic identity reached the scoped-mask diff output, no push
  occurred, and protected concurrent untracked files remain untouched.

## Tenth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview10-findings.md`.

### Red proof and repair

- The new width-two overwrite matrix was red before the implementation. `-k 'wide_overwrite'` ran 3 tests and all 3 failed because the second covered cell retained an empty continuation; the non-bottom autowrap case ran 1 test and failed for the same reason. The no-autowrap right-edge preservation case passed under the old implementation, confirming its existing first-cell repair.
- `DimScreen.draw()` now calculates pyte's actual pre-draw destination, including non-bottom DECAWM wrapping and DECAWM-off right-edge back-up, and clears every in-bounds cell occupied by the incoming glyph before calling pyte. Insert mode remains untouched, and bottom-margin wrapping still skips preclear because pyte scrolls to a blank row.
- The focused `-k 'wide'` group passed **11 tests** after the repair. Sabotaging the span loop to clear only its first cell made all 3 overwrite tests fail again; restoring the full-span loop returned the same 11 focused tests to green.

### Tenth-pass gates

- `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 40 tests**.
- `npm run typecheck`: **PASS; no diagnostics**.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`: **PASS; 39 files and 662 tests passed; 9 credential-gated tests skipped**.
- `npm run test:unit`: **PASS; 135 files and 1,227 tests passed**.
- Fresh keyless 100x40 local captures wrote **3 help** and **5 composer** frames. The documented diffs remain help **`0 clean, 0 allowlisted, 3 DIVERGENT`** and composer **`0 clean, 0 allowlisted, 5 DIVERGENT`**, each with expected exit code **1**.
- `git diff --check`: **PASS** before commit.

No credentials or `.env` were loaded or printed. The protected concurrent untracked files were not edited or staged. The pre-existing manual `Ctrl-Z` → `fg` concern remains unrelated to this frame-emulator repair.

## Eleventh plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview11-findings.md`.

### Red proof and repair

- A direct focused red run against the pre-repair code showed the three findings: no emitted/checked pair fingerprint, malformed or missing digest fields accepted as key-only records, no pinned requirements file, and surviving successful synthetic fixtures using `time.sleep(0.3)`.
- `frame-diff.py` now hashes a deterministic JSON representation of the *post-mask* golden/ours line pair and requires one exact `sha256:<64-lowercase-hex>` fingerprint per frame key. It rejects malformed and duplicate entries, makes stale fingerprints divergent, and rejects entries for clean, missing, or empty comparisons. Its divergent output prints the reviewer-copyable fingerprint.
- `scripts/frames/requirements.txt` pins exactly `pyte==0.8.2` and `wcwidth==0.8.2`; capture setup, import remediation, and golden-recapture instructions install that file.
- Successful synthetic children now use the shared five-second keepalive; deliberately early (`true`/empty) and partial (`0.15` seconds) child fixtures are unchanged.
- Sabotage proof: a temporary key-only variant returned exit 0 for an unrelated visible mutation while the restored implementation returned stale-fingerprint exit 1. Temporarily substituting `pyte>=0.8.2` and reintroducing `time.sleep(0.3)` each made their dedicated regression guards fail.

### Eleventh-pass gates

- Focused changed-behavior group: **PASS; 8 tests**. Full Python suite: **PASS; 44 tests in 7.536 seconds**.
- Fresh job-local virtual environment installed and verified **`pyte=0.8.2 wcwidth=0.8.2`** via `importlib.metadata`; its full suite passed **44 tests in 7.335 seconds**.
- Ten consecutive full-suite runs from that fresh pinned environment, while a local CPU-bound process supplied scheduler pressure: **all 10 PASS; 44 tests each**.
- `npm run typecheck`: **PASS; no diagnostics**.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`: **PASS; 39 files and 662 tests passed; 9 credential-gated tests skipped**.
- `npm run test:unit`: **PASS; 135 files and 1,227 tests passed**. `npm run test:integration`: **PASS; 3 files and 16 tests passed**. `npm run test:contract`: **PASS; 1 file and 7 tests passed**.
- Fresh keyless local 100x40 captures wrote **3 help** and **5 composer** frames. With the empty active allowlist, help remained **`0 clean, 0 allowlisted, 3 DIVERGENT`** and composer **`0 clean, 0 allowlisted, 5 DIVERGENT`**; both expectedly exited **1**.
- `git diff --check`: **PASS** before commit. No credentials were loaded, printed, or committed. The protected concurrent untracked files were not edited or staged.

## Eleventh review follow-up

An independent review completed after the eleventh-pass commit and identified four residual gaps. A focused three-test red run reproduced them: an unindented `.ans` plus `sha256:` record was ignored rather than rejected, the F0 plan still contained unpinned `pip install pyte` setup, and synthetic fixtures still used a generic child builder.

- The allowlist parser now treats unindented path-shaped rows containing either an inventory delimiter or `sha256:` as entries even if their extension is malformed. Indented Markdown templates remain explanatory prose. The malformed-record test uses equal frames, so the old parser would have exited 0; it now fails at allowlist validation.
- The F0 Task 9 plan now creates and installs `scripts/frames/requirements.txt`, names both exact emulator versions, and describes the post-mask fingerprint allowlist, including malformed/stale fail-closed behavior.
- Test fixtures now have explicit `live_child_command`, `partial_child_command`, and `dead_child_command` helpers. All 16 successful fixtures are structurally required to use the five-second helper; the two partial fixtures alone use the explicit 0.15-second helper.
- Follow-up gates: focused guards **PASS; 3 tests**; full Python suite **PASS; 44 tests in 7.368 seconds**; ten scheduler-pressure full-suite runs **all PASS; 44 tests each**. Typecheck, TUI, unit, integration, and contract suites again passed **662**, **1,227**, **16**, and **7** tests, respectively; 9 credential-gated TUI tests skipped.
- The corrected parser retained the expected keyless baseline: help **`0 clean, 0 allowlisted, 3 DIVERGENT`** and composer **`0 clean, 0 allowlisted, 5 DIVERGENT`**, both exit 1. No credentials were loaded or printed, and protected concurrent files remain unstaged.

## Twelfth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview12-findings.md`.

### TDD red proofs, corrections, and sabotage

1. **Composer-owned non-kill input now finalizes yank metadata.** A real `ChatComposer` with its durable `editorStateRef` was seeded through two actual Ctrl-U kills and Ctrl-Y. Against the old early-return routing, its first Escape case timed out waiting for `yankSite` to clear. `editor.ts` now exports the pure `endKillAndYank` transition, used both by `applyKey` and every composer-owned interception: EOF, help, Shift-Tab, Ctrl-X prefix, Ctrl-X Ctrl-K, Ctrl-G/Ctrl-X Ctrl-E (including cancellation), and all busy/text/empty Escape branches. The live component matrix proves each leaves the buffer unchanged, clears `killRun`/`yankSite`, makes Alt-Y a no-op, and calls the relevant callback once; Ctrl-Z retains an exact metadata clone and still Alt-Y cycles. The input-owner guard remains before this transition, so an inactive composer cannot mutate state. Sabotaging the one composer helper to return its unmodified state made the same matrix red at stale `yankSite`; restoring it returned green.
2. **Partial-DECSTBM pending-wrap now repairs pyte's clamped destination.** The `4×4` regression set rows 2–3 as the scroll region, put a dim wide glyph at row 3 columns 1–2, placed a wrap-pending cursor on row 4, and then drew narrow and width-two spans in dim/plain combinations. Before the correction, narrow cases produced `['Z', '', ' ', ' ']`, retaining the old continuation rather than the expected `['Z', ' ', ' ', ' ']`. `DimScreen.draw()` now maps `y < bottom` to the next row, `y == bottom` to no preclear because pyte scrolls to blank, and `y > bottom` to `(bottom, 0)` because pyte's `cursor_down()` clamps upward. The test also compares every byte split with the one-chunk render. Sabotaging only the `y > bottom` branch recreated the two stale-continuation failures; restoring it passed.
3. **Tracked fixture capture now requires an exact executable-version preflight.** A complete-redaction tracked capture without `--expected-version` previously exited zero and ran its marker-writing child. The script now parses `--expected-version` and, after redaction contract validation but before staging or `pty.fork`, runs the selected `--bin` executable with `--version` and compares its complete output exactly. The new boundary test proves missing, mismatched, failing, and PATH-switched versions stop with no capture-child marker, staging directory, or fixture write; correct synthetic and untracked captures remain usable. Existing synthetic tracked redaction-runtime tests now pass their interpreter's derived version so they exercise their intended post-child redaction failures. Sabotaging the version-error rejection recreated the missing-pin zero exit. The installed `claude --version` was exactly `2.1.220 (Claude Code)`, and `validate_tracked_child_version("claude", "2.1.220 (Claude Code)", harness_root)` accepted it. `VERSION` contains two exact 2.1.220 capture pins and Task 9 documents the same command; changing one recorded pin to 2.1.221 made the documentation guard fail (`1 != 2`).

No new implementation Surprise or Revision fact was required; the final spec retrospective remains with the controller.

### Twelfth-pass gates

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness` unless their absolute path says otherwise. No credential file was loaded or printed.

- Focused red/green: `npx vitest run test/tui/components.test.tsx -t 'ends pending yank-pop'` was red on the old composer and green after the correction. The DECSTBM and expected-version focused `unittest discover -k` commands were red on old code and green afterward. The exact documentation guard is green.
- `npm run typecheck`: **PASS**.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`: **PASS; 39 files, 663 tests passed, 9 credential-gated tests skipped**. The explicit exclude leaves `test/tui/tmp-probe-rescue-popup.test.tsx` out of the committed suite.
- `npm run test:unit`: **PASS; 135 files, 1,227 tests passed**.
- `npm run test:integration`: **PASS; 3 files, 16 tests passed**.
- `npm run test:contract`: **PASS; 1 file, 7 tests passed**.
- Fresh environment: `$CLAUDE_JOB_DIR/tmp/f0-pass12-python-venv` installed and verified **`pyte=0.8.2 wcwidth=0.8.2`** from `scripts/frames/requirements.txt`. Its standalone full Python run passed **46 tests in 8.789 seconds**.
- Ten consecutive full Python runs from that fresh environment: **10/10 PASS**, 46 tests each, in 9.269–9.924 seconds. An earlier attempt passed runs 1–8 and saw the pre-existing zero-wait live-child test flake on run 9 (`no rendered screen state before 'frame:boot'`). Ten isolated repetitions of that test then passed in 0.092–0.109 seconds, and the subsequent final ten-full-run gate passed without a product timing change.
- Fresh untracked 100×40 ccx captures under `$CLAUDE_JOB_DIR/tmp/f0-pass12-frames`: help overlay wrote **3** frames and composer basics wrote **5**. The frame diffs remain the known baselines: help **`0 clean, 0 allowlisted, 3 DIVERGENT`**, composer **`0 clean, 0 allowlisted, 5 DIVERGENT`**, each with expected exit status **1**.
- `claude --version` and the production preflight both accepted exactly **`2.1.220 (Claude Code)`**.

### Review-size process disposition

The aggregate F0 range remains larger than the 800-line guidance. This is an accepted process/planning deviation, not authorization for history surgery: F0 already landed as eleven task-scoped commits with per-task reviews and broader final rereviews to catch cross-task defects. This pass does not reset, rebase, split, reorder, or drop those commits, and the final retrospective is left to the controller.

The protected concurrent files and `CC-to-SDK/.doperpowers/sdd/progress.md` were not edited, staged, or used as test inputs. No push was performed.

### Independent pass-12 review

The Codex companion independently reviewed only the diff against `f160131f7c` and reported **no actionable correctness defects**. Its read-only sandbox passed typecheck and focused Python/editor checks; its own Vitest attempt was blocked only because Vite could not write a temporary config file in that sandbox. The direct working-tree TUI suite above passed independently, so there is no unresolved Critical or Important review finding.

## Thirteenth plugin review pass

Source of truth: `/Users/new/Developer/GitHub/codex_somersault/.doperpowers/sdd/2026-07-31-tui-clone-f0/final-rereview13-findings.md`.

### TDD red proofs, repairs, and sabotage

1. **Fresh child configuration.** The new success/failure subprocess repro was red when the old child scrub simply removed `CLAUDE_CONFIG_DIR`: the child could not record a private config and the capture still used the ambient configuration fallback. `clean_child_env()` now builds a child-only scrubbed environment, then `main()` creates a fresh empty config directory before `pty.fork`, assigns it after the scrub, and clears/replaces the forked child's environment for both upstream Claude and ccx. The guard records only booleans and paths, never a credential: it proves the config exists and is empty while the child runs, differs from the fake ambient config and fake `HOME/.claude`, cannot see the ambient plugin marker, preserves OAuth presence, excludes the API key that would shadow OAuth, removes nested markers, and is gone after both successful and failed capture. Removing the private-config assignment again made that guard red; restoration returned it green.
2. **Scenario-scoped allowlist staleness.** The red shared-allowlist repro allowlisted one reviewed difference in each of `help-overlay`, `composer-basics`, `nested`, and nested `nested/scenario`; the old global stale scan made each one-scenario comparison fail for the other entries, while its first prefix-only repair also misclassified `nested/scenario` as part of `nested`. `frame-diff.py` now derives the canonical compared scenario scope with `frame_key(args.golden_dir, "")` and compares the exact directory portion of every allowlist key, while parsing malformed entries globally before comparison. The regression verifies direct, `..`, and symlinked nested aliases; current-scenario stale, clean, and missing entries still fail. Removing the exact-scope guard reproduced the false stale errors.
3. **Process-group teardown and reaping.** The red PTY subprocess leaves a SIGHUP-ignoring long-lived descendant and reports only job-local PID markers. Killing only the PTY leader left that descendant alive. Cleanup now calls `killpg` only for the capture's distinct child group, reaps the leader, never signals the controller group, closes the PTY, and only then removes the private config. The successful, repeated, and partial-failure cases prove both leader and descendant disappear within bounded polling. Replacing `killpg` with leader-only `kill` made the descendant-survival guard red; the direct controller-group guard confirms no controller signal attempt.
4. **Bounded first-frame readiness.** The old 20 ms settle was red against a deterministic 80 ms delayed renderer. First frame capture now waits up to **500 ms** for visible content or child death, then uses a **50 ms post-content PTY drain** before publication; later frames retain zero-wait checks. The drain both rejects a shell that paints and exits before the snapshot and completes a paint split across writes (`r`, then `eady`). The same guard proves immediate death is prompt and a live blank child fails after the bound rather than hanging. Restoring the immediate-return branch made the split-paint guard red; removing the readiness bound made the delayed-renderer guard red.

`VERSION` and Task 9 now describe the settings-isolated reproduction and use `$CLAUDE_JOB_DIR/tmp` for the recapture virtual environment and scratch directory. They retain the exact 2.1.220 version pins. The Task 9 allowlist text now distinguishes global parse failure from scenario-scoped stale evaluation.

### Thirteenth-pass gates

All commands used `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness` unless otherwise stated. Temporary environments, markers, captures, and logs used `$CLAUDE_JOB_DIR/tmp`; no credential file was loaded or printed.

- Fresh pinned Python environment: `$CLAUDE_JOB_DIR/tmp/f0-pass13-python-venv` installed `pyte==0.8.2` and `wcwidth==0.8.2` from `scripts/frames/requirements.txt`.
- `TMPDIR="$CLAUDE_JOB_DIR/tmp" "$CLAUDE_JOB_DIR/tmp/f0-pass13-python-venv/bin/python3" -m unittest discover -s test/python -p 'test_*.py'`: **PASS; 52 tests in 16.750 seconds** after the review fixes.
- Ten full Python runs under a separate CPU-bound process: **10/10 PASS; 52 tests per run**. An earlier ten-run attempt reached eight passes before one escaped-symlink first-frame timeout; the exact case then passed 30/30 under the same CPU pressure from a clean process state, and the clean full-loop rerun passed all ten without a timing change.
- `npm run typecheck`: **PASS; no diagnostics**.
- `npx vitest run test/tui --exclude 'test/tui/tmp-probe-rescue-popup.test.tsx'`: **PASS; 39 files and 663 tests passed; 9 credential-gated tests skipped**.
- `npm run test:unit`: **PASS; 135 files and 1,227 tests passed**.
- `npm run test:integration`: **PASS; 3 files and 16 tests passed**.
- `npm run test:contract`: **PASS; 1 file and 7 tests passed**.
- `git diff --check`: **PASS; no whitespace errors**.

### Fresh isolated capture and baseline

A fresh job-local invocation checked the installed binary against exact `2.1.220 (Claude Code)` and captured upstream Claude under its empty per-capture config. It wrote **3 help-overlay frames** and **5 composer-basics frames**. A same-geometry ccx run wrote the same 3/5 frame counts. The committed-fixture comparisons remain the expected F0 baseline:

- Help overlay: `0 clean, 0 allowlisted, 3 DIVERGENT`; exit status `1`.
- Composer basics: `0 clean, 0 allowlisted, 5 DIVERGENT`; exit status `1`.

These are known visual-fidelity divergences, not a capture/diff false success. No real configuration directory was read or written by the captured children, and the descendant teardown repro left no helper process alive.

### Process disposition

The aggregate F0 range remains above the 800-line guidance. This is the previously accepted process/planning deviation: the work remains split across task-scoped commits and successive focused reviews. This pass does not rewrite history; it adds only the pass-13 frame-harness corrections and records the deviation honestly. The protected concurrent files, including `CC-to-SDK/.doperpowers/sdd/progress.md` and `CC-to-SDK/harness/test/tui/tmp-probe-rescue-popup.test.tsx`, were not edited, staged, or used as test inputs. No push was performed.

### Independent review disposition

A read-only independent review found two Important defects: an emitting-but-exited first-frame child could publish a frame, and `ANTHROPIC_API_KEY` could shadow the intended OAuth credential. Both received dedicated red-to-green regressions. The authenticated-child report now records booleans only and proves OAuth present/API key absent; the immediate-exit shell child now fails without a published frame.

The first Codex base-diff review found the independently verified nested parent/child allowlist defect and the split-paint readiness defect. The exact-directory scope test and the `r`/`eady` split-paint test were added; the latter was sabotage-proven by replacing the drain with the former immediate return and observing an `r`-only frame. Its suggestion to fall back from an unavailable `$CLAUDE_JOB_DIR/tmp` to a default temporary directory was not adopted: that would contradict the binding requirement that executed capture/test temporary paths remain job-local. The capture already reports a clear setup error before spawning a child when a requested private config cannot be created.

A fresh final independent base-diff review is pending this completed correction set; every verified Critical or Important finding from the prior reviews has been fixed.

## Fourteenth plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass13-scoped-findings.md`.

### Red proofs, repairs, and sabotage

1. **Fail-closed tracked identity redaction.** The stock private-config frames remain permitted to have zero identity substitutions because an isolated logged-out child is valid. Each stock redaction contract now additionally supplies narrow dashboard identity guards, evaluated after redaction. A residual greeting, organization email, or `user@host` dashboard identity therefore rejects the staged capture before it can publish, while absent identities remain valid. The new real capture regression writes the reviewer’s altered greeting layout (`Welcome back Test Identity!` without the narrow rule’s expected layout) and was red before the guard: capture exited zero and wrote a tracked ANSI frame. It is green after the guard, with no frame published and no identity echoed in diagnostics. The established fixture round-trip, identity-free isolated capture, and custom-required-rule tests remain green.

   Sabotage proof: removing the two `identity_guards` arrays made that same regression fail again because capture returned zero and staged one frame. Restoring the masks byte-for-byte made the focused regression pass.

2. **Stable visible baseline cwd.** Recapture documentation now uses the deterministic visible `/tmp/frame-scratch` cwd while keeping the temporary virtual environment job-local. The exact capture usage in `capture-frames.py`, `VERSION`, and Task 9 was updated. All eight upstream 2.1.220 fixtures required regeneration because every one rendered the former job-scoped cwd. Each was recaptured at 100×40 through the exact-version and write-time redaction gate; semantic comparison masks were not broadened. A separately captured stable-cwd run compared cleanly: help overlay **3 clean, 0 allowlisted, 0 DIVERGENT** and composer basics **5 clean, 0 allowlisted, 0 DIVERGENT**. The committed set contains eight stable-cwd frames and zero `/.claude/jobs/` paths.

3. **Hermetic private-config test.** The private-config subprocess test now creates `root / "job"` and passes that path as its child `CLAUDE_JOB_DIR`, then asserts the private config is created under that test-local directory. Before the repair, running the test with `env -u CLAUDE_JOB_DIR` raised `KeyError` on the direct ambient lookup. The focused test and the full suite now pass both with and without the ambient variable.

### Verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`; no credential file was loaded or printed.

- Focused reviewer-bypass red: `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'private_config_masks_reject_reviewed_greeting_layout_bypass_before_publication'` — expected **FAIL**, one test; old behavior returned zero and wrote a frame.
- Focused no-job-dir red: `env -u CLAUDE_JOB_DIR scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'capture_seeds_a_private_claude_config_without_ambient_auth_or_config'` — expected **ERROR**, one test; `KeyError: 'CLAUDE_JOB_DIR'`.
- Focused green: the reviewer-bypass and no-job-dir commands above each passed **1 test** after the repair. Stock fixture redaction, identity-free isolated capture, and custom required-rule checks each passed **1 test**.
- Sabotage: deleting `identity_guards` from a temporary working copy of `masks.json` made the bypass regression fail **1 test**; the original mask file was restored byte-for-byte and the same regression passed **1 test**.
- Fresh pinned environment: a new job-local `venv` installed `pyte==0.8.2` and `wcwidth==0.8.2` from `scripts/frames/requirements.txt`. `TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'` passed **54 tests in 17.612 seconds**. `env -u CLAUDE_JOB_DIR TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'` passed **54 tests in 17.301 seconds**.
- Stability: ten complete 54-test runs from that fresh pinned environment passed under one low-priority CPU-bound process: **10/10 PASS**, with individual durations from **16.052 to 17.266 seconds**.
- Fresh upstream recapture: exact `claude --version` was `2.1.220 (Claude Code)`. The tracked commands used `--cwd /tmp/frame-scratch --redact-masks scripts/frames/masks.json --expected-version '2.1.220 (Claude Code)'` and wrote **3 help-overlay** plus **5 composer-basics** frames. An independently recaptured untracked copy compared as **3/3 clean** and **5/5 clean** using the unchanged masks.

No production TypeScript changed, so a TypeScript typecheck was not applicable. The pre-existing manual terminal `Ctrl-Z` → `fg` acceptance concern is unchanged and unrelated. The protected concurrent untracked files were not edited, staged, removed, or used as test inputs; no commit or push was performed.

## Fifteenth plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass14-scoped-findings.md`.

### Red proofs, repairs, and sabotage

1. **Critical — ANSI-split identity leakage at the tracked-frame publication boundary.** The new real PTY regression emits a greeting, organization email, and `user@host` with valid SGR transitions inside each identity. Before the repair, its tracked capture returned zero and staged one frame. `redact_text()` now creates an SGR-normalized inspection view only for the narrow residual `identity_guards`; configured substitutions and the stored ANSI-bearing frame string are otherwise unchanged. The restored test rejects the batch before promotion, reports only guard names, and publishes no identity-bearing frame. The existing semantic transcript matrix remains green, so arbitrary transcript emails, paths, and other text are not broadly redacted or comparison-masked.

   Sabotage proof: temporarily replacing the SGR-normalized inspection view with the original ANSI-bearing string made `test_private_config_masks_reject_sgr_split_identities_before_publication` fail again (exit 1, as expected) because the capture returned success. The exact source bytes were restored and the same test passed.

2. **Important — isolated private-config leak on seed write failure.** The new deterministic in-process regression forces `.claude.json` `write_text()` to raise after `mkdtemp()`. Before the repair, it left one `.claude-config-*` directory behind, although the patched `pty.fork` correctly proved no child started. `config_dir` is now retained as an owned nullable resource during seed construction and removed immediately on every seed setup error; the child-start failure and runtime teardown paths retain the required child-group termination, reap, close, then config-removal order. The pre-finally terminal-initialization failure now follows that same order.

   Sabotage proof: temporarily disabling the seed-error `rmtree` made `test_capture_removes_private_config_when_seed_write_fails_before_spawning` fail again (exit 1, as expected) with the orphaned directory assertion. The exact source bytes were restored and the test passed.

`VERSION` and Task 9 now state the SGR-normalized residual-guard boundary, preserved stored ANSI, immediate pre-spawn cleanup, and ordered post-child cleanup. Their documentation regression is green.

### Fifteenth-pass verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`; no credential file was loaded, printed, or committed.

- Focused red proofs, before repair:
  - `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'sgr_split_identities'` — expected **FAIL**, 1 test: capture returned zero and wrote one frame.
  - `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'seed_write_fails_before_spawning'` — expected **FAIL**, 1 test: the created `.claude-config-*` directory remained and `pty.fork` was not called.
- Focused green: the SGR-split and seed-cleanup regressions each passed **1 test**. The `*private_config_masks*` cluster passed **3 tests**, the semantic transcript-preservation matrix passed **1 test**, and the documentation plus synthetic-child-inventory guards each passed **1 test**.
- A new job-local Python environment installed and verified `pyte==0.8.2` and `wcwidth==0.8.2` from `scripts/frames/requirements.txt`.
  - `TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'` — **PASS; 56 tests in 17.976 seconds**.
  - `env -u CLAUDE_JOB_DIR TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'` — **PASS; 56 tests in 17.616 seconds**.
  - Ten successive full-suite runs from that fresh pinned environment all passed **56 tests**; durations were 17–19 seconds.
- Independent stable-cwd upstream capture used `--cwd "/tmp/frame-scratch"`, the private per-capture config, exact `2.1.220 (Claude Code)` preflight, and unchanged masks. It wrote **3 help-overlay** and **5 composer-basics** frames. Its comparisons against the tracked fixtures were **3 clean, 0 allowlisted, 0 DIVERGENT** and **5 clean, 0 allowlisted, 0 DIVERGENT**, respectively.
- `git diff --check` passed after the source/documents and is rerun after this report append. No production TypeScript changed, so typecheck is not applicable.

### Residual concerns

There is no residual privacy or cleanup concern from these two fixes. The pre-existing manual terminal `Ctrl-Z` → `fg` acceptance concern remains unrelated. The protected concurrent untracked files were not edited, staged, removed, or used as test inputs; no commit or push was performed.

## Sixteenth plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass15-scoped-findings.md`.

### Root cause, red proofs, repairs, and sabotage

1. **P1 — row-wrapped dashboard identities.** `redact_text()` correctly removes valid SGR transitions for
   residual-guard inspection, but the pre-pass-16 organization and status patterns still required each
   identity and delimiter to occupy one physical rendered row. A 60-column real PTY regression first masks a
   same-row dashboard greeting, then splits an organization email exactly at its top-level-domain boundary and
   a row-start status host exactly at its host boundary. Before the correction, the tracked capture returned
   zero and wrote one frame. The two scenario-scoped residual patterns now consume only contiguous rendered-row
   breaks within their existing narrow dashboard contexts: the organization row's `│ /release-notes` chrome
   for organization email and a row-start two-space status segment ending in `:/` for status identities. They remain
   inspection-only; primary write-time substitutions, stored SGR sequences, layout, and comparison masks are
   unchanged. A separate 60-column greeting regression retains coverage for greeting row wrapping. A
   transcript-scope regression then demonstrated that the same Organization wording without dashboard chrome
   must publish and remain visible; it was red under the interim suffix-only guard and green after the chrome
   constraint was restored.

2. **P2 — exact `git@` exemption.** The former status residual guard used `(?<!git@)`, allowing regex search
   to restart at a suffix inside a legitimate `git@host:/path` token. The replacement anchors the candidate at
   the dashboard row prefix and applies `(?!git@)` at the actual token start, so an exempt token stays visible
   while a real row-wrapped `user@host:/` remains a publication failure. The real tracked-capture regression
   was red before the repair: it rejected the exempt status token with `unredacted identity status-user-host`.

3. **Red and sabotage evidence.** Before editing production config:
   - `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k dashboard_identities_wrapped_across_rendered_rows`
     failed one test because capture returned zero and wrote one tracked frame.
   - `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k dashboard_git_status_token`
     failed one test because the residual guard rejected `git@`.
   - The row-wrap sabotage temporarily restored both organization/status single-row residual patterns in a
     temporary copy of `masks.json`; the first command failed again at the false-success assertion. The exact
     file bytes were restored through a shell exit trap.
   - The exemption sabotage temporarily restored only the legacy status lookbehind; the second command failed
     again with the false rejection. The exact file bytes were restored through its exit trap.
   - After restoration, `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k private_config_masks`
     passed **7 tests**. The child keepalive inventory guard passed **1 test** and now correctly counts **26**
     five-second successful child fixtures, including the four new capture regressions.

4. **Documentation.** The `VERSION` and Task 9 documentation regression was written red first and failed on
   the absent `row-wrapped` contract. Both files now state that the SGR-normalized row-wrap inspection is
   dashboard-only and does not alter stored ANSI. The focused documentation guard then passed **1 test**.

### Pass-16 verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`; no credential file,
real settings, or API token was loaded or printed.

- A fresh job-local virtual environment installed and verified `pyte==0.8.2` and `wcwidth==0.8.2` from
  `scripts/frames/requirements.txt`.
  - `TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`
    — **PASS; 60 tests in 19.143 seconds**.
  - `env -u CLAUDE_JOB_DIR TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`
    — **PASS; 60 tests in 17.826 seconds**.
- Ten complete 60-test runs in that fresh pinned environment passed under a low-priority CPU-bound process:
  **10/10 PASS**, with durations from **17.008 to 18.171 seconds**.
- Frame rendering and tracked `.ansi` fixture content did not change in this fix; only staged publication
  guards, tests, and contract documentation changed. The conditional independent stable-cwd recapture/diff
  gate was therefore not applicable.
- `git diff --check` is rerun after this report append. No production TypeScript changed, so a TypeScript
  typecheck is not applicable.

### Residual concerns

There is no residual privacy, row-wrap, or `git@` boundary concern from this pass. The pre-existing manual
terminal `Ctrl-Z` → `fg` acceptance remains unrelated. Protected concurrent untracked files were not edited,
staged, removed, or used as test inputs; no commit or push was performed.

## Seventeenth plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass16-scoped-findings.md`.

### Root cause, red proofs, repairs, and sabotage

1. **P1 — current authenticated dim organization styling.** The fixture renderer emits the live 2.1.220
   dim-italic `/release-notes` run as `0;2;3;…m`, while the primary write-time organization rule accepted only
   historic `0;3;…m`. A synthetic identity-bearing frame therefore missed its primary substitution and reached
   the residual guard. The primary rule now accepts only the exact optional dim parameter before its existing
   italic layout anchor. Its new round-trip asserts the complete SGR-wrapped raw frame redacts byte-for-byte to
   the expected sanitized frame; a bold+dim+italic `0;1;2;3;…m` boundary remains unsupported and is rejected
   before publication by the unchanged fail-closed residual guard.
2. **P2 — transcript-safe status scope.** The old primary status rule substituted an ANSI-styled indented
   `alice@host:/repo` transcript row, while its residual guard rejected the plain equivalent solely from
   indentation. Both rules now require the actual 2.1.220 status/footer continuation `⏸ manual mode on · ? for
   shortcuts · ← for agents` after the status path, allowing at most two physical wrap rows. Plain and
   ANSI-styled transcript paths, including `git@host:/repo`, remain visible and publishable; a dashboard path
   immediately followed by that chrome redacts, and a real ANSI row-wrapped dashboard path rejects before
   publication when primary matching cannot span its rendered rows.
3. **Focused red/green and sabotage.** Before the production config correction,
   `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k
   dim_dashboard_organization_round_trip` failed **1 test** by retaining the synthetic organization identity;
   `-k status_identity_scope_requires_dashboard_footer_chrome` failed **1 test** (the plain transcript was
   rejected and the ANSI-styled transcript was substituted). Both passed **1 test** after correction. A
   byte-restored temporary removal of `(?:2;)?` made the dim test fail again; a byte-restored temporary
   corruption of the footer anchor made the status-scope test fail again. Each restored test passed **1 test**.
4. **Contract documentation.** `VERSION` and Task 9 now state the exact `0;3;…m`/`0;2;3;…m` organization
   forms, the bounded current-footer status anchor, and transcript/code preservation. The documentation guard
   was red when those terms were absent and passed **1 test** after both documents were updated. The synthetic
   child inventory guard was updated from 26 to **28** successful child fixtures for the two new PTY cases and
   passed **1 test**.

### Pass-17 verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`; no credential file,
real settings, API key, or OAuth token was loaded or printed.

- A fresh environment at `/tmp/f0-pass17.F9sCJ7/python-venv` installed from
  `scripts/frames/requirements.txt` and verified `pyte=0.8.2` and `wcwidth=0.8.2`.
  - `CLAUDE_JOB_DIR=/tmp/f0-pass17.F9sCJ7 TMPDIR=/tmp/f0-pass17.F9sCJ7/tmp
    /tmp/f0-pass17.F9sCJ7/python-venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`:
    **PASS; 62 tests in 18.806 seconds**.
  - `env -u CLAUDE_JOB_DIR TMPDIR=/tmp/f0-pass17.F9sCJ7/tmp
    /tmp/f0-pass17.F9sCJ7/python-venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`:
    **PASS; 62 tests in 19.355 seconds**.
- Ten complete 62-test repetitions from that fresh pinned environment, with ANSI-normalized completion
  verification, passed **10/10** in **19.060–21.469 seconds**. An earlier runner attempt stopped after one
  otherwise-green suite only because it tested raw colorized output for a literal final `OK`; a direct
  diagnostic confirmed return code 0, `Ran 62 tests`, and normalized `OK` before the final 10/10 loop.
- Pass-17 did not alter a tracked `.ansi` fixture. The current dirty diff retains eight earlier,
  independently stable-cwd-verified fixture updates from pass 14, so no new conditional comparison was
  triggered by this scoped fix. No production TypeScript changed, so typecheck was not applicable.
  `git diff --check` passed after the initial report append and is re-run after this final report correction.

### Residual concerns

There is no residual organization-redaction or transcript-scope concern from this pass. The existing manual
terminal `Ctrl-Z` → `fg` acceptance remains unrelated. Protected concurrent untracked files were not edited,
staged, removed, or used as test inputs; no commit or push was performed.

## Eighteenth plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass17-scoped-findings.md`.

### Root cause, red proofs, repairs, and sabotage

1. **P1 — authenticated reduced-footer and `git` status identities.** The two scoped status substitutions and
   the SGR-normalized residual guards treated the whole `⏸ manual mode on · ? for shortcuts · ← for agents`
   string as their context and exempted a literal `git@` token. The eight 2.1.220 fixtures prove that boot,
   cleared, killed, and closed use that extended form, typed, Esc-armed, and yanked reduce it to
   `⏸ manual mode on`, and help-open has no status marker. A fixture-backed variant matrix covers all eight
   state names plus `alice` and real-user `git` dashboard identities, reduced and extended marker forms,
   ANSI-split identities, row wrapping, and plain/ANSI/code transcript tokens. Before repair it produced
   **11 failures**: reduced dashboard statuses and every dashboard `git` status could publish unchanged.
   Both primary substitutions and residual guards now require only the shared indented `⏸ manual mode on`
   dashboard marker after the bounded status path; there is no username exception. The matrix is green:
   ordinary dashboard values redact, style- or row-wrap forms the primary rule cannot replace fail closed
   before publication, and all chrome-free transcript/code values, including `git@host:/repo`, remain exact.

   Sabotage proof: byte-restored temporary insertion of the old `git@` exemption into both primary rules
   and both residual guards made the matrix fail **8** authenticated-`git` cases (exit 1, first case
   `help-overlay/01-boot.ansi`). Restoring `masks.json` byte-for-byte made the matrix pass again.

2. **P2 — later split repaint publication.** Once a meaningful screen existed, `frame:` set `settle` to zero,
   so `pump(0)` could make one immediate read and render a repaint halfway through. The new deterministic
   PTY regression establishes a `baseline` first frame, then uses a scripted Enter to cause a later repaint
   whose `partial` and `-complete` writes are separated by 15 ms. Before repair, it published the later
   `partial` frame and failed its complete-frame assertion. Established screens now call the existing
   PTY/child-liveness `pump()` path with `SNAPSHOT_DRAIN_SECONDS = 0.02`; first-frame readiness remains
   0.5 s and its closing-PTY drain remains 50 ms. The later frame now contains `partial-complete`.

   Sabotage proof: byte-restored temporary replacement of the later-frame settle value with zero made the
   regression fail **1** test (exit 1) with the published partial-frame assertion. Restoring
   `capture-frames.py` byte-for-byte made the same test pass. The duration is statically bounded to one
   requested **20 ms** drain per already-rendered requested snapshot; no large fixed sleep was added and the
   existing immediate-dead, blank-child, first-frame split, and process-group liveness regressions remain in
   the full suite. A host-level process-wall-time microbenchmark varied under scheduler load, so the exact
   source-level 20 ms bound—not that noisy wall-clock sample—is the performance claim.

3. **Documentation and inventory.** `VERSION` and Task 9 now describe the marker-based dashboard boundary,
   the absence of a `git` exception, transcript/code preservation when dashboard chrome is absent, and the
   20 ms snapshot drain. The documentation guard pins those terms and `SNAPSHOT_DRAIN_SECONDS == 0.02`.
   The successful synthetic-child inventory is now **29** five-second fixtures and remains green.

### Pass-18 verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`; no credential file,
real settings, API key, or OAuth token was loaded or printed.

- Focused red proofs before production repair:
  - `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'dashboard_status_variant_matrix'` — expected **FAIL**, 1 test with **11** variant failures.
  - `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'later_frame_drains_a_split_repaint_before_publication'` — expected **FAIL**, 1 test; the published later frame contained `partial` but not `partial-complete`.
- Focused green: the dashboard matrix, later-frame split repaint, documentation contract, and synthetic-child
  inventory each passed **1 test**. The `private_config_masks` cluster passed **7 tests**.
- Sabotage: reintroducing the old `git@` exemption into a temporary byte-restored working copy made the
  matrix fail **8** authenticated-`git` variants; changing only later `settle` to zero made the split-repaint
  regression fail **1** test. Both real files were restored byte-for-byte before their green reruns.
- A new job-local virtual environment installed `pyte==0.8.2` and `wcwidth==0.8.2` from
  `scripts/frames/requirements.txt`:
  - `TMPDIR="$CLAUDE_JOB_DIR/tmp/f0-pass18-python/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'` — **PASS; 64 tests in 22.667 seconds**.
  - `env -u CLAUDE_JOB_DIR TMPDIR="$CLAUDE_JOB_DIR/tmp/f0-pass18-python/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'` — **PASS; 64 tests in 22.460 seconds**.
- Ten complete 64-test runs from that fresh pinned environment passed with one low-priority CPU-bound process:
  **10/10 PASS**, with durations **20.231–21.318 seconds**. Each iteration also required return code zero,
  `Ran 64 tests`, and ANSI-normalized `OK`.
- This correction did not alter a tracked `.ansi` fixture byte; the conditional independent stable-cwd upstream
  capture/comparison was therefore not rerun. No production TypeScript changed, so a TypeScript typecheck is
  not applicable. `git diff --check` is rerun after this report append.

### Residual concerns

There is no remaining known redaction bypass or later split-repaint publication path in the exercised
2.1.220 fixture and synthetic matrix. The unrelated manual terminal `Ctrl-Z` → `fg` acceptance concern
remains. Protected concurrent untracked files were not edited, staged, removed, or used as test inputs; no
commit or push was performed.

## Nineteenth plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass18-scoped-findings.md`.

### Root cause, red proofs, repairs, and sabotage

1. **P1 — whole-frame privacy stopped at the comparison boundary.** Capture already applied the shared
   redaction contract to the complete `render_screen()` result before publishing a tracked fixture, but
   `frame-diff.py` split its input into physical lines and applied the same redaction expressions one line at
   a time. The status identity expression deliberately needs the following indented `⏸ manual mode on` row,
   so an authenticated raw frame compared against its redacted golden falsely diverged. The divergent output
   and its allowlist fingerprint received the raw line.

   `frame_masks.py` now exposes `preprocess_frame_for_publication()` as the complete-frame privacy seam.
   Capture calls it before staging; comparison calls it before line splitting through
   `preprocess_frame_for_comparison()`. Only after privacy succeeds do the existing narrow, line-compatible
   `by_frame` nondeterminism masks run. If a primary substitution or residual identity guard fails,
   comparison is a safe `DIVERGENT` diagnostic naming only the failed contract labels: it prints neither
   unified lines nor a fingerprint. Canonical frame keys, nested allowlist scope, exact canonical JSON
   fingerprints for safe comparisons, and stale/malformed allowlist behavior remain unchanged.

   Red proof: a controlled raw status frame and its redacted equivalent returned exit **1**, reported
   `DIVERGENT`, and the test observer found the synthetic identity in both the divergent output and the
   pre-mask fingerprint input. The new full CLI regression was red before the repair; the ANSI-split and
   row-wrapped privacy variants produced **two** red subtest failures, and a real semantic change remains
   divergent after the repair without exposing the identity.

   Sabotage proof: replacing the shared preprocessing block in `frame-diff.py` with the former linewise
   `load_masks()`/`splitlines()` loop made
   `diff_redacts_multiline_status_identity_before_output_or_fingerprint` fail (exit **1**). The exact source
   bytes were restored (SHA-256 `a16c1b89e44157e059367879fda57ca1e1d7e198e8e48134149d0e18e5c97fcd`) and the
   focused regression passed again.

2. **P2 — one Task 11 final-check command still used the retired repository-local interpreter.** The plan
   setup and scripts correctly specify the job-local pinned environment, but the final instrument re-check
   had two stale invocations. Task 11 now invokes capture and diff through
   `"$CLAUDE_JOB_DIR/tmp/frame-python-venv/bin/python3"`.

   The documentation contract now checks both governing documents (`VERSION` and the F0 plan) for the
   pinned interpreter and rejects the stale repository-local path. It was red before the plan repair.

   Sabotage proof: replacing one final Task 11 pinned interpreter with the stale form made
   `frame_emulator_dependencies_are_exactly_pinned_and_documented` fail (exit **1**). The plan bytes were
   restored exactly (SHA-256 `d0b725634433028b32d84a94ad5a333b8d8cad9ec10d4e0b47ffe1110e94c17e`), and the
   documentation contract passed again.

### Pass-19 verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`. A new job-local
virtual environment at `$CLAUDE_JOB_DIR/tmp/f0-pass19-python-venv` installed the exact
`pyte==0.8.2` and `wcwidth==0.8.2` requirements. No credential file, real settings, API key, or OAuth token
was loaded or printed.

- Focused red/green: the whole-frame raw/redacted comparison, ANSI-split/row-wrapped private failure, and
  documentation contract tests were each **1 test** green after repair; before repair they failed with
  **1**, **2**, and **1** failures respectively.
- Frame-diff authenticated/raw acceptance:
  `-k diff_redacts_multiline_status_identity_before_output_or_fingerprint` — **PASS; 1 test in 0.094 s**.
  It proves equivalent authenticated/raw and redacted frames are clean, while a real non-identity semantic
  difference stays divergent with a fingerprint that contains no identity.
- Fixture baseline:
  `-k synthetic_unredacted_identities_round_trip_to_all_stored_goldens_without_git_history` — **PASS; 1 test
  in 0.005 s**. Pass 19 changed no tracked `.ansi` bytes, so an independent stable-cwd upstream recapture was
  not applicable; this all-eight-fixture round-trip is the applicable non-live baseline.
- Documentation contract:
  `-k frame_emulator_dependencies_are_exactly_pinned_and_documented` — **PASS; 1 test in 0.002 s**.
- Fresh pinned full suite:
  `TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`
  — **PASS; 66 tests in 21.466 s**.
  `env -u CLAUDE_JOB_DIR TMPDIR="$CLAUDE_JOB_DIR/tmp" <fresh-venv>/bin/python3 -m unittest discover -s
  test/python -p 'test_*.py'` — **PASS; 66 tests in 20.453 s**.
- Stability: with the same temporary low-priority CPU-bound load used by pass 18, ten complete 66-test runs
  passed **10/10** with ANSI-normalized `OK`: **21.298, 21.589, 20.861, 20.658, 21.311, 20.667, 21.479,
  20.991, 20.734, and 20.687 seconds**. The helper process was terminated by a shell exit trap.
- `git diff --check` passed before this report append and is rerun afterward. No production TypeScript changed,
  so a TypeScript typecheck is not applicable.

### Residual concerns

No remaining known whole-frame privacy, diff-output, fingerprint, or documented-interpreter concern remains.
The pre-existing manual terminal `Ctrl-Z` → `fg` acceptance concern is unrelated. Protected concurrent
untracked files were not edited, staged, removed, or used as test inputs; no commit or push was performed.

## Twentieth plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass19-scoped-findings.md`.

### Installed-reference evidence and root causes

1. **P1 — manual-only dashboard status scope.** The 2.1.220 installed reference, not `Claude Code Src`,
   defines the external permission modes at `~/claude-code-bundle/2.1.220/cli.pretty.js:41456-41536` and the
   complete display table at `:41536`. Its normal renderer at `:493969-493971` and dense renderer at
   `:494036-494038` both render `[symbol] [indicator] on`: `⏸ manual mode on`, `⏸ plan mode on`,
   `⏵⏵ accept edits on`, `⏵⏵ bypass permissions on`, `⏵⏵ don't ask on`, and `⏵⏵ auto mode on`. Non-default
   modes can add `(shift+tab to cycle)`; the shell-mode path has no permission marker. The committed 100×40
   fixtures corroborate manual-mode ANSI and both footer shapes: full on help boot/closed and composer
   cleared/killed, reduced on typed/Esc-armed/yanked, while help-open omits the status row. Before this pass,
   both substitution and residual guard literally required only `⏸ manual mode on`, so a real non-manual
   dashboard status could remain raw. The rules now substitute after all six exact installed markers. The
   SGR-normalized residual guard treats any adjacent `⏸` or `⏵⏵` `[indicator] on` marker as dashboard-shaped
   and fails closed when its label is unknown. It remains context-bound to the indented status/path rows, so
   transcript and code text without dashboard chrome, including `git@host`, retains its semantics.
2. **P2 — publication coverage coupled to comparison.** `preprocess_frame_for_comparison()` called the
   strict publication seam. A stored `▒` golden therefore could not satisfy a custom contract's nonzero raw
   match minima even when a raw current authenticated frame sanitized to exactly the same result. Publication
   remains `preprocess_frame_for_publication()`/`redact_text()` with required per-pattern and aggregate counts.
   The new explicit `sanitize_frame_for_comparison()` applies the same substitutions opportunistically, then
   runs every residual identity guard before splitting, diffing, or fingerprinting; it never reimposes raw
   publication coverage on either side.

### TDD red proofs, repairs, and sabotage

- The installed-marker table test was red before the config repair with **23 failures**: every non-manual
  exact case was unredacted, split/wrapped non-manual statuses were not rejected, and the unknown marker was
  failure-open. It covers all six exact reference strings, the optional auto `(shift+tab to cycle)` suffix,
  manual and auto reduced/full footers, real username `git`, ANSI-split and row-wrapped fail-closed paths,
  transcript preservation, and raw-versus-redacted
  manual/auto frame-diff acceptance. It is green after the two narrow config changes.
- The focused custom-contract comparison test was red before the API repair: its already-redacted golden
  failed `raw-identity matched 0/1; total matched 0/1`. It asserts that publication still reports those exact
  count failures, equivalent raw/redacted comparison is clean, a semantic difference still fingerprints as
  divergent without identity, and an unmatched guarded identity fails before output or fingerprint. It is
  green after the comparison sanitizer split.
- The documentation contract was written red for the absent five non-manual installed markers and the two
  privacy-role descriptions, then passed after VERSION and the plan were corrected.
- **P1 sabotage:** a byte-restored temporary removal of only the two `⏵⏵` primary alternatives produced
  **11 failures**, covering accept-edits, bypass, don't-ask, auto (including `git`) and raw auto comparison.
  The config SHA-256 matched its original after restoration.
- **P2 sabotage:** a byte-restored temporary insertion of publication redaction into
  `sanitize_frame_for_comparison()` made the custom contract fail **1** test at the redacted golden's `0/1`
  counts. The source SHA-256 matched its original after restoration.
- Post-sabotage focused green checks: exact mode table **1**, comparison custom contract **1**, legacy
  `private_config_masks` cluster **7**, and pinned documentation contract **1** test.

### Pass-20 verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`. No credential file,
real settings, API key, or OAuth token was loaded or printed.

- Applicable non-live stable-cwd baseline:
  `-k synthetic_unredacted_identities_round_trip_to_all_stored_goldens_without_git_history` — **PASS; 1 test
  in 0.005 s**. This pass did not rewrite a tracked `.ansi` fixture; the all-eight-fixture round trip is the
  applicable baseline.
- Fresh pinned environment: a new temporary venv installed the exact `pyte==0.8.2` and `wcwidth==0.8.2`
  requirements, verified through package metadata. With an isolated temporary `CLAUDE_JOB_DIR`, the full
  suite passed **68 tests in 22.557 s**; with `CLAUDE_JOB_DIR` unset it passed **68 tests in 23.949 s**.
- Direct-shell stability: ten consecutive full 68-test runs passed **10/10** in **22.057, 22.486, 23.793,
  22.912, 21.916, 22.467, 22.333, 21.842, 22.762, and 22.943 seconds**.
- `git diff --check` passed before this report append and is rerun afterward. No production TypeScript changed,
  so a TypeScript typecheck is not applicable.

### Residual concerns

There is no remaining known publication, comparison, non-manual dashboard-marker, raw-output, or fingerprint
privacy concern in the exercised contract. Two preliminary subprocess-captured stability loops each hit the
longstanding scheduler-sensitive later-repaint test once, while its isolated run passed 10/10 and the final
fresh direct-shell gate passed 10/10; no unrelated timing code was changed. The unrelated manual terminal
`Ctrl-Z` → `fg` concern remains. Protected concurrent untracked files were not edited, staged, removed, or
used as test inputs; no commit or push was performed.

## Pass-20 stability follow-up

This follow-up supersedes the preliminary scheduler concern above.

### Reproduction and causal trace

The exact failure in every preliminary loop was
`test_capture_later_frame_drains_a_split_repaint_before_publication` at
`test_frame_scripts.py:432`, asserting that its later frame contained `partial-complete`. The original test
sent one Enter, let the child write `partial`, then relied on `time.sleep(0.015)` before the child wrote its
suffix. It was not a subprocess-stdout artifact:

- A fresh Python wrapper using `subprocess.run(..., stdout=PIPE, stderr=STDOUT)` failed on captured full-suite
  attempt **7/10**: exit 1, **68 tests in 23.045 s**, with `partial-complete` absent.
- An immediate direct-shell loop using the same fresh venv failed at direct full-suite attempt **1/10**: exit 1,
  **68 tests in 24.297 s**, with the identical assertion and rendered `partial` frame.

Temporary, byte-restored timing instrumentation proved the old test's premise was invalid under scheduling:
its child logged `partial` at monotonic `1187396.254177750`; the later frame did not begin until
`1187396.272236458`; its nominal 20 ms pump began at `1187396.272296833` and returned only at
`1187396.336826666`, without the sleeping child ever logging its `-complete` write before capture teardown.
The preceding nominal 50 ms pump likewise consumed 138.593 ms. Therefore a scheduler-delayed child sleep,
not a capture readiness or stdout-pipe behavior, controlled the old assertion. Extending the production drain
would only exchange one unbounded scheduler assumption for another and violate the documented 20 ms bound.

### Test-harness correction and proof

`capture-frames.py` now supports `wait-output:<text>`, a condition-based key-script action. It reads in 4 KiB
chunks only while looking for the marker, retains at most 64 KiB of raw PTY output in memory, returns as soon
as the marker arrives, and prints neither the marker nor its raw tail. The repaired repaint test uses two
observed markers and a 4 KiB post-marker transport chunk, placing the final suffix beyond the single zero-drain
read but comfortably inside the real 20 ms drain. The frame itself remains a real pyte-rendered PTY capture.

- **Red:** before the action existed, the rewritten test failed **1 test** with
  `unknown action in key script: 'wait-output:partial'` before writing its second frame.
- **Green:** the condition-based test passed **1 test in 0.448 s**.
- **Sabotage:** replacing only `SNAPSHOT_DRAIN_SECONDS = 0.02` with zero made the same test fail **1 test**;
  `-complete` was absent from the later frame. The exact `capture-frames.py` bytes were restored by SHA-256.

### Follow-up verification

A new pinned venv verified `pyte==0.8.2` and `wcwidth==0.8.2` through package metadata. No credential file,
real settings, API key, or OAuth token was loaded or printed.

- Captured wrapper fresh suite: isolated `CLAUDE_JOB_DIR` **68 tests in 23.318 s**; unset
  `CLAUDE_JOB_DIR` **68 tests in 22.784 s**. Ten subprocess-captured full-suite repetitions passed **10/10**
  in wall-clock **21.685, 23.022, 21.660, 21.960, 22.074, 22.459, 22.429, 22.121, 22.553, and 22.587 seconds**.
- Direct shell fresh suite: isolated `CLAUDE_JOB_DIR` **68 tests in 21.911 s**; unset `CLAUDE_JOB_DIR`
  **68 tests in 22.413 s**. With `set -e`, ten direct full-suite repetitions passed **10/10** in suite times
  **22.129, 21.410, 21.849, 21.934, 21.670, 21.805, 22.810, 23.101, 22.582, and 22.957 seconds**.
- `git diff --check` passed before this follow-up append and is rerun afterward. No production TypeScript
  changed, so a TypeScript typecheck is not applicable.

### Residual concerns

The original loop failure is fixed as a test-harness correctness defect; both the subprocess-captured and
inherited-stdout execution styles now pass their full fresh ten-run loops. The unrelated manual terminal
`Ctrl-Z` → `fg` concern remains. Protected concurrent untracked files were not edited, staged, removed, or
used as test inputs; no commit or push was performed.

## Twenty-first plugin review fix pass

### Contract and minimality audit

The pass-20 review found that the tracked status rule used the same arbitrary `{0,2}` rendered-row bound for
both substitution and its SGR-normalized residual guard. That boundary is not a renderer contract: the
installed 2.1.220 footer uses a column layout below 80 columns, so a normal narrow terminal can put one status
block on more than two physical rows. Rejecting ordinary narrow columns or long working directories would
therefore reject a supported reference layout, and merely choosing a larger number would only overfit a newer
fixture.

`frame_masks.py` now has the narrow config-driven `DashboardStatusMask`. It walks a contiguous nonblank
rendered block ending at an indented dashboard-shaped marker. An exact 2.1.220 mode marker makes an unbroken,
raw-status-chrome `user@host` span replaceable regardless of path wrap count. The configured marker shape also
finds unknown `⏸`/`⏵⏵` modes: those, SGR-split identities, and row-split identities remain unredacted and fail
closed before publication, rendered diff, or fingerprint. The scope is still narrow: a transcript/code
`user@host:/…` without that dashboard block is unchanged. This replaces the row count with the installed
renderer’s actual semantic boundary; it is not a broader identity or transcript redaction.

`wait-output:<marker>` now creates one empty `bytearray` generation for each action and passes it only to that
action’s `pump` call. It retains at most the existing 64 KiB tail, still matches a marker across reads, has the
same timeout and child-death paths, and prints neither marker nor retained output. No global output tail remains
to satisfy a later same-marker action.

### Red, green, and sabotage evidence

All commands ran from `CC-to-SDK/harness` with synthetic children only. No credential file, real user settings,
API key, or OAuth token was read or printed.

- **Red:** a fresh `pyte==0.8.2` / `wcwidth==0.8.2` venv ran the two new tests before the production changes:
  `FrameScriptsTest.test_dashboard_status_block_redacts_arbitrary_wrapped_rows_for_publication_and_diff` and
  `FrameScriptsTest.test_capture_wait_output_requires_a_fresh_marker_for_each_action`. Both failed in **0.366 s**.
  The first left the four-row status identity raw; the second captured `SECOND-PENDING` before the second,
  same-marker repaint.
- **P1 regression:** the 32-column synthetic capture naturally wraps a canonical status path across four rows,
  publishes a redacted frame, and then runs a semantic divergent frame comparison. The comparison may print its
  fingerprint and semantic diff but neither stdout nor stderr contains the raw identity. It also preserves a
  transcript remote token outside dashboard chrome.
- **P2 regression:** one script waits for `SYNC-MARKER`, captures `FIRST-READY`, then waits for the exact same
  marker after Enter. The child emits `SECOND-PENDING`, then emits the fresh marker split across two PTY writes.
  The later frame must contain `SECOND-READY` and not `SECOND-PENDING`.
- **Green:** the two regressions plus installed-marker, fail-closed, and split-repaint coverage passed **5 tests
  in 1.679 s**. After adapting two legacy tests to contiguous SGR-split rejection under the structural contract,
  the two regressions plus those legacy guards passed **5 tests in 1.682 s**.
- **P1 sabotage:** temporarily changing only the two configured recognized `auto mode` alternatives to
  `auto-disabled mode` made the four-row regression fail **1 test** at the expected unredacted identity.
  Restoring the config produced SHA-256
  `7b8edea271170bd5470181d6bd1c2dd82e6a0e9c539fb6df2c1d9cb51110fa99`.
- **P2 sabotage:** temporarily preloading every fresh wait generation with its marker reproduced stale-generation
  acceptance and made the same-marker regression fail **1 test** because its second frame lacked `SECOND-READY`.
  `bytearray()` was restored after the sabotage; the final byte check after the grammar documentation update
  produced SHA-256 `ee2145a85062bd0108a68020609a3a7ed641119ce32210cfc12007e51df776b9`
  for `capture-frames.py`.

### Verification

- A separately created `/tmp/f0-pass21-verify-python-venv` installed the exact pinned requirements and verified
  package metadata for `pyte 0.8.2` and `wcwidth 0.8.2`.
- Full suite with an isolated temporary `CLAUDE_JOB_DIR`:
  `/tmp/f0-pass21-verify-python-venv/bin/python3 test/python/test_frame_scripts.py` — **70 tests in 23.403 s**.
  The same command with `CLAUDE_JOB_DIR` unset passed **70 tests in 23.532 s**. The expected injected
  private-config seed-write test emits its own controlled error line in both runs.
- No fixture changed in this pass, so the applicable stable-CWD baseline was
  `test_synthetic_unredacted_identities_round_trip_to_all_stored_goldens_without_git_history`; that plus the new
  synthetic capture/diff privacy acceptance passed **2 tests in 0.295 s**.
- Ten full suites through a `subprocess.run(..., stdout=PIPE, stderr=STDOUT)` wrapper passed **10/10** in
  **23.584, 23.758, 23.584, 23.271, 23.175, 23.720, 23.093, 23.093, 23.033, and 23.475 seconds**.
- Ten full suites with inherited terminal stdout passed **10/10** in **23.718, 23.869, 23.503, 23.313, 22.818,
  23.120, 23.113, 23.213, 23.558, and 23.065 seconds**.
- `git diff --check` passed before this report append and is rerun afterward. No production TypeScript changed,
  so a TypeScript typecheck is not applicable.

### Changed files and residual concerns

This pass changed `harness/scripts/frame_masks.py`, `harness/scripts/frames/masks.json`,
`harness/scripts/capture-frames.py`, `harness/test/python/test_frame_scripts.py`, and
`docs/superpowers/plans/2026-07-31-tui-clone-f0.md`, as well as this report. Protected concurrent untracked
files were not touched, staged, removed, or used as inputs; no commit or push was performed.

The exact 2.1.220 marker set is intentionally closed. A future marker-shaped installed status remains a private
capture/comparison failure until reviewed config adds its semantic marker; it cannot become a raw published or
fingerprinted identity. The unrelated manual terminal `Ctrl-Z` → `fg` concern remains.

## Twenty-second plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass21-scoped-findings.md`.

### Installed-reference evidence and root causes

1. **P1 — padded/right-aligned footer recognition.** The installed 2.1.220 renderer is authoritative. Its
   right footer column is created as an end-aligned, overflow-hidden column at
   `~/claude-code-bundle/2.1.220/cli.pretty.js:489333-489351`; for an invalid or missing credential,
   `:489412-489415` renders the exact `Not logged in · Run /login` text with `wrap:"truncate"`. The normal
   left renderer emits the mode plus finite action slots at `:493967-494031`; the dense renderer reduces this
   to mode plus the optional cycle action at `:494036-494038`. A settings-isolated installed capture confirmed
   that at 60 columns the full left footer and account state flow onto separate rows, and at 40 columns the left
   footer is exactly clipped as ` · ? for shortcuts …` while the right text remains exact.

   All eight 100×40 fixture status rows were inspected after SGR normalization. `help-overlay/01-boot` and
   `03-closed`, plus `composer-basics/03-cleared` and `04-killed`, are full mode + shortcut/agent rows with the
   right account column. `composer-basics/01-typed`, `02-esc-armed`, and `05-yanked` are reduced mode rows with
   that same padded account column. `help-overlay/02-help` has no dashboard marker. The former configuration
   allowed an arbitrary ` · ...` suffix but did not recognize terminal padding followed by the right column, so
   both a valid padded marker and an unknown padded marker escaped structural classification.

   The new closed grammar is: one of the six exact installed mode markers, optional `(shift+tab to cycle)`, then
   reduced output, ` · ? for shortcuts`, ` · ← for agents`, the full ` · ? for shortcuts · ← for agents`, or the
   installed clipped ` · ? for shortcuts …`. A physical wrap may end only at a literal prefix of the known
   `? for shortcuts` token, preserving the prior narrow-screen pass-21 regression without admitting arbitrary
   suffixes. The logged-out right column is only `Not logged in · Run /login`, padded after the left portion on
   the same row or rendered separately. The broader marker grammar has the same finite footer language, so an
   unknown `⏸`/`⏵⏵` mode in that shape still fails closed.

2. **P2 — hostname underscores.** The raw substitution and SGR-normalized structural matchers both allowed `_`
   in a username but stopped the hostname at `_`. Thus `alice@host_name:/repo` was neither substituted nor
   reported as residual identity in valid dashboard context. Both hostname positions now admit `_` alongside
   alphanumerics, `.` and `-`; they still exclude whitespace and the `:`/`/` path delimiters. No transcript or
   code matching was broadened.

### TDD red proofs, repairs, and sabotage

- **P1 red:** `test_padded_or_clipped_footer_status_identity_is_private_for_capture_and_diff` failed before the
  grammar repair with two assertions: a valid padded `alice@host` was left raw, and an unknown padded marker was
  silently accepted. The new test uses raw authenticated capture, whole-frame diff/fingerprint privacy, all
  full/reduced/clipped/padded footer forms, and a chrome-free transcript negative.
- **P2 red:** `test_dashboard_hostname_underscore_is_private_but_transcripts_remain_semantic` failed before the
  hostname repair because `alice@host_name` was left raw. It verifies direct substitution, ANSI-split and
  row-wrapped dashboard rejection before diff output/fingerprinting, and plain transcript/code/path negatives.
- **Documentation red:** the pinned documentation guard failed before the `VERSION`/plan update because it still
  said `at most two rendered wrap rows` and documented neither the right-column grammar nor hostname `_` support.
- **P1 sabotage:** replacing all four `Not logged in · Run /login` grammar literals with `Not logged out · Run
  /login` made the padded-footer regression fail. The masks file was restored byte-for-byte before continuing.
- **P2 sabotage:** restoring the hostname-side raw and semantic classes to exclude `_` made the underscore
  regression fail. The masks file was restored byte-for-byte before continuing.

### Pass-22 verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`. Fresh private capture
configuration and synthetic test directories were used; no credential file or real settings was accessed, and no
credential value was printed.

- Fresh environment: `${CLAUDE_JOB_DIR}/tmp/f0-pass22-python-venv` installed the pinned
  `pyte==0.8.2` and `wcwidth==0.8.2` requirements and verified both package versions through
  `importlib.metadata`.
- Focused red commands used `python3 -m unittest discover -s test/python -p 'test_*.py' -k` for the padded-footer,
  underscore-hostname, and documentation regressions. They failed before repair with **2**, **1**, and **1**
  assertion failures respectively. Their corresponding final green checks passed **1 test** each; the full suite
  also exercised all three contracts.
- Isolated job directory:
  `CLAUDE_JOB_DIR=<temporary>/job TMPDIR=<temporary>/tmp <fresh-venv>/bin/python3 test/python/test_frame_scripts.py`
  — **PASS; 72 tests in 21.953 s**.
- Unset job directory:
  `env -u CLAUDE_JOB_DIR TMPDIR=<temporary>/tmp <fresh-venv>/bin/python3 test/python/test_frame_scripts.py`
  — **PASS; 72 tests in 22.322 s**.
- Captured-output stability: ten wrapper-driven full-suite repetitions each required exit zero, `Ran 72 tests`, and
  ANSI-normalized `OK`: **10/10 PASS**.
- Direct-terminal stability: ten inherited-stdout full-suite repetitions passed **10/10**, each with **72 tests**
  (23.276–24.858 s).
- Capture/diff privacy acceptance is exercised by the two new named regressions: the padded raw status capture
  stores no identity; its semantic diff may fingerprint without identity disclosure; SGR-split and row-wrapped
  underscore-host statuses reject privately before a diff or fingerprint; transcript/code/path values stay exact.
- No tracked `.ansi` fixture was rewritten in this pass, so a new stable-cwd recapture/comparison was not
  applicable. The pre-existing dirty fixture updates were preserved untouched.
- `git diff --check` — **PASS** before this report append and is rerun after it.

### Minimality audit and residual concerns

Pass 22 changes only `harness/scripts/frames/masks.json`, `harness/test/python/test_frame_scripts.py`, the fixture
`VERSION` contract, the F0 plan, and this report. The parser/control flow and comparison-mask scope were unchanged:
the existing configuration-driven structural seam already expressed both fixes. The duplicated scenario contracts
remain identical, and no protected untracked file was edited, staged, removed, or used as a test input. No commit
or push was performed.

No known P1/P2 privacy bypass remains in the exercised grammar. A future installed marker or account-status text
outside this closed language intentionally becomes a private capture/comparison failure until reviewed evidence
adds it. The unrelated manual terminal `Ctrl-Z` → `fg` acceptance concern remains.

## Twenty-third plugin review fix pass

Source of truth: `/Users/new/.claude/jobs/e1de885d/tmp/pass22-scoped-findings.md`.

### Root cause, installed evidence, and repair

The tracked write path and scratch path previously shared `clean_child_env()`. Its ambient namespace scrub removed
all `ANTHROPIC_*` values but deliberately retained `CLAUDE_CODE_OAUTH_TOKEN`, while the stock identity-redaction
contract correctly permitted zero substitutions. Consequently both a logged-out and an OAuth-authenticated renderer
could pass privacy publication and write materially different tracked ANSI. A synthetic pre-edit reproduction used
only fake environment values and a child reporting booleans: the no-auth and fake-auth tracked calls both exited zero
and published frames; the fake-auth child observed OAuth present, API credentials absent, and emitted different bytes.
No credential value was printed.

Installed `claude --version` in a fake-home environment returned `2.1.220 (Claude Code)`. The installed
`~/claude-code-bundle/2.1.220/cli.pretty.js:489412-489415` renderer confirms that an `invalid` or `missing`
credential renders the exact `Not logged in · Run /login` footer. All eight current fixtures were inspected:
seven display that footer; `help-overlay/02-help.ansi` intentionally obscures it behind the shortcut overlay but
retains `Welcome back!`.

Tracked `capture-frames.py` now calls the same ambient scrub as scratch capture, then removes the explicitly
recognized `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` names before the child starts.
Untracked capture retains the previous OAuth-only forwarding behavior and still rejects all Anthropic variables.
`frame_masks.py` now parses a separate `required_state_by_frame` contract and validates its required/forbidden rules
against the SGR-normalized raw render before redaction. The check never mutates stored ANSI. `masks.json` requires the
installed logged-out footer for seven frames, the non-personal help-overlay state for the footer-hidden frame, and
rejects authenticated greeting/organization state. A state or redaction failure leaves the complete staged batch
unpublished.

### TDD red proofs, green regressions, and sabotage

- Red credential regression:
  `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'tracked_capture_scrubs_fake_credentials'`
  failed one assertion in **0.336 s** before the scrub repair because the tracked child reported OAuth present.
- Red state/atomicity regression:
  `scripts/frames/.venv/bin/python3 -m unittest discover -s test/python -p 'test_*.py' -k 'tracked_capture_rejects_mixed_state_atomically'`
  failed one assertion in **0.464 s** before the state parser because the mixed second frame published with exit zero.
- After the repair, the credential scrub and state/atomicity regressions each passed **1 test**. The existing
  `capture_seeds_a_private_claude_config_without_ambient_auth_or_config` regression also passed **1 test**, proving
  untracked OAuth-only forwarding and Anthropic suppression remain intact without exposing a value.
- Environment-scrub sabotage temporarily changed the tracked call to use the scratch environment mode. The credential
  regression failed as required; `capture-frames.py` was restored byte-for-byte.
- Required-state sabotage temporarily changed only the configured `help-overlay/01-boot.ansi` logged-out pattern.
  The credential regression failed before publication; `masks.json` was restored byte-for-byte.

### Verification

All commands ran from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`. The fresh environment used a
new fake home and test-local temporary/job directories; no real Claude settings, credential file, API key, or OAuth
value was read or printed.

- A fresh `/tmp/f0-pass23.*/venv` installed the pinned `pyte==0.8.2` and `wcwidth==0.8.2` requirements and verified
  both package versions. With a test-local `CLAUDE_JOB_DIR`,
  `env -i PATH="$PATH" HOME=<fake> CLAUDE_JOB_DIR=<job> TMPDIR=<tmp> <venv>/bin/python3 -m unittest discover -s test/python -p 'test_*.py'`
  passed **74 tests in 24.924 s**. The same command without `CLAUDE_JOB_DIR` passed **74 tests in 24.646 s**.
- Captured-output stability: ten `subprocess.run(..., stdout=PIPE, stderr=STDOUT)` full-suite runs passed **10/10**,
  each with 74 tests, in **24.501, 23.483, 22.981, 24.024, 26.755, 27.053, 25.610, 25.586, 23.945, 25.004 seconds**.
  Direct-terminal stability: ten inherited-output full-suite runs passed **10/10**, each with 74 tests, in
  **24.343, 25.392, 24.769, 24.937, 24.980, 25.761, 25.127, 24.370, 26.106, 24.693 seconds**.
- Installed-reference recapture used the documented exact-version, `100x40`, `/tmp/frame-scratch`, masks, and private
  config commands twice: once with no ambient credential and once with fake OAuth/API environment names. Each run
  wrote **3 help-overlay + 5 composer-basics frames**. The two eight-frame trees were byte-identical, and the
  configured logged-out state held **8/8** times.
- The unchanged raw ccx comparison flow captured **3 help-overlay** and **5 composer-basics** frames. `frame-diff.py`
  reported the known expected baseline: help **0 clean, 0 allowlisted, 3 DIVERGENT** and composer **0 clean,
  0 allowlisted, 5 DIVERGENT**, both exit status 1.
- `git diff --check` passed before this report append and is rerun afterward. Production TypeScript did not change, so
  a TypeScript typecheck was not applicable.

### Minimality audit and residual concerns

Logged-out is deliberately chosen over requiring OAuth because it reproduces the current validated fixtures without a
credential, prevents account identity exposure, and allows deterministic recapture by any operator. Requiring OAuth
would make the golden depend on a personal account and recreate the ambiguity this pass closes. The code change is
limited to destination-aware credential removal, a small configuration parser/validator, two high-signal synthetic
regressions, and the capture contract documentation. `frame-diff.py`, comparison masks, and all pre-existing fixture
bytes remain untouched by this pass; no protected untracked file was edited, staged, removed, or used as input, and
no commit or push was performed.

The two freshly captured installed-reference trees are exactly equal to each other but are **0/8** byte-equal to the
pre-existing dirty fixture trees; all eight differ from line one in semantic content and SGR styling. One inspected
keyless boot frame retained the exact logged-out footer but used a different palette/layout. This is an environmental
fixture-determinism concern outside the authentication separation, so the validated existing fixture bytes were not
replaced. The unrelated manual terminal `Ctrl-Z` → `fg` concern remains.

## Twenty-fourth plugin review follow-up — terminal capability determinism

This follow-up resolves the pass-23 environmental concern rather than replacing fixtures. All commands used
`/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`, fake or private capture configuration, and
synthetic credentials only. No real settings, credential file, or credential value was read or printed.

### Diagnosis

Three ANSI-aware, byte-only comparisons isolated the source of drift:

1. The exact documented normal-shell upstream capture, with recognized authentication variables removed, matched the
   existing dirty candidates **8/8 raw bytes** and **8/8 SGR-normalized semantic bytes**.
2. The same normal terminal environment with a fake `HOME` still matched the three help-overlay candidates **3/3**,
   proving the private `CLAUDE_CONFIG_DIR` seed—not a real-home setting—controls this capture path.
3. The clean `env -i` no-auth capture differed **0/8**, from line one, from the candidates. A safe presence-only
   inventory considered `COLORTERM`, `FORCE_COLOR`, and `LC_CTYPE`; no values were reported. One-variable help
   recaptures found only `COLORTERM` sufficient (**3/3** candidate matches). `FORCE_COLOR` alone and `LC_CTYPE` alone
   each matched **0/3**. A clean fake-home capture with the literal non-secret `COLORTERM=truecolor` then matched the
   intended candidates **8/8**.

The installed 2.1.220 bundle corroborates the experiment: its Chalk capability initialization considers terminal
color inputs including `COLORTERM` at `~/claude-code-bundle/2.1.220/cli.pretty.js:20087-20102` and `:33055-33076`;
color-level selection is process-start state at `:33212-33234`. The earlier clean tree lacked that capability signal,
selecting a different palette/dim/layout branch. The candidates are therefore current and reproducible, not stale.

### Repair, TDD, and sabotage

Tracked `clean_child_env()` now applies the one-value `TRACKED_TERMINAL_ENV` contract:
`COLORTERM=truecolor`. It does so after tracked credential removal and before child start; untracked/scratch capture
continues to preserve its ambient terminal capability and OAuth-only credential behavior.

- The tracked child-environment regression was first made red by requiring `"colorterm": "truecolor"`; before the
  pin it failed because the observed value was absent. It passed after the one-branch environment update.
- The existing scratch inventory regression now proves a supplied synthetic terminal capability remains unchanged for
  untracked capture, alongside OAuth forwarding and Anthropic suppression; it passed **1 test**.
- Sabotage temporarily removed the tracked `env.update(TRACKED_TERMINAL_ENV)` call. The tracked regression failed as
  required, then `capture-frames.py` was restored byte-for-byte and both tracked and scratch regressions passed.

### Final acceptance

- Two independent clean fake-home installed captures, one no-auth and one with fake OAuth/API names, each wrote
  **3 help-overlay + 5 composer-basics** frames. Both trees matched all intended tracked candidates **8/8 raw bytes**
  and matched one another **8/8 raw bytes**.
- The tracked-only terminal pin did not affect untracked comparison. Fresh raw ccx captures preserved the required
  baseline: help **0 clean, 0 allowlisted, 3 DIVERGENT** and composer **0 clean, 0 allowlisted, 5 DIVERGENT**.
- Fresh pinned suites with a test-local `CLAUDE_JOB_DIR` and with it unset each passed **74 tests** in **25.126 s** and
  **24.851 s**, respectively. `npm run typecheck` passed.
- The final captured-output stability loop passed **10/10** in **22.924, 22.893, 23.788, 24.244, 25.418, 25.610,
  25.250, 25.047, 24.663, 25.421 seconds**. The final direct-terminal loop passed **10/10** in **25.256, 27.019,
  24.240, 25.113, 24.700, 24.336, 25.269, 24.907, 24.229, 25.171 seconds**. One earlier buffered loop failed while
  an independent source-tracing worker was consuming the host; the pre-existing first-frame liveness test then passed
  **10/10** in isolation, and the final full captured loop passed 10/10 after the worker completed.

### Minimality and residual concerns

The fix adds one tracked-only terminal capability assignment, two precise child-environment assertions, and contract
documentation. It does not change fixture bytes, comparison masking, frame-diff behavior, capture geometry, private
configuration seeding, or scratch capture behavior. Protected untracked files were not edited, staged, removed, or
used as inputs; no commit or push was performed. The pass-23 **0/8** concern is superseded by the root-cause proof
and post-pin **8/8** candidate equality. The unrelated manual terminal `Ctrl-Z` → `fg` concern remains.

## Twenty-fourth plugin review fix pass

### Scoped findings and root causes

This pass resolves the later scoped review’s two remaining capture defects without replacing any validated fixture
bytes. All commands used fake homes, private temporary configuration/output directories, synthetic child processes,
or the installed logged-out Claude binary. No real settings, credential file, API key, OAuth value, or protected
untracked path was read, printed, changed, staged, or used as input. No commit or push was performed.

1. **forkpty process-group race.** `pty.fork()` can return to the parent before its child has formed process group
   `pid`. The prior helper swallowed `killpg(pid, SIGKILL)` `ESRCH` and immediately blocked in `waitpid(pid, 0)`,
   leaving a live interactive leader indefinitely. A second investigation also found that the liveness pump may reap
   an exited leader before final cleanup while a descendant still occupies that now-orphaned process group; a
   `getpgid(pid)`-first repair would leak that descendant. The repair retries only `killpg(pid, SIGKILL)` for at most
   200 ms (5 ms polling), never targets the controller’s PID or process group, then safely kills the leader before
   blocking reap only when no addressable group appeared. Thus a live or orphaned child group remains tree-safe,
   and a group-creation failure cannot make reaping unbounded. Both the pre-first-frame terminal-init error path and
   the normal `finally` retain kill/reap → master-FD close → private-config removal ordering.
2. **tracked color capability was still ambient-sensitive.** Installed Claude Code 2.1.220 resolves
   `supports-color@10.2.2`: `FORCE_COLOR=0` selects level 0 before normal detection; `TF_BUILD`/`AGENT_NAME`, CI,
   provider markers, and `TEAMCITY_VERSION` select earlier branches; `COLORTERM=truecolor` then selects level 3;
   `TERM`/`TERM_PROGRAM` branches follow. The installed `colorize.ts` clamps level 3 to 2 under `TMUX`, and
   `systemTheme.ts` derives the palette from `COLORFGBG`. The eight validated frames contain literal level-3 RGB
   SGR (`38;2;...`), so either a level downgrade or palette seed changes their bytes. For tracked children only,
   `clean_child_env()` now removes `FORCE_COLOR`, `NO_COLOR`, CI/provider selectors, `TMUX`, `TERM_PROGRAM`,
   `TERM_PROGRAM_VERSION`, and `COLORFGBG`, then uses the existing authoritative `TERM=xterm-256color` and
   `COLORTERM=truecolor` contract. Scratch children retain every supplied ambient terminal variable.

### TDD, red proofs, and sabotage

- The deterministic P1 regression forks a real SIGHUP-ignoring synthetic child in an outer process, forces every
  group signal to raise `ProcessLookupError`, and simulates the not-yet-private group. Before implementation it
  timed out at the test’s original one-second outer guard; its final two-second launch allowance is only for
  interpreter/PTY startup, while the production retry stays 200 ms. After the repair the child is dead and reaped
  in the test process. A ten-case empty/comment-only script test and a condition-synchronized terminal-init failure
  test cover both immediate cleanup call sites; the latter records a real descendant and proves both PIDs exit.
- The P2 hostile matrix first failed because the tracked child received synthetic `FORCE_COLOR=0` and `NO_COLOR=1`.
  It exercises force/no-color, all detector CI/provider selectors, tmux/terminal/palette selectors, and their
  combination; post-repair it asserts none remain, `TERM=xterm-256color`, `COLORTERM=truecolor`, logged-out state,
  and byte-identical synthetic output. The pre-existing real scratch-child regression was extended to prove every
  same supplied terminal value is preserved in both success and failure capture paths.
- Installed reference red proof: a fake-home/private-config 2.1.220 help-overlay capture with only synthetic
  `FORCE_COLOR=0` was **0/3** raw-equal to the candidates and contained **0** level-3 RGB SGR sequences. No
  credential was present. The first temporary run used a random `--cwd` and exposed that cwd is intentional
  dashboard content; all acceptance recaptures used the documented `/tmp/frame-scratch` cwd.
- P1 sabotage temporarily disabled leader fallback. The deterministic race regression timed out and failed as
  required; the fallback was restored before subsequent gates. P2 sabotage temporarily omitted the terminal-unset
  union. The hostile matrix failed on leaked `FORCE_COLOR`/`NO_COLOR`; the union was restored before subsequent gates.

### Final acceptance evidence

All Python commands below used the fresh pinned `pyte==0.8.2` / `wcwidth==0.8.2` venv created outside the repository.

- `env -i PATH="$PATH" HOME=<fake> TMPDIR=<tmp> CLAUDE_JOB_DIR=<job> <venv>/bin/python -m unittest discover -s test/python -p 'test_*.py'`
  passed **77 tests in 31.667 s**. The same command without `CLAUDE_JOB_DIR` passed **77 tests in 30.147 s**.
  Expected injected seed-write and terminal-init failure messages occurred only inside their respective tests.
- Captured-output stability ran the same fresh 77-test suite **10/10** in
  **31.247, 31.519, 31.744, 31.510, 31.505, 33.626, 31.429, 32.111, 31.600, 31.792 seconds**.
  Direct inherited-output stability ran **10/10** in
  **30.008, 30.913, 30.426, 30.886, 32.128, 32.020, 30.401, 29.805, 28.837, 29.602 seconds**.
  The final captured loop initially exposed scheduler-startup flakiness: the initial rendered-cell wait was increased
  from 0.5 to 1.0 second, and only outer subprocess assertions were widened to two seconds; after that measured
  correction, both loops passed. The 200 ms production group retry was unchanged.
- Focused process-group stress ran the forced race fallback **20/20** and real descendant cleanup **20/20** under
  fake environment state, with individual runs spanning **0.366–1.348 s**. The controller-process-group guard,
  terminal-init reaping, and empty/comment script stress regressions also pass.
- Two independent installed 2.1.220 full recaptures, each with a fake home/private config and a different hostile
  environment (one including `FORCE_COLOR=0`, `NO_COLOR`, all CI/provider markers, tmux/terminal/palette inputs;
  one using a different force/CI/tmux/terminal combination), wrote **3 help-overlay + 5 composer-basics** frames.
  At `/tmp/frame-scratch`, each matched the existing candidates **8/8 raw bytes** and contained **457** RGB SGR
  occurrences. Temporary tracked destinations and custom contract files were removed after comparison.
- The unchanged no-auth local `ccx` baseline wrote **3 + 5** untracked frames. `frame-diff.py` retained its expected
  result: help-overlay exit **1** with **3** divergent frame headers, composer-basics exit **1** with **5** divergent
  frame headers.
- `npm run typecheck` passed. `git diff --check` is rerun after this report append.

### Residual concerns

The capture command intentionally renders `--cwd` in its dashboard; future byte-comparison recaptures must keep the
contracted `/tmp/frame-scratch` path rather than a random temporary cwd. The process-group fallback is deliberately
bounded and controller-safe, but cannot clean arbitrary descendants that never join the forkpty child group; the
capture child and descendants created by its normal process tree do join it, as the real stress test proves. The
unrelated manual terminal `Ctrl-Z` → `fg` concern remains. Fixture bytes, comparison masking, private-config seeding,
and untracked capture semantics are otherwise unchanged.

## Twenty-fourth plugin rereview — clean

The installed doperpowers Codex companion reviewed the complete uncommitted pass-13-through-pass-24 diff against
`6798e859f5` using `gpt-5.6-sol`. Its explicit terminal verdict was:

> No actionable correctness defects were found. Targeted checks passed, although the full tempfile-dependent Python
> suite could not run in the read-only environment.

The full review transcript is recorded at
`$CLAUDE_JOB_DIR/tmp/pass24-scoped-codex-review.log`. The reviewer's environment limitation does not replace the
fresh authoritative gates above: both 77-test environments, both ten-run stability loops, process-group stress,
hostile-environment installed recaptures, the 3/5 ccx baseline, TypeScript typecheck, and `git diff --check` all
passed on the reviewed bytes. The scoped correctness gate is therefore clean.
