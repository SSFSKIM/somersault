# T-LINKOPEN Implementation Plan — canon 2.1.246 link-click opening

> **For agentic workers:** REQUIRED SUB-SKILL: doperpowers:subagent-driven-development, one fresh
> implementer per task. Spec: `docs/superpowers/specs/2026-08-26-bl5-linkopen-sniff-design.md`
> (§T-LINKOPEN — the canon contract and Decision Log D3-D7 govern scope). Canon evidence with byte
> offsets: `.doperpowers/sdd/2026-08-26-bl5-round/research-links.md` — read §3 before touching dispatch.

**Goal:** clicking a transcript link opens it exactly as canon 2.1.246 does — modifier/terminal-gated,
500 ms deferred and multi-click-cancellable, scheme-allowlisted, `$BROWSER || open` — while link spans
become visible to the resolver on EVERY row kind (prose markdown links included), and expansion
precedence is untouched.

**Architecture:** (1) generalize link-span recovery in `mouse/hitmap.ts` to parse embedded OSC 8 from
styled row text (universal source) alongside the existing FoldClause ranges, and move link resolution
AHEAD of the fold-anchor answer in `clickTargetAt`; (2) a new `src/tui/linkOpen.ts` module holding the
pure gate decision + allowlist + spawn wrapper; (3) dispatch wiring in `ChatApp.tsx`'s single
`useMouseSink` — the production mouse owner, which today drops every modified click — through a new
href-bearing viewport query, arming an injectable 500 ms timer cancelled by multi-click; window-activation
presses (focus-in immediately before) never open.

**Global constraints** (verbatim):
- Scheme allowlist, canon's 12 entries exactly: `https:` `http:` `vscode:` `vscode-insiders:` `cursor:`
  `windsurf:` `zed:` `jetbrains:` `idea:` `slack:` `linear:` `notion:` `figma:`.
- Gate (all must hold): NOT `TERM_PROGRAM === "vscode"`; AND NOT a window-activation press (the press
  whose immediately preceding parsed input event was terminal focus-in `ESC[I` — DECSET 1004 is already
  armed by `altScreen.ts:201` and `keys/parse.ts:132` already recognizes the event); AND
  ((`event.alt || event.ctrl`) OR (`platform === "darwin"` AND `TERM_PROGRAM` ∈ {`ghostty`,
  `WarpTerminal`})); alt-screen implicit at this seam. The xterm.js/isVscodeTerm stand-down terms of
  canon's `ue()` are PARKED (spec D5) — this gate is a PARTIAL transcription, per spec. Headless-linux
  refusal in the opener: `platform === "linux" && !DISPLAY && !WAYLAND_DISPLAY`.
- Delay constant 500 ms (canon `pE=500`), injectable clock/timers, cancelled by double/triple-click.
- `file:` URLs: NO-OP (spec D6). Bare un-linked URLs: OUT OF SCOPE (spec D3). No XTVERSION probe (D5).
- Link-before-fold precedence (plan-review F2): `clickTargetAt` currently answers `"fold:"+anchor` BEFORE
  examining `linkRanges`, so a link cell on a T-PRLINK fold row toggles the fold. Canon defers to the
  hyperlink FIRST. The resolver must resolve link spans AHEAD of the fold-anchor return: a link-cell click
  on ANY row kind (fold row, item row) resolves to NO target — plain click is a pure no-op, gated click
  opens — and fold/expansion toggles fire only from non-link cells.
- Opener spawn mirrors `copy.ts`: fire-and-forget `spawn`, `stdio: ["ignore","ignore","ignore"]`,
  `$BROWSER` override then darwin `open` / linux `xdg-open`; injectable spawn (DI-by-deps) so unit tests
  never spawn.
- Commands from `harness/`: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`, targeted
  `npx vitest run …`. NEVER bare `npm test`. Commit per task, no Co-Authored-By. FOREGROUND test runs only.
- pty e2e: SGR mouse bytes MUST be sent from a SAVED SCRIPT FILE (inline Bash-tool sends drop the tap);
  private tmux socket; kill only sessions you created, by name.

### Task 1: universal OSC 8 link-span recovery + link-before-fold precedence
**Files:** Modify `src/tui/mouse/hitmap.ts` AND `src/tui/FullscreenViewport.tsx` (the `clickTargetAt`
reorder only); Test `test/tui/hitmap.test.ts` (or the existing hitmap suite — locate with
`grep -rl linkRangesOf test/`) and the viewport resolver suite (`grep -rl clickTargetAt test/tui/`).
**Produces:** `linkRangesOf(line)` returns spans for BOTH sources: the existing FoldClause-derived ranges
AND spans parsed from embedded `\x1b]8;;<href>\x07…\x1b]8;;\x07` in the row's styled text (see
`src/tui/osc8.ts` for the emitters' exact byte shape; `markdownInline.ts:66` writes the prose form).
Offsets stay in SGR-stripped character space — the existing `columnToChar` contract is unchanged; an OSC 8
sequence contributes ZERO characters to that space. When both sources cover the same span, dedupe
(identical `{start,end,href}` appears once). Steps (TDD): failing cells — a marked-rendered prose row with
one link yields one span with the right href and char offsets; a row with two links; a fold row keeps its
existing ranges; a mixed row dedupes; `columnToChar` through a row containing OSC 8 still maps correctly.
ALSO (F2, same task because it is the same resolver contract): reorder `clickTargetAt` so the link-span
check runs BEFORE the `at.anchor` fold answer; failing cells — a click on a fold-row link cell resolves
`undefined` (today: `"fold:"+anchor`); a click on the same fold row's NON-link cell still resolves the
fold; item-row link cells keep resolving `undefined`.
Implement; targeted run; commit `bl5 T-LINKOPEN task 1: OSC 8 spans on every row; links resolve before folds`.

### Task 2: `linkOpen.ts` — gate decision + opener
**Files:** Create `src/tui/linkOpen.ts`; Test `test/unit/linkOpen.test.ts` (pure module — unit suite, not tui).
**Produces:**
- `shouldOpenOnClick(press: {alt: boolean; ctrl: boolean; isWindowActivation: boolean}, env: {TERM_PROGRAM?: string}, platform: NodeJS.Platform): boolean` — the gate truth table above, pure; an
  activation press answers false regardless of modifiers.
- `classifyLinkUrl(url: string): {kind: "open"} | {kind: "file-noop"} | {kind: "refused"; scheme: string}` —
  URL-parses (unparseable → refused), `file:` → file-noop, allowlist → open, else refused.
- `openUrl(url: string, io?: {spawn?; env?; platform?; warn?}): void` — classify; refused → `warn(
  "[hyperlink] refusing to dispatch clicked link with non-allowlisted scheme " + scheme)` (canon's copy),
  no spawn; file-noop → nothing; open → headless-linux guard then spawn `$BROWSER || open|xdg-open`.
Steps (TDD): failing cells for the full truth table {vscode, plain, alt, ctrl, ghostty-plain darwin,
warp-plain darwin, ghostty-plain linux (no modifier → false), WINDOW-ACTIVATION alt-click → false,
headless linux spawn-refusal}, allowlist
accept/refuse per scheme incl. `javascript:` and `data:` refused, `$BROWSER` override wins, spawn args
exact; implement; targeted run; commit `bl5 T-LINKOPEN task 2: gate + allowlisted opener`.

### Task 3: ChatApp dispatch — modified-release routing + 500 ms defer + multi-click cancel
**Files:** Modify `src/tui/ChatApp.tsx` (the `useMouseSink` at :995 — the PRODUCTION mouse owner) and
`src/tui/FullscreenViewport.tsx` (add the imperative query `linkHrefAt(col: number, row: number): string
| undefined` to the handle, resolving through the SAME painted-frame hitmap as `clickTargetAt`); plumb
window-activation provenance from the keys layer (`keys/parse.ts` emits `ignored("focus", raw)` — expose
"last event was focus-in" to the sink; smallest honest seam wins, e.g. KeymapProvider tracks it and the
sink reads it, or the focus event is threaded as state; implementer's choice, documented).
**Consumes:** Task 1 resolver order + spans; Task 2 `shouldOpenOnClick`/`openUrl`.
**Produces:** ChatApp's sink no longer blanket-drops modified clicks (plan-review F1: today
`e.ctrl || e.alt || e.shift → return` kills them before any viewport call). New flow: a modified
press records its own press-anchor (modified presses still must NOT start selections or toggle
anything); on the paired release at the same cell, if `shouldOpenOnClick(...)` passes and
`viewport.linkHrefAt(col,row)` answers a href, arm ONE 500 ms timer (injectable timers) calling
`openUrl(href)`. A Ghostty/Warp-darwin PLAIN release takes the same path (gate passes without
modifiers) AFTER the existing tap machine found no target (`clickTargetAt` answered `undefined` — link
cells now do, per Task 1). A multi-click press and a new armed link click both clear a pending timer;
only ONE pending timer ever exists. Selection/caret/fold behavior for unmodified clicks is UNCHANGED.
Steps (TDD): drive RAW SGR byte sequences through the real ChatApp sink (the false-green guard —
viewport-handle-only tests are forbidden for these cells): alt-click press+release on a link cell opens
exactly once after 500 ms (fake timers); double-click within 500 ms → zero opens; plain click on a link
cell (non-Ghostty) → zero opens, zero toggles; alt-click on a NON-link cell of a clickable owner →
zero opens AND zero toggles (canon: modified clicks never toggle); ghostty-darwin plain click on a link
cell → opens; focus-in immediately before an alt-click → zero opens; vscode TERM_PROGRAM → zero opens.
Implement; targeted run; commit `bl5 T-LINKOPEN task 3: ChatApp routes gated releases to the opener`.

### Task 4: pty e2e — real-binary acceptance + hover-suppression fold-in
**Files:** Create/extend the tui e2e under `test/tui/` (locate the bl4 C9 pty harness precedent:
`grep -rl tmux test/tui/ | head`); a recorder script fixture (e.g. `test/fixtures/browser-recorder.sh`
writing `$1` to a temp file).
**Cells:**
1. Run built ccx in a private tmux socket with `BROWSER=<recorder>` and `TERM_PROGRAM=iTerm.app`; render a
   turn containing a markdown link; ALT-click it via a SAVED SCRIPT FILE of SGR bytes; assert the recorder
   received the exact URL within ~2 s (500 ms defer + slack). ALSO one fold-row link cell: alt-click a
   T-PRLINK link inside a fold row → recorder gets the URL and the fold does NOT toggle (plan-review F2's
   pty-level proof).
2. Same harness: expand a clickable result by click; move the pointer over the expanded owner; assert NO
   hover brightening on the expanded owner (hover-suppression-while-expanded, spec fold-in), and hover on a
   different clickable owner still brightens.
Steps: build the harness run; make cells fail against a stub first where feasible (cell 1 can red-check by
pointing BROWSER at the recorder and reverting task 3's wiring locally — document the red run in the
report); commit `bl5 T-LINKOPEN task 4: pty acceptance — self-open + hover suppression`.

### Task 5: verification
From `harness/`: `npm run typecheck` && `npm run test:unit` && `npm run test:tui` all green (FOREGROUND).
Walk spec §T-LINKOPEN acceptance line by line; report the table. Confirm parked items (D3 bare-URL, D5
xtversion, D6 file:) produced NO code. Commit residue; report.
