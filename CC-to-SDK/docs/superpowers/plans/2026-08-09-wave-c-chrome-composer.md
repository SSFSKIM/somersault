# Wave C · Chrome & composer ergonomics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or
> doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Rebuild ccx's chrome to upstream 2.1.220's actual architecture — one footer row with a
right-region and a notification queue instead of eleven stacked rows and four hand-rolled timers — then
fill it: statusLine hook, CLI surface, terminal title, spinner anatomy, mode chip, duration row,
follow-up suggestion, effort surfaces, honest composer keys, and a banner that names the model it runs.

**Architecture:** Fifteen tasks over eight epics. Task 1 (notification queue) and Task 2 (footer
rewrite) are the wave's spine — every later chrome task posts to the queue or renders in the footer
contract they establish. Editor-key work (Task 3) and the CLI/spinner/title tasks are independent of
the spine and may run early. Where ccx deliberately diverges from the installed 2.1.220 build, the
divergence is written into the code as a comment, not smoothed over.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React + Ink 5.2.1, `vitest` +
`ink-testing-library`, the Claude Agent SDK. All commands run from `CC-to-SDK/harness/`.

**Governing spec:** `CC-to-SDK/docs/superpowers/specs/2026-08-09-wave-c-chrome-composer-design.md`
(v2). Acceptance criteria are referenced as A1–A15; the spec is the source of truth for their wording.

**THE CANON ANNEX:** `CC-to-SDK/docs/superpowers/specs/2026-08-09-wave-c-grounding/` — three committed
files. `waveC-grounding-bundle.md` carries every verbatim upstream string, timing constant, layout
rule and key table this plan references, each with a bundle line cite. **When this plan says
"annex §C1.6" it means a section of that file, and the annex text is normative** — task briefs must be
read WITH the named annex sections open. `waveC-grounding-ccx.md` pins current ccx code locations.
`waveC-grounding-probes.md` carries the live SDK verdicts (probes 100/100b/100c/101).

---

## Global Constraints

Every task's requirements implicitly include this section. Copy it verbatim into every implementer and
reviewer dispatch.

1. **Never print, echo, log or commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.** Live tests
   gate on either and read them from the gitignored `CC-to-SDK/.env`. Implementers stop at the clean
   keyless skip; **the controller runs every keyed cell.**
2. **No test, TTY run or QA script may read or write the real `~/.claude`.** Isolate with **both**
   `CCX_FLEET_ROOT` and `HOME` pointed at a temp dir under **literal `/tmp`** (macOS `$TMPDIR` breaks
   the UDS `sun_path` 104-byte limit).
3. **tmux teardown kills only sessions you created, by name (W-R8).** `tmux kill-server`,
   `kill-session -a` and every other all-sessions form are forbidden.
4. **Never drive a GUI application** on this machine (W-R7).
5. **Repro-instrument rule (W-S10), binding on every acceptance cell.** TUI repros assert on
   dialog-scoped needles and verify state after every keystroke. Never wait on copy that also appears
   in the permanent footer. A repro that succeeds first try gets the same scrutiny as one that fails.
6. **Code style:** dense hand-style, **no Prettier**, match the surrounding file. ESM import
   specifiers end in `.js`. Dependency injection via a `deps = { … }` default parameter.
7. **TDD:** failing test → observed red → minimal implementation → green → `npm run typecheck`.
8. **Gates after every task:** `npm run typecheck`, then `npm run test:unit`, then `npm run test:tui`.
   Report the actual numbers. Never run `npm test` (it shells to python3). Do not run
   `npm run test:resize-matrix`.
9. **Commit to the current branch (`main`) without asking. No `Co-Authored-By` or any attribution.
   Never push, never open a PR.**
10. **Subagents must not edit `CC-to-SDK/.doperpowers/sdd/progress.md`** — the controller appends.
11. **Verbatim upstream copy is verbatim**, including upstream's own spelling choices (`Ctrl-C`
    hyphenated in exit arms, `xHigh`, `Sautéed`). Where the plan or annex gives a backticked string
    with a bundle cite, reproduce it exactly.
12. **Record deliberate divergences in the code (W-S11)** as a comment naming what upstream does and
    why ccx differs. The spec's Decision Log D-C1..D-C10 lists the sanctioned divergences.
13. **THE TEST SNIPPETS IN THIS PLAN ARE ILLUSTRATIVE OF THE ASSERTION, NOT OF THE FIXTURE** (the
    Wave S lesson, constraint 14 there). Before writing any test, open the test file the task names
    and use its own idiom, helpers and fixture names. Where a snippet and the file disagree, the file
    wins — and say so in your report. Repo facts: no `renderHook`, no `result.current`, no snapshot
    files; `test/tui/` renders wrapper components through `ink-testing-library` and asserts on
    `lastFrame()`.
14. **A test that passes before your change proves nothing.** Run every new test against unmodified
    code first and confirm it is RED for the intended reason. **Never verify a red gate with
    `vitest run <dir> -t "<name>"`** — if the filter matches nothing, vitest exits 0. Always name the
    test FILE.
15. **Timers in tests are injected, never real.** The queue, double-press, hint decay and debounce
    logic in this wave is timer-heavy; every new module takes a clock/schedule seam in `deps` so unit
    tests drive time synthetically. A test that `await sleep(800)`s is a defect.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `harness/src/tui/notifications.ts` | The notification queue model, pure: priorities, timeouts, fold, invalidates, pinned, preemption. No React. |
| `harness/src/tui/NotificationSlot.tsx` | The right-aligned one-row overlay renderer (truncate, dim-when-no-color). |
| `harness/src/tui/Footer.tsx` | The one-row two-region footer: early-return states, mode chip, hint list with crowd-out, statusLine row slot. |
| `harness/src/tui/footerModel.ts` | Pure footer logic: `suppressHint`, hint-list assembly + crowd-out rule, mode-table accessors. |
| `harness/src/tui/modeTable.ts` | Upstream's six-mode table verbatim (title/shortTitle/indicator/symbol/color), annex §C4.c. |
| `harness/src/tui/keys/doublePress.ts` | The `Pee` primitive: arm/second-press/window, injected clock. |
| `harness/src/tui/statusLine.ts` | statusLine config resolution, payload builder, debounced runner (spawn/abort/timeout/normalize), pure + deps. |
| `harness/src/tui/terminalTitle.ts` | OSC 0 writer, prefix animation state, title precedence, kill switch. |
| `harness/src/tui/suggester.ts` | The warm suggester service: spawn/request/abort/retire lifecycle, the 12-rule post-filter, the verbatim prompt. |
| `harness/src/tui/durationRow.ts` | Past-tense vocab + `✻ {Verb} for {t}` row formatting, pure. |
| `harness/src/cli/help.ts` | `--version`/`--help`/`doctor` printers + unknown-flag error shape. |

**Deleted files**: `harness/src/tui/ChatStatusBar.tsx` (Task 2), `harness/src/tui/memory.ts` (Task 14).

**Modified files** (each named in its task): `ChatComposer.tsx` · `ChatApp.tsx` · `useChat.ts` ·
`composerFrame.tsx` · `promptMode.ts` · `keys/editorAdapter.ts` · `src/tui/editor.ts` (the editor
reducer — it lives in `src/tui/`, NOT under `keys/`) · `keys/bindings.ts` · `keys/hints.ts` ·
`spinner.ts` · `TurnSpinner.tsx` · `commands.ts` · `ModelPicker.tsx` · `modelPickerModel.ts` ·
`settingsRows.ts` · `prefs.ts` · `placeholder.ts` · `completions.ts` · `banner.ts` ·
`rewindModel.ts` · `SettingsDialog.tsx` · `PermissionsDialog.tsx` (chrome-row budgets) ·
`cli/args.ts` · `cli/main.ts` · `settingsFile.ts` · `session/chatSession.ts` · `client/remote.ts` ·
`client/chatAdapter.ts` · `host/host.ts` (the effort wire op).

**Task order and gating:** **Tasks execute strictly sequentially, in numeric order — one
implementer at a time, always** (SDD's own rule; it also dissolves every file-collision risk:
`useChat.ts` is touched by eight tasks, `ChatComposer.tsx`/`ChatApp.tsx` by five incl. Task 11's
dialog mount, `Footer.tsx`/`footerModel.ts`/`test/tui/footer.test.tsx` by Tasks 2/4/7/10/11, and
`settingsRows.ts`+`prefs.ts` by Tasks 7 and 12 — the numeric order sequences all of them). The
order also encodes the real dependencies: 1 (queue) → 2 (footer) gate everything chrome-shaped;
Task 7 additionally consumes Task 6's elapsed formatter; Task 10 ships its payload WITHOUT the
`effort` field (the `...x && {}` idiom) and Task 11 adds it (plus the `formatStatus` effort field)
when the effort state exists; Task 13 reads the launch-resolved effort for the banner segment.

---

## Task 1: EP-C1a — the notification queue (P0, the wave's spine)

**Files:** Create `src/tui/notifications.ts`, `src/tui/NotificationSlot.tsx`; Test
`test/unit/notifications.test.ts`, `test/tui/notification-slot.test.tsx`. **Do NOT export either
from `src/index.ts`** — the library entry deliberately exports no TUI module (the REPL is
dynamic-imported); the modules are pinned by their own tests.

**Annex:** §C1.6 (queue semantics, the full hint inventory table, renderer), §C1.1 (the overlay-row
placement — `position:"absolute", marginTop:-1`, flush right, height collapses to 0 when hidden).

**Interfaces (later tasks consume these — keep the names):**

```ts
export type NotificationPriority = "immediate" | "high" | "medium" | "low";
export interface CcxNotification {
  key: string;
  text?: string;              // plain text renders dim unless color is set
  color?: string;
  jsx?: unknown;              // pre-built node (the token-warning uses this)
  priority?: NotificationPriority;   // default "low"; "immediate" preempts current
  timeoutMs?: number;         // default 8000
  fold?: (prev: CcxNotification, next: CcxNotification) => CcxNotification;
  invalidates?: string[];
  pinned?: boolean;
}
export interface NotificationStore {
  add(n: CcxNotification): void;
  remove(key: string): void;
  state(): { current: CcxNotification | null; pinned: CcxNotification[] };
  subscribe(fn: () => void): () => void;
}
export function createNotificationStore(deps?: {
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}): NotificationStore;
```

**Ownership and reach (plan-review finding #6):** `useChat` owns the single store instance —
created via its `deps` seam (default `createNotificationStore()`), exposed to consumers as
`notify(n: CcxNotification)` / `dismissNotification(key)` actions and a `state.notification`
(the store's `current`) that `useChat` mirrors into its own state on `subscribe` (the repo has no
`useSyncExternalStore` idiom — mirror into `useChat` state like every other live field).
`ChatApp` passes `state.notification` to the `NotificationSlot` mount; Tasks 4/11/14 reach the
queue exclusively through `notify`/`dismissNotification`.

Semantics transcribed from annex §C1.6: lowest priority number wins from the queue; `immediate`
preempts the current synchronously (preempted entry re-queued only per the `mXs` rule); timer clears
current and processes queue; same-key `add` folds when `fold` present, else replaces and RESTARTS the
timer (the effort hint depends on restart-on-re-add); `invalidates` drops matching queue entries;
`pinned` bypasses the queue.

- [ ] **Step 1: failing unit tests** for: priority ordering; immediate preemption; timeout expiry
  advancing the queue (injected clock); re-add same key restarts timer; fold merges; invalidates
  drops; remove of a queued (non-current) key. Run against empty module: RED (import error is the
  expected red here — say so).
- [ ] **Step 2: implement `notifications.ts`** pure, timers via injected deps.
- [ ] **Step 3: green + typecheck.**
- [ ] **Step 4: failing TUI test** for `NotificationSlot`: renders current notification text dim,
  right-aligned, single row, truncated at width; renders nothing (zero height) when empty; colored
  text when `color` set.
- [ ] **Step 5: implement `NotificationSlot.tsx`** — the overlay-row shape per annex §C1.1: this
  component renders ONE row, right-flushed (`justifyContent:"flex-end"`), `wrap:"truncate"`; the
  absolute positioning above the composer is applied by the mount site (Task 2), not here.
- [ ] **Step 6: green, typecheck, gates, commit** `feat(waveC-t1): notification queue + slot`.

## Task 2: EP-C1b — the footer rewrite (P0, gates the chrome tasks)

**Files:** Create `src/tui/Footer.tsx`, `src/tui/footerModel.ts`, `src/tui/modeTable.ts`; Delete
`src/tui/ChatStatusBar.tsx`; Modify `ChatComposer.tsx` (remove the hint-stack rows **:953-970
only** — `:936` opens the composer column, `:941`/`:945-952` are the permission row and
ComposerFrame/PromptGlyph/PlaceholderCursor and stay; `:960`'s `InlineSearchRow` STAYS but moves
onto the footer row per the annex; mount the notification overlay + pass draft signal up),
`ChatApp.tsx` (:758-764 — remove the arm rows and `ChatStatusBar` mount, mount `Footer`),
`keys/hints.ts` (chord formatting reuse), **and the three dialog chrome budgets that count
ChatStatusBar as their one unconditional sibling** (plan-review Critical #2):
`rewindModel.ts:122` `REWIND_CHROME_ROWS = 12`, `SettingsDialog.tsx:218`
`SETTINGS_CHROME_ROWS = 11`, `PermissionsDialog.tsx` `PERMISSIONS_CHROME_ROWS = 13` — each
docblock names the "+1 ChatStatusBar" term; Test `test/tui/footer.test.tsx` (new), plus updating
every test that pins the old rows. **The inventory greps, all mandatory before writing code:**
`grep -rn "mode auto\|Esc rewind\|⚙\|ctx \|think " test/` AND `grep -rln ChatStatusBar test/` —
the second catches what the needles miss: `test/tui/keys-acceptance.test.tsx:502` reads
`ChatStatusBar.tsx` OFF DISK in its banned-chord sweep (ENOENT after deletion — substitute
`Footer.tsx` in the swept file set), `test/tui/components.test.tsx:15,196,205` imports
`modeColor`/`ctxColor` from it (`modeColor` moves to `modeTable.ts`; `ctxColor` dies with the chip
— its tests move to Task 14's removal suite), `test/tui/honesty.test.tsx:401` renders it directly.

**Annex:** §C1.1-C1.5 (layout, row builder states, hint list order + crowd-out, `← for agents`
shapes, collapse rule), §C4.c (mode table). ccx pins: `waveC-grounding-ccx.md` §EP-C1.

**Interfaces:**
- `modeTable.ts` exports `MODE_TABLE` (six entries, fields `title/shortTitle/indicator/symbol/color`,
  values verbatim from annex §C4.c) and accessors `modeIndicator(mode)`, `modeSymbol(mode)`,
  `modeColor(mode)` with unknown → `default` fallback.
- `footerModel.ts` exports `suppressHint({draftNonEmpty, searching, statusLineConfigured})`,
  `buildHintList(state): HintSegment[]` implementing the crowd-out rule (annex §C1.3 item 3 read
  literally), and `agentsAffordance({bgCount, awaiting, done})` → the `← for agents` / `← N agents` /
  `← N done` shapes.
- `Footer.tsx` props: `{ mode, busy, draftNonEmpty, isInputEmpty, searching, statusLineText?,
  statusLineConfigured, exitArm?: {key: string, verb: string}, pasting, pasteExpandHint, bashMode,
  agents: {count, awaiting, done}, bindings }` — one component owns everything below the composer
  rule except the notification overlay. **The exit-arm `key` string (`"Ctrl-C"` / `"Ctrl-D"`,
  hyphenated) is a PROP originating at the arm site in `ChatApp`, never a literal inside
  `Footer.tsx`** — that mirrors upstream (the input hook passes `Dci.key`) and it is what lets
  `Footer.tsx` join `keys-acceptance.test.tsx`'s banned-chord sweep without failing it
  (plan-review finding #14). Record the arrangement in a code comment.
- `agentsAffordance` also carries upstream's **2500 ms awaiting/done flash** (annex §C1.4,
  `Lci = 2500`) — a timestamp-in/state-out pure function with the clock injected, no timer of its
  own.

Behavior contract (all from the annex, cites there): four early-return states replace the WHOLE row
(exit arm `Press {key} again to {verb}` dim, hyphenated key literal; `Pasting…`; `paste again to
expand`; bash mode `! for shell mode` in bashBorder color) and the statusLine row hides with the exit
arm; otherwise `⏸ manual mode on[ (shift+tab to cycle)] · {hints}` — parenthetical suppressed on
`default` mode, chip text `{symbol} {indicator} on`, hint list truncates, joiner `" · "` dim;
typing: hint list dies, agents affordance dies, chip survives; the mode chip is the ONLY footer
content while typing. The composer block height must not change as hints appear/disappear —
transient content lives in the overlay row (height-0-when-empty) and the footer row swaps in place.

- [ ] **Step 1: failing TUI tests** in `test/tui/footer.test.tsx`: home-state row
  `⏸ manual mode on · ? for shortcuts` (+ agents affordance when bg exists); non-default mode adds
  `(shift+tab to cycle)` and drops `? for shortcuts`; typing collapses to chip only; each
  early-return state; statusLine text row above the footer row, hidden while exit-armed. Observed
  RED.
- [ ] **Step 2: implement** `modeTable.ts` + `footerModel.ts` (pure, unit-testable) then
  `Footer.tsx`.
- [ ] **Step 3: MEASURE the overlay geometry before building on it** (plan-review finding #25 —
  the Wave R lesson: geometry claims are settled by measurement, not by reading Ink's docs). Ink 5
  declares `position:"absolute"` support but `src/tui/` has zero existing uses. Render a minimal
  absolute `marginTop:-1` row above a box through `ink-testing-library` AND once through the real
  pty (`drive-repl.py` against a scratch mount) and confirm: right-flush, does not displace flow,
  contributes no height when empty. **If absolute positioning misbehaves in either instrument, the
  sanctioned fallback is a normal in-flow row that renders empty (height preserved at 1 only while
  a notification is live)** — record whichever way it lands as a code comment and in your report.
- [ ] **Step 4: rewire** `ChatApp.tsx`/`ChatComposer.tsx`: delete the old rows/ChatStatusBar, mount
  `Footer` + the `NotificationSlot` overlay per Step 3's measured shape, thread the
  draft-non-empty signal from the composer to the footer owner. Migrate by destination (spec EP-C1
  §4): `(ctrl+r to search history)`, `Ctrl+Y to paste deleted text` → queue;
  pasting/paste-expand/bash-hint/exit-arms → footer states; search box stays in-row. **Two
  deliberate deletions, each recorded as a code comment per Global Constraint 12:** the
  `esc rewind`/`esc clear` persistent hint row (EP-C7 owns the replacement; until Task 4 lands no
  esc hint renders — acceptable intermediate state, note it) **and hint row 1
  (`⏎ send · … · @ files · / commands · …`, `ChatComposer.tsx:969`) — upstream's home-state footer
  has no such row; its affordances live in `? for shortcuts`** (plan-review finding #24).
- [ ] **Step 5: re-measure and re-pin the three `*_CHROME_ROWS` constants** — the footer stack's
  row count changed under the dialogs; measure each dialog in the pty at a pinned terminal size
  (the Wave S measurement scripts are the precedent), update the constants AND their docblocks to
  name the new sibling set (footer row + optional statusLine row + overlay row).
- [ ] **Step 6: update the pinned tests** you inventoried; every change must be a needle update,
  not an assertion deletion — if a behavior genuinely no longer exists (ctx chip), move the test to
  Task 14's removal suite rather than deleting silently.
- [ ] **Step 7: gates, commit** `feat(waveC-t2): one-row footer + right-region overlay; ChatStatusBar retired`.

## Task 3: EP-C7a — editor keys: Home/End, ctrl+arrows, word boundary (P0, independent)

**Files:** Create `src/tui/keys/doublePress.ts`; Modify `src/tui/keys/editorAdapter.ts` (the NAMED
table at :17-22 and the drop at :44), `src/tui/editor.ts` (ctrl-arrow arm above the ctrl switch at
:374; `wordRight` at :240-246); Test `test/unit/doublePress.test.ts`, `test/tui/editor.test.ts`
(existing file — extend).

**Annex:** §C7.1 (the `Pee` primitive, 800 ms), §C7.5 (home/end → visual line motions; ctrl+home
falls through), §C7.6 (ctrl/meta/fn+arrows → word motion; `nextWord` lands on `r.start` — START of
next word), §C7.9 (these keys are input-layer, not keymap — mirror that architecture: wire them in
`editorAdapter`/`editor`, do NOT add Chat-context keymap rows).

**Interfaces:** `createDoublePress(handlers: {onArmChange(armed: boolean): void; onSecondPress():
void; onFirstPress?(): void}, windowMs = 800, deps?: {now?: () => number; setTimeout?: (fn: () =>
void, ms: number) => unknown; clearTimeout?: (h: unknown) => void}): { press(): void; disarm():
void; dispose(): void }` — `disarm` because the busy-interrupt path must cancel a pending arm
(today's `cancel()` → `disarmClear()` at `ChatComposer.tsx:555`), `dispose` because an armed timer
firing `setState` after unmount is a defect (plan-review finding #7). Consumed by Task 4.

- [ ] **Step 1: failing tests**: doublePress (first press arms + fires onFirstPress; second within
  window fires action + disarms; expiry disarms via injected clock); home/end move to line start/end;
  ctrl+left/right (and meta already working) land on word boundaries; **wordRight from mid-word lands
  at the START of the next word** (assert exact offsets on a three-word buffer); `deleteWordAfter`
  deletes through the new boundary (blast radius pinned deliberately). Observed RED (the wordRight
  test must fail against today's end-of-word behavior — if it passes, the fixture is wrong).
- [ ] **Step 2: implement**: add `home`/`end` to the NAMED map routing to the existing
  `lineStart`/`lineEnd` ops; add a ctrl+arrow arm delegating to `wordLeft`/`wordRight`; change
  `wordRight`'s boundary to next-word-start; adjust `deleteWordAfter` expectations; fix any alt+f/
  alt+right position tests that pinned the old boundary (list them in the report).
- [ ] **Step 3: gates, commit** `feat(waveC-t3): home/end + ctrl-arrows wired; word-forward lands at next word start`.

## Task 4: EP-C7b — Ctrl-C clears AND arms; honest Esc (P0, after Tasks 1+2)

**Files:** Modify `ChatApp.tsx` (`app:interrupt` handler :404-408, the arm rows), `ChatComposer.tsx`
(cancel/arm plumbing :514-567, the clear channel), `useChat.ts` if the clear channel needs state;
Test `test/tui/chat.test.tsx` + `test/tui/footer.test.tsx` extensions.

**Annex:** §C7.2 (Ctrl-C: first press clears draft + cursor 0 + history reset AND arms 800 ms,
footer-replacing `Press Ctrl-C again to exit`, `Ctrl-C` hyphenated literal), §C7.3 (Esc: double-press
clear, queue hint `Esc again to clear` 1000 ms immediate), §C7.4 (reference only). Spec EP-C7
decisions 2-3; work item on the Esc-rewind arm (keeps 1500 ms + copy, migrates onto doublePress +
queue).

- [ ] **Step 1: failing tests**: Ctrl-C with non-empty draft → draft cleared + footer shows
  `Press Ctrl-C again to exit` + second Ctrl-C within window exits (assert via the existing exit
  seam); arm expires at 800 ms (injected clock) and footer restores; Ctrl-C while busy still
  interrupts and does NOT clear; first Esc with draft posts `Esc again to clear` to the queue
  (assert via store state, not sleep); second Esc clears + stashes to history; Esc-Esc on empty
  still arms rewind with its hint now in the queue. Observed RED.
- [ ] **Step 2: implement**: give `app:interrupt` a clear channel into the composer (the composer
  already exposes a reducer path — the ccx pins name `clearInput`/`editor.ts:392`; a callback prop
  or a ref-based imperative handle matching existing patterns — read `ChatApp`'s existing
  `prefill` channel and mirror it); migrate all four arms onto `createDoublePress`; post the Esc
  hints via the queue; delete the old per-arm `useState`+`setTimeout` code.
- [ ] **Step 3: gates, commit** `feat(waveC-t4): ctrl-c clears+arms per canon; esc hints move to the queue`.

## Task 5: EP-C3 — CLI surface (P1, independent)

**Files:** Create `src/cli/help.ts`; Modify `src/cli/args.ts` (unknown-flag throw :145 region,
version/help interception), `src/cli/main.ts` (dispatch + the exit-code discrimination), `src/cli/bin.ts`
if the exit path needs it; Test `test/unit/cli-args.test.ts` (existing — the `unknown flag` pin is
at :103) and `test/unit/cli-main.test.ts` (existing — :76, :549), `test/unit/cli-surface.test.ts`
(new for the printers). **`test/unit/cliArgs.test.ts` covers a DIFFERENT module (`src/cliArgs.ts`)
— do not touch it** (plan-review finding #10).

**Exit-code discrimination (plan-review finding #30):** every `parseCcx` throw funnels through ONE
catch (`main.ts:109` → `fail(msg, 2)`). Unknown flags move to exit 1 via a typed error
(`class UnknownFlagError extends Error` thrown at `args.ts:145`, discriminated at the catch);
`KNOWN_UNSUPPORTED` refusals (`args.ts:96`) and value-domain errors (`args.ts:52`) KEEP exit 2 —
pin all three codes in the tests.

**Annex:** §C3.1-C3.4 (version format, help layout constants + sorted sections, doctor block,
commander's exact unknown-flag/`Did you mean` rule: only `--`-prefixed tokens, similarity
`(maxLen − distance)/maxLen > 0.4`, stderr, NO usage block, exit 1).

Shapes (spec EP-C3): `ccx --version` → `0.1.0 (cc-harness)` exit 0 (read version from package.json
at build/import time — no hardcode); `ccx --help` → `Usage: ccx [options] [command] [prompt]` +
description + `Options:` (sorted) + `Commands:` (`agents attach stop rm serve fleet`); unknown flag →
`error: unknown option '--x'` [+ `(Did you mean --y?)`] exit 1; `ccx doctor` → identity block +
`No installation issues found.` exit 0. `KNOWN_UNSUPPORTED` flags keep their existing distinct
message (assert unchanged).

- [ ] **Step 1: failing tests** for all four shapes + exit codes + the suggestion gate boundary
  (a token just under/over 0.4 similarity; a non-`--` token gets no suggestion). Observed RED. The
  existing tests pinning `unknown flag` / exit 2 must be UPDATED in the same change — find them
  first (`grep -rn "unknown flag" test/`).
- [ ] **Step 2: implement** `help.ts` + intercepts. Version/help/doctor short-circuit BEFORE the TTY
  gate and before host construction.
- [ ] **Step 3: gates, commit** `feat(waveC-t5): --version/--help/doctor + commander-shaped unknown-flag errors`.

## Task 6: EP-C4b — spinner anatomy (P1, independent)

**Files:** Modify `src/tui/spinner.ts` (status builder :80-83, elapsed formatter :58-77, verb pick),
`src/tui/TurnSpinner.tsx` (:10-26), `useChat.ts`/`liveTurn.ts` (streamed-char feed for the
estimate); Test `test/tui/spinner.test.ts` (existing — extend; there is NO `test/unit/spinner.test.ts`).

**Annex:** §C4.b — the full anatomy: parenthetical `({elapsed} · {↓|↑} {N} tokens · {phase})`,
segments materialize progressively under width gates (quiet threshold 16 s for elapsed/tokens
without a phase); token figure = **eased estimate `round(animatedChars/4)`** reconciled per
message (D-C6); arrow `↓` for tool/responding/thinking, `↑` for requesting; phase ladder verbatim
(`thinking`→`still thinking` 10s→`thinking more` 20s→`thinking some more` 30s→`almost done thinking`
45s; `running tool for {t}`, `thought for {N}s`); gerund re-picked between phases (not fixed per
turn, not per-tick); elapsed formatter ported whole (`1m05s`, hour rollover — the header comment at
`spinner.ts:58-72` names its own defects; fix them per upstream's `ra`).

- [ ] **Step 1: failing unit tests**: elapsed format `1m05s` (no space), `1h02m`; estimate feed
  (chars→tokens/4, reconciles to real usage on message end); phase ladder thresholds; arrow by
  mode; status string assembly with missing segments (no tokens yet → no token segment). Observed
  RED.
- [ ] **Step 2: implement**, threading a streamed-character count from `liveTurn` (it already
  tracks text deltas — extend, don't duplicate) and a phase signal (`tool-running` / `thinking` are
  already distinguishable from the wire frames ccx consumes — check `liveTurn.ts` before inventing).
- [ ] **Step 3: gates, commit** `feat(waveC-t6): spinner anatomy — estimate, arrow, phase ladder, formatter port`.

## Task 7: EP-C4c/d — mode chip verbatim renders + duration row (P1, after Tasks 2 AND 6 — the
duration format reuses Task 6's ported elapsed formatter; today's emits `1m 05s` with a space)

**Files:** Create `src/tui/durationRow.ts`; Modify `footerModel.ts`/`Footer.tsx` (chip already
table-driven from Task 2 — this task pins all six renders + colors), `useChat.ts` (turn-end row
emission **via the existing local-entry append path — the same seam local notices ride; there is
no "species router" entry to find**, plan-review finding #29); Test
`test/unit/duration-row.test.ts`, `test/tui/footer.test.tsx` + transcript test extensions. This
task also widens the `settingsRows.ts:15` closed id union and `prefs.ts:31` — Task 12 widens the
same two; sequential order makes that safe, but keep the additions adjacent so 12's diff is clean.

**Annex:** §C4.c (six chips verbatim: `⏸ manual mode on`, `⏸ plan mode on`, `⏵⏵ accept edits on`,
`⏵⏵ auto mode on`, `⏵⏵ bypass permissions on`, `⏵⏵ don't ask on`; colors per table), §C4.d
(`✻ {Verb} for {duration}` all dim, 8-verb vocab verbatim incl. `Sautéed`, verb picked once per
row, `showTurnDuration` default true; the waiting-for-agents replacement variant is OUT of scope —
note as skip).

- [ ] **Step 1: failing tests**: all six chip strings + color tokens; duration row format from ms
  (`4s`, `1m05s` — reuse Task 6's formatter); vocab pick injectable (seeded pick for tests); row
  appears at turn end in the transcript, absent when `showTurnDuration` pref is false, absent on
  interrupt. Observed RED.
- [ ] **Step 2: implement.** The setting rides `CcxPrefs` (`prefs.ts:31`) + a `/config` boolean row
  (`settingsRows.ts` — mirror the `thinking` row pattern).
- [ ] **Step 3: gates, commit** `feat(waveC-t7): six-mode chip verbatim + end-of-turn duration row`.

## Task 8: EP-C4a — terminal title (P1, independent)

**Files:** Create `src/tui/terminalTitle.ts`; Modify `useChat.ts` or `ChatApp.tsx` (turn state →
prefix animation; ai-title fetch after first turn), `cli/main.ts` (initial title + exit clear);
Test `test/unit/terminal-title.test.ts`.

**Annex:** §C4.a — OSC 0 BEL (`\x1b]0;{prefix} {title}\x07`), prefix `✳` idle / `⠂`↔`⠐` at 960 ms
busy; precedence rename-title ?? ai-title ?? `--name` ?? `"ccx"`; ai-title via
`getSessionInfo().customTitle ?? .summary` fetched once after the first turn completes (probe (d) —
it is a disk read, not a wire event); kill switch `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`; clear
`\x1b]0;\x07` on exit; title persists at turn end (prefix reverts only). Skips recorded in spec:
`terminalTitleFromRename` setting, kitty ST variant.

**Interface:** `createTerminalTitle(deps: {write(s: string): void; setInterval?; clearInterval?;
env?})` with `setTitle(title)`, `setBusy(busy)`, `clear()` — pure of React; the mount site drives
it. Writes bypass Ink (direct `process.stdout.write`).

- [ ] **Step 1: failing unit tests**: emitted byte sequences for idle/busy/clear; 960 ms
  alternation via injected timer; kill switch suppresses everything; precedence ladder. Observed
  RED.
- [ ] **Step 2: implement + wire**: initial `✳ ccx` (or `--name`) at REPL mount; busy toggles with
  `state.busy`; after the first completed turn fetch `getSessionInfo()` once and adopt the title;
  `/rename` updates it immediately; clear on the existing REPL teardown path.
- [ ] **Step 3: gates, commit** `feat(waveC-t8): OSC-0 terminal title with busy prefix + engine ai-title`.

## Task 9: EP-C2a — statusLine runner (P1, after Task 2 for the render slot; runner itself is pure)

**Files:** Create `src/tui/statusLine.ts`; Modify `src/tui/settingsFile.ts` — **NOT
`src/config/settings.ts`**, which only resolves `settingSources` for handoff INTO the SDK and
never reads a file; `settingsFile.ts` already owns `settingsPath("userSettings")` and gains the
read side (plan-review finding #9). The read is **user-level only** — project/local sources are
refused per canon L154558. Test `test/unit/statusline.test.ts`.

**Annex:** §C2.1 (settings shape: `{type:"command", command, padding?, refreshInterval?(min 1),
hideVimModeIndicator?}` — the last is accepted-but-ignored, no vim mode exists; record in code),
§C2.4 (cadence: mount run undebounced; 300 ms debounce on state deltas; optional refreshInterval
poll; AbortController per run), §C2.5 (execution: silent on every failure — nonzero/spawn/timeout/
exception all yield `undefined` and the previous text stands; stderr to debug log; 600 s default
timeout; stdout normalize: trim/split/per-line-trim/drop-blanks/rejoin; child env + `CLAUDE_PROJECT_DIR`,
`COLUMNS`, `LINES`; cwd = session cwd).

**Interfaces:** `resolveStatusLineConfig(settings): StatusLineConfig | undefined`;
`runStatusLine(cfg, payloadJson, deps: {spawn?; now?; timeoutMs?}): Promise<string | undefined>`;
`createStatusLineDriver(cfg, buildPayload, onText, deps)` with `.poke(reason)` (debounced),
`.mountRun()`, `.dispose()`. Task 10 consumes all three.

- [ ] **Step 1: failing unit tests**: config resolution (user source only; malformed → undefined);
  runner success path (normalized stdout); each failure mode → `undefined` + no throw; debounce
  coalesces pokes (injected clock); refreshInterval poll; abort of in-flight run on re-poke.
  Observed RED.
- [ ] **Step 2: implement** with `child_process.spawn` behind the deps seam.
- [ ] **Step 3: gates, commit** `feat(waveC-t9): statusLine runner — silent failures, 300ms debounce, 600s timeout`.

## Task 10: EP-C2b — statusLine payload + render (P1, after Tasks 2+9)

**Files:** Modify `src/tui/statusLine.ts` (payload builder), `useChat.ts` (driver wiring: pokes on
turn end/usage/mode/model/effort/thinking deltas; state field `statusLineText`), `Footer.tsx`
(render row — slot built in Task 2, this task feeds it + the `suppressHint` fold-in); Test
`test/unit/statusline.test.ts` (payload shape), `test/tui/footer.test.tsx` (render + shortcut-hint
suppression).

**Annex:** §C2.2-C2.3 (the payload: build ONLY the fields the spec's EP-C2 decision names, omitting
the rest with the `...x && {}` idiom; **the `effort {level}` block is OMITTED in this task —
`state.effort` does not exist until Task 11, which adds the block**, plan-review finding #18;
`context_window` from `getContextUsage()` with
`current_usage: null` pre-first-turn; `version` = ccx's own), §C2.6 (render: dim forced onto every
span over the script's own ANSI, per-line truncate, SGR carry-forward across lines, `gap:2`,
padding, the full visibility guard: prompt-mode only, not exit-armed, not pasting, ≥15 rows).

- [ ] **Step 1: failing tests**: payload golden (all present fields, omitted fields ABSENT not
  null); ANSI-preserving dim-forcing render (feed a colored fixture string); multi-line SGR
  carry-forward; the visibility guard branches; `suppressHint` true while configured
  (`? for shortcuts` gone). Observed RED.
- [ ] **Step 2: implement + wire the driver into `useChat`** (pokes at the named deltas — the turn
  -end poke rides the existing turn-completion path; model/mode/effort/thinking pokes ride their
  setters).
- [ ] **Step 3: gates, commit** `feat(waveC-t10): statusLine payload + dim render slot`.

## Task 11: EP-C6 — effort surfaces (P1, after Task 1 for the hint; picker row independent)

**Files:** Modify `ModelPicker.tsx` (:123-150 — effort row between list and footer),
`modelPickerModel.ts` (effort state + stepping + labels), `commands.ts` (DELETE the `/effort`
redirect at :264; `/effort` becomes a real command opening the dialog; **`formatStatus` at :238
gains the effort field** — EP-C6's acceptance reads it there), `useChat.ts` (`state.effort`,
dialog open-state, hint post at session start + on change), `ChatApp.tsx` (the dialog MOUNT —
every dialog mounts there; this makes Task 11 a toucher of the sequenced surface, which numeric
order already handles), new `src/tui/EffortDialog.tsx` (read `dialogs/` first and match the house
pattern), **and the whole wire layer the plan v1 missed (plan-review Critical #1)**:
`src/session/chatSession.ts` (`SettingsOps` at :75-83 gains an effort member),
`src/client/remote.ts` (:171-173 region — new `set_effort` op beside `set_model`/`set_thinking`),
`src/client/chatAdapter.ts`, `src/host/host.ts` (op handling), `src/tui/statusLine.ts` (ADD the
`effort {level}` payload block Task 10 omitted); Test `test/tui/model-picker.test.tsx` (existing —
extend), `test/tui/effort.test.tsx` (new), `test/tui/commands.test.ts` (existing — the redirect
pin lives THERE, not in a `test/unit/commands.test.ts`, which does not exist).

**The mechanism, live-verified (probe 102, `waveC-grounding-probes.md` §(f)):** the SDK has NO
`setEffort` — the runtime hook is `Query.applyFlagSettings({ effortLevel })` (sdk.d.ts:2373,
streaming-input only), which resolves mid-session with later turns unaffected. **It performs NO
validation — a bogus level resolves silently — so ccx validates the level against its own domain
(`args.ts:46`) BEFORE the wire op fires**, and the wire op carries only validated values.
`effortLevel` accepts `'max'` session-scoped (never persisted); the persisted settings type
excludes it.

**Annex:** §C6.1 (glyphs ○◐●◉◈, color `claude` set / `subtle` unsupported), §C6.3 (row verbatim:
`● High effort (default) ←/→ to adjust`, `xHigh` special-case, unsupported branch
`● Effort not supported for {model}`, max caveat verbatim, stepping wraps modulo supported list),
§C6.4 (standalone dialog footer `←/→ to adjust · Enter to confirm · Esc to cancel`), §C6.2 (hint
`{glyph} {level} · /effort` — raw lowercase level — 10 000 ms, `priority:"high"`,
`key:"effort-level"`, re-add restarts clock; absent when model lacks effort support).

- [ ] **Step 1: failing tests**: picker row renders per level incl. `(default)` marker + `xHigh` +
  unsupported branch; ←/→ steps and wraps; `/effort` opens the dialog (and the redirect note is
  gone); confirming fires the `set_effort` wire op (assert via injected chat-adapter double, the
  same seam the `set_model` tests use — find them first); an out-of-domain level is rejected
  client-side and NO wire op fires; `formatStatus` renders the effort field; the hint posts at
  mount with the launch effort and re-posts on change. Observed RED.
- [ ] **Step 2: implement** — wire op end to end (chatSession → remote → adapter → host →
  `applyFlagSettings({effortLevel})`), then the surfaces.
- [ ] **Step 3: gates, commit** `feat(waveC-t11): effort row, /effort dialog, set_effort wire op, decaying hint`.

## Task 12: EP-C5 — the follow-up suggestion (P1, after Task 2; the only keyed-heavy task)

**Files:** Create `src/tui/suggester.ts`; Modify `useChat.ts` (suggestion state slice +
turn-end trigger + replaceDocument retirement), `ChatComposer.tsx` (placeholder precedence, accept
keys), `placeholder.ts` (suggestion > queued-edit hint > first-run template; first-run template
gated on the setting), `settingsRows.ts` + `prefs.ts` (`Prompt suggestions` boolean row, ccx key
`promptSuggestionEnabled`, **explicit false default**); Test `test/unit/suggester.test.ts`,
`test/tui/suggestion.test.tsx`, plus one **gated live test** `test/live/suggestion.test.ts`.

**Annex:** §C5.1-C5.7 — the verbatim 32-line prompt (§C5.3; copy EXACTLY; "44" was a
mis-count corrected by the Task 12 byte-equality pin), the thirteen-rule
post-filter table, the eligibility chain (MINUS `cache_cold`, per spec), the four-state machine +
transitions table, placeholder render (dim, first char inverted when focused, only when buffer
empty), accept Tab/Right on empty buffer with no completion popup, abort-on-keystroke, survives
Ctrl-C, reset on submit. Spec EP-C5 decisions: OFF by default; warm Haiku-class suggester session
(D-C5); lifecycle — lazy spawn, ONE per REPL session, retire+respawn at the replaceDocument
boundary, teardown on exit, no /cost folding.

**Interfaces:** `createSuggester(deps: {openSession?; model?; clock?})` with
`request(ctx: {transcriptTail: string}): Promise<string | null>` (post-filter applied inside),
`abort()`, `retire()`; `postFilterSuggestion(text: string): {ok: true, text: string} | {ok: false,
reason: string}` exported pure for unit tests.

- [ ] **Step 1: failing unit tests**: every post-filter rule (twelve fixtures, one per reason, from
  the annex table); eligibility gates (fewer than 2 assistant messages → no request; error turn →
  no request; plan mode → no request; setting off → no request); state transitions incl. the
  `timing` discard (generated while user typed → empty); retirement on replaceDocument. Observed
  RED.
- [ ] **Step 2: implement `suggester.ts`** against an injected session factory (unit tests never
  spawn a real engine).
- [ ] **Step 3: failing TUI tests**: placeholder shows the suggestion dim when buffer empty; Tab
  accepts into the buffer; Right accepts; typing dismisses; Ctrl-C leaves it standing; submit
  resets. Observed RED → implement → green.
- [ ] **Step 4: the gated live test** (skips cleanly keyless): setting on, two eligible turns, a
  suggestion arrives and passes the filter. The controller runs it keyed at wave close (A9).
- [ ] **Step 5: gates, commit** `feat(waveC-t12): harness-generated follow-up suggestion, off by default`.

## Task 13: EP-C8 — banner truth (P1, independent)

**Files:** Modify `src/tui/banner.ts` (header + model/auth line + optional effort segment from the
launch-resolved effort — Task 11's state exists by now but the banner seeds in `main.ts` before the
REPL, so it reads `config.effort ?? DEFAULTS.effort`), `src/cli/main.ts` (**:339** computes
`model = inv.config.model ?? deps.loadPrefs().model`, the banner call at **:372** receives it raw
while **:377** resolves it — hand :372 the same `resolveModelAlias(model) ?? DEFAULTS.model`);
`modelPickerModel.ts` (default-row description rewrite); Test: **the resolved-model red gate lives
in `test/unit/cli-main.test.ts`** — `welcomeBanner` itself is correct (`banner.ts:28` renders what
it is handed), so a banner-level test cannot go red for this defect (plan-review finding #11);
banner shape tests extend `test/tui/banner.test.ts` (there is NO `test/unit/banner.test.ts`;
`test/unit/cli-banner.test.ts` covers the unrelated `src/cli/banner.ts`);
`test/tui/model-picker.test.tsx`.

**Annex:** §C8.2 (border-text header shape — ccx renders ` ccx v{version} ` per D-C9, offset 3,
compact <70 cols drops version), §C8.3 (model/auth line `{display} · {billing}`; billing mapping
per PROBE 101: `tokenSource === "CLAUDE_CODE_OAUTH_TOKEN"` → `Claude subscription`; API key →
`API Usage Billing`; non-firstParty → provider names table; unknown → omit), §C8.6 (default row:
`value: null`, description `Use the default model (currently {X})` where X = ccx's actual resolved
default). ccx pins: the banner is `<Static>`-seeded and STAYS so (D-C8) — this task fixes the
seeded VALUES, not liveness.

- [ ] **Step 1: failing tests**: banner names the resolved model (never `(default)`); header carries
  `ccx v0.1.0`; auth line under an injected accountInfo double maps all four branches; picker
  default-row description names ccx's default. Observed RED.
- [ ] **Step 2: implement** — the resolved-model handoff is the one-expression fix
  (`resolveModelAlias(model) ?? DEFAULTS.model` at the banner call site); accountInfo is fetched
  where the banner seeds (it resolves pre-turn — probe 101 proved pre-turn reachability); if the
  fetch fails, omit the auth segment (never block the banner on it).
- [ ] **Step 3: gates, commit** `feat(waveC-t13): banner names the model it runs + honest billing label`.

## Task 14: The removals + token-warning (P1, after Task 2; contingent cells A13/A14)

**Files:** Delete `src/tui/memory.ts`; Modify `promptMode.ts` (drop the `memory` mode + `#` arm —
**and collapse the now-duplicated derivations**: with a two-valued union, `composerMode` and
`modeOfDisplay` become one rename apart; merge them and rewrite the :19-32 header + :42-45
docblock that justify a three-way split, plan-review finding #23), `useChat.ts` (memory dispatch +
deps slot), `ChatComposer.tsx` (hint row), `composerFrame.tsx` (border color token),
`keys/hints.ts` (`# for memory` grid cell), `editor.ts` (**not comment-only**: `inputMode()` at
:119-128 narrows when `"memory"` leaves the `InputMode` union; its callers type-check against it),
plus the ~7 test files the ccx grounding inventoried (`waveC-grounding-ccx.md` §qa1-10 is the
checklist); ADD the token-warning post: `useChat.ts` (compute the ladder from `getContextUsage()`
at the existing refresh points), notification via Task 1's queue; **ADD the `usageWarn` → queue
migration the spec's D-C3 mandates** (plan-review finding #8): the `usageWarning()` text posts as
a queued notification when it changes, `state.usageWarn` and its render die with the old bar —
`usageFormat.ts` keeps its formatter + tests (the consumer moves, the module lives); Test
`test/tui/` updates + `test/unit/token-warning.test.ts` (new).

**Spec:** owner-decision section (both recommendations standing unless overridden), the pinned
token-warning ladder: post `{key:"token-warning", priority:"medium", timeoutMs:18000000}` when
used ≥ ceiling−20 000 (ceiling = window×0.8), text `{N}% until auto-compact` (N = % of ceiling
remaining), escalate to error-colored `Context low ({N}% remaining) · Run /compact to compact &
continue` at/past the ceiling; fold on re-post.

- [ ] **Step 1: failing tests**: `#` no longer enters a mode (input starts with `#` → plain
  prompt); the hint row and grid cell are gone; token-warning fixtures at used = ceiling−21k (no
  post), ceiling−19k (warn text with correct N), past ceiling (error escalation). Observed RED.
- [ ] **Step 2: implement removals** (every touch point from the inventory; the test updates are
  needle changes and deletions of memory-mode suites — list each in the report) **+ the warning
  post**.
- [ ] **Step 3: gates, commit** `feat(waveC-t14): # memory mode removed; token-warning ladder on the queue`.

## Task 15: Final verification — execute the spec's acceptance as written

**Files:** none (evidence only). **The controller runs the keyed cells; the implementer of this
task runs the keyless ones and prepares the pty scripts.**

- [ ] **Step 1:** Full gates: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`,
  `npm run build`. Record numbers.
- [ ] **Step 2:** Execute A1-A15 from the spec's acceptance grid AS WRITTEN, each cell with its
  stated instrument (pty runs via `harness/scripts/drive-repl.py` under an isolated `/tmp` HOME per
  Global Constraint 2; the scratch `CCX_DRIVE_ARGS` copy pattern from Wave S for flag-bearing
  launches). Keyless cells: A1, A2, A3, A4, A7, A11, A13, A14, A15. Keyed cells (controller):
  A5, A6, A8, A9, A10, A12. **A12's third surface is `/status`, not the footer** — the footer
  carries no model chip after Task 2 (the spec was amended in v3 to match; plan-review finding
  #12).
- [ ] **Step 3:** Evidence bundle to `$CLAUDE_JOB_DIR/tmp/waveC-A*.txt`; each cell's verdict quoted
  in the task report with its needle lines.
- [ ] **Step 4:** Any cell that cannot run as written is a FINDING (spec drift or defect), not a
  skipped cell — report it; do not reinterpret the cell.

---

## Self-review notes (author, pre-dispatch)

- Task 2 is the widest diff of the wave and carries the highest pinned-test churn; its
  inventory-first rule is load-bearing. If it balloons, the fallback split is footer-component vs
  call-site-rewiring — but the intermediate state must still render exactly one footer.
- Execution is strictly sequential in numeric order (see the task-order note) — that is the
  collision guard for every shared file, not a per-pair sequencing list.
- v2 (post plan-review): 31 findings adopted — see the spec's Revision Notes v3 and the ledger for
  the round's record; probe 102 (run at review time) settled the effort mechanism the plan v1 had
  wrong.
- The annex is normative for verbatim strings; this plan deliberately repeats only the load-bearing
  ones. Task briefs must name the annex sections (done per task).
- Snippet honesty: Global Constraint 13 applies to every code block above.
