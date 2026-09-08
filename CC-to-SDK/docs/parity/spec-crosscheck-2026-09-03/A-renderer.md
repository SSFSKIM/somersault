# Lane A — renderer / layout / paint / themes / capabilities (spec ch. 41 §41.1–§41.14)

Scope: `41-tui-rendering.md` lines 88–2808. Our-side cites are line numbers in
`/Users/new/Developer/GitHub/somersault/CC-to-SDK` (see §7). Our side: `harness/src/tui/{render,renderer,resizeRepaint,
altScreen,clearViewport,liveWindow,reflowOracle,graphemes,osc8,theme,terminalEscapes,pager,chatMain}.*`,
`FullscreenFrame.tsx`, `FullscreenViewport.tsx`, `TranscriptPager.tsx`, `ThemeDialog.tsx`, `mouse/`,
`keys/wheelGuard.ts`; scorecard `docs/parity/tui-ux.md` §2/§3/§6.

Every finding labelled **verified** was re-read in `~/claude-code-bundle/2.1.251/cli.pretty.js` (our declared
canon) *and* `2.1.257`, with line cites to both where they differ. Bundle cites below are `<version>:LINE` of
`cli.pretty.js` unless a chunk is named.

---

## 0. Top takeaways

1. **`keys/wheelGuard.ts` drops real arrow keys on every terminal; canon does this only inside JetBrains
   JediTerm.** Canon's actual cross-terminal answer to alternate-scroll is an *arrow-burst detector plus a
   toast*, not a silent drop. Verified in 2.1.220, 2.1.251 and 2.1.257. → §1.1
2. **No fullscreen boot canary, and we ship `DEFAULT_ON = true`.** Canon arms a per-launch record in
   `~/.claude.json` and auto-disables fullscreen on this machine after 2 strikes (`crash_auto_off`). We turned
   the default on without the safety net canon built for exactly that. → §2.1
3. **`auto` theme: the whole OSC 11 tier is now specified and verified at 2.1.251** — query bytes, `rgba?:`
   parser, the 0.2126/0.7152/0.0722 > 0.5 luminance split, tmux DCS race at 2000 ms, the `osc11Responsive`
   latch, and the DEC 2031 re-probe subscription. Our 🟡 row's named blocker is now fully unblocked. → §3.1
4. **Two env hatches are mis-parsed and the comment asserting canon agrees is wrong.**
   `CLAUDE_CODE_DISABLE_MOUSE` / `_CLICKS` are `triBool()` in canon at 2.1.220 *and* 2.1.251/257, so `=0`
   *enables* mouse there and *disables* it here. → §1.2
5. **Kitty keyboard flags: we push `ESC[>1u`, canon 2.1.251/257 pushes `ESC[>5u`.** Canon changed between
   2.1.241 and 2.1.251; our port is faithful to 2.1.220 and now stale against our own canon target. → §1.3
6. **The cell-diff renderer, damage model and `scrollHint`/DECSTBM hardware scroll are specified end to end**
   — cell packing, the three pools, the op optimiser, the exact three-condition gate for emitting a scroll
   region. That is the blueprint for the 🟡 "Fullscreen paint model" row and the ❌ "hardware scroll" row. → §3.2
7. **Under tmux we emit truecolor where canon clamps to 256** (`ce` adjuster, `CLAUDE_CODE_TMUX_TRUECOLOR`
   override). tmux is this program's own QA environment. → §1.5

---

## 1. Corrections — things we built that canon does differently

### 1.1 The 75 ms arrow drop is JediTerm-only in canon (verified; **highest user-visible impact in this lane**)

**We do:** `harness/src/tui/keys/wheelGuard.ts:24-36` — `createWheelGuard` swallows any unmodified `up`/`down`
arriving within `WHEEL_FALLBACK_MS = 75` of a wheel tick. It is installed unconditionally for the whole input
stream (`keys/KeymapProvider.tsx:139-140`, applied at `:199`), on every terminal, in both renderers.

**Canon does:** the entire limb is behind a JediTerm gate. `_3n(state, events, now, notify)`
[`2.1.257:497831`] opens with

```js
function _3n(r, n, i, u) {
  if (!gk().jediTerm)
    return b(r), n;
```

Same at [`2.1.251:92672`] and at 2.1.220 [`2.1.220:168556`, `bUu`: `if (!tj().jediTerm) return gUu(), t;`].
`gk().jediTerm` is `TERMINAL_EMULATOR === "JetBrains-JediTerm"` [spec §41.11.5;
`2.1.257:588064`]. So on Terminal.app, iTerm2, Ghostty, kitty, WezTerm, Alacritty, VS Code and tmux, canon
never drops an arrow.

Two further details our port lost, both inside that gate:
* the dropped arrow is not discarded — `ee(r)` increments `pendingArrowBoost`, which `h3n(r)`
  [`2.1.257:497819`] later folds into the wheel delta, so the gesture keeps its magnitude;
* the first drop fires a one-shot notice (`u()` → `jediterm-scroll-bug`, §4.2 below).

**Canon's cross-terminal answer instead** is a detector, not a filter [`2.1.257:721568-721586`,
`2.1.251:374179`]: `$1 = 100`, `eE = 8` — ≥ 8 same-direction, unmodified, non-pasted arrows inside a 100 ms
sliding window emit `arrow-burst`, which shows a 12 s warning toast (string in §4.2). Arrows still reach the
editor.

**User-visible impact:** press ↑ within 75 ms of a scroll tick anywhere in ccx and the keystroke vanishes with
no feedback. In fullscreen, where we arm `?1000h ?1002h ?1003h ?1006h` by default (`altScreen.ts:62`), wheel
ticks are frequent, so the window is live constantly. Our module header's premise ("a terminal on the
alternate screen with tracking off answers a wheel tick with bare arrow keys … canon's answer is a clock")
describes a real problem but attributes to canon a solution canon applies only to JediTerm.

**Verified**, both bundles. **251-vs-257:** unchanged across 220 → 257.

### 1.2 `CLAUDE_CODE_DISABLE_MOUSE` / `_CLICKS` are tri-state booleans, not raw truthiness (verified)

**We do:** `altScreen.ts:73-77`
```ts
if (env.CLAUDE_CODE_DISABLE_MOUSE !== undefined) return env.CLAUDE_CODE_DISABLE_MOUSE ? "off" : "full";
```
with a header comment claiming "canon's own `V.CLAUDE_CODE_DISABLE_MOUSE ? "off" : "full"` has the identical
property; this is not a departure."

**Canon does:** the source text is identical, but `a.CLAUDE_CODE_DISABLE_MOUSE` is not `process.env.X` — it is
a parsed accessor. `CLAUDE_CODE_DISABLE_MOUSE: () => bE` and `bE = x.triBool()` [`2.1.251` env-schema chunk,
`x` defined at `2.1.251:649043`]; `triBool` is
```js
f = m(() => T.preprocess(r, T.string().optional().transform((n) => {
  if (Me(n)) return !0;
  if (bo(n)) return !1;
  return;
})))
```
with `Me` = `["1","true","yes","on"]` and `bo` = `["0","false","no","off"]` (chunk-5b2g0bc6.js). Same typing at
2.1.257 (`dE = I.triBool()`, line 820197) **and at 2.1.220** (`jeh = Me.triBool()`), so this is a transcription
error, not version drift.

**Resulting divergence table** (ours vs canon), for `CLAUDE_CODE_DISABLE_MOUSE`:

| value | ccx | canon |
|---|---|---|
| `1` / `true` / `yes` / `on` | `off` | `off` |
| `0` / `false` / `no` / `off` | **`off`** | **`full`** |
| `""` | falls through | falls through |
| `maybe` | **`off`** | **falls through to `_CLICKS`, then `full`** |

**Impact:** a user who writes the negation explicitly (`CLAUDE_CODE_DISABLE_MOUSE=0`) loses the mouse entirely
in ccx. Same for `_CLICKS=0` → we give `scroll`, canon gives `full`. Cheap fix: reuse
`renderer.ts`'s existing `envBool` (which already carries canon's exact word lists, `renderer.ts:88-95`) and
treat `undefined` as "fall through".

**Verified**, three bundles.

### 1.3 Kitty keyboard flags: `ESC[>1u` vs canon's `ESC[>5u` (verified; changed between 2.1.241 and 2.1.251)

**We do:** `altScreen.ts:127-129` — `kittyUpgrade` returns `"\x1b[<u\x1b[>1u\x1b[>4;2m"` for the seven
allow-listed terminals.

**Canon does:** [`2.1.257:497661`] `k2(r) { return xFt() ? HJ + (r?.legacyKitty ? ynr : _nr) + Snr : "" }`,
where `_nr = ESC[>5u`, `ynr = ESC[>1u`, `HJ = ESC[<u`, `Snr = ESC[>4;2m` [`2.1.257:780153`]. Identical at
[`2.1.251:92502`], with `hZn = ESC[>5u`. `legacyKitty` is set only when a remote-attach peer reports a
different `VERSION` [`2.1.251:389014`], i.e. `>1u` is the *compatibility* branch.

**Version history (measured):** `>5u` is absent from 2.1.220, 2.1.234, 2.1.236 and 2.1.241 (`grep -c '>5u'` = 0
in all four), and present in 2.1.251 and 2.1.257. 2.1.220 has only `>1u` [`2.1.220:166403`], which is what our
port faithfully copied. So this is a canon change our port has not tracked, landing **before** our declared
canon target.

**Impact:** flags 5 = `1|4` (disambiguate escape codes **+** report alternate keys); we request 1 only, so
CSI-u payloads never carry the shifted/base-layout alternates. Whether that changes anything depends on
`keys/parse.ts`, which currently has no alternate-key branch — so flipping the byte should be paired with a
parser check rather than done alone.

**Verified.** **251-vs-257:** same in both.

### 1.4 OSC 8 hyperlinks carry no `id=`, so wrapped links are not stitched (verified)

**We do:** `osc8.ts:11-12` — `osc8Open = ESC]8;;<href>BEL`, `OSC8_CLOSE = ESC]8;;BEL`.

**Canon does:** [`2.1.251:816167-816178`], identical at [`2.1.257:784795-784806`]:
```js
function dTe(t, e) { let o = { id: j(t), ...e }, r = Object.entries(o).map(([i,s]) => `${i}=${s}`).join(":");
  return Zp(Sd.HYPERLINK, r, t); }
function j(t) { let e = 0; for (let o = 0; o < t.length; o++) e = (e << 5) - e + t.charCodeAt(o) | 0;
  return (e >>> 0).toString(36); }
```
i.e. `ESC]8;id=<hash36>;<uri>BEL`, hash = 31-based rolling (`h = 31h + c`, seed 0, 32-bit signed truncation),
rendered unsigned base-36. The spec's note that this is *not* djb2 is correct.

**Impact:** the `id=` parameter is what tells the emulator that two runs on different rows are one logical
link, so hover-highlight and the underline break at every wrap point. In fullscreen we wrap at pane width
(`wrapItems.ts`), so multi-row links are the normal case for long URLs and long file paths.

Also worth pinning: the close sequence is `lf(HYPERLINK, "", "")` and the OSC **terminator is per-terminal** —
ST under kitty, BEL elsewhere [`2.1.257:784497`]. Our `terminalEscapes.notifyTerminator()` already implements
that rule but `osc8.ts` is a hard-coded BEL leaf and does not consult it (a deliberate, documented choice; the
`id=` gap is the substantive part).

**Verified**, both bundles. **251-vs-257:** unchanged.

### 1.5 No Claude colour-override chain: truecolor is not clamped under tmux (verified)

**We do:** nothing at the colour-level layer. `theme.ts:resolveThemeColor` turns `rgb(r,g,b)` into hex and
hands it to Ink/chalk, whose vendored `supports-color` then decides. Grep finds no `NO_COLOR`, `FORCE_COLOR`,
`CLAUDE_CODE_TMUX_TRUECOLOR` or `COLORTERM` handling anywhere outside `diffHighlight.ts`.

**Canon does:** four adjusters run once in `ensureInit()` [spec §41.9.2, `chunk-ztcj79fd.js:853152`]:
| adjuster | rule |
|---|---|
| `ne` | `NO_COLOR` set, `FORCE_COLOR` unset, no `--color*` flag → level 0 |
| `le` | `TERM_PROGRAM === "vscode"` and level exactly 2 → level 3 |
| `ie` | TTY, no `NO_COLOR`/`FORCE_COLOR`/`--no-color`, `TERM` in the truecolor set → level 3 |
| `ce` | **`TMUX` set and level > 2 → level 2**, unless `CLAUDE_CODE_TMUX_TRUECOLOR` |

with the truecolor `TERM` set `["alacritty","contour","foot","ghostty","rio","wezterm","xterm-ghostty",
"xterm-kitty"]`. Below level 3, canon additionally rewrites any 24-bit SGR into a 256-colour nearest match over
the cube `[0,95,135,175,215,255]` plus the greyscale ramp, with two special cases (average brightness < 5 →
index 16; near-white achromatic stays on the cube) [§41.9.4].

**Impact:** inside tmux with `COLORTERM=truecolor` (the common config, and this program's own QA environment)
chalk gives us level 3 and we emit 24-bit SGR where canon emits 256-colour. On a tmux without `Tc`/`RGB`
passthrough the theme colours degrade differently from canon's — and the whole point of the `ce` adjuster is
that canon does not trust tmux to forward truecolor. This is the one adjuster worth porting first; `ne` and
`ie` mostly duplicate what `supports-color` already does.

**Spec-only for the adjuster code** (I did not re-read `ensureInit` in 2.1.251), **verified** for the fact that
the theme tables are truecolor and that we have no clamp. Two smaller siblings, both spec-only:
Apple Terminal is pinned to a level-2 chalk instance for raw prefixes [§41.9.4]; and `TERM` starting `screen`
renders italic as standout, so canon strips the `ESC[23m` end code from those style arrays — we emit italic
markdown unconditionally (`markdownInline.ts`).

### 1.6 DEC 2031 (theme-change notification) is never enabled (verified)

**We do:** `altScreen.ts` arms `?1049h`, mouse modes, `?1004h` (focus) and bracketed paste. No `?2031`.

**Canon does:** raw-mode acquisition writes `?2004h` + `?1004h` + `?2031h`, then on Windows `?9001l`, then
`k2()` [`2.1.257:721281`; symbol table at `2.1.257:841744`: `OFt = PO(THEME_NOTIFY)`, `THEME_NOTIFY: 2031`].
Release writes `>4m`, `<u`, `?1004l`, `?2031l`, `?2004l` [`:721295`].

**Impact:** 2031 is the notification that drives the `auto` theme's live re-probe (§3.1) — a user who flips
their terminal from dark to light mid-session gets nothing from us. Also: our teardown asymmetry is safe
(we never enable it, so never leak it), but adopting the OSC 11 tier requires 2031 first.

### 1.7 Synchronised output is wrapped unconditionally; canon gates it, and the tmux arm out-ranks the force flag

**We do:** `chatMain.tsx:537` wraps every recorded alt-screen frame write in `ESC[?2026h … ESC[?2026l`, with a
long recorded divergence note at `:211-237` acknowledging canon gates it.

**Canon does:** `skipSyncMarkers()` returns true when stdout is not a TTY, when the terminal is not known to
support DEC 2026, or when resize handlers are not yet installed [§41.5.5]. `IO()` itself is, **verified**
verbatim at [`2.1.257:497597-497630`]:

```js
function IO() {
  if (a.CLAUDE_BG_BACKEND === "daemon") return yl()?.syncOutput !== !1;
  if (a.TMUX) return mk().synchronizedOutputSupported === !0;
  if (a.CLAUDE_CODE_FORCE_SYNC_OUTPUT) return !0;
  ... TERM_PROGRAM allow-list (iTerm.app, WezTerm, WarpTerminal, ghostty, contour, vscode, alacritty,
      mintty, rio, Tabby) ... JetBrains ... KONSOLE_VERSION >= 211200 ... TERM includes "kitty" ||
      KITTY_WINDOW_ID ... TERM === "xterm-ghostty" ... TERM startsWith "foot" ... TERM includes "alacritty"
      ... ZED_TERM ... WT_SESSION ... VTE_VERSION >= 6800 ... else the DECRQM probe result
}
```

Two things our recorded note gets slightly wrong and are worth correcting in place: **the `TMUX` arm sits
above `CLAUDE_CODE_FORCE_SYNC_OUTPUT`**, so inside tmux the force flag has no effect at all — only a positive
DECRQM probe enables sync; and the 2.1.257 list has grown two entries our note (from 2.1.220) does not list,
`WT_SESSION` and `KITTY_WINDOW_ID`.

**Impact:** unchanged from what the note already records (an unbalanced-pair risk on a terminal that honours
BSU and drops ESU), but the gate is now a copyable 20-line function rather than a research task.

### 1.8 `/tui` — our refusal ladder is a subset

**We do:** `commands.ts:410-428` — usage line, unknown-value line, `TUI_BUSY_REFUSAL`, `Already using the ${want}
renderer.`, and a `Saved. The ${want} renderer does not apply here (${reason}).` invention.

**Canon does:** an eleven-step ladder [§41.12.4] with distinct strings for a background session, screen-reader
mode, uncarriable session restrictions, the artifact-comment monitor, a deferred blocker discovered after the
save, a save failure (with a remote-session redaction variant), a relaunch failure (ditto), and the
`crash_auto_off` suffix on the bare-`/tui` output. It also `dropEnv`s `CLAUDE_CODE_NO_FLICKER`,
`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, `CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL` on relaunch, and clears the
crash record (`Gxt`) after **every** successful save in either direction.

Most of the missing arms are unreachable for us (no relaunch — we remount by design, spec §A7; no upsell; no
artifact monitor). The two that are reachable and missing are the **screen-reader refusal** and the
**`crash_auto_off` suffix** (which presupposes §2.1). Strings in §4.1.

### 1.9 Smaller, recorded here without a recommendation

* **Frame throttle.** Canon throttles `onRender` at `Wv = 16` ms (62.5 fps) and re-arms a follow-up frame at
  `Wv >> 2` = 4 ms for scroll drain [§41.1.2]. Ink 5.2.1 throttles `onRender` at 32 ms and `log` at `undefined`
  (`node_modules/ink/build/ink.js:39,47`). Different budget, not a defect.
* **Alt-screen viewport height.** Canon pins the screen to `rows` and reports the viewport as `rows + 1`
  [§41.12.3]; our frame is `rows − 1` with a park row beneath (spec §A4a, already a recorded divergence). The
  spec confirms canon's `+1` slack exists for exactly the reason our note gives.
* **Border styles.** Canon's accepted set is the eight `cli-boxes` names plus `dashed` and `quote`
  [`2.1.257:723045`, validator `chunk-1kg58a1a.js:76486`]. We transcribe `dashed` (`boxStyles.ts:14`) and draw
  the `quote` rail by hand as `▎ ` in `markdown.ts:122` rather than as a border style — equivalent output.

---

## 2. Unknown unknowns — canon behaviours with no `tui-ux.md` row

### 2.1 The fullscreen boot canary and the per-machine kill switch (**the big one**)

`grep -r fullscreenBootPending\|fullscreenAutoDisabled\|canary` finds nothing in `harness/` or `docs/parity/`.

Canon writes `fullscreenBootPending[<pid>] = { startedAt, version, host, platform }` into `~/.claude.json`
*before* the first fullscreen paint, installs a `process.on("exit")` hook that erases it on a clean exit, and
schedules an unref'd timer for `Fy` = 10,000 ms after the first painted frame that deletes the record and
resets the strike counter. A record still present on a later launch is a strike; `Oy` = 2 strikes writes
`fullscreenAutoDisabled { version, at, strikes }`, which makes the renderer ladder return `crash_auto_off` →
classic. A sticky disable recorded against a different version is discarded, so an update re-enables
fullscreen. Records from another host/platform expire after `Uy` = 30 days; a pending record whose process is
still alive is kept for `Ly` = 10 minutes. Two stderr banners (§4.1) explain the strike and the trip.
[spec §41.12.5; **verified at our canon target**: `2.1.251:525095-525197`, banners at `2.1.251:525141-525142`,
`/tui` suffix selection at `2.1.251:27563`.]

**Why this matters more for us than for canon.** `renderer.ts:79` sets `DEFAULT_ON = true`: an install that
configures nothing gets the alternate screen. Canon shipped the same default *with* a machine-local kill
switch, so a terminal where the alt-screen path dies before first paint self-heals into classic. We have no
`crash_auto_off` rung at all (`renderer.ts:189-199`), so the same failure is a permanent hard-lock: the user
sees a dead alt screen, and the only escape is knowing `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` exists.

**Reachability:** entirely local. It needs a writable JSON file (we already have `~/.claude/ccx/prefs.json`),
`process.pid`, `os.hostname()`, `process.platform`, a `process.on("exit")` hook and one unref'd timer. No SDK
surface involved. This is the single most valuable item in my lane.

### 2.2 The arrow-burst detector and its toast

Covered mechanically in §1.1. As a *feature* it has no row: canon detects that a terminal is translating the
wheel into arrows (≥ 8 same-direction unmodified arrows in 100 ms) and tells the user to use PgUp/PgDn. Our
`wheelGuard` is the inverse policy — hide the symptom, say nothing. Reachability: local, pure input-stream
bookkeeping. [`2.1.257:721568-721586`, `2.1.251:374179`, toast `2.1.251:627976`.]

### 2.3 The tmux `mouse` and `focus-events` probes and their hints

Canon shells `tmux show -Av mouse` and `tmux show -gv focus-events` with a 2000 ms timeout, memoised per host,
and surfaces a one-line hint when either is off. Both hints fire at most once per session (`checkedTmuxMouseHint`
/ `checkedTmuxFocusHint`), and the mouse hint additionally requires fullscreen. Strings in §4.3.
[spec §41.13.5; **verified** `2.1.251:769590-769627`, probe table at `:769606`.]

We arm `?1000h ?1002h ?1003h ?1006h` in fullscreen under tmux with no such check, and we arm `?1004h`
similarly. A user in a tmux with `mouse off` gets a wheel/click/drag layer that silently does nothing and no
explanation — the exact failure the hint exists for. Reachability: local (`spawnSync`, same shape as our
existing `probeTmuxControlMode` in `renderer.ts:141-155`, which already pays a measured ~5 ms).

### 2.4 `/scroll-speed`, and the wheel base factor generally

No mention anywhere in `harness/` or `docs/`. Canon ships a `local-jsx` command "Adjust mouse wheel scroll
speed", enabled only in fullscreen and never in a JetBrains terminal [**verified** `2.1.251:503095`, and
present at 2.1.257]. Its dialog writes `userSettings.env.CLAUDE_CODE_SCROLL_SPEED`; body and footer strings in
§4.4. The underlying model [§41.8.2/§41.8.4]:

* base rows-per-notch: JetBrains → 2 (bypasses the override); otherwise `Mln(xtermJs, wheelFlood, wtSession)`
  = 3 when `!wheelFlood && (xtermJs || WT_SESSION)`, else 1;
* `wheelFlood` (hosts that emit a burst per notch): `CURSOR_TRACE_ID` set, `VSCODE_GIT_ASKPASS_MAIN` contains
  `cursor`, `TERM_PROGRAM === "vscode"` with version in `[1092000, 1105000)` (packed
  `major*1e6 + minor*1000 + patch`), or an XTVERSION reply starting `xterm.js`;
* `CLAUDE_CODE_SCROLL_SPEED` parsed as float, ignored when NaN or ≤ 0, capped at 20;
* per-frame drain of the accumulated delta, adaptive on xterm.js (`_E 4, DE 5, OE 12, wE 2, HE 3, Hd 30`) or
  proportional elsewhere (`min(viewport-1, max(4, |delta|*3 >> 2))`).

We do exactly one row per tick (`FullscreenViewport.tsx:794-795` → `PAGER_ACTIONS["scroll:lineUp"]`). For a
plain terminal canon's base is also 1, so the felt gap is narrower than it looks — but VS Code / xterm.js users
scroll 3× slower in ccx, and both user knobs are missing. Reachability: fully local.

### 2.5 `/color` — the per-session prompt accent

`docs/parity/command-coverage.md:32` classifies `/color` as "honest client-side message", i.e. deliberately
unimplemented. The spec now gives the whole thing [§41.9.5]: the eight names are the keys of the subagent
palette (`red blue green yellow purple orange pink cyan`), reset aliases are
`["default","reset","none","gray","grey"]`, an empty argument picks a **random** colour, and the four strings
are in §4.5. We already ship that exact palette (`theme.ts` `SUBAGENT_TOKEN_NAMES` / `SUBAGENT_THEMES`), so the
command is close to free. Flagging, not asserting: canon also pushes the choice to its bridge as a session
colour tag, which we have no equivalent for.

### 2.6 Custom themes (`custom:<slug>`)

Named in `tui-ux.md:834` as "a separate, larger gap" but with no row. The spec specifies it completely
[§41.10.4]: `~/.claude/themes/<slug>.json`; a strict three-field *save* schema (`{name, base, overrides}`) and a
**permissive read schema** where every field is optional (`{}` loads as
`{slug, name: slug, base: "dark", overrides: {}}`); each override key must already exist in the base palette
**and** pass the colour validator, unknown keys silently dropped; 256 KiB file cap; `.json` only; sorted by
display name with `localeCompare`; a `chokidar` watcher with `awaitWriteFinish {stabilityThreshold: 300,
pollInterval: 100}`; slugification `toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") || "theme"`;
plugin themes in a separate store slot merged after user themes. Also documents a real canon asymmetry: the
storage-v5 branch returns a `null` sentinel meaning "keep the previous set" on failure, while the
local-filesystem branch returns `[]` and therefore **clears** the loaded themes on a failed `readdir`.

### 2.7 The screen-reader renderer

We resolve the signal (`renderer.ts:186`) and use it for renderer choice and reduced motion (`motion.ts:11`),
and stop there. Canon has a second renderer [§41.14]: `onRenderScreenReader` abandons the cell diff and emits
line-oriented output — flatten to text plus "preserve whitespace" ranges, hard-wrap, compute a park position,
diff by common prefix, with two fast paths (pure append → emit the suffix only; pure erase → emit `EL`), a
startup quiet period (`CLAUDE_AX_STARTUP_QUIET_MS`, default 3000, clamped 600000) during which nothing is
emitted at all, and a pre-park delay (`CLAUDE_AX_PREPARK_MS`, default 50, clamped 5000) that parks the cursor
at column 1 before a large redraw so the reader is not interrupted mid-utterance. A three-state park anchor
(`clean` / `lastRowAnchored` / `broken`) is reset on resize, SIGCONT and alt-screen transitions.

Also missing: the `--ax-screen-reader` flag and the `axScreenReader` setting (our `renderer.ts` divergence 4
records env-only, correctly, as a deliberate choice); `CLAUDE_CODE_ACCESSIBILITY` (cursor stays visible, native
cursor forced, line-number gutter always drawn); and canon's injection of `CLAUDE_AX_SCREEN_READER: "1"` into
relaunched and spawned sessions.

Reachability: the line renderer itself is a large build against stock Ink (we do not own the paint), but the
*quiet period* and the *pre-park* are policies we could apply at the output-proxy seam we already own
(`chatMain.tsx:531-537`).

### 2.8 Smaller, still unrowed

* **`CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL`** — canon's escape hatch to turn virtualisation off wholesale
  [`chunk-bq8epagv.js:433344`]. We virtualise unconditionally (`liveWindow.ts`), with no escape.
* **`CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT`** — forces a full repaint every frame; auto-set with `??=` when the
  platform is Windows **or** `WT_SESSION` is set [§41.12.3, `chunk-p1qyb9ns.js:631933`]. Relevant the day ccx
  targets Windows Terminal.
* **`CLAUDE_CODE_FRAME_TIMING_LOG` / `_SAMPLE_EVERY`** — one JSON object per frame with per-phase durations,
  optionally `rss`/`cpu` [§41.5.7]. A ready-made shape if we ever want frame telemetry.
* **`ink-raw-ansi`** — a host element for a pre-rendered ANSI block with caller-declared `rawWidth`/`rawHeight`,
  blitted verbatim and measured by its own measure function [§41.3.1]. That is the clean version of what our
  `preStyled` segments do by hand; worth knowing the shape exists.
* **`wrap-stream`** — a `textWrap` mode identical to `wrap` except that the **final** line and its soft-wrap
  entry are dropped, so a partially streamed line never produces a stale trailing row [§41.7.1,
  `chunk-teb05yv9.js:723331`]. We stream markdown (`streamingItems.ts`) and have no equivalent.
* **`ContinuationElidedSep`** — canon's third soft-wrap kind, for a continuation row whose leading space the
  wrap consumed, so a copy can restore it [§41.6.1]. Ours is binary (`hard` / `continuation`,
  `mouse/hitmap.ts`), which is *correct for us* because our wrapper is character-preserving
  (`wrapItems.ts` uses `wrapAnsi` with `trim:false` and asserts round-trip equality). No action; recorded so a
  future move to a trimming wrapper knows what it would owe.

---

## 3. Known gaps now specified

### 3.1 `auto` theme, tier 2 — `tui-ux.md:697` / `:2366` 🟡 (**fully unblocked; verified at 2.1.251**)

Our row says: "🟡 because canon's `OSC 11` query tier is deferred whole (F8 § 5, `TH3`)", and `tui-ux.md:840`
notes the reply-read is the only blocker. Every piece is now in hand, and I re-read all of it in our own canon
target rather than trusting the spec:

* **Resolution order** — `Bz() = Sk().cachedSystemTheme() ?? s() ?? "dark"`. The cached OSC 11 answer
  **outranks** `COLORFGBG`; our `theme.ts:187 resolveThemeId` only has the `COLORFGBG` tier
  (`theme.ts:175 detectTerminalBackground`), which is canon's `s()` verbatim including the `n <= 6 || n === 8`
  ladder. [`2.1.251:555728-555738` for `s()`.]
* **Query** — `pjn(SET_BG_COLOR)` i.e. OSC 11 with a `?` payload; under tmux/screen (`TMUX || STY`) the request
  is wrapped in DCS passthrough and raced against `v = 2000` ms; on timeout it is re-sent **bare** with
  `via = "mux-bare"`. [`2.1.251:652569-652590`.]
* **Response parser** — [`2.1.251:555712-555726`]:
  ```js
  function i(e) {
    let t = /^rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(e);
    if (t) return { r: m(t[1]), g: m(t[2]), b: m(t[3]) };
    let n = /^#([0-9a-f]+)$/i.exec(e);
    if (n && n[1].length % 3 === 0) { let r = n[1], o = r.length / 3;
      return { r: m(r.slice(0,o)), g: m(r.slice(o,2*o)), b: m(r.slice(2*o)) }; }
  }
  function m(e) { let t = 16 ** e.length - 1; return parseInt(e, 16) / t; }
  ```
* **Classifier** — `0.2126*r + 0.7152*g + 0.0722*b > 0.5 ? "light" : "dark"`, on the **normalised 0–1**
  channels `m()` produces. [`2.1.251:555706-555710`.]
* **Latch and re-probe** — a silent terminal sets `osc11Responsive = false` [`2.1.251:652591`], an answering
  one sets it true [`:652594`]. The latch suppresses **only the mount-time probe** [`:652604`]; the DEC 2031
  theme-change subscription re-invokes the probe unconditionally, so a previously silent terminal is re-probed
  on every notification. Under `CLAUDE_BG_BACKEND === "daemon"` the mount probe is skipped and replaced by
  focus-gated polling.

Blocking prerequisite on our side: §1.6 (enable `?2031h` / disable `?2031l` alongside the existing focus-event
pair in `altScreen.ts`). The reply read itself has a home: `keys/KeymapProvider` already owns the single raw
stdin reader and `reflowOracle.ts` already routes an unrecognised CSI reply back out through
`KeymapDeps.onUnknownSequence` — the OSC 11 reply is an OSC, not a CSI, so `parse.ts` needs one more
recognised terminator, but the plumbing pattern exists and is proven.

### 3.2 Fullscreen paint model — `tui-ux.md:539` / `:2292` 🟡, and hardware scroll `:544` / `:2258` ❌

Our 🟡 names the missing arm exactly: "canon's own answer is a cell-diffing renderer with absolute cursor
addressing and a per-frame park at `ESC[rows;1H` (**D4/D5**)". §41.5–§41.6 is that renderer, specified to the
bit level:

* **Cell packing** [§41.6.1] — two Int32 words per cell aliased by a `BigInt64Array`; word 0 is the interned
  char id; word 1 is `styleId << 17 | hyperlinkId << 2 | widthClass`, masks `32767` and `3`. Four width classes
  (0 single, 1 wide-lead, 2 wide-continuation, 3 right-edge filler space); the diff walk skips 2 and 3 in both
  frames so a wide grapheme emits exactly once from its lead cell.
* **Auxiliary planes** — `noSelect: Uint8Array` (with `Box`'s `style.noSelect: true | "from-left-edge"`, the
  latter extending exclusion to column 0 for gutters so a copy never picks up `⏺`/`⎿`), and `softWrap:
  Int32Array` packed `kind << 16 | col & 32767` with bit 15 reserved for the elided-separator flag.
* **The three pools** [§41.6.2] — char pool never reset (grows monotonically for the renderer's life);
  hyperlink pool replaced past `wy` = 4096; style pool compacted past `max(512, 2·lastLive)`; style ids are
  `poolIndex << 1 | hasResettingEndCode`; index cap `Oy` = 16383 → 16384 entries, past which `intern` returns
  the empty style so a cell renders unstyled rather than aliasing. Transition memo keyed
  `fromId*1048576 + toId`, cleared at 8192 entries. The SGR-22 subtlety (22 clears bold *and* dim, so dropping
  one requires `ESC[22m` then re-applying the survivor) is spelled out.
* **Full-reset reasons** [§41.5.6] — `clear`, `resize` (viewport shrank, or grew while content was taller than
  the viewport, or the width changed), `offscreen`. **This is directly relevant to `resizeRepaint.ts` +
  `reflowOracle.ts`:** canon does not probe the emulator's reflow behaviour at all. It owns the cell buffer, so
  a width change is simply a full reset — `clearTerminal` op plus a repaint of every non-empty cell. Our
  ~640-line DSR-probe/park/correction stack exists only because we do not own the buffer; the spec confirms
  there is no upstream analogue to port and that the stack's replacement is the cell renderer itself.
* **Hardware scroll** [§41.8.3] — the exact emission and its exact gate:
  ```js
  su(n.screen, ce, re, oe), A = [{ type: "stdout",
    content: CG(ce + 1, re + 1) + (oe > 0 ? fnr(oe) : mnr(-oe)) + tU + yg }];
  ```
  i.e. DECSTBM `ESC[<top>;<bottom>r`, then `ESC[<n>S` (SU) or `ESC[<n>T` (SD), then `ESC[r` (reset region) and
  `ESC[H`. Emitted when **all three** hold: the alternate screen is active; `HFt` = module-load `kFt()`
  (**verified** `2.1.257:497632-497635`: false outright under `CLAUDE_BG_BACKEND=daemon`, else sync output AND
  no `TMUX`, no `ZELLIJ`, not JetBrains, not xterm.js, no `WT_SESSION`); and
  `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT` is unset. Crucially, **`bte()` (the DECSTBM *renderer* gate) is not on
  this path** — the spec corrects a natural misreading here, and notes `bte()` is false in fullscreen anyway.
  Our scorecard records "`DECSTBM` is a recorded non-goal mechanism and is not scored"; the spec shows DECSTBM
  is the *mechanism* of the ❌ hardware-scroll row, not a separate thing, and that it is excluded under tmux
  by canon's own gate — which is worth reconciling with that row's wording.
* **Op optimiser** [§41.6.4] and **op serialisation** [§41.5.5] — the full op → bytes table, including
  `clearTerminal`'s two arms (alt: `ESC[2J ESC[3J ESC[H`; inline: `ESC[H` + rows × (`ESC[2K` + `CUD(1)`) +
  `ESC[H`). This is exactly our `clearViewport.ts` `clearAltScreen()` / `eraseViewport()` pair — **confirmed
  byte-for-byte**, including that `clearTerminal` in the alt arm carries `ESC[3J`.

### 3.3 Mouse in fullscreen — `tui-ux.md:620` / `:2256` 🟡

The residues our row names (no `scrollHint`, no acceleration) map onto §3.2 and §2.4 above. Two further pieces
the spec supplies that our 🟡 does not name:

* **Mouse-mode re-assertion after resize** [§41.13.1] — `syncTerminalSize()` re-writes the tracking string, but
  **only** when the alternate screen is active **and** the renderer is not paused **and** stdout is a TTY
  **and** the mode is not `off` [`2.1.257:724177-724179`]. Our row claims "the renderer re-arms mouse state on
  resize by contract"; the spec gives the four conjuncts to check ours against.
* **`followScroll` selection compensation** [§41.8.1/§41.13.3] — canon adjusts a live selection's anchor and
  focus rows by the scroll delta each frame, and while dragging extends the selection into the newly revealed
  band. `mouse/selection.ts` records "no scrolled-off capture" as a v1 divergence and `mouse/documentText.ts`
  argues our durable char-addresses make canon's off-screen snapshot (`Cka`) unnecessary — that argument covers
  *extraction*, not *anchor drift during an auto-scroll drag*. Worth a second look against
  `FullscreenViewport.tsx:631` (`AUTOSCROLL_ROWS`, declared `:361`).

### 3.4 Themes — 30 tokens of 72, 4 tables of 6

`theme.ts:30` ships 30 semantic tokens; §41.10.3 tabulates all 72 keys × 6 tables. Every one of our 30 that I
spot-checked matches the spec's cell exactly (dark/light/dark-daltonized/light-daltonized), including the
oddities our header flags as faithful-not-plausible (`background: rgb(0,204,204)`, `remember`) and the
inconsistent spacing canon itself has (`rgb(55, 55, 55)` vs `rgb(215,119,87)`).

The 42 keys we lack, grouped by whether they are reachable:

| group | keys | note |
|---|---|---|
| shimmer twins | `claudeShimmer`, `autoAcceptShimmer`, `permissionShimmer`, `promptBorderShimmer`, `inactiveShimmer`, `warningShimmer`, `claudeBlueShimmer_FOR_SYSTEM_SPINNER`, `fastModeShimmer` | bright end of the shimmer gradient (§41.18, outside my lane) |
| brief mode | `briefLabelYou`, `briefLabelClaude` | needed by the ❌ brief/focus work `tui-ux.md:517` names |
| modes | `fastMode`, `effortUltra`, `merged`, `planMode`✓(have), `ide` | `ide` needs IDE integration |
| spinner | `claudeBlue_FOR_SYSTEM_SPINNER` | |
| rainbow | 7 hues × 2 (plain + shimmer) = 14 | |
| misc | `professionalBlue`, `chromeYellow`, `clawd_body`, `clawd_background` | note `professionalBlue` is the **only** non-`ansi:` value in either ANSI table |

The two ANSI tables (`dark-ansi`, `light-ansi`) are a recorded W3 divergence (`tui-ux.md:834`), and the spec's
table gives their complete values should that ever be revisited. `THEME_LABELS` (`theme.ts`) would need two
more rows plus a custom section (§2.6).

Our `isThemeColor` (`theme.ts:163-169`) is confirmed equivalent to canon's `X6` [§41.9.3], including accepting
out-of-range decimals (`rgb(999,999,999)`) — the spec's regex is byte-identical to ours.

---

## 4. Verbatim assets worth pinning (we do not have these)

### 4.1 Fullscreen boot canary (verified `2.1.251:525141-525142`, `:27563`)

Strike banner (stderr, ends with a newline):
> `Claude Code's fullscreen renderer didn't finish starting last time on this machine, so this launch is using the classic renderer. It will try fullscreen again next launch; /tui default keeps the classic renderer.`

Tripped banner:
> `Claude Code's fullscreen renderer has repeatedly failed to start on this machine, so it has been turned off here. Run /tui fullscreen to try it again (this also resets after an update).`

Bare-`/tui` suffixes (leading space, concatenated after the mode name; sticky vs single-failure):
> ` (fullscreen was turned off on this machine after it repeatedly failed to start; /tui fullscreen retries)`
> ` (a fullscreen launch on this machine didn't finish starting last time; /tui fullscreen retries)`

Debug line (separator is U+00B7):
> `fullscreen disabled: a previous fullscreen launch on this machine died before it was healthy (${kind}) · /tui fullscreen or CLAUDE_CODE_NO_FLICKER=1 to override`

Constants: `Oy = 2` strikes, `Fy = 10000` ms healthy delay, `Ly = 600000` ms live-pid grace,
`Uy = 2592000000` ms cross-host expiry; armed only for entry paths in
`{settings_on, upsell_trial_on, ant_default, fresh_install_on, downsell_on, gb_on}`.

### 4.2 Wheel / arrow toasts (verified `2.1.251:627976`, `2.1.257:395265-395267`)

> `Scroll wheel is sending arrow keys · use PgUp/PgDn to scroll` — `color: "warning"`, `timeoutMs: 12000`,
> key `scroll-as-arrows`, shown 200 ms after the burst.

> `Scroll support in JetBrains IDE 2025.2 terminals is experimental · upgrade to 2025.3+ for the best experience`
> — `color: "suggestion"`, `timeoutMs: 15000`, key `jediterm-scroll-bug`.

Detector constants: window `$1 = 100` ms, threshold `eE = 8` same-direction unmodified arrows.
JediTerm limb constants: `te = 75`, `re = 250`, `Nln = 200`.

### 4.3 tmux hints (verified `2.1.251:769604`, `:769627`; separator U+00B7)

> `tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' to ~/.tmux.conf for wheel scroll`
> `tmux focus-events off · add 'set -g focus-events on' to ~/.tmux.conf and reattach for focus tracking`

Probe table: `{ mouse: { cacheKey: "tmuxMouseOptionProbe", args: ["show","-Av","mouse"] },
"focus-events": { cacheKey: "tmuxFocusOptionProbe", args: ["show","-gv","focus-events"] } }`, 2000 ms timeout,
memoised, each hint at most once per session.

### 4.4 `/scroll-speed` (spec §41.8.4, `chunk-85yqmxdm.js:320962`; command def verified `2.1.251:503095`)

Footer: `Scroll to feel it · ←/→ adjust · r reset to auto · Enter save · Esc cancel`
Body: `<n> line(s) per wheel notch`, with ` (auto)` appended when unset, else ` · auto is <n>`; plus a
`Terminal` row and, when known, an `Editor` row. Description: `Adjust mouse wheel scroll speed`.

### 4.5 `/color` (spec §41.9.5, `chunk-ka3d8dxd.js:578132-578152`)

Reset aliases `["default","reset","none","gray","grey"]`; error
`Invalid color "<name>". Available colors: <list>, default`; successes `Session color reset to default` /
`Session color set to: <name>`; teammate refusal
`Cannot set color: This session is a teammate. Teammate colors are assigned by the team leader.`;
`argumentHint: "[red|blue|green|yellow|purple|orange|pink|cyan|default]"`.

### 4.6 `/tui` refusal strings we lack (spec §41.12.4)

Screen reader:
> `Screen-reader mode always uses the classic renderer, so the tui setting has no effect while it is active.`

Deferred blocker (preference saved, no restart):
> `Staying on the ${mode} renderer without a restart — ${reason}; the preference is saved.`
with `${reason}` ∈ { `work is now running in the background`,
`Claude is now auto-replying to artifact comments and a restart would stop the replies (stop the monitor via /tasks, or ask Claude to stop it)` }.

### 4.7 Small constants and byte strings

* Ellipsis for every truncation mode: `Pc = "…"` (U+2026) — **verified** `2.1.257:717019`.
  `xS(text, width, place)` returns `""` when `width < 1` and the input unchanged when it already fits.
* `textWrap` dispatch is by **prefix** (`u.startsWith("truncate")`), so `truncate`, `truncate-end` and any
  other `truncate*` truncate at the end; only the exact strings `truncate-start` and `truncate-middle` move the
  ellipsis. [§41.7.1.]
* Notification-text sanitiser: every code point `< 32` and every C1 `127–159` → a space, length-preserving
  [§41.7.4]. `terminalEscapes.sanitizeNotificationText` already matches this **exactly** — confirmed.
* Untrusted-content sanitiser (we have no equivalent): strips
  `\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}`, U+2028, U+2029, default-ignorables and U+2800 (Braille blank), preserving
  ZWJ/VS only on request; then a second pass removing bidi overrides U+202A–U+202E and U+2066–U+2069,
  zero-width marks U+200B–U+200F, U+FEFF and the PUA, iterating up to ten times until stable
  [`chunk-sja9rfe2.js:685628-685637`].
* DEC private mode table, verbatim [`2.1.257:841737`]: `CURSOR_VISIBLE 25, ALT_SCREEN 47,
  ALT_SCREEN_CLEAR 1049, MOUSE_NORMAL 1000, MOUSE_BUTTON 1002, MOUSE_ANY 1003, MOUSE_SGR 1006,
  FOCUS_EVENTS 1004, BRACKETED_PASTE 2004, THEME_NOTIFY 2031, SYNCHRONIZED_UPDATE 2026,
  WIN32_INPUT_MODE 9001`. Our `altScreen.ts` covers all but 2031 and 9001.
* Process-exit restore order, `writeSync` so it survives a crash [`2.1.257:723976`]: ASCII charset reset
  (`ESC(B` + SI) → `modifyOtherKeys` reset → kitty pop → focus off → theme-notify off → bracketed paste off →
  cursor show → `ESC7 ESC[r ESC8` → iTerm2 progress clear if progress reporting is on.
* Renderer-construction preamble, TTY only [`2.1.257:724127`]: `ESC7` + `ESC[r` + `ESC8` + `ESC[?25h` — save
  cursor, reset the DECSTBM region, restore, show cursor. We do not reset the scroll region at startup; a
  terminal left with a scroll region by a previous program would confine our frame.

---

## 5. Confirmations

* Alt-screen enter/exit bytes match canon exactly. `ENTER_ALT` (`altScreen.ts:32`) = `Uz()` minus `k2()`
  [`2.1.257:497663`]; `EXIT_ALT` (`:34`) = `yC()` = `ESC[<u` + `ESC[?1049l` + `ESC[>4m` [`:497666`].
* `MOUSE_ON_FULL` / `MOUSE_ON_SCROLL` / `MOUSE_OFF` are byte-identical to canon's composite modes, including
  the reverse-order teardown [§41.11.2, `2.1.257:841744`].
* `clearViewport.ts`'s two arms are canon's two arms, selected on the same axis: alt → `ESC[2J ESC[3J ESC[H`,
  inline → `ESC[H` + rows × (`ESC[2K` + `CUD(1)`) + `ESC[H` [§41.5.5].
* `KITTY_TERMINALS` matches canon's allow-list verbatim and in order
  (`["iTerm.app","kitty","WezTerm","ghostty","tmux","windows-terminal","WarpTerminal"]`,
  `2.1.257:497656`), and `resolveTerminalName`'s ordering (TERM ghostty → TERM kitty → TERM_PROGRAM → TMUX →
  KITTY_WINDOW_ID → WT_SESSION) matches the subset of `At()` that can name one of the seven [§41.11.4].
* `terminalEscapes.osc` / `passthrough` / `sanitizeNotificationText` match `lf` / `bT` / the C0-C1 sanitiser,
  including the transcribed screen ESC-doubling quirk [§41.11.3].
* `theme.ts` colour grammar, validator and the four `detectTerminalBackground` outcomes match canon's `X6` and
  `s()` exactly, including the `n <= 6 || n === 8` dark ladder.
* Selection: our `extractText` join rule (`continuation` → `""`, `hard` → `"\n"`, first span bare) is canon's
  `HardBreak`/`Continuation` semantics; gutter exclusion via `gutterWidth` clamping is functionally canon's
  `noSelect: "from-left-edge"` for the same purpose (not picking up `⏺`/`⎿` on copy).
* Mouse-mode names and the `off` = "write nothing, teardown is separate" rule match `IXe` [§41.13.1].
* Renderer ladder order matches canon's for every rung we implement, and both recorded divergences hold up:
  canon really does have no dimension input (no ≤24-row gate anywhere), and canon's tmux `-CC` spawn gate
  really does require `TERM_PROGRAM` entirely unset [§41.12.1 quotes the same predicate our header cites].
* Reduced motion = setting **OR** screen-reader signal, matching canon [`motion.ts:11`, §41.14].
* `▎` blockquote rail (`markdown.ts:122`) is canon's `quote` border style by another route [§41.4.2].
* Layout: we run Ink's Yoga, canon runs a hand-written JS flexbox behind a Yoga-shaped facade [§41.2]. Nothing
  to port; noted so nobody files it as a gap. The one behavioural consequence worth knowing is canon's
  percentage parsing (`parseInt`, so `"33.5%"` → 33) and half-away-from-zero rounding, which Yoga does
  differently.

---

## 6. Spec defects

1. **§41.10.2, OSC 11 response parser.** The spec says the parser "accepts `rgb:RRRR/GGGG/BBBB`". The actual
   regex is `/^rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i` [`2.1.251:555713`,
   `2.1.257` identical]: the `a` is optional (`rgba:` is accepted) **and the pattern is not anchored at the
   tail**, so trailing bytes after the third channel are tolerated — which matters, because a real OSC 11
   reply often arrives with its terminator attached. The `#`-form arm additionally requires the hex digit count
   to be a multiple of 3, which the spec's "any equal-length triple" states less precisely.
2. **§41.13.2, wheel bubbling.** The `ox(n)` listing is attributed to `[chunk-teb05yv9.js:725139-725146]`, the
   same line the chapter elsewhere assigns to `bte()`'s fullscreen exclusion (§41.8.3) and to `AF()`
   (§41.14, `:725150-725158`). At least one of the three cites is off by a function; the code shown for each is
   internally consistent, so this is a citation slip, not a content error.
3. **§41.9.2 and §41.11.4 are the two places in this lane written from declared behaviour rather than a
   re-read**, per the chapter's own evidence list. I verified §41.11.4's `IO()`/`kFt()` against the bundle and
   they are exact; I did **not** re-read §41.9.2's four adjusters, so §1.5 above is labelled spec-only for the
   adjuster code.
4. **Not a defect, but a caveat the report contract asks for:** §41.8.5 describes the JetBrains wheel
   workaround as three separate rules without stating that *all three, including the 75 ms arrow drop*, sit
   inside the `jediTerm` gate. The gate is shown in the quoted code, so a careful reader gets it — but our own
   port read it the other way, which is how §1.1 happened. Worth a sentence in the spec.

---

### One-line disposition per item, for triage

| # | item | class | verified | effort |
|---|---|---|---|---|
| 1.1 | wheelGuard JediTerm gate + arrow-burst detector | bug | ✅ | small |
| 2.1 | fullscreen boot canary + `crash_auto_off` rung | missing safety net | ✅ | medium |
| 3.1 | `auto` theme OSC 11 tier (+ §1.6 DEC 2031) | 🟡 → ✅ | ✅ | medium |
| 1.2 | mouse env hatches → triBool | bug | ✅ | trivial |
| 1.3 | kitty `>5u` | drift | ✅ | trivial (+ parser check) |
| 1.4 | OSC 8 `id=` | fidelity | ✅ | trivial |
| 1.5 | tmux truecolor clamp | fidelity | partial | small |
| 2.3 | tmux mouse/focus hints | missing feature | ✅ | small |
| 1.7 | `IO()` sync-output gate | recorded divergence → closable | ✅ | small |
| 2.4 | `/scroll-speed` + wheel base | missing feature | ✅ | medium |
| 2.5 | `/color` | missing feature | spec-only | small |
| 3.2 | cell-diff renderer + `scrollHint` | 🟡/❌ blueprint | ✅ (gate) | large |
| 2.6 | custom themes | missing feature | spec-only | medium |
| 2.7 | screen-reader renderer | missing feature | spec-only | large |
| 3.4 | 42 theme tokens + 2 ANSI tables | data | ✅ | trivial (data only) |

---

## 7. Re-verification against somersault (post-bl10)

The first pass read `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`, a frozen checkout predating the
bl10 implementation. Every our-side file cited in §0–§6 was re-compared byte-for-byte against
`/Users/new/Developer/GitHub/somersault/CC-to-SDK`; all line numbers above are now somersault's.

**Files cited that are byte-identical in both trees — no re-verification needed (17):**
`keys/wheelGuard.ts`, `keys/KeymapProvider.tsx`, `renderer.ts`, `altScreen.ts`, `osc8.ts`, `theme.ts`,
`mouse/selection.ts`, `mouse/documentText.ts`, `mouse/hitmap.ts`, `wrapItems.ts`, `markdown.ts`,
`boxStyles.ts`, `terminalEscapes.ts`, `clearViewport.ts`, `resizeRepaint.ts`, `reflowOracle.ts`,
`docs/parity/command-coverage.md`, plus `docs/superpowers/specs/2026-08-12-fullscreen-live-window-design.md`.
That covers §1.1–§1.6, §1.9, §2.1, §2.2, §2.5–§2.7, §3.1, §3.4, and all of §4–§6.

**Files cited that differ — each item re-verified against somersault:**

| item | cited file | verdict | change |
|---|---|---|---|
| §1.7 sync-output gate | `chatMain.tsx` | **corrected (cites only)** | `:531` → `:537`; note `:205-231` → `:211-237`; `:525-531` → `:531-537`. Content of the SYNC block and its divergence note is unchanged; the diff is a `SettingsFileDeps` import and settings plumbing. Claim stands. |
| §1.8 `/tui` ladder | `commands.ts` | **corrected (cites only)** | `:408-426` → `:410-428`. All four strings (`Current renderer:` / `Unknown renderer` / `Already using` / `Saved. … does not apply here`) and `TUI_BUSY_REFUSAL` are unchanged; bl10's diff is confined to the `/cost` `/status` `/usage` `/stats` summaries. Claim stands. |
| §2.4 `/scroll-speed`, wheel base | `FullscreenViewport.tsx` | **corrected (cites only)** | `:788-789` → `:794-795`. Wheel handling is untouched by bl10 — still exactly one row per tick via `PAGER_ACTIONS["scroll:lineUp"]`. Re-grepped somersault for `CLAUDE_CODE_SCROLL_SPEED`: zero hits. Claim stands. |
| §3.3 `followScroll` / autoscroll | `FullscreenViewport.tsx` | **corrected (cites only)** | `:625` → `:631`, with `AUTOSCROLL_ROWS` declared at `:361`. bl10's diff here is T-CLICK's `band` hit-width parameter (`:273-288`, `:311`, `:325-326`) and a `columns` prop on `RenderItemView`; it does not touch scroll or `softWrap`. Claim stands. |
| §2.8 `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL` | `liveWindow.ts` | **unchanged** | bl10's diff is T-SPACE's `MAIN_DOCK_ROWS` 14 → 16 and its comment block. Still no escape hatch (zero hits in somersault). Claim stands. |
| §2.8 `wrap-stream` | `streamingItems.ts` | **unchanged** | bl10's diff is T-SPACE's `withLeadingSeparator` gap. Still no drop-the-final-line mode (zero hits for `wrap-stream`). Claim stands. |
| §3.1/§3.2/§3.3/§3.4 scorecard rows | `docs/parity/tui-ux.md` | **corrected (cites only)** | The file grew 2481 → 2528 lines. The §1–§6 recount-block cites are unchanged (`:517`, `:537`, `:539`, `:540`, `:542`, `:544`, `:620`, `:697`, `:707`, `:834`, `:840`); the §2/§3/§6 row-table cites shifted: `auto` theme `:2319` → `:2366`, paint model `:2245` → `:2292`, sticky chip/hardware scroll `:2211` → `:2258`, mouse in fullscreen `:2209` → `:2256`, fullscreen viewport `:2207` → `:2254`, renderer ladder `:2243` → `:2290`. **All six row statuses are identical** (🟡 / 🟡 / ❌ / 🟡 / ✅ / ✅), so no §3 gap has been closed by bl10. |

**Withdrawn: none.** No finding changed class, and no bl10 work lands in this lane — re-grepping somersault for
the fourteen markers behind §1–§3 (`CLAUDE_CODE_SCROLL_SPEED`, `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL`,
`fullscreenBootPending`, `fullscreenAutoDisabled`, `crash_auto_off`, `arrow-burst`, `focus-events`,
`set -g mouse`, `CLAUDE_CODE_TMUX_TRUECOLOR`, `wrap-stream`, `>5u`, OSC-8 `id=`, `briefLabel*`,
`CLAUDE_AX_PREPARK_MS`) returns zero product hits in every case, and `osc8.ts` / `altScreen.ts:73-77` /
`keys/wheelGuard.ts` are byte-identical to the frozen tree.
