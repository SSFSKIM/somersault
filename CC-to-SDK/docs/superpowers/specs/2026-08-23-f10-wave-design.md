# F10 Wave — Selection Maturity, Hover Truth, Image Reach, Maintenance

**Status:** v1 — owner approved the design 2026-08-23 (composition + two forks settled; see Decision
Log). Canon = installed Claude Code **2.1.236** (`/Users/new/claude-code-bundle/2.1.236/cli.pretty.js`;
all `L…` refs are that file). SDK = installed `@anthropic-ai/claude-agent-sdk` **0.3.237**.

## Purpose

F9 shipped five tracks and recorded its residues honestly. F10 is the wave that pays those residues
down — but the research pass (r1–r4, `.doperpowers/sdd/2026-08-23-f10-wave/research/`) overturned
three of the record's premises and found one live defect, so this spec builds from the *measured*
state, not the recorded wording:

- Canon's click-to-caret works during busy turns (no occupant arithmetic exists in canon at all);
  ccx's refusal during every busy turn is a pure loss. **Fix: bottom-up origin arithmetic.**
- Canon's transcript hover unit is one whole SDK message — *coarser* than ccx's logical-line unit,
  and "needs a layout tree" was about non-transcript sites. CM33 is the *suggestion popup*.
  **Fix: `ownerKey` grouping (S) + a popup hit region (M). No tree.**
- Canon resizes clipboard images platform-independently (it has no `sips`); ccx's Linux path refuses
  BMP and anything oversized. **Fix: a pure-JS `node:zlib` ladder, measured viable (r3 §2).**
- **Live defect (probe 100, SDK 0.3.237):** an image-only first prompt strands the session — absent
  from `listSessions()` *and* `getSessionInfo()`; ccx's always-prepended empty text block does not
  rescue it. `/resume` can never show such a session even though `getSessionMessages()` proves the
  transcript is intact. **Fix forward at the builder (owner fork: no recovery scan).**

Four tracks, five worktrees' worth of work in four: **T-SELECT**, **T-HOVER**, **T-IMGREACH**,
**T-MAINT**. Every track builds on code merged in F9 (≤ 1 day old at research time).

## Global constraints

- Repo conventions: `harness/CLAUDE.md` governs (dense hand style, ESM `.js` specifiers, DI-by-deps,
  TDD). Gates per track: `npm run typecheck`, `npm run build`, `npm run test:unit`, `npm run test:tui`
  (scoped runs during development; full four gates before merge). Never bare `npm test`.
- Canon is read with `grep -n` + `sed -n` ranges, never `grep -o`.
- Live tests gate on `CLAUDE_CODE_OAUTH_TOKEN` from `CC-to-SDK/.env` (`set -a; . ../.env; set +a`);
  never print/echo/commit secrets; API-key line stays commented.
- Payload widenings on any wire are **negotiated steps, never optional fields** (F9 lesson; Zod
  strips unknown keys — r3 §1 re-proved it for the app-server and daemon wires).
- No new runtime dependencies. The Linux image module is `node:zlib` only.
- Never `git add -A`; stage explicit paths. Commits to track branches in worktrees; merge `--no-ff`.
- Mouse/selection/hover changes need the same test discipline F9 used: pure-model tests + ink
  mounts + at least one live pty cell per behavior class, and sabotage guards where a wrong constant
  would pass silently.

---

## Track T-SELECT — selection & caret maturity

Research: r1. Six pieces; **ordering constraint: S4 (remap) strictly before S6 (auto-scroll), and
S5's edge arm rides S4**. S1, S2, S3 are independent and can interleave.

### S1 — Bottom-up caret origin (replaces `dockCrowded`) — M

Today `dockCrowded` (`ChatApp.tsx:1566`) suppresses the click-to-caret origin during every busy
turn, non-empty task panel, and compaction. Canon has no such gate (its only early return is the
ctrl+r search flag, L606604/L200134-200163). The dock is bottom-anchored by construction
(`FullscreenFrame.tsx:315-317`), so the composer's position is computable from below with no
occupant term at all:

```
frameLastRow   = FRAME_TOP_ROW + frameHeight(rows) - 1     // new DockBottomContext, beside DockTopContext
composerBottom = frameLastRow - footerRows(footerStatusInput())
bufferBottom   = composerBottom - (inlineSearchOpen ? 1 : 0) - 1   // composer-local bottom rule
bufferTop      = bufferBottom - (bufferLineCount - 1)
```

- Add `DockBottomContext` to `FullscreenFrame` (same "computed constant, 0 = not addressable"
  contract as `DockTopContext`, `FullscreenFrame.tsx:126-141`).
- Replace the `dockCrowded: boolean` prop with `footerRows: number` (ChatApp already computes the
  exact call at `:1547`).
- Keep `dockTop` as a sanity floor (`bufferTop >= dockTop` or refuse); keep the composer-local
  `waitingForPermission` term (it is exact).
- **Refuse the origin when the dock overflows `dockCap`** — the frame already detects
  `bottomGot > cap` (`FullscreenFrame.tsx:301-304`); publish that fact and go not-addressable
  while it holds (the clip eats the footer, so bottom-up would point off-screen).
- Delete the `dockCrowded` computation and its prop threading; the F9 comments describing the
  term-by-term sum are superseded (that sum's sibling `dockDialogRows` is already wrong by one for
  every compaction — do NOT extend it).

Tests: pure arithmetic table (pane heights × footer configs: statusLine off/1/3 lines, bash mode,
armed exit); ink mounts per occupant combination (spinner / compaction±bar / task panel 1·3·6 /
palette 1·5) asserting the published origin equals the row where the frame's output actually
contains the buffer's first line; the F9 live pty caret cell re-run **during a busy turn** and
**with the task panel open**; sabotage: mutate `footerRows` +1 → pty test must fail.

### S2 — Word/line drag extension (`w0p`) — S — fixes a shipped bug

After a double/triple click, dragging does nothing: `selectedSpans` gives `anchorSpan` absolute
priority (`selection.ts:194-198`). Canon's `w0p` (L198781-198798) recomputes the word/line span
under the pointer and pivots on the original span (before it → `anchor = span.hi, focus = newLo`;
after it → `anchor = span.lo, focus = newHi`; inside → collapse back).

Port as `dragToSpanned(state, cell, rows)` in `selection.ts`; call from `dragSelectionTo` when
`state.anchorSpan !== null`, writing real `anchor`/`focus` so the existing multi-row path takes
over. Tests: double-click a word, drag two words right → both whole words; drag left past anchor →
pivot flips; triple-click-drag → whole rows; sabotage the pivot comparison.

### S3 — Named `selection:copy` / `selection:clear` actions — S

Add both to the action union; bind `ctrl+shift+c` and (if the raw-stdin parser produces a `super`
modifier — verify; else record) `cmd+c` → `selection:copy` in the `Scroll` block; leave
`selection:clear` **named but unbound** (canon: action exists in the enum L174997, no default
binding). Keep the existing pre-table ctrl+c hook — canon keeps both too (L551764-551772).
Tests: keymap resolution in `Scroll` only; `keybindings.json` override round-trip; banned-chord
sweep extended; `?` grid snapshot picks up the rows.

### S4 — Selection remap-on-shift — M

Replace snapshot-and-clear (`FullscreenViewport.tsx:521-530`) with durable endpoint addresses:

```ts
interface SelectionAddr { itemKey: string; innerRow: number; col: number }
```

Written at the three gesture sites (for `anchor`, `focus`, both ends of `anchorSpan`); re-derived
to numeric rows at each publish, **during render, before `selectedSpans`** (an effect would paint
one wrong frame). Remap rules (r1 item 2 table): find the contiguous run with matching `itemKey`;
`row = runStart + min(innerRow, runLength-1)`; re-snap `col` via `columnToChar`/`charToColumn`
against the new row. Endpoint's item scrolled out → clamp to window edge + mark virtual (canon's
`virtualAnchorRow/Col`), restores on scroll back. Both ends off the same edge → retain, paint
nothing, copy nothing (canon's `ELt`). Item deleted (fold collapse/session swap) → clear — today's
behavior, now confined to the case that warrants it.

Canon translates by scroll delta and never clears (`C0p`/`k0p`, L198804-198853) — but its
screen-space model mispoints when content changes without a scroll delta; identity-based remap is
**deliberately better than canon** here (recorded delta). Tests: before/after HitRow pairs for
insert-above / re-wrap-narrower / fold-toggle asserting endpoints land on the same *text*; a
streamed-delta-during-sweep viewport test (the exact defect that produced v1's clear); re-point
the existing clear-on-shift tests at the still-clearing cases; pin `itemKey` stability across
streaming deltas (if a streaming block's id churns per delta, remap degrades to clear — test it);
sabotage: no-op the remap.

### S5 — Six `selection:extend*` chords — M

Canon's `Scroll`-context set (L174817): `shift+left/right/up/down` → `extendLeft/Right/Up/Down`,
`shift+home/end` → `extendLineStart/LineEnd`. **Canon has no shift+click extend** (press branch
L199709-199718 has exactly three outcomes) — K22's real content is keyboard extension.

Add the six actions to the union, bind in `Scroll`, register handlers in `FullscreenViewport`
(already owns `useKeyScope("Scroll")`). Port `moveSelectionFocus` + `E0p` (L203359-203396):
left/right wrap across row bounds; extend **clears `anchorSpan`** (deliberate canon behavior —
transcribe, don't improve). ccx's per-row `x1/x2` = `gutterWidth+1`/`width` — a small honest
divergence (canon uses uniform scope columns); record it. Handlers return false with no selection
so the chords fall through to the composer (registry fall-through, same as `v`). The
extend-past-edge scroll-by-1 arm (canon's `S()`, L551745-551762) ships only if S4+S6 have landed;
otherwise defer it with a recorded note. Tests: keymap + behavior + fall-through-when-no-selection.

### S6 — Auto-scroll drag + off-window capture — M — strictly after S4

Driver: on `dragSelectionTo`, `dir = cellRow < 1 ? -1 : cellRow > rows.length ? +1 : 0` with the
anchor inside the window (canon `sNw`); non-zero starts a timer at **2 rows / 50 ms / 200 ticks**
(canon's constants, L551562); each tick fires the pager scroll action then re-applies `dragTo` at
the clamped edge. Timer cleared on drag end, `discardSelection`, unmount, and at scroll bounds.

Capture: extraction walks the in-memory document (`items`) between the two durable addresses —
no `scrolledOffAbove/Below` text snapshot (canon needs one only because its selection lives on the
screen buffer). **The document walk must agree byte-for-byte with `extractText` for a fully
visible selection** — assert equality. Tests: fake-timer drag-to-edge (offset moves 2N, selection
covers the same document text); bounds stop; release-mid-scroll stops; extractor equality; live
pty sweep past the bottom edge → clipboard holds content beyond the window.

---

## Track T-HOVER — hover truth

Research: r2. Two pieces + one defect removal. **No layout tree.**

### H1 — W-UNIT: message-level hover grouping + hoverBand removal — S

Canon's hover unit is one SDK message (`K6w`, L562778-562784; one `hoveredKey` for the list,
L563004); the only visual channel is the dim-drop context (`Ssi`, sole consumer L203977-203979).
ccx groups per logical line because the id producers mint a line ordinal
(`toolRenderer.tsx:697,731`) and `sourceId` strips only the wrap suffix (`wrapItems.ts:120`).

- Add optional `ownerKey` to `RenderItem`; set it beside `id` at the producers (`toolRenderer.tsx`
  :480-481, :697, :731, and the `reid` re-keying); hover compares `ownerKey ?? sourceId(id)`.
  Absent field = today's behavior — nothing outside the transcript moves.
- **Remove `hoverBand` from `Line.tsx:27-30`** (defect: cites L562779, which is canon's *expanded*
  marker — canon's transcript hover never touches a background; the swap is real only on chrome
  widgets: sticky-prompt row `Psc` L562667-562684 and the scroll pill `O6w` L562653-562661, and
  ccx's `JumpPill.tsx:96` already carries it). The dim-drop half of `Line.tsx` stays.
- **Owner fork (settled): canon's clickable gate is DEFERRED** — hover stays on everything as a
  recorded deliberate delta; the gate ships later paired with making error/truncated result rows
  clickable, as one ticket.
- Measure (don't assume) the one multiplying cost: the per-row `\x1b[2m` regex strip across a tall
  hovered block (`Line.tsx:35`); memoize if it shows up.

Tests: hover.test.tsx re-pointed — hovering any line of a multi-line message un-dims the whole
message; the band-swap assertions become their negation on transcript rows (and stay positive on
JumpPill); parity notes updated (`tui-ux.md:1985` D7–D9 wording).

### H2 — W-POPUP: CM33, suggestion-popup hover + click — M

`SuggestPopup` publishes a hit region `{ top, rows: [{ id, colStart, colEnd, lines }] }` through a
ref in the same shape `ViewportHitmap` uses; `ChatApp`'s mouse sink routes motion/press to it when
the popup owns the band. Geometry is already pure (`lineCount` 1-or-2 = canon `OSw`;
`scrollWindow` = canon `DXe`); origin: in-flow palette sits directly above the dock, so
`top = dockTop - paintedRows` via `usePaletteHoist` — and it must degrade to not-addressable under
exactly the conditions `originExact` does (this inverts F9's discovery: the fact that blocks the
composer's origin IS the palette's own origin).

Canon semantics to hit (`Bvt` L536289-536314, `UIh` L536379, store L602029-602033): hover renders
the row exactly as selected (hover **overrides** keyboard highlight: `A ?? k`); keyboard arrows
**clear** hover; hover does not move the keyboard cursor (Enter still accepts the keyboard pick);
click passes the **absolute index** (`windowStart + P`); container-leave clears; hover and click
both absent when the popup is non-interactive; setter bails when unchanged.

Tests: pure region-model tests (1- and 2-line rows, scroll window offsets); ink mount asserting
highlight override + arrow-clears + enter-accepts-keyboard-pick; click dispatch by absolute index;
not-addressable degradation cells; live pty hover sweep over a real popup.

---

## Track T-IMGREACH — image reach

Research: r3 + probe 100 (`probes/probes/100-listsessions-image-only.ts`, committed).

### I1 — Stranded-session fix at the builder — S

`assembleUserContent` (`session/turnInput.ts`) stops emitting an empty leading text block when the
user typed nothing: substitute the image chip label text (the `[Image #N]` form ccx already has),
which makes the first prompt extractable (probe 100's mechanism: the SDK's line-0 enqueue record
carries prompt *text*; empty is as unextractable as absent) AND gives the session a real
title/summary in the picker. **Owner fork (settled): fix forward only — no JSONL recovery scan.**
Tests: builder unit (image-only input → non-empty text block, exact label); live cell: an
image-only turn through the real REPL topology → session appears in `listSessions()` with the
label as `firstPrompt` (probe-100 shape, now asserting presence).

### I2 — Library surface accepts `UserTurnInput` — S–M

`Harness.run`/`stream` (`harness.ts:18-19,84,89`), `runStructured` (`structured/run.ts:22`),
`Session.stream` (`session/session.ts:188` — the last string pin on `Session`). **Not a type
unpin:** SDK `query()` takes `string | AsyncIterable<SDKUserMessage>` only (`sdk.d.ts:2692-2695`);
the array case builds one `SDKUserMessage` via `Session`'s `userTurn` so `normalizeTurnInput`'s
caps still apply. Tests: unit (array in → normalized blocks out, caps enforced); a gated live cell
(`harness.run` with an image block → model names the color).

### I3 — App-server: `turn/startContent` — M

New JSON-RPC method (negotiated step: old servers answer METHOD_NOT_FOUND — the analogue of the
host's `"unknown op"`); `turn/steer` widens in the same pass (`Session.steer` at
`session/session.ts:174` unpins with it). Three sub-items are IN scope (r3 §1, "ride along"):

1. `appserver/queue.ts:28`'s 1 MiB total-queued-bytes cap re-thought for image payloads (one
   512 KB image ≈ 683 KB base64).
2. The three divergent flattenings (`items/replay.ts:14-18` first-text-only; `items/mapper.ts:10`
   join-all; `flattenForDisplay`) collapse onto `flattenForDisplay` — live and replayed renderings
   of one turn must agree.
3. `EngineSession.submit` (`appserver/registry.ts:34`) widens with the real `Session`.

A capability list on `initialize` is **out of scope** — recorded as its own follow-up ticket (the
durable fix for the *next* widening, decoupled so it doesn't hold this one hostage). Fleet's
JSON-RPC hop inherits I3; its host hop already accepts images. Tests: schema accept/reject table;
old-server skew cell (method absent → loud client error, no silent text-only turn); queue-cap
cells; one flattener test asserting replay = live for an image turn.

### I4 — Daemon: `submit_content` op — M

First split the daemon's collapsed error into `"unknown op"` vs `"invalid op payload"`
(`daemon/server.ts:66-67`), copying the host template — that split IS the negotiation. Then the
new op literal on the discriminated union (`daemon/types.ts:97`); supervisor hands the array to
`Session.submit` which already accepts it. `connect.ts`/CLI passthrough follow. Tests: op
accept/reject + skew (old daemon → loud unknown-op error at the client); unit round-trip.

### I5 — Pure-JS image ladder (Linux floor; BMP; Windows for free) — M

One new leaf module (~250–300 lines, `node:zlib` only): PNG decode (inflate + unfilter), BMP
decode (**must handle `BI_BITFIELDS` masks + `BITMAPV5HEADER` + negative-height top-down rows** —
r3 verified real clipboard BMPs are exactly that), box downscale, PNG encode **with adaptive
per-scanline filtering** (non-negotiable: it is the 193× difference that makes the approach
viable). Explicit fallback arm for palette/16-bit/interlaced PNGs: pass through if under budget,
else fail with a real reason. Wire into `pasteClipboardImage`'s non-darwin path (both Linux dead
ends at `clipboardImage.ts:222-223,357` and Windows' identical `:357` arm). Darwin keeps `sips`
(unchanged, shipped, live-verified); unification is a recorded follow-up, as is the opportunistic
`magick`/`convert`/`ffmpeg` rung. Measured budget: real screenshots fit 512,000 B at 2000 px on
rung 1 in 100–200 ms. Tests: golden-bytes decode/encode round-trips (incl. a real
BI_BITFIELDS BMP fixture), oversized→resized cell, unsupported-PNG fallback arm, byte-budget
enforcement — all runnable on macOS (the module is platform-free; that's the point).

### I6 — Ambient clipboard hint — S–M

Canon pin (r3 §3): copy `` Image in clipboard · {binding} to paste `` built from the live
`chat:imagePaste` binding (ccx: `formatBindingLower`/`expandHintText`); renders as a transient
notification (ccx: the existing `priority:"immediate"` notification channel — the eighth poster,
not a placeholder-ladder entry); triggers: terminal focus-in edge (enable `ESC[?1004h` in
`altScreen.ts` — parser already recognizes `I`/`O` at `parse.ts:132` — plus a route promoting the
ignored event) **and** canon's first-keypress-while-unknown secondary trigger (works in terminals
without 1004); 1000 ms debounce, 30 000 ms throttle, gated on image paste being available.
Presence check is **exit-code only, bytes discarded, `maxBuffer` capped low** (never slurp the
clipboard for a yes/no) — and **platform-dispatched** via the existing `linuxCheckImageCommand`/
`windowsCheckImageCommand` builders (deliberate delta: canon's check is hardcoded osascript and
its hint is de-facto macOS-only — a platform bug we don't reproduce). Tests: trigger/debounce/
throttle fake-timer cells; focus-event route unit; check-command dispatch table; notice copy pins
with binding override; live pty: copy an image, focus the terminal, see the hint.

---

## Track T-MAINT — maintenance bundle

Research: r4. Seven code items + one evidence-only record.

1. **accountInfo cold-start race — M.** Thread the live, unraced `host.accountInfo()` promise to
   `useChat` (bridge shape like `noticeBridge`); the notice's 800 ms timer awaits it under a second
   short deadline instead of trusting the mount-captured `initialTokenSource`. Banner's 1500 ms
   race untouched (raising the budget has a tail and costs first paint). Tests in
   `auto-mode-notice.test.tsx` + `cli-main.test.ts` updated.
2. **Prefs single-read — XS.** Hoist one `loadPrefs()`; `needsBypassConsent` takes the loaded
   prefs. New assertion: spy call count === 1 on a foreground launch.
3. **Layering cut — S.** `pngDimensions`/`jpegDimensions` + `MAX_DIMENSION`/`POST_PROCESS_BYTE_BUDGET`
   move to a neutral leaf (`src/media/imageDims.ts`); `clipboardImage.ts` and `turnInput.ts` import
   it. Scoped to the flagged site only (the three precedent sites stay recorded). Note: I5's new
   module lands in the same `src/media/` home.
4. **Legacy history.jsonl read pin — XS.** Plant a raw pre-F9-shaped line (with
   `mediaType`/`filename`) directly in the file; assert `readHistory` + `hydrateEntry` tolerate it.
5. **Two stale comments** in `sessionPickerModel.test.ts:5,25` (ledger said 3; it is 2 — r4
   verified) rewritten against the current `ResumeTranscriptView` architecture. XS.
6. **hitmap `kind === "line"` assertion — XS** (mouse/T1 gap).
7. **`resumeInto` "no history found" guard test — XS** (`useChat.ts:2319`, zero coverage).
8. **Segmenter O(n²): no code change.** Benchmark attached to the ledger (quadratic confirmed;
   single-digit-to-tens of ms at physical row widths; 11.6 s only at 10k CJK chars a row cannot
   hold). The real amplifier to watch — `wordSpan`'s per-step `clustersOf` recompute — is recorded
   as a watch-item with the WeakMap memoization shape pre-agreed if it ever goes per-frame.

---

## Acceptance (behavior-phrased; each cell names its evidence)

Merge gates (assembled tree): `npm run typecheck` + `npm run build` clean; `npm run test:unit` and
`npm run test:tui` fully green.

1. **Busy caret**: in a live pty, mid-busy-turn (spinner painted) and separately with the task
   panel open, clicking a character in the composer moves the caret to it. Evidence: pty capture.
2. **Dead-drag fixed**: double-click a word then drag right two words — the selection covers all
   three whole words; toast on release contains their text. Evidence: pty capture + unit.
3. **Selection survives streaming**: start a sweep, let a streamed delta land above it — the
   painted highlight covers the same characters as before. Evidence: viewport test + pty cell.
4. **Extend chords**: with a selection, shift+right grows it one column; shift+end to line end;
   in `~/.claude/keybindings.json` a rebind of `selection:copy` is honored; without a selection
   shift+arrows reach the composer. Evidence: keymap tests + pty.
5. **Auto-scroll capture**: drag to the bottom edge and hold — the viewport scrolls, and on
   release the clipboard contains text that was never on screen during the press. Evidence: pty.
6. **Message hover**: hovering any line of a multi-line assistant message un-dims every dim line
   of that message and no line of its neighbors; no transcript row changes background on hover.
   Evidence: ink test + pty capture.
7. **Popup hover (CM33)**: hover a suggestion row → it highlights as selected while the keyboard
   selection is elsewhere; press an arrow → hover highlight yields to keyboard; click a row →
   that suggestion is accepted by absolute index. Evidence: ink tests + pty.
8. **No stranded sessions**: an image-only prompt sent through the real REPL yields a session that
   appears in `listSessions()` with a non-empty `firstPrompt` (keyed live cell, probe-100 shape).
9. **Library images**: `harness.run([{type:"image",…}])` round-trips (keyed live cell: model names
   the color).
10. **App-server/daemon skew is loud**: against a pre-F10 server/daemon binary, an image submit
    fails with an explicit unsupported error and no text-only turn runs. Evidence: unit skew cells
    (schema-level old/new tables).
11. **Linux ladder (platform-free proof)**: a 2.5 MB PNG and a BI_BITFIELDS BMP both come back
    ≤ 512,000 bytes with correct pixels (golden fixtures), on macOS CI-equivalent runs.
12. **Ambient hint**: with an image on the clipboard, a focus-in shows
    `Image in clipboard · ctrl+v to paste` within ~1 s, dim, right-aligned, gone in 8 s; a second
    focus-in within 30 s shows nothing. Evidence: fake-timer tests + one pty capture.
13. **Maintenance**: prefs read once per launch (spy); cold-start notice shows the OAuth variant
    even when `accountInfo` resolves after 1500 ms (fake-timer); legacy history line parses;
    the parity/ledger corrections (2 comments, wording) committed.

## Non-goals

Hover clickable gate + clickable result rows (one later ticket); stranded-session recovery scan;
app-server `initialize` capability list (own ticket); opportunistic `magick`/`ffmpeg` rung; darwin
`sips` unification onto the pure-JS module; `ccx -p` image flags (CLI UX undesigned); swarm/kairos
seed widening (low value); Segmenter memoization (watch-item); §2-transcript and §4-dialog backlog
(not F9 follow-ups).

## Decision Log

- **Full F10, four tracks** — owner picked over a lighter 3-track round (2026-08-23).
- **Hover clickable gate deferred** (owner fork): adopted alone it deletes visible behavior;
  ships later paired with clickable error/truncated rows. Rejected: adopt-now with scope growth.
- **Stranded sessions: fix forward only** (owner fork): builder emits the chip label; no JSONL
  scan (duplicates SDK on-disk knowledge; population ~0 one day after Ctrl-V shipped). Rejected:
  recovery scan.
- **Bottom-up caret arithmetic over occupant-height sum**: occupant-agnostic by construction;
  the sum's sibling (`dockDialogRows`) is already wrong for CompactionRow — evidence the shape is
  fragile. Rejected: term-by-term sum (F9's comment plan), measureElement-only (kept as fallback
  if composer-local geometry proves non-enumerable).
- **Identity remap over canon's screen-delta translation**: survives fold/re-wrap canon gets
  wrong; recorded deliberate delta. Rejected: verbatim `C0p` port (needs a scroll-delta wire ccx
  doesn't have), keep-clearing (the residue this wave exists to fix).
- **`ownerKey` field over id-prefix parsing / row spans / layout tree**: correct by construction;
  prefix parsing breaks on the fourth id shape (`reid`); spans and tree deferred until something
  draws at widget bounds. (r2 §4.1.)
- **App-server: new method now, capability list later**: METHOD_NOT_FOUND is the loud-skew
  analogue of "unknown op"; the capability list helps the *next* widening and shouldn't gate this
  one. Rejected: union the input type (loud but indistinguishable from a bad payload).
- **Daemon: error-split first, then new op literal** — the split is what makes skew legible.
- **Pure-JS `node:zlib` ladder over sharp/ImageMagick floor**: measured viable (100–200 ms, full
  res on rung 1); sharp's install footprint rejected; system binaries can't be the floor on the
  machines most likely to run headless. Adaptive filtering mandatory (193×).
- **Ambient hint: platform-dispatched, exit-code-only check** — deliberate deltas from canon
  (whose check is hardcoded osascript that slurps the image bytes; de-facto macOS-only).
  Notification channel, not the placeholder ladder (a clipboard fact is not an input-buffer fact).
- **accountInfo race: thread the live promise, don't raise the budget** (any fixed budget has a
  tail; the budget was measured-tuned for first paint).
- **Layering cut scoped to the flagged site** — three precedent inversions stay recorded.
- **Segmenter: benchmark recorded, no code change** — quadratic is real but physically unreachable
  at row widths.

## Surprises & Discoveries

Seeded from research (r1–r4); implementation appends here.

- Canon does no occupant arithmetic for click-to-caret; the F9 comment plan was a wrong turn (r1).
- Canon's transcript hover is message-coarse and clickable-gated; "layout tree" belonged to
  non-transcript sites; CM33 names the popup (r2). ccx's hover band swap cited canon's *expanded*
  marker — a live mis-transcription (r2 §4.3).
- Canon has no `sips`; its resizer is platform-independent; its clipboard read's tier 1 is a native
  NSPasteboard addon and the osascript quartet ccx transcribed is tier 2 (r3 §2).
- PNG filter-type-0 vs adaptive filtering is a 193× output-size difference — the fact that decides
  the whole no-dependency question (r3, measured after a self-correction).
- Probe 100: image-only sessions vanish from `listSessions()` AND `getSessionInfo()`; the enqueue
  record's `content` key is *absent* for them; empty string is as unextractable as no string;
  transcripts remain intact (r3 §4).
- Canon's ambient hint materializes the entire clipboard image via osascript to answer yes/no, and
  silently never fires for images whose hex form exceeds execa's 1 MB maxBuffer (r3 §3).
- After double/triple click, ccx dragging is fully dead — shipped in F9, caught by r1 (canon `w0p`
  had no counterpart).
- `dockDialogRows` under-counts `CompactionRow` by one row today (r1).
- The Segmenter worst case is real quadratic but physically unreachable in a `HitRow` (r4, bench).
- The F9 ledger's "3 stale comments" is actually 2 (r4).

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-23): authored from research r1–r4 + probe 100 after owner approved composition and
  settled both forks (hover gate deferred; fix-forward only).
