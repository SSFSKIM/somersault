# Fullscreen renderer on a live-window substrate — wave design

**Purpose.** Build claude's alternate-screen (fullscreen) renderer in ccx, on a shared substrate —
a bounded **live window** over the retained transcript document — that also gives the main-screen
renderer true transcript reflow on width change (s2qa2-06). One mechanism, two renderers. This is
the largest remaining fidelity gap: a warm-home installed claude runs fullscreen at **every**
terminal size, so today ccx diverges from the real product at every geometry (owner decision
FULLSCREEN-1, 2026-08-12: **build**).

**Grounding (read before planning; line numbers are canon 2.1.220 `cli.pretty.js`):**
- `docs/superpowers/grounding/2026-08-12-fullscreen-ground.md` — the renderer transcription (gate,
  lifecycle, frame composer, scroll model, 23 surface deltas D1–D23, crash safety) + 32 live
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

- **D-F1 — substrate first.** The bounded live window (last ~viewport of rows rendered live,
  outside `<Static>`) is milestone 1, on the **main screen**, where it delivers reflow (s2qa2-06)
  and retires the residue-correction class structurally. Fullscreen builds on it.
- **D-F2 — entry policy: config knob, default ON.** ccx defaults to the fullscreen renderer with
  an opt-out to classic, matching what warm-home installed claude does at every size. Non-TTY
  auto-falls-back to classic regardless.

## Architecture

### A1. The live window (shared substrate; the D-F1 milestone)

One windowed viewport component over the one retained `TranscriptDocument`, replacing the
append-only `<Static>` boundary as the *rendering* boundary:

- The last W rows' worth of items (W ≈ viewport height, plus margin) render **live** in the
  ordinary Ink tree — Ink's own yoga re-layout re-wraps them on any width change, for free
  (canon's model: no static region at all upstream).
- **Commit policy is per-renderer.** Main screen: an item is committed to `<Static>` (terminal
  scrollback) only when it has provably scrolled out of the live window — committed rows keep
  today's contract (never repainted, hard-wrapped as-emitted; canon behaves identically: it never
  re-paints history either, reflow-ground §1 scope verdict). Fullscreen: **no commits, ever** —
  there is no scrollback on the alt screen; the window paints from the document every frame.
- The window's bottom edge is the existing pager formula (`applyPager`'s `max(0, total − height)`
  ≡ canon L179813). Sticky-bottom + follow-growth become an explicit reducer: pinned to the tail
  while at the tail; never yanked down when scrolled up; re-stick on explicit `scroll:bottom`
  (canon L179827-179836, live-verified: typing while scrolled up does not snap back).
- **Reflow acceptance rides here:** on a settled width change, the live window re-wraps
  (s2qa2-06's honest scope — visible region + future paints). The wave-2 `resizeRepaint`
  machinery keeps guarding exactly what remains its province: the committed-`<Static>` boundary
  and Ink's under-erase of the live frame during the transition (its file rule and pins are
  untouched); the settle-boundary interplay is a named plan-time task, not an afterthought
  (reflow-ground §3: a live-window repaint is a frame write — it must stand the tall count down
  and be invisible to the write-time corrector via the existing `selfWriting` seam).

### A2. Renderer selection, with provenance

A `ds()`-equivalent mirroring canon's decision order minus what ccx doesn't have (L110109):
env force-off (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` / `NO_FLICKER=false` spellings) → env
force-on (`CLAUDE_CODE_NO_FLICKER=1`) → non-TTY/screen-reader off → tmux `-CC` off → Windows-SSH
off → settings `tui: "fullscreen" | "default"` → **default: fullscreen** (D-F2; canon's statsig
slot resolves to our default). Decided **once at startup**; resize never re-evaluates it (canon
L2.1 live matrix). Every decision carries a one-word provenance reason (canon `h8e()` L110162)
surfaced in `/status`. **No CLI flag** (canon has none) and **no terminal-size input**.

### A3. Alt-screen lifecycle (canon §3.1, byte-faithful)

Enter `ESC[?1049h ESC[2J ESC[H` + the terminal-conditional kitty/modifyOtherKeys upgrade (canon's
seven-terminal list L177175); exit pops kitty, `ESC[?1049l`, resets modifyOtherKeys. Mouse-off
bytes precede everything that can throw. **The exit guarantee is non-negotiable:** a synchronous
crash-safety path (canon `zuy` L181494: mouse off unconditionally → unmount → hand-written rmcup
fallback → full terminal-mode restore, all `writeSync`) runs on SIGINT/SIGTERM/uncaught throw —
a process dying inside the alt screen with mouse tracking on breaks the user's terminal.
Subprocess handoff (`$EDITOR`, `!bash`) re-enters on return (canon L180653-180662 asymmetry).

### A4. The frame shell (canon `cZo` L455844, fullscreen branch)

One reusable container (the `/resume` launcher takeover, D18, mounts it too — factor it as a
wrapper from task one): a Box at `height = rows`, `flexShrink:0`; a `flexGrow:1` transcript
region hosting the live window; a `flexShrink:0` bottom dock capped at `floor(rows/2)` (`rows−2`
while history search is up, canon L455852); **two** overlay mechanisms (live-verified L2.6, "do
not conflate"): the absolute-bottom overlay slot under the `▔▔▔▔` seam capped `rows−2` (/model,
/help, /resume + preview) AND the dock-replacement slot (permission dialogs — composer disappears,
dialog under the normal `────` rule). Yoga-taller-than-terminal is a named caller bug, warned and
clipped (canon L180317). Frame height pinned to rows; the spare row moves to the TOP of the frame
(paddingTop 1 → sticky prompt chip's row when scrolled, canon L455893 — chip itself deferred).

### A5. Scroll model (canon §3.5, keyboard-only in this wave)

The `Scroll` context activates in fullscreen: `pageup`/`pagedown` = **half** viewport (canon
L446165 — and ccx's existing full-page mapping in `pager.ts` is a fidelity bug to fix in the same
wave, B3), `ctrl+home`/`ctrl+end` = top/bottom; arrows stay composer-history (live-verified);
disabled while history search is open (canon L446211). The **jump-to-bottom pill** ships with the
frame (absolute-bottom, centred, `"N new message(s)"` / `"Jump to bottom"` + resolved keybinding,
shown only when not sticky and not at end — canon L456145): without it a scrolled-up user in a
screen with no scrollbar and no scrollback has no way back; it is the difference between a
viewport and a trap. Ctrl+O's pager works inside the frame, and the `v`-to-`$EDITOR` transcript
dump (canon L549336) ships as the scrollback escape hatch.

### A6. Exit contract (canon §4.1/D23 + the one deliberate improvement)

Quitting paints the final frame onto the alt screen and discards it with rmcup — the conversation
does NOT replay into scrollback; pre-launch shell content is restored intact. The graceful exit
prints canon's two-line `Resume this session with: ccx --resume <id>` pointer. **Divergence,
deliberate:** ccx prints the pointer on the double-ctrl-C path too — canon's silence there is a
gap worth not copying (grounding L2.5).

### A7. Renderer switching: remount, not re-exec (decision, see log)

`/tui [default|fullscreen]` persists the setting and **remounts** under a mode-selecting root —
canon's own alt-screen exit is already a component unmount driven by the settings write (L135
"the mount/unmount of the frame container is the real enter/exit edge"); the re-exec upstream
adds is its way of getting clean renderer state, which the reusable frame container gives us
in-process. Refuse while background work runs (canon's copy, L482600). No upsell/downsell/survey
machinery (statsig-cohort product ops, not renderer behavior — recorded non-goals).

### A8. Surface deltas in scope

D1 as refined (§4.0): the statusLine row is held open **only when configured-but-unresolved**, and
only in fullscreen (the async command's row must not shove a fixed-height frame). D11 (suppress
the notification block), D12/D13 (mode-row padding/`focus` chip) — cheap, in scope. D14 (queued
prompts at the scrollable tail) in scope. **Deferred, recorded:** all mouse (D7-D9 — wheel,
click, hover, selection, auto-copy: the largest separable chunk), sticky prompt chip, `scrollHint`
hardware scroll (D22), DECSTBM renderer, FleetView's permissive gate (D19), `/focus` (D20),
upsell/downsell.

## Milestones

- **M0 (done pre-wave):** QA driver pins the renderer per launch (`2da99ef00c`).
- **M1 — the live window, main screen.** The windowed live tail + commit-on-scroll-off + the
  sticky/follow-growth reducer + reflow-at-settle. Acceptance: s2qa2-06's cell — a width change
  re-wraps the visible transcript (no mid-word hard-wrap survivors on screen); the a3/g1 matrix
  cells and the wave-2 resize suite stay green (the corrections' province shrinks but their pins
  hold); no transcript duplication into scrollback (the fullStaticOutput pathology class).
- **M2 — the frame is real.** Renderer selection + provenance; alt-screen lifecycle + exit
  guarantee (kill -INT inside the frame leaves a working terminal: mouse off, cursor shown, main
  screen restored); frame shell; scroll keys (half-page); pill; ctrl+O inside the frame; `v`
  editor escape; exit contract incl. the resume pointer on both exit paths.
- **M3 — surfaces + switching.** Both overlay mechanisms live in the frame (permission dialog
  replaces the dock; /model÷/help÷/resume in the seam slot); D1/D11/D12/D13/D14; `/tui` remount +
  refuse-while-busy; `tui` settings knob; default-ON wiring with non-TTY fallback.
- **M4 (recorded, not scheduled):** mouse; sticky chip; hardware scroll; launcher-level `--resume`
  takeover on the shared container.

## Acceptance (observable, cell-style; keyed cells over OAuth per `.env` rules)

- F1 A fresh ccx on a TTY enters the alt screen (`tmux alternate_on=1`), frame exactly `rows`
  tall, dock pinned, content top-aligned when short (the 80×40 anchor cell: blank rows BELOW
  content, above the dock).
- F2 Overflowed transcript: tail-follows during streaming; PgUp scrolls half the region and the
  pill appears; typing while scrolled up does NOT snap back; pill/`ctrl+end` re-sticks.
- F3 Resize inside the frame (80×24→100×24→80×30→120×24): re-wraps every step, dock pinned, park
  tracks height, zero stale-width artifacts (canon's clean baseline, L2.4).
- F4 `/exit` restores the main screen with pre-launch scrollback intact, conversation absent, and
  the two-line resume pointer printed; double-ctrl-C same INCLUDING the pointer (divergence).
- F5 `kill -INT` mid-turn inside the frame: terminal usable after — mouse reporting off, cursor
  visible, no alt screen. (The one failure that damages something outside our process.)
- F6 Main screen (knob off): width change at 40 rows re-wraps the visible transcript — the
  s2qa2-06 sweep cell against installed claude pinned to classic; resize matrix stays green.
- F7 Permission dialog replaces the dock (composer gone); /model renders in the seam slot with
  the transcript squeezed above; both under their canon rules.
- F8 `/tui default` from fullscreen lands on the classic renderer with the conversation intact;
  `/tui fullscreen` returns; refused while a background task runs (canon's copy).
- F9 `/status` names the renderer and its provenance reason.
- F10 statusLine configured with a slow command (`sh -c 'sleep 3; echo LATE'`): fullscreen holds
  one blank row until it resolves; classic collapses it (D1 refined — the live-unverified branch,
  now verified by this cell).

## Decision Log

- **Live-window substrate first** (owner, 2026-08-12) over separate fixes (rejected: the Option-A
  RenderLine→ANSI serializer is throwaway once the live model exists, and resizeRepaint stays
  load-bearing) and over fullscreen-first (rejected: defers a P2 sweep finding behind the biggest
  wave).
- **Default ON behind a knob** (owner) over default-off dark ship (rejected: ccx's default would
  diverge from installed claude's for another wave) and over replicating canon's flag-cache
  mechanism (rejected: a rollout accident is not product behavior).
- **Remount over re-exec** for `/tui` (controller, from grounding B5): canon's alt-screen edge IS
  a component unmount; the re-exec exists for clean renderer state that a from-task-one reusable
  frame container provides in-process. Rejected re-exec: bigger, harder to test, and its one
  advantage (guaranteed-clean state) is what M2's container is for. Revisit only if M3 finds
  state that genuinely cannot be remounted.
- **Half-page PgUp/PgDn fix** rides in this wave (canon L446165; ccx's full-page mapping is a
  pre-existing fidelity bug that becomes user-facing when these keys become the primary scroll).
- **Resume pointer on double-ctrl-C** — deliberate improvement over canon's graceful-path-only
  hint; recorded divergence.
- **No statsig/upsell/downsell/survey**, no `CLAUDE_CODE_SESSION_KIND=bg` force-on (ccx's bg
  sessions are the fleet's, headless), no DECSTBM: non-goals, recorded.

## Surprises & Discoveries *(living)*

- The wave's founding premise was false twice over: no ≤24-row gate exists anywhere in 2.1.220,
  and the QA fleet's geometry reading was cold-vs-warm HOME flag cache (32-capture live matrix).
  Renderer choice is startup-only.
- Canon has no `<Static>` at all — the entire tree re-renders per paint; reflow upstream is a
  free consequence of the architecture, not a feature. The append-only Static boundary is ccx's
  single deepest structural divergence from canon and the root of the whole Wave-R/wave-2 residue
  class.
- "Bottom-anchoring" upstream is one clamped assignment (`scrollTop = max(0, content−viewport)`),
  meaning tail-following — short content top-aligns. Wave R's withdrawn EP-R3 was aimed at a
  behavior canon doesn't have.
- Fullscreen quit deliberately destroys the conversation's terminal record (final frame painted
  onto the alt screen, discarded by rmcup) — upstream's answer is a resume pointer plus the
  editor escape hatch, not scrollback replay.
- D-W6 narrowed again: the reserved statusLine row exists only for a configured-but-unresolved
  command (async row must not shove a fixed frame) — the earlier "alt-screen always reserves it"
  was already a correction of a correction; this is the third refinement of one row.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1 (2026-08-12): authored from the two grounding docs + the owner's two decisions; spec review
  pending.
