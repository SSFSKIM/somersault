# bl6 — fake-host replay-on-follow + expanded-cluster absorbed thinking (design)

**Round:** bl6 · opened 2026-08-28 · owner-approved shape (two tickets + one probe-gated stretch)
**Canon:** installed Claude Code **2.1.250** (`~/.local/share/claude/versions/2.1.250`, Mach-O arm64,
206,479,552 bytes). All byte offsets in this spec are into that binary. Canon moved 2.1.246 → 2.1.250
since bl5; both bl5 subsystems were re-verified unchanged (research §Q3).
**Evidence base:** `.doperpowers/sdd/2026-08-28-bl6-round/research-attach.md` (repo diagnosis, live
measurements, deterministic repro) and `research-cluster.md` (canon extraction, verbatim excerpts).
**On any conflict between this spec's prose and a research doc's quoted canon excerpt, the excerpt
wins** (bl5 lesson: implementers caught two spec-prose errors that way).

## 1. Purpose

Two defects with evidence in hand, one per ticket:

- **T-ATTACH** — the bl5 pty drivers work around a first-frame drop after `ccx attach` with a
  sentinel-retry loop (`warmup_follow`). Research proved the drop is a **test-infrastructure defect,
  not a production bug**: the real host replays its turn buffer on follow before registering the
  follower (`src/host/host.ts:730-772`, synchronous, no gap), while the stand-in host
  `harness/scripts/fake-host.mjs` pushes stdin-driven frames into a `followers` set that is empty
  until the `follow` op lands, with no buffer (`fake-host.mjs:119-126` vs the race-free-by-construction
  `FAKE_HOST_SCRIPT` path `:161-165`). Fix the stand-in to honor the same contract; delete the
  workaround so pty cells exercise the true first push.
- **T-CLUSTER** — bl2's replacement ticket, now grounded in 2.1.250: canon's expanded tool cluster
  renders absorbed **thinking blocks** interleaved with the member tool rows in transcript order
  (expansion branch at offsets 177043425–177044786), while ccx's `expandedMemberItems`
  (`src/tui/toolRenderer.tsx:963`) walks `group.memberIds` only — a cluster that absorbed thinking
  shows "Thought for Ns" collapsed and then *nothing* when opened. Retain the absorbed thinking
  bodies in the fold model and render them canon-faithfully on expansion.

## 2. T-ATTACH contract

### 2.1 `fake-host.mjs` replay-on-follow (the fix)

The stdin push path buffers while no follower is registered and the first `follow` drains the buffer
**before** registering, frames marked `replay: true` — the same order the real host
(`host.ts:730-772`) and the app-server subscribe (`src/appserver/subscribe.ts:92-140`) already use.
Concretely:

- A module-level `preFollowBuffer: ev[]`. The stdin fan-out (`:124`) becomes: if `followers.size === 0`,
  push each `ev` into the buffer; else fan out as today.
- In the `follow` handler, after `send(base)`: drain `preFollowBuffer` through `pushEvent` with
  `replay: true` stamped on each drained event, clear the buffer, THEN `followers.add(pushEvent)`,
  then the existing `FAKE_HOST_SCRIPT` scheduling. Drain-before-register is the real host's documented
  invariant (`host.ts:770` adds the follower LAST); with a single socket the observable difference is
  nil, but keep the invariant.
- Only the FIRST follow drains (the existing `following` latch already scopes the script push; scope
  the drain the same way). Frames pushed after any follower exists are live, unmarked.
- `replay: true` marking is safe: no pty script asserts on replay marks or arrival-clock durations
  (grepped `scripts/*.sh` — zero hits for replay/timing), and `useChat.ts` uses the mark only to
  suppress arrival-clock stamping, which is faithful.

### 2.2 Integration test (the seam)

A sibling case in `test/integration/host-client.test.ts`, honoring fake-host's REAL process contract
(plan-review finding 1: the script takes NO positional socket argument): spawn
`node scripts/fake-host.mjs` with an ISOLATED `CCX_FLEET_ROOT` (fresh mkdtemp), parse the socket path
from the `SOCKET=` line it prints on stdout, and assert the child stays alive. The script imports
`../dist/fleet/*.js`, so the case is guarded with the repo's loud-skip pattern
(`describe.skipIf(!existsSync(<harness>/dist/fleet/paths.js))` with reason "run npm run build
first") and the task's steps mandate a build so the red-green run is real. Sequence: write one push
word to fake-host stdin BEFORE any client exists → connect `remoteChatSession` → await the adapter's
ready seam → THEN subscribe `onSessionEvent` (subscribing after ready exercises the adapter backlog
exactly as real attach does) → assert the pushed frame arrives with `replay: true`. The research
agent left a deterministic throwaway of the mechanism at
`$CLAUDE_JOB_DIR/tmp/bl6attach/node-repro.mjs` — consult for wire shapes, but the committed test goes
through the repo's real client seam. Red against unmodified `fake-host.mjs`, green after §2.1.

### 2.3 Driver cleanup (the acceptance)

- Delete `warmup_follow` and its three call sites from `scripts/linkopen-cells.sh`; the `self-open`,
  `fold-link`, `hover-suppress` cells push their real content as the first-ever push.
- Keep the `mode on` readiness waits: all three cells send mouse bytes and genuinely need a painted
  frame to compute columns against (research open question 1, resolved: waits stay wherever a click
  follows).
- Acceptance: all three cells PASS without the sentinel, run ≥3 times including under CPU load
  (the research repro's `LOAD=10` trick), so a pass is not a won coin flip.
- The research doc claims `scripts/select-pty.sh`'s stream-shift cell "silently tolerates a
  possibly-dropped first frame" — a grep for the cited token found nothing; the implementer should
  locate what (if anything) that refers to and remove the tolerance only if it exists. Not acceptance-
  gating.

### 2.4 Explicitly out of scope (recorded)

- **Production `rewound`/`decision_settled`/`task` frames are not replayed on follow** — a real but
  narrow host-side gap (a rewind landing inside the ~36 ms connect→follow window leaves a joining
  client rendering a truncated-away transcript). Research §Latent scope. **Backlog ticket, not bl6.**
- **A machine-readable follow-established signal from `ccx attach`** (research Fix 2) — driver
  ergonomics, backlog. Gating first paint on the follow ack is explicitly rejected (UX regression:
  a wedged host would hold attach on a blank screen; the current paint-first ordering is deliberate).
- Sequence-numbered wire catch-up (research Fix 3) — rejected at this scope: a wire-protocol change
  with skew consequences to fix a test script.

## 3. T-CLUSTER contract

### 3.1 What canon does (2.1.250, research §Q1 — excerpts govern)

The expansion branch (`cv`, branch at 177043425–177044786) **replaces** the collapsed row entirely
and renders, in fixed order: (a) absorbed `<task-notification>` user rows; (b) absorbed thinking
blocks AND member tool rows **interleaved in transcript (message) order** — they come from one list;
(c) a PreToolUse hook block; (d) relevant-memory blocks. An absorbed thinking block renders as a row:
`∴` gutter (`Box minWidth:2`, `Text dim italic`, aria-label "thinking:") + the **full multi-line
thinking body as dim markdown** (not italic), wrapped in a `marginTop:1` box — **no duration clause**
(the `thoughtForMs` clock is spoken only by the collapsed summary row; rendering it expanded would be
a divergence, research open question 4).

Membership (canon segmenter `v2n`, 162017418): a thinking block joins the currently-open run purely
by **adjacency**, unless it is a *signed* thinking block accepted by canon's predicate, which flushes
the run and renders standalone.

### 3.2 What bl6 builds

1. **Retention.** `FoldGroup` (via the fold pipeline in `src/tui/toolFold.ts`) retains each absorbed
   thinking block's **raw full text + its sequence position** (and a stable key), alongside the
   existing collapsed-row fields (`thoughtForMs`, `latestThinkingSummary` — both unchanged; the
   neutral atom's `thinkingSummary` is whitespace-collapsed and cannot serve as the body). ccx's
   *existing* absorption rule (which thinking joins which cluster) is **kept as-is** — this ticket
   changes what a group remembers and renders, not membership. **Two hard sub-requirements
   (plan-review finding 2):** (i) the body rides the fold INDEPENDENTLY of the live thought-clock —
   today `segmentRuns`' PRE-RUN `pending` accumulator (`toolFold.ts:452,556`) accrues a leading
   neutral only when `thoughtForMs > 0`, and replay/attach entries never have a clock, so `pending`
   must also carry bodies (`{key, messageSequence, body}[]`) whenever the atom bears one, transferred
   into the run when the first collapsible tool opens it (a breaker still clears `pending` — bodies
   die with the run exactly as the clock does); (ii) at least one retention test drives the REAL
   production pipeline (a `TranscriptDocument` through `projectCompact`/`projectPending`) with a
   leading thinking entry, NO `thoughtMs` map entry, a tool + result, and a breaker — a test that
   constructs `FoldAtom`s by hand can pass while `buildAnchoredEntries`/`foldAtoms` never carry the
   body. If plan-time reading shows ccx's
   membership materially diverges from canon's adjacency rule, that is a Surprises entry and a
   follow-up ticket, not silent scope growth.
2. **Expansion rendering.** `expandedMemberItems` (or a successor seam) interleaves the retained
   thinking rows with the member tool rows **by message sequence** — NOT by `memberIds` order, which
   reorders as members settle (research §1.6 interleaving note). The ordering is TOTAL: a member
   row's key is its `callSequence`, a thinking row's its `messageSequence`, and on EQUAL keys
   thinking precedes members and members keep extraction order (a deterministic tie-break; measured
   against the 12 most recent real session transcripts, equal-key collisions cannot currently occur —
   0 combined `[thinking, tool_use]` entries in 13,781 thinking entries — so this is robustness, not
   parity; see D12). Thinking row shape per §3.1: `∴`
   gutter + full body as dim markdown, `marginTop:1` spacing, no duration. Reuse ccx's existing
   thinking renderer in its transcript-mode/verbose form if one exists; else a minimal local row.
3. **No change** to the collapsed row, to the replace-not-append expansion shape (ccx already
   matches), or to `thoughtForMs`/summary behavior.

### 3.3 Recorded, not built (probe-gated or out of reach)

- **(a) `<task-notification>` absorption** — canon does it only on the focus-mode second pass
  (`T2n`, gated `Mt()`); ccx has no focus mode. Out of reach on our default path; recorded.
- **(c) PreToolUse hook block + (d) relevant memories** — canon absorbs `system/stop_hook_summary`
  (PreToolUse-labeled only) and `relevant_memories` attachments from the CLI's own stream. Whether
  the Agent SDK surfaces either to a headless consumer is UNVERIFIED (research open question 1), and
  prior evidence leans no for hooks ("hooks execute invisibly", F3). **Live probes are required
  before building — and the weekly usage cap is exhausted until Aug 31**, so these are deferred out
  of bl6's build scope: probe when the cap resets, ticket then if reachable. Building the renderer
  arms against fixtures without reachability proof is rejected (declared ≠ reachable discipline).
- **D8 stretch — `goal_status` + advisor clickable rows**: canon-STABLE (predicate `isItemClickable`
  177230933 byte-identical across 2.1.247/248/250; a click is a pure in-place expand toggle, never an
  opener), but both depend on stream content kinds (`goal_status` attachments,
  `advisor_tool_result` blocks) the SDK may never produce headlessly. Same gate: probe after Aug 31,
  build only what is reachable. The third D8 kind, `collapsed_read_search` click, is ALREADY SHIPPED
  (tool-stream wave) and is the entry point to §3.2's expansion. A fourth clickable kind the research
  surfaced (truncated tool results via `isResultTruncated`) shipped in bl4 T-CLICKGATE.

## 4. Acceptance (observable behavior)

All commands from `CC-to-SDK/harness/`. Gates: `npm run typecheck`, `npm run test:unit`,
`npm run test:tui` (NEVER bare `npm test`).

- **A1 (T-ATTACH seam):** the new integration case fails against unmodified `fake-host.mjs` (frame
  lost) and passes with §2.1 (frame arrives, `replay: true`). Evidence: red run recorded in the task
  report before the fix commit; green in the suite after.
- **A2 (T-ATTACH acceptance):** `bash scripts/linkopen-cells.sh` (keyless; drives the REAL `ccx`
  binary under tmux) passes all three cells with `warmup_follow` deleted, ≥3 consecutive runs, at
  least one under load. Evidence file in the round ledger dir.
- **A3 (T-CLUSTER unit):** a fold-pipeline test drives a synthetic stream (tool → thinking → tool in
  one cluster) and asserts the group retains the thinking body + sequence; a renderer test asserts
  the expanded output interleaves rows in message order with the `∴`-gutter dim-markdown shape and NO
  duration text; a mutation of the ordering (memberIds order) must fail the test.
- **A4 (T-CLUSTER pty):** a pty cell (fake-host driven, reusing the linkopen driver recipe) expands a
  cluster that absorbed thinking and asserts the thinking body is visible between the right members;
  collapse restores the summary row. This cell must push its first frame with NO sentinel — riding on
  T-ATTACH's fix (merge-order dependency: T-ATTACH merges first).
- **A5 (whole-tree):** typecheck clean, unit + tui suites green on the assembled main after each
  merge.

## 5. Ticket/plan structure

Two plans, two worktrees, sequential merges (T-ATTACH first — A4 depends on it):

- **T-ATTACH** (~2 tasks): (1) replay-on-follow in `fake-host.mjs` + the red-green integration case;
  (2) `warmup_follow` deletion + pty acceptance evidence (+ the §2.3 select-pty tolerance check).
- **T-CLUSTER** (~3-4 tasks): (1) fold-model retention (types + segmenter) with unit coverage;
  (2) expansion interleave + thinking row rendering with unit/component coverage; (3) pty acceptance
  cell; (4) verification (spec acceptance as written).

Same execution machinery as bl4/bl5: sonnet implementers/reviewers, per-task review with ≥2 self-run
mutation checks, fix waves re-reviewed by the original reviewer, whole-round codex review
(`gpt-5.6-sol`) after both merges, scoped re-review to zero.

## 6. Decision Log

- **D1 — T-ATTACH is Fix 1 (fake-host replay), not Fix 2 (readiness signal) or Fix 3 (wire seq/catch-up).**
  The production transport already implements and pins the correct handshake; the only lossy component
  is the stand-in. Fix 2 adds production surface for a test need (backlogged); Fix 3 is a wire change
  with skew costs to fix a test script (rejected). Research §Candidate fixes.
- **D2 — replayed fake-host frames carry `replay: true`.** Faithful to the real host; verified no
  cell asserts on the marks or on arrival-clock timing.
- **D3 — `mode on` waits stay in the drivers.** All current first-push cells click afterwards and
  need painted geometry. Cells that only assert content MAY drop the wait later; not this round.
- **D4 — expanded thinking rows carry NO duration.** Canon speaks `thoughtForMs` only in the
  collapsed row. Alternative (append "thought for Ns") rejected as a divergence.
- **D5 — interleave by message sequence, not `memberIds`.** `memberIds` reorders as members settle;
  canon's order is transcript order of the absorbed assistant messages.
- **D6 — keep ccx's existing thinking-membership rule.** The ticket is retention + rendering;
  membership parity (canon's adjacency + signed-thinking flush) is checked at plan time and any
  divergence is recorded, not silently rebuilt.
- **D7 — hook block, relevant memories, `goal_status`, advisor: probe-gated, deferred past bl6.**
  Reachability unverified and unprobeable until the weekly cap resets Aug 31; building unreachable
  arms is rejected by standing discipline. `<task-notification>` absorption is focus-mode-only in
  canon and out of reach entirely.
- **D8 — T-ATTACH merges before T-CLUSTER.** A4's pty cell relies on sentinel-free first push.
- **D10 — plan-review finding 1 ACCEPTED.** The T-ATTACH integration test contract was wrong
  (invented positional socket arg; ignored the `SOCKET=`/`CCX_FLEET_ROOT`/dist contract). §2.2
  rewritten; red would have been a setup failure, green impossible.
- **D11 — plan-review finding 2 ACCEPTED.** Clock-independent body retention through the pre-run
  `pending` accumulator + a mandatory production-pipeline test. Without it every planned fixture
  passes while a resumed/attached cluster still expands to nothing — the exact tests-pass-wiring-dead
  failure mode of the two prior rounds.
- **D12 — plan-review finding 3 PARTIALLY ACCEPTED.** Its premise ("common persisted
  `[thinking, tool_use]` combined entries") is refuted by measurement (0/13,781 across the 12 most
  recent real transcripts — Claude Code persists one content block per line). The proposed ordinal
  machinery is REJECTED; a free deterministic equal-key tie-break (thinking first) is adopted as
  robustness.
- **D9 — production follow() replay gap for `rewound`/`decision_settled`/`task` frames: backlog
  ticket, not bl6.** Narrow window (~36 ms), orthogonal to both tickets.

## 7. Surprises & Discoveries

- **The parked item's premise was wrong AGAIN** (bl5 pattern, second consecutive round): "ccx attach
  drops the first frame" — the production transport is airtight by construction; the drop lives in
  the test stand-in. Measured: the drivers' `mode on` readiness signal painted 31 ms BEFORE the
  follow op under load; the sentinel workaround was polling until it won a coin flip.
- Canon corrections vs bl2's stale cites: the absorbed-user-row tag is `<task-notification>` (const
  `al`, 153760207), not `<TS…`; expansion REPLACES the collapsed row (ccx already matches); and
  `<task-notification>` absorption is focus-mode-only, unreachable on the default path.
- 2.1.250 regression sweep: bl5's link-gate and sniffer are byte-identical (allowlist, `Cv=500`,
  `WarpTerminal`/ghostty term, `tI` sniffer incl. the `?? "image/png"` wrappers). Canon churn between
  2.1.247→248→250 renamed identifiers but not shapes.

## 8. Outcomes & Retrospective

Round closed 2026-08-29. Both tickets shipped and merged (`1f78cd9c5c` T-ATTACH, `6350a6d2cd`
T-CLUSTER); assembled-tree gates green after each merge (typecheck clean, unit 4015/4015, tui
4716/4727 with 11 gated skips, both pty matrices re-run PASS). External campaign: pre-execution
plan review 3 high findings (2 accepted, 1 premise-refuted by measurement — D10-D12) → whole-round
review **ZERO findings on the first pass**, no fix wave needed (a first for these rounds; credit
the plan-review gate catching both wiring-level holes before implementation).

What the round taught:
- **Second consecutive round where a parked item's premise was wrong** (bl5: "cross-check"; bl6:
  "production attach race"). The research phase, not the backlog title, decides the ticket's shape —
  T-ATTACH shrank from a transport fix to a six-line test-infra fix plus workaround deletion.
- The plan-review gate again caught what unit tests could not: the clock-gated `pending` hole would
  have shipped retention that silently failed on exactly the replay/attach transcripts the feature
  exists for, with every planned test green.
- A reviewer quantifying a probabilistic feature-kill (3/5 failures) is worth more than a single
  red run — adopted into the evidence bar for race-shaped fixes.
- One implementer was killed by a usage-limit outage AFTER completing its work; the worktree's git
  state + report file were the recoverable truth (its agent record was not). The review-reproduces-
  everything protocol absorbed the loss cleanly.

Minor roll-up (real, tiny, non-blocking): fake-host's "only the first follow drains" clause has no
multi-connection test (pre-existing single-connection gap, reviewer-rated informational); one
unidentified unit-suite flake on the first post-merge gate (full rerun + suspect file 2x standalone
green — consistent with the tracked imageCodec flake). Both logged here in lieu of a tech-debt file.

Deferred with evidence (unchanged from §3.3): hook block / relevant memories / task-notification
absorption / D8 goal_status + advisor — probe after the weekly cap resets Aug 31, alongside bl5's
SKIPPED-429 live cell rerun and the new signed-thinking-flush divergence note (T-CLUSTER task-4
report).

## 9. Revision Notes

- v1 (2026-08-28): authored from research-attach.md + research-cluster.md.
- v2 (2026-08-28): pre-execution adversarial plan review (gpt-5.6-sol, xhigh) returned 3 high
  findings; adjudication in D10-D12. §2.2 rewritten (fake-host process contract), §3.2(1) gains the
  clock-independent pending-state requirement + production-pipeline test, §3.2(2) gains the total
  ordering with tie-break.
