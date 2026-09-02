# bl10 / R1 — Canon's slash-command interactive surfaces, and where our harness stands

**Round:** bl10 · **Role:** R1 researcher (diagnosis, not design) · **Date:** 2026-08-31
**Canon evidence base:** `~/claude-code-bundle/2.1.251/cli.pretty.js` (Claude Code v2.1.251, 881,404 lines).
All `L<n>` cites below are line numbers in that file.
**Our side:** `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/src/tui/`.

The owner's observation was: *"slash commands like /status, /compact, /mcp, /plugins load a various slash
command menu bar."* Verdict up front: **the observation is right about the phenomenon and 3-of-4 right about
the examples.** The "menu bar" is real and is a single shared component — canon's tab strip — and `/status`,
`/mcp` and `/plugin` do reach interactive surfaces. **`/compact` does not**; it is a plain text command with
no UI at all (§2, MISREAD row). The genuinely interesting finding is that the surfaces are far more
systematic than "each command has a menu": **nine** tabbed dialogs share one `Tabs` component, and
`/status` + `/config` + `/usage` + `/cost` + `/stats` + `/settings` are all *the same dialog*, opened on
different tabs.

---

## 1. Canon's slash-command registry

### 1.1 Where commands are declared

Command records are plain object literals, declared in one dense block of the bundle:
**L501572 – L504400** (with a handful of outliers: `/add-dir` L429040, `/daemon` L26578, `/install`
L4421, `/remote-control` L93774, `/web-setup` L184696, `/background` L550430, `/workflows` L826977,
`/stop` L849708, `/goal` L854648). Two aggregate `Set`s at **L76567** collect them for capability
checks (`mBt` = commands the thin client can surface; `yVn` = commands with a non-interactive twin).

### 1.2 The discriminator: `type`

Every command record carries a `type` field. This is the mechanism the owner is really asking about.

| `type` | Meaning | Requirements (L168893-168905, fn `a_r`) |
|---|---|---|
| `"prompt"` | Expands to a prompt and runs a model turn (skills, custom commands, plugin commands) | `{workspace:false, ink:false}` |
| `"local"` | Runs code, returns `{type:"text", value}` — **printed into the transcript, no UI** | `{workspace:true, ink:false}` |
| `"local-jsx"` | Returns a **React element** — mounts a live component | `{workspace:true, ink:true}` |

Other fields that matter for the UI question:

- `immediate: true | (args)=>boolean` — open without an intervening confirm step.
- `requires: { workspace, ink }` — explicit override of the table above.
- `load: () => import("/$bunfs/root/chunk-….js")` — lazily fetch the implementation.
- `aliases`, `argumentHint`, `getArgumentCompletions`, `isEnabled`, `isHidden`, `menuDescription`,
  `supportsNonInteractive`, `thinClientDispatch`, `policyGate`, `availability`.

**Dual registration is common.** Several commands are declared *twice*: a `local-jsx` record for the
interactive terminal and a `local` text-only twin for thin/headless clients, selected by `isEnabled: () => Le()`.
`/mcp` is the clearest case — text twin at **L503073**, dialog record at **L503075**. Same pattern for
`/config`, `/usage`, `/rename`, `/model`, `/color`, `/skill-doctor`. The resolver `Rbe` (L76575) maps a
`local-jsx` record back to its `local` twin.

### 1.3 How a `local-jsx` command finds its component

There is **one dialog-resolution table** for the whole product: `var oj = { … }` at **L144758**. It maps
command name → chunk import:

```js
var oj = { "add-dir": () => import("…chunk-7q3zktx6.js"), advisor: () => import("…"), … }   // L144758
function _b(S) {                                                                            // L144762
  if (S.type !== "local-jsx") return;
  return S.load ?? (Object.hasOwn(oj, S.name) ? oj[S.name] : void 0);
}
```

`oj` currently holds **74 entries**. Each imported chunk exports `call`, e.g. `/status`'s whole
implementation chunk is four lines of code:

```js
// ==== chunk-k305310y.js ====                                          L593644
async function a(o, t) { return e(gq, { onClose: o, context: t, defaultTab: "Status" }); }   // L594062
export { a as call };
```

Execution is at **L76555** (`case "local-jsx":`). The contract: `call(onDone, ctx, args, …)` either
returns a React element (mounted as a modal via `t.localJsx` panel host), or calls `onDone(value, opts)`
itself. **L76551** bails to the text twin when `isNonInteractiveSession`.

### 1.4 A distinction that matters: `local-jsx` is not always a modal

Two sub-shapes hide under `type: "local-jsx"`:

1. **Modal dialog** — returns a live element, claims focus, Esc closes it (`/status`, `/mcp`, `/plugin`,
   `/permissions`, `/help`, `/model`, …).
2. **Static render** — builds an element, renders it to a *string* with `cse(...)`, and posts it as a
   system message, then returns `null`. Nothing is mounted; nothing takes keys. **`/context` is this**
   (chunk `z0mqep56`, L847883–848613; the render-and-post is at the chunk tail, `return c(re, {display:"system", …}), null`).
   Confirmed by absence: the whole `/context` chunk registers **no key scope and no key action**.

So "is it `local-jsx`?" is *not* the same question as "is it a menu?". Our parity work needs both bits.

---

## 2. Inventory — every canon slash command that opens an interactive surface

Status legend: **[BUILT]** = we have an equivalent interactive surface · **[PARTIAL]** = we have something
but materially thinner · **[NOT-BUILT]** = absent · **[MISREAD]** = the owner's premise is wrong for this row.

### 2.1 The nine tabbed dialogs (canon's `Tabs`, §3)

These are the "menu bar" the owner saw. Every one of them is `Tabs` (`Pg`, L122645) painting a row of
tab chips above a body.

| Command(s) | Title / color | Tabs (in order) | Canon cite | Our status |
|---|---|---|---|---|
| **`/status`**, `/config`, `/settings`, `/usage`, `/cost`, `/stats` | `"Settings"`, `permission` | **Status · Config · Usage · Stats** (ids `status`/`config`/`usage`/`stats`) | dialog `gq` L762665-762738; `Pg` call L762732; tab panes L762697(Status), L762702(Config), L762707(Usage), L762712(Stats); `/status` entry L593644+L594062; command records L503100 (`status`), L502743 (`config`), L503740 (`usage`) | **[BUILT]** — `SettingsDialog.tsx:73` has the identical 4-tab list `["Status","Config","Usage","Stats"]`, `TAB_SPECS` :75, strip :474. Reached by `/config`+`/settings` (`useChat.ts:2519`). **Gap:** our `/status` prints text instead (`commands.ts:39` → `useChat.ts:2254` → `formatStatus` `commands.ts:353`); `/usage`/`/cost`/`/stats` likewise text-only (`useChat.ts:2271/2253/2402`). The tabs exist, the *entry points* don't. |
| ↳ nested inside the **Stats** tab | title `null`, `claude` | **Overview · Models** — a second-level tab strip | `Pg` call L762166; panes L762157/L762162; footer `"↑ tabs · r to cycle dates · ctrl+s to copy"` L762172 | **[NOT-BUILT]** — our Stats tab is flat. |
| **`/permissions`**, `/allowed-tools` | `"Permissions"`, `permission` | **Workspace · Allow · Ask · Deny · Recently denied · Auto mode** | `Pg` call L829960; tab ids `allow`/`ask`/`deny`/`recent`/`workspace`/`automode` in chunk `y7da6q4n` L826981-829986; sub-views "Rule details", "Add auto mode rule", "Edit environment", "Remove directory from workspace?"; record L503744 | **[PARTIAL]** — `PermissionsDialog.tsx:61` has 5 of 6: `["Recently denied","Allow","Ask","Deny","Workspace"]`. **Missing: Auto mode tab.** Order also differs from canon. |
| **`/help`** | `"Help"`, `professionalBlue` | **General · Commands · Custom commands** | `Pg` call L820275; ids `general`/`commands`/`custom` in chunk `xsfdwhm7` L819809-820303; also "Browse default commands"/"Browse custom commands" | **[PARTIAL]** — `HelpDialog.tsx:91` has the same 3 tabs, strip :192. But "Custom commands" is permanently empty by design because our command records carry no provenance (`HelpDialog.tsx:14-22`). |
| **`/plugin`**, `/plugins`, `/marketplace` | `"Plugins"`, `suggestion` | **Discover · Installed · Marketplaces · Errors(N) · Stats** — `Errors` title is computed `` `Errors (${n})` `` | root component `itt` L281025; `Pg` call L281099; entry chunk `csn990zy` L328885+L329285; record L503924. Also a `Plugin` key scope: `space`→`plugin:toggle`, `i`→`plugin:install`, `f`→`plugin:favorite` (L717586). Non-tab sub-views: `validate`, `eval`, `tag`, `marketplace-list`, `plugin-list`, `add-marketplace`, and a text `help` screen | **[NOT-BUILT]** — no `/plugin` row in `commands.ts`, no switch arm in `useChat.ts`, no component. |
| **`/sandbox`** | `"Sandbox"`, `permission` | **Mode · Config · Dependencies · Overrides** | `Pg` call L668581; chunk `q2jy5252` L668016-668686; record L503936 | **[NOT-BUILT]** |
| **`/diff`** | title `null` | **Current · T1 · T2 …** — one tab per conversation turn | `Pg` call L324528; chunk `cbv12pck` L323726-328884, `export { un as DiffDialog }`; tab titles built as `` ln.type === "current" ? "Current" : `T${ln.turn.turnIndex}` ``; own key scope `DiffDialog` (L717586: `left/right` = source, `up/down` = file, `enter` = view details, vim keys, page keys); record L502762 | **[PARTIAL]** — `/diff` exists (`commands.ts:97` → `useChat.ts:2401`) but shells `git status --short; git diff --stat` and dumps text. The rich diff machinery (`diffRender.ts`, `diffHighlight.ts`) is wired only into the tool renderer and `dialogs/FilePermission.tsx`. |
| **`/daemon`** | `"Claude daemon"` (outer frame) + `Tabs` title `null` | **Scheduled · Remote Control** | `Pg` call L208352, inside `me` frame; chunk `8bf3vs19` L207835-208611; sub-views "New Remote Control server", "Remove server?", "Trust this directory?"; record L26578 | **[NOT-BUILT]** — out of scope (no daemon feature). |
| **`/mobile`**, `/ios`, `/android` | `"Mobile"` | **iOS · Android** (QR codes) | `Pg` call L351679; chunk `dke5tca4` L351464-351722; record L503075 | **[NOT-BUILT]** — no parity value. |

### 2.2 Non-tabbed interactive surfaces (navigation stacks, lists, wizards)

| Command | What renders | Canon cite | Our status |
|---|---|---|---|
| **`/mcp`** | A **navigation-stack dialog**, not tabs. Root view `list`: frame `me` titled **"Manage MCP servers"**, subtitle `` `${n} servers` ``, grouped section headers **Project MCPs / User MCPs / Local MCPs / Enterprise MCPs / Active agent MCPs / Built-in MCPs / claude.ai / Agent MCPs**, a virtualized window with `↑ N more above` / `↓ N more below` counters, a "Show all" toggle for unused connectors, a docs link `https://code.claude.com/docs/en/mcp`, and a keyhint footer `↑↓ navigate · enter confirm · Esc cancel`. Enter drills into `server-menu` (fields **Type: / URL: / Command: / Used by: / Status: / Auth:**, actions **Authenticate / Back**) → `server-tools` → `server-tool-detail`; separate `agent-server-menu` branch. Esc pops one level (`onCancel → {type:"list", defaultTab:…}`). | list render L582001; view router `switch (y.type)` L582270-L582362; entry chunk `j9x7bey3` L581310-582561; records L503073 (text twin) + L503075 (dialog) | **[PARTIAL, effectively NOT-BUILT for UI]** — `/mcp` exists (`commands.ts:65` → `useChat.ts:2337`) but is **text-only**: `formatMcpStatus` (`commands.ts:464`) prints a bold header and one dim `name  status` line per server; args are bare / `reconnect <n>` / `toggle <n> on\|off` (`parseMcpArgs` `commands.ts:455`). No list, no drill-in, no tool browser, no auth flow. |
| **`/hooks`** | Frame titled **"Hooks"** (or **"Hook configuration · disabled"**); per-event lists with `"No hooks configured for this event"`; drill-in **"Hook details"** showing **Event: / Matcher: / Type: / Source: / Plugin: / Status message:**; keyhints `confirm` · `go back` · `close`; a cloud-hooks consent branch. | chunk `nr16q075` L647360-648909; record L503917 | **[NOT-BUILT]** (`tui/hookPairs.ts` is transcript tool-pairing, unrelated) |
| **`/skills`** | Frame titled **"Skills"**, subtitle = count. Rows grouped by source, each with a **4-state toggle cycled in place**: `on` (✓, success) · `name-only` (•) · `user-only` (○, warning) · `off` (✗, error) — array `["on","name-only","user-invocable-only","off"]` with glyph/label/color map. Override precedence policy → flag → author. Empty state `"No skills found"`; footer note `"Plugin skills are managed via /plugin"`; Esc = `close`. | chunk `gnasd5ep` L541764-542535 (state array + glyph map at ~L541786); record L503100 | **[NOT-BUILT]** (`dialogs/SkillPermission.tsx` is a permission prompt for the Skill tool, not a browser) |
| **`/tasks`**, `/bashes` | Background-task manager component `Qet` | chunk `hn9z4fs1` L563491-563903; record L503100 | **[BUILT]** — ours is `/bg` with aliases `tasks`/`bashes` (`commands.ts:72` → `useChat.ts:2345` → `BgTasksPanel.tsx`), a sectioned list with an Enter drill-in detail view. Naming is inverted vs. canon (deliberate, `commands.ts:66-71`). |
| **`/resume`**, `/continue` | Session picker | chunk `z779gcyq` L849712-850327; record L503079 | **[BUILT]** — `SessionPicker.tsx`, a three-stage list/preview/rename wizard (`useChat.ts:2298`). |
| **`/model`** | Model picker with an inline effort control (own key scope `ModelPicker`: `left/right` = effort, `s` = this-session-only, L717586) | chunk `g09dsx1f` L520507-521319; records L504313 (jsx) / L504311 (text twin) | **[BUILT]** — `ModelPicker.tsx` + `ModelSwitchConfirm.tsx` (`useChat.ts:2209`); our `keys/bindings.ts` carries the same `ModelPicker` scope. |
| **`/theme`** | Theme picker (own key scope `ThemePicker`: `ctrl+t` = toggle syntax highlighting, `ctrl+e` = edit custom, L717586) | chunk `k3j4a093` L594200-594950; record L503744 | **[PARTIAL]** — `ThemeDialog.tsx` has the 5-row list + live preview but not the `theme:toggleSyntaxHighlighting` / `theme:editCustom` actions. |
| **`/plan`** | Plan-mode dialog | chunk `jtjj3gmq` L590582-591013; record L503744 | **[BUILT]** — `PlanDialog.tsx`. |
| **`/effort`** | Effort picker | chunk `1tw6p636` L41690-42453; record L504361 | **[BUILT]** — `EffortDialog.tsx` + `EffortRow.tsx` (`useChat.ts:2328`). |
| **`/add-dir`** | Directory-add prompt + grant menu | chunk `7q3zktx6` L185322-185736; record L429040 | **[BUILT]** — `AddDirDialog.tsx`, two-phase wizard (`useChat.ts:2441`). |
| **`/memory`** | Frame titled **"Memory"** — CLAUDE.md file picker + memory settings, incl. `"Auto-dream: off while auto-memory is off"` | chunk `ewzfqctk` L393705-394504; record L502770 | **[NOT-BUILT]** |
| **`/export`** | Wizard: **"Export conversation"** → **"Select export method"** | chunk `8e2rek0c` L212525-213107; record L504311 | **[PARTIAL]** — `/export` works but is argument-driven and non-interactive (`useChat.ts:2374`): clipboard or a path, plus an overwrite guard. No method picker. |
| **`/ide`** | **"Select IDE"** / "Select IDE to install extension" / "Select an IDE to open the project"; footer "You can also configure this in /config" | chunk `6ns5bzvn` L142419-143229; record L502774 | **[NOT-BUILT]** |
| **`/advisor`** | **"Advisor (experimental)"** | chunk `wzpysq06` L799946-800448; record L503952 | **[BUILT]** — `AdvisorDialog.tsx` (`useChat.ts:2457`). This is fork-specific work that happens to line up. |
| **`/rewind`**, `/checkpoint`, `/undo` | Message selector (own key scope `MessageSelector`, L717586) | record L503924 (`type:"local"`, chunk `pn5vyxxp`) | **[BUILT]** — `RewindPicker.tsx` (`useChat.ts:2351`). |
| **`/autocompact`** | **"Auto-compact window"** picker — "Set how full the context gets before auto-summarizing" | chunk `bergs9xw` L286372-286851; record L502735 | **[NOT-BUILT]** — *this is probably the menu the owner associated with `/compact`.* |
| **`/artifacts`** | **"Artifacts"** browser — uses the tab-chip primitive `pnt` directly with a hand-rolled strip rather than `Pg` | chunk `n160gns8` L639038-640017 (imports only `pnt`, L639325); record L501572 | **[NOT-BUILT]** |
| **`/release-notes`** | **"Release notes"** — version list + "Select a version to view its notes." | chunk `ja596c68`, strings at ~L582990; record L503077 | **[NOT-BUILT]** |
| **`/import`** | **"Import to Claude Code"** (from codex/gemini) | chunk `n4kv9fhw` L640106-640712; record L502806 | **[NOT-BUILT]** |
| **`/workflows`** | **"Dynamic workflows"** | chunk `gxbe8zn8` L548820-549575; record L826977 | **[NOT-BUILT]** |
| **`/goal`** | **"Goal"** | chunk `6facckkh` L140154-140472; record L854648 | **[NOT-BUILT]** |
| **`/install-github-app`**, `/setup-bedrock`, `/setup-vertex`, `/terminal-setup`, `/auto-mode-setup`, `/web-setup`, `/login`, `/logout`, `/upgrade`, `/usage-credits`, `/feedback`, `/bug`, `/teleport`, `/session`, `/remote-env`, `/remote-control`, `/privacy-settings`, `/scroll-speed`, `/loops`, `/passes`, `/powerup`, `/wellbeing`, `/chrome`, `/desktop`, `/cloud-plugins`, `/ultrareview`, `/autofix-pr`, `/btw`, `/fork`, `/copy`, `/cd`, `/exit`, `/tui`, `/output-style`, `/vim`, `/fast` | Setup wizards, account/cloud flows, and one-shot pickers. `/install-github-app` alone is a full 8-screen wizard (L604423-606468). `/output-style` and `/vim` are now stubs that say "moved to /config" (L502750-502754). | records L501572-504400 | **[NOT-BUILT]** / not applicable — these depend on Anthropic-hosted product surfaces, cloud sessions, or auth we do not have. `/tui` `/copy` `/exit` `/output-style` exist in ours as non-interactive equivalents. |

### 2.3 The MISREAD

| Command | Owner's premise | What's actually there | Canon cite | Our status |
|---|---|---|---|---|
| **`/compact`** | "loads a slash command menu bar" | **False.** `/compact` is `type: "local"` — no `local-jsx` record, not in the `oj` dialog table, `requires` resolves to `{workspace:true, ink:false}`. Its whole implementation is an async function that runs summarization and returns `{type:"text", value}` (or `{type:"text", value, level:"error"}` on `too_few_groups` / `exhausted`). It streams `compact_progress` / `sdk_status:"compacting"` events into the transcript — that in-transcript progress is the only UI, and it is not a menu. It accepts `<optional custom summarization instructions>` as a plain argument. | record L502735; implementation chunk `gxg1d6px` L549576-549943 (entry `var H = async (s, e) => {…}` L549577) | **[MISREAD]** — and ours already matches canon's real behavior: `commands.ts:36` → `useChat.ts:2245` awaits `session.compact()` and prints `formatCompact` (`commands.ts:257`). The one real gap is that ours ignores a custom-instructions argument. **The menu the owner is likely thinking of is `/autocompact`** ("Auto-compact window", §2.2), which we do not have. |

---

## 3. The shared infrastructure — this is the build target

Canon does **not** hand-roll each menu. There is a five-piece stack, and every dialog in §2 sits on it.

### 3.1 `chunk-5avc135e.js` (L122630-122760) — the tab framework

| Symbol | Line | Role |
|---|---|---|
| `Pg` | **L122645** | `<Tabs>` — the shell. Props: `title, color, defaultTab, children, hidden, useFullWidth, selectedTab, onTabChange, banner, disableNavigation, initialHeaderFocused, contentHeight, navFromContent`. Derives the tab list from `children.map(n => [n.props.id ?? n.props.title, n.props.title])`. Supports **both** uncontrolled (`defaultTab` + internal index) and controlled (`selectedTab` + `onTabChange`) modes. Publishes `{selectedTab, width, headerFocused, focusHeader, blurHeader, registerOptIn}` on a context. |
| `pnt` | **L122703** | The tab chip. Current + header-focused + a `color` → a **filled badge** (`Dc`: background = color, bold, padded). Current otherwise → **`inverse` + `bold`**. Every chip is `" " + title + " "`. Mouse: clickable, underlines on hover. Strip is `flexDirection:"row"` with `gap:1`. |
| `Zi` | **L122728** | `<Tab title id>` — the pane. Returns `null` unless `selectedTab === (id ?? title)`. **This is the piece we skipped.** |
| `tke` | L122740 | `useTabWidth()`. |
| `Sf` | L122744 | `useTabHeaderFocus()` → `{headerFocused, focusHeader, blurHeader}`, plus `registerOptIn` so a body can declare "I want the down-arrow". |

Focus model worth copying: the header and the body are separate focus zones. `↓` moves focus from the tab
strip into the body (only if some child called `registerOptIn`); `↑` in the body returns to the strip.
`navFromContent` lets `tab`/`shift+tab` still switch tabs while the body has focus.

### 3.2 `chunk-hxc8nms1.js` (L568777-569034) — the dialog frame

| Symbol | Line | Role |
|---|---|---|
| `fo` | **L568796** | The panel chrome: a colored horizontal rule + `paddingX: 2` column (`paddingX: 1` in fullscreen). Pure visual. |
| `me` | **L568952** | The dialog frame. Props: `title, titleEnd, subtitle, children, onCancel, color, hideInputGuide, hideBorder, inputGuide, isCancelActive, onInterrupt`. Renders bold colored `title` with an optional dim right-aligned `titleEnd` (`wrap:"truncate-start"`), dim `subtitle`, the body, and an **auto keyhint bar**. Binds `confirm:no → onCancel`. Handles double-`^C` ("Press ^C again to exit"). Claims a `"Confirmation"` focus scope. Wraps itself in `fo`. |
| `Ye` | **L568825** | The **action → hint-description registry** — `confirm:yes`→"confirm", `confirm:no`→"cancel", `select:accept`→"select", `tabs:next`/`tabs:previous`→"switch tab", etc. Also handles `"command:<text>"` pseudo-actions. |
| `Z` | **L568835** | The keyhint bar: subscribes to the focus manager and the key-scope registry, and renders **only the hints currently reachable** from the focused element, capped at 4 and bounded by a `boundary` ref. |

### 3.3 The keymap table (L717586) — the vocabulary

One array declares every scope and its bindings. The scopes that matter here:

```
Tabs          tab→tabs:next  shift+tab→tabs:previous  right→tabs:next  left→tabs:previous
Select        up/down/j/k/ctrl+n/ctrl+p → select:next|previous · pageup/pagedown · home/end
              enter→select:accept  escape→select:cancel
Settings      escape→confirm:no · up/down/k/j/ctrl+p/ctrl+n → select · space,enter→select:accept
              /→settings:search  r→settings:retry  d→settings:periodDay  w→settings:periodWeek
              t→settings:sortByTokens  ctrl+u/ctrl+d→scroll:halfPageUp|Down
Confirmation  y/n/enter/escape/up/down/tab/space/shift+tab/ctrl+e
Plugin        space→plugin:toggle  i→plugin:install  f→plugin:favorite
DiffDialog    escape/left/right/up/down/enter/j/k/page/g/G/home/end
ModelPicker   left/right→effort  s→thisSessionOnly
ThemePicker   ctrl+t→toggleSyntaxHighlighting  ctrl+e→editCustom
```

Human-readable scope descriptions are at **L717590** (e.g. `Tabs: "When tab navigation is active"`,
`Select: "When a select/list component is focused"`).

### 3.4 Two navigation idioms, not one

The nine `Pg` dialogs are the *tabbed* idiom. `/mcp`, `/plugin`'s non-tab branches, `/hooks`, and
`/install-github-app` use the **view-stack** idiom instead: a `viewState` discriminated union plus a
`switch (state.type)` router; each leaf gets its own `onCancel` that pushes back to the parent state
(`/mcp` router at L582270-582362, states `list | server-menu | server-tools | server-tool-detail |
agent-server-menu`). The two compose freely — `/plugin` is a `Pg` for the five main tabs and a view-stack
for `validate`/`eval`/`tag`/`add-marketplace`.

### 3.5 What we have of this

| Canon piece | Ours |
|---|---|
| `Pg` shell (title + strip + panes + focus zones) | **Strip only.** `select/Tabs.tsx:42` is a faithful transcription of the *header row* (chip padding, `inverse`+`bold`, `gap:1`, badge-when-colored, modular cycling). `select/Tabs.tsx:5-7` records that the pane half (canon's `Zi`) was **deliberately not built**. |
| `Zi` pane | **Absent.** Each tabbed dialog switches its own body on the active tab. |
| `Sf` header/body focus split | **Absent.** Ours has no header-focus concept (recorded as a divergence in `SettingsDialog`). |
| `me` dialog frame | **Partial.** `dialogs/DialogFrame.tsx` is chrome only: a round border with left/right/bottom disabled (so: one horizontal rule) plus a title header, taking a role color. No subtitle, no `titleEnd`, no keyhint bar, no `onCancel` binding, no `^C` handling, no focus scope. |
| `Ye` action→description registry + `Z` auto keyhint bar | **Absent.** Each dialog writes its own footer string. |
| Keymap table & scopes | **Present and aligned.** `keys/bindings.ts:408` binds the `Tabs` context; action names registered at `:439`; `ModelPicker` and other scopes exist. |
| `type` discriminator on command records | **Absent.** `CommandRow` is `{name, summary, aliases?}` (`commands.ts:32`). `COMMANDS` (`commands.ts:34-106`) is a display/completion catalog only; behavior lives in a hand-written `switch (name)` at `useChat.ts:2200-2584`. |
| `oj` dialog-resolution table | **Absent.** Dialogs mount through `overlayChain`, a nested ternary at `ChatApp.tsx:1744-1919`, in fixed precedence. Each dialog needs its own state field on `useChat`, its own opener, and its own arm in the chain — **three files per dialog**. Exactly one overlay can be open. Sub-dialog handoff is *positional* (SettingsDialog reaches ModelPicker by relying on ModelPicker sitting above it in the chain, `ChatApp.tsx:1841-1848`). |

---

## 4. Recommended scope cut for one round

The trap here is treating this as "add N menus". The inventory says otherwise: **the menus are cheap once
the shell exists, and expensive one-at-a-time.** Three of our dialogs already hand-roll the same
boilerplate (`TABS` const → `TAB_SPECS = TABS.map(...)` → caller-held active tab → body switch), duplicated
near-verbatim at `SettingsDialog.tsx:73-75` and `PermissionsDialog.tsx:61-63`. A fourth tabbed surface
triplicates it. So the shell comes first, and it pays for itself inside the same round.

### Build (highest parity value)

1. **Finish the tabbed-dialog shell.** Add the pane half (canon `Zi`, L122728) and lift the frame into a
   real `me` equivalent (L568952): title + subtitle + `titleEnd` + auto keyhint bar + `Esc → onCancel` +
   focus scope. Then migrate `SettingsDialog`, `PermissionsDialog`, `HelpDialog` onto it. This is the one
   item that is strictly load-bearing for everything else, and it deletes duplication rather than adding it.
   *Defer within this:* the header/body focus split (`Sf`) and `navFromContent`. They are real canon
   behavior but nothing we ship needs them yet, and they are the fiddliest part.
2. **The `/mcp` browser.** Highest single-command value. It is the most-used canon menu we lack entirely,
   the data is already in our session (we print it as text today, `commands.ts:464`), and it exercises the
   *second* idiom — the view-stack router — which `/plugin` and `/hooks` will both reuse. Scope it to
   `list → server-menu → server-tools → server-tool-detail`; skip the `agent-server-menu` and OAuth
   branches.
3. **Route `/status`, `/usage`, `/cost`, `/stats` into `SettingsDialog` on the right tab.** Near-zero cost —
   the tabs already exist and are already populated; only the command arms in `useChat.ts` need to open the
   dialog with a `defaultTab` instead of printing. This alone converts four commands from text to menu and
   is the most direct answer to the owner's observation. Keep the text form reachable, mirroring canon's
   `local` twin (L503073/L503075) — that is exactly what canon does for headless.
4. **`/permissions` → add the missing "Auto mode" tab** and align tab order with canon
   (Workspace · Allow · Ask · Deny · Recently denied · Auto mode). Small, and closes a named gap.

### Defer (next round, with reasons)

- **`/plugin`** — genuinely 5 tabs plus 6 view-stack sub-screens plus its own key scope
  (`plugin:toggle`/`install`/`favorite`) plus a marketplace model we do not have. It is a round of its own,
  and it should follow the `/mcp` router so the idiom is proven first.
- **`/hooks`** and **`/skills`** — both are single-list-plus-detail, both cheap *once* the shell lands.
  Ideal round-2 filler. `/skills`' 4-state in-place toggle (`on`/`name-only`/`user-only`/`off`) is a nice
  self-contained pattern.
- **`/context` interactive grid** — worth doing, but note it is *not* a modal in canon (§1.4): it is a
  static render posted as a system message. So it is a rich-output task, not a menu task, and it belongs
  with transcript rendering rather than with this round.
- **`/diff` dialog** — high value but large: per-turn tabs plus a full `DiffDialog` key scope plus
  file-list navigation. Our diff rendering exists; wiring it into a dialog is a round of its own.
- **`/autocompact`, `/memory`, `/export` method picker, `/ide`, `/sandbox`, `/artifacts`,
  `/release-notes`, `/import`** — small each, low individual value. Batch them later.
- **`/daemon`, `/mobile`, and the whole cloud/account/setup family** — out of reach or out of scope; they
  depend on Anthropic-hosted surfaces. Do not spend round budget here.

### Structural note for the designer (R2)

The three-files-per-dialog cost (`ChatApp.tsx` ternary chain + `useChat` state field + opener) is the real
tax on this round, and it compounds with every menu added. Canon pays it once with `oj` (L144758) — a
name → component table plus a `type` discriminator on the command record (`commands.ts:32` is where ours
would go). Whether to introduce that indirection now is a design call, not a research one, but the
inventory is unambiguous that the current shape does not scale to the surfaces above: `/mcp` alone would
add a fourth hand-wired overlay, and `/plugin` a fifth.

---

## Appendix — canon cite index

| Thing | Line |
|---|---|
| Command declaration block | L501572-504400 |
| `a_r` — type → `{workspace, ink}` | L168893 |
| `Rbe` — `local-jsx` → `local` twin resolver | L76575 |
| `local-jsx` headless bail | L76551 |
| `case "local-jsx"` execution + `onDone` contract | L76555-76590 |
| `oj` dialog-resolution table (74 entries) | **L144758** |
| `_b` — resolve a command's dialog loader | L144762 |
| `Pg` tab shell | **L122645** |
| `pnt` tab chip | L122703 |
| `Zi` tab pane | **L122728** |
| `Sf` header-focus hook | L122744 |
| `fo` panel chrome | L568796 |
| `Ye` action→hint registry | L568825 |
| `Z` auto keyhint bar | L568835 |
| `me` dialog frame | **L568952** |
| Keymap table (all scopes) | **L717586** |
| Key-scope descriptions | L717590 |
| `Pg` instantiations (9) | L208352, L281099, L324528, L351679, L668581, L762166, L762732, L820275, L829960 |
| `/status` entry chunk | L593644 / call L594062 |
| `gq` Settings/Status/Usage/Stats dialog | L762665-762738 |
| `/mcp` chunk + view router | L581310-582561 / L582270 |
| `/plugin` root component | L281025 |
| `/compact` record + implementation | L502735 / L549576 |
| `/context` static-render chunk | L847883-848613 |
| `/agents` — removed in 2.1.251 | L503921-503924 |

---

## CORRECTION (2026-08-31, adopted from the codex plan review, verified against the bundle)

§2.1's `/permissions` row misstates canon's tab order. The `Pg` children array at
cli.pretty.js:829914-829960 is `[recent, allow, ask, deny, ...automode?, workspace]` — i.e.
**Recently denied · Allow · Ask · Deny · Auto mode · Workspace** (Auto mode conditional on
`isAutoModeAvailable !== false`). Our existing five tabs therefore ALREADY match canon's order; the
only gap is the missing Auto mode tab, inserted before Workspace. The "Order also differs from
canon" clause in that row is wrong; the recommended reorder in §4 item 4 is withdrawn (spec D12).
