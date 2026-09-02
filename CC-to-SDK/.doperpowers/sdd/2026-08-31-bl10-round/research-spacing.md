# bl10 R3 — Inter-block vertical spacing: canon 2.1.251 vs. ccx

**Verdict up front.** The owner's observation is exactly right, and the cause is a single missing
mechanism rather than a set of per-surface off-by-ones. **Canon puts one blank line above every
top-level transcript block, unconditionally, on the main screen. Our harness puts none, anywhere.**
Our `RenderItem` model has no margin concept, and no producer emits a stand-in blank row between
adjacent anchors — so every transcript block butts directly against its neighbour. The gap is not
"tighter"; it is **absent** (0 vs 1) for every adjacent pair except the two we already got right
(tool header → its own `⎿` body = 0 in both; markdown paragraph → paragraph = 1 in both).

Evidence is two-sided and empirical on both sides: a **real captured canon frame** (recorded from
the shipping binary, tracked in this repo) and a **live render of our own `ChatApp`** performed for
this research.

---

## 0. The two ground-truth frames

### 0.1 Canon — real binary capture

`harness/test/fixtures/upstream-frames/f1-tool-rendering/01-read-complete.ansi` (100×40 pyte
capture of the shipping Claude Code binary; the file's own banner reads `Claude Code v2.1.220`, and
every spacing site cited below was re-verified line-by-line against the **2.1.251** bundle, so the
model is 2.1.251's — the frame is corroboration, not the sole source).

Rows 12–24, SGR-decoded (`\x1b[0;2m` + spaces = a genuine blank row; the prompt band's rows carry
`48;2;55;55;55` background, blanks do not):

```
12  (blank)
13  (blank)
14  ❯ Use the Read tool to read src/app.ts, …        ← user prompt echo (banded)
15  (blank)                                          ← NOT banded: a real gap row
16  ⏺ Reading 1 file… (ctrl+o to expand)             ← collapsed tool-cluster row
17    ⎿  src/app.ts                                  ← its result body, NO gap above
18  (blank)
19  ✶ Effecting… (2s · ↓ 4 tokens)                   ← live spinner
20  (blank)
21  ──────────────────────────────────────────────   ← composer top rule
22  ❯
23  ──────────────────────────────────────────────
24    ⏸ manual mode on · esc to interrupt · …        ← footer
```

### 0.2 Ours — live `ChatApp` render (performed for this research)

Rendered through `ink-testing-library` against `fakeRemote`, same 100 columns, same message
sequence shape (prompt → assistant text → Read call → result → assistant text). Frames:

```
RUNNING TOOL                            TWO TURNS
1 ❯ turn one                            1 ❯ turn one
2 ⏺ Answer one.                         2 ⏺ Answer one.
3 ⏺ Reading 1 file… (ctrl+o…)           3   Read 1 file (ctrl+o to expand)
4   ⎿  src/app.ts                       4 ⏺ Answer two.
5 ─────── composer rule ───────         5 ❯ turn two
6 ❯                                     6 ⏺ Answer three.
7 ─────── composer rule ───────         7                       ← markdown gap:1 (correct)
8   ⏸ manual mode on · ? for shortcuts  8   Second paragraph.
                                        9 ─────── composer rule ───────
```

Not one blank row between blocks. The only blank in either frame is the **intra-message** markdown
paragraph gap (`markdown.ts:262`), which is correct and matches canon.

The same conclusion falls out of the projection layer directly, with no renderer involved — a
direct `projectCompact`/`projectDetail` run over a `TranscriptDocument` holding
prompt/text/Read/result/text/Bash/result/text returns items with **zero** blank lines between
anchors, in both projections.

---

## 1. Canon's spacing model (2.1.251)

### 1.1 The one mechanism

Every top-level transcript entry is rendered by **`gm`** (`cli.pretty.js:18701`), which computes a
single boolean and hands it down as `addMargin`:

- **`cli.pretty.js:18761`** — `Zt = er(mo, Bt, tr, _o) || Qn(mo, Bt)` → **18764** `let rr = Zt;` (`Bt = screen ===
  "transcript"`, `tr = showMessageTimestamps`, `_o = isSplitUserContinuation`)
- **`cli.pretty.js:18765`** — `const nr = !rr, pm = rr ? void 0 : Aa;`
- **`cli.pretty.js:18768`** — `e(fx, { message: De, …, addMargin: nr, …, hasMetadataHeader: rr })`

`rr` is the **metadata-header** predicate:

- **`cli.pretty.js:18569`** `Qn(i, l)` → `l && i.type === "assistant" && !!i.message.model &&
  i.message.content.some(m => m.type === "text")` — transcript-mode assistant text only.
- **`cli.pretty.js:18605`** `er(i, l, m, p)` → assistant arm: `m || (l && has-text-block)`; user
  arm: requires `m` (timestamps on). `m` is `showMessageTimestamps`.

**On the main screen with timestamps off — the default and the case the owner is looking at — `rr`
is false for every message, so `addMargin` is `true` for every message.** When `rr` *is* true, canon
does not lose the gap: the metadata-header row itself carries it —
**`cli.pretty.js:18792`** `r(o, { flexDirection: "row", justifyContent: "flex-end", gap: 1,
marginTop: 1, children: [Rn, Da] })`. Net vertical cost is invariant: **one blank row above every
block, always.**

### 1.2 Every consumer honours it identically

| block type | canon component | site | expression |
|---|---|---|---|
| assistant text (`⏺` row) | `zp` | **189046** / **189059** | `const Re = Lp ? 1 : 0` … `marginTop: Re` |
| thinking (`∴` row) | (fn @189126) | **189138** / **189161** | `rf = Db ? 1 : 0` … `marginTop: rf` |
| tool use + its `⎿` body | `Sz` | **190547** / **190591** | `Ml = es ? 1 : 0` … `marginTop: Ml` |
| user prompt echo (banded `❯`) | `us` (fn @191442) | **191456** / **191469** | `const ql = QE ? 1 : 0` … `marginTop: ql` (with `backgroundColor:"userMessageBackground"`) |
| bash-input echo | fn @191389 | **191410** | `marginTop: VP` (= `addMargin?1:0`) |
| system/notice rows | `Xy` | **194161** / **194185** | `const ZC = f3 ? 1 : 0` … `marginTop: ZC` |
| `recap:` row | fn @189496 | **189497** / **189515** | `const ek = lF ? 1 : 0` … `marginTop: ek` |
| REPL tool block | `Kb` | **189262** | `marginTop: P ? 1 : 0, **marginBottom: 1**` (the one block with a trailing gap too) |

The **tool header and its `⎿` result body share one component** (`Sz` builds `Ai = [tn, _l]` inside
a single Box, `cli.pretty.js:190586`), so there is **no** gap between them. Frame rows 16→17 confirm.

### 1.3 Non-message chrome

- **Spinner:** `Gn` — **`cli.pretty.js:77727`** — `e(o, { flexDirection: "row", flexWrap: "wrap",
  marginTop: 1, width: "100%", … })`. Unconditional 1. (Frame row 18.)
- **Composer:** **`cli.pretty.js:160599`** — `r(o, { flexDirection: "column", marginTop: bn || yEe ?
  0 : 1, … })`. 1 normally; 0 only in brief layout (`bn`) or with the suggestion palette open
  (`yEe`). (Frame row 20.)

### 1.4 Inside an expanded cluster (`collapsed_read_search`, verbose branch)

`uI` — **`cli.pretty.js:193379`**, verbose arm at **193415–193426**:

- absorbed thinking row → `e(o, { marginTop: 1, children: e(ni, { …, addMargin: !1 }) })` (**193422**)
- task-notification row → `e(o, { marginTop: 1, … })` (**193418**)
- each member tool row → `LC` (**193182**), whose container is **`cli.pretty.js:193259`** `FR = 1`
  → **193275** `marginTop: FR` — **unconditional 1** (note: not gated on `addMargin`)
- recalled-memory rows → `marginTop: 1` (**193426**)
- **hook block → no `marginTop`** (butts against the last member row) — which our own
  `expandedMemberItems` comment already records correctly.

### 1.5 Canon's table (preceding → following, main screen, timestamps off)

| preceding | following | blanks | cite |
|---|---|---|---|
| banner box | user prompt echo | 2 (banner's own trailing blank + the echo's `marginTop`) | frame 11→14 |
| user prompt echo | assistant text | **1** | 189046/189059 |
| user prompt echo | tool row | **1** | 190547; frame 14→16 |
| assistant text | tool row | **1** | 190547 |
| tool row (header) | its `⎿` result body | **0** | 190586; frame 16→17 |
| tool result body | next tool row | **1** | 190547 |
| tool result body | assistant text | **1** | 189059 |
| assistant text | assistant text (next msg) | **1** | 189059 |
| assistant text | thinking | **1** | 189138 |
| any block | user prompt echo (next turn) | **1** | 191456 |
| any block | system notice | **1** | 194161 |
| markdown paragraph | markdown paragraph (intra-message) | **1** | `<Markdown>` `gap: 1` |
| last transcript block | spinner | **1** | 77727; frame 17→19 |
| spinner | composer top rule | **1** | 160599; frame 19→21 |
| last transcript block | composer (no spinner) | **1** | 160599 |
| expanded cluster: member | member | **1** | 193259/193275 |
| expanded cluster: thinking | member | **1** | 193422 + 193259 |
| expanded cluster: last member | hook block | **0** | 193424 (no marginTop) |
| REPL block | anything after it | **1** (its own `marginBottom: 1`) | 189262 |

**Conditionals worth carrying into the spec:**
1. `addMargin = !hasMetadataHeader`. In **transcript mode (ctrl+O)** an assistant *text* message
   gets `addMargin: false` — but its metadata-header row supplies `marginTop: 1` instead
   (18792), so the visible gap is unchanged. Same with `showMessageTimestamps` on.
   ⇒ **Model it as an invariant "1 blank above every block", not as a prop we must thread.**
2. Expanded-cluster member rows use an **unconditional** `marginTop: 1` (193259), independent of
   `addMargin` — a separate rule from (1).
3. Composer gap drops to 0 under brief layout / open suggestion palette (160599).
4. The REPL block is the only one with a **trailing** margin (189262).

---

## 2. Our model (ccx)

### 2.1 The mechanism does not exist

`RenderLine` / `RenderItem` have **no margin field**. `render.ts:17` defines `RenderLine` with
`text/color/dim/bold/italic/strikethrough/underline/bg/gutter/segments/continuation/source` — no
spacing. `RenderItem` (`toolRenderer.tsx`) adds `kind/id/ownerKey/wrap/clickable/expanded/
foldAnchor` — no spacing.

The codebase already knows the workaround and states it explicitly, at
**`toolRenderer.tsx:1061-1065`**:

> *"One leading blank-text line stands for canon's `Box{marginTop:1}` around the row … (a blank line
> marks vertical space in this item model; there is no `marginTop` field to set)."*

That device is used in exactly **three** places today — and none of them is the inter-block seam:

- `toolRenderer.tsx:1069` — `thinkingRowItems`, one leading blank per absorbed thinking row.
- `toolRenderer.tsx:548` — `withExpandedMarker`, one **trailing** banded pad row.
- `markdown.ts:262` — the intra-message `gap: 1` between markdown blocks.

Plus the static composites: `banner.ts:180/187`, `species.ts:577` (the high-demand two-sentence
gap), `commands.ts:168`, `modelConfirmModel.ts:22`.

### 2.2 Where blocks get concatenated with nothing between them

Every anchor's `items` array is spread straight into the output:

- **`toolRenderer.tsx:1582`** — `if (placements.length === 0) return anchored.flatMap((a) => a.items);`
- **`toolRenderer.tsx:1587`** — `if (index < anchored.length) out.push(...anchored[index]!.items);`
  (`weaveStandaloneHooksFlat`, the **detail / ctrl+O** path)
- **`toolRenderer.tsx:1747-1763`** — `foldAnchored`'s `out` loop (the **compact / default** path):
  `out.push(...groupItems(…))` (1748), `out.push(...(anchored[item.sequence]?.items ?? []))` (1750),
  `out.push(...hooksItemRows(item, options))` (1755), `out.push(...items)` (1761)
- **`toolRenderer.tsx:1845-1857`** — `projectPending`'s `items` loop (open calls, active cluster row,
  withheld batches) — same, no separators
- **`toolRenderer.tsx:900-903`** — `projectMessageEntry`'s per-block `items.push({kind:"line", …})`
  loop: consecutive content blocks of one message also get nothing between them
- **`toolRenderer.tsx:568-580`** — `toolEventItems`: header item then `gutter-block` body item,
  no blank (this one is **correct**, matching canon 190586)

Composition above the projection adds nothing either: `Transcript.tsx:30-32` maps items to
`<RenderItemView>` with no separators; `wrapItems.ts` only re-wraps.

Chrome:
- **`ChatApp.tsx:1962`** `dock` fragment → **`ChatApp.tsx:1987`** `<TurnSpinner …/>`; `TurnSpinner`'s
  own render (**`TurnSpinner.tsx:93-100`**) is a bare `<Text>` with no wrapper Box and no margin.
- **`composerFrame.tsx:131`** — `<Box flexDirection="column">`, no `marginTop`; the composer is
  mounted at **`ChatApp.tsx:1919`** with nothing above it.

### 2.3 Our table

| preceding | following | blanks | cite |
|---|---|---|---|
| banner | user prompt echo | 1 (banner's own trailing `{text:""}`) | `banner.ts:187` |
| user prompt echo | assistant text | **0** | `toolRenderer.tsx:1582/1587/1750` |
| user prompt echo | tool row | **0** | same |
| assistant text | tool row | **0** | same |
| tool row (header) | its `⎿` result body | **0** ✅ | `toolRenderer.tsx:568-580` |
| tool result body | next tool row | **0** | `toolRenderer.tsx:1750/1761` |
| tool result body | assistant text | **0** | same |
| assistant text | assistant text | **0** | same |
| assistant text | thinking | **0** | same |
| any block | user prompt echo (next turn) | **0** | same |
| any block | system notice | **0** | `projectLocalEvent`, `toolRenderer.tsx:918-921` |
| markdown paragraph | markdown paragraph | **1** ✅ | `markdown.ts:262` |
| last transcript block | spinner | **0** | `ChatApp.tsx:1987`, `TurnSpinner.tsx:93` |
| spinner | composer top rule | **0** | `composerFrame.tsx:131` |
| last transcript block | composer | **0** | same |
| expanded cluster: member | member | **0** | `toolRenderer.tsx:1097/1101` |
| expanded cluster: thinking | anything | **1** ✅ | `toolRenderer.tsx:1069` |
| expanded cluster: last member | hook block | **0** ✅ | `toolRenderer.tsx:1103-1116` |
| streaming region rows | — | **0** | `streamingItems.ts:33` |

---

## 3. The diff

| pair | canon | ours | Δ | class |
|---|---|---|---|---|
| user prompt echo → first block of the reply | 1 | 0 | **−1** | [NOT-BUILT] |
| assistant text → tool row | 1 | 0 | **−1** | [NOT-BUILT] |
| tool result body → next tool row *(the owner's "tool streaming")* | 1 | 0 | **−1** | [NOT-BUILT] |
| tool result body → assistant text | 1 | 0 | **−1** | [NOT-BUILT] |
| assistant text → assistant text *(the owner's "agent messages")* | 1 | 0 | **−1** | [NOT-BUILT] |
| assistant text → thinking / thinking → anything (top level) | 1 | 0 | **−1** | [NOT-BUILT] |
| any block → next turn's prompt echo | 1 | 0 | **−1** | [NOT-BUILT] |
| any block → system notice / local visual | 1 | 0 | **−1** | [NOT-BUILT] |
| last block → spinner | 1 | 0 | **−1** | [NOT-BUILT] |
| spinner → composer, last block → composer | 1 | 0 | **−1** | [NOT-BUILT] |
| expanded cluster: member → member | 1 | 0 | **−1** | [BUG] |
| REPL block trailing gap | 1 | 0 | **−1** | [NOT-BUILT] (low value — no REPL tool surface) |
| tool header → its `⎿` body | 0 | 0 | ✅ | — |
| markdown paragraph → paragraph | 1 | 1 | ✅ | — |
| expanded cluster: last member → hook block | 0 | 0 | ✅ | — |
| expanded cluster: absorbed thinking | 1 | 1 | ✅ | — |

**Classification rationale.** This is **[NOT-BUILT]**, not [MISREAD]. Our own F1-era research
recorded the rule correctly and repeatedly — `docs/superpowers/research/2026-07-31-tui-clone/
02-transcript.md:56` says verbatim *"`marginTop: 1` when `addMargin`, i.e. **a blank line above the
message**"*, and `.../08-render-contract-2.1.220.md:265` and `.../14-f4-constants-pack.md:1472,
1552, 1854` all carry the same `marginTop: addMargin ? 1 : 0` expression. The reading was right; the
item model was built without a place to put it, and no producer ever emitted the stand-in blank.
The one **[BUG]** is the expanded-cluster member gap: `thinkingRowItems` (1069) got the leading
blank and the sibling member arm (1097) did not, inside the same function — an internal
inconsistency rather than an unported rule.

---

## 4. Concrete fix sites

**Primary — one invariant, applied where anchors are concatenated** (a `kind:"line"` item with an
empty `RenderLine` and a stable id, so `wrapItems`/`pageItemSlices`/`hitRowsOf`/`renderItemHeight`
all count it exactly once, which is the argument `toolRenderer.tsx:1061-1065` already makes):

- `harness/src/tui/toolRenderer.tsx:1582` — `weaveStandaloneHooksFlat` fast path (detail/ctrl+O)
- `harness/src/tui/toolRenderer.tsx:1587` — `weaveStandaloneHooksFlat` interleave loop
- `harness/src/tui/toolRenderer.tsx:1747-1763` — `foldAnchored`'s `out` loop (compact/default):
  the four `out.push(...)` arms at 1748, 1750, 1755, 1761
- `harness/src/tui/toolRenderer.tsx:1845-1857` — `projectPending`'s `items` loop (open calls,
  active cluster row, withheld agent batches)

  *Design note for the spec:* the separator belongs **above** each anchor (canon's `marginTop`), not
  between them — that is what makes the Static ↔ window ↔ pending region boundary work without a
  cross-region lookback, and what reproduces canon's 2-blank banner→prompt seam for free (our
  `banner.ts:187` trailing blank + the prompt's own leading blank). It also needs a
  **suppress-at-document-start** guard only if we decide the very first row of an empty transcript
  should not open with a blank; canon does not suppress it (`addMargin` ignores index).

**Secondary — per-block sites:**

- `harness/src/tui/toolRenderer.tsx:1097` — `expandedMemberItems`, member arm: give each member's
  `tagged` items one leading blank, matching `thinkingRowItems` at 1069 and canon `LC`
  (`cli.pretty.js:193259`, unconditional `FR = 1`). **[BUG]**
- `harness/src/tui/toolRenderer.tsx:900-903` — `projectMessageEntry`'s per-content-block loop: canon
  emits one *message* per content block and each gets its own `marginTop`, so consecutive blocks of
  one retained message need the same separator the anchor loop gets. (Check against
  `shouldShowDot`'s "consecutive text blocks in one turn share one bullet" rule before deciding
  whether these are one block or two.)

**Chrome:**

- `harness/src/tui/TurnSpinner.tsx:93-100` — wrap in `<Box marginTop={1}>` (canon `Gn`,
  `cli.pretty.js:77727`, unconditional). Mount is `ChatApp.tsx:1987`; `RetryRow` and `CompactionRow`
  share that slot (`ChatApp.tsx:1985-1986`) and need the same treatment, since canon's margin is on
  the slot's row, not on the verb.
- `harness/src/tui/composerFrame.tsx:131` — `marginTop: 1`, dropped to `0` when the suggestion
  palette is open (canon `bn || yEe ? 0 : 1`, `cli.pretty.js:160599`). Mount is `ChatApp.tsx:1919`.

**Surfaces that inherit the fix for free** (they consume the same projected items): the fullscreen
viewport (`FullscreenViewport`, `ChatApp.tsx:1656`), the ctrl+O pager (`TranscriptPager` /
`RegionPager`), `ccx attach` replay, and the resume transcript view.

**Test surfaces that will move.** Any frame-shape assertion in `harness/test/tui/` — expect churn in
`f1-frame-parity.test.tsx`, `f3/f4/f5/f6-acceptance.test.tsx`, `render.test.ts`,
`toolRenderer.test.tsx`, `transcriptPager.test.tsx`, `live-window-*.test.tsx` (row budgets change),
`fullscreen-*.test.tsx`, and the tmux width matrix (`npm run test:resize-matrix`). The live-window
and pager row arithmetic is the risk area: every block grows by one painted row, so any budget
computed against a fixed row count needs re-checking, not just re-snapshotting.

---

## 5. Method note

- Canon: `grep -n` + `sed -n` windows over `~/claude-code-bundle/2.1.251/cli.pretty.js` only; every
  line number above is from that file. The captured `.ansi` frame is a recorded artifact already in
  the repo — **the real interactive binary was not launched.**
- Ours: read-only inspection plus two live renders of the production `ChatApp` through
  `ink-testing-library` and one direct `projectCompact`/`projectDetail` run over a real
  `TranscriptDocument`. Scratch scripts lived outside the repo (`/tmp`) and were removed; **no
  source file was edited.**
