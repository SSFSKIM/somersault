# R3 — the `/resume` full-screen rendered transcript view (D-W9)

Canon: `/Users/new/claude-code-bundle/2.1.236/cli.pretty.js`. Every claim below carries a line cite into
that file. ccx paths are relative to `CC-to-SDK/harness/`.

---

## 1. What the parity doc records as missing

Two rows in `CC-to-SDK/docs/parity/tui-ux.md` carry D-W9.

**L439 (§4 scorecard, `/resume` preview body, 🟡):** the preview pane now *is* the transcript —
`projectCompact(replayDocument(msgs, {id, width}))` composed with `projectPending` — tail-anchored under the
`PREVIEW_ROWS` budget with `↑ N more above`, count floored to `N+` when the 200-message window cut the input.
Two arms recorded as missing:

1. "canon **replaces the picker with a full-screen rendered transcript** under its own footer (L476605) where
   ccx renders in-pane — a recorded divergence (D-W9) but a backlog item, not a deliberate end state, so it is
   scored as a gap";
2. "an **image-only session renders the empty state over a nonzero count**, because the shared predicate counts
   an image turn upstream also counts while the pane has no text to draw for it."

**L2021 (wave-2 narrative row)** repeats both, adds that this closes `s2qa4-13` fully and `s2qa4-14` only
partially, and re-cites L476605.

The in-code twin of the same claim is `src/tui/sessionPickerModel.ts` (header of the "pane itself" section,
and the `PREVIEW_ROWS` doc comment): *"Upstream renders the WHOLE transcript through the real message renderer
and lets the terminal scroll; ours is a fixed tail."*

---

## 2. ccx today

### `src/tui/sessionPickerModel.ts` (267 lines) — pure model, no React, no I/O

- `PREVIEW_ROWS = 12` — the pane's row budget.
- `PREVIEW_MESSAGE_WINDOW = 200` — how many raw persisted rows `previewItems` reads (tail).
- `previewItems(messages, {width, id?, cwd?, limit?})` → `{ items, hidden, windowTruncated }`. Builds
  `replayDocument(window, {width, frame:false, id})`, then `[...projectCompact(doc, ctx), ...projectPending(doc,
  ctx, new Set())]`, then `previewTail(...)` which walks backwards on item boundaries counting
  `itemRows` (a `line` is 1, a gutter block is `body.length`).
- `previewProjection(width, env)` — `ProjectionContext` with `now: 0`, `expandHint: ""`, no `pending`/
  `thoughtMs`/`agentMeta`/`bashHint`; `cwd` is the *previewed session's*, not the process's.
- `previewWidth(columns) = max(20, columns - 2)` — the picker frame's `paddingX={1}` on each side.
- `isPreviewMessage` / `previewMessageCount` — the countable-message predicate (user row with non-blank text or
  an image/document block; assistant row with a non-blank text block). Tool traffic draws but does not count.
- `previewMeta(s, count)` → `"<relative> · N messages[ · branch]"`.
- Literals: `PREVIEW_FOOTER = "enter to resume · esc to cancel"`, `PREVIEW_LOADING = "Loading session…"`,
  `PREVIEW_EMPTY = "(no messages)"` (documented as having no upstream twin).

### `src/tui/SessionPicker.tsx` (296 lines) — three stages in one component

`Stage = "list" | "preview" | "rename"`. Preview and rename *replace* the list inside the same `PickerFrame`
(a round top-border-only box, `borderColor` = `suggestion`, `paddingX={1}`, footer as a dim line with
`marginTop={1}`).

Data path: `loadMessages(id, dir)` prop → wired in `ChatApp.tsx:1522` to `previewSession` (which is the SDK
`getSessionMessages` seam in `useChat`), keyed on the *highlighted row's own* `cwd`. Raw rows are retained in
state (`preview.messages`), projected at render time so a resize re-wraps. A `previewToken` ref discards a
late arrival for a row the cursor has left. It does **not** go through `rows.ts` / `recentAssistantTexts`.

The preview render (SessionPicker.tsx, `if (stage === "preview")` arm):
- header: **the session title**, bold, `suggestion` colour;
- `PREVIEW_LOADING` while `preview.messages === null`;
- `PREVIEW_EMPTY` when the projection produced zero items;
- `moreAbove(pane.hidden, pane.windowTruncated)` dim, above the rows;
- `pane.items.map(item => <RenderItemView …/>)` — at most `PREVIEW_ROWS = 12` painted rows;
- `previewMeta(target, preview.count)` on its own line with `marginTop={1}`, inside the frame;
- footer `PREVIEW_FOOTER`.

Keys — context `SessionPicker`, pushed **preemptively** (`useKeyScope("SessionPicker", { preemptive: true })`)
because the inner `Select` unbinds `ctrl+r`. Bindings live in `src/tui/keys/bindings.ts:256-261`:
`space → sessionPicker:preview`, `ctrl+r → sessionPicker:rename`, `escape → sessionPicker:dismiss`,
`ctrl+a → sessionPicker:allProjects`, `ctrl+w → sessionPicker:allWorktrees`. Handlers are registered *per
stage*, so `space` types a space once a query exists. Inside `stage === "preview"` the only live key beyond
`escape` is `enter` (handled in `handleKey`, calls `onPick(target)` with the **list row**). There is **no
scrolling of any kind** in the preview stage.

Mount: `ChatApp.tsx:1522`, in the dialog chain that fills the composer/dock slot, sized with
`rows={overlayRows()}` / `columns={terminalColumns()}`. `overlayRows()` (ChatApp.tsx:1349) is
`fullscreen ? seamCap(size.rows) - 1 : terminalRows()`. `state.picker.open` is in `paneOwned`
(ChatApp.tsx:1028), so while the picker is up the live transcript window is blanked.

---

## 3. Canon 2.1.236

The parity doc's `L476605` is a **2.1.220** line number. In 2.1.236 the picker is `Ocs` at **L583846**
(`{ logs, maxHeight, forceWidth, onCancel, onSelect, onLogsChanged, onLoadMore, initialSearchQuery, isLoading,
reloadGeneration, showAllProjects, onToggleAllProjects }`), and the transcript view is a separate component
`yvc` at **L583551**.

### Trigger and exit

**Enter the view (L584023):**

```js
else if ((Ze.key === " " && Je || Ze.ctrl && Ze.key === "v") && gr)
  Ze.preventDefault(), _e(gr), ge("preview"), H("tengu_session_preview_opened", { messageCount: gr.messageCount });
```

`Je = !Ze.ctrl && !Ze.meta` (L584009), `gr` is the highlighted log (L583950). So **Space** *or* **Ctrl+V**,
from list mode only — the whole `yr` handler early-returns while `de === "preview"` (L583993-583994), and in
`search` mode space is a literal character. **Not** Enter, **not** Tab, **not** automatic on highlight: Enter
in the list resumes directly (`onSelect: (Ze) => o(Ze.value.log)`, L584061-584062).

**The takeover (L584057-584059)** — this is the D-W9 mechanic, and it is a whole-component swap, before the
picker's own `height: t - 1` wrapper:

```js
if (de === "preview" && fe)
  return nb.jsx(yvc, { log: fe, onExit: () => { ge("list"), _e(null); }, onSelect: o });
```

**Leave / confirm, both inside `yvc`** — registered against the **`Confirmation`** key context:

- `bo("confirm:no", BLL, { context: "Confirmation" })` (L583581-583582) → `onExit` → back to the list.
- `bo("confirm:yes", zLL, { context: "Confirmation" })` (L583594) where
  `zLL = () => mdg(Ccs ?? Gwt)` (L583586-583588) → resume, **passing the fully loaded log**, not the stub row.

Per the default keymap (L174817, `Confirmation` block): `enter`/`y` → `confirm:yes`; `escape`/`n` →
`confirm:no`. So Enter resumes and Esc cancels — and `y`/`n` do the same thing, a free consequence of reusing
the Confirmation context.

### Loading

`ULL = hRe(Gwt) && Ccs === null` (L583560). `hRe` (L465237) is
`e.messages.length === 0 && e.sessionId !== void 0` — i.e. the picker row is a metadata stub. `ett` (L465240)
then reads the whole transcript off disk (`G6e(fullPath)`, leaf-uuid chain, `messages: B8r(z)`,
`messageCount: qvl(z)`) and `kpE` stores it.

While loading (L583604-583606): a `padding: 1` column containing `<Bc message="Loading session…" />` and one
dim hint line, `esc` → `cancel`. No header, no footer border.

### Layout

`yvc` returns exactly two children in a plain column (L583628):

```js
NpE = VL.jsxs(x, { flexDirection: "column", children: [fvc, gvc] });
```

- `fvc` — the transcript (below).
- `gvc` (L583622) — the footer:
  `{ flexShrink: 0, flexDirection: "column", borderStyle: "single", borderTop only
    (borderBottom:false, borderLeft:false, borderRight:false), borderTopDimColor: true, paddingLeft: 2 }`.

Footer contents, two rows:

1. **L583614** — `{relative modified} · {messageCount} messages{ · gitBranch}`, built from
   `bK(yIe.modified)` (L583610), `yIe.messageCount`, and
   `const ydg = yIe.gitBranch ? ` · ${yIe.gitBranch}` : ""` (L583613). Plain (not dim).
2. **L583618** — dim, joined by the ` · ` separator component:
   `<it chord="enter" action="resume" />` then
   `<yo action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />`
   → renders as **`enter to resume · esc to cancel`** (which is exactly ccx's `PREVIEW_FOOTER`).

**There is no header and no title row.** The transcript starts at the very top of the component. "Full-screen"
means the picker element is gone and this element is unconstrained — it is *not* an alternate screen and there
is no explicit `height`. Both mount sites lose their sizing: the in-session `/resume` command passes
`maxHeight: f ? Math.floor(p/2) : p - 2` (L584265) and the `--resume` startup picker passes `maxHeight: C`
(L685302), and neither reaches `yvc`. Scroll position on entry is therefore whatever Ink's flow render gives
you: the tail sits at the cursor, older rows are pushed into terminal scrollback.

### Rendering — it reuses the real transcript renderer

L583619:

```js
fvc = VL.jsx(iGe, { messages: hdg, tools: jLL, commands: kcs, inProgressToolUseIDs: Acs,
                    conversationId: gdg, screen: "transcript", latchAnnouncementSlot: !1,
                    streamingToolUses: LpE, showAllInTranscript: !0, isLoading: !1 });
```

`iGe` (L563288 → `uqw`, L563346) is the **same component the live REPL renders** (L593377) and the same one
`/export` renders (L563594). So markdown, tool folds, gutters, diffs — all identical to the main transcript.

Consequences of these exact props:

- `C = s === "transcript"` → true (L563347), and `k = verbose || C` → **verbose is forced on**. Tool uses and
  tool results are shown in full, expanded, exactly as Ctrl-O's show-all view shows them; `voc` (L563310)
  short-circuits `if (o === "transcript") return !0`, so nothing is filtered out by resolution state.
- `showAllInTranscript: true` ⇒ `fe = C && !l && !F` is **false** (L563371), so the `-Usc` (30-message)
  collapse and its "N earlier messages" notice do **not** apply.
- `tools: N7()` (L583573) — the full real tool registry, so tool renderers resolve properly.
- `inProgressToolUseIDs: new Set`, `streamingToolUses: []`, `isLoading: false` — nothing animates.
- `messages: $8r(yIe.messages)` (L583562). `$8r` (L373011) drops messages retracted by a
  `system/model_refusal_fallback` entry (telemetry `tengu_resume_retracted_dropped`); otherwise it is identity.

**It is windowed, despite loading the whole file.** `yvc` passes neither `scrollRef` nor `disableRenderCap`, so
in `uqw`: `F = _ != null && !L` is false and `v = false`, which arms **two** render caps via `h8h` (L563249):

- L563353 — `re = h8h(e, U, te * 2)` over the raw messages;
- L563388 — `yr = h8h(Be, j, te)` over the collapsed/derived list.

with `te = cqw(P)` (L563246) `= Ps() ? Math.min(200, rows) : 200`, `m8h = 200`, slack `aqw = 50`. `h8h` with a
null ref starts at 0 and, when `length - 0 > r + 50`, snaps to `length - r` — i.e. it keeps the **tail**. Net:
canon renders roughly the last 200 collapsed items (fed from at most the last 400 raw messages), tail-anchored.
Not the whole transcript. `/export` is the only caller that sets `disableRenderCap: !0` (L563594).

### Scrolling and search inside the view

`yvc` registers **only** `confirm:yes` and `confirm:no`. It pushes no `Transcript` or `Scroll` scope, passes no
`scrollRef`, and passes no `search` prop to `iGe` (contrast the live REPL at L593377, which passes both
`scrollRef: Qit` and `search: jwg`). The `Confirmation` context's own table (L174817) binds `up`/`down` to
`confirm:previous`/`confirm:next` (unhandled here), `tab` to `confirm:nextField`, `space` to `confirm:toggle` —
none of which move anything.

**There is no in-view scrolling and no in-view search.** You read it by scrolling the terminal.

### Empty states

- Stub-not-yet-loaded → `Loading session…` (L583605).
- Loaded but empty → `iGe` simply renders nothing above the footer. There is no `(no messages)` string; ccx's
  `PREVIEW_EMPTY` genuinely has no upstream twin.
- **Image-only session: canon renders a visible row, not an empty state.** The user-message image block
  renderer (L528790) computes `VUl = Nao ? `[Image #${Nao}]` : "[Image]"` and emits it as text, optionally as
  an OSC-8 link to the stored path (L528797) with a dim image description appended (L528802). A tool-result
  image renders as `[Image]` in its own row (L522876).

---

## 4. Gap list, reuse, and contradicted premises

### What ccx must build

| # | Gap | Canon cite |
|---|-----|-----------|
| G1 | Preview must **replace the picker element entirely**, dropping the `PickerFrame` and the height constraint, instead of rendering inside the frame. | L584057-584059 |
| G2 | **Drop the header.** ccx prints the session title bold at the top; canon has no header at all. | L583628 |
| G3 | **Move the meta line into the footer block** and give that block canon's chrome: single top border only, `borderTopDimColor`, `paddingLeft: 2`, meta on row 1 (plain) and the key hints on row 2 (dim). ccx puts meta inside the body and the footer outside. | L583614, L583618, L583622 |
| G4 | **Raise the row budget from 12 to canon's cap:** tail of ~200 collapsed items, not `PREVIEW_ROWS`. The `↑ N more above` indicator has no canon twin once the view is full-screen — canon lets the excess go to scrollback silently. | L563246, L563249, L563353, L563388 |
| G5 | **Verbose/show-all projection.** Canon forces `verbose` in transcript screen and passes `showAllInTranscript`, so tool bodies render expanded. ccx previews with `projectCompact`, the *collapsed* projection. Should be the detail-all projection (what `TranscriptPager` opens with). | L563347, L563371 |
| G6 | **Ctrl+V as a second trigger** alongside Space. ccx binds only `space`. | L584023 |
| G7 | **`y`/`n` also confirm/cancel**, because canon reuses the `Confirmation` context. ccx's preview stage answers only `enter` and `escape`. | L174817, L583581, L583594 |
| G8 | **Resume with the loaded session, not the list row** — canon calls `onSelect(Ccs ?? Gwt)`. Cosmetic for ccx (it resumes by id) but worth matching if the pick payload ever carries messages. | L583586-583588 |
| G9 | **Image blocks must render as `[Image #N]` / `[Image]`.** This is the real fix for the "image-only session shows the empty state" row — see the premise correction below. | L528790, L522876 |
| G10 | Keep `Loading session…` with its `esc to cancel` hint but drop its frame chrome: canon's loading state is a bare `padding: 1` column, not the picker frame. | L583604-583606 |

**Explicit non-goals** (canon has none of these, so building them would be a divergence in the generous
direction, not parity): in-view scrolling, `g`/`G`, `Ctrl-U/D`, `Ctrl-E` toggle, in-view search, a scrollbar,
alternate-screen takeover.

### Reusable ccx modules

- `src/tui/replay.ts` → `replayDocument`, and `src/tui/toolRenderer.tsx` → `projectCompact` / `projectPending` /
  `RenderItemView` / `ProjectionContext`. Already the preview's substrate; switch the projection to the
  detail-all form for G5 and this arm is 90% done.
- `src/tui/sessionPickerModel.ts` → `previewItems` / `previewProjection` / `previewMessageCount` /
  `previewMeta`. Keep all of it; widen `PREVIEW_ROWS` (or bypass `previewTail` entirely) and widen
  `PREVIEW_MESSAGE_WINDOW` toward canon's 400-raw/200-collapsed arithmetic.
- `src/tui/wrapItems.ts` → `wrapItemsToWidth` — needed the moment the view stops being 12 fixed rows, and it is
  the module that already encodes the wrap-first/window-second order.
- **`src/tui/TranscriptPager.tsx` — reusable but not a match.** It brings `pagerHint`, scroll keys, the
  `Transcript` scope, `pageItemSlices`, and a rounded full border. Canon's view has none of that. Using it
  would ship a strictly-better view at the cost of parity on the footer string and the key surface. Recommend
  **not** reusing it for D-W9, and instead lifting only `wrapItemsToWidth` + `RenderItemView`.
- **`src/tui/RegionPager.tsx` — not reusable as-is.** It sizes to `useRegionRows()` from `FullscreenFrame`, and
  the picker mounts in the dock/composer chain (`ChatApp.tsx:1522`), not in the region. It would only apply if
  the resume view were hoisted into the region slot in alt-screen mode — which canon does not do (canon has no
  alt screen here). If ccx wants a bounded view in fullscreen mode, the honest budget is already in hand:
  `overlayRows()` (`ChatApp.tsx:1349`).
- `src/tui/select/overflow.ts` → `moreAbove` — only if ccx keeps a bounded view; canon's has no such indicator.
- `src/tui/keys/bindings.ts:256` — the `SessionPicker` context is where G6 (`ctrl+v`) and G7 (`y`/`n`) land.

### Parity-doc premises this reading contradicts

1. **"Upstream renders the WHOLE transcript … and lets the terminal scroll."**
   (`sessionPickerModel.ts`, `PREVIEW_ROWS` doc comment; echoed by the tui-ux.md rows.)
   Half true. Canon *loads* the whole transcript (`ett`, L465240) but `iGe` **caps the render to a tail** —
   two `h8h` passes at `te*2` and `te`, `te = Ps() ? min(200, rows) : 200` (L563246, L563249, L563353,
   L563388). So the difference between ccx and canon is a window *size* (12 painted rows vs ~200 items), not
   the presence or absence of a window. ccx's existing `PREVIEW_MESSAGE_WINDOW = 200` is already the right
   shape; only the row budget is wrong.

2. **"an image-only session renders the empty state over a nonzero count, because the shared predicate counts
   an image turn upstream also counts while the pane has no text to draw for it"** (tui-ux.md L439, L2021).
   This frames the mismatch as an unavoidable consequence of matching upstream's count. It is not. Canon draws
   `[Image #N]` (or `[Image]`, or `[Image]` for a tool-result image) as a real text row — L528790, L522876 —
   so the count and the pane agree upstream. The gap is in **ccx's projection dropping image blocks**, and the
   fix belongs in the species router / `replayDocument`, not in `isPreviewMessage`. That also means this
   defect is *not* specific to the resume preview: any surface that projects a persisted image turn has it.

3. **`L476605` and the "full-screen rendered transcript" citation.** In 2.1.236 the takeover site is
   **L584057-584059** and the view component is **`yvc` at L583551**; the picker is `Ocs` at **L583846**. The
   line numbers in tui-ux.md are 2.1.220's and no longer resolve.

4. **"Full-screen" overstates it.** Canon does not enter an alternate screen and sets no height — it returns an
   unconstrained flow element in place of the picker (L584057-584059), which is why old rows land in terminal
   scrollback rather than being paged. Any ccx design that reaches for `FullscreenFrame` / alt-screen to close
   D-W9 would be building something canon does not have.

5. **ccx's preview header (the session title) has no canon counterpart.** The `SessionPicker.tsx` preview arm
   passes `header={<Text bold …>{titleOf(target)}</Text>}`; canon's `yvc` renders transcript + footer only
   (L583628). This is an unrecorded ccx-only addition, not a parity feature.

6. **`ctrl+v` as a preview trigger is unrecorded.** `bindings.ts:257` binds only `space`; canon binds both
   (L584023). Minor, but it is a real missing binding rather than a deliberate divergence — nothing in the
   ccx comments mentions it.
