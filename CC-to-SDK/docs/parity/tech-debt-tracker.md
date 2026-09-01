# Tech-debt tracker — ccx TUI-clone program

Small, real, non-blocking items logged by round close-outs so they cannot be lost. Each entry names the
round that found it and the condition under which it becomes worth fixing. Delete entries when fixed (note
the commit) or when a round's scope absorbs them.

## Open

- **Plain-object env copies lose Windows' case-insensitive variable semantics** (found by bl12's round-4
  codex review, 2026-09-01). On win32 a child process sees `Claude_Config_Dir` as `CLAUDE_CONFIG_DIR`
  (env names are case-insensitive and Node's live `process.env` mirrors that), but every plain-object env
  this codebase builds — `resolveOptions`' `{...process.env, ...env}` SDK spawn merge, `effectiveEngineEnv`,
  `claudeConfigDir(env)` reads, the config domain's `userLayerDir` — does case-SENSITIVE key lookups, so a
  noncanonically-cased variable resolves differently than the engine child would see it. Class predates
  bl12; bl12 added one more consumer (the roster `configDir` mint). Currently unreachable where it was
  found: the attach transport is POSIX-only (UDS socket files, `ps -o lstart=` liveness), so no Windows
  attach exists to mis-derive for. Fix when a Windows fleet story exists: a `canonicalEnv()` helper that
  upcases-dedupes keys on win32, applied at the few env-copy seams.
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
- **Settings read-only tabs clip without scrolling** (bl10 review loop, rereview2-F1 restated
  rereview3, 2026-09-01). `readOnlyTabBody` windows Status/Usage/Stats to the frame budget with a
  dim `… +N more lines` marker (wave-2 F2, `5df713990`) — the bounded-frame invariant holds and is
  tested, but the clipped tail is unreachable: the tabs register no scroll/pageing handler. Only
  bites on short terminals with tall `/cost`-class payloads; the safe direction (clip) was chosen
  over tall-frame replay. Fix when it matters: navigable scrolling for the read-only tab body
  (canon's pane scrolls); adjudicated log-not-fix under the round's anti-refine-loop rule.
- **hover-cells h1 pins the negative gate only** (bl10 waves 2B/4, 2026-09-01). The cell now
  asserts hovering staged local output un-dims nothing (the intended T-CLICKGATE `f06085c8e`
  behavior) — but its fixture is a keyless `! printf` echo, so no PTY cell asserts the POSITIVE
  un-dim path over a genuinely `clickable`-stamped tool-result block. Needs a keyed or fake-host
  staged tool result; upgrade when hover next changes or a keyed battery run is scheduled.
- **Expanded header's band is click-inert when its body scrolls out of the viewport** (bl10
  rereview4, 2026-09-01; `toolRenderer.tsx` ~:581). `clickableOwnersOf()` derives owner
  clickability from painted body rows, so a long expanded result scrolled to show only its banded
  header paints (and hit-tests) full-width yet fails the owner gate in `clickTargetAt()` — the
  click is a no-op, no state/content loss, and paint==hit still holds. Pre-bl10 owner-gate
  design; fix direction: stamp headers clickable for expandable/expanded results. Logged per the
  post-wave-3 convergence rule.
- **Long MCP detail values have no full-text route** (bl10 rereview5, 2026-09-02). The dialog's
  bounding waves clip every rendered MCP string (root rows, field values, tool descriptions via
  `descKeep`) to the frame budget; a long server error/URL/command or tall description survives
  intact in `mcpDialogModel`'s normalized rows but no view scrolls or expands to show the tail,
  so the omitted diagnostic is unreadable in the TUI. Safe direction (clip beats tall-frame
  replay), same design tension as the Settings read-only entry above — resolve both with one
  scrollable-detail primitive if either becomes a real-usage complaint.
- **McpDialog's view stack reads render-time state under batched stdin** (bl10 rereview6,
  2026-09-02; `McpDialog.tsx` `useSelectKeys` wiring). Multiple keys coalesced into one chunk all
  dispatch against the same render's `view`, so `Enter Enter` / `Esc Esc` would advance/pop one
  level, not two. LATENT: empirically masked today — Ink mounts a React Legacy Root, so the raw
  stdin handler's `setState` flushes synchronously between same-chunk events (proven with
  instrumentation during the wave-2A focus fix, which hit the identical masking). Fix direction
  when Ink/React root behavior changes or MCP key handling is next touched: ref-back `view`
  exactly as the wave-2A fix ref-backed focus.
- **DialogFrame's `title`/`subtitle`/`titleEnd` props carry no width bound of their own** (bl10
  wave-7 sweep, 2026-09-02). Every current caller passes a literal or an already-bounded value,
  so this is dormant, not live — but the frame is the chrome every dialog shares, and a future
  caller passing runtime text re-opens the unbounded-string class the wave closed. Bound at the
  frame when DialogFrame is next touched; details in `fixwave7-report.md`.
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
