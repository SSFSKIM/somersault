# bl10 fix wave 8 report — final wave: scrollable read-only Settings tabs + two small route fixes

## Status
Done. Three commits on `main`, no `Co-Authored-By`, explicit-path staging only (shared checkout —
`git add -A` never used; the pre-existing modified `../reforge/attestation/coverage.md` and the
untracked `.doperpowers/sde/2026-08-31-bl10-t-click/fixwave{6,7}-*.md` files were left alone
throughout).

## Commits
- `7b53de049` — W8-2: `/status` opens the Settings dialog before awaiting `refreshCtx`
- `b6f19efd2` — W8-3: dismissal notice names the dialog the user actually saw
- `0b2e56076` — W8-1: make the Settings read-only tab bodies scrollable

---

## W8-2 — `/status` opened the dialog only after the context re-measure resolved

### The cited finding
`useChat.ts`'s `case "status"` (~:2265-2284) ran `await refreshCtx()` THEN `openSettings("Status")`.
Local commands dispatch fire-and-forget, so a slow `getContextUsage()` left the composer live for as
long as the read took; if the user opened another overlay in that window, the delayed continuation
then stacked Settings on top of it.

### Red evidence
Added `"/status opens the Settings dialog before the context re-measure resolves, and still
refreshes the chip after"` to `test/tui/useChat.test.tsx`, using a `getContextUsage` that returns a
manually-resolvable promise. Before the fix, `waitFor(() => api.state!.settings.open === true &&
... tab === "Status")` never became true — the test failed with `waitFor timeout` (2000ms), because
`openSettings` sat behind the still-pending `await`.

### The fix
Swapped the order: `openSettings("Status")` runs first, `await refreshCtx()` after. Updated the
arm's own comment (it previously justified the pre-dialog `refreshCtx()` call as feeding the dialog
mount; that was never true — `fetchSettingsStatus` always re-measured independently — so the comment
now states the real reason: updating `ctxPct`/the status-line chip, and explains the reordering).

### Test output
```
npx vitest run test/tui/useChat.test.tsx test/tui/status-family-dialog.test.tsx test/tui/chat.test.tsx
✓ test/tui/useChat.test.tsx (188 tests)
✓ test/tui/chat.test.tsx (116 tests)
✓ test/tui/status-family-dialog.test.tsx (8 tests)
```

---

## W8-3 — Dismissal notice always said "Config", even for /status /usage /cost /stats

### The cited finding
`useChat.ts`'s `closeSettings` (~:2965+) hardcoded `"Config dialog dismissed"` for the untouched-close
notice, even when the dialog was opened by `/status`/`/usage`/`/cost`/`/stats` — routes whose dialog
title is "Settings", not "Config".

### Red evidence
Added `"Status: Esc with no changes prints 'Settings dialog dismissed' — not 'Config'"` to
`test/tui/chat.test.tsx` (opens via `/status`, closes untouched). Before the fix the frame showed
"Config dialog dismissed" and the test's `not.toContain("Config dialog dismissed")` failed.

### The fix
`closeSettings` now reads `settings.tab` before clearing it and picks
`dismissedName = settings.tab === "Config" ? "Config" : "Settings"`, used in both notice sites
(`!baseline` and the no-diff branch). The Config route's literal is byte-identical to before; only
the status-family routes changed. "Settings dialog dismissed" is upstream's own literal (noted
verbatim, previously unused, in a `PermissionsDialog.tsx` comment) — not an invented string.

### Side effect found and fixed in the same commit
Four **pre-existing** tests elsewhere used `!frame.includes("Settings")` as their "the dialog closed"
proxy for a status-family route. Since the dialog's own notice now legitimately contains the word
"Settings", that check would never become true post-close — genuinely broken by this fix, not by an
unrelated cause (verified: reverting only this diff made all four pass again). Fixed by switching
each to check for the tab strip's absence (`"Status Config Usage Stats"`) instead, which is what
actually signals the dialog is gone:
- `test/tui/status-family-dialog.test.tsx` (2 sites)
- `test/tui/keys-acceptance.test.tsx` (1 site)
- `test/tui/tui-switch.test.tsx` (1 site)

### Test output
```
npx vitest run test/tui/chat.test.tsx test/tui/keys-acceptance.test.tsx test/tui/status-family-dialog.test.tsx test/tui/tui-switch.test.tsx test/tui/useChat.test.tsx
✓ test/tui/useChat.test.tsx (188 tests)
✓ test/tui/chat.test.tsx (117 tests)
✓ test/tui/tui-switch.test.tsx (22 tests)
✓ test/tui/keys-acceptance.test.tsx (24 tests)
✓ test/tui/status-family-dialog.test.tsx (8 tests)
```

---

## W8-1 (P1) — Make the Settings read-only tab bodies scrollable

### The cited finding
`SettingsDialog.tsx`'s `readOnlyTabBody` (~:520-532 at brief time) clipped fetched lines to the
frame budget with a passive `… +N more lines` marker, always starting at line 0. The killer case:
`fetchSettingsUsage` (`useChat.ts:3112-3114`) returns `[...formatUsage, blank, ...formatCost]`, so on
a short terminal `/cost` could show NONE of its cost/duration/per-model fields — a hard violation of
spec D13's information-equivalence rule.

### Red evidence
Replaced the old wave-2 describe block in `test/tui/settings-dialog.test.tsx` with a new
`"SettingsDialog — read-only tab bodies scroll instead of clipping (bl10 fw8 W8-1)"` suite (6 new
tests). All 6 failed before the fix — e.g. the killer-case test asserted `"Total duration (API)"`
became reachable after driving pagedown, and instead the frame kept showing the static
`"… +36 more lines"` marker regardless of how many pagedowns were sent; the "advertises 'navigate'"
test found no such hint on a tall/overflowing payload because no key was ever wired to move anything.

### The fix
- **`readOnlyScrollWindow`** (new, `SettingsDialog.tsx`): windows the already-fetched `RenderLine[]`
  from an arbitrary line offset instead of always 0. A payload that already fits
  (`total <= plainBudget`) takes the untouched fast path — every line, no markers, byte-identical to
  today's output (this is what keeps the "no-overflow payload renders exactly as today" test green).
  One that doesn't reserves BOTH counted indicator rows unconditionally once scrollable at all — the
  same "+2" idiom `SETTINGS_CHROME_ROWS` and `mcpDialogModel.ts`'s `MCP_LIST_CHROME_ROWS` already use
  — so scrolling from one end of the payload to the other never grows or shrinks how much is on
  screen; only which marker(s) actually render (conditionally, McpDialog's own shape) toggles.
  `maxOffset` is the bottom-anchored start so paging down can't run past the content into blank
  space. Markers are `moreAbove`/`moreBelow` (`select/overflow.ts`) — the same counted `↑ N more
  above` / `↓ N more below` shape the Config list and McpDialog already draw — not the old
  passive-clip `MoreRow`.
- **Scroll state**: one `scrollOffset` (a line index), reset via a `useEffect` keyed on
  `[activeTab, openSeq]` — matching both required triggers (tab change, and a bumped `openSeq` from
  an explicit re-open).
- **Key wiring**: `bindings.ts`'s `Settings` context already binds up/down/k/j/ctrl+p/ctrl+n to
  `select:previous`/`select:next` unconditionally (the comment at SettingsDialog.tsx:606 already
  documented these as dead on read-only tabs, since no `Select` there ever registered a handler) —
  added `pageup`/`pagedown` → `select:pageUp`/`select:pageDown` to that same context (the smaller
  diff: reusing an existing, always-bound-but-dead set of actions rather than pushing a second
  `useSelectKeys`/`Select` scope, which would have needed reconciling with the Config tab's own
  nested `Select` pushing that identical scope name). `SettingsDialog`'s existing `useKeyActions` call
  now also handles these four actions via a `scrollReadOnly(delta)` helper, gated to no-op on the
  Config tab (harmless even without the gate — Config's own nested `Select`, when mounted, registers
  the same actions LATER in render order and wins by the registry's innermost-wins rule — but the
  guard documents the intent and matters for Config's `/` search sub-state). All four handlers stay
  wrapped in the existing `route()` so the Config-tab search box's `j`/`k`/space capture is untouched.
- **Escape**: unchanged — still bound to `confirm:no` → `onDone()`, verified by the pre-existing
  `advertises only cancel + switch tab` test staying green.
- **Keyhint bar**: `hintActions` for a read-only tab now includes `select:previous` ("navigate") only
  when `activeReadOnlyWindow.overflow` is true — the same hint-accuracy rule fix wave 1 established
  for this dialog (no hint for a key that would move nothing).

### Tech-debt-tracker
Deleted the "Settings read-only tabs clip without scrolling" entry from
`docs/parity/tech-debt-tracker.md` — this fix pays it off. No other entries touched.

### Test output
```
npx vitest run test/tui/settings-dialog.test.tsx
✓ test/tui/settings-dialog.test.tsx (29 tests)
```

---

## Final verification

`npm run typecheck`: clean, no errors.

Full `npx vitest run test/tui/` (foreground, 480s timeout, read in the same turn):
```
Test Files  201 passed | 10 skipped (211)
     Tests  5098 passed | 11 skipped (5109)
Duration    178.31s
```
(the 10 skipped files / 11 skipped tests are the pre-existing gated live/e2e/bench suites that skip
without a live API key — unrelated to this wave.)

## Files touched
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/useChat.ts`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/SettingsDialog.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui/keys/bindings.ts`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/useChat.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/chat.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/status-family-dialog.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/keys-acceptance.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/tui-switch.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/test/tui/settings-dialog.test.tsx`
- `/Users/new/Developer/GitHub/somersault/CC-to-SDK/docs/parity/tech-debt-tracker.md`

Not touched: `reforge/`, `ptc-surface/`, `src/appserver/`, `harness/scripts/`,
`src/tui/settingsFile.ts`, per the brief. Staged explicitly by path in each of the three commits.

## Concerns
1. **W8-3's four collateral test fixes are a real, if narrow, coupling**: any future dialog whose
   close notice legitimately contains the word "Settings" (or any test elsewhere still written as
   `!includes("Settings")` against a Settings-family close) would need the same tab-strip-based
   check. Grepped `test/tui/*.tsx` for every `!includes("Settings")`/`not.toContain("Settings")`
   pattern before finishing — all four live occurrences found and fixed; no others exist as of this
   commit.
2. **`select:pageUp`/`select:pageDown` added to the `Settings` binding context are now available on
   the Config tab too**, harmlessly shadowed by the Config list's own nested `Select` (which already
   bound them) whenever that `Select` is mounted — confirmed via the full `settings-dialog.test.tsx`
   suite staying green, including the existing paging tests. No behavior change there; noted since it
   widens the `Settings` context's declared surface slightly beyond the read-only tabs that motivated
   it.
3. **`select:first`/`select:last` (home/end) were deliberately left unbound** on the read-only tabs —
   the brief asked for up/down/pageup/pagedown; a scroll has no natural "jump to line N" affordance
   the way a picker's home/end does. Not logged as debt (not a defect, a scope boundary), but flagged
   here in case a future round wants them.
