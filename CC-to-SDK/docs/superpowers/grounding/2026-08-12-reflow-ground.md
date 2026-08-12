# Reflow grounding (s2qa2-06) — persisted verbatim from the read-only Explore agent, 2026-08-12

## 1. Canon (/Users/new/claude-code-bundle/2.1.220/cli.pretty.js)

2.1.220 has NO Ink <Static> and no log-update at all. The main screen renders the entire React tree
into a cell frame every paint; the frame's screen may be taller than the viewport:
- qhs (renderer factory) L180316: `let E = ...getComputedWidth(), A = ...getComputedHeight(), H = o.altScreen ? c : A;`
  off alt-screen the frame height IS the whole document's yoga height; L180330 returns
  `screen: k, viewport: { width: l, height: ... }`.
- SAr (L421325) is NOT Static — just an isStatic context provider. Zero fullStaticOutput/staticOutput in bundle.

Resize trigger — every signal, width-or-height, no debounce beyond a 16 ms throttle:
- L180674 ensureInteractive: `this.options.stdout.on("resize", this.handleResize)`
- L180644 `handleResize = () => { if (!this.syncTerminalSize()) return; if (this.currentNode !== null) this.render(this.currentNode); }`
- L180629/180633 hasStaleTerminalSize()/syncTerminalSize() — no-op when cols and rows unchanged.
- Re-layout at new width in onComputeLayout L180607: `i.setWidth(this.terminalColumns), i.calculateLayout(this.terminalColumns)`
  → every text node re-wraps (ink-text wrap path L179771+).
- `scheduleRender = tFu(n, G5, {leading:!0, trailing:!0})`, G5 = 16 (L177190). Only debounce.

Width-change branch is an unconditional full reset (Chs.render, L178320-178321):
  if (t.viewport.height < e.viewport.height || t.viewport.height > e.viewport.height && a
      || e.viewport.width !== 0 && t.viewport.width !== e.viewport.width)
    return TJr(t, "resize", i, r, u);
(any width delta either direction, any height shrink, height grow when prev doc filled the viewport;
not verdict-gated, not content-gated.)

What the reset emits (TJr, L178440-178443):
  function TJr(e, t, r, n, o, i) {
    let s = n ? 0 : Math.min(o, Math.max(0, e.screen.height - e.viewport.height + 1)),
        a = new Ihs({ x: 0, y: s }, e.viewport.width);
    return ABu(a, e, s, e.screen.height, r),
      [{ type: "clearTerminal", reason: t, altScreen: n, viewportRows: e.viewport.height, debug: i }, ...a.diff];
  }
- n = altScreen. Main screen: s = min(u, screenHeight − viewportHeight + 1), u = l + c,
  l = max(0, prevScreenHeight − min(prevVp, nextVp)), c = (prevScreen >= prevVp ? 1 : 0) (L178317).
  Re-emits document rows s..screenHeight — the tail that fits the viewport — via ABu (L178444).
- clearTerminal resolved by screen mode in Dms L177120-177121: `s += a.altScreen ? Rms() : yJr(a.viewportRows)`.
  - Rms() L176982 = ESC[2J ESC[3J ESC[H — ALT-SCREEN ONLY; lsr = ESC[3J (L166402) wipes scrollback.
  - yJr(rows) L176988 = ESC[H + (ESC[2K ESC[1B)×viewportRows + ESC[H — in-place viewport wipe,
    never touches scrollback.
- L180747 turns each clearTerminal into a `flickers` telemetry entry.

### SCOPE VERDICT (load-bearing)
Canon re-wraps the VISIBLE REGION (plus everything below it in the document), not the scrollback.
The re-wrap is real and total — the whole retained React document re-lays-out at the new width —
but only rows s..end (≈ one viewport's worth, the tail) are re-emitted, into a viewport erased
row-by-row with ESC[2K. Rows already scrolled above the viewport stay as the terminal left them;
canon never emits ESC[3J on the main screen and never re-paints history. At a 40-row cell the whole
session usually fits inside s..end — why the sweep read it as "fully re-wraps history".
ccx feature = "re-wrap what's on screen + everything painted from now on", NOT "re-wrap scrollback".

## 2. ccx seam inventory (harness/src/tui/)

- One retained document: replay.ts:36 replayDocument() → TranscriptDocument; live rows appended in useChat.ts.
- Projection is width-parameterised: useChat.ts:199 projectionContext() = ({ ..., columns: columnsFn(), ... });
  toolRenderer.tsx:1045 projectCompact / :1071 projectPending. Lines hard-wrapped at projection time
  (speciesLines(..., {width}), userEchoLines(..., {width})); Line.tsx renders through <Text> with no
  re-wrap authority. ⇒ re-projecting at a new width genuinely re-wraps.
- Static is append-only, publication one-way: Transcript.tsx <Static items={staticItems}>;
  useChat.ts:854 reconcile() filters by publishedIds, only ever setStaticItems(s => [...s, ...unseen]).
- The ONE existing "make Static re-emit" seam: useChat.ts:943 replaceDocument(next):
  opts.clearStaticTranscript?.() (Ink app.clear(), bridged chatMain.tsx:336-346 DeferredClearBridge)
  → documentRef.current = next → publishedIds.current = new Set() → setStaticItems([])
  → setStaticEpoch(e=>e+1) → reconcile(). Remount key ChatApp.tsx:775 <Transcript key={state.staticEpoch}>.
  /clear works because the new document is EMPTY (useChat.ts:2640).
- Rewind = existing precedent for full re-emit: useChat.ts:2290-2303 — app.clear() cannot erase rows
  scrolled out of viewport, so rewind does the real wipe (2J/3J/H, useChat.ts:651 clearScreen) —
  the ONLY caller of the scrollback wipe.
- Viewport-only erase already exists, byte-identical to canon: clearViewport.ts:40 eraseViewport(rows)
  = ESC[H + (ESC[2K ESC[1B)×rows + ESC[H; clearViewport.ts:51 forces the repaint through Ink's
  writeToStdout so log-update's counters keep describing the screen.
- Output proxy/resize plumbing: chatMain.tsx:119 createResumeSafeStdout (frame, widthAtPaint,
  parkedCol, tall), chatMain.tsx:421 createResizeRepaint, :434-435 onTerminalResize attached BEFORE Ink's.
- Ink's tall-frame branch is ccx's only whole-history re-emit today, and a bug source:
  chatMain.tsx:141-190 — Ink writes clearTerminal + fullStaticOutput + output; ccx strips the ESC[3J
  (chatMain.tsx:228), so every tall render APPENDS one complete copy of the session's static output
  to scrollback (measured 88 → 172 → 256 → 340). Any reflow design reaching for fullStaticOutput
  inherits exactly this.

## 3. Interaction boundary with resizeRepaint / wave-2

resizeRepaint.ts assumes: the painted frame stays hard-wrapped and Ink under-erases it. Every
emission measures residue as physicalRows(frame, narrowWidth) − inkErases(frame):
- frameWriteCorrection (:129) — synchronous, per frame write, gated verdict === "reflow" && width < widthAtPaint.
- correctionAfterRepaint (:142) — first shrink, once the probe answers.
- correctionAtSettle (:188) + repairAtSettle (:266) — burst pass at RESIZE_SETTLE_MS = 80 (:153),
  direction-independent, uses remembered frameAtNarrowest.

Boundary: a viewport-wide erase-and-repaint SUPERSEDES all three for that resize. After it there is
no residue; any correction erasing upward from the new frame lands on rows the reflow pass just
declared live — the over-erase class the file refuses (:6-9, :299-319, :339-349). Concretely:
- Reflow pass runs AT the settle boundary (reuse the trailing timer; it has verdict, last frame,
  park, live size) and must call endBurst().
- Its own write must be invisible to the write-time corrector — mechanism exists:
  ResizeRepaint.verdict() returns undefined while selfWriting (:222-226, :240, :373).
- A reflow repaint needs NO reflow verdict: viewport-bounded, hence scrollback-safe by construction
  (same argument as ChatApp.tsx:519-527 grow-edge resync). Canon agrees: reset fires on width delta alone.
- frameWriteCorrection still earns its keep for INTERMEDIATE frames during a drag (before settle);
  correctionAfterRepaint/correctionAtSettle become largely dead weight where the reflow pass runs —
  keeping both live is a double-erase hazard.
- Also in blast radius: ChatApp.tsx:559 resyncAfterGrow (needs physicalRows(frame)+1 <= rows) and the
  tallWrites latch — a reflow repaint is a frame write and should stand tall down / call screenResynced().

## 4. Feasibility sketch — smallest honest mechanism

NAIVE MOVE IS WRONG: "bump staticEpoch + reset publishedIds + re-project at new width" re-emits the
ENTIRE document — one full duplicate of the session appended below the old hard-wrapped one (the
fullStaticOutput pathology with a different trigger). Only honest paired with the rewind wipe
(2J/3J/H) which destroys pre-launch scrollback — acceptable for rewind, unacceptable for resize.

OPTION A (canon-shaped, one-shot tail repaint): at settle — eraseViewport(rows) → emit the last
(rows − liveFrameRows) rows of projectCompact(document, {columns: newWidth}) → hand Ink's lastOutput
back through writeToStdout so log-update's counters describe the screen (clearViewport.ts:22-35
contract). Matches canon's scope; touches no scrollback. Costs: (i) NO RenderLine→ANSI serializer
exists — needs a new pure renderer agreeing byte-for-byte with Line.tsx's theme/SGR handling;
(ii) ccx cannot know exactly which document rows are visible (Static's committed rows are
terminal-owned) — the tail count is an estimate; bounded and safe (viewport erased first; worst case
repeats rows that also exist in off-screen scrollback), but not exact like canon's s.

OPTION B (architectural, the canon model): canon has no Static — the visible tail is LIVE,
re-laid-out every frame. ccx equivalent: a bounded live window — keep the last ~viewport-worth of
RenderItems OUT of <Static> in the ordinary Ink tree, committing to Static only once they provably
scroll off. Width change then re-wraps them free through Ink's own layout; option A's serializer and
arithmetic vanish. Much larger change; also retires most of resizeRepaint.ts (the residue class
exists because the frame is small and the history is committed).

RECOMMENDATION: scope the feature as "visible region + future paints" (canon's actual scope — say it
in the spec; removes most of the perceived size), prototype (A) behind a flag at the RESIZE_SETTLE_MS
boundary with endBurst() + selfWriting stand-down, treat (B) as the direction of travel.
