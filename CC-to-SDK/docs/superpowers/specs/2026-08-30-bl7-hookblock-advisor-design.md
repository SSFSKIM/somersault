# bl7 — Expanded-cluster hook block + advisor rows (T-HOOKBLOCK, T-ADVISOR)

**Status:** v1 (2026-08-30). Canon = installed Claude Code **2.1.251** (`~/.local/share/claude/versions/2.1.251`,
197,171,680 bytes). Evidence base: `.doperpowers/sdd/2026-08-30-bl7-round/research-hookblock.md` and
`research-advisor.md` (byte-offset-cited, both re-anchored from scratch on .251), plus live probes
`probes/probes/116-hook-frames-0337.ts`, `117`/`117b`, `118-goal-advisor-reachability.ts`,
`118b-advisor-envelope-uuids.ts` (all with ANSWER headers, SDK 0.3.237, 2026-08-30).

## 1. Purpose

Two canon transcript surfaces became buildable when the 2026-08-30 probe wave flipped their reachability
verdicts:

- **T-HOOKBLOCK** — canon's PreToolUse hook presentation on tool clusters: the expanded-cluster block
  (`⎿ Ran N PreToolUse hooks (0.4s)` + per-hook lines) and the collapsed-row clause/line. Wire input:
  `system/hook_started` / `system/hook_response` frames, which P116 proved reach a headless client for
  settings-layer hooks (staling P85). ccx currently drops every hook frame silently.
- **T-ADVISOR** — canon's advisor consult rows: the in-flight `⏺ Advising using {model}` row, the four result
  shapes, and the clickable expand/collapse of the result body. Wire input: `server_tool_use`(name `advisor`) +
  `advisor_tool_result` assistant blocks, which P118 proved arrive headlessly when settings carry
  `advisorModel`. ccx currently renders both blocks as **total silence** (retained faithfully, zero output —
  `render.ts:206-236` has no matching arm; they never reach `species.ts`).

Tickets are independent and run in parallel worktrees; both touch `toolRenderer.tsx`, so merges are sequential
with a main-into-branch merge before the second (the bl6 pattern).

## 2. T-HOOKBLOCK design

### 2.1 Wire contract (measured, P116)

Settings-layer command hooks emit, per hook invocation:
`system/hook_started {hook_id, hook_name:"PreToolUse:Read", hook_event:"PreToolUse", uuid, session_id}` then
`system/hook_response {…same keys…, output, stdout, stderr, exit_code, outcome:"success"|"error"|"cancelled"}`.
No duration field anywhere; no `tool_use_id`; canon's `stop_hook_summary` never appears on the SDK wire. Timing
is the client's own started→response **arrival delta**. In-process (`options.hooks`) callbacks emit nothing —
out of scope (ccx owns those callbacks; self-instrumentation is future work, recorded).

### 2.2 Enabling the frames (D1)

`includeHookEvents` is never set by any ccx front door today, so nothing arrives. Default it **on for
`kind:"interactive"`** in `host.ts` engineConfig, mirroring the `includePartialMessages` line at `host.ts:548`
(same `?? true` config-overridable shape, `config.includeHookEvents`). Correct the stale comment at
`config/types.ts:157` (P116 overturned probes 53/53b for settings-layer hooks; note the in-process exception).
Cost: two frames per settings hook per tool call — accepted deliberately.

### 2.3 Ingest and attribution (D2)

Hook frames never enter `TranscriptDocument` (canon's own hook fields live on a derived accumulator, not a
retained message — `appendSdk`'s assistant/user gate stays as is). New ingest arm in `useChat.ts` **ahead of
the system-notice arm at :1540**:

- Pair `hook_started`/`hook_response` by `hook_id`; stamp arrival clock on both under the existing
  `!ev.replay` guard beside `stampToolStarts` (`useChat.ts:1570`), per the ingest-stamps-render-reads rule
  (`foldPendingState.ts:56-58` — either a new sibling map on `FoldPendingState` or a small dedicated class
  with the same read/write split).
- On response arrival, record one completed entry
  `{name: hook_name, event: hook_event, durationMs: responseAt - startedAt, afterSequence}` where
  **`afterSequence` = the document's latest retained sequence at response arrival**. The wire carries no
  `tool_use_id`, so attribution is by arrival position — which is canon's own rule (absorption into whatever
  run is open). Only `hook_event === "PreToolUse"` entries are retained for the cluster path; other events are
  dropped (recorded divergence §4 — canon renders them via its standalone renderer, which is out of scope).
- The list is threaded to the projection via `ProjectionOptions` exactly as `thoughtMs` is
  (`toolRenderer.tsx:157`; ref cleared on rebuild at `useChat.ts:1285` — same live-only semantics).

### 2.4 Fold accumulation (D3)

Mirror canon's accumulator (segmenter arm @162916448, predicate `jar` @162906900):

- `RunState` gains `hookCount`, `hookTotalMs`, `hookInfos: HookInfo[]` (seeded 0/0/[] in `newRun()`, canon
  `S$e`); `FoldGroup` gains the same trio, spread in `emit()` **only when `hookCount > 0`** (canon `Yar`
  @162911645). `HookInfo = { name: string; durationMs: number }`.
- During `segmentRuns`, hook entries are resolved at flush/emit against **call-time positions** (D12): an
  entry belongs to a run iff `afterSequence >= ` the run's earliest member `callSequence` and `< ` the
  flushing boundary's sequence. NOT a cursor sweep against atom stream positions — settled atoms are
  ordered by `resultSequence`, so a sweep drops hooks in the normal tool_use → hooks → tool_result wire
  order. Entries matching no run (pre-run, post-breaker gaps) are **dropped** — canon routes those to its
  standalone renderer, which we are not building (recorded, §4). `hookRuns` is forwarded through all three
  production `segmentRuns` call sites in `toolRenderer.tsx` (D13), and `hook_response` ingestion reconciles
  immediately (D14). `hookTotalMs` += each entry's `durationMs` (sum; canon uses the summary's wall-clock
  `totalDurationMs` when present and per-info sum otherwise — ccx has only per-pair deltas, so concurrent
  hooks overstate slightly; recorded divergence §4). Note canon's *merge* helper `Uu` takes **`Math.max`** of
  `totalDurationMs`, never a sum — ccx has no merge step (pairs are already granular), but any future merge
  must not sum (D8).
- Replay/attach: hook entries exist only from live arrival; a rebuilt transcript has an empty list and the
  block is **absent on resume and attach** — the `thoughtMs` precedent (`useChat.ts:1285` "a rebuilt
  transcript has no duration source — show none"). Accepted divergence (D4); §4 records the one probe that
  could someday soften it.

### 2.5 Rendering (canon-verbatim)

**Expanded block** — appended in `expandedMemberItems` **after** the sorted member/thinking interleave
(`toolRenderer.tsx:1018`), taking no part in the sort; canon order is task-notifications → (thinking ∥
members) → hook block → memories (expansion branch @177046212, block @177046924). No wrapping margin — it
butts against the last member row. Two line kinds, both dim:

```
  ⎿  Ran 3 PreToolUse hooks (0.4s)
     ⎿ PreToolUse:Read (0.2s)
```

- Header gutter `"  ⎿  "` (two spaces, glyph, two spaces); per-hook gutter `"     ⎿ "` (five spaces, glyph,
  one space). Count NOT bold here. `hookCount===1?"hook":"hooks"`.
- Durations via canon's dedicated formatter `(ms/1000).toFixed(1)+"s"` (ECe @155015278) — one-decimal seconds
  always, no unit ladder. This is NOT ccx's general duration formatter; add a tiny `hookSeconds()` helper.
- **Per-hook line text = the wire's `hook_name`** (`"PreToolUse:Read"`). Canon renders the hook *definition's*
  command string (`_9` @159823669: `[command,...args].join(" ")` / prompt / url / `server/tool`, with
  `statusMessage` override) — ccx cannot recover that from the wire (D5; divergence recorded §4; the
  settings-mapping alternative was rejected — ambiguous when a matcher has several hooks, and coupled to
  settings layers ccx may not see).
- Gate: `hookInfos.length > 0` (canon gates the expanded block on infos, the collapsed forms on ms — match
  both gates as canon has them).

**Collapsed row** — canon's two mutually exclusive forms (@177052130 / @177053233), both gated
`hookTotalMs > 0`:

1. When the summary sentence has **no other clause**: the hook clause IS the sentence —
   `Ran **3** PreToolUse hooks (0.4s)` (count bold, verb capitalised because first).
2. Otherwise: its own dim line under the row — `  ⎿  Ran 3 PreToolUse hooks (0.4s)` (count not bold).

ccx's collapsed-row clause builder (`foldClauses` reading `GroupCounts`) gains `hookCount`/`hookTotalMs` on
`GroupCounts` to feed both forms. Neither collapsed form lists individual hooks.

**Errored-member suppression** (canon side effect @162916xxx): a cluster that absorbed hooks (or memories)
never relocates its errored member out. ccx: mirror only if ccx has the errored-pop-out behavior; otherwise
record. (Plan task must check `toolFold.ts` for an existing pop-out and mirror the guard if present.)

### 2.6 Out of scope for T-HOOKBLOCK (recorded, §4)

Standalone renderer `Qy` (two shapes, five line kinds; where non-PreToolUse labels and no-open-run summaries
land), the live in-progress counter `di`, focus-mode brief-turn clearing, in-process hook self-instrumentation,
Stop-hook spinner suffix.

## 3. T-ADVISOR design

### 3.1 Types + config (D6, D7)

- Promote **`@anthropic-ai/sdk`** (0.104.2, already in `harness/node_modules` transitively) to a direct
  `dependencies` entry; import `BetaServerToolUseBlock`, `BetaAdvisorToolResultBlock`,
  `BetaAdvisorResultBlock`, `BetaAdvisorRedactedResultBlock`, `BetaAdvisorToolResultError` rather than
  hand-rolling ~30 lines of local declarations.
- New `HarnessConfig.advisorModel?: string`, **default off** (absent — the `promptSuggestionEnabled` polarity:
  a paid secondary-model feature the operator enables deliberately; one consult measured ~$0.39). Plumbed:
  `types.ts` + `validate.ts` + `settings.ts:12-17` (one line beside the autocompact fields — lands on the
  SDK's documented `Settings.advisorModel`) + `--advisor-model` in `cli/args.ts` + `help.ts` + prefs +
  `/config` row (`settingsRows.ts`) + flag→pref merge in `cli/main.ts`. **No client-side model-catalog
  validation** — ccx has no catalog; a bad pairing surfaces as the server's `model_not_found` through the
  `Advisor unavailable (…)` row, which exists precisely for it. No client-side frequency/cost limiter (canon
  has none; cadence is server/prompt-side).

### 3.2 Render arms (canon-verbatim; `render.ts:206-236` gains two `else if` arms)

**In-flight** (`server_tool_use` with `name==="advisor"`; other server-tool names render nothing — benign
divergence from canon's error-boundary row):

```
⏺ Advising using Opus 4.8
```

Glyph in a min-width-2 gutter (`⏺` macOS / `●` elsewhere — ccx's existing bullet constant); **"Advising"
bold, undimmed**; `" using {model}"` dim (model display-name via ccx's existing formatter; the `· {input}`
clause is unreachable in practice — advisor input is always `{}` — omit). State: **dim glyph while
unresolved → solid success-green once resolved → solid error-red when errored** (resolution state per §3.3).
Canon blinks the unresolved glyph at a 600 ms half-period; ccx renders it via the fold/spinner animation tick
if one is already plumbed into this row's render path, else static dim (micro-divergence recorded §4 — the
plan task decides after checking, and must not build a new ticker for this). `marginTop` from `addMargin` on
this row only.

**Result rows** (`advisor_tool_result`; no gutter, no indent, no marginTop — flush under the Advising row):

| state | collapsed | expanded (click / verbose / transcript-mode) |
|---|---|---|
| `advisor_result` | `✔ Advisor has reviewed the conversation and will apply the feedback ` + hint, all dim | `content.text` verbatim — **one plain dim Text, NOT markdown**, no truncation |
| declined (`content.stop_reason==="refusal"`) with reason | `Advisor declined to advise on this request` + hint, warning color | warning line (hint dropped) then dim reason (= the same `text` field) |
| declined without reason | warning line, no hint | identical — nothing to reveal |
| `advisor_tool_result_error` | `Advisor unavailable ({error_code})`, error color | identical — never clickable |
| `advisor_redacted_result` | `✔ Advisor has reviewed the conversation and will apply the feedback` (no trailing space, no hint) | identical — never clickable |
| unknown content type | render nothing | — |

`✔` falls back per ccx's glyph tables if one exists; hint = the `(ctrl+o to expand)` chord text, **suppressed
when the row is click-expandable** (canon's `Gj` context: the affordance replaces the instruction — in ccx,
suppress in the fullscreen renderer where clicks work, show in the classic renderer).

### 3.3 Resolution state

Port canon's `eGt`/`uur`/`tGt` (@163035026-163035350) as a small lookups pass over retained messages: an
`advisor_tool_result` **resolves** its `server_tool_use` by `tool_use_id`, and marks it **errored** when the
content is `advisor_tool_result_error` or a refusal; any `server_tool_use` still unresolved in a non-latest
API message is force-resolved as errored (abandoned consults go red, never spin forever). Must NOT mint a
`ToolEvent` (`extractCalls` keeps its `tool_use`-only gate) — a parallel map derived where the projection
already walks entries.

### 3.4 Clickability + the cache decision (D9 — the round's highest-risk item)

Reuse the **`item:` mechanism with zero mouse-layer edits**: the advisor result item carries
`ownerKey: sdkOwnerKey(base)` and `clickable: true` **iff** `content.type === "advisor_result"` and
(`!declined || reason !== undefined`), and not when verbose/transcript projection is already expanded
(canon `if(q||X)return!1`). Expanded state read from `options.expandedItems` (the `sdk:` prefix cannot
collide with `tool:` owner keys). Click key = the row's owner key (canon keys by per-block uuid; same
stability property).

**Cache decision (D9 as amended by D16): add the `sdk:`-prefixed SUBSET of `expandedItems` to the
`anchoredEntries` `knobKey`** (`toolRenderer.tsx:1281-1282`) — filtered, sorted, joined. Without any key
component, `projectMessageEntry` runs inside the memo whose key omits expansion state, and a click serves
the stale collapsed row — **a click that silently does nothing, invisible to any test that doesn't drive
real SGR bytes**. The subset matters (D16): `tool:*` owners are consumed downstream of the cache, and
keying the full set would rebuild the whole transcript on every ordinary tool-result expansion. Guards:
the SGR cell proving the advisor click repaints, AND a regression test proving a `tool:*` toggle does NOT
rebuild anchored entries (build count via the `projectionDeps.buildAnchored` seam). The downstream-rebuild
alternative was rejected as a larger restructure for one row kind.

### 3.5 Fold + picker

- **Assert, do not change**: once the render arms exist, an advisor entry flips from `neutral`
  (`items.length===0` early-exit) to **`breaker`** in `entryAtom` — which happens to be exactly canon's
  segmenter disposition (advisor blocks match no absorb/park predicate and take the flush arm @arm 9). Pin it
  with a test and a comment so nobody "fixes" the breaker into absorption later.
- Add `advisor_tool_result` to the resume-picker preview allowlist (`sessionPickerModel.ts:179/:183`) so an
  advisor-only message counts in the "N messages" footer.
- Persistence/resume parity holds for free (ordinary assistant content; P118b: every frame has a distinct
  uuid, so the uuid-first dedupe keeps all advisor frames — plain append, no merge rule).

## 4. Recorded, not built (with evidence)

- **Hook per-hook line text divergence** — wire `hook_name` vs canon's definition-derived command (D5).
- **Hook block absent on resume/attach** (D4) — live-only arrival stamps, `thoughtMs` precedent. Soften-later
  probe: does the SDK persist/replay `system/stop_hook_summary` for Stop/SubagentStop (binary declares the
  snake_case wire schema @155831891 `@internal`; `getSessionMessages` has `includeSystemMessages`)? Unmeasured.
- **Non-PreToolUse hook labels dropped** — canon renders them standalone via `Qy` @177066257 (out of scope).
- **Standalone hook renderer / live counter / focus-mode clearing / Stop spinner suffix** (§2.6).
- **Concurrent-hook duration overstatement** — per-pair sums vs canon's batch wall-clock (§2.4).
- **Narration flush (bl6's "signed-thinking" question, resolved)** — canon's `$3e`→`isNarrationSummaryBlock`
  base64-decodes `signature`, walks protobuf fields 2→1→8, compares to `"narration"`; fail-closed. ccx's
  absorb-everything IS the fail-closed branch; building it means reimplementing a protobuf walk to detect a
  feature never observed on ccx's wire (`CLAUDE_CODE_ENABLE_NARRATION`-gated), failure mode cosmetic.
- **Advisor blink** if the plan task lands on static-dim (§3.2); **advisor unknown-server-tool error row**;
  canon's `/advisor` dialog, `--advisor` flag UX, experimental notice banner, `advisor_rank` catalog, statsig
  gate, `# Advisor Tool` prompt injection (server-side), 400-error advisor-stripping retry.
- **relevant_memories / goal_status** — probe wave held them dead (P117/117b: injection works, zero
  `memory_recall` frames; P118: zero `active_goal` frames).

## 5. Acceptance (observable behavior)

All commands from `CC-to-SDK/harness/`. Gates: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`
(NEVER bare `npm test`).

- **A1 (hook ingest):** with `includeHookEvents` frames flowing (unit-level: synthetic frames through the
  useChat ingest arm), a cluster spanning two Read calls with two completed PreToolUse pairs projects a
  `FoldGroup` with `hookCount: 2`, summed `hookTotalMs`, and `hookInfos` in arrival order; pre-run pairs and
  non-PreToolUse events are absent.
- **A2 (hook render):** the expanded cluster appends the canon block after members/thinking with exact
  gutters (`"  ⎿  "` / `"     ⎿ "`), dim, `(0.4s)`-style one-decimal durations, singular "hook" at count 1;
  the collapsed row shows the clause form when hooks are the only clause and the `⎿` line form otherwise.
  Snapshot-pinned in `test/tui/fold-expand.test.tsx`.
- **A3 (hook pty):** a `hookcluster` fake-host producer (tool → hook pair frames → tool) drives the REAL ccx
  binary under tmux (`scripts/cluster-expand-cells.sh` discipline); clicking the cluster shows the hook block
  between/after member rows; a feature-kill mutation (drop the ingest arm) fails the cell.
- **A4 (hook replay):** the same producer pushed pre-attach (replay path) yields a cluster whose expansion
  shows members but NO hook block — pinning the accepted resume divergence rather than leaving it accidental.
- **A5 (advisor render):** unit cells pin all five result shapes plus the in-flight row (bold "Advising",
  dim model clause, glyph state transitions), expanded body as plain dim text (a markdown-sensitive fixture —
  e.g. `**not bold**` — renders literally), hint suppressed exactly when clickable.
- **A6 (advisor click):** a real-SGR cell in `test/tui/fold-click.test.tsx`: click on the advisor result row
  toggles collapsed↔full body **and the repaint actually happens** (the D9 cache regression: with
  `expandedItems` removed from `knobKey` the cell must fail); declined-without-reason and error/redacted rows
  are not clickable.
- **A7 (advisor fold/picker):** pinned test that an advisor entry is a `breaker`; picker footer counts an
  advisor-only message.
- **A8 (advisor live, gated):** keyed live cell (skips cleanly without credentials): a session with
  `advisorModel` set renders the Advising row then a result row through the real REPL submit chain.
- **A9 (config):** `--advisor-model` reaches SDK `Settings.advisorModel` (resolveOptions passthrough test);
  default is absent; help text pinned by `test/unit/cli-surface.test.ts`. (v3: the `/config` row was dropped
  from scope under D15's full-or-dropped rule — a real row needs the model-catalog picker D7 scopes out;
  flag + saved preference remain the configuration surfaces.)

## 6. Test plan

Unit: `test/tui/fold-expand.test.tsx` (hook block cells after the bl6 cluster cells), new
`test/tui/advisor-row.test.tsx` (shapes/states), `test/tui/fold-click.test.tsx` (SGR advisor cell + cache
regression), `test/unit` config/CLI surfaces. Pty: extend `scripts/cluster-expand-cells.sh` or add
`scripts/hookblock-cells.sh` on the same discipline (private tmux socket, isolated HOME/CCX_FLEET_ROOT,
teardown by name, SGR from saved script file); both live and replay-path cells; ≥1 run under load; mutation
kills quantified over ≥5 runs when probabilistic. Live: A8 keyed cell in `test/live/`.

## 7. Decision log

- **D1** `includeHookEvents` defaults on for interactive kind (config-overridable), stale comment fixed.
  Rejected: leaving it opt-in (feature dead by default defeats the ticket; frame cost is two per hook call).
- **D2** Hook attribution by arrival position (`afterSequence` stamp at response arrival) — canon's own
  open-run rule; wire has no `tool_use_id`. Rejected: keying by last-started tool id (false precision the
  wire cannot support; canon's block is per-cluster, not per-member).
- **D3** Scope = expanded block + both collapsed forms. Rejected: standalone `Qy` renderer (largest single
  scope expansion, channels ccx has no wire source for); live counter `di`.
- **D4** Resume divergence accepted (live-only stamps, `thoughtMs` precedent) + A4 pins it. Rejected:
  ccx-side sidecar persistence (new storage surface for a cosmetic gap); blocking on the unmeasured
  stop_hook_summary replay probe.
- **D5** Per-hook line renders wire `hook_name`. Rejected: settings-derived command mapping (ambiguous for
  multi-hook matchers, couples rendering to settings visibility); header-only (drops per-hook lines canon
  shows).
- **D6** `@anthropic-ai/sdk` promoted to direct dependency for advisor block types. Rejected: local `.d.ts`
  transcription (drift risk vs a dep already version-pinned by the agent SDK).
- **D7** `advisorModel` knob default-off, no client-side catalog validation, no client-side cost limiter —
  the `promptSuggestionEnabled` polarity + server-error-speaks pattern.
- **D8** Any future merging of hook batches must take MAX of wall-clock durations, never sum (canon `Uu`
  @177191105) — recorded now because it is cheap to get wrong later.
- **D9** Advisor expansion invalidation via `expandedItems` in `knobKey` (deterministic serialization),
  guarded by the A6 cache-regression cell. Rejected: downstream rebuild (bigger restructure for one row
  kind). Revisit only if LRU pressure is ever measured.
- **D10** Advisor expanded body is plain dim text, NOT markdown — canon-verbatim (`bm` @176902218). Rejected:
  renderMarkdown (would be a deliberate divergence with no user ask).
- **D11** Narration flush recorded, not built (fail-closed parity already holds).
- **D12** (plan review H1, accepted) Hook absorption is keyed to **call-time positions**, resolved at
  flush/emit — an entry belongs to a run iff `afterSequence >= ` the run's earliest member
  `callSequence` and `< ` the flushing boundary's sequence. The pre-absorb cursor sweep against atom
  positions was rejected: settled tool atoms are ordered by `resultSequence`, so the NORMAL wire order
  (tool_use → hook pair → tool_result) would sweep the hook past an empty run and drop it — single-tool
  runs would lose every hook, and the planned fake producer (hooks after the first result) would have
  masked it. Mandatory test orders: tool_use→hooks→tool_result through open AND settled projections;
  single-tool run; pre-run; post-breaker; between-run.
- **D13** (plan review H2, accepted) `hookRuns` must be forwarded through ALL THREE production
  `segmentRuns` call sites in `toolRenderer.tsx` (:1417, :1499, :1504 — the fold-options builders), and
  the hook plan carries a production-pipeline test that starts from a `TranscriptDocument` + tracker
  entries through `projectCompact`/`projectPending` — the tests-pass-wiring-dead failure mode, third
  round running.
- **D14** (plan review M5, accepted) `hook_response` ingestion triggers a reconcile before returning —
  hook frames don't mutate the document, so without it a completed hook repaints only on the next
  unrelated frame. Test: hook_response as the FINAL event must repaint an already-open run.
- **D15** (plan review H3+H4, adjudicated) The advisor model clause is sourced from the client's own
  `config.advisorModel`, threaded into `ProjectionOptions`; when the client doesn't know it (attach to a
  host configured elsewhere), the clause is OMITTED — canon renders the clause conditionally
  (`Tp ? … : null`), so omission is canon-legal, recorded. Detached spawn adds `--advisor-model` to
  `spawn.ts`'s `configFlags` allowlist (verified: the allowlist exists and would silently drop it) with a
  spawn-argv test. The `/config` row ships with the full edit/persist path following the model row, or is
  dropped from scope — never display-only. Rejected: a new host-status wire field for the model name
  (cosmetic clause, not worth a protocol surface this round).
- **D16** (plan review M6, adjudicated narrower than recommended) `knobKey` keys only the
  **`sdk:`-prefixed subset** of `expandedItems` — advisor rows are the only expansion consumers inside
  the cache; `tool:*` toggles stay downstream and must NOT rebuild anchored entries (regression test
  counts builds via the `projectionDeps.buildAnchored` seam). Full-set keying was rejected: every
  ordinary tool-result expansion would rebuild the whole transcript and churn the 8-deep LRU.
- **D17** (plan review M7, accepted) "Non-latest" for force-resolving abandoned consults derives from
  the ACTUAL retained tail (canon `tGt`: `t?.type==="assistant" ? t.message.id : undefined`) — a user
  tail yields undefined and every unresolved consult is forced red. Tests: user-tail and missing-id
  orders through projectAll.
- **D18** (plan review M8, accepted) Promoting `@anthropic-ai/sdk` updates `package-lock.json` in the
  same task (regenerated at the installed version), so a clean `npm ci` accepts the manifest.
- **D19** (post-merge review loop, waves 1-4) Hook attribution is PER-ENTRY and TOOL-AWARE: an entry
  with tool name T (the `hook_name` suffix) may be claimed by a run only if the run has a tool-T member,
  with the causal cap `capForTool(R,T)` = unbounded while a tool-T member is open, else the max
  resultSequence over settled tool-T members; entries are consumed once (first legal claim); the pop-out
  widening's spanning-sibling refusal is scoped to the closing call's tool. Rejected along the way: pure
  flush-order claiming (picks causally impossible owners), a run-global cap (starves open members'
  hooks), a run-global cap-disable (steals settled-tool hooks), and tool-blind spanning refusal (drops
  the closing call's own hook). Ambiguous entries whose owner popped out go UNCLAIMED — attaching hooks
  to standalone calls is the deferred `Qy` seam. Residual (logged, not fixed): the malformed-name
  fail-open arm bypasses the tool-scoped spanning guard — unreachable on the observed wire (P116).
- **D20** (fix wave 1, review F1) Unresolved advisor rows are withheld from the append-once Static
  region (same trailing-atom scope as the growable-tool-run withholding) and render via the pending/live
  path until `advisorResolution` settles them; both force-publish paths (rows<=16 commitCap,
  `publishLiveWindow` on dialog open) otherwise freeze the dim row permanently.
- **D21** (fix wave 1, review F4) The advisor expanded-body predicate treats any non-`compact`
  projection as transcript mode (canon's renderer is two-state; `detail-collapsed` is a ccx-only
  intermediate that advisor bodies do not participate in).

## 8. Surprises & Discoveries

- Canon's `Uu` merge takes `Math.max` of durations (concurrent batches), not a sum — bl6's paraphrase was
  half wrong.
- Canon renders hooks in THREE places (collapsed clause/line, expanded block, standalone `Qy` + live `di`
  counter); bl6 knew only the expanded block.
- "Signed-thinking flush" is a narration-summary classifier (protobuf tag `"narration"`), not signature
  verification.
- Advisor's declined state is `stop_reason === "refusal"` re-reading the same `text` as the reason — not a
  distinct block type.
- The `(ctrl+o to expand)` hint is context-suppressed where rows are clickable — the affordance replaces the
  instruction.
- Advisor blocks today die silently in `render.ts` (no default arm) — NOT via a species fallthrough; the gap
  is invisible to live-vs-resume diffing because it is symmetric.
- The collapsed clause form (hook count as the row's ONLY sentence clause, bold count) is LATENT in ccx: the
  only runs that could produce it are all-silently-absorbed-tool runs, which `segmentRuns` deliberately drops
  before rendering (pre-bl7 divergence). Canon routes hooks on such runs to the standalone renderer `Qy` —
  out of scope this round. Found by the Task 5 walk (no covering test existed); resolved by pinning the
  branch's contract with a direct unit-level test rather than deleting canon-shaped code, and by logging the
  hooks-on-silent-run display as backlog alongside the standalone renderer.

## 9. Outcomes & Retrospective

Shipped, both tickets, one round (2026-08-30): **T-HOOKBLOCK** (branch merge `569a269dbf`, 5 tasks + a
walk-gap pin) — collapsed clause/line forms, the expanded per-hook block, call-time attribution (D12)
through all three production `segmentRuns` sites (D13), immediate reconcile on pair completion (D14),
pty-proven in the real binary (`hookblock-cells.sh`: live block + replay-divergence pin, feature-kill
mutation 3/3, `FOLLOWED` readiness signal closing bl6's Fix-2 item). **T-ADVISOR** (branch merge
`409daf107e`, 5 tasks) — the four advisor result shapes + in-flight `Advising using {model}` row (client
config, D15), plain-dim expanded body (D10), sdk:-namespace click/expand with the D16 cache-key subset,
breaker pin, picker allowlist, keyed live cell (~$1.17, two env bugs fixed: mkdtemp realpath, bounded
transcript poll). `/config` row dropped under D15 (catalog picker is D7-out; A9 amended v3).

What the process caught, layer by layer: the plan review's H1 (stream-position sweep would drop hooks in
the NORMAL wire order) reshaped the design before a line was written; the Task-5 acceptance walks caught
a spec/code divergence (A9) and a latent branch (clause form — unreachable behind the silent-run drop,
pinned contract-level); the whole-round review loop then ran four fix waves (advisor-Static freeze,
double-attribution, boundary off-by-one, detail-collapsed predicate; then three rounds of attribution
refinement converging on D19's unified rule) before closing on a logged defensive-corner residual. The
retrospective lesson mirrors bl4's: point-fixes to a positional heuristic leak — the loop only converged
when the per-entry tool-aware invariant replaced the stacked conditions (D19), and the wire's missing
`tool_use_id` makes the remaining ambiguity irreducible by design.

Deliberate divergences standing at close: hooks on all-silently-absorbed runs are dropped with the run
(canon routes to the standalone `Qy` renderer — deferred with `di`); `stop_hook_summary` never crosses
the wire so the collapsed count is synthesized from pairs; in-process callback hooks emit no frames
(harness-owned); hook timing is client-arrival delta (no ms field on the wire). Debt and deferrals live
in `docs/parity/tech-debt-tracker.md` (seeded this round).

## 10. Revision Notes

- v1 (2026-08-30): authored from research-hookblock.md + research-advisor.md + probes 116-118b.
- v2 (2026-08-30): pre-execution adversarial plan review (gpt-5.6-sol, xhigh) returned 4 high + 4
  medium; ALL verified real against the code and accepted (two with narrower adjudications) — D12-D18.
  The headline catch: the hook-attribution cursor would have dropped hooks in the NORMAL wire order
  because settled atoms reorder by resultSequence, and the planned pty producer would have masked it
  (D12). §2.4's cursor description is superseded by D12; §3.4's full-set knobKey by D16.
- v3 (2026-08-30): A9's "`/config` row present" clause removed. T-ADVISOR Task 1 dropped the row under
  D15's full-or-dropped rule (an honest row requires the model-catalog picker D7 bars; display-only is
  forbidden), and the Task 5 acceptance walk caught that A9's text was never updated to match. The
  configuration surfaces are `--advisor-model` and the saved preference; a `/config` row is backlog
  material alongside a future catalog picker.
- v4 (2026-08-30, close): D19-D21 added from the post-merge review loop (four fix waves); §8 gained the
  latent clause-form discovery; §9 retrospective written.
