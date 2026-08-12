# Fullscreen renderer on a live-window substrate — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: doperpowers:subagent-driven-development. Steps use
> checkbox syntax. Spec: `docs/superpowers/specs/2026-08-12-fullscreen-live-window-design.md`
> (v2 — read the spec section named in your task). Groundings:
> `docs/superpowers/grounding/2026-08-12-{fullscreen,reflow}-ground.md`.

**Goal:** claude's alternate-screen renderer in ccx on a shared live-window substrate; the main
screen gains reflow over the window's rows (s2qa2-06).

**Architecture:** M1 moves the main screen's rendering boundary from "commit every finalized item
to `<Static>` immediately" to "render a bounded tail of whole items live; commit only what leaves
the window". M2a/M2b add the second renderer: alt-screen lifecycle with a crash-safe exit, a
fixed-height frame whose transcript region is a virtualized scroll view over the whole document
(no `<Static>` at all), painted by stock Ink log-update at `rows − 1` wrapped in DECSET 2026.
M3 lands surfaces, `/tui` remount switching, and the default-ON flip gated on pinning every
existing tmux cell.

**Tech stack:** stock Ink 5.2.1 (no fork), React, vitest + ink-testing-library, tmux driver.

## Global constraints (bind every task)

- **Frame ≤ `rows − 1` physical rows, both renderers, always** (Ink's tall-frame cliff at
  `ink.js:121` and the log-update trailing `'\n'` — spec "two hard constraints").
- **The wave-2 corrections must stay reachable on the main screen**: after any M1 task,
  `output.lastFrame()` is non-undefined in steady state and the a3 matrix cell's reflow verdict
  still caches. Never extend `selfWriting` to Ink's own writes.
- Fullscreen constructs NO main-screen residue machinery (no park, no frame corrector, no
  resize-repaint, no reflow probe) — spec §A2a.
- Style per `harness/CLAUDE.md`: dense hand-style, ESM `.js` specifiers, DI-by-deps, TDD
  (red first, watch it fail). All commands from `harness/`.
- Never touch `src/appserver/` (concurrent session). `scripts/resize-matrix.sh` only where a task
  names it. Never edit any `progress.md`. Commit per task, plain message, NO attribution, never
  push. Live/tmux work: isolated HOME under literal `/tmp` + `CCX_FLEET_ROOT`, prefs-mtime
  assertion, prefixed sessions killed individually, token via `set -a; . ../.env; set +a`, never
  printed.
- Canon literals are verified against `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js` at
  the cited line before use, byte-for-byte.

---

### Task 1: The live-window selector (pure model)

**Files:** Create `src/tui/liveWindow.ts`, `test/unit/live-window.test.ts`.

**Interfaces — Produces:**
```ts
export interface LiveWindowResult { window: readonly RenderItem[]; commit: readonly RenderItem[] }
/** Smallest suffix of WHOLE items whose summed renderItemHeight ≥ targetRows, hard-capped at
 *  capRows; everything before the suffix is `commit`. An item alone taller than capRows goes to
 *  `commit` (recorded divergence: excluded from reflow). */
export function selectLiveWindow(items: readonly RenderItem[], targetRows: number, capRows: number): LiveWindowResult;
/** capRows for the main screen: max(0, rows - MAIN_DOCK_BUDGET - WINDOW_SLACK). */
export const WINDOW_SLACK = 2;
export const MAIN_DOCK_BUDGET = 8; // conservative, TranscriptPager rows-10 precedent
export function mainWindowCap(rows: number): number;
```
Reuses `renderItemHeight` from `./pager.js` (pager.ts:43).

- [ ] **Step 1 — red:** tests: suffix selection stops at whole-item edges; total window rows never
  exceed capRows (property-style over random item heights); an item taller than capRows is
  committed whole and the window continues below it; empty input → both empty; targetRows ≥
  capRows degenerates to cap-bounded.
- [ ] **Step 2:** implement; `npx vitest run test/unit/live-window.test.ts` green.
- [ ] **Step 3:** commit `f5(fsw-t1): the live window selects whole items under a hard cap`.

### Task 2: The scroll-anchor reducer (pure, canon's three rules)

**Files:** Create `src/tui/scrollAnchor.ts`, `test/unit/scroll-anchor.test.ts`.

**Interfaces — Produces:**
```ts
export interface AnchorState { offset: number; sticky: boolean }
export type AnchorEvent =
  | { kind: "content"; total: number; height: number }          // content grew/shrank or re-wrapped
  | { kind: "scroll"; action: PagerAction; total: number; height: number }
  | { kind: "stickBottom"; total: number; height: number };     // pill / ctrl+end / scroll:bottom
export function applyAnchor(s: AnchorState, e: AnchorEvent): AnchorState;
```
Canon rules (bundle L179827-179836, grounding §3.4): sticky ⇒ `offset = max(0, total − height)`
on every content event; an explicit scroll away from bottom sets `sticky: false` and never yanks
back on later content; `stickBottom` re-sticks. `applyPager` (pager.ts:33) computes scroll moves.

- [ ] **Step 1 — red:** the three canon rules as named tests + "typing while scrolled up does not
  snap back" (content event with sticky:false leaves offset) + re-wrap event (same total name,
  new height) re-derives the offset when sticky.
- [ ] **Step 2:** implement; green. Commit `f5(fsw-t2): the anchor follows the tail only while you are on it`.

### Task 3: Two-stage reconcile — the main screen renders a live tail

**Files:** Modify `src/tui/useChat.ts` (reconcile :854-868, initial publish :247-251,
replaceDocument :1019-1022), `src/tui/Transcript.tsx`, `src/tui/ChatApp.tsx:775` (pass rows).
Test `test/tui/live-window-mainscreen.test.tsx` (new), existing `test/tui/chat.test.tsx` and
`test/tui/f1-frame-parity.test.tsx` must stay green.

**Interfaces — Consumes:** `selectLiveWindow`/`mainWindowCap` (T1). **Produces:** `ChatState`
gains `windowItems: readonly RenderItem[]` replacing the render role of `pendingItems`
(pendingItems remain the projectPending output; windowItems = window(finalized) ⧺ pendingItems).

Mechanics: `reconcile()` runs `selectLiveWindow(finalized, target, cap)`; items in `commit` that
are not yet in `publishedIds` are appended to `staticItems` (publishedIds STAYS the authority —
spec §A1); `window` items render live in `Transcript` between `<Static>` and streaming. The
initial-publish path (:247) uses the same split (do not publish the whole history at mount —
publish `commit`, window the tail). `replaceDocument` unchanged in shape (epoch bump + empty
document). **Render-time assertion:** if projected window rows + a measured dock estimate exceed
`rows − WINDOW_SLACK`, drop oldest window items to `commit` until it holds (self-clamping in
reconcile, unit-pinned — never throws in production).

- [ ] **Step 1 — red:** ink-testing-library: finalized items beyond the window commit to Static
  exactly once (no dupes across reconciles — id census on frames); window items re-render live;
  an item leaving the window mid-session commits and never re-renders; the taller-than-cap item
  commits whole; count invariants from `session-picker`/transcript tests unaffected.
- [ ] **Step 2:** implement; the two named existing suites green unmodified (they pin Static
  append-only semantics — if one genuinely pins "publish immediately", update it DELIBERATELY and
  record in the report).
- [ ] **Step 3:** full `npm run test:tui`. Commit `f5(fsw-t3): the main screen renders a live tail and commits what leaves it`.

### Task 4: Reflow at width change + the corrections-reachable gate

**Files:** Modify `src/tui/useChat.ts` (a width-keyed re-projection of window items — reconcile
re-runs on settled column change; published items untouched), `scripts/resize-matrix.sh` (ONE new
cell, named `m1`, plus steady-state growth assertions — this task is the plan's sanctioned matrix
edit). Test: extend `test/tui/live-window-mainscreen.test.tsx`.

- [ ] **Step 1 — red (unit):** drive a column change through ChatApp's size state
  (`resize-state.test.tsx`'s `fire()` pattern :292-300): window items' lines re-wrap to the new
  width (assert a long line's wrap count changes); `staticItems` (committed) are byte-identical
  before/after.
- [ ] **Step 2 — the gate (live, keyed):** `m1` cell in the matrix: steady-state streaming at
  80×24, 80×40, 120×24 — `capture-pane -S -` line growth stays flat (tall branch never taken;
  the matrix's own :429 method); after a width shrink, the a3 cell's existing assertions still
  pass AND the cell additionally asserts the frame record is alive (needle on the debug seam or
  a `lastFrame`-driven observable — the a3 instrument's comment block documents how it proves
  preconditions; follow it). Keyed run: 10/10 (9 existing + m1).
- [ ] **Step 3:** keyless matrix still green (m1 skips or runs keyless if it needs no model turn —
  prefer a keyless m1 via `--fake-turn` if the driver supports one; otherwise keyed-only, skipping
  clean). Commit `f5(fsw-t4): the window re-wraps on width change and the corrections stay awake`.

### Task 5: Renderer selection with provenance + `/status` line

**Files:** Create `src/tui/renderer.ts`, `test/unit/renderer-select.test.ts`. Modify
`src/tui/prefs.ts` (add `tui?: "fullscreen" | "default"` to `CcxPrefs` :43), the `/status`
formatter (find it in `src/tui/commands.ts` — the wave-2 statusEffort precedent), `chatMain.tsx`
boot (:375 area) to compute the selection ONCE.

**Interfaces — Produces:**
```ts
export type RendererMode = "fullscreen" | "classic";
export interface RendererChoice { mode: RendererMode; reason:
  "not_tty" | "screen_reader" | "env_off" | "env_on" | "tmux_cc_off" | "win_ssh_off"
  | "settings_on" | "settings_off" | "default_on" }
export function selectRenderer(deps: { isTTY: boolean; env: NodeJS.ProcessEnv; prefs: CcxPrefs }): RendererChoice;
```
Order (spec §A2, exact): not-TTY → screen reader (`CLAUDE_CODE_SCREEN_READER` truthy — mirror
canon's `kR()` semantics as far as ccx can see them) → env off
(`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` set, or `CLAUDE_CODE_NO_FLICKER === "false"|"0"`) → env
on (`CLAUDE_CODE_NO_FLICKER` truthy) → tmux `-CC` heuristic (cheap half only: `TMUX` set +
`TERM_PROGRAM === "iTerm.app"` + `TERM` not `screen*`/`tmux*` — no shell-out) → Windows-over-SSH
→ `prefs.tui` → `default: fullscreen`.

- [ ] **Step 1 — red:** one test per rung pinning ORDER (env-on does NOT beat non-TTY or screen
  reader; settings beats default; env beats settings), plus the F11 semantics (non-TTY wins over
  everything).
- [ ] **Step 2:** implement; `/status` gains `renderer: fullscreen (default_on) · corrections: main-screen stack` —
  the correction-stack half reads which stack chatMain constructed (T8 wires the fullscreen
  value; hardcode "main-screen stack" until then with a comment).
- [ ] **Step 3:** commit `f5(fsw-t5): the renderer is chosen once, with a reason /status can name`.

### Task 6: Alt-screen lifecycle + the exit guarantee

**Files:** Create `src/tui/altScreen.ts`, `test/unit/alt-screen.test.ts`. Modify
`src/cli/main.ts:402-405` (the signal interlock), `src/tui/chatMain.tsx` (finally :470-477 grows
the alt exit).

**Interfaces — Produces:**
```ts
export const ENTER_ALT: string;           // ESC[?1049h ESC[2J ESC[H
export const EXIT_ALT: string;            // kitty pop + ESC[?1049l + modifyOtherKeys reset
export function kittyUpgrade(termProgram: string | undefined): string; // canon's 7-terminal list L177175, else ""
export const MOUSE_OFF: string;           // ESC[?1006l ?1003l ?1002l ?1000l
export interface AltScreenGuard { enter(): void; exit(): void; installSignalSafety(): () => void; active(): boolean }
export function createAltScreenGuard(deps: { writeSync(s: string): void; termProgram?: string }): AltScreenGuard;
```
`installSignalSafety` registers SIGINT (new — ccx has none; REPL ctrl+c is raw-mode bytes,
bindings.ts:42) and hooks ahead of `cli/main.ts:404`'s `onSignal` (which `process.exit`s and
skips finallys): the guard's synchronous cleanup — MOUSE_OFF first, then exit-alt with a
hand-written rmcup fallback, then cursor-show — runs BEFORE `host.stop`. Restructure `onSignal`
to call an injected `beforeExit: Array<() => void>` (chatMain registers the guard; main.ts owns
the array). Exit ordering rule: never any paint after rmcup (spec §A6).

- [ ] **Step 1 — red:** byte-sequence tests (enter/exit exact, kitty gated on the 7 terms);
  ordering test (a throwing unmount still gets MOUSE_OFF then rmcup — spy on writeSync call
  order); signal test (emit SIGTERM on a stub process — cleanup writes precede `host.stop`).
- [ ] **Step 2:** implement; the guard is constructed but only ARMED when T8 selects fullscreen.
- [ ] **Step 3:** commit `f5(fsw-t6): the alt screen cannot outlive the process — mouse off first, rmcup by hand if needed`.

### Task 7: Driver additions (pre-M2b instrument work)

**Files:** Modify `docs/parity/qa-driver.md` (document `alternate_on`, `cursor_flag`, the
live-shell-after-exit pattern `sh -c '… ; exec sh'` with `remain-on-exit off`, and ccx's new env
pins from T5); no product code.

- [ ] **Step 1:** write the sections; cite T5's env spellings; note raw-mode/bracketed-paste have
  no tmux format variable (typed-echo assertion instead).
- [ ] **Step 2:** commit `f5(fsw-t7): the driver can see the alt screen and prove a terminal survived`.

### Task 8: The frame shell + paint model + machinery gating

**Files:** Create `src/tui/FullscreenFrame.tsx`, `test/tui/fullscreen-frame.test.tsx`. Modify
`src/tui/chatMain.tsx` (the mode root above ChatApp — `render()` :457 wraps
`<RendererRoot choice=…>`; fullscreen constructs NO resize-repaint/corrector/park: gate
:429-447 on the choice; the output proxy gains an altMode that skips park() and wraps each
recorded frame write in DECSET 2026 `\x1b[?2026h`/`\x1b[?2026l`), `src/tui/ChatApp.tsx` (accepts
`renderer: RendererChoice` and, in fullscreen, renders inside the frame with no `<Static>` —
T9 wires the viewport).

**Frame contract (spec §A4/§A4a):** total height `rows − 1`; transcript region `flexGrow:1`;
dock `flexShrink:0` capped `floor(rows/2)` (`rows−2` in history search); two overlay slots
(absolute-bottom seam slot capped `rows−2`; dock-replacement); resize = full repaint
(erase-before-paint one-shot flag on the proxy, re-render — D21). Reusable: the frame takes
`{regionChildren, dock, overlay}` props (the `/resume` launcher mounts it later, M4).

- [ ] **Step 1 — red:** ink-testing-library: frame renders exactly `rows − 1` lines at 3 sizes;
  dock cap holds when the composer wants more; overlay slot clips at `rows−2`; the proxy's
  altMode wraps writes in 2026 begin/end and never parks (unit, RecordingTerminal pattern from
  `test/unit/resume-safe-stdout.test.ts`).
- [ ] **Step 2:** implement; classic path byte-identical (the 26 ChatApp suites untouched — the
  root sits above ChatApp, spec I8).
- [ ] **Step 3:** commit `f5(fsw-t8): a fixed-height frame painted atomically, with the main-screen machinery left outside`.

### Task 9: The fullscreen viewport — the whole document, virtualized

**Files:** Modify `src/tui/ChatApp.tsx` + create `src/tui/FullscreenViewport.tsx`,
`test/tui/fullscreen-viewport.test.tsx`.

**Interfaces — Consumes:** `applyAnchor` (T2), `pageItemSlices`/`applyPager` (pager.ts),
`projectCompact` + `projectPending` (toolRenderer). In fullscreen there are NO staticItems: the
viewport renders `pageItemSlices(allItems, anchor.offset, regionRows)` where `allItems` =
full projection ⧺ pending ⧺ streaming-as-item; the anchor reducer owns offset/sticky.

- [ ] **Step 1 — red:** short content top-aligns (blank rows below content, dock pinned —
  the 80×40 anchor test); overflow tail-follows on append while sticky; scrolled-up + append
  does not move; re-stick on `stickBottom`; slices honor item boundaries via existing
  `RenderItemView start/end`.
- [ ] **Step 2:** implement; wire ChatApp fullscreen branch: `<FullscreenFrame regionChildren={<FullscreenViewport …/>} dock={composer+footer} …/>`.
- [ ] **Step 3:** commit `f5(fsw-t9): fullscreen scrolls a virtual transcript, anchored to its tail`.

### Task 10: Scroll keys, the pill, ctrl+O in-frame, the editor escape

**Files:** Modify `src/tui/keys/bindings.ts` (the `Scroll` context — exists in VALID_CONTEXTS
:28 with no defaults — gains `pageup/pagedown` → `scroll:halfPageUp/Down` semantics via NEW
actions `scroll:viewHalfUp/Down`… no: bind `pageup: "scroll:halfPageUp"`, `pagedown:
"scroll:halfPageDown"`, `ctrl+home: "scroll:top"`, `ctrl+end: "scroll:bottom"` — per-context
half-page WITHOUT touching PAGER_ACTIONS or the Transcript context, spec I11), create
`src/tui/JumpPill.tsx`, wire `useKeyScope("Scroll", { active: fullscreen && !historySearchOpen })`
in FullscreenViewport, `v` in the Transcript context opens the transcript dump (new
`src/tui/transcriptDump.ts`: render all messages to `cc-transcript-<ts>.txt` under tmpdir, open
`$VISUAL`/`$EDITOR` via the composer's existing spawnSync editor seam). TranscriptPager mounts
inside the frame's region (its own height budget respects the region).

- [ ] **Step 1 — red:** binding-table pins (Scroll context rows; Transcript context UNCHANGED —
  the grandfathered-collision census will catch drift); pill renders only when `!sticky && !atEnd`
  with the canon labels; half-page moves `floor(regionRows/2)`.
- [ ] **Step 2:** implement + `test/tui/keys-bindings.test.ts` census updates (deliberate).
- [ ] **Step 3:** commit `f5(fsw-t10): scrolling you can see — half pages, a pill home, and a way out to your editor`.

### Task 11: Fullscreen surface deltas (D1, D11-D14)

**Files:** Modify `src/tui/Footer.tsx` (D1: when fullscreen && statusLineConfigured && text
empty/undefined → one blank row instead of collapsing — the :140 gate branches on renderer;
D12 paddingRight 2→1 in fullscreen; D13 focus chip), `src/tui/ChatApp.tsx` (D11 suppress the
notification block in fullscreen; D14 queued prompts render at the viewport tail), tests in the
respective suites.

- [ ] **Step 1 — red:** D1 both arms (configured-unresolved holds a row in fullscreen, collapses
  classic; unconfigured renders nothing in both); D11/D12/D13/D14 pins.
- [ ] **Step 2:** implement. Commit `f5(fsw-t11): the fixed frame stops rows from shoving — the statusLine holds its seat`.

### Task 12: `/tui` — remount switching + attach rules

**Files:** Modify `src/tui/commands.ts` (the `/tui [default|fullscreen]` command: persist
`prefs.tui` via savePrefs, refuse while `state.bgTasks.length > 0` with canon's copy L482600
byte-verified, then flip the mode root), `src/tui/chatMain.tsx` (the root re-renders on a mode
state change — remount = React subtree swap, ONE Ink instance; entering fullscreen arms the T6
guard + enters; leaving runs exit before the classic subtree mounts), attach: `/tui` in an
attached client remounts locally only. Test `test/tui/tui-switch.test.tsx`.

- [ ] **Step 1 — red:** switch preserves ChatState (the conversation — document survives; the
  test asserts transcript content present after both flips); refuse-while-busy prints canon's
  copy; terminal-mode bytes on the flip are exactly exit-then-nothing / enter-then-frame
  (RecordingTerminal order pin); `fullStaticOutput` safety — after classic→fullscreen, no write
  contains the committed transcript (the I8 hazard pin).
- [ ] **Step 2:** implement. Commit `f5(fsw-t12): /tui swaps the renderer in place and refuses to drop your background work`.

### Task 13: Default flip + the corpus pinning sweep

**Files:** Modify `src/tui/renderer.ts` (nothing — default already fullscreen; this task REMOVES
the temporary default-off override if T8 shipped one), `scripts/resize-matrix.sh` (launch lines
gain the classic pin env; header records classic-only), `docs/parity/qa-driver.md` (ccx launch
line pins), every `test/tui` helper that mounts ChatApp with an implicit renderer expectation
(the root is above ChatApp so the corpus SHOULD be untouched — this step verifies that claim:
full `test:tui` green with default ON), D10: the command palette hoists to the overlay slot in
fullscreen (`src/tui/ChatComposer.tsx` popup placement branches on renderer).

- [ ] **Step 1:** flip + pin + sweep; full `npm run test:tui` + `npm run test:unit` + keyless
  matrix green; keyed matrix 10/10.
- [ ] **Step 2 — red for D10:** palette in fullscreen renders above the dock (absolute), not
  inline.
- [ ] **Step 3:** commit `f5(fsw-t13): fullscreen by default; every instrument now says which renderer it measures`.

### Task 14: Final verification — the spec's acceptance as written

**Files:** none (evidence only; report to the SDD dir).

- [ ] **Step 1:** full gates: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`,
  `npm run build`, keyless + keyed matrix. Record numbers.
- [ ] **Step 2:** run **F1–F11 from the spec AS WRITTEN** (spec "Acceptance" section — quote each
  cell verbatim in the report) in the isolated-HOME tmux harness per the driver, with T7's
  additions. Keyed cells over the OAuth token. F5/F5b use the live-shell pattern; F10 seeds the
  isolated ccx home's settings with the sleeping statusLine command; F6 re-runs pinned-classic.
- [ ] **Step 3:** any cell that cannot run as written is a FINDING (spec drift or defect) —
  report, do not reinterpret. Evidence to `$CLAUDE_JOB_DIR/tmp/fsw-F*.txt`.

---

## Self-review notes (writing-plans checklist)

- Spec coverage: A1→T1/T3/T4; A2→T5; A2a→T5/T8; A3→T6; A4/A4a→T8; A5→T10; A6→T6/T14(F4);
  A7→T12; A8→T11/T13(D10); M0 driver debts→T7; acceptance→T14. Deferred list untouched by any
  task (checked).
- Type consistency: `RendererChoice` (T5) consumed by T8/T12/T13; `AnchorState/applyAnchor` (T2)
  by T9; `selectLiveWindow` (T1) by T3. `windowItems` naming consistent T3→T4.
- Spec drift found while planning: none blocking; one clarification adopted silently — the spec's
  "sticky prompt chip's row" phrasing in §A4 describes canon; ccx defers the chip (A8) so the
  spare top row stays paddingTop. Recorded here, not a spec edit.
- Placeholder scan: clean (every step names files, assertions, and commands).
