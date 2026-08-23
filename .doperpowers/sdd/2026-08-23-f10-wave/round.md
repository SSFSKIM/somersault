# F10 wave — ledger

Owner-approved composition (2026-08-23): **Full F10, four tracks**, all sourced from the F9
follow-ups record (spec retrospective residues + ledger Minor roll-up).

- **T-SELECT** — selection & caret maturity: occupant-height accounting (dockCrowded fail-safe →
  real heights), selection remap-on-shift (itemKey identity), scrolled-off-row capture,
  extension chords (K22 residue).
- **T-HOVER** — per-widget hover (CM33), the wave's architectural piece ("needs a layout tree" —
  research to adjudicate itemKey-grouping vs widget spans vs real layout tree).
- **T-IMGREACH** — image reach beyond the REPL: non-REPL surfaces (harness.run/stream, appserver,
  daemon, fleet — currently @ts-expect-error string-pinned), Linux resize ladder, ambient
  clipboard hint, SDK listSessions image-only exclusion (probe-first).
- **T-MAINT** — maintenance bundle from the Minor roll-up: accountInfo cold-start race (UX-visible),
  prefs double-read, core→UI layering inversion, stale test comments, legacy history.jsonl pin,
  Segmenter O(n²) benchmark-then-decide.

Pipeline: research r1–r4 (dispatched 2026-08-23, parallel) → spec → Codex adversarial design
review (gpt-5.6-sol xhigh) → design presentation to owner → plans → subagent-driven execution
in worktrees.

## Research

- r1 selection/caret → research/r1-selection-caret.md (opus) — DONE. Headlines: canon's click-to-caret works during busy turns via cachedLayout (no occupant sum — bottom-anchored arithmetic beats F9 comment's plan; dockDialogRows already wrong for CompactionRow); canon remaps selection by scroll delta and never clears (ccx should remap by {itemKey, innerRow, col} — better under fold/re-wrap); canon auto-scrolls drag at 2 rows/50ms/200-tick cap (depends on remap landing first); K22 = six selection:extend* shift+arrow/home/end actions + selection:copy, NO shift+click in canon; concrete ccx bug: after double/triple click, dragging is dead (anchorSpan overrides focus in selectedSpans, canon w0p).
- r2 widget hover → research/r2-widget-hover.md (opus) — DONE. Premise INVERTED: canon's transcript hover unit is the whole SDK message (uuid-gen key), COARSER than ccx's logical-line grouping, and fires only on canon's five clickable message kinds — plain prose never hovers. "Needs a layout tree" was about the NON-transcript sites (popup rows/dialog buttons/footer), and CM33 IS the popup row. Track splits: W-UNIT (transcript ownerKey grouping + clickable-kind gate, S — no tree) + W-POPUP (CM33 popup hit region reusing useDockTop/ViewportHitmap shapes, M). Defect found: Line.tsx:27-30 hover background swap cites canon's EXPANDED marker, not hover — canon hover never touches transcript background; remove it. Ink full-frame rewrite makes widget highlight cost = row highlight.
- r3 image reach + probe → research/r3-image-reach.md (opus) — DONE. No @ts-expect-error pins exist (F9 typed prompt: string outright); appserver (schema/turns.ts:6) + daemon (types.ts:57) both need NEGOTIATED widening (Zod strips unknown keys, no handshake on either wire); harness.run is NOT a pure unpin (SDK query() takes string | AsyncIterable<SDKUserMessage> only — sdk.d.ts:2692). Probe 100 (committed) confirms LIVE DEFECT: image-only sessions vanish from listSessions() AND getSessionInfo() — ccx's prepended empty text block does NOT rescue; transcript intact via getSessionMessages() (recoverable). Linux ladder: pure node:zlib PNG/BMP decode→downscale→re-encode fits 512KB at 2000px in 100-200ms — NO new dependency (first encoder lacked adaptive filtering, 193× worse — corrected before recommending). Canon has NO sips — its resizer is platform-independent (Linux gap = plain missing feature). Ambient hint: 'Image in clipboard · ctrl+v to paste', focus-in edge-triggered, 1s debounce/30s throttle; parse.ts:132 already parses focus events — only ESC[?1004h enable + event route missing.
- r4 maintenance grounding → research/r4-maintenance.md (sonnet) — DONE (all six confirmed; Segmenter quadratic but harmless at row widths; +2 cheap gaps found; "3 stale comments" is actually 2)

All four research reports DONE 2026-08-23. Next: spec authoring.

## Spec
- v1 committed dc54a78473 (owner approved design + both forks: hover gate DEFERRED, stranded fix FORWARD-ONLY).
- Codex adversarial review (gpt-5.6-sol, xhigh) launched 2026-08-23 against v1; findings pending.
- Codex round 1: 17 findings (11 high), ALL verified true and adopted. Load-bearing verifications: submitText keeps [Image #N] literal (probe 100's C cell = library shape, NOT the REPL — I1 moved to normalizer boundary + pre-task re-probe); appserver MAX_IN 256KiB (peer.ts:8) kills single-frame images → I3 = image/stage chunked + turn/startContent + turn/steerContent; mapper.ts firstResultLine is a TOOL-RESULT summarizer (flattener collapse narrowed to user-prompt display); normalizer lacks count caps (shared 20-image + 64-block caps + one-sentinel collapse added). S4 SelectionAddr redesigned {itemKey, charOffset} + HitRow.itemRow. Popup top = dockTop (v1 subtraction wrong). Daemon skew = client-side mapping + 1MiB line cap. EngineSession: optional submitContent capability, fleet loud-unsupported (follow-up ticket). Codec hostile bounds normative. Merge gates now REQUIRE pty matrix + keyed live cells. v2 committed.
- Codex round 2 (focused re-review of v2 deltas) launched.
- Codex round 2: 11 findings (9 high), ALL adopted into v3 (514a6800fb): HitRow gains wrap-time source [charStart,charEnd) (cumulative painted-length arithmetic was irreversible — padding/#wN/hard-row ambiguity); endpoints document-ordered half-open (role-based broke backward drags); bufferPhysicalRows = painted projection incl. EOL cursor cell + ghost wrap; dock-slot measureElement watchdog for whole-dock overflow; image-only arrays get synthetic text block INSERTED at index 0 (Session.submit([image]) is a pinned supported shape); MAX_TOTAL_TEXT 1,048,576 UTF-16 truncate-with-suffix incl. bare strings, sentinel reserves a slot in 64; image/stage requires validated mediaType on first chunk + 60s idle/10min absolute expiry + 32MiB/64-stage global cap + atomic claims + positive end-to-end JSON-RPC cell; steerContent as its own optional engine capability; daemon cap re-derived 16MiB from normalizer maxima + 10s partial-line deadline + StringDecoder.
- Codex round 3 (final, v3 deltas only) launched.
- Codex round 3: 5 findings (3 high), ALL adopted into v4 (a164b732b7): dual overflow checks (composer-local + frame watchdog — frame effects blind to descendant setState per FullscreenFrame.tsx:29-36); side-specific endpoint containment (lower start<=v<end, upper start<v<=end, gap/EOF snaps); normalizer canonicalizes base64 + daemon client normalizes/preflights before transport + server cap 24MiB derived escape-aware; one output-accounting algorithm (sentinel 256 + suffix 64 reserves, truncate-from-last-block); stage validation ONCE at completion with cached claim charge (failed claims decode nothing). CONVERGED — 17→11→5 strictly narrowing. Implementation proceeds on v4.

## Plans
- Four track plans dispatched to opus plan-authors 2026-08-23: t-select (S1-S6), t-hover (H1-H2), t-imgreach (I1-I6), t-maint (M1-M8).
- t-maint plan DONE 25ef8cb925 (915 lines, 4 tasks). Drift notes: MAX_IMAGES_PER_PROMPT's real consumers are host/host.ts + client/chatAdapter.ts (imageStaging.ts only defines it); 3000ms deadline = 800ms delay + 2200ms remainder armed in the notice callback (anchor = effect arming instant, mount for auto launches); "3 stale comments" = 2 (consistent with spec).
- t-imgreach plan DONE 28c787cf93 (1307 lines, 8 tasks in binding dependency order, normalizer-first). Traceability table maps round-2/3 Decision Log entries to steps. 8-item drift section incl.: test/integration/host-image-transport.test.ts:374-388 currently PINS the empty-text-block shape I1 changes (that pin must be updated by I1, not worked around); queue byte accounting changes for string entries too.
- t-hover plan DONE 5020471b17 (4 tasks; 15-producer matrix — spec named 3, tree has 15, sixteenth fails loudly). Key cross-track call: HitRow gains a NEW required ownerKey (message-coarse) BESIDE itemKey — coarsening itemKey itself would collide T-SELECT S4's charOffset space. Both tracks widen HitRow; merge is a field union. Other drifts: popup not-addressable = fullscreen && dockTop>0 (the !hoisted term is the popup's own precondition); jump pill = pillRow arm on hoverAt (no synthetic HitRow — would leak into selection indexing); lineCount is actually rowLines; dockTop one frame stale on palette open; band-swap removal changes user-echo + fork-boilerplate species output. Pty cells: new scripts/hover-cells.sh modelled on resize-matrix.sh (F9 left a recipe, not a committed mouse harness).
- t-select plan DONE ad965946bb (7 tasks, 105 steps). New modules: mouse/address.ts (SelectionAddr/locateEndpoint/orderEndpoints/remapSelection), composerRows.ts (bufferPhysicalRows/composerOriginRow); HitRow gains charStart/charEnd + textStart (cosmetic indent invisible to gutterWidth — drift note). Other drifts: busy-turn caret pty arm cannot be keyless (! bash mode never sets state.busy) → credential-gated per resize-matrix a3 precedent; cmd+c collides with error-reserved super+c → GRANDFATHERED entry + rebind-only exception for selection:clear; S2 requires inverting selectedSpans' first two cases. Pty harness: scripts/select-pty.sh (6 cells).
- All four plans committed. Codex plan review (all four vs spec, cross-track interfaces) launched.
- Controller cross-check: PLAN CONTRADICTION found — t-imgreach Task 2 makes imageStaging.ts:33 a re-export of MAX_IMAGES_PER_PROMPT; t-maint Task 1 forbids shims and repoints the real consumers (host/host.ts, client/chatAdapter.ts) to src/media/imageDims.ts, deleting the imageStaging definition. T-MAINT governs (no back-compat shims per harness/CLAUDE.md). Amend t-imgreach with the Codex plan-review findings.
- Codex plan review: 26 findings (18 high). Reviewer AUDITED drift notes: t-select bash-busy + super+c TRUE, t-maint consumers TRUE, t-hover "15 producers" FALSE (misses toolRenderer:368/372/393 literals, streamingItems.ts, ChatApp queued items). Controller fixes committed 71f689f7d2 + b38aa347cd: spec v4.1 (Wave assembly section — merge order MAINT→SELECT→HOVER→IMGREACH, imgreach branches from maint's Task-1 head, shared required HitRow end-state charStart/charEnd/textStart+ownerKey incl. editor.ts:734, per-merge union checklists + gate re-runs; codec 2s guard restated as cooperative belt over structural maxOutputLength inflate bound; stale itemRow decision marked superseded); skill headers → subagent-driven-execution (plugin 7.62.0 renamed it — verified). Three plan-fix agents dispatched (select 9 findings, hover 4+census, imgreach 12+splits).
- t-hover plan r2 DONE 2ecf6e4335: census = 20 sites in 3 files (toolRenderer 17 literals + reid spread; streamingItems.ts:28; ChatApp.tsx:1397 queued — all four tiers concatenate before hitRowsOf at FullscreenViewport:295-300). Owner semantics: agent batch = per member call (row + ⎿ status share), header its own unit; live streaming = LiveTurn.messageKey() (API message.id, ordinal fallback), threaded useChat→ChatApp→streamingItems; queued = queued:<entryIndex> with exported queuedTranscriptItems. Downgraded finding WITH proof: popup top/bottom-bounds arrow-clear doesn't reproduce (moveSuggestion is modulo — completions.ts:152); one-item hole real, fixed via EditorResult.suggestionNav. HitRow.ownerKey required, T-SELECT fields ABSENT on branch, 5-site constructor inventory = merge checklist. memoizeByInput seam with delete-the-cache-goes-red cells.
- t-select plan r2 DONE 3f31e9bfc8: all findings verified then adopted (columnToChar's charStart/charEnd + wide-cluster snap confirmed; stringWidth("⏺ ")=3 per wrapItems' own comment; 5-constructor HitRow inventory incl. editor.ts:734; blank-line ranges reproduced "one\n\ntwo" [0,3)[3,5)[5,8) vs required [0,4)[4,5)[5,8)). Task 4 → 3 tasks (7/8/9 renumbered). BONUS overturn: the plan's own "busy pty cell cannot be keyless" drift note WITHDRAWN — busy comes only from host turn/start events over the documented unix socket, so a fake host drives it keylessly; fixture is probe-first (capture attach ops live; if REPL won't paint against fake, escalate to controller, never silent-skip). moveFocus wrapper re-records addresses pre-repaint; S5 dependency moved Task 3→6; document-walk extractor is a production module; 199/200/201 cells.
- t-imgreach plan r2 DONE cc4357e737: 14 tasks (codec→3, appserver→5, each own red/green/commit). Consumes maint substrate (creation + re-export deleted); host transport assertion UNCHANGED (fake is HostSession, above the normalizer — verified) + new Session/fake-query label cells; daemonSubmitTurn dispatcher (strings→submit, arrays→submitContent) + schema-feedback contract test; drain runner routes by shape + refuses loudly capability-missing at drain, busy→enqueue→drain E2E; stage registry reserve/commit/abort + injected validator/clock + stats() + normalizeValidatedBlocks (nothing decodes twice); codec structural maxOutputLength bound, hostile fixtures run with wall guard stubbed-never-expires (only the structural bound can carry them); DecodedPixels|PassthroughImage union with never arm; fake powershell feasible (literal name at clipboardImage.ts:166,175,255); boundaryTriple.ts constant-indexed cap tables; ledger artifact staged. 0 rejections; 1 judgment call (submitContent? declaration rides queue task for typecheck order).
- All three plan r2 amendments in. Focused plan re-review launched.

## Execution
- Worktrees: f10-maint, f10-select, f10-hover created from main @ cc4357e737 (node_modules symlinked). f10-imgreach waits for maint Task 1 commit (branches from f10-maint head per assembly contract).
- maint/T1 implementer dispatched (sonnet) — BASE cc4357e737. Started ahead of the plan re-review deliberately: t-maint was not amended and T1 is the imgreach branch point (critical path).
- maint/T1: complete (6414e9c2a9, review clean — spec ✅, quality Approved). Minor (roll-up): test/unit/turnInput.test.ts:29 fixture comment still says "(clipboardImage.ts)" for pngDimensions — stale cross-ref created by the move. Reviewer re-ran gates independently + 2 mutation checks. imgreach branch point 6414e9c2a9 confirmed sound.
- Plan re-review round 2: 13 findings (7 high) — mostly split-fallout (undeclared chunk DTO, Task-4 param from Task 5, fixture arithmetic tripping the wrong cap first, boundary-comparison off-by-one) + three substantive: bare strings bypass MAX_TOTAL_TEXT on public surfaces (normalizeTurnInput must run unconditionally at userTurn); queued hover keys reused after drain (r2's rejection proof FALSE — needs stable QueueEntry identity); HitRow inventory misses selectionAddress.test.ts fixtures. Three r3 fix agents dispatched (imgreach 8, hover 3, select 2). maint track unaffected — T2 implementer running throughout.
- t-select plan r3 DONE 21a70a7ba4 (ledger paths → ../../; sabotage retargeted at ZWJ emoji — 你 is ONE UTF-16 unit so the CJK mutation was a no-op, 👩‍💻 spans 5 and goes red).
- t-hover plan r3 DONE 24b2b5e1f8: queued-key reuse CONFIRMED (drainNext q.slice(1) useChat.ts:2942 + stale-clear only checks painted presence FullscreenViewport.tsx:513) → QueueEntry gains required monotonic id at makeQueueEntry, owner/item/React keys derive from it; r2 rejection formally withdrawn in Spec-drift 9. Inventory = 6 constructors + merged-tree grep re-run requirement. Arrow-clear cell now observable (hover sole row → Down → backspace widens list, no mouse; /statu vs /stat pair verified live against the real 37-entry catalog).
- t-imgreach plan r3 DONE efe9ee9f1b: GIF/WebP narrowed to PNG+JPEG WITH host-path proof (ops.ts:63 has no allowlist; GIFs already strand as "unreadable image data" via the same validateImageBlock — narrowing = honest parity; widening follow-up recorded); ImageStageChunk DTO owned by Task 7 + ExactType pin in Task 10; Task 4 passthrough drops byteBudget (fit one layer up, arity cell); bare-string hole closed (userTurn normalizes unconditionally, harness.start string arm too, string wire form preserved); aggregate matrix = 10×512000 + 122879/122880/122881 residual; daemon submitContent non-empty tuple + parses own op pre-mapping; preflightOp with injectable limit + connectDaemon frameLimit seam (no normalized payload physically reaches 24MiB — recorded); partial-line boundary inclusive, timer at +1. PLANS FINAL. Fan-out begins.
- Fan-out live: select/T1 (BASE cc4357e737), hover/T1 (BASE cc4357e737), imgreach/T1 (BASE 6414e9c2a9) implementers dispatched (sonnet); maint/T2 review in flight. Plan totals: select 9 tasks, hover 4, imgreach 14, maint 4 — 31 tasks.
- maint/T2: complete (3c98f2c6a5, review clean — spec ✅, quality Approved, 0 findings). Bridge = one accountInfo() call, two consumers (banner race untouched, notice under 3000ms from arming); rejection swallowed at offer(); unmount timer-count 0 verified.
- maint/T3: complete (a8b90f9ae2, review clean — spec ✅ w/ adjudicated deviation sided-with, quality Approved). Minor (roll-up): sessionPickerModel.test.ts:7 rewritten comment has one stray unbalanced ")". Lesson: the brief's illustrative replacement text contradicted its own grep gate — executable gate wins, prose is illustrative.

## T-MAINT item 8 — Intl.Segmenter O(n²) in `clustersOf`: measured, no change

`src/tui/mouse/hitmap.ts:67-75` calls `snapToGraphemes` once per codepoint, and
`src/tui/graphemes.ts:16-19` builds a fresh `Intl.Segmenter` and re-segments the whole string on
every call for any non-ASCII text — the genuine O(n²) its own comment (`hitmap.ts:58-65`) declares.
r4 reproduced the exact algorithm and measured it (Node, this machine):

| input                              | time      |
|------------------------------------|-----------|
| ASCII, 200 chars                   | 0.23 ms   |
| CJK, 200 chars                     | ~5–20 ms  |
| Emoji (ZWJ family seq), ~200 chars | ~2.5 ms   |
| ASCII, 500 chars                   | 0.34 ms   |
| CJK, 500 chars                     | 28 ms     |
| ASCII, 10,000 chars                | 60 ms     |
| CJK, 10,000 chars                  | **11.6 s** |
| Emoji, ~10,000 chars               | 2.1 s     |

Doubling CJK input roughly quadruples the time (100→1.64 ms, 200→5.0 ms, 400→20.6 ms, 800→72.2 ms,
1600→257 ms, 3200→1009 ms), so the quadratic is real and not an artifact.

**Verdict: no code change.** A `HitRow.text` is bounded by the terminal's column width — 80–300
columns realistically, and CJK/emoji cells are double-width, so a CJK-only row tops out near 150
characters. That sits at the cheap end of the table (single-digit to tens of ms). The 10,000-char
worst case the tradeoff comment cites cannot occur in a `HitRow` at any terminal width, so the
comment's own "accepted, and fine here" holds up under measurement. Segmenter memoization is a
non-goal for F10 (spec Non-goals).

**Watch-item, with its shape pre-agreed.** The real amplifier is not `clustersOf` itself but
`selection.ts`'s word-select outward walk (`wordSpan`, ~`:99-116`): it steps outward one column at a
time and every `columnToChar`/`charToColumn` call re-runs `clustersOf(row.text)` from scratch. Today
that is bounded and gesture-triggered (tens of ms once per double-click), which matches the code's
stated cost model. It stops being bounded if a future feature calls the same walk per row per frame
during a drag. If that lands, the fix is a per-`HitRow` cache — `WeakMap<HitRow, Array<[number,
number]>>` keyed on the row object, or compute the cluster array once and pass it into
`columnToChar`/`charToColumn` instead of recomputing inside them — which turns repeated calls
against one row from O(n²) each into O(n²) once plus O(n) per lookup. Do not build it before that
caller exists.

### T-MAINT acceptance

Spec cell 13, verbatim:

> 13. **Maintenance**: prefs read once (spy); notice deadline cells (2999/3001/never/reject/
>     unmount); legacy history line parses; comment/parity corrections committed.

- **prefs read once (spy)** — `test/unit/cli-main.test.ts:414`, "reads prefs exactly ONCE per
  launch, however many gates ask for it"; `:426` "a headless -p launch reads prefs zero times".
  Both pass in this session's `test:unit` run.
- **notice deadline cells (2999/3001/never/reject/unmount)** — `test/tui/auto-mode-notice.test.tsx`:
  `:265` "account facts landing at 2999 ms from arming win: the OAuth variant, with no cost
  sentence", `:281` "account facts landing at 3001 ms are too late: the deadline already fell back
  to the unknown arm", `:296` "a handshake that never completes falls back AT the deadline, not
  before it and not never", `:312` "a REJECTING handshake falls back immediately", `:326`
  "unmounting between the delay and the answer cancels: nothing is appended, nothing is left
  parked" — all five on fake timers, all pass. `ACCOUNT_LABEL_BUDGET_MS === 1500` and the
  one-timer banner-race pin (`:114`, `:124`) are untouched and still green.
- **legacy history line parses** — `test/unit/prompt-history.test.ts:230`, "reads a LEGACY on-disk
  line carrying upstream's optional mediaType/filename, and hydrates it" (raw line planted via
  `rawLines`, bypassing `appendHistory` entirely). Passes.
- **comment/parity corrections committed** — the stale `previewTail`/`PREVIEW_ROWS` comments in
  `test/tui/sessionPickerModel.test.ts` were rewritten in T3 (a8b90f9ae2); `grep -in
  "previewTail\|PREVIEW_ROWS"` on that file returns nothing, confirmed again this session. This
  task additionally fixed the one-character Minor T3's own review flagged: line 7's rewritten
  comment ended `records the retirement))` with one stray extra `)`; now reads `records the
  retirement)`.
- Beyond the cell, also landed and re-verified this session: the layering cut
  (`src/media/imageDims.ts` — `pngDimensions`, `jpegDimensions`, `POST_PROCESS_BYTE_BUDGET`,
  `MAX_DIMENSION`, `MAX_IMAGES_PER_PROMPT`; five exports, zero imports); the hitmap
  `kind === "line"` assertion (`test/tui/hitmap.test.ts:50`); the `resumeInto` no-history-found
  guard on both routes (`test/tui/useChat.test.tsx:559` empty-read, `:571` throwing-read via
  `getSessionMessages` rejecting).
- Gates run this session from `CC-to-SDK/harness`, all foreground, all clean/green:
  `npm run typecheck` (clean), `npm run build` (clean; `dist/media/imageDims.d.ts` and `.js` both
  resolve in the emitted tree), `npm run test:unit` (241 files / 3338 tests passed), `npm run
  test:tui` (171 files / 4179 tests passed, 9 skipped — the `test/tui/live/*.e2e.test.ts` files,
  which gate on `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` and are out of scope for this track).
  No keyed live cells and no pty cells are in scope for this track.

### T-MAINT track closed

All four tasks (items 1-8) landed: item 1 (3c98f2c6a5), item 3 (6414e9c2a9), items 2/4-7
(a8b90f9ae2), item 8 evidence-only (this entry) plus the sessionPickerModel.test.ts stray-paren
fix. Spec acceptance cell 13 met in full, verified live this session, not carried forward from the
plan.
