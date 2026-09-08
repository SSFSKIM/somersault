# Cross-check: `/context` display + autocompact bands · `/model` picker + `/effort` + `/fast` · `/output-style` picker

Lane: spec257 chapters **13** (§13.4, §13.18.2, §13.19), **06** (§15.3, §16.3, §17.6–17.7, §18.4), **32** (§32.3, §32.11).
Every claim marked **verified** below was confirmed by me against a bundle line I read in this session.
Bundle paths are `~/claude-code-bundle/<ver>/cli.pretty.js`; `LINE` is that file's line number.
Our paths are absolute under `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/`.

---

## 1. Corrections — things we BUILT that canon does differently

### C1. `/context` is a one-line digest; canon is a two-column grid view — and the SDK hands us the whole payload
- **Ours:** `harness/src/tui/commands.ts:264-266` — `formatContext` prints one dim line
  `ctx N% · 31.0k / 200.0k · ok`. Its input is narrowed to four fields at
  `harness/src/context/server.ts:12` (`RawContextUsage = {totalTokens, maxTokens, autoCompactThreshold, isAutoCompactEnabled}`),
  dispatched at `harness/src/tui/useChat.ts:2252`.
- **Canon:** spec §13.18.2 + §13.18.2 "Suggestions". The interactive `/context` is a **left grid / right legend**
  layout followed by detail sections. Verified in 2.1.257:
  - grid cell glyphs, `chunk-whza5rjh.js` **LINE 778740-778745**: `Free space` → dim `⛶ ` (U+26F6);
    buffer category → `⛝ ` (U+26DD) in the category colour; every other cell →
    `squareFullness >= 0.7 ? "⛁ " (U+26C1) : "⛀ " (U+26C0)` in the category colour.
  - legend row builder, **LINE 778933-778934**: `<glyph> <name>: <tokens> tokens (<pct.toFixed(1)>%)`,
    glyph is `" "` when `isDeferred`, `⛝` for the buffer, else `⛁`; a deferred row's percentage prints `N/A`.
  - right-column header **LINE 778919**: `${total}/${max} tokens (${pct}%)`, then a blank line, then
    dim-italic `Estimated usage by category`.
  - `Free space` legend row **LINE 778940**, buffer legend row **LINE 778943**.
  - detail sections **LINE 778959-778986**: bold `Auto-compact window: ` (rendered only when
    `autocompactSource !== "auto"`; value is `auto (${N} tokens)` for `experiment`/`clientdata`,
    `${N} tokens (default for an unrecognized model)` for `unknown-model`, else `${N} tokens`);
    `MCP tools` + dim ` · /mcp` (+ ` (loaded on-demand)`), with `Loaded`/`Available` subheads;
    `Custom agents` + dim ` · .claude/agents/`; `Memory files` + dim ` · /memory`;
    `Skills` + dim ` · /skills`; then dim `/context all to expand` when collapsed;
    then the bold `Suggestions` block (**LINE 778712-778726**).
- **Reachability: FULLY REACHABLE, and this is the point.** `SDKControlGetContextUsageResponse`
  (`harness/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3409-3499`) returns *the entire analyser
  payload* — `categories[{name,tokens,color,isDeferred}]`, **`gridRows[][]{color,isFilled,categoryName,tokens,percentage,squareFullness}`**,
  `rawMaxTokens`, `memoryFiles`, `mcpTools`, `agents`, `skills.skillFrontmatter`, `slashCommands`,
  `autoCompactThreshold`, `isAutoCompactEnabled`, `messageBreakdown`, `apiUsage`.
  The engine computes the grid geometry (§13.18.2's 10×10 / 20×10 / 5×5 / 5×10 table) and hands us the rows.
  We currently discard ~90% of a payload our own comment calls "~17 fields" (`context/server.ts:12`).
  Only `autocompactSource` is absent from the SDK type — so the `Auto-compact window:` block's *variant*
  selection is the one piece that needs a fallback.
- **Impact:** the single highest-value user-visible gap in this lane. Verified. Not version drift —
  `Estimated usage by category`, `/context all to expand`, `Auto-compact window: ` and the Suggestions
  templates are present and identical in 2.1.220, 2.1.251 and 2.1.257 (counts checked in all three).
- **Scorecard defect:** `docs/parity/tui-ux.md:2283` scores `/context` **✅** inside the lumped row
  `` `/clear` `/compact` `/context` `/model` … `` with the note "local, dispatched." There is no row anywhere in
  `tui-ux.md`, `coverage.md` or `tech-debt-tracker.md` mentioning the grid, the legend, `Free space`,
  `Autocompact buffer` or Suggestions (grepped). The ✅ is unearned.

### C2. `EffortDialog` is not canon's slider — the scorecard says it is
- **Ours:** `harness/src/tui/EffortDialog.tsx:58-64` renders `DialogFrame` + **one** `EffortRow` (glyph, level
  word, `(default)`, `←/→ to adjust`) + a footer. Its own header comment (lines 11-14) correctly flags the
  frame/title/subtitle as **UNSOURCED**.
- **Canon (2.1.257, verified):** `/effort` is a horizontal **slider**, `chunk-cagbxy4k.js` **LINE 441451**:
  title `Effort`; a blank row; a centred `Faster … Smarter` end-label row; a track of `─` (`trackChars`)
  with a bold `▲` marker at the selected stop (themed background/foreground); level labels below the track at
  `labelStarts` with `spacers`; per-stop help text; then the footer. Five stops with per-stop colours
  (spec §17.7: `low`=warning, `medium`=success, `high`=permission, `xhigh`=autoAccept-shimmer,
  `max`=rainbow-animated), plus an `ultracode` stop (violet-ripple, sub-label `xhigh + workflows`) when available.
  `Faster`/`Smarter` present in all three bundles — this is **not** drift, we just never built it.
  Canon's glyph family (`○ ◐ ● ◉ ◈`) belongs to the **picker's row** and the composer hint, not the slider.
- **Scorecard defect:** `docs/parity/tui-ux.md:2273` asserts "`EffortDialog.tsx` is upstream's slider — the five
  glyphs byte-verified". The glyphs are real and correctly ported; the *slider* is not built. Fix the claim.
- Verified.

### C3. `/effort` slider stepping: canon CLAMPS at the ends, ours WRAPS
- **Ours:** `harness/src/tui/EffortDialog.tsx:52-53` calls `stepEffort` (`modelPickerModel.ts:150-155`), which is
  modulo — `←` on `low` lands on `max`.
- **Canon:** `chunk-cagbxy4k.js` **LINE 441430-441432** (2.1.257): `left → Math.max(0, i-1)`,
  `right → Math.min(levels.length-1, i+1)`. Same clamp at 2.1.220 **LINE 447281-447283**.
- The **picker's** row genuinely wraps (`xrf`, 2.1.220 **LINE 441200-441203**: `s[(c+1)%s.length]`), so
  `stepEffort` is right for `ModelPicker` and wrong for `EffortDialog`. One function serving two contracts.
- Verified. Small fix, real behaviour difference at both ends of the ladder.

### C4. `/effort` dialog footer — 2.1.257 added an `s` clause (and an `s` key)
- **Ours:** `harness/src/tui/modelPickerModel.ts:166` —
  `"←/→ to adjust · Enter to confirm · Esc to cancel"` (transcribed from 2.1.220 **LINE 447278**, correct then).
- **Canon 2.1.257** `chunk-cagbxy4k.js` **LINE 441417**:
  `←/→ to adjust · enter to confirm · **s for this session only** · escape to cancel`.
  The clause is absent from 2.1.220 and 2.1.251 (`grep -c 's for this session only'` = 1/0/2; the single
  2.1.220 hit is unrelated prose at LINE 528766). **Introduced at 2.1.257.**
- The clause is backed by real behaviour: **LINE 441440** binds `effortSlider:thisSessionOnly` → `it(false)`
  while `return` → `it(true)`, i.e. the standalone dialog now carries the **same Enter=persist-as-default /
  `s`=session-only split** the model picker has. `docs/parity/tui-ux.md:367` lists
  "saved-as-default persistence" as a missing arm — canon now specifies exactly how it is offered.
- Also at **LINE 441441-441446**: Escape prints `Cancelled`, and confirming routes through the shared
  cache-miss dialog as `F4({kind:"effort", …})` — canon's `Change effort level?` title (spec §16.3).
  We route effort confirmation nowhere.
- Verified. Version note: 257-only.

### C5. `/model` picker: the session-only header line changed at 2.1.251
- **Ours:** `harness/src/tui/modelPickerModel.ts:18-19` —
  `Currently using ${name} for this session only. Selecting a model will undo this.`
- **Canon:** that is the **2.1.220** string, verified verbatim at 2.1.220 (`grep -o 'Currently using …'`).
  2.1.251 **and** 2.1.257 render
  `Currently using ${name} for this session only (base model: ${baseName}). Selecting a model here replaces both.`
  (2.1.257 `chunk-cagbxy4k.js` **LINE 406213**, read in full.)
- **Impact:** the new form names the base model, which we don't even thread into the component. 220→251 drift.
  Verified.

### C6. `/model` picker: no search box (added between 2.1.220 and 2.1.251)
- **Ours:** `harness/src/tui/ModelPicker.tsx:240-252` — `Select` with no query state, no filter, no empty state.
- **Canon 2.1.257** **LINE 406213**: a query input above the list, rendered when focused or non-empty,
  `placeholder: "Search models…"`; **LINE 406223**: `Yo !== "" && kn.length === 0 && \`No models match "${Yo}"\``;
  **LINE 406226**: a **second footer mode** while the search is focused —
  `Type to filter` · `enter`/`down` → `list` · `escape` → `clear`.
  Absent in 2.1.220, present in 2.1.251 (`grep -c 'No models match'` = 0/1/1; `'Search models'` = 0/1/1).
- **Impact:** on a catalog longer than the 10-row window (`MODEL_VISIBLE_MAX`), canon users type to narrow and
  we make them scroll. Verified. 220→251 drift.

### C7. `/model` picker: the fast-mode line under the effort row is missing
- **Canon 2.1.257** **LINE 406224**, two dim variants:
  - `Fast mode is **ON** and available with <models> (/fast). Switching to other models turns off fast mode.`
  - `Use **/fast** to turn on Fast mode (<models>).`
  Present in 2.1.220 too — a plain unbuilt gap, not drift.
- **Ours:** nothing; `/fast` is in `commands.ts`'s honesty-routing list (`tui-ux.md` §5 row).
- **Reachability:** partial. `ModelInfo.supportsFastMode` exists (`sdk.d.ts:1292`) and fast mode is set through
  `applyFlagSettings({fastMode})`, so the *availability* half is reachable; canon's per-Mtok rate suffix
  (spec §18.4, `↯ Fast mode ON · model set to Opus 5 · $10/$50 per Mtok`) needs a pricing table we don't have.
  FLAG, don't assert impossibility.

### C8. `/output-style` picker is missing the `Concise` built-in (added at 2.1.251)
- **Ours:** `harness/src/tui/OutputStylePicker.tsx:21-26` — four entries
  (`default`, `proactive`, `explanatory`, `learning`).
- **Canon:** the built-in table `Jz` is `{default, Proactive, **Concise**, Explanatory, Learning}` — read verbatim
  at 2.1.257 **LINE 138220-138226**. `Concise`'s description is
  `Claude responds tersely, leading with results and skipping preamble and narration`.
  `grep -c 'Claude responds tersely…'` = **0** in 2.1.220, **1** in 2.1.251, **1** in 2.1.257.
  **Introduced at 2.1.251** — exactly the 220→251 drift class this pass was looking for.
  (Our other three descriptions match canon's verbatim — see Confirmations.)
- Verified.

### C9. `/output-style` picker: our ids are lower-cased; canon's registry keys are capitalised
- **Ours:** ids `proactive` / `explanatory` / `learning` (`OutputStylePicker.tsx:23-25`). They are written
  straight into the engine: `useChat.ts:3071-3073` persists `outputStyle: id` to prefs **and** to
  `localSettings`, then calls `session.setOutputStyle(id)`.
- **Canon:** the table keys are `Proactive`, `Concise`, `Explanatory`, `Learning` (2.1.257 **LINE 138220**;
  identical capitalisation at 2.1.220 **LINE 372806**, so this was never a version question).
  Resolution is a **plain key lookup with a silent null fallback** — spec §32.6.2,
  `table[key] ?? null`, `chunk-1kg58a1a.js:138327`: an unknown name resolves to *default* with
  no error, no warning and no near-match.
- **Impact:** if the engine resolves by that key, every non-default style we set is silently a no-op — the
  user picks "Explanatory", the picker and `/status` and the statusLine all say `explanatory`, and the model
  behaves as `default`. **This deserves a live probe before it is called a bug**: the SDK's
  `setOutputStyle` may normalise. But it is the most consequential single-token difference in this lane.
  Verified against the bundle; the SDK-side normalisation question is FLAGGED, not asserted.

### C10. `/output-style` picker: hard-coded built-ins where canon lists the whole registry
- **Canon** (spec §32.11.2, `chunk-9w2c2eyx.js:352991-353056`): the sub-view builds its options from
  `getAllOutputStyles(cwd)` — built-ins **plus** directory-loaded and plugin styles — with
  `label = record?.name ?? "Default"` and
  `description = record?.description ?? "Claude completes coding tasks efficiently and provides concise responses"`,
  at most 10 visible; a dim `Loading output styles…` while the load is pending (verified,
  2.1.257 **LINE 353013**); a fall back to the built-in table alone if the load rejects.
- **Ours:** a frozen 4-entry array; a user's `~/.claude/output-styles/*.md` is invisible.
- Verified for the strings; the *discovery* half is a filesystem read we could do ourselves.

### C11. Footer wording, `/output-style` picker
- **Ours:** `OutputStylePicker.tsx:29` — `Enter to confirm · Esc to cancel`.
- **Canon:** key hints `enter select` / `Esc cancel` (spec §32.11.2). Spec-only (I did not isolate the
  hint-composer output); low value, listed for completeness.

### C12. Context-limit banner drops canon's third clause
- **Ours:** `harness/src/tui/species.ts:558` —
  `Context limit reached · ${DISABLE_COMPACT ? "/clear to continue" : "/compact or /clear to continue"}`.
- **Canon 2.1.257** `chunk-vp8nzhw3.js` **LINE 763180** — four concatenated children:
  `Context limit reached · <continue><autoCompactOff><tip>`, where `<autoCompactOff>` is
  ` · auto-compact is off · /config to turn it on` (added when there is no remote autocompact state and the
  user turned `autoCompactEnabled` off **in their own settings**), and `<tip>` is ` · ` + the rotating
  `warning` tip.
- **Reachability:** the `autoCompactOff` clause needs the user's settings value — `SDKControlGetSettingsRequest`
  ("returns the effective merged settings and the raw per-source settings", `sdk.d.ts`) makes that reachable.
  The rotating tip pool is ours to own or omit.
- Verified.

---

## 2. Unknown unknowns — canon behaviours with **no** `tui-ux.md` row

### U1. `/context` over-limit banner (two strings, exact)
Nothing in our tree emits either. Spec §13.18.2; `chunk-ck0vye6w.js:455888-455904`:
```
Context exceeds the ${max}-token limit by ${over} tokens — run ${m} to continue.
Context is ${over} tokens past the ${max}-token compaction window — run ${i} to reduce usage.
```
Classifier: `totalTokens <= rawMaxTokens → none`; else `autocompactSource === "auto" ? "hard_limit" : "compaction_window"`.
`m` = `/compact or /clear`, `i` = `/compact`, each collapsing to `/clear` under `DISABLE_COMPACT`.
**Reachable:** `SDKContextUsage.over_limit = {tokens_over, kind: 'hard_limit'|'compaction_window'}` is a
first-class SDK field (`sdk.d.ts:3261-3266`) — the engine classifies for us. Spec-only for the strings
(I read the SDK type, not `chunk-ck0vye6w`); the *field* is verified.

### U2. The `/context` Suggestions block
A whole ranked advisory panel — bold `Suggestions`, one entry per producer with a severity glyph, a bold
title, an optional dim `→ save ~<N>` savings figure, and an indented dim detail. Nine producers with
verbatim titles and details (spec §13.18.2, `chunk-whza5rjh.js:778639-778705`), thresholds
`fo=15%`, `Pe=10000`, `Eo=5`, `To=80`, `Mo=5`, `_o=5000`, savings ratios Bash/PowerShell 50%,
Read 30%, Grep 30%, WebFetch 40%, other 20%, file reads 30%, memory 30%.
I verified the renderer and the `Autocompact is disabled` producer at **LINE 778703-778726** and the
`save ~` affordance at **LINE 778709**.
**Reachable:** every input is in `messageBreakdown.toolCallsByType` / `memoryFiles` / `percentage` /
`isAutoCompactEnabled`, all present in the SDK response.

### U3. The `blocked` band
Canon's band function has **four** levels and `blocked` outranks `compact` (spec §13.4.5):
`blockAt = hardWindow − 3000` (`$Zt = 3000`), evaluated *before* the compact test. Our
`harness/src/tui/tokenWarning.ts:76-84` has three states (null / warn / error) and no blocked rung.
On a 200k model canon's numbers are: effective 180,000 · compact 167,000 · warn 147,000 · **blocked 177,000**.
Spec-only (§13.4.1/13.4.4/13.4.5 constants `FZt=13000`, `$Zt=3000`, `GZt=20000`). The band's *user-visible*
consequence is the pre-flight blocking limit (§13.17.2), not the indicator, so this is lower priority than it
looks — but our module comment claims to transcribe the ladder and it transcribes three of four rungs.

### U4. `/context` markdown (headless) form is a distinct renderer
Spec §13.18.2 registers **two** `/context` commands — a `local-jsx` grid for interactive and a
`local` markdown one for non-interactive, with `## Context Usage`, `**Model:**`, `**Tokens:**`,
`**Over limit:**` and five markdown tables (`Category|Tokens|Percentage`, MCP Tools, Custom Agents,
Memory Files, Skills). Note the asymmetry the spec calls out: `Autocompact buffer` is filtered out of the
ordinary rows and appended after `Free space`, while `Compact buffer` (auto-compact off, 3,000 tokens) is
**not** filtered and appears among the ordinary rows before `Free space`. Spec-only.

### U5. `/model` picker: the disabled/duplicate/org-default row machinery
Spec §15.3: `fTe` filters duplicates, annotates the org default, disables error-overridden rows and
**pushes disabled rows to the end**; `Lie` emits an upgrade hint `Newer version available · select ${alias} for ${name}`
and a `Custom model (${id})` fallback. Our `ModelPicker` renders the SDK list in arrival order with no
disabled state. Reachability: the SDK's `ModelInfo` has no `disabled`/`isDefault` field, so most of this is
**not reachable** — FLAG, and worth recording as unreachable rather than leaving unrowed.

### U6. `PreModelSwitch`-driven confirmation variants
Spec §16.3: the same dialog takes `Change effort level?` as its title for effort changes, and swaps its
subtitle to `A PreModelSwitch hook asked you to confirm` with the hook's reason as the body when a hook
returns `ask`. `PreModelSwitch`/`PostModelSwitch` are engine-side hooks; whether the SDK surfaces them
headlessly is unknown to me — FLAG.

### U7. `/output-style` is a **tombstone** in 2.1.257
Spec §32.11.1: the command is built by a "moved to /config" factory
(`chunk-1kg58a1a.js:143657-143662`), is `isHidden`, has description `Output style moved to /config`, and is
**enabled only when the GrowthBook flag `tengu_maple_sundial` is on (default false)** — i.e. a default
2.1.257 install has no reachable `/output-style` at all. Our `/output-style` is unconditionally live
(`tui-ux.md:2294` scores it ✅ as "matches upstream's own 2.1.220 behavior").
The redirect line itself is unchanged and ours is correct — see Confirmations.
Also: there is **no** `/output-style:new` and no in-harness style-creation flow in the bundle (spec §32.11.1).
This is a "should we follow canon into hiding a command users like?" product question, not a defect.
Spec-only for the gate; `tengu_maple_sundial` present in both 2.1.220 and 2.1.257 (count 1 each).

---

## 3. Known gaps now specified

| Our row | Where | What the spec now supplies |
|---|---|---|
| `/effort` **🟡**, missing "saved-as-your-default persistence" | `docs/parity/tui-ux.md:367`, `:2289` | §17.6's full result-message set, incl. the exact scope suffixes ` (saved as your default for new sessions)` / ` (this session only)`, and — new at 2.1.257 — the slider's own `s` key + footer clause that *offers* the split (C4). Also `Set effort level to <level><scope>: <description>` and the `Effort level set to auto` family. |
| `/effort` **🟡**, missing `auto` / `ultracode` | same | §17.6 gives the argument hint `[low\|medium\|high\|xhigh\|max\|ultracode\|auto]`, the `/effort help` usage block verbatim, the two `ultracode` descriptions (`xhigh + dynamic workflow orchestration`, `(this session only)`) and all five ultracode refusal strings. `ultracode` has no ccx spelling by decision — but `auto` now has an exact contract. |
| `/effort` **🟡**, missing `help`/`current`\|`status` | same | §17.6: `Current effort level: <level> (<description>)`, `Effort level: auto (currently <level>)`, `Effort level: auto (currently <level>, set by your organization)`. Both description tables (`EFFORT_HELP_DESCRIPTIONS` vs `EFFORT_STATUS_DESCRIPTIONS`) are already correct in `modelPickerModel.ts:93-108`. |
| Effort dialog **🟡** — "the frame, the title and the subtitle are ccx's" (`EffortDialog.tsx:11-14`) | `EffortDialog.tsx` | §17.7 + LINE 441451: title is the single word `Effort`; the body is the slider; the end labels are `Faster` / `Smarter`; per-stop help is `The default effort for this model` / `…, set by your organization` / `${mult} the estimated cost of ${defaultLevel} (the default)` / `${Kre} (${mult})`; org notes `Higher effort levels are restricted by your organization.` and `Your organization's default effort for this model is ${level}.`, space-joined. The "UNSOURCED" flag can be retired. |
| `/config` **🟡**, "only 5 of upstream's ~54 rows wired" | `tui-ux.md:2296` | §32.11.2 gives the `outputStyle` row exactly: id, label `Output style`, `type: "managedEnum"`, `options: Object.keys(builtinStyles)`, `optionsHint: "For custom styles, open /config."` (verified, 2.1.257 LINE 777215), the safe-mode value suffix ` (disabled in safe mode)`, the four-step `onChange`, and the post-close summary line `Set output style to <bold key>` (verified, LINE 353359). We have neither the hint (`settingsRows.ts:61`) nor the summary line. |
| `/context` **✅** (overclaimed, C1) | `tui-ux.md:2283` | §13.18.2 in full: analyser shape, category emission order, buffer arithmetic, grid geometry table, glyphs, legend, detail sections, Suggestions. Enough to build it verbatim. |

---

## 4. Verbatim assets worth pinning (we lack these; point, don't dump)

1. **`/context` grid glyphs + legend** — 2.1.257 LINE 778740-778745 (cells) and 778933-778934 (legend).
   Four code points: `U+26F6 ⛶`, `U+26DD ⛝`, `U+26C1 ⛁`, `U+26C0 ⛀`, plus the `squareFullness >= 0.7` split.
2. **`/context` category names, in emission order** — spec §13.18.2:
   `System prompt`, `System tools`, `MCP tools`, `MCP tools (deferred)`, `System tools (deferred)`,
   `Custom agents`, `Memory files`, `Skills`, `Messages`, `Autocompact buffer` | `Compact buffer`, `Free space`.
   The SDK sends these names on `categories[].name` — pin them so a renderer can order/route by them.
3. **`/context` detail-section headers** — LINE 778959-778986: the `bold header + dim ` · <command>`` pattern
   (`· /mcp`, `· .claude/agents/`, `· /memory`, `· /skills`) and `/context all to expand`.
4. **The two over-limit banner templates** — §13.18.2 (U1 above).
5. **Suggestions: nine title templates + nine details + the six thresholds + seven savings ratios** — §13.18.2.
6. **Band constants** — §13.4.1: `FZt=13000`, `$Zt=3000`, `GZt=20000`, `qxe=0.2`, `VZt=3`, `K1n=3`, `H1n=3`,
   and the four-rung `ZJe` with `blocked` first. Our `tokenWarning.ts:48-55` has the first two and 20,000;
   `$Zt` and the blocked rung are absent.
7. **`Concise` built-in style** — name, description (C8) and the full prompt body + `turnReminder`
   (`Be concise: lead with the result, skip preamble and narration, keep only what the user needs.`),
   spec §32.3.3, 2.1.257 LINE 138211-138226.
8. **Model picker search chrome** — `Search models…`, `No models match "${q}"`, and the search-focused footer
   (`Type to filter` / `enter`,`down` → `list` / `escape` → `clear`), 2.1.257 LINE 406213/406223/406226.
9. **Session-only header, current form** — C5's 2.1.251+ sentence.
10. **Effort slider chrome** — `Effort`, `Faster`, `Smarter`, `─` track, `▲` marker, and the 257 footer (C4).
11. **`/fast` message family** — spec §18.4: `↯ Fast mode ON · model set to <Name> · $10/$50 per Mtok`,
    `Fast mode OFF`, the ` (this session only)` suffix, `Fast mode unchanged (cancelled)`,
    and the picker's two dim lines (C7).
12. **`Set output style to <bold key>`** and **`For custom styles, open /config.`** and
    **`Loading output styles…`** — all three verified in 2.1.257 (LINE 353359 / 777215 / 353013).

---

## 5. Confirmations (things we got right)

- `tokenWarning.ts:69-83` reproduces canon's `compactAt = window − min(maxOut,20000) − 13000`, the
  `warnAt = compactAt − 20000` lead, and `pctLeft = max(0, round((denom−used)/denom×100))` exactly
  (spec §13.4.4/13.4.5). The saturating-`min` argument in its header comment is sound.
- The three `Context low (…)` variants and the `${N}% until auto-compact` / `${100−N}% context used` split are
  documented correctly in `tokenWarning.ts:38-44`, and are byte-identical between 2.1.220 (LINE 488935-488945)
  and 2.1.257 (LINE 408762-408773) — the only 257 change is `bw !== void 0` (remote autocompact state) joining
  `DISABLE_COMPACT` in the middle arm's guard. Our recorded owner-decision to ship one wording stands.
- The compaction-just-happened suppression (`JF()`/`MRr()`) exists in 2.1.220 too — no drift.
- `species.ts:558`'s first two clauses match canon's `cg()` verbatim (2.1.257 LINE 763180).
- `commands.ts:264` using `formatTokens` for both sides of the token pair matches canon's `$n` throughout.
- `modelPickerModel.ts:13,15` — `Select model` and the `--model` subtitle are **unchanged** at 2.1.257
  (LINE 406213). Good.
- `modelPickerModel.ts:24,34-37` — the 10-row window and the `paddingLeft: 3` `+N model` counter match
  2.1.257 LINE 406223.
- `modelPickerModel.ts:93-108` — both effort description tables match spec §17.6/§17.7 exactly, including the
  deliberately-different `high` entries.
- `modelPickerModel.ts:127-129` — `←/→ to adjust` and the `max` caveat (`Kre`) match; `Kre` verified at
  2.1.257 LINE 609401.
- `EffortRow.tsx:35` — `Effort not supported for <model>` matches 2.1.257 LINE 406224 verbatim.
- `modelConfirmModel.ts:14-27` — `Switch model?`, `Your next response will be slower and use more tokens`,
  `This conversation is cached for the current model. Switching to <target> means the full history gets
  re-read on your next message.`, `Yes, switch to <target>` / `No, go back` all match spec §16.3.
- `OutputStylePicker.tsx:22,23,24,25` — the four descriptions we do carry are canon's verbatim
  (default's UI-only sentence verified at 2.1.257 LINE 352994; the other three at LINE 138220-138230).
- `OutputStylePicker.tsx:27-28` — `Preferred output style` and
  `This changes how Claude Code communicates with you` verified at 2.1.257 LINE 353023 / 353008.
- `OutputStylePicker.tsx:32` — `/output-style moved → Output style in /config` matches the 2.1.257 template
  at LINE 840010 (`moved → ${label} in /config`).
- `statusLine.ts:567` — `output_style: { name: … }` with a `"default"` fallback matches spec §32.11.4,
  including the "raw setting, not the resolved style" semantics.

---

## 6. Spec defects

- **§17.7, `Kept effort level as <level|auto>` labelled "the cancel message" of the effort slider.**
  The slider's own Escape handler emits the literal `Cancelled` (2.1.257 LINE 441437, `s("Cancelled")`).
  `Kept effort level as ${…}` does exist at LINE 441213, but in a *different* component's `onCancel`
  (a wrapper/`/model`-side path). Both strings are real; the attribution of the first to the slider's
  Escape is wrong, and a reimplementer following §17.7 would print the wrong thing on Esc.
- **§13.18.2 "Suggestions", `Oe(data)` cited at `chunk-whza5rjh.js:778640`.** The producer functions and the
  `Suggestions` renderer sit at 778703-778726 in `cli.pretty.js`; 778640 is inside the threshold/producer
  block. Off-by-a-few line attribution, harmless, noted only because the chapter is otherwise precise.
- **§32.11.2 quotes `optionsHint: "For custom styles, open /config."`** — verified correct (LINE 777215), but
  the hint is self-referential (the row *is* in `/config`). Not a spec error; flagging it so a transcriber
  doesn't "fix" it.
- No contradiction found between chapter 06's §15.3 row table and the bundle for the strings I sampled;
  the chapter's LOW-confidence label is, on this evidence, conservative. The picker *chrome* (search box,
  session-only line, fast-mode line, footer modes) is however **absent from §15.3 entirely** — the chapter
  documents the row list and skips the surrounding component. That omission, not an error, is what produced
  findings C5–C7 here.
