# Tool-Stream Wave (TS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port canon 2.1.234's fullscreen tool-cluster behavior into ccx: the widened fold policy (all Bash, silent Todo/Task-board absorption, git-op summaries), the live streaming cluster form, and click-to-expand — per the approved spec.

**Architecture:** Three layers, each independently testable. (1) The pure fold model (`toolFold.ts` + `foldPendingState.ts`) gains a `fullscreen` input and the new counts/clauses. (2) The input layer gains a first-class SGR mouse event (`keys/parse.ts` → `keys/types.ts`) routed through a new `useMouseSink` registry slot (`keys/registry.ts` + `keys/KeymapProvider.tsx`) — never the binding table. (3) The fullscreen renderer tags fold-owned rows with their anchor id, publishes a click hitmap, and `ChatApp` owns tap detection + the expansion set + the toggle.

**Tech Stack:** TypeScript ESM, React/Ink (vendored patterns), vitest; canon evidence is `~/claude-code-bundle/2.1.234/cli.pretty.js` via `docs/superpowers/grounding/2026-08-18-tool-stream-ground.md`.

**Spec:** `docs/superpowers/specs/2026-08-18-tool-stream-design.md` (the contract; on conflict the spec governs and the conflict goes to the controller).

## Global Constraints

- All commands run from `CC-to-SDK/harness/`. Gates after every task: `npm run typecheck`, then the scoped suite (`npm run test:unit` / `npm run test:tui` as the task says). **Never `npm test`.**
- House style per `harness/CLAUDE.md`: dense hand-style comments, no Prettier, ESM `.js` import specifiers, DI-by-deps, injected clocks (`Date.now` only via `now()` deps).
- Canon citations in new code name **2.1.234** lines. Shipped 2.1.220 citations are left untouched.
- Never touch `src/appserver/` (owned by a concurrent session).
- Commit per task, message style `f5(ts): <what>`. **No Co-Authored-By. Never push.**
- Live/keyed anything: env via `set -a; . ../.env; set +a`; never print/echo/log either secret. TUI live runs only under an isolated HOME under literal `/tmp` + `CCX_FLEET_ROOT`; prefixed tmux sessions killed individually, never `tmux kill-server`.
- Classic renderer behavior is frozen: every policy widening is gated on the new `fullscreen` flag, default false (spec §2 records the resulting 2.1.234-classic divergence — do not "fix" it).
- WebFetch/WebSearch remain NON-collapsible (spec Decision Log — canon's real policy).

---

### Task 1: Canon re-reads — pop-out consumption + git scraper (research spike)

**Files:**
- Create: `docs/superpowers/grounding/2026-08-18-tool-stream-ground-addendum.md`

**Question this spike answers:** the two mechanisms the spec mandates re-reading (spec §3.1): (a) how canon consumes `popsOutOnError` — can a silently-absorbed call OPEN a run (become `messages[0]`/anchor)? does an error SPLIT the run or relocate the call? (b) `odS`'s git-op recognition rules — which commands/results produce `commits/pushes/branches/prs` entries, and the exact dedup/`gitOpBashCount` bookkeeping.

- [ ] **Step 1: Read canon.** In `~/claude-code-bundle/2.1.234/cli.pretty.js` read: `Krr` (236795–236820), the `iNp` accumulation loop (237092–237240) with special attention to where `popsOutOnError` is consulted and to the `Rka()` init (237020); `odS` (find its definition from the call at 237212) in full; `idS` (237026). Grep for other `popsOutOnError` consumers. Identifiers are minified — search string literals; some lines exceed 165KB, extract windows with `sed -n`/python.
- [ ] **Step 2: Write the addendum.** Same citation discipline as the base grounding doc. Must answer, with verbatim quotes: (a1) can a silent call open a run; (a2) pop-out semantics on error (split / relocate / render-standalone-after); (b1) `odS`'s full recognition table (command patterns, result predicates, sha/branch/PR extraction); (b2) the `bashCount` vs `gitOpBashCount` no-double-count bookkeeping.
- [ ] **Step 3: Reconcile with the spec.** If canon contradicts a spec §3.1 pin (other than the anchor-stability invariant, which is ours regardless), report DONE_WITH_CONCERNS naming the contradiction — the controller updates the spec's Revision Notes.
- [ ] **Step 4: Commit** — `f5(ts): T1 — canon addendum: pop-out consumption + odS scraper`.

---

### Task 2: Probe — per-tool progress stream reachability (research spike)

**Files:**
- Create: `probes/probes/110-tool-progress-stream.ts` (run from `probes/` with `tsx`, keyed via `../.env`)

**Question:** does the installed `@anthropic-ai/claude-agent-sdk` deliver any per-tool progress feed headlessly (canon's `bash_progress`/`mcp_progress` equivalents) — the premise behind the bash `(Ns · N lines)` suffix and mid-flight hint updates (spec §3.1 probe gate)?

- [ ] **Step 1: Write the probe.** Run one query that executes a slow Bash command (`sleep 3 && seq 200`) and an MCP-style long call if cheap; log every SDK message type/subtype received while the tool is in flight (stream events, partial messages, hook payloads). Model: whatever the probe workspace default is; keep it one turn.
- [ ] **Step 2: Run it live** (`set -a; . ../.env; set +a; npx tsx probes/110-tool-progress-stream.ts`). Record verbatim message shapes in a trailing comment block, per probe house style.
- [ ] **Step 3: Report the verdict** — reachable (which field carries elapsed/lines) or not. If NOT reachable: Task 11 shrinks per its own gate and the spec pre-records the divergence (controller does the spec edit).
- [ ] **Step 4: Commit** — `f5(ts): T2 — probe 110: per-tool progress reachability`.

---

### Task 3: Fold policy widening — classify + segment (pure model)

**Files:**
- Modify: `src/tui/toolFold.ts` (`FoldClass`, `classifyToolEvent`, `segmentRuns`, `GroupCounts`, absorb/newRun/emit helpers)
- Test: `test/unit/tool-fold.test.ts` (extend the existing suite; find it via `grep -rl classifyToolEvent test/`)

**Interfaces (produces):**
```ts
export type FoldClass =
  | { collapsible: false }
  | { collapsible: true; kind: "read" | "search" | "list" | "mcp" | "bash" }
  | { collapsible: true; kind: "silent"; popsOutOnError: boolean };
export function classifyToolEvent(event: Pick<ToolEvent, "name" | "input">, opts?: { fullscreen?: boolean }): FoldClass;
// GroupCounts gains: bashCount: number; and (Task 4) the git-op fields.
// FoldGroup gains: bashCommands?: ReadonlyMap<string, string>  (tool-use id → command, fullscreen only)
```
Existing call sites (`toolRenderer.tsx:23` import; the `foldAtoms`/`segmentRuns` pipeline around `toolRenderer.tsx:1010–1046`) compile unchanged when `opts` is omitted — omitted means classic, byte-identical policy.

- [ ] **Step 1: Write failing tests.** Table-driven over `classifyToolEvent`:
  - fullscreen: `Bash("npm run build")` → `{collapsible:true, kind:"bash"}`; `Bash("cat a.ts")` keeps `kind:"read"` (read-ish classification still wins so counters stay canon — 236816 `isBash: !l && c`); `ToolSearch` → `{kind:"silent", popsOutOnError:false}` (canon 236808 absorbs it silently, no pop-out); `TodoWrite`/`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList` → `{kind:"silent", popsOutOnError:true}` (canon `Joi`, 236807/236809); `WebFetch`/`WebSearch`/`Write`/`Edit`/`NotebookEdit`/`Agent`/`Task` → `{collapsible:false}`.
  - classic (no opts): every input above returns exactly what it returns today (pin with the current values — this is A9's model-level guard).
  - `segmentRuns` (fullscreen): a run of Read+Bash("git status")+TodoWrite stays ONE group, `bashCount:1`, TodoWrite in `memberIds` but contributing no count; a TodoWrite whose event carries an error status pops out per Task 1's addendum semantics (write the test to the addendum's answer; if the addendum says split-run, assert two groups).
- [ ] **Step 2: Run** `npx vitest run test/unit/tool-fold.test.ts` — expect FAIL (unknown kinds).
- [ ] **Step 3: Implement.** `classifyToolEvent` fullscreen arms per the table; `segmentRuns` threads `opts.fullscreen` (extend its `options` param), absorbs `silent` members into `memberIds` without counters, records `bashCommands` for `kind:"bash"` AND for read-ish Bash (canon records every bash command for the scraper, 237152), and implements pop-out per the addendum under the spec's invariant: **a pop-out never changes `memberIds[0]` of an already-formed run**.
- [ ] **Step 4: Run the suite; typecheck.** `npm run typecheck && npx vitest run test/unit/tool-fold.test.ts` — PASS.
- [ ] **Step 5: Commit** — `f5(ts): T3 — fullscreen fold policy: bash/silent/pop-out classification`.

---

### Task 4: Git-op scraping + new clauses (pure model)

**Files:**
- Modify: `src/tui/toolFold.ts` (`GroupCounts` git fields, per-result scrape hook in `segmentRuns`'s absorb path, `foldClauses` new clauses)
- Modify: `src/tui/foldPendingState.ts` (ratchet `bashCount`; git arrays are append-only, no ratchet — mirror canon's non-ratcheted Set treatment)
- Test: `test/unit/tool-fold.test.ts`, `test/unit/fold-pending.test.ts` (find via `grep -rl FoldPendingState test/unit/`)

**Interfaces (produces):**
```ts
// GroupCounts gains (all fullscreen-only, absent ⇒ classic):
bashCount: number; gitOpBashCount?: number;
commits?: readonly string[]; pushes?: readonly string[]; branches?: readonly string[]; prs?: readonly string[];
```

- [ ] **Step 1: Write failing tests.**
  - Scrape timing (spec §3.1 + Decision Log): absorbing `Bash("git commit -m x")` with a success result carrying `[main abc123f]`-style output adds the short sha to `commits` **at absorption**, not at flush — assert the OPEN accumulator's group (the trailing growable run) already carries it.
  - No-double-count: that call moves to `gitOpBashCount`; header math (Task 5's clause test) shows "committed abc123f" and NOT "ran 1 shell command".
  - Recognition table: one test per rule Task 1's addendum documents (commit/amend/cherry-pick, push, merge/rebase, `gh pr` verbs), inputs quoted from the addendum.
  - `foldClauses` fullscreen order (grounding §3, 518545–518635): thought → edited → git parts → pushed → merged/rebased → PR → searched for → read → listed → called (MCP) → called N tools → **ran N shell commands** → memory parts; present/past verb pairs exactly per the grounding table; bold ranges on counts; first clause capitalized.
  - Watermark: `latch` ratchets `bashCount` like the four existing counters.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Port `odS`'s rules from the addendum verbatim; extend `foldClauses(counts, active, opts?: { fullscreen?: boolean })` — classic callers unchanged.
- [ ] **Step 4: `npm run typecheck && npm run test:unit` — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T4 — git-op scraping + fullscreen clauses`.

---

### Task 5: Fullscreen projection switch + chip suppression

**Files:**
- Modify: `src/tui/toolRenderer.tsx` (`ProjectionOptions` gains `fullscreen?: boolean`; thread into `classifyToolEvent`/`segmentRuns`/`foldClauses` call sites — the pipeline at :1010–1046 and `groupRowLine`/`groupItems` at :697–760)
- Modify: `src/tui/useChat.ts` (`ProjectionContext` gains `fullscreen`; `projectionContext()` at :249 sets it and sets `expandHint: fullscreen ? "" : expandHintRef.current`)
- Modify: `src/tui/ChatApp.tsx` (pass the renderer identity into useChat's opts — a `isFullscreen: () => boolean` dep sourced from `renderer?.mode === "fullscreen"`, the :299 derivation; useChat holds it in a ref like `fullscreenRef`)
- Test: `test/tui/` — extend the fold-row suite (find via `grep -rl groupRowLine test/tui/ || grep -rl 'Read 2 files' test/tui/`) + one classic-snapshot guard

**Interfaces (consumes):** Task 3/4's opts. **Produces:** every projection call in fullscreen runs the widened policy with no chips; classic path passes no flag.

- [ ] **Step 1: Write failing tests.** (a) Projection with `fullscreen: true` folds a Bash-only run into one group row whose text ends without any `(… to expand)` chip; (b) same items with `fullscreen: false` render today's bytes (snapshot pin — A9's render-level guard); (c) the blanket reach: `hiddenToolUsesLine` and the agent-batch header render hint-free when `expandHint === ""` (they already honor `""` — pin it, since fullscreen now depends on it; spec §3.4).
- [ ] **Step 2: Run — FAIL.** (a) fails: Bash currently stands alone.
- [ ] **Step 3: Implement.** Thread the flag; suppression is the one-line `expandHint` ternary in `projectionContext()` — the three-state `""` contract in `keys/hints.ts` does the rest.
- [ ] **Step 4: `npm run typecheck && npm run test:tui` (scoped file first, then the suite) — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T5 — fullscreen projection flag + blanket chip suppression`.

---

### Task 6: MouseEvent decode (input layer, pure)

**Files:**
- Modify: `src/tui/keys/types.ts` (add `MouseEvent`, extend `InputEvent`)
- Modify: `src/tui/keys/parse.ts` (the SGR branch at :104–108 — after `sgrWheel` declines, try `sgrClick`)
- Test: `test/unit/` keys-parse suite (find via `grep -rl sgrWheel test/ || grep -rl SGR test/unit/`)

**Interfaces (produces):**
```ts
export interface MouseEvent { kind: "mouse"; action: "press" | "release"; button: 0 | 1 | 2; col: number; row: number; ctrl: boolean; alt: boolean; shift: boolean; raw: string }
export type InputEvent = KeyEvent | TextEvent | MouseEvent | IgnoredEvent;
```

- [ ] **Step 1: Write failing tests.** `\x1b[<0;12;5M` → press button 0 col 12 row 5; `\x1b[<0;12;5m` → release; `\x1b[<2;1;1M` → press button 2; `\x1b[<16;3;3M` → ctrl+press; `\x1b[<64;9;9M` stays `wheelup` (order-independence: the `& 64` guard, spec §3.2); `\x1b[<32;5;5M` (motion) stays `ignored("mouse")`; `\x1b[<3;5;5M` (no-button) stays ignored; garbage params stay ignored; wheelGuard is untouched by mouse events (it only inspects `kind === "key"` — pin with one case).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `sgrClick` per the spec's decode rule — `(button & 64) === 0`, `(button & 32) === 0`, `(button & 3) !== 3`; modifiers from bits 16/8/4; 1-based col/row passed through raw.
- [ ] **Step 4: `npm run typecheck && npm run test:unit` — PASS** (the union change may surface exhaustive-switch sites; fix each by handling or explicitly ignoring `"mouse"`).
- [ ] **Step 5: Commit** — `f5(ts): T6 — SGR click decode as first-class MouseEvent`.

---

### Task 7: useMouseSink registry slot + provider routing

**Files:**
- Modify: `src/tui/keys/registry.ts` (add `MouseEntry { seq: number; handler: (e: MouseEvent) => void; active: boolean }` to `Registry`; `mouseHandler(reg)` returns the innermost (max-seq) active entry, mirroring `fallbackHandler` at :84)
- Modify: `src/tui/keys/KeymapProvider.tsx` (in `dispatch`, BEFORE the `ignored` branch at :173: `if (ev.kind === "mouse") { mouseHandler(reg)?.(ev); return; }`; export `useMouseSink(handler, opts?: { active?: boolean })` mirroring `useKeyFallback` at :413)
- Test: the provider suite (find via `grep -rl useKeyFallback test/`)

**Interfaces (produces):** `useMouseSink(handler: (e: MouseEvent) => void, opts?: { active?: boolean }): void` — innermost-wins, render-time registration, F2 registry discipline (spec §3.2: NOT a KeymapDeps callback).

- [ ] **Step 1: Write failing tests.** A registered sink receives press/release events end-to-end from raw bytes through the provider; mouse events never reach `useKeyFallback` handlers, never insert text, never enter the binding table; with no sink registered the event is silently consumed; two sinks → innermost (later seq, active) wins; an inactive sink defers to the outer one; wheel bytes still travel the key path (Scroll binding fires).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Registration/cleanup exactly like the fallback slot (insert on render, remove on unmount, `active` toggles without re-registering).
- [ ] **Step 4: `npm run typecheck && npm run test:unit && npm run test:tui` (provider tests live where they live) — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T7 — useMouseSink registry slot; provider routes mouse off the key path`.

---

### Task 8: Expansion state + re-projection (model→document seam)

**Files:**
- Modify: `src/tui/transcriptModel.ts` (or wherever `RenderItem` is declared — `grep -n "interface RenderItem\|type RenderItem" src/tui/transcriptModel.ts src/tui/render.ts`): add optional `foldAnchor?: string`
- Modify: `src/tui/wrapItems.ts` (`wrapOne`/`wrapItem` propagate `foldAnchor` onto every wrapped row)
- Modify: `src/tui/toolRenderer.tsx` (`ProjectionOptions` gains `expandedFolds?: ReadonlySet<string>`; `groupItems` — when `expandedFolds.has(anchorId)`: emit, instead of the fold row + hint block, each member event's existing per-call verbose items (`renderToolEvent` with the projection's verbose form — the same items the ctrl+o pager renders), every emitted item tagged `foldAnchor: anchorId`; the collapsed fold row and its active hint block are tagged `foldAnchor: anchorId` too)
- Modify: `src/tui/useChat.ts` (own `expandedFoldsRef: Set<string>` + a state tick; expose `toggleFold(anchor: string): void` on the hook's return — flips membership and re-runs the same finalized-items re-projection the reconcile path uses (:961 area); thread `expandedFolds` through `projectionContext()`; clear the set at every `pendingStateRef.current.reset()` call site — `grep -n "\.reset()" src/tui/useChat.ts`)
- Test: `test/unit/wrap-items.test.ts` (or the existing wrapItems suite) + a new `test/tui/fold-expand.test.tsx`

**Interfaces (produces):** `toggleFold(anchor)` on useChat's return; `foldAnchor` on RenderItem, survives wrapping. **Consumes:** Task 3's `memberIds` (anchor = `memberIds[0]`).

- [ ] **Step 1: Write failing tests.** (a) `wrapItem` on a tagged over-wide item: every wrapped row carries the tag; (b) projection with anchor in `expandedFolds`: fold row gone, member per-call items present, ALL tagged with the anchor — including a silently-absorbed TodoWrite member (spec A6: members appear when expanded); (c) toggle round-trip through useChat: `toggleFold(a)` re-projects finalizedItems (fold row → members), second call restores; (d) reset discipline: after the `/clear`-path reset, the set is empty; (e) **the A10 pin**: with a run still OPEN (trailing growable), toggle the anchor, then absorb another member — the projection still renders expanded and now includes the new member (this is the cell that fails an item-id-keyed implementation).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run typecheck && npm run test:unit && npm run test:tui` — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T8 — anchor-keyed expansion state + member re-projection`.

---

### Task 9: Hitmap — viewport row-map + frame origin

**Files:**
- Modify: `src/tui/FullscreenFrame.tsx` (publish the region's absolute top row through the same context that grants rows — `grep -n useRegionRows src/tui/*.tsx` finds the channel; the frame owns the answer, spec §3.3: no implicit "row 1" invariant)
- Modify: `src/tui/FullscreenViewport.tsx` (`FullscreenViewportProps` gains `hitmapRef?: React.Ref<ViewportHitmap>`; each render rebuilds the map from the exact slice it paints)
- Test: `test/tui/fold-hitmap.test.tsx`

**Interfaces (produces):**
```ts
export interface ViewportHitmap { anchorAt(col: number, row: number): string | undefined }  // 1-based terminal coords
```
Resolution: terminal row → slice row via the frame-published top + the viewport's own layout (jump-pill row excluded); slice row → its RenderItem; return `item.foldAnchor`, but only when `col ≤` that row's plain-text width (`RenderLine.text` length — the column bound, spec §3.3; canon drops blank-cell clicks, 549361). Everything else — pill, dock rows, blank tail, untagged items — `undefined`.

- [ ] **Step 1: Write failing tests.** Render a viewport (fakeTty + ink-testing per house pattern) whose document holds a tagged fold row among plain rows: `anchorAt` hits the fold row's terminal row within text width → anchor; same row past text width → undefined; a plain row → undefined; scroll one line (`scroll` handle) → the mapping shifts with the offset; the pill row (force a scrolled-up state) → undefined; wrapped tagged item: BOTH its painted rows resolve.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** The map is derived in the same pass that slices (`pageItemSlices` output) — no second layout walk; published via `useImperativeHandle` beside the scroll handle (:165).
- [ ] **Step 4: `npm run typecheck && npm run test:tui` — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T9 — click hitmap: frame origin + anchor row-map with column bound`.

---

### Task 10: Tap detection + wiring (ChatApp)

**Files:**
- Modify: `src/tui/ChatApp.tsx` (a `hitmapRef` passed to the `FullscreenViewport` mount at :1189; a `useMouseSink` handler owning tap state; the dialog gate; `chat.toggleFold` on a resolved hit)
- Test: `test/tui/fold-click.test.tsx`

**Interfaces (consumes):** T6 events, T7 sink, T8 `toggleFold`, T9 `anchorAt`.

**The tap rule (spec §3.2, verbatim):** `press(button 0)` records `(col,row)`; `release` at the SAME cell → click; release elsewhere, a second press, or **any wheel key event in between** discards the anchor (the wheel discard hooks the same place the sink lives — a small `onWheel` note from the existing wheel path, or simply: the sink handler also observes `wheelup/wheeldown` via a ref the scroll handler already touches; pick the least invasive and say which in the report). Modified clicks (ctrl/alt/shift) ignored. **The gate (spec §3.3):** clicks act only when the viewport is the live region tenant and no dialog owns the screen — `fullscreen && !transcriptOpen && !paneOwned && !state.historyOpen && !footerState.searching` plus the seam-modal state the T13 seam slot renders (read the :1190–1210 region for the exact booleans; the scroll-key gate is deliberately looser and is NOT this gate).

- [ ] **Step 1: Write failing tests.** Feed raw SGR bytes through the real provider into a mounted ChatApp-level harness (house pattern from existing `test/tui/` keyboard tests): (a) press+release on a fold row toggles expansion (items change); (b) press+release again collapses; (c) press at (5,7) release at (9,7) → nothing; (d) press, wheel tick, release same cell → nothing; (e) with a decision dialog open, the same tap → nothing; (f) with the pager open (ctrl+o), tap → nothing; (g) ctrl+click → nothing.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run typecheck && npm run test:tui` — PASS. Also `npm run test:unit` (the union may reach shared helpers).**
- [ ] **Step 5: Commit** — `f5(ts): T10 — tap detection, dialog gate, click→toggle wiring`.

---

### Task 11: Live dressing — elapsed ticker + bash suffix (gated by Task 2)

**Files:**
- Modify: `src/tui/toolFold.ts` / `src/tui/toolRenderer.tsx` (the active group row gains: per-tool elapsed `· N.Ns` once the newest in-flight member has run ≥ 2 s, canon 518661/518664; bash `(Ns · N lines)` suffix once ≥ 2 s, canon 518516–518530 — ONLY if probe 110 found a feed; hint sources gain bash commands via the existing `commandHint`)
- Modify: `src/tui/foldPendingState.ts` if the ticker needs per-anchor in-flight timestamps (injected clock)
- Test: extend the fold-row suite (fake clock)

**Gate:** if probe 110 found NO per-tool progress feed, the bash suffix is CUT (controller records the divergence in the spec; do not fake it from wall-clock) and this task ships the elapsed ticker only — the ticker needs only the member's local start time, which the transcript already clocks.

- [ ] **Step 1: Write failing tests** for whichever halves survive the gate: no ticker under 2 s; `· 2.0s`-form at ≥ 2 s anchored to the newest in-flight member; ticker absent on settled rows; (if feed exists) suffix rendering + its 2 s gate.
- [ ] **Step 2: Run — FAIL. Step 3: Implement. Step 4: suites + typecheck PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T11 — live cluster dressing (per probe-110 gate)`.

---

### Task 12: Keyed live acceptance — spec §4 as written

**Files:**
- Create: `test/live/tool-stream-acceptance.md` run log or the wave's acceptance script under the existing live-test pattern (`ls test/live/` and follow the house form; tmux driver, isolated HOME under /tmp, CCX_FLEET_ROOT)

- [ ] **Step 1: Build** (`npm run build`).
- [ ] **Step 2: Run every spec §4 cell as written** — A1 through A10, quoting the spec's exact expected strings. A4/A10's click bytes are printf'd into the pty: `printf '\x1b[<0;COL;ROWM\x1b[<0;COL;ROWm'` (target a column inside the cluster text). A8 re-runs the BL5 pokes (wheel scroll, Shift/Option select, 75 ms arrow suppression) and the three scoped suites: `npm run test:unit && npm run test:tui && npm run test:resize-matrix`.
- [ ] **Step 3: Record the matrix** (cell → pass/fail with evidence) in the run log. Any FAIL → report BLOCKED with the transcript; do NOT mark the cell "close enough".
- [ ] **Step 4: Commit** — `f5(ts): T12 — live acceptance A1–A10`.

---

### Task 13: Close-out — scorecard + spec tail

**Files:**
- Modify: `docs/parity/coverage.md` (the fullscreen/transcript rows this wave moves)
- Modify: `docs/superpowers/specs/2026-08-18-tool-stream-design.md` (Outcomes & Retrospective; Surprises & Discoveries with anything Tasks 1–12 overturned)

- [ ] **Step 1: Refresh `coverage.md`** — honest deltas only, citing the acceptance matrix.
- [ ] **Step 2: Write the spec's Outcomes & Retrospective**; fold Task 1/2 findings into Surprises & Discoveries if not already there.
- [ ] **Step 3: Commit** — `f5(ts): T13 — coverage + spec close-out`.

---

## Self-review notes (author)

- Spec coverage: §3.1 → T1/T3/T4/T5/T11; §3.2 → T6/T7/T10; §3.3 → T8/T9/T10; §3.4 → T5; §4 → per-task tests + T12; §5 probe gate → T2/T11. A1–A10 all land in T12 verbatim.
- Type consistency: `FoldClass.kind:"bash"|"silent"` (T3) is what T4's counting and T8's member emission consume; `foldAnchor` (T8) is what T9 resolves and T10 toggles via `toggleFold(anchor)`; `MouseEvent` (T6) is what T7's sink and T10's handler receive.
- Deliberate non-verbatim points, each with its source named: the odS rule table and pop-out semantics come from T1's addendum (spec-mandated re-read — inlining guesses here would be worse than the reference); suite/file discovery uses greps because the harness names its test files by feature and the implementer must land in the real one, not one this plan guessed.
