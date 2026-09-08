# D — Input & keybindings (spec ch. 42 §42.1–§42.13) vs the `ccx` keymap

Lane: `42-input-and-keybindings.md` lines 70–3310. Our side: `harness/src/tui/keys/*`,
`harness/src/tui/editor.ts`, `ChatComposer.tsx`, `SettingsDialog.tsx`; scorecard
`docs/parity/tui-ux.md` §1 / §1a (K1–K40).

**Verification posture.** Every claim marked **verified** below was checked by me against
`~/claude-code-bundle/2.1.251/cli.pretty.js` (our canon target) and, where the hop matters, against
`~/claude-code-bundle/2.1.257/cli.pretty.js`. I carved the whole default table out of both bundles
(251: `cli.pretty.js:717586`; 257: `cli.pretty.js:112105`) rather than trusting the spec's rendering,
and the row-by-row diff in §7 is against **251**, with 257 deltas called out. The spec's §42.6 tables
are faithful to 257 in every row I checked.

---

## 0. Top takeaways

1. **`unbound` consumes the key in ccx and does not in canon.** Our dispatcher treats a `null` binding
   as "key eaten"; canon lets the raw key keep bubbling to the focused component (the editor) unless a
   chord prefix was pending. `tui-ux.md` K2 scores this ✅ *and states the wrong rule*. Our whole
   suppression-block design leans on the ccx behaviour, so this is a "record it, don't fix it" item —
   but the ledger claim has to change. **§1.1.**
2. **Three reserved keys are missing from `RESERVED_KEYS`** — `ctrl+[`, `ctrl+i`, `ctrl+h`, all
   error-severity in canon, byte-identical to Escape/Tab/Backspace. A user binding one of them today is
   accepted by us and silently dead. Verbatim reasons in **§4.1**. Cheapest real fix in this lane.
   **§3.1.**
3. **We drop reserved-key bindings; canon keeps and only warns.** Verified in 251: the load filter
   discriminates on *action* only (`cli.pretty.js:717805`), so a user binding on `ctrl+c` loads and
   fires in canon. We refuse it. **§1.2.**
4. **The left-arrow guard's missing body is now fully specified** — the exact reason our
   `ChatComposer.tsx:84-98` comment says "`reject` … is not transcribable". Nine branches, four
   constants (3000 / 1000 / 150 / 2000 ms), a `soloKeypress` input we don't produce, and **three**
   confirm-hint strings (canon's third, `Press ← again to open agents`, is the one that matches ccx's
   semantics — we print `Press ← again`). **§3.2**, verbatim in **§4.2**.
5. **`Scroll`'s `pageup`/`pagedown` are half-page in ours, full-page in canon** — a deliberate FSW-T11
   choice (`plans/2026-08-12-fullscreen-live-window.md:298`) that isn't in any divergence list. Also
   `Transcript` gains `pageup`/`pagedown` in ours, which canon does not bind at all. **§1.3.**
6. **K21 is factually wrong about `DiffPanel`.** It says our empty `DiffPanel` matches "exactly as
   upstream ships `DiffPanel`". Canon ships `ctrl+x b → app:cycleDiffBase` in `DiffPanel`, in both 251
   and 257. **§1.5.**
7. **Vim mode (§42.13) is owner-deferred and now completely specified** — state machine, motion table,
   operators, text objects, the `vimInsertModeRemaps` validator, the mode-indicator literals, the
   `editorMode` settings-resolution chain, and the one keybinding-layer feedback (`chat:cancel`
   deactivated outside NORMAL). If vim is ever un-deferred this chapter is the build order. **§3.6.**

---

## 1. Corrections — things we built that canon does differently

### 1.1 `unbound` consumption (VERIFIED, 251 + 257)

- **Ours**: `harness/src/tui/keys/KeymapProvider.tsx:300` — `if (res.type === "unbound" || res.type === "chord-cancelled") return;   // consumed`.
- **Canon**: spec §42.7.4 / §42.10.4. In the scope-chain path `unbound` runs the pre-dispatch handlers
  and, if none claims the key, returns **without** calling the consume callback, so the key still
  reaches the focused component (the prompt editor). Only the legacy path *with a chord already
  pending* consumes. Verified myself at `2.1.251/cli.pretty.js:612714-612721` — the `unbound` branch
  calls `ue(null, !1)` (a trace report) and never the consume callback `dt()`/`It()`.
- **User-visible impact**: in canon, `{"context":"Chat","bindings":{"ctrl+g": null}}` unbinds the
  external-editor action *and* lets `ctrl+g` fall into the editor. In ccx the same file makes `ctrl+g`
  a hard no-op. More consequentially it is why our own table has to bind rather than null in places —
  e.g. `bindings.ts:352` binds `ctrl+u`/`ctrl+d` in `SelectDecision` specifically because "an explicit
  unbind resolves to `{type:"unbound"}`, which `dispatch` treats as CONSUMED".
- **Scorecard**: `tui-ux.md:2072` K2 — "`null` consumes as explicitly unbound | ✅". The ✅ is
  defensible (our model is coherent and load-bearing); the *description* asserts parity that does not
  exist. Recommend: keep ✅, rewrite the cell, and add a row to "Deliberate divergences".
- **251 vs 257**: no change across the hop.

### 1.2 Reserved keys are advisory in canon, fatal in ours (VERIFIED, 251)

- **Ours**: `harness/src/tui/keys/userBindings.ts` `checkEntry` — an `error`-severity reserved key
  returns `null`, i.e. the binding is **dropped** ("`— binding ignored`").
- **Canon**: §42.8.5. `pNo` pushes a `{type:"reserved", severity, message}` record and nothing more;
  the load filter `SBe` keeps every entry whose action is `null` or a known action
  (`2.1.251/cli.pretty.js:717805`: `.filter((r) => r.action === null || B(r.action))`). The binding is
  merged and fires. The only thing that strips reserved keys is `/keybindings`'s **template generator**
  (spec §42.8.5, `chunk-55zhfsqw.js:268127`), which is a different code path.
- **Impact**: a user who rebinds `ctrl+c` gets it in Claude Code and does not get it in ccx. Ours is
  arguably safer, but it is a divergence, unrecorded.
- **Also unrecorded**: our macOS `super+*` block is applied unconditionally
  (`bindings.ts:456` header comment says so); canon appends `Dun` only when the platform detector
  returns `"macos"` (§42.8.5).

### 1.3 `Scroll` paging keys (VERIFIED, 251 + 257)

| | canon | ours (`bindings.ts:182`) |
|---|---|---|
| `Scroll` `pageup` | `scroll:pageUp` | `scroll:halfPageUp` |
| `Scroll` `pagedown` | `scroll:pageDown` | `scroll:halfPageDown` |
| `Transcript` `pageup`/`pagedown` | **not bound** | `scroll:pageUp` / `scroll:pageDown` |

Deliberate — `plans/2026-08-12-fullscreen-live-window.md:298` ("per-context half-page, plan review
I5/I11"). Not in `tui-ux.md`'s divergence tables. K22 scores the `Scroll` context ✅ without noting
that two of its fourteen rows carry different actions than canon.

### 1.4 `ctrl+b` lives in `Global`, not `Task` (already recorded, restated for the diff)

Canon binds `ctrl+b → task:background` **only** in `Task` (verified, both bundles). We bind it in
`Global` (`bindings.ts:58`) and keep `ctrl+x ctrl+b` in `Task`. `bindings.ts` calls this CTRL-B-1, "a
permanent recorded divergence". Consequence visible in the table: eight of our contexts have to carry
`"ctrl+b": null` + `"ctrl+x ctrl+b": null` suppression rows that canon needs in none of them.

### 1.5 K21's `DiffPanel` claim is false (VERIFIED, 251 + 257)

`tui-ux.md:2091` K21: "`DiffDialog`/`DiffPanel` validate as context names and carry no bindings,
**exactly as upstream ships `DiffPanel`**". Canon ships exactly one `DiffPanel` binding —
`{ context: "DiffPanel", bindings: { "ctrl+x b": "app:cycleDiffBase" } }` — in both 2.1.251 and
2.1.257. The context that genuinely ships with no defaults is `ProactivityMenu` (spec §42.4 table),
which we don't have at all. Fix the cell; the 🚫 verdict itself still stands (no diff panel in ccx).

### 1.6 K16 is stale

`tui-ux.md:2086` K16 — "Confirmation `tab` next field · `shift+tab` cycle mode · `ctrl+e` explanation |
Not built | ❌". Two of the three shipped since: `bindings.ts:368` binds `shift+tab →
confirm:cycleMode` (F6 T7) and `bindings.ts:383` binds `ctrl+e → confirm:toggleExplanation` (Wave T
t7). Only `tab → confirm:nextField` and `space → confirm:toggle` remain unbuilt. K16 should read 🟡.

### 1.7 `MessageSelector` action names (recorded, worth a portability note)

Canon: `messageSelector:up/down/top/bottom/select`. Ours: the nav resolves one layer in at `Select`,
and the eight jump aliases are retargeted onto `select:first`/`select:last`
(`bindings.ts:221-229`, F6 T10). Behaviourally equivalent, deliberately. But it means a real Claude
Code `keybindings.json` containing `messageSelector:top` is rejected by our validator as an unknown
action — see §1.8.

### 1.8 The "an existing Claude Code keymap applies to ccx unchanged" premise is narrower than stated

`userBindings.ts` header: "The path is UPSTREAM'S OWN — a user who already customized Claude Code gets
those bindings in ccx for free — and so is the file shape". Measured: canon has **145 actions in 27
namespaces** (§42.5); we have **72 in 17** (counted from `VALID_ACTIONS`). Eleven whole canon
namespaces are absent (`strip`, `proactivityMenu`, `attachments`, `footer`, `diff`, `plugin`,
`permission`, `voice`, `theme`, `agents`, `effortSlider`), plus `chat:submit/queueSubmit/newline/undo/
stash/clearScreen/fastMode/workflowKeywordToggle/cycleProactivity/attention*`, `history:previous/next`,
`messageSelector:*`, most of `app:*` and four of `settings:*`. Each such entry is dropped by
`checkEntry` with "is not a known action — binding ignored". Additionally our context **names** differ:
`EffortDialog` where 257 canon says `EffortSlider`, and `SelectDecision`/`SessionPicker` are ours
alone — and an unknown context makes us drop the **whole block**, where canon retains it (inert) and
only records an advisory `invalid_context` (§42.7.2). Not a defect; a claim that needs qualifying.

### 1.9 Structural failure is all-or-nothing in canon, per-block in ours

Canon §42.8: `XQ(v)` is `Array.isArray(v) && v.every(sNo)`, so **one** malformed block discards every
user block and the loader returns defaults plus a single `keybinding_config_invalid_structure`
warning. Ours (`userBindings.ts` `validate`) drops only the offending block and keeps the rest. Ours is
better; it is still a behaviour difference a user could notice.

### 1.10 `Settings`: any printable key opens the search box (VERIFIED, 251)

Canon (§42.6.5, verified at `2.1.251/cli.pretty.js:760241-760244`): in the config panel, a key with no
`ctrl`/`meta`, whose `key` string is exactly one character and is not space, opens the search box and
**seeds the query with that character** — except `/`, which opens it empty. Ours binds only
`/ → settings:search` and its browsing-mode fallback is `useKeyFallback(route(() => {}))`
(`SettingsDialog.tsx:575`), so every other printable key does nothing. Type-to-search is the gesture
most users will reach for first.

### 1.11 The `?` overlay's binding in vim NORMAL (context only, we have no vim)

Not actionable now; noted so §3.6 is complete.

---

## 2. Unknown unknowns — canon behaviours with no `tui-ux.md` row

Reachability note applies to all: none of these needs SDK data. The keymap layer is entirely local to
the TUI, so everything here is buildable if we want it — the constraint is surface existence, not
transport.

1. **`keybindingFlavor: "classic" | "readline"`** (§42.12.2). A settings enum, default `classic`, that
   changes four editor keys: `ctrl+w` becomes delete-to-previous-whitespace, `alt+b`/`alt+f` use
   letters-and-digits word runs so punctuation separates words, and `alt+d` becomes `killWord` — which
   **feeds the kill ring**, so `ctrl+y` can bring it back. We have no row for this anywhere; the key
   name appears in our repo only as an app-server settings passthrough
   (`harness/src/appserver/configDomain.ts:190`) and in the drift log as one of the nine keys adopted
   from SDK 0.3.250. Our `editor.ts` implements exactly canon's `classic` branch, including the
   subtlety that `alt+d` is *not* a kill (`editor.ts:504`) — so the gap is only the second flavour.
   The normative setting description is a verbatim asset (§4.4).
2. **`chat:queueSubmit` / `ctrl+x enter`** (§42.6.3). A chord that queues the current draft rather than
   submitting it. We have queueing but no key and no action for it.
3. **`app:redraw`, `app:toggleTerminal`, `app:toggleReplTab`, `app:toggleDiffNoiseFilter`,
   `app:toggleDiffPreSession`, `confirm:previousField`, `diff:back`, `permission:toggleDebug`** — the
   nine actions canon declares with **no default binding**, reachable only by writing a keybindings
   file (§42.5). `selection:clear` is the one of the ten we already carry that way
   (`bindings.ts:445`). `app:redraw` in particular is a cheap, surface-independent win.
4. **The `command:` collection loop is context-blind** (§42.7.3). Canon scans the *merged* binding list
   for any action starting with `command:` regardless of which context block it came from, then
   registers every one in `Chat`. The `Chat`-only rule is a *warning*, not a gate, and the name regex
   is advisory too — `command:` with an empty name is retained and submits a bare `/`. Ours rejects
   both cases at load (`userBindings.ts` `checkEntry`). K6 scores ✅.
5. **`tengu_keybinding_fallback_used` / the `S_` three-state display contract** (§42.3.3). Canon's
   chord-display helper returns three distinct things: the formatted chord; `""` when the action has
   bindings in that context but **every one of them is shadowed by a later entry** — including
   shadowed by a *reassignment to a different action*, not just by `null`; and the caller's literal
   fallback when the action was never bound in that context, logging a telemetry event once per
   `action:context`. Our `bindingFor` collapses the middle and last cases into `null`
   (`resolver.ts` tail). Marginal, but the "shadowed by reassignment" case is a real hint-honesty hole:
   rebind `ctrl+g` to something else in `Chat` and canon stops advertising it for
   `chat:externalEditor`; we would still list it, because `compileBindings` overwrites in place and
   loses the fact that the *action* lost its last chord.
6. **Watcher semantics** (§42.7.1). Canon uses chokidar with `usePolling`, `interval: 2000`,
   `awaitWriteFinish {stabilityThreshold: 500, pollInterval: 200}`, `atomic: true`, and handles
   `unlink` by reverting to defaults with **no** feature event. Ours is `fs.watchFile` at 500 ms
   (`userBindings.ts` `WATCH_MS`), documented as a deliberate dependency-avoidance trade. One real
   behaviour delta: canon's `awaitWriteFinish` means a half-written file is never parsed; our
   mtime/size poll can catch an editor mid-write and report a spurious parse error that self-heals on
   the next tick.
7. **`ProactivityMenu`** — a 23rd valid context that ships with no defaults and is filtered out of the
   help skill's context table (§42.4). If we ever accept a canon keybindings file verbatim, this name
   must validate.
8. **`Agents` context + `agents:switchView`/`agents:togglePin`** (257 only; verified absent in 251).
   `ctrl+s`/`ctrl+t` inside the `claude agents` view. Our nearest surface is the background pane K14
   opens. 257-only — do not chase on 251 canon, but it is where the name will land.
9. **`EffortSlider` context** (257 only; verified absent from 251's context list). Our
   `bindings.ts:251` block header states as fact that "Upstream has no context for it: `L447278` reads
   left/right/return/escape raw off its own container". True on 251; **falsified by 257**, which
   ships `{ context: "EffortSlider", bindings: { s: "effortSlider:thisSessionOnly" } }`. If we want
   user-file portability, renaming our `EffortDialog` → `EffortSlider` is a one-line change that costs
   nothing and buys the canon name.
10. **`Attachments` and `Footer` are complete, small contexts** (6 and 11 rows). Both are 🚫 today for
    want of a surface, but if attachment chips or a focusable footer ever ship, the keymaps are
    fully specified and should be transcribed rather than invented.
11. **`nE`'s printable-key derivation and the `eGt` normaliser** (§42.2 steps 7 and 10) contain two
    rules we should check our parser against: `enter` normalises to the literal `"\n"` as its key, and
    `shift` is **inferred** for any single upper-case character even when the terminal did not report
    the modifier. Our `normalize.ts` `parseKeySpec` does the second for *written specs*
    (`raw >= "A" && raw <= "Z"` → shift), and `parse.ts` presumably does it for events; the canon rule
    is stated on the *event* side, which is where a mismatch would bite.
12. **The `Qr` fallback-suppression set** (§42.12.4): `insert clear enter center undefined mouse f1..f12`
    — names that reach the editor tail and return with no effect rather than inserting. Our editor's
    equivalent is implicit. Worth a pinned set so an F-key can never insert a stray glyph.
13. **`vimInsertModeRemaps`** (§42.13.5) — even without vim, the validator is a nice self-contained
    spec: NFC-normalise, exactly two printable non-space chars, grapheme count 2, target `<Esc>`
    case-insensitively; two recognition branches with different timing rules (1000 ms + cursor
    position for two events; no checks at all when one event carries both characters).

---

## 3. Known gaps now specified

### 3.1 The three missing reserved keys — `tui-ux.md` "Unreachable keys" table

That table already reasons about `ctrl+m ≡ enter` and carries its verbatim reason. Canon reserves two
more of the same family plus one more: `ctrl+[` ≡ Escape, `ctrl+i` ≡ Tab, `ctrl+h` ≡ Backspace, all
`error`. Verified byte-identical in 251 (`cli.pretty.js:717594`) and 257 (`cli.pretty.js:112113`).
Strings in §4.1. Note the interaction: our editor binds `ctrl+h` as delete-token-or-backspace
(`editor.ts:542`, K10) — which is *consistent* with canon reserving it, since canon's own `ctrl+h`
editor entry is `deleteTokenBefore() ?? backspace()` (§42.12.3).

### 3.2 The left-arrow guard — `ChatComposer.tsx:88-95` names this gap by hand

Our comment: "Upstream's decision function has six … and the annex records the names without the body,
so what distinguishes `reject` from `arm` is not transcribable. This port arms on every ← that reaches
an empty composer." §42.12.6 supplies the body: nine branches in evaluation order, with the two
non-obvious orderings spelled out (row 6 `absorb` is tested *before* row 7 `fire`, so a second press
inside 1000 ms is swallowed and only re-stamps; `arm` stamps both `armedAtMs` and `lastLeftPressMs`).
Constants: `Xit = 3000` (arm window and hint `timeoutMs`), `Ft = 1000` (absorb), `Gr = 150`
(attach debounce), and a 2000 ms "input became empty" recency gate below which arming does not happen
at all — outside it, an empty-input `←` **fires immediately with no hint** (row 9). `reject` is row 1:
`soloKeypress !== true`, i.e. the press arrived inside a burst, in which case it is an ordinary
`m.left()`. That input we do not currently produce — but `KeymapProvider`'s `emit()` is the one place
that sees a whole stdin chunk, so `soloKeypress` is one counter away (canon derives it the same way,
§42.2 step 6). The attach rows (2–4) are dead in 2.1.257 (`d4e` returns `!1`), so a port needs rows
1 and 5–9 only.

**Plus a string correction the spec under-reports.** §42.12.6 gives two hints (`Yit`, `lPt`). The real
selector has **three** — verified at `2.1.251/cli.pretty.js:145270-145281` and
`2.1.257/cli.pretty.js:390218-390227`. The ccx case (no attach, left-arrow opens agents) is the third,
`"Press ← again to open agents"`. We print `"Press ← again"` (`ChatComposer.tsx:100`), which is none of
the three. Verbatim in §4.2.

### 3.3 K29 `Settings` — the six unbuilt keys, plus §1.10's type-to-search

`r → settings:retry`, `d → settings:periodDay`, `w → settings:periodWeek`, `t → settings:sortByTokens`,
`ctrl+u → scroll:halfPageUp`, `ctrl+d → scroll:halfPageDown` (§42.6.5, verified in 251). Still gated
on our Usage/Stats tabs being static, so the ❌ stands — but the type-to-search behaviour in §1.10 is
independent of those tabs and is the part worth building.

### 3.4 K32 `ThemePicker` — two keys, exact

`ctrl+t → theme:toggleSyntaxHighlighting`, `ctrl+e → theme:editCustom` (§42.6.11, verified). We have a
`ThemeDialog`; both keys are transcribable today. ❌ → buildable.

### 3.5 K8 platform branching — the exact predicate

We score K8 ❌ ("None"). §42.6 gives the whole computation: `QDo = (windows||wsl) ? "alt+v" : "ctrl+v"`
with WSL *additionally* keeping `ctrl+v`; and `LNn = shift+tab` unless the platform is Windows **and**
the runtime cannot deliver a distinguishable Shift+Tab (Bun `< 1.2.23`, or Node outside
`>=22.17.0 <23.0.0 || >=24.2.0`), in which case `meta+m`. Both folded to constants in the carved macOS
build, so a reimplementation must write the general logic. We bind `ctrl+v` *and* `alt+v`
unconditionally (`bindings.ts:75`) with the rationale that a key the terminal never sends costs
nothing — which is fine for imagePaste but does not give us the `meta+m` fallback for `chat:cycleMode`
on old-runtime Windows. K8 can move ❌ → 🟡 with a note, or stay ❌ with the predicate recorded.

### 3.6 Vim mode — `tui-ux.md:1599` (`CM60` 🚫), `:2014`, `:2279`, `:2334` (owner-deferred)

§42.13 is a complete build spec: three-shape state machine plus the full pending sub-state union; the
motion set `h l space j k w b e W B E 0 ^ $` + `f F t T` + `gj gk gg G ; ,`; the explicitly
**not implemented** list (`% { } ( ) H M L n N * # / ? | + - _ ge gE [[ ]] marks g_ g0 g$`) — worth as
much as the implemented list, because it bounds the work; operators `d c y` with doubling, count
multiplication (`3d2w` = 6 words), the bracket-pair table, `iw/aw/i"/a"/i(/ib/iB/i<` etc. with
`it/at`, `is/as`, `ip/ap` absent; the indent rules (prepend exactly two spaces; un-indent tries
2-spaces → 1-tab → up-to-2 leading `\s`); the eighteen dot-repeat kinds and the `uo` re-enter-INSERT
predicate; the count clamp `min(n*10+d, 10000)`; the INSERT-remap validator; the mode indicator
literals `-- INSERT --` / `-- VISUAL --` / `-- VISUAL LINE --` (NORMAL renders nothing) and the
`statusLine.hideVimModeIndicator` opt-out; **no DECSCUSR cursor-shape emission at all**; and the one
keybinding-layer coupling — `chat:cancel` is deactivated whenever vim is on and the mode is not
NORMAL, so `escape` is a vim key in INSERT/VISUAL and the interrupt in NORMAL. Also: `/vim` is a hidden
redirect behind a default-off gate; the only real routes are `/config`'s Editor-mode row,
`/config editor=vim`, and the settings file — read through the full source chain
(`policySettings > flagSettings > localSettings > projectSettings > userSettings > legacy ~/.claude.json > default`).

### 3.7 `tui-ux.md:2022` "Hint strings generated from the live binding | 🟡"

**Substantially advanced by bl10 and the scorecard has not caught up.** T-MENU shipped
`dialogs/keyhints.ts` + `DialogFrame`'s `hintScope`, an auto keyhint bar that derives a dialog's
footer from that scope's own default bindings, deduped by description and capped at canon's
`Pe = 4` — canon's `Ye`→`Z` mechanism (`2.1.251/cli.pretty.js:568825`, `:568834`, both verified).
`SettingsDialog`'s two hand-written footers (`NORMAL_FOOTER`, `READONLY_FOOTER`) are deleted in
favour of it, and `McpDialog` was built on it from the start (`hintScope={["Select"]}`).

§1a's "Hint derivation" prose (`tui-ux.md:2167`) still lists only the F2/F4-era derived surfaces and
does not mention the bar at all — the largest single addition to hint derivation since F4. The 🟡 on
the §1 row is now conservative.

The residual difference from canon: canon's `Z` walks a live focus-node tree to collect
`{action, hint}` entries up to a boundary; we have no such tree, so the caller names the reachable
scope explicitly. In-source and deliberate.

---

## 4. Verbatim assets

Checked against our source first. All still unheld except §4.3, which bl10 shipped — see there.

### 4.1 The three missing reserved-key rows (§42.8.5; verified `2.1.251/cli.pretty.js:717594`)

```
ctrl+[  Cannot be rebound - identical to Escape in terminals        error
ctrl+i  Cannot be rebound - identical to Tab in terminals           error
ctrl+h  Cannot be rebound - identical to Backspace in terminals     error
```

Drop straight into `bindings.ts:456` `RESERVED_KEYS`. The four we already carry are byte-identical to
canon's; so are the `ctrl+z` / `ctrl+\` reasons and severities.

### 4.2 The three left-arrow confirm hints (verified `2.1.251:145270-145281`, `2.1.257:390218-390227`)

```
Press ← again to go back              (a session with a caller to detach to)
Press ← again to go back to agents    (detach path available)
Press ← again to open agents          (leftArrowOpensAgents — the ccx case)
Ambiguous ←, press again to detach    (attach-arm; dead in 2.1.257)
```

### 4.3 Action → on-screen hint text (§42.5) — **already shipped verbatim, post-bl10**

**Corrected on re-verification.** bl10's T-MENU wave landed
`harness/src/tui/dialogs/keyhints.ts`, whose `KEY_HINT_DESCRIPTIONS` is this table transcribed from
canon `Ye` — I verified the source at `2.1.251/cli.pretty.js:568825` and the cap
`MAX_HINTS = 4` against canon `Pe` at `:568834`. So this is no longer an unheld asset. What remains:

- **Present and byte-identical** (16 rows): `confirm:yes` `confirm:no` `confirm:previous`
  `confirm:next` `confirm:cycleMode` `confirm:toggleExplanation` · all 8 `select:*` ·
  `tabs:next` `tabs:previous`.
- **Absent, for actions we don't bind** (deliberate, the file's header says so):
  `confirm:nextField` → `next field`, `confirm:previousField` → `previous field`,
  `confirm:toggle` → `toggle`, `app:toggleReplTab` → `switch tab`,
  `app:toggleDiffNoiseFilter` → `show/hide tests in diff panel`,
  `app:diffFileListUp`/`Down` → `scroll diff panel file list`,
  `app:toggleDiffPreSession` → `show/hide pre-session changes in diff panel`,
  `app:cycleDiffBase` → `switch diff panel base`.
- **Ours beyond canon**: `settings:search` → `search` and `help:dismiss` → `dismiss`. I confirmed
  neither appears in canon's `Ye`.
- **Spec defect, minor**: §42.5's rendering of this table omits
  `confirm:toggleExplanation` → `explanation`, which 251's `Ye` carries. Same 251→257 removal as
  §6.2 — the action and its hint went together.

A `command:` binding's hint is the command name itself (`chunk-5cvc4tk1.js:270334`); we have no
`command:` hint path.

### 4.4 `keybindingFlavor` setting description (§42.12.2) — the normative statement of the readline flavour

Full text at spec line ~2418 (`chunk-ejcy5qcd.js:488712`). Point to it rather than paste; it is the
spec for §2.1.

### 4.5 Validation strings (§42.8.1–§42.8.4) — full set, see §8 for the row-by-row diff against ours

Worth pinning if we ever want message-level parity: the five structural messages with their
suggestions, the nine per-block messages, the three-tier "did you mean" suggester (Levenshtein ≤ 2 →
`Did you mean "X"?`; else `Valid "ns:" actions: …`; else `Valid action namespaces: …`), and the two
duplicate messages. Also the debug-log line shape:
`[keybindings] [${severity}] ${message}${suggestion ? " — " + suggestion : ""}`.

### 4.6 The `keybindings-help` skill (§42.9)

~350 lines of model-facing prose plus three generated tables. We ship `/keybindings` and a starter
template (`userBindings.ts` `STARTER_KEYBINDINGS`) but no skill. The skill's "Behavioral Rules" list
(5 items, incl. "warn proactively if they choose a key that conflicts with … tmux `ctrl+b` and screen
`ctrl+a`") and its "Common Issues and Fixes" table are the parts worth lifting if we ever add one.

### 4.7 Other constants worth pinning

`fi = 1000` chord timeout (matches our `CHORD_MS`) and its debug line
`[keybindings] Chord timeout - cancelling` (verified `2.1.251:612538`); watcher
`stabilityThreshold: 500` / `pollInterval: 200` / `interval: 2000`; prompt-undo `maxBufferSize: 50`,
`debounceMs: 1000` (matches ours); `ctrl+u` kill hint `Ctrl+Y to paste deleted text` at 5000 ms;
vim count clamp `10000`; vim INSERT-remap window `1000`.

---

## 5. Confirmations

- **Chord machine.** Generic space-separated chords, 1000 ms inter-key window, `escape` cancels and
  consumes, only extensions considered while pending, the breaking key dropped. Ours matches on every
  point (`resolver.ts`, `KeymapProvider.tsx:56,181-184,298-302`); K4 ✅ stands.
- **Chord-prefix unbinding.** §42.10.2 step 5: a `null` on a full chord removes it from the prefix set,
  and two different chords sharing a prefix are independent. `resolver.ts` `compileBindings` reaches
  the same outcome by never arming a prefix from a null entry, with the reasoning written out.
- **Ordered-context precedence, `Global` last.** §42.10.3's scope-chain matcher `n1e` resolves ties by
  walking the caller's context array in order, innermost first, `Global` always appended. Ours is
  identical (`registry.ts:53-60`, `resolver.ts:resolveKey`). See §9 for the one caveat.
- **Merge order.** `[...defaults, ...user]`, later-wins within a context, `null` survives the load
  filter, unknown actions silently dropped at load and separately reported. Ours matches.
- **Additive semantics.** "To move a binding, unbind the old chord AND add the new one" — our
  `STARTER_KEYBINDINGS` `$docs-unbind` says exactly this.
- **Alias folding.** `esc/return/del/↑↓←→` key aliases and `control`/`opt`/`option`/`meta`/`cmd`/`command`/
  `win` modifier aliases; `alt ≡ meta` in comparison. `normalize.ts` matches, including `caps` →
  `capslock` being needed only because the reserved table names it.
- **`ctrl+-` ≡ `ctrl+_`.** Canon binds all four spellings to `chat:undo`; our `normalize.ts`
  canonicalises all four onto one spec because the byte is the same. Same outcome, fewer rows.
- **Platform-aware chord display.** `alt`→`opt` and `super`→`cmd` on macOS, plus the widened macOS test
  (iTerm2 / Apple_Terminal / iTerm.app by env var). `hints.ts:41,74-76` does both, and additionally
  ships canon's *two* display grammars (title-case and lower-case).
- **Prompt-undo buffer.** Cap 50, 1000 ms coalesce, `pastedContents` inside each entry, no redo. Ours
  matches (CM17, `editor.ts` `UNDO_CAP`).
- **`classic` word-editing semantics.** Our `ctrl+w` is Unicode-word delete and our `alt+d` deliberately
  does not feed the kill ring — exactly canon's `classic` branch, default. K12's recorded edge is
  canon's shape too.
- **Editor ctrl map.** `a b c d e f h k n p u w y` — ours covers `a b e f h k n p u w y` plus `l`/`s`,
  with `c`/`d` handled at app level; canon's `ctrl+h` is `deleteTokenBefore() ?? backspace()`,
  ours identical (`editor.ts:542`).
- **Kill-ring sequence predicate.** Canon extends a kill run on `ctrl+k/u/w`, `alt+d` (readline only),
  and modified `backspace`/`delete`; ours coalesces on the same set minus the readline `alt+d`.
- **`meta+backspace` / `meta+delete` as kills.** Canon: `backspace` with `ctrl|meta|super` kills the
  word before (prepend); `delete` with `meta|super` kills to line end (append). Ours matches for the
  `ctrl`/`meta` halves; the `super` halves are unported and the source says why.
- **Named-key coverage.** Our `parse.ts` produces `home end insert delete pageup pagedown f1..f12` and
  synthesises `wheelup`/`wheeldown` as key names — canon does the same (§42.6.12, "wheelup/wheeldown
  are real key names in this system").
- **Ctrl-Z as a warning-severity reserved key handled pre-table.** K37 ✅ — canon intercepts at the
  router above the dispatcher, and only in a foreground session.
- **The default table itself**, everywhere we do bind: `Global` (6 of 11), `Chat` (7), `Autocomplete`
  (2 of 4), `Settings` (10 of 17), `Confirmation` (8 of 10), `Tabs` (4 of 4), `Transcript` (20 of 20),
  `HistorySearch` (6 of 6), `Task`, `Scroll` (12 of 14), `Help`, `ModelPicker` (3 of 3), `Select`
  (12 of 12) — all byte-equal to 251 canon where present.

---

## 6. Spec defects

1. **§42.12.6 lists two left-arrow hint strings; there are three.** The selector at
   `2.1.257/cli.pretty.js:390218-390227` returns `"Press ← again to go back"` (caller-detach),
   `Yit` = `"Press ← again to go back to agents"` (detach path), and
   `"Press ← again to open agents"` (`leftArrowOpensAgents`). The spec names only the last two of a
   different pairing and describes the default as a bare `Press ← again`, which no branch emits. The
   third string is the one a reimplementer of the ccx-shaped case needs.
2. **§42.6.6 `Confirmation` is correct for 257 but silently drops a 251 row.** 251 binds
   `ctrl+e → confirm:toggleExplanation` (verified `2.1.251/cli.pretty.js:717586`); 257 does not, and
   `confirm:toggleExplanation` is absent from 257's action catalogue (§42.5 lists 8 `confirm` actions,
   none of them it). That is a genuine 251→257 removal, not a spec error — but it is not in the
   chapter, and `A5-cross-version-notes.md` is where it belongs. **Consequence for us:** our
   `bindings.ts:383` `ctrl+e → confirm:toggleExplanation` is right for our 251 canon and would be a
   dead action on 257.
3. **§42.4's claim that `DiffPanel` "has default bindings: yes" is right, and §42.6.2 renders the row —
   but the spec never reconciles this with `ProactivityMenu` being the only no-defaults context.** Not
   an error; flagged because our own K21 got this backwards and the spec's §42.4 table is the source
   that corrects us.
4. **Nothing else contradicted the bundle.** I re-derived the whole §42.6 table from 257 and every row
   matched, including the platform spreads, the `[LNn]`/`[QDo]` computed keys, and the 23-name context
   list. The chapter's R4 review shows.

---

## 7. Binding-table diff — canon §42.6 (verified vs 2.1.251) vs `harness/src/tui/keys/bindings.ts`

Legend: **=** same · **≠** differs · **–** missing in ours · **+** extra in ours.
"Recorded?" cites `tui-ux.md` unless noted.

### Global — canon 11 rows

| Key | Canon action | Ours | Recorded? |
|---|---|---|---|
| `ctrl+c` | `app:interrupt` | = | |
| `ctrl+d` | `app:exit` | = | |
| `ctrl+t` | `app:toggleTodos` | = | |
| `ctrl+o` | `app:toggleTranscript` | = | |
| `ctrl+shift+b` | `app:toggleBrief` | – | K19 🚫 (no surface + `ctrl+shift+<letter>` unreachable) |
| `ctrl+r` | `history:search` | = | |
| `ctrl+up` | `app:diffFileListUp` | – | K20 🚫 (vestigial upstream) |
| `ctrl+down` | `app:diffFileListDown` | – | K20 🚫 |
| `meta+up` | `app:diffFileListUp` | – | K20 🚫 |
| `meta+down` | `app:diffFileListDown` | – | K20 🚫 |
| `ctrl+]` | `app:openArtifact` | – | K19 🚫 |
| `ctrl+b` | *(canon: `Task` only)* | **+** `task:background` | `bindings.ts` CTRL-B-1; **not in tui-ux.md** |

### DiffPanel — canon 1 row

| `ctrl+x b` | `app:cycleDiffBase` | – | K21 🚫 — **but K21's stated reason is false** (§1.5) |

### Chat — canon 24 rows (macOS build)

| Key | Canon action | Ours | Recorded? |
|---|---|---|---|
| `escape` | `chat:cancel` | = | |
| `ctrl+l` | `chat:clearInput` | = | |
| `cmd+k` | `chat:clearScreen` | – | K18 🚫 unreachable |
| `ctrl+x ctrl+k` | `chat:killAgents` | = | |
| `shift+tab` | `chat:cycleMode` | = | (K8: no `meta+m` fallback) |
| `meta+p` | `chat:modelPicker` | = as `alt+p` | K17 — equivalent under `alt ≡ meta` |
| `meta+o` | `chat:fastMode` | – | K17 🟡, dropped with rationale |
| `meta+t` | `chat:thinkingToggle` | = as `alt+t` | |
| `meta+w` | `chat:workflowKeywordToggle` | – | K17 🟡, dropped with rationale |
| `enter` | `chat:submit` | – (editor.ts) | "editor keys literal by design" (`tui-ux.md:2217`); **no K-row** |
| `ctrl+x enter` | `chat:queueSubmit` | – (no action at all) | **unrecorded** — §2.2 |
| `ctrl+j` | `chat:newline` | – (editor.ts) | as above |
| `up` | `history:previous` | – (composer) | as above |
| `down` | `history:next` | – (composer) | as above |
| `ctrl+_` | `chat:undo` | – (editor.ts, raw `\x1f`) | K39 ✅ — works, but **not rebindable** |
| `ctrl+-` | `chat:undo` | – (same byte) | K39 |
| `ctrl+shift+-` | `chat:undo` | – | K39 |
| `ctrl+shift+_` | `chat:undo` | – | K39 |
| `ctrl+x ctrl+e` | `chat:externalEditor` | = | |
| `ctrl+g` | `chat:externalEditor` | = | |
| `ctrl+s` | `chat:stash` | – (editor.ts) | "editor keys literal"; **not rebindable** |
| `ctrl+v` | `chat:imagePaste` | = | K35 ✅ |
| *(WSL only)* `alt+v` | `chat:imagePaste` | **+** bound unconditionally | `bindings.ts:71-74` |
| `space` | `voice:pushToTalk` | – | K34 🚫 |
| — | — | **+** `ctrl+x ctrl+g` → `chat:externalEditor` | `bindings.ts:67` (ccx-specific) |
| — | — | **+** `ctrl+d` → `app:exit` in `Chat` | `bindings.ts:68` |

### Autocomplete — canon 4 rows

| `tab` | `autocomplete:accept` | = | |
| `escape` | `autocomplete:dismiss` | = | |
| `up` | `autocomplete:previous` | – | `bindings.ts:79` ("stay in the composer fallback") |
| `down` | `autocomplete:next` | – | as above |

### Settings — canon 16 rows

10 same (`escape`, `up`, `down`, `k`, `j`, `ctrl+p`, `ctrl+n`, `space`, `enter`, `/`).
6 missing — `r`, `d`, `w`, `t`, `ctrl+u`, `ctrl+d` — all **K29 ❌** (explicit F2 non-goal).

**+ two extra, added by bl10 fix wave 8 (W8-1)**: `pageup` → `select:pageUp` and
`pagedown` → `select:pageDown` (`bindings.ts:405`). Canon binds neither in `Settings` — it has no
page keys in this context at all — so these are a ccx addition, not a transcription. Rationale is
in-source: the read-only Status/Usage/Stats tabs mount no inner `Select`, so nothing else could
answer a page key there. No `tui-ux.md` row.

Ours also adds 8 suppression `null`s. Behaviour gap beyond the table: §1.10 type-to-search.

### Confirmation — canon 10 rows (251) / 9 (257)

| `y` `n` `enter` `escape` `up` `down` | | = (6) | |
| `tab` | `confirm:nextField` | – | K16 ❌ (stale, §1.6) |
| `space` | `confirm:toggle` | – | K16 ❌ |
| `shift+tab` | `confirm:cycleMode` | = | K16 says ❌ — **stale**, shipped F6 T7 |
| `ctrl+e` | `confirm:toggleExplanation` *(251 only)* | = | K16 says ❌ — **stale**, shipped Wave T t7; **gone in 257** |
| — | — | **+** `ctrl+g` → `confirm:editExternal` | `bindings.ts:377` (canon reads it raw) |
| — | — | **+** `ctrl+d`/`alt+p`/`alt+t` nulls | |

### Tabs — canon 4 rows: all **=**.

### Transcript — canon 20 rows: **all 20 =**.

Ours adds: `pageup`→`scroll:pageUp`, `pagedown`→`scroll:pageDown` (canon binds neither here),
`wheelup`/`wheeldown`, `ctrl+o`→`transcript:exit`, and 6 suppression nulls. K30 ✅.

### HistorySearch — canon 6 rows: all **=**. Ours adds 7 nulls.

### Task — canon 2 rows

| `ctrl+x ctrl+b` | `task:background` | = | K31 ✅ |
| `ctrl+b` | `task:background` | ≠ — ours has it in `Global` | CTRL-B-1 (§1.4) |

### ThemePicker — canon 2 rows: both **–**. K32 ❌ (F2 non-goal); mechanism now exact (§3.4).

### Scroll — canon 14 rows

| `pageup` | `scroll:pageUp` | **≠** `scroll:halfPageUp` | FSW-T11 plan; **not in tui-ux.md** |
| `pagedown` | `scroll:pageDown` | **≠** `scroll:halfPageDown` | as above |
| `wheelup` `wheeldown` `ctrl+home` `ctrl+end` | | = (4) | K22 ✅ |
| `ctrl+shift+c` `cmd+c` → `selection:copy` | | = (2) | K22 ✅ |
| `shift+left/right/up/down/home/end` → `selection:extend*` | | = (6) | K22 ✅ |
| — | — | **+** `v` → `scroll:dumpTranscript` | FSW T12, "Recorded additions" |

### Help — canon 1 row: `escape` **=**. Ours adds `ctrl+c` → `app:interrupt` + 8 nulls (K36 ✅).

### Attachments — canon 6 rows: **all missing**. K24 🚫 (no attachment chips).

### Footer — canon 11 rows: **all missing**. K23 🚫 (no focusable footer).

### MessageSelector — canon 15 rows

| `up` `down` `k` `j` `ctrl+p` `ctrl+n` → `messageSelector:up/down` | – *from this context*; resolve one layer in at `Select` | K27 ✅ — equivalent, `bindings.ts:211-219` |
| `ctrl+up` `shift+up` `meta+up` `shift+k` → `messageSelector:top` | **≠** ours → `select:first` (and `alt+up` for `meta+up`) | F6 T10, in-source |
| `ctrl+down` `shift+down` `meta+down` `shift+j` → `messageSelector:bottom` | **≠** ours → `select:last` | F6 T10 |
| `enter` → `messageSelector:select` | – *from this context*; `Select` answers | K27 ✅ |
| — | **+** `escape` → `messageSelector:dismiss` (canon binds no escape here) | `bindings.ts:219-222` |

### DiffDialog — canon 18 rows: **all missing**. K21 🚫.

### ModelPicker — canon 3 rows: all **=**. K26 ✅.

### EffortSlider *(257 only)* — canon 1 row

| `s` | `effortSlider:thisSessionOnly` | **–**, and our context is named `EffortDialog` with a different set (`left`/`right`/`enter`/`escape` + nulls) | `bindings.ts:241-250` states "upstream has no context for it" — true on 251, **falsified by 257** (§2.9) |

### Select — canon 12 rows: **all 12 =**. K28 ✅. Ours adds 8 suppression nulls.

### Plugin — canon 3 rows: **all missing**. K25 🚫.

### Agents *(257 only)* — canon 2 rows: **all missing, no row anywhere** (§2.8).

### Contexts we have that canon does not

`SelectDecision`, `SessionPicker`, `EffortDialog` — all three documented at length in `bindings.ts`
with the "we route by context name where upstream routes by owner" rationale. `EffortDialog` should
probably become `EffortSlider` (§2.9).

### Canon contexts absent from our `VALID_CONTEXTS`

`ProactivityMenu` (§2.7), `EffortSlider`, `Agents` — the last two 257-only.

**Totals.** Canon 251: 21 contexts, 20 with defaults, ~190 default entries, 145 actions.
Ours: 23 valid context names, 17 with default blocks, 72 actions. `tui-ux.md:2071` K1's "20 contexts, 136
default entries" is close but stale.

---

## 8. Validation-message diff (§42.8 vs `userBindings.ts`)

We **do** validate, so this is a real row-by-row comparison. Ours is a different message vocabulary
throughout — no string matches canon's. That is a defensible choice (ours name the consequence:
"— binding ignored"), but it means a user who searches the web for a Claude Code keybindings error will
not find ours, and vice versa.

| Canon condition | Canon message / severity | Ours | Verdict |
|---|---|---|---|
| top level not an object with `bindings` | `keybindings.json must have a "bindings" array` (+ `Use format: { "bindings": [ ... ] }`) / error | `the top level must be an object with a "bindings" array — no user bindings applied` | ≠ wording; same outcome. **Also**: we accept a bare top-level array; canon does not. **Also**: an object with no `bindings` key is silent in ours, an error in canon |
| `bindings` not an array | `"bindings" must be an array` (+ `Set "bindings" to an array of keybinding blocks`) / error | `"bindings" must be an array of { context, bindings } blocks — no user bindings applied` | ≠ wording |
| a block fails the structural predicate | `keybindings.json contains invalid block structure` (+ `Each block must have "context" (string) and "bindings" (object mapping keys to a string action or null)`) / error, **and the entire user file is discarded** | `block N is not an object — block ignored`; only that block dropped | **≠ semantics** (§1.9) |
| `JSON.parse` throws | `Failed to parse keybindings.json: ${err}` / error | `not valid JSON: ${msg} — no user bindings applied` | ≠ wording, same outcome |
| validator handed a non-array | `keybindings.json must contain an array` (+ `Wrap your bindings in [ ]`) | n/a | – |
| block not an object | `Keybinding block ${i} is not an object` / error | same shape, `block ${i} is not an object — block ignored` | ≈ |
| `context` not a string | `Keybinding block ${i} missing "context" field` / error | folded into the unknown-context message | ≠ |
| unknown context | `Unknown context "${ctx}"` (+ `Valid contexts: <all 23>`) / error — **block retained** | `unknown context "X" (block N) — block ignored` — **block dropped** | ≠ semantics + no valid-list suggestion |
| `bindings` missing / not an object | `Keybinding block ${i} missing "bindings" field` / error | `${ctx}: "bindings" must be an object or an array of { key, action } — block ignored` | ≠; **ours also accepts an array-of-`{key,action}` form canon does not** |
| empty key part (`ctrl++`) | `Empty key part in "${key}"` (+ `Remove extra "+" characters`) / error | **none** — our `splitSpec` reads `ctrl++` as ctrl + the literal `+` key | **gap** |
| value neither string nor `null` | `Invalid action for "${key}": must be a string or null` / error | `${where}: an action must be a string or null, got X — binding ignored` | ≈ |
| `command:` fails the name regex | `Invalid command binding "${a}" for "${k}": command name may only contain alphanumeric characters, colons, hyphens, and underscores` / **warning, retained** | dropped with `is not a known action — binding ignored` | ≠ severity + outcome |
| `command:` outside `Chat` | `Command binding "${a}" must be in "Chat" context, not "${ctx}"` (+ `Move this binding to a block with "context": "Chat"`) / **warning, retained** | dropped | ≠ severity + outcome |
| unknown action | `Unknown action "${a}" for "${k}" in ${ctx} — this binding is ignored` + **three-tier suggester** / error | `${where}: "X" is not a known action — binding ignored` | ≈ wording; **no suggester** — §4.5 |
| `voice:pushToTalk` bound to a bare letter | `Binding "${k}" to voice:pushToTalk prints into the input during warmup; use space or a modifier combo like meta+k` / warning | n/a (no voice) | – |
| duplicate key in raw JSON text | `Duplicate key "${k}" in ${ctx} bindings` (+ `This key appears multiple times in the same context. JSON uses the last value, earlier values are ignored.`) / warning — a **regex pass over the file text**, because `JSON.parse` already collapsed the key | none — `JSON.parse` has eaten it by the time we look | **gap**; the raw-text trick is the only way to see it |
| duplicate normalised chord within one context | `Duplicate binding "${k}" in ${ctx} context` (+ `Previously bound to "${prev}". Only the last binding will be used.`) / warning; a repeated `null` also warns (the map stores the sentinel string `"null"`); **does not see the defaults** | `${ctx} "k" is bound twice in one block (canonically X) — the last one wins` | ≈ semantics (ours is per-block, canon per-context across blocks); ≠ wording |
| reserved key | `"${k}" may not work: ${reason}` / table severity — **retained** | `${where}: ${reason} — binding ignored` (error) or `— binding kept, but ccx handles that key before the keymap` (warning) | **≠ outcome for error severity** (§1.2); reasons are byte-identical for the 4 we carry, 3 missing (§4.1) |
| — | — | **+** `suspicious_key` (caps modifier / unknown key name), warning, keeps the binding | ours only, documented as a task-2 carry-forward |

Log-line shape: canon writes
`[keybindings] [${severity}] ${message}${suggestion ? " — " + suggestion : ""}` preceded by
`[keybindings] Found N validation issue(s)`. Ours writes transcript notices via `formatIssues`
(`⚠ ${file}: N problems`, capped at 5 with `…and N more`) — a deliberate divergence (a live Ink frame
has no console), recorded in-source.

---

## 9. Context precedence (§42.10) vs `resolver.ts`

**Ours** (`registry.ts:53-60` → `resolver.ts:resolveKey`): preemptive scopes first (newest-first),
then ordinary live scopes (newest-first), then `"Global"`, deduped. Within that array, first context
that binds the key at all wins; a `null` returns `unbound` and stops the search. Exact beats prefix
within a context; a higher context's single key beats a lower context's chord head, and a higher
context's chord head arms over a lower context's plain binding.

**Canon** has *two* matchers with different tie-breaks (§42.10.2):

- `n1e`, the **scope-chain** path: contexts are an ordered chain from the focused element up to the
  root, resolved **first-context-wins**. This is what ours mirrors, and it is the path that runs
  whenever a focused scope chain exists. ✅ **Our model matches this one.**
- `_fe`, the **legacy** path: the context list `[...handlerContexts, ...activeContexts, "Global"]` is
  treated as an **unordered set**, and ties are broken by **position in the flattened binding list** —
  last match wins, i.e. later default-table blocks beat earlier ones and user blocks beat defaults.
  Canon falls back to this path when the focused scope chain is empty and there are no preemptive
  scopes, and also as the tail of several scope-chain outcomes (§42.10.4's decision tree).

**Implication.** Where a key is bound in two contexts that are both active but neither is on the
focused element's scope chain, canon resolves it by *table order* and we resolve it by *scope order*.
In practice our scopes are always explicit, so the divergence is narrow — but it is why canon's
default table can afford `ctrl+d → app:exit` in `Global` and `ctrl+d → scroll:halfPageDown` in
`Settings`/`Transcript` with no `null`s anywhere, while ours needs an explicit suppression block in
eight contexts. Worth stating in K2 alongside §1.1.

Three canon mechanisms in the dispatch tree that we do not have, all minor and none currently biting:

- **`singleKey: false` handlers** — registered handlers that fire *only* on chord completion, never on
  a single key. Canon uses this to keep `enter` in the editor (§42.10.4, §42.20).
- **A handler may decline by returning `false`,** and the single-key scan continues to the next
  registered handler. Ours takes the innermost handler and stops (`registry.ts` `handlerFor`).
- **Pre-dispatch handlers** (`jce`) run before the registry pass and can claim a key by returning
  `true`; canon is careful that they see each key exactly once across the two paths. Our nearest
  equivalents are the pre-table hooks (Ctrl-Z suspend, selection lifetime), which are hard-wired
  rather than a registry.

`swallowAll` (canon) vs our `swallowContexts` (`registry.ts:68-73`) match in intent; canon's eats
*every* key when non-empty, ours narrows resolution to the innermost live scope's own context — which
is why `Help` has to spell out `ctrl+c` (`bindings.ts:102`, and the comment there explains it).

---

## 10. Re-verification against `somersault` (post-bl10)

The report was first written against `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`, a frozen
checkout predating bl10. Everything below was re-checked against
`/Users/new/Developer/GitHub/somersault/CC-to-SDK` (HEAD `e337ea7`). **All bundle citations were
already from the real bundles and are untouched.**

### What actually differs between the two trees, in this lane

`diff -rq harness/src/tui` returns 22 differing files plus 3 new ones. Only four matter here:

- **`keys/bindings.ts`** — exactly one hunk: `Settings` gains
  `"pageup": "select:pageUp", "pagedown": "select:pageDown"` (bl10 fix wave 8, W8-1), at line 405.
  Everything above line 400 is byte-identical, so **every §7 row and every `bindings.ts` cite at or
  below :400 is unchanged**. Two cites below the hunk shifted by +5 and were fixed in place
  (`:440`→`:445` `selection:clear`; `:451`→`:456` `RESERVED_KEYS`).
- **`SettingsDialog.tsx`** — rewritten onto `DialogFrame` + the auto keyhint bar; the two hand-written
  footer literals deleted. The §1.10 finding is **unchanged**: browsing-mode fallback is still
  `useKeyFallback(route(() => {}))`, now at line 575, and only `/` opens search. Cite fixed.
- **`ChatComposer.tsx`** — differs, but **not in this lane**. The left-arrow block is byte-identical:
  the "not transcribable" comment is still at :93, `LEFT_AGENTS_TEXT = "Press ← again"` at :100, the
  gesture predicate at :911. §3.2 and §4.2 stand as written.
- **`useChat.ts`** — differs only by `/mcp` dialog plumbing (`mcpDialog` state, `openMcpDialog`,
  `fetchMcpServers`). No keybinding change; the kill-agents literal chord noted in §5 is still a
  literal at `useChat.ts:3566`.

Unchanged and therefore requiring no re-check: `keys/resolver.ts`, `keys/registry.ts`,
`keys/KeymapProvider.tsx`, `keys/normalize.ts`, `keys/parse.ts`, `keys/types.ts`,
`keys/userBindings.ts`, `keys/hints.ts`, `editor.ts` — all byte-identical across the two checkouts.

### New in bl10, checked for §7 impact

- **No new key context.** `types.ts` is byte-identical, so `KeyContextName` is the same 23 names.
  `McpDialog.tsx` mounts the existing `Select` context and passes `hintScope={["Select"]}` to
  `DialogFrame`; it registers no scope of its own. **The §7 context inventory is unchanged** and no
  canon context moved from missing to present.
- **`dialogs/keyhints.ts`** — new, and it changes two of my findings (see below).
- **`mcpDialogModel.ts`** — pure model, no keys.

### Per-item verdict

| Item | Verdict |
|---|---|
| §0.1–§0.7 top takeaways | **unchanged** (line cites in the bodies corrected; no verdict moved) |
| §1.1 `unbound` consumes | **unchanged** — `KeymapProvider.tsx:300` byte-identical; K2 text identical, now `tui-ux.md:2072` |
| §1.2 reserved advisory vs fatal | **unchanged** — `userBindings.ts` byte-identical |
| §1.3 `Scroll` paging keys | **unchanged** — `bindings.ts:182` byte-identical; plan cite `:298` still correct |
| §1.4 `ctrl+b` in `Global` | **unchanged** |
| §1.5 K21 `DiffPanel` claim false | **unchanged** — K21 text identical, now `:2091` |
| §1.6 K16 stale | **unchanged** — K16 text identical, now `:2086`; `shift+tab`/`ctrl+e` still bound at `:368`/`:383` |
| §1.7 `MessageSelector` action names | **unchanged** — block byte-identical |
| §1.8 action/context vocabulary subset | **unchanged** — `VALID_ACTIONS` still 72 in 17 namespaces (no bl10 additions) |
| §1.9 structural failure granularity | **unchanged** |
| §1.10 `Settings` type-to-search | **unchanged finding, cite corrected** (`:465` → `:575`); bl10 rewrote the dialog but not this behaviour |
| §2.1–§2.13 unknown unknowns | **all unchanged**; §2.3's `app:*` list and §2.5's display contract re-checked against the identical `resolver.ts`/`hints.ts` |
| §3.1 missing reserved keys | **unchanged** — `RESERVED_KEYS` byte-identical, now at `:456` |
| §3.2 left-arrow guard | **unchanged** — `ChatComposer.tsx` block byte-identical |
| §3.3 K29 `Settings` six keys | **unchanged** — K29 text identical, now `:2099`; the six are still unbound (bl10 added page keys, not these) |
| §3.4 K32 `ThemePicker` | **unchanged** |
| §3.5 K8 platform branching | **unchanged** |
| §3.6 vim | **unchanged** — CM60/vim rows identical, line cites corrected |
| §3.7 hint derivation | **CORRECTED and expanded** — bl10's auto keyhint bar is the largest addition to hint derivation since F4, and `tui-ux.md:2167` does not mention it. Rewritten. |
| §4.1 reserved-key strings | **unchanged** (target line corrected) |
| §4.2 left-arrow hints | **unchanged** |
| §4.3 action → hint text | **WITHDRAWN as an unheld asset** — bl10 shipped it verbatim in `dialogs/keyhints.ts` from canon `Ye`. Rewritten as a present/absent/extra breakdown, with a newly found spec defect: §42.5 omits `confirm:toggleExplanation` → `explanation`, which 251's `Ye` carries (verified `2.1.251/cli.pretty.js:568825`). |
| §4.4–§4.7 | **unchanged** |
| §5 confirmations | **unchanged**, plus one addition: bl10's `MAX_HINTS = 4` matches canon `Pe = 4` (`2.1.251/cli.pretty.js:568834`, verified), and the dedup-by-description rule matches canon's |
| §6 spec defects | **unchanged**, plus the §4.3 one above (now 5 total) |
| §7 binding-table diff | **one row group corrected**: `Settings` was "canon 17 rows" (arithmetic slip — canon has 16) and now carries the two bl10 extras. Every other context's rows re-checked against the byte-identical table. |
| §8 validation diff | **unchanged** — `userBindings.ts` byte-identical |
| §9 precedence | **unchanged** — `resolver.ts`/`registry.ts` byte-identical |

**Net**: 0 withdrawn findings, 3 corrected (§3.7, §4.3, §7 `Settings`), 1 spec defect added, 12 line
cites fixed in place. No finding's verdict flipped, and bl10 introduced no canon-table binding beyond
the two `Settings` page keys, which are a ccx addition rather than a transcription.
