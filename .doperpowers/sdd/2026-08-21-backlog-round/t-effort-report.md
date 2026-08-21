# T-EFFORT report — persistence, help/current, Cancelled

Branch: `worktree-agent-a44c9f1979292b8b0`. Commit: (see below, T-EFFORT source + tests).

## What was built

### Arm 1 — persistence

- **`src/tui/modelPickerModel.ts`**: added `PersistableEffortLevel` / `isPersistableEffortLevel` (canon's
  `Qdt`) — the `low|medium|high|xhigh` subset that may persist; `max` is excluded. Also added the two
  description tables canon's help block and current/status line each read from their own table:
  `EFFORT_HELP_DESCRIPTIONS` (canon's `_lT`) and `EFFORT_STATUS_DESCRIPTIONS` (canon's `rCb`) — verbatim
  strings from the research report, five levels each, all five always listed (ccx has no org entitlement
  cap to filter against).
- **`src/tui/prefs.ts`**: `CcxPrefs` gained `effort?: EffortLevel`. `loadPrefs` validates it with
  `isEffortLevel` (shape only, same tier as `theme`/`tui`'s own closed-set guards) — a hand-edited value
  outside the five-level domain is dropped, not coerced.
- **`src/tui/useChat.ts`**: `applyEffort` — the ONE function every level-setting surface (the dialog's
  Enter via `confirmEffort`, a typed `/effort <level>`, and the `/model` picker's effort row via
  `onEffortChange={applyEffort}` in ChatApp.tsx) already funneled through — now writes
  `savePrefsFn({ effort: level }, historyEnv)` behind `isPersistableEffortLevel(level)` after a successful
  `setEffortState`. One write covers all three call sites; nothing was added per-caller. The invalid-level
  branch now calls `formatEffortInvalid(level)` (see Arm 2) instead of a hardcoded string.
- **`src/tui/commands.ts`**: `formatEffortSet(level, persisted)` — the `persisted` boolean is now a
  required parameter (was implicitly always "session only"); the suffix is `" (saved as your default for
  new sessions)"` when true, `" (this session only)"` when false. Its own doc comment and the catalog row's
  divergence comment (lines ~44-67) were rewritten to retire the SCOPE claim and cite 2.1.236 identifiers
  (`T2w`, `k$i`, `_ml`, `wlT`) instead of the stale 2.1.220 ones.
- **`src/cli/main.ts`**: the model-persistence reader at line ~416 was generalized into one
  `const prefs = deps.loadPrefs();` read, reused for both `model` and a new `persistedEffort =
  isPersistableEffortLevel(prefs.effort) ? prefs.effort : undefined` (canon's read-back re-filter, `Qdt`
  applied again on read). `hookOpts.initialEffort` became `foregroundConfig.effort ?? persistedEffort ??
  DEFAULTS.effort` — the flag still wins, a persisted default now outranks the harness default. The
  welcome-banner's own effort clause (line ~519) was deliberately left untouched (flag-only, per the
  existing "EFFORT IS THE FLAG ALONE" rule) — a persisted default is exactly the kind of pre-catalog claim
  that rule exists to keep off the banner.
- **`src/tui/EffortDialog.tsx`**: `EFFORT_SUBTITLE` rewritten from "…This session only." (now false) to
  "…Saved as your default for new sessions (except max)."

### Arm 2 — help / current / status sub-verbs

- **`src/tui/commands.ts`**: added a private `withLocalOutputGutter(lines)` helper — the gutter sits once,
  on the first line, and every non-blank continuation line is padded to the gutter's own width (`"  ⎿  "`
  is 5 characters) instead of repeating the glyph, matching the established `withAssistantBullet`/
  `withThinkingGutter` pattern in `render.ts` (needed because `Line.tsx` renders each `RenderLine`'s
  `gutter` independently — an array where every line carried one would draw a `⎿` per line). A blank
  continuation line stays literally `""`, never padded — this was the first bug my own test caught (see
  Tests below). Built `formatEffortHelp()` (canon's `k$i`, byte-exact for ccx's uncapped/ultracode-off
  case — the only case ccx can be in) and `formatEffortCurrent(effort, defaultEffort)` (canon's `YXn`,
  minus the ultracode and CLI-flag/launch-pin branches ccx has no equivalent for; `effort === undefined`
  — ccx's own "nothing known yet" state, e.g. a bare `ccx attach` — prints through the same "no level set"
  shape canon uses for its explicit `auto` pick, substituting `defaultEffort` for canon's per-model `LK`
  resolution).
- **`src/tui/useChat.ts`**: the dispatch arm's branch order was rewritten to match canon's `T2w`: help
  (`help`/`-h`/`--help`) → current/status (`current`/`status`) → bare (open dialog) → level (apply). The
  old code was `if (cmd.args) { level } else { dialog }`, which would have swallowed `help`/`current`/
  `status` as bogus levels had they been bolted on without reordering.
- **Rider (unticketed, per the brief)**: the invalid-level refusal changed from a plain, error-coloured
  line (`effort: unknown effort level "X" · try low/medium/high/xhigh/max`) to canon's `Invalid argument:
  X. Valid options are: low, medium, high, xhigh, max, auto`, behind the same `⎿` gutter every other
  `/effort` arm now uses (`formatEffortInvalid` in commands.ts).

### Arm 3 — Cancelled

- **`src/tui/useChat.ts`**: split `closeEffortDialog` (unchanged: just closes) from a new
  `cancelEffortDialog` (closes, then appends the single word `Cancelled` behind `LOCAL_OUTPUT_GUTTER`).
  `confirmEffort` still calls only `closeEffortDialog` — the trap the brief named (a naive append inside
  the shared close would print `Cancelled` on every successful Enter too) is avoided by construction: the
  notice-printing code exists in a function `confirmEffort` never calls.
- **`src/tui/ChatApp.tsx`**: `onCancel={closeEffortDialog}` → `onCancel={cancelEffortDialog}` on the
  `<EffortDialog>` mount; `cancelEffortDialog` added to the `useChat` return object and to ChatApp's
  destructure (replacing `closeEffortDialog`, which ChatApp had no other use for).

## Tests and what each kills

**`test/tui/effort.test.tsx`** (54 tests, up from 22):

- `prefs.ts — the effort key's load/save round trip` (3 new tests) — exercises the ACTUAL file loader
  (every other test in the suite injects a mock `loadPrefs`), against an isolated `CCX_FLEET_ROOT` temp
  dir. Dies against a missing/wrong `isEffortLevel` guard in `loadPrefs` (a hand-edited `"ultracode"`
  would otherwise survive the read) and against a non-shallow-merge `savePrefs`.
- `isPersistableEffortLevel` (1 test) — pins the exact five-vs-four-level split.
- `formatEffortHelp` (2 tests) — one asserts canon's exact words (padding stripped via a local `unpad`
  helper so the test is about content, not the alignment mechanism); the other asserts the mechanism
  itself (gutter only on line 0, blank line stays blank, bullets are padded). The FIRST version of the
  content test caught a real bug in my own implementation: `withLocalOutputGutter` was padding the blank
  separator line into five trailing spaces instead of leaving it `""` — fixed, and the fix is what the
  test now pins.
- `formatEffortCurrent` (2 tests) — pins the `rCb`-table line for a set level, and the `defaultEffort`
  fallback for `effort === undefined`. The "distinct tables" assertion had to move from a substring check
  to exact-string equality after I discovered `EFFORT_HELP_DESCRIPTIONS.high` is a near-prefix of
  `EFFORT_STATUS_DESCRIPTIONS.high` — a `toContain` check would have passed even reading the wrong table.
- `formatEffortSet` (2 tests, rewritten) — persisted-suffix vs session-only-suffix, both exact strings.
- `/effort` describe block: rewrote "confirming fires the set_effort wire op" to also assert `r.saves`
  equals `[{effort:"xhigh"}]` and that the frame does NOT contain "Cancelled" (the trap's OTHER half);
  rewrote "Esc fires NO wire op" to also assert `⎿ Cancelled` appears and `r.saves` stays empty; rewrote
  the out-of-domain test for the new `Invalid argument:` string; added a guard test proving `help`/
  `current`/`status` never reach the bogus-level refusal; rewrote the `/effort <level>` result-row test to
  assert the persisted suffix and `r.saves`; added a new `/effort max` test proving `max` applies and
  confirms but writes nothing.
- `a SEEDED effort default on a non-supporting model is suppressed at BOTH reporting surfaces` — the
  brief's explicitly-required verification that no new capability gate was needed: mounts with
  `initialEffort` (indistinguishable, once inside useChat, from a persisted-pref seed) on `haiku`, asserts
  BOTH the hint latch and `/status`'s row stay suppressed.
- `mountApp` itself was changed to ALWAYS inject a fake `savePrefs` (collecting into a returned `saves`
  array) — without this, every pre-existing `/effort`/picker/dialog test in the file would have started
  writing to this machine's real `~/.claude/ccx/prefs.json` the moment `applyEffort` gained its
  persistence write. This was caught before any test run by re-reading the DI seam, not by a failure.

**`test/unit/cli-main.test.ts`** (4 new tests, the WIRING test the brief named): "a saved prefs effort
becomes the launch effort when no --effort was typed" reaches `hookOpts.initialEffort` through the real
`main()` function, not a hand-built object — deleting `persistedEffort` from the `hookOpts` line (verified
live, see below) turns this red. Plus: `--effort` wins over a saved default, a non-persistable saved value
(`"max"`) is ignored and falls through to `DEFAULTS.effort`, and the no-saved-default baseline still
resolves to `"xhigh"`.

**Sabotage verification performed** (temporarily reverted each fix, confirmed the specific test failed,
restored): removing `persistedEffort` from `cli/main.ts`'s `hookOpts` line failed the new cli-main wiring
test; removing the `isPersistableEffortLevel` write-guard in `applyEffort` failed both the "confirming…
persists it" and "prints…PERSISTED suffix" tests; forcing `max` to persist anyway failed the new "`/effort
max`…does NOT persist" test; moving the `Cancelled` append into the shared `closeEffortDialog` (the exact
trap the brief named) failed the "confirming…prints NO 'Cancelled'" test.

## Gates

- `npm run typecheck` — clean.
- `npx vitest run test/tui/effort.test.tsx` + touched files (`test/unit/cli-main.test.ts`,
  `test/tui/model-picker.test.tsx`, `test/tui/keys-bindings.test.ts`, `test/tui/commands.test.ts`,
  `test/unit/statusline.test.ts`, `test/tui/banner.test.ts`, `test/tui/spinner.test.ts`,
  `test/unit/cli-args.test.ts`, `test/unit/config-validate.test.ts`, `test/unit/resolveOptions.test.ts`)
  — 11 files, 526 tests, all passing.
- `npm run test:tui` — 152 files / 3892 tests passed (12 net new vs. the T-COPY baseline run), 9 live/e2e
  files skipped as expected (no API key/token in this worktree).
- `npm run test:unit` — 235 files / 3248 tests passed.

## Brief disagreements / notes

1. **The Enter/Esc "trap" tests (brief's cited cells ~212/235) live at a different layer than the brief's
   line numbers suggest.** Those two cells are inside `describe("EffortDialog", …)`, which mounts the bare
   `EffortDialog` component with a test-local stub `onCancel={() => { cancelled = true; }}` — NOT through
   `useChat`/`ChatApp`. The component itself never prints anything; `cancelEffortDialog` (where `Cancelled`
   is appended) lives one layer up, wired only at `ChatApp.tsx`. So those two component-level cells were
   left untouched, and the Cancelled/no-Cancelled assertions were added instead to the app-level `/effort`
   describe block (the "confirming fires…" and "Esc fires NO wire op…" tests), which is the only place the
   full wiring — and therefore the trap — is observable. This matches the brief's own "new cells" bullet
   ("Esc prints ⎿ Cancelled and Enter does NOT") more precisely than a literal read of the cell numbers
   would have.
2. **`formatEffortSet`'s success line does NOT include `rCb`'s description clause**, even though canon's
   own confirmation line does (`Set effort level to X (…): <rCb description>`) and the research report
   notes the "no description table" premise that used to justify omitting it is now false. The brief's Arm
   1 bullets specify only the persistence SUFFIX as in-scope; the `rCb` table is explicitly assigned to
   Arm 2 (current/status) by the brief's own wording. I read this as a deliberate scope boundary rather
   than an oversight and did not add the clause — `formatEffortSet`'s doc comment in commands.ts records
   this as a considered decision, not a missing-data gap, so a future ticket can add it without
   re-researching why it wasn't there.
3. **The brief's Tests section says "chatMain seeding — delete the seeding, watch it die."** The actual
   seeding site (per both my read of the code and the research report's own explicit recommendation,
   R2 §4.7) is `cli/main.ts`'s `hookOpts.initialEffort` line, not `chatMain.tsx` — `chatMain.tsx` declares
   `initialEffort` in its `hookOpts` type but has never read it FROM prefs (only passed it through from the
   caller), and the research report explains at length why `cli/main.ts` is the better site (it already
   holds the identical `model` precedent one line above, and `chatMain` is also entered by non-foreground
   paths that should not honor a persisted effort). I built and tested the wiring at `cli/main.ts`,
   verified live that deleting it turns the new cli-main test red, and treat "chatMain" in the brief as
   loose shorthand for "the boot-seeding step" rather than a literal file pointer — trusting the deeper,
   more specific research citation over the brief's paraphrase.
