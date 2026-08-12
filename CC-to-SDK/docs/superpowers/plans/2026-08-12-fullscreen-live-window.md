# Fullscreen renderer on a live-window substrate — implementation plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: doperpowers:subagent-driven-development. Steps use
> checkbox syntax. Spec: `docs/superpowers/specs/2026-08-12-fullscreen-live-window-design.md`
> (v2). Groundings: `docs/superpowers/grounding/2026-08-12-{fullscreen,reflow}-ground.md`.
> Plan v2 adopts ALL findings of the 2026-08-12 plan review (6 Critical / 10 Important /
> 7 Minor) — the review's prescriptions are baked into the task text below.

**Goal:** claude's alternate-screen renderer in ccx on a shared live-window substrate; the main
screen gains reflow over the window's rows (s2qa2-06).

**Architecture:** M1 moves the main screen's rendering boundary from "commit every finalized item
to `<Static>` immediately" to "commit is settle-driven in reconcile; the live window is a
RENDER-TIME derivation over the unpublished tail". M2a/M2b add the second renderer: alt-screen
lifecycle with a crash-safe exit, a fixed-height frame whose transcript region is a virtualized
scroll view over the whole document (no `<Static>`), painted by stock Ink log-update at
`rows − 1` wrapped in DECSET 2026. M3 lands surfaces, `/tui` switching as a **prop change on a
never-unmounted ChatApp**, and the default-ON flip gated on pinning every existing tmux cell.

**Tech stack:** stock Ink 5.2.1 (no fork), React, vitest + ink-testing-library, tmux driver.

## Global constraints (bind every task)

- **Frame ≤ `rows − 1` physical rows, both renderers, always** (Ink's tall-frame cliff at
  `ink.js:121`; log-update's trailing `'\n'`). Corollary (plan review I9/T12): `fullStaticOutput`
  is reset only in Ink's constructor — after a classic phase it forever holds the committed
  transcript, so the no-tall-branch guarantee is the ONLY thing preventing its replay; there is
  no in-process way to clear it.
- **The wave-2 corrections must stay reachable on the main screen**: `output.lastFrame()`
  non-undefined in steady state; the reflow verdict still caches. Never extend `selfWriting` to
  Ink's own writes.
- Fullscreen constructs NO main-screen residue machinery (no park, no frame corrector, no
  resize-repaint, no reflow probe) — spec §A2a.
- **ChatApp never unmounts on a renderer flip** (plan review C5): the mode is a prop at a stable
  element position — no `key` on ChatApp, no wrapper element that exists in only one mode.
- Style per `harness/CLAUDE.md`: dense hand-style, ESM `.js` specifiers, DI-by-deps, TDD (red
  first, watch it fail). Byte-sequence tests use LITERAL expected strings with canon lines cited
  — never compare a constant to itself (m4; the wave's fixture-derived-from-constant lesson).
- Never touch `src/appserver/`. `scripts/resize-matrix.sh` only where a task names it. Never
  edit any `progress.md`. Commit per task, plain message, NO attribution, never push. Live/tmux:
  isolated HOME under literal `/tmp` + `CCX_FLEET_ROOT`, prefs-mtime assertion, prefixed
  sessions killed individually, token via `set -a; . ../.env; set +a`, never printed.
- Canon literals verified against `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js` at the
  cited line, byte-for-byte, before use.

---

### Task 1: The live-window selector (pure model)

**Files:** Create `src/tui/liveWindow.ts`, `test/unit/live-window.test.ts`.

**Interfaces — Produces:**
```ts
export interface LiveWindowResult { window: readonly RenderItem[]; commit: readonly RenderItem[] }
/** INPUT CONTRACT: `items` are the UNPUBLISHED finalized items only (caller filters by
 *  publishedIds first — plan review C1; this is what makes the spec's one-way ratchet automatic).
 *  Selects the smallest suffix of WHOLE items whose summed renderItemHeight ≥ targetRows,
 *  hard-capped at capRows; everything before the suffix is `commit`. An item alone taller than
 *  capRows goes to `commit` (recorded divergence: excluded from reflow). */
export function selectLiveWindow(items: readonly RenderItem[], targetRows: number, capRows: number): LiveWindowResult;
export const WINDOW_SLACK = 2;
/** max(0, rows − 14): 14 = the MEASURED steady-state main-screen dock (todo panel up to
 *  5 rows + chrome, turn row, composer ≥3, footer 1 — ChatApp.tsx:776/:788/:800/:968/:1021,
 *  taskPanelModel.ts:16-18), NOT a guess (plan review C3). */
export function mainWindowCap(rows: number): number;
```
Reuses `renderItemHeight` (pager.ts:43).

- [ ] **Step 1 — red:** suffix stops at whole-item edges; window rows ≤ capRows (property-style
  over random heights); taller-than-cap item commits whole, window continues below; empty input;
  targetRows ≥ capRows degenerates to cap-bounded; input-contract doc test (published items are
  the CALLER's concern — selector is total over its input).
- [ ] **Step 2:** implement; green. Commit `f5(fsw-t1): the live window selects whole unpublished items under a hard cap`.

### Task 2: The scroll-anchor reducer (pure, canon's three rules)

**Files:** Create `src/tui/scrollAnchor.ts`, `test/unit/scroll-anchor.test.ts`.

**Interfaces — Produces:**
```ts
export interface AnchorState { offset: number; sticky: boolean }
export type AnchorEvent =
  | { kind: "content"; total: number; height: number }
  | { kind: "scroll"; action: PagerAction; total: number; height: number }
  | { kind: "stickBottom"; total: number; height: number };
export function applyAnchor(s: AnchorState, e: AnchorEvent): AnchorState;
```
Canon rules (L179827-179836): sticky ⇒ `offset = max(0, total − height)` on every content event;
explicit scroll off the bottom sets `sticky: false` and later content never yanks back;
`stickBottom` re-sticks. `applyPager` (pager.ts:33) computes moves.

- [ ] **Step 1 — red:** the three rules as named tests + "typing while scrolled up does not snap
  back" + re-wrap (same total, new height) re-derives offset when sticky.
- [ ] **Step 2:** implement; green. Commit `f5(fsw-t2): the anchor follows the tail only while you are on it`.

### Task 3: Two-stage reconcile + the render-time window

**Files:** Modify `src/tui/useChat.ts` (reconcile :854-868, initial publish :247-251), create
`src/tui/streamingItems.ts`, modify `src/tui/Transcript.tsx`, `src/tui/ChatApp.tsx` (window
derivation + `deps.rows` seam at :215 — plan review I4). Test
`test/tui/live-window-mainscreen.test.tsx` (new); `test/tui/chat.test.tsx` +
`test/tui/f1-frame-parity.test.tsx` stay green.

**Interfaces — Consumes:** `selectLiveWindow`/`mainWindowCap` (T1). **Produces (plan review C4):**
```ts
// ChatState gains:
finalizedItems: readonly RenderItem[];   // the full projectCompact output reconcile already computes at :860 — kept, not discarded
// New module src/tui/streamingItems.ts:
export function streamingItems(lines: readonly RenderLine[], width: number): readonly RenderItem[];
// pre-wraps each RenderLine to width; stable synthetic ids; renderItemHeight-honest heights
// ChatApp deps gains: rows?: () => number  (readSize consults it like deps.columns)
```

**Mechanics (the C1/C2 split — commit vs window are DIFFERENT phases):**
- **Commit (reconcile, settle-driven):** `reconcile()` computes `finalized`, filters
  `unpublished = finalized.filter(i => !publishedIds.current.has(i.id))` FIRST, runs
  `selectLiveWindow(unpublished, target, mainWindowCap(rows))`, appends `commit`'s items to
  `staticItems` (publishedIds stays the authority), stores `finalizedItems` in state. Initial
  publish (:247) uses the same split — do not publish the whole history at mount.
- **Window (render-time, ChatApp):** a `useMemo` over
  `(state.finalizedItems, published-count, size.columns, size.rows, paneOwned)` re-selects the
  window on EVERY re-render — including the ones Ink drives from its own synchronous resize
  handler — so the rows bound holds at the live width, not the settled one. **While `paneOwned`,
  the window is EMPTY** (the dialog owns the screen; ChatApp already blanks pending/streaming on
  that flag at :773 — this removes the whole dialog class from the dock budget, plan review C3).
- **Drag policy (stated):** during a narrowing drag the window may shrink WITHOUT committing —
  items simply stop rendering until settle; a transient 40-column drag does not permanently
  ratchet coverage down.

- [ ] **Step 1 — red (pin the MODEL, not the transport — plan review I3):** record
  `state.staticItems` per render via a harness spy; ids append exactly once, in projection
  order, across grow/shrink/re-render storms. ONE frame-level assert: an item that left the
  window no longer appears in `lastFrame()`. Parameterize rows over 15/24/40 via the new
  `deps.rows`. The taller-than-cap item commits whole. Never a double-render: after a terminal
  GROW, no committed item's text appears twice in the frame stream's static writes (the C1 case).
- [ ] **Step 2:** implement; the two named suites green unmodified (a genuinely
  publish-immediately pin gets updated DELIBERATELY, recorded in the report).
- [ ] **Step 3:** full `npm run test:tui`. Commit `f5(fsw-t3): commit at settle, window at render — the tail lives at the live width`.

### Task 4: Reflow + the corrections-awake gate

**Files:** Modify `src/tui/useChat.ts` (reconcile re-runs on settled column change so committed
staging keeps up), `scripts/resize-matrix.sh` (ONE new cell `m1` — this task's sanctioned matrix
edit). Test: extend `test/tui/live-window-mainscreen.test.tsx` + new
`test/tui/live-window-proxy.test.tsx`.

- [ ] **Step 1 — red (unit reflow):** drive a column change through the size state
  (`resize-state.test.tsx:292-300` `fire()` pattern): window items' lines re-wrap (a long
  line's wrap count changes); committed `staticItems` byte-identical before/after.
- [ ] **Step 2 — red (THE GATE, unit — plan review I1):** mount ChatApp through the REAL
  `createResumeSafeStdout` over a RecordingTerminal (the `realProxy` pattern,
  resize-state.test.tsx:292 + resume-safe-stdout.test.ts:22): with the window on, steady state
  has `out.lastFrame() !== undefined`; a width shrink drives `verdict()` to `"reflow"` through
  the injected probe. Sabotage check: force the window over the cliff (cap += 100) → the gate
  reddens.
- [ ] **Step 3 — matrix:** `m1` cell, split per plan review I2: the steady-state tall-branch
  assertion runs KEYLESS via `stage_content` (:272 — no model turn needed to hold a window and
  resize under it), counting staged-row copies in `capture-pane -S -` with g1's method
  (:462-467), flat at 80×24 / 80×40 / 120×24; the STREAMING half is keyed-only (a3's
  `new-session -e` pattern + `tmux_has_session_env` skip). Keyed 10/10; keyless 9 + skips clean.
- [ ] **Step 4:** commit `f5(fsw-t4): the window re-wraps on width change and the corrections stay awake`.

### Task 5: Renderer selection with provenance (+ the default-off gate)

**Files:** Create `src/tui/renderer.ts`, `test/unit/renderer-select.test.ts`. Modify
`src/tui/prefs.ts` (:43 `tui?: "fullscreen" | "default"`), the `/status` formatter in
`src/tui/commands.ts`, `chatMain.tsx` boot (:375 area — selection computed ONCE).

**Interfaces — Produces:**
```ts
export type RendererMode = "fullscreen" | "classic";
export interface RendererChoice { mode: RendererMode; reason:
  "not_tty" | "screen_reader" | "env_off" | "env_on" | "tmux_cc_off" | "win_ssh_off"
  | "settings_on" | "settings_off" | "default_on" | "default_off" }
export function selectRenderer(deps: { isTTY: boolean; env: NodeJS.ProcessEnv; prefs: CcxPrefs }): RendererChoice;
export const DEFAULT_ON = false; // ← flipped to true in T16, nowhere else (plan review I7)
```
Order (spec §A2, exact): not-TTY → screen reader → env off (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`
set, or `CLAUDE_CODE_NO_FLICKER === "false"|"0"`) → env on (`CLAUDE_CODE_NO_FLICKER` truthy) →
tmux `-CC` (cheap heuristic only, no shell-out) → Windows-over-SSH → `prefs.tui` → the
`DEFAULT_ON` constant (`default_on`/`default_off` reason).

- [ ] **Step 1 — red:** one test per rung pinning ORDER (env-on beats neither non-TTY nor screen
  reader; settings beats default; env beats settings); F11 semantics; `DEFAULT_ON=false` pins
  `default_off` today.
- [ ] **Step 2:** implement; `/status` gains
  `renderer: classic (default_off) · corrections: main-screen stack` (fullscreen value wired in
  T9; comment marks the placeholder).
- [ ] **Step 3:** commit `f5(fsw-t5): the renderer is chosen once, with a reason /status can name`.

### Task 6: Alt-screen lifecycle, the exit guarantee, the pointer, the handoff

**Files:** Create `src/tui/altScreen.ts`, `test/unit/alt-screen.test.ts`. Modify
`src/cli/main.ts` (:404-405 signal interlock), `src/tui/chatMain.tsx` (`ChatClientOpts` gains
`beforeExit?: Array<() => void>` — the declared transport, plan review I8; finally :471-477
grows the alt exit + pointer).

**Interfaces — Produces:**
```ts
export const ENTER_ALT: string;   // "\x1b[?1049h\x1b[2J\x1b[H"          (canon pVe, L177094)
export const EXIT_ALT: string;    // "\x1b[<u\x1b[?1049l\x1b[>4m"        (canon nj,  L177097)
export function kittyUpgrade(termProgram: string | undefined): string;  // 7-term list L177175
export const MOUSE_OFF: string;   // "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l" (canon Gpe)
export interface AltScreenGuard { enter(): void; exit(): void; installSignalSafety(): () => void;
  active(): boolean; aroundSubprocess<T>(run: () => T): T }
export function createAltScreenGuard(deps: { writeSync(s: string): void; termProgram?: string }): AltScreenGuard;
export function resumePointer(sessionId: string): string; // "Resume this session with:\nccx --resume <id>\n"
```
`installSignalSafety` registers SIGINT (new — REPL ctrl+c is raw-mode bytes, bindings.ts:42) and
joins `beforeExit`, which `cli/main.ts`'s `onSignal` (:404) drains SYNCHRONOUSLY before
`host.stop(...).finally(process.exit)`. Cleanup order: MOUSE_OFF first → exit-alt with a
hand-written rmcup fallback on throw → cursor show. Never any paint after rmcup.
`aroundSubprocess` wraps `externalEditor.ts:70`'s `spawnSync` and `suspend.ts`'s ctrl+z: exit-alt
before, re-enter after (canon L180653-180662 — plan review C6). The graceful exit AND the
double-ctrl-C exit print `resumePointer` AFTER rmcup, onto the main screen (fullscreen only).

- [ ] **Step 1 — red:** byte tests with LITERAL strings + canon line cites (m4); ordering (a
  throwing unmount still gets MOUSE_OFF then rmcup — writeSync call-order spy); signal test
  (SIGTERM on a stub: guard writes precede `host.stop` AND precede `process.exit`);
  `aroundSubprocess` spy (EXIT_ALT precedes the spawnSync, ENTER_ALT follows); pointer both
  paths; onDetach → exit path pin (m5).
- [ ] **Step 2:** implement; guard constructed always, ARMED only under fullscreen (T9).
- [ ] **Step 3:** commit `f5(fsw-t6): the alt screen cannot outlive the process, and it always hands back a resume pointer`.

### Task 7: Driver additions (instrument work, docs only)

**Files:** Modify `docs/parity/qa-driver.md`.

- [ ] **Step 1:** document `alternate_on` + `cursor_flag` format variables; the
  live-shell-after-exit pattern (`sh -c '… ; exec sh'`, `remain-on-exit off`, typed-echo
  assertion — raw mode/bracketed paste have no tmux variable); ccx's T5 env pins on the launch
  line.
- [ ] **Step 2:** commit `f5(fsw-t7): the driver can see the alt screen and prove a terminal survived`.

### Task 8: The output proxy's altMode

**Files:** Modify `src/tui/chatMain.tsx` (proxy :126-343), `src/tui/clearViewport.ts` (D6 mode
split). Test: extend `test/unit/resume-safe-stdout.test.ts`.

**Contract:** `createResumeSafeStdout(stdout, { altMode?: boolean })` (or a setter — implementer's
call, but the mode is fixed per construction). In altMode: (1) every recorded frame write is
wrapped `\x1b[?2026h` … `\x1b[?2026l` (DECSET 2026); (2) `park()` never runs (every consumer
tolerates 0 — resizeRepaint isn't constructed, the :476 unpark is `>0`-guarded, the :305 foreign
homing goes dark; m3); (3) the `ESC[3J` strip at :236 is DISABLED — canon's `Rms()` 2J+3J is
alt-screen-CORRECT (m2/D6); `clearViewport.ts` exports the mode-selected clear (viewport-erase on
main, 2J+3J on alt — canon L177121). Known bounded divergence recorded in a comment: Ink's
`writeToStdout`/`writeToStderr` seams are 3 writes each and can tear across the 2026 boundary
(`/clear`, patched console) — m1.

- [ ] **Step 1 — red:** RecordingTerminal: 2026 wrap present in altMode, absent in main; no park
  bytes in altMode; 3J passes through in altMode, stripped in main; frame record still maintained
  in altMode (lastFrame defined after a frame write).
- [ ] **Step 2:** implement. Commit `f5(fsw-t8): the proxy learns the alt screen — atomic paints, no park, scrollback rules flipped`.

### Task 9: The frame shell + machinery gating

**Files:** Create `src/tui/FullscreenFrame.tsx`, `test/tui/fullscreen-frame.test.tsx`. Modify
`src/tui/chatMain.tsx` (compute `RendererChoice` once at boot; under fullscreen: construct proxy
in altMode, do NOT construct resize-repaint/corrector/park wiring at :429-447, arm the T6 guard,
enter before `render()`, exit in the finally; pass `renderer={choice}` to ChatApp — **the prop,
at a stable element position; ChatApp NEVER unmounts** — plan review C5), `src/tui/ChatApp.tsx`
(fullscreen branch renders `<FullscreenFrame>` with NO `<Static>` in the tree).

**Frame contract (spec §A4/§A4a):** total height `rows − 1` (recorded divergence: dock ends at
`rows − 1`, park row beneath); transcript region `flexGrow:1`; dock `flexShrink:0` capped
`floor(rows/2)` (`rows−2` in history search); overlay layer mounts in T13. Resize = full repaint:
one-shot erase-before-paint flag on the proxy, set by the resize listener, consumed by the next
frame write (D21 — F3 rests on this). Yoga overflow is clipped, never grown.

- [ ] **Step 1 — red:** frame renders exactly `rows − 1` lines at 15/24/40 rows (deps.rows);
  dock cap holds under a hungry composer; **overflowing region children are clipped — total
  lines stay `rows − 1`** (I9a); **a resize sets the one-shot erase flag exactly once and the
  next paint carries it** (I9b); classic path byte-identical (the 24 ChatApp suites untouched —
  root above ChatApp, prop-change only).
- [ ] **Step 2:** implement. `/status` correction-stack line now reads the real value (T5's
  placeholder retired).
- [ ] **Step 3:** commit `f5(fsw-t9): a fixed-height frame, with the main-screen machinery left outside`.

### Task 10: The fullscreen viewport — the whole document, virtualized

**Files:** Create `src/tui/FullscreenViewport.tsx`, `test/tui/fullscreen-viewport.test.tsx`.
Modify `src/tui/ChatApp.tsx` (fullscreen branch: `<FullscreenFrame regionChildren={<FullscreenViewport …/>} dock={composer+footer}/>`).

**Interfaces — Consumes:** `applyAnchor` (T2), `pageItemSlices`/`applyPager` (pager),
`state.finalizedItems` + `streamingItems(state.streaming, width)` (T3), `state.pendingItems`.
`allItems = finalizedItems ⧺ pendingItems ⧺ streamingItems(...)` — every producer exists (plan
review C4 resolved in T3).

- [ ] **Step 1 — red:** short content top-aligns (blank rows BELOW content, dock pinned — the
  80×40 anchor case); overflow tail-follows on append while sticky; scrolled-up + append does
  not move; re-stick on `stickBottom`; slices honor item boundaries (`RenderItemView start/end`);
  **a streaming line at 3× region width occupies 3 slice rows, not 1** (the C4 honesty case).
- [ ] **Step 2:** implement. Commit `f5(fsw-t10): fullscreen scrolls a virtual transcript, anchored to its tail`.

### Task 11: Scroll keys + the pill + ctrl+O in-frame

**Files:** Modify `src/tui/keys/bindings.ts` (the `Scroll` context — in VALID_CONTEXTS :28,
currently unbound — gains `pageup: "scroll:halfPageUp"`, `pagedown: "scroll:halfPageDown"`,
`ctrl+home: "scroll:top"`, `ctrl+end: "scroll:bottom"`; the Transcript context and PAGER_ACTIONS
are UNTOUCHED — per-context half-page, plan review I5/I11), create `src/tui/JumpPill.tsx`, wire
`useKeyScope("Scroll", { active: fullscreen && !historySearchOpen })` in FullscreenViewport;
TranscriptPager mounts inside the frame's region (height respects the region).

- [ ] **Step 1 — red:** binding-table pins (Scroll rows; Transcript context byte-unchanged — the
  grandfathered-collision census catches drift); pill renders only `!sticky && !atEnd`, canon
  labels (`"N new message(s)"` / `"Jump to bottom"` + resolved keybinding — L456145); half-page
  moves `floor(regionRows/2)`; disabled while history search open.
- [ ] **Step 2:** implement + deliberate census updates in `keys-bindings.test.ts`.
- [ ] **Step 3:** commit `f5(fsw-t11): half-page scrolling with a pill home`.

### Task 12: The transcript dump + editor escape (`v`)

**Files:** Create `src/tui/transcriptDump.ts`, test `test/unit/transcript-dump.test.ts`. Modify
`src/tui/keys/bindings.ts` (bind `v` in the **Scroll** context — NOT Transcript; new action
`scroll:dumpTranscript` added to VALID_ACTIONS — plan review I5), wire through
`src/tui/externalEditor.ts`'s spawnSync seam (:70, :92) INSIDE `guard.aroundSubprocess` (T6).

- [ ] **Step 1 — red:** dump renders all messages to `cc-transcript-<ts>.txt` under tmpdir and
  invokes `$VISUAL`/`$EDITOR`; the handoff is wrapped (EXIT_ALT before spawnSync, ENTER_ALT
  after — spy order); VALID_ACTIONS gains the name (config-error test for the unlisted case).
- [ ] **Step 2:** implement. Commit `f5(fsw-t12): a way out to your editor — the scrollback escape hatch`.

### Task 13: The two overlay mechanisms (F7's task — plan review C6)

**Files:** Modify `src/tui/FullscreenFrame.tsx` (the absolute-bottom seam slot capped `rows−2`
under the `▔▔▔▔` rule + the dock-replacement slot), `src/tui/ChatApp.tsx` (route the existing
surfaces: permission/decision dialogs REPLACE the dock — composer gone, dialog under the normal
`────` rule; /model, /help, /resume + preview render in the seam slot with the transcript
squeezed above — grounding §L2.6 "Two overlay mechanisms, not one"). Test
`test/tui/fullscreen-overlays.test.tsx`.

- [ ] **Step 1 — red:** permission dialog in fullscreen: composer absent, dialog in the dock
  region; /model in the seam slot: `▔` rule on its top edge, transcript rows still visible
  above, slot ≤ `rows−2`; classic rendering of the same surfaces unchanged.
- [ ] **Step 2:** implement. Commit `f5(fsw-t13): one seam for pickers, and dialogs take the dock — both canon mechanisms`.

### Task 13b: Honest row budgets for dock and seam tenants (inserted from the T13 review, 2026-08-13)

The T13 review measured three places where a surface's row budget exceeds the rows that paint,
and one place where fullscreen erases the signs a turn is running. The permission case is
BLOCKING for the wave: at 24 AND 40 rows, a permission dialog with a long diff shows the diff
mid-clip with the question, all options, and `Esc to cancel` off-screen — and the held dock
divergence (dialogs pinned in the dock band, not canon's scrollable) removes the only scroll
path that could reveal them. The user would be authorising an edit they cannot see.

**Files:** Modify `src/tui/PermissionDialog.tsx` (+ the diff-rendering child under
`src/tui/dialogs/` if split there), `src/tui/PlanDialog.tsx` (`planRegionRows` :177 floors the
plan region at max(3,…) but nothing shrinks the whole dialog to a budget — below ~21 rows it
composes to a fixed 18 and the OPTION BOX falls off), `src/tui/ChatApp.tsx` (`overlayRows()`
:1076; the paneOwned blanking :1029), `src/tui/FullscreenFrame.tsx` (seam rule styling).
Tests: extend `test/tui/fullscreen-overlays.test.tsx`.

- [ ] **Step 1 — the budget inversion (Critical + Important 2):** dialogs that render inside a
  row budget must shrink their CONTENT, never their chrome: reserve the question, the full
  option box, and the hint/cancel rows first; window the diff (permission) / plan body (plan)
  into whatever remains, with a `… +N more lines` marker INSIDE the windowed region (a marker
  after the content would itself clip). Red-first at 24 and 40 rows for permission (question +
  all options + Esc row visible with a 25-line diff), and at 14/18/24 rows for the plan dialog
  (option box always visible; T13 review measured the option block gone at 14, options 2–3
  gone at 18). Both components are classic-shared: classic (no budget / tall budget) renders
  byte-identically — pin one classic case each.
- [ ] **Step 2 — the off-by-one (Important 1):** `overlayRows()` fullscreen arm becomes
  `seamCap(size.rows) - 1` — the `▔` rule is charged against the cap, so the slot paints
  `seamCap − 1` content rows (canon hands down `rows − 3`: Q0r = Wbt − aIr − 1, aIr = 2, bundle
  L456240). Update the seam tests' literals accordingly.
- [ ] **Step 3 — live signals under the seam (Important 3):** gate the `paneOwned` blanking of
  `pendingItems`/`streaming` on `!fullscreen` (ChatApp :1029) so an open overlay mid-turn keeps
  the spinner/stream visible in the region (canon keeps its spinner in `scrollable`, above the
  absolute overlay, never occluded). Red-first: `/model` open mid-turn in fullscreen → the
  region still shows the streaming/pending tail.
- [ ] **Step 4 — seam rule colour (T13 review Minor 1):** canon paints the `▔` rule
  `color:"permission"` and NOT dimmed (Sg, bundle L183955, refuting the T13 report's
  "unknowable" residual). Match it. Also add the missing positive assertion to the
  plan-crossing test (the plan DID page: assert on its `… +N more lines` marker moving).
- [ ] **Step 5:** commit `f5(fsw-t13b): what a dialog cannot shrink, it must not clip`.

### Task 14: Fullscreen surface deltas (D1, D10-D14)

**Files:** Modify `src/tui/Footer.tsx` (D1: fullscreen && configured && text empty/undefined →
one blank row, the :140 gate branches on renderer; D12 paddingRight 2→1; D13 focus chip),
`src/tui/ChatComposer.tsx` (D11: NotificationSlot at :1190 suppressed in fullscreen — plan
review I6; D10: the command-palette popup renders in the absolute overlay above the dock, not
inline), `src/tui/ChatApp.tsx` (D14: queued prompts at the viewport tail). Tests in the
respective suites.

- [ ] **Step 1 — red:** D1 both arms (configured-unresolved holds a row fullscreen / collapses
  classic; unconfigured renders nothing in both); D10 (palette above the dock in fullscreen,
  inline classic); D11/D12/D13/D14 pins.
- [ ] **Step 2:** implement. Commit `f5(fsw-t14): the fixed frame stops rows from shoving`.

**Amendments from the T12 review (controller, 2026-08-13):**

1. **D11 must not silence the transcript dump's receipt.** `ChatComposer`'s `NotificationSlot`
   is the ONLY visible feedback for the `v` dump (`wrote <file> …`, `priority: "immediate"`).
   Suppressing the slot wholesale in fullscreen makes `v` produce no feedback at all. D11's
   suppression must keep a fullscreen home for immediate-priority notifications (the Footer
   status row or an equivalent slot in the fixed frame) — pin the dump receipt visible in
   fullscreen in the D11 test.
2. **`v` must be announced somewhere in the fullscreen chrome** (condition attached to the
   T12 review's approval of the pill-gated handler): canon's transcript screen advertises
   `v to open in <editor>` on its hint row (bundle L547303). Give `v` a visible home —
   the natural spot is wherever D1/D13's footer work lands, or the ?-shortcuts overlay's
   fullscreen section. Assert its presence in a test.
3. **ctrl+z suspend must run inside the alt-screen handoff** (T6 report flagged it; no other
   task owns it). From fullscreen, `src/tui/suspend.ts`'s SIGTSTP path currently suspends with
   the alternate screen still up; the shell prompt returns onto the alt screen. Wrap the
   suspend/resume pair with the guard: EXIT_ALT (+ mouse/paste off, cursor show) before
   SIGTSTP, ENTER_ALT + repaint on SIGCONT resume — same discipline as `aroundSubprocess`,
   but split across the stop/continue boundary. Note canon's shape for subprocess handoffs
   (re-review of T12, wave-level ⚠️): canon stays ON the alt screen and clears it instead of
   dropping to main; our exit-to-main is a held divergence (T6 design) — keep suspend
   consistent with OUR shape, not canon's.

### Task 15: `/tui` — the prop-change switch + attach rules

**Files:** Modify `src/tui/commands.ts` (`/tui [default|fullscreen]`: persist `prefs.tui`,
refuse while `state.bgTasks.length > 0` with canon's copy L482600 byte-verified, then flip the
mode STATE that feeds the `renderer` prop), `src/tui/chatMain.tsx` (the mode is React state at
the root; a flip re-renders `<ChatApp renderer={choice}/>` at the SAME element position —
**no key, no conditional wrapper; ChatApp does not unmount** — entering fullscreen arms the
guard + enters; leaving runs exit BEFORE the classic paint). Attach: `/tui` remounts the local
client only. Test `test/tui/tui-switch.test.tsx`.

**Two hand-offs from T9 (its report §7, confirmed by the T9 review's F5).** They are the mechanism
behind Step 1's two acceptance clauses, not extra scope:

1. **ChatApp not unmounting is not enough — the HOST subtree still remounts.** T9's two branches
   return different root component types (`<FullscreenFrame>` vs a bare `<Box>`), so React
   reconciles them as different elements and unmounts everything below on a live flip, even though
   `ChatApp` itself and every child ELEMENT are the same. Component state above the seam survives;
   Ink's host nodes do not. The cheap fix is to make `FullscreenFrame` the wrapper in BOTH modes —
   unbounded height in classic (no `height`, no dock cap, `overflow` unset), so the root component
   type is stable across the flip and only its props change.
2. **`/status` reads the boot-fixed value.** `hookOpts.rendererChoice` is set once at boot; the
   live mode lives in the `renderer` prop. T15 must route the flipped value into `useChat` (or have
   `/status` read the prop), or `/status` reports the mode the session started in. The comment at
   `ChatApp.tsx`'s `renderer` prop that says the two "cannot disagree" is annotated "true until
   T15" — retire that annotation as part of this task.

- [ ] **Step 1 — red:** the flip preserves ChatState — transcript content present after BOTH
  flips AND the component identity holds (a probe ref/state survives — the C5 pin);
  refuse-while-busy prints canon's copy; terminal bytes on the flip are exit-then-classic-paint /
  enter-then-frame (RecordingTerminal order); **the I8/I9 hazard pin:** after classic→fullscreen,
  no write contains committed-transcript text (`fullStaticOutput` never replays — rests entirely
  on never taking the tall branch; there is no way to clear the buffer).
- [ ] **Step 2:** implement. Commit `f5(fsw-t15): /tui swaps the renderer in place — the conversation never unmounts`.

### Task 16: The default flip + corpus pinning sweep (pure gate)

**Files:** Modify `src/tui/renderer.ts` (flip `DEFAULT_ON` to `true` — the ONE named constant,
plan review I7), `scripts/resize-matrix.sh` (launch lines gain the classic pin env; header
records classic-only), `docs/parity/qa-driver.md` (ccx launch-line pins).

- [ ] **Step 1:** flip; sweep: full `npm run test:tui` (24 ChatApp suites — root-above means
  untouched; this step VERIFIES that claim) + `npm run test:unit` + keyless matrix green; keyed
  matrix 10/10. **Re-evaluate the tmux `-CC` shell-out gap here** (T5 divergence 1, `renderer.ts`
  header): T5 dropped canon's `tmux display-message` probe off the boot path, which is harmless while
  the default is off but becomes reachable the moment this flips — decide probe vs. keep-and-document,
  and if kept, that the escape hatch `CLAUDE_CODE_NO_FLICKER=0` is the answer we stand behind.
- [ ] **Step 2:** commit `f5(fsw-t16): fullscreen by default; every instrument says which renderer it measures`.

### Task 17: Final verification — the spec's acceptance as written

**Files:** none (evidence only).

- [ ] **Step 1:** full gates: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`,
  `npm run build`, keyless + keyed matrix. Record numbers.
- [ ] **Step 2:** run **F1–F11 from the spec AS WRITTEN** (quote each cell verbatim in the
  report) in the isolated-HOME tmux harness with T7's driver additions. Keyed cells over OAuth.
  F5/F5b via the live-shell pattern; F10 seeds the isolated ccx home's settings with
  `sh -c 'sleep 3; echo LATE'`, pane ≥ 15 rows; F6 re-runs pinned-classic.
- [ ] **Step 3:** any cell that cannot run as written is a FINDING — report, do not reinterpret.
  Evidence to `$CLAUDE_JOB_DIR/tmp/fsw-F*.txt`.

---

## Self-review notes (v2)

- Coverage: A1→T1/T3/T4; A2→T5; A2a→T5/T8/T9; A3→T6 (incl. pointer + handoff + interlock);
  A4→T9/T13; A4a→T8/T9; A5→T11/T12; A6→T6; A7→T15; A8→T13/T14; D6→T8; D21→T9; M0 debts→T7;
  F1-F11→T17 with owning tasks T9(F1) T10/T11(F2) T9(F3) T6(F4) T6(F5/F5b) T4(F6) T13(F7)
  T15(F8) T5/T9(F9) T14(F10) T5(F11). No silent drops remain (plan-review C6 items all owned).
- Interfaces: `finalizedItems`/`streamingItems` produced T3, consumed T10; `RendererChoice`
  T5→T9/T15/T16; `AltScreenGuard.aroundSubprocess` T6→T12; `DEFAULT_ON` T5→T16 only.
- Milestone cut: M1 = T1-T4; M2a = T5-T7; M2b = T8-T12; M3 = T13-T16; verification = T17.
- Plan-review disposition: C1-C6, I1-I10, m1-m7 ALL adopted (the review's prescriptions are the
  task text). No finding rejected.
