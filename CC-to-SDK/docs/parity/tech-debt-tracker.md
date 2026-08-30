# Tech-debt tracker — ccx TUI-clone program

Small, real, non-blocking items logged by round close-outs so they cannot be lost. Each entry names the
round that found it and the condition under which it becomes worth fixing. Delete entries when fixed (note
the commit) or when a round's scope absorbs them.

## Open

- **`test/live/image-submit.e2e.test.ts` unresolved-mkdtemp symlink bug** (found bl7, 2026-08-30). Line ~92
  uses `mkdtempSync` without `realpathSync`, the exact macOS `/var` → `/private/var` storage-key mismatch
  the bl7 advisor live cell hit and fixed locally (`test/live/advisor.e2e.test.ts:126`). The suite passed
  3/3 on 2026-08-30, so its read path may differ — verify before copying the fix. Fix when the file next
  fails or is next touched.
- **F1's withholding is trailing-atom-only** (found bl7 fix wave, 2026-08-30). Unresolved advisor rows are
  withheld from the append-once Static region with the same trailing-atom scope the growable-tool-run
  withholding has (deliberate symmetry, `fixwave-report.md`). Narrow edge: a local system notice landing
  between a still-unresolved consult and the next real message could let the dim row publish un-withheld.
  Same shape as the pre-existing tool-run edge; widen both together or neither.
- **`suggest-popup.test.tsx` "/revi opens the popup" uses a fixed `setTimeout(20)`** (recorded F6, restated
  here so it has a tracker row). Races the provider's passive stdin subscription under parallel load;
  convert to `waitFor` when the file is next touched.
- **Malformed hook names bypass the tool-scoped spanning guard** (found bl7 closing review, 2026-08-30;
  `toolFold.ts` ~712). A hook entry whose `hook_name` lacks a `:<Tool>` suffix falls back to match-any
  (deliberate fail-open), but the pop-out widening's spanning-sibling check is now tool-scoped, so such an
  entry from a cross-tool spanning sibling could be swept into the widened window (bogus hook line +
  suppressed relocation). Unreachable on the observed wire (P116: hook_name is always well-formed) and needs
  an already-exotic interleaving on top. Fix direction if it ever matters: refuse widening when any candidate
  entry in the window is malformed. Logged per the bl7 convergence rule after four fix waves.
- **Pre-existing real-subprocess codec flakes in `test:unit`** (observed bl7 fix-wave gates, 2026-08-30).
  Image/clipboard codec tests that shell out can each fail ~once per full-suite run under load and pass in
  isolation. Bound them (retry or serialize) when they next block a gate read.
- **`hookblock-cells.sh` restore path deletes its backup before verifying** (found bl8 round review F5,
  2026-08-30; verdict `finding-F5-verdict.md`). `restore_kill_mutation` rm's the backup without checking
  the `cp`, callers ignore its rc, and a failed post-restore rebuild can leave a feature-killed `dist`
  under a PASS verdict (`git diff --quiet` checks source only). Bounded: `toolFold.ts` is git-tracked,
  `dist/` regenerates on any build, and the trigger needs a rebuild to fail right after an identical
  success. Fix when the script is next touched: check `cp` before `rm`, propagate rebuild failure, add a
  dist-freshness check.
- **The D21-true branch is latent behind production callers** (bl8 Task 3 review + round review F1,
  2026-08-30). Per-hook detail lines and the Pre/PostToolUse "N hooks ran" counter gate on
  `projection !== "compact" || verbose`, but `projectAll` only folds under compact-nonverbose and
  `projectPending` hardcodes non-verbose — so the branch is pinned by pure-builder tests and dead in
  production. Detail mode now shows standalone hook ROWS (bl8 D18 weave) without those extras.
  Activates if a verbose/fold-aware projection path ever ships; revisit beside any ctrl+O rework.

## Backlog-shaped (deferred features, not defects — live in the next round's candidate list)

- ~~**Standalone hook renderer (`Qy`) + live counter (`di`)**~~ **SHIPPED bl8 (T-QY, merge
  `ac6924cc59` + fix waves)** — standalone rows, live counter, silent-run clause-form activation all
  landed; entry kept one round for the pointer, delete next close-out.
- ~~**`/config` advisor-model row + model-catalog picker**~~ **RESOLVED bl8 (T-ADVCMD, merge
  `ea0a078d9a`)** — canon research (R1) proved the /config row was never parity: canon's surface is the
  `/advisor` command + dialog, which shipped instead. The bl7 full-or-dropped rule stands satisfied;
  entry kept one round for the pointer, delete next close-out.
