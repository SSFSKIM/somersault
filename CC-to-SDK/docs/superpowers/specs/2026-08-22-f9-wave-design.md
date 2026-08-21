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
**Merge-order constraint: T-IMAGE merges before T-RESUME** (T-RESUME's image-only acceptance cell
consumes T-IMAGE's projection fix). Other tracks are order-free; expect `useChat.ts` / `ChatApp.tsx` /
`bindings.ts` / `theme.ts` union-style conflicts as usual.

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

`HitRow` becomes `{ anchor?: string; width: number; text: string; gutterWidth: number;
softWrap: "hard" | "continuation"; kind: "line" | "gutter-block" }` (exact field names are the
plan's call; the four capabilities are the requirement: which cluster a cell belongs to, the plain
text of a row at a column range, where paint starts, and whether the row continues its predecessor).
Published from the same slices being painted, so map ≡ paint (existing invariant, keep it).

### M2 — arm `"full"`, decode motion and drag

- `altScreen.ts`: a mode selector `"full" | "scroll" | "off"` mirroring canon's `IXe`
  (L199031-199039); default `"full"` = `?1000h ?1002h ?1003h ?1006h`. Env escape hatches with canon's
  exact names and semantics (`G_e()` L126009): `CLAUDE_CODE_DISABLE_MOUSE` → `off`,
  `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` → `scroll`. `MOUSE_OFF` (all four, SGR first) unchanged. The
  rides-the-screen invariant survives; only the enable string changes.
- `parse.ts`: split the `& 32` rejection — `(button & 32) && (button & 3) === 3` → `action:"motion"`;
  `(button & 32) && (button & 3) !== 3` → `action:"drag"`. Keep the `& 64` / `& 128` rejections.
  Convert col/row to **0-based at the boundary** (canon L199668); migrate every existing consumer
  (tap machine, `anchorAt`) in the same task so one convention holds everywhere.
- In `"scroll"` mode, drop left-button press/release at dispatch (canon L199637 parity for the
  opt-out).
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
  all five palettes (canon values L188034: light `rgb(252,252,252)`, dark `rgb(70,70,70)`,
  light-ansi `whiteBright`, dark-ansi `white`, light-daltonized `rgb(232,232,232)`).
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
2. Feeding SGR motion bytes (`\x1b[<35;C;RM`) produces `motion` events, deduped per cell; drag bytes
   (`\x1b[<32;C;RM`) produce `drag` events; existing press/release/wheel behaviour unchanged
   (existing tests keep passing after the 0-based migration).
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
- **Loading:** keep `Loading session…` + a dim `esc to cancel` hint, but as a bare padded column —
  drop the frame chrome (canon L583604-583606). `(no messages)` remains only for a load *failure*;
  a loaded-but-empty session renders nothing above the footer (canon has no empty-state string).

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

**Limits without `sharp` (deliberate divergence):** dimensions parsed from the PNG IHDR (and JPEG
SOF where the bytes are JPEG); reject over 2000×2000 px or over 5 MiB base64 (canon `KX` L174696) by
degrading to canon's own failure shape — a text block
`[Image could not be processed: <reason>]` (canon L231262) — instead of running the JPEG resize
ladder. The ladder + BMP rescue are a recorded follow-up. The ambient "Image in clipboard" polling
hint is a recorded non-goal (v1).

### I3 — submit-chain widening (the cross-cutting change)

`submit(prompt: string, …)` widens to `string | ContentBlock[]` through **all five layers**:
`session/session.ts:132` (and the message builder at `:27`), `session/chatSession.ts:11`,
`appserver/registry.ts:34`, `appserver/fleetEngine.ts:126`, `daemon/supervisor.ts:144`. The chip
flatten step (`useChat.ts` submit path) emits canon's wire shape: **text block first, image blocks
appended** (canon L371395-371427). String callers stay source-compatible (plain prompts still pass
as strings).

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
5. **Live cell (subscription):** an interactive-path submit with a generated red PNG returns an
   assistant turn naming the colour (probe 113's assertion, driven through ccx's own submit chain).
6. Daemon/appserver string submits behave exactly as before (existing suites unchanged).

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
- **The model-gate resolution (the one real design decision, settled):** an explicit `--model` always
  wins. The defaulted case checks `resolveAutoModel`: if the launch model supports `auto`, launch
  `auto`; if not (e.g. `--model claude-haiku-4-5`), launch `default` — no silent model swap, and the
  banner never lies (canon's launch path silently degrades the mode; ccx keeps banner truth instead).
  An **explicit** `--permission-mode auto` keeps today's behaviour (`resolveOptions.ts:88` forces an
  auto-capable model — the user asked for auto by name).
- Banner/hookOpts truth is free (one `foregroundConfig` object, the qa3-02 fix — keep it).
- Headless `-p`, `--bg`, daemon, library: already `auto`; untouched. `ccx attach` still inherits the
  host's mode.

### A2 — the notice + the record

- `autoModeNotice.ts` adopts canon 2.1.236's plan-gated copy (L676952-676958): pro/max/team → the
  variant **without** "Sessions are slightly more expensive."; unknown/API plans keep the cost
  sentence. Plan source is ccx's account info where available at render time; unknown → cost-sentence
  variant (canon's else arm).
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
4. The auto-mode notice fires on a fresh install's first auto launch; on a subscription account the
   copy omits the cost sentence.
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
- **T-IMAGE merges before T-RESUME** — the image-projection fix is T-IMAGE's; T-RESUME's image-only
  acceptance cell reads it from the merged tree.

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

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-22): initial spec from the five R-reports + owner grill (four forks settled) + design
  approval.
