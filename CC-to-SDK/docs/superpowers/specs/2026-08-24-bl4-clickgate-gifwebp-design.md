# bl4 round — the hover `clickable` gate + clickable result rows, and GIF/WebP dimension readers

**v1 — 2026-08-24.** Owner scope: the two F10 owner-deferred follow-ups, verbatim from
`2026-08-23-f10-wave-design.md:795-798` — "the transcript hover `clickable` gate together with canon's
clickable error/truncated result kinds (one paired ticket); GIF/WebP dimension readers for the staged
allowlist (spec-drift note 8 in the T-IMGREACH plan)." Nothing else; the ten F10 Minor roll-up items stay
parked as recorded.

**Canon for this round:** the installed 2.1.237 bundle (`~/.local/share/claude/versions/2.1.237`, built
2026-08-19; the CLI launcher reports 2.1.241 but .237 is the newest bundle read — the clickable subsystem is
assumed stable across .237–.241, recorded as an assumption). The leaked `Claude Code Src/` tree is an OLDER
snapshot for this subsystem: it lacks the error-row clickable branch, `hoverIgnoresBlankCells`,
`hyperlinkUrl`/`allowDefault`, and the `goal_status`/advisor branches. **Where the two disagree, the .237
bundle governs.** Research recovered this round (2026-08-24 exploration agents) plus the standing docs
`research/2026-07-31-tui-clone/08-render-contract-2.1.220.md:784-812` and
`grounding/2026-08-18-tool-stream-ground.md:331-400`.

---

## Ticket 1 — T-CLICKGATE: per-message clickable gate, clickable error/truncated results

### Canon facts (2.1.237, all verified in the bundle this round)

- **One gate, one mechanism.** `isItemClickable` is a per-MESSAGE predicate; clicking any clickable
  message does exactly one thing: **toggle that message's in-place expansion**, held in a `Set` keyed
  `tool_use_id ?? uuid` (ccx's `ownerKey` is precisely this key). Expansion renders that one message as if
  `--verbose`: full error text, full tool output. No detail view, no copy, no navigation.
- **The clickable set** (fullscreen/virtual list only; the classic path passes no `onItemClick`):
  1. `collapsed_read_search` groups — unconditionally (ccx analog: fold clusters, ALREADY clickable via
     `foldAnchor`; stays a separate mechanism per `2026-08-18-tool-stream-design.md:459`).
  2. `goal_status` attachments with a `reason` — **no ccx producer exists; out of scope, recorded delta.**
  3. Advisor results — **no ccx producer exists; out of scope, recorded delta.**
  4. **Error `tool_result`** — clickable iff content is >10 lines (`syh`: string → ≥10 newlines; array →
     one per block plus newlines in text blocks). ccx computes this exact predicate today as
     `overflow > 0` in `errorBody` (`toolRenderer.tsx:223-229`, `ERROR_PHYSICAL_ROWS = 10`) and discards it.
  5. **Non-error truncated `tool_result`** — clickable iff the tool's `isResultTruncated` says so. ccx
     computes this as `hidden > 0` in `foldToolOutput` (`outputFold.ts`) and discards it.
- **Hover is gated on clickable.** `hovered = clickable && hoveredKey === key`; enter/leave handlers are
  `undefined` when not clickable. The affordance is **un-dim only** (dim text renders at its real color);
  no underline, no hover background. This closes the recorded F10 delta at `docs/parity/tui-ux.md:1985`
  ("ccx hovers everything, deferred by owner fork to the ticket that makes canon's clickable kinds
  actually clickable").
- **Expanded marker.** An expanded row gets `backgroundColor: userMessageBackgroundHover` +
  `paddingBottom: 1`, and its hover context is forced false (`hovered && !expanded`). The token's name
  notwithstanding, this background is the EXPANDED marker, not a hover effect (confirms the F10 defect
  note at `2026-08-23-f10-wave-design.md:224-226`).
- **Blank cells and links.** Clicks on blank cells are dropped (ccx already bounds both `anchorAt` and
  `hoverAt` by `col <= at.width`). Hover ignores blank cells only while UNexpanded
  (`hoverIgnoresBlankCells: !expanded`) — an expanded row lights up from its blank tail too. A click on a
  hyperlink cell does NOT toggle (canon `allowDefault()`s and the app opens the URL; ccx defers
  URL-opening — see D5).
- **The hint tail disappears in fullscreen.** Inside the virtual list canon's `CtrlOToExpand` renders
  null, so every `… +N lines` marker is a bare dim line; the affordance story is dim marker → hover
  un-dims → click expands. ccx currently threads `expandHint` into fullscreen markers; align (own task,
  verify-first, expected to move existing frame pins).

### Design (the seam is `ownerKey`'s, six edits)

1. **Predicates surfaced where computed** — `resultBody`/`errorBody`/`foldToolOutput` return their
   already-known `truncated`/`overflow > 0` bit alongside the body (never re-derived by regexing the
   marker text out of `body`).
2. **`RenderItem.clickable?: boolean`** minted at the result gutter-block
   (`toolRenderer.tsx:479`-region) when error-and->10-lines OR non-error-and-truncated. Fold-group rows
   (`grouped_tool_use` analog) never get it.
3. **Projected into `HitRow`** as required-with-default (`clickable: item.clickable === true`), same
   two-line pattern `ownerKey` took through `hitRowsOf`.
4. **Owner-level resolution:** the hover/click unit is the message (`ownerKey`), but `clickable` is
   minted on one row — an owner is clickable iff ANY of its rows is. Resolve once at projection (an
   `ownerKey → clickable` map beside the hit ref), not per-row in `hoverAt`, or the header line of a
   clickable result won't brighten while its body does.
5. **Hover gate:** `hoverAt` sets `hoveredKey` only for clickable owners. **Click:** widen `anchorAt` (or
   a sibling `clickTargetAt`) to a union `{kind:"fold"|"item", key}` so the existing tap machine
   (press/release anchor-match, multi-click windowing, `discardTap`) works unchanged; release dispatches
   `toggleFold(anchor)` or the new per-owner toggle. Click on a non-clickable transcript row falls
   through to click-to-caret exactly as today.
6. **Expansion state:** per-`ownerKey` set beside `expandedFoldsRef` (namespaces are disjoint; a widened
   single set is acceptable), fed through `ProjectionOptions` so the owning item renders `detail-all`;
   cleared at the same two reset sites (`useChat.ts:1130,1279`-region). Expanded row paints the
   background + padding marker and suppresses hover.

Line numbers above are anchors from this round's research; one research pass ran against a mid-rebase
tree, so **implementers verify every anchor against current `main` before editing.**

### Acceptance (behavior, each cell run as written)

- C1 — error result with >10 lines: hovering any of its rows un-dims the whole message; click expands the
  full error text in place with the background+padding marker; second click collapses. (mounted + pty)
- C2 — error result with ≤10 lines: not clickable — no hover brighten, click falls through to caret.
- C3 — truncated ordinary result (`hidden > 0`): hover brightens; click expands full output; the
  compact-marker line is gone while expanded.
- C4 — prose rows (assistant text, user prompts, thinking): never brighten, never toggle; click-to-caret
  and selection gestures are undisturbed (existing suites stay green unmodified except pins the hint-drop
  task moves).
- C5 — fold clusters keep their existing click-to-toggle; a fold-group row never carries `clickable`.
- C6 — expanded row: hover context false; background `userMessageBackgroundHover` + one padding row;
  collapse restores byte-identical compact frame.
- C7 — fullscreen markers are bare `… +N lines` (no hint tail); classic/pager surfaces keep their
  existing hints (`foldHint` is untouched outside the fullscreen transcript path).
- C8 — classic renderer: no hover, no click (hitmap-death pins stay green).
- C9 — pty cell in the real binary: drive a >10-line error result, click it, capture the expanded frame;
  run from `harness/scripts/` per the select-pty.sh recipe, cells committed to the round ledger.

## Ticket 2 — T-GIFWEBP: GIF/WebP dimension readers + staged allowlist

### Ground (all verified against `main` this round)

- `src/media/imageDims.ts` — PNG + JPEG readers, `(buf) => {width,height} | null`, **zero imports**
  (test-enforced). `src/appserver/imageStage.ts:24` `IMAGE_MEDIA_TYPES = ["image/png","image/jpeg"]`,
  refused at first chunk; docstring currently argues FOR the narrowing — rewrite it.
- The single dims choke point is `checkImageBlock` (`src/session/turnInput.ts:92-115`); **a duplicate of
  the reader chain lives in `src/client/chatAdapter.ts:157`** — both must widen or remote clients keep
  degrading GIF/WebP client-side.
- The codec (`imageCodec.ts`) is clipboard-only; staging passes bytes through verbatim. The Claude API
  accepts `image/gif` and `image/webp` natively.

### Design

1. `gifDimensions` — `GIF87a`/`GIF89a`, logical-screen `readUInt16LE(6)/(8)`, ≥10 bytes. `webpDimensions`
   — `RIFF`+`WEBP`, then **all three** chunk variants: `VP8 ` (lossy, 14-bit w/h after the `0x9d012a`
   sync), `VP8L` (lossless, 14-bit packed), `VP8X` (extended, 24-bit minus-one LE). Same
   signature/null-failure/zero-import contract; a VP8X-only reader misses most real WebPs and is a defect.
2. Widen the chain in BOTH `checkImageBlock` and `chatAdapter.ts:157`; widen `IMAGE_MEDIA_TYPES` to the
   four types; host descriptor docs updated together (T-IMGREACH spec-drift note 8's own instruction).
3. Codec untouched. Consequence stated, not hidden: an oversized GIF/WebP now degrades with the PRECISE
   reason (dimension/byte-budget) instead of "unreadable", and cannot be rescued by downscale — that
   rescue would be a GIF/WebP decoder, a different ticket.
4. Fixtures via `test/fixtures/images/make.mjs` with the same generate-time self-assert as `tiny.jpg`;
   regenerate + commit. Refusal cells move to a still-excluded type (`image/tiff`).
5. Gated live cells in `test/live/image-submit.e2e.test.ts` (or `image-reach`): one tiny GIF, one tiny
   WebP turn, model describes the color; skips cleanly keyless.

### Acceptance

- G1 — unit cells per reader per variant (GIF87a, GIF89a, VP8, VP8L, VP8X) + null on garbage/truncation;
  zero-import guard green.
- G2 — app-server `image/stage` accepts `image/gif`/`image/webp` end-to-end into `turn/startContent`;
  `image-stage.test.ts:121-126` and `turn-content.test.ts:205-226` inverted; `image/tiff` still refused
  at first chunk.
- G3 — direct `Session.submit` and daemon `submit_content` with a real GIF/WebP fixture survive
  normalization (no `[Image could not be processed…]`).
- G4 — oversized GIF (logical screen >2000) degrades with the dimension reason, not "unreadable".
- G5 — `chatAdapter` no longer degrades GIF/WebP client-side.
- G6 — keyed live turn per format returns a plausible description; keyless run skips.

## Execution

The F10 pipeline at round scale: two worktree tickets (T-GIFWEBP first — it's independent and small;
T-CLICKGATE lands second), fresh sonnet implementers per task, `review-package BASE HEAD` + sonnet
reviewer with ≥2 reviewer-run mutation checks per task, fix waves re-reviewed by the original reviewer,
sequential `--no-ff` merges gated on unit+tui+typecheck plus the pty/live cells above, then ONE
whole-round Codex review (`gpt-5.6-sol`) → fix wave → scoped re-review until a round returns zero.
Ledger: `.doperpowers/sdd/2026-08-24-bl4-round/round.md`. Close-out: parity re-score (`tui-ux.md:620`
and `:1985` flip; coverage.md entry), memory, report. Never push.

## Decision Log

- **D1 — clickable kinds: error(>10 lines) + truncated results only.** `goal_status`/advisor have no ccx
  producers (SDK harness) — recorded delta, not built. Rejected: speculative rows for species ccx never
  renders.
- **D2 — hover gating flips to clickable-only**, closing the F10 recorded delta. Rejected: keeping
  hover-on-everything (the F10 fork explicitly scheduled this flip with this ticket).
- **D3 — click = per-`ownerKey` verbose toggle** (canon's only click semantics); expanded marker =
  background + paddingBottom 1; hover suppressed while expanded.
- **D4 — owner clickable iff any row clickable**, resolved at projection time. Rejected: per-row gating in
  `hoverAt` (header/body would disagree, which canon never shows).
- **D5 — link-cell clicks are a no-op** (no toggle); URL-opening deferred with `HitRow.linkRanges` as its
  ready substrate. Rejected: shipping URL-open here (independent feature, separate risk).
- **D6 — fullscreen markers drop the hint tail** (canon renders no `(ctrl+o…)` inside the virtual list);
  classic/pager arms keep `foldHint` untouched. Verify-first task; frame pins move with it.
- **D7 — predicates returned from the producers**, never regexed from rendered text.
- **D8 — no sniff-vs-declared media-type cross-check.** The mismatch hole predates this round (PNG
  declared as JPEG is equally unchecked); the API is the boundary that enforces pairing. Recorded, not
  built. Animated GIF passes by logical-screen dims; the byte budget is what binds.
- **D9 — codec untouched** (staging never re-encodes); downscale rescue for GIF/WebP explicitly out.
- **D10 — round runs autonomously** on the owner's standing "Next work would be" directive; push stays
  theirs.

## Surprises & Discoveries

- Canon ≥2.1.237 made ERROR results clickable (>10-line predicate `syh`) — the leaked tree explicitly
  returns false on `is_error`; a transcription from the old tree would have shipped the opposite of canon.
- Canon's clickable set is five kinds, not the two the F10 deferral named; two have no ccx analog.
- Canon narrowed the hover context from a theme-key (`TextHoverColorContext`) to a boolean dim-suppressor.
- The repo was found mid-`git pull --rebase` (flattening the F10 `--no-ff` merges, conflicted 15 picks
  in, detached HEAD) with `origin/main` a strict ancestor — aborted; `main` restored intact at
  `5562e74f80`.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-24): authored from the three research passes; owner scope from the F10 close-out.
