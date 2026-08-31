# bl9 — follow() rewound replay + transcript-gate simplification + advisor display name

**Round:** bl9 (2026-08-31) · **Canon:** Claude Code 2.1.251 (held from bl8, no churn) ·
**Base:** main `165d3d1fea` · **Ledger:** `.doperpowers/sdd/2026-08-31-bl9-round/round.md`

## 1. Purpose

Close out the three candidates carried from bl8's ledger. Research reshaped all three (fourth
consecutive round a carried premise died under research — see §2):

- **T-FOLLOW** — the one real defect: a client that attaches after an in-place rewind renders the
  pre-truncation transcript forever, because `follow()` replays no `rewound` frame and the session
  id cannot discriminate (in-place rewind keeps it). Fix = replay a retained, **anchorless**
  `rewound` on follow, gated on has-swapped.
- **T-POLISH** — three small, evidence-settled changes: delete the redundant `|| verbose` disjunct
  from the two hook-extras gates (the "D21-latent activation" ticket is REFUTED — canon has no
  folded-and-verbose state); retire the D15 verbatim-model divergence in the Advising row (bl8's
  `advisorModel.ts` removed its rationale); re-cite the duration-merge divergence comment.

Out of scope, with reasons recorded: fable consent flow (unchanged from bl8 — no credits surface);
the between-turns `task`-metadata residue (cosmetic, R1 §2.3); `toolRenderer.tsx:870` comment
re-verification (R2 conflated `Ce`/`Gc` — bounded binary re-check, logged to tech-debt);
F5 `hookblock-cells.sh` hardening (script not touched this round; tracker rule holds).

## 2. Research verdicts (the evidence base)

All three round files live in `.doperpowers/sdd/2026-08-31-bl9-round/`.

- **R1 `research-follow-replay.md` — the bl6 backlog entry is PARTLY-WRONG.** Of the three named
  frame kinds, only `rewound` is a real gap (confirmed by executing the real `SessionHost`:
  post-swap follow replays `["state"]` only). `decision_settled` is REFUTED — parks replay from
  live `parked.list()` (`host.ts:790`), so a settled park is never shown to a joiner.
  `task` is REFUTED in-turn — the frame rides the buffered `message` stream twice and
  `useChat.ts:1541` already ingests the replayed copy clock-free. The "~36 ms window" was borrowed
  from a different bl6 measurement; the real window is attach's read-disk→follow interval
  (`cli/attach.ts:27` → dynamic React/Ink import → mount → connect → follow), hundreds of ms, and
  the damage is permanent for the attached session. The gap class has NOT widened since bl6 (bl8
  hook frames ride the buffered message path; the advisor rides `replayFlagState`).
- **R2 `research-verbose-hooks.md` — D21-latent activation is REFUTED; kill the build.** Canon's
  cluster renderer unfolds unconditionally under verbose (`uI` @177043973, early return
  @177046212): a folded-and-verbose state is unrepresentable. The per-hook detail lines and the
  live counter key off **transcript mode strictly** (the ctrl+O screen), never the verbose
  setting. Our `projection !== "compact"` is exactly that surface; the `|| verbose` disjunct is
  redundant (`verbose ⇒ !compact` at every producing caller), not dormant. Positive evidence of
  absence: `"Ran "` occurs at exactly four offsets, all enumerated.
- **R3 `research-advisor-polish.md` — D15 is RETIRED-BY-EVENTS.** The recorded rationale
  ("ccx has no model catalog reachable from this pure module", `render.ts:221-223`) is stale since
  bl8 shipped `src/tui/advisorModel.ts` with `advisorDisplayName()`. Canon renders
  `⏺ Advising using Opus 4.8` via its `cs()` prettifier (bl7 research @176900223). bl7's spec
  (:160) originally specified a display name — retiring D15 restores original intent. The
  ` · {input}` clause stays omitted (already recorded: advisor input is always `{}`).

## 3. T-FOLLOW design — v2, redesigned after plan review (D14)

> v1 had the host retain a `swapped` latch and replay an anchorless `rewound` on `follow()`. The
> adversarial plan review confirmed two highs against it: (F1) `remoteChatSession` resumes BEFORE
> following precisely so its own swap stays silent (`chatAdapter.ts:94-100`, a documented
> load-bearing invariant pinned by an existing adapter test) — the replay would hand every
> resuming client its own swap back deterministically; (F2) `rebuildAfterRewind` wipes scrollback
> (`clearScreen`), resets the task panel and bg-harvest state — a replayed frame on EVERY attach
> to a once-swapped host would destroy correctly-drained live state, and the common case (disk
> already read post-swap) would pay a visible wipe for nothing. Rather than patching both (swap
> epochs + ordered-transaction buffering — a patch-the-corner spiral), v2 moves the fix to the
> seam that creates the window.

### 3.1 The invariant (D14)

The staleness window exists because the ATTACH client reads disk before it follows
(`cli/attach.ts:27` → dynamic Ink import → mount → connect → follow). The app server has no
window because it follows-then-serves. So the fix lives in the client: **after the follow ack,
re-read the transcript once and reconcile** — rebuild only if disk changed since the pre-follow
read. No wire change, no host change, no fleetEngine change; a client that is current pays one
cheap read and no repaint.

- `prepareAttach` returns, beside the bootstrap entries, a **disk stamp** of the read it made:
  `{ lastUuid, count }` over the persisted rows. Threaded through `runChatClient` opts into
  `useChat`.
- `useChat` runs a one-shot **reconcile** after the session reports followed/ready (the adapter's
  `whenReady()`; skipped entirely when no disk stamp was provided — fresh sessions and
  non-attach flows). Reconcile re-reads via the existing `deps.getSessionMessages` seam, computes
  the fresh stamp, and: match → no-op; mismatch → rebuild, **but only while the client is still
  provably virgin** (the final, wave-3-through-5 form — see D17/D18/D19-bl9):
  the rebuild runs only if, at fire time, (1) the document generation is unchanged (no swap —
  the gen bump lives in the document-swap primitive itself, so `/clear`/rewind/resume and any
  future boundary are covered automatically), (2) `TranscriptDocument.revision()` equals a
  snapshot captured at RENDER time (before any mount effect can mutate), and (3) a
  `liveActivitySeq` — bumped once per non-replay frame at every event-subscription choke point —
  is unchanged since the disk read STARTED. Any condition failing → silent, final abort: the
  mount-time correction stands down because something it cannot re-derive may exist.
- The virgin-mismatch rebuild reuses `rebuildAfterRewind`'s extracted document core
  (clear + `replaceDocument` of `replayDocument(rows, {label:"resynced"})` + `lastAssistant`
  reseed) and MUST NOT reset the task panel, bg-harvest, or composer prefill (D16).
- Every disk-backed document build keeps the stamp ref honest (seed, `resumeInto`,
  `rebuildAfterRewind`, the reconcile itself).
- **Recorded limitation (accepted, tech-debt-logged):** an attach that raced a rewind AND whose
  drain carried content of an open turn (or any live frame landing inside the pending-read
  window) keeps its stale prefix for that mount — permanent but narrowly triggered, and strictly
  better than the pre-bl9 state (stale-forever on EVERY attach in the window). The bias is
  deliberate: abort loses only bounded staleness; a wrong rebuild loses content.

### 3.2 What stays out (D5-v2)

- **No wire frame, no host latch:** the host's replay drain is already state-derived and stays
  untouched. `fleetEngine` needs nothing — it never had the window.
- The self-resume invariant (`chatAdapter.ts:94`) is preserved untouched: a resuming client's
  reconcile compares equal (its seed read the same file the resume re-opened) and no-ops.

### 3.3 Pinning the refuted halves (D6) and the test stand-in (D7)

- **Guard test:** on a host with a park settled before follow, the joiner receives the park in
  neither the replayed `decision` list nor as any `decision_settled` frame — so a future author
  cannot "fix" the refuted half into a double-settle.
- **fake-host (`scripts/fake-host.mjs`):** its pre-follow drain is kind-agnostic (strictly more
  generous than production — a cell pushing `task`/`decision_settled`/`rewound` pre-follow would
  false-green against it). Narrow the drain to production semantics: buffer/replay `message`
  frames; keep `turn` replay as a DOCUMENTED divergence (production synthesizes an equivalent
  start frame — observably equivalent for cells); DROP `task`/`decision_settled`/`rewound` from
  the drain (production replays none of them — v2 keeps production that way). Extract the
  buffering policy as a testable unit so the narrowing lands red-first (review F4: the divergence
  is latent — `framesFor` emits only `message`/`turn` — so the pty matrices alone cannot go red
  on it). Header comment records the mapping.

### 3.4 Rejected alternatives

- **Shape A (v1: host latch + anchorless `rewound` replay on follow):** rejected at plan review —
  it deterministically re-announces a resuming client's own swap (the resume-before-follow
  invariant, `chatAdapter.ts:94-100`) and its client handler destroys correctly-drained live
  state on every attach to a once-swapped host (review F1/F2). Patching it (swap-epoch
  correlation + ordered-transaction frame buffering) would have built exactly the multi-site
  special-case calculus the round's convergence rule exists to prevent.
- **Shape B (follow-then-read attach reorder):** structurally the same insight as v2 (the window
  is the client's read-before-follow), but it moves `initialEntries` off the `<Static>`
  mount-seeding path — the TUI's most historically breakage-prone seam — and bl6 explicitly
  rejected gating first paint on the follow ack (spec :88-90). v2's reconcile keeps the immediate
  paint AND closes the window post-hoc.
- **Shape C (log-only):** rejected — the defect is real, permanent-per-attach, and the fix is
  bounded to one client-side reconcile.
- **Replaying the last live `rewound` payload verbatim:** rejected with Shape A — a stale anchor
  truncates post-rewind history; `cleared` clobbers a re-populated id.

## 4. T-POLISH design

- **(a) Transcript-gate simplification (D10, D12):** at `toolRenderer.tsx:1146`
  (`labeledHookItems`) and `:1207` (`hookLiveItems`), `options.projection !== "compact" ||
  options.verbose === true` becomes `options.projection !== "compact"`. The deleted disjunct is
  replaced by a comment recording R2's rule: canon gates these extras on transcript mode strictly;
  a future inline verbose toggle must feed fold/unfold, NEVER this predicate. Pure-builder tests
  that pin the `compact + verbose:true` combination pin a canon-unrepresentable state: they are
  narrowed/removed with **controller adjudication recorded here** (the bl8 lesson — pinned
  absences/latencies are adjudicated by the controller, never edited unilaterally by a fixer).
  The tracker's "D21-true branch is latent" entry retires at close-out.
- **(b) Advisor display name (D11):** `render.ts` imports `advisorDisplayName` from
  `./advisorModel.js`; the model clause becomes ` using ${advisorDisplayName(advisor.model)}`.
  Known aliases/ids render canon display names ("Opus 4.8"); unknown/custom ids pass through
  verbatim (the helper's fallback — canon-faithful, `cs()` behaves likewise). The D15 doc comment
  at `render.ts:221-223` is rewritten: divergence retired, rationale, date. Any test pinning the
  verbatim form updates — that is the point of the change.
- **(c) Duration-merge citation (D8-bl9):** `toolFold.ts:325-326`'s comment gains the bl9
  re-verification: per-pair SUM matches canon's item-level merge verbatim (@162920074); the
  message-level `Math.max` divergence is bl7 D8, still standing, rationale unchanged (ccx has
  per-pair arrival deltas, no batch wall-clock). No behavior change.

## 5. Acceptance

- **A1 (reconcile, red-first):** tui-harness — a session seeded from a stale disk stamp whose
  post-follow re-read differs: the document is rebuilt to the fresh rows under the unchanged
  session id (red on current main: no reconcile exists). A session whose re-read matches the
  stamp repaints nothing (no `clearScreen`, document identity preserved).
- **A2 (live-state preservation — v3 form):** the mismatch rebuild leaves the task panel intact
  (D16 pin), and ANY live activity that could seed non-re-derivable state — a drained content
  row, a mount-effect mutation, a frame landing during the pending read (hook_started,
  task_notification, a parked decision), a document swap — ABORTS the rebuild instead
  (regression-pinned per class in `attach-reconcile.test.tsx`). The no-content mid-turn attach
  (turn:start drained, nothing else) still rebuilds. The content-bearing mid-turn attach keeps
  its stale prefix — the recorded limitation in §3.1.
- **A3 (settled-park guard):** a park settled pre-follow appears in neither the replayed
  `decision` set nor as any `decision_settled` frame (integration, real server/socket path).
- **A4 (self-resume silence):** a client built with `opts.resume` reconciles to a no-op — the
  resume-before-follow invariant and its existing adapter pin stay untouched (review F1's
  scenario, pinned).
- **A5 (no-stamp skip):** a fresh session with no disk stamp never runs the reconcile read.
- **A6 (transcript gate):** per-hook detail lines and the live counter render iff
  `projection !== "compact"`; a `verbose: true` + compact projection renders neither (the
  formerly-latent branch is gone, not activated). POSITIVE coverage is preserved for BOTH
  builders: `hookLiveItems` gains a detail-projection + `verbose: false` case asserting the
  exact counter text and `preStyled` segment (review F3 — the deleted compact+verbose case was
  its only positive test), and `labeledHookItems`' existing detail cases stay green.
- **A7 (display name):** the Advising row renders ` using Opus 4.8`-style display names for
  catalog ids/aliases and verbatim text for unknown ids; segments keep bold-"Advising" +
  dim-clause shape.
- **A8 (fake-host discipline, red-first):** the extracted buffering policy has direct unit
  coverage — pre-follow `task`/`decision_settled`/`rewound` pushes are NOT replayed to a late
  follower; `message` (and documented `turn`) still are. Red before the narrowing (the current
  drain replays every kind — review F4).
- **A9 (battery):** full standing battery green at merge gates: `npm run typecheck`, unit, tui,
  build, plus the three pty matrices (`hookblock-cells.sh`, `cluster-expand-cells.sh`,
  `linkopen-cells.sh`) — T-POLISH touches hook-row rendering and T-FOLLOW touches fake-host, so
  the cells are the regression net even though no new cell is added.

## 6. Tickets and landing order

Two worktrees, disjoint files, parallel execution; merge T-FOLLOW first (larger), then T-POLISH.

- **T-FOLLOW** (`bl9-t-follow`): host.ts, wire.ts, useChat.ts (test pin), fleetEngine.ts,
  scripts/fake-host.mjs, tests. ~5 tasks.
- **T-POLISH** (`bl9-t-polish`): toolRenderer.tsx, render.ts, toolFold.ts (comment), tests.
  ~3 tasks + verification.

## 7. Decision Log

- **D1 (round reshape):** T-VERBOSE killed by R2; its residue (the deletion) folds into T-POLISH.
  Rejected: building fold+verbose extras (canon-unrepresentable); deferring the deletion (leaves
  code asserting a false premise about canon).
- **D2-D5 (v1, SUPERSEDED by D14):** the host-latch + anchorless-replay + wire-stamp +
  fleetEngine-ignore quartet. Killed at plan review — see §3's v2 note and D14. Kept here because
  the anchorless-payload reasoning (D2) remains the correct analysis of WHY a verbatim replay can
  never be right, and it constrains any future revival of a host-side shape.
- **D6 (refuted halves pinned):** settled-park guard test; `task` between-turns residue recorded,
  not fixed. Rejected: buffering `task` frames (double-delivery to every late joiner and to
  `fanFrame` — R1 §2.3).
- **D7 (fake-host):** drain narrowed to production semantics (`message` + documented `turn`;
  `task`/`decision_settled`/`rewound` dropped), policy extracted for direct red-first unit tests
  (review F4). Rejected: full-fidelity synthesis (over-building a test stand-in); document-only
  (leaves the false-green trap armed for the next cell author).
- **D8-bl9 (duration merge):** comment re-citation only; bl7 D8 divergence stands. Rejected:
  switching message-level to `Math.max` (no batch wall-clock exists to max over).
- **D10 (gate simplification):** delete `|| verbose` at the two sites; canon-unrepresentable
  pinned states removed with controller adjudication. Rejected: keeping the disjunct "for safety"
  (it encodes a refuted premise and invites exactly the activation mistake R2 killed).
- **D11 (D15 retirement):** display name via `advisorDisplayName`, unknown-id passthrough.
  Rejected: hardcoding the four display names in render.ts (duplicates the catalog module).
- **D12 (carried risk):** recorded at the D10 deletion sites and here: a future inline verbose
  toggle separate from the detail projection feeds the fold/unfold decision, never the
  per-hook-detail predicate — they are two different flags in canon.
- **D13 (tech-debt routing):** `toolRenderer.tsx:870` comment-accuracy re-check → tech-debt
  tracker (zero-behavior, needs bounded binary research; R2's flag may itself be a conflation of
  `Ce` with `Gc`).
- **D14 (v2 redesign — reconcile at the seam):** the attach staleness window is created by the
  client's read-disk-before-follow; the fix is a one-shot post-follow reconcile in `useChat`
  (disk stamp from `prepareAttach`, re-read via `deps.getSessionMessages`, narrow rebuild on
  mismatch only). Chosen over: patching Shape A with swap-epoch correlation + ordered-transaction
  frame buffering (a multi-site special-case calculus growing corners — review F1/F2 both trace
  to one root, and the reconcile dissolves both); Shape B's mount reorder (Static-seeding risk).
- **D15-bl9 (stamp shape):** `{ lastUuid, count }` over persisted rows — cheap, order-sensitive,
  and computed identically by `prepareAttach` and the reconcile. Rejected: full uuid-list compare
  (allocation for no added discrimination on append-only-or-truncated files); mtime (probe-known
  to be unreliable across the store's write patterns).
- **D16-bl9 (narrow rebuild):** the mismatch path replaces the document and reseeds
  `lastAssistant` but never touches the task panel, bg-harvest, or composer prefill — those
  belong to the follow drain's live frames. Rejected: reusing `rebuildAfterRewind` whole (review
  F2's exact loss scenario).
- **D17-bl9 (wave 3, TRIPWIRE-MANDATED replacement — virgin-window reconcile):** after waves 1-2
  each patched a corner of the wholesale-replacement design (deferral; local-row carry-over +
  title refetch) and the wave-2 review returned refinements OF THOSE PATCHES, the pre-committed
  rule fired: the reconcile became a mount-time correction that runs only against a virgin
  document, DELETING the deferral, carry-over, and title-refetch machinery (net −10 lines).
  Rejected: a diff-converge document primitive (non-destructive entry-level reconcile — correct
  in principle, but a new document-engine calculus with its own corner surface, the exact
  machinery growth the tripwire exists to stop); continuing to patch (the cascade).
- **D18-bl9 (wave 4 — virginity measured, not approximated):** wave 3's `turn-started` +
  entry-count conditions were an over-approximation with a real snapshot-timing bug (captured
  after mount effects). Replaced by `TranscriptDocument.revision()` snapshotted at render time
  (+ the kept gen guard), which RESTORED the no-content mid-turn attach case the
  over-approximation needlessly aborted. Rejected: keeping turn-started "for safety" (it encoded
  no invariant the revision check doesn't).
- **D19-bl9 (wave 5 — non-document live state):** deleting turn-started reopened a loss class
  for state living OUTSIDE the document (hook-pair stamps, agent meta, parked decisions —
  verified live; streaming proved self-healing via the surviving LiveTurn accumulator). Guarded
  by ONE `liveActivitySeq` counter bumped per non-replay frame at the subscription choke points,
  captured at read start. Rejected: per-frame-kind destructive/harmless classification (an
  enumerated allowlist that silently rots as frame kinds evolve); state preservation/reapply
  (the cascade again).
- **D20-bl9 (convergence — the logged residue):** the wave-5 review's sole finding (state-only
  frames inside the read window abort a harmless rebuild → timing-dependent staleness) is REAL
  and deliberately NOT fixed: it fails in the safe direction of the governing bias (abort loses
  bounded staleness; a wrong rebuild loses content), and its only fix is the D19-rejected
  allowlist. Logged in the tech-debt tracker with that framing; per the pre-committed rule, a
  wave producing only logged debt is the convergence signal.

## 8. Surprises & Discoveries

- (research) The "~36 ms window" in the bl6 backlog entry was borrowed from a *different* bl6
  measurement (the refuted first-frame-drop premise); the real exposure is the read-disk→follow
  interval including the React/Ink dynamic import — hundreds of ms, damage permanent.
- (research) Two of three named frame kinds needed no fix because replay here is state-derived:
  every frame kind with a state home (`parked.list()`, buffered `message`, `replayFlagState`)
  survives attach for free; `rewound` is the only pure transition signal with no state residue.
- (research) The D21 "latent branch" was never latent — it was redundant: `verbose ⇒ !compact` at
  every producing caller, and canon has no state where the disjunct could matter.
- (research) bl7's spec had already specified the advisor display name; D15's verbatim form was
  scaffolding for a missing module, not a design choice.
- (plan review) The gate paid for the sixth consecutive round, and for the first time it killed a
  whole design shape rather than a task detail: v1's host-side replay would have deterministically
  broken the documented resume-before-follow invariant (`chatAdapter.ts:94-100`) and destroyed
  drained live state on every attach to a once-swapped host. Both highs traced to one root — the
  replay put the announcement on the wrong side of the seam that creates the window — and the v2
  reconcile dissolved them instead of patching them (the convergence rule applied at DESIGN time,
  before any wave existed).

## 9. Outcomes & Retrospective

**Shipped (2026-08-31, all local, NOT pushed).** T-FOLLOW merged as `1fdbfb3cb6`, T-POLISH as
`4e3494927f`, fix waves through `6de846da7b`. Final battery on the converged tree: typecheck,
unit 4341/4341 (no flake), tui 4902 + 11 skips, build, pty matrices 4/4 + 1/1 + 3/3, round-seam
spot-check 79/79 — all green.

**What the round delivered.**
- The attach staleness defect (the only real survivor of the three bl6-carried premises) is
  closed for every attach the client can safely correct: a virgin-mount mismatch rebuilds to
  post-rewind disk under the "resynced" divider; every unsafe case aborts by measurement, never
  by frame-kind guesswork. The refuted `decision_settled`/`task` halves are pinned by guard
  tests so the false premise cannot be "fixed" back in; the fake-host stand-in can no longer
  false-green the frame kinds production drops.
- The D21 "latent branch" is gone rather than activated — the code now states canon's actual
  rule (transcript surface strictly), with the carried risk (a future inline verbose toggle
  feeds fold/unfold, never the extras gate) recorded at the deletion sites.
- The Advising row prints canon display names; D15 is retired with its original intent restored.

**Process retrospective.**
- The plan-review gate paid for the sixth consecutive round and, for the first time, killed a
  whole design shape before code existed (v1's host-side replay — two confirmed highs).
- The fix-wave loop ran five waves; the pre-committed tripwire fired after wave 2 exactly as
  designed and the wave-3 replacement HELD: waves 4-5 never changed the invariant, only the
  measurement of "virgin," each a counter-shaped deletion-or-tightening fixing its
  predecessor's regression, and the loop converged on a logged, safe-direction residue. Compare
  bl8: same tripwire, but bl9's post-replacement waves were strictly narrowing — evidence the
  replace-don't-patch rule produces stable designs, not just shorter loops.
- Mid-round, a concurrent session rebased main under the round (~8.7k insertions of unrelated
  work). The transplant recipe (`git rebase --onto <newmain> <oldbase> <branch>` — never a plain
  rebase, which replays patch-id-mismatched history) moved both ticket branches cleanly;
  cross-session coordination messages prevented a second rewrite mid-merge. Total cost: minutes.
- Two subagents stalled ending turns in background-wait states despite "foreground only"
  instructions; the working nudge is "read the finished run's log directly — no notification is
  coming." Dispatch prompts now carry that line preemptively.

## 10. Logged residue (tech-debt tracker entries, this round)

- Content-bearing mid-turn attach keeps its stale prefix per mount (D17/D19 limitation).
- State-only frames inside the pending-read window abort a harmless rebuild (D20).
- fake-host policy table documents 5/8 HostEvent kinds (the other 3 have no producer).
- A2's bg-harvest sub-clause is inspection-verified, not test-pinned.

## Revision Notes

- v1 (2026-08-31): authored after R1/R2/R3 with all verdicts in; scope confirmed by the user's
  "Let's proceed" on the bl8 close-out candidate list.
- v2 (2026-08-31, plan review): T-FOLLOW redesigned from host-side `rewound` replay (Shape A) to
  the client-side post-follow reconcile (D14-D16), dissolving review highs F1/F2; A1-A5 rewritten
  to the reconcile claims; A6 gains the positive `hookLiveItems` detail-projection case (F3); A8
  becomes red-first via an extracted fake-host buffering policy (F4); both plans' final tasks now
  run all three pty matrices (F5). All five review findings accepted after code verification.
- v3 (2026-08-31, close-out): §3.1 and A2 amended to the shipped wave-3/4/5 virgin-window
  semantics (D17-D20-bl9); the mid-turn limitation recorded; §9 retrospective + §10 logged
  residue written. The wave chain and every adjudication live in the round ledger
  (`.doperpowers/sdd/2026-08-31-bl9-round/round.md`) and `fixwave-report.md`.
