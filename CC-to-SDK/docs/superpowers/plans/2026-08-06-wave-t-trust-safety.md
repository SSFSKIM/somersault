# Wave T — Trust & Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six trust gaps the QA fleet found in `ccx` — the launch permission posture, consult
affordances, plan-modal grants, the invisible-failure surface, the missing bypass consent gate, and two
dialog-framing defects.

**Architecture:** All changes live in the existing `harness/src/{cli,config,tui,permissions}` modules. No
new wire events, no new packages. Three shared primitives are touched and each is isolated in its own
task before dependents build on it: `Select`'s input-submit rule (Task 4), the consult footer (Task 5),
and `plan_approve`'s payload (Task 11).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React + Ink, Vitest, `ink-testing-library`.

**Spec:** `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md` — read the epic your task
belongs to before starting. Canon citations (`L…`) refer to
`~/claude-code-bundle/2.1.220/cli.pretty.js`.

## Global Constraints

- **Dense hand-style, NO Prettier.** Match the surrounding file's formatting exactly. Do not reformat
  lines you did not change.
- **ESM:** every relative import specifier ends in `.js`.
- **TDD:** failing test → run it → minimal implementation → run it → commit. Every task ends committed.
- **Gates before each commit:** `npm run typecheck`, plus the suites covering your change
  (`npm run test:unit` and/or `npm run test:tui`). Both must be green; report the counts.
- **Never read or write the real `~/.claude`.** Tests set `CCX_FLEET_ROOT` to a temp dir (see
  `test/tui/prefs*.test.ts` for the established pattern). A test that touches the real prefs file is a
  defect regardless of whether it passes.
- **Never print or commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.** No task in this plan needs
  a live key; all tests are keyless.
- **Verbatim strings are verbatim.** Where a step gives an upstream string, reproduce it character for
  character including apostrophe style (`don't` straight vs `don’t` curly), `·` middle dots, and the `✻`
  glyph. Where the plan says "curly", it means `’` (U+2019).
- **Commit messages:** `f5(waveT-tN): <what changed>`. No `Co-Authored-By`, no attribution trailers.
- **Do not push and do not open a PR.**

---

## Task 1: REPL launches in manual permission mode

**Files:**
- Modify: `harness/src/cli/main.ts` (host construction — find where the foreground REPL builds its
  `HarnessConfig`/host options)
- Test: `harness/test/unit/cli-main-mode.test.ts` (create) — or extend an existing `cli/main` test file
  if one already covers host construction; check `test/unit/` first.

**Interfaces:**
- Consumes: `resolvedPermissionMode(config)` from `src/config/resolveOptions.ts:113-115` (already exported).
- Produces: nothing new. Later tasks assume a REPL session's launch mode is `"default"` unless the user
  passed `--permission-mode`.

**Context:** `DEFAULTS.permissionMode` is `"auto"` (`src/config/types.ts:161`) and every surface resolves
through `resolveOptions.ts:60-61` — headless `-p`, `--bg`, the daemon, and the REPL. **Do not change
`DEFAULTS`.** Only the foreground REPL's posture changes; headless keeps `auto` deliberately (spec W-T1).

- [ ] **Step 1: Write the failing test**

Read `src/cli/main.ts` first and find the exact seam where the foreground path builds the host's config.
Write a test that asserts: with no `--permission-mode` flag, the config handed to the foreground host has
`permissionMode: "default"`; with `--permission-mode auto`, it is `"auto"`. Follow whatever DI seam
`main.ts` already exposes (it takes injectable deps — mirror the pattern used by neighbouring tests in
`test/unit/`). If `main.ts` has no seam that lets a test observe the constructed config, extract the
config construction into a small exported pure function (e.g. `foregroundHostConfig(inv)`) and test that
— an extraction is preferable to adding a test-only parameter.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run typecheck && npx vitest run test/unit/cli-main-mode.test.ts`
Expected: FAIL — the config carries `auto` (or is absent, resolving to `auto`).

- [ ] **Step 3: Implement**

In the foreground path only, set an explicit `permissionMode` when the invocation did not specify one:

```ts
// Wave T EP-T1: the REPL launches MANUAL like upstream (2.1.220 gGl L41536 `default` → "Manual"). QA
// sprint 1 found `rm` running unconsulted because DEFAULTS.permissionMode is "auto" (config/types.ts:161)
// and every surface resolves through it. Headless (-p/--bg) and the daemon KEEP auto deliberately, so the
// override lives here, at the foreground host construction, and not in DEFAULTS.
permissionMode: inv.config.permissionMode ?? "default",
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npm run typecheck && npx vitest run test/unit/cli-main-mode.test.ts && npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git add -A harness/src/cli/main.ts harness/test/unit/
git commit -m "f5(waveT-t1): REPL launches in manual permission mode (headless keeps auto)"
```

---

## Task 2: Banner and initial mode tell the truth

**Files:**
- Modify: `harness/src/cli/main.ts:239` (welcome banner `mode:`) and `:244` (`hookOpts.initialMode`)
- Test: same file as Task 1, or `harness/test/unit/cli-main-mode.test.ts`

**Interfaces:** Consumes `resolvedPermissionMode` (same import as Task 1).

**Context:** Both sites read `inv.config.permissionMode ?? "default"`. `inv.config.permissionMode` is
`undefined` unless `--permission-mode` was passed, so before Task 1 the banner said `default` while the
engine ran `auto` — QA finding `qa3-02`. After Task 1 those agree by accident for the no-flag case; they
must agree **by construction** for every case, including `--permission-mode auto`.

- [ ] **Step 1: Write the failing test**

Assert that with `--permission-mode auto`, the banner's mode and the initial mode both read `"auto"`
(today they read `"default"`).

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement**

Replace both `inv.config.permissionMode ?? "default"` expressions with `resolvedPermissionMode(inv.config)`.
Import it from `../config/resolveOptions.js` if not already imported.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t2): banner and initial mode read the resolved permission mode (qa3-02)"
```

---

## Task 3: Auto-mode entry notice

**Files:**
- Create: `harness/src/tui/autoModeNotice.ts`
- Modify: `harness/src/tui/prefs.ts` (add the seen-flag to `CcxPrefs`)
- Modify: `harness/src/tui/useChat.ts` (fire it when the mode becomes `auto`)
- Test: `harness/test/tui/auto-mode-notice.test.ts` (create)

**Interfaces:**
- Produces: `AUTO_MODE_DESCRIPTION` (string constant) and
  `shouldShowAutoModeNotice(prefs: CcxPrefs): boolean` from `src/tui/autoModeNotice.ts`.
- Consumes: `loadPrefs`/`savePrefs` from `src/tui/prefs.ts`.

**Context (canon L547285-86, L547935-955):** one string, appended as a transcript **notice** row (not a
dialog), **800 ms** after the mode becomes `auto`, **once per install**. `useChat` already has a `notice()`
helper (see its use at `useChat.ts:546`) and a mode-change path at `:567-570` plus `applyMode` at
`:1420-1441`.

- [ ] **Step 1: Write the failing test**

Two tests: (a) `shouldShowAutoModeNotice({})` is true and `shouldShowAutoModeNotice({ hasSeenAutoModeEntryWarning: true })`
is false; (b) a `useChat` test (mirror the existing `test/tui/useChat*.test.tsx` fixtures) that cycles the
mode to `auto`, advances fake timers past 800 ms, and asserts the transcript contains the notice's opening
words `Auto mode lets Claude handle permission prompts automatically`, and that a second entry into auto in
the same session appends nothing further.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`src/tui/autoModeNotice.ts`:

```ts
// tui/autoModeNotice.ts — upstream's AUTO_MODE_DESCRIPTION (2.1.220 L547285-286) and the once-per-install
// gate around it (L547935-955: a mode-keyed effect, an 800ms delay, and the hasSeenAutoModeEntryWarning
// app-config flag). Upstream appends it as a transcript `notice` message via ml(text, "notice") — NOT a
// dialog and NOT a styled block, which is why this module exports only the string and the predicate.
import type { CcxPrefs } from "./prefs.js";

/** L547286, verbatim — one string, not four lines. */
export const AUTO_MODE_DESCRIPTION =
  "Auto mode lets Claude handle permission prompts automatically — Claude checks each tool call for risky actions and prompt injection before executing. Actions Claude identifies as safe are executed, while actions Claude identifies as risky are blocked and Claude may try a different approach. Ideal for long-running tasks. Sessions are slightly more expensive. Claude can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode.";

/** L547950's `shouldShowAutoModeEntryWarning`, reduced to the one scope ccx has. */
export function shouldShowAutoModeNotice(prefs: CcxPrefs): boolean { return prefs.hasSeenAutoModeEntryWarning !== true; }

/** L547955. */
export const AUTO_MODE_NOTICE_DELAY_MS = 800;
```

Add `hasSeenAutoModeEntryWarning?: boolean` to `CcxPrefs` in `src/tui/prefs.ts` (interface line only — the
tolerant loader needs no new validation for a boolean, matching how `showExpandedTodos` is handled).

In `useChat.ts`, when the mode transitions to `auto` (cover both the local `applyMode` path and the host
`state`-event path at `:567-570`), start an 800 ms timer that, if the prefs flag is unset, appends the
notice and calls `savePrefs({ hasSeenAutoModeEntryWarning: true })`. Guard with a ref so it fires at most
once per process. Clear the timer on unmount.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t3): auto-mode entry notice — verbatim L547286, 800ms, once per install"
```

---

## Task 4: An empty amend submits nothing

**Files:**
- Modify: `harness/src/tui/select/Select.tsx:210-213` (`submitInput`) and `:216-222` (`chooseByDigit`)
- Modify: `harness/src/tui/dialogs/optionRows.ts:22-32` (`yesRow`/`noRow`)
- Test: `harness/test/tui/select.test.tsx` (extend) and `harness/test/unit/option-rows.test.ts` (extend —
  check the exact existing filenames with `ls harness/test/tui harness/test/unit | grep -i select`)

**Interfaces:**
- Produces: a new `SelectOption` field `ignoreEmptySubmit?: boolean`. **Later tasks (5, 12) rely on
  it** — an empty submit on a row carrying it is a no-op: no `onChange`, no `onCancel`.

**Context (spec W-T6, a deliberate divergence):** upstream's empty submit *selects the row with no
feedback* (L397113-19) because upstream pairs it with a visible `tab / amend` hint. ccx has no hint, so the
same rule silently sends a bare deny — QA `qa3-04`'s repro. Note the existing flag's name is inverted
from its effect: `allowEmptySubmitToCancel: true` means "carry the empty submit to `onChange`".

- [ ] **Step 1: Write the failing test**

In the Select test file, render a `Select` whose options include
`{ type: "input", label: "No", value: "no", placeholder: "…", ignoreEmptySubmit: true }`, focus it, press
Enter with no text, and assert **neither** `onChange` **nor** `onCancel` fired. Add a second test that
typing text then Enter still calls `onChange("no", "text")`. Add a third asserting the digit path behaves
identically (pressing the row's digit with an empty input moves the cursor into it rather than submitting).
In the optionRows test, assert `noRow(true)` carries `ignoreEmptySubmit: true` and no longer carries
`allowEmptySubmitToCancel`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`Select.tsx`:

```ts
  /** L397113-397118 / L397229-397232: empty submits cancel unless the option opts out. Wave T EP-T2 adds a
   *  THIRD behavior upstream does not have: `ignoreEmptySubmit` makes an empty Enter a no-op. Upstream can
   *  afford to let an empty amend fall through as a bare deny because it renders a `tab / amend` hint
   *  (L505188) that tells you the row is a text field; ccx shipped the fall-through without the hint, so a
   *  user who pressed Tab then Enter silently denied the tool (QA sprint 1, qa3-04). */
  const submitInput = (o: SelectOption) => {
    const text = textOf(o);
    if (!text.trim() && o.ignoreEmptySubmit) return;
    if (text.trim() || o.allowEmptySubmitToCancel) onChange(o.value, text); else onCancel();
  };
```

and the same guard as the first line of the `o.type === "input"` branch of `chooseByDigit` (fall through to
`moveTo(index)` so a digit on an empty ignore-row moves the cursor, matching the existing no-opt-out path).

Add `ignoreEmptySubmit?: boolean` to `SelectOption` (near `allowEmptySubmitToCancel`, `:46-56`) with a
one-line doc comment.

`optionRows.ts`: `yesRow`/`noRow` in feedback mode swap `allowEmptySubmitToCancel: true` for
`ignoreEmptySubmit: true`, and the module header comment gains a sentence recording the divergence and
why (cite spec W-T6).

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui && npm run test:unit`

**Watch for collateral:** the Bash editable-prefix row (`src/tui/dialogs/bashOptions.ts:191`) also sets
`allowEmptySubmitToCancel` — it is a *different* row with a different meaning (an empty prefix means "allow
with no rule") and must keep its current behavior. If a test for it breaks, the fix is in your change, not
in that test.

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t4): empty submit on a feedback row is a no-op (qa3-04 root cause)"
```

---

## Task 5: Every consult footer advertises amend and explain

**Files:**
- Create: `harness/src/tui/dialogs/ConsultFooter.tsx`
- Modify: `harness/src/tui/dialogs/BashPermission.tsx:94`, `FilePermission.tsx:234`,
  `SkillPermission.tsx:69`, `GenericPermission.tsx:80`, `MonitorPermission.tsx:94`
- Test: `harness/test/tui/consult-footer.test.tsx` (create)

**Interfaces:**
- Produces: `<ConsultFooter inputMode={boolean} explain={"explain" | "hide" | undefined} />` from
  `src/tui/dialogs/ConsultFooter.tsx`. Task 8 passes the `explain` prop from BashPermission.

**Context (canon L505286, L505188, L505186):** the footer is a `·`-joined dim row. The amend hint renders
**only** when the focused row is a feedback row that is **not already in input mode** (`aZf`). The explain
hint's action flips between `explain` and `hide`. `FetchPermission.tsx` has **no** footer upstream either
(its comment at `:12` records this) — leave it alone.

- [ ] **Step 1: Write the failing test**

Render `ConsultFooter` in three states and assert the rendered text:
- `inputMode={false}`, no explain → `esc cancel · tab amend`
- `inputMode={true}`, no explain → `esc cancel` (the amend hint is gone)
- `inputMode={false} explain="explain"` → `esc cancel · tab amend · ctrl+e explain`
- `explain="hide"` → `… · ctrl+e hide`

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```tsx
// tui/dialogs/ConsultFooter.tsx — the consult dialogs' footer row, transcribed from 2.1.220's L505286:
// a dim `·`-joined hint list. The amend hint is `aZf` (L505186): it renders ONLY while the focused row is a
// feedback row that is not ALREADY in input mode — once you are typing, the hint that told you how to start
// typing is noise. The explain hint's action flips explain/hide (L505286). FetchPermission deliberately has
// no footer: upstream builds it on a bare `jr` with no feedbackConfig, so there is nothing to advertise.
import React from "react";
import { Box, Text } from "ink";

export function ConsultFooter({ inputMode = false, explain }: { inputMode?: boolean; explain?: "explain" | "hide" }) {
  const hints = ["esc cancel", ...(inputMode ? [] : ["tab amend"]), ...(explain ? [`ctrl+e ${explain}`] : [])];
  return <Box marginTop={1}><Text dimColor>{hints.join(" · ")}</Text></Box>;
}
```

Replace each dialog's `<Box marginTop={1}><Text dimColor>esc cancel</Text></Box>` with
`<ConsultFooter inputMode={inputFocused} />`. Every one of those five bodies already computes
`inputFocused` (see `GenericPermission.tsx:52`); if one does not, add it the same way.
`FilePermission.tsx:234` keeps its `paddingX={1}` — pass it through or wrap.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui`

Existing dialog snapshot/text assertions will break — they assert the old bare `esc cancel`. Update them
to the new string; that is the point of the task, not a regression.

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t5): consult footers advertise tab amend and ctrl+e explain (qa3-05)"
```

---

## Task 6: Leaving an empty feedback row collapses it

**Files:**
- Modify: `harness/src/tui/dialogs/optionRows.ts` (add the focus rule)
- Modify: the five dialog bodies from Task 5 (wire it into `onFocus`)
- Test: `harness/test/unit/option-rows.test.ts` (extend)

**Interfaces:** Produces `collapseOnFocusChange(mode: FeedbackMode, focusedValue: string, textOf: (v: string) => string): FeedbackMode`
from `optionRows.ts`.

**Context (canon L505162-69):** moving focus away from a feedback row collapses its input mode **if its
text is empty**. A row with typed text stays open.

- [ ] **Step 1: Write the failing test**

`collapseOnFocusChange({ yes: false, no: true }, "yes", () => "")` → `{ yes: false, no: false }`;
with `() => "typed"` → unchanged. Focusing the row itself never collapses it.

- [ ] **Step 2: Run — expect FAIL. Step 3: Implement** the pure function, then call it from each dialog's
`onFocus` handler (they currently just `setFocus`). The text lookup comes from the dialog's own state —
if a body does not track the typed text (most only see it on submit), pass `() => ""` **only** where the
component genuinely cannot know, and record that in the function's doc comment rather than pretending.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit && npm run test:tui`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t6): empty feedback rows collapse when focus leaves (L505162-169)"
```

---

## Task 7: The explain-command request

**Files:**
- Create: `harness/src/tui/dialogs/explainCommand.ts`
- Test: `harness/test/unit/explain-command.test.ts` (create)

**Interfaces:**
- Produces: `explainCommand(args, deps?): Promise<Explanation>` where
  `Explanation = { explanation: string; reasoning: string; risk: string; riskLevel: "LOW" | "MEDIUM" | "HIGH" }`,
  plus `EXPLAIN_SYSTEM_PROMPT`, `EXPLAIN_TOOL_SCHEMA`, `riskLabel(level)`, `riskColorRole(level)`.
  **Task 8 renders what this returns.**

**Context (canon L504910-42, L504943, L504955, L505005-14, L504995-5004):** a real model call with
`tool_choice: {type:"tool", name:"explain_command"}` against the current main-loop model. Probe evidence
(spec EP-T2) says this is fully reproducible headlessly. **DI is mandatory** — the unit test must not
touch the network: take the request function as an injected dep, exactly like the `deps = {...}`
default-parameter pattern used across `src/`.

- [ ] **Step 1: Write the failing test**

With an injected fake that returns a tool-use block, assert `explainCommand` returns the parsed four
fields; with a fake that returns malformed content, assert it rejects (the caller renders
`Explanation unavailable`). Assert the system prompt and tool schema match the canon strings below
character for character. Assert `riskLabel("MEDIUM") === "Med risk"` and
`riskColorRole("HIGH") === "error"`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

Canon constants, verbatim:

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

The user prompt (L504915-24) is `Tool: <name>\n`, an optional `Description: <desc>\n`, `Input:\n` plus
`JSON.stringify(input, null, 2)`, then a blank line and `Explain this command in context.`. Upstream also
supports a recent-context block, but calls the generator **without** messages from both consult sites
(L505027) — so that block is unreachable in practice. Omit it and say so in a comment.

**Decide the transport by reading the code, not by guessing:** find how the harness already issues a
model request outside the main query loop (search `src/` for an Anthropic client or a one-shot messages
helper). If none exists, the request function is a thin injected interface — declare the interface, ship
the DI seam and a default implementation using whatever the repo already depends on, and if there is no
usable path at all, **report BLOCKED with what you found** rather than adding a new dependency.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t7): explain-command request module (forced explain_command tool, DI transport)"
```

---

## Task 8: ctrl+e toggles the explanation in the Bash consult

**Files:**
- Create: `harness/src/tui/dialogs/ExplanationBlock.tsx`
- Modify: `harness/src/tui/dialogs/BashPermission.tsx`
- Test: `harness/test/tui/explain-toggle.test.tsx` (create)

**Interfaces:** Consumes `explainCommand`, `riskLabel`, `riskColorRole` from Task 7 and `ConsultFooter`
from Task 5.

**Context (canon L505015-52 toggle, L505053-104 render, L505121 / L505058 states, L505286 dimming):** the
first `ctrl+e` starts the request and stores the promise; later toggles only flip visibility; unmount
aborts. While visible, the rendered command line dims and the plain description row hides.

- [ ] **Step 1: Write the failing test**

Render `BashPermission` with an injected `explainCommand` that resolves to a known explanation. Press
`ctrl+e`; assert the explanation text, the reasoning text, and `Low risk:` appear, and that the footer now
reads `… · ctrl+e hide`. Press `ctrl+e` again; assert they are gone. Add a test where the injected function
rejects and assert `Explanation unavailable` renders. Add a test asserting the loading state renders
`Loading explanation…` before resolution.

- [ ] **Step 2: Run — expect FAIL. Step 3: Implement.**

`ExplanationBlock.tsx` renders, in order: the explanation, then the reasoning (margin-top 1), then a row
of `<riskLabel>:` in the risk color followed by the risk text. Loading → `Loading explanation…`; rejection
→ `Explanation unavailable`.

In `BashPermission.tsx`: hold `{ visible, promise }` state, bind `confirm:toggleExplanation` in the
`Confirmation` keymap context to `ctrl+e` (follow the existing keymap registration pattern — the file
already uses `useKeyActions`/`useKeyScope`), start the request on first toggle only, abort on unmount, dim
the command line while visible, and pass `explain={visible ? "hide" : "explain"}` to `ConsultFooter`.

- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui`

- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t8): ctrl+e explanation in the Bash consult (lazy, one-shot, abort on unmount)"
```

---

## Task 9: Two copy defects

**Files:**
- Modify: `harness/src/tui/dialogs/smallDialogOptions.ts:104` (WebFetch No row) and `:238` (generic
  don't-ask-again row)
- Modify: `harness/src/tui/select/Select.tsx:293` (the empty-input separator)
- Test: `harness/test/unit/small-dialog-options.test.ts` (extend) and the Select test file

**Context:** three separate defects, all one-liners, batched because they share reviewers.

(a) **WebFetch** (`smallDialogOptions.ts:104`) labels its No row
`No, and tell Claude what to do differently (esc)` while `fetchDecision` (`:110-114`) has no text path at
all — copy promising a channel that cannot deliver. Upstream hangs no `feedbackConfig` here either, so the
fix is the copy: make it `No (esc)` and record the divergence in the comment above it.

(b) **Generic don't-ask-again** (`:238`) reads
`Yes, and don't ask again for <tool> commands in <cwd>` while `genericDecision` (`:244-248`) issues
`allowRule({ toolName })` — a **whole-tool, unscoped, permanent** grant. The row must describe the rule it
writes. Use `Yes, and don't ask again for ${userFacingName}` and add a comment citing the mismatch (spec
EP-T6, the defect QA missed). **Do not widen the rule to match the old copy** — narrowing the copy is the
safe direction (spec W-T8).

(c) **The `qa3-06` "double space"** is the inverse-video cursor block plus the `", "` separator
(`Select.tsx:129`, `:293`). When a `withLabel` input row is focused **and empty**, drop the separator's
trailing space (render `o.label + separator.trimEnd()`), so it reads `No,<cursor><placeholder>`. The Bash
editable-prefix row sets `labelValueSeparator: ": "` and must keep its behavior when it has text.

- [ ] **Step 1: Write three failing tests** — one per defect, asserting the new strings/rendering.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement all three. Step 4: Run — expect PASS**
      (`npm run typecheck && npm run test:unit && npm run test:tui`).
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t9): WebFetch no-row copy, generic grant copy matches the rule, empty-input separator"
```

---

## Task 10: The interrupt transcript row

**Files:**
- Modify: `harness/src/tui/useChat.ts` (or wherever system/assistant frames are classified — see
  `:497-516`)
- Create/modify: whichever module owns transcript notice construction
- Test: `harness/test/tui/interrupt-row.test.tsx` (create)

**Context (canon L422222-25, sentinels at L108575, sites L422821 / L427691 / L429122):** upstream renders
two dim spans, `Interrupted ` and `· What should Claude do instead?`, substituted whenever a message
matches one of three sentinels. **It is a static transcript row, not an input widget** — the next user turn
is an ordinary composer submit.

The three sentinels, verbatim:
- `API Error: Request was aborted.`
- `[Request interrupted by user for tool use]`
- `The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.`

Matching rules differ per site: the first is an **equality** test on assistant error text; the second is
an **includes** test on tool-result string content; the third is a **startsWith** test on tool-result
string content.

- [ ] **Step 1: Write the failing test** — feed each sentinel and assert the transcript gains exactly one
      row reading `Interrupted · What should Claude do instead?`; feed unrelated text and assert nothing.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement** a small pure classifier (`interruptSentinel(text, where)`)
      plus the append. Keep the matching rules distinct — do not collapse all three to `includes`.
- [ ] **Step 4: Run — expect PASS. Step 5: Commit**

```bash
git commit -am "f5(waveT-t10): interrupted transcript row on the three upstream sentinels (L422225)"
```

---

## Task 11: Plan approval grants what its label says

**Files:**
- Modify: `harness/src/permissions/types.ts:47` (`plan_approve`), `harness/src/tui/PlanDialog.tsx`
  (`PLAN_OPTIONS`, `approve`, `pick`), `harness/src/host/host.ts:527` + `:663`,
  `harness/src/appserver/planUpgrade.ts:32`
- Test: `harness/test/unit/plan-approve.test.ts` (create), plus the existing PlanDialog tests

**Interfaces:**
- Produces: `plan_approve` carrying the **granted mode** instead of a boolean. Keep the shape explicit —
  e.g. `{ kind: "plan_approve"; mode: "auto" | "acceptEdits" | "default"; plan?: string }`. **Task 12
  builds on this.**

**Context (canon `sYf` L500696-714, `lYf` L500721-38, `gWt` L500932-87):** upstream's second row is
`Yes, and bypass permissions` (bypass available) / `Yes, and use auto mode` (auto available) /
`Yes, auto-accept edits` (neither). ccx hard-codes `Yes, auto-accept edits` and always grants
`acceptEdits` — the same keystroke, a strictly narrower grant (`qa3-17`). The **clear-context** row family
is out of scope (spec Deferred). Availability upstream is `gI()` (L372364-72: circuit breaker, settings,
model support) — ccx has no equivalent; decide the availability source by reading what the host already
knows (it tracks `this.mode` and the session's capabilities) and, if nothing reliable exists, default to
the auto row and record the decision in the spec's Decision Log rather than inventing a probe.

- [ ] **Step 1: Write the failing test** — assert the option label reflects availability; assert
      `pick("yes-resume-auto-mode")` produces `{ kind: "plan_approve", mode: "auto" }`; assert the host's
      applier calls `setPermissionMode` with the decision's mode (today it hard-codes `"acceptEdits"`).
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.** Widen the type, update `PlanDialog`'s `approve`/`pick` and `shift+tab`
      (`:216`), and update **both** appliers — `host.ts:527` and `appserver/planUpgrade.ts:32`. The
      comment at `PlanDialog.tsx:190-193` explaining why no `setMode` PermissionUpdate rides along stays
      true and must be updated, not deleted.
- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit && npm run test:tui`
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t11): plan approval grants the mode its label names (qa3-17)"
```

---

## Task 12: Plan modal furniture and feedback

**Files:**
- Modify: `harness/src/tui/PlanDialog.tsx`
- Modify: `harness/src/permissions/gate.ts` (guard test only — no behavior change)
- Test: `harness/test/tui/plan-dialog.test.tsx` (extend), `harness/test/unit/gate-plan-kind.test.ts` (create)

**Context:** four separate residues from `qa3-16`, plus one guard.

(a) **Dashed rules** around the plan body (`SM`, L424994-425003 — Ink `borderStyle:"dashed"` with left and
right borders off). Today only the DialogFrame's top rule and the option box's border exist
(`PlanDialog.tsx:292-293`).

(b) **The plan file path.** Probe 97 proved the wire carries `input.planFilePath`. Render it in the ctrl+g
footer segment as ` · <shortened path>` (L501126). The whole footer stays conditional on a resolvable
editor (`PlanDialog.tsx:167`) — that gating is correct and matches upstream's `q$b` (L500870-75).

(c) **Empty submit on `No, keep planning` is a no-op** — apply Task 4's `ignoreEmptySubmit`. Today the
empty Enter routes to `onCancel` → `:212` → a feedback-less `plan_reject`. Upstream guards it
(L500733, L500976). The comment at `:207-211` describing the current behavior must be rewritten.

(d) **Approve with feedback.** The No row's own description says `shift+tab to approve with this feedback`
(L500713) — so `shift+tab` (`:216`) and a typed approval must carry the typed text into the approval.
Thread the Select's live input text into `approve`.

(e) **The guard test.** `src/permissions/gate.ts:21-23` classifies a plan decision by the literal
`"ExitPlanMode"` — probe 97 confirms that is the *only* available signal (every other `canUseTool` option
field is undefined for this tool). Write a test that pins the literal and states in a comment that a
rename upstream silently degrades every plan consult to a generic dialog.

- [ ] **Step 1: Write the failing tests** (one per residue).
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t12): plan dashed rules, planFilePath footer, empty-submit no-op, approve-with-feedback, kind guard"
```

---

## Task 13: The REPL recognises API retries

**Files:**
- Modify: `harness/src/tui/useChat.ts` (message arm, `:503` region)
- Create: `harness/src/tui/retryStatus.ts` (the pure shape + reducer)
- Test: `harness/test/unit/retry-status.test.ts`, `harness/test/tui/useChat-retry.test.tsx`

**Interfaces:**
- Produces: `RetryStatus = { kind: "stalled" } | { kind: "retrying"; attempt: number; maxRetries: number; deadline: number; label: string }`
  and `retryStatusFrom(frame, now): RetryStatus | undefined`. **Task 14 renders it.**

**Context (spec W-T12, verified in-tree):** `host.ts:261-270` emits **every** SDK message and
`useChat.ts:503` already receives every `system` frame — `api_retry` arrives today, unrecognised. This is a
recognition change, **not** a wire change. The frame shape (probe 96):
`{ type:"system", subtype:"api_retry", attempt, max_retries, retry_delay_ms, error_status, error }`.

Label rule (canon `b0p`, L408007-11): the literal `API error` unless
`attempt >= Math.min(3, maxRetries)` or the error is network-down / SSL / rate-limited; then the real error
text. Implement the attempt threshold; ccx has no rate-limit metadata on this frame, so the other
conditions reduce to the attempt count — record that in a comment.

- [ ] **Step 1: Write the failing tests** — `retryStatusFrom` maps a frame to a status with the right
      label at attempt 1 (`API error`) and attempt 3 (the real error text) and a deadline of
      `now + retry_delay_ms`; a non-retry system frame maps to `undefined`. In the useChat test, feed an
      `api_retry` frame and assert the hook exposes the status and that **no transcript notice row** is
      appended for it (`systemNoticeLines` must not double-render it).
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t13): recognise system/api_retry frames as live retry status (probe 96)"
```

---

## Task 14: The retry row replaces the spinner

**Files:**
- Create: `harness/src/tui/RetryRow.tsx`
- Modify: `harness/src/tui/ChatApp.tsx` (where `TurnSpinner` mounts)
- Test: `harness/test/tui/retry-row.test.tsx`

**Context (canon L407973, L407989-8001, L408002-34, L407976):** the retry row **replaces** the spinner
while a status is set — it does not render beside it. Two variants:

- stalled: `✻ ` + `Waiting for API response` (error color) + dim ` · will retry in <dur> · check your network`
- retrying: `✻ ` + `<label>` (error color) + dim ` · Retrying in <dur> · attempt <n>/<max>`

`<dur>` is `Math.max(0, Math.ceil((deadline - now) / 1000))` seconds, formatted `12s` under a minute and
`1m 5s` above it. `✻` is the same glyph the spinner uses (`i5`, L41482), in the error color.

The **stalled** state covers the pre-evidence window: probe 96 measured ~75 s of silence on a blackholed
endpoint before the first retry event, versus ~20 ms on a refused one. Threshold: **10 seconds** of a turn
with no message of any kind (spec Open Questions, settled here). Feed it from the existing turn clock.

- [ ] **Step 1: Write the failing test** — render with a retrying status and assert the exact row text at a
      fixed injected `now`; assert the spinner is **absent**; assert the countdown decrements as `now`
      advances; render with a stalled status and assert the other variant.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement** the component, inject `now` for determinism
      (mirror `TurnSpinner`'s `now = Date.now` prop), and switch the mount in `ChatApp.tsx`.
- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:tui`
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t14): retry/stalled row replaces the spinner with a live countdown (qa6-05)"
```

---

## Task 15: One honest error line per failed turn

**Files:**
- Modify: `harness/src/tui/useChat.ts:546` and `:1231-1232`
- Modify: wherever the terminal `result` frame is classified (search for `subtype` handling of `result`
  frames in `src/tui/` and `src/session/`)
- Test: `harness/test/tui/useChat-error.test.tsx`

**Context (probe 96):** two defects.

(a) **Double render** — a mid-turn failure appends `✗ <msg>` from both the event arm (`:546`) and the
submit-rejection arm (`:1231-1232`), because `chatAdapter.ts:55` rejects the waiter and `:59` forwards the
same event.

(b) **The terminal-frame trap** — on a dead connection the SDK yields a `result` frame whose `subtype` is
still `"success"`, with the failure in `is_error: true`, `terminal_reason: "api_error"`,
`api_error_status`, **and then throws**. A classifier keyed on `subtype` reads a total transport failure as
a completed turn. Read `is_error` / `terminal_reason` instead, everywhere a result frame's success is
judged.

- [ ] **Step 1: Write the failing tests** — feed a turn-end error and assert **exactly one** `✗` line;
      feed a `result` frame with `subtype:"success"` and `is_error:true` and assert it is treated as a
      failure.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement.** For the duplicate, pick one owner (the event arm
      retains history; the rejection arm should not append when the event already did) and comment why.
- [ ] **Step 4: Run — expect PASS. Step 5: Commit**

```bash
git commit -am "f5(waveT-t15): one error line per failed turn; classify results by is_error not subtype"
```

---

## Task 16: The bypass consent gate

**Files:**
- Modify: `harness/src/cli/args.ts` (accept `--dangerously-skip-permissions`)
- Create: `harness/src/tui/BypassConsent.tsx`
- Modify: `harness/src/cli/main.ts` (show it before the REPL starts when launching in bypass)
- Modify: `harness/src/tui/prefs.ts` (persist acceptance)
- Test: `harness/test/unit/args-bypass.test.ts`, `harness/test/tui/bypass-consent.test.tsx`

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

Note: `--permission-mode bypassPermissions` and `/yolo` already reach bypass today with no gate — the gate
must cover the **launch** path here; the runtime path is Task 17's.

- [ ] **Step 1: Write the failing tests** — args: `--dangerously-skip-permissions` parses to
      `permissionMode: "bypassPermissions"` (today it throws `unknown flag`). Component: renders the three
      paragraphs verbatim, cancel focused first; accepting calls `onAccept` and writes the pref; declining
      calls the injected exit with `1`; Escape exits with `0`; with the pref already set the gate does not
      render.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement.** Inject the exit function — a test must never call
      `process.exit`.
- [ ] **Step 4: Run — expect PASS.** `npm run typecheck && npm run test:unit && npm run test:tui`
- [ ] **Step 5: Commit**

```bash
git commit -am "f5(waveT-t16): bypass-permissions consent gate + --dangerously-skip-permissions (qa3-14)"
```

---

## Task 17: A refused mode change is reported

**Files:**
- Modify: `harness/src/tui/useChat.ts:1420-1441` (`applyMode`, note the swallowed `.catch(() => {})` at
  `:1438`)
- Test: `harness/test/tui/mode-refusal.test.tsx`

**Context:** `allowDangerouslySkipPermissions` is set only from the **launch** mode
(`resolveOptions.ts:66-67`), so a runtime flip to `bypassPermissions` (via `/yolo`, the ladder, or the
`set_permission_mode` op) may be refused by the SDK — and `:1438` swallows the rejection before `:1439`
paints the chip. The status bar would then show bypass in red while the engine is in the previous mode.
This is a code-shape hazard, not yet measured live.

**Step 0 (do this first):** measure it. Write a test with a session stub whose `setPermissionMode`
rejects, and confirm today's code still calls `setMode(next)`. If it does not — if some other guard
already prevents the lie — report DONE_WITH_CONCERNS explaining what you found, and do not invent a fix
for a bug that is not there.

- [ ] **Step 1: Write the failing test** — a rejecting `setPermissionMode` must leave the mode chip on the
      previous mode and append a visible error line.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement** — surface the rejection instead of swallowing it,
      and only update the local mode after the call resolves.
- [ ] **Step 4: Run — expect PASS. Step 5: Commit**

```bash
git commit -am "f5(waveT-t17): a refused runtime permission-mode change is reported, not painted"
```

---

## Task 18: Create-file consult framing

**Files:**
- Modify: `harness/src/tui/dialogs/FilePermission.tsx:122-131`
- Test: `harness/test/tui/file-permission.test.tsx` (extend)

**Context (canon `ial` L505666-96, `SM` L424994-425003, `EM` L423741-81):** a **new** file renders as a
plain syntax-highlighted code block with **no line numbers**, inside a box whose only framing is Ink's
dashed top/bottom border (left and right borders off). Empty content renders the literal `(No content)`
(already present at `:131`). **There is no `╌` character anywhere in 2.1.220** — the QA finding's
"numbered diff between `╌╌╌` rules" describes the *overwrite* branch (`lre`, L420073) and must not be
built here (spec W-T9).

- [ ] **Step 1: Write the failing test** — the create branch renders inside a dashed-bordered box; the
      content has no line-number gutter; empty content still shows `(No content)`.
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement** — wrap the `CodeBlock` branch in
      `<Box borderStyle="dashed" borderLeft={false} borderRight={false} paddingX={1}>`. Check whether the
      repo has an accessibility/screen-reader flag; upstream drops the border in that mode (L424996) —
      match it only if such a flag already exists, otherwise note the divergence in a comment.
- [ ] **Step 4: Run — expect PASS. Step 5: Commit**

```bash
git commit -am "f5(waveT-t18): create-file consult body sits in a dashed-rule box (qa3-07, corrected)"
```

---

## Task 19: Final verification

**Files:** none — this task runs the spec's acceptance section as written.

- [ ] **Step 1: Full suites**

```bash
cd harness && npm run typecheck && npm run test:unit && npm run test:tui && npm run build
```

Record the counts. All must pass.

- [ ] **Step 2: Walk the spec's acceptance criteria A1–A13**

Open `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md` and check each of A1 through A13
against the implementation. For each, state either the test that proves it or that it needs the TTY pass
(A1, A3, A10 and A11 are behavioral and need the live harness — the controller runs those).

- [ ] **Step 3: Report**

Write a summary naming: every acceptance criterion and its status, any criterion not met and why, and any
work item from the spec that shipped differently than the spec described (those become spec Revision
Notes, which the controller writes).

- [ ] **Step 4: Commit any test-only additions**

```bash
git commit -am "f5(waveT-t19): final verification pass"
```
