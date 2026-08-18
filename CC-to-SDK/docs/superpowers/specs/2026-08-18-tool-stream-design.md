# Tool-Stream Wave (TS) — fullscreen tool-cluster collapse + click-to-expand

**Purpose.** Close the biggest remaining fullscreen-fidelity gap: in canon 2.1.234's
flicker-free renderer, every tool call that is not a Write/Edit/Agent/plain message is
absorbed into a compact, live-streaming cluster line, and clicking that line expands the
cluster's calls in place — the only granular expansion control in fullscreen. ccx today
folds only read/search/list/MCP runs (the pre-fullscreen 2.1.220 policy) and discards every
mouse report except wheel ticks. This wave widens the fold policy to canon's fullscreen
clauses and builds the click pipeline, without regressing text selection.

**Canon ground truth:** `docs/superpowers/grounding/2026-08-18-tool-stream-ground.md`
(every claim line-cited into `~/claude-code-bundle/2.1.234/cli.pretty.js`). Line numbers
below cite that binary reprint. **Canon moves with this wave: 2.1.234 is the citation
target for new work** (2.1.220 citations already inside shipped modules stay as they are —
they were verified against that binary and rewriting them re-verifies nothing).

**Owner sign-offs already given:** the wave itself ("you can write spec", 2026-08-18) and
the v1 cut keeping current mouse modes (proposed in the grounding report-out, not
objected).

---

## 1. What canon does (the target, compressed)

The full mechanics are in the grounding doc; the load-bearing facts:

1. **One predicate decides absorption** — `Krr(name, input, tools)` (236795). Collapsible:
   Glob, Grep, Read (always); Bash *entirely* when fullscreen (236816), read-ish commands
   only otherwise; MCP tools; ToolSearch (fullscreen only, silently); TodoWrite +
   TaskCreate/TaskGet/TaskUpdate/TaskList (silently, popping out on error); REPL;
   Write/Edit into memory/scratchpad/workshop paths. Everything else —
   **Write, Edit, NotebookEdit, Agent, Task, WebFetch, WebSearch** — returns
   `isCollapsible: false` and breaks the cluster.
2. **A cluster is one contiguous run** (`iNp`, 237092). Breakers: assistant text, a
   non-collapsible tool call, a user prompt. Absorbed without breaking: thinking blocks
   (wall-clock added to `thoughtForMs`), attachments, system messages; neutral items are
   buffered and re-emitted after the cluster.
3. **Header copy** (`ZIl`, 518464): comma-joined `verb + bold count + noun` parts in a
   fixed order, first part title-cased, present tense + trailing `…` while active, past
   tense + dim when settled. Fullscreen-only parts: git operations scraped from bash
   stdout ("committed <shas>", "pushed to <branch>", "merged/rebased onto <ref>", PR
   actions) and "ran N shell commands". Counts are watermarked (never tick backwards,
   518466). There is **no** "N tool uses" string.
4. **Tools stream inside the collapsed cluster from the first call** — spinner, undimmed,
   live `⎿` hint line with the current file/pattern/command, per-tool elapsed ticker after
   2 s, bash `(4s · 120 lines)` suffix after 2 s. The block never un-collapses on its own.
5. **Click is the only per-cluster expansion path** (none of canon's 112 keybinding
   actions does it). State: a component-local `Set` of keys `collapsed-<firstUuid>`
   (549749) flipping the row's `verbose` prop; content-derived key, so a live cluster
   stays expanded while it grows; session-lifetime, never persisted.
6. **Click vs selection is deferral, not modifiers** (208013): press drops a selection
   anchor; the click fires on release only if no selection was produced.
7. **Fullscreen suppresses every `(ctrl+o to expand)` chip** (Ett context, 549824 →
   511132) and deactivates ctrl+e; ctrl+o remains the everything-expanded screen.
8. Canon arms `?1000h ?1002h ?1003h ?1006h` ("full", 207331) — motion tracking (1003) is
   what powers hover — and runs its own selection engine with copy-on-select.

## 2. The v1 cut (decided)

**Keep ccx's current mouse arming (`?1000h ?1006h`).** Full fidelity needs 1002/1003,
which swallows *all* drag reporting and forces us to build canon's selection/copy engine
in the same wave. With 1000-only, press+release still arrive; Shift/Option-drag still
reaches the terminal's native selection (the BL5 status quo). What this costs, each a
**recorded divergence** reserved for a follow-on "full mouse" wave:

- no hover brighten (needs 1003),
- no expanded-row background tint (canon gates the tint on *expanded*, not hovered —
  549131; we drop it because the line-based row renderer has no per-item background
  span, a cost call, not a hover dependency),
- no click-to-position-cursor in the composer, no auto-copy-on-select,
- tap detection approximates canon's "no selection produced" with "press and release in
  the same cell" (under mode 1000 there are no motion reports, so a drag is exactly a
  press and a release in different cells; the two rules coincide).

Everything in §1 items 1–5 and 7 ships at full fidelity, minus the pieces above.

**Not applicable to ccx (absent from the SDK tool surface), skipped with no divergence
recorded:** PowerShell, REPL, workshop/scratchpad/memory-path Write/Edit, team memory.
**Out of scope, unchanged:** the classic renderer's fold policy — **a recorded
divergence, not parity**: the Bash/ToolSearch/git widenings are genuinely `Ns()`-gated in
canon, but TodoWrite/Task-board absorption is unconditional (`Joi.includes`, 236807), so
canon 2.1.234's *classic* renderer absorbs those too while ccx classic stays at its
shipped 2.1.220 subset. Also out: brief mode (ctrl+shift+b), `/tui` gating, the ctrl+o
pager.

## 3. Design

### 3.1 Fold-policy widening (pure model: `toolFold.ts` + `foldPendingState.ts`)

`classifyToolEvent` gains a `fullscreen: boolean` input (canon threads `Ns()` through the
policy itself, 236816 — ours threads the renderer identity from the caller; the pure
module stays clock- and environment-free). Under `fullscreen`:

- **Bash**: every call classifies into the run. Read-ish commands keep feeding
  read/search/list counts exactly as today; non-read commands feed a new
  `bashCount` + `bashCommands` (id → command string) on `GroupCounts` (canon 237020,
  237152). Standalone-Bash rendering remains the classic renderer's behavior.
- **ToolSearch**: absorbed silently — counted nowhere, and it never pops out (canon
  236808). It does **not** break a run, but it is a member like any other and can *open*
  one, owning the anchor (addendum §A.1) — memberIds and anchor identity see it.
- **TodoWrite, TaskCreate, TaskGet, TaskUpdate, TaskList**: absorbed silently, but an
  errored result **pops the call out** (canon `popsOutOnError`, 236809). Grounded by T1's
  addendum (`grounding/2026-08-18-tool-stream-ground-addendum.md`), which governs the
  mechanism; the load-bearing results:
  - silently-absorbed calls ARE members and contribute no header copy; they can be
    `messages[0]` and own the run's anchor (canon 237195–237197, 237027);
  - an error result for such a tool **always closes the run**; the call is *relocated*
    after the cluster only in canon's narrow case (it is the last message, all its
    tool_uses errored, and no hooks/relevant-memories were absorbed) — otherwise it stays
    inside the cluster and only the run closes (canon 237198–237210);
  - a run whose every member is silent has all counters zero. Canon still emits a
    zero-height clickable row (518513, 549764); **we emit no row** — an invisible
    clickable region has no meaning in an item-based projection, and this preserves
    today's behavior for suppressed tools. Recorded divergence.
  - **an errored silent call is never swallowed** (round 5, corrected round 6). Canon's
    `n.push(c)` (237210) sits OUTSIDE the branch — the error row is emitted on *all three*
    paths, including the one where the call stays inside an emitted cluster. So the rule is
    unconditional: **an errored `popsOutOnError` call always renders standalone once its run
    closes**, whether it relocated, stayed, or belonged to a run that emits no group at all.
    Relocation then decides only MEMBERSHIP — whether the call is also in `memberIds` (it is
    when it stayed; it is not when it relocated). Two consequences that travel:
    - anchor stability is unaffected: a call that stays keeps its place in `memberIds`,
      including `memberIds[0]`;
    - **Task 8 obligation**: expanded rendering iterates `memberIds`, so a member that has
      already been emitted standalone must be skipped there or the failure renders twice.
      (Canon has no such problem: it renders the `tool_use` inside the cluster and the
      `tool_result` standalone — two halves of one call, not one call twice. Our atoms carry
      call and result together, so the halves cannot be split the way canon splits them.)
    The narrower round-5 wording — standalone only when the group was suppressed — left the
    original hole open in the commonest ordering: an errored board write inside a cluster
    that has other, visible members, where the summary reads "Read 1 file" and the failure
    appears nowhere.
  - **the relocate/stay test is a window test on sequences**, not a lookahead. Canon asks
    whether anything else was pushed into `o.messages` between the silent call's own
    message and the arrival of its error result. Our atoms carry `callSequence` and
    `result.resultSequence`, so the same question translates exactly: relocate only if no
    other atom's call or result sequence falls strictly inside the open window
    `(call.callSequence, call.result.resultSequence)`. A "does the next atom join the run"
    approximation answers a different question and diverges on three orderings (a
    sequentially-issued follow-on, a concurrent sibling whose result lands first, and a
    thought arriving after the error). One endpoint rule completes it (round 6): siblings
    issued in the SAME message share the errored call's `callSequence` and so sit exactly on
    the window's edge, invisible to a strict scan. Canon handles them through
    `f.every(id => id errored)` (237200) — a batch relocates only if every sibling in it
    errored. Ours is the same predicate: an atom sharing the errored call's `callSequence`
    blocks relocation **unless it also errored**. Strict-inside is deliberate for every other
    atom and must be pinned by a cell, since flipping it to inclusive otherwise changes
    nothing any test can see. **Recorded divergence (round 7):** canon builds its errored-id
    set from the *arriving result message alone* (237199), so "every sibling errored" means
    "every sibling errored in this same message"; ours means "errored at any time". They part
    only when same-entry siblings error in *different* entries — canon keeps the call inside
    the cluster, we relocate it out — and only for disk-sourced multi-block entries, since the
    live engine splits parallel calls into separate frames with distinct sequences. The effect
    is membership-only now that the failure row is unconditional.
  One invariant this spec owns regardless of canon: a pop-out must not shift the anchor
  identity of an already-formed run — expansion state and the watermark latch key on it.
  (Canon can retract a run wholesale because `iNp` re-derives from the full message list
  every pass, 237093; a streaming renderer cannot unpublish a row.)
- **Git-operation scraping** (canon `odS`, 237212): scraped **as each bash result is
  absorbed** — canon runs `odS` inside the accumulation loop, so "committed abc123f"
  appears in the live header mid-turn, not only at close. Successful git
  commits/pushes/merges/rebases and `gh` PR actions are scraped from the recorded
  commands + results into `commits[] / pushes[] / branches[] /
  prs[]` on the counts. The no-double-count is a **render-time subtraction, not a
  transfer**: `bashCount` stays gross, `gitOpBashCount` is a parallel tally bumped once
  per result that yielded any op, and the shell clause prints
  `max(0, ratchet(bashCount) - gitOpBashCount)` — the watermark ratchets the *gross*
  count and the subtraction happens after it (canon 518466–518467, verbatim
  `le = Ns() ? Math.max(0, P.current - Z) : 0`). Decrementing `bashCount` at accumulation
  instead would latch the clause at its pre-git value forever, since the ratchet never
  falls. The recognition rules are T1's addendum §B (canon `vFr`, 194436–194473), ported
  as documented there, with two deliberate departures from canon's own bugs: the
  `--amend` test runs against the same quote-stripped command string the other flag tests
  use, and each tool_use_id is scraped at most once per result batch. Canon consults no
  exit code — we mirror that (output-shape recognition only).
- **WebFetch and WebSearch stay non-collapsible** — canon's policy, verified, even though
  intuition says "reads collapse".
- **A live `/tui` renderer flip must still replay each committed row exactly once**
  (round 9, corrected round 10 — a REQUIREMENT, not a divergence). The wave made the fold
  policy renderer-dependent, and the review measured the consequence: flipping out of
  fullscreen and then prompting once puts BOTH the cluster row and the individual per-call
  rows for the same calls on the main screen. That violates an invariant the code states
  outright (`ChatApp.tsx:1154–1156`: "WHAT IS NOT ACCEPTABLE, and is pinned: a SECOND copy.
  The replay must REPLACE"), and it compounds per flip because Ink's static buffer only
  grows. Cause: fullscreen commits rows into `staticItems` while its `<Static>` holds
  `EMPTY_ITEMS`, so they are never painted; on the way back `<Static>` re-emits them as
  fullscreen-shaped rows, and the next mutation re-projects classically and finds the
  per-call ids unspent. The repair re-projects the committed items under the new policy and
  remounts through the existing `staticEpoch` key (a keyed remount deletes and re-creates in
  ONE commit — the machinery `/clear` and rewind already use), so the replay REPLACES.
  Clearing the transcript outright stays rejected: it costs the user their history.
- **PR numbers are text, not links** (recorded divergence, round 8). Canon renders the visible
  characters `#12` and registers the hyperlink as a side effect of its own row component
  (`Ktt`, 518049–518070); our `FoldClause` is text-plus-bold-ranges with nowhere to hang an
  href. The scraped `GitPrOp.url` is carried through the counts so a future render layer can
  use it, and the clause text is byte-correct in both canon forms (`#12` linked, `PR #12`
  unlinked). Nothing schedules the affordance; Task 13 records it as backlog rather than
  leaving the field unowned.

`foldClauses` grows the fullscreen clauses in canon's fixed order (518545–518635):
git parts ("committed"/"amended commit"/"cherry-picked" + short shas, "pushed to" +
branches, "merged"/"rebased onto" + ref, PR verb + number) come after the edit parts and
before "searched for"; "ran N shell command(s)" comes last before the memory parts.
Verb pairs are present/past per the grounding table. The existing bold-count ranges,
title-case-first rule, active `…`, and the `foldPendingState` watermark ratchet all
apply unchanged to the new counts.

**Live dressing** (canon §6, droppable to a follow-up ticket if it crowds the wave): the
per-tool elapsed `· N.Ns` ticker and the bash `(Ns · N lines)` suffix, both appearing only
after 2 s in flight. The existing active hint gutter (`latestDisplayHint`) already covers
canon's "current tool" line; it gains bash commands as hint sources. **Probe gate —
SETTLED, and it cut half the dressing.** Probe 100 (`probes/probes/100-tool-progress-stream.ts`,
live on SDK 0.3.220) found no per-tool progress feed reachable headlessly: between a
tool's `tool_use` and its `tool_result` the default environment delivers zero
`tool_progress` frames, and no frame of any kind carries an output-line count (eleven
spellings scanned). The single elapsed carrier, `tool_progress.elapsed_time_seconds`,
appears only under `CLAUDE_CODE_REMOTE`/`CLAUDE_CODE_CONTAINER_ID` and only once per 30 s
per call — not a stream, and not a flag we adopt. Consequences, both binding:
- **The bash `(Ns · N lines)` suffix is CUT — recorded divergence.** Its line half has no
  source and must not be faked; its second half would duplicate the ticker.
- **The elapsed ticker ships**, driven by our own clock off the member's local start time
  (the transcript already stamps it), not by any SDK progress field. `system/task_started`
  and `system/task_notification` do arrive ungated and carry the real `tool_use_id`, but
  they are edges we already have — no new dependency is taken on them.
One trap recorded for any future progress work: `tool_progress.tool_use_id` is a synthetic
producer id (`"bash-progress-0"`); the real id lives in `parent_tool_use_id`.

### 3.2 Mouse click pipeline (input: `keys/parse.ts` → `keys/KeymapProvider.tsx`)

- `parse.ts`: SGR reports with `(button & 64) === 0`, `(button & 3) !== 3`, and no motion
  bit decode into a new `MouseEvent` variant — `{ kind: "mouse"; action: "press" |
  "release"; button: 0 | 1 | 2; col: number; row: number; ctrl; alt; shift }` (1-based
  col/row as the terminal sends them; wheel stays a `KeyEvent` exactly as today;
  everything else stays `ignored("mouse")`). The `& 64` term makes the rule
  order-independent of the wheel check — without it, buttons 64/65/66 alias to 0/1/2.
- `KeymapProvider` routes `kind: "mouse"` to a **`useMouseSink` registry hook** (the F2
  registry pattern — innermost-wins, render-time registration — not a `KeymapDeps`
  callback: the deps are supplied at the `chatMain` mount, but the sink's owner is
  `ChatApp`, a descendant holding the tap state, expansion set, and row-map ref). Mouse
  events never enter the binding table — canon's clicks are not keybindings either.
- **Tap detection** lives in the sink's owner: a `press(0)` records `(col,row)`; a
  `release` at the same cell within no particular deadline is a click; anything else —
  release elsewhere, a second press, **or any wheel tick in between** (the page scrolled
  under the anchor) — discards the anchor. Only button 0 clicks act; modified clicks
  (ctrl/alt/shift) are ignored (Shift never arrives anyway — terminals bypass reporting
  for shifted mouse).

### 3.3 Hit-testing and expansion state (fullscreen renderer)

- The fullscreen viewport already knows, for the frame it just sliced, which wrapped row
  came from which item (`wrapItems.ts` `sourceId`). It exposes the current frame's
  row-map through the same ref-channel family the scroll handle uses (`scrollRef`), and
  the map resolves **directly to fold anchor ids**, not raw item ids:
  `(terminalRow) → { anchor: string; textWidth: number } | undefined`. Resolving at
  projection time (the projection knows each fold row's, active hint block's, and
  expanded member's owning anchor) is what keeps the churning fold-row item ids
  (`group:<memberIds>:row|pending-row|unclosed-row`, growing with the run) out of the
  click path — the same instability the anchor-key decision already rejects. Rows
  belonging to the pill, dock, park row, blank tail, or any non-fold item resolve to
  `undefined`. **Vertical origin**: the viewport knows its row grant but not where the
  region sits on the terminal, so `FullscreenFrame` publishes the region's absolute top
  row through the same channel — explicit, rather than a "region is always row 1"
  invariant that a future banner would silently break.
- **Column bound**: a click past `textWidth` on an otherwise-clickable row is dropped —
  canon drops blank-cell clicks (549361), so the empty space right of a cluster's text
  must stay inert here too.
- **Expansion state**: `expandedFolds: Set<string>` keyed by the run's **anchor id**
  (`memberIds[0]` — already the stable identity `foldPendingState` ratchets on; the
  content-derived key gives canon's stays-expanded-while-growing behavior for free). It
  lives beside the transcript state in `ChatApp`/`useChat`, session-lifetime, never
  persisted, surviving ctrl+o round-trips and later turns. Its lifecycle mirrors
  `FoldPendingState.reset()`'s discipline: cleared wherever the transcript document is
  swapped or rewound (`/clear`, rewind, `/resume`); stale anchors are harmless but the
  intent is pinned so the two states never drift apart.
- **Projection**: `groupItems` receives the set through `ProjectionOptions`. An expanded
  run emits, instead of the one fold row, the existing **per-call verbose items** of its
  members (the same items the ctrl+o pager and classic verbose view already render), each
  re-tagged so its row-map entries resolve back to the run's anchor id. Clicking any row
  of the expanded block — or the collapsed row — toggles the anchor in the set. A click
  on a row whose item is neither a fold row nor a member of an expanded run is a no-op
  (v1 clickable species: fold clusters only; canon's clickable error/truncated results
  are reserved).
- **Dialog guard**: while a dialog or overlay is mounted, clicks are inert. The gate is
  `ChatApp`'s dialog-chain/pane-ownership state — NOT the scroll-key gate, which is
  deliberately looser (ctrl+u/d scroll the transcript behind a decision dialog by
  design, `FullscreenViewport.tsx:174-178`; a click must not toggle content behind one).
- Clusters (and expanded member items) are **already outside any Static region** in
  fullscreen — the viewport is fully virtualized — matching canon's
  `collapsed_read_search → never static` (549695). No work, but the invariant is named
  so nobody "optimizes" expanded members into Static later.

### 3.4 Chip suppression (canon Ett)

In the fullscreen renderer every `(ctrl+o to expand)` chip renders as nothing: the
`expandHint` already threaded through `ProjectionOptions`/`RenderMessageOptions` is set
to the empty string by the fullscreen render path (the three-state contract in
`keys/hints.ts` already treats `""` as "no hint"). The suppression is deliberately
**blanket** — it reaches every `expandHint` consumer, including the backgrounded-agent
hint, the agent done-hint, and the batch header (`toolRenderer.tsx:224/284/339`), which
matches canon's Ett context wrapping the whole virtual list; fullscreen snapshot deltas
in those rows are expected, and A9's byte-identity claim binds the classic renderer
only. The suppression also reaches the ctrl+o pager while in fullscreen — canon-faithful
too (canon's overlay is the same virtualized component under the same Ett provider,
grounding §7). The classic renderer keeps its chips everywhere.

## 4. Acceptance (observable behavior; keyed live cells run under the tmux driver with an isolated HOME under /tmp + CCX_FLEET_ROOT)

- **A1 (cluster forms).** Fullscreen, live keyed turn that Reads 2 files, Greps once, and
  runs 2 non-read Bash commands with no interleaved text: exactly one dim cluster line
  when settled, reading `Searched for 1 pattern, read 2 files, ran 2 shell commands` —
  modulo an optional leading `Thought for <duration>, ` clause (a live turn usually
  thinks; when present it takes the capital and `searched` goes lowercase). Bold counts;
  no `(ctrl+o to expand)` chip anywhere on it.
- **A2 (breakers).** A turn that Reads, then Writes a file, then Reads again: two
  clusters with the Write's full row between them. Agent dispatches and assistant text
  likewise render outside clusters, unchanged from today.
- **A3 (live form).** While the turn runs: spinner glyph, undimmed text, present-tense
  verbs with `…`, a `⎿` hint line naming the current file/pattern/command; counts never
  decrease across frames (watermark).
- **A4 (click expands).** Sending the SGR byte sequences for press+release
  (`\x1b[<0;{col};{row}M` then `\x1b[<0;{col};{row}m`, same cell) on a settled cluster row replaces it
  in place with the members' per-call rows; the same click on any of those rows collapses
  back. Press and release in different cells does nothing.
- **A5 (state lifetime).** An expanded cluster stays expanded across a later turn and
  across a ctrl+o round-trip; a fresh `ccx` session starts with everything collapsed.
- **A6 (absorbed-silent + pop-out).** TodoWrite inside a read run neither breaks the
  cluster nor appears in its copy, but DOES appear among the per-call rows when the
  cluster is expanded (it is a member); a TodoWrite that errors renders standalone.
- **A7 (git ops).** A turn whose Bash runs `git commit` + `git push` yields cluster copy
  containing `committed <shortsha>` and `pushed to <branch>`, and those two calls are not
  also counted in "ran N shell commands".
- **A8 (no regression).** Wheel scrolling, Shift/Option drag-select, wheelGuard's 75 ms
  arrow suppression, and every existing keybinding behave as before (suites: unit, tui,
  resize-matrix all green; the BL5 acceptance pokes re-pass).
- **A9 (classic untouched).** On the classic renderer (`--tui default`), fold policy,
  copy, and chips are byte-identical to before this wave (snapshot evidence).
- **A10 (stays expanded while growing).** Clicking a cluster **mid-turn**, while its run
  is still accreting members, keeps it expanded as later calls arrive and after it
  settles — this is the cell that forces the anchor-id key; an implementation keyed on
  the churning fold-row item id passes A1–A9 and fails here.

## 5. Testing strategy

- Pure model (policy, clustering, clauses, git scraping, watermark): unit tests in
  `test/unit/`, table-driven against the canon citations.
- Input: parse-level tests feeding raw SGR bytes; provider-level tests pinning routing
  (mouse → sink, never composer, never bindings) and tap detection.
- Renderer: `test/tui/` cells on both instruments (ink-testing-library + fakeTty) for
  fold rendering, row-map correctness under scroll offsets/pill/resize, expansion
  round-trip, chip suppression.
- Live: one keyed acceptance script driving a real pty via tmux `send-keys`/raw byte
  injection for A1–A7; A4's click bytes are printf'd into the pty. First click task
  verifies the runtime premise "press+release arrive under `?1000h` in our tracked
  terminals" before building on it (probe-first discipline; the wheel half is already
  BL5-proven).

## 6. Decision Log

- **v1 keeps `?1000h ?1006h`; hover/selection engine deferred.** Rejected: arming canon's
  full `1000+1002+1003+1006` now — it kills terminal-native selection outright, so it
  cannot ship without canon's selection+copy engine, roughly doubling the wave; the
  cluster/click behavior the owner asked for doesn't need it. Recorded divergences in §2.
- **Tap = same-cell press+release.** Rejected: porting canon's "no selection produced"
  rule literally — without motion reports there is no drag state to consult; under mode
  1000 the two rules are behaviorally identical.
- **Expansion re-projects members as per-call items, reusing existing verbose renders.**
  Rejected: a nested "verbose branch inside the cluster item" (canon's shape) — our
  projection pipeline is item-based, and the per-call renders already exist and are
  pinned by F3/F4 tests; a second nested rendering path would duplicate them.
- **Anchor id (`memberIds[0]`) as the expansion key.** Rejected: a per-frame index or the
  fold row's item id — both change as the run grows or re-forms; the anchor is already
  the ratchet key `foldPendingState` proved stable.
- **Mouse events route to a dedicated sink, not the binding table.** Rejected: modeling
  click as a pseudo-key binding — coordinates don't fit the binding vocabulary, and canon
  keeps clicks out of its 112 actions too.
- **WebFetch/WebSearch stay expanded.** Grounded (`Krr` step 7) — noted because it is the
  one policy row a reasonable implementer would "fix" the wrong way.
- **Citation target moves to 2.1.234 for new work; shipped 2.1.220 citations stay.**
  Rejected: bulk-rewriting old citations — they were verified against the binary they
  name, and the 2.1.220 tree is no longer on disk to re-verify against.
- **Row-map resolves to anchor ids at projection time; the frame publishes the region's
  absolute top row.** Rejected: mapping to raw item ids (fold-row ids churn with the
  run — the instability the anchor-key decision exists to avoid) and a "region is
  always terminal row 1" invariant (implicit geometry a future banner would silently
  break). Both per spec-review round 1.
- **Git ops scrape per absorbed result, not at cluster close.** Rejected: close-time
  scraping — canon runs `odS` in the accumulation loop, so "committed …" is visible
  live; close-time would be a mid-turn divergence A3/A7 could not see. Per spec-review
  round 1.

## 7. Surprises & Discoveries

- (seeded from grounding) Canon has no "flicker-free collapse component" — fullscreen
  only widens what feeds the pre-existing `collapsed_read_search` species, and makes the
  row clickable in the virtual list. Two mechanisms, not one.
- Click/selection coexistence is deferral (press-anchors-selection, click-on-empty-
  release), not modifier keys — the opposite of the BL5 assumption that DECSET 1000
  forces modifier-gated selection everywhere.
- No telemetry fires on inline expand in canon — there is no event name to imitate.
- (T1) The no-double-count is a subtraction after the watermark, not a transfer at
  accumulation — the "obvious" reading of the invariant builds a counter that can never
  fall. A latch, not a crash: tests must assert the shell clause *disappearing*.
- (T1) `popsOutOnError` is not a flag consulted at render; canon plants a zero-valued
  entry in the workshop-edit ledger so the existing un-count helper returns true without
  changing any counter (237142–237145). The mechanism is a reuse, not a dedicated path.
- (T1) A run made only of silent calls is, in canon, a zero-height row that still reports
  itself clickable — canon's own edge, arguably a bug, and the one place we deliberately
  render nothing instead.
- (T2) The declared-vs-reachable line held again: an in-flight progress channel exists in
  the wire vocabulary and is unreachable in practice — gated behind a remote/container
  flag and throttled to one sample per 30 s. The half of canon's bash suffix that looked
  hardest (elapsed) turned out to be the half we can build ourselves; the half that looked
  trivial (a line count) is the one with no source at all.
- (T1) Canon's git recognition never consults an exit code; success is inferred from
  output shape alone (`vFr`, 194436–194473), while the neighbouring telemetry path does
  check it. Fidelity here means copying the looser rule.

## 8. Outcomes & Retrospective

Pending — written at finish.

## 9. Revision Notes

**Round 10 — 2026-08-19, T5 review (execution).** Round 9's decision is withdrawn. It rested
on the flip damage being *staleness* (history folded under the old policy); the reviewer
measured it and it is *duplication* — both the cluster row and its per-call rows on screen for
the same calls, violating a pinned invariant and compounding per flip. Accepting a seam was
defensible; accepting a duplicating replay is not. Re-scoped as its own task (plan Task 5b).
The lesson is narrow and worth keeping: a characterization handed up from a task report ("it
goes stale") is a claim, and a decision built on it is only as good as that claim.

**Round 9 — 2026-08-19, T5 switch-over (execution).** Making the fold policy
renderer-dependent created an interaction that did not exist before: a live `/tui` flip now
leaves already-finalized rows folded under the old policy. Decided and recorded above — accept
the seam rather than clear the user's visible transcript, since append-only `<Static>` makes
re-projection additive rather than corrective. Task 13 records it in the scorecard.

**Round 8 — 2026-08-19, T4 review (execution).** Three corrections. (1) The scrape gate was
inherited too wide from Task 3's plan text, whose parenthetical ("canon records every bash
command for the scraper, 237152") contradicted the very quote it cited — canon records only in
its `isBash` branch. Live repro: `grep -A2 "git push" ci.log` over a CI log produced a phantom
"Pushed to main" clause and swallowed a real shell-command clause. Recording and scraping are
now both gated on the bash classification, matching 237152. (2) The PR hyperlink gap is recorded
above rather than left unowned. (3) The plan's Task 4 interface block still declared the op
arrays as `string[]`; the shipped record shapes are now in the plan, since Tasks 5 and 8 read it
for their input types.

**Round 7 — 2026-08-19, T3 gate review (execution).** Task 3 approved. One canon divergence
recorded above (the errored-sibling set is per-message in canon, per-lifetime in ours —
reachable only on disk-sourced multi-block entries, membership-only in effect), and Task 8's
plan gained the de-duplication obligation the round-6 rule created.

**Round 6 — 2026-08-19, T3 fix re-review (execution).** The round-5 "never swallowed" rule
was itself too narrow, and the re-review caught it: canon's error row is pushed
unconditionally (237210, verified in the binary by the controller — the push sits outside
the if/else), so the rule is now unconditional and relocation decides membership only. The
original failure mode — a failed board write invisible inside a cluster with other members —
was still open under the round-5 wording. This adds one Task 8 obligation (skip an
already-standalone member when rendering an expanded cluster). Also pinned: the same-message
sibling endpoint case, which a strictly-inside window misses, resolved with canon's own
all-siblings-errored predicate.

**Round 5 — 2026-08-19, T3 review (execution).** Two §3.1 additions forced by the first
code task's review. (1) The pop-out relocate/stay test is pinned as a *sequence-window*
test, after the implementer's one-atom-lookahead translation was shown to diverge from
canon on three orderings — the failure being a failed board write folded invisibly into a
summary. (2) A composition hole between two existing pins is closed: "no group for an
all-silent run" plus "an error closes the run" could between them make an errored
bookkeeping call vanish with no row anywhere; an errored silent call is now explicitly
never swallowed. Both are behavior the spec owns, not implementation detail.

**Round 4 — 2026-08-19, T2 probe gate (execution).** Probe 100 settled §3.1's live-dressing
gate NOT REACHABLE: the bash `(Ns · N lines)` suffix is cut and recorded as a divergence,
the elapsed ticker ships on our own clock. Plan Task 11 shrinks to the ticker half; §4's
acceptance is unaffected (no cell named the suffix).

**Round 3 — 2026-08-19, T1 canon addendum (execution).** The spec-mandated canon re-read
landed (`grounding/2026-08-18-tool-stream-ground-addendum.md`, commit `ab08873656`) and
corrected §3.1 in three places. (1) The git no-double-count **mechanism** was wrong: the
spec said the bash calls "move out of `bashCount` into `gitOpBashCount`"; canon keeps
`bashCount` gross and subtracts at render *after* the watermark ratchet. Implemented as
written, the shell clause would latch at its pre-git value permanently — verified in
canon at 518466–518467 by the controller before adopting. The invariant was right; the
mechanism is now canon's. (2) Pop-out was under-specified: an error always closes the run,
but relocation happens only in canon's narrow last-message/all-errored/no-hooks case;
otherwise the errored call stays inside the cluster. (3) "ToolSearch breaks nothing" was
right on counting, wrong on identity — every silent call can *open* a run and own its
anchor. Two new decisions recorded above: all-silent clusters emit no row (canon's
zero-height clickable row is not portable to an item-based projection), and two canon
scraper bugs (raw-string `--amend` matching, per-block re-scrape) are not ported.

- 2026-08-18: v1 authored from the canon grounding doc + module reads (toolFold,
  foldPendingState, toolRenderer, parse/KeymapProvider/types, wrapItems,
  FullscreenViewport/Frame).
- 2026-08-18: review round 1 (independent spec reviewer; 11 Important + 6 Minor, all
  adopted): classic-renderer rationale corrected to a recorded divergence (Joi is
  unconditional in canon); git scraping moved to per-result absorption; pop-out
  consumption flagged as a mandated canon re-read with the anchor-stability invariant
  pinned and members-when-expanded grounded; mouse decode gains `(button & 64) === 0`;
  sink is a `useMouseSink` registry hook, not a KeymapDeps callback; row-map resolves
  anchor ids + textWidth with the frame publishing the region top; blank-tail clicks
  dropped (column bound); dialog gate named (not the scroll gate); bash-suffix
  progress-stream premise gets a probe gate; A1 tolerates the thought clause; A6 pins
  members-in-expansion; A10 added (mid-turn expansion persistence); expansion-set
  lifecycle mirrors FoldPendingState.reset(); chip suppression documented as blanket;
  tint-drop rationale re-justified on cost.
- 2026-08-18: plan review round 1 corrections flowing back: §3.4's "pager keeps its
  chips" was wrong — in fullscreen the suppression reaches the pager too, and that
  matches canon (its overlay sits under the same Ett provider); recorded one known
  limitation for the plan's T8 — items committed to the classic replay while a cluster
  was expanded stay expanded-form after a later `/tui default` (same trade family as the
  fullscreen wave's "answers commit whole").
