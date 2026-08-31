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
- ~~**The D21-true branch is latent behind production callers**~~ **RESOLVED-REFUTED bl9** (R2
  binary research: canon's verbose unfolds clusters unconditionally — a folded-and-verbose state
  is unrepresentable; the `|| verbose` disjunct was redundant, not dormant, and bl9 T-POLISH
  deleted it, commit in merge `4e3494927f`). Carried risk recorded at the deletion sites: a
  future inline verbose toggle feeds fold/unfold, NEVER the extras gate. Entry kept one round
  for the pointer, delete next close-out.
- **Content-bearing mid-turn attach keeps its stale prefix** (bl9 design limitation, D17/D19-bl9,
  2026-08-31). The attach reconcile aborts (silently, per mount) when any non-re-derivable state
  exists — drained turn content, a frame landing during the pending read. Trigger requires the
  rewind race AND live activity; pre-bl9 behavior was stale-forever on every attach in the
  window. Fix direction if it ever matters: a non-destructive diff-converge document primitive
  (rejected D17-bl9 as corner-prone machinery). Revisit only on real-world reports.
- **State-only frames inside the pending-read window abort a harmless rebuild** (bl9 wave-5
  review, D20-bl9, 2026-08-31). `liveActivitySeq` counts turn:start/state/tasks_changed like any
  frame, so a contentless frame in the ~ms read window costs the reconcile (bounded staleness,
  safe direction). Only fix is a per-frame-kind allowlist — rejected for drift risk. Log-only by
  the round's convergence rule.
- **fake-host policy table covers 5/8 HostEvent kinds** (bl9 T-FOLLOW T3 review, 2026-08-31).
  `decision`/`state`/`tasks_changed` have no producer in `framesFor` today; if the script ever
  grows one, `scripts/fake-host-policy.mjs` needs a decision per kind (production replays
  `decision` from LIVE state, not verbatim). One-line footnote fix when next touched.
- **A2's bg-harvest sub-clause is inspection-verified only** (bl9 T-FOLLOW T4 walk, 2026-08-31).
  `replaceFromDisk` structurally cannot reach `bgHarvest`, but no test pins it the way the D16
  test pins task-panel survival. Add beside the D16 test when the file is next touched.

## Backlog-shaped (deferred features, not defects — live in the next round's candidate list)

(bl8's two shipped/resolved pointers deleted this close-out per the one-round retention rule.
Note: pre-rebase bl8 merge hashes cited in older docs refer to objects off the rewritten main —
the content lives on today's main under new hashes.)
