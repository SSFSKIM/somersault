# bl10 R2 — click-to-expand / click-to-collapse on tool-result blocks

**Question.** Owner observed: "tool-use streamings only expand on click and don't re-collapse when
re-clicked." (a) What are canon 2.1.251's real click semantics on a tool-result/expandable block?
(b) Why doesn't a re-click collapse in ccx — and is that a bug we introduced, a thing we never built,
or a misread?

**Verdict up front.** Canon's click IS a toggle. Ccx's fold model IS a toggle too, and both halves are
implemented and covered by passing tests. So this is neither NOT-BUILT nor MISREAD — it is a **[BUG],
and specifically a hit-region bug, not a state-machine bug**: ccx bounds the clickable region of an
EXPANDED block at the painted text width, where canon bounds it at *screen-cell blankness* — and an
expanded block in canon is painted with a full-width background rectangle, so every cell inside it is
non-blank and therefore collapses on click. In ccx the same block is clickable only where glyphs are.
A second, independent contributor (canon-faithful, so not itself a defect) is that a *rapid* same-pixel
re-click is consumed as a double-click word-selection in both harnesses.

---

## 1. Canon 2.1.251 — the actual state machine

All line numbers are `~/claude-code-bundle/2.1.251/cli.pretty.js`.

### 1.1 The expansion state is one `Set`, and the click handler toggles membership

The transcript component (`MessagesList`-equivalent) owns the expanded set and the click handler:

```js
// L19761-19771
}, [H, Ft]), [Y, Z] = u(() => new Set), be = B((P) => {
    let ue = qm(P);
    Z((_e) => {
      let He = new Set(_e);
      if (He.has(ue))
        He.delete(ue);          // ← SECOND CLICK: collapse
      else
        He.add(ue);             // ← FIRST CLICK: expand
      return He;
    });
  }, []),
  de = B((P) => Y.size > 0 && Y.has(qm(P)), [Y]),   // isItemExpanded
```

`qm` (L19839) keys on `tool_use_id ?? uuid`. `be` is passed as `onItemClick` and `de` as
`isItemExpanded` to the virtual message list at **L19836**. The expanded flag then feeds that row's
render as `verbose: q || de(P)` (L19827) — expanding a row means re-rendering it verbose.

**So: click is an unconditional toggle. First click expands, second click collapses.** There is no
expand-only path anywhere in this component.

### 1.2 Clickability is computed from the message, never from the expansion state

`Ce` = `isItemClickable` (L19771-19795) branches on message type and, for a tool result, asks the
tool's own `isResultTruncated(toolUseResult, {columns})`. It never reads the expanded set. So a block
that was clickable while collapsed is still clickable while expanded — which is what makes the second
click reach a handler at all.

### 1.3 The clickable REGION is the whole message box, gated on cell blankness

The per-item wrapper (L19169-19174):

```js
function MS({ itemKey: i, msg: l, measureRef: m, expanded: p, hovered: f, clickable: g,
              onClickK: S, onEnterK: b, onLeaveK: x, children: T }) {
  return e(o, { ref: m(i), flexDirection: "column",
    backgroundColor: p ? "userMessageBackgroundHover" : void 0,
    paddingBottom: p ? 1 : void 0,
    onClick: g ? (M) => { if (M.hyperlinkUrl) return M.allowDefault(); S(l, M.cellIsBlank); } : void 0,
    onMouseEnter: …, onMouseLeave: …,
    hoverIgnoresBlankCells: !p,
    children: e(NLt.Provider, { value: f && !p, children: T }) });
}
```

and the list-level handler that receives it (L19399-19403):

```js
let ro = B((V, j) => { let Y = It.current; if (!j && Y.onItemClick) Y.onItemClick(V); }, []);
//                             ^ j === cellIsBlank: a click on a BLANK cell is dropped
```

`cellIsBlank` is read straight off the painted screen buffer (L377467 → `Ma` L372922 → `M0`
L372918):

```js
function M0(t, o) { let u = o << 1; return (t.cells[u] | t.cells[u | 1]) === 0; }
```

i.e. a cell is blank iff **both** halves of its packed cell word are zero — no glyph *and* no style.

**This is the crux.** When a message is expanded, `MS` gives the box `backgroundColor:
"userMessageBackgroundHover"`, and the renderer paints a background box as a full rectangle of styled
spaces (L376156-376163):

```js
let re = t.style.backgroundColor;
if (re || t.style.opaque) {
  … let Ye = " ".repeat(be), Ie = re ? IOe(Ye, { backgroundColor: re }) : Ye,
      Ot = Array(Le).fill(Ie).join("\n");
  o.write(C + oe, A + he, Ot);
}
```

Those spaces carry a non-empty style id, so their cells are **not blank**. The box is a column
flexbox in the full-width virtual list, so the rectangle spans the terminal width and the block's
whole height (plus `paddingBottom: 1`).

**Net effect — canon's asymmetric hit region:**

| state | what is clickable |
|---|---|
| collapsed (no background) | only cells that carry a glyph — trailing whitespace is blank and dropped |
| expanded (background band) | **every cell in the block's full-width rectangle**, glyph or not |

So in canon you can click anywhere on the highlighted band to close it. The `hoverIgnoresBlankCells:
!p` flag is the hover-side mirror of the same idea.

Click dispatch itself bubbles up the node tree calling every `onClick` (L374322-374336); blankness is
not filtered there — the filter is `MS`'s own `S(l, M.cellIsBlank)`.

### 1.4 What a *rapid* second click does — in canon too

Press handling (L374124-374137):

```js
let b = g - t.lastClickTime < bv && Math.abs(c - t.lastClickCol) <= Sv && Math.abs(m - t.lastClickRow) <= Sv;
t.clickCount = b ? t.clickCount + 1 : 1; …
if (t.clickCount >= 2) { …; t.props.onMultiClick(c, m, t.clickCount === 2 ? 2 : 3); return; }   // ← returns
t.props.onSelectionStart(c, m); …
```

with `bv = 500, Sv = 1, Ev = 400` (L373798). The release path only dispatches the click when there is
no selection and an anchor exists (L374146):

```js
if (wo(u), !hi(u) && u.anchor) { let g = t.props.onClickAt(c, m, t.pressIsWindowActivation); … }
```

A double-click press skipped `onSelectionStart` (so no anchor) and left a word selected (so
`hi(u)` is true) — **canon's own second click within 500 ms at the same cell does not collapse
either; it selects a word.** Ccx matches this exactly (see §2.4), so this is parity, not a defect —
but it is a plausible part of what the owner experienced, because "click, then click again to check"
is naturally sub-500 ms.

### 1.5 The keyboard affordance canon pairs with it

Nothing per-block. `ctrl+o` is the **global** `app:toggleTranscript` and `ctrl+e` is
`transcript:toggleShowAll` inside the Transcript context (binding table, L717586). The `(ctrl+o to
expand)` hint strings you see on folded rows point at the whole-transcript verbose view, not at a
per-block expand. Per-block expansion in the main chat is **mouse-only**, which the flicker-free
onboarding says in as many words:

- L16821 — `· Click to expand collapsed tool results`
- L17610 — `· Click to move your cursor or expand collapsed results`

(Consistent with the fact that the per-item click wiring only exists on the virtual-list path, i.e.
the flicker-free/fullscreen renderer; the classic path renders `Ft.flatMap(qo)` with no click at all.)

---

## 2. ccx — the code path

Files are under `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/src/tui/`.

### 2.1 The fold model DOES have a collapse transition

`useChat.ts:358`
```ts
function toggleFold(anchor: string): void {
  if (disposed.current) return;
  if (!expandedFoldsRef.current.delete(anchor)) expandedFoldsRef.current.add(anchor);
  reconcile();
}
```
`useChat.ts:369` — `toggleItemExpand(ownerKey)` is byte-for-byte the same shape on
`expandedItemsRef`. Both are exactly canon's delete-or-add. **A collapse transition exists.**

### 2.2 Dispatch reaches them

`ChatApp.tsx:1189-1192`
```ts
const target = hitmapRef.current?.clickTargetAt(e.col, e.row);
if (target !== undefined && target === at.target) {
  if (target.startsWith("fold:")) { toggleFold(target.slice(5)); return; }
  if (target.startsWith("item:")) { toggleItemExpand(target.slice(5)); return; }
}
```

### 2.3 The expanded item keeps its clickable bit — verified

`toolRenderer.tsx:585-587` re-renders an expanded owner at `detail-all` but deliberately does **not**
re-derive `clickable`; `resultBody`'s predicate (`toolRenderer.tsx:308-341`) is computed "as if
compact" so it reads the same `true` in both states. I checked the one way that claim could still
break — a projection change flipping `resultBody` between its typed arm and its generic arm — and it
does not: `summaryLines` (`toolSummaries.ts:391-411`) switches on `normalized.tool`, never on
projection, and none of its producers' `undefined` returns are projection-dependent. So the expanded
block is still a clickable owner, and `clickTargetAt` still resolves `"item:" + ownerKey` for it.

Fold clusters are the same: `expandedMemberItems` (`toolRenderer.tsx:1073`) stamps `foldAnchor:
anchorId` on every member row it emits, and `clickTargetAt` answers `"fold:" + anchor` before it ever
consults the clickable set.

### 2.4 …and the tests prove collapse works

`npx vitest run test/tui/fold-click.test.tsx` → **27/27 pass**, including:

- `test/tui/fold-click.test.tsx:159` — "a tap on a collapsed cluster expands it, and a tap on the
  expanded block collapses it"
- `:492` — a clickable error result "expands it in place, and a second tap collapses it
  byte-identically"
- `:748` — the advisor row, same open-then-close pair

`docs/parity/tui-ux.md:2209` records this was also proven in the real binary over a pty
(`.doperpowers/sdd/2026-08-24-bl4-round/t-clickgate-pty-c9.txt`): a 16-line `is_error` result clicked
open and clicked closed byte-identical.

**So there is no recorded decision that click-expand is one-way — the opposite: two-way is the
shipped, documented, pty-verified contract.** That rules out NOT-BUILT and MISREAD.

### 2.5 Where it actually breaks: the hit region never widens when a block expands

`FullscreenViewport.tsx:444-448` (`clickTargetAt`):
```ts
const at = painted[row - top];
if (at === undefined || col < 1 || col > at.width) return undefined;
```
and `at.width` is painted-glyph width, in both row constructors:

- `FullscreenViewport.tsx:282` (line rows) — `width: Math.min(gutterWidth + stringWidth(l.text), columns)`
- `FullscreenViewport.tsx:315-316` (gutter-block body rows) — `width: Math.min(item.gutter.length + stringWidth(body.text), columns)`

Neither reads `item.expanded`. There is no analogue of canon's cell-blankness test anywhere in ccx's
mouse layer, so **an expanded block is clickable only on the columns that carry glyphs, exactly as it
was while collapsed.** Every short line inside an expanded result — and results are full of them —
has a dead tail from its last character out to the terminal edge.

This is currently *pinned as intended* by `test/tui/fold-click.test.tsx:707`, "a click past the row's
own text never collapses it". Reading its own preamble (`:687-693`), that test pins ccx's pre-existing
`col <= at.width` bound rather than a canon finding — it was written as a description of our code, not
as a transcription of canon's `cellIsBlank` rule. The bl4 ledger line in
`docs/parity/tui-ux.md:2209` carries it forward as the edge rule "blank-tail clicks never toggle".
Against §1.3 that rule is **half right**: correct for a collapsed block, wrong for an expanded one.

Two things compound it into the symptom the owner saw:

1. **The expanded band is not full-width in ccx either.** `withExpandedMarker`
   (`toolRenderer.tsx:544-549`) sets `bg` on each `RenderLine`, and `Line.tsx:103-132` applies it as
   an Ink `<Text backgroundColor>` — so the highlight is only as wide as the text, where canon's is a
   Box rectangle spanning the width. The user therefore gets no visual cue about how far the
   clickable region extends, and it happens to be true that it extends no further than the tint.
2. **Fold clusters get no band at all.** `expandedMemberItems` stamps `expanded: true` but never calls
   `withExpandedMarker`, so an expanded tool-use *stream* has zero "I am open, click me to close"
   affordance — and hover brightening is simultaneously suppressed for anything carrying `expanded`
   (`FullscreenViewport.tsx:927`, canon-faithful: canon's provider is `f && !p`, L19174). Canon can
   afford to kill hover feedback on an expanded item because the persistent background band is the
   feedback. Ccx kills the hover and never had the band, so an expanded cluster looks inert.

### 2.6 The secondary contributor: a fast re-click is eaten as a double-click

`ChatApp.tsx:1123-1137` — same-target, ±1 cell, ≤500 ms extends the multi-click run and calls
`multiClickSelectionAt` instead of arming a tap; `ChatApp.tsx:1174-1181` then returns early on
release because a sweep exists. Canon does the identical thing (§1.4, `bv=500`, `Sv=1`). Recorded
already in `docs/parity/tui-ux.md:2209` as "same-pixel rapid double-click on an expanded result reads
as word-select … open UX question". **Parity, not a defect** — but if the owner tested by clicking
twice quickly on the same pixel, this alone reproduces "expands, then won't re-collapse", and it will
keep reproducing after the §2.5 fix.

---

## 3. Verdict

**[BUG] — hit-region, not state-machine.** Canon's click is a two-way toggle (L19761-19771) and so is
ours (`useChat.ts:358`, `:369`); the state transition and its dispatch are correct and covered. What
diverges is *where a click counts*: canon widens the clickable area of an expanded block to its whole
full-width background rectangle by construction (background box → styled cells → `cellIsBlank` false,
L376156-376163 + L372918), while ccx keeps the same glyph-width bound in both states
(`FullscreenViewport.tsx:282`, `:315`, gated at `:448`), and has pinned that as intended in
`test/tui/fold-click.test.tsx:707`. Expanded tool-use *clusters* additionally get no expanded band at
all, so they carry neither the widened region nor any visual affordance.

Two sub-findings that are **not** bugs and should not be "fixed":
- Ctrl+O is not a per-block expand in canon — it is the global transcript toggle; per-block
  expand/collapse is mouse-only. Ccx matches.
- Rapid same-pixel double-click reads as word-select in canon too. Ccx matches.

## 4. Minimal-change fix direction (direction only)

The whole gap lives in one place: `HitRow.width` is "how wide is the text", and canon's question is
"is this cell painted". Widen the *expanded* case only, so the collapsed case keeps canon's
glyph-only rule:

- Carry `RenderItem.expanded` into the hitmap the way `clickable` and `ownerKey` already are, and let
  an expanded row's `width` be the full `columns` (canon's rectangle) rather than
  `gutterWidth + stringWidth(text)`. `clickTargetAt`'s existing `col > at.width` guard then answers
  correctly in both states with no new branch in the mouse layer.
- Re-point `test/tui/fold-click.test.tsx:707` from "expanded blank tail never collapses" to
  "expanded blank tail DOES collapse", keeping `:696` (collapsed blank tail) as-is — the two cases are
  supposed to differ, and today they don't. Update the "blank-tail clicks never toggle" line in
  `docs/parity/tui-ux.md:2209` to the asymmetric rule.
- Make the expanded band actually span the row (a full-width `bg`, canon's Box rectangle) and extend
  `withExpandedMarker` — or an equivalent — to `expandedMemberItems`, so an expanded fold cluster
  looks open and shows where the enlarged hit region is. Cosmetic on its own, but it is what makes the
  widened region discoverable, and it is the reason canon can suppress hover on expanded items.
- Leave the double-click behaviour alone (parity), but consider noting it in the round's UX ledger,
  since a widened hit region makes it *more* likely a user's quick second click lands within 1 cell of
  the first and gets eaten.

---

### Evidence index

Canon (`~/claude-code-bundle/2.1.251/cli.pretty.js`): L16821, L17610 (click hints) · L19169-19174
(`MS` wrapper: background/padding when expanded, `cellIsBlank` gate, `hoverIgnoresBlankCells: !p`) ·
L19399-19403 (blank-cell drop) · L19761-19771 (the toggle) · L19771-19795 (`isItemClickable`,
expansion-independent) · L19836 (call site) · L372918-372926 (`M0`/`Ma` blankness) · L373798
(`bv=500, Sv=1, Ev=400`) · L374096-374148 (press/multi-click/release dispatch) · L374322-374336 (click
bubbling) · L376156-376163 (background box paints a styled rectangle) · L717586 (keybindings:
`ctrl+o → app:toggleTranscript`, `ctrl+e → transcript:toggleShowAll`).

ccx: `harness/src/tui/useChat.ts:358,369` · `harness/src/tui/ChatApp.tsx:1115-1137,1174-1192` ·
`harness/src/tui/FullscreenViewport.tsx:273-283,293-320,444-463,927` ·
`harness/src/tui/toolRenderer.tsx:308-341,544-549,585-587,1073,1246` ·
`harness/src/tui/toolSummaries.ts:391-411` · `harness/src/tui/mouse/hitmap.ts:126-137` ·
`harness/test/tui/fold-click.test.tsx:159,492,687-716,748` (27/27 passing) ·
`docs/parity/tui-ux.md:2209` · `docs/parity/coverage.md:588-589`.
