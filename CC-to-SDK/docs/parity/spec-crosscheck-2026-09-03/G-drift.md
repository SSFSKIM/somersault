# G — Version drift: what re-baselining canon off 2.1.251 costs and buys

Lane: version drift, not a chapter. Read: `A5-cross-version-notes.md` §A5.10 (hop 4, 241→251),
§A5.11 (hop 5, 251→257, exhaustive), §A5.12 (citation drift); the local bundles
`2.1.220 / 2.1.234 / 2.1.236 / 2.1.241 / 2.1.251 / 2.1.257 / 2.1.258 / 2.1.263`; and
`/Users/new/.claude/jobs/4b30d1a4/tmp/spec263-notes/` for the 258→263 window.

**Every claim tagged *verified* was re-run against the bundles by me in this session.** Claims tagged
*spec-only* come from A5 and were not independently checked. Our-side `file:line` came from three
repo sweeps and I spot-checked the load-bearing ones.

Two setup facts:

- **The re-baseline is executable today.** `2.1.257` *and* `2.1.263` are already on disk with
  `tools/where.py`. Nothing needs fetching. The installed CLI is 2.1.263.
- **All our-side cites below were re-verified against `/Users/new/Developer/GitHub/somersault/CC-to-SDK`
  at HEAD `e337ea7` (post-bl10).** An earlier pass read a frozen sibling checkout; §7 records the
  reconciliation. `docs/parity/tui-ux.md` is 2,528 lines there, as the brief states.

---

## 0. Top takeaways

1. **The biggest 251→257 item is a *deletion we already built*.** Canon removed the Ctrl+E
   command-explainer from Bash/PowerShell permission prompts; we shipped it as a whole wave (W-T13:
   two modules, a keybinding, a footer verb, three test files, probe 98). Re-baselining *raises*
   three scorecard rows and cancels a live debt item. §3.1.
2. **A 257 re-baseline renames one of our keybinding contexts.** Canon gave the effort slider a
   context in 2.1.257 and named it `EffortSlider` with `s` → `effortSlider:thisSessionOnly` — the
   exact surface our `bindings.ts` says "upstream has NO context for it, so ccx has to give it one"
   and named `EffortDialog`. Context names are user-facing (`keybindings.json`). §1.2.
3. **The spec's keybinding-context count is wrong and the real number keeps moving.** §A5.11.18 says
   20→22; verified counts are **21 → 23 → 26** (251/257/263). 2.1.263 adds three contexts for an
   entirely new, unannounced interactive **plugin panel above the prompt** (`ctrl+x ctrl+a`) that no
   changelog bullet and no spec chapter mentions. §1b.1, §6.1.
4. **First-party release notes for 2.1.253–2.1.260 exist on this machine and the spec says they
   don't.** `2.1.263/cli.pretty.js:50526` carries the compiled changelog for 2.1.228–2.1.260,
   including 2.1.257's own **105-bullet** entry. §A5.11.15 states first-party notes exist for exactly
   one of the six releases in the hop. That single asset re-grounds this whole lane. §4.1, §6.2.
5. **`/config` gains exactly one row at 257 (`Time format`) and one at 263** — and our
   `settingsRows.ts` already builds the two rows either side of it. Cheapest fidelity win in the hop.
   §1.1.
6. **The single highest-information action isn't a re-baseline at all**: re-run
   `probes/probes/84-bash-stdout-background.ts` against the bumped SDK. Three 🚫 rows
   (`tui-ux.md:1404`, `:1405`, `:1425`) all rest on one probe finding that a running Bash's stdout
   never reaches a headless client. If a 0.3.26x SDK emits `tool_progress`, all three become
   buildable at once — a bigger swing than any row flip below. §1b.6.
7. **Our own citations are the least durable thing in the repo.** 2,556 bare `L<line>` references
   across all 154 TUI source files, only 37 of them within 80 characters of a version string; the
   bundle a citation names is carried by *file-header prose in tui-ux.md*, per wave. §A5.12's warning
   applies to us harder than to the spec, which at least names a chunk. §1.14.

---

## 1. Canon moved 251→257 — TUI-visible

Ranked. "Flips?" = would a re-baseline of canon from 251 to 257 change a `tui-ux.md` row's score or
its evidence.

| # | Change | Our row | Flips? |
|---|---|---|---|
| 1.1 | `/config` gains a `Time format` row; `timeFormat`/`timeZone` settings | none (`:2308`, `:2338` say 5 of ~54 Config rows ship — actually 10) | new ❌ row |
| 1.2 | `/effort` gains `s` = session-only; the dialog gains a keybinding **context** named `EffortSlider` | `:2320` 🟡, `:2336` 🟡, `:2018` ✅ | **yes — renames our context** |
| 1.3 | **Ctrl+E explainer removed** from Bash/PowerShell permission prompts | `:306` 🟡, `:271` ❌, `:2086` ❌ | **yes — three rows improve** |
| 1.4 | New auto-mode dialog body: first read outside the working dirs | none | new ❌ row |
| 1.5 | `Agents` keybinding context (`ctrl+s`/`ctrl+t` rebindable) | `:2084` ✅, `:2018` ✅ | yes |
| 1.6 | Model-written status-line **narration** generator | none; D11 "recorded, not built" | evidence-only |
| 1.7 | `/add-dir <subdir>` now LOADS that dir's skills/commands/agents (8 outcomes) | `:2311` ✅, `:2337` ✅ | **yes — two ✅ rows invert** |
| 1.8 | `--add-dir`/`additionalDirectories` refuse network paths | none | new ❌ row |
| 1.9 | Spinner no longer stops behind a slash-command panel | none | yes (classic arm only) |
| 1.10 | Edit-permission diff renders emoji/multi-code-point widths correctly | `:2237` ✅ | yes |
| 1.11 | Queued-under-a-dialog ask notifies at the same delay as a visible ask | `:2284` 🟡 | evidence-only |
| 1.12 | Async hook completion notices coalesce to one line | none | new row |
| 1.13 | `/model` picker: gateway `description`, `Update Claude Code to use this model` | `:2302` 🟡, `:1794` | yes (missing-arm list grows) |
| 1.14 | *(meta)* citation drift — our bare `L<n>` references | file header `:6-13` | see below |

### 1.1 `Time format` — the one `/config` row canon added *(verified)*

Canon's Display group, in source order right before the new row
[`2.1.257/cli.pretty.js` around `id: "timeFormat"`; chunk cite `chunk-wftr5q3n.js:777170`]:
`verbose` → `progressBar` "Terminal progress bar" → `showStatusInTerminalTab` (gated
`tengu_terminal_sidebar`) → `turnDuration` "Show turn duration" → `precomputeCompactionEnabled`
(gated `tengu_sepia_moth`) → `timestamps` "Show message timestamps" (gated `tengu_silk_hinge`) →
**`{ id: "timeFormat", label: "Time format", options: [...lge], type: "enum", pickToCommit: !0 }`**,
with `lge = ["auto", "12-hour", "24-hour", "24-hour-utc"]`. **Ungated.** `timeZone` has **no
`/config` row** — it is settings-file-only, which is why its describe text ends "set here".

Verified counts: `timeFormat` 0 / 7 / 8 and `timeZone` 9 / 26 / 28 across 251/257/263.

Our side: `harness/src/tui/settingsRows.ts:57-67` builds 10 rows and already carries
`Show turn duration` and `Terminal progress bar` — canon's own labels, character for character — so
the new row slots into an existing, already-faithful list. The row id union at `settingsRows.ts:15`
is closed and has no time entry. We have four hardcoded clock sites that would have to route through
a resolver: `harness/src/tui/replay.ts:33` (`hhmm`, a raw ISO `slice(11,16)` — effectively hardcoded
24-hour UTC with no marker), `harness/src/tui/usageFormat.ts:10` (same slice `+ "Z"`),
`harness/src/tui/sessionTools.ts:94` (`toLocaleString()`). Turn end prints a **duration**, not a
clock (`durationRow.ts:47`), so canon's "turn-end clock" has no ccx consumer yet.

Also fix the two rows that state the row count: `:2308` and `:2338` both say "only 5 of upstream's
~54 Config rows ship"; it is 10.

### 1.2 `/effort` `s`, and the context rename *(verified)*

2.1.251 has `modelPicker:thisSessionOnly` [`2.1.251/cli.pretty.js:583992`] and no effort context.
2.1.257 adds `context: "EffortSlider", bindings: { s: "effortSlider:thisSessionOnly" }`
[`chunk-1kg58a1a.js:112105`] plus `persistAsDefault` plumbing so Enter saves as default
[`chunk-cagbxy4k.js:441423`, `:441441`].

Our `harness/src/tui/keys/bindings.ts:251-257` binds four keys in a context we named **`EffortDialog`**,
with a header comment reading *"Upstream has no context for it: `L447278` reads left/right/return/escape
raw off its own container … so ccx — which routes every key through a named context — has to give it one."*
That was true of 2.1.220–2.1.251 and is **false at 2.1.257**: upstream gave it a context, and chose a
different name. Since the name is what a user types in `~/.claude/keybindings.json`
(`keys/userBindings.ts:61`), this is a user-visible divergence, not an internal one.

Also: our footer literal proves the missing key — `harness/src/tui/modelPickerModel.ts:166`
`"←/→ to adjust · Enter to confirm · Esc to cancel"` — and Enter writes a **single flat global**
`prefs.effort` (`useChat.ts:2832` (`applyEffort`), `:2845`), where 2.1.251's own changelog already said
`/effort` saves per model. So we are behind on *two* generations here, not one.

### 1.3 Ctrl+E explainer — see §3.1 (it is a withdrawal, and it is the headline)

### 1.4 The auto-mode outside-read prompt — a body block, not a new dialog *(verified verbatim)*

Structurally important and easy to get wrong: this is **not** a new dialog. It renders as an extra
dim child block *inside the existing permission-dialog shell* (`Ei` title/subtitle), at `paddingX: 1,
marginBottom: 1`, between the diff/preview region and the option `Select`
[`chunk-bq8epagv.js:422730`, read in full]. The body is three literal fragments joined by two `" "`
children — fragment 1 always, fragment 2 a ternary on `oft()`, fragment 3 always — so there are
exactly two rendered bodies. A5 §A5.11.9 is accurate here.

The option labels are the long forms only when the block is showing; the code is a ternary
[`chunk-bq8epagv.js:422376`]: `Re ? "Yes, keep allowing reads outside the working directories" : "Yes"`
and `Re ? "No, ask again next time" : "No"`, with the third label
`"No, block reads outside the working directories from now on"` [`:422382`].

Our side: nothing. Zero hits for `blockReadsOutsideWorkingDirectories`, "outside the working
director", "keep allowing". **Beware a same-named decoy** — `harness/src/tui/autoModeNotice.ts:29`
is an auto-mode *entry* notice (a transcript line on mode entry, scored `tui-ux.md:1898`), a
different feature. Our dialog shell (`dialogs/DialogFrame.tsx`, the bl10 spacing work) is the right
seam; `dialogs/rowBudget.tsx` already measures painted rows, which this three-fragment block needs.

### 1.5 `Agents` context *(verified)*

`context: "Agents", bindings: { "ctrl+s": "agents:switchView", "ctrl+t": "agents:togglePin" }`
[`chunk-1kg58a1a.js:112105`]; actions `agents:cloud`, `agents:local`, `agents:switchView`,
`agents:togglePin`. We have the agents view (`tui-ux.md:2084` ✅, `harness/src/cli/agents.ts`) but no
context, so those keys are not rebindable in ccx.

### 1.6 Narration *(verified: the gate pre-existed, the generator did not)*

`CLAUDE_CODE_ENABLE_NARRATION` has **2 occurrences in 2.1.251 and 2 in 2.1.257** — the env gate is
not new. What is new is the model-written generator prompt at [`chunk-bq8epagv.js:396810`],
0 occurrences in 251. A5 §A5.11.17 flags it as the one item no chapter carries; it belongs to
ch. 41's status-line display priority ("narration, then `Next: <task subject>`, then `<label>: <tip>`").

Our side already has the slot: `harness/src/tui/spinner.ts:338` implements canon-251's four-rung
ladder verbatim, and `spinner.ts:320` documents `overrideMessage` as *"nothing sets one yet, and the
rung stays so something can"* — that is exactly the narration rung. No `Next:` prefix anywhere.
Recorded as **D11 "recorded, not built"** in `2026-08-30-bl7-hookblock-advisor-design.md:234`. The
257 spec supplies the generator prompt verbatim, so D11's premise ("never observed on ccx's wire")
can now be re-decided on evidence rather than absence.

### 1.7 `/add-dir` on a subdirectory — two ✅ rows invert

`tui-ux.md:2337`'s ✅ text is the exact inverse of 257's behaviour: *"rejects inside-cwd paths as
already accessible … `register_repo_root`, probe 75's other engine door, is reachable but never used
by this command (its only usable domain is exactly what /add-dir rejects)"*. Code:
`harness/src/tui/addDir.ts:53` returns `subdirOfCwd` → hard refusal at `:76`.

257 turns that dead door into the feature, with **8** outcomes (2 silent, 4 refusals, 2 successes)
[A5 §A5.11.3's table, `chunk-00yr8fkg.js:737-756`]. We currently emit **12** messages across
`formatAddDirVerdict` (`addDir.ts:61`) and `formatAddDirResult` (`addDir.ts:105`) — a different set.
This is the cheapest large win in the hop precisely because probe 75 already proved the engine door.
Note 2.1.261 then *fixed* this feature for `/net` automounts (§1b.9).

### 1.8 Network-path refusal

Ours: `harness/src/tui/addDir.ts:44` `validateAddDir()` has no network arm — `/net/<host>/share`
passes `existsSync` and lands as `ok`. There is **no `--add-dir` CLI flag at all**
(`harness/src/cli/args.ts`); ingress is `/add-dir`, `config.additionalDirectories`
(`config/resolveOptions.ts:116`, unvalidated) and `appserver/settingsOps.ts:177`. The only UNC guard
in the repo is Windows-gated and belongs to sed-edit preview (`dialogs/sedEdit.ts:150`) — and
`tui-ux.md:1796` records that whole family as *"dead on every platform this harness runs on"*.

### 1.9 Spinner behind a slash-command panel

Canon-251 stopped the spinner while a panel was up; 257 fixed it. Our classic renderer has the same
shape *by decision*: `harness/src/tui/ChatApp.tsx:1984` gates the spinner slot on `!paneOwned`
(defined `:1387-1390`, covering `/model`, `/help`, `/config`, `/permissions`, `/resume`, rewind, the
transcript pager), and `ChatApp.tsx:1656` records the trade explicitly. **Our fullscreen renderer
already does the 257 thing**; only the classic arm needs changing, and the reason for the trade (dock
row budget, `ChatApp.tsx:1255-1260`) is written down.

### 1.10 Diff emoji / grapheme widths

`harness/src/tui/diffRender.ts:152` `wrapSegments` — shared by the transcript diff *and* the
permission dialog (`dialogs/FilePermission.tsx:111`) — normalizes then re-slices by **UTF-16
`.length`** (`:153-163`, `sliceSegments` `:108-113`); band fill measures content with `stringWidth`
but the number cell with `cell.length` (`:248`, `:277`). `harness/src/tui/graphemes.ts:16`
`snapToGraphemes` exists but `diffRender.ts` does not import it (only `suggestPopup.tsx` and
`mouse/hitmap.ts` do). Zero emoji coverage in `harness/test/tui/diffRender.test.ts`.

### 1.11–1.13 (briefly)

- **Queued-ask notification.** `harness/src/tui/useChat.ts:2182` fires `notify("permission_prompt")`
  synchronously for head *and* queued asks — 257-correct by accident, because we have **no delay
  mechanism at all** for 257 to match. The elicitation half is silent: `useChat.ts:2179-2181` runs one
  FIFO of four kinds and only `kind === "permission"` notifies. Row `:2284` 🟡.
- **Async hook notices.** `harness/src/tui/toolFold.ts:975` `weaveStandaloneHooks` already coalesces
  same-label same-position hooks; `toolRenderer.tsx:1229` still paints one line per hook in the
  non-compact projection. We model no async hook species (`hookPairs.ts:5-7`; `hook_progress` is a
  documented no-op at `:70`).
- **`/model` labels.** `description` renders (`ModelPicker.tsx:33`, `:241`); `"From gateway"` and
  `"Update Claude Code to use this model"` are **zero hits repo-wide**. Note `tui-ux.md:1794` already
  records the adjacent divergence (no synthetic "Current model" row, canon `zAe` L440960-968) — same
  code region 257 extends.

### 1.14 Citation drift, applied to us *(verified — the structural finding)*

§A5.12's rule is that neither half of a `chunk-name.js:LINE` citation survives a version change, and
that the durable anchor is the quoted literal. Measured on our side:

- **2,581** bare `L[0-9]{5,6}` references across **159 of the 197** files under `harness/src/tui/`, plus **295**
  in `tui-ux.md`. Only **36** of the source ones sit within 80 characters of any `2.1.2xx` string.
- Which bundle a citation names is carried by *prose in `tui-ux.md`'s header* (`:6-13`: 2.1.220 by
  default, 2.1.234 for fullscreen, 2.1.236 for F8 spinner/startup/terminal), per wave — not per
  citation.
- Spot-check, run this session: `L490015` → exact match in **2.1.220** (`Z.CLAUDE_CODE_ENABLE_MENU_KIND_LANES
  || Ke("tengu_mint_lanes", !1)`) ✅. `L558744` → `function Lgi(e) {` in 2.1.220, `LB();` in 2.1.234,
  and `function m6h({ enabled, isLoading, hasToolsInProgress })` only in **2.1.236** — the citation is
  right, but only if you know it means 236. `L419592` → a bare backtick in 2.1.220; the symbol it
  names, `i2p`, is at **2.1.220:419590** (a ±2 offset, fine) — but `i2p` in 2.1.234/236/241 is three
  *different* symbols (a `require("path")`, a module wrapper, a no-op). **Minified symbol names are no
  more stable than line numbers.**

Recommendation, cheap and mechanical: at re-baseline, do not rewrite the 2,556 citations (the file's
own no-back-edit policy at `:11-13` is right). Instead adopt A5.12's convention going forward —
**quote the literal next to the number** — and add a one-line per-file or per-wave bundle marker so a
reader can resolve a citation without the header prose. `tools/where.py` in the 257/263 bundles makes
literal→citation resolution a one-command operation.

**Version citations older than 2.1.251 in `tui-ux.md`: 66 occurrences across 54 lines** —
2.1.220 ×39, 2.1.236 ×11, 2.1.226 ×8, 2.1.237 ×2, 2.1.250 ×2, and one each of 2.1.246 / 2.1.234 /
2.1.227 / 2.1.222. Under the no-back-edit policy most need no touching. The ones that would actually
mislead a 257 reader are the **four divergence-table preambles** at `:1413` (F3), `:1498` (F4),
`:1606` (F5), `:1747` (F6) — each asserts a global claim about "what upstream does" against a bundle
now 37 releases stale — and the **header block** `:6-13`, which needs a new anchor paragraph rather
than an edit.

---

## 1b. Canon moved 257→263 — TUI-visible

Source: `spec263-notes/changelog-{map-,}2.1.258-2.1.263.md`, plus the compiled notes I extracted from
2.1.263 (§4.1). Chapters requested: 41, 42, 28, 24, 06, 13, 16, 20, 35.

### 1b.1 (ch. 42) **A new interactive plugin panel above the prompt — unannounced** *(verified)*

Not in any changelog bullet, not in the chapter map, not in any spec chapter. `abovePrompt` has
**0 occurrences in 2.1.251, 2.1.257 and 2.1.258; 10 in 2.1.263.** It brings:

- Three keybinding contexts — `AbovePrompt`, `AbovePromptInput`, `AbovePromptSelect`
  [`2.1.263/cli.pretty.js:542409`, `:542413`], each with its own binding table (tab/arrows/enter/
  space/escape; the Select variant remaps up/down to `highlightPrevious`/`highlightNext`).
- Eight actions with user-facing descriptions [`2.1.263/cli.pretty.js:204815`]:
  `abovePrompt:toggle` "hide/show plugin panel", `:focus` "focus plugin buttons, inputs and selects",
  `:next`/`:previous` "navigate", `:press` "press / submit / pick", `:leave` "back to prompt",
  `:highlightNext`/`:highlightPrevious`.
- A chord: `Zr("abovePrompt:toggle", "Chat", "ctrl+x ctrl+a")` [`:513403`].
- Help-grid context string: `abovePrompt: "Chat, AbovePrompt, AbovePromptInput or AbovePromptSelect"`
  [`:278411`].

This is the terminal surface for the `$.ui.ask`/`toast`/`notice` plugin scripting API that arrived at
2.1.251 (A5 §A5.10) — `$.ui.` goes 18 → 18 → 20 across 251/257/263. **Flips:** nothing today (we have
no plugin UI surface), but it is a whole new interactive region a TUI clone would have to answer for,
and it is the largest single unannounced addition in the 257→263 window.

### 1b.2 (ch. 42) Word-editing keys changed to match Bash — **reverses a Wave-C correction**

263: *"Ctrl+W deletes back to whitespace, Alt+F and Alt+D stop at word end, punctuation separates
words; `keybindingFlavor` no longer has any effect."*

- **Ctrl+W: we already match.** `harness/src/tui/editor.ts:263` `killWordBack` walks whitespace only
  (`:278`), and `editor.ts:316-317` says so.
- **Alt+F / Alt+D / Alt+B: two independent flips.** (i) Our forward motion lands at the **start of
  the next word** (`editor.ts:332`, `:338`) — and `tui-ux.md:2004` records that as a *deliberate Wave-C
  correction toward canon*, so 263 reverses the change that row celebrates. (ii) Punctuation does not
  separate words for us on any of the three keys; `editor.ts:315-317` names this a knowing
  approximation of 2.1.251's `isWordLike` classifier. At 263 the approximation becomes wrong.
  **Flips `tui-ux.md:2004` ✅ and `:2024` 🟡.**
- **`keybindingFlavor`: we are already 263-correct** by never having implemented it. Verified:
  the count falls 4 → 4 → 3 across 251/257/263, consistent with one consumer removed; the presets
  `["classic", "readline"]` sit at [`2.1.257/chunk-6w76tc7y.js:296741`]. Our only hit is a settings-key
  allowlist name (`appserver/configDomain.ts:190`).

### 1b.3 (ch. 42/41) `ctrl+l` / `cmd+k` clear the transcript in fullscreen *(verified)*

`clearTranscript` goes **0 / 0 / 4** across 251/257/263; the binding table entry is unchanged
(`"ctrl+l": "chat:clearInput"` in both), so 263 branches inside the handler on fullscreen.
Ours: `tui-ux.md:2005` ✅ rests on two 2.1.220 facts 263 invalidates — that `ctrl+l` is clear-input,
and that *"real CC's `cmd+k` never reaches a terminal app (intentional divergence, recorded)"*.
**Flips.** Cheap: `harness/src/tui/clearViewport.ts:64-74` already implements the alt-screen arm
(`ESC[2J ESC[3J ESC[H`), wired only to `/clear` (`useChat.ts:989`).

### 1b.4 (ch. 20) **Terminal progress indicator now respects background work** *(verified)*

The cleanest hit in the whole sweep, because our row already names the defect in canon's own
vocabulary. 2.1.261: *"Fixed the terminal progress indicator (iTerm2, Ghostty, ConEmu) showing the
session as finished while a background workflow or agent was still running."*

Verified in the bundle: `hasToolsInProgress` goes **2 → 2 → 4**, and 2.1.263's driver gains a fourth
parameter — `function lhe({ enabled: w, isLoading: I, hasToolsInProgress: ne, hasPendingBackgroundWork: me })`
[`2.1.263/cli.pretty.js:489700`] — with a new call site reading
`hasToolsInProgress: kd.focused.inProgressToolUseIDs.size > 0` [`:491104`]. 2.1.236's `m6h` (the one
we transcribed) had three parameters.

`tui-ux.md:2286` 🟡 already records: *"ccx tracks no in-flight-tool set the way canon's
`hasToolsInProgress` does, so the driver's `active` signal is `state.busy` alone — an honest omission,
not an invented second source."* Code: `harness/src/tui/progressBar.ts:57`, `:75`, `ChatApp.tsx:473`.
**Flips**, and the missing input already exists (`BgTasksPanel.tsx`, `taskPanelModel.ts`,
`bgTaskMeta.ts`) — a wiring job, not a discovery job.

### 1b.5 (ch. 41) Grapheme integrity at the wrap boundary and in the last two columns

2.1.260: *"Fixed flags, joined emoji and accented letters splitting across wrapped lines, and stale
text staying on screen when a flag or joined emoji falls in the terminal's last two columns (now
shown as `…`)."*

Ours: wrapping is **stock `wrap-ansi` with `hard: true`** — `harness/src/tui/wrapItems.ts:59`, and the
same call at `streamingItems.ts`, `render.ts`, `species.ts`, `dialogs/rowBudget.ts:22`,
`diffRender.ts:104`. `hard: true` breaks by code-unit position, so a ZWJ sequence straddling the break
column splits exactly as 263 fixes. `graphemes.ts:16` `snapToGraphemes` exists but its own header
names only two consumers (`suggestPopup.tsx`, `mouse/hitmap.ts`) — not the wrapper. Zero hits for a
last-two-columns rule. **New ❌ row**, not a flip.

### 1b.6 (ch. 16) The live-output preview — **re-probe this before anything else**

2.1.259: *"Fixed the live output preview of a running shell command hiding its newest lines when an
earlier line wrapped."*

We cannot have this bug because `tui-ux.md:1404` scores the whole feature **🚫**: *"The wire is
**silent** for a foreground Bash's whole runtime … No stdout, no `tool_progress`. There is nothing to
render"* — on probe 84. Companions `:1405` and `:1425` rest on the same finding.
`harness/src/tui/toolRenderer.tsx:339` returns an empty body for `status === "running"`.

**This is the highest-leverage item in the report.** The 🚫 is a *probe result against an older SDK*,
not a structural limit. If a 0.3.26x SDK emits `tool_progress`, three 🚫 rows become buildable at once.
Cost: one probe re-run.

### 1b.7 (ch. 28) `/diff` — the panel already existed at 2.1.251 *(verified, and it changes the read)*

2.1.260 says *"Added a diff panel that opens beside the conversation in fullscreen mode."* But
`name: "diff"` is present in 251/257/263, `app:toggleDiffNoiseFilter` / `app:diffFileListUp` /
`app:diffFileListDown` / `app:toggleDiffPreSession` / `app:cycleDiffBase` are all in **2.1.251**'s
action list, and 251 already carries `DIFF_SIDEBAR_MIN_COLS`, `"Resize your terminal to at least
${bQ} columns to show the diff panel"` [`2.1.251/cli.pretty.js:391989`], `bQ = 110` [`:624746`], and
the gated description `nM() ? "Toggle the diff panel showing uncommitted changes" : "View uncommitted
changes and per-turn diffs"` [`:502763`].

**Generalizable finding: upstream's "Added X" bullets frequently mean "ungated X".** Verified for
`/reload-plugins` (30 hits in 2.1.251), `/skill-doctor` (**11 hits in 2.1.251**, "Added" at 2.1.261),
and the diff panel. Practical consequence for this program: **several 258–263 features can be built
from the 2.1.251 bundle we already read** — the strings, the constants and the keybindings are there.
Genuinely new by contrast: `blockReadsOutsideWorkingDirectories`, `bashOutputMaxChars`/
`taskOutputMaxChars`, `--append-subagent-system-prompt-file`, `abovePrompt`.

Ours: `tui-ux.md:2345` 🟡 — *"terminal stand-in (`git status --short; git diff --stat`)"*, dispatch at
`useChat.ts:2424`. Rich diff rendering exists and is ✅ (`:2237`) but is unreachable from `/diff`.
`FullscreenFrame` has no horizontal split. **The 🟡's gap grows.**

### 1b.8 (ch. 28) Other command-surface moves

| Change | Ours | Verdict |
|---|---|---|
| `/skill-doctor` (261) | one hit, in the verbatim `ZLb` name table at `commandComplete.ts:63`; no dispatch | new ❌; buildable (`context/server.ts:19` has the data) |
| `/reload-plugins` headless (260) | capability ships (`session/session.ts:307-308`, `appserver/reloads.ts:53`), command does not; `command-coverage.md:74` files it **out of scope, bridge-coupled** | **classification flips**; ~10-line dispatch |
| `/advisor` text form headless (260) | interactive form already matches (`useChat.ts:2478`, `commands.ts:84`, three forms `/advisor`, `<model>`, `off`); headless is flag-only (`--advisor-model`) | mostly have it |
| `/status` + `doctor` "Organization policy" (261) | `commands.ts:355` `formatStatus` has 9 rows, no policy row; zero hits repo-wide | flips `:2333` ✅ — **or resolves 🚫**; `:1724`/`:1925` already record we have no managed-policy surface. Product call |
| `/context` local estimate when the counting API is down (261) | `useChat.ts:2260` is an **unguarded await**; `context/server.ts:19-27` degrades values to `0` but never estimates, so we print a plausible-looking `ctx 0% · 0 / 0` | flips; small, real |
| `/cost` + status-line `prompt_cache` miss cause (260) | `prompt_cache` is on **neither** list in `statusLine.ts:342-350`'s field-by-field enumeration of canon's payload — it did not exist in the canon we transcribed | flips `:2281` ✅ evidence; `/cost` half is a straight ❌ |

### 1b.9 (ch. 35/24/06, briefly)

- **`/rewind` (260).** Two halves. False-success-on-missing-backups is **inherited from the SDK** —
  `session/session.ts:371-372` delegates to `q.rewindFiles`, so an SDK bump likely fixes it free
  (verify with a probe, don't assume). Stale file-read tracking: `seedReadState` has **0 hits in
  `harness/src/`** (it is a known-but-unused `Query` method, `command-coverage.md:91`), so we may
  carry a latent version of the same defect. One control-request call whose name we already know.
- **Permission-rule validation (260).** Parenthesised paths, uncompilable patterns, trailing text after
  `)`. Ours: `permissionsModel.ts:36`'s entire validation is `typeof rule === "string"` — **by design**;
  `tui-ux.md:1702` states ccx deliberately owns *"never a rule grammar of ours"*. The matching half
  fixes on an SDK bump; the reporting half has nowhere to live. **Record as 🚫-by-design.**
- **`--permission-prompts none` (259).** No row, no code. Our `--permission-mode` enum
  (`cli/help.ts:120`) includes `dontAsk`, which is adjacent but a different axis: 263's flag denies on
  would-prompt *while the active mode still decides*. Directly relevant to `ccx --detachable`.
- **`/model` friendly names for Bedrock/Vertex/gateway ids, and Fable 5.1 (260/261).**
  `modelPickerModel.ts:178` shows `displayName ?? value` with no local id→name map; zero hits for
  `bedrock`/`vertex`/`gateway` in `harness/src/tui/`. Alias table `config/models.ts:18-23` pins
  `fable → claude-fable-5`; no 5.1, no mythos. Two-line fix for (ii), a new table for (i).
  **Do not let a catalog re-baseline overwrite `models.ts:14-16`'s owner-decided `default → claude-opus-5`.**
- **`bashOutputMaxChars` / `taskOutputMaxChars` (261).** 0 hits; not even in the settings-key allowlist
  (`configDomain.ts:180-200`). Cheap passthrough add.
- **Ctrl+Z / alternate screen (260).** We **shipped 263's behaviour ahead of upstream**:
  `harness/src/tui/suspend.ts:45-48` exists specifically to stop *"a fullscreen suspend [leaving] the
  smcup standing"*. `tui-ux.md:2016` ✅ and `:535` ✅ hold.
- **Layout/measure reuse (259/261).** We memoize in three places (`wrapItems.ts:176` WeakMap by item
  identity, `FullscreenViewport.tsx:375`, `diffRender.ts:301`), with one honest residue named at
  `wrapItems.ts:40-42`: a caller re-projecting the whole document (`TranscriptPager`, whose
  `makeItems` mints fresh identities each render) still pays an O(document) walk — precisely 263's
  "already-rendered blocks no longer re-checked by layout". Justifies a new 🟡 perf row.
- **`/config` at 263** adds exactly one row: `Unattended commands from cloud sessions on this computer`
  *(verified: 0 / 0 / 1 across 251/257/263)*.

**Cross-cutting for §1b:** three items (grapheme wrapping, layout re-check, box height after a
row↔column direction flip) are **patched-Ink territory**. Upstream ships a forked Ink; we run stock
5.2.1 (`harness/package.json:74`; the fork is recorded at `PlanDialog.tsx:18`). These are the only
items we cannot reach without vendoring — file them together in `tech-debt-tracker.md` rather than as
three unrelated ❌ rows.

---

## 2. Canon moved 251→257 — harness-visible (non-TUI)

Verdicts below on our modelling; **reachability through the Agent SDK transport is flagged, not
asserted** — the program settles that by live probe. Installed SDK: **0.3.250**
(`harness/node_modules/@anthropic-ai/claude-agent-sdk/package.json`).

One structural note that governs the whole section: `coverage.md` §5 (the 🚫 floor, `:923-932`) is a
**headcount plus examples**, not a transport model. Of the twelve topics, only feature gates falls
squarely inside its stated categories (`build-internal feature-flag/DCE gating`, `:927`). The real
"we see SDK frames, not Claude Code's internal state" line is drawn **row by row in the domain
scorecards** — `09-permission-system.md:6`, `:17`; `02-settings-schemas-migrations.md:21`;
`28-service-plugins.md:13`; `23-service-mcp.md:16`. Worth promoting into §5 as a stated rule.

| Topic | coverage/domain row | Our code | Probe | Verdict | Reachability flag |
|---|---|---|---|---|---|
| **Hooks strict validation** (§A5.11.12) | `02-...md:13` (02.9 ✅), `:21` (02.17 🔧, *"Validation runs in the subprocess"*) | `hooks/merge.ts:4` concatenates with no checks; `config/validate.ts:13` has **no `hooks` field** and is a `z.looseObject` | `116-hook-frames-0337.ts` (hooks DO emit `hook_started`/`hook_response` headlessly), `119-hook-event-census.ts`, `42`/`09` (8 of 30 events fire) | **absent** | Our hooks are in-process callbacks, not JSON entries, so canon's *shape* validation has no direct analogue. Disk hooks reach the engine untouched via `settingSources`, so the **behaviour** is inherited but not observable. No probe touches malformed hook config |
| **`blockReadsOutsideWorkingDirectories`** (§A5.11.9) | no row; nearest `09-...md:31` (09.27 ✅) and `:17` (09.13 🏗, *"SDK clients cannot configure which paths are safety-checked"*) | 0 hits; `config/types.ts:157` + `host/host.ts:215,688-690` carry `additionalDirectories` with sources **launch/session only** — no `projectSettings` dimension for canon's narrowing rule to live in | `75-register-repo-root-adddir.ts`, `75b` | **absent** | **Not declared in `sdk.d.ts` at 0.3.250** (`:5543-5569` lists exactly allow/deny/ask/defaultMode/disableBypassPermissionsMode/additionalDirectories + an index signature). Passable, unenforced, untyped |
| **`timeFormat` / `timeZone`** (§A5.11.10) | governed by 02.17 | 0 hits; `appserver/configDomain.ts:170` `KNOWN_TOP_LEVEL` has **158 keys**, gated against `sdk.d.ts` by `scripts/drift-check.mjs` | none | **passthrough only** | Both would reach the engine via `config.settings`, but an appserver write naming them emits a spurious advisory warning until the SDK declares them. Canon's 165→167 count is invisible to our gate by construction |
| **Model catalog / signing / `behavesAs`** (§A5.11.6–7) | `03-query-engine.md:15` (03.11 ✅), `22-service-api.md:11`, `:19`; `full-potential.md:154` (*"picker/pricing are host-UI … we don't interpret"*) | `config/models.ts:18-23` pins `fable → claude-fable-5`; `config/validate.ts:16-18` deliberately does no client-side catalog validation (bl7 D7) | `72-v5-models-auto-gate.ts` (**`supportedModels()` reports tier aliases, not model ids**), `27`, `103` | **partial, stale** | `behavesAs` **absent from `sdk.d.ts:5593-5615`**. Catalog fetch/RSA sidecar/`CLAUDE_CODE_MODEL_CATALOG_URL` are CLI-internal by construction |
| **Release signing** (§A5.11.8) | `02-...md:24` (02.20 🔧), `42a-...md:8` (🏗) | none, explicitly disclaimed: `cli/help.ts:239-241`, `clone-roadmap.md:379` | none | **absent by design** | Out of scope by project decision, not transport |
| **Permission-mode ceiling** (§A5.11.5) | `27-service-policy.md:14` (27.10 ✅, restrictive-only managed filter), `09-...md:29` (09.25, `filterEscalatingDefaultMode`) | `config/resolveOptions.ts:86-93` does the **opposite** — `if (mode === "bypassPermissions") options.allowDangerouslySkipPermissions = true` auto-grants rather than refusing. Backgrounding carries `flagPerms` with no inherited ceiling | `99-runtime-mode-refusal.ts` (does `setPermissionMode("bypassPermissions")` reject or silently no-op), `15`, `18e` | **absent** | `--inherit-permission-mode` is a hidden CLI flag, absent from `sdk.d.ts`. The `defaultMode` half is structural: we never read `permissions.defaultMode` (the two hits are comments) — the SDK owns layer precedence |
| **MCP project-approval refusal** (§A5.11.4) | `23-...md:16` (23.12 ✅ — `strictMcpConfig` **bypasses** the gate), `16-...md:9` (`mcpServerStatus()` enum) | **no `.mcp.json` handling anywhere in `harness/src`**; we model server *status* but no block-reason vocabulary | `52-mcp-topology.ts`, `52b`, `35`, `49` | **absent** | `APPROVAL_REQUIRED` / `project-approval`: 0 hits. Enforced inside the spawned CLI |
| **Plugin realpath containment** (§A5.11.3) | `28-...md:13` (28.9 ✅, *"the same manifest validation runs inside the spawned CLI"*) | plugins are pure passthrough (`resolveOptions.ts:96`). **Prior art exists**: `appserver/configWrite.ts:112-162` and `tui/dialogs/fileOptions.ts:46-110` + `FilePermission.tsx:57` already transcribe canon's realpath+containment predicates | `105-reload-plugins-skills.ts` | **absent for plugins** | Inherited from the spawned CLI. If ever built, the two prior-art sites are the pattern |
| **Feature gates** (§A5.11.14) | `26-...md:14` (26.10 **🚫**), `09-...md:35` (09.31 **🚫**) | 0 `tengu`/`statsig` hits in `harness/src`; the one gate honoured is cosmetic (`tui-ux.md:275`) | `100b-prompt-suggestion-env-override.ts` | **absent, scorecarded 🚫** | The only topic squarely inside §5's stated floor |
| **New env vars** (§A5.11.13) | — | 7 of 8 zero hits; `CLAUDE_CODE_ENABLE_NARRATION` appears once, in `2026-08-30-bl7-...:234` | — | **absent** | All settable today with zero code change via `resolveOptions.ts:71` (`options.env`). Only `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` would *change* our behaviour — it voids the subagent model overrides we set |
| **Late tool additions / ToolSearch** (§A5.11.5) | `12-tool-search.md:16` (12.12 ✅); governing prose `parity.json:1513-1518` (*"the defer/ToolSearch mechanism itself is engine-internal and on by default"*) | `appserver/dynamicTools.ts:42,206,256` bounds schemas for dynamically registered tools | `35b-mcp-tool-deferral-confirm.ts` — **decisive**: with `ToolSearch` in `disallowedTools` our SDK-MCP tool still ran ⇒ SDK-MCP tools are effectively inline | **partial** | **Plausibly probe-able.** A mid-conversation `{role:"system"}` schema push would arrive as SDK message frames; probe 35b already shows we can measure catalog composition |
| **Subagent resume note** (§A5.11.5) | `04-turn-pipeline.md` 04.11 ✅ (notification family) | `appserver/router.ts:224-241` already folds the four `task_*` frames; `host/host.ts:962` is our only synthesis site (rewind). No resume arm | `122-sessionstart-resume-staleness.ts` (**`SessionStart` dead headless at startup AND resume**), `126`, `39`, `41`/`41b` | **absent** | **Plausibly probe-able** — a `<note>` enqueued to a parent would land as a `task_notification` that `router.ts` already routes. But probe 122 is the cautionary precedent: the adjacent resume signal is dead headless |

---

## 3. Withdrawals

### 3.1 **The Ctrl+E command explainer — we built it; 2.1.257 deleted it** *(verified)*

`confirm:toggleExplanation` occurrences: **5 in 2.1.251, 0 in 2.1.257, 0 in 2.1.263.** In 2.1.251 it
is a first-class binding — `uu("confirm:toggleExplanation", "Confirmation", "ctrl+e")`
[`2.1.251/cli.pretty.js:165395`], registered at `:165413`, described as
`"confirm:toggleExplanation": { description: "explanation" }` in the action table [`:568825`], and
present in the master action array [`:717586`]. The generator (a forced-tool
`tool_choice:{type:"tool",name:"explain_command"}` call, `querySource: "permission_explainer"`) sits
at `:165315`, with `tengu_permission_explainer_{generated,error,shortcut_used}` around it. All of it
is gone at 257 (A5 §A5.11.14 "Removed", §A5.11.16 "What went away"); the 2.1.257 changelog states it
plainly: *"Removed the Ctrl+E command explanation on Bash and PowerShell permission prompts."*

We built five layers of it:
- `harness/src/tui/dialogs/explainCommand.ts:92` (`explainCommand`), `:38` (`EXPLAIN_TOOL_SCHEMA`),
  `:115` (`structuredExplainTransport`)
- `harness/src/tui/dialogs/ExplanationBlock.tsx:20`
- `harness/src/tui/dialogs/BashPermission.tsx:118`, `:136`, `:152`, `:172`
- `harness/src/tui/dialogs/ConsultFooter.tsx:31`
- `harness/src/tui/keys/bindings.ts:383` — `"ctrl+e": "confirm:toggleExplanation"` in `Confirmation`
- Tests: `harness/test/tui/explain-toggle.test.tsx`, `harness/test/unit/explain-command.test.ts`,
  `harness/test/tui/consult-footer.test.tsx`; probe `probes/probes/98-explain-command-feasibility.ts`

**Why re-baselining is a net gain, not a loss:**
- `tui-ux.md:306` 🟡's "missing arm" (*"the `ctrl+e explain` hint **never renders**"*) stops being a
  gap and becomes a **Recorded addition** — per the file's own rule (`:44-47`) a row scored for
  something upstream lacks belongs out of the denominator.
- `tui-ux.md:271` ❌ lists `DG4`'s `ctrl+e` explain pane as one of four unbuilt permission kinds;
  that arm is struck and the row rises.
- `tui-ux.md:2086` (`K16`) ❌ is one-third about `ctrl+e explanation`; that third is a non-gap.
- `tui-ux.md:1933` — **"A6 — the `ctrl+e` explain pane is a surface with its wiring deferred"** — is
  now **dead debt. Do not pay it.**
- Deletion is cheap because the feature is dormant: no production call site passes the transport
  (`grep -rn "explainCommand=" harness/src/` is empty), documented at `BashPermission.tsx:29`, and
  there is no PowerShell body at all.

**Decision the owner owns:** keep it as a deliberate ccx addition (it is genuinely useful and already
paid for) or delete it to stay a clone. Either way, *stop scoring it as a gap*.

### 3.2 Six highlight.js grammars — we still ship what canon dropped **at our own canon target** *(verified)*

2.1.251 dropped `1c`, `gml`, `isbl`, `mathematica`, `maxima`, `sqf` (192 → 186 grammars; the 2.1.251
note says so outright, A5 §A5.10). Our `harness/package.json:73` pins `highlight.js@11.11.1` — canon's
own version — and `harness/src/tui/hljsRuntime.ts:45` does `nodeRequire("highlight.js")`, the **full**
package. I verified all six grammar files are present in `harness/node_modules/highlight.js/lib/languages/`.
`detectLanguage` walks that registry (`hljsRuntime.ts:90`), so a `.nb`, `.sqf`, `.gml` diff highlights
in ccx and renders plain in canon. Small, real, and it is a divergence from **2.1.251**, not 2.1.257 —
it predates the hop.

### 3.3 Withdrawals that cost us nothing *(verified negatives)*

- **`sharp` unbundled** (§A5.11.16) — we do not depend on it (0 hits in `harness/package.json` and
  `harness/src/`).
- **`CLAUDE_CODE_PRINT_ENGINE_LOOP` + `tengu_print_engine_loop`** — 0 hits repo-wide.
- **`tengu_permission_explainer_*` telemetry** — we have no gate/telemetry system (§2 row 9).
- **From ≤241 (§A5.10 "Genuine removals"):** AWS Cognito, `device_bash`, the MCP `input_required`
  embedded-request vocabulary, and BigQuery-as-a-named-path all have no ccx analogue. The one to
  check was `tengu_kairos_loop_dynamic`/`_prompt` — `/loop` self-pacing became unconditional at
  2.1.251 — and `harness/src/kairos/` gates nothing (`assistant.ts:19` describes it as *"self-paced by
  the proactive heartbeat"*, no gate). Clean.
- **From 257→263:** 2.1.260 removed the one-hour cap on background commands started by subagents, and
  reverted 2.1.259's `Read()`-deny-on-Bash-arguments change. Neither has a ccx implementation.

---

## 4. Verbatim assets

Point-to list; nothing pasted at length. Check our source first — several of these we already carry
for *other* versions.

1. **The compiled-in release notes for 2.1.228–2.1.260**, including **2.1.257's own 105-bullet
   entry** and 2.1.258/259/260. In `~/claude-code-bundle/2.1.263/cli.pretty.js:50526` as a single
   `return "…"` string. Extract with:
   `python3 -c 'import re;s=[l for l in open("/Users/new/claude-code-bundle/2.1.263/cli.pretty.js",errors="replace") if "## 2.1.260" in l][0];print(re.search(r"return\s+\"(.*)\"\s*;?\s*$",s.strip()).group(1).encode().decode("unicode_escape"))'`
   Blob windows verified: 251 → 2.1.222–2.1.250; 257 and 258 → 2.1.224–2.1.252; **263 → 2.1.228–2.1.260**
   (2.1.253–2.1.256 have no entries at all). This is the single most valuable asset in the lane.
2. **`/config` `Time format` row** and presets `["auto","12-hour","24-hour","24-hour-utc"]`
   [`chunk-wftr5q3n.js:777170`], with the six sibling rows in source order (§1.1) — we have two of
   them verbatim already.
3. **`timeFormat` / `timeZone` describe texts** [`chunk-ejcy5qcd.js:488712`], plus the two lines added
   to the built-in `update-config` skill body [`chunk-bkee3xt2.js:387611-387612`] — the only path by
   which either key name reaches the model.
4. **The auto-mode outside-read block**: three body fragments and the two-arm ternary
   [`chunk-bq8epagv.js:422730`], and all three option labels with their short-form alternatives
   [`:422376`, `:422382`]. Structurally: a dim child inside the existing dialog shell (§1.4).
5. **`blockReadsOutsideWorkingDirectories` describe text** [`chunk-ejcy5qcd.js:488571`] and the
   decision-reason row `outsideReadsBlocked: { bypassImmune: !0, classifierRouted: !1 }`
   [`chunk-yte5spsr.js:839584`]; the 19-interpreter inline-code list [`:839597`].
6. **Keybinding context tables, all three versions** — 21 / 23 / 26 names with their descriptions
   [`2.1.251/cli.pretty.js:717590`], [`chunk-1kg58a1a.js:112109`], [`2.1.263/cli.pretty.js:542413`].
   Our `keys/types.ts:4-7` and `keys/bindings.ts:25-28` are the diff target.
7. **`EffortSlider` and `Agents` binding tables** — `{ s: "effortSlider:thisSessionOnly" }` and
   `{ "ctrl+s": "agents:switchView", "ctrl+t": "agents:togglePin" }` [`chunk-1kg58a1a.js:112105`].
8. **The `abovePrompt` action set** — eight actions with descriptions [`2.1.263/cli.pretty.js:204815`],
   three context binding tables [`:542409`], the `ctrl+x ctrl+a` chord [`:513403`], the help-grid
   context string [`:278411`]. All new; nothing on our side.
9. **The hook-validation problem table** — 14 message templates in source order, A5 §A5.11.12
   [`chunk-ejcy5qcd.js:487819-487960`], plus the settings-file re-render with its `docLink`
   [`:490660-490697`] and the rationale sentence [`:487929`].
10. **The `/add-dir` 8-outcome table** [`chunk-00yr8fkg.js:737-756`] — directly against
    `harness/src/tui/addDir.ts:61`'s and `:105`'s 12 messages.
11. **The narration prompt in full** — system line plus three instruction paragraphs
    [`chunk-bq8epagv.js:396810`]; A5 §A5.11.17 reproduces it because no chapter carries it.
12. **The `bypassPermissions` refusal warning**, verbatim and unconditional
    [`chunk-nc9m36bp.js:609879`], plus the trusted-source scope list `["policySettings",
    "flagSettings", "userSettings"]` [`:610043-610051`].
13. **The `2.1.251` diff-panel strings we can build from today** — `bQ = 110`, `Zkt = 144`, the
    too-narrow feedback line and the not-in-a-git-repo line [`2.1.251/cli.pretty.js:624746`,
    `:391981`, `:391989`, `:502763`].

---

## 5. Confirmations

- **Slash-command set is byte-identical 251→257** — A5 §A5.11.18, and consistent with my per-name
  spot checks. Nothing in our `commands.ts` catalog needs a 257 revision.
- **Hook events: 33, identical in membership and order** across the hop. Our 8-of-30-fire-headlessly
  finding (probes 42/09/119) is unaffected.
- **Permission modes (6) and built-in agent types (7) unchanged** across the hop.
- **`Show turn duration` and `Terminal progress bar`** exist as `/config` rows in all of 251/257/263
  *(verified)* — our two transcribed labels stay correct.
- **The OSC 9;4 progress driver's shape** (indeterminate-only, the trailing-`;` quirk, the
  iTerm2/Ghostty/ConEmu capability sniff) is unchanged 251→257; only the *active signal* grew at 263.
  `terminalEscapes.ts:32-34` and `progressBar.ts` hold.
- **Ctrl+Z / SIGCONT alt-screen handoff** (`suspend.ts:45-48`) matches what upstream only reached at
  2.1.260 — we were ahead.
- **The permission dialog's vertical-truncation marker** (`dialogs/rowBudget.tsx:38`, `… +N more
  lines`) means 2.1.259's "changed line cut short with no indication" defect class cannot occur here;
  we wrap and window rows rather than truncating horizontally.
- **`keybindingFlavor` never implemented** — 2.1.261 made it inert, so our omission is now canon.
- **Ctrl+W's whitespace-only kill** (`editor.ts:263`, `:278`) is exactly the Bash rule 2.1.261 adopted.
- **The four-rung spinner ladder** (`spinner.ts:338`) is unchanged in canon across the hop, and its
  `overrideMessage` rung is the correct home for narration.
- **`mcpServerStatus()`, `strictMcpConfig`, `searchHint`/`alwaysLoad`, `reloadPlugins`/`reloadSkills`**
  all survive the hop; the MCP work of §A5.11.4 is additive refusal vocabulary, not a shape change.
- **`abovePrompt` did not exist at 2.1.258** *(verified)* — so the 258 bundle is a valid stand-in for
  257 on every input-layer question.

---

## 6. Spec defects

1. **§A5.11.18: "the keybinding contexts went 20 → 22".** Verified counts are **21 → 23**, and
   2.1.263 is **26**. Programmatic count of the context description map — `2.1.251/cli.pretty.js:717590`,
   `chunk-1kg58a1a.js:112109`, `2.1.263/cli.pretty.js:542413`. The *delta* (+2, gaining `Agents` and
   `EffortSlider`) is right; both absolute numbers are one low. This matters because the count is the
   only number a re-implementer would check against.
2. **§A5.11.15: "Taking the union of the two blobs present on this machine gives official notes for
   2.1.222 through 2.1.252", and "first-party notes exist for exactly one of the six releases in this
   hop."** There are **four** blob-carrying bundles on this machine, not two — 2.1.251, 2.1.257,
   2.1.258 and **2.1.263** — and 2.1.263's blob runs 2.1.228 → **2.1.260**, so first-party notes exist
   for **three** of the six (2.1.252, 2.1.257 and, in the wider window, 258/259/260), including
   2.1.257's own 105-bullet entry. The appendix's own replication checklist opens with *"Enumerate the
   bundles yourself … rather than trusting this appendix's list"*, and its bundle list does name 2.1.258
   and 2.1.263 — the release-note blobs in them simply were not read. This is the largest correctable
   defect: it moves a hop the appendix calls binary-derived-only onto first-party ground.
3. **§A5.11.18's "Two things that did change and are easy to miss"** understates the keybinding item
   twice over: the counts are wrong (defect 1), and by 2.1.263 the same enumeration has grown three
   more contexts for an entire new interactive region (`AbovePrompt*`) that no chapter covers.
4. **`CONVENTIONS.md` §4's worked example cites `chunk-fy12d89p.js`, a 2.1.251-only chunk.** A5.12
   already flags this as a live specimen of the failure mode it documents; worth actually fixing, since
   the example is the first thing a reader copies.
5. **The 2.1.257 changelog's "Containment Escape rule"** has **0 occurrences in 2.1.257's binary**
   *(verified; the only hit in 2.1.263 is inside the compiled release-notes text itself)*. Either the
   runtime rule is spelled differently or the auto-mode rule set is data-driven — either way, A5's
   auto-mode coverage and ch. 26 should not take the changelog's phrasing as a searchable literal.
6. **Not a defect but a caveat worth adding to A5:** upstream's "Added X" bullets frequently mean
   "ungated X". Verified: `/skill-doctor` has **11 occurrences in 2.1.251** yet is "Added" at 2.1.261;
   `/reload-plugins` has 30; the entire `/diff` panel including `bQ = 110` and its two feedback strings
   is in 2.1.251. A5 §A5.6's enumeration tables count *names*, which is exactly the measurement that
   misses this. It matters practically: several 258–263 features are buildable from the 2.1.251 bundle.

---

## Method notes (so the negatives can be trusted)

- Counts are `grep -c` over each bundle's `cli.pretty.js`; symbol and context counts are a Python
  brace-matched parse of the description-map object literal, not a regex over names.
- 2.1.257 and 2.1.263 citations use `tools/where.py` output (`chunk-name.js:LINE`); 2.1.251, 2.1.236,
  2.1.234 and 2.1.220 have no chunk graph, so those are `2.1.<v>/cli.pretty.js:LINE`.
- Our-side `file:line` came from three targeted repo sweeps; I re-ran the load-bearing ones
  (`settingsRows.ts`, `keys/bindings.ts`, `keys/types.ts`, `hljsRuntime.ts`,
  `dialogs/` inventory, the `L<n>` census, the clock-site census) myself.
- Nothing in the repo was modified; no build, no test run, no `ccx` launch.


---

## 7. Re-verification against `somersault` (post-bl10)

Sections §0–§3 were first drafted against a frozen sibling checkout
(`/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`) that predates the bl10 implementation.
Every our-side citation has now been re-resolved against
**`/Users/new/Developer/GitHub/somersault/CC-to-SDK` @ `e337ea7`** and **fixed in place above**. All
line numbers in §0–§3 are now somersault line numbers.

**Bottom line: no finding changed. 0 withdrawn, 0 substantively corrected, 41 citation offsets fixed.**
Every row text, every code construct and every negative I reported is present in somersault with the
same meaning; only line numbers moved.

### What differs between the trees
`harness/src`: 37 files (35 modified + `tui/dialogs/keyhints.ts`, `tui/McpDialog.tsx`,
`tui/mcpDialogModel.ts` new). `docs/parity`: `tui-ux.md` (+47 lines), `coverage.md`, `appserver.md`,
`tech-debt-tracker.md`. `harness/package.json` differs but lines 73–74 are byte-identical.
`probes/probes/` and every numbered domain scorecard (`02`, `03`, `09`, `12`, `16`, `22`, `23`, `26`,
`27`, `28`, `42a`), `command-coverage.md`, `clone-roadmap.md` and `parity.json` are **identical** — so
every §2 scorecard citation was already a somersault citation.

### `tui-ux.md` — 35 row citations, all content-identical, 27 renumbered
Divergence begins at old line **1061** (bl9 close-out → bl10 close-out), a uniform **+47** insertion.
Verified by matching each cited row's full text, not its number.

- **Unchanged (8):** `:6`, `:11`, `:13`, `:44`, `:271`, `:275`, `:306`, `:535` — the header block, the
  scoring rule, §1/§4 rollup rows.
- **+47 (27):** 1357→**1404**, 1358→**1405**, 1366→**1413**, 1378→**1425**, 1451→**1498**,
  1559→**1606**, 1655→**1702**, 1677→**1724**, 1700→**1747**, 1747→**1794**, 1749→**1796**,
  1851→**1898**, 1878→**1925**, 1886→**1933**, 1957→**2004**, 1958→**2005**, 1969→**2016**,
  1971→**2018**, 1977→**2024**, 2037→**2084**, 2039→**2086**, 2190→**2237**, 2234→**2281**,
  2237→**2284**, 2239→**2286**, 2255→**2302**, 2261→**2308**, 2264→**2311**, 2273→**2320**,
  2286→**2333**, 2289→**2336**, 2290→**2337**, 2291→**2338**, 2298→**2345**, 2304→**2351**.

Note the collision hazard, handled: `:1747` is both an old citation (→1794) and the new home of
`:1700`, and `:2237` is both an old citation (→2284) and the new home of `:2190`. The rewrite was a
single pass, so neither was double-applied.

### Code citations in the 37 changed files — 21 offsets, 0 semantic changes
| Item | § | Was | Now | Construct re-verified |
|---|---|---|---|---|
| `useChat.ts` `applyEffort` | 1.2 | :2811, :2824 | **:2832**, **:2845** | `function applyEffort`; `savePrefsFn({ effort: level })` |
| `useChat.ts` permission notify | 1.11 | :2174 | **:2182** | `notify("permission_prompt", …)` |
| `useChat.ts` FIFO comment | 1.11 | :2170-2173 | **:2179-2181** | *"ONE FIFO, FOUR KINDS"* |
| `useChat.ts` `case "diff"` | 1b.7 | :2401 | **:2424** | unchanged dispatch |
| `useChat.ts` `case "advisor"` | 1b.8 | :2457 | **:2478** | three forms intact |
| `useChat.ts` `case "context"` | 1b.8 | :2252 | **:2260** | still an unguarded `await` |
| `useChat.ts` `/clear` → viewport | 1b.3 | :981 | **:989** | unchanged |
| `ChatApp.tsx` `paneOwned` def | 1.9 | :1386-1389 | **:1387-1390** | unchanged; the `!paneOwned` spinner gate is still at **:1984** |
| `ChatApp.tsx` trade note | 1.9 | :1654 | **:1656** | unchanged |
| `ChatApp.tsx` dock budget | 1.9 | :1254-1259 | **:1255-1260** | unchanged |
| `ChatApp.tsx` progress `active` | 1b.4 | :473 | **:473** (same) | *"`active` is `state.busy` alone"* — the §1b.4 finding stands verbatim |
| `toolRenderer.tsx` hook line | 1.12 | :1149 | **:1229** | `Ran ${count} ${item.label} hooks` — one line per hook |
| `toolRenderer.tsx` running body | 1b.6 | :324 | **:339** | `if (normalized.status === "running") return { body: [], … }` |
| `commands.ts` `formatStatus` | 1b.8 | :353 | **:355** | still 9 rows, no policy row |
| `commands.ts` `/advisor` entry | 1b.8 | :82 | **:84** | `[fable\|opus\|sonnet\|off]` |
| `appserver/settingsOps.ts` | 1.8, 2 | :176 | **:177** | `directoryAdd = flagMutation(...)` |
| `host/host.ts` `flagPerms` | 2 | :213, :685-689 | **:215**, **:688-690** | launch/session sources only; no `projectSettings` dimension |
| `host/host.ts` synthesized notification | 2 | :954 | **:962** | the rewind-only `task_notification` emit |
| `FullscreenViewport.tsx` memo | 1b | :371 | **:375** | `useMemo` over streaming rows |
| `coverage.md` §5 heading | 2 | :857-866 | **:923-932** | text byte-identical |
| `coverage.md` gate example | 2 | :861 | **:927** | `build-internal feature-flag/DCE gating` |

**Unchanged and re-confirmed at the same lines** (files identical between trees):
`keys/bindings.ts:25-28, :251-257, :383` (the `EffortDialog` context and the `ctrl+e` →
`confirm:toggleExplanation` binding — §1.2 and §3.1 stand exactly as written, including
`bindings.ts:442`'s `VALID_ACTIONS` entry); `keys/types.ts:4-7`; `settingsRows.ts:15, :57-67`
(10 rows, no time entry — §1.1 unaffected by bl10's Status/Usage **tabs**, which live in
`SettingsDialog.tsx`, not in the row builder); `dialogs/explainCommand.ts`, `ExplanationBlock.tsx`,
`BashPermission.tsx`, `ConsultFooter.tsx`, `rowBudget.tsx`, `fileOptions.ts`, `FilePermission.tsx`;
`addDir.ts`, `autoModeNotice.ts`, `spinner.ts`, `modelPickerModel.ts`, `editor.ts`, `clearViewport.ts`,
`wrapItems.ts`, `suspend.ts`, `progressBar.ts`, `terminalEscapes.ts`, `graphemes.ts`, `diffRender.ts`,
`toolFold.ts`, `hookPairs.ts`, `ModelPicker.tsx`, `replay.ts`, `usageFormat.ts`, `sessionTools.ts`,
`durationRow.ts`, `statusLine.ts`, `permissionsModel.ts`, `commandComplete.ts`, `hljsRuntime.ts:45, :90`,
`kairos/assistant.ts:19`, `PlanDialog.tsx:18`, `cli/help.ts`, `cli/args.ts`, `cli/agents.ts`,
`config/models.ts`, `config/types.ts`, `config/validate.ts`, `hooks/merge.ts`,
`config/resolveOptions.ts:71, :86, :96, :116` (all four **verified at the same lines despite the file
differing**), `appserver/configDomain.ts`, `appserver/configWrite.ts`, `appserver/router.ts`,
`appserver/dynamicTools.ts`, `appserver/reloads.ts`, `session/session.ts`, `context/server.ts`,
`coverage.md:20-21`, `command-coverage.md:74, :91`, `parity.json:1513-1518`, `clone-roadmap.md:379`,
`2026-08-30-bl7-hookblock-advisor-design.md:234`.

### Census figures re-run on somersault (§1.14)
| Figure | Frozen tree | **somersault** |
|---|---|---|
| bare `L[0-9]{5,6}` in `harness/src/tui/` | 2,556 | **2,581** |
| files carrying them / total files in that tree | 154 | **159 of 197** |
| in `tui-ux.md` | 281 | **295** |
| within 80 chars of a `2.1.2xx` string | 37 | **36** |
| pre-2.1.251 version citations in `tui-ux.md` | 66 across 54 lines | **66 across 54 lines** (unchanged) |

The §1.14 conclusion is *stronger* on somersault, not weaker: 25 more bare citations landed with bl10
and one fewer is version-qualified.

### One item corrected outright
The setup bullet claiming `tui-ux.md` is 2,481 lines "not the 2,528 the brief states" was an artefact
of reading the frozen checkout. **The brief was right; that bullet is withdrawn and replaced.**

### Items re-checked and unaffected by bl10's new files
`dialogs/DialogFrame.tsx`, `dialogs/keyhints.ts`, `PermissionsDialog.tsx`, `McpDialog.tsx` and
`mcpDialogModel.ts` are named in §1.4 only as the *seam* the 2.1.257 outside-read block would mount
into — no line citation was made against them, and the bl10 dialog shell makes that seam better, not
different. §3.1's deletion inventory does not touch them.
