# bl8 — standalone hook rendering (T-QY) + the /advisor command (T-ADVCMD)

**v1 (2026-08-30).** Canon: installed **2.1.251** (same build family bl7 researched — all bl7 offsets
valid). SDK: `@anthropic-ai/claude-agent-sdk` **0.3.237**. Pre-round main: `7b2c943680` (bl7 close).
Evidence base: bl7 `research-hookblock.md` (§A5/A6 Qy+di verbatim, §3 Part C), bl8
`research-config-picker.md` (the /advisor transcription), `research-p119-hook-census.md` (probe
`119-hook-event-census.ts`), `research-silentrun-hooks.md` (R3). Ledger:
`.doperpowers/sdd/2026-08-30-bl8-round/round.md`.

## 0. Purpose

Finish the hook-visibility story bl7 started, and give the advisor its real control surface. After bl7,
hooks render only when absorbed into a tool cluster (expanded block + collapsed clause/line); every
unclaimed pair — non-PreToolUse events, pre-run pairs, pairs whose owner popped out — is tracked and then
silently invisible, and hooks on all-silently-absorbed runs vanish with the dropped run. Canon renders all
of those through its standalone renderer `Qy` and shows in-flight hooks via the live counter `di`. T-QY
closes that gap. Separately, bl7 shipped advisor *rendering* but the only way to turn it on is
`--advisor-model` at launch; canon's actual surface is a **`/advisor` command + dialog** (NOT a /config
row — R1 enumerated all 55 /config rows; none is advisor). T-ADVCMD clones it.

**R-XXT closes with no code.** The bl6-carried "signed-thinking flush `xxt` predicate" was already fully
decoded mid-bl7 (research-hookblock.md §3 Part C): it is `isNarrationSummaryBlock` — base64-decode the
thinking block's `signature`, walk protobuf fields 2→1→8, compare to the literal `"narration"`; memoized,
fail-closed. Not signature verification. ccx absorbs all thinking, which is exactly the fail-closed
behavior; the narration feature has never been observed on ccx's wire. **Recorded rule, not built.** If
ever revisited: dump live `signature` values, base64-decode, look for ASCII `narration`.

## 1. Wire facts this design stands on (P119, 2026-08-30)

- Settings-layer command hooks emit `system/hook_started` → `system/hook_response` pairs headlessly for
  **PreToolUse, PostToolUse, Stop, UserPromptSubmit, SessionStart** (hook_name `"<Event>:<matcher>"` or
  bare `"<Event>"`; SessionStart arrives as `"SessionStart:startup"`). **SessionEnd is dead on the wire**
  (marker-file positive control: hook ran, zero frames) — a SessionEnd row is unbuildable.
- **`hook_progress` is reachable** (P116's "never appeared" was a fast-hook sampling artifact): ~1s
  cadence for long hooks, same `hook_id` as the pair, `stdout`/`output` are **cumulative snapshots**.
- Ordering is exact: SessionStart before `init`; UserPromptSubmit between init and first assistant;
  PreToolUse right after `assistant[tool_use]`; PostToolUse right before `user[tool_result]`; Stop ~2ms
  before `result`. No unpaired starteds observed. Fast hooks close <35ms (a live row will flash).
- Frames still carry **no `tool_use_id`** and no duration — attribution stays positional (bl7 D19
  unchanged), timing stays arrival-delta.
- `advisorModel` accepts **tier aliases** ("opus" verified end-to-end). Invalid values fail **silently**
  (no error, `is_error:false`, advisor never mounts) — bl7's recorded premise that a bad pairing surfaces
  via the `Advisor unavailable (…)` row is **corrected**: client-side validation is load-bearing.
- `applyFlagSettings({advisorModel})` **works mid-session** (verified: advisor mounted and consulted on
  the following turn). Canon's own remote path sends the identical `apply_flag_settings` control request.

## 2. T-QY design — standalone hook rows + live counter

### 2.1 Tracker: retain every reachable event (`hookPairs.ts`)

`HookRunEntry` gains `event: string` (the frame's `hook_event`). `response()` retains pairs for ALL
events instead of dropping non-PreToolUse (the PreToolUse-only filter moves to the consumers: cluster
absorption stays PreToolUse-only per canon `jar`). `started()` records `{at, event}` per `hook_id` so the
live counter can count in-progress hooks by event; a new `inProgress(): ReadonlyMap<string, number>`
(event → count of started-without-response) feeds it. Return value of `response()` (the reconcile signal)
becomes true for every completed pair — any completed hook can now change what renders. `clear()`
unchanged (hooks stay live-only; standalone rows are also absent on resume/attach — same pinned
divergence as bl7 A4).

### 2.2 Standalone items in the fold (`toolFold.ts`)

New `FoldItem` kind: `{ kind: "hooks"; label: string; entries: HookInfo[]; errored: HookInfo[] }`, one
per **label group** (canon coalesces adjacent same-label summaries into one row — R1 §4(d); grouping
unclaimed entries by label inside a flush window reproduces exactly that).

`segmentRuns` already receives every entry via `options.hookRuns`; after bl7's `resolveRunHooks` claims
what the clusters absorb, the leftovers are: (a) non-PreToolUse entries — never claimable, (b) PreToolUse
entries left unclaimed (pre-run pairs, popped-out owners, empty runs). At each `flush(boundary)` the
segmenter drains every still-unclaimed entry with `afterSequence < boundary` into `kind:"hooks"` items,
grouped by label, routed through the existing `deferred` park (emitted AFTER the cluster item, mirroring
canon `Gjt` park → `C()` re-emit) when the flushing run is non-empty, straight to `out` otherwise. The
final trailing flush drains everything left. Entries consumed into a standalone item join the same
`hookClaims` set — one consumption ledger for both sinks, no double-render (bl7 F2's rule extended).

Label = the entry's `event` (`"PostToolUse"`, `"UserPromptSubmit"`, `"SessionStart"` — canon's
`hookLabel` is the event name; the matcher suffix stays in the per-hook line, not the label).

### 2.3 Rendering (`toolRenderer.tsx`) — canon `Qy`'s two shapes

**Shape 1 (labeled — every event except Stop):**
```
  ⎿  Ran 3 PostToolUse hooks
     ⎿ PostToolUse:Read (0.2s)
```
Dim, count NOT bold, **no duration on the header** (canon shape 1 has none). Per-hook lines use the same
`"     ⎿ "` gutter as bl7's expanded block and — wire divergence already established in bl7 — show
`hook_name (X.Xs)` instead of canon's command text (the wire never carries the command). Per-hook lines
gate on the bl7 D21 predicate family: `options.projection !== "compact" || options.verbose === true`
(canon gates shape 1's detail on transcript mode; ccx's transcript analogue is exactly that predicate —
D21 precedent).

**Shape 2 (Stop):** canon renders Stop summaries ONLY when there are errors / additional context / a
prevented continuation — a clean Stop run renders nothing (early exit `fc.length===0&&gc.length===0&&
!Ry&&!ur.hookLabel → null`). ccx mirrors with what the wire has: Stop entries with `exit_code === 0`
render nothing; entries with non-zero exit render
```
⏺ Ran 3 stop hooks
  ⎿  Stop hook error: <stderr-trimmed, fallback "exit <code>">
```
count **bold** (canon shape 2 bolds it), `⏺` bullet in the shape-2 gutter. `preventedContinuation` /
`stopReason` / additional-context lines have no wire source — out of scope, recorded. This requires
`HookRunEntry` to carry `exitCode?: number` and `stderr?: string` off the response frame (2.1).

### 2.4 The silent-run seam + the latent clause form — RESOLVED (R3)

Two bl7 records conflicted; R3 (research-silentrun-hooks.md) adjudicated against the binary: **canon
ABSORBS hooks on all-silent runs into the cluster's own collapsed row.** Hidden tool messages join
`u.messages` unconditionally (segmenter fall-through 162914528 → shared tail 162915830), satisfying the
hook-absorb guard @162916440; the collapsed renderer's early-return disjunction @177045120 includes
`(l.hookTotalMs??0)>0`, so a zero-counter run with hooks renders a real visible row whose ONLY clause is
the hook clause — bl7's "latent" form's true producing shape. `Qy` is never reached for this case. The
bl7 record ("canon routes hooks on such runs to Qy", bl7 spec §8) was **false**; the older "zero-height
clickable row" inference was also wrong (canon has no per-cluster click — expansion is the global ctrl+o
chord), though its observed half (counterless run renders nothing **when hookless**) re-verifies.

ccx change: `flush()`'s emit gate becomes `run.memberIds.length > 0 && (run.visibleMembers > 0 ||
hooks.infos.length > 0)` — resolve hooks BEFORE the visibility test (silent members already populate
`memberToolNames`/causal caps, bl7 H2, so `resolveRunHooks` needs no change). The `toolFold.ts:640-643`
divergence comment is rewritten: it stays exact parity for the hookless case and was a gap for the
with-hooks case. Expanded, canon shows the hidden members (per-member rows, no silent filter,
@177046212) AND the hook block (@177046924): the ticket pins what ccx's existing `expandedMemberItems`
does for silent members and mirrors canon (show them) if it doesn't already.

### 2.5 Live counter (`di` analogue)

A pending/live row (never in the append-once Static region — bl7 D20's rule), rendered from
`inProgress()`:
- Events other than PreToolUse/PostToolUse: `Running Stop hooks…` (dim, event bold, singular
  `hook…`/plural `hooks…`) while count > 0 — canon `di`'s other-events branch.
- PreToolUse/PostToolUse: canon shows a counter only in transcript mode; ccx renders `N PreToolUse hooks
  ran` (dim, label bold) under the same D21 predicate, else nothing — matching canon's split.
- **Counting source diverges deliberately**: canon counts `hook_progress` frames (its only signal); ccx
  counts started-without-response, which is strictly better information and needs no progress frame.
  `hook_progress` frames are therefore consumed as liveness-only no-ops (they already reach the ingest
  arm; the tracker ignores them). Recorded divergence.

### 2.6 Ingest (`useChat.ts`)

The existing arm (`hook_started`/`hook_response` at :1565-1569) extends: every completed pair reconciles
(not just PreToolUse), `hook_progress` is accepted as a no-op, and the live-counter state derives from
the tracker on render (no new refs). SessionStart/UserPromptSubmit entries arrive before the first tool
atom and drain at the first flush — their rows render at the top of the turn, matching canon's stream
placement.

## 3. T-ADVCMD design — the /advisor command

### 3.1 Command + dialog (new `src/tui/AdvisorDialog.tsx` + `advisorModel.ts` pure half)

`commands.ts` gains `{ name: "advisor", summary: "[opus|sonnet|fable|off] — let Claude consult a stronger
model at key moments" }` (canon description: "Let Claude consult a stronger model at key moments";
argumentHint computed from the catalog + `off`). The dialog clones canon's `Z` @185591490, top to bottom:

1. Title: `Advisor (experimental)` (bordered dialog, Esc cancels).
2. Blurb: `When Claude needs stronger judgment — a complex decision, an ambiguous failure, a problem it's
   circling without progress — it escalates to the advisor model for guidance, then resumes. The advisor
   runs server-side and uses additional tokens.`
3. Conditional warning (`!mainModelSupportsAdvisor`): `The current main model (X) does not support the
   advisor.` (warning color).
4. Select rows: catalog aliases mapped to `{label: displayName, value: alias}` + a pinned row for a
   custom configured id not in the catalog + always-last `{label: "No advisor", value: "off"}`. Default
   focus = current advisor (or `"off"`).
5. Recommendation: `Recommended setup: ` (suggestion color) + `Sonnet as the main model with Opus as the
   advisor. For certain workloads this gives near-Opus performance with reduced token usage.`
6. Link: `https://claude.com/blog/the-advisor-strategy`.

### 3.2 Catalog + eligibility (pure, `advisorModel.ts`)

Canon's catalog is the static alias triple `["fable","opus","sonnet"]` filtered by `advisor_rank`
(binary-static @155174245-155184801): haiku-4-5 = 1, sonnet-4-5 = 2, sonnet-5 = 3, opus-4-7/4-8 = 4,
opus-5 = 4, fable-5 = 5; floor `Aqt = 2`; pairing rule advisee-rank ≤ advisor-rank. ccx transcribes a
static `ADVISOR_RANKS: Record<string, number>` keyed by canonical id (via `resolveModelAlias`), exports
`advisorCatalog()` (aliases with rank ≥ 2 — all three today), `supportsAdvisor(mainModel)` (rank
defined), `canAdvise(mainModel, advisor)` (pairing). Canon's fable-consent branch (usage-credits gating,
`bG`/`sye`) is **out of scope** — ccx has no credits surface; fable lists as an ordinary eligible row.

### 3.3 Apply path

`SettingsOps` (chatSession.ts, beside `setEffort`) gains `setAdvisorModel(model: string | null):
Promise<void>` → host-side `applyFlagSettings({advisorModel: model})` (P119 case 4; canon's remote path
sends the identical request). The dialog's onChange:
1. Validate client-side against the catalog (P119: the server never reports a bad value — validation is
   load-bearing). Invalid → `X cannot be used as an advisor. Valid options: fable, opus, sonnet, off`.
2. `off` → `setAdvisorModel(null)` + delete the pref → `Advisor disabled`.
3. Alias → resolve, `setAdvisorModel(resolvedId)` + persist pref (`advisorModel`) → `Advisor set to
   <displayName>`, appending canon's notes verbatim when applicable: unsupported main model (`Note: the
   current main model (Y) does not support the advisor. It will activate when you switch to a supported
   main model.`) or failed pairing (`Note: X is less capable than the current main model (Y), so the
   advisor will not activate. Choose a more capable advisor, or switch to a smaller main model.`).

No " (this session only)" suffix: canon's suffix marks its remote non-persisting path; ccx both
live-applies and persists (its `/model` enter-sets-default precedent). Recorded divergence.

`useChat`'s bl7 `advisorModel` const becomes state seeded from `initialAdvisorModel` and updated by the
apply path, so the `Advising using {model}` row tracks the live value. `/advisor <arg>` immediate path:
`off`/`unset` accepted; an alias or exact catalog id applies directly; anything else gets the invalid
message (canon additionally accepts arbitrary ids behind a credentialed validity check ccx cannot make —
restricting to the catalog is the recorded divergence).

### 3.4 Startup notification

When `advisorModel` resolves at launch: three states, canon's `jxe` @178890000 verbatim — (i) main
model has NO advisor rank (`!supportsAdvisor(main)`, canon `!M8(j)`): post NOTHING; (ii) ranked and
pairing passes: `Advisor Tool (experimental) is on and may use more tokens · /advisor` (medium
priority); (iii) ranked but pairing fails: the sibling text (`Advisor will not activate on the main
model (advisor is less capable); subagents may still use it and may use more tokens · /advisor`).
One-shot per session. [v3: was drafted binary on pairing; the Task 4 implementer surfaced canon's
unranked-main silent gate — amended to three-state at invocation.]

## 4. Out of scope (recorded)

- SessionEnd rows (dead on wire, P119), `preventedContinuation`/`stopReason`/additional-context lines
  (no wire source), in-process callback-hook self-instrumentation (bl7 §2.6 carry-over).
- Canon's focus-mode brief-turn hook clearing; Stop-hook spinner suffix (@178719682).
- fable usage-credits consent flow; `/config` advisor row (NOT parity — R1's verdict; canon's own
  /config has no advisor row and no `advisorModel=` shorthand).
- Progress-stdout display for running hooks (canon `di` shows none either).
- R-XXT narration flush (recorded rule, §0).

## 5. Acceptance (observable behavior)

Commands from `CC-to-SDK/harness/`. Gates: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`
(NEVER bare `npm test`).

- **A1 (retention):** unit: pairs for all five reachable events retained with `event`, `exitCode`,
  `stderr`; `inProgress()` counts started-without-response per event; PreToolUse absorption unchanged
  (bl7 suite stays green).
- **A2 (standalone rows):** tui: a PostToolUse pair between two clusters renders `  ⎿  Ran 1 PostToolUse
  hook` after the owning cluster's row (deferred-park order); per-hook lines appear exactly when
  `projection !== "compact" || verbose`; a UserPromptSubmit pair before any tool renders at the turn's
  top; two adjacent same-label pairs coalesce into one `Ran 2 … hooks` row.
- **A3 (Stop):** a Stop pair with exit 0 renders nothing; exit 2 with stderr renders the bold-count
  `⏺ Ran 1 stop hook` + `  ⎿  Stop hook error: …` block.
- **A4 (no double-render):** an entry claimed by a cluster never also appears standalone (shared claims
  set) — pinned with a cluster+standalone mixed fixture.
- **A5 (live counter):** with a started-unresolved Stop hook, the live region shows `Running Stop
  hook…`; it disappears on response; Pre/PostToolUse counters obey the D21 predicate; `hook_progress`
  frames alone never create a row.
- **A6 (silent-run seam):** an all-silent run with claimed PreToolUse hooks emits a group whose
  collapsed row is the clause form (`Ran N PreToolUse hooks (X.Xs)` as the only clause, bold count) —
  bl7's pinned latent branch now covered by a producing `segmentRuns`→render fixture, not just the
  direct-`groupItems` contract test; a hookless all-silent run still emits nothing.
- **A7 (advisor dialog):** tui: `/advisor` opens the dialog with title, blurb, three catalog rows with
  display names + `No advisor`, recommendation and link; Esc cancels without applying; selection calls
  `setAdvisorModel` with the resolved id, persists the pref, and posts `Advisor set to <name>`; `off`
  clears. Warning + notes render under forced unsupported/pairing fixtures.
- **A8 (advisor immediate):** `/advisor opus` applies without the dialog; `/advisor garbage` prints the
  canon invalid message and applies nothing (P119: silent server = client validates).
- **A9 (advisor live row):** after a mid-session `/advisor opus`, the next `Advising using …` row shows
  the new model — printed VERBATIM (the resolved id), per bl7 T-ADVISOR's recorded D15 divergence in
  `render.ts` (the row echoes the client's config value, not a display name). The live-value half (ref,
  not the launch const) is the acceptance bar; the verbatim-vs-display-name presentation is the
  pre-existing recorded divergence, restated here so this clause can't be read as demanding a display
  name. [Amended when invoked — Task 3 review, 2026-08-30.]
- **A10 (hook pty):** extend `scripts/hookblock-cells.sh` with a standalone-row cell: fake-host pushes a
  PostToolUse pair with no owning cluster → the REAL ccx binary renders the standalone row; feature-kill
  (drop the drain) fails the cell.
- **A11 (advisor live, gated):** keyed live test (skips cleanly keyless): `/advisor sonnet` mid-session
  applies (`setAdvisorModel` accepted, result line rendered). The consult-render half (a real
  `Advising using …` from a live consult) is evidence-optional — consults cost ~$0.39 and cannot be
  forced honestly; A9 pins the same render path with a synthetic frame.
- **A12 (startup notification):** launching with a paired advisorModel posts the experimental notice
  once; unpaired posts the sibling text.

## 6. Tickets & execution

Two worktree tickets off main, bl4-bl7 pipeline (sonnet implementer/reviewer per task, mutation checks,
Task-5 acceptance walks): **bl8-t-qy** (§2: tracker, fold drain, renderer shapes, live counter, pty
cell) and **bl8-t-advcmd** (§3: pure catalog half, dialog, apply path, notification, live cell).
T-ADVCMD touches `useChat.ts`/`chatSession.ts` surfaces T-QY does not (except `useChat` ingest vs
command dispatch — disjoint regions); merge order: t-qy first (larger), then main→t-advcmd
reconciliation before its --no-ff merge (bl7 discipline).

## 7. Decision log

- **D1** Tracker retains all reachable events; consumers filter (cluster = PreToolUse-only, unchanged).
  Rejected: per-event trackers (one consumption ledger is the bl7 F2 lesson).
- **D2** Standalone drain at flush boundaries with label grouping, through the existing `deferred` park.
  Rejected: a separate post-pass over leftovers (loses canon's park-after-cluster ordering); rendering
  from the tracker directly (bypasses the claims set — double-render risk).
- **D3** Per-hook lines show `hook_name (X.Xs)` (wire has no command text) under the D21 predicate.
  Rejected: hiding detail lines entirely (canon shows them in transcript mode; D21 is the established
  analogue).
- **D4** Stop rows only on failure, from `exit_code`/`stderr`. Rejected: always-render Stop (canon
  explicitly early-exits clean Stop summaries to null).
- **D5** Silent-run hooks ABSORB into the emitted group (emit gate gains `|| hooks non-empty`); the
  clause form activates through its true producing shape. Rejected: draining them standalone (that was
  bl7's recorded canon claim — R3 proved it false against the binary).
- **D6** Live counter counts started-without-response; `hook_progress` is liveness-only no-op. Rejected:
  canon's progress-frame counting (strictly worse signal ccx doesn't need); showing cumulative stdout
  (canon's `di` shows none).
- **D7** `/advisor` command + dialog (parity), NOT a /config row (R1: canon has none; the bl7 A9 story
  ends here — the row was never canon). Rejected: /config row as client addition (out-of-denominator
  work when the parity surface exists and is cheaper).
- **D8** Static transcribed `ADVISOR_RANKS` + floor 2 + pairing rule. Rejected: `supportedModels()` at
  dialog-open (returns tier aliases without ranks; canon's own catalog is static in the binary).
- **D9** `setAdvisorModel` on `SettingsOps` beside `setEffort`, host = `applyFlagSettings`. Rejected:
  relaunch-to-apply (P119 proved live apply works; canon's remote path is the same request).
- **D10** Apply = live + persist, no "(this session only)" suffix (ccx architecture is permanently
  remote-shaped; suffix would mislabel a persisting write). Recorded divergence.
- **D11** Client-side catalog validation is mandatory (P119: silent server failure); `/advisor <id>`
  restricted to catalog (canon's arbitrary-id path needs a credentialed check ccx lacks). Recorded
  divergence.
- **D12** fable consent flow out of scope; fable is an ordinary row. Recorded divergence.
- **D13** (plan review F1) Standalone placement is a TWO-PASS weave: all cluster claims settle first
  (bl7's result-order J1/J2 semantics untouched), then leftovers place by the canon rule (before-group
  for pre-anchor, after-group for in-window, end otherwise). Rejected: per-flush drain (steals entries
  an early run rejected but a later overlapping run should claim — permanent mis-attribution through
  the shared ledger).
- **D14** (F2) Hooks items carry stable identity (first entry's `hook_id`) and are withheld from the
  append-once Static region while growable (trailing window open, or same-label hook in progress) — the
  bl7 D20 advisor-row mechanism reused, not a second channel. Rejected: publish-on-first-render (frozen
  `Ran 1` or duplicate rows across reconciles).
- **D15** (F3) The host keeps a tri-state `flagAdvisorModel: string | null | undefined` committed only
  after SDK success and replayed onto every swapped engine when `!== undefined` (null included — an
  explicit off must not resurrect a launch-config advisor). Rejected: bare `applyFlagSettings` call
  (lost on resume/clear/rewind swaps).
- **D16** (F4) `advisorModel` in useChat is a ref (read by `projectionContext` and every long-lived
  closure), and joins `knobKey` (the "session-constant, deliberately not in knobKey" comment at
  `toolRenderer.tsx:~173` is rewritten). Rejected: `useState` alone (stale mount-time closures render
  the old model).
- **D17** (F5) `hook_started` triggers reconciliation (non-replay), or the live counter never paints —
  the only guaranteed projections otherwise bracket the hook's lifetime. `hook_progress` still repaints
  nothing (no rendered count changes).
- **D18** (round review F1) Detail projections weave standalone hook rows over the `Anchored[]` list by
  sequence — no fold threading, no claims, no growability (detail recomputes fresh); PreToolUse entries
  also surface there (canon shows hooks in transcript mode). Rejected: threading the fold pipeline
  through detail mode (would start clustering a projection defined as the raw view).
- **D19** (round review F2 + waves 2-4) THE PLACEMENT INVARIANT: every row `segmentRuns` pushes records
  a governing-sequence slot (groups additionally their `[anchor, boundary)` window); pass-2 placement is
  ONE sequence-ordered scan with a containment floor (a contained entry never precedes its containing
  group's row) and zero-render rows do not break same-label coalescing. Replaced, in order: the
  groups-only slot model (hooks after a lone Edit fell to the end), point slots without containment
  precedence (hook before its own cluster), containment-first without deferred-span awareness (hook
  before the parked rows), and per-row slots without the zero-render rule (split coalescing). The
  convergence tripwire ("two consecutive refinements of our own fix ⇒ find the single invariant") fired
  after wave 2 and the invariant landed in wave 3 — one wave earlier than bl7's same spiral.
- **D20** (round review F3/F4, amending D9-D11's apply path) `applyAdvisorChoice` takes
  `mainModel: string | undefined` and suppresses both compatibility notes when the main model is unknown
  (an attached client learns it only when a turn streams); the prefs write is best-effort (its own
  try/catch, non-fatal notice) and the live state (ref + reconcile + confirmation) commits
  unconditionally once `setAdvisorModel` succeeded — the file's own "a read-only home must not take down
  a session" convention.

## 8. Surprises & Discoveries

- The "still-unread xxt" backlog item was already fully resolved inside bl7's research file — the
  residue line was copied bl6→bl7 memory without re-checking the artifact it pointed at (third
  consecutive round with a wrong-premise parked item; the round title is testimony, not diagnosis).
- `hook_progress` IS reachable (P116's negative was fast-hook sampling); cumulative snapshots.
- SessionEnd hooks run but emit nothing (positive control) — a wire-level gap, not a config gap.
- Invalid `advisorModel` fails silently (`is_error:false`, no `model_not_found`) — bl7's recorded
  bad-pairing premise was wrong; client validation is load-bearing.
- Canon has no /config advisor row at all; the real surface is `/advisor` (dialog "Advisor
  (experimental)") — and canon's advisor catalog + ranks are static in the binary, not fetched.
- bl7's §8 claim "canon routes hooks on all-silent runs to the standalone renderer Qy" was FALSE (R3:
  absorbed, clause form). The latent-branch adjudication pinned the right contract for the wrong reason —
  the branch was one emit-gate condition from reachable, not architecturally severed.
- TWO pre-existing cells asserted total hook absence ("no PreToolUse anywhere") and both were pins of
  the pre-QY world — they held only while unclaimed entries had no renderer (and, in one case, only via
  the very positioning bug a fix wave removed). The guarded invariant in both was ABSORPTION; the
  narrowing (not-absorbed + standalone-visible) was a controller adjudication each time, never a fixer's.
- The placement fix spiraled exactly like bl7's attribution fix (each patch's corner found by the next
  review), but converged one wave earlier because the tripwire was pre-committed in the ledger BEFORE
  the loop started — wave 3 was mandated to replace, not patch.
- The Task-4 review caught a red-state paperwork drift ("3 of 4 failed" was 1 of 4, two passing
  VACUOUSLY through undefined imported constants) — undefined-import vacuity is a new failure shape for
  the reviewer-reproduces-claims protocol to watch: a red test must fail for the finding's reason.
- The closing review endorsed the final state in one sentence with zero findings — the loop's four
  waves ended in an explicit clean bill, not exhaustion.

## 9. Outcomes & Retrospective

Shipped, both tickets plus the R-XXT closure, one round (2026-08-30). **T-QY** (merge `ac6924cc59`,
5 tasks): the tracker retains all five reachable events with in-flight counts; unclaimed pairs weave
into standalone `{kind:"hooks"}` items through the deferred park; the D5 emit-gate change activated
bl7's pinned clause form through its true producing shape (all-silent runs with hooks); Qy's two row
shapes and the `di` live counter render with D14 Static withholding; pty cells S1/S2 prove the drain in
the real binary. **T-ADVCMD** (merge `ea0a078d9a` after reconciliation `2295440dbf`, 5 tasks + a
spec-surfaced three-state gate fix): the `/advisor` command and "Advisor (experimental)" dialog with
canon's verbatim literals, static transcribed ranks (floor 2, pairing rule), tri-state
`flagAdvisorModel` surviving engine swaps, live ref + knobKey threading, the startup notice's three
states, and a keyed live test that passed against the real engine (8.8s, real `applyFlagSettings`).
**R-XXT** closed as record-don't-build (§0) — the research had been complete since mid-bl7; the backlog
line was stale testimony.

The campaign: plan review 4 high + 1 medium, all five verified real and accepted (D13-D17; the headline
was the per-flush drain that would have regressed bl7's attribution invariant) — fifth consecutive
round that gate caught a shipping-grade defect. Ten task reviews: nine clean, one Critical (the F2
withholding's dead second loop, reproduced live by the reviewer) fixed and re-approved with a mutation
check. Two acceptance walks: zero findings each (the keyed A11 run needed one test-authoring fix, an
8-hex roster id). Whole-round review: 5 P2 — four fixed in wave 1, one logged (F5, test-infra-bounded).
Then the placement spiral: waves 2-4, each finding a corner of the previous fix, converged by the
pre-committed tripwire into D19's single invariant; the closing review returned ZERO findings with an
explicit endorsement. Two controller adjudications narrowed pre-QY total-absence pins to their real
invariant (absorption). Final battery: all seven gates green (unit 4175; tui 4880+; the four hookblock
cells including the standalone kill; cluster-expand; linkopen).

Divergences standing at close: per-hook standalone lines show `hook_name`, not command text (wire);
Stop rows synthesize from `exit_code`/`stderr` (no preventedContinuation/stopReason source); the live
counter counts started-without-response, not `hook_progress` frames; `/advisor` restricts args to the
catalog, no fable-consent flow, no "(this session only)" suffix (live+persist both); SessionEnd rows
unbuildable (dead wire); hooks remain live-only (absent on resume/attach). The D21-true branch
(per-hook detail lines under compact-verbose; Pre/Post live counter text) remains latent behind
production callers that never set it — recorded in the tech-debt tracker beside F5.

## Revision Notes

- v1: initial. D5/§2.4/A6 were drafted with a PENDING-R3 marker and resolved (absorb + clause form)
  before first commit once R3's binary verdict landed.
- v2 (2026-08-30): pre-execution adversarial plan review (gpt-5.6-sol, xhigh) returned 4 high + 1
  medium; ALL five verified real against the code and accepted — D13-D17. Headline: the per-flush
  standalone drain would have permanently stolen hooks from later overlapping runs, regressing exactly
  the invariant bl7's four fix waves converged on (D13); and a bare `applyFlagSettings` advisor apply
  would silently vanish on every engine swap, with explicit-off resurrecting the launch advisor (D15).
  Fifth consecutive round the plan-review gate caught a shipping-grade defect.
- v3 (2026-08-30, during execution): A9 amended at invocation (verbatim-id Advising row per bl7 D15);
  §3.4 amended to the three-state startup notice (canon's unranked-main silent gate, surfaced by the
  Task 4 implementer).
- v4 (2026-08-30, close): D18-D20 added from the post-merge review loop (wave 1 F1-F4 + the waves 2-4
  placement spiral); §8 gained the pre-QY-pin, tripwire-payoff, and vacuous-red discoveries; §9
  retrospective written. F5 and the D21-latent branch logged in `docs/parity/tech-debt-tracker.md`.
