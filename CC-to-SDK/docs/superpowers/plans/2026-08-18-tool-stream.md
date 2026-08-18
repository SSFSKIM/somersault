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
- Create: `probes/probes/100-tool-progress-stream.ts` (next free number — highest existing is 99; run from `probes/` with `tsx`, keyed via `../.env`)

**Question:** does the installed `@anthropic-ai/claude-agent-sdk` deliver any per-tool progress feed headlessly (canon's `bash_progress`/`mcp_progress` equivalents) — the premise behind the bash `(Ns · N lines)` suffix and mid-flight hint updates (spec §3.1 probe gate)?

- [ ] **Step 1: Write the probe.** Run one query that executes a slow Bash command (`sleep 3 && seq 200`) and an MCP-style long call if cheap; log every SDK message type/subtype received while the tool is in flight (stream events, partial messages, hook payloads). Model: whatever the probe workspace default is; keep it one turn.
- [ ] **Step 2: Run it live** (`set -a; . ../.env; set +a; npx tsx probes/100-tool-progress-stream.ts`). Record verbatim message shapes in a trailing comment block, per probe house style.
- [ ] **Step 3: Report the verdict** — reachable (which field carries elapsed/lines) or not. If NOT reachable: Task 11 shrinks per its own gate and the spec pre-records the divergence (controller does the spec edit).
- [ ] **Step 4: Commit** — `f5(ts): T2 — probe 100: per-tool progress reachability`.

---

### Task 3: Fold policy widening — classify + segment (pure model)

**Files:**
- Modify: `src/tui/toolFold.ts` (`FoldClass`, `classifyToolEvent`, `segmentRuns`, `GroupCounts`, absorb/newRun/emit helpers)
- Modify: `src/tui/toolRenderer.tsx` (`foldAtoms` at :1015 ONLY — see the suppression gate below)
- Test: `test/tui/toolFold.test.ts` (the existing fold suite — the only home of `classifyToolEvent`/`segmentRuns`/`foldClauses` tests; there is no `test/unit` fold file)

**Interfaces (produces):**
```ts
export type FoldClass =
  | { collapsible: false }
  | { collapsible: true; kind: "read" | "search" | "list" | "mcp" | "bash" }
  | { collapsible: true; kind: "silent"; popsOutOnError: boolean };
export function classifyToolEvent(event: Pick<ToolEvent, "name" | "input">, opts?: { fullscreen?: boolean }): FoldClass;
// GroupCounts gains: bashCount?: number  (optional — absent ⇒ classic; keeps the three existing
// GroupCounts literals in test/tui/{toolFold,foldPendingState,sgr-foldrow}.test.ts compiling).
// FoldGroup gains: bashCommands?: ReadonlyMap<string, string>  (tool-use id → command, fullscreen only)
```
Existing call sites (`toolRenderer.tsx:23` import; the `foldAtoms`/`segmentRuns` pipeline around `toolRenderer.tsx:1010–1046`) compile unchanged when `opts` is omitted — omitted means classic, byte-identical policy.

**The suppression gate (load-bearing — without it `silent` is dead code for three of five tools):**
`foldAtoms` (`toolRenderer.tsx:1015`) diverts `isSuppressedTool` names (`SUPPRESSED =
["TaskCreate","TaskUpdate","ToolSearch"]`, `src/tui/toolResult.ts:17`) to `neutral` atoms BEFORE
`segmentRuns` ever sees them — so they could never reach `classifyToolEvent` or enter `memberIds`,
while TodoWrite/TaskGet/TaskList (not suppressed) would. Under `fullscreen`, `foldAtoms` must let
suppressed tools through as `tool` atoms so the silent classification governs them uniformly.
Classic keeps the diversion — byte-identical.

Structural note for the implementer: `classifyToolEvent` returns for mcp/Glob/Grep/Read BEFORE any
Bash logic, and the Bash read-ish classification must still win over the new `"bash"` kind (canon
236816 sets `isBash: !l && c` — bash-kind only when NOT read-ish), so the fullscreen arm is reached
after the existing checks, not before.

- [ ] **Step 1: Write failing tests.** Table-driven over `classifyToolEvent`:
  - fullscreen: `Bash("npm run build")` → `{collapsible:true, kind:"bash"}`; `Bash("cat a.ts")` keeps `kind:"read"` (read-ish classification still wins so counters stay canon — 236816 `isBash: !l && c`); `ToolSearch` → `{kind:"silent", popsOutOnError:false}` (canon 236808 absorbs it silently, no pop-out); `TodoWrite`/`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList` → `{kind:"silent", popsOutOnError:true}` (canon `Joi`, 236807/236809); `WebFetch`/`WebSearch`/`Write`/`Edit`/`NotebookEdit`/`Agent`/`Task` → `{collapsible:false}`.
  - classic (no opts): every input above returns exactly what it returns today (pin with the current values — this is A9's model-level guard).
  - `segmentRuns` (fullscreen): a run of Read+Bash("git status")+TodoWrite stays ONE group, `bashCount:1`, TodoWrite in `memberIds` but contributing no count; a **ToolSearch** likewise lands in `memberIds` (this fails until the suppression gate lands); a TodoWrite whose event carries an error status pops out per Task 1's addendum semantics (write the test to the addendum's answer; if the addendum says split-run, assert two groups).
- [ ] **Step 2: Run** `npx vitest run test/tui/toolFold.test.ts` — expect FAIL (unknown kinds).
- [ ] **Step 3: Implement.** `classifyToolEvent` fullscreen arms per the table; the `foldAtoms` suppression gate; `segmentRuns` threads `opts.fullscreen` (extend its `options` param), absorbs `silent` members into `memberIds` without counters, records `bashCommands` for `kind:"bash"` AND for read-ish Bash (canon records every bash command for the scraper, 237152), and implements pop-out per the addendum under the spec's invariant: **a pop-out never changes `memberIds[0]` of an already-formed run**.
- [ ] **Step 4: Run the suite; typecheck.** `npm run typecheck && npm run test:tui` — PASS.
- [ ] **Step 5: Commit** — `f5(ts): T3 — fullscreen fold policy: bash/silent/pop-out classification`.

---

### Task 4: Git-op scraping + new clauses (pure model)

**Files:**
- Modify: `src/tui/toolFold.ts` (`GroupCounts` git fields, per-result scrape hook in `segmentRuns`'s absorb path, `foldClauses` new clauses)
- Modify: `src/tui/foldPendingState.ts` (ratchet the GROSS `bashCount`, exactly like the four existing counters — the subtraction happens later, at clause time; git arrays are append-only, no ratchet — mirror canon's non-ratcheted Set treatment)
- Test: `test/tui/toolFold.test.ts`, `test/tui/foldPendingState.test.ts` (the existing suites — there are no `test/unit` fold files)

**Interfaces (produces — `bashCount` is Task 3's; this task adds only the git fields, all optional/fullscreen-only):**
```ts
gitOpBashCount?: number;
// SHIPPED SHAPES (corrected after Task 4 — bare strings cannot carry canon's commit `kind`
// buckets or its ten PR action verbs, so the arrays hold records, exported from `src/tui/gitOps.ts`):
commits?: readonly GitCommitOp[];   // { sha, kind: "committed"|"amended"|"cherry-picked", branch? }
pushes?: readonly GitPushOp[];      // { branch }
branches?: readonly GitBranchOp[];  // { ref, action: "merged"|"rebased" }
prs?: readonly GitPrOp[];           // { number, url?, action }  — `url` is carried but NOT rendered; see below
```

- [ ] **Step 1: Write failing tests.**
  - Scrape timing (spec §3.1 + Decision Log): absorbing `Bash("git commit -m x")` with a success result carrying `[main abc123f]`-style output adds the short sha to `commits` **at absorption**, not at flush — assert the OPEN accumulator's group (the trailing growable run) already carries it.
  - No-double-count — **a subtraction, NOT a transfer** (spec §3.1 as corrected in Revision Notes round 3; canon 518466–518467 verbatim `le = Ns() ? Math.max(0, P.current - Z) : 0`): `bashCount` stays GROSS, `gitOpBashCount` is a parallel tally bumped once per result that yielded any op, and the shell clause prints `max(0, ratchet(bashCount) - gitOpBashCount)`. Decrementing `bashCount` at absorption instead latches the clause at its pre-git value forever, because the watermark ratchet never falls — a silent lie, not a crash. Cells must assert the shell clause DISAPPEARING as a git op is recognized (one bash call, recognized as a commit ⇒ "committed abc123f" and NO "ran 1 shell command"), and must include a two-call case (one git, one plain ⇒ both clauses, "ran 1 shell command").
  - Recognition table: one test per rule Task 1's addendum documents (commit/amend/cherry-pick, push, merge/rebase, `gh pr` verbs), inputs quoted from the addendum.
  - `foldClauses` fullscreen order (grounding §3, 518545–518635): thought → edited → git parts → pushed → merged/rebased → PR → searched for → read → listed → called (MCP) → called N tools → **ran N shell commands** → memory parts; present/past verb pairs exactly per the grounding table; bold ranges on counts; first clause capitalized.
  - Watermark: `latch` ratchets `bashCount` like the four existing counters.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Port `odS`'s rules from the addendum verbatim, with the two deliberate departures the spec records (the `--amend` test runs against the same quote-stripped command string the other flag tests use, and each tool_use_id is scraped at most once per result batch); canon consults NO exit code and neither do we — recognition is output-shape only; extend `foldClauses(counts, active, opts?: { fullscreen?: boolean })` — classic callers unchanged.
- [ ] **Step 4: `npm run typecheck && npm run test:tui` — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T4 — git-op scraping + fullscreen clauses`.

---

### Task 5: Fullscreen projection switch + chip suppression

**Files:**
- Modify: `src/tui/toolRenderer.tsx` (`ProjectionOptions` gains `fullscreen?: boolean`; thread into `classifyToolEvent`/`segmentRuns`/`foldClauses` call sites — the pipeline at :1010–1046, `groupRowLine`/`groupItems` at :695/:731, **and `trailingRunCut` at :1034–1038**, whose bare `classifyToolEvent(atom.event)` call must take the flag: unthreaded, a fullscreen run ending in a non-read Bash is not recognized as growable, and the group is emitted into `finalizedItems` while `projectPending` also draws it — two cluster rows on screen)
- Modify: `src/tui/useChat.ts` (`ProjectionContext` gains `fullscreen`; `projectionContext()` at :249 sets it and sets `expandHint: fullscreen ? "" : expandHintRef.current`)
- Modify: `src/tui/ChatApp.tsx` (pass the renderer identity into useChat's opts — a `isFullscreen: () => boolean` dep sourced from `renderer?.mode === "fullscreen"`, the :299 derivation; useChat holds it in a ref. Deliberate: useChat already receives `opts.rendererChoice`, but that prop can be absent while ChatApp's own derivation is the fullscreen truth the mount at :1189 uses — thread ChatApp's boolean, and say so in a comment so the two channels don't look like an oversight)
- Test: `test/tui/` — extend the fold-row suite (find via `grep -rl groupRowLine test/tui/`) + one classic-snapshot guard

**Both `foldClauses` call sites must take the flag (Task 4 review, finding 6).** `:700` builds the
sentence — miss it and the header is merely wrong. `:743` is the group SUPPRESSION gate
(`if (foldClauses(counts, active).length === 0) return []`) — miss it and a fullscreen run of only
non-read Bash calls has no clause to speak, so the entire row VANISHES. The second failure is the
quiet one; write a cell for it, not just for the first.

**Interfaces (consumes):** Task 3/4's opts. **Produces:** every projection call in fullscreen runs the widened policy with no chips; classic path passes no flag.

- [ ] **Step 1: Write failing tests.** (a) Projection with `fullscreen: true` folds a Bash-only run into one group row whose text ends without any `(… to expand)` chip; (b) same items with `fullscreen: false` render today's bytes (snapshot pin — A9's render-level guard); (c) the blanket reach: `hiddenToolUsesLine` and the agent-batch header render hint-free when `expandHint === ""` (they already honor `""` — pin it, since fullscreen now depends on it; spec §3.4); (d) **single-cluster invariant**: a fullscreen run whose LAST member is an open `Bash("npm run build")` appears exactly once across `finalizedItems ⧺ pendingItems` (the `trailingRunCut` cell); (e) **membership integration**: a ToolSearch inside a fullscreen run lands in the group's `memberIds` end-to-end through the real `foldAtoms` pipeline (guards Task 3's suppression gate at the integration layer).
- [ ] **Step 2: Run — FAIL.** (a) fails: Bash currently stands alone.
- [ ] **Step 3: Implement.** Thread the flag; suppression is the one-line `expandHint` ternary in `projectionContext()` — the three-state `""` contract in `keys/hints.ts` does the rest. Note: the `""` also reaches `detailItems` (`useChat.ts:1176`), so the ctrl+o pager loses its `backgroundedHint`/`hiddenToolUsesLine` chips in fullscreen too — that is canon-faithful (canon's Ett suppression covers its overlay as well, grounding §7) and the spec's §3.4 has been corrected to say so; pin one pager row in the tests rather than treating it as a leak.
- [ ] **Step 4: `npm run typecheck && npm run test:tui` (scoped file first, then the suite) — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T5 — fullscreen projection flag + blanket chip suppression`.

---

### Task 5b: Renderer-flip replay integrity (created by Task 5's review)

**Files:**
- Modify: `src/tui/ChatApp.tsx` (the flip path — `switchRenderer` in `chatMain`, and the `staticEpoch`-keyed `Transcript` mount at :1183–1189)
- Modify: `src/tui/useChat.ts` (a re-projection entry point for already-committed items; `reconcile()` at :954–981 is the existing re-projection, `replaceDocument` at :1104 the existing wholesale reset)
- Test: `test/tui/tui-switch.test.tsx` (the suite that already pins the replay invariant — its transcripts currently have no fold divergence, which is why it stays green through the defect)

**The defect, measured by Task 5's reviewer:** fullscreen commits rows into `state.staticItems` while its `<Static>` holds `EMPTY_ITEMS` (`ChatApp.tsx:1185`), so they are never painted. Flipping back re-emits them all (the documented `N → 0 → N` re-emit), and the next document mutation re-projects classically, finds the per-call ids unspent, and APPENDS them below. Measured after one flip and one prompt: `Ran 2 shell commands` (5 writes) and `Bash(npm run build)` (4 writes) both on screen for the same two calls. `ChatApp.tsx:1154–1156` pins that this must not happen ("The replay must REPLACE"), and Ink's static buffer only grows, so it compounds per flip.

**The approach (verify before building — if the mechanism does not hold, report BLOCKED with what you found rather than improvising):** on flip, re-project the committed items under the NEW renderer's policy and remount through the existing `staticEpoch` key. A keyed remount deletes and re-creates in one commit — the same machinery `/clear` and rewind already use, and the same commit-ordering argument that keeps `rootNode.staticNode` safe (the T17 crash-fix paragraph at :1157–1167, which must NOT be regressed: nothing may leave the `<Static>` unmounted with nothing taking its place). Clearing the transcript instead is REJECTED — it costs the user their history.

- [ ] **Step 1: Write the failing test.** Extend `tui-switch.test.tsx` with a transcript whose two policies genuinely diverge (a run of two non-read `Bash` calls: one cluster row in fullscreen, two per-call rows in classic). Flip fullscreen → classic, mutate the document once, assert each call's bytes appear EXACTLY once. This is the cell the current suite lacks.
- [ ] **Step 2: Run — FAIL** (both shapes present).
- [ ] **Step 3: Implement.** Re-project + keyed remount on flip, both directions.
- [ ] **Step 4: `npm run typecheck && npm run test:tui` — PASS**, including `fullscreen-frame.test.tsx`'s assertion that no committed row reaches the alternate screen.
- [ ] **Step 5: Commit** — `f5(ts): T5b — flip replay re-projects and replaces`.

---

### Task 6: MouseInputEvent decode (input layer, pure)

**Files:**
- Modify: `src/tui/keys/types.ts` (add `MouseInputEvent`, extend `InputEvent`)
- Modify: `src/tui/keys/parse.ts` (the SGR branch at :104–108 — after `sgrWheel` declines, try `sgrClick`)
- Test: `test/tui/keys-parse.test.ts` (the existing parse suite)

**Interfaces (produces):**
```ts
export interface MouseInputEvent { kind: "mouse"; action: "press" | "release"; button: 0 | 1 | 2; col: number; row: number; ctrl: boolean; alt: boolean; shift: boolean; raw: string }
export type InputEvent = KeyEvent | TextEvent | MouseInputEvent | IgnoredEvent;
```
The name is `MouseInputEvent`, NOT `MouseEvent`: the tsconfig has no `lib` override, so DOM's global
`MouseEvent` is in scope — a file that forgets the import would silently bind the DOM type and
typecheck clean. Every later task uses `MouseInputEvent`.

- [ ] **Step 1: Write failing tests.** `\x1b[<0;12;5M` → press button 0 col 12 row 5; `\x1b[<0;12;5m` → release; `\x1b[<2;1;1M` → press button 2; `\x1b[<16;3;3M` → ctrl+press; `\x1b[<64;9;9M` stays `wheelup` (order-independence: the `& 64` guard, spec §3.2); `\x1b[<32;5;5M` (motion) stays `ignored("mouse")`; `\x1b[<3;5;5M` (no-button) stays ignored; garbage params stay ignored; wheelGuard is untouched by mouse events (it only inspects `kind === "key"` — pin with one case).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `sgrClick` per the spec's decode rule — `(button & 64) === 0`, `(button & 32) === 0`, `(button & 3) !== 3`; modifiers from bits 16/8/4; 1-based col/row passed through raw.
- [ ] **Step 4: `npm run typecheck && npm run test:tui` — PASS** (the union change may surface consumers; `wheelGuard` tests `kind !== "key"` and is safe, `dispatch` is Task 7's).
- [ ] **Step 5: Live premise check (spec §5 — before anything is built on it).** In a tmux pane running a trivial raw-mode reader (or `ccx` itself) with `MOUSE_ON_SCROLL` armed (`src/tui/altScreen.ts:51` — `?1000h ?1006h`), physically click and capture the bytes: confirm press `\x1b[<0;C;RM` and release `\x1b[<0;C;Rm` arrive under mode 1000 in the tracked terminal. Record the captured bytes in the task report. If they do NOT arrive, STOP and report BLOCKED — the wave's click premise fails and the controller must re-plan.
- [ ] **Step 6: Commit** — `f5(ts): T6 — SGR click decode as first-class MouseInputEvent`.

---

### Task 7: useMouseSink registry slot + provider routing

**Files:**
- Modify: `src/tui/keys/registry.ts` (add `MouseEntry { seq: number; handler: (e: MouseInputEvent) => void; active: boolean }` to `Registry`; `mouseHandler(reg)` returns the innermost (max-seq) active entry, mirroring `fallbackHandler` at :84)
- Modify: `src/tui/keys/KeymapProvider.tsx` (in `dispatch`, BEFORE the `ignored` branch at :173: `if (ev.kind === "mouse") { mouseHandler(reg)?.(ev); return; }`; export `useMouseSink(handler, opts?: { active?: boolean })` mirroring `useKeyFallback` at :413)
- Test: the provider suite (find via `grep -rl useKeyFallback test/`)

**Interfaces (produces):** `useMouseSink(handler: (e: MouseInputEvent) => void, opts?: { active?: boolean }): void` — innermost-wins, render-time registration, F2 registry discipline (spec §3.2: NOT a KeymapDeps callback).

- [ ] **Step 1: Write failing tests.** A registered sink receives press/release events end-to-end from raw bytes through the provider; mouse events never reach `useKeyFallback` handlers, never insert text, never enter the binding table; with no sink registered the event is silently consumed; two sinks → innermost (later seq, active) wins; an inactive sink defers to the outer one; wheel bytes still travel the key path (Scroll binding fires).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Registration/cleanup exactly like the fallback slot (insert on render, remove on unmount, `active` toggles without re-registering).
- [ ] **Step 4: `npm run typecheck && npm run test:unit && npm run test:tui` (provider tests live where they live) — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T7 — useMouseSink registry slot; provider routes mouse off the key path`.

---

### Task 8: Expansion state + re-projection (model→document seam)

**Files:**
- Modify: `src/tui/toolRenderer.tsx` — `RenderItem` is the two-arm union at **:48**; BOTH arms gain optional `foldAnchor?: string`
- Modify: `src/tui/wrapItems.ts` — propagation is load-bearing in exactly one arm: `wrapOne`'s wrapped-LINE arm (**:161**) mints `{ kind: "line", id, line }` fresh and drops the tag; the gutter-block spread at :154 and both identity returns keep it. Fix the :161 arm; pin all four.
- Modify: `src/tui/toolRenderer.tsx` (`ProjectionOptions` gains `expandedFolds?: ReadonlySet<string>`; `groupItems` — when `expandedFolds.has(anchorId)`: emit, instead of the fold row + hint block, each member's per-call items, every emitted item tagged `foldAnchor: anchorId`; the collapsed fold row and its active hint block are tagged too. **Member rendering is a fresh render, not a reuse**: `groupItems` has only `memberIds` — look each event up via `options.toolEvents` (set by both `projectAll` :980 and `projectPending` :1103) and call `renderToolEvent(event, normalizeToolResult(event, …), …)` itself, **in the DETAIL form** (`projection: "detail-all"`-equivalent options — canon's expanded branch renders the full listing, grounding §4, and it is what the ctrl+o pager shows; the compact form would clip an expanded Read to three rows). A member whose normalized status is `suppressed` (ToolSearch/TaskCreate/TaskUpdate — `toolEventItems` returns `[]` at :377) renders its generic header row instead of nothing: canon's expanded cluster shows every absorbed `tool_use`, and A6 pins it.)
- Modify: `src/tui/useChat.ts` (own `expandedFoldsRef: Set<string>` + a state tick; expose `toggleFold(anchor: string): void` on the hook's return — flips membership and calls **`reconcile()`** (:954–981), which re-projects BOTH `finalizedItems` AND `pendingItems` — the trailing growable run lives in the pending projection (`projectPending`, :1029–1031 consumer), so a finalized-only reproject leaves a live cluster collapsed until the next blink, and there is NO blink once all members settled with no breaker. Thread `expandedFolds` through `projectionContext()`. Clear the set in exactly one place: `replaceDocument` (**:1104**) — the one relevant `.reset()` site (the other `.reset()` greps hit task/bg refs); also clear it when the fullscreen flag flips off (renderer switch), bounding the mixed-record replay below.)
- Test: `test/tui/` — the existing wrapItems suite (`grep -rl wrapItem test/tui/`) + a new `test/tui/fold-expand.test.tsx`

**Known limitation (recorded, not fixed here):** `reconcile()` keeps publishing into
`publishedIds`/`staticItems` even in fullscreen (`ChatApp.tsx:1165` note), so items committed while
a cluster was expanded stay in the classic replay after a later `/tui default`. Clearing the set on
renderer switch bounds it going forward; the already-committed rows are a recorded divergence —
same family as the fullscreen wave's "answers commit whole" trade. Task 13 records it in the spec.

**Interfaces (produces):** `toggleFold(anchor)` on useChat's return; `foldAnchor` on RenderItem, survives wrapping. **Consumes:** Task 3's `memberIds` (anchor = `memberIds[0]`).

**Inherited obligation from Task 3 (spec §3.1 round 6) — the de-dup:** an errored
`popsOutOnError` call that STAYED in its run is now emitted standalone *and* left in
`memberIds` (canon splits the call row from the error row; our atoms carry both together, so
the same call would render twice). When expanding, `groupItems` must SKIP any member the
projection already emitted as its own item. Nothing in the fold model can enforce this — the
code comment at `toolFold.ts` (the pop-out branch) points here. Pin it: a cell with an errored
TodoWrite staying inside a run with a visible member, expanded, asserting the errored call
appears EXACTLY once in the projected items.

- [ ] **Step 1: Write failing tests.** (a) `wrapItem` on a tagged over-wide item: every wrapped row carries the tag (both arms; the :161 line-arm is the one that fails first); (b) projection with anchor in `expandedFolds`: fold row gone, member per-call items present in DETAIL form, ALL tagged with the anchor — including a silently-absorbed TodoWrite member AND a suppressed-status ToolSearch member rendering its generic row (spec A6); (b2) the de-dup cell named in the inherited obligation above — an errored TodoWrite that stayed in a run with a visible member appears exactly once when that run is expanded; (c) toggle round-trip through useChat: `toggleFold(a)` re-projects (fold row → members), second call restores; (d) reset discipline: after `replaceDocument`, the set is empty; (e) **the A10 pin, against `pendingItems`**: with a run still OPEN (trailing growable — it lives in the PENDING projection, not finalized), toggle the anchor, assert `pendingItems` now carries the members, then absorb another member — still expanded, new member present (this is the cell that fails both an item-id-keyed implementation and a finalized-only reproject).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run typecheck && npm run test:unit && npm run test:tui` — PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T8 — anchor-keyed expansion state + member re-projection`.

---

### Task 9: Hitmap — viewport row-map + frame origin

**Files:**
- Modify: `src/tui/FullscreenFrame.tsx` — publish the region's absolute top row as a SIBLING context
  (`RegionTopContext` + `useRegionTop()`), NOT by reshaping the existing channel:
  `RegionRowsContext = createContext(0)` (:98–99) is a bare number with three consumers plus a test
  (`FullscreenViewport.tsx:127`, `RegionPager.tsx:48`, `test/tui/fullscreen-overlays.test.tsx:116`)
  that would all break on a shape change. Be honest about what is published: Ink exposes no absolute
  terminal coordinates, so the frame cannot MEASURE its top — it publishes the computed constant `1`
  (the region is the frame's first band; the frame header records the dock's last row as `rows − 1`).
  Explicit-computed still beats implicit (spec §3.3): the day a banner lands above the region, the
  constant's owner is one named line.
- Modify: `src/tui/FullscreenViewport.tsx` (`FullscreenViewportProps` gains `hitmapRef?: React.Ref<ViewportHitmap>`; each render rebuilds the map from the exact slice it paints)
- Test: `test/tui/fold-hitmap.test.tsx`

**Interfaces (produces):**
```ts
export interface ViewportHitmap { anchorAt(col: number, row: number): string | undefined }  // 1-based terminal coords
```
Resolution: terminal row → slice row via the frame-published top + the viewport's own layout (jump-pill row excluded); slice row → its RenderItem; return `item.foldAnchor`, but only when `col ≤` that row's plain-text width (`RenderLine.text` length — the column bound, spec §3.3; canon drops blank-cell clicks, 549361). Everything else — pill, dock rows, blank tail, untagged items — `undefined`.

- [ ] **Step 1: Write failing tests.** Render a real `FullscreenFrame` + `FullscreenViewport` (the pattern `test/tui/fullscreen-viewport.test.tsx` already uses) whose document holds a tagged fold row among plain rows: `anchorAt` hits the fold row's terminal row within text width → anchor; same row past text width → undefined; a plain row → undefined; a row BELOW the region (dock band) → undefined; scroll one line (`scroll` handle) → the mapping shifts with the offset; the pill row (force a scrolled-up state) → undefined; wrapped tagged item: BOTH its painted rows resolve. Mount the viewport behind its real sibling (`ChatApp` renders an empty `<Transcript>` above it inside the region, :1179–1189) so the test catches any assumption that the viewport owns the region's first painted row.
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

**The tap rule (spec §3.2, verbatim):** `press(button 0)` records `(col,row)`; `release` at the SAME cell → click; release elsewhere, a second press, or **any wheel key event in between** discards the anchor (the wheel discard hooks the same place the sink lives — a small `onWheel` note from the existing wheel path, or simply: the sink handler also observes `wheelup/wheeldown` via a ref the scroll handler already touches; pick the least invasive and say which in the report). Modified clicks (ctrl/alt/shift) ignored. **The gate (spec §3.3): reuse the existing input router, do not rebuild the disjunction** — `fullscreen && composerOwns(inputOwnerRef.current) && !footerState.searching`. `inputOwnerRef` (`ChatApp.tsx:503–515`) already folds shortcuts, transcript, every overlay, `historyOpen`, and BOTH decision flavors into one answer; a hand-built `!paneOwned && !seamActive` version misses inline permission/question dialogs (`paneOwned` at :930–933 deliberately excludes non-plan decisions, `seamActive` at :1224 covers only overlay + plan), and the file's own :1215 comment names a second enumeration as the thing to avoid. Test cell (e) below exists to fail that hand-built version.

- [ ] **Step 1: Write failing tests.** Feed raw SGR bytes through the real provider into a mounted ChatApp-level harness (house pattern from existing `test/tui/` keyboard tests): (a) press+release on a fold row toggles expansion (items change); (b) press+release again collapses; (c) press at (5,7) release at (9,7) → nothing; (d) press, wheel tick, release same cell → nothing; (e) with an **inline (non-plan) permission consult** open — the decision flavor `paneOwned` deliberately excludes — the same tap → nothing (this cell fails any gate rebuilt from `paneOwned`/`seamActive` instead of `composerOwns`); (f) with the pager open (ctrl+o), tap → nothing; (g) ctrl+click → nothing.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm run typecheck && npm run test:tui` — PASS. Also `npm run test:unit` (the union may reach shared helpers).**
- [ ] **Step 5: Commit** — `f5(ts): T10 — tap detection, dialog gate, click→toggle wiring`.

---

### Task 11: Live dressing — elapsed ticker (Task 2's gate CUT the bash suffix)

**Files:**
- Modify: `src/tui/toolFold.ts` / `src/tui/toolRenderer.tsx` (the active group row gains: per-tool elapsed `· N.Ns` once the newest in-flight member has run ≥ 2 s, canon 518661/518664; hint sources gain bash commands via the existing `commandHint`. The bash `(Ns · N lines)` suffix is NOT built — see the gate below)
- Modify: `src/tui/foldPendingState.ts` if the ticker needs per-anchor in-flight timestamps (injected clock)
- Test: extend the fold-row suite (fake clock)

**Gate — RESOLVED by Task 2 (probe 100, live on SDK 0.3.220): NO per-tool progress feed is reachable headlessly.** The bash `(Ns · N lines)` suffix is **CUT**; the divergence is recorded in the spec (§3.1 live dressing, Revision Notes round 4). Do not build it, and do not fake the line count from anything. This task ships the elapsed ticker ONLY, driven by the member's local start time (already stamped in the transcript) through an injected clock — not by any SDK progress field.

- [ ] **Step 1: Write failing tests** (ticker only): no ticker under 2 s; `· 2.0s`-form at ≥ 2 s anchored to the newest in-flight member; ticker absent on settled rows. Add one guard cell asserting NO bash suffix is emitted for a long-running bash member — the cut is a decision, not an omission, and a later hand must not "restore" it.
- [ ] **Step 2: Run — FAIL. Step 3: Implement. Step 4: suites + typecheck PASS.**
- [ ] **Step 5: Commit** — `f5(ts): T11 — live cluster dressing: elapsed ticker (bash suffix cut per probe 100)`.

---

### Task 12: Keyed live acceptance — spec §4 as written

**Files:**
- Evidence-only, NOT `test/live/` (that directory is vitest SDK e2e suites). The house form for TUI
  acceptance is the tmux driver — `harness/scripts/drive-repl.py` + `capture-frames.py`, evidence to
  a scratch dir, exactly as the fullscreen wave's Task 17 ran it
  (`docs/superpowers/plans/2026-08-12-fullscreen-live-window.md` is the template). The run matrix is
  the task report's deliverable.

- [ ] **Step 1: Build** (`npm run build`).
- [ ] **Step 2: Run every spec §4 cell as written** — A1 through A10, quoting the spec's exact expected strings. A4/A10's click bytes are printf'd into the pty: `printf '\x1b[<0;COL;ROWM\x1b[<0;COL;ROWm'` (target a column inside the cluster text). A8 re-runs the BL5 pokes (wheel scroll, Shift/Option select, 75 ms arrow suppression) and the three scoped suites: `npm run test:unit && npm run test:tui && npm run test:resize-matrix`.
- [ ] **Step 3: Record the matrix** (cell → pass/fail with evidence) in the run log. Any FAIL → report BLOCKED with the transcript; do NOT mark the cell "close enough".
- [ ] **Step 4: Commit** — `f5(ts): T12 — live acceptance A1–A10`.

---

### Task 13: Close-out — scorecard + spec tail

**Divergences this wave accumulated that the close-out MUST record** (each already in the spec;
the scorecard is where a reader looks for them): the cut bash `(Ns · N lines)` suffix (probe 100,
round 4); all-silent clusters emitting no row (round 3); the errored-sibling scope difference
(round 7); PR numbers rendered as text with no link affordance, `GitPrOp.url` carried but
unscheduled (round 8); (the round-9 flip divergence is NOT in this list — it was withdrawn in round 10 and became
Task 5b); and Task 8's published-expanded-items limitation.

**Files:**
- Modify: `docs/parity/coverage.md` (the fullscreen/transcript rows this wave moves)
- Modify: `docs/superpowers/specs/2026-08-18-tool-stream-design.md` (Outcomes & Retrospective; Surprises & Discoveries with anything Tasks 1–12 overturned)

- [ ] **Step 1: Refresh `coverage.md`** — honest deltas only, citing the acceptance matrix.
- [ ] **Step 2: Write the spec's Outcomes & Retrospective**; fold Task 1/2 findings into Surprises & Discoveries if not already there.
- [ ] **Step 3: Commit** — `f5(ts): T13 — coverage + spec close-out`.

---

## Self-review notes (author)

- Spec coverage: §3.1 → T1/T3/T4/T5/T11; §3.2 → T6/T7/T10; §3.3 → T8/T9/T10; §3.4 → T5; §4 → per-task tests + T12; §5 probe gate → T2/T11. A1–A10 all land in T12 verbatim.
- Type consistency: `FoldClass.kind:"bash"|"silent"` (T3) is what T4's counting and T8's member emission consume; `foldAnchor` (T8) is what T9 resolves and T10 toggles via `toggleFold(anchor)`; `MouseInputEvent` (T6) is what T7's sink and T10's handler receive.
- Deliberate non-verbatim points, each with its source named: the odS rule table and pop-out semantics come from T1's addendum (spec-mandated re-read — inlining guesses here would be worse than the reference); suite/file discovery uses greps because the harness names its test files by feature and the implementer must land in the real one, not one this plan guessed.
