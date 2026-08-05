# Wave T — Trust & Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six trust gaps the QA fleet found in `ccx` — the launch permission posture, consult
affordances, plan-modal grants, the invisible-failure surface, the missing bypass consent gate, and the
create-file framing.

**Architecture:** All changes live in the existing `harness/src/{cli,config,tui,permissions,session,host,appserver}`
modules. No new wire events, no new npm dependencies. Shared primitives are isolated in the task that
first needs them, before dependents build on them.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React + Ink, Vitest, `ink-testing-library`.

**Spec:** `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md` (**v1.2** — read the epic your
task belongs to; the Decision Log entries W-T1…W-T20 record what was rejected and why). Canon citations
(`L…`) refer to `~/claude-code-bundle/2.1.220/cli.pretty.js`.

**Provenance:** this plan is v2, rewritten after an independent spec review and an independent plan
review (`$CLAUDE_JOB_DIR/tmp/waveT-spec-review.md`, `waveT-plan-review.md`). Where a task says "do NOT do
X", a reviewer caught a real defect in the v1 draft that proposed X. Take those seriously.

## Global Constraints

- **Dense hand-style, NO Prettier.** Match the surrounding file's formatting exactly. Do not reformat
  lines you did not change.
- **ESM:** every relative import specifier ends in `.js`.
- **TDD:** failing test → run it → minimal implementation → run it → commit. Every task ends committed.
- **Gates before each commit:** `npm run typecheck`, plus the suites covering your change
  (`npm run test:unit` and/or `npm run test:tui`). Both must be green; report the counts.
  **`typecheck` is not sufficient for wire changes** — zod schemas are values, not types, so a payload
  change can typecheck clean and break at runtime (see Task 10).
- **Never read or write the real `~/.claude`.** Prefs writes go through `savePrefs(patch, env?)` →
  `prefsPath(env)` → `fleetRoot(env)`, so setting `CCX_FLEET_ROOT` to a temp dir genuinely redirects them.
  A test that touches the real prefs file is a defect regardless of whether it passes.
- **Never print or commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.** No task here needs a live
  key; every test is keyless.
- **Verbatim strings are verbatim** — character for character, including apostrophe style (`don't`
  straight vs `don’t` curly U+2019), `·` middle dots, and the `✻` glyph.
- **`test/tui/` needs an awaited tick before writing keys** (`useInput` subscribes in a passive effect).
  `test/tui/select.test.tsx` has an established `mount()` helper that does this — copy it.
- **Commit messages:** `f5(waveT-tN): <what changed>`. No `Co-Authored-By`, no attribution trailers.
- **Do not push and do not open a PR.**
- **Tasks are strictly sequential.** Five files are touched by several tasks (`useChat.ts` by 2, 8, 11,
  13, 15; `main.ts` by 1 and 14; `prefs.ts` by 2 and 14 — both editing the same one-line interface;
  `PlanDialog.tsx` by 10 and 11; the five dialog bodies by 4, 5, 7, 16). Nothing here parallelizes.

---

## Task 1: The interactive REPL launches in manual mode, and says so

**Files:**
- Modify: `harness/src/cli/main.ts:212` (`const { resume, ...hostConfig } = inv.config;`), `:221-224`
  (the `makeHost` call), `:239` (banner `mode:`), `:244` (`hookOpts.initialMode`)
- Modify: `harness/src/cli/hostMain.ts:47` (the `--detachable` child; `kind` is in scope from `:39`)
- Test: `harness/test/unit/cli-main.test.ts` — **extend it**; `:307-370` already injects
  `makeHost: (o) => { hostCalls.push(o); … }` and `runChatClient: async (o) => { clientCalls.push(o); }`
  and asserts on the captured options. That is exactly the seam this task needs; do **not** refactor
  `main.ts` to create one.

**Interfaces:** no new exports. Later tasks assume an interactive session's launch mode is `"default"`
unless the user passed `--permission-mode`.

**Context.** `DEFAULTS.permissionMode` is `"auto"` (`src/config/types.ts:161`), applied at
`src/config/resolveOptions.ts:60-61` — the single seam every surface resolves through. **Do not change
`DEFAULTS`**: headless `-p`, `--bg` and the daemon keep `auto` deliberately (spec W-T1). Two sites build
an *interactive* host:

1. `main.ts` — the foreground REPL.
2. `hostMain.ts` — the `--detachable` child, forked by `main.ts:147-151` via `spawnDetached`, re-entering
   the binary as `--__host <id> --__kind interactive`. `spawn.ts:17-23`'s `configFlags` forwards
   `--permission-mode` **only when explicitly typed**, so a fix at site 1 alone leaves `ccx --detachable`
   — the identical REPL — silently in `auto`.

**This task merges what were two tasks.** Splitting them leaves a one-commit window where the engine runs
`default` while the banner prints `auto` — the same qa3-02 contradiction inverted. The banner must read
the **host's** config, not `inv.config`: `resolvedPermissionMode(inv.config)` still resolves through
`DEFAULTS` to `"auto"` because `inv.config.permissionMode` is undefined without the flag.

- [ ] **Step 1: Write the failing tests**

In `test/unit/cli-main.test.ts`, following the existing capture pattern at `:307`:

- no flag → the captured `makeHost` options' `config.permissionMode` is `"default"`, **and** the captured
  `runChatClient` options' `hookOpts.initialMode` is `"default"`, **and** the welcome-banner entry's text
  names `default`.
- `--permission-mode auto` → all three are `"auto"`.

And for the detachable path (a separate test, using `runHostMain`'s documented `deps.makeHost` seam at
`hostMain.ts:77`):

- `--__host x --__kind interactive` → the host's `config.permissionMode` is `"default"`.
- `--__host x --__kind bg` → the interactive default does **not** leak; `bg` keeps whatever `DEFAULTS`
  gives it.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run typecheck && npx vitest run test/unit/cli-main.test.ts`
Expected: FAIL — today every one of these resolves to `auto` (engine) / `default` (banner).

- [ ] **Step 3: Implement**

In `main.ts`, hoist the host config into a named const so the banner and hookOpts read the same object:

```ts
  // Wave T EP-T1: the REPL launches MANUAL like upstream (2.1.220 `gGl` L41536: `default` → "Manual").
  // QA sprint 1 found `rm` and `git init` running unconsulted because DEFAULTS.permissionMode is "auto"
  // (config/types.ts:161) and every surface resolves through it. Headless (-p/--bg) and the daemon KEEP
  // auto deliberately — a background run has nobody to ask.
  // ONE object, three readers: the host, the banner and hookOpts. Reading `inv.config` for the banner
  // instead would print "auto" (DEFAULTS) while the engine ran "default" — qa3-02 inverted.
  const foregroundConfig = { ...hostConfig, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}),
    permissionMode: inv.config.permissionMode ?? "default" };
  const host = deps.makeHost({ short, name, cwd, kind: "interactive", detached: false,
    ...(inv.worktreePath ? { worktree: inv.worktreePath } : {}), config: foregroundConfig });
```

then `mode: resolvedPermissionMode(foregroundConfig)` at `:239` and
`initialMode: resolvedPermissionMode(foregroundConfig)` at `:244` (import `resolvedPermissionMode` from
`../config/resolveOptions.js` if it is not already imported).

In `hostMain.ts:47`:

```ts
  // Wave T EP-T1: --detachable's child re-enters here with --__kind interactive and never passes through
  // main.ts's foreground construction, while spawn.ts's configFlags forwards --permission-mode only when
  // it was explicitly typed. Without this line `ccx --detachable` presents the identical REPL in `auto`
  // while plain `ccx` consults. A `bg` child keeps auto: it has nobody to ask.
  const base = kind === "interactive" ? { ...inv.config, permissionMode: inv.config.permissionMode ?? "default" } : inv.config;
  const config = kind === "bg" && inv.config.resume ? { ...base, forkSession: true } : base;
```

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit && npm run test:tui`

- [ ] **Step 5: Commit**

```bash
git add -A harness/src/cli harness/test/unit
git commit -m "f5(waveT-t1): interactive REPL launches manual, banner and hookOpts agree (qa3-03, qa3-02)"
```

---

## Task 2: Auto-mode entry notice

**Files:**
- Create: `harness/src/tui/autoModeNotice.ts`
- Modify: `harness/src/tui/prefs.ts:24` (the `CcxPrefs` interface — **one field**; the tolerant loader
  needs no new validation for a boolean, and `savePrefs` is read-merge-write so it will not clobber
  `theme`/`model`)
- Modify: `harness/src/tui/useChat.ts` — the host-state mode arm at `:565-569` (the set is at `:568`)
- Test: `harness/test/tui/auto-mode-notice.test.tsx` (create)

**Interfaces:** produces `AUTO_MODE_DESCRIPTION`, `shouldShowAutoModeNotice(prefs)`,
`AUTO_MODE_NOTICE_DELAY_MS` from `src/tui/autoModeNotice.ts`. **Task 14 also edits `prefs.ts:24`** — expect
a textual conflict there and re-read the file before editing.

**Context (canon L547285-86, L547935-955):** one string, appended as a transcript **notice** row (not a
dialog), **800 ms** after the mode becomes `auto`, **once per install**.

**Drive the test through the host `state` event arm (`useChat.ts:568`), not through `applyMode`.**
`applyMode` has two hazards the state arm does not: `useChat.ts:1437` awaits
`new Promise((r) => setTimeout(r, 0))` *before* setting the mode, which under `vi.useFakeTimers()` never
fires unless the test advances timers first; and at `:1426`, when `model` is `undefined` (the default in a
bare fixture), it appends `auto — can't check this client's model; …` into the very transcript the test
searches. If you must use `applyMode`, seed a known auto-capable model and
`await vi.advanceTimersByTimeAsync(0)` before `await vi.advanceTimersByTimeAsync(800)`.

- [ ] **Step 1: Write the failing tests**

(a) Unit-ish: `shouldShowAutoModeNotice({})` is true; `shouldShowAutoModeNotice({ hasSeenAutoModeEntryWarning: true })`
is false.
(b) Component: deliver a host `state` event with `permissionMode: "auto"`, advance fake timers past
800 ms, assert the transcript contains `Auto mode lets Claude handle permission prompts automatically`;
deliver a second one and assert nothing further is appended. Set `CCX_FLEET_ROOT` to a temp dir.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// tui/autoModeNotice.ts — upstream's AUTO_MODE_DESCRIPTION (2.1.220 L547285-286) and the once-per-install
// gate around it (L547935-955: a mode-keyed effect, an 800ms delay, and the hasSeenAutoModeEntryWarning
// app-config flag). Upstream appends it as a transcript `notice` message via ml(text, "notice") — NOT a
// dialog and NOT a styled block, which is why this module exports only the string and the predicate.
//
// RECORDED DIVERGENCE: upstream's gate `OMa` (L454515-517) is hasSeenAutoModeEntryWarning OR
// `skipAutoPermissionPrompt` at policy/user/flag scope. ccx keeps only the first half — it has no
// settings-scope equivalent for the second.
import type { CcxPrefs } from "./prefs.js";

/** L547286, verbatim — one string, not four lines. */
export const AUTO_MODE_DESCRIPTION =
  "Auto mode lets Claude handle permission prompts automatically — Claude checks each tool call for risky actions and prompt injection before executing. Actions Claude identifies as safe are executed, while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal for long-running tasks. Sessions are slightly more expensive. Claude can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode.";

export function shouldShowAutoModeNotice(prefs: CcxPrefs): boolean { return prefs.hasSeenAutoModeEntryWarning !== true; }

/** L547955. */
export const AUTO_MODE_NOTICE_DELAY_MS = 800;
```

Add `hasSeenAutoModeEntryWarning?: boolean` to `CcxPrefs`. In `useChat.ts`, when the observed mode
becomes `auto`, start an 800 ms timer guarded by a ref (at most once per process) that appends the notice
and calls `savePrefs({ hasSeenAutoModeEntryWarning: true })`. Clear the timer on unmount.

**Accepted behavior, not a bug:** because headless and daemon hosts stay in `auto` (Task 1), `ccx attach`
to a background host prints this notice at attach time. Upstream's per-process ref guard behaves the same
way.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t2): auto-mode entry notice — verbatim L547286, 800ms, once per install"
```

---

## Task 3: An empty amend submits nothing

**Files:**
- Modify: `harness/src/tui/dialogs/optionRows.ts:22-32` (`yesRow`/`noRow`) — **one flag, two lines**
- Test: `harness/test/tui/option-rows.test.ts` (note: **`test/tui`**, not `test/unit`) — `:22` and `:26`
  assert the literal object shape including `allowEmptySubmitToCancel: true` for both rows; **those two
  assertions change**. Plus one dialog-level test.

**Interfaces:** no new API. **Do NOT modify `Select.tsx` in this task.**

**Context (spec W-T6 + W-T17).** Upstream's empty submit *selects the row with no feedback*
(L397113-19) because upstream pairs it with a visible `tab / amend` hint. ccx shipped the fall-through
without the hint, so Tab-then-Enter silently denies the tool — QA `qa3-04`'s repro. The existing flag's
name is inverted from its effect: `allowEmptySubmitToCancel: true` means "carry the empty submit to
`onChange`".

**The whole fix is dropping that flag from the two feedback rows.** An empty Enter then routes to the
dialog's `onCancel`, and every consult body wires `onCancel` to
`escapeFeedbackMode(feedback) → setFeedback(collapsed)` (`GenericPermission.tsx:74` and its four twins),
so the row collapses and the dialog stays open with no decision sent.

**Do not add a `Select` primitive here.** The v1 draft proposed an `ignoreEmptySubmit` option; both
reviewers showed it is unnecessary and dangerous — `Select` is mounted by `ModelPicker`, `ThemeDialog`,
`SessionPicker`, `SettingsDialog`, `RewindPicker`, `MultiSelect`, and the Bash editable-prefix row whose
`allowEmptySubmitToCancel: true` is load-bearing (`bashOptions.ts:188-192` → `bashDecision:213-216` turns
an empty prefix into `allow_once`, matching L505212-17). The one place a new outlet **is** needed is
Task 11. Note also that `Select.tsx:220-221`'s digit path already falls through to `moveTo(index)` once
the flag is gone — **the production change for digits is zero lines**; pin it with a test anyway rather
than hunting for a failing case that does not exist.

- [ ] **Step 1: Write the failing tests**

(a) `noRow(true)` and `yesRow(true)` no longer carry `allowEmptySubmitToCancel` (rewrite `:22`/`:26`).
(b) Dialog-level: render `GenericPermission`, `await` a tick, press Tab, press Enter with nothing typed;
assert `onDecision` was **not** called and the dialog is still mounted. Then type text, press Enter,
assert `onDecision` receives `{ kind: "deny", feedback: "<text>" }`.
(c) Regression pin: pressing the No row's digit with an empty input moves the cursor rather than deciding.

- [ ] **Step 2: Run — expect FAIL** (today the empty Enter fires a bare deny)

- [ ] **Step 3: Implement** — remove `allowEmptySubmitToCancel: true` from both rows and add a sentence to
      the module header recording the divergence and why (cite spec W-T6/W-T17).

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui && npm run test:unit`

A test breaking around the Bash **prefix** row means you touched something you should not have.

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t3): empty submit on a feedback row is a no-op (qa3-04 root cause)"
```

---

## Task 4: Every consult footer advertises amend (and explain, where supported)

**Files:**
- Create: `harness/src/tui/dialogs/ConsultFooter.tsx`
- Modify: `harness/src/tui/dialogs/BashPermission.tsx:94`, `FilePermission.tsx:234` (keeps its
  `paddingX={1}`), `SkillPermission.tsx:69`, `GenericPermission.tsx:80`, `MonitorPermission.tsx:94`
- Test: `harness/test/tui/consult-footer.test.tsx` (create); tighten the three existing assertions named
  below

**Interfaces:** produces `<ConsultFooter inputMode={boolean} explain={"explain" | "hide" | undefined} />`.
**Task 7 passes the `explain` prop from BashPermission.**

**Context (canon L505286, L505188, L505186).** The footer is a `·`-joined dim row. The amend hint renders
**only** when the focused row is a feedback row that is **not already in input mode** (`aZf`). The explain
hint's action flips between `explain` and `hide`.

**Five bodies, not six.** `FetchPermission.tsx` has no footer, deliberately — its header at `:12` records
upstream's bare `jr` with no `feedbackConfig` and no `esc cancel`; the `(esc)` lives inside its No-row
label (spec W-T18). Leave it alone. All five target bodies already compute `inputFocused` (`:62`, `:202`,
`:44`, `:52`, `:67` respectively).

**Chord spelling:** ccx says `esc cancel`, not upstream's `escape / cancel`. This wave does not re-spell it.

- [ ] **Step 1: Write the failing test**

Assert the rendered text in four states: `inputMode={false}` → `esc cancel · tab amend`;
`inputMode={true}` → `esc cancel`; `explain="explain"` → `esc cancel · tab amend · ctrl+e explain`;
`explain="hide"` → `… · ctrl+e hide`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```tsx
// tui/dialogs/ConsultFooter.tsx — the consult dialogs' footer row, transcribed from 2.1.220's L505286:
// a dim `·`-joined hint list. The amend hint is `aZf` (L505186): it renders ONLY while the focused row is
// a feedback row that is not ALREADY in input mode — once you are typing, the hint that told you how to
// start typing is noise. The explain hint's action flips explain/hide (L505286). FetchPermission
// deliberately has no footer: upstream builds it on a bare `jr` with no feedbackConfig, so there is
// nothing to advertise and the `(esc)` lives in its No-row label instead.
import React from "react";
import { Box, Text } from "ink";

export function ConsultFooter({ inputMode = false, explain }: { inputMode?: boolean; explain?: "explain" | "hide" }) {
  const hints = ["esc cancel", ...(inputMode ? [] : ["tab amend"]), ...(explain ? [`ctrl+e ${explain}`] : [])];
  return <Box marginTop={1}><Text dimColor>{hints.join(" · ")}</Text></Box>;
}
```

Replace each body's `<Box marginTop={1}><Text dimColor>esc cancel</Text></Box>` with
`<ConsultFooter inputMode={inputFocused} />`.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui`

**Tighten, don't just re-run:** `test/tui/small-permissions.test.tsx:110`,
`test/tui/file-permission.test.tsx:67` and `test/tui/bash-permission.test.tsx:53` assert
`expect(f).toContain("esc cancel")`, which still passes against the longer string. Change each to assert
the full new footer for the dialog it covers, so the coverage is real.

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t4): consult footers advertise tab amend and ctrl+e (qa3-05); five bodies, fetch stays bare"
```

---

## Task 5: Leaving an empty feedback row collapses it

**Files:**
- Modify: `harness/src/tui/select/Select.tsx` (add `onInputChange`), `harness/src/tui/dialogs/optionRows.ts`
  (add the focus rule), and the five dialog bodies from Task 4
- Test: `harness/test/tui/option-rows.test.ts` (extend), `harness/test/tui/select.test.tsx` (extend)

**Interfaces:** produces `collapseOnFocusChange(mode, focusedValue, isEmpty)` from `optionRows.ts` and a
new optional `onInputChange?: (value: string, text: string) => void` prop on `Select`.

**Context (canon L505162-69):** moving focus away from a feedback row collapses its input mode **if its
text is empty**; a row holding typed text stays open.

**The text is not observable today, so this task adds the one hook that makes it observable.** `Select`
keeps input text privately in an `inputs` map and publishes it upward only via `onChange(value, text)` on
submit; the focus callback reports the value only (`Select.tsx:201`). Without a change, every body would
have to pass "empty" unconditionally and the feature would silently degrade to "always collapse". Add
`onInputChange` where `write()` already updates the map inside `useKeyFallback`, and have the five bodies
keep a small text mirror.

- [ ] **Step 1: Write the failing tests**

(a) `collapseOnFocusChange({ yes: false, no: true }, "yes", true)` → `{ yes: false, no: false }`; with
`false` (non-empty) → unchanged; focusing the row itself never collapses it.
(b) `Select` calls `onInputChange` with the row value and the new text on every keystroke into an input row.
(c) Dialog-level: type into the No row, move focus up, assert the row is still a text row; clear it, move
focus, assert it collapsed.

- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS**
      (`npm run typecheck && npm run test:tui`).

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t5): empty feedback rows collapse when focus leaves (L505162-169)"
```

---

## Task 6: The explain-command module (transport injected, undefaulted)

**Files:**
- Create: `harness/src/tui/dialogs/explainCommand.ts`
- Test: `harness/test/unit/explain-command.test.ts` (create)

**Interfaces:** produces `Explanation` (`{ explanation, reasoning, risk, riskLevel: "LOW"|"MEDIUM"|"HIGH" }`),
`EXPLAIN_SYSTEM_PROMPT`, `EXPLAIN_TOOL_SCHEMA`, `buildExplainPrompt(args)`, `riskLabel(level)`,
`riskColorRole(level)`, an `ExplainTransport` interface, and
`explainCommand(args, transport): Promise<Explanation>`. **Task 7 consumes all of it.**

**SCOPE, and it is deliberate: ship no default transport.** Verified twice, independently: the harness has
**no** one-off Messages path. `harness/package.json` declares one Anthropic package
(`@anthropic-ai/claude-agent-sdk`); `grep -rn "@anthropic-ai/sdk\|new Anthropic\|messages.create\|api.anthropic.com\|fetch(" src/`
returns **zero hits**; and the SDK's `sdk.d.ts` has **zero** occurrences of `tool_choice`, so a forced-tool
call is not expressible through `query()`. `@anthropic-ai/sdk` exists in `node_modules` only as a
transitive peer of the agent SDK. Wiring a real transport therefore needs both a new declared dependency
and an auth decision the repo has never made (the project uses `CLAUDE_CODE_OAUTH_TOKEN`, not an API key)
— that is spec W-T13's probe 98, not this task. **Do not add a dependency. Do not report BLOCKED** — the
task is complete when the constants, helpers, prompt builder, interface and DI'd `explainCommand` are
green.

**Context (canon L504910-42, L504943, L504955, L505005-14, L504995-5004).**

- [ ] **Step 1: Write the failing test**

With a fake transport returning a well-formed tool result, assert `explainCommand` returns the four
parsed fields; with a malformed result, assert it rejects (Task 7 renders `Explanation unavailable`).
Assert `EXPLAIN_SYSTEM_PROMPT` and `EXPLAIN_TOOL_SCHEMA` match the canon strings character for character,
`riskLabel("MEDIUM") === "Med risk"`, and `riskColorRole("HIGH") === "error"`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
/** L504943. */
export const EXPLAIN_SYSTEM_PROMPT = "Analyze shell commands and explain what they do, why you're running them, and potential risks.";

/** L504955 — the forced tool. */
export const EXPLAIN_TOOL_SCHEMA = {
  name: "explain_command",
  description: "Provide an explanation of a shell command",
  input_schema: {
    type: "object",
    properties: {
      explanation: { type: "string", description: "What this command does (1-2 sentences)" },
      reasoning: { type: "string", description: "Why YOU are running this command. Start with \"I\" - e.g. \"I need to check the file contents\"" },
      risk: { type: "string", description: "What could go wrong, under 15 words" },
      riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "LOW (safe dev workflows), MEDIUM (recoverable changes), HIGH (dangerous/irreversible)" },
    },
    required: ["explanation", "reasoning", "risk", "riskLevel"],
  },
} as const;

/** `XQf` L505005-505014. */
export function riskLabel(level: Explanation["riskLevel"]): string { return level === "LOW" ? "Low risk" : level === "MEDIUM" ? "Med risk" : "High risk"; }
/** `YQf` L504995-505004 — theme role names, resolved by the caller's `role()`. */
export function riskColorRole(level: Explanation["riskLevel"]): "success" | "warning" | "error" { return level === "LOW" ? "success" : level === "MEDIUM" ? "warning" : "error"; }
```

`buildExplainPrompt` (L504915-24) produces `Tool: <name>\n`, an optional `Description: <desc>\n`,
`Input:\n` + `JSON.stringify(input, null, 2)`, a blank line, then `Explain this command in context.`
Upstream also supports a recent-context block but calls the generator **without** messages from both
consult sites (L505027), so it is unreachable in practice — omit it and say so in a comment.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t6): explain-command constants, prompt builder and DI'd transport interface"
```

---

## Task 7: ctrl+e toggles the explanation in the Bash consult

**Files:**
- Create: `harness/src/tui/dialogs/ExplanationBlock.tsx`
- Modify: `harness/src/tui/dialogs/BashPermission.tsx`
- Test: `harness/test/tui/explain-toggle.test.tsx` (create)

**Interfaces:** consumes Task 6's module and Task 4's `ConsultFooter`. `BashPermission` gains an injected
`explainCommand` prop (defaulting to undefined → the affordance is absent, which is the shipping state
until spec W-T13's probe resolves).

**Context (canon L505015-52 toggle, L505053-104 render, L505121 / L505058 states, L505286 dimming,
L504907-09 the setting gate).** The first `ctrl+e` starts the request and stores the promise; later
toggles only flip visibility; unmount aborts. While visible, the rendered command line dims **and the
plain tool description row hides**.

- [ ] **Step 1: Write the failing tests**

Render `BashPermission` with an injected transport resolving to a known explanation. Press `ctrl+e`;
assert the explanation text, the reasoning text and `Low risk:` appear; assert the footer now reads
`… · ctrl+e hide`; assert the plain description row is **gone** and the command line is dimmed. Press
`ctrl+e` again; assert they are gone and the description is back. Add a rejecting-transport test
asserting `Explanation unavailable`, a loading test asserting `Loading explanation…`, and a test that
with the setting disabled (`permissionExplainerEnabled: false`) `ctrl+e` does nothing and the footer
shows no explain hint.

- [ ] **Step 2: Run — expect FAIL. Step 3: Implement.**

`ExplanationBlock.tsx` renders, in order: the explanation; the reasoning (margin-top 1); a row of
`<riskLabel>:` in the risk color followed by the risk text. Loading → `Loading explanation…`; rejection →
`Explanation unavailable`.

In `BashPermission.tsx`: hold `{ visible, promise }` state, bind `confirm:toggleExplanation` in the
`Confirmation` keymap context to `ctrl+e` (the file already uses `useKeyActions`/`useKeyScope`), start the
request on first toggle only, abort on unmount, dim the command line and hide the description while
visible, and pass `explain={visible ? "hide" : "explain"}` to `ConsultFooter`.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t7): ctrl+e explanation in the Bash consult (lazy, one-shot, abort on unmount)"
```

---

## Task 8: Two copy fixes and one canon pin

**Files:**
- Modify: `harness/src/tui/dialogs/smallDialogOptions.ts:104` (WebFetch No row)
- Modify: `harness/src/tui/select/Select.tsx:293` (the empty-input separator)
- Test: `harness/test/tui/small-dialog-options.test.ts` (note: **`test/tui`**), `harness/test/tui/select.test.tsx`

**(a) WebFetch.** `smallDialogOptions.ts:104` labels its No row
`No, and tell Claude what to do differently (esc)` while `fetchDecision` (`:110-114`) has no text path at
all — copy promising a channel that cannot deliver. Upstream hangs no `feedbackConfig` here either. Drop
the undeliverable clause; **keep `(esc)`**, because that label is where this footerless dialog's escape
hint lives (spec W-T18).

**(b) The `qa3-06` "double space"** is the inverse-video cursor block plus the `", "` separator
(`Select.tsx:129`, `:293`). When a `withLabel` input row is focused **and empty**, drop the separator's
trailing space so it reads `No,<cursor><placeholder>`. The Bash editable-prefix row sets
`labelValueSeparator: ": "` and must keep its behavior when it has text.

**(c) The generic don't-ask-again row: NO CHANGE — pin it instead.** The v1 draft called
`smallDialogOptions.ts:238` a trust defect ("says commands in this directory, grants the tool everywhere,
forever"). Both halves were wrong (spec W-T16): the copy is upstream verbatim (L506166), so is the
content-less whole-tool rule (L506109), and the grant is **not** "everywhere" — the destination is
`localSettings`, scoped to the project, which ccx matches (`smallDialogOptions.ts:43-45`). Add a comment
above the row recording that it is a transcription, not a bug, and keep the existing exact-string
assertion at `test/tui/small-dialog-options.test.ts:200` as the canon pin.

- [ ] **Step 1: Write the failing tests** for (a) and (b), and add the comment + keep the pin for (c).
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS**
      (`npm run typecheck && npm run test:tui && npm run test:unit`).
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t8): WebFetch no-row copy, empty-input separator; generic row pinned as canon"
```

---

## Task 9: The third interrupt sentinel

**Files:**
- Modify: `harness/src/tui/species.ts` — the sentinel constants at `:73-74` and the classifier at
  `:160-161`; the render arms are `:274` (`interrupt-plain`) and `:561` (`API_ERROR_ABORTED`)
- Test: `harness/test/tui/species-system.test.ts` or the species test file covering interrupts (check
  `ls test/tui | grep -i species`)

**Context (canon L422222-25, sentinels at L108575, sites L422821 / L427691 / L429122).** **Most of this
already ships** — the v1 draft wrongly assumed it absent (spec W-T19). `species.ts:76` defines
`INTERRUPTED_TEXT = "Interrupted · What should Claude do instead?"`; `:73-74` carry the plain-interrupt
and tool-interrupt sentinels; `:274` and `:561` render the row.

**Exactly one sentinel is missing:**

```
The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.
```

matched with **startsWith** on tool-result string content (upstream L429122).

**Do NOT "fix" the tool-form sentinel.** `species.ts:268` returns `null` for `interrupt-tool` on purpose
(rationale at `:258-260`, `:270-272`): the tool row already carries the text and a second line would say
it twice. That is an F3 decision and it stays.

- [ ] **Step 1: Write the failing test** — a tool result whose content starts with the third sentinel
      produces the interrupt row; an interrupted **tool call** still produces it exactly once (the
      existing suppression holds); unrelated text produces nothing.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t9): route the third interrupt sentinel to the existing interrupted row (L429122)"
```

---

## Task 10: Plan approval grants what its label says

**Files:**
- Modify: `harness/src/permissions/types.ts:47` (`plan_approve`)
- Modify: `harness/src/tui/PlanDialog.tsx` — `PLAN_OPTIONS` `:100-104`, `approve` `:194-195`, `pick`
  `:197-207`, the shift+tab binding `"confirm:cycleMode"` at **`:226`** (inside the `useKeyActions` block
  opening at `:222`), and the comment at `:190-193` (update, do not delete)
- Modify **the wire validators — these do NOT fail typecheck**: `harness/src/host/ops.ts:21`
  (`acceptEdits: z.boolean()` inside `structuredAnswer`) and `harness/src/appserver/server.ts:40` (the
  duplicated schema)
- Modify the arming/applying sites: `harness/src/host/host.ts:121` (`planUpgradePending` declaration),
  `:276` (turn-end belt), `:527` (the hard-coded `setPermissionMode("acceptEdits")`), `:663` (arming);
  `harness/src/appserver/server.ts:167` (`if (… && outcome.acceptEdits) armPlanUpgrade(record)`);
  `harness/src/appserver/planUpgrade.ts:32`; `harness/src/appserver/registry.ts:22`, `:51`;
  `harness/src/appserver/turns.ts:90`
- Test: `harness/test/unit/permission-wire.test.ts` (**make one test a wire round-trip** — it already
  references `plan_approve`), plus migrating the call sites in the twelve files listed below

**Interfaces:** `plan_approve` carries the **granted mode** instead of a boolean. Today it is
`{ kind: "plan_approve"; acceptEdits: boolean; updatedPermissions?: PermissionUpdateLike[]; plan?: string }`.
The new mode field is **authoritative**; `updatedPermissions` stays unused for the mode, preserving the
no-double-upgrade rule documented at `PlanDialog.tsx:190-193`. Also produces
`planOptions({ autoAvailable, bypassAvailable })` replacing the frozen `PLAN_OPTIONS` const.

**Context (canon `sYf` L500696-714, `lYf` L500721-38, `gWt` L500932-87).** Upstream's second row is
`Yes, and bypass permissions` (bypass available) / `Yes, and use auto mode` (auto available) /
`Yes, auto-accept edits` (neither). ccx hard-codes the last and always grants `acceptEdits` — the same
keystroke, a strictly narrower grant (`qa3-17`). Clear-context variants are out of scope.

**Availability sources, named** (upstream's `gI()` has no single ccx equivalent): auto is
`isAutoSupportedModel(model)` from `src/config/autoModel.ts`; bypass is the launch-time
`allowDangerouslySkipPermissions` (`resolveOptions.ts:67`). `PlanDialog` takes no `model` prop today —
thread one in, with `autoAvailable` defaulting to `false` when the model is unknown, so an **attach**
client (where `useChat.ts:1423-1426` documents `model` as `undefined` until a turn ends) falls back to
upstream's neither-available arm, `Yes, auto-accept edits`.

**The applier must not re-create the lying chip.** `host.ts:526-530` grants inside a `try` with an empty
`catch {}` and does **no** model swap, unlike `useChat.applyMode` (`:1428-1433`) which swaps first
precisely because auto is model-gated. Per `autoModel.ts`'s recorded contract, an unsupported model makes
`auto` fall back to `default` silently — so without the swap, `this.mode` would be written `"auto"` while
the engine sits in `default`. Do the swap, and report failure instead of swallowing it.

**Twelve test files reference `plan_approve` and must be migrated in this task's commit:**
`test/unit/host-park.test.ts`, `test/unit/index.test.ts` (pins the public API surface),
`test/unit/permission-wire.test.ts`, `test/unit/host-teardown-quartet.test.ts`,
`test/unit/host-mode-sync.test.ts`, `test/unit/permission-gate-decisions.test.ts`,
`test/unit/permissions-decisions.test.ts`, `test/unit/appserver/decisions.test.ts`,
`test/tui/keys-migration-dialogs.test.tsx`, `test/tui/planDialog.test.tsx`, `test/tui/useChat.test.tsx`,
`test/tui/permissionsModel.test.ts`.

- [ ] **Step 1: Write the failing tests** — the option label reflects availability (three cases);
      `pick("yes-resume-auto-mode")` produces the auto grant; the host applier calls `setPermissionMode`
      with the decision's mode; **a wire round-trip through `hostOp` parse succeeds with the new payload**.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**, migrating all twelve test files in the same commit.
- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit && npm run test:tui`
      Both suites must be fully green before committing — the next task's implementer inherits this tree.
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t10): plan approval grants the mode its label names, across both wires (qa3-17)"
```

---

## Task 11: Plan modal furniture and feedback

**Files:**
- Modify: `harness/src/tui/PlanDialog.tsx` — the comment at `:208-211` and `cancel` at `:212`, the
  shift+tab binding at `:226`, the option box border at `:292-293`, the ctrl+g footer at `:302`, the
  editor gate at `:167`
- Modify: `harness/src/tui/select/Select.tsx` — **this is where the new empty-submit outlet belongs**
- Test: `harness/test/tui/planDialog.test.tsx` (note the camelCase filename), plus
  `harness/test/unit/gate-plan-kind.test.ts` (create)

**Context:** five residues from `qa3-16`, plus one guard.

**(a) Dashed rules** around the plan body (`SM`, L424994-425003 — Ink `borderStyle:"dashed"` with left and
right borders off). Today only the DialogFrame's top rule and the option box's border exist.

**(b) The plan file path.** Probe 97 proved the wire carries `input.planFilePath`, and `gate.ts:49-57`
forwards `input` verbatim into the request, so `PlanDialog` can read `req.input.planFilePath` with no new
plumbing. Append ` · <shortened path>` to the ctrl+g footer segment. **Keep the existing
`ctrl+g to edit in {name}` wording** (`:302`) — upstream's is `edit in {name}`, and re-spelling hints is
Wave C's work (spec A8 was amended to match).

**(c) Empty submit on `No, keep planning` is a no-op.** Today an empty Enter routes to `onCancel` → `:212`
→ a feedback-less `plan_reject`. Upstream guards it (L500733, L500976). **This is the one place a `Select`
primitive change is genuinely required**: `cancel` serves two keys that must now diverge — Esc must still
reject (upstream's `xnl`, L500995, answers `{behavior:"deny"}`) while empty Enter must do nothing — and
`Select` gives the caller no way to tell them apart. Add a distinct empty-submit outlet (e.g. an optional
`onEmptySubmit?: (value: string) => void` that, when provided, replaces the `onCancel` fall-through for
that case). Rewrite the comment at `:208-211`, which describes today's behavior.

**Blast-radius guard:** add a test that the Bash editable-prefix row's empty submit still yields
`allow_once` (`bashOptions.ts:188-192` → `bashDecision:213-216`).

**(d) Approve with feedback.** The No row's description says `shift+tab to approve with this feedback`
(L500713), so `shift+tab` (`:226`) and a typed approval must carry the typed text into the approval.

**(e) The guard test.** `gate.ts:21-23` classifies a plan decision by the literal `"ExitPlanMode"` —
probe 97 confirms that is the *only* available signal (of the ten `canUseTool` option fields, four are
defined and none discriminates). Pin the literal, with a comment stating that an upstream rename silently
degrades every plan consult to a generic dialog.

- [ ] **Step 1: Write the failing tests** (one per residue).
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS**
      (`npm run typecheck && npm run test:tui && npm run test:unit`).
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t11): plan dashed rules, planFilePath footer, empty-submit no-op, approve-with-feedback, kind guard"
```

---

## Task 12: The REPL recognises API retries

**Files:**
- Create: `harness/src/tui/retryStatus.ts`
- Modify: `harness/src/tui/useChat.ts` (the message arm, `:503` region)
- Test: `harness/test/unit/retry-status.test.ts` (create), `harness/test/tui/useChat-retry.test.tsx` (create)

**Interfaces:** produces
`RetryStatus = { kind: "stalled" } | { kind: "retrying"; attempt: number; maxRetries: number; deadline: number; label: string }`
and `retryStatusFrom(frame, now)`. **Task 13 renders it.**

**Context (spec W-T12, verified in-tree):** the frames **already arrive**. Route:
`session.ts:258` → `host.ts:269` → `chatAdapter.ts:33` → `useChat.ts:503`. This is a recognition change,
**not** a wire change. Frame shape (probe 96):
`{ type:"system", subtype:"api_retry", attempt, max_retries, retry_delay_ms, error_status, error }`.

**NON-GOAL, and it is load-bearing:** the retry row is live-turn chrome, **not** a transcript row.
`species.ts:641`'s `SILENT_SUBTYPES` path deliberately returns `null` for `api_retry`, and
`test/tui/species-system.test.ts:275-281` already pins that null. **That assertion passes on unmodified
`main` — keep it as a regression pin, do not list it under "expect FAIL".** Making `systemNoticeLines`
paint this frame would break the pin *and* produce ten transcript rows during the observed ten-attempt
ladder instead of one replaced spinner row.

Label rule (canon `b0p`, L408007-11): the literal `API error` unless
`attempt >= Math.min(3, maxRetries)`, then the real error text. ccx has no rate-limit metadata on this
frame, so upstream's other `showDetail` conditions reduce to the attempt count — record that in a comment.

- [ ] **Step 1: Write the failing tests** — `retryStatusFrom` maps a frame to a status with the right
      label at attempt 1 (`API error`) and attempt 3 (the real error text) and a deadline of
      `now + retry_delay_ms`; a non-retry system frame maps to `undefined`. In the useChat test, feed an
      `api_retry` frame and assert the hook exposes the status.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t12): recognise system/api_retry frames as live retry status (probe 96)"
```

---

## Task 13: The retry row replaces the spinner

**Files:**
- Create: `harness/src/tui/RetryRow.tsx`
- Modify: `harness/src/tui/ChatApp.tsx:342` (the single `TurnSpinner` mount)
- Test: `harness/test/tui/retry-row.test.tsx` (create)

**Context (canon L407973, L407989-8001, L408002-34, L407976).** The retry row **replaces** the spinner
while a status is set. Two variants:

- stalled: `✻ ` + `Waiting for API response` (error color) + dim ` · will retry in <dur> · check your network`
- retrying: `✻ ` + `<label>` (error color) + dim ` · Retrying in <dur> · attempt <n>/<max>`

`<dur>` is `Math.max(0, Math.ceil((deadline - now) / 1000))` seconds, formatted `12s` under a minute and
`1m 5s` above it. `✻` is the same glyph the spinner uses (`i5`, L41482), in the error color.
`TurnSpinner.tsx:10` already takes an injectable `now` — mirror it for determinism.

The **stalled** state covers the pre-evidence window: probe 96 measured ~75 s of silence on a blackholed
endpoint before the first retry event, versus ~20 ms on a refused one. **Threshold: 10 seconds** of a turn
with no message of any kind, fed from the existing turn clock.

- [ ] **Step 1: Write the failing test** — render with a retrying status at a fixed injected `now` and
      assert the exact row text; assert the spinner is **absent**; assert the countdown decrements as
      `now` advances; render with a stalled status and assert the other variant.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t13): retry/stalled row replaces the spinner with a live countdown (qa6-05)"
```

---

## Task 14: Measure, then make the failure line honest

**Files:**
- Modify: `harness/src/session/session.ts:92-97` (`resultWaiter`) — **a shared core module**
- Modify: `harness/src/structured/run.ts:29` (the one genuine success classifier)
- Possibly modify: `harness/src/tui/useChat.ts:546` and `:1231-1232`
- Test: `harness/test/unit/session-frames.test.ts` (exists — extend), `harness/test/tui/useChat-error.test.tsx`

**Step 0 — MEASURE FIRST. This is the task's real deliverable.** The v1 draft asserted "the failure
renders twice"; the grounding report that produced that claim hedged it ("I did not run it to confirm the
duplicate"), and the spec review showed the opposite may be true. `session.ts:61` is
`this.done = this.readLoop().catch(() => {})` — the SDK's post-result throw is **swallowed at the session
level**. On probe 96's terminal frame (`subtype:"success"` with `is_error:true`), `resultWaiter`
(`:92-97`, first line `if (m.subtype !== "success") return this.fifoWaiter(m);`) takes the success branch,
`submit()` **resolves**, the turn-end frame carries no `error`, and the REPL may render **zero** `✗`
lines — the only artifact being the synthetic assistant message painted as a warning bullet by
`species.ts:568-576`. The double render belongs to the *other* path, where `submit` rejects.

Write a unit test that feeds probe 96's exact terminal-frame shape through `Session` and records which
path it takes. **Report the finding before implementing** (DONE_WITH_CONCERNS is the right status if the
answer changes the task). Then fix accordingly:

- The success classifier must read `is_error` / `terminal_reason` / `api_error_status`, never `subtype`.
- The transcript must end with exactly **one** honest failure line.

**Blast radius:** `src/session/session.ts` is used by `createHarness`, the daemon supervisor, the
appserver **and** the REPL host. Changing when a turn is judged successful affects every surface. **State
the semantic decision explicitly in your report**: does `submit()` now *reject* on `is_error: true`, or
resolve with an error-tagged result? Pick one, justify it, and cover it in `test/unit/session-frames.test.ts`.

- [ ] **Step 1: Write the measurement test. Step 2: Run it and RECORD the answer.**
- [ ] **Step 3: Write the failing behavior test for the chosen semantics. Step 4: Implement.**
- [ ] **Step 5: Run — expect PASS.** `npm run typecheck && npm run test:unit && npm run test:tui`
- [ ] **Step 6: Commit**

```bash
git commit -am "f5(waveT-t14): classify turn results by is_error, not subtype; one honest failure line"
```

---

## Task 15: The bypass consent gate

**Files:**
- Modify: `harness/src/cli/args.ts` (accept `--dangerously-skip-permissions`; the unknown-flag throw is
  at `:133`, the accepted set at `:40`)
- Create: `harness/src/tui/bypassConsent.tsx`
- Modify: `harness/src/cli/main.ts` — **via a new `MainDeps` seam, not a static import**
- Modify: `harness/src/tui/prefs.ts:24` (persist acceptance; Task 2 also edits this line)
- Modify: `harness/src/tui/useChat.ts:711` (`/yolo`)
- Test: `harness/test/unit/args-bypass.test.ts` (create), `harness/test/tui/bypass-consent.test.tsx` (create)

**`main.ts` must stay React-free.** Its comment at `:22-24` states the guarantee: ink is imported only
inside the default `runChatClient`, via dynamic import, so `-p` and `--bg` never pull ink/React into the
process. A static `import { BypassConsent } from "../tui/…"` breaks that for every headless invocation.
Add a `showBypassConsent` entry to `MainDeps` whose default is
`async (…) => (await import("../tui/bypassConsent.js")).showBypassConsent(…)` — matching how every other
seam there is built, which also keeps the args test React-free.

**Context (canon `SAm`, L554034-79):**

- Title (L554075): `WARNING: Claude Code running in Bypass Permissions mode`, frame color `error`.
- Body (L554070), three paragraphs, verbatim:
  1. `In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially dangerous commands.`
     then a blank line, then
     `This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.`
  2. `By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.`
  3. a link row to `https://code.claude.com/docs/en/security`
- Buttons (L554075): confirm `Yes, I accept`, cancel `No, exit`, **cancel rendered first and focused**.
- Accept persists the acceptance and continues; **decline exits with code 1**; **Escape exits with code 0**
  (L554055-56, L554063-64). Decline does **not** fall back to a safer mode (spec W-T10).
- Once accepted it never shows again (`M8()`, L43492).

**The gate keys on the RESOLVED launch mode**, so both flag spellings are covered by one check.
**`/yolo` is gated too** (spec W-T20): upstream's gate is launch-only, but upstream's ladder cannot reach
bypass at all (`settingsRows.ts:23-27` transcribes that exclusion), so `/yolo` is a ccx-specific hole with
no upstream precedent to inherit. Show the same consent on first use; respect the persisted acceptance.

- [ ] **Step 1: Write the failing tests** — args: `--dangerously-skip-permissions` parses to
      `permissionMode: "bypassPermissions"` (today it throws `unknown flag`). Component: the three
      paragraphs verbatim, cancel focused first; accepting calls `onAccept` and writes the pref;
      declining calls the **injected** exit with `1`; Escape exits with `0`; with the pref already set the
      gate does not render. `/yolo`: first use shows the gate; after acceptance it does not.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement.** Inject the exit function — a test must never call
      `process.exit`.
- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit && npm run test:tui`
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t15): bypass consent gate on launch and /yolo, --dangerously-skip-permissions (qa3-14)"
```

---

## Task 16: A refused mode change is reported

**Files:**
- Modify: `harness/src/tui/useChat.ts:1420-1441` (`applyMode`; the swallowed `.catch(() => {})` is at
  **`:1439`** and the chip paint at **`:1440`**)
- Test: `harness/test/tui/mode-refusal.test.tsx` (create)

**Context:** `allowDangerouslySkipPermissions` is set only from the **launch** mode
(`resolveOptions.ts:66-67`), so a runtime flip to `bypassPermissions` may be refused by the SDK — and
`:1439` swallows the rejection before `:1440` paints the chip. The status bar would then show bypass in
red while the engine is in the previous mode.

**Step 0 — measure it.** Write a test with a session stub whose `setPermissionMode` rejects and confirm
today's code still calls `setMode(next)`. If some other guard already prevents the lie, report
DONE_WITH_CONCERNS explaining what you found and do not invent a fix for a bug that is not there.

- [ ] **Step 1: Write the failing test** — a rejecting `setPermissionMode` leaves the chip on the previous
      mode and appends a visible error line.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement** — surface the rejection; update the local mode only
      after the call resolves.
- [ ] **Step 4: Run — expect PASS. Step 5: Commit**

```bash
git commit -am "f5(waveT-t16): a refused runtime permission-mode change is reported, not painted"
```

---

## Task 17: Create-file consult framing

**Files:**
- Modify: `harness/src/tui/dialogs/FilePermission.tsx:122-131` (the `file-write-diff` branch;
  `(No content)` is at `:129`)
- Test: `harness/test/tui/file-permission.test.tsx` (extend)

**Context (canon `ial` L505666-96, `SM` L424994-425003, `EM` L423741-81).** A **new** file renders as a
plain syntax-highlighted code block with **no line numbers**, inside a box whose only framing is Ink's
dashed top/bottom border (left and right off). **There is no `╌` character anywhere in 2.1.220** — the QA
finding's "numbered diff between `╌╌╌` rules" describes the *overwrite* branch (`lre`, L420073) and must
not be built here (spec W-T9). ccx already has the unnumbered `CodeBlock` and the `(No content)` literal;
the remaining work is the dashed box.

- [ ] **Step 1: Write the failing test** — the create branch renders inside a dashed-bordered box; no
      line-number gutter; empty content still shows `(No content)`.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement** — wrap the `CodeBlock` branch in
      `<Box borderStyle="dashed" borderLeft={false} borderRight={false} paddingX={1}>`. Upstream drops the
      border in accessibility mode (L424996); match that **only** if such a flag already exists in the
      repo, otherwise note the divergence in a comment.
- [ ] **Step 4: Run — expect PASS. Step 5: Commit**

```bash
git commit -am "f5(waveT-t17): create-file consult body sits in a dashed-rule box (qa3-07, corrected)"
```

---

## Task 18: Final verification

**Files:** none — this task runs the spec's acceptance section as written.

- [ ] **Step 1: Full suites**

```bash
cd harness && npm run typecheck && npm run test:unit && npm run test:tui && npm run build
```

Record the counts. All must pass.

- [ ] **Step 2: Walk the spec's acceptance criteria A1–A19**

Open `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md` and check each of A1 through A19.
For each, state either the test that proves it or that it needs the live TTY pass (A1, A3, A10, A10b and
A11 are behavioral — the controller runs those). A6 is gated on spec W-T13's probe: if no transport
landed, record it as "surface shipped, production wiring deferred", not as failed.

- [ ] **Step 3: Report**

Name every criterion and its status; every criterion not met and why; and every work item that shipped
differently from the spec (those become spec Revision Notes, which the controller writes).

- [ ] **Step 4: Commit any test-only additions**

```bash
git commit -am "f5(waveT-t18): final verification pass"
```
