# Fullscreen renderer on a live-window substrate — wave design

**Purpose.** Build claude's alternate-screen (fullscreen) renderer in ccx, on a shared substrate —
a bounded **live window** over the retained transcript document — that also gives the main-screen
renderer transcript reflow on width change (s2qa2-06, honest scope: the live window's rows).
One mechanism, two renderers. This is the largest remaining fidelity gap: a warm-home installed
claude runs fullscreen at **every** terminal size, so today ccx diverges from the real product at
every geometry (owner decision FULLSCREEN-1, 2026-08-12: **build**).

**Grounding (read before planning; bare line numbers are canon 2.1.220 `cli.pretty.js`; `§L…` =
the grounding doc's live layer, `grounding §…`/`B…` = the grounding doc itself):**
- `docs/superpowers/grounding/2026-08-12-fullscreen-ground.md` — renderer transcription (gate,
  lifecycle, frame composer, scroll model, surface deltas D1–D23, crash safety) + 32 live
  captures of installed 2.1.227.
- `docs/superpowers/grounding/2026-08-12-reflow-ground.md` — canon's resize/reflow mechanism
  (no `<Static>` upstream; width delta → viewport-tail reset `TJr` L178440; `ESC[3J` alt-only) +
  the ccx seam inventory and the resizeRepaint interaction boundary.

**Premises that died in grounding (do not resurrect):** there is no ≤24-row gate (the renderer is
a HOME-cached rollout flag, decided once at startup — `ds()` L110109 takes no dimension input);
"bottom-anchoring" anchors the *scroll position once content overflows* (`scrollTop =
max(0, content − viewport)` L179813 — short content sits at the TOP of the region); canon's
main-screen reflow re-wraps only the visible tail, never scrollback.

## Owner decisions (2026-08-12, binding)

- **D-F1 — substrate first.** The bounded live window is milestone 1, on the **main screen**,
  where it delivers reflow over its own rows (s2qa2-06's honest scope). Fullscreen builds on it.
- **D-F2 — entry policy: config knob, default ON.** ccx defaults to the fullscreen renderer with
  an opt-out to classic, matching what warm-home installed claude does at every size. **Non-TTY
  falls back to classic unconditionally** — it is the first gate in the decision order (§A2),
  above the env levers.

## The two hard constraints (they shape everything below)

1. **Stock Ink 5.2.1's tall-frame cliff.** When the non-static subtree's height reaches
   `stdout.rows`, Ink abandons log-update and writes `clearTerminal + fullStaticOutput + output`
   (`ink.js:121-124`). `fullStaticOutput` only ever grows (reset only in the constructor), ccx
   strips the `ESC[3J` (chatMain.tsx:236), so on the main screen each such render appends a full
   copy of the committed transcript to scrollback (the measured 88→172→256→340 pathology). One
   row below the cliff there is a second edge: log-update writes `frame + '\n'`, so an exactly
   `rows`-tall frame scrolls the terminal on every paint — canon buys this off with its
   deliberate `viewport.height = rows + 1` slack (grounding §5.1). **Every frame ccx paints, in
   either renderer, stays ≤ `rows − 1` physical rows.**
2. **The wave-2 corrections are gated on a recorded frame.** The proxy records no frame on a
   `2J`-prefixed write (chatMain.tsx:234-237), and every correction — the reflow probe
   (resizeRepaint.ts:418), the burst bookkeeping (:405), `resyncAfterGrow` (ChatApp.tsx:559) —
   requires one. A live window tall enough to take the cliff would not shrink their province; it
   would silently blind all of them while `tall` never stands down. The substrate must keep the
   frame record alive.

## Architecture

### A1. The live window (shared substrate; the D-F1 milestone)

One windowed viewport over the one retained `TranscriptDocument`, changing what the *rendering*
boundary is — per-renderer:

- **Window height, explicitly bounded.** The live window renders the last W rows' worth of
  items in the ordinary Ink tree, where **W = `rows − dockRows − SLACK`, `SLACK ≥ 2`, asserted
  at render time** — bounded by hard-constraint 1, not by the viewport. (Precedent:
  `TranscriptPager.tsx` reserves ten rows of slack for the same reason, per its own header.)
  Stated consequence: main-screen reflow covers the last W rows, not the whole visible
  transcript; s2qa2-06's cell asserts re-wrap over the window's rows and explicitly does not
  claim the rows above it.
- **Commit granularity snaps to item edges.** `<Static>` publication is per `RenderItem`
  (useChat.ts reconcile + `publishedIds`, which **remains the authority**; `Transcript.tsx`
  renders whole items) — there is no half-item commit. The window is therefore "the smallest
  suffix of whole items whose projected rows ≥ target, capped at W". **An item taller than W is
  committed whole and excluded from reflow — recorded divergence** (rather than rendered live
  over the cliff, or half-lost: the alternative row-granular commit needs a sliceable static
  item type and is rejected for this wave). The seam is a two-stage reconcile in `useChat.ts`
  (publish items that left the window) + the window component; `replaceDocument` remains the
  only full re-emit path.
- **Commit policy per renderer.** Main screen: an item commits to `<Static>` (scrollback) only
  when it has left the window; committed rows keep today's contract (never repainted,
  hard-wrapped as-emitted — canon never repaints history either). One-way ratchet, stated: on a
  shrink-then-grow the committed items do not return, so reflow coverage can only ratchet down
  within a session. Fullscreen: **no `<Static>` in the tree at all, no commits, ever** — the
  window paints from the document every frame (and an empty static tree keeps `fullStaticOutput`
  empty by construction, which is what makes the renderer switch safe — §A7).
- **Sticky-bottom + follow-growth as a pure reducer** (canon's three rules, L179827-179836:
  pinned to the tail while at the tail; never yanked down when scrolled up; re-stick on explicit
  `scroll:bottom`). Built and unit-pinned in M1 as a pure function against those three rules;
  its interactive consumers (scroll keys, the pill) arrive with the frame in M2b — on the main
  screen the terminal owns scrolling, so the reducer sits at the tail until then.
- **Reflow rides Ink's own re-layout.** On a settled width change the window's items re-wrap via
  yoga — an **ordinary frame write** through the proxy. It must remain **visible to
  `frameWriteCorrection`** — `selfWriting` is resizeRepaint's own-write seam (resizeRepaint.ts:292,
  :476) and must NOT be extended to Ink's writes; doing so would switch off the wave-2 correction
  wholesale. (reflow-ground §3's double-erase hazard was Option-A-specific and does not arise
  under this design; the hazard here is constraint 2.) **Plan-time assertion task:** with the
  window shipped, `lastFrame()` is non-undefined and `verdict()` reaches `"reflow"` in the a3
  matrix cell — if either goes dark the window is too tall and the wave has traded a cosmetic
  residue class for a blind one.

### A2. Renderer selection, with provenance

A `ds()`-equivalent whose decision order mirrors canon (L110109) minus what ccx doesn't have,
with two deliberate moves: **(1) non-TTY → classic, unconditionally, first** (D-F2's
"regardless"); **(2) screen-reader off ABOVE the env levers**, as in canon (env force-on must not
beat a screen reader). Order: non-TTY → screen reader → env off
(`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` / `NO_FLICKER=false`) → env on
(`CLAUDE_CODE_NO_FLICKER=1`) → tmux `-CC` off → Windows-SSH off → settings
`tui: "fullscreen" | "default"` → **default: fullscreen** (D-F2; canon's statsig slot resolves to
our default). Decided once at startup; resize never re-evaluates (§L2.1). One-word provenance
reason (canon `h8e()` L110162) surfaced in `/status`. No CLI flag; no terminal-size input.
**The env spellings ship first within M2a**, before any other M2 item — every acceptance cell
needs them to pin the renderer deterministically.

`ccx attach`: renderer selection runs in the attaching client's own terminal like any launch
(the TUI is local); `onDetach` mid-frame runs the exit path (§A3) before the client returns to
the shell.

### A2a. The main-screen machinery is main-screen-only

The cursor park (chatMain.tsx:283-312), `createResizeRepaint`, `setFrameCorrector`, the reflow
oracle and the settle repairs are residue machinery for a terminal-owned scrollback. **None of it
is constructed when the fullscreen renderer is selected** — inside a fixed-height frame the park
would paint spaces into the frame's own last row and the corrector would erase upward into the
frame. The alt screen's repaint contract (D21: full repaint on resize, re-arm mouse, one-shot
erase-before-paint — canon L180633-180642) replaces them. F9's `/status` cell asserts which
correction stack is live.

### A3. Alt-screen lifecycle (canon §3.1, byte-faithful)

Enter `ESC[?1049h ESC[2J ESC[H` + the terminal-conditional kitty/modifyOtherKeys upgrade (canon's
seven-terminal list L177175); exit pops kitty, `ESC[?1049l`, resets modifyOtherKeys. Mouse-off
bytes precede everything that can throw. **The exit guarantee:** a synchronous crash-safety path
(canon `zuy` L181494: mouse off unconditionally → unmount → hand-written rmcup fallback → full
terminal-mode restore, all `writeSync`) runs on SIGINT, SIGTERM, SIGHUP and uncaught throw.
**ccx has no SIGINT handler today** (REPL ctrl+c is bytes under raw mode — keys/bindings.ts:42)
and `cli/main.ts:405`'s existing SIGTERM/SIGHUP handler exits via `process.exit`, which skips
`runChatClient`'s `finally` — the synchronous cleanup must run inside or ahead of that path, or
the SIGINT cell passes while its SIGTERM sibling still breaks the terminal. Subprocess handoff
(`$EDITOR`, `!bash`) re-enters on return (canon L180653-180662 asymmetry).

### A4. The frame shell (canon `cZo` L455844, fullscreen branch)

One reusable container (the `/resume` launcher takeover, D18, mounts it too — factor it as a
wrapper from task one): a fixed-height frame hosting a `flexGrow:1` transcript region (the live
window); a `flexShrink:0` bottom dock capped at `floor(rows/2)` (`rows−2` while history search is
up, canon L455852); **two** overlay mechanisms (grounding §L2.6, "Two overlay mechanisms, not
one"): the absolute-bottom overlay slot under the `▔▔▔▔` seam capped `rows−2` (/model, /help,
/resume + preview) AND the dock-replacement slot (permission dialogs — composer disappears,
dialog under the normal `────` rule). Yoga-taller-than-frame is a named caller bug, warned and
clipped (canon L180317). The spare row moves to the TOP of the region (paddingTop 1 → the sticky
prompt chip's row when scrolled, canon L455893 — chip itself deferred).

### A4a. How a frame is painted (the decision C-review demanded)

- **Frame height is `rows − 1`**, not `rows` — hard-constraint 1's second edge: log-update
  appends `'\n'`, and canon's own `rows + 1` viewport slack exists for exactly this (grounding
  §5.1). The bottom physical row of the screen is the cursor-park/blank row. **Recorded
  divergence:** canon's dock reaches row `rows`; ccx's reaches `rows − 1` with the park row
  beneath.
- **Paint path is Ink's ordinary log-update cycle** (erase logical lines, rewrite) with no
  `<Static>` in the fullscreen tree — a full-frame rewrite per paint. To deliver the renderer's
  headline property ("flicker-free" is canon's own name for it — settings copy L42039), **every
  alt-screen paint is wrapped in DECSET 2026 synchronized-update begin/end at the output-proxy
  seam** on terminals that support it (2026 is in canon's mode table L177069). On terminals
  without 2026 support the full-rewrite flicker is a **recorded divergence**.
- **Deferred to M4, recorded:** canon's cell-diffing with absolute cursor addressing (D4) and
  per-frame park at `ESC[rows;1H` (D5) — the flicker-free-without-2026 renderer. The M2 paint
  model is the honest stock-Ink version, not a hidden fork of Ink.
- D6 ships via the existing `clearViewport.ts` split: `Rms()` (2J+3J) semantics on the alt
  screen, `yJr()` viewport-erase on main — selected by screen mode as upstream does (L177121).

### A5. Scroll model (canon §3.5, keyboard-only in this wave)

The `Scroll` context activates in fullscreen: `pageup`/`pagedown` = **half** viewport (canon
L446165), `ctrl+home`/`ctrl+end` = top/bottom; arrows stay composer-history (§L2.3); disabled
while history search is open (canon L446211). **The half-page fix is per-context resolution, not
an edit to the shared `PAGER_ACTIONS` map** — that map also feeds the ctrl+O Transcript context,
whose canon PgUp semantics are separately measured (§L2.3's ctrl+o observation does not clearly
support either mapping); ctrl+O's mapping is left alone this wave and the open question recorded.
The **jump-to-bottom pill** ships with the frame (canon L456145: absolute-bottom, centred,
`"N new message(s)"` / `"Jump to bottom"` + resolved keybinding, shown only when not sticky and
not at end): without it a scrolled-up user in a screen with no scrollbar and no scrollback has no
way back. Ctrl+O's pager works inside the frame, and the `v`-to-`$EDITOR` transcript dump (canon
L549336) ships as the scrollback escape hatch.

### A6. Exit contract (canon §4.1/D23 + one deliberate improvement)

Quitting restores the main screen with pre-launch scrollback intact and the conversation absent —
the load-bearing guarantee is the **ordering** (never paint after rmcup); canon's paint-then-rmcup
final frame is visually equivalent to rmcup alone and is not itself a requirement. The graceful
exit prints canon's two-line `Resume this session with: ccx --resume <id>` pointer.
**Divergence, deliberate:** ccx prints the pointer on the double-ctrl-C path too — canon's
silence there is a gap not worth copying (§L2.5).

### A7. Renderer switching: remount, not re-exec (decision, see log)

`/tui [default|fullscreen]` persists the setting and **remounts** — precisely: a **React subtree
swap under a mode-selecting root that sits in `chatMain`, above `ChatApp`**, within the ONE Ink
instance (Ink's `render()` is keyed by the stdout object — a second `render()` call returns the
same instance; there is no "second Ink"). The root's position above `ChatApp` keeps the existing
`test/tui` corpus renderer-free. Canon's own alt-screen edge is already a component unmount
driven by the settings write (grounding §2.5/B5); the re-exec upstream adds is its way of getting
clean renderer state, which two properties give us in-process: **classic under this wave never
takes the tall branch** (A1's cap), and **fullscreen has no `<Static>`**, so `fullStaticOutput`
stays empty and a switch cannot replay the transcript into the alt screen. Refuse while
background work runs (canon's copy, L482600). In `ccx attach`, `/tui` persists the preference and
remounts the local client only. No upsell/downsell/survey machinery (statsig-cohort product ops —
non-goals).

### A8. Surface deltas in scope

- **D1** as refined (§4.0): the statusLine row is held open **only when configured-but-
  unresolved**, fullscreen-only (an async command's row must not shove a fixed frame).
- **D6** via `clearViewport.ts` mode split (§A4a). **D21** resize contract in scope for M2 (§A2a
  — F3 rests on it). **D10**: the command palette / autocomplete hoists to the absolute overlay
  above the dock in fullscreen (inline-below-composer blows the dock cap) — M3. **D11** (suppress
  the notification block), **D12/D13** (mode-row padding / `focus` chip), **D14** (queued prompts
  at the scrollable tail) — M3.
- **Deferred, recorded:** all mouse (D7-D9 — wheel, click, hover, selection, auto-copy: the
  largest separable chunk); D4/D5 (cell-diff + absolute addressing — §A4a); sticky prompt chip;
  `scrollHint` hardware scroll (D22); DECSTBM renderer; FleetView's permissive gate (D19);
  `/focus` (D20); upsell/downsell.

## Milestones

- **M0 (pre-wave, done + one correction):** the QA driver pins **claude's** renderer per launch
  (`2da99ef00c`); **ccx's own pin ships first in M2a** (§A2). Driver additions still owed before
  M2's cells run: `alternate_on` + `cursor_flag` format variables documented, and the
  live-shell-after-exit pattern (`sh -c 'node …; exec sh'`) for terminal-usability assertions
  (raw mode/bracketed paste have no tmux format variable).
- **M1 — the live window, main screen.** The capped window (W = rows − dock − SLACK, asserted),
  item-edge commit staging in `useChat.ts` reconcile (`publishedIds` stays the authority), the
  sticky/follow-growth pure reducer (unit-pinned against canon's three rules), reflow-at-settle
  over the window's rows. Acceptance: a width change re-wraps the window's rows (no mid-word
  hard-wrap survivors within it); **the tall-frame branch is not taken in steady state at 80×24,
  80×40, 120×24** (measured as `capture-pane -S -` line growth — the resize-matrix's own method);
  **the corrections stay reachable** — `lastFrame()` non-undefined and `verdict()` reaches
  `"reflow"` in the a3 cell; the full resize matrix stays green non-vacuously.
- **M2a — terminal-state half (independently shippable behind the knob, default still OFF until
  M3).** Renderer selection + provenance + **the ccx env pins, first**; alt-screen
  enter/exit/reassert; the crash-safety path incl. the SIGINT handler and the
  `cli/main.ts` SIGTERM/SIGHUP interlock; the exit contract on both paths (pointer included).
- **M2b — the frame is real.** Frame shell (§A4) + paint model (§A4a); the live window mounted
  in the frame; scroll keys (half-page, per-context); the pill; ctrl+O inside the frame; the `v`
  editor escape.
- **M3 — surfaces, switching, default flip.** Both overlay mechanisms (permission dialog
  replaces the dock; /model÷/help÷/resume in the seam slot); D1/D10/D11/D12/D13/D14; `/tui`
  remount + refuse-while-busy; the `tui` settings knob; **default-ON flip, same day as:** every
  existing tmux-driven cell and the resize-matrix launch line get an explicit ccx renderer pin
  (the matrix pins classic and either grows a fullscreen sibling or records classic-only).
- **M4 (recorded, not scheduled):** mouse; D4/D5 diff renderer; sticky chip; hardware scroll;
  launcher-level `--resume` takeover on the shared container.

## Acceptance (observable; keyed cells over OAuth per `.env` rules; milestone in brackets)

- F1 [M2b] Fresh ccx on a TTY (pinned fullscreen): `alternate_on=1`, frame fills the screen with
  the park row at the bottom, dock pinned, content top-aligned when short (80×40: blank rows
  BELOW content, above the dock).
- F2 [M2b] Overflowed transcript: tail-follows during streaming; PgUp scrolls half the region and
  the pill appears; typing while scrolled up does NOT snap back; pill / `ctrl+end` re-sticks.
- F3 [M2b] Resize inside the frame (80×24→100×24→80×30→**80×24**→120×24 — the five-leg §L2.4
  sequence incl. the return leg): re-wraps every step, dock pinned, park tracks height, zero
  stale-width artifacts.
- F4 [M2a] `/exit` restores the main screen with pre-launch scrollback intact, conversation
  absent, two-line resume pointer printed; double-ctrl-C same INCLUDING the pointer (divergence).
- F5 [M2a] `kill -INT` mid-turn inside the frame: terminal usable after — mouse off, cursor
  visible, main screen, typed text echoes in the surviving shell. **F5b:** same for
  `kill -TERM` (the `cli/main.ts` interlock — today's handler breaks the terminal even without
  the alt screen).
- F6 [M1] Width change at 40 rows re-wraps the live window's rows — the s2qa2-06 cell against
  installed claude pinned classic; the matrix's steady-state scrollback-growth count is flat;
  re-run pinned-classic after M3's flip.
- F7 [M3] Permission dialog replaces the dock (composer gone); /model renders in the seam slot
  with the transcript squeezed above; the command palette renders in the overlay above the dock.
- F8 [M3] `/tui default` from fullscreen lands classic with the conversation intact AND the
  terminal modes clean (mouse off, kitty popped — asserted, not assumed); `/tui fullscreen`
  returns; refused while a background task runs (canon's copy).
- F9 [M2a] `/status` names the renderer, its provenance reason, and which correction stack is
  live (§A2a).
- F10 [M3] statusLine configured in the isolated ccx home with `sh -c 'sleep 3; echo LATE'`,
  pane ≥ 15 rows (Footer's `STATUS_LINE_MIN_ROWS` gate): fullscreen holds one blank row until it
  resolves; classic collapses it (D1's live-unverified branch, verified by this cell).
- F11 [M2a] Non-TTY invocation (pipe) lands classic regardless of env force-on (D-F2's
  "regardless", pinned).

## Decision Log

- **Live-window substrate first** (owner, 2026-08-12) over separate fixes (rejected: the Option-A
  RenderLine→ANSI serializer is throwaway once the live model exists) and over fullscreen-first
  (rejected: defers a P2 sweep finding behind the biggest wave). The earlier "retires the
  residue-correction class structurally" claim is **withdrawn** (spec review I7): the residue
  class comes from log-update erasing logical lines while the emulator re-wraps physical rows —
  independent of the commit boundary, and a taller live frame produces MORE residue per write.
  The corrections stay; the substrate must keep them reachable (hard constraint 2).
- **Default ON behind a knob** (owner) over default-off dark ship (rejected: ccx's default would
  diverge from installed claude's for another wave) and over replicating canon's flag-cache
  mechanism (rejected: a rollout accident is not product behavior). Flip gated on the M3 pinning
  task (spec review C6).
- **Window capped below Ink's tall-frame cliff; item-edge commit granularity** (spec review
  C1/C3): W = rows − dock − SLACK asserted at render time; taller-than-W items commit whole and
  are excluded from reflow (recorded divergence). Row-granular commits rejected: they need a
  sliceable static item type — a larger change than the wave.
- **Paint model: stock log-update at `rows − 1` + DECSET 2026 wrapping** (spec review C4) over an
  owned absolute-addressing diff renderer (deferred to M4, recorded): the honest stock-Ink
  version first; flicker-free delivered via 2026 where supported, recorded divergence elsewhere.
- **Remount over re-exec** for `/tui` (from grounding B5, hardened by spec review I8): a React
  subtree swap under a root in `chatMain` above `ChatApp`, one Ink instance; safe because classic
  never takes the tall branch (A1 cap) and fullscreen feeds no `fullStaticOutput`. Rejected
  re-exec: bigger, harder to test; its one advantage (clean state) is provided in-process.
  Revisit only if M3 finds state that genuinely cannot be remounted.
- **Half-page PgUp/PgDn fix per-context** (spec review I11): the Scroll context gets canon's
  half-viewport; ctrl+O's Transcript mapping left alone pending its own grounding read (open
  question recorded).
- **Resume pointer on double-ctrl-C** — deliberate improvement over canon's graceful-path-only
  hint; recorded divergence.
- **No statsig/upsell/downsell/survey**, no `CLAUDE_CODE_SESSION_KIND=bg` force-on (ccx's bg
  sessions are the fleet's, headless), no DECSTBM: non-goals, recorded.

## Surprises & Discoveries *(living)*

- The wave's founding premise was false twice over: no ≤24-row gate exists anywhere in 2.1.220,
  and the QA fleet's geometry reading was cold-vs-warm HOME flag cache (32-capture live matrix).
  Renderer choice is startup-only.
- Canon has no `<Static>` at all — the entire tree re-renders per paint; reflow upstream is a
  free consequence of the architecture. The append-only Static boundary is ccx's single deepest
  structural divergence from canon and the root of the whole Wave-R/wave-2 residue class.
- **ccx runs stock Ink 5.2.1: no scroll box (`overflow: visible|hidden` only), no stickyScroll
  attributes, no mouse, no alt-screen lifecycle** — fullscreen is a second renderer sharing the
  document and components, not a flag on the first (grounding B1).
- **Ink's tall-frame cliff bounds the whole design** (spec review C1/C2): a viewport-sized live
  window would fire the scrollback-duplication pathology on the steady-state path AND blind every
  wave-2 correction (all gated on a recorded frame the `2J` path never records). The window cap
  and the corrections-reachable assertion are load-bearing, not defensive.
- "Bottom-anchoring" upstream is one clamped assignment (`scrollTop = max(0, content−viewport)`),
  meaning tail-following — short content top-aligns. Wave R's withdrawn EP-R3 was aimed at a
  behavior canon doesn't have.
- Fullscreen quit deliberately destroys the conversation's terminal record — upstream's answer is
  a resume pointer plus the editor escape hatch, not scrollback replay.
- D-W6 narrowed again: the reserved statusLine row exists only for a configured-but-unresolved
  command — the third refinement of one row.
- **Version drift is active in this exact machinery:** installed CLI is 2.1.227 (not the assumed
  2.1.226) and its own changelog names fixes to flag evaluation and `/tui`. Canon stays 2.1.220
  unless the owner re-baselines.
- **The frame's overflow diagnostic is blind to viewport-local re-renders** (T11, measured): the
  frame re-measures only when the frame itself re-renders, and a scroll is viewport state — so a
  breached row grant fails as a silent clip of the region's last row, never as a diagnostic.
  Consequence for A6/T13: anything that changes region content without a frame re-render must
  respect the grant by construction; the diagnostic is a boot/resize-time check only.
- Canon's jump pill is a three-LENGTH ladder whose shortest rung (bare base, no arrow) is an
  unconditional fallback leaning on `wrap:"truncate-end"` to clip — not a fits-always guarantee.
  The grounding's prose described the labels but missed the trailing `↓` its own live capture
  shows; the bundle settled it (JDa, cli.pretty.js:456145–456196).
- **Held divergence — subprocess handoffs exit to the main screen; canon stays on the alt
  screen** (T12 re-review, read from canon's terminal wrapper L180653): canon's
  `enterAlternateScreen()` writes nothing when already active, so a child process (editor)
  runs ON the alternate screen with modes off and the screen cleared — no rmcup at any point.
  Our T6 guard chose the inverse bracket (EXIT_ALT → child on main screen → ENTER_ALT). Both
  recover from an editor that toggles 1049 itself; ours additionally leaves the user's shell
  scrollback reachable mid-edit. Held deliberately; every fullscreen-reachable editor caller
  must pass through the guard (four wired by T12 + its fix rounds; rule recorded in
  `externalEditor.ts`'s module header).
- A printable key bound in a background context EATS the letter from the live composer —
  `parse.ts` routes single printables through table resolution before the composer fallback.
  Canon never faced this (its `v` lives on a composer-less screen); our answer is per-action
  handler registration gated on the scrolled-up state, so the byte falls through to the
  composer whenever the affordance (the pill) isn't showing.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-12): authored from the two grounding docs + the owner's two decisions.
- v2 (2026-08-12, spec review — 5 Critical / 11 Important / 9 Minor, ALL adopted): §A1 rewritten
  around Ink's tall-frame cliff (C1: W capped and asserted; C2: corrections-reachable assertion;
  C3: item-edge granularity with the taller-than-W divergence; C5: `selfWriting` must NOT extend
  to Ink's writes — the v1 parenthetical transplanted Option-A wiring onto Option B). §A4a added
  (C4: paint model, `rows−1` slack, DECSET 2026, flicker as deliverable-or-divergence). C6: M3
  default-flip gated on pinning every tmux cell + the matrix; M0 claim corrected to claude-only.
  I1: decision order fixed (non-TTY first, screen reader above env). I2: D4/D5/D6/D10/D21
  dispositioned. I3: §A2a main-screen machinery gated off in fullscreen. I4: attach rules. I5:
  reducer unit-pinned in M1, consumers M2b. I6: M2 split a/b; milestones on cells. I7: D-F1
  over-claim withdrawn. I8: remount = subtree swap, one Ink instance, root above ChatApp. I9:
  SIGINT handler + SIGTERM interlock + F5b + driver additions. I10: env pins first-in-M2a; F6
  reworded. I11: per-context half-page. Minors: citations fixed (grounding-vs-canon prefixes),
  F3 return leg restored, commit seam named, ratchet sentence, Surprises entries (stock Ink,
  version drift), F11 non-TTY cell, F8 terminal-modes assertion, A6 ordering-not-paint note.
