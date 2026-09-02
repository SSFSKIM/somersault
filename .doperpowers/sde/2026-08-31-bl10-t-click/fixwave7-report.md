# bl10 fix wave 7 report — three recurring defect classes, closed everywhere they exist

## Status
Done, including the coordinator's follow-up (McpToolInfo identity/display split). Four commits on
`main`, no `Co-Authored-By`, explicit-path staging only in a shared checkout that had unrelated
concurrent work (`reforge/strangle/modules/mode-transition/sabotage.js`, plus other `W6/C9-fix`
commits landing interleaved with mine) — none of that was touched or included.

## Commits
- `f24d8a536` — W7-1: keyhint bars track live input state (Config search + Permissions loading)
- `90acd9036` — W7-2: no unbounded string reaches a dialog frame
- `d29f6c1e0` — W7-3: MCP server identity is the raw name; flattening is display-only
- `2cf36b16d` — W7-3 follow-up: MCP tool identity is the raw name too

---

## W7-1 — Hint bars must reflect the active input state

### The cited finding
`SettingsDialog.tsx` (~:547-548): while the Config tab's `/` query is open, `Select` is unmounted
and `Tabs` is `disableNavigation`'d, but `hintProps` still derived from the full `Settings`+`Tabs`
scopes unconditionally for the whole Config tab — the bar kept advertising navigate/select/search
next to the adjacent, TRUE `SEARCH_FOOTER` ("Type to filter · Enter/↓ to select · Esc to clear").

### Red evidence
Added `"drops the stale auto-hint bar while the Config-tab query is open"` to
`test/tui/settings-dialog.test.tsx`. Before the fix, the frame showed both lines at once:
```
Type to filter · Enter/↓ to select · Esc to clear
Esc cancel · ↑ navigate · Space select · / search
```
The new assertions (`not.toContain("navigate")`, `not.toContain("cancel")`) failed exactly as
predicted — `navigate` and `cancel` are the first two hints `Settings`' own binding table produces
in declaration order, so they win the 4-hint cap and print regardless of `Tabs`.

### The fix
Mirrored `HelpDialog`'s own search arm (the wave's cited precedent): a `searching` flag
(`activeTab === "Config" && search !== null`) selects between three mutually-exclusive prop sets —
searching gets `hintActions: []` (no `hintScope`, so nothing is walked at all and the bar renders
nothing, matching `DialogFrame`'s `hints.length > 0` gate), browsing Config keeps the full derived
`hintScope`, and a read-only tab keeps its existing `confirm:no`-only set.

### Sweep — every `hintScope`/`hintActions` usage in `src/tui/`
Enumerated all four sites that pass either prop to `DialogFrame` (the only DialogFrame consumers
using the auto keyhint bar; every other `DialogFrame` caller in `src/tui/` — `BgTasksPanel`,
`EffortDialog`, `ModelPicker`, `ModelSwitchConfirm`, `PlanDialog` — uses its own hand-written
footer and passes neither prop, so they are out of this bar's surface entirely):

| Site | Verdict |
|---|---|
| `HelpDialog.tsx` | **Already correct** — this fix's own precedent (mutually-exclusive `hintActions: []` vs `hintScope` on `search !== null`). No change. |
| `SettingsDialog.tsx` | **Cited defect** — fixed above. |
| `PermissionsDialog.tsx` | **One additional live site found and fixed** (below). |
| `McpDialog.tsx` | **Already correct** — `count` (used to gate `mcpHintActions`) is derived from the real `listRows`/`currentServer` state in every view, including the `servers === undefined` loading state (an empty `listRows` yields `serverCount === 0`), so `count` is already 0 whenever there is nothing live to navigate/select. No change. |

**What the sweep caught in PermissionsDialog**: `hintActions` (built above `body`) named the fixed
cancel/navigate/select/switch-tab set unconditionally on Allow/Ask/Deny/Workspace, with no regard
for `loading` (`settings`/`dirs` still `undefined`, right after mount before the fetch resolves) —
the state where the body renders `Loading…` and no `Select` is mounted at all (`useSelectKeys`'s
own `useKeyScope("Select")` never fires there). Red evidence: added
`"advertises only cancel + switch tab while the fetch is still pending"` to
`test/tui/permissions-dialog.test.tsx` (a `fetchSettings` that never resolves); before the fix the
frame showed `Esc cancel · ↑ navigate · ⏎ select · Tab switch tab` next to `Loading…`. Fixed by
gating `hintActions` on `loading`: `[confirm:no, tabs:next]` while loading, the existing
focus-derived set once it resolves.

### Test output
`npx vitest run test/tui/settings-dialog.test.tsx test/tui/permissions-dialog.test.tsx`:
```
✓ test/tui/settings-dialog.test.tsx (23 tests)
✓ test/tui/permissions-dialog.test.tsx (42 tests)
```
`npm run typecheck`: clean.

---

## W7-2 — No unbounded string may reach a dialog frame

### The cited finding
`McpDialog.tsx` (~:171-174): the fetch-error path rendered the raw `Error.message` with no
width/row bounding — a long or multiline message could push the frame past `rows`.

### Red evidence
Added a `describe("McpDialog — fetch-error text flattens and truncates")` block to
`test/tui/mcp-dialog.test.tsx` (the same "control" height-comparison pattern the file's own fw5
heading tests use: a short and a long/newline-carrying value must produce the identical total
frame height once bounded). All three new tests failed before the fix — e.g. a 2000-character
error produced 25 lines against a 5-line short-message control; a `\n`-carrying message produced 6
lines against a 5-line flattened control; a 500+500-char two-line error produced 16 lines against
a `rows={14}` ceiling.

### The fix
`flattenLabel(fetchError)` (imported from `mcpDialogModel.js`) then `truncateLabel(...)` to the row's
own budget (`columns - 2`, the same inset every other bare heading in this file clips to) —
"flatten, then clip," exactly as the finding specified.

### Sweep — `McpDialog.tsx`, `SettingsDialog.tsx`, `PermissionsDialog.tsx`, `HelpDialog.tsx`,
`DialogFrame.tsx` (title/subtitle/titleEnd included), for any other dynamic non-literal string
reaching a frame with no width-or-row bound

**`DialogFrame.tsx`**: checked directly. `title` has no bound of its own in `DialogHeader`, and
`subtitle`'s only protection is Ink's `wrap="truncate-start"` (which — like every `wrap`/`cliTruncate`
path — does not protect against an embedded literal newline, since `stringWidth` treats `\n` as
zero-width). Audited every caller of `DialogFrame`'s `title`/`subtitle`/`titleEnd` in the four named
dialogs: every one passes either a compile-time string literal (`"Settings"`, `"Permissions"`,
`"Help"`, `MCP_TITLE`) or a value built from a plain count (`mcpSubtitle(serverCount)`, numeric only).
**No change needed** — but this is a real gap in `DialogFrame.tsx` itself if a future caller ever
passes a live string through `title`/`subtitle`/`titleEnd`; noted below.

**Found and fixed** (four additional sites, all genuinely reachable — none are hypothetical):

1. **`SettingsDialog.tsx` + `HelpDialog.tsx`** — identical gap in both: the `/` query's own echoed
   input line (`{search.length ? <Text>{search}</Text> : ...}`) and its "No X match" message both
   embedded the raw, user-typed `search` string with no width bound. Fixed with `clipRowText`
   (`SettingsDialog` already imports it for `RowBody`; added to `HelpDialog`). Red evidence: a
   100-character non-matching query produced 11 lines vs. a 9-line short-query control in
   `SettingsDialog`, 15 vs. 13 in `HelpDialog`.
2. **`HelpDialog.tsx`** — the manual (non-`Select`) search-result render's `label` (`/${c.name}`)
   had no clip of its own, unlike the `Select`-driven browsing list (whose two-column layout already
   truncates via `labelColumnWidth`). A live catalog's command name is not a compile-time literal.
   Fixed at the `browserOptions` source (both `label` and `description` now go through `clipRowText`
   there), so both render paths share one clip. Red evidence: a 200-character command name produced
   15 lines vs. a 13-line short-name control.
3. **`PermissionsDialog.tsx`** — four of its six raw sub-view boxes (`addRuleText`, `addRuleDest`,
   `deleteConfirm`, `ruleDetails`, `removeDirConfirm` — these are NOT routed through `DialogFrame`
   at all, but they are inside the swept file) embedded a dynamic string with no bound:
   - `selectedRule.rule` (a settings-file rule string) in `deleteConfirm` and `ruleDetails`
   - `SOURCE_LABELS[...] ?? selectedRule.source` (an unrecognized provenance string falls back to
     the raw value — `permissionsModel.ts` types `source: string`, not an enum) in `ruleDetails`
   - `selectedDir` (a workspace path) in `removeDirConfirm`
   - the live-typed `ruleText` echo in `addRuleText`
   - `o.desc(cwd)` (the launch cwd interpolated into a destination description) in `addRuleDest`

   Fixed with a shared `subViewWidth` (the same `PERMISSIONS_FRAME_INSET` chrome these boxes
   actually spend — `borderStyle="round"` + `paddingX={1}`) and `clipRowText` at each site. One
   off-by-one surfaced and was fixed during this: the `addRuleText` echo row also carries an
   inverse-video cursor block right after the text, costing one more column than the plain width
   budget accounted for — the echo now clips to `subViewWidth - 1`. Red evidence: four new tests
   in a `describe("PermissionsDialog — sub-view confirms bound their dynamic strings")` block, all
   using the same short/long height-comparison control; all four failed before the fix (9 vs 6, 15
   vs 9, 10 vs 7, 11 vs 8 — the last one still failing at 9 vs 8 after the first pass, until the
   off-by-one above was found and fixed).

### Test output
`npx vitest run test/tui/mcp-dialog.test.tsx test/tui/settings-dialog.test.tsx test/tui/help-dialog.test.tsx test/tui/permissions-dialog.test.tsx`:
```
✓ test/tui/permissions-dialog.test.tsx (42 tests)
✓ test/tui/mcp-dialog.test.tsx (31 tests)
✓ test/tui/settings-dialog.test.tsx (23 tests)
✓ test/tui/help-dialog.test.tsx (16 tests)
```
`npm run typecheck`: clean.

---

## W7-3 — Identity must be the raw name; flattening is display-only (wave-5 regression)

### The finding
`mcpDialogModel.ts`'s `normalizeMcpServers` (~:63-65 at brief time) applied `flattenLabel` to
`name` itself, but `name` is the row's identity — React keys (`key={r.server.name}`), `findServer`
lookups, the view stack's `server` field (`enterServerMenu`/`enterServerTools`/`enterToolDetail`).
Two configured servers whose names differed only in whitespace/newlines collapsed to one identity;
selecting the second row's server-menu resolved the first server's details (`Array.prototype.find`
returns the first match).

Note: this finding's own brief did not carry a "THEN SWEEP" clause the way W7-1/W7-2 did, so the
scope below was originally just what was asked — the server identity/display split. The coordinator
subsequently accepted the `McpToolInfo.name` analog (flagged in this report's own Concerns) as
in-scope for this wave; see the follow-up section below.

### Red evidence
Two layers, both genuinely red before the fix (verified by a temporary revert-and-rerun, not just
inference):
1. **Model layer** (`test/tui/mcpDialogModel.test.ts`): a new test feeding `["foo", "foo "]`
   through `normalizeMcpServers` — before the fix both rows normalized to `name: "foo"` (5 of 5 new/
   updated assertions failed, including the two migrated wave-5 exact-shape tests whose `.name`
   assertions expected the RAW value and got the flattened one instead).
2. **Render layer** (`test/tui/mcp-dialog.test.tsx`): a new test through the real
   `normalizeMcpServers` entry point with two servers `{name:"foo", url:".../foo-a"}` and
   `{name:"foo ", url:".../foo-b"}` — selecting the root list's second row and opening its
   server-menu. Before the fix (confirmed by temporarily reverting `name: e.name` back to
   `name: flattenLabel(e.name)` and rerunning just this test) the frame showed `foo-a`'s URL, not
   `foo-b`'s — the exact regression. Reverted back immediately after confirming red.

### The fix
Added `label: string` to `McpServerRow` (flattened, display-only) alongside the now-raw `name`.
`normalizeMcpServers` sets `name: e.name` (raw) and `label: flattenLabel(e.name)`. Updated
`McpDialog.tsx`'s four DISPLAY sites to read `.label`: `ServerLabel` (root list), the server-menu
heading, the server-tools heading, the tool-detail server line. Every IDENTITY use — the root
list's React key, `enterServerMenu`/`enterServerTools`/`enterToolDetail`, `findServer` — still
reads `.name`, unchanged. Non-identity fields (`description`, `error`, `url`, `command`, etc.) and
`McpToolInfo.name`/description are unaffected, matching the finding's own scope.

### Migrating the wave-5 tests (must stay green via `label`, per the brief)
The two wave-5 "flattens embedded newlines" tests in `mcpDialogModel.test.ts` previously asserted
the flattened value on `.name`; migrated to assert the RAW value on `.name` and the flattened value
on the new `.label` — the exact instruction the brief gave. The corresponding render-layer fw5
tests in `mcp-dialog.test.tsx` (over-wide/newline-carrying server-menu and server-tools headings)
needed **no test-file changes at all**: they only assert total frame HEIGHT, and once
`McpDialog.tsx`'s headings read `.label` (still flattened) instead of `.name`, they passed
unmodified — confirming the display behavior those tests pin is genuinely unchanged.

Every other hand-built `McpServerRow` fixture across `mcp-dialog.test.tsx`, `mcp-wiring.test.tsx`
and `mcpDialogModel.test.ts`'s own `row()` helper needed a `label` field added (TypeScript now
requires it) — all typecheck errors from the interface change, fixed by adding
`label: <same value as name>` (none of those fixture names carry whitespace, so raw === flattened
there; none of those tests read `.label`, so the exact value doesn't matter beyond satisfying the
type).

### Test output
`npx vitest run test/tui/mcp-dialog.test.tsx test/tui/mcpDialogModel.test.ts test/tui/mcp-wiring.test.tsx`:
```
✓ test/tui/mcp-dialog.test.tsx (32 tests)
✓ test/tui/mcpDialogModel.test.ts (30 tests)
✓ test/tui/mcp-wiring.test.tsx (6 tests)
```
`npm run typecheck`: clean.

---

## W7-3 follow-up — the same regression class, for `McpToolInfo` (coordinator-accepted)

### The finding
The Concerns section below (as it read after the initial three findings) flagged that
`normalizeTool` applied `flattenLabel` to tool `name` itself — the identical wave-5 regression
class W7-3 fixed for `McpServerRow`, but for a tool's identity WITHIN its server: React keys (the
tools-list `Row`), `toolFocus` index lookups, `enterToolDetail`'s `tool` argument and the view
stack's `tool` field, `findTool`-style lookups (`currentServer.tools.find((t) => t.name === view.tool)`
in the tool-detail view). The coordinator accepted this as in-scope for this wave.

### Red evidence
Same two-layer verification as W7-3 itself, both genuinely red before the fix (confirmed by a
temporary revert-and-rerun of `normalizeTool`'s `name` field, not just inference):
1. **Model layer** (`test/tui/mcpDialogModel.test.ts`): a new test feeding one server with tools
   `["foo", "foo "]` through `normalizeMcpServers` — before the fix both tools normalized to
   `name: "foo"` (2 of 2 new/updated assertions failed: the distinct-identity test, and the
   migrated wave-5 exact-shape test whose tool `.name` assertion expected the RAW `"tool\nname"`
   and got the flattened `"tool name"` instead).
2. **Render layer** (`test/tui/mcp-dialog.test.tsx`): a new test through the real
   `normalizeMcpServers`/`normalizeTool` entry point — one server `"srv"` with two tools
   `{name:"foo", description:"tool A description"}` and `{name:"foo ", description:"tool B
   description"}` — drilling into the server-menu, then server-tools, moving the cursor to the
   second tool, and opening its detail. Before the fix (confirmed by temporarily reverting
   `normalizeTool`'s `name: t.name` back to `name: flattenLabel(t.name)` and rerunning just this
   test) the frame showed "tool A description", not "tool B description" — the exact regression.
   Reverted back immediately after confirming red.

### The fix
Added `label: string` to `McpToolInfo` (flattened, display-only) alongside the now-raw `name`.
`normalizeTool` sets `name: t.name` (raw) and `label: flattenLabel(t.name)`. Updated
`McpDialog.tsx`'s two tool DISPLAY sites to read `.label`: `ToolLabel` (the tools-list row) and the
tool-detail heading's `<Text bold>{truncateLabel(tool.label, detailWidth)}</Text>` line. Every
IDENTITY use — the tools-list `Row`'s React key, `enterToolDetail`'s tool argument, the tool-detail
lookup's `t.name === view.tool` match — still reads `.name`, unchanged. `tool.description` and
`annotations` were never at risk (already flattened/derived-only) and are unaffected.

### Migrating the existing tests
The wave-5 "flattens embedded newlines" model test's tool assertion (which had a tool named
`"tool\nname"` alongside the server) was migrated the same way its server counterpart was: `.name`
now pins the raw `"tool\nname"`, a new `.label` assertion pins the flattened `"tool name"`. The
render-layer RF2 test (multiline tool DESCRIPTION, not name) needed no changes — descriptions were
never part of the identity/display split. Every hand-built `McpToolInfo`/`McpServerRow.tools`
fixture across both test files needed a `label` field added for the interface change (mechanical,
found via `tsc --noEmit`'s error list, same process as the server-side migration) — all set equal
to `name` since none of those fixture names carry whitespace.

### Test output
`npx vitest run test/tui/mcp-dialog.test.tsx test/tui/mcpDialogModel.test.ts test/tui/mcp-wiring.test.tsx`:
```
✓ test/tui/mcp-dialog.test.tsx (33 tests)
✓ test/tui/mcpDialogModel.test.ts (31 tests)
✓ test/tui/mcp-wiring.test.tsx (6 tests)
```
`npm run typecheck`: clean.

---

## Final verification (after the follow-up)

`npm run typecheck`: clean, no errors.

Full `npx vitest run test/tui/`:
```
Test Files  201 passed | 10 skipped (211)
     Tests  5090 passed | 11 skipped (5101)
Duration    175.92s
exited with code 0
```
(the 10 skipped files / 11 skipped tests are the pre-existing gated live/`e2e`/bench suites that
skip without a live API key — unrelated to this wave; 5090 vs. fixwave6's 5074 baseline reflects
the ~16 new tests this wave added across the five touched test files, plus 2 from the follow-up.)

## Files touched
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/SettingsDialog.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/PermissionsDialog.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/McpDialog.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/HelpDialog.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/mcpDialogModel.ts`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/settings-dialog.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/permissions-dialog.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/mcp-dialog.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/help-dialog.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/mcpDialogModel.test.ts`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/mcp-wiring.test.tsx`

Not touched: `reforge/`, `ptc-surface/`, `src/appserver/`, `harness/scripts/`, per the brief.
Staged explicitly by path in each of the four commits — the shared checkout had unrelated
concurrent changes (`reforge/strangle/modules/mode-transition/sabotage.js`, plus several `W6/C9-fix`
commits from other work landing on `main` interleaved with these) that were never staged or
included.

## Concerns
1. ~~`McpToolInfo.name` has the identical latent pattern...~~ **Resolved** by the W7-3 follow-up
   above (`2cf36b16d`), accepted by the coordinator as in-scope for this wave.
2. **`DialogFrame.tsx`'s `title`/`subtitle`/`titleEnd` have no bound of their own** — every current
   caller in the four swept dialogs happens to pass a safe value (literal or count-only), so this
   is not a live bug today, but the frame itself doesn't enforce it. A future dialog that threads a
   live string through one of these props would reproduce W7-2's class at the frame level rather
   than a body level. Left as-is per the coordinator's direction (logged as debt on their side,
   not fixed here) — flagged for whoever adds the next dynamic-title dialog.
