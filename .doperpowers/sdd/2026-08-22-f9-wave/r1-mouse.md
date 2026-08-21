# R1 — The fullscreen mouse remainder: a two-sided mechanism map

Canon: `/Users/new/claude-code-bundle/2.1.236/cli.pretty.js` (735,247 lines). Every canon claim below
carries an `L<n>` cite. ccx paths are relative to
`/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/`.

**Headline.** Canon does **not** disarm mouse reporting to let the terminal select. It arms the *maximum*
tracking set (1000+1002+1003+1006) by default and runs a **complete in-process selection engine** —
anchor/focus over the rendered screen buffer, word and line multi-click, a per-cell `noSelect` mask, a
soft-wrap-aware text extractor, selection-background repaint, and **auto-copy on mouse-up** behind a
default-on user setting `copyOnSelect`, delivered through native clipboard tools *and* OSC 52 with tmux/screen
passthrough. Hover is not decoration: it is a React context that **cancels `dimColor` on every `<Text>` inside
the hovered subtree**, plus a per-theme brighter background token. Click-to-caret is a layout-relative
`localCol`/`localRow` handed to the same measured-text engine the composer already uses for wrapping.

ccx today arms exactly the subset canon itself names `"scroll"` — which is also exactly what canon's
`CLAUDE_CODE_DISABLE_MOUSE_CLICKS` env var selects (L126012). So ccx's fullscreen is, in canon's own
vocabulary, permanently running in a degraded mode canon ships as an opt-out.

---

## 1. ccx today

### 1.1 What is armed, and when

`src/tui/altScreen.ts`:

- `:56` `MOUSE_ON_SCROLL = "\x1b[?1000h\x1b[?1006h"` — **1000 (normal button reporting, carries the wheel) +
  1006 (SGR encoding)**. No 1002, no 1003, no 1004.
- `:37` `MOUSE_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l"` — all four, SGR first, unconditionally on
  every teardown (canon `Gpe` L177070).

The enable has **no independent call site**: it is concatenated into the alt-screen enter string at `:166`
(`ENTER_ALT + kittyUpgrade(...) + MOUSE_ON_SCROLL`), so arming and the alternate screen are the same write.
Written by `takeScreen()` `:169` / `enter()` `:204`; disarmed by `handBack()` `:175` and `leaveScreen()` `:189`
(signal handlers `:215`, `process.on("exit")` `:239`).

Armed **only** when `guard.enter()` runs: `src/tui/chatMain.tsx:924` (boot, if fullscreen) and `:622` (`/tui`
live flip). **Classic/inline mode never arms mouse reporting at all.** There is **no mouse-specific setting or
env var** in ccx; the only lever is whatever forces classic rendering (`src/tui/renderer.ts:189-200`:
`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, `CLAUDE_CODE_NO_FLICKER`, screen reader, non-TTY, tmux control mode,
Windows-over-SSH, the `tui` pref).

### 1.2 What the parser decodes

`src/tui/keys/parse.ts`, `SGR_MOUSE_RE = /^\x1b\[<([\d;]*)([Mm])/` `:57`, dispatched at `:104-108` as
`sgrWheel(...) ?? sgrClick(...) ?? ignored("mouse", raw)`. Legacy X10 `\x1b[M`+3 bytes → `ignored` `:109`.

`sgrWheel` `:150-162` produces a **`KeyEvent`**, not a mouse event: `wheel = button & 67`, only `64`→`wheelup`
and `65`→`wheeldown` (66/67 wheel-left/right excluded); modifiers from bits 16/8/4; **col/row are discarded**
(recorded divergence `:147-149`).

`sgrClick` `:183-192` produces `MouseInputEvent`, with four rejection terms `:188`:

| term | dropped | note |
|---|---|---|
| `button & 64` | wheel | makes the two decoders order-independent |
| `button & 128` | extended buttons 8-11 | side back/forward |
| `button & 32` | **all motion and drag reports** | defensive; 1002/1003 never armed |
| `(button & 3) === 3` | "no button" release | not guessed |

Plus shape guards: exactly 3 integer params, `col >= 1 && row >= 1`.

`MouseInputEvent` (`src/tui/keys/types.ts:26-29`) carries
`{ kind:"mouse"; action:"press"|"release"; button:0|1|2; col; row; ctrl; alt; shift; raw }` with **1-based**
terminal coordinates passed through undisturbed. No `super` bit.

**So: press and release only, left/middle/right, no motion, no drag, no wheel position.**

### 1.3 Routing

`stdin.on("data")` (`KeymapProvider.tsx:388-398`) → `emit` `:246-260` → `parseBytes` → `dispatch` `:164-235`.
Order of gates: wheel guard first `:170`; `ignored` dropped `:173`; ctrl+z `:176`; `swallowContexts` `:177`;
then `:212-217`:

```ts
if (ev.kind === "mouse") { clearChord(); if (swallowed) return; mouseHandler(reg)?.(ev); return; }
```

A gesture clears a pending chord; a swallowing surface swallows clicks. Mouse events are never matched against
the key table and never bindable. `registry.ts:98-100` resolves to the **innermost live sink only**
(`newestFirst(mouseSinks).find(m => m.active)`). Press/release are *not* paired here.

`src/tui/keys/wheelGuard.ts:24-35` drops a bare `up`/`down` arrow within 75 ms of a wheel tick — the
alternate-scroll echo that 1000-arming otherwise produces.

### 1.4 The one click path that exists

Click-to-expand a folded tool cluster, end to end:

1. **Tag.** `toolRenderer.tsx:60-65` — every `RenderItem` optionally carries `foldAnchor` (the `FoldGroup`'s
   earliest-issued call id, chosen `:845`/`:873` because it survives reorder and `wrapItems.ts:163`).
2. **Row origin.** `FullscreenFrame.tsx:126-135` — `RegionTopContext`, provided `:311` as
   `bounded ? REGION_TOP_ROW(=1) : 0`. A **computed constant, not a measurement** (`:107-112`: Ink exposes no
   absolute positions). Default `0` means "not addressable" and is the renderer gate.
3. **Publish the hit map.** `FullscreenViewport.tsx:185-192` `hitRowsOf(slices, columns)` — index *is* row
   number, so absent entries are kept. A `"line"` item yields one `{anchor, width}`; a `"gutter-block"` yields
   one **per painted body row**. Width is the *painted extent* via `stringWidth` (not `.length`). Published
   once per render at `:338` from the same `slices` being painted, so map ≡ paint.
4. **Look up.** `anchorAt(col,row)` `:256-261`: `top <= 0` → undefined; `painted[row - top]`; require
   `col >= 1 && col <= at.width`.
5. **Tap state machine.** `ChatApp.tsx:880-895`. Gate `:882`
   `clickable = fullscreen && composerOwns(inputOwnerRef.current) && !footerState.searching`, re-checked on
   every event. `:884-895`: clear anchor on every event; bail on `button !== 0 || ctrl || alt || shift` (a
   modified click also kills an in-flight tap); on press arm `{col,row,anchor}`; on release require **same col,
   same row, and same resolved anchor** → `toggleFold(anchor)` (`useChat.ts:310-314`). A wheel tick calls
   `discardTap` (`FullscreenViewport.tsx:296-297`).

**There is no other click consumer.** `useMouseSink` has exactly one call site. `src/tui/osc8.ts` only *emits*
hyperlink bytes — activation is the terminal's job and never reaches ccx. JumpPill, dialogs, `RegionPager`,
`Select`/`MultiSelect` are keyboard-only; `MultiSelect.tsx:234` says so explicitly.

### 1.5 What does not exist

No hover, no motion, no drag, no selection, no click-to-caret, no OSC 52 (zero hits for `\x1b]52` under
`src/`). Copy is out-of-band only: `src/tui/copy.ts:5-18` spawns `pbcopy`/`xclip`/`clip`, called from `/copy`
and `/export clipboard`. `selectionBg` in `theme.ts:45,53,61,69` is a color token with no consumer.

`src/tui/keys/bindings.ts:147`: *"Click, motion, hover and selection remain unbound and unarmed."*

---

## 2. Canon 2.1.236

### 2.1 Tracking modes and when they are armed

The mode table, L199043:

```js
nx = { CURSOR_VISIBLE:25, ALT_SCREEN:47, ALT_SCREEN_CLEAR:1049, MOUSE_NORMAL:1000,
       MOUSE_BUTTON:1002, MOUSE_ANY:1003, MOUSE_SGR:1006, FOCUS_EVENTS:1004,
       BRACKETED_PASTE:2004, THEME_NOTIFY:2031, SYNCHRONIZED_UPDATE:2026 };
```

Three composed strings, L199044:

| name | value | modes |
|---|---|---|
| `ofS` | `"full"` | `?1000h ?1002h ?1003h ?1006h` |
| `ifS` | `"scroll"` | `?1000h ?1006h` |
| `Lke` | off | `?1006l ?1003l ?1002l ?1000l` (SGR first) |

Selector `IXe(mode)` L199031-199039: `"full"`→`ofS`, `"scroll"`→`ifS`, `"off"`→`""`.

**Default is `"full"`.** The `<AltScreen>` component `H0t` L663070:
`Jmn = Y7E === void 0 ? "full" : Y7E`. The main app passes `G_e()` (L678694), which is the entire
user-facing escape hatch, L126009-126016:

```js
function G_e() {
  if (V.CLAUDE_CODE_DISABLE_MOUSE !== void 0)        return V.CLAUDE_CODE_DISABLE_MOUSE ? "off" : "full";
  if (V.CLAUDE_CODE_DISABLE_MOUSE_CLICKS !== void 0) return V.CLAUDE_CODE_DISABLE_MOUSE_CLICKS ? "scroll" : "full";
  return "full";
}
```

**1004 (focus events) is armed separately** (`V2n`/`qnr`, L199044) and is not part of the mouse set.

**Alt-screen-only.** `setAltScreenActive(e, t)` L203226: `this.altScreenMouseTracking = e ? t : "off"`. Every
mouse consumer early-returns on `!this.altScreenActive` — `dispatchClick` L203399, `dispatchHover` L203405,
`handleMultiClick` L203450, `handleSelectionDrag` L203466, `moveSelectionFocus` L203364, `getHyperlinkAt`
L203437. Fullscreen itself is gated by `Ps()` L125899 (screen reader, `tmux -CC`, crash-auto-off,
`CLAUDE_CODE_NO_FLICKER`, …), so no fullscreen ⇒ no mouse.

**Re-arm points** (this is where ccx's "rides the screen" invariant and canon's differ): canon re-writes
`IXe(...)` on resume L202767, on `reassertTerminalModes` L203273-274, on `reenterAltScreen` L203296, and on
alt-screen enter L202758/202759. `reassertTerminalModes` is wired as `onStdinResume` (L203513) and fires on the
arrow-burst heuristic L199615-199617 — a terminal that ate the modes gets them back.

**In `"scroll"` mode, button reports are dropped at the door**, L199637:

```js
if (yca(), e.props.getMouseMode?.() === "scroll" && (a.button & 3) === 0) continue;
```

Left-button press/release never reaches the handler. Wheel (button 64/65) and right/middle still do.

### 2.2 The master handler `UfS`

L199667-199738. `n = col - 1`, `o = row - 1` (**0-based**, unlike ccx's 1-based passthrough); `i = button & 3`.

**Press branch:**

| condition | behaviour | line |
|---|---|---|
| `(button & 32) && i === 3` — motion, no button | end any drag; **dedupe against `lastHoverCol/Row`**; `onHoverAt(n, o)` | L199670-199677 |
| `i !== 0` and not a drag | reset `clickCount`; right-click (i=2) on windows/wsl/linux → copy selection if any, else paste clipboard; middle-click (i=1) on linux → paste PRIMARY | L199678-199701 |
| `(button & 32)` — drag with button held | `onSelectionDrag(n, o)` | L199703-199706 |
| left press, `clickCount >= 2` | cancel pending hyperlink; `onMultiClick(n, o, clickCount===2 ? 2 : 3)` | L199710-199716 |
| left press, single | `onSelectionStart(n, o)`; record `lastPressHadAlt = (button & 8) !== 0`; `onSelectionChange()` | L199717 |

Multi-click detection L199709: within `vCp = 500` ms **and** within `TCp = 1` cell in both axes
(L199769-199770).

**Release branch** L199719-199738:

- non-left release: if dragging, stop dragging + notify. Nothing else.
- left release: `EUr(r)` stops the drag. Then **if there is no real selection but there was an anchor**
  (`!yze(r) && r.anchor`) → this was a *click*, not a sweep:
  - `onClickAt(n, o)` — if it returns false (nobody consumed it), fall through to
  - `getHyperlinkAt(n, o)`, and if a link is there and the platform allows, open it after a `vCp`=500 ms timer
    (so a double-click can cancel it). Gated on `(button & 24) !== 0` (ctrl or meta) **or**
    `macCmdClickArrivesWithoutSgrModifierBit()`.
- always `onSelectionChange()`.

**There is no auto-copy here.** Release only ends the drag. Auto-copy lives one layer up (§2.5).

### 2.3 Hover brighten — what changes, exactly

Dispatch `kCP` L200164-200182:

```js
function kCp(e, t, r, n, o = !1) {
  let i = new Set, s = DUr(e, t, r) ?? void 0;                    // hit-test the layout tree
  while (s) {
    let a = s._eventHandlers;
    if ((a?.onMouseEnter || a?.onMouseLeave) && !(o && s.attributes.hoverIgnoresBlankCells)) i.add(s);
    s = s.parentNode;                                             // collect the whole ancestor chain
  }
  for (let a of n) if (!i.has(a)) { n.delete(a); if (a.parentNode) a._eventHandlers?.onMouseLeave?.(); }
  for (let a of i) if (!n.has(a)) { n.add(a); a._eventHandlers?.onMouseEnter?.(); }
}
```

A persistent `hoveredNodes` set on the renderer, diffed per motion report; **leave fires before enter**. The
5th arg `o` is "the cell under the pointer is blank" (computed by `dispatchHover` L203405-203409 via
`znr(this.frontFrame.screen, e, t)`), and `hoverIgnoresBlankCells` on a node opts it out of blank-cell hover.

`DUr` L200080-200106 is the hit test: recursive over `cachedLayout` rects (`x,y,width,height`), **children
last-to-first** so later siblings win, with `hasAbsoluteDescendant` letting absolutely-positioned children
escape their parent's rect, depth-capped by `xLt`.

**Two distinct visual changes:**

**(a) Background token swap.** The theme carries a *pair*, L188034 and the sibling palettes:

| theme | `userMessageBackground` | `userMessageBackgroundHover` |
|---|---|---|
| light | `rgb(240,240,240)` | `rgb(252,252,252)` |
| light-ansi | `ansi:white` | `ansi:whiteBright` |
| dark-ansi | `ansi:blackBright` | `ansi:white` |
| dark | `rgb(55,55,55)` | `rgb(70,70,70)` |
| light-daltonized | `rgb(220,220,220)` | `rgb(232,232,232)` |

Used at L562653, L562668 (footer/expand buttons), L562779 (transcript rows), L670351, L670612, L670801.

**(b) The real "brighten": hover cancels `dimColor`.** `<Text>` reads a hover context and, L203979:

```js
QmS = jkp && !Ykp ? $Ur.inactive : bsi(QAa, $Ur);   // jkp = dimColor, Ykp = useContext(Ssi)
```

`Ssi` is a boolean context defaulting `false` (L203997). The transcript row provides it, L562783:

```js
onMouseEnter: s ? () => l(e) : void 0, onMouseLeave: s ? () => c(e) : void 0,
hoverIgnoresBlankCells: !o,
children: jsx(Ssi.Provider, { value: i && !o, children: renderItem(t, r) })
```

So hovering a transcript row makes **every dimmed `<Text>` in that row's whole subtree render at full
colour** — one context flip, no per-element wiring. (`i` = hovered, `o` = expanded; an already-expanded row is
already bright, so the context is suppressed.)

**What reacts to hover:** transcript message rows (L562779-562783, which also take `onClick` → expand, with
`if (d.hyperlinkUrl) return d.allowDefault()` deferring to the link path); FleetView session rows, group
headers, folds and "new session" rows, where hover **moves the keyboard selection** —
`kh = () => ic(true)` → `M.hoverTo(co, Nt)` (L667710, L667715, L667719, L667724) and the row takes
`backgroundColor: Zs`; suggestion lists (L536310 `onMouseEnter: () => l(R.id)` → `hoveredId`); and roughly
twenty dialog/button/footer sites (L495607, L496535, L496754, L524979, L529407, L532420, L539185, L540289,
L562661, L562681, L603628, L603689, L603753, L603792, L603862, L604525, L604570, L605673, L605917).

`onClick`/`onMouseEnter`/`onMouseLeave` are first-class `<Box>` props (L199437, L199442) and live in the
`rka` "these are event handlers, not style" set L197102.

### 2.4 Drag selection — canon owns the engine

Canon does **not** disarm to let the terminal select. It selects itself, over the **rendered screen buffer**.

**State** L198549 `g0p()`:
`{ anchor, focus, isDragging, anchorSpan, scope, scrolledOffAbove/Below, scrolledOffAboveSW/BelowSW,
lastPressHadAlt, virtualAnchorRow/Col, virtualFocusRow/Col }`.

**Scope — how a selection is kept inside a box.** `SAa(rootNode, col, row)` L200113-200133 hit-tests, then
walks *up* the ancestor chain looking for `style.selectionScope`; when found, `x1 = floor(layout.x) + border +
padding`, `x2 = ceil(layout.x+width) - border - padding`; then every further ancestor with
`overflowX/overflow` of `hidden` or `scroll` **narrows** `x1`/`x2`. Every column is clamped through this
(`vUr` L198559: `scope ? clamp(col, x1, x2-1) : col`). `selectionScope: true` is set on the scrollable
transcript container L539032 and L676030. This is how a sweep never picks up the frame border or a neighbour
column.

**Press** `Eka(sel, col, row, scope)` L198550: set `scope`, `anchor = {col: clamped, row}`, `focus = null`,
`isDragging = true`, reset everything else.

**Drag** L203463-203471: if `anchorSpan` is set (a word/line was double/triple-clicked) use `w0p` so the
selection grows in whole words/lines; otherwise `y0p` L198553 sets `focus = {col: clamped, row}` — with the
nicety that a focus identical to the anchor is *not* recorded, so a plain click never becomes a
zero-width selection (this is exactly the `!yze(r) && r.anchor` test the release branch uses to tell a click
from a sweep).

**Double-click = word.** `handleMultiClick` L203446-203456 → `b0p` L198643-198650 → `_0p` L198598ff, which
walks outward from the cell over the screen buffer using a character class `Lii` L198578
(`0` = space, `1` = word char per `tfS = /[\p{L}\p{N}_/.\-+~\\]/u` L198741, `2` = other), stopping at
`noSelect` cells, and handles double-width cells by stepping back one column. Sets
`anchorSpan = {lo, hi, kind:"word"}`. **Triple-click = line** via `T0p` L198775.

**Hyperlink-aware word select:** `_0p` first tries `v0p` (the OSC-8 span at that cell) and, if present, selects
the whole link L198615-198617.

**Per-cell opt-out:** the screen buffer carries a `noSelect: Uint8Array` mask, consulted in `_0p` L198606,
`bka` L198663, and the repaint `x0p` L198941. Set by `noSelect: true` on a Box (e.g. the jump pill, L562661).

**Rendering the selection** — `x0p` L198930-198947: for every row in `[start.row, end.row]`, for every column
in the clamped range, skip `noSelect` cells, then
`SUr(screen, col, row, style.withSelectionBg(cellStyleId))`. The selection background comes from the theme
token `selectionBg` (light `rgb(180,213,255)`, dark `rgb(38,79,120)`, ansi `ansi:cyan`/`ansi:blue`) installed
via `setSelectionBgColor` L203351-203359 by the `Hts` hook L551459-551464.

**Screen cells → text** — `R0p(selection, screen)` L198893-198911. It walks rows `start.row..end.row`,
slicing each at the clamped column bounds, and joins with a **soft-wrap-aware** joiner `Tka`: the screen
carries a `softWrap` array per row (`vka` L198687), and `Hii(softWrap[row], range)` classifies each boundary
as `HardBreak` / `Continuation` / `ContinuationElidedSep` (`hze` L198542). So a wrapped paragraph copies as one
line, a real newline as a newline. Rows that scrolled out of the viewport mid-drag are preserved in
`scrolledOffAbove/Below` by `Cka` L198912-198929, which snapshots their *text* (not their cells) before they
are lost — that is how a drag can select more than a screenful.

**Styling is stripped**: the extractor reads `char` per cell (`A0p`), never the style ids. Copy is plain text.

**Keyboard selection too**: `moveSelectionFocus(dir)` L203362-203396 supports
left/right/up/down/lineStart/lineEnd with wrap at the scope bounds, exposed as `moveFocus` L205094.

**Selection lifetime** — `Kjh(sel, copyOnSelect)` L551382-551395:

```js
if (r.ctrl && !r.shift && !r.meta && r.key === "c") { copyOnSelect ? e.clearSelection() : e.copySelection(); r.consume(); return; }
if (oNw(r)) e.clearSelection();
```

Ctrl+C **copies** when `copyOnSelect` is off, and **clears** when it is on (already copied). Any other
"ordinary" key clears the selection — `oNw` L551372-551380 is the allow-list that does *not* clear:
`escape`, `pageup`/`pagedown`, `ctrl+home`/`ctrl+end`, and arrow/home/end with `shift`/`meta`/`super` (the
selection-extension chords). Wired at L666676 with `Kjh(Jo, ar().copyOnSelect ?? !0)`.
`"selection:clear"` is also a named action in the `Scroll` context, L551399-551404.

### 2.5 Auto-copy on release

`Lts(sel, enabled, onCopied, ref)` L551426-551457 — subscribes to selection change:

```js
if (a?.isDragging) { latch = false; return; }          // wait for mouse-up
if (!hasSelection())  { latch = false; return; }
if (latch) return;                                      // copy exactly once per selection
if (!(ar().copyOnSelect ?? !0)) return;                 // the setting, default TRUE
let u = e.copySelectionNoClear();                       // keeps the highlight on screen
if (!u || !u.trim()) { latch = true; return; }
latch = true; be("clipboard_write"); onCopied(u);
```

So: **auto-copy fires on mouse-up (the first non-dragging notify with a non-empty selection), once, and does
not clear the highlight.**

**Both channels, always.** `yP(text)` L188574-188591:

- If **not** SSH → `gTp(text)` L188592-188631 fires the native tool: macOS `pbcopy`; linux
  `wl-copy` (+`--primary`) / `xclip -selection clipboard` *and* `primary` / `xsel` / a native addon, chosen by
  a cached probe `uTp` L188618ff; wsl/windows `powershell -Command <aTp>`.
- **And in every case** it returns an OSC 52 string for stdout: tmux → `ESC]52;c;<b64>ST` **plus** the same
  wrapped in tmux DCS passthrough (`Fq` L188463); screen → DCS-chunked at `sTp` bytes; otherwise plain
  `ESC]52;c;<b64>` via `tI` L188457 (kitty gets `ST`-vs-`BEL` handling).

The caller writes that string: `copySelectionNoClear` L203310-203317 does
`yP(text).then(t => { if (t) this.options.stdout.write(t); })`.

**Toast** `Mts` L551407-551424, keyed by `i2n()` L188518-188530 (`"native"` when not SSH and the platform tool
exists, else `"tmux-buffer"` when `$TMUX`, else `"osc52"`):

- `copied N chars to clipboard`
- `copied N chars to tmux buffer · paste with prefix + ]`
- `sent N chars via OSC 52 · if paste fails, hold <mod> while selecting for native copy`

where `<mod>` is `n2n()` L188443-188456: `Fn` on Apple Terminal, `Option` on iTerm2, `Shift` elsewhere. **This
is canon's answer to "you took my terminal selection": not a disarm, but a documented modifier bypass.**

### 2.6 Click-to-position-cursor

The plumbing is `CCp` L200134-200163 — click dispatch:

```js
let i = DUr(e, t, r) ?? void 0;                          // innermost node under (col,row)
// walk up to the nearest tabIndex holder and focus it
let s = new e$n(t, r, cellIsBlank, hyperlinkUrl), a = false;
while (i) {
  let l = i._eventHandlers?.onClick;
  if (l) {
    let c = i.cachedLayout;
    if (c) { s.localCol = t - c.x; s.localRow = r - c.y; }   // ← coordinate made layout-relative
    s.defaultAllowed = false; l(s);
    if (s.didStopImmediatePropagation()) return !s.defaultAllowed;
    if (!s.defaultAllowed) a = true;
  }
  i = i.parentNode;
}
return a;                                                 // true = consumed; false lets the hyperlink path run
```

Two things matter: **`localCol`/`localRow` are recomputed per handler as it bubbles**, so each ancestor sees the
click in *its own* box coordinates; and the return value is what `UfS` L199725 tests before falling through to
hyperlink opening. The event also carries `cellIsBlank` and `hyperlinkUrl` and an `allowDefault()`.

**The composer**, L607573-607578:

```js
let ic = useCallback((Or) => {
  if (fe) return;
  ut(vHc);                                    // dismiss whatever overlay
  if (!j) return;                             // j = the text
  let So = Uf.fromText(j, ii, Me),            // ii = inner width, Me = cursor char
      ts = So.getViewportStartLine(wl),       // wl = maxVisibleLines → the composer's own scroll offset
      dl = So.measuredText.getOffsetFromPosition({ line: Or.localRow + ts, column: Or.localCol });
  We(dl);                                     // set cursor offset
}, [j, ii, fe, Me, wl, ut]);
```

That is the whole answer: **reuse the same measured-text object the composer already uses to wrap**, add the
viewport's start line to `localRow`, and ask it for the string offset at `{line, column}`. No separate
wrapped-line bookkeeping.

**The search/filter input** L539383-539394 shows the prefix arithmetic explicitly:

```js
let S = `${o} ${e}`, v = o.length + 1;              // prefixed string; v = prefix width
let y = a ? 0 : 2, _ = a ? 0 : 1;                   // borderless ? 0 : paddingX+border, borderY
let E = useMemo(() => NXi(S, h ?? 0), [S, h]);      // wrap the PREFIXED string
// onClick:
let M = L.localRow - _;   if (M < 0) return;
let D = Math.max(0, L.localCol - y);
let B = $Oh(E, M, D);                                // (wrappedLines, line, col) -> offset in S
f(Math.max(0, Math.min(e.length, B - v)));           // subtract prefix, clamp to text
```

**The prefix is wrapped *with* the text, then subtracted at the end** — not measured separately. Border and
padding are subtracted from `localCol`/`localRow` first.

**Bonus: selection-inside-the-composer deletes.** L607579-607593 registers a handler (via a `setHandler`
singleton `Hto` L490212/L490224) that takes the current *screen* selection, checks both endpoints lie inside
the composer's `cachedLayout` rect, maps each through the same `getOffsetFromPosition` (subtracting `ts.y`/
`ts.x`, adding the viewport start line), and splices that range out of the text. So a mouse sweep over the
composer plus a keystroke behaves like a normal editor replace.

### 2.7 Settings and toggles

| lever | where | effect |
|---|---|---|
| `CLAUDE_CODE_DISABLE_MOUSE` | L126010 | mode `"off"` — nothing armed |
| `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` | L126012 | mode `"scroll"` — 1000+1006, and left-button reports dropped at L199637 |
| `copyOnSelect` (bool, **default true**) | L383567 (`/config` → *Input & controls* → "Copy on select"), registry L101771, section map L546781 | gates auto-copy L551447; also flips ctrl+C between copy and clear L666676 |
| theme `selectionBg` | L188034 et al | selection highlight colour |
| theme `userMessageBackground` / `…Hover` | L188034 et al | hover background pair |
| `noSelect` (per-Box) | L562661 | excludes cells from selection |
| `selectionScope` (per-Box) | L539032, L676030 | clamps a sweep's column range |
| `hoverIgnoresBlankCells` (per-Box) | L199437, L200168 | opt out of blank-cell hover |

There is **no** setting named "mouse" in `/config`; the only mouse toggles are the two env vars, and
`copyOnSelect` is the only mouse-adjacent user-visible switch (it is gated on `Ps()` — fullscreen — at
L383567, so it does not appear when fullscreen is off). Canon logs a first-run nudge about it at L551653.

---

## 3. Gap list — what ccx must build

### Shared prerequisite: arm more, decode more

Nothing in §3 works on 1000+1006. Two changes gate everything:

- **`altScreen.ts`** — add a mode selector (`"full"|"scroll"|"off"`) mirroring canon's `IXe`, default `"full"`
  = `?1000h ?1002h ?1003h ?1006h`. Keep `MOUSE_OFF` as-is (it already disarms all four). The
  "rides-the-screen" invariant at `:161-165` survives; only the string changes. Add the two env vars so the
  degraded mode ccx ships today stays reachable.
- **`parse.ts`** — the `& 32` term at `:188` currently *discards* every motion and drag report. Split it:
  `(button & 32) && (button & 3) === 3` → a new `action: "motion"`; `(button & 32) && (button & 3) !== 3` →
  `action: "drag"`. Widen `MouseInputEvent.action` to `"press"|"release"|"drag"|"motion"`. Convert col/row to
  **0-based at the boundary** (canon does `col-1`/`row-1` in `UfS` L199668) so every downstream consumer works
  in the same coordinates as a layout rect. Keep the `& 64`/`& 128` rejections.
- **Rate limiting.** 1003 emits a report per cell of pointer travel. Canon's only defence is the
  `lastHoverCol/lastHoverRow` dedupe (L199673-199676) — same-cell motion is dropped before `onHoverAt`. Port
  that; it is cheap and it is the whole answer.

### The structural gap: ccx has no addressable layout tree

Canon's hover, click and selection all stand on **two things ccx does not have**:

1. **`DUr`** (L200080) — a hit test over per-node `cachedLayout` rects. Canon is a custom Ink fork whose
   reconciler retains yoga layout per node. ccx renders through stock Ink, which exposes no absolute
   positions — the `FullscreenFrame.tsx:107-112` comment says exactly this, and the whole `RegionTopContext` +
   `hitRowsOf` apparatus exists *because* of it.
2. **`frontFrame.screen`** — a cell-addressed buffer with per-cell `char`, `width`, `styleId`, `hyperlink`,
   plus parallel `noSelect` and `softWrap` arrays. Canon's selection engine is written entirely against this
   buffer. ccx has no screen buffer at all; it emits strings to Ink.

**Consequence for planning: ccx cannot port canon's architecture. It must reach the same behaviours through
the hit-map substrate it already built.** `FullscreenViewport.hitRowsOf` (`:185-192`) is a one-entry-per-row
`{anchor, width}` map. The three features need it widened, not replaced — and that widening *is* the wave:

> **`HitRow` must become row-addressable in columns, not just row-bounded.** Something like
> `{ anchor?: string; width: number; text: string; gutterWidth: number; kind: "line"|"gutter-block"; }`
> — enough to (a) know which fold/row a cell belongs to, (b) recover the *plain text* of that row at a column
> range, and (c) know where the paint starts. Every one of the three features below is a query against that.

Everything below assumes that widening as task 0.

### 3.1 Hover brighten

| need | canon mechanism | ccx must build |
|---|---|---|
| motion events | 1003 armed, `& 32` + `i===3` branch L199670 | arm `"full"`; decode `action:"motion"` |
| same-cell dedupe | `lastHoverCol/Row` L199673-199676 | port verbatim |
| what is under the pointer | `DUr` ancestor chain + `hoveredNodes` diff L200164-200182 | **no tree.** Use the widened hit map: `hoveredAnchor = hitmapRef.anchorAt(col,row)`; keep `hoveredAnchorRef` and diff on change. This gives *row-cluster* hover granularity, which is what the transcript actually needs. Buttons/dialogs (canon's other ~20 hover sites) are out of reach without a tree — scope them out. |
| blank-cell suppression | `hoverIgnoresBlankCells` + `cellIsBlank` L200168 | the hit map already bounds `col <= at.width` by *painted* extent (`:185-192`), so this is free |
| the brighten itself | `Ssi` context cancels `dimColor` in `<Text>` L203979 | **portable as-is.** A React context read by ccx's `Line`/row renderer that suppresses `dimColor`. This is the single highest-leverage piece: one provider on the hovered cluster, no per-element wiring. |
| the background swap | `userMessageBackground`/`…Hover` token pair L188034 | add a `…Hover` token to all five palettes in `theme.ts` |
| repaint cost | canon repaints on `notifySelectionChange`/`scheduleRender` | ccx repaints the whole frame; a hover flip must not cost a full reflow. Budget this — it is the one place a per-cell event stream meets a full-frame renderer. |

### 3.2 Drag selection with auto-copy

This is the largest item and the one with the deepest premise correction.

| need | canon mechanism | ccx must build |
|---|---|---|
| drag events | 1002 armed, `& 32` branch L199703 | arm `"full"`; decode `action:"drag"` |
| anchor/focus state | `g0p` L198549, `Eka`/`y0p` L198550-198556 | portable directly — it is plain state, no tree |
| column clamping | `selectionScope` walk `SAa` L200113 | **no tree.** Substitute the region's own bounds: `FullscreenViewport` already knows `regionTop` and `columns`. A fixed scope `{x1: 0, x2: columns}` per region is the honest v1. |
| word select | `_0p`/`Lii` L198578-198642 over the screen buffer | needs `HitRow.text`. The char-class regex `tfS = /[\p{L}\p{N}_/.\-+~\\]/u` (L198741) ports verbatim. |
| line select | `T0p` L198775 | trivial once rows carry text |
| **screen cells → text** | `R0p` L198893 + soft-wrap joiner `Tka`/`Hii` | **the crux.** Canon reads a cell buffer. ccx must slice `HitRow.text` by column — which means the widened hit map must store the row's *display* text with its column offsets, and ccx must decide whether it stores plain or SGR-bearing text. Canon copies **plain** (the extractor reads `char`, never style), so ccx should store or derive plain text and slice by `stringWidth`, not `.length` — the same finding already recorded at `FullscreenViewport.tsx:172-178`. |
| soft-wrap joining | `softWrap` per row, `hze` classes L198542 | ccx's `wrapItems.ts` already knows which rows are continuations — that information exists and is currently discarded at paint time. Carry it into the hit map. |
| scrolled-off rows | `Cka` L198912 snapshots text before rows leave the viewport | needed only if a drag may scroll. Simplest v1: **clamp the selection to the visible region** and skip this entirely; record it as a known divergence. |
| highlight paint | `x0p` L198930 mutates cell styles with `withSelectionBg` | ccx has no cell buffer — it must inject SGR background runs into the row strings at paint time, in the region renderer, for rows/columns inside the selection. This is real renderer work and probably the second-largest task after the hit map. |
| auto-copy | `Lts` L551426 (once-per-selection latch, gated on `isDragging`, `copyOnSelect ?? true`) | portable directly |
| clipboard delivery | `yP` L188574 — native tool **and** OSC 52, tmux/screen DCS passthrough | ccx's `copy.ts:5-18` is native-only and **has no OSC 52 at all**. It must gain: OSC 52 emission, tmux `\x1bPtmux;…` wrapping, screen DCS chunking, an SSH check (canon skips the native tool when `SSH_CONNECTION`), and linux PRIMARY alongside CLIPBOARD. |
| the toast | `Mts` L551407 with three channel-specific texts incl. the modifier-bypass hint | portable; ccx has a notification slot |
| selection lifetime | `Kjh` L551382 — ctrl+C copies-or-clears by setting; `oNw` L551372 allow-list clears on any other key | portable. Note `bindings.ts:136` already anticipates "seven selection-extension/copy chords" that were left unbound. |
| the setting | `copyOnSelect` default true, `/config` → Input & controls | add to ccx's settings + `SettingsDialog` |
| theme | `selectionBg` per palette | **already present** at `theme.ts:45,53,61,69` with no consumer — it was added in anticipation |

**The premise correction, stated plainly:** the wave must not be scoped as "should ccx disarm so the terminal
can select?" Canon arms *more*, selects itself, auto-copies on mouse-up, and hands the native-selection case
to the terminal's own modifier (Shift / Option / Fn), which it names in the copy toast (L551416). ccx's
`altScreen.ts:44-53` already understood the cost half of this trade correctly; it drew the wrong conclusion
about the remedy.

### 3.3 Click-to-position-cursor

Cheapest of the three, and the only one that does **not** need the hit map — the composer knows its own
geometry.

| need | canon mechanism | ccx must build |
|---|---|---|
| a click that reaches the composer | `CCp` bubbling with per-node `localCol/localRow` L200154 | **no tree**, but none needed: the composer is at a known row range. Compute `localRow = row - composerTopRow`, `localCol = col - composerLeftPad`. The one honest requirement is that `ChatComposer` publishes its painted top row and left inset the way `FullscreenViewport` publishes `regionTop`. |
| offset from (line, column) | `measuredText.getOffsetFromPosition` L607576 | ccx's `editor.ts` + `wrapItems.ts` already wrap the composer text; they must expose the inverse map. This is a new function, but over existing data. |
| composer scroll offset | `getViewportStartLine(maxVisibleLines)` L607575 | ccx's composer viewport start — must be added to `localRow` before the lookup |
| prefix arithmetic | wrap the **prefixed** string, subtract prefix width at the end L539383-539394 | port the pattern; ccx's composer prefix (`> `, mode chips) must be included in the wrap, then subtracted |
| border/padding | `y = borderless ? 0 : 2`, `_ = borderless ? 0 : 1` L539385 | subtract ccx's `composerFrame` insets |
| gating | canon returns `false` from `onClick` to let the hyperlink path run | ccx's tap machine at `ChatApp.tsx:882-895` already has the `composerOwns` gate and press/release pairing — extend it with a second target rather than adding a second sink (the registry resolves **only the innermost** sink, `registry.ts:98-100`, so two sinks would shadow) |
| selection-in-composer deletes | L607579-607593 | depends on §3.2; defer |

### 3.4 The parity docs, checked against canon

The scorecard's **live rows are broadly accurate.** `docs/parity/tui-ux.md:1955` ("Mouse in fullscreen,
`D7`–`D9`") is 🟡, correctly records the click half as shipped at the tool-stream wave (2026-08-19), correctly
states ccx's arming as `?1000h ?1006h`, and correctly names the v1 cuts as *motion tracking, hover brighten,
drag-selection engine, auto-copy-on-select, click-to-position-cursor, and expanded-row background tint*. That
is exactly this wave's scope. No correction needed there.

**Four genuine contradictions / stale premises:**

1. **`tui-ux.md:1307` (`CM33` — mouse hover/click on popup rows, 🚫) and `tui-ux.md:1804` (`K22` — the
   `Scroll` context, ❌).** Both are excluded with the same stated reason: *"needs terminal mouse-mode
   ownership."* **ccx now owns the terminal mouse mode** — it has armed `?1000h ?1006h` with the alternate
   screen since the fullscreen wave (`altScreen.ts:166`) and has run a click path through it since the
   tool-stream wave. The stated rationale is dead. This matters beyond bookkeeping: `CM33` is 🚫, i.e.
   **excluded from the denominator**, so the scorecard is currently understating the surface. Both rows need
   re-scoring, and `K22` should be pointed at §3.2 — canon's `Scroll` context *is* the selection layer
   (`"selection:clear"` L551399-551404; the shift-arrow / ctrl+home / pageup allow-list `oNw` L551372-551380;
   ctrl+C copy-or-clear `Kjh` L551382-551395).

2. **`coverage.md:294-296`** — *"Explicitly **not** shipped and recorded as such: all mouse (D7-D9)…"*. Stale;
   superseded by `coverage.md:306` in the same file, which records the click path. The earlier bullet reads as
   current and should be dated or amended.

3. **`qa-driver.md:353`** — *"**Neither TUI ever enables mouse reporting.**"* Already self-corrected at
   `:359-365` ("true only of the classic renderer"; canon ≥2.1.226 goes fullscreen with *"SGR + any-motion
   mouse reporting ON"*), and flagged again at `qa-sweep-2-triage.md:235`. **My canon read confirms the
   correction and sharpens it:** the mode is `"full"` = `?1000h ?1002h ?1003h ?1006h` (L199044), defaulted at
   L663070, selected by `G_e()` L126009. The blanket sentence at `:353` should be struck, not just annotated —
   it is the one line in the corpus that would send a planner the wrong way.

4. **`qa-driver.md:743-753`** — *"Real clicks | NO | nothing to click — both TUIs are keyboard-only (§4.2)"*.
   Stale on both halves: canon has been click-live all along, and ccx has been since 2026-08-19.

**And one stale comment in the product tree**, worth fixing in the same wave: `src/tui/altScreen.ts:46` claims
*"ccx has no hover and no click targets"* as the justification for the narrow arming. The second half stopped
being true when the tool-stream wave built click targets on top of this exact constant.

**Premises the docs do *not* assert but that a planner might import — all false against canon:**

- *"canon disarms mouse reporting so native terminal selection works"* — no. Canon arms the maximum set
  (L663070, L199044), runs its own selection engine, and hands the native case to the terminal's own modifier
  bypass, which it names in the copy toast (L551416).
- *"ccx's 1000+1006 is a lighter default with no behavioural cost"* — it is canon's own named `"scroll"` mode
  and exactly what `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` selects (L126012). Canon treats that mode as
  *click-disabled*, dropping left-button reports at the door (L199637) — not as a lighter default.
- *"hover is a cosmetic background tint"* — the load-bearing half is `dimColor` cancellation through a React
  context (L203979). The background token pair is secondary. (Note `tui-ux.md:1955` lists "expanded-row
  background tint" as its own cut item, which is the *secondary* half; the context flip is the one to plan
  around.)
- *"copy-on-select needs OSC 52 **or** a native tool"* — canon does **both** on every copy (L188574-188591)
  and picks only the *toast wording* from `i2n()` (L188518).
- *"selection auto-copies inside the mouse release handler"* — no. Release only ends the drag (L199719); the
  copy is a selection-change subscriber with a once-per-selection latch, gated on `!isDragging` (L551426).

---

## 4. Suggested sequencing

1. **Widen the hit map** (`FullscreenViewport.hitRowsOf`) to carry per-row plain text, gutter width and
   soft-wrap class. Everything else is a query against it; nothing else can start first.
2. **Arm `"full"` + decode motion/drag** (`altScreen.ts`, `parse.ts`, `types.ts`), with the same-cell hover
   dedupe and the two env vars. Independently shippable and independently testable.
3. **Hover brighten** — the `dimColor`-cancelling context plus the theme token pair. Smallest visible win,
   exercises the motion path end to end.
4. **Click-to-caret** — independent of 1 and 3; only needs the composer to publish its origin and the wrap
   engine to expose an inverse map.
5. **Drag selection** — state machine, word/line select, region-clamped scope, SGR highlight injection at
   paint, then the `copy.ts` rewrite (OSC 52 + tmux/screen passthrough + PRIMARY), the `copyOnSelect` setting,
   the toast, and the ctrl+C / clear-on-keystroke lifetime. Explicitly divergent in v1: no scrolled-off row
   capture, no `selectionScope` per-element (region bounds only).
