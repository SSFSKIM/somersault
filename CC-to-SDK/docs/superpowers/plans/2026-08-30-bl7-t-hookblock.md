# T-HOOKBLOCK Implementation Plan (bl7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-execution to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render canon 2.1.251's PreToolUse hook presentation on tool clusters — the expanded-cluster block
(`⎿ Ran N PreToolUse hooks (0.4s)` + per-hook lines) and both collapsed-row forms — synthesized from the SDK's
`system/hook_started`/`hook_response` frames.

**Architecture:** A new pure pair-tracker (`src/tui/hookPairs.ts`) receives hook frames at ingest
(`useChat.ts`, beside `stampToolStarts`), pairs them by `hook_id`, stamps arrival-delta durations and an
`afterSequence` back-pointer into the document; the fold pipeline (`toolFold.ts`) absorbs completed entries
into non-empty runs by sequence position (canon's open-run rule); the renderer (`toolRenderer.tsx`
`expandedMemberItems` + `foldClauses`) draws canon's exact copy. Hook state is live-only (the `thoughtMs`
precedent): absent on resume/attach, pinned by a test.

**Tech Stack:** TypeScript, Ink, vitest (`npm run typecheck` / `npm run test:unit` / `npm run test:tui` from
`CC-to-SDK/harness/` — NEVER bare `npm test`), tmux pty cells.

**Governing docs:** spec `docs/superpowers/specs/2026-08-30-bl7-hookblock-advisor-design.md` §2 (decisions
D1-D5, D8); research `.doperpowers/sdd/2026-08-30-bl7-round/research-hookblock.md` (canon excerpts §2, ccx
seams §4).

## Global Constraints

- Canon copy is exact: header `"  ⎿  "` + `Ran {N} PreToolUse {hook|hooks} ({s})`; per-hook `"     ⎿ "` +
  `{name} ({s})`; durations `(ms/1000).toFixed(1)+"s"` always (canon `ECe` @155015278) — never the general
  duration formatter. Count NOT bold in the expanded header and the collapsed `⎿` line; count BOLD in the
  collapsed clause form. All dim.
- Absorption is PreToolUse-only into a NON-EMPTY run (canon `jar` @162906900 + `u.messages.length>0`).
  Pre-run and non-PreToolUse entries are dropped (spec §4 records the divergence).
- Expanded block gates on `hookInfos.length > 0`; both collapsed forms gate on `hookTotalMs > 0` (canon
  gates differ; match both).
- Per-hook line text = the wire's `hook_name` verbatim (D5). Durations sum per-pair deltas (spec §2.4); any
  future merge takes MAX (D8) — do not build a merge.
- Hook entries are live-only: stamped under the `!ev.replay` guard, cleared on document rebuild. The resume
  divergence is pinned by a test, not left accidental (D4).
- `FoldGroup`/`GroupCounts` fields spread in only when non-empty (the `absorbedThinking` style).
- Projection stays clock-free: all stamping at ingest, renders only read (`foldPendingState.ts:56-58` rule).
- Ink/render conventions: match surrounding code (dense hand-style, no Prettier); ESM `.js` import
  specifiers.

---

### Task 1: `includeHookEvents` default + the hook pair tracker + ingest wiring

**Files:**
- Create: `src/tui/hookPairs.ts`
- Modify: `src/host/host.ts` (engineConfig, beside the `includePartialMessages` line at ~:548),
  `src/config/types.ts:157` (stale comment), `src/config/resolveOptions.ts:130` (passthrough exists — verify
  only), `src/tui/useChat.ts` (~:1540 new arm, ~:1570 stamping, ~:311 projection threading, ~:1285 clear)
- Test: `test/tui/hookPairs.test.ts` (new), extend `test/unit/resolve-options.test.ts` (or the existing
  options passthrough test file) for the interactive default

**Interfaces:**
- Produces: `class HookPairTracker` —
  `started(frame: { hook_id: string; hook_event: string }, now: number): void`;
  `response(frame: { hook_id: string; hook_name: string; hook_event: string }, now: number, afterSequence: number): void`;
  `entries(): readonly HookRunEntry[]` where
  `export type HookRunEntry = { name: string; durationMs: number; afterSequence: number }` (PreToolUse-only —
  `response` drops other `hook_event`s and unmatched ids); `clear(): void`.
- Produces: `ProjectionOptions.hookRuns?: readonly HookRunEntry[]` (sorted by `afterSequence`; threaded from
  a `useChat` ref exactly as `thoughtMs` is at `useChat.ts:311`, cleared at the `:1285` rebuild site).
- Produces: interactive sessions send `includeHookEvents: true` (config-overridable
  `config.includeHookEvents ?? true`, mirroring `includePartialMessages` at `host.ts:548`).

- [ ] **Step 1: failing tests for the tracker** — `test/tui/hookPairs.test.ts`: (a) started+response with the
  same `hook_id` yields one entry `{name: "PreToolUse:Read", durationMs: response-started, afterSequence}`;
  (b) response without started is dropped; (c) `hook_event: "PostToolUse"` pairs are dropped; (d) two
  interleaved pairs keep arrival order; (e) `clear()` empties. Run: `npx vitest run test/tui/hookPairs.test.ts`
  → FAIL (module missing).
- [ ] **Step 2: implement `src/tui/hookPairs.ts`** — small class, `Map<string, number>` of started stamps,
  array of completed entries; header comment citing P116 (arrival delta is the only timing source; wire
  carries no ms and no tool_use_id) and canon `jar` (PreToolUse-only). Run tests → PASS.
- [ ] **Step 3: failing test for the interactive default** — extend the existing host/options test that pins
  `includePartialMessages` (find it: `grep -rn includePartialMessages test/`) with the same assertion shape
  for `includeHookEvents`. Run → FAIL.
- [ ] **Step 4: enable + wire** — `host.ts` engineConfig adds
  `includeHookEvents: this.opts.config.includeHookEvents ?? true` under the same `kind === "interactive"`
  ternary as `includePartialMessages`; add `includeHookEvents?: boolean` to `HarnessConfig` if absent and
  REPLACE the stale `types.ts:157` comment with: settings-layer hooks emit frames as of SDK 0.3.237 (P116,
  2026-08-30); in-process `options.hooks` callbacks still emit none. `useChat.ts`: new arm BEFORE the
  system-notice arm at `:1540` — on `system/hook_started` call `tracker.started(data, nowFn())`, on
  `system/hook_response` call `tracker.response(data, nowFn(), documentRef.current!.latestSequence())` (use
  the document's existing sequence accessor — find it in `transcriptModel.ts`; if only `revision()` exists,
  expose a `lastSequence()` getter returning `this.seq`), both under the SAME `!ev.replay` guard as
  `stampToolStarts` at `:1570`; `return` after handling so hook frames never fall through to the notice arm.
  Thread `hookRuns: hookTrackerRef.current.entries()` into `projectionContext()` at `:311`; clear the tracker
  at the `:1285` rebuild site (comment: "a rebuilt transcript has no hook source — show none", the thoughtMs
  precedent). Run both test files → PASS.
- [ ] **Step 5: typecheck + commit** — `npm run typecheck`;
  `git commit -m "bl7 t-hookblock: hook pair tracker + includeHookEvents interactive default"`.

### Task 2: fold absorption

**Files:**
- Modify: `src/tui/toolFold.ts` (`GroupCounts` ~:293, `FoldGroup` ~:316, `RunState`/`newRun` ~:330-340,
  `emit` ~:438, `segmentRuns` ~:459)
- Test: `test/tui/toolFold.test.ts`

**Interfaces:**
- Consumes: `HookRunEntry` from Task 1 (`import type { HookRunEntry } from "./hookPairs.js"`).
- Produces: `GroupCounts.hookCount?: number; hookTotalMs?: number` (present only when > 0);
  `FoldGroup.hookInfos?: readonly { name: string; durationMs: number }[]` (present only non-empty);
  `segmentRuns(atoms, options)` gains `options.hookRuns?: readonly HookRunEntry[]`.

- [ ] **Step 1: failing tests** — in `test/tui/toolFold.test.ts`: (a) two tool atoms with sequences 10, 20
  and hook entries `afterSequence: 12` and `15` → one group with `hookCount: 2`, `hookTotalMs` = sum,
  `hookInfos` in order; (b) an entry with `afterSequence` BEFORE the run's first member sequence is dropped
  (no group field); (c) an entry after the closing breaker's sequence belongs to the NEXT run (or is dropped
  if none opens); (d) a run with zero hooks emits a group with NO hook fields (spread-when-non-empty); (e)
  hook fields survive `open: true` (mid-run projection). Run → FAIL.
- [ ] **Step 2: implement** — `RunState` gains `hookCount: number; hookTotalMs: number; hookInfos: {name: string; durationMs: number}[]`
  (seeded 0/0/[]). In `segmentRuns`, consume `options.hookRuns` (already `afterSequence`-sorted) with a
  cursor: when a tool atom is absorbed into the run, advance the cursor over every entry whose
  `afterSequence < that atom's sequence` — entries passed while the run was EMPTY are dropped (canon's
  `u.messages.length>0` gate); entries passed while the run had ≥1 member are absorbed
  (`hookCount++`, `hookTotalMs += durationMs`, push `{name, durationMs}`). At `flush()`, absorb any remaining
  entries with `afterSequence` ≥ the run's first member sequence and < the flushing atom's sequence (a hook
  landing between the last member and the breaker still belongs — canon absorbs at arrival into the
  still-open run). Cite canon: segmenter arm @162916448, `jar` @162906900. `emit()` spreads
  `...(run.hookCount > 0 ? { } : {})` into counts and `...(run.hookInfos.length > 0 ? { hookInfos } : {})`
  onto the group. Run → PASS.
- [ ] **Step 3: gates + commit** — `npm run typecheck && npx vitest run test/tui/toolFold.test.ts test/tui/fold-expand.test.tsx`;
  `git commit -m "bl7 t-hookblock: fold pipeline absorbs hook pairs by sequence position"`.

### Task 3: rendering — expanded block + collapsed clause/line

**Files:**
- Modify: `src/tui/toolRenderer.tsx` (`expandedMemberItems` ~:990-1019 — append after the flatMap; the
  collapsed-row clause builder `foldClauses` — locate via `grep -n foldClauses src/tui/*.ts`)
- Test: `test/tui/fold-expand.test.tsx` (new describe after the bl6 T-CLUSTER cells ~:260)

**Interfaces:**
- Consumes: `FoldGroup.hookInfos` / `GroupCounts.hookCount` / `hookTotalMs` (Task 2).
- Produces: `hookSeconds(ms: number): string` = `` `${(ms/1000).toFixed(1)}s` `` (canon `ECe` @155015278,
  local to toolFold.ts or toolRenderer.tsx — wherever `foldClauses` lives — exported for tests).

- [ ] **Step 1: failing render tests** — cells pinning (fixture: a group with
  `hookInfos: [{name: "PreToolUse:Read", durationMs: 200}, {name: "PreToolUse:Read", durationMs: 200}]`,
  `hookCount: 2`, `hookTotalMs: 400` — values chosen so `toFixed(1)` has no float-edge ambiguity: 0.35
  would format as "0.3", not "0.4"):
  (a) expanded cluster output contains `  ⎿  Ran 2 PreToolUse hooks (0.4s)` followed by
  `     ⎿ PreToolUse:Read (0.2s)` twice, positioned AFTER every member row and any thinking rows; (b) `hookCount: 1` renders singular `hook`; (c) a hooks-only collapsed run (all other clauses empty
  but hookTotalMs > 0) renders the clause form `Ran 2 PreToolUse hooks (0.4s)` with the COUNT BOLD as the
  sentence; (d) a run with read clauses AND hooks renders the separate dim line
  `  ⎿  Ran 2 PreToolUse hooks (0.4s)` under the summary row (count not bold); (e) zero hooks → no hook
  output anywhere (feature-kill guard: assert the strings are ABSENT). Run → FAIL.
- [ ] **Step 2: implement** — in `expandedMemberItems`, after `entries.flatMap(...)` build the block lines
  (dim; exact gutters; no marginTop — it butts against the last row) and append; tag items with
  `{ foldAnchor: anchorId, expanded: true }` like member rows so hover/click ownership stays coherent. In
  `foldClauses`/the collapsed row builder: port canon's `BM` rule (@177052130/@177053233) — when hooks are
  the ONLY clause, emit the clause form (bold count, verb "Ran" capitalised first); otherwise emit the
  standalone dim `⎿` line after the summary row (find where `latestThinkingSummary`'s "Thought for…" line is
  emitted for the pattern). Check `segmentRuns`' errored-member pop-out (`popsOutOnError` in toolFold.ts):
  add canon's guard — a run with `hookCount > 0` (or memories, N/A here) does not pop out its errored member
  (canon @162916xxx); if the pop-out exists, test it; if the guard is unreachable in ccx's shape, record in
  the report instead. Run → PASS.
- [ ] **Step 3: gates + commit** — `npm run typecheck && npm run test:tui`;
  `git commit -m "bl7 t-hookblock: canon hook block in expanded clusters + collapsed clause/line"`.

### Task 4: pty proof + replay divergence pin

**Files:**
- Modify: `scripts/fake-host.mjs` (`framesFor` ~:46; new `hookcluster` producer after `thinkcluster` ~:134)
- Create: `scripts/hookblock-cells.sh` (copy `scripts/cluster-expand-cells.sh`'s discipline verbatim —
  header lines 1-23: private tmux socket `-L`, isolated HOME/CCX_FLEET_ROOT, teardown by session name, SGR
  bytes from the saved script file only)
- Test: evidence file `.doperpowers/sdd/2026-08-30-bl7-round/t-hookblock-pty-evidence.txt`

**Interfaces:**
- Consumes: the built dist (`npm run build` first — fake-host imports `../dist/fleet/*.js`).
- Produces: `hookcluster` word → frames: Read tool_use → tool_result →
  `{type:"system", subtype:"hook_started", hook_id:"h1", hook_name:"PreToolUse:Read", hook_event:"PreToolUse", uuid:…}` →
  (~50ms later or immediately) matching `hook_response` (`outcome:"success"`, `exit_code:0`) → second Read
  tool_use → tool_result. (Hook pair between the two members: absorbed into the open run.)

- [ ] **Step 1: producer** — add `hookcluster` to `framesFor`; keep uuids distinct per frame.
- [ ] **Step 2: live cell** — `hookblock-cells.sh` cell 1: start fake-host, launch the REAL ccx binary under
  tmux attached to it, push `hookcluster` AFTER attach (live path — hook stamps require live arrival), click
  the cluster row, assert the pane shows `Ran 1 PreToolUse hook (` and `⎿ PreToolUse:Read (` between/after
  the member rows. Collapse-click: target a member row body (clicks in OSC-8 link ranges defer to the link
  pipeline — same caveat as cluster-expand-cells.sh documents).
- [ ] **Step 3: replay cell (A4)** — cell 2: push `hookcluster` BEFORE ccx attaches (replay path); expand the
  cluster; assert member rows present AND the string `PreToolUse` ABSENT — pinning the accepted resume
  divergence (spec D4).
- [ ] **Step 4: feature-kill mutation** — temporarily revert the useChat ingest arm (Task 1); cell 1 must
  FAIL; restore; run cell 1 ≥3 consecutive times + once under load (`yes > /dev/null &` on 2 cores). If the
  kill is probabilistic, quantify over ≥5 runs. Save transcript evidence to the round ledger dir.
- [ ] **Step 5: full gates + commit** — `npm run typecheck && npm run test:unit && npm run test:tui`;
  `git commit -m "bl7 t-hookblock: hookcluster pty cells (live block, replay divergence pinned)"`.

### Task 5: verification — spec acceptance A1-A4

- [ ] Walk spec §5 A1-A4 as written: A1/A2 against the unit/tui suites (name the exact cells), A3/A4 against
  the pty evidence file. Full suite: `npm run typecheck && npm run test:unit && npm run test:tui` all green;
  `bash scripts/hookblock-cells.sh` green; `bash scripts/cluster-expand-cells.sh` and
  `bash scripts/linkopen-cells.sh` still green (no regression in the bl6 cells). Report per-check evidence.
