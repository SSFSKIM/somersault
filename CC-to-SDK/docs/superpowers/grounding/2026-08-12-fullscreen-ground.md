# Fullscreen (alternate-screen) renderer — grounding for FULLSCREEN-1

**Scope.** Research + observation only. Two layers: (1) transcription of the Claude Code **2.1.220**
bundle at `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js` — the canon corpus and design source of
truth; (2) live observation of the installed CLI (which turned out to be **2.1.227**, not the 2.1.226 the
brief assumed), recorded as version drift, not as a build target. All line numbers below are
`cli.pretty.js` unless stated otherwise.

**Two headlines.**

1. **The ≤24-row auto-entry premise is dead.** There is no terminal-size gate in 2.1.220 — not dormant,
   not anywhere — and the live run reproduces fullscreen at every height from 8 to 40 rows and every width
   from 40 to 200 columns. What actually flips the renderer is whether the feature-flag cache exists in
   `$HOME` yet: a cold isolated HOME lands on the main screen, the second launch in the same HOME lands in
   the alt screen. The QA fleet's 24-vs-40 reading was cold-vs-warm HOME, not geometry. See §2.2 and §L2.1.
2. **Fullscreen is a process-level renderer choice, not a mode.** It is decided once at startup by `ds()`
   (line 110109), never re-evaluated on resize, and switching it **relaunches the process**. Everything
   Wave R withdrew from ccx (bottom-anchoring) lives inside this renderer as one Yoga attribute
   (`stickyScroll`) on one scroll box — and it means something narrower than Wave R assumed (§3.4, §L2.2).

---

# LAYER 1 — bundle transcription (2.1.220)

## 1. There are THREE renderers, not two

| # | Name in code | Predicate | Screen | What it does |
|---|---|---|---|---|
| 1 | classic / "default" | `!ds() && !HVe()` | main | append-only flow; Ink diffs against the previous frame and moves the cursor **relatively** |
| 2 | DECSTBM | `HVe()` — line **181553** | main | main screen + a DECSTBM scroll region pinning the bottom dock. Gated by `CLAUDE_CODE_DECSTBM` or statsig `tengu_marlin_porch`. Mutually exclusive with #3 (`if (ds()) return wUe = !1`, line 181562) |
| 3 | fullscreen | `ds()` — line **110109** | **alt** | full alt-screen frame, absolute cursor addressing, virtualized scrollback, mouse on |

The settings-schema wording for the user-facing knob (line **42039**, `tui`):

> `"fullscreen" uses the flicker-free alt-screen renderer with virtualized scrollback (equivalent to CLAUDE_CODE_NO_FLICKER=1). "default" uses the classic main-screen renderer.`

DECSTBM (#2) is a real third path and worth knowing exists, but it is a *variant of the main-screen
renderer*, cached once (`wUe`), and off unless a statsig gate or env var says otherwise. It is not what
FULLSCREEN-1 is about. Everything below concerns #3.

## 2. ENTRY CONDITIONS

### 2.1 The gate, verbatim — `ds()`, lines 110109–110139

```js
110109  function ds(e = epe) {
110110    if (l$() === "local-agent")            return !1;   // headless/local-agent entrypoint
110112    if (Z.CLAUDE_CODE_SESSION_KIND === "bg") return !0;  // background sessions ALWAYS fullscreen
110114    if (kR())                              return !1;   // screen reader
110116    if (RZi())                             return !1;   // env off  (see 110106)
110118    if (Z.CLAUDE_CODE_NO_FLICKER === !0)   return !0;   // env on
110120    if (B0e(e)) { …log…                    return !1 }   // tmux -CC control mode
110125    if (LZi()) { …log…                     return !1 }   // Windows over SSH
110130    switch (eo().tui) {
110131      case "fullscreen":                   return !0;   // settings.json
110133      case "default":                      return !1;
110135    }
110136    if (JOg(e))                            return !0;   // statsig tengu_amber_creek (downsell cohort)
110138    return e.gbGateCached ??= Ke("tengu_pewter_brook", !1);   // statsig default cohort
110139  }
```

Supporting predicates:

- `RZi()` (110106): `CLAUDE_CODE_NO_FLICKER === false || CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`
- `LZi()` (110101): Windows **and** any of `SSH_CONNECTION`/`SSH_CLIENT`/`SSH_TTY`
- `B0e()` (110096) → `XOg()` (110076) → `iau()` (110068): tmux `-CC` detection. First a cheap heuristic
  (`TMUX` set, `TERM_PROGRAM === "iTerm.app"`, `TERM` not starting with `screen`/`tmux`), else it
  **shells out**: `tmux display-message -p '#{client_control_mode}'` (110088), 2 s timeout.
- Disable reasons are logged once each, with the override named:
  - 110122 `fullscreen disabled: tmux -CC (iTerm2 integration mode) detected · set CLAUDE_CODE_NO_FLICKER=1 to override`
  - 110127 `fullscreen disabled: Windows over SSH (ConPTY re-rendering) detected · set CLAUDE_CODE_NO_FLICKER=1 to override`

### 2.2 **There is no terminal-size gate in 2.1.220. Anywhere.**

`ds()` takes no dimension input, reads no `columns`/`rows`, and calls nothing that does. A repo-wide
search for row thresholds (`rows <= 24`, `rows < 25`, `smallTerminal`, `isSmallTerminal`,
`minTerminalRows`, `tooSmall`) returns **zero** hits in any renderer-selection path. The only `<= 24`
matches in the whole 27.7 MB file are a prompt-template string-length cap (254777), an unrelated
array-length check (415028), and a numeric loop (571784).

So the QA fleet's observation (s2qa6-19: alt screen at 80×24, main screen at 80×40, reproduced twice) is
**not a dormant gate in 2.1.220**. The live run (§L2.1) shows it is not a gate in 2.1.227 either: the
confound is the statsig cohort at 110136/110138, whose flag cache is empty on the first launch into a fresh
`$HOME` and populated on the second. "Reproduced twice" reproduced the launch order, not the geometry.

### 2.3 The full lever list

| Lever | Where | Effect |
|---|---|---|
| `settings.json` → `"tui": "fullscreen" \| "default"` | schema 42039, read 110130 | the user-facing switch; wins over statsig, loses to env |
| `/tui [default\|fullscreen]` slash command | def **352074**, impl **482581–482620** | writes the setting **and relaunches** |
| `CLAUDE_CODE_NO_FLICKER=1` / `=0` | 110107, 110118 | force on / force off; **beats settings.json** |
| `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` | 110107 | force off |
| `CLAUDE_CODE_SESSION_KIND=bg` | 110112 | force on, above everything except `local-agent` |
| `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT` | 180584; auto-set on Windows/WT at **535888** | repaint whole frame each tick instead of diffing |
| `CLAUDE_CODE_DISABLE_MOUSE` / `_MOUSE_CLICKS` | `bHe()` **110210–110216** | mouse mode `off` / `scroll` / `full` (default `full`) |
| `CLAUDE_CODE_DECSTBM` | 181566 | opts into renderer #2 |
| `CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL` | 545495 | force the upsell dialog |
| `CLAUDE_CODE_TUI_JUST_SWITCHED` | 482510, 482608 | relaunch breadcrumb; drives the "bounce" telemetry and the feedback prompt |
| statsig `tengu_pewter_brook` | 110138 | the rollout gate |
| statsig `tengu_amber_creek` | 110141 | the downsell cohort — fullscreen **on**, with an explainer banner |
| statsig `tengu_ochre_hollow` | `_Vr()` 110263, used at 545503 | whether the upsell dialog may appear |

**There is no CLI flag.** No `--fullscreen`, no `--tui`, no `--no-flicker`; the arg parser (63–…) has none.

### 2.4 Entry-path attribution — `h8e()`, lines 110162–110184

Upstream keeps a named reason for *why* the renderer was chosen, and reports it in telemetry:
`bg_forced_on`, `sr_auto_off`, `env_off`, `env_on`, `tmux_cc_auto_off`, `win_ssh_auto_off`,
`settings_on`, `settings_off`, `downsell_on`, `gb_on`, `gb_off` (plus `ant_default` in the
reason→renderer map at 110185). Worth copying: a one-word provenance string makes every later
"why is it fullscreen here" question answerable without re-deriving the gate.

### 2.5 Switching requires a relaunch

`/tui` (482581) does **not** flip the renderer live. It:

1. reads the current renderer (`ds() ? "fullscreen" : "default"`, 482582);
2. refuses if background work is running (482600–482604): `Cannot switch renderers while work is running in the background — wait for it to finish (or stop it via /tasks), then run /tui again.`;
3. persists `userSettings.tui` (482605);
4. calls `YGt(i, flags)` = **`relaunchInto`** (482509–482511):
   ```js
   GBe({ freshIfNoTranscript:!0, extraArgs:t,
         env:{ CLAUDE_CODE_TUI_JUST_SWITCHED:e, … },
         dropEnv:["CLAUDE_CODE_NO_FLICKER","CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN","CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL"] })
   ```
   — i.e. re-exec, resuming the session, with the env overrides stripped so the setting can win.

The user-facing copy says so plainly (354262, 354270): *"Run /tui fullscreen to switch (this restarts and
resumes your session)"*. On a remote/`rs()` session it can only save the preference (482588–482593):
*"Background sessions always use the fullscreen renderer while attached; the … renderer will apply to
sessions started directly …"*.

**But the alt screen itself leaves on the settings write, before any relaunch.** `ds()` is a plain function
reading `eo().tui` (110130), and `Xge` calls it on every render (549519) to decide whether to mount `uet`.
Persisting `tui:"default"` at 482605 therefore flips the predicate immediately, and React unmounts the
alt-screen wrapper — writing `nj()` — on the next render, independent of the re-exec. The survey branch
makes this visible: when the feedback prompt applies, `fTb` **returns the survey component instead of
relaunching** (482618–482619), so the process is still the same one, on the main screen, with the survey
showing. Live observation matches (§L2.7). Two consequences for a port: the mount/unmount of the frame
container is the real enter/exit edge, and a relaunch is upstream's way of getting *clean renderer state*
after that edge, not the mechanism of the switch.

### 2.6 Upsell / downsell — how upstream migrates people

- **Upsell** (`Qym()` 545492, dialog `Tml` 545509): title *"Try the new fullscreen renderer?"* (545561),
  bullets (545551): *"· Flicker-free output — fixes the flashing you see during long responses"*,
  *"· Mouse support — click to move your cursor or expand results"*, *"· Selected text auto-copies to
  your clipboard"*; buttons `Yes, try it` / `Not now`. Max 3 impressions (`GPn = 3`, 545566). Accepting
  persists `tui:"fullscreen"` and relaunches (545529–545534).
- **Downsell** (`$ff()` 454458, banner `MMa` 454484): shown to the `tengu_amber_creek` cohort who are
  *already* in fullscreen. Copy at **454487**:
  ```
  ✓ Using flicker-free rendering
    · Scroll with your trackpad, scroll wheel, or PageUp/PageDown
    · Select text to copy — copying is automatic (/config to disable)
    · Click to move your cursor or expand collapsed results
    · /tui default to go back (saved to your preferences)
  ```
  After `Uff = 5` impressions (454492) it silently **persists** `tui:"fullscreen"` (454475–454481).

That banner is the best single summary of what the alt screen changes for a user, in upstream's own words.

## 3. STRUCTURE

### 3.1 Enter / exit sequences

Mode table, line **177069**:
```js
ev = { CURSOR_VISIBLE:25, ALT_SCREEN:47, ALT_SCREEN_CLEAR:1049, MOUSE_NORMAL:1000,
       MOUSE_BUTTON:1002, MOUSE_ANY:1003, MOUSE_SGR:1006, FOCUS_EVENTS:1004,
       BRACKETED_PASTE:2004, THEME_NOTIFY:2031, SYNCHRONIZED_UPDATE:2026 };
```

Composed sequences (177094–177102, constants at 166396–166403):

| Helper | Expansion | Meaning |
|---|---|---|
| `pVe()` **enter** | `ESC[?1049h` + `ESC[2J` + `ESC[H` + `Ybe()` | smcup, clear, home, then keyboard-protocol upgrade |
| `nj()` **exit** | `ESC[<u` + `ESC[?1049l` + `ESC[>4m` | pop kitty keyboard, rmcup, reset modifyOtherKeys |
| `Ybe()` | `ESC[<u` + `ESC[>1u` + `ESC[>4;2m`, **only** for `["iTerm.app","kitty","WezTerm","ghostty","tmux","windows-terminal","WarpTerminal"]` (list at 177175) | kitty keyboard protocol push + xterm modifyOtherKeys=2 |
| `AUe("full")` = `rcy` | `ESC[?1000h ESC[?1002h ESC[?1003h ESC[?1006h` | click + drag + **any-motion** + SGR |
| `AUe("scroll")` = `ncy` | `ESC[?1000h ESC[?1006h` | click + SGR only |
| `Gpe` mouse off | `ESC[?1006l ESC[?1003l ESC[?1002l ESC[?1000l` | |
| `Rms()` clear, alt | `ESC[2J ESC[3J ESC[H` (176982) | erases screen **and scrollback** |
| `yJr(rows)` clear, main | `ESC[H` + (`ESC[2K` + cursor-down) × rows + `ESC[H` (176988) | erases the viewport **in place**, scrollback preserved |

`mouse "full"` including `?1003h` (any-motion) exactly matches the QA fleet's tmux reading
(`any=1 sgr=1`) — that is the fingerprint of this renderer being active.

`Rms()` vs `yJr()` (dispatched at **177121**, `s += a.altScreen ? Rms() : yJr(a.viewportRows)`) is a clean
surface delta: the same `clearTerminal` render op means "nuke including scrollback" on the alt screen and
"blank the viewport, keep scrollback" on the main screen.

### 3.2 The container component — `uet`, lines 535792–535833

This is upstream's `<AltScreen>`. Props: `children`, `mouseTracking` (default `"full"`), `background`.

```js
535814  return YTe(pVe() + AUe(yPr)), BDn?.setAltScreenActive(!0, yPr), () => {   // mount
535816    if (BDn?.setAltScreenActive(!1), BDn?.clearTextSelection(), zYk) { YTe(… Gpe …); return }
535820    YTe((yPr !== "off" ? Gpe : "") + nj() + (BDn?.hasUnmounted ? "" : Ybe()));  // unmount
535821  };
…
535826  const Qum = VYk?.rows ?? 24;
535829  g7b = jsx(gh, { flexDirection:"column", height: Qum, width:"100%", flexShrink:0, children: Xum });
```

Two `useInsertionEffect`s: one for the background colour (535795–535807, `setAltScreenBackground` +
`EJr()`/`LDt()` = SGR set/reset bg), one for enter/exit. The child tree is a Box with **`height` pinned to
the terminal row count** and `flexShrink:0` — the frame is exactly one screen tall, always.

Three mount sites:

| Line | Surface | Predicate |
|---|---|---|
| **549380** | the main REPL (`Xge`) | `ds()` (549519) |
| **555081** | the **`/resume` conversation picker** (`Qhi`) | `ds()` (555072) |
| **535881** | the **FleetView / agents screen** (`qpi`) | **`Vtr()`** (535873) |

`Vtr()` (110143–110161) is a *more permissive* variant of `ds()`: same env / tmux-CC / Windows-SSH / settings
checks, but its fallthrough is `return !0` — **default on**. So FleetView is alt-screen even for users whose
main REPL is not. `handoffAltScreen()` (181025) then hands the live alt screen to the opened job without
writing rmcup (539291–539292), so there is no flash between the two surfaces.

### 3.3 The frame composer — `cZo`, lines 455844–456000

One component, three branches: `if (ds())` 455887–455959, `if (HVe())` 455961–455992, else 455994–455999.
Props: `scrollable`, `bottom`, `top`, `sidebar`, `sidebarWidth`, `modal`, `modalScrollRef`, `scrollRef`,
`dividerYRef`, `hidePill`, `hideSticky`, `newMessageCount`, `onPillClick`.

**Fullscreen branch, de-minified:**

```jsx
<V0r>                                                  {/* 455235 — 4 context providers */}
  <Box flexGrow={1} flexDirection="row" overflow="hidden">          {/* wDa 455931 */}
    <ViewportCtx value={{columns: cols - sidebarWidth, rows}}>      {/* vDa 455921 */}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">   {/* tIr 455916 */}
        {top}                                                       {/* Jmf */}
        {stickyPromptChip}                                          {/* $Je → QDa 456198 */}
        <ScrollBox ref={scrollRef} flexGrow={1} flexDirection="column"
                   paddingTop={stickyPrompt ? 0 : 1}
                   stickyScroll followGrowth={autoScrollEnabled}>   {/* qbt 455906 */}
          {scrollable}
        </ScrollBox>
        {jumpToBottomPill}                                          {/* Vbt → JDa 456145 */}
      </Box>
    </ViewportCtx>
    {sidebar && <Box width={sidebarWidth} flexShrink={0} overflow="hidden"
                     backgroundColor="composerSidebarBackground"/>} {/* TDa 455926 */}
  </Box>

  <Box flexDirection="column" flexShrink={0} width="100%" maxHeight={ohf}>  {/* IDa 455946 — BOTTOM DOCK */}
    <AutocompleteOverlay/>   {/* rCn 456218 — position:absolute bottom:100% opaque */}
    <SecondOverlay/>         {/* nCn 456229 — position:absolute bottom:100% opaque */}
    <Box flexDirection="column" width="100%" flexGrow={1} flexShrink={0}
         overflowY="hidden">{bottom}</Box>                          {/* CDa 455941 */}
  </Box>

  {modal && <Box position="absolute" bottom={0} left={0} right={0}
                 maxHeight={rows - 2} flexDirection="column"
                 overflow="hidden" opaque>…</Box>}                  {/* xDa 455951 */}
</V0r>
```

**Classic branch, in full** (455994–455999): `<>{scrollable}{bottom}{modal}</>`. No viewport, no scroll box,
no dock, no overlay layer, no absolute positioning. That contrast *is* the structural delta.

Dock sizing, line **455852**: `ohf = cbr() ? rows - aIr : Math.floor(rows / 2)`, with `aIr = 2` (456240).
`cbr()` (393325 → 393279) is "the **history-search** overlay is open". So the composer dock may take at most
**half the screen** normally, and `rows − 2` while ctrl+R history search is up. Modal overlays are capped at
`rows − 2` as well (455951).

### 3.4 Bottom-anchoring — where it actually lives

The scroll box is `a4` = `CIH` (434893–434961). It is an `ink-box` with `overflowX/Y:"scroll"` plus two
custom Yoga-level attributes, `stickyScroll` and `followGrowth` (434960), and an imperative handle exposing
`scrollTo / scrollToElement / scrollBy / scrollToBottom / getScrollTop / getPendingDelta / getScrollHeight /
getFreshScrollHeight / getViewportHeight / getViewportTop / isSticky / subscribe / setClampBounds`.

The anchoring itself is in the Ink fork's layout walk, **179810–179853**:

```js
179811  q = child.getComputedHeight()        // content height
179812  e.scrollHeight = q; e.scrollViewportHeight = M; e.scrollViewportTop = …
179813  G = Math.max(0, q - M)               // == bottom-most scrollTop
179827  K = e.stickyScroll ?? Boolean(e.attributes.stickyScroll)
179829  re = Math.max(0, Y - j); oe = q >= U; ce = e.attributes.followGrowth !== !1
179830  if ((K || V !== !1 && ce && oe && z >= re) && (e.pendingScrollDelta ?? 0) >= 0) {
179831    e.scrollTop = G;  …
179834    e.stickyScroll = !0;               // re-stick when content grew under a bottomed viewport
179836  }
```

That is the whole of bottom-anchoring: **`scrollTop = contentHeight − viewportHeight`, clamped at 0.**
Note the clamp: when content is *shorter* than the viewport, `G = 0`, so short transcripts sit at the **top**
of the transcript region with blank space below it, while the composer dock stays pinned to the bottom of the
screen by the outer flex column. "Bottom-anchored" here means *the transcript follows its own tail*, not
*content is pushed to the bottom of the screen*. Getting this backwards is the obvious way to build the wrong
thing. (§L2.2 checks it live.)

`followGrowth` is the re-stick rule: if the user was already at the bottom and content grows, stay at the
bottom; if the user scrolled up, do not yank them down. Explicit scrolls set `stickyScroll = false`
(434911/434916/434921); `scrollToBottom()` sets it back to `true` (434930). There is a debug log for the
re-stick edge at 179832–179833.

Also in the same block: `scrollHint` (179858–179859) — when only the offset changed and the box spans the full
width, the renderer emits `{top, bottom, delta}` and does a **hardware scroll** (`t.blit` / `t.shift` /
`t.clear`, 179868–179870) instead of repainting the region. It is set to `null` outside the alt screen
(**180330**: `scrollHint: o.altScreen ? n.scrollHint : null`) — a fullscreen-only optimisation.

### 3.5 Scrollback: there is none, so upstream virtualizes it

The alt screen has no terminal scrollback by construction, and upstream leans into it: the transcript is a
**virtualized scroll view** and every scroll affordance is an in-app keybinding.

The keybinding table (**186116**) has a dedicated context. Its own description (186160):

> `Scroll: "When a scrollable view is focused (fullscreen layout)"`

```js
{ context: "Scroll", bindings: {
    pageup:"scroll:pageUp", pagedown:"scroll:pageDown",
    wheelup:"scroll:lineUp", wheeldown:"scroll:lineDown",
    "ctrl+home":"scroll:top", "ctrl+end":"scroll:bottom",
    "ctrl+shift+c":"selection:copy", "cmd+c":"selection:copy",
    "shift+left":"selection:extendLeft",  "shift+right":"selection:extendRight",
    "shift+up":"selection:extendUp",      "shift+down":"selection:extendDown",
    "shift+home":"selection:extendLineStart","shift+end":"selection:extendLineEnd" } }
```

Handler `JIa`, **446135–446250**:

- `scroll:pageUp` / `pageDown` (446159–446174) move **half** a viewport (`floor(getViewportHeight()/2)`),
  despite the name.
- `scroll:lineUp` / `lineDown` (446175–446198) run wheel acceleration: a decay curve or a native window,
  configured by `tj()` (168490–168493 → `{useDecayCurve, useAdaptiveDrain, base, xtermJs, wheelFlood,
  jediTerm, …}`) and re-read whenever it changes.
- `scroll:top` → `scrollTo(0)`; `scroll:bottom` → `scrollToBottom()` (446199–446210).
- Everything is bound with `{ context:"Scroll", isActive: t && !cbr() }` (446211) — **disabled while history
  search is open.**
- A second registration (446229) adds `scroll:halfPage*` / `scroll:fullPage*` (the `ctrl+u/d/b/f` family).
- Selection extension (446230–446250) auto-scrolls when the focus row hits the viewport edge.

Two persistent affordances make the missing scrollback legible:

- **Jump-to-bottom pill** — `JDa` 456145–456196. `position:absolute bottom:0`, centred, on
  `userMessageBackground`, hover state, clickable. Label: `"N new message(s)"` when there are unseen
  messages, else `"Jump to bottom"`, suffixed with the resolved keybinding or `(click)`, and it picks the
  longest of three label variants that fits `columns − 2` (456169). Shown only when the viewport is not
  sticky and not at the end (`qqH`, 455869–455878).
- **Sticky prompt chip** — `QDa` 456198–456216. A one-row (`height:1`) bar showing `❯ <prompt text>`, i.e.
  the user message that owns whatever you have scrolled to. When present it consumes the scroll box's
  `paddingTop` (455893: `L6t = OVI ? 0 : 1`), so the frame height is unchanged.

The **`Transcript`** context (ctrl+O, same table) is the separate full-transcript view and has the vim-ish
set: `ctrl+u/d/b/f`, `g`/`shift+g`, `j`/`k`, `space`/`b`, arrows, `home`/`end`, `q`/`esc` to exit. In the
REPL it only gets a `scrollRef` when fullscreen: `_t = k || ds() && !z && !Tr ? M_ : void 0` (**549385**).
Its escape hatch for real scrollback is the `v` key (549336–549359): render every message to
`cc-transcript-<ts>.txt` in a temp dir and open `$VISUAL`/`$EDITOR`.

### 3.6 Composer / footer placement, and where the app tree branches

The REPL's terminal return (**549519–549521**):

```js
if (ds()) return Xge(YU(fNn));
return YU(fNn);
```
with `Xge` (549377–549381) wrapping in `uet` — or, when already inside an inherited alt screen (`k`), in a
plain `height:{rows}` Box instead of a second `1049h`.

`fNn` (549395) fills `cZo`'s two slots: `scrollable` = welcome chrome + `BJe` transcript + tool JSX +
`<Box flexGrow={1}/>` spacer + spinner/loading + `ds() && <lui/>`; `bottom` = the prompt input, mode chips
and footer. Two fullscreen-only details inside it:

- `scrollRef: ds() || HVe() ? M_ : void 0` and `trackStickyPrompt: ds() ? !0 : void 0` on the transcript —
  the transcript only reports scroll geometry in the two non-classic renderers.
- `ds() && jsx(lui, {})` — `lui` (494800–494868) renders the **queued prompts** you typed during a running
  turn, at the tail of the scrollable. Classic mode puts them elsewhere.

## 4. SURFACE DELTAS (main screen vs alt screen)

Every row here is a code-level difference in 2.1.220, with the line that makes it.

| # | Surface | Classic | Fullscreen | Line |
|---|---|---|---|---|
| D1 | **statusLine reserved row** (the known D-W6) | collapse the row when the text is empty | render a single-space `Text`, holding the row open | **484935**: `children: a ? <StatusLine text={a}/> : ds() ? <Text> </Text> : null` |
| D2 | Frame envelope | none | `<Box height={rows} flexShrink={0}>` | 535829 |
| D3 | Layout | `<>{scrollable}{bottom}{modal}</>` | viewport + scroll box + dock + absolute overlay layer | 455994 vs 455887 |
| D4 | Cursor addressing | relative (`ESC[nC/D/A/B`) | **absolute** `ESC[row;colH` | 180773–180779 |
| D5 | End-of-frame | cursor left where content ended | cursor **parked** at `ESC[rows;1H` after every frame | 180762, `m3u()` 180501 |
| D6 | Clear-screen op | `yJr(rows)` — viewport only | `Rms()` — `2J`+`3J`, scrollback too | 177121 |
| D7 | Mouse | never enabled | `?1000h ?1002h ?1003h ?1006h` (mode from `bHe()`) | 535814, 177070 |
| D8 | Text selection + copy | absent | `getSelectedText`, `copySelectionNoClear`, selection highlight painted into the frame; auto-copy on select | 181089–181100, 180725–180726 |
| D9 | Hover states | dead code | `onMouseEnter`/`onMouseLeave` live (pill, chips, tool rows) | 178201–178212, 456182 |
| D10 | Autocomplete suggestions | inline below the composer | hoisted to an `position:absolute bottom:100% opaque` overlay above the dock | 494606 vs 494609–494615 |
| D11 | Notification / apiKeyStatus block | rendered | `LRn ? null` — suppressed | 494644 |
| D12 | Right padding of the mode row | `paddingRight: 2` | `paddingRight: 1` | 494654 |
| D13 | "focus" mode chip | absent | `LRn && kmk && "focus"` | 494586 |
| D14 | Queued prompts (`lui`) | elsewhere | appended to the scrollable tail | 549395 |
| D15 | Jump-to-bottom pill / sticky prompt chip | absent | present | 455890, 455911 |
| D16 | Scroll keybindings (`Scroll` context) | inert | live | 186118, 186160 |
| D17 | ctrl+O transcript virtual scrolling | no `scrollRef` | `scrollRef` wired | 549385 |
| D18 | conversation picker | inline | the **launcher** picker takes over the whole screen in its own `uet`; the in-REPL `/resume` is a modal in the overlay slot (see §4.3) | 555070–555084 |
| D19 | FleetView / agents screen | — | alt screen under the **more permissive** `Vtr()`, so on even when the REPL isn't | 535871–535886 |
| D20 | `/focus` view (`briefTranscript`) | refused with an explainer | available | 354259–354277 |
| D21 | Resize | diff repaint | **full repaint**: reset both frames, re-arm mouse, `needsEraseBeforePaint` | 180633–180642 |
| D22 | `scrollHint` hardware scroll (SU/SD-style blit+shift) | disabled | enabled | 180330, 179858–179870 |
| D23 | Exit | final frame stays in scrollback | final frame is painted **onto the alt screen** then discarded by `1049l` | 181309–181315 |

### 4.0 D1 refined — the reserved row is conditional, and that matters

The status-line block only mounts when a `statusLine` **is configured**: line **494628** gates it on
`Mtl`, where `tNb = sMt(settings.statusLine)` and `Mtl = tNb !== void 0`. Inside, line **484935** chooses
between three states, and only the middle one is fullscreen-only:

| statusLine configured? | text resolved? | classic | fullscreen |
|---|---|---|---|
| no | — | nothing | nothing |
| yes | yes | the text | the text |
| yes | **no / empty** | **nothing (row collapses)** | **one blank row (row held)** |

So D-W6 is narrower than "alt screen always reserves a blank row": it reserves the row **only for a
configured-but-not-yet-resolved status line**. The reason is obvious once stated — the status line is
produced by an async shell command with a refresh interval (484901–484902), and in a fixed-height frame a
row that appears and disappears shoves the whole transcript. Classic mode can afford to collapse it
because the frame reflows anyway.

### 4.1 The exit contract (D23), spelled out

`unmount()` at 181303:

```js
181309   let t = this.log.renderPreviousOutput_DEPRECATED(this.frontFrame);
181310   Dms(this.terminal, xhs(t), …);        // paint the last frame
…
181314   if (this.altScreenActive)
181315     dse.writeSync(1, nj()), this.altScreenActive = !1;   // THEN rmcup
181318   dse.writeSync(1, Gpe), this.drainStdin(), …            // mouse off
```

The final paint happens **before** rmcup, on the alt screen, and is thrown away with it. So in fullscreen,
**quitting leaves nothing of the conversation in your terminal scrollback** — the shell content from before
launch is restored intact instead. That is a deliberate, load-bearing behavioural difference, and it is why
`v`-to-`$EDITOR` (549336) and `/export` exist. (§L2.5 checks it live.)

### 4.2 The crash-safety path — worth copying verbatim

Upstream does not trust the React unmount to be the only way out. `zuy` (**181494–181509**), registered
globally as `Xhs.cleanupTerminalModes` (181521, installed at 181524):

```js
181498   zho.writeSync(1, Gpe);                       // mouse OFF first, unconditionally
181500   if (e?.isAltScreenActive)
181502     try { e.unmount(); }                        // normal path
181503     catch { zho.writeSync(1, nj()); }            // fallback: rmcup by hand
181506   e?.drainStdin(); e?.detachForShutdown(); Uho();
181507   if (!Z.CLAUDE_CODE_DISABLE_TERMINAL_TITLE) zho.writeSync(1, a0u);
```

`Uho()` = restore-terminal-modes (**180341–180352**), all `writeSync` so it survives a dying event loop:
cursor show, kitty keyboard pop (`ESC[<u`), `modifyOtherKeys` reset, focus-events off, theme-notify off,
bracketed-paste off, and `ESC7 ESC[r ESC8` to clear any DECSTBM scroll region — plus a progress-report
clear when the terminal supports it (`kDt()`, 177072).

Three things to lift: mouse-off happens **before** anything that can throw; the alt-screen exit has a
hand-written fallback for when the framework itself is broken; and every write is synchronous.

### 4.3 Two different conversation pickers — do not conflate them

`Qhi` (555070–555084) wraps in its own `uet` and is the **launcher-level** picker — the screen you get from
`claude --resume` / `claude --continue` before a REPL exists, rendering `moi` with an explicit `maxHeight`
(555068), plus its `Loading conversations…` and `Resuming conversation…` states (555063, 555067).

The in-REPL `/resume` is something else: a modal in `cZo`'s absolute-bottom overlay slot (455951), capped at
`rows − 2`. Live captures confirm it — `surface-resume-fullscreen.txt` shows the picker under the same `▔▔▔`
overlay rule as `/model` and `/help`, with the transcript still visible above it, and
`surface-resume-preview.txt` shows the Space-preview growing inside that same slot rather than replacing the
frame. So the "full-screen preview takeover" is a *tall modal*, not a second alt-screen mount. Only the
launcher path is a real takeover.

## 5. The renderer contract, in one block

`onRender()`, 180698–180800 — the parts that differ when `altScreenActive`:

```js
180700  c = this.renderer({ …, altScreen: this.altScreenActive, prevFrameContaminated: a, overlayActive: l })
180724  if (this.altScreenActive) {                        // selection + search highlight painted INTO the frame
180726    _2u(c.screen, this.selection, this.stylePool)
180727    f = i3u(c.screen, this.searchHighlightQuery, this.stylePool)   // + r3u for match positions
180732  if (c.layoutShifted || p || f || a || (this.altScreenFullRepaint && this.altScreenActive))
180733    c.screen.damage = {x:0,y:0,width:…,height:…}      // whole-frame damage
180736  m = { ...this.frontFrame, cursor: Fuy }            // Fuy = {x:0,y:0,visible:false} (181490)
180757  if (this.altScreenActive && w) {
180759    H.unshift($uy)   // ESC[2J ESC[H   (erase-before-paint)      -- first frame after resize/redraw
180761    H.unshift(Uuy)   // ESC[H          (home)                    -- steady state
180762    H.push(this.altScreenParkPatch)   // ESC[rows;1H
180774  }                                                   // absolute cursor placement, clamped to (rows, cols)
```

Constants at **181490**: `Fuy = {x:0,y:0,visible:false}`, `Uuy = {type:"stdout", content: ESC[H}`,
`$uy = {type:"stdout", content: ESC[2J + ESC[H}`, `Nuy = CNu()` (a DSR cursor-position query).

### 5.1 The frame is clipped to the terminal, hard

In the layout entry point (**180316–180318, 180330**):

```js
180316  H = o.altScreen ? c : A;            // screen buffer height := terminalRows, NOT the Yoga height
180317  if (o.altScreen && A > c)
180318    v(`alt-screen: yoga height ${A} > terminalRows ${c} — something is rendering outside <AlternateScreen>. Overflow clipped.`, {level:"warn"})
180330  viewport: { width: l, height: o.altScreen ? c + 1 : c },
        cursor:   { x: 0, y: o.altScreen ? Math.max(0, Math.min(T.height, c) - 1) : T.height, … }
```

Two details worth stealing. First, the diagnostic: a tree taller than the terminal is treated as a **bug in
the caller**, named as such, and clipped rather than allowed to scroll the screen. Second, `viewport.height`
is deliberately `rows + 1` in the alt screen (and `rows` outside it) — one row of slack so nothing ever
believes the frame exactly fills the viewport, which is what makes a terminal scroll when the last cell is
written. `resetFramesForAltScreen` (181086) uses the same `e + 1`.

Three behaviours worth lifting wholesale:

- **Erase-before-paint is a one-shot flag**, not a per-frame cost. `needsEraseBeforePaint` is set by resize
  (180640) and `forceRedraw` (180988) and cleared on use (180759).
- **`probeExternalClear`** (180993–181002): if the cursor was parked at row `y ≥ 1` but a DSR query reports
  the terminal thinks it is at row 1, something else wiped the screen — force a redraw. A cheap, real
  answer to "another program clobbered my alt screen".
- **`reassertTerminalModes`** (181050–181061) re-writes the kitty-keyboard and mouse enables, optionally
  re-entering the alt screen; used on focus-in and after subprocess handoffs.

The subprocess-handoff pair `enterAlternateScreen()` / `exitAlternateScreen()` (180653–180662) is
confusingly named — inherited from stock Ink. It is for handing the terminal to `$EDITOR`/`!bash`, and its
exit branch is asymmetric: if the app is itself fullscreen it re-enters `1049h` and resets frames (180658);
if not it writes `1049l` and repaints on the main screen (180659–180660).

---

# LAYER 2 — live observation of the installed claude

Driven per `CC-to-SDK/docs/parity/qa-driver.md` under isolated `/tmp` HOMEs, tmux sessions prefixed `fsq-`.
Evidence: `/Users/new/.claude/jobs/4b30d1a4/tmp/fullscreen-live/*.txt`, filenames cited per claim.

**Version drift, first.** The task said 2.1.226; the installed binary is **2.1.227**
(`threshold-height-matrix.txt` line 1, and the welcome box in every capture reads
`╭─── Claude Code v2.1.227 ───╮`). Canon stays 2.1.220. Note that 2.1.227's own changelog, visible in the
welcome panel of every capture, includes *"Fixed feature flags being evaluated with…"* and *"Fixed `/tui`
bringing back a conversatio…"* — both in the machinery this document is about, so the drift here is active,
not incidental.

## L2.1 — The ≤24-row premise is FALSE. The gate is the feature-flag cache.

This is the finding that changes the wave.

**Height sweep, width 80, warm HOME, no `tui` setting, default env** (`threshold-height-matrix.txt`):

| rows | 20 | 22 | 23 | 24 | 25 | 26 | 30 | 40 |
|---|---|---|---|---|---|---|---|---|
| `alternate_on` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | **1** |

**There is no threshold.** 40 rows is fullscreen too. Width is equally irrelevant
(`flags-matrix.txt`): 40, 60, 80, 120, 200 columns at 24 rows are all `alt=1`; so is 40×40; so is an
absurd 80×8.

**What actually flips it** (`threshold-verdict.txt`) — the statsig/growthbook rollout flag from bundle
line 110138, and whether its cache exists yet:

| run | HOME | size | result |
|---|---|---|---|
| 1 | **cold** (fresh, empty flag cache) | 80×40 | `alt=0 any=0 sgr=0` |
| 2 | warm (same HOME, 484 flags cached, `tengu_pewter_brook=true`) | 80×40 | `alt=1 any=1 sgr=1` |
| 3 | **cold** | 80×24 | `alt=0` |
| 4 | warm | 80×24 | `alt=1` |

On a first launch into a brand-new HOME the flag read returns its default (`!1`, bundle 110138) because
nothing is cached; the *second* launch in the same HOME has the flags and goes fullscreen. So the QA
fleet's s2qa6-19 reading — alt screen at 24 rows, main screen at 40 — was **cold-vs-warm HOME, not
geometry**. Two isolated-HOME sessions launched in a different order would have reproduced it just as
"reliably".

This matches Layer 1 exactly: `ds()` (110109) has no dimension input, and none exists anywhere in 2.1.220
(§2.2). The premise was never in the code; the live run confirms it is not in 2.1.227's behaviour either.

**Startup-only, not continuous** (`startup-vs-live-resize.txt`):

```
fsq-h40   launched 80x40 fullscreen:  alt=1  → resize 80x24 → alt=1  → resize 80x40 → alt=1
fsq-envoff launched 80x24 forced off: alt=0  → resize 80x40 → alt=0  → resize 80x24 → alt=0
VERDICT: alternate_on never changes on resize in either direction.
```

**Env toggles behave as the bundle says** (`flags-matrix.txt`):
`CLAUDE_CODE_NO_FLICKER=1` on a **cold** HOME at 80×40 → `alt=1` (forces on past the missing flag cache);
`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` on a warm HOME at 80×24 → `alt=0`. Both are the reliable levers
for driving either renderer deterministically in tests — worth adopting in the QA driver.

**Mouse fingerprint**: every fullscreen session reports `any=1 sgr=1 all=1 btn=0`. That is
`?1003h` + `?1006h` + `?1000h` — the `AUe("full")` set from bundle 177070. `btn=0` simply reflects tmux
folding `?1002` into `any`. `alt=1 & any=1 & sgr=1` is the reliable "this is the fullscreen renderer" probe.

## L2.2 — Frame anatomy, and the anchoring verdict

**80×24, fresh empty session, fullscreen** (`80x24-fresh.txt`, SGR version in `80x24-fresh-sgr.txt`),
`cur=2,21`:

| row | content |
|---|---|
| 1 | blank — the scroll box's `paddingTop: 1` (bundle 455893) |
| 2–12 | welcome box `╭─── Claude Code v2.1.227 ───╮` |
| 13 | blank |
| 14–19 | the Fable-5 announcement block (`▎` gutter) |
| 20 | blank |
| **21** | `────────` composer top rule |
| **22** | `❯ Try "refactor <filepath>"` — the composer |
| **23** | `────────` composer bottom rule |
| **24** | `⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents` — the footer |

So the dock is **4 rows** (rule / input / rule / footer), growing by one when a status line is configured.

**The classic renderer at the same size is offset by one in the other direction**
(`80x24-default-renderer-fresh.txt`): content starts at row **1**, the chrome sits at rows 20–23, and row
**24** is blank. Fullscreen moves the spare row from the bottom of the frame to the top. A per-row frame
diff between the two renderers will therefore be off by one everywhere unless that is accounted for first.

**Anchoring: TOP-aligned when short, tail-following when long.** The decisive capture is
`80x40-anchor-empty.txt` — same content in a 40-row pane:

- content occupies rows 1–19, **rows 20–36 are blank**, dock at 37–40.

Content sits at the **top** of the transcript region with the empty space **below** it; only the dock is
pinned to the bottom of the screen. This is exactly bundle line 179813's clamp
(`G = Math.max(0, contentHeight − viewportHeight)` → 0 when short). "Bottom-anchored" in the
Wave R sense — push short content down against the composer — is **not** what upstream does, and building
that would be building the wrong thing. What is bottom-anchored is the *scroll position*: once content
overflows, the viewport follows its tail (`80x24-overflow.txt`, `scroll-wheel.txt` baseline shows the frame
ending at `120` / `✻ Brewed for 3s` with the dock beneath).

**Scrolled-up state** adds two rows of orientation (`scroll-keys.txt`, `scroll-snapback.txt`):

- **row 1 becomes the sticky prompt chip** — `❯ Print the numbers 1 to 120, one per line, nothing else.`,
  replacing the blank `paddingTop` row exactly as bundle 455893 predicts (`paddingTop = stickyPrompt ? 0 : 1`);
- a centred **`Jump to bottom (click) ↓`** pill appears near the bottom of the transcript region. The
  `(click)` variant is bundle 456158's macOS-with-mouse branch.

## L2.3 — Scrolling

`scroll-keys.txt` (80×24, transcript overflowed with 1…120):

| input | effect |
|---|---|
| `PgUp` | scrolls up **9 rows** in a 19-row transcript region — a **half** viewport, matching bundle 446165 |
| `PgDn` | down 9 rows |
| `Up` / `Down` | **composer history**, not scroll — the `Chat` context's `history:previous/next` wins over `Scroll` |
| `Home` / `End` | nothing |
| `ctrl+u` / `ctrl+d` | nothing in the REPL (those live in the `Transcript` and `Settings` contexts) |
| `Escape` | nothing |
| SGR wheel-up / wheel-down | **works** (`scroll-wheel.txt`) — the only TUI axis that is live here and dead on the main screen |
| click on the pill | **jumps to bottom** (`scroll-click-jump.txt`: frame returns to `104…120`) |
| `ctrl+o` | full-frame transcript takeover (below) |

**Typing does not snap you back to bottom** (`scroll-snapback.txt`): after scrolling up and typing `x`, the
transcript stays where it was and only the composer changes. That is `followGrowth` semantics — the user
left the tail, so do not drag them back. Only `scroll:bottom` or the pill re-sticks.

**Scrollback is genuinely gone.** No scrollbar, no "N lines above" gutter; the pill is the entire
affordance. This is exactly why the pill is not cosmetic.

**`ctrl+o`** (`ctrl-o-overlay.txt`) replaces the whole frame: transcript rows 1–22, then row 23 a rule and
row 24 `Showing detailed transcript · ctrl+o to toggle · ? for shortcuts      verbose`. No composer, no
pill. `PgUp` inside it scrolls (top row goes `102` → `93`). `shift+PgUp` does nothing.

## L2.4 — Resize inside the alt screen

`resize-in-altscreen.txt`, staged with 1–120 plus a wrapped paragraph:
80×24 → 100×24 → 80×30 → 80×24 → 120×24. At every step `alternate_on=1`, the frame re-wraps to the new
width, the dock stays pinned, and the cursor park tracks the new height (`cur=2,21` at 24 rows,
`cur=2,27` at 30). **No artifacts** — no stale-width rules, no duplicated composer. This is the clean
baseline the ccx resize defects (qa-driver §5) are measured against, and it is what a full repaint on
`SIGWINCH` (bundle 180633–180642) buys.

## L2.5 — Exit

`exit-slash-exit.txt`. Pre-exit frame is a normal 24-row fullscreen frame. After `/exit`:

- `alt=0 any=0 sgr=0` — every mode restored;
- the **pre-launch shell scrollback is fully intact** — all 30 `PRELAUNCH-SHELL-LINE-N` rows are back in
  both the viewport and `capture-pane -S -200`;
- **the conversation is not replayed.** The only thing claude leaves on the main screen is a two-line
  pointer:
  ```
  Resume this session with:
  claude --resume da6165a8-0dfd-4b41-a30d-2735eea5bbfe
  ```

**Double `ctrl+C` (0.2 s apart)** also exits cleanly — `alt=0`, main screen restored — but prints **no
resume hint at all** (`exit-double-ctrlc.txt`). So the one piece of continuity upstream offers is attached
to the graceful path only.

This confirms §4.1/D23 live, and sharpens it: upstream does not try to reproduce the transcript in
scrollback, it hands you a resume command instead. That is a product decision worth copying rather than
re-litigating — and the ctrl+C asymmetry is a gap worth *not* copying.

## L2.6 — Surface deltas, observed

| surface | fullscreen | evidence |
|---|---|---|
| `/model` picker | modal in the bottom overlay slot under a `▔▔▔▔` rule; transcript still visible above; `Enter to set as default · s to use this session only · Esc to cancel` | `surfaces-fullscreen-model-help.txt` |
| `/help` | same overlay slot, tabbed (`Help  General   Commands   Custom commands`). **Its `Esc to cancel` line is pushed off the bottom and never renders at 24 rows** — it does render in the classic renderer at the same size. An upstream clipping defect, not something to reproduce | `surfaces-fullscreen-model-help.txt` vs `surfaces-default-renderer.txt` |
| `/resume` (in-REPL) | **also the overlay slot**, not a takeover — search box, project name, hint row | `surface-resume-fullscreen.txt` |
| `/resume` preview (Space) | grows inside the same slot to ~21 rows, still under the `▔▔▔▔` rule, `PgDn` scrolls it, `Esc` returns | `surface-resume-preview.txt`, `surface-resume-populated.txt` |
| spinner / mid-turn | same glyphs and `⎿ Tip:` block as classic. In 4 of 5 fullscreen samples the spinner row was absent once streamed text filled the region, where the classic sample still showed it — **but the two were not like-for-like** (4 streamed lines vs a full region), so this is a sampling observation, not a proven delta | `surface-spinner-midturn.txt`, `surface-spinner-fullscreen-samples.txt` |
| `ctrl+o` transcript | full-frame takeover with its own footer | `ctrl-o-overlay.txt` |
| statusLine | text renders in **both** renderers (fullscreen row 23, classic row 18), immediately above the mode footer | `surface-statusline.txt` |
| permission dialog | takes over **the dock**, not the overlay slot: rows 13–24 become the diff preview + `Do you want to create fsq-perm.txt?` + numbered options + `Esc to cancel · Tab to amend`, and the composer disappears | `surface-permission-dialog.txt` |
| classic-renderer comparison set | same surfaces with `alt=0` | `surfaces-default-renderer.txt`, `80x24-default-renderer-fresh.txt` |

**The `▔▔▔▔` rule is the overlay seam.** Every modal in fullscreen — `/model`, `/help`, `/resume`, the
resume preview — renders in one absolutely-positioned bottom slot with an upper-half-block rule as its top
edge, and the transcript is squeezed above it. That is bundle 455951's `position:absolute bottom:0 …
maxHeight: rows − 2 … opaque` made visible. One slot, one seam, every dialog.

**Two overlay mechanisms, not one.** `/model`, `/help` and `/resume` render in the absolute-bottom overlay
slot *above* an intact composer, under a `▔▔▔▔` rule. The **permission dialog replaces the dock entirely**
(`surface-permission-dialog.txt`): the composer is gone and the dialog occupies rows 13–24 under the normal
`────────` rule. In the bundle that is the `PA` / `shouldHidePromptInput` branch inside `fNn`
(bundle 549395, `(PA || as?.shouldHidePromptInput) && jsx(url, {})`), which is a different slot from
`cZo`'s `modal` prop. Any port needs both.

**Correction to the paragraph above, from the bundle (added by FSW T13).** The *observation* stands — two
mechanisms, the pickers in the seam and the permission dialog in the bottom band with the composer gone — but
two of its bundle attributions are wrong, and both change what a port should build:

1. `jsx(url, {})` is **not** the permission dialog. `url()` (496404) renders a *banner* (`sWt`, with a
   `banner` prop and a `columns`), so `(PA || as?.shouldHidePromptInput) && jsx(url, {})` is a banner slot in
   the dock, not the dialog's home. What actually hides the composer on that branch is the line below it:
   `jsx(fra, { hidden: Cn || as?.isLocalJSXCommand === !0 || Boolean(PA) })`. The **inline** decisions
   (permission, question) are mounted by `jsx(Api, {})` **inside `cZo`'s `scrollable`** — i.e. at the tail of
   the transcript region, not in the dock at all. The capture agrees: a bottom-anchored region's tail sits
   immediately above a dock that has just lost its composer, which is rows 13–24 either way.
2. The seam slot has **two** tenants, and the bundle enumerates neither as a list of commands:
   `RTt = i8 ? jsx(Api, { variant: "modal" }) : Ket`, with `Ket = Dqt ? as.jsx : null` and
   `Dqt = ds() && as?.isLocalJSXCommand === !0`, passed as `cZo({ modal: RTt, … })` (549395). So it carries
   (a) **any local JSX command's element, whenever fullscreen** — the whole user-opened-surface class, of
   which `/model`, `/help` and `/resume` are the three that happened to be captured — and (b) the one
   decision whose layout is `"modal"`: `ypi = { [Vur.kind]: "modal" }` (507338) is a **one-entry table**, and
   `Api` returns null unless the pending decision's layout matches its variant (507350). `Vur` is
   exit-plan-mode. **The plan dialog is a seam surface**, and it is the only decision that is.

ccx's T13 ships (2) as written and diverges deliberately on (1): the inline decisions render in the dock band
rather than inside the scrollable region. Same rows on screen at a bottom-anchored tail; the difference is
that ours cannot be scrolled away from under the reader, and that ctrl+u/ctrl+d over a permission dialog
scroll the transcript *behind* it (keys/bindings.ts:280) instead of moving the dialog itself.

**Correction to the QA driver, §4.4.** The recorded verdict "neither TUI enables mouse reporting, both are
keyboard-only, there is nothing to click" was measured on the **main screen**. In fullscreen a synthetic SGR
click on the permission dialog's `3. No` option **selected it** — `surface-permission-click.txt` shows the
turn ending in `⎿ User rejected write to fsq-perm.txt`. Clicks also work on the jump-to-bottom pill
(`scroll-click-jump.txt`). Mouse is a live axis in this renderer, and the driver doc's mouse section needs
a fullscreen caveat.

**Not isolated — and this one nearly got recorded as a refutation.** `surface-statusline.txt` shows
`HELLO-STATUS` rendered in *both* renderers with no extra blank row, which reads as "D-W6 is false". It is
not a refutation. The probe used `echo HELLO-STATUS`, which resolves before the first paint, so the
capture only ever exercises the *resolved-text* row of the table in §4.0 — the branch where both renderers
agree. The fullscreen-only behaviour at bundle 484935 is the **empty-text** branch, which needs a
status-line command that sleeps (e.g. `sh -c 'sleep 3; echo LATE'`) to observe. D1 stands as transcribed
and remains **live-unverified**.

## L2.7 — `/tui` switching, live

`tui-command-switch.txt`:

- `/tui default` from a fullscreen session: `alt=1 → alt=0`, and the pane shows the **"Fullscreen
  feedback"** survey — *"To help us make fullscreen mode better, what made you switch back?"* /
  `Enter to send · Esc to skip`. That is bundle `L$f` (482512), reached through the `bounce` branch.
- **The conversation survives the switch** — the assistant's terminal-emulator paragraph is still in the
  transcript after the renderer flipped.
- `/tui fullscreen` typed while the survey was still open did nothing (`alt=0`); after dismissing it, the
  same command worked (`alt=0 → alt=1`). Practical note for any script that drives this: the survey is a
  modal that eats the next command.

**One reading to resist.** It is tempting to conclude from this that `/tui` is a purely live in-session
toggle with no restart. The capture cannot distinguish that from a session-resuming re-exec in the same
pane — the frame, the transcript and `alternate_on` would look identical either way, and no PID was
recorded. The bundle says both things are happening (§2.5): the settings write flips `ds()` and unmounts
the alt-screen wrapper immediately, **and** `fTb` re-execs afterwards — except on the survey branch, where
it returns the survey *instead of* relaunching (482618–482619), which is exactly the branch this capture
took. So the honest statement is: **the alt-screen exit is a component unmount driven by the settings
write; whether a re-exec follows depends on the branch, and this run took the branch where it does not.**
Deciding a build shape on "it's just a live toggle" would be building on the one path where the relaunch is
skipped.

**Also observed:** the classic-renderer frame does **not** fill the pane — `surface-statusline.txt`'s
`alt=0` capture ends its content at row 19 and leaves rows 20–24 empty, because on the main screen the app
paints a block of output and lets the terminal own the rest. The fullscreen frame always occupies exactly
`rows` rows. That difference is the whole reason `<Static>` cannot survive the port (§B1).

## L2.8 — Version drift against canon 2.1.220

Record these; do not build against them. Canon stays 2.1.220 unless the owner re-baselines.

| # | Drift | Evidence |
|---|---|---|
| 1 | Installed CLI is **2.1.227**, not the 2.1.226 the brief assumed. 2.1.225/226/227 all sit in `~/.local/share/claude/versions/` | every capture's welcome box |
| 2 | 2.1.227's own changelog names two fixes inside this machinery: *"Fixed feature flags being evaluated with…"* and *"Fixed `/tui` bringing back a conversatio…"*. The gate and the switch are both actively changing upstream | welcome panel, all captures |
| 3 | `ctrl+o` is now a **whole-transcript verbose toggle**, not per-row expansion of a folded tool call. The qa-driver's §4.4 finding ("ctrl+o replaced the folded row with the full view") was measured on 2.1.222 and no longer describes 2.1.227. No per-row fold affordance was located | `ctrl-o-overlay.txt` |
| 4 | Two fullscreen-only settings keys exist that are not in the 2.1.220 schema survey above: `autoScrollEnabled` (present in the 2.1.220 code at 455864 but not as a documented key) and `wheelScrollAccelerationEnabled` | binary strings, 2.1.227 |

## L2.9 — Isolation proof

| Check | Before | After |
|---|---|---|
| `tmux ls` | `ptc: 1 windows (created Tue Aug 11 18:21:30 2026) (attached)` | identical |
| `~/.claude/ccx/prefs.json` | `1786340224  Aug 10 14:37:04 2026` | **unchanged** |
| `~/.claude.json` | `1786463362  Aug 12 00:49:22 2026` | `1786464505  Aug 12 01:08:25 2026` — **changed, but not by this run** |
| `/tmp/fsq-*` | — | removed (`no matches found`) |

Seven sessions were created, all `fsq-`-prefixed, all killed by exact name; `ptc` was never touched and
`kill-server` was never run. Every `claude` invocation — including `--help` — ran under an isolated `/tmp`
HOME.

The `~/.claude.json` mtime change is attributed, not waved away: the file contains **zero** occurrences of
the string `fsq` and none of the scratch project paths appear under its `projects` key, and nine other
paths under `~/.claude/` (`sessions`, `shell-snapshots`, `hooks`, `mem-governor.log`, …) were touched in
the same window — the signature of the operator's own live session writing normal state. Recorded as an
attributed change rather than a clean reading, because it is not a clean reading.

---

# BUILD SHAPE

*A sketch, not a plan. It exists to frame the wave spec's first argument.*

## B1. The constraint that decides everything: ccx runs stock Ink

`harness/package.json` pins `"ink": "^5.0.1"`; the installed tree is **5.2.1**. Checked against
`node_modules/ink/build/styles.d.ts`:

| Upstream needs | Stock Ink 5.2.1 | Consequence |
|---|---|---|
| `overflow: "scroll"` + `scrollTop` on a Box | `overflow: 'visible' \| 'hidden'` only (styles.d.ts:228/234/240) | **no Yoga-level scroll box.** Windowing must happen in the model, before render |
| `stickyScroll` / `followGrowth` node attributes | absent | the anchoring rule must be ours |
| `position: absolute` overlays | **present** (`'absolute' \| 'relative'`, styles.d.ts:7) | overlay layer is reachable |
| mouse input | absent | wheel/click/selection are a separate input path or out of scope |
| alt-screen enter/exit | absent | ours, as raw stdout writes around the Ink instance lifecycle |
| absolute cursor addressing per frame | Ink writes a whole frame via log-update, relative | ours, or accept log-update's model inside a fixed-height frame |

So the honest framing is: **fullscreen is not a flag on the existing renderer, it is a second renderer**
that shares the transcript document and the component library but not the commit model.

The commit model is the crux. Classic ccx pushes finished rows into Ink's `<Static>`, which writes them to
the terminal's scrollback and never repaints them (`useChat.ts:522`, `chatMain.tsx:123–214`, and the whole
"Wave-1 Static lesson"). In the alt screen **there is no scrollback**, so `<Static>` is not merely
unnecessary, it is wrong: the rows it commits vanish at `1049l` and cannot be scrolled back to. Fullscreen
must paint the entire screen from the retained document every frame.

## B2. What ccx already has, and what is genuinely missing

Already built, and reusable nearly as-is:

- **the one retained transcript document** (`src/tui/transcriptModel.ts`, F1) — the only source that can
  feed a repaint-everything renderer;
- **item → physical-row projection with wrapping** (`src/tui/toolRenderer.tsx`, `src/tui/pager.ts`
  `pageItemSlices`) — the measurement a model-level window needs;
- **a scroll reducer whose bottom is already upstream's formula** — `applyPager`'s
  `Math.max(0, total - height)` (`pager.ts`) is `G = Math.max(0, q - M)` from bundle line 179813;
- **a working windowed viewport**: `TranscriptPager.tsx` is a line-window over the document. Fullscreen's
  transcript region is that component minus the border, plus sticky-bottom and follow-growth;
- the keymap with a real byte parser, `Scroll` and `Transcript` contexts, and `keybindings.json` (F2);
- every dialog, picker and footer surface (F5/F6, Wave C).

Genuinely missing:

1. alt-screen lifecycle (enter/exit/reassert/handoff/crash-safety);
2. a fixed-height frame shell (transcript region + dock + overlay layer) with the dock height caps;
3. sticky-bottom + follow-growth as an explicit reducer over the document;
4. a repaint path that does not use `<Static>`;
5. the two orientation affordances (jump-to-bottom pill, sticky prompt chip);
6. mouse (wheel, click, hover, selection, auto-copy) — the largest single chunk, and separable.

## B3. Two divergences to decide deliberately, not discover

- **Where clipping happens.** Upstream renders the *entire* transcript tree every frame and clips at paint
  with a scroll offset (bundle 179805–179853), so `getScrollHeight()` is free and exact. ccx must window at
  the model level, which means `scrollHeight` is a *computed* quantity that depends on wrap width — so a
  width change invalidates the offset and the anchor must be re-derived, not carried. This is the same class
  of problem Wave R fought, and it is the thing most likely to produce a defect.
- **Half-page vs full-page.** Upstream's `scroll:pageUp`/`pageDown` move **half** a viewport
  (bundle 446165/446173, `floor(getViewportHeight()/2)`); ccx's `PAGER_ACTIONS` maps them to a **full**
  page (`pager.ts`). Under fidelity-first that is a bug to fix in the same wave, since fullscreen is where
  those keys become the primary scroll.

## B4. The smallest coherent first milestone

**M1 — "the frame is real."** Enter/exit the alt screen, paint a fixed-height frame, keep the transcript
bottom-anchored, keep the composer docked, and get out cleanly. Concretely:

1. **Renderer selection with provenance.** A `ds()`-equivalent whose decision order mirrors the bundle
   (110109) minus the parts we do not have: env force on/off, screen reader off, tmux `-CC` off, settings
   `tui`, then default. Return a named reason (upstream's `h8e()`, 110162) and surface it in `/status`.
   **No terminal-size input** — that premise is dead (§L2.1).
2. **Enter/exit as owned bytes**, matching the bundle's composed sequences (§3.1) including the
   terminal-conditional kitty/modifyOtherKeys upgrade, and — non-negotiable — an exit path that runs on
   `SIGINT`/`SIGTERM`/uncaught throw, not only on a clean unmount. A process that dies inside the alt screen
   with mouse tracking on leaves the user's terminal broken.
3. **The frame shell**: one Box at `height = rows`, a `flexGrow:1` transcript region, a `flexShrink:0` dock
   capped at `floor(rows/2)` (and `rows − 2` while history search is open), and an absolutely-positioned
   overlay slot for modals capped at `rows − 2`.
4. **The transcript viewport** as a sticky-bottom line window over the retained document, with
   follow-growth: pin to the tail while the user is at the tail; do not yank them down when they are not;
   re-stick on explicit `scroll:bottom`.
5. **Scroll keys only**: `pageup`/`pagedown` (half viewport), `ctrl+home`/`ctrl+end`, arrows. Wheel and
   click deferred with mouse.
6. **Repaint contract**: full repaint on resize (bundle 180633–180642); erase-before-paint as a one-shot
   flag, not per frame.

**What must ship *with* M1 to be honest, not after it.** Three things, because without them the frame is a
trap rather than a feature:

- **The scrollback replacement.** The moment we enter the alt screen we take away the user's terminal
  scrollback. Ctrl-O's pager must work inside the frame *and* the "dump the transcript to `$EDITOR`" escape
  hatch (bundle 549336–549359) must exist, because on exit the conversation is gone from the terminal
  (§4.1/D23). Shipping the frame without an exit for the content is the dishonest version.
- **The jump-to-bottom pill.** Without it a user who scrolls up in a screen with no scrollbar and no
  scrollback has no signal that there is anything below and no obvious way back. It is ten rows of code and
  it is the difference between a viewport and a trap.
- **The exit guarantee** (item 2 above). Restated because it is the one failure that damages something
  outside our process.

**Explicitly deferred, and safe to defer:** all mouse (wheel, click, hover, text selection, auto-copy);
the sticky prompt chip; `scrollHint` hardware-scroll optimisation; the DECSTBM renderer; FleetView's more
permissive gate; the upsell/downsell machinery; `/focus`. Each is additive to a correct frame.

**Deferred but load-bearing sooner than it looks:** the `/resume` picker's full-screen takeover (D18). It is
a second `uet` mount, not a variation of the REPL frame, so if the frame shell is not factored as a reusable
container from the start, that surface forces a refactor.

## B4b. One thing to fix before the wave, not during it

`docs/parity/qa-driver.md` §3.2's launch line pins nothing about the renderer, so which one a QA session
gets depends on whether that isolated `$HOME` has been launched into before (§L2.1). Every cross-harness
comparison run since the flag rolled out has been silently sampling one of two renderers. Pinning it —
`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` for classic, `CLAUDE_CODE_NO_FLICKER=1` for fullscreen, on the
`env` prefix — makes both reachable deterministically and makes the existing corpus interpretable. The
driver's §4 mouse verdict and §4.4 `ctrl+o` finding also need fullscreen caveats (§L2.6, §L2.8).

This is a one-line change to a doc, it unblocks honest measurement of everything the wave builds, and it
costs nothing to do first.

## B5. The question the spec should open with

Upstream's own answer to "how do you change renderer" is layered, and the layers disagree in a way the spec
has to resolve deliberately (§2.5, §L2.7): the alt screen enters and leaves on a **component mount/unmount**
driven by a predicate over settings, and a **re-exec** follows to get clean renderer state — except on the
branch where it doesn't.

So: does ccx adopt the re-exec, or is the mode-selecting root enough? Mount the whole app under a root that
picks a renderer, make the predicate a live read, and `/tui` becomes a remount rather than a relaunch.
Upstream re-execs because its two renderers disagree about the terminal from the first byte and because its
state is in a resumable session; ccx has the first constraint and a weaker version of the second. The
remount is smaller and testable in-process; the re-exec is more obviously correct. Pick on purpose, up
front, because it sets the wave's size — and note that the remount answer only works if the frame container
is factored as a reusable wrapper from task one (which the `/resume` launcher takeover, D18, will demand
anyway).
