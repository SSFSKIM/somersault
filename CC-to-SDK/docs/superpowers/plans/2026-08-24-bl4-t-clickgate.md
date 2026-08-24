# T-CLICKGATE Implementation Plan — clickable gate + clickable error/truncated result rows

> **For agentic workers:** REQUIRED SUB-SKILL: doperpowers:subagent-driven-development, task-by-task.
> Spec: `docs/superpowers/specs/2026-08-24-bl4-clickgate-gifwebp-design.md` (Ticket 1). Steps use `- [ ]`.

**Goal:** transcript hover brightens ONLY canon's clickable rows, and clicking a clickable row toggles
that one message's in-place verbose expansion — matching installed canon 2.1.237's `isItemClickable`
contract.

**Architecture:** a `clickable` bit is minted where the truncation/error predicates are already computed
(`toolRenderer`/`outputFold`), rides `RenderItem` → `HitRow` exactly as `ownerKey` did in F10 T-HOVER,
gates `hoverAt`, and widens the existing fold tap machine so release dispatches either the fold toggle or
a new per-`ownerKey` expansion toggle that re-projects that message as `detail-all` with canon's
expanded marker (background `userMessageBackgroundHover` + `paddingBottom: 1`).

**Tech stack:** TypeScript ESM, Ink, vitest (`npm run test:tui`), the raw-SGR mounted-test recipe used
throughout `test/tui/hover*.test.tsx` / `fold-*.test.tsx`.

## Global Constraints

- Canon contract (2.1.237, spec "Canon facts" — binding):
  - clickable iff: error `tool_result` with content >10 lines, OR non-error `tool_result` whose fold hid
    rows (`hidden > 0`). Fold-group rows NEVER carry `clickable` (their `foldAnchor` mechanism is
    separate). Prose/thinking/user rows never clickable.
  - hover un-dim applies ONLY to clickable rows; expanded rows suppress hover (`hovered && !expanded`).
  - click toggles per-message expansion keyed on the message unit (ccx `ownerKey`); expanded row renders
    `detail-all` with `backgroundColor: userMessageBackgroundHover` + `paddingBottom: 1`.
  - unexpanded rows ignore blank-cell hover; expanded rows light from their blank tail too.
  - a click landing on a `HitRow.linkRanges` cell does NOT toggle (no-op; URL-open deferred, spec D5).
  - fullscreen `… +N lines` markers carry NO hint tail (spec D6); classic/pager `foldHint` arms untouched.
- The predicate is RETURNED from the producer, never regexed out of rendered body text (spec D7).
- Every line anchor below is from research against a possibly-stale tree — **verify each with grep
  against HEAD before editing.** Modules stay <500 LoC where they are today; new logic prefers new
  modules over growing `FullscreenViewport.tsx`/`ChatApp.tsx`.
- Existing selection/caret/fold suites must pass UNMODIFIED except where a task explicitly moves pins.
- Commands from `CC-to-SDK/harness/`: `npm run typecheck`, `npm run test:tui`, targeted `npx vitest run`.

---

### Task 1: surface the predicates; mint `RenderItem.clickable`

**Files:** Modify `src/tui/outputFold.ts`, `src/tui/toolRenderer.tsx`, `test/tui/hover-owner.test.tsx`
(new matrix cell), `test/unit/streaming-items.test.ts` if the RenderItem shape is pinned there.

**Interfaces produced:** `RenderItem.clickable?: boolean` (union at `toolRenderer.tsx:81-82`-region,
beside `foldAnchor`/`expanded`/`ownerKey`, with the same "must survive `wrapItems`" note);
`foldToolOutput` and `errorBody`/`resultBody` return their truncation bit.

- [ ] **Step 1: failing test.** New `hover-owner.test.tsx` cell "clickable is minted exactly on canon's
  kinds": drive the real producer path (the file's existing 18-cell matrix shows how) with (a) an error
  result of 12 lines → its gutter-block items carry `clickable: true`; (b) an error result of 3 lines →
  no `clickable`; (c) an ordinary result long enough to fold → `clickable: true`; (d) a short ordinary
  result → none; (e) a fold-group row → none; (f) plain assistant text → none.
- [ ] **Step 2:** run it — FAIL (field absent).
- [ ] **Step 3: implement.** `foldToolOutput` returns `{ lines, hidden }` (or a sibling
  `foldTruncation()` — pick whichever touches fewer call sites; ALL existing callers must keep exact
  output). `errorBody` likewise exposes `overflow > 0`. `resultBody` (~`toolRenderer.tsx:251-267`)
  returns `{ body, clickable }` where `clickable = status === "error" ? overflow > 0 : hidden > 0`
  (statuses other than `"error"`/`"success"`: follow canon — only error and truncated-success qualify;
  `interrupted`/`rejected`/`running`/`suppressed` rows are not clickable). Stamp it on the result
  gutter-block item minted at ~`toolRenderer.tsx:479`.
- [ ] **Step 4:** cell PASSES; `npx vitest run test/tui/hover-owner.test.tsx test/tui/toolRenderer.test.tsx` PASS.
- [ ] **Step 5:** `npm run typecheck`; commit `bl4(clickgate): producers mint RenderItem.clickable on canon's two kinds`.

### Task 2: project into HitRow; gate hover on clickable owners

**Files:** Modify `src/tui/mouse/hitmap.ts`, `src/tui/FullscreenViewport.tsx` (`hitRowsOf` ~L279-315,
`hoverAt` ~L427-435), `test/tui/hitmap.test.ts`, `test/tui/hover.test.tsx`.

**Interfaces produced:** `HitRow.clickable: boolean` (required, default-false at construction —
`clickable: item.clickable === true`, the `ownerKey` precedent: optional fields let a forgetful
constructor typecheck); an owner-level `clickableOwners: Set<string>` built alongside the hit rows
(owner is clickable iff ANY of its rows is — spec D4; the header line of a clickable result must
brighten with its body).

- [ ] **Step 1: failing tests.** `hitmap.test.ts`: the real publish path (`wrapItemsToWidth →
  pageItemSlices → hitRowsOf`) carries `clickable` through wrap fragments. `hover.test.tsx` (raw-SGR
  mounted recipe, e.g. the `:160` un-dim cell as template): (a) motion over a >10-line error result
  un-dims it; (b) motion over plain assistant prose does NOT un-dim (this cell flips the F10
  hover-everything behavior — the old "prose brightens" pins move here); (c) `(No output)` row stays
  byte-identical (existing `:245` cell must still pass).
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: implement.** Two-line projection in `hitRowsOf` + build `clickableOwners`; in `hoverAt`,
  set `hoveredKey` only when the resolved owner is in `clickableOwners` (blank-tail rule: keep the
  existing `col <= at.width` bound for UNexpanded rows; Task 4 relaxes it for expanded ones).
- [ ] **Step 4:** all of `hover.test.tsx`, `hover-owner.test.tsx`, `hitmap.test.ts`,
  `selection*.test.tsx`, `clickCaret.test.tsx` PASS (selection/caret untouched by the gate).
- [ ] **Step 5:** `npm run typecheck`; commit `bl4(clickgate): HitRow.clickable + hover gated to clickable owners`.

### Task 3: click dispatch + per-owner expansion

**Files:** Modify `src/tui/FullscreenViewport.tsx` (`anchorAt` ~L413-418), `src/tui/ChatApp.tsx`
(release arm ~L1048-1049), `src/tui/useChat.ts` (expansion state ~L322-330, clears ~L1130,1279),
`src/tui/toolRenderer.tsx` (`ProjectionOptions` ~L133 + the `detail-all` flip), `src/tui/Line.tsx` or the
slice wrapper in `FullscreenViewport.tsx` (~L855 region) for the expanded marker;
`test/tui/fold-click.test.tsx`, `test/tui/fold-expand.test.tsx`.

**Interfaces produced:** `clickTargetAt(col,row): string | undefined` returning a STABLE SCALAR
encoding — `"fold:" + anchor` or `"item:" + ownerKey` — because the tap machine compares stored targets
with `===` and separately-resolved objects would never match across press/release (spec D11); parse the
prefix at dispatch. Press/release matching, multi-click windowing via `lastPressRef`, and `discardTap`
keep working unchanged on the scalar;
`toggleItemExpand(ownerKey: string)` + `expandedItemsRef: Set<string>` in `useChat` (a separate set
beside `expandedFoldsRef` — do not overload fold semantics), threaded as
`ProjectionOptions.expandedItems`.

- [ ] **Step 1: failing tests.** `fold-click.test.tsx`: (a) click a >10-line error result → full error
  text visible in the next frame, marker line gone, background token + one padding row present; (b)
  second click → byte-identical original compact frame (C6's collapse-restores pin); (c) click a
  truncated ordinary result → full output; (d) click a ≤10-line error result → falls through to caret
  (assert the caret moved, reusing `clickCaret` helpers); (e) fold clusters still toggle (existing cells
  green). `fold-expand.test.tsx`: the set survives re-projection and clears at the two reset sites.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: implement.** Release arm: resolve `clickTargetAt`; `"fold"` → `toggleFold`, `"item"` →
  `toggleItemExpand`. Projection: an item whose `ownerKey` is expanded renders its result with
  `projection: "detail-all"` and NO marker line — and the clickable bit STAYS true on the expanded
  projection (Task 1's as-if-compact predicate; add the collapse-while-expanded cell). Expanded marker:
  the background and the one padding row are REAL rows in the row model — produced where rows are
  produced, so wrap → height → paging → `hitRowsOf` all agree; never a wrapper-level `paddingBottom`
  (it would create a physical row invisible to the hitmap and shift every following mouse/selection
  address — spec D11). Add a cell: an expanded owner spanning the viewport boundary with a following
  clickable row — the following row's hover/click addresses are unshifted. Hover context forced false
  for expanded owners (the ~L855 provider term already has `s.item.expanded !== true` — extend it to
  the new set's owners). If this outgrows the host module, put the expansion row-model logic in a NEW
  module (both host files are already large).
- [ ] **Step 4:** the two files + `fold-hitmap.test.tsx` + full `npm run test:tui` PASS.
- [ ] **Step 5:** `npm run typecheck`; commit `bl4(clickgate): click toggles per-owner verbose expansion with canon's expanded marker`.

### Task 4: edge rules — link cells, blank tails

**Files:** Modify `src/tui/ChatApp.tsx` or `FullscreenViewport.tsx` (whichever hosts the release
resolution), `test/tui/fold-click.test.tsx`, `test/tui/hover.test.tsx`.

- [ ] **Step 0: verify the substrate.** Check whether `linkRangesOf` actually captures OSC-8 links in
  ORDINARY (non pre-styled) segments — e.g. a path-tool (Read/Edit) header line. If it does not, extend
  the scan to those segments with grapheme-aware column mapping (or surface link metadata structurally);
  record what you found in the report (spec D12).
- [ ] **Step 1: failing tests.** (a) a click whose cell sits inside a `HitRow.linkRanges` span of a
  clickable row does NOT toggle (frame unchanged — a plain no-op), covering a path-tool header case if
  Step 0 shows those carry links; (b) hover motion over
  the blank tail (col > text width, ≤ row width... col within viewport) of an UNexpanded clickable row
  does not brighten it; the same motion over an EXPANDED row keeps its (suppressed-hover) state stable —
  pin canon's `hoverIgnoresBlankCells: !expanded` asymmetry as far as ccx's hover-suppression-on-expanded
  makes observable: concretely, assert the unexpanded blank-tail case, and assert expansion state is
  unaffected by blank-tail clicks.
- [ ] **Step 2:** FAIL → **Step 3:** implement (link-span check at release resolution; blank-tail bound
  stays as-is for hover since Task 2 kept `col <= at.width`) → **Step 4:** PASS + full `test:tui`.
- [ ] **Step 5:** commit `bl4(clickgate): link-cell clicks are no-ops; blank-tail rules pinned`.

### Task 5: bare markers in fullscreen (verify-first)

**Files:** Verify first, then modify the fullscreen marker path (`toolRenderer.tsx` `ProjectionOptions`
threading of `expandHint` — the mechanism already exists: an EMPTY `expandHint` renders no tail), move
affected pins in `test/tui/` frame tests; `test/tui/toolRenderer.test.tsx`.

- [ ] **Step 1: verify.** Render a folded result through the FULLSCREEN path at HEAD and print the
  marker line. If it already lacks the hint tail, record that in the report and SKIP to Step 5 (commit
  nothing).
- [ ] **Step 2: failing test** — fullscreen transcript marker is exactly `… +N lines` (no tail); the
  ctrl+o pager (`detail-collapsed`) and classic arms keep their existing hints (existing pins prove it).
- [ ] **Step 3: implement** by threading an empty `expandHint` into the fullscreen transcript projection
  ONLY (the `FoldOptions.expandHint` contract's EMPTY arm is exactly "carries no offer") — do not touch
  `foldHint` itself.
- [ ] **Step 4:** moved pins + full `npm run test:tui` PASS.
- [ ] **Step 5:** commit `bl4(clickgate): fullscreen markers drop the hint tail (canon dT-null)` (or the
  verify-only report line).

### Task 6: verification — acceptance as written + pty cell

- [ ] Run spec cells C1-C8 as written, naming the covering test for each in the report; full
  `npm run typecheck && npm run test:tui && npm run test:unit`.
- [ ] C9 (pty, real binary): build (`npm run build`), then per the `scripts/select-pty.sh` recipe drive a
  session whose turn yields a PROVEN error result — a nonzero Bash exit is NOT proof of `is_error`;
  verify the pre-click frame shows the error styling/predicate (grep the frame for the error body form)
  before clicking, and pick a producer verified to yield `is_error: true`,
  send SGR mouse press/release on the error row, capture before/expanded/after-collapse
  frames, and commit them under `.doperpowers/sdd/2026-08-24-bl4-round/` (`git add -f` — the dir is
  gitignored). The cell FAILS the task if the frame does not visibly expand — a cell that cannot run is
  a blocker, not a skip.
- [ ] Report per-cell evidence.
