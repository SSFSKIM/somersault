# TUI Clone F6 — Dialogs, Pickers, Panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the harness's nine hand-rolled dialog/picker/panel surfaces with Claude Code 2.1.220's real architecture — one `Select`/`MultiSelect`/`Tabs` primitive set, a permission-dialog *kind registry* rendering inline in the transcript, a real persisted "don't ask again" built by echoing the engine's own `suggestions`, and upstream-exact plan/rewind/picker/panel surfaces.

**Architecture:** A pure `selectModel` core + three Ink primitives (`Select`, `MultiSelect`, `Tabs`) land first; every dialog task then rebuilds one surface on top of them. The permission family is routed by a pure kind matcher (Bash / file-family / sed-as-edit / WebFetch / Skill / Monitor / generic) into per-kind body components sharing one top-rule-only `DialogFrame`; all of them render **inline above the composer with the composer still mounted** (only plan approval is modal). Decisions leave the dialog as a widened `DecisionOutcome` carrying `updatedPermissions`, which the gate forwards to the SDK verbatim (probe 81: `destination:"localSettings"` writes `.claude/settings.local.json` and survives relaunch).

**Tech Stack:** TypeScript + Ink 5 (`ink-testing-library` for tests), Claude Agent SDK `canUseTool` wire, the F2 keymap table (NO `useInput`), F4's diff/markdown leaf renderers, F1 theme tokens.

## Global Constraints

*(copied from the wave discipline; every task's requirements implicitly include these)*

- **Bundle precedence:** `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js` (bundle) > constants pack > census (`docs/superpowers/research/2026-07-31-tui-clone/05-dialogs.md`) > this plan. Every literal below carries its bundle line; reviewers verify at the DEFINITION, not the call site. If the bundle contradicts a plan rule, the bundle wins — record the correction in the ledger and the parity doc.
- **No real `~/.claude` ever** in tests: all persistence goes through `fleetRoot(env)` / injected paths / per-test temp dirs (static backstop in vitest env). `settings.local.json` writes in tests use a temp cwd.
- **Never print or commit** `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`. Live tests gate on them and read from gitignored `CC-to-SDK/.env`; implementers stop at the clean keyless skip.
- **No new `useInput`.** All keys go through the F2 keymap (`useKeyScope`/`useKeyActions`/`useKeyFallback`); contexts `Select`, `Confirmation`, `Tabs`, `MessageSelector`, `ModelPicker`, `Help`, `Task` already exist in `VALID_CONTEXTS` (`src/tui/keys/bindings.ts:15-17`).
- **House style:** dense hand-style, no Prettier; ESM specifiers end in `.js`; DI-by-deps; modules target <500 LoC (hard-think >800); TDD (red → green → typecheck).
- Gates per task: `npm run typecheck` + `npx vitest run test/tui/<touched> test/unit/<touched>` (full `npm run test:unit`+`test:tui` at wave close). Commit per task, no Co-Authored-By, never push.
- **Colours are theme ROLES** (`src/tui/theme.ts`): `permission`, `planMode`, `warning`, `suggestion`, `remember`, `success`, `error`, `claude`, `inactive`, `subtle` — never raw hex in components.
- **SDK reachability facts this wave builds on (do not re-litigate):** probe 78 — `canUseTool`'s 3rd arg carries `signal · suggestions · blockedPath · decisionReason · title · displayName · description · toolUseID · agentID · requestId`; `suppress_always_allow_rule` / `decision_reason_type` / `classifier_approvable` are NEVER forwarded. Probe 81 — echoing a suggestion with `destination:"localSettings"` writes `<cwd>/.claude/settings.local.json` (grammar `Read(//dir/**)`) and a fresh process consults zero times; `EnterPlanMode` never consults (**DG28 unreachable — record, don't build**); task items carry `subject`/`description` (+`status` on update) with owner/blocker/activity schema-optional.

---

### Task 1: The `Select` primitive (ST7 — `jr`/`ZJs` semantics)

**Files:**
- Create: `src/tui/select/selectModel.ts` (pure: windowing, digit selection, layout decisions)
- Create: `src/tui/select/Select.tsx` (Ink rendering + keymap wiring)
- Test: `test/tui/select-model.test.ts`, `test/tui/select.test.tsx`

**Interfaces:**
- Produces (later tasks build every dialog on this — signatures are load-bearing):
```ts
export interface SelectOption {
  value: string; label: string; description?: string; disabled?: boolean;
  type?: "input";                      // RLe input row (L396465)
  placeholder?: string; initialValue?: string;
  showLabelWithValue?: boolean; labelValueSeparator?: string;   // default ", " (L396465)
  allowEmptySubmitToCancel?: boolean;
}
export interface SelectProps {
  options: SelectOption[];
  onChange: (value: string, inputText?: string) => void;   // inputText only from type:"input" rows
  onCancel: () => void;
  hideIndexes?: boolean;               // default false; true ALSO disables digit selection (L397066)
  visibleOptionCount?: number;         // default 5 (L397020)
  inlineDescriptions?: boolean;
  highlightText?: string;
  defaultFocusValue?: string;
  rows?: number; columns?: number;     // terminal dims for clamping (DI; default from useTerminalSize-equivalent)
  focusColor?: string;                 // theme role for the focused row; default "suggestion"
}
// selectModel.ts pure helpers:
export function windowBounds(count: number, focus: number, visible: number): { start: number; end: number };
export function clampVisible(visible: number, rows: number, perOption: 1 | 2 | 3): number;  // max(1, floor((rows-8)/per)) L397256-259
export function digitTarget(options: {disabled?: boolean}[], digit: string): number | -1;   // 1-based absolute, skips disabled, "0" never matches (L396765-786)
```

**Requirements (bundle-verified literals):**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Keys via context `Select` (already in the F2 table): `up`/`k`/`ctrl+p` prev, `down`/`j`/`ctrl+n` next, `pageup`/`pagedown`, `home`/`end`, `enter` accept, `escape` cancel. Reuse/extend `useSelectKeys` — do NOT hand-roll | L186118 |
| 2 | Gutter glyph per row (`uJs`): focused `❯` in `suggestion`; last visible row with more below = dim `↓`; first visible row with more above = dim `↑`; else space. Pointer literal `❯` with ASCII fallback `>` | L396391, L104968 |
| 3 | Numeric indexes `` `${absoluteIndex}.` `` padded to the width of the option count — **1-based and absolute**, not window-relative. Digits `1`–`9` select at that absolute index skipping disabled rows; `0` never matches. `hideIndexes:true` disables BOTH the index column and digit selection (one switch) | L397210, L397241, L397161, L396765-786, L397066 |
| 4 | Row colours: label `success` when current value, `suggestion` when focused, dim when disabled. `highlightText` bolds the matching substring | L397210 |
| 5 | `inlineDescriptions:true` → description inside the same `<Text>` as the label, one space, dimmed. False + compact + no input option + ≥1 description → **aligned two-column**: label column padded to `min(maxLabelWidth, floor(columns*0.6))`, description in a flex column at `marginLeft:2`. Otherwise description on its own line below | L397241, L397171-214 |
| 6 | Paging: `visibleOptionCount` default 5, clamped by `max(1, floor((rows − 8) / perOption))` where perOption = 1 compact / 2 compact-vertical / 3 expanded (this plan ships compact = 1; keep the clamp signature general). NO `+N more` text in Select itself — overflow is ONLY the `↑`/`↓` gutter glyphs | L397256-259 |
| 7 | `type:"input"` rows (`RLe`): focused + `showLabelWithValue` renders `<label><separator>` in `suggestion` followed by a live text input; unfocused with a value renders `label, sep, value`; unfocused without → placeholder in the `inactive` colour. While an input row is focused, `select:next/previous/accept` are **NOT registered** (typing works; up/down still move via… verify at L397115 how movement behaves — transcribe what the bundle does, not an assumption). On submit: non-empty text → `onChange(value, text)`; empty + `allowEmptySubmitToCancel` absent → `onCancel()` — **Enter on an empty input cancels the whole Select** | L396465-652, L397115-118 |
| 8 | Input rows reuse the existing composer editor machinery where practical — but they are single-purpose small inputs; a minimal internal text state (chars + cursor, left/right/backspace) is acceptable and PREFERRED over mounting the full editor. No paste chips inside Select inputs (record as simplification if the bundle's RLe supports image paste — it does, L396465 — we don't: images are a wave non-goal) |  |

**Steps:**

- [ ] **Step 1:** Write failing tests for `selectModel.ts`: `windowBounds` (mid-anchored window, edge clamping), `clampVisible(5, 20, 1) === 5`, `clampVisible(5, 10, 1) === 2`, `digitTarget` skipping disabled and rejecting `"0"`.
- [ ] **Step 2:** Implement `selectModel.ts`; green; typecheck.
- [ ] **Step 3:** Write failing render tests for `Select.tsx`: gutter glyphs at both overflow edges, absolute padded indexes, focused/current/disabled colours, two-column vs inline description layouts, digit selection, input-row placeholder/focused/value states, empty-submit-cancels, `hideIndexes` killing digits.
- [ ] **Step 4:** Implement `Select.tsx`; green; typecheck.
- [ ] **Step 5:** Commit `f6(t1): Select primitive — jr/ZJs windowing, digits, gutter glyphs, input rows`.

---

### Task 2: `MultiSelect` (V3) + `Tabs` primitives; adopt in QuestionDialog and the two tabbed dialogs

**Files:**
- Create: `src/tui/select/MultiSelect.tsx`, `src/tui/select/Tabs.tsx`
- Modify: `src/tui/QuestionDialog.tsx` (multi-select questions onto `MultiSelect` — DG45), `src/tui/SettingsDialog.tsx`, `src/tui/PermissionsDialog.tsx` (tab strips onto `Tabs`)
- Test: `test/tui/multiselect.test.tsx`, `test/tui/tabs.test.tsx`; update `test/tui/question-dialog.test.tsx` + settings/permissions tests

**Interfaces:**
- Produces: `MultiSelect({options, values, onToggle, onSubmit, onCancel, submitButtonText})` — `submitButtonText` is `"Submit"` on the last question, `"Next"` otherwise (caller decides, L504149). `Tabs({tabs: {id, title}[], active, onChange, color?})` + a `TabPanel`-equivalent render slot.

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | V3 rows: `` `${i}.` `` + `[x]`/`[ ]` + label; a submit row shows the bold `submitButtonText` at `marginLeft:3`; `space`/`enter` toggle the focused row, digits `1`–`9` toggle by absolute index, `escape` cancels; Enter on the submit row submits | L397431, L397448 |
| 2 | Tabs item renders **inverse-video, bold, one space padding either side** (`" " + title + " "`). Bindings (context `Tabs`, already in the F2 table): `tab`/`right` next, `shift+tab`/`left` previous | L434983, L435094, L186118 |
| 3 | QuestionDialog multi-select questions use `MultiSelect` (drop the bespoke checkbox code); single-select stays on Task 1's `Select`. Preserve the existing extra rows: `{type:"input", value:"__other__", label:"Other", placeholder: multiSelect ? "Type something" : "Type something."}` (note the trailing-period inconsistency — it is upstream's, keep it) and `{value:"__chat__", label:"Chat about this"}` single-select only | L504097, L504107-115, L504146 |
| 4 | SettingsDialog + PermissionsDialog render their tab strips through `Tabs` with NO behavioural change (Settings tabs `Status`/`Config`/`Usage`/`Stats`; Permissions `Recently denied`/`Allow`/`Ask`/`Deny`/`Workspace`); their existing tab-key handling moves onto the `Tabs` context if not already there | L444355, L472984 |

**Steps:**

- [ ] **Step 1:** Failing tests: MultiSelect toggle/digit/submit-row semantics; Tabs chip rendering + key cycling.
- [ ] **Step 2:** Implement both primitives; green.
- [ ] **Step 3:** Migrate QuestionDialog multi-select; migrate the two tab strips; existing suites stay green (update frame assertions only where the chip rendering legitimately changed — inverse-video chips are the CORRECT new expectation).
- [ ] **Step 4:** Typecheck + touched suites; commit `f6(t2): MultiSelect + Tabs primitives; QuestionDialog/Settings/Permissions adopt them`.

---

### Task 3: The permission wire — suggestions, decisionReason, updatedPermissions end to end

**Files:**
- Modify: `src/permissions/types.ts`, `src/permissions/gate.ts`
- Modify: `src/client/remote.ts` + `src/client/chatAdapter.ts` + daemon decision park serialization (wherever `PermissionRequest`/`DecisionOutcome` cross the UDS — follow the existing field plumbing for `title`/`description`)
- Modify: `src/tui/useChat.ts` (thread new fields into `state.pending`)
- Test: `test/unit/permission-gate.test.ts` (extend), `test/unit/remote-decision-fields.test.ts` (new or extend existing transport test)

**Interfaces:**
- Produces:
```ts
// types.ts — PermissionRequest gains (all optional, absent when the wire omits them):
suggestions?: PermissionUpdateLike[];        // the SDK's own array, passed through untyped-but-shaped
decisionReason?: string; blockedPath?: string; agentID?: string;
// DecisionOutcome permission arm becomes:
| { kind: "allow_once"; updatedInput?: Record<string, unknown> }
| { kind: "allow_with_updates"; updatedPermissions: PermissionUpdateLike[] }
| { kind: "deny"; feedback?: string }
// PermissionUpdateLike = Record<string, unknown> carrying the SDK PermissionUpdate shape verbatim.
```
- `allow_always` **stays accepted** as an inbound outcome for back-compat (daemon console, older clients) and maps to the old in-memory Set; the new dialogs never emit it.

**Requirements:**

| # | Requirement | Source |
|---|---|---|
| 1 | `gate.ts` forwards `options.suggestions`, `options.decisionReason`, `options.blockedPath`, `options.agentID` into `PermissionRequest`. Check `sdk.d.ts` for the exact option key spellings before wiring (probe 78 recorded the runtime names: `suggestions`, `decisionReason`, `blockedPath`, `agentID`) | probe 78 |
| 2 | `allow_with_updates` returns `{behavior:"allow", updatedInput: input, updatedPermissions: d.updatedPermissions}` to the SDK — verbatim echo, NO reshaping. Verify the SDK type name/shape in `sdk.d.ts` (`PermissionResult` allow arm) and cite it in a comment | probe 78/81 |
| 3 | `deny` with `feedback` returns `{behavior:"deny", message: feedback.trim() || denyMessage(...)}` — the feedback IS the deny message (upstream's "tell Claude what to do differently" channel). Check whether the allow arm accepts any feedback/message field in `sdk.d.ts`; if not (expected), record "allow-side feedback unreachable" in the parity doc during Task 15 — do NOT invent a side channel | L504858-874 |
| 4 | Remote/daemon transport: the new request fields and outcome arms serialize across the UDS decision park (plain JSON — verify the park's serializer doesn't whitelist fields; if it does, extend the whitelist). A remote `allow_with_updates` must reach the host gate intact — add a transport-level test | existing A2a plumbing |
| 5 | `useChat`'s `state.pending` carries the new fields to the dialogs untouched | — |

**Steps:**

- [ ] **Step 1:** Failing gate tests: suggestions/decisionReason forwarded into the broker's request; `allow_with_updates` echoes `updatedPermissions` on the SDK result; deny feedback becomes the message; pre-abort still denies.
- [ ] **Step 2:** Implement types + gate; green.
- [ ] **Step 3:** Failing transport test (fake UDS pair or the existing remote test harness): round-trip a request with suggestions and an `allow_with_updates` answer.
- [ ] **Step 4:** Implement plumbing; green; typecheck.
- [ ] **Step 5:** Commit `f6(t3): permission wire — suggestions/decisionReason in, updatedPermissions out, transport intact`.

---

### Task 4: Dialog frame, kind registry, destructive table, consent line

**Files:**
- Create: `src/tui/dialogs/DialogFrame.tsx` (the `Ed` frame + `BAe` header), `src/tui/dialogs/permissionKind.ts` (pure router), `src/tui/dialogs/destructive.ts` (the 16-pattern table), `src/tui/dialogs/consentReason.ts`
- Test: `test/tui/dialog-frame.test.tsx`, `test/tui/permission-kind.test.ts`, `test/tui/destructive.test.ts`

**Interfaces:**
- Produces:
```ts
export type PermissionKind = "bash" | "file" | "webfetch" | "skill" | "monitor" | "generic";
export function permissionKind(toolName: string, input: Record<string, unknown>): { kind: PermissionKind; sedEdit?: { path: string; pattern: string; replacement: string } };
export function destructiveWarning(command: string): string | undefined;   // the MQg table
export function DialogFrame(props: { title: string; subtitle?: string; color?: ThemeRole; subagentType?: string; workflowName?: string; children: ReactNode }): JSX.Element;
export function consentReasonLine(decisionReason: string | undefined): string | undefined;
```

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Frame = `borderStyle:"round"` with `borderLeft/Right/Bottom: false` (**top rule only**), default `borderColor` role `permission` (`planMode` for plan dialogs, `warning` for pauses — a prop), `marginTop:1`. Screen-reader prefix `"Permission Required:"` — render as an `aria-label`-equivalent hidden text if Ink supports none, else a leading zero-width-styled text; transcribe what is *achievable* and record | L437992-438014 |
| 2 | Header: `<title bold color={color}>` + optional dim subtitle (`wrap:"truncate-start"`), + attribution suffix (DG21): subagent → `` `· from the ${agentName} agent` `` (fallback `· from a subagent`); workflow → `` `· from the "${name}" workflow` `` (fallback `· from a workflow`); the `·` dimmed. Attribution comes from `req.subagentType` (existing correlation map) — the OLD `Subagent (<type>) asks:` line above the frame DIES here | L437937-986, L437941-957 |
| 3 | Kind router: Bash → `bash`, UNLESS the command parses as a sed in-place edit → `file` with a simulated-diff descriptor. Sed recognition (`c1t`): transcribe the bundle's actual matcher at L228484-494 — read it FIRST; a bounded transcription (e.g. `sed -i[ext] s/pat/repl/[flags] file`) is acceptable only if it matches the bundle's accepted forms; cite what you transcribed. File family = Edit / Write / NotebookEdit / Read (`qrn` L279179-246, only when a file path can be derived from the input — else fall through to `generic`). WebFetch → `webfetch`, Skill → `skill`, Monitor → `monitor`, everything else (incl. MCP tools) → `generic` | L279380, L279164, L228484-494 |
| 4 | `destructive.ts`: the 16-entry pattern → warning table, verbatim (patterns are regexes over the command; transcribe `MQg` at L154440 — the table in the census lists: `git reset --hard`→`Note: may discard uncommitted changes`, `git push … --force/-f`→`Note: may overwrite remote history`, `git clean -f`→`Note: may permanently delete untracked files`, `git checkout .`/`git restore .`→`Note: may discard all working tree changes`, `git stash drop\|clear`→`Note: may permanently remove stashed changes`, `git branch -D`→`Note: may force-delete a branch`, `--no-verify`→`Note: may skip safety hooks`, `git commit --amend`→`Note: may rewrite the last commit`, `rm -rf`→`Note: may recursively force-remove files`, `rm -r`→`Note: may recursively remove files`, `rm -f`→`Note: may force-remove files`, `DROP|TRUNCATE`→`Note: may drop or truncate database objects`, `DELETE FROM x;`→`Note: may delete all rows from a database table`, `kubectl delete`→`Note: may delete Kubernetes resources`, `terraform destroy`→`Note: may destroy Terraform infrastructure`). **Read the bundle's regexes at L154440 and transcribe them exactly** — the census rows are summaries, not the patterns | L154440 |
| 5 | `consentReasonLine`: probe 78 ceiling — only the free-text `decisionReason` string is reachable. Render it as-is above the option list (the `safetyCheck`/`other` arm of `mDr`); the typed variants and config-hint lines are UNREACHABLE (recorded, not built) | L500532-600, probe 78 |

**Steps:**

- [ ] **Step 1:** Failing tests: router (each family, sed-as-edit positive + negative, file-family-without-path falls to generic); destructive table (one positive per row + non-matching command → undefined); frame render (top-rule-only, attribution suffix arms).
- [ ] **Step 2:** Read the bundle at L154440, L228484-494, L279164-246 and transcribe; implement all four modules; green; typecheck.
- [ ] **Step 3:** Commit `f6(t4): dialog frame + kind registry + destructive table + consent line`.

---

### Task 5: Inline-in-transcript dialog mount (DG27)

**Files:**
- Modify: `src/tui/ChatApp.tsx` (the `state.pending` arm moves OUT of the composer-replacement ternary chain), `src/tui/ChatComposer.tsx` (accept a `keysSuspended`-style prop only if needed — prefer the existing `inputOwnerRef` discipline)
- Test: `test/tui/chat.test.tsx` (extend), `test/tui/inline-dialog.test.tsx` (new)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Permission + question dialogs render **between the transcript and the composer**, with the composer still mounted and visible below (`if ((layouts[kind] ?? "inline") !== variant) return null` — everything except exit-plan-mode is `"inline"`) | L507345-351, L507338 |
| 2 | Keyboard ownership: the dialog's contexts (`Confirmation`/`Select`) are innermost while mounted — the composer must NOT consume printable keys while a dialog is up. Drive this through `inputOwnerRef` (the existing ownership seam) — the composer already yields when it doesn't own input; verify and pin the frame + key routing in tests | — |
| 3 | The composer's draft survives a dialog appearing and resolving (it already survives dialog swaps via the editorStateRef machinery — pin it for the inline arrangement) | — |
| 4 | Plan approval (`kind === "plan"`) STAYS modal (composer-replacing) — it is upstream's one `layout:"modal"` dialog | L507338 |
| 5 | The RestoringModal / overlays (pager, history search, shortcuts) keep their existing precedence over the inline dialog; no reachability regression for a parked decision (the F3 accepted-oddity comment in ChatApp stays true) | — |

**Steps:**

- [ ] **Step 1:** Failing tests: frame shows transcript + dialog + composer simultaneously for a pending permission; typing while dialog up edits nothing in the composer; digit answer resolves; composer draft intact after resolve; plan dialog still replaces the composer.
- [ ] **Step 2:** Restructure ChatApp's render chain; green (expect to update existing chat.test frame pins that asserted the composer disappears — those pins encoded the OLD divergence and die here).
- [ ] **Step 3:** Typecheck + full `test/tui` for this area; commit `f6(t5): permission/question dialogs render inline above the mounted composer`.

---

### Task 6: The Bash permission dialog (DG2, DG3, DG5, DG24)

**Files:**
- Create: `src/tui/dialogs/BashPermission.tsx`, `src/tui/dialogs/bashOptions.ts` (pure option builder + prefix seed)
- Modify: `src/tui/PermissionDialog.tsx` → becomes the kind switchboard (routes to per-kind bodies; this task lands bash + keeps the old generic body for not-yet-built kinds)
- Test: `test/tui/bash-permission.test.tsx`, `test/tui/bash-options.test.ts`

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Title `"Bash command"` (we never sandbox → the `(unsandboxed)` variant is dead here; record). Body: the command (F4 highlight styling for code is NOT used upstream here — render plain, then `e.description` dimmed below when present) | L505286 |
| 2 | Warning line from Task 4's `destructiveWarning(command)`, colour `warning`, rendered between body and question | L505258-260 |
| 3 | Question line `"Do you want to proceed?"` | L505286 |
| 4 | Options via `Select` (`$Qf` order): 1. `"Yes"` → `allow_once`. 2. Input row `label:"Yes, and don’t ask again for"` (**curly apostrophe U+2019** — the one row upstream types it), `placeholder:"command prefix (e.g., npm run *)"`, `initialValue` = prefix seed, `showLabelWithValue:true`, `labelValueSeparator:": "` → `allow_with_updates` with `[{type:"addRules", rules:[{toolName:"Bash", ruleContent:<typed prefix>}], behavior:"allow", destination:"localSettings"}]`; empty prefix ⇒ plain `allow_once`. 3. When `suggestions` non-empty: a summary row (`Wdi` wording — commands only: `` `Yes, and don't ask again for ${cmds} commands in **${cwd}**` ``; transcribe the other three arms from L504780-804 only if the suggestion kinds can arrive for Bash) → `allow_with_updates` echoing `req.suggestions` verbatim. 4. `"No"` as `type:"input"` row `placeholder:"and tell Claude what to do differently"`, `allowEmptySubmitToCancel:true`… **verify at L504874** whether No is an input row by default or only in feedback mode — transcribe the default rendering; empty submit → plain deny, text → deny with feedback | L504855-878, L505204-223, L504780-804 |
| 5 | Prefix seed: from a single suggested Bash rule's `ruleContent` when present, else `` `${firstWord(cmd)} *` `` (the bundle refines async from a parsed command — L505240-257; our seed is the sync arm; record the async refinement as not built) | L505225-236 |
| 6 | Footer hint line: `esc cancel` (+ the explain/amend hints are DG4/non-goals — omit; record) | L505286 |
| 7 | Digit/legacy fallback keys (1/2/3, y/n, a/A/d) preserved for the switchboard — the old dialog's key contract must not regress for other kinds this task doesn't touch |  |

**Steps:**

- [ ] **Step 1:** Failing tests: pure builder (option order, prefix ruleContent, suggestion echo verbatim, empty-prefix downgrade); render (title/command/warning/question, curly apostrophe pin, dangerous command shows the exact warning literal).
- [ ] **Step 2:** Implement builder + component + switchboard routing; green; typecheck.
- [ ] **Step 3:** Commit `f6(t6): Bash permission dialog — warning table wired, prefix don't-ask-again, suggestion echo`.

---

### Task 7: The file permission dialog (DG6–DG10, DG12)

**Files:**
- Create: `src/tui/dialogs/FilePermission.tsx`, `src/tui/dialogs/fileOptions.ts` (pure: titles, questions, session rows, symlink warning, sed simulated diff)
- Modify: the Task 6 switchboard (route `file` kind)
- Test: `test/tui/file-permission.test.tsx`, `test/tui/file-options.test.ts`

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Per-tool title/subtitle/question (`UMy`): Edit → `"Edit file"` / rel path / verb `"make this edit to"`; Write existing → `"Overwrite file"` / `"overwrite"`; Write new → `"Create file"` / `"create"`; NotebookEdit → `"Edit notebook"` with insert/delete/edit verbs; Read-family fallback → `` `${isReadOnly ? "Read" : "Edit"} file` `` with plain `"Do you want to proceed?"` | L228435-467 |
| 2 | Question renders `Do you want to <verbPhrase> **<basename>**?` — **basename**, not full path (`Tem`) | L505855-859 |
| 3 | Body = real inline diff using F4's existing diff leaf (`diffRender.ts`/`diffSource.ts`): Edit → old/new edit diff; Write → write preview (new-file all-adds; fallback plain highlighted content with `"(No content)"` when empty) | L505860-881, L505666, L505687 |
| 4 | Sed-as-edit (from Task 4's router): simulated diff by applying the parsed substitution to the file's current content; states `"Pattern did not match any content"` / `"File does not exist"` when applicable | L228484-494 |
| 5 | Symlink warning (colour `warning`): resolve the path; if it is a symlink whose target escapes cwd → `` `This will modify ${target} (outside working directory) via a symlink` ``, else if symlink → `` `Symlink target: ${target}` `` | L505896 |
| 6 | Options (`tal`): 1. `"Yes"` → allow_once. 2. If path inside `.claude/` (project or `~`) and not a read: `"Yes, and allow Claude to edit its own settings for this session"` → `allow_with_updates` `[{type:"addRules", rules:[{toolName:"Edit", ruleContent:<the .claude dir>}], behavior:"allow", destination:"session"}]`. 3. Else ONE session row by in-dir × read/write: in-dir read `"Yes, during this session"`; in-dir write `` `Yes, allow all edits during this session **(shift+tab)**` ``; out-of-dir read `` `Yes, allow reading from **<dir>/** during this session` ``; out-of-dir write `` `Yes, allow all edits in **<dir>/** during this session **(shift+tab)**` `` — the `(shift+tab)` literal is the live-resolved `chat:cycleMode` binding via the F2 hint machinery, not a hard-coded string. Effect: **echo `req.suggestions` verbatim when present** (probe 78: file writes suggest `setMode acceptEdits`, reads suggest a directory-glob addRules — the wording-follows-suggestion-kind design); when absent, construct `addRules` with the directory glob, destination `session`. 4. `"No"` input row as in Task 6 | L505624-654, L505840-854, probe 78 |
| 7 | shift+tab while this dialog is focused picks the accept-session option directly (`confirm:cycleMode` — add the binding to the `Confirmation` context in the F2 table if absent; it must resolve in the hint machinery so requirement 6's label stays truthful) | L505895 |
| 8 | Two suggestion variants (raw + `/private` symlink-resolved) may arrive: pick the FIRST; record the pick in a comment | probe 78/81 |

**Steps:**

- [ ] **Step 1:** Failing pure tests: title/question table per tool; session-row wording matrix (4 arms); .claude row detection; sed simulation incl. no-match/no-file; symlink warning arms.
- [ ] **Step 2:** Implement pure module; green.
- [ ] **Step 3:** Failing render tests: diff body present inline, basename bolding, shift+tab picks session row, suggestion echo on accept.
- [ ] **Step 4:** Implement component + routing; green; typecheck.
- [ ] **Step 5:** Commit `f6(t7): file permission dialog — per-tool titles, inline diff body, session rows, sed simulation`.

---

### Task 8: WebFetch, Skill, Monitor, and the generic dialog (DG13–DG15, DG19)

**Files:**
- Create: `src/tui/dialogs/FetchPermission.tsx`, `src/tui/dialogs/SkillPermission.tsx`, `src/tui/dialogs/MonitorPermission.tsx`, `src/tui/dialogs/GenericPermission.tsx` (+ one shared pure `smallDialogOptions.ts` if it keeps each body <120 LoC)
- Modify: switchboard routes all four; the OLD generic body dies here (every kind now has a real component)
- Test: `test/tui/small-permissions.test.tsx` (+ pure test file)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | WebFetch: title `"Fetch"`; body = rendered tool-use line + dim description; question `"Do you want to allow Claude to fetch this content?"`; options `"Yes"` / `` `Yes, and don't ask again for **${hostname}**` `` → `allow_with_updates` `[{type:"addRules", rules:[{toolName:"WebFetch", ruleContent:"domain:"+hostname}], behavior:"allow", destination:"localSettings"}]` (row suppressed when hostname empty) / `` `No, and tell Claude what to do differently **(esc)**` `` | L506735-816, L506721-730 |
| 2 | Skill: title `` `Use skill "${skill}"?` ``; options `"Yes"` / `` `Yes, and don't ask again for **${skill}** in **${cwd}**` `` → addRules `{toolName:"Skill", ruleContent: skill}` → localSettings / (skill name contains a space) `` `Yes, and don't ask again for **${prefix}:\*** commands in **${cwd}**` `` → ruleContent `"<firstWord>:*"` / `"No"` | L506582-710, L506560-573 |
| 3 | Monitor: body by payload — MCP poll `` `Poll **${server}/${tool}** every ${intervalMs/1000}s` ``; WebSocket `` `Open WebSocket **${url}**` `` + optional `` `subprotocols: **${list}**` ``; else the raw command; then dim description. Options `"Yes"` / suggestion row (`itm`: `` `Yes, and don't ask again for **${toolName}(${ruleContent})**` `` when exactly one suggested rule with content, else `` `Yes, and add ${n} suggested permission rules` ``) → echo suggestions verbatim / `"No"`. Title: the bundle's constant was not resolved by the census (recorded "not determined") — READ the bundle around L506006-093, resolve `cA`, and use what you find; if genuinely unresolvable use `"Monitor"` and record | L506006-093, L505982-8005 |
| 4 | Generic: title `"Tool use"`; body `<userFacingName>(<rendered first-arg summary>)` + dim `" (MCP)"` suffix when the tool is MCP-namespaced (`mcp__` prefix — our reachable test) + description clipped to 3 lines; question `"Do you want to proceed?"`; options `"Yes"` / `` `Yes, and don't ask again for **${name}** commands in **${cwd}**` `` → addRules `{toolName}` (whole-tool, NO ruleContent) → localSettings / `"No"` input row | L506118-260, L506108-109 |
| 5 | All four sit in the shared `DialogFrame` with consent line + attribution; all echo `req.suggestions` verbatim when a dialog-specific rule isn't typed and suggestions exist (suggestion-first policy) | — |

**Steps:**

- [ ] **Step 1:** Failing tests per dialog: title/question/option literals, rule payloads (domain:, skill exact + prefix:*, whole-tool no-content), MCP suffix, description 3-line clip, Monitor body arms.
- [ ] **Step 2:** Implement all four; delete the old generic body; green; typecheck.
- [ ] **Step 3:** Commit `f6(t8): WebFetch/Skill/Monitor/generic permission dialogs — registry complete`.

---

### Task 9: Plan approval rebuilt (DG29–DG31, DG34; DG28 recorded unreachable)

**Files:**
- Modify: `src/tui/PlanDialog.tsx` (full rebuild), `src/tui/useChat.ts` (plan outcome plumbing if the widened outcomes need it)
- Test: `test/tui/plan-dialog.test.tsx` (rebuild)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Modal layout (stays composer-replacing — Task 5 req 4): a scrollable region holding a `DialogFrame` titled `"Ready to code?"`, colour `planMode`, body `"Here is Claude's plan:"` then the plan rendered through F4's markdown renderer, then the consent line; below the scroll region a **separate top-bordered `planMode` box** with the prompt + options | L501091-136 |
| 2 | Prompt line: `"Claude has written up a plan and is ready to execute. Would you like to proceed?"` | L501121 |
| 3 | Options (the reachable subset of `sYf` — clear-context family DG32 and Ultraplan are non-goals): 1. `"Yes, auto-accept edits"` → `plan_approve` + `allow_with_updates`-style `updatedPermissions: [{type:"setMode", mode:"acceptEdits", destination:"session"}]` (verify the SDK accepts setMode on the ExitPlanMode result — probe 78 saw the engine ITSELF suggest exactly this shape; if `req.suggestions` carries it, echo that). 2. `"Yes, manually approve edits"` → plain `plan_approve` (mode default). 3. `{type:"input", label:"No, keep planning", value:"no", placeholder:"Tell Claude what to change", description:"shift+tab to approve with this feedback"}` | L500696-714 |
| 4 | DG31: submitting the keep-planning input EMPTY keeps the dialog open (returns null internally — no outcome emitted); non-empty → `plan_reject` with the feedback | L500732-736 |
| 5 | DG34: `ctrl+g` opens the plan in `$EDITOR` (reuse `externalEditor.ts`'s **sync** `editExternal` — the F5 real-TTY lesson: spawnSync paint-then-block + `restoreTtyNonblock` after; NEVER the async path); after a save render a `success`-coloured `✓ Plan saved!`; the edited text is what an approve hands back — verify what upstream does with the edited plan (L501126 area) and transcribe: if upstream only saves to disk without feeding back, do that | L501126 |
| 6 | Keep the existing `plan_approve`/`plan_reject` outcome contract working for the daemon console path (`acceptEdits` boolean maps from option 1 vs 2) | existing types |

**Steps:**

- [ ] **Step 1:** Failing tests: frame (title/colour/prompt literals, markdown body), option list + effects, empty-feedback keeps dialog open, non-empty rejects with feedback, ctrl+g → editor seam (DI-injected editor fn) + saved line.
- [ ] **Step 2:** Rebuild; green; typecheck.
- [ ] **Step 3:** Commit `f6(t9): Ready-to-code plan approval — modal frame, input keep-planning, ctrl+g edit`.

---

### Task 10: Rewind (DG38–DG40, DG42, DG44)

**Files:**
- Modify: `src/tui/RewindPicker.tsx` (rebuild on `Select`-adjacent list semantics — the MessageSelector context), `src/tui/commands.ts` (aliases), `src/tui/useChat.ts` (batch dry-run on open; failure copy)
- Test: `test/tui/rewind-picker.test.tsx` (extend/rebuild)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | `/rewind` gains aliases `checkpoint` and `undo`; frame title `"Rewind"`, colour `suggestion` | L353066, L487190 |
| 2 | Row second line computed **before** selection: on open, run the dry-run for every anchor (sequentially, newest-first, updating rows as results land — cheap per existing `rewindDryRun`); render `` `${basename} ` ``+`+A −R` badge (one file) / `` `${n} files changed ` ``+badge / `"No code changes"`; when the dry-run fails or is unavailable → `⚠ No code restore` in `warning` | L487192, L487289-348 |
| 3 | Synthetic rows: trailing italic `"(current)"`; the leading `/resume <id> (previous session)` row only when a parent session is known — our `RewindOps` has no parent-session concept: OMIT and record in the parity doc (do not fake it) | L487294 |
| 4 | List prompt `"Restore the code and/or conversation to the point before…"`; empty state `"Nothing to rewind to yet."`; scroll indicators `↑ N more above` / `↓ N more below`; footer `enter to continue · esc to cancel` | L487190 |
| 5 | Confirmation panel: prompt `Confirm you want to restore [the conversation ]to the point before you sent this message:` + the message preview in a left-bordered box + `(<relative time>)`. Options `Restore code and conversation` / `Restore conversation` / `Restore code` / `Never mind` (summarize pair is DG41 — non-goal). Per-option explanation lines: `"The conversation will be forked."` · `"The conversation will be unchanged."` · `"The code will be unchanged."` · `` `The code will be restored +A −R in <file summary>.` `` (file summary = basename, `a and b`, or `first and N other files`) + warning `⚠ Rewinding does not affect files edited manually or via bash.` Default focus `both` when code restore is possible, else `conversation` | L487069-072, L487195-288 |
| 6 | Partial-failure copy: `` `Restored the code, but skipped ${n} files: <reason>. Skipped files were left untouched — run with --debug for the paths.` `` and `Failed to restore the conversation and code:` / `Failed to restore the code:` / `Failed to restore the conversation:` — wire whichever failure shapes our `RewindOps` result actually distinguishes; transcribe reachable arms, record the rest | L487142-154 |

**Steps:**

- [ ] **Step 1:** Failing tests: aliases route; rows carry summaries before any selection (fake dry-run resolving out of order); explanation lines per option; failure copy arms; (current) row.
- [ ] **Step 2:** Implement; green; typecheck.
- [ ] **Step 3:** Commit `f6(t10): rewind — pre-computed row summaries, explanations, failure copy, aliases`.

---

### Task 11: ModelPicker + resume SessionPicker (DG46, DG49–DG51)

**Files:**
- Modify: `src/tui/ModelPicker.tsx` (rebuild on `Select`), `src/tui/SessionPicker.tsx` (rebuild), `src/tui/useChat.ts` (session-only vs default persistence; search/rename plumbing)
- Test: `test/tui/model-picker.test.tsx`, `test/tui/session-picker.test.tsx`

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | ModelPicker header `"Select model"` bold, colour `remember`; subtitle `"Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model."`; third line only under a session-only override: `Currently using <model> for this session only. Selecting a model will undo this.` | L441096-107 |
| 2 | Rows from the live `supportedModels()` catalog (existing source — do NOT hardcode model ids per the model-tier-aliases memory); 10-row window (`visibleOptionCount = min(10, rows)`), `… +N models` overflow counter BELOW the Select (the `bM`-style caller-level counter — Select itself never prints it) | L440969, L441132 |
| 3 | `s` = apply for this session only (no default write). Plain Enter = apply AND persist as default → our prefs seam (`savePrefs`), NOT `~/.claude` (record the userSettings divergence). Footer: `enter to set as default` · `s to use this session only` · `Esc to cancel` | L441070, L441157, L315166 |
| 4 | Confirmation notice after pick: `` Set model to **<name>** `` + `" and saved as your default for new sessions"` or `" for this session only"` | L471427 |
| 5 | Pricing/effort metadata rows (DG47/DG48) are probe-gated non-goals — omit | spec |
| 6 | SessionPicker: header `` `Resume session (${n} of ${m})` ``; a type-to-search filter bar above the list (plain substring over id+summary); `Space` = preview pane (last messages of the highlighted session via existing `getSessionMessages`); `Ctrl+R` = rename mode `Rename session:` placeholder `"Enter new session name"` (via existing `renameSession`); empty states `` `No sessions match "${q}".` `` / `"No conversations found."` Scope toggles Ctrl+A/B/W need project/branch/worktree metadata our store lacks — OMIT, record | L476460-628 |
| 7 | Both pickers stay `Select`-driven — the hand-rolled list/key code dies; `MessageSelector`/`ModelPicker` contexts keep their bindings for the extra keys (`s`, `space`, `ctrl+r`) — add to the F2 table under the right context, not `useInput` | — |

**Steps:**

- [ ] **Step 1:** Failing tests: header/subtitle/footers, s-vs-enter persistence split (savePrefs spy), overflow counter, session search filter, preview + rename flows, empty states.
- [ ] **Step 2:** Rebuild both; green; typecheck.
- [ ] **Step 3:** Commit `f6(t11): ModelPicker + resume picker on Select — session-only vs default, search/preview/rename`.

---

### Task 12: Autocomplete row anatomy (DG55)

**Files:**
- Modify: `src/tui/suggestPopup.tsx` (row layout), `src/tui/completions.ts` (kind metadata onto rows if absent)
- Test: `test/tui/suggest-popup.test.tsx` (extend)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Row layout becomes `[source] [displayText, query-highlighted] [tag] [kind lane] [description]`; kind lane padded to 7 columns (`""` for actions, `"config"` for info rows, else the kind); `skill` kinds coloured with the `skill` role, `agent` kinds with `background` | L432430, L432488 |
| 2 | Applies to the ONE SuggestPopup (slash commands, @-mentions, history) — file rows keep their existing bLt middle-elide + a0H budget from F5; the new lanes must not break the F5 geometry pins (blank-padded fixed height, mid-anchored scroll) | F5 |
| 3 | Command rows: kind lane `"command"`? — **verify at L432488 what kinds our three sources map to** (the census lists the lane semantics, not the per-source values); transcribe what the bundle emits for slash/file/history rows and use exactly that | L432488 |

**Steps:**

- [ ] **Step 1:** Read the bundle at L432430-432540; failing tests for the lane widths/colours per source.
- [ ] **Step 2:** Implement; F5 geometry pins stay green; typecheck.
- [ ] **Step 3:** Commit `f6(t12): autocomplete kind lane + tags per DXe row anatomy`.

---

### Task 13: Todo panel + Background dialog (DG56–DG60, DG61 aliases)

**Files:**
- Modify: `src/tui/TaskPanel.tsx` (rebuild), `src/tui/taskList.ts` (activeForm/owner/blockedBy when present), `src/tui/BgTasksPanel.tsx` (rebuild into the Background dialog), `src/tui/commands.ts` (`/tasks` + `/bashes` aliases → the same panel as `/bg`), `src/tui/prefs.ts` (persist `showExpandedTodos`)
- Test: `test/tui/task-panel.test.tsx`, `test/tui/bg-dialog.test.tsx`, `test/unit/task-list.test.ts` (extend)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Todo header: `**N** tasks (**M** done, [**K** in progress, ]**J** open)` — in-progress clause only when non-zero; overflow line `` ` … +2 in progress, 3 pending` `` shape when windowed | L407193, L407180-189 |
| 2 | Glyphs/styles: completed `✔` colour `success`, **strikethrough + dim**; in_progress `◼` colour `claude`, **bold**; pending `◻` plain. **No empty state** — the panel renders `null` when the list is empty | L407196-205, L407099 |
| 3 | `taskList.ts` ingests `activeForm` (TaskCreate/TaskUpdate input), `owner` (TaskUpdate), `addBlockedBy`; rows render owner tag `(@name)` only at ≥60 columns, blocker line `› blocked by #12, #13`, and an activity sub-line `  <activeForm>…` for in-progress unblocked rows (probe 81: fields are schema-optional — render only when present) | L407240-255, probe 81 |
| 4 | Ctrl+T panel open-state persists via prefs (`showExpandedTodos`) and restores at startup | L401025-031 |
| 5 | Background dialog: frame title `"Background"`, colour role `background`, subtitle = counts joined `" · "` (`N agents`, `N active shells` — the reachable subset of our BgTasks rows), empty state `"No tasks currently running"`, dismiss message `"Background dialog dismissed"` as a transcript line | L481256 |
| 6 | Section headers rendered `  <label> (<n>)` for the types we actually have (`Agents`, `Shells`, `Monitors` — from our bgTaskMeta classification); `❯` pointer rows; status badges `(done)`/`(error)`/`(stopped)`/`(running)` coloured success/error/warning | L481255-295, L478653 |
| 7 | Footer: `↑↓ select` · `enter view` · `x stop` · `escape close`; Enter opens a detail sub-view: shells → `"Shell details"` with rows `Status:` (+ `` ` (exit code: N)` ``), `Runtime:`, `Command:`, `Output:` (last 10 lines in a rounded box, `"No output available"`), `left` goes back; agents → `<agentType> › <description>` header + status line | L481255, L479786, L478311 |
| 8 | `/tasks` and `/bashes` become aliases of `/bg` (all three open the dialog; DG61 keep-decision recorded) | L350769 |

**Steps:**

- [ ] **Step 1:** Failing tests: header counts arms; glyph/style pins; null on empty; owner/blocker/activity rows gated on presence + width; prefs round-trip.
- [ ] **Step 2:** Rebuild TaskPanel + taskList; green.
- [ ] **Step 3:** Failing tests: Background dialog frame/sections/badges/detail navigation/aliases.
- [ ] **Step 4:** Rebuild BgTasksPanel; green; typecheck.
- [ ] **Step 5:** Commit `f6(t13): todo panel + Background dialog — upstream anatomy, /tasks aliases, persisted toggle`.

---

### Task 14: `/help` tabbed dialog + the live shortcuts grid (DG62, DG63)

**Files:**
- Create: `src/tui/HelpDialog.tsx`
- Modify: `src/tui/ShortcutsOverlay.tsx` (rebuild as the 3-column grid resolved from the live binding table), `src/tui/commands.ts` (`/help` opens the dialog), `src/tui/useChat.ts` + `src/tui/ChatApp.tsx` (mount)
- Test: `test/tui/help-dialog.test.tsx`, `test/tui/shortcuts-grid.test.tsx`

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | `/help` renders a tabbed dialog (Task 2's `Tabs`) titled `"Help"`, tabs `General` / `Commands` / `Custom commands`; General tab copy: `"Claude understands your codebase, makes edits with your permission, and executes commands — right from your terminal."` + bold `Shortcuts` heading + the grid; Commands tab = a searchable browser over the live `commandCatalog` (title `"Browse default commands"`); Custom commands tab empty state `"No custom commands found"` (we surface user/plugin commands if the catalog distinguishes them — check `commandCatalog`'s shape; else all under Commands and the custom tab shows the empty state; record) | L459684-758 |
| 2 | Footer: `"For more help:" https://code.claude.com/docs/en/overview`; ≥44 rows adds `"Something else? Use /feedback to report bugs or request features."`; dismissal emits transcript line `"Help dialog dismissed"` | L459748-758, L459687 |
| 3 | Shortcuts grid: 3 columns, entries resolved from the **live F2 binding table** (the existing hints machinery), chords lower-case joined `" + "`. Upstream's verbatim entry set (render the subset whose bindings/features exist in ccx; every rendered chord MUST be the live-resolved one, so a user rebind changes the grid): `! for shell mode`, `/ for commands`, `@ for file paths`, `double tap esc to clear input`, `shift + tab to auto-accept edits`, `ctrl + o for verbose output`, `ctrl + t to toggle tasks`, `ctrl + _ to undo`, `ctrl + z to suspend`, `ctrl + v to paste images` (omit — images non-goal), `alt + p to switch model`, `ctrl + s to stash prompt`, `ctrl + g to edit in $EDITOR`, `/keybindings to customize` (omit unless we ship the command — record) | L459475-634, L459648 |
| 4 | The `?` overlay renders the SAME grid component (one source of truth); the old hard-coded 25-row list dies | L494617 |

**Steps:**

- [ ] **Step 1:** Failing tests: tabs + copy literals; command browser filters the live catalog; grid entries resolve from a REBOUND table in the test (rebind proves liveness); `?` and `/help` share the component.
- [ ] **Step 2:** Implement; green; typecheck.
- [ ] **Step 3:** Commit `f6(t14): Help tabbed dialog + live-resolved shortcuts grid`.

---

### Task 15: Final verification — spec acceptance + parity re-score

**Files:**
- Create: `test/tui/f6-acceptance.test.tsx`
- Modify: `docs/parity/tui-ux.md` (F6 section: now-faithful / unreachable / divergences / open gaps; §4 re-score), `docs/superpowers/specs/2026-07-31-tui-clone-fidelity-design.md` (Revision Notes if any spec statement fell)

**The spec's acceptance, verbatim (each becomes a pinned test where automatable, a recorded manual check where not):**

1. *A Bash permission prompt is titled `Bash command`, shows the rendered command and its dim description, asks `Do you want to proceed?`, and for `rm -rf` or `git reset --hard` adds the matching warning line in the warning colour.*
2. *Choosing `Yes, and don't ask again for: npm run *`, then quitting and relaunching ccx, runs the same command with no prompt — and the rule is visible in `.claude/settings.local.json`.* (Unit-pin the outcome payload + the gate's echo; the relaunch half is probe-81-proven and re-verified in the wave-close live pass.)
3. *An Edit permission prompt shows the real diff inline in the transcript with the composer still visible below it, not a full-screen replacement.*
4. *A plan approval is titled `Ready to code?`; choosing `No, keep planning` and submitting empty feedback leaves the dialog open rather than denying.*
5. *The rewind picker shows each row's file-change summary before anything is selected.*
6. *`j`/`k`, `ctrl+n`/`ctrl+p`, PageUp/PageDown and Home/End move the selection in every list in the app.* (Pin on each Select-driven surface via a shared test helper.)

**Steps:**

- [ ] **Step 1:** Write the acceptance pins; run the FULL `npm run typecheck` + `npm run test:unit` + `npm run test:tui`.
- [ ] **Step 2:** Re-score `docs/parity/tui-ux.md` §4 (modals/overlays) row by row against the census DG table; write the F6 section (faithful / unreachable: DG28 (probe 81), DG22/DG23 (probe 78), DG33, DG54 / divergences: prefs-not-userSettings, no parent-session rewind row, no Ctrl+A/B/W scopes, allow-side feedback if confirmed unreachable / open gaps honestly).
- [ ] **Step 3:** Commit `f6(t15): acceptance pins + parity re-score`.

---

## Self-Review notes (author)

- Spec coverage: every Delivers row maps — ST7→T1/T2; DG1→T4/T6-8; DG2/DG3→T6; DG6–DG10/DG12→T7; DG13–DG15/DG19→T8; DG21/DG26→T4; DG24→T6/T7/T8 deny rows; DG27→T5; don't-ask-again→T3+T6-8; DG28→recorded unreachable (probe 81, supersedes the spec's Delivers line — Revision Note in T15); DG29–DG31/DG34→T9; DG38–DG40/DG42/DG44→T10; DG45→T2; DG46/DG49–DG51→T11; DG55→T12; DG56–DG60→T13; DG62/DG63→T14.
- DG11 (shift+tab picks accept-session) is formally outside the spec's Delivers list but DG9's exact label text embeds the live-resolved chord; T7 req 7 ships the binding so the label is truthful. If the reviewer flags scope creep: the alternative is a lying label — bundle fidelity wins.
- Type consistency: `allow_with_updates` is defined once (T3) and consumed by T6–T9; `SelectOption`/`SelectProps` defined in T1 and consumed by T2/T6–T11.
- The plan deliberately instructs implementers to READ cited bundle lines before transcribing regex/kind tables (T4 req 3/4, T8 req 3, T12 req 3) — the F5 lesson: census rows are summaries; the bundle is the source.
