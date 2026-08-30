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

## 3. T-FOLLOW design

### 3.1 The replayed frame (D2, D3, D4)

`SessionHost` gains a private `swapped = false`, set to `true` at exactly the site that pushes the
live `rewound` frame in `swapEngine` (`host.ts:659`) — so the replay fires iff at least one live
`rewound` was ever emitted (never on initial engine start). In `follow()`, after the buffered
message replay and **before** the closing fresh `state` frame, when `swapped` is true deliver:

```ts
{ kind: "rewound", ...(sessionId !== undefined ? { sessionId } : {}), replay: true }
```

- **Anchorless is load-bearing:** no `prevUuid` (a late joiner's disk read cannot race the
  truncation, and turns may legitimately exist after the rewind — replaying a stale anchor would
  truncate real history) and no `cleared` (it forces `sessionId = undefined` in
  `chatAdapter.ts:65`, wrong if a later resume re-populated it). A bare `rewound` sends `useChat`
  through `rebuildAfterRewind({})` — a plain full re-read under the current id: exactly what a
  stale joiner needs, a harmless no-op for a current one.
- `sessionId` is the host's **current** id when defined (never the id captured at swap time).
- **Wire change (additive):** `wire.ts` declares `replay?: true` on the `rewound` variant (today
  it is declared only on `message`). Doc comment states the replay semantics above.

### 3.2 Consumers (D5)

- **REPL:** `useChat`'s `rewound` arm already routes to `rebuildAfterRewind`; the `selfRewind`
  suppression cannot swallow the replayed frame (an attaching client has no local op in flight —
  R1 risk (a)). A test pins the bare-frame rebuild path.
- **App server:** `fleetEngine`'s `rewound` arm (`fleetEngine.ts:288`) IGNORES a frame stamped
  `replay: true`. The app server has no window of its own (it follows-then-serves,
  `fleetEngine.ts:274/349`), so a replayed frame on adoption would only fan a spurious
  `thread/rewound` broadcast.

### 3.3 Pinning the refuted halves (D6) and the test stand-in (D7)

- **Guard test:** on a host with a park settled before follow, the joiner receives the park in
  neither the replayed `decision` list nor as any `decision_settled` frame — so a future author
  cannot "fix" the refuted half into a double-settle.
- **fake-host (`scripts/fake-host.mjs`):** its pre-follow drain is kind-agnostic (strictly more
  generous than production — a cell pushing `task`/`decision_settled` pre-follow would false-green
  against it). Narrow the drain to production semantics: buffer/replay `message` frames; keep
  `turn` replay as a DOCUMENTED divergence (production synthesizes an equivalent start frame —
  observably equivalent for cells); drop `task`/`decision_settled` from the drain; a pre-follow
  `rewound` replays anchorless with `replay: true` (matching post-fix production). Header comment
  records the mapping. The divergence is latent today (`framesFor` emits only `message`/`turn`),
  so no existing cell changes behavior.

### 3.4 Rejected alternatives

- **Shape B (follow-then-read attach reorder):** structurally superior — it removes the window
  instead of replaying into it, matching the app server — but it moves `initialEntries` off the
  `<Static>` mount-seeding path, the TUI's most historically breakage-prone seam, and bl6
  explicitly rejected gating first paint on the follow ack (spec :88-90). Recorded as the
  preferred shape IF the Static seeding path is ever reworked for other reasons.
- **Shape C (log-only):** rejected — the defect is real, permanent-per-attach, and the fix is
  bounded retention + one replay site.
- **Replaying the last live `rewound` payload verbatim:** rejected — see anchorless rationale.

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

- **A1 (follow replay, red-first):** unit `test/unit/host-follow.test.ts` — drive a rewind on a
  fake-session host, then `follow()`: replayed frames include exactly one `rewound` with
  `replay: true`, no `prevUuid`, no `cleared` (even though the live swap carried an anchor),
  delivered before the closing `state`. A never-swapped host replays no `rewound`. Red on current
  main (R1 ran it: `REPLAYED KINDS: ["state"]`).
- **A2 (attach integration):** `test/integration/host-client.test.ts` — rewind the host after a
  first client connected, then attach a second client through the real server/socket path: its
  follow drain delivers the anchorless `replay`-stamped `rewound`. (The document-level rebuild is
  A4's tui-harness claim — the integration client is wire-level and holds no document.)
- **A3 (settled-park guard):** a park settled pre-follow appears in neither the replayed
  `decision` set nor as any `decision_settled` frame.
- **A4 (bare-rewound rebuild):** `useChat` on an anchorless replayed `rewound` re-reads the
  transcript and replaces the document under the current session id; no truncation of post-rewind
  turns.
- **A5 (app server):** `fleetEngine` takes no `thread/rewound` action on a `replay`-stamped
  `rewound`; live (unstamped) frames still broadcast.
- **A6 (transcript gate):** per-hook detail lines and the live counter render iff
  `projection !== "compact"`; a `verbose: true` + compact projection renders neither (the
  formerly-latent branch is gone, not activated); both surfaces still render at detail
  projections (existing bl8 tests stay green).
- **A7 (display name):** the Advising row renders ` using Opus 4.8`-style display names for
  catalog ids/aliases and verbatim text for unknown ids; segments keep bold-"Advising" +
  dim-clause shape.
- **A8 (fake-host discipline):** fake-host pre-follow `task`/`decision_settled` pushes are NOT
  replayed to a late follower; a pre-follow `rewound` replays anchorless+stamped. (Unit-level
  check against the script's host harness in `test/integration` or the script's own test if one
  exists; otherwise pinned by the narrowed drain code + header doc.)
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
- **D2 (anchorless replay):** replayed `rewound` carries no `prevUuid`/`cleared`; current
  `sessionId` when defined. Rejected: verbatim last-payload replay (truncates post-rewind history;
  clobbers restored ids).
- **D3 (gate):** `swapped` set exactly at the live `rewound` push site. Rejected: any-swap gating
  (fires on initial start), no gate (extra disk read on every attach to any host).
- **D4 (wire):** `replay?: true` declared on the `rewound` variant; frame stamped. Rejected:
  unstamped (correct for useChat but leaves fleetEngine unable to discriminate — D5 needs it).
- **D5 (app server):** replay-stamped `rewound` ignored by fleetEngine. Rejected: broadcasting on
  adoption (spurious `thread/rewound` to every app-server client for a window it never had).
- **D6 (refuted halves pinned):** settled-park guard test; `task` between-turns residue recorded,
  not fixed. Rejected: buffering `task` frames (double-delivery to every late joiner and to
  `fanFrame` — R1 §2.3).
- **D7 (fake-host):** drain narrowed to production semantics with documented `turn` divergence.
  Rejected: full-fidelity synthesis (over-building a test stand-in); document-only (leaves the
  false-green trap armed for the next cell author).
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

## 9. Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-31): authored after R1/R2/R3 with all verdicts in; scope confirmed by the user's
  "Let's proceed" on the bl8 close-out candidate list.
