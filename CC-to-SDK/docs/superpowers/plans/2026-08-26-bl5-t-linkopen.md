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
styled row text (universal source) alongside the existing FoldClause ranges; (2) a new `src/tui/linkOpen.ts`
module holding the pure gate decision + allowlist + spawn wrapper; (3) release-path wiring in
`FullscreenViewport.tsx` arming an injectable 500 ms timer, cancelled by multi-click.

**Global constraints** (verbatim):
- Scheme allowlist, canon's 12 entries exactly: `https:` `http:` `vscode:` `vscode-insiders:` `cursor:`
  `windsurf:` `zed:` `jetbrains:` `idea:` `slack:` `linear:` `notion:` `figma:`.
- Gate (all must hold): NOT `TERM_PROGRAM === "vscode"`; AND (`event.alt || event.ctrl`) OR
  (`platform === "darwin"` AND `TERM_PROGRAM` ∈ {`ghostty`, `WarpTerminal`}); alt-screen implicit at this
  seam. Headless-linux refusal in the opener: `platform === "linux" && !DISPLAY && !WAYLAND_DISPLAY`.
- Delay constant 500 ms (canon `pE=500`), injectable clock/timers, cancelled by double/triple-click.
- `file:` URLs: NO-OP (spec D6). Bare un-linked URLs: OUT OF SCOPE (spec D3). No XTVERSION probe (D5).
- Expansion precedence unchanged: a click inside a link span NEVER toggles `expandedItems` (the existing
  resolver guard at `FullscreenViewport.tsx:437-444` stays).
- Opener spawn mirrors `copy.ts`: fire-and-forget `spawn`, `stdio: ["ignore","ignore","ignore"]`,
  `$BROWSER` override then darwin `open` / linux `xdg-open`; injectable spawn (DI-by-deps) so unit tests
  never spawn.
- Commands from `harness/`: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`, targeted
  `npx vitest run …`. NEVER bare `npm test`. Commit per task, no Co-Authored-By. FOREGROUND test runs only.
- pty e2e: SGR mouse bytes MUST be sent from a SAVED SCRIPT FILE (inline Bash-tool sends drop the tap);
  private tmux socket; kill only sessions you created, by name.

### Task 1: universal OSC 8 link-span recovery
**Files:** Modify `src/tui/mouse/hitmap.ts`; Test `test/tui/hitmap.test.ts` (or the existing hitmap suite
— locate with `grep -rl linkRangesOf test/`).
**Produces:** `linkRangesOf(line)` returns spans for BOTH sources: the existing FoldClause-derived ranges
AND spans parsed from embedded `\x1b]8;;<href>\x07…\x1b]8;;\x07` in the row's styled text (see
`src/tui/osc8.ts` for the emitters' exact byte shape; `markdownInline.ts:66` writes the prose form).
Offsets stay in SGR-stripped character space — the existing `columnToChar` contract is unchanged; an OSC 8
sequence contributes ZERO characters to that space. When both sources cover the same span, dedupe
(identical `{start,end,href}` appears once). Steps (TDD): failing cells — a marked-rendered prose row with
one link yields one span with the right href and char offsets; a row with two links; a fold row keeps its
existing ranges; a mixed row dedupes; `columnToChar` through a row containing OSC 8 still maps correctly.
Implement; targeted run; commit `bl5 T-LINKOPEN task 1: OSC 8 spans recovered on every row kind`.

### Task 2: `linkOpen.ts` — gate decision + opener
**Files:** Create `src/tui/linkOpen.ts`; Test `test/unit/linkOpen.test.ts` (pure module — unit suite, not tui).
**Produces:**
- `shouldOpenOnClick(mods: {alt: boolean; ctrl: boolean}, env: {TERM_PROGRAM?: string}, platform: NodeJS.Platform): boolean` — the gate truth table above, pure.
- `classifyLinkUrl(url: string): {kind: "open"} | {kind: "file-noop"} | {kind: "refused"; scheme: string}` —
  URL-parses (unparseable → refused), `file:` → file-noop, allowlist → open, else refused.
- `openUrl(url: string, io?: {spawn?; env?; platform?; warn?}): void` — classify; refused → `warn(
  "[hyperlink] refusing to dispatch clicked link with non-allowlisted scheme " + scheme)` (canon's copy),
  no spawn; file-noop → nothing; open → headless-linux guard then spawn `$BROWSER || open|xdg-open`.
Steps (TDD): failing cells for the full truth table {vscode, plain, alt, ctrl, ghostty-plain darwin,
warp-plain darwin, ghostty-plain linux (no modifier → false), headless linux spawn-refusal}, allowlist
accept/refuse per scheme incl. `javascript:` and `data:` refused, `$BROWSER` override wins, spawn args
exact; implement; targeted run; commit `bl5 T-LINKOPEN task 2: gate + allowlisted opener`.

### Task 3: release-path wiring + 500 ms defer + multi-click cancel
**Files:** Modify `src/tui/FullscreenViewport.tsx`; Test the existing viewport interaction suite (locate
with `grep -rl clickTargetAt test/tui/`).
**Consumes:** Task 1 spans (via the hitmap the viewport already holds), Task 2 `shouldOpenOnClick`/`openUrl`.
**Produces:** on the RELEASE that completes an unhandled click (the resolver returned `undefined`) whose
release cell sits inside a link span, and the gate passes: arm ONE 500 ms timer (injectable timers — find
the viewport's existing clock injection; if none, thread `io.setTimeout`/`clearTimeout` props defaulting to
globals) that calls `openUrl(href)`; a second/third click before it fires (`multiClickSelectionAt`, :629)
clears it. A gated link click must not toggle expansion (already guaranteed by the resolver guard — add
the regression cell anyway); a plain (ungated) link click stays a pure no-op. Only ONE pending timer ever
exists; a new armed link click replaces a pending one (canon clears before re-arming).
Steps (TDD): fake-timer cells — alt-click on link span opens exactly once after 500 ms; double-click
within 500 ms → zero opens; plain click → zero opens and zero timers; alt-click on a NON-link cell of a
clickable owner → toggles expansion, zero opens; vscode TERM_PROGRAM → zero opens. Implement; targeted
run; commit `bl5 T-LINKOPEN task 3: deferred gated open wired into release`.

### Task 4: pty e2e — real-binary acceptance + hover-suppression fold-in
**Files:** Create/extend the tui e2e under `test/tui/` (locate the bl4 C9 pty harness precedent:
`grep -rl tmux test/tui/ | head`); a recorder script fixture (e.g. `test/fixtures/browser-recorder.sh`
writing `$1` to a temp file).
**Cells:**
1. Run built ccx in a private tmux socket with `BROWSER=<recorder>` and `TERM_PROGRAM=iTerm.app`; render a
   turn containing a markdown link; ALT-click it via a SAVED SCRIPT FILE of SGR bytes; assert the recorder
   received the exact URL within ~2 s (500 ms defer + slack).
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
