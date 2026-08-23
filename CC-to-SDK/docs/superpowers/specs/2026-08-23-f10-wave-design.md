# F10 Wave — Selection Maturity, Hover Truth, Image Reach, Maintenance

**Status:** v2 — owner approved the design 2026-08-23 (composition + two forks; Decision Log);
v2 folds in the Codex adversarial review's 17 findings (all verified against the tree — see
Revision Notes). Canon = installed Claude Code **2.1.236**
(`/Users/new/claude-code-bundle/2.1.236/cli.pretty.js`; all `L…` refs are that file). SDK =
installed `@anthropic-ai/claude-agent-sdk` **0.3.237**.

## Purpose

F9 shipped five tracks and recorded its residues honestly. F10 pays those residues down — but the
research pass (r1–r4, `.doperpowers/sdd/2026-08-23-f10-wave/research/`) overturned three of the
record's premises, and the design review then overturned one of the research pass's own:

- Canon's click-to-caret works during busy turns (no occupant arithmetic exists in canon at all);
  ccx's refusal during every busy turn is a pure loss. **Fix: bottom-up origin arithmetic.**
- Canon's transcript hover unit is one whole SDK message — *coarser* than ccx's logical-line unit,
  and "needs a layout tree" was about non-transcript sites. CM33 is the *suggestion popup*.
  **Fix: `ownerKey` grouping (S) + a popup hit region (M). No tree.**
- Canon resizes clipboard images platform-independently (it has no `sips`); ccx's Linux path
  refuses BMP and anything oversized. **Fix: a pure-JS `node:zlib` ladder, measured viable (r3 §2),
  with normative hostile-input bounds (review F9c).**
- **Live defect (probe 100, SDK 0.3.237), rescoped by review:** a turn whose first prompt carries
  no non-empty text strands the session — absent from `listSessions()` *and* `getSessionInfo()`,
  transcript intact. Probe 100's `[{text:""},{image}]` cell is **not** the REPL's wire shape (the
  composer keeps `[Image #N]` literal in `submitText` — `editor.ts:72-73`,
  `pasteChips.ts:199-209` — so REPL first prompts are non-empty). The exposed population is the
  **library/direct-`Session` surface** this wave widens, plus any path where a pasted map entry
  outlives its chip label. **Fix at the authoritative normalizer boundary; re-probe the REPL
  topology live before building (I1).**

Four tracks: **T-SELECT**, **T-HOVER**, **T-IMGREACH**, **T-MAINT**. Every track builds on code
merged in F9.

## Global constraints

- Repo conventions: `harness/CLAUDE.md` governs (dense hand style, ESM `.js` specifiers,
  DI-by-deps, TDD). Gates per track: `npm run typecheck`, `npm run build`, `npm run test:unit`,
  `npm run test:tui`. Never bare `npm test`.
- Canon is read with `grep -n` + `sed -n` ranges, never `grep -o`.
- Live tests gate on `CLAUDE_CODE_OAUTH_TOKEN` from `CC-to-SDK/.env` (`set -a; . ../.env; set +a`);
  never print/echo/commit secrets; API-key line stays commented.
- Payload widenings on any wire are **negotiated steps, never optional fields** (F9 lesson; r3 §1
  re-proved it for the app-server and daemon wires). Where the old peer cannot emit a
  distinguishable error (the daemon), the **client** owns the mapping and the spec says exactly
  which response means "unsupported".
- No new runtime dependencies. The image module is `node:zlib` only, with normative resource
  bounds (I5).
- Every limit this spec introduces states its **unit, accounting point, and boundary tests**
  (cap−1 / cap / cap+1). A cap without an accounting function is not a cap (review F6c).
- Never `git add -A`; stage explicit paths. Track branches in worktrees; merge `--no-ff`.
- Mouse/selection/hover changes: pure-model tests + ink mounts + at least one live pty cell per
  behavior class + sabotage guards where a wrong constant would pass silently.

---

## Track T-SELECT — selection & caret maturity

Research: r1. Six pieces; **ordering: S4 strictly before S6; S5's edge arm rides S4**. S1, S2, S3
are independent.

### S1 — Bottom-up caret origin (replaces `dockCrowded`) — M

Today `dockCrowded` (`ChatApp.tsx:1566`) suppresses the click-to-caret origin during every busy
turn, non-empty task panel, and compaction. Canon has no such gate (L606604, L200134-200163). The
dock is bottom-anchored (`FullscreenFrame.tsx:315-317`), so the composer's position is computable
from below with no occupant term:

```
frameLastRow   = FRAME_TOP_ROW + frameHeight(rows) - 1     // new DockBottomContext
composerBottom = frameLastRow - footerRows(footerStatusInput())
bufferBottom   = composerBottom - (inlineSearchOpen ? 1 : 0) - 1   // composer-local bottom rule
bufferTop      = bufferBottom - (bufferPhysicalRows - 1)
```

- **`bufferPhysicalRows` means PHYSICAL wrapped rows**, computed through the same projection
  `caretFromLocalPosition` already uses (`wrapRows` per logical line) — never the logical line
  count (review F12: a long wrapped draft would otherwise shift every click one row per wrap).
- Add `DockBottomContext` to `FullscreenFrame` (same "computed constant, 0 = not addressable"
  contract as `DockTopContext`).
- Replace the `dockCrowded: boolean` prop with `footerRows: number`; keep `dockTop` as a sanity
  floor and the composer-local `waitingForPermission` term.
- **Overflow refusal must be reactive**: `FullscreenFrame`'s `bottomGot > cap` effect does not
  re-run on composer-local growth (its own comment says so) — the origin publisher must refuse
  based on a signal that updates when the composer's own height changes (e.g. the composer
  publishes not-addressable whenever `bufferTop < dockTop`, which composer-local growth trips
  without any frame effect). Add a post-mount-growth cell.
- Delete `dockCrowded` and its threading; do NOT extend `dockDialogRows` (already wrong by one for
  every compaction — r1).

Tests: pure arithmetic table (pane heights × footer configs); ink mounts per occupant combination
(spinner / compaction±bar / task panel 1·3·6 / palette 1·5) asserting the published origin equals
the row where the frame's output contains the buffer's first line; **a long draft that wraps ≥ 2
physical rows**; **composer growth after mount → origin refuses or corrects, never mis-points**;
the F9 live pty caret cell re-run during a busy turn and with the task panel open; sabotage:
mutate `footerRows` +1 → pty cell fails.

### S2 — Word/line drag extension (`w0p`) — S — fixes a shipped bug

After a double/triple click, dragging does nothing: `selectedSpans` gives `anchorSpan` absolute
priority (`selection.ts:194-198`). Port canon's `w0p` (L198781-198798): recompute the word/line
span under the pointer, pivot on the original span (before → `anchor = span.hi, focus = newLo`;
after → `anchor = span.lo, focus = newHi`; inside → collapse). `dragToSpanned(state, cell, rows)`
in `selection.ts`, called from `dragSelectionTo` when `anchorSpan !== null`, writing real
`anchor`/`focus`. Tests: word-drag both directions, pivot flip, triple-drag rows, sabotage the
pivot comparison.

### S3 — Named `selection:copy` / `selection:clear` actions — S

Add both to the action union; bind `ctrl+shift+c` and (if the raw-stdin parser produces a `super`
modifier — verify; else record) `cmd+c` → `selection:copy` in `Scroll`; `selection:clear` stays
**named but unbound** (canon L174997). Keep the pre-table ctrl+c hook (canon keeps both,
L551764-551772). Tests: resolution in `Scroll` only; `keybindings.json` round-trip; banned-chord
sweep; `?` grid snapshot.

### S4 — Selection remap-on-shift — M — REDESIGNED at review (F1)

v1's `{itemKey, innerRow, col}` recorded screen geometry: `innerRow` was an offset into the
*painted run*, which breaks when an item is partially sliced at the window edge, and a re-wrap
moves characters across rows so `min(innerRow, runLength-1)` + col-resnap can land on text the
user never selected. The durable address is **character identity**:

```ts
interface SelectionAddr { itemKey: string; charOffset: number }   // grapheme-boundary character
                                                                  // offset within the ITEM's text
```

- `HitRow` gains `itemRow: number` — this painted row's absolute row index **within its item's
  full wrapped projection** (not within the painted run). `hitRowsOf` computes it from the slice
  metadata it already receives (the slice knows how many of its item's rows were clipped above the
  window; carry that through). This is what makes `charOffset` computable from a gesture on a
  partially-visible gutter block and re-derivable after any scroll.
- **Write** (gesture time): `charOffset = charsInItemRowsBefore(itemRow) + columnToChar(row, col)`,
  snapped to a grapheme boundary; recorded for `anchor`, `focus`, and both ends of `anchorSpan`.
- **Read** (each publish, during render, before `selectedSpans` — an effect would paint one wrong
  frame): walk the item's current rows (fresh `itemRow` + per-row char counts) to convert
  `charOffset` back to `(paintedRow, col)`. Endpoint semantics are explicit: an address is
  **inclusive on anchor, exclusive on focus's trailing edge**, and the conversion clamps to the
  item's current char count when the item shrank.
- Endpoint's item scrolled out of window → keep the address, clamp painted position to the window
  edge, mark virtual (canon's `virtualAnchorRow/Col`); restores on scroll back. Both ends off the
  same edge → retain, paint nothing, copy nothing (canon's `ELt`). `itemKey` absent from the new
  rows entirely → clear (the one case that warrants it).
- Re-wrap at a new width is now a non-event: `charOffset` is width-independent by construction.

Canon translates by scroll delta and never clears (`C0p`/`k0p`, L198804-198853) but mispoints when
content changes without a scroll delta; character-identity remap is deliberately better (recorded
delta). Tests: before/after HitRow pairs for insert-above / **re-wrap-narrower** / fold-toggle /
**partially-sliced gutter block scrolled out and back** — endpoints land on the same *text* in all
four; streamed-delta-during-sweep viewport test; explicit inclusive/exclusive boundary cells;
`itemKey` stability across streaming deltas pinned; re-point existing clear-on-shift tests at the
still-clearing cases; sabotage: no-op the remap.

### S5 — Six `selection:extend*` chords — M

Canon's `Scroll` set (L174817): `shift+left/right/up/down/home/end` →
`extendLeft/Right/Up/Down/LineStart/LineEnd`. **Canon has no shift+click extend** (press branch
L199709-199718). Port `moveSelectionFocus` + `E0p` (L203359-203396): left/right wrap across row
bounds; extend **clears `anchorSpan`** (deliberate — transcribe). ccx per-row `x1/x2` =
`gutterWidth+1`/`width` (recorded divergence). Handlers return false with no selection →
fall-through to the composer. Extend-past-edge scroll-by-1 arm ships only after S4+S6; else
deferred with a note. Tests: keymap + behavior + fall-through.

### S6 — Auto-scroll drag + off-window capture — M — strictly after S4

Driver: on `dragSelectionTo`, `dir = cellRow < 1 ? -1 : cellRow > rows.length ? +1 : 0` with the
anchor inside the window; timer at **2 rows / 50 ms / 200 ticks** (canon L551562); each tick fires
the pager scroll action then re-applies `dragTo` at the clamped edge. Cleared on drag end,
`discardSelection`, unmount, scroll bounds. Capture: extraction walks the in-memory document
between the two durable addresses (S4's `charOffset` makes this exact). **Document-walk extractor
must agree byte-for-byte with `extractText` for a fully visible selection** — assert equality.
Tests: fake-timer drag-to-edge; bounds stop; release-mid-scroll; extractor equality; live pty
sweep past the bottom edge → clipboard holds off-screen content.

---

## Track T-HOVER — hover truth

Research: r2. No layout tree.

### H1 — W-UNIT: message-level hover grouping + hoverBand removal — S

Canon's hover unit is one SDK message (`K6w` L562778-562784; one `hoveredKey`, L563004); the only
visual channel is the dim-drop context (`Ssi`, sole consumer L203977-203979). ccx groups per
logical line (producers mint a line ordinal — `toolRenderer.tsx:697,731`).

- Add optional `ownerKey` to `RenderItem`; producers set it beside `id`; hover compares
  `ownerKey ?? sourceId(id)`.
- **The optionality is a type-level accommodation, not a rollout license** (review F13): a
  **producer matrix test is mandatory** — multiline SDK messages, local events, gutter blocks,
  wrapped rows, streaming updates, and every `reid` part each assert message-level grouping, and
  adjacent messages assert distinctness. A producer missing `ownerKey` fails the matrix, not just
  typechecks.
- **Remove `hoverBand` from `Line.tsx:27-30`** (defect: cites L562779 = canon's *expanded* marker;
  canon's transcript hover never touches a background; the swap is real only on chrome —
  `Psc` L562667-562684, `O6w` L562653-562661, ccx's `JumpPill.tsx:96`). Dim-drop half stays.
- **Owner fork (settled): clickable gate DEFERRED** — hover stays on everything as a recorded
  delta; gate ships later paired with clickable error/truncated rows, one ticket.
- Measure the per-row `\x1b[2m` regex strip across a tall hovered block; memoize if it shows.

Tests: the producer matrix (above); band-swap negation on transcript rows, positive on JumpPill;
parity notes updated (`tui-ux.md:1985`).

### H2 — W-POPUP: CM33, suggestion-popup hover + click — M

`SuggestPopup` publishes a hit region `{ top, rows: [{ id, colStart, colEnd, lines }] }` through a
ref (same shape as `ViewportHitmap`); `ChatApp`'s mouse sink routes motion/press to it when the
popup owns the band. Geometry is pure already (`lineCount` = canon `OSw`; `scrollWindow` = canon
`DXe`). **Origin: the hoisted palette is the dock's FIRST child, so its first row IS `dockTop`**
(review F14 corrected v1's `dockTop - paintedRows`, which would have hit transcript rows);
suggestion ranges derive **forward** from `dockTop`, and the region is pinned against actual
`FullscreenFrame` output for 1- and 2-line suggestions. Degrades to not-addressable under exactly
the conditions `originExact` does.

Canon semantics (`Bvt` L536289-536314, `UIh` L536379, L602029-602033): hover renders the row as
selected (hover **overrides** keyboard highlight, `A ?? k`); arrows **clear** hover; hover never
moves the keyboard cursor (Enter accepts the keyboard pick); click passes the **absolute index**
(`windowStart + P`); container-leave clears; both dead when non-interactive; setter bails when
unchanged.

Tests: pure region-model (1-/2-line rows, scroll offsets); ink mount (override + arrow-clear +
enter-keyboard-pick); click by absolute index; frame-output pinning of the region; not-addressable
cells; live pty hover sweep.

---

## Track T-IMGREACH — image reach

Research: r3 + probe 100. Review restructured this track substantially (F2–F8); the negotiation
template stays the host's (`"unknown op"` / `"invalid op payload"` split), and every new limit
names its accounting.

### I1 — Stranded-session guarantee at the normalizer boundary — S

**Enforcement point: `normalizeTurnInput` / the Session message builder** — the one seam every
surface passes through — NOT `assembleUserContent` (review F2: the REPL's `submitText` already
carries `[Image #N]` literal, so `assembleUserContent` callers are not the exposed set; direct
`Session.submit(array)` / widened `harness.run(array)` bypass it entirely). Rule: an image-bearing
array whose text blocks are all empty gets one bounded synthetic label (the `[Image #N]` chip
form) substituted into its first text block.

**Pre-task probe (first task of the track):** extend probe 100 with a cell that submits through
the real REPL topology (the composer's actual submit path) and one through `Session.submit`
directly, asserting `listSessions()`/`getSessionInfo()` presence for each — settling what today's
REPL really persists rather than inferring it. Acceptance asserts presence for REPL, `Session`,
and `Harness.run` entry points. **Owner fork (settled): fix forward only — no recovery scan.**

### I2 — Library surface accepts `UserTurnInput`, with shared bounds — M

`Harness.run`/`stream` (`harness.ts:18-19,84,89`), `runStructured` (`structured/run.ts:22`),
`Session.stream` (`session/session.ts:188`). Not a type unpin: SDK `query()` takes
`string | AsyncIterable<SDKUserMessage>` (`sdk.d.ts:2692-2695`); the array case builds one
`SDKUserMessage` via `Session`'s `userTurn` so normalization applies.

**Normalizer hardening (review F3) — lands before any surface widens:**

- `MAX_IMAGES_PER_PROMPT = 20` moves to the neutral media module (T-MAINT item 3's home) and is
  enforced **inside `normalizeTurnInput`** — shared by every surface, not just host staging.
- New block-count cap (`MAX_CONTENT_BLOCKS = 64`) and a failure-fragment rule: past the caps, the
  excess tail collapses into **one** bounded sentinel text block (`[+N more blocks dropped: …]`),
  never N fragments; failure text produced by degraded images counts toward a total-text ceiling.
- Accounting stated: image caps in decoded bytes (existing), text ceiling in UTF-16 code units,
  block/image caps in block count, all checked **before** decode where the check doesn't need the
  bytes. Boundary tests cap−1/cap/cap+1 on every cap, on every widened surface.

Tests: unit (array → normalized blocks, all caps), gated live cell (`harness.run` image → model
names the color), and the I1 presence cell for this entry point.

### I3 — App-server: negotiated staged upload + `turn/startContent` — L (was M)

**The transport fact that reshaped this (review F4, verified):** inbound frames are capped at
**256 KiB** (`appserver/peer.ts:8 MAX_IN`, mirrored into WebSocket `maxPayload`) — a legal
512,000-byte image (~683 KB base64) can never ride one JSON-RPC frame. So the design is staged,
like the host's:

- **`image/stage`** (new method): carries base64 **chunks ≤ 128 KiB** with
  `{stageId, seq, last, bytesTotal}`; the server assembles under normative limits (per-image
  encoded cap = the normalizer's 5 MiB input ceiling; per-connection concurrent-stage cap 4;
  stage TTL till turn end or disconnect, then deleted; refusal **before** any allocation when
  `bytesTotal` exceeds the cap). Old servers answer **METHOD_NOT_FOUND** — the loud-skew signal;
  the client surfaces the same version-skew notice shape the REPL uses.
- **`turn/startContent`** (new method): text + `stagedImageIds`, claims staged images into the
  normalizer path. **`turn/steerContent`** ships beside it (review F15 — v1 widened `steer` in
  place, repeating the exact unnegotiated pattern it rejected for `start`); `Session.steer`
  (`session/session.ts:174`) unpins with it.
- **Queue cap contract (review F6):** accounting = `Buffer.byteLength(JSON.stringify(input))` of
  the normalized turn input, computed at enqueue; per-entry cap 1 MiB (one max image + text
  fits; two max images do not — deliberate, images should not queue-stack); total retained cap
  4 MiB; refusal happens **before** any turn ID is minted. Boundary tests per the global rule.
- **Flattener scope (review F7, verified):** only the two **user-prompt** display paths collapse
  onto `flattenForDisplay` (`items/replay.ts:14-18` and live user-item rendering).
  `items/mapper.ts`'s `firstResultLine` is a **tool-result summarizer** and stays separately
  typed and capped, with a mixed-block tool-result regression test.
- **Engine contract (review F5):** `EngineSession.submit(prompt: string)` stays **unchanged**
  (public embedder contract). A new **optional** `submitContent?(input: UserTurnInput)` is the
  capability: absent → the server answers `turn/startContent` with an explicit
  "engine does not support content submission" error (no silent flatten, no legacy fallback
  turn). The in-process engine implements it. **Fleet does NOT implement it in F10** — a fleet
  `turn/startContent` errors unsupported loudly; the fleet staging-client (mint/write/claim +
  ownership cleanup against the host) is a recorded follow-up ticket.
- `initialize` capability list stays out of scope (own ticket).

Tests: chunk assembly (order, dup, missing-last, over-`bytesTotal` refusal-before-alloc,
disconnect GC); schema accept/reject; **old-server skew cell** (method absent → loud error, zero
turns run); queue-cap boundary cells; flattener replay=live for an image turn + mixed-block
tool-result regression; engine-without-capability cell; fleet-unsupported cell.

### I4 — Daemon: `submit_content` op + honest old-peer semantics — M

- Split the daemon's collapsed error into `"unknown op"` vs `"invalid op payload"`
  (`daemon/server.ts:66-67`), copying the host template — **for future peers**.
- **The old-daemon path cannot be made to say "unknown op" (review F8):** a pre-F10 daemon answers
  `bad request: …` for the new literal. The **client** owns the mapping: when `submit_content`
  (a payload the client knows is schema-valid) returns any `bad request`-class error, the client
  raises the explicit "daemon does not support image submission (pre-F10 daemon)" notice. Test
  against the **current pre-F10 server implementation over a real socket** (checkout-pinned or
  vendored fixture server), not a simulation.
- **Inbound frame cap:** the daemon buffers until newline with no limit today — add a byte-exact
  cap (1 MiB) on the line buffer; over-cap or no-newline input drops the connection with a logged
  reason. Cap-plus-one and no-newline tests.
- New op literal on the union (`daemon/types.ts:97`); supervisor hands the array to
  `Session.submit` (already widened); `connect.ts`/CLI passthrough follow.

### I5 — Pure-JS image ladder with normative resource bounds — M

One new leaf module in `src/media/` (`node:zlib` only): PNG decode (inflate + unfilter), BMP
decode (**`BI_BITFIELDS` masks + `BITMAPV5HEADER` + negative-height top-down rows** — r3 verified
real clipboard BMPs are exactly that), box downscale, PNG encode **with adaptive per-scanline
filtering** (the 193× fact). **Hostile-input bounds are normative (review F9c):**

- Reject before allocation: source bytes > 10 MiB; declared pixels > 25,000,000
  (`width*height` checked with overflow-safe arithmetic); BMP offsets/strides/mask ranges
  validated against the actual buffer length before any read.
- Inflate is capped at the **exact expected scanline total** (`(1 + width*bpp) * height`); one
  byte over → fail with reason (zip-bomb arm). PNG chunk walk validates lengths/CRC bounds
  before use.
- Explicit fallback arm for palette/16-bit/interlaced PNGs: pass through if under budget, else
  fail with a real reason.
- Processing budget: a single wall-clock guard (2 s) around the whole pipeline, failure not hang.

Wire into `pasteClipboardImage`'s non-darwin arms (Linux dead ends `clipboardImage.ts:222-223,357`
and Windows' `:357`). Darwin keeps `sips` (unchanged); unification + the opportunistic
`magick`/`ffmpeg` rung are recorded follow-ups.

Tests (review F10 split): (a) **dimension-asserting downscale** — an oversized-dimension fixture
comes back with asserted smaller width/height, not merely fewer bytes (the 2.5 MB gradient
recompresses without downscaling — it cannot be the only fixture); (b) byte-only recompression;
(c) golden decode/encode round-trips incl. a real BI_BITFIELDS BMP; (d) hostile fixtures: bomb
IDAT, huge-header, truncated/overlong IDAT, forged BMP offsets/strides; (e) **integration**:
Linux/Windows clipboard branches driven by fake clipboard commands (private-PATH scripts writing
real PNG/BMP bytes) proving production dispatch actually invokes the module.

### I6 — Ambient clipboard hint — S–M

Canon pin (r3 §3): copy `` Image in clipboard · {binding} to paste `` from the live
`chat:imagePaste` binding; transient notification on the existing `priority:"immediate"` channel
(the eighth poster); triggers: terminal focus-in edge (enable `ESC[?1004h` in `altScreen.ts`;
parser already recognizes `I`/`O` at `parse.ts:132`; add the event route) **and** canon's
first-keypress-while-unknown secondary trigger; 1000 ms debounce, 30 000 ms throttle, gated on
image paste availability. Check is **exit-code only** and **platform-dispatched** via the existing
command builders (deliberate delta — canon's check is hardcoded osascript, de-facto macOS-only,
and slurps the image bytes).

**Privacy invariant is tested, not asserted (review F16):** the check runs through an injected
check-only process seam whose tests assert stdout is ignored/discarded and a literal small
`maxBuffer` (64 KiB) is set — reusing the default 16 MiB-buffer executor must fail a test. The pty
cell runs with private-PATH fake clipboard commands and raw focus-in bytes, not the developer's
real clipboard.

Tests: trigger/debounce/throttle fake-timer cells; focus-event route unit; dispatch table; copy
pins with binding override; the stdio-seam cells; hermetic pty cell.

---

## Track T-MAINT — maintenance bundle

Research: r4. Seven code items + one evidence-only record.

1. **accountInfo cold-start race — M.** Thread the live, unraced `host.accountInfo()` promise to
   `useChat` (bridge shape like `noticeBridge`); the notice's 800 ms timer awaits it under a
   **normative second deadline: 3000 ms from mount** (review F17). Fake-timer cells: resolves at
   2999 ms → OAuth variant; at 3001 ms → unknown-variant fallback; never-resolves → fallback at
   deadline; rejects → fallback immediately; unmount cancels. Banner's 1500 ms race untouched
   (`ACCOUNT_LABEL_BUDGET_MS` pin stays).
2. **Prefs single-read — XS.** Hoist one `loadPrefs()`; spy asserts call count === 1 per launch.
3. **Layering cut — S.** `pngDimensions`/`jpegDimensions` + `MAX_DIMENSION`/
   `POST_PROCESS_BYTE_BUDGET` (+ `MAX_IMAGES_PER_PROMPT`, per I2) move to `src/media/imageDims.ts`;
   `clipboardImage.ts`, `turnInput.ts`, `host/imageStaging.ts` import it. Scoped to flagged sites.
4. **Legacy history.jsonl read pin — XS.** Raw pre-F9-shaped line planted directly; `readHistory`
   + `hydrateEntry` tolerate it.
5. **Two stale comments** in `sessionPickerModel.test.ts:5,25` rewritten (ledger said 3; r4
   verified 2). XS.
6. **hitmap `kind === "line"` assertion — XS.**
7. **`resumeInto` "no history found" guard test — XS** (`useChat.ts:2319`).
8. **Segmenter O(n²): no code change** — benchmark recorded (quadratic real, physically
   unreachable at row widths); `wordSpan` recompute is the watch-item with the WeakMap shape
   pre-agreed.

---

## Acceptance (behavior-phrased; each cell names its evidence)

**Merge gates (review F11 — behavioral evidence is REQUIRED, not advisory):** on the assembled
tree, (a) `npm run typecheck` + `npm run build` clean, `npm run test:unit` + `npm run test:tui`
green; (b) **the keyless tmux pty matrix** (cells 1–7, 12 below) executed and captured, committed
under the wave ledger; (c) **the keyed live cells** (8, 9) run with
`set -a; . ../.env; set +a; npx vitest run test/live/<file>` and their output recorded in the
ledger. A cell that cannot run is a blocker, not a skip.

1. **Busy caret** (pty): mid-busy-turn and with the task panel open, clicking a character in the
   composer moves the caret to it; with a draft wrapped ≥ 2 physical rows, clicks land on the
   correct wrapped row.
2. **Dead-drag fixed** (pty + unit): double-click a word, drag right two words → selection covers
   all three whole words; release toast contains their text.
3. **Selection survives streaming** (viewport test + pty): sweep, streamed delta lands above it →
   painted highlight covers the same characters; re-wrap-narrower and partial-slice unit cells
   land on the same text.
4. **Extend chords** (keymap tests + pty): shift+right grows one column; shift+end to line end;
   `keybindings.json` rebind of `selection:copy` honored; without a selection shift+arrows reach
   the composer.
5. **Auto-scroll capture** (pty): drag to the bottom edge, hold → viewport scrolls; on release the
   clipboard contains text never on screen during the press.
6. **Message hover** (ink producer matrix + pty): hovering any line of a multi-line message
   un-dims every dim line of that message and none of its neighbors — asserted per producer
   species (SDK multiline, local event, gutter block, wrapped, streaming, `reid` part); no
   transcript row changes background on hover.
7. **Popup hover, CM33** (ink + frame-output pin + pty): hover a suggestion row → highlights as
   selected while keyboard selection is elsewhere; arrow → keyboard wins; click → accepted by
   absolute index; the hit region matches actual frame output for 1- and 2-line rows.
8. **No stranded sessions** (keyed live): image-only submits through the real REPL topology, a
   direct `Session.submit(array)`, and `harness.run(array)` each yield a session present in
   `listSessions()` with non-empty `firstPrompt`.
9. **Library images** (keyed live): `harness.run([{type:"image",…}])` → model names the color.
10. **Skew is loud everywhere** (unit + real-socket): old app-server (method absent) → explicit
    error, zero turns; pre-F10 daemon over a real socket → the client's explicit pre-F10 notice,
    zero legacy-fallback text turns; engine without `submitContent` → explicit unsupported; fleet
    → explicit unsupported.
11. **Image ladder** (unit): downscale cell asserts output *dimensions*; hostile fixtures (bomb,
    huge-header, truncated, forged BMP) all fail with reasons within the processing budget;
    fake-clipboard integration proves the Linux/Windows dispatch invokes the module; boundary
    cells on every cap (cap−1/cap/cap+1).
12. **Ambient hint** (fake-timer + hermetic pty): image on (fake) clipboard + focus-in → hint
    within ~1 s, dim, right-aligned, gone in 8 s; second focus-in within 30 s → nothing; stdio
    seam cells prove exit-code-only.
13. **Maintenance**: prefs read once (spy); notice deadline cells (2999/3001/never/reject/
    unmount); legacy history line parses; comment/parity corrections committed.

## Non-goals

Hover clickable gate + clickable result rows (one ticket); stranded-session recovery scan;
app-server `initialize` capability list (own ticket); fleet staging-client (own ticket — F10
errors loudly); opportunistic `magick`/`ffmpeg` rung; darwin `sips` unification; `ccx -p` image
flags; swarm/kairos seed widening; Segmenter memoization (watch-item); §2/§4 backlog.

## Decision Log

- **Full F10, four tracks** — owner over a lighter round (2026-08-23).
- **Hover clickable gate deferred** (owner fork). Rejected: adopt-now with scope growth.
- **Stranded sessions: fix forward only** (owner fork). Rejected: recovery scan.
- **Stranding enforcement at `normalizeTurnInput`, not `assembleUserContent`** (review round):
  probe 100's C cell proved to be the library shape, not the REPL's — the composer keeps
  `[Image #N]` in `submitText`. Rejected: builder-level fix (misses the exact surfaces this wave
  widens).
- **SelectionAddr = `{itemKey, charOffset}` + `HitRow.itemRow`** (review round): v1's
  `{itemKey, innerRow, col}` was screen geometry — broken by partial slices and re-wrap. Rejected:
  painted-run innerRow (v1), verbatim canon `C0p` port (needs a scroll-delta wire ccx lacks),
  keep-clearing.
- **Bottom-up caret arithmetic over occupant-height sum**; `bufferPhysicalRows` defined through
  the caret's own wrap projection; overflow refusal reactive. Rejected: term-by-term sum,
  measureElement-only (kept as fallback), logical-line count (review F12).
- **App-server images are STAGED (`image/stage` chunks ≤128 KiB) + `turn/startContent` +
  `turn/steerContent`** (review round): the 256 KiB frame cap makes single-frame images
  impossible; in-place steer widening repeated the rejected unnegotiated pattern. Rejected:
  raise the frame cap (weakens a DoS bound for every method), single-frame method (physically
  can't carry a legal image), in-place unions.
- **`EngineSession.submit(string)` unchanged; optional `submitContent` capability; fleet
  unsupported-loudly in F10** (review round). Rejected: widening the required method (breaks
  every custom engine), silent flatten fallback.
- **Queue cap: serialized-JSON-bytes accounting, 1 MiB/entry, 4 MiB total, refuse before ID
  mint** (review round). Rejected: unspecified "re-think" (v1).
- **Flattener collapse scoped to user-prompt display** (review round): `firstResultLine` is a
  tool-result summarizer, verified. Rejected: collapse-all-three (v1 — would mislabel tool-result
  blocks and unbound a bounded summary).
- **Old-daemon skew is a CLIENT-side mapping** (review round): the old peer's `bad request` cannot
  be changed retroactively; a schema-valid `submit_content` receiving it means unsupported.
  Plus a 1 MiB inbound line-buffer cap. Rejected: pretending the split alone negotiates (v1).
- **Normalizer gains shared block/image-count caps + one-sentinel excess collapse** (review
  round). Rejected: host-staging-only 20-cap (bypassable by every non-host surface).
- **Image codec hostile-input bounds normative** (review round): pixel/inflate/chunk/stride caps +
  2 s budget; downscale acceptance asserts dimensions. Rejected: benign-input measurements as the
  only evidence (v1).
- **Popup region top = `dockTop`, ranges derived forward** (review round; v1's subtraction was
  wrong — the palette is the dock's first child).
- **Ambient-hint privacy proven via an injected stdio seam**; hermetic pty (review round).
- **accountInfo second deadline = 3000 ms, normative** (review round).
- **Pure-JS `node:zlib` ladder over sharp/ImageMagick floor** (research): measured viable;
  adaptive filtering mandatory (193×).
- **Identity remap over canon's screen-delta translation** (research): survives fold/re-wrap
  canon gets wrong; recorded delta.
- **`ownerKey` field over id-prefix parsing / row spans / layout tree** (research); producer
  matrix mandatory (review).
- **Layering cut scoped to flagged sites; Segmenter no-change** (research).

## Surprises & Discoveries

Seeded from research + design review; implementation appends here.

- Canon does no occupant arithmetic for click-to-caret; F9's comment plan was a wrong turn (r1).
- Canon's transcript hover is message-coarse and clickable-gated; "layout tree" belonged to
  non-transcript sites; CM33 names the popup (r2). ccx's hover band swap cited canon's *expanded*
  marker — a live mis-transcription (r2 §4.3).
- Canon has no `sips`; its resizer is platform-independent; the osascript quartet ccx transcribed
  is canon's tier-2 fallback, not its primary (r3 §2).
- PNG adaptive filtering vs filter-0 is a 193× output-size difference (r3, measured after a
  self-correction).
- Probe 100: sessions with no extractable first-prompt text vanish from `listSessions()` AND
  `getSessionInfo()`; transcripts intact. **Review corrected its interpretation:** the C cell is
  the library shape, not the REPL's — `submitText` keeps chip labels literal, so the REPL likely
  never sends empty text (verify live in I1's pre-task probe).
- The app-server's 256 KiB inbound frame cap makes any single-frame image method stillborn —
  found by the design review, verified at `peer.ts:8` (v1 had specced one).
- `items/mapper.ts`'s "flattener" is a tool-result summarizer — collapsing it onto
  `flattenForDisplay` would have shipped a regression (review, verified).
- After double/triple click, ccx dragging is fully dead — shipped in F9, caught by r1.
- `dockDialogRows` under-counts `CompactionRow` by one row today (r1).
- The Segmenter worst case is real quadratic but physically unreachable in a `HitRow` (r4).
- The F9 ledger's "3 stale comments" is actually 2 (r4).

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v2 (2026-08-23): Codex adversarial review (gpt-5.6-sol, xhigh) returned 17 findings (11 high);
  all 17 verified against the tree and adopted, four with load-bearing code verification: the
  REPL `submitText` chip-label fact (F2 — rescoped I1 to the normalizer and flipped probe 100's
  exposure conclusion), the 256 KiB app-server frame cap (F4 — I3 became staged/chunked), the
  `firstResultLine` tool-result scope (F7 — flattener collapse narrowed), and the normalizer's
  missing count caps (F3). S4's address redesigned to character identity; popup origin corrected
  to `dockTop`; daemon skew moved client-side with a frame cap; engine widening became an
  optional capability with fleet descoped loudly; codec gained normative hostile-input bounds;
  merge gates now require the pty matrix + keyed live cells as recorded evidence.
- v1 (2026-08-23): authored from research r1–r4 + probe 100 after owner approved composition and
  settled both forks (hover gate deferred; fix-forward only).
