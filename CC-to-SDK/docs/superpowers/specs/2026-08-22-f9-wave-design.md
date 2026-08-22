# F9 wave — mouse remainder, syntax coverage, resume transcript view, image paste, auto default

**Date:** 2026-08-22 · **Status:** approved (owner, 2026-08-22) · **Canon:** installed Claude Code
**2.1.236**, bundle `/Users/new/claude-code-bundle/2.1.236/cli.pretty.js` (read with `sed -n` ranges,
never `grep -o`).

**Research base (all cites verified live 2026-08-22):**
`.doperpowers/sdd/2026-08-22-f9-wave/r1-mouse.md` · `r2-syntax.md` · `r3-resume-view.md` ·
`r4-image-paste.md` · `r5-permission-auto.md` (repo root). Probe evidence:
`probes/probes/113-image-content-block.ts` (live-run 2026-08-22, REACHABLE).

## Purpose

Close the five owner-chosen parity items left after the bl2 backlog round: the fullscreen mouse
remainder (the largest single 🟡 in §2), the 10→383 syntax-highlighting gap, the `/resume` full-screen
rendered transcript (D-W9), image paste (Ctrl-V, probe-gated until now), and — the one deliberate
product change rather than fidelity item — flipping the interactive REPL's default permission mode to
`auto`, which unifies every ccx surface on one mode and matches both canon's live rollout and the
owner's own `~/.claude/settings.json`.

## Wave shape

Five tracks in parallel git worktrees (bl2 pattern): sonnet implementers off controller-verified
briefs, per-task sonnet reviews with reviewer-run mutation checks, fix subagents to the same worktree,
sequential `git merge --no-ff` into main, full gates on the assembled tree
(`npm run typecheck`, `npm run test:tui`, `npm run test:unit` from `harness/`; never bare `npm test`).
**Merge-order constraint: I4 (the transcript image-projection fix) lands as a standalone commit
before T-RESUME merges** — T-RESUME's image-only acceptance cell depends only on that commit, not on
the clipboard/transport work, so a rollback of the riskier T-IMAGE transport tasks cannot strand
T-RESUME (spec review finding, adopted). Other tracks are order-free; expect `useChat.ts` /
`ChatApp.tsx` / `bindings.ts` / `theme.ts` union-style conflicts as usual.

Live gates run on the subscription OAuth token (refreshed by owner 2026-08-22; verified live by
probe 28: `apiProvider:"firstParty"` with no API key in env).

## Global constraints

- Canon bundle cites are 2.1.236 line numbers; every brief cite is spot-verified by the controller
  before dispatch. 2.1.220 numbers in older docs do not resolve — re-locate before use.
- No `Co-Authored-By` lines; commit completed work to the branch; **never push** without the owner's
  explicit word.
- Never print/echo/commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`; live runs load env via
  `set -a; . ../.env; set +a`. The API-key line stays commented in `.env`.
- No new `process.on("SIG…")`/process handlers anywhere; the existing handler bodies in
  `src/cli/main.ts` and `src/tui/altScreen.ts` may be extended only.
- Never `git add -A` from repo root (shared repo) — stage explicit paths only.
- `src/appserver/` is **writable again this wave** — the concurrent session that owned it is done
  (owner confirmed 2026-08-22). T-IMAGE's submit widening includes it.
- Modules stay small; new leaf modules over hot-file growth. Tests must fail against the nearest
  wrong implementation (mutation-check discipline).

---

## Track T-MOUSE — the fullscreen mouse remainder

**Premise correction the whole track stands on (R1):** canon does not disarm mouse reporting so the
terminal can select. It arms the maximum set `?1000h ?1002h ?1003h ?1006h` (mode `"full"`, defaulted
L663070, selected by `G_e()` L126009) and runs its own selection engine over its rendered screen.
ccx's current `?1000h ?1006h` is canon's named `"scroll"` mode — exactly what
`CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` selects — in which canon additionally drops left-button reports
at the door (L199637). Native terminal selection remains reachable the way canon documents it: the
terminal's own modifier bypass (Shift / Option / Fn), named in the copy toast.

**Structural approach:** ccx has no hit-testable layout tree and no cell-addressed screen buffer
(canon's `DUr` L200080 / `frontFrame.screen`), so the architecture is not portable. Every feature is
instead a query against a **widened hit map** — `FullscreenViewport.hitRowsOf` rows grow from
`{anchor, width}` to carry the row's **plain text**, **gutter width**, and **soft-wrap class**
(`wrapItems.ts` already computes continuation information and discards it at paint; carry it through).
Slicing is by `stringWidth`, never `.length`.

### M1 — hit-map widening (task zero)

`HitRow` widens to carry (exact field names are the plan's call; the capabilities are the
requirement):

- **a stable row identity independent of `foldAnchor`** — today `anchor` exists only on fold
  clusters, so ordinary user/assistant rows would be unhoverable (spec review finding, adopted).
  Every painted row carries the identity of its source item (e.g. the slice/item index), with
  `foldAnchor` remaining the optional click-target channel it already is. Hover keys off the item
  identity; click-to-expand keys off `foldAnchor` exactly as today.
- **plain text** of the row (derived via the existing `stripSgr` at publish time — painted rows are
  pre-styled SGR strings, so the map stores the stripped form), plus **gutter width** and
  **soft-wrap class** (`wrapItems.ts` already computes continuation information and discards it at
  paint; carry it through).
- **grapheme-safe column addressing**: column→character mapping over the plain text must respect
  grapheme clusters and double-width cells (reuse the X4T `snapToGraphemes` machinery + a
  `stringWidth`-aware walk; canon steps back one column on the trailing half of a wide cell). CJK,
  emoji, and combining-mark cases are required test cells, not nice-to-haves.
- **link spans where present** — the fold data's `linkRanges` channel (T-PRLINK) rides into the map
  so word-select can select a whole OSC-8 link (canon L198615-198617).

Published from the same slices being painted, so map ≡ paint (existing invariant, keep it).

### M2 — arm `"full"`, decode motion and drag

- `altScreen.ts`: a mode selector `"full" | "scroll" | "off"` mirroring canon's `IXe`
  (L199031-199039); default `"full"` = `?1000h ?1002h ?1003h ?1006h`. Env escape hatches with canon's
  exact names and semantics (`G_e()` L126009): `CLAUDE_CODE_DISABLE_MOUSE` → `off`,
  `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` → `scroll`. `MOUSE_OFF` (all four, SGR first) unchanged. The
  rides-the-screen invariant survives; only the enable string changes.
- `parse.ts`: split the `& 32` rejection — `(button & 32) && (button & 3) === 3` → `action:"motion"`;
  `(button & 32) && (button & 3) !== 3` → `action:"drag"`. Keep the `& 64` / `& 128` rejections.
  The event type becomes a **discriminated union**: `motion` carries no `button` field at all (its
  low bits are `3`, which the current `button: 0|1|2` type cannot represent — spec review finding,
  adopted); `press`/`release`/`drag` keep `button: 0|1|2`.
- **Coordinates stay 1-based end-to-end** (revised from v1's 0-based migration): ccx's fullscreen
  geometry is deliberately 1-based with `top <= 0` as the not-addressable sentinel
  (`RegionTopContext`), and a 0-based row 0 would collide with that sentinel. Canon's internal
  0-based convention (L199668) is private, not observable behaviour — staying 1-based is a recorded
  internal divergence with zero fidelity cost. Local/relative coordinates for the composer math are
  computed by subtraction at the consumer, as canon does.
- **Dispatch gate:** mouse events are dropped at dispatch when the current mouse mode does not arm
  them — `off` drops everything, `scroll` drops left-button press/release and all motion/drag — so
  unsolicited reports from a confused terminal are inert (acceptance 7 is otherwise untestable;
  spec review finding, adopted).
- Same-cell motion dedupe before hover dispatch (`lastHoverCol/Row`, L199673-199676) — canon's entire
  rate-limit defence for `?1003h`; port it verbatim.

### M3 — hover brighten

Two visual halves (canon §2.3):

- **The load-bearing half: hover cancels dim.** Canon flips one React context and every dimmed
  `<Text>` in the hovered row's subtree renders at full colour (`QmS`, L203979; provider at L562783,
  suppressed on already-expanded rows). ccx equivalent: hovering a transcript row-cluster (resolved
  through the hit map's anchor) renders that cluster's dimmed text at full colour. Mechanism is the
  plan's call (context into the row renderer, or SGR-dim suppression at paint for the hovered
  cluster's rows) — the observable behaviour is fixed.
- **The background pair:** add `userMessageBackgroundHover` beside the existing background token in
  ccx's **four concrete palettes** — light `rgb(252,252,252)`, dark `rgb(70,70,70)`,
  light-daltonized `rgb(232,232,232)`, and **dark-daltonized** (value read from canon's sibling
  palette block around L188034 at brief time — it exists in canon and must be verified, not
  invented). ccx has no ANSI palettes (canon's light-ansi/dark-ansi rows are out of scope), and
  `auto` is a runtime alias that resolves to dark/light — it carries no tokens of its own (spec
  review finding, adopted).
- Blank-cell suppression is free: the hit map already bounds `col <= width` by painted extent.
- **Recorded divergence:** hover granularity is row-cluster; canon's ~20 per-widget hover sites
  (dialog buttons, footer controls, suggestion rows) need the layout tree ccx lacks — out of scope,
  scored as such.
- Hover repaint must not cost a full reflow beyond ccx's normal frame paint — the plan budgets this
  (it is the one place a per-cell event stream meets a full-frame renderer).

### M4 — click-to-caret

- The composer publishes its painted top row and left inset the way `FullscreenViewport` publishes
  `regionTop` (a computed constant, not a measurement).
- The wrap engine (`editor.ts` + composer wrap path) exposes the inverse map:
  `(line, column) → string offset` over the **prefixed** string — the prompt prefix/chips are wrapped
  *with* the text and the prefix width subtracted at the end, clamped to `[0, text.length]`
  (canon's exact arithmetic, L539383-539394 / L607573-607578). The composer's viewport start line is
  added to `localRow` before the lookup; frame border/padding are subtracted from local coordinates
  first.
- Extends the existing tap state machine in `ChatApp.tsx` with a second target (the key registry
  resolves only the innermost mouse sink — a second sink would shadow; extend, don't add).
- Selection-inside-composer delete/replace (canon L607579-607593) is **deferred** (depends on M5,
  cut from v1, recorded).

### M5 — drag selection

- State machine ported directly from canon (plain state, no tree): `{anchor, focus, isDragging,
  anchorSpan}`; press sets anchor and starts the drag; a focus identical to the anchor is not
  recorded (that non-record is precisely how release distinguishes click from sweep).
- Multi-click: within 500 ms and 1 cell in both axes (canon `vCp`/`TCp`); double-click = word select
  walking the row text outward with canon's char class `tfS = /[\p{L}\p{N}_/.\-+~\\]/u` (L198741),
  stopping at cluster/row bounds; triple-click = line select. If the word walk lands inside an OSC-8
  link span, select the whole link (canon L198615-198617) where link ranges are available in the fold
  data.
- **Scope v1: region bounds** — columns clamped to `[0, columns)` of the region; canon's per-element
  `selectionScope` walk needs the tree. Recorded divergence.
- **Selection paint:** rows/columns inside the selection get the `selectionBg` theme token
  (already present, currently unconsumed, `theme.ts:45,53,61,69`) injected as SGR background runs at
  paint time in the region renderer, skipping nothing else about the row's styling.
- **Extraction:** plain text (canon strips styling — the extractor reads chars, never styles), rows
  joined soft-wrap-aware: a continuation row joins its predecessor with no newline; a hard break
  yields a newline (`Tka`/`Hii` semantics over the hit map's soft-wrap class).
- **Recorded divergence:** no scrolled-off-row capture (canon `Cka` snapshots text as rows leave the
  viewport); v1 clamps the selection to the visible region.
- **Selection lifetime** (canon `Kjh` L551382-551395 / `oNw` L551372-551380): Ctrl+C **copies** the
  selection when `copyOnSelect` is off and **clears** it when on (already copied); any other ordinary
  key clears the selection; the allow-list that does *not* clear: `escape`, `pageup`/`pagedown`,
  `ctrl+home`/`ctrl+end`, and arrows/home/end with shift/meta.

### M6 — auto-copy and the clipboard rewrite

- **Auto-copy** (canon `Lts` L551426-551457): a selection-change subscriber with a once-per-selection
  latch — fires on the first non-dragging notification with a non-empty selection, copies **without
  clearing the highlight**, never re-fires for the same selection. Gated on the new setting
  `copyOnSelect` (**default true**), which joins the existing settings dialog.
- **`copy.ts` rewrite** (canon `yP` L188574-188591 — it does *both* channels on every copy):
  - native tool unless SSH (`SSH_CONNECTION` check): macOS `pbcopy`; Linux CLIPBOARD **and** PRIMARY
    (`wl-copy`/`xclip`/`xsel` chain); Windows PowerShell — keep ccx's existing chain, add PRIMARY;
  - **always** emit OSC 52 to stdout: plain `ESC]52;c;<b64>`, tmux DCS passthrough
    (`ESC Ptmux; ESC ESC]52;… ESC \`) when `$TMUX`, screen DCS chunking when `$STY`.
- **Toast** (canon `Mts` L551407-551424), channel-keyed:
  - `copied N chars to clipboard` (native),
  - `copied N chars to tmux buffer · paste with prefix + ]`,
  - `sent N chars via OSC 52 · if paste fails, hold <mod> while selecting for native copy` — `<mod>`
    is `Fn` on Apple Terminal, `Option` on iTerm2, `Shift` elsewhere (canon `n2n()` L188443).

### T-MOUSE acceptance (observable)

1. Fullscreen boot writes `?1000h ?1002h ?1003h ?1006h` with the alt-screen enter string; teardown
   still writes all four `l`s. `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` boots with today's exact
   `?1000h ?1006h`; `CLAUDE_CODE_DISABLE_MOUSE=1` arms nothing.
2. Feeding SGR motion bytes (`\x1b[<35;C;RM`) produces `motion` events (no `button` field), deduped
   per cell; drag bytes (`\x1b[<32;C;RM`) produce `drag` events; existing press/release/wheel
   behaviour and the 1-based coordinate convention unchanged (existing tests pass unmodified).
3. Hovering a dim transcript row renders its text without dim and with the hover background token;
   moving off restores it; an expanded row is unaffected.
4. A click inside the composer text moves the caret to the clicked character, correct across wrapped
   lines, with the prefix and insets accounted for (unit cells over the inverse map + a
   composer-render case).
5. A drag across two soft-wrapped rows highlights them with `selectionBg` and, on release, copies the
   *joined* plain text (no newline at the wrap point, styling stripped) — with `copyOnSelect` on, no
   further keystroke needed, and the toast reports the channel-correct message; the OSC 52 write is
   asserted from the captured stdout, including the tmux-wrapped form under `$TMUX`.
6. Double-click selects the word under canon's char class; triple-click the line. Ctrl+C with
   `copyOnSelect` off copies; with it on clears; pressing a letter key clears; Escape does not
   re-trigger a copy.
7. All new behaviour is dead under `"scroll"` and `"off"` modes.

---

## Track T-SYNTAX — fenced-code highlighting 10 → 383

**Premise (R2):** zero new dependencies. `highlight.js@11.11.1` — canon's exact vendored version
(L521621) — is already a `cc-harness` production dependency, already lazily loaded behind a memoised
singleton in `diffHighlight.ts`, already driving 383 names for diff bodies. The gap is one module:
`src/tui/highlight.ts` still runs a hand-written 10-language regex lexer.

### S1 — shared hljs runtime

Extract from `diffHighlight.ts` into a shared `hljsRuntime.ts`: the lazy memoised singleton (with its
total-failure arm), `canonicalLanguage` (alias resolution by inverting `listLanguages()`),
`EXTRA_ALIASES` (the verified 12-name canon delta), `detectLanguage` (filename map + extension), and
the `_emitter.rootNode` walk — widened from `{color}` output to `Partial<Segment>` (canon needs
`dim`, `italic`, `bold`, `underline` too). `diffHighlight.ts` keeps its three scope maps and public
surface; behaviour unchanged (its tests pin this).

### S2 — rewrite `highlight.ts` on the runtime

- Scope map: canon's `jsw` (L523111) — all **36 scopes**, flat chalk, theme-independent:
  blue `keyword literal class title.class name`; cyan `built_in attr`; cyan+dim `type`;
  green `number comment doctag addition`; red `regexp string deletion`;
  yellow `function title.function`; grey `meta tag`; italic `emphasis`; bold `strong`;
  underline `link`; unstyled `subst symbol title params meta-keyword meta-string meta.keyword
  meta.string section attribute variable bullet code quote`.
- Scope lookup: canon's **suffix-trimming loop** (`zsw` L523068) — strip `hljs-`, look up, on miss
  trim after the *last* dot and retry until no dot remains (so `title.class.inherited` tries
  `title.class` then `title`), not a single prefix cut.
- Highlight the **whole block** in one call and split the result (canon L523230) — block comments,
  template literals, heredocs, multi-line JSX colour correctly. Line-by-line goes.
- One language set: `supportsLanguage` over the singleton replaces both `KNOWN_LANGS` and
  `UPSTREAM_LANGS` (label and body decided by the same predicate, as canon does). Unknown language:
  dim raw-lang label + plain body (existing polarity, unchanged).
- `toolSummaries.ts::previewRows` points at `detectLanguage()` instead of raw extension — filename
  map + 191 aliases free.
- `highlight.js` stays pinned exactly `11.11.1`. Canon's `lib/core` + per-language lazy shape
  (~45 ms saved, 223 hand-copied rows) is a **recorded follow-up**, not built. Canon's `cedar`
  built-in grammar and the plugin `hljsLanguages` capability are **recorded non-goals**.

### T-SYNTAX acceptance

1. ` ```rust ` (and `go`, `java`, `yaml`, any hljs-registered tag) renders coloured tokens; before
   this wave those bodies were flat.
2. A `/* … */` block comment spanning three lines inside ` ```c ` colours as comment on all three
   lines (the whole-block proof).
3. ` ```notalang ` renders a dim `notalang` label and a plain body; a supported language renders no
   label (polarity unchanged, now from one set).
4. A scope only reachable via suffix-trimming resolves to its trimmed style (unit cell over the
   lookup loop).
5. Diff-body highlighting is byte-identical before/after the extraction (existing diff tests pass
   unmodified; controller runs them against the extraction commit).

---

## Track T-RESUME — the full-screen rendered transcript view (D-W9)

**Canon shape (R3, all 2.1.236):** the picker (`Ocs` L583846) swaps itself out wholesale for a
separate view (`yvc` L583551) — not a pane inside the frame. The parity doc's L476605 is a 2.1.220
cite; it no longer resolves.

### R-1 — the view

- **Trigger:** Space **or Ctrl+V** from list mode (L584023); in search mode Space stays a literal.
  Enter in the list still resumes directly.
- **Takeover:** the picker element is replaced entirely — no `PickerFrame`, **no header/title row**
  (ccx's bold title goes; no canon twin), no alt-screen, no explicit height.
- **Rendering:** the real transcript substrate (`replayDocument` + `toolRenderer` projections +
  `RenderItemView` + `wrapItemsToWidth`) with the **detail-all** projection — canon forces verbose
  and show-all (L563347/L563371), so tool bodies render expanded. Do **not** reuse `TranscriptPager`
  (adds scroll keys and a hint row canon lacks) or `RegionPager` (sizes to the region; the picker
  mounts in the dock chain).
- **Windowing (canon's own arithmetic, L563246-563388):** tail-anchored cap of
  `te = fullscreen ? min(200, rows) : 200` collapsed items (fed from at most `2·te` raw messages).
  In ccx terms: classic mode renders the ~200-item tail into the flow (older rows land in terminal
  scrollback, as canon's do); fullscreen mode budgets to `overlayRows()`. **No in-view scrolling, no
  in-view search, no scrollbar, no `↑ N more above` line** — canon has none of these here; building
  them would be divergence in the generous direction.
- **Footer** (L583614-583622): a `flexShrink:0` column with a single dim **top border only**,
  `paddingLeft:2`; row 1 plain: `<relative> · N messages[ · <branch>]`; row 2 dim:
  `enter to resume · esc to cancel` (ccx's existing `PREVIEW_FOOTER` string, verbatim).
- **Keys:** Enter/`y` resume **with the fully loaded session**; Esc/`n` return to the list (canon
  reuses its Confirmation context; ccx binds the four keys in the picker's preview stage).
- **Loading (revised per spec review — the current loader collapses failure to `[]`, making
  failure and empty indistinguishable):** the preview state becomes a tagged
  `loading | loaded(messages) | failed(error)`. `Loading session…` + a dim `esc to cancel` hint
  render as a bare padded column (frame chrome dropped, canon L583604-583606); only the `failed`
  state renders failure copy (`(no messages)` retires to this arm); a `loaded`-but-empty session
  renders nothing above the footer (canon has no empty-state string). **Confirmation resumes with
  the loaded payload** (canon's `onSelect(Ccs ?? Gwt)`) — resume must not re-read the file and
  reject an empty result after a successful preview.

### R-2 — model plumbing

`sessionPickerModel.ts`: preview stage stops using `previewTail`/`PREVIEW_ROWS`; the projection
switches to the detail-all form; `PREVIEW_MESSAGE_WINDOW` (200) widens toward canon's `2·te` raw
arithmetic. `previewMeta` moves into the footer block. `bindings.ts` SessionPicker context gains
`ctrl+v → sessionPicker:preview` and the `y`/`n` confirmation keys for the preview stage.

### T-RESUME acceptance

1. In the picker, Space and Ctrl+V both open the transcript view; the picker frame and title
   disappear; the view shows expanded tool bodies (detail-all), not the collapsed preview.
2. Footer renders exactly two rows with the top-border-only chrome: meta plain, hints dim.
3. Enter and `y` resume the highlighted session; Esc and `n` return to the intact list.
4. A session longer than the cap renders the tail-anchored window with no "more above" indicator; in
   fullscreen the view fits `overlayRows()`.
5. **(post T-IMAGE merge)** an image-only session shows `[Image #N]` rows in the view — not an empty
   state — and the meta count agrees with the pane.

---

## Track T-IMAGE — image paste (Ctrl-V)

**Premise (R4/probe 113):** REACHABLE. SDK 0.3.237 accepts `{type:"image", source:{type:"base64",
media_type, data}}` inside streaming-input user messages; the model demonstrably reads pixels
(red→"Red", blue→"Blue" across two turns of one session; both block orders). Streaming input is
mandatory — ccx already runs sessions this way.

### I1 — clipboard reader (`src/tui/clipboardImage.ts`, new)

Canon's tier-2 quartet verbatim (canon L333974-334031): platform `checkImage` → `saveImage` to a
fixed scratch path in a `0700` dir → read bytes → `rm -f`. macOS `osascript «class PNGf»` (pure
StandardAdditions — targets no GUI app); Linux `xclip`/`wl-paste` including the BMP arms; Windows
PowerShell `System.Windows.Forms.Clipboard`. No image on clipboard → **text fallback**: read the text
clipboard and paste as text, guarded by canon's binary-garbage test (NUL byte, printable-ratio); no
text either → toast `No image found in clipboard. Use ctrl+v to paste images.` /
`…You're SSH'd; try scp?` (SSH-aware, canon L607379). No native addon tier (ccx has none).

### I2 — composer entry

`PastedEntry` (`editor.ts:44`) gains an `image` variant: `{ id, type:"image", content:<base64>,
mediaType, dimensions }`. `chipLabel` gains `[Image #N]` (the chip grammar in `pasteChips.ts:75`
already tokenises it); atomic chip delete and orphan sweep extend to the image variant.
`chat:imagePaste` enters the keymap: `ctrl+v` (mac/linux), `alt+v` (windows), both (wsl) — canon
L174817.

**Limits and re-encoding (revised per spec review — the v1 "reject anything oversized" cut would
have rejected most real screenshots, since canon's 512,000-byte per-block ceiling is normally met by
re-encoding, which we cut with `sharp`):**

- Canon's full limit set applies: 2000×2000 px pre-limit (`KX` L174696), 5 MiB base64 input cap,
  **and the 512,000-byte post-processing per-block ceiling** (`v$r` L174695) the v1 draft omitted.
- **darwin re-encode path (zero new deps):** `sips` (present at `/usr/sbin`… `/usr/bin/sips`,
  verified in R4) implements canon's ladder shape — resample to fit 2000×2000
  (`--resampleHeightWidthMax`), then JPEG quality steps 80/60/40/20 until the block fits 512,000
  bytes. Dimensions read from the PNG IHDR / JPEG SOF headers (no dep).
- **Other platforms:** no re-encoder → an image that exceeds any limit degrades to canon's own
  failure shape, a text block `[Image could not be processed: <reason>]` (L231262). `sharp` and the
  BMP rescue remain recorded follow-ups.
- **Per-turn aggregate cap (ccx-chosen guard, no canon twin, recorded):** total image base64 per
  turn ≤ 5 MiB; exceeding entries degrade to the failure text block. This bounds memory and request
  size where canon relies on practice.
- **Persistence (sharpened v3):** image payloads are never written to `history.jsonl` **or the
  on-disk paste cache** (`pasteCache.ts` — the seam `promptHistory.ts` uses for large paste
  bodies); only the `[Image #N]` label persists there, and a restored history line submits its
  literal label. **Volatile in-memory state keeps image entries intact** — stash (Ctrl-S), undo,
  and the queue deliberately retain `pastedContents` so a restore never submits a dead label;
  stripping them there would reintroduce payload loss. The SDK's own transcript persistence of
  submitted image turns is the engine's boundary, not ours — it is what makes resumed sessions
  render `[Image #N]` rows, and we do not interfere. Test cells: a recursive scan of an isolated
  fleet root + history/paste-cache files finds no base64 payload sentinel after an image paste;
  stash-and-restore round-trips the image entry in memory.

The ambient "Image in clipboard" polling hint is a recorded non-goal (v1).

### I3 — submit-chain widening (the cross-cutting change; contract revised per spec review)

- **The type is a narrow, JSON-safe input union defined by ccx** — `UserTurnInput =
  string | Array<{type:"text"; text:string} | {type:"image"; source:{type:"base64";
  media_type:string; data:string}}>` — not the SDK's response-side `ContentBlock` union (which
  excludes image *input*; the SDK's own `SDKUserMessage.message` is a `MessageParam`, and probe 113
  proved exactly this shape traverses it).
- Widened layers: `session/session.ts:132` (and the message builder at `:27`),
  `session/chatSession.ts:11`, `harness.ts` (`run`/`stream`), `appserver/registry.ts:34`,
  `appserver/fleetEngine.ts:126`, `daemon/supervisor.ts:144`, the composer queue (`QueueEntry`
  carries image entries structurally — a queued image turn must not flatten to its label), the
  editor/composer producer seams (`editor.ts` chip expansion, `ChatComposer` submit event — the
  paste map already rides the submit event to `useChat.ts:3021`, which is the flatten point), the
  host `submit` seam (`host/host.ts:58`), and the public exports (`src/index.ts` types +
  `npm run build` declaration check).
- **Transport (v3.1 — negotiated staging protocol; v3's bare manifest field had a silent-loss
  hazard: the prompt op's Zod union strips unknown keys, so an old host would run a text-only turn
  and never learn about the staged files):** a new host op **`stageImage`**. The client sends the
  small descriptor `{ mediaType, dimensions, size, sha256 }`; the host mints and returns a `0600`
  file path inside its own `img/` staging dir (`0700`); the client writes the bytes there and the
  `prompt` op carries the staged ids `{ stagedId, sha256 }`. **Version skew is loud by
  construction:** a pre-image host rejects `stageImage` as an unknown op → the client shows a
  notice (restart the host to enable image paste) and does not submit a stripped turn.
  **Ownership/GC:** the client owns a staged file until the host accepts the prompt (client
  deletes on its own failure paths); the host deletes every claimed file in a `finally` around
  assembly, and sweeps its staging dir for orphans older than a bounded age at start and
  periodically (a client crash between write and submit cannot leave clipboard images forever).
  **Turn correlation:** the prompt handler reserves and returns `turnSeq` synchronously BEFORE any
  file I/O — delayed assembly must not desynchronize the client's end-event wait. Staging lives in
  the **socket-owning client adapter** (`chatAdapter` — it knows the socket/host; `useChat` hands
  it the structural submission), so loopback, detachable, and attach all use the identical path.
  A missing/mismatched/oversized staged file degrades to the canonical failure text block, never a
  dropped turn.
- **The composer carrier (v3.1):** the editor stops flattening image chips — `submitTurn` returns
  a structural submission `{ display, submitText, pastedContents }` (text chips keep their
  existing `substituteChips` expansion; image entries ride the map), and `ChatComposer` →
  `ChatApp` → `useChat.submit` → `QueueEntry` carry it structurally end to end. A real
  Enter-keypress composer-to-adapter test gates this before the transport task builds on it.
- **v3.1 scope cut (recorded follow-up):** `harness.run/stream`, app-server schemas
  (`appserver/schema/turns.ts`, queue, turns), daemon types, and fleet relay stay **string-typed**
  in this wave — no silent bypass is possible because arrays are rejected at the type/schema
  level. The widened surfaces are the REPL clients (all three) and the library
  `Session.submit`/`chatSession` path, where the authoritative normalizer lives.
- **Authoritative validation lives at the Session message-builder boundary:** whatever path input
  arrived by (REPL staging, library call), the builder normalizes and enforces **every** cap — it
  decodes PNG/JPEG headers itself for the 2000×2000 dimension limit (the public block carries no
  dimensions field, so a library caller cannot bypass paste-time checks), plus the 5 MiB base64
  input cap, the 512,000-byte per-block ceiling, and the per-turn aggregate — degrading violations
  to the failure text block. The `useChat` gate is a UX courtesy, not the enforcement point.
  Boundary tests sit at exact values (1999/2000/2001 px, 5 MiB ± 1, 512,000 ± 1, aggregate ± one
  block).
- The chip flatten step (`useChat.ts` submit path) emits canon's wire shape: **text block first,
  image blocks appended** (canon L371395-371427). String callers stay source-compatible everywhere
  (plain prompts still pass as strings).

### I4 — transcript image rows (the cross-surface projection fix)

The species router / `replayDocument` renders image blocks everywhere they occur: a user-message
image block as `[Image #N]` (or bare `[Image]` unnumbered, canon L528790), a tool-result image as
`[Image]` (L522876), and the live-turn row `[Image data detected and sent to Claude]`
(L526971/L528081). This closes the false "image-only session empty state" — the defect was ccx's
projection dropping image blocks, not a count/pane tension.

### T-IMAGE acceptance

1. With a PNG on the macOS clipboard, Ctrl-V inserts an `[Image #1]` chip; deleting the chip removes
   the entry; submitting sends text-block-first + image block (asserted at the message-builder seam).
2. With text on the clipboard, Ctrl-V pastes the text; with nothing, the toast shows canon's copy
   (SSH variant under `SSH_CONNECTION`).
3. An oversized image degrades to the `[Image could not be processed: …]` text block; the submit
   still succeeds.
4. A persisted session containing image turns renders `[Image #N]` rows in the transcript, the
   resume view, and the preview count agrees.
5. **Live cell (subscription), probe-113-grade discrimination (revised per spec review):** through
   ccx's own submit chain, a text-only control turn, then a red image (image-then-text), then a
   blue image (text-then-image) on the same session — the run passes only if the control is
   healthy AND the two turns name their own distinct colours (a single red cell can pass on a
   colour-guessing model with a broken chain).
6. (v3.1) App-server, daemon, fleet, and `harness.run/stream` submits remain **string-typed** —
   arrays are rejected at the type/schema level, unchanged suites prove no behaviour drift; their
   widening is a recorded follow-up. An image submit against a **pre-image host** fails LOUDLY at
   the staging op (unknown op → client notice naming the host restart) — never a silent text-only
   turn.
7. (v3.1) Image payloads never appear in `history.jsonl` or the on-disk paste cache (recursive
   byte scan of an isolated root); the volatile stash/undo/queue RETAIN image entries in memory; a
   history line restored after restart submits its literal `[Image #N]` label; a queued image turn
   survives the queue structurally and submits with its image block intact.

---

## Track T-AUTO — interactive default permission mode `auto`

**Premise shift (R5):** the Wave T EP-T1 rationale is stale. Canon 2.1.236 is mid-rollout of
auto-as-default (gated fallback at L106133-106139; notice string "Auto mode is now Claude Code's
default permission mode." L560924), and the owner's `~/.claude/settings.json` already sets
`permissions.defaultMode: "auto"`. Flipping is now *toward* canon. Eyes-open cost, recorded: probe 85
on Claude-5 models measured the classifier approving essentially every explicit command (`rm`,
`sudo`, `curl | bash`, `$HOME` writes) — treat `auto` ≈ bypass for explicit commands; its value is
gating agent-initiated escalation, and `ask` rules still summon the broker (probe 64). The owner's
settings deny rules (`~/.ssh/**`, `~/.aws/**`, …) already load into ccx and remain the floor.

### A1 — the flip

- `src/cli/main.ts:440` and `src/cli/hostMain.ts:51` (the `--detachable` interactive child):
  `?? "default"` → the auto-default resolution below. Both together or the EP-T1 split-brain defect
  returns. `needsBypassConsent` (`main.ts:330`) moves to the same single rule.
- **The model-gate resolution (the one real design decision, settled; sharpened per spec review):**
  one launch resolver, and it **alias-resolves first**. The effective launch model (flag → saved
  pref → `DEFAULTS.model`, passed through `resolveModelAlias` so `opus`/tier aliases resolve to
  real ids — `autoModel.ts`'s own doc demands this) is tested with the **predicate
  `isAutoSupportedModel`**, not the transformer `resolveAutoModel` (which converts unsupported
  input to Sonnet — using it as a gate is exactly the silent swap we're avoiding). Supported →
  launch `auto`; unsupported → launch `default` with the model untouched, banner truthful (canon's
  launch path silently degrades the mode; ccx keeps banner truth instead). The resolver tracks
  whether the mode was **explicit**: an explicit `--permission-mode auto` keeps today's behaviour
  (`resolveOptions.ts:88` forces an auto-capable model — the user asked for auto by name). Test
  cells cover tier aliases, saved model preferences, the detachable launch, and explicit-auto +
  unsupported model. **Both constructors must resolve from the same effective model (v3):**
  `hostMain.ts` loads no prefs today, so a saved non-auto model would split foreground (`default`)
  from detachable (`auto`) — the effective model (flag → saved pref) is materialized where the
  detachable child is spawned (or the child loads prefs identically); test cells assert model AND
  mode together across both constructors.
- Banner/hookOpts truth is free (one `foregroundConfig` object, the qa3-02 fix — keep it).
- Headless `-p`, `--bg`, daemon, library: already `auto`; untouched. `ccx attach` still inherits the
  host's mode.

### A2 — the notice + the record

- `autoModeNotice.ts` adopts canon 2.1.236's two-variant copy (L676952-676958) via the **coarser
  observable rule** (revised per spec review — the SDK's `accountInfo()` exposes only
  `apiProvider`/`tokenSource`, no `subscriptionType`, so canon's pro/max/team plan gate has no
  reachable source in ccx): sessions authenticated by `CLAUDE_CODE_OAUTH_TOKEN`
  (`tokenSource === "CLAUDE_CODE_OAUTH_TOKEN"`) get the variant **without** "Sessions are slightly
  more expensive."; API-key sessions and unknown keep the cost sentence (canon's else arm).
  Recorded fidelity divergence: token-source proxy instead of plan tier. **Seam (v3):** no such
  seam exists today — `accountInfo` is consumed only while building the welcome banner. The token
  source is threaded `main.ts` → `ChatClientOpts` → `ChatApp` → `useChat`; the detachable child
  reads its own `accountInfo` (it is the host process). Attach clients have no source and take the
  unknown arm (recorded). Tested from a fake `accountInfo` result through the rendered notice.
- Record the **qa3-03 reversal** in `docs/parity/qa-sprint-1-triage.md` (decision, not regression:
  benchmark moved — canon rollout + owner's own setting), and update the EP-T1 comment block in
  `main.ts` to tell the new truth.
- Test updates (from R5 §5): `test/unit/cli-main.test.ts:183,:185,:483-486` rewritten to the new
  default; `:496` gains a sibling asserting explicit `--permission-mode default` still reaches host,
  banner, and hookOpts; `auto-mode-notice` gains a "launched-in-auto" case; a new case pins
  "defaulted auto + non-auto model → `default` mode, model untouched".

**Recorded follow-up (not built):** canon's settings-honouring shape — let
`permissions.defaultMode` decide when no mode is forced, with canon's scope-trust rule (auto only
from user/policy scope, L106111-106121). Gated on an unwritten probe: whether the SDK honours
`settings.permissions.defaultMode` when `Options.permissionMode` is omitted.

### T-AUTO acceptance

1. A bare `ccx` (default model) launches with host, banner, and hookOpts all reporting `auto`;
   `ccx --detachable` matches.
2. `ccx --model claude-haiku-4-5` launches in `default` with the model untouched; banner says
   `default`.
3. `ccx --permission-mode default` still pins Manual everywhere; `--permission-mode auto` with a
   non-auto model still forces the auto-capable model (unchanged explicit-auto path).
4. The auto-mode notice fires on a fresh install's first auto launch; under an OAuth-token session
   the copy omits the cost sentence, under an API-key session it keeps it (asserted at the
   token-source seam, which is observable).
5. qa-sprint-1-triage.md carries the reversal note; `test:unit` green.

---

## Cross-cutting close-out (single task, post-merge)

- **Stale parity rows corrected:** `tui-ux.md:197/1223/1938` (diff bodies — shipped Wave R, → ✅);
  `tui-ux.md:928` ("zero-dependency" highlighter claim); `CM33` (🚫→ re-enter denominator) and `K22`
  re-scored — their "needs terminal mouse-mode ownership" rationale died with the fullscreen wave;
  D-W9 rows re-cited to 2.1.236 (`yvc` L583551, takeover L584057) and closed;
  `coverage.md:294-296` mouse bullet dated/amended; `qa-driver.md:353` blanket "neither TUI enables
  mouse reporting" struck, `:743` clicks row corrected; `altScreen.ts:46` stale comment fixed
  (in T-MOUSE); the resume-view premise text in `sessionPickerModel.ts` corrected (in T-RESUME);
  the image-only empty-state framing corrected in both D-W9 rows (in T-IMAGE's wake).
- Section scores re-derived; `coverage.md` wave entry; memory file
  (`f9-wave-shipped`) + MEMORY.md line; probe 113 committed with the round artifacts.

## Acceptance (wave level)

- All five tracks' acceptance cells above pass **as written** on the assembled tree; cells that need
  a real TTY run under the established tmux driver with an isolated `HOME` under `/tmp`.
- `npm run typecheck`, `npm run test:tui`, `npm run test:unit` green from `harness/`.
- Live cells (T-IMAGE 5; a smoke `auto`-launch turn) run on the subscription token.
- No push. Commits to `main` per house rules.

---

## Decision Log

- **Full mouse remainder in one wave** (owner, grill) — over hover+caret-first split. The selection
  engine is the differentiator and the hit-map widening amortises across all three features.
- **Arm `"full"` by default with canon's env opt-outs** — the "keep scroll arming" alternative died
  when R1 showed scroll *is* canon's opt-out mode with clicks dropped at the door.
- **In-process selection engine, not disarm-for-native-selection** — R1 overturned the framing;
  canon's own remedy for native selection is the documented modifier bypass in the copy toast.
- **v1 selection divergences** (region-bounds scope; no scrolled-off capture; row-cluster hover) —
  honest cuts where canon's mechanism needs the layout tree / cell buffer ccx lacks; each recorded in
  the parity rows.
- **Syntax Option A** (full registration on the existing dep) — over B (`lib/core` lazy: 223 copied
  rows for ~45 ms), C (curated subset: re-litigates the judgement that produced the 10), D
  (`lowlight`: added indirection + two deps). B recorded as follow-up.
- **Resume view adopts canon exactly** — over reusing `TranscriptPager` ("strictly better" scroll
  keys/hints would trade parity for generosity; fidelity-first goal governs). No in-view scroll by
  design.
- **No `sharp`; oversize degrades to canon's failure text block** — over shipping the resize ladder
  with a native dep. Ladder recorded as follow-up.
- **Ambient clipboard hint skipped v1** — polling watcher, low value/weight ratio; recorded.
- **Auto Option A, flip outright** (owner, grill) — over B (ask-rule floor: ccx's first injected
  permission rules, partly duplicating the owner's own deny list), C (persisted pref: does nothing
  until set), D (settings-honour: needs an unwritten probe; recorded as follow-up).
- **Defaulted-auto yields to an explicit model; no silent swap** (owner, grill) — over canon's
  silent launch degrade; banner truth is the standing ccx posture (qa3-02).
- **Appserver widening included** — owner lifted the src/appserver/ ownership constraint 2026-08-22.
- **Live gates on subscription** — owner refreshed the OAuth token (verified via probe 28);
  supersedes the metered-vs-wait fork. During research, one metered fallback run cost ~$0.86
  (disclosed).
- **I4 decoupled: lands as a standalone projection commit before T-RESUME** (spec review, adopted)
  — over v1's whole-track ordering, so a rollback of the clipboard/transport work cannot strand
  T-RESUME's acceptance.
- **Coordinates stay 1-based end-to-end** (spec review, adjusted) — the reviewer flagged the
  0-based migration's collision with the `top <= 0` sentinel; rather than migrating every consumer
  and the sentinel, ccx keeps its 1-based convention (canon's 0-based internals are unobservable).
- **Image transport v1 is in-process only; wire-capped paths refuse with a notice** (spec review,
  adopted) — the host socket's `MAX_FRAME` and app-server `MAX_IN` byte caps make 5 MiB frames
  impossible today; blob handoff recorded as follow-up. Canon has no attach analog, so no fidelity
  cost.
- **darwin re-encode via `sips`, not `sharp`** (spec review, adjusted) — the reviewer showed the
  512,000-byte ceiling makes reject-only useless for real screenshots; `sips` gives canon's ladder
  on the primary platform with zero deps; other platforms degrade to text.
- **Images never persist to history/stash** (spec review, adopted) — base64 payloads out of
  plaintext files; labels only.
- **Auto-notice variant keyed off token source, not plan tier** (spec review, adopted) —
  `accountInfo()` exposes no `subscriptionType`; the observable proxy is recorded as a divergence.
- **Model gate = alias-resolve then `isAutoSupportedModel`** (spec review, adopted) — the
  transformer `resolveAutoModel` would have silently swapped aliased models, the exact defect the
  decision exists to prevent.
- **Resume preview state is tagged `loading|loaded|failed`; confirmation resumes with the loaded
  payload** (spec review, adopted) — failure and empty were indistinguishable in the current
  loader, and re-reading at confirm time could reject after a successful preview.

## Surprises & Discoveries

- Canon is rolling out **auto-as-default** (gated, with a shipped notice string), and the owner's own
  `settings.json` already opts in — the qa3-01 benchmark ("claude's is manual") is dead on this
  machine (R5).
- ccx's mouse arming is literally canon's **opt-out** mode (`CLAUDE_CODE_DISABLE_MOUSE_CLICKS`), not
  a lighter default (R1).
- `highlight.js@11.11.1` was already a production dependency doing 383 languages for diffs; the
  10-language lexer survived only by module history (R2). Three parity rows scoring diff bodies ❌
  were stale (Wave R shipped it, never scored).
- Canon's resume transcript view is **windowed (~200-item tail)** — the "whole transcript, terminal
  scrolls" premise in ccx comments was half wrong (R3).
- The "image-only session empty state" was never a count/pane tension: canon draws `[Image #N]`
  rows; ccx's projection drops image blocks — a cross-surface defect (R3).
- SDK image content blocks are **reachable headlessly** (probe 113: red→"Red", blue→"Blue", both
  block orders, multi-turn safe). The scorecard ❌ was ccx-side work, not an SDK limit (R4).
- The OAuth token 429'd mid-probe; the first probe run reported a **false UNREACHABLE** off the
  credential failure — a text-only control turn is now permanent in probe 113 (R4). The decisive run
  billed ~$0.86 metered (disclosed to owner; owner refreshed the token afterwards).
- Under `auto`, a classifier denial is invisible on the wire (probe 85 D) — ccx cannot render *why*
  something was blocked (R5).
- The spec review surfaced hard transport facts the research fan-out missed: the host socket and
  app-server peers cap frames in bytes (`host/server.ts` `MAX_FRAME`, `appserver/peer.ts` `MAX_IN`),
  so image blocks cannot naively cross attach/app-server wires; and `accountInfo()` carries no
  `subscriptionType`, so canon's plan-gated notice copy has no reachable source in ccx.
- The reviewer's "0-based migration collides with the `top <= 0` sentinel" finding dissolved by
  *not* migrating: canon's coordinate base is internal convention, not observable behaviour.

## Outcomes & Retrospective

**Shipped 2026-08-22, all five tracks merged to main, all gates green** (typecheck + build clean;
tui 4171 passed; unit 3325 passed; live cells on subscription). Overall parity 78.1% → 79.2%
(§1 87.5%, §2 71.4%). Merge order held (I4 → T-RESUME); the T-MOUSE merge's union conflicts
(hookOpts, ChatComposer imports/signature) and one semantic conflict (the live image test on the
deleted `previewItems` API) were the only assembly frictions.

**Review economics:** three Codex design rounds before any code (10 + 13 + 9 findings — every
verified claim held), 20 task reviews with reviewer-run mutations, 7 fix waves, and a final
whole-branch review whose 8 ccx findings (schema/adapter contract splits, budget clips, a
decode-before-limit allocation, stale selection indices, unquoted shell paths) were all fixed in
one wave. Three P1/P2 findings in `ptc-surface/` belong to the concurrent session and were relayed,
untouched.

**What the process caught that would have shipped broken:** silent image loss under version skew
(Zod strips unknown keys); the editor flattening chips before `onSubmit` (no structural path
existed); hover un-dimming expanded members' dim rows; caret clicks mis-positioning during every
busy turn; the resume `failed` state being unreachable in production; `resolveAutoModel` silently
swapping aliased models; a fifth stale arming literal T2's own audit missed (bisected by the T7
reviewer).

**Residues, recorded:** caret clicks fail safe (no-op) under dock co-occupants — occupant-height
accounting is the follow-up; per-widget hover (CM33) still needs a layout tree; scrolled-off-row
selection capture, selection remap-on-shift (v1 clears), the sharp/BMP ladder off darwin, the
ambient clipboard hint, non-REPL image surfaces (appserver/daemon/fleet/harness.run), and the SDK
`listSessions` image-only exclusion (upstream of ccx) are all named follow-ups. The Minor roll-up
lives in `.doperpowers/sdd/2026-08-22-f9-wave/round.md`.

## Revision Notes

- v3.1 (2026-08-22): focused Codex re-review of the T-IMAGE plan (nine findings, all verified).
  Transport became the negotiated `stageImage` op (loud version skew instead of Zod-strip silent
  loss), with explicit file ownership/GC, synchronous turn-sequence reservation, and staging in
  the socket-owning adapter. The composer carrier became structural
  (`{display, submitText, pastedContents}` — the editor previously flattened chips to a string
  before `onSubmit`). Normalizer decodes image headers for the dimension cap. Non-REPL surfaces
  (harness.run/stream, app-server, daemon, fleet) descoped to string-only with type-level
  rejection — recorded follow-up. Acceptance cells 6 and 7 rewritten (they still carried v2's
  refusal/stash wording — reviewer catch).
- v1 (2026-08-22): initial spec from the five R-reports + owner grill (four forks settled) + design
  approval.
- v3 (2026-08-22): the Codex **plan** review surfaced that even the foreground REPL submits over a
  loopback socket (`chatMain.tsx:713` → `remoteChatSession`), so v2's "in-process only" image
  transport scope was vacuous. Replaced with the shared-filesystem file handoff (manifest in the
  prompt op, host-side assembly + authoritative validation at the message builder), which also
  makes attach image-capable. Persistence sharpened (paste cache excluded; volatile stash/queue
  keep entries; SDK transcript boundary documented). Notice seam named explicitly
  (main → ChatClientOpts → ChatApp → useChat; attach takes the unknown arm). Saved-model
  preference materialized at the detachable spawn so both constructors resolve the same launch
  mode.
- v2 (2026-08-22): Codex adversarial review (gpt-5.6-sol, xhigh) returned ten findings; nine adopted
  (some adjusted), one countered with a simpler resolution (1-based coordinates over sentinel
  migration). Substantive changes: hit-map identity/grapheme contract (M1), discriminated mouse
  union + dispatch gate + 1-based convention (M2), four-palette hover tokens (M3), full canon image
  limit set + `sips` ladder + persistence exclusion (I2), `UserTurnInput` union + in-process v1
  transport scope + queue/host layers (I3), discriminating live cell (acceptance), tagged resume
  loading state + loaded-payload confirmation (R-1), alias-resolved `isAutoSupportedModel` gate
  (A1), token-source notice rule (A2), I4 decoupled from T-IMAGE for merge ordering.
