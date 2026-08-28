# bl6 T-CLUSTER Implementation Plan — expanded-cluster absorbed thinking

> **For agentic workers:** REQUIRED SUB-SKILL: doperpowers:subagent-driven-development, task-by-task.
> Spec: `docs/superpowers/specs/2026-08-28-bl6-attach-cluster-design.md` §3. Canon research (verbatim
> 2.1.250 excerpts + offsets): `.doperpowers/sdd/2026-08-28-bl6-round/research-cluster.md` §Q1.
> **Quoted canon excerpts in the research doc outrank this plan's paraphrase.**

**Goal:** a fullscreen tool cluster that absorbed thinking renders the full thinking bodies,
interleaved with its member tool rows in transcript order, when expanded — matching canon 2.1.250's
expansion branch (offsets 177043425–177044786).

**Architecture:** three seams. (1) `buildAnchoredEntries` (`src/tui/toolRenderer.tsx`) starts
carrying each thought-bearing message's RAW body alongside the existing whitespace-collapsed
`thinking` summary; (2) `foldAtoms` puts the body on the neutral atom UNCONDITIONALLY (today
`thinkingSummary` rides only when the live thought-clock has a duration — a replayed/attached
transcript would otherwise expand to nothing) and `segmentRuns`/`FoldGroup` (`src/tui/toolFold.ts`)
retain `{key, messageSequence, body}` per absorbed thinking block; (3) `expandedMemberItems`
(`src/tui/toolRenderer.tsx:963`) merges thinking rows into the member listing ordered by message
sequence, rendered in ccx's existing `∴` detail form (`THINKING_GUTTER`, `src/tui/render.ts:74`),
dim markdown body, NO duration clause (spec D4). Membership rule unchanged (spec D6): a body is
retained by exactly the run that absorbs the atom today.

**Tech stack:** TypeScript/Ink renderer pipeline, vitest unit + component tests, fake-host pty cell.

## Global Constraints

- All commands from `CC-to-SDK/harness/`. Gates: `npm run typecheck`, `npm run test:unit`,
  `npm run test:tui`. NEVER bare `npm test`.
- Canon contract (research §Q1, binding): expansion REPLACES the collapsed row (already true in ccx —
  do not change); order inside the expansion is TRANSCRIPT ORDER of the absorbed assistant messages,
  NOT `memberIds` accumulation order (`memberIds` reorders as members settle; the anchored stream
  orders an OPEN call by `callSequence` but a SETTLED one by `resultSequence`); a thinking row is
  `∴` gutter (dim italic gutter, body not italic) + full multi-line body as DIM markdown, blank line
  above (canon `marginTop:1`); NO "thought for Ns" text anywhere in the expanded form.
- The collapsed row's behavior (`thoughtForMs` clause, `latestThinkingSummary` hint) is UNCHANGED.
- Classic (non-fullscreen) renderer untouched.
- tmux: PRIVATE socket only; never default server; never `kill-server`; never sessions named PTC/ptc.
- Commit messages: no Co-Authored-By. Scratch → `/Users/new/.claude/jobs/4b30d1a4/tmp`.

---

### Task 1: retention — carry the body from anchored entry to FoldGroup

**Files:**
- Modify: `src/tui/toolRenderer.tsx` (`thinkingSummaryOf` area ~1098, `buildAnchoredEntries` ~1116,
  `foldAtoms` ~1307)
- Modify: `src/tui/toolFold.ts` (`FoldAtom` ~271, `RunState` ~321, `newRun` ~328, the flush ~429,
  the neutral-absorption arm ~454)
- Test: `test/unit/toolFold.test.ts` (or the file's actual name — find the existing foldAtoms/
  segmentRuns unit tests and extend them there)

**Interfaces:**
- Consumes: existing `Anchored` record shape (`identity`, `thinking`), `FoldAtom` neutral arm,
  `RunState`/`GroupCounts` and the flush at `toolFold.ts:429`.
- Produces (later tasks rely on these EXACT names):
  - `Anchored` gains `thinkingBody?: string` — the first content block's `thinking` text, `.trim()`ed
    but NOT whitespace-collapsed, present iff the existing `thinking` summary is present.
  - `FoldAtom` neutral arm gains `thinkingBody?: string` and `thinkingKey?: string`, carried
    WHENEVER the entry is thought-bearing (independent of the live clock; `thoughtForMs`/
    `thinkingSummary` keep their exact current clock-gated semantics). `thinkingKey` is
    `` `${identity ?? "anon"}:${messageSequence}` `` (two thinking frames share one `message.id` —
    P82 — so identity alone cannot key them).
  - `FoldGroup` gains `absorbedThinking?: readonly AbsorbedThinking[]` with
    `export type AbsorbedThinking = { key: string; messageSequence: number; body: string }`,
    exported from `toolFold.ts`, present only when non-empty (matching the `thoughtForMs > 0` flush
    style at `:429`).
  - Accumulation happens in the SAME segmentRuns arm that absorbs neutral atoms into the open run
    today (the code path around `run.thoughtForMs += ms`, `toolFold.ts:454`) — but keyed on
    `atom.thinkingBody !== undefined`, NOT on the clock. Membership is therefore byte-identical to
    today's: whichever run a thinking-bearing neutral atom lands in retains its body.
  - **The PRE-RUN case (spec §3.2(1)(i), plan-review finding 2 — do not skip):** a leading thinking
    atom arrives BEFORE the first collapsible tool. Today `segmentRuns` holds it in the `pending`
    accumulator (`toolFold.ts:452`) ONLY when `ms > 0` (`:556`) — and replayed/attached entries never
    have a clock. Extend `pending` to `{ ms: number; summary?: string; bodies: AbsorbedThinking[] }`
    (or equivalent): bodies accrue whenever `atom.thinkingBody !== undefined` regardless of `ms`,
    transfer into the run at the existing `pending` hand-off when the first collapsible tool opens it
    (`:512`), and are cleared wherever `pending` is cleared today (a breaker kills them exactly as it
    kills the clock — `:458`).

- [ ] **Step 1: failing unit tests — THREE cells.** Cell 1 (mid-run): tool A → thinking message
  ("First thought line\n\nSecond paragraph") → tool B, one run; assert the flushed group has
  `absorbedThinking: [{ key: expect.stringContaining(":"), messageSequence: <the thinking entry's
  sequence>, body: "First thought line\n\nSecond paragraph" }]` — the body preserves the newlines
  (kills a whitespace-collapse regression). Cell 2 (no-clock LEADING thinking — the replay/attach
  case, spec §3.2(1)(i)): thinking → tool A → result, with NO entry in the live thought-clock map;
  assert `thoughtForMs` absent but `absorbedThinking` present with the body — this cell is RED until
  the `pending` extension lands and MUST fail if bodies are gated on the clock. Cell 3
  (production-pipeline, spec §3.2(1)(ii)): drive a real `TranscriptDocument` through
  `projectCompact`/`projectPending` (mirror how existing tests in the file build documents) with a
  leading thinking entry, no `thoughtMs`, a Read + result, and a breaker; assert the projected
  expanded output (or the group it publishes) carries the body — this cell exercises
  `buildAnchoredEntries` → `foldAtoms` → `segmentRuns` end to end and MUST fail if any link drops the
  body, even while cells 1-2 pass.
- [ ] **Step 2: run, RED** (`npx vitest run test/unit/<foldfile> -t absorbedThinking`).
- [ ] **Step 3: implement** the four touch points above, minimal. In `buildAnchoredEntries`, derive
  the raw body next to the existing `thinkingSummaryOf` call (extract the shared
  first-block-is-thinking guard rather than parsing twice).
- [ ] **Step 4: run, GREEN**; then the whole fold test file green.
- [ ] **Step 5: gates + commit.** `npm run typecheck`.
  `git add src/tui/toolRenderer.tsx src/tui/toolFold.ts test/unit/<foldfile>`
  `git commit -m "bl6 t-cluster: FoldGroup retains absorbed thinking bodies (key, sequence, raw text)"`

### Task 2: expansion — interleave thinking rows with member rows by sequence

**Files:**
- Modify: `src/tui/toolRenderer.tsx` (`expandedMemberItems` ~963)
- Test: the existing expanded-cluster/`expandedFolds` component test file under `test/tui/` (find it
  via `grep -rl expandedFolds test/tui/`) — extend, don't fork.

**Interfaces:**
- Consumes: `FoldGroup.absorbedThinking` (Task 1), `THINKING_GUTTER` / the `∴` detail-form item
  factory in `src/tui/render.ts` (reuse the existing verbose-thinking row construction — find the
  producer of the `∴` rows the F4 wave shipped and call THROUGH it if its shape fits; a minimal local
  item builder is acceptable only if the existing one is hard-wired to a different seam — record
  which in the report).
- Produces: `expandedMemberItems` output = one merged list under a TOTAL order (spec §3.2(2)): a
  member tool row's sort key is the event's `callSequence` (the transcript position of its
  `tool_use` — canon's `pe` order; NOT `resultSequence`, NOT `memberIds` position), a thinking row's
  key is `messageSequence`, and on EQUAL keys thinking rows precede member rows while member rows
  keep extraction order (deterministic tie-break — robustness per spec D12, since equal-key
  collisions were measured absent in real transcripts). Thinking rows carry `foldAnchor: anchorId`
  and `expanded: true` exactly like member items (so collapse/re-render bookkeeping sees them as
  cluster content).

- [ ] **Step 1: failing component test.** Fixture: a cluster of Read(seq 10) → thinking(seq 12,
  body "Alpha\n\nBeta") → Read(seq 14), expanded via `expandedFolds`. Assert the rendered output
  contains, in order: first Read's row, a `∴` line, "Alpha", "Beta", second Read's row; assert the
  thinking text is NOT on the collapsed path; assert NO "thought for" / duration text anywhere in
  the expanded output. Add the ORDERING KILL CELL: a fixture where `memberIds` order ≠ sequence
  order (settle the first-issued call LAST — the existing tests have precedent for out-of-order
  settling) and assert the expansion is in sequence order — this cell must fail if the implementation
  iterates `memberIds` and appends thinking at the end.
- [ ] **Step 2: run, RED.**
- [ ] **Step 3: implement** the merge in `expandedMemberItems`: build `{sortKey, items}` entries for
  members (skipping `emitted` exactly as today) and for `group.absorbedThinking ?? []`, sort
  ascending, flatten. Blank-line spacing above each thinking row per the canon `marginTop:1` (match
  how neighboring items express vertical space in this item model — read two existing producers
  before choosing).
- [ ] **Step 4: run, GREEN**; whole file green.
- [ ] **Step 5: gates + commit.** `npm run typecheck`, `npm run test:tui` (scoped file at minimum).
  `git commit -m "bl6 t-cluster: expanded cluster interleaves absorbed thinking bodies in transcript order"`

### Task 3: pty acceptance cell

**Files:**
- Modify: `scripts/fake-host.mjs` (ADD one word producer, e.g. `thinkcluster`, emitting: tool_use
  Read → its result → an assistant thinking frame (multi-line body) → tool_use Read → its result —
  study the existing `prlink`/`errcluster` producers for the frame shapes)
- Create: `scripts/cluster-expand-cells.sh` (clone the linkopen-cells.sh driver skeleton: private
  tmux socket, isolated HOME/fleet root, `launch_attach`, `mode on` wait, capture helpers)
- Evidence: `.doperpowers/sdd/2026-08-28-bl6-round/t-cluster-pty-evidence.txt`

**Interfaces:**
- Consumes: T-ATTACH's merged replay contract — this cell pushes `thinkcluster` as the FIRST push,
  NO sentinel (spec A4; T-ATTACH merges first — if it has not, STOP and report BLOCKED).
- Produces: the round's live proof that the real `ccx` binary renders the interleaved expansion.

- [ ] **Step 1: the cell.** Push `thinkcluster`; wait for the collapsed cluster row; resolve the
  row's column/row (reuse `linkopen-col-of.py` if applicable) and CLICK it (SGR press+release, the
  linkopen cells show the byte recipe); assert the capture now shows the `∴` line and a distinctive
  thinking phrase BETWEEN the two Read member rows; click again (collapse); assert the summary row is
  back and the thinking phrase is gone.
- [ ] **Step 2: run 3× → PASS ×3**; append captures to the evidence file.
- [ ] **Step 3: commit** the producer + script.
  `git commit -m "bl6 t-cluster: pty cell — expanded cluster shows absorbed thinking in the real binary"`

### Task 4: verification

- [ ] Execute spec acceptance A3 (both unit/component suites with the kill cells), A4 (pty evidence
  file, sentinel-free), A5: `npm run typecheck` + `npm run test:unit` + `npm run test:tui` all green.
- [ ] Confirm the collapsed row is byte-identical to pre-branch for a thinking-absorbing cluster
  (existing collapsed-row snapshot/unit tests still green untouched — name them in the report).
- [ ] Membership-parity note (spec D6): one paragraph in the report comparing ccx's absorption rule
  (which neutral atoms join a run) with canon's adjacency rule from research §1.5 — divergences are
  REPORTED, not fixed.
