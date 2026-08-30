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

## Backlog-shaped (deferred features, not defects — live in the next round's candidate list)

- **Standalone hook renderer (`Qy`) + live counter (`di`)**, and with them the hooks-on-silent-run display:
  today a PreToolUse hook on an all-silently-absorbed run is dropped with the run (bl7 Surprises); canon
  routes it to `Qy`. The latent collapsed clause form (bold count, only-clause) is already pinned
  contract-level and activates when this lands.
- **`/config` advisor-model row + model-catalog picker** (bl7 D15/D7): the row ships only with a real
  catalog picker — full-or-dropped, never display-only.
